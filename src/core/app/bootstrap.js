const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const http = require('http');
const https = require('https');

const HaikaManager = require('../haika/haika-manager');
const HaikaStateStore = require('../haika/haika-state-store');
const registerLoginIpcHandlers = require('../ipc/login-ipc');
const registerWebLoginHandlers = require('../ipc/login-web-ipc');
const {
    extractLicenseExpiryText,
    extractLicenseUsageInfo,
    parseLicenseExpiryTimestamp
} = require('../infra/license-utils');
const {
    createLicenseCacheCodec,
    normalizeLicenseCacheRecord,
    normalizeUsageSnapshot,
    resolveUsageState,
    normalizeUsageState
} = require('../infra/license-cache');
const {
    clearChunkedTimeout,
    createChunkedTimeout
} = require('../infra/timeout-utils');
const {
    stripBrowserSettingsCompatFields,
    stripRuntimeConfigCompatFields
} = require('../infra/config-utils');
const { machineIdSync } = require('../infra/machine-id');

function isDevModeEnabled() {
    const argv = Array.isArray(process.argv) ? process.argv : [];
    return process.env.DEV_MODE === '1' ||
        process.env.DEV_MODE === 'true' ||
        argv.includes('--dev-mode');
}

function openDetachedDevTools(targetWindow) {
    if (!targetWindow || (typeof targetWindow.isDestroyed === 'function' && targetWindow.isDestroyed())) {
        return;
    }

    const wc = targetWindow.webContents;
    if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) {
        return;
    }

    if (typeof wc.isDevToolsOpened === 'function' && wc.isDevToolsOpened()) {
        try {
            if (wc.devToolsWebContents && typeof wc.devToolsWebContents.focus === 'function') {
                wc.devToolsWebContents.focus();
            }
        } catch (_) {}
        return;
    }

    wc.openDevTools({ mode: 'detach' });
}

function queueAutoConnectEmail(appInstance) {
    if (!appInstance || !appInstance.emailClient) {
        return;
    }

    setTimeout(() => {
        try {
            if (appInstance.emailClient.setLogger) {
                appInstance.emailClient.setLogger(appInstance.logger);
            }

            appInstance.logger.info(`尝试自动连接邮箱: ${appInstance.emailClient.serverHost}:${appInstance.emailClient.serverPort}`);
            void appInstance.emailClient.connect().catch((error) => {
                appInstance.logger.error(`自动连接邮箱失败: ${error.message}`);
                appInstance.emitUiEvent('email-log', { level: 'error', message: `❌ 自动连接邮箱失败: ${error.message}` });
                appInstance.emitUiEvent('email-disconnected');
            });
        } catch (error) {
            appInstance.logger.error(`自动连接邮箱失败: ${error.message}`);
            appInstance.emitUiEvent('email-log', { level: 'error', message: `❌ 自动连接邮箱失败: ${error.message}` });
            appInstance.emitUiEvent('email-disconnected');
        }
    }, 0);
}

