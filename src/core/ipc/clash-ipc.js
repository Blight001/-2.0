module.exports = function registerClashHandlers({ app, ipcMain }) {
    const withLogger = () => {
        app.clashManager.setLogger(app.logger);
    };

    ipcMain.handle('clash-get-status', async () => {
        try {
            withLogger();
            const result = await app.clashManager.getStatus();
            if (result && result.success && result.data) {
                app.clashState = { ...result.data };
            }
            return result;
        } catch (error) {
            app.logger.error(`获取Clash状态失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('clash-get-profile-nodes', async (_event, profileUid) => {
        try {
            withLogger();
            return await app.clashManager.getProfileNodes(profileUid);
        } catch (error) {
            app.logger.error(`获取订阅节点失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('clash-switch-profile', async (_event, newUid) => {
        try {
            withLogger();
            const result = await app.clashManager.switchProfile(newUid);
            if (result.success) {
                app.logger.info(`切换订阅成功: ${result.data.profileName}`);
                app.clashState = {
                    ...(app.clashState || {}),
                    currentUid: newUid,
                    currentNode: result.data.currentNode || app.clashState?.currentNode || ''
                };
            }
            return result;
        } catch (error) {
            app.logger.error(`切换订阅失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('clash-switch-node', async (_event, profileUid, nodeName) => {
        try {
            withLogger();
            const result = await app.clashManager.switchNode(profileUid, nodeName);
            if (result.success) {
                app.logger.info(`切换节点成功: ${result.data.profileName} - ${result.data.newNode}`);
                app.clashState = {
                    ...(app.clashState || {}),
                    currentNode: result.data.newNode || nodeName || app.clashState?.currentNode || ''
                };
            }
            return result;
        } catch (error) {
            app.logger.error(`切换节点失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('clash-set-system-proxy', async (_event, enable) => {
        try {
            withLogger();
            const success = await app.clashManager.setSystemProxy(enable, app.browserSettings || {});
            app.clashState = {
                ...(app.clashState || {}),
                systemProxy: enable === true
            };
            return { success };
        } catch (error) {
            app.logger.error(`设置系统代理失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('clash-set-tun-mode', async (_event, enable) => {
        try {
            withLogger();
            const success = await app.clashManager.setTunMode(enable, app.browserSettings || {});
            app.clashState = {
                ...(app.clashState || {}),
                tunMode: enable === true
            };
            return { success };
        } catch (error) {
            app.logger.error(`设置TUN模式失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('check-clash-process', async () => {
        try {
            const { execAsync } = app;
            const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq clash-verge.exe" /NH');
            const isRunning = stdout.toLowerCase().includes('clash-verge.exe');
            return { success: true, isRunning };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('clash-set-mode', async (_event, mode) => {
        try {
            withLogger();
            return { success: await app.clashManager.setMode(mode) };
        } catch (error) {
            app.logger.error(`设置代理模式失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('clash-test-latency', async (_event, nodeName) => {
        try {
            withLogger();
            return await app.clashManager.testNodeLatency(nodeName);
        } catch (error) {
            app.logger.error(`测试节点延迟失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};
