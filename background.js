'use strict';

// La ventana del sorteo se abre desde el ícono de la extensión o desde el
// botón «Sorteo» que content.js agrega a la barra de Meet.
// Es una ventana aparte a propósito: así podés presentarla en Meet
// («Presentar ahora» → «Una ventana») y todos ven el sorteo.

const SORTEO_PAGE = 'sorteo.html';
const MEET_PREFIX = 'https://meet.google.com/';

async function getWindowMap() {
  try {
    const r = await chrome.storage.session.get('windows');
    return r.windows || {};
  } catch (e) {
    return {};
  }
}

async function setWindowMap(map) {
  try {
    await chrome.storage.session.set({ windows: map });
  } catch (e) { /* sin almacenamiento de sesión: se abre una ventana nueva cada vez */ }
}

// Abre la ventana del sorteo para esa pestaña de Meet (o sin pestaña: modo manual).
async function openSorteo(tabId) {
  // Una sola ventana de sorteo por pestaña de Meet.
  const key = String(tabId);
  const map = await getWindowMap();
  if (map[key] != null) {
    try {
      await chrome.windows.update(map[key], { focused: true });
      return;
    } catch (e) {
      delete map[key];
    }
  }

  const url = chrome.runtime.getURL(SORTEO_PAGE) + (tabId != null ? '?tab=' + tabId : '');
  const win = await chrome.windows.create({ url: url, type: 'popup', width: 780, height: 700 });
  map[key] = win.id;
  await setWindowMap(map);
}

// Clic en el ícono de la extensión.
chrome.action.onClicked.addListener(async (tab) => {
  const isMeet = !!tab && typeof tab.url === 'string' && tab.url.startsWith(MEET_PREFIX);
  const tabId = isMeet ? tab.id : null;

  // Si la extensión se instaló con la reunión ya abierta, el script de Meet
  // todavía no está cargado: lo inyectamos (activeTab lo permite tras el clic).
  if (isMeet) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['lib.js', 'content.js'] });
    } catch (e) { /* ya estaba cargado o la página no lo permite */ }
  }
  await openSorteo(tabId);
});

// Clic en el botón «Sorteo» de la barra de Meet (lo manda content.js).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'sorteo:open') return;
  if (sender.id !== chrome.runtime.id) return;
  if (!sender.tab || typeof sender.url !== 'string' || !sender.url.startsWith(MEET_PREFIX)) return;
  openSorteo(sender.tab.id);
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const map = await getWindowMap();
  let changed = false;
  for (const k of Object.keys(map)) {
    if (map[k] === windowId) { delete map[k]; changed = true; }
  }
  if (changed) await setWindowMap(map);
});
