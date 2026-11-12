"""The summary prompts ask for a concrete note a colleague can act on, and keep
the four section headers every consumer of a note depends on."""

import unittest

from src.meeting_context import build_meeting_context
from tests.test_meeting_context import synthetic_event
from tests.test_summarizer_meeting_context import _s

TRANSCRIPT = "[You] We ship on Friday. [Others] Budget is fifty thousand."
HEADERS = ("## Summary", "## Key Topics", "## Key Points", "## Action Items")


class SummaryPromptTests(unittest.TestCase):
    def setUp(self):
        ctx = build_meeting_context(synthetic_event())
        self.single = _s()._create_markdown_prompt(TRANSCRIPT, "en", meeting_context=ctx)
        self.reduce = _s()._create_reduce_prompt(["KEY POINTS\n- a"], meeting_context=ctx)

    def test_both_prompts_share_the_writing_rules(self):
        for prompt in (self.single, self.reduce):
            self.assertIn("WRITING RULES", prompt)
            self.assertIn("who said, proposed or agreed what", prompt)
            self.assertIn("speech recognition", prompt)
            self.assertIn("Do not narrate the meeting", prompt)

    def test_decisions_and_open_questions_live_in_key_points(self):
        for prompt in (self.single, self.reduce):
            self.assertIn("- Decision:", prompt)
            self.assertIn("- Open question:", prompt)
            for header in HEADERS:
                self.assertIn(header, prompt)
            self.assertNotIn("## Decisions", prompt)

    def test_reduce_keeps_what_the_map_step_extracted(self):
        self.assertIn("Fold the extracts' DECISIONS and OPEN QUESTIONS", self.reduce)

    def test_meeting_date_is_not_a_default_deadline(self):
        self.assertIn("Never use the meeting date itself as a deadline", self.single)
        self.assertIn("owner and the task on the same line", self.single)

    def test_map_prompt_keeps_specifics(self):
        prompt = _s()._create_map_prompt("chunk", 1, 2)
        self.assertIn("names, numbers and dates", prompt)

    def test_transcript_still_last(self):
        self.assertTrue(self.single.rstrip().endswith(TRANSCRIPT))


if __name__ == "__main__":
    unittest.main()
