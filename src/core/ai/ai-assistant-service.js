const path = require('path');
const fs = require('fs-extra');
const {
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
    getAiAssistantFunctionProfileSummary,
    getAiAssistantFunctionProfilePromptHints,
    maskApiKey,
    normalizeAiAssistantBaseUrl,
    normalizeAiAssistantConfig,
    normalizeAiAssistantProfileId,
    normalizeAiAssistantProfileIds,
    normalizeConversationHistory,
    sanitizeAiAssistantConfigForRenderer,
    sanitizeChatMessages,
    sanitizePersistedChatMessages
} = require('./ai-assistant-shared');

async function postChatCompletions({ baseURL, apiKey, model, messages }) {
    const fetchFn = typeof globalThis.fetch === 'function'
        ? globalThis.fetch.bind(globalThis)
        : null;

    if (!fetchFn) {
        throw new Error('当前运行环境不支持 fetch');
    }

    const normalizedBaseURL = normalizeAiAssistantBaseUrl(baseURL);
    const endpoint = `${normalizedBaseURL.replace(/\/+$/, '')}/chat/completions`;
    const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages,
            stream: false
        })
    });

    const responseText = await response.text();
    let payload = null;
    try {
        payload = responseText ? JSON.parse(responseText) : null;
    } catch (_) {
        payload = null;
    }

    if (!response.ok) {
        const errorMessage = payload?.error?.message
            || payload?.message
            || responseText
            || `HTTP ${response.status}`;
        throw new Error(errorMessage);
    }

    return payload || {};
}

async function fetchWithTimeout(fetchFn, url, options = {}, timeoutMs = 60000, logger = null, requestId = '') {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
        ? setTimeout(() => {
            try {
                controller?.abort?.();
            } catch (_) {}
        }, Number(timeoutMs))
        : null;

    try {
        const response = await fetchFn(url, {
            ...options,
            signal: controller ? controller.signal : options.signal
        });
        return response;
    } catch (error) {
        if (error?.name === 'AbortError') {
            const timeoutText = Number.isFinite(Number(timeoutMs)) ? `${Math.round(Number(timeoutMs) / 1000)}s` : 'unknown';
            logger?.error?.(`AI 对话请求超时: requestId=${requestId}, timeout=${timeoutText}`);
            throw new Error(`请求超时（${timeoutText}）`);
        }
        throw error;
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

function extractStreamChatDelta(payload = {}) {
    const choices = Array.isArray(payload?.choices) ? payload.choices : [];
    let delta = '';

    for (const choice of choices) {
        const choiceDelta = choice?.delta?.content
            ?? choice?.message?.content
            ?? choice?.text
            ?? '';
        if (choiceDelta) {
            delta += String(choiceDelta);
        }
    }

    return delta;
}

async function readStreamChatCompletions(response, { onDelta } = {}) {
    const reader = response?.body?.getReader?.();
    if (!reader) {
        const rawText = await response.text();
        let payload = null;
        try {
            payload = rawText ? JSON.parse(rawText) : null;
        } catch (_) {
            payload = null;
        }

        return {
            reply: String(payload?.choices?.[0]?.message?.content || '').trim(),
            usage: payload?.usage || null,
            streamed: false
        };
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let reply = '';
    let usage = null;

    const flushChunk = (chunkText) => {
        const text = String(chunkText || '').trim();
        if (!text) {
            return false;
        }

        if (text === '[DONE]') {
            return true;
        }

        let payload = null;
        try {
            payload = JSON.parse(text);
        } catch (_) {
            return false;
        }

        const delta = extractStreamChatDelta(payload);
        if (delta) {
            reply += delta;
            if (typeof onDelta === 'function') {
                onDelta(delta, reply, payload);
            }
        }
        if (payload?.usage) {
            usage = payload.usage;
        }

        return false;
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        let separatorIndex = buffer.search(/\r?\n\r?\n/);
        while (separatorIndex !== -1) {
            const chunk = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex).replace(/^\r?\n\r?\n/, '');

            const dataLines = String(chunk)
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart());
            for (const dataLine of dataLines) {
                if (flushChunk(dataLine)) {
                    return {
                        reply,
                        usage,
                        streamed: true
                    };
                }
            }

            separatorIndex = buffer.search(/\r?\n\r?\n/);
        }
    }

    buffer += decoder.decode();
    const remainingLines = String(buffer)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());
    for (const dataLine of remainingLines) {
        if (flushChunk(dataLine)) {
            break;
        }
    }

    return {
        reply,
        usage,
        streamed: true
    };
}

