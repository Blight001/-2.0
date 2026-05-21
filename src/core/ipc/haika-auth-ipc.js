module.exports = function registerHaikaAuthHandlers({ app, ipcMain }) {
    ipcMain.removeHandler('exchange-haika-key');
    ipcMain.removeHandler('haika-fetch-sms');
    ipcMain.removeHandler('haika-get-state');

    ipcMain.handle('exchange-haika-key', async (_event, key) => {
        try {
            if (typeof key !== 'string' || !key.trim()) {
                return { success: false, error: '请输入海卡卡密' };
            }

            const trimmedKey = key.trim();
            app.logger.info(`开始兑换海卡卡密: ${trimmedKey}`);

            const result = await app.licenseManager.exchangeHaikaKey(trimmedKey);
            if (result.success) {
                if (typeof app.saveHaikaLatestExchange === 'function') {
                    await app.saveHaikaLatestExchange({
                        key: trimmedKey,
                        response: result,
                        savedAt: new Date().toISOString(),
                        source: 'exchange-haika-key'
                    });
                }
                app.logger.info(`海卡兑换成功: ${trimmedKey}`);
                return { success: true, result };
            }

            app.logger.warning(`海卡兑换失败: ${result.error}`);
            return result;
        } catch (error) {
            app.logger.error(`海卡兑换异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('haika-fetch-sms', async (_event, smsApiUrl) => {
        try {
            if (typeof smsApiUrl !== 'string' || !smsApiUrl.trim()) {
                return { success: false, error: '验证码接口地址为空' };
            }

            return await app.fetchHaikaSmsCode(smsApiUrl.trim());
        } catch (error) {
            app.logger.error(`获取海卡验证码失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('haika-get-state', async (_event, options = {}) => {
        try {
            if (typeof app.loadHaikaLatestState === 'function') {
                const state = await app.loadHaikaLatestState(options || {});
                return { success: true, state };
            }

            return { success: false, error: '海卡状态服务未初始化' };
        } catch (error) {
            app.logger.error(`读取海卡状态失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};
