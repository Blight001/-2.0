const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs-extra');
const { shell } = require('electron');
const { IPC_CHANNELS } = require('./channels');
const {
    stripBrowserSettingsCompatFields,
    stripRuntimeConfigCompatFields,
    stripEmailConfigCompatFields
} = require('../infra/config-utils');

function mergeConfigWithExisting(existingConfig = {}, incomingConfig = {}) {
    const safeExisting = existingConfig && typeof existingConfig === 'object' ? existingConfig : {};
    const safeIncoming = incomingConfig && typeof incomingConfig === 'object' ? incomingConfig : {};
    const existingBrowserSettings = safeExisting.browserSettings && typeof safeExisting.browserSettings === 'object'
        ? { ...safeExisting.browserSettings }
        : {};
    const incomingBrowserSettings = safeIncoming.browserSettings && typeof safeIncoming.browserSettings === 'object'
        ? { ...safeIncoming.browserSettings }
        : {};
    const merged = {
        ...safeExisting,
        ...safeIncoming
    };

    merged.browserSettings = {
        ...existingBrowserSettings,
        ...incomingBrowserSettings
    };
    merged.browserSettings = stripBrowserSettingsCompatFields(merged.browserSettings);
    delete merged.browser_settings;
    delete merged.email_host;
    delete merged.email_port;
    delete merged.emailHost;
    delete merged.emailPort;

    return stripRuntimeConfigCompatFields(merged);
}

function buildCookiePreviewSessionKey(cookieInfo = {}) {
    const cardName = String(cookieInfo.card_name || '').trim();
    const aid = String(cookieInfo.aid || cookieInfo.id || '').trim();
    const email = String(cookieInfo.email || cookieInfo.account || '').trim();
    const fileName = String(cookieInfo.fileName || cookieInfo.name || '').trim();
    return `${cardName}::${aid}::${email}::${fileName}`;
}

function sanitizeCustomTestAccountFilePart(value) {
    return String(value || '')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_');
}

function buildCustomTestAccountFileName(account = '', password = '', fallback = '') {
    const normalizedAccount = sanitizeCustomTestAccountFilePart(account);
    const normalizedPassword = sanitizeCustomTestAccountFilePart(password);
    if (normalizedAccount && normalizedPassword) {
        return `${normalizedAccount}_${normalizedPassword}.json`;
    }
    return String(fallback || '').trim() || `自定义账号_${Date.now()}-custom.json`;
}

function normalizeTcpServerUrl(value) {
    const text = String(value || '').trim().replace(/\/+$/, '');
    if (!text) {
        return '127.0.0.1:58113';
    }

    const stripped = text
        .replace(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//, '')
        .replace(/^\/+/, '')
        .trim();
    if (!stripped) {
        return '127.0.0.1:58113';
    }

    return stripped.split('/')[0];
}

function normalizeBooleanValue(value, fallback = true) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    const text = String(value).trim().toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(text)) {
        return false;
    }
    if (['1', 'true', 'yes', 'on'].includes(text)) {
        return true;
    }
    return fallback;
}

function getTcpConfigSnapshot(config = {}) {
    const source = config && typeof config === 'object' ? config : {};
    const tcpServerUrl = String(
        source.tcp_server_url ||
        source.tcpServerUrl ||
        source.server_url ||
        source.serverUrl ||
        source.registration_server_url ||
        source.registrationServerUrl ||
        source.mqtt_server_url ||
        source.mqttServerUrl ||
        ''
    ).trim();

    return {
        tcpServerUrl: normalizeTcpServerUrl(tcpServerUrl),
        tcpAutoReconnectEnabled: normalizeBooleanValue(
            source.tcp_auto_reconnect_enabled ??
            source.tcpAutoReconnectEnabled ??
            source.registration_tcp_auto_reconnect_enabled ??
            source.registrationTcpAutoReconnectEnabled,
            true
        )
    };
}

