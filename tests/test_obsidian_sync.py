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
        p = patch.object(sync, 'STENOAI_DATA_DIR', str(self.output.parent))
        p.start()
        self.addCleanup(p.stop)
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

    def test_native_export_migration_keeps_paths_metadata_and_edits_across_refreshes(self):
        import json
        self.note()
        legacy = self.vault / 'Existing linked note.md'
        legacy.write_text('---\nsource: Steno\nsteno_stem: "' + self.stem
                          + '"\ntitle: My custom title\n---\n\nMy original edited summary.\n')
        wrong = self.vault / 'Unrelated.md'
        wrong.write_text('---\nsource: Steno\nsteno_stem: different\n---\nDo not touch.')
        outside = self.root / 'outside.md'
        outside.write_text(legacy.read_text())
        index = self.root / 'native-index.json'
        index.write_text(json.dumps({'notes': {
            self.stem: {'vaultRelPath': legacy.name, 'lastWrittenHash': 'different'},
            'wrong': {'vaultRelPath': wrong.name},
            'escape': {'vaultRelPath': '../outside.md'},
        }}))
        self.cfg['native_sync_state_path'] = str(index)
        self.run_sync()
        self.assertEqual(self.exported('note'), legacy)
        self.assertIn('My original edited summary.', legacy.read_text())
        self.assertIn('title: My custom title', legacy.read_text())
        self.assertIn('Structured speaker data', self.exported('transcript').read_text())
        index.unlink()  # the managed state now follows the original path itself
        self.note(notes='Updated notes after migration.')
        self.run_sync()
        self.assertEqual(self.exported('note'), legacy)
        self.assertIn('Updated notes after migration.', legacy.read_text())
        self.assertIn('title: My custom title', legacy.read_text())
        self.assertIn('Do not touch.', wrong.read_text())
        self.assertNotIn(sync.AUTO_START, outside.read_text())

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


