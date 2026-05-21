const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, clipboard, globalShortcut, session } = require('electron');

const visible = String(process.env.BUILTIN_ELECTRON_WINDOW_VISIBLE || '1').trim() !== '0';
const offscreen = String(process.env.BUILTIN_ELECTRON_WINDOW_OFFSCREEN || '0').trim() !== '0';
const windowWidth = Number.isFinite(parseInt(process.env.BUILTIN_ELECTRON_WINDOW_WIDTH, 10))
    ? Math.max(320, parseInt(process.env.BUILTIN_ELECTRON_WINDOW_WIDTH, 10))
    : 1366;
const windowHeight = Number.isFinite(parseInt(process.env.BUILTIN_ELECTRON_WINDOW_HEIGHT, 10))
    ? Math.max(240, parseInt(process.env.BUILTIN_ELECTRON_WINDOW_HEIGHT, 10))
    : 768;
const userDataDir = String(process.env.BUILTIN_ELECTRON_USER_DATA_DIR || '').trim();
const remoteDebuggingPort = String(process.env.BUILTIN_ELECTRON_REMOTE_DEBUGGING_PORT || '0').trim() || '0';
const browserStateFilePath = String(process.env.BUILTIN_ELECTRON_STATE_FILE || '').trim()
    || (userDataDir ? path.join(userDataDir, 'builtin-browser-state.json') : '');
const openWindows = new Set();
const DOCUMENT_POLICY_NOISE_TOKEN = 'include-js-call-stacks-in-crash-reports';
const BUILTIN_BROWSER_COMMAND_PROTOCOL = 'builtin-browser-action:';
const MEDIA_DOWNLOAD_EXTENSIONS = {
    image: '.png',
    video: '.mp4'
};
const IMAGE_MIME_EXTENSIONS = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/pjpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/x-ms-bmp': '.bmp',
    'image/avif': '.avif',
    'image/svg+xml': '.svg',
    'image/vnd.microsoft.icon': '.ico',
    'image/x-icon': '.ico'
};
const VIDEO_MIME_EXTENSIONS = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/ogg': '.ogv',
    'video/quicktime': '.mov',
    'video/x-matroska': '.mkv',
    'video/x-msvideo': '.avi',
    'video/x-flv': '.flv',
    'video/mpeg': '.mpg'
};
let responseHeaderFilterInstalled = false;
let watermarkExtensionLoadPromise = null;

function stripDocumentPolicyNoise(headerValue = '') {
    const raw = String(headerValue || '').trim();
    if (!raw) {
        return raw;
    }

    const parts = raw
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .filter(item => !item.toLowerCase().includes(DOCUMENT_POLICY_NOISE_TOKEN));

    return parts.join(', ');
}

function installResponseHeaderFilter() {
    if (responseHeaderFilterInstalled || !session || !session.defaultSession || !session.defaultSession.webRequest) {
        return;
    }

    responseHeaderFilterInstalled = true;
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = { ...(details.responseHeaders || {}) };
        let changed = false;

        for (const [headerName, headerValue] of Object.entries(responseHeaders)) {
            if (String(headerName || '').toLowerCase() !== 'document-policy') {
                continue;
            }

            const nextValue = Array.isArray(headerValue)
                ? headerValue.map(item => stripDocumentPolicyNoise(item)).filter(Boolean)
                : stripDocumentPolicyNoise(headerValue);

            if (Array.isArray(nextValue) ? nextValue.length > 0 : String(nextValue || '').trim()) {
                responseHeaders[headerName] = nextValue;
            } else {
                delete responseHeaders[headerName];
            }

            changed = true;
        }

        callback({
            responseHeaders: changed ? responseHeaders : details.responseHeaders
        });
    });
}