function requestJson(urlString, { method = 'GET', headers = {}, body = null, timeout = 15000 }) {
    const url = new URL(urlString);
    const protocol = url.protocol === 'https:' ? https : http;
    const defaultPort = url.protocol === 'https:' ? 443 : 80;

    return new Promise((resolve) => {
        const requestBody = body === null || body === undefined
            ? null
            : (typeof body === 'string' ? body : JSON.stringify(body));

        const requestHeaders = { ...headers };
        if (requestBody && !requestHeaders['Content-Type']) {
            requestHeaders['Content-Type'] = 'application/json';
        }

        if (requestBody) {
            requestHeaders['Content-Length'] = Buffer.byteLength(requestBody);
        }

        const options = {
            hostname: url.hostname,
            port: url.port || defaultPort,
            path: `${url.pathname}${url.search}`,
            method,
            family: 4,
            rejectUnauthorized: false,
            timeout,
            headers: requestHeaders
        };

        const req = protocol.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                const trimmed = (data || '').trim();
                let parsed = null;
                if (trimmed) {
                    try {
                        parsed = JSON.parse(trimmed);
                    } catch (_error) {
                        parsed = trimmed;
                    }
                }

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({
                        success: true,
                        statusCode: res.statusCode,
                        raw: trimmed,
                        body: parsed
                    });
                } else {
                    const message = parsed && typeof parsed === 'object'
                        ? (parsed.message || parsed.error)
                        : parsed;
                    resolve({
                        success: false,
                        statusCode: res.statusCode,
                        error: message || `HTTP ${res.statusCode}`,
                        raw: trimmed,
                        body: parsed
                    });
                }
            });
        });

        req.on('error', (error) => {
            resolve({ success: false, error: error.message });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, error: '请求超时' });
        });

        if (requestBody) {
            req.write(requestBody);
        }

        req.end();
    });
}

function createProgressCallback(app, batchTaskId, batchTaskLabel = 'Cookie批量测试') {
    return (progress, message, meta = {}) => {
        if (!app.mainWindow) {
            return;
        }

        const childTaskId = String(meta.taskId || batchTaskId || '').trim();
        if (!childTaskId) {
            return;
        }

        const taskLabel = String(meta.taskLabel || meta.cookieInfo?.email || meta.cookieInfo?.account || meta.cookieInfo?.fileName || 'Cookie测试').trim();
        const taskNumber = String(meta.taskNumber || '').trim();
        const taskType = String(meta.taskType || 'cookie-test').trim();
        const parentTaskId = String(meta.parentTaskId || batchTaskId || '').trim();
        const payload = {
            taskId: childTaskId,
            progress,
            message,
            taskLabel,
            taskNumber,
            taskType,
            parentTaskId,
            parentTaskLabel: batchTaskLabel
        };

        if (parentTaskId && meta.phase !== 'started') {
            app.mainWindow.webContents.send('task-progress', {
                taskId: parentTaskId,
                progress,
                message: message || `${batchTaskLabel}进行中`,
                taskLabel: batchTaskLabel,
                taskNumber: meta.total ? `${Math.min((Number(meta.index) || 0) + 1, Number(meta.total) || 0)}/${Number(meta.total) || ''}` : '',
                taskType: 'cookie-batch',
                parentTaskId: '',
                isGroupParent: true
            });
        }

        if (meta.phase === 'started') {
            app.mainWindow.webContents.send('task-started', payload);
            return;
        }

        if (meta.phase === 'finished') {
            if (meta.success === false) {
                app.mainWindow.webContents.send('task-error', {
                    ...payload,
                    error: String(meta.error || message || '任务执行失败')
                });
            } else {
                app.mainWindow.webContents.send('task-finished', payload);
            }
            return;
        }

        app.mainWindow.webContents.send('task-progress', payload);
    };
}

function emitTaskStarted(app, taskId, taskLabel = 'Cookie测试', taskNumber = '', taskType = 'task') {
    if (app.mainWindow) {
        app.mainWindow.webContents.send('task-started', {
            taskId,
            taskNumber,
            taskLabel,
            taskType
        });
    }
}

function emitTaskFinished(app, taskId, taskLabel = '', taskNumber = '', taskType = 'task', message = '', options = {}) {
    if (app.mainWindow) {
        app.mainWindow.webContents.send('task-finished', {
            taskId,
            taskLabel,
            taskNumber,
            taskType,
            message,
            statusKey: options.statusKey || '',
            isGroupParent: options.isGroupParent === true
        });
    }
}

