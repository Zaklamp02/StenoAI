import { t, type TranslationKey } from '@/i18n';
import * as React from 'react';
import { FileAudio, Loader2, Play, Square } from 'lucide-react';
import { MeetingsShell } from '@/components/MeetingsShell';
import { Button } from '@/components/ui/button';
import { useRecording } from '@/hooks/useRecording';
import { useBlobAudioPlayback } from '@/hooks/useBlobAudioPlayback';
import { unwrap } from '@/lib/result';
import { useWatchedFolderAction, useWatchedFolders } from '@/hooks/useWatchedFolders';
import { navigate } from '@/lib/router';
import { UI_LOCALE } from '@/lib/locale';
import { ipc, type WatchedFile } from '@/lib/ipc';

type Filter = 'new' | 'all';

const SELECTABLE = new Set(['new', 'failed', 'dismissed']);

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatRecordedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(UI_LOCALE, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** The Recordings inbox: audio from watched folders, where the user picks what
 *  becomes a meeting. Only reachable once a folder is configured. */
export function Recordings() {
  const watched = useWatchedFolders();
  const action = useWatchedFolderAction();
  const { status } = useRecording();
  const isRecording = status === 'recording' || status === 'paused';
  const [filter, setFilter] = React.useState<Filter>('new');
  const playback = useBlobAudioPlayback(async (id: string) => unwrap(await ipc().watchedFolders.preview(id)).audioBase64);
  const [picked, setSelected] = React.useState<Set<string>>(() => new Set());

  const folders = watched.data?.folders ?? [];
  const files = React.useMemo(
    () => [...(watched.data?.files ?? [])].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
    [watched.data],
  );
  const visible = files.filter((f) => filter === 'all' || f.status === 'new' || f.status === 'syncing' || f.status === 'processing');

  // A pick that got processed or left the folder no longer counts.
  const selected = new Set([...picked].filter((id) => files.some((f) => f.id === id && SELECTABLE.has(f.status))));

  const toggle = (id: string) => setSelected(() => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const run = (type: 'transcribe' | 'dismiss' | 'restore', ids: string[]) => {
    action.mutate({ type, ids }, { onSuccess: () => setSelected(new Set()) });
  };

  const selectable = visible.filter((f) => SELECTABLE.has(f.status));

  return (
    <MeetingsShell activeSummaryFile={null}>
      <div className="mx-auto w-full max-w-[760px] py-10" style={{ color: 'var(--fg-1)' }} data-route="recordings">
        <h1 className="text-[32px] leading-tight tracking-tight" style={{ fontFamily: 'var(--font-serif)' }}>
          {t('watchedFolders.nav')}
        </h1>
        <p className="mt-4 max-w-[580px] text-sm leading-relaxed" style={{ color: 'var(--fg-2)' }}>
          {t('watchedFolders.intro')}{' '}
          <button type="button" className="underline" onClick={() => navigate('/settings?tab=integrations')}>
            {t('watchedFolders.manage')}
          </button>
        </p>

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="flex gap-1" role="tablist">
            {(['new', 'all'] as const).map((f) => (
              <Button
                key={f}
                role="tab"
                aria-selected={filter === f}
                variant={filter === f ? 'secondary' : 'ghost'}
                size="sm"
                className="h-[28px] px-3 text-[13px]"
                onClick={() => setFilter(f)}
              >
                {t(f === 'new' ? 'watchedFolders.filterNew' : 'watchedFolders.filterAll')}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {selectable.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-[28px] px-3 text-[13px]"
                onClick={() => setSelected(new Set(selectable.map((f) => f.id)))}
              >
                {t('watchedFolders.selectAll')}
              </Button>
            )}
            {selected.size > 0 && (
              <Button
                size="sm"
                className="h-[28px] px-3 text-[13px]"
                disabled={isRecording || action.isPending}
                title={isRecording ? t('watchedFolders.recordingBlocked') : undefined}
                onClick={() => run('transcribe', [...selected])}
              >
                {t('watchedFolders.transcribeSelected', { count: selected.size })}
              </Button>
            )}
          </div>
        </div>
        {action.error && <p role="alert" className="mt-3 text-sm">{action.error.message}</p>}

        {folders.map((folder) => {
          const rows = visible.filter((f) => f.folderId === folder.id);
          return (
            <section key={folder.id} className="mt-8" data-watched-inbox={folder.name}>
              <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold tracking-[0.01em]" style={{ color: 'var(--fg-2)' }}>
                {folder.name}
                {folder.autoTranscribe && (
                  <span className="text-[12px] font-normal" style={{ color: 'var(--fg-muted)' }}>· {t('watchedFolders.autoOn')}</span>
                )}
              </h2>
              {!folder.available ? (
                <p className="text-sm" style={{ color: 'var(--fg-2)' }}>{t('watchedFolders.unavailable')}</p>
              ) : rows.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--fg-2)' }}>
                  {t(filter === 'new' ? 'watchedFolders.emptyNew' : 'watchedFolders.emptyAll')}
                </p>
              ) : (
                <div className="flex flex-col">
                  {rows.map((file) => (
                    <RecordingRow
                      key={file.id}
                      file={file}
                      checked={selected.has(file.id)}
                      onToggle={() => toggle(file.id)}
                      busy={action.isPending}
                      isRecording={isRecording}
                      onAction={(type) => run(type, [file.id])}
                      playState={playback.pendingKey === file.id ? 'loading' : playback.playingKey === file.id ? 'playing' : 'idle'}
                      playFailed={playback.errorKey === file.id}
                      onPlay={() => { void playback.toggle(file.id); }}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </MeetingsShell>
  );
}

function RecordingRow({
  file,
  checked,
  onToggle,
  busy,
  isRecording,
  onAction,
  playState,
  playFailed,
  onPlay,
}: {
  file: WatchedFile;
  checked: boolean;
  onToggle: () => void;
  busy: boolean;
  isRecording: boolean;
  onAction: (type: 'transcribe' | 'dismiss' | 'restore') => void;
  playState: 'idle' | 'loading' | 'playing';
  playFailed: boolean;
  onPlay: () => void;
}) {
  const selectable = SELECTABLE.has(file.status);
  const statusKey = `watchedFolders.status.${file.status}` as TranslationKey;
  return (
    <div
      className="flex items-center gap-3 py-2.5"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
      data-watched-file={file.name}
      data-status={file.status}
    >
      <input
        type="checkbox"
        className="size-[14px] shrink-0"
        checked={checked}
        disabled={!selectable}
        onChange={onToggle}
        aria-label={file.name}
      />
      <button
        type="button"
        className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40"
        style={{ color: 'var(--fg-2)' }}
        disabled={file.status === 'syncing'}
        onClick={onPlay}
        aria-label={t(playState === 'playing' ? 'watchedFolders.stopPreview' : 'watchedFolders.playPreview')}
        title={playFailed ? t('watchedFolders.previewFailed') : t('watchedFolders.playPreview')}
      >
        {playState === 'loading' ? <Loader2 className="size-[13px] animate-spin" />
          : playState === 'playing' ? <Square className="size-[12px]" />
          : playFailed ? <FileAudio className="size-[13px]" /> : <Play className="size-[13px]" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px]" title={file.relPath}>{formatRecordedAt(file.recordedAt)}</div>
        <div className="truncate text-[12px]" style={{ color: 'var(--fg-muted)' }}>
          {file.relPath} · {formatSize(file.size)}
        </div>
      </div>
      {file.status !== 'new' && (
        <span className="shrink-0 text-[12px]" style={{ color: 'var(--fg-2)' }}>{t(statusKey)}</span>
      )}
      <div className="flex shrink-0 gap-1">
        {(file.status === 'new' || file.status === 'failed') && (
          <Button
            variant="outline"
            size="sm"
            className="h-[28px] px-3 text-[13px]"
            disabled={busy || isRecording}
            title={isRecording ? t('watchedFolders.recordingBlocked') : undefined}
            onClick={() => onAction('transcribe')}
          >
            {t(file.status === 'failed' ? 'watchedFolders.retry' : 'watchedFolders.transcribe')}
          </Button>
        )}
        {(file.status === 'new' || file.status === 'failed') && (
          <Button variant="ghost" size="sm" className="h-[28px] px-3 text-[13px]" disabled={busy} onClick={() => onAction('dismiss')}>
            {t('watchedFolders.dismiss')}
          </Button>
        )}
        {file.status === 'dismissed' && (
          <Button variant="ghost" size="sm" className="h-[28px] px-3 text-[13px]" disabled={busy} onClick={() => onAction('restore')}>
            {t('watchedFolders.restore')}
          </Button>
        )}
        {file.status === 'done' && file.summaryFile && (
          <Button
            variant="ghost"
            size="sm"
            className="h-[28px] px-3 text-[13px]"
            onClick={() => navigate(`/meetings/${encodeURIComponent(file.summaryFile!)}`)}
          >
            {t('watchedFolders.openNote')}
          </Button>
        )}
      </div>
    </div>
  );
}