function installDevToolsShortcuts(win) {
    if (!win || typeof win.webContents?.on !== 'function') {
        return;
    }

    win.webContents.on('before-input-event', (event, input) => {
        const key = String(input?.key || '').toLowerCase();
        const isF12Shortcut = key === 'f12';
        const isDevToolsShortcut = isF12Shortcut || ((input.control || input.meta) && input.shift && key === 'i');

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
}

function isBuiltinBrowserCommandUrl(url = '') {
    const text = String(url || '').trim();
    if (!text) {
        return false;
    }

    try {
        const parsed = new URL(text);
        return String(parsed.protocol || '').toLowerCase() === BUILTIN_BROWSER_COMMAND_PROTOCOL;
    } catch (_error) {
        return text.toLowerCase().startsWith(BUILTIN_BROWSER_COMMAND_PROTOCOL);
    }
}

function parseBuiltinBrowserCommandUrl(url = '') {
    const text = String(url || '').trim();
    if (!text || !isBuiltinBrowserCommandUrl(text)) {
        return null;
    }

    try {
        const parsed = new URL(text);
        const action = String(parsed.pathname || parsed.host || '').replace(/^\/+/, '').trim().toLowerCase();
        const params = {};
        for (const [key, value] of parsed.searchParams.entries()) {
            params[key] = value;
        }
        return {
            action,
            params,
            url: text
        };
    } catch (_error) {
        const [, actionPart = ''] = text.split(':', 2);
        const action = String(actionPart || '').split('?')[0].replace(/^\/+/, '').trim().toLowerCase();
        return {
            action,
            params: {},
            url: text
        };
    }
}

function isBuiltinBrowserAuxiliaryWindow(win, details = {}) {
    if (!win || typeof win !== 'object') {
        return false;
    }
    return false;
}

function getBuiltinBrowserWindows() {
    return Array.from(openWindows).filter((win) => win && !win.isDestroyed() && win.__builtinBrowserIncludeInTabStrip !== false);
}

let builtinBrowserVisibilitySyncInProgress = false;
let builtinBrowserActiveWindowId = 0;

function shouldManageBuiltinBrowserVisibility() {
    return visible === true && offscreen !== true;
}

function applyBuiltinBrowserTabVisibility(activeWindowId = 0) {
    if (!shouldManageBuiltinBrowserVisibility() || builtinBrowserVisibilitySyncInProgress) {
        return false;
    }

    const normalizedActiveWindowId = Number(activeWindowId || 0);
    if (!Number.isFinite(normalizedActiveWindowId) || normalizedActiveWindowId <= 0) {
        return false;
    }

    const windows = getBuiltinBrowserWindows();
    if (windows.length === 0) {
        return false;
    }

    builtinBrowserVisibilitySyncInProgress = true;
    try {
        for (const win of windows) {
            if (!win || typeof win.isDestroyed === 'function' && win.isDestroyed()) {
                continue;
            }

            const windowId = Number(win.id || 0);
            const isActive = windowId > 0 && windowId === normalizedActiveWindowId;
            try {
                if (isActive) {
                    if (typeof win.isMinimized === 'function' && win.isMinimized()) {
                        win.restore();
                    }
                    if (typeof win.show === 'function') {
                        win.show();
                    }
                    if (typeof win.focus === 'function') {
                        win.focus();
                    }
                }
            } catch (_error) {
            }
        }
    } finally {
        builtinBrowserVisibilitySyncInProgress = false;
    }

    return true;
}

function writeBuiltinBrowserStateFile(state = {}) {
    if (!browserStateFilePath) {
        return;
    }

    try {
        fs.mkdirSync(path.dirname(browserStateFilePath), { recursive: true });
        fs.writeFileSync(browserStateFilePath, JSON.stringify(state, null, 2), 'utf8');
    } catch (_error) {
    }
}

async function executeBuiltinBrowserScript(win, script) {
    if (!win || !win.webContents || typeof win.webContents.executeJavaScript !== 'function') {
        return false;
    }

    try {
        await win.webContents.executeJavaScript(String(script || ''), true);
        return true;
    } catch (_error) {
        return false;
    }
}

async function syncBuiltinBrowserWindowState(win, state = null) {
    if (!win || typeof win.isDestroyed === 'function' && win.isDestroyed()) {
        return false;
    }

    const windowId = Number(win.id || 0);
    const activeWindowId = Number(state?.activeWindowId || 0);
    const tabs = Array.isArray(state?.tabs) ? state.tabs : [];
    const payload = {
        browserId: String(state?.browserId || process.env.BUILTIN_ELECTRON_BROWSER_ID || '').trim(),
        currentWindowId: windowId,
        activeWindowId,
        tabCount: tabs.length,
        isActive: windowId > 0 && activeWindowId > 0 && windowId === activeWindowId,
        tabs: tabs.map((item) => ({
            id: Number(item?.id || 0),
            title: String(item?.title || ''),
            url: String(item?.url || ''),
            isActive: !!item?.isActive,
            isAuxiliary: !!item?.isAuxiliary,
            isVisible: item?.isVisible !== false
        }))
    };

    const serializedState = JSON.stringify(payload).replace(/</g, '\\u003c');
    const script = `
        (function () {
            const state = ${serializedState};
            window.__builtinBrowserWindowId = state.currentWindowId;
            window.__builtinBrowserWindowActive = state.isActive === true;
            window.__builtinBrowserChromeState = state;
            if (document && document.documentElement) {
                document.documentElement.setAttribute('data-builtin-browser-window-id', String(state.currentWindowId || ''));
                document.documentElement.setAttribute('data-builtin-browser-active', state.isActive ? 'true' : 'false');
                document.documentElement.setAttribute('data-builtin-browser-tab-count', String(state.tabCount || 0));
                document.documentElement.setAttribute('data-builtin-browser-active-window-id', String(state.activeWindowId || ''));
            }
            if (typeof window.__builtinBrowserToolbarApplyState === 'function') {
                window.__builtinBrowserToolbarApplyState(state);
            }
        })();
    `;

    return await executeBuiltinBrowserScript(win, script);
}

async function syncBuiltinBrowserChromeState(options = {}) {
    const tabs = [];
    for (const win of getBuiltinBrowserWindows()) {
        if (!win || typeof win.isDestroyed === 'function' && win.isDestroyed()) {
            continue;
        }

        let title = '';
        let url = '';
        try {
            title = String(typeof win.getTitle === 'function' ? win.getTitle() : '').trim();
        } catch (_error) {
        }

        try {
            url = String(win.webContents && typeof win.webContents.getURL === 'function' ? win.webContents.getURL() : '').trim();
        } catch (_error) {
        }

        tabs.push({
            id: Number(win.id || 0),
            title: title || (url ? new URL(url).hostname || url : '新窗口'),
            url,
            isActive: false,
            isAuxiliary: false,
            isVisible: typeof win.isVisible === 'function' ? win.isVisible() : true
        });
    }

    const explicitActiveWindowId = Number(options.activeWindowId || 0);
    let activeWindowId = Number.isFinite(explicitActiveWindowId) && explicitActiveWindowId > 0
        ? explicitActiveWindowId
        : 0;

    if (activeWindowId > 0) {
        const foundTab = tabs.find((item) => Number(item.id || 0) === activeWindowId);
        if (!foundTab) {
            activeWindowId = 0;
        }
    }

    if (!activeWindowId && Number.isFinite(builtinBrowserActiveWindowId) && builtinBrowserActiveWindowId > 0) {
        const storedActiveTab = tabs.find((item) => Number(item.id || 0) === builtinBrowserActiveWindowId);
        if (storedActiveTab) {
            activeWindowId = builtinBrowserActiveWindowId;
        }
    }

    if (!activeWindowId && options.preferFocusedWindow !== false && BrowserWindow && typeof BrowserWindow.getFocusedWindow === 'function') {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow && openWindows.has(focusedWindow) && !focusedWindow.isDestroyed() && focusedWindow.__builtinBrowserIncludeInTabStrip !== false) {
            activeWindowId = Number(focusedWindow.id || 0);
        }
    }

    if (!activeWindowId) {
        const lastVisibleWindow = [...tabs].reverse().find((item) => Number(item.id || 0) > 0 && item.isVisible !== false);
        activeWindowId = Number(lastVisibleWindow?.id || 0);
    }

    if (!activeWindowId && tabs.length > 0) {
        activeWindowId = Number(tabs[0].id || 0);
    }

    for (const item of tabs) {
        item.isActive = Number(item.id || 0) === activeWindowId;
    }

    builtinBrowserActiveWindowId = activeWindowId > 0 ? activeWindowId : 0;

    const state = {
        browserId: String(process.env.BUILTIN_ELECTRON_BROWSER_ID || '').trim(),
        activeWindowId,
        tabs
    };

    if (options.forceVisibilitySync === true || explicitActiveWindowId > 0) {
        applyBuiltinBrowserTabVisibility(activeWindowId);
    }
    writeBuiltinBrowserStateFile(state);

    const syncPromises = [];
    for (const win of getBuiltinBrowserWindows()) {
        syncPromises.push(syncBuiltinBrowserWindowState(win, state));
    }

    await Promise.allSettled(syncPromises);
    return state;
}

function registerBuiltinBrowserWindow(win, details = {}) {
    if (!win || typeof win !== 'object' || typeof win.isDestroyed === 'function' && win.isDestroyed()) {
        return null;
    }

    if (!openWindows.has(win)) {
        openWindows.add(win);
    }

    win.__builtinBrowserIncludeInTabStrip = details.includeInTabStrip !== false && !isBuiltinBrowserAuxiliaryWindow(win, details);
    win.__builtinBrowserAuxiliary = win.__builtinBrowserIncludeInTabStrip !== true;

    const syncSoon = (syncOptions = {}) => {
        void syncBuiltinBrowserChromeState(syncOptions);
    };

    if (typeof win.removeListener === 'function') {
        win.removeListener('focus', syncSoon);
        win.removeListener('blur', syncSoon);
        win.removeListener('show', syncSoon);
        win.removeListener('hide', syncSoon);
        win.removeListener('restore', syncSoon);
        win.removeListener('maximize', syncSoon);
        win.removeListener('unmaximize', syncSoon);
    }

    if (typeof win.on === 'function') {
        win.on('focus', () => {
            builtinBrowserActiveWindowId = Number(win.id || 0);
            syncSoon({
                activeWindowId: builtinBrowserActiveWindowId,
                forceVisibilitySync: true
            });
        });
        win.on('blur', syncSoon);
        win.on('show', syncSoon);
        win.on('hide', syncSoon);
        win.on('restore', syncSoon);
        win.on('maximize', syncSoon);
        win.on('unmaximize', syncSoon);
        win.on('closed', () => {
            openWindows.delete(win);
            win.__builtinBrowserIncludeInTabStrip = false;
            win.__builtinBrowserAuxiliary = true;
            if (Number(win.id || 0) === builtinBrowserActiveWindowId) {
                builtinBrowserActiveWindowId = 0;
            }
            syncSoon({
                forceVisibilitySync: true
            });
        });
    }

    if (win.webContents && typeof win.webContents.on === 'function') {
        win.webContents.on('did-finish-load', () => {
            syncSoon();
        });
        win.webContents.on('dom-ready', () => {
            syncSoon();
        });
        win.webContents.on('page-title-updated', () => {
            syncSoon();
        });
        win.webContents.on('did-navigate', () => {
            syncSoon();
        });
        win.webContents.on('did-navigate-in-page', () => {
            syncSoon();
        });
    }

    return win;
}

function resolveBuiltinBrowserWindowBounds(options = {}) {
    const hasExplicitWidth = Number.isFinite(parseInt(options.width, 10));
    const hasExplicitHeight = Number.isFinite(parseInt(options.height, 10));
    let width = hasExplicitWidth ? Math.max(320, parseInt(options.width, 10)) : windowWidth;
    let height = hasExplicitHeight ? Math.max(240, parseInt(options.height, 10)) : windowHeight;
    let x = options.offscreen === true || offscreen ? -32000 : undefined;
    let y = options.offscreen === true || offscreen ? -32000 : undefined;

    if (options.inheritBounds !== false && !hasExplicitWidth && !hasExplicitHeight && options.offscreen !== true && offscreen !== true) {
        const referenceWindow = (typeof BrowserWindow.getFocusedWindow === 'function' && BrowserWindow.getFocusedWindow())
            || (typeof BrowserWindow.getAllWindows === 'function'
                ? [...BrowserWindow.getAllWindows()].reverse().find((win) => win && (typeof win.isDestroyed === 'function' ? !win.isDestroyed() : true))
                : null);

        if (referenceWindow && typeof referenceWindow.getBounds === 'function') {
            try {
                const bounds = referenceWindow.getBounds();
                if (bounds && Number.isFinite(Number(bounds.width)) && Number.isFinite(Number(bounds.height))) {
                    width = Math.max(320, Number(bounds.width));
                    height = Math.max(240, Number(bounds.height));
                    if (bounds.x !== undefined) {
                        x = Number(bounds.x);
                    }
                    if (bounds.y !== undefined) {
                        y = Number(bounds.y);
                    }
                }
            } catch (_error) {
            }
        }
    }

    return { width, height, x, y };
}

function resolveWatermarkExtensionPath() {
    if (String(process.env.BUILTIN_ELECTRON_EXTENSION_ENABLED || '1').trim() === '0') {
        return '';
    }

    const explicitPath = String(process.env.BUILTIN_ELECTRON_EXTENSION_PATH || '').trim();
    const candidates = [
        explicitPath,
        path.join(process.cwd(), 'extensions', 'remove_watermark'),
        process.resourcesPath ? path.join(process.resourcesPath, 'extensions', 'remove_watermark') : '',
        path.join(app.getAppPath ? app.getAppPath() : process.cwd(), 'extensions', 'remove_watermark')
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                const manifestPath = path.join(candidate, 'manifest.json');
                if (fs.existsSync(manifestPath)) {
                    return candidate;
                }
            }
        } catch (_error) {
        }
    }

    return '';
}

