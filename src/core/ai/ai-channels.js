const AI_ASSISTANT_CHANNELS = Object.freeze({
    GET_CONFIG: 'ai-assistant-get-config',
    SAVE_CONFIG: 'ai-assistant-save-config',
    GET_HISTORY: 'ai-assistant-get-history',
    SAVE_HISTORY: 'ai-assistant-save-history',
    CLEAR_HISTORY: 'ai-assistant-clear-history',
    DELETE_HISTORY_SESSION: 'ai-assistant-delete-history-session',
    CHAT: 'ai-assistant-chat',
    CHAT_STREAM: 'ai-assistant-chat-stream',
    HISTORY_UPDATED: 'ai-assistant-history-updated'
});

module.exports = {
    AI_ASSISTANT_CHANNELS
};
