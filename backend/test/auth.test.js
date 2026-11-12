const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ceremesiz-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');

const { createApp } = require('../src/app');
const { upsertUser } = require('../src/users');
const db = require('../src/db');

let server;
let base;

test.before(async () => {
  await upsertUser({ email: 'Demo.User@example.invalid', firstName: 'Demo', lastName: 'User', password: 'richtig-123!' });
  server = createApp({ sessionSecret: 'test-secret', loginLimit: 5 }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const login = (email, password, extra = {}) => fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...extra },
  body: JSON.stringify({ email, password }),
});
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];

test('öffentliche Startseite ist erreichbar', async () => {
  const res = await fetch(`${base}/`);
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /data-open-login/);
});

test('Favicon ist öffentlich als PNG erreichbar', async () => {
  const res = await fetch(`${base}/favicon.png`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /^image\/png/);
  assert.deepStrictEqual(Buffer.from(await res.arrayBuffer()).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});

test('interner Bereich leitet ohne Login zur Anmeldung um', async () => {
  const res = await fetch(`${base}/intern`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/#login');
  assert.strictEqual((await fetch(`${base}/api/auth/me`)).status, 401);
});

test('Backend-Dateien sind nicht öffentlich abrufbar', async () => {
  for (const p of ['/backend/private/intern.html', '/private/intern.html', '/intern.html', '/backend/data/ceremesiz.db']) {
    assert.strictEqual((await fetch(`${base}${p}`)).status, 404, p);
  }
});

test('falsches Passwort und unbekannte E-Mail werden abgelehnt', async () => {
  assert.strictEqual((await login('demo.user@example.invalid', 'falsch')).status, 401);
  assert.strictEqual((await login('niemand@example.invalid', 'richtig-123!')).status, 401);
});

test('Login von fremder Origin wird abgelehnt', async () => {
  const res = await login('demo.user@example.invalid', 'richtig-123!', { Origin: 'https://evil.example' });
  assert.strictEqual(res.status, 403);
});

test('Login, interner Bereich und Logout', async () => {
  const res = await login('DEMO.user@example.invalid', 'richtig-123!');
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.user.name, 'Demo User');
  assert.ok(!('password_hash' in body.user));
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = cookieOf(res);

  const page = await fetch(`${base}/intern`, { headers: { Cookie: cookie } });
  assert.strictEqual(page.status, 200);
  assert.strictEqual(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.match(html, /window\.__BOOT__=\{"user":\{[^}]*"firstName":"Demo"/);
  assert.match(html, /<link rel="icon" type="image\/png" sizes="32x32" href="\/favicon\.png">/);
  assert.ok(!html.includes('<!--__BOOT__-->'));

  const noCsrf = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
  assert.strictEqual(noCsrf.status, 403);

  const out = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': body.csrfToken } });
  assert.strictEqual(out.status, 204);

  const after = await fetch(`${base}/intern`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.strictEqual(after.status, 302);
});

test('Passwortänderung beendet bestehende Sitzungen', async () => {
  const res = await login('demo.user@example.invalid', 'richtig-123!');
  const cookie = cookieOf(res);
  await upsertUser({ email: 'demo.user@example.invalid', firstName: 'Demo', lastName: 'User', password: 'neues-pass-456!' });
  const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.strictEqual(me.status, 401);
  await upsertUser({ email: 'demo.user@example.invalid', firstName: 'Demo', lastName: 'User', password: 'richtig-123!' });
});

test('zu viele Fehlversuche werden begrenzt', async () => {
  let last;
  for (let i = 0; i < 8; i++) last = await login('demo.user@example.invalid', 'falsch');
  assert.strictEqual(last.status, 429);
});