function resolveWatermarkDownloadScriptPath() {
    const extensionPath = resolveWatermarkExtensionPath();
    if (!extensionPath) {
        return '';
    }

    const candidates = [
        path.join(extensionPath, 'lack', 'dldam.js'),
        path.join(extensionPath, 'dldam.js')
    ];

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch (_error) {
        }
    }

    return '';
}

function sanitizeDownloadFileNamePart(value = '', fallback = 'download') {
    const raw = String(value || '').trim();
    const fallbackName = String(fallback || 'download').trim() || 'download';
    const cleaned = raw
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .trim();

    return cleaned || fallbackName;
}

function normalizeDownloadExtension(value = '') {
    const extension = String(value || '').trim().toLowerCase();
    if (!extension) {
        return '';
    }

    return extension.startsWith('.') ? extension : `.${extension}`;
}

function resolveDownloadExtensionFromMimeType(mimeType = '') {
    const normalized = String(mimeType || '').trim().toLowerCase();
    if (!normalized) {
        return '';
    }

    if (IMAGE_MIME_EXTENSIONS[normalized]) {
        return IMAGE_MIME_EXTENSIONS[normalized];
    }

    if (VIDEO_MIME_EXTENSIONS[normalized]) {
        return VIDEO_MIME_EXTENSIONS[normalized];
    }

    return '';
}

