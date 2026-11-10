'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib.js');

// Generador repetible (mulberry32) para pruebas deterministas.
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('placeName: ordinales en español y respaldo numérico', () => {
  assert.equal(L.placeName(1), 'Primer lugar');
  assert.equal(L.placeName(2), 'Segundo lugar');
  assert.equal(L.placeName(3), 'Tercer lugar');
  assert.equal(L.placeName(10), 'Décimo lugar');
  assert.equal(L.placeName(11), '11.º lugar');
});

test('buildPlaces: usa el nombre personalizado y rellena el resto', () => {
  assert.deepEqual(L.buildPlaces(4, ['Presenta', '', '  Suplente  ']), ['Presenta', 'Segundo lugar', 'Suplente', 'Cuarto lugar']);
  assert.deepEqual(L.buildPlaces(2), ['Primer lugar', 'Segundo lugar']);
});

test('randomInt: respeta el rango y es razonablemente uniforme', () => {
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 12000; i++) {
    const v = L.randomInt(6);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 6);
    counts[v]++;
  }
  counts.forEach((c) => assert.ok(c > 1700 && c < 2300, 'conteo fuera de rango: ' + c));
  assert.equal(L.randomInt(1), 0);
  assert.throws(() => L.randomInt(0), RangeError);
});

test('shuffle: conserva los elementos y no muta el original', () => {
  const src = [1, 2, 3, 4, 5, 6, 7];
  const copy = src.slice();
  const out = L.shuffle(src, seeded(7));
  assert.deepEqual(src, copy);
  assert.deepEqual(out.slice().sort(), copy);
});

test('pickWinners: distintos, en la cantidad pedida y acotados al total', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'];
  const w = L.pickWinners(pool, 3, seeded(1));
  assert.equal(w.length, 3);
  assert.equal(new Set(w).size, 3);
  w.forEach((x) => assert.ok(pool.includes(x)));
  assert.equal(L.pickWinners(pool, 99).length, 5);
  assert.equal(L.pickWinners(pool, 0).length, 0);
  assert.equal(L.pickWinners([], 2).length, 0);
});

test('pickWinners: cada persona gana con la misma frecuencia', () => {
  const pool = ['a', 'b', 'c', 'd'];
  const wins = { a: 0, b: 0, c: 0, d: 0 };
  for (let i = 0; i < 8000; i++) wins[L.pickWinners(pool, 1)[0]]++;
  Object.values(wins).forEach((c) => assert.ok(c > 1800 && c < 2200, 'frecuencia fuera de rango: ' + c));
});

test('clampWinners: número escrito a mano', () => {
  assert.equal(L.clampWinners('3', 6), 3);
  assert.equal(L.clampWinners('0', 6), 1);
  assert.equal(L.clampWinners('-4', 6), 1);
  assert.equal(L.clampWinners('abc', 6), 1);
  assert.equal(L.clampWinners('50', 6), 6);
  assert.equal(L.clampWinners('7', 0), 1);
  assert.equal(L.clampWinners(2.9, 10), 2);
});

test('cleanName: quita la marca de uno mismo y caracteres invisibles', () => {
  assert.deepEqual(L.cleanName('Ana  Gómez (Tú)'), { name: 'Ana Gómez', self: true });
  assert.deepEqual(L.cleanName('John Doe (You)'), { name: 'John Doe', self: true });
  assert.deepEqual(L.cleanName('​Luis Benítez​'), { name: 'Luis Benítez', self: false });
  assert.deepEqual(L.cleanName(null), { name: '', self: false });
});

test('parseParticipants: deduplica y descarta basura', () => {
  const out = L.parseParticipants([
    'Ana Gómez', 'ana gómez', 'Luis Benítez (Tú)', 'Tu presentación', 'Your presentation',
    '+3', '3 más', '', '   ', 'x'.repeat(81), 'María Duarte'
  ]);
  assert.deepEqual(out.map((p) => p.name), ['Ana Gómez', 'Luis Benítez', 'María Duarte']);
  assert.equal(out.find((p) => p.name === 'Luis Benítez').self, true);
  assert.equal(out.find((p) => p.name === 'Ana Gómez').self, false);
});

