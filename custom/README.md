# Custom StenoAI build

This fork extends an official StenoAI release. For a fresh clone, follow
[the colleague quickstart](COLLEAGUE_QUICKSTART.md). It is built locally and replaces `/Applications/StenoAI.app`.
Notes, settings and speaker profiles (`~/Library/Application Support/stenoai`)
are shared with the official app, so switching back and forth is safe.

## Changes on top of the official release

| Change | Files | Upstream? |
|---|---|---|
| OpenAI transcription: chunk overlap is resolved by time ownership instead of failing the whole transcript ("not globally monotone") | `src/transcriber.py`, tests | candidate PR |
| OpenAI transcription: `*-diarize` models are asked for `diarized_json` (with `chunking_strategy=auto`), giving timestamps so the local diarizer can label speakers | `src/transcriber.py`, tests | candidate PR |
| OpenAI transcription: three-minute overlapping parts, six requests shared across both channels, chronological assembly, per-part progress and durable re-transcription checkpoints | `src/openai_asr_jobs.py`, `src/transcriber.py`, `app/main.js`, `MeetingDetail.tsx` | candidate PR |
| Processing feedback: distinct preparation/transcription/speaker/summary stages, restored from a serializable queue snapshot on opening a note | `app/main.js`, `MeetingDetail.tsx`, backend progress events | candidate PR |
| Cloud recommendation: gpt-transcribe JSON with local acoustic speaker turns, parallel per-turn ASR and exact audio-turn timestamps | `src/cloud_speaker_transcription.py`, `src/transcriber.py`, tests | custom only |
| Complete transcript + available summary/My notes exported to Obsidian, with versioned speaker suggestions/confirmations, exact turn references and calendar invitees; later profile/review/calendar edits refresh archived exports while preserving vault annotations | `custom/obsidian_sync.py`, `custom/OBSIDIAN_SYNC.md`, tests | custom only |
| Settings: model suggestions + hint for cloud transcription | `app/renderer/src/routes/settings/AiTab.tsx`, `en.json` | candidate PR |
| Speakers panel appears without leaving the note after processing | `app/renderer/src/hooks/useSpeakerSuggestions.ts`, `SpeakerReviewPanel.tsx`, `useRecording.ts` | candidate PR |
| Auto-update off (it would install the stock app over this one) | `app/main.js` (`IS_CUSTOM_BUILD`) | custom only |
| Calendar invitees as speaker-name shortcuts; invited known people first; confirmed invitee emails on People, stored locally by person ID | `SpeakerReviewPanel.tsx`, `person-contacts.js`, `speaker-ipc.js`, `PeopleTab.tsx` | custom only |
| Stop while processing reports "Processing stopped", not a failure | `app/main.js`, `noteGenerationError.ts`, `MeetingDetail.tsx` | candidate PR |
| Per-meeting language (recording screen, Re-transcribe dialog) via `STENOAI_LANGUAGE_OVERRIDE`; Settings stays the default | `app/note-language.js`, `src/config.py`, `MeetingLanguageSelect.tsx` | candidate PR |
| Action items written as Markdown tasks (`- [ ]`) | `simple_recorder.py` (`_action_items_as_tasks`) | candidate PR |
| Optional recordings storage limit; oldest audio deleted first after each job and at startup | `app/audio-storage.js`, `AiTab.tsx` | candidate PR |
| Vault sync status line per note (reads `~/.config/stenoai-sync/state.json`) | `app/vault-sync-status.js`, `VaultSyncStatusLine.tsx`, `custom/obsidian_sync.py` | custom only |
| Auto-stop for any recording paired with a call app; ignores mic use under 60 s; 30 s grace with Keep recording | `app/main.js` (auto-detect section) | candidate PR |
| Cloud ASR channels use an in-process level match instead of ffmpeg loudnorm (49 s → <1 s per channel) | `src/transcriber.py` (`_fast_level_normalize`) | candidate PR |
| Watched recording folders (Settings → Integrations) and a Recordings inbox, shown only once a folder is set: pick files to transcribe, or auto-transcribe new ones once they finish syncing; source files are never changed and meetings are dated by recording time | `app/watched-folders.js`, `watched-folders-ipc.js`, `Recordings.tsx`, `WatchedFoldersSection.tsx`, `simple_recorder.py` (`STENOAI_RECORDED_AT`), tests | candidate PR |
| This folder: build / install / update scripts | `custom/` | custom only |

