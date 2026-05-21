const {
    BLOCKED_ASSET_RESOURCE_TYPES,
    BLOCKED_ASSET_URL_PATTERN
} = require('./browser-manager-helpers');

const CAPTCHA_ASSET_ALLOW_HOSTS = [
    'google.com',
    'gstatic.com',
    'recaptcha.net',
    'hcaptcha.com',
    'challenges.cloudflare.com',
    'cloudflare.com',
    'arkoselabs.com',
    'funcaptcha.com',
    'geetest.com',
    'captcha-delivery.com',
    'datadome.co'
];

const CAPTCHA_ASSET_ALLOW_PATH_PATTERN = /(?:captcha|recaptcha|hcaptcha|turnstile|funcaptcha|arkose|geetest|datadome|challenge-platform|cf-chl)/i;

module.exports = {
    _isChromiumFamilyBrowser(browserType = 'chromium') {
        const normalizedType = String(browserType || '').trim().toLowerCase();
        return ['chromium', 'chrome', 'edge', 'system', 'electron'].includes(normalizedType);
    },

    _isWatermarkExtensionEnabled(browserSettings = {}) {
        if (browserSettings.remove_watermark_plugin === false || browserSettings.removeWatermarkPlugin === false) {
            return false;
        }

        return true;
    },

    _isCookieCaptureExtensionEnabled(browserSettings = {}) {
        if (browserSettings.cookie_capture_plugin === false || browserSettings.cookieCapturePlugin === false) {
            return false;
        }

        return true;
    },

    _isCaptchaCompatibilityModeEnabled(browserSettings = {}) {
        return browserSettings.captcha_compatibility_mode === true
            || browserSettings.captcha_compatibility_mode === 'true'
            || browserSettings.captchaCompatibilityMode === true
            || browserSettings.captchaCompatibilityMode === 'true';
    },

    _buildBrowserProfile(browserType = 'chromium', browserVersion = '', browserSettings = {}) {
        let viewport = browserSettings.viewport;
        if (!viewport || typeof viewport !== 'object') {
            const width = parseInt(browserSettings.viewport_width || browserSettings.window_width, 10);
            const height = parseInt(browserSettings.viewport_height || browserSettings.window_height, 10);

            if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
                viewport = { width, height };
            } else {
                viewport = { width: 1366, height: 768 };
            }
        }

        const screen = browserSettings.screen && typeof browserSettings.screen === 'object'
            ? browserSettings.screen
            : {
                width: viewport.width,
                height: viewport.height,
                availWidth: viewport.width,
                availHeight: viewport.height,
                availLeft: 0,
                availTop: 0,
                colorDepth: 24,
                pixelDepth: 24
            };

        return {
            browserType,
            browserVersion,
            viewport,
            screen
        };
    },

    _applyBrowserVersionToProfile(browserProfile = null, browserVersion = '') {
        if (!browserProfile || typeof browserProfile !== 'object') {
            return null;
        }

        const normalizedBrowserVersion = String(browserVersion || '').trim();
        if (!normalizedBrowserVersion) {
            return browserProfile;
        }

        browserProfile.browserVersion = normalizedBrowserVersion;
        return browserProfile;
    },

    _isImageVideoBlockingEnabled(browserSettings = {}) {
        if (this._isCaptchaCompatibilityModeEnabled(browserSettings)) {
            return false;
        }

        return browserSettings.block_images_videos === true || browserSettings.block_images_videos === 'true';
    },

    _isCaptchaAssetRequest(request) {
        if (!request || typeof request.url !== 'function') {
            return false;
        }

        const url = String(request.url() || '').trim();
        if (!url) {
            return false;
        }

        try {
            const parsed = new URL(url);
            const host = String(parsed.hostname || '').toLowerCase();
            if (CAPTCHA_ASSET_ALLOW_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`))) {
                return true;
            }

            return CAPTCHA_ASSET_ALLOW_PATH_PATTERN.test(`${parsed.hostname}${parsed.pathname}${parsed.search}`);
        } catch (_error) {
            return CAPTCHA_ASSET_ALLOW_PATH_PATTERN.test(url);
        }
    },

    _shouldBlockImageVideoRequest(request) {
        if (!request) {
            return false;
        }

        if (this._isCaptchaAssetRequest(request)) {
            return false;
        }

        const resourceType = typeof request.resourceType === 'function'
            ? String(request.resourceType() || '').toLowerCase()
            : '';
        if (BLOCKED_ASSET_RESOURCE_TYPES.has(resourceType)) {
            return true;
        }

        const url = typeof request.url === 'function'
            ? String(request.url() || '').toLowerCase()
            : '';
        return BLOCKED_ASSET_URL_PATTERN.test(url);
    },

    async _applyImageVideoRequestBlocking(context, browserSettings = {}) {
        if (!this._isImageVideoBlockingEnabled(browserSettings) || !context || typeof context.route !== 'function') {
            return false;
        }

        try {
            await context.route('**/*', async (route) => {
                const request = route.request();
                if (this._shouldBlockImageVideoRequest(request)) {
                    return route.abort('blockedbyclient');
                }

                return route.continue();
            });

            this.logger.info('已启用图片/视频请求拦截');
            return true;
        } catch (error) {
            this.logger.warning(`启用图片/视频请求拦截失败: ${error.message}`);
            return false;
        }
    }
};
