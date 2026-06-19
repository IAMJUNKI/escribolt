const BaseLlmAdapter = require('./BaseLlmAdapter');

/**
 * Backend Proxy LLM Adapter — routes LLM requests through our
 * authenticated Business server for PRO tier users.
 */
class BackendProxyLlmAdapter extends BaseLlmAdapter {
  constructor() {
    super({
      id: 'backend-proxy-llm',
      label: 'Backend Proxy LLM (PRO)',
      transport: 'https',
    });
    this.serverUrl = process.env.ESCRIBOLT_BACKEND_URL || 'http://localhost:4000';
    this.proProviderId = process.env.ESCRIBOLT_PRO_LLM_PROVIDER_ID || 'escribolt';
  }

  async _issueCapability({ baseUrl, jwt, provider, action, metadata = {}, deviceIdHash }) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
    };
    if (deviceIdHash) {
      headers['X-Device-Id-Hash'] = deviceIdHash;
    }

    const response = await fetch(`${baseUrl}/api/capabilities/issue`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        service: 'llm',
        action,
        provider,
        metadata,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`PRO capability issue error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const token = data?.capability?.token;
    if (!token) {
      throw new Error('Capability issue response missing token');
    }
    return token;
  }

  _buildStructuredBody({ prompt, selectedText, transcript, question, selectedContext, notes, recordings, pastChats, spaceSearchResults, chatHistory, provider, model, modelAlias, actionType, maxTokens, summaryLanguage }) {
    const body = {
      actionType,
      provider,
      modelAlias,
      model,
    };
    if (Number.isFinite(Number(maxTokens))) {
      body.maxTokens = Number(maxTokens);
    }
    if (typeof question === 'string') {
      body.question = question;
    }
    if (typeof selectedText === 'string') {
      body.selectedText = selectedText;
    }
    if (typeof transcript === 'string') {
      body.transcript = transcript;
    }
    if (typeof selectedContext === 'string') {
      body.selectedContext = selectedContext;
    }
    if (typeof summaryLanguage === 'string') {
      body.summaryLanguage = summaryLanguage;
    }
    if (Array.isArray(notes)) {
      body.notes = notes;
    }
    if (Array.isArray(recordings)) {
      body.recordings = recordings;
    }
    if (typeof pastChats === 'string' || Array.isArray(pastChats)) {
      body.pastChats = pastChats;
    }
    if (typeof spaceSearchResults === 'string' || Array.isArray(spaceSearchResults)) {
      body.spaceSearchResults = spaceSearchResults;
    }
    if (Array.isArray(chatHistory)) {
      body.chatHistory = chatHistory;
    }
    if (!body.question && !body.selectedText && !body.notes && !body.recordings && typeof prompt === 'string') {
      body.prompt = prompt;
    }
    return body;
  }

  /**
   * Non-streaming agent transform via Business server.
   * @param {object} options - { prompt, selectedText, jwt, provider, model, serverUrl }
   * @returns {{ text: string, usage: object }}
   */
  async execute({ prompt, selectedText, transcript, question, selectedContext, notes, recordings, pastChats, spaceSearchResults, chatHistory, jwt, provider = null, model, modelAlias = null, serverUrl, aiActionType = 'unknown', actionType = null, maxTokens, deviceIdHash, summaryLanguage }) {
    const baseUrl = serverUrl || this.serverUrl;
    const resolvedProvider = provider || this.proProviderId;
    const resolvedModelAlias = modelAlias || model || null;
    const resolvedActionType = actionType || aiActionType;

    if (!jwt) {
      throw new Error('No JWT token provided for PRO LLM');
    }

    const capabilityToken = await this._issueCapability({
      baseUrl,
      jwt,
      provider: resolvedProvider,
      action: 'transform',
      metadata: {
        intent: resolvedActionType,
        actionType: resolvedActionType,
        aiActionType: resolvedActionType,
        ...(resolvedModelAlias ? { modelAlias: resolvedModelAlias } : {}),
      },
      deviceIdHash,
    });

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${capabilityToken}`,
    };
    if (deviceIdHash) {
      headers['X-Device-Id-Hash'] = deviceIdHash;
    }

    const response = await fetch(`${baseUrl}/api/relay/llm/transform`, {
      method: 'POST',
      headers,
      body: JSON.stringify(this._buildStructuredBody({
        prompt,
        selectedText,
        transcript,
        question,
        selectedContext,
        notes,
        recordings,
        pastChats,
        spaceSearchResults,
        chatHistory,
        provider: resolvedProvider,
        modelAlias: resolvedModelAlias,
        model,
        actionType: resolvedActionType,
        maxTokens,
        summaryLanguage,
      })),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`PRO LLM relay error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    return {
      text: data.text || '',
      usage: data.usage || {},
      provider: data.provider || resolvedProvider,
    };
  }

  /**
   * Streaming agent transform via Business server (SSE).
   * @param {object} options - { prompt, selectedText, jwt, provider, model, serverUrl }
   * @param {function} onChunk - callback(text)
   * @returns {Promise<{ usage: object }>}
   */
  async executeStream({ prompt, selectedText, transcript, question, selectedContext, notes, recordings, pastChats, spaceSearchResults, chatHistory, jwt, provider = null, model, modelAlias = null, serverUrl, aiActionType = 'unknown', actionType = null, maxTokens, deviceIdHash, summaryLanguage }, onChunk) {
    const baseUrl = serverUrl || this.serverUrl;
    const resolvedProvider = provider || this.proProviderId;
    const resolvedModelAlias = modelAlias || model || null;
    const resolvedActionType = actionType || aiActionType;

    if (!jwt) {
      throw new Error('No JWT token provided for PRO LLM streaming');
    }

    const capabilityToken = await this._issueCapability({
      baseUrl,
      jwt,
      provider: resolvedProvider,
      action: 'stream',
      metadata: {
        intent: resolvedActionType,
        actionType: resolvedActionType,
        aiActionType: resolvedActionType,
        ...(resolvedModelAlias ? { modelAlias: resolvedModelAlias } : {}),
      },
      deviceIdHash,
    });

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${capabilityToken}`,
    };
    if (deviceIdHash) {
      headers['X-Device-Id-Hash'] = deviceIdHash;
    }

    const response = await fetch(`${baseUrl}/api/relay/llm/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(this._buildStructuredBody({
        prompt,
        selectedText,
        transcript,
        question,
        selectedContext,
        notes,
        recordings,
        pastChats,
        spaceSearchResults,
        chatHistory,
        provider: resolvedProvider,
        modelAlias: resolvedModelAlias,
        model,
        actionType: resolvedActionType,
        maxTokens,
        summaryLanguage,
      })),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`PRO LLM streaming error ${response.status}: ${errBody}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);

        try {
          const parsed = JSON.parse(payload);
          if (parsed.event === 'chunk' && parsed.text) {
            onChunk(parsed.text);
          } else if (parsed.event === 'done') {
            usage = parsed.usage || {};
          }
        } catch (_e) {
          // Skip malformed chunks
        }
      }
    }

    return { usage };
  }
}

module.exports = BackendProxyLlmAdapter;
