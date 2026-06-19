const BaseSttAdapter = require('./BaseSttAdapter');
const fs = require('fs');
const path = require('path');
const { fetchWithTimeout } = require('./fetchWithTimeout');

const HTTP_BATCH_TIMEOUT_MS = 90000;

/**
 * HTTP REST STT Adapter — makes direct API calls to OpenAI or Groq
 * for batch audio transcription using user-provided API keys (BYOK mode).
 */
class HttpRestSttAdapter extends BaseSttAdapter {
  constructor(provider) {
    super({
      id: `http-rest-${provider}`,
      label: `${provider.toUpperCase()} HTTP REST`,
      transport: 'http-rest',
      supportsRealtime: false,
      supportsBatch: true,
    });
    this.provider = provider;
  }

  buildSessionConfig(context = {}) {
    return {
      ...super.buildSessionConfig(context),
      provider: this.provider,
      contentType: 'multipart/form-data',
      detectLanguage: true,
    };
  }

  /**
   * Transcribe an audio file via HTTP multipart upload.
   * @param {string} audioPath - Path to the audio file
   * @param {object} options - { apiKey, language, model }
   * @returns {{ text: string }}
   */
  async transcribeBatch(audioPath, options = {}) {
    const { apiKey, language, model } = options;

    if (!apiKey) {
      throw new Error(`No API key provided for ${this.provider}`);
    }

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const baseUrl = this._getBaseUrl();
    const defaultModel = this._getDefaultModel();

    // Read audio file
    const audioBuffer = fs.readFileSync(audioPath);
    const fileName = path.basename(audioPath);

    // Build multipart form data
    const { FormData, File } = await this._getFormDataPolyfill();
    const formData = new FormData();
    formData.append('file', new File([audioBuffer], fileName, { type: 'audio/wav' }));
    formData.append('model', model || defaultModel);

    if (language) {
      formData.append('language', language);
    }

    const response = await fetchWithTimeout(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    }, {
      timeoutMs: HTTP_BATCH_TIMEOUT_MS,
      label: `${this.provider} batch transcription request`,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`${this.provider} STT error ${response.status}: ${errBody}`);
    }

    const data = await response.json();

    return {
      text: (data.text || '').trim(),
    };
  }

  /**
   * Transcribe from a buffer (alternative to file path).
   * @param {Buffer} audioBuffer - Raw audio data
   * @param {object} options - { apiKey, language, model, mimetype }
   * @returns {{ text: string }}
   */
  async transcribeBuffer(audioBuffer, options = {}) {
    const { apiKey, language, model, mimetype = 'audio/wav' } = options;

    if (!apiKey) {
      throw new Error(`No API key provided for ${this.provider}`);
    }

    const baseUrl = this._getBaseUrl();
    const defaultModel = this._getDefaultModel();

    const { FormData, File } = await this._getFormDataPolyfill();
    const formData = new FormData();
    formData.append('file', new File([audioBuffer], 'audio.wav', { type: mimetype }));
    formData.append('model', model || defaultModel);

    if (language) {
      formData.append('language', language);
    }

    const response = await fetchWithTimeout(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    }, {
      timeoutMs: HTTP_BATCH_TIMEOUT_MS,
      label: `${this.provider} batch transcription request`,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`${this.provider} STT error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    return {
      text: (data.text || '').trim(),
    };
  }

  // ─── Helpers ───

  _getBaseUrl() {
    switch (this.provider) {
      case 'groq':
        return 'https://api.groq.com/openai/v1';
      case 'openai':
      default:
        return 'https://api.openai.com/v1';
    }
  }

  _getDefaultModel() {
    switch (this.provider) {
      case 'groq':
        return 'whisper-large-v3-turbo';
      case 'openai':
      default:
        return 'whisper-1';
    }
  }

  async _getFormDataPolyfill() {
    // In Node/Electron, use the built-in global FormData and File
    if (typeof globalThis.FormData !== 'undefined' && typeof globalThis.File !== 'undefined') {
      return { FormData: globalThis.FormData, File: globalThis.File };
    }
    // Fallback for older Node versions
    const { FormData, File } = await import('undici');
    return { FormData, File };
  }
}

module.exports = HttpRestSttAdapter;
