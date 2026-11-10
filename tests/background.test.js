'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const MEET = 'https://meet.google.com/abc-defg-hij';
const tick = () => new Promise((r) => setTimeout(r, 15));

// Carga background.js con un `chrome` simulado.
function load() {
  const calls = { created: [], updated: [], injected: [], failUpdate: false };
  const session = {};
  const listeners = {};
  let nextId = 100;
  const chrome = {
    runtime: {
      id: 'abc',
      getURL: (p) => 'chrome-extension://abc/' + p,
      onMessage: { addListener: (f) => { listeners.message = f; } }
    },
    action: { onClicked: { addListener: (f) => { listeners.click = f; } } },
    windows: {
      create: async (o) => { calls.created.push(o); return { id: nextId++ }; },
      update: async (id, o) => {
        if (calls.failUpdate) throw new Error('No window with id');
        calls.updated.push([id, o]);
      },
      onRemoved: { addListener: (f) => { listeners.removed = f; } }
    },
    storage: {
      session: {
        get: async (k) => ({ [k]: session[k] }),
        set: async (o) => { Object.assign(session, o); }
      }
    },
    scripting: { executeScript: async (o) => { calls.injected.push(o); } }
  };
  const code = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  vm.runInNewContext(code, { chrome, console });
  return { calls, listeners, session };
}

const fromMeet = (tabId) => ({ id: 'abc', tab: { id: tabId }, url: MEET });

test('el botón de la barra abre la ventana del sorteo para esa pestaña', async () => {
  const { calls, listeners } = load();
  listeners.message({ type: 'sorteo:open' }, fromMeet(7));
  await tick();
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].url, 'chrome-extension://abc/sorteo.html?tab=7');
  assert.equal(calls.created[0].type, 'popup');
});

test('un segundo clic enfoca la ventana existente en vez de abrir otra', async () => {
  const { calls, listeners } = load();
  listeners.message({ type: 'sorteo:open' }, fromMeet(7));
  await tick();
  listeners.message({ type: 'sorteo:open' }, fromMeet(7));
  await tick();
  assert.equal(calls.created.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.updated)), [[100, { focused: true }]]);
});

test('cada pestaña de Meet tiene su propia ventana', async () => {
  const { calls, listeners } = load();
  listeners.message({ type: 'sorteo:open' }, fromMeet(7));
  await tick();
  listeners.message({ type: 'sorteo:open' }, fromMeet(8));
  await tick();
  assert.equal(calls.created.length, 2);
  assert.match(calls.created[1].url, /\?tab=8$/);
});

test('si la ventana ya se cerró, abre una nueva', async () => {
  const { calls, listeners } = load();
  listeners.message({ type: 'sorteo:open' }, fromMeet(7));
  await tick();
  calls.failUpdate = true; // la ventana guardada ya no existe
  listeners.message({ type: 'sorteo:open' }, fromMeet(7));
  await tick();
  assert.equal(calls.created.length, 2);
});

test('al cerrarse la ventana se olvida, y el próximo clic abre una nueva', async () => {
  const { calls, listeners, session } = load();
  listeners.message({ type: 'sorteo:open' }, fromMeet(7));
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(session.windows)), { 7: 100 });
  await listeners.removed(100);
  assert.deepEqual(JSON.parse(JSON.stringify(session.windows)), {});
  listeners.message({ type: 'sorteo:open' }, fromMeet(7));
  await tick();
  assert.equal(calls.created.length, 2);
});

test('ignora mensajes que no vienen de Meet ni de esta extensión', async () => {
  const { calls, listeners } = load();
  listeners.message({ type: 'sorteo:open' }, { id: 'otra', tab: { id: 1 }, url: MEET });                          // otra extensión
  listeners.message({ type: 'sorteo:open' }, { id: 'abc', tab: { id: 1 }, url: 'https://evil.example/' });         // otra página
  listeners.message({ type: 'sorteo:open' }, { id: 'abc', url: MEET });                                            // sin pestaña
  listeners.message({ type: 'sorteo:open' }, { id: 'abc', tab: { id: 1 }, url: 'https://meet.google.com.evil.example/' });
  listeners.message({ type: 'otra-cosa' }, fromMeet(1));
  listeners.message(null, fromMeet(1));
  await tick();
  assert.equal(calls.created.length, 0);
});

test('el ícono en una pestaña de Meet inyecta los scripts y abre la ventana', async () => {
  const { calls, listeners } = load();
  await listeners.click({ id: 5, url: MEET });
  assert.deepEqual(JSON.parse(JSON.stringify(calls.injected)), [{ target: { tabId: 5 }, files: ['lib.js', 'content.js'] }]);
  assert.equal(calls.created[0].url, 'chrome-extension://abc/sorteo.html?tab=5');
});

test('el ícono fuera de Meet abre el sorteo en modo manual', async () => {
  const { calls, listeners } = load();
  await listeners.click({ id: 6, url: 'https://example.com/' });
  assert.equal(calls.injected.length, 0);
  assert.equal(calls.created[0].url, 'chrome-extension://abc/sorteo.html');
});