function emitTaskError(app, taskId, error, taskLabel = '', taskNumber = '', taskType = 'task') {
    if (app.mainWindow) {
        app.mainWindow.webContents.send('task-error', {
            taskId,
            error: error || '任务执行失败',
            taskLabel,
            taskNumber,
            taskType
        });
    }
}

async function runCookieTaskWithLifecycle(app, taskId, taskLabel, runner) {
    const hasTaskId = Boolean(String(taskId || '').trim());
    if (hasTaskId) {
        emitTaskStarted(app, taskId, taskLabel, '', 'cookie-batch');
    }

    try {
        const result = await runner();
        if (hasTaskId && result && result.success !== false) {
            emitTaskFinished(app, taskId, taskLabel, '', 'cookie-batch', result?.message || '', {
                statusKey: (result?.failCount || 0) > 0 ? 'warning' : 'success',
                isGroupParent: true
            });
        } else if (hasTaskId) {
            emitTaskError(app, taskId, result?.error || result?.message || '任务执行失败', taskLabel, '', 'cookie-batch');
        }
        return result;
    } catch (error) {
        if (hasTaskId) {
            emitTaskError(app, taskId, error.message, taskLabel, '', 'cookie-batch');
        }
        throw error;
    }
}

function syncCookieTesterBrowserConfig(app) {
    if (!app.cookieTester) {
        return;
    }

    app.cookieTester.browserType = app.currentBrowserType;
    if (typeof app.cookieTester.setBrowserSettings === 'function') {
        app.cookieTester.setBrowserSettings(app.browserSettings || {});
    } else {
        app.cookieTester.browserSettings = app.browserSettings || {};
    }
    app.cookieTester.cardKeyResolver = async () => {
        const directKey = String(app.currentCardKey || app.currentCardValidationSnapshot?.key || '').trim();
        if (directKey) {
            return directKey;
        }
        if (typeof app.readSavedCardKey === 'function') {
            return String(await app.readSavedCardKey() || '').trim();
        }
        return '';
    };
}

function normalizeManualLoginUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw)) {
        return raw;
    }

    return `https://${raw}`;
}

