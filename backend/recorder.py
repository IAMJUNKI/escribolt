import sounddevice as sd
import numpy as np
import soundfile as sf
import threading
import time
import os
import sys
import queue as queue_mod

# Hack to fix webrtcvad import issue on Python 3.13+ where pkg_resources is missing
if "pkg_resources" not in sys.modules:
    class _PkgResourcesShim:
        class _Distribution:
            version = "2.0.10"

        @staticmethod
        def get_distribution(_name):
            return _PkgResourcesShim._Distribution()

    sys.modules["pkg_resources"] = _PkgResourcesShim()

import webrtcvad
import collections

class AudioRecorder:
    def __init__(
        self,
        output_filename="temp_recording.wav",
        vad_aggressiveness=3,
        silence_limit_seconds=1.5,
        pre_trigger_duration_seconds=2.0,
        enable_silence_autostop=False,
    ):
        self.output_filename = output_filename
        self.samplerate = 16000
        self.channels = 1
        # WebRTC VAD requires 10, 20, or 30ms frames.
        # At 16000Hz, 30ms = 480 samples.
        self.frame_duration_ms = 30
        self.chunk_size = int(self.samplerate * self.frame_duration_ms / 1000)
        
        self.vad = webrtcvad.Vad(vad_aggressiveness)
        self.silence_limit_seconds = silence_limit_seconds
        self.enable_silence_autostop = bool(enable_silence_autostop)

        self.stop_event = threading.Event()
        self.triggered = False
        self.silence_counter = 0
        self.speech_chunks = []
        self.stream_stopped = False
        self.is_recording = False  # True when record() is actively capturing
        self._record_lock = threading.Lock()
        self._lifecycle_lock = threading.RLock()
        self._stream_lock = threading.RLock()
        self._buffer_lock = threading.Lock()
        self._trigger_lock = threading.Lock()
        
        # Ring buffer for pre-trigger audio (always filling while stream is open).
        # Kept configurable so we can tune latency vs. first-word capture.
        safe_pre_trigger_duration = max(0.3, min(3.0, float(pre_trigger_duration_seconds)))
        pre_trigger_chunks = int(safe_pre_trigger_duration / (self.frame_duration_ms / 1000))
        self.ring_buffer = collections.deque(maxlen=pre_trigger_chunks)
        self.vad_trigger_window_chunks = max(2, int(0.3 / (self.frame_duration_ms / 1000)))
        self.vad_trigger_min_voiced_chunks = 2
        # Streaming STT performs better when we avoid sending long pre-speech silence.
        # Keep a larger lead-in (up to 1.2s / 40 chunks) so first phonemes are perfectly preserved without latency.
        self.streaming_lead_in_chunks = max(10, min(50, int(1.2 / (self.frame_duration_ms / 1000))))
        
        # The microphone stream will be started on-demand in record()
        self._stream = None
        self._armed = False
        self.last_error_code = None
        self.last_error_message = ''
        self._streaming_queue = None  # Set when streaming mode is active

    def _set_error(self, code, message):
        self.last_error_code = code
        self.last_error_message = str(message or '').strip()

    def clear_last_error(self):
        self.last_error_code = None
        self.last_error_message = ''

    def get_last_error(self):
        if not self.last_error_code:
            return None
        return {
            "code": self.last_error_code,
            "message": self.last_error_message or self.last_error_code,
        }

    def _start_stream(self):
        """Start or resume the microphone stream."""
        with self._stream_lock:
            if self._stream is not None:
                try:
                    if not self._stream.active:
                        self._stream.start()
                        print("Microphone stream resumed dynamically.")
                    return True
                except Exception as e:
                    print(f"Failed to resume mic stream: {e}")
                    self._set_error("mic_resume_failed", f"Failed to resume microphone stream: {e}")
                    return False
            try:
                self._stream = sd.InputStream(
                    samplerate=self.samplerate,
                    channels=self.channels,
                    callback=self._audio_callback,
                    blocksize=self.chunk_size,
                    dtype='float32'
                )
                self._stream.start()
                print("Microphone stream initialized and started.")
                return True
            except Exception as e:
                print(f"Failed to start mic stream: {e}")
                self._set_error("mic_start_failed", f"Failed to start microphone stream: {e}")
                return False

    def _stop_stream(self):
        """Stop the microphone stream to release hardware device and hide orange dot."""
        with self._stream_lock:
            if self._stream is not None:
                try:
                    if self._stream.active:
                        self._stream.stop()
                        print("Microphone stream stopped to release hardware.")
                except Exception as e:
                    print(f"Error stopping mic stream: {e}")
        with self._buffer_lock:
            self.ring_buffer.clear()

    def arm(self):
        """Start filling the pre-trigger buffer before recording officially begins."""
        with self._lifecycle_lock:
            if self.is_recording:
                return True
            with self._stream_lock:
                if self._stream is not None and self._stream.active:
                    self._armed = True
                    return True
                with self._buffer_lock:
                    self.ring_buffer.clear()
                self.stop_event.clear()
                self._armed = self._start_stream()
                return self._armed

    def disarm(self):
        """Release an armed stream when dictation is cancelled before recording."""
        with self._lifecycle_lock:
            if self.is_recording:
                return False
            self._armed = False
            self._stop_stream()
            return True

    def _take_ring_snapshot(self):
        with self._buffer_lock:
            ring_snapshot = list(self.ring_buffer)
            self.ring_buffer.clear()
        return ring_snapshot

    def _ring_buffer_has_voice_trigger(self, recent_only=True):
        with self._buffer_lock:
            ring_snapshot = list(self.ring_buffer)
        if recent_only:
            ring_snapshot = ring_snapshot[-self.vad_trigger_window_chunks:]
        voiced_chunks = sum(1 for _data, is_speech in ring_snapshot if is_speech)
        return voiced_chunks >= self.vad_trigger_min_voiced_chunks

    def _flush_ring_buffer_to_speech_chunks(self):
        with self._trigger_lock:
            if self.triggered:
                return
            print("Voice detected! Triggering...")
            self.triggered = True
            ring_snapshot = self._take_ring_snapshot()
        lead_start_index = max(0, len(ring_snapshot) - self.streaming_lead_in_chunks)
        for idx, (data, is_speech_frame) in enumerate(ring_snapshot):
            self.speech_chunks.append(data)
            if self._streaming_queue is not None:
                should_emit_to_stream = is_speech_frame or idx >= lead_start_index
                if not should_emit_to_stream:
                    continue
                try:
                    self._streaming_queue.put_nowait(data.tobytes())
                except queue_mod.Full:
                    pass

    def _audio_callback(self, indata, frames, time_info, status):
        """Callback: fills ring buffer, captures speech when recording."""
        if status:
            print(f"Audio Callback Status: {status}")
        
        # Convert float32 to int16 for VAD
        audio_data = (indata * 32767).astype(np.int16)
        
        is_speech = False
        try:
            is_speech = self.vad.is_speech(audio_data.tobytes(), self.samplerate)
        except Exception:
            pass

        if not self.is_recording:
            # Not recording — just keep filling ring buffer silently
            with self._buffer_lock:
                self.ring_buffer.append((audio_data, is_speech))
            return

        # --- Active recording mode ---
        if not self.triggered:
            with self._buffer_lock:
                self.ring_buffer.append((audio_data, is_speech))
            
            # Trigger quickly while still rejecting obvious noise bursts.
            if self._ring_buffer_has_voice_trigger():
                self._flush_ring_buffer_to_speech_chunks()
        else:
            self.speech_chunks.append(audio_data)
            if self._streaming_queue is not None:
                try:
                    self._streaming_queue.put_nowait(audio_data.tobytes())
                except queue_mod.Full:
                    pass

            if self.enable_silence_autostop:
                if not is_speech:
                    self.silence_counter += 1
                else:
                    self.silence_counter = 0

                max_silence_chunks = int(self.silence_limit_seconds / (self.frame_duration_ms / 1000))
                if self.silence_counter > max_silence_chunks:
                    print(f"Silence detected (> {self.silence_limit_seconds}s), stopping...")
                    self.stream_stopped = True

    def stop(self):
        """Signal the recorder to stop immediately."""
        self.stop_event.set()

    def record(self):
        """Records audio using VAD."""
        if not self._record_lock.acquire(blocking=False):
            print("Recording request ignored: another recording is already active.")
            self._set_error("recording_busy", "Another recording is already active.")
            return None

        print("Listening for speech...")
        self.clear_last_error()

        try:
            with self._lifecycle_lock:
                # Start stream on-demand, preserving audio captured while armed.
                was_armed = self._armed
                self._armed = False
                if not self._start_stream():
                    print("Microphone failed to start. Aborting record.")
                    return None

                self.speech_chunks = []
                self.triggered = False
                self.silence_counter = 0
                if not was_armed:
                    self.stop_event.clear()
                self.stream_stopped = False

                # Activate recording mode (callback starts capturing)
                self.is_recording = True

            # Speech may have completed during the arming delay. Flush it before
            # waiting for another callback so short opening words are retained.
            if self._ring_buffer_has_voice_trigger(recent_only=False):
                self._flush_ring_buffer_to_speech_chunks()

            start_time = time.time()
            while True:
                if self.stream_stopped:
                    break
                
                if self.stop_event.is_set():
                    print("Manual stop requested.")
                    self._set_error("recording_stopped", "Recording was stopped before completion.")
                    break

                if self.triggered and time.time() - start_time > 240:
                    print("Max duration reached (4 minutes).")
                    self._set_error("max_duration_reached", "Recording reached the maximum duration.")
                    break
                
                if not self.triggered and time.time() - start_time > 30:
                    print("No speech detected (timeout 30s).")
                    self._set_error("no_speech_timeout", "No speech detected before timeout.")
                    break
                     
                time.sleep(0.1)
        finally:
            with self._lifecycle_lock:
                self.is_recording = False
                self._armed = False
                self._stop_stream()
            self._record_lock.release()
            
        return self.save_recording()

    def record_streaming(self):
        """Records audio and yields raw PCM16 chunks in real-time for streaming transcription."""
        if not self._record_lock.acquire(blocking=False):
            self._set_error("recording_busy", "Another recording is already active.")
            raise RuntimeError(self.last_error_message or "Another recording is already active.")

        print("Listening for speech (streaming mode)...")
        self.clear_last_error()

        try:
            with self._lifecycle_lock:
                was_armed = self._armed
                self._armed = False
                if not self._start_stream():
                    print("Microphone failed to start. Aborting streaming record.")
                    raise RuntimeError(self.last_error_message or "Microphone failed to start.")

                self.speech_chunks = []
                self.triggered = False
                self.silence_counter = 0
                if not was_armed:
                    self.stop_event.clear()
                self.stream_stopped = False

                self._streaming_queue = queue_mod.Queue(maxsize=500)
                self.is_recording = True

            # Trigger instantly for streaming mode to bypass local VAD trigger latency
            self.triggered = True
            ring_snapshot = self._take_ring_snapshot()
            lead_start_index = max(0, len(ring_snapshot) - self.streaming_lead_in_chunks)
            for idx, (data, is_speech_frame) in enumerate(ring_snapshot):
                self.speech_chunks.append(data)
                should_emit_to_stream = is_speech_frame or idx >= lead_start_index
                if should_emit_to_stream:
                    try:
                        self._streaming_queue.put_nowait(data.tobytes())
                    except queue_mod.Full:
                        pass

            start_time = time.time()
            while True:
                if self.stream_stopped or self.stop_event.is_set():
                    break

                if self.triggered and time.time() - start_time > 240:
                    print("Max duration reached (4 minutes).")
                    break

                if not self.triggered and time.time() - start_time > 30:
                    print("No speech detected (timeout 30s).")
                    break

                # Drain all available chunks
                try:
                    while True:
                        chunk = self._streaming_queue.get_nowait()
                        yield chunk
                except queue_mod.Empty:
                    pass

                time.sleep(0.01)

            # Final drain
            try:
                while True:
                    chunk = self._streaming_queue.get_nowait()
                    yield chunk
            except queue_mod.Empty:
                pass
        finally:
            with self._lifecycle_lock:
                self.is_recording = False
                self._armed = False
                self._streaming_queue = None
                self._stop_stream()
            self._record_lock.release()
            # Still save the full recording as a backup file
            self.save_recording()

    def save_recording(self):
        if not self.speech_chunks:
            print("No speech recorded.")
            if not self.last_error_code:
                self._set_error("no_speech_recorded", "No speech was captured by the microphone.")
            return None
        
        data = np.concatenate(self.speech_chunks, axis=0)
        
        # Check if recording is too short (likely noise)
        duration = len(data) / self.samplerate
        if duration < 0.5:
            print(f"Recording too short ({duration:.2f}s), ignoring.")
            self._set_error("speech_too_short", f"Captured speech was too short ({duration:.2f}s).")
            return None

        sf.write(self.output_filename, data, self.samplerate)
        print(f"Saved to {self.output_filename} ({duration:.2f}s)")
        self.clear_last_error()
        return os.path.abspath(self.output_filename)

if __name__ == "__main__":
    recorder = AudioRecorder()
    recorder.record()