class SpeakerContextExportTests(ObsidianSyncTests):
    def setUp(self):
        super().setUp()
        import json
        self.settings = self.output.parent / 'config.json'
        self.settings.write_text(json.dumps({'identity_matching_enabled': True, 'person_profiles': []}))
        self.sidecar = self.output / (self.stem + '_speakers.json')
        self.sidecar.write_text(json.dumps({'diarization_run': {'run_id': 'run-1'},
            'transcript_lines': [{'start': 1.2, 'channel': 'mic', 'diarization_speaker_id': 'SPEAKER_0'}],
            'private_embedding': [9, 9, 9]}))
        import os
        os.utime(self.sidecar, (0, 0))
        self.payload = {'success': True, 'diarization_run_id': 'run-1', 'channels': {'mic': {'SPEAKER_0': {
            'status': 'confirmed', 'suggested_name': 'Alex', 'suggested_person_id': 'person-a',
            'confirmed_by_user': None, 'confirmed_person_id': None,
            'speech_duration_seconds': 39.3, 'segment_count': 34, 'first_timestamp': '00:01',
            'is_likely_artifact': True, 'candidates': [{'person_id': 'person-a', 'display_name': 'Alex',
                'distance': .17, 'hard_negative_conflict': False, 'embedding': [8, 8, 8]}],
            'reasons': ['matched saved voice'],
        }}}}
        query_patch = patch.object(sync, 'identify_speakers', side_effect=lambda *_: dict(self.payload, state='complete'))
        self.identify = query_patch.start()
        self.addCleanup(query_patch.stop)

    def data(self, kind='transcript'):
        import json
        import re
        content = self.exported(kind).read_text()
        return json.loads(re.search(r'```json\n(.*?)\n```', content, re.S).group(1))

    def test_rank_before_either_export_and_do_not_promote_machine_confirmed_to_human(self):
        self.note(transcript='[00:01] [You] My speech.')
        self.identify.side_effect = lambda *_: (self.assertFalse(list(self.vault.rglob('*.md'))) or dict(self.payload, state='complete'))
        self.run_sync()
        for kind in ['note', 'transcript']:
            context = self.data(kind)
            row = context['speakers'][0]
            self.assertEqual(row['review_status'], 'unconfirmed')
            self.assertEqual(row['suggestion_strength'], 'likely')
            self.assertIsNone(row['confirmed_name'])
            self.assertEqual(row['suggested_name'], 'Alex')
            self.assertTrue(row['hidden_in_app'])
            self.assertEqual(row['transcript_turns'], [1])
            self.assertEqual(row['transcript_labels'], ['You'])
            text = self.exported(kind).read_text()
            self.assertIn('confirmed_speakers: []', text)
            self.assertIn('suggested_speakers: ["Alex"]', text)
            self.assertNotIn('private_embedding', text)
            self.assertNotIn('"embedding"', text)
        self.assertIn('[You] My speech.', self.exported('transcript').read_text())

    def test_later_approval_and_sidecar_review_updates_refresh_without_summary_change(self):
        self.note()
        self.run_sync()
        raw = self.source.read_text()
        row = self.payload['channels']['mic']['SPEAKER_0']
        row.update(confirmed_by_user='Alex', confirmed_person_id='person-a')
        self.sidecar.write_text(self.sidecar.read_text() + '\n')
        self.run_sync()
        self.assertEqual(self.source.read_text(), raw)
        self.assertEqual(self.data()['speakers'][0]['review_status'], 'confirmed')
        self.assertIn('confirmed_speakers: ["Alex"]', self.exported('note').read_text())
        row.update(contains_multiple_speakers=True, confirmed_by_user=None)
        self.sidecar.write_text(self.sidecar.read_text() + '\n')
        self.run_sync()
        self.assertEqual(self.data()['speakers'][0]['review_status'], 'mixed')
        self.assertIsNone(self.data()['speakers'][0]['suggested_name'])

    def test_profile_only_change_invalidates_suggestions(self):
        self.note()
        self.run_sync()
        self.payload['channels']['mic']['SPEAKER_0']['suggested_name'] = 'Alex Renamed'
        self.settings.write_text('{"identity_matching_enabled": true, "person_profiles": [{"display_name": "Alex Renamed"}]}')
        self.run_sync()
        self.assertEqual(self.data()['speakers'][0]['suggested_name'], 'Alex Renamed')
        self.assertEqual(self.identify.call_count, 2)

    def test_calendar_invitees_include_self_and_refresh_rsvp_names_and_removal(self):
        import json
        self.note()
        calendar = self.output / (self.stem + '_calendar.json')
        calendar.write_text(json.dumps({'event': {'title': 'Invitation', 'attendees': [
            {'name': 'Owner', 'email': 'owner@example.test', 'self': True, 'status': 'accepted'},
            {'name': 'Guest', 'email': 'guest@example.test', 'status': 'tentative'},
        ]}}))
        self.run_sync()
        self.assertEqual(len(self.data()['calendar_invitees']), 2)
        self.assertEqual(self.data()['calendar_invitees'][0]['status'], 'accepted')
        path = self.exported('note')
        path.write_text(path.read_text() + '\nVault annotation survives.\n')
        calendar.write_text(json.dumps({'event': {'title': 'Updated invitation', 'attendees': [
            {'name': 'New Guest', 'email': 'new@example.test', 'status': 'declined'},
        ]}}))
        self.run_sync()
        self.assertIn('attendees: ["New Guest"]', path.read_text())
        self.assertIn('Vault annotation survives.', path.read_text())
        self.assertEqual(self.data()['calendar_invitees'][0]['status'], 'declined')
        calendar.unlink()
        self.run_sync()
        self.assertEqual(self.data()['calendar_invitees'], [])
        self.assertNotIn('attendees_source: calendar', path.read_text())

    def test_failed_or_concurrent_ranking_preserves_last_successful_exports(self):
        self.note()
        self.run_sync()
        before = {kind: self.exported(kind).read_text() for kind in ['note', 'transcript']}
        self.sidecar.write_text(self.sidecar.read_text() + '\n')
        self.identify.side_effect = RuntimeError('Backend unavailable')
        with self.assertRaises(RuntimeError):
            self.run_sync()
        self.assertEqual(before['note'], self.exported('note').read_text())
        def change_source(*_):
            self.source.write_text(self.source.read_text() + '\nConcurrent edit')
            return dict(self.payload, state='complete')
        self.identify.side_effect = change_source
        with self.assertRaisesRegex(RuntimeError, 'changed during export'):
            self.run_sync()
        self.assertEqual(before['transcript'], self.exported('transcript').read_text())

    def test_stale_manifest_does_not_invent_turn_associations(self):
        self.note(transcript='[00:02] [Speaker 2] Different turn.')
        self.run_sync()
        context = self.data()
        self.assertEqual(context['turn_mapping'], 'unavailable')
        self.assertEqual(context['speakers'][0]['transcript_turns'], [])

    def test_unchanged_sources_do_not_rerank_or_rewrite(self):
        self.note()
        self.run_sync()
        self.assertFalse(self.run_sync())
        self.assertEqual(self.identify.call_count, 1)

    def test_timestamp_tracks_speaker_sidecar(self):
        import os
        self.note()
        os.utime(self.source, (100, 100))
        os.utime(self.sidecar, (400, 400))
        self.assertEqual(sync.source_mtime(str(self.source)), 400)


