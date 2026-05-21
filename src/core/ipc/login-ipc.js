const registerHaikaAuthHandlers = require('./haika-auth-ipc');

module.exports = function registerLoginHandlers({ app, ipcMain }) {
    function compactValidationResult(result) {
        if (!result || typeof result !== 'object') {
            return result;
        }

        const usageInfo = result.usageInfo && typeof result.usageInfo === 'object'
            ? { ...result.usageInfo }
            : null;

        if (usageInfo && Array.isArray(usageInfo.rawCandidates)) {
            usageInfo.rawCandidates = usageInfo.rawCandidates.filter((value) => value !== null && value !== undefined);
        }

        return {
            ...result,
            ...(usageInfo ? { usageInfo } : {})
        };
    }

    function logValidationResult(result) {
        if (!app?.logger) {
            return;
        }

        try {
            app.logger.info(`卡密验证返回信息: ${JSON.stringify(compactValidationResult(result), null, 2)}`);
        } catch (error) {
            app.logger.info(`卡密验证返回信息: [无法序列化结果: ${error.message}]`);
        }
    }

    if (!app.__electronExitAppHandlerRegistered) {
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
        app.__electronExitAppHandlerRegistered = true;
    }

    ipcMain.on('minimize-window', () => {
        if (app.loginWindow) {
            app.loginWindow.minimize();
        }
    });

    ipcMain.on('close-window', () => {
        if (app.isValidated) {
            Promise.resolve(app.cleanupAndExit?.())
                .catch((error) => {
                    app.logger?.error?.(`关闭登录页时退出应用失败: ${error.message}`);
                });
            return;
        }

        if (app.loginWindow) {
            app.loginWindow.close();
        }
    });

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
            const result = { success: true, devMode: true };
            logValidationResult(result);
            return result;
        }

        const result = await app.licenseManager.validateCardKey(data.key, data.deviceId);
        if (result && result.success) {
            const trimmedKey = typeof data?.key === 'string' ? data.key.trim() : '';
            app.currentCardKey = trimmedKey;
            app.currentCardKeyPrefix = trimmedKey.slice(0, 4);
            const cacheResult = typeof app.saveCardKeyToCache === 'function'
                ? await app.saveCardKeyToCache(trimmedKey, {
                    source: 'login-ipc',
                    result,
                    usageInfo: result.usageInfo || null
                })
                : null;
            if (cacheResult?.cache?.usageInfo) {
                result.usageInfo = cacheResult.cache.usageInfo;
            }
            if (typeof app.scheduleLicenseExpiryReturn === 'function') {
                const scheduleResult = await app.scheduleLicenseExpiryReturn(result, {
                    source: 'login-ipc',
                    key: trimmedKey,
                    result,
                    usageInfo: result.usageInfo || null
                });
                if (scheduleResult && scheduleResult.usageInfo) {
                    result.usageInfo = scheduleResult.usageInfo;
                }
            }
        }
        logValidationResult(result);
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
    registerHaikaAuthHandlers({ app, ipcMain });

    ipcMain.on('validation-success', async () => {
        app.isValidated = true;

        try {
            await app.showMainWindow();
        } catch (error) {
            app.logger?.error?.(`进入主界面失败: ${error.message}`);
            return;
        }

        if (app.loginWindow && !app.loginWindow.isDestroyed()) {
            app.loginWindow.close();
        }
    });
};
