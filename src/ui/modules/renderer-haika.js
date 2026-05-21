/**
 * 海卡相关渲染功能。
 *
 * 这里集中处理海卡绑卡控制、卡密兑换、试用状态和相关本地缓存。
 * 主文件只保留共享状态与 wiring，降低单文件的维护压力。
 */

module.exports = function createRendererHaika(deps) {
    const state = deps;
    const {
        elements,
        cardManager,
        clashManager,
        utils,
        logger,
        ipcRenderer,
        groupCookiesByCardName
    } = deps;

    function getActiveClashNodePatch() {
        if (!clashManager || typeof clashManager.getClashState !== 'function') {
            return {};
        }

        const clashState = clashManager.getClashState() || {};
        if (clashState.tunMode !== true && clashState.systemProxy !== true) {
            return {};
        }

        const currentNode = String(clashState.currentNode || '').trim();
        if (!currentNode) {
            return {};
        }

        return {
            currentNode,
            current_node: currentNode,
            clashCurrentNode: currentNode
        };
    }

    function getUnifiedBrowserControls() {
        const browserType = elements.browserType && elements.browserType.value
            ? String(elements.browserType.value).trim()
            : 'electron';

        return {
            browserType,
            browserSource: 'local-browser',
            headless: elements.headlessMode ? elements.headlessMode.checked === true : true,
            browser_display_mode: elements.browserDisplayMode && elements.browserDisplayMode.checked ? 'embedded' : 'window',
            block_images_videos: elements.browserBlockImagesVideos ? elements.browserBlockImagesVideos.checked === true : false,
            sync_execution: elements.syncExecution ? elements.syncExecution.checked === true : true
        };
    }

    function getEffectiveHaikaBindBrowserType() {
        return getUnifiedBrowserControls().browserType;
    }

        function loadHaikaBindAccountControls() {
            if (elements.haikaBindAccountFolder) {
                const savedFolder = localStorage.getItem('haika-bind-account-folder');
                if (savedFolder) {
                    elements.haikaBindAccountFolder.value = savedFolder;
                }
            }

            if (elements.haikaBindAccountFilter) {
                const savedFilter = localStorage.getItem('haika-bind-account-filter');
                if (savedFilter) {
                    elements.haikaBindAccountFilter.value = savedFilter;
                }
            }
        }

        function saveHaikaBindAccountControls() {
            if (elements.haikaBindAccountFolder) {
                localStorage.setItem('haika-bind-account-folder', elements.haikaBindAccountFolder.value || '');
            }

            if (elements.haikaBindAccountFilter) {
                localStorage.setItem('haika-bind-account-filter', elements.haikaBindAccountFilter.value || 'all');
            }
        }

        function isHaikaBindingTask(taskId) {
            return typeof taskId === 'string' && taskId.startsWith('haika_bind_');
        }

        function updateHaikaBindAccountFilterOptions(cardGroups, selectedFolder) {
            if (!elements.haikaBindAccountFilter) return;

            const currentSelection = elements.haikaBindAccountFilter.value;
            elements.haikaBindAccountFilter.innerHTML = '<option value="all">所有账号</option>';

            if (!selectedFolder || !cardGroups[selectedFolder]) {
                elements.haikaBindAccountFilter.value = currentSelection || 'all';
                return;
            }

            const cookies = cardGroups[selectedFolder];
            const pointsSet = new Set();
            let hasUnknown = false;

            cookies.forEach(cookie => {
                if (cookie.points === null ||
                    cookie.points === undefined ||
                    cookie.points === 'null' ||
                    cookie.points === '' ||
                    isNaN(parseInt(cookie.points, 10))) {
                    hasUnknown = true;
                } else {
                    pointsSet.add(parseInt(cookie.points, 10));
                }
            });

            Array.from(pointsSet).sort((a, b) => a - b).forEach(points => {
                const option = document.createElement('option');
                option.value = `points_${points}`;
                option.textContent = `积分 ${points}`;
                elements.haikaBindAccountFilter.appendChild(option);
            });

            if (hasUnknown) {
                const option = document.createElement('option');
                option.value = 'points_unknown';
                option.textContent = '未知积分';
                elements.haikaBindAccountFilter.appendChild(option);
            }

            if (currentSelection && Array.from(elements.haikaBindAccountFilter.options).some(opt => opt.value === currentSelection)) {
                elements.haikaBindAccountFilter.value = currentSelection;
            } else {
                elements.haikaBindAccountFilter.value = 'all';
            }
        }

        function updateHaikaBindAccountControls(cookies = []) {
            const cardGroups = groupCookiesByCardName(cookies);
            const cardNames = Object.keys(cardGroups);

            if (elements.haikaBindAccountFolder) {
                const currentSelection = elements.haikaBindAccountFolder.value;
                elements.haikaBindAccountFolder.innerHTML = '';

                if (cardNames.length === 0) {
                    const option = document.createElement('option');
                    option.value = '';
                    option.textContent = '无可用账号类型';
                    elements.haikaBindAccountFolder.appendChild(option);
                    elements.haikaBindAccountFolder.value = '';
                } else {
                    cardNames.forEach(cardName => {
                        const option = document.createElement('option');
                        option.value = cardName;
                        option.textContent = cardName;
                        elements.haikaBindAccountFolder.appendChild(option);
                    });

                    const savedFolder = localStorage.getItem('haika-bind-account-folder');
                    if (currentSelection && cardNames.includes(currentSelection)) {
                        elements.haikaBindAccountFolder.value = currentSelection;
                    } else if (savedFolder && cardNames.includes(savedFolder)) {
                        elements.haikaBindAccountFolder.value = savedFolder;
                    } else {
                        elements.haikaBindAccountFolder.value = cardNames[0];
                    }
                }
            }

            const selectedFolder = elements.haikaBindAccountFolder ? elements.haikaBindAccountFolder.value : '';
            updateHaikaBindAccountFilterOptions(cardGroups, selectedFolder);
            if (cardNames.length > 0) {
                saveHaikaBindAccountControls();
            }
        }

        function getHaikaBindBrowserConfig() {
            return {
                browser_type: getEffectiveHaikaBindBrowserType(),
                ...getUnifiedBrowserControls(),
                ...getActiveClashNodePatch()
            };
        }

        function getHaikaBindAccountConfig() {
            const parsedConcurrent = elements.concurrentCount ? parseInt(elements.concurrentCount.value, 10) : 1;

            return {
                concurrentCount: Number.isFinite(parsedConcurrent) ? Math.max(1, Math.min(10, parsedConcurrent)) : 1,
                accountFolder: elements.haikaBindAccountFolder ? elements.haikaBindAccountFolder.value || 'all' : 'all',
                accountFilter: elements.haikaBindAccountFilter ? elements.haikaBindAccountFilter.value || 'all' : 'all'
            };
        }

        async function stopHaikaBinding() {
            if (!elements.haikaBindStopBtn) {
                return;
            }

            try {
                elements.haikaBindStopBtn.disabled = true;
                elements.haikaBindStopBtn.textContent = '停止中...';
                const result = await ipcRenderer.invoke('stop-haika-binding');
                if (!result.success) {
                    elements.haikaBindStopBtn.disabled = false;
                    elements.haikaBindStopBtn.textContent = '停止绑定';
                    utils.showMessage(`停止海卡绑定失败: ${result.error}`, 'error', elements);
                }
            } catch (error) {
                elements.haikaBindStopBtn.disabled = false;
                elements.haikaBindStopBtn.textContent = '停止绑定';
                utils.showMessage(`停止海卡绑定异常: ${error.message}`, 'error', elements);
            }
        }

        // ==================== 海卡兑换状态 ====================
        const HAIKA_REDEEMED_PREFIX = 'haika-redeemed-keys:';
        const HAIKA_FAILED_PREFIX = 'haika-failed-keys:';

        function getHaikaRedeemedStorageKey(categoryName) {
            const safeCategory = String(categoryName || '默认分类').trim() || '默认分类';
            return `${HAIKA_REDEEMED_PREFIX}${safeCategory}`;
        }

        function loadHaikaRedeemedSet(categoryName) {
            try {
                const raw = localStorage.getItem(getHaikaRedeemedStorageKey(categoryName));
                if (!raw) return new Set();
                const parsed = JSON.parse(raw);
                return new Set(Array.isArray(parsed) ? parsed.map(item => String(item)) : []);
            } catch (_error) {
                return new Set();
            }
        }

        function saveHaikaRedeemedSet(categoryName, redeemedSet) {
            try {
                localStorage.setItem(
                    getHaikaRedeemedStorageKey(categoryName),
                    JSON.stringify(Array.from(redeemedSet))
                );
            } catch (_error) {}
        }

        function getHaikaFailedStorageKey(categoryName) {
            const safeCategory = String(categoryName || '默认分类').trim() || '默认分类';
            return `${HAIKA_FAILED_PREFIX}${safeCategory}`;
        }

        function loadHaikaFailedSet(categoryName) {
            try {
                const raw = localStorage.getItem(getHaikaFailedStorageKey(categoryName));
                if (!raw) return new Set();
                const parsed = JSON.parse(raw);
                return new Set(Array.isArray(parsed) ? parsed.map(item => String(item)) : []);
            } catch (_error) {
                return new Set();
            }
        }

        function saveHaikaFailedSet(categoryName, failedSet) {
            try {
                localStorage.setItem(
                    getHaikaFailedStorageKey(categoryName),
                    JSON.stringify(Array.from(failedSet))
                );
            } catch (_error) {}
        }

        function markHaikaKeyFailed(key, categoryName = state.currentHaikaCategory || getSelectedHaikaCategory()) {
            const normalizedKey = String(key || '').trim();
            if (!normalizedKey) return;

            const failedSet = loadHaikaFailedSet(categoryName);
            if (!failedSet.has(normalizedKey)) {
                failedSet.add(normalizedKey);
                saveHaikaFailedSet(categoryName, failedSet);
            }
        }

        function clearHaikaKeyFailed(key, categoryName = state.currentHaikaCategory || getSelectedHaikaCategory()) {
            const normalizedKey = String(key || '').trim();
            if (!normalizedKey) return;

            const failedSet = loadHaikaFailedSet(categoryName);
            if (failedSet.delete(normalizedKey)) {
                saveHaikaFailedSet(categoryName, failedSet);
            }
        }

        function markHaikaKeyRedeemed(key, categoryName = state.currentHaikaCategory || getSelectedHaikaCategory()) {
            const normalizedKey = String(key || '').trim();
            if (!normalizedKey) return;

            const redeemedSet = loadHaikaRedeemedSet(categoryName);
            if (!redeemedSet.has(normalizedKey)) {
                redeemedSet.add(normalizedKey);
                saveHaikaRedeemedSet(categoryName, redeemedSet);
            }

            clearHaikaKeyFailed(normalizedKey, categoryName);
        }

        function getSelectedHaikaCategory() {
            return elements.trialCategorySelect ? elements.trialCategorySelect.value : '';
        }

        function clearHaikaSuggestions() {
            if (elements.trialKeySuggestions) {
                elements.trialKeySuggestions.style.display = 'none';
                elements.trialKeySuggestions.innerHTML = '';
            }
        }

        function setSelectedHaikaCategory(categoryName) {
            state.currentHaikaCategory = categoryName || '';
            if (elements.trialCategorySelect && categoryName) {
                elements.trialCategorySelect.value = categoryName;
            }
            if (categoryName) {
                localStorage.setItem('haika-selected-category', categoryName);
            }
        }

        function renderHaikaSuggestions(query = '') {
            const container = elements.trialKeySuggestions;
            if (!container) return;

            const normalizedQuery = String(query || '').trim().toLowerCase();
            const redeemedSet = loadHaikaRedeemedSet(state.currentHaikaCategory || getSelectedHaikaCategory());
            const failedSet = loadHaikaFailedSet(state.currentHaikaCategory || getSelectedHaikaCategory());
            const filtered = state.currentHaikaKeys.filter(item => {
                if (!normalizedQuery) return true;
                return item.key.toLowerCase().includes(normalizedQuery) || String(item.index).includes(normalizedQuery);
            });

            container.innerHTML = '';

            if (!filtered.length) {
                const empty = document.createElement('div');
                empty.className = 'trial-key-suggestion-empty';
                empty.textContent = state.currentHaikaKeys.length ? '没有匹配的卡密' : '当前分类暂无卡密';
                container.appendChild(empty);
                container.style.display = 'block';
                return;
            }

            filtered.forEach(item => {
                const normalizedKey = String(item.key || '').trim();
                const isRedeemed = redeemedSet.has(normalizedKey);
                const isFailed = !isRedeemed && failedSet.has(normalizedKey);
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `trial-key-suggestion-item ${isRedeemed ? 'is-redeemed' : (isFailed ? 'is-failed' : 'is-available')}`;
                btn.innerHTML = `
                    <span class="trial-key-suggestion-index">${item.index}</span>
                    <span class="trial-key-suggestion-text"></span>
                    <span class="trial-key-suggestion-state"></span>
                `;
                btn.querySelector('.trial-key-suggestion-text').textContent = item.key;
                btn.querySelector('.trial-key-suggestion-state').textContent = isRedeemed ? '已兑换' : (isFailed ? '兑换失败' : '未兑换');
                btn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    if (elements.trialCardKey) {
                        elements.trialCardKey.value = item.key;
                        elements.trialCardKey.focus();
                    }
                    clearHaikaSuggestions();
                });
                container.appendChild(btn);
            });

            container.style.display = 'block';
        }

        function showHaikaSuggestions() {
            renderHaikaSuggestions(elements.trialCardKey ? elements.trialCardKey.value : '');
        }

        async function loadHaikaCategories(preferCategory = '') {
            try {
                const result = await ipcRenderer.invoke('haika-list-categories');
                if (!result.success) {
                    throw new Error(result.error || '加载海卡分类失败');
                }

                const categories = result.categories || [];
                if (elements.trialCategorySelect) {
                    elements.trialCategorySelect.innerHTML = '';
                    categories.forEach(category => {
                        const option = document.createElement('option');
                        option.value = category.name;
                        option.textContent = `${category.name} (${category.keyCount || 0})`;
                        elements.trialCategorySelect.appendChild(option);
                    });
                }

                const categoryNames = new Set(categories.map(category => String(category?.name || '').trim()).filter(Boolean));
                const savedCategory = localStorage.getItem('haika-selected-category');
                const preferredCategory = String(preferCategory || '').trim();
                const storedCategory = String(savedCategory || '').trim();
                const targetCategory = categoryNames.size > 0
                    ? (
                        (preferredCategory && categoryNames.has(preferredCategory) && preferredCategory)
                        || (storedCategory && categoryNames.has(storedCategory) && storedCategory)
                        || (categories[0] ? categories[0].name : '默认分类')
                    )
                    : (preferredCategory || storedCategory || '默认分类');

                setSelectedHaikaCategory(targetCategory);
                syncHaikaImportTargetCategory(targetCategory);
                await loadHaikaKeys(targetCategory);
            } catch (error) {
                logger.error(`加载海卡分类失败: ${error.message}`);
                state.currentHaikaKeys = [];
                clearHaikaSuggestions();
            }
        }

        async function loadHaikaKeys(categoryName) {
            const targetCategory = categoryName || getSelectedHaikaCategory() || '默认分类';
            try {
                const result = await ipcRenderer.invoke('haika-load-keys', targetCategory);
                if (!result.success) {
                    throw new Error(result.error || '加载海卡卡密失败');
                }

                state.currentHaikaCategory = result.category || targetCategory;
                state.currentHaikaKeys = Array.isArray(result.keys) ? result.keys : [];
                renderHaikaSuggestions(elements.trialCardKey ? elements.trialCardKey.value : '');
            } catch (error) {
                logger.error(`加载海卡卡密失败: ${error.message}`);
                state.currentHaikaKeys = [];
                clearHaikaSuggestions();
            }
        }

        async function createHaikaCategory() {
            const categoryName = elements.trialCategoryName ? elements.trialCategoryName.value.trim() : '';
            if (!categoryName) {
                utils.showMessage('请输入分类名称', 'warning', elements);
                return;
            }

            try {
                const result = await ipcRenderer.invoke('haika-create-category', categoryName);
                if (result.success) {
                    if (elements.trialCategoryName) {
                        elements.trialCategoryName.value = '';
                    }
                    utils.showMessage(`海卡分类已创建: ${result.category.name}`, 'success', elements);
                    await loadHaikaCategories(result.category.name);
                } else {
                    utils.showMessage(`创建海卡分类失败: ${result.error}`, 'error', elements);
                }
            } catch (error) {
                utils.showMessage(`创建海卡分类异常: ${error.message}`, 'error', elements);
            }
        }

        function openHaikaCategoryModal() {
            const modal = elements.haikaCategoryModal;
            if (!modal) return;

            loadHaikaCategories(getSelectedHaikaCategory());
            modal.classList.add('show');
            window.setTimeout(() => {
                if (elements.trialCategorySelect) {
                    elements.trialCategorySelect.focus();
                }
            }, 0);
        }

        function closeHaikaCategoryModal() {
            if (elements.haikaCategoryModal) {
                elements.haikaCategoryModal.classList.remove('show');
            }
        }

        function syncHaikaImportTargetCategory(categoryName) {
            if (!elements.haikaImportTargetCategory) return;
            elements.haikaImportTargetCategory.value = categoryName || getSelectedHaikaCategory() || '默认分类';
        }

        function getHaikaImportTargetCategory() {
            if (elements.trialCategoryName && elements.trialCategoryName.value.trim()) {
                return elements.trialCategoryName.value.trim();
            }
            return getSelectedHaikaCategory();
        }

        async function confirmHaikaImport() {
            const categoryName = elements.haikaImportTargetCategory
                ? elements.haikaImportTargetCategory.value.trim()
                : getHaikaImportTargetCategory();
            const importText = elements.haikaImportText ? elements.haikaImportText.value : '';

            if (!importText.trim()) {
                utils.showMessage('请先粘贴海卡卡密内容', 'warning', elements);
                return;
            }

            try {
                const result = await ipcRenderer.invoke('haika-import-keys', categoryName, importText);
                if (result.success) {
                    utils.showMessage(`已导入 ${result.importedCount} 条海卡卡密到「${result.category}」`, 'success', elements);
                    if (elements.trialCategoryName) {
                        elements.trialCategoryName.value = '';
                    }
                    if (elements.haikaImportText) {
                        elements.haikaImportText.value = '';
                    }
                    await loadHaikaCategories(result.category);
                } else {
                    utils.showMessage(`导入海卡卡密失败: ${result.error}`, 'error', elements);
                }
            } catch (error) {
                utils.showMessage(`导入海卡卡密异常: ${error.message}`, 'error', elements);
            }
        }

        function setTrialField(element, value) {
            if (!element) return;
            element.textContent = value ? String(value) : '-';
        }

        function extractHaikaBindingResponse(result) {
            const response = result?.result || result?.response || result?.data || result || null;
            if (!response || typeof response !== 'object') {
                return null;
            }

            if (response.card && response.content) {
                return response;
            }

            if (response.result && response.result.card && response.result.content) {
                return response.result;
            }

            if (response.data && response.data.card && response.data.content) {
                return response.data;
            }

            return null;
        }

        function formatHaikaExpiryDate(expiryDate) {
            if (expiryDate === null || expiryDate === undefined) {
                return '';
            }

            const raw = String(expiryDate).trim();
            if (!raw) {
                return '';
            }

            const digits = raw.replace(/\D/g, '');
            if (digits.length === 4) {
                return digits;
            }

            const parts = raw.split(/\D+/).filter(Boolean);
            if (parts.length >= 2) {
                const first = parts[0];
                const second = parts[1];

                if (first.length === 4 && second.length <= 2) {
                    return `${second.padStart(2, '0')}${first.slice(-2)}`;
                }

                if (first.length <= 2 && second.length === 4) {
                    return `${first.padStart(2, '0')}${second.slice(-2)}`;
                }
            }

            return raw;
        }

        function clearTrialInfo() {
            state.currentTrialBinding = null;
            setTrialField(elements.trialCardNumber, '-');
            setTrialField(elements.trialExpiryDate, '-');
            setTrialField(elements.trialCvv, '-');
            setTrialField(elements.trialName, '-');
            setTrialField(elements.trialPhone, '-');
            setTrialField(elements.trialAddress, '-');
            setTrialField(elements.trialSmsCode, '-');
            if (elements.trialSmsStatus) {
                elements.trialSmsStatus.textContent = '等待刷新验证码';
            }
            if (elements.trialRefreshSmsBtn) {
                elements.trialRefreshSmsBtn.disabled = true;
            }
        }

        function setTrialStatus(text, state = 'neutral') {
            if (!elements.trialStatusPill) return;

            elements.trialStatusPill.textContent = text;
            elements.trialStatusPill.classList.remove('is-neutral', 'is-success', 'is-error', 'is-loading');
            elements.trialStatusPill.classList.add(`is-${state}`);
        }

        function applyTrialBindingView(binding) {
            state.currentTrialBinding = binding || null;

            setTrialField(elements.trialCardNumber, binding?.content?.card_number);
            setTrialField(elements.trialExpiryDate, formatHaikaExpiryDate(binding?.content?.expiry_date));
            setTrialField(elements.trialCvv, binding?.content?.cvv);
            setTrialField(elements.trialName, binding?.content?.name);
            setTrialField(elements.trialPhone, binding?.content?.phone);
            setTrialField(elements.trialAddress, binding?.content?.address);
            const displaySmsCode = binding?.smsCode || binding?.cachedSmsCode || '';
            setTrialField(elements.trialSmsCode, displaySmsCode);

            if (elements.trialSmsStatus) {
                if (binding?.smsCode) {
                    elements.trialSmsStatus.textContent = '验证码已刷新';
                } else if (binding?.cachedSmsCode) {
                    elements.trialSmsStatus.textContent = '已恢复上次验证码记录';
                } else {
                    elements.trialSmsStatus.textContent = '点击刷新验证码';
                }
            }

            if (elements.trialRefreshSmsBtn) {
                elements.trialRefreshSmsBtn.disabled = !binding?.content?.sms_api;
            }
        }

        function renderTrialResult(result, statusText = '') {
            const response = result?.result || result?.response || result?.data || result || null;
            const binding = extractHaikaBindingResponse(response);

            if (elements.trialCacheTip) {
                elements.trialCacheTip.textContent = result?.success
                    ? '已保存最近一份海卡信息'
                    : (statusText || '等待操作');
            }

            if (elements.trialResponseJson) {
                elements.trialResponseJson.textContent = JSON.stringify(response || result || {}, null, 2);
            }

            if (result?.success) {
                setTrialStatus('兑换成功', 'success');
                if (binding) {
                    applyTrialBindingView({
                        ...binding,
                        smsCode: '',
                        cachedSmsCode: state.currentTrialBinding?.cachedSmsCode || ''
                    });
                } else {
                    clearTrialInfo();
                }
                return;
            }

            if (result) {
                setTrialStatus('兑换失败', 'error');
                if (!state.currentTrialBinding || !state.currentTrialBinding.content) {
                    clearTrialInfo();
                }
            } else {
                setTrialStatus('等待操作', 'neutral');
                clearTrialInfo();
            }
        }

        async function loadHaikaTrialState() {
            try {
                const result = await ipcRenderer.invoke('haika-get-state', {
                    smsApiUrl: state.currentTrialBinding?.content?.sms_api || ''
                });

                if (!result || !result.success || !result.state) {
                    return;
                }

                const trialState = result.state;
                const latestExchange = trialState.latestExchange || null;
                const exchangeResponse = extractHaikaBindingResponse(latestExchange?.response || latestExchange);

                if (elements.trialCardKey && latestExchange?.key) {
                    elements.trialCardKey.value = latestExchange.key;
                }

                if (exchangeResponse) {
                    const latestSms = trialState.latestSms || null;
                    applyTrialBindingView({
                        ...exchangeResponse,
                        smsCode: '',
                        cachedSmsCode: latestSms?.code || ''
                    });

                    if (elements.trialResponseJson) {
                        elements.trialResponseJson.textContent = JSON.stringify({
                            latestExchange,
                            latestSms
                        }, null, 2);
                    }

                    if (elements.trialCacheTip) {
                        elements.trialCacheTip.textContent = latestSms?.code
                            ? '已恢复上次海卡信息与验证码'
                            : '已恢复上次海卡信息';
                    }

                    setTrialStatus(latestSms?.code ? '已恢复缓存' : '已恢复信息', 'success');
                    renderHaikaSuggestions(elements.trialCardKey ? elements.trialCardKey.value : '');
                    return;
                }

                if (trialState.latestSms && elements.trialResponseJson) {
                    elements.trialResponseJson.textContent = JSON.stringify({
                        latestExchange,
                        latestSms: trialState.latestSms
                    }, null, 2);
                }

                if (trialState.latestSms && elements.trialCacheTip) {
                    elements.trialCacheTip.textContent = '已恢复上次验证码记录';
                }

                renderHaikaSuggestions(elements.trialCardKey ? elements.trialCardKey.value : '');
            } catch (error) {
                logger.warning(`恢复海卡缓存失败: ${error.message}`);
            }
        }

        async function refreshTrialSmsCode() {
            if (!state.currentTrialBinding || !state.currentTrialBinding.content || !state.currentTrialBinding.content.sms_api) {
                utils.showMessage('请先兑换海卡并获取验证码接口地址', 'warning', elements);
                return;
            }

            const smsApi = state.currentTrialBinding.content.sms_api;
            if (elements.trialRefreshSmsBtn) {
                elements.trialRefreshSmsBtn.disabled = true;
            }
            if (elements.trialSmsStatus) {
                elements.trialSmsStatus.textContent = '正在刷新验证码...';
            }

            try {
                const result = await ipcRenderer.invoke('haika-fetch-sms', smsApi);
                if (result && result.success) {
                    const code = result.code || '';
                    state.currentTrialBinding = {
                        ...state.currentTrialBinding,
                        smsCode: code,
                        cachedSmsCode: code
                    };
                    applyTrialBindingView(state.currentTrialBinding);
                    if (elements.trialSmsStatus) {
                        if (result.duplicate) {
                            elements.trialSmsStatus.textContent = code
                                ? '验证码与上次相同'
                                : '暂无验证码';
                        } else {
                            elements.trialSmsStatus.textContent = code
                                ? '验证码已刷新'
                                : (result.emptyNotice ? '暂无验证码' : '接口返回为空');
                        }
                    }
                    if (elements.trialResponseJson) {
                        elements.trialResponseJson.textContent = JSON.stringify(result.raw || result, null, 2);
                    }
                    utils.showMessage(
                        code ? (result.duplicate ? `验证码与上次相同: ${code}` : `验证码已刷新: ${code}`) : '暂无验证码',
                        code ? (result.duplicate ? 'warning' : 'success') : 'warning',
                        elements
                    );
                } else {
                    if (elements.trialSmsStatus) {
                        elements.trialSmsStatus.textContent = '刷新失败';
                    }
                    utils.showMessage(`刷新验证码失败: ${result?.error || '未知错误'}`, 'error', elements);
                }
            } catch (error) {
                if (elements.trialSmsStatus) {
                    elements.trialSmsStatus.textContent = '刷新异常';
                }
                utils.showMessage(`刷新验证码异常: ${error.message}`, 'error', elements);
            } finally {
                if (elements.trialRefreshSmsBtn) {
                    elements.trialRefreshSmsBtn.disabled = false;
                }
            }
        }

        async function redeemTrialBinding() {
            const key = elements.trialCardKey ? elements.trialCardKey.value.trim() : '';
            if (!key) {
                utils.showMessage('请输入海卡卡密', 'warning', elements);
                return;
            }

            const redeemBtn = elements.trialRedeemBtn;
            if (redeemBtn) redeemBtn.disabled = true;
            setTrialStatus('兑换中...', 'loading');
            if (elements.trialCacheTip) {
                elements.trialCacheTip.textContent = '正在请求海卡接口';
            }

            try {
                const result = await ipcRenderer.invoke('exchange-haika-key', key);
                if (result && result.success) {
                    markHaikaKeyRedeemed(key);
                    renderTrialResult(result, '兑换成功');
                    renderHaikaSuggestions(elements.trialCardKey ? elements.trialCardKey.value : '');
                    utils.showMessage('海卡兑换成功', 'success', elements);
                    logger.info('海卡兑换成功');
                } else {
                    markHaikaKeyFailed(key);
                    renderTrialResult(result, '兑换失败');
                    renderHaikaSuggestions(elements.trialCardKey ? elements.trialCardKey.value : '');
                    utils.showMessage(`海卡兑换失败: ${result?.error || '未知错误'}`, 'error', elements);
                }
            } catch (error) {
                markHaikaKeyFailed(key);
                renderTrialResult({ success: false, error: error.message }, '请求异常');
                renderHaikaSuggestions(elements.trialCardKey ? elements.trialCardKey.value : '');
                utils.showMessage(`海卡兑换异常: ${error.message}`, 'error', elements);
            } finally {
                if (redeemBtn) redeemBtn.disabled = false;
            }
        }

        async function startHaikaBinding(singleAccount = null) {
            const selectedCardName = cardManager.getCurrentHaikaBindCard();
            if (!selectedCardName) {
                utils.showMessage('请先选择一个海卡绑定卡片', 'warning', elements);
                return;
            }

                if (!state.currentTrialBinding || !state.currentTrialBinding.content) {
                utils.showMessage('请先完成海卡兑换，获取绑定数据后再执行绑定', 'warning', elements);
                return;
            }

            if (!elements.haikaBindStartBtn) {
                return;
            }

            const selectedHaikaKey = elements.trialCardKey ? elements.trialCardKey.value.trim() : '';
            const selectedHaikaCategory = state.currentHaikaCategory || getSelectedHaikaCategory() || '默认分类';
            const selectedHaikaKeyEntry = state.currentHaikaKeys.find(item => String(item?.key || '').trim() === selectedHaikaKey) || null;
            const bindingConfig = {
                cardName: selectedCardName,
                browserType: getEffectiveHaikaBindBrowserType(),
                browserSettings: getHaikaBindBrowserConfig(),
                headless: getUnifiedBrowserControls().headless,
                ...getHaikaBindAccountConfig(),
                bindingContent: {
                    ...state.currentTrialBinding.content,
                    haika_key: selectedHaikaKey,
                    haikaKey: selectedHaikaKey,
                    haika_key_index: selectedHaikaKeyEntry?.index || '',
                    haikaKeyIndex: selectedHaikaKeyEntry?.index || '',
                    haika_category: selectedHaikaCategory,
                    haikaCategory: selectedHaikaCategory
                },
                smsCode: state.currentTrialBinding.smsCode || state.currentTrialBinding.cachedSmsCode || '',
                singleAccount: singleAccount || null
            };

            try {
                elements.haikaBindStartBtn.disabled = true;
                elements.haikaBindStartBtn.textContent = singleAccount ? '单独绑卡中...' : '启动中...';
                state.currentHaikaBindBatchId = null;
                state.currentHaikaBindBatchActive = false;
                state.currentHaikaBindBatchTotal = 0;

                const result = await ipcRenderer.invoke('start-haika-binding', bindingConfig);
                if (result && result.success) {
                    state.currentHaikaBindBatchId = result.batchId || null;
                    state.currentHaikaBindBatchTotal = result.total || 0;
                    const successMessage = singleAccount
                        ? (result.message || `海卡单独绑卡流程已启动: ${selectedCardName}`)
                        : (result.message || `海卡绑定流程已启动: ${selectedCardName}`);
                    utils.showMessage(successMessage, 'success', elements);
                    logger.info(`${singleAccount ? '海卡单独绑卡流程' : '海卡绑定流程'}已启动: ${selectedCardName} (${state.currentHaikaBindBatchId || 'no-batch-id'})`);
                } else {
                    elements.haikaBindStartBtn.disabled = false;
                    elements.haikaBindStartBtn.textContent = '开始绑定';
                    utils.showMessage(`海卡绑定启动失败: ${result?.error || '未知错误'}`, 'error', elements);
                }
            } catch (error) {
                elements.haikaBindStartBtn.disabled = false;
                elements.haikaBindStartBtn.textContent = '开始绑定';
                utils.showMessage(`海卡绑定异常: ${error.message}`, 'error', elements);
            }
        }

    return {
            loadHaikaBindAccountControls,
            saveHaikaBindAccountControls,
            isHaikaBindingTask,
            updateHaikaBindAccountFilterOptions,
            updateHaikaBindAccountControls,
            getHaikaBindBrowserConfig,
            getHaikaBindAccountConfig,
            stopHaikaBinding,
            loadHaikaCategories,
            getSelectedHaikaCategory,
            setSelectedHaikaCategory,
            syncHaikaImportTargetCategory,
            loadHaikaKeys,
            createHaikaCategory,
            openHaikaCategoryModal,
            closeHaikaCategoryModal,
            confirmHaikaImport,
            setTrialField,
            extractHaikaBindingResponse,
            formatHaikaExpiryDate,
            clearTrialInfo,
            setTrialStatus,
            applyTrialBindingView,
            renderTrialResult,
            loadHaikaTrialState,
            refreshTrialSmsCode,
            redeemTrialBinding,
            showHaikaSuggestions,
            clearHaikaSuggestions,
            startHaikaBinding
    };
};
