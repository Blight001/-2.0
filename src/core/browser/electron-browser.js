const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { buildBuiltinBrowserToolbarInitScript: buildToolbarScriptFromFile } = require('./builtin-browser-toolbar-script');

function loadPlaywrightElectron() {
    const candidates = [
        'playwright',
        process.resourcesPath ? path.join(process.resourcesPath, 'node_modules', 'playwright') : null,
        'playwright-core',
        process.resourcesPath ? path.join(process.resourcesPath, 'node_modules', 'playwright-core') : null
    ].filter(Boolean);

    const errors = [];

    for (const candidate of candidates) {
        try {
            const mod = require(candidate);
            if (mod && mod._electron) {
                return mod._electron;
            }
        } catch (error) {
            errors.push(`${candidate}: ${error.message}`);
        }
    }

    throw new Error(`无法加载 Playwright Electron: ${errors.join(' | ')}`);
}

function resolveBuiltinElectronHelperMainPath() {
    const candidatePaths = [
        process.resourcesPath ? path.join(process.resourcesPath, 'electron-helper', 'main.js') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'core', 'browser', 'electron-helper', 'main.js') : null,
        path.join(__dirname, 'electron-helper', 'main.js')
    ].filter(Boolean);

    for (const candidatePath of candidatePaths) {
        if (fs.existsSync(candidatePath)) {
            return candidatePath;
        }
    }

    return path.join(__dirname, 'electron-helper', 'main.js');
}

function resolveBuiltinElectronLaunchCommandPath() {
    const candidatePaths = [
        process.resourcesPath ? path.join(process.resourcesPath, 'electron-helper', 'launch.cmd') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'core', 'browser', 'electron-helper', 'launch.cmd') : null,
        path.join(__dirname, 'electron-helper', 'launch.cmd')
    ].filter(Boolean);

    for (const candidatePath of candidatePaths) {
        if (fs.existsSync(candidatePath)) {
            return candidatePath;
        }
    }

    return path.join(__dirname, 'electron-helper', 'launch.cmd');
}

function resolvePlaywrightElectronLoaderPath() {
    try {
        const playwrightCorePackagePath = require.resolve('playwright-core/package.json');
        const playwrightCoreRoot = path.dirname(playwrightCorePackagePath);
        const loaderPath = path.join(playwrightCoreRoot, 'lib', 'server', 'electron', 'loader.js');
        if (fs.existsSync(loaderPath)) {
            return loaderPath;
        }
    } catch (_error) {
    }

    try {
        const playwrightPackagePath = require.resolve('playwright/package.json');
        const playwrightRoot = path.dirname(playwrightPackagePath);
        const loaderPath = path.join(playwrightRoot, 'node_modules', 'playwright-core', 'lib', 'server', 'electron', 'loader.js');
        if (fs.existsSync(loaderPath)) {
            return loaderPath;
        }
    } catch (_error) {
    }

    throw new Error('无法解析 Playwright Electron loader 路径');
}

function buildElectronLaunchArgs(browserProfile = {}, helperMainPath = '', playwrightLoaderPath = '', windowWidth = 1366, windowHeight = 768, headless = false, browserOptions = {}) {
    const webRtcLaunchArgs = [
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--enforce-webrtc-ip-permission-check',
        '--enable-features=WebRtcHideLocalIpsWithMdns'
    ];
    const launchArgs = [
        '-r',
        playwrightLoaderPath,
        helperMainPath,
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--password-store=basic',
        '--force-color-profile=srgb',
        ...webRtcLaunchArgs,
        `--window-size=${windowWidth},${windowHeight}`
    ];

    if (headless) {
        launchArgs.push('--disable-gpu');
    }

    if (process.platform === 'linux') {
        launchArgs.unshift('--no-sandbox');
    }

    if (Array.isArray(browserOptions.args) && browserOptions.args.length > 0) {
        launchArgs.push(...browserOptions.args.map(arg => String(arg)));
    }

    return launchArgs;
}

