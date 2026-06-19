import tempfile
import threading
import unittest
from unittest.mock import patch

import numpy as np

from backend.recorder import AudioRecorder


class FakeInputStream:
    def __init__(self):
        self.active = False
        self.start_calls = 0
        self.stop_calls = 0

    def start(self):
        self.active = True
        self.start_calls += 1

    def stop(self):
        self.active = False
        self.stop_calls += 1


class AudioRecorderPreTriggerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.stream = FakeInputStream()
        self.stream_patch = patch("backend.recorder.sd.InputStream", return_value=self.stream)
        self.stream_patch.start()
        self.recorder = AudioRecorder(
            output_filename=f"{self.temp_dir.name}/dictation.wav",
            pre_trigger_duration_seconds=2.0,
        )
        self.recorder.vad.is_speech = lambda *_args: True

    def tearDown(self):
        self.recorder.disarm()
        self.stream_patch.stop()
        self.temp_dir.cleanup()

    def make_frame(self, value):
        return np.full((self.recorder.chunk_size, 1), value, dtype=np.float32)

    def add_idle_frame(self, value, is_speech=True):
        frame = self.make_frame(value)
        self.recorder.vad.is_speech = lambda *_args: is_speech
        self.recorder._audio_callback(frame, len(frame), None, None)
        return frame

    def test_repeated_arm_preserves_earliest_buffered_audio(self):
        self.assertTrue(self.recorder.arm())
        self.add_idle_frame(0.1)

        self.assertTrue(self.recorder.arm())

        self.assertEqual(len(self.recorder.ring_buffer), 1)
        self.assertEqual(self.stream.start_calls, 1)

    def test_streaming_recording_emits_audio_buffered_while_armed(self):
        self.assertTrue(self.recorder.arm())
        frames = [self.add_idle_frame(value) for value in (0.1, 0.2, 0.3)]

        chunks = self.recorder.record_streaming()
        captured = [next(chunks)]
        self.recorder.stop()
        captured.extend(list(chunks))

        expected = b"".join((frame * 32767).astype(np.int16).tobytes() for frame in frames)
        self.assertEqual(b"".join(captured), expected)
        self.assertFalse(self.stream.active)

    def test_streaming_recording_preserves_stop_requested_during_handoff(self):
        self.assertTrue(self.recorder.arm())
        frames = [self.add_idle_frame(value) for value in (0.1, 0.2, 0.3)]

        result = {}
        self.recorder.stop()
        record_thread = threading.Thread(
            target=lambda: result.setdefault("chunks", list(self.recorder.record_streaming()))
        )
        record_thread.start()
        record_thread.join(timeout=1.0)
        if record_thread.is_alive():
            self.recorder.stop()
            record_thread.join(timeout=1.0)

        expected = b"".join((frame * 32767).astype(np.int16).tobytes() for frame in frames)
        self.assertFalse(record_thread.is_alive())
        self.assertEqual(b"".join(result["chunks"]), expected)

    def test_batch_recording_flushes_short_speech_that_finished_while_arming(self):
        self.assertTrue(self.recorder.arm())
        speech_frames = [self.add_idle_frame(value) for value in (0.1, 0.2, 0.3)]
        silence_frames = [self.add_idle_frame(0.0, is_speech=False) for _index in range(20)]

        result = {}
        self.recorder.stop()
        record_thread = threading.Thread(target=lambda: result.setdefault("path", self.recorder.record()))
        record_thread.start()
        record_thread.join(timeout=1.0)

        expected_frames = speech_frames + silence_frames
        expected = b"".join((frame * 32767).astype(np.int16).tobytes() for frame in expected_frames)
        actual = b"".join(frame.tobytes() for frame in self.recorder.speech_chunks)
        self.assertTrue(self.recorder.triggered)
        self.assertFalse(record_thread.is_alive())
        self.assertEqual(actual, expected)
        self.assertTrue(result["path"].endswith("dictation.wav"))

    def test_disarm_releases_microphone_and_clears_buffer(self):
        self.assertTrue(self.recorder.arm())
        self.add_idle_frame(0.1)

        self.assertTrue(self.recorder.disarm())

        self.assertFalse(self.stream.active)
        self.assertEqual(len(self.recorder.ring_buffer), 0)
        self.assertEqual(self.stream.stop_calls, 1)


if __name__ == "__main__":
    unittest.main()
