import { t } from '@/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { Button } from '@/components/ui/button';
import { UI_LOCALE } from '@/lib/locale';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(UI_LOCALE, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

// A floating card (not inline) so it reads the same over any page.
export function RecordingRecovery() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['recording-recovery'],
    queryFn: async () => unwrap(await ipc().recording.recoverable()).recordings,
    refetchInterval: 15_000 });
  const action = useMutation({
    mutationFn: async ({ id, recover }: { id: string; recover: boolean }) =>
      unwrap(await (recover ? ipc().recording.recover(id) : ipc().recording.dismissRecovery(id))),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['recording-recovery'] }); },
  });
  if (!query.data?.length && !query.error) return null;
  return <section
    className="fixed bottom-24 right-4 z-50 w-[380px] max-w-[calc(100vw-2rem)] rounded-lg border border-border p-4 text-[13px] shadow-md"
    style={{ background: 'var(--surface-raised)', color: 'var(--fg-1)' }}
    aria-label={t('recordingRecovery.recording_recovery')}
  >
    <p className="text-[14px] font-medium">{t('recordingRecovery.unfinished_recordings')}</p>
    <p className="mt-1 mb-2 leading-[1.5]" style={{ color: 'var(--fg-2)' }}>{t('recordingRecovery.audio_was_kept_recover_uses_your_current')}</p>
    {query.data?.map(entry => <div key={entry.id} className="flex items-center gap-2 border-t border-border py-2" data-recovery-entry={entry.id}>
      <div className="min-w-0 flex-1">
        <div className="truncate">{formatWhen(entry.recordedAt ?? entry.updatedAt) || entry.name}</div>
        <div className="truncate text-[12px]" style={{ color: 'var(--fg-muted)' }}>{entry.name} · {formatSize(entry.bytes)}</div>
      </div>
      <Button size="sm" className="h-[28px] px-3 text-[13px]" disabled={action.isPending} onClick={() => action.mutate({ id: entry.id, recover: true })}>{t('recordingRecovery.recover_recording')}</Button>
      <Button size="sm" variant="ghost" className="h-[28px] px-2 text-[13px]" disabled={action.isPending} onClick={() => action.mutate({ id: entry.id, recover: false })}>{t('recordingRecovery.dismiss')}</Button>
    </div>)}
    {(action.error || query.error) && <p role="alert">{(action.error || query.error)?.message}</p>}
  </section>;
}
