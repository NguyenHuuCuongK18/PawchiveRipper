let panel: HTMLElement | null = null;
let closeListener: ((event: MessageEvent) => void) | null = null;
export function toggleOverlay(): void {
  if (panel) { panel.remove(); panel = null; if (closeListener) window.removeEventListener('message', closeListener); closeListener = null; return; }
  panel = document.createElement('div'); panel.id = 'archive-ripper-overlay';
  panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;isolation:isolate;';
  const shadow = panel.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = ':host{all:initial}button{position:absolute;inset:0;border:0;background:#0008;cursor:default}iframe{position:absolute;right:16px;top:16px;width:min(460px,calc(100vw - 32px));height:calc(100vh - 32px);border:1px solid #363443;border-radius:16px;box-shadow:0 16px 64px #0008;background:#14141b;color-scheme:dark}';
  const backdrop = document.createElement('button'); backdrop.setAttribute('aria-label', 'Close Pawchive Ripper'); backdrop.onclick = toggleOverlay;
  const frame = document.createElement('iframe'); frame.title = 'Pawchive Ripper'; frame.src = chrome.runtime.getURL(`overlay/index.html#url=${encodeURIComponent(location.href)}`);
  shadow.append(style, backdrop, frame); document.documentElement.append(panel); frame.focus();
  closeListener = (event: MessageEvent) => { if (event.source === frame.contentWindow && event.data?.type === 'ARCHIVE_OVERLAY_CLOSE' && panel) toggleOverlay(); };
  window.addEventListener('message', closeListener);
}
