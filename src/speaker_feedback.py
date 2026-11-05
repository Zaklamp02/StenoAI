"""What a speaker-review decision says about our thresholds.

When someone names, accepts or rejects a speaker in review, that decision is
ground truth we otherwise never get. On its own ("the user overrode a
suggestion") it says only that something went wrong. This module records it
together with the numbers that decided what we showed, so a pattern across
many corrections points at the constant to change:

- the best candidate's distance, its margin over the runner-up, and which
  gate held the suggestion back -- SUGGESTION_DISTANCE_THRESHOLD,
  SUGGESTION_CONFIDENCE_MARGIN, the stability gate
  (SUGGESTION_MIN_DURATION_SECONDS / _MIN_SEGMENT_COUNT / _MIN_AVG_TURN_SECONDS),
  SUGGESTION_MIN_CONFIRMED_MEETINGS and the hard-negative rule;
- where the chosen person ranked and how far away they were: a person picked
  at rank 2 is identity confusion, a person picked past the threshold says
  the threshold is too strict;
- when the chosen person already holds another cluster of this meeting, how
  far apart and how coincident the two clusters are: the same channel tests
  SAME_MEETING_MERGE_DISTANCE_THRESHOLD, the other channel tests the
  cross-channel echo merge (CROSS_CHANNEL_ECHO_*);
- whether the suggested and chosen people were invited (computed here from
  the local calendar file; the invite list itself never leaves), the
  evidence for or against an invitee prior.

Scoring uses only evidence from OTHER meetings: this meeting's own earlier
confirmations would match the cluster to itself and say nothing about the
model.

Nothing returned names anyone: no display names, person ids, emails,
embeddings or text. Distances stay unrounded here because the record is also
kept locally (speaker_feedback.jsonl) for the user's own accuracy figures;
the shell buckets them before anything is sent (speakerFeedbackProperties in
app/analytics-helpers.js).
"""

import json
import logging
import time
import unicodedata
from pathlib import Path
from typing import Optional

from src.speaker_suggestions import (
    SUGGESTION_CONFIDENCE_MARGIN,
    SUGGESTION_DISTANCE_THRESHOLD,
    SUGGESTION_MIN_AVG_TURN_SECONDS,
    SUGGESTION_MIN_CONFIRMED_MEETINGS,
    SUGGESTION_MIN_DURATION_SECONDS,
    SUGGESTION_MIN_SEGMENT_COUNT,
    score_candidates,
    suggest_speakers_for_meeting,
)

logger = logging.getLogger(__name__)

FEEDBACK_LOG_NAME = "speaker_feedback.jsonl"


def _without_meeting_evidence(profiles: list, meeting_stem: str) -> list:
    """Profiles as the model knows them from every meeting but this one."""
    stripped = []
    for person in profiles or []:
        if not isinstance(person, dict):
            continue
        stripped.append({
            **person,
            "prototypes": [
                p for p in (person.get("prototypes") or [])
                if p.get("meeting_id") != meeting_stem
            ],
            "hard_negatives": [
                n for n in (person.get("hard_negatives") or [])
                if n.get("meeting_id") != meeting_stem
            ],
        })
    return stripped


def _blocked_gates(candidates: list, context) -> dict:
    """Which of suggest_speaker's gates the best candidate failed.

    Mirrors suggest_speaker's own rules rather than parsing its reason
    strings, so a reworded reason cannot silently change what is reported.
    """
    if not candidates:
        return {}
    best = candidates[0]
    second = candidates[1] if len(candidates) > 1 else None
    margin = (second.distance - best.distance) if second else None
    avg_turn = (
        context.speech_duration_seconds / context.segment_count
        if context.segment_count else 0.0
    )
    return {
        "hard_negative": bool(best.hard_negative_conflict),
        "threshold": best.distance >= SUGGESTION_DISTANCE_THRESHOLD,
        "margin": margin is not None and margin < SUGGESTION_CONFIDENCE_MARGIN,
        "stability": not (
            context.speech_duration_seconds >= SUGGESTION_MIN_DURATION_SECONDS
            and context.segment_count >= SUGGESTION_MIN_SEGMENT_COUNT
            and avg_turn >= SUGGESTION_MIN_AVG_TURN_SECONDS
        ),
        "confirmed_meetings": best.confirmed_meeting_count < SUGGESTION_MIN_CONFIRMED_MEETINGS,
    }


def _fold(text) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(text or "")).casefold().split())


