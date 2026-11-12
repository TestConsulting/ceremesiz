const db = require('./db');

const groupIds = ['holding', 'immo', 'tc', 'ppt'];
const itemIds = ['dashboard', 'board', 'holding', 'konto', 'rente', 'portfolio', 'rendite', 'vertrieb', 'marketing', 'ppt'];
const defaultSettings = { color: '#b36b10', groups: {}, items: {} };

function getSettings() {
  const row = db.prepare('SELECT revision, settings FROM sidebar_settings WHERE id = 1').get();
  return row ? { revision: row.revision, ...JSON.parse(row.settings) } : { revision: 0, ...defaultSettings };
}

function validEntries(entries, ids) {
  return entries && typeof entries === 'object' && !Array.isArray(entries) &&
    Object.entries(entries).every(([id, value]) =>
      ids.includes(id) && value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).every(key => key === 'name' || key === 'beta') &&
      typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 60 &&
      typeof value.beta === 'boolean');
}

function validSettings(body) {
  return body && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).every(key => ['revision', 'color', 'groups', 'items'].includes(key)) &&
    Number.isSafeInteger(body.revision) && body.revision >= 0 &&
    typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color) &&
    validEntries(body.groups, groupIds) && validEntries(body.items, itemIds);
}

const saveSettings = db.transaction(body => {
  const current = getSettings();
  if (current.revision !== body.revision) return null;
  const settings = { color: body.color, groups: body.groups, items: body.items };
  const revision = current.revision + 1;
  db.prepare(`INSERT INTO sidebar_settings (id, revision, settings) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, settings = excluded.settings`)
    .run(revision, JSON.stringify(settings));
  return { revision, ...settings };
});

module.exports = { getSettings, validSettings, saveSettings };
