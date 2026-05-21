const BROWSER_OPEN_URL_CHANNEL = 'browser-open-url';

const COMMON_OPEN_URLS = [
    {
        keywords: ['百度', 'baidu'],
        label: '百度',
        url: 'https://www.baidu.com'
    },
    {
        keywords: ['必应', 'bing'],
        label: '必应',
        url: 'https://www.bing.com'
    },
    {
        keywords: ['谷歌', 'google'],
        label: '谷歌',
        url: 'https://www.google.com'
    },
    {
        keywords: ['github'],
        label: 'GitHub',
        url: 'https://github.com'
    },
    {
        keywords: ['知乎', 'zhihu'],
        label: '知乎',
        url: 'https://www.zhihu.com'
    }
];

function normalizeString(value) {
    return String(value || '').trim();
}

function normalizeUrlCandidate(value = '') {
    const text = normalizeString(value);
    if (!text) {
        return '';
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(text)) {
        return text;
    }

    if (/^www\./i.test(text) || /^[\w.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(text)) {
        return `https://${text}`;
    }

    return '';
}

function extractOpenUrlRequest(text = '') {
    const input = normalizeString(text);
    if (!input) {
        return null;
    }

    const explicitUrlMatch = input.match(/https?:\/\/[^\s]+/i) || input.match(/\bwww\.[^\s]+/i);
    if (explicitUrlMatch && explicitUrlMatch[0]) {
        const url = normalizeUrlCandidate(explicitUrlMatch[0]);
        if (url) {
            return {
                type: 'open_url',
                url,
                label: url,
                source: 'explicit-url'
            };
        }
    }

    const openVerbMatch = /(打开|访问|进入|前往|去|浏览)/.test(input);
    if (!openVerbMatch) {
        return null;
    }

    const lowerText = input.toLowerCase();
    for (const item of COMMON_OPEN_URLS) {
        if (!Array.isArray(item.keywords)) {
            continue;
        }

        const matched = item.keywords.some((keyword) => {
            const keywordText = normalizeString(keyword).toLowerCase();
            return keywordText && lowerText.includes(keywordText);
        });

        if (matched) {
            return {
                type: 'open_url',
                url: item.url,
                label: item.label,
                source: 'keyword'
            };
        }
    }

    return null;
}

module.exports = {
    BROWSER_OPEN_URL_CHANNEL,
    COMMON_OPEN_URLS,
    extractOpenUrlRequest,
    normalizeUrlCandidate
};
