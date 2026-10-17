# StenoAI → Obsidian

The local sync exports a linked meeting-note/transcript pair. It reads the full
canonical `<stem>_transcript.txt`, with the embedded Markdown transcript as a
legacy fallback. It never exports recordings, voice embeddings or credentials.

A completed batch transcript is exported even when summary generation is off or
fails. The meeting note includes the available AI summary and My notes; My notes
never appear in the transcript file. Processing placeholders, failed
transcriptions and rescued live-preview-only results are held back.
`summary_available` and `summary_stale` record the state of the available summary.

Speaker confirmations update the canonical transcript and Participants section
in StenoAI, then the exports refresh. AI summary prose is retained as generated;
use Generate notes when a newly speaker-aware summary is wanted. The sync never
sends content to a model or invents a replacement summary.

Exports use `steno_id` to follow files into the configured archive folders, even
when their filenames change. Subsequent title changes update metadata while
filenames stay stable, protecting existing links. Removed files are not recreated
unless `--force` is explicitly requested.

Generated content is between `stenoai:generated` Markdown comments. Vault-only
notes outside that section remain untouched. Edits inside the section are merged
against the previous generated version when they do not overlap source changes.
If changes overlap, the latest source goes first and the edited version is kept
below under **Preserved vault edits**. On first upgrading an already edited legacy
export, its existing content is retained under **Preserved vault content**.
Custom frontmatter and later human metadata refinements are preserved; links,
completion state and confirmed Participants follow StenoAI.

Writes and state replacement are atomic per file, and concurrent runs use a lock.
The two export files and state are not one cross-file transaction. After an
interruption the next run retries, favoring preserved content over silent loss.

## Operation

`custom/obsidian_sync.py` is the reviewed source; the installed standalone copy is
`~/scripts/stenoai-sync/stenoai_sync.py`. No third-party Python packages are needed.

```sh
stenoai_sync.py --dry-run
stenoai_sync.py --days 365
```

Configuration and state are under `~/.config/stenoai-sync/`. Tests can override
`STENOAI_SYNC_CONFIG_DIR` and `STENOAI_USER_DATA_DIR`. The existing macOS LaunchAgent
watches both output and transcripts directories, throttles to 30 seconds and has
a 15-minute fallback. Its configured source paths should be updated if storage
is moved. Keep StenoAI's built-in summary-only Obsidian export off to avoid copies.