Summary models were already flexible: Settings → AI lists the provider's models
plus "Custom…".

## Long re-transcriptions

For the older provider-timed cloud models, the Electron app selects 180-second
parts with five seconds of overlap and a maximum of six concurrent requests
across microphone and system audio. The recommended gpt-transcribe route uses
acoustic-turn windows instead (described below).
It retains the selected model and the existing timestamp/overlap validation.
An empty chunk response with signal is retried once with the preceding audio
window (the following window for the first part). The retry retains strict
validation and must contain timestamped speech; only timestamps in the original
part are retained. This handles noise-only tails and boundary context without
weakening the whole-file empty-response checks.
Standalone backend callers retain the previous defaults unless they set
`STENOAI_OAI_PARALLELISM` (1–6) and `STENOAI_OAI_CHUNK_SECONDS`.

Re-transcription saves each completed response atomically in a private local
`asr-checkpoints/<opaque-note-id>/` directory under the app's user data. Repeating
Re-transcribe after Stop, a crash or network failure reuses matching completed
parts; it still decodes/normalizes the recording and repeats unfinished requests.
Reuse requires identical audio bytes, endpoint, model and language. Corrupt or
older-than-seven-day records are ignored. Old records are pruned when an ASR job
starts, and successful final note generation clears that job's records. These
records contain transcript text; they contain no API keys or audio copies.

The original note and speaker sidecar survive transcription/summary failure.
The final note and sidecar are separate writes, so there is no cross-file crash
transaction. Recovery is initiated by Re-transcribe; automatic restart and
transcription during capture are not implemented.

`logs/processing.log` now includes reprocessing as well as recording jobs, with
per-request upload and response-wait timings. Requests retain finite deadlines
and bounded retries; numeric Retry-After is honored within the retry limits.

The approved 41m59.6s real-meeting test completed a fresh full re-transcription
in **8m48.8s**, with the same gpt-4o-transcribe-diarize model and no checkpoint
hits. Real-meeting recovery reused 29 completed parts and finished in 3m34.3s.
These are individual benchmark runs, not accuracy guarantees.

## Model comparison and developer benchmarks

On the same 41m59.6s Dutch meeting, Parakeet completed preparation, ASR and local
speaker analysis in **5m23.6s**; the successful 4o diarize run took **8m38.3s**
for those stages, plus 10.5s summary/save. Whisper-1 requests were quicker than
4o diarize, but sparse-channel hallucinations and a failed full-run timestamp
validation make it unsuitable as a drop-in default in this client. The newer recommended cloud option is `gpt-transcribe`; Parakeet is the
recommended local option. The cloud setting uses local acoustic speaker analysis
first, then transcribes each speaker turn through OpenAI with up to six requests
shared across channels. Audio is partitioned without gaps or overlaps; uncovered
acoustic regions are retained as generic speaker windows. Digital silence is
skipped only outside detected speech; an empty result for detected speech is independently checked with
gpt-4o-transcribe-diarize on the same audio turn. Recovered words retain their
original owner; only two empty results count as nonlexical audio. API errors
still fail safely. Subsecond turns receive silence padding, never neighbouring
speech, and keep their original displayed bounds. Speaker analysis runs once per channel and
its models are serialized to limit memory use.

The provider returns untimed JSON. Displayed times are the real start/end of the
uploaded acoustic turn, not word alignment. Manual speaker confirmation uses the
same stable speaker manifest as the other engines. This avoids loading Parakeet
for cloud ASR, although the existing local speaker model still consumes resources.
If speaker analysis is unavailable, the app retains the existing channel-only,
untimed transcription fallback without inventing identities.

The final language-context build completed a fresh **41m59.6s** meeting in
**3m40.3s**, including preparation and local speaker analysis, excluding summary.
Both channels detected Dutch from substantial turns, then used it as a hint for
short requests. The seed request is reused; an explicit language setting wins.
Output had 49,234 characters and 364 retained chronological turns (322 with native
speaker provenance), coverage 1.0. Of 775 requests, 27 were independent checks:
17 recovered text and 10 were empty from both models. Median response wait 0.58s,
mean 0.66s; uploads averaged 0.04s. The same recording's earlier Parakeet run took
5m23.6s and 4o diarize 8m38.3s before summary. These are individual runs on one
meeting, not a word-error-rate evaluation. Some clipped tiny words remain wrong.

