class BaseLlmAdapter {
  constructor(config) {
    this.id = config.id;
    this.label = config.label;
    this.transport = config.transport;
  }

  describe() {
    return {
      id: this.id,
      label: this.label,
      transport: this.transport,
    };
  }
}

module.exports = BaseLlmAdapter;
