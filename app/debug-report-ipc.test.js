'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { registerDebugReportIpc } = require('./debug-report-ipc');

function setup({ backend = { success: true, report: { schema_version: 1 } }, sendResult = true } = {}) {
  const handlers = {};
  const sent = [];
  const calls = [];
  registerDebugReportIpc({
    ipcMain: { handle: (channel, handler) => { handlers[channel] = handler; } },
    runPythonScript: async (_script, args) => { calls.push(args); return JSON.stringify(backend); },
    parsePythonFailureJson: (error) => ({ success: false, error: error.message }),
    appContext: () => ({ version: '9.9.9', platform: 'darwin' }),
    send: async (id, report) => { sent.push({ id, report }); return sendResult; },
  });
  return { handlers, sent, calls };
}

test('the preview is the backend report plus app context', async () => {
  const { handlers, calls } = setup();
  const result = await handlers['get-debug-report']({}, 'mtg001');
  assert.deepStrictEqual(result, {
    success: true,
    report: { schema_version: 1, app: { version: '9.9.9', platform: 'darwin' } },
  });
  assert.deepStrictEqual(calls, [['debug-report', 'mtg001']]);
});

test('sending rebuilds the report instead of taking one from the renderer', async () => {
  const { handlers, sent } = setup();
  const result = await handlers['send-debug-report']({}, 'mtg001', { forged: 'payload' });
  assert.strictEqual(result.success, true);
  assert.match(result.report_id, /^[0-9a-f-]{36}$/);
  assert.deepStrictEqual(sent[0].report, { schema_version: 1, app: { version: '9.9.9', platform: 'darwin' } });
  assert.strictEqual(sent[0].id, result.report_id);
});

test('a path is refused before the backend runs', async () => {
  const { handlers, calls, sent } = setup();
  const result = await handlers['send-debug-report']({}, '../etc');
  assert.deepStrictEqual(result, { success: false, error: 'Invalid meeting identifier.' });
  assert.deepStrictEqual(calls, []);
  assert.deepStrictEqual(sent, []);
});

test('a failed send says so', async () => {
  const { handlers } = setup({ sendResult: false });
  assert.deepStrictEqual(
    await handlers['send-debug-report']({}, 'mtg001'),
    { success: false, error: 'Could not send the report.' },
  );
});
