const { detectAllBrowsers } = require('../browser/browser_detector');
const { IPC_CHANNELS } = require('./channels');
const {
    filterAutomationCards,
    isAllowedAutomationCardName,
    isUnlimitedAutomationCardAccess
} = require('../execution/execution-ui-state');

module.exports = function registerCardHandlers({ app, ipcMain, dialog, fs, path }) {
    const isControlLocked = () => typeof app.isExecutionControlLocked === 'function' && app.isExecutionControlLocked();
    const blockLockedAction = (actionLabel) => ({
        success: false,
        error: `服务器已禁止控制，${actionLabel}已禁用`
    });

    const setCurrentCardSelection = (fieldName, fieldNameWithSuffix, cardName) => {
        const normalizedName = String(cardName || '').trim();
        app[fieldName] = normalizedName;
        app[fieldNameWithSuffix] = normalizedName;
        return normalizedName;
    };

    const getDialogParentWindow = () => (
        typeof app.getDialogParentWindow === 'function'
            ? app.getDialogParentWindow()
            : undefined
    );

    const getPrimaryUiWindow = () => {
        const candidates = [
            app.mainWindow || null,
            app.desktopWindow || null,
            app.loginWindow || null
        ];

        return candidates.find((window) => window && window.webContents && typeof window.webContents.send === 'function' && !window.isDestroyed?.()) || null;
    };

    const refreshCardListForMode = async (cardMode) => {
        const primaryWindow = getPrimaryUiWindow();
        if (!primaryWindow) {
            return;
        }

        try {
            if (cardMode === 'api') {
                const cards = await app.cardManager.loadApiCards({ forceReload: true });
                primaryWindow.webContents.send('api-cards-loaded', cards);
                return;
            }

            if (cardMode === 'model') {
                const cards = await app.cardManager.loadModelCards({ forceReload: true });
                primaryWindow.webContents.send('model-cards-loaded', cards);
            }
        } catch (error) {
            app.logger?.warning?.(`刷新${cardMode === 'api' ? 'API' : '模型'}卡片列表失败: ${error.message}`);
        }
    };

    const normalizeBrowserUrl = (value) => {
        const raw = String(value || '').trim();
        if (!raw) {
            return '';
        }

        if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw)) {
            return raw;
        }

        return `https://${raw}`;
    };

    const refreshClashDnsLeakProtection = async (settings = {}) => {
        if (!app.clashManager || typeof app.clashManager.applyDnsLeakProtection !== 'function') {
            return false;
        }

        let clashState = app.clashState || null;
        if (!clashState && typeof app.clashManager.getStatus === 'function') {
            try {
                const status = await app.clashManager.getStatus();
                if (status && status.success && status.data) {
                    clashState = status.data;
                    app.clashState = { ...status.data };
                }
            } catch (error) {
                app.logger.warn(`读取Clash状态失败，跳过DNS刷新: ${error.message}`);
            }
        }

        if (!clashState || (clashState.tunMode !== true && clashState.systemProxy !== true)) {
            return false;
        }

        return await app.clashManager.applyDnsLeakProtection({
            ...(settings && typeof settings === 'object' ? settings : {}),
            currentNode: clashState.currentNode || '',
            current_node: clashState.currentNode || ''
        });
    };

    ipcMain.handle('load-cards', async (_event, options = {}) => {
        try {
            const cards = await app.cardManager.loadCards(options);
            const allowAllAutomationCards = isUnlimitedAutomationCardAccess(app);
            return {
                success: true,
                cards: allowAllAutomationCards ? cards : filterAutomationCards(cards, 'automation'),
                allowAllAutomationCards
            };
        } catch (error) {
            app.logger.error(`加载卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('load-test-cards', async (_event, options = {}) => {
        try {
            const cards = await app.cardManager.loadTestCards(options);
            return { success: true, cards };
        } catch (error) {
            app.logger.error(`加载测试卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('load-api-cards', async (_event, options = {}) => {
        try {
            const cards = await app.cardManager.loadApiCards(options);
            return { success: true, cards };
        } catch (error) {
            app.logger.error(`加载API卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('load-model-cards', async (_event, options = {}) => {
        try {
            const cards = await app.cardManager.loadModelCards(options);
            return { success: true, cards };
        } catch (error) {
            app.logger.error(`加载模型卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('load-haika-bind-cards', async (_event, options = {}) => {
        try {
            const cards = await app.cardManager.loadHaikaBindCards(options);
            return { success: true, cards };
        } catch (error) {
            app.logger.error(`加载海卡绑定卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('import-card', async () => {
        if (isControlLocked()) {
            return blockLockedAction('导入自动化卡片');
        }
        try {
            const { canceled, filePaths } = await dialog.showOpenDialog(getDialogParentWindow(), {
                title: '导入自动化卡片',
                filters: [{ name: 'JSON Files', extensions: ['json'] }],
                properties: ['openFile']
            });

            if (canceled || filePaths.length === 0) {
                return { success: false, cancelled: true };
            }

            const filePath = filePaths[0];
            const content = await fs.readFile(filePath, 'utf8');
            let cardData;

            try {
                cardData = JSON.parse(content);
            } catch (_error) {
                return { success: false, error: '文件格式错误，不是有效的JSON文件' };
            }

            if (!cardData.name) {
                cardData.name = path.basename(filePath, '.json');
            }

            const success = await app.cardManager.saveCard(cardData);
            if (success) {
                app.logger.info(`导入卡片: ${cardData.name}`);
                return { success: true };
            }

            return { success: false, error: '保存卡片失败' };
        } catch (error) {
            app.logger.error(`导入卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('import-test-card', async () => {
        if (isControlLocked()) {
            return blockLockedAction('导入测试卡片');
        }
        try {
            const { canceled, filePaths } = await dialog.showOpenDialog(getDialogParentWindow(), {
                title: '导入测试卡片',
                filters: [{ name: 'JSON Files', extensions: ['json'] }],
                properties: ['openFile']
            });

            if (canceled || filePaths.length === 0) {
                return { success: false, cancelled: true };
            }

            const filePath = filePaths[0];
            const content = await fs.readFile(filePath, 'utf8');
            let cardData;

            try {
                cardData = JSON.parse(content);
            } catch (_error) {
                return { success: false, error: '文件格式错误，不是有效的JSON文件' };
            }

            if (!cardData.name) {
                cardData.name = path.basename(filePath, '.json');
            }

            const success = await app.cardManager.saveTestCard(cardData);
            if (success) {
                app.logger.info(`导入测试卡片: ${cardData.name}`);
                return { success: true };
            }

            return { success: false, error: '保存测试卡片失败' };
        } catch (error) {
            app.logger.error(`导入测试卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('import-api-card', async () => {
        if (isControlLocked()) {
            return blockLockedAction('导入API卡片');
        }
        try {
            const { canceled, filePaths } = await dialog.showOpenDialog(getDialogParentWindow(), {
                title: '导入API卡片',
                filters: [{ name: 'JSON Files', extensions: ['json'] }],
                properties: ['openFile']
            });

            if (canceled || filePaths.length === 0) {
                return { success: false, cancelled: true };
            }

            const filePath = filePaths[0];
            const content = await fs.readFile(filePath, 'utf8');
            let cardData;

            try {
                cardData = JSON.parse(content);
            } catch (_error) {
                return { success: false, error: '文件格式错误，不是有效的JSON文件' };
            }

            if (!cardData.name) {
                cardData.name = path.basename(filePath, '.json');
            }

            const success = await app.cardManager.saveApiCard(cardData);
            if (success) {
                app.logger.info(`导入API卡片: ${cardData.name}`);
                return { success: true };
            }

            return { success: false, error: '保存API卡片失败' };
        } catch (error) {
            app.logger.error(`导入API卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('import-model-card', async () => {
        if (isControlLocked()) {
            return blockLockedAction('导入模型卡片');
        }
        try {
            const { canceled, filePaths } = await dialog.showOpenDialog(getDialogParentWindow(), {
                title: '导入模型卡片',
                filters: [{ name: 'JSON Files', extensions: ['json'] }],
                properties: ['openFile']
            });

            if (canceled || filePaths.length === 0) {
                return { success: false, cancelled: true };
            }

            const filePath = filePaths[0];
            const content = await fs.readFile(filePath, 'utf8');
            let cardData;

            try {
                cardData = JSON.parse(content);
            } catch (_error) {
                return { success: false, error: '文件格式错误，不是有效的JSON文件' };
            }

            if (!cardData.name) {
                cardData.name = path.basename(filePath, '.json');
            }

            const success = await app.cardManager.saveModelCard(cardData);
            if (success) {
                app.logger.info(`导入模型卡片: ${cardData.name}`);
                return { success: true };
            }

            return { success: false, error: '保存模型卡片失败' };
        } catch (error) {
            app.logger.error(`导入模型卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('import-haika-bind-card', async () => {
        if (isControlLocked()) {
            return blockLockedAction('导入海卡绑定卡片');
        }
        try {
            const { canceled, filePaths } = await dialog.showOpenDialog(getDialogParentWindow(), {
                title: '导入海卡绑定卡片',
                filters: [{ name: 'JSON Files', extensions: ['json'] }],
                properties: ['openFile']
            });

            if (canceled || filePaths.length === 0) {
                return { success: false, cancelled: true };
            }

            const filePath = filePaths[0];
            const content = await fs.readFile(filePath, 'utf8');
            let cardData;

            try {
                cardData = JSON.parse(content);
            } catch (_error) {
                return { success: false, error: '文件格式错误，不是有效的JSON文件' };
            }

            if (!cardData.name) {
                cardData.name = path.basename(filePath, '.json');
            }

            const success = await app.cardManager.saveHaikaBindCard(cardData);
            if (success) {
                app.logger.info(`导入海卡绑定卡片: ${cardData.name}`);
                return { success: true };
            }

            return { success: false, error: '保存海卡绑定卡片失败' };
        } catch (error) {
            app.logger.error(`导入海卡绑定卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('save-card', async (_event, cardData) => {
        if (isControlLocked()) {
            return blockLockedAction('保存自动化卡片');
        }
        try {
            const success = await app.cardManager.saveCard(cardData);
            if (success) {
                app.logger.info(`保存卡片: ${cardData.name}`);
                return { success: true };
            }

            return { success: false, error: '保存卡片失败' };
        } catch (error) {
            app.logger.error(`保存卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('save-test-card', async (_event, cardData) => {
        if (isControlLocked()) {
            return blockLockedAction('保存测试卡片');
        }
        try {
            const success = await app.cardManager.saveTestCard(cardData);
            if (success) {
                app.logger.info(`保存测试卡片: ${cardData.name}`);
                return { success: true };
            }

            return { success: false, error: '保存测试卡片失败' };
        } catch (error) {
            app.logger.error(`保存测试卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('save-api-card', async (_event, cardData) => {
        if (isControlLocked()) {
            return blockLockedAction('保存API卡片');
        }
        try {
            const success = await app.cardManager.saveApiCard(cardData);
            if (success) {
                app.logger.info(`保存API卡片: ${cardData.name}`);
                await refreshCardListForMode('api');
                return { success: true };
            }

            return { success: false, error: '保存API卡片失败' };
        } catch (error) {
            app.logger.error(`保存API卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('save-model-card', async (_event, cardData) => {
        if (isControlLocked()) {
            return blockLockedAction('保存模型卡片');
        }
        try {
            const success = await app.cardManager.saveModelCard(cardData);
            if (success) {
                app.logger.info(`保存模型卡片: ${cardData.name}`);
                await refreshCardListForMode('model');
                return { success: true };
            }

            return { success: false, error: '保存模型卡片失败' };
        } catch (error) {
            app.logger.error(`保存模型卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('save-haika-bind-card', async (_event, cardData) => {
        if (isControlLocked()) {
            return blockLockedAction('保存海卡绑定卡片');
        }
        try {
            const success = await app.cardManager.saveHaikaBindCard(cardData);
            if (success) {
                app.logger.info(`保存海卡绑定卡片: ${cardData.name}`);
                return { success: true };
            }

            return { success: false, error: '保存海卡绑定卡片失败' };
        } catch (error) {
            app.logger.error(`保存海卡绑定卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('debug-card', async (_event, payload = {}) => {
        if (isControlLocked()) {
            return blockLockedAction('调试卡片');
        }
        try {
            return await app.startCardDebugTask(payload);
        } catch (error) {
            app.logger.error(`启动卡片调试失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.cardDebugAction, async (_event, payload = {}) => {
        if (isControlLocked()) {
            return blockLockedAction('调试动作');
        }
        try {
            if (typeof app.handleCardDebugAction !== 'function') {
                return { success: false, error: '调试动作处理器不可用' };
            }
            return await app.handleCardDebugAction(payload);
        } catch (error) {
            app.logger.error(`执行卡片调试动作失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-card', async (_event, cardName) => {
        try {
            const card = await app.cardManager.getCard(cardName);
            if (card) {
                return { success: true, card };
            }

            return { success: false, error: `卡片不存在: ${cardName}` };
        } catch (error) {
            app.logger.error(`获取卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-test-card', async (_event, cardName) => {
        try {
            const card = await app.cardManager.getTestCard(cardName);
            if (card) {
                return { success: true, card };
            }

            return { success: false, error: `测试卡片不存在: ${cardName}` };
        } catch (error) {
            app.logger.error(`获取测试卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-api-card', async (_event, cardName) => {
        try {
            const card = await app.cardManager.getApiCard(cardName);
            if (card) {
                return { success: true, card };
            }

            return { success: false, error: `API卡片不存在: ${cardName}` };
        } catch (error) {
            app.logger.error(`获取API卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-model-card', async (_event, cardName) => {
        try {
            const card = await app.cardManager.getModelCard(cardName);
            if (card) {
                return { success: true, card };
            }

            return { success: false, error: `模型卡片不存在: ${cardName}` };
        } catch (error) {
            app.logger.error(`获取模型卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-haika-bind-card', async (_event, cardName) => {
        try {
            const card = await app.cardManager.getHaikaBindCard(cardName);
            if (card) {
                return { success: true, card };
            }

            return { success: false, error: `海卡绑定卡片不存在: ${cardName}` };
        } catch (error) {
            app.logger.error(`获取海卡绑定卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-card', async (_event, cardName) => {
        if (isControlLocked()) {
            return blockLockedAction('删除自动化卡片');
        }
        try {
            const success = await app.cardManager.deleteCard(cardName);
            if (success) {
                app.logger.info(`删除卡片: ${cardName}`);
                return { success: true };
            }

            return { success: false, error: `删除卡片失败: ${cardName}` };
        } catch (error) {
            app.logger.error(`删除卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-test-card', async (_event, cardName) => {
        if (isControlLocked()) {
            return blockLockedAction('删除测试卡片');
        }
        try {
            const success = await app.cardManager.deleteTestCard(cardName);
            if (success) {
                app.logger.info(`删除测试卡片: ${cardName}`);
                return { success: true };
            }

            return { success: false, error: `删除测试卡片失败: ${cardName}` };
        } catch (error) {
            app.logger.error(`删除测试卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-api-card', async (_event, cardName) => {
        if (isControlLocked()) {
            return blockLockedAction('删除API卡片');
        }
        try {
            const success = await app.cardManager.deleteApiCard(cardName);
            if (success) {
                app.logger.info(`删除API卡片: ${cardName}`);
                return { success: true };
            }

            return { success: false, error: `删除API卡片失败: ${cardName}` };
        } catch (error) {
            app.logger.error(`删除API卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-model-card', async (_event, cardName) => {
        if (isControlLocked()) {
            return blockLockedAction('删除模型卡片');
        }
        try {
            const success = await app.cardManager.deleteModelCard(cardName);
            if (success) {
                app.logger.info(`删除模型卡片: ${cardName}`);
                return { success: true };
            }

            return { success: false, error: `删除模型卡片失败: ${cardName}` };
        } catch (error) {
            app.logger.error(`删除模型卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-haika-bind-card', async (_event, cardName) => {
        if (isControlLocked()) {
            return blockLockedAction('删除海卡绑定卡片');
        }
        try {
            const success = await app.cardManager.deleteHaikaBindCard(cardName);
            if (success) {
                app.logger.info(`删除海卡绑定卡片: ${cardName}`);
                return { success: true };
            }

            return { success: false, error: `删除海卡绑定卡片失败: ${cardName}` };
        } catch (error) {
            app.logger.error(`删除海卡绑定卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-browser-settings', async (_event, settings) => {
        const incomingSettings = settings && typeof settings === 'object' ? settings : {};
        const normalizedSettings = {
            ...(app.browserSettings && typeof app.browserSettings === 'object' ? app.browserSettings : {}),
            ...incomingSettings
        };
        if (normalizedSettings.browser_type && !normalizedSettings.browserType) {
            normalizedSettings.browserType = normalizedSettings.browser_type;
        }
        if (normalizedSettings.browserType && !normalizedSettings.browser_type) {
            normalizedSettings.browser_type = normalizedSettings.browserType;
        }
        if (normalizedSettings.removeWatermarkPlugin !== undefined && normalizedSettings.remove_watermark_plugin === undefined) {
            normalizedSettings.remove_watermark_plugin = normalizedSettings.removeWatermarkPlugin;
        }
        if (normalizedSettings.remove_watermark_plugin !== undefined && normalizedSettings.removeWatermarkPlugin === undefined) {
            normalizedSettings.removeWatermarkPlugin = normalizedSettings.remove_watermark_plugin;
        }

        app.browserSettings = normalizedSettings;
        if (app.cookieTester && typeof app.cookieTester.setBrowserSettings === 'function') {
            app.cookieTester.setBrowserSettings(normalizedSettings);
        }
        if (normalizedSettings.browser_type) {
            app.currentBrowserType = normalizedSettings.browser_type;
            app.logger.info(`更新浏览器类型: ${app.currentBrowserType}`);
        }
        await refreshClashDnsLeakProtection(normalizedSettings);

        const persistResult = typeof app.saveBrowserSettingsToConfig === 'function'
            ? await app.saveBrowserSettingsToConfig(normalizedSettings, {
                source: 'update-browser-settings'
            })
            : { success: true };
        if (persistResult?.success === false) {
            return { success: false, error: persistResult.error || '保存浏览器设置失败' };
        }

        return { success: true, persisted: true };
    });

    const openBrowserUrlHandler = async (_event, payload = {}) => {
        if (isControlLocked()) {
            return blockLockedAction('通过浏览器打开页面');
        }
        try {
            const source = typeof payload === 'string'
                ? { url: payload }
                : (payload && typeof payload === 'object' ? payload : {});

            const targetUrl = normalizeBrowserUrl(source.url || source.href || source.link || '');
            if (!targetUrl) {
                return { success: false, error: 'URL 不能为空' };
            }

            if (!/^https?:\/\//i.test(targetUrl)) {
                return { success: false, error: '仅支持 http 或 https 链接' };
            }

            if (!app.browserManager || typeof app.browserManager.createBrowser !== 'function') {
                return { success: false, error: '浏览器管理器不可用' };
            }

            const browserType = String(
                source.browserType ||
                app.currentBrowserType ||
                app.browserSettings?.browser_type ||
                app.browserSettings?.browserType ||
                'electron'
            ).trim().toLowerCase() || 'electron';

            const browserSettings = {
                ...(app.browserSettings && typeof app.browserSettings === 'object' ? app.browserSettings : {}),
                ...(source.browserSettings && typeof source.browserSettings === 'object' ? source.browserSettings : {}),
                headless: false
            };
            delete browserSettings.browser_type;
            delete browserSettings.browserType;

            app.logger.info(`通过浏览器打开页面: ${targetUrl} (${browserType})`);

            const browserId = await app.browserManager.createBrowser(browserType, false, browserSettings);
            const page = app.browserManager.getBrowser(browserId);
            if (!page) {
                throw new Error('无法获取浏览器页面');
            }

            let navigationWarning = '';
            try {
                await page.goto(targetUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: Number.isFinite(Number(source.timeout)) ? Number(source.timeout) : 30000
                });
            } catch (navigationError) {
                navigationWarning = navigationError.message || '页面加载失败';
                app.logger.warning(`浏览器打开 ${targetUrl} 时加载失败: ${navigationWarning}`);
            }

            try {
                if (typeof page.bringToFront === 'function') {
                    await page.bringToFront();
                }
            } catch (_error) {}

            return {
                success: true,
                browserId,
                url: targetUrl,
                warning: navigationWarning
            };
        } catch (error) {
            app.logger.error(`通过浏览器打开页面失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    };

    ipcMain.handle('open-browser-url', openBrowserUrlHandler);

    ipcMain.handle('detect-browser', async () => {
        try {
            const browsers = await detectAllBrowsers();

            if (browsers.length > 0) {
                app.logger.info(`成功检测到 ${browsers.length} 个浏览器: ${browsers.map((browser) => browser.name).join(', ')}`);
                return { success: true, browsers };
            }

            app.logger.warning('未检测到系统浏览器');
            return { success: false, error: '未检测到系统浏览器' };
        } catch (error) {
            app.logger.error(`浏览器检测失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-current-card', async (_event, cardName) => {
        try {
            if (isControlLocked()) {
                return blockLockedAction('手动切换自动化卡片');
            }

            const allowAllAutomationCards = isUnlimitedAutomationCardAccess(app);
            if (!allowAllAutomationCards && !isAllowedAutomationCardName(cardName)) {
                return {
                    success: false,
                    error: '自动化卡片页面仅允许使用国际版即梦自动化卡片'
                };
            }

            const normalizedName = setCurrentCardSelection('currentCard', 'currentCardName', cardName);
            app.logger.info(`设置当前卡片: ${normalizedName}`);
            return { success: true };
        } catch (error) {
            app.logger.error(`设置当前卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-current-test-card', async (_event, cardName) => {
        try {
            if (isControlLocked()) {
                return blockLockedAction('手动切换测试卡片');
            }

            const normalizedName = setCurrentCardSelection('currentTestCard', 'currentTestCardName', cardName);
            app.logger.info(`设置当前测试卡片: ${normalizedName}`);
            return { success: true };
        } catch (error) {
            app.logger.error(`设置当前测试卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-current-api-card', async (_event, cardName) => {
        try {
            if (isControlLocked()) {
                return blockLockedAction('手动切换API卡片');
            }

            const normalizedName = setCurrentCardSelection('currentApiCard', 'currentApiCardName', cardName);
            app.logger.info(`设置当前API卡片: ${normalizedName}`);
            return { success: true };
        } catch (error) {
            app.logger.error(`设置当前API卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-current-model-card', async (_event, cardName) => {
        try {
            if (isControlLocked()) {
                return blockLockedAction('手动切换模型卡片');
            }

            const normalizedName = setCurrentCardSelection('currentModelCard', 'currentModelCardName', cardName);
            app.logger.info(`设置当前模型卡片: ${normalizedName}`);
            return { success: true };
        } catch (error) {
            app.logger.error(`设置当前模型卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-current-haika-bind-card', async (_event, cardName) => {
        try {
            if (isControlLocked()) {
                return blockLockedAction('手动切换海卡绑定卡片');
            }

            const normalizedName = setCurrentCardSelection('currentHaikaBindCard', 'currentHaikaBindCardName', cardName);
            app.logger.info(`设置当前海卡绑定卡片: ${normalizedName}`);
            return { success: true };
        } catch (error) {
            app.logger.error(`设置当前海卡绑定卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};
