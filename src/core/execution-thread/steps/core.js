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

module.exports = {
    _resolveStepTemplate(value) {
        if (typeof value !== 'string' || !value) {
            return value;
        }

        const resolvePasswordPlaceholder = () => {
            const currentPassword = this.credentials?.password || this.generatedPassword || '';
            if (currentPassword && currentPassword !== '{password}') {
                return String(currentPassword);
            }

            if (typeof this._generateRandomStringByConfig !== 'function') {
                return '';
            }

            const passwordConfig = this.randomConfig?.password || { length: 12, type: 'mixed' };
            const generatedPassword = this._generateRandomStringByConfig(passwordConfig);
            if (generatedPassword) {
                this.generatedPassword = generatedPassword;
                if (!this.credentials) {
                    this.credentials = {};
                }
                this.credentials.password = generatedPassword;
            }

            return generatedPassword;
        };

        const variables = {
            ...(this.contextVariables || {}),
            email: this.credentials?.email || this.generatedEmail || '',
            password: this.credentials?.password || this.generatedPassword || '',
            account: this.generatedAccount || '',
            code: this.receivedVerificationCode || '',
            sms_api: this.contextVariables?.sms_api || this.contextVariables?.smsApi || '',
            smsApi: this.contextVariables?.smsApi || this.contextVariables?.sms_api || '',
            sms_code: this.contextVariables?.sms_code || this.contextVariables?.smsCode || '',
            smsCode: this.contextVariables?.smsCode || this.contextVariables?.sms_code || ''
        };

        return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
            if (key === 'password') {
                const resolvedPassword = resolvePasswordPlaceholder();
                return resolvedPassword || match;
            }

            if (Object.prototype.hasOwnProperty.call(variables, key)) {
                const replacement = variables[key];
                if (replacement !== undefined && replacement !== null && replacement !== '') {
                    return String(replacement);
                }
            }

            return match;
        });
    },

    _resolvePageSyncTimeoutMs(step = {}) {
        if (step.skip_page_sync === true || step.skipPageSync === true) {
            return 0;
        }

        const explicitTimeout = step.page_sync_timeout_ms
            ?? step.pageSyncTimeoutMs
            ?? step.page_sync_timeout
            ?? step.pageSyncTimeout;
        const timeoutMs = parseInt(explicitTimeout, 10);
        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            return timeoutMs;
        }

        const preferredContains = Array.isArray(step.preferred_page_contains)
            ? step.preferred_page_contains
            : (step.preferred_page_contains ? [step.preferred_page_contains] : []);
        const postClickRequiredContains = Array.isArray(step.post_click_required_page_contains)
            ? step.post_click_required_page_contains
            : (step.post_click_required_page_contains ? [step.post_click_required_page_contains] : []);
        const hasPreferredPageHint = preferredContains.some(value => typeof value === 'string' && value.trim());
        const hasPostClickRequiredHint = postClickRequiredContains.some(value => typeof value === 'string' && value.trim());
        const expectsPageSwitch = step.expect_page_switch === true
            || step.expect_new_page === true
            || step.wait_for_page_switch === true
            || hasPreferredPageHint
            || hasPostClickRequiredHint;

        return expectsPageSwitch ? 8000 : 1200;
    },

    async _executeStep(browser, step, browserId = null, nextStep = null) {
        const stepLabel = typeof step?.name === 'string' && step.name.trim() ? step.name.trim() : 'unknown';
        const browserData = browserId && this.browserManager && typeof this.browserManager.getBrowserData === 'function'
            ? this.browserManager.getBrowserData(browserId)
            : null;
        const useBrowserBridge = typeof this._isBrowserBridgeMode === 'function'
            ? this._isBrowserBridgeMode(browserId)
            : String(browserData?.browserSource || browserData?.browser_source || '').trim() === 'plugin-browser';

        try {
            if (!useBrowserBridge && typeof this._ensureBrowserAvailable === 'function') {
                browser = await this._ensureBrowserAvailable(`步骤 ${stepLabel} 开始前检查`);
            }
            if (!useBrowserBridge && browser) {
                const skipPageSync = step && (step.skip_page_sync === true || step.skipPageSync === true);
                if (skipPageSync) {
                    this.logger.debug(`步骤 ${stepLabel} 已禁用页面同步，保持当前页面`);
                } else {
                    browser = await this._switchToPreferredPage(browser, step, browserId, stepLabel);
                }
            }
            if (!useBrowserBridge && typeof this._ensureBrowserAvailable === 'function') {
                browser = await this._ensureBrowserAvailable(`步骤 ${stepLabel} 页面同步后检查`);
            }
            if (!useBrowserBridge && browser) {
                const pageTitle = await browser.title();
                const pageUrl = typeof browser.url === 'function' ? browser.url() : browser.url;
                const compactPageUrl = typeof this._compactPageUrl === 'function' ? this._compactPageUrl(pageUrl) : pageUrl;
                const openPages = await this._describeOpenPages(browser);
                this.logger.info(`当前控制页面: ${pageTitle} | ${compactPageUrl || 'unknown'}`);
                if (openPages) {
                    this.logger.info(`当前浏览器打开页: ${openPages}`);
                }
            }
        } catch (pageInfoError) {
            const normalizedError = typeof this._normalizeRuntimeError === 'function'
                ? this._normalizeRuntimeError(pageInfoError, `步骤 ${stepLabel}`)
                : pageInfoError;
            if ((typeof this._isBrowserClosedError === 'function' && this._isBrowserClosedError(normalizedError)) || !this.running) {
                throw normalizedError;
            }
            this.logger.warning(`读取当前页面信息失败: ${pageInfoError.message}`);
        }

        if (typeof step !== 'object' || step === null) {
            throw new Error(`步骤配置错误：期望对象类型，但收到 ${typeof step}: ${step}`);
        }

        const stepType = step.type || '';
        this.logger.debug(`步骤类型: ${stepType}`);

        const stepName = step.name || 'unknown';
        const isOptional = step.optional || false;

        if (isOptional) {
            this.logger.debug(`开始执行可选步骤 ${stepName}`);
        } else {
            this.logger.info(`开始执行步骤 ${stepName}`);
        }

        if (useBrowserBridge && typeof this._executeBridgeStep === 'function') {
            const bridgeResult = await this._executeBridgeStep(browser, step, browserId, nextStep);
            if (bridgeResult !== null && bridgeResult !== undefined) {
                return bridgeResult;
            }
        }

        switch (stepType) {
            case 'navigate':
                return await this._executeNavigateStep(browser, step, nextStep);
            case 'click':
                return await this._executeClickStep(browser, step, browserId, nextStep);
            case 'type':
                return await this._executeTypeStep(browser, step, browserId, nextStep);
            case 'wait':
                return await this._executeWaitStep(browser, step, nextStep);
            case 'screenshot':
                return await this._executeScreenshotStep(browser, step);
            case 'external_script':
                return await this._executeExternalScriptStep(step);
            case 'get_credits':
                return await this._executeGetCreditsStep(browser, step);
            case 'wait_verification_code':
                return await this._executeWaitVerificationCodeStep(step);
            case 'save_cookies':
                return await this._executeSaveCookiesStep(browser, step);
            case 'loop_click':
                return await this._executeLoopClickStep(browser, step);
            case 'clash-system-proxy':
                return await this._executeClashSystemProxyStep(step);
            default:
                this.logger.warning(`未知步骤类型: ${stepType}`);
                return true;
        }
    },

    async _executeLoopClickStep(browser, step) {
        this.logger.info(`开始执行循环点击步骤: ${step.name}`);
        const maxAttempts = step.max_loop_attempts || 20;
        const interval = step.interval || 2000;
        const forceClick = step.force_click !== false && step.forceClick !== false;
        const primarySelectors = typeof this._resolveSelectorCandidates === 'function'
            ? this._resolveSelectorCandidates(step.by, this._resolveStepTemplate(step.selector))
            : [this._convertSelector(step.by, this._resolveStepTemplate(step.selector))];
        const clickSelectors = typeof this._collectClickSelectors === 'function'
            ? this._collectClickSelectors(step, primarySelectors)
            : primarySelectors;
        const stopSelectors = step.stop_selector
            ? (typeof this._resolveSelectorCandidates === 'function'
                ? this._resolveSelectorCandidates(step.stop_by || 'css_selector', this._resolveStepTemplate(step.stop_selector))
                : [this._convertSelector(step.stop_by || 'css_selector', this._resolveStepTemplate(step.stop_selector))])
            : [];
        const stopSelector = stopSelectors[0] || null;

        if (!stopSelector) {
            this.logger.warning('循环点击步骤未指定停止条件(stop_selector)，仅点击一次');
            try {
                let clicked = false;
                for (const selector of clickSelectors) {
                    try {
                        const element = browser.locator(selector).first();
                        await element.click({ timeout: 5000, force: true });
                        clicked = true;
                        break;
                    } catch (_clickError) {}
                }
                return clicked;
            } catch (_e) {
                return false;
            }
        }

        for (let i = 0; i < maxAttempts; i++) {
            if (stopSelector) {
                try {
                    for (const selector of stopSelectors) {
                        const stopElement = browser.locator(selector).first();
                        const isVisible = await stopElement.isVisible().catch(() => false);
                        if (isVisible) {
                            this.logger.info(`停止条件满足（元素已出现）: ${selector}`);
                            return true;
                        }
                    }
                } catch (_e) {}
            }

            try {
                this.logger.debug(`循环点击第 ${i + 1}/${maxAttempts} 次`);
                let clicked = false;
                for (const selector of clickSelectors) {
                    const element = browser.locator(selector).first();
                    const isVisible = await element.isVisible().catch(() => false);
                    if (isVisible || forceClick) {
                        await element.click({ timeout: 5000, force: forceClick });
                        clicked = true;
                        break;
                    }
                }
                if (!clicked) {
                    this.logger.debug('点击目标不可见且未启用强制点击，跳过本次点击');
                }
            } catch (e) {
                this.logger.debug(`点击尝试失败: ${e.message}`);
            }

            await this._sleepInterruptibly(interval, `循环点击步骤 ${step.name || 'loop_click'} 等待`);
        }

        this.logger.warning(`循环点击达到最大次数 (${maxAttempts})，停止条件仍未满足`);
        return !step.strict;
    },

    async _executeNavigateStep(browser, step, nextStep = null) {
        const maxRetries = step.max_retries || 3;
        const retryDelay = step.retry_delay || 0.5;
        const targetUrl = normalizeNavigationUrl(this._resolveStepTemplate(step.url));
        const stepWaitMs = (() => {
            const explicitWaitMs = parseFloat(step.wait ?? step.waitMs);
            if (Number.isFinite(explicitWaitMs) && explicitWaitMs >= 0) {
                return explicitWaitMs;
            }

            return 0;
        })();

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    this.logger.info(`导航重试第 ${attempt + 1} 次`);
                }

                this.logger.debug(`导航到URL: ${targetUrl}`);
                const timeout = step.timeout || 30000;
                this.logger.debug(`导航超时设置: ${timeout}ms`);

                await browser.goto(targetUrl, {
                    timeout,
                    waitUntil: 'domcontentloaded'
                });

                await this._waitForPageStability(browser, step);
                if (stepWaitMs > 0) {
                    const nextStepReady = nextStep && typeof this._isStepReady === 'function'
                        ? await this._isStepReady(browser, nextStep)
                        : false;

                    if (!nextStepReady) {
                        await this._sleepInterruptibly(stepWaitMs, `步骤 ${step.name || 'navigate'} 导航后等待`);
                    } else {
                        this.logger.debug('导航后下一步已就绪，跳过额外等待');
                    }
                }
                return true;
            } catch (error) {
                if (attempt === maxRetries - 1) {
                    this.logger.error(`导航失败 (已重试 ${maxRetries} 次): ${error.message}`);
                    throw error;
                }

                this.logger.warning(`第 ${attempt + 1} 次导航失败，${retryDelay}秒后重试: ${error.message}`);
                await this._sleepInterruptibly(retryDelay * 1000, `步骤 ${step.name || 'navigate'} 导航重试等待`);
            }
        }
    },

};
