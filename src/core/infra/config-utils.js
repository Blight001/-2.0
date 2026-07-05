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
        'executionAutoUpload',
        'registrationAutoUpload',
        'removeWatermarkPlugin',
        'saveLocalCookie',
        'skipCookieSave',
        'skip_cookie_save',
        'concurrentCount',
        'runMode',
        'timedExecutionCount',
        'timedRegistrationCount',
        'timedExecutionCycleCount',
        'timedRegistrationCycleCount',
        'timedExecutionStartMode',
        'timedRegistrationStartMode',
        'timedExecutionDelaySeconds',
        'timedRegistrationDelaySeconds'
    ]);
}

function stripRuntimeConfigCompatFields(runtimeConfig = {}) {
    const target = stripObjectKeys(runtimeConfig, [
        'browserType',
        'browserSource',
        'browser_display_mode',
        'browserDisplayMode',
        'execution_headless_mode',
        'executionHeadlessMode',
        'registration_headless_mode',
        'registrationHeadlessMode',
        'execution_run_mode',
        'executionRunMode',
        'registration_run_mode',
        'registrationRunMode',
        'execution_timed_count',
        'executionTimedCount',
        'registration_timed_count',
        'registrationTimedCount',
        'execution_timed_cycle_count',
        'executionTimedCycleCount',
        'registration_timed_cycle_count',
        'registrationTimedCycleCount',
        'execution_timed_start_mode',
        'executionTimedStartMode',
        'registration_timed_start_mode',
        'registrationTimedStartMode',
        'execution_timed_delay_seconds',
        'executionTimedDelaySeconds',
        'registration_timed_delay_seconds',
        'registrationTimedDelaySeconds',
        'browser_type',
        'browser_source',
        'browser_display_mode',
        'run_mode',
        'concurrentCount',
        'concurrent_count',
        'runMode',
        'sync_execution',
        'syncEnabled',
        'syncExecution',
        'max_proxy_recovery_attempts',
        'maxProxyRecoveryAttempts',
        'execution_auto_upload',
        'executionAutoUpload',
        'registration_auto_upload',
        'registrationAutoUpload',
        'execution_save_local_cookie',
        'save_local_cookie',
        'executionSaveLocalCookie',
        'registration_save_local_cookie',
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
        'execution_tcp_auto_reconnect_enabled',
        'executionTcpAutoReconnectEnabled',
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
        'execution_tcp_auto_reconnect_enabled',
        'executionTcpAutoReconnectEnabled',
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
    normalizeBooleanValue,
    normalizeTcpServerUrl,
    stripObjectKeys,
    stripBrowserSettingsCompatFields,
    stripRuntimeConfigCompatFields,
    stripTcpConfigCompatFields,
    stripEmailConfigCompatFields
};
