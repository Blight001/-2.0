module.exports = function registerExecutionHandlers({ app, ipcMain }) {
    const isControlLocked = () => typeof app.isRegistrationControlLocked === 'function' && app.isRegistrationControlLocked();
    const blockLockedAction = (actionLabel) => ({
        success: false,
        error: `服务器已禁止控制，${actionLabel}已禁用`
    });

    ipcMain.handle('start-registration', async (_event, config) => {
        if (isControlLocked()) {
            return blockLockedAction('本地手动开始执行');
        }

        let latestRuntimeConfig = {};
        try {
            latestRuntimeConfig = typeof app.readExecutionRuntimeConfigFromDisk === 'function'
                ? await app.readExecutionRuntimeConfigFromDisk()
                : {};
        } catch (error) {
            app.logger.warning(`读取注册运行配置失败，继续使用当前参数: ${error.message}`);
        }

        const mergedConfig = {
            ...(latestRuntimeConfig && typeof latestRuntimeConfig === 'object' ? latestRuntimeConfig : {}),
            ...(config && typeof config === 'object' ? config : {})
        };
        if (config && typeof config === 'object') {
            if (Object.prototype.hasOwnProperty.call(config, 'cardData')) {
                mergedConfig.cardData = config.cardData;
            }
            if (Object.prototype.hasOwnProperty.call(config, 'cardName')) {
                mergedConfig.cardName = config.cardName;
            }
        }

        return await app.startRegistration(mergedConfig);
    });

    ipcMain.handle('start-haika-binding', async (_event, config) => {
        if (isControlLocked()) {
            return blockLockedAction('本地手动开始海卡绑定');
        }
        return await app.startHaikaBindingTask(config);
    });

    ipcMain.handle('stop-haika-binding', async () => {
        if (isControlLocked()) {
            return blockLockedAction('本地手动停止海卡绑定');
        }
        return await app.stopHaikaBinding();
    });

    ipcMain.handle('stop-registration', async () => {
        if (isControlLocked()) {
            return blockLockedAction('本地手动停止执行');
        }
        return await app.stopRegistration();
    });

    ipcMain.handle('stop-task', async (_event, taskId) => {
        if (isControlLocked()) {
            return blockLockedAction('本地手动停止任务');
        }
        try {
            app.logger.info(`停止任务: ${taskId}`);

            if (app.runningTasks.has(taskId)) {
                const task = app.runningTasks.get(taskId);
                if (task) {
                    task.stop('任务已被手动停止');

                    if (task.browserId) {
                        app.logger.info(`尝试关闭任务 ${taskId} 的浏览器实例: ${task.browserId}`);
                        try {
                            await app.browserManager.closeBrowser(task.browserId);
                        } catch (error) {
                            app.logger.warning(`关闭任务 ${taskId} 浏览器失败: ${error.message}`);
                        }
                    }
                }
                app.runningTasks.delete(taskId);
                if (typeof app.updateStats === 'function') {
                    await app.updateStats().catch(() => {});
                }
                return { success: true };
            }

            app.cookieTester.stopTesting();
            return { success: true };
        } catch (error) {
            app.logger.error(`停止任务失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('pause-task', async (_event, taskId) => {
        if (isControlLocked()) {
            return blockLockedAction('本地手动暂停任务');
        }
        try {
            app.logger.info(`暂停任务: ${taskId}`);
            if (typeof app.pauseCardDebugTask !== 'function') {
                return { success: false, error: '暂停功能不可用' };
            }
            return await app.pauseCardDebugTask(taskId, 'manual');
        } catch (error) {
            app.logger.error(`暂停任务失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('resume-task', async (_event, taskId) => {
        if (isControlLocked()) {
            return blockLockedAction('本地手动继续任务');
        }
        try {
            app.logger.info(`继续任务: ${taskId}`);
            if (typeof app.resumeCardDebugTask !== 'function') {
                return { success: false, error: '继续功能不可用' };
            }
            return await app.resumeCardDebugTask(taskId);
        } catch (error) {
            app.logger.error(`继续任务失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};

