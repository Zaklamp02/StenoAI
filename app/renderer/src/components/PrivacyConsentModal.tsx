import { t } from '@/i18n';
import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { SettingRow } from '@/routes/settings/primitives';
import {
  AnalyticsConsentButtons,
  AnalyticsConsentDetails,
} from '@/components/onboarding/AnalyticsConsent';
import {
  useLaunchOnLoginSetting,
  useMarkPrivacyNoticeSeen,
  useSetLaunchOnLogin,
  useSetTelemetry,
} from '@/hooks/useSettings';

/**
 * One-time privacy question for existing installs: the same analytics choice
 * a fresh install answers on its welcome screen, plus the launch-on-login
 * disclosure for installs predating that setting. Answering either way (or
 * closing the dialog, which counts as "Not now") records the choice and marks
 * the notice seen, so it never reappears.
 *
 * Mounted by App.tsx, which owns the `open` decision: the notice was never
 * seen, or the analytics question was never answered, and the user is not on
 * /setup, which asks the same question itself.
 */
export function PrivacyConsentModal({
  open,
  showLaunchOnLogin,
}: {
  open: boolean;
  showLaunchOnLogin: boolean;
}) {
  const { mutateAsync: markNoticeSeen } = useMarkPrivacyNoticeSeen();
  const setTelemetry = useSetTelemetry();

  const launchOnLogin = useLaunchOnLoginSetting();
  const setLaunchOnLogin = useSetLaunchOnLogin();
  const launchOnLoginEnabled = launchOnLogin.data ?? true;

  // Guard so the mark-seen write fires exactly once even if a button click
  // and the Dialog's onOpenChange(false) both resolve to acknowledge.
  const acknowledgedRef = React.useRef(false);

  const acknowledge = React.useCallback(async () => {
    if (acknowledgedRef.current) return;
    acknowledgedRef.current = true;
    try {
      // Persists the marker and flips the gate query (see the shared hook).
      await markNoticeSeen();
    } catch {
      // Persisting the marker failed (e.g. a config-write error). Unlatch so
      // the user can dismiss again instead of being trapped behind a modal
      // that no longer responds to the buttons, X, or Escape.
      acknowledgedRef.current = false;
    }
  }, [markNoticeSeen]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        // Closing without choosing is a "Not now", recorded like the button.
        if (!acknowledgedRef.current) setTelemetry.mutate({ enabled: false, source: 'consent' });
        void acknowledge();
      }}
    >
      <DialogContent className="max-w-md" data-privacy-consent>
        <DialogHeader>
          <DialogTitle>{t('privacy.title')}</DialogTitle>
          <DialogDescription>{t('privacy.analyticsBody')}</DialogDescription>
        </DialogHeader>

        <div className="mt-1">
          <AnalyticsConsentDetails />
        </div>

        {showLaunchOnLogin && (
          <div className="mt-2">
            <SettingRow
              label="Launch on login"
              description="Start Steno automatically when you log in (hidden in the menu bar)."
              noBorder
            >
              <Switch
                checked={launchOnLoginEnabled}
                onCheckedChange={(v) => setLaunchOnLogin.mutate(v)}
                disabled={launchOnLogin.data === undefined}
                aria-label="Launch on login"
                data-privacy-launch
              />
            </SettingRow>
          </div>
        )}

        <div className="mt-2">
          <AnalyticsConsentButtons source="consent" onAnswered={() => void acknowledge()} />
        </div>
        <p className="text-center text-[12px] text-muted-foreground">{t('setup.welcome.changeLater')}</p>
      </DialogContent>
    </Dialog>
  );
}
