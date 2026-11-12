const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'private', 'intern.html'), 'utf8');
const start = html.indexOf('const BLANK=');
const end = html.indexOf('\nfunction compute(c)', start);
assert.ok(start !== -1 && end !== -1, 'Initialisierung der Renditekalkulation nicht gefunden');
const initialization = html.slice(start, end);

function initialize(saved) {
  const writes = [];
  const store = { get: () => saved, set: (key, value) => writes.push({ key, value }) };
  const context = vm.createContext({ store });
  const result = vm.runInContext(`${initialization}\nJSON.stringify({calcs, cur})`, context);
  return { ...JSON.parse(result), writes };
}

test('eine leere Kalkulationsliste bleibt leer und öffnet ein neues Formular', () => {
  const result = initialize([]);
  assert.deepEqual(result.calcs, []);
  assert.equal(result.cur.id, null);
  assert.equal(result.cur.data.name, '');
  assert.equal(result.writes.length, 0);
});

test('eine vorhandene Kalkulation wird mit ihrer eigenen ID geladen', () => {
  const result = initialize([{ id: 'existing', data: { name: 'Test' } }]);
  assert.equal(result.cur.id, 'existing');
  assert.equal(result.cur.data.name, 'Test');
  assert.equal(result.writes.length, 0);
});

test('ohne gespeicherte Kalkulationen werden die bisherigen Beispieldaten angelegt', () => {
  const result = initialize(null);
  assert.equal(result.cur.id, 'c1');
  assert.equal(result.calcs.length, 1);
  assert.equal(result.writes.length, 1);
});
