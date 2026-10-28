import { create } from 'zustand';

/**
 * A meeting the user asked to start while another one was recording, waiting
 * on SwitchRecordingDialog's confirmation. Back-to-back meetings start the next
 * one from a calendar card or the "Take Notes" notification; confirming stops
 * the running recording (it keeps processing in the background) and starts
 * this one. Lives in a store because the requests come from places outside the
 * dialog's subtree (Home's calendar cards, the notification bridge).
 */
export interface PendingMeetingStart {
  /** Session name for the new recording (the calendar event title). */
  name?: string;
  trigger?: 'manual' | 'notification_click';
  /** Runs once the new recording has started, e.g. opening the meeting link. */
  afterStart?: () => void;
}

interface SwitchRecordingStore {
  pending: PendingMeetingStart | null;
  request: (start: PendingMeetingStart) => void;
  clear: () => void;
}

export const useSwitchRecording = create<SwitchRecordingStore>((set) => ({
  pending: null,
  request: (start) => set({ pending: start }),
  clear: () => set({ pending: null }),
}));
