const { installLayoutOverride } = require('../browser/page-layout-overrides');

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

const normalizeCookieSameSite = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) {
        return '';
    }

    if (raw === 'strict') {
        return 'Strict';
    }
    if (raw === 'lax') {
        return 'Lax';
    }
    if (raw === 'none' || raw === 'no_restriction') {
        return 'None';
    }

    return '';
};

async function resolveTesterCardKey(tester) {
    if (typeof tester.cardKeyResolver === 'function') {
        return String(await tester.cardKeyResolver() || '').trim();
    }
    return String(tester.currentCardKey || '').trim();
}

async function installTestCardLayoutForPage(tester, page, cardData, targetUrl) {
    const cardKey = await resolveTesterCardKey(tester);
    if (!cardKey || !targetUrl || !cardData?.name) {
        return null;
    }

    const context = typeof page?.context === 'function' ? page.context() : null;
    if (!context) {
        return null;
    }

    return await installLayoutOverride(context, {
        resourceRoot: tester.cardManager?.resourceRoot || '',
        cardKey,
        cardName: String(cardData.name || '').trim(),
        url: targetUrl
    });
}

const normalizeCookieForPlaywright = (cookie = {}, fallbackUrl = '') => {
    const name = String(cookie.name || '').trim();
    if (!name) {
        return null;
    }

    const domain = String(cookie.domain || '').trim();
    const explicitUrl = String(cookie.url || '').trim();
    const normalized = {
        name,
        value: String(cookie.value || ''),
        path: String(cookie.path || '/').trim() || '/',
        secure: cookie.secure === true,
        httpOnly: cookie.httpOnly === true
    };

    if (domain) {
        normalized.domain = domain;
    } else if (explicitUrl) {
        normalized.url = explicitUrl;
        delete normalized.path;
    } else if (fallbackUrl) {
        normalized.url = fallbackUrl;
        delete normalized.path;
    } else {
        return null;
    }

    if (cookie.expires !== undefined && cookie.expires !== null) {
        const expires = Number(cookie.expires);
        if (Number.isFinite(expires) && expires > 0) {
            const expiresSeconds = expires > 1e12 ? Math.floor(expires / 1000) : Math.floor(expires);
            if (expiresSeconds <= Math.floor(Date.now() / 1000)) {
                return null;
            }
            normalized.expires = expiresSeconds;
        }
    }

    const sameSite = normalizeCookieSameSite(cookie.sameSite);
    if (sameSite) {
        normalized.sameSite = sameSite;
    }

    return normalized;
};

const getCookieVerificationUrls = (cookies = [], fallbackUrl = '') => {
    const urls = new Set();
    const isLocalNetworkHost = (hostname = '') => {
        const host = String(hostname || '').trim().toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || /^127(?:\.\d{1,3}){3}$/.test(host);
    };
    const normalizedFallbackUrl = String(fallbackUrl || '').trim();
    if (normalizedFallbackUrl) {
        urls.add(normalizedFallbackUrl);
    }

    for (const cookie of Array.isArray(cookies) ? cookies : []) {
        const explicitUrl = String(cookie?.url || '').trim();
        if (explicitUrl) {
            urls.add(explicitUrl);
            continue;
        }

        const domain = String(cookie?.domain || '').trim();
        if (!domain) {
            continue;
        }

        const host = domain.startsWith('.') ? domain.slice(1) : domain;
        if (!host) {
            continue;
        }

        const secure = cookie?.secure === true || String(cookie?.sameSite || '').trim().toLowerCase() === 'none' || !isLocalNetworkHost(host);
        const pathValue = String(cookie?.path || '/').trim() || '/';
        urls.add(`${secure ? 'https' : 'http'}://${host}${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`);
    }

    return [...urls];
};

