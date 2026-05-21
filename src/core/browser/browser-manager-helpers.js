const path = require('path');
const os = require('os');
const fs = require('fs');
const { app } = require('electron');

function loadPlaywrightChromium() {
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
            if (mod && mod.chromium) {
                return mod.chromium;
            }
        } catch (error) {
            errors.push(`${candidate}: ${error.message}`);
        }
    }

    throw new Error(`无法加载 Playwright Chromium: ${errors.join(' | ')}`);
}

const chromium = loadPlaywrightChromium();

const BLOCKED_ASSET_RESOURCE_TYPES = new Set(['image', 'media']);
const BLOCKED_ASSET_URL_PATTERN = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|mp4|m4v|mov|webm|mkv|avi|flv|wmv|m3u8|mpd)(?:[?#].*)?$/i;

function resolveBuiltinExtensionPath(extensionName = '') {
    const normalizedName = String(extensionName || '').trim();
    if (!normalizedName) {
        return '';
    }

    const appRoot = app && typeof app.getAppPath === 'function'
        ? app.getAppPath()
        : process.cwd();

    const candidates = [
        path.join(process.cwd(), 'extensions', normalizedName),
        process.resourcesPath ? path.join(process.resourcesPath, 'extensions', normalizedName) : null,
        path.join(appRoot, 'extensions', normalizedName)
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            const manifestPath = path.join(candidate, 'manifest.json');
            if (fs.existsSync(candidate) && fs.existsSync(manifestPath)) {
                return candidate;
            }
        } catch (_error) {
        }
    }

    return '';
}

function resolveBuiltinWatermarkExtensionPath() {
    return resolveBuiltinExtensionPath('remove_watermark');
}

function resolveBuiltinCookieCaptureExtensionPath() {
    return resolveBuiltinExtensionPath('cookie_capture');
}

function resolveBrowserResourcePath(resourceName = '') {
    const normalizedName = String(resourceName || '').trim();
    const candidatePaths = [];

    if (normalizedName) {
        candidatePaths.push(
            path.join(__dirname, 'resources', normalizedName),
            path.join(__dirname, '..', normalizedName)
        );
    } else {
        candidatePaths.push(path.join(__dirname, 'resources'));
    }

    for (const candidatePath of candidatePaths) {
        try {
            if (fs.existsSync(candidatePath)) {
                return candidatePath;
            }
        } catch (_error) {
        }
    }

    return candidatePaths[0] || path.join(__dirname, 'resources', normalizedName);
}

function normalizeBrowserSourceValue(value = '', fallback = 'local-browser') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'client-browser' || normalized === 'client' || normalized === 'host-browser') {
        return 'client-browser';
    }
    return String(fallback || '').trim().toLowerCase() === 'client-browser' ? 'client-browser' : 'local-browser';
}

function resolveBrowserDownloadsPath(browserOptions = {}) {
    const explicitDownloadsPath = String(browserOptions.downloadsPath || '').trim();
    if (explicitDownloadsPath) {
        return explicitDownloadsPath;
    }

    try {
        const downloadsPath = String(app.getPath('downloads') || '').trim();
        if (downloadsPath) {
            return downloadsPath;
        }
    } catch (_error) {
    }

    return path.join(os.homedir(), 'Downloads');
}

function buildSandboxLaunchArgs() {
    if (process.platform !== 'linux') {
        return [];
    }

    return [
        '--no-sandbox',
        '--disable-setuid-sandbox'
    ];
}

module.exports = {
    chromium,
    BLOCKED_ASSET_RESOURCE_TYPES,
    BLOCKED_ASSET_URL_PATTERN,
    resolveBuiltinExtensionPath,
    resolveBuiltinWatermarkExtensionPath,
    resolveBuiltinCookieCaptureExtensionPath,
    resolveBrowserResourcePath,
    normalizeBrowserSourceValue,
    resolveBrowserDownloadsPath,
    buildSandboxLaunchArgs
};
