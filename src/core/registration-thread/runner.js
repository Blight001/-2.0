const DEFAULT_MIN_COOKIE_SIZE_BYTES = 8192;

const calculateCookiePayloadBytes = (payload) => {
    try {
        if (payload === undefined || payload === null) {
            return 0;
        }

        return Buffer.byteLength(JSON.stringify(payload, null, 2), 'utf8');
    } catch (_error) {
        return 0;
    }
};

const normalizeNavigationUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw)) {
        return raw;
    }

    if (/^(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(raw) || /(?:\.[a-zA-Z]{2,})(?::\d+)?(?:\/|$)/.test(raw)) {
        return `https://${raw}`;
    }

    return raw;
};

const normalizeRegistrationSteps = (cardConfig = {}, logger = null) => {
    const steps = Array.isArray(cardConfig.steps) ? [...cardConfig.steps] : [];
    const website = normalizeNavigationUrl(cardConfig.website);

    if (!website) {
        return steps;
    }

    const firstMeaningfulStep = steps.find(step => step && typeof step === 'object');
    const firstStepType = String(firstMeaningfulStep?.type || '').trim().toLowerCase();
    if (firstStepType === 'navigate') {
        return steps;
    }

    if (logger && typeof logger.info === 'function') {
        logger.info(`检测到卡片网站地址，自动在步骤前补充“访问网站”: ${website}`);
    }

    return [
        {
            type: 'navigate',
            name: '访问网站',
            url: website
        },
        ...steps
    ];
};

const reloadLatestRegistrationCardConfig = async (thread) => {
    const cardName = String(thread?.cardConfig?.name || thread?.app?.activeRegistrationCardName || '').trim();
    const cardManager = thread?.app?.cardManager;
    if (!cardName || !cardManager || typeof cardManager.getCard !== 'function') {
        return false;
    }

    const latestCardConfig = await cardManager.getCard(cardName, { forceReload: true });
    if (!latestCardConfig || typeof latestCardConfig !== 'object') {
        return false;
    }

    const preservedCredentials = {
        email: thread?.credentials?.email || '',
        password: thread?.credentials?.password || ''
    };
    const preservedRuntimeState = {
        generatedEmail: thread?.generatedEmail || '',
        generatedPassword: thread?.generatedPassword || '',
        generatedAccount: thread?.generatedAccount || '',
        receivedVerificationCode: thread?.receivedVerificationCode || '',
        randomConfig: thread?.randomConfig || {}
    };

    thread.cardConfig = {
        ...latestCardConfig,
        email: latestCardConfig.email || preservedCredentials.email || '',
        password: latestCardConfig.password || preservedCredentials.password || '',
        random: latestCardConfig.random || preservedRuntimeState.randomConfig || {}
    };
    thread.credentials = {
        ...(thread.credentials && typeof thread.credentials === 'object' ? thread.credentials : {}),
        email: preservedCredentials.email || latestCardConfig.email || '',
        password: preservedCredentials.password || latestCardConfig.password || ''
    };
    thread.generatedEmail = preservedRuntimeState.generatedEmail;
    thread.generatedPassword = preservedRuntimeState.generatedPassword;
    thread.generatedAccount = preservedRuntimeState.generatedAccount;
    thread.receivedVerificationCode = preservedRuntimeState.receivedVerificationCode;
    thread.randomConfig = preservedRuntimeState.randomConfig || thread.cardConfig.random || {};

    return true;
};

const resolveMinCookieSizeBytes = (cardConfig) => {
    const candidates = [
        cardConfig?.min_cookie_size_bytes,
        cardConfig?.minCookieSizeBytes,
        cardConfig?.min_cookie_size,
        cardConfig?.minCookieSize
    ];

    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null || candidate === '') {
            continue;
        }

        const explicitSize = parseInt(candidate, 10);
        if (Number.isFinite(explicitSize) && explicitSize >= 0) {
            return explicitSize;
        }
    }

    return DEFAULT_MIN_COOKIE_SIZE_BYTES;
};

