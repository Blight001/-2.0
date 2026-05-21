const EventEmitter = require('events');
const randomHelpers = require('./random');
const runnerHelpers = require('./runner');
const stepHelpers = require('./steps');

class RegistrationThread extends EventEmitter {
    constructor(taskId, cardConfig, managers) {
        super();
        this.taskId = taskId;
        this.cardConfig = cardConfig;
        this.browserManager = managers.browserManager;
        this.app = managers.app || null;
        this.cookieManager = managers.cookieManager;
        this.logger = managers.logger;
        this.emailClient = managers.emailClient;
        this.browserType = managers.browserType || 'electron';
        this.browserSettings = managers.browserSettings || {};
        this.clashManager = managers.clashManager;
        this.synchronizer = managers.synchronizer; // 同步器
        this.contextVariables = managers.contextVariables || {};
        this.initialCookies = Array.isArray(managers.initialCookies) ? managers.initialCookies : [];
        this.debugMode = managers.debugMode || false;
        this.keepBrowserOpen = managers.keepBrowserOpen || false;
        this.debugDefaultStepPauseMs = Number.isFinite(parseInt(managers.debugDefaultStepPauseMs, 10))
            ? Math.max(0, parseInt(managers.debugDefaultStepPauseMs, 10))
            : 1200;
        this.debugStepPauseMs = Number.isFinite(parseInt(managers.debugStepPauseMs, 10))
            ? Math.max(0, parseInt(managers.debugStepPauseMs, 10))
            : 1200;
        this.debugErrorPauseMs = Number.isFinite(parseInt(managers.debugErrorPauseMs, 10))
            ? Math.max(0, parseInt(managers.debugErrorPauseMs, 10))
            : 10000;
        this.cardKeyPrefix = typeof managers.cardKeyPrefix === 'string' ? managers.cardKeyPrefix : '';
        this.applyCardKeyPrefix = managers.applyCardKeyPrefix !== false;
        this.emailSuffix = typeof managers.emailSuffix === 'string' ? managers.emailSuffix : '';
        this.browserId = String(managers.browserId || '').trim();

        // 随机字符串配置拆分为邮箱与卡片两部分
        this.emailRandomConfig = managers.emailRandomConfig
            || managers.randomConfig
            || this.app?.getEmailRandomConfig?.()
            || this.app?.emailRandomConfig
            || {};
        this.randomConfig = this.cardConfig.random || {};

        this.running = true;
        this.generatedEmail = null;
        this.generatedPassword = null;
        this.generatedAccount = null; // 存储随机生成的账号部分
        this.receivedVerificationCode = null;  // 存储获取到的验证码
        this.cookiesSavedByCaptureStep = false;
        this.currentStep = "初始化中...";
        this.points = 0;
        this.stopReason = '';
        this.browserClosed = false;
        this.debugState = {
            active: false,
            paused: false,
            pauseRequested: false,
            awaitingRunMode: false,
            runMode: '',
            pauseReason: '',
            currentStepName: '',
            currentStepIndex: -1,
            totalSteps: 0,
            progress: 0,
            message: '',
            statusText: '未开始',
            canPause: true,
            canResume: false,
            completed: false,
            error: ''
        };
        this._debugPauseResolver = null;
        this._debugPausePromise = null;
        this._debugRunModeResolver = null;
        this._debugRunModePromise = null;
        this._browserLifecycleBound = false;
        this._browserLifecycleCleanup = [];
        this._boundBrowserPages = new WeakSet();
        this._finalizing = false;
        this._lastStopLogMessage = '';
        this._lastBrowserClosedLog = '';

        // 每个任务保存自己的凭据映射，避免多个线程间冲突
        this.credentials = {
            'email': this.cardConfig.email || '',
            'password': this.cardConfig.password || ''
        };

        // 如果卡片配置中的邮箱或密码包含 {random}，在任务初始化时就生成一次随机值并固定下来
        this._initializeRandomCredentials();
    }

