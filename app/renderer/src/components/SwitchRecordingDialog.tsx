import { t } from '@/i18n';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useRecording } from '@/hooks/useRecording';
import { useSwitchRecording } from '@/hooks/switchRecordingStore';
import { whenCaptureSettled } from '@/hooks/useSystemAudioCapture';
import { ipc } from '@/lib/ipc';

/** Confirms switching from the running recording to another meeting. Mounted
 *  once at App level; useStartMeeting opens it. */
export function SwitchRecordingDialog() {
  const pending = useSwitchRecording((s) => s.pending);
  const clear = useSwitchRecording((s) => s.clear);
  const recording = useRecording();
  const current = recording.sessionName && recording.sessionName !== 'Note'
    ? recording.sessionName
    : null;
  const next = pending?.name?.trim() || null;

  const onConfirm = async () => {
    if (!pending) return;
    try {
      // Stay where the user is: the stopped note processes in the background.
      if (recording.status === 'recording' || recording.status === 'paused') {
        await recording.stopRecording({ navigateToNote: false });
      }
    } catch (err) {
      // Don't start a second recording over one that may still be running.
      ipc().recording.reportCaptureError(
        err instanceof Error ? err.message : t('switchRecording.failed'),
        undefined,
        'start',
      );
      clear();
      return;
    }
    try {
      // The stopped capture must close its file before the next one opens.
      await whenCaptureSettled();
      await recording.startRecording(pending.name, pending.trigger ?? 'manual');
      pending.afterStart?.();
    } catch {
      // startRecording has already told the user why it could not start.
    } finally {
      clear();
    }
  };

  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => !open && clear()}
      title={t('switchRecording.title')}
      description={
        current && next
          ? t('switchRecording.descriptionNamed', { current, next })
          : next
            ? t('switchRecording.descriptionNext', { next })
            : t('switchRecording.description')
      }
      confirmLabel={t('switchRecording.confirm')}
      cancelLabel={t('switchRecording.cancel')}
      onConfirm={onConfirm}
    />
  );
}
