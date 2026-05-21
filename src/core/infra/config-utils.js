const DEFAULT_TCP_SERVER_URL = '127.0.0.1:58113';

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

function normalizeTcpServerUrl(value, fallback = DEFAULT_TCP_SERVER_URL) {
    const text = String(value || '').trim().replace(/\/+$/, '');
    if (!text) {
        return fallback;
    }

    const stripped = text
        .replace(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//, '')
        .replace(/^\/+/, '')
        .trim();
    if (!stripped) {
        return fallback;
    }

    return stripped.split('/')[0] || fallback;
}

function stripObjectKeys(source = {}, keys = []) {
    const target = source && typeof source === 'object' && !Array.isArray(source)
        ? { ...source }
        : {};

    for (const key of Array.isArray(keys) ? keys : []) {
        delete target[key];
    }

    return target;
}

function stripBrowserSettingsCompatFields(browserSettings = {}) {
    return stripObjectKeys(browserSettings, [
        'browserType',
        'browserSource',
        'browser_region',
        'headlessMode',
        'blockImagesVideos',
        'syncExecution',
        'maxProxyRecoveryAttempts',
        'registrationAutoUpload',
        'removeWatermarkPlugin',
        'saveLocalCookie',
        'skipCookieSave',
        'skip_cookie_save',
        'concurrentCount',
        'runMode',
        'timedRegistrationCount',
        'timedRegistrationCycleCount',
        'timedRegistrationStartMode',
        'timedRegistrationDelaySeconds'
    ]);
}

function stripRuntimeConfigCompatFields(runtimeConfig = {}) {
    const target = stripObjectKeys(runtimeConfig, [
        'browserType',
        'browserSource',
        'browser_display_mode',
        'browserDisplayMode',
        'registration_headless_mode',
        'registrationHeadlessMode',
        'registration_run_mode',
        'registrationRunMode',
        'registration_timed_count',
        'registrationTimedCount',
        'registration_timed_cycle_count',
        'registrationTimedCycleCount',
        'registration_timed_start_mode',
        'registrationTimedStartMode',
        'registration_timed_delay_seconds',
        'registrationTimedDelaySeconds',
        'browser_type',
        'browser_source',
        'browser_display_mode',
        'registration_headless_mode',
        'registration_run_mode',
        'registration_timed_count',
        'registration_timed_cycle_count',
        'registration_timed_start_mode',
        'registration_timed_delay_seconds',
        'run_mode',
        'concurrentCount',
        'concurrent_count',
        'runMode',
        'sync_execution',
        'syncEnabled',
        'syncExecution',
        'max_proxy_recovery_attempts',
        'maxProxyRecoveryAttempts',
        'registration_auto_upload',
        'registrationAutoUpload',
        'registration_save_local_cookie',
        'save_local_cookie',
        'registrationSaveLocalCookie',
        'saveLocalCookie',
        'skip_cookie_save',
        'skipCookieSave',
        'browserType',
        'browserSource',
        'browser_settings',
        'tcp_server_url',
        'tcpServerUrl',
        'tcp_auto_reconnect_enabled',
        'tcpAutoReconnectEnabled',
        'registration_tcp_auto_reconnect_enabled',
        'registrationTcpAutoReconnectEnabled'
    ]);

    if (target.browserSettings && typeof target.browserSettings === 'object') {
        target.browserSettings = stripBrowserSettingsCompatFields(target.browserSettings);
    }

    delete target.browser_settings;
    return target;
}

function stripTcpConfigCompatFields(config = {}) {
    return stripObjectKeys(config, [
        'tcpServerUrl',
        'tcpAutoReconnectEnabled',
        'registration_tcp_auto_reconnect_enabled',
        'registrationTcpAutoReconnectEnabled'
    ]);
}

function stripEmailConfigCompatFields(config = {}) {
    return stripObjectKeys(config, [
        'emailHost',
        'emailPort',
        'emailSuffix'
    ]);
}

module.exports = {
    DEFAULT_TCP_SERVER_URL,
    normalizeBooleanValue,
    normalizeTcpServerUrl,
    stripObjectKeys,
    stripBrowserSettingsCompatFields,
    stripRuntimeConfigCompatFields,
    stripTcpConfigCompatFields,
    stripEmailConfigCompatFields
};
