/**
 * Cookie测试模块
 * 处理Cookie测试相关的功能
 */

const { ipcRenderer } = require('electron');
const { logger } = require('../console.js');

// 全局状态
let isCookieTesting = false;

/**
 * 开始Cookie测试
 */
async function startCookieTesting(elements, showMessage, logger, loadCookies, testCardName) {
    const taskId = `cookie-test-${Date.now()}`;

    try {
        isCookieTesting = true;
        elements.testCookiesBtn.textContent = '停止测试';
        // elements.testCookiesBtn.disabled = true; // 不需要禁用，用于停止

        // 获取选择的测试文件夹
    const selectedFolder = elements.cookieTestFolder ? elements.cookieTestFolder.value : 'all';
    const selectedFilter = elements.cookieTestFilter ? elements.cookieTestFilter.value : 'all';
    const folderDesc = selectedFolder === 'all' ? '所有文件夹' : `文件夹: ${selectedFolder}`;
    const filterDesc = selectedFilter === 'all' ? '' : ` (筛选: ${selectedFilter})`;

    logger.info(`开始Cookie测试 (使用测试卡片: ${testCardName}, ${folderDesc}${filterDesc})...`);

    // 调用主进程进行测试，传入测试卡片名称、选择的文件夹和筛选类型
    const result = await ipcRenderer.invoke('test-cookies-with-card', testCardName, taskId, selectedFolder, selectedFilter);

        if (result.success) {
            logger.info(`Cookie测试完成 - 总计: ${result.total}, 成功: ${result.successCount}, 失败: ${result.failCount}`);

            if (loadCookies) await loadCookies();

            showMessage(`Cookie测试完成\n总计: ${result.total}\n成功: ${result.successCount}\n失败: ${result.failCount}`,
                      result.failCount === 0 ? 'success' : 'warning');
        } else {
            showMessage(`Cookie测试失败: ${result.error}`, 'error');
        }
    } catch (error) {
        logger.error(`Cookie测试异常: ${error.message}`);
        showMessage(`Cookie测试异常: ${error.message}`, 'error');
    } finally {
        await finishCookieTesting(elements);
    }
}

/**
 * 停止Cookie测试
 */
async function stopCookieTesting(logger, showMessage, finishCookieTestingFn) {
    try {
        logger.info('正在停止Cookie测试...');
        await ipcRenderer.invoke('stop-cookie-testing');
        
        // 我们可以只记录日志，或者不显示弹窗消息
        logger.info('Cookie测试停止信号已发送');
    } catch (error) {
        logger.error(`停止Cookie测试失败: ${error.message}`);
        // 同样，这里的 showMessage 也会失败
    } finally {
        await finishCookieTestingFn();
    }
}

/**
 * 完成Cookie测试（清理状态）
 */
async function finishCookieTesting(elements) {
    isCookieTesting = false;
    elements.testCookiesBtn.textContent = '测试Cookie';
    elements.testCookiesBtn.disabled = false;
}

/**
 * Cookie测试切换处理
 */
async function handleCookieTestToggle(elements, showMessage, startCookieTestingFn, stopCookieTestingFn) {
    if (isCookieTesting) {
        await stopCookieTestingFn();
    } else {
        await startCookieTestingFn();
    }
}

/**
 * 获取Cookie测试状态
 */
function getCookieTestingStatus() {
    return isCookieTesting;
}

/**
 * 测试单个Cookie
 * @param {string} email - 邮箱地址
 * @param {string} testWithCardName - 测试时使用的卡片名称（用于获取卡片配置）
 * @param {string} originalCardName - Cookie关联的原始卡片名称（用于查找cookie）
 * @param {Function} showMessage - 消息显示函数
 */
async function testCookie(email, testWithCardName, originalCardName, showMessage) {
    try {
        // 检查测试用卡片是否存在
        if (testWithCardName) {
            const cardsResult = await ipcRenderer.invoke('load-test-cards');
            if (cardsResult.success) {
                const cardExists = cardsResult.cards.some(card => card.name === testWithCardName);
                if (!cardExists) {
                    showMessage(`请先选择一个有效的测试卡片进行测试`, 'warning');
                    return;
                }
            }
        } else {
            showMessage(`请先在左侧选择一个测试卡片进行测试`, 'warning');
            return;
        }

        showMessage(`正在打开 ${email} 的浏览器窗口，请查看打开的页面...`, 'info');

        const result = await ipcRenderer.invoke('preview-cookie', { email, testWithCardName, originalCardName });
        if (!result.success) {
            showMessage(`打开浏览器失败: ${result.error}`, 'error');
        } else {
            showMessage(`浏览器已打开，未执行测试步骤`, 'success');
        }
    } catch (error) {
        showMessage(`打开浏览器异常: ${error.message}`, 'error');
    }
}

/**
 * 加载Cookie测试配置
 */
async function loadCookieTestConfig(elements) {
    return {
        concurrentCount: elements.concurrentCount ? elements.concurrentCount.value : 1,
        headless: elements.headlessMode ? elements.headlessMode.checked : true
    };
}

/**
 * 更新Cookie测试配置
 */
async function updateCookieTestConfig(elements, logger) {
    const concurrentCount = elements.concurrentCount ? parseInt(elements.concurrentCount.value, 10) || 1 : 1;
    const headless = elements.headlessMode ? elements.headlessMode.checked : true;
    logger.info(`Cookie测试配置已统一跟随注册设置: 并发数=${concurrentCount}, 无头模式=${headless}`);
}

// 导出模块
module.exports = {
    startCookieTesting,
    stopCookieTesting,
    finishCookieTesting,
    handleCookieTestToggle,
    getCookieTestingStatus,
    testCookie,
    loadCookieTestConfig,
    updateCookieTestConfig
};

