'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPersonContacts } = require('./person-contacts');

test('contacts remember only unambiguous invitees, survive rename, and delete by person id', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steno-contacts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const contacts = createPersonContacts(() => dir);
  const ada = { person_id: 'ada-id', display_name: 'Ada Lovelace' };
  const event = { attendees: [
    { name: '  ADA   LOVELACE ', email: 'Ada@example.com' },
    { email: 'jan.devries@example.com' },
    { name: 'Owner', email: 'owner@example.com', self: true },
  ] };
  contacts.remember(ada, event);
  assert.equal(contacts.list()['ada-id'].email, 'ada@example.com');
  contacts.remember({ person_id: 'jan-id', display_name: 'Jan Devries' }, event);
  assert.equal(contacts.list()['jan-id'].email, 'jan.devries@example.com');
  contacts.remember({ person_id: 'owner', display_name: 'Owner' }, event);
  assert.equal(contacts.list().owner, undefined);
  contacts.remember({ person_id: 'ambiguous', display_name: 'Ada Lovelace' }, {
    attendees: [...event.attendees, { name: 'Ada Lovelace', email: 'other@example.com' }],
  });
  assert.equal(contacts.list().ambiguous, undefined);
  // Contacts are looked up by stable id, independent of the current profile name.
  assert.equal(createPersonContacts(() => dir).list()['ada-id'].email, 'ada@example.com');
  contacts.remove('ada-id');
  assert.equal(contacts.list()['ada-id'], undefined);
  assert.equal(contacts.list()['jan-id'].email, 'jan.devries@example.com');
});

test('a damaged contact file is preserved rather than overwritten', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steno-contacts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'person-contacts.json');
  fs.writeFileSync(target, 'broken');
  const contacts = createPersonContacts(() => dir);
  assert.throws(() => contacts.remember({ person_id: 'ada', display_name: 'Ada' }, {
    attendees: [{ name: 'Ada', email: 'ada@example.com' }],
  }));
  assert.equal(fs.readFileSync(target, 'utf8'), 'broken');
});
