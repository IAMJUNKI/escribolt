import gc
import importlib

# Gemma 3 12B QAT 4-bit — best quality that fits M4 16GB alongside Whisper
# DEFAULT_MODEL = "mlx-community/gemma-3-12b-it-qat-4bit"
DEFAULT_MODEL = "mlx-community/Qwen2.5-7B-Instruct-4bit"

class Enhancer:
    def __init__(self, model_path=DEFAULT_MODEL):
        self.model_path = model_path
        self.model = None
        self.tokenizer = None
        self._load_fn = None
        self._generate_fn = None
        self._stream_generate_fn = None

    def _ensure_runtime(self):
        if self._load_fn is not None and self._generate_fn is not None:
            return
        mlx_lm = importlib.import_module("mlx_lm")
        self._load_fn = getattr(mlx_lm, "load")
        self._generate_fn = getattr(mlx_lm, "generate")

    def _ensure_stream_runtime(self):
        if self._stream_generate_fn is not None:
            return
        mlx_lm = importlib.import_module("mlx_lm")
        self._stream_generate_fn = getattr(mlx_lm, "stream_generate")

    def load_model(self):
        if not self.model:
            self._ensure_runtime()
            print(f"Loading model {self.model_path}...")
            self.model, self.tokenizer = self._load_fn(self.model_path)
            print("Model loaded.")

    def stream_completion(self, messages: list[dict], max_tokens: int = 2048):
        """Stream a generic list of chat template messages using the local MLX model."""
        try:
            self.load_model()
            self._ensure_stream_runtime()

            prompt_text = self.tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )

            # Stream generation
            for response in self._stream_generate_fn(
                self.model,
                self.tokenizer,
                prompt=prompt_text,
                max_tokens=max_tokens,
            ):
                text = response.text if hasattr(response, 'text') else str(response)
                # Filter out special tokens or chat boundaries
                if '<|' in text or 'im_end' in text or 'im_start' in text or '<|im_end|>' in text:
                    continue
                yield text

        except Exception as e:
            print(f"Local stream completion error: {e}")
            yield f"Error running local completion: {str(e)}"

    def unload_model(self):
        """Release loaded local LLM weights when idle."""
        had_model = self.model is not None or self.tokenizer is not None
        self.model = None
        self.tokenizer = None

        try:
            mx = importlib.import_module("mlx.core")
            metal = getattr(mx, "metal", None)
            clear_cache = getattr(metal, "clear_cache", None) if metal is not None else None
            if callable(clear_cache):
                clear_cache()
        except Exception:
            # Cache APIs can vary by runtime version.
            pass

        gc.collect()
        return had_model
