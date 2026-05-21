const DEFAULT_API_CONFIG = {
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

function sanitizeId(value, fallback = 'temp-email-provider') {
    return String(value || fallback)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || fallback;
}

function normalizeSelectorList(rawList) {
    const items = Array.isArray(rawList)
        ? rawList
        : typeof rawList === 'string'
            ? rawList.split(/\r?\n/)
            : rawList && typeof rawList === 'object'
                ? [rawList]
                : [];

    const selectors = [];
    const seen = new Set();

    for (const item of items) {
        let selector = '';

        if (typeof item === 'string') {
            selector = item.trim();
        } else if (item && typeof item === 'object') {
            selector = String(
                item.selector
                || item.target
                || item.element
                || item.closeSelector
                || item.close_selector
                || item.dismissSelector
                || item.dismiss_selector
                || ''
            ).trim();
            if (!selector && String(item.action || item.type || '').trim().toLowerCase() === 'click') {
                selector = String(item.selector || item.target || item.element || '').trim();
            }
        }

        if (!selector || seen.has(selector)) {
            continue;
        }

        seen.add(selector);
        selectors.push(selector);
    }

    return selectors;
}

function normalizeProvider(raw = {}, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const name = String(source.name || source.siteName || source.id || `站点 ${index + 1}`).trim();
    const url = String(source.url || source.link || '').trim();
    const closePopupSelectors = normalizeSelectorList(
        source.closePopupSelectors
        || source.close_popup_selectors
        || source.closePopups
        || source.close_popups
        || source.initSteps
        || source.steps
        || source.init_steps
    );

    return {
        id: sanitizeId(source.id || name || `provider-${index + 1}`, `provider-${index + 1}`),
        name: name || `站点 ${index + 1}`,
        url,
        closePopupSelectors,
        emailElement: String(source.emailElement || source.email_element || source.emailSelector || source.email_selector || '').trim(),
        refreshButton: String(source.refreshButton || source.refresh_button || source.refreshSelector || source.refresh_selector || '').trim(),
        codeClickElement: String(source.codeClickElement || source.code_click_element || source.codeClickSelector || source.code_click_selector || '').trim(),
        codeElement: String(source.codeElement || source.code_element || source.codeSelector || source.code_selector || '').trim()
    };
}

function normalizeProviders(rawProviders) {
    if (!Array.isArray(rawProviders)) {
        return [];
    }

    return rawProviders.map((provider, index) => normalizeProvider(provider, index));
}

function mergeProviders(baseProviders = [], overrideProviders = []) {
    const merged = new Map();

    for (const provider of normalizeProviders(baseProviders)) {
        merged.set(provider.id, provider);
    }

    for (const provider of normalizeProviders(overrideProviders)) {
        if (!provider.id) {
            continue;
        }
        merged.set(provider.id, provider);
    }

    return Array.from(merged.values());
}

function normalizeOutlookAccount(raw = {}, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const email = String(source.email || source.account || source.username || '').trim();
    const password = String(source.password || source.pass || source.secret || '').trim();
    const status = String(source.status || source.state || source.result || '').trim();
    const url = String(source.url || source.link || source.fetchUrl || source.fetch_url || source.url1 || source.primaryUrl || '').trim();
    const url2 = String(source.url2 || source.link2 || source.fetchUrl2 || source.fetch_url_2 || source.secondaryUrl || '').trim();

    return {
        id: String(source.id || email || `outlook-${index + 1}`).trim() || `outlook-${index + 1}`,
        email,
        password,
        status,
        url,
        url2
    };
}

function normalizeOutlookAccounts(rawAccounts = []) {
    if (!Array.isArray(rawAccounts)) {
        return [];
    }

    const accounts = [];
    const seen = new Set();
    for (const [index, account] of rawAccounts.entries()) {
        const normalized = normalizeOutlookAccount(account, index);
        if (!normalized.email || !normalized.url) {
            continue;
        }

        const key = normalized.email.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        accounts.push(normalized);
    }

    return accounts;
}

function normalizeStep(rawStep = {}) {
    if (typeof rawStep === 'string') {
        return {
            action: 'click',
            selector: rawStep.trim()
        };
    }

    const source = rawStep && typeof rawStep === 'object' ? rawStep : {};
    const action = String(source.action || source.type || 'click').trim().toLowerCase();
    return {
        action,
        selector: String(source.selector || source.target || source.element || '').trim(),
        value: String(source.value || source.text || source.input || '').trim(),
        key: String(source.key || source.keys || '').trim(),
        url: String(source.url || source.link || '').trim(),
        waitMs: Number.isFinite(Number(source.waitMs ?? source.delay ?? source.timeout))
            ? Math.max(0, Number(source.waitMs ?? source.delay ?? source.timeout))
            : 0
    };
}

function ensureUniqueProviderId(providers = [], candidateId = '', excludeId = '') {
    const normalizedBase = sanitizeId(candidateId, 'temp-email-provider');
    const takenIds = new Set(
        (Array.isArray(providers) ? providers : [])
            .map((item) => String(item?.id || '').trim())
            .filter((id) => id && id !== String(excludeId || '').trim())
    );

    if (!takenIds.has(normalizedBase)) {
        return normalizedBase;
    }

    let suffix = 2;
    let nextId = `${normalizedBase}-${suffix}`;
    while (takenIds.has(nextId)) {
        suffix += 1;
        nextId = `${normalizedBase}-${suffix}`;
    }

    return nextId;
}

function mergeOutlookAccounts(baseAccounts = [], overrideAccounts = []) {
    const merged = new Map();

    for (const account of normalizeOutlookAccounts(baseAccounts)) {
        merged.set(account.email.toLowerCase(), account);
    }

    for (const account of normalizeOutlookAccounts(overrideAccounts)) {
        merged.set(account.email.toLowerCase(), account);
    }

    return Array.from(merged.values());
}

function resolveProviderById(providers = [], providerId = '') {
    const targetId = sanitizeId(providerId, '');
    if (!targetId) {
        return null;
    }

    return (Array.isArray(providers) ? providers : []).find((item) => item && item.id === targetId) || null;
}

function normalizeSessionId(value = '', fallback = 'default') {
    const sessionId = String(value || '').trim();
    return sessionId || fallback;
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

const VERIFICATION_STOP_WORDS = new Set([
    'your',
    'the',
    'and',
    'for',
    'from',
    'this',
    'that',
    'with',
    'code',
    'codes',
    'otp',
    'sms',
    'verification',
    'verify',
    'verifying',
    'is',
    'are',
    'was',
    'were',
    'be',
    'to',
    'of',
    'continue',
    'submit',
    'next',
    'send',
    'click',
    'open',
    'confirm',
    'ok',
    'done',
    'help',
    'identity',
    'login',
    'access',
    'security',
    'challenge',
    'welcome',
    'hello',
    'dear',
    'please',
    'thanks',
    'thank',
    'subject',
    'content',
    'message',
    'notification',
    'alert',
    'warning',
    'success',
    'failed',
    'available',
    'required',
    'temporary',
    'recovery',
    'reset',
    'password',
    'account',
    'email',
    'inbox',
    'sender',
    'recipient'
]);

const VERIFICATION_CONTEXT_KEYWORDS = [
    'verification',
    'verify',
    'code',
    'otp',
    'token',
    'passcode',
    'security',
    'auth',
    'login',
    'signup',
    'register',
    'challenge',
    'confirm',
    'confirm your',
    'email',
    'mail',
    '验证码',
    '校验码',
    '确认码',
    '安全码',
    '动态码',
    '登录码',
    '临时码'
];

const VERIFICATION_CODE_PATTERNS = [
    /([A-Z0-9]{3,4})[-\s]\s*([A-Z0-9]{3,4})[-\s]\s*([A-Z0-9]{3,4})/,
    /(?:verification\s+code|verify\s+code|auth\s+code|security\s+code|access\s+code|authenticator\s+code)[:：]?\s*([A-Z0-9]{4,15})/i,
    /(?:验证码|验证代码|校验码|确认码|激活码|注册码|安全码|动态码)[:：]?\s*([A-Z0-9]{4,15})/i,
    /(?:your\s+)?(?:verification|confirmation|activation|security|authentication)\s+code\s+(?:is|[:：])\s*([A-Z0-9]{4,15})/i,
    /(?:邮箱|email)(?:验证|验证码|确认码|安全码)[:：]?\s*([A-Z0-9]{4,15})/i,
    /email\s+(?:verification|confirmation|security)\s+code[:：]?\s*([A-Z0-9]{4,15})/i,
    /(?:code|pin|otp|token|passcode)[:：]?\s*([0-9]{4,8})/i,
    /(?:验证码|PIN码|动态码|短信码|数字码)[:：]?\s*([0-9]{4,8})/i,
    /(?:verification|security|auth|login)\s+code[:：]?\s*([0-9]{4,8})/i,
    /(?:验证|安全|认证|登录)\s*码[:：]?\s*([0-9]{4,8})/i,
    /(?:one-time\s+password|temporary\s+code)[:：]?\s*([A-Z0-9]{4,15})/i,
    /(?:一次性密码|临时码|临时验证码)[:：]?\s*([A-Z0-9]{4,15})/i,
    /(?:login|sign\s+in|signin)\s+code[:：]?\s*([A-Z0-9]{4,15})/i,
    /(?:登录|登入|登录码)[:：]?\s*([A-Z0-9]{4,15})/i,
    /(?:password\s+reset|reset\s+code|recovery\s+code)[:：]?\s*([A-Z0-9]{4,15})/i,
    /(?:密码重置|重置码|恢复码)[:：]?\s*([A-Z0-9]{4,15})/i
];

function normalizeVerificationText(text = '') {
    return String(text || '')
        .replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p\s*>/gi, '\n')
        .replace(/<\/div\s*>/gi, '\n')
        .replace(/<\/h[1-6]\s*>/gi, '\n')
        .replace(/<\/li\s*>/gi, '\n')
        .replace(/<\/tr\s*>/gi, '\n')
        .replace(/<\/table\s*>/gi, '\n')
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
    if (VERIFICATION_STOP_WORDS.has(normalizedLower)) {
        return '';
    }

    const compact = candidate.replace(/\s+/g, '').toUpperCase();
    if (/^\d{4,8}$/.test(compact)) {
        return compact;
    }

    if (/^[A-Z0-9]{4,15}$/.test(compact) && /\d/.test(compact)) {
        return compact;
    }

    if (/^[A-Z]{4,6}$/.test(compact)) {
        return compact;
    }

    return '';
}

function isLikelyVerificationCode(value = '') {
    const candidate = normalizeVerificationCandidate(value);
    return Boolean(candidate);
}

function summarizeTextForLog(text = '', maxLength = 240) {
    const compact = String(text || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!compact) {
        return '';
    }

    if (compact.length <= maxLength) {
        return compact;
    }

    return `${compact.slice(0, maxLength)}...`;
}

function hasVerificationContext(text = '') {
    const candidate = String(text || '').toLowerCase();
    if (!candidate) {
        return false;
    }

    return VERIFICATION_CONTEXT_KEYWORDS.some((keyword) => candidate.includes(keyword));
}

function isLikelyNotCode(value = '') {
    const text = String(value || '').trim();
    if (!text) {
        return true;
    }

    if (/(.)\1{3,}/.test(text)) {
        return true;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return true;
    }

    if (/^\d{2}:\d{2}(:\d{2})?$/.test(text)) {
        return true;
    }

    if (/^\d+\.\d+\.\d+\.\d+$/.test(text)) {
        return true;
    }

    return false;
}

function isLikelyCalendarYear(value = '') {
    const text = String(value || '').trim();
    if (!/^\d{4}$/.test(text)) {
        return false;
    }

    const year = Number(text);
    return Number.isFinite(year) && year >= 1900 && year <= 2099;
}

function splitVerificationLines(text = '') {
    return String(text || '')
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function hasCodeContextAroundText(text = '', candidate = '') {
    const normalizedText = normalizeVerificationText(text).toLowerCase();
    const normalizedCandidate = String(candidate || '').trim().toLowerCase();
    if (!normalizedText || !normalizedCandidate) {
        return false;
    }

    const candidateIndex = normalizedText.indexOf(normalizedCandidate);
    const windowText = candidateIndex >= 0
        ? normalizedText.slice(Math.max(0, candidateIndex - 40), candidateIndex + normalizedCandidate.length + 40)
        : normalizedText;

    return VERIFICATION_CONTEXT_KEYWORDS.some((keyword) => windowText.includes(keyword));
}

function extractCodeFromVerificationLine(line = '') {
    const candidate = String(line || '').trim();
    if (!candidate || !hasVerificationContext(candidate)) {
        return '';
    }

    const linePatterns = [
        /(?:your\s+)?(?:verification|confirmation|activation|security|authentication)\s+code\s*[:：]\s*([A-Z0-9]{4,15})/i,
        /(?:verification\s+code|verify\s+code|auth\s+code|security\s+code|access\s+code|authenticator\s+code)\s*[:：]\s*([A-Z0-9]{4,15})/i,
        /(?:验证码|验证代码|校验码|确认码|激活码|注册码|安全码|动态码)\s*[:：]\s*([A-Z0-9]{4,15})/i,
        /(?:your\s+)?(?:verification|confirmation|activation|security|authentication)\s+code\s+(?:is|:|：)\s*([A-Z0-9]{4,15})/i,
        /(?:验证码|验证代码|校验码|确认码|激活码|注册码|安全码|动态码)\s+(?:是|为|:|：)\s*([A-Z0-9]{4,15})/i
    ];

    for (const pattern of linePatterns) {
        const match = candidate.match(pattern);
        if (!match) {
            continue;
        }

        const code = normalizeVerificationCandidate(match[1]);
        if (code && !isLikelyNotCode(code) && (!isLikelyCalendarYear(code) || /[A-Z]/.test(code))) {
            return code;
        }
    }

    return '';
}

function isLikelyCodePromptLine(line = '') {
    const candidate = String(line || '').trim();
    if (!candidate || !hasVerificationContext(candidate)) {
        return false;
    }

    return (
        /(?:verification|confirmation|activation|security|authentication)\s+code\b/i.test(candidate)
        || /(?:verification\s+code|verify\s+code|auth\s+code|security\s+code|access\s+code|authenticator\s+code)\s*[:：]?\s*$/i.test(candidate)
        || /(?:your\s+)?(?:verification|confirmation|activation|security|authentication)\s+code(?:\s+is)?\s*[:：]?\s*$/i.test(candidate)
        || /(?:your\s+code(?:\s+is)?\s*[:：]?\s*)$/i.test(candidate)
        || /(?:code|otp|token|passcode)(?:\s+is)?\s*[:：]?\s*$/i.test(candidate)
    );
}

function extractVerificationCode(text = '') {
    const rawLines = String(text || '')
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter(Boolean);
    const normalizedText = normalizeVerificationText(text);

    if (!normalizedText) {
        return '';
    }

    for (const line of rawLines) {
        const lineCode = extractCodeFromVerificationLine(line);
        if (lineCode) {
            return lineCode;
        }
    }

    for (let index = 0; index < rawLines.length; index += 1) {
        const currentLine = rawLines[index];
        const previousLine = index > 0 ? rawLines[index - 1] : '';
        const currentCandidate = normalizeVerificationCandidate(currentLine);
        if (
            currentCandidate
            && isLikelyCodePromptLine(previousLine)
            && !isLikelyNotCode(currentCandidate)
            && (!isLikelyCalendarYear(currentCandidate) || /[A-Z]/.test(currentCandidate))
        ) {
            return currentCandidate;
        }
    }

    const exactCandidate = normalizeVerificationCandidate(normalizedText);
    if (
        exactCandidate
        && !isLikelyNotCode(exactCandidate)
        && (
            (/\d/.test(exactCandidate) && !isLikelyCalendarYear(exactCandidate))
            || hasCodeContextAroundText(normalizedText, exactCandidate)
        )
    ) {
        return exactCandidate;
    }

    for (const pattern of VERIFICATION_CODE_PATTERNS) {
        const match = normalizedText.match(pattern);
        if (!match) {
            continue;
        }

        const compact = match.slice(1).filter(Boolean).join('').replace(/[-_\s]/g, '');
        const code = normalizeVerificationCandidate(compact);
        if (code && !isLikelyNotCode(code)) {
            if (/^\d{4}$/.test(code) && isLikelyCalendarYear(code) && !hasCodeContextAroundText(normalizedText, code)) {
                continue;
            }
            return code;
        }
    }

    for (const line of rawLines) {
        if (!hasVerificationContext(line)) {
            continue;
        }

        const lineExact = normalizeVerificationCandidate(line);
        if (lineExact && !isLikelyNotCode(lineExact) && (!isLikelyCalendarYear(lineExact) || hasVerificationContext(line))) {
            return lineExact;
        }

        const lineMatches = line.match(/\b[A-Z0-9]{4,15}\b/gi) || [];
        lineMatches.sort((left, right) => {
            const leftNumeric = /^\d+$/.test(left) ? 1 : 0;
            const rightNumeric = /^\d+$/.test(right) ? 1 : 0;
            if (leftNumeric !== rightNumeric) {
                return rightNumeric - leftNumeric;
            }

            const leftMixed = /\d/.test(left) ? 1 : 0;
            const rightMixed = /\d/.test(right) ? 1 : 0;
            if (leftMixed !== rightMixed) {
                return rightMixed - leftMixed;
            }

            return right.length - left.length;
        });

        for (const candidate of lineMatches) {
            const code = normalizeVerificationCandidate(candidate);
            if (code && !isLikelyNotCode(code) && /\d/.test(code)) {
                return code;
            }
        }
    }

    return '';
}

function getRecordTimestamp(record = {}) {
    const candidates = [
        record.timestamp,
        record.created_at,
        record.createdAt,
        record.sent_at,
        record.sentAt,
        record.date,
        record.time
    ];

    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null || candidate === '') {
            continue;
        }

        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
            return candidate < 1e12 ? candidate * 1000 : candidate;
        }

        const numeric = Number(candidate);
        if (Number.isFinite(numeric)) {
            return numeric < 1e12 ? numeric * 1000 : numeric;
        }

        const parsed = Date.parse(String(candidate));
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return 0;
}

