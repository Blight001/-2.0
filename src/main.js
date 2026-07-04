const { app, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const packageJson = require('../package.json');

if (typeof console.warning !== 'function') {
    console.warning = console.warn.bind(console);
}

// 导入管理器类
const BrowserManager = require('./core/browser/browser-manager');
const CardManager = require('./core/card/card-manager');
const CookieManager = require('./core/cookie/cookie-manager');
const Logger = require('./core/infra/logger');
const EmailClient = require('./core/email/email-client');
const { DEFAULT_EMAIL_SUFFIX } = require('./core/email/email-defaults');
const CookieTester = require('./core/cookie/cookie-tester');
const ClashManager = require('./core/clash/clash-manager');
const LicenseManager = require('./core/infra/license-manager');
const registerIpcHandlers = require('./core/ipc');
const RpcHandlerRegistry = require('./core/infra/rpc-handler-registry');
const UiChannelManager = require('./core/infra/ui-channel-manager');
const WebControlServer = require('./core/web/web-control-server');
const {
    stripBrowserSettingsCompatFields,
    stripRuntimeConfigCompatFields,
    stripEmailConfigCompatFields
} = require('./core/infra/config-utils');
const { resolveWebControlConfig } = require('./core/web/web-control-config');
const {
    getRegistrationTcpRuntimeInfo,
    refreshRegistrationTcpConnection,
    startRegistrationTcpConnectionMonitor,
    stopRegistrationTcpConnectionMonitor,
    notifyRegistrationTcpSuccess,
    applyRegistrationTcpUserConfig,
    normalizeRegistrationTcpEndpoint: normalizeRegistrationTcpEndpointValue
} = require('./core/registration/tcp-control');
const { buildRegistrationUiState } = require('./core/registration/registration-ui-state');
const mainRuntime = require('./core/runtime/main-runtime');
const appBootstrap = require('./core/app/bootstrap');
const {
    DEFAULT_EMAIL_RANDOM_CONFIG,
    buildHardwareInfoFallback,
    buildTcpConfigSnapshot,
    extractEmailRandomConfig,
    hasRegistrationTcpConfig,
    normalizeBrowserSource,
    normalizeRegistrationMode,
    resolveStartupMode
} = require('./main/main-utils');

class AutoRegisterApp {
    constructor() {
        this.app = app;
        this.projectRoot = path.resolve(__dirname, '..');
        this.execAsync = execAsync;
        this.uiChannelManager = new UiChannelManager();
        this.headlessUiWindow = this.uiChannelManager.createHeadlessWindowProxy();
        this.mainWindow = this.headlessUiWindow;
        this.desktopWindow = null;
        this.loginWindow = null;
        this.isValidated = false;
        this.devMode = typeof appBootstrap.isDevModeEnabled === 'function' ? appBootstrap.isDevModeEnabled() : false;
        this.startupMode = resolveStartupMode(process.argv, process.env, packageJson);
        this.webControlConfig = resolveWebControlConfig();
        this.rpcRegistry = new RpcHandlerRegistry();
        this.webControlServer = new WebControlServer({
            app: this,
            projectRoot: this.projectRoot,
            logger: console,
            rpcRegistry: this.rpcRegistry,
            uiChannelManager: this.uiChannelManager,
            host: this.webControlConfig.host,
            port: this.webControlConfig.port,
            registrationMode: this.webControlConfig.registrationMode,
            hostApp: this.webControlConfig.hostApp
        });
        this.ipcHandlersRegistered = false;
        this.loginIpcHandlersRegistered = false;
        this.rpcHandlersRegistered = false;
        this.webLoginRpcHandlersRegistered = false;
        this.emailUiEventsBound = false;
        this.webControlPageOpened = false;
        this.mainUiStartupPromise = null;
        this.startupUserConfigApplied = false;
        this.browserManager = new BrowserManager();
        if (typeof this.browserManager.setWebControlUrl === 'function') {
            this.browserManager.setWebControlUrl(this.webControlServer?.getUrl?.() || '');
        }
        if (typeof this.browserManager.setWebControlServerStarter === 'function') {
            this.browserManager.setWebControlServerStarter(async () => {
                const startResult = await this.startWebControlServer();
                const resolvedUrl = String(
                    startResult?.url
                    || this.webControlServer?.getUrl?.()
                    || ''
                ).trim();
                if (resolvedUrl && typeof this.browserManager.setWebControlUrl === 'function') {
                    this.browserManager.setWebControlUrl(resolvedUrl);
                }
                return startResult;
            });
        }
        this.cardManager = new CardManager();
        this.cookieManager = new CookieManager({
            persistToDesktop: true
        });
        this.logger = new Logger({ mainWindow: this.mainWindow });
        if (this.webControlServer) {
            this.webControlServer.logger = this.logger;
        }
        this.emailClient = new EmailClient();
        this.emailAddressSuffix = DEFAULT_EMAIL_SUFFIX;
        this.emailRandomConfig = { ...DEFAULT_EMAIL_RANDOM_CONFIG };
        this.clashManager = new ClashManager(); // Clash Verge Rev 管理器
        this.licenseManager = new LicenseManager(); // 卡密验证管理器
        this.currentCardKey = '';
        this.currentCardKeyPrefix = '';
        this.currentCardExpireAt = '';
        this.currentCardExpireAtTimestamp = 0;
        this.currentCardUsageSnapshot = null;
        this.currentCardValidationSnapshot = null;
        this.licenseUsageLocked = false;
        this.licenseExpiryTimer = null;
        this.registrationTcpEndpoint = null;
        this.registrationTcpConfigured = false;
        this.registrationTcpConfigSource = null;
        this.registrationTcpReconnectEnabled = true;
        this.registrationTcpConnectionStatus = null;
        this.registrationTcpConnectionMonitorTimer = null;
        this.registrationTcpConnectionMonitorActive = false;
        this.hardwareInfo = buildHardwareInfoFallback();
        this.hardwareInfoUpdatedAt = String(this.hardwareInfo.updated_at || '').trim();
        this.haikaManager = null;
        this.cookieTester = new CookieTester({
            browserManager: this.browserManager,
            cookieManager: this.cookieManager,
            cardManager: this.cardManager,
            logger: this.logger,
            clashManager: this.clashManager,
            mainWindow: this.mainWindow
        });
        this.registrationTcpControlState = {};
        this.runningTasks = new Map();
        this.currentCard = null;
        this.currentTestCard = null; // 当前选中的测试卡片
        this.currentHaikaBindCard = null; // 当前选中的海卡绑定卡片
        this.haikaBindingState = null;
        this.haikaStateStore = null;
        this.isLoopRunning = false;
        this.isTimedRunning = false;
        this.concurrentCount = 1;
        this.runMode = 0; // 0: 单次运行, 1: 循环运行
        this.currentBrowserType = 'electron'; // 默认使用内置 Electron 浏览器
        this.browserSettings = {};
        this.registrationDefaultExecutionPlan = null;
        this.registrationDefaultExecutionPlanUpdatedAt = '';
        this.cookieMigrationDone = false; // 防止重复迁移的标志
        this.lastRegistrationConfig = null;
        this.activeRegistrationCardConfig = null;
        this.activeRegistrationCardName = '';
        this.registrationStopRequested = false;
        this.timedRegistrationState = null;
        this.timedRegistrationSessionId = null;
        this.proxyRecoveryState = {
            active: false,
            attempts: 0
        };
        this.maxProxyRecoveryAttempts = 3;
        this.proxyRecoveryCooldownMs = 3000;

        this._bindRuntimeMethods();

        if (this.devMode) {
            this.logger.info('检测到开发模式开关：将直接进入主界面');
        }

        if (this.startupMode === 'tcp') {
            this.logger.info('检测到远程控制启动模式：保留本地完整功能，等待服务器下发控制状态');
        }

        if (this.webControlConfig.enabled) {
            this.logger.info(`检测到网页控制台模式: ${this.webControlConfig.headless ? '无头网页' : '桌面+网页'}，监听 ${this.webControlConfig.host}:${this.webControlConfig.port}`);
        }

        this.initApp();
    }

    async logDeviceIdOnStartup() {
        try {
            const deviceId = await this.licenseManager?.getDeviceId?.();
            this.deviceId = deviceId || '';
            if (deviceId) {
                this.logger.info(`设备号: ${deviceId}`);
            } else {
                this.logger.warning('设备号获取失败');
            }
        } catch (error) {
            this.logger.warning(`设备号获取失败: ${error.message}`);
        }
    }

    setupLoginIpcHandlers() { return appBootstrap.setupLoginIpcHandlers.call(this); }
    setupWebLoginRpcHandlers() { return appBootstrap.setupWebLoginRpcHandlers.call(this); }
    createLoginWindow() { return appBootstrap.createLoginWindow.call(this); }
    async showMainWindow() { return appBootstrap.showMainWindow.call(this); }
    async ensureHaikaManager() { return appBootstrap.ensureHaikaManager.call(this); }
    async ensureHaikaStateStore() { return appBootstrap.ensureHaikaStateStore.call(this); }
    async loadHaikaLatestState(options) { return appBootstrap.loadHaikaLatestState.call(this, options); }
    async saveHaikaLatestExchange(record) { return appBootstrap.saveHaikaLatestExchange.call(this, record); }
    async saveHaikaLatestSmsRecord(record) { return appBootstrap.saveHaikaLatestSmsRecord.call(this, record); }
    async getLatestHaikaSmsRecord(smsApiUrl) { return appBootstrap.getLatestHaikaSmsRecord.call(this, smsApiUrl); }
    async fetchHaikaSmsCode(smsApiUrl) { return appBootstrap.fetchHaikaSmsCode.call(this, smsApiUrl); }
    getConfigPath() { return appBootstrap.getConfigPath.call(this); }
    ensureConfigPathReady() { return appBootstrap.ensureConfigPathReady.call(this); }
    getRuntimeConfigPath() { return appBootstrap.getRuntimeConfigPath.call(this); }
    ensureRuntimeConfigPathReady() { return appBootstrap.ensureRuntimeConfigPathReady.call(this); }
    getEmailConfigPath() {
        const isDev = !(app && typeof app.isPackaged === 'boolean' ? app.isPackaged : false);
        const resourceEmailConfigPath = path.join('resource', 'email_config.json');
        const legacyConfigPath = path.join('resource', 'config.json');

        if (isDev) {
            return {
                installed: null,
                dev: path.join(process.cwd(), resourceEmailConfigPath),
                legacyInstalled: null,
                legacyDev: path.join(process.cwd(), legacyConfigPath),
                bundled: path.join(process.cwd(), resourceEmailConfigPath)
            };
        }

        return {
            installed: path.join(app.getPath('userData'), resourceEmailConfigPath),
            dev: null,
            legacyInstalled: path.join(app.getPath('userData'), legacyConfigPath),
            legacyDev: null,
            bundled: path.join(process.resourcesPath, resourceEmailConfigPath)
        };
    }
    async ensureEmailConfigPathReady() {
        const paths = this.getEmailConfigPath();
        const targetPath = paths.dev || paths.installed;
        const legacyPath = paths.legacyDev || paths.legacyInstalled;
        const bundledPath = paths.bundled;

        if (!targetPath) {
            return paths;
        }

        await fs.ensureDir(path.dirname(targetPath));

        if (!(await fs.pathExists(targetPath))) {
            if (legacyPath && await fs.pathExists(legacyPath)) {
                try {
                    const legacyConfig = await fs.readJson(legacyPath);
                    const emailConfig = this._extractEmailConfig(legacyConfig);
                    if (Object.keys(emailConfig).length > 0) {
                        await fs.writeJson(targetPath, emailConfig, { spaces: 4 });
                        this.logger?.info?.(`已迁移邮箱配置到独立文件: ${legacyPath} -> ${targetPath}`);
                        return paths;
                    }
                } catch (error) {
                    this.logger?.warning?.(`迁移邮箱配置失败: ${error.message}`);
                }
            }

            if (bundledPath && bundledPath !== targetPath && await fs.pathExists(bundledPath)) {
                try {
                    const bundledConfig = await fs.readJson(bundledPath);
                    const emailConfig = this._extractEmailConfig(bundledConfig);
                    await fs.writeJson(targetPath, emailConfig, { spaces: 4 });
                    this.logger?.info?.(`已初始化邮箱配置: ${bundledPath} -> ${targetPath}`);
                } catch (copyError) {
                    this.logger?.warning?.(`初始化邮箱配置失败: ${copyError.message}`);
                }
            }
        }

        return paths;
    }
    async readCookieUserConfigFromDisk() {
        try {
            const paths = await this.ensureConfigPathReady();
            const configPath = paths.installed || paths.dev;
            if (!configPath || !(await fs.pathExists(configPath))) {
                return {};
            }

            const config = await fs.readJson(configPath);
            const normalized = config && typeof config === 'object' ? { ...config } : {};
            delete normalized.email_host;
            delete normalized.email_port;
            delete normalized.emailHost;
            delete normalized.emailPort;
            return stripRuntimeConfigCompatFields(normalized);
        } catch (error) {
            this.logger?.warning?.(`读取运行配置文件失败: ${error.message}`);
            return {};
        }
    }
    _extractEmailConfig(config = {}) {
        const source = config && typeof config === 'object' ? config : {};
        const host = String(source.email_host || source.emailHost || '').trim();
        const port = Number.parseInt(source.email_port ?? source.emailPort, 10);
        const suffix = String(source.email_suffix || source.emailSuffix || DEFAULT_EMAIL_SUFFIX).trim() || DEFAULT_EMAIL_SUFFIX;
        const randomConfig = extractEmailRandomConfig(source);
        const emailConfig = {
            email_host: host || 'heysure.top',
            email_port: Number.isFinite(port) && port > 0 ? port : 8888,
            email_suffix: suffix,
            ...randomConfig
        };

        return stripEmailConfigCompatFields(emailConfig);
    }
    async readEmailConfigFromDisk() {
        try {
            const paths = await this.ensureEmailConfigPathReady();
            const preferredPath = paths.installed || paths.dev;
            const legacyPath = paths.legacyDev || paths.legacyInstalled;

            let config = {};
            if (preferredPath && await fs.pathExists(preferredPath)) {
                config = await fs.readJson(preferredPath);
            } else if (legacyPath && await fs.pathExists(legacyPath)) {
                const legacyConfig = await fs.readJson(legacyPath);
                config = this._extractEmailConfig(legacyConfig);
            }

            return this._extractEmailConfig(config);
        } catch (error) {
            this.logger?.warning?.(`读取邮箱配置失败: ${error.message}`);
            return this._extractEmailConfig({});
        }
    }
    async saveEmailConfigToDisk(config = {}) {
        try {
            const paths = await this.ensureEmailConfigPathReady();
            const targetPath = paths.installed || paths.dev;
            if (!targetPath) {
                return { success: false, error: '邮箱配置路径不可用' };
            }

            const emailConfig = this._extractEmailConfig(config);
            await fs.ensureDir(path.dirname(targetPath));
            await fs.writeJson(targetPath, emailConfig, { spaces: 4 });
            this.emailAddressSuffix = String(emailConfig.email_suffix || DEFAULT_EMAIL_SUFFIX).trim() || DEFAULT_EMAIL_SUFFIX;
            this.emailRandomConfig = {
                email: {
                    length: Number(emailConfig.email_random_length) || DEFAULT_EMAIL_RANDOM_CONFIG.email.length,
                    type: String(emailConfig.email_random_type || DEFAULT_EMAIL_RANDOM_CONFIG.email.type).trim() || DEFAULT_EMAIL_RANDOM_CONFIG.email.type
                }
            };
            return {
                success: true,
                config: emailConfig,
                configPath: targetPath
            };
        } catch (error) {
            this.logger?.warning?.(`保存邮箱配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
    getLicenseCachePath() { return appBootstrap.getLicenseCachePath.call(this); }
    getLicenseCacheCodec() { return appBootstrap.getLicenseCacheCodec.call(this); }
    async readSavedLicenseCache() { return appBootstrap.readSavedLicenseCache.call(this); }
    async readSavedCardKey() { return appBootstrap.readSavedCardKey.call(this); }
    async saveCardKeyToCache(cardKey, metadata = {}) { return appBootstrap.saveCardKeyToCache.call(this, cardKey, metadata); }
    async consumeSavedCardUsage(cardKey, usageCount = 1, metadata = {}) { return appBootstrap.consumeSavedCardUsage.call(this, cardKey, usageCount, metadata); }
    async isLicenseUsageExhausted(cardKey = this.currentCardKey || this.currentCardValidationSnapshot?.key || '') { return appBootstrap.isLicenseUsageExhausted.call(this, cardKey); }
    async scheduleLicenseExpiryReturn(expireAtValue, options = {}) { return appBootstrap.scheduleLicenseExpiryReturn.call(this, expireAtValue, options); }
    async returnToLoginFromLicenseExpiry(reason = 'timer') { return appBootstrap.returnToLoginFromLicenseExpiry.call(this, reason); }
    async clearSavedCardKey() { return appBootstrap.clearSavedCardKey.call(this); }
    async refreshHardwareInfo() {
        try {
            let gpuInfo = null;
            if (typeof app.getGPUInfo === 'function') {
                gpuInfo = await app.getGPUInfo('basic');
            }
            this.hardwareInfo = buildHardwareInfoFallback(gpuInfo);
            this.hardwareInfoUpdatedAt = String(this.hardwareInfo.updated_at || '').trim();
            return this.hardwareInfo;
        } catch (error) {
            this.hardwareInfo = buildHardwareInfoFallback();
            this.hardwareInfoUpdatedAt = String(this.hardwareInfo.updated_at || '').trim();
            this.logger?.warning?.(`刷新硬件信息失败: ${error.message}`);
            return this.hardwareInfo;
        }
    }
    isTcpManagedMode() {
        return false;
    }
    isRegistrationControlLocked() {
        return this.registrationTcpControlState && this.registrationTcpControlState.control_locked === true;
    }
    shouldAutoLoadLocalCards() {
        return true;
    }
    async getAppRuntimeInfo() {
        const runtimeConfig = typeof this.readRegistrationRuntimeConfigFromDisk === 'function'
            ? await this.readRegistrationRuntimeConfigFromDisk()
            : {};
        const runtimeBrowserSettings = runtimeConfig && typeof runtimeConfig === 'object'
            ? (runtimeConfig.browserSettings && typeof runtimeConfig.browserSettings === 'object'
                ? runtimeConfig.browserSettings
                : runtimeConfig.browser_settings && typeof runtimeConfig.browser_settings === 'object'
                    ? runtimeConfig.browser_settings
                    : {})
            : {};
        this.registrationRuntimeConfig = runtimeConfig && typeof runtimeConfig === 'object' ? { ...runtimeConfig } : {};
        this.registrationRuntimeBrowserSettings = runtimeBrowserSettings && typeof runtimeBrowserSettings === 'object'
            ? { ...runtimeBrowserSettings }
            : {};

        return {
            startupMode: this.startupMode,
            registrationMode: normalizeRegistrationMode(this.webControlConfig?.registrationMode, 'standalone'),
            registrationEmbedded: this.webControlConfig?.embedded === true,
            registrationHostApp: String(this.webControlConfig?.hostApp || '').trim(),
            browserSource: normalizeBrowserSource(
                this.browserSettings?.browser_source
                || this.browserSettings?.browserSource
                || this.browserSettings?.browser_type
                || this.browserSettings?.browserType
                || this.registrationRuntimeBrowserSettings?.browser_source
                || this.registrationRuntimeBrowserSettings?.browserSource
                || this.registrationRuntimeBrowserSettings?.browser_type
                || this.registrationRuntimeBrowserSettings?.browserType,
                'local-browser'
            ),
            tcpManagedMode: false,
            localCardAutoloadEnabled: this.shouldAutoLoadLocalCards(),
            webControlEnabled: this.webControlConfig?.enabled === true,
            webControlHeadless: this.webControlConfig?.headless === true,
            webControlEmbedded: this.webControlConfig?.embedded === true,
            webControlHostApp: String(this.webControlConfig?.hostApp || '').trim(),
            licenseUsageLocked: this.licenseUsageLocked === true,
            licenseUsageSnapshot: this.currentCardUsageSnapshot ? { ...this.currentCardUsageSnapshot } : null,
            hardwareInfo: this.hardwareInfo ? { ...this.hardwareInfo } : null,
            hardwareInfoUpdatedAt: String(this.hardwareInfoUpdatedAt || '').trim(),
            registrationRuntimeConfig: runtimeConfig,
            registration_runtime_config: runtimeConfig,
            registrationRuntimeBrowserSettings: runtimeBrowserSettings,
            registration_runtime_browser_settings: runtimeBrowserSettings,
            ...(await getRegistrationTcpRuntimeInfo(this))
        };
    }
    getRegistrationTcpEndpoint() {
        const sourceConfig = this.registrationTcpConfigSource && typeof this.registrationTcpConfigSource === 'object'
            ? this.registrationTcpConfigSource
            : null;

        if (this.registrationTcpConfigured !== true && !sourceConfig) {
            return null;
        }

        return this.registrationTcpEndpoint
            || normalizeRegistrationTcpEndpointValue(sourceConfig || {});
    }
    hasRegistrationTcpConfig(config = {}) {
        return hasRegistrationTcpConfig(config);
    }
    async applyUserConfig(config = {}, options = {}) {
        return await applyRegistrationTcpUserConfig(this, config, options);
    }
    async saveBrowserSettingsToConfig(browserSettings = {}, options = {}) {
        try {
            const normalizedSettings = browserSettings && typeof browserSettings === 'object'
                ? { ...browserSettings }
                : {};
            delete normalizedSettings.currentNode;
            delete normalizedSettings.current_node;
            delete normalizedSettings.clashCurrentNode;
            delete normalizedSettings.clash_current_node;
            normalizedSettings.browser_source = normalizeBrowserSource(
                normalizedSettings.browser_source || normalizedSettings.browserSource,
                'local-browser'
            );
            if (normalizedSettings.browser_source === 'local-browser') {
                const sourceFromBrowserType = normalizeBrowserSource(
                    normalizedSettings.browser_type || normalizedSettings.browserType,
                    'local-browser'
                );
                normalizedSettings.browser_source = 'local-browser';
            }
            normalizedSettings.browserSource = normalizedSettings.browser_source;

            const paths = await this.ensureConfigPathReady();
            const configPath = paths.dev || paths.installed;
            if (!configPath) {
                return { success: false, error: '配置路径不可用' };
            }

            let config = {};
            if (await fs.pathExists(configPath)) {
                try {
                    config = await fs.readJson(configPath);
                } catch (_) {
                    config = {};
                }
            }

            const existingBrowserSettings = config.browserSettings && typeof config.browserSettings === 'object'
                ? { ...config.browserSettings }
                : {};
            config.browserSettings = stripBrowserSettingsCompatFields({
                ...existingBrowserSettings,
                ...normalizedSettings
            });
            delete config.browser_settings;
            const cleanedConfig = stripRuntimeConfigCompatFields(config);

            await fs.ensureDir(path.dirname(configPath));
            await fs.writeJson(configPath, cleanedConfig, { spaces: 4 });

            const applyResult = await this.applyUserConfig(cleanedConfig, {
                source: options.source || 'saved-browser-settings',
                restartTcpBridge: false
            });

            return {
                success: true,
                config: cleanedConfig,
                applyResult
            };
        } catch (error) {
            this.logger?.error?.(`保存浏览器设置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
    normalizeRegistrationTcpEndpoint(input = {}) {
        return normalizeRegistrationTcpEndpointValue(input);
    }
    async refreshRegistrationTcpConnection(options = {}) {
        return await refreshRegistrationTcpConnection(this, options);
    }
    async startRegistrationTcpConnectionMonitor(options = {}) {
        return await startRegistrationTcpConnectionMonitor(this, options);
    }
    stopRegistrationTcpConnectionMonitor() {
        return stopRegistrationTcpConnectionMonitor(this);
    }
    async persistRegistrationTcpEndpoint() {
        return false;
    }
    applyConnectionConfig(config = {}, options = {}) {
        return {
            validateServerConfig: { ...(this.licenseManager?.validateServerConfig || {}) },
            registrationTcpEndpoint: this.getRegistrationTcpEndpoint()
        };
    }
    async loadAndApplyUserConfig() {
        const config = await this.readCookieUserConfigFromDisk();
        if (!config || Object.keys(config).length === 0) {
            return {};
        }

        const runtimeBrowserSettings = config.browserSettings && typeof config.browserSettings === 'object'
            ? { ...config.browserSettings }
            : {};
        this.registrationRuntimeConfig = { ...config };
        this.registrationRuntimeBrowserSettings = runtimeBrowserSettings;
        await this.applyUserConfig(config, {
            source: 'startup-config',
            restartTcpBridge: false
        });
        try {
            const tcpConfig = await this.readRegistrationTcpConfigFromDisk();
            if (tcpConfig && Object.keys(tcpConfig).length > 0) {
                await this.applyUserConfig(tcpConfig, {
                    source: 'startup-tcp-config',
                    restartTcpBridge: false
                });
            }
        } catch (tcpConfigError) {
            this.logger.warning(`加载TCP配置失败: ${tcpConfigError.message}`);
        }
        try {
            const emailConfig = await this.readEmailConfigFromDisk();
            const emailHost = String(emailConfig.email_host || '').trim();
            const emailPort = Number.parseInt(emailConfig.email_port, 10);
            const emailSuffix = String(emailConfig.email_suffix || emailConfig.emailSuffix || DEFAULT_EMAIL_SUFFIX).trim() || DEFAULT_EMAIL_SUFFIX;
            if (this.emailClient) {
                if (emailHost) {
                    this.emailClient.serverHost = emailHost;
                }
                if (Number.isFinite(emailPort) && emailPort > 0) {
                    this.emailClient.serverPort = emailPort;
                }
            }
            this.emailAddressSuffix = emailSuffix;
            this.emailRandomConfig = {
                email: {
                    length: Number(emailConfig.email_random_length) || DEFAULT_EMAIL_RANDOM_CONFIG.email.length,
                    type: String(emailConfig.email_random_type || DEFAULT_EMAIL_RANDOM_CONFIG.email.type).trim() || DEFAULT_EMAIL_RANDOM_CONFIG.email.type
                }
            };
        } catch (emailConfigError) {
            this.logger.warning(`加载邮箱配置失败: ${emailConfigError.message}`);
        }
        this.startupUserConfigApplied = true;
        this.logger.info(`已从配置加载邮箱服务器: ${this.emailClient.serverHost}:${this.emailClient.serverPort}`);
        this.logger.info(`已从配置加载邮箱后缀: ${this.emailAddressSuffix}`);
        const registrationTcpEndpoint = this.getRegistrationTcpEndpoint?.();
        if (registrationTcpEndpoint?.url) {
            this.logger.info(`已从配置加载TCP服务地址: ${registrationTcpEndpoint.url}`);
        }
        return config;
    }

    getRegistrationTcpConfigPath() {
        const isDev = !(app && typeof app.isPackaged === 'boolean' ? app.isPackaged : false);
        const resourceTcpConfigPath = path.join('resource', 'tcp_config.json');
        const legacyTcpConfigPath = path.join('resource', 'config.json');

        if (isDev) {
            return {
                installed: null,
                dev: path.join(process.cwd(), resourceTcpConfigPath),
                legacyInstalled: null,
                legacyDev: path.join(process.cwd(), legacyTcpConfigPath),
                bundled: path.join(process.cwd(), resourceTcpConfigPath)
            };
        }

        return {
            installed: path.join(app.getPath('userData'), resourceTcpConfigPath),
            dev: null,
            legacyInstalled: path.join(app.getPath('userData'), legacyTcpConfigPath),
            legacyDev: null,
            bundled: path.join(process.resourcesPath, resourceTcpConfigPath)
        };
    }
    async ensureRegistrationTcpConfigPathReady() {
        const paths = this.getRegistrationTcpConfigPath();
        const targetPath = paths.dev || paths.installed;
        const legacyPath = paths.legacyDev || paths.legacyInstalled;
        const bundledPath = paths.bundled;

        if (!targetPath) {
            return paths;
        }

        await fs.ensureDir(path.dirname(targetPath));

        const targetExists = await fs.pathExists(targetPath);
        let targetConfig = {};
        if (targetExists) {
            try {
                targetConfig = await fs.readJson(targetPath);
            } catch (_) {
                targetConfig = {};
            }
        }

        const targetHasTcpConfig = hasRegistrationTcpConfig(targetConfig);
        if (!targetHasTcpConfig && legacyPath && await fs.pathExists(legacyPath)) {
            try {
                const legacyConfig = await fs.readJson(legacyPath);
                const snapshot = buildTcpConfigSnapshot(legacyConfig);
                if (Object.keys(snapshot).length > 0) {
                    targetConfig = {
                        ...targetConfig,
                        ...snapshot
                    };
                    await fs.writeJson(targetPath, targetConfig, { spaces: 4 });
                    this.logger?.info?.(`已迁移TCP配置到统一配置文件: ${legacyPath} -> ${targetPath}`);
                }
            } catch (error) {
                this.logger?.warning?.(`迁移TCP配置失败: ${error.message}`);
            }
        }

        if (!targetExists && bundledPath && bundledPath !== targetPath && await fs.pathExists(bundledPath)) {
            try {
                const bundledConfig = await fs.readJson(bundledPath);
                const mergedConfig = {
                    ...(bundledConfig && typeof bundledConfig === 'object' ? bundledConfig : {}),
                    ...(targetConfig && typeof targetConfig === 'object' ? targetConfig : {})
                };
                await fs.writeJson(targetPath, mergedConfig, { spaces: 4 });
                this.logger?.info?.(`已初始化统一配置: ${bundledPath} -> ${targetPath}`);
            } catch (copyError) {
                this.logger?.warning?.(`初始化统一配置失败: ${copyError.message}`);
            }
        }

        return paths;
    }
    async readRegistrationTcpConfigFromDisk() {
        try {
            const paths = await this.ensureRegistrationTcpConfigPathReady();
            const targetPath = paths.installed || paths.dev;
            const legacyPath = paths.legacyDev || paths.legacyInstalled;

            let config = {};
            if (targetPath && await fs.pathExists(targetPath)) {
                try {
                    config = await fs.readJson(targetPath);
                } catch (_) {
                    config = {};
                }
            }

            if (!hasRegistrationTcpConfig(config) && legacyPath && await fs.pathExists(legacyPath)) {
                try {
                    const legacyConfig = await fs.readJson(legacyPath);
                    const snapshot = buildTcpConfigSnapshot(legacyConfig);
                    if (Object.keys(snapshot).length > 0) {
                        config = {
                            ...config,
                            ...snapshot
                        };
                        if (targetPath) {
                            await fs.writeJson(targetPath, config, { spaces: 4 });
                        }
                    }
                } catch (_) {}
            }

            const normalized = hasRegistrationTcpConfig(config) ? buildTcpConfigSnapshot(config) : {};
            this.registrationTcpConfigSource = Object.keys(normalized).length > 0 ? { ...normalized } : null;
            return normalized;
        } catch (error) {
            this.logger?.warning?.(`读取TCP配置文件失败: ${error.message}`);
            return {};
        }
    }
    async saveRegistrationTcpConfigToDisk(config = {}) {
        try {
            const paths = await this.ensureRegistrationTcpConfigPathReady();
            const targetPath = paths.installed || paths.dev;
            if (!targetPath) {
                return { success: false, error: 'TCP配置路径不可用' };
            }

            const snapshot = buildTcpConfigSnapshot(config);
            if (Object.keys(snapshot).length === 0) {
                return { success: false, error: 'TCP配置不能为空' };
            }

            await fs.ensureDir(path.dirname(targetPath));
            await fs.writeJson(targetPath, snapshot, { spaces: 4 });
            this.registrationTcpConfigSource = { ...snapshot };
            return {
                success: true,
                config: snapshot,
                configPath: targetPath
            };
        } catch (error) {
            this.logger?.warning?.(`保存TCP配置文件失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
    async readRegistrationRuntimeConfigFromDisk() { return appBootstrap.readRegistrationRuntimeConfigFromDisk.call(this); }
    async saveRegistrationRuntimeConfigToDisk(config) { return appBootstrap.saveRegistrationRuntimeConfigToDisk.call(this, config); }
    getCardKeyPrefix() {
        if (typeof this.currentCardKeyPrefix === 'string' && this.currentCardKeyPrefix) {
            return this.currentCardKeyPrefix;
        }

        if (typeof this.currentCardKey === 'string' && this.currentCardKey) {
            return this.currentCardKey.trim().slice(0, 4);
        }

        return '';
    }
    getEmailSuffix() {
        return String(this.emailAddressSuffix || DEFAULT_EMAIL_SUFFIX).trim() || DEFAULT_EMAIL_SUFFIX;
    }
    getEmailRandomConfig() {
        const source = this.emailRandomConfig && typeof this.emailRandomConfig === 'object'
            ? this.emailRandomConfig
            : DEFAULT_EMAIL_RANDOM_CONFIG;
        return {
            email: {
                length: Number(source.email?.length) || DEFAULT_EMAIL_RANDOM_CONFIG.email.length,
                type: String(source.email?.type || DEFAULT_EMAIL_RANDOM_CONFIG.email.type).trim() || DEFAULT_EMAIL_RANDOM_CONFIG.email.type
            }
        };
    }
    initApp() { return appBootstrap.initApp.call(this); }
    createWindow() { return appBootstrap.createWindow.call(this); }
    createCardEditorWindow(options = {}) { return appBootstrap.createCardEditorWindow.call(this, options); }
    bindEmailClientUiEvents() { return appBootstrap.bindEmailClientUiEvents.call(this); }
    async migrateCookieFormats() { return appBootstrap.migrateCookieFormats.call(this); }
    setupMenu() { return appBootstrap.setupMenu.call(this); }

    _bindRuntimeMethods() {
        for (const [name, fn] of Object.entries(mainRuntime)) {
            if (typeof fn !== 'function') {
                continue;
            }

            if (typeof this[name] === 'function') {
                continue;
            }

            this[name] = (...args) => fn.call(this, ...args);
        }
    }


    setupIpcHandlers() {
        if (this.ipcHandlersRegistered) {
            return;
        }

        registerIpcHandlers({
            app: this,
            ipcMain,
            dialog,
            fs,
            path,
            os,
            http,
            https,
            shell: require('electron').shell,
            execAsync
        });
        this.ipcHandlersRegistered = true;
    }

    setupRpcHandlers() {
        if (this.rpcHandlersRegistered) {
            return;
        }

        registerIpcHandlers({
            app: this,
            ipcMain: this.rpcRegistry,
            dialog,
            fs,
            path,
            os,
            http,
            https,
            shell: require('electron').shell,
            execAsync
        });
        this.rpcHandlersRegistered = true;
    }

    async startWebControlServer() {
        if (!this.webControlServer) {
            return null;
        }

        const result = await this.webControlServer.start();
        const resolvedUrl = String(result?.url || this.webControlServer?.getUrl?.() || '').trim();
        if (resolvedUrl && this.browserManager && typeof this.browserManager.setWebControlUrl === 'function') {
            this.browserManager.setWebControlUrl(resolvedUrl);
        }
        return result;
    }

    async startRegistrationTcpBridge() {
        try {
            await this.startRegistrationTcpConnectionMonitor({ immediate: true });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async restartRegistrationTcpBridge() {
        return await this.startRegistrationTcpBridge();
    }

    async stopRegistrationTcpBridge() {
        this.stopRegistrationTcpConnectionMonitor();
        return { success: true };
    }

    async notifyRegistrationTcpSuccess(payload = {}) {
        return await notifyRegistrationTcpSuccess(this, payload);
    }

    async registrationControlSnapshot() {
        return null;
    }

    async registrationControlPatch(patch = {}) {
        return { ok: false, error: '注册控制桥接已移除' };
    }

    async getRegistrationUiState(options = {}) {
        return await buildRegistrationUiState(this, options);
    }

    getDialogParentWindow() {
        if (this.desktopWindow && typeof this.desktopWindow.isDestroyed === 'function' && !this.desktopWindow.isDestroyed()) {
            return this.desktopWindow;
        }

        return undefined;
    }

    emitUiEvent(channel, ...args) {
        const targets = [
            this.mainWindow && this.mainWindow.webContents && typeof this.mainWindow.webContents.send === 'function'
                ? this.mainWindow
                : null,
            this.cardEditorWindow && this.cardEditorWindow.webContents && typeof this.cardEditorWindow.webContents.send === 'function'
                ? this.cardEditorWindow
                : null
        ].filter((window, index, self) => window && self.indexOf(window) === index);

        if (targets.length > 0) {
            for (const targetWindow of targets) {
                try {
                    targetWindow.webContents.send(channel, ...args);
                } catch (_error) {
                }
            }
        }

        if (this.uiChannelManager && typeof this.uiChannelManager.publish === 'function') {
            this.uiChannelManager.publish(channel, ...args);
        }
    }

    async loadCards() { return mainRuntime.loadCards.call(this); }
    async startRegistration(config) { return mainRuntime.startRegistration.call(this, config); }
    async startSingleRegistrationTask(...args) { return mainRuntime.startSingleRegistrationTask.call(this, ...args); }
    _getRegistrationModeLabel(...args) { return mainRuntime._getRegistrationModeLabel.call(this, ...args); }
    _clearTimedRegistrationTimers(...args) { return mainRuntime._clearTimedRegistrationTimers.call(this, ...args); }
    _isTimedRegistrationSessionActive(...args) { return mainRuntime._isTimedRegistrationSessionActive.call(this, ...args); }
    _emitRegistrationCycleStatus(...args) { return mainRuntime._emitRegistrationCycleStatus.call(this, ...args); }
    _createTimedRegistrationState(...args) { return mainRuntime._createTimedRegistrationState.call(this, ...args); }
    _finalizeTimedRegistrationSession(...args) { return mainRuntime._finalizeTimedRegistrationSession.call(this, ...args); }
    _launchTimedRegistrationTask(...args) { return mainRuntime._launchTimedRegistrationTask.call(this, ...args); }
    _scheduleTimedRegistrationContinuation(...args) { return mainRuntime._scheduleTimedRegistrationContinuation.call(this, ...args); }
    async startCardDebugTask(config) { return mainRuntime.startCardDebugTask.call(this, config); }
    async startHaikaBindingTask(config) { return mainRuntime.startHaikaBindingTask.call(this, config); }
    async stopHaikaBinding() { return mainRuntime.stopHaikaBinding.call(this); }
    filterHaikaBindingAccounts(allCookies, accountFolder, accountFilter) { return mainRuntime.filterHaikaBindingAccounts.call(this, allCookies, accountFolder, accountFilter); }
    normalizeHaikaBindingAccount(accountInfo) { return mainRuntime.normalizeHaikaBindingAccount.call(this, accountInfo); }
    normalizeHaikaExpiryDate(expiryDate) { return mainRuntime.normalizeHaikaExpiryDate.call(this, expiryDate); }
    extractHaikaBindingResponse(result) { return mainRuntime.extractHaikaBindingResponse.call(this, result); }
    async exchangeNextHaikaBindingCard(currentContext, options) { return mainRuntime.exchangeNextHaikaBindingCard.call(this, currentContext, options); }
    buildHaikaBindingContext(bindingContent, accountInfo, smsCode) { return mainRuntime.buildHaikaBindingContext.call(this, bindingContent, accountInfo, smsCode); }
    async startNextHaikaBindingTask() { return mainRuntime.startNextHaikaBindingTask.call(this); }
    async finishHaikaBindingBatch() { return mainRuntime.finishHaikaBindingBatch.call(this); }
    emitHaikaBindingProgress() { return mainRuntime.emitHaikaBindingProgress.call(this); }
    getErrorText(error) { return mainRuntime.getErrorText.call(this, error); }
    isProxyRelatedError(error) { return mainRuntime.isProxyRelatedError.call(this, error); }
    async stopRunningTasksForRecovery() { return mainRuntime.stopRunningTasksForRecovery.call(this); }
    async getNextProxyNodeForRecovery() { return mainRuntime.getNextProxyNodeForRecovery.call(this); }
    async recoverFromProxyError(taskId, error) { return mainRuntime.recoverFromProxyError.call(this, taskId, error); }
    async onRegistrationFinished(taskId, result) { return mainRuntime.onRegistrationFinished.call(this, taskId, result); }
    onRegistrationError(taskId, error) { return mainRuntime.onRegistrationError.call(this, taskId, error); }
    async onHaikaBindingFinished(taskId, result, accountInfo) { return mainRuntime.onHaikaBindingFinished.call(this, taskId, result, accountInfo); }
    onHaikaBindingError(taskId, error, accountInfo) { return mainRuntime.onHaikaBindingError.call(this, taskId, error, accountInfo); }
    async stopRegistration(...args) { return mainRuntime.stopRegistration.call(this, ...args); }
    async updateStats() { return mainRuntime.updateStats.call(this); }
    async cleanupAndExit() { return mainRuntime.cleanupAndExit.call(this); }
}

// 创建应用程序实例
const appInstance = new AutoRegisterApp();
