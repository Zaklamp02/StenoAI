import { t } from '@/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { Button } from '@/components/ui/button';

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
  return <section className="m-4 rounded-lg border border-border bg-card p-4 text-sm" aria-label={t('recordingRecovery.recording_recovery')}>
    <p className="font-medium">{t('recordingRecovery.unfinished_recordings')}</p>
    <p className="my-2 text-muted-foreground">{t('recordingRecovery.audio_was_kept_recover_uses_your_current')}</p>
    {query.data?.map(entry => <div key={entry.id} className="flex items-center gap-3 py-1">
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      <Button size="sm" disabled={action.isPending} onClick={() => action.mutate({ id: entry.id, recover: true })}>{t('recordingRecovery.recover_recording')}</Button>
      <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ id: entry.id, recover: false })}>{t('recordingRecovery.dismiss')}</Button>
    </div>)}
    {(action.error || query.error) && <p role="alert">{(action.error || query.error)?.message}</p>}
  </section>;
}
