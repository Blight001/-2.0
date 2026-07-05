module.exports = {
    async _executeTypeStep(browser, step, browserId = null, nextStep = null) {
        if (typeof this._ensureBrowserAvailable === 'function') {
            browser = await this._ensureBrowserAvailable(`步骤 ${step?.name || 'type'} 输入前检查`);
        }
        const isOptional = step.optional || false;
        const stepName = step.name || 'type';
        const stepContextText = [
            stepName,
            step.selector,
            ...(Array.isArray(step.fallback_selectors) ? step.fallback_selectors : [])
        ]
            .filter(value => typeof value === 'string' && value.trim())
            .join(' ')
            .toLowerCase();
        const isVerificationSensitiveStep = /验证码|verification|code|cvv|otp|3ds|stepup|验证/.test(stepContextText);
        const maxRetries = (() => {
            const explicitRetries = parseInt(step.max_retries ?? step.maxRetries, 10);
            if (Number.isFinite(explicitRetries) && explicitRetries > 0) {
                return explicitRetries;
            }

            return isVerificationSensitiveStep ? 12 : 3;
        })();
        const retryDelay = (() => {
            const explicitDelay = parseFloat(step.retry_delay ?? step.retryDelay);
            if (Number.isFinite(explicitDelay) && explicitDelay >= 0) {
                return explicitDelay;
            }

            return 0.25;
        })();
        const verificationNeedles = [
            'centinelapi.cardinalcommerce.com/V2/Cruise/StepUp',
            'acs.stripeauthentications.com/cld/challengeRequestBrowser',
            'acs.stripeauthentications.com',
            'challengeRequestBrowser'
        ];
        const allowCrossPageFocus = step.allow_cross_page_focus === true || step.allowCrossPageFocus === true;
        const timeout = (() => {
            const explicitTimeout = parseInt(step.timeout, 10);
            return Number.isFinite(explicitTimeout) && explicitTimeout > 0 ? explicitTimeout : 30000;
        })();
        const waitForElementTimeoutMs = (() => {
            const explicitTimeout = parseInt(step.wait_for_element_timeout_ms ?? step.waitForElementTimeoutMs, 10);
            if (Number.isFinite(explicitTimeout) && explicitTimeout >= 0) {
                return explicitTimeout;
            }

            return isVerificationSensitiveStep ? Math.min(timeout, 12000) : 0;
        })();
        const waitForElementIntervalMs = (() => {
            const explicitInterval = parseInt(step.wait_for_element_interval_ms ?? step.waitForElementIntervalMs, 10);
            if (Number.isFinite(explicitInterval) && explicitInterval >= 0) {
                return explicitInterval;
            }

            return 100;
        })();
        const typeOperationTimeoutMs = (() => {
            const explicitTimeout = parseInt(
                step.type_operation_timeout_ms ??
                step.typeOperationTimeoutMs ??
                step.input_operation_timeout_ms ??
                step.inputOperationTimeoutMs,
                10
            );
            if (Number.isFinite(explicitTimeout) && explicitTimeout >= 0) {
                return explicitTimeout;
            }

            return isVerificationSensitiveStep ? Math.min(timeout, 1000) : timeout;
        })();
        const stepWaitMs = (() => {
            const explicitWaitMs = parseFloat(step.wait ?? step.waitMs);
            if (Number.isFinite(explicitWaitMs) && explicitWaitMs >= 0) {
                return explicitWaitMs;
            }

            return 0;
        })();
        const maybePauseAfterTyping = async () => {
            if (!stepWaitMs || stepWaitMs <= 0) {
                return;
            }

            const nextStepReady = nextStep && typeof this._isStepReady === 'function'
                ? await this._isStepReady(browser, nextStep)
                : false;

            if (nextStepReady) {
                const nextStepName = typeof nextStep?.name === 'string' && nextStep.name.trim()
                    ? nextStep.name.trim()
                    : (nextStep?.type || 'next step');
                this.logger.debug(`步骤 ${stepName} 后下一步 ${nextStepName} 已就绪，跳过等待 ${stepWaitMs}ms`);
                return;
            }

            await this._sleepInterruptibly(stepWaitMs, `步骤 ${stepName} 输入后等待`);
        };

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    this.logger.info(`输入重试第 ${attempt + 1} 次`);
                }

                let text = this._resolveStepTemplate(step.text || '');
                let codeUsed = false;

                if (text.includes('{code}')) {
                    if (this.receivedVerificationCode) {
                        text = text.replace(/{code}/g, this.receivedVerificationCode);
                        this.logger.info(`已将 {code} 替换为实际验证码: ${this.receivedVerificationCode}`);
                        codeUsed = true;
                    } else {
                        this.logger.error('警告: 步骤文本包含 {code} 占位符，但尚未接收到验证码！');
                        this.logger.info('尝试等待 5 秒，看验证码是否会到达...');
                        for (let i = 0; i < 5; i++) {
                            await this._sleepInterruptibly(1000, `步骤 ${stepName} 等待验证码到达`);
                            if (this.receivedVerificationCode) {
                                text = text.replace(/{code}/g, this.receivedVerificationCode);
                                this.logger.info(`验证码已到达！已替换: ${this.receivedVerificationCode}`);
                                codeUsed = true;
                                break;
                            }
                        }

                        if (text.includes('{code}')) {
                            throw new Error('无法执行输入步骤：需要验证码但未获取到 (receivedVerificationCode is null)');
                        }
                    }
                }

                if (text.includes('{random}')) {
                    let randomConfig;
                    if (step.name && step.name.toLowerCase().includes('email')) {
                        randomConfig = this.emailRandomConfig?.email || { length: 8, type: 'lowercase' };
                    } else if (step.name && step.name.toLowerCase().includes('password')) {
                        randomConfig = this.randomConfig.password || { length: 12, type: 'mixed' };
                    } else {
                        randomConfig = { length: 8, type: 'alphanumeric' };
                    }

                    const randomPart = this._generateRandomStringByConfig(randomConfig);
                    text = text.replace('{random}', randomPart);

                    if (step.name && step.name.toLowerCase().includes('email')) {
                        this.rawEmail = text;
                        const prefixedEmail = this._applyCardKeyPrefixToEmail(text);
                        const emailWithSuffix = typeof this._applyEmailSuffixToEmail === 'function'
                            ? this._applyEmailSuffixToEmail(prefixedEmail)
                            : prefixedEmail;
                        this.generatedEmail = emailWithSuffix;
                        this.credentials.email = emailWithSuffix;
                        text = emailWithSuffix;
                        this.logger.info(`生成了随机邮箱: ${emailWithSuffix}`);
                    }
                }

                const stepTextHint = [
                    step.name || '',
                    step.selector || '',
                    ...(Array.isArray(step.fallback_selectors) ? step.fallback_selectors : [])
                ].join(' ').toLowerCase();
                const resolvedText = String(text || '').trim();
                const looksLikeEmailValue = /.+@.+\..+/.test(resolvedText);
                const isEmailField = /email|邮箱|e-mail/.test(stepTextHint) || looksLikeEmailValue;
                const isExplicitNonEmailField = /password|密码|code|验证码|cvv|cvn|年份|月份|日期|生日/.test(stepTextHint);
                const tempEmailService = typeof this._getTempEmailService === 'function'
                    ? this._getTempEmailService()
                    : this.app?.tempEmailService || null;
                const currentTempEmailMode = String(
                    tempEmailService?.currentMode
                    || tempEmailService?.getState?.()?.mode
                    || ''
                ).trim().toLowerCase();
                const apiModeEnabled = currentTempEmailMode === 'api';
                const tempEmailModeEnabled = currentTempEmailMode === 'temp';
                const shouldUseTempEmail = tempEmailModeEnabled && isEmailField && !isExplicitNonEmailField;
                const shouldUseApiEmail = apiModeEnabled && isEmailField && !isExplicitNonEmailField;

                if (shouldUseTempEmail) {
                    const tempEmail = await this._waitForTempEmailAddress(step, Math.max(15, Math.min(Math.ceil(timeout / 1000), 120)));
                    if (!tempEmail) {
                        throw new Error('无法获取临时邮箱地址');
                    }

                    text = tempEmail;
                    this.rawEmail = tempEmail;
                    this.generatedEmail = tempEmail;
                    this.credentials.email = tempEmail;
                    this.logger.info(`已自动获取临时邮箱: ${tempEmail}`);
                }

                if (shouldUseApiEmail) {
                    const apiEmail = await this._waitForApiEmailAddress(step, Math.max(15, Math.min(Math.ceil(timeout / 1000), 120)));
                    if (!apiEmail) {
                        throw new Error('无法获取API邮箱地址');
                    }

                    text = apiEmail;
                    this.rawEmail = apiEmail;
                    this.generatedEmail = apiEmail;
                    this.credentials.email = apiEmail;
                    this.logger.info(`已自动获取API邮箱: ${apiEmail}`);
                }

                if (isEmailField && !isExplicitNonEmailField && !shouldUseTempEmail && !shouldUseApiEmail) {
                    if (!this.rawEmail) {
                        this.rawEmail = resolvedText;
                    }

                    const prefixedEmail = this._applyCardKeyPrefixToEmail(resolvedText);
                    const emailWithSuffix = typeof this._applyEmailSuffixToEmail === 'function'
                        ? this._applyEmailSuffixToEmail(prefixedEmail)
                        : prefixedEmail;
                    text = emailWithSuffix;
                    this.credentials.email = emailWithSuffix;
                    this.generatedEmail = emailWithSuffix;

                    if (emailWithSuffix !== resolvedText) {
                        this.logger.info(`已为邮箱输入自动补齐邮箱配置: ${emailWithSuffix}`);
                    } else {
                        this.logger.info(`邮箱输入已包含邮箱配置: ${emailWithSuffix}`);
                    }
                }

                const primarySelectors = typeof this._resolveSelectorCandidates === 'function'
                    ? this._resolveSelectorCandidates(step.by, this._resolveStepTemplate(step.selector))
                    : [this._convertSelector(step.by, this._resolveStepTemplate(step.selector))];
                const primarySelector = primarySelectors[0] || '';
                this.logger.debug(`输入超时设置: ${timeout}ms`);
                const currentUrl = typeof browser.url === 'function' ? browser.url() : browser.url;
                const currentLooksVerification = verificationNeedles.some(needle => typeof currentUrl === 'string' && currentUrl.includes(needle));
                const shouldSearchAcrossPagesFirst = isVerificationSensitiveStep && !currentLooksVerification && allowCrossPageFocus;
                let activeSelector = primarySelector;
                let activeLocator = step.nth !== undefined ? browser.locator(primarySelector).nth(step.nth) : browser.locator(primarySelector);
                const openPageCount = (() => {
                    try {
                        const context = typeof browser.context === 'function' ? browser.context() : null;
                        return context && typeof context.pages === 'function'
                            ? context.pages().filter(page => page && typeof page.isClosed === 'function' && !page.isClosed()).length
                            : 1;
                    } catch (_error) {
                        return 1;
                    }
                })();
                const shouldProbeLatestPageFirst = openPageCount > 1
                    && step.disable_cross_page_type !== true
                    && step.disableCrossPageType !== true
                    && step.current_page_only !== true
                    && step.currentPageOnly !== true;

                if (shouldProbeLatestPageFirst && !shouldSearchAcrossPagesFirst) {
                    this.logger.info(`步骤 ${stepName} 检测到 ${openPageCount} 个打开页面，优先跨页查找输入框`);
                    const latestPageFilled = await this._typeAcrossOpenPages(
                        browser,
                        step,
                        primarySelector,
                        text,
                        Math.min(timeout, Math.max(1500, waitForElementTimeoutMs || 3000)),
                        stepName,
                        browserId,
                        { preferLatestPage: true }
                    );
                    if (latestPageFilled) {
                        if (step.name && step.name.toLowerCase().includes('password')) {
                            try {
                                this.credentials.password = text;
                            } catch (_error) {}
                        }

                        if (codeUsed && this.emailClient && this.credentials.email) {
                            try {
                                this.logger.info(`验证码已填写，准备删除服务器记录: ${this.credentials.email}`);
                                await this.emailClient.deleteVerificationCode(this.credentials.email);
                                this.logger.info('✅ 验证码记录已删除');
                            } catch (delError) {
                                this.logger.warning(`删除验证码记录失败: ${delError.message}`);
                            }
                        }

                        if (isOptional) {
                            this.logger.debug(`可选步骤 ${stepName} 执行成功`);
                        } else {
                            this.logger.info(`步骤 ${stepName} 执行成功`);
                        }

                        await maybePauseAfterTyping();
                        return true;
                    }
                }

                if (waitForElementTimeoutMs > 0) {
                    const waitSelectors = [...primarySelectors];
                    for (const fallback of step.fallback_selectors || []) {
                        const fallbackSelectors = typeof this._resolveSelectorCandidates === 'function'
                            ? this._resolveSelectorCandidates(step.by, this._resolveStepTemplate(fallback))
                            : [this._convertSelector(step.by, this._resolveStepTemplate(fallback))];
                        for (const fallbackSelector of fallbackSelectors) {
                            if (fallbackSelector && !waitSelectors.includes(fallbackSelector)) {
                                waitSelectors.push(fallbackSelector);
                            }
                        }
                    }

                    this.logger.info(`步骤 ${stepName} 等待输入框就绪，超时: ${waitForElementTimeoutMs}ms`);
                    let matchedReady = false;
                    for (const selector of waitSelectors) {
                        try {
                            const candidate = step.nth !== undefined ? browser.locator(selector).nth(step.nth) : browser.locator(selector);
                            const count = await candidate.count().catch(() => 0);
                            if (count === 0) {
                                continue;
                            }

                            await candidate.waitFor({ state: 'visible', timeout: waitForElementTimeoutMs }).catch(async () => {
                                await candidate.waitFor({ state: 'attached', timeout: waitForElementTimeoutMs }).catch(() => {});
                            });

                            const ready = await this._waitForLocatorEnabled(candidate, waitForElementTimeoutMs, waitForElementIntervalMs);
                            if (ready) {
                                activeSelector = selector;
                                activeLocator = candidate;
                                matchedReady = true;
                                this.logger.info(`步骤 ${stepName} 输入框已就绪: ${selector}`);
                                break;
                            }
                        } catch (readyError) {
                            this.logger.debug(`等待输入框就绪失败 ${selector}: ${readyError.message}`);
                        }
                    }

                    if (!matchedReady && isVerificationSensitiveStep) {
                        this.logger.info(`步骤 ${stepName} 当前页输入框未立即就绪${allowCrossPageFocus ? '，尝试跨页查找' : '，继续在当前页查找'}`);
                        const currentPageFilled = await this._typeAcrossOpenPages(
                            browser,
                            step,
                            primarySelector,
                            text,
                            Math.min(timeout, waitForElementTimeoutMs || timeout),
                            stepName,
                            browserId,
                            { currentPageOnly: true }
                        );
                        if (currentPageFilled) {
                            if (step.name && step.name.toLowerCase().includes('password')) {
                                try {
                                    this.credentials.password = text;
                                } catch (_error) {}
                            }

                            if (codeUsed && this.emailClient && this.credentials.email) {
                                try {
                                    this.logger.info(`验证码已填写，准备删除服务器记录: ${this.credentials.email}`);
                                    await this.emailClient.deleteVerificationCode(this.credentials.email);
                                    this.logger.info('✅ 验证码记录已删除');
                                } catch (delError) {
                                    this.logger.warning(`删除验证码记录失败: ${delError.message}`);
                                }
                            }

                            if (isOptional) {
                                this.logger.debug(`可选步骤 ${stepName} 执行成功`);
                            } else {
                                this.logger.info(`步骤 ${stepName} 执行成功`);
                            }

                            await maybePauseAfterTyping();
                            return true;
                        }

                        if (allowCrossPageFocus) {
                            const crossPageFilled = await this._typeAcrossOpenPages(browser, step, primarySelector, text, Math.min(timeout, waitForElementTimeoutMs || timeout), stepName, browserId);
                            if (crossPageFilled) {
                                if (step.name && step.name.toLowerCase().includes('password')) {
                                    try {
                                        this.credentials.password = text;
                                    } catch (_error) {}
                                }

                                if (codeUsed && this.emailClient && this.credentials.email) {
                                    try {
                                        this.logger.info(`验证码已填写，准备删除服务器记录: ${this.credentials.email}`);
                                        await this.emailClient.deleteVerificationCode(this.credentials.email);
                                        this.logger.info('✅ 验证码记录已删除');
                                    } catch (delError) {
                                        this.logger.warning(`删除验证码记录失败: ${delError.message}`);
                                    }
                                }

                                if (isOptional) {
                                    this.logger.debug(`可选步骤 ${stepName} 执行成功`);
                                } else {
                                    this.logger.info(`步骤 ${stepName} 执行成功`);
                                }

                                await maybePauseAfterTyping();
                                return true;
                            }
                        }
                    }
                }

                if (shouldSearchAcrossPagesFirst) {
                    this.logger.info(`步骤 ${stepName} 优先在验证码/验证页面中查找输入框`);
                    const crossPageFilled = await this._typeAcrossOpenPages(browser, step, primarySelector, text, timeout, stepName, browserId);
                    if (crossPageFilled) {
                        if (step.name && step.name.toLowerCase().includes('password')) {
                            try {
                                this.credentials.password = text;
                            } catch (_error) {}
                        }

                        if (codeUsed && this.emailClient && this.credentials.email) {
                            try {
                                this.logger.info(`验证码已填写，准备删除服务器记录: ${this.credentials.email}`);
                                await this.emailClient.deleteVerificationCode(this.credentials.email);
                                this.logger.info('✅ 验证码记录已删除');
                            } catch (delError) {
                                this.logger.warning(`删除验证码记录失败: ${delError.message}`);
                            }
                        }

                        if (isOptional) {
                            this.logger.debug(`可选步骤 ${stepName} 执行成功`);
                        } else {
                            this.logger.info(`步骤 ${stepName} 执行成功`);
                        }

                        await maybePauseAfterTyping();
                        return true;
                    }
                }

                try {
                    this.logger.debug(`尝试输入到选择器: ${activeSelector}`);
                    await this._typeTextIntoLocator(activeLocator, text, Math.min(timeout, typeOperationTimeoutMs), step);
                    this.logger.debug('主要选择器输入成功');
                } catch (primaryError) {
                    this.logger.warning(`主要选择器输入失败: ${primaryError.message}`);
                    const fallbackSelectors = step.fallback_selectors || [];
                    let filled = false;

                    for (const fallback of fallbackSelectors) {
                        this.logger.debug(`尝试备用选择器: ${fallback}`);
                        const fallbackSelectorCandidates = typeof this._resolveSelectorCandidates === 'function'
                            ? this._resolveSelectorCandidates(step.by, this._resolveStepTemplate(fallback))
                            : [this._convertSelector(step.by, this._resolveStepTemplate(fallback))];
                        for (const fallbackSelector of fallbackSelectorCandidates) {
                            try {
                                const fallbackLocator = step.nth !== undefined ? browser.locator(fallbackSelector).nth(step.nth) : browser.locator(fallbackSelector);
                                if (waitForElementTimeoutMs > 0) {
                                    await fallbackLocator.waitFor({ state: 'visible', timeout: waitForElementTimeoutMs }).catch(() => {});
                                }
                                await this._typeTextIntoLocator(fallbackLocator, text, Math.min(timeout, typeOperationTimeoutMs), step);
                                this.logger.info(`备用选择器输入成功: ${fallback}`);
                                filled = true;
                                break;
                            } catch (fallbackError) {
                                this.logger.debug(`备用选择器候选失败 ${fallbackSelector}: ${fallbackError.message}`);
                            }
                        }
                        if (filled) {
                            break;
                        }
                    }

                    if (!filled) {
                        try {
                            filled = await this._typeAcrossOpenPages(
                                browser,
                                step,
                                primarySelector,
                                text,
                                timeout,
                                stepName,
                                browserId,
                                { currentPageOnly: isVerificationSensitiveStep && !allowCrossPageFocus }
                            );
                        } catch (crossPageError) {
                            this.logger.debug(`全页面输入失败: ${crossPageError.message}`);
                        }
                    }

                    if (!filled) {
                        if (attempt === maxRetries - 1) {
                            throw primaryError;
                        }
                        this.logger.warning(`第 ${attempt + 1} 次输入失败，${retryDelay}秒后重试`);
                        await this._sleepInterruptibly(retryDelay * 1000, `步骤 ${stepName} 输入重试等待`);
                        continue;
                    }
                }

                if (step.name && step.name.toLowerCase().includes('password')) {
                    try {
                        this.credentials.password = text;
                    } catch (_error) {}
                }

                if (codeUsed && this.emailClient && this.credentials.email) {
                    try {
                        this.logger.info(`验证码已填写，准备删除服务器记录: ${this.credentials.email}`);
                        await this.emailClient.deleteVerificationCode(this.credentials.email);
                        this.logger.info('✅ 验证码记录已删除');
                    } catch (delError) {
                        this.logger.warning(`删除验证码记录失败: ${delError.message}`);
                    }
                }

                if (isOptional) {
                    this.logger.debug(`可选步骤 ${stepName} 执行成功`);
                } else {
                    this.logger.info(`步骤 ${stepName} 执行成功`);
                }

                await maybePauseAfterTyping();
                return true;
            } catch (error) {
                if (attempt === maxRetries - 1) {
                    this.logger.error(`输入失败 (已重试 ${maxRetries} 次): ${error.message}`);
                    throw error;
                }

                this.logger.warning(`第 ${attempt + 1} 次输入失败，${retryDelay}秒后重试: ${error.message}`);
                await this._sleepInterruptibly(retryDelay * 1000, `步骤 ${stepName} 输入重试等待`);
            }
        }
    },

    _resolveTypeChunkSize(step = {}) {
        const raw = step.type_chunk_size ?? step.typeChunkSize ?? step.input_chunk_size ?? step.inputChunkSize;
        const size = parseInt(raw, 10);
        return Number.isFinite(size) && size > 0 ? size : 0;
    },

    _resolveTypeChunkDelayMs(step = {}) {
        const raw = step.type_chunk_delay_ms ?? step.typeChunkDelayMs ?? step.input_chunk_delay_ms ?? step.inputChunkDelayMs;
        const delay = parseInt(raw, 10);
        return Number.isFinite(delay) && delay >= 0 ? delay : 0;
    },

    _resolveTypeCharDelayMs(step = {}) {
        const raw = step.type_char_delay_ms ?? step.typeCharDelayMs ?? step.input_char_delay_ms ?? step.inputCharDelayMs;
        const delay = parseInt(raw, 10);
        return Number.isFinite(delay) && delay >= 0 ? delay : 0;
    },

    _resolveTypeOperationTimeoutMs(step = {}, fallbackTimeout = 30000) {
        const raw = step.type_operation_timeout_ms ?? step.typeOperationTimeoutMs ?? step.input_operation_timeout_ms ?? step.inputOperationTimeoutMs;
        const timeout = parseInt(raw, 10);
        return Number.isFinite(timeout) && timeout >= 0 ? timeout : fallbackTimeout;
    },

    async _typeTextIntoLocator(locator, text, timeout, step = {}) {
        const chunkSize = this._resolveTypeChunkSize(step);
        const stepTextHint = [
            step.name || '',
            step.selector || '',
            ...(Array.isArray(step.fallback_selectors) ? step.fallback_selectors : [])
        ].join(' ').toLowerCase();
        const isSensitiveKeyInput = /验证码|verification|code|otp|cvv|stepup|验证/.test(stepTextHint);
        const operationTimeout = this._resolveTypeOperationTimeoutMs(
            step,
            isSensitiveKeyInput ? Math.min(timeout, 1000) : timeout
        );
        const shouldClickBeforeType = step.click_before_type === true || step.clickBeforeType === true;
        const clickBeforeType = async () => {
            if (!shouldClickBeforeType) {
                return false;
            }

            try {
                await locator.click({ timeout: Math.max(250, Math.min(operationTimeout, 2000)), force: true });
                return true;
            } catch (_clickError) {
                return false;
            }
        };

        if (chunkSize > 0) {
            await clickBeforeType();
            await this._typeTextInChunks(locator, text, timeout, step);
            return true;
        }

        if (isSensitiveKeyInput) {
            await clickBeforeType();

            try {
                await locator.fill('', { timeout: operationTimeout });
            } catch (_clearError) {}

            try {
                await locator.type(String(text || ''), {
                    timeout: operationTimeout,
                    delay: this._resolveTypeCharDelayMs(step) || 40
                });
                return true;
            } catch (typeError) {
                try {
                    await locator.fill(text, { timeout: operationTimeout });
                    return true;
                } catch (_fillError) {
                    throw typeError;
                }
            }
        }

        try {
            await clickBeforeType();
            await locator.fill(text, { timeout: operationTimeout });
            return true;
        } catch (fillError) {
            try {
                await locator.click({ timeout: operationTimeout, force: true });
            } catch (_clickError) {}

            try {
                await locator.type(text, { timeout: operationTimeout, delay: this._resolveTypeCharDelayMs(step) });
                return true;
            } catch (_typeError) {
                throw fillError;
            }
        }
    },

    async _typeTextInChunks(locator, text, timeout, step = {}) {
        const chunkSize = this._resolveTypeChunkSize(step);
        const chunkDelayMs = this._resolveTypeChunkDelayMs(step);
        const charDelayMs = this._resolveTypeCharDelayMs(step);
        const safeText = String(text || '');

        if (chunkSize <= 0) {
            throw new Error('分段输入参数无效');
        }

        this.logger.debug(`分段输入: chunkSize=${chunkSize}, chunkDelayMs=${chunkDelayMs}, charDelayMs=${charDelayMs}`);

        try {
            await locator.fill('', { timeout });
        } catch (_clearError) {
            try {
                await locator.click({ timeout, force: true });
            } catch (_clickError) {}
        }

        let offset = 0;
        while (offset < safeText.length) {
            const chunk = safeText.slice(offset, offset + chunkSize);
            if (!chunk) {
                break;
            }

            await locator.type(chunk, { timeout, delay: charDelayMs });
            offset += chunkSize;

            if (offset < safeText.length && chunkDelayMs > 0) {
                await this._sleepInterruptibly(chunkDelayMs, `步骤 ${step?.name || 'type'} 分段输入等待`);
            }
        }

        return true;
    },

    async _typeAcrossOpenPages(browser, step, primarySelector, text, timeout, stepName = '', browserId = null, options = {}) {
        if (!browser || typeof browser.context !== 'function') {
            return false;
        }

        const context = browser.context();
        if (!context || typeof context.pages !== 'function') {
            return false;
        }

        const currentPageOnly = options.currentPageOnly === true;
        const preferLatestPage = options.preferLatestPage === true;

        const selectors = [];
        if (primarySelector) {
            const primaryCandidates = typeof this._resolveSelectorCandidates === 'function'
                ? this._resolveSelectorCandidates(step.by, primarySelector)
                : [primarySelector];
            selectors.push(...primaryCandidates);
        }

        for (const fallback of step.fallback_selectors || []) {
            const fallbackCandidates = typeof this._resolveSelectorCandidates === 'function'
                ? this._resolveSelectorCandidates(step.by, this._resolveStepTemplate(fallback))
                : [this._convertSelector(step.by, this._resolveStepTemplate(fallback))];
            for (const fallbackSelector of fallbackCandidates) {
                if (fallbackSelector && !selectors.includes(fallbackSelector)) {
                    selectors.push(fallbackSelector);
                }
            }
        }

        const stepContextText = [
            stepName,
            step.name,
            step.selector,
            step.text_match,
            ...(Array.isArray(step.fallback_selectors) ? step.fallback_selectors : [])
        ]
            .filter(value => typeof value === 'string' && value.trim())
            .join(' ')
            .toLowerCase();
        const isVerificationSensitiveStep = /验证码|verification|code|cvv|otp|3ds|stepup|验证/.test(stepContextText);
        const verificationNeedles = [
            'centinelapi.cardinalcommerce.com/V2/Cruise/StepUp',
            'acs.stripeauthentications.com/cld/challengeRequestBrowser',
            'acs.stripeauthentications.com',
            'challengeRequestBrowser'
        ];
        const orderedPages = [];
        const pushUniquePage = (page) => {
            if (page && !orderedPages.includes(page)) {
                orderedPages.push(page);
            }
        };
        const pollIntervalMs = (() => {
            const explicitInterval = parseInt(
                step.type_search_poll_interval_ms
                ?? step.typeSearchPollIntervalMs
                ?? step.wait_for_element_interval_ms
                ?? step.waitForElementIntervalMs,
                10
            );
            if (Number.isFinite(explicitInterval) && explicitInterval > 0) {
                return Math.max(50, explicitInterval);
            }

            return 120;
        })();
        const quickProbeTimeoutMs = (() => {
            const explicitTimeout = parseInt(step.type_search_probe_timeout_ms ?? step.typeSearchProbeTimeoutMs, 10);
            if (Number.isFinite(explicitTimeout) && explicitTimeout > 0) {
                return Math.max(50, explicitTimeout);
            }

            return Math.max(80, Math.min(250, pollIntervalMs));
        })();
        const progressLogIntervalMs = (() => {
            const explicitInterval = parseInt(step.type_search_log_interval_ms ?? step.typeSearchLogIntervalMs, 10);
            if (Number.isFinite(explicitInterval) && explicitInterval > 0) {
                return explicitInterval;
            }

            return 3000;
        })();
        const searchDeadline = Date.now() + Math.max(250, timeout || 0);
        const loggedCandidates = new Set();
        let lastProgressLogAt = 0;

        while (Date.now() <= searchDeadline) {
            orderedPages.length = 0;
            const pages = currentPageOnly
                ? [browser].filter(page => page && typeof page.isClosed === 'function' && !page.isClosed())
                : context.pages().filter(page => page && typeof page.isClosed === 'function' && !page.isClosed());

            if (isVerificationSensitiveStep && !currentPageOnly) {
                for (const needle of verificationNeedles) {
                    for (const page of pages) {
                        const pageUrl = typeof page.url === 'function' ? page.url() : page.url;
                        if (typeof pageUrl === 'string' && pageUrl.includes(needle)) {
                            pushUniquePage(page);
                        }
                    }
                }
            }

            if (preferLatestPage && !currentPageOnly) {
                for (const page of [...pages].reverse()) {
                    pushUniquePage(page);
                }
            }

            if (pages.includes(browser)) {
                pushUniquePage(browser);
            }
            if (!currentPageOnly && !preferLatestPage) {
                for (const page of pages) {
                    if (page !== browser) {
                        pushUniquePage(page);
                    }
                }
            }

            for (const page of orderedPages) {
                const pageTitle = await page.title().catch(() => '');
                const pageUrl = typeof page.url === 'function' ? page.url() : page.url;
                const pageKey = `${pageTitle || 'unknown'}|${pageUrl || 'unknown'}`;
                if (!loggedCandidates.has(pageKey)) {
                    this.logger.info(`全页面输入候选: ${pageTitle || 'unknown'} | ${pageUrl || 'unknown'}`);
                    loggedCandidates.add(pageKey);
                }

                for (const selector of selectors) {
                    try {
                        const filled = await this._fillSelectorInTarget(page, selector, text, timeout, step, {
                            probeTimeoutMs: quickProbeTimeoutMs
                        });
                        if (filled) {
                            if (!currentPageOnly && browserId && this.browserManager && typeof this.browserManager.setBrowserPage === 'function') {
                                await this.browserManager.setBrowserPage(browserId, page);
                            }

                            this.logger.info(`全页面输入成功: ${selector} | 页面: ${pageTitle || 'unknown'} | ${pageUrl || 'unknown'}`);
                            return true;
                        }
                    } catch (error) {
                        this.logger.debug(`全页面输入选择器失败 ${selector} | 页面: ${pageUrl || 'unknown'}: ${error.message}`);
                    }
                }

                if (typeof page.frames === 'function') {
                    const mainFrame = typeof page.mainFrame === 'function' ? page.mainFrame() : null;
                    for (const frame of page.frames()) {
                        if (mainFrame && frame === mainFrame) {
                            continue;
                        }

                        const frameUrl = typeof frame.url === 'function' ? frame.url() : frame.url;
                        for (const selector of selectors) {
                            try {
                                const filled = await this._fillSelectorInTarget(frame, selector, text, timeout, step, {
                                    probeTimeoutMs: quickProbeTimeoutMs
                                });
                                if (filled) {
                                    if (!currentPageOnly && browserId && this.browserManager && typeof this.browserManager.setBrowserPage === 'function') {
                                        await this.browserManager.setBrowserPage(browserId, page);
                                    }

                                    this.logger.info(`全页面Frame搜索输入成功: ${selector} | 页面: ${pageUrl || 'unknown'} | Frame: ${frameUrl || 'unknown'}`);
                                    return true;
                                }
                            } catch (error) {
                                this.logger.debug(`全页面Frame输入选择器失败 ${selector} | Frame: ${frameUrl || 'unknown'}: ${error.message}`);
                            }
                        }
                    }
                }
            }

            const now = Date.now();
            if (now - lastProgressLogAt >= progressLogIntervalMs && now < searchDeadline) {
                const waitedMs = Math.max(0, searchDeadline - now);
                this.logger.info(`步骤 ${stepName || step.name || 'type'} 仍在轮询输入框，剩余等待 ${waitedMs}ms`);
                lastProgressLogAt = now;
            }

            const remainingMs = searchDeadline - Date.now();
            if (remainingMs <= 0) {
                break;
            }

            await this._sleepInterruptibly(Math.min(pollIntervalMs, remainingMs), `步骤 ${stepName || step.name || 'type'} 跨页输入轮询`);
        }

        return false;
    },

    async _fillSelectorInTarget(target, selector, text, timeout, step = {}, options = {}) {
        if (!target || typeof target.locator !== 'function') {
            return false;
        }

        const waitTimeoutMs = (() => {
            const overrideTimeout = parseInt(options.probeTimeoutMs, 10);
            if (Number.isFinite(overrideTimeout) && overrideTimeout > 0) {
                return overrideTimeout;
            }

            const explicitTimeout = parseInt(step.wait_for_element_timeout_ms ?? step.waitForElementTimeoutMs, 10);
            if (Number.isFinite(explicitTimeout) && explicitTimeout >= 0) {
                return Math.min(explicitTimeout, Math.max(500, timeout || explicitTimeout));
            }

            return Math.max(500, Math.min(timeout || 1500, 3000));
        })();
        const locator = target.locator(selector);
        const probeLocator = step.nth !== undefined ? locator.nth(step.nth) : locator.first();

        let count = await locator.count().catch(() => 0);
        if (count === 0) {
            await probeLocator.waitFor({ state: 'attached', timeout: waitTimeoutMs }).catch(() => {});
            count = await locator.count().catch(() => 0);
        }
        if (count === 0) {
            return false;
        }

        const fillTarget = step.nth !== undefined ? locator.nth(step.nth) : (count > 1 ? locator.first() : locator);
        let isVisible = await fillTarget.isVisible().catch(() => false);
        if (!isVisible) {
            await fillTarget.waitFor({ state: 'visible', timeout: waitTimeoutMs }).catch(() => {});
            isVisible = await fillTarget.isVisible().catch(() => false);
        }
        if (!isVisible) {
            return false;
        }

        let isEditable = await fillTarget.isEditable().catch(() => true);
        if (!isEditable) {
            const ready = typeof this._waitForLocatorEnabled === 'function'
                ? await this._waitForLocatorEnabled(fillTarget, waitTimeoutMs, 100)
                : false;
            isEditable = ready && await fillTarget.isEditable().catch(() => false);
        }
        if (!isEditable) {
            return false;
        }

        const chunkSize = this._resolveTypeChunkSize(step);

        try {
            await this._typeTextIntoLocator(fillTarget, text, timeout, step);
            return true;
        } catch (fillError) {
            if (chunkSize > 0) {
                this.logger.debug(`分段输入失败，继续尝试其它选择器/页面: ${fillError.message}`);
                throw fillError;
            }

            try {
                await fillTarget.click({ timeout, force: true });
            } catch (_clickError) {}

            try {
                await fillTarget.type(text, { timeout });
                return true;
            } catch (_typeError) {
                throw fillError;
            }
        }
    },

    async _nativeClickLocator(locator, timeout) {
        if (!locator || typeof locator.evaluate !== 'function') {
            return false;
        }

        try {
            await locator.evaluate((element) => {
                if (!element) return false;
                if (typeof element.click === 'function') {
                    element.click();
                    return true;
                }

                return element.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                }));
            }, { timeout });
            return true;
        } catch (_error) {
            return false;
        }
    },

    async _waitForLocatorEnabled(locator, timeout = 1500, intervalMs = 100) {
        if (!locator) {
            return false;
        }

        const deadline = Date.now() + Math.max(0, timeout);
        while (Date.now() < deadline) {
            try {
                const visible = typeof locator.isVisible === 'function' ? await locator.isVisible().catch(() => false) : true;
                const enabled = typeof locator.isEnabled === 'function' ? await locator.isEnabled().catch(() => false) : true;
                if (visible && enabled) {
                    return true;
                }
            } catch (_error) {}

            await this._sleepInterruptibly(Math.max(25, intervalMs), '等待输入框可用', Math.max(25, intervalMs));
        }

        return false;
    },

};
