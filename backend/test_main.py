import unittest

from backend.main import normalize_pro_llm_provider_id, normalize_whisper_language_code


class MainBackendTests(unittest.TestCase):
    def test_pro_llm_provider_id_normalizes_to_public_default(self):
        self.assertEqual(normalize_pro_llm_provider_id(None), "escribolt")
        self.assertEqual(normalize_pro_llm_provider_id(""), "escribolt")
        self.assertEqual(normalize_pro_llm_provider_id(" Escribolt "), "escribolt")
        self.assertEqual(normalize_pro_llm_provider_id("custom-provider"), "custom-provider")

    def test_whisper_language_code_normalizes_regional_codes(self):
        self.assertIsNone(normalize_whisper_language_code(None))
        self.assertIsNone(normalize_whisper_language_code(""))
        self.assertIsNone(normalize_whisper_language_code("auto"))
        self.assertEqual(normalize_whisper_language_code(" es-419 "), "es")
        self.assertEqual(normalize_whisper_language_code("en_US"), "en")
        self.assertEqual(normalize_whisper_language_code("pt-BR"), "pt")
        self.assertEqual(normalize_whisper_language_code("zh-Hant"), "zh")


if __name__ == "__main__":
    unittest.main()
