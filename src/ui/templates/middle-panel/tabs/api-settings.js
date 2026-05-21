module.exports = function renderApiSettingsTab() {
  return `<!-- API 设置 -->
                        <div id="middle-tab-api-settings" class="middle-tab-content" role="tabpanel" style="display:none;">
                            <div class="api-settings-panel">
                                <div class="panel-header browser-settings-header">
                                    <div>
                                        <h3>API 设置</h3>
                                        <p class="panel-subtitle">管理本地 OpenAI 兼容 API 服务和默认请求参数。</p>
                                        <div class="api-server-header-meta">
                                            <div class="api-server-header-status-line">
                                                <div class="setting-row api-server-header-status-row">
                                                    <label class="setting-switch-label">服务状态</label>
                                                    <span id="api-server-status" class="api-server-status-pill">未开启</span>
                                                </div>
                                                <div id="api-server-url" class="setting-help api-server-header-url">本地地址: -</div>
                                            </div>
                                            <div class="api-server-header-bind-row">
                                                <div class="api-server-header-bind-field">
                                                    <label for="api-server-host">监听地址</label>
                                                    <input type="text" id="api-server-host" value="127.0.0.1" autocomplete="off" spellcheck="false">
                                                </div>
                                                <div class="api-server-header-bind-field">
                                                    <label for="api-server-port">端口</label>
                                                    <input type="number" id="api-server-port" min="1" max="65535" value="8787">
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="panel-header-actions">
                                        <button id="api-server-start-btn" class="btn btn-primary" type="button">开启服务</button>
                                        <button id="api-server-stop-btn" class="btn btn-secondary" type="button" disabled>关闭服务</button>
                                    </div>
                                </div>
                                <div class="settings-content api-settings-content">
                                    <div class="setting-item">
                                        <div class="setting-title-row">
                                            <label for="api-server-key">API Key</label>
                                            <button id="api-server-generate-key-btn" class="btn btn-secondary btn-small" type="button">随机生成</button>
                                        </div>
                                        <input type="password" id="api-server-key" autocomplete="off" spellcheck="false" placeholder="生成或填写本地访问密钥">
                                        <div class="setting-help">本地接口需要使用 Authorization: Bearer API_KEY 或 X-API-Key 访问。</div>
                                    </div>
                                    <div class="api-model-settings-grid">
                                        <div class="setting-item api-model-setting-card">
                                            <div class="setting-title-row">
                                                <label for="api-text-model-params">文本模型请求参数</label>
                                                <button id="api-text-test-btn" class="btn btn-secondary btn-small" type="button">测试文本</button>
                                            </div>
                                            <textarea id="api-text-model-params" rows="10" spellcheck="false"></textarea>
                                        </div>
                                        <div class="setting-item api-model-setting-card">
                                            <div class="setting-title-row">
                                                <label for="api-image-model-params">图片模型请求参数</label>
                                                <button id="api-image-test-btn" class="btn btn-secondary btn-small" type="button">测试图片</button>
                                            </div>
                                            <textarea id="api-image-model-params" rows="10" spellcheck="false"></textarea>
                                        </div>
                                        <div class="setting-item api-model-setting-card">
                                            <div class="setting-title-row">
                                                <label for="api-video-model-params">视频模型请求参数</label>
                                                <button id="api-video-test-btn" class="btn btn-secondary btn-small" type="button">测试视频</button>
                                            </div>
                                            <textarea id="api-video-model-params" rows="10" spellcheck="false"></textarea>
                                        </div>
                                    </div>
                                    <div class="panel-header-actions">
                                        <button id="api-settings-save-btn" class="btn btn-primary" type="button">保存设置</button>
                                        <button id="api-settings-reload-btn" class="btn btn-secondary" type="button">重载设置</button>
                                    </div>
                                    <div class="api-server-console-panel">
                                        <div class="panel-header api-server-console-header">
                                            <div>
                                                <h3>HTTP 请求控制台</h3>
                                                <p class="panel-subtitle">展示本地 API 服务收到的请求和 API 调用结果。</p>
                                            </div>
                                            <button id="api-server-console-clear-btn" class="btn btn-secondary btn-small" type="button">清空</button>
                                        </div>
                                        <div id="api-server-console-output" class="api-server-console-output" aria-live="polite">
                                            <div class="api-server-console-empty">暂无请求记录</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>`;
};