class AiAssistantService {
    constructor({ app, logger, configPath } = {}) {
        this.app = app;
        this.logger = logger || console;
        const baseDir = path.join(app?.getPath ? app.getPath('userData') : process.cwd(), 'ai-assistant');
        this.configPath = configPath || path.join(baseDir, 'config.json');
        this.historyPath = path.join(baseDir, 'history.json');
    }

    _emitHistoryUpdated(payload = {}) {
        if (typeof this.app?.emitUiEvent !== 'function') {
            return;
        }

        this.app.emitUiEvent(AI_ASSISTANT_CHANNELS.HISTORY_UPDATED, {
            reason: String(payload.reason || 'updated').trim() || 'updated',
            source: String(payload.source || '').trim(),
            sessionId: String(payload.sessionId || '').trim()
        });
    }

    async _writeConversationHistory(payload = {}) {
        const normalized = normalizeConversationHistory(payload);
        await fs.ensureDir(path.dirname(this.historyPath));
        await fs.writeJson(this.historyPath, {
            sessions: normalized.sessions,
            activeSessionId: normalized.activeSessionId,
            updatedAt: new Date().toISOString()
        }, { spaces: 2 });

        return {
            success: true,
            historyPath: this.historyPath,
            history: await this.getConversationHistory()
        };
    }

    getDefaultConfig() {
        return {
            baseURL: DEFAULT_AI_ASSISTANT_BASE_URL,
            model: DEFAULT_AI_ASSISTANT_MODEL,
            apiKey: '',
            activeProfileId: DEFAULT_AI_ASSISTANT_PROFILE_ID,
            activeProfileIds: [DEFAULT_AI_ASSISTANT_PROFILE_ID]
        };
    }

    async readRawConfig() {
        try {
            if (await fs.pathExists(this.configPath)) {
                const config = await fs.readJson(this.configPath);
                return normalizeAiAssistantConfig(config);
            }
        } catch (error) {
            this.logger?.warning?.(`读取 AI 配置失败: ${error.message}`);
        }

        return {};
    }

    async getConfig() {
        const rawConfig = await this.readRawConfig();
        return sanitizeAiAssistantConfigForRenderer(
            normalizeAiAssistantConfig(this.getDefaultConfig(), rawConfig)
        );
    }

    async saveConfig(payload = {}) {
        const incoming = payload && typeof payload === 'object' ? payload : {};
        const existing = normalizeAiAssistantConfig(this.getDefaultConfig(), await this.readRawConfig());
        const merged = normalizeAiAssistantConfig({
            ...existing,
            ...incoming
        }, this.getDefaultConfig());

        if (!merged.apiKey) {
            return { success: false, error: 'API Key 不能为空' };
        }
        if (!merged.model) {
            return { success: false, error: '模型名称不能为空' };
        }

        await fs.ensureDir(path.dirname(this.configPath));
        await fs.writeJson(this.configPath, merged, { spaces: 2 });

        return {
            success: true,
            configPath: this.configPath,
            config: sanitizeAiAssistantConfigForRenderer(merged)
        };
    }

    async readRawConversationHistory() {
        try {
            if (await fs.pathExists(this.historyPath)) {
                const history = await fs.readJson(this.historyPath);
                return normalizeConversationHistory(history);
            }
        } catch (error) {
            this.logger?.warning?.(`读取 AI 对话记录失败: ${error.message}`);
        }

        return normalizeConversationHistory();
    }

