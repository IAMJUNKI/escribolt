const BaseLlmAdapter = require('./BaseLlmAdapter');

/**
 * HTTP LLM Adapter — makes direct API calls to OpenAI-compatible providers,
 * Anthropic, or Gemini in BYOK mode.
 * using user-provided API keys (BYOK mode).
 */
class HttpLlmAdapter extends BaseLlmAdapter {
  constructor(provider) {
    super({
      id: `http-llm-${provider}`,
      label: `${provider.toUpperCase()} LLM (BYOK)`,
      transport: 'https',
    });
    this.provider = provider;
  }

  /**
   * Build the prompt messages in the format this adapter expects.
   */
  _buildPrompt(prompt, selectedText) {
    const hasSelection = selectedText && selectedText.trim().length > 0;

    if (hasSelection) {
      return [
        'You are Escribolt\'s AI companion.',
        '',
        `Prompt:\n${prompt}`,
        '',
        `Context:\n${selectedText}`,
        '',
        'RULES:',
        '- Use the provided context to answer accurately.',
        '- Return only the final answer.',
      ].join('\n');
    }

    return [
      'You are Escribolt\'s AI companion.',
      '',
      `Prompt:\n${prompt}`,
      '',
      'RULES:',
      '- Produce the best direct response.',
      '- Return only the final answer.',
    ].join('\n');
  }

  /**
   * Non-streaming completion.
   * @param {object} options - { prompt, selectedText, apiKey, model }
   * @returns {{ text: string, usage: object }}
   */
  async execute({ prompt, selectedText, apiKey, model }) {
    if (!apiKey) {
      throw new Error(`No API key provided for ${this.provider}`);
    }

    const userContent = this._buildPrompt(prompt, selectedText);

    if (this.provider === 'gemini') {
      return this._executeGemini({ userContent, apiKey, model });
    }

    if (this.provider === 'anthropic') {
      return this._executeAnthropic({ userContent, apiKey, model });
    }

    return this._executeOpenAICompatible({ userContent, apiKey, model });
  }

  /**
   * Streaming completion.
   * @param {object} options - { prompt, selectedText, apiKey, model }
   * @param {function} onChunk - callback(text)
   * @returns {Promise<{ usage: object }>}
   */
  async executeStream({ prompt, selectedText, apiKey, model }, onChunk) {
    if (!apiKey) {
      throw new Error(`No API key provided for ${this.provider}`);
    }

    const userContent = this._buildPrompt(prompt, selectedText);

    if (this.provider === 'gemini') {
      const result = await this._executeGemini({ userContent, apiKey, model });
      if (result.text) {
        onChunk(result.text);
      }
      return { usage: result.usage || {} };
    }

    if (this.provider === 'anthropic') {
      return this._streamAnthropic({ userContent, apiKey, model }, onChunk);
    }

    return this._streamOpenAICompatible({ userContent, apiKey, model }, onChunk);
  }

  // ─── OpenAI / Groq (OpenAI-compatible API) ───

  async _executeOpenAICompatible({ userContent, apiKey, model }) {
    const baseUrl = this._getBaseUrl();
    const defaultModel = this._getDefaultModel();
    const selectedModel = model || defaultModel;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [{ role: 'user', content: userContent }],
        ...this._buildOpenAICompatibleTokenLimitParam(selectedModel, 2048),
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`${this.provider} API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      text: (choice?.message?.content || '').trim(),
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
    };
  }

  async _streamOpenAICompatible({ userContent, apiKey, model }, onChunk) {
    const baseUrl = this._getBaseUrl();
    const defaultModel = this._getDefaultModel();
    const selectedModel = model || defaultModel;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [{ role: 'user', content: userContent }],
        ...this._buildOpenAICompatibleTokenLimitParam(selectedModel, 2048),
        stream: true,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`${this.provider} streaming error ${response.status}: ${errBody}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
        if (payload === '[DONE]') continue;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            onChunk(delta);
          }
        } catch (_e) {
          // Skip malformed chunks
        }
      }
    }

    return { usage: {} };
  }

  // ─── Anthropic Claude ───

  async _executeGemini({ userContent, apiKey, model }) {
    const selectedModel = model || 'gemini-2.0-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: userContent }],
        }],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.2,
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Gemini API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const text = (data.candidates || [])
      .flatMap((candidate) => ((candidate && candidate.content && candidate.content.parts) || []))
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();

    return {
      text,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
    };
  }

  async _executeAnthropic({ userContent, apiKey, model }) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Anthropic API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    return {
      text,
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    };
  }

  async _streamAnthropic({ userContent, apiKey, model }, onChunk) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: userContent }],
        stream: true,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Anthropic streaming error ${response.status}: ${errBody}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            onChunk(parsed.delta.text);
          }
        } catch (_e) {
          // Skip malformed chunks
        }
      }
    }

    return { usage: {} };
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
        return 'llama-3.3-70b-versatile';
      case 'gemini':
        return 'gemini-2.0-flash';
      case 'openai':
      default:
        return 'gpt-5-nano';
    }
  }

  _buildOpenAICompatibleTokenLimitParam(model, maxTokens) {
    const safeMaxTokens = Math.max(1, Math.floor(Number(maxTokens) || 2048));
    if (this.provider === 'openai' && this._usesMaxCompletionTokens(model)) {
      return { max_completion_tokens: safeMaxTokens };
    }
    return { max_tokens: safeMaxTokens };
  }

  _usesMaxCompletionTokens(model) {
    const normalizedModel = String(model || '').trim().toLowerCase();
    return normalizedModel.startsWith('gpt-5')
      || normalizedModel.startsWith('o1')
      || normalizedModel.startsWith('o3')
      || normalizedModel.startsWith('o4');
  }
}

module.exports = HttpLlmAdapter;
