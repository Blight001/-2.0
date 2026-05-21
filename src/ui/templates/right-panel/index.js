const renderCookieTab = require('./tabs/cookie');
const renderEmailTab = require('./tabs/email');
const renderProxyTab = require('./tabs/proxy');
const renderTcpTab = require('./tabs/tcp');

module.exports = function renderRightPanel() {
  return `<!-- 右侧面板 -->
            <div class="right-panel">
                <div class="right-tabs">
                    <div class="tab-chooser-row tab-chooser-row--right">
                        <div class="right-tab-headers" role="tablist">
                            <button class="right-tab-header active" data-tab="right-tab-cookie" role="tab">账号管理</button>
                            <button class="right-tab-header" data-tab="right-tab-email" role="tab">邮箱设置</button>
                            <button class="right-tab-header" data-tab="right-tab-proxy" role="tab">代理设置</button>
                            <button class="right-tab-header" data-tab="right-tab-mqtt" role="tab">上传设置</button>
                        </div>
                    </div>
                    <div class="right-tab-contents">
                        ${renderCookieTab()}
                        ${renderEmailTab()}
                        ${renderProxyTab()}
                        ${renderTcpTab()}
                    </div>
                </div>
            </div>
        </div>`;
};
