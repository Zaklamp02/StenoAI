import os
import unittest
from unittest import mock

from simple_recorder import _recorded_at_override


class RecordedAtOverrideTests(unittest.TestCase):
    def test_unset_means_no_override(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("STENOAI_RECORDED_AT", None)
            self.assertIsNone(_recorded_at_override())

    def test_valid_local_time_is_used(self):
        with mock.patch.dict(os.environ, {"STENOAI_RECORDED_AT": "2026-10-17T19:13:02"}):
            self.assertEqual(_recorded_at_override(), "2026-10-17T19:13:02")

    def test_garbage_is_ignored(self):
        with mock.patch.dict(os.environ, {"STENOAI_RECORDED_AT": "yesterday"}):
            self.assertIsNone(_recorded_at_override())


if __name__ == "__main__":
    unittest.main()
