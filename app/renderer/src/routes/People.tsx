import { MeetingsShell } from '@/components/MeetingsShell';
import { PeopleTab } from '@/routes/settings/PeopleTab';

/** Known people (named voice profiles) as a top-level page, so naming and
 *  reviewing speakers doesn't mean a trip into Settings. Same content as
 *  Settings → People. */
export function People() {
  return (
    <MeetingsShell activeSummaryFile={null}>
      <div className="mx-auto w-full max-w-[760px] py-10" style={{ color: 'var(--fg-1)' }}>
        <h1
          className="text-[32px] leading-tight tracking-tight"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          People
        </h1>
        <p className="mt-4 mb-8 max-w-[580px] text-sm leading-relaxed" style={{ color: 'var(--fg-2)' }}>
          People you've named in a meeting's Speakers section. Steno uses their voice
          profiles to suggest them in later meetings.
        </p>
        <PeopleTab />
      </div>
    </MeetingsShell>
  );
}
