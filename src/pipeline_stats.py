"""Content-free statistics about one processed meeting.

process-streaming prints these as a ``PIPELINE_STATS:`` line so the Electron
shell can send a ``pipeline_completed`` analytics event for users who opted
in. Only counts, flags and engine names leave this function: no text, no
labels, no speaker ids, no file names. The shell buckets the numbers again
before anything is sent (``pipelineCompletedProperties`` in
app/analytics-helpers.js), so this is the first of two filters, not the only
one.
"""

from typing import Optional


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
    }
