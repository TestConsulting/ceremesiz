const { findById } = require('../users');

// Lädt den angemeldeten Benutzer und prüft, ob die Sitzung noch gültig ist
// (Benutzer existiert noch, Passwort wurde seit dem Login nicht geändert).
function loadUser(req) {
  const s = req.session;
  if (!s || !s.userId) return null;
  const user = findById.get(s.userId);
  if (!user || user.session_version !== s.sessionVersion) return null;
  return user;
}

function requireAuthApi(req, res, next) {
  const user = loadUser(req);
  if (!user) {
    if (req.session && req.session.userId) req.session.destroy(() => {});
    return res.status(401).json({ error: 'Nicht angemeldet' });
  }
  req.user = user;
  next();
}

function requireAuthPage(req, res, next) {
  const user = loadUser(req);
  if (!user) {
    if (req.session && req.session.userId) req.session.destroy(() => {});
    return res.redirect(302, '/#login');
  }
  req.user = user;
  next();
}

module.exports = { loadUser, requireAuthApi, requireAuthPage };
