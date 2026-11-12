"""Action items with an owner and due date: `- [ ] Name: task (due YYYY-MM-DD)`."""

import unittest

from simple_recorder import MeetingPipeline, _action_items_as_tasks, _normalize_action_item


def _actions(md_body: str) -> str:
    return _action_items_as_tasks(f"## Summary\nShort.\n\n## Action Items\n{md_body}")


class OwnerDueFormatTests(unittest.TestCase):
    def test_owner_and_due_are_kept(self):
        out = _actions("- Piet: send the pilot budget (due 2026-10-17)\n- Book a room\n")
        self.assertIn("- [ ] Piet: send the pilot budget (due 2026-10-17)", out)
        self.assertIn("- [ ] Book a room", out)

    def test_parser_reads_owner_and_due_text(self):
        md = _actions("- Piet: send the budget (due 2026-10-17)\n- [x] Anna: share slides\n")
        parsed = MeetingPipeline._parse_streamed_markdown(md)
        self.assertEqual(parsed["action_items"], [
            "Piet: send the budget (due 2026-10-17)",
            "Anna: share slides",
        ])

    def test_bold_and_bracket_owners_are_tidied(self):
        self.assertEqual(_normalize_action_item("**Anna:** share slides"), "Anna: share slides")
        self.assertEqual(_normalize_action_item("**Anna**: share slides"), "Anna: share slides")
        self.assertEqual(_normalize_action_item("[Anna]: share slides"), "Anna: share slides")
        # Bold without a colon is emphasis, not an owner.
        self.assertEqual(_normalize_action_item("**Urgent** fix the build"), "**Urgent** fix the build")

    def test_placeholder_owners_are_dropped(self):
        for placeholder in ("Unassigned", "TBD", "Unknown", "Owner", "N/A", "Onbekend"):
            self.assertEqual(_normalize_action_item(f"{placeholder}: book a room"), "book a room")
        self.assertEqual(_normalize_action_item("[Owner]: book a room"), "book a room")

    def test_due_variants(self):
        self.assertEqual(_normalize_action_item("Piet: send it (due: 2026-10-17)"),
                         "Piet: send it (due 2026-10-17)")
        self.assertEqual(_normalize_action_item("Piet: send it (Deadline 2026-10-17)"),
                         "Piet: send it (due 2026-10-17)")
        for empty in ("(due YYYY-MM-DD)", "(due: unknown)", "(due N/A)", "(due)", "(deadline: TBD)"):
            self.assertEqual(_normalize_action_item(f"Piet: send it {empty}"), "Piet: send it")

    def test_nothing_is_added(self):
        self.assertEqual(_normalize_action_item("send it next week"), "send it next week")
        self.assertEqual(_normalize_action_item("Piet: send it (before the release)"),
                         "Piet: send it (before the release)")

    def test_existing_task_state_is_kept_while_tidying(self):
        out = _actions("- [x] **Anna:** share slides (due: 2026-10-20)\n")
        self.assertIn("- [x] Anna: share slides (due 2026-10-20)", out)

    def test_other_sections_untouched(self):
        md = "## Key Points\n- TBD: a point\n\n## Action Items\n- TBD: a task\n"
        out = _action_items_as_tasks(md)
        self.assertIn("- TBD: a point", out)
        self.assertIn("- [ ] a task", out)


class SmallModelRepairTests(unittest.TestCase):
    """Shapes a small local model really wrote (gemma4 e2b, November 2026)."""

    def _lines(self, body, meeting_date=None):
        out = _action_items_as_tasks(f"## Action Items\n{body}", meeting_date)
        return [ln for ln in out.split("\n")[1:] if ln.strip()]

    def test_owner_only_bullet_joins_the_next_bullet(self):
        self.assertEqual(self._lines(
            "- Speaker 3 (due 2026-11-11)\n- Check some PRs\n"
            "- Create tickets\n"), [
            "- [ ] Speaker 3: Check some PRs (due 2026-11-11)",
            "- [ ] Create tickets",
        ])

    def test_owner_only_bullet_owns_each_nested_bullet(self):
        self.assertEqual(self._lines(
            "- [You] (due 2026-11-06)\n  - Plan a release party\n  - Book the room\n"
            "- Speaker 5:\n  - Send the dates\n"), [
            "- [ ] You: Plan a release party (due 2026-11-06)",
            "- [ ] You: Book the room (due 2026-11-06)",
            "- [ ] Speaker 5: Send the dates",
        ])

    def test_owner_and_due_written_before_the_task(self):
        self.assertEqual(_normalize_action_item("[Anna] (due 2026-11-11) - Start with the top 5"),
                         "Anna: Start with the top 5 (due 2026-11-11)")
        self.assertEqual(_normalize_action_item("Anna (due 2026-11-11): plan it"),
                         "Anna: plan it (due 2026-11-11)")
        self.assertEqual(_normalize_action_item("[Anna] - plan it"), "Anna: plan it")

    def test_placeholders_in_other_languages_and_template_echo(self):
        self.assertEqual(_normalize_action_item("[Niet gespecificeerd] (due 2026-11-11) - Starten"),
                         "Starten (due 2026-11-11)")
        self.assertEqual(_normalize_action_item("action (due 2026-11-11): Doen we dat."),
                         "Doen we dat. (due 2026-11-11)")
        self.assertEqual(_normalize_action_item("Nicht angegeben: Raum buchen"), "Raum buchen")

    def test_meeting_date_stamped_on_every_item_is_dropped(self):
        self.assertEqual(self._lines(
            "- Piet: send it (due 2026-11-11)\n- Book a room (due 2026-11-11)\n",
            "2026-11-11"), ["- [ ] Piet: send it", "- [ ] Book a room"])

    def test_real_deadlines_are_kept(self):
        # One item due the same day is plausible; so is the meeting date
        # alongside other dates.
        self.assertEqual(self._lines("- Piet: send it today (due 2026-11-11)\n- Book a room\n",
                                     "2026-11-11"),
                         ["- [ ] Piet: send it today (due 2026-11-11)", "- [ ] Book a room"])
        self.assertEqual(self._lines(
            "- Piet: a (due 2026-11-11)\n- Anna: b (due 2026-11-11)\n- Jan: c (due 2026-11-20)\n",
            "2026-11-11")[0], "- [ ] Piet: a (due 2026-11-11)")
        self.assertEqual(self._lines("- Piet: a (due 2026-11-11)\n- Anna: b (due 2026-11-11)\n"),
                         ["- [ ] Piet: a (due 2026-11-11)", "- [ ] Anna: b (due 2026-11-11)"])

    def test_a_task_is_not_taken_for_an_owner(self):
        self.assertEqual(self._lines("- Deploy (due 2026-11-20)\n- Book a room\n"),
                         ["- [ ] Deploy (due 2026-11-20)", "- [ ] Book a room"])
        self.assertEqual(self._lines("- Send the deck\n  - include pricing\n"),
                         ["- [ ] Send the deck", "  - include pricing"])

    def test_an_owner_with_no_task_is_kept(self):
        out = _action_items_as_tasks("## Action Items\n- Matthijs:\n\n## Transcript\nx\n")
        self.assertIn("- [ ] Matthijs:\n\n## Transcript", out)


if __name__ == "__main__":
    unittest.main()
