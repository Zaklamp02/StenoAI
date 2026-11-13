import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isMac, shortcut } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';
import { RecordingStorageSettings } from './RecordingStorageSettings';
import {
  useAutoDetectMeetingsSetting,
  useAutoInstallWhenIdleSetting,
  useDockIconSetting,
  useLaunchOnLoginSetting,
  useMicrophoneSetting,
  useNotificationsSetting,
  usePremeetingNotificationsSetting,
  useRecordHotkeySetting,
  useSetAutoDetectMeetings,
  useSetAutoInstallWhenIdle,
  useSetDockIcon,
  useSetLaunchOnLogin,
  useSetMicrophone,
  useSetNotifications,
  useSetRecordHotkey,
  useSetPremeetingNotifications,
  useSetShowMenuBarIcon,
  useSetSilenceAutoStopEnabled,
  useSetSilenceAutoStopMinutes,
  useSetSystemAudio,
  useSetUserName,
  useShowMenuBarIconSetting,
  useSilenceAutoStopSetting,
  useSystemAudioSetting,
  useSystemAudioSupport,
  useUserName,
} from '@/hooks/useSettings';
import { useAudioInputDevices } from '@/hooks/useAudioInputDevices';
import { COMPACT_TRIGGER, SectionHeading, SettingRow } from './primitives';

const DEFAULT_MIC_VALUE = 'default';

