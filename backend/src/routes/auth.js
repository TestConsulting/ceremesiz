const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit').default;
const { verifyCredentials, publicUser } = require('../users');
const { requireAuthApi } = require('../middleware/auth');
const { requireCsrf, requireSameOriginJson } = require('../middleware/csrf');

module.exports = function authRoutes({ allowedOrigins, loginLimit }) {
  const router = express.Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' },
  });

  router.post('/login', loginLimiter, requireSameOriginJson(allowedOrigins), async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: 'Bitte E-Mail und Passwort eingeben.' });

      const user = await verifyCredentials(email, password);
      if (!user) return res.status(401).json({ error: 'E-Mail oder Passwort ist falsch.' });

      req.session.regenerate(err => {
        if (err) return next(err);
        req.session.userId = user.id;
        req.session.sessionVersion = user.session_version;
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
        req.session.save(err2 => {
          if (err2) return next(err2);
          res.json({ user: publicUser(user), csrfToken: req.session.csrfToken });
        });
      });
    } catch (err) { next(err); }
  });

  router.post('/logout', (req, res, next) => {
    if (!req.session || !req.session.userId) return res.status(204).end();
    requireCsrf(req, res, () => {
      req.session.destroy(err => {
        if (err) return next(err);
        res.clearCookie(req.app.get('sessionCookieName'), { path: '/' });
        res.status(204).end();
      });
    });
  });

  router.get('/me', requireAuthApi, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ user: publicUser(req.user), csrfToken: req.session.csrfToken });
  });

  return router;
};
