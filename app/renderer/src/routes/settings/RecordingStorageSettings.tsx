import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { t } from '@/i18n';
import { ipc, type AudioStorageState } from '@/lib/ipc';
import { isMac } from '@/lib/utils';
import { useKeepRecordingsSetting, useSetKeepRecordings } from '@/hooks/useSettings';
import { COMPACT_BTN, SettingRow } from './primitives';

/**
 * Keep the audio after processing, see what the kept audio uses (and open its
 * folder), and optionally cap the space it uses.
 */
export function RecordingStorageSettings() {
  const keepRecordings = useKeepRecordingsSetting();
  const setKeepRecordings = useSetKeepRecordings();
  const [storage, setStorage] = React.useState<AudioStorageState | null>(null);
  const keep = keepRecordings.data ?? false;

  // Re-read when the switch changes, so the summary is current once shown.
  React.useEffect(() => {
    let cancelled = false;
    // Inside the chain, so a missing bridge only leaves the summary at "…".
    void Promise.resolve()
      .then(() => ipc().settings.getAudioStorage())
      .then((res) => {
        if (!cancelled && res.success) setStorage(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [keep]);

  return (
    <>
      <SettingRow
        label="Save recordings"
        description="Save audio files to your storage location (see Advanced) after processing. Uses 1–10 MB per minute depending on capture mode."
      >
        <Switch
          checked={keep}
          onCheckedChange={(v) => setKeepRecordings.mutate(v)}
          disabled={keepRecordings.data === undefined}
        />
      </SettingRow>
      {/* Also shown with saving off while earlier recordings are still there. */}
      {(keep || (storage?.count ?? 0) > 0) && <SavedRecordingsSummary storage={storage} />}
      {keep && <AudioStorageLimitSetting storage={storage} onChange={setStorage} />}
    </>
  );
}

// Slider stops for the recordings disk cap; the last stop means no limit.
const AUDIO_LIMIT_STOPS_MB = [100, 250, 500, 1000, 2000, 5000, 10000, 20000, null] as const;

function formatMb(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB` : `${Math.round(mb)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function savedRecordingsDescription(storage: AudioStorageState | null): string {
  if (!storage) return '…';
  if (storage.count === 0 || !storage.oldestAt) return t('recordingStorage.summary_none');
  const params = {
    count: storage.count,
    size: formatMb(storage.usedBytes / 1_000_000),
    date: formatDate(storage.oldestAt),
  };
  return storage.count === 1
    ? t('recordingStorage.summary_one', params)
    : t('recordingStorage.summary_other', params);
}

/** How many recordings are kept, their size and age, and their folder. */
function SavedRecordingsSummary({ storage }: { storage: AudioStorageState | null }) {
  const [openError, setOpenError] = React.useState<string | null>(null);
  const open = () => {
    setOpenError(null);
    void ipc()
      .settings.openRecordingsFolder()
      .then((res) => {
        if (!res.success) setOpenError(res.error ?? t('recordingStorage.open_failed'));
      })
      .catch(() => setOpenError(t('recordingStorage.open_failed')));
  };
  return (
    <SettingRow
      label={t('recordingStorage.saved_recordings')}
      description={openError ?? savedRecordingsDescription(storage)}
    >
      <Button variant="outline" size="sm" className={COMPACT_BTN} onClick={open} data-testid="open-recordings-folder">
        {isMac ? t('recordingStorage.show_in_finder') : t('recordingStorage.open_folder')}
      </Button>
    </SettingRow>
  );
}

/**
 * Optional cap on the space kept recordings use. Past it, the oldest audio is
 * deleted after each processed meeting; notes and transcripts stay.
 */
function AudioStorageLimitSetting({
  storage,
  onChange,
}: {
  storage: AudioStorageState | null;
  onChange: (next: AudioStorageState) => void;
}) {
  // The saved limit's stop, unless the slider is being moved.
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const savedAt = AUDIO_LIMIT_STOPS_MB.findIndex((mb) => mb === (storage?.limitMb ?? null));
  const index = dragIndex ?? (savedAt === -1 ? AUDIO_LIMIT_STOPS_MB.length - 1 : savedAt);
  const save = (next: number) => {
    void ipc()
      .settings.setAudioStorage(AUDIO_LIMIT_STOPS_MB[next] ?? null)
      .then((res) => {
        if (res.success) onChange(res);
      })
      .catch(() => {})
      .finally(() => setDragIndex(null));
  };
  const stop = AUDIO_LIMIT_STOPS_MB[index] ?? null;
  return (
    <SettingRow
      label={t('aiTab.recordings_storage_limit')}
      description={t('aiTab.when_saved_audio_passes_this_size_the')}
    >
      <div className="flex w-[220px] items-center gap-3">
        <input
          type="range"
          min={0}
          max={AUDIO_LIMIT_STOPS_MB.length - 1}
          step={1}
          value={index}
          onChange={(e) => setDragIndex(Number(e.target.value))}
          onPointerUp={(e) => save(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => save(Number((e.target as HTMLInputElement).value))}
          disabled={!storage}
          aria-label={t('aiTab.recordings_storage_limit')}
          data-testid="audio-storage-limit"
          className="w-full accent-[color:var(--fg-1)]"
        />
        <span className="w-[64px] shrink-0 text-right text-[13px] tabular-nums" style={{ color: 'var(--fg-1)' }}>
          {stop === null ? t('aiTab.no_limit') : formatMb(stop)}
        </span>
      </div>
    </SettingRow>
  );
}
