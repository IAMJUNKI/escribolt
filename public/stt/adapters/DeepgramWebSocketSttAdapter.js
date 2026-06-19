const BaseSttAdapter = require('./BaseSttAdapter');
const { fetchWithTimeout } = require('./fetchWithTimeout');

const DEEPGRAM_BATCH_TIMEOUT_MS = 90000;
const DEEPGRAM_NOVA3_BATCH_MODEL = 'nova-3';
const DEEPGRAM_NOVA3_BATCH_LANGUAGE = 'multi';

function resolveDeepgramBatchLanguage(model = DEEPGRAM_NOVA3_BATCH_MODEL, language = null) {
  const explicitLanguage = typeof language === 'string' ? language.trim() : '';
  if (explicitLanguage) {
    return explicitLanguage;
  }
  return String(model || '').trim().toLowerCase() === DEEPGRAM_NOVA3_BATCH_MODEL
    ? DEEPGRAM_NOVA3_BATCH_LANGUAGE
    : null;
}

/**
 * Deepgram WebSocket STT Adapter — connects to Deepgram's real-time
 * and pre-recorded transcription APIs using user-provided keys (BYOK)
 * or server-issued temporary keys (PRO).
 */
class DeepgramWebSocketSttAdapter extends BaseSttAdapter {
  constructor() {
    super({
      id: 'deepgram-websocket',
      label: 'Deepgram WebSocket',
      transport: 'websocket',
      supportsRealtime: true,
      supportsBatch: true,
    });
  }

  buildSessionConfig(context = {}) {
    return {
      ...super.buildSessionConfig(context),
      endpoint: 'wss://api.deepgram.com/v1/listen',
      model: 'nova-3',
      language: 'multi',
      detectLanguage: false,
      realtimeTargetTtfbMs: 300,
    };
  }

  _buildRealtimeQueryParams(options = {}) {
    const {
      language = 'multi',
      keyterms = [],
      model = 'nova-3',
      smartFormat = true,
      interimResults = true,
      endpointing = 100,
    } = options;
    const normalizedLanguage = String(language || '').trim() || 'multi';
    const normalizedKeyterms = Array.isArray(keyterms)
      ? keyterms
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
      : [];
    const queryParams = new URLSearchParams({
      model,
      language: normalizedLanguage,
      encoding: 'linear16',
      sample_rate: '16000',
      smart_format: smartFormat === false ? 'false' : 'true',
      interim_results: interimResults === false ? 'false' : 'true',
      endpointing: String(Number.isFinite(Number(endpointing)) ? Number(endpointing) : 100),
    });

    normalizedKeyterms.forEach((entry) => queryParams.append('keyterm', entry));
    return {
      queryParams,
      normalizedLanguage,
      normalizedKeyterms,
    };
  }

  buildRealtimeUrl(options = {}) {
    const endpoint = String(options.endpoint || '').trim() || 'wss://api.deepgram.com/v1/listen';
    const { queryParams } = this._buildRealtimeQueryParams(options);
    return `${endpoint}?${queryParams.toString()}`;
  }

  /**
   * Batch transcribe an audio file using Deepgram's pre-recorded API.
   * @param {string} audioPath - Path to audio file
   * @param {object} options - { apiKey, language, model }
   * @returns {{ text: string, confidence: number, duration: number }}
   */
  async transcribeBatch(audioPath, options = {}) {
    const { apiKey, model = DEEPGRAM_NOVA3_BATCH_MODEL } = options;
    const language = resolveDeepgramBatchLanguage(model, options.language);
    const fs = require('fs');

    if (!apiKey) {
      throw new Error('No Deepgram API key provided');
    }

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const audioBuffer = fs.readFileSync(audioPath);

    return this.transcribeBuffer(audioBuffer, { apiKey, language, model });
  }

