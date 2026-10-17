import unittest

from simple_recorder import MeetingPipeline, _action_items_as_tasks


class ActionItemsAsTasksTests(unittest.TestCase):
    def test_action_bullets_become_open_tasks(self):
        md = (
            "## Summary\nShort.\n\n"
            "## Key Points\n- A point stays a bullet\n\n"
            "## Action Items\n- Send the proposal\n* Book a room\n1. Share slides\n"
            "- [x] Already done\n- [ ] Already a task\n  - nested detail stays\n"
        )
        out = _action_items_as_tasks(md)
        self.assertIn("- A point stays a bullet", out)
        self.assertIn("- [ ] Send the proposal", out)
        self.assertIn("- [ ] Book a room", out)
        self.assertIn("- [ ] Share slides", out)
        self.assertIn("- [x] Already done", out)
        self.assertIn("- [ ] Already a task", out)
        self.assertNotIn("- [ ] [ ]", out)
        self.assertIn("  - nested detail stays", out)

    def test_parser_still_reads_plain_action_text(self):
        md = _action_items_as_tasks("## Action Items\n- Send the proposal\n")
        parsed = MeetingPipeline._parse_streamed_markdown(md)
        self.assertEqual(parsed["action_items"], ["Send the proposal"])

    def test_other_templates_are_untouched(self):
        md = "## Next steps\n- Call back\n"
        self.assertEqual(_action_items_as_tasks(md), md)


if __name__ == "__main__":
    unittest.main()
