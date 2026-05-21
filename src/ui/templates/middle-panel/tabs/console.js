module.exports = function renderConsoleTab() {
  return `<!-- 控制台输出 -->
                        <div id="middle-tab-console" class="middle-tab-content active" role="tabpanel">
                            <div class="console-panel">
                                <div class="panel-header">
                                    <h3>控制台输出</h3>
                                    <div class="console-actions">
                                        <div class="console-controls">
                                            <label for="log-level">级别:</label>
                                            <select id="log-level">
                                                <option value="DEBUG">DEBUG</option>
                                                <option value="INFO" selected>INFO</option>
                                                <option value="WARNING">WARNING</option>
                                                <option value="ERROR">ERROR</option>
                                            </select>
                                            <label for="auto-scroll">
                                                <input type="checkbox" id="auto-scroll" checked> 自动滚动
                                            </label>
                                        </div>
                                        <button id="clear-console-btn" class="btn btn-secondary">清空</button>
                                    </div>
                                </div>
                                <div class="console-content" id="console-output">
                                    <!-- 控制台输出将在这里显示 -->
                                </div>
                            </div>
                        </div>`;
};
