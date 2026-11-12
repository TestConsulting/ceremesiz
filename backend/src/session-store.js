const session = require('express-session');

// Persistenter Session-Store in SQLite, damit Anmeldungen einen Neustart überstehen.
class SqliteSessionStore extends session.Store {
  constructor(db, { cleanupIntervalMs = 15 * 60 * 1000 } = {}) {
    super();
    this.stmts = {
      get: db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?'),
      set: db.prepare('INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires'),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      cleanup: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
    };
    this.timer = setInterval(() => this.stmts.cleanup.run(Date.now()), cleanupIntervalMs);
    this.timer.unref();
  }

  static expiry(sess) {
    const exp = sess && sess.cookie && sess.cookie.expires;
    return exp ? new Date(exp).getTime() : Date.now() + 8 * 60 * 60 * 1000;
  }

  get(sid, cb) {
    try {
      const row = this.stmts.get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb) {
    try {
      this.stmts.set.run(sid, JSON.stringify(sess), SqliteSessionStore.expiry(sess));
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }

  touch(sid, sess, cb) {
    try {
      this.stmts.touch.run(SqliteSessionStore.expiry(sess), sid);
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }

  destroy(sid, cb) {
    try {
      this.stmts.destroy.run(sid);
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }
}

module.exports = SqliteSessionStore;