    _getCardKeyPrefix() { return randomHelpers._getCardKeyPrefix.call(this); }
    _getCharsetGroup(type) { return randomHelpers._getCharsetGroup.call(this, type); }
    _getRandomCharFromCharset(charset) { return randomHelpers._getRandomCharFromCharset.call(this, charset); }
    _shuffleCharacters(characters) { return randomHelpers._shuffleCharacters.call(this, characters); }
    _generatePasswordFromGroups(length, groupTypes) { return randomHelpers._generatePasswordFromGroups.call(this, length, groupTypes); }
    _applyCardKeyPrefixToEmail(email) { return randomHelpers._applyCardKeyPrefixToEmail.call(this, email); }
    _applyCardKeyPrefixToCredentials() { return randomHelpers._applyCardKeyPrefixToCredentials.call(this); }
    _getEmailSuffix() { return randomHelpers._getEmailSuffix.call(this); }
    _applyEmailSuffixToEmail(email) { return randomHelpers._applyEmailSuffixToEmail.call(this, email); }
    _applyEmailSuffixToCredentials() { return randomHelpers._applyEmailSuffixToCredentials.call(this); }
    _initializeRandomCredentials() { return randomHelpers._initializeRandomCredentials.call(this); }
    _generateRandomStringByConfig(config) { return randomHelpers._generateRandomStringByConfig.call(this, config); }
    _generateRandomString(length) { return randomHelpers._generateRandomString.call(this, length); }
    _generateRandomPassword(length) { return randomHelpers._generateRandomPassword.call(this, length); }
    _getErrorText(error) { return stepHelpers._getErrorText.call(this, error); }
    _isBrowserClosedError(error) { return stepHelpers._isBrowserClosedError.call(this, error); }
    _markTaskStopped(reason = '', options = {}) { return stepHelpers._markTaskStopped.call(this, reason, options); }
    _markBrowserClosed(reason = '', options = {}) { return stepHelpers._markBrowserClosed.call(this, reason, options); }
    _cancelDebugWaiters(reason = '') { return stepHelpers._cancelDebugWaiters.call(this, reason); }
    _normalizeRuntimeError(error, context = '') { return stepHelpers._normalizeRuntimeError.call(this, error, context); }
    async _ensureBrowserAvailable(context = '') { return stepHelpers._ensureBrowserAvailable.call(this, context); }
    async _sleepInterruptibly(ms, context = '', intervalMs = 100) { return stepHelpers._sleepInterruptibly.call(this, ms, context, intervalMs); }
    _getDebugState() { return stepHelpers._getDebugState.call(this); }
    _emitDebugState(patch = {}) { return stepHelpers._emitDebugState.call(this, patch); }
    _requestDebugPause(reason = 'manual', meta = {}) { return stepHelpers._requestDebugPause.call(this, reason, meta); }
    _resumeDebug(reason = 'manual') { return stepHelpers._resumeDebug.call(this, reason); }
    _setDebugRunMode(mode = '') { return stepHelpers._setDebugRunMode.call(this, mode); }
    _setDebugContinueMode(mode = '') { return stepHelpers._setDebugContinueMode.call(this, mode); }
    _setDebugStepNavigation(direction = '') { return stepHelpers._setDebugStepNavigation.call(this, direction); }
    async _waitForDebugRunModeSelection(context = '') { return stepHelpers._waitForDebugRunModeSelection.call(this, context); }
    async _waitForDebugResume(context = '') { return stepHelpers._waitForDebugResume.call(this, context); }
    async _enterDebugPause(options = {}) { return stepHelpers._enterDebugPause.call(this, options); }
    async _bindBrowserLifecycle() { return stepHelpers._bindBrowserLifecycle.call(this); }
    _cleanupBrowserLifecycle() { return stepHelpers._cleanupBrowserLifecycle.call(this); }
    async start() { return runnerHelpers.start.call(this); }
    async _run() { return runnerHelpers._run.call(this); }
    async _executeRegistrationSteps() { return runnerHelpers._executeRegistrationSteps.call(this); }