def _invitee_status(person: Optional[dict], invitees: Optional[list], contacts: dict) -> str:
    """"yes", "no", or "unknown" when there is no calendar event to ask.

    A person counts as invited when their saved contact email is on the
    invite, or their name equals an invitee's full name or first name.
    """
    if invitees is None or person is None:
        return "unknown"
    contact = contacts.get(person.get("person_id")) if isinstance(contacts, dict) else None
    email = _fold((contact or {}).get("email")) if isinstance(contact, dict) else ""
    name = _fold(person.get("display_name"))
    for attendee in invitees:
        if not isinstance(attendee, dict) or attendee.get("self"):
            continue
        attendee_email = _fold(attendee.get("email"))
        attendee_name = _fold(attendee.get("name"))
        if email and attendee_email and email == attendee_email:
            return "yes"
        if name and attendee_name and (
            name == attendee_name or name == attendee_name.split(" ")[0]
        ):
            return "yes"
    return "no"


def load_invitees(output_dir: Path, meeting_stem: str) -> Optional[list]:
    """The meeting's calendar attendees, or None when no event was saved."""
    path = Path(output_dir) / f"{meeting_stem}_calendar.json"
    try:
        event = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(event, dict):
        return None
    attendees = event.get("attendees")
    return attendees if isinstance(attendees, list) else None


