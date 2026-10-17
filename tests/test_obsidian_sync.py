import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from custom import obsidian_sync as sync


class ObsidianSyncTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.vault = self.root / 'vault'
        self.vault.mkdir()
        self.output = self.root / 'steno/output'
        self.output.mkdir(parents=True)
        self.transcripts = self.output.parent / 'transcripts'
        self.transcripts.mkdir()
        self.cfg = dict(sync.DEFAULT_CONFIG, vault=str(self.vault), steno_output_dir=str(self.output),
                        link_from_daily_notes=False, settle_seconds=0)
        self.stem = 'sysaudio-1792148665768-Note'
        self.source = self.output / (self.stem + '_summary.md')
        self.canonical = self.transcripts / (self.stem + '_transcript.txt')
        self.state = {}
        p = patch.object(sync, 'log')
        self.log = p.start()
        self.addCleanup(p.stop)

    def note(self, transcript='[00:01] [Others] All words retained.', summary=True, notes='My private note.', **flags):
        meta = {'title': 'Meeting', 'duration_seconds': 60, **flags}
        import json
        content = '---\n' + '\n'.join(k + ': ' + json.dumps(v) for k, v in meta.items()) + '\n---\n\n'
        content += '## Summary\n\nAvailable summary.\n\n' if summary else ''
        content += '## Transcript\n\n' + transcript
        if notes:
            content += '\n\n## User Notes\n\n' + notes
        self.source.write_text(content)

    def run_sync(self):
        return sync.sync_one(self.cfg, self.state, str(self.source), False, False)

    def exported(self, kind):
        entry = self.state[self.stem]
        return self.vault / entry['note_rel' if kind == 'note' else 'transcript_rel']

    def test_completed_transcript_exports_without_summary_and_keeps_notes_separate(self):
        self.note(summary=False, notes_generated=False)
        self.assertTrue(self.run_sync())
        note = self.exported('note').read_text()
        transcript = self.exported('transcript').read_text()
        self.assertIn('My private note.', note)
        self.assertNotIn('My private note.', transcript)
        self.assertIn('All words retained.', transcript)
        self.assertIn('summary_available: false', note)
        self.note(summary=True)
        self.run_sync()
        self.assertIn('Available summary.', self.exported('note').read_text())
        self.assertIn('summary_available: true', self.exported('note').read_text())

    def test_processing_failed_and_live_fallbacks_never_export(self):
        for flag in ['processing', 'transcription_failed', 'is_live_transcript']:
            self.note(**{flag: True})
            self.canonical.write_text('Session: test\n' + '=' * 40 + '\nFull-looking text')
            self.run_sync()
            self.assertFalse(list(self.vault.rglob('*.md')))

    def test_speaker_edit_updates_authoritative_canonical_transcript_when_embedded_copy_is_stale(self):
        self.note()
        self.canonical.write_text('Session: test\n' + '=' * 40 + '\n[00:01] [Others] Canonical full speech.')
        self.run_sync()
        self.canonical.write_text('Session: test\n' + '=' * 40 + '\n[00:01] [Alex] Canonical full speech.')
        self.run_sync()
        content = self.exported('transcript').read_text()
        self.assertIn('[Alex] Canonical full speech.', content)
        self.assertNotIn('[Others]', content)

    def test_archived_renamed_files_are_updated_by_id_without_recreating_inbox(self):
        self.note()
        self.run_sync()
        locations = {}
        for kind, folder in [('note', 'Archive/StenoAI/Meeting notes'), ('transcript', 'Archive/StenoAI/Transcripts')]:
            old = self.exported(kind)
            target = self.vault / folder / ('renamed-' + kind + '.md')
            target.parent.mkdir(parents=True, exist_ok=True)
            old.rename(target)
            target.write_text(target.read_text() + '\nVault-only annotation.\n')
            locations[kind] = target
        self.note(transcript='[00:01] [Alex] Updated full speech.')
        self.run_sync()
        self.assertIn('[Alex] Updated full speech.', locations['transcript'].read_text())
        self.assertIn('Vault-only annotation.', locations['transcript'].read_text())
        self.assertFalse(list((self.vault / self.cfg['transcripts_folder']).glob('*.md')))
        self.assertIn('Archive/StenoAI/Meeting notes/renamed-note.md', locations['transcript'].read_text())

    def test_edited_legacy_export_is_preserved_while_latest_source_gets_managed_section(self):
        self.note()
        self.run_sync()
        destination = self.exported('note')
        legacy = destination.read_text().replace(sync.AUTO_START, '').replace(sync.AUTO_END, '') + '\nOriginal user edits.\n'
        destination.write_text(legacy)
        for key in ['note_base', 'note_managed_hash']:
            self.state[self.stem].pop(key, None)
        self.note(notes='Updated My notes.')
        self.run_sync()
        content = destination.read_text()
        self.assertIn('Original user edits.', content)
        self.assertIn('Updated My notes.', content)
        self.assertEqual(content.count(sync.AUTO_START), 1)

    def test_nonoverlapping_edits_merge_and_conflicting_edits_are_retained_outside_source(self):
        self.note()
        self.run_sync()
        path = self.exported('transcript')
        path.write_text(path.read_text().replace('All words retained.', 'All words retained. (annotation)'))
        self.note(transcript='[00:01] [Alex] All words retained.')
        self.run_sync()
        text = path.read_text()
        generated = text.split(sync.AUTO_START)[1].split(sync.AUTO_END)[0]
        self.assertIn('[Alex] All words retained.', generated)
        self.assertIn('annotation', text.split(sync.AUTO_END)[1])
        self.assertEqual(sync.three_way('A\nB\nC\n', 'A\nB note\nC\n', 'New A\nB\nC\n'), 'New A\nB note\nC\n')

    def test_custom_frontmatter_and_deleted_export_are_preserved(self):
        self.note()
        self.run_sync()
        path = self.exported('note')
        text = path.read_text().replace('---\n', '---\ntags:\n  - human-tag\n', 1)
        path.write_text(text)
        removed = self.exported('transcript')
        removed.unlink()
        self.note(notes='new notes')
        self.run_sync()
        self.assertIn('tags:\n  - human-tag', path.read_text())
        self.assertFalse(removed.exists())

    def test_manual_marker_damage_is_not_overwritten(self):
        self.note()
        self.run_sync()
        path = self.exported('note')
        text = path.read_text().replace(sync.AUTO_END, '')
        path.write_text(text)
        self.note(notes='new notes')
        with self.assertRaisesRegex(RuntimeError, 'markers'):
            self.run_sync()
        self.assertEqual(path.read_text(), text)

    def test_source_timestamp_tracks_canonical_and_calendar_updates(self):
        import os
        self.note()
        os.utime(self.source, (100, 100))
        self.assertEqual(sync.source_mtime(str(self.source)), 100)
        self.canonical.write_text('Full transcript')
        os.utime(self.canonical, (200, 200))
        self.assertEqual(sync.source_mtime(str(self.source)), 200)
        calendar = self.output / (self.stem + '_calendar.json')
        calendar.write_text('{}')
        os.utime(calendar, (300, 300))
        self.assertEqual(sync.source_mtime(str(self.source)), 300)


