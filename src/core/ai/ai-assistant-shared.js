const { AI_ASSISTANT_CHANNELS } = require('./ai-channels');

const DEFAULT_AI_ASSISTANT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_AI_ASSISTANT_MODEL = 'deepseek-chat';
const DEFAULT_AI_ASSISTANT_SYSTEM_PROMPT = [
    '你是一个专业、简洁、实用的中文 AI 助手。',
    '请优先给出可执行建议，避免空话。',
    '如果当前任务涉及网页操作、页面元素定位或 MCP 协作，请优先基于可见元素、页面证据和已给出的上下文生成可执行动作，不要只说“无法实现”或只给抽象建议。',
    '如果用户给出了网址、搜索结果或明确页面链接，请优先主动使用内置浏览器打开链接，而不是只返回文本建议。',
    '当任务可以通过 MCP/页面元素完成时，优先输出明确动作、目标和原因；不确定时再请求补充证据。'
].join('\n');
const DEFAULT_AI_ASSISTANT_PROFILE_ID = 'general';
const AI_ASSISTANT_FUNCTION_PROFILES = Object.freeze([
    {
        id: 'general',
        label: '通用对话',
        description: '仅启用基础问答，不附加本地页面能力。',
        promptHints: [
            '仅处理通用中文对话，不要假设当前具备页面快照、元素定位或本地 MCP 执行能力。',
            '如果用户没有明确要求网页或站点联动，优先给出普通可执行建议。'
        ],
        capabilities: [],
        browserMcpEnabled: false
    },
    {
        id: 'browser-mcp',
        label: '浏览器 MCP',
        description: '启用浏览器页面快照与页面操作相关能力。',
        promptHints: [
            '这是浏览器 MCP 功能预设，处理网页相关任务时要优先使用页面快照、元素证据和可执行动作。',
            '优先使用 mcpId 定位元素；如果能直接点击、输入、选择、滚动、打开网址、切换标签或搜索网页，就不要只给抽象建议。',
            '当用户给出网址、搜索结果或明确页面链接时，优先主动用 browser.open_url 在内置浏览器打开；需要最新资料时，优先用 browser.search_web 或 browser.open_url 打开搜索结果，再基于页面证据回答。',
            '如果证据不足，明确说明还缺哪类页面信息，而不是直接写“无法实现”。'
        ],
        capabilities: ['browser.snapshot', 'browser.actions', 'browser.navigation', 'browser.tabs', 'browser.web_search', 'browser.page_text'],
        browserMcpEnabled: true
    }
]);
const MAX_CHAT_HISTORY_MESSAGES = 20;
const MAX_PERSISTED_CHAT_MESSAGES = 200;
const DEFAULT_CONVERSATION_TITLE = '当前会话';

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAiAssistantBaseUrl(value, fallback = DEFAULT_AI_ASSISTANT_BASE_URL) {
    const text = String(value || '').trim().replace(/\/+$/, '');
    if (!text) {
        return fallback;
    }

    const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(text);
    if (hasProtocol) {
        return text;
    }

    return `https://${text.replace(/^\/+/, '')}`;
}

function normalizeAiAssistantConfig(source = {}, fallback = {}) {
    const input = isPlainObject(source) ? source : {};
    const defaults = isPlainObject(fallback) ? fallback : {};

    const baseURL = normalizeAiAssistantBaseUrl(
        input.baseURL
        ?? input.baseUrl
        ?? input.apiBaseUrl
        ?? input.base_url
        ?? defaults.baseURL
        ?? DEFAULT_AI_ASSISTANT_BASE_URL
    );
    const model = String(
        input.model
        ?? input.aiModel
        ?? input.model_name
        ?? input.modelName
        ?? defaults.model
        ?? DEFAULT_AI_ASSISTANT_MODEL
    ).trim();
    const apiKey = String(
        input.apiKey
        ?? input.api_key
        ?? input.openai_api_key
        ?? input.deepseek_api_key
        ?? defaults.apiKey
        ?? ''
    ).trim();
    const activeProfileId = normalizeAiAssistantProfileId(
        input.activeProfileId
        ?? input.active_profile_id
        ?? input.profileId
        ?? input.profile_id
        ?? defaults.activeProfileId
        ?? DEFAULT_AI_ASSISTANT_PROFILE_ID
    );
    const activeProfileIds = normalizeAiAssistantProfileIds(
        input.activeProfileIds
        ?? input.active_profile_ids
        ?? input.activeProfiles
        ?? input.active_profiles
        ?? [activeProfileId]
    );

    return {
        baseURL,
        model,
        apiKey,
        activeProfileId: activeProfileIds[0] || activeProfileId,
        activeProfileIds
    };
}

