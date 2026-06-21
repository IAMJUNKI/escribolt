import os
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from backend.transcriber import Transcriber, TranscriberRuntimeError


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

            with patch("backend.transcriber.importlib.import_module", side_effect=import_module):
                with patch.object(Transcriber, "_load_cached_whisper_model", return_value=fake_model) as load_cached:
                    transcriber = Transcriber(model_path=LOCAL_STT_MODEL)
                    with tempfile.NamedTemporaryFile(suffix=".wav") as audio_file:
                        text = transcriber.transcribe(audio_file.name)

        self.assertEqual(text, "cached local model")
        self.assertEqual(fake_utils.load_calls, [])
        load_cached.assert_called_once_with(Path(snapshot_dir))

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
