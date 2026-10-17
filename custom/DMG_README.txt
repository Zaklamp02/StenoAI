StenoAI test release
====================

A personal fork of StenoAI by Steno Labs (https://github.com/stenolabs/stenoai),
shared under the original MIT license (LICENSE.txt). Not affiliated with or
endorsed by Steno Labs. Requires an Apple Silicon Mac with macOS 14.4 or later.

Install
-------
1. Drag StenoAI onto the Applications folder.
2. Open StenoAI from Applications. macOS says it cannot verify the app:
   click Done.
3. Open System Settings > Privacy & Security, scroll down to
   "StenoAI was blocked", click Open Anyway and confirm.
   (Or, in Terminal: xattr -dr com.apple.quarantine /Applications/StenoAI.app)
4. Allow Microphone and, for online calls, Screen & System Audio Recording.

Why the warning: the app is signed by the fork's maintainer but not notarized
by Apple, because the fork has no Apple Developer ID yet. Each release uses the
same signature, so macOS keeps your permissions when you install an update.

Good to know
------------
- Cloud transcription uploads meeting audio to the provider you configure,
  with your own API key. Local engines keep audio on this Mac.
- Usage analytics is off by default.
- Updates are manual: install the next DMG over this one.
- Bundled helpers (Ollama, ffmpeg, the speaker-analysis helper) are taken
  unchanged from the official StenoAI release; see its repository for their
  licenses.

Feedback: https://github.com/Zaklamp02/StenoAI/issues
Include the build identifier from Settings > About, and use Settings >
Developer's redacted diagnostics rather than raw logs.
