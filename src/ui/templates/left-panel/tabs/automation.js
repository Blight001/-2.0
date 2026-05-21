module.exports = function renderAutomationTab() {
  return `<!-- 自动化管理 Tab -->
                        <div id="tab-automation" class="tab-content" role="tabpanel" style="display:none;">
                            <div class="panel-header">
                                <h3>API卡片</h3>
                                <div class="card-actions">
                                    <button id="add-api-card-btn" class="btn btn-secondary">添加</button>
                                    <button id="import-api-card-btn" class="btn btn-secondary">导入</button>
                                    <button id="refresh-api-card-btn" class="btn btn-secondary">刷新</button>
                                    <button id="edit-api-card-btn" class="btn btn-secondary">编辑</button>
                                    <button id="delete-api-card-btn" class="btn btn-danger">删除</button>
                                </div>
                            </div>
                            <div class="card-list" id="api-card-list">
                                <!-- API卡片列表将在这里动态生成 -->
                            </div>

                            <div class="panel-header" style="margin-top: 16px;">
                                <h3>模型卡片</h3>
                                <div class="card-actions">
                                    <button id="add-model-card-btn" class="btn btn-secondary">添加</button>
                                    <button id="import-model-card-btn" class="btn btn-secondary">导入</button>
                                    <button id="refresh-model-card-btn" class="btn btn-secondary">刷新</button>
                                    <button id="edit-model-card-btn" class="btn btn-secondary">编辑</button>
                                    <button id="delete-model-card-btn" class="btn btn-danger">删除</button>
                                </div>
                            </div>
                            <div class="card-list" id="model-card-list">
                                <!-- 模型卡片列表将在这里动态生成 -->
                            </div>
                        </div>`;
};
