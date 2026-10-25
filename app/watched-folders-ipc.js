'use strict';

/**
 * Watched recording folders IPC (see watched-folders.js). Folders are added
 * through the native picker only, so the renderer never names a path to scan;
 * files are referred to by an opaque id from the last listing. The e2e suite
 * may pass a path directly (allowPathArg), as it cannot click a native dialog.
 */
function registerWatchedFoldersIpc({ ipcMain, watchedFolders, dialog, getMainWindow, allowPathArg = false }) {
  const result = async (fn) => {
    try {
      return { success: true, ...(await fn()) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  ipcMain.handle('watched-folders-list', () => result(() => watchedFolders.list()));

  ipcMain.handle('watched-folders-add', (_event, testPath) => result(async () => {
    if (allowPathArg && typeof testPath === 'string' && testPath) return watchedFolders.addFolder(testPath);
    const picked = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory'],
      title: 'Choose a folder with recordings',
    });
    if (picked.canceled || !picked.filePaths.length) return { cancelled: true, ...(await watchedFolders.list()) };
    return watchedFolders.addFolder(picked.filePaths[0]);
  }));

  ipcMain.handle('watched-folders-remove', (_event, id) => result(() => watchedFolders.removeFolder(String(id))));
  ipcMain.handle('watched-folders-set-auto', (_event, id, enabled) =>
    result(() => watchedFolders.setAutoTranscribe(String(id), enabled === true)));
  ipcMain.handle('watched-folders-transcribe', (_event, ids) => result(() => watchedFolders.transcribe(ids)));
  ipcMain.handle('watched-folders-dismiss', (_event, ids) => result(() => watchedFolders.dismiss(ids)));
  ipcMain.handle('watched-folders-restore', (_event, ids) => result(() => watchedFolders.restore(ids)));
  ipcMain.handle('watched-folders-preview', (_event, id) => result(() => watchedFolders.preview(String(id))));
}

module.exports = { registerWatchedFoldersIpc };
