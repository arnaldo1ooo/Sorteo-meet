'use strict';

/* Script que corre dentro de Google Meet. Hace solo dos cosas, y solo cuando
 * la ventana del sorteo se lo pide:
 *   1. leer quiénes están en la reunión;
 *   2. escribir el resultado en el chat.
 * Meet cambia su HTML seguido, así que los selectores son "de mejor esfuerzo".
 * Si algo falla, la ventana del sorteo ofrece alternativas (agregar a mano,
 * copiar el mensaje). Todos los selectores están en este archivo. */
(() => {
  if (window.__sorteoMeetLoaded) return;
  window.__sorteoMeetLoaded = true;

  const L = self.SorteoLib;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeout, step) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > timeout) return null;
      await sleep(step || 100);
    }
  }

  const label = (el) => (el.getAttribute('aria-label') || '').trim();
  const visible = (el) => !!el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);

  // ---------- Participantes ----------

  const PEOPLE_LIST_LABEL = /(participantes|participants|personas|people|en la llamada|in the call|in this call)/i;
  const PEOPLE_BUTTON_LABEL = /^(mostrar a todos|show everyone|personas|people|participantes|participants|ver a todos)/i;
  // Textos de botones/estados que aparecen dentro de los mosaicos y no son nombres.
  const TILE_JUNK = /(silenciar|mute|fijar|pin\b|desfijar|unpin|quitar|remove|m[aá]s opciones|more options|micr[oó]fono|microphone|c[aá]mara|camera|reacci|reaction|presentando|presenting|hablando|speaking|levant|raised|anfitri[oó]n|host|copropiet|co-host|abrir|open|cerrar|close)/i;

  // Meet dibuja sus íconos con texto (p. ej. «keep_outline», «frame_person»)
  // en una fuente de íconos: no son nombres de personas.
  function isIconText(el, t) {
    if (/^[a-z]+(_[a-z0-9]+)+$/.test(t)) return true; // snake_case de ligaduras
    if (el.getAttribute('aria-hidden') === 'true') return true;
    try {
      const ff = getComputedStyle(el).fontFamily || '';
      if (/material|symbols|icons/i.test(ff)) return true;
    } catch (e) { /* sin estilos: seguimos */ }
    return /(^|\s)(google-symbols|material-icons[\w-]*|material-symbols[\w-]*|notranslate\s+google-symbols)(\s|$)/.test(el.className && el.className.baseVal === undefined ? String(el.className) : '');
  }

  // Un nombre es corto y no parece una frase o un aviso de Meet
  // (p. ej. «Otras personas aún podrían ver tu video completo.»).
  const NOT_NAME = /(otras personas|podr[ií]an ver|ver tu video|video completo|other people|can still see|your full video|est[aá]s presentando|you're presenting|you are presenting|tu presentaci[oó]n|your presentation|anotaci|annotat|visible para todos|visible to everyone|probar |try )/i;
  function looksLikeName(t) {
    if (!t || t.length > 50) return false;
    if (/[.!?:]$/.test(t)) return false;
    if (t.split(/\s+/).length > 6) return false;
    return !NOT_NAME.test(t);
  }

  function leafTexts(root) {
    const out = [];
    root.querySelectorAll('*').forEach((el) => {
      if (el.children.length === 0) {
        const t = (el.textContent || '').trim();
        if (t.length >= 1 && t.length <= 60 && !isIconText(el, t) && looksLikeName(t)) out.push(t);
      }
    });
    return out;
  }

  // Primera foto de perfil (imagen https) dentro de un elemento, si hay.
  function photoOf(root) {
    for (const img of root.querySelectorAll('img[src^="https://"]')) {
      if (img.naturalWidth > 0 && img.naturalWidth < 12) continue; // íconos diminutos
      return img.src;
    }
    return '';
  }

  // Panel «Personas»: lista con elementos que traen el nombre en aria-label.
  function readFromPanel() {
    let best = [];
    document.querySelectorAll('[role="list"]').forEach((list) => {
      if (!PEOPLE_LIST_LABEL.test(label(list))) return;
      const names = [];
      list.querySelectorAll('[role="listitem"]').forEach((li) => {
        const n = label(li) || leafTexts(li)[0];
        if (n) names.push({ name: n, photo: photoOf(li) });
      });
      if (names.length > best.length) best = names;
    });
    return best;
  }

  // Respaldo: nombres visibles en los mosaicos de video.
  function readFromTiles() {
    const names = [];
    document.querySelectorAll('[data-participant-id]').forEach((tile) => {
      const candidates = leafTexts(tile).filter((t) => !TILE_JUNK.test(t) && !/^\d+$/.test(t));
      if (candidates.length) names.push({ name: candidates[0], photo: photoOf(tile) });
    });
    return names;
  }

  function findButton(selectors, labelRe) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    const all = document.querySelectorAll('button[aria-label], [role="button"][aria-label]');
    for (const el of all) if (labelRe.test(label(el))) return el;
    return null;
  }

  const findPeopleButton = () => findButton(['button[data-panel-id="1"]'], PEOPLE_BUTTON_LABEL);

  async function readParticipants() {
    let raw = readFromPanel();
    let source = raw.length ? 'panel' : '';
    let toggled = null;

    // Si el panel está cerrado, lo abrimos un momento para leerlo y lo cerramos.
    if (!raw.length) {
      const btn = findPeopleButton();
      if (btn) {
        btn.click();
        toggled = btn;
        raw = (await waitFor(() => { const r = readFromPanel(); return r.length ? r : null; }, 2500)) || [];
        if (raw.length) source = 'panel';
      }
    }
    if (toggled) {
      await sleep(150);
      (findPeopleButton() || toggled).click();
    }

    if (!raw.length) {
      raw = readFromTiles();
      source = raw.length ? 'tiles' : '';
    }

    const people = L.parseParticipants(raw);
    if (!people.length) return { ok: false, error: 'no-participants' };
    return { ok: true, people: people, source: source };
  }

  // ---------- Chat ----------

  const CHAT_BUTTON_LABEL = /(chat con todos|chatear|chat with everyone|chat|mensajes en la llamada|messages in the call)/i;
  const CHAT_INPUT_LABEL = /(enviar un mensaje|send a message|mensaje|message)/i;
  const SEND_LABEL = /(enviar|send)/i;

  const findChatButton = () => findButton(['button[data-panel-id="2"]'], CHAT_BUTTON_LABEL);

  const INPUT_SEL = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], input[type="text"]';
  const NOT_CHAT_INPUT = /(buscar|search|a[ñn]adir|agregar|add people|invitar)/i;

  // Busca también dentro de shadow DOM abiertos e iframes del mismo origen.
  function deepAll(sel, root, depth) {
    root = root || document; depth = depth || 0;
    let out = [...root.querySelectorAll(sel)];
    if (depth > 4) return out;
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) out = out.concat(deepAll(sel, el.shadowRoot, depth + 1));
      if (el.tagName === 'IFRAME') {
        try { if (el.contentDocument) out = out.concat(deepAll(sel, el.contentDocument, depth + 1)); } catch (e) { /* otro origen */ }
      }
    });
    return out;
  }

  function chatInputs() {
    return deepAll(INPUT_SEL).filter((el) =>
      visible(el) && !el.closest('#' + 'sorteo-bar-host') && !NOT_CHAT_INPUT.test(label(el) + ' ' + (el.placeholder || '')));
  }

  function findChatInput() {
    const all = chatInputs();
    for (const el of all) {
      if (CHAT_INPUT_LABEL.test(label(el) + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('data-placeholder') || '')) || /chat/i.test(el.name || '')) return el;
    }
    // Respaldo: si hay un único cuadro de texto visible, es el del chat.
    return all.length === 1 ? all[0] : null;
  }

  const isEditable = (el) => el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT';
  const readValue = (el) => (isEditable(el) ? el.textContent : el.value) || '';

  function writeValue(el, value) {
    el.focus();
    if (!isEditable(el)) { setNativeValue(el, value); return; }
    try {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, value);
    } catch (e) { /* sin execCommand */ }
    if (!readValue(el)) { el.textContent = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  // Para diagnosticar cuando no se encuentra el chat.
  function chatDiagnostic() {
    const btns = [...document.querySelectorAll('button[aria-label], [role="button"][aria-label]')]
      .map(label).filter((l) => /chat|mensaj|message/i.test(l)).slice(0, 4);
    const frames = [...document.querySelectorAll('iframe')].map((f) => { try { return new URL(f.src, location.href).hostname || 'sin-src'; } catch (e) { return 'sin-src'; } }).slice(0, 4);
    const inputs = deepAll(INPUT_SEL).map((e) =>
      e.tagName.toLowerCase() + (visible(e) ? '' : '(oculto)') + '[' + (label(e) || e.placeholder || '').slice(0, 30) + ']').slice(0, 6);
    return 'botones: ' + (btns.join(' | ') || 'ninguno') + ' · campos: ' + (inputs.join(', ') || 'ninguno') + ' · iframes: ' + (frames.join(', ') || 'ninguno');
  }

  function findSendButton(input) {
    let node = input.parentElement;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      for (const b of node.querySelectorAll('button[aria-label]')) {
        if (SEND_LABEL.test(label(b))) return b;
      }
    }
    return null;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // El editor del chat vive en un iframe de chat.google.com: no se puede tocar
  // desde acá, así que le mandamos el texto a chat-frame.js con postMessage.
  const CHAT_ORIGIN = 'https://chat.google.com';
  const chatFrames = () => deepAll('iframe').filter((f) => {
    try { return visible(f) && new URL(f.src, location.href).origin === CHAT_ORIGIN; } catch (e) { return false; }
  });

  function sendViaFrame(text, timeout) {
    const frames = chatFrames();
    if (!frames.length) return Promise.resolve(null);
    const id = 'sorteo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    return new Promise((resolve) => {
      let done = (v) => { window.removeEventListener('message', onMsg); clearTimeout(timer); resolve(v); };
      const onMsg = (e) => {
        if (e.origin !== CHAT_ORIGIN || !e.data || e.data.type !== 'sorteo:chat-result' || e.data.id !== id) return;
        done(e.data.ok ? { ok: true } : { ok: false, error: e.data.error || 'not-sent' });
      };
      const timer = setTimeout(() => done(null), timeout);
      window.addEventListener('message', onMsg);
      // El marco puede estar todavía cargando: reintentamos hasta que conteste
      // (el marco ignora los repetidos por id, así que no se envía dos veces).
      const post = () => chatFrames().forEach((f) => { try { f.contentWindow.postMessage({ type: 'sorteo:chat-write', id: id, text: text }, CHAT_ORIGIN); } catch (e) { /* ignorar */ } });
      post();
      const retry = setInterval(post, 500);
      const stop = () => clearInterval(retry);
      const origDone = done;
      done = (v) => { stop(); origDone(v); };
    });
  }

  async function sendChat(text) {
    if (!text) return { ok: false, error: 'empty' };
    let input = findChatInput();
    let toggled = null;

    // Panel ya abierto con el chat en su marco: se escribe por ahí, sin tocar nada.
    if (!input && chatFrames().length) {
      const r = await sendViaFrame(text, 6000);
      if (r) return r;
    }

    if (!input) {
      const btn = findChatButton();
      if (!btn) return { ok: false, error: 'no-chat-button', detail: chatDiagnostic() };
      btn.click();
      toggled = btn;
      input = await waitFor(() => findChatInput() || (chatFrames().length ? 'frame' : null), 3000);
      if (input === 'frame' || !input) {
        input = null;
        const r = await sendViaFrame(text, 6000);
        if (r && r.ok) return r; // el chat queda abierto
        // Dejamos el chat abierto: así podés pegar el mensaje a mano.
        return r ? r : { ok: false, error: 'no-chat-input', detail: chatDiagnostic() };
      }
    }

    writeValue(input, text);

    // Esperamos a que Meet habilite el botón de enviar (se activa al escribir).
    const enabled = (b) => b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
    const send = await waitFor(() => { const b = findSendButton(input); return enabled(b) ? b : null; }, 2000, 100);
    if (send) {
      send.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
    let sent = !!(await waitFor(() => readValue(input) === '', 1500, 100));
    if (!sent) {
      // Segundo intento: Enter directo en el cuadro.
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      sent = !!(await waitFor(() => readValue(input) === '', 1500, 100));
    }
    // El chat queda abierto: así se ve que el mensaje salió.
    return sent ? { ok: true } : { ok: false, error: 'not-sent' };
  }

  // ---------- Botón «Sorteo» en la barra de Meet ----------

  // Dónde insertarlo: justo después de «Presentar ahora»; si no está, antes de
  // «Levantar la mano»; y como último recurso antes de «Salir de la llamada».
  const BAR_ANCHORS = [
    { re: /^(presentar ahora|present now|compartir pantalla|share screen)/i, where: 'after' },
    { re: /(levantar la mano|raise hand)/i, where: 'before' },
    { re: /^(salir de la llamada|leave call|abandonar)/i, where: 'before' }
  ];
  const BAR_HOST_ID = 'sorteo-bar-host';
  const BAR_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"></rect><circle cx="9" cy="9" r="1" fill="#ffffff"></circle><circle cx="15" cy="9" r="1" fill="#ffffff"></circle><circle cx="12" cy="12" r="1" fill="#ffffff"></circle><circle cx="9" cy="15" r="1" fill="#ffffff"></circle><circle cx="15" cy="15" r="1" fill="#ffffff"></circle></svg>';

  let barHost = null;
  let barEnabled = true;

  function buildBarButton() {
    const host = document.createElement('div');
    host.id = BAR_HOST_ID;
    host.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex:none;position:relative;margin:0 6px;';
    // Shadow DOM: los estilos de Meet no afectan al botón ni al revés.
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      'button{width:48px;height:48px;border:none;border-radius:50%;background:#6d28d9;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}' +
      'button:hover{background:#5b21b6}' +
      'button:focus-visible{outline:3px solid #a78bfa;outline-offset:2px}' +
      '.tip{position:absolute;left:50%;bottom:58px;transform:translateX(-50%);background:#e8eaed;color:#202124;' +
      'font:600 13px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;padding:6px 12px;border-radius:6px;white-space:nowrap;' +
      'opacity:0;pointer-events:none;transition:opacity .12s;z-index:9999}' +
      'button:hover+.tip,button:focus-visible+.tip{opacity:1}' +
      '</style>' +
      '<button type="button" aria-label="Sorteo">' + BAR_ICON + '</button>' +
      '<span class="tip" role="tooltip">Sorteo</span>';
    const btn = root.querySelector('button');
    const tip = root.querySelector('.tip');
    btn.addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({ type: 'sorteo:open' });
      } catch (e) {
        // La extensión se actualizó o recargó: este script quedó huérfano.
        tip.textContent = 'Recargá la pestaña de Meet';
        tip.style.opacity = '1';
        setTimeout(() => { tip.style.opacity = ''; tip.textContent = 'Sorteo'; }, 3000);
      }
    });
    return host;
  }

  // El «elemento» de un control es el ancestro más alto que contiene solo ese botón.
  function itemOf(btn) {
    let it = btn;
    while (it.parentElement && it.parentElement !== document.body && it.parentElement.querySelectorAll('button').length === 1) {
      it = it.parentElement;
    }
    return it;
  }

  function findByLabel(re) {
    for (const el of document.querySelectorAll('button[aria-label]')) {
      if (re.test(label(el))) return el;
    }
    return null;
  }

  function removeBarButton() {
    if (barHost) barHost.remove();
  }

  function ensureBarButton() {
    if (!barEnabled) { removeBarButton(); return; }
    if (barHost && barHost.isConnected) return;
    for (const anchor of BAR_ANCHORS) {
      const btn = findByLabel(anchor.re);
      if (!btn) continue;
      const item = itemOf(btn);
      const parent = item.parentElement;
      if (!parent) continue;
      if (!barHost) barHost = buildBarButton();
      parent.insertBefore(barHost, anchor.where === 'after' ? item.nextSibling : item);
      return;
    }
  }

  async function loadBarPref() {
    try {
      const r = await chrome.storage.local.get('sorteo');
      barEnabled = !(r && r.sorteo && r.sorteo.showBarButton === false);
    } catch (e) { /* sin almacenamiento: queda activado */ }
  }

  function startBarButton() {
    loadBarPref().then(ensureBarButton);
    // Meet vuelve a dibujar su barra a menudo: revisamos (como mucho 2 veces por segundo).
    let timer = null;
    new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; ensureBarButton(); }, 400);
    }).observe(document.body, { childList: true, subtree: true });
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.sorteo) return;
        const v = changes.sorteo.newValue;
        barEnabled = !(v && v.showBarButton === false);
        ensureBarButton();
      });
    } catch (e) { /* sin onChanged */ }
  }

  startBarButton();

  // ---------- Mensajes desde la ventana del sorteo ----------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'sorteo:ping') {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'sorteo:getParticipants') {
      readParticipants().then(sendResponse).catch((e) => sendResponse({ ok: false, error: 'exception', detail: String(e) }));
      return true;
    }
    if (msg.type === 'sorteo:sendChat') {
      sendChat(String(msg.text || '')).then(sendResponse).catch((e) => sendResponse({ ok: false, error: 'exception', detail: String(e) }));
      return true;
    }
  });
})();
