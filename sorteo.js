'use strict';

(() => {
  const L = window.SorteoLib;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const params = new URLSearchParams(location.search);
  const tabParam = params.get('tab');
  const tabId = tabParam !== null && tabParam !== '' && !isNaN(Number(tabParam)) ? Number(tabParam) : null;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const DEFAULT_TITLE = '¿A quién le toca?';
  const DEFAULTS = {
    title: DEFAULT_TITLE,
    winners: 1,
    placeNames: [],
    noRepeat: false,
    autoAnnounce: false,
    showBarButtonV2: false,
    showMenuItem: true,
    theme: 'auto',
    hideTip: false,
    history: []
  };
  const MAX_WINNERS = 100;
  const MAX_HISTORY = 500;

  const state = {
    settings: { ...DEFAULTS },
    people: [],            // [{ name, self, manual }]
    unchecked: new Set(),  // nombres desmarcados
    drawing: false,
    rotation: 0,           // rotación actual de la ruleta (grados)
    slotView: [],          // los 5 nombres visibles en la tragamonedas
    lastResult: null,      // { title, results: [{ place, name }] }
    lastAdded: []          // nombres que ese sorteo agregó al historial
  };

  // ---------- Almacenamiento ----------

  const hasStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  // ---------- Tema (claro / oscuro) ----------

  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyTheme(mode) {
    const dark = mode === 'dark' || (mode !== 'light' && !!darkQuery && darkQuery.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  async function loadSettings() {
    try {
      if (hasStorage) {
        const r = await chrome.storage.local.get('sorteo');
        return { ...DEFAULTS, ...(r.sorteo || {}) };
      }
    } catch (e) { /* se usan los valores por defecto */ }
    return { ...DEFAULTS };
  }

  async function saveSettings() {
    try {
      if (hasStorage) await chrome.storage.local.set({ sorteo: state.settings });
    } catch (e) { /* sin almacenamiento: los cambios duran hasta cerrar la ventana */ }
  }

  // ---------- Comunicación con Meet ----------

  async function askMeet(msg) {
    if (tabId === null) return { ok: false, error: 'no-tab' };
    try {
      const r = await chrome.tabs.sendMessage(tabId, msg);
      return r || { ok: false, error: 'no-response' };
    } catch (e) {
      return { ok: false, error: 'no-connection' };
    }
  }

  // ---------- Estado visible ----------

  function setStatus(msg, opts) {
    opts = opts || {};
    const el = $('status');
    el.textContent = msg || '';
    el.classList.toggle('error', !!opts.error);
    const a = $('status-action');
    if (opts.action) {
      a.hidden = false;
      a.textContent = opts.action.label;
      a.onclick = opts.action.run;
    } else {
      a.hidden = true;
      a.onclick = null;
    }
  }

  function showView(name) {
    ['main', 'settings', 'result'].forEach((v) => { $('view-' + v).hidden = v !== name; });
    window.scrollTo(0, 0);
  }

  // ---------- Participantes ----------

  function computePool() {
    const hist = new Set(state.settings.history.map(L.nameKey));
    return L.computePool(state.people.map((p) => p.name), state.unchecked, hist, state.settings.noRepeat);
  }

  function renderPeople() {
    const ul = $('people');
    ul.textContent = '';
    const blocked = new Set(computePool().blocked);

    state.people.forEach((p, i) => {
      const li = document.createElement('li');
      const isBlocked = blocked.has(p.name);
      li.className = 'person' + (isBlocked ? ' is-blocked' : '');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'person-' + i;
      cb.checked = !isBlocked && !state.unchecked.has(p.name);
      cb.disabled = isBlocked;
      cb.addEventListener('change', () => {
        if (cb.checked) state.unchecked.delete(p.name); else state.unchecked.add(p.name);
        refreshStage();
      });

      const lb = document.createElement('label');
      lb.htmlFor = cb.id;
      lb.textContent = p.self ? p.name + ' (tú)' : p.name;
      lb.title = lb.textContent;

      li.append(cb, lb);

      if (isBlocked) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = 'Ya ganó';
        li.append(b);
      }
      if (p.manual) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'icon-btn small';
        rm.setAttribute('aria-label', 'Quitar a ' + p.name);
        rm.textContent = '✕';
        rm.addEventListener('click', () => {
          state.people = state.people.filter((x) => x !== p);
          state.unchecked.delete(p.name);
          renderPeople();
          refreshStage();
        });
        li.append(rm);
      }
      ul.append(li);
    });

    $('people-empty').hidden = state.people.length > 0;
  }

  const MEET_ERRORS = {
    'no-tab': 'Abrí el sorteo desde la pestaña de Meet para traer a los participantes automáticamente. Mientras tanto, podés agregarlos a mano.',
    'no-connection': 'No pude conectar con la pestaña de Meet. Recargala (F5) y volvé a abrir el sorteo, o agregá los nombres a mano.',
    'no-response': 'Meet no respondió. Probá de nuevo con «Actualizar».',
    'no-participants': 'No encontré participantes en Meet. Abrí el panel «Personas» y tocá «Actualizar», o agregalos a mano.',
    'exception': 'Hubo un problema al leer Meet. Probá de nuevo o agregá los nombres a mano.'
  };

  async function refreshParticipants() {
    $('btn-refresh').disabled = true;
    setStatus('Leyendo los participantes de Meet…');
    const r = await askMeet({ type: 'sorteo:getParticipants' });
    $('btn-refresh').disabled = false;

    if (r.ok && Array.isArray(r.people)) {
      const manual = state.people.filter((p) => p.manual);
      const fromMeet = r.people.map((p) => ({ name: p.name, self: !!p.self, manual: false, photo: L.cleanPhoto(p.photo), photoOrig: L.cleanPhoto(p.photoOrig || p.photo, false) }));
      const keys = new Set(fromMeet.map((p) => L.nameKey(p.name)));
      state.people = fromMeet.concat(manual.filter((p) => !keys.has(L.nameKey(p.name))));
      setStatus('Se cargaron ' + fromMeet.length + ' participantes de Meet.');
    } else {
      setStatus(MEET_ERRORS[r.error] || MEET_ERRORS.exception, { error: true });
    }
    renderPeople();
    refreshStage();
  }

  function addManual(name) {
    const c = L.cleanName(name);
    if (!c.name) return;
    if (state.people.some((p) => L.nameKey(p.name) === L.nameKey(c.name))) {
      setStatus(c.name + ' ya está en la lista.');
      return;
    }
    state.people.push({ name: c.name, self: false, manual: true });
    state.unchecked.delete(c.name);
    renderPeople();
    refreshStage();
    setStatus('');
  }

  // ---------- Escenario (ruleta / tragamonedas) ----------

  const PALETTE = ['#6d28d9', '#1d4ed8', '#db2777', '#0f766e', '#a21caf', '#c2410c', '#0369a1', '#15803d'];
  const AVATAR_COLORS = ['#3c5a8a', '#7a4a6b', '#2f7a5f', '#8a5a2b', '#4a5aa8', '#0f766e', '#a21caf', '#c2410c'];
  const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }

  function drawWheel(names, rotationDeg) {
    const canvas = $('wheel');
    const size = 300;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(size * dpr);
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const c = size / 2;
    const r = c - 8;
    const n = names.length;

    if (!n) {
      ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fillStyle = '#e5e7eb'; ctx.fill();
      ctx.lineWidth = 6; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      ctx.fillStyle = '#4b5563'; ctx.font = '700 15px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Sin participantes', c, c);
      return;
    }

    const seg = (Math.PI * 2) / n;
    const rot = (rotationDeg * Math.PI) / 180;

    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + rot + i * seg;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, r, a0, a0 + seg);
      ctx.closePath();
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.fill();
    }

    ctx.font = '700 ' + (n <= 4 ? 16 : 13) + 'px ' + FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < n; i++) {
      const mid = -Math.PI / 2 + rot + i * seg + seg / 2;
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(mid);
      ctx.fillText(fitText(ctx, names[i], r - 14 - 36), r - 14, 0);
      ctx.restore();
    }

    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();

    if (n > 1) {
      ctx.fillStyle = '#fde68a';
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + rot + i * seg;
        ctx.beginPath(); ctx.arc(c + r * Math.cos(a), c + r * Math.sin(a), 4.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    ctx.beginPath(); ctx.arc(c, c, 28, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.beginPath(); ctx.arc(c, c, 10, 0, Math.PI * 2); ctx.fillStyle = '#6d28d9'; ctx.fill();
  }

  function animateWheel(names, index, duration, spins) {
    return new Promise((resolve) => {
      const start = state.rotation;
      const jitter = (L.randomInt(2001) - 1000) / 1000;
      const delta = L.spinDelta(start, index, names.length, spins, jitter);
      const t0 = performance.now();
      function frame(now) {
        const t = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - t, 4);
        state.rotation = start + delta * eased;
        drawWheel(names, state.rotation);
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          state.rotation = L.mod360(start + delta);
          drawWheel(names, state.rotation);
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  const ROW_H = 52;

  function renderStrip(items) {
    const strip = $('slot-strip');
    strip.textContent = '';
    items.forEach((t) => {
      const d = document.createElement('div');
      d.className = 'slot-item';
      d.textContent = t;
      strip.append(d);
    });
  }

  function setStripRow(rows, animate, ms) {
    const s = $('slot-strip');
    s.style.transition = animate ? 'transform ' + ms + 'ms cubic-bezier(0.15, 0.75, 0.12, 1)' : 'none';
    s.style.transform = 'translateY(' + (-rows * ROW_H) + 'px)';
  }

  function renderSlotIdle(pool) {
    state.slotView = L.slotIdleView(pool, 5);
    renderStrip(state.slotView);
    setStripRow(0, false);
  }

  async function animateSlot(names, winner, duration) {
    const strip = $('slot-strip');
    const built = L.buildSlotStrip(names, winner, 36, state.slotView);
    renderStrip(built.items);
    setStripRow(0, false);
    strip.getBoundingClientRect(); // fuerza el reflujo antes de animar
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        strip.removeEventListener('transitionend', onEnd);
        resolve();
      };
      const onEnd = (e) => { if (e.target === strip) finish(); };
      strip.addEventListener('transitionend', onEnd);
      setStripRow(built.winnerIndex - 2, true, duration);
      setTimeout(finish, duration + 400);
    });
    state.slotView = built.items.slice(built.winnerIndex - 2, built.winnerIndex + 3);
  }

  function useSlot(pool) {
    return pool.length > L.WHEEL_MAX;
  }

  function refreshStage() {
    const { pool } = computePool();
    const slot = useSlot(pool);
    $('wheel-box').hidden = slot;
    $('slot-box').hidden = !slot;
    $('btn-spin').textContent = slot ? 'Tirar de la palanca' : 'Girar la ruleta';
    $('people-count').textContent = pool.length === 1 ? '1 persona en el sorteo' : pool.length + ' personas en el sorteo';

    if (slot) renderSlotIdle(pool); else drawWheel(pool, state.rotation);

    $('winners').value = String(state.settings.winners);
    $('winners-max').textContent = 'de ' + pool.length + (pool.length === 1 ? ' persona' : ' personas');
    $('btn-spin').disabled = state.drawing || pool.length === 0;
  }

  // ---------- Sorteo ----------

  function showProgress(placeLabel, revealed) {
    $('progress').hidden = false;
    $('progress-now').textContent = placeLabel ? 'Sorteando: ' + placeLabel : '';
    const ol = $('progress-list');
    ol.textContent = '';
    revealed.forEach((r) => {
      const li = document.createElement('li');
      li.textContent = r.place + ': ' + r.name;
      ol.append(li);
    });
  }

  function clearHistory() {
    state.settings.history = [];
    saveSettings();
    renderPeople();
    refreshStage();
  }

  async function runDraw() {
    if (state.drawing) return;
    setStatus('');
    const { pool, blocked } = computePool();
    const n = state.settings.winners;

    if (!pool.length) {
      if (blocked.length) {
        setStatus('Ya ganaron todos los participantes.', {
          error: true,
          action: { label: 'Borrar historial', run: () => { clearHistory(); setStatus('Historial borrado.'); } }
        });
      } else {
        setStatus('No hay participantes para sortear.', { error: true });
      }
      return;
    }
    if (n > pool.length) {
      setStatus('Pediste ' + n + ' ganadores pero solo hay ' + pool.length + ' ' + (pool.length === 1 ? 'persona disponible.' : 'personas disponibles.'), {
        error: true,
        action: { label: 'Usar ' + pool.length, run: () => { setWinners(pool.length); setStatus(''); } }
      });
      return;
    }

    state.drawing = true;
    $('controls').inert = true;
    $('btn-spin').textContent = 'Sorteando…';
    $('btn-spin').disabled = true;

    const places = L.buildPlaces(n, state.settings.placeNames);
    const winners = L.pickWinners(pool, n);   // el azar se decide acá, con crypto
    const slot = useSlot(pool);
    const revealed = [];

    try {
      for (let i = 0; i < n; i++) {
        const remaining = pool.filter((x) => !winners.slice(0, i).includes(x));
        showProgress(places[i], revealed);
        const duration = reduceMotion ? 400 : (i === 0 ? 4200 : 2800);

        if (slot) {
          $('lever').classList.add('pulled');
          setTimeout(() => $('lever').classList.remove('pulled'), 500);
          await animateSlot(remaining, winners[i], duration);
        } else {
          drawWheel(remaining, state.rotation);
          await sleep(reduceMotion ? 50 : 250);
          await animateWheel(remaining, remaining.indexOf(winners[i]), duration, i === 0 ? 5 : 3);
        }
        revealed.push({ place: places[i], name: winners[i] });
        showProgress(i + 1 < n ? places[i + 1] : '', revealed);
        await sleep(reduceMotion ? 150 : 900);
      }
    } finally {
      state.drawing = false;
      $('controls').inert = false;
    }

    // Guardar en el historial (solo los que no estaban).
    const known = new Set(state.settings.history.map(L.nameKey));
    state.lastAdded = winners.filter((w) => !known.has(L.nameKey(w)));
    state.settings.history = state.settings.history.concat(state.lastAdded).slice(-MAX_HISTORY);
    saveSettings();

    state.lastResult = { title: state.settings.title, results: revealed, announced: false };
    setAnnounceLocked(false);
    $('progress').hidden = true;
    renderResult();
    showView('result');
    launchConfetti();
    if (state.settings.autoAnnounce) announce(true);
  }

  // ---------- Resultado ----------

  function avatar(name) {
    const d = document.createElement('div');
    d.className = 'avatar';
    d.setAttribute('aria-hidden', 'true');
    const initials = L.initials(name);
    d.textContent = initials;
    d.style.background = AVATAR_COLORS[L.hashIndex(name, AVATAR_COLORS.length)];
    const person = state.people.find((p) => L.nameKey(p.name) === L.nameKey(name));
    const photo = person && L.cleanPhoto(person.photo);
    if (photo) {
      // Con foto se ve la foto; si no carga, quedan las iniciales.
      const img = document.createElement('img');
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('load', () => {
        d.textContent = ''; d.appendChild(img);
        // Diagnóstico: al pasar el mouse se ve el tamaño real de la foto y el final de la dirección.
        const tail = img.src.length > 28 ? '…' + img.src.slice(-28) : img.src;
        d.title = 'Foto cargada: ' + img.naturalWidth + '×' + img.naturalHeight + ' px · ' + tail;
        if (img.naturalWidth && img.naturalWidth < 120) d.classList.add('lowres');
      });
      img.addEventListener('error', () => {
        // Si el servidor no acepta el tamaño grande, probamos con la foto original.
        const orig = person && L.cleanPhoto(person.photoOrig, false);
        if (orig && img.src !== orig && !img.dataset.retried) { img.dataset.retried = '1'; img.src = orig; }
        /* si tampoco carga, se quedan las iniciales */
      });
      img.src = photo;
    }
    return d;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderResult() {
    const { title, results } = state.lastResult;
    $('result-title').textContent = title;
    const body = $('result-body');
    body.textContent = '';
    $('result-status').textContent = '';
    $('result-status').classList.remove('error');

    if (results.length === 1) {
      const box = el('div', 'result-single');
      box.append(avatar(results[0].name), el('div', 'big-name', results[0].name), el('div', 'place', 'es la persona elegida'));
      body.append(box);
    } else if (results.length <= 3) {
      results.forEach((r, i) => {
        const col = el('div', 'podium-col podium-' + (i + 1));
        col.append(avatar(r.name), el('div', 'name', r.name), el('div', 'place', r.place), el('div', 'step', String(i + 1)));
        body.append(col);
      });
    } else {
      const ol = el('ol', 'result-list');
      results.forEach((r, i) => {
        const li = el('li');
        li.append(el('span', 'pos', String(i + 1)), avatar(r.name), el('span', 'who', r.name), el('span', 'place', r.place));
        ol.append(li);
      });
      body.append(ol);
    }
    $('chat-preview').textContent = 'Mensaje del chat: ' + L.buildChatMessage(title, results);
  }

  const CHAT_ERRORS = {
    'no-tab': 'Esta ventana no está conectada a una reunión de Meet.',
    'no-connection': 'No pude conectar con la pestaña de Meet.',
    'no-chat-button': 'No encontré el botón del chat en Meet.',
    'no-chat-input': 'No pude abrir el cuadro del chat.',
    'not-sent': 'Meet no confirmó el envío.'
  };

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.append(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  // Bloquea el botón una vez anunciado, para no escribir el resultado dos veces.
  function setAnnounceLocked(locked) {
    const b = $('btn-announce');
    b.disabled = locked;
    b.textContent = locked ? 'Anunciado ✓' : 'Anunciar en el chat';
  }

  let announcing = false;

  async function announce(auto) {
    if (!state.lastResult || state.lastResult.announced || announcing) return;
    announcing = true;
    const out = $('result-status');
    const text = L.buildChatMessage(state.lastResult.title, state.lastResult.results);
    out.classList.remove('error');
    out.textContent = 'Escribiendo en el chat…';
    $('btn-announce').disabled = true;

    const result = state.lastResult;
    const r = await askMeet({ type: 'sorteo:sendChat', text: text });
    announcing = false;

    if (r.ok) {
      result.announced = true;
      if (state.lastResult === result) setAnnounceLocked(true);
      out.textContent = 'Anunciado en el chat de la reunión.';
      return;
    }
    if (state.lastResult === result) setAnnounceLocked(false);
    const copied = await copyText(text);
    out.classList.add('error');
    out.textContent = (CHAT_ERRORS[r.error] || 'No pude escribir en el chat.') + ' (código: ' + (r.error || 'desconocido') + (r.detail ? ' · ' + r.detail : '') + ')' +
      (copied ? ' Copié el mensaje: pegalo en el chat con Ctrl+V.' : ' Copialo y pegalo a mano.');
  }

  // ---------- Confeti ----------

  function launchConfetti() {
    if (reduceMotion) return;
    const canvas = $('confetti');
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = ['#f59e0b', '#ec4899', '#14b8a6', '#3b82f6', '#a78bfa'];
    const parts = Array.from({ length: 140 }, (_, i) => ({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.6,
      w: 6 + Math.random() * 6,
      h: 10 + Math.random() * 10,
      vx: -1.5 + Math.random() * 3,
      vy: 2 + Math.random() * 3.5,
      rot: Math.random() * 6.28,
      vr: -0.2 + Math.random() * 0.4,
      color: colors[i % colors.length],
      round: Math.random() < 0.25
    }));
    const t0 = performance.now();
    function frame(now) {
      ctx.clearRect(0, 0, w, h);
      if (now - t0 > 3400) return;
      parts.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 6.28); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---------- Cantidad de ganadores ----------

  function setWinners(n) {
    const { pool } = computePool();
    state.settings.winners = L.clampWinners(n, Math.max(1, pool.length));
    saveSettings();
    $('winners').value = String(state.settings.winners);
  }

  // ---------- Configuración ----------

  function collectPlaceInputs() {
    return Array.from($('place-names').querySelectorAll('input')).map((i) => i.value);
  }

  function renderPlaceInputs(count, values) {
    const box = $('place-names');
    box.textContent = '';
    for (let i = 1; i <= count; i++) {
      const wrap = document.createElement('div');
      const id = 'place-' + i;
      const lb = document.createElement('label');
      lb.htmlFor = id;
      lb.textContent = 'Puesto ' + i;
      const input = document.createElement('input');
      input.type = 'text';
      input.id = id;
      input.maxLength = 40;
      input.value = values[i - 1] != null && values[i - 1] !== '' ? values[i - 1] : L.placeName(i);
      wrap.append(lb, input);
      box.append(wrap);
    }
  }

  function settingsWinnersValue() {
    return L.clampWinners($('set-winners').value, MAX_WINNERS);
  }

  function openSettings() {
    const s = state.settings;
    $('set-title').value = s.title;
    $('set-winners').value = String(s.winners);
    renderPlaceInputs(s.winners, s.placeNames);
    $('set-norepeat').checked = s.noRepeat;
    $('set-announce').checked = s.autoAnnounce;
    $('set-barbutton').checked = s.showBarButtonV2 === true;
    $('set-menuitem').checked = s.showMenuItem !== false;
    $('set-theme').value = ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto';
    $('settings-status').textContent = '';
    resetClearButton();
    showView('settings');
    $('set-title').focus();
  }

  function onSettingsWinnersChange(n) {
    const values = collectPlaceInputs();
    $('set-winners').value = String(n);
    renderPlaceInputs(n, values);
  }

  function saveSettingsForm() {
    const n = settingsWinnersValue();
    const places = collectPlaceInputs().map((v, i) => {
      const t = v.trim();
      return t === L.placeName(i + 1) ? '' : t;
    });
    state.settings.title = $('set-title').value.trim() || DEFAULT_TITLE;
    state.settings.winners = n;
    state.settings.placeNames = places;
    state.settings.noRepeat = $('set-norepeat').checked;
    state.settings.autoAnnounce = $('set-announce').checked;
    state.settings.showBarButtonV2 = $('set-barbutton').checked;
    state.settings.showMenuItem = $('set-menuitem').checked;
    state.settings.theme = $('set-theme').value;
    saveSettings();
    applyTitle();
    renderPeople();
    refreshStage();
    showView('main');
  }

  let clearArmed = false;
  let clearTimer = null;
  function resetClearButton() {
    clearArmed = false;
    clearTimeout(clearTimer);
    $('btn-clear-history').textContent = 'Borrar historial';
  }

  function applyTitle() {
    $('title').textContent = state.settings.title;
    document.title = 'Sorteo';
  }

  // ---------- Eventos ----------

  function bind() {
    $('btn-settings').addEventListener('click', openSettings);
    const leaveSettings = () => { applyTheme(state.settings.theme); showView('main'); };
    $('set-theme').addEventListener('change', () => applyTheme($('set-theme').value)); // vista previa en vivo
    $('btn-settings-back').addEventListener('click', leaveSettings);
    $('btn-settings-cancel').addEventListener('click', leaveSettings);
    $('btn-settings-save').addEventListener('click', saveSettingsForm);

    $('title-chips').addEventListener('click', (e) => {
      if (e.target instanceof HTMLButtonElement) {
        $('set-title').value = e.target.textContent;
        $('set-title').focus();
      }
    });

    $('sw-minus').addEventListener('click', () => onSettingsWinnersChange(L.clampWinners(settingsWinnersValue() - 1, MAX_WINNERS)));
    $('sw-plus').addEventListener('click', () => onSettingsWinnersChange(L.clampWinners(settingsWinnersValue() + 1, MAX_WINNERS)));
    $('set-winners').addEventListener('change', () => onSettingsWinnersChange(settingsWinnersValue()));

    $('btn-clear-history').addEventListener('click', () => {
      if (!clearArmed) {
        clearArmed = true;
        $('btn-clear-history').textContent = '¿Seguro? Tocá otra vez';
        clearTimer = setTimeout(resetClearButton, 3500);
        return;
      }
      resetClearButton();
      clearHistory();
      $('settings-status').textContent = 'Historial borrado.';
    });

    $('tip-close').addEventListener('click', () => {
      $('tip').hidden = true;
      state.settings.hideTip = true;
      saveSettings();
    });

    $('btn-refresh').addEventListener('click', refreshParticipants);
    $('manual-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('manual-name');
      addManual(input.value);
      input.value = '';
      input.focus();
    });

    $('w-minus').addEventListener('click', () => setWinners(state.settings.winners - 1));
    $('w-plus').addEventListener('click', () => setWinners(state.settings.winners + 1));
    $('winners').addEventListener('change', () => setWinners($('winners').value));

    $('btn-spin').addEventListener('click', runDraw);

    $('btn-announce').addEventListener('click', () => announce(false));
    $('btn-again').addEventListener('click', () => {
      // Repetir el sorteo no debe contar el resultado anterior como "ya ganó".
      const undo = new Set(state.lastAdded.map(L.nameKey));
      state.settings.history = state.settings.history.filter((n) => !undo.has(L.nameKey(n)));
      state.lastAdded = [];
      saveSettings();
      renderPeople();
      refreshStage();
      showView('main');
      runDraw();
    });
    $('btn-back').addEventListener('click', () => {
      renderPeople();
      refreshStage();
      showView('main');
    });
  }

  async function init() {
    state.settings = await loadSettings();
    state.settings.winners = L.clampWinners(state.settings.winners, MAX_WINNERS);
    applyTheme(state.settings.theme);
    if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => applyTheme(state.settings.theme));
    bind();
    applyTitle();
    $('tip').hidden = !!state.settings.hideTip;
    renderPeople();
    refreshStage();
    await refreshParticipants();
  }

  init();
})();
