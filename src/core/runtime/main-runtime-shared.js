const { loadAutomationCardsForMode } = require('../execution/execution-ui-state');
const {
    cloneRegistrationCardConfig,
    toPositiveInteger
} = require('./main-runtime-utils');

module.exports = {
    async loadCards() {
        try {
            const cards = await loadAutomationCardsForMode(this, 'automation');
            if (this.mainWindow) {
                this.mainWindow.webContents.send('cards-loaded', cards);
            }
            this.logger.debug?.(`自动化卡片已同步: ${cards.length} 个`);
            return cards;
        } catch (error) {
            this.logger.error(`加载卡片失败: ${error.message}`);
            return [];
        }
    },

    _getRegistrationModeLabel(runMode = this.runMode) {
        if (runMode === 2) {
            return '定时执行';
        }
        if (runMode === 1) {
            return '循环运行';
        }
        return '单次运行';
    },

    _getTimedRegistrationTaskLabel() {
        return '定时执行任务';
    },

    _getTimedRegistrationBatchLabel() {
        return '定时执行批次';
    },

    _resolveRegistrationStartConfig(config = {}) {
        const input = config && typeof config === 'object' ? config : {};
        const runtimePlan = cloneRegistrationCardConfig(this.registrationDefaultExecutionPlan) || {};
        const planBrowserSettings = cloneRegistrationCardConfig(runtimePlan.browser_settings || runtimePlan.browserSettings) || {};
        const inputBrowserSettings = cloneRegistrationCardConfig(input.browserSettings || input.browser_settings) || {};
        const browserSettings = {
            ...planBrowserSettings,
            ...inputBrowserSettings
        };
        const resolveSaveLocalCookie = (...values) => {
            for (const value of values) {
                if (value === undefined || value === null || value === '') {
                    continue;
                }
                if (typeof value === 'boolean') {
                    return value;
                }
                const normalized = String(value).trim().toLowerCase();
                if (['1', 'true', 'yes', 'on'].includes(normalized)) {
                    return true;
                }
                if (['0', 'false', 'no', 'off'].includes(normalized)) {
                    return false;
                }
            }
            return false;
        };

        const browserType = String(
            planBrowserSettings.browser_type
            || planBrowserSettings.browserType
            || runtimePlan.browser_type
            || runtimePlan.browserType
            || input.browserType
            || input.browser_type
            || inputBrowserSettings.browser_type
            || inputBrowserSettings.browserType
            || this.currentBrowserType
            || ''
        ).trim();
        if (browserType) {
            browserSettings.browser_type = browserType;
            browserSettings.browserType = browserType;
        }

        const runMode = Number.isFinite(Number(input.runMode))
            ? Number(input.runMode)
            : Number.isFinite(Number(runtimePlan.runMode))
                ? Number(runtimePlan.runMode)
                : Number.isFinite(Number(browserSettings.run_mode))
                    ? Number(browserSettings.run_mode)
                    : 0;
        const concurrentCount = toPositiveInteger(
            Number.isFinite(Number(input.concurrentCount))
                ? input.concurrentCount
                : Number.isFinite(Number(runtimePlan.concurrentCount))
                    ? runtimePlan.concurrentCount
                    : browserSettings.concurrent_count,
            1,
            1,
            99
        );
        const syncEnabled = typeof runtimePlan.syncEnabled === 'boolean'
            ? (typeof input.syncEnabled === 'boolean' ? input.syncEnabled : runtimePlan.syncEnabled)
            : typeof input.syncEnabled === 'boolean'
                ? input.syncEnabled
                : browserSettings.sync_execution !== false;
        const saveLocalCookie = resolveSaveLocalCookie(
            input.saveLocalCookie,
            input.save_local_cookie,
            input.skipCookieSave === true ? false : undefined,
            runtimePlan.saveLocalCookie,
            runtimePlan.save_local_cookie,
            browserSettings.save_local_cookie,
            browserSettings.saveLocalCookie,
            browserSettings.skip_cookie_save === true ? false : undefined
        );
        const maxProxyRecoveryAttempts = toPositiveInteger(
            Number.isFinite(Number(input.maxProxyRecoveryAttempts))
                ? input.maxProxyRecoveryAttempts
                : Number.isFinite(Number(runtimePlan.maxProxyRecoveryAttempts))
                    ? runtimePlan.maxProxyRecoveryAttempts
                    : browserSettings.max_proxy_recovery_attempts,
            3,
            1,
            20
        );
        const timedRegistrationCount = toPositiveInteger(
            Number.isFinite(Number(input.timedRegistrationCount))
                ? input.timedRegistrationCount
                : Number.isFinite(Number(runtimePlan.timedRegistrationCount))
                    ? runtimePlan.timedRegistrationCount
                    : browserSettings.timed_registration_count,
            1,
            1,
            99999
        );
        const timedRegistrationCycleCount = toPositiveInteger(
            Number.isFinite(Number(input.timedRegistrationCycleCount))
                ? input.timedRegistrationCycleCount
                : Number.isFinite(Number(runtimePlan.timedRegistrationCycleCount))
                    ? runtimePlan.timedRegistrationCycleCount
                    : browserSettings.timed_registration_cycle_count,
            1,
            1,
            99999
        );
        const timedRegistrationStartMode = String(
            input.timedRegistrationStartMode
            || runtimePlan.timedRegistrationStartMode
            || browserSettings.timed_registration_start_mode
            || 'immediate'
        ).trim() === 'delayed' ? 'delayed' : 'immediate';
        const timedRegistrationDelayMs = Number.isFinite(Number(input.timedRegistrationDelayMs))
            ? Number(input.timedRegistrationDelayMs)
            : Number.isFinite(Number(runtimePlan.timedRegistrationDelayMs))
                ? Number(runtimePlan.timedRegistrationDelayMs)
                : Number.isFinite(Number(browserSettings.timed_registration_delay_seconds))
                    ? Number(browserSettings.timed_registration_delay_seconds) * 1000
                    : 0;
        const serverCardName = String(
            runtimePlan.server_card_name
            || runtimePlan.serverCardName
            || input.server_card_name
            || input.serverCardName
            || ''
        ).trim();

        browserSettings.run_mode = runMode;
        browserSettings.concurrent_count = concurrentCount;
        browserSettings.sync_execution = syncEnabled;
        browserSettings.max_proxy_recovery_attempts = maxProxyRecoveryAttempts;
        browserSettings.timed_registration_count = timedRegistrationCount;
        browserSettings.timed_registration_cycle_count = timedRegistrationCycleCount;
        browserSettings.timed_registration_start_mode = timedRegistrationStartMode;
        browserSettings.timed_registration_delay_seconds = Math.max(0, Math.floor(timedRegistrationDelayMs / 1000));
        browserSettings.save_local_cookie = saveLocalCookie;
        browserSettings.saveLocalCookie = saveLocalCookie;
        browserSettings.skip_cookie_save = !saveLocalCookie;
        browserSettings.skipCookieSave = !saveLocalCookie;

        return {
            ...runtimePlan,
            ...input,
            browserType,
            browserSettings,
            browser_settings: browserSettings,
            runMode,
            concurrentCount,
            syncEnabled,
            maxProxyRecoveryAttempts,
            timedRegistrationCount,
            timedRegistrationCycleCount,
            timedRegistrationStartMode,
            timedRegistrationDelayMs,
            saveLocalCookie,
            skipCookieSave: !saveLocalCookie,
            server_card_name: serverCardName,
            serverCardName
        };
    }
};
