module.exports = function renderTcpTab() {
  return `<!-- 上传设置 Tab -->
                        <div id="right-tab-mqtt" class="right-tab-content" role="tabpanel" style="display:none;">
                            <div class="panel-header">
                                <div>
                                    <h3>上传设置</h3>
                                </div>
                                <div class="panel-header-actions upload-mode-actions">
                                    <button id="upload-mode-tcp-btn" class="btn btn-secondary upload-mode-btn active" type="button" aria-pressed="true">TCP上传</button>
                                    <button id="upload-mode-http-btn" class="btn btn-secondary upload-mode-btn" type="button" aria-pressed="false">HTTP上传</button>
                                </div>
                            </div>
                            <div class="upload-settings-card">
                                <div id="upload-mode-tcp-panel" class="upload-mode-panel active">
                                    <div class="upload-settings-section">
                                        <div class="setting-item">
                                            <label for="tcp-server-url">TCP服务器地址</label>
                                            <input type="text" id="tcp-server-url" placeholder="例如: tcp://127.0.0.1:58113" autocomplete="off" spellcheck="false">
                                            <div class="setting-row tcp-reconnect-row">
                                                <label class="setting-switch-label" for="tcp-auto-reconnect-enabled">自动重连</label>
                                                <label class="toggle-switch">
                                                    <input type="checkbox" id="tcp-auto-reconnect-enabled" checked>
                                                    <span class="toggle-slider"></span>
                                                </label>
                                            </div>
                                        </div>
                                        <div class="mqtt-connection-actions">
                                            <button id="tcp-settings-save-btn" class="btn btn-primary" type="button">保存 TCP 配置</button>
                                        </div>
                                    </div>
                                    <div class="mqtt-connection-card mqtt-connection-card--status" style="margin-top: 16px;">
                                        <div class="mqtt-connection-row">
                                            <span class="mqtt-connection-label">功能启用</span>
                                            <span id="mqtt-connection-enabled" class="mqtt-connection-value mqtt-status-neutral">未初始化</span>
                                        </div>
                                        <div class="mqtt-connection-row">
                                            <span class="mqtt-connection-label">服务器连接</span>
                                            <span id="mqtt-connection-connected" class="mqtt-connection-value mqtt-status-neutral">未初始化</span>
                                        </div>
                                        <div class="mqtt-connection-row">
                                            <span class="mqtt-connection-label">数据通道</span>
                                            <span id="mqtt-connection-subscribed" class="mqtt-connection-value mqtt-status-neutral">未初始化</span>
                                        </div>
                                        <div class="mqtt-connection-row">
                                            <span class="mqtt-connection-label">自动重连</span>
                                            <span id="mqtt-connection-reconnect" class="mqtt-connection-value mqtt-status-neutral">未初始化</span>
                                        </div>
                                        <div class="mqtt-connection-row">
                                            <span class="mqtt-connection-label">控制锁定</span>
                                            <span id="mqtt-connection-locked" class="mqtt-connection-value mqtt-status-neutral">未初始化</span>
                                        </div>
                                        <div class="mqtt-connection-row">
                                            <span class="mqtt-connection-label">服务器地址</span>
                                            <span id="mqtt-connection-endpoint" class="mqtt-connection-value mqtt-status-neutral">-</span>
                                        </div>
                                    </div>
                                    <div class="tcp-connection-console">
                                        <div class="panel-header">
                                            <h3>TCP控制台</h3>
                                            <div class="console-controls">
                                                <button id="tcp-connection-console-clear-btn" class="btn btn-secondary btn-small" type="button">清空</button>
                                            </div>
                                        </div>
                                        <div id="tcp-connection-console-output" class="console-content tcp-connection-console-output" aria-live="polite" aria-label="TCP控制台输出"></div>
                                    </div>
                                </div>

                                <div id="upload-mode-http-panel" class="upload-mode-panel" hidden>
                                    <div class="upload-settings-section">
                                        <div class="setting-item upload-auto-control">
                                            <div class="setting-title-row">
                                                <label for="registration-auto-upload" class="setting-switch-label">注册后自动上传</label>
                                                <label class="setting-switch-label">
                                                    <input type="checkbox" id="registration-auto-upload" checked>
                                                    <span>启用</span>
                                                </label>
                                            </div>
                                            <div class="setting-help">开启后，注册完成会自动按当前卡片的上传配置执行上传。</div>
                                        </div>

                                        <div class="setting-item" id="card-upload-config-group">
                                            <div class="setting-title-row">
                                                <label>上传账号配置</label>
                                            </div>
                                            <div class="form-group">
                                                <label for="registration-upload-server-url">服务器地址</label>
                                                <input type="text" id="registration-upload-server-url" placeholder="http://127.0.0.1:58158">
                                            </div>
                                            <div class="form-group">
                                                <label for="registration-upload-card-key">卡密</label>
                                                <input type="text" id="registration-upload-card-key" placeholder="请输入用于上传的卡密" autocomplete="off" spellcheck="false">
                                                <div class="setting-help">保存到当前卡片，上传时自动读取。</div>
                                            </div>
                                            <div class="form-group">
                                                <label for="card-upload-target-score-scope">目标积分类型</label>
                                                <select id="card-upload-target-score-scope">
                                                    <option value="all">默认所有积分账号</option>
                                                    <option value="custom">单独设置目标积分账号</option>
                                                </select>
                                                <div class="setting-help">默认上传到全部积分账号；有多个类型时可切换后填写目标。</div>
                                            </div>
                                            <div class="form-group" id="card-upload-target-score-types-group">
                                                <label for="card-upload-target-score-types">目标积分账号/类型</label>
                                                <textarea id="card-upload-target-score-types" rows="2" placeholder="例如：0积分账号，特殊0积分账号"></textarea>
                                                <div class="setting-help">多个目标用换行或逗号分隔；留空时仅默认模式生效。</div>
                                            </div>
                                        </div>

                                        <div class="mqtt-connection-actions">
                                            <button id="http-settings-save-btn" class="btn btn-primary" type="button">保存 HTTP 配置</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>`;
};
