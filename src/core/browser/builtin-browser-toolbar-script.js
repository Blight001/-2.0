function buildBuiltinBrowserToolbarInitScript() {
    return String.raw`
(() => {
  if (window.__builtinBrowserToolbarInstalled) {
    return;
  }

  window.__builtinBrowserToolbarInstalled = true;
  window.__builtinBrowserToolbarSyncState = () => {};
  window.__builtinBrowserToolbarNavigate = () => {};
  window.__builtinBrowserToolbarApplyState = () => {};
  window.__builtinBrowserToolbarOpenNewTab = () => {};
  window.__builtinBrowserToolbarOpenCommand = () => {};
})();
    `;
}

module.exports = {
    buildBuiltinBrowserToolbarInitScript
};
