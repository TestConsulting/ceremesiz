const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const db = require('./db');
const SqliteSessionStore = require('./session-store');
const authRoutes = require('./routes/auth');
const sidebarSettingsRoutes = require('./routes/sidebar-settings');
const { getSettings } = require('./sidebar-settings');
const { requireAuthPage } = require('./middleware/auth');
const { publicUser } = require('./users');

const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '..', '..');
const PRIVATE_DIR = path.join(__dirname, '..', 'private');
const SESSION_COOKIE = 'ch.sid';

// JSON sicher in ein <script>-Tag einbetten.
const inlineJson = obj => JSON.stringify(obj)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function createApp(options = {}) {
  const isProd = process.env.NODE_ENV === 'production';
  let secret = options.sessionSecret || process.env.SESSION_SECRET;
  if (!secret) {
    if (isProd) throw new Error('SESSION_SECRET muss in Produktion gesetzt sein');
    secret = crypto.randomBytes(32).toString('hex');
    console.warn('[warn] SESSION_SECRET nicht gesetzt – zufälliges Secret für diese Laufzeit verwendet');
  }
  const allowedOrigins = (process.env.FRONTEND_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const loginLimit = options.loginLimit || Number(process.env.LOGIN_RATE_LIMIT) || 10;

  const app = express();
  app.disable('x-powered-by');
  app.set('sessionCookieName', SESSION_COOKIE);
  if (isProd || process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    next();
  });

  app.use(express.json({ limit: '10kb' }));
  app.use(session({
    name: SESSION_COOKIE,
    secret,
    store: new SqliteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, secure: 'auto', sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
  }));

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes({ allowedOrigins, loginLimit }));
  app.use('/api/sidebar-settings', sidebarSettingsRoutes({ allowedOrigins }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden' }));

  // Öffentliche Website
  const indexFile = path.join(PUBLIC_DIR, 'index.html');
  app.get(['/', '/index.html'], (req, res) => res.sendFile(indexFile));
  app.get('/favicon.png', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'favicon.png')));

  // Interner Bereich – wird nur an angemeldete Benutzer ausgeliefert.
  const internFile = path.join(PRIVATE_DIR, 'intern.html');
  let internCache = null;
  const internHtml = () => (isProd && internCache) || (internCache = fs.readFileSync(internFile, 'utf8'));
  app.get(['/intern', '/intern/'], requireAuthPage, (req, res) => {
    const boot = { user: publicUser(req.user), csrfToken: req.session.csrfToken, sidebarSettings: getSettings() };
    const html = internHtml().replace('<!--__BOOT__-->', `<script>window.__BOOT__=${inlineJson(boot)}</script>`);
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    res.type('html').send(html);
  });

  app.use((req, res) => res.status(404).type('text').send('Nicht gefunden'));

  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültige Anfrage' });
    res.status(500).json({ error: 'Interner Fehler' });
  });

  return app;
}

module.exports = { createApp };