module.exports = function registerCookieHandlers({ app, ipcMain, fs, path }) {
    const CUSTOM_TEST_ACCOUNT_CARD_NAME = '自定义测试账号';

    if (!app.cookiePreviewSession || typeof app.cookiePreviewSession !== 'object') {
        app.cookiePreviewSession = null;
    }

    if (!app.__cookiePreviewBrowserLifecycleCleanup && app.browserManager && typeof app.browserManager.onBrowserLifecycle === 'function') {
        app.__cookiePreviewBrowserLifecycleCleanup = app.browserManager.onBrowserLifecycle((event = {}) => {
            const browserId = String(event.browserId || '').trim();
            const sessionBrowserId = String(app.cookiePreviewSession?.browserId || '').trim();
            if (!browserId || !sessionBrowserId || browserId !== sessionBrowserId) {
                return;
            }

            const session = app.cookiePreviewSession || {};
            app.cookiePreviewSession = null;

            if (typeof app.emitUiEvent === 'function') {
                app.emitUiEvent('cookie-preview-browser-closed', {
                    browserId,
                    reason: String(event.reason || 'closed').trim() || 'closed',
                    key: String(session.key || '').trim(),
                    email: String(session.email || '').trim(),
                    cardName: String(session.originalCardName || '').trim()
                });
            }

            app.logger.info(`Cookie预览浏览器已关闭: ${browserId}`);
        });
    }

    ipcMain.removeHandler('get-device-id');
    ipcMain.handle('get-device-id', () => {
        return app.licenseManager.getDeviceId();
    });

    ipcMain.handle('load-cookies', async () => {
        try {
            const cookies = await app.cookieManager.listCookies();
            return { success: true, cookies };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-cookie', async (_event, email) => {
        try {
            const success = await app.cookieManager.deleteCookie(email);
            return { success };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-cookie-folder', async () => {
        try {
            const cookieDir = app.cookieManager.getCookieDirectory();
            if (!cookieDir) {
                const errorMessage = '未启用本地Cookie存储';
                app.logger.info(errorMessage);
                return { success: false, error: errorMessage };
            }

            if (!fs.existsSync(cookieDir)) {
                fs.ensureDirSync(cookieDir);
            }

            await shell.openPath(cookieDir);
            app.logger.info(`打开Cookie文件夹: ${cookieDir}`);
            return { success: true };
        } catch (error) {
            app.logger.error(`打开Cookie文件夹失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.customTestAccountStart, async (_event, payload = {}) => {
        try {
            if (app.customTestAccountSession?.browserId) {
                return {
                    success: true,
                    browserId: app.customTestAccountSession.browserId,
                    url: app.customTestAccountSession.url,
                    alreadyOpen: true
                };
            }

            const selectedCardName = String(payload.cardName || app.currentCard || app.currentCardName || '').trim();
            if (!selectedCardName) {
                return { success: false, error: '请先选择一个自动化卡片' };
            }

            const cardData = await app.cardManager.getCard(selectedCardName);
            if (!cardData) {
                return { success: false, error: `自动化卡片不存在: ${selectedCardName}` };
            }

            const targetUrl = normalizeManualLoginUrl(cardData.website || cardData.url || '');
            if (!targetUrl) {
                return { success: false, error: `自动化卡片 ${selectedCardName} 未配置网站地址` };
            }

            const browserSettings = payload.browserSettings && typeof payload.browserSettings === 'object'
                ? { ...payload.browserSettings }
                : { ...(app.browserSettings || {}) };
            const browserType = String(payload.browserType || browserSettings.browser_type || browserSettings.browserType || app.currentBrowserType || 'electron').trim() || 'electron';
            browserSettings.headless = false;
            browserSettings.headlessMode = false;

            const browserId = await app.browserManager.createBrowser(browserType, false, browserSettings);
            const page = app.browserManager.getBrowser(browserId);
            if (!page) {
                await app.browserManager.closeBrowser(browserId, { silent: true }).catch(() => {});
                return { success: false, error: '创建浏览器页面失败' };
            }

            try {
                await page.goto(targetUrl, {
                    timeout: 60000,
                    waitUntil: 'domcontentloaded'
                });
            } catch (navigationError) {
                app.logger.warning(`自定义测试账号页面打开失败，浏览器已保留: ${navigationError.message}`);
            }

            app.customTestAccountSession = {
                browserId,
                cardName: selectedCardName,
                url: targetUrl,
                account: String(payload.account || '').trim(),
                password: String(payload.password || '').trim(),
                fileName: String(payload.fileName || '').trim(),
                startedAt: Date.now()
            };
            app.logger.info(`自定义测试账号浏览器已打开: ${selectedCardName}, ${targetUrl}`);
            return { success: true, browserId, cardName: selectedCardName, url: targetUrl };
        } catch (error) {
            app.logger.error(`打开自定义测试账号浏览器失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.customTestAccountCapture, async (_event, payload = {}) => {
        try {
            const session = app.customTestAccountSession || null;
            const browserId = session?.browserId || '';
            if (!browserId) {
                return { success: false, error: '自定义测试账号浏览器未打开' };
            }

            const browserData = app.browserManager.getBrowserData(browserId);
            if (!browserData) {
                app.customTestAccountSession = null;
                return { success: false, error: '自定义测试账号浏览器已关闭' };
            }

            const browserState = typeof app.browserManager.getBrowserState === 'function'
                ? await app.browserManager.getBrowserState(browserId)
                : {
                    cookies: await app.browserManager.getCookies(browserId),
                    browserStorage: []
                };
            const cookies = Array.isArray(browserState.cookies) ? browserState.cookies : [];
            const browserStorage = Array.isArray(browserState.browserStorage) ? browserState.browserStorage : [];
            if ((!Array.isArray(cookies) || cookies.length === 0) && browserStorage.length === 0) {
                return { success: false, error: '当前浏览器没有可保存的Cookie或浏览器存储' };
            }

            const fileName = buildCustomTestAccountFileName(
                payload.account || session?.account || '',
                payload.password || session?.password || '',
                payload.fileName || session?.fileName || ''
            );
            const saveResult = await app.cookieManager.saveCookieFile(
                CUSTOM_TEST_ACCOUNT_CARD_NAME,
                fileName,
                cookies,
                browserStorage
            );
            if (!saveResult || saveResult.success !== true) {
                return saveResult || { success: false, error: '保存Cookie失败' };
            }

            await app.browserManager.closeBrowser(browserId, { silent: true });
            app.customTestAccountSession = null;

            if (app.mainWindow) {
                app.mainWindow.webContents.send('cookies-refreshed', {
                    source: 'custom-test-account',
                    cardName: saveResult.cardName,
                    fileName: saveResult.fileName
                });
            }

            app.logger.info(`自定义测试账号Cookie已保存: ${saveResult.cardName}/${saveResult.fileName}`);
            return {
                success: true,
                cookieCount: cookies.length,
                browserStorageCount: browserStorage.length,
                cardName: saveResult.cardName,
                fileName: saveResult.fileName,
                filePath: saveResult.filePath
            };
        } catch (error) {
            app.logger.error(`获取自定义测试账号Cookie失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC_CHANNELS.customTestAccountStop, async () => {
        try {
            const browserId = app.customTestAccountSession?.browserId || '';
            if (browserId) {
                await app.browserManager.closeBrowser(browserId, { silent: true });
            }
            app.customTestAccountSession = null;
            app.logger.info('自定义测试账号已停止');
            return { success: true };
        } catch (error) {
            app.logger.error(`停止自定义测试账号失败: ${error.message}`);
            app.customTestAccountSession = null;
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('test-cookie', async (_event, { email, testWithCardName, originalCardName }) => {
        syncCookieTesterBrowserConfig(app);
        return await app.cookieTester.testSingleCookie(email, testWithCardName, originalCardName);
    });

    ipcMain.handle('test-cookie-api-model', async (_event, { email, apiCardName, modelCardName, originalCardName }) => {
        syncCookieTesterBrowserConfig(app);
        return await app.cookieTester.testCookieApiThenModel(email, apiCardName, modelCardName, originalCardName);
    });

    ipcMain.handle('preview-cookie', async (_event, { email, testWithCardName, originalCardName }) => {
        syncCookieTesterBrowserConfig(app);
        const result = await app.cookieTester.previewSingleCookie(email, testWithCardName, originalCardName);
        if (result && result.success === true && result.browserId) {
            const cookies = await app.cookieManager.listCookies().catch(() => []);
            const cookieInfo = Array.isArray(cookies)
                ? cookies.find((cookie) =>
                    (String(cookie.email || cookie.account || '').trim() === String(email || '').trim())
                    && (!originalCardName || String(cookie.card_name || '').trim() === String(originalCardName || '').trim())
                )
                : null;

            app.cookiePreviewSession = {
                browserId: String(result.browserId || '').trim(),
                key: buildCookiePreviewSessionKey(cookieInfo || {
                    email,
                    account: email,
                    card_name: originalCardName,
                    fileName: ''
                }),
                email: String(email || '').trim(),
                originalCardName: String(originalCardName || cookieInfo?.card_name || '').trim(),
                testWithCardName: String(testWithCardName || '').trim(),
                fileName: String(cookieInfo?.fileName || cookieInfo?.name || '').trim(),
                sourceFilePath: String(cookieInfo?.sourceFilePath || '').trim()
            };
        }
        return result;
    });

    ipcMain.handle('refresh-cookie-preview', async (_event, payload = {}) => {
        try {
            const session = app.cookiePreviewSession || null;
            const browserId = String(session?.browserId || '').trim();
            if (!browserId) {
                return { success: false, error: '未找到可刷新的浏览器会话' };
            }

            const browserData = app.browserManager.getBrowserData(browserId);
            if (!browserData) {
                app.cookiePreviewSession = null;
                return { success: false, error: '浏览器已关闭' };
            }

            const browserState = typeof app.browserManager.getBrowserState === 'function'
                ? await app.browserManager.getBrowserState(browserId)
                : {
                    cookies: await app.browserManager.getCookies(browserId),
                    browserStorage: []
                };
            const cookies = Array.isArray(browserState.cookies) ? browserState.cookies : [];
            const browserStorage = Array.isArray(browserState.browserStorage) ? browserState.browserStorage : [];

            if ((!Array.isArray(cookies) || cookies.length === 0) && browserStorage.length === 0) {
                return { success: false, error: '当前浏览器没有可保存的 Cookie 或浏览器存储' };
            }

            const cookieList = await app.cookieManager.listCookies().catch(() => []);
            const cookieInfo = Array.isArray(cookieList)
                ? cookieList.find((cookie) =>
                    String(cookie.email || cookie.account || '').trim() === String(session.email || payload.email || '').trim()
                    && String(cookie.card_name || '').trim() === String(session.originalCardName || payload.originalCardName || '').trim()
                )
                : null;

            const saveCardName = String(cookieInfo?.card_name || session.originalCardName || payload.originalCardName || '').trim();
            const saveFileName = String(cookieInfo?.fileName || session.fileName || '').trim();
            if (!saveCardName || !saveFileName) {
                return { success: false, error: '无法定位 Cookie 文件' };
            }

            const saveResult = await app.cookieManager.saveCookieFile(
                saveCardName,
                saveFileName,
                cookies,
                browserStorage
            );
            if (!saveResult || saveResult.success !== true) {
                return saveResult || { success: false, error: '保存Cookie失败' };
            }

            await app.browserManager.closeBrowser(browserId, { silent: true });
            app.cookiePreviewSession = null;

            if (app.mainWindow) {
                app.mainWindow.webContents.send('cookies-refreshed', {
                    source: 'cookie-preview-refresh',
                    cardName: saveResult.cardName,
                    fileName: saveResult.fileName
                });
            }

            return {
                success: true,
                browserId,
                cardName: saveResult.cardName,
                fileName: saveResult.fileName,
                filePath: saveResult.filePath,
                cookieCount: cookies.length,
                browserStorageCount: browserStorage.length
            };
        } catch (error) {
            app.logger.error(`刷新Cookie预览失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('export-cookies', async (_event, email) => {
        try {
            const cookies = await app.cookieManager.getCookies(email);
            return { success: true, cookies };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('refresh-cookies-with-test', async (_event, taskId) => {
        syncCookieTesterBrowserConfig(app);
        const progressCallback = createProgressCallback(app, taskId, 'Cookie刷新测试');
        progressCallback.batchTaskId = taskId;
        const result = await runCookieTaskWithLifecycle(app, taskId, 'Cookie刷新测试', () => app.cookieTester.testAllCookies(progressCallback));

        if (app.mainWindow && result.success) {
            app.mainWindow.webContents.send('cookies-refreshed', result);
        }

        return result;
    });

    ipcMain.handle('test-cookies-with-card', async (_event, cardName, taskId, folderName, filterType) => {
        syncCookieTesterBrowserConfig(app);
        const progressCallback = createProgressCallback(app, taskId, `测试卡片 ${cardName}`);
        progressCallback.batchTaskId = taskId;

        const testCard = await app.cardManager.getTestCard(cardName);
        if (!testCard) {
            return { success: false, error: `测试卡片 ${cardName} 不存在` };
        }

        const result = await runCookieTaskWithLifecycle(
            app,
            taskId,
            `测试卡片 ${cardName}`,
            () => app.cookieTester.testCookiesByTestCard(testCard, progressCallback, folderName, filterType)
        );
        if (app.mainWindow && result.success) {
            app.mainWindow.webContents.send('cookies-refreshed', result);
        }

        return result;
    });

    ipcMain.handle('test-cookies-by-card', async (_event, cardName, taskId) => {
        syncCookieTesterBrowserConfig(app);
        const progressCallback = createProgressCallback(app, taskId, `测试卡片 ${cardName}`);
        progressCallback.batchTaskId = taskId;
        const result = await runCookieTaskWithLifecycle(
            app,
            taskId,
            `测试卡片 ${cardName}`,
            () => app.cookieTester.testCookiesByCard(cardName, progressCallback)
        );

        if (app.mainWindow && result.success) {
            app.mainWindow.webContents.send('cookies-refreshed', result);
        }

        return result;
    });

    ipcMain.handle('test-cookies-by-points', async (_event, cardName, points, taskId, testWithCardName) => {
        syncCookieTesterBrowserConfig(app);
        const progressCallback = createProgressCallback(app, taskId, `积分 ${points} Cookie测试`);
        progressCallback.batchTaskId = taskId;
        const result = await runCookieTaskWithLifecycle(
            app,
            taskId,
            `积分 ${points} Cookie测试`,
            () => app.cookieTester.testCookiesByPoints(cardName, points, progressCallback, testWithCardName)
        );

        if (app.mainWindow && result.success) {
            app.mainWindow.webContents.send('cookies-refreshed', result);
        }

        return result;
    });

    ipcMain.handle('stop-cookie-testing', async () => {
        try {
            app.cookieTester.stopTesting();

            if (app.mainWindow) {
                app.mainWindow.webContents.send('cookie-testing-stopped');
            }

            return { success: true };
        } catch (error) {
            app.logger.error(`停止Cookie测试失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-cookie-test-config', async (_event, config) => {
        try {
            app.cookieTester.updateTestConfig(config);
            return { success: true };
        } catch (error) {
            app.logger.error(`更新Cookie测试配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-cookie-test-config', async () => {
        try {
            const config = app.cookieTester.getTestConfig();
            return { success: true, config };
        } catch (error) {
            app.logger.error(`获取Cookie测试配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-cookie-user-config', async () => {
        try {
            const config = typeof app.readCookieUserConfigFromDisk === 'function'
                ? await app.readCookieUserConfigFromDisk()
                : {};
            return { success: true, config };
        } catch (error) {
            app.logger.error(`获取后端配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-registration-tcp-config', async () => {
        try {
            const tcpConfig = typeof app.readExecutionTcpConfigFromDisk === 'function'
                ? await app.readExecutionTcpConfigFromDisk()
                : getTcpConfigSnapshot({});
            const tcpServerUrl = tcpConfig.tcpServerUrl || tcpConfig.tcp_server_url || '';
            const tcpAutoReconnectEnabled = tcpConfig.tcpAutoReconnectEnabled !== undefined
                ? tcpConfig.tcpAutoReconnectEnabled
                : tcpConfig.tcp_auto_reconnect_enabled;
            return {
                success: true,
                ...tcpConfig,
                tcpServerUrl,
                tcp_server_url: tcpServerUrl,
                tcpAutoReconnectEnabled,
                tcp_auto_reconnect_enabled: tcpAutoReconnectEnabled,
                registrationTcpEndpoint: typeof app.getExecutionTcpEndpoint === 'function'
                    ? app.getExecutionTcpEndpoint()
                    : null
            };
        } catch (error) {
            app.logger.error(`获取TCP配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('save-registration-tcp-config', async (_event, payload = {}) => {
        try {
            const incoming = payload && typeof payload === 'object' ? payload : {};
            const config = {
                tcp_server_url: normalizeTcpServerUrl(
                    incoming.tcp_server_url
                    || incoming.tcpServerUrl
                    || incoming.server_url
                    || incoming.serverUrl
                    || ''
                ),
                tcp_auto_reconnect_enabled: normalizeBooleanValue(
                    incoming.tcp_auto_reconnect_enabled
                    ?? incoming.tcpAutoReconnectEnabled
                    ?? incoming.registration_tcp_auto_reconnect_enabled
                    ?? incoming.registrationTcpAutoReconnectEnabled,
                    true
                )
            };

            const saveResult = typeof app.saveRegistrationTcpConfigToDisk === 'function'
                ? await app.saveRegistrationTcpConfigToDisk(config)
                : { success: false, error: 'TCP配置保存接口不可用' };
            if (!saveResult || saveResult.success !== true) {
                return saveResult || { success: false, error: 'TCP配置保存失败' };
            }

            const applyResult = typeof app.applyUserConfig === 'function'
                ? await app.applyUserConfig(saveResult.config || config, {
                    source: 'saved-registration-tcp-config',
                    restartTcpBridge: true
                })
                : null;

            if (applyResult?.tcpConfigApplied && applyResult.tcpRestartError) {
                app.logger.warning(`TCP桥接重启失败: ${applyResult.tcpRestartError}`);
            }

            return {
                success: true,
                tcpServerUrl: (saveResult.config && saveResult.config.tcp_server_url) || config.tcp_server_url,
                tcpAutoReconnectEnabled: (saveResult.config && saveResult.config.tcp_auto_reconnect_enabled) !== undefined
                    ? saveResult.config.tcp_auto_reconnect_enabled
                    : config.tcp_auto_reconnect_enabled,
                tcpRestartError: applyResult?.tcpRestartError || '',
                registrationTcpEndpoint: applyResult?.registrationTcpEndpoint || app.getExecutionTcpEndpoint?.() || null,
                registrationTcpReconnectEnabled: applyResult?.registrationTcpReconnectEnabled !== undefined
                    ? applyResult.registrationTcpReconnectEnabled
                    : app.registrationTcpReconnectEnabled !== false
            };
        } catch (error) {
            app.logger.error(`保存TCP配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('save-cookie-user-config', async (_event, config) => {
        try {
            const paths = typeof app.ensureConfigPathReady === 'function'
                ? await app.ensureConfigPathReady()
                : app.getConfigPath();
            const targetPath = paths.dev || paths.installed;
            let existingConfig = {};
            if (targetPath && await fs.pathExists(targetPath)) {
                try {
                    existingConfig = await fs.readJson(targetPath);
                } catch (_) {
                    existingConfig = {};
                }
            }
            const mergedConfig = mergeConfigWithExisting(existingConfig, config);
            const cleanedConfig = stripEmailConfigCompatFields(mergedConfig);
            await fs.ensureDir(path.dirname(targetPath));
            await fs.writeJson(targetPath, cleanedConfig, { spaces: 4 });

            const applyResult = typeof app.applyUserConfig === 'function'
                ? await app.applyUserConfig(cleanedConfig, {
                    source: 'saved-cookie-user-config',
                    restartTcpBridge: true
                })
                : null;

            app.logger.info('浏览器配置已保存');
            if (applyResult?.tcpConfigApplied && applyResult.tcpRestartError) {
                app.logger.warning(`TCP桥接重启失败: ${applyResult.tcpRestartError}`);
            }

            return {
                success: true,
                tcpApplied: applyResult?.tcpConfigApplied === true,
                tcpReconnectApplied: applyResult?.tcpReconnectApplied === true,
                tcpRestarted: applyResult?.tcpRestarted === true,
                tcpRestartError: applyResult?.tcpRestartError || '',
                registrationTcpEndpoint: applyResult?.registrationTcpEndpoint || app.getExecutionTcpEndpoint?.() || null,
                registrationTcpReconnectEnabled: applyResult?.registrationTcpReconnectEnabled !== undefined
                    ? applyResult.registrationTcpReconnectEnabled
                    : app.registrationTcpReconnectEnabled !== false
            };
        } catch (error) {
            app.logger.error(`保存后端配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('cookie-get-cookie-data-by-file', async (_event, cardName, fileName) => {
        try {
            if (!cardName || !fileName) {
                return { success: false, error: '卡片名称或文件名不能为空' };
            }

            const cookies = await app.cookieManager.getCookieDataByFile(cardName, fileName);
            return { success: true, cookies };
        } catch (error) {
            app.logger.error(`读取 Cookie 数据失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('cookie-upload-ai-cookie', async (_event, serverUrl, payload) => {
        try {
            if (typeof serverUrl !== 'string' || !serverUrl.trim()) {
                return { success: false, error: '服务器地址不能为空' };
            }

            const normalizedUrl = serverUrl.trim().replace(/\/$/, '');
            const uploadBody = {
                key: payload?.key || '',
                device_id: payload?.device_id || payload?.deviceId || '',
                account: payload?.account || '',
                password: payload?.password || '',
                cookies: payload?.cookies || [],
                score: payload?.score ?? 0,
                today_used: payload?.today_used ?? 2,
                today_score: payload?.today_score ?? null,
                last_used_at: payload?.last_used_at ?? '',
                note: payload?.note ?? '',
                target_score_scope: payload?.target_score_scope ?? payload?.targetScoreScope ?? '',
                target_score_types: payload?.target_score_types ?? payload?.targetScoreTypes ?? [],
                target_score_type: payload?.target_score_type ?? payload?.targetScoreType ?? '',
                platform: payload?.platform ?? ''
            };

            const url = `${normalizedUrl}/api/upload_ai_cookie`;
            const uploadResult = await requestJson(url, {
                method: 'POST',
                body: uploadBody,
                timeout: 15000
            });

            if (uploadResult.success) {
                app.logger.info(`上传AI账号Cookie响应: ${uploadResult.statusCode} ${JSON.stringify(uploadResult.body)}`);
                return { success: true, status: uploadResult.statusCode, body: uploadResult.body };
            }

            app.logger.error(`上传AI账号Cookie失败: ${uploadResult.error}`);
            return { success: false, error: uploadResult.error };
        } catch (error) {
            app.logger.error(`上传AI账号Cookie异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};

