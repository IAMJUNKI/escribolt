const assert = require('node:assert/strict');
const test = require('node:test');

const {
  shouldAllowLocalSttFallback,
} = require('./sttFallbackPolicy');

test('recording transcription does not fall back to local by default', () => {
  assert.equal(shouldAllowLocalSttFallback({ intent: 'record' }), false);
  assert.equal(shouldAllowLocalSttFallback({ intent: 'meeting-transcription' }), false);
});

test('dictation transcription can fall back to local by default', () => {
  assert.equal(shouldAllowLocalSttFallback({ intent: 'transcription' }), true);
});

test('callers can explicitly override local STT fallback policy', () => {
  assert.equal(shouldAllowLocalSttFallback({
    intent: 'record',
    allowLocalFallback: true,
  }), true);
  assert.equal(shouldAllowLocalSttFallback({
    intent: 'transcription',
    allowLocalFallback: false,
  }), false);
});
