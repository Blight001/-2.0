module.exports = function renderBrowserSettingsTab() {
  return `<!-- 浏览器管理 -->
                        <div id="middle-tab-browser-settings" class="middle-tab-content" role="tabpanel" style="display:none;">
                            <div class="browser-settings-panel">
                                <div class="browser-settings-section registration-browser-settings-section" id="registration-browser-settings-section">
                                    <div class="panel-header browser-settings-header">
                                        <div>
                                            <h3>浏览器设置</h3>
                                            <p class="panel-subtitle">统一管理注册、测试、海卡绑定和代理相关的浏览器参数。</p>
                                        </div>
                                    </div>
                                    <div class="settings-content browser-settings-content">
                                        <div class="setting-item">
                                            <div class="setting-title-row">
                                                <label for="browser-type">默认浏览器</label>
                                            </div>
                                            <div class="browser-type-group">
                                                <select id="browser-type">
                                                    <!-- 选项将通过JavaScript动态填充 -->
                                                </select>
                                            </div>
                                            <div class="setting-help">默认使用内置浏览器，同时保留 Edge 和 Chrome 供手动切换。</div>
                                        </div>
                                        <div class="setting-item">
                                            <div class="setting-row">
                                                <label for="headless-mode" class="setting-switch-label">后台运行</label>
                                                <label class="toggle-switch">
                                                    <input type="checkbox" id="headless-mode" checked>
                                                    <span class="toggle-slider"></span>
                                                </label>
                                            </div>
                                            <div class="setting-help">关闭后会以可见窗口方式打开浏览器。</div>
                                        </div>
                                        <div class="setting-item">
                                            <div class="setting-row">
                                                <label for="registration-save-local-cookie" class="setting-switch-label">是否保存本地Cookie</label>
                                                <label class="toggle-switch">
                                                    <input type="checkbox" id="registration-save-local-cookie">
                                                    <span class="toggle-slider"></span>
                                                </label>
                                            </div>
                                            <div class="setting-help">默认关闭。关闭后不会写入本地 cookies 目录，但仍会保留浏览器内 Cookie 供后续自动上传使用。</div>
                                        </div>
                                        <div class="setting-item">
                                            <div class="setting-row">
                                                <label for="browser-block-images-videos" class="setting-switch-label">拦截图片/视频</label>
                                                <label class="toggle-switch">
                                                    <input type="checkbox" id="browser-block-images-videos" checked>
                                                    <span class="toggle-slider"></span>
                                                </label>
                                            </div>
                                            <div class="setting-help">开启后会主动拦截图片和视频/媒体请求，减少流量消耗；如页面需要验证码图片可临时关闭。</div>
                                        </div>
                                        <div class="setting-item">
                                            <div class="setting-row">
                                                <label for="browser-remove-watermark-plugin" class="setting-switch-label">启用去水印插件</label>
                                                <label class="toggle-switch">
                                                    <input type="checkbox" id="browser-remove-watermark-plugin" checked>
                                                    <span class="toggle-slider"></span>
                                                </label>
                                            </div>
                                            <div class="setting-help">开启后内置浏览器会自动加载去水印扩展；关闭后则只保留浏览器本体功能。</div>
                                        </div>
                                        <div class="setting-item" id="sync-control-wrapper">
                                            <div class="setting-row">
                                                <label for="sync-execution" class="setting-switch-label">同步进行</label>
                                                <label class="toggle-switch">
                                                    <input type="checkbox" id="sync-execution" checked>
                                                    <span class="toggle-slider"></span>
                                                </label>
                                            </div>
                                            <div class="setting-help">开启后会按流程顺序同步执行步骤。</div>
                                        </div>
                                        <div class="setting-item">
                                            <label for="proxy-recovery-attempts">自动恢复次数:</label>
                                            <input type="number" id="proxy-recovery-attempts" min="1" max="20" value="3">
                                        </div>

                                    </div>
                                </div>
                            </div>
                        </div>`;
};
