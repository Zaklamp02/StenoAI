import { t } from '@/i18n';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useWatchedFolderAction, useWatchedFolders } from '@/hooks/useWatchedFolders';
import { COMPACT_BTN, SectionHeading } from './primitives';

/** Settings → Integrations → Recording folders: the folders the Recordings
 *  inbox reads, each with an optional auto-transcribe switch. */
export function WatchedFoldersSection() {
  const watched = useWatchedFolders();
  const action = useWatchedFolderAction();
  const folders = watched.data?.folders ?? [];

  return (
    <section data-settings-section="watched-folders">
      <SectionHeading>{t('watchedFolders.heading')}</SectionHeading>
      <div
        className="flex items-start justify-between gap-6 pb-4"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="min-w-0 flex-1 text-[13px] leading-[1.5]" style={{ color: 'var(--fg-2)' }}>
          {t('watchedFolders.description')}
        </div>
        <Button
          variant="outline"
          size="sm"
          className={`${COMPACT_BTN} shrink-0`}
          disabled={action.isPending}
          onClick={() => action.mutate({ type: 'add' })}
        >
          {t('watchedFolders.add')}
        </Button>
      </div>

      {folders.map((folder) => (
        <div
          key={folder.id}
          data-watched-folder={folder.name}
          className="flex items-start justify-between gap-6 py-4"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[14px]" style={{ color: 'var(--fg-1)' }}>
              <FolderOpen size={14} aria-hidden />
              {folder.name}
            </div>
            <code
              className="mt-[2px] block max-w-full truncate select-all font-mono text-[12px]"
              style={{ color: 'var(--fg-2)' }}
              title={folder.path}
            >
              {folder.path}
            </code>
            {!folder.available && (
              <div className="mt-1 text-[13px]" style={{ color: 'var(--fg-2)' }}>{t('watchedFolders.unavailable')}</div>
            )}
            <label className="mt-3 flex items-center gap-2 text-[13px]" style={{ color: 'var(--fg-1)' }}>
              <Switch
                checked={folder.autoTranscribe}
                disabled={action.isPending}
                onCheckedChange={(enabled) => action.mutate({ type: 'auto', id: folder.id, enabled })}
                aria-label={`${t('watchedFolders.auto')}: ${folder.name}`}
              />
              {t('watchedFolders.auto')}
            </label>
            {folder.autoTranscribe && (
              <div className="mt-1 text-[12px]" style={{ color: 'var(--fg-muted)' }}>{t('watchedFolders.autoHint')}</div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className={`${COMPACT_BTN} shrink-0`}
            disabled={action.isPending}
            onClick={() => action.mutate({ type: 'remove', id: folder.id })}
          >
            {t('watchedFolders.remove')}
          </Button>
        </div>
      ))}

      {action.error && <p role="alert" className="py-3 text-sm">{action.error.message}</p>}
    </section>
  );
}