function patchPageContext(page, contextAdapter) {
    if (!page || typeof page !== 'object') {
        return;
    }

    try {
        Object.defineProperty(page, 'context', {
            value: () => contextAdapter,
            configurable: true
        });
        return;
    } catch (_error) {
    }

    try {
        page.context = () => contextAdapter;
    } catch (_error) {
    }
}

function isHttpLikeUrl(value = '') {
    const text = String(value || '').trim();
    if (!text) {
        return false;
    }

    try {
        const parsed = new URL(text);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_error) {
        return false;
    }
}

function normalizeElectronCookie(cookie = {}, fallbackUrl = '') {
    const domain = String(cookie.domain || '').trim();
    const pathValue = String(cookie.path || '/').trim() || '/';
    const explicitUrl = String(cookie.url || '').trim();
    const sameSiteText = String(cookie.sameSite || '').trim().toLowerCase();
    let secure = cookie.secure === true || sameSiteText === 'none' || sameSiteText === 'no_restriction';
    let url = explicitUrl;
    const isLocalNetworkHost = (hostname = '') => {
        const host = String(hostname || '').trim().toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || /^127(?:\.\d{1,3}){3}$/.test(host);
    };
    const preferHttpsForHost = (hostname = '') => !isLocalNetworkHost(hostname);

    const applySecureScheme = (inputUrl = '') => {
        const text = String(inputUrl || '').trim();
        if (!text) {
            return text;
        }

        try {
            const parsed = new URL(text);
            if (parsed.protocol === 'http:' && preferHttpsForHost(parsed.hostname)) {
                parsed.protocol = 'https:';
                secure = true;
            } else if (secure && parsed.protocol === 'http:') {
                parsed.protocol = 'https:';
            }
            return parsed.toString();
        } catch (_error) {
            return text;
        }
    };

    if (url && !isHttpLikeUrl(url)) {
        url = '';
    } else if (url) {
        url = applySecureScheme(url);
    }

    if (!url && domain) {
        const normalizedDomain = domain.startsWith('.') ? domain.slice(1) : domain;
        const useHttps = preferHttpsForHost(normalizedDomain) || secure;
        if (useHttps) {
            secure = true;
        }
        url = `${useHttps ? 'https' : 'http'}://${normalizedDomain}${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`;
    }

    if (!url && fallbackUrl && isHttpLikeUrl(fallbackUrl)) {
        try {
            const parsed = new URL(fallbackUrl);
            if (parsed.protocol === 'http:' && preferHttpsForHost(parsed.hostname)) {
                parsed.protocol = 'https:';
                secure = true;
            } else if (secure && parsed.protocol === 'http:') {
                parsed.protocol = 'https:';
            }
            url = `${parsed.protocol}//${parsed.hostname}${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`;
        } catch (_error) {
        }
    }

    if (!url) {
        return null;
    }

    const normalized = {
        name: String(cookie.name || '').trim(),
        value: String(cookie.value || ''),
        url,
        secure,
        httpOnly: cookie.httpOnly === true
    };
    if (domain) {
        normalized.domain = domain;
    }
    if (pathValue) {
        normalized.path = pathValue;
    }

    if (cookie.expires !== undefined && cookie.expires !== null) {
        const rawExpires = Number(cookie.expires);
        if (Number.isFinite(rawExpires) && rawExpires > 0) {
            const expirationDate = rawExpires > 1e12 ? Math.floor(rawExpires / 1000) : Math.floor(rawExpires);
            if (expirationDate <= Math.floor(Date.now() / 1000)) {
                return null;
            }
            normalized.expirationDate = expirationDate;
        }
    }

    if (sameSiteText === 'lax') {
        normalized.sameSite = 'lax';
    } else if (sameSiteText === 'strict') {
        normalized.sameSite = 'strict';
    } else if (sameSiteText === 'none' || sameSiteText === 'no_restriction') {
        normalized.sameSite = 'no_restriction';
    } else if (sameSiteText === 'unspecified') {
        normalized.sameSite = 'unspecified';
    }

    return normalized;
}

