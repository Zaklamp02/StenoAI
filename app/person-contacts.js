'use strict';

const fs = require('fs');
const path = require('path');

function foldName(name) {
  return String(name || '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
    .toLowerCase().replaceAll('ß', 'ss').replaceAll('ς', 'σ');
}

function attendeeName(attendee) {
  return String(attendee.name || '').trim() || String(attendee.email || '')
    .split('@')[0].split(/[._-]+/).filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

// Only a confirmed speaker name can acquire a matching invitee's email.
// Key by person_id so renames keep the contact and deletion removes it.
function createPersonContacts(getUserDataDir) {
  const file = () => path.join(getUserDataDir(), 'person-contacts.json');
  function read() {
    try {
      const contacts = JSON.parse(fs.readFileSync(file(), 'utf8'));
      if (!contacts || typeof contacts !== 'object' || Array.isArray(contacts)) {
        throw new Error('Invalid contacts file');
      }
      return contacts;
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }
  function write(contacts) {
    const target = file();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(contacts, null, 2), { mode: 0o600 });
    fs.renameSync(`${target}.tmp`, target);
  }
  return {
    list: read,
    remember(profile, event) {
      if (!profile.person_id || !profile.display_name) return;
      const emails = new Set((event?.attendees || [])
        .filter((attendee) => !attendee.self
          && foldName(attendeeName(attendee)) === foldName(profile.display_name)
          && typeof attendee.email === 'string' && attendee.email.includes('@'))
        .map((attendee) => attendee.email.trim().toLowerCase()));
      // Duplicate invitee names with different emails are ambiguous.
      if (emails.size !== 1) return;
      const contacts = read();
      contacts[profile.person_id] = { display_name: profile.display_name, email: [...emails][0] };
      write(contacts);
    },
    remove(personId) {
      const contacts = read();
      if (!Object.hasOwn(contacts, personId)) return;
      delete contacts[personId];
      write(contacts);
    },
  };
}

module.exports = { createPersonContacts };