class SpeakerBackendQueryTests(unittest.TestCase):
    def test_queries_cli_without_shell_and_uses_allowlisted_payload(self):
        import json
        import subprocess
        payload = {'success': True, 'diarization_run_id': 'current', 'channels': {'mic': {}}}
        with patch.object(sync, 'speaker_settings', return_value={'identity_matching_enabled': True}), \
                patch.object(sync, 'speaker_backend', return_value='/fake/stenoai'), \
                patch.object(sync.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(payload))) as run:
            result = sync.identify_speakers({}, 'meeting', '{"diarization_run": {"run_id": "current"}}')
        self.assertEqual(result['state'], 'complete')
        self.assertEqual(run.call_args.args[0], ['/fake/stenoai', 'suggest-speakers', 'meeting'])
        self.assertNotIn('shell', run.call_args.kwargs)

    def test_failed_ranking_and_changed_run_hold_back_export(self):
        import subprocess
        with patch.object(sync, 'speaker_settings', return_value={'identity_matching_enabled': True}), \
                patch.object(sync, 'speaker_backend', return_value='/fake/stenoai'), \
                patch.object(sync.subprocess, 'run', side_effect=subprocess.TimeoutExpired('backend', 60)):
            with self.assertRaisesRegex(RuntimeError, 'retry'):
                sync.identify_speakers({}, 'meeting', '{}')
        with patch.object(sync, 'speaker_settings', return_value={'identity_matching_enabled': True}), \
                patch.object(sync, 'speaker_backend', return_value='/fake/stenoai'), \
                patch.object(sync.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0,
                    '{"success": true, "diarization_run_id": "old", "channels": {}}')):
            with self.assertRaisesRegex(RuntimeError, 'changed'):
                sync.identify_speakers({}, 'meeting', '{"diarization_run": {"run_id": "new"}}')

    def test_no_sidecar_or_disabled_identification_never_runs_backend(self):
        with patch.object(sync, 'speaker_settings', return_value={'identity_matching_enabled': True}), \
                patch.object(sync.subprocess, 'run') as run:
            self.assertEqual(sync.identify_speakers({}, 'meeting', '')['state'], 'unavailable')
            run.assert_not_called()
        with patch.object(sync, 'speaker_settings', return_value={'identity_matching_enabled': False}):
            self.assertEqual(sync.identify_speakers({}, 'meeting', '{}')['state'], 'disabled')