function resolveDownloadNameFromUrl(sourceUrl = '') {
    const rawUrl = String(sourceUrl || '').trim();
    if (!rawUrl) {
        return { baseName: '', extension: '' };
    }

    try {
        const parsedUrl = new URL(rawUrl);
        const pathname = decodeURIComponent(parsedUrl.pathname || '');
        const parsedBaseName = path.basename(pathname);
        const parsedExt = normalizeDownloadExtension(path.extname(parsedBaseName));
        return {
            baseName: parsedExt
                ? parsedBaseName.slice(0, -parsedExt.length)
                : parsedBaseName,
            extension: parsedExt
        };
    } catch (_error) {
        const fallbackPath = rawUrl.split(/[?#]/, 1)[0];
        const parsedBaseName = path.basename(fallbackPath);
        const parsedExt = normalizeDownloadExtension(path.extname(parsedBaseName));
        return {
            baseName: parsedExt
                ? parsedBaseName.slice(0, -parsedExt.length)
                : parsedBaseName,
            extension: parsedExt
        };
    }
}

function uniqueDownloadPath(basePath) {
    const parsed = path.parse(basePath);
    let candidate = basePath;
    let index = 1;

    while (fs.existsSync(candidate)) {
        candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
        index += 1;
    }

    return candidate;
}

function getContextMediaLabel(mediaType = '') {
    const normalized = String(mediaType || '').trim().toLowerCase();
    if (normalized === 'video') {
        return '视频';
    }
    if (normalized === 'image') {
        return '图片';
    }
    return '文件';
}

function resolveMediaDownloadFileName(params = {}, downloadItem = null) {
    const mediaType = String(params.mediaType || '').trim().toLowerCase();
    const fallbackLabel = getContextMediaLabel(mediaType);
    const sourceUrl = String(params.srcURL || params.linkURL || '').trim();
    const downloadFilename = typeof downloadItem?.getFilename === 'function'
        ? String(downloadItem.getFilename() || '').trim()
        : '';
    const downloadMimeType = typeof downloadItem?.getMimeType === 'function'
        ? String(downloadItem.getMimeType() || '').trim()
        : '';

    const suggestedNameSource = downloadFilename || sourceUrl;
    const suggestedName = resolveDownloadNameFromUrl(suggestedNameSource);
    const urlName = resolveDownloadNameFromUrl(sourceUrl);
    let baseName = suggestedName.baseName || urlName.baseName || '';
    let extension = normalizeDownloadExtension(suggestedName.extension || urlName.extension);

    if (!baseName) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        baseName = `${fallbackLabel}-${timestamp}`;
    }

    if (!extension) {
        extension = resolveDownloadExtensionFromMimeType(downloadMimeType)
            || resolveDownloadExtensionFromMimeType(downloadItem?.mimeType || '')
            || MEDIA_DOWNLOAD_EXTENSIONS[mediaType]
            || '';
    }

    const safeBaseName = sanitizeDownloadFileNamePart(baseName, fallbackLabel);
    return `${safeBaseName}${extension}`;
}

async function downloadContextMedia(win, params = {}) {
    if (!win || !win.webContents || typeof win.webContents.downloadURL !== 'function') {
        throw new Error('浏览器下载能力不可用');
    }

    const sourceUrl = String(params.srcURL || params.linkURL || '').trim();
    if (!sourceUrl) {
        throw new Error('未找到可下载的媒体地址');
    }

    const mediaType = String(params.mediaType || '').trim().toLowerCase();
    const targetSession = win.webContents.session || session.defaultSession;
    const downloadsDir = app.getPath('downloads');
    const fallbackFileName = resolveMediaDownloadFileName(params);

    return await new Promise((resolve, reject) => {
        let settled = false;
        const timeoutMs = 30000;
        const timeoutId = setTimeout(() => {
            settleReject(new Error('下载超时'));
        }, timeoutMs);

        const cleanup = () => {
            clearTimeout(timeoutId);
            if (targetSession && typeof targetSession.removeListener === 'function') {
                targetSession.removeListener('will-download', onWillDownload);
            }
        };

        const settleResolve = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(value);
        };

        const settleReject = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            reject(error);
        };

        const onWillDownload = (event, item, webContents) => {
            const itemUrl = typeof item?.getURL === 'function' ? String(item.getURL() || '').trim() : '';
            if (webContents && webContents !== win.webContents) {
                return;
            }
            if (itemUrl && itemUrl !== sourceUrl) {
                return;
            }

            const fileName = resolveMediaDownloadFileName(params, item);
            const savePath = uniqueDownloadPath(path.join(downloadsDir, fileName || fallbackFileName));

            try {
                item.setSavePath(savePath);
            } catch (error) {
                settleReject(error);
                return;
            }

            item.once('done', (_doneEvent, state) => {
                if (state === 'completed') {
                    settleResolve({
                        fileName,
                        mediaType,
                        savePath,
                        sourceUrl
                    });
                    return;
                }

                settleReject(new Error(`下载${getContextMediaLabel(mediaType)}失败: ${state}`));
            });
        };

        try {
            if (targetSession && typeof targetSession.on === 'function') {
                targetSession.on('will-download', onWillDownload);
            }
        } catch (error) {
            settleReject(error);
            return;
        }

        try {
            win.webContents.downloadURL(sourceUrl);
        } catch (error) {
            settleReject(error);
        }
    });
}