The user cloud model is saved as gpt-transcribe; final build is installed and
running. The three-minute two-channel ASR-only auto tests took 7.84/6.28s; a
Dutch-hint sample took 4.46s. GPT Live and uploads during recording remain absent:
speaker continuity, durable buffering and reconnect recovery need additional
work. The new cloud workflow starts after Stop.

The standalone Obsidian sync is documented in `OBSIDIAN_SYNC.md`. It exports a
completed transcript independently of summary availability, prefers canonical
TXT, follows configured archives by meeting ID and preserves vault edits. Manual
speaker confirmations refresh the transcript and Participants. AI summary prose
is kept as generated; Generate notes regenerates it explicitly.

The custom build accepts an explicit developer CLI flag
`--transcription-benchmark-plan=/absolute/plan.json`. The plan points to
allowlisted model jobs in the same directory, each using isolated user data.
This runs the packaged backend without creating notes or writing to the vault;
cloud jobs use the existing main-process credential loader. Logs/results are
private local benchmark files. No benchmark UI or renderer credential access
is exposed. `src/asr_benchmark.py` defines the job/result format.

Colleagues build and sign locally using `custom/bootstrap.sh`; no distributed
DMG is required. Keep credentials, recordings and private working notes out of Git.

## Build and install

```bash
custom/setup-signing.sh # once, after approving login-keychain changes
custom/build.sh        # backend (PyInstaller) + Electron app, certificate-signed
custom/package.sh      # fast path for JS/TS-only changes; reuses the backend
custom/install.sh      # quits StenoAI, keeps the old app, installs, relaunches
```

`build.sh` reuses the native helpers (steno-diarize, steno-audio-encode,
mic-monitor, Ollama, ffmpeg) from the pristine official app in
`.local/official/` inside this checkout. `bootstrap.sh` downloads and verifies
that pinned release when absent. Xcode Command Line Tools compile the Calendar
helper. Python 3.11 is found on PATH (`PYTHON311` overrides it).

Local builds use **StenoAI Local Signing**, a self-signed certificate created
in the login keychain. Setup grants it user-level trust for code signing only
and allows `/usr/bin/codesign` to use its private key. It does not edit API-key
items, SSL trust, or the system keychain. Temporary certificate/private-key
files are removed on exit. Keep the keychain identity: regenerating it changes
the app's identity. Setup refuses to replace an existing certificate.

Both build paths share `package.sh`, retain hardened runtime and the existing
entitlements, disable notarization and network timestamps, and fail if signing
is unavailable. The package step verifies the signature, runtime flag and a
certificate-based designated requirement (rather than a build-specific hash).
`STENOAI_SIGNING_IDENTITY` can select another certificate by name.

## New official release

```bash
custom/update.sh       # or: custom/update.sh v0.8.1
custom/install.sh
```

`update.sh` downloads and verifies the official DMG (Steno Labs signature +
notarization), rebases this branch from `custom/BASE` onto the new tag, refreshes
`custom/constraints.txt` from the new bundle, and builds. On a rebase conflict it
stops and says what to do.

## After installing a new build

The first switch from ad-hoc signing to the local certificate changes app
identity once. Allow **Microphone** and **Screen & System Audio Recording** in
System Settings → Privacy & Security, and reconnect **Apple Calendar** in
StenoAI → Settings → General. For **StenoAI Safe Storage** (encrypted API keys),
choose *Always Allow* if prompted. macOS may also ask to allow `codesign` to use
the new signing key during the first build.

Later builds signed with the same certificate should retain their permissions;
verify this over two installed builds before relying on it. A valid signature
alone does not prove TCC permission persistence. The local certificate is for
this Mac; these builds are not notarized for distribution.

## Roll back

```bash
ditto ~/Documents/StenoAI/.local/official/StenoAI.app /Applications/StenoAI.app   # official 0.8.0
ditto ~/Documents/StenoAI/.local/previous/StenoAI.app /Applications/StenoAI.app   # previous build
```
