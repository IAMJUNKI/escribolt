const GOOGLE_MEET_CODE_PATTERN = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i;
const ZOOM_MEETING_ID_PATTERN = /^\d{9,12}$/;
const PROMPT_STABILITY_MS = 5000;
const PROMPT_VANISH_MS = 6000;
const PROVIDER_CONFIGS = {
  'google-meet': {
    providerLabel: 'Google Meet',
    fallbackTitle: 'Google Meet',
  },
  teams: {
    providerLabel: 'Microsoft Teams',
    fallbackTitle: 'Microsoft Teams meeting',
  },
  zoom: {
    providerLabel: 'Zoom',
    fallbackTitle: 'Zoom meeting',
  },
};

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKeyPart(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function parseUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch (_error) {
    return null;
  }
}

function getGoogleMeetId(parsed) {
  if (!parsed || parsed.hostname !== 'meet.google.com') return '';
  const segments = parsed.pathname.split('/').map((part) => part.trim()).filter(Boolean);
  const first = segments[0] || '';
  if (GOOGLE_MEET_CODE_PATTERN.test(first)) return first.toLowerCase();
  if (first === 'lookup' && segments[1]) return `lookup-${normalizeKeyPart(segments[1])}`;
  if (segments.length && !['about', 'new', 'settings', 'signin', 'unsupported'].includes(first)) {
    return normalizeKeyPart(parsed.pathname + parsed.search);
  }
  return '';
}

