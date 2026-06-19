const LocalWhisperSttAdapter = require('./adapters/LocalWhisperSttAdapter');
const DeepgramWebSocketSttAdapter = require('./adapters/DeepgramWebSocketSttAdapter');
const HttpRestSttAdapter = require('./adapters/HttpRestSttAdapter');
const BackendProxySttAdapter = require('./adapters/BackendProxySttAdapter');

function normalizeProcessingLocation(value, fallback = 'local') {
  if (value === 'cloud' || value === 'local') {
    return value;
  }
  return fallback === 'cloud' ? 'cloud' : 'local';
}

function normalizeStreamingProfile(value) {
  return value === 'nova3-monolingual' ? 'nova3-monolingual' : 'nova3-multilingual';
}

function normalizeStreamingLanguage(profile, language) {
  if (profile !== 'nova3-monolingual') {
    return 'multi';
  }
  const normalized = String(language || '').trim();
  return normalized || 'en';
}

function hasByokKey(aiEngine = {}, provider = '') {
  const keyMeta = aiEngine.apiKeys && typeof aiEngine.apiKeys === 'object' ? aiEngine.apiKeys : {};
  const entry = keyMeta && typeof keyMeta[provider] === 'object' ? keyMeta[provider] : null;
  return !!(entry && entry.present === true);
}

function shouldUseByokStt(settings = {}) {
  const aiEngine = settings.aiEngine || {};
  const provider = aiEngine.sttProvider === 'openai' || aiEngine.sttProvider === 'groq'
    ? aiEngine.sttProvider
    : 'deepgram';
  return hasByokKey(aiEngine, provider);
}

function resolveEffectiveSttMode(settings = {}, intent = 'transcription') {
  const modes = settings.processingModes && typeof settings.processingModes === 'object'
    ? settings.processingModes
    : {};
  const feature = intent === 'record' || intent === 'meeting-transcription'
    ? 'meetingTranscription'
    : 'dictation';
  const location = normalizeProcessingLocation(
    modes[feature],
    'local'
  );

  if (location === 'local') {
    return 'local';
  }
  return shouldUseByokStt(settings) ? 'byok' : 'pro';
}

class SttRouter {
  constructor({ getSettings }) {
    this.getSettings = getSettings;
    this.localAdapter = new LocalWhisperSttAdapter();
    this.deepgramAdapter = new DeepgramWebSocketSttAdapter();
    this.proAdapter = new BackendProxySttAdapter();
    this.httpAdapters = {
      openai: new HttpRestSttAdapter('openai'),
      groq: new HttpRestSttAdapter('groq'),
    };
  }

  resolveRoute({ intent = 'transcription', preferBatch = null } = {}) {
    const settings = this.getSettings ? this.getSettings() : {};
    const mode = resolveEffectiveSttMode(settings, intent);
    const sttProvider = (settings.aiEngine && settings.aiEngine.sttProvider) || 'deepgram';
    const sttStreamingProfile = normalizeStreamingProfile(settings.aiEngine && settings.aiEngine.sttStreamingProfile);
    const sttStreamingLanguage = normalizeStreamingLanguage(
      sttStreamingProfile,
      settings.aiEngine && settings.aiEngine.sttNova3Language
    );
    const dictationCanStreamByDefault = intent === 'transcription'
      && (mode === 'pro' || sttProvider === 'deepgram');
    const prefersBatch = typeof preferBatch === 'boolean'
      ? preferBatch
      : !dictationCanStreamByDefault;

    if (mode === 'local') {
      return {
        intent,
        mode: 'local',
        provider: 'local',
        adapterId: this.localAdapter.id,
        transport: this.localAdapter.transport,
        auth: { type: 'none' },
        detectLanguage: true,
        prefersBatch: true,
        reasoning: 'Local processing routes STT to local Whisper.',
      };
    }

    if (mode === 'pro') {
      const adapter = prefersBatch ? this.proAdapter : this.deepgramAdapter;
      return {
        intent,
        mode,
        provider: 'deepgram',
        adapterId: adapter.id,
        transport: adapter.transport,
        auth: {
          type: 'jwt+capability',
          source: 'api.escribolt.com',
        },
        detectLanguage: true,
        prefersBatch,
        model: 'nova-3',
        endpoint: prefersBatch ? null : 'wss://api.deepgram.com/v1/listen',
        streamingProfile: sttStreamingProfile,
        language: prefersBatch ? 'multi' : sttStreamingLanguage,
        reasoning: prefersBatch
          ? 'PRO mode uses authenticated backend relay for Deepgram Nova-3 multilingual pre-recorded transcription.'
          : 'PRO mode uses Deepgram Nova-3 streaming via temporary token.',
      };
    }

    if (sttProvider === 'deepgram') {
      return {
        intent,
        mode: 'byok',
        provider: 'deepgram',
        adapterId: this.deepgramAdapter.id,
        transport: this.deepgramAdapter.transport,
        auth: {
          type: 'byok',
          keyField: 'aiEngine.apiKeys.deepgram',
        },
        detectLanguage: true,
        prefersBatch,
        model: 'nova-3',
        endpoint: prefersBatch ? null : 'wss://api.deepgram.com/v1/listen',
        streamingProfile: sttStreamingProfile,
        language: prefersBatch ? 'multi' : sttStreamingLanguage,
        reasoning: 'BYOK + Deepgram uses WebSocket transport for realtime and pre-recorded STT.',
      };
    }

    const provider = sttProvider === 'groq' ? 'groq' : 'openai';
    return {
      intent,
      mode: 'byok',
      provider,
      adapterId: this.httpAdapters[provider].id,
      transport: this.httpAdapters[provider].transport,
      auth: {
        type: 'byok',
        keyField: `aiEngine.apiKeys.${provider}`,
      },
      detectLanguage: true,
      prefersBatch: true,
      reasoning: 'BYOK + OpenAI/Groq uses HTTP multipart upload (batch transcription).',
    };
  }

  getAdapterForRoute(route) {
    if (route.adapterId === this.localAdapter.id) {
      return this.localAdapter;
    }
    if (route.adapterId === this.deepgramAdapter.id) {
      return this.deepgramAdapter;
    }
    if (route.adapterId === this.proAdapter.id) {
      return this.proAdapter;
    }
    if (route.provider === 'groq') {
      return this.httpAdapters.groq;
    }
    return this.httpAdapters.openai;
  }

  createSessionPlan(options = {}) {
    const route = this.resolveRoute(options);
    const adapter = this.getAdapterForRoute(route);
    const sessionConfig = adapter.buildSessionConfig({
      intent: route.intent,
      mode: route.mode,
      provider: route.provider,
      prefersBatch: route.prefersBatch,
      model: route.model,
      endpoint: route.endpoint,
      streamingProfile: route.streamingProfile,
      language: route.language,
    });

    return {
      route,
      adapter: adapter.describe(),
      sessionConfig,
    };
  }
}

module.exports = {
  SttRouter,
};
