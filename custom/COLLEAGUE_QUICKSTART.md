# Build and test on an Apple Silicon Mac

This fork is for a small testing pilot. It supports Apple Silicon and macOS
14.4 or later. Keep the upstream MIT license and credits when sharing it.
Most testers can download the app; build from source only if you want to debug
or change the code.

## Download the app

1. Download `StenoAI-test-2026-11-06-arm64.dmg` from the
   [test-2026-11-06 release](https://github.com/Zaklamp02/StenoAI/releases/tag/test-2026-11-06).
   Optionally check it: `shasum -a 256 StenoAI-test-2026-11-06-arm64.dmg` must match
   the `.sha256` file on the release page.
2. Open the DMG and drag StenoAI onto Applications.
3. Open StenoAI. macOS says it cannot verify the app: click **Done**. Then go to
   **System Settings → Privacy & Security**, find "StenoAI was blocked" and click
   **Open Anyway**. Alternatively run
   `xattr -dr com.apple.quarantine /Applications/StenoAI.app` in Terminal.

The warning appears because the app is signed by this fork's maintainer but not
notarized by Apple (no Apple Developer ID yet). Every release uses the same
signature, so macOS keeps your permissions across updates. Managed work Macs may
block apps that are not notarized; build from source or ask IT in that case.
Then continue with **First run** below.

Upgrading from an earlier test build: quit StenoAI and replace the app; your
notes, settings and permissions stay. If you use a custom OpenAI-compatible URL
for notes, enter its API key once more in Settings → AI (keys are now tied to
the address they were entered for). A remote Ollama server on another machine
now needs an `https://` address.

Maintainers create the DMG with `custom/release.sh <tag>`, which builds the tag
from a clean checkout, refuses to package anything containing the builder's
username, and writes the DMG and checksum to `.local/release/` for upload to
the GitHub Release (never commit them).

## Build from source

Install Git, Xcode Command Line Tools (`xcode-select --install`), Python **3.11**
and Node **24 LTS** (minimum 22.12). With Homebrew, `brew install python@3.11 node@24`
installs the runtimes; add `$(brew --prefix node@24)/bin` to your PATH. With nvm,
run `nvm install` in this repository. Confirm `node --version` and `python3.11 --version`.

```sh
git clone https://github.com/Zaklamp02/StenoAI.git
cd StenoAI
git checkout test-2026-11-06   # the current colleague test release
custom/setup-signing.sh
custom/bootstrap.sh
custom/install.sh
```

Signing setup creates a per-Mac certificate in your login keychain and grants
code-signing trust. Keep that identity for subsequent builds. Never share its
private key. The bootstrap checks prerequisites, downloads the upstream version
pinned in `custom/BASE`, verifies its Steno Labs signature/notarization, stages
its native helpers, installs locked npm packages, builds the Python backend and
Calendar helper, and produces `app/dist/mac-arm64/StenoAI.app`. Installing is a
separate step; it keeps no copy of the app it replaces. If Python is not on PATH, pass
`PYTHON311=/absolute/path/to/python3.11 custom/bootstrap.sh`.

Allow several GB of free space for build dependencies, the upstream helper
bundle and model caches. The onboarding wizard shows download progress; local
ASR/summary models require additional downloads that vary with the chosen model.
Ollama and ffmpeg are bundled; do not install or start a second Ollama just for setup.

## First run

- Allow Microphone. For online calls also allow Screen & System Audio Recording
  in macOS Privacy & Security and play the call through this Mac.
- Choose local or cloud transcription/summary providers deliberately. Local
  processing stays on this Mac. Cloud ASR uploads audio; cloud notes/chat sends
  the relevant transcript text to your configured provider.
- The first launch asks whether to share anonymous usage data (see **Where your
  data goes**). Either answer is fine and can be changed in Settings → Advanced.
- macOS may request Keychain access when you first save or use cloud/Calendar
  credentials in your locally signed build. Complete that system prompt to
  enable encrypted credential storage; keep the same signing identity on updates.
- Enable **Save recordings** (Settings → Preferences → Recording) if you want listening checks, language retries or
  later speaker analysis. Unfinished/failed audio is protected even when this is off.
- Download the optional **Separate voices** model (Settings → AI → Speakers) for
  multiple voices around one microphone. Name suggestions need **Recognise people**.
  Suggestions stay unconfirmed until you approve them.
- Connect Apple Calendar if useful. Clicking a meeting shows details. Only
  **Join & take notes** / **Take notes** starts recording; **Join** only opens the call.
- For Obsidian, select your vault root in Settings → Integrations and enable sync.
  Full transcripts, notes, speaker evidence and invitees export together. Sync
  checks run while StenoAI is open; **Sync now** retries immediately. Existing
  standalone settings/state are reused when the same vault is selected. Both
  triggers share the export lock. Existing native exports are adopted at their
  current paths when their file identity matches; edited content is preserved.
  Source deletion retains the exported archive.

## Where your data goes

| What | Where it goes |
| --- | --- |
| Audio, transcripts, notes, speaker profiles | Stay on this Mac (`~/Library/Application Support/stenoai`) unless one of the rows below sends them. |
| Audio | To your cloud transcription provider, only if you chose cloud transcription. |
| Transcript text (and meeting context) | To your cloud notes/chat provider, only if you chose one. Local Ollama keeps it on this Mac. |
| Notes and transcripts | To your Obsidian vault, only if you turned on sync. To your organisation, only if you signed in to one and **Share new notes with your organisation** is on (off unless the organisation sets it on). |
| Calendar events | Read from the calendar you connected; used locally for titles, invitees and speaker names. |
| Usage analytics | Only if you said yes: anonymous counts and rounded numbers (features used, processing times, speaker counts, how close speaker suggestions were) to this fork's PostHog project in the EU. Never audio, text, titles, names, emails or calendar details. |
| Debug report | Only when you choose **Send debug report…** on a note, after it shows you the full report. Numbers only. |
| Diagnostics export (Settings → Developer) | Saved as a file for you to review and share yourself; keys and tokens are blanked. |

Remote servers must use `https://`; plain `http://` is only accepted for this Mac.
Organisation sign-in is not part of this pilot.

## Updates and security fixes

The app does not update itself (an automatic update would install the official
app over this fork). The fork's maintainer is responsible for security updates:
a fixed build is published as a new release with a note on what changed. Install
it the same way as the first one; your notes and settings stay. If you build from
source, check out the new tag and run `custom/bootstrap.sh` and
`custom/install.sh` again. After an update that changes where a cloud API key may
be sent, Settings → AI asks for the key once more.

## Test and report

Try a short in-person meeting with three voices and an online call. Confirm the
language, approve a speaker, retry transcription with an explicit language, and
check Obsidian's confirmed/unconfirmed labels. Refresh or relink an invitation
from the meeting's Calendar section. Unfinished recordings offer **Recover** on
restart; recovery uses the selected provider and can upload audio if cloud ASR
is enabled. **Dismiss** keeps the protected audio file.

Report feedback to this fork's maintainer/issues, including the build identifier
from About. Use Settings → Developer's redacted diagnostics and review the export
before sharing; raw terminal and processing logs can contain private data.

## Subsequent builds and checks

```sh
custom/bootstrap.sh       # full rebuild with locked dependencies
custom/package.sh         # renderer/main-only edits, existing backend
custom/install.sh
```

From `app/`, `npm run test:unit` runs both main and renderer suites even if one
fails. Also run `npm run typecheck:renderer`, `npm run lint:main`,
`npm run lint:i18n`, `npm run i18n:inventory`, and the relevant Playwright specs.
Python checks are `.venv/bin/python -m unittest discover tests` and
`.venv/bin/python scripts/ruff_ratchet.py`. App/backend tests must use temporary
`STENOAI_USER_DATA_DIR`; never point tests at real recordings. Some upstream
integration specs stop Ollama globally; run those only in a dedicated test environment.

Build artifacts, recordings, credentials, private handovers and local signing
material are ignored. Commit the source changes on the sanitized testing branch;
do not merge the old personal working history or push all local branches/stashes.
The branch can be reviewed with `git diff` and `git status` before staging.

See [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md) for the reviewed upstream build-tool advisories.
