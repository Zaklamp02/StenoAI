import * as React from 'react';
import { ArrowDownToLine, X } from 'lucide-react';
import { ipc, type ReleaseNotice } from '@/lib/ipc';
import type { RecordingStatus } from '@/hooks/useRecording';

const RELEASE_NOTICE_COPY = {
  available: (version: string) => `Version ${version} available`,
  download: 'Download',
  dismiss: 'Dismiss new version notice',
};

/**
 * Top-right pill for updates, in two forms:
 *
 * - electron-updater finished downloading a release in the background:
 *   "Restart" calls the main-side `install-update` IPC (`quitAndInstall`).
 *   Dismiss with × hides it for the rest of the session.
 * - The background release check found a newer release on GitHub (the custom
 *   build has no in-app installer): "Download" opens the DMG in the browser.
 *   Dismissing remembers that version, so each release is announced once.
 *   Hidden while recording or processing.
 */
export function UpdateToast({ recordingStatus }: { recordingStatus: RecordingStatus }) {
  const [pendingVersion, setPendingVersion] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  const [release, setRelease] = React.useState<ReleaseNotice | null>(null);
  // A mount-time read still in flight must not bring back a dismissed notice.
  const dismissedReleaseRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    return ipc().on.updateDownloaded((evt) => {
      setPendingVersion(evt.version);
      // A newer version arriving overrides any prior dismiss for this
      // session — the user dismissed v0.2.14, but v0.2.15 just landed.
      setDismissed(false);
    });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const off = ipc().on.releaseAvailable((notice) => setRelease(notice));
    // The launch check can finish before this mounts; the event alone would miss it.
    void ipc()
      .updates.getReleaseNotice()
      .then((result) => {
        const notice = result.success ? result.notice : null;
        if (!cancelled && notice && notice.version !== dismissedReleaseRef.current) {
          setRelease((current) => current ?? notice);
        }
      });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (pendingVersion && !dismissed) {
    return (
      <ToastPill>
        <ArrowDownToLine size={13} style={{ color: 'var(--fg-2)' }} />
        <span>
          Update <span className="tabular-nums">v{pendingVersion}</span> ready
        </span>
        <PrimaryButton onClick={() => ipc().updates.install()}>Restart</PrimaryButton>
        <DismissButton label="Dismiss update notification" onClick={() => setDismissed(true)} />
      </ToastPill>
    );
  }

  if (!release || recordingStatus !== 'idle') return null;

  const dismissRelease = () => {
    dismissedReleaseRef.current = release.version;
    void ipc().updates.dismissReleaseNotice(release.version);
    setRelease(null);
  };

  return (
    <ToastPill>
      <ArrowDownToLine size={13} style={{ color: 'var(--fg-2)' }} />
      <span className="tabular-nums">{RELEASE_NOTICE_COPY.available(release.version)}</span>
      <PrimaryButton
        onClick={() => void ipc().updates.openReleasePage(release.downloadUrl ?? release.releaseUrl)}
      >
        {RELEASE_NOTICE_COPY.download}
      </PrimaryButton>
      <DismissButton label={RELEASE_NOTICE_COPY.dismiss} onClick={dismissRelease} />
    </ToastPill>
  );
}

function ToastPill({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-auto fixed right-4 top-4 z-50 flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px]"
      style={{
        background: 'var(--surface-raised)',
        color: 'var(--fg-1)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-md)',
        fontFamily: 'var(--font-sans)',
        // Overlaps MainToolbar's draggable top strip. Without an explicit
        // no-drag here, macOS's window-drag hit test (computed from CSS
        // regions, not paint z-order) swallows clicks on the upper portion
        // of the buttons below — only the sliver poking below the strip
        // was clickable.
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
      role="status"
      aria-live="polite"
    >
      {children}
    </div>
  );
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-1 cursor-pointer rounded-full border-0 px-2.5 py-1 text-[12px] font-medium"
      style={{
        background: 'var(--fg-1)',
        color: 'var(--fg-inverse)',
      }}
    >
      {children}
    </button>
  );
}

function DismissButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="ml-0.5 inline-flex cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-1"
      style={{ color: 'var(--fg-2)' }}
    >
      <X size={12} />
    </button>
  );
}
