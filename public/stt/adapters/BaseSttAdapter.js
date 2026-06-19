class BaseSttAdapter {
  constructor(config) {
    this.id = config.id;
    this.label = config.label;
    this.transport = config.transport;
    this.supportsRealtime = !!config.supportsRealtime;
    this.supportsBatch = !!config.supportsBatch;
  }

  describe() {
    return {
      id: this.id,
      label: this.label,
      transport: this.transport,
      supportsRealtime: this.supportsRealtime,
      supportsBatch: this.supportsBatch,
    };
  }

  buildSessionConfig(context) {
    return {
      adapterId: this.id,
      transport: this.transport,
      context,
    };
  }

  async transcribeRealtime() {
    throw new Error(`[${this.id}] Realtime transcription is not wired yet.`);
  }

  async transcribeBatch() {
    throw new Error(`[${this.id}] Batch transcription is not wired yet.`);
  }
}

module.exports = BaseSttAdapter;