function buildBuiltinBrowserToolbarInitScript() {
    return buildToolbarScriptFromFile();
}

class BuiltinElectronBrowserContextAdapter {
    constructor(options = {}) {
        this._electronApp = options.electronApp || null;
        this._actualContext = options.actualContext || null;
        this._logger = options.logger || console;
        this._userDataDir = String(options.userDataDir || '').trim();
        this._launchTimeout = Number.isFinite(parseInt(options.launchTimeout, 10))
            ? Math.max(0, parseInt(options.launchTimeout, 10))
            : 30000;
        this._windowWidth = Number.isFinite(parseInt(options.windowWidth, 10))
            ? Math.max(320, parseInt(options.windowWidth, 10))
            : 1366;
        this._windowHeight = Number.isFinite(parseInt(options.windowHeight, 10))
            ? Math.max(240, parseInt(options.windowHeight, 10))
            : 768;
        this._visible = options.visible !== false;
        this._offscreen = options.offscreen === true;
        this._browserId = String(options.browserId || '').trim();
        this._browserKind = String(options.browserKind || '').trim().toLowerCase();
        this._closed = false;
        this._pages = new Set();
        this._pageOrder = [];

        if (this._electronApp && typeof this._electronApp.on === 'function') {
            this._electronApp.on('window', (page) => {
                this._setupPage(page);
            });

            this._electronApp.on('close', () => {
                this._closed = true;
            });
        }

        if (this._actualContext && typeof this._actualContext.on === 'function') {
            this._actualContext.on('page', (page) => {
                this._setupPage(page);
            });

            this._actualContext.on('close', () => {
                this._closed = true;
            });
        }
    }

    isClosed() {
        return this._closed === true;
    }

    _setupPage(page) {
        if (!page || this._pages.has(page)) {
            return page || null;
        }

        this._pages.add(page);
        this._pageOrder = this._pageOrder.filter(item => item && item !== page);
        this._pageOrder.push(page);
        patchPageContext(page, this);

        if (typeof page.on === 'function') {
            page.on('close', () => {
                this._pages.delete(page);
                this._pageOrder = this._pageOrder.filter(item => item && item !== page);
                if (this._pageOrder.length === 0 && this._logger && typeof this._logger.debug === 'function') {
                    this._logger.debug(`Electron 内置浏览器页面已全部关闭${this._browserId ? `: ${this._browserId}` : ''}`);
                }
            });
        }

        return page;
    }

    _collectPages() {
        const pages = [];
        const seen = new Set();
        const pushPage = (page) => {
            if (!page || seen.has(page)) {
                return;
            }

            seen.add(page);
            if (typeof page.isClosed === 'function' && page.isClosed()) {
                return;
            }

            pages.push(page);
            this._setupPage(page);
        };

        if (this._actualContext && typeof this._actualContext.pages === 'function') {
            try {
                for (const page of this._actualContext.pages()) {
                    pushPage(page);
                }
            } catch (_error) {
            }
        }

        for (const page of this._pageOrder) {
            pushPage(page);
        }

        return pages;
    }

    pages() {
        return this._collectPages();
    }

