module.exports = function renderRegisterCardsTab() {
  return `<!-- 自动化卡片 Tab -->
                        <div id="tab-cards" class="tab-content active" role="tabpanel">
                            <div class="panel-header">
                                <h3>自动化卡片</h3>
                                <div class="card-actions">
                                    <button id="add-card-btn" class="btn btn-secondary">添加</button>
                                    <button id="refresh-card-btn" class="btn btn-secondary">刷新</button>
                                    <button id="import-card-btn" class="btn btn-secondary">导入</button>
                                    <button id="edit-card-btn" class="btn btn-secondary">编辑</button>
                                    <button id="delete-card-btn" class="btn btn-danger">删除</button>
                                </div>
                            </div>
                            <div class="card-list" id="card-list">
                                <!-- 卡片列表将在这里动态生成 -->
                            </div>

                            <div class="run-control-section control-content">
                                <div class="run-mode">
                                    <button type="button" class="run-mode-btn active" data-run-mode="0" aria-pressed="true">单次运行</button>
                                    <button type="button" class="run-mode-btn" data-run-mode="2" aria-pressed="false">定时执行</button>
                                    <button type="button" class="run-mode-btn" data-run-mode="1" aria-pressed="false">循环运行</button>
                                </div>
                                <div class="setting-item timed-registration-settings" id="registration-timed-settings" hidden>
                                    <div class="setting-title-row">
                                        <label>定时执行</label>
                                    </div>
                                    <div class="timed-registration-fields">
                                        <div class="timed-registration-field">
                                            <label for="registration-timed-count">单次执行数量</label>
                                            <input type="number" id="registration-timed-count" min="1" max="9999" value="1">
                                        </div>
                                        <div class="timed-registration-field">
                                            <label for="registration-timed-cycle-count">最大循环次数</label>
                                            <input type="number" id="registration-timed-cycle-count" min="1" max="9999" value="1">
                                        </div>
                                        <div class="timed-registration-field">
                                            <label for="registration-timed-start-mode">开始方式</label>
                                            <select id="registration-timed-start-mode">
                                                <option value="immediate">立即执行</option>
                                                <option value="delayed">延时开始</option>
                                            </select>
                                        </div>
                                        <div class="timed-registration-field">
                                            <label for="registration-timed-delay-seconds">循环间隔(秒)</label>
                                            <input type="number" id="registration-timed-delay-seconds" min="0" max="3600" value="0" step="1">
                                        </div>
                                    </div>
                                </div>
                                <div class="concurrent-control">
                                    <label for="concurrent-count">并发数量:</label>
                                    <input type="number" id="concurrent-count" min="1" max="10" value="1">
                                </div>

                                <div class="control-buttons">
                                    <button id="start-btn" class="btn btn-primary">开始执行</button>
                                    <button id="stop-btn" class="btn btn-danger" disabled>停止执行</button>
                                </div>
                                <div class="custom-test-account-controls">
                                    <input id="custom-test-account-account" class="custom-test-account-input" type="text" placeholder="账号">
                                    <input id="custom-test-account-password" class="custom-test-account-input" type="password" placeholder="密码">
                                    <button id="custom-test-account-btn" class="btn btn-secondary">自定义测试账号</button>
                                </div>
                            </div>
                        </div>`;
};
