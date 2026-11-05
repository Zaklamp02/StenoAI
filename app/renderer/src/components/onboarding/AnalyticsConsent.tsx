import { t } from '@/i18n';
import * as React from 'react';
import { Check, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Muted } from '@/components/ui/typography';
import { useSetSpeakerFeedbackSharing, useSetTelemetry } from '@/hooks/useSettings';
import type { TelemetryToggleSource } from '@/lib/ipc';

/**
 * What anonymous usage data contains, in two short lists. Shared by the
 * first-run welcome screen and the upgrade prompt so the promise a user
 * agrees to reads the same in both places.
 */
export function AnalyticsConsentDetails() {
  const sent = [
    t('analyticsConsent.sentFeatures'),
    t('analyticsConsent.sentPipeline'),
    t('analyticsConsent.sentSpeakerFeedback'),
    t('analyticsConsent.sentErrors'),
  ];
  const neverSent = [
    t('analyticsConsent.neverContent'),
    t('analyticsConsent.neverPeople'),
  ];
  return (
    <div className="grid gap-3 text-left sm:grid-cols-2" data-analytics-consent-details>
      <div>
        <div className="mb-1.5 text-[12px] font-medium text-foreground">
          {t('analyticsConsent.sentHeading')}
        </div>
        <ul className="space-y-1">
          {sent.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-foreground" aria-hidden />
              <Muted className="text-[12px]">{item}</Muted>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="mb-1.5 text-[12px] font-medium text-foreground">
          {t('analyticsConsent.neverHeading')}
        </div>
        <ul className="space-y-1">
          {neverSent.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <Muted className="text-[12px]">{item}</Muted>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The two answers to the analytics question. Sharing is the primary button
 * and "Not now" a quiet one beside it: the nudge is in the weight, never in a
 * pre-made choice, so either way the user clicks for themselves. Both answers
 * are recorded (set-telemetry stores that a choice was made), so the question
 * is asked once per install. Sharing covers everything the details list,
 * speaker-review feedback included; Settings -> Advanced separates them.
 */
export function AnalyticsConsentButtons({
  source,
  onAnswered,
}: {
  source: TelemetryToggleSource;
  onAnswered?: (enabled: boolean) => void;
}) {
  const setTelemetry = useSetTelemetry();
  const { mutateAsync: setSpeakerFeedback } = useSetSpeakerFeedbackSharing();
  const { mutateAsync: setUsage } = setTelemetry;
  const answer = React.useCallback(
    async (enabled: boolean) => {
      try {
        await setUsage({ enabled, source });
        if (enabled) await setSpeakerFeedback(true);
      } catch {
        // The upgrade prompt asks again on a later launch if this did not stick.
      } finally {
        onAnswered?.(enabled);
      }
    },
    [onAnswered, setSpeakerFeedback, setUsage, source],
  );
  return (
    <div className="flex flex-col-reverse items-center gap-2 sm:flex-row sm:justify-center">
      <Button
        variant="ghost"
        size="lg"
        onClick={() => void answer(false)}
        disabled={setTelemetry.isPending}
        data-analytics-decline
      >
        {t('analyticsConsent.notNow')}
      </Button>
      <Button
        size="lg"
        onClick={() => void answer(true)}
        disabled={setTelemetry.isPending}
        autoFocus
        data-analytics-accept
      >
        {t('analyticsConsent.accept')}
      </Button>
    </div>
  );
}