async function runWatermarkDownloadScript(win) {
    if (!win || !win.webContents || typeof win.webContents.executeJavaScript !== 'function') {
        throw new Error('浏览器上下文不可用');
    }

    const scriptPath = resolveWatermarkDownloadScriptPath();
    if (!scriptPath) {
        throw new Error('未找到去水印下载脚本');
    }

    const script = await fs.promises.readFile(scriptPath, 'utf8');
    await win.webContents.executeJavaScript(script, true);
    return scriptPath;
}

function installBuiltinBrowserContextMenu(win) {
    if (!win || !win.webContents || typeof win.webContents.on !== 'function') {
        return;
    }

    win.webContents.on('context-menu', (event, params) => {
        const canGoBack = typeof win.webContents.canGoBack === 'function' && win.webContents.canGoBack();
        const canGoForward = typeof win.webContents.canGoForward === 'function' && win.webContents.canGoForward();
        const currentUrl = String(typeof win.webContents.getURL === 'function' ? win.webContents.getURL() : params?.pageURL || '').trim();
        const hasElementPosition = Number.isFinite(Number(params?.x)) && Number.isFinite(Number(params?.y));
        const openDevToolsAndInspect = () => {
            try {
                if (!win.isDestroyed?.()) {
                    if (!win.webContents.isDevToolsOpened()) {
                        win.webContents.openDevTools({ mode: 'bottom' });
                    }
                    if (hasElementPosition && typeof win.webContents.inspectElement === 'function') {
                        setTimeout(() => {
                            try {
                                if (!win.isDestroyed?.()) {
                                    win.webContents.inspectElement(Number(params.x), Number(params.y));
                                }
                            } catch (_error) {
                            }
                        }, 50);
                    }
                }
            } catch (_error) {
            }
        };
        const menuTemplate = [
            {
                label: '后退',
                enabled: canGoBack,
                click: () => {
                    try {
                        win.webContents.goBack();
                    } catch (_error) {
                    }
                }
            },
            {
                label: '前进',
                enabled: canGoForward,
                click: () => {
                    try {
                        win.webContents.goForward();
                    } catch (_error) {
                    }
                }
            },
            {
                label: '检查元素',
                enabled: hasElementPosition,
                click: openDevToolsAndInspect
            },
            {
                label: '刷新',
                click: () => {
                    try {
                        win.webContents.reload();
                    } catch (_error) {
                    }
                }
            },
            { type: 'separator' },
            {
                label: '复制当前网址',
                enabled: Boolean(currentUrl),
                click: () => {
                    try {
                        clipboard.writeText(currentUrl);
                    } catch (_error) {
                    }
                }
            }
        ];

        try {
            const menu = Menu.buildFromTemplate(menuTemplate);
            menu.popup({
                window: win
            });
        } catch (error) {
            console.warn(`[builtin-browser] 打开右键菜单失败: ${error.message}`);
        }

        event.preventDefault();
    });
}

