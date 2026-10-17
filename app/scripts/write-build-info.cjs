'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
let commit = 'source-archive';
let dirty = false;
try { commit = git(['rev-parse', '--short', 'HEAD']); dirty = Boolean(git(['status', '--porcelain'])); } catch (_) {}
fs.writeFileSync(path.join(root, 'app/build-info.json'), JSON.stringify({ commit, dirty,
  builtAt: new Date().toISOString(), fork: 'Zaklamp02/StenoAI' }, null, 2) + '\n');
