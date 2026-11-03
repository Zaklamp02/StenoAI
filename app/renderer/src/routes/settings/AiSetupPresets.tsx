import * as React from 'react';
import { AudioLines, Check, FileText } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import type { AiProvider, TranscriptionEngine } from '@/lib/ipc';
import { useAiProvider, useSetAiProvider } from '@/hooks/useAi';
import {
  useOpenAiAsrConfig,
  useParakeetModels,
  usePullParakeetModel,
  useSetActiveTranscription,
  useTranscriptionEngine,
  useWhisperModels,
} from '@/hooks/useModels';
import { useOrgSession } from '@/hooks/useOrg';

/**
 * The AI tab's opening choice: where audio and transcripts go. A preset is
 * defined by that data flow, not by a specific model, so picking Private or
 * Balanced keeps Whisper if that is the on-device engine already in use and
 * only leaves the cloud engine when one was active. The stages below stay
 * fully editable; any combination that matches no preset reads as Custom.
 */
export type AiPreset = 'private' | 'balanced' | 'best' | 'custom';

export function presetFor(engine: TranscriptionEngine, provider: AiProvider): AiPreset {
  const localAsr = engine !== 'openai-asr';
  if (localAsr && provider === 'local') return 'private';
  if (localAsr && provider === 'cloud') return 'balanced';
  if (!localAsr && provider === 'cloud') return 'best';
  return 'custom';
}

const PRESETS: { id: Exclude<AiPreset, 'custom'>; title: () => string; body: () => string }[] = [
  {
    id: 'private',
    title: () => t('settings.ai.presets.privateTitle'),
    body: () => t('settings.ai.presets.privateBody'),
  },
  {
    id: 'balanced',
    title: () => t('settings.ai.presets.balancedTitle'),
    body: () => t('settings.ai.presets.balancedBody'),
  },
  {
    id: 'best',
    title: () => t('settings.ai.presets.bestTitle'),
    body: () => t('settings.ai.presets.bestBody'),
  },
];

const CLOUD_NAMES: Record<string, () => string> = {
  openai: () => t('settings.ai.dataFlow.openai'),
  anthropic: () => t('settings.ai.dataFlow.anthropic'),
  bedrock: () => t('settings.ai.dataFlow.bedrock'),
};

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

