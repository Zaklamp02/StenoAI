# src/meeting_context.py
"""What the summary prompt knows about a meeting besides its transcript.

The calendar event a recording belongs to (title, invitation/agenda text,
organizer, invitees), the speakers confirmed for it, and the meeting date.
Electron writes the event next to the note as ``<stem>_calendar.json``
(``app/apple-calendar.js``: ``{"checked_at": ..., "event": {...} | null}``,
event fields from ``custom/calendar-helper``). Confirmed speakers come from
the person profiles (``speaker_suggestions.confirmed_participant_names``).

The block is rendered to a caller-chosen character budget, so a long
invitation or a 300-person town hall can never crowd the transcript out of a
small local model's context window. Pure apart from reading the sidecar —
unit-testable without a running app.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Never shown more than this many invitee names; the rest are counted.
MAX_LISTED_NAMES = 40

_STEM_MS_RE = re.compile(r'(?:^|-)(\d{13})(?:-|_|$)')


@dataclass
class MeetingContext:
    title: Optional[str] = None
    meeting_date: Optional[str] = None  # YYYY-MM-DD
    time_range: Optional[str] = None    # "10:00-11:00"
    organizer: Optional[str] = None
    recorder: Optional[str] = None      # the calendar's own attendee ([You])
    invitees: list[str] = field(default_factory=list)
    declined: list[str] = field(default_factory=list)
    speakers: list[str] = field(default_factory=list)
    invitation: Optional[str] = None

    def has_details(self) -> bool:
        """True when there is more to say than the date alone."""
        return bool(self.title or self.organizer or self.recorder or self.invitees
                    or self.speakers or self.invitation)

    def render(self, max_chars: int) -> str:
        """The context block for a summary prompt, at most ``max_chars`` long.

        Fixed lines first; the invitation text gets whatever budget is left.
        Returns "" when nothing is known."""
        if not self.has_details() and not self.meeting_date:
            return ""
        header = (
            "MEETING CONTEXT (from the calendar invitation and the confirmed speakers). "
            "Use it to understand the purpose of the meeting and to recognise and spell "
            "names correctly. It is not a record of what was said: only report topics, "
            "decisions and action items that appear in the transcript."
        )
        lines = [header]
        if self.title:
            lines.append(f"Title: {_one_line(self.title, 200)}")
        when = self.meeting_date or ""
        if self.time_range:
            when = f"{when} {self.time_range}".strip()
        if when:
            lines.append(f"Date: {when}")
        # Most useful first: lines that do not fit the budget are cut from the end.
        if self.recorder:
            lines.append(f"Recorded by: {_one_line(self.recorder, 120)} ([You] in the transcript)")
        if self.speakers:
            lines.append(f"Speakers identified in the recording: {_name_list(self.speakers)}")
        if self.invitees:
            lines.append(f"Invited: {_name_list(self.invitees)}")
        if self.organizer:
            lines.append(f"Organizer: {_one_line(self.organizer, 120)}")
        if self.declined:
            lines.append(f"Declined (not present): {_name_list(self.declined)}")

        block = _fit_lines(lines, max_chars)
        if self.invitation:
            label = "\nInvitation / agenda:\n"
            room = max_chars - len(block) - len(label)
            if room >= 80:
                block += label + _truncate(self.invitation.strip(), room)
        return block

    def names_line(self, max_chars: int) -> str:
        """One compact line for the map step of a chunked summary: who may be
        speaking and the meeting date, so owners and due dates survive the
        per-chunk extraction. "" when nothing fits or nothing is known."""
        parts = []
        if self.meeting_date:
            parts.append(f"Meeting date: {self.meeting_date}.")
        if self.recorder:
            parts.append(f"[You] is {_one_line(self.recorder, 80)}.")
        names = _dedupe(self.speakers + self.invitees)
        if names:
            parts.append(f"Participants: {_name_list(names)}.")
        line = " ".join(parts)
        if len(line) > max_chars:
            line = _truncate(line, max_chars)
        return line if len(line) <= max_chars else ""


def calendar_sidecar_path(summary_path) -> Path:
    """``<stem>_calendar.json`` next to ``<stem>_summary.md``."""
    p = Path(summary_path)
    name = p.name
    stem = name[:-len("_summary.md")] if name.endswith("_summary.md") else p.stem
    return p.with_name(f"{stem}_calendar.json")


def load_calendar_event(summary_path) -> Optional[dict]:
    """The calendar event saved for this note, or None (no sidecar, no match,
    or an unreadable file — a summary must never fail over this)."""
    path = calendar_sidecar_path(summary_path)
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError, UnicodeDecodeError) as e:
        logger.warning(f"Ignoring unreadable calendar sidecar {path.name}: {type(e).__name__}")
        return None
    event = record.get("event") if isinstance(record, dict) else None
    return event if isinstance(event, dict) else None


def meeting_date_from_stem(stem: str) -> Optional[str]:
    """Local date of a recording whose stem carries its start in epoch ms
    (``sysaudio-1792058617597-Note``)."""
    m = _STEM_MS_RE.search(stem or "")
    if not m:
        return None
    try:
        return datetime.fromtimestamp(int(m.group(1)) / 1000).date().isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def build_meeting_context(event: Optional[dict] = None,
                          speakers: Optional[list] = None,
                          meeting_date: Optional[str] = None) -> Optional[MeetingContext]:
    """Combine a calendar event (sidecar shape), confirmed speaker names and a
    fallback meeting date. None when there is nothing to tell the model."""
    ctx = MeetingContext(speakers=_dedupe([str(s) for s in (speakers or []) if s]))
    ctx.meeting_date = meeting_date

    if isinstance(event, dict):
        title = (event.get("title") or "").strip()
        if title and title != "No title":
            ctx.title = title
        start, end = event.get("start"), event.get("end")
        start_dt, end_dt = _parse_dt(start), _parse_dt(end)
        if start_dt:
            day = start_dt.date() if isinstance(start_dt, datetime) else start_dt
            ctx.meeting_date = day.isoformat()
            if isinstance(start_dt, datetime) and isinstance(end_dt, datetime):
                ctx.time_range = f"{start_dt:%H:%M}-{end_dt:%H:%M}"
        organizer = event.get("organizer")
        if isinstance(organizer, dict):
            ctx.organizer = _person_name(organizer)
        for a in event.get("attendees") or []:
            if not isinstance(a, dict):
                continue
            name = _person_name(a)
            if not name:
                continue
            if a.get("self"):
                ctx.recorder = name
            elif a.get("status") == "declined":
                ctx.declined.append(name)
            else:
                ctx.invitees.append(name)
        ctx.invitees = _dedupe(ctx.invitees)
        ctx.declined = _dedupe(ctx.declined)
        description = event.get("description")
        if isinstance(description, str) and description.strip():
            ctx.invitation = description.strip()

    if not ctx.has_details() and not ctx.meeting_date:
        return None
    return ctx


def _person_name(person: dict) -> Optional[str]:
    """Display name; for an email-only attendee, the mailbox name (the domain
    adds nothing a summary needs)."""
    name = (person.get("name") or "").strip()
    email = (person.get("email") or "").strip()
    if name and "@" not in name:
        return name
    addr = name or email
    if "@" in addr:
        local = addr.split("@", 1)[0].strip()
        return local or None
    return name or None


def _parse_dt(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        if len(value) == 10:
            return date.fromisoformat(value)
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _dedupe(names: list) -> list:
    seen, out = set(), []
    for n in names:
        key = n.casefold()
        if key not in seen:
            seen.add(key)
            out.append(n)
    return out


def _name_list(names: list) -> str:
    shown = [_one_line(n, 80) for n in names[:MAX_LISTED_NAMES]]
    rest = len(names) - len(shown)
    text = ", ".join(shown)
    return f"{text} and {rest} others" if rest > 0 else text


def _one_line(text: str, limit: int) -> str:
    return _truncate(" ".join(str(text).split()), limit)


def _truncate(text: str, limit: int) -> str:
    """Cut to ``limit`` chars on a line or word boundary, marked with "…"."""
    if len(text) <= limit:
        return text
    if limit <= 1:
        return text[:max(limit, 0)]
    cut = text[:limit - 1]
    boundary = max(cut.rfind("\n"), cut.rfind(" "))
    if boundary >= limit // 2:
        cut = cut[:boundary]
    return cut.rstrip() + "…"


def _fit_lines(lines: list, max_chars: int) -> str:
    """Join lines within ``max_chars``: the first line that does not fit is
    cut short (when a useful part fits) and everything after it dropped."""
    out = ""
    for line in lines:
        sep = "\n" if out else ""
        room = max_chars - len(out) - len(sep)
        if len(line) <= room:
            out += sep + line
            continue
        if room >= 40 or not out:
            out += sep + _truncate(line, room)
        break
    return out
