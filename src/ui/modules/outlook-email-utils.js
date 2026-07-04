const OUTLOOK_SELECTED_ACCOUNT_KEY = 'temp-email-outlook-selected-account-id';

const OUTLOOK_EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const OUTLOOK_URL_RE = /https?:\/\/[^\s]+/gi;

function normalizeUrl(value = '') {
    return String(value || '')
        .trim()
        .replace(/[),.;]+$/g, '');
}

function isUrlToken(value = '') {
    return /^https?:\/\//i.test(String(value || '').trim());
}

function sanitizeOutlookAccount(raw = {}, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const email = String(source.email || source.account || source.username || '').trim();
    const password = String(source.password || source.pass || source.secret || '').trim();
    const status = String(source.status || source.state || source.result || '').trim();
    const url = normalizeUrl(source.url || source.link || source.fetchUrl || source.fetch_url || source.url1 || source.primaryUrl || '');
    const url2 = normalizeUrl(source.url2 || source.link2 || source.fetchUrl2 || source.fetch_url_2 || source.secondaryUrl || '');

    return {
        id: String(source.id || email || `outlook-${index + 1}`).trim() || `outlook-${index + 1}`,
        email,
        password,
        status,
        url,
        url2
    };
}

function parseOutlookAccountLine(line = '', index = 0) {
    const text = String(line || '').trim();
    if (!text) {
        return null;
    }

    const emailMatch = text.match(OUTLOOK_EMAIL_RE);
    if (!emailMatch) {
        return null;
    }

    const email = String(emailMatch[0] || '').trim();
    const urls = Array.from(new Set((text.match(OUTLOOK_URL_RE) || []).map(normalizeUrl).filter(Boolean)));
    const tokens = text.split(/\s+/).map((item) => String(item || '').trim()).filter(Boolean);
    const emailIndex = tokens.findIndex((item) => item.toLowerCase().includes(email.toLowerCase()));
    const tokensAfterEmail = emailIndex >= 0 ? tokens.slice(emailIndex + 1) : tokens.slice(1);
    const nonUrlTokensAfterEmail = tokensAfterEmail.filter((item) => item !== '-' && item !== '—' && item !== '–' && item !== '―' && !isUrlToken(item));

    if (urls.length >= 2) {
        return sanitizeOutlookAccount({
            email,
            password: '',
            status: nonUrlTokensAfterEmail[0] || '',
            url: urls[0],
            url2: urls[1]
        }, index);
    }

    const parts = text.split(/\s*-{2,}\s*/).map((item) => String(item || '').trim()).filter(Boolean);
    if (parts.length >= 3) {
        const url = normalizeUrl(parts.slice(2).join('----'));
        if (url) {
            return sanitizeOutlookAccount({
                email: String(parts[0] || email).trim(),
                password: String(parts[1] || '').trim(),
                status: '',
                url
            }, index);
        }
    }

    if (urls.length === 1) {
        return sanitizeOutlookAccount({
            email,
            password: nonUrlTokensAfterEmail[0] || '',
            status: '',
            url: urls[0]
        }, index);
    }

    return null;
}

function parseOutlookAccountsFromText(text = '') {
    const accounts = [];
    const seen = new Set();
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const [index, line] of lines.entries()) {
        const account = parseOutlookAccountLine(line, index);
        if (!account) {
            continue;
        }

        const key = account.email.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        accounts.push(account);
    }

    return accounts;
}

function mergeOutlookAccounts(existingAccounts = [], importedAccounts = []) {
    const merged = new Map();

    for (const [index, account] of (Array.isArray(existingAccounts) ? existingAccounts : []).entries()) {
        const normalized = sanitizeOutlookAccount(account, index);
        if (!normalized.email) {
            continue;
        }
        merged.set(normalized.email.toLowerCase(), normalized);
    }

    for (const [index, account] of (Array.isArray(importedAccounts) ? importedAccounts : []).entries()) {
        const normalized = sanitizeOutlookAccount(account, index);
        if (!normalized.email) {
            continue;
        }
        merged.set(normalized.email.toLowerCase(), normalized);
    }

    return Array.from(merged.values());
}

module.exports = {
    OUTLOOK_SELECTED_ACCOUNT_KEY,
    parseOutlookAccountsFromText,
    mergeOutlookAccounts
};
