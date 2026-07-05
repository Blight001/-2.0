const { pageUrlMatchesNeedle } = require('./shared');

const sleep = async (thread, ms, context = '') => {
    if (thread && typeof thread._sleepInterruptibly === 'function') {
        return thread._sleepInterruptibly(ms, context);
    }

    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
};

module.exports = {
    _collectClickSelectors(step = {}, primarySelectors = '') {
        const selectors = [];
        const pushSelector = (value) => {
            if (Array.isArray(value)) {
                value.forEach(pushSelector);
                return;
            }

            if (typeof value !== 'string') {
                return;
            }

            const normalized = value.trim();
            if (!normalized || selectors.includes(normalized)) {
                return;
            }

            selectors.push(normalized);
        };

        pushSelector(primarySelectors);

        for (const fallback of Array.isArray(step.fallback_selectors) ? step.fallback_selectors : []) {
            const fallbackResolved = this._resolveStepTemplate(fallback);
            const fallbackSelectors = typeof this._resolveSelectorCandidates === 'function'
                ? this._resolveSelectorCandidates(step.by, fallbackResolved)
                : [this._convertSelector(step.by, fallbackResolved)];
            pushSelector(fallbackSelectors);
        }

        if (typeof step.text_match === 'string' && step.text_match.trim()) {
            pushSelector(`text=${step.text_match.trim()}`);
        }

        return selectors;
    },

    async _clickTargetInPage(targetPage, step, selectors, timeout, stepName = '') {
        if (!targetPage || typeof targetPage.locator !== 'function') {
            return false;
        }

        const scopes = [targetPage];
        if (typeof targetPage.frames === 'function') {
            try {
                scopes.push(...targetPage.frames());
            } catch (_error) {}
        }

        for (const selector of selectors) {
            for (const scope of scopes) {
                try {
                    const clickTarget = step.nth !== undefined
                        ? scope.locator(selector).nth(step.nth)
                        : scope.locator(selector).first();
                    const forceClick = step.force_click === true || selector.includes('span');
                    const effectiveTimeout = Math.max(0, timeout || 0);
                    const shouldTryCheckboxClick = step.checkbox_like === true
                        || step.checkboxLike === true
                        || /checkbox|label|\bspan\b|footerCheckbox|协议|同意/i.test(`${selector} ${stepName || ''}`);
                    if (shouldTryCheckboxClick) {
                        const checkboxClicked = await this._clickCheckboxLikeTarget(clickTarget, effectiveTimeout).catch(() => false);
                        if (checkboxClicked) {
                            this.logger.info(`步骤 ${stepName || 'click'} 勾选成功: ${selector}`);
                            return true;
                        }
                    }

                    await clickTarget.click({
                        timeout: effectiveTimeout,
                        force: forceClick,
                    });

                    this.logger.info(`步骤 ${stepName || 'click'} 点击成功: ${selector}`);
                    return true;
                } catch (error) {
                    this.logger.debug(`点击尝试失败 ${selector}: ${error.message}`);
                }
            }
        }

        return false;
    },

    async _clickCheckboxLikeTarget(locator, timeout = 0) {
        if (!locator || typeof locator.evaluate !== 'function') {
            return false;
        }

        const effectiveTimeout = Math.max(0, timeout || 0);
        if (typeof locator.count === 'function' && await locator.count().catch(() => 0) < 1) {
            return false;
        }

        if (typeof locator.waitFor === 'function') {
            await locator.waitFor({ state: 'attached', timeout: effectiveTimeout }).catch(() => {});
        }

        return await locator.evaluate((element) => {
            if (!element || !(element instanceof Element)) {
                return false;
            }

            const root = element;
            const doc = root.ownerDocument;
            const checkboxCandidates = [];
            if (root.matches('input[type="checkbox"]')) {
                checkboxCandidates.push(root);
            }
            checkboxCandidates.push(...Array.from(root.querySelectorAll('input[type="checkbox"]')));

            const uniqueCheckboxes = Array.from(new Set(checkboxCandidates));
            for (const checkbox of uniqueCheckboxes) {
                if (!(checkbox instanceof HTMLInputElement) || checkbox.disabled) {
                    continue;
                }

                if (checkbox.checked) {
                    return true;
                }

                const label = checkbox.id
                    ? Array.from(doc.querySelectorAll('label')).find(item => item.getAttribute('for') === checkbox.id)
                    : checkbox.closest('label');
                const clickableLabel = label || checkbox.closest('label') || root.querySelector('label');

                try {
                    if (clickableLabel && typeof clickableLabel.click === 'function') {
                        clickableLabel.click();
                    }
                } catch (_error) {}

                try {
                    if (!checkbox.checked && typeof checkbox.click === 'function') {
                        checkbox.click();
                    }
                } catch (_error) {}

                if (!checkbox.checked) {
                    checkbox.checked = true;
                    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                }

                if (checkbox.checked) {
                    return true;
                }
            }

            return false;
        });
    },

    async _isTargetVisibleInPage(targetPage, step, selectors) {
        if (!targetPage || typeof targetPage.locator !== 'function') {
            return false;
        }

        const scopes = [targetPage];
        if (typeof targetPage.frames === 'function') {
            try {
                scopes.push(...targetPage.frames());
            } catch (_error) {}
        }

        for (const selector of selectors) {
            for (const scope of scopes) {
                try {
                    const target = step.nth !== undefined
                        ? scope.locator(selector).nth(step.nth)
                        : scope.locator(selector).first();
                    if (await target.isVisible().catch(() => false)) {
                        return true;
                    }
                } catch (_error) {}
            }
        }

        return false;
    },

    async _findVisibleTextInPage(targetPage, texts = []) {
        if (!targetPage || typeof targetPage.locator !== 'function' || !Array.isArray(texts) || texts.length === 0) {
            return '';
        }

        const scopes = [targetPage];
        if (typeof targetPage.frames === 'function') {
            try {
                scopes.push(...targetPage.frames());
            } catch (_error) {}
        }

        for (const rawText of texts) {
            const text = typeof rawText === 'string' ? rawText.trim() : '';
            if (!text) {
                continue;
            }

            for (const scope of scopes) {
                try {
                    const locator = scope.locator(`text=${text}`);
                    const count = await locator.count().catch(() => 0);
                    if (count <= 0) {
                        continue;
                    }

                    const limit = Math.min(count, 3);
                    for (let index = 0; index < limit; index++) {
                        if (await locator.nth(index).isVisible().catch(() => false)) {
                            return text;
                        }
                    }
                } catch (_error) {}
            }
        }

        return '';
    },

    async _executeClickStep(browser, step, browserId = null, nextStep = null) {
        if (typeof this._ensureBrowserAvailable === 'function') {
            browser = await this._ensureBrowserAvailable(`步骤 ${step?.name || 'click'} 点击前检查`);
        }
        const isOptional = step.optional === true || false;
        const stepName = typeof step.name === 'string' && step.name.trim() ? step.name.trim() : 'click';
        const primarySelectors = typeof this._resolveSelectorCandidates === 'function'
            ? this._resolveSelectorCandidates(step.by, this._resolveStepTemplate(step.selector))
            : [this._convertSelector(step.by, this._resolveStepTemplate(step.selector))];
        const selectors = this._collectClickSelectors(step, primarySelectors);
        const pageNeedles = typeof this._collectStepPageNeedles === 'function'
            ? this._collectStepPageNeedles(step)
            : [];
        const timeout = (() => {
            const explicitTimeout = parseInt(step.timeout, 10);
            if (Number.isFinite(explicitTimeout) && explicitTimeout > 0) {
                return explicitTimeout;
            }

            return isOptional ? 3000 : 15000;
        })();
        const clickTimeoutMs = (() => {
            const explicitTimeout = parseInt(step.click_attempt_timeout_ms ?? step.clickAttemptTimeoutMs, 10);
            if (Number.isFinite(explicitTimeout) && explicitTimeout > 0) {
                return explicitTimeout;
            }

            return Math.min(timeout, 1000);
        })();
        const pollIntervalMs = (() => {
            const explicitInterval = parseFloat(step.click_poll_interval_ms ?? step.clickPollIntervalMs ?? step.click_repeat_interval_ms);
            if (Number.isFinite(explicitInterval) && explicitInterval >= 0) {
                return explicitInterval;
            }

            return 200;
        })();
        const preClickDelayMs = (() => {
            const explicitDelay = parseFloat(step.pre_click_delay_ms ?? step.preClickDelayMs);
            if (Number.isFinite(explicitDelay) && explicitDelay >= 0) {
                return explicitDelay;
            }

            return 0;
        })();
        const stepWaitMs = (() => {
            const explicitWaitMs = parseFloat(step.wait ?? step.waitMs);
            if (Number.isFinite(explicitWaitMs) && explicitWaitMs >= 0) {
                return explicitWaitMs;
            }

            return 0;
        })();
        const clickUntilDisappear = step.click_until_disappear === true || step.clickUntilDisappear === true;
        const waitForPageClose = step.wait_for_page_close === true
            || step.waitForPageClose === true
            || step.click_until_page_closed === true
            || step.clickUntilPageClosed === true
            || step.click_until_close === true
            || step.clickUntilClose === true;
        const clickUntilDisappearTimeoutMs = (() => {
            const explicitTimeout = parseInt(step.click_until_disappear_timeout_ms ?? step.clickUntilDisappearTimeoutMs, 10);
            if (Number.isFinite(explicitTimeout) && explicitTimeout > 0) {
                return explicitTimeout;
            }

            return Math.min(timeout, 10000);
        })();
        const clickUntilDisappearIntervalMs = (() => {
            const explicitInterval = parseInt(step.click_until_disappear_interval_ms ?? step.clickUntilDisappearIntervalMs, 10);
            if (Number.isFinite(explicitInterval) && explicitInterval >= 0) {
                return explicitInterval;
            }

            return 150;
        })();
        const maxSuccessfulClicksBeforeJump = (() => {
            const explicitLimit = parseInt(
                step.max_successful_clicks_before_jump
                ?? step.maxSuccessfulClicksBeforeJump
                ?? step.max_clicks_before_retry
                ?? step.maxClicksBeforeRetry,
                10
            );
            if (Number.isFinite(explicitLimit) && explicitLimit > 0) {
                return explicitLimit;
            }

            return 0;
        })();
        const jumpToStepOnMaxClicks = (() => {
            const configuredTarget = step.jump_to_step_on_max_clicks
                ?? step.jumpToStepOnMaxClicks
                ?? step.retry_from_step
                ?? step.retryFromStep;
            return typeof configuredTarget === 'string' && configuredTarget.trim()
                ? configuredTarget.trim()
                : '';
        })();
        const recoveryTexts = (() => {
            const values = step.recover_when_text_visible
                ?? step.recoverWhenTextVisible
                ?? step.failure_texts
                ?? step.failureTexts;
            const items = Array.isArray(values) ? values : (values ? [values] : []);
            return items
                .filter(item => typeof item === 'string' && item.trim())
                .map(item => item.trim());
        })();
        const recoverWithNextHaika = step.recover_with_next_haika === true || step.recoverWithNextHaika === true;
        const recoveryJumpStepName = (() => {
            const configuredTarget = step.recovery_jump_to_step
                ?? step.recoveryJumpToStep
                ?? step.recover_jump_to_step
                ?? step.recoverJumpToStep;
            return typeof configuredTarget === 'string' && configuredTarget.trim()
                ? configuredTarget.trim()
                : '';
        })();
        const recoveryRetryButtonBy = step.recovery_retry_button_by || step.recoveryRetryButtonBy || 'css_selector';
        const recoveryRetryButtonSelectors = (() => {
            const configured = Array.isArray(step.recovery_retry_button_selectors)
                ? step.recovery_retry_button_selectors
                : (step.recovery_retry_button_selectors ? [step.recovery_retry_button_selectors] : []);
            const defaults = configured.length > 0 ? configured : [
                "button:has-text('重试')",
                "[role='button']:has-text('重试')",
                'text=重试',
                "button:has-text('Retry')",
                'text=Retry'
            ];
            return defaults
                .filter(item => typeof item === 'string' && item.trim())
                .flatMap(item => {
                    const resolvedItem = this._resolveStepTemplate(item);
                    return typeof this._resolveSelectorCandidates === 'function'
                        ? this._resolveSelectorCandidates(recoveryRetryButtonBy, resolvedItem)
                        : [this._convertSelector(recoveryRetryButtonBy, resolvedItem)];
                });
        })();
        const recoveryRetryButtonTimeoutMs = (() => {
            const explicitTimeout = parseInt(step.recovery_retry_button_timeout_ms ?? step.recoveryRetryButtonTimeoutMs, 10);
            if (Number.isFinite(explicitTimeout) && explicitTimeout > 0) {
                return explicitTimeout;
            }

            return 5000;
        })();
        const recoveryMaxRetries = (() => {
            const explicitRetries = parseInt(step.recovery_max_retries ?? step.recoveryMaxRetries, 10);
            if (Number.isFinite(explicitRetries) && explicitRetries > 0) {
                return explicitRetries;
            }

            return 20;
        })();
        const normalizeNeedleList = (value) => {
            const values = Array.isArray(value) ? value : (value ? [value] : []);
            return values
                .filter(item => typeof item === 'string' && item.trim())
                .map(item => item.trim());
        };
        const nextStepPageNeedles = nextStep && typeof this._collectStepPageNeedles === 'function'
            ? this._collectStepPageNeedles(nextStep)
            : [];
        const completionPageNeedles = normalizeNeedleList(
            step.complete_when_page_contains
            ?? step.completeWhenPageContains
            ?? step.wait_until_page_contains
            ?? step.waitUntilPageContains
        );
        const postClosePreferredPageNeedles = normalizeNeedleList(
            step.page_closed_preferred_page_contains
            ?? step.pageClosedPreferredPageContains
            ?? step.after_close_preferred_page_contains
            ?? step.afterClosePreferredPageContains
        );
        const requiresTerminalState = waitForPageClose || completionPageNeedles.length > 0;
        const terminalPageNeedles = completionPageNeedles.length > 0
            ? completionPageNeedles
            : nextStepPageNeedles;

        if (!browser || typeof browser.locator !== 'function') {
            throw new Error(`步骤 ${stepName} 缺少可用页面对象`);
        }

        let beforeUrl = '';
        let beforePageCount = 0;
        try {
            beforeUrl = typeof browser.url === 'function' ? browser.url() : browser.url;
            const context = typeof browser.context === 'function' ? browser.context() : null;
            beforePageCount = context && typeof context.pages === 'function'
                ? context.pages().filter(page => {
                    try {
                        return page && typeof page.isClosed === 'function' ? !page.isClosed() : true;
                    } catch (_error) {
                        return true;
                    }
                }).length
                : 0;
        } catch (_error) {}

        const hasPageChanged = () => {
            try {
                const currentUrl = typeof browser.url === 'function' ? browser.url() : browser.url;
                if (typeof currentUrl === 'string' && currentUrl && currentUrl !== beforeUrl) {
                    return true;
                }

                const context = typeof browser.context === 'function' ? browser.context() : null;
                const currentPageCount = context && typeof context.pages === 'function'
                    ? context.pages().filter(page => {
                        try {
                            return page && typeof page.isClosed === 'function' ? !page.isClosed() : true;
                        } catch (_error) {
                            return true;
                        }
                    }).length
                    : beforePageCount;
                return currentPageCount !== beforePageCount;
            } catch (_error) {
                return false;
            }
        };
        const currentPageMatchesNeedles = (needles = []) => {
            if (!Array.isArray(needles) || needles.length === 0) {
                return false;
            }

            try {
                const currentUrl = typeof browser.url === 'function' ? browser.url() : browser.url;
                return typeof currentUrl === 'string' && needles.some(needle => pageUrlMatchesNeedle(currentUrl, needle));
            } catch (_error) {
                return false;
            }
        };
        const switchToContinuationPage = async (reason = '') => {
            if (!browserId || !this.browserManager || typeof this.browserManager.setBrowserPage !== 'function') {
                return null;
            }

            try {
                const context = typeof browser.context === 'function' ? browser.context() : null;
                if (!context || typeof context.pages !== 'function') {
                    return null;
                }

                const pages = context.pages().filter(page => {
                    try {
                        return page && typeof page.isClosed === 'function' ? !page.isClosed() : true;
                    } catch (_error) {
                        return true;
                    }
                });

                if (pages.length === 0) {
                    return null;
                }

                const preferredNeedles = postClosePreferredPageNeedles.length > 0
                    ? postClosePreferredPageNeedles
                    : terminalPageNeedles;
                const reversedPages = [...pages].reverse();
                let targetPage = null;

                if (preferredNeedles.length > 0) {
                    targetPage = reversedPages.find(page => {
                        const pageUrl = typeof page.url === 'function' ? page.url() : page.url;
                        return typeof pageUrl === 'string' && preferredNeedles.some(needle => pageUrlMatchesNeedle(pageUrl, needle));
                    }) || null;
                }

                if (!targetPage) {
                    targetPage = reversedPages.find(page => {
                        const pageUrl = typeof page.url === 'function' ? page.url() : page.url;
                        return pageUrl && pageUrl !== 'about:blank';
                    }) || pages[0];
                }

                if (!targetPage) {
                    return null;
                }

                if (typeof targetPage.waitForLoadState === 'function') {
                    await targetPage.waitForLoadState('domcontentloaded', { timeout: 1500 }).catch(() => {});
                }

                if (typeof targetPage.bringToFront === 'function') {
                    await targetPage.bringToFront().catch(() => {});
                }

                await this.browserManager.setBrowserPage(browserId, targetPage).catch(() => {});

                const targetUrl = typeof targetPage.url === 'function' ? targetPage.url() : targetPage.url;
                const compactTargetUrl = typeof this._compactPageUrl === 'function'
                    ? this._compactPageUrl(targetUrl)
                    : (targetUrl || 'unknown');
                if (reason) {
                    this.logger.info(`步骤 ${stepName} ${reason}后切换到继续页面: ${compactTargetUrl || 'unknown'}`);
                } else {
                    this.logger.info(`步骤 ${stepName} 切换到继续页面: ${compactTargetUrl || 'unknown'}`);
                }

                return targetPage;
            } catch (error) {
                this.logger.debug(`步骤 ${stepName} 切换继续页面失败: ${error.message}`);
                return null;
            }
        };
        const getCurrentPageState = async () => {
            const currentUrl = typeof browser.url === 'function' ? browser.url() : browser.url;
            let currentTitle = '';
            try {
                currentTitle = typeof browser.title === 'function' ? await browser.title().catch(() => '') : '';
            } catch (_error) {}

            let openPages = '';
            try {
                openPages = typeof this._describeOpenPages === 'function'
                    ? await this._describeOpenPages(browser)
                    : '';
            } catch (_error) {}

            return { currentUrl, currentTitle, openPages };
        };
        const clickRecoveryRetryButton = async (targetPage = browser) => {
            if (recoveryRetryButtonSelectors.length === 0) {
                return true;
            }

            const recoveryStep = {
                ...step,
                nth: 0,
                force_click: true
            };
            const deadline = Date.now() + recoveryRetryButtonTimeoutMs;

            while (Date.now() <= deadline) {
                const clicked = await this._clickTargetInPage(
                    targetPage,
                    recoveryStep,
                    recoveryRetryButtonSelectors,
                    Math.min(clickTimeoutMs || 800, 800),
                    `${stepName}-重试`
                );
                if (clicked) {
                    return true;
                }

                if (typeof this._clickAcrossOpenPages === 'function') {
                    const crossPageClicked = await this._clickAcrossOpenPages(
                        browser,
                        {
                            ...recoveryStep,
                            fallback_selectors: recoveryRetryButtonSelectors.slice(1)
                        },
                        recoveryRetryButtonSelectors[0],
                        Math.min(clickTimeoutMs || 800, 800),
                        `${stepName}-重试`,
                        browserId
                    );
                    if (crossPageClicked) {
                        return true;
                    }
                }

                await sleep(this, 150, `步骤 ${stepName} 等待重试按钮`);
            }

            return false;
        };
        const findRecoveryTarget = async () => {
            if (recoveryTexts.length === 0) {
                return null;
            }

            const pages = [];
            const pushPage = (page) => {
                if (page && !pages.includes(page)) {
                    pages.push(page);
                }
            };

            pushPage(browser);
            try {
                const context = typeof browser.context === 'function' ? browser.context() : null;
                if (context && typeof context.pages === 'function') {
                    for (const page of context.pages()) {
                        const isAvailable = page && typeof page.isClosed === 'function' ? !page.isClosed() : !!page;
                        if (isAvailable) {
                            pushPage(page);
                        }
                    }
                }
            } catch (_error) {}

            for (const page of pages) {
                const matchedText = await this._findVisibleTextInPage(page, recoveryTexts);
                if (matchedText) {
                    return { page, matchedText };
                }
            }

            return null;
        };
        const tryHandleRecoveryText = async () => {
            if (recoveryTexts.length === 0) {
                return null;
            }

            const recoveryMatch = await findRecoveryTarget();
            if (!recoveryMatch) {
                return null;
            }

            const matchedText = recoveryMatch.matchedText;
            const recoveryPage = recoveryMatch.page || browser;

            this.logger.warning(`步骤 ${stepName} 检测到异常提示: ${matchedText}`);
            if (recoveryPage && recoveryPage !== browser) {
                browser = recoveryPage;
                if (browserId && this.browserManager && typeof this.browserManager.setBrowserPage === 'function') {
                    await this.browserManager.setBrowserPage(browserId, recoveryPage).catch(() => {});
                }
            }

            if (recoverWithNextHaika) {
                if (typeof this._recoverHaikaBindingWithNextCard !== 'function') {
                    throw new Error(`步骤 ${stepName} 需要海卡换卡恢复，但当前线程未提供恢复方法`);
                }

                await this._recoverHaikaBindingWithNextCard({
                    reason: matchedText,
                    stepName
                });
            }

            const clickedRetry = await clickRecoveryRetryButton(recoveryPage);
            if (!clickedRetry) {
                throw new Error(`步骤 ${stepName} 检测到 "${matchedText}" 后未能点击重试按钮`);
            }

            if (!recoveryJumpStepName) {
                throw new Error(`步骤 ${stepName} 检测到 "${matchedText}"，但未配置 recovery_jump_to_step`);
            }

            return {
                action: 'jump_to_step',
                targetStepName: recoveryJumpStepName,
                reason: `步骤 ${stepName} 检测到 "${matchedText}"，已切换下一张海卡并点击重试`,
                maxJumpRetries: recoveryMaxRetries
            };
        };
        const describeState = (state) => {
            if (!state) {
                return 'unknown | unknown';
            }

            return `${state.currentTitle || 'unknown'} | ${state.currentUrl || 'unknown'}`;
        };
        let lastObservedState = null;

        if (!selectors.length) {
            if (isOptional) {
                this.logger.debug(`可选步骤 ${stepName} 没有可用选择器，已跳过`);
                return true;
            }

            throw new Error(`步骤 ${stepName} 没有可用选择器`);
        }

        if (preClickDelayMs > 0) {
            await sleep(this, preClickDelayMs, `步骤 ${stepName} 点击前等待`);
        }

        const deadline = Date.now() + timeout;
        this.logger.info(`开始执行点击步骤: ${stepName}`);
        this.logger.debug(`点击轮询超时: ${timeout}ms`);

        if (clickUntilDisappear) {
            const disappearDeadline = Date.now() + clickUntilDisappearTimeoutMs;
            let sawTargetVisible = false;
            let waitingForTerminalStateLogged = false;
            let successfulClicks = 0;
            this.logger.info(`开始执行持续点击步骤: ${stepName}，直到目标消失/页面关闭，超时: ${clickUntilDisappearTimeoutMs}ms`);

            while (Date.now() <= disappearDeadline) {
                const recoveryDirective = await tryHandleRecoveryText();
                if (recoveryDirective) {
                    return recoveryDirective;
                }

                if (typeof browser.isClosed === 'function' && browser.isClosed()) {
                    this.logger.info(`步骤 ${stepName} 对应页面已关闭`);
                    await switchToContinuationPage('页面关闭');
                    return true;
                }

                const targetVisible = await this._isTargetVisibleInPage(browser, step, selectors);
                if (targetVisible) {
                    sawTargetVisible = true;
                    waitingForTerminalStateLogged = false;
                    const clicked = await this._clickTargetInPage(browser, step, selectors, clickTimeoutMs, stepName);
                    if (clicked) {
                        successfulClicks++;
                        if (clickUntilDisappearIntervalMs > 0) {
                            await sleep(this, clickUntilDisappearIntervalMs, `步骤 ${stepName} 持续点击轮询`);
                        }

                        const postClickRecoveryDirective = await tryHandleRecoveryText();
                        if (postClickRecoveryDirective) {
                            return postClickRecoveryDirective;
                        }

                        if (typeof browser.isClosed === 'function' && browser.isClosed()) {
                            this.logger.info(`步骤 ${stepName} 点击后对应页面已关闭`);
                            await switchToContinuationPage('页面关闭');
                            return true;
                        }

                        const reachedJumpThreshold = maxSuccessfulClicksBeforeJump > 0
                            && successfulClicks >= maxSuccessfulClicksBeforeJump
                            && jumpToStepOnMaxClicks;
                        const stillVisible = await this._isTargetVisibleInPage(browser, step, selectors);
                        if (reachedJumpThreshold) {
                            const terminalMatched = terminalPageNeedles.length > 0 && currentPageMatchesNeedles(terminalPageNeedles);
                            if (!terminalMatched) {
                                this.logger.warning(`步骤 ${stepName} 连续成功点击 ${successfulClicks} 次后仍未完成，回跳到步骤 ${jumpToStepOnMaxClicks} 重新输入/处理`);
                                return {
                                    action: 'jump_to_step',
                                    targetStepName: jumpToStepOnMaxClicks,
                                    reason: `步骤 ${stepName} 连续点击 ${successfulClicks} 次后仍未完成`,
                                    maxJumpRetries: parseInt(step.max_jump_retries ?? step.maxJumpRetries, 10) || undefined
                                };
                            }
                        }

                        if (!stillVisible) {
                            if (requiresTerminalState) {
                                if (terminalPageNeedles.length > 0 && currentPageMatchesNeedles(terminalPageNeedles)) {
                                    this.logger.info(`步骤 ${stepName} 点击后已进入目标页面`);
                                    await switchToContinuationPage('进入目标页面');
                                    return true;
                                }

                                if (!waitingForTerminalStateLogged) {
                                    const terminalLabel = waitForPageClose
                                        ? `页面关闭${terminalPageNeedles.length > 0 ? '或进入目标页面' : ''}`
                                        : '进入目标页面';
                                    this.logger.info(`步骤 ${stepName} 点击后目标已消失，继续等待${terminalLabel}`);
                                    waitingForTerminalStateLogged = true;
                                }
                                continue;
                            }

                            this.logger.info(`步骤 ${stepName} 点击后目标已消失`);
                            return true;
                        }
                    } else {
                        await sleep(this, clickUntilDisappearIntervalMs, `步骤 ${stepName} 持续点击轮询`);
                    }
                } else {
                    if (sawTargetVisible) {
                        if (requiresTerminalState) {
                            if (terminalPageNeedles.length > 0 && currentPageMatchesNeedles(terminalPageNeedles)) {
                                this.logger.info(`步骤 ${stepName} 已进入目标页面`);
                                await switchToContinuationPage('进入目标页面');
                                return true;
                            }

                            if (!waitingForTerminalStateLogged) {
                                const terminalLabel = waitForPageClose
                                    ? `页面关闭${terminalPageNeedles.length > 0 ? '或进入目标页面' : ''}`
                                    : '进入目标页面';
                                this.logger.info(`步骤 ${stepName} 目标已消失，继续等待${terminalLabel}`);
                                waitingForTerminalStateLogged = true;
                            }

                            await sleep(this, clickUntilDisappearIntervalMs, `步骤 ${stepName} 等待终态页面`);
                            continue;
                        }

                        this.logger.info(`步骤 ${stepName} 目标已消失`);
                        return true;
                    }

                    await sleep(this, clickUntilDisappearIntervalMs, `步骤 ${stepName} 持续点击轮询`);
                }
            }

            if (isOptional) {
                const optionalReason = requiresTerminalState
                    ? `未等到${waitForPageClose ? '页面关闭或进入目标页面' : '进入目标页面'}`
                    : '未等到目标消失';
                this.logger.debug(`可选步骤 ${stepName} 在 ${clickUntilDisappearTimeoutMs}ms 内${optionalReason}，已跳过`);
                return true;
            }

            const state = await getCurrentPageState();
            const currentStateText = describeState(state);
            const timeoutReason = requiresTerminalState
                ? `未等到${waitForPageClose ? '页面关闭或进入目标页面' : '进入目标页面'}`
                : '未等到目标消失或页面关闭';
            throw new Error(`步骤 ${stepName} 在 ${clickUntilDisappearTimeoutMs}ms 内${timeoutReason}，当前页面: ${currentStateText}${state.openPages ? `；打开页: ${state.openPages}` : ''}`);
        }

        while (Date.now() <= deadline) {
            if (typeof browser.isClosed === 'function' && browser.isClosed()) {
                throw new Error(`步骤 ${stepName} 执行时页面已关闭`);
            }

            const clicked = await this._clickTargetInPage(browser, step, selectors, clickTimeoutMs, stepName);
            if (clicked) {
                if (stepWaitMs > 0) {
                    const nextStepReady = nextStep && typeof this._isStepReady === 'function'
                        ? await this._isStepReady(browser, nextStep)
                        : false;

                    if (!nextStepReady) {
                        this.logger.debug(`步骤 ${stepName} 点击后等待 ${stepWaitMs}ms`);
                        await sleep(this, stepWaitMs, `步骤 ${stepName} 点击后等待`);
                    } else {
                        const nextStepName = typeof nextStep?.name === 'string' && nextStep.name.trim()
                            ? nextStep.name.trim()
                            : (nextStep?.type || 'next step');
                        this.logger.debug(`步骤 ${stepName} 后下一步 ${nextStepName} 已就绪，跳过等待 ${stepWaitMs}ms`);
                    }
                }
                return true;
            }

            const clickedAcrossPages = await this._clickAcrossOpenPages(browser, step, selectors, clickTimeoutMs, stepName, browserId);
            if (clickedAcrossPages) {
                if (stepWaitMs > 0) {
                    this.logger.debug(`步骤 ${stepName} 跨页面点击后等待 ${stepWaitMs}ms`);
                    await sleep(this, stepWaitMs, `步骤 ${stepName} 跨页面点击后等待`);
                }
                return true;
            }

            if (hasPageChanged()) {
                this.logger.debug(`步骤 ${stepName} 已发生页面切换，停止继续轮询点击`);
                return true;
            }

            lastObservedState = await getCurrentPageState();
            if (Date.now() <= deadline) {
                await sleep(this, pollIntervalMs, `步骤 ${stepName} 点击轮询`);
            }
        }

        if (isOptional) {
            this.logger.debug(`可选步骤 ${stepName} 在 ${timeout}ms 内未找到可点击元素，已跳过`);
            return true;
        }

        const currentUrl = typeof browser.url === 'function' ? browser.url() : browser.url;
        const pageMatchedExpected = pageNeedles.some(needle => typeof currentUrl === 'string' && currentUrl.includes(needle));
        const pageReason = pageMatchedExpected
            ? '当前页面已到目标页，但元素仍未出现'
            : (hasPageChanged() ? '当前页面已变化，但目标元素仍未出现' : '当前页面未变化，可能前一步没有成功执行或页面仍未加载');

        const state = await getCurrentPageState();
        const observedState = lastObservedState || state;
        const currentStateText = describeState(state);
        const observedStateText = describeState(observedState);
        const observedPrefix = observedStateText !== currentStateText
            ? `，最后看到: ${observedStateText}`
            : '';
        throw new Error(`步骤 ${stepName} 在 ${timeout}ms 内未找到可点击元素（${pageReason}）${observedPrefix}，当前页面: ${currentStateText}${state.openPages ? `；打开页: ${state.openPages}` : ''}`);
    },

    async _clickAcrossOpenPages(browser, step, primarySelector, timeout, stepName = '', browserId = null) {
        if (!browser || typeof browser.context !== 'function') {
            return false;
        }

        const context = browser.context();
        if (!context || typeof context.pages !== 'function') {
            return false;
        }

        const selectors = this._collectClickSelectors(step, primarySelector);
        if (!selectors.length) {
            return false;
        }

        const pages = context.pages().filter(page => {
            try {
                return page && typeof page.isClosed === 'function' ? !page.isClosed() : true;
            } catch (_error) {
                return true;
            }
        });

        for (const page of pages) {
            const clicked = await this._clickTargetInPage(page, step, selectors, timeout, stepName || 'click');
            if (!clicked) {
                continue;
            }

            if (browserId && this.browserManager && typeof this.browserManager.setBrowserPage === 'function') {
                await this.browserManager.setBrowserPage(browserId, page).catch(() => {});
            }

            return true;
        }

        return false;
    },
};
