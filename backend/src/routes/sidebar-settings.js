const express = require('express');
const { requireAuthApi } = require('../middleware/auth');
const { requireCsrf, requireSameOriginJson } = require('../middleware/csrf');
const { getSettings, validSettings, saveSettings } = require('../sidebar-settings');

module.exports = function sidebarSettingsRoutes({ allowedOrigins }) {
  const router = express.Router();
  router.use(requireAuthApi);
  router.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store').json(getSettings());
  });
  router.put('/', requireSameOriginJson(allowedOrigins), requireCsrf, (req, res) => {
    if (!validSettings(req.body)) return res.status(400).json({ error: 'Ungültige Seitenleisten-Einstellungen.' });
    const saved = saveSettings(req.body);
    if (!saved) return res.status(409).json({ error: 'Die Einstellungen wurden zwischenzeitlich geändert. Bitte Seite neu laden.' });
    res.set('Cache-Control', 'no-store').json(saved);
  });
  return router;
};
