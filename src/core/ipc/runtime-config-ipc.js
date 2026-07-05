function mergeRuntimeConfig(baseConfig = {}, runtimeConfig = {}) {
    const merged = {
        ...(baseConfig && typeof baseConfig === 'object' ? baseConfig : {}),
        ...(runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : {})
    };

    const baseBrowserSettings = baseConfig && typeof baseConfig.browserSettings === 'object'
        ? { ...baseConfig.browserSettings }
        : {};
    const runtimeBrowserSettings = runtimeConfig && typeof runtimeConfig.browserSettings === 'object'
        ? runtimeConfig.browserSettings
        : {};

    merged.browserSettings = {
        ...baseBrowserSettings,
        ...runtimeBrowserSettings
    };
    delete merged.browserSettings.browserType;
    delete merged.browserSettings.browserSource;
    delete merged.browserSettings.browser_region;
    delete merged.browserSettings.headlessMode;
    delete merged.browserSettings.blockImagesVideos;
    delete merged.browserSettings.syncExecution;
    delete merged.browserSettings.maxProxyRecoveryAttempts;
    delete merged.browserSettings.executionAutoUpload;
    delete merged.browserSettings.registrationAutoUpload;
    delete merged.browserSettings.saveLocalCookie;
    delete merged.browserSettings.skipCookieSave;
    delete merged.browserSettings.skip_cookie_save;
    delete merged.browserSettings.concurrentCount;
    delete merged.browserSettings.runMode;
    delete merged.browserSettings.timedExecutionCount;
    delete merged.browserSettings.timedRegistrationCount;
    delete merged.browserSettings.timedExecutionCycleCount;
    delete merged.browserSettings.timedRegistrationCycleCount;
    delete merged.browserSettings.timedExecutionStartMode;
    delete merged.browserSettings.timedRegistrationStartMode;
    delete merged.browserSettings.timedExecutionDelaySeconds;
    delete merged.browserSettings.timedRegistrationDelaySeconds;
    delete merged.browser_settings;

    return merged;
}

module.exports = function registerRuntimeConfigHandlers({ app, ipcMain }) {
    ipcMain.handle('get-execution-runtime-config', async () => {
        try {
            const cookieConfig = typeof app.readCookieUserConfigFromDisk === 'function'
                ? await app.readCookieUserConfigFromDisk()
                : {};
            const runtimeConfig = typeof app.readExecutionRuntimeConfigFromDisk === 'function'
                ? await app.readExecutionRuntimeConfigFromDisk()
                : {};

            return {
                success: true,
                config: mergeRuntimeConfig(cookieConfig, runtimeConfig)
            };
        } catch (error) {
            app.logger.error(`获取运行配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('save-execution-runtime-config', async (_event, config) => {
        try {
            const normalizedConfig = config && typeof config === 'object' ? { ...config } : {};
            const saveResult = typeof app.saveAutomationRuntimeConfigToDisk === 'function'
                ? await app.saveAutomationRuntimeConfigToDisk(normalizedConfig)
                : { success: false, error: '运行配置保存接口不可用' };

            if (saveResult.success === false) {
                return saveResult;
            }

            const savedConfig = saveResult.config && typeof saveResult.config === 'object'
                ? saveResult.config
                : normalizedConfig;
            const savedBrowserSettings = savedConfig.browserSettings && typeof savedConfig.browserSettings === 'object'
                ? savedConfig.browserSettings
                : normalizedConfig.browserSettings && typeof normalizedConfig.browserSettings === 'object'
                    ? normalizedConfig.browserSettings
                    : {};
            if (Object.keys(savedBrowserSettings).length > 0) {
                const mergedBrowserSettings = {
                    ...(app.browserSettings && typeof app.browserSettings === 'object' ? app.browserSettings : {}),
                    ...savedBrowserSettings
                };
                if (mergedBrowserSettings.browser_type && !mergedBrowserSettings.browserType) {
                    mergedBrowserSettings.browserType = mergedBrowserSettings.browser_type;
                }
                if (mergedBrowserSettings.browserType && !mergedBrowserSettings.browser_type) {
                    mergedBrowserSettings.browser_type = mergedBrowserSettings.browserType;
                }
                app.browserSettings = mergedBrowserSettings;
                if (app.cookieTester && typeof app.cookieTester.setBrowserSettings === 'function') {
                    app.cookieTester.setBrowserSettings(mergedBrowserSettings);
                }
                if (mergedBrowserSettings.browser_type) {
                    app.currentBrowserType = String(mergedBrowserSettings.browser_type || '').trim();
                }
            }

            return {
                success: true,
                configPath: saveResult.configPath || ''
            };
        } catch (error) {
            app.logger.error(`保存运行配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};

