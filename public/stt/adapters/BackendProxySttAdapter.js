const BaseSttAdapter = require('./BaseSttAdapter');
const { fetchWithTimeout } = require('./fetchWithTimeout');

const PRO_STT_TRANSCRIBE_TIMEOUT_MS = 90000;
const PRO_STT_CONTROL_TIMEOUT_MS = 20000;

/**
 * Backend Proxy STT Adapter — routes STT requests through our
 * authenticated Business server for PRO tier users.
 */
class BackendProxySttAdapter extends BaseSttAdapter {
  constructor() {
    super({
      id: 'backend-proxy-stt',
      label: 'Backend Proxy STT (PRO)',
      transport: 'https',
      supportsRealtime: true,
      supportsBatch: true,
    });
    this.serverUrl = process.env.ESCRIBOLT_BACKEND_URL || 'http://localhost:4000';
    this.preferDirectStt = process.env.ESCRIBOLT_PRO_STT_PREFER_DIRECT !== '0';
  }

  async _issueCapability({ baseUrl, jwt, action, provider = 'deepgram', maxUnits = null, deviceIdHash = '', metadata = {} }) {
    const normalizedDeviceIdHash = typeof deviceIdHash === 'string' ? deviceIdHash.trim() : '';
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
    };
    if (normalizedDeviceIdHash) {
      headers['X-Device-Id-Hash'] = normalizedDeviceIdHash;
    }

