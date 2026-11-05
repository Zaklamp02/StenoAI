import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PlugZap } from 'lucide-react';
import { t } from '@/i18n';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { Button } from '@/components/ui/button';
import { useRecording } from '@/hooks/useRecording';

/** Run meetings held for mains power now, on battery. */
export function useProcessNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await ipc().recording.processNow()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['recording', 'queue'] }); },
  });
}

// Floating card, like RecordingRecovery, while queued meetings wait for the
// device to be plugged in (Settings → Power saving mode).
export function PowerWaitNotice() {
  const recording = useRecording();
  const processNow = useProcessNow();
  if (!recording.waitingForPower || recording.queueSize === 0) return null;
  return (
    <section
      data-testid="power-wait-notice"
      className="fixed bottom-24 left-4 z-50 w-[340px] max-w-[calc(100vw-2rem)] rounded-lg border border-border p-4 text-[13px] shadow-md"
      style={{ background: 'var(--surface-raised)', color: 'var(--fg-1)' }}
      aria-label={t('power.waitingTitle')}
    >
      <p className="inline-flex items-center gap-1.5 text-[14px] font-medium">
        <PlugZap size={14} aria-hidden style={{ color: 'var(--fg-2)' }} />
        {t('power.waitingTitle')}
      </p>
      <p className="mt-1 leading-[1.5]" style={{ color: 'var(--fg-2)' }}>{t('power.waitingNotice')}</p>
      <Button
        size="sm"
        className="mt-3 h-[28px] px-3 text-[13px]"
        disabled={processNow.isPending}
        onClick={() => processNow.mutate()}
      >
        {t('power.processNow')}
      </Button>
      {processNow.error && <p role="alert" className="mt-2">{processNow.error.message}</p>}
    </section>
  );
}
