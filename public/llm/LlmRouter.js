const LocalLlmAdapter = require('./adapters/LocalLlmAdapter');
const HttpLlmAdapter = require('./adapters/HttpLlmAdapter');
const BackendProxyLlmAdapter = require('./adapters/BackendProxyLlmAdapter');

const PRO_LLM_PROVIDER_ID = process.env.ESCRIBOLT_PRO_LLM_PROVIDER_ID || 'escribolt';
const BYOK_PROVIDERS = ['openai', 'groq', 'anthropic', 'gemini'];
const BYOK_LLM_MODEL_CATALOG = {
  openai: ['gpt-5-nano', 'gpt-4.1-mini', 'gpt-4o-mini'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'deepseek-r1-distill-llama-70b'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro'],
};

function hasByokKey(aiEngine = {}, provider = '') {
  const keyMeta = aiEngine.apiKeys && typeof aiEngine.apiKeys === 'object' ? aiEngine.apiKeys : {};
  const entry = keyMeta && typeof keyMeta[provider] === 'object' ? keyMeta[provider] : null;
  return !!(entry && entry.present === true);
}

function normalizeByokProvider(aiEngine = {}, provider = '') {
  const preferred = String(provider || '').trim().toLowerCase();
  const normalizedPreferred = BYOK_PROVIDERS.includes(preferred) ? preferred : 'openai';
  if (hasByokKey(aiEngine, normalizedPreferred)) {
    return normalizedPreferred;
  }
  for (const candidate of BYOK_PROVIDERS) {
    if (hasByokKey(aiEngine, candidate)) {
      return candidate;
    }
  }
  return normalizedPreferred;
}

function normalizeByokModel(provider = 'openai', model = '') {
  const options = Array.isArray(BYOK_LLM_MODEL_CATALOG[provider])
    ? BYOK_LLM_MODEL_CATALOG[provider]
    : BYOK_LLM_MODEL_CATALOG.openai;
  const normalizedModel = String(model || '').trim();
  if (normalizedModel && options.includes(normalizedModel)) {
    return normalizedModel;
  }
  return options[0];
}

function normalizeProModelAlias(modelAlias = '') {
  return String(modelAlias || '').trim().toLowerCase();
}

function normalizeProcessingLocation(value, fallback = 'local') {
  if (value === 'cloud' || value === 'local') {
    return value;
  }
  return fallback === 'cloud' ? 'cloud' : 'local';
}

function isSummaryIntent(intent = '') {
  return intent === 'recording-summary' || intent === 'recording-ask-summary';
}

function resolveLlmProcessingLocation(settings = {}, intent = 'agent') {
  const modes = settings.processingModes && typeof settings.processingModes === 'object'
    ? settings.processingModes
    : {};
  const feature = isSummaryIntent(intent) ? 'summaries' : 'aiActions';
  const location = normalizeProcessingLocation(
    modes[feature],
    'local'
  );

  return location;
}

class LlmRouter {
  constructor({ getSettings }) {
    this.getSettings = getSettings;
    this.localAdapter = new LocalLlmAdapter();
    this.byokAdapters = {
      openai: new HttpLlmAdapter('openai'),
      groq: new HttpLlmAdapter('groq'),
      anthropic: new HttpLlmAdapter('anthropic'),
      gemini: new HttpLlmAdapter('gemini'),
    };
    this.proAdapter = new BackendProxyLlmAdapter();
  }

  resolveRoute({ intent = 'agent', providerOverride = null } = {}) {
    const settings = this.getSettings ? this.getSettings() : {};
    const aiEngine = settings.aiEngine || {};
    const summaryIntent = isSummaryIntent(intent);
    const preferredProvider = providerOverride
      || (summaryIntent ? aiEngine.summaryProvider : aiEngine.llmProvider)
      || 'openai';
    const mode = resolveLlmProcessingLocation(settings, intent) === 'local'
      ? 'local'
      : (hasByokKey(aiEngine, preferredProvider) ? 'byok' : 'pro');

    if (mode === 'local') {
      return {
        intent,
        mode: 'local',
        provider: 'local',
        model: settings.model || 'qwen',
        adapterId: this.localAdapter.id,
        transport: this.localAdapter.transport,
        auth: { type: 'none' },
        reasoning: 'Local processing routes LLM calls to local model execution.',
      };
    }

    if (mode === 'pro') {
      const modelAlias = normalizeProModelAlias(
        summaryIntent ? aiEngine.summaryModel : aiEngine.llmModel
      );
      return {
        intent,
        mode,
        provider: PRO_LLM_PROVIDER_ID,
        modelAlias,
        adapterId: this.proAdapter.id,
        transport: this.proAdapter.transport,
        auth: { type: 'jwt', source: 'api.escribolt.com' },
        reasoning: 'PRO mode sends LLM requests through authenticated backend proxy.',
      };
    }

    const provider = normalizeByokProvider(aiEngine, preferredProvider);
    const model = normalizeByokModel(
      provider,
      summaryIntent ? aiEngine.summaryModel : aiEngine.llmModel
    );
    const adapter = this.byokAdapters[provider];

    return {
      intent,
      mode: 'byok',
      provider,
      model,
      adapterId: adapter.id,
      transport: adapter.transport,
      auth: {
        type: 'byok',
        keyField: `aiEngine.apiKeys.${provider}`,
      },
      reasoning: `BYOK mode sends LLM requests directly to ${provider}.`,
    };
  }

  getAdapterForRoute(route) {
    if (route.adapterId === this.localAdapter.id) {
      return this.localAdapter;
    }
    if (route.adapterId === this.proAdapter.id) {
      return this.proAdapter;
    }
    if (route.provider === 'groq') {
      return this.byokAdapters.groq;
    }
    if (route.provider === 'anthropic') {
      return this.byokAdapters.anthropic;
    }
    if (route.provider === 'gemini') {
      return this.byokAdapters.gemini;
    }
    return this.byokAdapters.openai;
  }

  createSessionPlan(options = {}) {
    const route = this.resolveRoute(options);
    const adapter = this.getAdapterForRoute(route);
    return {
      route,
      adapter: adapter.describe(),
    };
  }
}

module.exports = {
  LlmRouter,
};
