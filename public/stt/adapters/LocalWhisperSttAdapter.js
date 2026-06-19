const BaseSttAdapter = require('./BaseSttAdapter');

class LocalWhisperSttAdapter extends BaseSttAdapter {
  constructor() {
    super({
      id: 'local-whisper',
      label: 'Local Whisper (large-v3-turbo 4-bit MLX)',
      transport: 'local',
      supportsRealtime: false,
      supportsBatch: true,
    });
  }

  buildSessionConfig(context = {}) {
    return {
      ...super.buildSessionConfig(context),
      detectLanguage: true,
      modelSource: 'mlx-community/whisper-large-v3-turbo-4bit',
      notes: 'Uses mlx-audio-plus with local MLX Whisper weights.',
    };
  }
}

module.exports = LocalWhisperSttAdapter;
