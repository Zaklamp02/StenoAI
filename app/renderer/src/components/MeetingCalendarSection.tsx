import { CalendarDays } from 'lucide-react';
import { useMeetingCalendarEvent } from '@/hooks/useCalendarEvents';
import { UI_LOCALE } from '@/lib/locale';

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** The calendar event this meeting belonged to: when, who was invited (email
 *  on hover), and the organiser's invitation text. Renders nothing when no
 *  event matched or no calendar is connected. */
export function MeetingCalendarSection({ summaryFile }: { summaryFile: string }) {
  const { data: event } = useMeetingCalendarEvent(summaryFile);
  if (!event) return null;

  const start = new Date(event.start);
  const end = new Date(event.end);
  const when = Number.isNaN(start.getTime())
    ? ''
    : `${start.toLocaleDateString(UI_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' })}, ${TIME_FMT.format(start)}${Number.isNaN(end.getTime()) ? '' : ` – ${TIME_FMT.format(end)}`}`;
  const invited = (event.attendees ?? []).filter((a) => !a.self);

  return (
    <section className="flex flex-col gap-2" data-testid="meeting-calendar-section">
      <h2
        className="text-[13px] font-semibold tracking-[0.01em]"
        style={{ color: 'var(--fg-2)', fontFamily: 'var(--font-sans)', margin: 0 }}
      >
        Meeting
      </h2>
      <div className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--fg-1)' }}>
        <CalendarDays className="size-[13px] shrink-0" style={{ color: 'var(--fg-muted)' }} />
        <span className="truncate">{event.title}</span>
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
      {event.description && (
        <details className="text-[12.5px]" style={{ color: 'var(--fg-2)' }}>
          <summary className="cursor-pointer select-none">Invitation</summary>
          <p className="mt-1 whitespace-pre-wrap">{event.description}</p>
        </details>
      )}
    </section>
  );
}
