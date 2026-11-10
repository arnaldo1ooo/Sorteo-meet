/* Lógica pura del sorteo. Se usa tanto en la ventana del sorteo como en el
 * script de Meet y en las pruebas de Node (sin tocar el DOM). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SorteoLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Con más personas que esto, la ruleta se cambia por la tragamonedas.
  const WHEEL_MAX = 8;

  const ORDINALS = ['Primer', 'Segundo', 'Tercer', 'Cuarto', 'Quinto', 'Sexto', 'Séptimo', 'Octavo', 'Noveno', 'Décimo'];

  // Nombre por defecto del puesto i (1 = primero).
  function placeName(i) {
    return i >= 1 && i <= ORDINALS.length ? ORDINALS[i - 1] + ' lugar' : i + '.º lugar';
  }

  // Nombres de los n puestos: el personalizado si existe, si no el de por defecto.
  function buildPlaces(count, overrides) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const custom = overrides && typeof overrides[i] === 'string' ? overrides[i].trim() : '';
      out.push(custom || placeName(i + 1));
    }
    return out;
  }

  // Entero al azar en [0, max). Usa crypto.getRandomValues con rechazo para
  // evitar el sesgo del módulo. `rng` (opcional) permite pruebas repetibles.
  function randomInt(max, rng) {
    if (!(max >= 1)) throw new RangeError('max debe ser >= 1');
    max = Math.floor(max);
    if (rng) return Math.min(max - 1, Math.floor(rng() * max));
    const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
    if (!c) return Math.floor(Math.random() * max);
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do { c.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % max;
  }

  // Fisher–Yates. No modifica el arreglo original.
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(i + 1, rng);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // n ganadores distintos, en orden de puesto.
  function pickWinners(pool, n, rng) {
    const k = Math.max(0, Math.min(Math.floor(n) || 0, pool.length));
    return shuffle(pool, rng).slice(0, k);
  }

  function clampWinners(value, max) {
    let n = parseInt(value, 10);
    if (!isFinite(n)) n = 1;
    const m = max >= 1 ? Math.floor(max) : 1;
    return Math.min(Math.max(n, 1), m);
  }

  // ---------- Nombres de participantes ----------

  const SELF_RE = /\s*\((?:t[uú]|you|vos|yo|me)\)\s*$/i;
  const JUNK_RES = [
    /^(tu presentaci[oó]n|your presentation)$/i,
    /^\+?\d+(\s+(m[aá]s|more|others?))?$/i
  ];

  function cleanName(raw) {
    let s = String(raw == null ? '' : raw).replace(/[​-‏⁠﻿]/g, '').replace(/\s+/g, ' ').trim();
    const self = SELF_RE.test(s);
    if (self) s = s.replace(SELF_RE, '').trim();
    return { name: s, self: self };
  }

  function nameKey(name) {
    return String(name).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // Foto de perfil: solo https y solo servidores de Google.
  // big=true además pide la foto más grande (las de Meet vienen en 32–40 px y
  // se ven borrosas). Google guarda el tamaño al final de la URL
  // (=s40-p-k-no-mo, =w36-h36-p, =s32-c, =k-no…) o en el camino (/s32-c/).
  function cleanPhoto(url, big) {
    if (typeof url !== 'string' || url.length > 600) return '';
    let u;
    try { u = new URL(url); } catch (e) { return ''; }
    if (u.protocol !== 'https:') return '';
    if (!/(^|\.)(googleusercontent\.com|ggpht\.com|gstatic\.com)$/i.test(u.hostname)) return '';
    if (big === false) return u.href;
    if (/(^|\.)gstatic\.com$/i.test(u.hostname)) return u.href; // íconos genéricos: no tocar
    // Trabajamos sobre la ruta: la URL puede traer parámetros después del tamaño
    // (p. ej. ...=s32-p-k-no-mo?theming=...), que se descartan.
    const base = u.origin + u.pathname;
    const eq = base.lastIndexOf('=');
    const lastSlash = base.lastIndexOf('/');
    if (eq > lastSlash && /^[a-z0-9-]+$/i.test(base.slice(eq + 1))) {
      return base.slice(0, eq) + '=s256-c';                 // ...=<cualquier tamaño/flags>
    }
    if (/\/s\d+(-[a-z0-9]+)*\/[^/]*$/i.test(base)) {
      return base.replace(/\/s\d+(-[a-z0-9]+)*\/(?=[^/]*$)/i, '/s256-c/'); // /s32-c/foto.jpg
    }
    if (/\/a[-/]/.test(u.pathname)) return base + '=s256-c'; // sin tamaño: se lo agregamos
    return u.href;
  }

  // Convierte lo leído de Meet (textos, o {name, photo}) en [{name, self, photo?}]
  // sin repetidos ni basura.
  function parseParticipants(raws) {
    const seen = new Map();
    const out = [];
    for (const raw of raws || []) {
      const isObj = raw && typeof raw === 'object';
      const c = cleanName(isObj ? raw.name : raw);
      if (!c.name || c.name.length > 80) continue;
      if (JUNK_RES.some(function (re) { return re.test(c.name); })) continue;
      const photo = isObj ? cleanPhoto(raw.photo) : '';
      const photoOrig = isObj ? cleanPhoto(raw.photo, false) : '';
      const key = nameKey(c.name);
      if (seen.has(key)) {
        const prev = seen.get(key);
        if (c.self) prev.self = true;
        if (photo && !prev.photo) { prev.photo = photo; prev.photoOrig = photoOrig; }
        continue;
      }
      const item = { name: c.name, self: c.self };
      if (photo) { item.photo = photo; item.photoOrig = photoOrig; }
      seen.set(key, item);
      out.push(item);
    }
    return out;
  }

  // Quiénes entran al sorteo. `blocked` = los que ya ganaron (solo si noRepeat).
  function computePool(names, unchecked, historyKeys, noRepeat) {
    const off = unchecked instanceof Set ? unchecked : new Set(unchecked || []);
    const hist = historyKeys instanceof Set ? historyKeys : new Set(historyKeys || []);
    const pool = [];
    const blocked = [];
    for (const name of names) {
      if (noRepeat && hist.has(nameKey(name))) { blocked.push(name); continue; }
      if (off.has(name)) continue;
      pool.push(name);
    }
    return { pool: pool, blocked: blocked };
  }

  // ---------- Mensaje para el chat ----------

  // results: [{place, name}]. Cabe en el límite de mensaje de Meet.
  function buildChatMessage(title, results, maxLen) {
    maxLen = maxLen || 480;
    const t = (title || '').trim() || 'Sorteo';
    if (!results || !results.length) return t;
    if (results.length === 1) return '🎉 ' + t + ' ¡Le tocó a ' + results[0].name + '!';
    const head = '🎉 ' + t + ' ';
    const parts = results.map(function (r) { return r.place + ': ' + r.name; });
    let msg = head + parts.join(' · ');
    if (msg.length <= maxLen) return msg;
    let kept = parts.length;
    while (kept > 1) {
      kept--;
      msg = head + parts.slice(0, kept).join(' · ') + ' · …y ' + (parts.length - kept) + ' más';
      if (msg.length <= maxLen) return msg;
    }
    return msg.slice(0, maxLen - 1) + '…';
  }

  // ---------- Matemática de la ruleta (segmentos en sentido horario desde arriba) ----------

  function mod360(x) { return ((x % 360) + 360) % 360; }

  // Cuántos grados hay que sumar a la rotación actual para que el centro del
  // segmento `index` (con un desvío `jitter` en [-1, 1]) quede bajo el puntero.
  function spinDelta(current, index, count, spins, jitter) {
    const seg = 360 / count;
    const target = mod360(-((index + 0.5) * seg) + (jitter || 0) * seg * 0.35);
    return mod360(target - mod360(current)) + spins * 360;
  }

  // Índice del segmento que queda bajo el puntero para una rotación dada.
  function segmentAtPointer(rotation, count) {
    const seg = 360 / count;
    return Math.min(count - 1, Math.floor(mod360(-rotation) / seg));
  }

  // ---------- Tragamonedas ----------

  // 5 nombres para mostrar en reposo.
  function slotIdleView(names, count, rng) {
    if (!names.length) return new Array(count).fill('—');
    const sh = shuffle(names, rng);
    const out = [];
    for (let i = 0; i < count; i++) out.push(sh[i % sh.length]);
    return out;
  }

  // Carrete: arranca con los 5 nombres visibles, sigue con nombres al azar y
  // termina con el ganador en la fila central de la última ventana.
  function buildSlotStrip(names, winner, length, firstVisible, rng) {
    const len = Math.max(length, 8);
    const items = [];
    for (let i = 0; i < 5; i++) {
      items.push(firstVisible && firstVisible[i] != null ? firstVisible[i] : names[randomInt(names.length, rng)]);
    }
    for (let i = 5; i < len; i++) {
      let pick = names[randomInt(names.length, rng)];
      let guard = 0;
      while (names.length > 1 && pick === items[i - 1] && guard++ < 10) pick = names[randomInt(names.length, rng)];
      items.push(pick);
    }
    const winnerIndex = len - 3;
    items[winnerIndex] = winner;
    return { items: items, winnerIndex: winnerIndex };
  }

  // ---------- Presentación ----------

  function initials(name) {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  function hashIndex(str, mod) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % mod;
  }

  return {
    WHEEL_MAX: WHEEL_MAX,
    placeName: placeName,
    buildPlaces: buildPlaces,
    randomInt: randomInt,
    shuffle: shuffle,
    pickWinners: pickWinners,
    clampWinners: clampWinners,
    cleanName: cleanName,
    nameKey: nameKey,
    parseParticipants: parseParticipants,
    cleanPhoto: cleanPhoto,
    computePool: computePool,
    buildChatMessage: buildChatMessage,
    mod360: mod360,
    spinDelta: spinDelta,
    segmentAtPointer: segmentAtPointer,
    slotIdleView: slotIdleView,
    buildSlotStrip: buildSlotStrip,
    initials: initials,
    hashIndex: hashIndex
  };
});
