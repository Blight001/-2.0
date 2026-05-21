module.exports = function renderAiTab() {
  return `<!-- AI 管理 -->
                        <div id="middle-tab-ai" class="middle-tab-content" role="tabpanel" style="display:none;">
                            <div class="ai-assistant-panel">
                                <div class="panel-header ai-assistant-panel-header">
                                    <div class="ai-assistant-panel-title-group">
                                        <div class="ai-assistant-panel-title-row">
                                            <h3>AI 管理</h3>
                                            <div id="ai-assistant-config-status" class="ai-assistant-status-pill">未加载</div>
                                        </div>
                                    </div>
                                    <div class="ai-assistant-actions">
                                        <button id="ai-assistant-config-open-btn" class="btn btn-primary" type="button">配置</button>
                                    </div>
                                </div>
                                <div class="ai-assistant-chat-panel">
                                    <div class="ai-assistant-chat-toolbar">
                                        <div>
                                            <div class="ai-assistant-section-title">对话</div>
                                            <div id="ai-assistant-chat-summary" class="ai-assistant-chat-summary">尚未开始对话</div>
                                        </div>
                                        <div class="ai-assistant-chat-actions">
                                            <div class="ai-assistant-history-dropdown" id="ai-assistant-history-dropdown">
                                                <button id="ai-assistant-history-toggle-btn" class="ai-assistant-history-toggle-btn" type="button" aria-haspopup="true" aria-expanded="false">
                                                    <span id="ai-assistant-history-current-label" class="ai-assistant-history-current-label">对话历史</span>
                                                    <span class="ai-assistant-history-caret">▾</span>
                                                </button>
                                                <div id="ai-assistant-history-menu" class="ai-assistant-history-menu" hidden></div>
                                            </div>
                                            <button id="ai-assistant-clear-btn" class="btn btn-secondary" type="button">新建对话</button>
                                        </div>
                                    </div>

                                    <div id="ai-assistant-chat-list" class="ai-assistant-chat-list" aria-live="polite"></div>

                                    <div class="ai-assistant-composer">
                                        <div class="ai-assistant-composer-actions">
                                            <textarea
                                                id="ai-assistant-input"
                                                class="ai-assistant-input"
                                                rows="1"
                                                placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                                            ></textarea>
                                            <button id="ai-assistant-send-btn" class="btn btn-primary" type="button">发送</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>`;
};