if (userDataDir) {
    try {
        app.setPath('userData', userDataDir);
    } catch (_error) {
    }
}

try {
    if (remoteDebuggingPort) {
        app.commandLine.appendSwitch('remote-debugging-port', remoteDebuggingPort);
    }
} catch (_error) {
}

try {
    Menu.setApplicationMenu(null);
} catch (_error) {
}

app.on('web-contents-created', (_event, contents) => {
    if (!contents || typeof contents.setWindowOpenHandler !== 'function') {
        return;
    }

    contents.setWindowOpenHandler((details = {}) => {
        if (isBuiltinBrowserCommandUrl(details.url)) {
            const command = parseBuiltinBrowserCommandUrl(details.url);
            const targetWindowId = Number(command?.params?.windowId || command?.params?.window_id || 0);
            if (command && command.action === 'switch' && Number.isFinite(targetWindowId) && targetWindowId > 0) {
                const targetWindow = BrowserWindow.getAllWindows().find((win) => Number(win?.id || 0) === targetWindowId);
                if (targetWindow && !targetWindow.isDestroyed()) {
                    try {
                        if (targetWindow.isMinimized()) {
                            targetWindow.restore();
                        }
                        targetWindow.show();
                        targetWindow.focus();
                    } catch (_error) {
                    }
                }
                void syncBuiltinBrowserChromeState({ activeWindowId: targetWindowId });
            } else if (command && command.action === 'close' && Number.isFinite(targetWindowId) && targetWindowId > 0) {
                const targetWindow = BrowserWindow.getAllWindows().find((win) => Number(win?.id || 0) === targetWindowId);
                if (targetWindow && !targetWindow.isDestroyed()) {
                    try {
                        targetWindow.close();
                    } catch (_error) {
                    }
                }
                void syncBuiltinBrowserChromeState();
            } else if (command && (command.action === 'new' || command.action === 'new-tab')) {
                const newWindow = createBuiltinBrowserWindow({
                    show: false,
                    skipTaskbar: true,
                    loadUrl: 'about:blank'
                });
                if (newWindow) {
                    void syncBuiltinBrowserChromeState({ activeWindowId: Number(newWindow.id || 0) });
                }
            }

            return { action: 'deny' };
        }

        return {
            action: 'allow',
            overrideBrowserWindowOptions: offscreen
                ? {
                    x: -32000,
                    y: -32000,
                    show: false,
                    skipTaskbar: true,
                    autoHideMenuBar: true,
                    backgroundColor: '#ffffff'
                }
                : {
                    show: false,
                    skipTaskbar: true,
                    autoHideMenuBar: true,
                    backgroundColor: '#ffffff'
                }
        };
    });

    if (typeof contents.on === 'function') {
        contents.on('did-create-window', (childWindow, details = {}) => {
            if (!childWindow || childWindow.isDestroyed?.()) {
                return;
            }

            const includeInTabStrip = !isBuiltinBrowserAuxiliaryWindow(childWindow, details);
            registerBuiltinBrowserWindow(childWindow, {
                includeInTabStrip
            });

            installDevToolsShortcuts(childWindow);
            installBuiltinBrowserContextMenu(childWindow);

            if (includeInTabStrip) {
                void syncBuiltinBrowserChromeState({ activeWindowId: Number(childWindow.id || 0) });
            } else {
                void syncBuiltinBrowserChromeState();
            }
        });
    }
});

