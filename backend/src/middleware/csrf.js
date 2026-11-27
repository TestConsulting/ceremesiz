const crypto = require('crypto');

// Schreibende Anfragen müssen den CSRF-Token der Sitzung im Header X-CSRF-Token mitsenden.
function requireCsrf(req, res, next) {
  const expected = req.session && req.session.csrfToken;
  const given = req.get('X-CSRF-Token');
  if (!expected || !given) return res.status(403).json({ error: 'CSRF-Token fehlt' });
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'CSRF-Token ungültig' });
  }
  next();
}

// Login-CSRF verhindern: nur JSON-Anfragen von der eigenen Seite zulassen.
function requireSameOrigin(allowedOrigins,contentType,error) {
  return (req, res, next) => {
    if (!req.is(contentType)) return res.status(415).json({ error });
    const origin = req.get('Origin');
    if (origin) {
      const self = `${req.protocol}://${req.get('host')}`;
      if (origin !== self && !allowedOrigins.includes(origin)) {
        return res.status(403).json({ error: 'Ursprung nicht erlaubt' });
      }
    }
    next();
  };
}

const requireSameOriginJson=allowedOrigins=>requireSameOrigin(allowedOrigins,'application/json','Nur JSON erlaubt');

module.exports = { requireCsrf, requireSameOriginJson, requireSameOrigin };