function extractVerificationCodeFromEmailRecord(record = {}) {
    return extractVerificationCodeFromEmailRecordDetailed(record).code;
}

function extractVerificationCodeFromEmailRecordDetailed(record = {}) {
    if (!record || typeof record !== 'object') {
        return {
            code: '',
            source: '',
            matchedText: ''
        };
    }

    const directFields = [
        ['code', record.code],
        ['verification_code', record.verification_code],
        ['verificationCode', record.verificationCode],
        ['otp', record.otp],
        ['otp_code', record.otp_code],
        ['otpCode', record.otpCode]
    ];

    for (const [source, value] of directFields) {
        const code = normalizeVerificationCandidate(value);
        if (code) {
            return {
                code,
                source,
                matchedText: summarizeTextForLog(value)
            };
        }
    }

    const candidates = [
        ['subject', record.subject],
        ['content', record.content],
        ['html_content', record.html_content],
        ['text', record.text],
        ['body', record.body],
        ['snippet', record.snippet]
    ];

    for (const [source, candidate] of candidates) {
        const rawText = String(candidate || '');
        const normalizedText = /<[^>]+>/.test(rawText) ? stripHtmlTags(rawText) : rawText;
        const code = extractVerificationCode(normalizedText);
        if (code) {
            return {
                code,
                source,
                matchedText: summarizeTextForLog(normalizedText)
            };
        }
    }

    return {
        code: '',
        source: '',
        matchedText: ''
    };
}