function createBuiltinBrowserWindow(options = {}) {
    const shouldShow = options.show !== undefined ? options.show !== false : visible;
    const shouldSkipTaskbar = options.skipTaskbar !== undefined
        ? options.skipTaskbar === true
        : offscreen || shouldShow !== true;
    const loadUrl = String(options.loadUrl || 'about:blank').trim() || 'about:blank';
    const bounds = resolveBuiltinBrowserWindowBounds(options);
    const preloadPath = String(process.env.BUILTIN_ELECTRON_BRIDGE_PRELOAD_PATH || '').trim();

    const win = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        show: shouldShow,
        skipTaskbar: shouldSkipTaskbar,
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        devTools: true,
        title: String(options.title || '内置浏览器'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            nativeWindowOpen: true,
            backgroundThrottling: false,
            ...(preloadPath ? { preload: preloadPath } : {})
        }
    });

    if (typeof win.removeMenu === 'function') {
        win.removeMenu();
    }

    registerBuiltinBrowserWindow(win, {
        includeInTabStrip: options.includeInTabStrip !== false
    });
    installDevToolsShortcuts(win);
    installBuiltinBrowserContextMenu(win);
    win.loadURL(loadUrl).catch(() => {});

    const autoOpenDevTools = String(process.env.BUILTIN_ELECTRON_DEVTOOLS_AUTO_OPEN || '0').trim() === '1';
    if (autoOpenDevTools) {
        const openWhenReady = () => {
            try {
                            if (!win.isDestroyed() && !win.webContents.isDevToolsOpened()) {
                                win.webContents.openDevTools({ mode: 'bottom' });
                            }
            } catch (_error) {
            }
        };

        if (typeof win.isReadyToShow === 'function' && win.isReadyToShow()) {
            openWhenReady();
        } else {
            win.once('ready-to-show', openWhenReady);
        }
    }

    if (shouldShow && typeof win.once === 'function') {
        win.once('ready-to-show', () => {
            if (!win.isDestroyed()) {
                win.show();
                win.focus();
            }
        });
    }

    openWindows.add(win);
    win.on('closed', () => {
        openWindows.delete(win);
    });

    return win;
}

function createBuiltinWindow() {
    return createBuiltinBrowserWindow({
        show: visible,
        skipTaskbar: offscreen,
        includeInTabStrip: true,
        loadUrl: 'about:blank',
        title: '内置浏览器'
    });
}

app.whenReady().then(() => {
    installResponseHeaderFilter();
    createBuiltinWindow();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createBuiltinWindow();
    }
});

app.on('will-quit', () => {
    try {
        if (globalShortcut && typeof globalShortcut.unregisterAll === 'function') {
            globalShortcut.unregisterAll();
        }
    } catch (_error) {
    }
});
