import { describe, expect, it } from 'vitest';
import {
  CAPTURE_CHECK_MS,
  bufferPeak,
  captureWarnings,
  createCaptureCheck,
  peakToMeter,
} from './captureCheck';

const both = { systemExpected: true, systemAcquired: true };

describe('createCaptureCheck', () => {
  it('reports both channels ok once each carries sound', () => {
    const check = createCaptureCheck(both);
    check.sample(100, 0.02, 0);
    const state = check.sample(200, 0, 0.1);
    expect(state.mic.status).toBe('ok');
    expect(state.system.status).toBe('ok');
    expect(state.checking).toBe(true);
    expect(captureWarnings(state)).toEqual([]);
  });

  it('keeps listening without a warning inside the window', () => {
    const check = createCaptureCheck(both);
    const state = check.sample(CAPTURE_CHECK_MS - 1, 0, 0);
    expect(state.mic.status).toBe('listening');
    expect(state.system.status).toBe('listening');
    expect(captureWarnings(state)).toEqual([]);
  });

  it('flags a microphone that stays at digital silence for the whole window', () => {
    const check = createCaptureCheck(both);
    for (let t = 0; t < CAPTURE_CHECK_MS; t += 100) check.sample(t, 0, 0.2);
    const state = check.sample(CAPTURE_CHECK_MS, 0, 0.2);
    expect(state.checking).toBe(false);
    expect(state.mic.status).toBe('flat');
    expect(captureWarnings(state)).toEqual(['mic-flat']);
  });

  it('treats room tone on a working microphone as sound', () => {
    const check = createCaptureCheck(both);
    expect(check.sample(CAPTURE_CHECK_MS, 0.002, 0.2).mic.status).toBe('ok');
  });

  it('does not warn about silent system audio during an in-person meeting', () => {
    const check = createCaptureCheck(both);
    const state = check.sample(CAPTURE_CHECK_MS, 0.1, 0);
    expect(state.system.status).toBe('flat');
    expect(captureWarnings(state)).toEqual([]);
    expect(captureWarnings(check.sample(CAPTURE_CHECK_MS + 500, 0.1, 0.05))).toEqual([]);
  });

  it('never warns about system audio that is off by setting', () => {
    const check = createCaptureCheck({ systemExpected: false, systemAcquired: false });
    const state = check.sample(CAPTURE_CHECK_MS * 2, 0.1, null);
    expect(state.system.status).toBe('off');
    expect(captureWarnings(state)).toEqual([]);
  });

  it('warns at once when expected system audio could not be captured', () => {
    const check = createCaptureCheck({ systemExpected: true, systemAcquired: false });
    const state = check.sample(0, 0.1, null);
    expect(state.system.status).toBe('unavailable');
    expect(captureWarnings(state)).toEqual(['system-unavailable']);
  });
});

describe('meter helpers', () => {
  it('maps peaks to a -60..0 dBFS meter', () => {
    expect(peakToMeter(0)).toBe(0);
    expect(peakToMeter(1)).toBe(1);
    expect(peakToMeter(0.001)).toBe(0);
    expect(peakToMeter(0.1)).toBeCloseTo(2 / 3, 5);
    expect(peakToMeter(NaN)).toBe(0);
  });

  it('finds the absolute peak', () => {
    expect(bufferPeak(new Float32Array([0, -0.5, 0.25]))).toBe(0.5);
    expect(bufferPeak([])).toBe(0);
  });
});
