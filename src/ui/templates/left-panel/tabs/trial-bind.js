module.exports = function renderTrialBindTab() {
  return `<!-- 海卡兑换 Tab -->
                        <div id="tab-trial-bind" class="tab-content" role="tabpanel" style="display:none;">
                            <div class="trial-bind-tabs">
                                <div class="trial-bind-tab-headers" role="tablist" aria-label="海卡兑换子栏目">
                                    <button class="trial-bind-tab-header active" data-tab="trial-bind-process-tab" role="tab" aria-selected="true">绑定流程</button>
                                    <button class="trial-bind-tab-header" data-tab="trial-bind-redeem-tab" role="tab" aria-selected="false">海卡兑换</button>
                                </div>

                                <div class="trial-bind-tab-contents">
                                    <div id="trial-bind-process-tab" class="trial-bind-tab-content active" role="tabpanel">
                                        <div class="trial-bind-card-section">
                                            <div class="panel-header">
                                                <h3>海卡绑定卡片</h3>
                                                <div class="card-actions">
                                                    <button id="add-haika-bind-card-btn" class="btn btn-secondary">添加</button>
                                                    <button id="import-haika-bind-card-btn" class="btn btn-secondary">导入</button>
                                                    <button id="edit-haika-bind-card-btn" class="btn btn-secondary">编辑</button>
                                                    <button id="delete-haika-bind-card-btn" class="btn btn-danger">删除</button>
                                                </div>
                                            </div>
                                            <div class="card-list" id="haika-bind-card-list">
                                                <!-- 海卡绑定卡片列表将在这里动态生成 -->
                                            </div>
                                        </div>

                                        <div class="settings-content browser-settings-content">
                                            <div class="setting-item">
                                                <label for="haika-bind-account-folder" class="setting-label">绑定账号类型</label>
                                                <select id="haika-bind-account-folder" style="width: 100%; margin-top: 5px;">
                                                    <!-- 选项将动态填充 -->
                                                </select>
                                            </div>
                                            <div class="setting-item">
                                                <label for="haika-bind-account-filter" class="setting-label">账号筛选 (积分)</label>
                                                <select id="haika-bind-account-filter" style="width: 100%; margin-top: 5px;">
                                                    <option value="all">所有账号</option>
                                                    <!-- 其他选项将动态填充 -->
                                                </select>
                                            </div>
                                            <div class="control-buttons">
                                                <button id="haika-bind-start-btn" class="btn btn-primary">开始绑定</button>
                                                <button id="haika-bind-stop-btn" class="btn btn-danger" disabled>停止绑定</button>
                                            </div>
                                        </div>
                                    </div>

                                    <div id="trial-bind-redeem-tab" class="trial-bind-tab-content" role="tabpanel" style="display:none;">
                                        <div class="panel-header">
                                            <h3>海卡兑换</h3>
                                            <div class="card-actions">
                                                <button id="trial-redeem-btn" class="btn btn-primary">兑换海卡</button>
                                                <button id="trial-open-category-modal-btn" class="btn btn-secondary">海卡分类</button>
                                            </div>
                                        </div>

                                        <div class="bind-trial-panel">
                                            <div class="setting-item">
                                                <label for="trial-card-key">海卡卡密</label>
                                                <div class="trial-key-input-wrap">
                                                    <input type="text" id="trial-card-key" placeholder="请输入海卡卡密" autocomplete="off" spellcheck="false">
                                                    <div id="trial-key-suggestions" class="trial-key-suggestions" style="display:none;"></div>
                                                </div>
                                            </div>

                                            <div class="trial-summary-bar">
                                                <span id="trial-status-pill" class="trial-status-pill">等待操作</span>
                                                <span id="trial-cache-tip" class="trial-cache-tip">仅用于接口测试</span>
                                            </div>

                                            <div class="trial-info-panel">
                                                <div class="trial-info-header">
                                                    <h4>重要信息</h4>
                                                    <span class="trial-info-note">兑换成功后自动显示</span>
                                                </div>
                                                <div class="trial-info-grid">
                                                    <div class="trial-info-item">
                                                        <label>卡号</label>
                                                        <div id="trial-card-number" class="trial-info-value">-</div>
                                                    </div>
                                                    <div class="trial-info-item">
                                                        <label>到期时间</label>
                                                        <div id="trial-expiry-date" class="trial-info-value">-</div>
                                                    </div>
                                                    <div class="trial-info-item">
                                                        <label>CVV</label>
                                                        <div id="trial-cvv" class="trial-info-value">-</div>
                                                    </div>
                                                    <div class="trial-info-item">
                                                        <label>用户名</label>
                                                        <div id="trial-name" class="trial-info-value">-</div>
                                                    </div>
                                                    <div class="trial-info-item">
                                                        <label>电话</label>
                                                        <div id="trial-phone" class="trial-info-value">-</div>
                                                    </div>
                                                    <div class="trial-info-item trial-info-item-wide">
                                                        <label>地址</label>
                                                        <div id="trial-address" class="trial-info-value trial-info-multiline">-</div>
                                                    </div>
                                                </div>
                                                <div class="trial-code-row">
                                                    <div class="trial-code-main">
                                                        <label>验证码</label>
                                                        <div id="trial-sms-code" class="trial-code-value">-</div>
                                                    </div>
                                                    <button id="trial-refresh-sms-btn" class="btn btn-secondary">刷新验证码</button>
                                                </div>
                                                <div id="trial-sms-status" class="trial-sms-status">等待刷新验证码</div>
                                            </div>

                                            <div class="trial-response-box">
                                                <div class="trial-response-header">
                                                    <span>兑换返回内容</span>
                                                    <small>用于联调和查看接口响应</small>
                                                </div>
                                                <pre id="trial-response-json" class="trial-response-json">暂无结果</pre>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>`;
};