    async newPage(options = {}) {
        if (this.isClosed()) {
            throw new Error('内置 Electron 浏览器上下文已关闭');
        }

        if (this._browserKind !== 'electron' && this._actualContext && typeof this._actualContext.newPage === 'function') {
            const page = await this._actualContext.newPage(options);
            return this._setupPage(page);
        }

        if (!this._electronApp || typeof this._electronApp.evaluate !== 'function') {
            throw new Error('Electron 浏览器无法创建新页面');
        }

        const waitForWindow = typeof this._electronApp.waitForEvent === 'function'
            ? this._electronApp.waitForEvent('window', { timeout: this._launchTimeout })
            : Promise.reject(new Error('Electron 浏览器无法监听新窗口'));

        await this._electronApp.evaluate(({ BrowserWindow }, payload) => {
            const resolveInitialBounds = () => {
                const fallbackWidth = Number.isFinite(Number(payload.width))
                    ? Math.max(320, Number(payload.width))
                    : 800;
                const fallbackHeight = Number.isFinite(Number(payload.height))
                    ? Math.max(240, Number(payload.height))
                    : 600;

                if (payload.inheritBounds !== false && typeof BrowserWindow.getFocusedWindow === 'function') {
                    const referenceWindow = BrowserWindow.getFocusedWindow()
                        || (typeof BrowserWindow.getAllWindows === 'function'
                            ? [...BrowserWindow.getAllWindows()].reverse().find((win) => win && (typeof win.isDestroyed === 'function' ? !win.isDestroyed() : true))
                            : null);

                    if (referenceWindow && typeof referenceWindow.getBounds === 'function') {
                        try {
                            const bounds = referenceWindow.getBounds();
                            if (bounds) {
                                return {
                                    width: Number.isFinite(Number(bounds.width)) ? Math.max(320, Number(bounds.width)) : fallbackWidth,
                                    height: Number.isFinite(Number(bounds.height)) ? Math.max(240, Number(bounds.height)) : fallbackHeight,
                                    x: payload.offscreen ? -32000 : (Number.isFinite(Number(bounds.x)) ? Number(bounds.x) : undefined),
                                    y: payload.offscreen ? -32000 : (Number.isFinite(Number(bounds.y)) ? Number(bounds.y) : undefined)
                                };
                            }
                        } catch (_error) {
                        }
                    }
                }

                return {
                    width: fallbackWidth,
                    height: fallbackHeight,
                    x: payload.offscreen ? -32000 : undefined,
                    y: payload.offscreen ? -32000 : undefined
                };
            };

            const bounds = resolveInitialBounds();
            const win = new BrowserWindow({
                width: bounds.width,
                height: bounds.height,
                x: bounds.x,
                y: bounds.y,
                show: payload.visible === true,
                skipTaskbar: payload.offscreen === true || payload.visible !== true,
                autoHideMenuBar: true,
                backgroundColor: '#ffffff',
                devTools: true,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: false,
                    nativeWindowOpen: true
                }
            });

            const autoOpenDevTools = String(process.env.BUILTIN_ELECTRON_DEVTOOLS_AUTO_OPEN || '0').trim() === '1';

            if (win && win.webContents && typeof win.webContents.on === 'function') {
                win.webContents.on('before-input-event', (event, input) => {
                    const key = String(input?.key || '').toLowerCase();
                    const isF12Shortcut = key === 'f12';
                    const isDevToolsShortcut =
                        isF12Shortcut ||
                        ((input.control || input.meta) && input.shift && key === 'i');

                    if (!isDevToolsShortcut) {
                        return;
                    }

                    try {
                        if (win.webContents.isDevToolsOpened()) {
                            win.webContents.closeDevTools();
                        } else {
                            win.webContents.openDevTools({ mode: 'bottom' });
                        }
                    } catch (_error) {
                    }

                    if (!isF12Shortcut) {
                        event.preventDefault();
                    }
                });

                if (autoOpenDevTools) {
                    win.once('ready-to-show', () => {
                        try {
                            if (!win.isDestroyed() && !win.webContents.isDevToolsOpened()) {
                                win.webContents.openDevTools({ mode: 'bottom' });
                            }
                        } catch (_error) {
                        }
                    });
                }
            }

            win.loadURL('about:blank').catch(() => {});
        }, {
            width: Number.isFinite(options.width) ? options.width : this._windowWidth,
            height: Number.isFinite(options.height) ? options.height : this._windowHeight,
            visible: this._visible,
            offscreen: this._offscreen,
            inheritBounds: options.inheritBounds !== false
        });

