const {
    IPC_CHANNELS,
    DEFAULT_GPTMAIL_API_CONFIG,
    mergeApiConfig,
    setResultCard,
    setStatusCard
} = require('./renderer-temp-email-shared');

module.exports = function createRendererTempEmailApi(deps = {}) {
    const {
        elements,
        state,
        ipcRenderer,
        logger,
        appendTempEmailLog,
        applyState
    } = deps;

    function stripHtmlTags(html = '') {
        return String(html || '')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeVerificationCandidate(value = '') {
        const candidate = String(value || '').trim();
        if (!candidate) {
            return '';
        }

        const normalizedLower = candidate.toLowerCase();
        const stopWords = new Set([
            'your',
            'the',
            'and',
            'for',
            'from',
            'this',
            'that',
            'with',
            'code',
            'otp',
            'sms',
            'verification',
            'verify',
            'is',
            'are',
            'was',
            'were',
            'be',
            'to',
            'of'
        ]);
        if (stopWords.has(normalizedLower)) {
            return '';
        }

        const compact = candidate.replace(/\s+/g, '').toUpperCase();
        if (/^\d{4,8}$/.test(compact)) {
            return compact;
        }

        if (/^[A-Z0-9]{4,12}$/.test(compact) && (/[A-Z]/.test(compact) || /\d/.test(compact))) {
            return compact;
        }

        return '';
    }

    function isLikelyVerificationCode(value = '') {
        return Boolean(normalizeVerificationCandidate(value));
    }

    function extractVerificationCode(text = '') {
        const normalizedText = String(text || '')
            .replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!normalizedText) {
            return '';
        }

        const isValidCandidate = (value) => {
            const candidate = String(value || '').trim();
            if (!candidate) {
                return '';
            }

            if (/^(your|the|and|for|from|this|that|with|code|otp|sms|verification|verify|is|are|was|were|be|to|of|continue|submit|next|send|click|open|confirm|ok|done|help)$/i.test(candidate)) {
                return '';
            }

            const compact = candidate.replace(/\s+/g, '').toUpperCase();
            if (/^\d{4,8}$/.test(compact)) {
                return compact;
            }

            if (/^[A-Z0-9]{4,12}$/.test(compact) && /\d/.test(compact)) {
                return compact;
            }

            if (/^[A-Z]{4,6}$/.test(compact)) {
                return compact;
            }

            return '';
        };

        const keywordPattern = /(?:验证码|verification[_\s-]*code|sms[_\s-]*code|code|otp)/i;
        const keywordMatch = normalizedText.match(keywordPattern);
        if (keywordMatch && typeof keywordMatch.index === 'number') {
            const tail = normalizedText.slice(keywordMatch.index + keywordMatch[0].length);
            const tokens = tail.match(/\b[A-Za-z0-9]{4,12}\b/g) || [];
            for (const token of tokens) {
                const candidate = isValidCandidate(token);
                if (candidate) {
                    return candidate;
                }
            }
        }

        const digitMatch = normalizedText.match(/\b(\d{4,8})\b/);
        if (digitMatch && digitMatch[1]) {
            return digitMatch[1];
        }

        return '';
    }

    function extractVerificationCodeFromDetail(detail = {}) {
        const candidates = [];
        if (!detail || typeof detail !== 'object') {
            return '';
        }

        if (detail.content) {
            candidates.push(String(detail.content));
        }
        if (detail.html_content) {
            candidates.push(stripHtmlTags(detail.html_content));
        }
        if (detail.subject) {
            candidates.push(String(detail.subject));
        }

        const directFields = [
            detail.code,
            detail.verification_code,
            detail.verificationCode,
            detail.otp,
            detail.otp_code,
            detail.otpCode
        ];

        for (const value of directFields) {
            const code = String(value || '').trim();
            if (code) {
                return code;
            }
        }

        for (const candidate of candidates) {
            const code = extractVerificationCode(candidate);
            if (code && isLikelyVerificationCode(code)) {
                return code;
            }
        }

        return '';
    }

    function getActiveEmailAddress() {
        return String(state.currentEmail || state.selectedEmailAddress || '').trim();
    }

    function getSelectedEmailId() {
        return String(state.selectedEmailId || state.currentSelection || '').trim();
    }

    function normalizeHttpBaseUrl(value = '') {
        return String(value || '').trim().replace(/\/+$/, '');
    }

    function getTempEmailHttpBaseUrl() {
        return normalizeHttpBaseUrl(state.httpBaseUrl || '');
    }

    function syncTempEmailHttpUi() {
        const baseUrl = getTempEmailHttpBaseUrl();
        if (elements.tempEmailHttpBaseUrl) {
            elements.tempEmailHttpBaseUrl.textContent = baseUrl || '未获取';
        }
        if (elements.tempEmailHttpOpenBtn) {
            elements.tempEmailHttpOpenBtn.disabled = !baseUrl || !state.selectedProviderId;
        }
        if (elements.tempEmailHttpCloseBtn) {
            elements.tempEmailHttpCloseBtn.disabled = !baseUrl;
        }
        if (elements.tempEmailHttpGetEmailBtn) {
            elements.tempEmailHttpGetEmailBtn.disabled = !baseUrl || !state.selectedProviderId;
        }
        if (elements.tempEmailHttpGetCodeBtn) {
            elements.tempEmailHttpGetCodeBtn.disabled = !baseUrl || !state.selectedProviderId;
        }
    }

    async function resolveTempEmailHttpBaseUrl(forceRefresh = false) {
        if (!forceRefresh) {
            const cachedBaseUrl = getTempEmailHttpBaseUrl();
            if (cachedBaseUrl) {
                syncTempEmailHttpUi();
                return cachedBaseUrl;
            }
        }

        let resolvedBaseUrl = '';
        try {
            const result = await ipcRenderer.invoke('get-app-runtime-info');
            resolvedBaseUrl = normalizeHttpBaseUrl(result?.webControlUrl || '');
        } catch (_error) {
        }

        if (!resolvedBaseUrl && typeof window !== 'undefined') {
            resolvedBaseUrl = normalizeHttpBaseUrl(window.__WEB_CONTROL_RUNTIME__?.webUiUrl || '');
        }

        state.httpBaseUrl = resolvedBaseUrl;
        syncTempEmailHttpUi();
        return resolvedBaseUrl;
    }

    function buildTempEmailHttpUrl(endpointPath = '') {
        const baseUrl = getTempEmailHttpBaseUrl();
        const path = String(endpointPath || '').trim().replace(/^\/+/, '');
        if (!baseUrl) {
            throw new Error('未获取到网页控制台地址');
        }

        return path ? `${baseUrl}/${path}` : baseUrl;
    }

    function logApi(level, message, data = null) {
        const normalizedLevel = ['debug', 'info', 'warning', 'error'].includes(level) ? level : 'info';
        if (logger && typeof logger[normalizedLevel] === 'function') {
            logger[normalizedLevel](message, data);
        } else if (logger && normalizedLevel === 'warning' && typeof logger.warn === 'function') {
            logger.warn(message, data);
        }
    }

    function getApiRequestConfig() {
        return mergeApiConfig(state.apiConfig || DEFAULT_GPTMAIL_API_CONFIG);
    }

    function getApiConfig() {
        return getApiRequestConfig();
    }

    function buildApiUrl(endpoint, query = '') {
        const apiConfig = getApiRequestConfig();
        const baseUrl = String(elements.emailApiBaseUrl?.value || apiConfig.baseUrl || '').trim().replace(/\/+$/, '');
        const resolvedEndpoint = String(endpoint || '').trim();
        if (!resolvedEndpoint) {
            return baseUrl;
        }

        const [rawPath, rawSearch = ''] = resolvedEndpoint.split('?');
        const url = new URL(`${baseUrl}/${String(rawPath || '').trim().replace(/^\/+/, '')}`);
        const searchParams = new URLSearchParams(rawSearch);
        const extraQuery = String(query || '').trim().replace(/^[?&]+/, '');
        if (extraQuery) {
            const extraParams = new URLSearchParams(extraQuery);
            for (const [key, value] of extraParams.entries()) {
                searchParams.set(key, value);
            }
        }

        const apiKey = String(elements.emailApiKey?.value || apiConfig.apiKey || '').trim();
        const authQueryName = String(apiConfig.authQueryName || '').trim();
        if (apiKey && authQueryName && !searchParams.has(authQueryName)) {
            searchParams.set(authQueryName, apiKey);
        }

        url.search = searchParams.toString();
        return url.toString();
    }

    function getApiHeaders() {
        const apiConfig = getApiRequestConfig();
        const headers = {
            Accept: 'application/json'
        };
        const apiKey = String(elements.emailApiKey?.value || apiConfig.apiKey || '').trim();
        if (apiKey && apiConfig.authHeaderName) {
            headers[apiConfig.authHeaderName || 'X-API-Key'] = apiKey;
        }
        return headers;
    }

    async function requestApi(method, url, body = null) {
        logApi('info', `请求 ${method} ${url}`, {
            method,
            url,
            hasBody: body !== null && body !== undefined
        });
        const options = {
            method,
            headers: getApiHeaders()
        };
        if (body !== null && body !== undefined) {
            options.body = typeof body === 'string' ? body : JSON.stringify(body);
            options.headers = {
                ...options.headers,
                'Content-Type': 'application/json'
            };
        }

        const response = await fetch(url, options);
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (_error) {
            data = text;
        }

        if (!response.ok) {
            const errorMessage = typeof data === 'object' && data && data.error
                ? data.error
                : `${response.status} ${response.statusText}`;
            logApi('error', `请求失败 ${method} ${url}: ${errorMessage}`, {
                method,
                url,
                status: response.status,
                statusText: response.statusText,
                response: data
            });
            throw new Error(errorMessage);
        }

        logApi('info', `请求成功 ${method} ${url}`, {
            method,
            url,
            status: response.status,
            response: data
        });
        return data;
    }

    async function runApiRequest(label, executor, handlers = {}) {
        try {
            logApi('info', `开始执行 API 请求: ${label}`);
            const result = await executor();
            logApi('info', `${label} 成功`, result);
            if (typeof handlers.onSuccess === 'function') {
                handlers.onSuccess(result);
            }
            return { success: true, data: result };
        } catch (error) {
            logApi('error', `${label} 失败: ${error.message}`, { error: error.message });
            if (typeof handlers.onError === 'function') {
                handlers.onError(error);
            }
            return { success: false, error: error.message };
        }
    }

    function syncApiActionButtons() {
        const hasEmailAddress = Boolean(getActiveEmailAddress());
        const hasSelectedEmail = Boolean(getSelectedEmailId());

        if (elements.emailApiCopyBtn) {
            elements.emailApiCopyBtn.disabled = !hasEmailAddress;
        }
        if (elements.emailApiListBtn) {
            elements.emailApiListBtn.disabled = !hasEmailAddress;
        }
        if (elements.emailApiDetailBtn) {
            elements.emailApiDetailBtn.disabled = !hasSelectedEmail;
        }
        if (elements.emailApiRawDetailResult) {
            elements.emailApiRawDetailResult.classList.toggle('is-disabled', !hasSelectedEmail);
        }
        if (elements.emailApiDeleteBtn) {
            elements.emailApiDeleteBtn.disabled = !hasSelectedEmail;
        }
        if (elements.emailApiClearBtn) {
            elements.emailApiClearBtn.disabled = !hasEmailAddress;
        }
    }

    function clearInboxSelection() {
        state.selectedEmailId = '';
        state.selectedEmailAddress = '';
        state.currentSelection = '';

        const target = elements.emailApiInboxResult;
        if (target) {
            target.querySelectorAll('.email-api-inbox-item').forEach((item) => {
                item.classList.remove('is-selected');
            });
        }

        syncApiActionButtons();
    }

    async function copyGeneratedEmail() {
        const email = getActiveEmailAddress();
        if (!email) {
            return { success: false, error: '暂无可复制的邮箱地址' };
        }

        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(email);
            } else {
                const input = document.createElement('textarea');
                input.value = email;
                input.setAttribute('readonly', 'readonly');
                input.style.position = 'fixed';
                input.style.left = '-9999px';
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                document.body.removeChild(input);
            }

            appendTempEmailLog(`已复制邮箱: ${email}`, '#198754');
            return { success: true, email };
        } catch (error) {
            logger.error(`复制邮箱失败: ${error.message}`);
            appendTempEmailLog(`复制邮箱失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    function renderInboxResult(emails = []) {
        const target = elements.emailApiInboxResult;
        if (!target) {
            return;
        }

        target.innerHTML = '';
        target.className = 'email-api-result-block email-api-result-block--success';

        if (!Array.isArray(emails) || emails.length === 0) {
            clearInboxSelection();
            const empty = document.createElement('div');
            empty.className = 'email-api-empty';
            empty.textContent = '暂无收件箱结果';
            target.appendChild(empty);
            return;
        }

        const list = document.createElement('div');
        list.className = 'email-api-inbox-list';

        const selectedId = String(state.selectedEmailId || '').trim();
        const currentEmail = getActiveEmailAddress();
        let firstSelectable = null;

        for (const email of emails) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'email-api-inbox-item';
            const emailId = String(email?.id || '').trim();
            const emailAddress = String(email?.email_address || email?.email || '').trim();
            if (!firstSelectable && emailId) {
                firstSelectable = { emailId, emailAddress, item };
            }
            if (selectedId && emailId && selectedId === emailId) {
                item.classList.add('is-selected');
            }

            const title = document.createElement('div');
            title.className = 'email-api-inbox-item__title';
            title.textContent = String(email?.subject || email?.email_subject || '(无主题)');

            const meta = document.createElement('div');
            meta.className = 'email-api-inbox-item__meta';
            const fromAddress = String(email?.from_address || email?.from || '-');
            const timeText = email?.timestamp
                ? new Date(Number(email.timestamp) * 1000).toLocaleString()
                : String(email?.created_at || email?.date || '-');
            meta.textContent = `${fromAddress} · ${timeText}`;

            const address = document.createElement('div');
            address.className = 'email-api-inbox-item__email';
            address.textContent = String(email?.email_address || email?.email || '');

            item.appendChild(title);
            item.appendChild(meta);
            item.appendChild(address);
            item.addEventListener('click', () => {
                clearInboxSelection();
                if (emailId) {
                    state.selectedEmailId = emailId;
                    state.selectedEmailAddress = emailAddress || currentEmail;
                    state.currentSelection = emailId;
                    if (emailAddress) {
                        state.currentEmail = emailAddress;
                    }
                    item.classList.add('is-selected');
                }
                syncApiActionButtons();
                setStatusCard(
                    elements.emailApiDetailResult,
                    `已选择邮件 ID: ${emailId || '-'}`,
                    'success'
                );
            });

            list.appendChild(item);
        }

        target.appendChild(list);

        if (!selectedId && firstSelectable) {
            state.selectedEmailId = firstSelectable.emailId;
            state.selectedEmailAddress = firstSelectable.emailAddress || currentEmail;
            state.currentSelection = firstSelectable.emailId;
            if (firstSelectable.emailAddress) {
                state.currentEmail = firstSelectable.emailAddress;
            }
            firstSelectable.item.classList.add('is-selected');
            setStatusCard(
                elements.emailApiDetailResult,
                `已自动选择第一封邮件 ID: ${firstSelectable.emailId}`,
                'success'
            );
        }

        syncApiActionButtons();
    }

    function syncModeUi() {
        const isOutlook = state.selectedMode === 'outlook';
        const isTemp = state.selectedMode === 'temp';
        const isApi = state.selectedMode === 'api';

        if (elements.emailModeConnectBtn) {
            elements.emailModeConnectBtn.classList.toggle('active', !isOutlook && !isTemp && !isApi);
            elements.emailModeConnectBtn.setAttribute('aria-pressed', String(!isOutlook && !isTemp && !isApi));
        }
        if (elements.emailModeOutlookBtn) {
            elements.emailModeOutlookBtn.classList.toggle('active', isOutlook);
            elements.emailModeOutlookBtn.setAttribute('aria-pressed', String(isOutlook));
        }
        if (elements.emailModeTempBtn) {
            elements.emailModeTempBtn.classList.toggle('active', isTemp);
            elements.emailModeTempBtn.setAttribute('aria-pressed', String(isTemp));
        }
        if (elements.emailModeApiBtn) {
            elements.emailModeApiBtn.classList.toggle('active', isApi);
            elements.emailModeApiBtn.setAttribute('aria-pressed', String(isApi));
        }
        if (elements.emailModeConnectPanel) {
            elements.emailModeConnectPanel.classList.toggle('active', !isOutlook && !isTemp && !isApi);
        }
        if (elements.emailModeOutlookPanel) {
            elements.emailModeOutlookPanel.classList.toggle('active', isOutlook);
        }
        if (elements.emailModeTempPanel) {
            elements.emailModeTempPanel.classList.toggle('active', isTemp);
        }
        if (elements.emailModeApiPanel) {
            elements.emailModeApiPanel.classList.toggle('active', isApi);
        }
    }

    function updateInfoUi() {
        if (elements.tempEmailAddBtn) {
            elements.tempEmailAddBtn.disabled = false;
        }
        if (elements.tempEmailImportBtn) {
            elements.tempEmailImportBtn.disabled = false;
        }
        if (elements.tempEmailEditBtn) {
            elements.tempEmailEditBtn.disabled = !state.selectedProviderId;
        }
        if (elements.tempEmailDeleteBtn) {
            elements.tempEmailDeleteBtn.disabled = !state.selectedProviderId;
        }
        if (elements.tempEmailOpenBtn) {
            elements.tempEmailOpenBtn.disabled = !state.selectedProviderId;
        }
        if (elements.tempEmailRefreshEmailBtn) {
            elements.tempEmailRefreshEmailBtn.disabled = !state.browserOpen;
        }
        if (elements.tempEmailProviderDebugBtn) {
            elements.tempEmailProviderDebugBtn.disabled = !state.selectedProviderId;
        }
        if (elements.tempEmailGetEmailBtn) {
            elements.tempEmailGetEmailBtn.disabled = !state.selectedProviderId;
        }
        if (elements.tempEmailGetCodeBtn) {
            elements.tempEmailGetCodeBtn.disabled = !state.selectedProviderId;
        }
        syncTempEmailHttpUi();
    }

    function syncApiUi(apiConfig = {}) {
        const config = mergeApiConfig(apiConfig);
        state.apiConfig = config;

        if (elements.emailApiBaseUrl) {
            elements.emailApiBaseUrl.value = String(config.baseUrl || DEFAULT_GPTMAIL_API_CONFIG.baseUrl);
        }
        if (elements.emailApiKey) {
            elements.emailApiKey.value = String(config.apiKey || DEFAULT_GPTMAIL_API_CONFIG.apiKey);
        }
        state.selectedEmailAddress = getActiveEmailAddress();
        const emailAddress = getActiveEmailAddress();
        if (emailAddress) {
            setResultCard(elements.emailApiGeneratedEmail, emailAddress, 'success');
        } else {
            setResultCard(elements.emailApiGeneratedEmail, '尚未生成邮箱', 'idle');
        }
        setResultCard(elements.emailApiInboxResult, '暂无收件箱结果', 'idle');
        setResultCard(elements.emailApiDetailResult, '暂无邮件详情', 'idle');
        setResultCard(elements.emailApiRawDetailResult, '暂无原始详情', 'idle');
        setStatusCard(elements.emailApiDeleteResult, '等待操作', 'idle');
        setStatusCard(elements.emailApiClearResult, '等待操作', 'idle');
        syncApiActionButtons();
    }

    async function setApiConfig(apiConfig = {}) {
        const normalizedApiConfig = mergeApiConfig({
            ...(state.apiConfig || DEFAULT_GPTMAIL_API_CONFIG),
            ...(apiConfig && typeof apiConfig === 'object' ? apiConfig : {})
        });

        state.apiConfig = normalizedApiConfig;
        syncApiUi(normalizedApiConfig);

        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailSaveApiConfig, normalizedApiConfig);
            if (!result || result.success !== true) {
                throw new Error(result?.error || '保存临时邮箱 API 配置失败');
            }

            if (result.apiConfig && typeof result.apiConfig === 'object') {
                state.apiConfig = mergeApiConfig(result.apiConfig);
            } else if (result.state && typeof result.state === 'object' && result.state.apiConfig) {
                state.apiConfig = mergeApiConfig(result.state.apiConfig);
            }

            syncApiUi(state.apiConfig);
            appendTempEmailLog('临时邮箱 API 配置已保存', '#198754');
            return result;
        } catch (error) {
            logger.error(`保存临时邮箱 API 配置失败: ${error.message}`);
            appendTempEmailLog(`保存临时邮箱 API 配置失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function requestTempEmailHttpApi(actionName, endpointPath, payload = {}, options = {}) {
        const button = options.button || null;
        const resultTarget = options.resultTarget || elements.tempEmailHttpResult || null;
        const statusTarget = options.statusTarget || elements.tempEmailHttpStatus || null;
        const previousButtonText = button ? button.textContent : '';

        if (button) {
            button.disabled = true;
        }
        if (statusTarget) {
            statusTarget.textContent = `${actionName}中...`;
            statusTarget.className = 'email-api-status email-api-status--loading';
        }
        if (resultTarget) {
            setResultCard(resultTarget, `${actionName}请求中...`, 'loading');
        }

        try {
            const resolvedBaseUrl = await resolveTempEmailHttpBaseUrl(true);
            if (!resolvedBaseUrl) {
                throw new Error('未获取到网页控制台地址');
            }

            const url = buildTempEmailHttpUrl(endpointPath);
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload && typeof payload === 'object' ? payload : {})
            });

            const rawText = await response.text();
            let data = null;
            try {
                data = rawText ? JSON.parse(rawText) : null;
            } catch (_error) {
                data = rawText;
            }

            if (!response.ok) {
                throw new Error((data && typeof data === 'object' && data.error) || `${response.status} ${response.statusText}`);
            }

            if (data && typeof data === 'object' && data.state && typeof applyState === 'function') {
                applyState(data.state);
            }

            if (statusTarget) {
                const successLabel = data && typeof data === 'object' && data.success === false
                    ? `${actionName}失败`
                    : `${actionName}成功`;
                statusTarget.textContent = successLabel;
                statusTarget.className = 'email-api-status email-api-status--success';
            }
            if (resultTarget) {
                setResultCard(resultTarget, data ?? { success: true }, 'success');
            }

            appendTempEmailLog(`${actionName}成功: ${JSON.stringify(data)}`, '#198754');
            return data;
        } catch (error) {
            if (statusTarget) {
                statusTarget.textContent = `${actionName}失败: ${error.message}`;
                statusTarget.className = 'email-api-status email-api-status--error';
            }
            if (resultTarget) {
                setResultCard(resultTarget, `调用失败: ${error.message}`, 'error');
            }
            logger.error(`${actionName}失败: ${error.message}`);
            appendTempEmailLog(`${actionName}失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = previousButtonText;
            }
            syncTempEmailHttpUi();
        }
    }

    async function generateEmail() {
        const endpoint = getApiRequestConfig().endpoints.generateEmail;
        setStatusCard(elements.emailApiGeneratedEmail, '正在生成邮箱...', 'loading');
        return runApiRequest('生成邮箱', async () => {
            const url = buildApiUrl(endpoint);
            const response = await requestApi('GET', url);
            const generatedEmail = String(response?.data?.email || '').trim();
            if (generatedEmail) {
                clearInboxSelection();
                state.currentEmail = generatedEmail;
                state.selectedEmailAddress = generatedEmail;
                state.currentSelection = '';
                setResultCard(elements.emailApiInboxResult, '暂无收件箱结果', 'idle');
                setResultCard(elements.emailApiDetailResult, '暂无邮件详情', 'idle');
                setStatusCard(elements.emailApiDeleteResult, '等待操作', 'idle');
                setStatusCard(elements.emailApiClearResult, '等待操作', 'idle');
            }
            return response;
        }, {
            onSuccess: (response) => {
                const generatedEmail = String(response?.data?.email || '').trim();
                setResultCard(
                    elements.emailApiGeneratedEmail,
                    generatedEmail || '生成成功，但未返回邮箱地址',
                    'success'
                );
                syncApiActionButtons();
            },
            onError: (error) => {
                setStatusCard(elements.emailApiGeneratedEmail, `生成失败: ${error.message}`, 'error');
            }
        });
    }

    async function listEmails() {
        const email = getActiveEmailAddress();
        const endpoint = getApiRequestConfig().endpoints.emails;
        setResultCard(elements.emailApiInboxResult, '正在查询收件箱...', 'loading');
        return runApiRequest('查询收件箱', async () => {
            if (!email) {
                throw new Error('请先生成邮箱地址');
            }
            state.currentEmail = email;
            state.selectedEmailAddress = email;
            const url = buildApiUrl(endpoint.replace('{email}', encodeURIComponent(email)));
            const response = await requestApi('GET', url);
            return response;
        }, {
            onSuccess: (response) => {
                const emails = Array.isArray(response?.data?.emails) ? response.data.emails : [];
                renderInboxResult(emails);
                if (elements.emailApiRawDetailResult) {
                    setResultCard(elements.emailApiRawDetailResult, response?.data || response, 'success');
                }
            },
            onError: (error) => {
                setResultCard(elements.emailApiInboxResult, `查询失败: ${error.message}`, 'error');
                if (elements.emailApiRawDetailResult) {
                    setResultCard(elements.emailApiRawDetailResult, `查询失败: ${error.message}`, 'error');
                }
            }
        });
    }

    async function getEmailDetail() {
        const emailId = getSelectedEmailId();
        if (!emailId) {
            return { success: false, error: '请先在收件箱中选择一封邮件' };
        }
        const endpoint = getApiRequestConfig().endpoints.emailDetail.replace('{id}', encodeURIComponent(emailId));
        setResultCard(elements.emailApiDetailResult, '正在读取邮件详情...', 'loading');
        return runApiRequest('查看邮件详情', async () => {
            const url = buildApiUrl(endpoint);
            return await requestApi('GET', url);
        }, {
            onSuccess: (response) => {
                const detail = response?.data || response || {};
                const verificationCode = extractVerificationCodeFromDetail(detail);
                if (verificationCode) {
                    state.currentCode = verificationCode;
                }
                setResultCard(elements.emailApiDetailResult, {
                    detail,
                    verification_code: verificationCode || '未识别到验证码'
                }, 'success');
                setResultCard(elements.emailApiRawDetailResult, detail, 'success');
            },
            onError: (error) => {
                setResultCard(elements.emailApiDetailResult, `读取失败: ${error.message}`, 'error');
                setResultCard(elements.emailApiRawDetailResult, `读取失败: ${error.message}`, 'error');
            }
        });
    }

    async function deleteEmail() {
        const emailId = getSelectedEmailId();
        if (!emailId) {
            return { success: false, error: '请先在收件箱中选择一封邮件' };
        }
        const endpoint = getApiRequestConfig().endpoints.deleteEmail.replace('{id}', encodeURIComponent(emailId));
        setStatusCard(elements.emailApiDeleteResult, '正在删除邮件...', 'loading');
        return runApiRequest('删除邮件', async () => {
            const url = buildApiUrl(endpoint);
            return await requestApi('DELETE', url);
        }, {
            onSuccess: (response) => {
                const inboxList = elements.emailApiInboxResult?.querySelector('.email-api-inbox-list') || null;
                const selectedItem = inboxList?.querySelector('.email-api-inbox-item.is-selected') || null;
                if (selectedItem) {
                    selectedItem.remove();
                    const firstItem = inboxList?.querySelector('.email-api-inbox-item') || null;
                    if (firstItem) {
                        firstItem.click();
                    } else {
                        clearInboxSelection();
                        setResultCard(elements.emailApiInboxResult, '暂无收件箱结果', 'idle');
                    }
                } else {
                    clearInboxSelection();
                }
                setStatusCard(elements.emailApiDeleteResult, response?.data?.message || '邮件删除成功', 'success');
                syncApiActionButtons();
            },
            onError: (error) => {
                setStatusCard(elements.emailApiDeleteResult, `删除失败: ${error.message}`, 'error');
            }
        });
    }

    async function clearEmails() {
        const email = getActiveEmailAddress();
        const endpoint = getApiRequestConfig().endpoints.clearEmails;
        setStatusCard(elements.emailApiClearResult, '正在清空收件箱...', 'loading');
        return runApiRequest('清空收件箱', async () => {
            if (!email) {
                throw new Error('请先生成邮箱地址');
            }
            const url = buildApiUrl(endpoint.replace('{email}', encodeURIComponent(email)));
            return await requestApi('DELETE', url);
        }, {
            onSuccess: (response) => {
                clearInboxSelection();
                setResultCard(elements.emailApiInboxResult, '暂无收件箱结果', 'idle');
                setResultCard(elements.emailApiDetailResult, '暂无邮件详情', 'idle');
                setResultCard(elements.emailApiRawDetailResult, '暂无原始详情', 'idle');
                setStatusCard(
                    elements.emailApiClearResult,
                    response?.data?.message || `已清空收件箱 (${response?.data?.count ?? 0})`,
                    'success'
                );
                syncApiActionButtons();
            },
            onError: (error) => {
                setStatusCard(elements.emailApiClearResult, `清空失败: ${error.message}`, 'error');
            }
        });
    }

    return {
        stripHtmlTags,
        normalizeVerificationCandidate,
        isLikelyVerificationCode,
        extractVerificationCode,
        extractVerificationCodeFromDetail,
        getActiveEmailAddress,
        getSelectedEmailId,
        normalizeHttpBaseUrl,
        getTempEmailHttpBaseUrl,
        syncTempEmailHttpUi,
        resolveTempEmailHttpBaseUrl,
        buildTempEmailHttpUrl,
        requestTempEmailHttpApi,
        syncApiActionButtons,
        clearInboxSelection,
        copyGeneratedEmail,
        renderInboxResult,
        syncModeUi,
        updateInfoUi,
        syncApiUi,
        getApiRequestConfig,
        getApiConfig,
        setApiConfig,
        buildApiUrl,
        getApiHeaders,
        logApi,
        requestApi,
        runApiRequest,
        generateEmail,
        listEmails,
        getEmailDetail,
        deleteEmail,
        clearEmails
    };
};
