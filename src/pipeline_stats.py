"""Content-free statistics about one processed meeting.

process-streaming prints these as a ``PIPELINE_STATS:`` line so the Electron
shell can send a ``pipeline_completed`` analytics event for users who opted
in. Only counts, flags and engine names leave this function: no text, no
labels, no speaker ids, no file names. The shell buckets the numbers again
before anything is sent (``pipelineCompletedProperties`` in
app/analytics-helpers.js), so this is the first of two filters, not the only
one.
"""

from pathlib import Path
from typing import Optional


def pipeline_stats_path(output_dir: Path, meeting_stem: str) -> Path:
    """Where one meeting's stats are kept for its debug report."""
    return output_dir / f"{meeting_stem}_pipeline.json"


def _speakers_per_channel(turn_manifest: list) -> dict:
    """Distinct diarized speakers per channel, counted from the manifest.

    The manifest carries one entry per transcript turn with its channel and
    the diarizer's raw speaker id. A turn without an id (channel-labelled
    fallback) counts as no diarized speaker.
    """
    seen: dict = {"mic": set(), "system": set()}
    for entry in turn_manifest or []:
        if not isinstance(entry, dict):
            continue
        channel = entry.get("channel")
        speaker = entry.get("diarization_speaker_id")
        if channel in seen and speaker is not None:
            seen[channel].add(speaker)
    return {channel: len(ids) for channel, ids in seen.items()}


def _number(value) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _count(value) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _diagnostics(raw) -> dict:
    """Copy the transcriber's bleed and merge counts, numbers only.

    Missing entirely on paths that do no channel work (mono, live
    fallback); every field then reads as zero or None.
    """
    raw = raw if isinstance(raw, dict) else {}
    nearest = raw.get("cross_channel_nearest_unmerged")
    nearest = nearest if isinstance(nearest, dict) else {}
    merges = [
        {"tier": m.get("tier"), "distance": _number(m.get("distance")),
         "overlap": _number(m.get("overlap"))}
        for m in (raw.get("cross_channel_merges") or [])
        if isinstance(m, dict) and m.get("tier") in ("fragment", "echo", "strong_echo")
    ]

    def _per_channel(key):
        counts = raw.get(key) if isinstance(raw.get(key), dict) else {}
        return {"mic": _count(counts.get("mic")), "system": _count(counts.get("system"))}

    return {
        "mic_segments": _count(raw.get("mic_segments")),
        "mic_segments_dropped_as_echo": _count(raw.get("mic_segments_dropped_as_echo")),
        "channel_bleed_collapsed": raw.get("channel_bleed_collapsed") is True,
        "clusters_raw": _per_channel("clusters_raw"),
        "clusters_after_fold": _per_channel("clusters_after_fold"),
        "cross_channel_pairs": _count(raw.get("cross_channel_pairs")),
        "cross_channel_merges": merges,
        "cross_channel_nearest_unmerged": (
            {"distance": _number(nearest.get("distance")), "overlap": _number(nearest.get("overlap"))}
            if nearest else None
        ),
        "cross_channel_skipped_erase_split": raw.get("cross_channel_skipped_erase_split") is True,
        "echo_turns_dropped": _count(raw.get("echo_turns_dropped")),
    }


def pipeline_stats(
    transcript_data: dict,
    *,
    source: str,
    diarization_engine: Optional[str],
    speaker_identification: bool,
) -> dict:
    """Summarise a finished transcription without any of its content."""
    manifest = transcript_data.get("turn_manifest") or []
    counts = _speakers_per_channel(manifest)
    channels = {
        entry.get("channel")
        for entry in manifest
        if isinstance(entry, dict)
    }
    diagnostics = _diagnostics(transcript_data.get("pipeline_diagnostics"))
    coverage = transcript_data.get("window_coverage")
    duration = transcript_data.get("duration_seconds")
    return {
        "source": source if source in ("live", "batch") else "unknown",
        "diarised": bool(transcript_data.get("is_diarised")),
        "dual_channel": "system" in channels,
        "mic_speakers": counts["mic"],
        "system_speakers": counts["system"],
        "window_coverage": coverage if isinstance(coverage, (int, float)) else None,
        "duration_seconds": duration if isinstance(duration, (int, float)) else None,
        "diarization_engine": diarization_engine,
        "speaker_identification": bool(speaker_identification),
        **diagnostics,
    }
