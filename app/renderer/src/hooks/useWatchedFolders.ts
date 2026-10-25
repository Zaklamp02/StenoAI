import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc, type WatchedFoldersListing } from '@/lib/ipc';
import { unwrap } from '@/lib/result';

const watchedKey = ['watchedFolders'] as const;

/**
 * Watched recording folders and their files (Settings → Integrations, the
 * Recordings inbox). Refreshes when main sees files arrive or change, and when
 * a meeting finishes so a processed file flips to "done".
 */
export function useWatchedFolders() {
  const qc = useQueryClient();
  React.useEffect(() => {
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: watchedKey });
    };
    const offChanged = ipc().on.watchedFoldersChanged(refresh);
    const offComplete = ipc().on.processingComplete(refresh);
    return () => {
      offChanged();
      offComplete();
    };
  }, [qc]);
  return useQuery({
    queryKey: watchedKey,
    queryFn: async (): Promise<WatchedFoldersListing> => {
      const { folders = [], files = [] } = unwrap(await ipc().watchedFolders.list());
      return { folders, files };
    },
  });
}

type Action =
  | { type: 'add' }
  | { type: 'remove'; id: string }
  | { type: 'auto'; id: string; enabled: boolean }
  | { type: 'transcribe' | 'dismiss' | 'restore'; ids: string[] };

export function useWatchedFolderAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (action: Action) => {
      const api = ipc().watchedFolders;
      switch (action.type) {
        case 'add':
          return unwrap(await api.add());
        case 'remove':
          return unwrap(await api.remove(action.id));
        case 'auto':
          return unwrap(await api.setAutoTranscribe(action.id, action.enabled));
        default:
          return unwrap(await api[action.type](action.ids));
      }
    },
    onSuccess: (listing) => {
      qc.setQueryData(watchedKey, { folders: listing.folders, files: listing.files });
    },
  });
}
