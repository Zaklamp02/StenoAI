import { FileAudio, Loader2, Play, Square } from 'lucide-react';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ProcessingBadge, formatTime } from '@/components/home/PreviousRow';
import type { WatchedFile, WatchedFileStatus } from '@/lib/ipc';
import { navigate } from '@/lib/router';

export type AudioAction = 'transcribe' | 'dismiss' | 'restore';

// Literal keys, so the i18n copy inventory can see every status label.
// Processing shows the shared badge instead, and a 'done' file is normally
// not listed (by then the recording is its note), so neither has a label.
const STATUS_LABEL: Partial<Record<WatchedFileStatus, () => string>> = {
  syncing: () => t('watchedFolders.status.syncing'),
  new: () => t('watchedFolders.status.new'),
  failed: () => t('watchedFolders.status.failed'),
  dismissed: () => t('watchedFolders.status.dismissed'),
};

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface AudioRowProps {
  file: WatchedFile;
  folderName: string;
  /** The folder auto-transcribes new files (this one predates that). */
  folderAuto: boolean;
  busy: boolean;
  isRecording: boolean;
  onAction: (type: AudioAction) => void;
  playState: 'idle' | 'loading' | 'playing';
  playFailed: boolean;
  onPlay: () => void;
}

/** A watched-folder recording that is not a note (yet), in the notes list:
 *  waiting to be transcribed, still syncing, being transcribed, failed, or
 *  dismissed. Same footprint as PreviousRow so the list reads as one. */
export function AudioRow({ file, folderName, folderAuto, busy, isRecording, onAction, playState, playFailed, onPlay }: AudioRowProps) {
  const processing = file.status === 'processing';
  const actionable = file.status === 'new' || file.status === 'failed';
  const label = STATUS_LABEL[file.status];
  return (
    <div
      className="group relative flex items-center justify-between gap-3 py-[10px] -mx-3 px-3 rounded-lg transition-colors hover:bg-[color:var(--surface-hover)]"
      data-testid="audio-row"
      data-watched-file={file.name}
      data-status={file.status}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <button
          type="button"
          className="flex size-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-50"
          style={{ background: 'var(--surface-sunken)', color: 'var(--fg-2)' }}
          disabled={file.status === 'syncing'}
          onClick={onPlay}
          aria-label={playState === 'playing' ? t('watchedFolders.stopPreview') : t('watchedFolders.playPreview')}
          title={playFailed ? t('watchedFolders.previewFailed') : t('watchedFolders.playPreview')}
        >
          {playState === 'loading' ? <Loader2 className="size-[14px] animate-spin" />
            : playState === 'playing' ? <Square className="size-[13px]" />
            : file.status === 'syncing' || playFailed ? <FileAudio className="size-[15px]" />
            : <Play className="size-[14px]" />}
        </button>

        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-[13.5px] font-medium tracking-[-0.005em]" style={{ color: 'var(--fg-1)' }}>
              {t('watchedFolders.rowTitle', { folder: folderName })}
            </div>
            {processing && <ProcessingBadge />}
            {label && (
              <span
                className="inline-flex shrink-0 whitespace-nowrap px-2 py-0.5 text-[11px] font-medium"
                style={{ background: 'var(--surface-sunken)', color: 'var(--fg-2)', borderRadius: 'var(--radius-sm)' }}
                title={file.status === 'new' && folderAuto ? t('watchedFolders.beforeAuto') : undefined}
              >
                {label()}
              </span>
            )}
          </div>
          <div className="truncate text-[12px] font-medium" style={{ color: 'var(--fg-muted)' }} title={file.relPath}>
            {file.relPath} · {formatSize(file.size)}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {processing && (
          <Button variant="ghost" size="sm" className="h-[28px] px-3 text-[13px]" onClick={() => navigate('/meetings/processing')}>
            {t('watchedFolders.viewProgress')}
          </Button>
        )}
        {actionable && (
          <Button
            variant="outline"
            size="sm"
            className="h-[28px] px-3 text-[13px]"
            disabled={busy || isRecording}
            title={isRecording ? t('watchedFolders.recordingBlocked') : undefined}
            onClick={() => onAction('transcribe')}
          >
            {file.status === 'failed' ? t('watchedFolders.retry') : t('watchedFolders.transcribe')}
          </Button>
        )}
        {actionable && (
          <Button variant="ghost" size="sm" className="h-[28px] px-3 text-[13px]" disabled={busy} onClick={() => onAction('dismiss')}>
            {t('watchedFolders.dismiss')}
          </Button>
        )}
        {file.status === 'dismissed' && (
          <Button variant="ghost" size="sm" className="h-[28px] px-3 text-[13px]" disabled={busy} onClick={() => onAction('restore')}>
            {t('watchedFolders.restore')}
          </Button>
        )}
        <span className="w-[44px] text-right text-[12.5px] tabular-nums" style={{ color: 'var(--fg-2)' }}>
          {formatTime(file.recordedAt) ?? ''}
        </span>
      </div>
    </div>
  );
}
