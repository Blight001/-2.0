module.exports = function renderHaikaModal() {
  return `<!-- 海卡分类弹窗 -->
    <div id="haika-category-modal" class="modal">
        <div class="modal-content" style="max-width: 760px;">
            <div class="modal-header">
                <h3>海卡分类管理</h3>
                <button id="close-haika-category-modal-btn" class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="trial-category-panel">
                    <div class="trial-category-row">
                        <div class="setting-item trial-category-select-group">
                            <label for="trial-category-select">海卡分类</label>
                            <select id="trial-category-select"></select>
                        </div>
                        <div class="setting-item trial-category-name-group">
                            <label for="trial-category-name">新建分类</label>
                            <input type="text" id="trial-category-name" placeholder="输入分类名">
                        </div>
                        <div class="trial-category-actions trial-category-actions-inline">
                            <button id="trial-create-category-btn" class="btn btn-secondary">新建分类</button>
                            <button id="trial-refresh-categories-btn" class="btn btn-secondary">刷新分类</button>
                        </div>
                    </div>
                </div>
                <div class="haika-import-panel">
                    <div class="trial-category-row">
                        <div class="setting-item trial-category-select-group">
                            <label for="haika-import-target-category">导入到分类</label>
                            <input type="text" id="haika-import-target-category" readonly>
                        </div>
                    </div>
                    <div class="setting-item">
                        <label for="haika-import-text">卡密内容</label>
                        <textarea id="haika-import-text" rows="10" placeholder="请直接粘贴卡密内容，一行一条"></textarea>
                    </div>
                    <div id="haika-import-hint" style="margin-top: 8px; font-size: 12px; color: var(--text-muted);">
                        支持按换行导入，会自动忽略空行和以 #、// 开头的注释行。
                    </div>
                    <div class="trial-category-actions" style="margin-top: 12px;">
                        <button id="haika-import-confirm-btn" class="btn btn-primary">开始导入</button>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button id="close-haika-category-modal-btn-2" class="btn btn-secondary">关闭</button>
            </div>
        </div>
    </div>`;
};
