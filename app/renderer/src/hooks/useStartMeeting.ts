import * as React from 'react';
import { useRecording } from './useRecording';
import { useSwitchRecording, type PendingMeetingStart } from './switchRecordingStore';

/** Starts a meeting's recording, or, while another one is recording, asks to
 *  switch to it first (SwitchRecordingDialog). */
export function useStartMeeting() {
  const { status, startRecording } = useRecording();
  const request = useSwitchRecording((s) => s.request);
  return React.useCallback(
    (start: PendingMeetingStart) => {
      if (status === 'recording' || status === 'paused') {
        request(start);
        return;
      }
      // startRecording reports its own failures to the user.
      void startRecording(start.name, start.trigger ?? 'manual').catch(() => {});
      start.afterStart?.();
    },
    [status, startRecording, request],
  );
}