module.exports = {
    async start() {
        try {
            await this._run();
        } catch (error) {
            this.logger.error(`任务 ${this.taskId} 执行失败: ${error.message}`);
            this.emit('error', error.message);
        }
    },

    async _run() {
        try {
            const headless = this.browserSettings.headless || false;

            const filteredSettings = { ...this.browserSettings };
            delete filteredSettings.browser_type;
            delete filteredSettings.headless;
            filteredSettings.browserSettings = {
                ...(this.browserSettings && typeof this.browserSettings === 'object' ? this.browserSettings : {})
            };

            const existingBrowserId = String(this.browserId || '').trim();
            const bridgeMode = typeof this._isBrowserBridgeMode === 'function'
                ? this._isBrowserBridgeMode(existingBrowserId)
                : String(this.browserType || '').trim().toLowerCase() === 'plugin-browser';
            if (existingBrowserId) {
                const existingBrowserData = this.browserManager && typeof this.browserManager.getBrowserData === 'function'
                    ? this.browserManager.getBrowserData(existingBrowserId)
                    : null;
                const existingBrowserPage = this.browserManager && typeof this.browserManager.getBrowser === 'function'
                    ? this.browserManager.getBrowser(existingBrowserId)
                    : null;

                if (existingBrowserData && existingBrowserPage) {
                    this.logger.info(`复用已有浏览器实例，ID: ${existingBrowserId}`);
                } else if (bridgeMode || this.browserType === 'plugin-browser') {
                    this.logger.info(`接管插件浏览器桥接会话，ID: ${existingBrowserId}`);
                } else {
                    this.browserId = '';
                }
            }

            if (!this.browserId) {
                this.logger.info(`开始创建${this.browserType}浏览器实例`);
                this.browserId = await this.browserManager.createBrowser(
                    this.browserType,
                    headless,
                    filteredSettings
                );
                this.logger.info(`浏览器实例创建完成，ID: ${this.browserId}`);
            }
            await this._bindBrowserLifecycle();

            this.currentStep = this.browserId ? `接管${this.browserType}浏览器实例` : `创建${this.browserType}浏览器实例`;
            this.emit('progress', 10, this.browserId ? `接管${this.browserType}浏览器实例` : `创建${this.browserType}浏览器实例`);

            if (!this.running) {
                this.emit('finished', {
                    success: false,
                    error: this.stopReason || '任务已停止',
                    cancelled: true,
                    browserClosed: this.browserClosed === true
                });
                return;
            }

            await this._ensureBrowserAvailable('浏览器初始化');
            this.logger.info('浏览器实例验证通过，page对象可用');

            let tempEmailWarmupPromise = null;
            if (typeof this._shouldPrewarmTempEmail === 'function' && this._shouldPrewarmTempEmail()) {
                this.logger.info('检测到临时邮箱模式，开始预热临时邮箱页面');
                tempEmailWarmupPromise = this._prewarmTempEmailBrowser({
                    timeout: 30,
                    pageLoadTimeoutMs: 20000,
                    gotoTimeoutMs: 20000,
                    closePopupTimeoutMs: 3000,
                    closePopupPollIntervalMs: 250,
                    closePopupQuietRounds: 2
                }).catch((error) => {
                    this.logger.warning(`临时邮箱预热失败: ${error.message}`);
                    return null;
                });
            }

            if (Array.isArray(this.initialCookies) && this.initialCookies.length > 0) {
                const injected = await this.browserManager.setCookies(this.browserId, this.initialCookies);
                if (!injected) {
                    this.logger.warning('Cookie注入失败，继续执行后续步骤');
                }
            } else {
                this.logger.info('未提供初始Cookie，跳过注入');
            }

            if (tempEmailWarmupPromise) {
                await tempEmailWarmupPromise;
            }

            const result = await this._executeRegistrationSteps();
            if (this.cookiesSavedByCaptureStep === true) {
                result.cookiesSaved = true;
            }

            this.emit('finished', result);
        } catch (error) {
            const normalizedError = this._normalizeRuntimeError(error, '任务执行');
            if ((!this.running && this.stopReason) || this.browserClosed === true) {
                this.emit('finished', {
                    success: false,
                    error: normalizedError.message,
                    cancelled: true,
                    browserClosed: this.browserClosed === true
                });
            } else {
                this.emit('error', normalizedError.message);
            }
        } finally {
            this._finalizing = true;
            this._cleanupBrowserLifecycle();

            if (this.synchronizer) {
                this.synchronizer.notifyThreadFinished(this.taskId);
            }

            if (this.browserId && !this.keepBrowserOpen) {
                try {
                    await this.browserManager.closeBrowser(this.browserId);
                } catch (error) {
                    this.logger.error(`关闭浏览器失败: ${error.message}`);
                }
            } else if (this.browserId && this.keepBrowserOpen) {
                this.logger.info(`调试模式保留浏览器打开: ${this.browserId}`);
            }

            try {
                await this._cleanupTempEmailSession();
            } catch (error) {
                this.logger.warning(`关闭临时邮箱窗口失败: ${error.message}`);
            }
        }
    },

    async _executeRegistrationSteps() {
        const result = {
            success: false,
            email: '',
            password: '',
            points: 0,
            warnings: [],
            debugMode: this.debugMode === true
        };

        let steps = normalizeRegistrationSteps(this.cardConfig, this.logger);
        let totalSteps = steps.length;
        const debugMode = this.debugMode === true;
        const jumpCounters = new Map();

        const refreshStepsFromLatestCard = async () => {
            const refreshPending = this._debugCardConfigRefreshPending === true;
            if (!refreshPending) {
                return false;
            }

            this._debugCardConfigRefreshPending = false;
            const refreshed = await reloadLatestRegistrationCardConfig(this);
            if (!refreshed) {
                return false;
            }

            steps = normalizeRegistrationSteps(this.cardConfig, this.logger);
            totalSteps = steps.length;
            this.logger.info(`调试继续前已重新加载最新卡片步骤: ${String(this.cardConfig?.name || '').trim() || 'unknown'}`);
            return true;
        };

        if (debugMode && typeof this._emitDebugState === 'function') {
            this._emitDebugState({
                active: true,
                paused: false,
                pauseRequested: false,
                awaitingRunMode: false,
                runMode: 'step',
                currentStepIndex: -1,
                totalSteps,
                progress: 0,
                message: '调试任务准备中',
                statusText: '调试任务准备中',
                canPause: true,
                canResume: false,
                completed: false,
                error: '',
                failedStepError: '',
                completedStepIndex: -1
            });
        }

        const pauseForDebug = async (reason = 'success', stepName = '', stepIndex = -1, progress = 0, message = '') => {
            if (!debugMode) {
                return null;
            }

            if (reason !== 'error' && (!this.debugStepPauseMs || this.debugStepPauseMs <= 0)) {
                return null;
            }

            const pauseLabel = reason === 'error' ? '错误暂停' : '步骤暂停';
            const statusText = reason === 'error' ? '错误暂停，等待修改后继续' : '已暂停，等待继续';
            const pauseMessage = reason === 'error'
                ? (message || `步骤 ${stepName || '未知步骤'} 执行失败，已自动暂停`)
                : (message || `步骤 ${stepName || '未知步骤'} 已完成，等待继续`);
            this.logger.info(`调试模式：${stepName ? `${stepName} ` : ''}${pauseLabel}，等待用户继续`);
            return await this._enterDebugPause({
                reason,
                stepName,
                stepIndex,
                progress,
                message: pauseMessage,
                statusText,
                ...(reason === 'success' ? { completedStepIndex: stepIndex } : {}),
                ...(reason === 'error' ? { error: pauseMessage, failedStepError: pauseMessage } : {})
            });
        };
        const resolveDebugTargetStepIndex = (pauseResult) => {
            const explicitTarget = Number(pauseResult?.targetStepIndex);
            if (Number.isInteger(explicitTarget) && explicitTarget >= 0 && explicitTarget < steps.length) {
                return explicitTarget;
            }

            const pendingTarget = Number(this._debugTargetStepIndex);
            if (Number.isInteger(pendingTarget) && pendingTarget >= 0 && pendingTarget < steps.length) {
                this._debugTargetStepIndex = undefined;
                return pendingTarget;
            }

            return -1;
        };
        const resolveJumpStepIndex = (directive, currentIndex) => {
            if (!directive || typeof directive !== 'object') {
                return -1;
            }

            const targetStepIndex = parseInt(directive.targetStepIndex ?? directive.target_index, 10);
            if (Number.isFinite(targetStepIndex) && targetStepIndex >= 0 && targetStepIndex < steps.length) {
                return targetStepIndex;
            }

            const targetStepName = typeof directive.targetStepName === 'string'
                ? directive.targetStepName.trim()
                : (typeof directive.target_step_name === 'string' ? directive.target_step_name.trim() : '');
            if (!targetStepName) {
                return -1;
            }

            for (let index = currentIndex - 1; index >= 0; index--) {
                const candidateName = typeof steps[index]?.name === 'string' ? steps[index].name.trim() : '';
                if (candidateName === targetStepName) {
                    return index;
                }
            }

            return steps.findIndex(candidate => {
                const candidateName = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
                return candidateName === targetStepName;
            });
        };
        const detectCaptchaLoadFailure = async (browser) => {
            const failureText = 'The CAPTCHA failed to load';
            const unsupportedText = 'unsupported browser or a browser extension';
            const collectPages = () => {
                const pages = [];
                try {
                    if (browser && typeof browser.context === 'function') {
                        const context = browser.context();
                        if (context && typeof context.pages === 'function') {
                            pages.push(...context.pages().filter(page => page && (typeof page.isClosed !== 'function' || !page.isClosed())));
                        }
                    }
                } catch (_error) {
                }

                if (pages.length === 0 && browser) {
                    pages.push(browser);
                }

                return pages;
            };

            for (const page of collectPages()) {
                try {
                    const pageText = await page.evaluate(() => String(document.body?.innerText || '')).catch(() => '');
                    if (pageText.includes(failureText) && pageText.includes(unsupportedText)) {
                        const url = typeof page.url === 'function' ? page.url() : page.url;
                        const diagnostics = await page.evaluate(() => ({
                            userAgent: String(navigator.userAgent || ''),
                            webdriver: navigator.webdriver === true,
                            platform: String(navigator.platform || '')
                        })).catch(() => null);
                        return {
                            found: true,
                            url: typeof this._compactPageUrl === 'function' ? this._compactPageUrl(url) : String(url || ''),
                            diagnostics
                        };
                    }
                } catch (_error) {
                }
            }

            return { found: false };
        };

        for (let i = 0; i < steps.length; i++) {
            if (!this.running) {
                break;
            }

            let browser;
            try {
                browser = await this._ensureBrowserAvailable(`步骤 ${i + 1} 前检查`);
            } catch (error) {
                result.error = this._normalizeRuntimeError(error, `步骤 ${i + 1} 前检查`).message;
                return result;
            }

            const stepPreview = steps[i];
            const stepPreviewName = typeof stepPreview?.name === 'string' && stepPreview.name.trim() ? stepPreview.name.trim() : `步骤${i + 1}`;
            this.currentStep = stepPreviewName;

            const progress = 20 + (i / Math.max(totalSteps, 1)) * 70;

            if (this.synchronizer) {
                try {
                    this.logger.info(`[同步] 任务 ${this.taskId} 等待其它线程到达步骤 ${i + 1} (${stepPreviewName})...`);
                    this.emit('progress', Math.round(progress), `[同步] 等待其他浏览器...`);
                    await this.synchronizer.waitForStep(i, stepPreviewName, this.taskId, () => this.running !== false);
                    browser = await this._ensureBrowserAvailable(`步骤 ${stepPreviewName} 同步后检查`);
                    this.logger.info(`[同步] 步骤 ${i + 1} 同步完成，开始执行`);
                } catch (syncError) {
                    result.error = this._normalizeRuntimeError(syncError, `步骤 ${stepPreviewName} 同步等待`).message;
                    return result;
                }
            }

            this.emit('progress', Math.round(progress), `执行步骤: ${stepPreviewName}`);
            if (debugMode && typeof this._emitDebugState === 'function') {
                this._emitDebugState({
                    active: true,
                    currentStepIndex: i,
                    totalSteps,
                    currentStepName: stepPreviewName,
                    progress: Math.round(progress),
                    message: `执行步骤: ${stepPreviewName}`,
                    statusText: `执行步骤: ${stepPreviewName}`
                });
            }

            if (debugMode && this.debugState?.paused === true) {
                const resumeResult = await this._waitForDebugResume(`步骤 ${stepPreviewName} 开始前等待继续`);
                if (!this.running) {
                    break;
                }
                await refreshStepsFromLatestCard();
                const targetStepIndex = resolveDebugTargetStepIndex(resumeResult);
                if (targetStepIndex >= 0 && targetStepIndex !== i) {
                    i = targetStepIndex - 1;
                    continue;
                }
            } else if (debugMode && this.debugState?.pauseRequested === true) {
                const pauseResult = await this._enterDebugPause({
                    reason: this.debugState?.pauseReason || 'manual',
                    stepName: stepPreviewName,
                    stepIndex: i,
                    progress: Math.round(progress),
                    message: this.debugState?.message || `步骤 ${stepPreviewName} 开始前等待继续`,
                    statusText: '已暂停，等待继续'
                });
                if (!this.running) {
                    break;
                }
                const targetStepIndex = resolveDebugTargetStepIndex(pauseResult);
                if (targetStepIndex >= 0 && targetStepIndex !== i) {
                    i = targetStepIndex - 1;
                    continue;
                }
            }

            const step = steps[i];
            const stepName = typeof step?.name === 'string' && step.name.trim() ? step.name.trim() : `步骤${i + 1}`;
            const nextStep = steps[i + 1] || null;
            this.currentStep = stepName;

            try {
                if (typeof step !== 'object' || step === null) {
                    const message = `步骤 ${i + 1} 配置错误：期望对象类型，但收到 ${typeof step}: ${step}`;
                    if (debugMode) {
                        result.warnings.push(message);
                        this.logger.warning(`调试模式：${message}，将继续执行后续步骤`);
                        await pauseForDebug('error', stepName, i, Math.round(progress), message);
                        continue;
                    }
                    result.error = message;
                    return result;
                }

                if (debugMode && typeof this._emitDebugState === 'function') {
                    this._emitDebugState({
                        error: '',
                        failedStepError: '',
                        currentStepIndex: i,
                        currentStepName: stepName,
                        completedStepIndex: Math.max(-1, Number(this.debugState?.completedStepIndex) || -1)
                    });
                }

                const success = await this._executeStep(browser, step, this.browserId, nextStep);
                const captchaFailure = await detectCaptchaLoadFailure(browser);
                if (captchaFailure.found === true) {
                    const diagnostics = captchaFailure.diagnostics || {};
                    const warning = [
                        '验证码加载失败：当前页面无法加载 CAPTCHA，自动化浏览器上下文可能被验证码服务判定为 unsupported browser 或扩展环境。',
                        `webdriver=${diagnostics.webdriver === true ? 'true' : 'false'}`,
                        `platform=${diagnostics.platform || 'unknown'}`,
                        `url=${captchaFailure.url || 'unknown'}`
                    ].join(' ');

                    this.logger.warning(warning);
                    if (debugMode) {
                        result.warnings.push(warning);
                        await pauseForDebug('error', stepName, i, Math.round(progress), `${warning} 请在无扩展的真实用户浏览器中人工完成验证码后再继续。`);
                        continue;
                    }

                    result.error = warning;
                    return result;
                }

                if (success && typeof success === 'object' && success.action === 'jump_to_step') {
                    const targetIndex = resolveJumpStepIndex(success, i);
                    if (targetIndex < 0 || targetIndex >= steps.length) {
                        throw new Error(`步骤 ${stepName} 请求跳转失败：未找到目标步骤 ${success.targetStepName || success.target_step_name || success.targetStepIndex || success.target_index}`);
                    }

                    const jumpKey = `${i}->${targetIndex}`;
                    const usedCount = (jumpCounters.get(jumpKey) || 0) + 1;
                    jumpCounters.set(jumpKey, usedCount);
                    const maxJumpRetries = Number.isFinite(parseInt(success.maxJumpRetries, 10))
                        ? Math.max(1, parseInt(success.maxJumpRetries, 10))
                        : 3;

                    if (usedCount > maxJumpRetries) {
                        throw new Error(`${success.reason || `步骤 ${stepName} 需要回跳`}，但已超过最大回跳次数 ${maxJumpRetries}`);
                    }

                    const targetStepName = typeof steps[targetIndex]?.name === 'string' && steps[targetIndex].name.trim()
                        ? steps[targetIndex].name.trim()
                        : `步骤${targetIndex + 1}`;
                    this.logger.warning(`${success.reason || `步骤 ${stepName} 请求回跳`}，第 ${usedCount}/${maxJumpRetries} 次回跳到 ${targetStepName}`);
                    i = targetIndex - 1;
                    continue;
                }

                if (success === false || success === null || success === undefined) {
                    const message = (!this.running && this.stopReason)
                        ? this.stopReason
                        : `步骤 ${step.name || `步骤${i + 1}`} 执行失败`;
                    if (debugMode) {
                        result.warnings.push(message);
                        this.logger.warning(`调试模式：${message}，将继续执行后续步骤`);
                        await pauseForDebug('error', stepName, i, Math.round(progress), message);
                        continue;
                    }
                    result.error = message;
                    return result;
                }

                if (debugMode) {
                    const completedProgress = Math.round(20 + ((i + 1) / Math.max(totalSteps, 1)) * 70);
                    const pauseResult = await pauseForDebug('success', stepName, i, completedProgress, `步骤 ${stepName} 已完成`);
                    if (typeof this._emitDebugState === 'function') {
                        this._emitDebugState({
                            completedStepIndex: Math.max(i, Number(this.debugState?.completedStepIndex) || -1),
                            progress: completedProgress
                        });
                    }
                    const targetStepIndex = resolveDebugTargetStepIndex(pauseResult);
                    if (targetStepIndex >= 0) {
                        i = targetStepIndex - 1;
                        continue;
                    }
                }
            } catch (error) {
                const normalizedError = this._normalizeRuntimeError(error, `步骤 ${stepName}`);
                this.logger.error(`execute_registration_steps异常时step状态: 类型=${typeof step}, 值=${JSON.stringify(step)}`);
                this.logger.error(`异常信息: ${normalizedError.message}`);
                let failedStepName;
                try {
                    failedStepName = (typeof step === 'object' && step !== null) ? (step.name || `步骤${i + 1}`) : `步骤${i + 1}`;
                } catch (_e) {
                    failedStepName = `步骤${i + 1}`;
                }
                if (debugMode) {
                    const warning = `步骤 ${failedStepName} 错误: ${normalizedError.message}`;
                    result.warnings.push(warning);
                    this.logger.warning(`调试模式：${warning}，将继续执行后续步骤`);
                    const pauseResult = await pauseForDebug('error', failedStepName, i, Math.round(progress), warning);
                    if (typeof this._emitDebugState === 'function') {
                        this._emitDebugState({
                            error: warning,
                            failedStepError: normalizedError.message,
                            currentStepIndex: i,
                            currentStepName: failedStepName,
                            progress: Math.round(progress)
                        });
                    }
                    const targetStepIndex = resolveDebugTargetStepIndex(pauseResult);
                    i = (targetStepIndex >= 0 ? targetStepIndex : i) - 1;
                    continue;
                }
                result.error = `步骤 ${failedStepName} 错误: ${normalizedError.message}`;
                return result;
            }
        }

        if (!this.running) {
            result.error = this.stopReason || '任务被用户停止';
            this.logger.info(`任务 ${this.taskId} 已停止，未完成注册: ${result.error}`);
            if (debugMode && typeof this._emitDebugState === 'function') {
                this._emitDebugState({
                    active: false,
                    paused: false,
                    pauseRequested: false,
                    awaitingRunMode: false,
                    runMode: '',
                    completed: false,
                    error: result.error,
                    statusText: result.error
                });
            }
            return result;
        }

        this.currentStep = '获取注册结果';
        result.success = true;

        this.logger.info('注册完成 - 凭据状态:');
        this.logger.info(`  credentials.email: "${this.credentials.email}"`);
        this.logger.info(`  credentials.password: "${this.credentials.password}"`);
        this.logger.info(`  generatedEmail: "${this.generatedEmail}"`);
        this.logger.info(`  cardConfig.email: "${this.cardConfig.email}"`);
        this.logger.info(`  cardConfig.password: "${this.cardConfig.password}"`);
        this.logger.info(`  _credits: ${this._credits}`);

        const emailCandidate = this.credentials.email || this.generatedEmail || this.cardConfig.email || '';
        const email = typeof this._applyEmailSuffixToEmail === 'function'
            ? this._applyEmailSuffixToEmail(emailCandidate)
            : emailCandidate;
        result.email = email.startsWith('@') ? email.substring(1) : email;
        result.password = this.credentials.password || this.cardConfig.password || '';

        if (!result.email) {
            result.email = `temp_${Date.now()}@example.com`;
            this.logger.warning(`未找到邮箱，使用备用邮箱: ${result.email}`);
        }

        if (!result.password) {
            result.password = `temp_pass_${Date.now()}`;
            this.logger.warning(`未找到密码，使用临时密码: ${result.password}`);
        }

        result.points = this._credits ?? this.cardConfig.points ?? 0;

        this.logger.info(`最终注册结果 - 邮箱: ${result.email}, 密码: ${result.password}, 积分: ${result.points}`);
        if (debugMode && result.warnings.length > 0) {
            this.logger.info(`调试模式完成，累计 ${result.warnings.length} 个告警`);
        }
        this.emit('progress', 90, '获取注册结果');
        if (debugMode && typeof this._emitDebugState === 'function') {
            this._emitDebugState({
                active: false,
                paused: false,
                pauseRequested: false,
                awaitingRunMode: false,
                runMode: '',
                completed: true,
                progress: 100,
                message: '调试完成',
                statusText: '调试完成',
                canPause: false,
                canResume: false,
                error: ''
            });
        }
        return result;
    }
};