export function GeneralTab() {
  const { theme, setTheme } = useTheme();
  const notifications = useNotificationsSetting();
  const setNotifications = useSetNotifications();
  const premeetingNotifications = usePremeetingNotificationsSetting();
  const setPremeetingNotifications = useSetPremeetingNotifications();
  const systemAudio = useSystemAudioSetting();
  const setSystemAudio = useSetSystemAudio();
  const systemAudioSupport = useSystemAudioSupport();
  const systemAudioDescription = (() => {
    if (systemAudioSupport.data && !systemAudioSupport.data.supported) {
      return `Capture both sides of a call (requires macOS 14.4+, you're on ${systemAudioSupport.data.osVersion || 'an older version'}). Mic-only recording still works.`;
    }
    return 'Capture both sides of a call. Turn off to record your mic only.';
  })();
  const autoDetect = useAutoDetectMeetingsSetting();
  const setAutoDetect = useSetAutoDetectMeetings();
  // Auto-detect is a macOS-14+ feature (the mic-monitor binary is macOS-only and
  // only has a reliable per-app signal on 14+ — see #116). Mirror main's
  // isAutoDetectSupported() exactly so the toggle isn't a no-op-but-enabled
  // control: non-darwin is unsupported (main never spawns the watcher there), and
  // darwin < 14 is unsupported. While the probe is loading (data undefined) we
  // don't disable (matching the other rows); a darwin osVersion that won't parse
  // stays permissive (a real 14+ user must never lose the feature over a hiccup).
  const autoDetectSupported = (() => {
    const data = systemAudioSupport.data;
    if (!data) return true; // probe still loading — don't disable prematurely
    if (data.platform !== 'darwin') return false; // macOS-only feature
    const major = parseInt(String(data.osVersion).split('.')[0], 10);
    if (!Number.isFinite(major)) return true; // permissive on parse failure
    return major >= 14;
  })();
  const launchOnLogin = useLaunchOnLoginSetting();
  const setLaunchOnLogin = useSetLaunchOnLogin();
  const autoInstallWhenIdle = useAutoInstallWhenIdleSetting();
  const setAutoInstallWhenIdle = useSetAutoInstallWhenIdle();
  const recordHotkey = useRecordHotkeySetting();
  const setRecordHotkey = useSetRecordHotkey();
  const recordAccel = shortcut('⌘⇧R', 'Ctrl+Shift+R');
  const silenceAutoStop = useSilenceAutoStopSetting();
  const setSilenceAutoStopEnabled = useSetSilenceAutoStopEnabled();
  const setSilenceAutoStopMinutes = useSetSilenceAutoStopMinutes();
  const dockIcon = useDockIconSetting();
  const setDockIcon = useSetDockIcon();
  const menuBarIcon = useShowMenuBarIconSetting();
  const setMenuBarIcon = useSetShowMenuBarIcon();
  const microphone = useMicrophoneSetting();
  const setMicrophone = useSetMicrophone();
  const audioInputDevices = useAudioInputDevices();
  const userName = useUserName();
  const setUserName = useSetUserName();
  const [nameDraft, setNameDraft] = React.useState('');
  const nameSeededRef = React.useRef(false);
  // Tracks in-flight typing so a late initial fetch can't clobber the user's
  // draft. Set on the first edit, and released again by persistName on blur —
  // the danger window is only mount → first commit, so once the edit is
  // committed the seeding effect is free to re-sync from userName.data.
  const nameDirtyRef = React.useRef(false);
  // Wait for the real query (not the sessionStorage placeholder) before
  // seeding — otherwise we lock onto a stale empty string and ignore the
  // canonical value when it arrives from disk.
  React.useEffect(() => {
    if (nameSeededRef.current) return;
    if (nameDirtyRef.current) return;
    if (userName.isPending || userName.isPlaceholderData) return;
    if (userName.data !== undefined) {
      setNameDraft(userName.data);
      nameSeededRef.current = true;
    }
  }, [userName.data, userName.isPending, userName.isPlaceholderData]);
  const persistName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed !== (userName.data ?? '')) {
      setUserName.mutate(trimmed);
    }
    // The editing session is over (committed on blur/Enter), so there's no more
    // in-flight typing to protect. Release the dirty guard so the seeding effect
    // can re-sync from any later userName.data change — the backend's canonical
    // value, or a refetch after the mutation invalidates. Otherwise a no-op
    // commit (draft equal to the not-yet-resolved placeholder) would leave the
    // guard stuck and the field stranded on a stale/blank draft.
    nameDirtyRef.current = false;
  };

  // Both the menu bar icon and the dock icon are ways back into a hidden
  // window (see Sidebar's requestSingleInstanceLock recovery via
  // Applications/Spotlight relaunch) — hiding both isn't blocked, just
  // called out, since it's easy to miss that the recovery path still works.
  const bothIconsHidden = (dockIcon.data ?? false) && !(menuBarIcon.data ?? true);

  return (
    <section data-settings-tab="general">
      <SettingRow
        label="Your name"
        description="First name only — used for in-app greetings. Stored locally."
      >
        <Input
          value={nameDraft}
          onChange={(e) => {
            nameDirtyRef.current = true;
            setNameDraft(e.target.value);
          }}
          onBlur={persistName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              // Just blur — onBlur runs persistName, so calling it directly
              // here would queue a duplicate setUserName mutation.
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Your name"
          autoComplete="given-name"
          className="h-[30px] w-[180px] rounded-[6px] bg-[color:var(--surface-raised)] text-[13px]"
          data-testid="user-name-input"
        />
      </SettingRow>

      <SettingRow
        label="Appearance"
        description="Choose light, dark, or match your system"
        noBorder
      >
        <Select
          value={theme}
          onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}
        >
          <SelectTrigger
            className={COMPACT_TRIGGER}
            data-testid="theme-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SectionHeading>Meeting notifications</SectionHeading>

      <SettingRow
        label="Scheduled meetings"
        description="Show a notification before meetings start, based on your calendar."
      >
        <Switch
          checked={premeetingNotifications.data ?? true}
          onCheckedChange={(v) => setPremeetingNotifications.mutate(v)}
          disabled={premeetingNotifications.data === undefined}
        />
      </SettingRow>

      <SettingRow
        label="Auto-detected meetings"
        description={
          autoDetectSupported
            ? 'Watch for other apps using your microphone and notify you when a call starts, with a one-click button to record.'
            : `Watch for other apps using your microphone and notify you when a call starts. Requires macOS 14 (Sonoma) or later${
                systemAudioSupport.data?.osVersion ? `, you're on ${systemAudioSupport.data.osVersion}` : ''
              }.`
        }
      >
        <Switch
          checked={autoDetectSupported && (autoDetect.data ?? true)}
          onCheckedChange={(v) => setAutoDetect.mutate(v)}
          disabled={autoDetect.data === undefined || !autoDetectSupported}
        />
      </SettingRow>

      <SettingRow
        label="Post meeting notifications"
        description="Notify when your notes are ready or a recording auto-stops from silence."
        noBorder
      >
        <Switch
          checked={notifications.data ?? false}
          onCheckedChange={(v) => setNotifications.mutate(v)}
          disabled={notifications.data === undefined}
        />
      </SettingRow>

      <SectionHeading>Recording</SectionHeading>

      <SettingRow
        label="Microphone"
        description="Which input device Steno records from. Pins your choice so the OS switching its default (e.g. AirPods connecting) doesn't silently change what gets recorded. Applies the next time you start a recording."
      >
        <Select
          value={microphone.data?.device_id ?? DEFAULT_MIC_VALUE}
          onValueChange={(deviceId) => {
            if (deviceId === DEFAULT_MIC_VALUE) {
              setMicrophone.mutate({ deviceId: DEFAULT_MIC_VALUE, label: '' });
              return;
            }
            const device = audioInputDevices.find((d) => d.deviceId === deviceId);
            // Re-selecting the already-pinned-but-disconnected device (the
            // synthetic SelectItem below) won't be found in audioInputDevices
            // — fall back to its already-known stored label instead of
            // overwriting it with an empty string.
            const label =
              device?.label ??
              (deviceId === microphone.data?.device_id ? microphone.data?.label ?? '' : '');
            setMicrophone.mutate({ deviceId, label });
          }}
          disabled={microphone.data === undefined}
        >
          <SelectTrigger className="h-8 w-56 text-sm" data-testid="microphone-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_MIC_VALUE}>System Default</SelectItem>
            {audioInputDevices.map((d, i) => (
              <SelectItem key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </SelectItem>
            ))}
            {/* The selected device was unplugged / isn't in the current device
                list — keep it selectable so the dropdown doesn't silently jump
                back to "System Default" out from under the user. */}
            {microphone.data?.device_id &&
              !audioInputDevices.some((d) => d.deviceId === microphone.data?.device_id) && (
                <SelectItem value={microphone.data.device_id}>
                  {microphone.data.label || 'Unknown device (disconnected)'}
                </SelectItem>
              )}
          </SelectContent>
        </Select>
      </SettingRow>

      {/* macOS only: chooses mic-only vs mic+system. Windows and Linux always
          record mic+system (toggle hidden), so this control isn't shown
          there. */}
      {isMac && (
        <SettingRow label="Record system audio" description={systemAudioDescription}>
          <Switch
            checked={(systemAudio.data ?? true) && (systemAudioSupport.data?.supported ?? true)}
            onCheckedChange={(v) => setSystemAudio.mutate(v)}
            disabled={systemAudio.data === undefined || systemAudioSupport.data?.supported === false}
          />
        </SettingRow>
      )}

      <RecordingStorageSettings />

      <SettingRow
        label="Auto-stop on silence"
        description="End the recording and start processing it once both the mic and system audio have been silent for the chosen duration. Useful when you forget to stop after a meeting ends."
        noBorder
      >
        <div className="flex items-center gap-3">
          <Select
            value={String(silenceAutoStop.data?.minutes ?? 2)}
            onValueChange={(v) => setSilenceAutoStopMinutes.mutate(Number(v))}
            disabled={
              silenceAutoStop.data === undefined || silenceAutoStop.data.enabled === false
            }
          >
            <SelectTrigger className="h-8 w-28 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(silenceAutoStop.data?.supportedMinutes ?? [2, 5, 10, 15, 30]).map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m} minutes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Switch
            checked={silenceAutoStop.data?.enabled ?? true}
            onCheckedChange={(v) => setSilenceAutoStopEnabled.mutate(v)}
            disabled={silenceAutoStop.data === undefined}
          />
        </div>
      </SettingRow>

      <SectionHeading>System</SectionHeading>

      <SettingRow
        label="Launch on login"
        description="Start Steno automatically when you log in, hidden in the menu bar. Turn off to launch it manually."
      >
        <Switch
          checked={launchOnLogin.data ?? true}
          onCheckedChange={(v) => setLaunchOnLogin.mutate(v)}
          disabled={launchOnLogin.data === undefined}
        />
      </SettingRow>

      <SettingRow
        label="Install updates automatically"
        description="On: new versions download in the background and install when you restart, quit, or step away. Off: you're told when a version is out and choose when to update."
      >
        <Switch
          checked={autoInstallWhenIdle.data ?? true}
          onCheckedChange={(v) => setAutoInstallWhenIdle.mutate(v)}
          disabled={autoInstallWhenIdle.data === undefined}
        />
      </SettingRow>

      <SettingRow
        label={isMac ? 'Show in menu bar' : 'Show in system tray'}
        description={
          bothIconsHidden
            ? 'Both your dock icon and menu bar icon will be hidden. Reopen Steno from Applications or Spotlight to bring the window back.'
            : isMac
              ? 'Show a Steno icon in the menu bar for quick access.'
              : 'Show a Steno icon in the system tray for quick access.'
        }
      >
        <Switch
          checked={menuBarIcon.data ?? true}
          onCheckedChange={(v) => setMenuBarIcon.mutate(v)}
          disabled={menuBarIcon.data === undefined}
        />
      </SettingRow>

      {/* The dock is a macOS-only concept and the apply logic in main.js is
          darwin-gated, so this toggle is a no-op off-mac. Hide it entirely on
          Windows/Linux rather than show a broken control. (Unlike the tray
          row above, which is cross-platform — Electron's Tray API covers the
          macOS menu bar and the Windows system tray alike.) */}
      {isMac && (
        <SettingRow
          label="Hide dock icon"
          description={
            bothIconsHidden
              ? 'Both your dock icon and menu bar icon will be hidden. Reopen Steno from Applications or Spotlight to bring the window back.'
              : 'Run as menu bar app only'
          }
          noBorder
        >
          <Switch
            checked={dockIcon.data ?? false}
            onCheckedChange={(v) => setDockIcon.mutate(v)}
            disabled={dockIcon.data === undefined}
          />
        </SettingRow>
      )}

      <SectionHeading>Keyboard shortcut</SectionHeading>

      <SettingRow
        label="Global record shortcut"
        description={
          <>
            Start or stop recording from anywhere with {recordAccel}. Turn off if it
            conflicts with another app.
            {recordHotkey.data?.enabled === true &&
              recordHotkey.data.registered === false && (
                <span className="mt-1 block" style={{ color: 'var(--fg-2)' }}>
                  Couldn't register — another app may be using this shortcut.
                </span>
              )}
          </>
        }
        noBorder
      >
        <Switch
          checked={recordHotkey.data?.enabled ?? true}
          onCheckedChange={(v) => setRecordHotkey.mutate(v)}
          disabled={recordHotkey.data === undefined}
        />
      </SettingRow>
    </section>
  );
}