export function AiSetupPresets() {
  const engineQuery = useTranscriptionEngine();
  const providerQuery = useAiProvider();
  const orgSession = useOrgSession();
  const asrConfig = useOpenAiAsrConfig();
  const parakeet = useParakeetModels();
  const whisper = useWhisperModels();
  const setActive = useSetActiveTranscription();
  const pullParakeet = usePullParakeetModel();
  const setProvider = useSetAiProvider();
  const [confirmCloudAsr, setConfirmCloudAsr] = React.useState(false);

  if (!engineQuery.data || !providerQuery.data) return null;
  const engine = engineQuery.data;
  const provider = (providerQuery.data.ai_provider ?? 'local') as AiProvider;
  const orgSignedIn = orgSession.data?.signedIn ?? false;
  const preset = presetFor(engine, provider);
  const busy = setActive.isPending || pullParakeet.isPending || setProvider.isPending;

  const switchToOnDeviceEngine = () => {
    if (engine !== 'openai-asr') return;
    const parakeetModel = parakeet.data?.models[0];
    const whisperModel = whisper.data?.models[0];
    if (parakeetModel?.installed) setActive.mutate({ engine: 'parakeet' });
    else if (whisperModel?.installed) setActive.mutate({ engine: 'whisper', whisperModel: whisperModel.name });
    else if (parakeetModel) pullParakeet.mutate(parakeetModel.name);
  };

  const choose = (next: Exclude<AiPreset, 'custom'>) => {
    if (next === preset) return;
    if (next === 'best') {
      // Sending audio off-device always needs its own explicit confirmation.
      if (engine !== 'openai-asr') {
        setConfirmCloudAsr(true);
        return;
      }
    } else {
      switchToOnDeviceEngine();
    }
    const nextProvider: AiProvider = next === 'private' ? 'local' : 'cloud';
    if (provider !== nextProvider) setProvider.mutate(nextProvider);
  };

  const cloudName = CLOUD_NAMES[String(providerQuery.data.cloud_provider)];
  const textGoesTo =
    provider === 'local'
      ? t('settings.ai.dataFlow.textLocal')
      : provider === 'remote'
        ? t('settings.ai.dataFlow.textRemote')
        : provider === 'adapter'
          ? t('settings.ai.dataFlow.textOrg')
          : t('settings.ai.dataFlow.textCloud', {
              name: cloudName ? cloudName() : t('settings.ai.dataFlow.yourCloudApi'),
            });
  const audioHost = hostOf(asrConfig.data?.api_url);
  const audioGoesTo =
    engine === 'openai-asr'
      ? audioHost
        ? t('settings.ai.dataFlow.audioCloudHost', { host: audioHost })
        : t('settings.ai.dataFlow.audioCloud')
      : t('settings.ai.dataFlow.audioLocal');

  return (
    <div data-testid="ai-setup-presets">
      {!orgSignedIn && (
        <div
          role="radiogroup"
          aria-label={t('settings.ai.presets.label')}
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {PRESETS.map((option) => {
            const selected = preset === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-preset={option.id}
                disabled={busy}
                onClick={() => choose(option.id)}
                className={cn(
                  'relative flex flex-col justify-start rounded-lg px-3 py-2.5 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
                  !selected && 'hover:bg-[var(--surface-hover)]',
                  busy && 'cursor-wait opacity-70',
                )}
                style={{
                  border: selected ? '1.5px solid var(--fg-1)' : '1px solid var(--border-subtle)',
                  // Keep the text from shifting by the half-pixel border difference.
                  margin: selected ? 0 : '0.5px',
                  background: selected ? 'var(--surface-raised)' : undefined,
                }}
              >
                <div className="flex items-center gap-1.5 text-[14px]" style={{ color: 'var(--fg-1)' }}>
                  <span className="font-medium">{option.title()}</span>
                  {option.id === 'balanced' && (
                    <span
                      className="rounded px-1.5 py-[1px] text-[10.5px] font-medium uppercase"
                      style={{ letterSpacing: '0.05em', color: 'var(--fg-2)', background: 'var(--surface-sunken)' }}
                    >
                      {t('settings.ai.presets.recommended')}
                    </span>
                  )}
                  {selected && <Check className="ml-auto size-3.5 shrink-0" aria-hidden />}
                </div>
                <div className="mt-0.5 text-[12.5px] leading-[1.45]" style={{ color: 'var(--fg-2)' }}>
                  {option.body()}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {!orgSignedIn && preset === 'custom' && (
        <p className="mt-2 text-[12.5px]" style={{ color: 'var(--fg-2)' }} data-testid="ai-preset-custom">
          {t('settings.ai.presets.custom')}
        </p>
      )}

      <ul
        className="mt-3 space-y-1 rounded-lg px-3 py-2.5 text-[12.5px]"
        style={{ background: 'var(--surface-sunken)', color: 'var(--fg-2)' }}
        aria-label={t('settings.ai.dataFlow.label')}
        data-testid="ai-data-flow"
      >
        <li className="flex items-center gap-2">
          <AudioLines className="size-3.5 shrink-0" aria-hidden />
          <span>{audioGoesTo}</span>
        </li>
        <li className="flex items-center gap-2">
          <FileText className="size-3.5 shrink-0" aria-hidden />
          <span>{textGoesTo}</span>
        </li>
      </ul>

      <ConfirmDialog
        open={confirmCloudAsr}
        onOpenChange={setConfirmCloudAsr}
        title={t('settings.ai.cloudAsr.confirmTitle')}
        description={t('settings.ai.cloudAsr.confirmDescription')}
        confirmLabel={t('settings.ai.cloudAsr.confirmAction')}
        onConfirm={() => {
          setConfirmCloudAsr(false);
          setActive.mutate({ engine: 'openai-asr' });
          if (provider !== 'cloud') setProvider.mutate('cloud');
        }}
      />
    </div>
  );
}
