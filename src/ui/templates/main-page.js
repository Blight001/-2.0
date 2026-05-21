const renderTitleBar = require('./title-bar');
const renderLeftPanel = require('./left-panel/index');
const renderMiddlePanel = require('./middle-panel/index');
const renderRightPanel = require('./right-panel/index');
const renderDialogs = require('./dialogs');
const renderHaikaModal = require('./haika-modal');

module.exports = function renderMainPage() {
  return `
<div class="main-container">
${renderTitleBar()}
<div class="content-area">
${renderLeftPanel()}
${renderMiddlePanel()}
${renderRightPanel()}
<button id="left-drawer-bubble" class="drawer-bubble drawer-bubble--left" type="button" aria-label="展开左侧面板" title="展开左侧面板">
    <svg class="drawer-bubble-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.5 6.5L9 12l5.5 5.5" />
    </svg>
</button>
<button id="right-drawer-bubble" class="drawer-bubble drawer-bubble--right" type="button" aria-label="展开右侧面板" title="展开右侧面板">
    <svg class="drawer-bubble-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9.5 6.5L15 12l-5.5 5.5" />
    </svg>
</button>
</div>
${renderDialogs()}
</div>
${renderHaikaModal()}`;
};
