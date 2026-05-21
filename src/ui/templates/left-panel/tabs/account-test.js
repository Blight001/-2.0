module.exports = function renderAccountTestTab() {
  return `<!-- 账号测试 Tab -->
                        <div id="tab-account-test" class="tab-content" role="tabpanel" style="display:none;">
                            <div class="panel-header">
                                <h3>测试卡片</h3>
                                <div class="card-actions">
                                    <button id="add-test-card-btn" class="btn btn-secondary">添加</button>
                                    <button id="import-test-card-btn" class="btn btn-secondary">导入</button>
                                    <button id="edit-test-card-btn" class="btn btn-secondary">编辑</button>
                                    <button id="delete-test-card-btn" class="btn btn-danger">删除</button>
                                </div>
                            </div>
                            <div class="card-list" id="test-card-list">
                                <!-- 测试卡片列表将在这里动态生成 -->
                            </div>

                            <div class="settings-content browser-settings-content">
                                <div class="setting-item">
                                    <label for="cookie-test-folder" class="setting-label">
                                        测试文件夹
                                    </label>
                                    <select id="cookie-test-folder" style="width: 100%; margin-top: 5px;">
                                        <!-- 选项将动态填充 -->
                                    </select>
                                </div>
                                <div class="setting-item">
                                    <label for="cookie-test-filter" class="setting-label">
                                        账号筛选 (积分)
                                    </label>
                                    <select id="cookie-test-filter" style="width: 100%; margin-top: 5px;">
                                        <option value="all">所有账号</option>
                                        <!-- 其他选项将动态填充 -->
                                    </select>
                                </div>
                                <div class="control-buttons">
                                    <button id="test-cookies-btn" class="btn btn-primary" style="width: 100%;">测试Cookie</button>
                                </div>
                            </div>
                        </div>`;
};