function getGoogleMeetIdFromTitle(title) {
  const match = normalizeText(title).match(/\b([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i);
  return match && match[1] ? match[1].toLowerCase() : '';
}

function getTeamsMeetingId(parsed) {
  if (!parsed) return '';
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith('teams.microsoft.com') && host !== 'teams.live.com') return '';
  const combined = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  const lowered = combined.toLowerCase();
  const looksLikeMeeting = lowered.includes('/l/meetup-join/')
    || lowered.includes('meetingjoin')
    || lowered.includes('meetup-join')
    || lowered.includes('/meet/')
    || lowered.includes('/join/')
    || lowered.includes('confid=')
    || lowered.includes('threadid=');
  if (!looksLikeMeeting) return '';

  const meetupMatch = parsed.pathname.match(/\/l\/meetup-join\/([^/?#]+)/i);
  if (meetupMatch && meetupMatch[1]) return normalizeKeyPart(decodeURIComponent(meetupMatch[1]));
  const meetingId = parsed.searchParams.get('meetingId')
    || parsed.searchParams.get('confId')
    || parsed.searchParams.get('threadId')
    || parsed.searchParams.get('conversationId');
  if (meetingId) return normalizeKeyPart(meetingId);
  return normalizeKeyPart(combined);
}

function getZoomMeetingId(parsed) {
  if (!parsed) return '';
  const host = parsed.hostname.toLowerCase();
  const isZoomHost = host === 'zoom.us'
    || host.endsWith('.zoom.us')
    || host === 'zoomgov.com'
    || host.endsWith('.zoomgov.com');
  if (!isZoomHost) return '';

  const segments = parsed.pathname.split('/').map((part) => part.trim()).filter(Boolean);
  const loweredSegments = segments.map((part) => part.toLowerCase());
  const numericSegment = segments.find((part) => ZOOM_MEETING_ID_PATTERN.test(part.replace(/\D/g, '')));
  const looksLikeMeeting = loweredSegments.includes('j')
    || loweredSegments.includes('join')
    || loweredSegments.includes('wc')
    || loweredSegments.includes('s')
    || loweredSegments.includes('w')
    || loweredSegments.includes('my')
    || parsed.searchParams.has('confno')
    || parsed.searchParams.has('meetingId');

  const queryId = parsed.searchParams.get('confno') || parsed.searchParams.get('meetingId');
  if (queryId && ZOOM_MEETING_ID_PATTERN.test(queryId.replace(/\D/g, ''))) {
    return queryId.replace(/\D/g, '');
  }
  if (looksLikeMeeting && numericSegment) {
    return numericSegment.replace(/\D/g, '');
  }
  if (loweredSegments[0] === 'my' && segments[1]) {
    return `my-${normalizeKeyPart(segments[1])}`;
  }
  return '';
}

function getZoomMeetingIdFromTitle(title) {
  const cleanTitle = normalizeText(title);
  if (!/\b(zoom|cloud hd video meeting|video meeting|zoom meeting)\b/i.test(cleanTitle)) return '';
  const match = cleanTitle.match(/\b(\d[\d\s-]{7,}\d)\b/);
  if (!match || !match[1]) return '';
  const digits = match[1].replace(/\D/g, '');
  return ZOOM_MEETING_ID_PATTERN.test(digits) ? digits : '';
}

function buildDetectedMeeting({ provider, providerLabel, id, url, title, source }) {
  const safeProvider = PROVIDER_CONFIGS[provider] ? provider : 'google-meet';
  const config = PROVIDER_CONFIGS[safeProvider];
  const safeTitle = normalizeText(title) || config.fallbackTitle;
  const keyPart = normalizeKeyPart(id) || normalizeKeyPart(url) || normalizeKeyPart(safeTitle);
  if (!keyPart) return null;
  return {
    provider: safeProvider,
    providerLabel: providerLabel || config.providerLabel,
    key: `${safeProvider}:${keyPart}`,
    meetingId: keyPart,
    title: safeTitle,
    url: normalizeText(url),
    source: source || 'unknown',
    detectedAt: Date.now(),
  };
}

function detectMeetingFromSnapshot(snapshot = {}) {
  const appName = normalizeText(snapshot.appName);
  const title = normalizeText(snapshot.title);
  const url = normalizeText(snapshot.url);
  const isBrowserApp = /\b(chrome|chromium|safari|edge|brave|arc)\b/i.test(appName);
  if (!isBrowserApp) return null;

  const parsed = parseUrl(url);

  const googleMeetId = getGoogleMeetId(parsed);
  if (googleMeetId) {
    return buildDetectedMeeting({
      provider: 'google-meet',
      providerLabel: 'Google Meet',
      id: googleMeetId,
      url,
      title: title || 'Google Meet',
      source: 'url',
    });
  }

  const teamsMeetingId = getTeamsMeetingId(parsed);
  if (teamsMeetingId) {
    return buildDetectedMeeting({
      provider: 'teams',
      providerLabel: 'Microsoft Teams',
      id: teamsMeetingId,
      url,
      title: title || 'Microsoft Teams meeting',
      source: 'url',
    });
  }

  const zoomMeetingId = getZoomMeetingId(parsed);
  if (zoomMeetingId) {
    return buildDetectedMeeting({
      provider: 'zoom',
      providerLabel: 'Zoom',
      id: zoomMeetingId,
      url,
      title: title || 'Zoom meeting',
      source: 'url',
    });
  }

  const googleMeetTitleId = getGoogleMeetIdFromTitle(title);
  if (googleMeetTitleId) {
    return buildDetectedMeeting({
      provider: 'google-meet',
      providerLabel: 'Google Meet',
      id: googleMeetTitleId,
      url: '',
      title: title || 'Google Meet',
      source: 'window-title',
    });
  }

  const zoomTitleId = getZoomMeetingIdFromTitle(title);
  if (zoomTitleId) {
    return buildDetectedMeeting({
      provider: 'zoom',
      providerLabel: 'Zoom',
      id: zoomTitleId,
      url: '',
      title: title || 'Zoom meeting',
      source: 'window-title',
    });
  }

  const combinedTitle = `${appName} ${title}`.toLowerCase();
  if (combinedTitle.includes('google meet') && /\b(meeting|call)\b/i.test(title)) {
    return buildDetectedMeeting({
      provider: 'google-meet',
      providerLabel: 'Google Meet',
      id: title,
      url: '',
      title: title || 'Google Meet',
      source: 'window-title',
    });
  }

  return null;
}

class MeetingPromptStateMachine {
  constructor(options = {}) {
    this.stabilityMs = Number.isFinite(options.stabilityMs) ? options.stabilityMs : PROMPT_STABILITY_MS;
    this.vanishMs = Number.isFinite(options.vanishMs) ? options.vanishMs : PROMPT_VANISH_MS;
    this.dismissedKeys = new Set();
    this.candidate = null;
    this.visibleMeeting = null;
    this.visibleLastSeenAt = 0;
  }

  snapshot() {
    return {
      visible: !!this.visibleMeeting,
      meeting: this.visibleMeeting,
    };
  }

  hide() {
    this.candidate = null;
    this.visibleMeeting = null;
    this.visibleLastSeenAt = 0;
  }

  dismiss(key = '') {
    const resolvedKey = key || (this.visibleMeeting && this.visibleMeeting.key) || '';
    if (resolvedKey) this.dismissedKeys.add(resolvedKey);
    if (this.visibleMeeting && (!resolvedKey || this.visibleMeeting.key === resolvedKey)) {
      this.hide();
    }
    if (this.candidate && (!resolvedKey || this.candidate.meeting.key === resolvedKey)) {
      this.candidate = null;
    }
    return this.snapshot();
  }

  suppress(key = '') {
    if (key) this.dismissedKeys.add(key);
    if (this.visibleMeeting && this.visibleMeeting.key === key) this.hide();
    if (this.candidate && this.candidate.meeting.key === key) this.candidate = null;
    return this.snapshot();
  }

  update({ meeting = null, nowMs = Date.now(), enabled = true, busy = false } = {}) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (!enabled || busy) {
      this.candidate = null;
      this.hide();
      return this.snapshot();
    }

    if (!meeting || !meeting.key) {
      this.candidate = null;
      if (this.visibleMeeting && now - this.visibleLastSeenAt >= this.vanishMs) {
        this.hide();
      }
      return this.snapshot();
    }

    if (this.dismissedKeys.has(meeting.key)) {
      if (this.visibleMeeting && this.visibleMeeting.key === meeting.key) this.hide();
      this.candidate = null;
      return this.snapshot();
    }

    if (this.visibleMeeting && this.visibleMeeting.key === meeting.key) {
      this.visibleMeeting = { ...this.visibleMeeting, ...meeting };
      this.visibleLastSeenAt = now;
      return this.snapshot();
    }

    if (this.visibleMeeting && this.visibleMeeting.key !== meeting.key) {
      this.hide();
    }

    if (!this.candidate || this.candidate.meeting.key !== meeting.key) {
      this.candidate = {
        meeting,
        firstSeenAt: now,
        lastSeenAt: now,
      };
      if (this.stabilityMs <= 0) {
        this.visibleMeeting = meeting;
        this.visibleLastSeenAt = now;
        this.candidate = null;
      }
      return this.snapshot();
    }

    this.candidate.meeting = meeting;
    this.candidate.lastSeenAt = now;
    if (now - this.candidate.firstSeenAt >= this.stabilityMs) {
      this.visibleMeeting = meeting;
      this.visibleLastSeenAt = now;
      this.candidate = null;
    }
    return this.snapshot();
  }
}

module.exports = {
  GOOGLE_MEET_CODE_PATTERN,
  ZOOM_MEETING_ID_PATTERN,
  PROMPT_STABILITY_MS,
  PROMPT_VANISH_MS,
  MeetingPromptStateMachine,
  detectMeetingFromSnapshot,
  getGoogleMeetId,
  getGoogleMeetIdFromTitle,
  getTeamsMeetingId,
  getZoomMeetingId,
  getZoomMeetingIdFromTitle,
  normalizeKeyPart,
};