    const response = await fetchWithTimeout(`${baseUrl}/api/capabilities/issue`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        service: 'stt',
        action,
        provider,
        maxUnits,
        metadata,
        ...(normalizedDeviceIdHash ? { deviceIdHash: normalizedDeviceIdHash } : {}),
      }),
    }, {
      timeoutMs: PRO_STT_CONTROL_TIMEOUT_MS,
      label: `PRO STT ${action} capability request`,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`PRO STT capability issue error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const token = data?.capability?.token;
    if (!token) {
      throw new Error('Capability issue response missing token');
    }
    return token;
  }

  buildSessionConfig(context = {}) {
    return {
      ...super.buildSessionConfig(context),
      detectLanguage: true,
    };
  }

  /**
   * Batch transcribe an audio file via Business server proxy.
   * @param {string} audioPath - Path to audio file
   * @param {object} options - { jwt, language, model, serverUrl, deviceIdHash }
   * @returns {{ text: string }}
   */
  async transcribeBatch(audioPath, options = {}) {
    const {
      jwt,
      language,
      model,
      serverUrl,
      deviceIdHash = '',
    } = options;
    const baseUrl = serverUrl || this.serverUrl;
    const fs = require('fs');
    const normalizedDeviceIdHash = typeof deviceIdHash === 'string' ? deviceIdHash.trim() : '';

    if (!jwt) {
      throw new Error('No JWT token provided for PRO STT');
    }

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const audioBuffer = fs.readFileSync(audioPath);

    // Build multipart form data
    const { FormData, File } = await this._getFormDataPolyfill();
    const path = require('path');
    const createFormData = () => {
      const formData = new FormData();
      formData.append('audio', new File([audioBuffer], path.basename(audioPath), { type: 'audio/wav' }));
      return formData;
    };

    const queryParams = new URLSearchParams();
    if (language) queryParams.set('language', language);
    if (model) queryParams.set('model', model);

    const url = `${baseUrl}/api/stt/transcribe${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

    const directHeaders = {
      'Authorization': `Bearer ${jwt}`,
      ...(normalizedDeviceIdHash ? { 'X-Device-Id-Hash': normalizedDeviceIdHash } : {}),
    };

    const callDirect = () => fetchWithTimeout(url, {
      method: 'POST',
      headers: directHeaders,
      body: createFormData(),
    }, {
      timeoutMs: PRO_STT_TRANSCRIBE_TIMEOUT_MS,
      label: 'PRO STT direct transcription request',
    });

    const callRelay = async () => {
      const capabilityToken = await this._issueCapability({
        baseUrl,
        jwt,
        action: 'transcribe',
        maxUnits: Number(audioBuffer.length || 0),
        deviceIdHash: normalizedDeviceIdHash,
        metadata: {
          ...(model ? { model } : {}),
          ...(language ? { language } : {}),
        },
      });

      return fetchWithTimeout(`${baseUrl}/api/relay/stt/transcribe${queryParams.toString() ? '?' + queryParams.toString() : ''}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${capabilityToken}`,
          ...(normalizedDeviceIdHash ? { 'X-Device-Id-Hash': normalizedDeviceIdHash } : {}),
        },
        body: createFormData(),
      }, {
        timeoutMs: PRO_STT_TRANSCRIBE_TIMEOUT_MS,
        label: 'PRO STT relay transcription request',
      });
    };

    let response;
    if (this.preferDirectStt) {
      try {
        response = await callDirect();
      } catch (_directError) {
        response = await callRelay();
      }
    } else {
      try {
        response = await callRelay();
      } catch (_relayError) {
        // Backward-compatible fallback while migrating server deployments.
        response = await callDirect();
      }
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`PRO STT error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    return {
      text: (data.text || '').trim(),
      confidence: data.confidence || 0,
      duration: data.duration || 0,
      detectedLanguage: data.detectedLanguage || null,
      model: data.model || model || null,
      language: data.language || language || null,
    };
  }

  /**
   * Get a temporary Deepgram WebSocket token from our server.
   * @param {object} options - { jwt, serverUrl, deviceIdHash, streamingProfile, language }
   * @returns {{ key: string, expiresAt: number }}
   */
  async getWsToken(options = {}) {
    const {
      jwt,
      serverUrl,
      deviceIdHash = '',
      streamingProfile = 'nova3-multilingual',
      language = '',
    } = options;
    const baseUrl = serverUrl || this.serverUrl;
    const normalizedDeviceIdHash = typeof deviceIdHash === 'string' ? deviceIdHash.trim() : '';

    if (!jwt) {
      throw new Error('No JWT token provided for PRO STT WebSocket');
    }

    const queryParams = new URLSearchParams();
    if (streamingProfile) queryParams.set('streamingProfile', streamingProfile);
    if (language) queryParams.set('language', language);
    const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';

    let response;
    try {
      const capabilityToken = await this._issueCapability({
        baseUrl,
        jwt,
        action: 'ws-token',
        deviceIdHash: normalizedDeviceIdHash,
        metadata: {
          streamingProfile,
          ...(language ? { language } : {}),
        },
      });

      response = await fetchWithTimeout(`${baseUrl}/api/relay/stt/ws-token${queryString}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${capabilityToken}`,
          ...(normalizedDeviceIdHash ? { 'X-Device-Id-Hash': normalizedDeviceIdHash } : {}),
        },
      }, {
        timeoutMs: PRO_STT_CONTROL_TIMEOUT_MS,
        label: 'PRO STT relay WebSocket token request',
      });
    } catch (relayError) {
      const message = relayError && relayError.message ? relayError.message : String(relayError || 'unknown error');
      console.warn(`[BackendProxySttAdapter] Relay WebSocket token request failed; falling back to direct endpoint: ${message}`);
      // Backward-compatible fallback while migrating server deployments.
      response = await fetchWithTimeout(`${baseUrl}/api/stt/ws-token${queryString}`, {
        headers: {
          'Authorization': `Bearer ${jwt}`,
          ...(normalizedDeviceIdHash ? { 'X-Device-Id-Hash': normalizedDeviceIdHash } : {}),
        },
      }, {
        timeoutMs: PRO_STT_CONTROL_TIMEOUT_MS,
        label: 'PRO STT direct WebSocket token request',
      });
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`PRO STT WebSocket token error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    return {
      key: data.key,
      expiresAt: data.expiresAt,
      authType: data.authType === 'bearer' ? 'bearer' : 'token',
      model: data.model || 'nova-3',
      language: data.language || (streamingProfile === 'nova3-monolingual' ? language : 'multi'),
      endpoint: data.endpoint || 'wss://api.deepgram.com/v1/listen',
      streamingProfile: data.streamingProfile || streamingProfile,
    };
  }

  async _getFormDataPolyfill() {
    if (typeof globalThis.FormData !== 'undefined' && typeof globalThis.File !== 'undefined') {
      return { FormData: globalThis.FormData, File: globalThis.File };
    }
    const { FormData, File } = await import('undici');
    return { FormData, File };
  }
}

module.exports = BackendProxySttAdapter;
