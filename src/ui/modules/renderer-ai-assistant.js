const { AI_ASSISTANT_CHANNELS } = require('../../core/ai/ai-channels');
const { extractOpenUrlRequest, BROWSER_OPEN_URL_CHANNEL } = require('../../core/ai/ai-navigation');
const {
    MAX_CHAT_HISTORY_MESSAGES,
    DEFAULT_CONVERSATION_TITLE,
    DEFAULT_AI_ASSISTANT_SYSTEM_PROMPT,
    AI_ASSISTANT_FUNCTION_PROFILES,
    DEFAULT_AI_ASSISTANT_PROFILE_ID,
    buildAiAssistantSystemPrompt
} = require('../../core/ai/ai-assistant-shared');

module.exports = function createRendererAiAssistant(deps) {
    const {
        elements,
        ipcRenderer,
        logger
    } = deps;

    const state = {
        savedConfig: {
            baseURL: '',
            model: '',
            hasApiKey: false,
            apiKeyMasked: '',
            activeProfileId: DEFAULT_AI_ASSISTANT_PROFILE_ID,
            activeProfileIds: [DEFAULT_AI_ASSISTANT_PROFILE_ID],
            activeProfile: null,
            activeProfiles: [],
            profiles: []
        },
        sessions: [],
        activeSessionId: '',
        messages: [],
        isSending: false,
        isHistoryMenuOpen: false,
        historyUpdateListenerBound: false,
        chatStreamListenerBound: false,
        activeChatRequestId: '',
        activeChatPlaceholderIndex: -1,
        promptExpanded: false,
        webControlApiBaseUrl: ''
    };

    function getChatList() {
        return elements.aiAssistantChatList || null;
    }

    function getHistoryToggleButton() {
        return elements.aiAssistantHistoryToggleBtn || null;
    }

    function getHistoryCurrentLabel() {
        return elements.aiAssistantHistoryCurrentLabel || null;
    }

    function getHistoryMenu() {
        return elements.aiAssistantHistoryMenu || null;
    }

    function getProfileListContainer() {
        return elements.aiAssistantConfigActiveProfiles || null;
    }

    function getAssistantPromptContent() {
        return buildAiAssistantSystemPrompt({
            basePrompt: DEFAULT_AI_ASSISTANT_SYSTEM_PROMPT,
            profileIds: state.savedConfig.activeProfileIds || state.savedConfig.activeProfileId
        });
    }

    function createConversationSession(overrides = {}) {
        const now = new Date().toISOString();
        return {
            id: String(overrides.id || `ai-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            title: String(overrides.title || DEFAULT_CONVERSATION_TITLE).trim() || DEFAULT_CONVERSATION_TITLE,
            createdAt: String(overrides.createdAt || '').trim() || now,
            updatedAt: String(overrides.updatedAt || '').trim() || now,
            messages: Array.isArray(overrides.messages) ? overrides.messages : []
        };
    }

    function normalizeConversationSession(session = {}, fallbackTitle = DEFAULT_CONVERSATION_TITLE) {
        const messages = Array.isArray(session.messages)
            ? session.messages.map((item) => ({
                role: String(item?.role || 'assistant'),
                content: String(item?.content || ''),
                time: String(item?.time || '').trim(),
                pending: false,
                error: item?.error === true,
                kind: String(item?.kind || '').trim(),
                uiExpanded: item?.uiExpanded === true
            }))
            : [];

        return createConversationSession({
            id: session.id,
            title: String(session.title || '').trim() || fallbackTitle,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messages
        });
    }

    function ensureActiveConversationSession() {
        if (!state.sessions.length) {
            const session = createConversationSession();
            state.sessions.push(session);
            state.activeSessionId = session.id;
            state.messages = session.messages;
            return session;
        }

        const activeSession = state.sessions.find((item) => item.id === state.activeSessionId) || state.sessions[0];
        state.activeSessionId = activeSession.id;
        state.messages = activeSession.messages;
        return activeSession;
    }

    function getActiveConversationSession() {
        return state.sessions.find((item) => item.id === state.activeSessionId) || state.sessions[0] || null;
    }

    function setActiveConversationSession(sessionId, options = {}) {
        const nextSession = state.sessions.find((item) => item.id === sessionId);
        if (!nextSession) {
            return null;
        }

        state.activeSessionId = nextSession.id;
        state.messages = nextSession.messages;
        renderChatMessages();
        refreshHistorySelect();
        adjustAiAssistantInputHeight();

        if (options.persist === true) {
            void persistChatHistory();
        }

        return nextSession;
    }

    function createBlankConversationSession(title = DEFAULT_CONVERSATION_TITLE) {
        return createConversationSession({ title, messages: [] });
    }

    function refreshHistorySelect() {
        const toggleBtn = getHistoryToggleButton();
        const currentLabel = getHistoryCurrentLabel();
        const menu = getHistoryMenu();
        if (!menu || !toggleBtn) {
            return;
        }

        const sortedSessions = [...state.sessions].sort((a, b) => {
            const aTime = Date.parse(a.updatedAt || a.createdAt || '') || 0;
            const bTime = Date.parse(b.updatedAt || b.createdAt || '') || 0;
            return bTime - aTime;
        });

        const activeSession = getActiveConversationSession();
        const activeLabel = activeSession?.title || DEFAULT_CONVERSATION_TITLE;
        if (currentLabel) {
            currentLabel.textContent = activeLabel;
        }
        toggleBtn.title = activeLabel;

        menu.innerHTML = '';

        if (sortedSessions.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ai-assistant-history-item';
            empty.textContent = '暂无历史会话';
            menu.appendChild(empty);
            return;
        }

        for (const session of sortedSessions) {
            const item = document.createElement('div');
            item.className = `ai-assistant-history-item${session.id === activeSession?.id ? ' is-active' : ''}`;

            const mainButton = document.createElement('button');
            mainButton.type = 'button';
            mainButton.className = 'ai-assistant-history-item__main';
            mainButton.dataset.sessionId = session.id;

            const title = document.createElement('div');
            title.className = 'ai-assistant-history-item__title';
            title.textContent = session.title || DEFAULT_CONVERSATION_TITLE;

            const meta = document.createElement('div');
            meta.className = 'ai-assistant-history-item__meta';
            const updatedText = session.updatedAt
                ? new Date(session.updatedAt).toLocaleString('zh-CN', { hour12: false })
                : '未保存';
            meta.textContent = `${session.messages.length} 条消息 · ${updatedText}`;

            mainButton.appendChild(title);
            mainButton.appendChild(meta);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'ai-assistant-history-delete-btn';
            deleteBtn.dataset.sessionId = session.id;
            deleteBtn.setAttribute('aria-label', `删除会话 ${session.title || DEFAULT_CONVERSATION_TITLE}`);
            deleteBtn.textContent = '×';

            item.appendChild(mainButton);
            item.appendChild(deleteBtn);
            menu.appendChild(item);
        }
    }

    function syncConversationHistory(history = {}) {
        const source = history && typeof history === 'object' ? history : {};
        const sessions = Array.isArray(source.sessions)
            ? source.sessions.map((session, index) => normalizeConversationSession(session, `${DEFAULT_CONVERSATION_TITLE} ${index + 1}`))
            : [];

        if (!sessions.length) {
            sessions.push(createBlankConversationSession());
        }

        state.sessions = sessions;
        state.activeSessionId = String(source.activeSessionId || sessions[0]?.id || '').trim() || sessions[0].id;
        const activeSession = getActiveConversationSession() || sessions[0];
        state.activeSessionId = activeSession.id;
        state.messages = activeSession.messages;

        refreshHistorySelect();
        renderChatMessages();
        adjustAiAssistantInputHeight();
    }

    function isActiveAiChatRequestInProgress() {
        return Boolean(state.activeChatRequestId) || state.isSending === true;
    }

    function openHistoryMenu() {
        const menu = getHistoryMenu();
        const toggleBtn = getHistoryToggleButton();
        if (!menu || !toggleBtn) {
            return;
        }

        state.isHistoryMenuOpen = true;
        menu.hidden = false;
        toggleBtn.setAttribute('aria-expanded', 'true');
    }

    function closeHistoryMenu() {
        const menu = getHistoryMenu();
        const toggleBtn = getHistoryToggleButton();
        if (!menu || !toggleBtn) {
            return;
        }

        state.isHistoryMenuOpen = false;
        menu.hidden = true;
        toggleBtn.setAttribute('aria-expanded', 'false');
    }

    function toggleHistoryMenu() {
        if (!getHistoryMenu()) {
            return;
        }

        if (!state.isHistoryMenuOpen) {
            openHistoryMenu();
        } else {
            closeHistoryMenu();
        }
    }

    async function deleteHistorySession(sessionId) {
        const targetId = String(sessionId || '').trim();
        if (!targetId) {
            return;
        }

        try {
            const result = await ipcRenderer.invoke(AI_ASSISTANT_CHANNELS.DELETE_HISTORY_SESSION, { sessionId: targetId });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '删除对话失败');
            }

            syncConversationHistory(result.history || {});
            return result;
        } catch (error) {
            logger.error(`删除 AI 对话失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async function persistChatHistory() {
        try {
            const result = await ipcRenderer.invoke(AI_ASSISTANT_CHANNELS.SAVE_HISTORY, {
                activeSessionId: state.activeSessionId,
                sessions: state.sessions.map((session) => ({
                    id: session.id,
                    title: session.title,
                    createdAt: session.createdAt,
                    updatedAt: session.updatedAt,
                    messages: Array.isArray(session.messages)
                        ? session.messages.filter((item) => !item.pending).map((item) => ({
                            role: item.role,
                            content: item.content,
                            time: item.time,
                            error: item.error === true
                        }))
                        : []
                }))
            });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '保存 AI 对话记录失败');
            }
            return result;
        } catch (error) {
            logger.error(`保存 AI 对话记录失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    function getConfigSnapshotFromForm() {
        const activeProfileIds = getSelectedProfileIds();
        return {
            baseURL: String(elements.aiAssistantConfigBaseUrl?.value || '').trim(),
            model: String(elements.aiAssistantConfigModel?.value || '').trim(),
            apiKey: String(elements.aiAssistantConfigApiKey?.value || '').trim(),
            activeProfileId: activeProfileIds[0] || DEFAULT_AI_ASSISTANT_PROFILE_ID,
            activeProfileIds
        };
    }

    function getProfileById(profileId = '') {
        const targetId = String(profileId || '').trim();
        return AI_ASSISTANT_FUNCTION_PROFILES.find((item) => item.id === targetId) || AI_ASSISTANT_FUNCTION_PROFILES[0] || null;
    }

    function getProfileSummary(profileIds = []) {
        const normalizedIds = Array.isArray(profileIds) ? profileIds.map((item) => String(item || '').trim()).filter(Boolean) : [];
        const selectedProfiles = normalizedIds.length > 0
            ? normalizedIds.map((profileId) => getProfileById(profileId)).filter(Boolean)
            : [getProfileById(DEFAULT_AI_ASSISTANT_PROFILE_ID)];

        return {
            ids: selectedProfiles.map((item) => item.id),
            label: selectedProfiles.map((item) => item.label).join(' + '),
            description: selectedProfiles.map((item) => item.description).join('；'),
            browserMcpEnabled: selectedProfiles.some((item) => item.browserMcpEnabled === true)
        };
    }

    function getSelectedProfileIds() {
        const container = getProfileListContainer();
        if (!container) {
            return [DEFAULT_AI_ASSISTANT_PROFILE_ID];
        }

        const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"][value]'));
        const ids = checkboxes
            .filter((input) => input.checked === true)
            .map((input) => String(input.value || '').trim())
            .filter(Boolean);
        if (ids.length > 0) {
            return ids;
        }

        const fallbackCheckbox = checkboxes.find((input) => String(input.value || '').trim() === DEFAULT_AI_ASSISTANT_PROFILE_ID);
        if (fallbackCheckbox) {
            fallbackCheckbox.checked = true;
        }

        return [DEFAULT_AI_ASSISTANT_PROFILE_ID];
    }

    function updateProfileNote(profileIds = []) {
        const note = elements.aiAssistantConfigProfileNote;
        if (!note) {
            return;
        }

        const summary = getProfileSummary(profileIds);
        note.textContent = summary.ids.length > 0
            ? `已选择：${summary.label}`
            : '请选择至少一个功能预设。';
    }

    function syncProfileOptions(config = {}) {
        const container = getProfileListContainer();
        if (!container) {
            return;
        }

        const profiles = Array.isArray(config.profiles) && config.profiles.length > 0
            ? config.profiles
            : AI_ASSISTANT_FUNCTION_PROFILES;
        const activeProfileIds = Array.isArray(config.activeProfileIds) && config.activeProfileIds.length > 0
            ? config.activeProfileIds
            : [String(config.activeProfileId || DEFAULT_AI_ASSISTANT_PROFILE_ID).trim() || DEFAULT_AI_ASSISTANT_PROFILE_ID];

        container.innerHTML = '';
        for (const profile of profiles) {
            const option = document.createElement('label');
            option.className = 'ai-assistant-config-profile-option';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = String(profile.id || '').trim();
            checkbox.checked = activeProfileIds.includes(checkbox.value);

            const text = document.createElement('span');
            const title = document.createElement('strong');
            title.textContent = String(profile.label || profile.id || '').trim();
            const desc = document.createElement('small');
            desc.textContent = String(profile.description || '').trim();
            text.appendChild(title);
            text.appendChild(desc);

            option.appendChild(checkbox);
            option.appendChild(text);
            container.appendChild(option);
        }

        if (!getSelectedProfileIds().length) {
            const firstCheckbox = container.querySelector('input[type="checkbox"]');
            if (firstCheckbox) {
                firstCheckbox.checked = true;
            }
        }

        updateProfileNote(getSelectedProfileIds());
    }

    function updateConfigStatus(message, tone = 'neutral') {
        if (!elements.aiAssistantConfigStatus) {
            return;
        }

        elements.aiAssistantConfigStatus.textContent = String(message || '').trim() || '未加载';
        elements.aiAssistantConfigStatus.classList.remove('is-success', 'is-warning', 'is-error');
        if (tone === 'success') {
            elements.aiAssistantConfigStatus.classList.add('is-success');
        } else if (tone === 'warning') {
            elements.aiAssistantConfigStatus.classList.add('is-warning');
        } else if (tone === 'error') {
            elements.aiAssistantConfigStatus.classList.add('is-error');
        }
    }

    function syncConfigForm(config = {}) {
        if (elements.aiAssistantConfigBaseUrl) {
            elements.aiAssistantConfigBaseUrl.value = String(config.baseURL || '').trim();
        }
        if (elements.aiAssistantConfigModel) {
            elements.aiAssistantConfigModel.value = String(config.model || '').trim();
        }
        if (elements.aiAssistantConfigApiKey) {
            elements.aiAssistantConfigApiKey.value = '';
            elements.aiAssistantConfigApiKey.placeholder = config.hasApiKey
                ? `已保存（${config.apiKeyMasked || '已保存'}）`
                : '留空则继续使用已保存的密钥';
        }
        syncProfileOptions(config);
    }

    function syncChatSummary() {
        if (!elements.aiAssistantChatSummary) {
            return;
        }

        const messageCount = state.messages.length;
        if (messageCount === 0) {
            elements.aiAssistantChatSummary.textContent = '尚未开始对话';
            return;
        }

        const lastMessage = state.messages[state.messages.length - 1];
        const lastRole = lastMessage?.role === 'assistant' ? 'AI' : '你';
        const activeSession = getActiveConversationSession();
        elements.aiAssistantChatSummary.textContent = `${activeSession?.title || DEFAULT_CONVERSATION_TITLE} · 已加载 ${messageCount} 条消息，最近一条来自 ${lastRole}`;
    }

    function countMessageLines(content = '') {
        const text = String(content || '').replace(/\r\n/g, '\n').trim();
        if (!text) {
            return 0;
        }

        return text.split('\n').length;
    }

    function renderChatMessages() {
        const list = getChatList();
        if (!list) {
            return;
        }

        list.innerHTML = '';

        const renderPromptBubble = () => {
            const bubble = document.createElement('div');
            bubble.className = 'ai-assistant-message ai-assistant-message--system ai-assistant-message--prompt';

            const meta = document.createElement('div');
            meta.className = 'ai-assistant-message__meta';

            const role = document.createElement('span');
            role.className = 'ai-assistant-message__role';
            role.textContent = '提示词';

            const time = document.createElement('span');
            time.className = 'ai-assistant-message__time';
            time.textContent = '发送前预览';

            meta.appendChild(role);
            meta.appendChild(time);

            const content = document.createElement('div');
            content.className = 'ai-assistant-message__content';
            content.textContent = getAssistantPromptContent();

            const contentShell = document.createElement('div');
            contentShell.className = 'ai-assistant-message__content-shell is-collapsed';
            if (state.promptExpanded === true) {
                contentShell.classList.remove('is-collapsed');
            }
            contentShell.appendChild(content);

            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'ai-assistant-message__toggle-btn';
            toggleBtn.textContent = state.promptExpanded === true ? '收起' : '展开';
            toggleBtn.setAttribute('aria-expanded', String(state.promptExpanded === true));
            toggleBtn.setAttribute('aria-label', state.promptExpanded === true ? '收起提示词' : '展开提示词');
            toggleBtn.addEventListener('click', () => {
                state.promptExpanded = !state.promptExpanded;
                renderChatMessages();
            });

            bubble.appendChild(meta);
            bubble.appendChild(contentShell);
            bubble.appendChild(toggleBtn);
            list.appendChild(bubble);
        };

        renderPromptBubble();

        if (state.messages.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ai-assistant-message ai-assistant-message--system';
            const meta = document.createElement('div');
            meta.className = 'ai-assistant-message__meta';
            const role = document.createElement('span');
            role.className = 'ai-assistant-message__role';
            role.textContent = '提示';
            const time = document.createElement('span');
            time.className = 'ai-assistant-message__time';
            time.textContent = '等待输入';
            meta.appendChild(role);
            meta.appendChild(time);

            const content = document.createElement('div');
            content.className = 'ai-assistant-message__content';
            content.textContent = '暂无对话内容。';

            empty.appendChild(meta);
            empty.appendChild(content);
            list.appendChild(empty);
            syncChatSummary();
            return;
        }

        for (const [index, item] of state.messages.entries()) {
            const bubble = document.createElement('div');
            const role = String(item.role || 'assistant');
            const isError = item.error === true;
            const kindClass = item.kind === 'request' ? ' ai-assistant-message--request' : '';
            bubble.className = `ai-assistant-message ai-assistant-message--${role}${kindClass}${item.pending ? ' is-loading' : ''}${isError ? ' ai-assistant-message--error' : ''}`;

            const meta = document.createElement('div');
            meta.className = 'ai-assistant-message__meta';

            const roleLabel = document.createElement('span');
            roleLabel.className = 'ai-assistant-message__role';
            roleLabel.textContent = item.kind === 'request'
                ? 'AI需求'
                : role === 'user'
                    ? 'USER'
                    : role === 'assistant'
                        ? 'ASSISTANT'
                        : 'SYSTEM';

            const time = document.createElement('span');
            time.className = 'ai-assistant-message__time';
            time.textContent = item.time || new Date().toLocaleTimeString('zh-CN', { hour12: false });

            meta.appendChild(roleLabel);
            meta.appendChild(time);

            const content = document.createElement('div');
            content.className = 'ai-assistant-message__content';
            content.textContent = String(item.content || '').trim() || ' ';

            const lineCount = countMessageLines(item.content);
            const shouldCollapse = lineCount > 5;
            const isExpanded = item.uiExpanded === true;

            const contentShell = document.createElement('div');
            contentShell.className = 'ai-assistant-message__content-shell';
            if (shouldCollapse && !isExpanded) {
                contentShell.classList.add('is-collapsed');
            }
            contentShell.appendChild(content);

            bubble.appendChild(meta);
            bubble.appendChild(contentShell);

            if (shouldCollapse) {
                const toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = 'ai-assistant-message__toggle-btn';
                toggleBtn.textContent = isExpanded ? '收起' : '展开';
                toggleBtn.setAttribute('aria-expanded', String(isExpanded));
                toggleBtn.setAttribute('aria-label', isExpanded ? '收起消息内容' : '展开消息内容');
                toggleBtn.addEventListener('click', () => {
                    const activeSession = getActiveConversationSession();
                    const targetMessage = activeSession?.messages?.[index];
                    if (!targetMessage) {
                        return;
                    }

                    targetMessage.uiExpanded = !targetMessage.uiExpanded;
                    renderChatMessages();
                });
                bubble.appendChild(toggleBtn);
            }

            list.appendChild(bubble);
        }

        list.scrollTop = list.scrollHeight;
        syncChatSummary();
    }

    function pushMessage(role, content, options = {}) {
        const activeSession = ensureActiveConversationSession();
        activeSession.messages.push({
            role,
            content,
            time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            pending: options.pending === true,
            error: options.error === true,
            uiExpanded: false
        });
        activeSession.updatedAt = new Date().toISOString();
        if (role === 'user' && activeSession.messages.length === 1) {
            const title = String(content || '').replace(/\s+/g, ' ').trim();
            if (title) {
                activeSession.title = title.length > 18 ? `${title.slice(0, 18)}...` : title;
            }
        }
        renderChatMessages();
        refreshHistorySelect();
    }

    function replaceMessage(index, nextMessage) {
        if (index < 0 || index >= state.messages.length) {
            return;
        }

        state.messages[index] = {
            ...state.messages[index],
            ...nextMessage,
            time: nextMessage.time || state.messages[index].time || new Date().toLocaleTimeString('zh-CN', { hour12: false })
        };
        const activeSession = getActiveConversationSession();
        if (activeSession) {
            activeSession.updatedAt = new Date().toISOString();
        }
        renderChatMessages();
        refreshHistorySelect();
    }

    function updateStreamingAssistantMessage(requestId, content, options = {}) {
        if (!requestId || requestId !== state.activeChatRequestId) {
            return;
        }

        const placeholderIndex = state.activeChatPlaceholderIndex;
        if (placeholderIndex < 0 || placeholderIndex >= state.messages.length) {
            return;
        }

        replaceMessage(placeholderIndex, {
            role: 'assistant',
            content: String(content || '').trim() || '正在思考...',
            pending: options.pending !== false,
            error: options.error === true
        });
    }

    function setSendingState(isSending) {
        state.isSending = isSending;
        if (elements.aiAssistantSendBtn) {
            elements.aiAssistantSendBtn.disabled = isSending;
            elements.aiAssistantSendBtn.textContent = isSending ? '发送中...' : '发送';
        }
        if (elements.aiAssistantInput) {
            elements.aiAssistantInput.disabled = isSending;
        }
    }

    function adjustAiAssistantInputHeight() {
        const input = elements.aiAssistantInput;
        if (!input) {
            return;
        }

        const maxHeight = 220;
        input.style.height = 'auto';
        const nextHeight = Math.min(input.scrollHeight, maxHeight);
        input.style.height = `${nextHeight}px`;
        input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }

    function showConfigDialog() {
        syncConfigForm(state.savedConfig);
        if (elements.aiAssistantConfigDialog) {
            elements.aiAssistantConfigDialog.style.display = 'flex';
        }
    }

    function hideConfigDialog() {
        if (elements.aiAssistantConfigDialog) {
            elements.aiAssistantConfigDialog.style.display = 'none';
        }
    }

    function updateConfigStateViews(config = state.savedConfig, statusMessage = '', tone = 'neutral') {
        if (statusMessage) {
            updateConfigStatus(statusMessage, tone);
        } else {
            const activeProfile = getProfileSummary(config.activeProfileIds || config.activeProfileId);
            updateConfigStatus(
                config.hasApiKey
                    ? `已就绪 · ${config.model || '未命名模型'} · ${config.apiKeyMasked || '已保存'} · ${activeProfile.label || '通用对话'}`
                    : '未配置 API Key',
                config.hasApiKey ? 'success' : 'warning'
            );
        }
    }

    async function loadAiAssistantConfig() {
        try {
            updateConfigStatus('加载中...', 'warning');
            const result = await ipcRenderer.invoke(AI_ASSISTANT_CHANNELS.GET_CONFIG);
            if (!result || result.success !== true) {
                throw new Error(result?.error || '读取 AI 配置失败');
            }

            state.savedConfig = result.config || state.savedConfig;
            syncConfigForm(state.savedConfig);
            updateConfigStateViews(state.savedConfig);
            await loadAiAssistantHistory();
            return result;
        } catch (error) {
            logger.error(`加载 AI 配置失败: ${error.message}`);
            updateConfigStatus(`加载失败: ${error.message}`, 'error');
            await loadAiAssistantHistory();
            return { success: false, error: error.message };
        }
    }

    async function loadRuntimeInfo() {
        try {
            const result = await ipcRenderer.invoke('get-app-runtime-info');
            if (!result || result.success !== true) {
                return null;
            }

            return result;
        } catch (error) {
            logger.warning(`加载运行信息失败: ${error.message}`);
            return null;
        }
    }

    async function getWebControlApiBaseUrl() {
        if (state.webControlApiBaseUrl) {
            return state.webControlApiBaseUrl;
        }

        const runtimeInfo = await loadRuntimeInfo();
        const webControlUrl = String(runtimeInfo?.webControlUrl || '').trim();
        if (webControlUrl) {
            state.webControlApiBaseUrl = webControlUrl.replace(/\/+$/, '');
        }

        return state.webControlApiBaseUrl;
    }

    async function loadAiAssistantHistory() {
        try {
            const result = await ipcRenderer.invoke(AI_ASSISTANT_CHANNELS.GET_HISTORY);
            if (!result || result.success !== true) {
                throw new Error(result?.error || '读取 AI 对话记录失败');
            }

            syncConversationHistory(result.history || {});
            return result;
        } catch (error) {
            logger.error(`加载 AI 对话记录失败: ${error.message}`);
            syncConversationHistory({});
            renderChatMessages();
            return { success: false, error: error.message };
        }
    }

    async function saveAiAssistantConfig() {
        try {
            const payload = getConfigSnapshotFromForm();
            const result = await ipcRenderer.invoke(AI_ASSISTANT_CHANNELS.SAVE_CONFIG, payload);
            if (!result || result.success !== true) {
                throw new Error(result?.error || '保存 AI 配置失败');
            }

            state.savedConfig = result.config || state.savedConfig;
            syncConfigForm(state.savedConfig);
            updateConfigStateViews(state.savedConfig, `已保存 · ${state.savedConfig.model || '未命名模型'} · ${state.savedConfig.apiKeyMasked || '已保存'} · ${getProfileSummary(state.savedConfig.activeProfileIds || state.savedConfig.activeProfileId).label || '通用对话'}`, 'success');
            logger.info(`AI 配置已保存: ${state.savedConfig.model || '未命名模型'}`);
            hideConfigDialog();
            return result;
        } catch (error) {
            logger.error(`保存 AI 配置失败: ${error.message}`);
            updateConfigStatus(`保存失败: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    function clearAiAssistantChat() {
        const nextSession = createBlankConversationSession();
        state.sessions.push(nextSession);
        state.activeSessionId = nextSession.id;
        state.messages = nextSession.messages;
        renderChatMessages();
        refreshHistorySelect();
        void persistChatHistory();
    }

    async function openBrowserLinkFromChat(input = '') {
        const navigationRequest = extractOpenUrlRequest(input);
        if (!navigationRequest || !navigationRequest.url) {
            return null;
        }

        pushMessage('user', input);
        void persistChatHistory();

        const assistantPlaceholderIndex = state.messages.length;
        state.activeChatRequestId = '';
        state.activeChatPlaceholderIndex = assistantPlaceholderIndex;
        pushMessage('assistant', '正在打开内置浏览器...', { pending: true });
        setSendingState(true);

        try {
            const webControlApiBaseUrl = await getWebControlApiBaseUrl();
            if (!webControlApiBaseUrl) {
                throw new Error('未找到可用的网页控制服务地址');
            }

            const response = await fetch(`${webControlApiBaseUrl}/api/invoke`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    channel: BROWSER_OPEN_URL_CHANNEL,
                    args: [{
                        url: navigationRequest.url,
                        newTab: true,
                        message: input
                    }]
                })
            });

            let payload = null;
            try {
                payload = await response.json();
            } catch (_error) {
                payload = null;
            }

            if (!response.ok) {
                throw new Error(payload?.error || '打开内置浏览器失败');
            }

            const result = payload?.result || null;
            if (!result || result.success !== true) {
                throw new Error(result?.error || payload?.error || '打开内置浏览器失败');
            }

            replaceMessage(assistantPlaceholderIndex, {
                role: 'assistant',
                content: navigationRequest.label
                    ? `已在内置浏览器打开${navigationRequest.label}`
                    : `已在内置浏览器打开 ${result.url || navigationRequest.url}`,
                pending: false,
                error: false
            });
            void persistChatHistory();
            return result;
        } catch (error) {
            replaceMessage(assistantPlaceholderIndex, {
                role: 'assistant',
                content: `打开内置浏览器失败: ${error.message}`,
                pending: false,
                error: true
            });
            void persistChatHistory();
            return { success: false, error: error.message };
        } finally {
            setSendingState(false);
            state.activeChatRequestId = '';
            state.activeChatPlaceholderIndex = -1;
        }
    }

    async function sendAiAssistantMessage() {
        if (state.isSending) {
            logger.info('AI 对话发送被跳过: 正在发送中');
            return;
        }

        const input = String(elements.aiAssistantInput?.value || '').trim();
        if (!input) {
            logger.info('AI 对话发送被跳过: 输入为空');
            return;
        }

        if (elements.aiAssistantInput) {
            elements.aiAssistantInput.value = '';
            adjustAiAssistantInputHeight();
        }

        const openResult = await openBrowserLinkFromChat(input);
        if (openResult) {
            return;
        }

        const runtimeConfig = getConfigSnapshotFromForm();
        if (!runtimeConfig.model) {
            logger.error('AI 对话发送被跳过: 模型未配置');
            return;
        }

        if (!runtimeConfig.apiKey && !state.savedConfig.hasApiKey) {
            logger.error('AI 对话发送被跳过: API Key 未配置');
            return;
        }

        logger.info(`AI 对话开始发送: model=${runtimeConfig.model}, profile=${runtimeConfig.activeProfileId}`);
        const assistantPlaceholderIndex = state.messages.length;
        const requestId = `ai-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        state.activeChatRequestId = requestId;
        state.activeChatPlaceholderIndex = assistantPlaceholderIndex;
        pushMessage('assistant', '正在思考...', { pending: true });
        setSendingState(true);

        try {
            const activeProfileIds = Array.isArray(state.savedConfig.activeProfileIds) && state.savedConfig.activeProfileIds.length > 0
                ? state.savedConfig.activeProfileIds
                : [String(state.savedConfig.activeProfileId || runtimeConfig.activeProfileId || DEFAULT_AI_ASSISTANT_PROFILE_ID).trim() || DEFAULT_AI_ASSISTANT_PROFILE_ID];
            const payload = {
                ...runtimeConfig,
                activeProfileId: String(state.savedConfig.activeProfileId || runtimeConfig.activeProfileId || DEFAULT_AI_ASSISTANT_PROFILE_ID).trim() || DEFAULT_AI_ASSISTANT_PROFILE_ID,
                activeProfileIds,
                systemPrompt: buildAiAssistantSystemPrompt({
                    basePrompt: DEFAULT_AI_ASSISTANT_SYSTEM_PROMPT,
                    profileIds: activeProfileIds
                }),
                messages: state.messages
                    .filter((item) => !item.pending && !item.error)
                    .slice(-MAX_CHAT_HISTORY_MESSAGES),
                message: input,
                requestId,
                stream: true
            };
            logger.info(`AI 对话请求已发起: requestId=${requestId}, messageCount=${payload.messages.length}`);
            const result = await ipcRenderer.invoke(AI_ASSISTANT_CHANNELS.CHAT, payload);
            if (!result || result.success !== true) {
                logger.error(`AI 对话返回失败: ${result?.error || 'unknown error'}`);
                throw new Error(result?.error || 'AI 回复失败');
            }

            logger.info(`AI 对话返回成功: requestId=${requestId}, model=${result.model || runtimeConfig.model}`);
            replaceMessage(assistantPlaceholderIndex, {
                role: 'assistant',
                content: result.reply,
                pending: false,
                error: false
            });
            logger.info(`AI 回复完成: ${result.model || runtimeConfig.model}`);
            void persistChatHistory();
        } catch (error) {
            const currentContent = state.messages[assistantPlaceholderIndex]?.content || '';
            const partialReply = String(error?.partialReply || currentContent || '').trim();
            logger.error(`AI 对话异常: requestId=${requestId}, ${error.message}`);
            replaceMessage(assistantPlaceholderIndex, {
                role: 'assistant',
                content: partialReply ? `${partialReply}\n\n请求失败: ${error.message}` : `请求失败: ${error.message}`,
                pending: false,
                error: true
            });
            logger.error(`AI 对话失败: ${error.message}`);
            void persistChatHistory();
        } finally {
            state.activeChatRequestId = '';
            state.activeChatPlaceholderIndex = -1;
            setSendingState(false);
        }
    }

    function setupAiAssistantPanel() {
        if (!state.historyUpdateListenerBound && typeof ipcRenderer?.on === 'function') {
            ipcRenderer.on(AI_ASSISTANT_CHANNELS.HISTORY_UPDATED, (_event, payload = {}) => {
                if (payload?.reason === 'save' && isActiveAiChatRequestInProgress()) {
                    logger.info(`AI 对话历史更新被忽略: reason=${payload.reason}, requestId=${state.activeChatRequestId || 'none'}`);
                    return;
                }
                void loadAiAssistantHistory();
            });
            state.historyUpdateListenerBound = true;
        }
        if (!state.chatStreamListenerBound && typeof ipcRenderer?.on === 'function') {
            ipcRenderer.on(AI_ASSISTANT_CHANNELS.CHAT_STREAM, (_event, payload = {}) => {
                const requestId = String(payload?.requestId || '').trim();
                if (!requestId || requestId !== state.activeChatRequestId) {
                    return;
                }

                if (typeof payload?.content === 'string') {
                    updateStreamingAssistantMessage(requestId, payload.content, {
                        pending: true
                    });
                }
            });
            state.chatStreamListenerBound = true;
        }

        const openButtons = [
            elements.aiAssistantConfigOpenBtn
        ].filter(Boolean);
        openButtons.forEach((button) => {
            button.addEventListener('click', showConfigDialog);
        });
        if (elements.aiAssistantConfigCloseBtn) {
            const closeConfigDialog = (event) => {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                hideConfigDialog();
            };
            elements.aiAssistantConfigCloseBtn.addEventListener('click', closeConfigDialog);
            elements.aiAssistantConfigCloseBtn.addEventListener('pointerdown', closeConfigDialog);
        }
        if (elements.aiAssistantConfigCancelBtn) {
            elements.aiAssistantConfigCancelBtn.addEventListener('click', (event) => {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                hideConfigDialog();
            });
        }
        if (elements.aiAssistantConfigReloadBtn) {
            elements.aiAssistantConfigReloadBtn.addEventListener('click', () => {
                void loadAiAssistantConfig();
            });
        }
        if (elements.aiAssistantConfigActiveProfiles) {
            elements.aiAssistantConfigActiveProfiles.addEventListener('change', () => {
                updateProfileNote(getSelectedProfileIds());
            });
        }
        if (elements.aiAssistantConfigSaveBtn) {
            elements.aiAssistantConfigSaveBtn.addEventListener('click', () => {
                void saveAiAssistantConfig();
            });
        }
        if (elements.aiAssistantConfigDialog) {
            elements.aiAssistantConfigDialog.addEventListener('click', (event) => {
                if (event.target === elements.aiAssistantConfigDialog) {
                    hideConfigDialog();
                }
            });
        }
        document.addEventListener('click', (event) => {
            const closeButton = event.target?.closest?.('#close-ai-assistant-config-btn');
            if (!closeButton) {
                return;
            }

            event.preventDefault?.();
            event.stopPropagation?.();
            hideConfigDialog();
        }, true);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && elements.aiAssistantConfigDialog?.style.display === 'flex') {
                hideConfigDialog();
                return;
            }

            if (event.key === 'Escape' && !getHistoryMenu()?.hidden) {
                closeHistoryMenu();
            }
        });
        if (elements.aiAssistantClearBtn) {
            elements.aiAssistantClearBtn.addEventListener('click', clearAiAssistantChat);
        }
        if (elements.aiAssistantHistoryToggleBtn) {
            elements.aiAssistantHistoryToggleBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleHistoryMenu();
            });
        }
        if (elements.aiAssistantHistoryMenu) {
            elements.aiAssistantHistoryMenu.addEventListener('click', async (event) => {
                const target = event.target;
                const deleteButton = target.closest?.('.ai-assistant-history-delete-btn');
                const mainButton = target.closest?.('.ai-assistant-history-item__main');
                const sessionId = String(deleteButton?.dataset?.sessionId || mainButton?.dataset?.sessionId || '').trim();
                if (!sessionId) {
                    return;
                }

                if (deleteButton) {
                    event.stopPropagation();
                    await deleteHistorySession(sessionId);
                    refreshHistorySelect();
                    closeHistoryMenu();
                    return;
                }

                if (mainButton) {
                    event.stopPropagation();
                    if (sessionId !== state.activeSessionId) {
                        setActiveConversationSession(sessionId, { persist: true });
                    }
                    closeHistoryMenu();
                }
            });
        }
        document.addEventListener('click', (event) => {
            const dropdown = elements.aiAssistantHistoryDropdown;
            if (!dropdown) {
                return;
            }

            if (state.isHistoryMenuOpen && !dropdown.contains(event.target)) {
                closeHistoryMenu();
            }
        });
        if (elements.aiAssistantSendBtn) {
            elements.aiAssistantSendBtn.addEventListener('click', () => {
                void sendAiAssistantMessage();
            });
        }
        if (elements.aiAssistantInput) {
            elements.aiAssistantInput.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' || event.shiftKey) {
                    return;
                }

                event.preventDefault();
                void sendAiAssistantMessage();
            });
            elements.aiAssistantInput.addEventListener('input', adjustAiAssistantInputHeight);
        }
        window.addEventListener('resize', adjustAiAssistantInputHeight);
        if (elements.aiAssistantConfigBaseUrl) {
            elements.aiAssistantConfigBaseUrl.addEventListener('input', () => {
                updateConfigStatus('配置已修改，点击保存后生效', 'warning');
            });
        }
        if (elements.aiAssistantConfigModel) {
            elements.aiAssistantConfigModel.addEventListener('input', () => {
                updateConfigStatus('配置已修改，点击保存后生效', 'warning');
            });
        }
        if (elements.aiAssistantConfigApiKey) {
            elements.aiAssistantConfigApiKey.addEventListener('input', () => {
                updateConfigStatus('配置已修改，点击保存后生效', 'warning');
            });
        }

        renderChatMessages();
        refreshHistorySelect();
        adjustAiAssistantInputHeight();
    }

    return {
        setupAiAssistantPanel,
        loadAiAssistantConfig,
        loadAiAssistantHistory,
        saveAiAssistantConfig,
        clearAiAssistantChat,
        sendAiAssistantMessage
    };
};