    async getConversationHistory() {
        return this.readRawConversationHistory();
    }

    async saveConversationHistory(payload = {}) {
        const result = await this._writeConversationHistory(payload);
        this._emitHistoryUpdated({
            reason: 'save'
        });
        return result;
    }

    async clearConversationHistory() {
        const result = await this._writeConversationHistory({
            sessions: [],
            activeSessionId: ''
        });
        this._emitHistoryUpdated({
            reason: 'clear'
        });
        return result;
    }

    async deleteConversationSession(sessionId) {
        const targetId = String(sessionId || '').trim();
        if (!targetId) {
            return { success: false, error: '会话 ID 不能为空' };
        }

        const history = await this.readRawConversationHistory();
        const sessions = Array.isArray(history.sessions) ? history.sessions : [];
        const nextSessions = sessions.filter((session) => String(session?.id || '') !== targetId);

        if (nextSessions.length === sessions.length) {
            return { success: false, error: '未找到对应会话' };
        }

        const nextActiveSessionId = nextSessions[0]?.id || '';
        const result = await this._writeConversationHistory({
            sessions: nextSessions,
            activeSessionId: nextActiveSessionId
        });
        this._emitHistoryUpdated({
            reason: 'delete',
            sessionId: targetId
        });

        return {
            ...result,
            history: result.history
        };
    }

    async appendConversationMessage(payload = {}) {
        const incoming = payload && typeof payload === 'object' ? payload : {};
        const role = String(incoming.role || '').trim();
        if (!['user', 'assistant', 'system'].includes(role)) {
            return { success: false, error: '消息角色无效' };
        }

        const content = String(incoming.content || '').trim();
        if (!content) {
            return { success: false, error: '消息内容不能为空' };
        }

        const sessionId = String(incoming.sessionId || '').trim() || createConversationSessionId();
        const title = String(incoming.title || '').trim();
        const history = await this.readRawConversationHistory();
        const sessions = Array.isArray(history.sessions) ? [...history.sessions] : [];
        const now = new Date().toISOString();
        let session = sessions.find((item) => String(item?.id || '').trim() === sessionId);

        if (!session) {
            session = {
                id: sessionId,
                title: title || DEFAULT_CONVERSATION_TITLE,
                createdAt: now,
                updatedAt: now,
                messages: []
            };
            sessions.unshift(session);
        } else if (title) {
            session.title = title;
        }

        const nextMessage = {
            role,
            content,
            time: String(incoming.time || '').trim() || now,
            error: incoming.error === true,
            kind: String(incoming.kind || '').trim()
        };
        session.messages = sanitizePersistedChatMessages([
            ...(Array.isArray(session.messages) ? session.messages : []),
            nextMessage
        ]);
        session.updatedAt = now;

        const nextActiveSessionId = String(incoming.activeSessionId || history.activeSessionId || sessionId).trim() || sessionId;
        const result = await this._writeConversationHistory({
            sessions,
            activeSessionId: nextActiveSessionId
        });
        this._emitHistoryUpdated({
            reason: 'append',
            source: String(incoming.source || '').trim(),
            sessionId: session.id
        });

        return {
            ...result,
            sessionId: session.id,
            session
        };
    }

