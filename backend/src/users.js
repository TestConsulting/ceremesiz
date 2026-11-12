const bcrypt = require('bcrypt');
const db = require('./db');

const BCRYPT_COST = 12;
const MAX_PASSWORD_BYTES = 72;

const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const findById = db.prepare('SELECT * FROM users WHERE id = ?');

// Fester Dummy-Hash, damit unbekannte E-Mails gleich lange prüfen wie bekannte (kein Timing-Leak).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    name: `${u.first_name} ${u.last_name}`,
    initials: `${u.first_name[0] || ''}${u.last_name[0] || ''}`.toUpperCase(),
    role: u.role,
  };
}

async function verifyCredentials(email, password) {
  const pw = String(password || '');
  if (!pw || Buffer.byteLength(pw, 'utf8') > MAX_PASSWORD_BYTES) {
    await bcrypt.compare('x', DUMMY_HASH);
    return null;
  }
  const user = findByEmail.get(normalizeEmail(email));
  const ok = await bcrypt.compare(pw, user ? user.password_hash : DUMMY_HASH);
  return user && ok ? user : null;
}

async function upsertUser({ email, firstName, lastName, password, role = 'geschaeftsfuehrung' }) {
  const mail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new Error('Ungültige E-Mail-Adresse');
  if (!firstName || !lastName) throw new Error('Vor- und Nachname sind erforderlich');
  if (!password || password.length < 8) throw new Error('Passwort muss mindestens 8 Zeichen haben');
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) throw new Error('Passwort ist zu lang (max. 72 Bytes)');

  const hash = await bcrypt.hash(password, BCRYPT_COST);
  const existing = findByEmail.get(mail);
  if (existing) {
    // session_version erhöhen meldet alle bestehenden Sitzungen dieses Benutzers ab.
    db.prepare(`UPDATE users SET first_name = ?, last_name = ?, password_hash = ?, role = ?,
                session_version = session_version + 1, updated_at = datetime('now') WHERE id = ?`)
      .run(firstName, lastName, hash, role, existing.id);
    return { created: false, user: findById.get(existing.id) };
  }
  const info = db.prepare('INSERT INTO users (email, first_name, last_name, password_hash, role) VALUES (?, ?, ?, ?, ?)')
    .run(mail, firstName, lastName, hash, role);
  return { created: true, user: findById.get(info.lastInsertRowid) };
}

module.exports = { findById, publicUser, verifyCredentials, upsertUser, normalizeEmail };