class ParticipantPlacementTests(unittest.TestCase):
    def test_speaker_confirmation_does_not_append_participants_into_my_notes(self):
        from simple_recorder import _update_summary_participants
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            note = root / 'meeting_summary.md'
            note.write_text('---\ntitle: "Meeting"\n---\n\n## Transcript\n\n[00:00] [You] Speech.\n\n## User Notes\n\nKeep this text.\n')
            self.assertTrue(_update_summary_participants(root, 'meeting', ['Alex']))
            _, body, transcript = sync.parse_steno_note(note.read_text())
            self.assertIn('## Participants\n\nAlex', body)
            self.assertIn('## My notes\n\nKeep this text.', body)
            self.assertNotIn('Participants', transcript)
            self.assertTrue(note.read_text().endswith('Keep this text.\n'))


class SyncStatusTests(ObsidianSyncTests):
    def test_per_note_error_is_recorded_then_cleared(self):
        self.note()
        saved = {}
        with patch.object(sync, 'load_state', return_value={}), \
                patch.object(sync, 'save_state', side_effect=lambda s: saved.update(s)), \
                patch.object(sync, 'sync_one', side_effect=RuntimeError('disk full')):
            sync.sync(self.cfg, 7, False, False)
        self.assertEqual(saved['errors'][self.stem]['message'], 'disk full')
        with patch.object(sync, 'load_state', return_value=dict(saved)), \
                patch.object(sync, 'save_state', side_effect=lambda s: saved.update(s)):
            sync.sync(self.cfg, 7, False, False)
        self.assertNotIn(self.stem, saved['errors'])
        self.assertIn('synced_at', saved['synced'][self.stem])

    def test_waiting_reason_is_kept_until_export(self):
        self.note(processing=True)
        self.run_sync()
        self.assertTrue(self.state[self.stem]['waiting_reason'])
        self.note()
        self.run_sync()
        self.assertNotIn('waiting_reason', self.state[self.stem])