test('computePool: respeta desmarcados y el historial solo si está activo', () => {
  const names = ['Ana', 'Luis', 'María', 'Carlos'];
  const hist = new Set(['luis', 'carlos']);
  let r = L.computePool(names, new Set(['Ana']), hist, false);
  assert.deepEqual(r.pool, ['Luis', 'María', 'Carlos']);
  assert.deepEqual(r.blocked, []);
  r = L.computePool(names, new Set(['Ana']), hist, true);
  assert.deepEqual(r.pool, ['María']);
  assert.deepEqual(r.blocked, ['Luis', 'Carlos']);
});

test('buildChatMessage: uno, varios, título vacío y límite de largo', () => {
  assert.equal(
    L.buildChatMessage('¿Quién presenta?', [{ place: 'Primer lugar', name: 'María Duarte' }]),
    '🎉 ¿Quién presenta? ¡Le tocó a María Duarte!'
  );
  assert.equal(
    L.buildChatMessage('¿Quién presenta?', [
      { place: 'Primer lugar', name: 'María Duarte' },
      { place: 'Segundo lugar', name: 'Carlos Ortiz' }
    ]),
    '🎉 ¿Quién presenta? Primer lugar: María Duarte · Segundo lugar: Carlos Ortiz'
  );
  assert.equal(L.buildChatMessage('', [{ place: 'x', name: 'Ana' }]), '🎉 Sorteo ¡Le tocó a Ana!');
  const many = Array.from({ length: 60 }, (_, i) => ({ place: i + 1 + '.º lugar', name: 'Persona número ' + (i + 1) }));
  const msg = L.buildChatMessage('Título', many);
  assert.ok(msg.length <= 480, 'largo: ' + msg.length);
  assert.match(msg, /…y \d+ más$/);
});

test('ruleta: el segmento elegido queda bajo el puntero', () => {
  const rng = seeded(42);
  for (let count = 1; count <= 12; count++) {
    for (let index = 0; index < count; index++) {
      for (const jitter of [-1, -0.5, 0, 0.5, 1]) {
        const current = rng() * 2000 - 500;
        const end = current + L.spinDelta(current, index, count, 4, jitter);
        assert.equal(L.segmentAtPointer(end, count), index, `count=${count} index=${index} jitter=${jitter}`);
      }
    }
  }
});

test('ruleta: siempre da al menos las vueltas pedidas', () => {
  for (let i = 0; i < 50; i++) {
    const d = L.spinDelta(i * 37.3, i % 5, 5, 3, 0);
    assert.ok(d >= 3 * 360 && d < 4 * 360);
  }
});

test('tragamonedas: carrete con el ganador en su lugar', () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const first = ['a', 'b', 'c', 'd', 'e'];
  const { items, winnerIndex } = L.buildSlotStrip(names, 'g', 36, first, seeded(3));
  assert.equal(items.length, 36);
  assert.equal(winnerIndex, 33);
  assert.equal(items[winnerIndex], 'g');
  assert.deepEqual(items.slice(0, 5), first);
  assert.equal(winnerIndex + 2, items.length - 1);
  items.forEach((x) => assert.ok(names.includes(x)));
});

test('tragamonedas: vista en reposo', () => {
  assert.equal(L.slotIdleView(['a', 'b', 'c', 'd', 'e', 'f'], 5).length, 5);
  assert.deepEqual(L.slotIdleView(['solo'], 5), ['solo', 'solo', 'solo', 'solo', 'solo']);
  assert.deepEqual(L.slotIdleView([], 3), ['—', '—', '—']);
});

test('initials y hashIndex', () => {
  assert.equal(L.initials('María Duarte'), 'MD');
  assert.equal(L.initials('Ana María de la Cruz'), 'AC');
  assert.equal(L.initials('Pelé'), 'PE');
  assert.equal(L.initials('   '), '?');
  assert.equal(L.hashIndex('Ana', 8), L.hashIndex('Ana', 8));
  assert.ok(L.hashIndex('Ana', 8) < 8);
});

