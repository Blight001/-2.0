module.exports = {
    async _switchToPreferredPage(browser, step = {}, browserId = null, stepLabel = '') {
        try {
            if (typeof this._ensureBrowserAvailable === 'function') {
                browser = await this._ensureBrowserAvailable(`步骤 ${stepLabel || step.name || 'page'} 切页前检查`);
            }
            if (!browser || typeof browser.context !== 'function') {
                return browser;
            }

            if (step.skip_page_sync === true || step.skipPageSync === true) {
                return browser;
            }

            const context = browser.context();
            if (!context || typeof context.pages !== 'function') {
                return browser;
            }

            const pages = context.pages().filter(page => page && typeof page.isClosed === 'function' && !page.isClosed());
            if (pages.length <= 1) {
                return browser;
            }

            const preferredContains = [];
            const configured = Array.isArray(step.preferred_page_contains)
                ? step.preferred_page_contains
                : (step.preferred_page_contains ? [step.preferred_page_contains] : []);

            for (const value of configured) {
                if (typeof value === 'string' && value.trim()) {
                    preferredContains.push(value.trim());
                }
            }

            const currentUrl = typeof browser.url === 'function' ? browser.url() : browser.url;
            const normalizedStepName = String(stepLabel || step.name || '').toLowerCase();
            const stepContextText = [
                stepLabel,
                step.name,
                step.selector,
                step.text_match,
                step.wait_for_text,
                step.wait_for_element,
                ...(Array.isArray(step.fallback_selectors) ? step.fallback_selectors : [])
            ]
                .filter(value => typeof value === 'string' && value.trim())
                .join(' ')
                .toLowerCase();
            const isStepUpSensitiveStep = /验证码|verification|code|cvv|otp|3ds|stepup|验证/.test(stepContextText);
            const loadStateTimeoutMs = isStepUpSensitiveStep ? 2000 : 1200;
            const stepUpNeedle = 'centinelapi.cardinalcommerce.com/V2/Cruise/StepUp';
            const acsNeedle = 'acs.stripeauthentications.com/cld/challengeRequestBrowser';
            const challengeNeedle = 'challengeRequestBrowser';
            const fallbackPreferredContains = [
                'cashier-my.pipopay.com',
                'agreement-cashier.html',
                'payin_checkout',
                'pipo-checkout'
            ];
            const containsNeedles = [...preferredContains];
            if (isStepUpSensitiveStep && !containsNeedles.includes(stepUpNeedle)) {
                containsNeedles.push(stepUpNeedle);
            }
            if (isStepUpSensitiveStep && !containsNeedles.includes(acsNeedle)) {
                containsNeedles.push(acsNeedle);
            }
            if (isStepUpSensitiveStep && !containsNeedles.includes(challengeNeedle)) {
                containsNeedles.push(challengeNeedle);
            }
            for (const fallbackNeedle of fallbackPreferredContains) {
                if (!containsNeedles.includes(fallbackNeedle)) {
                    containsNeedles.push(fallbackNeedle);
                }
            }

            const stepSelectors = [];
            const resolvedPrimarySelectors = step.selector
                ? (typeof this._resolveSelectorCandidates === 'function'
                    ? this._resolveSelectorCandidates(step.by, this._resolveStepTemplate(step.selector))
                    : [this._convertSelector(step.by, this._resolveStepTemplate(step.selector))])
                : [];
            if (resolvedPrimarySelectors.length > 0) {
                stepSelectors.push(...resolvedPrimarySelectors);
            }
            for (const fallback of step.fallback_selectors || []) {
                const fallbackSelectors = typeof this._resolveSelectorCandidates === 'function'
                    ? this._resolveSelectorCandidates(step.by, this._resolveStepTemplate(fallback))
                    : [this._convertSelector(step.by, this._resolveStepTemplate(fallback))];
                for (const fallbackSelector of fallbackSelectors) {
                    if (fallbackSelector && !stepSelectors.includes(fallbackSelector)) {
                        stepSelectors.push(fallbackSelector);
                    }
                }
            }

            const findPageByStepSelector = async () => {
                if (stepSelectors.length === 0) {
                    return null;
                }

                for (const page of [...pages].reverse()) {
                    const pageUrl = typeof page.url === 'function' ? page.url() : page.url;
                    for (const selector of stepSelectors) {
                        try {
                            const locator = page.locator(selector);
                            const count = await locator.count().catch(() => 0);
                            if (count > 0 && await locator.first().isVisible().catch(() => true)) {
                                return { page, pageUrl, selector, inFrame: false };
                            }
                        } catch (_selectorError) {}

                        if (typeof page.frames === 'function') {
                            const mainFrame = typeof page.mainFrame === 'function' ? page.mainFrame() : null;
                            for (const frame of page.frames()) {
                                if (mainFrame && frame === mainFrame) {
                                    continue;
                                }

                                try {
                                    const frameLocator = frame.locator(selector);
                                    const count = await frameLocator.count().catch(() => 0);
                                    if (count > 0 && await frameLocator.first().isVisible().catch(() => true)) {
                                        return { page, pageUrl, selector, inFrame: true };
                                    }
                                } catch (_frameSelectorError) {}
                            }
                        }
                    }
                }

                return null;
            };

            const selectorMatchedPage = await findPageByStepSelector();
            if (selectorMatchedPage && selectorMatchedPage.page && selectorMatchedPage.page !== browser) {
                if (typeof selectorMatchedPage.page.waitForLoadState === 'function') {
                    await selectorMatchedPage.page.waitForLoadState('domcontentloaded', { timeout: loadStateTimeoutMs }).catch(() => {});
                }

                if (typeof selectorMatchedPage.page.bringToFront === 'function') {
                    await selectorMatchedPage.page.bringToFront().catch(() => {});
                }

                if (browserId && this.browserManager && typeof this.browserManager.setBrowserPage === 'function') {
                    await this.browserManager.setBrowserPage(browserId, selectorMatchedPage.page);
                }

                const compactMatchedUrl = typeof this._compactPageUrl === 'function'
                    ? this._compactPageUrl(selectorMatchedPage.pageUrl)
                    : selectorMatchedPage.pageUrl;
                this.logger.info(`步骤 ${stepLabel} 前切换到包含目标${selectorMatchedPage.inFrame ? ' Frame' : ''}元素的页面: ${compactMatchedUrl || 'unknown'} | ${selectorMatchedPage.selector}`);
                return selectorMatchedPage.page;
            }

            if (isStepUpSensitiveStep) {
                const prioritizedNeedles = [stepUpNeedle, acsNeedle, challengeNeedle];
                for (const needle of prioritizedNeedles) {
                    const exactPage = pages.find(page => {
                        const url = typeof page.url === 'function' ? page.url() : page.url;
                        return typeof url === 'string' && url.includes(needle);
                    });

                    if (exactPage) {
                        if (exactPage === browser) {
                            return browser;
                        }

                        if (typeof exactPage.waitForLoadState === 'function') {
                            await exactPage.waitForLoadState('domcontentloaded', { timeout: loadStateTimeoutMs }).catch(() => {});
                        }

                        if (typeof exactPage.bringToFront === 'function') {
                            await exactPage.bringToFront().catch(() => {});
                        }

                        if (browserId && this.browserManager && typeof this.browserManager.setBrowserPage === 'function') {
                            await this.browserManager.setBrowserPage(browserId, exactPage);
                        }

                        const exactTargetUrl = typeof exactPage.url === 'function' ? exactPage.url() : exactPage.url;
                        const currentPageUrl = currentUrl || 'unknown';
                        const compactExactTargetUrl = typeof this._compactPageUrl === 'function' ? this._compactPageUrl(exactTargetUrl) : exactTargetUrl;
                        const compactCurrentPageUrl = typeof this._compactPageUrl === 'function' ? this._compactPageUrl(currentPageUrl) : currentPageUrl;
                        this.logger.info(`步骤 ${stepLabel} 优先切换到验证码页面: ${compactExactTargetUrl || 'unknown'} (原页面: ${compactCurrentPageUrl})`);
                        return exactPage;
                    }
                }

                for (const page of pages) {
                    const pageUrl = typeof page.url === 'function' ? page.url() : page.url;
                    for (const selector of stepSelectors) {
                        try {
                            const locator = page.locator(selector);
                            if (await locator.count().catch(() => 0)) {
                                if (page === browser) {
                                    return browser;
                                }

                                if (typeof page.waitForLoadState === 'function') {
                                    await page.waitForLoadState('domcontentloaded', { timeout: loadStateTimeoutMs }).catch(() => {});
                                }

                                if (typeof page.bringToFront === 'function') {
                                    await page.bringToFront().catch(() => {});
                                }

                                if (browserId && this.browserManager && typeof this.browserManager.setBrowserPage === 'function') {
                                    await this.browserManager.setBrowserPage(browserId, page);
                                }

                                this.logger.info(`步骤 ${stepLabel} 优先切换到包含验证码元素的页面: ${typeof this._compactPageUrl === 'function' ? this._compactPageUrl(pageUrl) : pageUrl || 'unknown'}`);
                                return page;
                            }
                        } catch (_selectorError) {}

                        if (typeof page.frames === 'function') {
                            for (const frame of page.frames()) {
                                try {
                                    const frameLocator = frame.locator(selector);
                                    if (await frameLocator.count().catch(() => 0)) {
                                        if (page === browser) {
                                            return browser;
                                        }

                                        if (typeof page.waitForLoadState === 'function') {
                                            await page.waitForLoadState('domcontentloaded', { timeout: loadStateTimeoutMs }).catch(() => {});
                                        }

                                        if (typeof page.bringToFront === 'function') {
                                            await page.bringToFront().catch(() => {});
                                        }

                                        if (browserId && this.browserManager && typeof this.browserManager.setBrowserPage === 'function') {
                                            await this.browserManager.setBrowserPage(browserId, page);
                                        }

                                        this.logger.info(`步骤 ${stepLabel} 优先切换到包含验证码 Frame 的页面: ${typeof this._compactPageUrl === 'function' ? this._compactPageUrl(pageUrl) : pageUrl || 'unknown'}`);
                                        return page;
                                    }
                                } catch (_frameSelectorError) {}
                            }
                        }
                    }
                }

                if (preferredContains.length > 0) {
                    this.logger.info(`步骤 ${stepLabel} 未命中验证码专用页面，保持当前页面；已配置匹配项: ${preferredContains.join(', ')}`);
                } else {
                    this.logger.info(`步骤 ${stepLabel} 未命中验证码专用页面，保持当前页面`);
                }
                return browser;
            }

            const scoredPages = pages
                .map((page, index) => {
                    const url = typeof page.url === 'function' ? page.url() : page.url;
                    if (!url || url === 'about:blank') {
                        return null;
                    }

                    let score = 0;
                    const matchesPreferred = containsNeedles.some(part => part && url.includes(part));
                    if (matchesPreferred) {
                        score += 100;
                    }

                    if (isStepUpSensitiveStep && url.includes(stepUpNeedle)) {
                        score += 500;
                    }

                    if (url.includes('cashier-my.pipopay.com') || url.includes('agreement-cashier.html')) {
                        score += 60;
                    }

                    if (url !== currentUrl) {
                        score += 10;
                    }

                    if (normalizedStepName.includes('信用卡') || normalizedStepName.includes('借记卡') || normalizedStepName.includes('绑卡') || normalizedStepName.includes('试用') || normalizedStepName.includes('验证') || normalizedStepName.includes('cvv') || normalizedStepName.includes('到期') || normalizedStepName.includes('卡号')) {
                        if (url.includes('cashier-my.pipopay.com') || url.includes('agreement-cashier.html')) {
                            score += 40;
                        }
                    }

                    return { page, url, score, index };
                })
                .filter(Boolean)
                .sort((a, b) => b.score - a.score || b.index - a.index);

            const targetEntry = scoredPages[0];
            const targetPage = targetEntry && targetEntry.page !== browser ? targetEntry.page : null;

            if (!targetPage) {
                if (preferredContains.length > 0) {
                    this.logger.info(`步骤 ${stepLabel} 未找到匹配页面，已配置匹配项: ${preferredContains.join(', ')}`);
                }
                return browser;
            }

            if (typeof targetPage.waitForLoadState === 'function') {
                await targetPage.waitForLoadState('domcontentloaded', { timeout: loadStateTimeoutMs }).catch(() => {});
            }

            if (typeof targetPage.bringToFront === 'function') {
                await targetPage.bringToFront().catch(() => {});
            }

            if (browserId && this.browserManager && typeof this.browserManager.setBrowserPage === 'function') {
                await this.browserManager.setBrowserPage(browserId, targetPage);
            }

            const targetUrl = typeof targetPage.url === 'function' ? targetPage.url() : targetPage.url;
            const currentPageUrl = currentUrl || 'unknown';
            const compactTargetUrl = typeof this._compactPageUrl === 'function' ? this._compactPageUrl(targetUrl) : targetUrl;
            const compactCurrentPageUrl = typeof this._compactPageUrl === 'function' ? this._compactPageUrl(currentPageUrl) : currentPageUrl;
            this.logger.info(`步骤 ${stepLabel} 前切换到目标页面: ${compactTargetUrl || 'unknown'} (原页面: ${compactCurrentPageUrl})`);
            return targetPage;
        } catch (error) {
            this.logger.warning(`步骤 ${stepLabel} 前切换目标页面失败: ${error.message}`);
            return browser;
        }
    },

    async _waitForPageStability(browser, step) {
        try {
            if (typeof this._ensureBrowserAvailable === 'function') {
                browser = await this._ensureBrowserAvailable(`步骤 ${step?.name || 'wait'} 页面稳定前检查`);
            }
            const stabilityTimeout = step.stability_timeout || 2500;
            const waitForElement = this._resolveStepTemplate(step.wait_for_element);
            const waitForText = this._resolveStepTemplate(step.wait_for_text);

            this.logger.debug(`开始等待页面稳定，超时: ${stabilityTimeout}ms`);
            await browser.waitForLoadState('domcontentloaded', { timeout: stabilityTimeout });

            if (waitForElement) {
                const elementSelectors = typeof this._resolveSelectorCandidates === 'function'
                    ? this._resolveSelectorCandidates(step.wait_element_by || 'css_selector', waitForElement)
                    : [this._convertSelector(step.wait_element_by || 'css_selector', waitForElement)];
                this.logger.debug(`等待元素出现: ${elementSelectors.join(' | ')}`);
                try {
                    let matched = false;
                    for (const elementSelector of elementSelectors) {
                        try {
                            const locator = browser.locator(elementSelector);
                            const count = await locator.count().catch(() => 0);
                            if (count <= 0) {
                                continue;
                            }

                            await locator.waitFor({ state: 'visible', timeout: stabilityTimeout });
                            matched = true;
                            break;
                        } catch (_selectorError) {}
                    }
                    if (matched) {
                        this.logger.debug(`元素已出现: ${elementSelectors.join(' | ')}`);
                    } else {
                        throw new Error(`未匹配到任何元素选择器: ${elementSelectors.join(' | ')}`);
                    }
                } catch (error) {
                    this.logger.warning(`等待元素超时: ${elementSelectors.join(' | ')}, 继续执行`);
                }
            }

            if (waitForText) {
                this.logger.debug(`等待文本出现: "${waitForText}"`);
                try {
                    await browser.locator(`text=${waitForText}`).waitFor({ state: 'visible', timeout: stabilityTimeout });
                    this.logger.debug(`文本已出现: "${waitForText}"`);
                } catch (error) {
                    this.logger.warning(`等待文本超时: "${waitForText}", 继续执行`);
                }
            }

            try {
                await browser.waitForLoadState('networkidle', { timeout: 1200 });
            } catch (_error) {
                this.logger.debug('等待网络空闲超时，继续执行');
            }

            this.logger.debug('页面稳定等待完成');
        } catch (error) {
            this.logger.warning(`页面稳定等待出错: ${error.message}`);
        }
    },

    async _syncBrowserPageAfterClick(browser, browserId, stepName = '', transitionHint = {}) {
        try {
            if (typeof this._ensureBrowserAvailable === 'function') {
                browser = await this._ensureBrowserAvailable(`步骤 ${stepName || 'click'} 点击后切页检查`);
            }
            if (!browser || !browser.context || typeof browser.context !== 'function') {
                return browser;
            }

            const context = browser.context();
            if (!context || typeof context.pages !== 'function') {
                return browser;
            }

            const startedAt = Date.now();
            const expectPageSwitch = transitionHint.expectPageSwitch === true;
            const timeoutMs = Number.isFinite(transitionHint.timeoutMs)
                ? transitionHint.timeoutMs
                : (expectPageSwitch ? 8000 : 1200);
            const intervalMs = Number.isFinite(transitionHint.intervalMs)
                ? transitionHint.intervalMs
                : (expectPageSwitch ? 250 : 150);
            const beforeUrl = transitionHint.beforeUrl || (typeof browser.url === 'function' ? browser.url() : browser.url);
            const beforePageCount = transitionHint.beforePageCount || 0;
            const requiredPageContains = Array.isArray(transitionHint.requiredPageContains)
                ? transitionHint.requiredPageContains
                : (transitionHint.requiredPageContains ? [transitionHint.requiredPageContains] : []);

            if (timeoutMs <= 0) {
                return browser;
            }

            while (Date.now() - startedAt <= timeoutMs) {
                const pages = context.pages().filter(page => page && typeof page.isClosed === 'function' && !page.isClosed());
                if (pages.length === 0) {
                    await this._sleepInterruptibly(intervalMs, `步骤 ${stepName || 'click'} 等待新页面`);
                    continue;
                }

                const currentUrl = typeof browser.url === 'function' ? browser.url() : browser.url;
                const currentPageExists = pages.some(page => {
                    const url = typeof page.url === 'function' ? page.url() : page.url;
                    return url === currentUrl;
                });

                let targetPage = null;
                if (requiredPageContains.length > 0) {
                    targetPage = [...pages].reverse().find(page => {
                        if (!page || page === browser) {
                            return false;
                        }

                        const url = typeof page.url === 'function' ? page.url() : page.url;
                        return typeof url === 'string' && requiredPageContains.some(needle => needle && url.includes(needle));
                    }) || null;
                }

                if (pages.length > 1 || (beforePageCount && pages.length > beforePageCount)) {
                    const pageCandidates = [...pages].reverse();
                    targetPage = targetPage || pageCandidates.find(page => {
                        if (page === browser) {
                            return false;
                        }

                        const url = typeof page.url === 'function' ? page.url() : page.url;
                        return url && url !== 'about:blank' && url !== beforeUrl;
                    }) || pageCandidates.find(page => page !== browser && page !== null) || null;
                }

                if (targetPage && targetPage !== browser) {
                if (typeof targetPage.waitForLoadState === 'function') {
                    await targetPage.waitForLoadState('domcontentloaded', { timeout: 1500 }).catch(() => {});
                }

                    if (typeof targetPage.bringToFront === 'function') {
                        await targetPage.bringToFront().catch(() => {});
                    }

                    if (browserId && this.browserManager && typeof this.browserManager.setBrowserPage === 'function') {
                        await this.browserManager.setBrowserPage(browserId, targetPage);
                    }

                    const targetUrl = typeof targetPage.url === 'function' ? targetPage.url() : targetPage.url;
                    this.logger.info(`步骤 ${stepName} 后切换到新页面: ${targetUrl || currentUrl || 'unknown'}`);
                    return targetPage;
                }

                if (currentPageExists && currentUrl && currentUrl !== 'about:blank' && currentUrl !== beforeUrl && beforePageCount <= 1) {
                    this.logger.info(`步骤 ${stepName} 后当前页面已跳转: ${currentUrl}`);
                    return browser;
                }

                await this._sleepInterruptibly(intervalMs, `步骤 ${stepName || 'click'} 轮询页面切换`);
            }

            const timeoutMessage = `步骤 ${stepName} 后未检测到新页面切换，继续使用当前页面: ${beforeUrl || 'unknown'}`;
            if (expectPageSwitch) {
                this.logger.warning(timeoutMessage);
            } else {
                this.logger.debug(timeoutMessage);
            }
        } catch (error) {
            this.logger.debug(`同步新页面失败: ${error.message}`);
        }

        return browser;
    },
    async _preferLatestOpenPage(browser, browserId, stepName = '') {
        try {
            if (typeof this._ensureBrowserAvailable === 'function') {
                browser = await this._ensureBrowserAvailable(`步骤 ${stepName || 'page'} 切换最新页面前检查`);
            }
            if (!browser || typeof browser.context !== 'function') {
                return browser;
            }

            const context = browser.context();
            if (!context || typeof context.pages !== 'function') {
                return browser;
            }

            const pages = context.pages().filter(page => page && typeof page.isClosed === 'function' && !page.isClosed());
            if (pages.length <= 1) {
                return browser;
            }

            const currentUrl = typeof browser.url === 'function' ? browser.url() : browser.url;
            const candidates = [...pages].reverse();
            const targetPage = candidates.find(page => {
                if (page === browser) {
                    return false;
                }

                const url = typeof page.url === 'function' ? page.url() : page.url;
                return url && url !== 'about:blank' && url !== currentUrl;
            });

            if (!targetPage || targetPage === browser) {
                return browser;
            }

            if (typeof targetPage.waitForLoadState === 'function') {
                await targetPage.waitForLoadState('domcontentloaded', { timeout: 1200 }).catch(() => {});
            }

            if (typeof targetPage.bringToFront === 'function') {
                await targetPage.bringToFront().catch(() => {});
            }

            if (browserId && this.browserManager && typeof this.browserManager.setBrowserPage === 'function') {
                await this.browserManager.setBrowserPage(browserId, targetPage);
            }

            const targetUrl = typeof targetPage.url === 'function' ? targetPage.url() : targetPage.url;
            const compactTargetUrl = typeof this._compactPageUrl === 'function' ? this._compactPageUrl(targetUrl) : targetUrl;
            this.logger.info(`步骤 ${stepName} 前切换到最新页面: ${compactTargetUrl || 'unknown'}`);
            return targetPage;
        } catch (error) {
            this.logger.warning(`步骤 ${stepName} 前切换页面失败: ${error.message}`);
            return browser;
        }
    },
    _compactPageUrl(url, maxLength = 120) {
        if (typeof url !== 'string' || !url.trim()) {
            return 'about:blank';
        }

        const normalizedUrl = url.trim();
        if (normalizedUrl === 'about:blank') {
            return 'about:blank';
        }

        try {
            const parsed = new URL(normalizedUrl);
            const path = parsed.pathname || '/';
            const shortPath = path.length > 80 ? `${path.slice(0, 77)}...` : path;
            const query = parsed.search ? '?…' : '';
            const hash = parsed.hash ? '#…' : '';
            return `${parsed.origin}${shortPath}${query}${hash}`;
        } catch (_error) {
            if (normalizedUrl.length <= maxLength) {
                return normalizedUrl;
            }

            const keep = Math.max(24, Math.floor((maxLength - 3) / 2));
            return `${normalizedUrl.slice(0, keep)}...${normalizedUrl.slice(-keep)}`;
        }
    },

    async _describeOpenPages(browser) {
        try {
            if (!browser || typeof browser.context !== 'function') {
                return '';
            }

            const context = browser.context();
            if (!context || typeof context.pages !== 'function') {
                return '';
            }

            const pages = context.pages().filter(page => page && typeof page.isClosed === 'function' && !page.isClosed());
            if (pages.length === 0) {
                return '';
            }

            const currentUrl = typeof browser.url === 'function' ? browser.url() : browser.url;
            const pageInfo = [];
            const maxPages = 20;

            for (const [index, page] of pages.slice(0, maxPages).entries()) {
                const url = typeof page.url === 'function' ? page.url() : page.url;
                const title = typeof page.title === 'function' ? await page.title().catch(() => '') : '';
                const mark = url === currentUrl ? '*' : ' ';
                const compactUrl = this._compactPageUrl(url);
                const compactTitle = typeof title === 'string' && title.trim()
                    ? title.trim().replace(/\s+/g, ' ').slice(0, 36)
                    : 'untitled';

                pageInfo.push(`${mark}${index + 1}:{title="${compactTitle}", url="${compactUrl}"}`);
            }

            if (pages.length > maxPages) {
                pageInfo.push(`...(+${pages.length - maxPages})`);
            }

            return pageInfo.join(' | ');
        } catch (error) {
            this.logger.debug(`描述页面列表失败: ${error.message}`);
            return '';
        }
    }
};
