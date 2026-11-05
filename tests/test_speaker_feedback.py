import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from click.testing import CliRunner

import simple_recorder
from src.config import Config
from src.speaker_feedback import FEEDBACK_LOG_NAME, feedback_summary
from src.speaker_suggestions import write_speakers_sidecar


def _last_json(output):
    line = [ln for ln in output.splitlines() if ln.strip().startswith("{")][-1]
    return json.loads(line)


def _cluster(embedding, start, seconds=30.0, segments=5):
    return {
        "embedding": embedding,
        "speech_duration_seconds": seconds,
        "segment_count": segments,
        "segments": [{"start": start, "end": start + seconds}],
    }


class SpeakerFeedbackTests(unittest.TestCase):
    """What confirm-speaker and mark-speaker-cluster report about a review
    decision: the numbers behind the suggestion, never who anyone is."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name
        self.output = Path(self.tmp) / "output"
        self.output.mkdir()
        self.cfg = Config(config_path=Path(self.tmp) / "config.json")
        self.cfg.set_identity_matching_enabled(True)
        for stem in ("mtgA", "mtgB"):
            write_speakers_sidecar(self.output, stem, {
                "mic": {
                    "recording_type": "in_person",
                    "clusters": {
                        "SPEAKER_00": _cluster([1.0, 0.0, 0.0], 0.0),
                        "SPEAKER_01": _cluster([0.0, 1.0, 0.0], 40.0),
                    },
                },
                "system": {
                    "recording_type": "remote",
                    "clusters": {"SPEAKER_00": _cluster([0.0, 0.0, 1.0], 80.0)},
                },
            })

    def tearDown(self):
        self._tmp.cleanup()

    def _invoke(self, command, args):
        with mock.patch("src.config.get_config", return_value=self.cfg), \
             mock.patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": self.tmp}):
            result = CliRunner().invoke(command, args)
        self.assertEqual(result.exit_code, 0, result.output)
        return _last_json(result.output)

    def _confirm(self, stem, channel, sid, *, person_id=None, new_person=None):
        args = [stem, channel, sid]
        args += ["--person-id", person_id] if person_id else ["--new-person", new_person]
        return self._invoke(simple_recorder.confirm_speaker, args)

    def _person_id(self, name):
        return next(p["person_id"] for p in self.cfg.get_person_profiles() if p["display_name"] == name)

    def _enrol_alpha_and_beta(self):
        self._confirm("mtgA", "mic", "SPEAKER_00", new_person="Alpha")
        self._confirm("mtgA", "mic", "SPEAKER_01", new_person="Beta")

    def test_a_new_person_without_evidence_is_reported_as_new(self):
        out = self._confirm("mtgA", "mic", "SPEAKER_00", new_person="Alpha")
        feedback = out["feedback"]
        self.assertEqual(feedback["action"], "new_person")
        self.assertEqual(feedback["suggestion_status"], "none")
        self.assertEqual(feedback["chosen_rank"], "new_person")
        self.assertEqual(feedback["known_people"], 0)

    def test_accepting_reports_which_gate_kept_it_a_possible(self):
        self._enrol_alpha_and_beta()
        feedback = self._confirm("mtgB", "mic", "SPEAKER_00", person_id=self._person_id("Alpha"))["feedback"]

        self.assertEqual(feedback["action"], "accepted_possible")
        self.assertEqual(feedback["chosen_rank"], 1)
        self.assertAlmostEqual(feedback["chosen_distance"], 0.0)
        # Alpha has evidence from one meeting only, so that gate held it back.
        self.assertTrue(feedback["blocked_by"]["confirmed_meetings"])
        self.assertFalse(feedback["blocked_by"]["threshold"])
        self.assertEqual(feedback["best_confirmed_meetings"], 1)

    def test_overriding_reports_the_chosen_persons_rank_and_distance(self):
        self._enrol_alpha_and_beta()
        feedback = self._confirm("mtgB", "mic", "SPEAKER_00", person_id=self._person_id("Beta"))["feedback"]

        self.assertEqual(feedback["action"], "overrode_suggestion")
        self.assertEqual(feedback["chosen_rank"], 2)
        self.assertAlmostEqual(feedback["chosen_distance"], 1.0)
        self.assertAlmostEqual(feedback["runner_up_margin"], 1.0)

    def test_the_meetings_own_confirmations_do_not_score_the_model(self):
        self._confirm("mtgA", "mic", "SPEAKER_00", new_person="Alpha")
        # Re-confirming the same cluster: Alpha's only evidence IS this
        # cluster, so a fair model has nothing to suggest.
        feedback = self._confirm("mtgA", "mic", "SPEAKER_00", person_id=self._person_id("Alpha"))["feedback"]
        self.assertEqual(feedback["action"], "named_unsuggested")
        self.assertEqual(feedback["chosen_rank"], "no_evidence")
        self.assertTrue(feedback["reassigned"] is False)

    def test_one_person_on_two_clusters_reports_how_far_the_merge_rules_were(self):
        self._enrol_alpha_and_beta()
        alpha = self._person_id("Alpha")
        self._confirm("mtgB", "mic", "SPEAKER_00", person_id=alpha)
        same = self._confirm("mtgB", "mic", "SPEAKER_01", person_id=alpha)["feedback"]
        cross = self._confirm("mtgB", "system", "SPEAKER_00", person_id=alpha)["feedback"]

        self.assertAlmostEqual(same["same_channel_split"]["distance"], 1.0)
        self.assertEqual(same["same_channel_split"]["overlap"], 0.0)
        self.assertIsNone(same["cross_channel_split"])
        self.assertAlmostEqual(cross["cross_channel_split"]["distance"], 1.0)

    def test_invitees_are_checked_locally_and_only_the_answer_is_kept(self):
        self._enrol_alpha_and_beta()
        (self.output / "mtgB_calendar.json").write_text(json.dumps({
            "attendees": [{"name": "Beta Person", "email": "beta@example.test"}],
        }))
        feedback = self._confirm("mtgB", "mic", "SPEAKER_00", person_id=self._person_id("Beta"))["feedback"]
        self.assertEqual(feedback["suggested_was_invitee"], "no")
        self.assertEqual(feedback["chosen_was_invitee"], "yes")

    def test_nothing_identifying_is_reported_and_the_log_is_kept(self):
        self._enrol_alpha_and_beta()
        (self.output / "mtgB_calendar.json").write_text(json.dumps({
            "attendees": [{"name": "Beta Person", "email": "beta@example.test"}],
        }))
        beta = self._person_id("Beta")
        feedback = self._confirm("mtgB", "mic", "SPEAKER_00", person_id=beta)["feedback"]
        dumped = json.dumps(feedback)
        for secret in ("Alpha", "Beta", beta, "example.test", "mtgB", "SPEAKER_00", "0.0, 0.0"):
            self.assertNotIn(secret, dumped)

        lines = (Path(self.tmp) / FEEDBACK_LOG_NAME).read_text().splitlines()
        self.assertEqual(len(lines), 3)
        self.assertEqual(json.loads(lines[-1])["action"], "overrode_suggestion")
        self.assertEqual(feedback_summary(Path(self.tmp))["suggested"], 1)

    def test_marking_a_cluster_as_several_people_reports_its_size(self):
        out = self._invoke(simple_recorder.mark_speaker_cluster, ["mtgA", "mic", "SPEAKER_01"])
        self.assertEqual(out["feedback"], {
            "action": "marked_multiple_speakers",
            "channel": "mic",
            "speech_seconds": 30.0,
            "segment_count": 5,
            "merged_fragments": 0,
            "clusters_in_channel": 2,
            "diarization_engine": out["feedback"]["diarization_engine"],
        })

    def test_clearing_a_marking_reports_nothing(self):
        self._invoke(simple_recorder.mark_speaker_cluster, ["mtgA", "mic", "SPEAKER_01"])
        out = self._invoke(simple_recorder.mark_speaker_cluster, ["mtgA", "mic", "SPEAKER_01", "--single"])
        self.assertIsNone(out["feedback"])

    def test_a_failing_feedback_computation_never_fails_the_confirm(self):
        with mock.patch("src.speaker_feedback.correction_feedback", side_effect=RuntimeError("boom")):
            out = self._confirm("mtgA", "mic", "SPEAKER_00", new_person="Alpha")
        self.assertTrue(out["success"])
        self.assertIsNone(out["feedback"])


if __name__ == "__main__":
    unittest.main()
