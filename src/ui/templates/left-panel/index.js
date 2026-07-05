const renderRegisterCardsTab = require('./tabs/cards');
const renderAccountTestTab = require('./tabs/account-test');
const renderAutomationTab = require('./tabs/automation');
const renderTrialBindTab = require('./tabs/trial-bind');

module.exports = function renderLeftPanel() {
  return `<!-- 左侧面板（参考 Python main_window 布局：Tab 风格） -->
            <div class="left-panel">
                <div class="left-tabs">
                    <div class="tab-chooser-row">
                        <div class="tab-headers" role="tablist">
                            <button class="tab-header active" data-tab="tab-cards" role="tab">自动化</button>
                            <button class="tab-header" data-tab="tab-account-test" role="tab">账号测试</button>
                            <button class="tab-header" data-tab="tab-trial-bind" role="tab">账号订阅</button>
                            <button class="tab-header" data-tab="tab-automation" role="tab">账号API</button>
                        </div>
                    </div>

                    <div class="tab-contents">
                        ${renderRegisterCardsTab()}
                        ${renderAccountTestTab()}
                        ${renderAutomationTab()}
                        ${renderTrialBindTab()}
                    </div>
                </div>
            </div>`;
};
