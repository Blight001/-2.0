const path = require('path');
const os = require('os');
const fs = require('fs');
const {
    chromium,
    resolveBuiltinExtensionPath,
    resolveBuiltinWatermarkExtensionPath,
    resolveBuiltinCookieCaptureExtensionPath,
    normalizeBrowserSourceValue,
    resolveBrowserDownloadsPath,
    buildSandboxLaunchArgs
} = require('./browser-manager-helpers');
const { launchBuiltinElectronBrowser } = require('./electron-browser');
const { findBrowserByName } = require('./browser_detector');

module.exports = {
    async createBrowser(browserType = 'chromium', headless = false, browserOptions = {}) {
        const normalizedBrowserType = String(browserType || 'chromium').trim().toLowerCase();
        const browserSource = normalizeBrowserSourceValue(browserOptions.browserSource, browserOptions.browser_source);
        const effectiveHeadless = browserOptions.headless !== undefined ? !!browserOptions.headless : !!headless;
        const browserId = String(browserOptions.browserId || browserOptions.browser_id || '').trim() || `browser-${Date.now()}`;
        const browserDownloadsPath = resolveBrowserDownloadsPath(browserOptions);
        const browserSettings = browserOptions.browserSettings && typeof browserOptions.browserSettings === 'object'
            ? browserOptions.browserSettings
            : browserOptions;
        const captchaCompatibilityModeEnabled = this._isCaptchaCompatibilityModeEnabled(browserSettings);
        const watermarkExtensionPath = this._isWatermarkExtensionEnabled(browserSettings)
            ? resolveBuiltinWatermarkExtensionPath()
            : '';
        const cookieCaptureExtensionPath = this._isCookieCaptureExtensionEnabled(browserSettings) && !captchaCompatibilityModeEnabled
            ? resolveBuiltinCookieCaptureExtensionPath()
            : '';
        const extensionPaths = captchaCompatibilityModeEnabled
            ? []
            : [watermarkExtensionPath, cookieCaptureExtensionPath].filter(Boolean);
        const shouldLoadExtensionsInPersistentContext = Boolean(browserOptions.loadExtensionsInPersistentContext)
            && extensionPaths.length > 0
            && !captchaCompatibilityModeEnabled;
        const builtInElectronBrowserVersion = normalizedBrowserType === 'electron' && process?.versions?.chrome
            ? `Chrome/${process.versions.chrome}`
            : '';
        const browserVersionHint = String(browserOptions.browserVersion || builtInElectronBrowserVersion || '').trim();
        const browserProfile = this._buildBrowserProfile(normalizedBrowserType, browserVersionHint, browserSettings);
        const webRtcLaunchArgs = [
            '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
            '--enforce-webrtc-ip-permission-check',
            '--enable-features=WebRtcHideLocalIpsWithMdns'
        ];

        try {
            let browser = null;
            let context = null;
            let page = null;
            let browserVersion = browserVersionHint;
            let persistentUserDataDir = '';
            let cleanupPersistentUserDataDir = false;
            let browserKind = shouldLoadExtensionsInPersistentContext ? 'playwright-persistent' : 'playwright';

            if (captchaCompatibilityModeEnabled) {
                this.logger.info('验证码兼容模式已启用：禁用内置扩展和图片/视频请求拦截，仍需按站点要求人工完成验证码');
            }

            if (normalizedBrowserType === 'electron') {
                const electronLaunchResult = await launchBuiltinElectronBrowser({
                    browserId,
                    browserProfile,
                    browserSettings,
                    browserOptions,
                    logger: this.logger,
                    headless: effectiveHeadless,
                    visible: browserOptions.visible,
                    offscreen: browserOptions.offscreen,
                    launchTimeout: browserOptions.launchTimeout
                });

                browser = electronLaunchResult.electronApp || null;
                context = electronLaunchResult.context || null;
                page = electronLaunchResult.page || null;
                browserVersion = electronLaunchResult.browserVersion || browserVersion;
                persistentUserDataDir = electronLaunchResult.userDataDir || String(browserOptions.userDataDir || '').trim();
                browserKind = 'electron';
            } else {
                let browserLauncher = chromium;
                let executablePath = null;

                switch (normalizedBrowserType) {
                    case 'system':
                    case 'edge':
                        executablePath = await findBrowserByName('edge');
                        if (!executablePath) {
                            throw new Error('未找到系统 Edge 浏览器，请确保 Edge 已正确安装，或选择其他浏览器类型');
                        }
                        break;
                    case 'chrome':
                        executablePath = await findBrowserByName('chrome');
                        if (!executablePath) {
                            throw new Error('未找到系统 Chrome 浏览器，请确保 Chrome 已正确安装，或选择其他浏览器类型');
                        }
                        break;
                    default:
                        break;
                }

                const launchOptions = {
                    headless: effectiveHeadless,
                    downloadsPath: browserDownloadsPath,
                    args: [
                        ...buildSandboxLaunchArgs(),
                        '--disable-dev-shm-usage',
                        '--no-first-run',
                        '--no-default-browser-check',
                        '--password-store=basic',
                        '--force-color-profile=srgb',
                        `--window-size=${browserProfile.viewport.width},${browserProfile.viewport.height}`
                    ]
                };

                if (effectiveHeadless) {
                    launchOptions.args.push('--disable-gpu');
                }

                if (executablePath) {
                    launchOptions.executablePath = executablePath;
                }

                if (browserOptions.proxy) {
                    launchOptions.proxy = browserOptions.proxy;
                }

                if (browserOptions.env) {
                    launchOptions.env = browserOptions.env;
                }

                if (browserOptions.channel) {
                    launchOptions.channel = browserOptions.channel;
                }

                launchOptions.args.push(...webRtcLaunchArgs);

                if (shouldLoadExtensionsInPersistentContext) {
                    persistentUserDataDir = String(browserOptions.userDataDir || '').trim();
                    if (!persistentUserDataDir) {
                        persistentUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-register-browser-'));
                        cleanupPersistentUserDataDir = true;
                    }

                    const persistentLaunchOptions = {
                        ...launchOptions,
                        acceptDownloads: true,
                        args: [
                            ...(Array.isArray(launchOptions.args) ? launchOptions.args : []),
                            `--disable-extensions-except=${extensionPaths.join(',')}`,
                            `--load-extension=${extensionPaths.join(',')}`
                        ]
                    };

                    context = await browserLauncher.launchPersistentContext(persistentUserDataDir, persistentLaunchOptions);
                    browser = typeof context.browser === 'function' ? context.browser() : null;
                    if (!browser) {
                        browser = {
                            isConnected: () => !context.isClosed(),
                            close: async () => context.close()
                        };
                    }
                } else {
                    if (executablePath) {
                        launchOptions.executablePath = executablePath;
                    }
                    browser = await browserLauncher.launch(launchOptions);
                    context = await browser.newContext({
                        acceptDownloads: true,
                        viewport: browserProfile.viewport,
                        screen: browserProfile.screen,
                        isMobile: false,
                        hasTouch: false
                    });
                }

                page = typeof context.pages === 'function' && context.pages().length > 0
                    ? context.pages()[0]
                    : await context.newPage();
            }

            try {
                const diagnostics = page && typeof page.evaluate === 'function'
                    ? await page.evaluate(() => ({
                        userAgent: String(navigator.userAgent || ''),
                        webdriver: navigator.webdriver === true,
                        platform: String(navigator.platform || '')
                    })).catch(() => null)
                    : null;
                if (diagnostics) {
                    this.logger.info(
                        `浏览器环境诊断: type=${normalizedBrowserType}, source=${browserSource}, ` +
                        `webdriver=${diagnostics.webdriver ? 'true' : 'false'}, platform=${diagnostics.platform || 'unknown'}, ` +
                        `ua=${diagnostics.userAgent || 'unknown'}`
                    );
                }
            } catch (_diagnosticsError) {
            }

            let resolvedBrowserVersion = String(browserVersion || browserOptions.browserVersion || '').trim();
            if (!resolvedBrowserVersion && browser && typeof browser.version === 'function') {
                try {
                    resolvedBrowserVersion = String(await browser.version() || '').trim();
                } catch (_error) {
                }
            }
            if (resolvedBrowserVersion) {
                browserVersion = resolvedBrowserVersion;
                this._applyBrowserVersionToProfile(browserProfile, resolvedBrowserVersion);
            }

            const imageVideoBlockingApplied = await this._applyImageVideoRequestBlocking(context, browserSettings);

            if (this.webControlUrl) {
                try {
                    await context.addInitScript({ content: `window.__WEB_CONTROL_URL__ = ${JSON.stringify(this.webControlUrl)};` });
                } catch (_error) {
                }
            }
            try {
                await context.addInitScript({ content: `window.__BROWSER_SOURCE__ = ${JSON.stringify(browserSource)};` });
                await context.addInitScript({ content: `window.__BROWSER_ID__ = ${JSON.stringify(browserId)};` });
            } catch (_error) {
            }

            this.browsers.set(browserId, {
                browser,
                context,
                page,
                type: normalizedBrowserType,
                browserSource,
                kind: browserKind,
                hidden: false,
                createdAt: Date.now(),
                profile: browserProfile,
                browserVersion,
                requestBlocking: { imagesAndVideos: imageVideoBlockingApplied },
                cleanup: cleanupPersistentUserDataDir
                    ? async () => {
                        try {
                            await fs.promises.rm(persistentUserDataDir, { recursive: true, force: true });
                        } catch (_error) {
                        }
                    }
                    : null,
                userDataDir: persistentUserDataDir || browserOptions.userDataDir || ''
            });

            this.logger.info(`浏览器实例创建成功: ${browserId}`);
            return browserId;
        } catch (error) {
            this.logger.error(`创建浏览器失败: ${error.message}`);
            throw error;
        }
    },

    async closeBrowser(browserId, options = {}) {
        const { silent = false } = options;
        let browserData = null;

        try {
            if (!browserId) {
                return false;
            }

            if (this.closingBrowsers.has(browserId)) {
                if (!silent) {
                    this.logger.debug(`浏览器已在关闭中，跳过重复关闭: ${browserId}`);
                }
                return false;
            }

            browserData = this.browsers.get(browserId);
            if (!browserData) {
                if (!silent) {
                    this.logger.debug(`浏览器已不存在，跳过关闭: ${browserId}`);
                }
                this.browsers.delete(browserId);
                return false;
            }

            this.closingBrowsers.add(browserId);

            if (browserData.page && !browserData.page.isClosed()) {
                await browserData.page.close().catch(() => {});
            }
            if (browserData.context) {
                await browserData.context.close().catch(() => {});
            }
            if (browserData.browser && browserData.browser.isConnected()) {
                await browserData.browser.close().catch(() => {});
            }
            if (browserData.cleanup && typeof browserData.cleanup === 'function') {
                await browserData.cleanup().catch(() => {});
            }

            this.browsers.delete(browserId);
            this._emitBrowserLifecycle({
                browserId,
                reason: 'close',
                kind: browserData?.kind || 'unknown'
            });
            this.logger.info(`浏览器实例关闭成功: ${browserId}`);
            return true;
        } catch (error) {
            this.logger.error(`关闭浏览器失败: ${error.message}`);
            if (browserData?.cleanup && typeof browserData.cleanup === 'function') {
                await browserData.cleanup().catch(() => {});
            }
            this.browsers.delete(browserId);
            return false;
        } finally {
            if (browserId) {
                this.closingBrowsers.delete(browserId);
            }
        }
    },

    async closeAll(options = {}) {
        const {
            skipSystemCleanup = false,
            silentIfEmpty = true
        } = options;

        if (this.cleanupInProgress) {
            this.logger.debug('浏览器批量清理已在进行中，跳过重复调用');
            return { closedCount: 0, skipped: true };
        }

        this.cleanupInProgress = true;

        try {
            const browserIds = Array.from(this.browsers.keys());
            if (browserIds.length === 0) {
                if (!silentIfEmpty) {
                    this.logger.info('没有管理的浏览器实例，跳过系统级清理');
                }
                return { closedCount: 0, skipped: true };
            }

            const closePromises = browserIds.map(id => this.closeBrowser(id, { silent: true }));
            await Promise.allSettled(closePromises);
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (this.enableSystemCleanup && !skipSystemCleanup) {
                await this._killBrowserProcesses();
            }

            return { closedCount: browserIds.length, skipped: false };
        } finally {
            this.cleanupInProgress = false;
        }
    },

    getBrowserCount() {
        return this.browsers.size;
    },

    async checkBrowserProcesses() {
        try {
            const { exec } = require('child_process');
            const util = require('util');
            const execAsync = util.promisify(exec);
            const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq chrome.exe" /NH');
            const chromeProcesses = stdout.split('\n').filter(line => line.trim().length > 0);
            const { stdout: edgeStdout } = await execAsync('tasklist /FI "IMAGENAME eq msedge.exe" /NH');
            const edgeProcesses = edgeStdout.split('\n').filter(line => line.trim().length > 0);
            return chromeProcesses.length > 0 || edgeProcesses.length > 0;
        } catch (_error) {
            return false;
        }
    },

    async _killBrowserProcesses(force = false) {
        try {
            const { exec } = require('child_process');
            const util = require('util');
            const execAsync = util.promisify(exec);
            const processes = ['chrome.exe', 'msedge.exe'];
            for (const processName of processes) {
                try {
                    if (force) {
                        await execAsync(`taskkill /F /IM ${processName} /T`);
                    } else {
                        await execAsync(`taskkill /IM ${processName} /T`);
                    }
                } catch (_error) {
                }
            }
        } catch (_error) {
        }
    }
};
