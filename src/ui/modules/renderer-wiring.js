/**
 * 渲染层 wiring 模块
 *
 * 这里承载事件绑定、IPC 监听、测试流程和初始化编排，
 * 让 renderer-core.js 只保留共享状态和核心工具。
 */
const createTaskProgressHandlers = require('./task-progress/handlers');
const createRendererWiringIpc = require('./renderer-wiring-ipc');
const createRendererWiringEvents = require('./renderer-wiring-events');

module.exports = function createRendererWiring(deps) {
    const state = deps;
    const {
        elements,
        cardManager,
        cookieManager,
        cookieTester,
        clashManager,
        utils,
        logger,
        ipcRenderer,
        loadCookies,
        loadEmailConfig,
        saveEmailConfig,
        loadTcpServerConfig,
        saveTcpServerConfig,
        loadApiServerConfig,
        loadAiAssistantConfig,
        saveExecutionControls,
        loadExecutionControls,
        saveExecutionUploadControls,
        loadExecutionUploadControls,
        updateExecutionUploadStatus,
        updateBrowserSettings,
        detectBrowserForSelect,
        setRunMode,
        DEFAULT_REGISTRATION_RUN_MODE,
        loadHaikaBindAccountControls,
        saveHaikaBindAccountControls,
        updateHaikaBindAccountControls,
        startHaikaBinding,
        stopHaikaBinding,
        startExecution,
        stopExecution,
        parseCookieAccountInfo,
        hideCookieAccountContextMenu,
        hideCookieBatchContextMenu,
        showCookieAccountContextMenu,
        showCookieBatchContextMenu,
        updateCookieSelectionButton,
        redeemTrialBinding,
        openHaikaCategoryModal,
        refreshTrialSmsCode,
        loadHaikaCategories,
        getSelectedHaikaCategory,
        createHaikaCategory,
        setSelectedHaikaCategory,
        syncHaikaImportTargetCategory,
        loadHaikaKeys,
        showHaikaSuggestions,
        clearHaikaSuggestions,
        confirmHaikaImport,
        closeHaikaCategoryModal,
        loadHaikaTrialState,
        clearTrialInfo,
        setTrialStatus,
        setupConsole,
        uploadRegisteredCookie
    } = deps;

    function getActiveClashBrowserSettingsPatch() {
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

    function formatTcpEndpointLabel(endpoint = null) {
        if (!endpoint || typeof endpoint !== 'object') {
            return '';
        }

        const host = String(endpoint.host || '').trim();
        const port = Number.parseInt(endpoint.port, 10);
        if (host && Number.isFinite(port) && port > 0) {
            return `${host}:${port}`;
        }

        const url = String(endpoint.url || '').trim();
        if (!url) {
            return '';
        }

        try {
            const parsed = new URL(url.includes('://') ? url : `http://${url}`);
            const parsedHost = parsed.hostname || '';
            const parsedPort = Number.parseInt(parsed.port, 10);
            return parsedHost && Number.isFinite(parsedPort) && parsedPort > 0
                ? `${parsedHost}:${parsedPort}`
                : parsedHost || url;
        } catch (_) {
            return url;
        }
    }

    function getTcpConnectionConsoleElement() {
        return elements.tcpConnectionConsoleOutput || null;
    }

    function clearTcpConnectionConsole() {
        const consoleElement = getTcpConnectionConsoleElement();
        if (consoleElement) {
            consoleElement.innerHTML = '';
        }
        state.lastTcpConnectionConsoleSignature = '';
    }

    function buildTcpConnectionConsoleSignature() {
        const connectionStatus = state.executionTcpConnectionStatus || {};
        const endpointLabel = formatTcpEndpointLabel(state.executionTcpEndpoint);
        const failedTopics = Array.isArray(connectionStatus?.subscribeResult?.failedTopics)
            ? connectionStatus.subscribeResult.failedTopics
            : [];

        return [
            state.executionTcpEnabled === true ? 'enabled' : 'disabled',
            connectionStatus.connected === true ? 'connected' : 'disconnected',
            state.executionTcpControlLocked === true ? 'locked' : 'unlocked',
            state.executionTcpReconnectEnabled !== false ? 'reconnect-on' : 'reconnect-off',
            endpointLabel || '',
            connectionStatus.lastConnectError || '',
            connectionStatus.statusCode || 0,
            failedTopics.map((item) => `${item.topic || ''}:${item.error || ''}`).join('|')
        ].join('||');
    }

    function logTcpConnectionConsoleState() {
        const signature = buildTcpConnectionConsoleSignature();
        if (signature === state.lastTcpConnectionConsoleSignature) {
            return;
        }

        state.lastTcpConnectionConsoleSignature = signature;

        const connectionStatus = state.executionTcpConnectionStatus || {};
        const endpointLabel = formatTcpEndpointLabel(state.executionTcpEndpoint) || '未配置';
        const reconnectText = state.executionTcpReconnectEnabled !== false ? '开启' : '关闭';
        const lockText = state.executionTcpControlLocked === true ? '服务器锁定' : '本地可编辑';
        const statusText = state.executionTcpEnabled === true
            ? (connectionStatus.connected === true
                ? '已连接'
                : `未连接${connectionStatus.lastConnectError ? `（${connectionStatus.lastConnectError}）` : ''}`)
            : '未启用';

        const consoleLevel = connectionStatus.connected === true
            ? 'info'
            : (connectionStatus.lastConnectError ? 'warning' : 'info');
        appendTcpConnectionConsoleLine(
            consoleLevel,
            '状态',
            `${statusText}，地址: ${endpointLabel}，自动重连: ${reconnectText}，控制: ${lockText}`
        );
    }

    function appendTcpConnectionConsoleLine(level, title, message, detail = '') {
        const consoleElement = getTcpConnectionConsoleElement();
        if (!consoleElement) {
            return;
        }

        const line = document.createElement('div');
        const normalizedLevel = ['debug', 'info', 'warning', 'error', 'critical'].includes(level)
            ? level
            : 'info';
        line.className = `console-line console-line--${normalizedLevel}`;

        const header = document.createElement('div');
        header.className = 'console-line__header';

        const meta = document.createElement('span');
        meta.className = 'console-line__meta';
        meta.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });

        const badge = document.createElement('span');
        badge.className = 'console-line__badge';
        badge.textContent = String(title || 'TCP').trim() || 'TCP';

        header.appendChild(meta);
        header.appendChild(badge);

        const body = document.createElement('div');
        body.className = 'console-line__body';
        body.textContent = String(message || '').trim() || '无内容';

        line.appendChild(header);
        line.appendChild(body);

        if (detail) {
            const detailNode = document.createElement('div');
            detailNode.className = 'console-line__detail';
            detailNode.textContent = String(detail);
            line.appendChild(detailNode);
        }

        consoleElement.appendChild(line);
        while (consoleElement.children.length > 200) {
            consoleElement.removeChild(consoleElement.firstElementChild);
        }
        consoleElement.scrollTop = consoleElement.scrollHeight;
    }

    function setStatusText(element, enabled, text, fallbackClass = 'mqtt-status-neutral') {
        if (!element) {
            return;
        }

        element.textContent = text;
        element.classList.remove('mqtt-status-success', 'mqtt-status-error', 'mqtt-status-neutral');
        element.classList.add(enabled === true ? 'mqtt-status-success' : enabled === false ? 'mqtt-status-error' : fallbackClass);
    }

    async function refreshTcpConnectionRuntimeState() {
        try {
            const result = await ipcRenderer.invoke('get-app-runtime-info');
            if (!result || result.success !== true) {
                return false;
            }

            state.executionTcpEnabled = result.executionTcpEnabled === true;
            state.executionTcpControlLocked = result.executionTcpControlLocked === true;
            state.executionTcpControlState = result.executionTcpControlState || {};
            state.executionTcpEndpoint = result.executionTcpEndpoint || null;
            state.executionTcpReconnectEnabled = result.executionTcpReconnectEnabled !== false;
            state.executionTcpConnectionStatus = result.executionTcpConnectionStatus || null;
            state.licenseUsageLocked = result.licenseUsageSnapshot?.unlimited === true
                ? false
                : result.licenseUsageLocked === true;
            state.licenseUsageSnapshot = result.licenseUsageSnapshot || null;
            if (cardManager && typeof cardManager.setExecutionCardAccessMode === 'function') {
                cardManager.setExecutionCardAccessMode(result.licenseUsageSnapshot?.unlimited === true ? 'all' : 'restricted');
            }
            updateTcpConnectionPanelState();
            updateLicenseUsageStatusText();
            if (typeof state.applyLimitedLicenseBrowserConstraints === 'function' && state.applyLimitedLicenseBrowserConstraints()) {
                await updateBrowserSettings();
            }
            applyTcpManagedUiLockdown();
            return true;
        } catch (error) {
            logger.warning(`刷新TCP状态失败: ${error.message}`);
            appendTcpConnectionConsoleLine('error', '刷新失败', `刷新TCP状态失败: ${error.message}`);
            return false;
        }
    }

    function updateTcpConnectionPanelState() {
        const endpointLabel = formatTcpEndpointLabel(state.executionTcpEndpoint);
        const connectionStatus = state.executionTcpConnectionStatus || {};
        const subscribeResult = connectionStatus.subscribeResult || {};
        const enabled = state.executionTcpEnabled === true;
        const connected = connectionStatus.connected === true;
        const subscribedOk = enabled && connected && subscribeResult.success !== false && (Array.isArray(subscribeResult.failedTopics) ? subscribeResult.failedTopics.length === 0 : true);
        const reconnectEnabled = state.executionTcpReconnectEnabled !== false;
        const locked = state.executionTcpControlLocked === true;

        setStatusText(
            elements.mqttConnectionEnabled,
            enabled,
            enabled ? '已启用' : '未启用'
        );
        setStatusText(
            elements.mqttConnectionConnected,
            connected,
            connected ? '已连接' : (connectionStatus.lastConnectError ? `失败: ${connectionStatus.lastConnectError}` : '未连接')
        );
        setStatusText(
            elements.mqttConnectionSubscribed,
            subscribedOk,
            subscribedOk
                ? '已连通'
                : ((subscribeResult.failedTopics || []).length > 0
                    ? `失败: ${(subscribeResult.failedTopics || []).map(item => item.topic).join(', ')}`
                    : '未连通')
        );
        setStatusText(
            elements.mqttConnectionReconnect,
            reconnectEnabled,
            reconnectEnabled ? '开启' : '关闭'
        );
        setStatusText(
            elements.mqttConnectionLocked,
            !locked,
            locked ? '服务器锁定' : '本地可编辑'
        );

        if (elements.mqttConnectionEndpoint) {
            elements.mqttConnectionEndpoint.textContent = endpointLabel || '未配置';
            elements.mqttConnectionEndpoint.classList.remove('mqtt-status-success', 'mqtt-status-error', 'mqtt-status-neutral');
            elements.mqttConnectionEndpoint.classList.add(endpointLabel ? 'mqtt-status-success' : 'mqtt-status-neutral');
        }

        logTcpConnectionConsoleState();
    }

    function applyTcpManagedUiLockdown() {
        if (typeof document === 'undefined') {
            return;
        }

        const locked = state.executionTcpControlLocked === true || state.licenseUsageLocked === true;
        if (document.body) {
            document.body.classList.toggle('tcp-managed-mode', state.executionTcpControlLocked === true);
            document.body.classList.toggle('license-usage-locked', state.licenseUsageLocked === true);
        }

        const selector = '.content-area button, .content-area input, .content-area select, .content-area textarea';
        document.querySelectorAll(selector).forEach((element) => {
            if (!element || typeof element.disabled === 'undefined') {
                return;
            }

            if (element.classList.contains('tab-header') || element.classList.contains('right-tab-header')) {
                return;
            }

            if (element.id === 'exit-app-btn') {
                return;
            }

            if (element.id === 'start-btn' || element.id === 'stop-btn') {
                return;
            }

            if (element.classList.contains('run-mode-btn')) {
                return;
            }

            if (element.closest && element.closest('#execution-browser-settings-section')) {
                return;
            }

            element.disabled = locked;
        });
    }

    function updateLicenseUsageStatusText() {
        if (!elements.statusLabel) {
            return;
        }

        const snapshot = state.licenseUsageSnapshot || {};
        const summaryText = String(snapshot.summaryText || '').trim();
        const remainingText = String(snapshot.remainingText || '').trim();
        const titleUsageText = snapshot.unlimited === true
            ? '剩余次数：无限次'
            : remainingText
                ? `剩余次数：${remainingText}${/^\d+(?:\.\d+)?$/.test(remainingText) ? ' 次' : ''}`
                : summaryText
                    ? `剩余次数：${summaryText}`
                    : '剩余次数：未获取';
        const buttonUsageText = snapshot.unlimited === true
            ? '无限次'
            : remainingText
                ? `${remainingText}${/^\d+(?:\.\d+)?$/.test(remainingText) ? ' 次' : ''}`
                : summaryText || '未获取';

        if (elements.licenseUsageLabel) {
            elements.licenseUsageLabel.textContent = titleUsageText;
        }

        if (state.licenseUsageLocked === true) {
            elements.statusLabel.textContent = '次数锁定';
            updateExecutionStartButtonText(buttonUsageText);
            return;
        }

        const currentText = String(elements.statusLabel.textContent || '').trim();
        if (currentText === '次数锁定' || currentText.startsWith('次数锁定:')) {
            elements.statusLabel.textContent = '就绪';
        }

        updateExecutionStartButtonText(buttonUsageText);
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('license-usage-updated', async () => {
            try {
                await refreshTcpConnectionRuntimeState();
            } catch (error) {
                logger.warning(`刷新卡密次数状态失败: ${error.message}`);
            }
        });
    }

    function updateExecutionStartButtonText(usageText = '') {
        if (!elements.startBtn) {
            return;
        }

        const fallbackText = '开始执行';
        const normalizedUsageText = String(usageText || '').trim();
        if (!normalizedUsageText || normalizedUsageText === '未获取' || normalizedUsageText === '无限次') {
            elements.startBtn.textContent = fallbackText;
            return;
        }

        if (/^剩余/.test(normalizedUsageText) || /无限次$/.test(normalizedUsageText)) {
            elements.startBtn.textContent = `${fallbackText}（${normalizedUsageText}）`;
            return;
        }

        elements.startBtn.textContent = `${fallbackText}（剩余 ${normalizedUsageText}）`;
    }

    function ensureTcpManagedUiObserver() {
        if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
            return;
        }

        if (state.executionTcpControlLocked !== true) {
            if (state.tcpManagedUiObserver) {
                try {
                    state.tcpManagedUiObserver.disconnect();
                } catch (_) {}
                state.tcpManagedUiObserver = null;
            }
            return;
        }

        if (state.tcpManagedUiObserver) {
            return;
        }

        const target = document.querySelector('.content-area') || document.body;
        if (!target) {
            return;
        }

        state.tcpManagedUiObserver = new MutationObserver(() => {
            applyTcpManagedUiLockdown();
        });
        state.tcpManagedUiObserver.observe(target, {
            childList: true,
            subtree: true
        });
    }

    async function initializeAppRuntimeMode() {
        try {
            const result = await ipcRenderer.invoke('get-app-runtime-info');
            if (!result || result.success !== true) {
                return;
            }

            const runtime = {
                startupMode: String(result.startupMode || '').trim() || 'local',
                executionMode: String(result.executionMode || '').trim() || 'standalone',
                executionEmbedded: result.executionEmbedded === true || result.webControlEmbedded === true,
                executionHostApp: String(result.executionHostApp || result.webControlHostApp || '').trim(),
                webControlEnabled: result.webControlEnabled === true,
                webControlHeadless: result.webControlHeadless === true,
                webControlEmbedded: result.webControlEmbedded === true,
                webControlHostApp: String(result.webControlHostApp || '').trim(),
                webControlUrl: String(result.webControlUrl || '').trim()
            };

            state.executionRuntime = runtime;
            state.executionMode = runtime.executionMode;
            state.executionEmbedded = runtime.executionEmbedded === true;
            state.executionHostApp = runtime.executionHostApp;
            state.webControlUrl = runtime.webControlUrl;
            state.tcpManagedMode = false;
            state.executionTcpEnabled = result.executionTcpEnabled === true;
            state.executionTcpControlLocked = result.executionTcpControlLocked === true;
            state.executionTcpControlState = result.executionTcpControlState || {};
            state.executionTcpEndpoint = result.executionTcpEndpoint || null;
            state.executionTcpReconnectEnabled = result.executionTcpReconnectEnabled !== false;
            state.executionTcpConnectionStatus = result.executionTcpConnectionStatus || null;
            state.licenseUsageLocked = result.licenseUsageSnapshot?.unlimited === true
                ? false
                : result.licenseUsageLocked === true;
            state.licenseUsageSnapshot = result.licenseUsageSnapshot || null;
            if (cardManager && typeof cardManager.setExecutionCardAccessMode === 'function') {
                cardManager.setExecutionCardAccessMode(result.licenseUsageSnapshot?.unlimited === true ? 'all' : 'restricted');
            }
            cardManager.setCardControlMode('local');

            if (document.documentElement) {
                document.documentElement.dataset.executionMode = runtime.executionMode;
                document.documentElement.dataset.executionEmbedded = runtime.executionEmbedded ? 'true' : 'false';
                document.documentElement.dataset.executionHostApp = runtime.executionHostApp || '';
            }
            if (document.body) {
                document.body.dataset.executionMode = runtime.executionMode;
                document.body.dataset.executionEmbedded = runtime.executionEmbedded ? 'true' : 'false';
                document.body.classList.toggle('execution-embedded', runtime.executionEmbedded === true);
                document.body.classList.toggle('execution-standalone', runtime.executionEmbedded !== true);
            }

            if (elements.exitAppBtn) {
                if (runtime.executionEmbedded) {
                    elements.exitAppBtn.textContent = '关闭标签';
                    elements.exitAppBtn.title = '嵌入模式下由宿主接管关闭';
                    elements.exitAppBtn.setAttribute('aria-label', '关闭当前标签页');
                } else {
                    elements.exitAppBtn.textContent = '退出';
                    elements.exitAppBtn.title = '退出应用';
                    elements.exitAppBtn.setAttribute('aria-label', '退出应用');
                }
            }

            if (elements.themeToggleBtn) {
                elements.themeToggleBtn.title = runtime.executionEmbedded
                    ? '切换深色浅色模式'
                    : '切换到深色模式';
            }

            if (result.executionTcpControlLocked) {
                logger.info('TCP 连接已启用，当前由服务器控制状态锁定');
            } else if (result.executionTcpEnabled) {
                logger.info('TCP 连接已启用，本地功能保持可用');
            }

            updateTcpConnectionPanelState();
            updateLicenseUsageStatusText();
            if (typeof state.applyLimitedLicenseBrowserConstraints === 'function' && state.applyLimitedLicenseBrowserConstraints()) {
                await updateBrowserSettings();
            }

            if (elements.openCookieFolderBtn) {
                elements.openCookieFolderBtn.disabled = false;
                elements.openCookieFolderBtn.title = '打开Cookie文件夹';
            }

            applyTcpManagedUiLockdown();
            ensureTcpManagedUiObserver();
        } catch (error) {
            logger.warning(`读取应用运行模式失败: ${error.message}`);
        }
    }

    async function syncExecutionCardStateFromServer(cardMode = 'automation') {
        const mode = cardMode === 'test' || cardMode === 'haikaBind' ? cardMode : 'automation';

        if (!state.executionTcpEnabled) {
            return false;
        }

        try {
            const result = await ipcRenderer.invoke('get-execution-ui-state', {
                card_type: mode,
                log_limit: 200
            });

            if (!result || result.success !== true) {
                throw new Error(result?.error || '获取自动化卡片状态失败');
            }

            const snapshot = result || {};
            const cards = Array.isArray(snapshot.cards) ? snapshot.cards : null;
            const currentCardName = String(
                snapshot.current_card_name
                || snapshot.currentCardName
                || snapshot.currentCard
                || ''
            ).trim();
            const loadEvent = mode === 'test'
                ? 'test-cards-loaded'
                : mode === 'haikaBind'
                    ? 'haika-bind-cards-loaded'
                    : 'cards-loaded';

            if (mode === 'test') {
                cardManager.setCurrentTestCard(currentCardName || null);
                state.currentTestCard = currentCardName || null;
            } else if (mode === 'haikaBind') {
                cardManager.setCurrentHaikaBindCard(currentCardName || null);
                state.currentHaikaBindCard = currentCardName || null;
            } else {
                cardManager.setCurrentCard(currentCardName || null);
                state.currentCard = currentCardName || null;
            }

            if (Array.isArray(cards)) {
                window.dispatchEvent(new CustomEvent(loadEvent, { detail: cards }));
            }

            if (mode === 'automation') {
                if (elements.startBtn) {
                    elements.startBtn.disabled = !currentCardName;
                }
                if (elements.statusLabel) {
                    elements.statusLabel.textContent = currentCardName ? `已选择卡片: ${currentCardName}` : '未选择卡片';
                }
                await loadCookies();
            }

            logger.info(
                `已同步${mode === 'automation' ? '自动化' : mode === 'test' ? '测试' : '海卡绑定'}状态${Array.isArray(cards) ? `: ${cards.length} 个卡片` : ''}${currentCardName ? `，当前卡片: ${currentCardName}` : ''}`
            );
            return true;
        } catch (error) {
            logger.warning(`同步${mode === 'automation' ? '自动化' : mode === 'test' ? '测试' : '海卡绑定'}卡片失败: ${error.message}`);
            return false;
        }
    }

    async function handleTcpSettingsSave() {
        if (!elements.tcpSettingsSaveBtn) {
            return;
        }

        const saveButton = elements.tcpSettingsSaveBtn;
        const originalText = saveButton.textContent;
        saveButton.disabled = true;
        saveButton.textContent = '保存中...';

        try {
            const result = await saveTcpServerConfig();
            if (result && result.success) {
                await loadTcpServerConfig();
                await refreshTcpConnectionRuntimeState();

                const savedAddress = result.tcpServerUrl || elements.tcpServerUrl?.value || '未配置';
                if (result.tcpRestartError) {
                    logger.warning(`TCP服务器地址已保存，但重新连接失败: ${result.tcpRestartError}`);
                    utils.showMessage(`TCP服务器地址已保存，但重新连接失败: ${result.tcpRestartError}`, 'warning', elements);
                } else {
                    const message = `TCP配置已保存地址${savedAddress}`;
                    logger.info(message);
                    utils.showMessage(message, 'success', elements);
                }
                return;
            }

            const error = result?.error || '保存失败';
            utils.showMessage(`保存TCP服务器地址失败: ${error}`, 'error', elements);
        } finally {
            saveButton.disabled = false;
            saveButton.textContent = originalText;
        }
    }

    async function openProxyQuickSite(url, button, label) {
        if (!button) {
            return;
        }

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = '打开中...';

        try {
            const result = await ipcRenderer.invoke('open-browser-url', {
                url,
                browserType: elements.browserType ? String(elements.browserType.value || '').trim() : 'electron'
            });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '打开失败');
            }

            const targetLabel = label || result.url || url;
            if (result.warning) {
                logger.warning(`已在浏览器中打开 ${targetLabel}，但页面加载失败: ${result.warning}`);
                utils.showMessage(`已打开 ${targetLabel}，但页面加载失败: ${result.warning}`, 'warning', elements);
            } else {
                logger.info(`已在浏览器中打开 ${targetLabel}`);
                utils.showMessage(`已在浏览器中打开 ${targetLabel}`, 'success', elements);
            }
        } catch (error) {
            logger.error(`打开 ${label || url} 失败: ${error.message}`);
            utils.showMessage(`打开 ${label || url} 失败: ${error.message}`, 'error', elements);
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    const DRAWER_LAYOUT_STORAGE_KEY = 'ui-panel-drawer-state';

    function normalizeDrawerState(rawState) {
        return {
            leftCollapsed: rawState && rawState.leftCollapsed === true,
            rightCollapsed: rawState && rawState.rightCollapsed === true
        };
    }

    function loadDrawerState() {
        try {
            const raw = localStorage.getItem(DRAWER_LAYOUT_STORAGE_KEY);
            if (!raw) {
                return { leftCollapsed: false, rightCollapsed: false };
            }
            return normalizeDrawerState(JSON.parse(raw));
        } catch (_) {
            return { leftCollapsed: false, rightCollapsed: false };
        }
    }

    function saveDrawerState(drawerState) {
        try {
            localStorage.setItem(DRAWER_LAYOUT_STORAGE_KEY, JSON.stringify(normalizeDrawerState(drawerState)));
        } catch (_) {
            // 忽略本地存储不可用的情况
        }
    }

    function setDrawerBubbleState(button, visible, label) {
        if (!button) {
            return;
        }

        const isVisible = visible === true;
        button.hidden = !isVisible;
        button.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
        button.setAttribute('aria-label', label);
        button.title = label;
    }

    function applyDrawerLayout(drawerState, persist = true) {
        const normalized = normalizeDrawerState(drawerState);
        const mainContainer = elements.mainContainer;
        const leftPanel = elements.leftPanel;
        const rightPanel = elements.rightPanel;

        if (mainContainer) {
            mainContainer.classList.toggle('drawer-left-collapsed', normalized.leftCollapsed);
            mainContainer.classList.toggle('drawer-right-collapsed', normalized.rightCollapsed);
        }

        if (leftPanel) {
            leftPanel.setAttribute('aria-hidden', normalized.leftCollapsed ? 'true' : 'false');
            leftPanel.inert = normalized.leftCollapsed;
        }

        if (rightPanel) {
            rightPanel.setAttribute('aria-hidden', normalized.rightCollapsed ? 'true' : 'false');
            rightPanel.inert = normalized.rightCollapsed;
        }

        setDrawerBubbleState(
            elements.leftDrawerBubble,
            normalized.leftCollapsed,
            '展开左侧面板'
        );
        setDrawerBubbleState(
            elements.rightDrawerBubble,
            normalized.rightCollapsed,
            '展开右侧面板'
        );

        if (persist) {
            saveDrawerState(normalized);
        }
    }

    function toggleLeftDrawer() {
        const current = loadDrawerState();
        applyDrawerLayout({
            leftCollapsed: !current.leftCollapsed,
            rightCollapsed: current.rightCollapsed
        });
    }

    function toggleRightDrawer() {
        const current = loadDrawerState();
        applyDrawerLayout({
            leftCollapsed: current.leftCollapsed,
            rightCollapsed: !current.rightCollapsed
        });
    }

    function activateMiddleTab(targetTab) {
        const buttons = elements.middleTabButtons;
        const contents = elements.middleTabContents;

        if (!buttons || !contents) {
            return;
        }

        buttons.forEach((button) => {
            const isActive = button.dataset.tab === targetTab;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        contents.forEach((content) => {
            const isActive = content.id === targetTab;
            content.classList.toggle('active', isActive);
            content.style.display = isActive ? '' : 'none';
        });
    }
    const taskProgress = createTaskProgressHandlers({
        elements,
        state,
        utils,
        logger,
        activateMiddleTab,
        addTaskProgress: deps.addTaskProgress,
        appendTaskHistory: deps.appendTaskHistory,
        clearTaskHistory: deps.clearTaskHistory,
        openTaskHistoryDialog: deps.openTaskHistoryDialog,
        updateTaskProgress: deps.updateTaskProgress,
        finishTaskProgress: deps.finishTaskProgress,
        setTaskHistoryCollapsed: deps.setTaskHistoryCollapsed,
        toggleTaskHistory: deps.toggleTaskHistory
    });
    const wiringIpc = createRendererWiringIpc({
        ...deps,
        taskProgress
    });
    const wiringEvents = createRendererWiringEvents({
        ...deps,
        activateUploadMode: utils.activateUploadMode,
        taskProgress,
        getActiveClashBrowserSettingsPatch,
        handleTcpSettingsSave,
        clearTcpConnectionConsole,
        loadDrawerState,
        applyDrawerLayout,
        toggleLeftDrawer,
        toggleRightDrawer,
        activateMiddleTab,
        openProxyQuickSite,
        initializeAppRuntimeMode,
        syncExecutionCardStateFromServer,
        updateTcpConnectionPanelState,
        refreshClashStatus: (elementsArg, showError, updateProfileSelect, loadNodes, log) =>
            clashManager.refreshClashStatus(elementsArg, showError, updateProfileSelect, loadNodes, log)
    });
    const {
        setupIPCHandlers,
        handlePointsCookieTest
    } = wiringIpc;
    const { setupEventListeners } = wiringEvents;

    // 这里沿用显式依赖注入，尽量让搬迁过来的逻辑保持原样，减少二次改动面
    // ==================== 设置事件监听器 ====================
// ==================== 全局函数（用于HTML中的onclick） ====================
window.deleteCookie = async function(email) {
    await cookieManager.deleteCookie(email, loadCookies, (msg, type) => utils.showMessage(msg, type, elements));
};

window.testCookieGlobal = async function(buttonOrEmail, emailOrTestCard, testWithCardNameOrOriginalCard, originalCardNameMaybe) {
    const hasButtonElement = buttonOrEmail && typeof buttonOrEmail === 'object' && buttonOrEmail.nodeType === 1;
    const button = hasButtonElement ? buttonOrEmail : null;
    const email = hasButtonElement
        ? String(button.dataset.cookieEmail || '').trim()
        : String(buttonOrEmail || '').trim();
    const testWithCardName = hasButtonElement
        ? String(button.dataset.cookieTestCard || '').trim()
        : String(emailOrTestCard || '').trim();
    const originalCardName = hasButtonElement
        ? String(button.dataset.cookieOriginalCard || '').trim()
        : String(testWithCardNameOrOriginalCard || '').trim();
    const currentTestCard = cardManager.getCurrentTestCard();
    const actionKey = button && button.dataset && String(button.dataset.cookieTestKey || '').trim();
    const currentState = actionKey && typeof cookieManager.getCookieTestActionState === 'function'
        ? cookieManager.getCookieTestActionState(actionKey)
        : null;

    if (button && typeof button.disabled === 'boolean') {
        button.disabled = true;
        button.textContent = currentState ? '刷新中...' : '测试中...';
    }

    try {
        if (currentState && currentState.browserId) {
            const result = await ipcRenderer.invoke('refresh-cookie-preview', {
                email,
                testWithCardName: currentTestCard || testWithCardName,
                originalCardName
            });

            if (!result || result.success !== true) {
                if (actionKey && typeof cookieManager.clearCookieTestActionState === 'function') {
                    cookieManager.clearCookieTestActionState(actionKey);
                }
                if (button) {
                    button.textContent = '测试账号';
                }
                throw new Error(result?.error || '刷新 Cookie 失败');
            }

            if (actionKey && typeof cookieManager.clearCookieTestActionState === 'function') {
                cookieManager.clearCookieTestActionState(actionKey);
            }
            if (button) {
                button.textContent = '测试账号';
            }

            return;
        }

        if (!currentTestCard) {
            utils.showMessage('请先选择一个测试卡片', 'warning', elements);
            return;
        }

        const result = await ipcRenderer.invoke('preview-cookie', {
            email,
            testWithCardName: currentTestCard || testWithCardName,
            originalCardName
        });
        if (!result || result.success !== true) {
            throw new Error(result?.error || '打开浏览器失败');
        }

        if (actionKey && typeof cookieManager.setCookieTestActionState === 'function') {
            cookieManager.setCookieTestActionState(actionKey, {
                browserId: result.browserId || '',
                status: 'ready'
            });
        }

        if (button) {
            button.textContent = '刷新';
        }
    } finally {
        if (button) {
            button.disabled = false;
        }
    }
};

// 挂载积分测试函数到全局
window.handlePointsCookieTest = handlePointsCookieTest;

window.selectClashNodeGlobal = function(nodeName) {
    clashManager.selectClashNode(nodeName, elements);
};

// ==================== 初始化应用 ====================
    document.addEventListener('DOMContentLoaded', async () => {
        if (typeof state.getStoredTheme === 'function' && typeof state.applyTheme === 'function') {
            state.applyTheme(state.getStoredTheme());
        }

        if (typeof utils.activateUploadMode === 'function') {
            utils.activateUploadMode('tcp');
        }

        if (elements.themeToggleBtn && typeof state.toggleTheme === 'function') {
            elements.themeToggleBtn.addEventListener('click', () => {
                state.toggleTheme();
            });
        }

        await initializeAppRuntimeMode();
        setupEventListeners();
        setupIPCHandlers();
        setupConsole();

        const initialRegisterCards = await cardManager.loadCards({ forceReload: true });
        if (Array.isArray(initialRegisterCards)) {
            cardManager.renderCardList(initialRegisterCards, elements, (cardName) => {
                cardManager.setCurrentCard(cardName);
                state.currentCard = cardName;
                loadCookies();
            }, 'automation');
        }

        loadCookies();
        applyTcpManagedUiLockdown();
        ensureTcpManagedUiObserver();

        if (state.executionTcpEnabled) {
            void syncExecutionCardStateFromServer('automation');
        }
        
        if (elements.emailHost) {
            elements.emailHost.addEventListener('blur', saveEmailConfig);
        }
        if (elements.emailPort) {
            elements.emailPort.addEventListener('blur', saveEmailConfig);
        }
        if (elements.emailSuffix) {
            elements.emailSuffix.addEventListener('blur', saveEmailConfig);
        }
        if (elements.emailRandomLength) {
            elements.emailRandomLength.addEventListener('change', saveEmailConfig);
            elements.emailRandomLength.addEventListener('blur', saveEmailConfig);
        }
        if (elements.emailRandomType) {
            elements.emailRandomType.addEventListener('change', saveEmailConfig);
        }

        if (elements.proxyRecoveryAttempts) {
            elements.proxyRecoveryAttempts.addEventListener('change', saveExecutionControls);
            elements.proxyRecoveryAttempts.addEventListener('blur', saveExecutionControls);
        }
        if (elements.executionTimedCount) {
            elements.executionTimedCount.addEventListener('change', saveExecutionControls);
            elements.executionTimedCount.addEventListener('blur', saveExecutionControls);
        }
        if (elements.executionTimedCycleCount) {
            elements.executionTimedCycleCount.addEventListener('change', saveExecutionControls);
            elements.executionTimedCycleCount.addEventListener('blur', saveExecutionControls);
        }
        if (elements.executionTimedStartMode) {
            elements.executionTimedStartMode.addEventListener('change', saveExecutionControls);
        }
        if (elements.executionTimedDelaySeconds) {
            elements.executionTimedDelaySeconds.addEventListener('change', saveExecutionControls);
            elements.executionTimedDelaySeconds.addEventListener('blur', saveExecutionControls);
        }
        if (elements.concurrentCount) {
            elements.concurrentCount.addEventListener('change', saveExecutionControls);
            elements.concurrentCount.addEventListener('blur', saveExecutionControls);
        }
        if (elements.syncExecution) {
            elements.syncExecution.addEventListener('change', saveExecutionControls);
        }
        if (elements.executionAutoUpload) {
            elements.executionAutoUpload.addEventListener('change', () => {
                saveExecutionUploadControls();
                updateExecutionUploadStatus(
                    elements.executionAutoUpload.checked ? '自动上传已开启' : '自动上传已关闭',
                    elements.executionAutoUpload.checked ? 'info' : 'warning'
                );
            });
        }
        if (elements.executionSaveLocalCookie) {
            elements.executionSaveLocalCookie.addEventListener('change', saveExecutionControls);
        }

        // 加载Cookie测试配置
        cookieTester.loadCookieTestConfig(elements);

        if (elements.trialResponseJson) {
            elements.trialResponseJson.textContent = '暂无结果';
        }
        if (elements.trialCacheTip) {
            elements.trialCacheTip.textContent = '仅用于接口测试';
        }
        clearTrialInfo();
        setTrialStatus('等待操作', 'neutral');
        loadHaikaTrialState();

        // 初始化 Clash 节点切换功能
        clashManager.initClashManager(() =>
            clashManager.refreshClashStatus(
                elements,
                clashManager.showClashError,
                clashManager.updateClashProfileSelect,
                clashManager.loadClashProfileNodes,
                logger
            ),
            elements,
            logger
        );

        // 把偏慢的配置加载都丢到后台，避免任意一个来源卡住整页初始化
        void (async () => {
            const startupSteps = [
                { name: '邮箱配置', run: () => loadEmailConfig() },
                { name: 'TCP配置', run: () => loadTcpServerConfig() },
                { name: 'API服务配置', run: () => loadApiServerConfig() },
                { name: 'AI助手配置', run: () => loadAiAssistantConfig() },
                { name: '执行控制', run: () => loadExecutionControls() },
                {
                    name: '执行上传配置',
                    run: () => loadExecutionUploadControls()
                },
                { name: '海卡绑定账号', run: () => loadHaikaBindAccountControls() },
                { name: '海卡分类', run: () => loadHaikaCategories() },
                {
                    name: '浏览器检测',
                    run: () => utils.autoDetectBrowsers(
                        elements,
                        logger,
                        utils.updateBrowserOptions,
                        updateBrowserSettings,
                        utils.addDefaultBrowserOptions
                    )
                }
            ];

            for (const step of startupSteps) {
                const startedAt = Date.now();
                try {
                    logger.info(`启动初始化: ${step.name}`);
                    await step.run();
                    logger.info(`启动初始化完成: ${step.name} (${Date.now() - startedAt}ms)`);
                } catch (error) {
                    logger.error(`启动初始化失败: ${step.name}: ${error.message}`);
                }
            }
        })();

});

};



