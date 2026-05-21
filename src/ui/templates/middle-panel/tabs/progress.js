module.exports = function renderProgressTab() {
  return `<!-- 任务进度 -->
                        <div id="middle-tab-progress" class="middle-tab-content" role="tabpanel" style="display:none;">
                            <div class="progress-panel">
                                <div class="panel-header">
                                    <h3>任务进度</h3>
                                </div>
                                <div class="progress-live-section">
                                    <div class="progress-section-title">当前任务</div>
                                    <div class="progress-list" id="progress-list">
                                        <!-- 任务进度条将在这里动态生成 -->
                                    </div>
                                </div>
                                <div class="task-history-panel" id="task-history-panel">
                                    <div class="task-history-header">
                                        <div>
                                            <div class="progress-section-title">历史记录</div>
                                            <div class="task-history-subtitle">默认展示最新 3 条任务结果，点击“更多历史记录”查看全部</div>
                                        </div>
                                        <div class="task-history-header-actions">
                                            <button type="button" id="task-history-clear-btn" class="task-history-action-btn">清空记录</button>
                                            <button type="button" id="task-history-more-btn" class="task-history-action-btn">更多历史记录</button>
                                            <button type="button" id="task-history-toggle-btn" class="task-history-toggle-btn" aria-expanded="true">折叠</button>
                                        </div>
                                    </div>
                                    <div class="task-history-body" id="task-history-body">
                                        <div class="task-history-list" id="task-history-list">
                                            <!-- 历史任务记录将在这里生成 -->
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>`;
};
