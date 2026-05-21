(function () {
  'use strict';

  const FLAG = '__AI_FREE_REMOVE_WM_PAGE_CORE__';
  const STYLE_ID = '__AI_FREE_REMOVE_WM_STYLE__';
  const MARK_CLASS = 'class_mark_ai_free_remove_wm';

  if (window[FLAG]) {
    return;
  }
  window[FLAG] = true;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const css = `
      html, body, body * {
        -webkit-user-select: text !important;
        user-select: text !important;
      }

      body *::selection {
        background-color: #4C98F7 !important;
        color: #fff !important;
      }

      body > div[style*="position: fixed"][style*="top: 0"][style*="left: 0"][style*="right: 0"][style*="bottom: 0"] {
        display: none !important;
      }

      [class*="mask"], [id*="mask"], [class*="watermark"], [id*="watermark"] {
        pointer-events: none !important;
      }

      .${MARK_CLASS} {
        display: none !important;
      }

      html body,
      html body *:not(input):not(textarea):not([contenteditable=""]):not([contenteditable="true"]) {
        user-select: text !important;
      }
    `;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.type = 'text/css';
    style.appendChild(document.createTextNode(css));
    (document.head || document.documentElement || document.body).appendChild(style);
  }

  function clearHandlers(el) {
    try {
      el.oncopy = null;
      el.oncut = null;
      el.oncontextmenu = null;
      el.onselectstart = null;
      el.ondragstart = null;
      el.onkeydown = null;
      el.onkeypress = null;
      el.onkeyup = null;
      el.onmousedown = null;
      el.onmouseup = null;
      el.onmousemove = null;
      el.onselectionchange = null;
    } catch (_) {}
  }

  function isEmptyNode(node) {
    const text = String(node?.innerText || '').trim();
    if (text) return false;
    if (!node) return true;
    const hasRichMedia = node.querySelectorAll
      ? node.querySelectorAll('img,video,canvas,iframe,svg').length > 0
      : false;
    return (node.children && node.children.length > 0) ? false : !hasRichMedia;
  }

  function maybeFullOverlay(node) {
    try {
      const style = window.getComputedStyle(node);
      if (!style) return false;
      const fixed = style.position === 'fixed' || style.position === 'absolute';
      const fullTop = style.top === '0px';
      const fullLeft = style.left === '0px';
      const fullRight = style.right === '0px' || style.width === '100vw' || style.width === '100%';
      const fullBottom = style.bottom === '0px' || style.height === '100vh' || style.height === '100%';
      const highZ = Number.parseInt(style.zIndex || '0', 10) >= 1000;
      const transparent = Number.parseFloat(style.opacity || '1') <= 0.02;
      return fixed && fullTop && fullLeft && fullRight && fullBottom && highZ && (transparent || isEmptyNode(node));
    } catch (_) {
      return false;
    }
  }

  function hideOverlayCandidates(root = document) {
    try {
      root.querySelectorAll('body > div, body > section, body > aside').forEach((node) => {
        if (maybeFullOverlay(node)) {
          node.classList.add(MARK_CLASS);
          node.dataset.prevdisplay = node.style.display || '';
          node.style.display = 'none';
        }
      });
    } catch (_) {}
  }

  function processNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

    clearHandlers(node);
    if (node.shadowRoot) {
      injectIntoRoot(node.shadowRoot);
    }

    try {
      node.querySelectorAll('*').forEach((child) => {
        clearHandlers(child);
        if (child.shadowRoot) {
          injectIntoRoot(child.shadowRoot);
        }
      });
    } catch (_) {}

    if (maybeFullOverlay(node)) {
      node.classList.add(MARK_CLASS);
      node.dataset.prevdisplay = node.style.display || '';
      node.style.display = 'none';
    }
  }

  function injectIntoRoot(root) {
    if (!root) return;
    try {
      const observerKey = '__AI_FREE_REMOVE_WM_OBSERVER__';
      if (root[observerKey]) return;

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type !== 'childList' || !record.addedNodes || record.addedNodes.length === 0) {
            continue;
          }
          record.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              processNode(node);
            }
          });
        }
      });

      root[observerKey] = observer;
      observer.observe(root, { childList: true, subtree: true });
    } catch (_) {}
  }

  function bootstrap() {
    injectStyle();
    clearHandlers(document);
    processNode(document.documentElement || document.body || document);
    document.querySelectorAll('*').forEach((node) => {
      clearHandlers(node);
      if (node.shadowRoot) {
        injectIntoRoot(node.shadowRoot);
      }
    });
    hideOverlayCandidates(document);
    injectIntoRoot(document);
  }

  try {
    bootstrap();
  } catch (error) {
    console.warn('[RemoveWM] 页面处理脚本执行失败:', error?.message || error);
  }
})();
