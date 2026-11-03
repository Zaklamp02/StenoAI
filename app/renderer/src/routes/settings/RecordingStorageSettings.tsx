import * as React from 'react';
import { Switch } from '@/components/ui/switch';
import { t } from '@/i18n';
import { ipc } from '@/lib/ipc';
import { useKeepRecordingsSetting, useSetKeepRecordings } from '@/hooks/useSettings';
import { SettingRow } from './primitives';

/** Keep the audio after processing, and optionally cap the space it uses. */
export function RecordingStorageSettings() {
  const keepRecordings = useKeepRecordingsSetting();
  const setKeepRecordings = useSetKeepRecordings();
  return (
    <>
      <SettingRow
        label="Save recordings"
        description="Save audio files to your storage location (see Advanced) after processing. Uses 1–10 MB per minute depending on capture mode."
      >
        <Switch
          checked={keepRecordings.data ?? false}
          onCheckedChange={(v) => setKeepRecordings.mutate(v)}
          disabled={keepRecordings.data === undefined}
        />
      </SettingRow>
      {keepRecordings.data && <AudioStorageLimitSetting />}
    </>
  );
}

// Slider stops for the recordings disk cap; the last stop means no limit.
const AUDIO_LIMIT_STOPS_MB = [100, 250, 500, 1000, 2000, 5000, 10000, 20000, null] as const;

function formatMb(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB` : `${Math.round(mb)} MB`;
}

/**
 * Optional cap on the space kept recordings use. Past it, the oldest audio is
 * deleted after each processed meeting; notes and transcripts stay.
 */
export function AudioStorageLimitSetting() {
  const [state, setState] = React.useState<{ limitMb: number | null; usedBytes: number } | null>(null);
  const [index, setIndex] = React.useState(AUDIO_LIMIT_STOPS_MB.length - 1);
  React.useEffect(() => {
    void ipc().settings.getAudioStorage().then((res) => {
      if (!res.success) return;
      setState(res);
      const at = AUDIO_LIMIT_STOPS_MB.findIndex((mb) => mb === res.limitMb);
      setIndex(at === -1 ? AUDIO_LIMIT_STOPS_MB.length - 1 : at);
    });
  }, []);
  const save = (next: number) => {
    void ipc().settings.setAudioStorage(AUDIO_LIMIT_STOPS_MB[next] ?? null).then((res) => {
      if (res.success) setState(res);
    });
  };
  const stop = AUDIO_LIMIT_STOPS_MB[index] ?? null;
  const used = state ? formatMb(state.usedBytes / 1_000_000) : '…';
  return (
    <SettingRow
      label={t('aiTab.recordings_storage_limit')}
      description={t('aiTab.when_saved_audio_passes_this_size_the', { used: used })}
    >
      <div className="flex w-[220px] items-center gap-3">
        <input
          type="range"
          min={0}
          max={AUDIO_LIMIT_STOPS_MB.length - 1}
          step={1}
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          onPointerUp={(e) => save(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => save(Number((e.target as HTMLInputElement).value))}
          disabled={!state}
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

