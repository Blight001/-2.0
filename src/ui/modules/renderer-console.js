/**
 * 控制台初始化相关的渲染功能。
 */

module.exports = function createRendererConsole(deps) {
    const { elements, consoleManager, logger } = deps;

    function setupConsole() {
        consoleManager.setConsoleElement(elements.consoleOutput);
        consoleManager.setLevel('INFO');
        consoleManager.setAutoScroll(true);

        const logLevelSelect = document.getElementById('log-level');
        const autoScrollCheck = document.getElementById('auto-scroll');

        if (logLevelSelect) {
            logLevelSelect.value = 'INFO';
            logLevelSelect.addEventListener('change', (e) => {
                consoleManager.setLevel(e.target.value);
                logger.info(`日志级别已设置为: ${e.target.value}`);
            });
        }

        if (autoScrollCheck) {
            autoScrollCheck.checked = true;
            autoScrollCheck.addEventListener('change', (e) => {
                consoleManager.setAutoScroll(e.target.checked);
                logger.info(`自动滚动已${e.target.checked ? '启用' : '禁用'}`);
            });
        }

        logger.info('控制台初始化完成');
        logger.info('欢迎使用AI换号器控制台');
    }

        return {
            setupConsole
        };
};
