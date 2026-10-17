"""Meeting context for summary prompts: calendar sidecar + confirmed speakers."""

import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from src.meeting_context import (
    MAX_LISTED_NAMES,
    build_meeting_context,
    calendar_sidecar_path,
    load_calendar_event,
    meeting_date_from_stem,
)


def synthetic_event(**overrides):
    event = {
        "id": "evt-1",
        "title": "Q4 roadmap review",
        "is_all_day": False,
        "calendar": "Work",
        "start": "2026-10-15T10:00:00+02:00",
        "end": "2026-10-15T11:00:00+02:00",
        "description": "Agenda:\n1. Decide the Q4 launch scope\n2. Budget for the pilot",
        "organizer": {"name": "Anna de Vries", "email": "anna@example.com"},
        "attendees": [
            {"status": "accepted", "name": "Anna de Vries", "email": "anna@example.com"},
            {"status": "accepted", "name": "Sam Recorder", "email": "sam@example.com", "self": True},
            {"status": "tentative", "email": "piet.jansen@example.com"},
            {"status": "declined", "name": "Mark Absent"},
        ],
        "response_status": "accepted",
    }
    event.update(overrides)
    return event


class BuildMeetingContextTests(unittest.TestCase):
    def test_event_fields_become_context(self):
        ctx = build_meeting_context(synthetic_event(), speakers=["Bram Spreker"])
        self.assertEqual(ctx.title, "Q4 roadmap review")
        self.assertEqual(ctx.meeting_date, "2026-10-15")
        self.assertEqual(ctx.time_range, "10:00-11:00")
        self.assertEqual(ctx.organizer, "Anna de Vries")
        self.assertEqual(ctx.recorder, "Sam Recorder")
        # Email-only attendee -> mailbox name; declined kept apart.
        self.assertEqual(ctx.invitees, ["Anna de Vries", "piet.jansen"])
        self.assertEqual(ctx.declined, ["Mark Absent"])
        self.assertEqual(ctx.speakers, ["Bram Spreker"])

    def test_render_names_attendees_and_purpose(self):
        text = build_meeting_context(synthetic_event(), ["Bram Spreker"]).render(4000)
        self.assertIn("MEETING CONTEXT", text)
        self.assertIn("Title: Q4 roadmap review", text)
        self.assertIn("Date: 2026-10-15 10:00-11:00", text)
        self.assertIn("Invited: Anna de Vries, piet.jansen", text)
        self.assertIn("Recorded by: Sam Recorder", text)
        self.assertIn("Speakers identified in the recording: Bram Spreker", text)
        self.assertIn("Decide the Q4 launch scope", text)
        self.assertIn("Declined (not present): Mark Absent", text)
        # The model is told the agenda is not a record of the discussion.
        self.assertIn("only report topics", text)
        # No email domains reach the prompt.
        self.assertNotIn("@", text)

    def test_nothing_known_returns_none(self):
        self.assertIsNone(build_meeting_context(None, [], None))
        self.assertIsNone(build_meeting_context({"title": "No title", "attendees": []}))

    def test_speakers_only(self):
        ctx = build_meeting_context(None, ["Anna", "anna", "Piet"])
        self.assertEqual(ctx.speakers, ["Anna", "Piet"])
        self.assertIn("Speakers identified in the recording: Anna, Piet", ctx.render(2000))

    def test_date_only_renders_date(self):
        ctx = build_meeting_context(None, [], "2026-10-15")
        self.assertFalse(ctx.has_details())
        self.assertIn("Date: 2026-10-15", ctx.render(2000))

    def test_all_day_event_has_date_without_times(self):
        ctx = build_meeting_context(synthetic_event(is_all_day=True, start="2026-10-15", end="2026-10-16"))
        self.assertEqual(ctx.meeting_date, "2026-10-15")
        self.assertIsNone(ctx.time_range)


class BudgetTests(unittest.TestCase):
    def test_very_long_invitation_is_cut_to_budget(self):
        long_text = "Background paragraph about the programme. " * 5000  # ~215k chars
        ctx = build_meeting_context(synthetic_event(description=long_text), ["Bram"])
        for budget in (800, 1310, 4000, 6000):
            text = ctx.render(budget)
            self.assertLessEqual(len(text), budget)
            # Names come before the invitation, so they survive the cut.
            self.assertIn("Title: Q4 roadmap review", text)
            self.assertIn("Anna de Vries", text)
            self.assertIn("Bram", text)
        self.assertTrue(ctx.render(4000).endswith("…"))

    def test_large_invitee_list_is_capped(self):
        attendees = [{"status": "accepted", "name": f"Person {i}"} for i in range(300)]
        ctx = build_meeting_context(synthetic_event(attendees=attendees))
        text = ctx.render(6000)
        self.assertIn(f"and {300 - MAX_LISTED_NAMES} others", text)
        self.assertNotIn("Person 299", text)
        self.assertLessEqual(len(ctx.render(500)), 500)

    def test_names_line_fits(self):
        ctx = build_meeting_context(synthetic_event(), ["Bram"])
        line = ctx.names_line(400)
        self.assertLessEqual(len(line), 400)
        self.assertIn("Meeting date: 2026-10-15.", line)
        self.assertIn("[You] is Sam Recorder.", line)
        self.assertIn("Bram", line)
        self.assertLessEqual(len(ctx.names_line(30)), 30)


class SidecarTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.summary = self.dir / "sysaudio-1792058617597-Note_summary.md"

    def tearDown(self):
        self.tmp.cleanup()

    def test_sidecar_path(self):
        self.assertEqual(calendar_sidecar_path(self.summary).name,
                         "sysaudio-1792058617597-Note_calendar.json")

    def test_missing_sidecar(self):
        self.assertIsNone(load_calendar_event(self.summary))

    def test_sidecar_with_event(self):
        calendar_sidecar_path(self.summary).write_text(
            json.dumps({"checked_at": "2026-10-15T08:00:00Z", "event": synthetic_event()}), encoding="utf-8")
        self.assertEqual(load_calendar_event(self.summary)["title"], "Q4 roadmap review")

    def test_sidecar_without_match(self):
        calendar_sidecar_path(self.summary).write_text(json.dumps({"checked_at": "x", "event": None}))
        self.assertIsNone(load_calendar_event(self.summary))

    def test_corrupt_sidecar_is_ignored(self):
        calendar_sidecar_path(self.summary).write_text("{not json")
        self.assertIsNone(load_calendar_event(self.summary))

    def test_meeting_date_from_stem(self):
        expected = datetime.fromtimestamp(1792058617.597).date().isoformat()
        self.assertEqual(meeting_date_from_stem("sysaudio-1792058617597-Note"), expected)
        self.assertIsNone(meeting_date_from_stem("imported-call"))


if __name__ == "__main__":
    unittest.main()
