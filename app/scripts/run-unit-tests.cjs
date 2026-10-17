'use strict';
const { spawnSync } = require('child_process');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let failed = false;
for (const suite of ['test:unit:main', 'test:unit:renderer']) {
  const result = spawnSync(npm, ['run', suite], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
