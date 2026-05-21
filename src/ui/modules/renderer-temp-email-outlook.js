const {
    IPC_CHANNELS
} = require('./renderer-temp-email-shared');
const {
    OUTLOOK_SELECTED_ACCOUNT_KEY,
    parseOutlookAccountsFromText,
    mergeOutlookAccounts
} = require('./outlook-email-utils');

module.exports = function createRendererTempEmailOutlook(deps = {}) {
    const {
        elements,
        ipcRenderer,
        utils,
        logger,
        state,
        appendTempEmailLog
    } = deps;

    function loadOutlookState() {
        try {
            const selectedId = window.localStorage.getItem(OUTLOOK_SELECTED_ACCOUNT_KEY);
            if (selectedId) {
                state.selectedOutlookAccountId = String(selectedId || '').trim();
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

    function getSelectedOutlookAccount() {
        return state.outlookAccounts.find((item) => item.id === state.selectedOutlookAccountId) || null;
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

    return {
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
    };
};
