import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Radix Select (used by the Microphone dropdown) checks these on the
// trigger/viewport at open time; jsdom doesn't implement them.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * Coverage for GeneralTab's name-field seed race (#307), microphone and
 * system-audio rows. The calendar OAuth race tests (#306) moved to
 * CalendarSettings.test.tsx with the calendar settings. The settings hooks
 * are mocked directly so each state can be controlled precisely per test.
 */

const h = vi.hoisted(() => {
  return {
    userName: { data: undefined as string | undefined, isPending: true, isPlaceholderData: false },
    setUserName: { mutate: vi.fn() },
    microphone: { data: { device_id: null as string | null, label: null as string | null } },
    setMicrophone: { mutate: vi.fn() },
    audioInputDevices: [] as { deviceId: string; label: string }[],
    systemAudio: { data: true as boolean | undefined },
    setSystemAudio: { mutate: vi.fn() },
    systemAudioSupport: {
      data: {
        supported: true,
        osVersion: '14.4',
        platform: 'darwin',
      } as {
        supported: boolean;
        osVersion: string;
        // Optional so the platform-less reassignments (beforeEach + the plain
        // system-audio cases) and the macOS-14-gate cases (which set platform)
        // both typecheck (#116).
        platform?: string;
      },
    },
  };
});

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

// jsdom's navigator.userAgent reports "darwin" (not "Macintosh"), so the real
// isMac constant evaluates false here — force it true so the macOS-only
// "Record system audio" row (isMac-gated in GeneralTab.tsx) is reachable.
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, isMac: true };
});

vi.mock('@/hooks/useSettings', () => {
  const q = (data: unknown) => ({ data, isPending: false, isPlaceholderData: false });
  const m = () => ({ mutate: vi.fn() });
  return {
    useNotificationsSetting: () => q(true),
    useSetNotifications: m,
    useRecordHotkeySetting: () => q({ enabled: true, registered: true }),
    useSetRecordHotkey: m,
    usePremeetingNotificationsSetting: () => q(true),
    useSetPremeetingNotifications: m,
    useSystemAudioSetting: () => h.systemAudio,
    useSetSystemAudio: () => h.setSystemAudio,
    useSystemAudioSupport: () => h.systemAudioSupport,
    useAutoDetectMeetingsSetting: () => q(true),
    useSetAutoDetectMeetings: m,
    useLaunchOnLoginSetting: () => q(true),
    useSetLaunchOnLogin: m,
    useAutoInstallWhenIdleSetting: () => q(true),
    useSetAutoInstallWhenIdle: m,
    useSilenceAutoStopSetting: () =>
      q({ enabled: true, minutes: 15, supportedMinutes: [2, 5, 10, 15, 30] }),
    useSetSilenceAutoStopEnabled: m,
    useSetSilenceAutoStopMinutes: m,
    useKeepRecordingsSetting: () => ({ data: false }),
    useSetKeepRecordings: m,
    useDockIconSetting: () => q(false),
    useSetDockIcon: m,
    useShowMenuBarIconSetting: () => q(true),
    useSetShowMenuBarIcon: m,
    useUserName: () => h.userName,
    useSetUserName: () => h.setUserName,
    useMicrophoneSetting: () => q(h.microphone.data),
    useSetMicrophone: () => h.setMicrophone,
  };
});

vi.mock('@/hooks/useAudioInputDevices', () => ({
  useAudioInputDevices: () => h.audioInputDevices,
}));

// Import after the mocks are registered.
import { GeneralTab } from './GeneralTab';

beforeEach(() => {
  h.userName = { data: undefined, isPending: true, isPlaceholderData: false };
  h.setUserName.mutate.mockReset();
  h.microphone.data = { device_id: null, label: null };
  h.setMicrophone.mutate.mockReset();
  h.audioInputDevices = [];
  h.systemAudio.data = true;
  h.setSystemAudio.mutate.mockReset();
  h.systemAudioSupport.data = {
    supported: true,
    osVersion: '14.4',
  };
});

describe('GeneralTab name-field seed race (#307)', () => {
  test('typing before the userName query resolves is not overwritten by the seed', async () => {
    h.userName = { data: undefined, isPending: true, isPlaceholderData: false };
    const { rerender } = render(<GeneralTab />);

    const input = screen.getByTestId('user-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Casey Example' } });
    expect(input.value).toBe('Casey Example');

    // The canonical value now arrives from disk.
    h.userName = { data: 'Old Name', isPending: false, isPlaceholderData: false };
    await act(async () => {
      rerender(<GeneralTab />);
    });

    // The user's in-progress edit must survive the late seed.
    expect((screen.getByTestId('user-name-input') as HTMLInputElement).value).toBe('Casey Example');
  });

  test('the field re-syncs from userName.data after the edit is committed on blur', async () => {
    h.userName = { data: undefined, isPending: true, isPlaceholderData: false };
    const { rerender } = render(<GeneralTab />);

    const input = screen.getByTestId('user-name-input') as HTMLInputElement;
    // Edit before the query resolves, then clear back to the placeholder ('').
    fireEvent.change(input, { target: { value: 'X' } });
    fireEvent.change(input, { target: { value: '' } });
    // Blur commits: trimmed '' equals the (still-unresolved) placeholder '', so
    // nothing is persisted — but the editing session is now over.
    fireEvent.blur(input);
    expect(h.setUserName.mutate).not.toHaveBeenCalled();

    // The canonical value now arrives from disk. Since the edit was committed
    // (and saved nothing), the field must re-sync to it rather than stay blank.
    h.userName = { data: 'Casey Example', isPending: false, isPlaceholderData: false };
    await act(async () => {
      rerender(<GeneralTab />);
    });

    expect((screen.getByTestId('user-name-input') as HTMLInputElement).value).toBe('Casey Example');
  });
});

