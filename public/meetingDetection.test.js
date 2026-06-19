const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MeetingPromptStateMachine,
  detectMeetingFromSnapshot,
} = require('./meetingDetection');

test('detects Google Meet code URLs', () => {
  const meeting = detectMeetingFromSnapshot({
    appName: 'Google Chrome',
    title: 'Team sync - Google Meet',
    url: 'https://meet.google.com/abc-defg-hij',
  });

  assert.equal(meeting.provider, 'google-meet');
  assert.equal(meeting.key, 'google-meet:abc-defg-hij');
});

test('detects Google Meet browser titles when URL access is unavailable', () => {
  const meeting = detectMeetingFromSnapshot({
    appName: 'Google Chrome',
    title: 'Meet - abc-defg-hij',
    url: '',
  });

  assert.equal(meeting.provider, 'google-meet');
  assert.equal(meeting.key, 'google-meet:abc-defg-hij');
  assert.equal(meeting.source, 'window-title');
});

test('detects Microsoft Teams meetup join URLs', () => {
  const meeting = detectMeetingFromSnapshot({
    appName: 'Microsoft Edge',
    title: 'Weekly planning | Microsoft Teams',
    url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_NmQx/0?context=%7b%7d',
  });

  assert.equal(meeting.provider, 'teams');
  assert.match(meeting.key, /^teams:/);
});

test('ignores Microsoft Teams desktop meeting windows', () => {
  const meeting = detectMeetingFromSnapshot({
    appName: 'Microsoft Teams',
    title: 'Design review Meeting | Microsoft Teams',
    url: '',
  });

  assert.equal(meeting, null);
});

test('detects Zoom meeting URLs', () => {
  const meeting = detectMeetingFromSnapshot({
    appName: 'Google Chrome',
    title: 'Launch Meeting - Zoom',
    url: 'https://us02web.zoom.us/j/12345678901?pwd=secret',
  });

  assert.equal(meeting.provider, 'zoom');
  assert.equal(meeting.key, 'zoom:12345678901');
  assert.equal(meeting.source, 'url');
});

test('detects Zoom web client join URLs', () => {
  const meeting = detectMeetingFromSnapshot({
    appName: 'Safari',
    title: 'Zoom Meeting',
    url: 'https://app.zoom.us/wc/join/9876543210',
  });

  assert.equal(meeting.provider, 'zoom');
  assert.equal(meeting.key, 'zoom:9876543210');
});

test('detects Zoom browser titles when URL access is unavailable', () => {
  const meeting = detectMeetingFromSnapshot({
    appName: 'Microsoft Edge',
    title: 'Zoom Meeting - 123 456 7890',
    url: '',
  });

  assert.equal(meeting.provider, 'zoom');
  assert.equal(meeting.key, 'zoom:1234567890');
  assert.equal(meeting.source, 'window-title');
});

test('ignores Zoom desktop meeting windows', () => {
  const meeting = detectMeetingFromSnapshot({
    appName: 'zoom.us',
    title: 'Design review Zoom Meeting',
    url: '',
  });

  assert.equal(meeting, null);
});

test('ignores unrelated Teams and browser windows', () => {
  assert.equal(detectMeetingFromSnapshot({
    appName: 'Microsoft Teams',
    title: 'General | Engineering | Microsoft Teams',
    url: '',
  }), null);

  assert.equal(detectMeetingFromSnapshot({
    appName: 'Google Chrome',
    title: 'Google Meet help',
    url: 'https://meet.google.com/',
  }), null);

  assert.equal(detectMeetingFromSnapshot({
    appName: 'zoom.us',
    title: 'Zoom Workplace',
    url: '',
  }), null);

  assert.equal(detectMeetingFromSnapshot({
    appName: 'Google Chrome',
    title: 'Zoom pricing',
    url: 'https://zoom.us/pricing',
  }), null);
});

test('requires stable detection before showing a prompt', () => {
  const machine = new MeetingPromptStateMachine({ stabilityMs: 5000, vanishMs: 6000 });
  const meeting = detectMeetingFromSnapshot({
    appName: 'Google Chrome',
    title: 'Team sync - Google Meet',
    url: 'https://meet.google.com/abc-defg-hij',
  });

  assert.equal(machine.update({ meeting, nowMs: 0 }).visible, false);
  assert.equal(machine.update({ meeting, nowMs: 4000 }).visible, false);
  assert.equal(machine.update({ meeting, nowMs: 6000 }).visible, true);
});

test('dismisses the same meeting for the current session', () => {
  const machine = new MeetingPromptStateMachine({ stabilityMs: 0, vanishMs: 6000 });
  const meeting = detectMeetingFromSnapshot({
    appName: 'Microsoft Edge',
    title: 'Weekly planning | Microsoft Teams',
    url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_NmQx/0?context=%7b%7d',
  });

  assert.equal(machine.update({ meeting, nowMs: 0 }).visible, true);
  machine.dismiss(meeting.key);
  assert.equal(machine.update({ meeting, nowMs: 1000 }).visible, false);
});

test('hides visible prompt after the meeting disappears', () => {
  const machine = new MeetingPromptStateMachine({ stabilityMs: 0, vanishMs: 6000 });
  const meeting = detectMeetingFromSnapshot({
    appName: 'Google Chrome',
    title: 'Team sync - Google Meet',
    url: 'https://meet.google.com/abc-defg-hij',
  });

  assert.equal(machine.update({ meeting, nowMs: 0 }).visible, true);
  assert.equal(machine.update({ meeting: null, nowMs: 5000 }).visible, true);
  assert.equal(machine.update({ meeting: null, nowMs: 6000 }).visible, false);
});

test('suppresses prompts while recording or dictation is busy', () => {
  const machine = new MeetingPromptStateMachine({ stabilityMs: 0, vanishMs: 6000 });
  const meeting = detectMeetingFromSnapshot({
    appName: 'Google Chrome',
    title: 'Team sync - Google Meet',
    url: 'https://meet.google.com/abc-defg-hij',
  });

  assert.equal(machine.update({ meeting, nowMs: 0, busy: true }).visible, false);
  assert.equal(machine.update({ meeting, nowMs: 1000, busy: false }).visible, true);
});