const getStorageOriginUrl = (snapshot = {}, fallbackUrl = '') => {
    const candidates = [
        snapshot.origin,
        snapshot.url,
        fallbackUrl
    ];

    for (const candidate of candidates) {
        const normalized = normalizeNavigationUrl(candidate || '');
        if (!normalized) {
            continue;
        }

        try {
            const parsed = new URL(normalized);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return parsed.origin;
            }
        } catch (_error) {
        }
    }

    return '';
};

const hasStorageEntries = (storage = {}) => {
    return !!storage && typeof storage === 'object' && Object.keys(storage).length > 0;
};

module.exports = {
    /**
     * 注入Cookie到页面
     */
    async injectCookies(page, cookies, options = {}) {
        if (!cookies || cookies.length === 0) {
            this.logger.warning('没有Cookie数据可注入');
            throw new Error('没有Cookie数据可注入');
        }

        let cookieArray = cookies;
        if (typeof cookies === 'string') {
            try {
                cookieArray = JSON.parse(cookies);
                this.logger.info('已解析 cookie 字符串为数组');
            } catch (e) {
                this.logger.error(`解析 cookie 字符串失败: ${e.message}`);
                throw e;
            }
        }

        if (!Array.isArray(cookieArray)) {
            cookieArray = [cookieArray];
        }

        const fallbackUrl = normalizeNavigationUrl(options.fallbackUrl || options.url || '');
        const playwrightCookies = cookieArray
            .map(cookie => normalizeCookieForPlaywright(cookie, fallbackUrl))
            .filter(Boolean);

        if (playwrightCookies.length === 0) {
            throw new Error('Cookie数据缺少有效 name/domain/url，无法注入');
        }
        if (playwrightCookies.length < cookieArray.length) {
            this.logger.warning(`已跳过 ${cookieArray.length - playwrightCookies.length} 个无效或已过期Cookie`);
        }

        try {
            const context = page.context();
            const addResult = await context.addCookies(playwrightCookies);
            if (addResult === false) {
                throw new Error('浏览器上下文返回 Cookie 注入失败');
            }

            const verifyUrls = getCookieVerificationUrls(playwrightCookies, fallbackUrl);
            const injectedCookies = typeof context.cookies === 'function'
                ? await context.cookies(verifyUrls)
                : [];
            const injectedNames = new Set((Array.isArray(injectedCookies) ? injectedCookies : []).map(cookie => cookie.name));
            let missingCookies = playwrightCookies.filter(cookie => !injectedNames.has(cookie.name));
            if (missingCookies.length > 0 && typeof context.cookies === 'function') {
                const allInjectedCookies = await context.cookies();
                const allInjectedNames = new Set((Array.isArray(allInjectedCookies) ? allInjectedCookies : []).map(cookie => cookie.name));
                missingCookies = missingCookies.filter(cookie => !allInjectedNames.has(cookie.name));
            }
            if (missingCookies.length > 0) {
                throw new Error(`Cookie写入后校验失败，未读回: ${missingCookies.slice(0, 5).map(cookie => cookie.name).join(', ')}`);
            }

            const injectedDomains = [...new Set((Array.isArray(injectedCookies) ? injectedCookies : [])
                .map(cookie => String(cookie.domain || '').trim())
                .filter(Boolean))]
                .slice(0, 6);
            this.logger.info(`成功注入 ${playwrightCookies.length} 个Cookie，校验读回 ${injectedNames.size} 个Cookie${fallbackUrl ? `，目标: ${fallbackUrl}` : ''}${injectedDomains.length ? `，域名: ${injectedDomains.join(', ')}` : ''}`);
        } catch (cookieError) {
            this.logger.error(`Cookie注入失败: ${cookieError.message}`);
            throw cookieError;
        }
    },

    async injectBrowserStorage(page, browserStorage = [], options = {}) {
        const snapshots = Array.isArray(browserStorage) ? browserStorage : [];
        if (snapshots.length === 0) {
            return 0;
        }

        const fallbackUrl = normalizeNavigationUrl(options.fallbackUrl || options.url || '');
        let restoredCount = 0;

        for (const snapshot of snapshots) {
            const originUrl = getStorageOriginUrl(snapshot, fallbackUrl);
            if (!originUrl) {
                continue;
            }

            const localStorageData = hasStorageEntries(snapshot.localStorage) ? snapshot.localStorage : {};
            const sessionStorageData = hasStorageEntries(snapshot.sessionStorage) ? snapshot.sessionStorage : {};
            if (!hasStorageEntries(localStorageData) && !hasStorageEntries(sessionStorageData)) {
                continue;
            }

            try {
                await page.goto(originUrl, {
                    timeout: 60000,
                    waitUntil: 'domcontentloaded'
                });
            } catch (navigationError) {
                this.logger.warning(`恢复浏览器存储时打开 ${originUrl} 失败: ${navigationError.message}`);
            }

            try {
                await page.evaluate(({ localStorageData: localData, sessionStorageData: sessionData }) => {
                    const restore = (target, values) => {
                        if (!target || !values || typeof values !== 'object') {
                            return 0;
                        }

                        let count = 0;
                        for (const [key, value] of Object.entries(values)) {
                            try {
                                target.setItem(key, String(value));
                                count += 1;
                            } catch (_error) {
                            }
                        }
                        return count;
                    };

                    return restore(window.localStorage, localData) + restore(window.sessionStorage, sessionData);
                }, {
                    localStorageData,
                    sessionStorageData
                });

                restoredCount += Object.keys(localStorageData).length + Object.keys(sessionStorageData).length;
            } catch (storageError) {
                this.logger.warning(`恢复浏览器存储失败 ${originUrl}: ${storageError.message}`);
            }
        }

        if (restoredCount > 0) {
            this.logger.info(`成功恢复浏览器存储 ${restoredCount} 项`);
        }

        return restoredCount;
    },

    /**
     * 更新Cookie积分
     * @param {string} email - 邮箱
     * @param {string} cardName - 卡片名称
     * @param {number} newCredits - 新积分
     * @param {number} oldCredits - 旧积分
     * @param {string} aid - 账号ID（可选）
     */
    async updateCookieCredits(email, cardName, newCredits, oldCredits, aid = null) {
        const updateSuccess = await this.cookieManager.updateCookiePoints(email, cardName, newCredits);

        if (updateSuccess) {
            const oldPoints = parseInt(oldCredits || 0);
            const newPoints = parseInt(newCredits || 0);
            const change = newPoints - oldPoints;

            let changeText = '';
            if (change > 0) {
                changeText = `(+${change})`;
            } else if (change < 0) {
                changeText = `(${change})`;
            } else {
                changeText = '(无变化)';
            }

            this.logger.info(`✅ Cookie积分同步完成: ${email} (${oldCredits}->${newCredits}) ${changeText}`);

            if (this.mainWindow) {
                this.mainWindow.webContents.send('cookie-credits-changed', {
                    email,
                    cardName,
                    oldCredits: oldPoints,
                    newCredits: newPoints,
                    change: change,
                    changeText: changeText,
                    aid: aid
                });
            }
        } else {
            this.logger.warning(`❌ 更新Cookie积分失败: ${email}`);
        }

        return updateSuccess;
    },

    /**
     * 在已有浏览器页面上执行测试卡片流程
     */
    async executeTestCardFlowOnPage(cookieInfo, cardData, page, options = {}) {
        const { email } = cookieInfo;
        try {
            this.logger.info(`执行测试卡片流程: ${email} (${cardData.name})`);

            const shouldInjectCookies = options.injectCookies !== false;
            const shouldInjectBrowserStorage = options.injectBrowserStorage !== false;

            let cookies = Array.isArray(cookieInfo.cookies) ? cookieInfo.cookies : [];
            let browserStorage = Array.isArray(cookieInfo.browserStorage) ? cookieInfo.browserStorage : [];
            if (shouldInjectCookies || shouldInjectBrowserStorage) {
                if ((!Array.isArray(cookies) || cookies.length === 0) && typeof this.cookieManager.getCookiePayload === 'function') {
                    const payload = await this.cookieManager.getCookiePayload(email);
                    if (Array.isArray(payload?.cookies) && payload.cookies.length > 0) {
                        cookies = payload.cookies;
                    }
                    if (Array.isArray(payload?.browserStorage) && payload.browserStorage.length > 0) {
                        browserStorage = payload.browserStorage;
                    }
                }
                if (!cookies) {
                    cookies = await this.cookieManager.getCookies(email);
                }
                if ((!Array.isArray(cookies) || cookies.length === 0) && browserStorage.length === 0) {
                    return { success: false, message: '无法获取Cookie或浏览器存储数据' };
                }
            }

            if (!page) {
                return { success: false, message: '浏览器页面不可用' };
            }

            const fallbackUrl = cardData.website || cardData.url || '';
            const layoutUrl = normalizeNavigationUrl(fallbackUrl);
            if (layoutUrl) {
                try {
                    await installTestCardLayoutForPage(this, page, cardData, layoutUrl);
                } catch (layoutError) {
                    this.logger.warning(`加载测试卡片页面布局失败: ${layoutError.message}`);
                }
            }

            if (cardData.popups && Array.isArray(cardData.popups)) {
                if (page.addLocatorHandler) {
                    for (const popup of cardData.popups) {
                        const selectors = [];
                        if (popup.selector) selectors.push(popup.selector);
                        if (popup.fallback_selectors) selectors.push(...popup.fallback_selectors);

                        const cssSelectors = selectors.filter(s => !s.startsWith('xpath=') && !s.startsWith('//'));

                        if (cssSelectors.length > 0) {
                            for (const sel of cssSelectors) {
                                try {
                                    await page.addLocatorHandler(page.locator(sel), async (overlay) => {
                                        const count = await overlay.count();
                                        this.logger.info(`检测到弹窗 ${popup.name} (${sel})，数量: ${count}`);

                                        if (count > 0) {
                                            for (let i = 0; i < count; i++) {
                                                const el = overlay.nth(i);
                                                if (await el.isVisible().catch(() => false)) {
                                                    try {
                                                        await el.click({ timeout: 2000 });
                                                        this.logger.info(`已点击第 ${i + 1} 个弹窗关闭按钮`);
                                                        await new Promise(r => setTimeout(r, 500));
                                                    } catch (err) {
                                                    }
                                                }
                                            }
                                        }
                                    }, { noWaitAfter: true });
                                    this.logger.debug(`已初始化弹窗处理器: ${popup.name} - ${sel}`);
                                } catch (regErr) {
                                    this.logger.warning(`初始化单个选择器处理器失败: ${sel} - ${regErr.message}`);
                                }
                            }
                        }

                        const otherSelectors = selectors.filter(s => s.startsWith('xpath=') || s.startsWith('//'));
                        for (const s of otherSelectors) {
                            try {
                                const locatorStr = s.startsWith('//') ? `xpath=${s}` : s;
                                await page.addLocatorHandler(page.locator(locatorStr), async (overlay) => {
                                    this.logger.info(`检测到弹窗 (XPath)，尝试关闭: ${popup.name}`);

                                    const count = await overlay.count();
                                    if (count > 0) {
                                        for (let i = 0; i < count; i++) {
                                            const el = overlay.nth(i);
                                            if (await el.isVisible().catch(() => false)) {
                                                try {
                                                    await el.click({ timeout: 2000 });
                                                    this.logger.info(`已点击第 ${i + 1} 个XPath弹窗关闭按钮`);
                                                    await new Promise(r => setTimeout(r, 500));
                                                } catch (err) {
                                                }
                                            }
                                        }
                                    }
                                }, { noWaitAfter: true });
                            } catch (e) {
                                this.logger.warning(`初始化弹窗处理器失败 (${popup.name}, ${s}): ${e.message}`);
                            }
                        }
                    }
                } else {
                    this.logger.warning('当前 Playwright 版本不支持 addLocatorHandler，无法自动处理弹窗');
                }
            }

            if (shouldInjectCookies && Array.isArray(cookies) && cookies.length > 0) {
                await this.injectCookies(page, cookies, { fallbackUrl });
            }
            if (shouldInjectBrowserStorage) {
                await this.injectBrowserStorage(page, browserStorage, { fallbackUrl });
            }

            let finalCredits = null;
            if (cardData.steps && cardData.steps.length > 0) {
                for (const step of cardData.steps) {
                    const result = await this.executeStep(page, step);

                    if (step.type === 'get_credits' && result !== undefined && result !== null) {
                        finalCredits = result;
                    }

                    if (step.type === 'wait' && step.end_scores !== undefined && result !== undefined) {
                        finalCredits = result;
                        this.logger.info(`通过 wait 步骤检测到特征，设置积分为: ${finalCredits}`);
                        break;
                    }
                }
            } else if (cardData.website) {
                await page.goto(normalizeNavigationUrl(cardData.website));
            }

            if (finalCredits !== null) {
                await this.updateCookieCredits(email, cookieInfo.card_name, finalCredits, cookieInfo.points, cookieInfo.aid);
                return { success: true, message: '测试流程执行完成', credits: finalCredits };
            }

            return { success: true, message: '测试流程执行完成' };
        } catch (error) {
            this.logger.error(`测试流程执行失败: ${error.message}`);
            return { success: false, message: `执行失败: ${error.message}` };
        }
    },

    /**
     * 执行测试卡片流程（通用步骤执行）
     */
    async executeTestCardFlow(cookieInfo, cardData) {
        const browserId = await this.browserManager.createBrowser(
            this.browserType,
            this.testConfig.headless,
            this.browserSettings
        );

        if (!browserId) {
            return { success: false, message: '创建浏览器失败' };
        }

        try {
            const page = this.browserManager.getBrowser(browserId);
            if (!page) {
                return { success: false, message: '获取浏览器页面失败' };
            }

            return await this.executeTestCardFlowOnPage(cookieInfo, cardData, page, {
                injectCookies: true,
                injectBrowserStorage: true
            });
        } finally {
            const delay = this.testConfig.headless ? 1000 : 5000;
            await new Promise(resolve => setTimeout(resolve, delay));
            await this.browserManager.closeBrowser(browserId);
        }
    },

    /**
     * 执行单个步骤
     */
    async executeStep(page, step) {
        this.logger.info(`执行步骤: ${step.name || step.type}`);
        const timeout = step.timeout || 30000;

        try {
            return await this._performStepAction(page, step, timeout);
        } catch (error) {
            if (step.on_timeout === 'race_fastest_node' && this.clashManager) {
                this.logger.warning(`步骤执行失败，触发节点优选策略...`);
                try {
                    const switched = await this._raceFastestNode();
                    if (switched) {
                        this.logger.info(`节点切换成功，重试步骤: ${step.name}`);
                        return await this._performStepAction(page, step, timeout);
                    }
                } catch (raceError) {
                    this.logger.error(`节点优选策略执行失败: ${raceError.message}`);
                }
            }

            this.logger.error(`步骤执行失败 (${step.name || step.type}): ${error.message}`);
            throw error;
        }
    },

    async _performStepAction(page, step, timeout) {
        switch (step.type) {
            case 'navigate':
                await page.goto(normalizeNavigationUrl(step.url), { timeout: timeout, waitUntil: 'domcontentloaded' });
                break;
            case 'click':
                let clickSuccess = false;
                let lastError = null;
                const selectors = [];

                if (step.selector) selectors.push({ selector: step.selector, by: step.by || 'css_selector' });
                if (step.xpath) selectors.push({ selector: `xpath=${step.xpath}`, by: 'xpath' });
                if (step.fallback_selectors) {
                    for (const s of step.fallback_selectors) {
                        selectors.push({ selector: s, by: step.by || 'css_selector' });
                    }
                }

                for (const item of selectors) {
                    const rawSelector = typeof item === 'object' ? item.selector : item;
                    const by = typeof item === 'object' ? item.by : (step.by || 'css_selector');

                    const selector = this._convertSelector(by, rawSelector);
                    const stepTimeout = selectors.length > 1 ? Math.max(1000, timeout / selectors.length) : timeout;

                    try {
                        await page.click(selector, { timeout: stepTimeout });
                        clickSuccess = true;
                        this.logger.info(`点击成功: ${selector}`);
                        break;
                    } catch (e) {
                        lastError = e;
                        this.logger.debug(`点击尝试失败 (${selector}): ${e.message}`);
                    }
                }

                if (!clickSuccess) {
                    if (step.optional) {
                        this.logger.info(`可选步骤点击失败，继续执行`);
                    } else {
                        throw lastError || new Error('Click failed');
                    }
                }
                break;
            case 'wait':
                if (step.wait_for_element) {
                    const selector = this._convertSelector(step.wait_element_by || 'css_selector', step.wait_for_element);
                    const waitTimeout = step.stability_timeout || step.timeout || 30000;
                    try {
                        this.logger.info(`等待元素出现: ${selector} (超时: ${waitTimeout}ms)`);
                        await page.waitForSelector(selector, { timeout: waitTimeout });

                        if (step.end_scores !== undefined) {
                            this.logger.info(`找到等待元素 ${selector}，直接设置积分为 ${step.end_scores}`);
                            return parseInt(step.end_scores);
                        }
                    } catch (e) {
                        if (step.end_scores === undefined) {
                            throw e;
                        } else {
                            this.logger.info(`未找到等待元素 ${selector}，不设置 end_scores`);
                        }
                    }
                } else if (step.time || step.seconds) {
                    const ms = (step.time) || (step.seconds * 1000);
                    this.logger.info(`等待 ${ms}ms`);
                    await new Promise(resolve => setTimeout(resolve, ms));
                }
                break;
            case 'input':
            case 'type':
                if (step.selector && (step.value || step.text)) {
                    const selector = this._convertSelector(step.by || 'css_selector', step.selector);
                    const value = step.value || step.text;
                    await page.fill(selector, value);
                }
                break;
            case 'get_credits':
                return await this._getCreditsFromPage(page, step);
            default:
                this.logger.warning(`未知步骤类型: ${step.type}`);
        }
    },

    /**
     * 优选最快节点并切换
     */
    async _raceFastestNode() {
        this.logger.info('开始执行节点优选...');

        const groupName = await this.clashManager.findSelectorGroup();
        if (!groupName) {
            throw new Error('未找到节点选择组');
        }

        const proxies = await this.clashManager.getProxies();
        const group = proxies[groupName];
        if (!group || !group.all || group.all.length === 0) {
            throw new Error(`节点组 ${groupName} 为空`);
        }

        const candidateNodes = group.all.filter(name => {
            return name !== 'DIRECT' && name !== 'REJECT' && name !== 'GLOBAL';
        });

        this.logger.info(`找到 ${candidateNodes.length} 个候选节点，开始并发测速...`);

        const results = [];
        const concurrency = 50;

        for (let i = 0; i < candidateNodes.length; i += concurrency) {
            const batch = candidateNodes.slice(i, i + concurrency);
            const promises = batch.map(async (nodeName) => {
                const result = await this.clashManager.testNodeLatency(nodeName);
                if (result.success) {
                    return { name: nodeName, delay: result.delay };
                }
                return null;
            });

            const batchResults = await Promise.all(promises);
            results.push(...batchResults.filter(r => r !== null));
        }

        if (results.length === 0) {
            throw new Error('所有节点测速失败');
        }

        results.sort((a, b) => a.delay - b.delay);
        const bestNode = results[0];

        this.logger.info(`测速完成，最优节点: ${bestNode.name} (延迟: ${bestNode.delay}ms)`);

        if (group.now === bestNode.name) {
            this.logger.info('当前已是最佳节点，无需切换');
            return true;
        }

        const success = await this.clashManager.clashRequest('PUT', `/proxies/${encodeURIComponent(groupName)}`, { name: bestNode.name });
        if (success) {
            this.logger.info(`✅ 已切换到节点: ${bestNode.name}`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            return true;
        } else {
            throw new Error('切换节点失败');
        }
    },

    /**
     * 从页面获取积分
     */
    async _getCreditsFromPage(page, step) {
        const by = step.by || 'css_selector';
        const timeout = step.timeout || 15000;

        const selectors = [];
        if (step.selector) {
            if (step.selector.includes(',')) {
                selectors.push(...step.selector.split(',').map(s => s.trim()));
            } else {
                selectors.push(step.selector);
            }
        }
        if (step.fallback_selectors) {
            selectors.push(...step.fallback_selectors);
        }
        if (selectors.length === 0) {
            selectors.push('div.credit-amount-text-VHUjL3');
        }

        let credits = await this._tryGetCredits(page, selectors, by, timeout, step);

        const retryOnZero = step.retry_on_zero_credits || false;
        if (credits === 0 && retryOnZero) {
            const retryDelay = step.retry_delay_seconds || 10;
            this.logger.info(`获取到0积分，等待${retryDelay}秒后重新获取...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay * 1000));
            credits = await this._tryGetCredits(page, selectors, by, timeout, step);
            this.logger.info(`重新获取到积分数: ${credits}`);
        }

        if (credits === null || credits === undefined) {
            if (step.default !== undefined) {
                const defaultCredits = parseInt(step.default);
                this.logger.info(`获取失败，使用默认积分值: ${defaultCredits}`);
                return defaultCredits;
            }
            return 0;
        }

        return credits;
    },

    async _tryGetCredits(page, selectors, by, timeout, step) {
        const maxAttempts = step.max_attempts || step.max_selector_attempts || 10;

        for (const rawSelector of selectors) {
            let attempts = 0;
            while (attempts < maxAttempts) {
                try {
                    attempts++;
                    const selector = this._convertSelector(by, rawSelector);
                    this.logger.debug(`尝试获取积分 (${attempts}/${maxAttempts}): ${selector}`);

                    const elementTimeout = Math.min(timeout / maxAttempts, 3000);
                    try {
                        await page.waitForSelector(selector, { state: 'visible', timeout: elementTimeout });
                    } catch (e) {
                    }

                    const element = await page.$(selector);
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

                    if (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                } catch (e) {
                    this.logger.debug(`获取积分尝试失败: ${e.message}`);
                    if (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
            }
        }
        return null;
    },

    _convertSelector(by, selector) {
        switch (by) {
            case 'id': return `#${selector}`;
            case 'css_selector':
                if (selector.includes(':has-text(')) {
                    const match = selector.match(/:has-text\(['"](.*?)['"]\)/);
                    if (match) {
                        const text = match[1];
                        const cssPart = selector.replace(/:has-text\(['"].*?['"]\)/, '').trim();
                        if (cssPart) {
                            return `${cssPart} >> text=${text}`;
                        } else {
                            return `text=${text}`;
                        }
                    }
                }
                return selector;
            case 'xpath': return `xpath=${selector}`;
            case 'class_name': return `.${selector}`;
            case 'name': return `[name='${selector}']`;
            default: return selector;
        }
    }
};