function normalizeAiAssistantProfileId(value) {
    const profileId = String(value || '').trim();
    const matched = AI_ASSISTANT_FUNCTION_PROFILES.find((item) => item.id === profileId);
    return matched ? matched.id : DEFAULT_AI_ASSISTANT_PROFILE_ID;
}

function normalizeAiAssistantProfileIds(value, fallback = [DEFAULT_AI_ASSISTANT_PROFILE_ID]) {
    const ids = [];
    const source = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(/[,\s]+/)
            : value ? [value] : [];

    for (const item of source) {
        const profileId = normalizeAiAssistantProfileId(item);
        if (!ids.includes(profileId)) {
            ids.push(profileId);
        }
    }

    const fallbackIds = Array.isArray(fallback) ? fallback : [fallback];
    if (!ids.length) {
        for (const item of fallbackIds) {
            const profileId = normalizeAiAssistantProfileId(item);
            if (!ids.includes(profileId)) {
                ids.push(profileId);
            }
        }
    }

    return ids.length ? ids : [DEFAULT_AI_ASSISTANT_PROFILE_ID];
}

function getAiAssistantFunctionProfiles() {
    return AI_ASSISTANT_FUNCTION_PROFILES.map((item) => ({ ...item }));
}

function getAiAssistantFunctionProfile(profileId) {
    const normalizedProfileId = normalizeAiAssistantProfileId(profileId);
    return AI_ASSISTANT_FUNCTION_PROFILES.find((item) => item.id === normalizedProfileId) || AI_ASSISTANT_FUNCTION_PROFILES[0];
}

function getAiAssistantFunctionProfilesByIds(profileIds = []) {
    const normalizedIds = normalizeAiAssistantProfileIds(profileIds);
    return normalizedIds
        .map((profileId) => getAiAssistantFunctionProfile(profileId))
        .filter(Boolean)
        .map((profile) => ({ ...profile }));
}

function getAiAssistantFunctionProfileCapabilities(profileIds = []) {
    const profiles = getAiAssistantFunctionProfilesByIds(profileIds);
    const capabilitySet = new Set();
    for (const profile of profiles) {
        for (const capability of Array.isArray(profile.capabilities) ? profile.capabilities : []) {
            const text = String(capability || '').trim();
            if (text) {
                capabilitySet.add(text);
            }
        }
    }

    return Array.from(capabilitySet);
}

function getAiAssistantFunctionProfilePromptHints(profileIds = []) {
    const profiles = getAiAssistantFunctionProfilesByIds(profileIds);
    const hints = [];

    for (const profile of profiles) {
        for (const hint of Array.isArray(profile.promptHints) ? profile.promptHints : []) {
            const text = String(hint || '').trim();
            if (text && !hints.includes(text)) {
                hints.push(text);
            }
        }
    }

    return hints;
}

function getAiAssistantFunctionProfileSummary(profileIds = []) {
    const profiles = getAiAssistantFunctionProfilesByIds(profileIds);
    if (!profiles.length) {
        const fallbackProfile = getAiAssistantFunctionProfile(DEFAULT_AI_ASSISTANT_PROFILE_ID);
        return {
            id: fallbackProfile.id,
            ids: [fallbackProfile.id],
            label: fallbackProfile.label,
            description: fallbackProfile.description,
            capabilities: Array.isArray(fallbackProfile.capabilities) ? [...fallbackProfile.capabilities] : [],
            browserMcpEnabled: fallbackProfile.browserMcpEnabled === true
        };
    }

    return {
        id: profiles[0].id,
        ids: profiles.map((item) => item.id),
        label: profiles.map((item) => item.label).join(' + '),
        description: profiles.map((item) => item.description).join('；'),
        capabilities: getAiAssistantFunctionProfileCapabilities(profiles.map((item) => item.id)),
        browserMcpEnabled: profiles.some((item) => item.browserMcpEnabled === true)
    };
}

