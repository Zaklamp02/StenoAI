import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc, type CalendarEvent } from '@/lib/ipc';
import { unwrap } from '@/lib/result';

export type CalendarState =
  | { needsAuth: false; events: CalendarEvent[] }
  | { needsAuth: true; events: [] };

export const calendarKeys = {
  all: ['calendar'] as const,
  events: () => [...calendarKeys.all, 'events'] as const,
  google: () => [...calendarKeys.all, 'google'] as const,
  outlook: () => [...calendarKeys.all, 'outlook'] as const,
  apple: () => [...calendarKeys.all, 'apple'] as const,
};

/**
 * Mount the Google + Outlook auth-change → calendar-cache-invalidate
 * subscriptions. Call from App.tsx ONLY. Every additional caller would
 * add a duplicate listener pair and a redundant invalidateQueries per
 * auth event.
 *
 * Split out from useCalendarEvents so that route-level callers can keep
 * subscribing to the data via useQuery (sharing the cache via the
 * `events` queryKey) without each one re-registering the IPC bus.
 */
export function useCalendarAuthBus() {
  const qc = useQueryClient();
  React.useEffect(() => {
    const off = [
      ipc().on.googleAuthChanged(() => {
        qc.invalidateQueries({ queryKey: calendarKeys.all });
      }),
      ipc().on.outlookAuthChanged(() => {
        qc.invalidateQueries({ queryKey: calendarKeys.all });
      }),
    ];
    return () => off.forEach((fn) => fn());
  }, [qc]);
}

export function useCalendarEvents() {
  return useQuery<CalendarState>({
    queryKey: calendarKeys.events(),
    queryFn: async (): Promise<CalendarState> => {
      const res = await ipc().calendar.getEvents();
      if (res.success) return { needsAuth: false, events: res.events };
      if ('needsAuth' in res) return { needsAuth: true, events: [] };
      throw new Error(res.error);
    },
    // Poll every 2 minutes so events the user adds in their calendar app
    // surface here in roughly the time it takes to switch context, without
    // hammering the provider API. Combined with the route-change refetch
    // in App.tsx and refetchOnWindowFocus, the user almost never sees a
    // stale carousel — but the 60 s staleTime below de-dupes refetches so
    // rapid navigation doesn't fire one fetch per nav.
    refetchInterval: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
    staleTime: 60 * 1000,
  });
}

export function useGoogleCalendarAuth() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: calendarKeys.google(),
    queryFn: async () => {
      const res = await ipc().calendar.google.status();
      if (!res.success) throw new Error(res.error);
      return { connected: res.connected, email: res.email ?? null };
    },
  });
  const connect = useMutation({
    mutationFn: async () => unwrap(await ipc().calendar.google.connect()),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  });
  // No invalidate on cancel — there's nothing to refetch; the connect
  // mutation will reject with "Cancelled" and the renderer falls back to
  // its un-pending state on its own.
  const cancel = useMutation({
    mutationFn: async () => unwrap(await ipc().calendar.google.cancel()),
  });
  const disconnect = useMutation({
    mutationFn: async () => unwrap(await ipc().calendar.google.disconnect()),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  });
  return { status, connect, cancel, disconnect };
}

export function useAppleCalendar() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: calendarKeys.apple(),
    queryFn: async () => unwrap(await ipc().calendar.apple.status()),
  });
  // Resolves once macOS's permission prompt is answered.
  const connect = useMutation({
    mutationFn: async () => unwrap(await ipc().calendar.apple.connect()),
    onSettled: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  });
  const disconnect = useMutation({
    mutationFn: async () => unwrap(await ipc().calendar.apple.disconnect()),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  });
  return { status, connect, disconnect };
}

/** The Apple Calendar event a recording started at `timeMs` belongs to (null
 *  when none, or Apple Calendar isn't connected). */
export function useCalendarEventAt(timeMs: number | null, enabled = true) {
  return useQuery({
    queryKey: [...calendarKeys.all, 'at', timeMs] as const,
    queryFn: async () => unwrap(await ipc().calendar.apple.eventAt(timeMs as number)).event,
    enabled: enabled && timeMs !== null,
    staleTime: 5 * 60 * 1000,
  });
}

/** The calendar event a note's meeting belongs to, or null. */
export function useMeetingCalendarEvent(summaryFile: string | null | undefined) {
  return useQuery({
    queryKey: [...calendarKeys.all, 'meeting', summaryFile ?? null] as const,
    queryFn: async () => unwrap(await ipc().calendar.meetingEvent(summaryFile as string)).event,
    enabled: Boolean(summaryFile),
    staleTime: 5 * 60 * 1000,
  });
}

/** Display names of the people invited to `event`, excluding yourself.
 *  Falls back to the address's local part ("jan.devries" -> "Jan Devries")
 *  when the calendar has no name. */
export function attendeeNames(event: CalendarEvent | null | undefined): string[] {
  const names: string[] = [];
  for (const a of event?.attendees ?? []) {
    if (a.self) continue;
    let name = (a.name ?? '').trim();
    if (!name && a.email) {
      name = a.email
        .split('@')[0]
        .split(/[._-]+/)
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(' ');
    }
    if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names;
}

export function useOutlookCalendarAuth() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: calendarKeys.outlook(),
    queryFn: async () => {
      const res = await ipc().calendar.outlook.status();
      if (!res.success) throw new Error(res.error);
      return { connected: res.connected, email: res.email ?? null };
    },
  });
  const connect = useMutation({
    mutationFn: async () => unwrap(await ipc().calendar.outlook.connect()),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  });
  const cancel = useMutation({
    mutationFn: async () => unwrap(await ipc().calendar.outlook.cancel()),
  });
  const disconnect = useMutation({
    mutationFn: async () => unwrap(await ipc().calendar.outlook.disconnect()),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  });
  return { status, connect, cancel, disconnect };
}
