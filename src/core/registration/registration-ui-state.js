const { getRegistrationTcpRuntimeInfo } = require('./tcp-control');

const ALLOWED_REGISTER_CARD_NAMES = new Set([
    '国际版即梦注册卡片'
]);

function normalizeRegistrationCardMode(cardMode = 'register') {
    return cardMode === 'test' || cardMode === 'haikaBind' ? cardMode : 'register';
}

function getCurrentCardNameForMode(app, cardMode = 'register') {
    const mode = normalizeRegistrationCardMode(cardMode);

    if (mode === 'test') {
        return String(app?.currentTestCardName || app?.currentTestCard || '').trim();
    }

    if (mode === 'haikaBind') {
        return String(app?.currentHaikaBindCardName || app?.currentHaikaBindCard || '').trim();
    }

    return String(app?.currentCardName || app?.currentCard || '').trim();
}

function isAllowedRegistrationCardName(cardName) {
    const normalized = String(cardName || '').trim();
    if (!normalized) {
        return false;
    }

    return ALLOWED_REGISTER_CARD_NAMES.has(normalized);
}

function isUnlimitedRegistrationCardAccess(appOrOptions = {}) {
    const source = appOrOptions && typeof appOrOptions === 'object' ? appOrOptions : {};
    return source?.licenseUsageSnapshot?.unlimited === true
        || source?.currentCardUsageSnapshot?.unlimited === true
        || source?.usageInfo?.unlimited === true
        || source?.unlimitedRegistrationCardAccess === true
        || source?.allowAllRegistrationCards === true;
}

function filterRegistrationCards(cards = [], cardMode = 'register', appOrOptions = {}) {
    const mode = normalizeRegistrationCardMode(cardMode);
    const list = Array.isArray(cards) ? cards : [];

    if (mode !== 'register') {
        return list;
    }

    if (isUnlimitedRegistrationCardAccess(appOrOptions)) {
        return list;
    }

    return list.filter((card) => isAllowedRegistrationCardName(card?.name));
}

async function loadRegistrationCardsForMode(app, cardMode = 'register', options = {}) {
    const mode = normalizeRegistrationCardMode(cardMode);
    const loadOptions = options && typeof options === 'object' ? options : {};

    if (!app?.cardManager) {
        return [];
    }

    if (mode === 'test' && typeof app.cardManager.loadTestCards === 'function') {
        return await app.cardManager.loadTestCards(loadOptions);
    }

    if (mode === 'haikaBind' && typeof app.cardManager.loadHaikaBindCards === 'function') {
        return await app.cardManager.loadHaikaBindCards(loadOptions);
    }

    const cards = await app.cardManager.loadCards(loadOptions);
    return filterRegistrationCards(cards, mode, app);
}

async function buildRegistrationUiState(app, options = {}) {
    const source = options && typeof options === 'object' ? options : {};
    const cardMode = normalizeRegistrationCardMode(source.card_type || source.cardType || source.cardMode || 'register');
    const cards = await loadRegistrationCardsForMode(app, cardMode, source);
    const unlimitedCardAccess = isUnlimitedRegistrationCardAccess(app);
    const currentCardName = cardMode === 'register' && !unlimitedCardAccess && !isAllowedRegistrationCardName(getCurrentCardNameForMode(app, cardMode))
        ? String(cards[0]?.name || '').trim()
        : getCurrentCardNameForMode(app, cardMode);
    const tcpInfo = await getRegistrationTcpRuntimeInfo(app);
    const browserSettings = app?.browserSettings && typeof app.browserSettings === 'object'
        ? { ...app.browserSettings }
        : {};
    const runtimeConfig = typeof app?.readRegistrationRuntimeConfigFromDisk === 'function'
        ? await app.readRegistrationRuntimeConfigFromDisk()
        : {};
    const runtimeBrowserSettings = runtimeConfig && typeof runtimeConfig === 'object'
        ? (runtimeConfig.browserSettings && typeof runtimeConfig.browserSettings === 'object'
            ? runtimeConfig.browserSettings
            : runtimeConfig.browser_settings && typeof runtimeConfig.browser_settings === 'object'
                ? runtimeConfig.browser_settings
                : {})
        : {};
    const logLimit = Number.isFinite(Number(source.log_limit))
        ? Math.max(1, Math.min(2000, Number(source.log_limit)))
        : 200;
    const recentLogs = typeof app?.logger?.getRecentLogs === 'function'
        ? app.logger.getRecentLogs(logLimit)
        : [];
    const browserSourceRaw = String(
        browserSettings.browser_source
        || browserSettings.browserSource
        || browserSettings.browser_type
        || browserSettings.browserType
        || 'local-browser'
    ).trim().toLowerCase();
    const browserSource = browserSourceRaw === 'client-browser' || browserSourceRaw === 'client' || browserSourceRaw === 'host-browser'
            ? 'client-browser'
            : 'local-browser';

    return {
        enabled: tcpInfo.registrationTcpEnabled === true,
        running: tcpInfo.registrationTcpEnabled === true,
        connected: tcpInfo.registrationTcpConnectionStatus?.connected === true,
        cards,
        console_logs: Array.isArray(recentLogs) ? recentLogs : [],
        consoleLogs: Array.isArray(recentLogs) ? recentLogs : [],
        currentCardName,
        currentCard: currentCardName,
        current_card_name: currentCardName,
        current_card: currentCardName,
        cardType: cardMode,
        card_type: cardMode,
        browser_settings: browserSettings,
        browserSettings,
        browser_type: browserSettings.browser_type || browserSettings.browserType || app?.currentBrowserType || '',
        browser_source: browserSource,
        browserSource,
        run_mode: Number.isFinite(Number(browserSettings.run_mode)) ? Number(browserSettings.run_mode) : 0,
        concurrent_count: Number.isFinite(Number(browserSettings.concurrent_count)) ? Number(browserSettings.concurrent_count) : 1,
        registrationRuntimeConfig: runtimeConfig,
        registration_runtime_config: runtimeConfig,
        runtimeConfig,
        runtime_config: runtimeConfig,
        registrationRuntimeBrowserSettings: runtimeBrowserSettings,
        registration_runtime_browser_settings: runtimeBrowserSettings,
        ...tcpInfo,
        options: source
    };
}

module.exports = {
    ALLOWED_REGISTER_CARD_NAMES,
    filterRegistrationCards,
    normalizeRegistrationCardMode,
    getCurrentCardNameForMode,
    isAllowedRegistrationCardName,
    isUnlimitedRegistrationCardAccess,
    loadRegistrationCardsForMode,
    buildRegistrationUiState
};
