const assert = require('node:assert/strict');
const test = require('node:test');

const { LlmRouter } = require('./LlmRouter');

function createRouter(settings) {
  return new LlmRouter({
    getSettings: () => settings,
  });
}

function createSettings(processingModes, mode = 'local') {
  return {
    mode,
    model: 'qwen',
    processingModes,
    aiEngine: {
      llmProvider: 'openai',
      summaryProvider: 'openai',
      llmModel: 'gpt-5-nano',
      summaryModel: 'gpt-5-nano',
      apiKeys: {
        openai: { present: false, last4: '' },
        groq: { present: false, last4: '' },
        anthropic: { present: false, last4: '' },
        gemini: { present: false, last4: '' },
      },
    },
  };
}

test('chat route uses aiActions processing setting', () => {
  const router = createRouter(createSettings({
    aiActions: 'local',
    summaries: 'cloud',
  }, 'local'));

  const plan = router.createSessionPlan({ intent: 'global-ask' });

  assert.equal(plan.route.mode, 'local');
  assert.equal(plan.route.provider, 'local');
});

test('summary route uses summaries processing setting independently', () => {
  const router = createRouter(createSettings({
    aiActions: 'local',
    summaries: 'cloud',
  }, 'local'));

  const plan = router.createSessionPlan({ intent: 'recording-summary' });

  assert.equal(plan.route.mode, 'pro');
  assert.equal(plan.route.provider, 'escribolt');
});

test('summary route can be local while chat route is cloud', () => {
  const router = createRouter(createSettings({
    aiActions: 'cloud',
    summaries: 'local',
  }, 'local'));

  const summaryPlan = router.createSessionPlan({ intent: 'recording-summary' });
  const chatPlan = router.createSessionPlan({ intent: 'global-ask' });

  assert.equal(summaryPlan.route.mode, 'local');
  assert.equal(chatPlan.route.mode, 'pro');
});

test('cloud route uses BYOK when the selected provider has a key', () => {
  const settings = createSettings({
    aiActions: 'cloud',
    summaries: 'cloud',
  }, 'local');
  settings.aiEngine.apiKeys.openai.present = true;

  const router = createRouter(settings);
  const summaryPlan = router.createSessionPlan({ intent: 'recording-summary' });
  const chatPlan = router.createSessionPlan({ intent: 'global-ask' });

  assert.equal(summaryPlan.route.mode, 'byok');
  assert.equal(chatPlan.route.mode, 'byok');
  assert.equal(summaryPlan.route.provider, 'openai');
  assert.equal(chatPlan.route.provider, 'openai');
});
