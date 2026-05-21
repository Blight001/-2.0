const { IPC_CHANNELS } = require('../../core/ipc/channels');

const DEFAULT_GPTMAIL_API_CONFIG = {
    name: 'GPTMail API',
    baseUrl: 'https://mail.chatgpt.org.uk',
    apiKey: 'sk-gd97yXESjxYL',
    authHeaderName: 'X-API-Key',
    authQueryName: '',
    endpoints: {
        generateEmail: '/api/generate-email',
        emails: '/api/emails?email={email}',
        emailDetail: '/api/email/{id}',
        deleteEmail: '/api/email/{id}',
        clearEmails: '/api/emails/clear?email={email}',
        stats: '/api/stats',
        statistics24h: '/api/statistics/24h',
        topSubjects: '/api/statistics/top-subjects',
        topDomains: '/api/statistics/top-domains',
        topSenders: '/api/statistics/top-senders'
    },
    notes: '默认自动填入 API Key，生成邮箱后即可查询收件箱、查看详情、删除邮件和清空收件箱。'
};

function pickFirstText(...values) {
    for (const value of values) {
        const text = String(value ?? '').trim();
        if (text) {
            return text;
        }
    }
    return '';
}

function mergeApiConfig(source = {}) {
    const input = source && typeof source === 'object' ? source : {};
    const endpoints = input.endpoints && typeof input.endpoints === 'object' ? input.endpoints : {};

    return {
        name: pickFirstText(input.name, input.apiName, DEFAULT_GPTMAIL_API_CONFIG.name) || DEFAULT_GPTMAIL_API_CONFIG.name,
        baseUrl: pickFirstText(input.baseUrl, input.baseURL, input.base_url, DEFAULT_GPTMAIL_API_CONFIG.baseUrl) || DEFAULT_GPTMAIL_API_CONFIG.baseUrl,
        apiKey: pickFirstText(input.apiKey, input.api_key, input.api_key_value, DEFAULT_GPTMAIL_API_CONFIG.apiKey) || DEFAULT_GPTMAIL_API_CONFIG.apiKey,
        authHeaderName: pickFirstText(input.authHeaderName, input.auth_header_name, DEFAULT_GPTMAIL_API_CONFIG.authHeaderName) || DEFAULT_GPTMAIL_API_CONFIG.authHeaderName,
        authQueryName: pickFirstText(input.authQueryName, input.auth_query_name, DEFAULT_GPTMAIL_API_CONFIG.authQueryName) || DEFAULT_GPTMAIL_API_CONFIG.authQueryName,
        endpoints: {
            generateEmail: pickFirstText(
                endpoints.generateEmail,
                endpoints.generate_email,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.generateEmail
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.generateEmail,
            emails: pickFirstText(
                endpoints.emails,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.emails
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.emails,
            emailDetail: pickFirstText(
                endpoints.emailDetail,
                endpoints.email_detail,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.emailDetail
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.emailDetail,
            deleteEmail: pickFirstText(
                endpoints.deleteEmail,
                endpoints.delete_email,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.deleteEmail
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.deleteEmail,
            clearEmails: pickFirstText(
                endpoints.clearEmails,
                endpoints.clear_emails,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.clearEmails
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.clearEmails,
            stats: pickFirstText(
                endpoints.stats,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.stats
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.stats,
            statistics24h: pickFirstText(
                endpoints.statistics24h,
                endpoints.statistics_24h,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.statistics24h
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.statistics24h,
            topSubjects: pickFirstText(
                endpoints.topSubjects,
                endpoints.top_subjects,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.topSubjects
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.topSubjects,
            topDomains: pickFirstText(
                endpoints.topDomains,
                endpoints.top_domains,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.topDomains
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.topDomains,
            topSenders: pickFirstText(
                endpoints.topSenders,
                endpoints.top_senders,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.topSenders
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.topSenders
        },
        notes: pickFirstText(input.notes, input.description, DEFAULT_GPTMAIL_API_CONFIG.notes) || DEFAULT_GPTMAIL_API_CONFIG.notes
    };
}

function setResultCard(target, content, status = 'idle') {
    if (!target) {
        return;
    }

    target.innerHTML = '';
    target.className = `email-api-result-block email-api-result-block--${status}`;

    if (content === null || content === undefined || content === '') {
        const empty = document.createElement('div');
        empty.className = 'email-api-empty';
        empty.textContent = '暂无结果';
        target.appendChild(empty);
        return;
    }

    if (typeof content === 'string') {
        const text = document.createElement('div');
        text.className = status === 'error' ? 'email-api-status email-api-status--error' : 'email-api-status';
        text.textContent = content;
        target.appendChild(text);
        return;
    }

    if (Array.isArray(content)) {
        if (content.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'email-api-empty';
            empty.textContent = '暂无结果';
            target.appendChild(empty);
            return;
        }

        const list = document.createElement('div');
        list.className = 'email-api-list';
        for (const item of content) {
            const row = document.createElement('div');
            row.className = 'email-api-list-item';
            if (item && typeof item === 'object') {
                row.textContent = item.subject || item.email_address || item.id || JSON.stringify(item);
            } else {
                row.textContent = String(item);
            }
            list.appendChild(row);
        }
        target.appendChild(list);
        return;
    }

    if (typeof content === 'object') {
        if (content && Object.prototype.hasOwnProperty.call(content, 'detail') && Object.prototype.hasOwnProperty.call(content, 'verification_code')) {
            const wrapper = document.createElement('div');

            if (content.verification_code) {
                const codeBlock = document.createElement('div');
                codeBlock.className = 'email-api-value';
                codeBlock.textContent = `验证码: ${content.verification_code}`;
                wrapper.appendChild(codeBlock);
            }

            const pre = document.createElement('pre');
            pre.className = 'email-api-json';
            pre.textContent = JSON.stringify(content.detail, null, 2);
            wrapper.appendChild(pre);
            target.appendChild(wrapper);
            return;
        }

        const pre = document.createElement('pre');
        pre.className = 'email-api-json';
        pre.textContent = JSON.stringify(content, null, 2);
        target.appendChild(pre);
        return;
    }

    const text = document.createElement('div');
    text.className = 'email-api-status';
    text.textContent = String(content);
    target.appendChild(text);
}

function setStatusCard(target, message, status = 'idle') {
    if (!target) {
        return;
    }

    target.className = `email-api-status email-api-status--${status}`;
    target.textContent = message;
}

module.exports = {
    IPC_CHANNELS,
    DEFAULT_GPTMAIL_API_CONFIG,
    pickFirstText,
    mergeApiConfig,
    setResultCard,
    setStatusCard
};
