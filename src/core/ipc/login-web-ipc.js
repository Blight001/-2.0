module.exports = function initWebLoginHandlers({ app, ipcMain }) {

    if (!app.__rpcExitAppHandlerRegistered) {
        ipcMain.handle('exit-app', async () => {
            try {
                if (app.__exitRequested) {
                    return { success: true, alreadyRequested: true };
                }

                app.__exitRequested = true;

                setImmediate(() => {
                    Promise.resolve(app.cleanupAndExit?.())
                        .catch((error) => {
                            app.logger?.error?.(`退出应用失败: ${error.message}`);
                        });
                });

                return { success: true };
            } catch (error) {
                app.logger?.error?.(`调度退出应用失败: ${error.message}`);
                return { success: false, error: error.message };
            }
        });
        app.__rpcExitAppHandlerRegistered = true;
    }

    ipcMain.handle('get-device-id', () => {
        return app.licenseManager.getDeviceId();
    });

    ipcMain.handle('validate-card-key', async (_event, data) => {
        if (app.devMode) {
            const trimmedKey = typeof data?.key === 'string' ? data.key.trim() : '';
            if (trimmedKey) {
                app.currentCardKey = trimmedKey;
                app.currentCardKeyPrefix = trimmedKey.slice(0, 4);
            }
            app.currentCardUsageSnapshot = null;
            app.licenseUsageLocked = false;
            app.logger.warning('开发模式下已跳过卡密验证');
            return { success: true, devMode: true };
        }

        const result = await app.licenseManager.validateCardKey(data?.key, data?.deviceId);
        if (result && result.success) {
            const trimmedKey = typeof data?.key === 'string' ? data.key.trim() : '';
            app.currentCardKey = trimmedKey;
            app.currentCardKeyPrefix = trimmedKey.slice(0, 4);
            const cacheResult = typeof app.saveCardKeyToCache === 'function'
                ? await app.saveCardKeyToCache(trimmedKey, {
                    source: 'login-web-ipc',
                    result,
                    usageInfo: result.usageInfo || null
                })
                : null;
            if (cacheResult?.cache?.usageInfo) {
                result.usageInfo = cacheResult.cache.usageInfo;
            }
            if (typeof app.scheduleLicenseExpiryReturn === 'function') {
                const scheduleResult = await app.scheduleLicenseExpiryReturn(result, {
                    source: 'login-web-ipc',
                    key: trimmedKey,
                    result,
                    usageInfo: result.usageInfo || null
                });
                if (scheduleResult && scheduleResult.usageInfo) {
                    result.usageInfo = scheduleResult.usageInfo;
                }
            }
        }
        return result;
    });

    ipcMain.handle('get-saved-card-key', async () => {
        try {
            const cardKey = await app.readSavedCardKey();
            return { success: true, cardKey };
        } catch (error) {
            return { success: false, error: error.message, cardKey: '' };
        }
    });

    ipcMain.handle('save-saved-card-key', async (_event, cardKey) => {
        try {
            if (typeof cardKey !== 'string') {
                return { success: false, error: '卡密格式不正确' };
            }

            const trimmedKey = cardKey.trim();
            if (!trimmedKey) {
                await app.clearSavedCardKey();
                return { success: true, cleared: true };
            }

            const validationSnapshot = app.currentCardValidationSnapshot || {};
            const shouldPersistExpireAt = validationSnapshot.key === trimmedKey && validationSnapshot.expireAtTimestamp > 0;
            await app.saveCardKeyToCache(trimmedKey, {
                expireAt: shouldPersistExpireAt ? validationSnapshot.expireAt || '' : '',
                expireAtTimestamp: shouldPersistExpireAt ? validationSnapshot.expireAtTimestamp || 0 : 0
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('clear-saved-card-key', async () => {
        return await app.clearSavedCardKey();
    });

    ipcMain.handle('confirm-validation-success', async () => {
        app.isValidated = true;

        if (app.loginWindow && !app.loginWindow.isDestroyed()) {
            app.loginWindow.close();
        }

        return { success: true };
    });

};

