module.exports = function renderDialogs() {
  return `<!-- 卡片编辑对话框 -->
        <div id="card-dialog" class="dialog-overlay" style="display: none;">
            <div class="dialog">
                <div class="dialog-header">
                    <h3 id="dialog-title">添加注册卡片</h3>
                    <button id="close-dialog-btn" class="close-btn">&times;</button>
                </div>
                <div class="dialog-body">
                    <div class="card-dialog-layout">
                        <!-- 左侧：基本信息 -->
                        <div class="card-left-panel">
                            <form id="card-form">
                                <div class="card-dialog-tabs">
                                    <div class="card-dialog-tab-headers" role="tablist" aria-label="卡片栏目切换">
                                        <button id="card-dialog-base-tab-btn" class="card-dialog-tab-header active" type="button" data-tab="card-dialog-base-tab" role="tab" aria-selected="true">基础栏目</button>
                                        <button id="card-dialog-debug-tab-btn" class="card-dialog-tab-header" type="button" data-tab="card-dialog-debug-tab" role="tab" aria-selected="false">操作调试</button>
                                        <button id="card-dialog-api-service-tab-btn" class="card-dialog-tab-header" type="button" data-tab="card-dialog-api-service-tab" role="tab" aria-selected="false">API服务</button>
                                    </div>

                                    <div class="card-dialog-tab-contents">
                                        <div id="card-dialog-base-tab" class="card-dialog-tab-content active" role="tabpanel">
                                            <div class="card-form-section">
                                                <div class="card-form-section__body">
                                                    <div class="form-group">
                                                        <label for="card-name">卡片名称:</label>
                                                        <input type="text" id="card-name" required>
                                                    </div>
                                                    <div class="form-group">
                                                        <label for="card-website">网站地址:</label>
                                                        <input type="text" id="card-website" placeholder="https://example.com">
                                                    </div>
                                                    <div class="form-group">
                                                        <label for="card-description">描述:</label>
                                                        <textarea id="card-description" rows="3" placeholder="即梦 AI工具自动注册，使用标准步骤流程"></textarea>
                                                    </div>
                                                    <div class="form-group" style="display: none;">
                                                        <label for="card-password">密码:</label>
                                                        <input type="text" id="card-password" placeholder="可以使用 {random} 生成随机密码">
                                                    </div>
                                                    <div class="form-group" style="display: none;">
                                                        <label for="card-points">默认积分:</label>
                                                        <input type="number" id="card-points" value="0">
                                                    </div>
                                                    <div class="form-group" id="card-min-cookie-size-group">
                                                        <label for="card-min-cookie-size">最小Cookie大小(KB):</label>
                                                        <input type="number" id="card-min-cookie-size" value="8" min="0" step="1">
                                                    </div>

                                                    <div class="form-group" id="card-password-random-group">
                                                        <label>密码随机配置:</label>
                                                        <div class="random-config random-config--compact">
                                                            <div class="random-config__row">
                                                                <div class="form-group-inline">
                                                                    <label for="card-password-random-length">密码长度</label>
                                                                    <input type="number" id="card-password-random-length" value="12" min="1" max="50">
                                                                </div>
                                                                <div class="form-group-inline">
                                                                    <label for="card-password-random-type">密码类型</label>
                                                                    <select id="card-password-random-type">
                                                                        <option value="lowercase">小写字母</option>
                                                                        <option value="uppercase">大写字母</option>
                                                                        <option value="letters">大小写字母</option>
                                                                        <option value="numbers">数字</option>
                                                                        <option value="mixed" selected>字母+数字</option>
                                                                        <option value="lowercase_uppercase_numbers">小写+大写+数字</option>
                                                                        <option value="lowercase_uppercase_special">小写+大写+特殊字符</option>
                                                                        <option value="lowercase_numbers_special">小写+数字+特殊字符</option>
                                                                        <option value="uppercase_numbers_special">大写+数字+特殊字符</option>
                                                                        <option value="strong">四类全包含</option>
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div id="card-dialog-debug-tab" class="card-dialog-tab-content" role="tabpanel">
                                            <div class="card-form-section card-form-section--debug">
                                                <div class="card-form-section__body">
                                                    <div id="card-debug-panel" class="card-debug-panel" aria-live="polite">
                                                        <div class="card-debug-panel__header">
                                                            <div class="card-debug-panel__title-group">
                                                                <div class="card-debug-panel__title">调试状态</div>
                                                                <div id="card-debug-status-text" class="card-debug-panel__status-text">未开始</div>
                                                            </div>
                                                            <div class="card-debug-panel__actions">
                                                                <button id="card-debug-loop-btn" class="btn btn-secondary btn-small" type="button" disabled>上一步</button>
                                                                <button id="card-debug-pause-btn" class="btn btn-primary btn-small" type="button" disabled>继续</button>
                                                                <button id="card-debug-step-btn" class="btn btn-secondary btn-small" type="button" disabled>下一步</button>
                                                            </div>
                                                        </div>
                                                        <div class="card-debug-panel__meta">
                                                            <span id="card-debug-progress-text" class="card-debug-panel__progress-text">0%</span>
                                                            <span id="card-debug-step-text" class="card-debug-panel__step-text">当前步骤：-</span>
                                                        </div>
                                                        <div class="card-debug-panel__progress">
                                                            <div id="card-debug-progress-fill" class="card-debug-panel__progress-fill" style="width: 0%;"></div>
                                                        </div>
                                                        <div id="card-debug-hint" class="card-debug-panel__hint">调试启动后每次只执行一步。可选择上一步/下一步，点击“继续”后执行选中的步骤。</div>
                                                    </div>
                                                    <div class="card-step-progress-panel">
                                                        <div class="card-step-progress-panel__header">
                                                            <div class="card-step-progress-panel__title">注册步骤进度</div>
                                                            <div id="card-step-progress-summary" class="card-step-progress-panel__summary">等待调试开始</div>
                                                        </div>
                                                        <div id="card-step-progress-list" class="card-step-progress-list" aria-live="polite">
                                                            <!-- 注册步骤进度将在这里动态生成 -->
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div id="card-dialog-api-service-tab" class="card-dialog-tab-content" role="tabpanel">
                                            <div class="card-form-section card-form-section--api-service">
                                                <div class="card-form-section__header">
                                                    <div class="card-form-section__title">API服务</div>
                                                </div>
                                                <div class="card-form-section__body">
                                                    <div class="form-group">
                                                        <label for="card-api-service-type">服务类型:</label>
                                                        <select id="card-api-service-type">
                                                            <option value="text">文本模型</option>
                                                            <option value="image">图片模型</option>
                                                            <option value="video">视频模型</option>
                                                        </select>
                                                    </div>
                                                    <div class="form-group">
                                                        <label for="card-api-service-endpoint">接口路径:</label>
                                                        <input type="text" id="card-api-service-endpoint" placeholder="/v1/images/generations">
                                                    </div>
                                                    <div class="form-group">
                                                        <label for="card-api-service-params">请求参数:</label>
                                                        <textarea id="card-api-service-params" rows="12" spellcheck="false" placeholder='{
  "model": "",
  "prompt": "",
  "size": "",
  "n": 1,
  "quality": "",
  "response_format": ""
}'></textarea>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>

                        <!-- 右侧：注册步骤 / 弹窗规则 -->
                        <div class="card-right-panel">
                            <div class="card-right-panel-tabs" role="tablist" aria-label="右侧栏目切换">
                                <button id="card-right-panel-steps-tab-btn" class="card-right-panel-tab-header active" type="button" data-tab="card-right-panel-steps-tab" role="tab" aria-selected="true">注册步骤</button>
                                <button id="card-right-panel-popups-tab-btn" class="card-right-panel-tab-header" type="button" data-tab="card-right-panel-popups-tab" role="tab" aria-selected="false">弹窗规则</button>
                            </div>
                            <div class="card-right-panel-tab-contents">
                                <div id="card-right-panel-steps-tab" class="card-right-panel-tab-content active" role="tabpanel">
                                    <div class="card-form-section card-form-section--steps">
                                        <div class="card-form-section__header">
                                            <div class="card-form-section__title">注册步骤</div>
                                        </div>
                                        <div class="card-form-section__body">
                                            <div class="step-editor-toolbar">
                                                <button id="steps-tutorial-btn" class="btn btn-secondary btn-small" type="button" style="padding: 2px 8px; font-size: 12px;">教程</button>
                                                <div class="step-template-picker" id="card-step-template-picker">
                                                    <button id="card-step-template-btn" class="step-template-picker__trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
                                                        <span class="step-template-picker__dot" aria-hidden="true"></span>
                                                        <span id="card-step-template-label" class="step-template-picker__label">访问网页</span>
                                                        <span class="step-template-picker__chevron" aria-hidden="true">▾</span>
                                                    </button>
                                                    <input id="card-step-template-value" type="hidden" value="navigate" aria-hidden="true">
                                                    <div id="card-step-template-menu" class="step-template-picker__menu" role="listbox" aria-label="步骤模板选择" hidden>
                                                        <button type="button" class="step-template-picker__item step-template-picker__item--accent-navigate" data-step-template-option="navigate" role="option" aria-selected="true">访问网页</button>
                                                        <button type="button" class="step-template-picker__item step-template-picker__item--accent-click" data-step-template-option="click" role="option" aria-selected="false">点击元素</button>
                                                        <button type="button" class="step-template-picker__item step-template-picker__item--accent-type" data-step-template-option="type" role="option" aria-selected="false">输入内容</button>
                                                        <button type="button" class="step-template-picker__item step-template-picker__item--accent-wait" data-step-template-option="wait" role="option" aria-selected="false">等待条件</button>
                                                        <button type="button" class="step-template-picker__item step-template-picker__item--accent-screenshot" data-step-template-option="screenshot" role="option" aria-selected="false">截图</button>
                                                        <button type="button" class="step-template-picker__item step-template-picker__item--accent-credits" data-step-template-option="get_credits" role="option" aria-selected="false">获取积分</button>
                                                        <button type="button" class="step-template-picker__item step-template-picker__item--accent-script" data-step-template-option="external_script" role="option" aria-selected="false">执行脚本</button>
                                                        <button type="button" class="step-template-picker__item step-template-picker__item--accent-code" data-step-template-option="wait_verification_code" role="option" aria-selected="false">等待验证码</button>
                                                        <button type="button" class="step-template-picker__item step-template-picker__item--accent-cookie" data-step-template-option="save_cookies" role="option" aria-selected="false">获取Cookie</button>
                                                        <button type="button" class="step-template-picker__item step-template-picker__item--accent-loop" data-step-template-option="loop_click" role="option" aria-selected="false">循环点击</button>
                                                        <button type="button" class="step-template-picker__item step-template-picker__item--accent-proxy" data-step-template-option="clash-system-proxy" role="option" aria-selected="false">切换代理</button>
                                                    </div>
                                                </div>
                                                <button id="card-step-add-btn" class="btn btn-secondary btn-small" type="button" style="padding: 2px 8px; font-size: 12px;">新增步骤</button>
                                                <button id="card-steps-update-btn" class="btn btn-primary btn-small" type="button" style="padding: 2px 8px; font-size: 12px;">更新</button>
                                            </div>
                                            <div id="card-step-editor-list" class="step-editor-list">
                                                <!-- 分段步骤卡片将在这里动态生成 -->
                                            </div>
                                            <textarea id="card-steps" rows="15" style="display:none;" aria-hidden="true" tabindex="-1"></textarea>
                                        </div>
                                    </div>
                                </div>
                                <div id="card-right-panel-popups-tab" class="card-right-panel-tab-content" role="tabpanel">
                                    <div class="card-form-section card-form-section--popups">
                                        <div class="card-form-section__header">
                                            <div class="card-form-section__title">弹窗规则</div>
                                            <button id="popups-tutorial-btn" class="btn btn-secondary btn-small" type="button" style="padding: 2px 8px; font-size: 12px;">教程</button>
                                        </div>
                                        <div class="card-form-section__body">
                                            <textarea id="card-popups" rows="8" placeholder='请输入弹窗规则的JSON配置，例如：
[
  {
    "name": "关闭广告",
    "selector": ".close-btn"
  }
]'></textarea>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                </div>
                <div class="dialog-footer">
                    <button id="debug-card-btn" class="btn btn-warning" type="button">调试运行</button>
                    <button id="save-card-btn" class="btn btn-primary" type="button">保存</button>
                    <button id="cancel-card-btn" class="btn btn-secondary">取消</button>
                </div>
            </div>
        </div>

        <!-- 消息对话框 -->
        <div id="message-dialog" class="dialog-overlay message-dialog" style="display: none;">
            <div class="message-content">
                <p id="message-text"></p>
            </div>
        </div>

        <!-- 确认对话框 -->
        <div id="confirm-dialog" class="dialog-overlay confirm-dialog" style="display: none;">
            <div class="dialog">
                <div class="dialog-header">
                    <h3 id="confirm-title">请确认</h3>
                    <button id="confirm-close-btn" class="close-btn" type="button">&times;</button>
                </div>
                <div class="dialog-body">
                    <div id="confirm-text" class="confirm-text"></div>
                </div>
                <div class="dialog-footer">
                    <button id="confirm-cancel-btn" class="btn btn-secondary" type="button">取消</button>
                    <button id="confirm-ok-btn" class="btn btn-danger" type="button">确认</button>
                </div>
            </div>
        </div>

        <!-- 历史任务弹窗 -->
        <div id="task-history-dialog" class="dialog-overlay task-history-dialog" style="display: none;">
            <div class="dialog">
                <div class="dialog-header">
                    <h3>全部历史记录</h3>
                    <button id="task-history-dialog-close-btn" class="close-btn" type="button">&times;</button>
                </div>
                <div class="dialog-body">
                    <div class="task-history-dialog-note">点击任意记录可展开查看成功说明、失败原因和相关任务信息。</div>
                    <div id="task-history-dialog-list" class="task-history-dialog-list">
                        <!-- 全部历史任务记录将在这里生成 -->
                    </div>
                </div>
                <div class="dialog-footer">
                    <button id="task-history-dialog-close-btn-2" class="btn btn-secondary" type="button">关闭</button>
                </div>
            </div>
        </div>

        <!-- 教程弹窗 -->
        <div id="tutorial-dialog" class="dialog-overlay" style="display: none;">
            <div class="dialog">
                <div class="dialog-header">
                    <h3 id="tutorial-title">配置教程</h3>
                    <button id="close-tutorial-btn" class="close-btn">&times;</button>
                </div>
                <div class="dialog-body">
                    <div id="tutorial-content" class="tutorial-content"></div>
                </div>
                <div class="dialog-footer">
                    <button id="tutorial-ok-btn" class="btn btn-primary">关闭</button>
                </div>
            </div>
        </div>

        <div id="outlook-email-import-dialog" class="dialog-overlay" style="display: none;">
            <div class="dialog">
                <div class="dialog-header">
                    <h3>导入 Outlook 邮箱</h3>
                    <button id="outlook-email-import-close-btn" class="close-btn" type="button">&times;</button>
                </div>
                <div class="dialog-body">
                    <div class="setting-item">
                        <label for="outlook-email-import-text">导入内容</label>
                        <textarea id="outlook-email-import-text" rows="10" placeholder="邮箱----密码----获取链接
qdcr5297@outlook.com----eman4814----http://query.paopaodw.com/t?v=BgUGAFBTS0QhCxMVHwsJCksXCAhtBB4WGlNcQk4"></textarea>
                        <div class="setting-help">每行一条，格式为 邮箱----密码----获取链接。重复邮箱会自动覆盖为最新一条。</div>
                    </div>
                </div>
                <div class="dialog-footer">
                    <button id="outlook-email-import-cancel-btn" class="btn btn-secondary" type="button">取消</button>
                    <button id="outlook-email-import-confirm-btn" class="btn btn-primary" type="button">导入</button>
                </div>
            </div>
        </div>

        <!-- AI 配置弹窗 -->
        <div id="ai-assistant-config-dialog" class="dialog-overlay ai-assistant-config-dialog" style="display: none;">
            <div class="dialog">
                <div class="dialog-header">
                    <h3 id="ai-assistant-config-title">AI 配置</h3>
                    <button id="close-ai-assistant-config-btn" class="close-btn" type="button">&times;</button>
                </div>
                <div class="dialog-body">
                    <div class="ai-assistant-config-dialog-note">
                        <div class="panel-subtitle">API Key 只保存在本机用户目录。当前功能预设会一并保存，浏览器 MCP 会读取这里的设置。</div>
                    </div>
                    <div class="ai-assistant-config-dialog-grid">
                        <div class="form-group">
                            <label for="ai-assistant-config-base-url">接口地址</label>
                            <input type="text" id="ai-assistant-config-base-url" placeholder="https://api.deepseek.com" autocomplete="off" spellcheck="false">
                        </div>
                        <div class="form-group">
                            <label for="ai-assistant-config-model">模型</label>
                            <input type="text" id="ai-assistant-config-model" placeholder="deepseek-chat" autocomplete="off" spellcheck="false">
                        </div>
                        <div class="form-group ai-assistant-config-dialog-key">
                            <label for="ai-assistant-config-api-key">API Key</label>
                            <input type="password" id="ai-assistant-config-api-key" placeholder="留空则继续使用已保存的密钥" autocomplete="off" spellcheck="false">
                        </div>
                        <div class="form-group ai-assistant-config-dialog-profiles">
                            <label>功能预设</label>
                            <div id="ai-assistant-config-active-profiles" class="ai-assistant-config-profile-list" role="group" aria-label="功能预设多选">
                                <label class="ai-assistant-config-profile-option">
                                    <input type="checkbox" value="general" checked>
                                    <span>
                                        <strong>通用对话</strong>
                                        <small>仅启用基础问答，不附加本地页面能力。</small>
                                    </span>
                                </label>
                                <label class="ai-assistant-config-profile-option">
                                    <input type="checkbox" value="browser-mcp">
                                    <span>
                                        <strong>浏览器 MCP</strong>
                                        <small>启用浏览器页面快照与页面操作相关能力。</small>
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>
                    <div class="ai-assistant-config-dialog-note" id="ai-assistant-config-profile-note">可多选，至少选择一个功能预设。</div>
                </div>
                <div class="dialog-footer">
                    <button id="ai-assistant-config-reload-btn" class="btn btn-secondary" type="button">重载当前配置</button>
                    <button id="ai-assistant-config-cancel-btn" class="btn btn-secondary" type="button">取消</button>
                    <button id="ai-assistant-config-save-btn" class="btn btn-primary" type="button">保存配置</button>
                </div>
            </div>
        </div>
    </div>`;
};
