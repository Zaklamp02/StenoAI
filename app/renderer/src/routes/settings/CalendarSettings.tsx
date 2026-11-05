import { t } from '@/i18n';
import * as React from 'react';
import { CalendarDays, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GoogleCalendarIcon } from '@/components/ui/google-calendar-icon';
import { OutlookIcon } from '@/components/ui/outlook-icon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useAppleCalendar,
  useGoogleCalendarAuth,
  useOutlookCalendarAuth,
} from '@/hooks/useCalendarEvents';
import { COMPACT_BTN, SectionHeading, SettingRow } from './primitives';

type OAuthProvider = 'google' | 'outlook';

interface OAuthState {
  provider: OAuthProvider;
  state: 'pending' | 'error';
  message?: string;
}

/**
 * The one place a calendar is connected. StenoAI reads meetings from a
 * single source: Apple Calendar when it is on, otherwise the connected
 * Google or Outlook account (see the Apple Calendar precedence note in
 * main.js). So the group offers a source only while none is connected, and
 * a source that is connected but overridden says so instead of looking
 * active.
 */
export function CalendarSettings() {
  const google = useGoogleCalendarAuth();
  const outlook = useOutlookCalendarAuth();
  const apple = useAppleCalendar();

  const googleConnected = !!google.status.data?.connected;
  const outlookConnected = !!outlook.status.data?.connected;
  const appleConnected = !!apple.status.data?.enabled;

  const [oauth, setOauth] = React.useState<OAuthState | null>(null);

  React.useEffect(() => {
    if (!oauth) return;
    if (oauth.provider === 'google' && googleConnected) setOauth(null);
    if (oauth.provider === 'outlook' && outlookConnected) setOauth(null);
  }, [oauth, googleConnected, outlookConnected]);

  // Synchronous in-flight lock. react-query's isPending only flips true on the
  // NEXT render, so two clicks handled in the same tick both read a stale
  // false and slip past an isPending-based guard; a ref set before the first
  // mutate closes that exact window. The token distinguishes attempts so a
  // superseded attempt's settle (a cancel or a newer startConnect took over)
  // can't release a still-active attempt's lock.
  const connectingRef = React.useRef(false);
  const connectTokenRef = React.useRef(0);

  const startConnect = async (provider: OAuthProvider) => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    const token = ++connectTokenRef.current;
    setOauth({ provider, state: 'pending' });
    try {
      if (provider === 'google') await google.connect.mutateAsync();
      else await outlook.connect.mutateAsync();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A user-initiated Cancel rejects the connect mutation with "Cancelled"
      // (see useGoogleCalendarAuth/useOutlookCalendarAuth) — not an error to
      // surface back to the user.
      if (message === 'Cancelled') return;
      // Only surface the error if THIS attempt is still the active one. The
      // token check catches a cancel-then-immediate-retry of the same provider,
      // where a newer attempt is also `pending`/same-provider — provider+state
      // alone can't tell the stale rejection apart from the fresh dialog. It
      // also covers a dismissed dialog or a switch to a different provider.
      setOauth((current) =>
        connectTokenRef.current === token &&
        current?.provider === provider &&
        current.state === 'pending'
          ? { provider, state: 'error', message }
          : current,
      );
    } finally {
      // Release only if this is still the active attempt — a cancel or a newer
      // startConnect may have superseded it and now owns the lock.
      if (connectTokenRef.current === token) connectingRef.current = false;
    }
  };

  const cancelConnect = () => {
    // Abort the in-flight handshake so we don't leak a loopback OAuth server
    // that could silently complete the connection (and save tokens) after the
    // user has already backed out of the dialog.
    if (oauth?.state === 'pending') {
      if (oauth.provider === 'google') google.cancel.mutate();
      else outlook.cancel.mutate();
    }
    // Release the lock immediately so the user can retry or switch providers
    // without waiting for the abandoned mutation to reject.
    connectingRef.current = false;
    setOauth(null);
  };

  const accountDescription = (email: string | null | undefined) =>
    appleConnected
      ? t('calendarSettings.not_used_while_apple_calendar_is_connected')
      : email
        ? t('calendarSettings.connected_as', { email })
        : t('calendarSettings.connected');

  // One row per connected source, Apple Calendar first because it is the one
  // in use whenever it is on.
  const connected = [
    appleConnected && {
      key: 'apple',
      label: t('calendarSettings.apple_calendar'),
      description: t('calendarSettings.apple_calendar_in_use'),
      icon: <CalendarDays className="size-[13px]" />,
      disconnect: () => apple.disconnect.mutate(),
    },
    outlookConnected && {
      key: 'outlook',
      label: t('calendarSettings.outlook'),
      description: accountDescription(outlook.status.data?.email),
      icon: <OutlookIcon size={13} />,
      disconnect: () => outlook.disconnect.mutate(),
    },
    googleConnected && {
      key: 'google',
      label: t('calendarSettings.google'),
      description: accountDescription(google.status.data?.email),
      icon: <GoogleCalendarIcon size={13} />,
      disconnect: () => google.disconnect.mutate(),
    },
  ].filter((row) => !!row);

  return (
    <div data-calendar-settings>
      <SectionHeading first>{t('calendarSettings.heading')}</SectionHeading>

      {connected.length > 0 ? (
        connected.map((row, i) => (
          <SettingRow
            key={row.key}
            label={row.label}
            description={row.description}
            noBorder={i === connected.length - 1}
          >
            <Button variant="outline" size="sm" className={COMPACT_BTN} onClick={row.disconnect}>
              {row.icon}
              {t('calendarSettings.disconnect')}
            </Button>
          </SettingRow>
        ))
      ) : (
        <SettingRow
          label={t('calendarSettings.connect_a_calendar')}
          description={
            apple.connect.isError
              ? (apple.connect.error as Error).message
              : t('calendarSettings.connect_description')
          }
          align="start"
          noBorder
        >
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className={COMPACT_BTN}
              onClick={() => void startConnect('outlook')}
            >
              <OutlookIcon size={13} />
              {t('calendarSettings.outlook')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={COMPACT_BTN}
              onClick={() => void startConnect('google')}
            >
              <GoogleCalendarIcon size={13} />
              {t('calendarSettings.google')}
            </Button>
            {apple.status.data?.available && (
              <Button
                variant="outline"
                size="sm"
                className={COMPACT_BTN}
                disabled={apple.connect.isPending}
                onClick={() => apple.connect.mutate()}
              >
                <CalendarDays className="size-[13px]" />
                {apple.connect.isPending
                  ? t('calendar.waiting_for_permission')
                  : t('calendarSettings.apple_calendar')}
              </Button>
            )}
          </div>
        </SettingRow>
      )}

      <OAuthPrompt
        state={oauth}
        onClose={cancelConnect}
        onRetry={() => oauth && void startConnect(oauth.provider)}
      />
    </div>
  );
}

