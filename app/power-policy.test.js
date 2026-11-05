'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPowerPolicy } = require('./power-policy');

function withConfig(cfg, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'power-policy-'));
  try {
    if (cfg !== undefined) fs.writeFileSync(path.join(dir, 'config.json'), typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('defaults to always when config is missing, corrupt or unknown', () => {
  for (const cfg of [undefined, '{not json', { processing_power_policy: 'sometimes' }, {}]) {
    withConfig(cfg, (dir) => {
      const p = createPowerPolicy({ getUserDataDir: () => dir, isOnBatteryPower: () => true });
      assert.strictEqual(p.policy(), 'always');
      assert.strictEqual(p.shouldWait(), false);
    });
  }
});

test('plugged_in waits only on battery', () => {
  withConfig({ processing_power_policy: 'plugged_in' }, (dir) => {
    let battery = true;
    const p = createPowerPolicy({ getUserDataDir: () => dir, isOnBatteryPower: () => battery });
    assert.strictEqual(p.shouldWait(), true);
    battery = false;
    assert.strictEqual(p.shouldWait(), false);
  });
});

test('a failing power probe counts as mains power', () => {
  withConfig({ processing_power_policy: 'plugged_in' }, (dir) => {
    const p = createPowerPolicy({ getUserDataDir: () => dir, isOnBatteryPower: () => { throw new Error('no'); } });
    assert.strictEqual(p.shouldWait(), false);
  });
});

test('the e2e power override applies only under e2e', () => {
  withConfig({ processing_power_policy: 'plugged_in' }, (dir) => {
    const env = { STENOAI_E2E_POWER_SOURCE: 'battery' };
    const off = createPowerPolicy({ getUserDataDir: () => dir, isOnBatteryPower: () => false, env });
    assert.strictEqual(off.shouldWait(), false);
    const on = createPowerPolicy({ getUserDataDir: () => dir, isOnBatteryPower: () => false, env, isE2E: true });
    assert.strictEqual(on.shouldWait(), true);
    const ac = createPowerPolicy({ getUserDataDir: () => dir, isOnBatteryPower: () => true, env: { STENOAI_E2E_POWER_SOURCE: 'ac' }, isE2E: true });
    assert.strictEqual(ac.shouldWait(), false);
  });
});
