if (typeof document !== 'undefined') {
  function setupCardEditorUnifiedTabs() {
    const cardDialog = document.getElementById('card-dialog');
    if (!cardDialog || cardDialog.dataset.cardEditorUnifiedTabsReady === 'true') {
      return;
    }

    const dialogBody = cardDialog.querySelector('.dialog-body');
    const cardDialogLayout = cardDialog.querySelector('.card-dialog-layout');
    if (!dialogBody || !cardDialogLayout) {
      return;
    }

    const cardEditorTabs = document.createElement('div');
    cardEditorTabs.className = 'card-editor-tabs';
    cardEditorTabs.setAttribute('role', 'tablist');
    cardEditorTabs.setAttribute('aria-label', '卡片栏目切换');

    const buttonIds = [
      'card-dialog-base-tab-btn',
      'card-dialog-debug-tab-btn',
      'card-dialog-api-service-tab-btn',
      'card-right-panel-steps-tab-btn',
      'card-right-panel-popups-tab-btn',
      'card-right-panel-inspector-tab-btn'
    ];

    buttonIds.forEach((buttonId) => {
      const button = document.getElementById(buttonId);
      if (button) {
        cardEditorTabs.appendChild(button);
      }
    });

    dialogBody.insertBefore(cardEditorTabs, cardDialogLayout);
    cardDialog.dataset.cardEditorUnifiedTabsReady = 'true';
  }

  try {
    const renderMainPage = require('./templates/main-page');
    const view = new URLSearchParams(window.location.search || '').get('view') || '';
    const isCardEditorView = String(view || '').trim().toLowerCase() === 'card-editor';

    window.addEventListener('error', (event) => {
      try {
        console.error('[renderer] uncaught error:', event?.error?.stack || event?.message || event?.error || 'unknown');
      } catch (_) {}
    });

    window.addEventListener('unhandledrejection', (event) => {
      try {
        console.error('[renderer] unhandled rejection:', event?.reason?.stack || event?.reason || 'unknown');
      } catch (_) {}
    });

    console.log('[renderer] entry start');
    const appRoot = document.getElementById('app-root') || document.body;
    appRoot.innerHTML = renderMainPage();

    const overlayTargets = ['message-dialog', 'confirm-dialog'];
    overlayTargets.forEach((id) => {
      const node = document.getElementById(id);
      if (node && node.parentElement !== document.body) {
        document.body.appendChild(node);
      }
    });

    if (isCardEditorView) {
      document.documentElement?.dataset && (document.documentElement.dataset.view = 'card-editor');
      if (document.body) {
        document.body.dataset.view = 'card-editor';
        document.body.classList.add('card-editor-window');
      }
      const cardDialog = document.getElementById('card-dialog');
      if (cardDialog) {
        cardDialog.style.display = 'flex';
      }
      if (document.title) {
        document.title = '卡片编辑器';
      }
      setupCardEditorUnifiedTabs();
    }
    console.log('[renderer] main page rendered');

    require('./modules/renderer-core');
    console.log('[renderer] renderer-core loaded');
  } catch (error) {
    console.error('[renderer] startup failed:', error && error.stack ? error.stack : String(error));
    const appRoot = document.getElementById('app-root') || document.body;
    if (appRoot) {
      appRoot.innerHTML = `<pre style="white-space:pre-wrap;color:#b91c1c;padding:16px;">渲染进程启动失败:\n${String(error && error.stack ? error.stack : error)}</pre>`;
    }
  }
}
