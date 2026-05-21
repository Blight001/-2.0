module.exports = function renderProxyTab() {
  return `<!-- 代理设置 Tab -->
                        <div id="right-tab-proxy" class="right-tab-content" role="tabpanel" style="display:none;">
                            <div class="proxy-quick-actions">
                                <button id="proxy-ipip-btn" class="btn btn-secondary" type="button" title="在内置浏览器中打开 ipip0.net">打开 ipip0.net</button>
                                <button id="proxy-nexscan-btn" class="btn btn-secondary" type="button" title="在内置浏览器中打开 nexscan.net">打开 nexscan.net</button>
                            </div>
                            <div class="clash-section">
                                <div class="panel-header">
                                    <h3>🌐 Clash Verge Rev 节点切换</h3>
                                    <div style="display:flex; gap:10px;">
                                        <button id="clash-refresh-btn" class="btn btn-secondary btn-small">刷新</button>
                                    </div>
                                </div>

                                <div class="clash-controls" style="display: flex; gap: 20px; margin: 10px 0;">
                                    <div class="setting-item" style="margin-bottom: 0;">
                                        <label for="clash-system-proxy" class="setting-label">
                                            系统代理
                                            <label class="toggle-switch">
                                                <input type="checkbox" id="clash-system-proxy">
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </label>
                                    </div>
                                    <div class="setting-item" style="margin-bottom: 0;">
                                        <label for="clash-tun-mode" class="setting-label">
                                            TUN模式
                                            <label class="toggle-switch">
                                                <input type="checkbox" id="clash-tun-mode">
                                                <span class="toggle-slider"></span>
                                            </label>
                                        </label>
                                    </div>
                                </div>

                                <div id="clash-status" class="clash-status">
                                    <div class="clash-current-profile">
                                        <span class="clash-label">当前订阅:</span>
                                        <span id="clash-current-profile-name" class="clash-value">-</span>
                                    </div>
                                    <div class="clash-current-node">
                                        <span class="clash-label">当前节点:</span>
                                        <span id="clash-current-node-name" class="clash-value">-</span>
                                    </div>
                                </div>

                                <div class="clash-inline-settings">
                                    <div class="clash-profile-section">
                                        <label for="clash-profile-select">选择订阅:</label>
                                        <select id="clash-profile-select" class="clash-select">
                                            <option value="">加载中...</option>
                                        </select>
                                    </div>

                                    <div class="clash-nodes-section">
                                        <label>可用节点:</label>
                                        <div id="clash-nodes-list" class="clash-nodes-list clash-nodes-list--embedded">
                                            <div class="clash-nodes-loading">请先选择订阅</div>
                                        </div>
                                    </div>

                                    <div class="clash-actions">
                                        <button id="clash-test-latency-btn" class="btn btn-secondary" disabled>测试选中</button>
                                        <button id="clash-test-all-latency-btn" class="btn btn-warning" disabled>测试全部</button>
                                        <button id="clash-switch-node-btn" class="btn btn-primary" disabled>切换节点</button>
                                    </div>
                                </div>
                            </div>
                        </div>`;
};