    async sendChat(payload = {}) {
        const incoming = payload && typeof payload === 'object' ? payload : {};
        this.logger?.info?.(`AI 对话服务进入: requestId=${String(incoming.requestId || '').trim() || 'none'}`);
        const existing = normalizeAiAssistantConfig(this.getDefaultConfig(), await this.readRawConfig());
        const runtimeConfig = normalizeAiAssistantConfig(existing, incoming);
        const activeProfile = getAiAssistantFunctionProfileSummary(runtimeConfig.activeProfileIds || runtimeConfig.activeProfileId);
        const systemPrompt = buildAiAssistantSystemPrompt({
            basePrompt: String(incoming.systemPrompt || '').trim() || DEFAULT_AI_ASSISTANT_SYSTEM_PROMPT,
            profileIds: activeProfile.ids
        });
        const baseURL = normalizeAiAssistantBaseUrl(
            incoming.baseURL
            ?? incoming.baseUrl
            ?? incoming.apiBaseUrl
            ?? runtimeConfig.baseURL
        );
        const model = String(incoming.model || runtimeConfig.model || '').trim();
        const apiKey = String(incoming.apiKey || runtimeConfig.apiKey || '').trim();
        const requestId = String(incoming.requestId || '').trim() || `ai-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.logger?.info?.(`AI 对话服务开始: requestId=${requestId}, model=${model || 'empty'}, stream=${incoming.stream === true}`);

        if (!apiKey) {
            this.logger?.warning?.(`AI 对话服务中止: requestId=${requestId}, API Key 为空`);
            return { success: false, error: 'API Key 不能为空' };
        }
        if (!model) {
            this.logger?.warning?.(`AI 对话服务中止: requestId=${requestId}, 模型名称为空`);
            return { success: false, error: '模型名称不能为空' };
        }

        const messageText = String(incoming.message || '').trim();
        const suppliedMessages = sanitizeChatMessages(incoming.messages);
        const conversation = suppliedMessages.filter((item) => item.role !== 'system');

        if (messageText) {
            const lastMessage = conversation[conversation.length - 1];
            if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== messageText) {
                conversation.push({ role: 'user', content: messageText });
            }
        }

        if (conversation.length === 0) {
            this.logger?.warning?.(`AI 对话服务中止: requestId=${requestId}, 消息为空`);
            return { success: false, error: '消息不能为空' };
        }

        try {
            const streamRequested = incoming.stream !== false;
            const requestOptions = {
                baseURL,
                apiKey,
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...conversation
                ]
            };

            if (!streamRequested) {
                this.logger?.info?.(`AI 对话服务使用非流式请求: requestId=${requestId}`);
                const completion = await postChatCompletions(requestOptions);
                const reply = String(completion?.choices?.[0]?.message?.content || '').trim();
                if (!reply) {
                    this.logger?.warning?.(`AI 对话服务返回空内容: requestId=${requestId}`);
                    return { success: false, error: '模型未返回有效内容' };
                }

                return {
                    success: true,
                    reply,
                    model,
                    baseURL,
                    activeProfileId: activeProfile.id,
                    activeProfileIds: activeProfile.ids,
                    activeProfile,
                    activeProfiles: getAiAssistantFunctionProfilesByIds(activeProfile.ids),
                    usage: completion.usage || null,
                    requestId
                };
            }

            const fetchFn = typeof globalThis.fetch === 'function'
                ? globalThis.fetch.bind(globalThis)
                : null;

            if (!fetchFn) {
                throw new Error('当前运行环境不支持 fetch');
            }

            const endpoint = `${normalizeAiAssistantBaseUrl(baseURL).replace(/\/+$/, '')}/chat/completions`;
            this.logger?.info?.(`AI 对话服务发起 HTTP 请求: requestId=${requestId}, endpoint=${endpoint}`);
            const response = await fetchWithTimeout(fetchFn, endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                    Accept: 'text/event-stream'
                },
                body: JSON.stringify({
                    model,
                    messages: requestOptions.messages,
                    stream: true
                })
            }, 60000, this.logger, requestId);

            this.logger?.info?.(`AI 对话服务已收到 HTTP 响应: requestId=${requestId}, status=${response.status}`);
            if (!response.ok) {
                const responseText = await response.text();
                let payload = null;
                try {
                    payload = responseText ? JSON.parse(responseText) : null;
                } catch (_) {
                    payload = null;
                }

                const errorMessage = payload?.error?.message
                    || payload?.message
                    || responseText
                    || `HTTP ${response.status}`;
                throw new Error(errorMessage);
            }

            const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
            const isStreamResponse = contentType.includes('text/event-stream')
                || contentType.includes('application/x-ndjson');
            this.logger?.info?.(`AI 对话服务响应类型: requestId=${requestId}, contentType=${contentType || 'unknown'}, stream=${isStreamResponse}`);

            let reply = '';
            let usage = null;

            if (isStreamResponse) {
                this.logger?.info?.(`AI 对话服务开始读取流: requestId=${requestId}`);
                const streamed = await readStreamChatCompletions(response, {
                    onDelta: (delta) => {
                        reply += delta;
                        this.logger?.debug?.(`AI 对话流式增量: requestId=${requestId}, deltaLength=${String(delta || '').length}, replyLength=${reply.length}`);
                        if (typeof this.app?.emitUiEvent === 'function') {
                            this.app.emitUiEvent(AI_ASSISTANT_CHANNELS.CHAT_STREAM, {
                                requestId,
                                delta,
                                content: reply,
                                model,
                                activeProfileId: activeProfile.id,
                                activeProfileIds: activeProfile.ids,
                                activeProfile
                            });
                        }
                    }
                });
                reply = String(streamed.reply || reply || '').trim();
                usage = streamed.usage || null;
            } else {
                const responseText = await response.text();
                let payload = null;
                try {
                    payload = responseText ? JSON.parse(responseText) : null;
                } catch (_) {
                    payload = null;
                }

                reply = String(payload?.choices?.[0]?.message?.content || '').trim();
                usage = payload?.usage || null;
            }

            if (!reply) {
                this.logger?.warning?.(`AI 对话服务返回空回复: requestId=${requestId}`);
                return { success: false, error: '模型未返回有效内容' };
            }

            this.logger?.info?.(`AI 对话服务完成: requestId=${requestId}, replyLength=${reply.length}`);
            return {
                success: true,
                reply,
                model,
                baseURL,
                activeProfileId: activeProfile.id,
                activeProfileIds: activeProfile.ids,
                activeProfile,
                activeProfiles: getAiAssistantFunctionProfilesByIds(activeProfile.ids),
                usage,
                requestId
            };
        } catch (error) {
            this.logger?.error?.(`AI 对话失败: ${error.message}`);
            return {
                success: false,
                error: error.message || 'AI 对话失败',
                requestId
            };
        }
    }
}

module.exports = {
    AiAssistantService,
    DEFAULT_AI_ASSISTANT_BASE_URL,
    DEFAULT_AI_ASSISTANT_MODEL,
    DEFAULT_AI_ASSISTANT_SYSTEM_PROMPT,
    DEFAULT_AI_ASSISTANT_PROFILE_ID,
    AI_ASSISTANT_FUNCTION_PROFILES,
    MAX_CHAT_HISTORY_MESSAGES,
    MAX_PERSISTED_CHAT_MESSAGES,
    DEFAULT_CONVERSATION_TITLE,
    mergeAiAssistantConfig,
    getAiAssistantFunctionProfile,
    getAiAssistantFunctionProfiles,
    getAiAssistantFunctionProfilesByIds,
    getAiAssistantFunctionProfileSummary,
    getAiAssistantFunctionProfilePromptHints,
    buildAiAssistantCapabilityPrompt,
    buildAiAssistantSystemPrompt,
    maskApiKey,
    normalizeAiAssistantBaseUrl,
    normalizeAiAssistantConfig,
    normalizeAiAssistantProfileId,
    normalizeAiAssistantProfileIds,
    normalizeConversationHistory,
    postChatCompletions,
    readStreamChatCompletions,
    extractStreamChatDelta,
    sanitizeAiAssistantConfigForRenderer,
    sanitizeChatMessages,
    sanitizePersistedChatMessages,
    createConversationSessionId,
    createConversationTitle,
    AI_ASSISTANT_CHANNELS
};
