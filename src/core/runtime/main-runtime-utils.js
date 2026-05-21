function cloneRegistrationCardConfig(cardConfig = null) {
    if (!cardConfig || typeof cardConfig !== 'object') {
        return null;
    }

    return JSON.parse(JSON.stringify(cardConfig));
}

function toPositiveInteger(value, fallback = 1, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(minimum, Math.min(maximum, parsed));
}

function summarizeRegistrationDefaultExecutionPlan(plan = {}) {
    const source = plan && typeof plan === 'object' ? plan : {};
    const browserSettings = source.browser_settings || source.browserSettings || {};
    const browserSource = String(
        browserSettings.browser_source
        || browserSettings.browserSource
        || browserSettings.browser_type
        || browserSettings.browserType
        || 'local-browser'
    ).trim().toLowerCase();
    const normalizedBrowserSource = browserSource === 'client-browser' || browserSource === 'client' || browserSource === 'host-browser'
            ? 'client-browser'
            : 'local-browser';

    return {
        enabled: source.enabled === true,
        auto_start_registration: source.auto_start_registration === true || source.autoStartRegistration === true,
        server_card_name: String(source.server_card_name || source.serverCardName || '').trim(),
        control_locked: source.control_locked === true || source.controlLocked === true,
        browser_settings: {
            browser_type: String(browserSettings.browser_type || browserSettings.browserType || '').trim(),
            browser_source: normalizedBrowserSource,
            headless: browserSettings.headless !== false,
            block_images_videos: browserSettings.block_images_videos === true || browserSettings.block_images_videos === 'true',
            captcha_compatibility_mode: browserSettings.captcha_compatibility_mode === true
                || browserSettings.captcha_compatibility_mode === 'true'
                || browserSettings.captchaCompatibilityMode === true
                || browserSettings.captchaCompatibilityMode === 'true',
            sync_execution: browserSettings.sync_execution !== false,
            max_proxy_recovery_attempts: toPositiveInteger(browserSettings.max_proxy_recovery_attempts, 3, 1, 20),
            registration_auto_upload: browserSettings.registration_auto_upload !== false,
            save_local_cookie: browserSettings.save_local_cookie === true,
            concurrent_count: toPositiveInteger(browserSettings.concurrent_count, 1, 1, 99),
            run_mode: toPositiveInteger(browserSettings.run_mode, 0, 0, 2),
            timed_registration_count: toPositiveInteger(browserSettings.timed_registration_count, 1, 1, 99999),
            timed_registration_cycle_count: toPositiveInteger(browserSettings.timed_registration_cycle_count, 1, 1, 99999),
            timed_registration_start_mode: String(browserSettings.timed_registration_start_mode || '').trim() === 'delayed' ? 'delayed' : 'immediate',
            timed_registration_delay_seconds: toPositiveInteger(browserSettings.timed_registration_delay_seconds, 0, 0, 3600)
        }
    };
}

function normalizeHaikaExpiryDateValue(expiryDate = '') {
    if (expiryDate === null || expiryDate === undefined) {
        return '';
    }

    const raw = String(expiryDate).trim();
    if (!raw) {
        return '';
    }

    const digits = raw.replace(/\D/g, '');
    if (digits.length === 4) {
        return digits;
    }

    const parts = raw.split(/\D+/).filter(Boolean);
    if (parts.length >= 2) {
        const first = parts[0];
        const second = parts[1];

        if (first.length === 4 && second.length <= 2) {
            return `${second.padStart(2, '0')}${first.slice(-2)}`;
        }

        if (first.length <= 2 && second.length === 4) {
            return `${first.padStart(2, '0')}${second.slice(-2)}`;
        }
    }

    return raw;
}

module.exports = {
    cloneRegistrationCardConfig,
    normalizeHaikaExpiryDateValue,
    summarizeRegistrationDefaultExecutionPlan,
    toPositiveInteger
};
