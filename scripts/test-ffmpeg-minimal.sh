#!/bin/bash
# Check a minimal ffmpeg (scripts/build-ffmpeg-minimal.sh) against what the app
# asks of it: decode every import format the app accepts, run the filters the
# pipeline uses, write wav/caf, and fail cleanly (no hang) on a truncated file.
#
# Fixtures come from a full ffmpeg (FIXTURE_FFMPEG, or one on PATH that is not
# the binary under test) for mp3/ogg/webm/flac/mp4; afconvert covers the Apple
# formats. Formats nothing here can generate are reported as skipped, never
# counted as passing.
#
# Usage: scripts/test-ffmpeg-minimal.sh [path/to/ffmpeg]   (default: bin/ffmpeg)

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FFMPEG="${1:-$ROOT_DIR/bin/ffmpeg}"
FFMPEG="$(cd "$(dirname "$FFMPEG")" && pwd)/$(basename "$FFMPEG")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0; skipped=()
ok() { echo "  ok    $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL  $1"; fail=$((fail + 1)); }

# Run with a deadline so a decoder hang fails the check instead of the shell.
run() { perl -e 'alarm shift; exec @ARGV' 30 "$@" >/dev/null 2>&1; }

GEN="${FIXTURE_FFMPEG:-}"
if [ -z "$GEN" ]; then
  for candidate in $(which -a ffmpeg 2>/dev/null); do
    if [ "$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")" != "$FFMPEG" ] \
       && "$candidate" -hide_banner -encoders 2>/dev/null | grep -q libmp3lame; then
      GEN="$candidate"; break
    fi
  done
fi

echo "Testing $("$FFMPEG" -hide_banner -version | head -1)"
SRC="$WORK/src.wav"
# Two channels with different tones, like a mic + system recording.
if [ -n "$GEN" ]; then
  "$GEN" -nostdin -y -hide_banner -loglevel error -f lavfi -i "sine=frequency=440:duration=3" \
    -f lavfi -i "sine=frequency=660:duration=3" -filter_complex amerge=inputs=2 -ar 48000 "$SRC"
else
  say -o "$WORK/say.aiff" "Steno ffmpeg check" && afconvert -f WAVE -d LEI16@48000 -c 2 "$WORK/say.aiff" "$SRC"
fi

make_fixture() {  # ext -> path or empty
  local ext="$1" out="$WORK/in.$1"
  case "$ext" in
    wav) cp "$SRC" "$out" ;;
    aiff|aif) afconvert -f AIFF -d BEI16 "$SRC" "$out" ;;
    caf) afconvert -f caff -d LEI16 "$SRC" "$out" ;;
    m4a) afconvert -f m4af -d aac "$SRC" "$out" ;;
    aac) afconvert -f adts -d aac "$SRC" "$out" ;;
    mp3) [ -n "$GEN" ] && "$GEN" -nostdin -y -hide_banner -loglevel error -i "$SRC" -c:a libmp3lame "$out" ;;
    # Vorbis when the generator has it, else Opus: both are Ogg payloads the app accepts.
    ogg) [ -n "$GEN" ] && { "$GEN" -nostdin -y -hide_banner -loglevel error -i "$SRC" -c:a libvorbis "$out" 2>/dev/null \
           || "$GEN" -nostdin -y -hide_banner -loglevel error -i "$SRC" -c:a libopus "$out"; } ;;
    webm) [ -n "$GEN" ] && "$GEN" -nostdin -y -hide_banner -loglevel error -i "$SRC" -c:a libopus "$out" ;;
    flac) [ -n "$GEN" ] && "$GEN" -nostdin -y -hide_banner -loglevel error -i "$SRC" -c:a flac "$out" ;;
    mp4|mov) [ -n "$GEN" ] && "$GEN" -nostdin -y -hide_banner -loglevel error -i "$SRC" -c:a aac "$out" ;;
  esac
  [ -s "$out" ] && echo "$out"
}

echo "Decode each import format to 16 kHz mono wav:"
for ext in wav mp3 m4a aac webm aiff aif flac ogg caf mp4 mov; do
  in="$(make_fixture "$ext" 2>/dev/null)"
  if [ -z "$in" ]; then skipped+=("$ext"); continue; fi
  if run "$FFMPEG" -nostdin -hide_banner -y -i "$in" -ac 1 -ar 16000 -f wav "$WORK/out-$ext.wav" \
     && [ -s "$WORK/out-$ext.wav" ]; then ok "$ext"; else bad "$ext"; fi
done

echo "Pipeline filters and outputs:"
run "$FFMPEG" -nostdin -hide_banner -y -i "$SRC" -af "pan=mono|c0=c1" "$WORK/pan.wav" && ok "pan channel split" || bad "pan channel split"
run "$FFMPEG" -nostdin -hide_banner -y -i "$SRC" -af "highpass=f=80,loudnorm" -ar 16000 "$WORK/norm.wav" && ok "highpass + loudnorm" || bad "highpass + loudnorm"
run "$FFMPEG" -nostdin -hide_banner -y -i "$SRC" -af "volume=2,atrim=0:1,asetpts=PTS-STARTPTS" "$WORK/trim.wav" && ok "volume + atrim" || bad "volume + atrim"
run "$FFMPEG" -nostdin -hide_banner -y -i "$SRC" -c:a pcm_s16le "$WORK/out.caf" && ok "caf output" || bad "caf output"
run "$FFMPEG" -nostdin -hide_banner -y -i "$SRC" -f f32le -ac 1 -ar 16000 "$WORK/out.raw" && ok "raw f32le output" || bad "raw f32le output"
run "$FFMPEG" -nostdin -hide_banner -y -i "$SRC" -f null - && ok "null muxer" || bad "null muxer"

echo "Truncated input fails or recovers within the deadline:"
for ext in m4a wav mp3; do
  in="$(make_fixture "$ext" 2>/dev/null)" || true
  if [ -z "$in" ]; then skipped+=("truncated-$ext"); continue; fi
  head -c 1500 "$in" > "$WORK/cut.$ext"
  perl -e 'alarm shift; exec @ARGV' 30 "$FFMPEG" -nostdin -hide_banner -y -i "$WORK/cut.$ext" -f wav "$WORK/cut-$ext.wav" >/dev/null 2>&1
  status=$?
  # 142 = killed by the alarm: a hang. Any other exit (error or partial decode) is acceptable.
  if [ "$status" -ne 142 ]; then ok "truncated $ext (exit $status)"; else bad "truncated $ext hung"; fi
done

echo "Networking stays disabled:"
if "$FFMPEG" -hide_banner -protocols 2>/dev/null | grep -qE '^\s+(http|https|tcp|udp|rtmp)$'; then
  bad "network protocol compiled in"
else
  ok "only file/pipe protocols"
fi

echo
[ ${#skipped[@]} -gt 0 ] && echo "Skipped (no fixture generator): ${skipped[*]}"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
