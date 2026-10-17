import { t } from '@/i18n';
import * as React from 'react';
import { KeyRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ipc, type KeychainState } from '@/lib/ipc';

/**
 * Shown while the main process makes its first Keychain access (after the
 * window is up; see app/keychain-gate.js). A locked login Keychain keeps this
 * visible until the user unlocks it in the macOS prompt. When the gate opens,
 * cached queries are refetched so "key saved" states and sign-ins appear.
 */
export function KeychainWaitBanner() {
  const qc = useQueryClient();
  const [state, setState] = React.useState<KeychainState>('closed');
  React.useEffect(() => {
    const bridge = ipc();
    let previous: KeychainState = 'closed';
    const apply = (next: KeychainState) => {
      if (next === 'open' && previous !== 'open') void qc.invalidateQueries();
      previous = next;
      setState(next);
    };
    const off = bridge.on.keychainState(({ state: next }) => apply(next));
    void bridge.settings.getKeychainState().then((res) => {
      // Only fill in a state the event has not already reported.
      if (res.success && previous === 'closed') apply(res.state);
    });
    return off;
  }, [qc]);

  if (state !== 'waiting') return null;
  return (
    <div
      role="status"
      data-testid="keychain-wait-banner"
      className="fixed left-1/2 top-3 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-md px-3 py-2 text-[13px] shadow-sm"
      style={{ background: 'var(--surface-raised)', color: 'var(--fg-1)', border: '1px solid var(--border-subtle)' }}
    >
      <KeyRound size={14} style={{ color: 'var(--fg-2)' }} />{t('keychainWaitBanner.waiting_for_keychain_unlock_it_to_load')}</div>
  );
}
