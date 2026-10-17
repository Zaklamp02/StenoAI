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


if __name__ == "__main__":
    unittest.main()