interface OAuthPromptProps {
  state: OAuthState | null;
  onClose: () => void;
  onRetry: () => void;
}

function OAuthPrompt({ state, onClose, onRetry }: OAuthPromptProps) {
  const open = !!state;
  const provider =
    state?.provider === 'outlook' ? t('calendarSettings.outlook') : t('calendarSettings.google');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-oauth-prompt>
        <DialogHeader>
          <DialogTitle>
            {state?.state === 'error'
              ? t('calendarSettings.couldnt_connect_to', { provider })
              : t('calendarSettings.connecting_to', { provider })}
          </DialogTitle>
          <DialogDescription>
            {state?.state === 'error'
              ? state.message || t('calendarSettings.the_authorization_flow_did_not_complete')
              : t('calendarSettings.complete_the_authorization_in_your_browser')}
          </DialogDescription>
        </DialogHeader>

        {state?.state === 'pending' && (
          <div className="flex items-center gap-3 rounded-md border border-border bg-paper-0 p-3 text-sm text-muted-foreground dark:bg-paper-1">
            <Loader2 className="size-4 animate-spin text-foreground" />
            <span className="flex-1">{t('calendarSettings.waiting_for_authorization')}</span>
            <ExternalLink className="size-3.5" />
          </div>
        )}

        <DialogFooter>
          {state?.state === 'error' ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {t('calendarSettings.close')}
              </Button>
              <Button onClick={onRetry}>{t('calendarSettings.try_again')}</Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>
              {t('calendarSettings.cancel')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
