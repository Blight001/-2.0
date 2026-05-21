const { AI_ASSISTANT_CHANNELS } = require('../ai/ai-channels');
const { AiAssistantService } = require('../ai/ai-assistant-service');
const { getBrowserMcpTool } = require('../ai/mcp/browser-mcp');
const { extractOpenUrlRequest, BROWSER_OPEN_URL_CHANNEL } = require('../ai/ai-navigation');

function normalizeString(value) {
    return String(value || '').trim();
}

function getBrowserIds(browserManager) {
    if (!browserManager || !(browserManager.browsers instanceof Map)) {
        return [];
    }

    return Array.from(browserManager.browsers.keys());
}

async function resolveBrowserIdForNavigation(app, preferredBrowserId = '') {
    const browserManager = app?.browserManager || null;
    const targetId = normalizeString(preferredBrowserId);

    if (browserManager) {
        if (targetId && typeof browserManager.getBrowser === 'function' && browserManager.getBrowser(targetId)) {
            return targetId;
        }

        const browserIds = getBrowserIds(browserManager);
        if (browserIds.length > 0) {
            return browserIds[browserIds.length - 1];
        }

        if (typeof browserManager.createBrowser === 'function') {
            const createdBrowserId = await browserManager.createBrowser('electron', false, {});
            if (createdBrowserId) {
                return normalizeString(createdBrowserId);
            }
        }
    }

    return '';
}

function getAiAssistantService(app) {
    if (!app.aiAssistantService) {
        app.aiAssistantService = new AiAssistantService({
            app,
            logger: app.logger
        });
    }

    return app.aiAssistantService;
}

module.exports = function registerAiAssistantHandlers({ app, ipcMain }) {
    const channels = Object.values(AI_ASSISTANT_CHANNELS);
    for (const channel of channels) {
        ipcMain.removeHandler(channel);
    }
    ipcMain.removeHandler(BROWSER_OPEN_URL_CHANNEL);

    ipcMain.handle(AI_ASSISTANT_CHANNELS.GET_CONFIG, async () => {
        try {
            const service = getAiAssistantService(app);
            const config = await service.getConfig();
            return { success: true, config };
        } catch (error) {
            app.logger.error(`获取 AI 配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(AI_ASSISTANT_CHANNELS.SAVE_CONFIG, async (_event, payload = {}) => {
        try {
            const service = getAiAssistantService(app);
            return await service.saveConfig(payload);
        } catch (error) {
            app.logger.error(`保存 AI 配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(AI_ASSISTANT_CHANNELS.GET_HISTORY, async () => {
        try {
            const service = getAiAssistantService(app);
            const history = await service.getConversationHistory();
            return { success: true, history };
        } catch (error) {
            app.logger.error(`获取 AI 对话记录失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(AI_ASSISTANT_CHANNELS.SAVE_HISTORY, async (_event, payload = {}) => {
        try {
            const service = getAiAssistantService(app);
            return await service.saveConversationHistory(payload);
        } catch (error) {
            app.logger.error(`保存 AI 对话记录失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(AI_ASSISTANT_CHANNELS.CLEAR_HISTORY, async () => {
        try {
            const service = getAiAssistantService(app);
            return await service.clearConversationHistory();
        } catch (error) {
            app.logger.error(`清空 AI 对话记录失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(AI_ASSISTANT_CHANNELS.DELETE_HISTORY_SESSION, async (_event, payload = {}) => {
        try {
            const service = getAiAssistantService(app);
            return await service.deleteConversationSession(payload.sessionId);
        } catch (error) {
            app.logger.error(`删除 AI 对话记录失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(BROWSER_OPEN_URL_CHANNEL, async (_event, payload = {}) => {
        try {
            const source = payload && typeof payload === 'object' ? payload : {};
            const request = extractOpenUrlRequest(source.url || source.text || source.message || '');
            const url = normalizeString(source.url || request?.url || '');
            if (!url) {
                return { success: false, error: '打开地址不能为空' };
            }

            const browserId = await resolveBrowserIdForNavigation(app, source.browserId || '');
            if (!browserId) {
                return { success: false, error: '没有可用的内置浏览器实例' };
            }

            const browserMcpTool = getBrowserMcpTool(app, {
                browserManager: app.browserManager,
                logger: app.logger
            });

            if (typeof app.browserManager?.showBrowser === 'function') {
                await app.browserManager.showBrowser(browserId).catch(() => {});
            }

            const result = await browserMcpTool.openUrl(browserId, {
                url,
                newTab: source.newTab !== false,
                waitUntil: source.waitUntil || 'domcontentloaded',
                timeout: Number.isFinite(Number(source.timeout)) ? Number(source.timeout) : 30000,
                settleMs: Number.isFinite(Number(source.settleMs)) ? Number(source.settleMs) : 250
            });

            return {
                success: true,
                browserId,
                url: result.url || url,
                page: result.page || null
            };
        } catch (error) {
            app.logger.error(`打开内置浏览器链接失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(AI_ASSISTANT_CHANNELS.CHAT, async (_event, payload = {}) => {
        try {
            const service = getAiAssistantService(app);
            app.logger.info(`AI 对话 IPC 收到请求: stream=${payload?.stream === true}, requestId=${String(payload?.requestId || '').trim() || 'none'}`);
            const result = await service.sendChat(payload);
            app.logger.info(`AI 对话 IPC 完成: requestId=${String(result?.requestId || payload?.requestId || '').trim() || 'none'}, success=${result?.success === true}`);
            return result;
        } catch (error) {
            app.logger.error(`AI 对话异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};
