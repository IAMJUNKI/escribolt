const {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  Tray,
  Menu,
  screen,
  ipcMain,
  shell,
  safeStorage,
  session,
  desktopCapturer,
  systemPreferences,
  Notification,
} = require('electron');
const { execFile, execSync, spawn } = require('child_process');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (error) {
  console.warn('[updates] electron-updater is not installed; app updates are disabled.', error.message);
}
let machineIdSync = null;
try {
  ({ machineIdSync } = require('node-machine-id'));
} catch (error) {
  console.warn('[auth] node-machine-id is not installed; cloud trial device binding may be unavailable.', error.message);
}
let BetterSqlite3 = null;
try {
  BetterSqlite3 = require('better-sqlite3');
} catch (error) {
  console.warn('[local-db] better-sqlite3 is not installed yet; local SQLite persistence is disabled.', error.message);
}
const { SttRouter } = require('./stt/SttRouter');
const { LlmRouter } = require('./llm/LlmRouter');
const {
  MeetingPromptStateMachine,
  detectMeetingFromSnapshot,
} = require('./meetingDetection');
const {
  shouldAllowLocalSttFallback,
} = require('./sttFallbackPolicy');
const isDev = !app.isPackaged;

let ffmpeg = null;
let ffmpegBinaryPath = null;
try {
  ffmpeg = require('fluent-ffmpeg');
} catch (e) {
  console.warn('[record-mode] fluent-ffmpeg is not installed yet');
}

function isExecutableFile(candidatePath) {
  if (!candidatePath || typeof candidatePath !== 'string') {
    return false;
  }
  if (app.isPackaged && candidatePath.includes(`${path.sep}app.asar${path.sep}`)) {
    return false;
  }
  try {
    fs.accessSync(candidatePath, fs.constants.X_OK);
    return fs.statSync(candidatePath).isFile();
  } catch (_error) {
    return false;
  }
}

function toUnpackedAsarPath(candidatePath) {
  if (!candidatePath || typeof candidatePath !== 'string' || !app.isPackaged) {
    return candidatePath;
  }
  return candidatePath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

function resolveFfmpegBinaryPath() {
  const candidates = [];
  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath) {
      candidates.push(toUnpackedAsarPath(staticPath));
    }
  } catch (e) {
    console.warn('[record-mode] ffmpeg-static is not installed yet');
  }

  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  } else {
    candidates.push('/opt/homebrew/bin/ffmpeg');
    candidates.push('/usr/local/bin/ffmpeg');
    candidates.push('/usr/bin/ffmpeg');
  }

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

try {
  ffmpegBinaryPath = resolveFfmpegBinaryPath();
  if (ffmpegBinaryPath) {
    if (ffmpeg && typeof ffmpeg.setFfmpegPath === 'function') {
      ffmpeg.setFfmpegPath(ffmpegBinaryPath);
    }
    console.log(`[record-mode] Using ffmpeg binary: ${ffmpegBinaryPath}`);
  } else {
    console.warn('[record-mode] ffmpeg binary is unavailable');
  }
} catch (e) {
  console.warn('[record-mode] failed to resolve ffmpeg binary:', e.message);
}

// Load root .env for PRO model config (if present)
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim();
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
} catch (_e) {}

const APP_PROTOCOL = process.env.ESCRIBOLT_APP_PROTOCOL || 'escribolt';
const APP_AUTH_REDIRECT_URI = `${APP_PROTOCOL}://auth`;
const BACKEND_BASE_URL = process.env.ESCRIBOLT_BACKEND_URL || 'https://api.escribolt.com';
const TEMP_DEEPGRAM_KEY_URL = process.env.ESCRIBOLT_TEMP_DEEPGRAM_KEY_URL || `${BACKEND_BASE_URL}/api/stt/ws-token`;
const CAPABILITY_ISSUE_URL = process.env.ESCRIBOLT_CAPABILITY_ISSUE_URL || `${BACKEND_BASE_URL}/api/capabilities/issue`;
const RELAY_LLM_TRANSFORM_URL = process.env.ESCRIBOLT_RELAY_LLM_TRANSFORM_URL || `${BACKEND_BASE_URL}/api/relay/llm/transform`;
const BILLING_CHECKOUT_URL = process.env.ESCRIBOLT_BILLING_CHECKOUT_URL || `${BACKEND_BASE_URL}/api/billing/checkout-session`;
const BILLING_PORTAL_URL = process.env.ESCRIBOLT_BILLING_PORTAL_URL || `${BACKEND_BASE_URL}/api/billing/portal-session`;
const OPENAI_AGENT_MODEL = process.env.ESCRIBOLT_OPENAI_AGENT_MODEL || 'gpt-5-nano';
const GROQ_AGENT_MODEL = process.env.ESCRIBOLT_GROQ_AGENT_MODEL || 'llama-3.1-8b-instant';
const ANTHROPIC_AGENT_MODEL = process.env.ESCRIBOLT_ANTHROPIC_AGENT_MODEL || 'claude-sonnet-4-20250514';
const GEMINI_AGENT_MODEL = process.env.ESCRIBOLT_GEMINI_AGENT_MODEL || 'gemini-2.0-flash';
const PRO_LLM_PROVIDER_ID = process.env.ESCRIBOLT_PRO_LLM_PROVIDER_ID || 'escribolt';
const PRO_SUMMARY_MAX_TOKENS = 3072;
const PRO_ASK_MAX_TOKENS = 2048;
const PRO_MEMORY_SUMMARY_MAX_TOKENS = 2048;
const LOOPBACK_FEATURE_FLAGS = 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride';
const USE_SYSTEM_SCREEN_PICKER = process.env.ESCRIBOLT_USE_SYSTEM_SCREEN_PICKER === '1';
const ENABLE_EXPERIMENTAL_ELECTRON_MAC_LOOPBACK = process.env.ESCRIBOLT_EXPERIMENTAL_ELECTRON_MAC_LOOPBACK === '1';
const NATIVE_MAC_LOOPBACK_HELPER_PATH = process.env.ESCRIBOLT_MAC_LOOPBACK_HELPER_PATH || '';
const NATIVE_MAC_FN_KEY_HELPER_PATH = process.env.ESCRIBOLT_MAC_FN_KEY_HELPER_PATH || '';
const DEVICE_ID_HASH_SALT = process.env.ESCRIBOLT_DEVICE_HASH_SALT || 'escribolt-device-v1';

console.log(`[config] BACKEND_BASE_URL = ${BACKEND_BASE_URL}`);

function toSlug(value, fallback = '') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function formatModelAliasLabel(alias) {
  const tokens = String(alias || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  if (!tokens.length) return 'Model';
  return tokens
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(' ');
}

function parseProBrandedLlmModels(rawValue, defaultAlias = '') {
  const normalizedDefaultAlias = toSlug(defaultAlias, '');
  const fallback = [
    {
      id: 'hercules',
      label: 'Hercules',
      helperText: 'Fast managed reasoning',
      contextWindowTokens: null,
    },
    {
      id: 'atlas',
      label: 'Atlas',
      helperText: 'Deeper managed reasoning',
      contextWindowTokens: null,
    },
    {
      id: 'zeus',
      label: 'Zeus',
      helperText: 'Maximum managed reasoning',
      contextWindowTokens: null,
    },
  ];

  if (normalizedDefaultAlias && !fallback.some((entry) => entry.id === normalizedDefaultAlias)) {
    fallback.unshift({
      id: normalizedDefaultAlias,
      label: formatModelAliasLabel(normalizedDefaultAlias),
      helperText: 'Managed alias',
      contextWindowTokens: null,
    });
  }

  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawValue);
    const source = Array.isArray(parsed) ? parsed : [];
    const seen = new Set();
    const normalized = source
      .map((entry) => {
        const idCandidate = entry && (entry.id || entry.alias || entry.label)
          ? String(entry.id || entry.alias || entry.label)
          : '';
        const id = toSlug(idCandidate, '');
        if (!id || seen.has(id)) return null;
        seen.add(id);

        const label = String(entry && (entry.alias || entry.label) ? (entry.alias || entry.label) : '').trim()
          || formatModelAliasLabel(id);
        const helperText = String(entry && entry.helperText ? entry.helperText : '').trim();
        const contextWindowCandidate = Number(entry && (entry.contextWindowTokens ?? entry.contextLimitTokens));
        const contextWindowTokens = Number.isFinite(contextWindowCandidate) && contextWindowCandidate > 0
          ? Math.floor(contextWindowCandidate)
          : null;

        return {
          id,
          label,
          helperText: helperText || 'Managed alias',
          contextWindowTokens,
        };
      })
      .filter(Boolean);

    return normalized.length ? normalized : fallback;
  } catch (_error) {
    return fallback;
  }
}

const PRO_MODEL_ALIASES_ENV = process.env.ESCRIBOLT_PRO_MODEL_ALIASES_JSON || process.env.PRO_LLM_MODEL_ALIASES_JSON || '';
const PRO_DEFAULT_ALIAS_ENV = process.env.ESCRIBOLT_PRO_DEFAULT_MODEL_ALIAS || process.env.PRO_LLM_DEFAULT_MODEL_ID || '';
const PRO_BRANDED_LLM_MODELS = parseProBrandedLlmModels(PRO_MODEL_ALIASES_ENV, PRO_DEFAULT_ALIAS_ENV);
const PRO_DEFAULT_LLM_MODEL_ALIAS = PRO_BRANDED_LLM_MODELS[0].id;
const PRO_BRANDED_LLM_MODEL_LOOKUP = new Map();
PRO_BRANDED_LLM_MODELS.forEach((entry) => {
  PRO_BRANDED_LLM_MODEL_LOOKUP.set(entry.id, entry);
});

if (ENABLE_EXPERIMENTAL_ELECTRON_MAC_LOOPBACK) {
  app.commandLine.appendSwitch('enable-features', LOOPBACK_FEATURE_FLAGS);
}

let mainWindow;
let promoBannerPending = false;
let promoBannerVisible = false;
let tray;
let isRecording = false;
let backendPort = 8000;
const BACKEND_HOST = '127.0.0.1';
const BACKEND_HEALTH_PATH = '/runtime/health';
const BACKEND_READY_TIMEOUT_MS = 90000;
const BACKEND_RESTART_READY_TIMEOUT_MS = 45000;
const BACKEND_READY_POLL_MS = 250;
const BACKEND_CONNECTION_ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE']);
const LOCAL_STT_STATUS_POLL_MS = 5000;
const LOCAL_STT_PREPARING_MESSAGE = 'Local speech is getting ready. First-time setup can take several minutes; keep Escribolt open.';
const DICTATION_LIFECYCLE_STATES = {
  IDLE: 'idle',
  ARMING: 'arming',
  RECORDING: 'recording',
  STOPPING: 'stopping',
  PROCESSING: 'processing',
};
const DICTATION_LIFECYCLE_STATE_SET = new Set(Object.values(DICTATION_LIFECYCLE_STATES));
const DICTATION_CAPTURED_FALLBACK_TIMEOUT_MS = 120000;
const DICTATION_TRANSCRIPTION_FAILURE_MESSAGE = 'Something went wrong while transcribing. Please try again.';
let dictationLifecycleState = DICTATION_LIFECYCLE_STATES.IDLE;
let activeSessionId = null;
let speculativeStreamingSession = null;
let lastDictationTranscript = '';
let cachedProToken = null;
let pendingAuthDeepLink = null;
let cachedDeviceIdHash = null;
let loggedMissingDeviceIdWarning = false;
let lastTrialExhaustedNoticeAt = 0;
const recordModeSessions = new Map();
const nativeMacSystemAudioPermissionState = {
  status: 'unknown',
  message: '',
  requestedAt: 0,
  checkedAt: 0,
};
let recordModeStartPending = false;
let recordModeWidgetVisible = false;
let trayRecordModeStatus = 'idle';
const MEETING_PROMPT_POLL_MS = 2000;
const MEETING_PROMPT_STABILITY_MS = 5000;
const MEETING_PROMPT_VANISH_MS = 6000;
const MEETING_PROMPT_DISPLAY_MS = 4000;
const MEETING_PROMPT_APPLESCRIPT_TIMEOUT_MS = 1400;
const MEETING_PROMPT_FIELD_SEPARATOR = '|||ESCRIBOLT|||';
const MEETING_PROMPT_DEBUG = process.env.ESCRIBOLT_MEETING_PROMPT_DEBUG === '1'
  || process.argv.includes('--debug-meeting-prompt');
const MEETING_PROMPT_BROWSER_APPS = [
  'Google Chrome',
  'Google Chrome Canary',
  'Chromium',
  'Brave Browser',
  'Microsoft Edge',
  'Arc',
  'Safari',
  'Safari Technology Preview',
];
let meetingPromptPollTimer = null;
let meetingPromptPollInFlight = false;
let meetingPromptDetectionDisabled = false;
let meetingPromptVisible = false;
let activeMeetingPrompt = null;
let lastMeetingPromptPayloadJson = '';
let lastMeetingPromptDebugSignature = '';
let meetingPromptAutoDismissTimer = null;
const meetingPromptBrowserPermissionWarnings = new Set();
const meetingPromptState = new MeetingPromptStateMachine({
  stabilityMs: MEETING_PROMPT_STABILITY_MS,
  vanishMs: MEETING_PROMPT_VANISH_MS,
});
let fnKeyHelperProcess = null;
let fnKeyHelperAvailable = false;
let fnKeyHelperLastError = '';
let fnKeyHelperStopping = false;
let fnKeyHelperDisabledForSession = false;
let fnHoldTimer = null;
const FN_HOLD_GRACE_MS = 170;
const DICTATION_MIN_ACTIVE_MS = 300;
let pendingVoiceActionStartTimer = null;
let pendingVoiceActionStartContext = null;
let activeVoiceActionContext = null;
let activeVoiceActionMode = null;
const fnShortcutState = {
  isFnDown: false,
  holdStarted: false,
  spaceUsedInPress: false,
  ignoreFnUpTap: false,
  toggleActive: false,
  fnDownStartedAtMs: 0,
};
const shortcutsRuntimeState = {
  active: {
    dictationHold: {
      preset: 'fn_hold',
      display: 'Fn/Globe hold',
      mode: 'fn',
    },
    dictationHandsFree: {
      preset: 'fn_space_toggle',
      display: 'Fn+Space toggle',
      mode: 'fn',
      fallbackActive: false,
      accelerator: '',
    },
    quickNote: {
      preset: 'ctrl_n',
      display: 'Control+N',
      accelerator: 'Control+N',
    },
    recordMode: {
      preset: 'cmd_ctrl_r',
      display: 'Command+Control+R',
      accelerator: 'Command+Control+R',
    },
    pasteLastTranscription: {
      display: process.platform === 'darwin' ? 'Cmd+Ctrl+V' : 'Ctrl+Alt+V',
      accelerator: process.platform === 'darwin' ? 'Command+Control+V' : 'Control+Alt+V',
      registered: false,
    },
  },
  warnings: [],
  failures: [],
};
let shortcutsLastWorking = {
  dictationHoldPreset: 'fn_hold',
  dictationHandsFreePreset: 'fn_space_toggle',
  quickNotePreset: 'ctrl_n',
  recordModePreset: 'ctrl_r',
};
const MAIN_WIDGET_WIDTH = 400;
const MAIN_WIDGET_HEIGHT = 220;
const MAIN_WIDGET_RECORD_HEIGHT = 220;
const PROCESSING_WIDGET_COLLAPSED_WIDTH = 38;
const PROCESSING_WIDGET_EXPANDED_WIDTH = 184;
const PROCESSING_WIDGET_WINDOW_HEIGHT = 96;
const PROCESSING_WIDGET_GAP = 8;
const STICKY_NOTE_DEFAULT_WIDTH = 250;
const STICKY_NOTE_DEFAULT_HEIGHT = 250;
const STICKY_NOTE_FINAL_SAVE_TIMEOUT_MS = 800;
const STICKY_NOTE_DEFAULT_PLACEMENTS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const STICKY_NOTE_DEFAULT_PLACEMENT_SET = new Set(STICKY_NOTE_DEFAULT_PLACEMENTS);
const STICKY_NOTE_COLOR_IDS = ['yellow', 'blue', 'green', 'pink'];
const STICKY_NOTE_COLOR_ID_SET = new Set(STICKY_NOTE_COLOR_IDS);

// --- State for Notes ---
let activeNoteId = null; // ID of the currently focused note window
let stickyWindows = new Map(); // id -> BrowserWindow
let pendingStickyWindowFinalSaveCloses = new Map(); // id -> cancellation handle
let lastStickyWindowBounds = null;
let dashboardWindow = null; // Reference to the Unified Dashboard window
let pendingDashboardNavigation = null;
let pendingDashboardMenuCommands = [];
let dashboardRecordModeCommandReady = false;
let pendingDashboardRecordModeCommand = null;
let pendingDashboardRecordModeCommandTimer = null;
const activeQuickNoteNotifications = new Set();
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_STARTUP_CHECK_DELAY_MS = 3000;
let updatesInitialized = false;
let updatesCheckInterval = null;
let updatesDownloadPromise = null;
let updateState = {
  status: 'idle',
  supported: false,
  currentVersion: app.getVersion(),
  availableVersion: '',
  releaseName: '',
  releaseDate: '',
  progressPercent: null,
  errorMessage: '',
};

function isUpdaterSupported() {
  return !!autoUpdater && app.isPackaged;
}

function normalizeUpdateInfo(info = {}) {
  return {
    availableVersion: typeof info.version === 'string' ? info.version : '',
    releaseName: typeof info.releaseName === 'string' ? info.releaseName : '',
    releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : '',
  };
}

function getUpdateStateSnapshot() {
  return {
    ...updateState,
    supported: isUpdaterSupported(),
    currentVersion: app.getVersion(),
  };
}

function emitUpdateState() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('updates:state', getUpdateStateSnapshot());
  }
}

function setUpdateState(patch = {}) {
  updateState = {
    ...updateState,
    ...patch,
    supported: isUpdaterSupported(),
    currentVersion: app.getVersion(),
  };
  emitUpdateState();
  return getUpdateStateSnapshot();
}

function getUpdateErrorMessage(error, fallback = 'Unable to check for updates.') {
  const message = error && error.message ? String(error.message) : '';
  return message || fallback;
}

function markUpdateError(error, fallback) {
  return setUpdateState({
    status: 'error',
    progressPercent: null,
    errorMessage: getUpdateErrorMessage(error, fallback),
  });
}

async function checkForUpdates(options = {}) {
  if (!isUpdaterSupported()) {
    return setUpdateState({
      status: 'idle',
      progressPercent: null,
      errorMessage: '',
    });
  }
  if (updateState.status === 'checking' || updateState.status === 'available' || updateState.status === 'downloading' || updateState.status === 'downloaded') {
    return getUpdateStateSnapshot();
  }

  setUpdateState({
    status: 'checking',
    progressPercent: null,
    errorMessage: '',
  });

  try {
    await autoUpdater.checkForUpdates();
    return getUpdateStateSnapshot();
  } catch (error) {
    const fallback = options.manual === true
      ? 'Unable to check for updates right now.'
      : 'Automatic update check failed.';
    return markUpdateError(error, fallback);
  }
}

async function downloadAvailableUpdate() {
  if (!isUpdaterSupported()) {
    return getUpdateStateSnapshot();
  }
  if (updateState.status === 'downloaded') {
    return getUpdateStateSnapshot();
  }
  if (updateState.status !== 'available' && updateState.status !== 'downloading') {
    return getUpdateStateSnapshot();
  }
  if (updatesDownloadPromise) {
    return updatesDownloadPromise;
  }

  setUpdateState({
    status: 'downloading',
    progressPercent: updateState.progressPercent || 0,
    errorMessage: '',
  });

  updatesDownloadPromise = autoUpdater.downloadUpdate()
    .then(() => getUpdateStateSnapshot())
    .catch((error) => markUpdateError(error, 'Update download failed.'))
    .finally(() => {
      updatesDownloadPromise = null;
    });

  return updatesDownloadPromise;
}

function installDownloadedUpdate() {
  if (!isUpdaterSupported() || updateState.status !== 'downloaded') {
    return getUpdateStateSnapshot();
  }
  autoUpdater.quitAndInstall(false, true);
  return getUpdateStateSnapshot();
}

function initializeAutoUpdates() {
  if (updatesInitialized) {
    return;
  }
  updatesInitialized = true;

  if (!isUpdaterSupported()) {
    setUpdateState({
      status: 'idle',
      progressPercent: null,
      errorMessage: '',
    });
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({
      status: 'checking',
      progressPercent: null,
      errorMessage: '',
    });
  });

  autoUpdater.on('update-available', (info) => {
    setUpdateState({
      status: 'available',
      ...normalizeUpdateInfo(info),
      progressPercent: null,
      errorMessage: '',
    });
  });

  autoUpdater.on('update-not-available', () => {
    setUpdateState({
      status: 'idle',
      availableVersion: '',
      releaseName: '',
      releaseDate: '',
      progressPercent: null,
      errorMessage: '',
    });
  });

  autoUpdater.on('download-progress', (progress = {}) => {
    const percent = Number(progress.percent);
    setUpdateState({
      status: 'downloading',
      progressPercent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null,
      errorMessage: '',
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({
      status: 'downloaded',
      ...normalizeUpdateInfo(info),
      progressPercent: 100,
      errorMessage: '',
    });
  });

  autoUpdater.on('error', (error) => {
    markUpdateError(error, 'Update failed.');
  });

  setUpdateState({
    status: 'idle',
    progressPercent: null,
    errorMessage: '',
  });

  setTimeout(() => {
    checkForUpdates().catch((error) => {
      console.warn('[updates] Startup update check failed:', error.message);
    });
  }, UPDATE_STARTUP_CHECK_DELAY_MS);

  updatesCheckInterval = setInterval(() => {
    checkForUpdates().catch((error) => {
      console.warn('[updates] Scheduled update check failed:', error.message);
    });
  }, UPDATE_CHECK_INTERVAL_MS);
  if (updatesCheckInterval && typeof updatesCheckInterval.unref === 'function') {
    updatesCheckInterval.unref();
  }
}

app.on('open-url', (event, urlString) => {
  event.preventDefault();
  if (app.isReady()) {
    handleAuthDeepLink(urlString);
  } else {
    pendingAuthDeepLink = urlString;
  }
});

// Global listener to ensure all external link clicks and navigation attempts (e.g. from chat responses, recording summaries, etc.) open in the system default web browser rather than navigating the Electron app window.
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (isDev && (url.startsWith('http://localhost:3000') || url.startsWith('http://127.0.0.1:3000'))) {
        return;
      }
      event.preventDefault();
      shell.openExternal(url).catch((err) => console.error('Failed to open external URL:', err));
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url).catch((err) => console.error('Failed to open external URL:', err));
    }
    return { action: 'deny' };
  });
});

// --- Persistent Data Paths ---
const DATA_PATH = app.getPath('userData');
const LOCAL_STATE_DB_PATH = path.join(DATA_PATH, 'local-private.db');
const LEGACY_SETTINGS_JSON_PATH = path.join(DATA_PATH, 'settings.json');
const LEGACY_AUTH_JSON_PATH = path.join(DATA_PATH, 'auth.json');
const LEGACY_SYNC_JSON_PATH = path.join(DATA_PATH, 'sync-state.json');
const NOTES_STATE_KEY = 'notes-data';
const RECORDINGS_STATE_KEY = 'recordings-data';
const CHATS_STATE_KEY = 'chats-data';

let localStateDb = null;
let localStateDbInitFailed = false;

function openLocalStateDb() {
  if (localStateDb || localStateDbInitFailed || !BetterSqlite3) {
    return localStateDb;
  }

  try {
    const dir = path.dirname(LOCAL_STATE_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    localStateDb = new BetterSqlite3(LOCAL_STATE_DB_PATH);
    localStateDb.pragma('journal_mode = WAL');
    localStateDb.pragma('foreign_keys = ON');
    localStateDb.exec(`
      CREATE TABLE IF NOT EXISTS local_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  } catch (error) {
    console.error('[local-db] Failed to initialize local SQLite database:', error.message);
    localStateDb = null;
    localStateDbInitFailed = true;
  }

  return localStateDb;
}

function ensureLocalStateDbAvailableOrExit() {
  const db = openLocalStateDb();
  if (db) return true;

  const message = [
    'Escribolt could not initialize secure local storage (local-private.db).',
    '',
    'Data persistence and BYOK secret storage require SQLite to be available.',
    'If you are running from source, run: npm run rebuild:native',
    'Then restart the app.',
  ].join('\n');

  try {
    dialog.showErrorBox('Local Storage Initialization Failed', message);
  } catch (_error) {
    console.error(message);
  }
  app.exit(1);
  return false;
}

function deepClone(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function readLocalStateValue(key, fallbackValue = null) {
  const db = openLocalStateDb();
  if (!db) {
    return deepClone(fallbackValue);
  }

  try {
    const row = db.prepare('SELECT value_json FROM local_state WHERE key = ?').get(key);
    if (!row || typeof row.value_json !== 'string') {
      return deepClone(fallbackValue);
    }
    const parsed = JSON.parse(row.value_json);
    return parsed === undefined ? deepClone(fallbackValue) : parsed;
  } catch (error) {
    console.error(`[local-db] Failed to read key "${key}":`, error.message);
    return deepClone(fallbackValue);
  }
}

function writeLocalStateValue(key, value) {
  const db = openLocalStateDb();
  if (!db) {
    return false;
  }

  try {
    db.prepare(`
      INSERT INTO local_state (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value ?? {}), Date.now());
    return true;
  } catch (error) {
    console.error(`[local-db] Failed to write key "${key}":`, error.message);
    return false;
  }
}

function hasLocalStateValue(key) {
  const db = openLocalStateDb();
  if (!db) return false;
  try {
    const row = db.prepare('SELECT 1 AS has_key FROM local_state WHERE key = ?').get(key);
    return !!(row && row.has_key === 1);
  } catch (error) {
    console.error(`[local-db] Failed to check key "${key}":`, error.message);
    return false;
  }
}

function createSqliteStateStore({ key, defaults = {} }) {
  let initial = readLocalStateValue(key, null);

  if (!initial || typeof initial !== 'object') {
    initial = {};
  }

  let cache = {
    ...(deepClone(defaults) || {}),
    ...initial,
  };
  writeLocalStateValue(key, cache);

  return {
    get store() {
      return cache;
    },
    get(name) {
      return cache ? cache[name] : undefined;
    },
    set(payload = {}) {
      if (!payload || typeof payload !== 'object') {
        return;
      }
      cache = {
        ...(cache || {}),
        ...payload,
      };
      writeLocalStateValue(key, cache);
    },
  };
}

function cleanupLegacyConversationsData() {
  const legacyPath = path.join(DATA_PATH, 'conversations.json');
  try {
    if (fs.existsSync(legacyPath)) {
      fs.unlinkSync(legacyPath);
    }
  } catch (e) {
    console.warn('Failed to remove legacy conversations.json:', e.message);
  }
}

const SHORTCUT_DEFAULTS = {
  dictationHoldPreset: 'fn_hold',
  dictationHandsFreePreset: 'fn_space_toggle',
  quickNotePreset: 'ctrl_n',
  recordModePreset: 'ctrl_r',
};

const PROCESSING_MODE_DEFAULTS = {
  dictation: 'local',
  meetingTranscription: 'local',
  aiActions: 'local',
  summaries: 'local',
};
const PROCESSING_MODE_KEYS = ['dictation', 'meetingTranscription', 'aiActions', 'summaries'];

const DICTATION_HOLD_SHORTCUT_PRESETS = [
  { id: 'fn_hold', label: 'Fn/Globe hold', description: 'Hold Fn/Globe to talk, release to stop.' },
  { id: 'disabled', label: 'Disabled', description: 'Turn off hold-to-talk trigger.' },
];

const DICTATION_HANDS_FREE_SHORTCUT_PRESETS = [
  { id: 'fn_space_toggle', label: 'Fn+Space toggle', description: 'Press Fn+Space to start and press Fn to stop.' },
  { id: 'ctrl_space_toggle', label: 'Control+Space toggle', description: 'Press Control+Space to start and press again to stop.' },
  { id: 'cmd_ctrl_e_toggle', label: 'Command+Control+E toggle', description: 'Press Command+Control+E to start and press again to stop.' },
];

const QUICK_NOTE_SHORTCUT_PRESETS = [
  { id: 'ctrl_n', label: 'Control+N', description: 'Capture quick-note dictation.' },
  { id: 'fn_n_toggle', label: 'Fn/Globe + N', description: 'Press Fn/Globe + N to start a quick note, and press Fn to stop.' },
  { id: 'cmd_ctrl_n', label: 'Command+Control+N', description: 'Capture quick-note dictation.' },
  { id: 'cmd_shift_n', label: 'Command+Shift+N', description: 'Capture quick-note dictation.' },
  { id: 'opt_cmd_n', label: 'Option+Command+N', description: 'Capture quick-note dictation.' },
];

const RECORD_MODE_SHORTCUT_PRESETS = [
  { id: 'ctrl_r', label: 'Control+R', description: 'Toggle record mode capture.' },
  { id: 'fn_r_toggle', label: 'Fn/Globe + R', description: 'Press Fn/Globe + R to start record mode, and press Fn to stop.' },
  { id: 'cmd_ctrl_r', label: 'Command+Control+R', description: 'Toggle record mode capture.' },
  { id: 'cmd_shift_r', label: 'Command+Shift+R', description: 'Toggle record mode capture.' },
  { id: 'opt_cmd_r', label: 'Option+Command+R', description: 'Toggle record mode capture.' },
];

const DEFAULT_RECORDING_SUMMARY_LANGUAGE = 'en';
const RECORDING_SUMMARY_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'ca', label: 'Catalan' },
  { code: 'eu', label: 'Basque' },
  { code: 'gl', label: 'Galician' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'sv', label: 'Swedish' },
  { code: 'da', label: 'Danish' },
  { code: 'no', label: 'Norwegian' },
  { code: 'fi', label: 'Finnish' },
  { code: 'pl', label: 'Polish' },
  { code: 'cs', label: 'Czech' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ru', label: 'Russian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'he', label: 'Hebrew' },
  { code: 'hi', label: 'Hindi' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'tr', label: 'Turkish' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'id', label: 'Indonesian' },
];
const RECORDING_SUMMARY_LANGUAGE_BY_CODE = new Map(
  RECORDING_SUMMARY_LANGUAGE_OPTIONS.map((entry) => [entry.code.toLowerCase(), entry])
);

function normalizeRecordingSummaryLanguageCode(rawCode) {
  const normalized = String(rawCode || '')
    .trim()
    .replace(/_/g, '-')
    .toLowerCase();
  if (!normalized) return DEFAULT_RECORDING_SUMMARY_LANGUAGE;
  if (RECORDING_SUMMARY_LANGUAGE_BY_CODE.has(normalized)) {
    return normalized;
  }
  const baseCode = normalized.split('-')[0] || '';
  return RECORDING_SUMMARY_LANGUAGE_BY_CODE.has(baseCode)
    ? baseCode
    : DEFAULT_RECORDING_SUMMARY_LANGUAGE;
}

function resolveRecordingSummaryLanguage(rawCode) {
  const code = normalizeRecordingSummaryLanguageCode(rawCode);
  const entry = RECORDING_SUMMARY_LANGUAGE_BY_CODE.get(code);
  return {
    code,
    label: entry ? entry.label : 'English',
  };
}

const DICTATION_HANDS_FREE_PRESET_TO_ACCELERATOR = {
  ctrl_space_toggle: 'Control+Space',
  cmd_ctrl_e_toggle: 'Command+Control+E',
};

const QUICK_NOTE_PRESET_TO_ACCELERATOR = {
  ctrl_n: 'Control+N',
  cmd_ctrl_n: 'Command+Control+N',
  cmd_shift_n: 'Command+Shift+N',
  opt_cmd_n: 'Option+Command+N',
};

const RECORD_MODE_PRESET_TO_ACCELERATOR = {
  ctrl_r: 'Control+R',
  cmd_ctrl_r: 'Command+Control+R',
  cmd_shift_r: 'Command+Shift+R',
  opt_cmd_r: 'Option+Command+R',
};
const PASTE_LAST_TRANSCRIPTION_ACCELERATOR = process.platform === 'darwin'
  ? 'Command+Control+V'
  : 'Control+Alt+V';
const CURRENT_PRODUCT_TOUR_VERSION = 1;
const LEGACY_SYNC_INTERVAL_MS = 30000;
const DEFAULT_SYNC_INTERVAL_MS = 300000;

const DEFAULT_SETTINGS = {
  mode: 'local',
  model: 'qwen',
  theme: 'black',
  onboardingCompleted: false,
  productTourVersionSeen: 0,
  launchAtLogin: false,
  quickNotePopupEnabled: true,
  meetingPromptEnabled: false,
  meetingPromptConsentGranted: false,
  stickyNoteDefaultPlacement: 'top-right',
  stickyNoteDefaultColorId: 'yellow',
  aiEngine: {
    sttProvider: 'deepgram',
    llmProvider: 'openai',
    summaryProvider: 'openai',
    llmModel: OPENAI_AGENT_MODEL,
    summaryModel: OPENAI_AGENT_MODEL,
    sttTranscriptionMode: 'streaming',
    sttStreamingProfile: 'nova3-multilingual',
    sttNova3Language: 'en',
    localSttLanguageMode: 'auto',
    localSttLanguage: 'en',
    sttKeyterms: [],
    sttFluxKeyterms: [],
    sttFluxLanguageHints: [],
    apiKeys: createEmptyByokKeyMeta(),
  },
  recordingCaptureMode: 'system-only',
  recordingSummaryLanguage: DEFAULT_RECORDING_SUMMARY_LANGUAGE,
  processingModes: { ...PROCESSING_MODE_DEFAULTS },
  layout: {
    sidebarCollapsed: false,
    sidebarWidth: 288,
    pinnedExpanded: true,
    notesExpanded: true,
    recordingsExpanded: true,
    recentExpanded: true,
    chatsExpanded: true,
    spacesExpanded: true,
    pinnedSidebarItems: [],
  },
  syncSettings: {
    autoSyncEnabled: true,
    intervalMs: DEFAULT_SYNC_INTERVAL_MS,
    strictPrivacyMode: false,
  },
  shortcuts: { ...SHORTCUT_DEFAULTS },
};

const DEEPGRAM_BATCH_MODEL_NOVA3 = 'nova-3';
const DEEPGRAM_BATCH_LANGUAGE_MULTILINGUAL = 'multi';
const PRO_STT_MODEL = DEEPGRAM_BATCH_MODEL_NOVA3;
const PRO_STT_LANGUAGE = DEEPGRAM_BATCH_LANGUAGE_MULTILINGUAL;
const DEEPGRAM_NOVA3_STREAMING_MODEL = 'nova-3';
const DEEPGRAM_NOVA3_STREAMING_ENDPOINT = 'wss://api.deepgram.com/v1/listen';
const STT_STREAMING_PROFILE_MULTILINGUAL = 'nova3-multilingual';
const STT_STREAMING_PROFILE_MONOLINGUAL = 'nova3-monolingual';
const DEFAULT_STREAMING_KEYTERMS = ['Escribolt'];
const NOVA3_MONOLINGUAL_LANGUAGE_CODES = [
  'ar', 'ar-AE', 'ar-SA', 'ar-QA', 'ar-KW', 'ar-SY', 'ar-LB', 'ar-PS', 'ar-JO', 'ar-EG', 'ar-SD', 'ar-TD',
  'ar-MA', 'ar-DZ', 'ar-TN', 'ar-IQ', 'ar-IR', 'be', 'bn', 'bs', 'bg', 'ca', 'zh-HK', 'zh', 'zh-CN',
  'zh-Hans', 'zh-TW', 'zh-Hant', 'hr', 'cs', 'da', 'da-DK', 'nl', 'en', 'en-US', 'en-AU', 'en-GB',
  'en-IN', 'en-NZ', 'et', 'fi', 'nl-BE', 'fr', 'fr-CA', 'de', 'de-CH', 'el', 'gu', 'gu-IN', 'he',
  'hi', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'ko-KR', 'lv', 'lt', 'mk', 'ms', 'mr', 'no', 'fa', 'pl',
  'pt', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'es-419', 'sv', 'sv-SE', 'tl', 'ta',
  'te', 'th', 'th-TH', 'tr', 'uk', 'ur', 'vi',
];
const NOVA3_MONOLINGUAL_LANGUAGE_CODE_LOOKUP = new Map(
  NOVA3_MONOLINGUAL_LANGUAGE_CODES.map((code) => [code.toLowerCase(), code])
);
const DEEPGRAM_STREAMING_TARGET_CHUNK_MS = 90;
const DEEPGRAM_STREAMING_SAMPLE_RATE = 16000;
const DEEPGRAM_STREAMING_BYTES_PER_SAMPLE = 2;
const DEEPGRAM_STREAMING_TARGET_CHUNK_BYTES = Math.max(
  320,
  Math.floor((DEEPGRAM_STREAMING_SAMPLE_RATE * DEEPGRAM_STREAMING_BYTES_PER_SAMPLE * DEEPGRAM_STREAMING_TARGET_CHUNK_MS) / 1000)
);

function resolveDeepgramBatchLanguage(model = DEEPGRAM_BATCH_MODEL_NOVA3, language = null) {
  const explicitLanguage = typeof language === 'string' ? language.trim() : '';
  if (explicitLanguage) {
    return explicitLanguage;
  }
  const normalizedModel = String(model || '').trim().toLowerCase();
  return normalizedModel === DEEPGRAM_BATCH_MODEL_NOVA3
    ? DEEPGRAM_BATCH_LANGUAGE_MULTILINGUAL
    : null;
}

const BYOK_PROVIDERS = ['deepgram', 'openai', 'groq', 'anthropic', 'gemini'];
const BYOK_LLM_PROVIDERS = ['openai', 'groq', 'anthropic', 'gemini'];
const BYOK_LLM_MODEL_CATALOG = {
  openai: [
    { id: 'gpt-5-nano', label: 'GPT-5 Nano' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
    { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill Llama 70B' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet' },
    { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
  ],
  gemini: [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  ],
};
const LLM_PROVIDER_ENUM = Array.from(new Set([...BYOK_LLM_PROVIDERS, PRO_LLM_PROVIDER_ID]));
const SIDEBAR_WIDTH_MIN = 220;
const SIDEBAR_WIDTH_MAX = 420;

function getKeyLast4(secret = '') {
  const value = typeof secret === 'string' ? secret.trim() : '';
  if (!value) return '';
  return value.slice(-4);
}

function createEmptyByokKeyMeta() {
  return {
    deepgram: { present: false, last4: '' },
    openai: { present: false, last4: '' },
    groq: { present: false, last4: '' },
    anthropic: { present: false, last4: '' },
    gemini: { present: false, last4: '' },
  };
}

function createEmptyByokEncryptedKeyMap() {
  return {
    deepgram: '',
    openai: '',
    groq: '',
    anthropic: '',
    gemini: '',
  };
}

function normalizeByokMetaEntry(rawEntry = {}) {
  if (typeof rawEntry === 'string') {
    const trimmed = rawEntry.trim();
    if (!trimmed) {
      return { present: false, last4: '' };
    }
    return {
      present: true,
      last4: getKeyLast4(trimmed),
    };
  }

  return {
    present: !!(rawEntry && rawEntry.present === true),
    last4: rawEntry && typeof rawEntry.last4 === 'string'
      ? rawEntry.last4.slice(-4)
      : '',
  };
}

function normalizeByokMetaMap(rawMap = {}) {
  const base = createEmptyByokKeyMeta();
  BYOK_PROVIDERS.forEach((provider) => {
    base[provider] = normalizeByokMetaEntry(rawMap && rawMap[provider]);
  });
  return base;
}

function normalizeByokEncryptedKeyMap(rawMap = {}) {
  const base = createEmptyByokEncryptedKeyMap();
  BYOK_PROVIDERS.forEach((provider) => {
    base[provider] = rawMap && typeof rawMap[provider] === 'string'
      ? rawMap[provider]
      : '';
  });
  return base;
}

function hasAnyByokEncryptedSecret(encryptedKeys = {}) {
  return BYOK_PROVIDERS.some((provider) => {
    const value = encryptedKeys && typeof encryptedKeys[provider] === 'string'
      ? encryptedKeys[provider].trim()
      : '';
    return !!value;
  });
}

function hasAnyByokKeyMetaPresent(keyMeta = {}) {
  return BYOK_PROVIDERS.some((provider) => {
    const entry = keyMeta && typeof keyMeta[provider] === 'object' ? keyMeta[provider] : null;
    return !!(entry && entry.present === true);
  });
}

function hasByokKeyPresent(keyMeta = {}, provider = '') {
  const entry = keyMeta && typeof keyMeta[provider] === 'object' ? keyMeta[provider] : null;
  return !!(entry && entry.present === true);
}

function getByokLlmModelOptions(provider = 'openai') {
  const options = BYOK_LLM_MODEL_CATALOG[provider];
  return Array.isArray(options) ? options : BYOK_LLM_MODEL_CATALOG.openai;
}

function getDefaultByokLlmModel(provider = 'openai') {
  const options = getByokLlmModelOptions(provider);
  return options[0] ? options[0].id : OPENAI_AGENT_MODEL;
}

function normalizeByokLlmProvider(provider = 'openai', keyMeta = {}) {
  const preferred = String(provider || '').trim().toLowerCase();
  const normalizedPreferred = BYOK_LLM_PROVIDERS.includes(preferred) ? preferred : 'openai';
  if (hasByokKeyPresent(keyMeta, normalizedPreferred)) {
    return normalizedPreferred;
  }

  for (const providerId of BYOK_LLM_PROVIDERS) {
    if (hasByokKeyPresent(keyMeta, providerId)) {
      return providerId;
    }
  }
  return normalizedPreferred;
}

function normalizeLlmProviderId(provider = '') {
  return String(provider || '').trim().toLowerCase();
}

function normalizeByokLlmModel(provider = 'openai', model = '') {
  const normalizedModel = String(model || '').trim();
  const options = getByokLlmModelOptions(provider);
  if (normalizedModel && options.some((entry) => entry.id === normalizedModel)) {
    return normalizedModel;
  }
  return getDefaultByokLlmModel(provider);
}

function normalizeSttKeyterms(rawKeyterms = [], legacyKeyterms = []) {
  const source = [
    ...(Array.isArray(rawKeyterms) ? rawKeyterms : []),
    ...(Array.isArray(legacyKeyterms) ? legacyKeyterms : []),
  ];
  const normalized = [];
  const seen = new Set();
  source.forEach((entry) => {
    const clean = String(entry || '').trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const dedupeKey = clean.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    normalized.push(clean);
  });
  return normalized.slice(0, 100);
}

function resolveKeytermsForStreaming(aiEngineSettings = {}) {
  return normalizeSttKeyterms([
    ...DEFAULT_STREAMING_KEYTERMS,
    ...(Array.isArray(aiEngineSettings.sttKeyterms) ? aiEngineSettings.sttKeyterms : []),
  ], [
    ...(Array.isArray(aiEngineSettings.sttFluxKeyterms) ? aiEngineSettings.sttFluxKeyterms : []),
  ]);
}

function normalizeLegacyFluxLanguageHints(rawLanguageHints = []) {
  const source = Array.isArray(rawLanguageHints) ? rawLanguageHints : [];
  const normalized = [];
  const seen = new Set();
  source.forEach((entry) => {
    const code = normalizeLegacyFluxLanguageCode(entry);
    if (!code || seen.has(code)) return;
    seen.add(code);
    normalized.push(code);
  });
  return normalized.slice(0, 10);
}

function normalizeLegacyFluxLanguageCode(code = '') {
  const normalized = String(code || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (!normalized) return '';
  const baseCode = normalized.split('-')[0] || '';
  if (!baseCode) return '';
  return ['en', 'es', 'fr', 'de', 'hi', 'ru', 'pt', 'ja', 'it', 'nl'].includes(baseCode) ? baseCode : '';
}

function normalizeSttStreamingProfile(value = '') {
  return value === STT_STREAMING_PROFILE_MONOLINGUAL
    ? STT_STREAMING_PROFILE_MONOLINGUAL
    : STT_STREAMING_PROFILE_MULTILINGUAL;
}

function normalizeNova3LanguageCode(code = '') {
  const normalized = String(code || '')
    .trim()
    .replace(/_/g, '-')
    .toLowerCase();
  if (!normalized) return '';

  const exact = NOVA3_MONOLINGUAL_LANGUAGE_CODE_LOOKUP.get(normalized);
  if (exact) {
    return exact;
  }

  const baseCode = normalized.split('-')[0] || '';
  return NOVA3_MONOLINGUAL_LANGUAGE_CODE_LOOKUP.get(baseCode) || '';
}

function resolveDefaultNova3Language() {
  const locale = typeof app.getLocale === 'function' ? app.getLocale() : '';
  return normalizeNova3LanguageCode(locale) || 'en';
}

function resolveNova3StreamingConfigForSettings(aiEngineSettings = {}) {
  const streamingProfile = normalizeSttStreamingProfile(aiEngineSettings.sttStreamingProfile);
  const language = streamingProfile === STT_STREAMING_PROFILE_MONOLINGUAL
    ? normalizeNova3LanguageCode(aiEngineSettings.sttNova3Language) || resolveDefaultNova3Language()
    : 'multi';

  return {
    streamingProfile,
    model: DEEPGRAM_NOVA3_STREAMING_MODEL,
    language,
    endpoint: DEEPGRAM_NOVA3_STREAMING_ENDPOINT,
  };
}

function normalizeLocalSttLanguageMode(value = '') {
  return value === 'fixed' ? 'fixed' : 'auto';
}

function resolveLocalWhisperLanguageForSettings(aiEngineSettings = {}) {
  if (normalizeLocalSttLanguageMode(aiEngineSettings.localSttLanguageMode) !== 'fixed') {
    return null;
  }
  const language = normalizeNova3LanguageCode(aiEngineSettings.localSttLanguage) || resolveDefaultNova3Language();
  return language ? language.split('-')[0] : null;
}

function normalizeProLlmModelAlias(modelAlias = '') {
  const normalized = toSlug(modelAlias, '');
  if (normalized && PRO_BRANDED_LLM_MODEL_LOOKUP.has(normalized)) {
    return normalized;
  }
  return PRO_DEFAULT_LLM_MODEL_ALIAS;
}

function getProBrandedLlmModel(modelAlias = '') {
  const normalized = normalizeProLlmModelAlias(modelAlias);
  return PRO_BRANDED_LLM_MODEL_LOOKUP.get(normalized) || null;
}

function normalizeAiEngineRoutingSettings(aiEngine = {}, mode = 'local', keyMeta = {}) {
  const normalizedKeyMeta = normalizeByokMetaMap(keyMeta);
  const normalizedMode = mode === 'pro' ? 'pro' : mode === 'byok' ? 'byok' : 'local';
  const sttKeyterms = normalizeSttKeyterms(aiEngine.sttKeyterms, aiEngine.sttFluxKeyterms);
  const sttFluxKeyterms = normalizeSttKeyterms(aiEngine.sttFluxKeyterms);
  const sttFluxLanguageHints = normalizeLegacyFluxLanguageHints(aiEngine.sttFluxLanguageHints);
  const sttStreamingProfile = normalizeSttStreamingProfile(aiEngine.sttStreamingProfile);
  const sttNova3Language = normalizeNova3LanguageCode(aiEngine.sttNova3Language) || resolveDefaultNova3Language();
  const localSttLanguageMode = normalizeLocalSttLanguageMode(aiEngine.localSttLanguageMode);
  const localSttLanguage = normalizeNova3LanguageCode(aiEngine.localSttLanguage) || sttNova3Language;

  if (normalizedMode === 'pro') {
    return {
      ...aiEngine,
      sttKeyterms,
      sttFluxKeyterms,
      sttFluxLanguageHints,
      sttStreamingProfile,
      sttNova3Language,
      localSttLanguageMode,
      localSttLanguage,
      llmProvider: PRO_LLM_PROVIDER_ID,
      summaryProvider: PRO_LLM_PROVIDER_ID,
      llmModel: normalizeProLlmModelAlias(aiEngine.llmModel),
      summaryModel: normalizeProLlmModelAlias(aiEngine.summaryModel),
    };
  }

  const llmProvider = normalizeByokLlmProvider(aiEngine.llmProvider, normalizedKeyMeta);
  const summaryProvider = normalizeByokLlmProvider(aiEngine.summaryProvider, normalizedKeyMeta);

  return {
    ...aiEngine,
    sttKeyterms,
    sttFluxKeyterms,
    sttFluxLanguageHints,
    sttStreamingProfile,
    sttNova3Language,
    localSttLanguageMode,
    localSttLanguage,
    llmProvider,
    summaryProvider,
    llmModel: normalizeByokLlmModel(llmProvider, aiEngine.llmModel),
    summaryModel: normalizeByokLlmModel(summaryProvider, aiEngine.summaryModel),
  };
}

function normalizeProcessingModes(rawModes = {}, fallbackLocation = 'local') {
  const source = rawModes && typeof rawModes === 'object' ? rawModes : {};
  const fallback = fallbackLocation === 'cloud' ? 'cloud' : 'local';
  const normalize = (value) => (value === 'cloud' || value === 'local' ? value : fallback);
  return {
    dictation: normalize(source.dictation),
    meetingTranscription: normalize(source.meetingTranscription),
    aiActions: normalize(source.aiActions),
    summaries: normalize(source.summaries ?? source.aiActions),
  };
}

function buildProcessingModePatch(rawModes = {}, previousModes = PROCESSING_MODE_DEFAULTS) {
  const source = rawModes && typeof rawModes === 'object' ? rawModes : {};
  const next = normalizeProcessingModes(previousModes, 'local');
  PROCESSING_MODE_KEYS.forEach((key) => {
    if (source[key] === 'cloud' || source[key] === 'local') {
      next[key] = source[key];
    }
  });
  return next;
}

function getProcessingLocation(feature = '') {
  const modes = settings && settings.processingModes
    ? settings.processingModes
    : PROCESSING_MODE_DEFAULTS;
  const normalized = normalizeProcessingModes(modes, 'local');
  return normalized[feature] === 'cloud' ? 'cloud' : 'local';
}

function getEffectiveProcessingMode(feature = '') {
  const location = getProcessingLocation(feature);
  if (location === 'local') {
    return 'local';
  }
  const provider = getByokProviderForProcessingFeature(feature);
  const keyMeta = normalizeByokMetaMap(
    settings && settings.aiEngine && settings.aiEngine.apiKeys
      ? settings.aiEngine.apiKeys
      : createEmptyByokKeyMeta()
  );
  return provider && hasByokKeyPresent(keyMeta, provider) ? 'byok' : 'pro';
}

function getByokProviderForProcessingFeature(feature = '') {
  const aiEngine = settings && settings.aiEngine ? settings.aiEngine : {};
  if (feature === 'dictation' || feature === 'meetingTranscription') {
    return aiEngine.sttProvider === 'openai' || aiEngine.sttProvider === 'groq'
      ? aiEngine.sttProvider
      : 'deepgram';
  }
  if (feature === 'summaries') {
    return typeof aiEngine.summaryProvider === 'string' ? aiEngine.summaryProvider : '';
  }
  if (feature === 'aiActions') {
    return typeof aiEngine.llmProvider === 'string' ? aiEngine.llmProvider : '';
  }
  return '';
}

function hasCloudProcessingCredential(feature = '') {
  if (getAuthState().isLoggedIn) return true;
  const provider = getByokProviderForProcessingFeature(feature);
  if (!provider) return false;
  const keyMeta = normalizeByokMetaMap(
    settings && settings.aiEngine && settings.aiEngine.apiKeys
      ? settings.aiEngine.apiKeys
      : createEmptyByokKeyMeta()
  );
  return hasByokKeyPresent(keyMeta, provider);
}

function normalizeShortcutSettings(rawShortcuts = {}) {
  const normalized = { ...SHORTCUT_DEFAULTS };
  const dictationHoldPreset = typeof rawShortcuts.dictationHoldPreset === 'string'
    ? rawShortcuts.dictationHoldPreset.trim()
    : '';
  if (dictationHoldPreset === 'fn_hold'
    || dictationHoldPreset === 'disabled') {
    normalized.dictationHoldPreset = dictationHoldPreset;
  }

  const dictationHandsFreePreset = typeof rawShortcuts.dictationHandsFreePreset === 'string'
    ? rawShortcuts.dictationHandsFreePreset.trim()
    : '';
  if (dictationHandsFreePreset === 'fn_space_toggle'
    || dictationHandsFreePreset === 'ctrl_space_toggle'
    || dictationHandsFreePreset === 'cmd_ctrl_e_toggle') {
    normalized.dictationHandsFreePreset = dictationHandsFreePreset;
  }

  const legacyDictationPreset = typeof rawShortcuts.dictationPreset === 'string'
    ? rawShortcuts.dictationPreset.trim()
    : '';
  if (legacyDictationPreset === 'fn_hold_plus_fn_space') {
    normalized.dictationHoldPreset = 'fn_hold';
    normalized.dictationHandsFreePreset = 'fn_space_toggle';
  } else if (legacyDictationPreset === 'ctrl_space_toggle') {
    normalized.dictationHoldPreset = 'disabled';
    normalized.dictationHandsFreePreset = 'ctrl_space_toggle';
  } else if (legacyDictationPreset === 'cmd_ctrl_e_toggle') {
    normalized.dictationHoldPreset = 'disabled';
    normalized.dictationHandsFreePreset = 'cmd_ctrl_e_toggle';
  }

  const quickNotePreset = typeof rawShortcuts.quickNotePreset === 'string'
    ? rawShortcuts.quickNotePreset.trim()
    : '';
  if (quickNotePreset === 'ctrl_n'
    || quickNotePreset === 'fn_n_toggle'
    || quickNotePreset === 'cmd_ctrl_n'
    || quickNotePreset === 'cmd_shift_n'
    || quickNotePreset === 'opt_cmd_n') {
    normalized.quickNotePreset = quickNotePreset;
  }

  const recordModePreset = typeof rawShortcuts.recordModePreset === 'string'
    ? rawShortcuts.recordModePreset.trim()
    : '';
  if (recordModePreset === 'ctrl_r'
    || recordModePreset === 'fn_r_toggle'
    || recordModePreset === 'cmd_ctrl_r'
    || recordModePreset === 'cmd_shift_r'
    || recordModePreset === 'opt_cmd_r') {
    normalized.recordModePreset = recordModePreset;
  }
  return normalized;
}

const USER_SETTINGS_SCHEMA = {
  mode: {
    type: 'string',
    enum: ['local', 'byok', 'pro'],
    default: DEFAULT_SETTINGS.mode,
  },
  model: {
    type: 'string',
    enum: ['qwen', 'gemma'],
    default: DEFAULT_SETTINGS.model,
  },
  theme: {
    type: 'string',
    enum: ['black', 'white'],
    default: DEFAULT_SETTINGS.theme,
  },
  onboardingCompleted: {
    type: 'boolean',
    default: DEFAULT_SETTINGS.onboardingCompleted,
  },
  productTourVersionSeen: {
    type: 'number',
    default: DEFAULT_SETTINGS.productTourVersionSeen,
  },
  launchAtLogin: {
    type: 'boolean',
    default: DEFAULT_SETTINGS.launchAtLogin,
  },
  quickNotePopupEnabled: {
    type: 'boolean',
    default: DEFAULT_SETTINGS.quickNotePopupEnabled,
  },
  meetingPromptEnabled: {
    type: 'boolean',
    default: DEFAULT_SETTINGS.meetingPromptEnabled,
  },
  meetingPromptConsentGranted: {
    type: 'boolean',
    default: DEFAULT_SETTINGS.meetingPromptConsentGranted,
  },
  stickyNoteDefaultPlacement: {
    type: 'string',
    enum: STICKY_NOTE_DEFAULT_PLACEMENTS,
    default: DEFAULT_SETTINGS.stickyNoteDefaultPlacement,
  },
  stickyNoteDefaultColorId: {
    type: 'string',
    enum: STICKY_NOTE_COLOR_IDS,
    default: DEFAULT_SETTINGS.stickyNoteDefaultColorId,
  },
  aiEngine: {
    type: 'object',
    default: DEFAULT_SETTINGS.aiEngine,
    properties: {
      sttProvider: {
        type: 'string',
        enum: ['deepgram', 'openai', 'groq'],
        default: DEFAULT_SETTINGS.aiEngine.sttProvider,
      },
      llmProvider: {
        type: 'string',
        enum: LLM_PROVIDER_ENUM,
        default: DEFAULT_SETTINGS.aiEngine.llmProvider,
      },
      summaryProvider: {
        type: 'string',
        enum: LLM_PROVIDER_ENUM,
        default: DEFAULT_SETTINGS.aiEngine.summaryProvider,
      },
      llmModel: {
        type: 'string',
        default: DEFAULT_SETTINGS.aiEngine.llmModel,
      },
      summaryModel: {
        type: 'string',
        default: DEFAULT_SETTINGS.aiEngine.summaryModel,
      },
      sttTranscriptionMode: {
        type: 'string',
        enum: ['streaming', 'prerecorded'],
        default: DEFAULT_SETTINGS.aiEngine.sttTranscriptionMode,
      },
      sttStreamingProfile: {
        type: 'string',
        enum: [STT_STREAMING_PROFILE_MULTILINGUAL, STT_STREAMING_PROFILE_MONOLINGUAL],
        default: DEFAULT_SETTINGS.aiEngine.sttStreamingProfile,
      },
      sttNova3Language: {
        type: 'string',
        default: DEFAULT_SETTINGS.aiEngine.sttNova3Language,
      },
      localSttLanguageMode: {
        type: 'string',
        enum: ['auto', 'fixed'],
        default: DEFAULT_SETTINGS.aiEngine.localSttLanguageMode,
      },
      localSttLanguage: {
        type: 'string',
        default: DEFAULT_SETTINGS.aiEngine.localSttLanguage,
      },
      sttKeyterms: {
        type: 'array',
        default: DEFAULT_SETTINGS.aiEngine.sttKeyterms,
      },
      sttFluxKeyterms: {
        type: 'array',
        default: DEFAULT_SETTINGS.aiEngine.sttFluxKeyterms,
      },
      sttFluxLanguageHints: {
        type: 'array',
        default: DEFAULT_SETTINGS.aiEngine.sttFluxLanguageHints,
      },
      apiKeys: {
        type: 'object',
        default: DEFAULT_SETTINGS.aiEngine.apiKeys,
        properties: {
          deepgram: { type: 'object', default: DEFAULT_SETTINGS.aiEngine.apiKeys.deepgram },
          openai: { type: 'object', default: DEFAULT_SETTINGS.aiEngine.apiKeys.openai },
          groq: { type: 'object', default: DEFAULT_SETTINGS.aiEngine.apiKeys.groq },
          anthropic: { type: 'object', default: DEFAULT_SETTINGS.aiEngine.apiKeys.anthropic },
          gemini: { type: 'object', default: DEFAULT_SETTINGS.aiEngine.apiKeys.gemini },
        },
      },
    },
  },
  recordingCaptureMode: {
    type: 'string',
    enum: ['system-only', 'all-audio'],
    default: DEFAULT_SETTINGS.recordingCaptureMode,
  },
  recordingSummaryLanguage: {
    type: 'string',
    enum: RECORDING_SUMMARY_LANGUAGE_OPTIONS.map((entry) => entry.code),
    default: DEFAULT_SETTINGS.recordingSummaryLanguage,
  },
  processingModes: {
    type: 'object',
    default: DEFAULT_SETTINGS.processingModes,
    properties: {
      dictation: {
        type: 'string',
        enum: ['local', 'cloud'],
        default: DEFAULT_SETTINGS.processingModes.dictation,
      },
      meetingTranscription: {
        type: 'string',
        enum: ['local', 'cloud'],
        default: DEFAULT_SETTINGS.processingModes.meetingTranscription,
      },
      aiActions: {
        type: 'string',
        enum: ['local', 'cloud'],
        default: DEFAULT_SETTINGS.processingModes.aiActions,
      },
      summaries: {
        type: 'string',
        enum: ['local', 'cloud'],
        default: DEFAULT_SETTINGS.processingModes.summaries,
      },
    },
  },
  layout: {
    type: 'object',
    default: DEFAULT_SETTINGS.layout,
    properties: {
      sidebarCollapsed: {
        type: 'boolean',
        default: DEFAULT_SETTINGS.layout.sidebarCollapsed,
      },
      sidebarWidth: {
        type: 'number',
        default: DEFAULT_SETTINGS.layout.sidebarWidth,
      },
      pinnedExpanded: {
        type: 'boolean',
        default: DEFAULT_SETTINGS.layout.pinnedExpanded,
      },
      notesExpanded: {
        type: 'boolean',
        default: DEFAULT_SETTINGS.layout.notesExpanded,
      },
      recordingsExpanded: {
        type: 'boolean',
        default: DEFAULT_SETTINGS.layout.recordingsExpanded,
      },
      recentExpanded: {
        type: 'boolean',
        default: DEFAULT_SETTINGS.layout.recentExpanded,
      },
      chatsExpanded: {
        type: 'boolean',
        default: DEFAULT_SETTINGS.layout.chatsExpanded,
      },
      spacesExpanded: {
        type: 'boolean',
        default: DEFAULT_SETTINGS.layout.spacesExpanded,
      },
      pinnedSidebarItems: {
        type: 'array',
        default: DEFAULT_SETTINGS.layout.pinnedSidebarItems,
      },
    },
  },
  syncSettings: {
    type: 'object',
    default: DEFAULT_SETTINGS.syncSettings,
    properties: {
      autoSyncEnabled: {
        type: 'boolean',
        default: DEFAULT_SETTINGS.syncSettings.autoSyncEnabled,
      },
      intervalMs: {
        type: 'number',
        default: DEFAULT_SETTINGS.syncSettings.intervalMs,
      },
      strictPrivacyMode: {
        type: 'boolean',
        default: DEFAULT_SETTINGS.syncSettings.strictPrivacyMode,
      },
    },
  },
  shortcuts: {
    type: 'object',
    default: DEFAULT_SETTINGS.shortcuts,
    properties: {
      dictationHoldPreset: {
        type: 'string',
        enum: ['fn_hold', 'disabled'],
        default: DEFAULT_SETTINGS.shortcuts.dictationHoldPreset,
      },
      dictationHandsFreePreset: {
        type: 'string',
        enum: ['fn_space_toggle', 'ctrl_space_toggle', 'cmd_ctrl_e_toggle'],
        default: DEFAULT_SETTINGS.shortcuts.dictationHandsFreePreset,
      },
      quickNotePreset: {
        type: 'string',
        enum: ['ctrl_n', 'fn_n_toggle', 'cmd_ctrl_n', 'cmd_shift_n', 'opt_cmd_n'],
        default: DEFAULT_SETTINGS.shortcuts.quickNotePreset,
      },
      recordModePreset: {
        type: 'string',
        enum: ['ctrl_r', 'fn_r_toggle', 'cmd_ctrl_r', 'cmd_shift_r', 'opt_cmd_r'],
        default: DEFAULT_SETTINGS.shortcuts.recordModePreset,
      },
    },
  },
};

const userSettingsStore = createSqliteStateStore({
  key: 'settings',
  defaults: deepClone(DEFAULT_SETTINGS),
});

const authStore = createSqliteStateStore({
  key: 'auth',
  defaults: {
    encryptedJwt: '',
    encryptedRefreshToken: '',
    lastLoginAt: 0,
    tokenSource: '',
    email: '',
    displayName: '',
    plan: '',
  },
});

const byokSecretStore = createSqliteStateStore({
  key: 'byok-secrets',
  defaults: {
    encryptedKeys: createEmptyByokEncryptedKeyMap(),
    keyMeta: createEmptyByokKeyMeta(),
    secureStoragePrimed: false,
    secureStoragePrimedAt: 0,
    migrationCompleted: false,
    encryptionVersion: 1,
  },
});

const syncStore = createSqliteStateStore({
  key: 'sync-state',
  defaults: {
    lastPullSince: 0,
    lastPushAt: 0,
    pendingDeletes: {
      folders: [],
      recordings: [],
      notes: [],
      chats: [],
    },
    outbox: {
      folders: [],
      recordings: [],
      notes: [],
      chats: [],
    },
    pullCursors: {
      folders: { updatedAt: 0, id: '' },
      recordings: { updatedAt: 0, id: '' },
      notes: { updatedAt: 0, id: '' },
      chats: { updatedAt: 0, id: '' },
    },
  },
});

const sidebarPinsStore = createSqliteStateStore({
  key: 'sidebar-pins',
  defaults: {
    items: [],
    updatedAt: 0,
  },
});

function readJsonFileIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[local-db] Failed to read legacy JSON file ${filePath}:`, error.message);
    return null;
  }
}

function removeFileIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn(`[local-db] Failed to remove legacy JSON file ${filePath}:`, error.message);
  }
}

function migrateLegacyJsonStateStores() {
  const marker = readLocalStateValue('legacy-json-migration', null);
  if (marker && marker.completed === true) {
    return;
  }

  const imported = {
    settings: false,
    auth: false,
    syncState: false,
  };

  const legacySettings = readJsonFileIfExists(LEGACY_SETTINGS_JSON_PATH);
  if (legacySettings && typeof legacySettings === 'object') {
    userSettingsStore.set(legacySettings);
    imported.settings = true;
  }

  const legacyAuth = readJsonFileIfExists(LEGACY_AUTH_JSON_PATH);
  if (legacyAuth && typeof legacyAuth === 'object') {
    authStore.set(legacyAuth);
    imported.auth = true;
  }

  const legacySync = readJsonFileIfExists(LEGACY_SYNC_JSON_PATH);
  if (legacySync && typeof legacySync === 'object') {
    syncStore.set(legacySync);
    imported.syncState = true;
  }

  removeFileIfExists(LEGACY_SETTINGS_JSON_PATH);
  removeFileIfExists(LEGACY_AUTH_JSON_PATH);
  removeFileIfExists(LEGACY_SYNC_JSON_PATH);

  writeLocalStateValue('legacy-json-migration', {
    completed: true,
    completedAt: Date.now(),
    imported,
  });
}

const SYNC_INTERVAL_MIN_MS = 10000;
const SYNC_INTERVAL_MAX_MS = 300000;
const SYNC_ENTITY_TYPES = ['folders', 'recordings', 'notes', 'chats'];
const SYNC_PUSH_MAX_ITEMS = 50;
const SYNC_PUSH_MAX_BYTES = 1536 * 1024;
const SYNC_PULL_LIMIT = 200;

const DEFAULT_SYNC_STATE = {
  lastPullSince: 0,
  lastPushAt: 0,
  pendingDeletes: {
    folders: [],
    recordings: [],
    notes: [],
    chats: [],
  },
  outbox: {
    folders: [],
    recordings: [],
    notes: [],
    chats: [],
  },
  pullCursors: {
    folders: { updatedAt: 0, id: '' },
    recordings: { updatedAt: 0, id: '' },
    notes: { updatedAt: 0, id: '' },
    chats: { updatedAt: 0, id: '' },
  },
};

migrateLegacyJsonStateStores();

let cachedProDeepgramCredential = null;
let _cachedJwtString = null;
let _cachedRefreshToken = null; // In-memory cache to avoid repeated Keychain access
let _byokApiKeyCache = null;
let _safeStorageAvailableCache = null;

function mergeSettings(existing) {
  const existingByokMeta = normalizeByokMetaMap(((((existing || {}).aiEngine || {}).apiKeys) || {}));
  const hasStoredProductTourVersionSeen = !!(
    existing
    && Object.prototype.hasOwnProperty.call(existing, 'productTourVersionSeen')
  );
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(existing || {}),
    aiEngine: {
      ...DEFAULT_SETTINGS.aiEngine,
      ...((existing || {}).aiEngine || {}),
      apiKeys: existingByokMeta,
    },
    syncSettings: {
      ...DEFAULT_SETTINGS.syncSettings,
      ...((existing || {}).syncSettings || {}),
    },
    layout: {
      ...DEFAULT_SETTINGS.layout,
      ...((existing || {}).layout || {}),
    },
    shortcuts: normalizeShortcutSettings((existing || {}).shortcuts || {}),
  };

  if (!['system-only', 'all-audio'].includes(merged.recordingCaptureMode)) {
    merged.recordingCaptureMode = DEFAULT_SETTINGS.recordingCaptureMode;
  }
  merged.recordingSummaryLanguage = normalizeRecordingSummaryLanguageCode(merged.recordingSummaryLanguage);
  if (!['local', 'byok', 'pro'].includes(merged.mode)) {
    merged.mode = 'local';
  }
  const hasStoredProcessingModes = !!(existing && existing.processingModes && typeof existing.processingModes === 'object');
  merged.processingModes = normalizeProcessingModes(
    hasStoredProcessingModes ? existing.processingModes : {},
    'local',
  );
  if (!['qwen', 'gemma'].includes(merged.model)) {
    merged.model = DEFAULT_SETTINGS.model;
  }
  if (!['black', 'white'].includes(merged.theme)) {
    merged.theme = DEFAULT_SETTINGS.theme;
  }
  if (typeof merged.onboardingCompleted !== 'boolean') {
    merged.onboardingCompleted = DEFAULT_SETTINGS.onboardingCompleted;
  }
  if (!hasStoredProductTourVersionSeen || typeof merged.productTourVersionSeen !== 'number' || !Number.isFinite(merged.productTourVersionSeen)) {
    merged.productTourVersionSeen = merged.onboardingCompleted === true ? CURRENT_PRODUCT_TOUR_VERSION : DEFAULT_SETTINGS.productTourVersionSeen;
  } else {
    merged.productTourVersionSeen = Math.max(0, Math.floor(merged.productTourVersionSeen));
  }
  if (typeof merged.quickNotePopupEnabled !== 'boolean') {
    merged.quickNotePopupEnabled = DEFAULT_SETTINGS.quickNotePopupEnabled;
  }
  if (typeof merged.meetingPromptEnabled !== 'boolean') {
    merged.meetingPromptEnabled = DEFAULT_SETTINGS.meetingPromptEnabled;
  }
  if (typeof merged.meetingPromptConsentGranted !== 'boolean') {
    merged.meetingPromptConsentGranted = DEFAULT_SETTINGS.meetingPromptConsentGranted;
  }
  if (!STICKY_NOTE_DEFAULT_PLACEMENT_SET.has(merged.stickyNoteDefaultPlacement)) {
    merged.stickyNoteDefaultPlacement = DEFAULT_SETTINGS.stickyNoteDefaultPlacement;
  }
  if (!STICKY_NOTE_COLOR_ID_SET.has(merged.stickyNoteDefaultColorId)) {
    merged.stickyNoteDefaultColorId = DEFAULT_SETTINGS.stickyNoteDefaultColorId;
  }
  if (!merged.layout || typeof merged.layout !== 'object') {
    merged.layout = { ...DEFAULT_SETTINGS.layout };
  }
  if (typeof merged.layout.sidebarCollapsed !== 'boolean') {
    merged.layout.sidebarCollapsed = DEFAULT_SETTINGS.layout.sidebarCollapsed;
  }
  const sidebarWidth = Number(merged.layout.sidebarWidth);
  merged.layout.sidebarWidth = Number.isFinite(sidebarWidth)
    ? Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.floor(sidebarWidth)))
    : DEFAULT_SETTINGS.layout.sidebarWidth;
  if (typeof merged.layout.notesExpanded !== 'boolean') {
    merged.layout.notesExpanded = DEFAULT_SETTINGS.layout.notesExpanded;
  }
  if (typeof merged.layout.pinnedExpanded !== 'boolean') {
    merged.layout.pinnedExpanded = DEFAULT_SETTINGS.layout.pinnedExpanded;
  }
  if (typeof merged.layout.recordingsExpanded !== 'boolean') {
    merged.layout.recordingsExpanded = DEFAULT_SETTINGS.layout.recordingsExpanded;
  }
  merged.layout.pinnedSidebarItems = normalizePinnedSidebarItems(merged.layout.pinnedSidebarItems);
  const sidebarPinsUpdatedAt = Number(sidebarPinsStore.get('updatedAt') || 0);
  if (!merged.layout.pinnedSidebarItems.length && Number.isFinite(sidebarPinsUpdatedAt) && sidebarPinsUpdatedAt > 0) {
    merged.layout.pinnedSidebarItems = getStoredSidebarPinnedItems();
  }
  if (!['deepgram', 'openai', 'groq'].includes(merged.aiEngine.sttProvider)) {
    merged.aiEngine.sttProvider = DEFAULT_SETTINGS.aiEngine.sttProvider;
  }
  merged.aiEngine.llmProvider = normalizeLlmProviderId(merged.aiEngine.llmProvider);
  merged.aiEngine.summaryProvider = normalizeLlmProviderId(merged.aiEngine.summaryProvider);
  if (!LLM_PROVIDER_ENUM.includes(merged.aiEngine.llmProvider)) {
    merged.aiEngine.llmProvider = DEFAULT_SETTINGS.aiEngine.llmProvider;
  }
  if (!LLM_PROVIDER_ENUM.includes(merged.aiEngine.summaryProvider)) {
    merged.aiEngine.summaryProvider = DEFAULT_SETTINGS.aiEngine.summaryProvider;
  }
  if (!['streaming', 'prerecorded'].includes(merged.aiEngine.sttTranscriptionMode)) {
    merged.aiEngine.sttTranscriptionMode = DEFAULT_SETTINGS.aiEngine.sttTranscriptionMode;
  }
  merged.aiEngine.sttStreamingProfile = normalizeSttStreamingProfile(merged.aiEngine.sttStreamingProfile);
  merged.aiEngine.sttNova3Language = normalizeNova3LanguageCode(merged.aiEngine.sttNova3Language) || resolveDefaultNova3Language();
  merged.aiEngine.localSttLanguageMode = normalizeLocalSttLanguageMode(merged.aiEngine.localSttLanguageMode);
  merged.aiEngine.localSttLanguage = normalizeNova3LanguageCode(merged.aiEngine.localSttLanguage) || merged.aiEngine.sttNova3Language;
  merged.aiEngine.sttKeyterms = normalizeSttKeyterms(merged.aiEngine.sttKeyterms, merged.aiEngine.sttFluxKeyterms);
  merged.aiEngine.sttFluxKeyterms = normalizeSttKeyterms(merged.aiEngine.sttFluxKeyterms);
  merged.aiEngine.sttFluxLanguageHints = normalizeLegacyFluxLanguageHints(merged.aiEngine.sttFluxLanguageHints);

  merged.aiEngine.apiKeys = normalizeByokMetaMap(merged.aiEngine.apiKeys);
  merged.aiEngine = normalizeAiEngineRoutingSettings(
    merged.aiEngine,
    merged.mode,
    merged.aiEngine.apiKeys
  );
  if (merged.mode === 'pro') {
    merged.aiEngine.sttProvider = 'deepgram';
    merged.aiEngine.llmProvider = PRO_LLM_PROVIDER_ID;
    merged.aiEngine.summaryProvider = PRO_LLM_PROVIDER_ID;

  }
  merged.syncSettings.autoSyncEnabled = true;
  const intervalMs = Number(merged.syncSettings.intervalMs);
  if (!Number.isFinite(intervalMs) || intervalMs === LEGACY_SYNC_INTERVAL_MS) {
    merged.syncSettings.intervalMs = DEFAULT_SETTINGS.syncSettings.intervalMs;
  } else {
    merged.syncSettings.intervalMs = Math.max(
      SYNC_INTERVAL_MIN_MS,
      Math.min(SYNC_INTERVAL_MAX_MS, Math.floor(intervalMs)),
    );
  }
  if (typeof merged.syncSettings.strictPrivacyMode !== 'boolean') {
    merged.syncSettings.strictPrivacyMode = DEFAULT_SETTINGS.syncSettings.strictPrivacyMode;
  }
  merged.shortcuts = normalizeShortcutSettings(merged.shortcuts);
  return merged;
}

function normalizePinnedSidebarItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  const seen = new Set();
  const normalized = [];
  rawItems.forEach((entry) => {
    const type = String(entry && entry.type ? entry.type : '').trim();
    const id = String(entry && entry.id ? entry.id : '').trim();
    if (!['note', 'recording', 'folder', 'chat'].includes(type) || !id) return;
    const key = `${type}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({ type, id });
  });
  return normalized;
}

function getStoredSidebarPinnedItems() {
  return normalizePinnedSidebarItems(sidebarPinsStore.get('items'));
}

function persistSidebarPinnedItems(items = []) {
  sidebarPinsStore.set({
    items: normalizePinnedSidebarItems(items),
    updatedAt: Date.now(),
  });
}

function normalizePendingDeleteList(source = []) {
  const seen = new Set();
  const normalized = [];
  const input = Array.isArray(source) ? source : [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.id !== 'string' || !item.id) continue;
    if (seen.has(item.id)) continue;
    const updatedAt = Number(item.updatedAt || Date.now());
    const version = Number.parseInt(item.version, 10);
    normalized.push({
      id: item.id,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      version: Number.isFinite(version) && version > 0 ? version : 1,
    });
    seen.add(item.id);
  }
  return normalized;
}

function normalizeSyncCursor(raw = {}) {
  const updatedAt = Number(raw && raw.updatedAt);
  const id = typeof raw?.id === 'string' ? raw.id : '';
  return {
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : 0,
    id,
  };
}

function normalizeSyncCursorMap(source = {}) {
  return SYNC_ENTITY_TYPES.reduce((acc, entityType) => {
    acc[entityType] = normalizeSyncCursor(source && source[entityType]);
    return acc;
  }, {});
}

function normalizeSyncOutbox(source = {}) {
  return SYNC_ENTITY_TYPES.reduce((acc, entityType) => {
    acc[entityType] = normalizePendingDeleteList(source && source[entityType]);
    return acc;
  }, {});
}

function loadSyncState() {
  const raw = syncStore.store || {};
  return {
    ...DEFAULT_SYNC_STATE,
    ...raw,
    pendingDeletes: {
      folders: normalizePendingDeleteList(raw.pendingDeletes && raw.pendingDeletes.folders),
      recordings: normalizePendingDeleteList(raw.pendingDeletes && raw.pendingDeletes.recordings),
      notes: normalizePendingDeleteList(raw.pendingDeletes && raw.pendingDeletes.notes),
      chats: normalizePendingDeleteList(raw.pendingDeletes && raw.pendingDeletes.chats),
    },
    outbox: normalizeSyncOutbox(raw.outbox),
    pullCursors: normalizeSyncCursorMap(raw.pullCursors),
  };
}

function persistSyncState() {
  syncStore.set(syncState);
}

function addPendingDelete(entityType, deleteEntry) {
  if (!SYNC_ENTITY_TYPES.includes(entityType)) return;
  const list = Array.isArray(syncState.pendingDeletes[entityType])
    ? syncState.pendingDeletes[entityType]
    : [];
  const next = normalizePendingDeleteList([deleteEntry, ...list]);
  syncState.pendingDeletes[entityType] = next;
  addSyncOutboxItem(entityType, deleteEntry, { persist: false });
  persistSyncState();
}

function removePendingDeleteByIds(entityType, idList = []) {
  if (!SYNC_ENTITY_TYPES.includes(entityType)) return;
  if (!Array.isArray(idList) || !idList.length) return;
  const ids = new Set(idList.filter((id) => typeof id === 'string' && id));
  if (!ids.size) return;
  const current = Array.isArray(syncState.pendingDeletes[entityType])
    ? syncState.pendingDeletes[entityType]
    : [];
  syncState.pendingDeletes[entityType] = current.filter((item) => !ids.has(item.id));
  persistSyncState();
}

function addSyncOutboxItem(entityType, entry = {}, options = {}) {
  if (!SYNC_ENTITY_TYPES.includes(entityType)) return;
  if (!entry || typeof entry.id !== 'string' || !entry.id) return;
  const list = Array.isArray(syncState.outbox && syncState.outbox[entityType])
    ? syncState.outbox[entityType]
    : [];
  const next = normalizePendingDeleteList([entry, ...list]);
  syncState.outbox = {
    ...normalizeSyncOutbox(syncState.outbox),
    [entityType]: next,
  };
  if (options.persist !== false) {
    persistSyncState();
  }
}

function removeSyncOutboxByIds(entityType, idList = [], options = {}) {
  if (!SYNC_ENTITY_TYPES.includes(entityType)) return;
  if (!Array.isArray(idList) || !idList.length) return;
  const ids = new Set(idList.filter((id) => typeof id === 'string' && id));
  if (!ids.size) return;
  const current = Array.isArray(syncState.outbox && syncState.outbox[entityType])
    ? syncState.outbox[entityType]
    : [];
  syncState.outbox = {
    ...normalizeSyncOutbox(syncState.outbox),
    [entityType]: current.filter((item) => !ids.has(item.id)),
  };
  if (options.persist !== false) {
    persistSyncState();
  }
}

function emitSyncStatus(payload = {}) {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('sync:status', payload);
  }
}

function emitSyncConflictsUpdated() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('sync:conflicts-updated', getPendingSyncConflicts());
  }
}

function buildDeletedItem(entry = {}) {
  const updatedAt = Number(entry.updatedAt || Date.now());
  const version = Number.parseInt(entry.version, 10);
  return {
    id: entry.id,
    isCloudSynced: true,
    deletedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    version: Number.isFinite(version) && version > 0 ? version : 1,
  };
}

let syncState = loadSyncState();
let syncIntervalHandle = null;
let syncRunTimeout = null;
let syncInFlight = false;
let syncRerunRequested = false;
let syncBackoffUntil = 0;
let pendingSyncConflicts = [];

function buildSyncConflictKey(conflict = {}) {
  const entityType = typeof conflict.entityType === 'string' ? conflict.entityType : '';
  const entityId = typeof conflict.entityId === 'string' ? conflict.entityId : '';
  return `${entityType}:${entityId}`;
}

function getPendingSyncConflicts() {
  return pendingSyncConflicts
    .slice()
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function upsertPendingSyncConflict(conflict) {
  const normalized = normalizeRemoteConflict(conflict);
  const key = buildSyncConflictKey(normalized);
  if (!normalized.entityType || !normalized.entityId) {
    return;
  }

  const existingIndex = pendingSyncConflicts.findIndex((item) => buildSyncConflictKey(item) === key);
  if (existingIndex >= 0) {
    pendingSyncConflicts[existingIndex] = normalized;
  } else {
    pendingSyncConflicts.push(normalized);
  }

  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('sync:conflict', normalized);
  }
  emitSyncConflictsUpdated();
}

function removePendingSyncConflict(entityType, entityId) {
  const key = `${entityType}:${entityId}`;
  pendingSyncConflicts = pendingSyncConflicts.filter((item) => buildSyncConflictKey(item) !== key);
  emitSyncConflictsUpdated();
}

function replacePendingSyncConflicts(conflicts = []) {
  const source = Array.isArray(conflicts) ? conflicts : [];
  const deduped = [];
  const seen = new Set();
  source.forEach((entry) => {
    const normalized = normalizeRemoteConflict(entry);
    const key = buildSyncConflictKey(normalized);
    if (!normalized.entityType || !normalized.entityId || seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(normalized);
  });
  pendingSyncConflicts = deduped;
  emitSyncConflictsUpdated();
}

function loadUserSettings() {
  const rawSettings = userSettingsStore.store || {};
  migrateLegacyByokPlaintextKeys(rawSettings);
  const merged = mergeSettings(rawSettings);
  syncByokKeyMetadataIntoSettings(merged);
  persistSidebarPinnedItems(merged.layout && merged.layout.pinnedSidebarItems ? merged.layout.pinnedSidebarItems : []);
  userSettingsStore.set(merged);
  return merged;
}

function syncSettingsState() {
  settings = mergeSettings(settings);
  syncByokKeyMetadataIntoSettings(settings);
  persistSidebarPinnedItems(settings.layout && settings.layout.pinnedSidebarItems ? settings.layout.pinnedSidebarItems : []);
  userSettingsStore.set(settings);
  selectedModel = settings.model;
  selectedTheme = settings.theme;
}

function isSafeStorageUsable() {
  if (_safeStorageAvailableCache !== null) {
    return _safeStorageAvailableCache;
  }
  try {
    _safeStorageAvailableCache = safeStorage.isEncryptionAvailable();
    return _safeStorageAvailableCache;
  } catch (e) {
    _safeStorageAvailableCache = false;
    return false;
  }
}

function getSafeStorageAvailabilityHint() {
  if (_safeStorageAvailableCache === null) {
    return true;
  }
  return _safeStorageAvailableCache;
}

function ensureSafeStorageAvailable(purpose = 'secure secret storage') {
  if (!isSafeStorageUsable()) {
    throw new Error(`Secure storage is unavailable for ${purpose} on this device`);
  }
}

function encryptSecretForStore(secret, purpose = 'secret') {
  const value = typeof secret === 'string' ? secret : '';
  if (!value) return '';
  ensureSafeStorageAvailable(purpose);
  return safeStorage.encryptString(value).toString('base64');
}

function decryptSecretFromStore(encodedSecret, purpose = 'secret') {
  const raw = typeof encodedSecret === 'string' ? encodedSecret.trim() : '';
  if (!raw) return '';
  ensureSafeStorageAvailable(purpose);
  return safeStorage.decryptString(Buffer.from(raw, 'base64'));
}

function readByokSecretState() {
  const raw = byokSecretStore.store || {};
  const encryptedKeys = normalizeByokEncryptedKeyMap(raw.encryptedKeys || {});
  const keyMeta = normalizeByokMetaMap(raw.keyMeta || {});
  const hasEncryptedSecrets = hasAnyByokEncryptedSecret(encryptedKeys);
  const hasMetaPresence = hasAnyByokKeyMetaPresent(keyMeta);
  const inferredSecureStoragePrimed = hasEncryptedSecrets || hasMetaPresence;
  BYOK_PROVIDERS.forEach((provider) => {
    const hasEncrypted = typeof encryptedKeys[provider] === 'string' && !!encryptedKeys[provider].trim();
    if (!hasEncrypted) {
      keyMeta[provider] = { present: false, last4: '' };
      return;
    }
    if (!keyMeta[provider].present) {
      keyMeta[provider] = {
        present: true,
        last4: keyMeta[provider].last4 || '',
      };
    }
  });
  return {
    encryptedKeys,
    keyMeta,
    secureStoragePrimed: raw.secureStoragePrimed === true || inferredSecureStoragePrimed,
    secureStoragePrimedAt: Number(raw.secureStoragePrimedAt || 0),
    migrationCompleted: raw.migrationCompleted === true,
    encryptionVersion: Number(raw.encryptionVersion || 1) || 1,
  };
}

function writeByokSecretState(nextState = {}) {
  const normalized = {
    encryptedKeys: normalizeByokEncryptedKeyMap(nextState.encryptedKeys || {}),
    keyMeta: normalizeByokMetaMap(nextState.keyMeta || {}),
    secureStoragePrimed: nextState.secureStoragePrimed === true,
    secureStoragePrimedAt: Number(nextState.secureStoragePrimedAt || 0),
    migrationCompleted: nextState.migrationCompleted === true,
    encryptionVersion: Number(nextState.encryptionVersion || 1) || 1,
  };
  byokSecretStore.set(normalized);
}

function warmByokApiKeyCache() {
  if (_byokApiKeyCache) {
    return _byokApiKeyCache;
  }
  const state = readByokSecretState();
  const cache = {};
  BYOK_PROVIDERS.forEach((provider) => {
    const encryptedValue = state.encryptedKeys[provider];
    if (!encryptedValue) {
      cache[provider] = '';
      return;
    }
    try {
      cache[provider] = decryptSecretFromStore(encryptedValue, `BYOK ${provider} key`);
    } catch (error) {
      console.error(`[byok] Failed to decrypt key for ${provider}:`, error.message);
      cache[provider] = '';
    }
  });
  _byokApiKeyCache = cache;
  return _byokApiKeyCache;
}

function getByokApiKey(provider) {
  if (!BYOK_PROVIDERS.includes(provider)) return '';
  const cache = warmByokApiKeyCache();
  return typeof cache[provider] === 'string' ? cache[provider] : '';
}

function listByokKeyStatus() {
  return normalizeByokMetaMap(readByokSecretState().keyMeta || {});
}

function setByokApiKey(provider, apiKey) {
  if (!BYOK_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported BYOK provider: ${provider}`);
  }
  const normalized = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!normalized) {
    throw new Error(`Missing BYOK API key for ${provider}`);
  }

  const state = readByokSecretState();
  state.encryptedKeys[provider] = encryptSecretForStore(normalized, `BYOK ${provider} key`);
  state.keyMeta[provider] = {
    present: true,
    last4: getKeyLast4(normalized),
  };
  state.secureStoragePrimed = true;
  state.secureStoragePrimedAt = Date.now();
  state.migrationCompleted = true;
  writeByokSecretState(state);

  const cache = warmByokApiKeyCache();
  cache[provider] = normalized;
  return {
    present: true,
    last4: getKeyLast4(normalized),
  };
}

function clearByokApiKey(provider) {
  if (!BYOK_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported BYOK provider: ${provider}`);
  }
  const state = readByokSecretState();
  state.encryptedKeys[provider] = '';
  state.keyMeta[provider] = {
    present: false,
    last4: '',
  };
  state.migrationCompleted = true;
  writeByokSecretState(state);
  const cache = warmByokApiKeyCache();
  cache[provider] = '';
  return {
    present: false,
    last4: '',
  };
}

function syncByokKeyMetadataIntoSettings(targetSettings = null) {
  const destination = targetSettings && typeof targetSettings === 'object' ? targetSettings : settings;
  if (!destination || typeof destination !== 'object') return;
  destination.aiEngine = destination.aiEngine && typeof destination.aiEngine === 'object'
    ? destination.aiEngine
    : {};
  destination.aiEngine.apiKeys = listByokKeyStatus();
  destination.aiEngine = normalizeAiEngineRoutingSettings(
    destination.aiEngine,
    destination.mode || 'local',
    destination.aiEngine.apiKeys
  );
}

function migrateLegacyByokPlaintextKeys(rawSettings = {}) {
  const byokState = readByokSecretState();
  if (byokState.migrationCompleted) {
    return;
  }

  const aiEngine = rawSettings && rawSettings.aiEngine && typeof rawSettings.aiEngine === 'object'
    ? rawSettings.aiEngine
    : {};
  const rawApiKeys = aiEngine && aiEngine.apiKeys && typeof aiEngine.apiKeys === 'object'
    ? aiEngine.apiKeys
    : {};

  const legacyPlaintextKeys = {};
  BYOK_PROVIDERS.forEach((provider) => {
    const candidate = typeof rawApiKeys[provider] === 'string' ? rawApiKeys[provider].trim() : '';
    if (candidate) {
      legacyPlaintextKeys[provider] = candidate;
    }
  });

  const hasLegacyKeys = Object.keys(legacyPlaintextKeys).length > 0;
  if (!hasLegacyKeys) {
    byokState.migrationCompleted = true;
    writeByokSecretState(byokState);
    return;
  }

  try {
    BYOK_PROVIDERS.forEach((provider) => {
      const secret = legacyPlaintextKeys[provider];
      if (!secret) return;
      byokState.encryptedKeys[provider] = encryptSecretForStore(secret, `BYOK ${provider} key migration`);
      byokState.keyMeta[provider] = {
        present: true,
        last4: getKeyLast4(secret),
      };
    });
    byokState.migrationCompleted = true;
    writeByokSecretState(byokState);
    _byokApiKeyCache = null;
  } catch (error) {
    console.error('[byok] Failed to migrate legacy plaintext BYOK keys:', error.message);
  }
}

function readAuthJwt() {
  if (_cachedJwtString !== null) {
    return _cachedJwtString || null;
  }

  const encryptedJwt = authStore.get('encryptedJwt');
  if (encryptedJwt) {
    try {
      const decrypted = decryptSecretFromStore(encryptedJwt, 'auth access token');
      if (decrypted && typeof decrypted === 'string') {
        _cachedJwtString = decrypted;
        return decrypted;
      }
    } catch (error) {
      console.error('Failed to decrypt auth token:', error.message);
    }
  }

  return null;
}

function hasStoredAuthJwt() {
  const encryptedJwt = authStore.get('encryptedJwt');
  return typeof encryptedJwt === 'string' && !!encryptedJwt.trim();
}

function writeAuthJwt(jwt, source = 'unknown') {
  if (!jwt || typeof jwt !== 'string') {
    throw new Error('Invalid auth token');
  }

  _cachedJwtString = jwt;
  authStore.set({
    encryptedJwt: encryptSecretForStore(jwt, 'auth access token'),
    lastLoginAt: Date.now(),
    tokenSource: source,
  });
}

function migrateLegacyAuthSecrets() {
  const legacyAccessToken = String(authStore.get('fallbackJwt') || '').trim();
  const legacyRefreshToken = String(authStore.get('refreshToken') || '').trim();
  if (!legacyAccessToken && !legacyRefreshToken) {
    return;
  }

  const encryptedJwt = String(authStore.get('encryptedJwt') || '').trim();
  const encryptedRefreshToken = String(authStore.get('encryptedRefreshToken') || '').trim();

  try {
    const nextEncryptedJwt = encryptedJwt || (legacyAccessToken
      ? encryptSecretForStore(legacyAccessToken, 'auth access token migration')
      : '');
    const nextEncryptedRefresh = encryptedRefreshToken || (legacyRefreshToken
      ? encryptSecretForStore(legacyRefreshToken, 'auth refresh token migration')
      : '');
    authStore.set({
      encryptedJwt: nextEncryptedJwt,
      encryptedRefreshToken: nextEncryptedRefresh,
      fallbackJwt: '',
      usingFallbackStorage: false,
      refreshToken: '',
    });
  } catch (error) {
    console.error('[auth] Failed to migrate legacy plaintext auth tokens:', error.message);
    authStore.set({
      fallbackJwt: '',
      usingFallbackStorage: false,
      refreshToken: '',
    });
  }
}

// --- Token Auto-Refresh ---

let _refreshInFlight = null; // Deduplicate concurrent refresh attempts

/**
 * Attempt to refresh the access token using the stored refresh token.
 * Returns the new access token on success, or null if refresh fails
 * (e.g. refresh token also expired → user must re-login).
 */
async function refreshAuthToken() {
  // Deduplicate: if a refresh is already in-flight, await it
  if (_refreshInFlight) {
    return _refreshInFlight;
  }

  _refreshInFlight = (async () => {
    const storedRefreshToken = readStoredRefreshToken();
    if (!storedRefreshToken) {
      console.warn('[auth] No refresh token available — cannot auto-refresh');
      return null;
    }

    try {
      const result = await requestJson({
        targetUrl: `${BACKEND_BASE_URL}/api/auth/refresh`,
        method: 'POST',
        body: {
          refreshToken: storedRefreshToken,
          deviceIdHash: getDeviceIdHash(),
        },
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        console.warn(`[auth] Refresh token request failed with status ${result.statusCode}`);
        return null;
      }

      const newAccessToken = result.payload && typeof result.payload.accessToken === 'string'
        ? result.payload.accessToken
        : '';
      if (!newAccessToken) {
        console.warn('[auth] Refresh response missing access token');
        return null;
      }

      _cachedJwtString = newAccessToken;
      writeAuthJwt(newAccessToken, 'refresh');
      writeAuthProfile({
        refreshToken: result.payload && typeof result.payload.refreshToken === 'string'
          ? result.payload.refreshToken
          : storedRefreshToken,
        email: result.payload && result.payload.user && typeof result.payload.user.email === 'string'
          ? result.payload.user.email
          : String(authStore.get('email') || ''),
        displayName: result.payload && result.payload.user && typeof result.payload.user.displayName === 'string'
          ? result.payload.user.displayName
          : String(authStore.get('displayName') || ''),
        plan: result.payload && result.payload.user && typeof result.payload.user.plan === 'string'
          ? result.payload.user.plan
          : String(authStore.get('plan') || ''),
      });

      broadcastAuthState();
      console.log('[auth] Token refreshed successfully');
      return newAccessToken;
    } catch (err) {
      console.error('[auth] Token refresh failed:', err.message);
      return null;
    }
  })();

  try {
    return await _refreshInFlight;
  } finally {
    _refreshInFlight = null;
  }
}

/**
 * Decode a JWT payload without verification (just to read expiry).
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(payloadB64, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (_e) {
    return null;
  }
}

/**
 * Check if a JWT is expired or will expire within `marginMs` milliseconds.
 */
function isJwtExpiringSoon(token, marginMs = 60_000) {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  const expiresAtMs = payload.exp * 1000;
  return Date.now() >= (expiresAtMs - marginMs);
}

function switchToLocalProcessingAfterAuthLoss(reason = 'auth-loss') {
  settings.mode = 'local';
  settings.processingModes = normalizeProcessingModes(PROCESSING_MODE_DEFAULTS, 'local');
  settings.aiEngine = normalizeAiEngineRoutingSettings(
    settings.aiEngine,
    settings.mode,
    listByokKeyStatus()
  );
  persistSettings();
  warmLocalSttRuntimeIfNeeded(reason);
}

/**
 * Read the stored JWT, and if it is expired or about to expire,
 * proactively refresh it before returning. Returns null if both
 * the access token and refresh token are invalid.
 */
async function readAuthJwtWithAutoRefresh() {
  const jwt = readAuthJwt();
  if (!jwt) return null;

  if (!isJwtExpiringSoon(jwt)) {
    return jwt;
  }

  console.log('[auth] Access token expired or expiring soon — attempting auto-refresh');
  const refreshedJwt = await refreshAuthToken();
  if (refreshedJwt) {
    return refreshedJwt;
  }

  // Refresh failed — clear auth and force re-login
  console.warn('[auth] Auto-refresh failed — clearing auth state');
  clearAuthJwt();
  broadcastAuthState();
  switchToLocalProcessingAfterAuthLoss('auth-refresh-failed');
  return null;
}

function handleCloudTrialExhausted(detail = {}) {
  const shouldLockStrictPrivacy = settings && settings.mode === 'pro';
  const alreadyStrict = settings && settings.syncSettings && settings.syncSettings.strictPrivacyMode === true;

  if (shouldLockStrictPrivacy && !alreadyStrict) {
    settings.syncSettings = {
      ...(settings.syncSettings || {}),
      strictPrivacyMode: true,
    };
    persistSettings();
  }

  const message = 'Cloud Trial Exhausted. Switched to Local processing';
  const now = Date.now();
  if ((now - lastTrialExhaustedNoticeAt) > 10_000) {
    lastTrialExhaustedNoticeAt = now;

    if (Notification && Notification.isSupported && Notification.isSupported()) {
      try {
        const notification = new Notification({
          title: 'Escribolt',
          body: message,
        });
        notification.show();
      } catch (_err) {
        // Ignore notification delivery failures.
      }
    }
  }

  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('cloud-trial-exhausted', {
      message,
      detail,
    });
  }
}

function isTrialExhaustedResponseError(error) {
  const message = String(error && error.message ? error.message : '').toUpperCase();
  return message.includes('TRIAL_EXHAUSTED') || message.includes('QUOTA_EXCEEDED') || message.includes('LIMIT_EXCEEDED');
}

function meterHasRemainingQuota(meter = {}) {
  const limit = Number(meter && meter.limit);
  const used = Number(meter && meter.used);
  if (!Number.isFinite(limit) || limit <= 0) {
    return false;
  }
  if (!Number.isFinite(used)) {
    return true;
  }
  return used < limit;
}

function usageAllowsCloudQuota(usage = {}, quota = '') {
  if (!usage || typeof usage !== 'object' || usage.error) {
    return false;
  }
  if (usage.cloudAccess === false) {
    return false;
  }
  if (quota === 'stt') {
    const trialRemaining = Number(usage.trialRemaining && usage.trialRemaining.sttSeconds);
    return meterHasRemainingQuota(usage.stt) || (Number.isFinite(trialRemaining) && trialRemaining > 0);
  }
  if (quota === 'ai') {
    const trialRemaining = Number(usage.trialRemaining && usage.trialRemaining.aiActions);
    return meterHasRemainingQuota(usage.aiActions) || (Number.isFinite(trialRemaining) && trialRemaining > 0);
  }
  return false;
}

async function fetchCurrentUsageSummary() {
  const result = await proRequestWithAutoRefresh((jwt) => requestJson({
    targetUrl: `${BACKEND_BASE_URL}/api/usage/current`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  }));

  if (result.statusCode < 200 || result.statusCode >= 300) {
    return {
      error: (result.payload && result.payload.error)
        ? result.payload.error
        : `Usage request failed with status ${result.statusCode}`,
    };
  }

  return result.payload || { error: 'Empty usage response' };
}

async function applyCloudProcessingDefaultsForEligibleAccount(reason = 'auth') {
  try {
    const usage = await fetchCurrentUsageSummary();
    const sttAllowed = usageAllowsCloudQuota(usage, 'stt');
    const aiAllowed = usageAllowsCloudQuota(usage, 'ai');
    const patch = {};

    if (sttAllowed) {
      patch.dictation = 'cloud';
      patch.meetingTranscription = 'cloud';
    }
    if (aiAllowed) {
      patch.aiActions = 'cloud';
      patch.summaries = 'cloud';
    }
    if (!Object.keys(patch).length) {
      console.log(`[auth] Cloud defaults skipped (${reason}): no remaining quota.`);
      return false;
    }

    settings.mode = 'pro';
    settings.processingModes = buildProcessingModePatch(
      patch,
      settings.processingModes || PROCESSING_MODE_DEFAULTS,
    );
    settings.aiEngine = normalizeAiEngineRoutingSettings(
      settings.aiEngine,
      settings.mode,
      listByokKeyStatus(),
    );
    persistSettings();
    syncRecordModeWidget(trayRecordModeStatus);

    const latestUiSettings = getUiSettings();
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send('ui-settings-updated', latestUiSettings);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ui-settings-updated', latestUiSettings);
    }
    console.log(`[auth] Cloud processing defaults applied (${reason}): ${Object.keys(patch).join(', ')}`);
    return true;
  } catch (error) {
    console.warn(`[auth] Cloud defaults check failed (${reason}):`, error && error.message ? error.message : error);
    return false;
  }
}

/**
 * Execute a PRO API call with automatic token refresh on 401/TOKEN_EXPIRED.
 * `callFn` receives a valid JWT and should return { statusCode, payload }.
 * On 401, we refresh the token and retry once.
 * Returns the result from the last attempt.
 */
async function proRequestWithAutoRefresh(callFn) {
  let jwt = await readAuthJwtWithAutoRefresh();
  if (!jwt) {
    throw new Error('PRO authentication is required (no valid token)');
  }

  const result = await callFn(jwt);

  if (result && result.statusCode === 403 && result.payload && result.payload.code === 'TRIAL_EXHAUSTED') {
    handleCloudTrialExhausted(result.payload);
  }

  // If not a 401, return as-is
  if (result.statusCode !== 401) {
    return result;
  }

  // Check if it's TOKEN_EXPIRED specifically
  const isTokenExpired = result.payload
    && (result.payload.code === 'TOKEN_EXPIRED' || result.payload.error === 'Token expired');

  if (!isTokenExpired) {
    // Non-token-related 401 (e.g. wrong token type) — don't retry
    clearAuthJwt();
    broadcastAuthState();
    switchToLocalProcessingAfterAuthLoss('pro-auth-401');
    return result;
  }

  // Attempt refresh + retry
  console.log('[auth] 401 TOKEN_EXPIRED received — attempting refresh and retry');
  const refreshedJwt = await refreshAuthToken();
  if (!refreshedJwt) {
    clearAuthJwt();
    broadcastAuthState();
    switchToLocalProcessingAfterAuthLoss('pro-auth-refresh-failed');
    return result;
  }

  const retried = await callFn(refreshedJwt);
  if (retried && retried.statusCode === 403 && retried.payload && retried.payload.code === 'TRIAL_EXHAUSTED') {
    handleCloudTrialExhausted(retried.payload);
  }
  return retried;
}

function clearAuthJwt() {
  authStore.set({
    encryptedJwt: '',
    encryptedRefreshToken: '',
    lastLoginAt: 0,
    tokenSource: '',
    email: '',
    displayName: '',
    plan: '',
  });
  cachedProDeepgramCredential = null;
  _cachedJwtString = null; // Clear in-memory cache
  _cachedRefreshToken = null;
}

function readStoredRefreshToken() {
  if (_cachedRefreshToken !== null) {
    return _cachedRefreshToken;
  }
  const encrypted = authStore.get('encryptedRefreshToken');
  if (typeof encrypted !== 'string' || !encrypted.trim()) {
    _cachedRefreshToken = '';
    return '';
  }
  try {
    const decrypted = decryptSecretFromStore(encrypted, 'auth refresh token');
    _cachedRefreshToken = decrypted || '';
    return _cachedRefreshToken;
  } catch (error) {
    console.error('Failed to decrypt refresh token:', error.message);
    _cachedRefreshToken = '';
    return '';
  }
}

function getStoredAuthProfile() {
  return {
    refreshToken: readStoredRefreshToken(),
    email: String(authStore.get('email') || ''),
    displayName: String(authStore.get('displayName') || ''),
    plan: String(authStore.get('plan') || ''),
  };
}

function writeAuthProfile(profile = {}) {
  const refreshToken = typeof profile.refreshToken === 'string' ? profile.refreshToken.trim() : '';
  _cachedRefreshToken = refreshToken;
  authStore.set({
    encryptedRefreshToken: refreshToken
      ? encryptSecretForStore(refreshToken, 'auth refresh token')
      : '',
    email: typeof profile.email === 'string' ? profile.email : '',
    displayName: typeof profile.displayName === 'string' ? profile.displayName : '',
    plan: typeof profile.plan === 'string' ? profile.plan : '',
  });
}

function getAuthState() {
  const encryptedJwt = authStore.get('encryptedJwt');
  const encryptedRefreshToken = authStore.get('encryptedRefreshToken');
  const hasToken = typeof encryptedJwt === 'string' && !!encryptedJwt.trim();
  const hasRefreshToken = typeof encryptedRefreshToken === 'string' && !!encryptedRefreshToken.trim();
  const lastLoginAt = Number(authStore.get('lastLoginAt') || 0);
  const profile = {
    email: String(authStore.get('email') || ''),
    displayName: String(authStore.get('displayName') || ''),
    plan: String(authStore.get('plan') || ''),
  };
  const resolvedPlan = hasToken ? (profile.plan || 'free') : 'free';
  return {
    isLoggedIn: hasToken,
    plan: resolvedPlan,
    email: profile.email || undefined,
    displayName: profile.displayName || undefined,
    accessToken: hasToken ? '__stored__' : undefined,
    refreshToken: hasRefreshToken ? '__stored__' : undefined,
    secureStorageAvailable: getSafeStorageAvailabilityHint(),
    usingFallbackStorage: false,
    lastLoginAt: lastLoginAt > 0 ? lastLoginAt : null,
  };
}

function broadcastAuthState() {
  const authState = getAuthState();
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('auth-state-updated', authState);
  }
}

function extractAuthPayloadFromDeepLink(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== `${APP_PROTOCOL}:`) {
      return null;
    }
    if (parsed.hostname !== 'auth') {
      return null;
    }
    const accessToken = (
      parsed.searchParams.get('token')
      || parsed.searchParams.get('jwt')
      || parsed.searchParams.get('access_token')
      || ''
    ).trim();
    const refreshToken = (
      parsed.searchParams.get('refresh_token')
      || parsed.searchParams.get('refreshToken')
      || ''
    ).trim();

    if (!accessToken) {
      return null;
    }

    return {
      accessToken,
      refreshToken,
    };
  } catch (e) {
    return null;
  }
}

function handleAuthDeepLink(urlString) {
  const authPayload = extractAuthPayloadFromDeepLink(urlString);
  if (!authPayload || !authPayload.accessToken) {
    return false;
  }

  try {
    writeAuthJwt(authPayload.accessToken, 'deeplink');
    const payload = decodeJwtPayload(authPayload.accessToken);
    writeAuthProfile({
      refreshToken: authPayload.refreshToken || readStoredRefreshToken(),
      email: payload && typeof payload.email === 'string' ? payload.email : String(authStore.get('email') || ''),
      displayName: String(authStore.get('displayName') || ''),
      plan: payload && typeof payload.plan === 'string' ? payload.plan : String(authStore.get('plan') || 'free'),
    });
    settings.mode = 'pro';
    settings.aiEngine.sttProvider = 'deepgram';
    settings.aiEngine.llmProvider = PRO_LLM_PROVIDER_ID;
    settings.aiEngine.summaryProvider = PRO_LLM_PROVIDER_ID;
    settings.aiEngine.llmModel = normalizeProLlmModelAlias(settings.aiEngine.llmModel);
    settings.aiEngine.summaryModel = normalizeProLlmModelAlias(settings.aiEngine.summaryModel);

    persistSettings();
    broadcastAuthState();
    applyCloudProcessingDefaultsForEligibleAccount('auth-deeplink').catch((error) => {
      console.warn('[auth] Cloud defaults application failed:', error && error.message ? error.message : error);
    });
    createDashboardWindow();
    return true;
  } catch (e) {
    console.error('Failed to persist auth token from deep link:', e.message);
    return false;
  }
}

function computeDeviceIdHash() {
  if (cachedDeviceIdHash !== null) {
    return cachedDeviceIdHash;
  }
  if (typeof machineIdSync !== 'function') {
    if (!loggedMissingDeviceIdWarning) {
      loggedMissingDeviceIdWarning = true;
      console.warn('[auth] Device hash unavailable because node-machine-id could not be loaded.');
    }
    cachedDeviceIdHash = '';
    return cachedDeviceIdHash;
  }
  try {
    const rawMachineId = String(machineIdSync({ original: true }) || '').trim();
    if (!rawMachineId) {
      cachedDeviceIdHash = '';
      return cachedDeviceIdHash;
    }
    cachedDeviceIdHash = crypto
      .createHash('sha256')
      .update(`${DEVICE_ID_HASH_SALT}:${rawMachineId}`)
      .digest('hex');
    return cachedDeviceIdHash;
  } catch (error) {
    console.warn('[auth] Failed to compute device ID hash:', error.message);
    cachedDeviceIdHash = '';
    return cachedDeviceIdHash;
  }
}

function getDeviceIdHash() {
  const hash = computeDeviceIdHash();
  return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash) ? hash : '';
}

function requestJson({ targetUrl, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      reject(new Error(`Invalid URL: ${targetUrl}`));
      return;
    }

    const transport = parsed.protocol === 'https:' ? https : http;
    const hasBody = body !== null && body !== undefined;
    let requestBody = null;
    let inferredJsonBody = false;
    if (hasBody) {
      if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        requestBody = Buffer.from(body);
      } else if (typeof body === 'string') {
        requestBody = Buffer.from(body);
      } else {
        requestBody = Buffer.from(JSON.stringify(body));
        inferredJsonBody = true;
      }
    }

    const normalizedHeaders = {
      ...headers,
    };
    const deviceIdHash = getDeviceIdHash();
    if (deviceIdHash && !normalizedHeaders['X-Device-Id-Hash'] && !normalizedHeaders['x-device-id-hash']) {
      normalizedHeaders['X-Device-Id-Hash'] = deviceIdHash;
    }

    const req = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: {
        Accept: 'application/json',
        ...((requestBody && inferredJsonBody && !normalizedHeaders['Content-Type']) ? { 'Content-Type': 'application/json' } : {}),
        ...(requestBody ? { 'Content-Length': Buffer.byteLength(requestBody) } : {}),
        ...normalizedHeaders,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let payload = null;
        if (raw) {
          try {
            payload = JSON.parse(raw);
          } catch (e) {
            payload = { raw };
          }
        }
        resolve({
          statusCode: res.statusCode || 0,
          payload,
          headers: res.headers || {},
        });

        if ((res.statusCode || 0) === 403 && payload && payload.code === 'TRIAL_EXHAUSTED') {
          handleCloudTrialExhausted(payload);
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (requestBody) req.write(requestBody);
    req.end();
  });
}

function extractMessageContent(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (typeof payload.text === 'string' && payload.text.trim()) {
    return payload.text.trim();
  }
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (Array.isArray(payload.choices) && payload.choices.length > 0) {
    const content = payload.choices[0]
      && payload.choices[0].message
      && payload.choices[0].message.content;

    if (typeof content === 'string') {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const joined = content
        .map((item) => (item && typeof item.text === 'string' ? item.text : ''))
        .join('\n')
        .trim();
      if (joined) return joined;
    }
  }

  if (Array.isArray(payload.output)) {
    const outputText = payload.output
      .flatMap((entry) => (entry && Array.isArray(entry.content) ? entry.content : []))
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
    if (outputText) return outputText;
  }

  return null;
}

function extractApiErrorMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const fromFields = [payload.error, payload.message, payload.code]
    .find((value) => typeof value === 'string' && value.trim());
  return fromFields ? fromFields.trim() : '';
}

function resolveByokLlmSelection(intent = 'ask') {
  const aiEngine = settings && settings.aiEngine ? settings.aiEngine : {};
  const keyMeta = aiEngine.apiKeys && typeof aiEngine.apiKeys === 'object'
    ? aiEngine.apiKeys
    : createEmptyByokKeyMeta();
  const isSummaryIntent = intent === 'summary' || intent === 'memory_summary';
  const preferredProvider = isSummaryIntent ? aiEngine.summaryProvider : aiEngine.llmProvider;
  const preferredModel = isSummaryIntent ? aiEngine.summaryModel : aiEngine.llmModel;

  const provider = normalizeByokLlmProvider(preferredProvider, keyMeta);
  return {
    provider,
    model: normalizeByokLlmModel(provider, preferredModel),
  };
}

function resolveProLlmModelAlias(intent = 'ask') {
  const aiEngine = settings && settings.aiEngine ? settings.aiEngine : {};
  const isSummaryIntent = intent === 'summary' || intent === 'memory_summary';
  const preferredModelAlias = isSummaryIntent ? aiEngine.summaryModel : aiEngine.llmModel;
  return normalizeProLlmModelAlias(preferredModelAlias);
}

function resolveGlobalAskContextCharLimit(route = {}) {
  if (route && route.mode === 'pro') {
    const entry = getProBrandedLlmModel(route.modelAlias || '');
    const tokens = Number(entry && entry.contextWindowTokens ? entry.contextWindowTokens : 0);
    if (Number.isFinite(tokens) && tokens > 0) {
      return Math.max(
        GLOBAL_ASK_DEFAULT_CONTEXT_CHAR_LIMIT,
        Math.floor(tokens * GLOBAL_ASK_APPROX_CHARS_PER_TOKEN)
      );
    }
  }
  return GLOBAL_ASK_DEFAULT_CONTEXT_CHAR_LIMIT;
}

function buildRecordingSummaryPrompt({ summaryLanguage } = {}) {
  const targetLanguage = resolveRecordingSummaryLanguage(summaryLanguage);
  return [
    'You are an expert note-taker and summarization assistant.',
    '',
    'Analyze the transcript privately before writing. Do not expose your analysis unless it belongs in the final summary.',
    '',
    'First determine:',
    '- the recording type: work meeting, technical discussion, lecture/training, interview, brainstorm, personal note/dictation, or unclear',
    '- the user\'s likely goal: remember, execute tasks, learn, decide, or extract follow-ups',
    '- whether the transcript contains decisions, action items, blockers, deadlines, owners, technical details, or open questions',
    '',
    `Write the final answer in ${targetLanguage.label}. This configured summary language is mandatory; do not infer the output language from the transcript.`,
    `Use ${targetLanguage.label} for all section headings, table headers, labels, explanations, and missing-detail placeholders.`,
    'Keep quoted phrases in their original language when that preserves meaning.',
    '',
    'Rules:',
    '- Do not invent facts, owners, dates, decisions, or tasks.',
    `- If an owner, date, decision, or section detail is missing, say "Not stated" translated into ${targetLanguage.label}.`,
    '- Ignore filler, repeated speech, transcription artifacts, and side chatter unless it changes the meaning.',
    '- Preserve important caveats, temporary decisions, hacks, constraints, disagreements, and uncertainty.',
    '- Use clean Markdown with short sections and scannable bullets.',
    '',
    `The following section names describe the structure; translate their wording to ${targetLanguage.label} in the final answer.`,
    '',
    'If this is a work meeting or technical discussion, use:',
    '## Snapshot',
    '## Decisions',
    '## Action Items',
    'Use a Markdown table with columns: Task, Owner, Due/Timing, Notes.',
    '## Key Details',
    '## Open Questions / Risks',
    '',
    'If this is a lecture or learning recording, use:',
    '## Core Summary',
    '## Key Concepts',
    '## Examples or Details',
    '## Things to Review',
    '',
    'If this is a brainstorm, use:',
    '## Main Themes',
    '## Promising Ideas',
    '## Decisions or Signals',
    '## Next Steps',
    '',
    'If this is a personal note, interview, or unclear recording, use the most useful compact structure:',
    '## Summary',
    '## Key Points',
    '## Follow-ups',
    '## Open Questions'
  ].join('\n');
}

function buildRecordingSummaryMessages({ transcript, summaryLanguage }) {
  const targetLanguage = resolveRecordingSummaryLanguage(summaryLanguage);
  return [
    {
      role: 'system',
      content: `You are an expert note-taker and summarization assistant. Write every final heading, table label, and explanation in ${targetLanguage.label}. Do not infer the output language from the transcript. Adapt the final Markdown structure to the transcript type, preserve facts and uncertainty, and never invent missing details.`
    },
    {
      role: 'user',
      content: `${buildRecordingSummaryPrompt({ summaryLanguage: targetLanguage.code })}\n\nTranscript:\n${transcript}`,
    },
  ];
}

const ASK_RECENT_TURN_LIMIT = 3;
const ASK_RELEVANT_TURN_LIMIT = 5;
const ASK_RELEVANCE_THRESHOLD = 0.12;
const ASK_SUMMARY_REFRESH_INTERVAL = 8;
const ASK_PRIOR_CONTEXT_CHAR_BUDGET = 6000;
const ASK_TURN_CHAR_LIMIT = 700;
const ASK_TURN_HEAD_CHAR_LIMIT = 420;
const ASK_TURN_TAIL_CHAR_LIMIT = 250;
const ASK_SUMMARY_CHAR_LIMIT = 1200;
const ASK_SPEAK_SENTENCE_REGEX = /(.+?[.!?;]+(?:\s+|$))/gs;
const GLOBAL_ASK_DEFAULT_CONTEXT_CHAR_LIMIT = 26000;
const GLOBAL_ASK_HISTORY_TURN_LIMIT = 12;
const GLOBAL_ASK_HISTORY_CHAR_LIMIT = 5200;
const GLOBAL_ASK_ALL_RECORDINGS_LIMIT = 10;
const GLOBAL_ASK_FOLDER_NOTES_LIMIT = 14;
const GLOBAL_ASK_RECORDING_EXCERPT_LIMIT = 2800;
const GLOBAL_ASK_NOTE_EXCERPT_LIMIT = 1800;
const GLOBAL_ASK_APPROX_CHARS_PER_TOKEN = 4;

const ASK_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'for', 'from', 'has', 'have', 'he', 'her', 'hers', 'him', 'his',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'ours', 'she', 'that', 'the', 'their',
  'theirs', 'them', 'they', 'this', 'to', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with',
  'you', 'your', 'yours', 'can', 'could', 'should', 'would', 'do', 'does', 'did', 'not', 'no', 'yes', 'about', 'after', 'before',
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'y', 'o', 'u', 'que', 'como', 'cuando', 'donde',
  'por', 'para', 'con', 'sin', 'sobre', 'entre', 'hacia', 'desde', 'hasta', 'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'es',
  'son', 'fue', 'fueron', 'era', 'eran', 'ser', 'estar', 'hay', 'si', 'se', 'lo', 'le', 'les', 'nos', 'yo', 'me', 'te',
]);

const recordingAskSummaryLocks = new Map();
let recordingAskSpeakSessionId = 0;

function splitAskSpeakableSentences(text, flushRemainder = false) {
  const source = String(text || '');
  if (!source) {
    return { sentences: [], remainder: '' };
  }

  const sentences = [];
  let lastIndex = 0;
  let match;
  while ((match = ASK_SPEAK_SENTENCE_REGEX.exec(source)) !== null) {
    const sentence = String(match[1] || '').trim();
    if (sentence) {
      sentences.push(sentence);
    }
    lastIndex = ASK_SPEAK_SENTENCE_REGEX.lastIndex;
  }

  let remainder = source.slice(lastIndex);
  if (flushRemainder && remainder.trim()) {
    sentences.push(remainder.trim());
    remainder = '';
  }

  ASK_SPEAK_SENTENCE_REGEX.lastIndex = 0;
  return { sentences, remainder };
}

function clampAskText(text, maxChars) {
  const source = typeof text === 'string' ? text : '';
  const clean = source.trim();
  if (!clean || clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function truncateAskTurnText(text, {
  maxChars = ASK_TURN_CHAR_LIMIT,
  headChars = ASK_TURN_HEAD_CHAR_LIMIT,
  tailChars = ASK_TURN_TAIL_CHAR_LIMIT,
} = {}) {
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!clean) return '';
  if (clean.length <= maxChars) return clean;

  const safeHead = Math.max(0, Math.min(headChars, maxChars));
  const safeTail = Math.max(0, Math.min(tailChars, maxChars - safeHead));
  const head = clean.slice(0, safeHead).trim();
  const tail = clean.slice(-safeTail).trim();
  if (!tail) return clampAskText(head, maxChars);
  return `${head}\n...\n${tail}`;
}

function tokenizeForRetrieval(text) {
  const clean = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];

  return clean
    .split(' ')
    .filter((token) => token.length >= 3 && !ASK_STOPWORDS.has(token));
}

function computeTermFrequency(tokens = []) {
  const tf = new Map();
  const safe = Array.isArray(tokens) ? tokens : [];
  if (!safe.length) return tf;
  safe.forEach((token) => {
    tf.set(token, (tf.get(token) || 0) + 1);
  });
  const total = safe.length;
  Array.from(tf.keys()).forEach((token) => {
    tf.set(token, tf.get(token) / total);
  });
  return tf;
}

function cosineSimilarityFromMaps(vecA = new Map(), vecB = new Map()) {
  if (!vecA.size || !vecB.size) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  vecA.forEach((value) => {
    normA += value * value;
  });
  vecB.forEach((value) => {
    normB += value * value;
  });
  if (normA <= 0 || normB <= 0) return 0;

  vecA.forEach((value, token) => {
    dot += value * (vecB.get(token) || 0);
  });
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildAskTurns(messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  const turns = [];
  let currentTurn = null;

  const flushTurn = () => {
    if (!currentTurn) return;
    turns.push({
      ...currentTurn,
      text: currentTurn.lines.join('\n'),
    });
    currentTurn = null;
  };

  source.forEach((message, index) => {
    const role = message && message.role === 'assistant' ? 'assistant' : 'user';
    const text = String(message && message.text ? message.text : '').trim();
    if (!text) return;

    const createdAtRaw = Number(message && message.createdAt ? message.createdAt : Date.now());
    const createdAt = Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now();
    const messageId = message && typeof message.id === 'string' && message.id
      ? message.id
      : `msg-${createdAt}-${index}`;

    if (role === 'user' || !currentTurn) {
      flushTurn();
      currentTurn = {
        id: `turn-${messageId}`,
        userMessageId: messageId,
        createdAt,
        messageIds: [messageId],
        lines: [`User: ${text}`],
      };
      return;
    }

    currentTurn.messageIds.push(messageId);
    currentTurn.lines.push(`Assistant: ${text}`);
  });
  flushTurn();

  return turns.map((turn, index) => ({
    ...turn,
    index,
  }));
}

function scoreTurns(question, turns = []) {
  const safeTurns = Array.isArray(turns) ? turns : [];
  if (!safeTurns.length) return [];

  const questionTokens = tokenizeForRetrieval(question);
  const questionTokenSet = new Set(questionTokens);
  const turnTokens = safeTurns.map((turn) => tokenizeForRetrieval(turn.text));
  const docFrequency = new Map();

  turnTokens.forEach((tokens) => {
    const uniqueTokens = new Set(tokens);
    uniqueTokens.forEach((token) => {
      docFrequency.set(token, (docFrequency.get(token) || 0) + 1);
    });
  });

  const docCount = safeTurns.length;
  const idf = (token) => {
    const df = docFrequency.get(token) || 0;
    return Math.log((1 + docCount) / (1 + df)) + 1;
  };

  const questionTf = computeTermFrequency(questionTokens);
  const questionVec = new Map();
  questionTf.forEach((value, token) => {
    questionVec.set(token, value * idf(token));
  });

  return safeTurns.map((turn, index) => {
    const tokens = turnTokens[index];
    const turnTf = computeTermFrequency(tokens);
    const turnVec = new Map();
    turnTf.forEach((value, token) => {
      turnVec.set(token, value * idf(token));
    });

    const cosineSim = cosineSimilarityFromMaps(questionVec, turnVec);
    let overlapCount = 0;
    if (questionTokenSet.size > 0) {
      questionTokenSet.forEach((token) => {
        if (turnTf.has(token)) overlapCount += 1;
      });
    }
    const keywordOverlapRatio = questionTokenSet.size > 0
      ? overlapCount / questionTokenSet.size
      : 0;
    const ageTurns = Math.max(0, (safeTurns.length - 1) - index);
    const recencyDecay = Math.exp(-(ageTurns / 6));
    const score = (cosineSim * 0.55) + (keywordOverlapRatio * 0.30) + (recencyDecay * 0.15);

    return {
      ...turn,
      cosineSim,
      keywordOverlapRatio,
      recencyDecay,
      score,
    };
  });
}

function formatAskTurnEntry(turn, { maxChars = ASK_TURN_CHAR_LIMIT, includeScore = false } = {}) {
  if (!turn || typeof turn.text !== 'string') return null;
  const truncated = truncateAskTurnText(turn.text, {
    maxChars,
    headChars: Math.min(ASK_TURN_HEAD_CHAR_LIMIT, maxChars),
    tailChars: Math.min(ASK_TURN_TAIL_CHAR_LIMIT, Math.max(0, maxChars - Math.min(ASK_TURN_HEAD_CHAR_LIMIT, maxChars))),
  });
  if (!truncated) return null;

  const scorePart = includeScore && Number.isFinite(turn.score)
    ? ` | score=${turn.score.toFixed(3)}`
    : '';
  const promptText = `[${turn.id}${scorePart}]\n${truncated}`;
  return {
    id: turn.id,
    score: Number.isFinite(turn.score) ? turn.score : 0,
    promptText,
    rawText: truncated,
    charCount: promptText.length,
  };
}

function selectAskContextTurns({
  question,
  messages,
  rollingSummary = '',
}) {
  const turns = buildAskTurns(messages);
  const scoredTurns = scoreTurns(question, turns);
  const recentTurns = scoredTurns.slice(-ASK_RECENT_TURN_LIMIT);
  const recentIds = new Set(recentTurns.map((turn) => turn.id));
  const relevantTurns = scoredTurns
    .filter((turn) => !recentIds.has(turn.id) && turn.score >= ASK_RELEVANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, ASK_RELEVANT_TURN_LIMIT)
    .sort((a, b) => a.index - b.index);

  const summaryText = clampAskText(rollingSummary, ASK_SUMMARY_CHAR_LIMIT);
  let remainingBudget = ASK_PRIOR_CONTEXT_CHAR_BUDGET;
  if (summaryText) {
    remainingBudget -= (`Thread summary:\n${summaryText}\n\n`).length;
  }
  remainingBudget = Math.max(0, remainingBudget);

  const packedRelevant = [];
  relevantTurns.forEach((turn) => {
    if (remainingBudget < 80) return;
    const maxChars = Math.max(120, Math.min(ASK_TURN_CHAR_LIMIT, remainingBudget - 24));
    const entry = formatAskTurnEntry(turn, { maxChars, includeScore: true });
    if (!entry) return;
    packedRelevant.push(entry);
    remainingBudget -= (entry.charCount + 2);
  });

  const packedRecent = [];
  recentTurns.forEach((turn) => {
    if (remainingBudget < 80) return;
    const maxChars = Math.max(120, Math.min(ASK_TURN_CHAR_LIMIT, remainingBudget - 24));
    const entry = formatAskTurnEntry(turn, { maxChars, includeScore: false });
    if (!entry) return;
    packedRecent.push(entry);
    remainingBudget -= (entry.charCount + 2);
  });

  const scoresByTurnId = {};
  scoredTurns.forEach((turn) => {
    scoresByTurnId[turn.id] = Number(turn.score.toFixed(6));
  });

  const selectedTurnIds = Array.from(new Set([
    ...packedRelevant.map((entry) => entry.id),
    ...packedRecent.map((entry) => entry.id),
  ]));
  const contextCharCount = ASK_PRIOR_CONTEXT_CHAR_BUDGET - remainingBudget;

  return {
    summaryText,
    packedRelevant,
    packedRecent,
    selectedTurnIds,
    scoresByTurnId,
    contextCharCount,
    totalTurnCount: turns.length,
  };
}

function buildFallbackAskContext({
  messages,
  rollingSummary = '',
}) {
  const turns = buildAskTurns(messages);
  const recentTurns = turns.slice(-ASK_RECENT_TURN_LIMIT);
  const summaryText = clampAskText(rollingSummary, ASK_SUMMARY_CHAR_LIMIT);
  const packedRecent = recentTurns
    .map((turn) => formatAskTurnEntry(turn, { maxChars: ASK_TURN_CHAR_LIMIT, includeScore: false }))
    .filter(Boolean);

  const selectedTurnIds = packedRecent.map((entry) => entry.id);
  let contextCharCount = 0;
  if (summaryText) contextCharCount += summaryText.length;
  packedRecent.forEach((entry) => { contextCharCount += entry.charCount; });

  return {
    summaryText,
    packedRelevant: [],
    packedRecent,
    selectedTurnIds,
    scoresByTurnId: {},
    contextCharCount,
    totalTurnCount: turns.length,
    isFallback: true,
  };
}



function normalizeGlobalAskContextSelection(selection = {}) {
  const rawKind = String(selection && selection.kind ? selection.kind : '').trim().toLowerCase();
  const rawId = String(selection && selection.id ? selection.id : '').trim();
  if (rawKind === 'recording') {
    return { kind: 'recording', id: rawId || '' };
  }
  if (rawKind === 'note') {
    return { kind: 'note', id: rawId || '' };
  }
  if (rawKind === 'folder') {
    return { kind: 'folder', id: rawId || '' };
  }
  return { kind: 'all_recordings' };
}

function normalizeGlobalAskModelSelection(selection = {}) {
  const rawMode = String(selection && selection.mode ? selection.mode : '').trim().toLowerCase();
  if (rawMode === 'local') {
    return { mode: 'local' };
  }
  if (rawMode === 'byok') {
    return {
      mode: 'byok',
      provider: String(selection && selection.provider ? selection.provider : '').trim().toLowerCase(),
      model: String(selection && selection.model ? selection.model : '').trim(),
    };
  }
  if (rawMode === 'pro') {
    return {
      mode: 'pro',
      modelAlias: normalizeProLlmModelAlias(selection && selection.modelAlias ? selection.modelAlias : ''),
    };
  }
  return { mode: 'auto' };
}

function normalizeGlobalAskHistoryMessages(history = []) {
  const source = Array.isArray(history) ? history : [];
  const normalized = source
    .map((entry, index) => {
      const role = entry && entry.role === 'assistant' ? 'assistant' : 'user';
      const content = String(entry && entry.content ? entry.content : '').trim();
      const createdAtRaw = Number(entry && entry.createdAt ? entry.createdAt : Date.now() + index);
      return {
        role,
        content,
        createdAt: Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now() + index,
      };
    })
    .filter((entry) => entry.content.length > 0)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  return normalized.slice(-GLOBAL_ASK_HISTORY_TURN_LIMIT);
}

function buildGlobalAskPrompt({ question }) {
  return [
    'You are answering questions over the user\'s private knowledge base (recordings, notes, and folders).',
    '',
    'Behavior:',
    '1. Use the provided context as the primary source of truth.',
    '2. If context is missing or incomplete, say so directly before inferring.',
    '3. Clearly label inferred statements with "Inference:".',
    '4. Prefer concise, practical responses with bullets when helpful.',
    '5. Preserve nuance and uncertainty instead of overconfident claims.',
    '',
    `Current user question:\n${question}`,
  ].join('\n');
}

function buildGlobalAskHistoryText(history = []) {
  const source = Array.isArray(history) ? history : [];
  if (!source.length) return 'None.';

  let remainingChars = GLOBAL_ASK_HISTORY_CHAR_LIMIT;
  const lines = [];
  source.slice(-GLOBAL_ASK_HISTORY_TURN_LIMIT).forEach((entry) => {
    if (remainingChars < 40) return;
    const prefix = entry.role === 'assistant' ? 'Assistant' : 'User';
    const maxForTurn = Math.max(20, Math.min(800, remainingChars - (prefix.length + 4)));
    const clipped = truncateAskTurnText(entry.content, {
      maxChars: maxForTurn,
      headChars: Math.floor(maxForTurn * 0.68),
      tailChars: Math.floor(maxForTurn * 0.26),
    });
    if (!clipped) return;
    const line = `${prefix}: ${clipped}`;
    lines.push(line);
    remainingChars -= (line.length + 1);
  });

  return lines.length ? lines.join('\n') : 'None.';
}

function formatGlobalAskDate(timestamp) {
  const parsed = Number(timestamp || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 'Unknown date';
  }
  return new Date(parsed).toLocaleString();
}

function buildGlobalAskRecordingSection(
  recording = {},
  { transcriptLimit = GLOBAL_ASK_RECORDING_EXCERPT_LIMIT } = {}
) {
  const title = String(recording.title || '').trim() || 'Untitled recording';
  const summary = clampAskText(String(recording.summary || '').trim(), 1100);
  const transcriptExcerpt = truncateAskTurnText(String(recording.transcript || '').trim(), {
    maxChars: transcriptLimit,
    headChars: Math.floor(transcriptLimit * 0.65),
    tailChars: Math.floor(transcriptLimit * 0.28),
  });

  return [
    `### Recording: ${title}`,
    `- Recorded: ${formatGlobalAskDate(recording.createdAt)}`,
    summary ? `- Summary:\n${summary}` : '- Summary: Not available.',
    transcriptExcerpt ? `- Transcript excerpt:\n${transcriptExcerpt}` : '- Transcript excerpt: Not available.',
  ].join('\n');
}

function buildGlobalAskNoteSection(
  note = {},
  { folderName = '', recordingsById = new Map(), noteLimit = GLOBAL_ASK_NOTE_EXCERPT_LIMIT } = {}
) {
  const title = String(note.title || '').trim() || 'Untitled note';
  const noteText = truncateAskTurnText(String(note.text || '').trim(), {
    maxChars: noteLimit,
    headChars: Math.floor(noteLimit * 0.7),
    tailChars: Math.floor(noteLimit * 0.24),
  });
  const sourceRecordingIds = Array.isArray(note.sourceRecordingIds) ? note.sourceRecordingIds : [];
  const sourceRecordingTitles = sourceRecordingIds
    .map((recordingId) => recordingsById.get(recordingId))
    .filter(Boolean)
    .slice(0, 4)
    .map((recording) => String(recording.title || '').trim() || 'Untitled recording');
  const sourceLine = sourceRecordingTitles.length
    ? sourceRecordingTitles.join(', ')
    : 'None linked';

  return [
    `### Note: ${title}`,
    `- Folder: ${folderName || 'Loose note'}`,
    `- Updated: ${formatGlobalAskDate(note.lastModified || note.updatedAt || note.createdAt)}`,
    `- Linked recordings: ${sourceLine}`,
    noteText ? `- Note excerpt:\n${noteText}` : '- Note excerpt: Not available.',
  ].join('\n');
}

function buildGlobalAskContextBundle({ selection, contextCharLimit = GLOBAL_ASK_DEFAULT_CONTEXT_CHAR_LIMIT }) {
  const normalizedSelection = normalizeGlobalAskContextSelection(selection || {});
  const sortedRecordings = getSortedRecordings();
  const notes = Array.isArray(notesData && notesData.notes) ? notesData.notes.slice() : [];
  notes.sort((a, b) => Number(b.lastModified || b.updatedAt || b.createdAt || 0) - Number(a.lastModified || a.updatedAt || a.createdAt || 0));
  const folders = Array.isArray(notesData && notesData.folders) ? notesData.folders : [];
  const foldersById = new Map(
    folders.map((folder) => [String(folder.id || ''), String(folder.name || '').trim() || 'Untitled folder'])
  );
  const recordingsById = new Map(
    sortedRecordings.map((recording) => [String(recording.id || ''), recording])
  );

  const safeContextCharLimit = Math.max(2000, Math.floor(Number(contextCharLimit) || GLOBAL_ASK_DEFAULT_CONTEXT_CHAR_LIMIT));
  const largeWindowMode = safeContextCharLimit > (GLOBAL_ASK_DEFAULT_CONTEXT_CHAR_LIMIT * 4);
  const allRecordingsLimit = largeWindowMode ? 64 : GLOBAL_ASK_ALL_RECORDINGS_LIMIT;
  const folderNotesLimit = largeWindowMode ? 96 : GLOBAL_ASK_FOLDER_NOTES_LIMIT;
  const recordingExcerptLimit = largeWindowMode ? 120000 : GLOBAL_ASK_RECORDING_EXCERPT_LIMIT;
  const noteExcerptLimit = largeWindowMode ? 64000 : GLOBAL_ASK_NOTE_EXCERPT_LIMIT;

  let scopeLabel = 'All recordings';
  let sections = [];

  if (normalizedSelection.kind === 'recording' && normalizedSelection.id) {
    const target = recordingsById.get(normalizedSelection.id);
    if (target) {
      scopeLabel = `Recording: ${String(target.title || '').trim() || 'Untitled recording'}`;
      sections = [buildGlobalAskRecordingSection(target, { transcriptLimit: recordingExcerptLimit })];
    }
  } else if (normalizedSelection.kind === 'note' && normalizedSelection.id) {
    const target = notes.find((entry) => String(entry.id || '') === normalizedSelection.id);
    if (target) {
      const folderName = foldersById.get(String(target.folderId || '')) || '';
      scopeLabel = `Note: ${String(target.title || '').trim() || 'Untitled note'}`;
      sections = [buildGlobalAskNoteSection(target, {
        folderName,
        recordingsById,
        noteLimit: noteExcerptLimit,
      })];
    }
  } else if (normalizedSelection.kind === 'folder' && normalizedSelection.id) {
    const folderName = foldersById.get(normalizedSelection.id) || 'Untitled folder';
    const folderNotes = notes
      .filter((entry) => String(entry.folderId || '') === normalizedSelection.id)
      .slice(0, folderNotesLimit);
    scopeLabel = `Folder: ${folderName}`;
    sections = folderNotes.map((entry) => buildGlobalAskNoteSection(entry, {
      folderName,
      recordingsById,
      noteLimit: noteExcerptLimit,
    }));
  }

  if (!sections.length) {
    const fallbackRecordings = sortedRecordings.slice(0, allRecordingsLimit);
    sections = fallbackRecordings.map((entry) => buildGlobalAskRecordingSection(entry, {
      transcriptLimit: recordingExcerptLimit,
    }));
    scopeLabel = 'All recordings';
  }

  let contextText = sections.join('\n\n');
  let wasTruncated = false;
  if (!contextText.trim()) {
    contextText = 'No context was available.';
  }
  if (contextText.length > safeContextCharLimit) {
    const headChars = Math.max(1200, safeContextCharLimit - 180);
    contextText = `${contextText.slice(0, headChars).trim()}\n\n[Context truncated to fit request limits.]`;
    wasTruncated = true;
  }

  return {
    selection: normalizedSelection,
    scopeLabel,
    contextText,
    itemCount: sections.length,
    contextCharCount: contextText.length,
    wasTruncated,
  };
}

function buildGlobalAskSelectedText({ contextBundle, history }) {
  const safeBundle = contextBundle && typeof contextBundle === 'object'
    ? contextBundle
    : { scopeLabel: 'All recordings', contextText: 'No context was available.' };
  const historyText = buildGlobalAskHistoryText(history);
  return [
    `Context scope: ${safeBundle.scopeLabel || 'All recordings'}`,
    '',
    'Knowledge context:',
    safeBundle.contextText || 'No context was available.',
    '',
    'Conversation history:',
    historyText,
  ].join('\n');
}

function buildGlobalAskMessages({ question, selectedText }) {
  return [
    {
      role: 'system',
      content: 'You are a context-grounded assistant for notes and recordings. Use provided context first, mark inferred statements clearly, and be concise.',
    },
    {
      role: 'user',
      content: `${buildGlobalAskPrompt({ question })}\n\n${selectedText}`,
    },
  ];
}

async function runByokGlobalAsk({ provider, apiKey, model, question, selectedText }) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error(`Missing BYOK API key for ${provider}`);
  }

  const messages = buildGlobalAskMessages({ question, selectedText });

  if (provider === 'anthropic') {
    return runByokAnthropicCompletion({
      apiKey,
      model: model || ANTHROPIC_AGENT_MODEL,
      messages,
      errorLabel: 'global ask',
    });
  }

  if (provider === 'gemini') {
    return runByokGeminiCompletion({
      apiKey,
      model: model || GEMINI_AGENT_MODEL,
      messages,
      errorLabel: 'global ask',
    });
  }

  const endpoint = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const selectedModel = model || (provider === 'groq' ? GROQ_AGENT_MODEL : OPENAI_AGENT_MODEL);
  const result = await requestJson({
    targetUrl: endpoint,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model: selectedModel,
      temperature: 0.2,
      messages,
    },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`${provider} global ask request failed with status ${result.statusCode}`);
  }

  const text = extractMessageContent(result.payload);
  if (!text) {
    throw new Error(`${provider} global ask response did not include text output`);
  }
  return text;
}

async function runProGlobalAsk({ question, selectedText, modelAlias }) {
  const normalizedModelAlias = normalizeProLlmModelAlias(modelAlias);
  const capability = await proRequestWithAutoRefresh((jwt) => requestJson({
    targetUrl: CAPABILITY_ISSUE_URL,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
    body: {
      service: 'llm',
      action: 'transform',
      provider: PRO_LLM_PROVIDER_ID,
      metadata: {
        intent: 'global_ask',
        actionType: 'global_ask',
        aiActionType: 'global_ask',
        modelAlias: normalizedModelAlias,
      },
    },
  }));

  if (capability.statusCode < 200 || capability.statusCode >= 300) {
    const capabilityError = extractApiErrorMessage(capability.payload);
    throw new Error(
      `Capability issue failed with status ${capability.statusCode}${capabilityError ? `: ${capabilityError}` : ''}`
    );
  }

  const capabilityToken = capability.payload && capability.payload.capability && capability.payload.capability.token;
  if (!capabilityToken) {
    throw new Error('Capability token missing in issue response');
  }

  const relay = await requestJson({
    targetUrl: RELAY_LLM_TRANSFORM_URL,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${capabilityToken}`,
    },
    body: {
      actionType: 'global_ask',
      question,
      selectedText,
      maxTokens: PRO_ASK_MAX_TOKENS,
      provider: PRO_LLM_PROVIDER_ID,
      modelAlias: normalizedModelAlias,
    },
  });

  if (relay.statusCode < 200 || relay.statusCode >= 300) {
    const relayError = extractApiErrorMessage(relay.payload);
    throw new Error(
      `PRO relay global ask request failed with status ${relay.statusCode}${relayError ? `: ${relayError}` : ''}`
    );
  }

  const text = extractMessageContent(relay.payload);
  if (!text) {
    throw new Error('PRO relay global ask response did not include text output');
  }
  return text;
}

async function runLocalGlobalAsk({ question, selectedText }) {
  return runLocalPromptCompletion({
    prompt: buildGlobalAskPrompt({ question }),
    selectedText: selectedText || null,
  });
}

function resolveGlobalAskRoute(modelSelection = { mode: 'auto' }) {
  const currentMode = getEffectiveProcessingMode('aiActions');
  if (currentMode === 'local') {
    return {
      mode: 'local',
      provider: 'local',
      model: settings && settings.model ? settings.model : 'qwen',
    };
  }

  if (currentMode === 'pro') {
    const selectedAlias = modelSelection && modelSelection.mode === 'pro'
      ? normalizeProLlmModelAlias(modelSelection.modelAlias)
      : resolveProLlmModelAlias('ask');
    return {
      mode: 'pro',
      provider: PRO_LLM_PROVIDER_ID,
      modelAlias: selectedAlias,
    };
  }

  const defaultByok = resolveByokLlmSelection('ask');
  const keyMeta = normalizeByokMetaMap(
    settings && settings.aiEngine && settings.aiEngine.apiKeys
      ? settings.aiEngine.apiKeys
      : createEmptyByokKeyMeta()
  );

  let provider = defaultByok.provider;
  let model = defaultByok.model;
  if (modelSelection && modelSelection.mode === 'byok') {
    const requestedProvider = String(modelSelection.provider || '').trim().toLowerCase();
    if (BYOK_LLM_PROVIDERS.includes(requestedProvider) && hasByokKeyPresent(keyMeta, requestedProvider)) {
      provider = requestedProvider;
      model = normalizeByokLlmModel(provider, String(modelSelection.model || '').trim());
    }
  }

  return {
    mode: 'byok',
    provider,
    model,
  };
}

async function executeGlobalAsk({ question, contextBundle, history, modelSelection, routeOverride = null }) {
  const selectedText = buildGlobalAskSelectedText({ contextBundle, history });
  const route = routeOverride || resolveGlobalAskRoute(modelSelection || { mode: 'auto' });
  const providerOverride = route.mode === 'byok' ? route.provider : null;
  const plan = getLlmRoutingPreview({
    intent: 'global-ask',
    ...(providerOverride ? { providerOverride } : {}),
  });

  console.log(`[llm-router] global-ask adapter=${plan.adapter.id}, mode=${route.mode}, provider=${route.provider}`);

  if (route.mode === 'local') {
    const text = await runLocalGlobalAsk({ question, selectedText });
    return { text, route, selectedTextChars: selectedText.length };
  }
  if (route.mode === 'pro') {
    const text = await runProGlobalAsk({
      question,
      selectedText,
      modelAlias: route.modelAlias,
    });
    return { text, route, selectedTextChars: selectedText.length };
  }

  const apiKey = getByokApiKey(route.provider);
  const text = await runByokGlobalAsk({
    provider: route.provider,
    apiKey,
    model: route.model,
    question,
    selectedText,
  });
  return { text, route, selectedTextChars: selectedText.length };
}



async function runByokAnthropicCompletion({ apiKey, model, messages, errorLabel = 'completion' }) {
  // Convert OpenAI-style messages to Anthropic format
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');
  const systemPrompt = systemMessages.map((m) => m.content).join('\n').trim();

  const anthropicMessages = nonSystemMessages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  const body = {
    model: model || ANTHROPIC_AGENT_MODEL,
    max_tokens: 2048,
    messages: anthropicMessages,
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const result = await requestJson({
    targetUrl: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body,
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`Anthropic ${errorLabel} request failed with status ${result.statusCode}`);
  }

  const content = result.payload && Array.isArray(result.payload.content)
    ? result.payload.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim()
    : '';

  if (!content) {
    throw new Error(`Anthropic ${errorLabel} response did not include text output`);
  }
  return content;
}

async function runByokGeminiCompletion({ apiKey, model, messages, errorLabel = 'completion' }) {
  const prompt = messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join('\n\n')
    .trim();

  const selectedModel = model || GEMINI_AGENT_MODEL;
  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const result = await requestJson({
    targetUrl,
    method: 'POST',
    body: {
      contents: [{
        role: 'user',
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`Gemini ${errorLabel} request failed with status ${result.statusCode}`);
  }

  const candidates = (result.payload && Array.isArray(result.payload.candidates)) ? result.payload.candidates : [];
  const content = candidates
    .flatMap((candidate) => ((candidate && candidate.content && candidate.content.parts) || []))
    .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  if (!content) {
    throw new Error(`Gemini ${errorLabel} response did not include text output`);
  }

  return content;
}

async function runByokRecordingSummary({ provider, apiKey, model, transcript, summaryLanguage }) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error(`Missing BYOK API key for ${provider}`);
  }

  if (provider === 'anthropic') {
    return runByokAnthropicCompletion({
      apiKey,
      model: model || ANTHROPIC_AGENT_MODEL,
      messages: buildRecordingSummaryMessages({ transcript, summaryLanguage }),
      errorLabel: 'summary',
    });
  }

  if (provider === 'gemini') {
    return runByokGeminiCompletion({
      apiKey,
      model: model || GEMINI_AGENT_MODEL,
      messages: buildRecordingSummaryMessages({ transcript, summaryLanguage }),
      errorLabel: 'summary',
    });
  }

  const endpoint = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const selectedModel = model || (provider === 'groq' ? GROQ_AGENT_MODEL : OPENAI_AGENT_MODEL);

  const result = await requestJson({
    targetUrl: endpoint,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model: selectedModel,
      temperature: 0.2,
      messages: buildRecordingSummaryMessages({ transcript, summaryLanguage }),
    },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`${provider} summary request failed with status ${result.statusCode}`);
  }

  const text = extractMessageContent(result.payload);
  if (!text) {
    throw new Error(`${provider} summary response did not include text output`);
  }
  return text;
}



async function runProRecordingSummary({ transcript, modelAlias, summaryLanguage }) {
  const normalizedModelAlias = normalizeProLlmModelAlias(modelAlias);
  const capability = await proRequestWithAutoRefresh((jwt) => requestJson({
    targetUrl: CAPABILITY_ISSUE_URL,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
    body: {
      service: 'llm',
      action: 'transform',
      provider: PRO_LLM_PROVIDER_ID,
      metadata: {
        intent: 'user_summary',
        actionType: 'user_summary',
        aiActionType: 'user_summary',
        modelAlias: normalizedModelAlias,
      },
    },
  }));

  if (capability.statusCode < 200 || capability.statusCode >= 300) {
    const capabilityError = extractApiErrorMessage(capability.payload);
    throw new Error(
      `Capability issue failed with status ${capability.statusCode}${capabilityError ? `: ${capabilityError}` : ''}`
    );
  }

  const capabilityToken = capability.payload && capability.payload.capability && capability.payload.capability.token;
  if (!capabilityToken) {
    throw new Error('Capability token missing in issue response');
  }

  const relay = await requestJson({
    targetUrl: RELAY_LLM_TRANSFORM_URL,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${capabilityToken}`,
    },
    body: {
      actionType: 'user_summary',
      selectedText: transcript || '',
      transcript: transcript || '',
      summaryLanguage,
      maxTokens: PRO_SUMMARY_MAX_TOKENS,
      provider: PRO_LLM_PROVIDER_ID,
      modelAlias: normalizedModelAlias,
    },
  });

  if (relay.statusCode < 200 || relay.statusCode >= 300) {
    const relayError = extractApiErrorMessage(relay.payload);
    throw new Error(
      `PRO relay summary request failed with status ${relay.statusCode}${relayError ? `: ${relayError}` : ''}`
    );
  }

  const text = extractMessageContent(relay.payload);
  if (!text) {
    throw new Error('PRO relay summary response did not include text output');
  }
  return text;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function takeSummaryStreamChunk(text) {
  const source = String(text || '');
  if (source.length <= 420) {
    return source;
  }

  const minLength = 144;
  const maxLength = 420;
  const slice = source.slice(0, maxLength);
  const breakpoints = ['\n\n', '\n', '. ', '? ', '! ', '; ', ', ', ' '];
  for (const breakpoint of breakpoints) {
    const index = slice.lastIndexOf(breakpoint);
    if (index >= minLength) {
      return source.slice(0, index + breakpoint.length);
    }
  }

  return source.slice(0, maxLength);
}

function createSummaryChunkEmitter(onChunk, { delayMs = 8 } = {}) {
  const emit = typeof onChunk === 'function' ? onChunk : null;
  if (!emit) {
    return {
      push: () => {},
      flush: async () => {},
    };
  }

  let queue = '';
  let drainPromise = null;
  const safeDelayMs = Number.isFinite(Number(delayMs)) ? Math.max(0, Number(delayMs)) : 8;

  const startDrain = () => {
    if (drainPromise) return;
    drainPromise = (async () => {
      while (queue.length > 0) {
        const nextChunk = takeSummaryStreamChunk(queue);
        queue = queue.slice(nextChunk.length);
        emit(nextChunk);
        if (queue.length > 0 && safeDelayMs > 0) {
          await delay(safeDelayMs);
        }
      }
    })().finally(() => {
      drainPromise = null;
      if (queue.length > 0) {
        startDrain();
      }
    });
  };

  return {
    push: (text) => {
      const nextText = String(text || '');
      if (!nextText) return;
      queue += nextText;
      startDrain();
    },
    flush: async () => {
      while (queue.length > 0 || drainPromise) {
        startDrain();
        if (drainPromise) {
          await drainPromise;
        }
      }
    },
  };
}

async function runByokStreamingRecordingSummary({ provider, apiKey, model, transcript, summaryLanguage, route, onChunk }) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error(`Missing BYOK API key for ${provider}`);
  }

  const adapter = route ? llmRouter.getAdapterForRoute(route) : (llmRouter.byokAdapters && llmRouter.byokAdapters[provider]);
  if (!adapter || typeof adapter.executeStream !== 'function') {
    throw new Error(`Streaming summary is not available for ${provider}`);
  }

  let fullText = '';
  await adapter.executeStream({
    prompt: buildRecordingSummaryPrompt({ summaryLanguage }),
    selectedText: transcript || null,
    apiKey,
    model: model || undefined,
  }, (text) => {
    fullText += text;
    if (onChunk) onChunk(text);
  });

  const trimmed = fullText.trim();
  if (!trimmed) {
    throw new Error(`${provider} summary response did not include text output`);
  }
  return trimmed;
}

async function runProStreamingRecordingSummary({ transcript, modelAlias, summaryLanguage, route, onChunk }) {
  const normalizedModelAlias = normalizeProLlmModelAlias(modelAlias);
  const jwt = await readAuthJwtWithAutoRefresh();
  if (!jwt) {
    throw new Error('PRO authentication is required for summary streaming');
  }

  const adapter = route ? llmRouter.getAdapterForRoute(route) : llmRouter.proAdapter;
  if (!adapter || typeof adapter.executeStream !== 'function') {
    throw new Error('PRO summary streaming is not available');
  }

  let fullText = '';
  await adapter.executeStream({
    actionType: 'user_summary',
    selectedText: transcript || '',
    transcript: transcript || '',
    summaryLanguage,
    jwt,
    provider: PRO_LLM_PROVIDER_ID,
    model: normalizedModelAlias,
    modelAlias: normalizedModelAlias,
    aiActionType: 'user_summary',
    maxTokens: PRO_SUMMARY_MAX_TOKENS,
    serverUrl: BACKEND_BASE_URL,
    deviceIdHash: getDeviceIdHash(),
  }, (text) => {
    fullText += text;
    if (onChunk) onChunk(text);
  });

  const trimmed = fullText.trim();
  if (!trimmed) {
    throw new Error('PRO relay summary response did not include text output');
  }
  return trimmed;
}



async function runLocalStreamingPromptCompletion({ prompt, selectedText = null, onChunk = null }) {
  await ensureBackendReady();
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({
      prompt,
      selected_text: selectedText || null,
    });

    const req = http.request({
      hostname: BACKEND_HOST,
      port: backendPort,
      path: '/stream_summary',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let buffer = '';
      let fullText = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6));
              if (payload.event === 'chunk') {
                fullText += payload.text;
                if (onChunk) onChunk(payload.text);
              }
            } catch (e) { /* ignore parse errors */ }
          }
        }
      });
      res.on('end', () => {
        resolve(fullText);
      });
    });

    req.on('error', (e) => {
      console.error('Backend /stream_summary error:', e.message);
      reject(e);
    });
    req.write(bodyStr);
    req.end();
  });
}

async function runLocalPromptCompletion({ prompt, selectedText = null }) {
  const result = await runLocalStreamingPromptCompletion({
    prompt,
    selectedText,
    onChunk: null,
  });
  return String(result || '').trim();
}

async function runLocalRecordingSummary({ transcript, summaryLanguage }) {
  return runLocalPromptCompletion({
    prompt: buildRecordingSummaryPrompt({ summaryLanguage }),
    selectedText: transcript || null,
  });
}

async function runLocalStreamingRecordingSummary({ transcript, summaryLanguage, onChunk }) {
  return runLocalStreamingPromptCompletion({
    prompt: buildRecordingSummaryPrompt({ summaryLanguage }),
    selectedText: transcript || null,
    onChunk,
  });
}

async function executeRecordingSummary({ transcript, onChunk = null }) {
  const summaryLanguage = normalizeRecordingSummaryLanguageCode(settings.recordingSummaryLanguage);
  const byokSelection = resolveByokLlmSelection('summary');
  const summaryProvider = byokSelection.provider;
  const summaryModel = byokSelection.model;
  const chunkEmitter = createSummaryChunkEmitter(onChunk);
  const emitSummaryChunk = (chunk) => {
    chunkEmitter.push(chunk);
  };
  const finishSummaryStream = async (summaryText) => {
    await chunkEmitter.flush();
    return String(summaryText || '').trim();
  };

  const plan = getLlmRoutingPreview({ intent: 'recording-summary', providerOverride: summaryProvider });
  console.log(`[llm-router] summary adapter=${plan.adapter.id}, mode=${plan.route.mode}, provider=${plan.route.provider}, hasOnChunk=${!!onChunk}`);

  if (plan.route.mode === 'local') {
    if (onChunk) {
      const summaryText = await runLocalStreamingRecordingSummary({ transcript, summaryLanguage, onChunk: emitSummaryChunk });
      return finishSummaryStream(summaryText);
    }
    return runLocalRecordingSummary({ transcript, summaryLanguage });
  }
  if (plan.route.mode === 'pro') {
    if (onChunk) {
      const summaryText = await runProStreamingRecordingSummary({
        transcript,
        modelAlias: resolveProLlmModelAlias('summary'),
        summaryLanguage,
        route: plan.route,
        onChunk: emitSummaryChunk,
      });
      return finishSummaryStream(summaryText);
    }
    return runProRecordingSummary({
      transcript,
      modelAlias: resolveProLlmModelAlias('summary'),
      summaryLanguage,
    });
  }

  const provider = summaryProvider;
  const apiKey = getByokApiKey(provider);
  if (onChunk) {
    const summaryText = await runByokStreamingRecordingSummary({
      provider,
      apiKey,
      model: summaryModel,
      transcript,
      summaryLanguage,
      route: plan.route,
      onChunk: emitSummaryChunk,
    });
    return finishSummaryStream(summaryText);
  }
  return runByokRecordingSummary({ provider, apiKey, model: summaryModel, transcript, summaryLanguage });
}



function normalizeTempDeepgramResponse(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Temporary key response was empty');
  }

  const apiKey = payload.apiKey
    || payload.key
    || payload.token
    || payload.deepgramApiKey
    || payload.temporaryKey
    || null;
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('Temporary key missing in response');
  }

  const expiresAt = payload.expiresAt || payload.expires_at || payload.exp || null;
  return {
    apiKey,
    expiresAt: expiresAt || null,
    provider: 'deepgram',
  };
}

function isCachedDeepgramCredentialValid(credential) {
  if (!credential || !credential.apiKey) return false;
  if (!credential.expiresAt) return true;

  let expires = NaN;
  if (typeof credential.expiresAt === 'number') {
    expires = credential.expiresAt > 1_000_000_000_000
      ? credential.expiresAt
      : credential.expiresAt * 1000;
  } else if (typeof credential.expiresAt === 'string') {
    expires = Date.parse(credential.expiresAt);
  }
  if (!Number.isFinite(expires)) return true;
  return Date.now() < (expires - 30_000);
}

async function fetchProTemporaryDeepgramCredential({ purpose = 'transcription', forceRefresh = false } = {}) {
  if (!forceRefresh && isCachedDeepgramCredentialValid(cachedProDeepgramCredential)) {
    return cachedProDeepgramCredential;
  }

  const target = new URL(TEMP_DEEPGRAM_KEY_URL);
  target.searchParams.set('purpose', purpose);

  const result = await proRequestWithAutoRefresh((jwt) => requestJson({
    targetUrl: target.toString(),
    method: 'GET',
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  }));

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`Token endpoint failed with status ${result.statusCode}`);
  }

  const normalized = normalizeTempDeepgramResponse(result.payload);
  cachedProDeepgramCredential = normalized;
  return normalized;
}

function createElectronRecordModeSession() {
  const sessionId = crypto.randomUUID();
  const tempDir = app.getPath('temp');
  const rawWebmPath = path.join(tempDir, `escribolt-record-${sessionId}.webm`);
  const processedWavPath = path.join(tempDir, `escribolt-record-${sessionId}-processed.wav`);
  const writeStream = fs.createWriteStream(rawWebmPath, { flags: 'a' });

  const session = {
    id: sessionId,
    captureEngine: 'electron-mediarecorder',
    rawInputPath: rawWebmPath,
    processedWavPath,
    writeStream,
    startedAt: Date.now(),
    chunkCount: 0,
    totalBytes: 0,
    streamClosed: false,
  };

  writeStream.on('error', (error) => {
    console.error(`[record-mode] Write stream error for ${sessionId}:`, error.message);
  });

  recordModeSessions.set(sessionId, session);
  return {
    sessionId,
    startedAt: session.startedAt,
    captureEngine: session.captureEngine,
  };
}

function handleNativeHelperStdoutLine(line, session = null) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return;
  }

  try {
    const payload = JSON.parse(trimmed);
    if (payload && payload.status === 'level') {
      const value = Number(payload.value);
      if (Number.isFinite(value)) {
        syncRecordModeWidgetAudio({ level: value });
      }
      return;
    }
    if (payload && payload.status === 'started') {
      const microphoneEnabled = !!payload.microphone;
      const microphoneMode = typeof payload.microphoneMode === 'string' ? payload.microphoneMode : 'unknown';
      const systemOutputPath = typeof payload.output === 'string' ? payload.output : 'unknown';
      if (session && typeof session === 'object') {
        session.nativeStartup = {
          microphoneEnabled,
          microphoneMode,
          systemOutputPath,
          microphoneOutputPath: typeof payload.microphoneOutput === 'string' ? payload.microphoneOutput : '',
        };
      }
      console.log(`[record-mode][native-helper] started system=${systemOutputPath} mic=${microphoneEnabled ? 'on' : 'off'} mode=${microphoneMode}`);
      return;
    }
  } catch (_error) {
    // Non-JSON output is logged below.
  }

  console.log(`[record-mode][native-helper][stdout] ${trimmed}`);
}

function getNativeMacSystemAudioPermissionStatus() {
  if (process.platform !== 'darwin') {
    return {
      status: 'granted',
      granted: true,
      canRequest: false,
      platform: process.platform,
      service: 'system-audio',
    };
  }

  return {
    status: nativeMacSystemAudioPermissionState.status || 'unknown',
    granted: nativeMacSystemAudioPermissionState.status === 'granted',
    canRequest: true,
    platform: process.platform,
    service: 'system-audio',
    message: nativeMacSystemAudioPermissionState.message || '',
    requestedAt: nativeMacSystemAudioPermissionState.requestedAt || 0,
    checkedAt: nativeMacSystemAudioPermissionState.checkedAt || 0,
  };
}

async function runNativeMacSystemAudioPermissionProbe({ timeoutMs = 60000 } = {}) {
  if (process.platform !== 'darwin') {
    return getNativeMacSystemAudioPermissionStatus();
  }

  const helperPath = resolveNativeMacLoopbackHelperPath();
  if (!helperPath) {
    const message = 'Native macOS loopback helper binary not found.';
    nativeMacSystemAudioPermissionState.status = 'unknown';
    nativeMacSystemAudioPermissionState.message = message;
    nativeMacSystemAudioPermissionState.checkedAt = Date.now();
    return {
      ...getNativeMacSystemAudioPermissionStatus(),
      canRequest: false,
      message,
    };
  }

  const probeId = crypto.randomUUID();
  const probeOutputPath = path.join(app.getPath('temp'), `escribolt-system-audio-permission-${probeId}.m4a`);
  nativeMacSystemAudioPermissionState.requestedAt = Date.now();
  nativeMacSystemAudioPermissionState.checkedAt = 0;
  nativeMacSystemAudioPermissionState.message = '';

  let stdoutText = '';
  let stderrText = '';

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const helperProcess = spawn(helperPath, ['--probe', '--output', probeOutputPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const finish = (handler) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        handler();
      };

      const timeout = setTimeout(() => {
        try {
          helperProcess.kill('SIGTERM');
        } catch (_error) {
          // Ignore kill failures; the promise rejects below.
        }
        finish(() => reject(new Error('System audio permission prompt timed out.')));
      }, timeoutMs);

      helperProcess.stdout.on('data', (chunk) => {
        stdoutText += String(chunk || '');
      });

      helperProcess.stderr.on('data', (chunk) => {
        stderrText += String(chunk || '');
      });

      helperProcess.once('error', (error) => {
        finish(() => reject(new Error(`Failed to launch native helper: ${error.message}`)));
      });

      helperProcess.once('exit', (code, signal) => {
        if (code === 0) {
          finish(resolve);
          return;
        }
        const stderrLines = stderrText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        let message = stderrLines.join(' ');
        for (const line of stderrLines) {
          try {
            const payload = JSON.parse(line);
            if (payload && typeof payload.message === 'string' && payload.message.trim()) {
              message = payload.message.trim();
              break;
            }
          } catch (_error) {
            // Keep the raw stderr text.
          }
        }
        if (!message) {
          message = `Native helper exited before system audio permission was granted (code=${code}, signal=${signal || 'none'}).`;
        }
        finish(() => reject(new Error(message)));
      });
    });

    nativeMacSystemAudioPermissionState.status = 'granted';
    nativeMacSystemAudioPermissionState.message = '';
    nativeMacSystemAudioPermissionState.checkedAt = Date.now();
    if (stdoutText.trim()) {
      console.log(`[permissions][system-audio] probe succeeded: ${stdoutText.trim()}`);
    }
    return getNativeMacSystemAudioPermissionStatus();
  } catch (error) {
    const message = error && error.message ? error.message : 'System audio permission was not granted.';
    nativeMacSystemAudioPermissionState.status = /timed out/i.test(message) ? 'not-determined' : 'denied';
    nativeMacSystemAudioPermissionState.message = message;
    nativeMacSystemAudioPermissionState.checkedAt = Date.now();
    console.warn(`[permissions][system-audio] probe failed: ${message}`);
    return getNativeMacSystemAudioPermissionStatus();
  } finally {
    await deleteFileIfExists(probeOutputPath);
  }
}

async function createNativeRecordModeSession(options = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('Native ScreenCaptureKit helper is only supported on macOS.');
  }

  const helperPath = resolveNativeMacLoopbackHelperPath();
  if (!helperPath) {
    throw new Error('Native macOS loopback helper binary not found. Build it with npm run build:mac-loopback-helper.');
  }

  const sessionId = crypto.randomUUID();
  const tempDir = app.getPath('temp');
  const captureMic = options && Object.prototype.hasOwnProperty.call(options, 'captureMic')
    ? !!options.captureMic
    : true;
  const rawSystemInputPath = path.join(tempDir, `escribolt-record-${sessionId}-native-system.m4a`);
  const rawMicInputPath = captureMic ? path.join(tempDir, `escribolt-record-${sessionId}-native-mic.m4a`) : '';
  const processedSystemWavPath = path.join(tempDir, `escribolt-record-${sessionId}-system-processed.wav`);
  const processedMicWavPath = captureMic ? path.join(tempDir, `escribolt-record-${sessionId}-mic-processed.wav`) : '';

  [rawSystemInputPath, rawMicInputPath, processedSystemWavPath, processedMicWavPath].forEach((filePath) => {
    if (!filePath) return;
    try {
      fs.unlinkSync(filePath);
    } catch (_error) {
      // Ignore missing file.
    }
  });

  const helperArguments = ['--output', rawSystemInputPath];
  if (captureMic && rawMicInputPath) {
    helperArguments.push('--output-mic', rawMicInputPath);
  }

  const helperProcess = spawn(helperPath, helperArguments, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const session = {
    id: sessionId,
    captureEngine: 'native-helper',
    rawInputPath: rawSystemInputPath,
    rawSystemInputPath,
    rawMicInputPath,
    processedWavPath: processedSystemWavPath,
    processedSystemWavPath,
    processedMicWavPath,
    captureMicRequested: captureMic,
    startedAt: Date.now(),
    chunkCount: 0,
    totalBytes: 0,
    systemBytes: 0,
    microphoneBytes: 0,
    helperProcess,
    helperExited: false,
    helperExitCode: null,
    helperExitSignal: null,
    helperStdoutBuffer: '',
    nativeStartup: null,
  };

  recordModeSessions.set(sessionId, session);

  helperProcess.stdout.on('data', (chunk) => {
    const chunkText = String(chunk || '');
    if (!chunkText) {
      return;
    }

    session.helperStdoutBuffer += chunkText;
    const lines = session.helperStdoutBuffer.split(/\r?\n/);
    session.helperStdoutBuffer = lines.pop() || '';

    lines.forEach((line) => {
      handleNativeHelperStdoutLine(line, session);
    });
  });

  helperProcess.stderr.on('data', (chunk) => {
    const line = String(chunk || '').trim();
    if (line) {
      console.error(`[record-mode][native-helper][stderr] ${line}`);
    }
  });

  helperProcess.on('exit', (code, signal) => {
    session.helperExited = true;
    session.helperExitCode = code;
    session.helperExitSignal = signal || null;
  });

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finishResolve = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const finishReject = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      const startupTimer = setTimeout(() => {
        if (session.helperExited) {
          finishReject(new Error(`Native helper exited early (code=${session.helperExitCode}, signal=${session.helperExitSignal || 'none'})`));
          return;
        }
        finishResolve();
      }, 700);

      helperProcess.once('error', (error) => {
        clearTimeout(startupTimer);
        finishReject(new Error(`Failed to launch native helper: ${error.message}`));
      });

      helperProcess.once('exit', () => {
        clearTimeout(startupTimer);
        finishReject(new Error(`Native helper exited before capture started (code=${session.helperExitCode}, signal=${session.helperExitSignal || 'none'})`));
      });
    });
  } catch (error) {
    await stopNativeHelperProcess(session, { forceKill: true });
    await deleteFileIfExists(rawSystemInputPath);
    await deleteFileIfExists(rawMicInputPath);
    await deleteFileIfExists(processedSystemWavPath);
    await deleteFileIfExists(processedMicWavPath);
    recordModeSessions.delete(sessionId);
    throw error;
  }

  return {
    sessionId,
    startedAt: session.startedAt,
    captureEngine: session.captureEngine,
  };
}

function appendRecordModeChunk(sessionId, chunk) {
  const session = recordModeSessions.get(sessionId);
  if (!session || session.captureEngine !== 'electron-mediarecorder' || session.streamClosed) {
    return false;
  }

  let buffer;
  if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
    buffer = Buffer.from(chunk);
  } else if (chunk && chunk.type === 'Buffer' && Array.isArray(chunk.data)) {
    buffer = Buffer.from(chunk.data);
  } else {
    throw new Error('Chunk payload is not a valid binary buffer');
  }

  if (!buffer.length) {
    return false;
  }

  session.chunkCount += 1;
  session.totalBytes += buffer.length;
  session.writeStream.write(buffer);
  return true;
}

function closeRecordModeSessionStream(session) {
  return new Promise((resolve, reject) => {
    if (!session || session.captureEngine !== 'electron-mediarecorder' || session.streamClosed || !session.writeStream) {
      resolve();
      return;
    }

    let settled = false;
    const handleError = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    session.writeStream.once('error', handleError);
    session.writeStream.end(() => {
      if (!settled) {
        settled = true;
        session.streamClosed = true;
        resolve();
      }
    });
  });
}

function stopNativeHelperProcess(session, { forceKill = false } = {}) {
  return new Promise((resolve) => {
    if (!session || session.captureEngine !== 'native-helper' || !session.helperProcess || session.helperExited) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const child = session.helperProcess;
    let killTimer = null;
    const onExit = () => {
      if (killTimer) {
        clearTimeout(killTimer);
      }
      finish();
    };
    child.once('exit', onExit);

    const softSignal = forceKill ? 'SIGTERM' : 'SIGINT';
    killTimer = setTimeout(() => {
      if (!session.helperExited) {
        try {
          child.kill('SIGKILL');
        } catch (_error) {
          // Ignore process kill errors.
        }
      }
      setTimeout(finish, 500);
    }, forceKill ? 800 : 5000);

    try {
      child.kill(softSignal);
    } catch (_error) {
      clearTimeout(killTimer);
      finish();
    }
  });
}

function preprocessRecordModeAudio(inputPaths, outputPath) {
  return new Promise((resolve, reject) => {
    if (!ffmpeg) {
      reject(new Error('fluent-ffmpeg is not installed. Install fluent-ffmpeg and ffmpeg-static.'));
      return;
    }
    if (!ffmpegBinaryPath) {
      reject(new Error('ffmpeg-static is not installed. Install ffmpeg-static.'));
      return;
    }

    const inputs = Array.isArray(inputPaths) ? inputPaths : [inputPaths];
    if (inputs.length === 0) {
      reject(new Error('No input paths provided for preprocessing'));
      return;
    }

    let commandRef = ffmpeg().setFfmpegPath(ffmpegBinaryPath);

    inputs.forEach((input) => {
      commandRef = commandRef.input(input);
    });

    try {
      if (inputs.length > 1) {
        // Mix multiple inputs
        commandRef = commandRef
          .complexFilter([
            `amix=inputs=${inputs.length}:duration=longest:dropout_transition=2[aout]`,
            '[aout]silenceremove=stop_periods=-1:stop_threshold=-30dB:stop_duration=2:window=0[final]'
          ], 'final');
      } else {
        // Single input
        commandRef = commandRef
          .audioFilters('silenceremove=stop_periods=-1:stop_threshold=-30dB:stop_duration=2:window=0');
      }

      commandRef = commandRef
        .audioCodec('pcm_s16le')
        .audioFrequency(16000)
        .audioChannels(1)
        .format('wav')
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`[record-mode] ffmpeg start: ${commandLine}`);
        })
        .on('stderr', (line) => {
          if (line) {
            console.log(`[record-mode] ffmpeg: ${line}`);
          }
        })
        .on('error', (error, stdout, stderr) => {
          const stderrText = typeof stderr === 'string' ? stderr.trim() : '';
          const errorDetails = stderrText ? `${error.message} | ${stderrText}` : error.message;
          reject(new Error(`FFmpeg preprocessing failed: ${errorDetails}`));
        })
        .on('end', () => {
          resolve(outputPath);
        });

      commandRef.run();
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      reject(new Error(`FFmpeg preprocessing spawn error: ${message}`));
    }
  });
}

async function transcribeRecordModeProcessedAudio(processedWavPath) {
  const transcription = await transcribeAudioPathWithRouting(processedWavPath, {
    intent: 'record',
    logContext: 'record-mode',
    includeRoute: true,
    allowLocalFallback: false,
  });
  if (!transcription.text) {
    throw new Error('Record-mode STT response contained no transcript text');
  }
  return transcription;
}

async function transcribeImportedAudioFile(audioPath) {
  const tempProcessedPath = path.join(
    app.getPath('temp'),
    `escribolt-upload-${Date.now()}-${crypto.randomUUID()}-processed.wav`,
  );

  try {
    await preprocessRecordModeAudio(audioPath, tempProcessedPath);
    return await transcribeRecordModeProcessedAudio(tempProcessedPath);
  } finally {
    await deleteFileIfExists(tempProcessedPath);
  }
}

async function deleteFileIfExists(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.error(`[record-mode] Failed to delete temp file ${filePath}:`, error.message);
    }
  }
}

async function getFileSizeIfExists(filePath) {
  if (!filePath) return 0;
  try {
    const stats = await fs.promises.stat(filePath);
    return Number(stats.size || 0);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.error(`[record-mode] Failed to stat file ${filePath}:`, error.message);
    }
    return 0;
  }
}

function parseClockToDurationMs(clockValue) {
  const clean = typeof clockValue === 'string' ? clockValue.trim() : '';
  const match = clean.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) return 0;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return 0;
  }

  return Math.max(0, Math.round(((hours * 60 * 60) + (minutes * 60) + seconds) * 1000));
}

function extractAudioDurationMsFromFfmpegLog(logText) {
  const clean = typeof logText === 'string' ? logText : '';
  if (!clean) return 0;

  const match = clean.match(/Duration:\s*([0-9]+:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?)/i);
  if (!match || !match[1]) {
    return 0;
  }

  return parseClockToDurationMs(match[1]);
}

async function probeAudioDurationMs(filePath) {
  if (!filePath || !ffmpegBinaryPath) {
    return 0;
  }

  return await new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    const finish = (durationMs) => {
      if (settled) return;
      settled = true;
      resolve(Math.max(0, Math.round(Number(durationMs) || 0)));
    };

    let probeProcess = null;
    try {
      probeProcess = spawn(ffmpegBinaryPath, ['-hide_banner', '-i', filePath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (error) {
      console.warn(`[record-mode] Failed to spawn ffmpeg duration probe: ${error.message}`);
      finish(0);
      return;
    }

    if (probeProcess.stderr) {
      probeProcess.stderr.on('data', (chunk) => {
        if (chunk) {
          stderr += String(chunk);
        }
      });
    }

    probeProcess.on('error', (error) => {
      console.warn(`[record-mode] Audio duration probe failed: ${error.message}`);
      finish(0);
    });

    probeProcess.on('close', () => {
      finish(extractAudioDurationMsFromFfmpegLog(stderr));
    });
  });
}

function buildLabeledRecordModeTranscript({ othersText = '', meText = '' } = {}) {
  const cleanOthersText = typeof othersText === 'string' ? othersText.trim() : '';
  const cleanMeText = typeof meText === 'string' ? meText.trim() : '';
  const sections = [];
  if (cleanOthersText) {
    sections.push(`Others:\n${cleanOthersText}`);
  }
  if (cleanMeText) {
    sections.push(`Me:\n${cleanMeText}`);
  }
  return sections.join('\n\n').trim();
}

function buildLabeledRecordModeRoute({
  othersRoute = null,
  meRoute = null,
  microphoneMode = 'unknown',
  microphoneEnabled = false,
} = {}) {
  const primaryRoute = othersRoute || meRoute || {};
  return {
    provider: primaryRoute.provider || 'local',
    mode: primaryRoute.mode || 'local',
    transport: 'dual-track-labeled',
    channels: {
      others: othersRoute ? (othersRoute.transport || 'unknown') : null,
      me: meRoute ? (meRoute.transport || 'unknown') : null,
    },
    microphone: {
      enabled: !!microphoneEnabled,
      mode: typeof microphoneMode === 'string' ? microphoneMode : 'unknown',
    },
  };
}

async function stopRecordModeSession(sessionId) {
  const session = recordModeSessions.get(sessionId);
  if (!session) {
    throw new Error('Record mode session not found');
  }

  if (session.stoppingPromise) {
    return session.stoppingPromise;
  }

  session.stoppingPromise = (async () => {
    try {
      let transcription = null;
      if (session.captureEngine === 'native-helper') {
        await stopNativeHelperProcess(session);
        const nativeStartup = session.nativeStartup || {};

        const systemBytes = await getFileSizeIfExists(session.rawSystemInputPath || session.rawInputPath);
        const microphoneBytes = await getFileSizeIfExists(session.rawMicInputPath);
        session.systemBytes = systemBytes;
        session.microphoneBytes = microphoneBytes;
        session.totalBytes = systemBytes + microphoneBytes;
        session.chunkCount = [systemBytes, microphoneBytes].filter((value) => value > 0).length;

        if (!session.chunkCount || !session.totalBytes) {
          throw new Error('No audio was captured');
        }

        let combinedTranscription = null;
        const validInputs = [];

        if (systemBytes > 0 && (session.rawSystemInputPath || session.rawInputPath)) {
          validInputs.push(session.rawSystemInputPath || session.rawInputPath);
        }
        if (microphoneBytes > 0 && session.rawMicInputPath) {
          validInputs.push(session.rawMicInputPath);
        }

        if (validInputs.length > 0) {
          try {
            const mixedWavPath = path.join(app.getPath('temp'), `escribolt-record-${session.id}-mixed-processed.wav`);
            await preprocessRecordModeAudio(validInputs, mixedWavPath);
            combinedTranscription = await transcribeRecordModeProcessedAudio(mixedWavPath);
          } catch (error) {
            console.error(`[record-mode] Failed to process mixed audio tracks: ${error.message}`);
          }
        }

        if (!combinedTranscription || !combinedTranscription.text) {
          throw new Error('No speech content was detected in system or microphone tracks.');
        }

        transcription = {
          text: combinedTranscription.text,
          route: buildLabeledRecordModeRoute({
            othersRoute: combinedTranscription ? combinedTranscription.route : null,
            meRoute: null,
            microphoneMode: nativeStartup.microphoneMode || 'unknown',
            microphoneEnabled: !!nativeStartup.microphoneEnabled,
          }),
        };
      } else {
        await closeRecordModeSessionStream(session);
        if (!session.chunkCount || !session.totalBytes) {
          throw new Error('No audio was captured');
        }
        await preprocessRecordModeAudio(session.rawInputPath, session.processedWavPath);
        transcription = await transcribeRecordModeProcessedAudio(session.processedWavPath);
      }

      const durationMs = Date.now() - session.startedAt;
      const stats = {
        chunkCount: session.chunkCount,
        totalBytes: session.totalBytes,
        durationMs,
        systemBytes: Number(session.systemBytes || 0),
        microphoneBytes: Number(session.microphoneBytes || 0),
      };
      const recording = addRecordingEntry({
        transcript: transcription.text,
        route: transcription.route,
        stats,
      });

      return {
        status: 'success',
        transcript: transcription.text,
        route: transcription.route,
        stats,
        recording,
      };
    } finally {
      await deleteFileIfExists(session.rawInputPath);
      await deleteFileIfExists(session.processedWavPath);
      await deleteFileIfExists(session.rawSystemInputPath);
      await deleteFileIfExists(session.rawMicInputPath);
      await deleteFileIfExists(session.processedSystemWavPath);
      await deleteFileIfExists(session.processedMicWavPath);
      recordModeSessions.delete(sessionId);
    }
  })();

  return session.stoppingPromise;
}

async function abortRecordModeSession(sessionId) {
  const session = recordModeSessions.get(sessionId);
  if (!session) {
    return { status: 'ok' };
  }

  try {
    if (session.captureEngine === 'native-helper') {
      await stopNativeHelperProcess(session, { forceKill: true });
    } else {
      await closeRecordModeSessionStream(session);
    }
  } catch (error) {
    console.error('[record-mode] Error while aborting session stream:', error.message);
  } finally {
    await deleteFileIfExists(session.rawInputPath);
    await deleteFileIfExists(session.processedWavPath);
    await deleteFileIfExists(session.rawSystemInputPath);
    await deleteFileIfExists(session.rawMicInputPath);
    await deleteFileIfExists(session.processedSystemWavPath);
    await deleteFileIfExists(session.processedMicWavPath);
    recordModeSessions.delete(sessionId);
  }

  return { status: 'ok' };
}

// Load initial state
migrateLegacyAuthSecrets();
let settings = loadUserSettings();
settings.shortcuts = normalizeShortcutSettings(settings.shortcuts);
shortcutsLastWorking = { ...settings.shortcuts };
let selectedModel = settings.model;
let selectedTheme = settings.theme;
if (settings.mode === 'pro') {
  settings.aiEngine.sttProvider = 'deepgram';
  settings.aiEngine.llmProvider = PRO_LLM_PROVIDER_ID;
  settings.aiEngine.summaryProvider = PRO_LLM_PROVIDER_ID;
  settings.aiEngine.llmModel = normalizeProLlmModelAlias(settings.aiEngine.llmModel);
  settings.aiEngine.summaryModel = normalizeProLlmModelAlias(settings.aiEngine.summaryModel);

}
if (settings.mode === 'pro' && !hasStoredAuthJwt()) {
  settings.mode = 'local';
  settings.processingModes = normalizeProcessingModes(PROCESSING_MODE_DEFAULTS, 'local');
  settings.aiEngine = normalizeAiEngineRoutingSettings(
    settings.aiEngine,
    settings.mode,
    settings.aiEngine.apiKeys
  );
  userSettingsStore.set(settings);
}
const sttRouter = new SttRouter({
  getSettings: () => settings,
});
const llmRouter = new LlmRouter({
  getSettings: () => settings,
});

function normalizeFolderEntry(folder = {}) {
  const id = typeof folder.id === 'string' ? folder.id.trim() : '';
  if (!id || id === 'default') return null;
  const name = typeof folder.name === 'string' && folder.name.trim()
    ? folder.name.trim()
    : 'Untitled folder';
  const rawParentId = typeof folder.parentId === 'string' ? folder.parentId.trim() : '';
  const parentId = rawParentId && rawParentId !== id && rawParentId !== 'default' ? rawParentId : '';
  const iconId = typeof folder.iconId === 'string' ? folder.iconId.trim() : '';
  const colorId = typeof folder.colorId === 'string' ? folder.colorId.trim() : '';
  const createdAtRaw = Number(folder.createdAt || folder.updatedAt || Date.now());
  const createdAt = Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now();
  const updatedAtRaw = Number(folder.updatedAt || createdAt || Date.now());
  const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now();
  const versionRaw = Number.parseInt(folder.version, 10);
  const version = Number.isFinite(versionRaw) && versionRaw > 0 ? versionRaw : 1;
  const deletedAtRaw = Number(folder.deletedAt || 0);
  const deletedAt = Number.isFinite(deletedAtRaw) && deletedAtRaw > 0 ? deletedAtRaw : null;
  const syncedAtRaw = Number(folder.syncedAt || 0);
  const syncedAt = Number.isFinite(syncedAtRaw) && syncedAtRaw > 0 ? syncedAtRaw : null;
  const isCloudSynced = typeof folder.isCloudSynced === 'boolean' ? folder.isCloudSynced : true;
  const syncStatus = typeof folder.syncStatus === 'string'
    ? folder.syncStatus
    : (isCloudSynced ? 'synced' : 'pending');
  return {
    id,
    name,
    parentId,
    iconId,
    colorId,
    createdAt,
    updatedAt,
    version,
    deletedAt,
    syncedAt,
    isCloudSynced,
    syncStatus,
  };
}

function normalizeFolderList(folders = []) {
  const source = Array.isArray(folders) ? folders : [];
  const deduped = [];
  const seen = new Set();
  source.forEach((folder) => {
    const normalized = normalizeFolderEntry(folder);
    if (!normalized) return;
    if (seen.has(normalized.id)) return;
    seen.add(normalized.id);
    deduped.push(normalized);
  });

  const ids = new Set(deduped.map((folder) => folder.id));
  const byId = new Map(deduped.map((folder) => [folder.id, folder]));
  const createsParentCycle = (folderId, parentId) => {
    if (!parentId || parentId === folderId) return true;
    const visited = new Set([folderId]);
    let cursor = parentId;
    while (cursor) {
      if (visited.has(cursor)) return true;
      visited.add(cursor);
      const next = byId.get(cursor);
      if (!next || !next.parentId) return false;
      cursor = next.parentId;
    }
    return false;
  };

  return deduped.map((folder) => {
    const parentId = folder.parentId && ids.has(folder.parentId) ? folder.parentId : '';
    if (!parentId) {
      return { ...folder, parentId: '' };
    }
    if (createsParentCycle(folder.id, parentId)) {
      return { ...folder, parentId: '' };
    }
    return { ...folder, parentId };
  });
}

function normalizeNoteFolderId(rawFolderId, availableFolderIds = new Set()) {
  const normalized = typeof rawFolderId === 'string' ? rawFolderId.trim() : '';
  if (!normalized || normalized === 'default') return '';
  return availableFolderIds.has(normalized) ? normalized : '';
}

// Load notes from SQLite-backed local state
let notesData = readLocalStateValue(NOTES_STATE_KEY, null);
if (!notesData || Array.isArray(notesData)) {
  notesData = {
    folders: [],
    notes: [],
  };
}
if (!notesData.folders) notesData.folders = [];
if (!notesData.notes) notesData.notes = [];
notesData.folders = normalizeFolderList(notesData.folders);
const availableNoteFolderIds = new Set(notesData.folders.map((folder) => folder.id));
notesData.notes = notesData.notes.map((note) => {
  const normalizedFolderId = normalizeNoteFolderId(note.folderId, availableNoteFolderIds);
  const createdAtRaw = Number(note.createdAt || note.lastModified || Date.now());
  const createdAt = Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now();
  const lastModifiedRaw = Number(note.lastModified || note.updatedAt || createdAt || Date.now());
  const lastModified = Number.isFinite(lastModifiedRaw) ? lastModifiedRaw : Date.now();
  const syncedAtRaw = Number(note.syncedAt || 0);
  const isCloudSynced = typeof note.isCloudSynced === 'boolean' ? note.isCloudSynced : true;
  const versionRaw = Number.parseInt(note.version, 10);
  return {
    ...note,
    folderId: normalizedFolderId,
    createdAt,
    lastModified,
    updatedAt: Number(note.updatedAt || lastModified) || lastModified,
    isCloudSynced,
    syncStatus: typeof note.syncStatus === 'string' ? note.syncStatus : (isCloudSynced ? 'synced' : 'pending'),
    syncedAt: Number.isFinite(syncedAtRaw) && syncedAtRaw > 0 ? syncedAtRaw : null,
    version: Number.isFinite(versionRaw) && versionRaw > 0 ? versionRaw : 1,
    deletedAt: note.deletedAt ? Number(note.deletedAt) : null,
  };
});
writeLocalStateValue(NOTES_STATE_KEY, notesData);

function normalizeNoteEntry(note = {}) {
  const createdAtRaw = Number(note.createdAt || note.lastModified || Date.now());
  const createdAt = Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now();
  const lastModifiedRaw = Number(note.lastModified || note.updatedAt || createdAt || Date.now());
  const lastModified = Number.isFinite(lastModifiedRaw) ? lastModifiedRaw : Date.now();
  const updatedAtRaw = Number(note.updatedAt || lastModified || Date.now());
  const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now();
  const versionRaw = Number.parseInt(note.version, 10);
  const version = Number.isFinite(versionRaw) && versionRaw > 0 ? versionRaw : 1;
  const isCloudSynced = typeof note.isCloudSynced === 'boolean' ? note.isCloudSynced : true;
  const syncedAtRaw = Number(note.syncedAt || 0);
  const syncedAt = Number.isFinite(syncedAtRaw) && syncedAtRaw > 0 ? syncedAtRaw : null;
  const syncStatus = typeof note.syncStatus === 'string'
    ? note.syncStatus
    : (isCloudSynced ? 'synced' : 'pending');
  const sourceRecordingIds = Array.isArray(note.sourceRecordingIds)
    ? Array.from(new Set(note.sourceRecordingIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())))
    : [];
  return {
    id: typeof note.id === 'string' && note.id ? note.id : crypto.randomUUID(),
    title: typeof note.title === 'string' ? note.title : '',
    text: typeof note.text === 'string' ? note.text : '',
    colorId: typeof note.colorId === 'string' ? note.colorId : 'yellow',
    folderId: typeof note.folderId === 'string' ? note.folderId : '',
    createdAt,
    lastModified,
    updatedAt,
    isCloudSynced,
    syncStatus,
    syncedAt,
    version,
    deletedAt: note.deletedAt ? Number(note.deletedAt) : null,
    sourceRecordingIds,
  };
}

function normalizeChatEntry(entry = {}) {
  const createdAtRaw = Number(entry.createdAt || Date.now());
  const createdAt = Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now();
  const updatedAtRaw = Number(entry.updatedAt || createdAt || Date.now());
  const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now();
  const versionRaw = Number.parseInt(entry.version, 10);
  const version = Number.isFinite(versionRaw) && versionRaw > 0 ? versionRaw : 1;
  const deletedAtRaw = Number(entry.deletedAt || 0);
  const deletedAt = Number.isFinite(deletedAtRaw) && deletedAtRaw > 0 ? deletedAtRaw : null;
  const syncedAtRaw = Number(entry.syncedAt || 0);
  const syncedAt = Number.isFinite(syncedAtRaw) && syncedAtRaw > 0 ? syncedAtRaw : null;
  const rawFolderId = typeof entry.folderId === 'string' ? entry.folderId.trim() : '';
  const availableFolderIds = new Set((notesData.folders || []).map((folder) => folder.id));
  const folderId = normalizeNoteFolderId(rawFolderId, availableFolderIds);
  const isCloudSynced = typeof entry.isCloudSynced === 'boolean' ? entry.isCloudSynced : false;
  const syncStatus = typeof entry.syncStatus === 'string'
    ? entry.syncStatus
    : 'synced';

  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : crypto.randomUUID(),
    title: typeof entry.title === 'string' && entry.title.trim() ? entry.title : 'Untitled Chat',
    messages: Array.isArray(entry.messages) ? entry.messages : [],
    isCloudSynced,
    syncStatus,
    version,
    createdAt,
    updatedAt,
    deletedAt,
    syncedAt,
    folderId,
    contextOptionIds: Array.isArray(entry.contextOptionIds) ? entry.contextOptionIds : [],
  };
}

// Load chats from SQLite-backed local state
let chatsData = readLocalStateValue(CHATS_STATE_KEY, null);
if (!chatsData || !Array.isArray(chatsData.chats)) {
  chatsData = {
    chats: [],
  };
} else {
  // Deduplicate by ID to clean up any existing duplicate entries in SQLite
  const uniqueChats = [];
  const seen = new Set();
  for (const c of chatsData.chats) {
    if (c && c.id && !seen.has(c.id)) {
      seen.add(c.id);
      uniqueChats.push(normalizeChatEntry(c));
    }
  }
  chatsData.chats = uniqueChats;
}
writeLocalStateValue(CHATS_STATE_KEY, chatsData);

function broadcastChatsUpdate() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('chats-updated', chatsData);
  }
}

function persistChatsData(options = {}) {
  const shouldScheduleSync = options.triggerSync !== false;
  chatsData.chats = (Array.isArray(chatsData.chats) ? chatsData.chats : []).map((entry) => normalizeChatEntry(entry));
  writeLocalStateValue(CHATS_STATE_KEY, chatsData);
  broadcastChatsUpdate();
  rebuildTrayMenuIfReady();
  if (shouldScheduleSync) {
    scheduleSyncRun();
  }
}

function noteSourceRecordingIdsEqual(leftIds = [], rightIds = []) {
  const left = Array.isArray(leftIds) ? leftIds : [];
  const right = Array.isArray(rightIds) ? rightIds : [];
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function hasNoteMutableFieldChanges(currentNote = {}, nextNote = {}) {
  return (
    String(currentNote.title || '') !== String(nextNote.title || '')
    || String(currentNote.text || '') !== String(nextNote.text || '')
    || String(currentNote.colorId || 'yellow') !== String(nextNote.colorId || 'yellow')
    || String(currentNote.folderId || '') !== String(nextNote.folderId || '')
    || Boolean(currentNote.isCloudSynced !== false) !== Boolean(nextNote.isCloudSynced !== false)
    || !noteSourceRecordingIdsEqual(currentNote.sourceRecordingIds, nextNote.sourceRecordingIds)
  );
}

function broadcastNotesUpdate() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('notes-updated', {
      ...notesData,
      isAuthenticated: hasStoredAuthJwt(),
    });
  }
}

function persistNotesData(options = {}) {
  const shouldScheduleSync = options.triggerSync !== false;
  notesData.folders = normalizeFolderList(notesData.folders);
  const availableFolderIds = new Set(notesData.folders.map((folder) => folder.id));
  notesData.notes = notesData.notes.map((note) => normalizeNoteEntry({
    ...note,
    folderId: normalizeNoteFolderId(note.folderId, availableFolderIds),
  }));
  writeLocalStateValue(NOTES_STATE_KEY, notesData);
  broadcastNotesUpdate();
  rebuildTrayMenuIfReady();
  if (shouldScheduleSync) {
    scheduleSyncRun();
  }
}

function buildRecordingTitle(transcript, createdAt) {
  const clean = typeof transcript === 'string' ? transcript.trim() : '';
  if (!clean) {
    const stamp = new Date(createdAt || Date.now()).toLocaleString();
    return `Recording ${stamp}`;
  }
  const firstLine = clean.split(/\r?\n/).find((line) => line.trim().length > 0) || clean;
  return firstLine.trim().slice(0, 72);
}

function normalizeRecordingEntry(entry = {}) {
  const createdAt = Number(entry.createdAt || Date.now());
  const updatedAt = Number(entry.updatedAt || createdAt || Date.now());
  const transcript = typeof entry.transcript === 'string' ? entry.transcript : '';
  const summary = typeof entry.summary === 'string' ? entry.summary : '';
  const route = entry.route && typeof entry.route === 'object' ? entry.route : {};
  const explicitSync = entry.isCloudSynced;
  const inferredCloudSync = route.mode === 'local' ? false : true;
  const isCloudSynced = typeof explicitSync === 'boolean' ? explicitSync : inferredCloudSync;
  const syncStatus = typeof entry.syncStatus === 'string' ? entry.syncStatus : (isCloudSynced ? 'synced' : 'pending');
  const versionRaw = Number.parseInt(entry.version, 10);
  const version = Number.isFinite(versionRaw) && versionRaw > 0 ? versionRaw : 1;
  const deletedAtRaw = Number(entry.deletedAt || 0);
  const deletedAt = Number.isFinite(deletedAtRaw) && deletedAtRaw > 0 ? deletedAtRaw : null;
  const syncedAtRaw = Number(entry.syncedAt || 0);
  const syncedAt = Number.isFinite(syncedAtRaw) && syncedAtRaw > 0 ? syncedAtRaw : null;
  const linkedNoteId = typeof entry.linkedNoteId === 'string' && entry.linkedNoteId.trim()
    ? entry.linkedNoteId.trim()
    : null;
  const rawFolderId = typeof entry.folderId === 'string' ? entry.folderId.trim() : '';
  const folderId = rawFolderId && rawFolderId !== 'default' ? rawFolderId : '';

  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : crypto.randomUUID(),
    title: typeof entry.title === 'string'
      ? entry.title
      : buildRecordingTitle(transcript, createdAt),
    transcript,
    summary,
    summaryUpdatedAt: Number(entry.summaryUpdatedAt || 0) || null,
    isCloudSynced,
    syncStatus,
    version,
    createdAt,
    updatedAt,
    deletedAt,
    syncedAt,
    route,
    stats: entry.stats && typeof entry.stats === 'object' ? entry.stats : {},
    linkedNoteId,
    folderId,
  };
}

function getSortedRecordings() {
  return recordingsData.recordings
    .slice()
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function broadcastRecordingsUpdate() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('recordings-updated', {
      recordings: getSortedRecordings(),
    });
  }
}

function persistRecordingsData(options = {}) {
  const shouldScheduleSync = options.triggerSync !== false;
  writeLocalStateValue(RECORDINGS_STATE_KEY, recordingsData);
  broadcastRecordingsUpdate();
  rebuildTrayMenuIfReady();
  if (shouldScheduleSync) {
    scheduleSyncRun();
  }
}

function addRecordingEntry({ transcript = '', route = {}, stats = {} } = {}) {
  const createdAt = Date.now();
  const cleanTranscript = typeof transcript === 'string' ? transcript.trim() : '';
  const nextNumber = recordingsData.recordings.length + 1;
  const isAuthenticated = hasStoredAuthJwt();
  const isStrictPrivacy = settings?.syncSettings?.strictPrivacyMode === true;
  const shouldCloudSync = isAuthenticated && !isStrictPrivacy;

  const entry = normalizeRecordingEntry({
    id: crypto.randomUUID(),
    title: `Recording #${nextNumber}`,
    transcript: cleanTranscript,
    summary: '',
    summaryUpdatedAt: null,
    createdAt,
    updatedAt: createdAt,
    route,
    stats,
    version: 1,
    isCloudSynced: shouldCloudSync,
    syncStatus: shouldCloudSync ? 'pending' : 'synced',
  });
  recordingsData.recordings.push(entry);
  persistRecordingsData();
  return entry;
}

function updateRecordingTranscript(recordingId, transcript) {
  const index = recordingsData.recordings.findIndex((item) => item.id === recordingId);
  if (index < 0) {
    return null;
  }

  const current = recordingsData.recordings[index];
  const nextTranscript = typeof transcript === 'string' ? transcript.trim() : '';
  const updatedAt = Date.now();
  const updated = normalizeRecordingEntry({
    ...current,
    transcript: nextTranscript,
    title: current.title,
    summary: '',
    summaryUpdatedAt: null,
    updatedAt,
    syncStatus: current.isCloudSynced ? 'pending' : current.syncStatus,
    version: (Number.parseInt(current.version, 10) || 1) + 1,
  });
  recordingsData.recordings[index] = updated;
  persistRecordingsData();
  return updated;
}

function updateRecordingMetadata(recordingId, updates = {}) {
  const index = recordingsData.recordings.findIndex((item) => item.id === recordingId);
  if (index < 0) {
    return null;
  }

  const current = recordingsData.recordings[index];
  const updatedAt = Date.now();

  const nextTitle = typeof updates.title === 'string' ? updates.title : current.title;
  const nextIsCloudSynced = typeof updates.isCloudSynced === 'boolean'
    ? updates.isCloudSynced
    : current.isCloudSynced;
  const requestedFolderId = typeof updates.folderId === 'string'
    ? updates.folderId.trim()
    : String(current.folderId || '').trim();
  let nextFolderId = requestedFolderId;
  if (nextFolderId && nextFolderId !== 'default') {
    const hasFolder = Array.isArray(notesData?.folders)
      && notesData.folders.some((folder) => String(folder?.id || '').trim() === nextFolderId);
    if (!hasFolder) {
      nextFolderId = '';
    }
  } else {
    nextFolderId = '';
  }

  const updated = normalizeRecordingEntry({
    ...current,
    title: nextTitle,
    isCloudSynced: nextIsCloudSynced,
    syncStatus: nextIsCloudSynced ? 'pending' : 'synced',
    folderId: nextFolderId,
    updatedAt,
    version: (Number.parseInt(current.version, 10) || 1) + 1,
  });
  recordingsData.recordings[index] = updated;
  persistRecordingsData();
  return updated;
}

function updateRecordingSummary(recordingId, summaryText) {
  const index = recordingsData.recordings.findIndex((item) => item.id === recordingId);
  if (index < 0) {
    return null;
  }

  const current = recordingsData.recordings[index];
  const updatedAt = Date.now();
  const updated = normalizeRecordingEntry({
    ...current,
    summary: typeof summaryText === 'string' ? summaryText.trim() : '',
    summaryUpdatedAt: updatedAt,
    updatedAt,
    syncStatus: current.isCloudSynced ? 'pending' : current.syncStatus,
    version: (Number.parseInt(current.version, 10) || 1) + 1,
  });
  recordingsData.recordings[index] = updated;
  persistRecordingsData();
  return updated;
}

function deleteRecording(recordingId) {
  const existing = recordingsData.recordings.find((item) => item.id === recordingId);
  if (existing && existing.isCloudSynced) {
    addPendingDelete('recordings', {
      id: existing.id,
      updatedAt: Date.now(),
      version: (Number.parseInt(existing.version, 10) || 1) + 1,
    });
  }
  const beforeCount = recordingsData.recordings.length;
  recordingsData.recordings = recordingsData.recordings.filter((item) => item.id !== recordingId);
  if (recordingsData.recordings.length === beforeCount) {
    return false;
  }
  notesData.notes = notesData.notes.map((note) => {
    const normalized = normalizeNoteEntry(note);
    if (!normalized.sourceRecordingIds.includes(recordingId)) {
      return normalized;
    }
    const now = Date.now();
    return normalizeNoteEntry({
      ...normalized,
      sourceRecordingIds: normalized.sourceRecordingIds.filter((id) => id !== recordingId),
      lastModified: now,
      updatedAt: now,
      version: normalized.isCloudSynced
        ? (Number.parseInt(normalized.version, 10) || 1) + 1
        : (Number.parseInt(normalized.version, 10) || 1),
    });
  });
  persistNotesData();
  persistRecordingsData();
  return true;
}

function buildLinkedNoteTextFromRecording(recording) {
  const summary = String(recording.summary || '').trim();
  const transcript = String(recording.transcript || '').trim();
  const createdAt = Number(recording.createdAt || Date.now());
  const durationMs = Number(recording.stats && recording.stats.durationMs ? recording.stats.durationMs : 0);
  const durationLine = Number.isFinite(durationMs) && durationMs > 0
    ? `- Duration: ${Math.round(durationMs / 60000)} min`
    : '';
  return [
    summary ? `## Summary\n${summary}` : '## Summary\nNo summary has been generated yet.',
    '## Source Recording',
    `- Recorded: ${new Date(Number.isFinite(createdAt) ? createdAt : Date.now()).toLocaleString()}`,
    durationLine,
    '',
    '## Transcript',
    transcript || 'Transcript is empty.',
  ].filter((line) => line !== '').join('\n');
}

function createLinkedNoteFromRecording(recordingId) {
  const recordingIndex = recordingsData.recordings.findIndex((entry) => entry.id === recordingId);
  if (recordingIndex < 0) {
    return null;
  }

  const recording = normalizeRecordingEntry(recordingsData.recordings[recordingIndex]);
  if (recording.linkedNoteId) {
    const existingNote = notesData.notes.find((entry) => entry.id === recording.linkedNoteId);
    if (existingNote) {
      return {
        note: normalizeNoteEntry(existingNote),
        recording,
      };
    }
  }
  const now = Date.now();
  const isAuthenticated = hasStoredAuthJwt();
  const shouldCloudSync = isAuthenticated && !isStrictPrivacyModeEnabled();
  const note = normalizeNoteEntry({
    id: crypto.randomUUID(),
    title: recording.title || 'Recording note',
    text: buildLinkedNoteTextFromRecording(recording),
    colorId: getDefaultStickyNoteColorId(),
    folderId: '',
    createdAt: now,
    lastModified: now,
    updatedAt: now,
    version: 1,
    isCloudSynced: shouldCloudSync,
    sourceRecordingIds: [recording.id],
  });

  const updatedRecording = normalizeRecordingEntry({
    ...recording,
    linkedNoteId: note.id,
    updatedAt: now,
    syncStatus: recording.isCloudSynced ? 'pending' : recording.syncStatus,
    version: (Number.parseInt(recording.version, 10) || 1) + 1,
  });

  notesData.notes.push(note);
  recordingsData.recordings[recordingIndex] = updatedRecording;
  persistNotesData();
  persistRecordingsData();
  return {
    note,
    recording: updatedRecording,
  };
}

function linkRecordingToNote(recordingId, noteId) {
  const recordingIndex = recordingsData.recordings.findIndex((entry) => entry.id === recordingId);
  const noteIndex = notesData.notes.findIndex((entry) => entry.id === noteId);
  if (recordingIndex < 0 || noteIndex < 0) {
    return null;
  }

  const now = Date.now();
  const recording = normalizeRecordingEntry(recordingsData.recordings[recordingIndex]);
  const note = normalizeNoteEntry(notesData.notes[noteIndex]);
  const previousNoteId = recording.linkedNoteId;
  const sourceRecordingIds = Array.from(new Set([...(note.sourceRecordingIds || []), recording.id]));

  if (previousNoteId && previousNoteId !== note.id) {
    const previousNoteIndex = notesData.notes.findIndex((entry) => entry.id === previousNoteId);
    if (previousNoteIndex >= 0) {
      const previousNote = normalizeNoteEntry(notesData.notes[previousNoteIndex]);
      notesData.notes[previousNoteIndex] = normalizeNoteEntry({
        ...previousNote,
        sourceRecordingIds: previousNote.sourceRecordingIds.filter((id) => id !== recording.id),
        lastModified: now,
        updatedAt: now,
        version: previousNote.isCloudSynced
          ? (Number.parseInt(previousNote.version, 10) || 1) + 1
          : (Number.parseInt(previousNote.version, 10) || 1),
      });
    }
  }

  const updatedNote = normalizeNoteEntry({
    ...note,
    sourceRecordingIds,
    lastModified: now,
    updatedAt: now,
    version: note.isCloudSynced
      ? (Number.parseInt(note.version, 10) || 1) + 1
      : (Number.parseInt(note.version, 10) || 1),
  });
  const updatedRecording = normalizeRecordingEntry({
    ...recording,
    linkedNoteId: updatedNote.id,
    updatedAt: now,
    syncStatus: recording.isCloudSynced ? 'pending' : recording.syncStatus,
    version: (Number.parseInt(recording.version, 10) || 1) + 1,
  });

  notesData.notes[noteIndex] = updatedNote;
  recordingsData.recordings[recordingIndex] = updatedRecording;
  persistNotesData();
  persistRecordingsData();
  return {
    note: updatedNote,
    recording: updatedRecording,
  };
}

function unlinkRecordingFromNote(recordingId) {
  const recordingIndex = recordingsData.recordings.findIndex((entry) => entry.id === recordingId);
  if (recordingIndex < 0) {
    return null;
  }

  const now = Date.now();
  const recording = normalizeRecordingEntry(recordingsData.recordings[recordingIndex]);
  const previousNoteId = recording.linkedNoteId;
  let updatedNote = null;

  if (previousNoteId) {
    const noteIndex = notesData.notes.findIndex((entry) => entry.id === previousNoteId);
    if (noteIndex >= 0) {
      const note = normalizeNoteEntry(notesData.notes[noteIndex]);
      updatedNote = normalizeNoteEntry({
        ...note,
        sourceRecordingIds: (note.sourceRecordingIds || []).filter((id) => id !== recording.id),
        lastModified: now,
        updatedAt: now,
        version: note.isCloudSynced
          ? (Number.parseInt(note.version, 10) || 1) + 1
          : (Number.parseInt(note.version, 10) || 1),
      });
      notesData.notes[noteIndex] = updatedNote;
    }
  }

  const updatedRecording = normalizeRecordingEntry({
    ...recording,
    linkedNoteId: null,
    updatedAt: now,
    syncStatus: recording.isCloudSynced ? 'pending' : recording.syncStatus,
    version: (Number.parseInt(recording.version, 10) || 1) + 1,
  });

  recordingsData.recordings[recordingIndex] = updatedRecording;
  persistNotesData();
  persistRecordingsData();
  return {
    note: updatedNote,
    recording: updatedRecording,
  };
}

let recordingsData = readLocalStateValue(RECORDINGS_STATE_KEY, null);
if (!recordingsData || Array.isArray(recordingsData)) {
  recordingsData = {
    recordings: [],
  };
}
if (!Array.isArray(recordingsData.recordings)) {
  recordingsData.recordings = [];
}
recordingsData.recordings = recordingsData.recordings.map((entry) => normalizeRecordingEntry(entry));
if (Object.prototype.hasOwnProperty.call(recordingsData, 'tags')) {
  delete recordingsData.tags;
}
writeLocalStateValue(RECORDINGS_STATE_KEY, recordingsData);

function markRecordingsSyncPending() {
  recordingsData.recordings = recordingsData.recordings.map((entry) => {
    if (entry.isCloudSynced) {
      return normalizeRecordingEntry({
        ...entry,
        syncStatus: 'pending',
      });
    }
    return entry;
  });
}

function markChatsSyncPending() {
  chatsData.chats = chatsData.chats.map((entry) => {
    const normalized = normalizeChatEntry(entry);
    if (normalized.isCloudSynced) {
      return normalizeChatEntry({
        ...normalized,
        syncStatus: 'pending',
      });
    }
    return normalized;
  });
}

function markFoldersSyncPending() {
  notesData.folders = notesData.folders.map((entry) => {
    const normalized = normalizeFolderEntry(entry);
    if (normalized && normalized.isCloudSynced) {
      return normalizeFolderEntry({
        ...normalized,
        syncStatus: 'pending',
      });
    }
    return normalized;
  }).filter(Boolean);
}

function shouldRunSync() {
  // Cloud-backed items stay up to date whenever an account is connected.
  if (!hasStoredAuthJwt()) {
    return false;
  }
  return true;
}

function getSyncIntervalMs() {
  const raw = Number(settings.syncSettings.intervalMs || DEFAULT_SETTINGS.syncSettings.intervalMs);
  if (!Number.isFinite(raw)) return DEFAULT_SETTINGS.syncSettings.intervalMs;
  return Math.max(SYNC_INTERVAL_MIN_MS, Math.min(SYNC_INTERVAL_MAX_MS, Math.floor(raw)));
}

function scheduleSyncRun(delayMs = 1500) {
  if (!shouldRunSync()) {
    return;
  }
  const backoffDelayMs = Math.max(0, Number(syncBackoffUntil || 0) - Date.now());
  const requestedDelayMs = Math.max(0, Number(delayMs) || 0);
  const nextDelayMs = Math.max(requestedDelayMs, backoffDelayMs);
  if (syncRunTimeout) {
    clearTimeout(syncRunTimeout);
  }
  syncRunTimeout = setTimeout(() => {
    syncRunTimeout = null;
    void runSyncCycle();
  }, nextDelayMs);
}

function configureSyncInterval() {
  if (syncIntervalHandle) {
    clearInterval(syncIntervalHandle);
    syncIntervalHandle = null;
  }
  if (!shouldRunSync()) {
    return;
  }
  const intervalMs = getSyncIntervalMs();
  syncIntervalHandle = setInterval(() => {
    void runSyncCycle();
  }, intervalMs);
}

function normalizeRemoteConflict(conflict = {}) {
  return {
    entityType: typeof conflict.entityType === 'string' ? conflict.entityType : '',
    entityId: typeof conflict.entityId === 'string' ? conflict.entityId : '',
    clientPayload: conflict.clientPayload && typeof conflict.clientPayload === 'object' ? conflict.clientPayload : {},
    serverPayload: conflict.serverPayload && typeof conflict.serverPayload === 'object' ? conflict.serverPayload : {},
    createdAt: Number(conflict.createdAt || Date.now()) || Date.now(),
  };
}

function getLocalEntityItem(entityType, entityId) {
  if (!entityId) return null;
  if (entityType === 'folders') {
    return notesData.folders.find((entry) => entry.id === entityId) || null;
  }
  if (entityType === 'recordings') {
    return recordingsData.recordings.find((entry) => entry.id === entityId) || null;
  }
  if (entityType === 'notes') {
    return notesData.notes.find((entry) => entry.id === entityId) || null;
  }
  if (entityType === 'chats') {
    return chatsData.chats.find((entry) => entry.id === entityId) || null;
  }
  return null;
}

async function resolveSyncConflict(conflict, resolution) {
  const entityType = conflict.entityType;
  const entityId = conflict.entityId;
  if (!['folders', 'recordings', 'notes', 'transcripts', 'chats'].includes(entityType) || !entityId) {
    return;
  }

  const jwt = await readAuthJwtWithAutoRefresh();
  if (!jwt) {
    throw new Error('Not authenticated');
  }

  const payload = {
    resolution,
  };

  if (resolution === 'client_wins') {
    const localItem = getLocalEntityItem(entityType, entityId);
    if (!localItem) {
      throw new Error('Local item not found for conflict resolution');
    }
    payload.item = localItem;
  }

  const result = await requestJson({
    targetUrl: `${BACKEND_BASE_URL}/api/sync/conflicts/${entityType}/${encodeURIComponent(entityId)}/resolve`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
    body: payload,
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    const message = result.payload && result.payload.error
      ? result.payload.error
      : `Conflict resolution failed (${result.statusCode})`;
    throw new Error(message);
  }
}

async function promptAndResolveConflict(conflict) {
  const normalized = normalizeRemoteConflict(conflict);
  if (!normalized.entityType || !normalized.entityId) {
    return null;
  }

  emitSyncStatus({
    level: 'warning',
    message: `Sync conflict detected for ${normalized.entityType}:${normalized.entityId}`,
  });

  const response = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Keep Local', 'Keep Cloud', 'Resolve Later'],
    defaultId: 2,
    cancelId: 2,
    title: 'Sync Conflict',
    message: `Conflict detected for ${normalized.entityType} (${normalized.entityId.slice(0, 8)}...).`,
    detail: 'Choose which version to keep. Keep Local overwrites cloud. Keep Cloud accepts server data.',
    noLink: true,
  });

  if (response.response === 2) {
    return null;
  }

  const resolution = response.response === 0 ? 'client_wins' : 'server_wins';
  await resolveSyncConflict(normalized, resolution);
  removePendingSyncConflict(normalized.entityType, normalized.entityId);
  emitSyncStatus({
    level: 'warning',
    message: `Conflict resolved (${resolution.replace('_', ' ')}) for ${normalized.entityType}.`,
  });
  return resolution;
}

function mergeRemoteRecordings(items = []) {
  const incoming = Array.isArray(items) ? items : [];
  if (!incoming.length) return false;
  let changed = false;
  const byId = new Map(recordingsData.recordings.map((entry) => [entry.id, entry]));

  incoming.forEach((remoteRaw) => {
    const remote = normalizeRecordingEntry({
      ...remoteRaw,
      isCloudSynced: true,
      syncStatus: 'synced',
    });
    const existing = byId.get(remote.id);

    if (remote.deletedAt) {
      if (existing) {
        recordingsData.recordings = recordingsData.recordings.filter((entry) => entry.id !== remote.id);
        byId.delete(remote.id);
        changed = true;
      }
      return;
    }

    if (!existing) {
      recordingsData.recordings.push(remote);
      byId.set(remote.id, remote);
      changed = true;
      return;
    }

    const existingVersion = Number.parseInt(existing.version, 10) || 1;
    const remoteVersion = Number.parseInt(remote.version, 10) || 1;
    const shouldReplace = remoteVersion > existingVersion
      || (remoteVersion === existingVersion && Number(remote.updatedAt || 0) > Number(existing.updatedAt || 0));
    if (shouldReplace) {
      const next = normalizeRecordingEntry({
        ...remote,
        isCloudSynced: true,
        syncStatus: 'synced',
      });
      const index = recordingsData.recordings.findIndex((entry) => entry.id === remote.id);
      if (index >= 0) {
        recordingsData.recordings[index] = next;
        byId.set(remote.id, next);
        changed = true;
      }
    }
  });

  return changed;
}

function detachItemsFromFolder(folderId) {
  let notesChanged = false;
  let recordingsChanged = false;
  let chatsChanged = false;

  notesData.notes = notesData.notes.map((entry) => {
    const normalized = normalizeNoteEntry(entry);
    if (String(normalized.folderId || '') !== folderId) return normalized;
    notesChanged = true;
    return normalizeNoteEntry({
      ...normalized,
      folderId: '',
    });
  });

  recordingsData.recordings = recordingsData.recordings.map((entry) => {
    const normalized = normalizeRecordingEntry(entry);
    if (String(normalized.folderId || '') !== folderId) return normalized;
    recordingsChanged = true;
    return normalizeRecordingEntry({
      ...normalized,
      folderId: '',
    });
  });

  chatsData.chats = chatsData.chats.map((entry) => {
    const rawFolderId = typeof entry.folderId === 'string' ? entry.folderId.trim() : '';
    const normalized = normalizeChatEntry(entry);
    if (rawFolderId !== folderId) return normalized;
    chatsChanged = true;
    return normalizeChatEntry({
      ...normalized,
      folderId: '',
    });
  });

  return {
    notesChanged,
    recordingsChanged,
    chatsChanged,
  };
}

function mergeRemoteFolders(items = []) {
  const incoming = Array.isArray(items) ? items : [];
  const result = {
    foldersChanged: false,
    notesChanged: false,
    recordingsChanged: false,
    chatsChanged: false,
  };
  if (!incoming.length) return result;

  const byId = new Map(notesData.folders.map((entry) => [entry.id, entry]));

  incoming.forEach((remoteRaw) => {
    const remote = normalizeFolderEntry({
      ...remoteRaw,
      isCloudSynced: true,
      syncStatus: 'synced',
    });
    if (!remote) return;
    const existing = byId.get(remote.id);

    if (remote.deletedAt) {
      if (existing) {
        notesData.folders = notesData.folders.filter((entry) => entry.id !== remote.id);
        byId.delete(remote.id);
        result.foldersChanged = true;
        const detached = detachItemsFromFolder(remote.id);
        result.notesChanged = result.notesChanged || detached.notesChanged;
        result.recordingsChanged = result.recordingsChanged || detached.recordingsChanged;
        result.chatsChanged = result.chatsChanged || detached.chatsChanged;
      }
      return;
    }

    if (!existing) {
      notesData.folders.push(remote);
      byId.set(remote.id, remote);
      result.foldersChanged = true;
      return;
    }

    const existingVersion = Number.parseInt(existing.version, 10) || 1;
    const remoteVersion = Number.parseInt(remote.version, 10) || 1;
    const shouldReplace = remoteVersion > existingVersion
      || (remoteVersion === existingVersion && Number(remote.updatedAt || 0) > Number(existing.updatedAt || 0));
    if (shouldReplace) {
      const next = normalizeFolderEntry({
        ...remote,
        isCloudSynced: true,
        syncStatus: 'synced',
      });
      const index = notesData.folders.findIndex((entry) => entry.id === remote.id);
      if (index >= 0 && next) {
        notesData.folders[index] = next;
        byId.set(remote.id, next);
        result.foldersChanged = true;
      }
    }
  });

  if (result.foldersChanged) {
    notesData.folders = normalizeFolderList(notesData.folders);
  }

  return result;
}

function mergeRemoteNotes(items = []) {
  const incoming = Array.isArray(items) ? items : [];
  if (!incoming.length) return false;
  let changed = false;
  const byId = new Map(notesData.notes.map((entry) => [entry.id, entry]));

  incoming.forEach((remoteRaw) => {
    const remote = normalizeNoteEntry({
      ...remoteRaw,
      lastModified: remoteRaw.updatedAt,
      isCloudSynced: true,
    });
    const existing = byId.get(remote.id);

    if (remote.deletedAt) {
      if (existing) {
        notesData.notes = notesData.notes.filter((entry) => entry.id !== remote.id);
        const win = stickyWindows.get(remote.id);
        if (win && !win.isDestroyed()) {
          win.close();
        }
        byId.delete(remote.id);
        changed = true;
      }
      return;
    }

    if (!existing) {
      notesData.notes.push(remote);
      byId.set(remote.id, remote);
      changed = true;
      return;
    }

    const existingVersion = Number.parseInt(existing.version, 10) || 1;
    const remoteVersion = Number.parseInt(remote.version, 10) || 1;
    const shouldReplace = remoteVersion > existingVersion
      || (remoteVersion === existingVersion && Number(remote.updatedAt || 0) > Number(existing.updatedAt || 0));
    if (shouldReplace) {
      const next = normalizeNoteEntry({
        ...remote,
        isCloudSynced: true,
      });
      const index = notesData.notes.findIndex((entry) => entry.id === remote.id);
      if (index >= 0) {
        notesData.notes[index] = next;
        byId.set(remote.id, next);
        changed = true;
        const win = stickyWindows.get(remote.id);
        if (win && !win.isDestroyed()) {
          win.webContents.send('load-note', next);
        }
      }
    }
  });

  return changed;
}

function mergeRemoteChats(items = []) {
  const incoming = Array.isArray(items) ? items : [];
  if (!incoming.length) return false;
  let changed = false;
  const byId = new Map(chatsData.chats.map((entry) => [entry.id, entry]));

  incoming.forEach((remoteRaw) => {
    const remote = normalizeChatEntry({
      ...remoteRaw,
      isCloudSynced: true,
      syncStatus: 'synced',
    });
    const existing = byId.get(remote.id);

    if (remote.deletedAt) {
      if (existing) {
        chatsData.chats = chatsData.chats.filter((entry) => entry.id !== remote.id);
        byId.delete(remote.id);
        changed = true;
      }
      return;
    }

    if (!existing) {
      chatsData.chats.push(remote);
      byId.set(remote.id, remote);
      changed = true;
      return;
    }

    const existingVersion = Number.parseInt(existing.version, 10) || 1;
    const remoteVersion = Number.parseInt(remote.version, 10) || 1;
    const shouldReplace = remoteVersion > existingVersion
      || (remoteVersion === existingVersion && Number(remote.updatedAt || 0) > Number(existing.updatedAt || 0));
    if (shouldReplace) {
      const next = normalizeChatEntry({
        ...remote,
        isCloudSynced: true,
        syncStatus: 'synced',
      });
      const index = chatsData.chats.findIndex((entry) => entry.id === remote.id);
      if (index >= 0) {
        chatsData.chats[index] = next;
        byId.set(remote.id, next);
        changed = true;
      }
    }
  });

  return changed;
}

function getHeaderValue(headers = {}, name) {
  const target = String(name || '').toLowerCase();
  const match = Object.entries(headers || {}).find(([key]) => String(key || '').toLowerCase() === target);
  const value = match ? match[1] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function parseRetryAfterMs(result = {}) {
  const headerValue = getHeaderValue(result.headers || {}, 'retry-after');
  if (headerValue !== undefined && headerValue !== null) {
    const seconds = Number(headerValue);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.max(1000, Math.floor(seconds * 1000));
    }
    const retryDate = Date.parse(String(headerValue));
    if (Number.isFinite(retryDate)) {
      return Math.max(1000, retryDate - Date.now());
    }
  }

  const retryAfterMs = Number(result.payload && result.payload.retryAfterMs);
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.max(1000, Math.floor(retryAfterMs));
  }

  return 60_000;
}

function scheduleSyncRateLimitRetry(result = {}, phase = 'sync') {
  const jitterMs = 250 + Math.floor(Math.random() * 750);
  const retryDelayMs = parseRetryAfterMs(result) + jitterMs;
  syncBackoffUntil = Math.max(syncBackoffUntil || 0, Date.now() + retryDelayMs);
  console.warn(`[sync] ${phase} rate limited; retrying in ${retryDelayMs}ms`);
  emitSyncStatus({
    level: 'warning',
    code: 'RATE_LIMITED',
    message: 'Cloud sync is temporarily rate limited. Escribolt will retry shortly.',
    retryAfterMs: retryDelayMs,
  });
  scheduleSyncRun(retryDelayMs);
}

function getSyncEntityItems(entityType) {
  if (entityType === 'folders') return notesData.folders || [];
  if (entityType === 'recordings') return recordingsData.recordings || [];
  if (entityType === 'notes') return notesData.notes || [];
  if (entityType === 'chats') return chatsData.chats || [];
  return [];
}

function normalizeSyncUpdatedAt(item = {}) {
  return Number(item.updatedAt || item.lastModified || item.createdAt || Date.now());
}

function shouldQueueLocalSyncItem(item = {}) {
  if (!item || item.isCloudSynced !== true || item.deletedAt) return false;
  const updatedAt = normalizeSyncUpdatedAt(item);
  const syncedAt = Number(item.syncedAt || 0);
  if (item.syncStatus === 'pending' || item.syncStatus === 'failed') return true;
  return Number.isFinite(updatedAt) && (!Number.isFinite(syncedAt) || syncedAt <= 0 || updatedAt > syncedAt);
}

function refreshSyncOutboxFromLocalState() {
  let changed = false;
  for (const entityType of SYNC_ENTITY_TYPES) {
    for (const item of getSyncEntityItems(entityType)) {
      if (!shouldQueueLocalSyncItem(item)) continue;
      const beforeLength = (syncState.outbox && syncState.outbox[entityType] || []).length;
      addSyncOutboxItem(entityType, {
        id: item.id,
        updatedAt: normalizeSyncUpdatedAt(item),
        version: Number.parseInt(item.version, 10) || 1,
      }, { persist: false });
      const afterLength = (syncState.outbox && syncState.outbox[entityType] || []).length;
      changed = changed || afterLength !== beforeLength;
    }
  }
  if (changed) {
    persistSyncState();
  }
}

function getPendingDeleteMap(entityType) {
  return new Map((syncState.pendingDeletes && syncState.pendingDeletes[entityType] || [])
    .filter((entry) => entry && typeof entry.id === 'string' && entry.id)
    .map((entry) => [entry.id, entry]));
}

function findLocalSyncItem(entityType, id) {
  return getSyncEntityItems(entityType).find((item) => item && item.id === id) || null;
}

function buildSyncItemForOutbox(entityType, outboxEntry = {}) {
  const pendingDelete = getPendingDeleteMap(entityType).get(outboxEntry.id);
  if (pendingDelete) {
    return buildDeletedItem(pendingDelete);
  }
  const localItem = findLocalSyncItem(entityType, outboxEntry.id);
  if (!localItem || localItem.isCloudSynced !== true) {
    return null;
  }
  return {
    ...localItem,
    updatedAt: normalizeSyncUpdatedAt(localItem),
  };
}

function emptySyncPushPayload() {
  return {
    folders: [],
    recordings: [],
    transcripts: [],
    notes: [],
    chats: [],
  };
}

function getPayloadByteLength(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload), 'utf8');
  } catch (_error) {
    return Number.POSITIVE_INFINITY;
  }
}

function buildSyncPushChunks() {
  refreshSyncOutboxFromLocalState();
  const candidates = [];
  for (const entityType of SYNC_ENTITY_TYPES) {
    const entries = normalizePendingDeleteList(syncState.outbox && syncState.outbox[entityType]);
    syncState.outbox[entityType] = entries;
    for (const entry of entries) {
      const item = buildSyncItemForOutbox(entityType, entry);
      if (item) {
        candidates.push({ entityType, item });
      } else {
        removeSyncOutboxByIds(entityType, [entry.id], { persist: false });
      }
    }
  }
  persistSyncState();

  const chunks = [];
  let current = emptySyncPushPayload();
  let currentCount = 0;

  for (const candidate of candidates) {
    const next = {
      ...current,
      [candidate.entityType]: [...current[candidate.entityType], candidate.item],
    };
    const nextCount = currentCount + 1;
    const tooManyItems = currentCount > 0 && nextCount > SYNC_PUSH_MAX_ITEMS;
    const tooManyBytes = currentCount > 0 && getPayloadByteLength(next) > SYNC_PUSH_MAX_BYTES;
    if (tooManyItems || tooManyBytes) {
      chunks.push(current);
      current = emptySyncPushPayload();
      currentCount = 0;
    }
    current[candidate.entityType].push(candidate.item);
    currentCount += 1;
  }

  if (currentCount > 0) {
    chunks.push(current);
  }
  return chunks;
}

function getResultIds(resultGroup = {}, entityType) {
  return Array.isArray(resultGroup && resultGroup[entityType])
    ? resultGroup[entityType].map((entry) => entry && entry.id).filter(Boolean)
    : [];
}

function getResultVersionMap(resultGroup = {}, entityType) {
  const versionMap = new Map();
  const entries = Array.isArray(resultGroup && resultGroup[entityType]) ? resultGroup[entityType] : [];
  for (const entry of entries) {
    if (entry && typeof entry.id === 'string' && entry.id) {
      const version = Number.parseInt(entry.version, 10);
      if (Number.isFinite(version) && version > 0) {
        versionMap.set(entry.id, version);
      }
    }
  }
  return versionMap;
}

function markSyncEntitiesSynced(entityType, ids = [], versionMap = new Map()) {
  if (!Array.isArray(ids) || !ids.length) return false;
  const idSet = new Set(ids);
  const syncedAt = Date.now();
  let changed = false;
  if (entityType === 'folders') {
    notesData.folders = notesData.folders.map((entry) => {
      const normalized = normalizeFolderEntry(entry);
      if (!normalized || !idSet.has(normalized.id)) return normalized;
      changed = true;
      return normalizeFolderEntry({
        ...normalized,
        syncStatus: 'synced',
        syncedAt,
        version: versionMap.get(normalized.id) || normalized.version,
      });
    }).filter(Boolean);
  } else if (entityType === 'recordings') {
    recordingsData.recordings = recordingsData.recordings.map((entry) => {
      if (!idSet.has(entry.id)) return entry;
      changed = true;
      return normalizeRecordingEntry({
        ...entry,
        syncStatus: 'synced',
        syncedAt,
        version: versionMap.get(entry.id) || entry.version,
      });
    });
  } else if (entityType === 'notes') {
    notesData.notes = notesData.notes.map((entry) => {
      if (!idSet.has(entry.id)) return entry;
      changed = true;
      return normalizeNoteEntry({
        ...entry,
        syncStatus: 'synced',
        syncedAt,
        version: versionMap.get(entry.id) || entry.version,
      });
    });
  } else if (entityType === 'chats') {
    chatsData.chats = chatsData.chats.map((entry) => {
      if (!idSet.has(entry.id)) return entry;
      changed = true;
      return normalizeChatEntry({
        ...entry,
        syncStatus: 'synced',
        syncedAt,
        version: versionMap.get(entry.id) || entry.version,
      });
    });
  }
  return changed;
}

function markSyncEntitiesFailed(entityType, ids = []) {
  if (!Array.isArray(ids) || !ids.length) return false;
  const idSet = new Set(ids);
  let changed = false;
  if (entityType === 'folders') {
    notesData.folders = notesData.folders.map((entry) => {
      const normalized = normalizeFolderEntry(entry);
      if (!normalized || !idSet.has(normalized.id)) return normalized;
      changed = true;
      return normalizeFolderEntry({ ...normalized, syncStatus: 'failed' });
    }).filter(Boolean);
  } else if (entityType === 'recordings') {
    recordingsData.recordings = recordingsData.recordings.map((entry) => {
      if (!idSet.has(entry.id)) return entry;
      changed = true;
      return normalizeRecordingEntry({ ...entry, syncStatus: 'failed' });
    });
  } else if (entityType === 'notes') {
    notesData.notes = notesData.notes.map((entry) => {
      if (!idSet.has(entry.id)) return entry;
      changed = true;
      return normalizeNoteEntry({ ...entry, syncStatus: 'failed' });
    });
  } else if (entityType === 'chats') {
    chatsData.chats = chatsData.chats.map((entry) => {
      if (!idSet.has(entry.id)) return entry;
      changed = true;
      return normalizeChatEntry({ ...entry, syncStatus: 'failed' });
    });
  }
  return changed;
}

function persistSyncEntityStores(changeFlags = {}) {
  if (changeFlags.recordings) {
    persistRecordingsData({ triggerSync: false });
  }
  if (changeFlags.notes || changeFlags.folders) {
    persistNotesData({ triggerSync: false });
  }
  if (changeFlags.chats) {
    persistChatsData({ triggerSync: false });
  }
}

function applyPushResultToLocalState(pushPayloadResult = {}) {
  const applied = pushPayloadResult.applied || {};
  const noop = pushPayloadResult.noop || {};
  const rejected = pushPayloadResult.rejected || {};
  const changes = { folders: false, recordings: false, notes: false, chats: false };
  const rejectedMessages = [];

  for (const entityType of SYNC_ENTITY_TYPES) {
    const acknowledgedIds = [
      ...getResultIds(applied, entityType),
      ...getResultIds(noop, entityType),
    ];
    const versionMap = new Map([
      ...getResultVersionMap(applied, entityType),
      ...getResultVersionMap(noop, entityType),
    ]);
    if (acknowledgedIds.length) {
      changes[entityType] = markSyncEntitiesSynced(entityType, acknowledgedIds, versionMap) || changes[entityType];
      removeSyncOutboxByIds(entityType, acknowledgedIds, { persist: false });
      removePendingDeleteByIds(entityType, acknowledgedIds);
    }

    const rejectedEntries = Array.isArray(rejected && rejected[entityType]) ? rejected[entityType] : [];
    const rejectedIds = rejectedEntries.map((entry) => entry && entry.id).filter(Boolean);
    if (rejectedIds.length) {
      changes[entityType] = markSyncEntitiesFailed(entityType, rejectedIds) || changes[entityType];
      removeSyncOutboxByIds(entityType, rejectedIds, { persist: false });
      rejectedMessages.push(...rejectedEntries.map((entry) => entry.message || `${entityType} item was rejected by cloud sync.`));
    }
  }

  persistSyncState();
  persistSyncEntityStores(changes);

  if (rejectedMessages.length) {
    emitSyncStatus({
      level: 'error',
      code: 'SYNC_FAILED',
      message: rejectedMessages[0],
    });
  }
}

function classifySyncError(error) {
  const code = String(error && error.code ? error.code : '').toUpperCase();
  const message = String(error && error.message ? error.message : '');
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH'].includes(code)
    || /getaddrinfo|network|timed? out|ECONNREFUSED/i.test(message)) {
    return {
      code: 'NETWORK_UNREACHABLE',
      message: 'Cloud sync is offline right now. Check your connection or try again in a moment.',
    };
  }
  return {
    code: 'SYNC_FAILED',
    message: 'Cloud sync failed. Escribolt will keep your local changes and retry.',
  };
}

function markAllCloudSyncItemsFailed() {
  notesData.folders = notesData.folders.map((entry) => {
    const normalized = normalizeFolderEntry(entry);
    if (normalized && normalized.isCloudSynced) {
      return normalizeFolderEntry({
        ...normalized,
        syncStatus: 'failed',
      });
    }
    return normalized;
  }).filter(Boolean);
  recordingsData.recordings = recordingsData.recordings.map((entry) => {
    if (entry.isCloudSynced) {
      return normalizeRecordingEntry({
        ...entry,
        syncStatus: 'failed',
      });
    }
    return entry;
  });
  notesData.notes = notesData.notes.map((entry) => {
    const normalized = normalizeNoteEntry(entry);
    if (normalized.isCloudSynced) {
      return normalizeNoteEntry({
        ...normalized,
        syncStatus: 'failed',
      });
    }
    return normalized;
  });
  chatsData.chats = chatsData.chats.map((entry) => {
    if (entry.isCloudSynced) {
      return normalizeChatEntry({
        ...entry,
        syncStatus: 'failed',
      });
    }
    return entry;
  });
  persistNotesData({ triggerSync: false });
  persistRecordingsData({ triggerSync: false });
  persistChatsData({ triggerSync: false });
}

async function runSyncCycle() {
  if (!shouldRunSync()) {
    return;
  }

  if (Date.now() < Number(syncBackoffUntil || 0)) {
    scheduleSyncRun(Number(syncBackoffUntil || 0) - Date.now());
    return;
  }

  if (syncInFlight) {
    syncRerunRequested = true;
    return;
  }
  syncInFlight = true;
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('sync:start');
  }

  try {
    const hadJwtBeforeRefresh = hasStoredAuthJwt();
    const jwt = await readAuthJwtWithAutoRefresh();
    if (!jwt) {
      emitSyncStatus({
        level: 'warning',
        code: hadJwtBeforeRefresh ? 'AUTH_EXPIRED' : 'AUTH_REQUIRED',
        message: hadJwtBeforeRefresh
          ? 'You have been logged out. Sign in to resume cloud sync.'
          : 'Sign in to enable cloud sync.',
      });
      return;
    }

    const pushChunks = buildSyncPushChunks();
    for (const pushPayload of pushChunks) {
      const pushResult = await requestJson({
        targetUrl: `${BACKEND_BASE_URL}/api/sync/push`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
        body: pushPayload,
      });

      if (pushResult.statusCode === 429) {
        scheduleSyncRateLimitRetry(pushResult, 'push');
        return;
      }

      if (pushResult.statusCode < 200 || pushResult.statusCode >= 300) {
        const error = new Error((pushResult.payload && pushResult.payload.error) || `Sync push failed (${pushResult.statusCode})`);
        error.statusCode = pushResult.statusCode;
        throw error;
      }

      applyPushResultToLocalState(pushResult.payload || {});
    }

    syncState.lastPushAt = Date.now();
    persistSyncState();

    const pullSince = Number(syncState.lastPullSince || 0);
    const pullCursors = normalizeSyncCursorMap(syncState.pullCursors);
    const pullQuery = `cursors=${encodeURIComponent(JSON.stringify(pullCursors))}&limit=${SYNC_PULL_LIMIT}&since=${encodeURIComponent(String(pullSince))}`;
    const pullResult = await requestJson({
      targetUrl: `${BACKEND_BASE_URL}/api/sync/pull?${pullQuery}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (pullResult.statusCode === 429) {
      scheduleSyncRateLimitRetry(pullResult, 'pull');
      return;
    }

    if (pullResult.statusCode < 200 || pullResult.statusCode >= 300) {
      throw new Error((pullResult.payload && pullResult.payload.error) || `Sync pull failed (${pullResult.statusCode})`);
    }

    const pulled = pullResult.payload || {};
    const pulledFolders = Array.isArray(pulled.folders)
      ? pulled.folders
      : (Array.isArray(pulled.spaces) ? pulled.spaces : []);
    const folderMergeResult = mergeRemoteFolders(pulledFolders);
    const recordingsChanged = mergeRemoteRecordings(pulled.recordings || []);
    const notesChanged = mergeRemoteNotes(pulled.notes || []);
    const chatsChanged = mergeRemoteChats(pulled.chats || []);

    if (recordingsChanged || folderMergeResult.recordingsChanged) {
      persistRecordingsData({ triggerSync: false });
    }
    if (notesChanged || folderMergeResult.foldersChanged || folderMergeResult.notesChanged) {
      persistNotesData({ triggerSync: false });
    }
    if (chatsChanged || folderMergeResult.chatsChanged) {
      persistChatsData({ triggerSync: false });
    }

    syncState.lastPullSince = Number(pulled.nextSince || pullSince || 0);
    syncState.pullCursors = normalizeSyncCursorMap(pulled.cursors || pullCursors);
    persistSyncState();

    const conflicts = Array.isArray(pulled.conflicts) ? pulled.conflicts.map((entry) => normalizeRemoteConflict(entry)) : [];
    replacePendingSyncConflicts(conflicts);
    if (conflicts.length) {
      emitSyncStatus({
        level: 'warning',
        code: 'SYNC_CONFLICT',
        message: `${conflicts.length} sync conflict${conflicts.length === 1 ? '' : 's'} need attention.`,
      });
    }
    for (const conflict of conflicts) {
      if (!dashboardWindow || dashboardWindow.isDestroyed()) {
        await promptAndResolveConflict(conflict);
      }
    }

    const hasMorePullPages = SYNC_ENTITY_TYPES.some((entityType) => {
      const items = Array.isArray(pulled[entityType]) ? pulled[entityType] : [];
      return items.length >= SYNC_PULL_LIMIT;
    });
    const hasMorePush = SYNC_ENTITY_TYPES.some((entityType) => (
      Array.isArray(syncState.outbox && syncState.outbox[entityType])
      && syncState.outbox[entityType].length > 0
    ));
    if (hasMorePullPages || hasMorePush) {
      scheduleSyncRun(500);
    }

  } catch (error) {
    markAllCloudSyncItemsFailed();
    const classified = classifySyncError(error);
    emitSyncStatus({
      level: 'error',
      code: classified.code,
      message: classified.message,
    });
  } finally {
    syncInFlight = false;
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send('sync:end');
    }
    if (syncRerunRequested) {
      syncRerunRequested = false;
      scheduleSyncRun(500);
    }
  }
}
// --- Models ---
const MODELS = [
  { label: 'Qwen 2.5 7B (Fast)', id: 'qwen', path: 'mlx-community/Qwen2.5-7B-Instruct-4bit' },
  { label: 'Gemma 3 12B (Quality)', id: 'gemma', path: 'mlx-community/gemma-3-12b-it-qat-4bit' },
];

// --- Themes ---
const THEMES = [
  { label: 'Black (Default)', id: 'black' },
  { label: 'White (Light)', id: 'white' },
];

// --- Sticky Note Window Management ---
function getStickyNoteIdForWindow(win) {
  if (!win || win.isDestroyed()) {
    return '';
  }

  for (const [noteId, noteWindow] of stickyWindows.entries()) {
    if (noteWindow === win) {
      return noteId;
    }
  }
  return '';
}

function rememberStickyWindowBounds(win) {
  if (!win || win.isDestroyed()) {
    return;
  }

  try {
    const bounds = win.getBounds();
    const width = Math.max(200, Math.round(Number(bounds.width) || STICKY_NOTE_DEFAULT_WIDTH));
    const height = Math.max(150, Math.round(Number(bounds.height) || STICKY_NOTE_DEFAULT_HEIGHT));
    const x = Math.round(Number(bounds.x));
    const y = Math.round(Number(bounds.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    lastStickyWindowBounds = { x, y, width, height };
  } catch (_error) {
    // The window may already be closing.
  }
}

function getStickyCornerPosition(placement = DEFAULT_SETTINGS.stickyNoteDefaultPlacement) {
  const cursor = screen.getCursorScreenPoint();
  const currentDisplay = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = currentDisplay.workArea;
  const safeWidth = Math.max(STICKY_NOTE_DEFAULT_WIDTH, 0);
  const safeHeight = Math.max(STICKY_NOTE_DEFAULT_HEIGHT, 0);
  const margin = 24;
  const normalizedPlacement = STICKY_NOTE_DEFAULT_PLACEMENT_SET.has(placement)
    ? placement
    : DEFAULT_SETTINGS.stickyNoteDefaultPlacement;
  const alignRight = normalizedPlacement === 'top-right' || normalizedPlacement === 'bottom-right';
  const alignBottom = normalizedPlacement === 'bottom-left' || normalizedPlacement === 'bottom-right';
  const finalX = alignRight
    ? x + Math.max(0, width - safeWidth - margin)
    : x + Math.max(0, Math.min(margin, width - safeWidth));
  const finalY = alignBottom
    ? y + Math.max(0, height - safeHeight - margin)
    : y + Math.max(0, Math.min(margin, height - safeHeight));
  return { x: finalX, y: finalY };
}

function normalizeStickyBounds(bounds) {
  const rawX = Math.round(Number(bounds && bounds.x));
  const rawY = Math.round(Number(bounds && bounds.y));
  return {
    x: Number.isFinite(rawX) ? rawX : 0,
    y: Number.isFinite(rawY) ? rawY : 0,
    width: Math.max(200, Math.round(Number(bounds && bounds.width) || STICKY_NOTE_DEFAULT_WIDTH)),
    height: Math.max(150, Math.round(Number(bounds && bounds.height) || STICKY_NOTE_DEFAULT_HEIGHT)),
  };
}

function clampStickyBoundsToWorkArea(bounds, workArea) {
  const normalized = normalizeStickyBounds(bounds);
  const safeWidth = Math.max(200, Math.min(normalized.width, Math.max(200, workArea.width)));
  const safeHeight = Math.max(150, Math.min(normalized.height, Math.max(150, workArea.height)));
  const minX = workArea.x;
  const minY = workArea.y;
  const maxX = Math.max(minX, workArea.x + workArea.width - safeWidth);
  const maxY = Math.max(minY, workArea.y + workArea.height - safeHeight);

  return {
    x: Math.min(Math.max(normalized.x, minX), maxX),
    y: Math.min(Math.max(normalized.y, minY), maxY),
    width: safeWidth,
    height: safeHeight,
  };
}

function clampStickyBoundsToDisplayLayout(bounds) {
  const displays = screen.getAllDisplays();
  if (!displays.length) {
    return normalizeStickyBounds(bounds);
  }

  const normalized = normalizeStickyBounds(bounds);
  let bestBounds = null;
  let bestScore = Infinity;

  displays.forEach((display) => {
    const candidate = clampStickyBoundsToWorkArea(normalized, display.workArea);
    const dx = candidate.x - normalized.x;
    const dy = candidate.y - normalized.y;
    const score = (dx * dx) + (dy * dy);
    if (!bestBounds || score < bestScore) {
      bestBounds = candidate;
      bestScore = score;
    }
  });

  return bestBounds || normalizeStickyBounds(bounds);
}

function getInitialStickyWindowBounds() {
  if (lastStickyWindowBounds) {
    return clampStickyBoundsToDisplayLayout(lastStickyWindowBounds);
  }

  const position = getStickyCornerPosition(settings && settings.stickyNoteDefaultPlacement);
  return {
    x: position.x,
    y: position.y,
    width: STICKY_NOTE_DEFAULT_WIDTH,
    height: STICKY_NOTE_DEFAULT_HEIGHT,
  };
}

function getDefaultStickyNoteColorId() {
  return STICKY_NOTE_COLOR_ID_SET.has(settings && settings.stickyNoteDefaultColorId)
    ? settings.stickyNoteDefaultColorId
    : DEFAULT_SETTINGS.stickyNoteDefaultColorId;
}

function showStickyWindowInActiveSpace(win) {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });

  if (typeof win.moveTop === 'function') {
    try {
      win.moveTop();
    } catch (_error) {
      // Ignore platform-specific moveTop races.
    }
  }

  if (typeof win.showInactive === 'function') {
    win.showInactive();
  } else {
    win.show();
  }

  if (typeof win.moveTop === 'function') {
    try {
      win.moveTop();
    } catch (_error) {
      // Ignore platform-specific moveTop races.
    }
  }
}

function saveNoteDataFromInput(noteDataInput = {}) {
  if (!noteDataInput || typeof noteDataInput !== 'object' || typeof noteDataInput.id !== 'string') {
    return { didMutate: false, updatedNote: null };
  }

  const idx = notesData.notes.findIndex(n => n.id === noteDataInput.id);
  const resolveFolderId = (candidate) => {
    const normalized = typeof candidate === 'string' ? candidate.trim() : '';
    if (!normalized || normalized === 'default') return '';
    const folderExists = (notesData.folders || []).some(f => f.id === normalized);
    return folderExists ? normalized : '';
  };
  const payload = { ...noteDataInput };
  if (Object.prototype.hasOwnProperty.call(payload, 'folderId')) {
    payload.folderId = resolveFolderId(payload.folderId);
  }
  let updatedNote;
  let didMutate = false;
  if (idx !== -1) {
    const current = normalizeNoteEntry(notesData.notes[idx]);
    const mergedCandidate = normalizeNoteEntry({
      ...current,
      ...payload,
      lastModified: current.lastModified,
      updatedAt: current.updatedAt,
      version: Number.parseInt(current.version, 10) || 1,
    });
    if (hasNoteMutableFieldChanges(current, mergedCandidate)) {
      const now = Date.now();
      notesData.notes[idx] = normalizeNoteEntry({
        ...mergedCandidate,
        lastModified: now,
        updatedAt: now,
        version: current.isCloudSynced
          ? (Number.parseInt(current.version, 10) || 1) + 1
          : (Number.parseInt(current.version, 10) || 1),
        syncStatus: mergedCandidate.isCloudSynced ? 'pending' : 'synced',
      });
      updatedNote = notesData.notes[idx];
      didMutate = true;
    } else {
      updatedNote = current;
    }
  } else {
    const now = Date.now();
    updatedNote = normalizeNoteEntry({
      ...payload,
      folderId: resolveFolderId(payload.folderId),
      createdAt: now,
      lastModified: now,
      updatedAt: now,
      version: 1,
      isCloudSynced: typeof payload.isCloudSynced === 'boolean'
        ? payload.isCloudSynced
        : !isStrictPrivacyModeEnabled(),
      syncStatus: (typeof payload.isCloudSynced === 'boolean' ? payload.isCloudSynced : !isStrictPrivacyModeEnabled())
        ? 'pending'
        : 'synced',
    });
    notesData.notes.push(updatedNote);
    didMutate = true;
  }
  if (didMutate) {
    persistNotesData();
  }

  return { didMutate, updatedNote };
}

function closeStickyWindowAfterFinalSave(noteId, win) {
  const safeNoteId = typeof noteId === 'string' ? noteId : '';
  if (!safeNoteId || !win || win.isDestroyed()) {
    return;
  }

  if (pendingStickyWindowFinalSaveCloses.has(safeNoteId)) {
    try {
      win.hide();
    } catch (_error) {
      // Window is already closing or hidden.
    }
    return;
  }

  if (activeNoteId === safeNoteId) {
    activeNoteId = null;
  }

  rememberStickyWindowBounds(win);

  try {
    win.hide();
  } catch (_error) {
    // Continue to the final-save request even if the window is already hiding.
  }

  const requestId = crypto.randomUUID();
  let didFinish = false;
  let timeoutHandle = null;

  function cleanup() {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    ipcMain.removeListener('sticky:save-now-complete', handleSaveNowComplete);
    pendingStickyWindowFinalSaveCloses.delete(safeNoteId);
  }

  function finish() {
    if (didFinish) {
      return;
    }
    didFinish = true;
    cleanup();
    if (!win.isDestroyed()) {
      win.close();
    }
  }

  function cancel() {
    if (didFinish) {
      return;
    }
    didFinish = true;
    cleanup();
  }

  function handleSaveNowComplete(_event, payload = {}) {
    if (!payload || payload.requestId !== requestId) {
      return;
    }
    const notePayload = payload.note;
    if (notePayload && typeof notePayload === 'object' && notePayload.id === safeNoteId) {
      saveNoteDataFromInput(notePayload);
    }
    finish();
  }

  pendingStickyWindowFinalSaveCloses.set(safeNoteId, { cancel });
  ipcMain.on('sticky:save-now-complete', handleSaveNowComplete);
  timeoutHandle = setTimeout(finish, STICKY_NOTE_FINAL_SAVE_TIMEOUT_MS);
  if (timeoutHandle && typeof timeoutHandle.unref === 'function') {
    timeoutHandle.unref();
  }

  try {
    win.webContents.send('sticky:save-now', { requestId });
  } catch (_error) {
    finish();
  }
}

function cancelPendingStickyWindowClose(noteId) {
  const safeNoteId = typeof noteId === 'string' ? noteId : '';
  if (!safeNoteId) {
    return;
  }

  const pendingClose = pendingStickyWindowFinalSaveCloses.get(safeNoteId);
  if (pendingClose && typeof pendingClose.cancel === 'function') {
    pendingClose.cancel();
  }
}

function closeOtherStickyWindowsExcept(noteId) {
  const safeNoteId = typeof noteId === 'string' ? noteId : '';
  for (const [otherNoteId, noteWindow] of stickyWindows.entries()) {
    if (otherNoteId === safeNoteId) {
      continue;
    }
    if (!noteWindow || noteWindow.isDestroyed()) {
      stickyWindows.delete(otherNoteId);
      continue;
    }
    closeStickyWindowAfterFinalSave(otherNoteId, noteWindow);
  }
}

function createStickyWindow(note) {
  const noteId = note && typeof note.id === 'string' ? note.id : '';
  if (!noteId) {
    return;
  }

  cancelPendingStickyWindowClose(noteId);
  closeOtherStickyWindowsExcept(noteId);

  // If window already exists for this note, reveal it on the active Space.
  if (stickyWindows.has(noteId)) {
    const win = stickyWindows.get(noteId);
    if (!win.isDestroyed()) {
      win.webContents.send('load-note', note);
      showStickyWindowInActiveSpace(win);
      return;
    }
    stickyWindows.delete(noteId);
  }

  // Create new window
  const initialBounds = getInitialStickyWindowBounds();
  const win = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    x: initialBounds.x,
    y: initialBounds.y,
    minWidth: 200,
    minHeight: 150,
    show: false,
    frame: false, // Custom frame in StickyApp
    transparent: false,
    hasShadow: true,
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    alwaysOnTop: true, // Popped-out notes should float above other apps
    skipTaskbar: true,
    hiddenInMissionControl: true,
    fullscreenable: false,
    maximizable: false,
    acceptFirstMouse: true, // Allow clicking/dragging without focusing first
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load StickyApp via hash
  const startUrl = isDev
    ? 'http://localhost:3000#sticky'
    : `file://${path.join(__dirname, '../build/index.html')}#sticky`;

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });

  // Store reference before loading so sticky-ready can find this window.
  stickyWindows.set(noteId, win);

  win.loadURL(startUrl);
  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('load-note', note);
      showStickyWindowInActiveSpace(win);
    }
  });

  // Setup listeners
  win.on('focus', () => { activeNoteId = noteId; });
  win.on('blur', () => {
    if (activeNoteId === noteId) activeNoteId = null;
  });
  win.on('move', () => { rememberStickyWindowBounds(win); });
  win.on('moved', () => { rememberStickyWindowBounds(win); });
  win.on('resize', () => { rememberStickyWindowBounds(win); });
  win.on('resized', () => { rememberStickyWindowBounds(win); });
  win.on('close', () => { rememberStickyWindowBounds(win); });

  win.on('closed', () => {
    stickyWindows.delete(noteId);
    if (activeNoteId === noteId) activeNoteId = null;
  });

  // Open devtools in dev
  // if (isDev) win.webContents.openDevTools();
}

function getDashboardWindowState(targetWindow = dashboardWindow) {
  const win = targetWindow;
  if (!win || win.isDestroyed()) {
    return { isFullScreen: false };
  }

  let isFullScreen = false;
  try {
    if (typeof win.isFullScreen === 'function') {
      isFullScreen = win.isFullScreen();
    }
  } catch (_error) {
    isFullScreen = false;
  }

  if (!isFullScreen) {
    try {
      if (typeof win.isSimpleFullScreen === 'function') {
        isFullScreen = win.isSimpleFullScreen();
      }
    } catch (_error) {
      // Ignore simple-full-screen probing failures.
    }
  }

  return { isFullScreen };
}

function emitDashboardWindowState(targetWindow = dashboardWindow) {
  const win = targetWindow;
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('dashboard:window-state', getDashboardWindowState(win));
  } catch (_error) {
    // Ignore transient renderer disposal races.
  }
}

function createDashboardWindow(options = {}) {
  const showWindow = options.show !== false;
  const focusWindow = options.focus !== false;

  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    if (showWindow) {
      if (process.platform === 'darwin' && app.dock) {
        app.dock.show();
      }
      dashboardWindow.show();
      if (focusWindow) {
        dashboardWindow.focus();
      }
    }
    return;
  }

  const dashboardWindowOptions = {
    width: 1240,
    height: 820,
    // About 60% of the previous minimum (980 -> 588) for a tighter lower bound.
    minWidth: 588,
    minHeight: 448,
    titleBarStyle: 'hiddenInset',
    maximizable: true,
    fullscreenable: true,
    show: showWindow,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  };

  if (process.platform === 'darwin') {
    // Slightly lower native traffic lights to better align with the custom top bar rhythm.
    dashboardWindowOptions.trafficLightPosition = { x: 14, y: 12 };
  }

  if (process.platform === 'darwin' && app.dock && showWindow) {
    app.dock.show();
  }
  dashboardWindow = new BrowserWindow(dashboardWindowOptions);
  dashboardRecordModeCommandReady = false;
  dashboardWindow.setMaximizable(true);
  dashboardWindow.setFullScreenable(true);
  dashboardWindow.setAlwaysOnTop(false);
  dashboardWindow.setVisibleOnAllWorkspaces(false, {
    visibleOnFullScreen: false,
    skipTransformProcessType: true,
  });

  const startUrl = isDev
    ? 'http://localhost:3000#dashboard'
    : `file://${path.join(__dirname, '../build/index.html')}#dashboard`;

  dashboardWindow.loadURL(startUrl);
  dashboardWindow.webContents.on('did-start-loading', () => {
    dashboardRecordModeCommandReady = false;
  });
  dashboardWindow.webContents.on('did-finish-load', () => {
    emitDashboardWindowState(dashboardWindow);
  });
  dashboardWindow.webContents.on('before-input-event', (event, input = {}) => {
    const key = String(input.key || '').toLowerCase();
    const isMacCloseShortcut = process.platform === 'darwin' && input.meta && !input.control;
    const isNonMacCloseShortcut = process.platform !== 'darwin' && input.control && !input.meta;
    if (key !== 'w' || (!isMacCloseShortcut && !isNonMacCloseShortcut) || input.alt || input.shift) {
      return;
    }
    event.preventDefault();
    try {
      dashboardWindow.webContents.send('dashboard:menu-command', 'close-tab');
    } catch (_error) {
      // Ignore renderer teardown races.
    }
  });
  dashboardWindow.on('enter-full-screen', () => emitDashboardWindowState(dashboardWindow));
  dashboardWindow.on('leave-full-screen', () => emitDashboardWindowState(dashboardWindow));
  dashboardWindow.on('enter-html-full-screen', () => emitDashboardWindowState(dashboardWindow));
  dashboardWindow.on('leave-html-full-screen', () => emitDashboardWindowState(dashboardWindow));

  if (showWindow) {
    dashboardWindow.once('ready-to-show', () => {
      if (!dashboardWindow || dashboardWindow.isDestroyed()) {
        return;
      }
      dashboardWindow.show();
      if (focusWindow) {
        dashboardWindow.focus();
      }
    });
  }

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
    dashboardRecordModeCommandReady = false;
    if (pendingDashboardRecordModeCommand && pendingDashboardRecordModeCommand.action === 'start') {
      recordModeStartPending = false;
    }
    pendingDashboardRecordModeCommand = null;
    clearPendingDashboardRecordModeCommandTimer();
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }
  });
}

function normalizeDashboardNavigationDestination(destination = {}) {
  const type = typeof destination.type === 'string' ? destination.type.trim() : '';
  const id = typeof destination.id === 'string' ? destination.id.trim() : '';
  if ((type === 'note' || type === 'recording' || type === 'chat') && id) {
    return { type, id };
  }
  if (type === 'settings') {
    const settingsTab = typeof destination.settingsTab === 'string' && destination.settingsTab.trim()
      ? destination.settingsTab.trim()
      : 'general';
    return { type, settingsTab };
  }
  return null;
}

function openDashboardDestination(destination = {}, options = {}) {
  const normalizedDestination = normalizeDashboardNavigationDestination(destination);
  if (!normalizedDestination) return;

  const shouldFocus = options && options.focus !== false;
  pendingDashboardNavigation = normalizedDestination;

  createDashboardWindow({ show: true, focus: shouldFocus });
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    return;
  }

  if (dashboardWindow.webContents.isLoading()) {
    return;
  }

  dashboardWindow.webContents.send('dashboard:navigate', normalizedDestination);
  pendingDashboardNavigation = null;
}

function openNoteInDashboard(noteId, options = {}) {
  const safeNoteId = typeof noteId === 'string' ? noteId.trim() : '';
  if (!safeNoteId) return;
  openDashboardDestination({ type: 'note', id: safeNoteId }, options);
}

function sendDashboardMenuCommand(command) {
  const safeCommand = typeof command === 'string' ? command.trim() : '';
  if (!safeCommand) return;
  createDashboardWindow({ show: true, focus: true });
  if (!dashboardWindow || dashboardWindow.isDestroyed() || dashboardWindow.webContents.isLoading()) {
    pendingDashboardMenuCommands.push(safeCommand);
    return;
  }

  try {
    dashboardWindow.webContents.send('dashboard:menu-command', safeCommand);
  } catch (_error) {
    pendingDashboardMenuCommands.push(safeCommand);
  }
}

function installApplicationMenu() {
  if (process.platform !== 'darwin') {
    return;
  }

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Note',
          accelerator: 'Command+Shift+N',
          click: () => sendDashboardMenuCommand('new-note'),
        },
        {
          label: 'New Chat',
          accelerator: 'Command+N',
          click: () => sendDashboardMenuCommand('new-chat'),
        },
        {
          label: 'Reopen Last Closed Tab',
          accelerator: 'Command+Shift+T',
          click: () => sendDashboardMenuCommand('reopen-last-closed-tab'),
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'Command+W',
          click: () => sendDashboardMenuCommand('close-tab'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      label: 'Help',
      submenu: [],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function escapeAppleScriptString(value = '') {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function showMacOsNotificationFallback(body = '') {
  if (process.platform !== 'darwin') {
    return;
  }

  const safeBody = escapeAppleScriptString(body || 'Quick note created.');
  const safeTitle = escapeAppleScriptString('Escribolt');
  try {
    const child = spawn('osascript', [
      '-e',
      `display notification "${safeBody}" with title "${safeTitle}"`,
    ], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (error) {
    console.warn('[quick-note] macOS notification fallback failed:', error.message);
  }
}

function showQuickNoteCreatedNotification(note = {}) {
  if (process.platform !== 'darwin') {
    return;
  }

  const safeNoteId = typeof note.id === 'string' ? note.id.trim() : '';
  if (!safeNoteId) {
    return;
  }

  const previewRaw = String(note.text || '').replace(/\s+/g, ' ').trim();
  const preview = previewRaw
    ? `${previewRaw.slice(0, 110)}${previewRaw.length > 110 ? '...' : ''}`
    : '';
  const body = preview
    ? `Quick note created: ${preview}`
    : 'Quick note created.';

  if (!(Notification && Notification.isSupported && Notification.isSupported())) {
    console.warn('[quick-note] Electron notifications are unsupported; using macOS fallback.');
    showMacOsNotificationFallback(body);
    return;
  }

  try {
    const notification = new Notification({
      title: 'Escribolt',
      body,
    });
    activeQuickNoteNotifications.add(notification);
    const releaseNotification = () => {
      activeQuickNoteNotifications.delete(notification);
    };
    notification.on('show', () => {
      console.log('[quick-note] macOS notification shown.');
    });
    notification.on('click', () => {
      releaseNotification();
      openNoteInDashboard(safeNoteId, { focus: true });
    });
    notification.on('close', releaseNotification);
    notification.on('failed', (_event, error) => {
      releaseNotification();
      console.warn('[quick-note] Electron notification failed; using macOS fallback:', error || 'unknown error');
      showMacOsNotificationFallback(body);
    });
    notification.show();
  } catch (error) {
    console.warn('[quick-note] Electron notification failed; using macOS fallback:', error.message);
    showMacOsNotificationFallback(body);
  }
}

function startRecordModeFromTray() {
  const isCapturing = trayRecordModeStatus === 'capturing';
  const command = isCapturing ? 'stop' : 'start';

  if (command === 'start') {
    if (isDictationBusy()) {
      showDictationConflictBanner();
      return;
    }
    if (isRecordModeBusy()) {
      showRecordModeBusyBanner();
      return;
    }
    recordModeStartPending = true;
    disarmDictationCapture();
  }

  createDashboardWindow({ show: false, focus: false });
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    recordModeStartPending = false;
    return;
  }

  sendRecordModeCommandToDashboard({
    action: command,
    preapproved: command === 'start',
  });
}

function positionMainWidget() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { width, height } = mainWindow.getBounds();
  const { x, y, width: dWidth, height: dHeight } = display.workArea;
  const finalX = x + Math.round((dWidth - width) / 2);
  const finalY = y + dHeight - height - 40;
  mainWindow.setPosition(finalX, finalY);
}

function clampMainWidgetBoundsToVisibleWorkArea(bounds) {
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const minX = workArea.x;
  const minY = workArea.y;
  const maxX = Math.max(minX, workArea.x + workArea.width - bounds.width);
  const maxY = Math.max(minY, workArea.y + workArea.height - bounds.height);

  return {
    ...bounds,
    x: Math.min(Math.max(bounds.x, minX), maxX),
    y: Math.min(Math.max(bounds.y, minY), maxY),
  };
}

function shouldKeepMainWidgetWindowVisible() {
  return promoBannerPending
    || promoBannerVisible
    || meetingPromptVisible
    || recordModeWidgetVisible
    || dictationLifecycleState !== DICTATION_LIFECYCLE_STATES.IDLE;
}

function hideMainWidgetWindowIfUnused() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
    return;
  }
  if (shouldKeepMainWidgetWindowVisible()) {
    return;
  }
  mainWindow.hide();
}

function setPromoBannerPending(pending) {
  promoBannerPending = !!pending;
  if (!promoBannerPending && !promoBannerVisible) {
    hideMainWidgetWindowIfUnused();
  }
}

function setPromoBannerRenderedState(visible) {
  promoBannerPending = false;
  promoBannerVisible = !!visible;
  if (promoBannerVisible) {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.showInactive();
    }
    return;
  }
  hideMainWidgetWindowIfUnused();
}

function showMainWidgetErrorBanner(message, { dismissPill = true } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const cleanMessage = String(message || '').trim() || 'Dictation failed. Please try again.';
  setPromoBannerPending(true);
  mainWindow.webContents.send('record-mode:show-error-banner', {
    message: cleanMessage,
    dismissPill,
  });
}

function isRecordModeBusy() {
  return recordModeStartPending
    || trayRecordModeStatus === 'selecting'
    || trayRecordModeStatus === 'capturing'
    || trayRecordModeStatus === 'processing';
}

function isDictationBusy() {
  return isRecording || dictationLifecycleState !== DICTATION_LIFECYCLE_STATES.IDLE;
}

function normalizeVoiceActionMode(actionMode = 'transcription') {
  return actionMode === 'quick-note' ? 'quick-note' : 'transcription';
}

function getActiveVoiceActionMode() {
  return normalizeVoiceActionMode(
    (activeVoiceActionContext && activeVoiceActionContext.actionMode) || activeVoiceActionMode,
  );
}

function getVoiceActionLabel(actionMode = 'transcription') {
  return normalizeVoiceActionMode(actionMode) === 'quick-note' ? 'Quick note' : 'Dictation';
}

function isVoiceActionProcessing() {
  return dictationLifecycleState === DICTATION_LIFECYCLE_STATES.STOPPING
    || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.PROCESSING;
}

function getVoiceActionStopInstruction(actionMode = 'transcription') {
  const shortcuts = normalizeShortcutSettings(settings && settings.shortcuts ? settings.shortcuts : {});
  if (normalizeVoiceActionMode(actionMode) === 'quick-note') {
    const preset = shortcuts.quickNotePreset;
    const shortcutLabel = preset === 'fn_n_toggle'
      ? 'Fn'
      : prettyAccelerator(QUICK_NOTE_PRESET_TO_ACCELERATOR[preset] || 'Control+N');
    return `Press ${shortcutLabel} to stop quick note.`;
  }

  const activationSource = activeVoiceActionContext && activeVoiceActionContext.activationSource;
  if (activationSource === 'fn-hold') {
    return 'Release Fn to stop dictation.';
  }
  const preset = shortcuts.dictationHandsFreePreset;
  const shortcutLabel = preset === 'fn_space_toggle'
    ? 'Fn'
    : prettyAccelerator(DICTATION_HANDS_FREE_PRESET_TO_ACCELERATOR[preset] || 'Control+Space');
  return `Press ${shortcutLabel} to stop dictation.`;
}

function getRecordModeStopInstruction() {
  const shortcuts = normalizeShortcutSettings(settings && settings.shortcuts ? settings.shortcuts : {});
  const preset = shortcuts.recordModePreset;
  const shortcutLabel = preset === 'fn_r_toggle'
    ? 'Fn+R'
    : prettyAccelerator(RECORD_MODE_PRESET_TO_ACCELERATOR[preset] || 'Control+R');
  return `Press ${shortcutLabel} to stop recording mode.`;
}

function getRecordModeBusyMessage(requestedLabel = 'another recording') {
  if (trayRecordModeStatus === 'processing') {
    return `Recording mode is still processing. Please wait for it to finish before starting ${requestedLabel}.`;
  }
  if (recordModeStartPending || trayRecordModeStatus === 'selecting') {
    return `Recording mode is already starting. Please wait before starting ${requestedLabel}.`;
  }
  return `Recording mode is already active. ${getRecordModeStopInstruction()} Then start ${requestedLabel}.`;
}

function getRecordModeConflictMessage(requestedActionMode = 'transcription') {
  return getRecordModeBusyMessage(getVoiceActionLabel(requestedActionMode).toLowerCase());
}

function showRecordModeBusyBanner() {
  const message = getRecordModeBusyMessage();
  showMainWidgetErrorBanner(message, { dismissPill: false });
  return message;
}

function showRecordModeConflictBanner(requestedActionMode = 'transcription') {
  const message = getRecordModeConflictMessage(requestedActionMode);
  showMainWidgetErrorBanner(message, { dismissPill: false });
  return message;
}

function showDictationConflictBanner() {
  const activeLabel = getVoiceActionLabel(getActiveVoiceActionMode());
  const message = isVoiceActionProcessing()
    ? `${activeLabel} is still processing. Please wait for it to finish before starting recording mode.`
    : `${activeLabel} is already active. ${getVoiceActionStopInstruction(getActiveVoiceActionMode())} Then start recording mode.`;
  showMainWidgetErrorBanner(message, { dismissPill: false });
  return message;
}

function showDictationBusyBanner(requestedActionMode = 'transcription') {
  const activeMode = getActiveVoiceActionMode();
  const requestedMode = normalizeVoiceActionMode(requestedActionMode);
  const activeLabel = getVoiceActionLabel(activeMode);
  const requestedLabel = getVoiceActionLabel(requestedMode).toLowerCase();
  const requestedPhrase = requestedMode === activeMode
    ? `another ${requestedLabel}`
    : requestedLabel;
  showMainWidgetErrorBanner(
    isVoiceActionProcessing()
      ? `${activeLabel} is still processing. Please wait for it to finish before starting ${requestedPhrase}.`
      : `${activeLabel} is already active. ${getVoiceActionStopInstruction(activeMode)} Then start ${requestedPhrase}.`,
    { dismissPill: false },
  );
}

function clearPendingDashboardRecordModeCommandTimer() {
  if (pendingDashboardRecordModeCommandTimer) {
    clearTimeout(pendingDashboardRecordModeCommandTimer);
    pendingDashboardRecordModeCommandTimer = null;
  }
}

function dispatchRecordModeCommandToDashboard(payload) {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    return false;
  }
  dashboardWindow.webContents.send('record-mode:command-from-tray', payload);
  return true;
}

function flushPendingDashboardRecordModeCommand() {
  if (!pendingDashboardRecordModeCommand) {
    return false;
  }
  if (!dashboardWindow || dashboardWindow.isDestroyed() || dashboardWindow.webContents.isLoading() || !dashboardRecordModeCommandReady) {
    return false;
  }
  const payload = pendingDashboardRecordModeCommand;
  pendingDashboardRecordModeCommand = null;
  clearPendingDashboardRecordModeCommandTimer();
  return dispatchRecordModeCommandToDashboard(payload);
}

function queueRecordModeCommandForDashboard(payload) {
  pendingDashboardRecordModeCommand = payload;
  clearPendingDashboardRecordModeCommandTimer();
  pendingDashboardRecordModeCommandTimer = setTimeout(() => {
    const timedOutCommand = pendingDashboardRecordModeCommand;
    pendingDashboardRecordModeCommand = null;
    pendingDashboardRecordModeCommandTimer = null;
    if (timedOutCommand && timedOutCommand.action === 'start') {
      recordModeStartPending = false;
      showMainWidgetErrorBanner('Recording mode could not start because the dashboard is still loading.', { dismissPill: false });
    }
  }, 10000);
  if (pendingDashboardRecordModeCommandTimer && typeof pendingDashboardRecordModeCommandTimer.unref === 'function') {
    pendingDashboardRecordModeCommandTimer.unref();
  }
}

function sendRecordModeCommandToDashboard(payload) {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    return false;
  }
  if (!dashboardWindow.webContents.isLoading() && dashboardRecordModeCommandReady) {
    return dispatchRecordModeCommandToDashboard(payload);
  }
  queueRecordModeCommandForDashboard(payload);
  return false;
}


function createWindow() {
  mainWindow = new BrowserWindow({
    width: MAIN_WIDGET_WIDTH,
    height: MAIN_WIDGET_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    type: 'panel',
    alwaysOnTop: true,
    center: true,
    focusable: false,
    acceptFirstMouse: true,
    resizable: false,
    minimizable: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    fullscreenable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: true,
    },
  });

  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // Send initial theme when window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('set-theme', selectedTheme);
  });

  positionMainWidget();
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });

  mainWindow.loadURL(
    isDev
      ? 'http://localhost:3000'
      : `file://${path.join(__dirname, '../build/index.html')}`
  );
}

function getRecordModeProcessingWidgetState() {
  const location = getProcessingLocation('meetingTranscription');
  const effectiveMode = getEffectiveProcessingMode('meetingTranscription');
  return {
    feature: 'meetingTranscription',
    location,
    effectiveMode,
    cloudAvailable: settings.mode === 'pro' || settings.mode === 'byok' || getAuthState().isLoggedIn,
  };
}

function syncRecordProcessingWidget(status = trayRecordModeStatus) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('record-processing-widget:state', getRecordModeProcessingWidgetState());
  }
}

function syncRecordModeWidget(status = 'idle') {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const normalized = typeof status === 'string' ? status : 'idle';
  if (normalized !== 'idle') {
    const activePromptKey = activeMeetingPrompt && activeMeetingPrompt.key;
    if (activePromptKey) {
      meetingPromptState.suppress(activePromptKey);
    } else {
      meetingPromptState.hide();
    }
    setMeetingPromptVisible(null);
  }
  recordModeStartPending = false;
  if (trayRecordModeStatus !== normalized) {
    trayRecordModeStatus = normalized;
    if (tray && !tray.isDestroyed()) {
      buildTrayMenu();
    }
  }

  if (normalized === 'capturing') {
    const wasAlreadyCapturing = recordModeWidgetVisible;
    recordModeWidgetVisible = true;
    if (!wasAlreadyCapturing) {
      if (mainWindow.getBounds().height !== MAIN_WIDGET_RECORD_HEIGHT || mainWindow.getBounds().width !== MAIN_WIDGET_WIDTH) {
        mainWindow.setSize(MAIN_WIDGET_WIDTH, MAIN_WIDGET_RECORD_HEIGHT);
        positionMainWidget();
      }
    }
    mainWindow.showInactive();
    mainWindow.webContents.send('record-mode:status', { status: normalized });
    syncRecordProcessingWidget(normalized);
    return;
  }

  if (!recordModeWidgetVisible) {
    syncRecordProcessingWidget(normalized);
    return;
  }

  recordModeWidgetVisible = false;
  syncRecordProcessingWidget(normalized);
  if (mainWindow.getBounds().height !== MAIN_WIDGET_HEIGHT || mainWindow.getBounds().width !== MAIN_WIDGET_WIDTH) {
    mainWindow.setSize(MAIN_WIDGET_WIDTH, MAIN_WIDGET_HEIGHT);
    positionMainWidget();
  }
  syncRecordModeWidgetAudio({
    level: 0,
    bars: Array.from({ length: 9 }, () => 0.08),
  });
  mainWindow.webContents.send('record-mode:status', { status: 'idle' });
  mainWindow.webContents.send('reset');
  hideMainWidgetWindowIfUnused();
}

function syncRecordModeWidgetAudio(payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  let level = 0;
  if (typeof payload.level === 'number' && Number.isFinite(payload.level)) {
    level = Math.max(0, Math.min(1, payload.level));
  }

  let bars;
  if (Array.isArray(payload.bars)) {
    bars = payload.bars
      .slice(0, 9)
      .map((value) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          return 0.08;
        }
        return Math.max(0, Math.min(1, numeric));
      });
    while (bars.length < 9) {
      bars.push(0.08);
    }
  }

  mainWindow.webContents.send('record-mode:system-audio', {
    level,
    bars,
  });
}

function buildMeetingPromptPayload(visible = meetingPromptVisible, meeting = activeMeetingPrompt) {
  return {
    visible: !!visible && !!meeting,
    durationMs: MEETING_PROMPT_DISPLAY_MS,
    meeting: meeting ? {
      provider: meeting.provider,
      providerLabel: meeting.providerLabel,
      key: meeting.key,
      title: meeting.title,
      url: meeting.url || '',
      source: meeting.source || '',
    } : null,
  };
}

function clearMeetingPromptAutoDismissTimer() {
  if (meetingPromptAutoDismissTimer) {
    clearTimeout(meetingPromptAutoDismissTimer);
    meetingPromptAutoDismissTimer = null;
  }
}

function scheduleMeetingPromptAutoDismiss(meeting = activeMeetingPrompt) {
  clearMeetingPromptAutoDismissTimer();
  if (!meeting || !meeting.key) {
    return;
  }
  const key = meeting.key;
  meetingPromptAutoDismissTimer = setTimeout(() => {
    meetingPromptAutoDismissTimer = null;
    if (!activeMeetingPrompt || activeMeetingPrompt.key !== key || !meetingPromptVisible) {
      return;
    }
    meetingPromptState.suppress(key);
    setMeetingPromptVisible(null);
  }, MEETING_PROMPT_DISPLAY_MS);
  if (meetingPromptAutoDismissTimer && typeof meetingPromptAutoDismissTimer.unref === 'function') {
    meetingPromptAutoDismissTimer.unref();
  }
}

function syncMeetingPromptWidget(force = false) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const payload = buildMeetingPromptPayload();
  const payloadJson = JSON.stringify(payload);
  if (!force && payloadJson === lastMeetingPromptPayloadJson) {
    return;
  }
  lastMeetingPromptPayloadJson = payloadJson;
  mainWindow.webContents.send('meeting-prompt:state', payload);
}

function setMeetingPromptVisible(meeting = null) {
  activeMeetingPrompt = meeting;
  meetingPromptVisible = !!meeting;
  if (meetingPromptVisible) {
    scheduleMeetingPromptAutoDismiss(meeting);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.showInactive();
    }
  } else {
    clearMeetingPromptAutoDismissTimer();
  }
  syncMeetingPromptWidget(true);
  if (!meetingPromptVisible) {
    hideMainWidgetWindowIfUnused();
  }
}

function applyMeetingPromptSnapshot(snapshot = meetingPromptState.snapshot()) {
  const nextMeeting = snapshot && snapshot.visible ? snapshot.meeting : null;
  const currentKey = activeMeetingPrompt && activeMeetingPrompt.key;
  const nextKey = nextMeeting && nextMeeting.key;
  if (currentKey === nextKey && meetingPromptVisible === !!nextMeeting) {
    if (nextMeeting && JSON.stringify(buildMeetingPromptPayload(true, nextMeeting)) !== lastMeetingPromptPayloadJson) {
      activeMeetingPrompt = nextMeeting;
      syncMeetingPromptWidget(true);
    }
    return;
  }
  setMeetingPromptVisible(nextMeeting);
}

function isMeetingPromptSettingEnabled() {
  return process.platform === 'darwin'
    && settings
    && settings.meetingPromptEnabled === true
    && settings.meetingPromptConsentGranted === true
    && !meetingPromptDetectionDisabled;
}

function isMeetingPromptBusy() {
  return isRecordModeBusy() || isDictationBusy();
}

function meetingPromptDebug(message, details = null) {
  if (!MEETING_PROMPT_DEBUG) {
    return;
  }
  if (details) {
    console.log(`[meeting-prompt:debug] ${message}`, details);
    return;
  }
  console.log(`[meeting-prompt:debug] ${message}`);
}

function isMeetingPromptAutomationDeniedMessage(message = '') {
  const lowered = String(message || '').toLowerCase();
  return lowered.includes('-1743')
    || lowered.includes('not authorized to send apple events')
    || lowered.includes('not authorised to send apple events');
}

function normalizeBrowserPermissionAppName(appName = '') {
  return String(appName || '').replace(/\s+/g, ' ').trim() || 'the browser';
}

function warnMeetingPromptBrowserPermission(appName = '', message = '') {
  const browserName = normalizeBrowserPermissionAppName(appName);
  const key = `${browserName}:${isMeetingPromptAutomationDeniedMessage(message) ? 'automation' : 'unavailable'}`;
  if (meetingPromptBrowserPermissionWarnings.has(key)) {
    return false;
  }
  meetingPromptBrowserPermissionWarnings.add(key);
  if (isMeetingPromptAutomationDeniedMessage(message)) {
    console.warn(
      `[meeting-prompt] Browser tab access is blocked for ${browserName}. `
      + `Enable macOS Automation permission for Electron/Escribolt to control ${browserName}, then keep the meeting tab foreground.`,
    );
    return true;
  }
  console.warn(`[meeting-prompt] Browser tab details are unavailable for ${browserName}: ${message}`);
  return true;
}

function logMeetingPromptPollDebug({
  snapshot = null,
  meeting = null,
  promptSnapshot = null,
  busy = false,
  enabled = true,
  disabled = false,
} = {}) {
  if (!MEETING_PROMPT_DEBUG) {
    return;
  }

  const candidate = meetingPromptState.candidate || null;
  const now = Date.now();
  const summary = {
    enabled: !!enabled,
    disabled: !!disabled,
    busy: !!busy,
    appName: snapshot && snapshot.appName ? snapshot.appName : '',
    title: snapshot && snapshot.title ? snapshot.title : '',
    url: snapshot && snapshot.url ? snapshot.url : '',
    match: meeting ? {
      provider: meeting.provider,
      key: meeting.key,
      source: meeting.source,
      title: meeting.title,
    } : null,
    candidate: candidate && candidate.meeting ? {
      key: candidate.meeting.key,
      ageMs: Math.max(0, now - candidate.firstSeenAt),
    } : null,
    visible: !!(promptSnapshot && promptSnapshot.visible),
    visibleKey: promptSnapshot && promptSnapshot.meeting ? promptSnapshot.meeting.key : '',
  };
  const signature = JSON.stringify(summary);
  if (signature === lastMeetingPromptDebugSignature) {
    return;
  }
  lastMeetingPromptDebugSignature = signature;
  console.log('[meeting-prompt:debug] poll', summary);
}

function isMeetingPromptBrowserApp(appName = '') {
  return MEETING_PROMPT_BROWSER_APPS.includes(appName);
}

function runBrowserTabSnapshot(appName = '', fallbackTitle = '') {
  if (!isMeetingPromptBrowserApp(appName)) {
    return Promise.resolve({ title: fallbackTitle, url: '' });
  }

  const safeAppName = escapeAppleScriptString(appName);
  const safeSeparator = escapeAppleScriptString(MEETING_PROMPT_FIELD_SEPARATOR);
  const script = appName === 'Safari' || appName === 'Safari Technology Preview'
    ? `
set tabTitle to ""
set tabUrl to ""
tell application "${safeAppName}"
  if (count of documents) > 0 then
    set tabTitle to name of front document
    set tabUrl to URL of front document
  end if
end tell
return tabTitle & "${safeSeparator}" & tabUrl
`
    : `
set tabTitle to ""
set tabUrl to ""
tell application "${safeAppName}"
  if (count of windows) > 0 then
    set tabTitle to title of active tab of front window
    set tabUrl to URL of active tab of front window
  end if
end tell
return tabTitle & "${safeSeparator}" & tabUrl
`;

  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], {
      timeout: MEETING_PROMPT_APPLESCRIPT_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout = '', stderr = '') => {
      if (error) {
        const message = String(stderr || error.message || 'unknown error').trim();
        const shouldLogDebug = warnMeetingPromptBrowserPermission(appName, message);
        if (shouldLogDebug) {
          meetingPromptDebug('browser-url-unavailable', {
            appName,
            title: fallbackTitle,
            error: message,
          });
        }
        resolve({
          title: fallbackTitle,
          url: '',
          error: message,
          automationDenied: isMeetingPromptAutomationDeniedMessage(message),
        });
        return;
      }
      const parts = String(stdout || '').trim().split(MEETING_PROMPT_FIELD_SEPARATOR);
      resolve({
        title: parts[0] || fallbackTitle || '',
        url: parts[1] || '',
        error: '',
        automationDenied: false,
      });
    });
  });
}

function runMeetingPromptAppleScript() {
  return new Promise((resolve, reject) => {
    execFile('lsappinfo', ['front'], {
      timeout: MEETING_PROMPT_APPLESCRIPT_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout = '', stderr = '') => {
      if (error) {
        const message = stderr || error.message || 'lsappinfo front failed';
        reject(new Error(message.trim()));
        return;
      }
      const asn = String(stdout || '').trim();
      if (!asn) {
        reject(new Error('lsappinfo front returned empty ASN'));
        return;
      }
      execFile('lsappinfo', ['info', '-only', 'name', asn], {
        timeout: MEETING_PROMPT_APPLESCRIPT_TIMEOUT_MS,
        windowsHide: true,
      }, async (error2, stdout2 = '', stderr2 = '') => {
        if (error2) {
          const message = stderr2 || error2.message || 'lsappinfo info failed';
          reject(new Error(message.trim()));
          return;
        }
        const appName = String(stdout2 || '').trim().replace(/^"|"$/g, '');
        const windowTitle = await getWindowTitleForApp(appName);
        const browserSnapshot = await runBrowserTabSnapshot(appName, windowTitle);
        resolve({
          appName,
          title: browserSnapshot.title || windowTitle,
          url: browserSnapshot.url || '',
        });
      });
    });
  });
}

function getWindowTitleForApp(appName) {
  if (!appName) return Promise.resolve('');
  const safeAppName = escapeAppleScriptString(appName);
  const script = `tell application "${safeAppName}" to try
  return name of front window
on error
  return ""
end try`;
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], {
      timeout: MEETING_PROMPT_APPLESCRIPT_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout = '') => {
      if (error) {
        resolve('');
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

async function requestMeetingPromptPermissions() {
  if (process.platform !== 'darwin') {
    return {
      status: 'unsupported-platform',
      canEnable: false,
      platform: process.platform,
      message: 'Meeting prompt detection is currently available on macOS only.',
    };
  }

  meetingPromptDetectionDisabled = false;

  const result = {
    status: 'success',
    canEnable: true,
    platform: process.platform,
    foreground: {
      status: 'unknown',
      appName: '',
      title: '',
      message: '',
    },
    browsers: [],
    message: '',
  };

  try {
    const foregroundSnapshot = await runMeetingPromptAppleScript();
    result.foreground = {
      status: 'granted',
      appName: foregroundSnapshot.appName || '',
      title: foregroundSnapshot.title || '',
      message: '',
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error || 'unknown error');
    result.foreground = {
      status: 'denied',
      appName: '',
      title: '',
      message,
    };
    result.status = 'blocked';
    result.canEnable = false;
    result.message = 'macOS blocked foreground-window access. Enable Accessibility/Automation permission for Escribolt or Electron, then try again.';
    return result;
  }

  const foregroundBrowserApp = isMeetingPromptBrowserApp(result.foreground.appName)
    ? result.foreground.appName
    : '';

  if (foregroundBrowserApp) {
    const browserSnapshot = await runBrowserTabSnapshot(foregroundBrowserApp, result.foreground.title || '');
    result.browsers.push({
      appName: foregroundBrowserApp,
      status: browserSnapshot && browserSnapshot.error ? 'denied' : 'granted',
      title: browserSnapshot && browserSnapshot.title ? browserSnapshot.title : '',
      url: browserSnapshot && browserSnapshot.url ? browserSnapshot.url : '',
      message: browserSnapshot && browserSnapshot.error ? browserSnapshot.error : '',
      automationDenied: !!(browserSnapshot && browserSnapshot.automationDenied),
    });

    if (browserSnapshot && browserSnapshot.error) {
      result.status = 'needs-browser-approval';
      result.canEnable = false;
      result.message = `macOS blocked browser tab access for ${foregroundBrowserApp}. Enable Automation permission for Escribolt or Electron to control ${foregroundBrowserApp}, then try again.`;
    }
  } else {
    result.status = 'success';
    result.canEnable = true;
    result.message = 'Meeting prompt detection is enabled. macOS may ask for browser Automation permission the first time a supported meeting tab is foreground.';
  }

  return result;
}

async function openMeetingPromptPermissionSettings() {
  if (process.platform !== 'darwin') {
    return { status: 'unsupported-platform', platform: process.platform };
  }

  const urls = [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    'x-apple.systempreferences:com.apple.preference.security',
  ];

  for (const url of urls) {
    try {
      await shell.openExternal(url);
      return { status: 'success', url, platform: process.platform };
    } catch (_error) {
      // Try the next settings URL; macOS pane identifiers differ across releases.
    }
  }

  return {
    status: 'error',
    platform: process.platform,
    message: 'Unable to open macOS Privacy & Security settings.',
  };
}

function handleMeetingPromptDetectionError(error) {
  const message = error && error.message ? error.message : String(error || 'unknown error');
  const lowered = message.toLowerCase();
  if (
    lowered.includes('not authorized')
    || lowered.includes('not allowed assistive access')
    || lowered.includes('not permitted')
    || lowered.includes('automation')
    || lowered.includes('accessibility')
    || lowered.includes('application can\'t be found')
    || lowered.includes('-10827')
  ) {
    meetingPromptDetectionDisabled = true;
    console.warn('[meeting-prompt] disabled because macOS permissions are unavailable:', message);
    stopMeetingPromptWatcher({ hidePrompt: true });
    return;
  }
  console.warn('[meeting-prompt] detection poll failed:', message);
}

function scheduleMeetingPromptPoll(delayMs = MEETING_PROMPT_POLL_MS) {
  if (!isMeetingPromptSettingEnabled()) {
    return;
  }
  if (meetingPromptPollTimer) {
    clearTimeout(meetingPromptPollTimer);
  }
  meetingPromptPollTimer = setTimeout(() => {
    meetingPromptPollTimer = null;
    pollMeetingPromptWatcher();
  }, delayMs);
  if (meetingPromptPollTimer && typeof meetingPromptPollTimer.unref === 'function') {
    meetingPromptPollTimer.unref();
  }
}

async function pollMeetingPromptWatcher() {
  if (!isMeetingPromptSettingEnabled()) {
    stopMeetingPromptWatcher({ hidePrompt: true });
    return;
  }
  if (meetingPromptPollInFlight) {
    scheduleMeetingPromptPoll();
    return;
  }

  meetingPromptPollInFlight = true;
  try {
    let snapshot = null;
    let meeting = null;
    const busy = isMeetingPromptBusy();
    if (!busy) {
      snapshot = await runMeetingPromptAppleScript();
      meeting = detectMeetingFromSnapshot(snapshot);
    }
    const promptSnapshot = meetingPromptState.update({
      meeting,
      nowMs: Date.now(),
      enabled: isMeetingPromptSettingEnabled(),
      busy: isMeetingPromptBusy(),
    });
    logMeetingPromptPollDebug({
      snapshot,
      meeting,
      promptSnapshot,
      busy,
      enabled: isMeetingPromptSettingEnabled(),
      disabled: meetingPromptDetectionDisabled,
    });
    applyMeetingPromptSnapshot(promptSnapshot);
  } catch (error) {
    handleMeetingPromptDetectionError(error);
  } finally {
    meetingPromptPollInFlight = false;
    scheduleMeetingPromptPoll();
  }
}

function startMeetingPromptWatcher() {
  if (!isMeetingPromptSettingEnabled()) {
    meetingPromptDebug('watcher-not-started', {
      platform: process.platform,
      enabled: isMeetingPromptSettingEnabled(),
      disabled: meetingPromptDetectionDisabled,
    });
    return;
  }
  meetingPromptDebug('watcher-started');
  scheduleMeetingPromptPoll(250);
}

function stopMeetingPromptWatcher({ hidePrompt = false } = {}) {
  meetingPromptDebug('watcher-stopped', { hidePrompt });
  if (meetingPromptPollTimer) {
    clearTimeout(meetingPromptPollTimer);
    meetingPromptPollTimer = null;
  }
  meetingPromptPollInFlight = false;
  if (hidePrompt) {
    meetingPromptState.hide();
    setMeetingPromptVisible(null);
  }
}

function applyMeetingPromptWatcherState() {
  if (isMeetingPromptSettingEnabled()) {
    startMeetingPromptWatcher();
    return;
  }
  stopMeetingPromptWatcher({ hidePrompt: true });
}

function dismissMeetingPrompt(key = '') {
  const resolvedKey = key || (activeMeetingPrompt && activeMeetingPrompt.key) || '';
  const snapshot = meetingPromptState.dismiss(resolvedKey);
  applyMeetingPromptSnapshot(snapshot);
}

function startRecordingFromMeetingPrompt(key = '') {
  const prompt = activeMeetingPrompt;
  const resolvedKey = key || (prompt && prompt.key) || '';
  if (resolvedKey) {
    meetingPromptState.suppress(resolvedKey);
  }
  setMeetingPromptVisible(null);
  startRecordModeFromTray();
}

// --- Backend API helpers ---
function isBackendConnectionError(error) {
  return !!(error && BACKEND_CONNECTION_ERROR_CODES.has(error.code));
}

function requestBackendPostRaw(urlPath, body) {
  const bodyStr = JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: BACKEND_HOST,
      port: backendPort,
      path: urlPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function postToBackendRawWithRecovery(urlPath, body, options = {}) {
  const shouldEnsureReady = options.ensureReady !== false;
  if (shouldEnsureReady) {
    await ensureBackendReady({ timeoutMs: options.readyTimeoutMs || BACKEND_READY_TIMEOUT_MS });
  }

  try {
    return await requestBackendPostRaw(urlPath, body);
  } catch (error) {
    if (isBackendConnectionError(error) && options.restartOnConnectionError !== false) {
      console.warn(`Backend ${urlPath} ${error.code}; restarting local backend and retrying once...`);
      await ensureBackendReady({
        restart: app.isPackaged,
        timeoutMs: BACKEND_RESTART_READY_TIMEOUT_MS,
      });
      return await requestBackendPostRaw(urlPath, body);
    }
    throw error;
  }
}

function postToBackend(urlPath, body, callback, options = {}) {
  postToBackendRawWithRecovery(urlPath, body, options)
    .then((raw) => {
      if (callback) callback(null, raw);
    })
    .catch((error) => {
      console.error(`Backend ${urlPath} error:`, error.message);
      if (callback) callback(error);
    });
}

function postToBackendAsync(urlPath, body = {}) {
  return new Promise((resolve, reject) => {
    postToBackend(urlPath, body, (error, raw) => {
      if (error) {
        reject(error);
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(raw || '{}');
      } catch (e) {
        reject(new Error(`Invalid backend JSON for ${urlPath}`));
        return;
      }
      resolve(parsed);
    });
  });
}

function waitMs(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function createOperationTimeoutError(label, timeoutMs) {
  const seconds = Math.max(1, Math.round(Number(timeoutMs || 0) / 1000));
  const error = new Error(`${label || 'Operation'} timed out after ${seconds}s`);
  error.code = 'DICTATION_OPERATION_TIMEOUT';
  return error;
}

function runWithTimeout(task, { timeoutMs, label }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createOperationTimeoutError(label, timeoutMs));
    }, timeoutMs);

    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

let localSttRuntimeStatus = {
  status: 'unknown',
  available: false,
  warming: false,
  message: 'Local speech runtime status is unknown.',
  engine: 'mlx-audio-plus',
  model: null,
  warmupRan: false,
  runtimeImported: false,
  modelLoaded: false,
};
let localSttStatusPollTimer = null;

function normalizeLocalSttRuntimeStatus(raw = {}) {
  const status = typeof raw.status === 'string' && raw.status.trim()
    ? raw.status.trim()
    : 'unknown';
  const warming = raw.warming === true || status === 'warming';
  const available = raw.available === true || status === 'ready';
  return {
    status,
    available,
    warming,
    message: typeof raw.message === 'string' && raw.message.trim()
      ? raw.message.trim()
      : (warming ? LOCAL_STT_PREPARING_MESSAGE : 'Local speech runtime status is unknown.'),
    engine: typeof raw.engine === 'string' && raw.engine.trim()
      ? raw.engine.trim()
      : 'mlx-audio-plus',
    model: typeof raw.model === 'string' ? raw.model : null,
    stage: typeof raw.stage === 'string' ? raw.stage : null,
    warmupRan: raw.warmupRan === true || raw.warmup_ran === true,
    runtimeImported: raw.runtimeImported === true,
    modelLoaded: raw.modelLoaded === true,
    startedAt: raw.startedAt || null,
    completedAt: raw.completedAt || null,
    durationMs: Number.isFinite(Number(raw.durationMs)) ? Number(raw.durationMs) : null,
  };
}

function updateLocalSttRuntimeStatus(raw = {}) {
  localSttRuntimeStatus = normalizeLocalSttRuntimeStatus(raw);
  emitLocalSttRuntimeStatus();
  if (localSttRuntimeStatus.warming) {
    scheduleLocalSttStatusPoll(localSttRuntimeStatus.stage === 'starting' ? 1000 : LOCAL_STT_STATUS_POLL_MS);
  }
  return localSttRuntimeStatus;
}

function isCurrentSttRouteLocal() {
  try {
    const plan = getSttRoutingPreview({
      intent: 'transcription',
      preferBatch: true,
    });
    return !!(plan && plan.route && (plan.route.mode === 'local' || plan.route.provider === 'local'));
  } catch (_error) {
    return settings && settings.mode === 'local';
  }
}

function getLocalSttUnavailableMessage(status = localSttRuntimeStatus) {
  if (status && status.warming) {
    return status.message || LOCAL_STT_PREPARING_MESSAGE;
  }
  if (status && status.status === 'error' && status.message) {
    return status.message;
  }
  if (status && status.message) {
    return status.message;
  }
  return 'Local speech is not ready yet. Keep Escribolt open while it finishes preparing.';
}

function shouldStartLocalSttWarmupForStatus(status = localSttRuntimeStatus) {
  return isCurrentSttRouteLocal()
    && status.available !== true
    && status.warming !== true
    && status.status !== 'ready'
    && status.status !== 'error';
}

function getLocalSpeechRuntimePayload(status = localSttRuntimeStatus) {
  return {
    isLocalRoute: isCurrentSttRouteLocal(),
    status: status.status,
    available: status.available === true,
    warming: status.warming === true,
    message: status.available === true
      ? (status.message || 'Local speech is ready.')
      : getLocalSttUnavailableMessage(status),
    stage: status.stage || null,
    model: status.model || null,
    durationMs: Number.isFinite(Number(status.durationMs)) ? Number(status.durationMs) : null,
  };
}

function emitLocalSttRuntimeStatus() {
  const payload = {
    localStt: localSttRuntimeStatus,
    localSpeech: getLocalSpeechRuntimePayload(localSttRuntimeStatus),
  };
  [dashboardWindow, mainWindow].forEach((win) => {
    if (!win || win.isDestroyed()) {
      return;
    }
    try {
      win.webContents.send('runtime:local-stt-status-changed', payload);
    } catch (_error) {
      // Renderer windows may close while the background warm-up reports progress.
    }
  });
}

async function refreshLocalSttRuntimeStatus({ startWarmup = false, background = true, warmIfIdle = false } = {}) {
  const result = startWarmup
    ? await postToBackendAsync('/runtime/local-stt/warm', { background })
    : await postToBackendAsync('/runtime/local-stt/status', {});
  let status = updateLocalSttRuntimeStatus(result && result.localStt ? result.localStt : result);
  if (warmIfIdle && shouldStartLocalSttWarmupForStatus(status)) {
    const warmResult = await postToBackendAsync('/runtime/local-stt/warm', { background: true });
    status = updateLocalSttRuntimeStatus(warmResult && warmResult.localStt ? warmResult.localStt : warmResult);
  }
  return status;
}

function scheduleLocalSttStatusPoll(delayMs = LOCAL_STT_STATUS_POLL_MS) {
  if (localSttStatusPollTimer) {
    return;
  }
  localSttStatusPollTimer = setTimeout(() => {
    localSttStatusPollTimer = null;
    refreshLocalSttRuntimeStatus()
      .then((status) => {
        if (status && status.warming) {
          scheduleLocalSttStatusPoll();
        } else if (status && status.status === 'ready') {
          console.log('[runtime-local-stt] status=ready');
        } else if (status && status.status === 'error') {
          console.warn('[runtime-local-stt] status=error:', status.message);
        }
      })
      .catch((error) => {
        console.warn('[runtime-local-stt] status poll failed:', error.message);
      });
  }, delayMs);
}

function warmLocalSttRuntimeIfNeeded(reason = 'startup') {
  if (!isCurrentSttRouteLocal()) {
    return null;
  }
  console.log(`[runtime-local-stt] warmup requested (${reason})`);
  return refreshLocalSttRuntimeStatus({ startWarmup: true, background: true })
    .then((status) => {
      const suffix = status && status.message ? ` message=${status.message}` : '';
      console.log(`[runtime-local-stt] status=${status ? status.status : 'unknown'}${suffix}`);
      return status;
    })
    .catch((error) => {
      console.warn('[runtime-local-stt] warmup request failed:', error.message);
      return null;
    });
}

async function bootstrapBackendRuntimeAssets() {
  const maxAttempts = 8;
  let delayMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const shouldWarmLocalStt = isCurrentSttRouteLocal();
      const result = await postToBackendAsync('/runtime/bootstrap', {
        download_missing_assets: true,
        warm_tts: false,
        warm_local_stt: shouldWarmLocalStt,
        warm_local_stt_background: true,
      });
      const status = result && typeof result.status === 'string' ? result.status : 'unknown';
      const downloaded = Number(result && result.downloadedCount ? result.downloadedCount : 0);
      const missing = Number(result && result.missingCount ? result.missingCount : 0);
      const localStt = updateLocalSttRuntimeStatus(result && result.localStt ? result.localStt : {});
      console.log(`[runtime-bootstrap] status=${status} downloaded=${downloaded} missing=${missing} localStt=${localStt.status}`);
      return result;
    } catch (error) {
      if (attempt === maxAttempts) {
        console.warn('[runtime-bootstrap] backend bootstrap unavailable after retries:', error.message);
        return null;
      }
      await waitMs(delayMs);
      delayMs = Math.min(delayMs * 2, 8000);
    }
  }
  return null;
}

function findFreePort(startingPort = 8000) {
  return new Promise((resolve) => {
    const server = require('net').createServer();
    server.unref();
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findFreePort(startingPort + 1));
      } else {
        resolve(startingPort);
      }
    });
    server.listen(startingPort, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr ? addr.port : startingPort;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

let pyBackendProcess = null;
let backendReadyPromise = null;

function buildPythonBackendEnv() {
  const env = {
    ...process.env,
    PORT: String(backendPort),
  };

  if (ffmpegBinaryPath) {
    const ffmpegDir = path.dirname(ffmpegBinaryPath);
    const existingPath = typeof env.PATH === 'string' && env.PATH.trim()
      ? env.PATH
      : '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    env.PATH = `${ffmpegDir}${path.delimiter}${existingPath}`;
    env.FFMPEG_BINARY = ffmpegBinaryPath;
    env.FFMPEG_PATH = ffmpegBinaryPath;
    env.IMAGEIO_FFMPEG_EXE = ffmpegBinaryPath;
  }

  return env;
}

function requestBackendHealth() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: BACKEND_HOST,
      port: backendPort,
      path: BACKEND_HEALTH_PATH,
      method: 'GET',
      timeout: 1500,
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
          reject(new Error(`Backend health returned HTTP ${res.statusCode || 0}`));
          return;
        }
        try {
          resolve(JSON.parse(raw || '{}'));
        } catch (_error) {
          resolve({ status: 'ok' });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('Backend health check timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForBackendHealth(timeoutMs = BACKEND_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await requestBackendHealth();
      if (health && (health.ok === true || health.status === 'ok')) {
        return health;
      }
      lastError = new Error('Backend health response was not ok');
    } catch (error) {
      lastError = error;
    }
    await waitMs(BACKEND_READY_POLL_MS);
  }

  const suffix = lastError && lastError.message ? `: ${lastError.message}` : '';
  throw new Error(`Local backend did not become ready on ${BACKEND_HOST}:${backendPort}${suffix}`);
}

async function ensureBackendReady({ restart = false, timeoutMs = BACKEND_READY_TIMEOUT_MS } = {}) {
  if (backendReadyPromise && !restart) {
    return backendReadyPromise;
  }

  const promise = (async () => {
    if (restart && app.isPackaged) {
      stopPythonBackend();
      await waitMs(250);
    }
    if (app.isPackaged && !pyBackendProcess) {
      startPythonBackend();
    }
    return waitForBackendHealth(timeoutMs);
  })();

  backendReadyPromise = promise;
  try {
    return await promise;
  } finally {
    if (backendReadyPromise === promise) {
      backendReadyPromise = null;
    }
  }
}

function startPythonBackend() {
  if (!app.isPackaged) {
    console.log('[backend] Running in dev mode; assuming local python server is started externally.');
    return null;
  }

  if (pyBackendProcess && !pyBackendProcess.killed) {
    return pyBackendProcess;
  }

  const binaryPath = path.join(process.resourcesPath, 'escribolt-backend', 'escribolt-backend');
  const cwd = path.join(process.resourcesPath, 'escribolt-backend');

  console.log(`[backend] Spawning local Python backend: ${binaryPath} on port ${backendPort}`);

  try {
    const env = buildPythonBackendEnv();
    const child = spawn(binaryPath, [`--port=${backendPort}`], {
      cwd,
      stdio: 'pipe',
      detached: true,
      env,
    });
    pyBackendProcess = child;

    child.stdout.on('data', (data) => {
      console.log(`[backend][stdout] ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      console.warn(`[backend][stderr] ${data.toString().trim()}`);
    });

    child.on('close', (code) => {
      console.log(`[backend] process exited with code ${code}`);
      if (pyBackendProcess === child) {
        pyBackendProcess = null;
      }
    });

    child.on('error', (err) => {
      console.error('[backend] Failed to start python backend:', err.message);
    });

    return child;
  } catch (error) {
    console.error('[backend] Exception when starting python backend:', error.message);
    return null;
  }
}

function stopPythonBackend() {
  if (pyBackendProcess) {
    console.log(`[backend] Stopping Python backend process (PID ${pyBackendProcess.pid})...`);
    try {
      process.kill(-pyBackendProcess.pid, 'SIGTERM');
    } catch (error) {
      console.warn('[backend] Failed to SIGTERM process group:', error.message);
      try {
        pyBackendProcess.kill('SIGTERM');
      } catch (_e) {}
    }
    pyBackendProcess = null;
  }
}

// Helper specific for startup sync (fire and forget)
function postToBackendVoid(urlPath, body) {
  postToBackend(urlPath, body, null);
}

async function pasteDictationTranscript(text, { remember = true } = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    return {
      status: 'error',
      message: 'Transcription is empty.',
    };
  }
  if (remember) {
    lastDictationTranscript = cleanText;
  }
  return postToBackendAsync('/paste_text', { text: cleanText });
}

function reportDictationPasteFailure(pasteResult, context = 'dictation') {
  if (!pasteResult || pasteResult.status === 'success') {
    return;
  }
  const logPrefix = String(context || '').startsWith('[')
    ? String(context)
    : `[${context || 'dictation'}]`;
  console.warn(`${logPrefix} Paste endpoint returned non-success:`, pasteResult.message || 'unknown error');
  showMainWidgetErrorBanner(
    (pasteResult && pasteResult.message) || 'Transcribed, but paste failed. Use Paste Last Transcription.',
    { dismissPill: false },
  );
}

function pasteLastDictationTranscript() {
  if (!lastDictationTranscript) {
    showMainWidgetErrorBanner('No saved transcription is available yet.', { dismissPill: false });
    return;
  }
  pasteDictationTranscript(lastDictationTranscript, { remember: false }).then((result) => {
    if (!result || result.status !== 'success') {
      showMainWidgetErrorBanner(
        (result && result.message) || 'The saved transcription could not be pasted.',
        { dismissPill: false },
      );
    }
  }).catch((error) => {
    console.warn('[dictation] Failed to paste saved transcription:', error.message);
    showMainWidgetErrorBanner('The saved transcription could not be pasted.', { dismissPill: false });
  });
}

let dictationCaptureRequestQueue = Promise.resolve();

function enqueueDictationCaptureRequest(urlPath, { throwOnError = false } = {}) {
  dictationCaptureRequestQueue = dictationCaptureRequestQueue
    .catch(() => undefined)
    .then(() => postToBackendAsync(urlPath, {}))
    .then((result) => {
      if (result && result.status === 'error') {
        const message = result.message || 'unknown error';
        console.warn(`[dictation][capture] ${urlPath} failed: ${message}`);
        if (throwOnError) {
          throw new Error(message);
        }
      }
      return result;
    })
    .catch((error) => {
      console.warn(`[dictation][capture] ${urlPath} unavailable: ${error.message}`);
      if (throwOnError) {
        throw error;
      }
    });
  return dictationCaptureRequestQueue;
}

function armDictationCapture() {
  return enqueueDictationCaptureRequest('/arm_recording', { throwOnError: true });
}

function disarmDictationCapture() {
  return enqueueDictationCaptureRequest('/disarm_recording');
}

function syncSettingsToBackend() {
  const model = MODELS.find(m => m.id === selectedModel);
  if (model) {
    postToBackendVoid('/set_model', { model_path: model.path });
  }
}

function getUiSettings() {
  const byokMeta = listByokKeyStatus();
  return {
    mode: settings.mode,
    theme: settings.theme,
    onboardingCompleted: settings.onboardingCompleted,
    productTourVersionSeen: Number.isFinite(Number(settings.productTourVersionSeen))
      ? Math.max(0, Math.floor(Number(settings.productTourVersionSeen)))
      : DEFAULT_SETTINGS.productTourVersionSeen,
    launchAtLogin: settings.launchAtLogin,
    quickNotePopupEnabled: settings.quickNotePopupEnabled !== false,
    meetingPromptEnabled: settings.meetingPromptEnabled === true && settings.meetingPromptConsentGranted === true,
    stickyNoteDefaultPlacement: STICKY_NOTE_DEFAULT_PLACEMENT_SET.has(settings.stickyNoteDefaultPlacement)
      ? settings.stickyNoteDefaultPlacement
      : DEFAULT_SETTINGS.stickyNoteDefaultPlacement,
    stickyNoteDefaultColorId: STICKY_NOTE_COLOR_ID_SET.has(settings.stickyNoteDefaultColorId)
      ? settings.stickyNoteDefaultColorId
      : DEFAULT_SETTINGS.stickyNoteDefaultColorId,
    model: settings.model,
    aiEngine: {
      ...(settings.aiEngine || {}),
      apiKeys: byokMeta,
    },
    recordingCaptureMode: settings.recordingCaptureMode,
    recordingSummaryLanguage: normalizeRecordingSummaryLanguageCode(settings.recordingSummaryLanguage),
    processingModes: normalizeProcessingModes(settings.processingModes, 'local'),
    layout: settings.layout || DEFAULT_SETTINGS.layout,
    syncSettings: settings.syncSettings,
    shortcuts: normalizeShortcutSettings(settings.shortcuts),
  };
}

function isStrictPrivacyModeEnabled() {
  return !!(settings && settings.syncSettings && settings.syncSettings.strictPrivacyMode);
}

function getSttRoutingPreview(options = {}) {
  return sttRouter.createSessionPlan(options);
}

function getLlmRoutingPreview(options = {}) {
  return llmRouter.createSessionPlan(options);
}



function getNativeMacLoopbackHelperCandidates() {
  const candidates = [];
  if (NATIVE_MAC_LOOPBACK_HELPER_PATH) {
    candidates.push(path.resolve(NATIVE_MAC_LOOPBACK_HELPER_PATH));
  }

  const devCandidate = path.resolve(__dirname, '..', 'native', 'macos-loopback-helper', 'bin', 'macos-loopback-helper');
  candidates.push(devCandidate);

  if (process.resourcesPath) {
    const packagedCandidate = path.resolve(process.resourcesPath, 'native', 'macos-loopback-helper', 'bin', 'macos-loopback-helper');
    candidates.push(packagedCandidate);
  }

  return Array.from(new Set(candidates));
}

function resolveNativeMacLoopbackHelperPath() {
  const candidates = getNativeMacLoopbackHelperCandidates();
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_error) {
      // Ignore fs errors and keep checking candidates.
    }
  }
  return '';
}

function getNativeMacFnKeyHelperCandidates() {
  const candidates = [];
  if (NATIVE_MAC_FN_KEY_HELPER_PATH) {
    candidates.push(path.resolve(NATIVE_MAC_FN_KEY_HELPER_PATH));
  }
  const devCandidate = path.resolve(__dirname, '..', 'native', 'macos-fn-key-helper', 'bin', 'macos-fn-key-helper');
  candidates.push(devCandidate);
  if (process.resourcesPath) {
    const packagedCandidate = path.resolve(process.resourcesPath, 'native', 'macos-fn-key-helper', 'bin', 'macos-fn-key-helper');
    candidates.push(packagedCandidate);
  }
  return Array.from(new Set(candidates));
}

function resolveNativeMacFnKeyHelperPath() {
  const candidates = getNativeMacFnKeyHelperCandidates();
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_error) {
      // Ignore fs races and continue.
    }
  }
  return '';
}

function runNativeFnKeyHelperPermissionCommand(args = []) {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve({ status: 'granted', granted: true, canRequest: false, platform: process.platform });
      return;
    }

    const helperPath = resolveNativeMacFnKeyHelperPath();
    if (!helperPath) {
      resolve({
        status: 'unknown',
        granted: false,
        canRequest: false,
        platform: process.platform,
        message: 'Native Fn key helper binary not found. Build it with npm run build:mac-fn-key-helper.',
      });
      return;
    }

    let stdoutText = '';
    let stderrText = '';
    let settled = false;
    const child = spawn(helperPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(payload);
    };

    const timeout = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch (_error) {}
      finish({
        status: 'unknown',
        granted: false,
        canRequest: true,
        platform: process.platform,
        message: 'Input Monitoring permission check timed out.',
      });
    }, 30000);

    child.stdout.on('data', (chunk) => {
      stdoutText += String(chunk || '');
    });

    child.stderr.on('data', (chunk) => {
      stderrText += String(chunk || '');
    });

    child.once('error', (error) => {
      finish({
        status: 'unknown',
        granted: false,
        canRequest: false,
        platform: process.platform,
        message: error && error.message ? error.message : 'Failed to launch Fn key helper.',
      });
    });

    child.once('exit', (code) => {
      const stdoutLines = stdoutText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      let status = code === 0 ? 'granted' : 'denied';
      for (const line of stdoutLines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && parsed.permission === 'input-monitoring' && typeof parsed.status === 'string') {
            status = parsed.status.trim().toLowerCase() || status;
            break;
          }
        } catch (_error) {
          // Ignore non-JSON helper output.
        }
      }
      const message = stderrText.trim();
      finish({
        status,
        granted: status === 'granted',
        canRequest: true,
        platform: process.platform,
        message,
      });
    });
  });
}

function runNativeFnKeyHelperAvailabilityProbe() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve({ status: 'granted', granted: true, canRequestInputMonitoring: false, platform: process.platform });
      return;
    }

    if (fnKeyHelperAvailable && fnKeyHelperProcess) {
      resolve({ status: 'granted', granted: true, canRequestInputMonitoring: true, platform: process.platform });
      return;
    }

    const helperPath = resolveNativeMacFnKeyHelperPath();
    if (!helperPath) {
      resolve({
        status: 'unknown',
        granted: false,
        canRequestInputMonitoring: false,
        platform: process.platform,
        message: 'Native Fn key helper binary not found. Build it with npm run build:mac-fn-key-helper.',
      });
      return;
    }

    let stdoutText = '';
    let stderrText = '';
    let settled = false;
    const child = spawn(helperPath, ['--probe-event-tap'], { stdio: ['ignore', 'pipe', 'pipe'] });

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(payload);
    };

    const timeout = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch (_error) {}
      finish({
        status: 'unknown',
        granted: false,
        canRequestInputMonitoring: true,
        platform: process.platform,
        message: 'Fn/Globe listener check timed out.',
      });
    }, 8000);

    child.stdout.on('data', (chunk) => {
      stdoutText += String(chunk || '');
    });

    child.stderr.on('data', (chunk) => {
      stderrText += String(chunk || '');
    });

    child.once('error', (error) => {
      finish({
        status: 'unknown',
        granted: false,
        canRequestInputMonitoring: false,
        platform: process.platform,
        message: error && error.message ? error.message : 'Failed to launch Fn key helper.',
      });
    });

    child.once('exit', (code) => {
      const stdoutLines = stdoutText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const stderrLines = stderrText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      let status = code === 0 ? 'granted' : 'denied';
      let parsedMessage = '';
      for (const line of stdoutLines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && parsed.permission === 'fn-listener' && typeof parsed.status === 'string') {
            status = parsed.status.trim().toLowerCase() || status;
            if (typeof parsed.message === 'string') {
              parsedMessage = parsed.message;
            }
            break;
          }
        } catch (_error) {
          // Ignore non-JSON helper output.
        }
      }
      for (const line of stderrLines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed.message === 'string') {
            parsedMessage = parsed.message;
            break;
          }
        } catch (_error) {
          if (!parsedMessage) {
            parsedMessage = line;
          }
        }
      }
      const message = parsedMessage || stderrText.trim();
      finish({
        status,
        granted: status === 'granted',
        canRequestInputMonitoring: true,
        platform: process.platform,
        message,
      });
    });
  });
}

function prettyAccelerator(accelerator = '') {
  return String(accelerator || '')
    .replace(/Command/g, 'Cmd')
    .replace(/Control/g, 'Ctrl')
    .replace(/Option/g, 'Opt');
}

function getPresetLabelById(options = [], id = '') {
  const found = options.find((entry) => entry.id === id);
  return found ? found.label : id;
}

function stopFnKeyHelper() {
  clearFnHoldTimer();
  fnShortcutState.isFnDown = false;
  fnShortcutState.fnDownStartedAtMs = 0;
  if (!fnKeyHelperProcess) {
    fnKeyHelperAvailable = false;
    return;
  }
  fnKeyHelperStopping = true;
  try {
    fnKeyHelperProcess.kill('SIGTERM');
  } catch (_error) {}
  fnKeyHelperProcess = null;
  fnKeyHelperAvailable = false;
}

function handleFnKeyHelperJsonLine(rawLine = '') {
  const trimmed = String(rawLine || '').trim();
  if (!trimmed) return;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_error) {
    return;
  }

  if (parsed.type === 'status') {
    if (parsed.status === 'ready') {
      fnKeyHelperAvailable = true;
      fnKeyHelperLastError = '';
    }
    if (parsed.status === 'error') {
      fnKeyHelperAvailable = false;
      fnKeyHelperLastError = typeof parsed.message === 'string'
        ? parsed.message
        : 'Unknown fn helper runtime error';
    }
    return;
  }

  if (parsed.type === 'event' && typeof parsed.event === 'string') {
    handleFnShortcutEvent(parsed.event, parsed);
  }
}

function startFnKeyHelper() {
  if (process.platform !== 'darwin') {
    fnKeyHelperAvailable = false;
    fnKeyHelperLastError = 'Fn/Globe global listening is only supported on macOS.';
    return { ok: false, reason: fnKeyHelperLastError };
  }
  if (fnKeyHelperDisabledForSession) {
    try {
      const isTrusted = systemPreferences.isTrustedAccessibilityClient(false);
      if (isTrusted) {
        fnKeyHelperDisabledForSession = false;
      }
    } catch (_e) {}
    if (fnKeyHelperDisabledForSession) {
      fnKeyHelperAvailable = false;
      fnKeyHelperLastError = fnKeyHelperLastError || 'Fn key helper was disabled for this session after an unexpected exit.';
      return { ok: false, reason: fnKeyHelperLastError };
    }
  }

  const helperPath = resolveNativeMacFnKeyHelperPath();
  if (!helperPath) {
    fnKeyHelperAvailable = false;
    fnKeyHelperLastError = 'Native Fn key helper binary not found. Build it with npm run build:mac-fn-key-helper.';
    return { ok: false, reason: fnKeyHelperLastError };
  }

  stopFnKeyHelper();

  try {
    const child = spawn(helperPath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    fnKeyHelperProcess = child;
    fnKeyHelperAvailable = true;
    fnKeyHelperLastError = '';
    fnKeyHelperStopping = false;
    fnKeyHelperDisabledForSession = false;

    let stdoutBuffer = '';
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      lines.forEach((line) => handleFnKeyHelperJsonLine(line));
    });

    let stderrBuffer = '';
    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';
      lines.forEach((line) => {
        const clean = line.trim();
        if (clean) {
          fnKeyHelperLastError = clean;
          console.warn(`[fn-key-helper] ${clean}`);
        }
      });
    });

    child.on('exit', (_code, _signal) => {
      if (fnKeyHelperProcess !== child) {
        return;
      }
      fnKeyHelperProcess = null;
      fnKeyHelperAvailable = false;
      if (fnKeyHelperStopping) {
        fnKeyHelperStopping = false;
        return;
      }
      fnKeyHelperDisabledForSession = true;
      if (!fnKeyHelperLastError) {
        fnKeyHelperLastError = 'Fn key helper exited unexpectedly.';
      }
      if (settings && settings.shortcuts) {
        const normalizedShortcuts = normalizeShortcutSettings(settings.shortcuts);
        const fnNeeded = normalizedShortcuts.dictationHoldPreset === 'fn_hold'
          || normalizedShortcuts.dictationHandsFreePreset === 'fn_space_toggle'
          || normalizedShortcuts.quickNotePreset === 'fn_n_toggle'
          || normalizedShortcuts.recordModePreset === 'fn_r_toggle';
        if (!fnNeeded) {
          return;
        }
        registerVoiceShortcuts(settings.shortcuts);
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
          dashboardWindow.webContents.send('ui-settings-updated', getUiSettings());
        }
      }
    });

    child.on('error', (error) => {
      if (fnKeyHelperProcess !== child) {
        return;
      }
      fnKeyHelperProcess = null;
      fnKeyHelperAvailable = false;
      fnKeyHelperLastError = error && error.message ? error.message : 'Failed to start fn key helper process.';
    });

    return { ok: true, reason: '' };
  } catch (error) {
    fnKeyHelperProcess = null;
    fnKeyHelperAvailable = false;
    fnKeyHelperLastError = error && error.message ? error.message : 'Failed to start fn key helper process.';
    return { ok: false, reason: fnKeyHelperLastError };
  }
}

function registerVoiceShortcuts(rawShortcuts = {}) {
  const normalized = normalizeShortcutSettings(rawShortcuts);
  const warnings = [];
  const failures = [];
  const active = {
    dictationHold: {
      preset: normalized.dictationHoldPreset,
      display: '',
      mode: 'off',
    },
    dictationHandsFree: {
      preset: normalized.dictationHandsFreePreset,
      display: '',
      mode: 'accelerator',
      fallbackActive: false,
      accelerator: '',
    },
    quickNote: {
      preset: normalized.quickNotePreset,
      display: '',
      accelerator: '',
    },
    recordMode: {
      preset: normalized.recordModePreset,
      display: '',
      accelerator: '',
    },
    pasteLastTranscription: {
      display: prettyAccelerator(PASTE_LAST_TRANSCRIPTION_ACCELERATOR),
      accelerator: PASTE_LAST_TRANSCRIPTION_ACCELERATOR,
      registered: false,
    },
  };

  globalShortcut.unregisterAll();
  stopFnKeyHelper();
  resetFnShortcutState();

  active.pasteLastTranscription.registered = globalShortcut.register(
    PASTE_LAST_TRANSCRIPTION_ACCELERATOR,
    () => {
      pasteLastDictationTranscript();
    },
  );
  if (!active.pasteLastTranscription.registered) {
    warnings.push(`Paste last transcription shortcut ${prettyAccelerator(PASTE_LAST_TRANSCRIPTION_ACCELERATOR)} could not be registered.`);
  }

  const fnNeeded = normalized.dictationHoldPreset === 'fn_hold'
    || normalized.dictationHandsFreePreset === 'fn_space_toggle'
    || normalized.quickNotePreset === 'fn_n_toggle'
    || normalized.recordModePreset === 'fn_r_toggle';
  let fnHelperReady = false;
  if (fnNeeded) {
    const fnHelperResult = startFnKeyHelper();
    if (fnHelperResult.ok) {
      fnHelperReady = true;
    } else {
      warnings.push(`Fn/Globe listener unavailable (${fnHelperResult.reason}).`);
    }
  }

  if (normalized.dictationHoldPreset === 'fn_hold') {
    if (fnHelperReady) {
      active.dictationHold.mode = 'fn';
      active.dictationHold.display = getPresetLabelById(DICTATION_HOLD_SHORTCUT_PRESETS, normalized.dictationHoldPreset);
    } else {
      active.dictationHold.mode = 'unavailable';
      active.dictationHold.display = 'Unavailable';
    }
  } else {
    active.dictationHold.mode = 'off';
    active.dictationHold.display = getPresetLabelById(DICTATION_HOLD_SHORTCUT_PRESETS, normalized.dictationHoldPreset);
  }

  if (normalized.dictationHandsFreePreset === 'fn_space_toggle') {
    if (fnHelperReady) {
      active.dictationHandsFree.mode = 'fn';
      active.dictationHandsFree.display = getPresetLabelById(DICTATION_HANDS_FREE_SHORTCUT_PRESETS, normalized.dictationHandsFreePreset);
    } else {
      const fallbackAccelerator = DICTATION_HANDS_FREE_PRESET_TO_ACCELERATOR.ctrl_space_toggle;
      const fallbackRegistered = globalShortcut.register(fallbackAccelerator, () => {
        triggerVoiceAction({ mode: 'transcription' });
      });
      if (fallbackRegistered) {
        active.dictationHandsFree.mode = 'accelerator';
        active.dictationHandsFree.display = prettyAccelerator(fallbackAccelerator);
        active.dictationHandsFree.fallbackActive = true;
        active.dictationHandsFree.accelerator = fallbackAccelerator;
        warnings.push('Hands-free Fn+Space is unavailable without Fn listener. Using Control+Space fallback.');
      } else {
        failures.push('dictationHandsFreePreset');
        active.dictationHandsFree.display = 'Unavailable';
      }
    }
  } else {
    const dictationAccelerator = DICTATION_HANDS_FREE_PRESET_TO_ACCELERATOR[normalized.dictationHandsFreePreset];
    const registered = !!dictationAccelerator && globalShortcut.register(dictationAccelerator, () => {
      triggerVoiceAction({ mode: 'transcription' });
    });
    if (!registered) {
      failures.push('dictationHandsFreePreset');
      active.dictationHandsFree.display = 'Unavailable';
    } else {
      active.dictationHandsFree.display = prettyAccelerator(dictationAccelerator);
      active.dictationHandsFree.accelerator = dictationAccelerator;
    }
  }

  if (normalized.quickNotePreset === 'fn_n_toggle') {
    if (fnHelperReady) {
      active.quickNote.mode = 'fn';
      active.quickNote.display = getPresetLabelById(QUICK_NOTE_SHORTCUT_PRESETS, normalized.quickNotePreset);
    } else {
      const fallbackAccelerator = 'Command+Control+N';
      const fallbackRegistered = globalShortcut.register(fallbackAccelerator, () => {
        triggerVoiceAction({ mode: 'quick-note' });
      });
      if (fallbackRegistered) {
        active.quickNote.mode = 'accelerator';
        active.quickNote.display = prettyAccelerator(fallbackAccelerator);
        active.quickNote.fallbackActive = true;
        active.quickNote.accelerator = fallbackAccelerator;
        warnings.push('Quick Note Fn+N is unavailable without Fn listener. Using Command+Control+N fallback.');
      } else {
        failures.push('quickNotePreset');
        active.quickNote.display = 'Unavailable';
      }
    }
  } else {
    const quickNoteAccelerator = QUICK_NOTE_PRESET_TO_ACCELERATOR[normalized.quickNotePreset];
    const quickNoteRegistered = !!quickNoteAccelerator && globalShortcut.register(quickNoteAccelerator, () => {
      triggerVoiceAction({ mode: 'quick-note' });
    });
    if (!quickNoteRegistered) {
      failures.push('quickNotePreset');
      active.quickNote.display = 'Unavailable';
    } else {
      active.quickNote.display = prettyAccelerator(quickNoteAccelerator);
      active.quickNote.accelerator = quickNoteAccelerator;
    }
  }

  if (normalized.recordModePreset === 'fn_r_toggle') {
    if (fnHelperReady) {
      active.recordMode.mode = 'fn';
      active.recordMode.display = getPresetLabelById(RECORD_MODE_SHORTCUT_PRESETS, normalized.recordModePreset);
    } else {
      const fallbackAccelerator = 'Command+Control+R';
      const fallbackRegistered = globalShortcut.register(fallbackAccelerator, () => {
        startRecordModeFromTray();
      });
      if (fallbackRegistered) {
        active.recordMode.mode = 'accelerator';
        active.recordMode.display = prettyAccelerator(fallbackAccelerator);
        active.recordMode.fallbackActive = true;
        active.recordMode.accelerator = fallbackAccelerator;
        warnings.push('Record Mode Fn+R is unavailable without Fn listener. Using Command+Control+R fallback.');
      } else {
        failures.push('recordModePreset');
        active.recordMode.display = 'Unavailable';
      }
    }
  } else {
    const recordModeAccelerator = RECORD_MODE_PRESET_TO_ACCELERATOR[normalized.recordModePreset];
    const recordModeRegistered = !!recordModeAccelerator && globalShortcut.register(recordModeAccelerator, () => {
      startRecordModeFromTray();
    });
    if (!recordModeRegistered) {
      failures.push('recordModePreset');
      active.recordMode.display = 'Unavailable';
    } else {
      active.recordMode.display = prettyAccelerator(recordModeAccelerator);
      active.recordMode.accelerator = recordModeAccelerator;
    }
  }

  shortcutsRuntimeState.active = active;
  shortcutsRuntimeState.warnings = warnings;
  shortcutsRuntimeState.failures = failures.slice();

  if (!failures.length) {
    shortcutsLastWorking = { ...normalized };
  }

  if (tray && !tray.isDestroyed()) {
    buildTrayMenu();
    updateTrayTooltip();
  }

  return {
    normalized,
    warnings,
    failures,
    active,
  };
}

function applyVoiceShortcutsWithRollback({ persistRollback = false } = {}) {
  const desired = normalizeShortcutSettings(settings && settings.shortcuts ? settings.shortcuts : {});
  const fnNeeded = desired.dictationHoldPreset === 'fn_hold'
    || desired.dictationHandsFreePreset === 'fn_space_toggle'
    || desired.quickNotePreset === 'fn_n_toggle'
    || desired.recordModePreset === 'fn_r_toggle';
  if (!fnNeeded) {
    fnKeyHelperDisabledForSession = false;
  }
  settings.shortcuts = desired;
  const initialResult = registerVoiceShortcuts(desired);
  if (!initialResult.failures.length) {
    return {
      ...initialResult,
      rollbackApplied: false,
    };
  }

  const rollbackSettings = {
    ...desired,
  };
  initialResult.failures.forEach((key) => {
    rollbackSettings[key] = shortcutsLastWorking[key] || SHORTCUT_DEFAULTS[key];
  });
  settings.shortcuts = normalizeShortcutSettings(rollbackSettings);
  const rollbackResult = registerVoiceShortcuts(settings.shortcuts);
  if (persistRollback) {
    syncSettingsState();
  }

  const failureLabels = initialResult.failures.map((key) => {
    if (key === 'dictationHoldPreset') return 'Dictation hold-to-talk';
    if (key === 'dictationHandsFreePreset') return 'Dictation hands-free';
    if (key === 'quickNotePreset') return 'Quick Note';
    if (key === 'recordModePreset') return 'Record Mode';
    return key;
  });
  shortcutsRuntimeState.warnings = [
    ...shortcutsRuntimeState.warnings,
    `Some shortcuts could not be registered and were reverted: ${failureLabels.join(', ')}.`,
  ];

  return {
    ...rollbackResult,
    rollbackApplied: true,
    revertedKeys: initialResult.failures.slice(),
  };
}

function updateTrayTooltip() {
  if (!tray || tray.isDestroyed()) {
    return;
  }
  const dictationHoldLabel = shortcutsRuntimeState.active?.dictationHold?.display || 'Unavailable';
  const dictationHandsFreeLabel = shortcutsRuntimeState.active?.dictationHandsFree?.display || 'Unavailable';
  const quickNoteLabel = shortcutsRuntimeState.active?.quickNote?.display || 'Unavailable';
  const recordLabel = shortcutsRuntimeState.active?.recordMode?.display || 'Unavailable';
  tray.setToolTip(`Escribolt — Record: ${recordLabel}, Quick Notes: ${quickNoteLabel}, Dictation: Hold ${dictationHoldLabel}, Hands-free ${dictationHandsFreeLabel}`);
}

function getShortcutsRuntimePayload() {
  const shortcuts = normalizeShortcutSettings(settings && settings.shortcuts ? settings.shortcuts : {});
  const fnListenerEnabled = shortcuts.dictationHoldPreset === 'fn_hold'
    || shortcuts.dictationHandsFreePreset === 'fn_space_toggle'
    || shortcuts.quickNotePreset === 'fn_n_toggle'
    || shortcuts.recordModePreset === 'fn_r_toggle';
  const fnListenerSupported = process.platform === 'darwin';
  const fnListenerAvailable = fnListenerEnabled && fnKeyHelperAvailable;
  const fnListenerReason = !fnListenerEnabled
    ? 'Disabled for current preset.'
    : (fnListenerAvailable ? '' : (fnKeyHelperLastError || 'Unavailable.'));

  return {
    status: 'success',
    platform: process.platform,
    catalog: {
      dictationHold: DICTATION_HOLD_SHORTCUT_PRESETS,
      dictationHandsFree: DICTATION_HANDS_FREE_SHORTCUT_PRESETS,
      quickNote: QUICK_NOTE_SHORTCUT_PRESETS,
      recordMode: RECORD_MODE_SHORTCUT_PRESETS,
    },
    active: {
      dictationHold: {
        ...shortcutsRuntimeState.active.dictationHold,
      },
      dictationHandsFree: {
        ...shortcutsRuntimeState.active.dictationHandsFree,
      },
      quickNote: {
        ...shortcutsRuntimeState.active.quickNote,
      },
      recordMode: {
        ...shortcutsRuntimeState.active.recordMode,
      },
      pasteLastTranscription: {
        ...shortcutsRuntimeState.active.pasteLastTranscription,
      },
    },
    warnings: shortcutsRuntimeState.warnings.slice(),
    failures: shortcutsRuntimeState.failures.slice(),
    capability: {
      fnListenerSupported,
      fnListenerEnabled,
      fnListenerAvailable,
      fnListenerReason,
    },
    localSpeech: getLocalSpeechRuntimePayload(localSttRuntimeStatus),
  };
}

function getRecordModeRuntimeDiagnostics() {
  const electronVersion = process.versions.electron || 'unknown';
  const chromeVersion = process.versions.chrome || 'unknown';
  const electronMajor = Number.parseInt(String(electronVersion).split('.')[0], 10);
  const nativeMacLoopbackHelperPath = resolveNativeMacLoopbackHelperPath();
  const nativeMacLoopbackHelperAvailable = !!nativeMacLoopbackHelperPath;
  return {
    platform: process.platform,
    electronVersion,
    chromeVersion,
    electronMajor: Number.isFinite(electronMajor) ? electronMajor : null,
    featureFlags: LOOPBACK_FEATURE_FLAGS,
    experimentalElectronLoopbackEnabled: ENABLE_EXPERIMENTAL_ELECTRON_MAC_LOOPBACK,
    nativeMacLoopbackHelperPath,
    nativeMacLoopbackHelperAvailable,
    loopbackHandlerAvailable: !!(session && session.defaultSession
      && typeof session.defaultSession.setDisplayMediaRequestHandler === 'function'),
  };
}

function getScreenCapturePermissionStatus() {
  if (process.platform !== 'darwin') {
    return 'not-applicable';
  }
  if (!ENABLE_EXPERIMENTAL_ELECTRON_MAC_LOOPBACK) {
    return 'not-used';
  }
  if (!systemPreferences || typeof systemPreferences.getMediaAccessStatus !== 'function') {
    return 'unknown';
  }
  try {
    return systemPreferences.getMediaAccessStatus('screen');
  } catch (_error) {
    return 'unknown';
  }
}

function initializeDisplayMediaLoopbackHandler() {
  if (!ENABLE_EXPERIMENTAL_ELECTRON_MAC_LOOPBACK) {
    console.log('[record-mode] Electron display-media loopback handler disabled; using native audio-only helper when available.');
    return;
  }
  if (!session || !session.defaultSession || typeof session.defaultSession.setDisplayMediaRequestHandler !== 'function') {
    console.warn('[record-mode] setDisplayMediaRequestHandler is not available in this Electron build.');
    return;
  }

  const handler = async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        fetchWindowIcons: false,
        thumbnailSize: { width: 0, height: 0 },
      });
      const source = sources[0];
      if (!source) {
        callback({});
        return;
      }
      callback({
        video: source,
        audio: 'loopback',
      });
    } catch (error) {
      console.error('[record-mode] display media request handler failed:', error.message);
      callback({});
    }
  };

  if (USE_SYSTEM_SCREEN_PICKER) {
    try {
      session.defaultSession.setDisplayMediaRequestHandler(handler, { useSystemPicker: true });
    } catch (error) {
      console.warn('[record-mode] useSystemPicker option is not supported in this Electron build:', error.message);
      session.defaultSession.setDisplayMediaRequestHandler(handler);
    }
  } else {
    session.defaultSession.setDisplayMediaRequestHandler(handler);
  }

  const diagnostics = getRecordModeRuntimeDiagnostics();
  console.log(`[record-mode] Loopback handler initialized (Electron ${diagnostics.electronVersion}, Chromium ${diagnostics.chromeVersion}, systemPicker=${USE_SYSTEM_SCREEN_PICKER ? 'on' : 'off'})`);
}

function buildLoginUrl() {
  const loginUrl = new URL(`${BACKEND_BASE_URL}/login`);
  loginUrl.searchParams.set('redirect_uri', APP_AUTH_REDIRECT_URI);
  const deviceIdHash = getDeviceIdHash();
  if (deviceIdHash) {
    loginUrl.searchParams.set('device_id_hash', deviceIdHash);
  }
  return loginUrl.toString();
}

function buildBillingReturnUrl(pathname, { tier = 'pro', plan = 'annual', currency = 'eur' } = {}) {
  const target = new URL(pathname, BACKEND_BASE_URL);
  target.searchParams.set('tier', tier);
  target.searchParams.set('plan', plan);
  target.searchParams.set('currency', currency);
  return target.toString();
}

function registerAppProtocolClient() {
  try {
    let registered = false;
    if (process.defaultApp && process.argv.length >= 2) {
      registered = app.setAsDefaultProtocolClient(
        APP_PROTOCOL,
        process.execPath,
        [path.resolve(process.argv[1])]
      );
    } else {
      registered = app.setAsDefaultProtocolClient(APP_PROTOCOL);
    }
    const isDefault = app.isDefaultProtocolClient(APP_PROTOCOL);
    console.log(`[auth] protocol=${APP_PROTOCOL} registered=${registered} isDefault=${isDefault}`);
  } catch (error) {
    console.error(`[auth] Failed to register protocol ${APP_PROTOCOL}:`, error.message);
  }
}

function findDeepLinkInArgv(argv = []) {
  return argv.find((arg) => typeof arg === 'string' && arg.startsWith(`${APP_PROTOCOL}://`)) || null;
}

function persistSettings() {
  syncSettingsState();
  configureSyncInterval();
  buildTrayMenu();
  updateTrayTooltip();
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('ui-settings-updated', getUiSettings());
  }
}

function rebuildTrayMenuIfReady() {
  if (tray && !tray.isDestroyed()) {
    buildTrayMenu();
  }
}

// --- Tray menu ---
function setProcessingModeFromTray(nextMode = 'local') {
  const targetMode = nextMode === 'pro' ? 'pro' : 'local';
  const authState = getAuthState();

  if (targetMode === 'pro' && !authState.isLoggedIn) {
    shell.openExternal(buildLoginUrl());
    return;
  }

  settings.mode = targetMode;
  if (targetMode === 'local') {
    settings.syncSettings = {
      ...(settings.syncSettings || {}),
      autoSyncEnabled: true,
    };
  } else {
    settings.aiEngine.sttProvider = 'deepgram';
    settings.aiEngine.llmProvider = PRO_LLM_PROVIDER_ID;
    settings.aiEngine.summaryProvider = PRO_LLM_PROVIDER_ID;
    settings.aiEngine.llmModel = normalizeProLlmModelAlias(settings.aiEngine.llmModel);
    settings.aiEngine.summaryModel = normalizeProLlmModelAlias(settings.aiEngine.summaryModel);

  }

  persistSettings();
}

const TRAY_RECENT_LIMIT = 3;
const TRAY_RECENT_TITLE_MAX_LENGTH = 48;

function getTrayTimestamp(entry = {}, preferredKeys = []) {
  for (const key of preferredKeys) {
    const value = Number(entry[key] || 0);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function getChatTrayTimestamp(chat = {}) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  return Math.max(
    getTrayTimestamp(lastMessage || {}, ['createdAt', 'updatedAt']),
    getTrayTimestamp(chat, ['updatedAt', 'createdAt']),
  );
}

function getTrayTitle(value, fallback) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function truncateTrayTitle(title) {
  const normalizedTitle = String(title || '').trim();
  if (normalizedTitle.length <= TRAY_RECENT_TITLE_MAX_LENGTH) {
    return normalizedTitle;
  }
  return `${normalizedTitle.slice(0, TRAY_RECENT_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

function getRecentTrayEntries() {
  const noteEntries = (Array.isArray(notesData && notesData.notes) ? notesData.notes : [])
    .filter((note) => note && !note.deletedAt && note.id)
    .map((note) => ({
      type: 'note',
      id: note.id,
      kindLabel: 'Note',
      title: getTrayTitle(note.title || note.text, 'Untitled note'),
      timestamp: getTrayTimestamp(note, ['lastModified', 'updatedAt', 'createdAt']),
    }));
  const chatEntries = (Array.isArray(chatsData && chatsData.chats) ? chatsData.chats : [])
    .filter((chat) => chat && !chat.deletedAt && chat.id)
    .map((chat) => ({
      type: 'chat',
      id: chat.id,
      kindLabel: 'Chat',
      title: getTrayTitle(chat.title, 'Untitled chat'),
      timestamp: getChatTrayTimestamp(chat),
    }));
  const recordingEntries = (Array.isArray(recordingsData && recordingsData.recordings) ? recordingsData.recordings : [])
    .filter((recording) => recording && !recording.deletedAt && recording.id)
    .map((recording) => ({
      type: 'recording',
      id: recording.id,
      kindLabel: 'Recording',
      title: getTrayTitle(recording.title || recording.transcript, 'Untitled recording'),
      timestamp: getTrayTimestamp(recording, ['updatedAt', 'createdAt']),
    }));

  return [...noteEntries, ...chatEntries, ...recordingEntries]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, TRAY_RECENT_LIMIT);
}

function buildRecentTrayMenuItems() {
  const recentEntries = getRecentTrayEntries();
  const items = [
    { label: 'Recent', enabled: false },
  ];

  if (!recentEntries.length) {
    items.push({ label: 'No recent items', enabled: false });
    return items;
  }

  return [
    ...items,
    ...recentEntries.map((entry) => ({
      label: `${entry.kindLabel}: ${truncateTrayTitle(entry.title)}`,
      click: () => openDashboardDestination({ type: entry.type, id: entry.id }),
    })),
  ];
}

function setStorageDefaultFromTray(nextStorage = 'local') {
  const targetStorage = nextStorage === 'cloud' ? 'cloud' : 'local';
  const authState = getAuthState();

  if (targetStorage === 'cloud' && !authState.isLoggedIn) {
    shell.openExternal(buildLoginUrl());
    return;
  }

  settings.syncSettings = {
    ...(settings.syncSettings || {}),
    autoSyncEnabled: true,
    strictPrivacyMode: targetStorage === 'local',
  };
  persistSettings();
  scheduleSyncRun(500);
}

function buildTrayMenu() {
  const trayAuthState = getAuthState();
  const cloudStorageAvailable = trayAuthState.isLoggedIn === true;
  const cloudStorageSelected = cloudStorageAvailable && settings?.syncSettings?.strictPrivacyMode !== true;
  const localStorageSelected = !cloudStorageSelected;

  const contextMenu = Menu.buildFromTemplate([
    ...buildRecentTrayMenuItems(),
    { type: 'separator' },
    {
      label: 'Paste last dictation',
      accelerator: PASTE_LAST_TRANSCRIPTION_ACCELERATOR,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Shortcuts',
      click: () => openDashboardDestination({ type: 'settings', settingsTab: 'shortcuts' }),
    },
    {
      label: 'Storage Default',
      submenu: [
        {
          label: 'Local',
          type: 'radio',
          checked: localStorageSelected,
          click: () => setStorageDefaultFromTray('local'),
        },
        {
          label: cloudStorageAvailable ? 'Cloud' : 'Cloud (Sign in required)',
          type: 'radio',
          checked: cloudStorageSelected,
          click: () => setStorageDefaultFromTray('cloud'),
        },
      ],
    },
    { type: 'separator' },
    { label: 'Open Escribolt', click: createDashboardWindow },
    { type: 'separator' },
    { label: 'Quit Escribolt', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
}

function createTray() {
  const iconPath = path.join(__dirname, 'iconTemplate.png');
  tray = new Tray(iconPath);
  updateTrayTooltip();
  buildTrayMenu();
}

function handleQuickNoteCompletion(transcribedText) {
  if (!transcribedText) return;
  const shouldShowQuickNotePopup = settings && settings.quickNotePopupEnabled !== false;

  const activeNote = activeNoteId
    ? notesData.notes.find((note) => note.id === activeNoteId)
    : null;

  if (activeNote) {
    const existingText = typeof activeNote.text === 'string' ? activeNote.text : '';
    const separator = existingText && !existingText.endsWith('\n') ? ' ' : '';
    activeNote.text = `${existingText}${separator}${transcribedText}`;
    activeNote.lastModified = Date.now();
    persistNotesData();

    const existingWin = stickyWindows.get(activeNote.id);
    if (shouldShowQuickNotePopup) {
      if (existingWin && !existingWin.isDestroyed()) {
        closeOtherStickyWindowsExcept(activeNote.id);
        existingWin.webContents.send('append-text', transcribedText);
        showStickyWindowInActiveSpace(existingWin);
      } else {
        createStickyWindow(activeNote);
      }
    } else if (existingWin && !existingWin.isDestroyed()) {
      existingWin.webContents.send('load-note', activeNote);
    }
    return;
  }

  const newNote = {
    id: crypto.randomUUID(),
    text: transcribedText,
    isCloudSynced: !isStrictPrivacyModeEnabled(),
    colorId: getDefaultStickyNoteColorId(),
    folderId: '',
    createdAt: Date.now(),
    lastModified: Date.now()
  };
  notesData.notes.push(newNote);
  persistNotesData();
  if (shouldShowQuickNotePopup) {
    createStickyWindow(newNote);
  } else {
    showQuickNoteCreatedNotification(newNote);
  }
}

function normalizeVoiceActionStatusMode(actionMode = '') {
  return actionMode === 'quick-note' ? 'quick-note' : 'dictation';
}

function emitVoiceActionStatus(actionMode, state, options = {}) {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    return;
  }
  if (!state) {
    return;
  }
  dashboardWindow.webContents.send('voice-action:status', {
    mode: normalizeVoiceActionStatusMode(actionMode),
    state,
    source: typeof options.source === 'string' ? options.source : '',
    message: typeof options.message === 'string' ? options.message : '',
  });
}

function emitVoiceActionLifecycleStatus(nextState, context = '') {
  const actionMode = activeVoiceActionMode
    || (activeVoiceActionContext && activeVoiceActionContext.actionMode)
    || '';
  if (!actionMode) {
    return;
  }
  let status = '';
  if (nextState === DICTATION_LIFECYCLE_STATES.ARMING
    || nextState === DICTATION_LIFECYCLE_STATES.RECORDING) {
    status = 'listening';
  } else if (nextState === DICTATION_LIFECYCLE_STATES.STOPPING
    || nextState === DICTATION_LIFECYCLE_STATES.PROCESSING) {
    status = 'processing';
  } else if (nextState === DICTATION_LIFECYCLE_STATES.IDLE) {
    status = 'idle';
  }
  if (!status) {
    return;
  }
  emitVoiceActionStatus(actionMode, status, {
    source: activeVoiceActionContext && activeVoiceActionContext.activationSource,
    message: context,
  });
}

function setDictationLifecycleState(nextState, context = '') {
  if (!DICTATION_LIFECYCLE_STATE_SET.has(nextState)) {
    return;
  }
  if (dictationLifecycleState === nextState) {
    return;
  }
  const previous = dictationLifecycleState;
  dictationLifecycleState = nextState;
  const contextSuffix = context ? ` (${context})` : '';
  console.log(`[dictation][state] ${previous} -> ${nextState}${contextSuffix}`);
  emitVoiceActionLifecycleStatus(nextState, context);
  if (nextState === DICTATION_LIFECYCLE_STATES.IDLE) {
    activeVoiceActionMode = null;
    hideMainWidgetWindowIfUnused();
  }
}

function createExpectedDictationCancelError(message, code = 'DICTATION_EXPECTED_CANCEL') {
  const error = new Error(message || 'Dictation was cancelled intentionally.');
  error.code = code;
  error.dictationExpectedCancel = true;
  return error;
}

function isExpectedDictationCancelError(error) {
  return !!(error && error.dictationExpectedCancel === true);
}

function getDictationFailureBannerMessage(error) {
  const message = String(error && error.message ? error.message : '').trim();
  if (!message) {
    return DICTATION_TRANSCRIPTION_FAILURE_MESSAGE;
  }

  if (error && error.code === 'DICTATION_MAX_DURATION_EXCEEDED') {
    return message;
  }

  if (error && (error.code === 'DICTATION_OPERATION_TIMEOUT' || error.code === 'STT_FETCH_TIMEOUT')) {
    return DICTATION_TRANSCRIPTION_FAILURE_MESSAGE;
  }

  if (/Nova-3|Deepgram|websocket|WebSocket|STT|batch transcription|captured-audio|transcription returned empty|Adapter transcription/i.test(message)) {
    return DICTATION_TRANSCRIPTION_FAILURE_MESSAGE;
  }

  return message;
}

function getFinalStreamingTranscript(turnTranscripts = new Map(), fallbackTranscripts = [], provisionalTranscript = '') {
  const orderedTurnTexts = Array.from(turnTranscripts.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map((entry) => String(entry[1] || '').trim())
    .filter(Boolean);
  const source = orderedTurnTexts.length ? orderedTurnTexts : (Array.isArray(fallbackTranscripts) ? fallbackTranscripts : []);
  const finalText = source
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (finalText) {
    return finalText;
  }
  return String(provisionalTranscript || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function getCachedProStreamingToken() {
  if (!cachedProToken || !cachedProToken.key || Date.now() >= Number(cachedProToken.expiresAt || 0)) {
    return null;
  }
  return {
    key: cachedProToken.key,
    authType: cachedProToken.authType,
  };
}

function cacheProStreamingToken({ key, authType, expiresAt }) {
  const parsedExpiresAt = Number(expiresAt);
  const normalizedExpiresAt = Number.isFinite(parsedExpiresAt)
    ? (parsedExpiresAt > 1_000_000_000_000 ? parsedExpiresAt : parsedExpiresAt * 1000)
    : null;
  const reuseUntil = normalizedExpiresAt
    ? Math.max(Date.now(), normalizedExpiresAt - 5000)
    : Date.now() + 15 * 1000;
  cachedProToken = {
    key,
    authType,
    expiresAt: reuseUntil,
  };
}

function buildProStreamingTokenUrl(streamingConfig = {}) {
  const target = new URL(`${BACKEND_BASE_URL}/api/stt/ws-token`);
  target.searchParams.set('streamingProfile', streamingConfig.streamingProfile || STT_STREAMING_PROFILE_MULTILINGUAL);
  if (streamingConfig.streamingProfile === STT_STREAMING_PROFILE_MONOLINGUAL && streamingConfig.language) {
    target.searchParams.set('language', streamingConfig.language);
  }
  return target.toString();
}

async function streamRecordingAsync({ onAudioChunk, sessionId }) {
  await ensureBackendReady();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: BACKEND_HOST,
      port: backendPort,
      path: '/start_recording_stream',
      method: 'POST',
      headers: { 'Content-Length': '0' },
    }, (res) => {
      let buffer = '';
      let recordedFile = null;
      let streamError = null;

      res.on('data', (chunk) => {
        if (sessionId && sessionId !== activeSessionId) {
          req.destroy();
          return;
        }
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.event === 'error') {
              streamError = new Error(payload.message || 'Streaming error');
            } else if (payload.event === 'audio_chunk' && onAudioChunk) {
              onAudioChunk(Buffer.from(payload.chunk, 'base64'));
            } else if (payload.event === 'recording_done') {
              recordedFile = payload.audio_file;
            }
          } catch (e) {
            console.error('Failed to parse SSE line from /start_recording_stream:', e.message);
          }
        }
      });
      res.on('end', () => {
        if (sessionId && sessionId !== activeSessionId) {
          return;
        }
        if (streamError) reject(streamError);
        else resolve({ audioPath: recordedFile });
      });
    });

    req.on('error', (e) => {
      if (sessionId && sessionId !== activeSessionId) {
        return;
      }
      console.error('Backend /start_recording_stream error:', e.message);
      reject(e);
    });
    req.end();
  });
}

async function runStreamingDictationPipeline({ sessionId, actionMode, dashboardWasFocused, plan }) {
  if (!sessionId) {
    sessionId = activeSessionId;
  }
  const isQuickNoteAction = actionMode === 'quick-note';
  const adapter = sttRouter.getAdapterForRoute(plan.route);

  let adoptedSession = null;
  if (activeVoiceActionContext && activeVoiceActionContext.speculativeSession && activeVoiceActionContext.speculativeSession.sessionId === sessionId) {
    adoptedSession = activeVoiceActionContext.speculativeSession;
  }

  let wsConnection = null;
  let wsError = null;
  const turnTranscripts = adoptedSession ? adoptedSession.turnTranscripts : new Map();
  const fallbackFinalTranscripts = adoptedSession ? adoptedSession.fallbackFinalTranscripts : [];
  let lastFallbackFinal = adoptedSession ? adoptedSession.lastFallbackFinal : '';
  let latestProvisionalTranscript = adoptedSession ? (adoptedSession.latestProvisionalTranscript || '') : '';
  let recordedAudioPath = '';
  let captureCompleted = false;
  let maxDurationTimer = null;
  let maxDurationReached = false;

  if (adoptedSession) {
    console.log('[dictation][speculative] adopting speculative capture and WS session');
    if (!adoptedSession.wsConnection && adoptedSession.apiKeyPromise) {
      await adoptedSession.apiKeyPromise;
      if (sessionId !== activeSessionId) return;
    }
    wsConnection = adoptedSession.wsConnection;
  } else {
    let streamingConfig = resolveNova3StreamingConfigForSettings(settings?.aiEngine || {});
    let apiKey = '';
    let wsAuthType = 'token';
    if (plan.route.mode === 'pro') {
      const reusableToken = getCachedProStreamingToken();
      if (reusableToken) {
        console.log('[stt-router][dictation] Reusing cached PRO STT token');
        apiKey = reusableToken.key;
        wsAuthType = reusableToken.authType;
      } else {
        const jwt = await readAuthJwtWithAutoRefresh();
        if (sessionId !== activeSessionId) return;
        if (!jwt) throw new Error('PRO authentication is required for streaming dictation');
        const deviceIdHash = getDeviceIdHash();
        const proAdapter = sttRouter.proAdapter;
        if (!proAdapter || typeof proAdapter.getWsToken !== 'function') {
          throw new Error('PRO STT adapter is unavailable for streaming dictation');
        }
        const tokenInfo = await proAdapter.getWsToken({
          jwt,
          serverUrl: BACKEND_BASE_URL,
          deviceIdHash,
          streamingProfile: streamingConfig.streamingProfile,
          language: streamingConfig.streamingProfile === STT_STREAMING_PROFILE_MONOLINGUAL
            ? streamingConfig.language
            : '',
        });
        if (sessionId !== activeSessionId) return;
        if (!tokenInfo || !tokenInfo.key) {
          throw new Error('Failed to generate temporary PRO STT WebSocket token');
        }
        apiKey = tokenInfo.key;
        wsAuthType = tokenInfo.authType === 'bearer' ? 'bearer' : 'token';
        streamingConfig = {
          ...streamingConfig,
          model: tokenInfo.model || streamingConfig.model,
          language: tokenInfo.language || streamingConfig.language,
          endpoint: tokenInfo.endpoint || streamingConfig.endpoint,
          streamingProfile: tokenInfo.streamingProfile || streamingConfig.streamingProfile,
        };
        cacheProStreamingToken({
          key: apiKey,
          authType: wsAuthType,
          expiresAt: tokenInfo.expiresAt,
        });
      }
    } else {
      apiKey = getByokApiKey('deepgram');
      if (!apiKey) throw new Error('Missing BYOK API key for deepgram');
      wsAuthType = 'token';
    }

    const streamingKeyterms = resolveKeytermsForStreaming(settings?.aiEngine || {});
    console.log(`[stt-router][dictation-streaming] Nova-3 profile=${streamingConfig.streamingProfile} language=${streamingConfig.language}`);

    wsConnection = adapter.connectRealtime({
      apiKey,
      authType: wsAuthType,
      model: streamingConfig.model,
      endpoint: streamingConfig.endpoint,
      language: streamingConfig.language,
      keyterms: streamingKeyterms,
      onTurnInfo: ({ text, eventType, turnIndex }) => {
        if (sessionId !== activeSessionId) return;
        const clean = String(text || '').trim();
        if (!clean) return;
        if (Number.isInteger(turnIndex)) {
          turnTranscripts.set(turnIndex, clean);
        } else if (clean !== lastFallbackFinal) {
          fallbackFinalTranscripts.push(clean);
          lastFallbackFinal = clean;
        }
      },
      onTranscript: ({ text, isFinal, eventType }) => {
        if (sessionId !== activeSessionId) return;
        const clean = String(text || '').trim();
        if (!clean) return;
        latestProvisionalTranscript = clean;
        if (!isFinal) return;
        if (clean !== lastFallbackFinal) {
          fallbackFinalTranscripts.push(clean);
          lastFallbackFinal = clean;
        }
      },
      onError: (err) => {
        if (sessionId !== activeSessionId) return;
        wsError = err instanceof Error ? err : new Error(String(err || 'Deepgram Nova-3 websocket error'));
        console.error('[stt-router][dictation-streaming] WebSocket error', wsError.message);
      },
      onClose: (code, reasonText, meta = {}) => {
        if (sessionId !== activeSessionId) return;
        const expectedClose = !!(meta && meta.expectedClose === true);
        if (!expectedClose && !captureCompleted) {
          const suffix = typeof reasonText === 'string' && reasonText.trim() ? `: ${reasonText.trim()}` : '';
          if (!wsError) {
            wsError = new Error(`Nova-3 websocket closed before recording completed (code ${code}${suffix})`);
          }
          console.warn(`[stt-router][dictation-streaming] WebSocket closed before recording completed (code ${code}${suffix})`);
          return;
        }
        console.log(`[stt-router][dictation-streaming] WebSocket closed (code=${code}, expected=${expectedClose ? 'yes' : 'no'})`);
      },
    });
  }

  if (wsConnection && typeof wsConnection.waitForReady === 'function') {
    await wsConnection.waitForReady();
    if (sessionId !== activeSessionId) {
      if (wsConnection && typeof wsConnection.close === 'function') {
        wsConnection.close();
      }
      return;
    }
    maxDurationTimer = setTimeout(() => {
      console.warn('[dictation-streaming] Maximum dictation duration reached (5 minutes), stopping stream');
      maxDurationReached = true;
      postToBackendVoid('/stop_recording', {});
    }, 300000);
    if (adoptedSession) {
      checkAndStartPacing(adoptedSession);
    }
  }

  const wsReadyState = wsConnection ? wsConnection.getState() : 0;
  if (wsReadyState !== 1 || (adoptedSession && adoptedSession.pacedSwitchedToBatch)) {
    console.log('[stt-router][dictation] WS not ready at stop or pacing overflow, using batch fallback');
    if (wsConnection && typeof wsConnection.close === 'function') {
      wsConnection.close();
    }
    let fallbackPath = '';
    if (adoptedSession) {
      postToBackendVoid('/stop_recording', {});
      try {
        adoptedSession.captureCompleted = true;
        const captureResult = await adoptedSession.capturePromise;
        fallbackPath = typeof captureResult?.audioPath === 'string'
          ? captureResult.audioPath.trim()
          : '';
      } catch (e) {
        console.warn('[dictation][speculative] capture failed during batch fallback setup:', e.message);
      }
    }
    const wsNotReadyError = new Error('WS connection not ready at stop');
    wsNotReadyError.fallbackAudioPath = fallbackPath;
    throw wsNotReadyError;
  }

  if (!isRecording || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.STOPPING || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.IDLE) {
    if (wsConnection && typeof wsConnection.close === 'function') {
      wsConnection.close();
    }
    
    let fallbackPath = '';
    if (adoptedSession) {
      postToBackendVoid('/stop_recording', {});
      try {
        adoptedSession.captureCompleted = true;
        const captureResult = await adoptedSession.capturePromise;
        fallbackPath = typeof captureResult?.audioPath === 'string'
          ? captureResult.audioPath.trim()
          : '';
      } catch (e) {
        console.warn('[dictation][speculative] capture failed during connection interrupt fallback:', e.message);
      }
    }
    
    if (fallbackPath) {
      const connInterruptError = new Error('Recording was stopped while waiting for streaming connection');
      connInterruptError.fallbackAudioPath = fallbackPath;
      throw connInterruptError;
    }

    throw createExpectedDictationCancelError(
      'Recording was stopped while waiting for streaming connection',
      'DICTATION_STREAMING_STOPPED_BEFORE_CONNECT'
    );
  }

  const STREAMING_TARGET_CHUNK_BYTES = DEEPGRAM_STREAMING_TARGET_CHUNK_BYTES;
  let pendingPcmBytes = Buffer.alloc(0);

  try {
    if (adoptedSession) {
      const captureResult = await adoptedSession.capturePromise;
      if (sessionId !== activeSessionId) return;
      recordedAudioPath = typeof captureResult?.audioPath === 'string'
        ? captureResult.audioPath.trim()
        : '';
      adoptedSession.captureCompleted = true;
      flushSpeculativePacingQueue(adoptedSession);

      if (adoptedSession.pacingInterval && !adoptedSession.isDrained) {
        await new Promise((resolve) => {
          adoptedSession.onDrainedResolve = resolve;
        });
      }
      wsError = wsError || adoptedSession.wsError;
    } else {
      const captureResult = await streamRecordingAsync({
        sessionId,
        onAudioChunk: (buffer) => {
          if (sessionId !== activeSessionId) return;
          if (!wsConnection || !buffer || !Buffer.isBuffer(buffer)) {
            return;
          }
          pendingPcmBytes = pendingPcmBytes.length
            ? Buffer.concat([pendingPcmBytes, buffer])
            : buffer;

          while (pendingPcmBytes.length >= STREAMING_TARGET_CHUNK_BYTES) {
            const nextChunk = pendingPcmBytes.subarray(0, STREAMING_TARGET_CHUNK_BYTES);
            pendingPcmBytes = pendingPcmBytes.subarray(STREAMING_TARGET_CHUNK_BYTES);
            wsConnection.send(nextChunk);
          }
        },
      });
      if (sessionId !== activeSessionId) return;
      recordedAudioPath = typeof captureResult?.audioPath === 'string'
        ? captureResult.audioPath.trim()
        : '';
    }
  } finally {
    if (maxDurationTimer) {
      clearTimeout(maxDurationTimer);
      maxDurationTimer = null;
    }
    if (sessionId === activeSessionId) {
      captureCompleted = true;
      isRecording = false;
      setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.PROCESSING, 'streaming recording finished');
      mainWindow.webContents.send('processing', actionMode);
    }
  }

  if (wsConnection) {
    if (adoptedSession) {
      if (adoptedSession.pendingPcmBytes.length > 0) {
        wsConnection.send(adoptedSession.pendingPcmBytes);
        adoptedSession.pendingPcmBytes = Buffer.alloc(0);
      }
    } else {
      if (pendingPcmBytes.length > 0) {
        wsConnection.send(pendingPcmBytes);
        pendingPcmBytes = Buffer.alloc(0);
      }
    }
    if (typeof wsConnection.close === 'function') {
      await wsConnection.close();
    } else if (typeof wsConnection.waitForClose === 'function') {
      await wsConnection.waitForClose();
    }
  }
  if (sessionId !== activeSessionId) return;

  if (wsError) {
    wsError.fallbackAudioPath = recordedAudioPath;
    throw wsError;
  }

  if (adoptedSession && adoptedSession.latestProvisionalTranscript) {
    latestProvisionalTranscript = adoptedSession.latestProvisionalTranscript;
  }
  const finalTranscript = getFinalStreamingTranscript(turnTranscripts, fallbackFinalTranscripts, latestProvisionalTranscript);
  if (!finalTranscript) {
    if (!recordedAudioPath
      && (!isRecording
        || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.STOPPING
        || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.IDLE)) {
      throw createExpectedDictationCancelError(
        'Streaming transcription ended before audio was captured.',
        'DICTATION_STREAMING_STOPPED_WITHOUT_AUDIO'
      );
    }
    const emptyResultError = new Error('Nova-3 streaming transcription returned empty result');
    emptyResultError.fallbackAudioPath = recordedAudioPath;
    throw emptyResultError;
  }

  if (isQuickNoteAction) {
    handleQuickNoteCompletion(finalTranscript);
  } else {
    const pastePromise = pasteDictationTranscript(finalTranscript);
    mainWindow.webContents.send('reset');
    const pasteResult = await pastePromise;
    if (sessionId !== activeSessionId) return;
    reportDictationPasteFailure(pasteResult, '[dictation][streaming]');
  }

  hideMainWidgetWindowIfUnused();
  if (isQuickNoteAction) {
    mainWindow.webContents.send('reset');
  }

  if (maxDurationReached) {
    const limitError = new Error("You have exceeded the maximum time for dictation (5 minutes). Start a new Stream.");
    limitError.code = 'DICTATION_MAX_DURATION_EXCEEDED';
    throw limitError;
  }
}

async function transcribeAudioPathWithRouting(audioPath, {
  proModel = PRO_STT_MODEL,
  proLanguage = null,
  byokDeepgramModel = PRO_STT_MODEL,
  byokDeepgramLanguage = null,
  intent = 'transcription',
  logContext = 'ask-listen',
  includeRoute = false,
  allowLocalFallback = null,
} = {}) {
  if (!audioPath || typeof audioPath !== 'string') {
    throw new Error('Audio path is missing');
  }

  const batchPlan = getSttRoutingPreview({
    intent,
    preferBatch: true,
  });
  const resolvedProLanguage = resolveDeepgramBatchLanguage(proModel, proLanguage);
  const resolvedByokDeepgramLanguage = resolveDeepgramBatchLanguage(byokDeepgramModel, byokDeepgramLanguage);
  const localWhisperLanguage = resolveLocalWhisperLanguageForSettings(settings.aiEngine || {});
  const buildLocalTranscribePayload = () => ({
    audio_path: audioPath,
    ...(localWhisperLanguage ? { language: localWhisperLanguage } : {}),
  });
  const adapter = sttRouter.getAdapterForRoute(batchPlan.route);
  const canFallBackToLocal = shouldAllowLocalSttFallback({ intent, allowLocalFallback });
  const returnTranscript = (text, route) => {
    const cleanText = String(text || '').trim();
    return includeRoute ? { text: cleanText, route } : cleanText;
  };
  const returnLocalTranscript = (text) => returnTranscript(text, {
    provider: 'local',
    mode: 'local',
    transport: 'local',
    language: localWhisperLanguage || 'auto',
  });
  console.log(`[stt-router][${logContext}] adapter=${batchPlan.adapter.id}, transport=${batchPlan.route.transport}, mode=${batchPlan.route.mode}, provider=${batchPlan.route.provider}`);

  if (batchPlan.route.mode === 'local' || batchPlan.route.provider === 'local') {
    const localResult = await postToBackendAsync('/transcribe_file', buildLocalTranscribePayload());
    if (localResult.status !== 'success') {
      throw new Error(localResult.message || 'Local transcription failed');
    }
    return returnLocalTranscript(localResult.text);
  }

  if (batchPlan.route.mode === 'pro') {
    const jwt = await readAuthJwtWithAutoRefresh();
    const deviceIdHash = getDeviceIdHash();
    if (!jwt) {
      throw new Error('PRO authentication is required for speech transcription');
    }

    let result;
    try {
      result = await adapter.transcribeBatch(audioPath, {
        jwt,
        model: proModel,
        language: resolvedProLanguage,
        serverUrl: BACKEND_BASE_URL,
        deviceIdHash,
      });
    } catch (proSttError) {
      if (isTrialExhaustedResponseError(proSttError)) {
        handleCloudTrialExhausted({
          service: 'stt',
          code: 'TRIAL_EXHAUSTED',
        });
        if (!canFallBackToLocal) {
          throw proSttError;
        }
        const localFallback = await postToBackendAsync('/transcribe_file', buildLocalTranscribePayload());
        if (localFallback.status !== 'success') {
          throw proSttError;
        }
        return returnLocalTranscript(localFallback.text);
      }
      if (proSttError.message && proSttError.message.includes('TOKEN_EXPIRED')) {
        console.log(`[stt-router][${logContext}] TOKEN_EXPIRED during adapter call — refreshing and retrying`);
        const refreshedJwt = await refreshAuthToken();
        if (!refreshedJwt) {
          throw proSttError;
        }
        try {
          result = await adapter.transcribeBatch(audioPath, {
            jwt: refreshedJwt,
            model: proModel,
            language: resolvedProLanguage,
            serverUrl: BACKEND_BASE_URL,
            deviceIdHash,
          });
        } catch (retryError) {
          if (!canFallBackToLocal) {
            console.warn(`[stt-router][${logContext}] PRO STT retry failed; local fallback disabled for intent=${intent}:`, retryError.message);
            throw retryError;
          }
          console.warn(`[stt-router][${logContext}] PRO STT retry failed, falling back to local transcribe:`, retryError.message);
          const localFallback = await postToBackendAsync('/transcribe_file', buildLocalTranscribePayload());
          if (localFallback.status !== 'success') {
            throw retryError;
          }
          return returnLocalTranscript(localFallback.text);
        }
      } else {
        if (!canFallBackToLocal) {
          console.warn(`[stt-router][${logContext}] PRO STT failed; local fallback disabled for intent=${intent}:`, proSttError.message);
          throw proSttError;
        }
        console.warn(`[stt-router][${logContext}] PRO STT failed, falling back to local transcribe:`, proSttError.message);
        const localFallback = await postToBackendAsync('/transcribe_file', buildLocalTranscribePayload());
        if (localFallback.status !== 'success') {
          throw proSttError;
        }
        return returnLocalTranscript(localFallback.text);
      }
    }

    return returnTranscript(result && result.text, {
      provider: 'deepgram',
      mode: 'pro',
      transport: 'https-relay',
      model: (result && result.model) || proModel,
      language: (result && result.language) || resolvedProLanguage,
    });
  }

  const provider = batchPlan.route.provider === 'groq'
    ? 'groq'
    : batchPlan.route.provider === 'openai'
      ? 'openai'
      : 'deepgram';
  const apiKey = getByokApiKey(provider);
  if (!apiKey) {
    throw new Error(`Missing BYOK API key for ${provider}`);
  }

  const result = provider === 'deepgram'
    ? await adapter.transcribeBatch(audioPath, {
      apiKey,
      model: byokDeepgramModel,
      language: resolvedByokDeepgramLanguage,
    })
    : await adapter.transcribeBatch(audioPath, { apiKey });

  return returnTranscript(result && result.text, {
    provider,
    mode: 'byok',
    transport: provider === 'deepgram' ? 'https-pre-recorded' : batchPlan.route.transport,
    model: provider === 'deepgram' ? ((result && result.model) || byokDeepgramModel) : undefined,
    language: provider === 'deepgram' ? ((result && result.language) || resolvedByokDeepgramLanguage) : undefined,
  });
}

async function runVoiceActionPipeline({ sessionId, actionMode, dashboardWasFocused }) {
  if (!sessionId) {
    sessionId = activeSessionId;
  }
  try {
    const captureArmPromise = activeVoiceActionContext
      && activeVoiceActionContext.sessionId === sessionId
      ? activeVoiceActionContext.captureArmPromise
      : null;
    if (captureArmPromise) {
      await captureArmPromise;
      if (sessionId !== activeSessionId) return;
    }
    const speculativeStartPromise = activeVoiceActionContext
      && activeVoiceActionContext.sessionId === sessionId
      ? activeVoiceActionContext.speculativeStartPromise
      : null;
    if (speculativeStartPromise) {
      await speculativeStartPromise;
      if (sessionId !== activeSessionId) return;
    }
    if (!isRecording
      || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.STOPPING
      || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.IDLE) {
      throw createExpectedDictationCancelError(
        'Recording was stopped before the dictation pipeline started',
        'DICTATION_STOPPED_BEFORE_PIPELINE'
      );
    }

    const isQuickNoteAction = actionMode === 'quick-note';

    // 1. Resolve Route (Deepgram dictation streams first; batch is an internal fallback)
    const plan = getSttRoutingPreview({
      intent: 'transcription',
      preferBatch: null,
    });

    if (plan.route.prefersBatch === false) {
      try {
        console.log(`[stt-router][dictation] Using streaming pipeline via ${plan.route.provider}`);
        await runStreamingDictationPipeline({ sessionId, actionMode, dashboardWasFocused, plan });
        if (sessionId !== activeSessionId) return;
        setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.IDLE, 'streaming dictation complete');
        fnShortcutState.toggleActive = false;
        fnShortcutState.holdStarted = false;
        clearFnHoldTimer();
        clearPendingVoiceActionStart();
        activeVoiceActionContext = null;
        return; // Success, skip batch fallback
      } catch (streamError) {
        if (sessionId !== activeSessionId) return;
        if (streamError && streamError.code === 'DICTATION_MAX_DURATION_EXCEEDED') {
          console.warn(`[stt-router][dictation] Maximum dictation duration exceeded: ${streamError.message}`);
          isRecording = false;
          showMainWidgetErrorBanner(streamError.message);
          setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.IDLE, 'streaming max duration limit reached');
          fnShortcutState.toggleActive = false;
          fnShortcutState.holdStarted = false;
          clearFnHoldTimer();
          clearPendingVoiceActionStart();
          activeVoiceActionContext = null;
          mainWindow.webContents.send('reset');
          hideMainWidgetWindowIfUnused();
          return;
        }
        if (isExpectedDictationCancelError(streamError)) {
          console.log(`[stt-router][dictation] Streaming cancelled intentionally: ${streamError.code || streamError.message}`);
          isRecording = false;
          setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.IDLE, 'streaming expected cancel');
          fnShortcutState.toggleActive = false;
          fnShortcutState.holdStarted = false;
          clearFnHoldTimer();
          clearPendingVoiceActionStart();
          activeVoiceActionContext = null;
          mainWindow.webContents.send('reset');
          hideMainWidgetWindowIfUnused();
          return;
        }

        let fallbackAudioPath = typeof streamError?.fallbackAudioPath === 'string'
          ? streamError.fallbackAudioPath.trim()
          : '';
        const speculativeSession = activeVoiceActionContext
          && activeVoiceActionContext.sessionId === sessionId
          ? activeVoiceActionContext.speculativeSession
          : null;

        if (!fallbackAudioPath && speculativeSession && speculativeSession.capturePromise) {
          console.warn(`[stt-router][dictation] Streaming setup failed; continuing the existing microphone capture for batch fallback: ${streamError.message}`);
          const capturedFallback = await waitForSpeculativeBatchFallbackAudio(speculativeSession);
          if (sessionId !== activeSessionId) return;
          fallbackAudioPath = capturedFallback.audioPath;
          if (capturedFallback.captureCompleted) {
            isRecording = false;
            setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.PROCESSING, 'speculative capture ready for batch fallback');
            mainWindow.webContents.send('processing', actionMode);
          }
        }

        if (!fallbackAudioPath
          && (!isRecording
            || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.STOPPING
            || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.IDLE)) {
          console.log('[stt-router][dictation] Streaming failed or aborted before captured audio was available. Skipping batch fallback.');
          throw streamError;
        }

        let capturedAudioFallbackError = null;
        if (fallbackAudioPath) {
          try {
            console.warn(`[stt-router][dictation] Streaming failed, retrying with batch transcription on captured stream audio: ${streamError.message}`);
            const fallbackTranscript = await runWithTimeout(
              () => transcribeAudioPathWithRouting(fallbackAudioPath, {
                proModel: PRO_STT_MODEL,
                proLanguage: PRO_STT_LANGUAGE,
                byokDeepgramModel: PRO_STT_MODEL,
                byokDeepgramLanguage: PRO_STT_LANGUAGE,
              }),
              {
                timeoutMs: DICTATION_CAPTURED_FALLBACK_TIMEOUT_MS,
                label: 'Captured-audio batch transcription fallback',
              }
            );
            if (sessionId !== activeSessionId) return;
            const cleanedFallbackTranscript = String(fallbackTranscript || '').trim();
            if (cleanedFallbackTranscript) {
              let didResetPillForPaste = false;
              if (isQuickNoteAction) {
                handleQuickNoteCompletion(cleanedFallbackTranscript);
              } else {
                const pastePromise = pasteDictationTranscript(cleanedFallbackTranscript);
                mainWindow.webContents.send('reset');
                didResetPillForPaste = true;
                const pasteResult = await pastePromise;
                if (sessionId !== activeSessionId) return;
                reportDictationPasteFailure(pasteResult, '[dictation][streaming-fallback]');
              }
              hideMainWidgetWindowIfUnused();
              if (!didResetPillForPaste) {
                mainWindow.webContents.send('reset');
              }
              setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.IDLE, 'streaming fallback batch complete');
              fnShortcutState.toggleActive = false;
              fnShortcutState.holdStarted = false;
              clearFnHoldTimer();
              clearPendingVoiceActionStart();
              activeVoiceActionContext = null;
              return;
            }
            throw new Error('Batch transcription from captured stream audio returned empty result');
          } catch (fallbackError) {
            if (sessionId !== activeSessionId) return;
            capturedAudioFallbackError = fallbackError instanceof Error
              ? fallbackError
              : new Error(String(fallbackError || 'Captured-audio fallback failed'));
            console.warn(`[stt-router][dictation] Captured-audio fallback failed: ${capturedAudioFallbackError.message}`);
          }
        }

        if (!isRecording
          || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.STOPPING
          || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.IDLE
          || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.PROCESSING) {
          const bannerSourceError = capturedAudioFallbackError || streamError;
          const fallbackFailureSuffix = capturedAudioFallbackError ? `; captured fallback=${capturedAudioFallbackError.message}` : '';
          console.warn(`[stt-router][dictation] Streaming and captured fallbacks failed, and no live capture is possible (user already released key). Aborting cleanly: ${streamError.message}${fallbackFailureSuffix}`);
          isRecording = false;
          showMainWidgetErrorBanner(getDictationFailureBannerMessage(bannerSourceError));
          setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.IDLE, 'streaming failed clean abort');
          fnShortcutState.toggleActive = false;
          fnShortcutState.holdStarted = false;
          clearFnHoldTimer();
          clearPendingVoiceActionStart();
          activeVoiceActionContext = null;
          mainWindow.webContents.send('reset');
          hideMainWidgetWindowIfUnused();
          return;
        }

        console.warn(`[stt-router][dictation] Streaming failed, falling back to batch: ${streamError.message}`);
        setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.RECORDING, 'streaming fallback to batch');
        isRecording = true;
        // Fall through to batch...
      }
    }

    // --- Legacy Batch Pipeline Below ---
    if (!isRecording || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.STOPPING || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.IDLE) {
      throw createExpectedDictationCancelError(
        'Recording was stopped before batch recording started',
        'DICTATION_BATCH_STOPPED_BEFORE_START'
      );
    }
    const recordingStart = await postToBackendAsync('/start_recording', {
      selected_text: null,
      requested_mode: 'transcription',
    });
    if (sessionId !== activeSessionId) return;

    if (recordingStart.status !== 'success') {
      throw new Error(recordingStart.message || 'Recording failed');
    }

    const audioPath = typeof recordingStart.audio_file === 'string'
      ? recordingStart.audio_file.trim()
      : '';

    isRecording = false;
    setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.PROCESSING, 'batch recording finished');
    mainWindow.webContents.send('processing', actionMode);

    let transcribeResult = null;

    try {
      if (!audioPath) {
        throw new Error('Recording endpoint did not provide an audio file path');
      }

      const transcription = await transcribeAudioPathWithRouting(audioPath, {
        logContext: 'dictation',
        includeRoute: true,
      });
      if (sessionId !== activeSessionId) return;
      transcribeResult = {
        status: 'success',
        text: transcription.text,
        route: transcription.route,
      };

      if (!transcribeResult || transcribeResult.status !== 'success' || !String(transcribeResult.text || '').trim()) {
        throw new Error('Adapter transcription returned empty result');
      }
    } catch (sttError) {
      if (sessionId !== activeSessionId) return;
      console.warn('[stt-router][dictation] Adapter transcription failed:', sttError.message);
      throw sttError;
    }

    if (transcribeResult.status !== 'success') {
      throw new Error(transcribeResult.message || 'Transcription failed');
    }

    let didResetPillForPaste = false;
    if (!isQuickNoteAction) {
      const transcribedText = String(transcribeResult.text || '').trim();
      if (transcribedText) {
        const pastePromise = pasteDictationTranscript(transcribedText);
        mainWindow.webContents.send('reset');
        didResetPillForPaste = true;
        const pasteResult = await pastePromise;
        if (sessionId !== activeSessionId) return;
        reportDictationPasteFailure(pasteResult, 'dictation');
      }
    }

    hideMainWidgetWindowIfUnused();
    if (!didResetPillForPaste) {
      mainWindow.webContents.send('reset');
    }

    if (isQuickNoteAction && transcribeResult.text) {
      const transcribedText = String(transcribeResult.text || '').trim();
      handleQuickNoteCompletion(transcribedText);
    }
    setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.IDLE, 'batch dictation complete');
    fnShortcutState.toggleActive = false;
    fnShortcutState.holdStarted = false;
    clearFnHoldTimer();
    clearPendingVoiceActionStart();
    activeVoiceActionContext = null;
  } catch (error) {
    if (sessionId !== activeSessionId) {
      return;
    }
    if (isExpectedDictationCancelError(error)) {
      console.log(`[dictation] pipeline cancelled intentionally: ${error.code || error.message}`);
    } else {
      console.error('Voice action pipeline failed:', error.message);
      const bannerMessage = getDictationFailureBannerMessage(error);
      emitVoiceActionStatus(actionMode, 'error', {
        source: activeVoiceActionContext && activeVoiceActionContext.activationSource,
        message: bannerMessage,
      });
      showMainWidgetErrorBanner(bannerMessage);
    }
    isRecording = false;
    setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.IDLE, isExpectedDictationCancelError(error) ? 'pipeline expected cancel' : 'pipeline failure');
    fnShortcutState.toggleActive = false;
    fnShortcutState.holdStarted = false;
    clearFnHoldTimer();
    clearPendingVoiceActionStart();
    const stoppedSpeculativeCapture = teardownSpeculativeSession(activeVoiceActionContext && activeVoiceActionContext.speculativeSession);
    activeVoiceActionContext = null;
    if (!stoppedSpeculativeCapture) {
      disarmDictationCapture();
    }
    mainWindow.webContents.send('reset');
  }
}

function checkAndStartPacing(session) {
  if (session.pacedDraining || session.pacedSwitchedToBatch) return;
  if (!session.wsConnection) return;
  
  if (session.wsConnection.getState() !== 1) { // WebSocket.OPEN is 1
    return;
  }

  session.pacedDraining = true;
  console.log(`[dictation][pacing] starting drain, backlog=${session.pacedQueue.length * 90}ms`);

  const FRAME_MS = 20;
  const SPEED = 1.2;
  const CHUNK_MS = 90;
  const MAX_BACKLOG_MS = 2000;
  let budget = 0;

  session.pacingInterval = setInterval(() => {
    if (session.sessionId !== activeSessionId) {
      clearInterval(session.pacingInterval);
      session.pacingInterval = null;
      return;
    }

    const backlogMs = session.pacedQueue.length * CHUNK_MS;
    if (backlogMs > MAX_BACKLOG_MS) {
      console.warn(`[dictation][pacing] backlog overflow (${backlogMs}ms > ${MAX_BACKLOG_MS}ms), switching to batch`);
      session.pacedSwitchedToBatch = true;
      clearInterval(session.pacingInterval);
      session.pacingInterval = null;
      if (session.wsConnection && typeof session.wsConnection.close === 'function') {
        session.wsConnection.close();
      }
      return;
    }

    if (session.pacedQueue.length === 0) {
      budget = 0; // Prevent budget accumulation while queue is empty
      if (session.captureCompleted) {
        clearInterval(session.pacingInterval);
        session.pacingInterval = null;
        session.isDrained = true;
        console.log('[dictation][pacing] pacing interval finished cleanly, queue empty and capture complete');
        if (session.onDrainedResolve) {
          session.onDrainedResolve();
        }
      }
      return;
    }

    budget += FRAME_MS * SPEED;
    while (budget >= CHUNK_MS && session.pacedQueue.length > 0) {
      const entry = session.pacedQueue.shift();
      if (session.wsConnection) {
        session.wsConnection.send(entry.chunk);
      }
      budget -= CHUNK_MS;
    }
  }, FRAME_MS);
}

function flushSpeculativePacingQueue(session) {
  if (!session || !session.wsConnection || !Array.isArray(session.pacedQueue)) return;
  if (session.wsConnection.getState && session.wsConnection.getState() !== 1) return;

  if (session.pacingInterval) {
    clearInterval(session.pacingInterval);
    session.pacingInterval = null;
  }

  const flushedCount = session.pacedQueue.length;
  while (session.pacedQueue.length > 0) {
    const entry = session.pacedQueue.shift();
    if (entry && entry.chunk) {
      session.wsConnection.send(entry.chunk);
    }
  }

  session.isDrained = true;
  if (flushedCount > 0) {
    console.log(`[dictation][pacing] flushed ${flushedCount} queued chunks after stop (${flushedCount * 90}ms audio)`);
  }
  if (session.onDrainedResolve) {
    const resolve = session.onDrainedResolve;
    session.onDrainedResolve = null;
    resolve();
  }
}

async function waitForSpeculativeBatchFallbackAudio(session) {
  if (!session || !session.capturePromise) {
    return { audioPath: '', captureCompleted: false };
  }

  session.pacedSwitchedToBatch = true;
  if (session.pacingInterval) {
    clearInterval(session.pacingInterval);
    session.pacingInterval = null;
  }
  if (session.wsConnection && typeof session.wsConnection.close === 'function') {
    Promise.resolve(session.wsConnection.close()).catch((error) => {
      console.warn('[dictation][speculative] error closing realtime transport for batch fallback:', error.message);
    });
    session.wsConnection = null;
  }

  try {
    const captureResult = await session.capturePromise;
    session.captureCompleted = true;
    return {
      audioPath: typeof captureResult?.audioPath === 'string' ? captureResult.audioPath.trim() : '',
      captureCompleted: true,
    };
  } catch (error) {
    console.warn('[dictation][speculative] capture failed while waiting for batch fallback:', error.message);
    session.captureCompleted = true;
    return { audioPath: '', captureCompleted: true };
  }
}

function startSpeculativeSession(sessionId) {
  teardownSpeculativeSession();

  const plan = getSttRoutingPreview({
    intent: 'transcription',
    preferBatch: false,
  });
  const streamingConfig = resolveNova3StreamingConfigForSettings(settings?.aiEngine || {});

  const session = {
    sessionId,
    plan,
    wsConnection: null,
    apiKeyPromise: null,
    capturePromise: null,
    pacedQueue: [],
    pacedDraining: false,
    pacedSwitchedToBatch: false,
    pacingInterval: null,
    pendingPcmBytes: Buffer.alloc(0),
    isDrained: false,
    captureCompleted: false,
    turnTranscripts: new Map(),
    fallbackFinalTranscripts: [],
    lastFallbackFinal: '',
    latestProvisionalTranscript: '',
    onDrainedResolve: null,
    streamingConfig,
  };

  speculativeStreamingSession = session;

  if (plan.route.prefersBatch === true) {
    return;
  }

  const STREAMING_TARGET_CHUNK_BYTES = DEEPGRAM_STREAMING_TARGET_CHUNK_BYTES;

  if (plan.route.mode === 'pro') {
    session.apiKeyPromise = (async () => {
      const reusableToken = getCachedProStreamingToken();
      if (reusableToken) {
        console.log('[dictation][speculative] Reusing cached PRO STT token');
        return {
          ...reusableToken,
          streamingConfig,
        };
      }
      const jwt = await readAuthJwtWithAutoRefresh();
      if (sessionId !== activeSessionId) return null;
      if (!jwt) throw new Error('PRO authentication is required for streaming dictation');
      const deviceIdHash = getDeviceIdHash();
      const tokenInfo = await proRequestWithAutoRefresh(async (validJwt) => {
        const headers = { Authorization: `Bearer ${validJwt}` };
        if (deviceIdHash) {
          headers['X-Device-Id-Hash'] = deviceIdHash;
        }
        return await requestJson({
          targetUrl: buildProStreamingTokenUrl(streamingConfig),
          method: 'GET',
          headers,
        });
      });
      if (sessionId !== activeSessionId) return null;
      if (tokenInfo.statusCode !== 200 || !tokenInfo.payload || !tokenInfo.payload.key) {
        throw new Error(`Failed to generate temporary PRO key: ${tokenInfo.statusCode}`);
      }
      
      const key = tokenInfo.payload.key;
      const authType = tokenInfo.payload.authType === 'bearer' ? 'bearer' : 'token';
      const resolvedStreamingConfig = {
        ...streamingConfig,
        model: tokenInfo.payload.model || streamingConfig.model,
        language: tokenInfo.payload.language || streamingConfig.language,
        endpoint: tokenInfo.payload.endpoint || streamingConfig.endpoint,
        streamingProfile: tokenInfo.payload.streamingProfile || streamingConfig.streamingProfile,
      };
      cacheProStreamingToken({
        key,
        authType,
        expiresAt: tokenInfo.payload.expiresAt,
      });
      
      return { key, authType, streamingConfig: resolvedStreamingConfig };
    })();
  } else {
    const apiKey = getByokApiKey('deepgram');
    if (apiKey) {
      session.apiKeyPromise = Promise.resolve({ key: apiKey, authType: 'token', streamingConfig });
    }
  }

  if (session.apiKeyPromise) {
    session.apiKeyPromise.then((authInfo) => {
      if (sessionId !== activeSessionId || !authInfo) return;
      const resolvedStreamingConfig = authInfo.streamingConfig || streamingConfig;
      session.streamingConfig = resolvedStreamingConfig;
      const streamingKeyterms = resolveKeytermsForStreaming(settings?.aiEngine || {});

      const adapter = sttRouter.getAdapterForRoute(plan.route);
      session.wsConnection = adapter.connectRealtime({
        apiKey: authInfo.key,
        authType: authInfo.authType,
        model: resolvedStreamingConfig.model,
        endpoint: resolvedStreamingConfig.endpoint,
        language: resolvedStreamingConfig.language,
        keyterms: streamingKeyterms,
        onTurnInfo: ({ text, eventType, turnIndex }) => {
          if (sessionId !== activeSessionId) return;
          const clean = String(text || '').trim();
          if (!clean) return;
          if (Number.isInteger(turnIndex)) {
            session.turnTranscripts.set(turnIndex, clean);
          } else if (clean !== session.lastFallbackFinal) {
            session.fallbackFinalTranscripts.push(clean);
            session.lastFallbackFinal = clean;
          }
        },
        onTranscript: ({ text, isFinal, eventType }) => {
          if (sessionId !== activeSessionId) return;
          const clean = String(text || '').trim();
          if (!clean) return;
          session.latestProvisionalTranscript = clean;
          if (!isFinal) return;
          if (clean !== session.lastFallbackFinal) {
            session.fallbackFinalTranscripts.push(clean);
            session.lastFallbackFinal = clean;
          }
        },
        onError: (err) => {
          if (sessionId !== activeSessionId) return;
          session.wsError = err instanceof Error ? err : new Error(String(err || 'Deepgram Nova-3 websocket error'));
          console.error('[stt-router][dictation-streaming] WebSocket error', session.wsError.message);
        },
        onClose: (code, reasonText, meta = {}) => {
          if (sessionId !== activeSessionId) return;
          const expectedClose = !!(meta && meta.expectedClose === true);
          if (!expectedClose && !session.captureCompleted) {
            const suffix = typeof reasonText === 'string' && reasonText.trim() ? `: ${reasonText.trim()}` : '';
            if (!session.wsError) {
              session.wsError = new Error(`Nova-3 websocket closed before recording completed (code ${code}${suffix})`);
            }
            console.warn(`[stt-router][dictation-streaming] WebSocket closed before recording completed (code ${code}${suffix})`);
            return;
          }
          console.log(`[stt-router][dictation-streaming] WebSocket closed (code=${code}, expected=${expectedClose ? 'yes' : 'no'})`);
        },
      });

      if (session.wsConnection && typeof session.wsConnection.waitForReady === 'function') {
        session.wsConnection.waitForReady().then(() => {
          if (sessionId !== activeSessionId) return;
          checkAndStartPacing(session);
        }).catch((e) => {
          console.warn('[dictation][speculative] speculative WS ready error:', e.message);
        });
      }
    }).catch((e) => {
      console.error('[dictation][speculative] speculative WS connection error:', e.message);
    });
  }

  session.capturePromise = streamRecordingAsync({
    sessionId,
    onAudioChunk: (buffer) => {
      if (sessionId !== activeSessionId) return;
      if (!buffer || !Buffer.isBuffer(buffer)) return;

      session.pendingPcmBytes = session.pendingPcmBytes.length
        ? Buffer.concat([session.pendingPcmBytes, buffer])
        : buffer;

      while (session.pendingPcmBytes.length >= STREAMING_TARGET_CHUNK_BYTES) {
        const nextChunk = session.pendingPcmBytes.subarray(0, STREAMING_TARGET_CHUNK_BYTES);
        session.pendingPcmBytes = session.pendingPcmBytes.subarray(STREAMING_TARGET_CHUNK_BYTES);
        
        session.pacedQueue.push({
          chunk: nextChunk,
          receivedAtMs: Date.now(),
        });
        checkAndStartPacing(session);
      }
    },
  });
  session.capturePromise.catch(() => undefined);
}

function teardownSpeculativeSession(sessionOverride = null) {
  const session = sessionOverride || speculativeStreamingSession;
  if (session) {
    if (speculativeStreamingSession === session) {
      speculativeStreamingSession = null;
    }

    if (session.pacingInterval) {
      clearInterval(session.pacingInterval);
      session.pacingInterval = null;
    }

    if (session.wsConnection) {
      try {
        if (typeof session.wsConnection.close === 'function') {
          session.wsConnection.close();
        }
      } catch (e) {
        console.warn('[dictation][speculative] error closing speculative WS:', e.message);
      }
      session.wsConnection = null;
    }

    postToBackendVoid('/stop_recording', {});
    if (session.capturePromise && typeof session.capturePromise.finally === 'function') {
      session.capturePromise
        .catch(() => undefined)
        .finally(() => disarmDictationCapture());
    }
    return true;
  }
  return false;
}



function clearFnHoldTimer() {
  if (fnHoldTimer) {
    clearTimeout(fnHoldTimer);
    fnHoldTimer = null;
  }
}

function clearPendingVoiceActionStart() {
  if (pendingVoiceActionStartTimer) {
    clearTimeout(pendingVoiceActionStartTimer);
    pendingVoiceActionStartTimer = null;
  }
  pendingVoiceActionStartContext = null;
}

function normalizeVoiceActionSource(source = 'shortcut') {
  const normalized = String(source || '').trim();
  if (normalized === 'fn-hold' || normalized === 'hands-free-toggle' || normalized === 'quick-note-shortcut') {
    return normalized;
  }
  return 'shortcut';
}

function normalizeActivationStartedAtMs(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return Date.now();
}

function getVoiceActionElapsedMs(context, nowMs = Date.now()) {
  if (!context || !Number.isFinite(Number(context.activationStartedAtMs))) {
    return 0;
  }
  return Math.max(0, nowMs - Number(context.activationStartedAtMs));
}

function startVoiceActionPipelineFromContext(context, reason = 'arming complete') {
  if (!context || activeVoiceActionContext !== context || context.pipelineStarted) {
    return false;
  }
  if (!isRecording) {
    return false;
  }
  if (dictationLifecycleState !== DICTATION_LIFECYCLE_STATES.ARMING
    && dictationLifecycleState !== DICTATION_LIFECYCLE_STATES.RECORDING) {
    return false;
  }

  context.pipelineStarted = true;
  clearPendingVoiceActionStart();

  if (dictationLifecycleState === DICTATION_LIFECYCLE_STATES.ARMING) {
    setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.RECORDING, reason);
  }

  runVoiceActionPipeline({
    sessionId: context.sessionId,
    actionMode: context.actionMode,
    dashboardWasFocused: context.dashboardWasFocused,
  }).catch((error) => {
    console.error('[dictation] Unhandled pipeline rejection:', error);
    if (context.sessionId === activeSessionId) {
      isRecording = false;
      setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.IDLE, 'unhandled pipeline rejection');
      fnShortcutState.toggleActive = false;
      fnShortcutState.holdStarted = false;
      clearFnHoldTimer();
      clearPendingVoiceActionStart();
      activeVoiceActionContext = null;
      mainWindow.webContents.send('reset');
      showMainWidgetErrorBanner(getDictationFailureBannerMessage(error));
    }
  });
  return true;
}

function resetFnShortcutState() {
  clearFnHoldTimer();
  clearPendingVoiceActionStart();
  activeVoiceActionContext = null;
  fnShortcutState.isFnDown = false;
  fnShortcutState.holdStarted = false;
  fnShortcutState.spaceUsedInPress = false;
  fnShortcutState.ignoreFnUpTap = false;
  fnShortcutState.toggleActive = false;
  fnShortcutState.fnDownStartedAtMs = 0;
}

function startVoiceAction(actionMode = 'transcription', options = {}) {
  if (isRecordModeBusy()) {
    showRecordModeConflictBanner(actionMode);
    return false;
  }
  if (dictationLifecycleState !== DICTATION_LIFECYCLE_STATES.IDLE) {
    console.log(`[dictation] start ignored while state=${dictationLifecycleState}`);
    showDictationBusyBanner(actionMode);
    return false;
  }
  if (isRecording) {
    showDictationBusyBanner(actionMode);
    return false;
  }

  const sessionId = (options && options.sessionId) || crypto.randomUUID();
  activeSessionId = sessionId;

  let speculativeSession = null;
  if (speculativeStreamingSession && speculativeStreamingSession.sessionId === sessionId) {
    speculativeSession = speculativeStreamingSession;
    speculativeStreamingSession = null;
  }

  const normalizedActionMode = actionMode === 'quick-note' ? 'quick-note' : 'transcription';
  const activationSource = normalizeVoiceActionSource(options && options.source);
  const activationStartedAtMs = normalizeActivationStartedAtMs(options && options.activationStartedAtMs);
  const gateApplies = normalizedActionMode === 'transcription';
  const minActiveMs = gateApplies ? DICTATION_MIN_ACTIVE_MS : 0;
  const elapsedSinceActivationMs = gateApplies ? getVoiceActionElapsedMs({ activationStartedAtMs }) : 0;
  const remainingMinActiveMs = gateApplies
    ? Math.max(0, minActiveMs - elapsedSinceActivationMs)
    : 0;
  const widgetMode = normalizedActionMode === 'quick-note' ? 'quick-note' : 'dictate';
  console.log(`[${normalizedActionMode}] widget mode=${widgetMode} (ActiveNote: ${activeNoteId})`);
  const sttSessionPlan = getSttRoutingPreview({
    intent: 'transcription',
    preferBatch: null,
  });
  console.log(`[stt-router] adapter=${sttSessionPlan.adapter.id}, transport=${sttSessionPlan.route.transport}, mode=${sttSessionPlan.route.mode}, provider=${sttSessionPlan.route.provider}`);
  const routeIsLocal = !!(sttSessionPlan.route && (sttSessionPlan.route.mode === 'local' || sttSessionPlan.route.provider === 'local'));
  if (routeIsLocal && !localSttRuntimeStatus.available) {
    if (localSttRuntimeStatus.status !== 'error') {
      warmLocalSttRuntimeIfNeeded('dictation-start');
    }
    showMainWidgetErrorBanner(getLocalSttUnavailableMessage(localSttRuntimeStatus), { dismissPill: false });
    return false;
  }
  activeVoiceActionMode = normalizedActionMode;
  const captureArmPromise = armDictationCapture();
  captureArmPromise.catch(() => undefined);

  const dashboardWasFocused = dashboardWindow && !dashboardWindow.isDestroyed() && dashboardWindow.isFocused();
  clearPendingVoiceActionStart();
  activeVoiceActionContext = {
    sessionId,
    speculativeSession,
    actionMode: normalizedActionMode,
    dashboardWasFocused,
    activationSource,
    activationStartedAtMs,
    minActiveMs,
    pipelineStarted: false,
    captureArmPromise,
    speculativeStartPromise: null,
  };
  if (!speculativeSession && sttSessionPlan.route.prefersBatch === false) {
    const context = activeVoiceActionContext;
    context.speculativeStartPromise = captureArmPromise.then(() => {
      if (sessionId !== activeSessionId
        || activeVoiceActionContext !== context
        || !isRecording
        || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.STOPPING
        || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.IDLE) {
        return null;
      }
      startSpeculativeSession(sessionId);
      if (speculativeStreamingSession && speculativeStreamingSession.sessionId === sessionId) {
        context.speculativeSession = speculativeStreamingSession;
        speculativeStreamingSession = null;
      }
      return context.speculativeSession;
    }).catch((error) => {
      console.warn('[dictation][speculative] failed to start speculative capture:', error.message);
      return null;
    });
  }
  isRecording = true;
  const initialState = remainingMinActiveMs > 0
    ? DICTATION_LIFECYCLE_STATES.ARMING
    : DICTATION_LIFECYCLE_STATES.RECORDING;
  setDictationLifecycleState(initialState, `start-${normalizedActionMode}:${activationSource}`);
  mainWindow.showInactive();
  mainWindow.webContents.send('start-listening', widgetMode);

  if (remainingMinActiveMs > 0) {
    pendingVoiceActionStartContext = activeVoiceActionContext;
    pendingVoiceActionStartTimer = setTimeout(() => {
      if (sessionId !== activeSessionId) return;
      pendingVoiceActionStartTimer = null;
      const context = pendingVoiceActionStartContext;
      pendingVoiceActionStartContext = null;
      if (!context
        || activeVoiceActionContext !== context
        || !isRecording
        || dictationLifecycleState !== DICTATION_LIFECYCLE_STATES.ARMING) {
        return;
      }
      startVoiceActionPipelineFromContext(context, 'min-active gate satisfied');
    }, remainingMinActiveMs);
  } else {
    startVoiceActionPipelineFromContext(activeVoiceActionContext, 'start-immediate');
  }
  return true;
}

function stopVoiceAction(reason = 'shortcut') {
  if (dictationLifecycleState === DICTATION_LIFECYCLE_STATES.STOPPING
    || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.PROCESSING) {
    return false;
  }
  if ((dictationLifecycleState !== DICTATION_LIFECYCLE_STATES.RECORDING
      && dictationLifecycleState !== DICTATION_LIFECYCLE_STATES.ARMING) || !isRecording) {
    return false;
  }

  const wasArming = dictationLifecycleState === DICTATION_LIFECYCLE_STATES.ARMING;
  const activeContext = activeVoiceActionContext;
  if (wasArming) {
    const elapsedMs = getVoiceActionElapsedMs(activeContext);
    const minActiveMs = Number(activeContext && activeContext.minActiveMs ? activeContext.minActiveMs : 0);
    if (minActiveMs > 0 && elapsedMs < minActiveMs) {
      clearPendingVoiceActionStart();
      const stoppedSpeculativeCapture = teardownSpeculativeSession(activeContext && activeContext.speculativeSession);
      if (!stoppedSpeculativeCapture) {
        disarmDictationCapture();
      }
      isRecording = false;
      fnShortcutState.holdStarted = false;
      if (reason === 'fn-toggle-stop' || reason === 'fn-tap-stop') {
        fnShortcutState.toggleActive = false;
      }
      activeVoiceActionContext = null;
      setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.IDLE, `${reason}-cancelled-short-${Math.floor(elapsedMs)}ms`);
      mainWindow.webContents.send('reset');
      hideMainWidgetWindowIfUnused();
      return true;
    }
    if (activeContext && !activeContext.pipelineStarted) {
      startVoiceActionPipelineFromContext(activeContext, `${reason}-arming-gate-reached`);
    }
    if (dictationLifecycleState === DICTATION_LIFECYCLE_STATES.ARMING) {
      clearPendingVoiceActionStart();
      const stoppedSpeculativeCapture = teardownSpeculativeSession(activeContext && activeContext.speculativeSession);
      if (!stoppedSpeculativeCapture) {
        disarmDictationCapture();
      }
      isRecording = false;
      fnShortcutState.holdStarted = false;
      if (reason === 'fn-toggle-stop' || reason === 'fn-tap-stop') {
        fnShortcutState.toggleActive = false;
      }
      activeVoiceActionContext = null;
      setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.IDLE, `${reason}-cancelled-pre-pipeline`);
      mainWindow.webContents.send('reset');
      hideMainWidgetWindowIfUnused();
      return true;
    }
  }

  isRecording = false;
  setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.STOPPING, reason);
  fnShortcutState.holdStarted = false;
  if (reason === 'fn-toggle-stop' || reason === 'fn-tap-stop') {
    fnShortcutState.toggleActive = false;
  }
  mainWindow.webContents.send('processing');
  postToBackendVoid('/stop_recording', {});
  return true;
}

function handleFnShortcutEvent(eventType, payload = {}) {
  if (!settings || !settings.shortcuts) {
    return;
  }
  const normalizedShortcuts = normalizeShortcutSettings(settings.shortcuts);
  const holdEnabled = normalizedShortcuts.dictationHoldPreset === 'fn_hold';
  const handsFreeFnEnabled = normalizedShortcuts.dictationHandsFreePreset === 'fn_space_toggle';
  const quickNoteFnEnabled = normalizedShortcuts.quickNotePreset === 'fn_n_toggle';
  const recordModeFnEnabled = normalizedShortcuts.recordModePreset === 'fn_r_toggle';
  if (!holdEnabled && !handsFreeFnEnabled && !quickNoteFnEnabled && !recordModeFnEnabled) {
    return;
  }

  if (eventType === 'fn_down') {
    fnShortcutState.isFnDown = true;
    fnShortcutState.fnDownStartedAtMs = Date.now();
    fnShortcutState.spaceUsedInPress = false;
    clearFnHoldTimer();
    if (!holdEnabled || fnShortcutState.toggleActive) {
      return;
    }
    if (isRecordModeBusy()) {
      fnHoldTimer = setTimeout(() => {
        fnHoldTimer = null;
        if (!fnShortcutState.isFnDown || fnShortcutState.spaceUsedInPress) {
          return;
        }
        showRecordModeConflictBanner('transcription');
      }, FN_HOLD_GRACE_MS);
      return;
    }
    if (dictationLifecycleState !== DICTATION_LIFECYCLE_STATES.IDLE || isRecording) {
      fnHoldTimer = setTimeout(() => {
        fnHoldTimer = null;
        if (!fnShortcutState.isFnDown || fnShortcutState.spaceUsedInPress) {
          return;
        }
        showDictationBusyBanner('transcription');
      }, FN_HOLD_GRACE_MS);
      return;
    }
    const sessionId = crypto.randomUUID();
    activeSessionId = sessionId;
    armDictationCapture();
    fnHoldTimer = setTimeout(() => {
      if (sessionId !== activeSessionId) return;
      fnHoldTimer = null;
      if (!fnShortcutState.isFnDown || fnShortcutState.spaceUsedInPress || fnShortcutState.toggleActive) {
        return;
      }
      const started = startVoiceAction('transcription', {
        source: 'fn-hold',
        activationStartedAtMs: fnShortcutState.fnDownStartedAtMs || Date.now(),
        sessionId,
      });
      if (started) {
        fnShortcutState.holdStarted = true;
      }
    }, FN_HOLD_GRACE_MS);
    return;
  }

  if (eventType === 'space_down') {
    const fnPressed = payload && payload.fn === true;
    if (!handsFreeFnEnabled || !fnPressed) return;
    fnShortcutState.spaceUsedInPress = true;
    fnShortcutState.ignoreFnUpTap = true;
    clearFnHoldTimer();
    if (dictationLifecycleState === DICTATION_LIFECYCLE_STATES.STOPPING
      || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.PROCESSING) {
      showDictationBusyBanner('transcription');
      return;
    }
    if ((dictationLifecycleState === DICTATION_LIFECYCLE_STATES.RECORDING
      || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.ARMING)
      && activeVoiceActionContext
      && activeVoiceActionContext.actionMode !== 'transcription') {
      showDictationBusyBanner('transcription');
      return;
    }
    if (fnShortcutState.holdStarted) {
      fnShortcutState.holdStarted = false;
      fnShortcutState.toggleActive = true;
      if (activeVoiceActionContext) {
        activeVoiceActionContext.activationSource = 'hands-free-toggle';
      }
      console.log('[dictation] transitioned Fn hold capture to hands-free mode');
      return;
    }
    if (fnShortcutState.toggleActive || isRecording) {
      stopVoiceAction('fn-toggle-stop');
      fnShortcutState.toggleActive = false;
    } else {
      const prearmedSessionId = fnShortcutState.isFnDown ? activeSessionId : null;
      const started = startVoiceAction('transcription', {
        source: 'hands-free-toggle',
        activationStartedAtMs: Date.now(),
        ...(prearmedSessionId ? { sessionId: prearmedSessionId } : {}),
      });
      fnShortcutState.toggleActive = started;
    }
    return;
  }

  if (eventType === 'n_down') {
    const fnPressed = payload && payload.fn === true;
    if (!quickNoteFnEnabled || !fnPressed) return;
    fnShortcutState.spaceUsedInPress = true;
    fnShortcutState.ignoreFnUpTap = true;
    clearFnHoldTimer();
    if (isDictationBusy()) {
      if ((dictationLifecycleState === DICTATION_LIFECYCLE_STATES.RECORDING
        || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.ARMING)
        && activeVoiceActionContext
        && activeVoiceActionContext.actionMode === 'quick-note') {
        stopVoiceAction('fn-toggle-stop');
        fnShortcutState.toggleActive = false;
        return;
      }
      showDictationBusyBanner('quick-note');
      return;
    }
    const started = startVoiceAction('quick-note', {
      source: 'quick-note-shortcut',
      activationStartedAtMs: Date.now(),
    });
    fnShortcutState.toggleActive = started;
    return;
  }

  if (eventType === 'r_down') {
    const fnPressed = payload && payload.fn === true;
    if (!recordModeFnEnabled || !fnPressed) return;
    fnShortcutState.spaceUsedInPress = true;
    fnShortcutState.ignoreFnUpTap = true;
    clearFnHoldTimer();
    startRecordModeFromTray();
    return;
  }

  if (eventType === 'fn_up') {
    fnShortcutState.isFnDown = false;
    fnShortcutState.fnDownStartedAtMs = 0;
    clearFnHoldTimer();

    if (fnShortcutState.holdStarted) {
      stopVoiceAction('fn-hold-stop');
      fnShortcutState.holdStarted = false;
    } else if (handsFreeFnEnabled && fnShortcutState.toggleActive && !fnShortcutState.spaceUsedInPress && !fnShortcutState.ignoreFnUpTap) {
      stopVoiceAction('fn-tap-stop');
      fnShortcutState.toggleActive = false;
    }

    fnShortcutState.spaceUsedInPress = false;
    fnShortcutState.ignoreFnUpTap = false;
    if (!isRecording && dictationLifecycleState === DICTATION_LIFECYCLE_STATES.IDLE) {
      disarmDictationCapture();
    }
  }
}

function triggerVoiceAction({ mode }) {
  const normalizedMode = mode === 'quick-note' ? 'quick-note' : 'transcription';
  if (dictationLifecycleState === DICTATION_LIFECYCLE_STATES.RECORDING
    || dictationLifecycleState === DICTATION_LIFECYCLE_STATES.ARMING) {
    const activeActionMode = getActiveVoiceActionMode();
    if (normalizedMode !== activeActionMode) {
      console.log(`[dictation] ${normalizedMode} start blocked while ${activeActionMode || 'voice action'} is active`);
      showDictationBusyBanner(normalizedMode);
      return;
    }
    console.log('Hotkey pressed again — stopping recording');
    stopVoiceAction('toggle-shortcut-stop');
    return;
  }
  if (dictationLifecycleState !== DICTATION_LIFECYCLE_STATES.IDLE) {
    console.log(`[dictation] toggle ignored while state=${dictationLifecycleState}`);
    showDictationBusyBanner(normalizedMode);
    return;
  }
  if (normalizedMode === 'quick-note') {
    startVoiceAction('quick-note', {
      source: 'quick-note-shortcut',
      activationStartedAtMs: Date.now(),
    });
    return;
  }
  startVoiceAction('transcription', {
    source: 'hands-free-toggle',
    activationStartedAtMs: Date.now(),
  });
}

// --- Companion CLI & AI Chat Integrations ---
const net = require('net');
const readline = require('readline');
const os = require('os');

let companionCliServerToken = '';
let companionCliServerSocketPath = '';

function initializeCompanionCliServer() {
  try {
    const socketDir = path.join(os.homedir(), '.escribolt');
    if (!fs.existsSync(socketDir)) {
      fs.mkdirSync(socketDir, { recursive: true });
    }

    const socketPath = path.join(socketDir, 'escribolt-companion-cli.sock');
    const tokenPath = path.join(socketDir, 'companion-cli.token');
    
    companionCliServerSocketPath = socketPath;

    // Delete any existing socket file to prevent EADDRINUSE
    if (fs.existsSync(socketPath)) {
      try {
        fs.unlinkSync(socketPath);
      } catch (err) {
        console.error('[cli-server] Failed to delete existing socket file:', err.message);
      }
    }

    // Generate token
    companionCliServerToken = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(tokenPath, companionCliServerToken, { mode: 0o600 });
    console.log(`[cli-server] Wrote secure auth token to: ${tokenPath}`);

    const server = net.createServer((socket) => {
      let authenticated = false;
      const rl = readline.createInterface({
        input: socket,
        terminal: false
      });

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
          const msg = JSON.parse(trimmed);

          if (!authenticated) {
            if (msg.token === companionCliServerToken) {
              authenticated = true;
              socket.write(JSON.stringify({ status: 'authenticated' }) + '\n');
            } else {
              socket.write(JSON.stringify({ error: 'unauthorized', message: 'Invalid token' }) + '\n');
              socket.end();
            }
            return;
          }

          const { command, payload } = msg;

          if (command === 'notes.list') {
            const limit = Number(payload?.limit) || 100;
            const notes = (notesData.notes || [])
              .filter(n => !n.deletedAt)
              .slice(0, limit)
              .map(n => ({
                id: n.id,
                title: n.title,
                createdAt: n.createdAt,
                lastModified: n.lastModified,
                folderId: n.folderId
              }));
            socket.write(JSON.stringify({ status: 'ok', notes }) + '\n');

          } else if (command === 'notes.get') {
            const id = payload?.id;
            const note = (notesData.notes || []).find(n => n.id === id && !n.deletedAt);
            if (note) {
              socket.write(JSON.stringify({ status: 'ok', note }) + '\n');
            } else {
              socket.write(JSON.stringify({ error: 'not_found', message: 'Note not found' }) + '\n');
            }

          } else if (command === 'notes.transcript.get') {
            const id = payload?.id;
            const recording = (recordingsData.recordings || [])
              .find(r => (r.id === id || r.noteId === id) && !r.deletedAt);

            if (recording) {
              socket.write(JSON.stringify({
                status: 'ok',
                transcript: recording.transcription || recording.transcript || ''
              }) + '\n');
            } else {
              socket.write(JSON.stringify({ error: 'not_found', message: 'Transcript not found' }) + '\n');
            }

          } else if (command === 'recordings.list') {
            const limit = Number(payload?.limit) || 100;
            const recordings = (recordingsData.recordings || [])
              .filter(r => !r.deletedAt)
              .slice(0, limit)
              .map(r => ({
                id: r.id,
                title: r.title || 'Untitled Recording',
                createdAt: r.createdAt,
                folderId: r.folderId
              }));
            socket.write(JSON.stringify({ status: 'ok', recordings }) + '\n');

          } else if (command === 'chats.list') {
            const limit = Number(payload?.limit) || 100;
            const chats = (chatsData.chats || [])
              .filter(c => c.messages && c.messages.length > 0 && c.id !== 'global')
              .slice(0, limit)
              .map(c => ({
                id: c.id,
                title: c.title || 'Untitled Chat',
                createdAt: c.createdAt,
                updatedAt: c.updatedAt,
                messagesCount: c.messages ? c.messages.length : 0
              }));
            socket.write(JSON.stringify({ status: 'ok', chats }) + '\n');

          } else if (command === 'chats.get') {
            const id = payload?.id;
            const chatSession = (chatsData.chats || []).find(c => c.id === id);
            if (chatSession) {
              const compressed = compressChatHistory(chatSession.messages);
              socket.write(JSON.stringify({
                status: 'ok',
                id: chatSession.id,
                title: chatSession.title || 'Untitled Chat',
                compressedHistory: compressed
              }) + '\n');
            } else {
              socket.write(JSON.stringify({ error: 'not_found', message: 'Chat not found' }) + '\n');
            }

          } else if (command === 'space.search') {
            const folderId = payload?.folderId;
            const query = payload?.query || '';
            if (!folderId) {
              socket.write(JSON.stringify({ error: 'invalid_payload', message: 'folderId is required' }) + '\n');
            } else {
              const results = localSearchSpace(folderId, query, notesData.notes, recordingsData.recordings);
              const mappedNotes = results.notes.map(n => ({
                id: n.id,
                title: n.title,
                text: n.text || n.content || ''
              }));
              const mappedRecordings = results.recordings.map(r => ({
                id: r.id,
                title: r.title || 'Untitled Recording',
                transcript: r.transcription || r.transcript || ''
              }));
              socket.write(JSON.stringify({ status: 'ok', notes: mappedNotes, recordings: mappedRecordings }) + '\n');
            }

          } else {
            socket.write(JSON.stringify({ error: 'unknown_command', message: `Command ${command} not supported` }) + '\n');
          }

        } catch (err) {
          socket.write(JSON.stringify({ error: 'invalid_json', message: err.message }) + '\n');
        }
      });

      socket.on('error', (err) => {
        // Suppress reset errors or standard connection closes from terminal CLI exits
      });
    });

    server.listen(socketPath, () => {
      console.log(`[cli-server] Secure JSON-line server listening on Unix socket: ${socketPath}`);
    });

  } catch (error) {
    console.error('[cli-server] Failed to start Unix socket server:', error.message);
  }
}

function installAgentSkills() {
  try {
    const binaryPath = isDev 
      ? path.resolve(path.join(__dirname, '..', 'bin', 'escribolt-companion-cli'))
      : path.resolve(path.join(process.resourcesPath, 'bin', 'escribolt-companion-cli'));

    const templatePath = path.resolve(path.join(__dirname, '..', 'agent-skills', 'escribolt-companion-cli', 'SKILL.template.md'));
    if (!fs.existsSync(templatePath)) {
      console.warn('[skill-installer] SKILL.template.md not found at', templatePath);
      return;
    }

    let content = fs.readFileSync(templatePath, 'utf8');
    content = content.replace(/\{\{binary_path\}\}/g, binaryPath);

    const home = os.homedir();
    const targets = [
      path.join(home, '.claude', 'skills', 'escribolt.md'),
      path.join(home, '.cursor', 'skills', 'escribolt.md'),
      path.join(home, '.gemini', 'skills', 'escribolt.md')
    ];

    for (const target of targets) {
      try {
        const targetDir = path.dirname(target);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.writeFileSync(target, content, 'utf8');
        console.log(`[skill-installer] Skill successfully installed to ${target}`);
      } catch (err) {
        console.warn(`[skill-installer] Failed to install skill to ${target}:`, err.message);
      }
    }
  } catch (error) {
    console.error('[skill-installer] Error installing agent skills:', error.message);
  }
}


function compressChatHistory(messages) {
  if (!Array.isArray(messages)) return '';
  const qaPairs = [];
  let currentQ = '';
  
  for (const msg of messages) {
    if (msg.role === 'user') {
      currentQ = String(msg.content || '').trim();
    } else if (msg.role === 'assistant' && currentQ) {
      const cleanAnswer = String(msg.content || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*$/gi, '')
        .trim();
      const shortAnswer = cleanAnswer.length > 400 
        ? cleanAnswer.slice(0, 400) + '... (truncated)' 
        : cleanAnswer;
      qaPairs.push(`Q: ${currentQ}\nA: ${shortAnswer}`);
      currentQ = '';
    }
  }
  return qaPairs.join('\n\n');
}

function localSearchSpace(folderId, query, notes, recordings) {
  const spaceNotes = (notes || []).filter(n => n.folderId === folderId && !n.deletedAt);
  const spaceRecordings = (recordings || []).filter(r => r.folderId === folderId && !r.deletedAt);

  const terms = String(query || '').toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (terms.length === 0) {
    return {
      notes: spaceNotes.slice(0, 3),
      recordings: spaceRecordings.slice(0, 3)
    };
  }

  const scoreText = (text) => {
    const lower = String(text || '').toLowerCase();
    let score = 0;
    for (const term of terms) {
      const matches = lower.split(term).length - 1;
      score += matches;
    }
    return score;
  };

  const scoredNotes = spaceNotes.map(n => ({
    note: n,
    score: scoreText(n.title) * 3 + scoreText(n.text || n.content)
  })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

  const scoredRecordings = spaceRecordings.map(r => ({
    recording: r,
    score: scoreText(r.title) * 3 + scoreText(r.transcript || r.transcription)
  })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

  return {
    notes: scoredNotes.length > 0 ? scoredNotes.slice(0, 3).map(x => x.note) : spaceNotes.slice(0, 3),
    recordings: scoredRecordings.length > 0 ? scoredRecordings.slice(0, 3).map(x => x.recording) : spaceRecordings.slice(0, 3)
  };
}

function setupChatIpcHandlers() {
  const resolveChatWorkingMessage = (question) => {
    return 'Thinking...';
  };

  const sanitizeChatHistoryContent = (raw) => {
    const text = typeof raw === 'string' ? raw : '';
    // Remove internal reasoning blocks before sending prior turns back to the model.
    return text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<think>[\s\S]*$/gi, '')
      .trim();
  };

  const formatSelectedContextForPrompt = (contextSelection) => {
    const items = Array.isArray(contextSelection) ? contextSelection : [];
    if (!items.length) {
      return '';
    }
    return items.map((item) => {
      const label = item.label || item.id || 'Untitled';
      if (item.kind === 'folder') {
        const parts = [];
        if (item.notes_count > 0) parts.push(`${item.notes_count} note${item.notes_count === 1 ? '' : 's'}`);
        if (item.recordings_count > 0) parts.push(`${item.recordings_count} recording${item.recordings_count === 1 ? '' : 's'}`);
        if (item.chats_count > 0) parts.push(`${item.chats_count} chat${item.chats_count === 1 ? '' : 's'}`);
        return `- Space: ${label} (ID: ${item.id || 'unknown'}; ${parts.join(', ') || 'empty'})`;
      }
      return `- ${item.kind}: ${label} (ID: ${item.id || 'unknown'})`;
    }).join('\n');
  };

  const buildFlatChatContextMarkdown = ({
    selectedContext,
    notesMarkdown,
    transcript,
    pastChats,
    spaceSearchResults,
  }) => {
    const sections = [];
    const addSection = (title, body) => {
      const cleanBody = String(body || '').trim();
      if (!cleanBody) return;
      sections.push(`${title}:\n${cleanBody}`);
    };

    addSection('Selected context', selectedContext);
    addSection('Notes', notesMarkdown);
    addSection('Recordings/transcripts', transcript);
    addSection('Past chats', Array.isArray(pastChats) ? pastChats.join('\n\n') : pastChats);
    addSection('Space search results', Array.isArray(spaceSearchResults) ? spaceSearchResults.join('\n\n') : spaceSearchResults);

    return sections.join('\n\n') || 'No Escribolt context was provided.';
  };

  const formatSpaceSearchSummary = ({ folderId, folderName, query, results }) => {
    const noteLines = (results.notes || []).map((note) => `  - Note: ${note.title || 'Untitled Note'} (ID: ${note.id})`);
    const recordingLines = (results.recordings || []).map((recording) => `  - Recording: ${recording.title || 'Untitled Recording'} (ID: ${recording.id})`);
    const lines = [
      `--- Space Search: ${folderName || 'Untitled Space'} (ID: ${folderId}) ---`,
      `Query: ${query || '(empty query)'}`,
      'Matched notes:',
      ...(noteLines.length ? noteLines : ['  - None']),
      'Matched recordings:',
      ...(recordingLines.length ? recordingLines : ['  - None']),
    ];
    return lines.join('\n');
  };

  ipcMain.on('chat:send', (event, { prompt, chatHistory, modelOverride, providerOverride, contextSelection, chatId }) => {
    (async () => {
      try {
        const settings = userSettingsStore.store || {};
        const aiEngine = settings.aiEngine || {};

        let provider = providerOverride || aiEngine.llmProvider || 'openai';
        let modelName = modelOverride || aiEngine.llmModel || 'gpt-4o-mini';
        let apiMode = settings.mode || 'local'; // 'local' | 'byok' | 'pro'

        let requestModel = 'local';
        let requestModelName = '';
        let requestApiKey = '';

        if (apiMode === 'byok' || providerOverride) {
          requestModel = provider;
          requestModelName = modelName;
          requestApiKey = getByokApiKey(provider);
        } else if (apiMode === 'pro') {
          requestModel = 'pro';
          requestModelName = modelName;
          requestApiKey = '';
        }

      // 1. Filter notes and transcripts context based on contextSelection
      const selections = Array.isArray(contextSelection) ? contextSelection : (contextSelection ? [contextSelection] : []);
      const hasExplicitContextSelection = selections.length > 0;

      let selectedNotes = [];
      let selectedRecordings = [];
      let selectedChatIds = [];
      const selectedPastChats = [];
      const spaceSearchResults = [];

      if (selections.length > 0) {
        const noteIds = new Set();
        const recordingIds = new Set();
        let includeAllRecordings = false;

        for (const sel of selections) {
          if (sel.kind === 'note' && sel.id) {
            noteIds.add(sel.id);
          } else if (sel.kind === 'recording' && sel.id) {
            recordingIds.add(sel.id);
          } else if (sel.kind === 'chat' && sel.id) {
            selectedChatIds.push(sel.id);
            const chatSession = (chatsData.chats || []).find(c => c.id === sel.id);
            if (chatSession && chatSession.messages) {
              const compressed = compressChatHistory(chatSession.messages);
              selectedPastChats.push(`--- Past Chat: ${chatSession.title || 'Untitled Chat'} (ID: ${chatSession.id}) ---\n${compressed || 'No summarized chat history available.'}`);
            }
          } else if (sel.kind === 'folder' && sel.id) {
            // Path A: Run Librarian local RAG!
            const searchResults = localSearchSpace(sel.id, prompt, notesData.notes, recordingsData.recordings);
            searchResults.notes.forEach(n => noteIds.add(n.id));
            searchResults.recordings.forEach(r => recordingIds.add(r.id));
            const folder = (notesData.folders || []).find(f => f.id === sel.id);
            spaceSearchResults.push(formatSpaceSearchSummary({
              folderId: sel.id,
              folderName: folder ? folder.name : 'Untitled Space',
              query: prompt,
              results: searchResults,
            }));
          } else if (sel.kind === 'recording' || sel.kind === 'all_recordings') {
            includeAllRecordings = true;
          }
        }

        if (includeAllRecordings) {
          selectedRecordings = (recordingsData.recordings || []).filter(r => !r.deletedAt);
        } else {
          selectedRecordings = (recordingsData.recordings || []).filter(r => recordingIds.has(r.id) && !r.deletedAt);
        }

        selectedNotes = (notesData.notes || []).filter(n => noteIds.has(n.id) && !n.deletedAt);
      } else {
        selectedNotes = (notesData.notes || []).filter(n => !n.deletedAt);
        selectedRecordings = (recordingsData.recordings || []).filter(r => !r.deletedAt);
        selectedChatIds = (chatsData.chats || [])
          .filter(c => c.messages && c.messages.length > 0 && c.id !== 'global')
          .map(c => c.id);
      }

      // Collect active IDs for dynamic tool provisioning and backend validation scoping
      const activeNoteIds = selectedNotes.map(n => n.id);
      const activeRecordingIds = selectedRecordings.map(r => r.id);
      const activeChatIds = selectedChatIds;

      // Emit real progress: context loaded
      const activeNotes = hasExplicitContextSelection ? selectedNotes.filter((n) => !n.deletedAt) : [];
      const activeRecordings = hasExplicitContextSelection ? selectedRecordings.filter((r) => !r.deletedAt) : [];
      const activeChats = hasExplicitContextSelection ? selectedChatIds : [];
      const contextParts = [];
      if (activeNotes.length > 0) contextParts.push(`${activeNotes.length} note${activeNotes.length === 1 ? '' : 's'}`);
      if (activeRecordings.length > 0) contextParts.push(`${activeRecordings.length} recording${activeRecordings.length === 1 ? '' : 's'}`);
      if (activeChats.length > 0) contextParts.push(`${activeChats.length} chat${activeChats.length === 1 ? '' : 's'}`);
      event.sender.send('chat:progress', { step: 'context', message: contextParts.length > 0 ? `Reading ${contextParts.join(' and ')}` : 'No context selected' });

      // Construct contexts (non-deleted only)
      let notesMarkdown = selectedNotes
        .filter(n => !n.deletedAt)
        .map(n => `--- Note: ${n.title} (ID: ${n.id}) ---\n${n.text || n.content || ''}`)
        .join('\n\n');

      const transcript = selectedRecordings
        .filter(r => !r.deletedAt)
        .map(r => `--- Recording: ${r.title || 'Untitled Recording'} (ID: ${r.id}) ---\n${r.transcription || r.transcript || ''}`)
        .join('\n\n');

      // 3. Construct chat history string and messages
      const chatHistoryStr = (chatHistory || [])
        .map((m) => {
          const role = m.role === 'user' ? 'User' : 'Assistant';
          const content = sanitizeChatHistoryContent(m.content);
          return content ? `${role}: ${content}` : '';
        })
        .filter(Boolean)
        .join('\n');

      const sanitizedHistoryMessages = (chatHistory || [])
        .map((m) => {
          const content = sanitizeChatHistoryContent(m.content);
          return { role: m.role === 'user' ? 'user' : 'assistant', content };
        })
        .filter(m => m.content);

      let jwt = null;
      let deviceIdHash = null;
      let serverUrl = null;

      if (apiMode === 'pro') {
        jwt = await readAuthJwtWithAutoRefresh();
        if (!jwt) {
          event.sender.send('chat:error', 'Please log in to use Escribolt Pro.');
          return;
        }
        deviceIdHash = getDeviceIdHash();
        serverUrl = BACKEND_BASE_URL;
      }

      // Build enriched context_selection with human-readable labels for the AI preamble
      const enrichedContextSelection = selections.map(s => {
        const entry = { kind: s.kind, id: s.id };
        if (s.kind === 'folder' && s.id) {
          const folder = (notesData.folders || []).find(f => f.id === s.id);
          if (folder) {
            entry.label = folder.name || 'Untitled folder';
            // Count resources inside this space
            const spaceNotes = (notesData.notes || []).filter(n => n.folderId === s.id && !n.deletedAt);
            const spaceRecordings = (recordingsData.recordings || []).filter(r => r.folderId === s.id && !r.deletedAt);
            const spaceChats = (chatsData.chats || []).filter(c => c.folderId === s.id && c.messages && c.messages.length > 0);
            entry.notes_count = spaceNotes.length;
            entry.recordings_count = spaceRecordings.length;
            entry.chats_count = spaceChats.length;
          }
        } else if (s.kind === 'note' && s.id) {
          const note = (notesData.notes || []).find(n => n.id === s.id);
          if (note) entry.label = note.title || 'Untitled note';
        } else if (s.kind === 'recording' && s.id) {
          const rec = (recordingsData.recordings || []).find(r => r.id === s.id);
          if (rec) entry.label = rec.title || 'Untitled recording';
        } else if (s.kind === 'chat' && s.id) {
          const chat = (chatsData.chats || []).find(c => c.id === s.id);
          if (chat) entry.label = chat.title || 'Untitled chat';
        }
        return entry;
      });

      const payload = {
        prompt_variables: {
          context_markdown: buildFlatChatContextMarkdown({
            selectedContext: formatSelectedContextForPrompt(enrichedContextSelection),
            notesMarkdown,
            transcript,
            pastChats: selectedPastChats,
            spaceSearchResults,
          }),
          chat_history: chatHistoryStr,
          question: prompt
        },
        messages: sanitizedHistoryMessages,
        model: requestModel,
        model_name: requestModelName,
        api_key: requestApiKey,
        max_tokens: 2048,
        context_active_ids: {
          notes: activeNoteIds,
          recordings: activeRecordingIds,
          chats: activeChatIds
        },
        is_global_context: selections.length === 0,
        context_selection: enrichedContextSelection,
        jwt,
        device_id_hash: deviceIdHash,
        server_url: serverUrl,
        chat_id: chatId
      };

      event.sender.send('chat:progress', { step: 'llm', message: resolveChatWorkingMessage(prompt) });

      // Send to local FastAPI stream
      await ensureBackendReady();
      let doneSent = false;
      const req = http.request({
        hostname: BACKEND_HOST,
        port: backendPort,
        path: '/v1/chat/stream',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }, (res) => {
        res.setEncoding('utf8');
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk;
          let lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const dataStr = trimmed.slice(6);
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.event === 'chunk') {
                  event.sender.send('chat:chunk', parsed.text);
                } else if (parsed.event === 'progress') {
                  event.sender.send('chat:progress', { step: parsed.step || 'llm', message: parsed.message || '' });
                } else if (parsed.event === 'done') {
                  if (!doneSent) {
                    doneSent = true;
                    event.sender.send('chat:done');
                  }
                } else if (parsed.event === 'error') {
                  event.sender.send('chat:error', parsed.message);
                }
              } catch (err) {
                // Ignore parse errors
              }
            }
          }
        });

        res.on('end', () => {
          if (!doneSent) {
            doneSent = true;
            event.sender.send('chat:done');
          }
        });
      });

      req.on('error', (err) => {
        event.sender.send('chat:error', `FastAPI connection error: ${err.message}`);
      });

      req.write(JSON.stringify(payload));
      req.end();

    } catch (error) {
      event.sender.send('chat:error', `Failed to initialize chat stream: ${error.message}`);
    }
    })();
  });

  ipcMain.handle('chat:generate-title', async (event, { firstMessage }) => {
    try {
      const settings = userSettingsStore.store || {};
      const aiEngine = settings.aiEngine || {};

      let provider = aiEngine.llmProvider || 'openai';
      let modelName = aiEngine.llmModel || 'gpt-4o-mini';
      let apiMode = settings.mode || 'local'; // 'local' | 'byok' | 'pro'

      let requestModel = 'local';
      let requestModelName = '';
      let requestApiKey = '';

      if (apiMode === 'byok' || apiMode === 'pro') {
        requestModel = provider;
        requestModelName = modelName;
        requestApiKey = getByokApiKey(provider);
      }

      const promptText = `Generate a concise, 2-to-4 word title for a chat session starting with this user message. Do not include quotes, markdown, punctuation, or any introductory phrases. Return ONLY the title itself.\n\nUser message: ${firstMessage}`;

      if (apiMode === 'pro') {
        const jwt = await readAuthJwtWithAutoRefresh();
        if (!jwt) {
          return firstMessage.trim().split('\n')[0].slice(0, 40);
        }

        let fullText = '';
        await llmRouter.proAdapter.executeStream({
          actionType: 'chat',
          question: promptText,
          notes: [],
          recordings: [],
          chatHistory: [],
          jwt,
          provider: PRO_LLM_PROVIDER_ID,
          model: modelName,
          modelAlias: modelName,
          aiActionType: 'chat',
          maxTokens: 50,
          deviceIdHash: getDeviceIdHash()
        }, (text) => {
          fullText += text;
        });
        const cleanTitle = fullText.trim().replace(/^["']|["']$/g, '').trim();
        return cleanTitle || firstMessage.trim().split('\n')[0].slice(0, 40);
      }

      // Otherwise call local FastAPI endpoint '/v1/chat/title'
      await ensureBackendReady();
      const bodyStr = JSON.stringify({
        first_message: firstMessage,
        model: requestModel,
        model_name: requestModelName,
        api_key: requestApiKey
      });

      return new Promise((resolve) => {
        const req = http.request({
          hostname: BACKEND_HOST,
          port: backendPort,
          path: '/v1/chat/title',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
          },
        }, (res) => {
          let buffer = '';
          res.on('data', (chunk) => {
            buffer += chunk.toString();
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(buffer);
              resolve(parsed.title || firstMessage.trim().split('\n')[0].slice(0, 40));
            } catch (err) {
              resolve(firstMessage.trim().split('\n')[0].slice(0, 40));
            }
          });
        });

        req.on('error', (err) => {
          console.error('[chat:generate-title] API request error:', err);
          resolve(firstMessage.trim().split('\n')[0].slice(0, 40));
        });

        req.write(bodyStr);
        req.end();
      });

    } catch (error) {
      console.error('[chat:generate-title] Error:', error);
      return firstMessage.trim().split('\n')[0].slice(0, 40);
    }
  });
}

app.whenReady().then(async () => {
  installApplicationMenu();
  if (app.isPackaged) {
    backendPort = await findFreePort(8000);
    console.log(`[backend] Dynamically allocated port: ${backendPort}`);
  } else {
    backendPort = 8000;
  }
  startPythonBackend();
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }
  console.log(`[escribolt-main-startup] marker=import-audio-ipc-v1 file=public/electron.js pid=${process.pid} time=${new Date().toISOString()}`);
  if (!ensureLocalStateDbAvailableOrExit()) {
    return;
  }
  initializeCompanionCliServer();
  installAgentSkills();
  setupChatIpcHandlers();
  registerAppProtocolClient();
  initializeDisplayMediaLoopbackHandler();
  createWindow();
  if (settings && settings.onboardingCompleted) {
    applyMeetingPromptWatcherState();
    applyVoiceShortcutsWithRollback({ persistRollback: true });
  }
  createTray();
  app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin });

  if (pendingAuthDeepLink) {
    handleAuthDeepLink(pendingAuthDeepLink);
    pendingAuthDeepLink = null;
  }

  const startupDeepLink = findDeepLinkInArgv(process.argv);
  if (startupDeepLink) {
    handleAuthDeepLink(startupDeepLink);
  }

  createDashboardWindow();
  initializeAutoUpdates();
  cleanupLegacyConversationsData();
  configureSyncInterval();
  scheduleSyncRun(2000);

  // Sync saved settings to backend (with delay for backend startup)
  setTimeout(syncSettingsToBackend, 2000);
  setTimeout(() => {
    bootstrapBackendRuntimeAssets().catch((error) => {
      console.warn('[runtime-bootstrap] unexpected failure:', error.message);
    });
  }, 2500);

  // IPC: renderer asks to stop recording
  ipcMain.on('stop-recording', () => {
    postToBackendVoid('/stop_recording', {});
  });

  ipcMain.on('dictation:force-reset', () => {
    console.warn('[dictation] Force reset requested by renderer');
    isRecording = false;
    setDictationLifecycleState(DICTATION_LIFECYCLE_STATES.IDLE, 'force-reset');
    fnShortcutState.toggleActive = false;
    fnShortcutState.holdStarted = false;
    clearFnHoldTimer();
    clearPendingVoiceActionStart();
    teardownSpeculativeSession();
    activeVoiceActionContext = null;
    activeSessionId = null;
    mainWindow.webContents.send('reset');
  });


  ipcMain.handle('microphone:get-access-status', async () => {
    if (process.platform !== 'darwin') {
      return {
        status: 'granted',
        canRequest: false,
        platform: process.platform,
      };
    }

    try {
      const rawStatus = systemPreferences.getMediaAccessStatus('microphone');
      const status = typeof rawStatus === 'string' && rawStatus.trim()
        ? rawStatus.trim()
        : 'unknown';
      return {
        status,
        canRequest: status === 'not-determined' && typeof systemPreferences.askForMediaAccess === 'function',
        platform: process.platform,
      };
    } catch (error) {
      return {
        status: 'unknown',
        canRequest: false,
        platform: process.platform,
        message: error.message,
      };
    }
  });
  ipcMain.handle('microphone:request-access', async () => {
    if (process.platform !== 'darwin') {
      return {
        status: 'granted',
        granted: true,
        canRequest: false,
        platform: process.platform,
      };
    }

    try {
      if (typeof systemPreferences.askForMediaAccess !== 'function') {
        const rawStatus = systemPreferences.getMediaAccessStatus('microphone');
        const status = typeof rawStatus === 'string' && rawStatus.trim()
          ? rawStatus.trim()
          : 'unknown';
        return {
          status,
          granted: status === 'granted',
          canRequest: false,
          platform: process.platform,
        };
      }

      const granted = await systemPreferences.askForMediaAccess('microphone');
      const rawStatus = systemPreferences.getMediaAccessStatus('microphone');
      const status = typeof rawStatus === 'string' && rawStatus.trim()
        ? rawStatus.trim()
        : (granted ? 'granted' : 'denied');
      return {
        status,
        granted: !!granted || status === 'granted',
        canRequest: status === 'not-determined',
        platform: process.platform,
      };
    } catch (error) {
      return {
        status: 'unknown',
        granted: false,
        canRequest: false,
        platform: process.platform,
        message: error.message,
      };
    }
  });
  ipcMain.handle('accessibility:get-access-status', async () => {
    if (process.platform !== 'darwin') {
      return {
        status: 'granted',
        platform: process.platform,
      };
    }
    try {
      const isTrusted = systemPreferences.isTrustedAccessibilityClient(false);
      return {
        status: isTrusted ? 'granted' : 'denied',
        platform: process.platform,
      };
    } catch (error) {
      return {
        status: 'unknown',
        platform: process.platform,
        message: error.message,
      };
    }
  });
  ipcMain.handle('accessibility:request-access', async () => {
    if (process.platform !== 'darwin') {
      return {
        status: 'granted',
        platform: process.platform,
      };
    }
    try {
      const isTrusted = systemPreferences.isTrustedAccessibilityClient(true);
      return {
        status: isTrusted ? 'granted' : 'denied',
        platform: process.platform,
      };
    } catch (error) {
      return {
        status: 'unknown',
        platform: process.platform,
        message: error.message,
      };
    }
  });
  ipcMain.handle('accessibility:open-settings', async () => {
    if (process.platform !== 'darwin') {
      return { success: true };
    }
    const urls = [
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      'x-apple.systempreferences:com.apple.preference.security',
    ];
    for (const url of urls) {
      try {
        await shell.openExternal(url);
        return { success: true, url };
      } catch (_e) {}
    }
    return { success: false };
  });
  ipcMain.handle('fn-listener:get-access-status', async () => {
    if (process.platform !== 'darwin') {
      return { status: 'granted', granted: true, canRequestInputMonitoring: false, platform: process.platform };
    }
    return runNativeFnKeyHelperAvailabilityProbe();
  });
  ipcMain.handle('input-monitoring:get-access-status', async () => {
    if (process.platform !== 'darwin') {
      return { status: 'granted', granted: true, canRequest: false, platform: process.platform };
    }
    return runNativeFnKeyHelperPermissionCommand(['--preflight-input-monitoring']);
  });
  ipcMain.handle('input-monitoring:request-access', async () => {
    if (process.platform !== 'darwin') {
      return { status: 'granted', granted: true, canRequest: false, platform: process.platform };
    }
    return runNativeFnKeyHelperPermissionCommand(['--request-input-monitoring']);
  });
  ipcMain.handle('input-monitoring:open-settings', async () => {
    if (process.platform !== 'darwin') {
      return { success: true };
    }
    const urls = [
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
      'x-apple.systempreferences:com.apple.preference.security',
    ];
    for (const url of urls) {
      try {
        await shell.openExternal(url);
        return { success: true, url };
      } catch (_e) {}
    }
    return { success: false };
  });
  ipcMain.handle('microphone:open-settings', async () => {
    if (process.platform !== 'darwin') {
      return { success: true };
    }
    const urls = [
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      'x-apple.systempreferences:com.apple.preference.security',
    ];
    for (const url of urls) {
      try {
        await shell.openExternal(url);
        return { success: true, url };
      } catch (_e) {}
    }
    return { success: false };
  });
  ipcMain.handle('screen:get-access-status', async (_event, options = {}) => {
    if (process.platform !== 'darwin') {
      return { status: 'granted', platform: process.platform };
    }
    try {
      if (resolveNativeMacLoopbackHelperPath()) {
        if (options && options.refresh === true) {
          return await runNativeMacSystemAudioPermissionProbe({ timeoutMs: 5000 });
        }
        return getNativeMacSystemAudioPermissionStatus();
      }
      if (!ENABLE_EXPERIMENTAL_ELECTRON_MAC_LOOPBACK) {
        return {
          status: 'unknown',
          platform: process.platform,
          message: 'Native system audio helper is unavailable and Electron screen capture fallback is disabled.',
        };
      }
      const status = getScreenCapturePermissionStatus();
      return { status, platform: process.platform };
    } catch (error) {
      return { status: 'unknown', platform: process.platform, message: error.message };
    }
  });
  ipcMain.handle('screen:request-access', async () => {
    if (process.platform !== 'darwin') {
      return { status: 'granted', platform: process.platform };
    }
    try {
      if (resolveNativeMacLoopbackHelperPath()) {
        return await runNativeMacSystemAudioPermissionProbe();
      }
      if (!ENABLE_EXPERIMENTAL_ELECTRON_MAC_LOOPBACK) {
        return {
          status: 'unknown',
          platform: process.platform,
          message: 'Native system audio helper is unavailable and Electron screen capture fallback is disabled.',
        };
      }
      await desktopCapturer.getSources({
        types: ['screen'],
        fetchWindowIcons: false,
        thumbnailSize: { width: 1, height: 1 },
      });
      const status = getScreenCapturePermissionStatus();
      return { status, platform: process.platform };
    } catch (error) {
      return { status: 'unknown', platform: process.platform, message: error.message };
    }
  });
  ipcMain.handle('screen:open-settings', async () => {
    if (process.platform !== 'darwin') {
      return { success: true };
    }
    const urls = [
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      'x-apple.systempreferences:com.apple.preference.security',
    ];
    for (const url of urls) {
      try {
        await shell.openExternal(url);
        return { success: true, url };
      } catch (_e) {}
    }
    return { success: false };
  });
  ipcMain.handle('record-mode:start-session', async (_event, payload = {}) => {
    try {
      if (isDictationBusy()) {
        const message = showDictationConflictBanner();
        return {
          status: 'conflict',
          message,
        };
      }
      recordModeStartPending = true;
      const requestedEngine = payload.captureEngine === 'native-helper'
        ? 'native-helper'
        : 'electron-mediarecorder';
      if (process.platform === 'darwin'
          && requestedEngine === 'electron-mediarecorder'
          && !ENABLE_EXPERIMENTAL_ELECTRON_MAC_LOOPBACK) {
        return {
          status: 'error',
          message: 'Electron screen-capture loopback is disabled in this build. Use the native system-audio helper.',
        };
      }

      const session = requestedEngine === 'native-helper'
        ? await createNativeRecordModeSession({
          captureMic: payload.captureMic !== false,
        })
        : createElectronRecordModeSession();

      return {
        status: 'success',
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        captureEngine: session.captureEngine,
      };
    } catch (error) {
      recordModeStartPending = false;
      return {
        status: 'error',
        message: error.message,
      };
    }
  });
  ipcMain.on('record-mode:append-chunk', (_event, payload = {}) => {
    try {
      appendRecordModeChunk(payload.sessionId, payload.chunk);
    } catch (error) {
      console.error('[record-mode] Failed to append chunk:', error.message);
    }
  });
  ipcMain.handle('record-mode:stop-session', async (_event, payload = {}) => {
    try {
      const result = await stopRecordModeSession(payload.sessionId);
      return result;
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
      };
    }
  });
  ipcMain.handle('record-mode:abort-session', async (_event, payload = {}) => {
    return abortRecordModeSession(payload.sessionId);
  });
  ipcMain.handle('record-mode:get-runtime-diagnostics', () => getRecordModeRuntimeDiagnostics());
  ipcMain.handle('record-mode:can-start', async () => {
    if (isDictationBusy()) {
      const message = showDictationConflictBanner();
      return {
        status: 'conflict',
        message,
      };
    }
    if (isRecordModeBusy()) {
      const message = showRecordModeBusyBanner();
      return {
        status: 'conflict',
        message,
      };
    }
    recordModeStartPending = true;
    await disarmDictationCapture();
    return { status: 'ok' };
  });
  ipcMain.handle('record-mode:get-capture-prereq', () => {
    const diagnostics = getRecordModeRuntimeDiagnostics();
    const recommendedCaptureEngine = (
      diagnostics.platform === 'darwin'
      && diagnostics.nativeMacLoopbackHelperAvailable
    ) ? 'native-helper' : 'electron-mediarecorder';
    return {
      ...diagnostics,
      recommendedCaptureEngine,
      screenCapturePermission: getScreenCapturePermissionStatus(),
      systemAudioPermission: getNativeMacSystemAudioPermissionStatus(),
    };
  });
  ipcMain.on('record-mode:command-listener-ready', (event) => {
    if (!dashboardWindow || dashboardWindow.isDestroyed() || event.sender !== dashboardWindow.webContents) {
      return;
    }
    dashboardRecordModeCommandReady = true;
    flushPendingDashboardRecordModeCommand();
  });
  ipcMain.on('record-widget:sync-status', (_event, payload = {}) => {
    syncRecordModeWidget(payload.status);
  });
  ipcMain.on('record-widget:sync-audio', (_event, payload = {}) => {
    syncRecordModeWidgetAudio(payload);
  });
  ipcMain.on('record-processing-widget:ready', () => {
    syncRecordProcessingWidget(trayRecordModeStatus);
  });
  ipcMain.handle('meeting-prompt:request-permissions', async () => requestMeetingPromptPermissions());
  ipcMain.handle('meeting-prompt:open-permission-settings', async () => openMeetingPromptPermissionSettings());
  ipcMain.on('meeting-prompt:ready', () => {
    syncMeetingPromptWidget(true);
  });
  ipcMain.on('meeting-prompt:dismiss', (_event, payload = {}) => {
    dismissMeetingPrompt(typeof payload.key === 'string' ? payload.key : '');
  });
  ipcMain.on('meeting-prompt:start-recording', (_event, payload = {}) => {
    startRecordingFromMeetingPrompt(typeof payload.key === 'string' ? payload.key : '');
  });
  ipcMain.on('record-widget:resize', (event, payload = {}) => {
    // Sizing is now fixed and stabilized through click-through transparent bounds
  });
  ipcMain.on('record-widget:set-ignore-mouse-events', (event, ignore, options) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setIgnoreMouseEvents(ignore, options);
  });
  ipcMain.on('record-widget:show-speech-error-banner', () => {
    showMainWidgetErrorBanner('No speech content was detected in system or microphone tracks.');
  });
  ipcMain.on('promo-banner:intent', (_event, payload = {}) => {
    setPromoBannerPending(payload.visible);
  });
  ipcMain.on('promo-banner:rendered-state', (_event, payload = {}) => {
    setPromoBannerRenderedState(payload.visible);
  });
  ipcMain.on('record-widget:stop-recording', () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      sendRecordModeCommandToDashboard({ action: 'stop' });
    }
  });
  ipcMain.handle('processing-mode:set-feature', async (_event, payload = {}) => {
    const feature = String(payload.feature || '').trim();
    const location = payload.location === 'cloud' ? 'cloud' : 'local';
    if (!PROCESSING_MODE_KEYS.includes(feature)) {
      return {
        status: 'error',
        message: 'Unknown processing feature',
        processingMode: getRecordModeProcessingWidgetState(),
      };
    }

    if (location === 'cloud') {
      if (!hasCloudProcessingCredential(feature)) {
        shell.openExternal(buildLoginUrl());
        warmLocalSttRuntimeIfNeeded('processing-mode-auth-required');
        return {
          status: 'requires-auth',
          message: 'Sign in is required for cloud processing',
          processingMode: getRecordModeProcessingWidgetState(),
          settings: getUiSettings(),
        };
      }
    }

    settings.processingModes = buildProcessingModePatch(
      { [feature]: location },
      settings.processingModes || PROCESSING_MODE_DEFAULTS,
    );
    settings.aiEngine = normalizeAiEngineRoutingSettings(
      settings.aiEngine,
      settings.mode,
      listByokKeyStatus(),
    );
    persistSettings();
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send('ui-settings-updated', getUiSettings());
    }
    syncRecordModeWidget(trayRecordModeStatus);
    if (isCurrentSttRouteLocal()) {
      warmLocalSttRuntimeIfNeeded(`processing-mode:${feature}`);
    }
    return {
      status: 'success',
      processingMode: getRecordModeProcessingWidgetState(),
      settings: getUiSettings(),
    };
  });
  ipcMain.on('open-dashboard', () => createDashboardWindow());
  ipcMain.on('open-login-flow', () => {
    shell.openExternal(buildLoginUrl());
  });
  ipcMain.handle('updates:get-state', () => getUpdateStateSnapshot());
  ipcMain.handle('updates:check', () => checkForUpdates({ manual: true }));
  ipcMain.handle('updates:download', () => downloadAvailableUpdate());
  ipcMain.handle('updates:install', () => installDownloadedUpdate());
  ipcMain.handle('billing:open-checkout', async (_event, payload = {}) => {
    try {
      const tier = String(payload.tier || 'pro').trim().toLowerCase() === 'standard' ? 'standard' : 'pro';
      const plan = String(payload.plan || 'annual').trim().toLowerCase() === 'monthly' ? 'monthly' : 'annual';
      const currency = 'eur';

      const checkoutResult = await proRequestWithAutoRefresh((jwt) => requestJson({
        targetUrl: BILLING_CHECKOUT_URL,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
        body: {
          tier,
          plan,
          currency,
          successRedirect: buildBillingReturnUrl('/billing/success', { tier, plan, currency }),
          cancelRedirect: buildBillingReturnUrl('/billing/cancel', { tier, plan, currency }),
        },
      }));

      if (checkoutResult.statusCode < 200 || checkoutResult.statusCode >= 300) {
        return {
          status: 'error',
          message: checkoutResult.payload && checkoutResult.payload.error
            ? checkoutResult.payload.error
            : `Checkout request failed with status ${checkoutResult.statusCode}`,
        };
      }

      const checkoutUrl = checkoutResult.payload && typeof checkoutResult.payload.url === 'string'
        ? checkoutResult.payload.url
        : '';
      if (!checkoutUrl) {
        return {
          status: 'error',
          message: 'Checkout response did not include URL.',
        };
      }

      await shell.openExternal(checkoutUrl);
      return { status: 'success', url: checkoutUrl };
    } catch (error) {
      return {
        status: 'error',
        message: error && error.message ? error.message : 'Unable to open checkout',
      };
    }
  });
  ipcMain.handle('billing:open-portal', async (_event, payload = {}) => {
    try {
      const returnUrl = typeof payload.returnUrl === 'string' && payload.returnUrl.trim()
        ? payload.returnUrl.trim()
        : buildLoginUrl();
      const portalResult = await proRequestWithAutoRefresh((jwt) => requestJson({
        targetUrl: BILLING_PORTAL_URL,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
        body: {
          returnUrl,
        },
      }));

      if (portalResult.statusCode < 200 || portalResult.statusCode >= 300) {
        return {
          status: 'error',
          message: portalResult.payload && portalResult.payload.error
            ? portalResult.payload.error
            : `Billing portal request failed with status ${portalResult.statusCode}`,
        };
      }

      const portalUrl = portalResult.payload && typeof portalResult.payload.url === 'string'
        ? portalResult.payload.url
        : '';
      if (!portalUrl) {
        return {
          status: 'error',
          message: 'Billing portal response did not include URL.',
        };
      }

      await shell.openExternal(portalUrl);
      return { status: 'success', url: portalUrl };
    } catch (error) {
      return {
        status: 'error',
        message: error && error.message ? error.message : 'Unable to open billing portal',
      };
    }
  });

  ipcMain.handle('get-ui-settings', () => getUiSettings());
  ipcMain.handle('dashboard:consume-pending-navigation', () => {
    const destination = pendingDashboardNavigation;
    pendingDashboardNavigation = null;
    return normalizeDashboardNavigationDestination(destination || {}) || {};
  });
  ipcMain.handle('dashboard:consume-pending-note-navigation', () => {
    const destination = normalizeDashboardNavigationDestination(pendingDashboardNavigation || {});
    const noteId = destination && destination.type === 'note' ? destination.id : '';
    if (noteId) {
      pendingDashboardNavigation = null;
    }
    return {
      noteId: typeof noteId === 'string' ? noteId : '',
    };
  });
  ipcMain.handle('dashboard:consume-pending-menu-commands', () => {
    const commands = pendingDashboardMenuCommands;
    pendingDashboardMenuCommands = [];
    return commands;
  });
  ipcMain.handle('shortcuts:get-runtime', () => getShortcutsRuntimePayload());
  ipcMain.handle('dashboard:get-window-state', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    return getDashboardWindowState(senderWindow || dashboardWindow);
  });
  ipcMain.handle('dashboard:close-app', () => {
    app.quit();
    return { status: 'success' };
  });
  ipcMain.handle('byok:get-secure-storage-status', () => {
    const byokState = readByokSecretState();
    if (byokState.secureStoragePrimed && !(byokSecretStore.get('secureStoragePrimed') === true)) {
      writeByokSecretState({
        ...byokState,
        secureStoragePrimed: true,
        secureStoragePrimedAt: byokState.secureStoragePrimedAt || Date.now(),
      });
    }
    return {
      status: 'success',
      secureStoragePrimed: byokState.secureStoragePrimed === true,
      secureStoragePrimedAt: Number(byokState.secureStoragePrimedAt || 0),
      secureStorageAvailable: getSafeStorageAvailabilityHint(),
    };
  });
  ipcMain.handle('byok:prime-secure-storage', () => {
    try {
      ensureSafeStorageAvailable('BYOK secure key storage');
      const probeCipher = safeStorage.encryptString('escribolt-byok-keychain-probe');
      safeStorage.decryptString(probeCipher);
      const byokState = readByokSecretState();
      byokState.secureStoragePrimed = true;
      byokState.secureStoragePrimedAt = Date.now();
      writeByokSecretState(byokState);
      return {
        status: 'success',
        secureStorageAvailable: true,
        secureStoragePrimed: true,
        secureStoragePrimedAt: byokState.secureStoragePrimedAt,
      };
    } catch (error) {
      return {
        status: 'error',
        secureStorageAvailable: false,
        message: error && error.message ? error.message : 'Secure key storage is unavailable on this device',
      };
    }
  });
  ipcMain.handle('byok:list-key-status', () => {
    return {
      status: 'success',
      secureStorageAvailable: isSafeStorageUsable(),
      providers: listByokKeyStatus(),
    };
  });
  ipcMain.handle('byok:set-key', (_event, payload = {}) => {
    const provider = typeof payload.provider === 'string' ? payload.provider : '';
    const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey : '';
    try {
      const entry = setByokApiKey(provider, apiKey);
      syncByokKeyMetadataIntoSettings(settings);
      settings.aiEngine = normalizeAiEngineRoutingSettings(
        settings.aiEngine,
        settings.mode,
        settings.aiEngine.apiKeys
      );
      persistSettings();
      return {
        status: 'success',
        provider,
        entry,
        providers: listByokKeyStatus(),
      };
    } catch (error) {
      return {
        status: 'error',
        provider,
        message: error && error.message ? error.message : 'Failed to save BYOK key',
      };
    }
  });
  ipcMain.handle('byok:clear-key', (_event, payload = {}) => {
    const provider = typeof payload.provider === 'string' ? payload.provider : '';
    try {
      const entry = clearByokApiKey(provider);
      syncByokKeyMetadataIntoSettings(settings);
      settings.aiEngine = normalizeAiEngineRoutingSettings(
        settings.aiEngine,
        settings.mode,
        settings.aiEngine.apiKeys
      );
      persistSettings();
      return {
        status: 'success',
        provider,
        entry,
        providers: listByokKeyStatus(),
      };
    } catch (error) {
      return {
        status: 'error',
        provider,
        message: error && error.message ? error.message : 'Failed to clear BYOK key',
      };
    }
  });
  ipcMain.handle('sync:run-now', async () => {
    syncBackoffUntil = 0;
    scheduleSyncRun(0);
    return { status: 'success' };
  });
  ipcMain.handle('sync:get-conflicts', () => {
    return {
      status: 'success',
      conflicts: getPendingSyncConflicts(),
    };
  });
  ipcMain.handle('sync:resolve-conflict', async (_event, payload = {}) => {
    const entityType = typeof payload.entityType === 'string' ? payload.entityType : '';
    const entityId = typeof payload.entityId === 'string' ? payload.entityId : '';
    const resolution = payload.resolution === 'client_wins' ? 'client_wins' : 'server_wins';

    if (!entityType || !entityId) {
      return { status: 'error', message: 'entityType and entityId are required' };
    }

    const conflict = getPendingSyncConflicts().find((item) => (
      item.entityType === entityType && item.entityId === entityId
    ));
    if (!conflict) {
      return { status: 'error', message: 'Conflict not found' };
    }

    try {
      await resolveSyncConflict(conflict, resolution);
      removePendingSyncConflict(entityType, entityId);
      emitSyncStatus({
        level: 'warning',
        code: 'SYNC_CONFLICT',
        message: `Conflict resolved (${resolution.replace('_', ' ')}) for ${entityType}.`,
      });
      scheduleSyncRun(300);
      return {
        status: 'success',
        entityType,
        entityId,
        resolution,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error && error.message ? error.message : 'Failed to resolve conflict',
      };
    }
  });
  ipcMain.handle('get-auth-state', () => getAuthState());
  ipcMain.handle('fetch-usage-summary', async () => {
    try {
      return await fetchCurrentUsageSummary();
    } catch (e) {
      return { error: e.message || 'Usage request failed' };
    }
  });
  ipcMain.handle('logout', () => {
    clearAuthJwt();
    switchToLocalProcessingAfterAuthLoss('logout');
    broadcastAuthState();
    return getAuthState();
  });
  ipcMain.handle('fetch-pro-temp-deepgram-key', async (_event, options = {}) => {
    try {
      const credential = await fetchProTemporaryDeepgramCredential({
        purpose: options.purpose || 'transcription',
        forceRefresh: !!options.forceRefresh,
      });
      return {
        status: 'success',
        provider: credential.provider,
        expiresAt: credential.expiresAt,
      };
    } catch (e) {
      return {
        status: 'error',
        message: e.message,
      };
    }
  });
  ipcMain.handle('recordings:get-all', () => {
    return {
      status: 'success',
      recordings: getSortedRecordings(),
      isAuthenticated: hasStoredAuthJwt(),
    };
  });
  ipcMain.handle('recordings:import-audio-file', async () => {
    try {
      const parentWindow = (dashboardWindow && !dashboardWindow.isDestroyed()) ? dashboardWindow : null;
      const pickerResult = await dialog.showOpenDialog(parentWindow || undefined, {
        title: 'Import Audio File',
        buttonLabel: 'Transcribe',
        properties: ['openFile'],
        filters: [
          {
            name: 'Audio',
            extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'webm', 'mp4'],
          },
          { name: 'All files', extensions: ['*'] },
        ],
      });

      if (!pickerResult || pickerResult.canceled || !Array.isArray(pickerResult.filePaths) || !pickerResult.filePaths[0]) {
        return { status: 'cancelled' };
      }

      const audioPath = pickerResult.filePaths[0];
      const transcription = await transcribeImportedAudioFile(audioPath);
      const transcriptText = String(transcription && transcription.text ? transcription.text : '').trim();
      if (!transcriptText) {
        return { status: 'error', message: 'No transcript text was produced for this file.' };
      }

      const fileStats = await fs.promises.stat(audioPath).catch(() => null);
      const durationMs = await probeAudioDurationMs(audioPath);
      const recording = addRecordingEntry({
        transcript: transcriptText,
        route: {
          ...(transcription.route || {}),
          source: 'file-upload',
        },
        stats: {
          chunkCount: 1,
          totalBytes: Number(fileStats && fileStats.size ? fileStats.size : 0),
          durationMs,
          source: 'file-upload',
          fileName: path.basename(audioPath),
        },
      });

      return {
        status: 'success',
        recording,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error && error.message ? error.message : 'Failed to import and transcribe audio file',
      };
    }
  });
  console.log('[escribolt-main-startup] recordings:import-audio-file handler registered');
  ipcMain.handle('recordings:update-metadata', (_event, payload = {}) => {
    const recordingId = payload.id;
    if (!recordingId || typeof recordingId !== 'string') {
      return { status: 'error', message: 'Recording id is required' };
    }
    const updated = updateRecordingMetadata(recordingId, payload);
    if (!updated) {
      return { status: 'error', message: 'Recording not found' };
    }
    return {
      status: 'success',
      recording: updated,
    };
  });
  ipcMain.handle('recordings:update-transcript', (_event, payload = {}) => {
    const recordingId = payload.id;
    if (!recordingId || typeof recordingId !== 'string') {
      return { status: 'error', message: 'Recording id is required' };
    }
    const updated = updateRecordingTranscript(recordingId, payload.transcript || '');
    if (!updated) {
      return { status: 'error', message: 'Recording not found' };
    }
    return { status: 'success', recording: updated };
  });
  ipcMain.handle('recordings:create-linked-note', (_event, payload = {}) => {
    const recordingId = payload.id;
    if (!recordingId || typeof recordingId !== 'string') {
      return { status: 'error', message: 'Recording id is required' };
    }
    const linked = createLinkedNoteFromRecording(recordingId);
    if (!linked) {
      return { status: 'error', message: 'Recording not found' };
    }
    return { status: 'success', ...linked };
  });
  ipcMain.handle('recordings:link-note', (_event, payload = {}) => {
    const recordingId = typeof payload.id === 'string' ? payload.id : '';
    const noteId = typeof payload.noteId === 'string' ? payload.noteId : '';
    if (!recordingId || !noteId) {
      return { status: 'error', message: 'Recording id and note id are required' };
    }
    const linked = linkRecordingToNote(recordingId, noteId);
    if (!linked) {
      return { status: 'error', message: 'Recording or note not found' };
    }
    return { status: 'success', ...linked };
  });
  ipcMain.handle('recordings:unlink-note', (_event, payload = {}) => {
    const recordingId = typeof payload.id === 'string' ? payload.id : '';
    if (!recordingId) {
      return { status: 'error', message: 'Recording id is required' };
    }
    const unlinked = unlinkRecordingFromNote(recordingId);
    if (!unlinked) {
      return { status: 'error', message: 'Recording not found' };
    }
    return { status: 'success', ...unlinked };
  });
  ipcMain.handle('recordings:delete', (_event, payload = {}) => {
    const recordingId = payload.id;
    if (!recordingId || typeof recordingId !== 'string') {
      return { status: 'error', message: 'Recording id is required' };
    }
    if (!deleteRecording(recordingId)) {
      return { status: 'error', message: 'Recording not found' };
    }
    return { status: 'success' };
  });
  ipcMain.handle('recordings:generate-summary', async (event, payload = {}) => {
    const recordingId = payload.id;
    const shouldStream = payload.stream === true;

    if (!recordingId || typeof recordingId !== 'string') {
      return { status: 'error', message: 'Recording id is required' };
    }
    const recording = recordingsData.recordings.find((entry) => entry.id === recordingId);
    if (!recording) {
      return { status: 'error', message: 'Recording not found' };
    }
    if (!recording.transcript || !recording.transcript.trim()) {
      return { status: 'error', message: 'Transcript is empty' };
    }

    try {
      let finalSummary = '';
      if (shouldStream) {
        finalSummary = await executeRecordingSummary({
          transcript: recording.transcript,
          onChunk: (chunk) => {
            if (dashboardWindow && !dashboardWindow.isDestroyed()) {
              dashboardWindow.webContents.send('recordings:summary-chunk', {
                recordingId,
                chunk,
              });
            }
          },
        });
      } else {
        finalSummary = await executeRecordingSummary({ transcript: recording.transcript });
      }

      const updated = updateRecordingSummary(recordingId, finalSummary);
      if (!updated) {
        return { status: 'error', message: 'Recording not found after summary generation' };
      }
      return {
        status: 'success',
        summary: finalSummary,
        recording: updated,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
      };
    }
  });

  ipcMain.handle('global-ask:send', async (_event, payload = {}) => {
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
    if (!prompt) {
      return { status: 'error', message: 'Prompt is required' };
    }

    const history = normalizeGlobalAskHistoryMessages(payload.history || []);
    const modelSelection = normalizeGlobalAskModelSelection(payload.modelSelection || {});
    const contextSelection = normalizeGlobalAskContextSelection(payload.contextSelection || {});
    const route = resolveGlobalAskRoute(modelSelection);
    const contextCharLimit = resolveGlobalAskContextCharLimit(route);
    const contextBundle = buildGlobalAskContextBundle({
      selection: contextSelection,
      contextCharLimit,
    });

    try {
      const response = await executeGlobalAsk({
        question: prompt,
        contextBundle,
        history,
        modelSelection,
        routeOverride: route,
      });
      return {
        status: 'success',
        text: response.text,
        route: response.route,
        selectedTextChars: response.selectedTextChars,
        context: {
          scopeLabel: contextBundle.scopeLabel,
          itemCount: contextBundle.itemCount,
          contextCharCount: contextBundle.contextCharCount,
          contextCharLimit,
          truncated: contextBundle.wasTruncated,
        },
      };
    } catch (error) {
      return {
        status: 'error',
        message: error && error.message ? error.message : 'Global Ask failed',
      };
    }
  });
  ipcMain.handle('pro:get-model-options', () => ({
    status: 'success',
    provider: PRO_LLM_PROVIDER_ID,
    defaultModelAlias: PRO_DEFAULT_LLM_MODEL_ALIAS,
    models: PRO_BRANDED_LLM_MODELS.map((entry) => ({
      id: entry.id,
      label: entry.label,
      helperText: entry.helperText || '',
      contextWindowTokens: entry.contextWindowTokens || null,
    })),
  }));
  ipcMain.handle('get-stt-routing-preview', (_event, options = {}) => getSttRoutingPreview(options));
  ipcMain.handle('runtime:local-stt-status', async () => {
    try {
      const status = await refreshLocalSttRuntimeStatus({ warmIfIdle: true });
      return { status: 'success', localStt: status };
    } catch (error) {
      return {
        status: 'error',
        localStt: localSttRuntimeStatus,
        message: error && error.message ? error.message : 'Local speech status is unavailable.',
      };
    }
  });
  ipcMain.handle('runtime:warm-local-stt', async () => {
    const status = await warmLocalSttRuntimeIfNeeded('renderer-request');
    return { status: status ? 'success' : 'skipped', localStt: status || localSttRuntimeStatus };
  });
  ipcMain.handle('get-llm-routing-preview', (_event, options = {}) => getLlmRoutingPreview(options));
  ipcMain.handle('update-ui-settings', (_event, patch = {}) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'mode') && ['local', 'byok', 'pro'].includes(patch.mode)) {
      if (patch.mode === 'pro' && !getAuthState().isLoggedIn) {
        settings.mode = 'local';
        settings.syncSettings = {
          ...(settings.syncSettings || {}),
          autoSyncEnabled: true,
        };
      } else {
        settings.mode = patch.mode;
        if (settings.mode === 'pro') {
          settings.aiEngine.sttProvider = 'deepgram';
          settings.aiEngine.llmProvider = PRO_LLM_PROVIDER_ID;
          settings.aiEngine.summaryProvider = PRO_LLM_PROVIDER_ID;
          settings.aiEngine.llmModel = normalizeProLlmModelAlias(settings.aiEngine.llmModel);
          settings.aiEngine.summaryModel = normalizeProLlmModelAlias(settings.aiEngine.summaryModel);
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'theme') && THEMES.some((theme) => theme.id === patch.theme)) {
      selectedTheme = patch.theme;
      settings.theme = patch.theme;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('set-theme', patch.theme);
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'launchAtLogin')) {
      settings.launchAtLogin = !!patch.launchAtLogin;
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'quickNotePopupEnabled')) {
      settings.quickNotePopupEnabled = !!patch.quickNotePopupEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'meetingPromptConsentGranted')) {
      settings.meetingPromptConsentGranted = !!patch.meetingPromptConsentGranted;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'meetingPromptEnabled')) {
      const enabled = !!patch.meetingPromptEnabled;
      settings.meetingPromptEnabled = enabled && settings.meetingPromptConsentGranted === true;
      if (!enabled) {
        settings.meetingPromptConsentGranted = false;
      }
      if (settings.meetingPromptEnabled) {
        meetingPromptDetectionDisabled = false;
      }
      applyMeetingPromptWatcherState();
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'stickyNoteDefaultPlacement')
      && STICKY_NOTE_DEFAULT_PLACEMENT_SET.has(patch.stickyNoteDefaultPlacement)) {
      settings.stickyNoteDefaultPlacement = patch.stickyNoteDefaultPlacement;
      lastStickyWindowBounds = null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'stickyNoteDefaultColorId')
      && STICKY_NOTE_COLOR_ID_SET.has(patch.stickyNoteDefaultColorId)) {
      settings.stickyNoteDefaultColorId = patch.stickyNoteDefaultColorId;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'onboardingCompleted')) {
      const wasCompleted = settings.onboardingCompleted;
      settings.onboardingCompleted = !!patch.onboardingCompleted;
      if (settings.onboardingCompleted && !wasCompleted) {
        applyMeetingPromptWatcherState();
        applyVoiceShortcutsWithRollback({ persistRollback: true });
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'productTourVersionSeen')) {
      const versionSeen = Number(patch.productTourVersionSeen);
      if (Number.isFinite(versionSeen)) {
        settings.productTourVersionSeen = Math.max(0, Math.floor(versionSeen));
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'recordingCaptureMode') && ['system-only', 'all-audio'].includes(patch.recordingCaptureMode)) {
      settings.recordingCaptureMode = patch.recordingCaptureMode;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'recordingSummaryLanguage')) {
      settings.recordingSummaryLanguage = normalizeRecordingSummaryLanguageCode(patch.recordingSummaryLanguage);
    }
    if (patch.processingModes && typeof patch.processingModes === 'object') {
      const nextProcessingModes = buildProcessingModePatch(
        patch.processingModes,
        settings.processingModes || PROCESSING_MODE_DEFAULTS,
      );
      settings.processingModes = nextProcessingModes;
    }
    if (patch.layout && typeof patch.layout === 'object') {
      settings.layout = {
        ...(settings.layout || DEFAULT_SETTINGS.layout),
      };
      if (Object.prototype.hasOwnProperty.call(patch.layout, 'sidebarCollapsed')) {
        settings.layout.sidebarCollapsed = !!patch.layout.sidebarCollapsed;
      }
      if (Object.prototype.hasOwnProperty.call(patch.layout, 'sidebarWidth')) {
        const sidebarWidth = Number(patch.layout.sidebarWidth);
        if (Number.isFinite(sidebarWidth)) {
          settings.layout.sidebarWidth = Math.max(
            SIDEBAR_WIDTH_MIN,
            Math.min(SIDEBAR_WIDTH_MAX, Math.floor(sidebarWidth)),
          );
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch.layout, 'notesExpanded')) {
        settings.layout.notesExpanded = !!patch.layout.notesExpanded;
      }
      if (Object.prototype.hasOwnProperty.call(patch.layout, 'pinnedExpanded')) {
        settings.layout.pinnedExpanded = !!patch.layout.pinnedExpanded;
      }
      if (Object.prototype.hasOwnProperty.call(patch.layout, 'recordingsExpanded')) {
        settings.layout.recordingsExpanded = !!patch.layout.recordingsExpanded;
      }
      if (Object.prototype.hasOwnProperty.call(patch.layout, 'recentExpanded')) {
        settings.layout.recentExpanded = !!patch.layout.recentExpanded;
      }
      if (Object.prototype.hasOwnProperty.call(patch.layout, 'chatsExpanded')) {
        settings.layout.chatsExpanded = !!patch.layout.chatsExpanded;
      }
      if (Object.prototype.hasOwnProperty.call(patch.layout, 'spacesExpanded')) {
        settings.layout.spacesExpanded = !!patch.layout.spacesExpanded;
      }
      if (Object.prototype.hasOwnProperty.call(patch.layout, 'pinnedSidebarItems')) {
        settings.layout.pinnedSidebarItems = normalizePinnedSidebarItems(patch.layout.pinnedSidebarItems);
        persistSidebarPinnedItems(settings.layout.pinnedSidebarItems);
      }
    }
    if (patch.syncSettings && typeof patch.syncSettings === 'object') {
      const nextSyncSettings = {
        ...settings.syncSettings,
      };
      if (Object.prototype.hasOwnProperty.call(patch.syncSettings, 'autoSyncEnabled')) {
        nextSyncSettings.autoSyncEnabled = true;
      }
      if (Object.prototype.hasOwnProperty.call(patch.syncSettings, 'intervalMs')) {
        const rawInterval = Number(patch.syncSettings.intervalMs);
        if (Number.isFinite(rawInterval)) {
          nextSyncSettings.intervalMs = Math.max(
            SYNC_INTERVAL_MIN_MS,
            Math.min(SYNC_INTERVAL_MAX_MS, Math.floor(rawInterval)),
          );
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch.syncSettings, 'strictPrivacyMode')) {
        nextSyncSettings.strictPrivacyMode = !!patch.syncSettings.strictPrivacyMode;
      }
      nextSyncSettings.autoSyncEnabled = true;
      settings.syncSettings = nextSyncSettings;
      configureSyncInterval();
      scheduleSyncRun(500);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'model') && MODELS.some((model) => model.id === patch.model)) {
      selectedModel = patch.model;
      settings.model = patch.model;
      const modelDef = MODELS.find((model) => model.id === patch.model);
      if (modelDef) {
        postToBackendVoid('/set_model', { model_path: modelDef.path });
      }
    }
    if (patch.shortcuts && typeof patch.shortcuts === 'object') {
      settings.shortcuts = normalizeShortcutSettings({
        ...(settings.shortcuts || SHORTCUT_DEFAULTS),
        ...patch.shortcuts,
      });
      applyVoiceShortcutsWithRollback({ persistRollback: false });
    }

    if (patch.aiEngine && typeof patch.aiEngine === 'object') {
      const nextAiEngine = {
        ...settings.aiEngine,
        apiKeys: {
          ...listByokKeyStatus(),
        },
      };

      if (Object.prototype.hasOwnProperty.call(patch.aiEngine, 'sttProvider')
        && ['deepgram', 'openai', 'groq'].includes(patch.aiEngine.sttProvider)) {
        nextAiEngine.sttProvider = patch.aiEngine.sttProvider;
      }
      if (Object.prototype.hasOwnProperty.call(patch.aiEngine, 'llmProvider')) {
        const normalizedProvider = normalizeLlmProviderId(patch.aiEngine.llmProvider);
        if (LLM_PROVIDER_ENUM.includes(normalizedProvider)) {
          nextAiEngine.llmProvider = normalizedProvider;
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch.aiEngine, 'summaryProvider')) {
        const normalizedProvider = normalizeLlmProviderId(patch.aiEngine.summaryProvider);
        if (LLM_PROVIDER_ENUM.includes(normalizedProvider)) {
          nextAiEngine.summaryProvider = normalizedProvider;
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch.aiEngine, 'llmModel')) {
        nextAiEngine.llmModel = typeof patch.aiEngine.llmModel === 'string'
          ? patch.aiEngine.llmModel
          : nextAiEngine.llmModel;
      }
      if (Object.prototype.hasOwnProperty.call(patch.aiEngine, 'summaryModel')) {
        nextAiEngine.summaryModel = typeof patch.aiEngine.summaryModel === 'string'
          ? patch.aiEngine.summaryModel
          : nextAiEngine.summaryModel;
      }
      if (Object.prototype.hasOwnProperty.call(patch.aiEngine, 'sttTranscriptionMode')
        && ['streaming', 'prerecorded'].includes(patch.aiEngine.sttTranscriptionMode)) {
        nextAiEngine.sttTranscriptionMode = patch.aiEngine.sttTranscriptionMode;
      }
      if (Object.prototype.hasOwnProperty.call(patch.aiEngine, 'sttStreamingProfile')) {
        nextAiEngine.sttStreamingProfile = normalizeSttStreamingProfile(patch.aiEngine.sttStreamingProfile);
      }
      if (Object.prototype.hasOwnProperty.call(patch.aiEngine, 'sttNova3Language')) {
        const normalizedLanguage = normalizeNova3LanguageCode(patch.aiEngine.sttNova3Language);
        nextAiEngine.sttNova3Language = normalizedLanguage || nextAiEngine.sttNova3Language || resolveDefaultNova3Language();
      }
      if (Object.prototype.hasOwnProperty.call(patch.aiEngine, 'localSttLanguageMode')) {
        nextAiEngine.localSttLanguageMode = normalizeLocalSttLanguageMode(patch.aiEngine.localSttLanguageMode);
      }
      if (Object.prototype.hasOwnProperty.call(patch.aiEngine, 'localSttLanguage')) {
        const normalizedLanguage = normalizeNova3LanguageCode(patch.aiEngine.localSttLanguage);
        nextAiEngine.localSttLanguage = normalizedLanguage || nextAiEngine.localSttLanguage || nextAiEngine.sttNova3Language || resolveDefaultNova3Language();
      }
      if (Object.prototype.hasOwnProperty.call(patch.aiEngine, 'sttKeyterms')) {
        nextAiEngine.sttKeyterms = normalizeSttKeyterms(patch.aiEngine.sttKeyterms);
      }
      if (Object.prototype.hasOwnProperty.call(patch.aiEngine, 'sttFluxKeyterms')) {
        nextAiEngine.sttFluxKeyterms = normalizeSttKeyterms(patch.aiEngine.sttFluxKeyterms);
        if (!Object.prototype.hasOwnProperty.call(patch.aiEngine, 'sttKeyterms')) {
          nextAiEngine.sttKeyterms = normalizeSttKeyterms(patch.aiEngine.sttFluxKeyterms);
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch.aiEngine, 'sttFluxLanguageHints')) {
        nextAiEngine.sttFluxLanguageHints = normalizeLegacyFluxLanguageHints(patch.aiEngine.sttFluxLanguageHints);
      }
      if (settings.mode === 'pro') {
        // PRO providers are fixed server-side and mirrored here for consistency.
        nextAiEngine.sttProvider = 'deepgram';
        nextAiEngine.llmProvider = PRO_LLM_PROVIDER_ID;
        nextAiEngine.summaryProvider = PRO_LLM_PROVIDER_ID;
      }

      settings.aiEngine = normalizeAiEngineRoutingSettings(
        nextAiEngine,
        settings.mode,
        nextAiEngine.apiKeys
      );
    }

    settings.aiEngine = normalizeAiEngineRoutingSettings(
      settings.aiEngine,
      settings.mode,
      listByokKeyStatus()
    );

    configureSyncInterval();
    if (shouldRunSync()) {
      scheduleSyncRun(500);
    }
    persistSettings();
    syncRecordModeWidget(trayRecordModeStatus);
    const latestUiSettings = getUiSettings();
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send('ui-settings-updated', latestUiSettings);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ui-settings-updated', latestUiSettings);
    }
    if (isCurrentSttRouteLocal()) {
      warmLocalSttRuntimeIfNeeded('settings-update');
    }
    return latestUiSettings;
  });

  // --- IPC: Chats Manager Data ---
  ipcMain.handle('get-chats-data', () => {
    return chatsData;
  });

  ipcMain.on('save-chat', (e, chatSessionInput) => {
    if (!chatSessionInput || !chatSessionInput.id) return;
    const idx = chatsData.chats.findIndex(c => c.id === chatSessionInput.id);
    const now = Date.now();
    const existingChat = idx !== -1 ? chatsData.chats[idx] : null;
    const availableFolderIds = new Set((notesData.folders || []).map((folder) => folder.id));
    const folderCandidate = Object.prototype.hasOwnProperty.call(chatSessionInput, 'folderId')
      ? chatSessionInput.folderId
      : (existingChat ? existingChat.folderId : '');
    const normalizedFolderId = normalizeNoteFolderId(folderCandidate, availableFolderIds);
    const requestedCloudSync = typeof chatSessionInput.isCloudSynced === 'boolean'
      ? chatSessionInput.isCloudSynced
      : Boolean(existingChat && existingChat.isCloudSynced);
    const isCloudSynced = hasStoredAuthJwt() && requestedCloudSync;
    const existingVersion = Number.parseInt(existingChat && existingChat.version, 10) || 1;
    const chatSession = normalizeChatEntry({
      id: chatSessionInput.id,
      title: chatSessionInput.title || 'Untitled Chat',
      messages: chatSessionInput.messages || [],
      isCloudSynced,
      syncStatus: isCloudSynced ? 'pending' : 'synced',
      createdAt: (existingChat && existingChat.createdAt) || chatSessionInput.createdAt || now,
      updatedAt: now,
      version: idx !== -1 ? existingVersion + 1 : 1,
      folderId: normalizedFolderId,
      contextOptionIds: chatSessionInput.contextOptionIds || [],
    });
    if (idx !== -1) {
      chatsData.chats[idx] = chatSession;
    } else {
      chatsData.chats.push(chatSession);
    }
    persistChatsData();
  });

  ipcMain.on('delete-chat', (e, chatId) => {
    if (!chatId) return;
    const existing = chatsData.chats.find(c => c.id === chatId);
    if (existing && existing.isCloudSynced) {
      addPendingDelete('chats', {
        id: existing.id,
        updatedAt: Date.now(),
        version: (Number.parseInt(existing.version, 10) || 1) + 1,
      });
    }
    chatsData.chats = chatsData.chats.filter(c => c.id !== chatId);
    persistChatsData();
  });

  // --- IPC: Notes Manager Data ---
  ipcMain.handle('get-notes-data', () => ({
    ...notesData,
    isAuthenticated: hasStoredAuthJwt(),
  }));

  ipcMain.on('create-folder', (e, payload) => {
    const nextName = typeof payload === 'string'
      ? payload.trim()
      : (typeof payload?.name === 'string' ? payload.name.trim() : '');
    if (!nextName) return;
    const requestedParentId = typeof payload === 'string'
      ? ''
      : (typeof payload?.parentId === 'string' ? payload.parentId.trim() : '');
    const existingFolderIds = new Set((notesData.folders || []).map((folder) => folder.id));
    const parentId = requestedParentId && existingFolderIds.has(requestedParentId) ? requestedParentId : '';
    const now = Date.now();
    const shouldCloudSync = hasStoredAuthJwt() && !isStrictPrivacyModeEnabled();
    const newFolder = normalizeFolderEntry({
      id: crypto.randomUUID(),
      name: nextName,
      parentId,
      createdAt: now,
      updatedAt: now,
      version: 1,
      isCloudSynced: shouldCloudSync,
      syncStatus: shouldCloudSync ? 'pending' : 'synced',
    });
    if (!newFolder) return;
    notesData.folders.push(newFolder);
    persistNotesData();
  });

  ipcMain.on('rename-folder', (e, payload) => {
    const folderId = typeof payload?.id === 'string' ? payload.id : '';
    if (!folderId) return;

    const folderIndex = notesData.folders.findIndex((folder) => folder.id === folderId);
    if (folderIndex === -1) return;

    const current = normalizeFolderEntry(notesData.folders[folderIndex]);
    if (!current) return;
    const updated = { ...current };
    if (typeof payload.name === 'string') {
      const trimmed = payload.name.trim();
      if (trimmed) {
        updated.name = trimmed;
      }
    }
    if (typeof payload.iconId === 'string') {
      updated.iconId = payload.iconId;
    }
    if (typeof payload.colorId === 'string') {
      updated.colorId = payload.colorId;
    }
    notesData.folders[folderIndex] = normalizeFolderEntry({
      ...updated,
      updatedAt: Date.now(),
      version: current.isCloudSynced
        ? (Number.parseInt(current.version, 10) || 1) + 1
        : (Number.parseInt(current.version, 10) || 1),
      syncStatus: current.isCloudSynced ? 'pending' : current.syncStatus,
    });
    persistNotesData();
  });

  ipcMain.on('delete-folder', (e, folderId) => {
    const normalizedFolderId = typeof folderId === 'string' ? folderId.trim() : '';
    if (!normalizedFolderId) return;
    const folderToDelete = notesData.folders.find((folder) => folder.id === normalizedFolderId);
    if (!folderToDelete) return;
    const normalizedFolderToDelete = normalizeFolderEntry(folderToDelete);
    if (normalizedFolderToDelete && normalizedFolderToDelete.isCloudSynced) {
      addPendingDelete('folders', {
        id: normalizedFolderToDelete.id,
        updatedAt: Date.now(),
        version: (Number.parseInt(normalizedFolderToDelete.version, 10) || 1) + 1,
      });
    }
    const parentForChildren = typeof folderToDelete.parentId === 'string' ? folderToDelete.parentId : '';
    notesData.folders = notesData.folders
      .filter((folder) => folder.id !== normalizedFolderId)
      .map((folder) => {
        if (folder.parentId !== normalizedFolderId) return folder;
        const normalizedChild = normalizeFolderEntry(folder);
        if (!normalizedChild) return folder;
        return normalizeFolderEntry({
          ...normalizedChild,
          parentId: parentForChildren,
          updatedAt: Date.now(),
          version: normalizedChild.isCloudSynced
            ? (Number.parseInt(normalizedChild.version, 10) || 1) + 1
            : (Number.parseInt(normalizedChild.version, 10) || 1),
          syncStatus: normalizedChild.isCloudSynced ? 'pending' : normalizedChild.syncStatus,
        });
      });
    notesData.notes = notesData.notes.map((n) => {
      if (n.folderId !== normalizedFolderId) return n;
      return normalizeNoteEntry({
        ...n,
        folderId: '',
        lastModified: Date.now(),
        updatedAt: Date.now(),
        version: (Number.parseInt(n.version, 10) || 1) + 1,
      });
    });
    recordingsData.recordings = recordingsData.recordings.map((entry) => {
      const normalized = normalizeRecordingEntry(entry);
      if (String(normalized.folderId || '') !== normalizedFolderId) return normalized;
      return normalizeRecordingEntry({
        ...normalized,
        folderId: '',
        updatedAt: Date.now(),
        syncStatus: normalized.isCloudSynced ? 'pending' : normalized.syncStatus,
        version: (Number.parseInt(normalized.version, 10) || 1) + 1,
      });
    });
    chatsData.chats = chatsData.chats.map((entry) => {
      const normalized = normalizeChatEntry(entry);
      if (String(normalized.folderId || '') !== normalizedFolderId) return normalized;
      return normalizeChatEntry({
        ...normalized,
        folderId: '',
        updatedAt: Date.now(),
        syncStatus: normalized.isCloudSynced ? 'pending' : normalized.syncStatus,
        version: normalized.isCloudSynced
          ? (Number.parseInt(normalized.version, 10) || 1) + 1
          : (Number.parseInt(normalized.version, 10) || 1),
      });
    });
    persistNotesData();
    persistRecordingsData();
    persistChatsData();
  });

  ipcMain.on('delete-note', (e, noteId) => {
    const existing = notesData.notes.find((n) => n.id === noteId);
    if (existing && existing.isCloudSynced) {
      addPendingDelete('notes', {
        id: existing.id,
        updatedAt: Date.now(),
        version: (Number.parseInt(existing.version, 10) || 1) + 1,
      });
    }

    // Explicitly delete note from DB
    notesData.notes = notesData.notes.filter(n => n.id !== noteId);
    recordingsData.recordings = recordingsData.recordings.map((entry) => {
      const normalized = normalizeRecordingEntry(entry);
      if (normalized.linkedNoteId !== noteId) {
        return normalized;
      }
      return normalizeRecordingEntry({
        ...normalized,
        linkedNoteId: null,
        updatedAt: Date.now(),
        syncStatus: normalized.isCloudSynced ? 'pending' : normalized.syncStatus,
        version: (Number.parseInt(normalized.version, 10) || 1) + 1,
      });
    });
    persistNotesData();
    persistRecordingsData();

    // Close sticky window if open
    const win = stickyWindows.get(noteId);
    if (win && !win.isDestroyed()) win.close();

  });

  ipcMain.on('open-sticky-note', (e, note) => {
    createStickyWindow(note);
  });

  // IPC: Sticky Notes Edit
  ipcMain.on('save-note', (e, noteDataInput) => {
    const { didMutate, updatedNote } = saveNoteDataFromInput(noteDataInput);

    // Broadcast back to Manager if open
    // Broadcast back to Sticky window if update came from Manager
    // Use the sender id to avoid echoing
    const noteId = noteDataInput && typeof noteDataInput.id === 'string' ? noteDataInput.id : '';
    const win = noteId ? stickyWindows.get(noteId) : null;
    if (didMutate && win && !win.isDestroyed() && e.sender.id !== win.webContents.id) {
      win.webContents.send('load-note', updatedNote);
    }
  });

  ipcMain.on('sticky-ready', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return;
    }

    let senderNoteId = null;
    for (const [noteId, noteWindow] of stickyWindows.entries()) {
      if (noteWindow && !noteWindow.isDestroyed() && noteWindow.webContents.id === event.sender.id) {
        senderNoteId = noteId;
        break;
      }
    }

    if (!senderNoteId) {
      return;
    }

    const note = notesData.notes.find((candidate) => candidate.id === senderNoteId);
    if (note) {
      senderWindow.webContents.send('load-note', note);
    }
  });

  ipcMain.on('close-note', (e, noteId) => {
    // Just close the sticky window, do NOT delete from DB
    const safeNoteId = typeof noteId === 'string' ? noteId : '';
    const win = safeNoteId ? stickyWindows.get(safeNoteId) : null;
    if (win && !win.isDestroyed()) {
      win.close();
      return;
    }

    const senderWindow = BrowserWindow.fromWebContents(e.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      senderWindow.close();
    }
  });

  ipcMain.on('focus-note', (e, noteId) => { activeNoteId = noteId; });
  ipcMain.on('blur-note', (e, noteId) => { if (activeNoteId === noteId) activeNoteId = null; });

  // --- IPC: Export ---

  const escapeHtmlForNoteExport = (str) => String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const renderInlineMarkdownForNoteExport = (str) => escapeHtmlForNoteExport(str)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  const markdownToHtmlForNoteExport = (md) => {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let inList = false;
    let inQuote = false;
    for (const line of lines) {
      const quoteLine = line.match(/^>\s?(.*)$/);
      if (quoteLine) {
        if (inList) { out.push('</ul>'); inList = false; }
        if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
        out.push(`<p>${renderInlineMarkdownForNoteExport(quoteLine[1])}</p>`);
        continue;
      }
      if (inQuote) { out.push('</blockquote>'); inQuote = false; }

      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        if (inList) { out.push('</ul>'); inList = false; }
        const level = Math.min(heading[1].length, 3);
        out.push(`<h${level}>${renderInlineMarkdownForNoteExport(heading[2])}</h${level}>`);
        continue;
      }
      const taskItem = line.match(/^[-*+]\s+\[( |x|X)\]\s+(.*)$/);
      if (taskItem) {
        if (!inList) { out.push('<ul>'); inList = true; }
        const checked = taskItem[1].toLowerCase() === 'x';
        out.push(`<li><input type="checkbox" ${checked ? 'checked ' : ''}disabled> ${renderInlineMarkdownForNoteExport(taskItem[2])}</li>`);
        continue;
      }
      const listItem = line.match(/^[-*+]\s+(.*)$/);
      if (listItem) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push(`<li>${renderInlineMarkdownForNoteExport(listItem[1])}</li>`);
        continue;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      if (line.trim() === '') {
        out.push('<br/>');
        continue;
      }
      out.push(`<p>${renderInlineMarkdownForNoteExport(line)}</p>`);
    }
    if (inQuote) out.push('</blockquote>');
    if (inList) out.push('</ul>');
    return out.join('\n');
  };

  const buildNoteHtmlDocument = (title, htmlBody) => {
    const safeTitle = escapeHtmlForNoteExport(title || 'Untitled Note');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      padding: 36px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1f2937;
      background: #ffffff;
      line-height: 1.55;
      word-break: break-word;
    }
    article {
      max-width: 760px;
      margin: 0 auto;
    }
    h1, h2, h3 { line-height: 1.25; margin-top: 1.1em; margin-bottom: 0.35em; }
    h1 { margin-top: 0; font-size: 1.8rem; }
    p, ul, blockquote, pre { margin: 0.5em 0; }
    ul { padding-left: 1.35em; }
    blockquote {
      margin: 0.8em 0;
      padding-left: 0.8em;
      border-left: 3px solid #d1d5db;
      color: #4b5563;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 0.92em;
      background: #f3f4f6;
      padding: 0.1em 0.3em;
      border-radius: 4px;
    }
    input[type="checkbox"] {
      vertical-align: middle;
      margin-right: 0.35em;
    }
  </style>
</head>
<body>
  <article>
    <h1>${safeTitle}</h1>
${htmlBody}
  </article>
</body>
</html>`;
  };

  /** Export a note to a .md file via save dialog */
  ipcMain.handle('export-note-markdown', async (_event, payload = {}) => {
    const title = String(payload.title || 'Untitled Note').trim();
    const text = String(payload.text || '');
    const safeName = title.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80) || 'note';

    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('documents'), `${safeName}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return { success: false };

    const mdContent = `# ${title}\n\n${text}\n`;
    fs.writeFileSync(filePath, mdContent, 'utf-8');
    return { success: true, filePath };
  });

  /** Export a note to a .html file via save dialog */
  ipcMain.handle('export-note-html', async (_event, payload = {}) => {
    const title = String(payload.title || 'Untitled Note').trim();
    const text = String(payload.text || '');
    const safeName = title.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80) || 'note';

    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('documents'), `${safeName}.html`),
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (canceled || !filePath) return { success: false };

    const htmlBody = markdownToHtmlForNoteExport(text);
    const htmlDocument = buildNoteHtmlDocument(title, htmlBody);
    fs.writeFileSync(filePath, htmlDocument, 'utf-8');
    return { success: true, filePath };
  });

  /** Export a note to a .pdf file via save dialog */
  ipcMain.handle('export-note-pdf', async (_event, payload = {}) => {
    const title = String(payload.title || 'Untitled Note').trim();
    const text = String(payload.text || '');
    const safeName = title.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80) || 'note';

    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('documents'), `${safeName}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { success: false };

    let pdfWindow = null;
    try {
      const htmlBody = markdownToHtmlForNoteExport(text);
      const htmlDocument = buildNoteHtmlDocument(title, htmlBody);
      pdfWindow = new BrowserWindow({
        show: false,
        width: 900,
        height: 1200,
      });

      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlDocument)}`);
      const pdfBuffer = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
      });
      fs.writeFileSync(filePath, pdfBuffer);
      return { success: true, filePath };
    } catch (error) {
      console.error('[export-note-pdf] failed:', error.message);
      return { success: false, error: error.message };
    } finally {
      if (pdfWindow && !pdfWindow.isDestroyed()) {
        pdfWindow.close();
      }
    }
  });

  /** Export a note to Apple Notes via osascript */
  ipcMain.handle('export-note-apple-notes', async (_event, payload = {}) => {
    const title = String(payload.title || 'Untitled Note').trim();
    const text = String(payload.text || '');

    const htmlBody = markdownToHtmlForNoteExport(text);

    // Escape for AppleScript
    const escapeAS = (str) => str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const script = [
      'tell application "Notes"',
      '  activate',
      `  set newNote to make new note at folder "Notes" with properties {name:"${escapeAS(title)}", body:"${escapeAS(htmlBody)}"}`,
      'end tell',
    ].join('\n');

    try {
      execSync(`osascript -e '${script.replace(/'/g, "'\\''")}' 2>&1`, { timeout: 10000 });
      return { success: true };
    } catch (err) {
      console.error('[export-note-apple-notes] osascript error:', err.message);
      return { success: false, error: err.message };
    }
  });

  /** Export a recording (transcript + summary) to a .md file */
  ipcMain.handle('export-recording-markdown', async (_event, payload = {}) => {
    const recId = String(payload.id || '');
    const rec = Array.isArray(recordingsData) ? recordingsData.find(r => r.id === recId) : null;
    if (!rec) return { success: false, error: 'Recording not found' };

    const title = String(rec.title || 'Untitled Recording').trim();
    const transcript = String(rec.transcript || '');
    const summary = String(rec.summary || '');
    const createdAt = rec.createdAt ? new Date(rec.createdAt).toLocaleString() : 'Unknown';
    const safeName = title.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80) || 'recording';

    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('documents'), `${safeName}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return { success: false };

    const parts = [`# ${title}`, `*${createdAt}*`, ''];
    if (summary) {
      parts.push('## Summary', '', summary, '');
    }
    if (transcript) {
      parts.push('## Transcript', '', transcript, '');
    }
    fs.writeFileSync(filePath, parts.join('\n'), 'utf-8');
    return { success: true, filePath };
  });

  /** Export a recording (transcript + summary) to Apple Notes */
  ipcMain.handle('export-recording-apple-notes', async (_event, payload = {}) => {
    const recId = String(payload.id || '');
    const rec = Array.isArray(recordingsData) ? recordingsData.find(r => r.id === recId) : null;
    if (!rec) return { success: false, error: 'Recording not found' };

    const title = String(rec.title || 'Untitled Recording').trim();
    const transcript = String(rec.transcript || '');
    const summary = String(rec.summary || '');
    const createdAt = rec.createdAt ? new Date(rec.createdAt).toLocaleString() : 'Unknown';

    let body = `${createdAt}\n\n`;
    if (summary) body += `Summary:\n${summary}\n\n`;
    if (transcript) body += `Transcript:\n${transcript}\n`;

    const escapeAS = (str) => str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const script = [
      'tell application "Notes"',
      '  activate',
      `  set newNote to make new note at folder "Notes" with properties {name:"${escapeAS(title)}", body:"${escapeAS(body)}"}`,
      'end tell',
    ].join('\n');

    try {
      execSync(`osascript -e '${script.replace(/'/g, "'\\''")}' 2>&1`, { timeout: 10000 });
      return { success: true };
    } catch (err) {
      console.error('[export-recording-apple-notes] osascript error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.on('window-move', (e, { x, y }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const roundedX = Math.round(Number(x));
    const roundedY = Math.round(Number(y));
    if (!win || !Number.isFinite(roundedX) || !Number.isFinite(roundedY)) {
      return;
    }

    if (win === mainWindow) {
      const clampedBounds = clampMainWidgetBoundsToVisibleWorkArea({
        ...win.getBounds(),
        x: roundedX,
        y: roundedY,
      });
      win.setPosition(clampedBounds.x, clampedBounds.y);
      return;
    }

    if (getStickyNoteIdForWindow(win)) {
      const clampedBounds = clampStickyBoundsToDisplayLayout({
        ...win.getBounds(),
        x: roundedX,
        y: roundedY,
      });
      win.setPosition(clampedBounds.x, clampedBounds.y);
      rememberStickyWindowBounds(win);
      return;
    }

    win.setPosition(roundedX, roundedY);
  });
});

app.on('will-quit', () => {
  stopPythonBackend();
  if (syncIntervalHandle) {
    clearInterval(syncIntervalHandle);
    syncIntervalHandle = null;
  }
  if (syncRunTimeout) {
    clearTimeout(syncRunTimeout);
    syncRunTimeout = null;
  }
  if (updatesCheckInterval) {
    clearInterval(updatesCheckInterval);
    updatesCheckInterval = null;
  }
  stopMeetingPromptWatcher({ hidePrompt: false });
  recordModeSessions.forEach((session, sessionId) => {
    abortRecordModeSession(sessionId).catch((error) => {
      console.error(`[record-mode] Failed to abort session ${sessionId} during shutdown:`, error.message);
    });
  });
  if (companionCliServerSocketPath && fs.existsSync(companionCliServerSocketPath)) {
    try {
      fs.unlinkSync(companionCliServerSocketPath);
    } catch (_err) {}
  }
  stopFnKeyHelper();
  resetFnShortcutState();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
