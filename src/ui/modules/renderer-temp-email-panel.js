const { IPC_CHANNELS } = require('./renderer-temp-email-shared');

module.exports = function createRendererTempEmailPanel(deps = {}) {
    const {
        elements,
        state,
        ipcRenderer,
        utils,
        logger,
        appendTempEmailLog,
        applyState,
        loadConfig,
        requestTempEmailHttpApi,
        resolveTempEmailHttpBaseUrl,
        openOutlookImportDialog,
        closeOutlookImportDialog,
        importOutlookAccountsFromDialog,
        clearOutlookAccounts
    } = deps;

    function stringifyListValue(value, fallback = []) {
        const list = Array.isArray(value) ? value : fallback;
        return list.map((item) => String(item || '').trim()).filter(Boolean).join('\n');
    }

    function parseSelectorListTextarea(value) {
        const text = String(value || '').trim();
        if (!text) {
            return { success: true, value: [] };
        }

        const selectors = [];
        const seen = new Set();
        for (const line of text.split(/\r?\n/)) {
            const selector = String(line || '').trim();
            if (!selector || seen.has(selector)) {
                continue;
            }
            seen.add(selector);
            selectors.push(selector);
        }

        return { success: true, value: selectors };
    }

    function renderProviderList() {
        const list = elements.tempEmailCardList;
        if (!list) {
            return;
        }

        list.innerHTML = '';

        if (!Array.isArray(state.providers) || state.providers.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'no-cards';
            empty.textContent = '暂无临时邮箱卡片';
            list.appendChild(empty);
            return;
        }

        for (const provider of state.providers) {
            const item = document.createElement('div');
            item.className = `card-item${provider.id === state.selectedProviderId ? ' selected' : ''}`;
            item.dataset.cardName = provider.id;
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');
            item.innerHTML = `
                <div class="card-name">${provider.name || provider.id}</div>
                <div class="card-description">${provider.url || '-'}</div>
            `;
            item.addEventListener('click', () => {
                void selectProvider(provider.id);
            });
            item.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void selectProvider(provider.id);
                }
            });
            item.addEventListener('dblclick', () => {
                void openCurrentProvider();
            });
            list.appendChild(item);
        }
    }

    function openProviderDialog(provider = null) {
        if (!elements.tempEmailProviderDialog) {
            return;
        }

        const editingProvider = provider && typeof provider === 'object' ? provider : null;
        if (elements.tempEmailProviderDialogTitle) {
            elements.tempEmailProviderDialogTitle.textContent = editingProvider
                ? '编辑临时邮箱站点'
                : '添加临时邮箱站点';
        }
        if (elements.tempEmailProviderOriginalId) {
            elements.tempEmailProviderOriginalId.value = String(editingProvider?.id || '');
        }
        if (elements.tempEmailProviderName) {
            elements.tempEmailProviderName.value = String(editingProvider?.name || '');
        }
        if (elements.tempEmailProviderUrl) {
            elements.tempEmailProviderUrl.value = String(editingProvider?.url || '');
        }
        if (elements.tempEmailProviderClosePopups) {
            elements.tempEmailProviderClosePopups.value = stringifyListValue(editingProvider?.closePopupSelectors || []);
        }
        if (elements.tempEmailProviderEmailElement) {
            elements.tempEmailProviderEmailElement.value = String(editingProvider?.emailElement || '');
        }
        if (elements.tempEmailProviderRefreshButton) {
            elements.tempEmailProviderRefreshButton.value = String(editingProvider?.refreshButton || '');
        }
        if (elements.tempEmailProviderCodeElement) {
            elements.tempEmailProviderCodeElement.value = String(editingProvider?.codeElement || '');
        }
        if (elements.tempEmailProviderCodeClickElement) {
            elements.tempEmailProviderCodeClickElement.value = String(editingProvider?.codeClickElement || '');
        }

        elements.tempEmailProviderDialog.style.display = 'flex';
    }

    function closeProviderDialog() {
        if (elements.tempEmailProviderDialog) {
            elements.tempEmailProviderDialog.style.display = 'none';
        }
    }

    function getEffectiveTempEmailBrowserType() {
        return String(elements.browserType?.value || '').trim() || 'electron';
    }

    function readProviderDialogData() {
        const originalId = String(elements.tempEmailProviderOriginalId?.value || '').trim();
        const name = String(elements.tempEmailProviderName?.value || '').trim();
        const url = String(elements.tempEmailProviderUrl?.value || '').trim();
        const closePopupsResult = parseSelectorListTextarea(elements.tempEmailProviderClosePopups?.value || '');

        if (!name) {
            return { success: false, error: '请填写站点名称' };
        }
        if (!url) {
            return { success: false, error: '请填写站点网址' };
        }

        return {
            success: true,
            provider: {
                originalId,
                name,
                url,
                closePopupSelectors: closePopupsResult.value,
                emailElement: String(elements.tempEmailProviderEmailElement?.value || '').trim(),
                refreshButton: String(elements.tempEmailProviderRefreshButton?.value || '').trim(),
                codeClickElement: String(elements.tempEmailProviderCodeClickElement?.value || '').trim(),
                codeElement: String(elements.tempEmailProviderCodeElement?.value || '').trim()
            }
        };
    }

    function setMode(mode) {
        const normalizedMode = mode === 'outlook'
            ? 'outlook'
            : mode === 'temp'
                ? 'temp'
                : mode === 'api'
                    ? 'api'
                    : 'tcp';
        return ipcRenderer.invoke(IPC_CHANNELS.tempEmailSetMode, { mode: normalizedMode })
            .then((result) => {
                if (!result || result.success !== true) {
                    throw new Error(result?.error || '设置临时邮箱模式失败');
                }
                state.selectedMode = normalizedMode;
                applyState(result.state || {});
                appendTempEmailLog(
                    `已切换到${normalizedMode === 'temp' ? '临时邮箱' : normalizedMode === 'api' ? 'API连接' : 'TCP邮箱'}模式`,
                    '#0d6efd'
                );
                return result;
            })
            .catch((error) => {
                logger.error(`切换临时邮箱模式失败: ${error.message}`);
                appendTempEmailLog(`切换临时邮箱模式失败: ${error.message}`, '#dc3545');
                return { success: false, error: error.message };
            });
    }

    function openOutlookMode() {
        return setMode('outlook');
    }

    function openApiMode() {
        return setMode('api');
    }

    function selectProvider(providerId) {
        const nextId = String(providerId || '').trim();
        if (!nextId) {
            return Promise.resolve({ success: false, error: '请选择一个临时邮箱卡片' });
        }

        return ipcRenderer.invoke(IPC_CHANNELS.tempEmailSetProvider, { providerId: nextId })
            .then((result) => {
                if (!result || result.success !== true) {
                    throw new Error(result?.error || '设置临时邮箱卡片失败');
                }

                state.selectedProviderId = nextId;
                state.selectedMode = 'temp';
                applyState(result.state || {});
                appendTempEmailLog(`已选择临时邮箱卡片: ${state.selectedProviderName || nextId}`, '#6c757d');
                return result;
            })
            .catch((error) => {
                logger.error(`选择临时邮箱卡片失败: ${error.message}`);
                appendTempEmailLog(`选择临时邮箱卡片失败: ${error.message}`, '#dc3545');
                return { success: false, error: error.message };
            });
    }

    async function openCurrentProvider() {
        if (!state.selectedProviderId) {
            utils.showMessage('请先选择一个临时邮箱卡片', 'warning', elements);
            return { success: false, error: '请选择一个临时邮箱卡片' };
        }

        await setMode('temp');
        try {
            appendTempEmailLog(`正在打开临时邮箱卡片: ${state.selectedProviderName || state.selectedProviderId}`, '#0d6efd');
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailOpenProvider, {
                browserType: getEffectiveTempEmailBrowserType(),
                providerId: state.selectedProviderId
            });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '打开临时邮箱浏览器失败');
            }
            applyState(result.state || result);
            appendTempEmailLog(`临时邮箱浏览器已打开: ${result.url || state.currentUrl || '-'}`, '#198754');
            return result;
        } catch (error) {
            logger.error(`打开临时邮箱浏览器失败: ${error.message}`);
            appendTempEmailLog(`打开临时邮箱浏览器失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function refreshEmail() {
        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailRefreshEmail, {
                providerId: state.selectedProviderId
            });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '刷新邮箱失败');
            }
            applyState(result.state || result);
            appendTempEmailLog('临时邮箱已刷新', '#0d6efd');
            return result;
        } catch (error) {
            logger.error(`刷新临时邮箱失败: ${error.message}`);
            appendTempEmailLog(`刷新临时邮箱失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function getEmail() {
        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailGetEmail, {
                providerId: state.selectedProviderId
            });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '获取邮箱失败');
            }
            applyState(result.state || result);
            appendTempEmailLog(`已获取临时邮箱: ${result.email}`, '#198754');
            return result;
        } catch (error) {
            logger.error(`获取临时邮箱失败: ${error.message}`);
            appendTempEmailLog(`获取临时邮箱失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function getCode() {
        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailGetCode, {
                providerId: state.selectedProviderId
            });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '获取验证码失败');
            }
            applyState(result.state || result);
            const verificationTime = String(
                result.verificationTime
                || result.verification_time
                || result.codeTime
                || result.code_time
                || result.time
                || ''
            ).trim();
            appendTempEmailLog(
                `已获取临时邮箱验证码: ${result.code}${verificationTime ? `（时间: ${verificationTime}）` : ''}`,
                '#198754'
            );
            return result;
        } catch (error) {
            logger.error(`获取临时邮箱验证码失败: ${error.message}`);
            appendTempEmailLog(`获取临时邮箱验证码失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function openTempEmailHttpWindow() {
        if (!state.selectedProviderId) {
            utils.showMessage('请先选择一个临时邮箱卡片', 'warning', elements);
            return { success: false, error: '请选择一个临时邮箱卡片' };
        }

        return requestTempEmailHttpApi('HTTP 打开窗口', '/api/temp-email/open-window', {
            providerId: state.selectedProviderId,
            browserType: getEffectiveTempEmailBrowserType(),
            sessionId: 'default'
        }, {
            button: elements.tempEmailHttpOpenBtn
        });
    }

    async function closeTempEmailHttpWindow() {
        return requestTempEmailHttpApi('HTTP 关闭窗口', '/api/temp-email/close-window', {
            sessionId: 'default'
        }, {
            button: elements.tempEmailHttpCloseBtn
        });
    }

    async function getTempEmailHttpEmail() {
        if (!state.selectedProviderId) {
            utils.showMessage('请先选择一个临时邮箱卡片', 'warning', elements);
            return { success: false, error: '请选择一个临时邮箱卡片' };
        }

        return requestTempEmailHttpApi('HTTP 获取邮箱', '/api/temp-email/get-email', {
            providerId: state.selectedProviderId,
            sessionId: 'default'
        }, {
            button: elements.tempEmailHttpGetEmailBtn
        });
    }

    async function getTempEmailHttpCode() {
        if (!state.selectedProviderId) {
            utils.showMessage('请先选择一个临时邮箱卡片', 'warning', elements);
            return { success: false, error: '请选择一个临时邮箱卡片' };
        }

        return requestTempEmailHttpApi('HTTP 获取验证码', '/api/temp-email/get-code', {
            providerId: state.selectedProviderId,
            sessionId: 'default'
        }, {
            button: elements.tempEmailHttpGetCodeBtn
        });
    }

    async function saveProviderFromDialog() {
        const built = readProviderDialogData();
        if (!built.success) {
            utils.showMessage(built.error, 'warning', elements);
            return built;
        }

        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailSaveProvider, built.provider);
            if (!result || result.success !== true) {
                throw new Error(result?.error || '保存临时邮箱站点失败');
            }

            closeProviderDialog();
            await loadConfig();
            appendTempEmailLog(`已保存临时邮箱站点: ${result.provider?.name || built.provider.name}`, '#198754');
            return result;
        } catch (error) {
            logger.error(`保存临时邮箱站点失败: ${error.message}`);
            appendTempEmailLog(`保存临时邮箱站点失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function importProviders() {
        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailImportProviders);
            if (!result || result.success !== true) {
                if (result?.cancelled) {
                    return result;
                }
                throw new Error(result?.error || '导入临时邮箱站点失败');
            }

            await loadConfig();
            appendTempEmailLog(`已导入 ${result.count || 0} 个临时邮箱站点`, '#198754');
            return result;
        } catch (error) {
            logger.error(`导入临时邮箱站点失败: ${error.message}`);
            appendTempEmailLog(`导入临时邮箱站点失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function deleteSelectedProvider() {
        if (!state.selectedProviderId) {
            utils.showMessage('请先选择一个临时邮箱卡片', 'warning', elements);
            return { success: false, error: '请选择一个临时邮箱卡片' };
        }

        const provider = state.providers.find((item) => item.id === state.selectedProviderId) || null;
        const providerName = provider?.name || state.selectedProviderId;
        const confirmed = await utils.showConfirmDialog(
            `确认删除临时邮箱站点「${providerName}」吗？`,
            { title: '删除临时邮箱站点' },
            elements
        );
        if (!confirmed) {
            return { success: false, cancelled: true };
        }

        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailDeleteProvider, state.selectedProviderId);
            if (!result || result.success !== true) {
                throw new Error(result?.error || '删除临时邮箱站点失败');
            }

            await loadConfig();
            appendTempEmailLog(`已删除临时邮箱站点: ${providerName}`, '#6c757d');
            return result;
        } catch (error) {
            logger.error(`删除临时邮箱站点失败: ${error.message}`);
            appendTempEmailLog(`删除临时邮箱站点失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    function setupTempEmailPanel() {
        if (elements.tempEmailAddBtn) {
            elements.tempEmailAddBtn.addEventListener('click', () => {
                openProviderDialog(null);
            });
        }
        if (elements.tempEmailImportBtn) {
            elements.tempEmailImportBtn.addEventListener('click', () => {
                void importProviders();
            });
        }
        if (elements.tempEmailEditBtn) {
            elements.tempEmailEditBtn.addEventListener('click', () => {
                const provider = state.providers.find((item) => item.id === state.selectedProviderId) || null;
                if (!provider) {
                    utils.showMessage('请先选择一个临时邮箱卡片', 'warning', elements);
                    return;
                }
                openProviderDialog(provider);
            });
        }
        if (elements.tempEmailDeleteBtn) {
            elements.tempEmailDeleteBtn.addEventListener('click', () => {
                void deleteSelectedProvider();
            });
        }
        if (elements.tempEmailOpenBtn) {
            elements.tempEmailOpenBtn.addEventListener('click', () => {
                void openCurrentProvider();
            });
        }
        if (elements.tempEmailRefreshEmailBtn) {
            elements.tempEmailRefreshEmailBtn.addEventListener('click', () => {
                void refreshEmail();
            });
        }
        if (elements.tempEmailProviderDebugBtn) {
            elements.tempEmailProviderDebugBtn.addEventListener('click', () => {
                void openCurrentProvider();
            });
        }
        if (elements.tempEmailHttpOpenBtn) {
            elements.tempEmailHttpOpenBtn.addEventListener('click', () => {
                void openTempEmailHttpWindow();
            });
        }
        if (elements.tempEmailHttpCloseBtn) {
            elements.tempEmailHttpCloseBtn.addEventListener('click', () => {
                void closeTempEmailHttpWindow();
            });
        }
        if (elements.tempEmailHttpGetEmailBtn) {
            elements.tempEmailHttpGetEmailBtn.addEventListener('click', () => {
                void getTempEmailHttpEmail();
            });
        }
        if (elements.tempEmailHttpGetCodeBtn) {
            elements.tempEmailHttpGetCodeBtn.addEventListener('click', () => {
                void getTempEmailHttpCode();
            });
        }
        if (elements.tempEmailGetEmailBtn) {
            elements.tempEmailGetEmailBtn.addEventListener('click', () => {
                void getEmail();
            });
        }
        if (elements.tempEmailGetCodeBtn) {
            elements.tempEmailGetCodeBtn.addEventListener('click', () => {
                void getCode();
            });
        }
        if (elements.tempEmailProviderDialogCloseBtn) {
            elements.tempEmailProviderDialogCloseBtn.addEventListener('click', () => {
                closeProviderDialog();
            });
        }
        if (elements.tempEmailProviderCancelBtn) {
            elements.tempEmailProviderCancelBtn.addEventListener('click', () => {
                closeProviderDialog();
            });
        }
        if (elements.tempEmailProviderSaveBtn) {
            elements.tempEmailProviderSaveBtn.addEventListener('click', () => {
                void saveProviderFromDialog();
            });
        }
        if (elements.tempEmailProviderForm) {
            elements.tempEmailProviderForm.addEventListener('submit', (event) => {
                event.preventDefault();
                void saveProviderFromDialog();
            });
        }
        if (elements.outlookEmailImportBtn) {
            elements.outlookEmailImportBtn.addEventListener('click', openOutlookImportDialog);
        }
        if (elements.outlookEmailClearBtn) {
            elements.outlookEmailClearBtn.addEventListener('click', clearOutlookAccounts);
        }
        if (elements.outlookEmailImportCloseBtn) {
            elements.outlookEmailImportCloseBtn.addEventListener('click', closeOutlookImportDialog);
        }
        if (elements.outlookEmailImportCancelBtn) {
            elements.outlookEmailImportCancelBtn.addEventListener('click', closeOutlookImportDialog);
        }
        if (elements.outlookEmailImportConfirmBtn) {
            elements.outlookEmailImportConfirmBtn.addEventListener('click', () => {
                void importOutlookAccountsFromDialog();
            });
        }
        if (elements.outlookEmailImportDialog) {
            elements.outlookEmailImportDialog.addEventListener('click', (event) => {
                if (event.target === elements.outlookEmailImportDialog) {
                    closeOutlookImportDialog();
                }
            });
        }
        void loadConfig().then((result) => {
            if (result && result.success) {
                const mode = state.selectedMode === 'outlook'
                    ? 'outlook'
                    : state.selectedMode === 'temp'
                        ? 'temp'
                        : state.selectedMode === 'api'
                            ? 'api'
                            : 'connect';
                void utils.activateEmailMode(mode, elements, utils.appendEmailLog, utils.updateEmailStatus);
            }
        });
        void resolveTempEmailHttpBaseUrl();
    }

    return {
        renderProviderList,
        openProviderDialog,
        closeProviderDialog,
        getEffectiveTempEmailBrowserType,
        setMode,
        openOutlookMode,
        openApiMode,
        selectProvider,
        openCurrentProvider,
        refreshEmail,
        getEmail,
        getCode,
        openTempEmailHttpWindow,
        closeTempEmailHttpWindow,
        getTempEmailHttpEmail,
        getTempEmailHttpCode,
        setupTempEmailPanel
    };
};
