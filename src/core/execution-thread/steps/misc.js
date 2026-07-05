const {
    defaultEscapeCssIdentifier,
    extractNativeElementSelectorCandidates
} = require('../../selector-utils');

const { fetchHaikaSmsCodeFromUrl, pageUrlMatchesNeedle } = require('./shared');

const sleep = async (thread, ms, context = '') => {
    if (thread && typeof thread._sleepInterruptibly === 'function') {
        return thread._sleepInterruptibly(ms, context);
    }

    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
};

function sanitizeCookieFilePart(value = '') {
    return String(value || '')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

module.exports = {
    _escapeCssIdentifier(value) {
        return defaultEscapeCssIdentifier(value);
    },

    _extractNativeElementSelectorCandidates(selector = '') {
        return extractNativeElementSelectorCandidates(selector, {
            escapeCssIdentifier: this._escapeCssIdentifier.bind(this)
        });
    },

    _extractAutoSelectorCandidates(selector = '') {
        const normalized = String(selector || '').trim();
        if (!normalized) {
            return [];
        }

        if (normalized[0] === '<') {
            return this._extractNativeElementSelectorCandidates(normalized);
        }

        if (/^(?:text=|xpath=|id=|css=|class=|name=|placeholder=|aria-label=|aria=)/i.test(normalized)) {
            return [this._convertSelector('auto', normalized)];
        }

        const nativeCandidates = this._extractNativeElementSelectorCandidates(normalized);
        if (nativeCandidates.length > 0) {
            return nativeCandidates;
        }

        if (/^[.#\[]/.test(normalized) || normalized.includes(':has-text(') || normalized.includes('>>') || normalized.includes('[')) {
            return [normalized];
        }

        if (/\s/.test(normalized)) {
            return [`text=${normalized}`];
        }

        return [
            normalized,
            `text=${normalized}`
        ];
    },

    _resolveSelectorCandidates(by, selector) {
        const normalizedSelector = typeof selector === 'string' ? selector.trim() : '';
        if (!normalizedSelector) {
            return [];
        }

        const normalizedBy = String(by || 'auto').trim().toLowerCase() || 'auto';

        if (normalizedBy === 'auto') {
            const autoCandidates = this._extractAutoSelectorCandidates(normalizedSelector);
            if (autoCandidates.length > 0) {
                return autoCandidates;
            }
        }

        if (normalizedBy === 'css_selector') {
            const nativeCandidates = this._extractNativeElementSelectorCandidates(normalizedSelector);
            if (nativeCandidates.length > 0) {
                return nativeCandidates;
            }
        }

        const convertedSelector = this._convertSelector(normalizedBy, normalizedSelector);
        return convertedSelector ? [convertedSelector] : [];
    },

    _resolveSelectorCandidate(by, selector) {
        const candidates = this._resolveSelectorCandidates(by, selector);
        return candidates.length > 0 ? candidates[0] : '';
    },

    async _executeWaitStep(browser, step, nextStep = null) {
        if (typeof this._ensureBrowserAvailable === 'function') {
            browser = await this._ensureBrowserAvailable(`步骤 ${step?.name || 'wait'} 等待前检查`);
        }
        const pageNeedles = typeof this._collectStepPageNeedles === 'function'
            ? this._collectStepPageNeedles(step)
            : [];
        let lastObservedState = null;
        const describeState = (state) => {
            if (!state) {
                return 'unknown | unknown';
            }

            return `${state.currentTitle || 'unknown'} | ${state.currentUrl || 'unknown'}`;
        };
        const snapshotCurrentState = async () => {
            const currentUrl = typeof browser?.url === 'function' ? browser.url() : browser?.url;
            let currentTitle = '';
            try {
                currentTitle = typeof browser?.title === 'function' ? await browser.title().catch(() => '') : '';
            } catch (_error) {}

            return { currentUrl, currentTitle };
        };
        const pageNeedleMatched = () => {
            if (pageNeedles.length === 0) {
                return false;
            }

            const pages = [];
            try {
                if (browser && typeof browser.context === 'function') {
                    const context = browser.context();
                    if (context && typeof context.pages === 'function') {
                        pages.push(...context.pages().filter(page => page && typeof page.isClosed === 'function' ? !page.isClosed() : true));
                    }
                }
            } catch (_error) {}

            if (pages.length === 0 && browser) {
                pages.push(browser);
            }

            const resolveUrl = (target) => {
                try {
                    return typeof target.url === 'function' ? target.url() : target.url;
                } catch (_error) {
                    return '';
                }
            };

            return pages.some(page => {
                const pageUrl = resolveUrl(page);
                return typeof pageUrl === 'string' && pageNeedles.some(needle => pageUrlMatchesNeedle(pageUrl, needle));
            });
        };
        const getCurrentPageState = async () => {
            const currentState = await snapshotCurrentState();

            let openPages = '';
            try {
                openPages = typeof this._describeOpenPages === 'function'
                    ? await this._describeOpenPages(browser)
                    : '';
            } catch (_error) {}

            return { ...currentState, openPages };
        };
        const waitTimeoutMs = (() => {
            const explicitTimeout = parseInt(
                step.wait_timeout_ms
                ?? step.waitTimeoutMs
                ?? step.stability_timeout
                ?? step.stabilityTimeout
                ?? step.timeout,
                10
            );
            if (Number.isFinite(explicitTimeout) && explicitTimeout > 0) {
                return explicitTimeout;
            }

            return 15000;
        })();
        const waitIntervalMs = (() => {
            const explicitInterval = parseInt(step.wait_poll_interval_ms ?? step.waitPollIntervalMs, 10);
            if (Number.isFinite(explicitInterval) && explicitInterval > 0) {
                return explicitInterval;
            }

            return 150;
        })();

        if (pageNeedles.length > 0) {
            const waitLabel = `页面跳转到 ${pageNeedles.join(' / ')}`;
            this.logger.info(`执行等待: ${waitLabel}，超时: ${waitTimeoutMs}ms`);

            const deadline = Date.now() + waitTimeoutMs;
            while (Date.now() <= deadline) {
                lastObservedState = await snapshotCurrentState();
                if (pageNeedleMatched() || await this._isStepReady(browser, step)) {
                    this.logger.info(`等待条件已满足: ${waitLabel}`);
                    return true;
                }

                await sleep(this, waitIntervalMs, `步骤 ${step.name || 'wait'} 等待页面条件`);
            }

            const state = await getCurrentPageState();
            const observedState = lastObservedState || state;
            const currentStateText = describeState(state);
            const observedStateText = describeState(observedState);
            const observedPrefix = observedStateText !== currentStateText
                ? `，最后看到: ${observedStateText}`
                : '';
            throw new Error(`等待条件超时: ${waitLabel}${observedPrefix}，当前页面: ${currentStateText}${state.openPages ? `；打开页: ${state.openPages}` : ''}`);
        }

        if (step.wait_for_text || step.wait_for_element) {
            const waitForText = this._resolveStepTemplate(step.wait_for_text);
            const waitForElement = this._resolveStepTemplate(step.wait_for_element);
            const waitLabel = waitForText ? `文本 "${waitForText}"` : `元素 ${waitForElement}`;
            this.logger.info(`执行等待: ${waitLabel}，超时: ${waitTimeoutMs}ms`);

            const deadline = Date.now() + waitTimeoutMs;
            while (Date.now() <= deadline) {
                lastObservedState = await snapshotCurrentState();
                if (await this._isStepReady(browser, step)) {
                    this.logger.info(`等待条件已满足: ${waitLabel}`);
                    break;
                }

                await sleep(this, waitIntervalMs, `步骤 ${step.name || 'wait'} 等待元素或文本`);
            }

            if (!(await this._isStepReady(browser, step))) {
                const state = await getCurrentPageState();
                const observedState = lastObservedState || state;
                const currentStateText = describeState(state);
                const observedStateText = describeState(observedState);
                const observedPrefix = observedStateText !== currentStateText
                    ? `，最后看到: ${observedStateText}`
                    : '';
                throw new Error(`等待条件超时: ${waitLabel}${observedPrefix}，当前页面: ${currentStateText}${state.openPages ? `；打开页: ${state.openPages}` : ''}`);
            }
        }

        const waitForTextHidden = this._resolveStepTemplate(step.wait_for_text_hidden || step.waitForTextHidden);
        if (waitForTextHidden) {
            const hiddenTimeout = Number.isFinite(parseInt(step.wait_for_text_hidden_timeout_ms ?? step.waitForTextHiddenTimeoutMs, 10))
                ? parseInt(step.wait_for_text_hidden_timeout_ms ?? step.waitForTextHiddenTimeoutMs, 10)
                : ((step.timeout || 30000));
            const hiddenInterval = Number.isFinite(parseInt(step.wait_for_text_hidden_interval_ms ?? step.waitForTextHiddenIntervalMs, 10))
                ? parseInt(step.wait_for_text_hidden_interval_ms ?? step.waitForTextHiddenIntervalMs, 10)
                : 300;
            const textSelector = `text=${waitForTextHidden}`;
            const textLocator = browser.locator(textSelector);
            this.logger.info(`等待文本消失: "${waitForTextHidden}"，超时: ${hiddenTimeout}ms`);
            const deadline = Date.now() + hiddenTimeout;
            while (Date.now() <= deadline) {
                const matchCount = await textLocator.count().catch(() => 0);
                let visible = false;
                for (let index = 0; index < matchCount; index++) {
                    visible = await textLocator.nth(index).isVisible().catch(() => false);
                    if (visible) {
                        break;
                    }
                }
                if (!visible) {
                    this.logger.info(`文本已消失: "${waitForTextHidden}"`);
                    break;
                }

                await this._sleepInterruptibly(hiddenInterval, `步骤 ${step.name || 'wait'} 等待文本消失`);
            }
            const finalMatchCount = await textLocator.count().catch(() => 0);
            let stillVisible = false;
            for (let index = 0; index < finalMatchCount; index++) {
                stillVisible = await textLocator.nth(index).isVisible().catch(() => false);
                if (stillVisible) {
                    break;
                }
            }
            if (stillVisible) {
                throw new Error(`等待文本消失超时: ${waitForTextHidden}`);
            }
        }

        const waitForElementHidden = this._resolveStepTemplate(step.wait_for_element_hidden || step.waitForElementHidden);
        if (waitForElementHidden) {
            const hiddenTimeout = Number.isFinite(parseInt(step.wait_for_element_hidden_timeout_ms ?? step.waitForElementHiddenTimeoutMs, 10))
                ? parseInt(step.wait_for_element_hidden_timeout_ms ?? step.waitForElementHiddenTimeoutMs, 10)
                : ((step.timeout || 30000));
            const hiddenInterval = Number.isFinite(parseInt(step.wait_for_element_hidden_interval_ms ?? step.waitForElementHiddenIntervalMs, 10))
                ? parseInt(step.wait_for_element_hidden_interval_ms ?? step.waitForElementHiddenIntervalMs, 10)
                : 300;
            const selectors = this._resolveSelectorCandidates(step.wait_element_by || step.by || 'css_selector', waitForElementHidden);
            if (selectors.length === 0) {
                throw new Error(`等待元素消失失败: 未找到有效选择器 ${waitForElementHidden}`);
            }

            this.logger.info(`等待元素消失: ${selectors.join(' | ')}，超时: ${hiddenTimeout}ms`);
            const deadline = Date.now() + hiddenTimeout;
            let visible = false;
            while (Date.now() <= deadline) {
                visible = false;
                for (const selector of selectors) {
                    const locator = browser.locator(selector);
                    visible = await locator.isVisible().catch(() => false);
                    if (visible) {
                        break;
                    }
                }
                if (!visible) {
                    this.logger.info(`元素已消失: ${selectors.join(' | ')}`);
                    break;
                }

                await this._sleepInterruptibly(hiddenInterval, `步骤 ${step.name || 'wait'} 等待元素消失`);
            }
            for (const selector of selectors) {
                if (await browser.locator(selector).isVisible().catch(() => false)) {
                    throw new Error(`等待元素消失超时: ${selectors.join(' | ')}`);
                }
            }
        }

        const secondsValue = parseFloat(step.seconds);
        const waitValue = parseFloat(step.wait);
        const seconds = Number.isFinite(secondsValue) && secondsValue >= 0
            ? secondsValue
            : (Number.isFinite(waitValue) && waitValue >= 0 ? waitValue : 0);
        const hasFixedWait = seconds > 0;

        if (!hasFixedWait) {
            const nextStepReady = nextStep && typeof this._isStepReady === 'function'
                ? await this._isStepReady(browser, nextStep)
                : false;
            if (nextStepReady) {
                const nextStepName = typeof nextStep?.name === 'string' && nextStep.name.trim()
                    ? nextStep.name.trim()
                    : (nextStep?.type || 'next step');
                this.logger.debug(`等待步骤后下一步 ${nextStepName} 已就绪，跳过剩余等待`);
                return true;
            }
        }

        if (seconds <= 0) {
            return true;
        }

        const waitPollIntervalMs = (() => {
            const explicitIntervalMs = parseInt(step.wait_poll_interval_ms ?? step.waitPollIntervalMs, 10);
            if (Number.isFinite(explicitIntervalMs) && explicitIntervalMs > 0) {
                return explicitIntervalMs;
            }

            return 150;
        })();
        const deadline = Date.now() + seconds * 1000;
        while (Date.now() <= deadline) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                break;
            }

            await this._sleepInterruptibly(Math.min(waitPollIntervalMs, remaining), `步骤 ${step.name || 'wait'} 固定等待`);
        }

        return true;
    },

    async _executeScreenshotStep(browser, step) {
        const maxRetries = step.max_retries || 3;
        const retryDelay = step.retry_delay || 1;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    this.logger.info(`截图重试第 ${attempt + 1} 次`);
                }

                const path = this._resolveStepTemplate(step.path) || `screenshot_${Date.now()}.png`;
                await browser.screenshot({ path });
                return true;
            } catch (error) {
                if (attempt === maxRetries - 1) {
                    this.logger.error(`截图失败 (已重试 ${maxRetries} 次): ${error.message}`);
                    throw error;
                }

                this.logger.warning(`第 ${attempt + 1} 次截图失败，${retryDelay}秒后重试: ${error.message}`);
                await this._sleepInterruptibly(retryDelay * 1000, `步骤 ${step.name || 'screenshot'} 截图重试等待`);
            }
        }
    },

    async _executeGetCreditsStep(browser, step) {
        return await this._getCreditsFromPage(browser, step);
    },

    async _tryGetCreditsAcrossOpenPages(browser, selectors, by, timeout, step) {
        if (!browser || typeof browser.context !== 'function') {
            return await this._tryGetCredits(browser, selectors, by, timeout, step);
        }

        const context = browser.context();
        if (!context || typeof context.pages !== 'function') {
            return await this._tryGetCredits(browser, selectors, by, timeout, step);
        }

        const pages = context.pages().filter(page => {
            try {
                return page && typeof page.isClosed === 'function' ? !page.isClosed() : true;
            } catch (_error) {
                return true;
            }
        });

        if (pages.length === 0) {
            return await this._tryGetCredits(browser, selectors, by, timeout, step);
        }

        const pageNeedles = typeof this._collectStepPageNeedles === 'function'
            ? this._collectStepPageNeedles(step)
            : [];
        const currentUrl = typeof browser.url === 'function' ? browser.url() : browser.url;

        const scoredPages = pages
            .map((page, index) => {
                const url = typeof page.url === 'function' ? page.url() : page.url;
                if (!url || url === 'about:blank') {
                    return null;
                }

                let score = 0;
                const matchesPreferred = pageNeedles.some(needle => needle && typeof url === 'string' && url.includes(needle));
                if (matchesPreferred) {
                    score += 100;
                }

                if (url !== currentUrl) {
                    score += 10;
                }

                if (typeof url === 'string' && (url.includes('pippit.ai') || url.includes('credits'))) {
                    score += 20;
                }

                return { page, url, score, index };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score || b.index - a.index);

        const candidateTimeout = Math.max(1000, Math.min(parseInt(timeout, 10) || 15000, 5000));
        for (const entry of scoredPages) {
            const credits = await this._tryGetCredits(entry.page, selectors, by, candidateTimeout, {
                ...step,
                max_attempts: 1,
                max_selector_attempts: 1
            });

            if (Number.isFinite(credits)) {
                return credits;
            }
        }

        return null;
    },

    async _getCreditsFromPage(browser, step) {
        const by = step.by || 'css_selector';
        const timeout = step.timeout || 15000;
        const selectors = [];

        if (step.selector) {
            const resolvedSelector = this._resolveStepTemplate(step.selector);
            if (resolvedSelector.includes(',')) {
                selectors.push(...resolvedSelector.split(',').map(s => s.trim()));
            } else {
                selectors.push(resolvedSelector);
            }
        }
        if (step.fallback_selectors) {
            selectors.push(...step.fallback_selectors.map(item => this._resolveStepTemplate(item)));
        }
        if (selectors.length === 0) {
            selectors.push('div.credit-amount-text-VHUjL3');
        }

        const waitForCreditIncrease = step.wait_for_credit_increase === true || step.waitForCreditIncrease === true;
        const waitForCreditIncreaseTimeoutMs = (() => {
            const explicitTimeout = parseInt(step.wait_for_credit_increase_timeout_ms ?? step.waitForCreditIncreaseTimeoutMs, 10);
            if (Number.isFinite(explicitTimeout) && explicitTimeout > 0) {
                return explicitTimeout;
            }

            return 10000;
        })();
        const waitForCreditIncreaseIntervalMs = (() => {
            const explicitInterval = parseInt(step.wait_for_credit_increase_interval_ms ?? step.waitForCreditIncreaseIntervalMs, 10);
            if (Number.isFinite(explicitInterval) && explicitInterval > 0) {
                return explicitInterval;
            }

            return 500;
        })();
        const minCreditDelta = (() => {
            const explicitDelta = parseInt(step.wait_for_credit_increase_min_delta ?? step.waitForCreditIncreaseMinDelta, 10);
            if (Number.isFinite(explicitDelta) && explicitDelta >= 0) {
                return explicitDelta;
            }

            return 1;
        })();

        const searchOpenPages = step.search_open_pages === true
            || step.searchOpenPages === true
            || step.skip_page_sync === true
            || step.skipPageSync === true;
        const readLatestCredits = async (readTimeout = timeout, readStep = step) => {
            return searchOpenPages
                ? await this._tryGetCreditsAcrossOpenPages(browser, selectors, by, readTimeout, readStep)
                : await this._tryGetCredits(browser, selectors, by, readTimeout, readStep);
        };
        const singleAttemptStep = {
            ...step,
            max_attempts: 1,
            max_selector_attempts: 1
        };
        const zeroCreditNoChangeTimeoutMs = (() => {
            const explicitTimeout = parseInt(
                step.zero_credit_no_change_timeout_ms
                ?? step.zeroCreditNoChangeTimeoutMs
                ?? step.wait_for_credit_increase_timeout_ms
                ?? step.waitForCreditIncreaseTimeoutMs,
                10
            );
            if (Number.isFinite(explicitTimeout) && explicitTimeout > 0) {
                return explicitTimeout;
            }

            return 5000;
        })();
        const zeroCreditPollIntervalMs = (() => {
            const explicitInterval = parseInt(
                step.zero_credit_poll_interval_ms
                ?? step.zeroCreditPollIntervalMs
                ?? step.wait_for_credit_increase_interval_ms
                ?? step.waitForCreditIncreaseIntervalMs,
                10
            );
            if (Number.isFinite(explicitInterval) && explicitInterval > 0) {
                return explicitInterval;
            }

            return 500;
        })();
        let credits = await readLatestCredits(timeout, step);

        if (waitForCreditIncrease && Number.isFinite(credits)) {
            const baselineCredits = credits;
            const increaseDeadline = Date.now() + waitForCreditIncreaseTimeoutMs;
            this.logger.info(`等待积分数更新: 当前=${baselineCredits}，最多等待 ${waitForCreditIncreaseTimeoutMs}ms`);

            while (Date.now() <= increaseDeadline) {
                const latestCredits = await readLatestCredits(Math.min(timeout, 5000), singleAttemptStep);

                if (Number.isFinite(latestCredits) && latestCredits >= baselineCredits + minCreditDelta) {
                    this.logger.info(`积分数已更新: ${baselineCredits} -> ${latestCredits}`);
                    credits = latestCredits;
                    break;
                }

                await this._sleepInterruptibly(waitForCreditIncreaseIntervalMs, `步骤 ${step.name || 'get_credits'} 等待积分更新`);
            }
        }

        const retryOnZero = step.retry_on_zero_credits || false;
        if (credits === 0 && retryOnZero && !waitForCreditIncrease) {
            const zeroCreditDeadline = Date.now() + zeroCreditNoChangeTimeoutMs;
            this.logger.info(`获取到0积分，开始短轮询等待积分变化；若 ${zeroCreditNoChangeTimeoutMs}ms 内没有变化则结束`);

            while (Date.now() <= zeroCreditDeadline) {
                const latestCredits = await readLatestCredits(Math.min(timeout, 5000), singleAttemptStep);
                if (Number.isFinite(latestCredits) && latestCredits > 0) {
                    this.logger.info(`积分已从0变为 ${latestCredits}，结束等待`);
                    credits = latestCredits;
                    break;
                }

                const remainingMs = zeroCreditDeadline - Date.now();
                if (remainingMs <= 0) {
                    break;
                }

                await this._sleepInterruptibly(
                    Math.min(zeroCreditPollIntervalMs, remainingMs),
                    `步骤 ${step.name || 'get_credits'} 等待0积分变化`
                );
            }

            if (credits === 0) {
                this.logger.info(`积分在 ${zeroCreditNoChangeTimeoutMs}ms 内没有变化，结束等待并保留0积分`);
            }
        }

        if (credits === null || credits === undefined) {
            if (step.default !== undefined) {
                const defaultCredits = parseInt(step.default);
                this.logger.info(`获取失败，使用默认积分值: ${defaultCredits}`);
                this._credits = defaultCredits;
                return defaultCredits;
            }
            this._credits = 0;
            return 0;
        }

        this._credits = credits;
        return credits;
    },

    async _tryGetCredits(browser, selectors, by, timeout, step) {
        const maxAttempts = step.max_attempts || step.max_selector_attempts || 10;

        for (const rawSelector of selectors) {
            let attempts = 0;
            while (attempts < maxAttempts) {
                try {
                    attempts++;
                    const selectorCandidates = this._resolveSelectorCandidates(by, rawSelector);
                    this.logger.debug(`尝试获取积分 (${attempts}/${maxAttempts}): ${selectorCandidates.join(' | ')}`);

                    const elementTimeout = Math.min(timeout / maxAttempts, 3000);
                    for (const selector of selectorCandidates) {
                        try {
                            await browser.waitForSelector(selector, { state: 'visible', timeout: elementTimeout });
                        } catch (_e) {}

                        const element = await browser.$(selector);
                        if (element) {
                            const text = await element.textContent();
                            if (text) {
                                const creditMatch = text.match(/(\d+)/);
                                if (creditMatch) {
                                    const credits = parseInt(creditMatch[1]);
                                    this.logger.info(`✅ 成功获取积分数: ${credits}`);
                                    return credits;
                                }
                            }
                        }
                    }

                    if (attempts < maxAttempts) {
                        await this._sleepInterruptibly(500, `步骤 ${step.name || 'get_credits'} 获取积分轮询`);
                    }
                } catch (e) {
                    this.logger.debug(`获取积分尝试失败: ${e.message}`);
                    if (attempts < maxAttempts) {
                        await this._sleepInterruptibly(500, `步骤 ${step.name || 'get_credits'} 获取积分轮询`);
                    }
                }
            }
        }
        return null;
    },

    _convertSelector(by, selector) {
        const normalizedBy = String(by || 'auto').trim().toLowerCase() || 'auto';
        const nativeCandidates = normalizedBy === 'css_selector' || normalizedBy === 'auto'
            ? this._extractNativeElementSelectorCandidates(selector)
            : [];
        if (nativeCandidates.length > 0) {
            return nativeCandidates[0];
        }

        switch (normalizedBy) {
            case 'auto':
                if (selector.startsWith('<')) {
                    return this._extractNativeElementSelectorCandidates(selector)[0] || selector;
                }
                if (/^(?:text=|xpath=|id=|css=|class=|name=|placeholder=|aria-label=|aria=)/i.test(selector)) {
                    return selector;
                }
                if (/\s/.test(selector)) {
                    return `text=${selector}`;
                }
                return selector;
            case 'id': return `#${selector}`;
            case 'css_selector':
                if (selector.includes(':has-text(')) {
                    const match = selector.match(/:has-text\(['"](.*?)['"]\)/);
                    if (match) {
                        const text = match[1];
                        const cssPart = selector.replace(/:has-text\(['"].*?['"]\)/, '').trim();
                        if (cssPart) {
                            return `${cssPart} >> text=${text}`;
                        }
                        return `text=${text}`;
                    }
                }
                return selector;
            case 'xpath': return `xpath=${selector}`;
            case 'class_name': return `.${selector}`;
            case 'name': return `[name='${selector}']`;
            default: return selector;
        }
    },

    async _executeExternalScriptStep(step) {
        const maxRetries = step.max_retries || 3;
        const retryDelay = step.retry_delay || 1;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    this.logger.info(`外部脚本重试第 ${attempt + 1} 次`);
                }

                const result = await this._executeExternalScript(step);
                return result;
            } catch (error) {
                if (attempt === maxRetries - 1) {
                    this.logger.error(`外部脚本执行失败 (已重试 ${maxRetries} 次): ${error.message}`);
                    throw error;
                }

                this.logger.warning(`第 ${attempt + 1} 次外部脚本执行失败，${retryDelay}秒后重试: ${error.message}`);
                await this._sleepInterruptibly(retryDelay * 1000, `步骤 ${step.name || 'external_script'} 外部脚本重试等待`);
            }
        }
    },

    async _executeExternalScript(step) {
        const { exec } = require('child_process');
        const util = require('util');
        const execAsync = util.promisify(exec);
        const fs = require('fs-extra');
        const path = require('path');

        try {
            const scriptPath = step.script_path || '';
            const scriptArgs = step.args || [];

            if (!scriptPath || !await fs.pathExists(scriptPath)) {
                this.logger.error(`外部脚本不存在: ${scriptPath}`);
                return false;
            }

            if (scriptPath.includes('get_credits.py')) {
                return await this._executeGetCreditsScript();
            }

            const cmd = ['python', scriptPath, ...scriptArgs].join(' ');
            const timeout = step.timeout || 300;
            const cwd = path.dirname(scriptPath) || undefined;

            this.logger.info(`执行外部脚本: ${scriptPath}`);

            const result = await execAsync(cmd, {
                timeout: timeout * 1000,
                cwd,
                windowsHide: true
            });

            if (result.stderr) {
                this.logger.warning(`脚本警告: ${result.stderr}`);
            }

            this.logger.info(`外部脚本执行成功: ${scriptPath}`);
            if (result.stdout) {
                this.logger.info(`脚本输出: ${result.stdout}`);
            }

            return true;
        } catch (error) {
            if (error.code === 'ETIMEDOUT') {
                this.logger.error(`外部脚本执行超时: ${step.script_path}`);
            } else {
                this.logger.error(`执行外部脚本异常: ${error.message}`);
            }
            return false;
        }
    },

    async _executeSaveCookiesStep(browser, step) {
        if (typeof this._ensureBrowserAvailable === 'function') {
            browser = await this._ensureBrowserAvailable(`步骤 ${step?.name || 'save_cookies'} 保存Cookie前检查`);
        }

        const resolveIdentityValue = (primaryValue = '', fallbackValue = '') => {
            const resolved = this._resolveStepTemplate(primaryValue || fallbackValue || '');
            return String(resolved || '').trim();
        };

        const account = resolveIdentityValue(
            step?.account
            || step?.email
            || this.generatedEmail
            || this.credentials?.email
            || this.contextVariables?.email
            || this.rawEmail
            || ''
        );
        const password = resolveIdentityValue(
            step?.password
            || step?.code
            || this.receivedVerificationCode
            || this.contextVariables?.code
            || this.contextVariables?.smsCode
            || ''
        );

        if (!account) {
            throw new Error('获取Cookie失败：未找到可用于命名的账号（临时邮箱）');
        }

        if (!password) {
            throw new Error('获取Cookie失败：未找到可用于命名的密码（验证码）');
        }

        const explicitFileName = String(
            this._resolveStepTemplate(
                step?.file_name
                || step?.fileName
                || step?.cookie_file_name
                || step?.cookieFileName
                || ''
            ) || ''
        ).trim();
        const normalizedFileName = explicitFileName
            ? explicitFileName.replace(/\.json$/i, '')
            : `${sanitizeCookieFilePart(account)}_${sanitizeCookieFilePart(password)}`;
        const cardName = String(
            step?.card_name
            || step?.cardName
            || this.cardConfig?.name
            || this.activeRegistrationCardName
            || '自动化步骤Cookie'
        ).trim() || '自动化步骤Cookie';

        this.logger.info(`开始获取Cookie并保存为文件: ${normalizedFileName}.json`);

        const browserState = typeof this.browserManager?.getBrowserState === 'function'
            ? await this.browserManager.getBrowserState(this.browserId)
            : {
                cookies: typeof this.browserManager?.getCookies === 'function'
                    ? await this.browserManager.getCookies(this.browserId)
                    : [],
                browserStorage: []
            };
        const cookies = Array.isArray(browserState?.cookies) ? browserState.cookies : [];
        const browserStorage = Array.isArray(browserState?.browserStorage) ? browserState.browserStorage : [];

        if (cookies.length === 0 && browserStorage.length === 0) {
            throw new Error('获取Cookie失败：当前页面没有可保存的Cookie或浏览器存储');
        }

        if (!this.cookieManager || typeof this.cookieManager.saveCookieFile !== 'function') {
            throw new Error('获取Cookie失败：Cookie保存器不可用');
        }

        const saveResult = await this.cookieManager.saveCookieFile(
            cardName,
            normalizedFileName,
            cookies,
            browserStorage
        );

        if (!saveResult || saveResult.success !== true) {
            throw new Error(saveResult?.error || '获取Cookie失败：保存文件失败');
        }

        this.cookiesSavedByCaptureStep = true;

        if (this.app?.mainWindow?.webContents) {
            try {
                this.app.mainWindow.webContents.send('cookies-refreshed', {
                    success: true,
                    cardName,
                    fileName: saveResult.fileName,
                    filePath: saveResult.filePath,
                    cookiesSaved: true
                });
            } catch (_error) {}
        }

        this.logger.info(
            `✅ Cookie已保存: ${cardName}/${saveResult.fileName}，Cookie数量: ${cookies.length}，浏览器存储: ${browserStorage.length}`
        );
        this.logger.info('💡 后续步骤仍会继续执行');
        return true;
    },

    async _executeGetCreditsScript() {
        try {
            this.logger.info('执行积分获取脚本');
            return await this._getCreditsFromPageDirect();
        } catch (error) {
            this.logger.error(`积分获取脚本执行失败: ${error.message}`);
            return false;
        }
    },

    async _getCreditsFromPageDirect() {
        try {
            const browser = this.browserManager.getBrowser(this.browserId);
            if (!browser) {
                this.logger.error('无法获取浏览器实例进行积分获取');
                return false;
            }

            this.logger.info('积分获取功能暂未完全实现');
            this._credits = 0;
            return true;
        } catch (error) {
            this.logger.error(`直接积分获取失败: ${error.message}`);
            this._credits = 0;
            return false;
        }
    },

    async _executeClashSystemProxyStep(step) {
        if (!this.clashManager) {
            this.logger.error('未配置 Clash Manager，无法控制系统代理');
            return false;
        }

        const action = step.action || 'off';
        const enable = action === 'on';

        this.logger.info(`执行 Clash 系统代理控制: ${enable ? '开启' : '关闭'}`);

        try {
            this.clashManager.setLogger(this.logger);
            const result = await this.clashManager.setSystemProxy(enable, this.browserSettings || {});

            if (result) {
                this.logger.info(`系统代理已${enable ? '开启' : '关闭'}`);
                return true;
            }

            this.logger.error('系统代理设置失败');
            return false;
        } catch (error) {
            this.logger.error(`系统代理控制异常: ${error.message}`);
            return false;
        }
    },

    async _executeWaitVerificationCodeStep(step) {
        try {
            const verificationSource = String(step.verification_source || step.source || step.code_source || '').toLowerCase();
            const useHaikaSms = verificationSource === 'haika_sms' || verificationSource === 'sms';

            if (useHaikaSms) {
                this.logger.debug(`等待海卡验证码步骤 - 凭据状态:`);
                this.logger.debug(`  step.verification_source: "${step.verification_source || step.source || step.code_source || ''}"`);
                this.logger.debug(`  this.contextVariables.smsCode: "${this.contextVariables?.smsCode || ''}"`);
                this.logger.debug(`  this.contextVariables.sms_api: "${this.contextVariables?.sms_api || ''}"`);

                const smsApiUrl = this._resolveStepTemplate(
                    step.sms_api || step.smsApi || this.contextVariables?.sms_api || this.contextVariables?.smsApi || ''
                );
                let cachedSmsCode = String(this.contextVariables?.smsCode || this.contextVariables?.sms_code || '').trim();
                if (!cachedSmsCode && smsApiUrl && this.app && typeof this.app.getLatestHaikaSmsRecord === 'function') {
                    try {
                        const latestSmsRecord = await this.app.getLatestHaikaSmsRecord(smsApiUrl);
                        const persistedSmsCode = String(latestSmsRecord?.code || '').trim();
                        if (persistedSmsCode) {
                            cachedSmsCode = persistedSmsCode;
                            this.contextVariables.smsCode = persistedSmsCode;
                            this.contextVariables.sms_code = persistedSmsCode;
                            this.logger.info(`已加载最近一次海卡验证码记录: ${persistedSmsCode}，本次将继续等待新验证码`);
                        }
                    } catch (historyError) {
                        this.logger.warning(`读取海卡验证码历史记录失败: ${historyError.message}`);
                    }
                }

                let smsCode = '';
                let lastSeenCode = cachedSmsCode;
                const hasHistoricalCode = Boolean(cachedSmsCode);
                const timeout = step.timeout || 300;
                const pollIntervalMs = Math.max(1000, step.poll_interval_ms || step.pollIntervalMs || 3000);
                const deadline = Date.now() + timeout * 1000;

                if (cachedSmsCode) {
                    this.logger.info(`已存在上次海卡验证码记录: ${cachedSmsCode}，本次将继续等待新验证码`);
                }

                if (!smsApiUrl) {
                    this.logger.error('海卡验证码接口为空，无法等待验证码');
                    return false;
                }

                this.logger.info(`开始等待海卡验证码: ${smsApiUrl}, 超时时间: ${timeout}秒`);
                const appFetcher = this.app && typeof this.app.fetchHaikaSmsCode === 'function'
                    ? this.app.fetchHaikaSmsCode.bind(this.app)
                    : null;

                while (Date.now() < deadline && this.running) {
                    const result = appFetcher
                        ? await appFetcher(smsApiUrl)
                        : await fetchHaikaSmsCodeFromUrl(smsApiUrl, Math.min(pollIntervalMs, 10000));
                    if (result?.code) {
                        const nextCode = String(result.code).trim();
                        const isDuplicate = result?.duplicate === true || !!(lastSeenCode && nextCode === lastSeenCode);
                        if (isDuplicate) {
                            lastSeenCode = nextCode;
                            this.logger.info(
                                `${hasHistoricalCode ? '验证码与上次记录相同' : '验证码仍为接口最近一次记录'}，继续等待新验证码: ${nextCode}`
                            );
                            await this._sleepInterruptibly(pollIntervalMs, '等待海卡验证码轮询');
                            continue;
                        }

                        smsCode = nextCode;
                        break;
                    }

                    if (result?.success === false && result?.error) {
                        this.logger.debug(`海卡验证码接口返回: ${result.error}`);
                    } else if (result?.emptyNotice) {
                        this.logger.debug('海卡验证码尚未到达，继续等待...');
                    }

                    if (Date.now() >= deadline || !this.running) {
                        break;
                    }

                    await this._sleepInterruptibly(pollIntervalMs, '等待海卡验证码轮询');
                }

                if (smsCode) {
                    this.receivedVerificationCode = smsCode;
                    this.contextVariables.smsCode = smsCode;
                    this.contextVariables.sms_code = smsCode;
                    this.logger.info(`✅ 成功获取海卡验证码: ${smsCode}`);
                    this.logger.info('💡 请在后续步骤中使用 "{smsCode}" 或 "{code}" 来填写海卡验证码');
                    return true;
                }

                this.logger.error(`❌ 等待海卡验证码超时: ${smsApiUrl} (等待了 ${timeout}秒)`);
                return false;
            }

            const timeout = step.timeout || 300;
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
            if (apiModeEnabled) {
                if (!tempEmailService || typeof tempEmailService.waitForApiCode !== 'function') {
                    this.logger.error('临时邮箱 API 服务不可用，无法获取验证码');
                    return false;
                }

                const resolvedEmail = this.credentials.email || this.generatedEmail || tempEmailService.currentEmail || tempEmailService.getState?.()?.email || '';
                if (!resolvedEmail) {
                    this.logger.error('临时邮箱地址为空，无法获取验证码');
                    return false;
                }

                this.logger.info(`开始等待 API 收件箱验证码: ${resolvedEmail}`);
                const apiCodeResult = await tempEmailService.waitForApiCode({
                    email: resolvedEmail,
                    sessionId: this.taskId,
                    timeout,
                    pollIntervalMs: Math.max(500, Number(step.poll_interval_ms || step.pollIntervalMs || 1500)),
                    minCodeLength: Number(step.code_min_length || step.codeMinLength || 4),
                    maxCodeLength: Number(step.code_max_length || step.codeMaxLength || 12)
                });

                if (apiCodeResult && apiCodeResult.success && apiCodeResult.code) {
                    this.receivedVerificationCode = apiCodeResult.code;
                    this.contextVariables.apiCode = apiCodeResult.code;
                    this.contextVariables.api_code = apiCodeResult.code;
                    this.logger.info(`✅ 成功获取 API 收件箱验证码: ${apiCodeResult.code}`);
                    this.logger.info(
                        '📨 API 收件箱完整响应:\n' +
                        JSON.stringify({
                            email: apiCodeResult.email || resolvedEmail,
                            code: apiCodeResult.code,
                            usage: apiCodeResult.usage || null,
                            record: apiCodeResult.record || null,
                            raw: apiCodeResult.raw || null
                        }, null, 2)
                    );
                    this.logger.info('💡 请在后续步骤中配置 type 类型的步骤，并在 text 中使用 "{code}" 来填写验证码');
                    return true;
                }

                this.logger.error(`❌ 等待 API 收件箱验证码超时: ${resolvedEmail} (等待了 ${timeout}秒)`);
                return false;
            }

            if (tempEmailModeEnabled) {
                const tempEmailService = typeof this._getTempEmailService === 'function'
                    ? this._getTempEmailService()
                    : this.app?.tempEmailService || null;

                if (!tempEmailService) {
                    this.logger.error('临时邮箱服务不可用，无法获取验证码');
                    return false;
                }

                const resolvedEmail = this.credentials.email || this.generatedEmail || tempEmailService.currentEmail || tempEmailService.getState?.()?.email || '';
                if (!resolvedEmail) {
                    this.logger.error('临时邮箱地址为空，无法获取验证码');
                    return false;
                }

                this.logger.info(`开始等待临时邮箱验证码: ${resolvedEmail}`);
                const tempCode = await this._waitForTempEmailCode(step, timeout);
                if (tempCode) {
                    this.receivedVerificationCode = tempCode;
                    this.logger.info(`✅ 成功获取临时邮箱验证码: ${tempCode}`);
                    this.logger.info('💡 请在后续步骤中配置 type 类型的步骤，并在 text 中使用 "{code}" 来填写验证码');
                    return true;
                }

                this.logger.error(`❌ 等待临时邮箱验证码超时: ${resolvedEmail} (等待了 ${timeout}秒)`);
                return false;
            }

            this.logger.debug(`等待验证码步骤 - 凭据状态:`);
            this.logger.debug(`  step.email: "${step.email}"`);
            this.logger.debug(`  this.credentials.email: "${this.credentials.email}"`);
            this.logger.debug(`  this.generatedEmail: "${this.generatedEmail}"`);

            let email = this.credentials.email || this.generatedEmail || '';

            if (!email && step.email) {
                email = this._resolveStepTemplate(step.email);
            }

            if (email.includes('{random}')) {
                if (this.generatedEmail) {
                    email = this.generatedEmail;
                } else {
                    const emailConfig = this.emailRandomConfig?.email || { length: 8, type: 'lowercase' };
                    const randomPart = this._generateRandomStringByConfig(emailConfig);
                    email = email.replace('{random}', randomPart);
                }
            }

            const emailWithSuffix = typeof this._applyEmailSuffixToEmail === 'function'
                ? this._applyEmailSuffixToEmail(email)
                : email;
            if (emailWithSuffix && emailWithSuffix !== email) {
                email = emailWithSuffix;
                this.credentials.email = emailWithSuffix;
                this.generatedEmail = emailWithSuffix;
            }

            const resolvedEmail = email || this.generatedEmail || this.credentials?.email || this._resolveStepTemplate(step.email) || '';
            this.logger.info(`开始等待邮箱验证码: ${resolvedEmail}`);

            if (!this.emailClient) {
                this.logger.error('邮箱客户端未初始化');
                return false;
            }

            if (!this.emailClient.connected) {
                this.logger.info('邮箱客户端未连接，尝试发起连接并等待重连...');
                try {
                    this.emailClient.connect().catch(() => {});
                } catch (_e) {}
                this.logger.info('邮箱客户端已进入自动重连流程，等待期间不会中断当前注册任务');
            }

            const emailRegex = /^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|(\d{1,3}\.){3}\d{1,3})$/;
            if (!emailRegex.test(email)) {
                this.logger.error(`邮箱格式无效: ${email}`);
                return false;
            }

            this.logger.info(`📧 邮箱验证通过: ${resolvedEmail}, 超时时间: ${timeout}秒`);
            this.logger.info(`🔗 邮箱客户端连接状态: ${this.emailClient.connected}`);
            this.logger.info(`🌐 邮箱服务器: ${this.emailClient.serverHost}:${this.emailClient.serverPort}`);

            const startTime = Date.now();
            this.logger.info('⏳ 开始调用 waitForVerificationCode...');
            const checkCancel = () => {
                if (!this.running) return true;

                if (this.browserId) {
                    const page = this.browserManager.getBrowser(this.browserId);
                    if (!page || page.isClosed()) {
                        this.logger.warning('浏览器已关闭，停止等待验证码');
                        return true;
                    }
                }
                return false;
            };

            const code = await this.emailClient.waitForVerificationCode(resolvedEmail, timeout, checkCancel);
            const elapsedTime = (Date.now() - startTime) / 1000;

            if (code) {
                this.receivedVerificationCode = code;
                this.logger.info(`✅ 成功获取验证码: ${code} (等待时间: ${elapsedTime.toFixed(1)}秒)`);
                this.logger.info('💡 请在后续步骤中配置 type 类型的步骤，并在 text 中使用 "{code}" 来填写验证码');

                try {
                    this.credentials.email = resolvedEmail;
                    this.generatedEmail = resolvedEmail;
                    email = resolvedEmail;
                } catch (_e) {}

                return true;
            } else {
                this.logger.error(`❌ 等待验证码超时: ${email} (等待了 ${elapsedTime.toFixed(1)}秒，超时时间 ${timeout}秒)`);
                return false;
            }
        } catch (error) {
            this.logger.error(`等待验证码过程中发生错误: ${error.message}`);
            return false;
        }
    },

    async _recoverHaikaBindingWithNextCard(options = {}) {
        if (!this.app || typeof this.app.exchangeNextHaikaBindingCard !== 'function') {
            throw new Error('当前运行环境未提供海卡换卡能力');
        }

        const result = await this.app.exchangeNextHaikaBindingCard(this.contextVariables || {}, options || {});
        if (!result || !result.success) {
            throw new Error(result?.error || '切换下一张海卡失败');
        }

        const bindingContent = result.bindingContent && typeof result.bindingContent === 'object'
            ? result.bindingContent
            : (result.binding?.content && typeof result.binding.content === 'object' ? result.binding.content : {});
        const nextExpiryDate = this.app && typeof this.app.normalizeHaikaExpiryDate === 'function'
            ? this.app.normalizeHaikaExpiryDate(bindingContent.expiry_date || '')
            : String(bindingContent.expiry_date || '').trim();
        const nextSmsApi = bindingContent.sms_api || bindingContent.smsApi || '';
        const nextHaikaKey = result.key || this.contextVariables?.haika_key || this.contextVariables?.haikaKey || '';
        const nextHaikaIndex = result.index || this.contextVariables?.haika_key_index || this.contextVariables?.haikaKeyIndex || '';
        const nextCategoryName = result.categoryName || this.contextVariables?.haika_category || this.contextVariables?.haikaCategory || '';

        this.contextVariables = {
            ...this.contextVariables,
            ...bindingContent,
            card_number: bindingContent.card_number || '',
            expiry_date: nextExpiryDate,
            cvv: bindingContent.cvv || '',
            name: bindingContent.name || '',
            phone: bindingContent.phone || '',
            address: bindingContent.address || '',
            sms_api: nextSmsApi,
            smsApi: nextSmsApi,
            sms_code: '',
            smsCode: '',
            haika_key: nextHaikaKey,
            haikaKey: nextHaikaKey,
            haika_key_index: nextHaikaIndex,
            haikaKeyIndex: nextHaikaIndex,
            haika_category: nextCategoryName,
            haikaCategory: nextCategoryName
        };
        this.receivedVerificationCode = null;

        const maskedKey = typeof nextHaikaKey === 'string' && nextHaikaKey.length > 8
            ? `${nextHaikaKey.slice(0, 4)}...${nextHaikaKey.slice(-4)}`
            : nextHaikaKey;
        this.logger.info(`海卡绑定已切换到下一张卡密: 分类=${nextCategoryName || 'unknown'}, 序号=${nextHaikaIndex || 'unknown'}, 卡密=${maskedKey || 'unknown'}`);

        return {
            success: true,
            key: nextHaikaKey,
            index: nextHaikaIndex,
            categoryName: nextCategoryName,
            bindingContent
        };
    },
};
