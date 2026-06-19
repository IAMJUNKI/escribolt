const DEFAULT_STT_FETCH_TIMEOUT_MS = 90000;

function createTimeoutError(label, timeoutMs) {
  const seconds = Math.max(1, Math.round(Number(timeoutMs || DEFAULT_STT_FETCH_TIMEOUT_MS) / 1000));
  const error = new Error(`${label || 'STT request'} timed out after ${seconds}s`);
  error.code = 'STT_FETCH_TIMEOUT';
  return error;
}

async function fetchWithTimeout(url, options = {}, {
  timeoutMs = DEFAULT_STT_FETCH_TIMEOUT_MS,
  label = 'STT request',
} = {}) {
  const controller = new AbortController();
  const timeoutError = createTimeoutError(label, timeoutMs);
  const timer = setTimeout(() => {
    controller.abort(timeoutError);
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR')) {
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_STT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
};
