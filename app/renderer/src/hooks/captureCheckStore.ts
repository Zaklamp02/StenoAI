import { create } from 'zustand';
import type { CaptureCheckState } from '@/lib/captureCheck';

/**
 * Latest pre-flight capture check for the active recording, written by
 * useSystemAudioCapture and read by the recording screen. Null when no
 * recording is capturing.
 */
interface CaptureCheckStore {
  state: CaptureCheckState | null;
  /** Warnings the user closed for this recording. */
  dismissed: boolean;
  publish: (state: CaptureCheckState) => void;
  dismiss: () => void;
  reset: () => void;
}

export const useCaptureCheckStore = create<CaptureCheckStore>((set) => ({
  state: null,
  dismissed: false,
  publish: (state) => set({ state }),
  dismiss: () => set({ dismissed: true }),
  reset: () => set({ state: null, dismissed: false }),
}));
