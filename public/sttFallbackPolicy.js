function shouldAllowLocalSttFallback({ intent = 'transcription', allowLocalFallback = null } = {}) {
  if (typeof allowLocalFallback === 'boolean') {
    return allowLocalFallback;
  }

  return intent !== 'record' && intent !== 'meeting-transcription';
}

module.exports = {
  shouldAllowLocalSttFallback,
};
