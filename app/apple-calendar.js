'use strict';

// Apple Calendar (EventKit) as a third calendar source next to Google and
// Outlook. Everything Calendar.app shows is available — including Exchange
// accounts added in System Settings — with attendees, and without OAuth.
//
// The bundled `steno-calendar` helper (custom/calendar-helper) does the
// EventKit work and prints JSON. Its events already have the normalized shape
// main.js uses for Google/Outlook, plus `attendees`.

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const HELPER_TIMEOUT_MS = 8000;
// The prompt waits for the user to click Allow.
const ACCESS_TIMEOUT_MS = 130000;
const EVENTS_CACHE_MS = 30000;
// A recording may start this long before its meeting does.
const LEAD_MS = 10 * 60 * 1000;
// The session name a recording was started with ('Note' when none was given).
const DEFAULT_SESSION_NAME = 'Note';

/** A title as main.js puts a session name in the recording's file name. */
function fileSafeName(title) {
  return String(title || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/** The event a recording belongs to, among several that overlap it.
 *  Candidates run at the recording's start (or start within LEAD_MS after
 *  it) and are neither all-day nor declined. A recording started from an
 *  invitation is named after it, so an event whose title matches the
 *  session name wins. Otherwise, and among same-named events, the event
 *  whose time span best matches the recording's wins (shared time over
 *  combined span, which also handles a meeting that overruns its slot);
 *  without a known length, the closest start. Ties prefer a meeting you
 *  accepted or organize, then the shorter event. */
function pickEventForRecording(events, { startMs, durationMs = null, safeName = null }) {
  const candidates = [];
  for (const event of events || []) {
    if (event.is_all_day || event.response_status === 'declined') continue;
    const start = Date.parse(event.start);
    const end = Date.parse(event.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (startMs < start - LEAD_MS || startMs >= end) continue;
    candidates.push({ event, start, end });
  }
  const named = safeName && safeName !== DEFAULT_SESSION_NAME
    ? candidates.filter((c) => fileSafeName(c.event.title) === safeName)
    : [];
  const pool = named.length > 0 ? named : candidates;
  const recordingEnd = durationMs > 0 ? startMs + durationMs : null;
  const fit = (c) => {
    if (recordingEnd === null) return -Math.abs(c.start - startMs);
    const shared = Math.min(recordingEnd, c.end) - Math.max(startMs, c.start);
    const span = Math.max(recordingEnd, c.end) - Math.min(startMs, c.start);
    return Math.max(0, shared) / span;
  };
  const committed = (c) => (c.event.response_status === 'accepted' || c.event.response_status === 'organizer' ? 1 : 0);
  const rank = (c) => [fit(c), committed(c), c.start - c.end];
  const better = (a, b) => {
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };
  let best = null;
  for (const c of pool) {
    const r = rank(c);
    if (!best || better(r, best.rank)) best = { c, rank: r };
  }
  return best ? best.c.event : null;
}

function registerAppleCalendar({ ipcMain, app, getUserDataDir, sendDebugLog, isAllowedSummaryPath }) {
  let cache = { at: 0, events: null };

  function helperPath() {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'steno-calendar')
      : path.join(__dirname, '..', 'bin-custom', 'steno-calendar');
  }

  function statePath() {
    return path.join(getUserDataDir(), 'apple-calendar.json');
  }

  function isEnabled() {
    try {
      return JSON.parse(fs.readFileSync(statePath(), 'utf-8')).enabled === true;
    } catch {
      return false;
    }
  }

  function setEnabled(enabled) {
    fs.writeFileSync(statePath(), JSON.stringify({ enabled }), 'utf-8');
    cache = { at: 0, events: null };
  }

  function runHelper(args, timeoutMs = HELPER_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const bin = helperPath();
      if (!fs.existsSync(bin)) {
        resolve({ success: false, error: 'Calendar helper not found' });
        return;
      }
      execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        try {
          resolve(JSON.parse(String(stdout).trim()));
        } catch {
          resolve({ success: false, error: error ? error.message : 'Unreadable calendar helper output' });
        }
      });
    });
  }

  /** Events from now - 12 h to now + 7 days, or null when not enabled / no access. */
  async function fetchEvents() {
    if (process.platform !== 'darwin' || !isEnabled()) return null;
    if (cache.events && Date.now() - cache.at < EVENTS_CACHE_MS) return cache.events;
    const now = Date.now();
    const from = new Date(now - 12 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const to = new Date(now + 7 * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const res = await runHelper(['events', '--from', from, '--to', to]);
    if (!res.success) {
      sendDebugLog(`[apple-calendar] events failed: ${res.error}`);
      return null;
    }
    cache = { at: Date.now(), events: res.events || [] };
    return cache.events;
  }

  async function status() {
    if (process.platform !== 'darwin') return { success: true, available: false, enabled: false };
    const res = await runHelper(['status']);
    return {
      success: true,
      available: res.success !== false,
      enabled: isEnabled(),
      authorization: res.authorization || 'unknown',
    };
  }

  ipcMain.handle('apple-calendar-status', async () => status());

  ipcMain.handle('apple-calendar-connect', async () => {
    const res = await runHelper(['request-access'], ACCESS_TIMEOUT_MS);
    if (res.success && res.authorization === 'full') {
      setEnabled(true);
      sendDebugLog('[apple-calendar] connected');
      return status();
    }
    return {
      success: false,
      error: res.authorization === 'denied'
        ? 'Calendar access was denied. Allow StenoAI under System Settings → Privacy & Security → Calendars.'
        : (res.error || 'Calendar access was not granted.'),
      authorization: res.authorization,
    };
  });

  /** The calendar event a recording that started at `timeMs` belongs to,
   *  from events that run at that moment (or start within 10 min after it),
   *  not all-day, not declined. See pickEventForRecording for the choice
   *  between overlapping meetings. Used to link a note to its invitation and
   *  to offer attendees when naming speakers, also for past meetings. */
  async function eventAt(timeMs, hints = {}) {
    if (process.platform !== 'darwin' || !isEnabled()) return null;
    const isoAt = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const res = await runHelper([
      'events', '--from', isoAt(timeMs - 6 * 3600 * 1000), '--to', isoAt(timeMs + 3600 * 1000),
    ]);
    if (!res.success) throw new Error('Calendar lookup failed. Check access and try again.');
    return pickEventForRecording(res.events, { startMs: timeMs, ...hints });
  }

  /** Recording start from the note's stem (`sysaudio-1792058617597-Note`). */
  function recordingStartMs(summaryPath) {
    const m = path.basename(summaryPath).match(/(?:^|-)(\d{13})(?:-|_)/);
    return m ? Number(m[1]) : null;
  }

  /** What else the note says about its recording: the session name it was
   *  started with (file-safe, from the stem) and its length (frontmatter). */
  function recordingHints(summaryPath) {
    const m = path.basename(summaryPath).match(/^(?:[a-z]+-)?\d{13}-(.+)_summary\.md$/);
    let durationMs = null;
    try {
      const front = fs.readFileSync(summaryPath, 'utf8').split('\n---', 1)[0];
      const seconds = Number((front.match(/^duration_seconds:\s*"?([\d.]+)/m) || [])[1]);
      if (Number.isFinite(seconds) && seconds > 0) durationMs = seconds * 1000;
    } catch { /* no summary yet: time-only matching */ }
    return { safeName: m ? m[1] : null, durationMs };
  }

  const MEETING_CACHE_MS = 5 * 60 * 1000;
  function readRecord(summaryPath) {
    try { return JSON.parse(fs.readFileSync(summaryPath.replace(/_summary\.md$/, '_calendar.json'), 'utf8')); }
    catch { return null; }
  }
  function saveRecord(summaryPath, record) {
    const dest = summaryPath.replace(/_summary\.md$/, '_calendar.json');
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, dest);
    return record;
  }
  async function meetingOptions(summaryPath, previous) {
    if (process.platform !== 'darwin' || !isEnabled()) throw new Error('Connect Apple Calendar in Settings first.');
    const start = recordingStartMs(summaryPath) ?? Date.parse(previous?.event?.start);
    if (!Number.isFinite(start)) return [];
    const iso = ms => new Date(ms).toISOString();
    const res = await runHelper(['events', '--from', iso(start - 24 * 3600 * 1000), '--to', iso(start + 24 * 3600 * 1000)]);
    if (!res.success) throw new Error('Calendar lookup failed. Check access and try again.');
    return (res.events || []).filter(e => !e.is_all_day && e.response_status !== 'declined');
  }
  async function ensureMeetingCalendar(summaryPath, { force = false } = {}) {
    if (!summaryPath || !summaryPath.endsWith('_summary.md')) return null;
    const previous = readRecord(summaryPath);
    if (previous?.detached) return previous;
    if (!isEnabled()) return previous;
    if (!force && previous && Date.now() - Date.parse(previous.checked_at) < MEETING_CACHE_MS) return previous;
    // A helper failure throws before saving: it is never persisted as no-match.
    let event;
    if (previous?.event?.id) {
      const options = await meetingOptions(summaryPath, previous);
      event = options.find(e => e.id === previous.event.id && e.start === previous.event.start) || null;
    } else {
      const start = recordingStartMs(summaryPath);
      if (start === null) return previous;
      event = await eventAt(start, recordingHints(summaryPath));
    }
    // A user unlink/rematch or a newer lookup wins over this in-flight refresh.
    const latest = readRecord(summaryPath);
    if (JSON.stringify(latest) !== JSON.stringify(previous) || !isEnabled()) return latest;
    return saveRecord(summaryPath, { checked_at: new Date().toISOString(), event });
  }
  const validNote = p => typeof p === 'string' && p.endsWith('_summary.md') && isAllowedSummaryPath(p);
  ipcMain.handle('meeting-calendar', async (_event, summaryFile) => {
    if (!validNote(summaryFile)) return { success: false, error: 'Invalid note' };
    try {
      const record = await ensureMeetingCalendar(summaryFile);
      return { success: true, event: record?.event || null };
    } catch (e) {
      // Display the last successful snapshot through a temporary outage.
      return { success: true, event: readRecord(summaryFile)?.event || null, warning: e.message };
    }
  });
  ipcMain.handle('meeting-calendar-options', async (_event, summaryFile) => {
    if (!validNote(summaryFile)) return { success: false, error: 'Invalid note' };
    try { return { success: true, events: await meetingOptions(summaryFile, readRecord(summaryFile)) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('update-meeting-calendar', async (_event, summaryFile, change) => {
    if (!validNote(summaryFile)) return { success: false, error: 'Invalid note' };
    try {
      let record;
      if (change?.action === 'unlink') {
        record = saveRecord(summaryFile, { checked_at: new Date().toISOString(), event: null, detached: true });
      } else if (change?.action === 'match') {
        const previous = readRecord(summaryFile);
        const options = await meetingOptions(summaryFile, previous);
        if (JSON.stringify(readRecord(summaryFile)) !== JSON.stringify(previous)) throw new Error('The invitation changed. Try again.');
        const event = options.find(e => e.id === change.eventId && e.start === change.eventStart);
        if (!event) throw new Error('This calendar event is no longer available. Refresh and try again.');
        record = saveRecord(summaryFile, { checked_at: new Date().toISOString(), event });
      } else if (change?.action === 'refresh') {
        const previous = readRecord(summaryFile);
        if (previous?.detached) {
          const start = recordingStartMs(summaryFile);
          const event = start === null ? null : await eventAt(start, recordingHints(summaryFile));
          if (JSON.stringify(readRecord(summaryFile)) !== JSON.stringify(previous)) throw new Error('The invitation changed. Try again.');
          record = saveRecord(summaryFile, { checked_at: new Date().toISOString(), event });
        } else record = await ensureMeetingCalendar(summaryFile, { force: true });
      } else throw new Error('Invalid calendar action');
      return { success: true, event: record?.event || null };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('apple-calendar-event-at', async (_event, timeMs) => {
    if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) {
      return { success: false, error: 'Invalid time' };
    }
    try { return { success: true, event: await eventAt(timeMs) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('apple-calendar-disconnect', async () => {
    setEnabled(false);
    sendDebugLog('[apple-calendar] disconnected');
    return status();
  });

  return { isEnabled, fetchEvents, ensureMeetingCalendar };
}

module.exports = { registerAppleCalendar, pickEventForRecording };
