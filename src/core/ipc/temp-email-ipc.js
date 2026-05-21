const { TempEmailService } = require('../temp-email/temp-email-service');
const { IPC_CHANNELS } = require('./channels');

let sharedTempEmailService = null;

function getTempEmailService(app) {
    if (app.tempEmailService) {
        sharedTempEmailService = app.tempEmailService;
        sharedTempEmailService.app = app;
        return sharedTempEmailService;
    }

    if (!sharedTempEmailService) {
        sharedTempEmailService = new TempEmailService(app);
    } else {
        sharedTempEmailService.app = app;
    }

    app.tempEmailService = sharedTempEmailService;
    return sharedTempEmailService;
}

module.exports = function registerTempEmailHandlers({ app, ipcMain, dialog, fs, path }) {
    const tempEmailService = getTempEmailService(app);

    const getDialogParentWindow = () => (
        typeof app.getDialogParentWindow === 'function'
            ? app.getDialogParentWindow()
            : undefined
    );

    ipcMain.handle(IPC_CHANNELS.tempEmailLoadConfig, async () => {
        try {
            return {
                success: true,
                config: await tempEmailService.getConfig(),
                state: tempEmailService.getState()
            };
        } catch (error) {
            app.logger.error(`读取临时邮箱配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.tempEmailLoadApiConfig, async () => {
        try {
            const config = await tempEmailService.getConfig();
            return {
                success: true,
                apiConfig: config.apiConfig || tempEmailService.getState().apiConfig,
                state: tempEmailService.getState()
            };
        } catch (error) {
            app.logger.error(`读取临时邮箱 API 配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.tempEmailSetMode, async (_event, payload = {}) => {
        try {
            return await tempEmailService.setMode(payload.mode || payload.selectedMode || 'tcp');
        } catch (error) {
            app.logger.error(`设置临时邮箱模式失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.tempEmailSetProvider, async (_event, payload = {}) => {
        try {
            return await tempEmailService.setProvider(payload.providerId || payload.selectedProviderId || payload.id || '');
        } catch (error) {
            app.logger.error(`设置临时邮箱卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.tempEmailSaveProvider, async (_event, payload = {}) => {
        try {
            return await tempEmailService.saveProvider(payload);
        } catch (error) {
            app.logger.error(`保存临时邮箱卡片失败: ${error.message}`);
            tempEmailService.log('error', `保存临时邮箱卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.tempEmailDeleteProvider, async (_event, providerId = '') => {
        try {
            return await tempEmailService.deleteProvider(providerId);
        } catch (error) {
            app.logger.error(`删除临时邮箱卡片失败: ${error.message}`);
            tempEmailService.log('error', `删除临时邮箱卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.tempEmailImportProviders, async () => {
        try {
            if (!dialog || typeof dialog.showOpenDialog !== 'function') {
                throw new Error('文件选择对话框不可用');
            }

            if (!fs || typeof fs.readFile !== 'function') {
                throw new Error('文件读取能力不可用');
            }

            const { canceled, filePaths } = await dialog.showOpenDialog(getDialogParentWindow(), {
                title: '导入临时邮箱站点',
                filters: [{ name: 'JSON Files', extensions: ['json'] }],
                properties: ['openFile']
            });

            if (canceled || !Array.isArray(filePaths) || filePaths.length === 0) {
                return { success: false, cancelled: true };
            }

            const filePath = filePaths[0];
            const content = await fs.readFile(filePath, 'utf8');
            let parsed;
            try {
                parsed = JSON.parse(content);
            } catch (_error) {
                return { success: false, error: '文件格式错误，不是有效的JSON文件' };
            }

            const result = await tempEmailService.importProviders(parsed);
            if (result && result.success) {
                app.logger.info(`导入临时邮箱站点: ${path ? path.basename(filePath, '.json') : filePath}`);
            }
            return result;
        } catch (error) {
            app.logger.error(`导入临时邮箱站点失败: ${error.message}`);
            tempEmailService.log('error', `导入临时邮箱站点失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.tempEmailOpenProvider, async (_event, payload = {}) => {
        try {
            return await tempEmailService.openProvider(payload);
        } catch (error) {
            app.logger.error(`打开临时邮箱卡片失败: ${error.message}`);
            tempEmailService.log('error', `打开临时邮箱卡片失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.tempEmailRefreshEmail, async (_event, payload = {}) => {
        try {
            return await tempEmailService.refreshEmail(payload);
        } catch (error) {
            app.logger.error(`刷新临时邮箱失败: ${error.message}`);
            tempEmailService.log('error', `刷新临时邮箱失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.tempEmailGetEmail, async (_event, payload = {}) => {
        try {
            return await tempEmailService.getEmail(payload);
        } catch (error) {
            app.logger.error(`获取临时邮箱地址失败: ${error.message}`);
            tempEmailService.log('error', `获取临时邮箱地址失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.tempEmailGetCode, async (_event, payload = {}) => {
        try {
            return await tempEmailService.getCode(payload);
        } catch (error) {
            app.logger.error(`获取临时邮箱验证码失败: ${error.message}`);
            tempEmailService.log('error', `获取临时邮箱验证码失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.tempEmailCloseProvider, async (_event, payload = {}) => {
        try {
            return await tempEmailService.closeSession(payload.sessionId || payload.taskId || payload.browserSessionId || tempEmailService.defaultSessionId);
        } catch (error) {
            app.logger.error(`关闭临时邮箱失败: ${error.message}`);
            tempEmailService.log('error', `关闭临时邮箱失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.tempEmailSaveApiConfig, async (_event, payload = {}) => {
        try {
            return await tempEmailService.setApiConfig(payload);
        } catch (error) {
            app.logger.error(`保存临时邮箱 API 配置失败: ${error.message}`);
            tempEmailService.log('error', `保存临时邮箱 API 配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.outlookFetchContent, async (_event, payload = {}) => {
        try {
            return await tempEmailService.fetchOutlookContent(payload);
        } catch (error) {
            app.logger.error(`获取 Outlook 内容失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('outlook-email-save-records', async (_event, payload = {}) => {
        try {
            return await tempEmailService.saveOutlookAccounts(payload.outlookAccounts || payload.accounts || []);
        } catch (error) {
            app.logger.error(`保存 Outlook 记录失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};
