import os
import sys
import tempfile
import types
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf

from backend.transcriber import SSL_CERT_ENV_KEYS, Transcriber, TranscriberRuntimeError


LOCAL_STT_MODEL = "mlx-community/whisper-large-v3-turbo-4bit"


class FakeSttModule:
    def __init__(self, result=None, on_call=None):
        self.calls = []
        self.result = {"text": "hello world"} if result is None else result
        self.on_call = on_call

    def generate(self, audio_path, **kwargs):
        call = {"audio": audio_path, **kwargs}
        self.calls.append(call)
        if self.on_call:
            return self.on_call(call)
        return self.result


class FakeUtilsModule:
    def __init__(self, model):
        self.model = model
        self.load_calls = []

    def load_model(self, model_path):
        self.load_calls.append(model_path)
        return self.model


class TranscriberTests(unittest.TestCase):
    def test_ssl_certificate_env_defaults_to_certifi_bundle(self):
        with tempfile.NamedTemporaryFile() as cert_file:
            fake_certifi = types.SimpleNamespace(where=lambda: cert_file.name)

            with patch.dict(sys.modules, {"certifi": fake_certifi}):
                with patch.dict(os.environ, {}, clear=False):
                    for env_key in SSL_CERT_ENV_KEYS:
                        os.environ.pop(env_key, None)

                    cert_path = Transcriber(model_path=LOCAL_STT_MODEL)._configure_ssl_certificates()

                    self.assertEqual(cert_path, cert_file.name)
                    for env_key in SSL_CERT_ENV_KEYS:
                        self.assertEqual(os.environ.get(env_key), cert_file.name)

    def test_hf_transfer_is_not_auto_enabled(self):
        with tempfile.NamedTemporaryFile() as cert_file:
            fake_certifi = types.SimpleNamespace(where=lambda: cert_file.name)

            with patch.dict(sys.modules, {"certifi": fake_certifi}):
                with patch.dict(os.environ, {}, clear=False):
                    os.environ.pop("HF_HUB_ENABLE_HF_TRANSFER", None)
                    os.environ.pop("ESCRIBOLT_ENABLE_HF_TRANSFER", None)
                    for env_key in SSL_CERT_ENV_KEYS:
                        os.environ.pop(env_key, None)

                    transcriber = Transcriber(model_path=LOCAL_STT_MODEL)
                    with patch("backend.transcriber.importlib.util.find_spec", return_value=object()) as find_spec:
                        transcriber._configure_huggingface_downloads()

                    self.assertNotIn("HF_HUB_ENABLE_HF_TRANSFER", os.environ)
                    find_spec.assert_not_called()
                    for env_key in SSL_CERT_ENV_KEYS:
                        self.assertEqual(os.environ.get(env_key), cert_file.name)

    def test_hf_transfer_can_be_enabled_explicitly(self):
        with tempfile.NamedTemporaryFile() as cert_file:
            fake_certifi = types.SimpleNamespace(where=lambda: cert_file.name)

            with patch.dict(sys.modules, {"certifi": fake_certifi}):
                with patch.dict(os.environ, {"ESCRIBOLT_ENABLE_HF_TRANSFER": "true"}, clear=False):
                    os.environ.pop("HF_HUB_ENABLE_HF_TRANSFER", None)
                    for env_key in SSL_CERT_ENV_KEYS:
                        os.environ.pop(env_key, None)

                    transcriber = Transcriber(model_path=LOCAL_STT_MODEL)
                    with patch("backend.transcriber.importlib.util.find_spec", return_value=object()) as find_spec:
                        transcriber._configure_huggingface_downloads()

                    self.assertEqual(os.environ.get("HF_HUB_ENABLE_HF_TRANSFER"), "1")
                    find_spec.assert_called_once_with("hf_transfer")

    def test_runtime_import_is_lazy_and_transcribe_uses_exact_model(self):
        fake_model = FakeSttModule(result={"text": "  hello local speech  "})
        fake_utils = FakeUtilsModule(fake_model)

        def import_module(name):
            if name == "mlx_audio.stt.utils":
                return fake_utils
            raise ImportError(name)

        with patch("backend.transcriber.importlib.import_module", side_effect=import_module) as import_mock:
            transcriber = Transcriber(model_path=LOCAL_STT_MODEL)
            import_mock.assert_not_called()

            with tempfile.NamedTemporaryFile(suffix=".wav") as audio_file:
                text = transcriber.transcribe(audio_file.name, language="en")

        self.assertEqual(text, "hello local speech")
        self.assertTrue(transcriber.is_runtime_imported())
        self.assertTrue(transcriber.is_model_loaded())
        self.assertFalse(transcriber.has_warmup_ran())
        self.assertEqual(fake_utils.load_calls, [LOCAL_STT_MODEL])
        self.assertEqual(fake_model.calls[0]["audio"], audio_file.name)
        self.assertEqual(fake_model.calls[0]["language"], "en")
        self.assertFalse(fake_model.calls[0]["verbose"])

    def test_warm_runs_silent_dummy_transcription_and_cleans_up(self):
        seen = {}

        def inspect_warmup_audio(kwargs):
            audio_path = kwargs["audio"]
            seen["path"] = audio_path
            seen["exists_during_call"] = os.path.exists(audio_path)
            with wave.open(audio_path, "rb") as wav_file:
                seen["channels"] = wav_file.getnchannels()
                seen["sample_width"] = wav_file.getsampwidth()
                seen["sample_rate"] = wav_file.getframerate()
                seen["frames"] = wav_file.getnframes()
            return {"text": ""}

        fake_model = FakeSttModule(on_call=inspect_warmup_audio)
        fake_utils = FakeUtilsModule(fake_model)

        def import_module(name):
            if name == "mlx_audio.stt.utils":
                return fake_utils
            raise ImportError(name)

        with patch("backend.transcriber.importlib.import_module", side_effect=import_module):
            transcriber = Transcriber(model_path=LOCAL_STT_MODEL)
            status = transcriber.warm()

        self.assertTrue(status["runtime_imported"])
        self.assertTrue(status["model_loaded"])
        self.assertTrue(status["warmup_ran"])
        self.assertEqual(status["engine"], "mlx-audio-plus")
        self.assertTrue(seen["exists_during_call"])
        self.assertFalse(os.path.exists(seen["path"]))
        self.assertEqual(seen["channels"], 1)
        self.assertEqual(seen["sample_width"], 2)
        self.assertEqual(seen["sample_rate"], 16000)
        self.assertEqual(seen["frames"], 8000)
        self.assertEqual(fake_utils.load_calls, [LOCAL_STT_MODEL])

    def test_cached_whisper_snapshot_uses_direct_local_loader(self):
        fake_model = FakeSttModule(result={"text": "cached local model"})
        fake_utils = FakeUtilsModule(fake_model)

        with tempfile.TemporaryDirectory() as snapshot_dir:
            weights_path = os.path.join(snapshot_dir, "model.safetensors")
            with open(weights_path, "wb") as weights_file:
                weights_file.write(b"weights")

            class FakeHubModule:
                @staticmethod
                def try_to_load_from_cache(model_path, filename):
                    if model_path == LOCAL_STT_MODEL and filename == "model.safetensors":
                        return weights_path
                    return None

            def import_module(name):
                if name == "mlx_audio.stt.utils":
                    return fake_utils
                if name == "huggingface_hub":
                    return FakeHubModule
                raise ImportError(name)

            with patch.dict(os.environ, {"ESCRIBOLT_USE_DIRECT_WHISPER_CACHE": "1"}):
                with patch("backend.transcriber.importlib.import_module", side_effect=import_module):
                    with patch.object(Transcriber, "_load_cached_whisper_model", return_value=fake_model) as load_cached:
                        transcriber = Transcriber(model_path=LOCAL_STT_MODEL)
                        with tempfile.NamedTemporaryFile(suffix=".wav") as audio_file:
                            text = transcriber.transcribe(audio_file.name)

        self.assertEqual(text, "cached local model")
        self.assertEqual(fake_utils.load_calls, [])
        load_cached.assert_called_once_with(Path(snapshot_dir))

    def test_cached_whisper_snapshot_can_disable_direct_local_loader(self):
        fake_model = FakeSttModule(result={"text": "generic cached local model"})
        fake_utils = FakeUtilsModule(fake_model)

        with tempfile.TemporaryDirectory() as snapshot_dir:
            weights_path = os.path.join(snapshot_dir, "model.safetensors")
            with open(weights_path, "wb") as weights_file:
                weights_file.write(b"weights")

            class FakeHubModule:
                @staticmethod
                def try_to_load_from_cache(model_path, filename):
                    if model_path == LOCAL_STT_MODEL and filename == "model.safetensors":
                        return weights_path
                    return None

            def import_module(name):
                if name == "mlx_audio.stt.utils":
                    return fake_utils
                if name == "huggingface_hub":
                    return FakeHubModule
                raise ImportError(name)

            with patch.dict(os.environ, {"ESCRIBOLT_USE_DIRECT_WHISPER_CACHE": "0"}):
                with patch("backend.transcriber.importlib.import_module", side_effect=import_module):
                    with patch.object(Transcriber, "_load_cached_whisper_model") as load_cached:
                        transcriber = Transcriber(model_path=LOCAL_STT_MODEL)
                        with tempfile.NamedTemporaryFile(suffix=".wav") as audio_file:
                            text = transcriber.transcribe(audio_file.name)

        self.assertEqual(text, "generic cached local model")
        self.assertEqual(fake_utils.load_calls, [Path(snapshot_dir)])
        load_cached.assert_not_called()

    def test_transcribe_extracts_string_result_text(self):
        fake_model = FakeSttModule(result="  plain string result  ")
        fake_utils = FakeUtilsModule(fake_model)

        def import_module(name):
            if name == "mlx_audio.stt.utils":
                return fake_utils
            raise ImportError(name)

        with patch("backend.transcriber.importlib.import_module", side_effect=import_module):
            transcriber = Transcriber(model_path=LOCAL_STT_MODEL)
            with tempfile.NamedTemporaryFile(suffix=".wav") as audio_file:
                text = transcriber.transcribe(audio_file.name)

        self.assertEqual(text, "plain string result")

    def test_transcribe_preprocesses_quiet_edge_silence_audio(self):
        seen = {}

        def inspect_audio_path(kwargs):
            audio_path = kwargs["audio"]
            seen["path"] = audio_path
            data, sample_rate = sf.read(audio_path, dtype="float32")
            seen["sample_rate"] = sample_rate
            seen["duration"] = len(data) / sample_rate
            seen["rms"] = float(np.sqrt(np.mean(data * data)))
            seen["exists_during_call"] = os.path.exists(audio_path)
            return {"text": "processed"}

        fake_model = FakeSttModule(on_call=inspect_audio_path)
        fake_utils = FakeUtilsModule(fake_model)
        sample_rate = 16000
        silence = np.zeros(int(sample_rate * 0.3), dtype=np.float32)
        speech = np.sin(np.linspace(0, np.pi * 12, int(sample_rate * 0.8))).astype(np.float32) * 0.01
        audio = np.concatenate([silence, speech, silence])

        def import_module(name):
            if name == "mlx_audio.stt.utils":
                return fake_utils
            raise ImportError(name)

        with tempfile.NamedTemporaryFile(suffix=".wav") as audio_file:
            sf.write(audio_file.name, audio, sample_rate, subtype="PCM_16")
            with patch.dict(os.environ, {"ESCRIBOLT_PREPROCESS_LOCAL_STT_AUDIO": "1"}):
                with patch("backend.transcriber.importlib.import_module", side_effect=import_module):
                    transcriber = Transcriber(model_path=LOCAL_STT_MODEL)
                    text = transcriber.transcribe(audio_file.name)
            self.assertNotEqual(seen["path"], audio_file.name)

        self.assertEqual(text, "processed")
        self.assertEqual(seen["sample_rate"], sample_rate)
        self.assertLessEqual(seen["duration"], len(audio) / sample_rate)
        self.assertGreater(seen["rms"], float(np.sqrt(np.mean(audio * audio))))
        self.assertTrue(seen["exists_during_call"])
        self.assertFalse(os.path.exists(seen["path"]))

    def test_audio_preprocessing_can_be_disabled(self):
        seen = {}

        def inspect_audio_path(kwargs):
            seen["path"] = kwargs["audio"]
            return {"text": "raw"}

        fake_model = FakeSttModule(on_call=inspect_audio_path)
        fake_utils = FakeUtilsModule(fake_model)

        def import_module(name):
            if name == "mlx_audio.stt.utils":
                return fake_utils
            raise ImportError(name)

        with tempfile.NamedTemporaryFile(suffix=".wav") as audio_file:
            sf.write(audio_file.name, np.zeros(16000, dtype=np.float32), 16000, subtype="PCM_16")
            with patch.dict(os.environ, {"ESCRIBOLT_PREPROCESS_LOCAL_STT_AUDIO": "0"}):
                with patch("backend.transcriber.importlib.import_module", side_effect=import_module):
                    transcriber = Transcriber(model_path=LOCAL_STT_MODEL)
                    text = transcriber.transcribe(audio_file.name)
            self.assertEqual(seen["path"], audio_file.name)

        self.assertEqual(text, "raw")

    def test_warmup_retry_clears_transient_import_failure(self):
        fake_model = FakeSttModule(result={"text": ""})
        fake_utils = FakeUtilsModule(fake_model)
        attempts = {"count": 0}

        def import_module(name):
            if name != "mlx_audio.stt.utils":
                raise ImportError(name)
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise ImportError("temporary download/import failure")
            return fake_utils

        with patch("backend.transcriber.importlib.import_module", side_effect=import_module):
            transcriber = Transcriber(model_path=LOCAL_STT_MODEL)
            with self.assertRaises(TranscriberRuntimeError):
                transcriber.warm()

            self.assertFalse(transcriber.is_runtime_imported())
            self.assertFalse(transcriber.is_model_loaded())

            status = transcriber.warm()

        self.assertEqual(attempts["count"], 2)
        self.assertTrue(status["model_loaded"])
        self.assertTrue(status["warmup_ran"])


if __name__ == "__main__":
    unittest.main()
