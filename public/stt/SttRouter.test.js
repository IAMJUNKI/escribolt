const assert = require('node:assert/strict');
const test = require('node:test');

const { SttRouter } = require('./SttRouter');

function createRouter(settings) {
  return new SttRouter({
    getSettings: () => settings,
  });
}

function createSettings(processingModes, mode = 'pro') {
  return {
    mode,
    processingModes,
    aiEngine: {
      sttProvider: 'deepgram',
      sttStreamingProfile: 'nova3-multilingual',
      sttNova3Language: 'en',
      apiKeys: {
        deepgram: { present: false, last4: '' },
        openai: { present: false, last4: '' },
        groq: { present: false, last4: '' },
      },
    },
  };
}

test('record transcription uses meeting transcription local setting', () => {
  const router = createRouter(createSettings({
    dictation: 'cloud',
    meetingTranscription: 'local',
    aiActions: 'cloud',
  }));

  const plan = router.createSessionPlan({
    intent: 'record',
    preferBatch: true,
  });

  assert.equal(plan.route.mode, 'local');
  assert.equal(plan.route.provider, 'local');
});

test('record transcription uses meeting transcription cloud setting', () => {
  const router = createRouter(createSettings({
    dictation: 'local',
    meetingTranscription: 'cloud',
    aiActions: 'local',
  }));

  const plan = router.createSessionPlan({
    intent: 'record',
    preferBatch: true,
  });

  assert.equal(plan.route.mode, 'pro');
  assert.equal(plan.route.provider, 'deepgram');
  assert.equal(plan.route.transport, 'https');
});

test('record transcription cloud setting uses BYOK when the selected STT provider has a key', () => {
  const settings = createSettings({
    dictation: 'local',
    meetingTranscription: 'cloud',
    aiActions: 'local',
  }, 'local');
  settings.aiEngine.apiKeys.deepgram.present = true;

  const router = createRouter(settings);
  const plan = router.createSessionPlan({
    intent: 'record',
    preferBatch: true,
  });

  assert.equal(plan.route.mode, 'byok');
  assert.equal(plan.route.provider, 'deepgram');
});

test('record transcription honors cloud setting without a global cloud mode', () => {
  const router = createRouter(createSettings({
    dictation: 'local',
    meetingTranscription: 'cloud',
    aiActions: 'local',
  }, 'local'));

  const plan = router.createSessionPlan({
    intent: 'record',
    preferBatch: true,
  });

  assert.equal(plan.route.mode, 'pro');
  assert.equal(plan.route.provider, 'deepgram');
  assert.equal(plan.route.transport, 'https');
});
