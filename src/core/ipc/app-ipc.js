const { BrowserWindow } = require('electron');

function resolveWindowIdFromEvent(event) {
    try {
        const sender = event?.sender || null;
        const senderWindow = sender ? BrowserWindow.fromWebContents(sender) : null;
        if (senderWindow && typeof senderWindow.id === 'number') {
            return senderWindow.id;
        }
    } catch (_error) {}

    return null;
}

module.exports = function registerAppHandlers({ app, ipcMain }) {
    const isRpcRegistry = !!app.rpcRegistry && ipcMain === app.rpcRegistry;
    const exitHandlerFlag = isRpcRegistry
        ? '__rpcExitAppHandlerRegistered'
        : '__electronExitAppHandlerRegistered';

    if (!app[exitHandlerFlag]) {
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
        app[exitHandlerFlag] = true;
    }

    if (!app.__closeMainWindowHandlerRegistered) {
        ipcMain.handle('close-main-window', async (event) => {
            try {
                const sender = event?.sender || null;
                const candidates = [
                    app.desktopWindow || null,
                    app.loginWindow || null,
                    sender ? BrowserWindow.fromWebContents(sender) : null,
                    BrowserWindow.getFocusedWindow?.() || null,
                    app.mainWindow && typeof app.mainWindow.close === 'function' ? app.mainWindow : null
                ];
                const targetWindow = candidates.find((window) => window && typeof window.close === 'function') || null;

                if (!targetWindow || targetWindow.isDestroyed()) {
                    return { success: true, alreadyClosed: true };
                }

                app.logger?.info?.(`关闭主窗口: ${targetWindow === app.desktopWindow ? 'desktopWindow' : targetWindow === app.loginWindow ? 'loginWindow' : 'fallbackWindow'}`);
                targetWindow.close();
                return { success: true };
            } catch (error) {
                app.logger?.error?.(`关闭主窗口失败: ${error.message}`);
                return { success: false, error: error.message };
            }
        });
        app.__closeMainWindowHandlerRegistered = true;
    }

    const openCardEditorWindowHandlerFlag = isRpcRegistry
        ? '__rpcOpenCardEditorWindowHandlerRegistered'
        : '__electronOpenCardEditorWindowHandlerRegistered';

    if (!app[openCardEditorWindowHandlerFlag]) {
        ipcMain.handle('open-card-editor-window', async (_event, payload = {}) => {
            try {
                if (typeof app.createCardEditorWindow !== 'function') {
                    return { success: false, error: '卡片编辑窗口不可用' };
                }

                return await app.createCardEditorWindow({
                    cardMode: payload.cardMode || payload.mode || 'register',
                    cardData: payload.cardData || payload.card || null,
                    apiCardName: payload.apiCardName || payload.relatedApiCardName || ''
                });
            } catch (error) {
                app.logger?.error?.(`打开卡片编辑窗口失败: ${error.message}`);
                return { success: false, error: error.message };
            }
        });
        app[openCardEditorWindowHandlerFlag] = true;
    }

    const getCardEditorWindowStateHandlerFlag = isRpcRegistry
        ? '__rpcGetCardEditorWindowStateHandlerRegistered'
        : '__electronGetCardEditorWindowStateHandlerRegistered';

    if (!app[getCardEditorWindowStateHandlerFlag]) {
        ipcMain.handle('get-card-editor-window-state', async () => {
            try {
                return {
                    success: true,
                    payload: app?.cardEditorWindowPayload || null
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });
        app[getCardEditorWindowStateHandlerFlag] = true;
    }

    ipcMain.handle('get-app-runtime-info', async () => {
        try {
            const runtimeInfo = typeof app.getAppRuntimeInfo === 'function'
                ? await app.getAppRuntimeInfo()
                : {};
            const webControlUrl = app?.webControlServer?.getUrl?.()
                || (app?.webControlConfig?.enabled === true
                    ? `http://${app.webControlConfig.host || '127.0.0.1'}:${app.webControlConfig.port || 18765}`
                    : '');
            return {
                success: true,
                ...runtimeInfo,
                webControlUrl
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                startupMode: 'local',
                tcpManagedMode: false,
                localCardAutoloadEnabled: true,
                webControlEnabled: false,
                webControlHeadless: false,
                webControlUrl: '',
                registrationTcpEnabled: false,
                registrationTcpControlLocked: false,
                registrationTcpControlState: {},
                registrationTcpReconnectEnabled: true,
                registrationTcpConnectionStatus: null
            };
        }
    });

    ipcMain.handle('get-registration-ui-state', async (_event, options = {}) => {
        try {
            if (typeof app.getExecutionUiState !== 'function') {
                return {
                    success: true,
                    enabled: false,
                    running: false,
                    connected: false,
                    cards: [],
                    currentCardName: '',
                    currentCard: '',
                    registrationTcpEnabled: false,
                    registrationTcpControlLocked: false,
                    registrationTcpControlState: {},
                    registrationTcpEndpoint: null,
                    registrationTcpReconnectEnabled: false,
                    registrationTcpConnectionStatus: null,
                    options
                };
            }

            const state = await app.getExecutionUiState(options);
            return {
                success: true,
                ...state
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    });

    ipcMain.handle('refresh-registration-tab', async (event) => {
        try {
            const sender = event?.sender || null;
            const senderWindow = sender ? BrowserWindow.fromWebContents(sender) : null;
            const targetWindow = senderWindow === app?.cardEditorWindow
                ? [app?.desktopWindow || null, app?.mainWindow || null, app?.loginWindow || null, senderWindow]
                    .find((window) => window && typeof window.reload === 'function' && !window.isDestroyed?.()) || null
                : [senderWindow, app?.desktopWindow || null, app?.loginWindow || null]
                    .find((window) => window && typeof window.reload === 'function' && !window.isDestroyed?.()) || null;

            if (targetWindow) {
                targetWindow.reload();
            }

            return {
                ok: true,
                success: true,
                tabId: targetWindow && typeof targetWindow.id === 'number' ? targetWindow.id : resolveWindowIdFromEvent(event)
            };
        } catch (error) {
            return {
                ok: false,
                success: false,
                error: error.message
            };
        }
    });

    ipcMain.handle('close-registration-tab', async (event) => {
        try {
            const sender = event?.sender || null;
            const senderWindow = sender ? BrowserWindow.fromWebContents(sender) : null;
            const targetWindow = [senderWindow, app?.desktopWindow || null, app?.loginWindow || null]
                .find((window) => window && typeof window.close === 'function' && !window.isDestroyed?.()) || null;

            if (targetWindow) {
                targetWindow.close();
            }

            return {
                ok: true,
                success: true,
                tabId: targetWindow && typeof targetWindow.id === 'number' ? targetWindow.id : resolveWindowIdFromEvent(event)
            };
        } catch (error) {
            return {
                ok: false,
                success: false,
                error: error.message
            };
        }
    });

    ipcMain.handle('get-current-registration-tab-id', async (event) => {
        try {
            const senderTabId = resolveWindowIdFromEvent(event);
            const activeWindow = app?.desktopWindow || app?.loginWindow || null;
            return {
                ok: true,
                success: true,
                tabId: senderTabId !== null
                    ? senderTabId
                    : activeWindow && typeof activeWindow.id === 'number'
                        ? activeWindow.id
                        : null
            };
        } catch (error) {
            return {
                ok: false,
                success: false,
                error: error.message
            };
        }
    });

    ipcMain.handle('set-registration-tab-title', async (_event, title) => {
        try {
            const text = String(title || '').trim();
            if (text && app?.desktopWindow && typeof app.desktopWindow.setTitle === 'function' && !app.desktopWindow.isDestroyed?.()) {
                app.desktopWindow.setTitle(text);
            }
            return {
                ok: true,
                success: true,
                title: text
            };
        } catch (error) {
            return {
                ok: false,
                success: false,
                error: error.message
            };
        }
    });

    ipcMain.handle('post-registration-event', async (_event, payload = {}) => {
        try {
            const channel = String(payload.channel || payload.type || '').trim();
            const args = Array.isArray(payload.args) ? payload.args : [payload.payload || payload.data || payload];

            if (!channel) {
                return {
                    ok: false,
                    success: false,
                    error: '事件通道不能为空'
                };
            }

            if (typeof app.emitUiEvent === 'function') {
                app.emitUiEvent(channel, ...args);
            }

            return {
                ok: true,
                success: true,
                channel
            };
        } catch (error) {
            return {
                ok: false,
                success: false,
                error: error.message
            };
        }
    });
};