        const page = await waitForWindow;
        return this._setupPage(page);
    }

    async cookies(urls) {
        if (this._browserKind === 'electron' && this._electronApp && typeof this._electronApp.evaluate === 'function') {
            try {
                return await this._electronApp.evaluate(async ({ session }, inputUrls) => {
                    const targetSession = session && session.defaultSession ? session.defaultSession : session;
                    if (!targetSession || !targetSession.cookies || typeof targetSession.cookies.get !== 'function') {
                        return [];
                    }

                    if (!Array.isArray(inputUrls) || inputUrls.length === 0) {
                        return await targetSession.cookies.get({});
                    }

                    const collected = [];
                    const seen = new Set();
                    for (const inputUrl of inputUrls) {
                        const normalizedUrl = String(inputUrl || '').trim();
                        if (!normalizedUrl) {
                            continue;
                        }
                        const items = await targetSession.cookies.get({ url: normalizedUrl });
                        for (const item of Array.isArray(items) ? items : []) {
                            const cookieKey = `${item.name || ''}||${item.domain || ''}||${item.path || ''}`;
                            if (seen.has(cookieKey)) {
                                continue;
                            }
                            seen.add(cookieKey);
                            collected.push(item);
                        }
                    }
                    return collected;
                }, Array.isArray(urls) ? urls : []);
            } catch (error) {
                this._logger?.warning?.(`读取内置 Electron 浏览器 Cookie 失败: ${error.message}`);
                return [];
            }
        }

        if (!this._actualContext || typeof this._actualContext.cookies !== 'function') {
            return [];
        }

        return await this._actualContext.cookies(urls);
    }

    async addCookies(cookies = []) {
        if (!Array.isArray(cookies) || cookies.length === 0) {
            return true;
        }

        if (this._browserKind === 'electron' && this._electronApp && typeof this._electronApp.evaluate === 'function') {
            const fallbackUrl = this._pageOrder.length > 0 && typeof this._pageOrder[0]?.url === 'function'
                ? this._pageOrder[0].url()
                : '';

            try {
                const normalizedCookies = cookies
                    .map(cookie => normalizeElectronCookie(cookie, fallbackUrl))
                    .filter(Boolean);

                if (normalizedCookies.length === 0) {
                    this._logger?.warning?.('内置 Electron 浏览器没有可注入的有效 Cookie');
                    return false;
                }

                await this._electronApp.evaluate(async ({ session }, payload) => {
                    const targetSession = session && session.defaultSession ? session.defaultSession : session;
                    if (!targetSession || !targetSession.cookies || typeof targetSession.cookies.set !== 'function') {
                        throw new Error('Electron session 不支持 Cookie 注入');
                    }

                    const cloneForRetry = (cookie, dropSameSite = false, dropExpirationDate = false) => {
                        const cloned = { ...cookie };
                        if (dropSameSite) {
                            delete cloned.sameSite;
                        }
                        if (dropExpirationDate) {
                            delete cloned.expirationDate;
                        }
                        return cloned;
                    };

                    const setCookieWithRetry = async (cookie) => {
                        const attempts = [
                            cookie,
                            cloneForRetry(cookie, true, false),
                            cloneForRetry(cookie, true, true)
                        ];

                        let lastError = null;
                        for (const attempt of attempts) {
                            try {
                                const candidate = { ...attempt };
                                if (candidate.sameSite === undefined) {
                                    delete candidate.sameSite;
                                }
                                if (candidate.expirationDate === undefined) {
                                    delete candidate.expirationDate;
                                }
                                await targetSession.cookies.set(candidate);
                                return true;
                            } catch (error) {
                                lastError = error;
                            }
                        }

                        const cookieSummary = [
                            `name=${cookie.name || ''}`,
                            `domain=${cookie.domain || ''}`,
                            `path=${cookie.path || ''}`,
                            `url=${cookie.url || ''}`,
                            `sameSite=${cookie.sameSite || ''}`,
                            `secure=${cookie.secure === true ? 'true' : 'false'}`
                        ].join(', ');
                        const detailError = new Error(`Electron cookie 写入失败: ${cookieSummary}`);
                        detailError.cause = lastError || null;
                        throw detailError;
                    };

                    for (const cookie of Array.isArray(payload.cookies) ? payload.cookies : []) {
                        if (!cookie || !cookie.name) {
                            continue;
                        }
                        await setCookieWithRetry(cookie);
                    }
                }, {
                    cookies: normalizedCookies
                });
                return true;
            } catch (error) {
                this._logger?.warning?.(`内置 Electron 浏览器 Cookie 注入失败: ${error.message}`);
                return false;
            }
        }

        if (!this._actualContext || typeof this._actualContext.addCookies !== 'function') {
            return false;
        }

        await this._actualContext.addCookies(cookies);
        return true;
    }

    async addInitScript(script = {}) {
        if (!this._actualContext || typeof this._actualContext.addInitScript !== 'function') {
            return false;
        }

        await this._actualContext.addInitScript(script);
        return true;
    }

    async route(url, handler) {
        if (!this._actualContext || typeof this._actualContext.route !== 'function') {
            return false;
        }

        await this._actualContext.route(url, handler);
        return true;
    }

    async newCDPSession(page) {
        if (!this._actualContext || typeof this._actualContext.newCDPSession !== 'function') {
            throw new Error('内置 Electron 浏览器当前上下文不支持 CDP 会话');
        }

        return await this._actualContext.newCDPSession(page);
    }

    on(event, listener) {
        if (!this._actualContext || typeof this._actualContext.on !== 'function') {
            return this;
        }

        this._actualContext.on(event, listener);
        return this;
    }

    off(event, listener) {
        if (!this._actualContext || typeof this._actualContext.off !== 'function') {
            return this;
        }

        this._actualContext.off(event, listener);
        return this;
    }

    removeListener(event, listener) {
        if (!this._actualContext || typeof this._actualContext.removeListener !== 'function') {
            return this;
        }

        this._actualContext.removeListener(event, listener);
        return this;
    }

    async close() {
        if (this._closed) {
            return true;
        }

        this._closed = true;

        try {
            if (this._electronApp && typeof this._electronApp.close === 'function') {
                await this._electronApp.close();
                return true;
            }
        } catch (error) {
            this._logger?.warning?.(`关闭内置 Electron 浏览器失败: ${error.message}`);
        } finally {
            if (this._userDataDir) {
                try {
                    await fs.remove(this._userDataDir);
                } catch (cleanupError) {
                    this._logger?.warning?.(`清理内置 Electron 浏览器目录失败: ${cleanupError.message}`);
                }
            }
        }

        return false;
    }
}

