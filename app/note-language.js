'use strict';

const fs = require('fs');
const path = require('path');

// Per-meeting transcription/summary language. The global setting stays the
// default ("auto"); a meeting only appears here when the user picked a
// language for that one note. Keyed by the recording/summary stem, which the
// recording, its transcript and its summary share.
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

function isLanguageCode(code) {
  return typeof code === 'string' && LANGUAGE_CODE.test(code);
}

function noteStem(filePath) {
  const base = path.basename(String(filePath || ''));
  const stem = base.replace(/\.[^.]+$/, '');
  return stem.endsWith('_summary') ? stem.slice(0, -'_summary'.length) : stem;
}

function createNoteLanguages(getUserDataDir) {
  const file = () => path.join(getUserDataDir(), 'note-languages.json');
  function read() {
    try {
      const languages = JSON.parse(fs.readFileSync(file(), 'utf8'));
      if (!languages || typeof languages !== 'object' || Array.isArray(languages)) return {};
      return languages;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw error;
    }
  }
  function write(languages) {
    const target = file();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(languages, null, 2), { mode: 0o600 });
    fs.renameSync(`${target}.tmp`, target);
  }
  return {
    get(filePath) {
      const code = read()[noteStem(filePath)];
      return isLanguageCode(code) ? code : null;
    },
    // 'auto' (or null) removes the override, so the global default applies.
    set(filePath, code) {
      const stem = noteStem(filePath);
      if (!stem) throw new Error('Invalid note');
      if (code !== null && code !== 'auto' && !isLanguageCode(code)) throw new Error('Invalid language');
      const languages = read();
      if (code === null || code === 'auto') delete languages[stem];
      else languages[stem] = code;
      write(languages);
    },
    // Backend env for a job on this note: the override replaces the global
    // language for its transcription and its summary only.
    env(filePath) {
      const code = this.get(filePath);
      return code ? { STENOAI_LANGUAGE_OVERRIDE: code } : {};
    },
  };
}

module.exports = { createNoteLanguages, isLanguageCode, noteStem };