function normalizeApiConfig(source = {}) {
    const input = source && typeof source === 'object' ? source : {};
    const endpoints = input.endpoints && typeof input.endpoints === 'object' ? input.endpoints : {};

    return {
        name: String(input.name || input.apiName || DEFAULT_API_CONFIG.name).trim() || DEFAULT_API_CONFIG.name,
        baseUrl: String(input.baseUrl || input.baseURL || input.base_url || DEFAULT_API_CONFIG.baseUrl).trim() || DEFAULT_API_CONFIG.baseUrl,
        apiKey: String(input.apiKey || input.api_key || input.api_key_value || DEFAULT_API_CONFIG.apiKey).trim() || DEFAULT_API_CONFIG.apiKey,
        authHeaderName: String(input.authHeaderName || input.auth_header_name || DEFAULT_API_CONFIG.authHeaderName).trim() || DEFAULT_API_CONFIG.authHeaderName,
        authQueryName: String(input.authQueryName || input.auth_query_name || DEFAULT_API_CONFIG.authQueryName).trim() || DEFAULT_API_CONFIG.authQueryName,
        endpoints: {
            generateEmail: String(endpoints.generateEmail || endpoints.generate_email || DEFAULT_API_CONFIG.endpoints.generateEmail).trim() || DEFAULT_API_CONFIG.endpoints.generateEmail,
            emails: String(endpoints.emails || DEFAULT_API_CONFIG.endpoints.emails).trim() || DEFAULT_API_CONFIG.endpoints.emails,
            emailDetail: String(endpoints.emailDetail || endpoints.email_detail || DEFAULT_API_CONFIG.endpoints.emailDetail).trim() || DEFAULT_API_CONFIG.endpoints.emailDetail,
            deleteEmail: String(endpoints.deleteEmail || endpoints.delete_email || DEFAULT_API_CONFIG.endpoints.deleteEmail).trim() || DEFAULT_API_CONFIG.endpoints.deleteEmail,
            clearEmails: String(endpoints.clearEmails || endpoints.clear_emails || DEFAULT_API_CONFIG.endpoints.clearEmails).trim() || DEFAULT_API_CONFIG.endpoints.clearEmails,
            stats: String(endpoints.stats || DEFAULT_API_CONFIG.endpoints.stats).trim() || DEFAULT_API_CONFIG.endpoints.stats,
            statistics24h: String(endpoints.statistics24h || endpoints.statistics_24h || DEFAULT_API_CONFIG.endpoints.statistics24h).trim() || DEFAULT_API_CONFIG.endpoints.statistics24h,
            topSubjects: String(endpoints.topSubjects || endpoints.top_subjects || DEFAULT_API_CONFIG.endpoints.topSubjects).trim() || DEFAULT_API_CONFIG.endpoints.topSubjects,
            topDomains: String(endpoints.topDomains || endpoints.top_domains || DEFAULT_API_CONFIG.endpoints.topDomains).trim() || DEFAULT_API_CONFIG.endpoints.topDomains,
            topSenders: String(endpoints.topSenders || endpoints.top_senders || DEFAULT_API_CONFIG.endpoints.topSenders).trim() || DEFAULT_API_CONFIG.endpoints.topSenders
        },
        notes: String(input.notes || input.description || DEFAULT_API_CONFIG.notes).trim() || DEFAULT_API_CONFIG.notes
    };
}

module.exports = {
    DEFAULT_API_CONFIG,
    ensureUniqueProviderId,
    extractVerificationCode,
    extractVerificationCodeFromEmailRecord,
    extractVerificationCodeFromEmailRecordDetailed,
    getRecordTimestamp,
    hasCodeContextAroundText,
    hasVerificationContext,
    isLikelyCalendarYear,
    isLikelyNotCode,
    isLikelyVerificationCode,
    mergeOutlookAccounts,
    mergeProviders,
    normalizeApiConfig,
    normalizeOutlookAccount,
    normalizeOutlookAccounts,
    normalizeProvider,
    normalizeProviders,
    normalizeSelectorList,
    normalizeSessionId,
    normalizeStep,
    normalizeVerificationCandidate,
    extractCodeFromVerificationLine,
    normalizeVerificationText,
    resolveProviderById,
    sanitizeId,
    splitVerificationLines,
    stripHtmlTags,
    summarizeTextForLog
};