test('cleanPhoto: solo https de servidores de Google, y pide la foto más grande', () => {
  const L = require('../lib.js');
  assert.equal(L.cleanPhoto('https://lh3.googleusercontent.com/a/abc=s32-c'), 'https://lh3.googleusercontent.com/a/abc=s256-c');
  assert.equal(L.cleanPhoto('https://lh3.googleusercontent.com/a/abc'), 'https://lh3.googleusercontent.com/a/abc=s256-c');
  assert.equal(L.cleanPhoto('https://lh3.googleusercontent.com/a/abc=s40-p-k-no-mo'), 'https://lh3.googleusercontent.com/a/abc=s256-c');
  assert.equal(L.cleanPhoto('https://lh3.googleusercontent.com/a/abc=s64-c-mo'), 'https://lh3.googleusercontent.com/a/abc=s256-c');
  assert.equal(L.cleanPhoto('https://lh3.googleusercontent.com/a/abc=w36-h36-p'), 'https://lh3.googleusercontent.com/a/abc=s256-c');
  assert.equal(L.cleanPhoto('https://lh3.googleusercontent.com/-xx/AAAA/s32-c/photo.jpg'), 'https://lh3.googleusercontent.com/-xx/AAAA/s256-c/photo.jpg');
  assert.equal(L.cleanPhoto('https://lh3.googleusercontent.com/a/abc=k-no'), 'https://lh3.googleusercontent.com/a/abc=s256-c');
  assert.equal(L.cleanPhoto('https://lh3.googleusercontent.com/a/ACg8oc_X-y=s40-p-k-no-mo-rj'), 'https://lh3.googleusercontent.com/a/ACg8oc_X-y=s256-c');
  assert.equal(L.cleanPhoto('https://lh3.googleusercontent.com/a/abc=s40-p', false), 'https://lh3.googleusercontent.com/a/abc=s40-p');
  // caso real: parámetros después del tamaño
  assert.equal(L.cleanPhoto('https://lh3.googleusercontent.com/a/ACg8ocJxnQJcey=s32-p-k-no-mo?theming=dark'), 'https://lh3.googleusercontent.com/a/ACg8ocJxnQJcey=s256-c');
  assert.equal(L.cleanPhoto('https://lh3.googleusercontent.com/a/abc=s32-c?x=1&y=2'), 'https://lh3.googleusercontent.com/a/abc=s256-c');
  assert.equal(L.cleanPhoto('https://lh3.googleusercontent.com/a/abc=s32-p-k-no-mo?theming=dark', false), 'https://lh3.googleusercontent.com/a/abc=s32-p-k-no-mo?theming=dark');
  assert.equal(L.cleanPhoto('http://lh3.googleusercontent.com/a/abc'), '');
  assert.equal(L.cleanPhoto('https://evil.example/a.png'), '');
  assert.equal(L.cleanPhoto('https://googleusercontent.com.evil.example/a'), '');
  assert.equal(L.cleanPhoto('data:image/png;base64,AAAA'), '');
  assert.equal(L.cleanPhoto('javascript:alert(1)'), '');
  assert.equal(L.cleanPhoto(null), '');
  assert.equal(L.cleanPhoto('https://lh3.googleusercontent.com/' + 'a'.repeat(700)), '');
});

test('parseParticipants acepta {name, photo} y textos; conserva la foto y no repite', () => {
  const L = require('../lib.js');
  const r = L.parseParticipants([
    { name: 'Ana Gómez', photo: 'https://lh3.googleusercontent.com/a/ana=s32-c' },
    'Luis Benítez',
    { name: 'ana gómez', photo: 'https://lh3.googleusercontent.com/a/otra' },
    { name: 'Eva Ríos', photo: 'https://evil.example/x.png' }
  ]);
  assert.deepEqual(r.map((p) => p.name), ['Ana Gómez', 'Luis Benítez', 'Eva Ríos']);
  assert.equal(r[0].photo, 'https://lh3.googleusercontent.com/a/ana=s256-c');
  assert.equal(r[1].photo, undefined);
  assert.equal(r[2].photo, undefined);
});