def load_person_contacts(user_data_dir: Path) -> dict:
    """person-contacts.json (written by the shell), or {} when absent."""
    try:
        contacts = json.loads((Path(user_data_dir) / "person-contacts.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return contacts if isinstance(contacts, dict) else {}


def _held_clusters(profiles: list, person_id: str, meeting_stem: str, run_matches) -> list:
    """(channel, diarization_speaker_id) the person already holds here."""
    for person in profiles or []:
        if person.get("person_id") != person_id:
            continue
        return [
            (p.get("channel"), p.get("diarization_speaker_id"))
            for p in (person.get("prototypes") or [])
            if p.get("meeting_id") == meeting_stem
            and p.get("channel") in ("mic", "system")
            and run_matches(p)
        ]
    return []


def _split_signals(
    *,
    merged_by_channel: dict,
    raw_channels: dict,
    channel: str,
    resolved_id: str,
    held: list,
    id_resolution_by_channel: dict,
) -> dict:
    """Distance and speech overlap to other clusters of this meeting the
    chosen person already holds, nearest one per side.

    A same-channel pair is a diarizer fragment our fold missed; a
    cross-channel pair is an echo our reconciliation missed. Either way the
    numbers say how far the rule was from catching it.
    """
    from src.transcriber import (
        CROSS_CHANNEL_ECHO_PAD_S,
        _cluster_speech_intervals,
        _speech_overlap_ratio,
    )
    from src.voiceprint import cosine_distance

    embedding = merged_by_channel[channel][resolved_id][0]
    out = {"same_channel": None, "cross_channel": None}
    for other_channel, sid in held:
        other_id = (id_resolution_by_channel.get(other_channel) or {}).get(sid, sid)
        if other_channel == channel and other_id == resolved_id:
            continue
        other = (merged_by_channel.get(other_channel) or {}).get(other_id)
        if other is None:
            continue
        try:
            distance = cosine_distance(embedding, other[0])
        except (TypeError, ValueError):
            continue

        def _intervals(ch, cluster_id, merged_from):
            clusters = (raw_channels.get(ch) or {}).get("clusters") or {}
            return _cluster_speech_intervals(*[
                clusters[i] for i in [cluster_id, *merged_from] if isinstance(clusters.get(i), dict)
            ])

        overlap = _speech_overlap_ratio(
            _intervals(channel, resolved_id, merged_by_channel[channel][resolved_id][1].merged_from),
            _intervals(other_channel, other_id, other[1].merged_from),
            CROSS_CHANNEL_ECHO_PAD_S,
        )
        key = "same_channel" if other_channel == channel else "cross_channel"
        if out[key] is None or distance < out[key]["distance"]:
            out[key] = {"distance": distance, "overlap": overlap}
    return out


def correction_feedback(
    *,
    meeting_stem: str,
    channel: str,
    resolved_id: str,
    merged_by_channel: dict,
    id_resolution_by_channel: dict,
    raw_channels: dict,
    profiles_before: list,
    chosen_person_id: Optional[str],
    reassigned: bool,
    run_matches,
    invitees: Optional[list],
    contacts: dict,
    diarization_engine: Optional[str],
) -> dict:
    """The record for one confirm-speaker decision.

    ``chosen_person_id`` is None when the user created a new person.
    ``profiles_before`` are the profiles as the panel saw them, before this
    confirm changed anything.
    """
    model_profiles = _without_meeting_evidence(profiles_before, meeting_stem)
    results = suggest_speakers_for_meeting(merged_by_channel, model_profiles)
    result = results[channel][resolved_id]
    embedding, context = merged_by_channel[channel][resolved_id]
    # Unfiltered by meeting-wide exclusivity, so the chosen person's real
    # rank and distance are known even if another cluster claimed them.
    all_candidates = score_candidates(embedding, context, model_profiles)

    suggested = result.suggested_person_id
    if chosen_person_id is None:
        action = "new_person_over_suggestion" if suggested else "new_person"
    elif suggested and chosen_person_id == suggested:
        action = "accepted_confirmed" if result.status == "confirmed" else "accepted_possible"
    elif suggested:
        action = "overrode_suggestion"
    else:
        action = "named_unsuggested"

    chosen = next(
        (c for c in all_candidates if c.person_id == chosen_person_id), None,
    ) if chosen_person_id else None
    chosen_rank = (
        all_candidates.index(chosen) + 1 if chosen is not None
        else ("new_person" if chosen_person_id is None else "no_evidence")
    )
    claimed_elsewhere = bool(chosen_person_id) and any(
        r.status == "confirmed" and r.suggested_person_id == chosen_person_id
        for ch, by_id in results.items()
        for sid, r in by_id.items()
        if not (ch == channel and sid == resolved_id)
    )

    best = all_candidates[0] if all_candidates else None
    runner_up = all_candidates[1] if len(all_candidates) > 1 else None
    by_id = {p.get("person_id"): p for p in profiles_before or [] if isinstance(p, dict)}
    held = (
        _held_clusters(profiles_before, chosen_person_id, meeting_stem, run_matches)
        if chosen_person_id else []
    )
    splits = _split_signals(
        merged_by_channel=merged_by_channel,
        raw_channels=raw_channels,
        channel=channel,
        resolved_id=resolved_id,
        held=held,
        id_resolution_by_channel=id_resolution_by_channel,
    ) if held else {"same_channel": None, "cross_channel": None}

    return {
        "action": action,
        "reassigned": bool(reassigned),
        "channel": channel,
        "suggestion_status": result.status,
        "blocked_by": _blocked_gates(all_candidates, context),
        "known_people": len([p for p in model_profiles if p.get("prototypes")]),
        "best_distance": best.distance if best else None,
        "runner_up_margin": (runner_up.distance - best.distance) if best and runner_up else None,
        "best_confirmed_meetings": best.confirmed_meeting_count if best else None,
        "chosen_rank": chosen_rank,
        "chosen_distance": chosen.distance if chosen else None,
        "chosen_hard_negative_conflict": bool(chosen.hard_negative_conflict) if chosen else False,
        "chosen_confirmed_meetings": chosen.confirmed_meeting_count if chosen else None,
        "chosen_claimed_by_other_cluster": claimed_elsewhere,
        "speech_seconds": context.speech_duration_seconds,
        "segment_count": context.segment_count,
        "merged_fragments": len(context.merged_from),
        "clusters_in_channel": len(merged_by_channel.get(channel) or {}),
        "same_channel_split": splits["same_channel"],
        "cross_channel_split": splits["cross_channel"],
        "suggested_was_invitee": _invitee_status(by_id.get(suggested), invitees, contacts) if suggested else "none",
        "chosen_was_invitee": (
            _invitee_status(by_id.get(chosen_person_id), invitees, contacts)
            if chosen_person_id else "unknown"
        ),
        "diarization_engine": diarization_engine,
    }


def mixed_cluster_feedback(
    *,
    channel: str,
    context,
    clusters_in_channel: int,
    diarization_engine: Optional[str],
) -> dict:
    """The record for marking a cluster as holding more than one person.

    The diarizer merged two voices. Its size and the channel's cluster count
    say whether that happens on long clusters (a preset that splits too
    little) or in crowded channels (a speaker cap), per engine.
    """
    return {
        "action": "marked_multiple_speakers",
        "channel": channel,
        "speech_seconds": context.speech_duration_seconds,
        "segment_count": context.segment_count,
        "merged_fragments": len(context.merged_from),
        "clusters_in_channel": clusters_in_channel,
        "diarization_engine": diarization_engine,
    }


def append_feedback_log(user_data_dir: Path, record: dict) -> None:
    """Keep the record locally, best-effort. It never fails a confirm."""
    try:
        path = Path(user_data_dir) / FEEDBACK_LOG_NAME
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"recorded_at": time.time(), **record}) + "\n")
    except OSError as error:
        logger.warning("Could not keep speaker feedback locally: %s", error)


def feedback_summary(user_data_dir: Path) -> dict:
    """How often suggestions were right, from the local log only."""
    counts = {"suggested": 0, "accepted": 0, "named_without_suggestion": 0, "marked_mixed": 0}
    try:
        lines = (Path(user_data_dir) / FEEDBACK_LOG_NAME).read_text(encoding="utf-8").splitlines()
    except OSError:
        lines = []
    for line in lines:
        try:
            action = json.loads(line).get("action")
        except (ValueError, AttributeError):
            continue
        if action in ("accepted_confirmed", "accepted_possible"):
            counts["suggested"] += 1
            counts["accepted"] += 1
        elif action in ("overrode_suggestion", "new_person_over_suggestion"):
            counts["suggested"] += 1
        elif action in ("named_unsuggested", "new_person"):
            counts["named_without_suggestion"] += 1
        elif action == "marked_multiple_speakers":
            counts["marked_mixed"] += 1
    return counts
