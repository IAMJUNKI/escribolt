const BaseLlmAdapter = require('./BaseLlmAdapter');

class LocalLlmAdapter extends BaseLlmAdapter {
  constructor() {
    super({
      id: 'local-mlx-llm',
      label: 'Local MLX LLM',
      transport: 'local',
    });
  }
}

module.exports = LocalLlmAdapter;
