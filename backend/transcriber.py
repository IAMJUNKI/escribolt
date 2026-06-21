import gc
import importlib
import json
import os
import tempfile
import time
import wave
from pathlib import Path
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

    def _find_cached_model_weights_file(self):
        try:
            hub = importlib.import_module("huggingface_hub")
            try_to_load_from_cache = getattr(hub, "try_to_load_from_cache", None)
            if not callable(try_to_load_from_cache):
                return None
            for filename in ("model.safetensors", "weights.safetensors", "weights.npz"):
                cached_path = try_to_load_from_cache(self.model_path, filename)
                if isinstance(cached_path, str) and os.path.exists(cached_path):
                    return cached_path
        except Exception:
            return None
        return None

    def _resolve_model_load_path(self):
        if os.path.exists(self.model_path):
            return self.model_path, True

        cached_weights_file = self._find_cached_model_weights_file()
        if cached_weights_file:
            return Path(cached_weights_file).parent, True

        return self.model_path, False

    def _has_cached_model_weights(self):
        if os.path.exists(self.model_path):
            return True
        return self._find_cached_model_weights_file() is not None

    def _is_whisper_model(self):
        return "whisper" in str(self.model_path or "").lower()

    def _install_whisper_timing_placeholder(self):
        if os.environ.get("ESCRIBOLT_OPTIMIZE_WHISPER_IMPORTS", "1") == "0":
            return

        import sys
        import types

        module_name = "mlx_audio.stt.models.whisper.timing"
        if module_name in sys.modules:
            return

        timing_module = types.ModuleType(module_name)

        def add_word_timestamps(*args, **kwargs):
            raise TranscriberRuntimeError(
                "Word-level timestamps are unavailable in the optimized local speech loader."
            )

        timing_module.add_word_timestamps = add_word_timestamps
        sys.modules[module_name] = timing_module

    def _load_cached_whisper_model(self, model_path):
        timings = {}

        def mark(name, started_at):
            timings[name] = round((time.monotonic() - started_at) * 1000.0, 2)

        model_dir = Path(model_path)
        self._install_whisper_timing_placeholder()
        started = time.monotonic()
        whisper_module = importlib.import_module("mlx_audio.stt.models.whisper.whisper")
        mx = importlib.import_module("mlx.core")
        nn = importlib.import_module("mlx.nn")
        mlx_utils = importlib.import_module("mlx.utils")
        mark("importsMs", started)

        started = time.monotonic()
        with open(str(model_dir / "config.json"), "r") as config_file:
            config = json.loads(config_file.read())
        config.pop("model_type", None)
        quantization = config.pop("quantization", None)
        model_args = whisper_module.ModelDimensions(**config)
        mark("configMs", started)

        weights_path = model_dir / "model.safetensors"
        if not weights_path.exists():
            weights_path = model_dir / "weights.safetensors"
        if not weights_path.exists():
            weights_path = model_dir / "weights.npz"
        if not weights_path.exists():
            raise FileNotFoundError(f"No local Whisper weights found in {model_dir}")

        started = time.monotonic()
        weights = mx.load(str(weights_path))
        mark("weightsLoadMs", started)

        started = time.monotonic()
        model = whisper_module.Model(model_args, mx.float16)
        mark("constructMs", started)

        if quantization is not None:
            started = time.monotonic()
            class_predicate = (
                lambda path, module: isinstance(module, (nn.Linear, nn.Embedding))
                and f"{path}.scales" in weights
            )
            nn.quantize(model, **quantization, class_predicate=class_predicate)
            mark("quantizeMs", started)

        started = time.monotonic()
        model.update(mlx_utils.tree_unflatten(list(weights.items())))
        model._model_path = model_dir
        mark("updateMs", started)

        started = time.monotonic()
        mx.eval(model.parameters())
        mark("evalMs", started)

        print(f"[transcriber] direct Whisper load timings: {json.dumps(timings, separators=(',', ':'))}")
        return model

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
        load_path, cached = self._resolve_model_load_path()
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
        if cached and load_path != self.model_path:
            print(f"[transcriber] resolved cached model snapshot: {load_path}")
        if cached and isinstance(load_path, Path) and self._is_whisper_model():
            self._model = self._load_cached_whisper_model(load_path)
        else:
            self._model = load_model(load_path)
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
