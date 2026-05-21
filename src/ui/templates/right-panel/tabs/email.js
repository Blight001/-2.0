module.exports = function renderEmailTab() {
  return `<!-- 邮箱设置 Tab -->
                        <div id="right-tab-email" class="right-tab-content" role="tabpanel" style="display:none;">
                            <div class="panel-header">
                                <div>
                                    <h3>邮箱设置</h3>
                                </div>
                                <div class="card-actions email-mode-actions">
                                    <button id="email-mode-connect-btn" class="btn btn-secondary email-mode-btn active" type="button" aria-pressed="true">TCP邮箱</button>
                                    <button id="email-mode-outlook-btn" class="btn btn-secondary email-mode-btn" type="button" aria-pressed="false">Outlook</button>
                                    <button id="email-mode-temp-btn" class="btn btn-secondary email-mode-btn" type="button" aria-pressed="false">临时邮箱</button>
                                    <button id="email-mode-api-btn" class="btn btn-secondary email-mode-btn" type="button" aria-pressed="false">API连接</button>
                                </div>
                            </div>

                            <div id="email-mode-connect-panel" class="email-mode-panel active">
                                <div class="settings-content browser-settings-content">
                                    <div class="setting-item">
                                        <label for="email-host">邮箱服务器 (主机/IP):</label>
                                        <input type="text" id="email-host" placeholder="默认: heysure.top">
                                    </div>
                                    <div class="setting-item">
                                        <label for="email-port">端口:</label>
                                        <input type="number" id="email-port" placeholder="8888" min="1" max="65535">
                                    </div>
                                    <div class="setting-item">
                                        <label for="email-suffix">邮箱后缀名</label>
                                        <input type="text" id="email-suffix" placeholder="heysure.top" autocomplete="off" spellcheck="false">
                                        <div class="setting-help">注册步骤中填写 <code>{account}</code> 时会自动补成 <code>账号@后缀名</code>。</div>
                                    </div>
                                    <div class="setting-item">
                                        <label>随机字符串配置</label>
                                        <div class="random-config random-config--compact">
                                            <div class="random-config__row">
                                                <div class="form-group-inline">
                                                    <label for="email-random-length">邮箱长度</label>
                                                    <input type="number" id="email-random-length" value="8" min="1" max="50">
                                                </div>
                                                <div class="form-group-inline">
                                                    <label for="email-random-type">邮箱类型</label>
                                                    <select id="email-random-type">
                                                        <option value="lowercase">小写字母</option>
                                                        <option value="uppercase">大写字母</option>
                                                        <option value="letters">大小写字母</option>
                                                        <option value="numbers">数字</option>
                                                        <option value="mixed">字母+数字</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="setting-item">
                                        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
                                            <button id="email-config-save-btn" class="btn btn-secondary">保存配置</button>
                                            <button id="email-connect-btn" class="btn btn-primary">连接邮箱</button>
                                            <button id="email-disconnect-btn" class="btn btn-secondary" disabled>断开连接</button>
                                        </div>
                                        <div style="display:flex;gap:8px;align-items:center;">
                                            <span>状态:</span>
                                            <span id="email-status" style="font-weight:bold;">未连接</span>
                                        </div>
                                    </div>
                                    <div class="setting-item">
                                        <div class="email-log-toolbar">
                                            <label class="email-log-label" style="margin-bottom:0;">邮箱设置日志:</label>
                                            <div class="console-controls email-log-controls">
                                                <label for="email-auto-scroll" style="margin-right: 10px;">
                                                    <input type="checkbox" id="email-auto-scroll" checked> 自动滚动
                                                </label>
                                                <button id="save-email-log-btn" class="btn btn-secondary btn-small" style="padding: 2px 8px;">保存日志</button>
                                                <button id="clear-email-log-btn" class="btn btn-secondary btn-small" style="padding: 2px 8px;">清空</button>
                                            </div>
                                        </div>
                                        <div id="email-log" class="email-log-panel"></div>
                                    </div>
                                </div>
                            </div>

                            <div id="email-mode-outlook-panel" class="email-mode-panel outlook-email-panel" style="min-height: 420px;">
                                <div class="panel-header">
                                    <div>
                                        <h3>Outlook 邮箱</h3>
                                    </div>
                                    <div class="card-actions">
                                        <button id="outlook-email-import-btn" class="btn btn-secondary" type="button">导入</button>
                                        <button id="outlook-email-clear-btn" class="btn btn-danger" type="button">清空</button>
                                    </div>
                                </div>

                                <div id="outlook-email-list" class="outlook-email-list">
                                    <div class="outlook-email-empty">暂无 Outlook 邮箱</div>
                                </div>

                                <div class="setting-item outlook-email-content-section">
                                    <div class="setting-title-row">
                                        <label>内容区域</label>
                                    </div>
                                    <div id="outlook-email-content" class="outlook-email-content">
                                        <div class="outlook-email-empty">暂无收件箱邮件需要显示</div>
                                    </div>
                                </div>
                            </div>

                            <div id="email-mode-temp-panel" class="email-mode-panel">
                                <div class="panel-header">
                                    <div>
                                        <h3>临时邮箱站点</h3>
                                        <div class="panel-subtitle">按卡片管理站点配置，双击可直接打开对应网页</div>
                                    </div>
                                    <div class="card-actions">
                                        <button id="temp-email-add-btn" class="btn btn-secondary" type="button">添加</button>
                                        <button id="temp-email-import-btn" class="btn btn-secondary" type="button">导入</button>
                                        <button id="temp-email-edit-btn" class="btn btn-secondary" type="button">编辑</button>
                                        <button id="temp-email-delete-btn" class="btn btn-danger" type="button">删除</button>
                                    </div>
                                </div>

                                <div id="temp-email-card-list" class="card-list temp-email-card-list">
                                    <!-- 临时邮箱卡片将在这里动态生成 -->
                                </div>

                                <div class="setting-item">
                                    <div class="setting-title-row">
                                        <label>浏览器操作</label>
                                    </div>
                                    <div class="card-actions">
                                        <button id="temp-email-open-btn" class="btn btn-primary" type="button">打开浏览器</button>
                                        <button id="temp-email-refresh-email-btn" class="btn btn-secondary" type="button">刷新邮箱</button>
                                        <button id="temp-email-get-email-btn" class="btn btn-secondary" type="button">获取邮箱</button>
                                        <button id="temp-email-get-code-btn" class="btn btn-secondary" type="button">获取验证码</button>
                                    </div>
                                </div>

                                <section class="email-api-card temp-email-http-card">
                                    <div class="temp-email-http-card__header">
                                        <div class="temp-email-http-card__title-block">
                                            <h4>HTTP 调试</h4>
                                            <div class="temp-email-http-card__endpoint">
                                                <span class="temp-email-http-card__label">当前接口地址:</span>
                                                <span id="temp-email-http-base-url" class="temp-email-http-card__url">未获取</span>
                                            </div>
                                        </div>
                                        <div class="email-api-card__actions temp-email-http-card__actions">
                                            <button id="temp-email-http-open-btn" class="btn btn-secondary" type="button">打开窗口</button>
                                            <button id="temp-email-http-close-btn" class="btn btn-secondary" type="button">关闭窗口</button>
                                            <button id="temp-email-http-get-email-btn" class="btn btn-secondary" type="button">获取邮箱</button>
                                            <button id="temp-email-http-get-code-btn" class="btn btn-secondary" type="button">获取验证码</button>
                                        </div>
                                    </div>
                                    <div class="email-api-card__body">
                                        <div id="temp-email-http-status" class="email-api-status email-api-status--idle">等待操作</div>
                                        <div id="temp-email-http-result" class="email-api-result-block">
                                            <div class="email-api-empty">暂无 HTTP 调试结果</div>
                                        </div>
                                    </div>
                                </section>

                                <div class="panel-header">
                                    <h3>临时邮箱日志</h3>
                                    <div class="console-controls">
                                        <label for="temp-email-auto-scroll" style="margin-right: 10px;">
                                            <input type="checkbox" id="temp-email-auto-scroll" checked> 自动滚动
                                        </label>
                                    </div>
                                </div>
                                <div id="temp-email-console-output" class="console-content temp-email-console-output"></div>

                                <div id="temp-email-provider-dialog" class="dialog-overlay" style="display: none;">
                                    <div class="dialog">
                                        <div class="dialog-header">
                                            <h3 id="temp-email-provider-dialog-title">添加临时邮箱站点</h3>
                                            <button id="temp-email-provider-dialog-close-btn" class="close-btn" type="button">&times;</button>
                                        </div>
                                        <div class="dialog-body">
                                            <form id="temp-email-provider-form">
                                                <div class="settings-content browser-settings-content" style="padding: 0; box-shadow: none; background: transparent; max-height: none;">
                                                    <input type="hidden" id="temp-email-provider-original-id">
                                                    <div class="setting-item">
                                                        <label for="temp-email-provider-name">站点名称</label>
                                                        <input type="text" id="temp-email-provider-name" placeholder="如 mailtemp.net">
                                                    </div>
                                                    <div class="setting-item">
                                                        <label for="temp-email-provider-url">站点网址</label>
                                                        <input type="text" id="temp-email-provider-url" placeholder="https://example.com">
                                                    </div>
                                                    <div class="setting-item">
                                                        <div class="setting-title-row">
                                                            <label>关闭弹窗列表</label>
                                                        </div>
                                                        <textarea id="temp-email-provider-close-popups" rows="6" placeholder="每行一个选择器，例如：&#10;button:has-text(&quot;关闭&quot;)&#10;.modal-close"></textarea>
                                                        <div class="setting-help">每行填写一个弹窗关闭按钮选择器，保存后会按顺序尝试点击。</div>
                                                    </div>
                                                    <div class="setting-item">
                                                        <div class="setting-title-row">
                                                            <label for="temp-email-provider-email-element">获取邮箱元素</label>
                                                        </div>
                                                        <input type="text" id="temp-email-provider-email-element" placeholder="例如 input[readonly]">
                                                    </div>
                                                    <div class="setting-item">
                                                        <div class="setting-title-row">
                                                            <label for="temp-email-provider-refresh-button">刷新邮箱按钮</label>
                                                        </div>
                                                        <input type="text" id="temp-email-provider-refresh-button" placeholder="例如 button:has-text('刷新')">
                                                    </div>
                                                    <div class="setting-item">
                                                        <div class="setting-title-row">
                                                            <label for="temp-email-provider-code-click-element">打开验证码邮件元素</label>
                                                        </div>
                                                        <input type="text" id="temp-email-provider-code-click-element" placeholder="例如 div:has-text(&quot;Verify your email&quot;)">
                                                    </div>
                                                    <div class="setting-item">
                                                        <div class="setting-title-row">
                                                            <label for="temp-email-provider-code-element">读取验证码文本元素</label>
                                                        </div>
                                                        <input type="text" id="temp-email-provider-code-element" placeholder="例如 iframe#emailFrame">
                                                    </div>
                                                </div>
                                            </form>
                                        </div>
                                        <div class="dialog-footer">
                                            <button id="temp-email-provider-cancel-btn" class="btn btn-secondary" type="button">取消</button>
                                            <button id="temp-email-provider-debug-btn" class="btn btn-secondary" type="button">打开浏览器</button>
                                            <button id="temp-email-provider-save-btn" class="btn btn-primary" type="button">保存</button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div id="email-mode-api-panel" class="email-mode-panel">
                                <div class="panel-header">
                                    <div>
                                        <h3>API连接</h3>
                                        <div class="panel-subtitle">每个操作都有独立的控制和结果展示</div>
                                    </div>
                                </div>

                                <div class="settings-content browser-settings-content">
                                    <div class="setting-item">
                                        <label for="email-api-base-url">API 基础地址</label>
                                        <input type="text" id="email-api-base-url" placeholder="https://mail.chatgpt.org.uk">
                                    </div>
                                    <div class="setting-item">
                                        <label for="email-api-key">API Key / Token</label>
                                        <input type="text" id="email-api-key" placeholder="sk-fpc0CncQGk2v">
                                    </div>
                                </div>

                                <div class="email-api-operations">
                                    <section class="email-api-card">
                                        <div class="email-api-card__header">
                                            <div>
                                                <h4>生成邮箱</h4>
                                            </div>
                                            <div class="email-api-card__actions">
                                                <button id="email-api-copy-btn" class="btn btn-secondary" type="button">复制</button>
                                                <button id="email-api-generate-btn" class="btn btn-primary" type="button">生成</button>
                                            </div>
                                        </div>
                                        <div class="email-api-card__body">
                                            <div id="email-api-generated-email" class="email-api-value email-api-value--empty">尚未生成邮箱</div>
                                        </div>
                                    </section>

                                    <section class="email-api-card">
                                        <div class="email-api-card__header">
                                            <div>
                                                <h4>查询收件箱</h4>
                                            </div>
                                            <button id="email-api-list-btn" class="btn btn-secondary" type="button">查询</button>
                                        </div>
                                        <div class="email-api-card__body">
                                            <div id="email-api-inbox-result" class="email-api-result-block">
                                                <div class="email-api-empty">暂无收件箱结果</div>
                                            </div>
                                        </div>
                                    </section>

                                    <section class="email-api-card">
                                        <div class="email-api-card__header">
                                            <div>
                                                <h4>查看详情</h4>
                                            </div>
                                            <button id="email-api-detail-btn" class="btn btn-secondary" type="button">查看详情</button>
                                        </div>
                                        <div class="email-api-card__body">
                                            <div id="email-api-detail-result" class="email-api-result-block">
                                                <div class="email-api-empty">暂无邮件详情</div>
                                            </div>
                                        </div>
                                    </section>

                                    <section class="email-api-card">
                                        <div class="email-api-card__header">
                                            <div>
                                                <h4>原始详情</h4>
                                            </div>
                                        </div>
                                        <div class="email-api-card__body">
                                            <div id="email-api-raw-detail-result" class="email-api-result-block">
                                                <div class="email-api-empty">暂无原始详情</div>
                                            </div>
                                        </div>
                                    </section>

                                    <section class="email-api-card">
                                        <div class="email-api-card__header">
                                            <div>
                                                <h4>删除邮件</h4>
                                            </div>
                                            <button id="email-api-delete-btn" class="btn btn-danger" type="button">删除邮件</button>
                                        </div>
                                        <div class="email-api-card__body">
                                            <div id="email-api-delete-result" class="email-api-status email-api-status--idle">等待操作</div>
                                        </div>
                                    </section>

                                    <section class="email-api-card">
                                        <div class="email-api-card__header">
                                            <div>
                                                <h4>清空收件箱</h4>
                                            </div>
                                            <button id="email-api-clear-btn" class="btn btn-danger" type="button">清空</button>
                                        </div>
                                        <div class="email-api-card__body">
                                            <div id="email-api-clear-result" class="email-api-status email-api-status--idle">等待操作</div>
                                        </div>
                                    </section>
                                </div>
                            </div>
                        </div>`;
};
