'use strict';

/* Corre SOLO dentro del marco de Google Chat que Meet incrusta en su panel de
 * chat (chat.google.com dentro de meet.google.com). Meet no puede tocar ese
 * marco directamente, así que content.js le manda el texto con postMessage y
 * este script lo escribe y lo envía. No hace nada en ningún otro lugar. */
(() => {
  if (window === window.top || window.__sorteoChatFrame) return;
  const parentOk = (() => {
    try { return Array.from(location.ancestorOrigins || []).includes('https://meet.google.com'); } catch (e) { return false; }
  })();
  if (!parentOk) return;
  window.__sorteoChatFrame = true;

  const ALLOWED = ['https://meet.google.com', 'https://chat.google.com'];
  const EDITOR_SEL = '[contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], textarea';
  const SEND_LABEL = /(enviar|send)/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
  const label = (el) => (el.getAttribute('aria-label') || '').trim();

  async function waitFor(fn, timeout, step) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > timeout) return null;
      await sleep(step || 100);
    }
  }

  function deepAll(sel, root, depth) {
    root = root || document; depth = depth || 0;
    let out = Array.from(root.querySelectorAll(sel));
    if (depth > 4) return out;
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) out = out.concat(deepAll(sel, el.shadowRoot, depth + 1));
    });
    return out;
  }

  const findEditor = () => deepAll(EDITOR_SEL).find((el) => visible(el) && !/(buscar|search)/i.test(label(el))) || null;
  const isEditable = (el) => el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT';
  const readValue = (el) => (isEditable(el) ? el.textContent : el.value) || '';

  function writeValue(el, value) {
    el.focus();
    if (!isEditable(el)) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    try {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, value);
    } catch (e) { /* sin execCommand */ }
    if (!readValue(el)) { el.textContent = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  function findSend(editor) {
    let node = editor.parentElement;
    for (let d = 0; node && d < 8; d++, node = node.parentElement) {
      for (const b of node.querySelectorAll('button[aria-label], [role="button"][aria-label]')) {
        if (SEND_LABEL.test(label(b))) return b;
      }
    }
    return null;
  }

  async function write(text) {
    const editor = findEditor();
    if (!editor) return null; // este marco no tiene el editor
    writeValue(editor, text);
    const enabled = (b) => b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
    const send = await waitFor(() => { const b = findSend(editor); return enabled(b) ? b : null; }, 2000, 100);
    if (send) send.click();
    else editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    let sent = !!(await waitFor(() => readValue(editor) === '', 1500, 100));
    if (!sent) {
      editor.focus();
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      sent = !!(await waitFor(() => readValue(editor) === '', 1500, 100));
    }
    return sent ? { ok: true } : { ok: false, error: 'not-sent' };
  }

  function replyTo(win, origin, id, r) {
    try { win.postMessage({ type: 'sorteo:chat-result', id: id, ok: !!r.ok, error: r.error || null }, origin); } catch (e) { /* ignorar */ }
  }

  const handled = new Map(); // id -> resultado (o null si sigue en curso)

  window.addEventListener('message', async (e) => {
    if (!ALLOWED.includes(e.origin)) return;
    const d = e.data;
    if (!d || typeof d.id !== 'string' || d.id.length > 64) return;

    // Respuesta de un marco hijo: se la pasamos al de arriba.
    if (d.type === 'sorteo:chat-result') {
      const up = window.parent;
      const o = (location.ancestorOrigins && location.ancestorOrigins[0]) || '';
      if (up && up !== window && ALLOWED.includes(o)) replyTo(up, o, d.id, d);
      return;
    }

    if (d.type !== 'sorteo:chat-write' || typeof d.text !== 'string' || d.text.length > 2000) return;
    if (e.source !== window.parent) return;

    // Mensaje repetido (content.js reintenta mientras el marco carga): no reenviar.
    if (handled.has(d.id)) {
      const prev = handled.get(d.id);
      if (prev) replyTo(e.source, e.origin, d.id, prev);
      return;
    }
    handled.set(d.id, null);
    if (handled.size > 20) handled.delete(handled.keys().next().value);

    const r = await write(d.text);
    if (r) { handled.set(d.id, r); replyTo(e.source, e.origin, d.id, r); return; }

    // No hay editor acá: probamos en los marcos de adentro.
    document.querySelectorAll('iframe').forEach((f) => {
      try {
        const o = new URL(f.src, location.href).origin;
        if (ALLOWED.includes(o) && f.contentWindow) f.contentWindow.postMessage(d, o);
      } catch (err) { /* ignorar */ }
    });
  });
})();
