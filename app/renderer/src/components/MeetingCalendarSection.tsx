import { t } from '@/i18n';
import { CalendarDays } from 'lucide-react';
import { useAppleCalendar, useMeetingCalendarEvent, calendarKeys } from '@/hooks/useCalendarEvents';
import { UI_LOCALE } from '@/lib/locale';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ipc, type CalendarEvent } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** The calendar event this meeting belonged to: when, who was invited (email
 *  on hover), and the organiser's invitation text. Renders nothing when no
 *  event matched or no calendar is connected. */
export function MeetingCalendarSection({ summaryFile }: { summaryFile: string }) {
  const { data: event } = useMeetingCalendarEvent(summaryFile);
  const apple = useAppleCalendar();
  const qc = useQueryClient();
  const [options, setOptions] = useState<CalendarEvent[] | null>(null);
  const update = useMutation({
    mutationFn: async (change: { action: 'refresh' | 'unlink' | 'match'; eventId?: string; eventStart?: string }) =>
      unwrap(await ipc().calendar.updateMeeting(summaryFile, change)),
    onSuccess: () => { setOptions(null); void qc.invalidateQueries({ queryKey: calendarKeys.all }); },
  });
  const choose = useMutation({
    mutationFn: async () => unwrap(await ipc().calendar.meetingOptions(summaryFile)).events,
    onSuccess: setOptions,
  });
  if (!event && !apple.status.data?.enabled) return null;

  const start = new Date(event?.start || '');
  const end = new Date(event?.end || '');
  const when = Number.isNaN(start.getTime())
    ? ''
    : `${start.toLocaleDateString(UI_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' })}, ${TIME_FMT.format(start)}${Number.isNaN(end.getTime()) ? '' : ` – ${TIME_FMT.format(end)}`}`;
  const invited = (event?.attendees ?? []).filter((a) => !a.self);

  return (
    <section className="flex flex-col gap-2" data-testid="meeting-calendar-section">
      <h2
        className="text-[13px] font-semibold tracking-[0.01em]"
        style={{ color: 'var(--fg-2)', fontFamily: 'var(--font-sans)', margin: 0 }}
      >{t('meetingCalendarSection.meeting')}</h2>
      <div className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--fg-1)' }}>
        <CalendarDays className="size-[13px] shrink-0" style={{ color: 'var(--fg-muted)' }} />
        <span className="truncate">{event?.title || t('meetingCalendarSection.no_calendar_invitation_linked')}</span>
        {when && <span style={{ color: 'var(--fg-muted)' }}>· {when}</span>}
      </div>
      {invited.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {invited.map((a, i) => (
            <span
              key={a.email ?? `${a.name}-${i}`}
              title={a.email ?? undefined}
              className="rounded-full px-2 py-0.5 text-[12px]"
              style={{
                background: 'var(--surface-hover)',
                border: '1px solid var(--border-subtle)',
                color: a.status === 'declined' ? 'var(--fg-muted)' : 'var(--fg-1)',
                textDecoration: a.status === 'declined' ? 'line-through' : undefined,
              }}
            >
              {a.name || a.email}
            </span>
          ))}
        </div>
      )}
      {event?.description && (
        <details className="text-[12.5px]" style={{ color: 'var(--fg-2)' }}>
          <summary className="cursor-pointer select-none">{t('meetingCalendarSection.invitation')}</summary>
          <p className="mt-1 whitespace-pre-wrap">{event.description}</p>
        </details>
      )}
      {apple.status.data?.enabled && <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ action: 'refresh' })}>{t('meetingCalendarSection.refresh_invitation')}</Button>
        <Button size="sm" variant="ghost" disabled={choose.isPending || update.isPending} onClick={() => choose.mutate()}>{t('meetingCalendarSection.choose_invitation')}</Button>
        {event && <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ action: 'unlink' })}>{t('meetingCalendarSection.unlink_invitation')}</Button>}
      </div>}
      {options && <div className="flex flex-col gap-1">
        {!options.length && <p className="text-sm">{t('meetingCalendarSection.no_invitations_found_around_this_recording')}</p>}
        {options.map(e => <Button key={`${e.id}:${e.start}`} variant="outline" size="sm" disabled={update.isPending}
          onClick={() => update.mutate({ action: 'match', eventId: e.id, eventStart: e.start })}>{e.title} · {new Date(e.start).toLocaleString(UI_LOCALE)}</Button>)}
      </div>}
      {(update.error || choose.error) && <p role="alert" className="text-sm">{(update.error || choose.error)?.message}</p>}
    </section>
  );
}