function buildAiAssistantCapabilityPrompt(profileIds = []) {
    const summary = getAiAssistantFunctionProfileSummary(profileIds);
    const lines = [];

    if (summary.ids?.length > 0) {
        lines.push(`当前功能预设: ${summary.label}`);
    }

    if (summary.browserMcpEnabled === true) {
        lines.push('可用 MCP 能力: 浏览器页面快照、元素定位、点击、输入、选择、滚动、按键、在内置浏览器打开网址、切换标签、网页搜索、页面文本提取。');
    }

    if (Array.isArray(summary.capabilities) && summary.capabilities.length > 0) {
        lines.push(`能力标识: ${summary.capabilities.join(', ')}`);
    }

    const promptHints = getAiAssistantFunctionProfilePromptHints(summary.ids);
    if (promptHints.length > 0) {
        lines.push('功能提示:');
        for (const hint of promptHints) {
            lines.push(`- ${hint}`);
        }
    }

    return lines.join('\n');
}

function buildAiAssistantSystemPrompt({ basePrompt = DEFAULT_AI_ASSISTANT_SYSTEM_PROMPT, profileIds = [] } = {}) {
    const promptParts = [String(basePrompt || '').trim()].filter(Boolean);
    const capabilityPrompt = buildAiAssistantCapabilityPrompt(profileIds);
    if (capabilityPrompt) {
        promptParts.push(capabilityPrompt);
    }

    return promptParts.join('\n\n');
}

