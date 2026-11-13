import * as React from 'react';
import { ArrowDownToLine, X } from 'lucide-react';
import { ipc, type ReleaseNotice } from '@/lib/ipc';
import type { RecordingStatus } from '@/hooks/useRecording';

const RELEASE_NOTICE_COPY = {
  available: (version: string) => `Version ${version} available`,
  downloading: (version: string) => `Downloading version ${version}`,
  download: 'Download',
  update: 'Update',
  dismiss: 'Dismiss new version notice',
};

/**
 * Top-right pill for updates:
 *
 * - electron-updater finished downloading a release in the background:
 *   "Restart" calls the main-side `install-update` IPC (`quitAndInstall`).
 *   Dismiss with × hides it for the rest of the session.
 * - electron-updater is fetching a release (an install that updates
 *   itself): the pill shows its version and progress. Dismissing hides it for
 *   the session; a failure brings back the "Download" pill below.
 * - The background release check found a newer release on GitHub that is not
 *   downloading. When this install can update itself (and "Install updates
 *   automatically" is off, so nothing fetched it yet), "Update" fetches it in
 *   the app; otherwise "Download" opens the DMG in the browser. Dismissing
 *   remembers the version, so each release is announced once.
 * The last two are hidden while recording or processing.
 */
export function UpdateToast({ recordingStatus }: { recordingStatus: RecordingStatus }) {
  const [pendingVersion, setPendingVersion] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  const [release, setRelease] = React.useState<ReleaseNotice | null>(null);
  // Non-null while electron-updater is fetching a release.
  const [download, setDownload] = React.useState<{ version: string; percent: number } | null>(null);
  const [downloadDismissed, setDownloadDismissed] = React.useState(false);
  // A mount-time read still in flight must not bring back a dismissed notice.
  const dismissedReleaseRef = React.useRef<string | null>(null);
  // Set by any live updater event, so a slower mount-time status read cannot
  // reopen a download that has since finished or failed.
  const updaterEventSeenRef = React.useRef(false);

  React.useEffect(() => {
    const offAvailable = ipc().on.updateAvailable((evt) => {
      // "Ask first" found it; nothing is downloading until Update is clicked.
      if (evt.downloading === false) return;
      updaterEventSeenRef.current = true;
      setDownload((d) => (d && d.version === evt.version ? d : { version: evt.version, percent: 0 }));
    });
    const offProgress = ipc().on.updateDownloadProgress((evt) => {
      updaterEventSeenRef.current = true;
      setDownload((d) => (d ? { ...d, percent: evt.percent } : d));
    });
    const offDownloaded = ipc().on.updateDownloaded((evt) => {
      updaterEventSeenRef.current = true;
      setDownload(null);
      setPendingVersion(evt.version);
      // A newer version arriving overrides any prior dismiss for this
      // session — the user dismissed v0.2.14, but v0.2.15 just landed.
      setDismissed(false);
    });
    // A failed download falls back to the "Download" pill.
    const offError = ipc().on.updateError(() => {
      updaterEventSeenRef.current = true;
      setDownload(null);
      setDownloadDismissed(false);
    });
    // The window can open after the download started or finished.
    let cancelled = false;
    void ipc()
      .updates.getStatus()
      .then((status) => {
        if (cancelled || !status.success || updaterEventSeenRef.current) return;
        if (status.downloadedVersion) setPendingVersion(status.downloadedVersion);
        else if (status.downloadPercent !== null && status.downloadingVersion) {
          setDownload({ version: status.downloadingVersion, percent: status.downloadPercent });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      offAvailable();
      offProgress();
      offDownloaded();
      offError();
    };
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
      })
      .catch(() => {});
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

  if (recordingStatus !== 'idle') return null;

  if (download && !downloadDismissed) {
    return (
      <ToastPill>
        <ArrowDownToLine size={13} style={{ color: 'var(--fg-2)' }} />
        <span className="tabular-nums">
          {RELEASE_NOTICE_COPY.downloading(download.version)}
          <span style={{ color: 'var(--fg-2)' }}>{` · ${download.percent}%`}</span>
        </span>
        <DismissButton label={RELEASE_NOTICE_COPY.dismiss} onClick={() => setDownloadDismissed(true)} />
      </ToastPill>
    );
  }

  // Already on its way in; nothing to download by hand.
  if (!release || download?.version === release.version) return null;

  const dismissRelease = () => {
    dismissedReleaseRef.current = release.version;
    void ipc().updates.dismissReleaseNotice(release.version);
    setRelease(null);
  };

  const downloadRelease = () =>
    void ipc().updates.openReleasePage(release.downloadUrl ?? release.releaseUrl);

  // Show progress at once; the updater's events take over from here. If it
  // cannot fetch the release, the button becomes Download.
  const updateInApp = () => {
    setDownload({ version: release.version, percent: 0 });
    setDownloadDismissed(false);
    void ipc()
      .updates.download()
      .then((res) => {
        if (res.success) return;
        setDownload(null);
        setRelease((r) => (r ? { ...r, canUpdateInApp: false } : r));
      })
      .catch(() => {
        setDownload(null);
        setRelease((r) => (r ? { ...r, canUpdateInApp: false } : r));
      });
  };

  return (
    <ToastPill>
      <ArrowDownToLine size={13} style={{ color: 'var(--fg-2)' }} />
      <span className="tabular-nums">{RELEASE_NOTICE_COPY.available(release.version)}</span>
      <PrimaryButton onClick={release.canUpdateInApp ? updateInApp : downloadRelease}>
        {release.canUpdateInApp ? RELEASE_NOTICE_COPY.update : RELEASE_NOTICE_COPY.download}
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
