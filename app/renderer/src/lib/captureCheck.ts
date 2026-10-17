/**
 * Pre-flight capture check: for the first seconds of a recording, watch the
 * microphone and system-audio sources and flag a channel that stays flat
 * (permission lost, wrong or disconnected device). Pure logic; the capture
 * hook feeds it peak samples and the recording screen renders its state.
 */

/** How long the check runs before a silent channel counts as flat. */
export const CAPTURE_CHECK_MS = 20_000;

/** Sample peak (|x|, 0..1) above which a channel counts as carrying sound.
 *  About -66 dBFS: room tone on a working microphone is well above it, while
 *  a revoked permission, muted device or idle loopback delivers digital zero. */
export const FLAT_PEAK = 0.0005;

export type ChannelStatus =
  /** Still within the check window, no sound yet. */
  | 'listening'
  /** Sound seen at least once. */
  | 'ok'
  /** No sound for the whole check window. */
  | 'flat'
  /** System audio is off by setting or unsupported: nothing to check. */
  | 'off'
  /** System audio was expected but could not be captured at all. */
  | 'unavailable';

export interface ChannelCheck {
  status: ChannelStatus;
  /** Meter value 0..1 for the latest sample (dB-scaled). */
  level: number;
}

export interface CaptureCheckState {
  elapsedMs: number;
  /** True while inside the check window. */
  checking: boolean;
  mic: ChannelCheck;
  system: ChannelCheck;
}

/** Map a sample peak to a 0..1 meter on a -60..0 dBFS scale. */
export function peakToMeter(peak: number): number {
  if (!(peak > 0)) return 0;
  const db = 20 * Math.log10(Math.min(1, peak));
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

/** Largest absolute sample in a time-domain buffer. */
export function bufferPeak(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

export interface CaptureCheckOptions {
  /** Loopback was enabled (setting on and OS support) when capture started. */
  systemExpected: boolean;
  /** A system-audio track was actually acquired. */
  systemAcquired: boolean;
}

export interface CaptureCheck {
  /** Feed one sample; `sysPeak` is ignored when system audio is not captured. */
  sample: (elapsedMs: number, micPeak: number, sysPeak: number | null) => CaptureCheckState;
}

export function createCaptureCheck({ systemExpected, systemAcquired }: CaptureCheckOptions): CaptureCheck {
  let micHeard = false;
  let sysHeard = false;
  const statusFor = (heard: boolean, elapsedMs: number): ChannelStatus =>
    heard ? 'ok' : elapsedMs >= CAPTURE_CHECK_MS ? 'flat' : 'listening';

  return {
    sample(elapsedMs, micPeak, sysPeak) {
      if (micPeak > FLAT_PEAK) micHeard = true;
      const systemLive = systemExpected && systemAcquired;
      if (systemLive && sysPeak !== null && sysPeak > FLAT_PEAK) sysHeard = true;
      const system: ChannelCheck = !systemExpected
        ? { status: 'off', level: 0 }
        : !systemAcquired
          ? { status: 'unavailable', level: 0 }
          : { status: statusFor(sysHeard, elapsedMs), level: peakToMeter(sysPeak ?? 0) };
      return {
        elapsedMs,
        checking: elapsedMs < CAPTURE_CHECK_MS,
        mic: { status: statusFor(micHeard, elapsedMs), level: peakToMeter(micPeak) },
        system,
      };
    },
  };
}

/** A channel the user should hear about (only after the window, or at once
 *  when system audio could not be captured at all). */
export function captureWarnings(state: CaptureCheckState): Array<'mic-flat' | 'system-unavailable'> {
  const out: Array<'mic-flat' | 'system-unavailable'> = [];
  if (state.mic.status === 'flat') out.push('mic-flat');
  if (state.system.status === 'unavailable') out.push('system-unavailable');
  // An acquired loopback can legitimately be silent in an in-person meeting.
  // Silence alone cannot tell us whether system playback was intended.
  return out;
}
