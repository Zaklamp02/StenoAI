'use strict';

const crypto = require('crypto');
const { validateMeetingStem } = require('./speaker-ipc');

// The per-meeting debug report (src/debug_report.py). Two steps on purpose:
// `get-debug-report` builds it for the user to read, `send-debug-report`
// builds it again and sends that. The renderer never supplies the payload,
// so nothing it holds (or a compromised page could forge) can be sent under
// the report's name; the backend's content-free builder is the only source.
function registerDebugReportIpc({ ipcMain, runPythonScript, parsePythonFailureJson, appContext, send }) {
  async function build(meetingStem) {
    const stem = validateMeetingStem(meetingStem);
    const result = JSON.parse(await runPythonScript('simple_recorder.py', ['debug-report', stem]));
    if (!result.success) return result;
    return { success: true, report: { ...result.report, app: appContext() } };
  }

  ipcMain.handle('get-debug-report', async (_event, meetingStem) => {
    try {
      return await build(meetingStem);
    } catch (error) {
      return error instanceof TypeError
        ? { success: false, error: error.message }
        : parsePythonFailureJson(error);
    }
  });

  ipcMain.handle('send-debug-report', async (_event, meetingStem) => {
    try {
      const built = await build(meetingStem);
      if (!built.success) return built;
      const reportId = crypto.randomUUID();
      const sent = await send(reportId, built.report);
      return sent ? { success: true, report_id: reportId } : { success: false, error: 'Could not send the report.' };
    } catch (error) {
      return error instanceof TypeError
        ? { success: false, error: error.message }
        : parsePythonFailureJson(error);
    }
  });
}

module.exports = { registerDebugReportIpc };