module.exports = {
    isDevModeEnabled,

    setupLoginIpcHandlers() {
        if (this.loginIpcHandlersRegistered) {
            return;
        }

        registerLoginIpcHandlers({
            app: this,
            ipcMain
        });
        this.loginIpcHandlersRegistered = true;
    },

    setupWebLoginRpcHandlers() {
        if (this.webLoginRpcHandlersRegistered) {
            return;
        }

        registerWebLoginHandlers({
            app: this,
            ipcMain: this.rpcRegistry
        });
        this.webLoginRpcHandlersRegistered = true;
    },

    async createLoginWindow() {
        this.loginWindow = new BrowserWindow({
            width: 480,
            height: 520,
            resizable: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            },
            icon: path.join(this.projectRoot, 'src/ui/assets/icon.ico'),
            title: '卡密验证 - AI 自动化工具 2.0'
        });

        this.setupLoginIpcHandlers();
        this.setupRpcHandlers();
        this.setupWebLoginRpcHandlers();
        this.loginWindow.loadFile(path.join(this.projectRoot, 'src/ui/login.html'));

        if (this.webControlConfig?.enabled) {
            if (!this.webControlServer || !this.webControlServer.isRunning()) {
                await this.startWebControlServer();
            }
        }

        if (process.argv.includes('--dev') || process.argv.includes('--dev-mode') || this.devMode) {
            openDetachedDevTools(this.loginWindow);
        }

        this.loginWindow.on('closed', () => {
            this.loginWindow = null;
            if (!this.isValidated) {
                app.quit();
            }
        });

    },

    async showMainWindow() {
        if (this.mainUiStartupPromise) {
            return await this.mainUiStartupPromise;
        }

        this.mainUiStartupPromise = (async () => {
        this.setupIpcHandlers();
        this.setupRpcHandlers();
        this.setupWebLoginRpcHandlers();
        await this.ensureHaikaManager();
        await this.ensureHaikaStateStore();

        try {
            if (!this.startupUserConfigApplied) {
                await this.loadAndApplyUserConfig();
                this.startupUserConfigApplied = true;
            }
        } catch (configError) {
            this.logger.warning(`加载初始运行配置失败: ${configError.message}`);
        }

        try {
            await this.startExecutionTcpConnectionMonitor({ immediate: true });
        } catch (tcpError) {
            this.logger.warning(`启动TCP连接监控失败: ${tcpError.message}`);
        }

        this.cookieManager.setLogger(this.logger);
        this.cardManager.setLogger(this.logger);
        await this.migrateCookieFormats();
        const webControlResult = await this.startWebControlServer();
        this.bindEmailClientUiEvents();

        if (this.webControlConfig?.headless) {
            this.mainWindow = this.headlessUiWindow;
            this.logger.mainWindow = this.mainWindow;
            if (this.browserManager && typeof this.browserManager.setMainWindow === 'function') {
                this.browserManager.setMainWindow(this.mainWindow);
            }
            this.cookieTester.setMainWindow(this.mainWindow);
            Menu.setApplicationMenu(null);
            queueAutoConnectEmail(this);
            return;
        }

        this.createWindow();
        this.setupMenu();
        })();

        try {
            return await this.mainUiStartupPromise;
        } finally {
            this.mainUiStartupPromise = null;
        }
    },

    async ensureHaikaManager() {
        if (!this.haikaManager) {
            this.haikaManager = new HaikaManager({ logger: this.logger });
        } else {
            this.haikaManager.setLogger(this.logger);
        }

        await this.haikaManager.initialize();
        return this.haikaManager;
    },

    async ensureHaikaStateStore() {
        if (!this.haikaStateStore) {
            this.haikaStateStore = new HaikaStateStore({ logger: this.logger });
        } else if (typeof this.haikaStateStore.setLogger === 'function') {
            this.haikaStateStore.setLogger(this.logger);
        }

        return this.haikaStateStore;
    },

    async loadHaikaLatestState(options = {}) {
        const store = await this.ensureHaikaStateStore();
        return await store.buildSnapshot(options);
    },

    async saveHaikaLatestExchange(record = {}) {
        const store = await this.ensureHaikaStateStore();
        return await store.updateLatestExchange(record);
    },

    async saveHaikaLatestSmsRecord(record = {}) {
        const store = await this.ensureHaikaStateStore();
        return await store.updateLatestSmsRecord(record);
    },

    async getLatestHaikaSmsRecord(smsApiUrl) {
        const store = await this.ensureHaikaStateStore();
        return await store.getLatestSmsRecord(smsApiUrl);
    },

    async fetchHaikaSmsCode(smsApiUrl) {
        const targetUrl = new URL(smsApiUrl);
        const transport = targetUrl.protocol === 'https:' ? https : http;
        const stateStore = await this.ensureHaikaStateStore();
        let previousRecord = null;
        try {
            previousRecord = await stateStore.getLatestSmsRecord(smsApiUrl);
        } catch (recordError) {
            this.logger.warning(`读取上次海卡验证码记录失败: ${recordError.message}`);
        }

        return new Promise((resolve) => {
            const options = {
                protocol: targetUrl.protocol,
                hostname: targetUrl.hostname,
                port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
                path: `${targetUrl.pathname}${targetUrl.search}`,
                method: 'GET',
                timeout: 10000,
                headers: {
                    'User-Agent': 'AI-Account-Register-2.0'
                }
            };

            const req = transport.request(options, (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', async () => {
                    try {
                        const rawText = (data || '').trim();
                        let parsed = null;
                        const noCodeHint = /暂无验证码|no|none|null|nil|empty|未获取到验证码/i.test(rawText);

                        try {
                            parsed = rawText ? JSON.parse(rawText) : null;
                        } catch (error) {
                            parsed = null;
                        }

                        const codeCandidates = [];

                        const pushCandidate = (value) => {
                            if (value === null || value === undefined) return;
                            const text = String(value).trim();
                            if (!text) return;
                            if (/^(暂无验证码|no|none|null|nil|empty|未获取到验证码)$/i.test(text)) {
                                return;
                            }
                            codeCandidates.push(text);
                        };

                        pushCandidate(parsed?.code);
                        pushCandidate(parsed?.sms_code);
                        pushCandidate(parsed?.verification_code);
                        pushCandidate(parsed?.data?.code);
                        pushCandidate(parsed?.data?.sms_code);
                        pushCandidate(parsed?.data?.verification_code);

                        if (rawText.includes('|')) {
                            const pipeSegments = rawText.split('|').map(segment => segment.trim()).filter(Boolean);
                            if (pipeSegments.length >= 3) {
                                pushCandidate(pipeSegments[1]);
                            } else if (pipeSegments.length === 2) {
                                pushCandidate(pipeSegments[0]);
                                pushCandidate(pipeSegments[1]);
                            }
                        }

                        if (!noCodeHint) {
                            pushCandidate(rawText.match(/(?:验证码|verification[_\s-]*code|sms[_\s-]*code|code)[^\d]{0,20}(\d{4,8})/i)?.[1]);
                            pushCandidate(rawText.match(/\b\d{4,8}\b/)?.[0]);
                        }

                        const code = codeCandidates.length > 0 ? String(codeCandidates[0]) : '';
                        const isEmptyNotice = noCodeHint && !code;
                        const isDuplicate = !!(code && previousRecord && String(previousRecord.code || '').trim() === code);

                        if (code) {
                            try {
                                await stateStore.updateLatestSmsRecord({
                                    smsApiUrl,
                                    code,
                                    previousCode: previousRecord?.code || '',
                                    duplicate: isDuplicate,
                                    raw: parsed || rawText,
                                    statusCode: res.statusCode
                                });
                            } catch (saveError) {
                                this.logger.warning(`保存海卡验证码记录失败: ${saveError.message}`);
                            }
                        }

                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve({
                                success: true,
                                code,
                                hasCode: !!code,
                                duplicate: isDuplicate,
                                previousCode: previousRecord?.code || '',
                                emptyNotice: isEmptyNotice,
                                raw: parsed || rawText,
                                statusCode: res.statusCode
                            });
                            return;
                        }

                        resolve({
                            success: false,
                            error: parsed?.message || parsed?.error || rawText || `请求失败 (${res.statusCode})`,
                            code,
                            hasCode: !!code,
                            duplicate: isDuplicate,
                            previousCode: previousRecord?.code || '',
                            emptyNotice: isEmptyNotice,
                            raw: parsed || rawText,
                            statusCode: res.statusCode
                        });
                    } catch (error) {
                        resolve({
                            success: false,
                            error: error.message || '验证码响应处理失败'
                        });
                    }
                });
            });

            req.on('error', (error) => {
                resolve({ success: false, error: error.message });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false, error: '验证码接口请求超时' });
            });

            req.end();
        });
    },

    getConfigPath() {
        const isDev = !(app && typeof app.isPackaged === 'boolean' ? app.isPackaged : false);
        const resourceConfigPath = path.join('resource', 'browser_config.json');
        const legacyConfigPath = path.join('resource', 'config.json');
        const legacyAltConfigName = 'cookie_user_config.json';

        if (isDev) {
            return {
                installed: null,
                dev: path.join(process.cwd(), resourceConfigPath),
                legacyInstalled: null,
                legacyDev: path.join(process.cwd(), legacyConfigPath),
                legacyAltInstalled: null,
                legacyAltDev: path.join(process.cwd(), legacyAltConfigName),
                bundled: path.join(process.cwd(), resourceConfigPath)
            };
        } else {
            return {
                installed: path.join(app.getPath('userData'), resourceConfigPath),
                dev: null,
                legacyInstalled: path.join(path.dirname(process.resourcesPath), legacyConfigPath),
                legacyAltInstalled: path.join(path.dirname(process.resourcesPath), legacyAltConfigName),
                legacyDev: null,
                bundled: path.join(process.resourcesPath, resourceConfigPath)
            };
        }
    },

    getRuntimeConfigPath() {
        return this.getConfigPath();
    },

    async ensureConfigPathReady() {
        const paths = this.getConfigPath();
        const targetPath = paths.dev || paths.installed;
        const legacyPaths = [
            paths.legacyDev || paths.legacyInstalled,
            paths.legacyAltDev || paths.legacyAltInstalled
        ].filter(Boolean);
        const bundledPath = paths.bundled;

        if (!targetPath) {
            return paths;
        }

        await fs.ensureDir(path.dirname(targetPath));

        if (!(await fs.pathExists(targetPath))) {
            for (const legacyPath of legacyPaths) {
                if (!legacyPath || !(await fs.pathExists(legacyPath))) {
                    continue;
                }

                await fs.move(legacyPath, targetPath, { overwrite: false });
                this.logger?.info?.(`已迁移浏览器配置到 resource 目录: ${legacyPath} -> ${targetPath}`);
                return paths;
            }
        }

        if (!(await fs.pathExists(targetPath)) && bundledPath && bundledPath !== targetPath && await fs.pathExists(bundledPath)) {
            try {
                await fs.copy(bundledPath, targetPath);
                this.logger?.info?.(`已初始化浏览器配置: ${bundledPath} -> ${targetPath}`);
            } catch (copyError) {
                this.logger?.warning?.(`初始化浏览器配置失败: ${copyError.message}`);
            }
        }

        return paths;
    },

    async ensureRuntimeConfigPathReady() {
        const paths = this.getRuntimeConfigPath();
        const targetPath = paths.installed || paths.dev;
        const bundledPath = paths.bundled;

        if (!targetPath) {
            return paths;
        }

        await fs.ensureDir(path.dirname(targetPath));

        if (!(await fs.pathExists(targetPath)) && bundledPath && bundledPath !== targetPath && await fs.pathExists(bundledPath)) {
            try {
                await fs.copy(bundledPath, targetPath);
                this.logger?.info?.(`已初始化运行配置: ${bundledPath} -> ${targetPath}`);
            } catch (copyError) {
                this.logger?.warning?.(`初始化运行配置失败: ${copyError.message}`);
            }
        }

        return paths;
    },

    async readExecutionRuntimeConfigFromDisk() {
        try {
            const paths = await this.ensureRuntimeConfigPathReady();
            const preferredPath = paths.installed || paths.dev;
            const fallbackPath = paths.bundled && paths.bundled !== preferredPath ? paths.bundled : null;

            if (preferredPath && await fs.pathExists(preferredPath)) {
                return stripRuntimeConfigCompatFields(await fs.readJson(preferredPath));
            }

            if (fallbackPath && await fs.pathExists(fallbackPath)) {
                return stripRuntimeConfigCompatFields(await fs.readJson(fallbackPath));
            }

            return {};
        } catch (error) {
            this.logger?.warning?.(`读取运行配置失败: ${error.message}`);
            return {};
        }
    },

    async saveRegistrationRuntimeConfigToDisk(config = {}) {
        const paths = await this.ensureRuntimeConfigPathReady();
        const targetPath = paths.installed || paths.dev;
        if (!targetPath) {
            return { success: false, error: '运行配置路径不可用' };
        }

        const normalizedConfig = config && typeof config === 'object' ? { ...config } : {};
        let existingConfig = {};
        if (await fs.pathExists(targetPath)) {
            try {
                existingConfig = await fs.readJson(targetPath);
            } catch (_) {
                existingConfig = {};
            }
        }

        const existingBrowserSettings = existingConfig.browserSettings && typeof existingConfig.browserSettings === 'object'
            ? { ...existingConfig.browserSettings }
            : {};
        const runtimeBrowserSettings = normalizedConfig.browserSettings && typeof normalizedConfig.browserSettings === 'object'
            ? { ...normalizedConfig.browserSettings }
            : {};
        const mergedConfig = {
            ...existingConfig,
            ...normalizedConfig
        };

        mergedConfig.browserSettings = {
            ...existingBrowserSettings,
            ...runtimeBrowserSettings
        };
        mergedConfig.browserSettings = stripBrowserSettingsCompatFields(mergedConfig.browserSettings);
        const cleanedConfig = stripRuntimeConfigCompatFields(mergedConfig);

        await fs.ensureDir(path.dirname(targetPath));
        await fs.writeJson(targetPath, cleanedConfig, { spaces: 4 });

        return {
            success: true,
            config: cleanedConfig,
            configPath: targetPath
        };
    },

    getLicenseCachePath() {
        return path.join(app.getPath('userData'), 'license-cache.json');
    },

    getLicenseCacheCodec() {
        let machineSeed = '';
        try {
            machineSeed = machineIdSync({ original: true }) || '';
        } catch (_error) {
            machineSeed = '';
        }

        return createLicenseCacheCodec([
            machineSeed,
            app.getPath('userData'),
            process.platform,
            process.arch
        ]);
    },

    async readSavedLicenseCache() {
        try {
            const cachePath = this.getLicenseCachePath();
            if (!(await fs.pathExists(cachePath))) {
                return null;
            }

            const codec = this.getLicenseCacheCodec();
            const rawCache = await fs.readJson(cachePath);
            const cache = codec.decryptCacheRecord(rawCache);
            if (!cache) {
                return null;
            }

            const expireAtTimestamp = Number.isFinite(Number(cache.expireAtTimestamp))
                ? Number(cache.expireAtTimestamp)
                : parseLicenseExpiryTimestamp(cache.expireAt || '');
            if (expireAtTimestamp > 0 && expireAtTimestamp <= Date.now()) {
                this.logger?.warning?.(`卡密缓存已到期，但保留本地记录: ${typeof cache.expireAt === 'string' ? cache.expireAt : expireAtTimestamp}`);
            }

            return normalizeLicenseCacheRecord(cache);
        } catch (error) {
            this.logger?.warning?.(`读取卡密缓存失败: ${error.message}`);
            return null;
        }
    },

    async readSavedCardKey() {
        const cache = await this.readSavedLicenseCache();
        return typeof cache?.cardKey === 'string' ? cache.cardKey : '';
    },

    async saveCardKeyToCache(cardKey, metadata = {}) {
        const cachePath = this.getLicenseCachePath();
        const normalizedKey = String(cardKey || '').trim();
        const existingCache = await this.readSavedLicenseCache();
        const expireAtText = typeof metadata?.expireAt === 'string'
            ? metadata.expireAt.trim()
            : extractLicenseExpiryText(metadata?.result || metadata?.validationResult || metadata || {});
        const expireAtTimestamp = Number.isFinite(Number(metadata?.expireAtTimestamp))
            ? Number(metadata.expireAtTimestamp)
            : parseLicenseExpiryTimestamp(expireAtText);
        const usageSource = normalizeUsageSnapshot(metadata?.usageInfo)
            || extractLicenseUsageInfo(metadata?.result || metadata?.validationResult || metadata || {});
        const scopedExistingCache = existingCache && String(existingCache.cardKey || '').trim() === normalizedKey
            ? existingCache
            : null;
        const resolvedUsage = resolveUsageState(scopedExistingCache, usageSource, {
            consumeCount: Number.isFinite(Number(metadata?.consumeUsageCount))
                ? Math.max(0, Number(metadata.consumeUsageCount))
                : 0
        });
        const normalizedCacheRecord = normalizeLicenseCacheRecord({
            version: 2,
            cardKey: normalizedKey,
            expireAt: expireAtText,
            expireAtTimestamp,
            usageInfo: resolvedUsage.usageInfo,
            usageState: resolvedUsage.usageState,
            savedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: typeof metadata?.source === 'string' ? metadata.source.trim() : 'validation'
        });
        const codec = this.getLicenseCacheCodec();
        await fs.ensureDir(path.dirname(cachePath));
        await fs.writeJson(cachePath, codec.encryptCacheRecord(normalizedCacheRecord), { spaces: 2 });

        return {
            success: true,
            cache: normalizedCacheRecord
        };
    },

    async consumeSavedCardUsage(cardKey, usageCount = 1, metadata = {}) {
        const normalizedKey = String(cardKey || this.currentCardKey || '').trim();
        const count = Number.isFinite(Number(usageCount)) ? Math.max(0, Math.floor(Number(usageCount))) : 1;
        if (!normalizedKey || count <= 0) {
            return { success: false, skipped: true, error: '卡密或消费次数无效' };
        }

        const existingCache = await this.readSavedLicenseCache();
        if (!existingCache || String(existingCache.cardKey || '').trim() !== normalizedKey) {
            return { success: false, skipped: true, error: '未找到匹配的卡密缓存' };
        }

        const cacheResult = await this.saveCardKeyToCache(normalizedKey, {
            ...metadata,
            expireAt: typeof metadata?.expireAt === 'string' ? metadata.expireAt : existingCache.expireAt || '',
            expireAtTimestamp: Number.isFinite(Number(metadata?.expireAtTimestamp))
                ? Number(metadata.expireAtTimestamp)
                : Number(existingCache.expireAtTimestamp) || 0,
            consumeUsageCount: count
        });

        const usageState = normalizeUsageState(cacheResult?.cache?.usageState);
        if (usageState && Number.isFinite(usageState.totalCount)) {
            this.logger?.info?.(
                `卡密次数已扣减: 剩余 ${Math.max(0, usageState.remainingCount ?? 0)} / 总数 ${usageState.totalCount}，已用 ${Math.max(0, usageState.consumedCount ?? 0)}`
            );
        }

        return {
            success: cacheResult.success === true,
            cache: cacheResult.cache || null
        };
    },

    async isLicenseUsageExhausted(cardKey = this.currentCardKey || this.currentCardValidationSnapshot?.key || '') {
        const normalizedKey = String(cardKey || '').trim();
        if (!normalizedKey) {
            return {
                exhausted: false,
                usageInfo: normalizeUsageSnapshot(this.currentCardUsageSnapshot) || null
            };
        }

        const currentSnapshot = normalizeUsageSnapshot(this.currentCardUsageSnapshot);
        if (currentSnapshot && currentSnapshot.unlimited === true) {
            return {
                exhausted: false,
                usageInfo: currentSnapshot
            };
        }

        if (currentSnapshot) {
            const snapshotState = resolveUsageState(null, currentSnapshot).usageState;
            if (snapshotState && Number.isFinite(snapshotState.totalCount)) {
                return {
                    exhausted: snapshotState.remainingCount <= 0,
                    usageInfo: currentSnapshot
                };
            }
        }

        try {
            const cache = await this.readSavedLicenseCache();
            if (!cache || String(cache.cardKey || '').trim() !== normalizedKey) {
                return {
                    exhausted: false,
                    usageInfo: currentSnapshot || null
                };
            }

            const usageState = normalizeUsageState(cache.usageState);
            if (!usageState || !Number.isFinite(usageState.totalCount)) {
                return {
                    exhausted: false,
                    usageInfo: currentSnapshot || normalizeUsageSnapshot(cache.usageInfo) || null
                };
            }

            return {
                exhausted: usageState.remainingCount <= 0,
                usageInfo: normalizeUsageSnapshot(cache.usageInfo) || currentSnapshot || null
            };
        } catch (error) {
            this.logger?.warning?.(`检查卡密剩余次数失败: ${error.message}`);
            return {
                exhausted: false,
                usageInfo: currentSnapshot || null
            };
        }
    },

    async scheduleLicenseExpiryReturn(expireAtValue, options = {}) {
        const expireAtText = typeof expireAtValue === 'string' && expireAtValue.trim()
            ? expireAtValue.trim()
            : extractLicenseExpiryText(expireAtValue || options?.result || {});
        const expireAtTimestamp = parseLicenseExpiryTimestamp(expireAtText);
        const usageInfo = normalizeUsageSnapshot(options?.usageInfo)
            || extractLicenseUsageInfo(options?.result || expireAtValue || {});

        this.currentCardExpireAt = expireAtText;
        this.currentCardExpireAtTimestamp = expireAtTimestamp;
        this.currentCardUsageSnapshot = usageInfo;
        this.licenseUsageLocked = usageInfo.locked === true;
        this.currentCardValidationSnapshot = {
            key: typeof options?.key === 'string' ? options.key.trim() : '',
            expireAt: expireAtText,
            expireAtTimestamp,
            usageInfo,
            source: typeof options?.source === 'string' ? options.source : 'validation',
            updatedAt: new Date().toISOString()
        };

        clearChunkedTimeout(this.licenseExpiryTimer);
        this.licenseExpiryTimer = null;

        if (!expireAtTimestamp) {
            if (expireAtText) {
                this.logger?.warning?.(`卡密验证成功但未能解析到有效日期: ${expireAtText}`);
            }
            this.logger?.info?.(`卡密有效时间: ${expireAtText || '未提供'}`);
            if (usageInfo.summaryText) {
                this.logger?.info?.(`卡密次数信息: ${usageInfo.summaryText}${usageInfo.locked ? '（软件已锁定）' : ''}`);
            } else if (usageInfo.unlimited) {
                this.logger?.info?.('卡密次数信息: 无限次数');
            } else {
                this.logger?.info?.('卡密次数信息: 未提供');
            }
            this.logger?.info?.('卡密定时器: 未设置');
            return { success: true, scheduled: false, expireAt: expireAtText, expireAtTimestamp: 0, usageInfo };
        }

        const delayMs = expireAtTimestamp - Date.now();
        if (delayMs <= 0) {
            this.logger?.warning?.(`卡密已到期，准备返回登录页: ${expireAtText}`);
            this.logger?.info?.(`卡密有效时间: ${expireAtText}`);
            if (usageInfo.summaryText) {
                this.logger?.info?.(`卡密次数信息: ${usageInfo.summaryText}${usageInfo.locked ? '（软件已锁定）' : ''}`);
            } else if (usageInfo.unlimited) {
                this.logger?.info?.('卡密次数信息: 无限次数');
            } else {
                this.logger?.info?.('卡密次数信息: 未提供');
            }
            this.logger?.info?.('卡密定时器: 未设置');
            setImmediate(() => {
                void this.returnToLoginFromLicenseExpiry('expired');
            });
            return { success: true, scheduled: false, expired: true, expireAt: expireAtText, expireAtTimestamp, usageInfo };
        }

        this.licenseExpiryTimer = createChunkedTimeout(delayMs, () => {
            this.licenseExpiryTimer = null;
            void this.returnToLoginFromLicenseExpiry('timer');
        });

        this.logger?.info?.(`卡密有效时间: ${expireAtText}`);
        if (usageInfo.summaryText) {
            this.logger?.info?.(`卡密次数信息: ${usageInfo.summaryText}${usageInfo.locked ? '（软件已锁定）' : ''}`);
        } else if (usageInfo.unlimited) {
            this.logger?.info?.('卡密次数信息: 无限次数');
        } else {
            this.logger?.info?.('卡密次数信息: 未提供');
        }
        this.logger?.info?.(`卡密定时器: 已设置（${Math.max(0, Math.round(delayMs / 1000))} 秒后执行）`);
        return {
            success: true,
            scheduled: true,
            expireAt: expireAtText,
            expireAtTimestamp,
            delayMs,
            usageInfo
        };
    },

    async returnToLoginFromLicenseExpiry(reason = 'timer') {
        if (this.__licenseExpiryReturnInProgress) {
            return { success: true, skipped: true };
        }

        this.__licenseExpiryReturnInProgress = true;
        try {
            clearChunkedTimeout(this.licenseExpiryTimer);
            this.licenseExpiryTimer = null;

            this.logger?.warning?.(`卡密到期，自动返回登录页 (${reason})`);
            this.currentCardExpireAt = '';
            this.currentCardExpireAtTimestamp = 0;
            this.currentCardUsageSnapshot = null;
            this.licenseUsageLocked = false;
            this.currentCardValidationSnapshot = null;
            this.isValidated = false;

            try {
                await this.stopRegistration?.({ closeBrowsers: true, reason: 'license_expired' });
            } catch (stopError) {
                this.logger?.warning?.(`到期后停止执行流程失败: ${stopError.message}`);
            }

            if (this.desktopWindow && !this.desktopWindow.isDestroyed()) {
                this.desktopWindow.close();
            }

            const loginWindow = this.loginWindow && !this.loginWindow.isDestroyed()
                ? this.loginWindow
                : null;

            if (!loginWindow) {
                await this.createLoginWindow();
            } else if (typeof loginWindow.show === 'function') {
                loginWindow.show();
                if (typeof loginWindow.focus === 'function') {
                    loginWindow.focus();
                }
            }

            return { success: true };
        } catch (error) {
            this.logger?.error?.(`卡密到期返回登录页失败: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            this.__licenseExpiryReturnInProgress = false;
        }
    },

    async clearSavedCardKey() {
        try {
            const cachePath = this.getLicenseCachePath();
            if (await fs.pathExists(cachePath)) {
                await fs.remove(cachePath);
            }
            this.currentCardExpireAt = '';
            this.currentCardExpireAtTimestamp = 0;
            this.currentCardUsageSnapshot = null;
            this.licenseUsageLocked = false;
            this.currentCardValidationSnapshot = null;
            return { success: true };
        } catch (error) {
            this.logger?.warning?.(`清除卡密缓存失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    initApp() {
        app.whenReady().then(async () => {
            try {
                await this.loadAndApplyUserConfig();
                this.startupUserConfigApplied = true;
            } catch (configError) {
                this.logger.warning(`启动时加载运行配置失败: ${configError.message}`);
            }

            try {
                await this.refreshHardwareInfo?.();
            } catch (hardwareError) {
                this.logger.warning(`启动时刷新硬件信息失败: ${hardwareError.message}`);
            }

            await this.logDeviceIdOnStartup?.();

            try {
                await this.startExecutionTcpConnectionMonitor({ immediate: true });
            } catch (tcpError) {
                this.logger.warning(`启动TCP连接监控失败: ${tcpError.message}`);
            }

            if (this.devMode) {
                this.isValidated = true;
                this.logger.info('开发模式已启用，已跳过卡密验证');
                await this.showMainWindow();
                return;
            }

            if (this.isTcpManagedMode()) {
                this.isValidated = true;
                this.logger.info('TCP 启动模式已启用，已跳过卡密验证');
                if (this.webControlConfig?.enabled) {
                    this.setupWebLoginRpcHandlers();
                    this.setupRpcHandlers();
                    this.cookieManager.setLogger(this.logger);
                    this.cardManager.setLogger(this.logger);
                    this.bindEmailClientUiEvents();

                    try {
                        if (!this.startupUserConfigApplied) {
                            await this.loadAndApplyUserConfig?.();
                            this.startupUserConfigApplied = true;
                        }
                    } catch (configError) {
                        this.logger.warning(`登录前加载运行配置失败: ${configError.message}`);
                    }

                    await this.startWebControlServer();
                    return;
                }

                await this.showMainWindow();
                return;
            }

            if (this.webControlConfig?.enabled) {
                this.setupWebLoginRpcHandlers();
                this.setupRpcHandlers();
                this.cookieManager.setLogger(this.logger);
                this.cardManager.setLogger(this.logger);
                this.bindEmailClientUiEvents();

                try {
                    if (!this.startupUserConfigApplied) {
                        await this.loadAndApplyUserConfig?.();
                        this.startupUserConfigApplied = true;
                    }
                } catch (configError) {
                    this.logger.warning(`登录前加载运行配置失败: ${configError.message}`);
                }

                const webControlResult = await this.startWebControlServer();
                const loginUrl = `${webControlResult?.url || this.webControlServer?.getUrl?.() || ''}/login`;

                return;
            }

            await this.createLoginWindow();
        });

        app.on('window-all-closed', () => {
            if (this.__cleanupAndExitInProgress || this.__exitRequested) {
                return;
            }
            if (this.webControlConfig?.headless && this.isValidated) {
                return;
            }
            if (process.platform !== 'darwin') {
                this.cleanupAndExit();
            }
        });

        app.on('activate', async () => {
            if (BrowserWindow.getAllWindows().length !== 0) {
                return;
            }

            if (this.isValidated) {
                if (!this.webControlConfig?.headless) {
                    this.createWindow();
                }
                return;
            }

            if (!this.loginWindow) {
                if (this.webControlConfig?.enabled) {
                    return;
                }
                await this.createLoginWindow();
            }
        });
    },

    createWindow() {
        this.desktopWindow = new BrowserWindow({
            width: 1600,
            height: 900,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true
            },
            icon: path.join(this.projectRoot, 'src/ui/assets/icon.ico'),
            title: 'AI 自动化工具 2.0'
        });

        this.mainWindow = this.desktopWindow;
        this.uiChannelManager.attachElectronWindow(this.desktopWindow);
        this.logger.mainWindow = this.mainWindow;
        if (this.browserManager && typeof this.browserManager.setMainWindow === 'function') {
            this.browserManager.setMainWindow(this.mainWindow);
        }
        this.cookieTester.setMainWindow(this.mainWindow);

        this.desktopWindow.webContents.on('did-start-loading', () => {
            this.logger.info('主窗口开始加载页面');
        });
        this.desktopWindow.webContents.on('dom-ready', () => {
            this.logger.info('主窗口 DOM 已就绪');
        });
        this.desktopWindow.webContents.on('did-finish-load', () => {
            this.logger.info('主窗口页面加载完成');
        });
        this.desktopWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
            this.logger.error(`主窗口加载失败: ${errorDescription} (${errorCode}) ${validatedURL || ''}`.trim());
        });
        this.desktopWindow.webContents.on('render-process-gone', (_event, details) => {
            const reason = details?.reason || 'unknown';
            const exitCode = details?.exitCode !== undefined ? details.exitCode : 'unknown';
            this.logger.error(`渲染进程异常退出: ${reason}, exitCode=${exitCode}`);
        });
        this.desktopWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
            const prefix = `renderer-console[level=${level} line=${line} source=${path.basename(String(sourceId || ''))}]`;
            this.logger.info(`${prefix} ${message}`);
        });

        this.desktopWindow.loadFile(path.join(this.projectRoot, 'src/ui/index.html'));

        if (process.argv.includes('--dev') || process.argv.includes('--dev-mode') || this.devMode) {
            openDetachedDevTools(this.desktopWindow);
        }

        this.desktopWindow.webContents.once('did-finish-load', async () => {
            queueAutoConnectEmail(this);
        });

        this.desktopWindow.on('close', () => {
            this.closeCardEditorWindow?.();
        });

        this.desktopWindow.on('closed', () => {
            this.closeCardEditorWindow?.();
            this.desktopWindow = null;
            this.mainWindow = this.webControlConfig?.enabled ? this.headlessUiWindow : null;
            this.logger.mainWindow = this.mainWindow;
            if (this.browserManager && typeof this.browserManager.setMainWindow === 'function') {
                this.browserManager.setMainWindow(this.mainWindow);
            }
            this.cookieTester.setMainWindow(this.mainWindow);
        });
    },

    closeCardEditorWindow() {
        const cardEditorWindow = this.cardEditorWindow;
        if (!cardEditorWindow) {
            return false;
        }

        try {
            if (typeof cardEditorWindow.isDestroyed === 'function' && cardEditorWindow.isDestroyed()) {
                this.cardEditorWindow = null;
                this.cardEditorWindowPayload = null;
                return false;
            }

            if (typeof cardEditorWindow.close === 'function') {
                cardEditorWindow.close();
            }

            return true;
        } catch (error) {
            this.logger?.warn?.(`关闭卡片编辑器失败: ${error.message}`);
            try {
                if (typeof cardEditorWindow.destroy === 'function' && !cardEditorWindow.isDestroyed?.()) {
                    cardEditorWindow.destroy();
                }
            } catch (_destroyError) {
            }
            this.cardEditorWindow = null;
            this.cardEditorWindowPayload = null;
            return false;
        }
    },

    async createCardEditorWindow(options = {}) {
        const requestedCardData = options.cardData && typeof options.cardData === 'object' ? options.cardData : null;
        let resolvedCardData = requestedCardData;
        const cardMode = String(options.cardMode || 'automation').trim() || 'automation';
        const requestedApiCardName = String(
            options.apiCardName
            || options.relatedApiCardName
            || requestedCardData?.api_card_name
            || requestedCardData?.apiCardName
            || requestedCardData?.api_name
            || requestedCardData?.apiName
            || ''
        ).trim();
        const windowTitle = cardMode === 'test'
            ? '测试卡片编辑器'
            : cardMode === 'api'
                ? 'API卡片编辑器'
                : cardMode === 'haikaBind'
                    ? '海卡绑定卡片编辑器'
                    : '自动化卡片编辑器';

        try {
            const cardName = String(requestedCardData?.name || '').trim();
                if (cardName) {
                    if (cardMode === 'test' && typeof this.cardManager?.getTestCard === 'function') {
                    resolvedCardData = await this.cardManager.getTestCard(cardName, { forceReload: true }) || requestedCardData;
                } else if (cardMode === 'api' && typeof this.cardManager?.getApiCard === 'function') {
                    resolvedCardData = await this.cardManager.getApiCard(cardName, { forceReload: true }) || requestedCardData;
                } else if (cardMode === 'haikaBind' && typeof this.cardManager?.getHaikaBindCard === 'function') {
                    resolvedCardData = await this.cardManager.getHaikaBindCard(cardName, { forceReload: true }) || requestedCardData;
                } else if (typeof this.cardManager?.getCard === 'function') {
                    resolvedCardData = await this.cardManager.getCard(cardName, { forceReload: true }) || requestedCardData;
                }
            }
        } catch (error) {
            this.logger?.warn?.(`预加载卡片编辑数据失败: ${error.message}`);
        }

        const payload = {
            cardMode,
            cardData: resolvedCardData && typeof resolvedCardData === 'object' ? resolvedCardData : null,
            apiCardName: requestedApiCardName
        };

        this.cardEditorWindowPayload = payload;

        if (this.cardEditorWindow && !this.cardEditorWindow.isDestroyed()) {
            this.cardEditorWindow.show?.();
            if (typeof this.cardEditorWindow.isMaximized === 'function' && this.cardEditorWindow.isMaximized()) {
                this.cardEditorWindow.restore?.();
            }
            if (typeof this.cardEditorWindow.setSize === 'function') {
                this.cardEditorWindow.setSize(720, 900);
            }
            this.cardEditorWindow.setTitle?.(windowTitle);
            this.cardEditorWindow.focus?.();
            this.cardEditorWindow.webContents.send('card-editor-open', payload);
            return {
                success: true,
                reused: true,
                windowId: this.cardEditorWindow.id,
                ...payload
            };
        }

        this.cardEditorWindow = new BrowserWindow({
            width: 720,
            height: 900,
            minWidth: 640,
            minHeight: 800,
            show: true,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true
            },
            icon: path.join(this.projectRoot, 'src/ui/assets/icon.ico'),
            title: windowTitle
        });

        this.cardEditorWindow.loadFile(path.join(this.projectRoot, 'src/ui/index.html'), {
            query: {
                view: 'card-editor'
            }
        });

        if (process.argv.includes('--dev') || process.argv.includes('--dev-mode') || this.devMode) {
            openDetachedDevTools(this.cardEditorWindow);
        }

        this.cardEditorWindow.webContents.once('did-finish-load', () => {
            if (this.cardEditorWindow && !this.cardEditorWindow.isDestroyed()) {
                this.cardEditorWindow.webContents.send('card-editor-open', payload);
            }
        });

        this.cardEditorWindow.on('closed', () => {
            this.cardEditorWindow = null;
            this.cardEditorWindowPayload = null;
        });

        return {
            success: true,
            reused: false,
            windowId: this.cardEditorWindow.id,
            ...payload
        };
    },

    bindEmailClientUiEvents() {
        if (this.emailUiEventsBound) {
            return;
        }

        this.emailUiEventsBound = true;

        try {
            this.emailClient.on('code_received', (email, code) => {
                this.emitUiEvent('email-code', { email, code });
            });

            this.emailClient.on('error', (msg) => {
                this.emitUiEvent('email-log', { level: 'error', message: String(msg) });
            });

            this.emailClient.on('connected', () => {
                this.emitUiEvent('email-connected', { host: this.emailClient.serverHost, port: this.emailClient.serverPort });
            });

            this.emailClient.on('disconnected', () => {
                this.emitUiEvent('email-disconnected');
            });

            this.emailClient.on('reconnect', (info) => {
                const msRemaining = info && info.nextRetryAt ? Math.max(0, info.nextRetryAt - Date.now()) : null;
                this.emitUiEvent('email-reconnect', { attempt: info.attempt, nextRetryAt: info.nextRetryAt, msRemaining });
                this.emitUiEvent('email-log', { level: 'info', message: `邮箱将在 ${msRemaining !== null ? Math.round(msRemaining / 1000) + 's' : '未知'} 后尝试重连（第 ${info.attempt} 次）` });
            });

            this.emailClient.on('raw-message', (message) => {
                this.emitUiEvent('email-raw-message', message);
            });
        } catch (e) {
        }
    },

    async migrateCookieFormats() {
        if (this.cookieMigrationDone) {
            return;
        }

        try {
            await this.cookieManager.migrateCookieFormats();
            this.cookieMigrationDone = true;
        } catch (error) {
            this.logger.error(`Cookie格式迁移失败: ${error.message}`);
        }
    },

    setupMenu() {
        const template = [
            {
                label: '文件',
                submenu: [
                    {
                        label: '退出',
                        accelerator: 'CmdOrCtrl+Q',
                        click: () => {
                            this.cleanupAndExit();
                        }
                    }
                ]
            },
            {
                label: '查看',
                submenu: [
                    { role: 'reload' },
                    { role: 'forceReload' },
                    { role: 'resetZoom' },
                    { role: 'zoomIn' },
                    { role: 'zoomOut' },
                    { type: 'separator' },
                    { role: 'togglefullscreen' }
                ]
            },
            {
                label: '帮助',
                submenu: [
                    {
                        label: '关于',
                        click: () => {
                            const aboutMessage = 'AI 自动化工具 2.0\nAI平台自动化执行工具\n版本: 2.0.0\n基于 Electron 构建';
                            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                this.mainWindow.webContents.send('app-toast', {
                                    message: aboutMessage,
                                    type: 'info'
                                });
                            } else {
                                this.logger.info(aboutMessage);
                            }
                        }
                    }
                ]
            }
        ];

        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
    },

};