function maskApiKey(apiKey) {
    const text = String(apiKey || '').trim();
    if (!text) {
        return '';
    }

    if (text.length <= 8) {
        return `${text.slice(0, 2)}***`;
    }

    return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function sanitizeAiAssistantConfigForRenderer(config = {}) {
    const normalized = normalizeAiAssistantConfig(config);
    const activeProfiles = getAiAssistantFunctionProfilesByIds(normalized.activeProfileIds || normalized.activeProfileId);
    const activeProfile = getAiAssistantFunctionProfileSummary(normalized.activeProfileIds || normalized.activeProfileId);
    return {
        baseURL: normalized.baseURL,
        model: normalized.model,
        apiKey: '',
        hasApiKey: Boolean(normalized.apiKey),
        apiKeyMasked: maskApiKey(normalized.apiKey),
        activeProfileId: activeProfile.id,
        activeProfileIds: activeProfile.ids,
        activeProfile: {
            id: activeProfile.id,
            ids: activeProfile.ids,
            label: activeProfile.label,
            description: activeProfile.description,
            browserMcpEnabled: activeProfile.browserMcpEnabled === true
        },
        activeProfiles,
        profiles: getAiAssistantFunctionProfiles()
    };
}

function mergeAiAssistantConfig(existingConfig = {}, overrideConfig = {}) {
    const normalizedExisting = normalizeAiAssistantConfig(existingConfig);
    const override = isPlainObject(overrideConfig) ? overrideConfig : {};

    const rawBaseURL = String(
        override.baseURL
        ?? override.baseUrl
        ?? override.apiBaseUrl
        ?? override.base_url
        ?? ''
    ).trim();
    const rawModel = String(
        override.model
        ?? override.aiModel
        ?? override.model_name
        ?? override.modelName
        ?? ''
    ).trim();
    const rawApiKey = String(
        override.apiKey
        ?? override.api_key
        ?? override.openai_api_key
        ?? override.deepseek_api_key
        ?? ''
    ).trim();
    const activeProfileId = normalizeAiAssistantProfileId(
        override.activeProfileId
        ?? override.active_profile_id
        ?? override.profileId
        ?? override.profile_id
        ?? normalizedExisting.activeProfileId
        ?? DEFAULT_AI_ASSISTANT_PROFILE_ID
    );
    const activeProfileIds = normalizeAiAssistantProfileIds(
        override.activeProfileIds
        ?? override.active_profile_ids
        ?? override.activeProfiles
        ?? override.active_profiles
        ?? [activeProfileId]
    );

    return {
        baseURL: rawBaseURL || normalizedExisting.baseURL || DEFAULT_AI_ASSISTANT_BASE_URL,
        model: rawModel || normalizedExisting.model || DEFAULT_AI_ASSISTANT_MODEL,
        apiKey: rawApiKey || normalizedExisting.apiKey || '',
        activeProfileId: activeProfileIds[0] || activeProfileId,
        activeProfileIds
    };
}

function sanitizeChatMessages(messages = []) {
    const result = [];
    const source = Array.isArray(messages) ? messages : [];

    for (const item of source) {
        if (!isPlainObject(item)) {
            continue;
        }

        const role = String(item.role || '').trim();
        if (!['system', 'user', 'assistant'].includes(role)) {
            continue;
        }

        const content = String(item.content || '').trim();
        if (!content) {
            continue;
        }

        result.push({ role, content });
    }

    return result.slice(-MAX_CHAT_HISTORY_MESSAGES);
}

function sanitizePersistedChatMessages(messages = []) {
    const result = [];
    const source = Array.isArray(messages) ? messages : [];

    for (const item of source) {
        if (!isPlainObject(item)) {
            continue;
        }

        const role = String(item.role || '').trim();
        if (!['user', 'assistant', 'system'].includes(role)) {
            continue;
        }

        const content = String(item.content || '').trim();
        if (!content) {
            continue;
        }

        result.push({
            role,
            content,
            time: String(item.time || '').trim(),
            error: item.error === true,
            kind: String(item.kind || '').trim()
        });
    }

    return result.slice(-MAX_PERSISTED_CHAT_MESSAGES);
}

function createConversationSessionId() {
    return `ai-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createConversationTitle(messages = [], fallback = DEFAULT_CONVERSATION_TITLE) {
    const source = Array.isArray(messages) ? messages : [];
    const firstUserMessage = source.find((item) => item?.role === 'user' && String(item.content || '').trim());
    const content = String(firstUserMessage?.content || source[0]?.content || '').replace(/\s+/g, ' ').trim();
    if (content) {
        return content.length > 18 ? `${content.slice(0, 18)}...` : content;
    }

    return fallback;
}

function normalizeConversationHistory(source = {}) {
    const input = Array.isArray(source) ? { messages: source } : (isPlainObject(source) ? source : {});
    const rawSessions = Array.isArray(input.sessions)
        ? input.sessions
        : Array.isArray(input.messages)
            ? [{
                id: input.activeSessionId || createConversationSessionId(),
                title: input.title || DEFAULT_CONVERSATION_TITLE,
                messages: input.messages,
                createdAt: input.createdAt || input.created_at || '',
                updatedAt: input.updatedAt || input.updated_at || ''
            }]
            : Array.isArray(input.records)
                ? [{
                    id: input.activeSessionId || createConversationSessionId(),
                    title: input.title || DEFAULT_CONVERSATION_TITLE,
                    messages: input.records,
                    createdAt: input.createdAt || input.created_at || '',
                    updatedAt: input.updatedAt || input.updated_at || ''
                }]
                : [];

    const sessions = rawSessions.map((session, index) => {
        const messages = sanitizePersistedChatMessages(session?.messages || []);
        const id = String(session?.id || '').trim() || createConversationSessionId();
        const createdAt = String(session?.createdAt || session?.created_at || '').trim() || new Date().toISOString();
        const updatedAt = String(session?.updatedAt || session?.updated_at || '').trim() || createdAt;
        const title = String(session?.title || '').trim() || createConversationTitle(messages, `${DEFAULT_CONVERSATION_TITLE} ${index + 1}`);

        return {
            id,
            title,
            createdAt,
            updatedAt,
            messages
        };
    });

    const activeSessionId = String(
        input.activeSessionId
        || sessions[0]?.id
        || ''
    ).trim();

    return {
        sessions,
        activeSessionId,
        updatedAt: String(input.updatedAt || input.updated_at || '').trim()
    };
}

module.exports = {
    AI_ASSISTANT_CHANNELS,
    DEFAULT_AI_ASSISTANT_BASE_URL,
    DEFAULT_AI_ASSISTANT_MODEL,
    DEFAULT_AI_ASSISTANT_SYSTEM_PROMPT,
    DEFAULT_AI_ASSISTANT_PROFILE_ID,
    AI_ASSISTANT_FUNCTION_PROFILES,
    MAX_CHAT_HISTORY_MESSAGES,
    MAX_PERSISTED_CHAT_MESSAGES,
    DEFAULT_CONVERSATION_TITLE,
    buildAiAssistantCapabilityPrompt,
    buildAiAssistantSystemPrompt,
    createConversationSessionId,
    createConversationTitle,
    mergeAiAssistantConfig,
    getAiAssistantFunctionProfile,
    getAiAssistantFunctionProfiles,
    getAiAssistantFunctionProfilesByIds,
    getAiAssistantFunctionProfileCapabilities,
    getAiAssistantFunctionProfilePromptHints,
    getAiAssistantFunctionProfileSummary,
    isPlainObject,
    maskApiKey,
    normalizeAiAssistantBaseUrl,
    normalizeAiAssistantConfig,
    normalizeAiAssistantProfileId,
    normalizeAiAssistantProfileIds,
    normalizeConversationHistory,
    sanitizeAiAssistantConfigForRenderer,
    sanitizeChatMessages,
    sanitizePersistedChatMessages
};