async function launchBuiltinElectronBrowser(options = {}) {
    const {
        browserId = '',
        browserProfile = {},
        browserSettings = {},
        browserOptions = {},
        logger = console,
        headless = false,
        visible = undefined,
        offscreen = false,
        launchTimeout = 30000
    } = options;

    const playwrightElectron = loadPlaywrightElectron();
    const helperMainPath = resolveBuiltinElectronHelperMainPath();
    const launcherCommandPath = resolveBuiltinElectronLaunchCommandPath();
    const playwrightLoaderPath = resolvePlaywrightElectronLoaderPath();
    const windowWidth = Number.isFinite(parseInt(browserProfile.viewport?.width, 10))
        ? Math.max(320, parseInt(browserProfile.viewport.width, 10))
        : 1366;
    const windowHeight = Number.isFinite(parseInt(browserProfile.viewport?.height, 10))
        ? Math.max(240, parseInt(browserProfile.viewport.height, 10))
        : 768;
    const userDataDir = String(browserOptions.userDataDir || '').trim()
        || fs.mkdtempSync(path.join(os.tmpdir(), 'ai-automation-electron-'));
    const windowVisible = visible !== undefined ? visible !== false : headless !== true;
    const env = {
        ...process.env,
        ...(browserOptions.env && typeof browserOptions.env === 'object' ? browserOptions.env : {}),
        BUILTIN_ELECTRON_USER_DATA_DIR: userDataDir,
        BUILTIN_ELECTRON_WINDOW_WIDTH: String(windowWidth),
        BUILTIN_ELECTRON_WINDOW_HEIGHT: String(windowHeight),
        BUILTIN_ELECTRON_WINDOW_VISIBLE: windowVisible ? '1' : '0',
        BUILTIN_ELECTRON_WINDOW_OFFSCREEN: offscreen ? '1' : '0',
        BUILTIN_ELECTRON_BROWSER_ID: browserId,
        BUILTIN_ELECTRON_BROWSER_TYPE: String(browserSettings.browser_type || browserSettings.browserType || 'electron').trim(),
        BUILTIN_ELECTRON_BROWSER_SOURCE: String(browserSettings.browser_source || browserSettings.browserSource || browserSettings.browser_type || 'local-browser').trim(),
        BUILTIN_ELECTRON_WEB_CONTROL_URL: String(browserSettings.web_control_url || browserSettings.webControlUrl || '').trim(),
        BUILTIN_ELECTRON_REMOTE_DEBUGGING_PORT: '0',
        BUILTIN_ELECTRON_DEVTOOLS_AUTO_OPEN: '0',
        BUILTIN_ELECTRON_BRIDGE_ENABLED: '0',
        BUILTIN_ELECTRON_BRIDGE_PRELOAD_PATH: ''
    };

    const watermarkExtensionEnabled = false;
    const watermarkExtensionPath = '';
    env.BUILTIN_ELECTRON_EXTENSION_ENABLED = '0';

    delete env.NODE_OPTIONS;
    delete env.ELECTRON_RUN_AS_NODE;

    const launchArgs = buildElectronLaunchArgs(
        browserProfile,
        helperMainPath,
        playwrightLoaderPath,
        windowWidth,
        windowHeight,
        headless,
        browserOptions
    );

    const electronLaunchOptions = {
        args: launchArgs,
        env,
        timeout: Number.isFinite(parseInt(launchTimeout, 10)) ? Math.max(0, parseInt(launchTimeout, 10)) : 30000,
        chromiumSandbox: false
    };
    electronLaunchOptions.executablePath = launcherCommandPath;

    if (browserOptions.artifactsDir) {
        electronLaunchOptions.artifactsDir = String(browserOptions.artifactsDir);
    }

    const electronApp = await playwrightElectron.launch(electronLaunchOptions);
    const actualContext = typeof electronApp.context === 'function' ? electronApp.context() : null;
    const adapter = new BuiltinElectronBrowserContextAdapter({
        electronApp,
        actualContext,
        logger,
        userDataDir,
        launchTimeout,
        windowWidth,
        windowHeight,
        visible: windowVisible,
        offscreen,
        browserId,
        browserKind: 'electron'
    });

    logger.info('已禁用去水印插件');

    if (typeof electronApp.isConnected !== 'function') {
        electronApp.isConnected = () => !adapter.isClosed();
    }

    const pages = typeof electronApp.windows === 'function' ? electronApp.windows() : [];
    let page = pages.find(Boolean) || null;
    if (!page && typeof electronApp.firstWindow === 'function') {
        page = await electronApp.firstWindow({ timeout: launchTimeout });
    }

    if (!page) {
        throw new Error('内置 Electron 浏览器窗口未能创建');
    }

    adapter._setupPage(page);

    let browserVersion = String(process?.versions?.chrome || '').trim()
        ? `Chrome/${String(process.versions.chrome).trim()}`
        : '';
    if (!browserVersion) {
        try {
            browserVersion = await page.evaluate(() => String(navigator.userAgent || '')).catch(() => '');
        } catch (_error) {
            browserVersion = '';
        }
    }

    return {
        electronApp,
        context: adapter,
        page,
        browserVersion,
        userDataDir,
        cleanup: async () => {
            await adapter.close();
        }
    };
}

module.exports = {
    loadPlaywrightElectron,
    resolveBuiltinElectronHelperMainPath,
    resolveBuiltinElectronLaunchCommandPath,
    resolvePlaywrightElectronLoaderPath,
    patchPageContext,
    BuiltinElectronBrowserContextAdapter,
    launchBuiltinElectronBrowser,
    buildBuiltinBrowserToolbarInitScript
};


