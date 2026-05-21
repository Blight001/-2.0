const {
    IPC_CHANNELS,
    mergeApiConfig,
    setResultCard,
    setStatusCard
} = require('./renderer-temp-email-shared');
const createRendererTempEmailOutlook = require('./renderer-temp-email-outlook');
const createRendererTempEmailApi = require('./renderer-temp-email-api');
const createRendererTempEmailPanel = require('./renderer-temp-email-panel');
const {
    OUTLOOK_ACCOUNTS_STORAGE_KEY,
    OUTLOOK_SELECTED_ACCOUNT_KEY,
    parseOutlookAccountsFromText,
    mergeOutlookAccounts
} = require('./outlook-email-utils');

module.exports = function createRendererTempEmail(deps) {
    const {
        elements,
        ipcRenderer,
        utils,
        logger
    } = deps;

    const state = {
        providers: [],
        selectedProviderId: '',
        selectedProviderName: '',
        selectedMode: 'tcp',
        selectedOutlookAccount: '',
        apiConfig: mergeApiConfig(),
        browserOpen: false,
        browserId: '',
        currentUrl: '',
        currentEmail: '',
        selectedEmailId: '',
        selectedEmailAddress: '',
        currentCode: '',
        currentCodeTime: '',
        currentSelection: '',
        httpBaseUrl: '',
        outlookAccounts: [],
        selectedOutlookAccountId: '',
        outlookContentMap: {}
    };

    let renderProviderList = () => {};
    let syncModeUi = () => {};
    let updateInfoUi = () => {};
    let syncApiActionButtons = () => {};
    let syncApiUi = () => {};

    function appendTempEmailLog(message, color) {
        const log = elements.tempEmailConsoleOutput;
        if (!log) {
            logger.info(message);
            return;
        }

        const line = document.createElement('div');
        line.style.marginBottom = '4px';
        line.style.wordBreak = 'break-all';
        if (color) {
            line.style.color = color;
        }
        line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        log.appendChild(line);

        const autoScrollCheckbox = elements.tempEmailAutoScroll;
        if (autoScrollCheckbox && autoScrollCheckbox.checked) {
            log.scrollTop = log.scrollHeight;
        }
    }

    function loadOutlookState() {
        try {
            const selectedId = window.localStorage.getItem(OUTLOOK_SELECTED_ACCOUNT_KEY);
            if (selectedId) {
                state.selectedOutlookAccountId = selectedId.trim();
            }
        } catch (error) {
            logger.warning(`读取 Outlook 状态失败: ${error.message}`);
        }
    }

    function saveOutlookState() {
        try {
            window.localStorage.setItem(OUTLOOK_SELECTED_ACCOUNT_KEY, state.selectedOutlookAccountId || '');
        } catch (error) {
            logger.warning(`保存 Outlook 状态失败: ${error.message}`);
        }
    }

    function setOutlookAccounts(accounts = []) {
        state.outlookAccounts = mergeOutlookAccounts([], accounts);
    }

    function openOutlookImportDialog() {
        if (!elements.outlookEmailImportDialog) {
            return;
        }
        if (elements.outlookEmailImportText) {
            elements.outlookEmailImportText.value = '';
        }
        elements.outlookEmailImportDialog.style.display = 'flex';
    }

    function closeOutlookImportDialog() {
        if (elements.outlookEmailImportDialog) {
            elements.outlookEmailImportDialog.style.display = 'none';
        }
    }

    function setOutlookContent(content, status = 'idle') {
        const target = elements.outlookEmailContent;
        if (!target) {
            return;
        }

        target.innerHTML = '';

        if (!content) {
            const empty = document.createElement('div');
            empty.className = 'outlook-email-empty';
            empty.textContent = '暂无内容';
            target.appendChild(empty);
            return;
        }

        if (status === 'frame') {
            const frame = document.createElement('iframe');
            frame.className = 'outlook-email-frame';
            frame.src = String(content || '').trim();
            frame.setAttribute('loading', 'eager');
            frame.setAttribute('referrerpolicy', 'no-referrer');
            frame.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox');
            target.appendChild(frame);
            return;
        }

        const pre = document.createElement('pre');
        pre.className = `email-api-json outlook-email-pre outlook-email-pre--${status}`;
        pre.textContent = simplifyOutlookContent(content);
        target.appendChild(pre);
    }

    function simplifyOutlookContent(value = '') {
        const input = String(value || '').trim();
        if (!input) {
            return '';
        }

        const looksLikeHtml = /<[^>]+>/.test(input);
        if (!looksLikeHtml || typeof DOMParser === 'undefined') {
            return input
                .replace(/\r\n/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(input, 'text/html');
            const title = String(doc.title || '').trim();

            const body = doc.body ? doc.body.cloneNode(true) : null;
            if (!body) {
                return input
                    .replace(/\r\n/g, '\n')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
            }

            body.querySelectorAll('script, style, noscript, link, meta, iframe, svg, canvas').forEach((node) => node.remove());
            body.querySelectorAll('br').forEach((node) => {
                node.replaceWith('\n');
            });

            const blockTags = 'p,div,section,article,header,footer,main,aside,li,tr,table,thead,tbody,tfoot,h1,h2,h3,h4,h5,h6,blockquote,pre';
            body.querySelectorAll(blockTags).forEach((node) => {
                const tagName = String(node.tagName || '').toLowerCase();
                if (tagName === 'pre') {
                    return;
                }
                if (!node.textContent?.trim()) {
                    return;
                }
                node.insertAdjacentText('afterend', '\n');
            });

            let text = body.textContent || '';
            text = text
                .replace(/\u00a0/g, ' ')
                .replace(/[\t ]+\n/g, '\n')
                .replace(/\n[ \t]+/g, '\n')
                .replace(/[ \t]{2,}/g, ' ')
                .replace(/\n{3,}/g, '\n\n')
                .trim();

            if (title) {
                const titleLine = `标题: ${title}`;
                text = text ? `${titleLine}\n\n${text}` : titleLine;
            }

            return text || input;
        } catch (_error) {
            return input
                .replace(/\r\n/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }
    }

    function getSelectedOutlookAccount() {
        return state.outlookAccounts.find((item) => item.id === state.selectedOutlookAccountId) || null;
    }

    function renderOutlookAccounts() {
        const target = elements.outlookEmailList;
        if (!target) {
            return;
        }

        target.innerHTML = '';

        if (!Array.isArray(state.outlookAccounts) || state.outlookAccounts.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'outlook-email-empty';
            empty.textContent = '暂无 Outlook 邮箱';
            target.appendChild(empty);
            setOutlookContent('暂无收件箱邮件需要显示');
            return;
        }

        for (const account of state.outlookAccounts) {
            const row = document.createElement('div');
            row.className = 'outlook-email-item';
            if (state.selectedOutlookAccountId && state.selectedOutlookAccountId === account.id) {
                row.classList.add('is-selected');
            }

            const main = document.createElement('div');
            main.className = 'outlook-email-item__main outlook-email-item__main--grid';

            const email = document.createElement('div');
            email.className = 'outlook-email-item__cell outlook-email-item__cell--email';
            email.textContent = account.email;
            email.title = account.email;

            const password = document.createElement('div');
            password.className = 'outlook-email-item__cell outlook-email-item__cell--password';
            password.textContent = account.password || '-';
            password.title = account.password || '-';

            main.appendChild(email);
            main.appendChild(password);

            const actions = document.createElement('div');
            actions.className = 'outlook-email-item__actions';

            const fetchButtons = [];
            if (String(account.url || '').trim()) {
                fetchButtons.push({ key: 'url', label: '获取1', url: account.url });
            }
            if (String(account.url2 || '').trim()) {
                fetchButtons.push({ key: 'url2', label: '获取2', url: account.url2 });
            }

            for (const item of fetchButtons) {
                const fetchBtn = document.createElement('button');
                fetchBtn.type = 'button';
                fetchBtn.className = 'btn btn-secondary btn-small';
                fetchBtn.textContent = item.label;
                fetchBtn.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    await fetchOutlookContent(account.id, item.key);
                });
                actions.appendChild(fetchBtn);
            }

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'btn btn-danger btn-small';
            deleteBtn.textContent = '删除';
            deleteBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                await deleteOutlookAccount(account.id);
            });

            actions.appendChild(deleteBtn);
            row.appendChild(main);
            row.appendChild(actions);
            row.addEventListener('click', () => {
                state.selectedOutlookAccountId = account.id;
                saveOutlookState();
                renderOutlookAccounts();
            });
            target.appendChild(row);
        }

        const selected = getSelectedOutlookAccount() || state.outlookAccounts[0] || null;
        if (selected && !state.selectedOutlookAccountId) {
            state.selectedOutlookAccountId = selected.id;
            saveOutlookState();
            renderOutlookAccounts();
            return;
        }

        if (!selected && state.selectedOutlookAccountId) {
            state.selectedOutlookAccountId = '';
            saveOutlookState();
        } else if (selected && state.selectedOutlookAccountId !== selected.id && !state.outlookAccounts.some((item) => item.id === state.selectedOutlookAccountId)) {
            state.selectedOutlookAccountId = selected.id;
            saveOutlookState();
            renderOutlookAccounts();
        }
    }

    async function importOutlookAccountsFromText(text = '') {
        const imported = parseOutlookAccountsFromText(text);
        if (!imported.length) {
            return { success: false, error: '没有解析到有效的 Outlook 邮箱记录' };
        }

        state.outlookAccounts = mergeOutlookAccounts(state.outlookAccounts, imported);
        if (!state.selectedOutlookAccountId && state.outlookAccounts[0]) {
            state.selectedOutlookAccountId = state.outlookAccounts[0].id;
        }
        saveOutlookState();
        try {
            const persistResult = await ipcRenderer.invoke('outlook-email-save-records', {
                outlookAccounts: state.outlookAccounts
            });
            if (!persistResult || persistResult.success !== true) {
                throw new Error(persistResult?.error || '保存 Outlook 记录失败');
            }
        } catch (error) {
            logger.warning(`Outlook 记录持久化失败: ${error.message}`);
        }
        renderOutlookAccounts();
        return { success: true, count: imported.length, accounts: state.outlookAccounts };
    }

    async function persistOutlookAccounts(accounts = []) {
        const normalized = mergeOutlookAccounts([], accounts);
        const persistResult = await ipcRenderer.invoke('outlook-email-save-records', {
            outlookAccounts: normalized
        });
        if (!persistResult || persistResult.success !== true) {
            throw new Error(persistResult?.error || '保存 Outlook 记录失败');
        }
        return persistResult;
    }

    async function fetchOutlookContent(accountId = '', urlKey = 'url') {
        const account = state.outlookAccounts.find((item) => item.id === accountId) || null;
        if (!account) {
            return { success: false, error: '请选择一个 Outlook 邮箱' };
        }

        const targetUrl = String(account[urlKey] || '').trim();
        if (!targetUrl) {
            return { success: false, error: urlKey === 'url2' ? '该账号没有第二个获取方式' : '该账号没有获取方式' };
        }

        state.selectedOutlookAccountId = account.id;
        saveOutlookState();
        renderOutlookAccounts();
        setOutlookContent('正在获取内容...', 'loading');

        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.outlookFetchContent, { url: targetUrl, urlKey });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '获取 Outlook 内容失败');
            }

            const frameUrl = String(result.url || targetUrl || '').trim();
            state.outlookContentMap[`${account.id}:${urlKey}`] = frameUrl;
            setOutlookContent(frameUrl || '暂无收件箱邮件需要显示', frameUrl ? 'frame' : 'success');
            return { success: true, account, content: frameUrl, urlKey };
        } catch (error) {
            const fallback = `获取失败: ${error.message}`;
            state.outlookContentMap[`${account.id}:${urlKey}`] = fallback;
            setOutlookContent(fallback, 'error');
            return { success: false, error: error.message };
        }
    }

    async function deleteOutlookAccount(accountId = '') {
        const account = state.outlookAccounts.find((item) => item.id === accountId) || null;
        if (!account) {
            return { success: false, error: '请选择一个 Outlook 邮箱' };
        }

        const confirmed = await utils.showConfirmDialog(
            `确定删除 Outlook 邮箱「${account.email}」吗？`,
            { title: '删除 Outlook 邮箱' },
            elements
        );
        if (!confirmed) {
            return { success: false, cancelled: true };
        }

        const nextAccounts = state.outlookAccounts.filter((item) => item.id !== account.id);
        state.outlookAccounts = nextAccounts;

        if (state.selectedOutlookAccountId === account.id) {
            state.selectedOutlookAccountId = nextAccounts[0]?.id || '';
        }

        saveOutlookState();
        try {
            await persistOutlookAccounts(nextAccounts);
        } catch (error) {
            logger.warning(`删除 Outlook 记录持久化失败: ${error.message}`);
            return { success: false, error: error.message };
        }

        setOutlookContent('暂无收件箱邮件需要显示');

        renderOutlookAccounts();
        return { success: true, accounts: nextAccounts };
    }

    async function importOutlookAccountsFromDialog() {
        const text = String(elements.outlookEmailImportText?.value || '').trim();
        const result = await importOutlookAccountsFromText(text);
        if (result.success) {
            closeOutlookImportDialog();
            appendTempEmailLog(`已导入 ${result.count || 0} 条 Outlook 邮箱`, '#198754');
        }
        return result;
    }

    async function clearOutlookAccounts() {
        const confirmed = await utils.showConfirmDialog(
            '确定清空全部 Outlook 邮箱吗？此操作会同时清空记录文件。',
            { title: '清空 Outlook 邮箱' },
            elements
        );
        if (!confirmed) {
            return { success: false, cancelled: true };
        }

        state.outlookAccounts = [];
        state.selectedOutlookAccountId = '';
        state.outlookContentMap = {};
        saveOutlookState();
        try {
            await persistOutlookAccounts([]);
        } catch (error) {
            logger.warning(`清空 Outlook 记录失败: ${error.message}`);
            return { success: false, error: error.message };
        }

        renderOutlookAccounts();
        setOutlookContent('暂无收件箱邮件需要显示');
        return { success: true };
    }

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

            if (data && typeof data === 'object' && data.state) {
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



    function applyState(payload = {}) {
        if (typeof payload.selectedMode === 'string') {
            state.selectedMode = payload.selectedMode === 'outlook'
                ? 'outlook'
                : payload.selectedMode === 'temp'
                ? 'temp'
                : payload.selectedMode === 'api'
                    ? 'api'
                    : 'tcp';
        }
        if (Array.isArray(payload.providers)) {
            state.providers = payload.providers.map((provider) => ({ ...provider }));
        }
        if (typeof payload.selectedProviderId === 'string') {
            state.selectedProviderId = payload.selectedProviderId;
        }
        if (typeof payload.selectedProviderName === 'string') {
            state.selectedProviderName = payload.selectedProviderName;
        }
        if (payload.provider && typeof payload.provider === 'object') {
            state.selectedProviderId = String(payload.provider.id || state.selectedProviderId || '').trim();
            state.selectedProviderName = String(payload.provider.name || payload.provider.id || state.selectedProviderName || '').trim();
            if (payload.browserOpen === true && typeof payload.provider.url === 'string') {
                state.currentUrl = payload.provider.url;
            }
        }
        if (typeof payload.browserOpen === 'boolean') {
            state.browserOpen = payload.browserOpen;
        }
        if (payload.browserId !== undefined) {
            state.browserId = String(payload.browserId || '');
        }
        if (typeof payload.url === 'string') {
            state.currentUrl = payload.url;
        }
        if (typeof payload.email === 'string') {
            const nextEmail = String(payload.email || '').trim();
            if (nextEmail && nextEmail !== state.currentEmail) {
                state.selectedEmailId = '';
                state.currentSelection = '';
            }
            state.currentEmail = nextEmail;
            state.selectedEmailAddress = nextEmail;
            if (elements.emailApiGeneratedEmail) {
                setResultCard(elements.emailApiGeneratedEmail, nextEmail || '尚未生成邮箱', nextEmail ? 'success' : 'idle');
            }
        }
        if (typeof payload.emailId === 'string') {
            state.selectedEmailId = payload.emailId;
        }
        if (typeof payload.code === 'string') {
            state.currentCode = payload.code;
        }
        if (typeof payload.verificationTime === 'string') {
            state.currentCodeTime = payload.verificationTime.trim();
        }
        if (typeof payload.verification_time === 'string') {
            state.currentCodeTime = payload.verification_time.trim();
        }
        if (typeof payload.codeTime === 'string') {
            state.currentCodeTime = payload.codeTime.trim();
        }
        if (typeof payload.code_time === 'string') {
            state.currentCodeTime = payload.code_time.trim();
        }
        if (typeof payload.time === 'string' && !state.currentCodeTime) {
            state.currentCodeTime = payload.time.trim();
        }
        if (typeof payload.selection === 'string') {
            state.currentSelection = payload.selection;
        }
        if (payload.apiConfig && typeof payload.apiConfig === 'object') {
            state.apiConfig = mergeApiConfig(payload.apiConfig);
        }
        if (typeof payload.httpBaseUrl === 'string') {
            state.httpBaseUrl = normalizeHttpBaseUrl(payload.httpBaseUrl);
        }
        if (typeof payload.webControlUrl === 'string' && !state.httpBaseUrl) {
            state.httpBaseUrl = normalizeHttpBaseUrl(payload.webControlUrl);
        }
        if (Array.isArray(payload.outlookAccounts)) {
            state.outlookAccounts = mergeOutlookAccounts([], payload.outlookAccounts);
        }
        if (typeof payload.selectedOutlookAccountId === 'string') {
            state.selectedOutlookAccountId = payload.selectedOutlookAccountId.trim();
        }
        if (payload.outlookContentMap && typeof payload.outlookContentMap === 'object') {
            state.outlookContentMap = { ...state.outlookContentMap, ...payload.outlookContentMap };
        }

        const provider = state.providers.find((item) => item.id === state.selectedProviderId) || null;
        state.selectedProviderName = provider ? provider.name || provider.id : state.selectedProviderName;

        syncModeUi();
        renderProviderList();
        renderOutlookAccounts();
        syncApiActionButtons();
        updateInfoUi();
    }

    async function loadConfig() {
        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailLoadConfig);
            if (!result || result.success !== true) {
                throw new Error(result?.error || '读取临时邮箱配置失败');
            }

            const config = result.config || {};
            state.providers = Array.isArray(config.providers) ? config.providers : [];
            state.selectedMode = config.selectedMode === 'outlook'
                ? 'outlook'
                : config.selectedMode === 'temp'
                ? 'temp'
                : config.selectedMode === 'api'
                    ? 'api'
                    : 'tcp';
            state.selectedProviderId = String(config.selectedProviderId || '').trim();
            state.selectedProviderName = state.providers.find((item) => item.id === state.selectedProviderId)?.name
                || state.providers[0]?.name
                || '';
            applyState(result.state || config.state || {});
            setOutlookAccounts(config.outlookAccounts || []);
            syncApiUi(config.apiConfig || result.state?.apiConfig || DEFAULT_GPTMAIL_API_CONFIG);
            loadOutlookState();
            renderOutlookAccounts();
            appendTempEmailLog(`已加载临时邮箱配置: ${state.providers.length} 个卡片`, '#6c757d');
            return result;
        } catch (error) {
            logger.error(`加载临时邮箱配置失败: ${error.message}`);
            appendTempEmailLog(`加载临时邮箱配置失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }


    function updateFromExternalState(payload = {}) {
        applyState(payload);
    }

    const outlookExports = createRendererTempEmailOutlook({
        loadOutlookState,
        saveOutlookState,
        setOutlookAccounts,
        openOutlookImportDialog,
        closeOutlookImportDialog,
        setOutlookContent,
        simplifyOutlookContent,
        getSelectedOutlookAccount,
        renderOutlookAccounts,
        importOutlookAccountsFromText,
        persistOutlookAccounts,
        fetchOutlookContent,
        deleteOutlookAccount,
        importOutlookAccountsFromDialog,
        clearOutlookAccounts
    });

    const apiExports = createRendererTempEmailApi({
        elements,
        state,
        ipcRenderer,
        logger,
        appendTempEmailLog,
        applyState
    });

    const panelExports = createRendererTempEmailPanel({
        elements,
        state,
        ipcRenderer,
        utils,
        logger,
        appendTempEmailLog,
        applyState,
        loadConfig,
        requestTempEmailHttpApi: apiExports.requestTempEmailHttpApi,
        resolveTempEmailHttpBaseUrl: apiExports.resolveTempEmailHttpBaseUrl,
        openOutlookImportDialog,
        closeOutlookImportDialog,
        importOutlookAccountsFromDialog,
        clearOutlookAccounts
    });

    renderProviderList = panelExports.renderProviderList;
    syncModeUi = apiExports.syncModeUi;
    updateInfoUi = apiExports.updateInfoUi;
    syncApiActionButtons = apiExports.syncApiActionButtons;
    syncApiUi = apiExports.syncApiUi;

    return {
        loadConfig,
        appendTempEmailLog,
        updateFromExternalState,
        applyState,
        state,
        ...panelExports,
        ...outlookExports,
        ...apiExports
    };
};
