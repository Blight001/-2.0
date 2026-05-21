const { extractVerificationCode, normalizeSelectorList, normalizeSessionId, resolveProviderById } = require('./temp-email-utils');

module.exports = {
    getState() {
        return {
            mode: this.currentMode,
            selectedProviderId: this.currentProviderId,
            provider: this.currentProvider ? { ...this.currentProvider } : null,
            providers: this.providers.map((item) => ({ ...item })),
            apiConfig: this.apiConfig ? {
                ...this.apiConfig,
                endpoints: { ...(this.apiConfig.endpoints || {}) }
            } : this.getApiConfig(),
            browserId: this.browserId,
            browserOpen: !!this.browserId,
            url: this.currentUrl,
            email: this.currentEmail,
            code: this.currentCode,
            selection: this.currentSelection
        };
    },

    _emitState(extra = {}) {
        if (extra && extra.sessionId && this._normalizeSessionId(extra.sessionId) !== this.defaultSessionId) {
            return;
        }

        if (typeof this.app?.emitUiEvent !== 'function') {
            return;
        }

        this.app.emitUiEvent('temp-email-state', {
            ...this.getState(),
            ...extra
        });
    },

    _getBrowserManager() {
        return this.app?.browserManager || null;
    },

    _getActivePage(sessionState = null) {
        const browserManager = this._getBrowserManager();
        const browserId = sessionState && typeof sessionState === 'object'
            ? sessionState.browserId || ''
            : this.browserId;

        if (!browserManager || !browserId) {
            return null;
        }

        if (typeof browserManager.getBrowser === 'function') {
            return browserManager.getBrowser(browserId);
        }

        return null;
    },

    _normalizeSessionId(sessionId = this.defaultSessionId) {
        return normalizeSessionId(sessionId, this.defaultSessionId);
    },

    _createSessionState(sessionId = this.defaultSessionId, provider = null) {
        const normalizedSessionId = this._normalizeSessionId(sessionId);
        const normalizedProvider = provider && typeof provider === 'object' ? { ...provider } : null;

        return {
            sessionId: normalizedSessionId,
            browserId: '',
            currentProviderId: normalizedProvider?.id || this.currentProviderId || '',
            currentProvider: normalizedProvider,
            currentUrl: '',
            currentEmail: '',
            currentCode: '',
            currentSelection: ''
        };
    },

    _getSessionState(sessionId = this.defaultSessionId, create = true) {
        const normalizedSessionId = this._normalizeSessionId(sessionId);
        if (normalizedSessionId === this.defaultSessionId) {
            if (!this.defaultSessionState && create) {
                this.defaultSessionState = this._createSessionState(this.defaultSessionId, this.currentProvider);
            }
            if (this.defaultSessionState) {
                this.defaultSessionState.browserId = this.browserId || '';
                this.defaultSessionState.currentMode = this.currentMode;
                this.defaultSessionState.currentProviderId = this.currentProviderId || this.defaultSessionState.currentProviderId || '';
                this.defaultSessionState.currentProvider = this.currentProvider ? { ...this.currentProvider } : null;
                this.defaultSessionState.currentUrl = this.currentUrl || '';
                this.defaultSessionState.currentEmail = this.currentEmail || '';
                this.defaultSessionState.currentCode = this.currentCode || '';
                this.defaultSessionState.currentSelection = this.currentSelection || '';
            }
            return this.defaultSessionState || null;
        }

        if (!this.browserSessions.has(normalizedSessionId) && create) {
            this.browserSessions.set(
                normalizedSessionId,
                this._createSessionState(normalizedSessionId, this.currentProvider)
            );
        }

        return this.browserSessions.get(normalizedSessionId) || null;
    },

    _syncLegacyStateFromSession(sessionState = null) {
        if (!sessionState || this._normalizeSessionId(sessionState.sessionId) !== this.defaultSessionId) {
            return;
        }

        this.browserId = sessionState.browserId || '';
        this.currentProviderId = sessionState.currentProviderId || '';
        this.currentProvider = sessionState.currentProvider ? { ...sessionState.currentProvider } : null;
        this.currentUrl = sessionState.currentUrl || '';
        this.currentEmail = sessionState.currentEmail || '';
        this.currentCode = sessionState.currentCode || '';
        this.currentSelection = sessionState.currentSelection || '';
    },

    _resolveProviderForSession(sessionState = null, providerId = '') {
        const provider = resolveProviderById(
            this.providers,
            providerId || sessionState?.currentProviderId || this.currentProviderId || ''
        );
        if (provider) {
            return provider;
        }

        if (sessionState?.currentProvider && sessionState.currentProvider.id) {
            return { ...sessionState.currentProvider };
        }

        return this.currentProvider ? { ...this.currentProvider } : (this.providers[0] ? { ...this.providers[0] } : null);
    },

    async _ensureBrowser(sessionId = this.defaultSessionId, browserType = 'electron', options = {}) {
        const normalizedSessionId = this._normalizeSessionId(sessionId);
        const sessionState = this._getSessionState(normalizedSessionId, true);
        const browserManager = this._getBrowserManager();
        if (!browserManager || typeof browserManager.createBrowser !== 'function') {
            throw new Error('浏览器管理器不可用');
        }

        const currentPage = this._getActivePage(sessionState);
        if (currentPage && typeof currentPage.goto === 'function' && typeof currentPage.isClosed === 'function' && !currentPage.isClosed()) {
            return currentPage;
        }

        const background = options.background === true
            || options.hidden === true
            || options.headless === true;
        const createdBrowserId = await browserManager.createBrowser(browserType, background, {
            headless: background,
            viewport_width: 1366,
            viewport_height: 900,
            background
        });

        sessionState.browserId = createdBrowserId;
        if (normalizedSessionId === this.defaultSessionId) {
            this._syncLegacyStateFromSession(sessionState);
        }

        const page = typeof browserManager.getBrowser === 'function'
            ? browserManager.getBrowser(createdBrowserId)
            : null;
        if (!page) {
            throw new Error('无法创建临时邮箱浏览器');
        }

        return page;
    },

    async _readElementTextFromScope(scope, selector = '') {
        const target = String(selector || '').trim();
        if (!scope || !target || typeof scope.locator !== 'function') {
            return '';
        }

        try {
            const locator = scope.locator(target).first();
            if (await locator.count() === 0) {
                return '';
            }

            const value = await locator.evaluate((element) => {
                const tagName = String(element?.tagName || '').toLowerCase();
                if (tagName === 'iframe') {
                    try {
                        const frameDocument = element.contentDocument || element.contentWindow?.document || null;
                        const frameBody = frameDocument?.body || null;
                        const frameText = String(frameBody?.innerText || frameBody?.textContent || '').trim();
                        if (frameText) {
                            return frameText;
                        }
                    } catch (_frameError) {}
                }

                if (['input', 'textarea', 'select'].includes(tagName)) {
                    return element.value || element.getAttribute('value') || '';
                }
                return element.innerText || element.textContent || element.getAttribute?.('value') || '';
            });
            return String(value || '').trim();
        } catch (_error) {
            return '';
        }
    },

    async _collectScopeTexts(scope, collector = []) {
        if (!scope) {
            return collector;
        }

        try {
            const pageText = await this._readCandidateTextFromScope(scope);
            if (pageText) {
                collector.push(pageText);
            }
        } catch (_error) {}

        if (typeof scope.frames === 'function') {
            try {
                for (const frame of scope.frames()) {
                    await this._collectScopeTexts(frame, collector);
                }
            } catch (_error) {}
        }

        return collector;
    },

    async _readCandidateTextFromScope(scope) {
        if (!scope || typeof scope.evaluate !== 'function') {
            return '';
        }

        try {
            const pieces = await scope.evaluate(() => {
                const values = [];
                const bodyText = String(document.body?.innerText || document.body?.textContent || '').trim();
                if (bodyText) {
                    values.push(bodyText);
                }

                const selectors = [
                    'input',
                    'textarea',
                    'select',
                    '[contenteditable="true"]'
                ];
                document.querySelectorAll(selectors.join(',')).forEach((element) => {
                    const tagName = String(element?.tagName || '').toLowerCase();
                    if (['input', 'textarea', 'select'].includes(tagName)) {
                        const value = String(element.value || element.getAttribute('value') || '').trim();
                        if (value) {
                            values.push(value);
                        }
                    } else {
                        const text = String(element.innerText || element.textContent || '').trim();
                        if (text) {
                            values.push(text);
                        }
                    }
                });

                return values;
            });
            return Array.isArray(pieces) ? pieces.join('\n') : '';
        } catch (_error) {
            return '';
        }
    },

    async _readElementText(page, selector = '') {
        const target = String(selector || '').trim();
        if (!target || !page) {
            return '';
        }

        const scopes = [page];
        if (typeof page.frames === 'function') {
            try {
                scopes.push(...page.frames());
            } catch (_error) {}
        }

        for (const scope of scopes) {
            const text = await this._readElementTextFromScope(scope, target);
            if (text) {
                return text;
            }
        }

        return '';
    },

    async _clickCommonActionButtons(page, keywords = []) {
        const candidates = Array.isArray(keywords) ? keywords : [];
        for (const keyword of candidates) {
            const selectors = [
                `button:has-text("${keyword}")`,
                `a:has-text("${keyword}")`,
                `[role="button"]:has-text("${keyword}")`,
                `div:has-text("${keyword}")`
            ];

            for (const selector of selectors) {
                try {
                    const locator = page.locator(selector).first();
                    if (await locator.count() > 0) {
                        await locator.click({ timeout: 2500 });
                        return selector;
                    }
                } catch (_error) {
                }
            }
        }

        return '';
    },

    _parseInboxTimeText(timeText = '', referenceDate = new Date()) {
        const text = String(timeText || '').trim();
        if (!text) {
            return null;
        }

        const match = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (!match) {
            return null;
        }

        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        const seconds = Number(match[3] || 0);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
            return null;
        }

        const date = new Date(referenceDate);
        date.setHours(hours, minutes, seconds, 0);
        return Number.isNaN(date.getTime()) ? null : date;
    },

    async _closePopupSelectors(page, selectors = [], options = {}) {
        const normalizedSelectors = normalizeSelectorList(selectors);
        if (!page || normalizedSelectors.length === 0) {
            return { clickedCount: 0, attempts: 0 };
        }

        const timeoutMs = Number.isFinite(Number(options.timeoutMs))
            ? Math.max(0, Number(options.timeoutMs))
            : 3000;
        const pollIntervalMs = Number.isFinite(Number(options.pollIntervalMs))
            ? Math.max(50, Number(options.pollIntervalMs))
            : 250;
        const quietRoundsToFinish = Number.isFinite(Number(options.quietRoundsToFinish))
            ? Math.max(1, Number(options.quietRoundsToFinish))
            : 2;
        const deadline = Date.now() + timeoutMs;
        let attempts = 0;
        let clickedCount = 0;
        let quietRounds = 0;

        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

        while (Date.now() <= deadline) {
            attempts += 1;
            let clickedThisRound = false;

            for (const selector of normalizedSelectors) {
                try {
                    const locator = page.locator(selector).first();
                    if (await locator.count() === 0) {
                        continue;
                    }

                    await locator.click({ timeout: 2500, force: true }).catch(() => {});
                    clickedThisRound = true;
                    clickedCount += 1;
                    await sleep(120);
                } catch (_error) {
                }
            }

            if (clickedThisRound) {
                quietRounds = 0;
            } else if (clickedCount > 0) {
                quietRounds += 1;
                if (quietRounds >= quietRoundsToFinish) {
                    break;
                }
            }

            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
                break;
            }

            await sleep(Math.min(pollIntervalMs, remainingMs));
        }

        return { clickedCount, attempts };
    },

    async _readPageCandidateText(page) {
        const pieces = [];
        await this._collectScopeTexts(page, pieces);
        return pieces.join('\n');
    },

    _normalizeEmailText(text = '') {
        return String(text || '')
            .replace(/[\s\u00a0\u200b-\u200d\ufeff]+/g, '')
            .trim();
    },

    _matchEmail(text = '') {
        const rawText = String(text || '');
        const normalizedText = this._normalizeEmailText(rawText);
        const candidates = [rawText, normalizedText].filter(Boolean);
        const emailRegex = /[A-Z0-9._%+-]+@(?:[A-Z0-9-]+\.)+[A-Z]{2,}/i;

        for (const candidate of candidates) {
            const match = String(candidate).match(emailRegex);
            if (match) {
                return match[0];
            }
        }

        return '';
    },

    _matchCode(text = '') {
        return extractVerificationCode(text);
    },

    async openProvider(payload = {}) {
        const sessionId = this._normalizeSessionId(payload.sessionId || payload.taskId || payload.browserSessionId || this.defaultSessionId);
        const sessionState = this._getSessionState(sessionId, true);
        const provider = this._resolveProviderForSession(sessionState, payload.providerId)
            || this.providers[0]
            || null;
        if (!provider) {
            throw new Error('请先选择一个临时邮箱卡片');
        }

        if (!provider.url) {
            throw new Error('临时邮箱卡片网址不能为空');
        }

        const browserType = String(
            payload.browserType
            || payload.browser_type
            || this.app?.currentBrowserType
            || this.app?.browserSettings?.browserType
            || this.app?.browserSettings?.browser_type
            || 'electron'
        ).trim().toLowerCase() || 'electron';
        const pageLoadTimeoutMs = Number.isFinite(Number(payload.pageLoadTimeoutMs))
            ? Math.max(1000, Number(payload.pageLoadTimeoutMs))
            : Number.isFinite(Number(payload.gotoTimeoutMs))
                ? Math.max(1000, Number(payload.gotoTimeoutMs))
                : Number.isFinite(Number(payload.timeout))
                    ? Math.max(30000, Number(payload.timeout) < 1000 ? Number(payload.timeout) * 1000 : Number(payload.timeout))
                    : 30000;
        const page = await this._ensureBrowser(sessionId, browserType, {
            background: payload.background === true || payload.hidden === true || payload.headless === true
        });
        try {
            await page.goto(provider.url, {
                waitUntil: 'domcontentloaded',
                timeout: pageLoadTimeoutMs
            });
        } catch (error) {
            this.log('warning', `临时邮箱页面加载失败: ${error.message}`);
        }

        try {
            await this._closePopupSelectors(page, provider.closePopupSelectors, {
                timeoutMs: payload.closePopupTimeoutMs,
                pollIntervalMs: payload.closePopupPollIntervalMs,
                quietRoundsToFinish: payload.closePopupQuietRounds
            });
        } catch (error) {
            this.log('warning', `关闭临时邮箱弹窗失败: ${error.message}`);
        }

        try {
            if (payload.background !== true && payload.hidden !== true && payload.headless !== true && typeof page.bringToFront === 'function') {
                await page.bringToFront();
            }
        } catch (_error) {}

        sessionState.currentProvider = { ...provider };
        sessionState.currentProviderId = provider.id;
        sessionState.currentUrl = provider.url;
        sessionState.currentEmail = '';
        sessionState.currentCode = '';
        sessionState.currentSelection = '';
        if (sessionId === this.defaultSessionId) {
            this.currentProvider = provider;
            this._syncLegacyStateFromSession(sessionState);
        }
        this.log('info', `已打开临时邮箱卡片: ${provider.name} -> ${provider.url}`);
        this._emitState({ reason: 'opened', sessionId });

        return {
            success: true,
            browserId: sessionState.browserId,
            provider: { ...provider },
            url: provider.url,
            state: sessionId === this.defaultSessionId ? this.getState() : {
                ...sessionState,
                provider: sessionState.currentProvider ? { ...sessionState.currentProvider } : null,
                selectedProviderId: sessionState.currentProviderId,
                selectedProviderName: sessionState.currentProvider?.name || sessionState.currentProviderId || ''
            }
        };
    },

    async getEmail(payload = {}) {
        const sessionId = this._normalizeSessionId(payload.sessionId || payload.taskId || payload.browserSessionId || this.defaultSessionId);
        const sessionState = this._getSessionState(sessionId, true);
        const provider = this._resolveProviderForSession(sessionState, payload.providerId) || null;
        if (!provider) {
            return { success: false, error: '请先选择一个临时邮箱卡片' };
        }

        if (!sessionState.browserId) {
            await this.openProvider({
                ...payload,
                sessionId,
                providerId: provider.id,
                pageLoadTimeoutMs: payload.pageLoadTimeoutMs,
                gotoTimeoutMs: payload.gotoTimeoutMs
            });
        }

        const page = this._getActivePage(sessionState);
        if (!page) {
            return { success: false, error: '临时邮箱浏览器页面不可用' };
        }

        if (!provider.emailElement) {
            return { success: false, error: '当前临时邮箱卡片未配置获取邮箱元素' };
        }

        const pageText = await this._readElementText(page, provider.emailElement);
        const email = this._matchEmail(pageText);

        if (!email) {
            return { success: false, error: '未找到邮箱地址' };
        }

        sessionState.currentEmail = email;
        if (sessionId === this.defaultSessionId) {
            this._syncLegacyStateFromSession(sessionState);
        }
        this._emitState({ reason: 'email-read', sessionId });
        this.log('info', `已获取临时邮箱地址: ${email}`);

        return {
            success: true,
            email,
            provider: { ...provider },
            browserId: sessionState.browserId,
            url: sessionState.currentUrl,
            state: sessionId === this.defaultSessionId ? this.getState() : {
                ...sessionState,
                provider: sessionState.currentProvider ? { ...sessionState.currentProvider } : null,
                selectedProviderId: sessionState.currentProviderId,
                selectedProviderName: sessionState.currentProvider?.name || sessionState.currentProviderId || ''
            }
        };
    },

    async refreshEmail(payload = {}) {
        const sessionId = this._normalizeSessionId(payload.sessionId || payload.taskId || payload.browserSessionId || this.defaultSessionId);
        const sessionState = this._getSessionState(sessionId, true);
        const provider = this._resolveProviderForSession(sessionState, payload.providerId) || null;
        if (!provider) {
            return { success: false, error: '请先选择一个临时邮箱卡片' };
        }

        if (!sessionState.browserId) {
            await this.openProvider({
                ...payload,
                sessionId,
                providerId: provider.id,
                pageLoadTimeoutMs: payload.pageLoadTimeoutMs,
                gotoTimeoutMs: payload.gotoTimeoutMs
            });
        }

        const page = this._getActivePage(sessionState);
        if (!page) {
            return { success: false, error: '临时邮箱浏览器页面不可用' };
        }

        try {
            if (provider.refreshButton) {
                const locator = page.locator(provider.refreshButton).first();
                if (await locator.count() > 0) {
                    await locator.click({ timeout: 3000 });
                }
            } else {
                await this._clickCommonActionButtons(page, ['刷新', 'Refresh', 'Inbox', '收件箱', '更新', 'Load']);
            }
        } catch (_error) {
        }

        this._emitState({ reason: 'refreshed', sessionId });
        this.log('info', '已刷新临时邮箱');

        return {
            success: true,
            provider: { ...provider },
            browserId: sessionState.browserId,
            url: sessionState.currentUrl,
            state: sessionId === this.defaultSessionId ? this.getState() : {
                ...sessionState,
                provider: sessionState.currentProvider ? { ...sessionState.currentProvider } : null,
                selectedProviderId: sessionState.currentProviderId,
                selectedProviderName: sessionState.currentProvider?.name || sessionState.currentProviderId || ''
            }
        };
    },

    async getCode(payload = {}) {
        const sessionId = this._normalizeSessionId(payload.sessionId || payload.taskId || payload.browserSessionId || this.defaultSessionId);
        const sessionState = this._getSessionState(sessionId, true);
        const provider = this._resolveProviderForSession(sessionState, payload.providerId) || null;
        if (!provider) {
            return { success: false, error: '请先选择一个临时邮箱卡片' };
        }

        if (!sessionState.browserId) {
            await this.openProvider({
                ...payload,
                sessionId,
                providerId: provider.id,
                pageLoadTimeoutMs: payload.pageLoadTimeoutMs,
                gotoTimeoutMs: payload.gotoTimeoutMs
            });
        }

        const page = this._getActivePage(sessionState);
        if (!page) {
            return { success: false, error: '临时邮箱浏览器页面不可用' };
        }

        const codeClickSelector = String(provider.codeClickElement || '').trim();
        if (codeClickSelector) {
            try {
                const clickLocator = page.locator(codeClickSelector);
                if (await clickLocator.count() > 0) {
                    await clickLocator.first().click({ timeout: 3000, force: true });
                    await page.waitForTimeout(600).catch(() => {});
                } else {
                    return { success: false, error: '未找到验证码邮件' };
                }
            } catch (_error) {
            }
        }

        if (!provider.codeElement) {
            return { success: false, error: '当前临时邮箱卡片未配置获取验证码元素' };
        }

        let pageText = await this._readElementText(page, provider.codeElement);
        const code = this._matchCode(pageText);

        if (!code) {
            return { success: false, error: '未找到验证码' };
        }

        sessionState.currentCode = code;
        if (sessionId === this.defaultSessionId) {
            this._syncLegacyStateFromSession(sessionState);
        }
        this._emitState({ reason: 'code-read', sessionId });
        this.log('info', `已获取临时邮箱验证码: ${code}`);

        return {
            success: true,
            code,
            provider: { ...provider },
            browserId: sessionState.browserId,
            url: sessionState.currentUrl,
            state: sessionId === this.defaultSessionId ? this.getState() : {
                ...sessionState,
                provider: sessionState.currentProvider ? { ...sessionState.currentProvider } : null,
                selectedProviderId: sessionState.currentProviderId,
                selectedProviderName: sessionState.currentProvider?.name || sessionState.currentProviderId || ''
            }
        };
    },

    async waitForEmail(payload = {}) {
        const timeoutSeconds = Number.isFinite(Number(payload.timeout)) ? Math.max(1, Number(payload.timeout)) : 60;
        const pollIntervalMs = Number.isFinite(Number(payload.pollIntervalMs))
            ? Math.max(250, Number(payload.pollIntervalMs))
            : 1000;
        const maxAttempts = Number.isFinite(Number(payload.maxAttempts))
            ? Math.max(1, Math.min(20, Number(payload.maxAttempts)))
            : 20;
        const deadline = Date.now() + timeoutSeconds * 1000;
        let lastError = '';
        let attemptCount = 0;

        while (Date.now() <= deadline) {
            if (attemptCount >= maxAttempts) {
                break;
            }

            attemptCount += 1;
            const result = await this.getEmail(payload);
            if (result && result.success && result.email) {
                return result;
            }

            lastError = result?.error || lastError;
            this.log('info', `临时邮箱地址第 ${attemptCount} 次尝试未成功${lastError ? `: ${lastError}` : ''}，继续重试`);
            if (Date.now() >= deadline) {
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        return {
            success: false,
            error: lastError || (attemptCount >= maxAttempts ? `已达到最大尝试次数 ${maxAttempts}` : '未找到邮箱地址')
        };
    },

    async waitForCode(payload = {}) {
        const timeoutSeconds = Number.isFinite(Number(payload.timeout)) ? Math.max(1, Number(payload.timeout)) : 120;
        const pollIntervalMs = Number.isFinite(Number(payload.pollIntervalMs))
            ? Math.max(250, Number(payload.pollIntervalMs))
            : 1500;
        const maxAttempts = Number.isFinite(Number(payload.maxAttempts))
            ? Math.max(1, Math.min(20, Number(payload.maxAttempts)))
            : 20;
        const deadline = Date.now() + timeoutSeconds * 1000;
        let lastError = '';
        let attemptCount = 0;

        while (Date.now() <= deadline) {
            if (attemptCount >= maxAttempts) {
                break;
            }

            attemptCount += 1;
            const result = await this.getCode(payload);
            if (result && result.success && result.code) {
                return result;
            }

            lastError = result?.error || lastError;
            this.log('info', `临时邮箱验证码第 ${attemptCount} 次尝试未成功${lastError ? `: ${lastError}` : ''}，继续重试`);
            if (Date.now() >= deadline) {
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        return {
            success: false,
            error: lastError || (attemptCount >= maxAttempts ? `已达到最大尝试次数 ${maxAttempts}` : '未找到验证码')
        };
    },

    async closeSession(sessionId = this.defaultSessionId) {
        const normalizedSessionId = this._normalizeSessionId(sessionId);
        const sessionState = this._getSessionState(normalizedSessionId, false);
        if (!sessionState) {
            return { success: true, closed: false };
        }

        const browserId = sessionState.browserId || '';
        if (browserId) {
            const browserManager = this._getBrowserManager();
            if (browserManager && typeof browserManager.closeBrowser === 'function') {
                try {
                    await browserManager.closeBrowser(browserId);
                } catch (error) {
                    this.log('warning', `关闭临时邮箱浏览器失败: ${error.message}`);
                    return { success: false, error: error.message };
                }
            }
        }

        if (normalizedSessionId === this.defaultSessionId) {
            this.browserId = '';
            this.currentUrl = '';
            this.currentEmail = '';
            this.currentCode = '';
            this.currentSelection = '';
        } else {
            this.browserSessions.delete(normalizedSessionId);
        }

        return { success: true, closed: true };
    }
};