  /**
   * Batch transcribe from a buffer using Deepgram's pre-recorded API.
   * @param {Buffer} audioBuffer - Raw audio data
   * @param {object} options - { apiKey, language, model, mimetype }
   * @returns {{ text: string, confidence: number, duration: number }}
   */
  async transcribeBuffer(audioBuffer, options = {}) {
    const { apiKey, model = DEEPGRAM_NOVA3_BATCH_MODEL, mimetype = 'audio/wav' } = options;
    const language = resolveDeepgramBatchLanguage(model, options.language);

    if (!apiKey) {
      throw new Error('No Deepgram API key provided');
    }

    const queryParams = new URLSearchParams({
      model,
      smart_format: 'true',
    });

    if (language) {
      queryParams.set('language', language);
    } else {
      queryParams.set('detect_language', 'true');
    }

    const response = await fetchWithTimeout(
      `https://api.deepgram.com/v1/listen?${queryParams.toString()}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': mimetype,
        },
        body: audioBuffer,
      },
      {
        timeoutMs: DEEPGRAM_BATCH_TIMEOUT_MS,
        label: 'Deepgram batch transcription request',
      }
    );

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Deepgram API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const channel = data.results?.channels?.[0];
    const alternative = channel?.alternatives?.[0];

    return {
      text: (alternative?.transcript || '').trim(),
      confidence: alternative?.confidence || 0,
      duration: data.metadata?.duration || 0,
      detectedLanguage: channel?.detected_language || null,
      model,
      language: language || null,
    };
  }

  /**
   * Open a WebSocket connection for real-time transcription.
   * Returns an object with send(audioChunk) and close() methods.
   *
   * @param {object} options - { apiKey, authType, language, keyterms, model, endpoint, onTranscript, onTurnInfo, onError, onClose }
   * @returns {{ send: function, close: function }}
   */
  connectRealtime(options = {}) {
    const {
      apiKey,
      authType = 'auto',
      language = 'multi',
      keyterms = [],
      model = 'nova-3',
      endpoint = 'wss://api.deepgram.com/v1/listen',
      onTranscript,
      onTurnInfo,
      onError,
      onClose,
    } = options;
    const WebSocket = require('ws');

    if (!apiKey) {
      throw new Error('No Deepgram API key provided');
    }

    const {
      queryParams,
      normalizedLanguage,
      normalizedKeyterms,
    } = this._buildRealtimeQueryParams({
      model,
      language,
      keyterms,
    });
    const wsUrl = `${endpoint}?${queryParams.toString()}`;
    console.log(`[DeepgramNova3WS] Opening stream model=${model} language=${normalizedLanguage} keyterms=${JSON.stringify(normalizedKeyterms)}`);

    const normalizedAuthType = authType === 'bearer' || authType === 'token'
      ? authType
      : String(apiKey).split('.').length === 3
        ? 'bearer'
        : 'token';
    const authorizationHeader = normalizedAuthType === 'bearer'
      ? `Bearer ${apiKey}`
      : `Token ${apiKey}`;

    const ws = new WebSocket(
      wsUrl,
      { headers: { Authorization: authorizationHeader } }
    );
    let closeRequested = false;
    let closeTimer = null;
    let readyTimer = null;
    const pendingAudioChunks = [];
    let resolveClosePromise;
    let resolveReadyPromise;
    let rejectReadyPromise;
    const closePromise = new Promise((resolve) => {
      resolveClosePromise = resolve;
    });
    const readyPromise = new Promise((resolve, reject) => {
      resolveReadyPromise = resolve;
      rejectReadyPromise = reject;
    });
    const markReadyFailed = (error) => {
      if (rejectReadyPromise) {
        rejectReadyPromise(error instanceof Error ? error : new Error(String(error || 'Deepgram Nova-3 websocket connection failed')));
        rejectReadyPromise = null;
        resolveReadyPromise = null;
      }
    };

    readyTimer = setTimeout(() => {
      readyTimer = null;
      markReadyFailed(new Error('Timed out waiting for Deepgram Nova-3 websocket connection'));
    }, 8000);

    ws.on('open', () => {
      console.log('[DeepgramNova3WS] Connected');
      while (pendingAudioChunks.length) {
        ws.send(pendingAudioChunks.shift());
      }
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      if (resolveReadyPromise) {
        resolveReadyPromise();
        resolveReadyPromise = null;
        rejectReadyPromise = null;
      }
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'TurnInfo') {
          const transcript = typeof msg.transcript === 'string' ? msg.transcript : '';
          const eventType = typeof msg.event === 'string' ? msg.event : '';
          const turnIndex = Number.isInteger(msg.turn_index) ? msg.turn_index : null;
          if (onTurnInfo) {
            onTurnInfo({
              text: transcript,
              confidence: typeof msg.end_of_turn_confidence === 'number' ? msg.end_of_turn_confidence : 0,
              isFinal: eventType === 'EndOfTurn',
              speechFinal: eventType === 'EndOfTurn',
              eventType,
              turnIndex,
              raw: msg,
            });
          }
          if (onTranscript) {
            onTranscript({
              text: transcript,
              confidence: typeof msg.end_of_turn_confidence === 'number' ? msg.end_of_turn_confidence : 0,
              isFinal: eventType === 'EndOfTurn',
              speechFinal: eventType === 'EndOfTurn',
              eventType,
              turnIndex,
              raw: msg,
            });
          }
        } else if (msg.type === 'Results') {
          const alternative = msg.channel?.alternatives?.[0];
          if (alternative && onTranscript) {
            onTranscript({
              text: alternative.transcript || '',
              confidence: alternative.confidence || 0,
              isFinal: msg.is_final || false,
              speechFinal: msg.speech_final || false,
              eventType: msg.speech_final ? 'EndOfTurn' : 'Update',
              turnIndex: null,
              raw: msg,
            });
          }
        } else if (msg.type === 'Error') {
          const description = typeof msg.description === 'string' ? msg.description : 'Deepgram Nova-3 runtime error';
          if (onError) onError(new Error(description));
        }
      } catch (err) {
        console.error('[DeepgramNova3WS] Parse error:', err);
      }
    });

    ws.on('unexpected-response', (_request, response) => {
      const chunks = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8'));
      });
      response.on('end', () => {
        const statusCode = response.statusCode || 0;
        const statusMessage = String(response.statusMessage || '').trim();
        const body = Buffer.concat(chunks).toString('utf8').trim();
        const errParts = [
          `Deepgram Nova-3 handshake failed (${statusCode}${statusMessage ? ` ${statusMessage}` : ''})`,
        ];
        if (body) {
          errParts.push(body);
        }
        const err = new Error(errParts.join(': '));
        markReadyFailed(err);
        if (onError) onError(err);
      });
    });

    ws.on('error', (err) => {
      console.error('[DeepgramNova3WS] Error:', err);
      markReadyFailed(err);
      if (onError) onError(err);
    });

    ws.on('close', (code, reason) => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      if (code !== 1000) {
        markReadyFailed(new Error(`Deepgram Nova-3 websocket closed before ready (code ${code})`));
      }
      const reasonText = Buffer.isBuffer(reason) ? reason.toString() : String(reason || '');
      const expectedClose = closeRequested === true;
      if (expectedClose && (code === 1000 || code === 1005)) {
        console.log(`[DeepgramNova3WS] Closed after CloseStream: ${code} ${reasonText}`);
      } else {
        console.warn(`[DeepgramNova3WS] Closed${expectedClose ? '' : ' unexpectedly'}: ${code} ${reasonText}`);
      }
      if (!expectedClose && code !== 1000 && onError) {
        const suffix = reasonText ? `: ${reasonText}` : '';
        onError(new Error(`Deepgram Nova-3 websocket closed unexpectedly (code ${code}${suffix})`));
      }
      if (onClose) onClose(code, reasonText, { expectedClose });
      if (resolveClosePromise) {
        resolveClosePromise({ code, reason: reasonText });
      }
    });

    return {
      send: (audioChunk) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(audioChunk);
        } else if (ws.readyState === WebSocket.CONNECTING) {
          pendingAudioChunks.push(audioChunk);
        }
      },
      close: () => {
        if (closeRequested) {
          return closePromise;
        }
        closeRequested = true;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'CloseStream' }));
          closeTimer = setTimeout(() => {
            if (ws.readyState !== WebSocket.CLOSED) {
              ws.close();
            }
          }, 8000);
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        return closePromise;
      },
      waitForReady: () => readyPromise,
      waitForClose: () => closePromise,
      getState: () => ws.readyState,
    };
  }
}

module.exports = DeepgramWebSocketSttAdapter;
