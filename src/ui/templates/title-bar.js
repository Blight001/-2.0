module.exports = function renderTitleBar() {
  return `<!-- 标题栏 -->
        <div class="title-bar">
            <div class="title-bar-left">
                <h1>AI 自动化工作台</h1>
            </div>
            <div class="title-bar-right">
                <div class="status-info">
                    <span id="task-count">任务 0</span>
                    <span id="cookie-count">Cookie 0</span>
                    <span id="status-label">就绪</span>
                    <span id="license-usage-label" class="status-info__usage">剩余次数：未获取</span>
                </div>
                <button id="theme-toggle-btn" class="title-bar-theme-btn" type="button" aria-pressed="false" aria-label="切换深色浅色模式" title="切换深色浅色模式">
                    深色
                </button>
                <button id="exit-app-btn" class="title-bar-exit-btn" type="button" aria-label="退出应用" title="退出应用">
                    退出
                </button>
            </div>
        </div>`;
};