    async _executeStep(browser, step, browserId = null, nextStep = null) { return stepHelpers._executeStep.call(this, browser, step, browserId, nextStep); }
    async _executeLoopClickStep(browser, step) { return stepHelpers._executeLoopClickStep.call(this, browser, step); }
    async _executeNavigateStep(browser, step, nextStep = null) { return stepHelpers._executeNavigateStep.call(this, browser, step, nextStep); }
    async _executeClickStep(browser, step, browserId = null, nextStep = null) { return stepHelpers._executeClickStep.call(this, browser, step, browserId, nextStep); }
    async _executeTypeStep(browser, step, browserId = null, nextStep = null) { return stepHelpers._executeTypeStep.call(this, browser, step, browserId, nextStep); }
    async _executeWaitStep(browser, step, nextStep = null) { return stepHelpers._executeWaitStep.call(this, browser, step, nextStep); }
    async _executeScreenshotStep(browser, step) { return stepHelpers._executeScreenshotStep.call(this, browser, step); }
    async _executeGetCreditsStep(browser, step) { return stepHelpers._executeGetCreditsStep.call(this, browser, step); }
    async _getCreditsFromPage(browser, step) { return stepHelpers._getCreditsFromPage.call(this, browser, step); }
    async _tryGetCreditsAcrossOpenPages(browser, selectors, by, timeout, step) { return stepHelpers._tryGetCreditsAcrossOpenPages.call(this, browser, selectors, by, timeout, step); }
    async _tryGetCredits(browser, selectors, by, timeout, step) { return stepHelpers._tryGetCredits.call(this, browser, selectors, by, timeout, step); }
    async _clickAcrossOpenPages(browser, step, primarySelector, timeout, stepName = '', browserId = null) { return stepHelpers._clickAcrossOpenPages.call(this, browser, step, primarySelector, timeout, stepName, browserId); }
    _convertSelector(by, selector) { return stepHelpers._convertSelector.call(this, by, selector); }
    async _executeExternalScriptStep(step) { return stepHelpers._executeExternalScriptStep.call(this, step); }
    async _executeExternalScript(step) { return stepHelpers._executeExternalScript.call(this, step); }
    async _executeGetCreditsScript() { return stepHelpers._executeGetCreditsScript.call(this); }
    async _getCreditsFromPageDirect() { return stepHelpers._getCreditsFromPageDirect.call(this); }
    async _executeClashSystemProxyStep(step) { return stepHelpers._executeClashSystemProxyStep.call(this, step); }
    async _executeWaitVerificationCodeStep(step) { return stepHelpers._executeWaitVerificationCodeStep.call(this, step); }
    async _executeSaveCookiesStep(browser, step) { return stepHelpers._executeSaveCookiesStep.call(this, browser, step); }
    async _recoverHaikaBindingWithNextCard(options = {}) { return stepHelpers._recoverHaikaBindingWithNextCard.call(this, options); }
    async _waitForPageStability(browser, step) { return stepHelpers._waitForPageStability.call(this, browser, step); }
    async _syncBrowserPageAfterClick(browser, browserId, stepName, transitionHint = {}) { return stepHelpers._syncBrowserPageAfterClick.call(this, browser, browserId, stepName, transitionHint); }
    async _switchToPreferredPage(browser, step, browserId, stepLabel) { return stepHelpers._switchToPreferredPage.call(this, browser, step, browserId, stepLabel); }
    async _preferLatestOpenPage(browser, browserId, stepName) { return stepHelpers._preferLatestOpenPage.call(this, browser, browserId, stepName); }
    async _describeOpenPages(browser) { return stepHelpers._describeOpenPages.call(this, browser); }
    _compactPageUrl(url, maxLength = 120) { return stepHelpers._compactPageUrl.call(this, url, maxLength); }
    _resolvePageSyncTimeoutMs(step) { return stepHelpers._resolvePageSyncTimeoutMs.call(this, step); }
    _resolveTypeChunkSize(step) { return stepHelpers._resolveTypeChunkSize.call(this, step); }
    _resolveTypeChunkDelayMs(step) { return stepHelpers._resolveTypeChunkDelayMs.call(this, step); }
    _resolveTypeCharDelayMs(step) { return stepHelpers._resolveTypeCharDelayMs.call(this, step); }
    _resolveTypeOperationTimeoutMs(step, fallbackTimeout) { return stepHelpers._resolveTypeOperationTimeoutMs.call(this, step, fallbackTimeout); }
    async _typeTextIntoLocator(locator, text, timeout, step = {}) { return stepHelpers._typeTextIntoLocator.call(this, locator, text, timeout, step); }
    async _typeTextInChunks(locator, text, timeout, step = {}) { return stepHelpers._typeTextInChunks.call(this, locator, text, timeout, step); }
    async _typeAcrossOpenPages(browser, step, primarySelector, text, timeout, stepName = '', browserId = null, options = {}) { return stepHelpers._typeAcrossOpenPages.call(this, browser, step, primarySelector, text, timeout, stepName, browserId, options); }
    async _fillSelectorInTarget(target, selector, text, timeout, step = {}, options = {}) { return stepHelpers._fillSelectorInTarget.call(this, target, selector, text, timeout, step, options); }
    _collectClickSelectors(step, primarySelector = '') { return stepHelpers._collectClickSelectors.call(this, step, primarySelector); }
    async _clickTargetInPage(targetPage, step, selectors, timeout, stepName = '') { return stepHelpers._clickTargetInPage.call(this, targetPage, step, selectors, timeout, stepName); }
    async _nativeClickLocator(locator, timeout) { return stepHelpers._nativeClickLocator.call(this, locator, timeout); }
    async _waitForLocatorEnabled(locator, timeout = 1500, intervalMs = 100) { return stepHelpers._waitForLocatorEnabled.call(this, locator, timeout, intervalMs); }
    _resolveStepTemplate(value) { return stepHelpers._resolveStepTemplate.call(this, value); }
    _escapeCssIdentifier(value) { return stepHelpers._escapeCssIdentifier.call(this, value); }
    _extractNativeElementSelectorCandidates(selector = '') { return stepHelpers._extractNativeElementSelectorCandidates.call(this, selector); }
    _extractAutoSelectorCandidates(selector = '') { return stepHelpers._extractAutoSelectorCandidates.call(this, selector); }
    _resolveSelectorCandidates(by, selector) { return stepHelpers._resolveSelectorCandidates.call(this, by, selector); }
    _resolveSelectorCandidate(by, selector) { return stepHelpers._resolveSelectorCandidate.call(this, by, selector); }
    _collectStepPageNeedles(step) { return stepHelpers._collectStepPageNeedles.call(this, step); }
    _collectStepSelectors(step) { return stepHelpers._collectStepSelectors.call(this, step); }
    async _findVisibleTextInPage(targetPage, texts = []) { return stepHelpers._findVisibleTextInPage.call(this, targetPage, texts); }
    async _isTargetVisibleInPage(targetPage, step, selectors) { return stepHelpers._isTargetVisibleInPage.call(this, targetPage, step, selectors); }
    async _isStepReady(browser, step) { return stepHelpers._isStepReady.call(this, browser, step); }
    _getTempEmailService() {
        return this.app && this.app.tempEmailService ? this.app.tempEmailService : null;
    }
    _isTempEmailModeEnabled() {
        const service = this._getTempEmailService();
        if (!service) {
            return false;
        }

        const mode = typeof service.currentMode === 'string'
            ? service.currentMode
            : typeof service.getState === 'function'
                ? service.getState()?.mode
                : '';
        return String(mode || '').trim().toLowerCase() === 'temp';
    }
    _getTempEmailProviderId() {
        const service = this._getTempEmailService();
        if (!service) {
            return '';
        }

        return String(
            service.currentProviderId
            || service.currentProvider?.id
            || (typeof service.getState === 'function' ? service.getState()?.selectedProviderId : '')
            || ''
        ).trim();
    }
    _shouldPrewarmTempEmail() {
        return this._isTempEmailModeEnabled() && Boolean(this._getTempEmailProviderId());
    }
    async _prewarmTempEmailBrowser(step = {}) {
        const service = this._getTempEmailService();
        if (!service || typeof service.openProvider !== 'function') {
            return { success: false, skipped: true, error: '临时邮箱服务不可用' };
        }

        const providerId = this._getTempEmailProviderId();
        if (!providerId) {
            return { success: false, skipped: true, error: '未选择临时邮箱卡片' };
        }

        if (!this._shouldPrewarmTempEmail()) {
            return { success: false, skipped: true, error: '当前未启用临时邮箱模式' };
        }

        const timeoutSeconds = Number.isFinite(Number(step.timeout))
            ? Math.max(5, Math.min(120, Number(step.timeout)))
            : 30;
        const result = await service.openProvider({
            providerId,
            sessionId: this.taskId,
            browserType: this.browserType,
            background: true,
            hidden: true,
            pageLoadTimeoutMs: Math.max(10000, Number(step.pageLoadTimeoutMs || step.gotoTimeoutMs || 20000)),
            gotoTimeoutMs: Math.max(10000, Number(step.gotoTimeoutMs || step.pageLoadTimeoutMs || 20000)),
            closePopupTimeoutMs: Math.max(1000, Number(step.closePopupTimeoutMs || 3000)),
            closePopupPollIntervalMs: Math.max(100, Number(step.closePopupPollIntervalMs || 250)),
            closePopupQuietRounds: Math.max(1, Number(step.closePopupQuietRounds || 2)),
            timeout: timeoutSeconds
        });

        if (!result || result.success !== true) {
            throw new Error(result?.error || '临时邮箱预热失败');
        }

        this.logger.info(`已预热临时邮箱页面: ${result.provider?.name || providerId} -> ${result.url || ''}`);
        return result;
    }
    async _waitForTempEmailAddress(step = {}, timeoutSeconds = 60) {
        const service = this._getTempEmailService();
        if (!service || typeof service.waitForEmail !== 'function') {
            return null;
        }

        const providerId = this._getTempEmailProviderId();
        if (!providerId) {
            throw new Error('请先选择一个临时邮箱卡片');
        }

        const waitTimeout = Number.isFinite(Number(timeoutSeconds)) ? Math.max(1, Number(timeoutSeconds)) : 60;
        const pollIntervalMs = Math.max(500, Number(step.poll_interval_ms || step.pollIntervalMs || 1000));
        const refreshTimeoutMs = Number.isFinite(Number(step.refresh_timeout_ms || step.refreshTimeoutMs))
            ? Math.max(1000, Number(step.refresh_timeout_ms || step.refreshTimeoutMs))
            : 3000;
        const maxCycles = 2;
        let lastError = '';

        for (let cycle = 0; cycle < maxCycles; cycle += 1) {
            const result = await service.waitForEmail({
                providerId,
                sessionId: this.taskId,
                timeout: waitTimeout,
                browserType: this.browserType,
                background: true,
                hidden: true,
                pollIntervalMs
            });

            if (result && result.success === true && result.email) {
                return result.email;
            }

            lastError = result?.error || lastError;
            if (cycle >= maxCycles - 1) {
                break;
            }

            this.logger.info(`临时邮箱获取失败，准备自动刷新后重试: ${lastError || '未找到邮箱地址'}`);
            const refreshResult = await service.refreshEmail({
                providerId,
                sessionId: this.taskId,
                browserType: this.browserType,
                background: true,
                hidden: true,
                timeout: refreshTimeoutMs,
                pageLoadTimeoutMs: refreshTimeoutMs,
                gotoTimeoutMs: refreshTimeoutMs
            });

            if (!refreshResult || refreshResult.success !== true) {
                lastError = refreshResult?.error || lastError || '自动刷新邮箱失败';
                this.logger.warning(`自动刷新临时邮箱失败: ${lastError}`);
            } else {
                this.logger.info('已自动点击刷新邮箱按钮，继续等待新邮箱地址');
            }
        }

        throw new Error(lastError || '获取临时邮箱失败');
    }
    async _waitForApiEmailAddress(step = {}, timeoutSeconds = 60) {
        const service = this._getTempEmailService();
        if (!service || typeof service.getApiEmail !== 'function') {
            return null;
        }

        const providerId = this._getTempEmailProviderId();
        if (!providerId) {
            throw new Error('请先选择一个临时邮箱卡片');
        }

        const result = await service.getApiEmail({
            providerId,
            sessionId: this.taskId,
            timeout: Number.isFinite(Number(timeoutSeconds)) ? Math.max(1, Number(timeoutSeconds)) : 60
        });

        if (!result || result.success !== true || !result.email) {
            throw new Error(result?.error || '获取API邮箱失败');
        }

        return result.email;
    }
    async _waitForTempEmailCode(step = {}, timeoutSeconds = 120) {
        const service = this._getTempEmailService();
        if (!service || typeof service.waitForCode !== 'function') {
            return null;
        }

        const providerId = this._getTempEmailProviderId();
        if (!providerId) {
            throw new Error('请先选择一个临时邮箱卡片');
        }

        const result = await service.waitForCode({
            providerId,
            sessionId: this.taskId,
            timeout: Number.isFinite(Number(timeoutSeconds)) ? Math.max(1, Number(timeoutSeconds)) : 120,
            browserType: this.browserType,
            background: true,
            hidden: true,
            pollIntervalMs: Math.max(500, Number(step.poll_interval_ms || step.pollIntervalMs || 1500))
        });

        if (!result || result.success !== true || !result.code) {
            throw new Error(result?.error || '获取临时邮箱验证码失败');
        }

        return result.code;
    }
    async _cleanupTempEmailSession() {
        const service = this._getTempEmailService();
        if (!service || typeof service.closeSession !== 'function') {
            return false;
        }

        const result = await service.closeSession(this.taskId);
        return result && result.success === true;
    }
    stop(reason = '', options = {}) {
        return this._markTaskStopped(reason || this.stopReason || '任务已停止', options);
    }
}

module.exports = RegistrationThread;