describe('GeneralTab Microphone setting', () => {
  test('shows "System Default" when no device is pinned', () => {
    render(<GeneralTab />);
    expect(screen.getByTestId('microphone-select').textContent).toContain(
      'System Default',
    );
  });

  test('shows the persisted device label when one is pinned', () => {
    h.microphone.data = { device_id: 'abc123', label: 'USB Microphone' };
    render(<GeneralTab />);
    expect(screen.getByTestId('microphone-select').textContent).toContain(
      'USB Microphone',
    );
  });

  test('falls back to a disconnected-device label when the pinned device is no longer enumerated', () => {
    h.microphone.data = { device_id: 'gone', label: 'Old USB Mic' };
    h.audioInputDevices = [{ deviceId: 'abc123', label: 'USB Microphone' }];
    render(<GeneralTab />);
    expect(screen.getByTestId('microphone-select').textContent).toContain(
      'Old USB Mic',
    );
  });

  test('picking a real device calls setMicrophone with its id and label', async () => {
    h.audioInputDevices = [
      { deviceId: 'abc123', label: 'USB Microphone' },
      { deviceId: 'def456', label: 'AirPods' },
    ];
    render(<GeneralTab />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('microphone-select'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'AirPods' }));
    });

    expect(h.setMicrophone.mutate).toHaveBeenCalledWith({
      deviceId: 'def456',
      label: 'AirPods',
    });
  });

  test('picking "System Default" clears the pinned device', async () => {
    h.microphone.data = { device_id: 'abc123', label: 'USB Microphone' };
    h.audioInputDevices = [{ deviceId: 'abc123', label: 'USB Microphone' }];
    render(<GeneralTab />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('microphone-select'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'System Default' }));
    });

    expect(h.setMicrophone.mutate).toHaveBeenCalledWith({ deviceId: 'default', label: '' });
  });

  // No dedicated test for "re-selecting the already-pinned disconnected
  // device preserves its stored label" (the fix for the label-overwrite bug
  // above onValueChange in GeneralTab.tsx): Radix's SelectItem.handleSelect
  // fires via onClick only when pointerTypeRef reads 'mouse' (set by a prior
  // real pointerdown/pointermove) or via onPointerUp otherwise — a bare
  // fireEvent.click on the CURRENTLY-selected item doesn't reliably trigger
  // either path in jsdom, unlike selecting a different item (which the tests
  // above cover fine). The fix itself is a one-line, side-effect-free
  // fallback verified by manual reasoning against Radix's source
  // (SelectItem.handleSelect calls context.onValueChange(value)
  // unconditionally, including for the already-selected value).
});

describe('GeneralTab Record system audio', () => {
  test('supported: toggle remains enabled and updates the setting', async () => {
    render(<GeneralTab />);
    expect(screen.getByText('Capture both sides of a call. Turn off to record your mic only.')).toBeTruthy();
    const row = screen.getByText('Record system audio').parentElement?.parentElement;
    const toggle = row?.querySelector('[role="switch"]') as HTMLButtonElement | null;
    expect(toggle?.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(toggle!);
    });
    expect(h.setSystemAudio.mutate).toHaveBeenCalledWith(false);
  });

  test('unsupported macOS version: toggle is disabled with the version explanation', () => {
    h.systemAudioSupport.data = {
      supported: false,
      osVersion: '13.0',
    };
    render(<GeneralTab />);
    expect(screen.getByText(/requires macOS 14.4\+/)).toBeTruthy();
    const row = screen.getByText('Record system audio').parentElement?.parentElement;
    const toggle = row?.querySelector('[role="switch"]') as HTMLButtonElement | null;
    expect(toggle?.disabled).toBe(true);
  });

  test('auto-detect: shows a "Requires macOS 14" note on macOS < 14 (#116)', () => {
    // The mic-monitor only has a reliable per-app signal on macOS 14+, so the
    // Auto-detected meetings row is gated below that — see isMacos14Plus.
    h.systemAudioSupport.data = {
      supported: false,
      osVersion: '13.6.1',
      platform: 'darwin',
    };
    render(<GeneralTab />);
    expect(
      screen.getByText(/Requires macOS 14 \(Sonoma\) or later, you're on 13\.6\.1\./),
    ).toBeTruthy();
  });

  test('auto-detect: no macOS-14 note on macOS 14+', () => {
    h.systemAudioSupport.data = {
      supported: true,
      osVersion: '14.4',
      platform: 'darwin',
    };
    render(<GeneralTab />);
    expect(screen.queryByText(/Requires macOS 14 \(Sonoma\) or later/)).toBeNull();
  });
});
