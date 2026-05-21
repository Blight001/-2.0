module.exports = function renderCookieTab() {
  return `<!-- 账号管理 Tab -->
                        <div id="right-tab-cookie" class="right-tab-content active" role="tabpanel">
                            <div class="cookie-panel">
                                <div class="panel-header">
                                    <h3>账号管理</h3>
                                    <div style="display: flex; gap: 8px;">
                                        <button id="cookie-select-all-btn" class="btn btn-secondary">全选</button>
                                        <button id="refresh-cookies-btn" class="btn btn-secondary">刷新</button>
                                        <button id="open-cookie-folder-btn" class="btn btn-secondary">📁 打开文件夹</button>
                                    </div>
                                </div>

                                <div class="cookie-tabs">
                                    <div class="cookie-tab-headers" role="tablist">
                                        <!-- 卡片标签页将在这里动态生成 -->
                                    </div>

                                    <div class="cookie-tab-contents">
                                        <!-- 卡片标签页将在这里动态生成 -->
                                    </div>
                                </div>
                            </div>

                            <div class="cookie-stats-panel">
                                <div class="panel-header">
                                    <h3>积分分布</h3>
                                    <span class="cookie-stats-subtitle" id="points-distribution-subtitle">当前文件夹积分分布</span>
                                </div>
                                <div class="cookie-stats-section">
                                    <div class="points-distribution-list" id="points-distribution-overview">
                                        <!-- 积分分布将在这里动态生成 -->
                                    </div>
                                </div>
                            </div>
                        </div>`;
};
