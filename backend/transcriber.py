import gc
import importlib
import os
import tempfile
import time
import wave
from threading import Lock
from types import ModuleType
from typing import Callable, Optional


class TranscriberRuntimeError(RuntimeError):
    """Raised when the local MLX transcription runtime is unavailable."""


class Transcriber:
    engine = "mlx-audio-plus"

    def __init__(self, model_path="mlx-community/whisper-large-v3-turbo-4bit"):
        self.model_path = model_path
        self._mlx_audio_stt_utils: Optional[ModuleType] = None
        self._model = None
        self._loaded_model_path: Optional[str] = None
        self._runtime_failure: Optional[str] = None
        self._model_ready = False
        self._warmup_ran = False
        self._lock = Lock()

    def _emit_status(self, on_status: Optional[Callable[[str, str], None]], stage: str, message: str):
        print(f"[transcriber] {stage}: {message}")
        if callable(on_status):
            on_status(stage, message)

    def _configure_huggingface_downloads(self):
        if os.environ.get("HF_HUB_ENABLE_HF_TRANSFER") is not None:
            return
        try:
            if importlib.util.find_spec("hf_transfer") is not None:
                os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"
        except Exception:
            pass

    def _has_cached_model_weights(self):
        if os.path.exists(self.model_path):
            return True
        try:
            hub = importlib.import_module("huggingface_hub")
            try_to_load_from_cache = getattr(hub, "try_to_load_from_cache", None)
            if not callable(try_to_load_from_cache):
                return False
            for filename in ("model.safetensors", "weights.safetensors", "weights.npz"):
                cached_path = try_to_load_from_cache(self.model_path, filename)
                if isinstance(cached_path, str) and os.path.exists(cached_path):
                    return True
        except Exception:
            return False
        return False

    def _ensure_runtime(self, on_status: Optional[Callable[[str, str], None]] = None):
        if self._mlx_audio_stt_utils is None:
            try:
                self._configure_huggingface_downloads()
                self._emit_status(
                    on_status,
                    "importing-runtime",
                    "Importing mlx-audio-plus speech runtime.",
                )
                self._mlx_audio_stt_utils = importlib.import_module("mlx_audio.stt.utils")
                self._runtime_failure = None
            except Exception as error:
                self._mark_runtime_failure(error)
                raise TranscriberRuntimeError(self._runtime_failure) from error

    def _ensure_model(self, on_status: Optional[Callable[[str, str], None]] = None):
        self._ensure_runtime(on_status=on_status)
        if self._model is not None and self._loaded_model_path == self.model_path:
            return self._model

        load_model = getattr(self._mlx_audio_stt_utils, "load_model", None)
        if not callable(load_model):
            raise TranscriberRuntimeError("mlx_audio.stt.utils.load_model is unavailable")
        started = time.monotonic()
        cached = self._has_cached_model_weights()
        action = "Loading cached" if cached else "Downloading and loading"
        setup_note = (
            "This app session still needs a warm-up pass."
            if cached
            else "First setup can take several minutes."
        )
        self._emit_status(
            on_status,
            "loading-model",
            f"{action} {self.model_path}. {setup_note}",
        )
        self._model = load_model(self.model_path)
        self._loaded_model_path = self.model_path
        duration_ms = round((time.monotonic() - started) * 1000.0, 2)
        self._emit_status(
            on_status,
            "model-loaded",
            f"Local speech model loaded in {duration_ms} ms.",
        )
        return self._model

    def _mark_runtime_failure(self, error):
        self._mlx_audio_stt_utils = None
        self._model = None
        self._loaded_model_path = None
        self._model_ready = False
        self._warmup_ran = False
        self._runtime_failure = f"{type(error).__name__}: {error}"
        print(f"[transcriber] Local MLX audio runtime unavailable: {self._runtime_failure}")

    def _write_dummy_audio_file(self):
        tmp = tempfile.NamedTemporaryFile(prefix="escribolt-local-stt-warmup-", suffix=".wav", delete=False)
        tmp_path = tmp.name
        tmp.close()
        with wave.open(tmp_path, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(16000)
            wav_file.writeframes(b"\x00\x00" * 8000)
        return tmp_path

    def _extract_text(self, result):
        if isinstance(result, dict):
            text = result.get("text")
        elif isinstance(result, str):
            text = result
        else:
            text = getattr(result, "text", "")
        return text.strip() if isinstance(text, str) else None

    def _transcribe_audio(self, audio_path, language=None, warmup=False, on_status=None):
        model = self._ensure_model(on_status=on_status)
        generate = getattr(model, "generate", None)
        if not callable(generate):
            raise TranscriberRuntimeError("mlx_audio STT model.generate is unavailable")

        kwargs = {"verbose": False}
        if language:
            kwargs["language"] = language
        if warmup:
            self._emit_status(
                on_status,
                "dummy-inference",
                "Running silent warm-up transcription to compile MLX kernels.",
            )
        result = generate(audio_path, **kwargs)
        self._runtime_failure = None
        self._model_ready = True
        if warmup:
            self._warmup_ran = True
            self._emit_status(
                on_status,
                "warmup-complete",
                "Silent warm-up transcription completed.",
            )
        return self._extract_text(result)

    def is_runtime_imported(self):
        return self._mlx_audio_stt_utils is not None

    def is_model_loaded(self):
        return self._model_ready

    def has_warmup_ran(self):
        return self._warmup_ran

    def warm(self, on_status: Optional[Callable[[str, str], None]] = None):
        with self._lock:
            self._ensure_runtime(on_status=on_status)
            if self.is_model_loaded() and self.has_warmup_ran():
                return {
                    "runtime_imported": True,
                    "model_loaded": True,
                    "warmup_ran": True,
                    "engine": self.engine,
                }

            dummy_audio_path = self._write_dummy_audio_file()
            try:
                self._transcribe_audio(dummy_audio_path, warmup=True, on_status=on_status)
            except TranscriberRuntimeError:
                raise
            except Exception as error:
                self._mark_runtime_failure(error)
                raise TranscriberRuntimeError(self._runtime_failure) from error
            finally:
                try:
                    os.unlink(dummy_audio_path)
                except OSError:
                    pass
            return {
                "runtime_imported": True,
                "model_loaded": self.is_model_loaded(),
                "warmup_ran": self.has_warmup_ran(),
                "engine": self.engine,
            }

    def transcribe(self, audio_path, language=None):
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        with self._lock:
            try:
                self._ensure_runtime()
                lang_info = f" (lang={language})" if language else " (auto-detect)"
                print(f"Transcribing {audio_path} with {self.model_path}{lang_info}...")
                return self._transcribe_audio(audio_path, language=language)
            except TranscriberRuntimeError:
                raise
            except Exception as error:
                self._mark_runtime_failure(error)
                raise TranscriberRuntimeError(self._runtime_failure) from error

    def release_resources(self):
        """
        Release MLX cache state after idle periods.
        mlx-audio-plus does not expose a stable model-holder API, so this clears
        local readiness flags and any available MLX Metal cache.
        """
        with self._lock:
            released = bool(self._model_ready or self._warmup_ran)
            self._model_ready = False
            self._warmup_ran = False

            self._model = None
            self._loaded_model_path = None

            try:
                mx = importlib.import_module("mlx.core")
                metal = getattr(mx, "metal", None)
                clear_cache = getattr(metal, "clear_cache", None) if metal is not None else None
                if callable(clear_cache):
                    clear_cache()
                    released = True
            except Exception:
                # Runtime-specific cache API can vary; ignore when unavailable.
                pass

            gc.collect()
            return released

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        t = Transcriber()
        print(t.transcribe(sys.argv[1]))
