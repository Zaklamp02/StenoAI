// Explicit developer CLI only. Credentials stay in the existing protected
// loader and the backend environment; the plan and results never contain keys.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
let running = false;

async function launchBenchmark(argv, { backend, cwd, getEnv, credentials, busy }) {
  const arg = argv.find(a => a.startsWith('--transcription-benchmark-plan='));
  if (!arg) return;
  if (running || busy()) throw new Error('App is busy; benchmark not started');
  const planPath = fs.realpathSync(arg.slice(arg.indexOf('=') + 1));
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (!Array.isArray(plan.jobs) || plan.jobs.length > 12) throw new Error('Invalid benchmark plan');
  running = true;
  const root = path.dirname(planPath);
  try {
    for (const name of plan.jobs) {
      if (typeof name !== 'string' || path.basename(name) !== name || !name.endsWith('-job.json')) throw new Error('Invalid job path');
      const jobPath = path.join(root, name);
      const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
      if (!['openai-asr', 'whisper', 'parakeet'].includes(job.engine)) throw new Error('Invalid engine');
      const env = getEnv({ ...(job.engine === 'openai-asr' ? credentials() : {}),
        STENOAI_USER_DATA_DIR: path.join(root, name + '-data'),
        STENOAI_OAI_PARALLELISM: '6', STENOAI_OAI_CHUNK_SECONDS: '180' });
      fs.writeFileSync(path.join(root, 'benchmark-status.json'), JSON.stringify({ state: 'running', job: name }));
      const log = fs.openSync(path.join(root, name + '.log'), 'w', 0o600);
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(backend(), ['benchmark-transcription', jobPath], { cwd: cwd(), env, stdio: ['ignore', log, log] });
          const timer = setTimeout(() => { child.kill('SIGTERM'); }, 30 * 60 * 1000);
          child.once('error', reject);
          child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Benchmark job failed')); });
        });
      } finally { fs.closeSync(log); }
    }
    fs.writeFileSync(path.join(root, 'benchmark-status.json'), JSON.stringify({ state: 'complete' }));
  } catch (error) {
    fs.writeFileSync(path.join(root, 'benchmark-status.json'), JSON.stringify({ state: 'failed', error: error.message }));
  } finally { running = false; }
}
module.exports = { launchBenchmark };
