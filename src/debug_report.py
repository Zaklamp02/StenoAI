"""A per-meeting debug report, built only when the user asks for one.

The report answers "why did this meeting's speakers come out like that"
without any of the meeting: per channel, each speaker cluster's size, how
its suggestion was scored and which gate held it back, the distances
between clusters (the input to every merge rule), whether a human marked or
named it, plus the pipeline's own bleed and merge decisions
(``{stem}_pipeline.json``) and the thresholds this build used.

Never included: transcript or summary text, names, person ids, emails,
calendar content, embeddings, segment timestamps, file paths. Clusters are
renamed C1, C2, ... per channel. The user sees the whole report before it is
sent.
"""

import json
import math
from pathlib import Path
from typing import Optional

from src import speaker_suggestions as ss
from src.pipeline_stats import pipeline_stats_path

REPORT_SCHEMA_VERSION = 1


def _round(value, digits=3):
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return round(float(value), digits)
    return None


def _thresholds() -> dict:
    from src import transcriber as tr
    return {
        "suggestion_distance": ss.SUGGESTION_DISTANCE_THRESHOLD,
        "suggestion_margin": ss.SUGGESTION_CONFIDENCE_MARGIN,
        "hard_negative_distance": ss.HARD_NEGATIVE_DISTANCE_THRESHOLD,
        "min_speech_seconds": ss.SUGGESTION_MIN_DURATION_SECONDS,
        "min_segments": ss.SUGGESTION_MIN_SEGMENT_COUNT,
        "min_avg_turn_seconds": ss.SUGGESTION_MIN_AVG_TURN_SECONDS,
        "min_confirmed_meetings": ss.SUGGESTION_MIN_CONFIRMED_MEETINGS,
        "same_meeting_merge_distance": ss.SAME_MEETING_MERGE_DISTANCE_THRESHOLD,
        "cross_channel_echo_distance": tr.CROSS_CHANNEL_ECHO_MAX_DISTANCE,
        "cross_channel_echo_overlap": tr.CROSS_CHANNEL_ECHO_MIN_OVERLAP,
        "cross_channel_strong_echo_distance": tr.CROSS_CHANNEL_ECHO_STRONG_MAX_DISTANCE,
        "cross_channel_strong_echo_overlap": tr.CROSS_CHANNEL_ECHO_STRONG_MIN_OVERLAP,
        "per_segment_echo_coverage": tr.PER_SEGMENT_ECHO_COVERAGE,
    }


def _pairwise(clusters_a: dict, labels_a: dict, clusters_b: dict, labels_b: dict, same: bool) -> list:
    from src.voiceprint import cosine_distance
    pairs = []
    ids_a, ids_b = list(clusters_a), list(clusters_b)
    for i, a in enumerate(ids_a):
        for j, b in enumerate(ids_b):
            if same and j <= i:
                continue
            try:
                distance = cosine_distance(clusters_a[a][0], clusters_b[b][0])
            except (TypeError, ValueError):
                continue
            pairs.append({"a": labels_a[a], "b": labels_b[b], "distance": _round(distance)})
    return sorted(pairs, key=lambda p: (p["distance"] is None, p["distance"]))


def _held_by_someone(profiles: list, meeting_stem: str, channel: str, recording_type, fragment_ids: set, run_id) -> bool:
    return any(
        p.get("meeting_id") == meeting_stem
        and p.get("diarization_speaker_id") in fragment_ids
        and ss.prototype_channel_matches(p, channel, recording_type)
        and ss.prototype_run_matches(p, run_id)
        for person in profiles or []
        for p in (person.get("prototypes") or [])
    )


def build_debug_report(
    output_dir: Path,
    meeting_stem: str,
    *,
    profiles: list,
    settings: dict,
) -> dict:
    """The report for one meeting. ``settings`` are the content-free engine
    choices the caller reads from config."""
    sidecar = ss.read_speakers_sidecar(output_dir, meeting_stem)
    try:
        pipeline = json.loads(pipeline_stats_path(output_dir, meeting_stem).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pipeline = None

    speakers: Optional[dict] = None
    if isinstance(sidecar, dict):
        run_id = (sidecar.get("diarization_run") or {}).get("run_id")
        merged, labels = {}, {}
        for channel, data in (sidecar.get("channels") or {}).items():
            merged[channel], _ = ss.merge_same_channel_fragments(
                ss.clusters_from_sidecar_channel(meeting_stem, data),
            )
            labels[channel] = {sid: f"C{i + 1}" for i, sid in enumerate(sorted(merged[channel]))}
        # Scored without this meeting's own confirmations, as speaker feedback
        # does, so the report shows what the model would say on its own.
        from src.speaker_feedback import _blocked_gates, _without_meeting_evidence
        model_profiles = _without_meeting_evidence(profiles, meeting_stem)
        results = ss.suggest_speakers_for_meeting(merged, model_profiles)

        channels_out = {}
        for channel, clusters in merged.items():
            data = (sidecar.get("channels") or {}).get(channel) or {}
            rows = []
            for sid in sorted(clusters):
                embedding, context = clusters[sid]
                result = results[channel][sid]
                candidates = ss.score_candidates(embedding, context, model_profiles)
                best = candidates[0] if candidates else None
                runner = candidates[1] if len(candidates) > 1 else None
                rows.append({
                    "cluster": labels[channel][sid],
                    "speech_seconds": _round(context.speech_duration_seconds, 1),
                    "segment_count": context.segment_count,
                    "avg_turn_seconds": _round(
                        context.speech_duration_seconds / context.segment_count
                        if context.segment_count else None, 2,
                    ),
                    "merged_fragments": len(context.merged_from),
                    "marked_multiple_speakers": bool(context.contains_multiple_speakers),
                    "kept_generic": context.review_state == ss.REVIEW_STATE_GENERIC,
                    "named": _held_by_someone(
                        profiles, meeting_stem, channel, data.get("recording_type"),
                        {sid, *context.merged_from}, run_id,
                    ),
                    "suggestion_status": result.status,
                    "best_distance": _round(best.distance) if best else None,
                    "runner_up_margin": _round(runner.distance - best.distance) if best and runner else None,
                    "best_confirmed_meetings": best.confirmed_meeting_count if best else None,
                    "blocked_by": _blocked_gates(candidates, context),
                })
            channels_out[channel] = {
                "recording_type": data.get("recording_type"),
                "clusters": rows,
                "distances": _pairwise(clusters, labels[channel], clusters, labels[channel], same=True),
            }
        cross = (
            _pairwise(merged["mic"], labels["mic"], merged["system"], labels["system"], same=False)
            if "mic" in merged and "system" in merged else []
        )
        speakers = {
            "channels": channels_out,
            "cross_channel_distances": cross,
            "minimum_speaker_count": ss.minimum_speaker_count(sidecar.get("channels") or {}),
            "known_people": len([p for p in model_profiles if p.get("prototypes")]),
        }

    return {
        "schema_version": REPORT_SCHEMA_VERSION,
        "settings": settings,
        "thresholds": _thresholds(),
        "pipeline": pipeline,
        "speakers": speakers,
    }
