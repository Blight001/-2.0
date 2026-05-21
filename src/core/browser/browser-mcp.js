const DEFAULT_INTERACTIVE_SELECTOR = [
    'button',
    'a[href]',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[contenteditable="true"]',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

const DEFAULT_MAX_ELEMENTS = 48;
const DEFAULT_SETTLE_MS = 250;
const DEFAULT_TEXT_LIMIT = 3500;
const DEFAULT_PROMPT_MAX_ELEMENTS = 12;
const DEFAULT_PROMPT_MAX_VISIBLE_TEXT_SEGMENTS = 4;
const DEFAULT_PROMPT_MAX_VISIBLE_TEXT_LENGTH = 120;
const DEFAULT_WEB_SEARCH_ENGINE = 'bing';
const WEB_SEARCH_ENGINES = Object.freeze({
    bing: {
        label: 'Bing',
        template: 'https://www.bing.com/search?q={query}'
    },
    google: {
        label: 'Google',
        template: 'https://www.google.com/search?q={query}'
    },
    duckduckgo: {
        label: 'DuckDuckGo',
        template: 'https://duckduckgo.com/?q={query}'
    },
    baidu: {
        label: '百度',
        template: 'https://www.baidu.com/s?wd={query}'
    }
});

function truncateText(value, limit = 160) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) {
        return '';
    }

    if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) {
        return text;
    }

    return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

function normalizeWebText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeWebUrl(value) {
    const text = normalizeWebText(value);
    if (!text) {
        throw new Error('网址不能为空');
    }

    if (/^about:blank$/i.test(text)) {
        return 'about:blank';
    }

    if (/^https?:\/\//i.test(text)) {
        const parsed = new URL(text);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('仅支持 http/https 网址');
        }
        return parsed.toString();
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(text)) {
        throw new Error('仅支持 http/https 网址');
    }

    const parsed = new URL(`https://${text.replace(/^\/+/, '')}`);
    return parsed.toString();
}

function normalizeSearchEngineName(value) {
    const text = normalizeWebText(value).toLowerCase();
    if (!text) {
        return DEFAULT_WEB_SEARCH_ENGINE;
    }

    if (WEB_SEARCH_ENGINES[text]) {
        return text;
    }

    if (text.includes('google')) {
        return 'google';
    }

    if (text.includes('duck')) {
        return 'duckduckgo';
    }

    if (text.includes('baidu') || text.includes('百度')) {
        return 'baidu';
    }

    return 'bing';
}

function buildSearchUrl(query = '', engine = DEFAULT_WEB_SEARCH_ENGINE) {
    const normalizedQuery = normalizeWebText(query);
    if (!normalizedQuery) {
        throw new Error('搜索关键词不能为空');
    }

    const normalizedEngine = normalizeSearchEngineName(engine);
    const engineConfig = WEB_SEARCH_ENGINES[normalizedEngine] || WEB_SEARCH_ENGINES[DEFAULT_WEB_SEARCH_ENGINE];
    const encodedQuery = encodeURIComponent(normalizedQuery);
    return engineConfig.template.replace('{query}', encodedQuery);
}

function normalizeActionTarget(target = {}) {
    if (!target || typeof target !== 'object') {
        return {};
    }

    const normalizedRole = String(target.role || '').trim().toLowerCase();
    const normalizedName = String(target.name || '').trim();
    const normalizedLabel = String(target.label || '').trim();
    const normalizedPlaceholder = String(target.placeholder || '').trim();
    const normalizedTestId = String(target.testId || target.test_id || '').trim();
    const normalizedAriaLabel = String(target.ariaLabel || target.aria_label || '').trim();

    return {
        mcpId: String(target.mcpId || target.mcp_id || '').trim(),
        selector: String(target.selector || '').trim(),
        text: String(target.text || '').trim(),
        role: normalizedRole,
        name: normalizedName,
        label: normalizedLabel,
        placeholder: normalizedPlaceholder,
        testId: normalizedTestId,
        ariaLabel: normalizedAriaLabel,
        timeout: isFiniteNumber(target.timeout) ? Math.max(0, Number(target.timeout)) : 8000,
        force: target.force === true,
        clear: target.clear !== false,
        delayMs: isFiniteNumber(target.delayMs) ? Math.max(0, Number(target.delayMs)) : 0,
        settleMs: isFiniteNumber(target.settleMs) ? Math.max(0, Number(target.settleMs)) : DEFAULT_SETTLE_MS
    };
}

function normalizeCompactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function splitVisibleTextSegments(text = '', maxSegments = 6, maxLength = 140) {
    const normalized = normalizeCompactText(text);
    if (!normalized) {
        return [];
    }

    let segments = normalized
        .replace(/([。！？!?；;])/g, '$1\n')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (segments.length <= 1) {
        const fallbackSegments = normalized
            .split(/\. (?=[A-Z0-9"'\[])/)
            .map((line) => line.trim())
            .filter(Boolean);

        if (fallbackSegments.length > 1) {
            segments = fallbackSegments;
        }
    }

    return segments.slice(0, maxSegments).map((line) => truncateText(line, maxLength));
}

function extractEmailCandidate(text = '') {
    const normalized = normalizeCompactText(text);
    if (!normalized) {
        return '';
    }

    const matches = normalized.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
    return matches && matches.length > 0 ? matches[0] : '';
}

function extractRefillCandidate(text = '') {
    const normalized = normalizeCompactText(text);
    if (!normalized) {
        return '';
    }

    const patterns = [
        /(Refill\s*:\s*[^\s]+)/i,
        /(倒计时\s*[:：]?\s*[^\s]+)/,
        /(剩余\s*[:：]?\s*[^\s]+)/,
        /(expires?\s*[:：]?\s*[^\s]+)/i
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match && match[0]) {
            return match[0];
        }
    }

    return '';
}

function extractStatusCandidate(text = '') {
    const normalized = normalizeCompactText(text);
    if (!normalized) {
        return '';
    }

    const patterns = [
        /(获取中\.{0,3})/,
        /(加载中\.{0,3})/,
        /(正在[^。！？!?\n]{0,20})/,
        /(loading\.{0,3})/i,
        /(ready\.{0,3})/i
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match && match[0]) {
            return match[0];
        }
    }

    return '';
}

function isActionLikeLabel(text = '') {
    const normalized = normalizeCompactText(text);
    if (!normalized) {
        return false;
    }

    return /^(复制|新建|刷新|重试|确定|取消|保存|提交|继续|下一步|开始|打开|关闭|生成|获取|切换|发送|同步|更新|查看|删除|编辑|选择|进入|重置|copy|create|refresh|retry|ok|cancel|save|submit|continue|next|start|open|close|generate|get|switch|send|sync|update|view|delete|edit|select|enter|reset)$/i.test(normalized)
        || /(复制|新建|刷新|重试|确定|取消|保存|提交|继续|下一步|开始|打开|关闭|生成|获取|切换|发送|同步|更新|查看|删除|编辑|选择|进入|重置|copy|create|refresh|retry|ok|cancel|save|submit|continue|next|start|open|close|generate|get|switch|send|sync|update|view|delete|edit|select|enter|reset)/i.test(normalized);
}

function scoreElementForSnapshot(item = {}) {
    const haystack = normalizeCompactText([
        item.text,
        item.placeholder,
        item.ariaLabel,
        item.value,
        item.name,
        item.role,
        item.type,
        item.href
    ].filter(Boolean).join(' '));

    let score = 0;
    if (/(复制|copy|新建|create|刷新|refresh|reload|rebuild|邮箱|mail|email|inbox|收件箱|验证码|code|otp|generate|get|获取中|加载中|language|语言|select)/i.test(haystack)) {
        score += 8;
    }
    if (isActionLikeLabel(item.text || item.ariaLabel || item.placeholder || item.value)) {
        score += 4;
    }
    if (item.tagName === 'select') {
        score += 6;
    } else if (item.tagName === 'input' || item.tagName === 'textarea') {
        score += 5;
    } else if (item.tagName === 'button') {
        score += 4;
    } else if (item.tagName === 'a') {
        score += 2;
    }
    if (item.inViewport) {
        score += 1;
    }
    if (item.disabled === true) {
        score -= 2;
    }
    if (normalizeCompactText(item.text || '').length <= 12 && normalizeCompactText(item.text || '')) {
        score += 1;
    }

    return score;
}

function getElementCategory(item = {}) {
    if (item.tagName === 'select') {
        return '选择';
    }
    if (item.tagName === 'input' || item.tagName === 'textarea') {
        return '输入';
    }
    if (item.tagName === 'button' || item.role === 'button' || item.role === 'link' || isActionLikeLabel(item.text || item.ariaLabel || item.placeholder || item.value)) {
        return '按钮';
    }
    if (item.tagName === 'a') {
        return '链接';
    }
    return '其他';
}

function formatElementSummary(item = {}, index = 0) {
    const parts = [`${index + 1}.`, getElementCategory(item)];
    parts.push(`[${item.mcpId || '-'}]`);
    parts.push(`<${item.tagName || 'unknown'}>`);
    if (item.text) parts.push(`text="${truncateText(item.text, 60)}"`);
    if (item.placeholder) parts.push(`placeholder="${truncateText(item.placeholder, 40)}"`);
    if (item.ariaLabel) parts.push(`aria="${truncateText(item.ariaLabel, 40)}"`);
    if (item.id) parts.push(`id="${truncateText(item.id, 40)}"`);
    if (item.className) parts.push(`class="${truncateText(item.className, 60)}"`);
    if (item.title) parts.push(`title="${truncateText(item.title, 40)}"`);
    if (item.datasetHint) parts.push(`data="${truncateText(item.datasetHint, 60)}"`);
    if (item.value && item.tagName !== 'button' && item.tagName !== 'a') parts.push(`value="${truncateText(item.value, 40)}"`);
    if (item.checked === true) parts.push('checked=true');
    if (item.disabled === true) parts.push('disabled=true');
    if (item.clickableHint) parts.push(`hint="${truncateText(item.clickableHint, 80)}"`);
    if (item.options && Array.isArray(item.options) && item.options.length > 0) {
        const optionText = item.options
            .slice(0, 6)
            .map((option) => `${option.text || option.value || '-'}${option.selected ? '*' : ''}`)
            .join(' | ');
        parts.push(`options=[${optionText}]`);
    }
    return parts.join(' ');
}

function buildAncestorHint(ancestors = []) {
    const source = Array.isArray(ancestors) ? ancestors : [];
    const hintParts = source
        .map((item) => {
            const tag = String(item?.tagName || '').trim();
            const text = truncateText(item?.text || '', 20);
            const id = String(item?.id || '').trim();
            const cls = String(item?.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
            const role = String(item?.role || '').trim();
            const label = [tag];
            if (id) label.push(`#${id}`);
            if (cls) label.push(`.${cls}`);
            if (role) label.push(`role=${role}`);
            if (text) label.push(`text=${text}`);
            return label.join('');
        })
        .filter(Boolean);

    return hintParts.join(' > ');
}

function buildElementSections(elements = [], maxElements = DEFAULT_MAX_ELEMENTS) {
    const source = Array.isArray(elements) ? elements : [];
    const prioritized = source
        .map((item) => ({ item, score: scoreElementForSnapshot(item) }))
        .sort((a, b) => b.score - a.score);

    const primaryItems = prioritized
        .filter((entry) => entry.score >= 6)
        .slice(0, Math.min(12, maxElements))
        .map((entry) => entry.item);

    const primarySet = new Set(primaryItems);
    const secondaryItems = source.filter((item) => !primarySet.has(item));

    return {
        primaryItems,
        secondaryItems
    };
}

function compactPromptText(value = '', limit = 120) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) {
        return '';
    }

    if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) {
        return text;
    }

    return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function buildLocatorHint(item = {}) {
    const role = compactPromptText(item.role || '', 40);
    const name = compactPromptText(item.name || item.ariaLabel || item.text || item.placeholder || item.value || '', 60);

    if (item.mcpId) {
        return `mcpId=${item.mcpId}`;
    }
    if (role && name) {
        return `role=${role} name=${name}`;
    }
    if (item.label) {
        return `label=${compactPromptText(item.label, 60)}`;
    }
    if (item.placeholder) {
        return `placeholder=${compactPromptText(item.placeholder, 60)}`;
    }
    if (item.ariaLabel) {
        return `aria=${compactPromptText(item.ariaLabel, 60)}`;
    }
    if (item.text) {
        return `text=${compactPromptText(item.text, 60)}`;
    }
    if (item.selector) {
        return `selector=${compactPromptText(item.selector, 80)}`;
    }
    return '';
}

function formatFrameOutlineNode(node = {}, depth = 0, maxDepth = 2) {
    const current = node && typeof node === 'object' ? node : {};
    const indent = '  '.repeat(Math.max(0, depth));
    const parts = [`${indent}- ${String(current.tagName || 'unknown').trim()}`];

    if (current.id) parts.push(`#${compactPromptText(current.id, 40)}`);
    if (current.className) parts.push(`.${compactPromptText(current.className, 60).replace(/\s+/g, '.')}`);
    if (current.role) parts.push(`role=${compactPromptText(current.role, 30)}`);
    if (current.text) parts.push(`text="${truncateText(current.text, 60)}"`);
    if (current.title) parts.push(`title="${truncateText(current.title, 40)}"`);
    if (current.rect && typeof current.rect === 'object') {
        const { x = 0, y = 0, width = 0, height = 0 } = current.rect;
        parts.push(`[${Math.round(x)},${Math.round(y)} ${Math.round(width)}x${Math.round(height)}]`);
    }
    if (Number.isFinite(current.interactiveCount)) {
        parts.push(`interactive=${current.interactiveCount}`);
    }
    if (Number.isFinite(current.childCount)) {
        parts.push(`children=${current.childCount}`);
    }

    const lines = [parts.join(' ')];
    if (depth >= maxDepth) {
        return lines;
    }

    const children = Array.isArray(current.children) ? current.children : [];
    for (const child of children.slice(0, 8)) {
        lines.push(...formatFrameOutlineNode(child, depth + 1, maxDepth));
    }

    return lines;
}

class BrowserMcp {
    constructor({ browserManager = null, logger = console } = {}) {
        this.browserManager = browserManager;
        this.logger = logger || console;
    }

    setBrowserManager(browserManager = null) {
        this.browserManager = browserManager;
    }

    setLogger(logger = console) {
        this.logger = logger || console;
    }

    _getBrowserPage(browserId) {
        const browserManager = this.browserManager;
        if (!browserManager || !browserId || typeof browserManager.getBrowser !== 'function') {
            return null;
        }

        const page = browserManager.getBrowser(browserId);
        if (!page || typeof page.isClosed !== 'function' || page.isClosed()) {
            return null;
        }

        return page;
    }

    _getBrowserData(browserId) {
        const browserManager = this.browserManager;
        if (!browserManager || !browserId || typeof browserManager.getBrowserData !== 'function') {
            return null;
        }

        const browserData = browserManager.getBrowserData(browserId);
        return browserData && typeof browserData === 'object' ? browserData : null;
    }

    _getBrowserContext(browserId) {
        const browserData = this._getBrowserData(browserId);
        if (browserData && browserData.context) {
            return browserData.context;
        }

        const page = this._getBrowserPage(browserId);
        if (!page || typeof page.context !== 'function') {
            return null;
        }

        try {
            return page.context();
        } catch (_error) {
            return null;
        }
    }

    _normalizePageMatcher(value) {
        return normalizeWebText(value).toLowerCase();
    }

    _buildPageDescriptor(page, index = 0, activePage = null, title = '') {
        if (!page) {
            return null;
        }

        return {
            index,
            title: normalizeWebText(title),
            url: typeof page.url === 'function' ? String(page.url() || '') : '',
            isCurrent: page === activePage,
            isClosed: typeof page.isClosed === 'function' ? page.isClosed() === true : false
        };
    }

    async _readPageTitle(page) {
        if (!page || typeof page.title !== 'function') {
            return '';
        }

        try {
            return normalizeWebText(await page.title());
        } catch (_error) {
            return '';
        }
    }

    async _collectPageEntries(browserId) {
        const context = this._getBrowserContext(browserId);
        const activePage = this._getBrowserPage(browserId);
        const pages = [];
        const seen = new Set();

        const pushPage = async (page, indexHint = 0) => {
            if (!page || seen.has(page)) {
                return;
            }

            seen.add(page);
            if (typeof page.isClosed === 'function' && page.isClosed()) {
                return;
            }

            const title = await this._readPageTitle(page);
            pages.push({
                page,
                index: pages.length,
                title,
                url: typeof page.url === 'function' ? String(page.url() || '') : '',
                isCurrent: page === activePage,
                isClosed: false
            });
        };

        if (context && typeof context.pages === 'function') {
            try {
                const contextPages = context.pages();
                for (let i = 0; i < contextPages.length; i += 1) {
                    await pushPage(contextPages[i], i);
                }
            } catch (_error) {}
        }

        if (activePage) {
            await pushPage(activePage, pages.length);
        }

        return pages;
    }

    async _collectPages(browserId) {
        const entries = await this._collectPageEntries(browserId);
        return entries.map((entry) => this._buildPageDescriptor(entry.page, entry.index, this._getBrowserPage(browserId), entry.title));
    }

    async _findPageEntryByTarget(browserId, target = {}) {
        const pages = await this._collectPageEntries(browserId);
        if (pages.length === 0) {
            return null;
        }

        const indexValue = Number(target.index);
        if (Number.isFinite(indexValue)) {
            const matchedByIndex = pages.find((item) => Number(item.index) === Number(indexValue));
            if (matchedByIndex) {
                return matchedByIndex;
            }
        }

        const matcherText = this._normalizePageMatcher(target.url || target.title || target.text || target.name);
        if (!matcherText) {
            return null;
        }

        return pages.find((item) => {
            const url = this._normalizePageMatcher(item.url);
            const title = this._normalizePageMatcher(item.title);
            return (url && url.includes(matcherText)) || (title && title.includes(matcherText));
        }) || null;
    }

    async _ensurePage(browserId) {
        const page = this._getBrowserPage(browserId);
        if (!page) {
            throw new Error(`浏览器页面不可用: ${browserId || 'unknown'}`);
        }

        try {
            if (typeof page.bringToFront === 'function') {
                await page.bringToFront();
            }
        } catch (_error) {}

        return page;
    }

    _buildSnapshotText(snapshot = {}) {
        const lines = [];
        lines.push(`URL: ${snapshot.url || '-'}`);
        lines.push(`标题: ${snapshot.title || '-'}`);
        lines.push(`视口: ${snapshot.viewport?.width || 0} x ${snapshot.viewport?.height || 0}`);

        const frameOutline = Array.isArray(snapshot?.layout?.outline) ? snapshot.layout.outline : [];
        if (frameOutline.length > 0) {
            lines.push('');
            lines.push('页面整体框架:');
            frameOutline.slice(0, 16).forEach((node) => {
                formatFrameOutlineNode(node, 0, 2).forEach((line) => lines.push(line));
            });
        }

        const activeElement = snapshot.activeElement;
        if (activeElement && typeof activeElement === 'object') {
            const activeParts = [];
            if (activeElement.mcpId) activeParts.push(`[${activeElement.mcpId}]`);
            if (activeElement.tagName) activeParts.push(`<${activeElement.tagName}>`);
            if (activeElement.text) activeParts.push(activeElement.text);
            if (activeParts.length > 0) {
                lines.push(`当前焦点: ${activeParts.join(' ')}`);
            }
        }

        const rawVisibleText = String(snapshot.visibleText || '').trim();
        const visibleTextSegments = splitVisibleTextSegments(rawVisibleText, 6, 150);
        const emailCandidate = extractEmailCandidate(rawVisibleText);
        const refillCandidate = extractRefillCandidate(rawVisibleText);
        const statusCandidate = extractStatusCandidate(rawVisibleText);
        const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];
        const selectElement = elements.find((item) => item && item.tagName === 'select');
        const languageLabel = selectElement ? [
            selectElement.value ? `当前=${selectElement.value}` : '',
            selectElement.options && Array.isArray(selectElement.options) && selectElement.options.length > 0
                ? `选项=${selectElement.options.slice(0, 6).map((option) => option.text || option.value || '-').join(' / ')}`
                : ''
        ].filter(Boolean).join('，') : '';

        lines.push('');
        lines.push('页面关键状态:');
        if (emailCandidate) {
            lines.push(`- 邮箱候选: ${emailCandidate}`);
        }
        if (refillCandidate) {
            lines.push(`- 刷新/倒计时: ${refillCandidate}`);
        }
        if (statusCandidate) {
            lines.push(`- 页面状态: ${statusCandidate}`);
        }
        if (languageLabel) {
            lines.push(`- 语言选择: ${languageLabel}`);
        }
        if (!emailCandidate && !refillCandidate && !statusCandidate && !languageLabel) {
            lines.push('- 暂无可直接识别的关键状态');
        }

        if (visibleTextSegments.length > 0) {
            lines.push('');
            lines.push('页面可见文本摘要:');
            visibleTextSegments.forEach((segment) => {
                lines.push(`- ${segment}`);
            });
        }

        lines.push('');
        const { primaryItems, secondaryItems } = buildElementSections(elements, DEFAULT_MAX_ELEMENTS);
        if (primaryItems.length > 0) {
            lines.push(`关键交互元素 (${primaryItems.length}):`);
            primaryItems.forEach((item, index) => {
                lines.push(formatElementSummary(item, index));
            });
        } else {
            lines.push('关键交互元素: 暂无');
        }

        if (secondaryItems.length > 0) {
            lines.push('');
            lines.push(`其他交互元素 (${secondaryItems.length}):`);
            secondaryItems.slice(0, DEFAULT_MAX_ELEMENTS).forEach((item, index) => {
                lines.push(formatElementSummary(item, index));
            });
        }

        return lines.join('\n');
    }

    async capturePageSnapshot(browserId, options = {}) {
        const page = await this._ensurePage(browserId);
        const maxElements = isFiniteNumber(options.maxElements)
            ? Math.max(1, Math.min(200, Number(options.maxElements)))
            : DEFAULT_MAX_ELEMENTS;
        const textLimit = isFiniteNumber(options.textLimit)
            ? Math.max(500, Math.min(20000, Number(options.textLimit)))
            : DEFAULT_TEXT_LIMIT;

        try {
            if (typeof page.waitForLoadState === 'function') {
                await page.waitForLoadState('domcontentloaded', { timeout: 1200 }).catch(() => {});
            }
        } catch (_error) {}

        const snapshot = await page.evaluate(({ interactiveSelector, maxElementsValue, textLimitValue }) => {
            const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const buildAncestorHint = (ancestors = []) => {
                const source = Array.isArray(ancestors) ? ancestors : [];
                return source
                    .map((item) => {
                        const tag = String(item?.tagName || '').trim();
                        const text = normalizeText(item?.text || '').slice(0, 20);
                        const id = String(item?.id || '').trim();
                        const cls = String(item?.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
                        const role = String(item?.role || '').trim();
                        const label = [tag];
                        if (id) label.push(`#${id}`);
                        if (cls) label.push(`.${cls}`);
                        if (role) label.push(`role=${role}`);
                        if (text) label.push(`text=${text}`);
                        return label.join('');
                    })
                    .filter(Boolean)
                    .join(' > ');
            };
            const visible = (element) => {
                if (!element || typeof element.getBoundingClientRect !== 'function') {
                    return false;
                }

                const rect = element.getBoundingClientRect();
                if (!rect || rect.width <= 0 || rect.height <= 0) {
                    return false;
                }

                const style = window.getComputedStyle(element);
                if (!style || style.display === 'none' || style.visibility === 'hidden') {
                    return false;
                }

                return rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
            };

            const compactRect = (element) => {
                const rect = element.getBoundingClientRect();
                return {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                };
            };

            const isFrameCandidate = (element, depth = 0) => {
                if (!element || typeof element.getBoundingClientRect !== 'function') {
                    return false;
                }

                const tagName = String(element.tagName || '').toLowerCase();
                const role = String(element.getAttribute?.('role') || '').trim().toLowerCase();
                const id = String(element.id || '').trim();
                const className = String(element.className || '').trim();
                const text = normalizeText(element.innerText || element.textContent || '');
                const interactiveCount = typeof element.querySelectorAll === 'function'
                    ? element.querySelectorAll(interactiveSelector).length
                    : 0;

                return Boolean(
                    depth === 0 ||
                    ['header', 'nav', 'main', 'aside', 'section', 'article', 'form', 'footer', 'dialog'].includes(tagName) ||
                    ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'dialog', 'form', 'region'].includes(role) ||
                    id ||
                    className ||
                    interactiveCount > 0 ||
                    text.length > 0
                );
            };

            const frameScore = (element, depth = 0) => {
                let score = 0;
                const tagName = String(element.tagName || '').toLowerCase();
                const role = String(element.getAttribute?.('role') || '').trim().toLowerCase();
                const className = String(element.className || '').trim();
                const text = normalizeText(element.innerText || element.textContent || '');
                const interactiveCount = typeof element.querySelectorAll === 'function'
                    ? element.querySelectorAll(interactiveSelector).length
                    : 0;

                if (depth === 0) score += 6;
                if (['header', 'nav', 'main', 'aside', 'section', 'article', 'form', 'footer', 'dialog'].includes(tagName)) score += 6;
                if (['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'dialog', 'form', 'region'].includes(role)) score += 5;
                if (element.id) score += 3;
                if (className) score += 2;
                if (interactiveCount > 0) score += Math.min(4, interactiveCount);
                if (text.length > 0) score += 1;
                return score;
            };

            const buildFrameNode = (element, depth = 0) => {
                const rect = compactRect(element);
                const tagName = String(element.tagName || '').toLowerCase();
                const role = normalizeText(element.getAttribute?.('role') || '');
                const text = normalizeText(element.innerText || element.textContent || '').slice(0, 120);
                const childElements = Array.from(element.children || []).filter((child) => visible(child));
                const childNodes = childElements
                    .map((child) => ({ child, score: frameScore(child, depth + 1) }))
                    .filter((entry) => isFrameCandidate(entry.child, depth + 1) && entry.score >= 4)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 4)
                    .map((entry) => buildFrameNode(entry.child, depth + 1))
                    .filter(Boolean);

                return {
                    tagName,
                    id: normalizeText(element.id || '').slice(0, 80),
                    className: normalizeText(element.className || '').replace(/\s+/g, ' ').slice(0, 120),
                    role,
                    text,
                    title: normalizeText(element.getAttribute?.('title') || '').slice(0, 120),
                    rect,
                    childCount: childElements.length,
                    interactiveCount: typeof element.querySelectorAll === 'function'
                        ? element.querySelectorAll(interactiveSelector).length
                        : 0,
                    children: childNodes
                };
            };

            document.querySelectorAll('[data-browser-mcp-id]').forEach((element) => {
                element.removeAttribute('data-browser-mcp-id');
            });

            const elements = [];
            const nodes = Array.from(document.querySelectorAll(interactiveSelector));
            for (const element of nodes) {
                if (elements.length >= maxElementsValue) {
                    break;
                }

                if (!visible(element)) {
                    continue;
                }

                const tagName = String(element.tagName || '').toLowerCase();
                const mcpId = `mcp-${Date.now()}-${elements.length + 1}`;
                element.setAttribute('data-browser-mcp-id', mcpId);

                const optionList = tagName === 'select'
                    ? Array.from(element.options || []).slice(0, 10).map((option) => ({
                        text: normalizeText(option.textContent || option.label || option.value || ''),
                        value: normalizeText(option.value || ''),
                        selected: option.selected === true
                    }))
                    : [];

                const rect = compactRect(element);
                elements.push({
                    index: elements.length,
                    mcpId,
                    tagName,
                    role: normalizeText(element.getAttribute('role') || ''),
                    type: normalizeText(element.getAttribute('type') || ''),
                    text: normalizeText(element.innerText || element.textContent || '').slice(0, 140),
                    placeholder: normalizeText(element.getAttribute('placeholder') || '').slice(0, 120),
                    ariaLabel: normalizeText(element.getAttribute('aria-label') || '').slice(0, 120),
                    id: normalizeText(element.id || '').slice(0, 80),
                    className: normalizeText(element.className || '').replace(/\s+/g, ' ').slice(0, 120),
                    title: normalizeText(element.getAttribute('title') || '').slice(0, 120),
                    datasetHint: normalizeText(Array.from(element.attributes || [])
                        .filter((attribute) => /^data-/i.test(attribute.name))
                        .map((attribute) => `${attribute.name}=${attribute.value}`)
                        .join(' | ')).slice(0, 160),
                    name: normalizeText(element.getAttribute('name') || '').slice(0, 80),
                    value: normalizeText(
                        tagName === 'input' || tagName === 'textarea' || tagName === 'select'
                            ? element.value || ''
                            : element.getAttribute('value') || ''
                    ).slice(0, 120),
                    checked: element.checked === true,
                    disabled: element.disabled === true,
                    href: tagName === 'a' ? normalizeText(element.href || '').slice(0, 200) : '',
                    options: optionList,
                    clickableHint: buildAncestorHint([
                        {
                            tagName: element.parentElement?.tagName || '',
                            id: element.parentElement?.id || '',
                            className: element.parentElement?.className || '',
                            role: element.parentElement?.getAttribute?.('role') || '',
                            text: element.parentElement?.innerText || element.parentElement?.textContent || ''
                        },
                        {
                            tagName: element.parentElement?.parentElement?.tagName || '',
                            id: element.parentElement?.parentElement?.id || '',
                            className: element.parentElement?.parentElement?.className || '',
                            role: element.parentElement?.parentElement?.getAttribute?.('role') || '',
                            text: element.parentElement?.parentElement?.innerText || element.parentElement?.parentElement?.textContent || ''
                        }
                    ]),
                    rect,
                    inViewport: rect.y >= 0 && rect.x >= 0 && rect.y + rect.height <= window.innerHeight && rect.x + rect.width <= window.innerWidth
                });
            }

            const visibleText = normalizeText(document.body ? document.body.innerText || '' : '').slice(0, textLimitValue);
            const activeElement = document.activeElement;
            const frameRoots = Array.from(document.body?.children || [])
                .filter((child) => visible(child))
                .map((child) => ({ child, score: frameScore(child, 0) }))
                .filter((entry) => isFrameCandidate(entry.child, 0) && entry.score >= 2)
                .sort((a, b) => b.score - a.score)
                .slice(0, 10)
                .map((entry) => buildFrameNode(entry.child, 0))
                .filter(Boolean);
            let activeSnapshot = null;
            if (activeElement && activeElement !== document.body) {
                const tagName = String(activeElement.tagName || '').toLowerCase();
                activeSnapshot = {
                    tagName,
                    text: normalizeText(activeElement.innerText || activeElement.textContent || '').slice(0, 140),
                    placeholder: normalizeText(activeElement.getAttribute?.('placeholder') || '').slice(0, 120),
                    ariaLabel: normalizeText(activeElement.getAttribute?.('aria-label') || '').slice(0, 120),
                    value: normalizeText(
                        tagName === 'input' || tagName === 'textarea' || tagName === 'select'
                            ? activeElement.value || ''
                            : activeElement.getAttribute?.('value') || ''
                    ).slice(0, 120),
                    mcpId: normalizeText(activeElement.getAttribute?.('data-browser-mcp-id') || ''),
                    role: normalizeText(activeElement.getAttribute?.('role') || ''),
                    type: normalizeText(activeElement.getAttribute?.('type') || '')
                };
            }

            return {
                url: String(location.href || ''),
                title: String(document.title || ''),
                viewport: {
                    width: Number(window.innerWidth) || 0,
                    height: Number(window.innerHeight) || 0
                },
                layout: {
                    outline: frameRoots
                },
                visibleText,
                activeElement: activeSnapshot,
                elementCount: elements.length,
                elements
            };
        }, {
            interactiveSelector: DEFAULT_INTERACTIVE_SELECTOR,
            maxElementsValue: maxElements,
            textLimitValue: textLimit
        });

        snapshot.snapshotText = this._buildSnapshotText(snapshot);
        snapshot.capturedAt = new Date().toISOString();
        return snapshot;
    }

    formatPageSnapshot(snapshot = {}) {
        const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
        return this._buildSnapshotText(safeSnapshot);
    }

    describeAction(action = {}) {
        const normalized = action && typeof action === 'object' ? action : {};
        const type = String(normalized.type || '').trim() || 'unknown';
        const target = normalized.target && typeof normalized.target === 'object' ? normalized.target : {};
        const parts = [type];

        if (target.mcpId) {
            parts.push(`[${String(target.mcpId).trim()}]`);
        } else if (target.selector) {
            parts.push(`selector=${truncateText(target.selector, 80)}`);
        } else if (target.text) {
            parts.push(`text="${truncateText(target.text, 60)}"`);
        } else if (target.url) {
            parts.push(`url=${truncateText(target.url, 80)}`);
        }

        if (normalized.reason) {
            parts.push(`- ${truncateText(normalized.reason, 100)}`);
        }

        return parts.join(' ');
    }

    async _resolveLocator(page, target = {}) {
        const normalized = normalizeActionTarget(target);

        if (normalized.mcpId) {
            return page.locator(`[data-browser-mcp-id="${normalized.mcpId.replace(/"/g, '\\"')}"]`);
        }

        if (normalized.testId) {
            return page.getByTestId(normalized.testId);
        }

        if (normalized.role) {
            const roleOptions = {};
            if (normalized.name) {
                roleOptions.name = normalized.name;
            } else if (normalized.label) {
                roleOptions.name = normalized.label;
            } else if (normalized.ariaLabel) {
                roleOptions.name = normalized.ariaLabel;
            } else if (normalized.placeholder) {
                roleOptions.name = normalized.placeholder;
            } else if (normalized.text) {
                roleOptions.name = normalized.text;
            }

            return page.getByRole(normalized.role, roleOptions);
        }

        if (normalized.label) {
            return page.getByLabel(normalized.label, { exact: false });
        }

        if (normalized.placeholder) {
            return page.getByPlaceholder(normalized.placeholder, { exact: false });
        }

        if (normalized.ariaLabel) {
            return page.getByLabel(normalized.ariaLabel, { exact: false });
        }

        if (normalized.text) {
            return page.getByText(normalized.text, { exact: false });
        }

        if (normalized.selector) {
            return page.locator(normalized.selector);
        }

        throw new Error('动作目标不能为空');
    }

    formatPageSnapshotForPrompt(snapshot = {}, options = {}) {
        const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
        const maxElements = isFiniteNumber(options.maxElements)
            ? Math.max(1, Math.min(50, Number(options.maxElements)))
            : DEFAULT_PROMPT_MAX_ELEMENTS;
        const maxVisibleTextSegments = isFiniteNumber(options.maxVisibleTextSegments)
            ? Math.max(1, Math.min(8, Number(options.maxVisibleTextSegments)))
            : DEFAULT_PROMPT_MAX_VISIBLE_TEXT_SEGMENTS;
        const maxVisibleTextLength = isFiniteNumber(options.maxVisibleTextLength)
            ? Math.max(60, Math.min(300, Number(options.maxVisibleTextLength)))
            : DEFAULT_PROMPT_MAX_VISIBLE_TEXT_LENGTH;
        const elements = Array.isArray(safeSnapshot.elements) ? safeSnapshot.elements.slice(0, maxElements) : [];
        const rawVisibleText = String(safeSnapshot.visibleText || '').trim();
        const selectElement = elements.find((item) => item && item.tagName === 'select');
        const languageLabel = selectElement ? [
            selectElement.value ? `当前=${selectElement.value}` : '',
            selectElement.options && Array.isArray(selectElement.options) && selectElement.options.length > 0
                ? `选项=${selectElement.options.slice(0, 6).map((option) => option.text || option.value || '-').join(' / ')}`
                : ''
        ].filter(Boolean).join('，') : '';

        return JSON.stringify({
            page: {
                url: String(safeSnapshot.url || ''),
                title: String(safeSnapshot.title || ''),
                viewport: {
                    width: Number(safeSnapshot.viewport?.width) || 0,
                    height: Number(safeSnapshot.viewport?.height) || 0
                }
            },
            layout: {
                outline: Array.isArray(safeSnapshot.layout?.outline) ? safeSnapshot.layout.outline : []
            },
            state: {
                elementCount: Number(safeSnapshot.elementCount) || elements.length,
                activeElement: safeSnapshot.activeElement && typeof safeSnapshot.activeElement === 'object'
                    ? {
                        mcpId: String(safeSnapshot.activeElement.mcpId || ''),
                        tagName: String(safeSnapshot.activeElement.tagName || ''),
                        role: String(safeSnapshot.activeElement.role || ''),
                        type: String(safeSnapshot.activeElement.type || ''),
                        text: compactPromptText(safeSnapshot.activeElement.text || '', 120),
                        placeholder: compactPromptText(safeSnapshot.activeElement.placeholder || '', 80),
                        ariaLabel: compactPromptText(safeSnapshot.activeElement.ariaLabel || '', 80),
                        value: compactPromptText(safeSnapshot.activeElement.value || '', 80)
                    }
                    : null,
                emailCandidate: extractEmailCandidate(rawVisibleText),
                refillCandidate: extractRefillCandidate(rawVisibleText),
                statusCandidate: extractStatusCandidate(rawVisibleText),
                languageSelection: compactPromptText(languageLabel, 120),
                visibleTextSummary: splitVisibleTextSegments(rawVisibleText, maxVisibleTextSegments, maxVisibleTextLength)
            },
            elements: elements.map((item, index) => ({
                index: Number(item?.index) >= 0 ? Number(item.index) : index,
                mcpId: String(item?.mcpId || ''),
                tagName: String(item?.tagName || ''),
                role: String(item?.role || ''),
                type: String(item?.type || ''),
                text: compactPromptText(item?.text || '', 80),
                placeholder: compactPromptText(item?.placeholder || '', 80),
                ariaLabel: compactPromptText(item?.ariaLabel || '', 80),
                name: compactPromptText(item?.name || item?.ariaLabel || item?.text || item?.placeholder || item?.value || '', 80),
                value: compactPromptText(item?.value || '', 80),
                checked: item?.checked === true,
                disabled: item?.disabled === true,
                href: compactPromptText(item?.href || '', 120),
                options: Array.isArray(item?.options)
                    ? item.options.slice(0, 6).map((option) => ({
                        text: compactPromptText(option?.text || '', 50),
                        value: compactPromptText(option?.value || '', 50),
                        selected: option?.selected === true
                    }))
                    : [],
                locatorHint: buildLocatorHint(item)
            }))
        }, null, 2);
    }

    async click(browserId, target = {}) {
        const page = await this._ensurePage(browserId);
        const normalized = normalizeActionTarget(target);
        const locator = await this._resolveLocator(page, normalized);
        const targetLocator = locator.first();

        try {
            const preClickResult = await targetLocator.evaluate((element) => {
                if (!element) {
                    return { clicked: false, reason: 'missing-element' };
                }

                const clickableRoot = element.closest?.('button, a, [role="button"], [onclick], [tabindex]:not([tabindex="-1"])') || element;
                if (clickableRoot && clickableRoot !== element && typeof clickableRoot.click === 'function') {
                    clickableRoot.scrollIntoView?.({ block: 'center', inline: 'center' });
                    clickableRoot.click();
                    return { clicked: true, reason: 'ancestor-click' };
                }

                return { clicked: false, reason: 'self-or-no-ancestor' };
            }).catch(() => ({ clicked: false, reason: 'evaluate-failed' }));

            if (preClickResult?.clicked === true) {
                if (normalized.settleMs > 0) {
                    await page.waitForTimeout(normalized.settleMs);
                }
                return { success: true, fallback: 'ancestor' };
            }

            await targetLocator.scrollIntoViewIfNeeded({ timeout: normalized.timeout }).catch(() => {});
            await targetLocator.click({
                timeout: normalized.timeout,
                force: normalized.force
            });
            if (normalized.settleMs > 0) {
                await page.waitForTimeout(normalized.settleMs);
            }
            return { success: true };
        } catch (error) {
            if (!normalized.force) {
                try {
                    await targetLocator.click({
                        timeout: Math.max(1000, Math.min(3000, normalized.timeout)),
                        force: true
                    });
                    if (normalized.settleMs > 0) {
                        await page.waitForTimeout(normalized.settleMs);
                    }
                    return { success: true, fallback: 'force' };
                } catch (_forceError) {}
            }

            try {
                await targetLocator.evaluate((element) => {
                    if (!element) {
                        return;
                    }

                    const clickableRoot = element.closest?.('button, a, [role="button"], [onclick], [tabindex]:not([tabindex="-1"])') || element;
                    try {
                        clickableRoot.scrollIntoView?.({ block: 'center', inline: 'center' });
                    } catch (_error) {}
                    if (typeof clickableRoot.click === 'function') {
                        clickableRoot.click();
                    } else {
                        clickableRoot.dispatchEvent(new MouseEvent('click', {
                            bubbles: true,
                            cancelable: true,
                            view: window
                        }));
                    }
                });
                if (normalized.settleMs > 0) {
                    await page.waitForTimeout(normalized.settleMs);
                }
                return { success: true, fallback: 'evaluate' };
            } catch (_evaluateError) {
                throw new Error(`点击失败: ${error.message}`);
            }
        }
    }

    async type(browserId, target = {}) {
        const page = await this._ensurePage(browserId);
        const normalized = normalizeActionTarget(target);
        const text = String(target.text ?? target.value ?? '').toString();
        if (!text) {
            throw new Error('输入内容不能为空');
        }

        const locator = await this._resolveLocator(page, normalized);
        const targetLocator = locator.first();

        try {
            await targetLocator.scrollIntoViewIfNeeded({ timeout: normalized.timeout }).catch(() => {});
            if (normalized.clear) {
                await targetLocator.fill(text, { timeout: normalized.timeout });
            } else {
                await targetLocator.click({ timeout: normalized.timeout, force: normalized.force }).catch(() => {});
                await targetLocator.type(text, { timeout: normalized.timeout, delay: normalized.delayMs }).catch(async () => {
                    await targetLocator.fill(text, { timeout: normalized.timeout });
                });
            }
            if (normalized.settleMs > 0) {
                await page.waitForTimeout(normalized.settleMs);
            }
            return { success: true };
        } catch (error) {
            throw new Error(`输入失败: ${error.message}`);
        }
    }

    async select(browserId, target = {}) {
        const page = await this._ensurePage(browserId);
        const normalized = normalizeActionTarget(target);
        const value = String(target.value ?? '').trim();
        const label = String(target.label ?? '').trim();
        if (!value && !label) {
            throw new Error('选择值不能为空');
        }

        const locator = await this._resolveLocator(page, normalized);
        const targetLocator = locator.first();

        try {
            await targetLocator.scrollIntoViewIfNeeded({ timeout: normalized.timeout }).catch(() => {});
            const option = value ? { value } : { label };
            await targetLocator.selectOption(option, { timeout: normalized.timeout });
            if (normalized.settleMs > 0) {
                await page.waitForTimeout(normalized.settleMs);
            }
            return { success: true };
        } catch (error) {
            throw new Error(`选择失败: ${error.message}`);
        }
    }

    async scroll(browserId, target = {}) {
        const page = await this._ensurePage(browserId);
        const normalized = normalizeActionTarget(target);
        const deltaY = isFiniteNumber(target.deltaY)
            ? Number(target.deltaY)
            : (String(target.direction || '').toLowerCase() === 'up' ? -800 : 800);
        const deltaX = isFiniteNumber(target.deltaX) ? Number(target.deltaX) : 0;

        try {
            if (normalized.selector || normalized.mcpId) {
                const locator = await this._resolveLocator(page, normalized);
                await locator.first().evaluate((element, delta) => {
                    if (element && typeof element.scrollTop === 'number') {
                        element.scrollTop += delta;
                    } else {
                        window.scrollBy(0, delta);
                    }
                }, deltaY);
            } else {
                await page.mouse.wheel(deltaX, deltaY);
            }

            if (normalized.settleMs > 0) {
                await page.waitForTimeout(normalized.settleMs);
            }

            return { success: true };
        } catch (error) {
            throw new Error(`滚动失败: ${error.message}`);
        }
    }

    async openUrl(browserId, target = {}) {
        const page = await this._ensurePage(browserId);
        const normalized = target && typeof target === 'object' ? target : {};
        const url = normalizeWebUrl(normalized.url || normalized.value || normalized.text || '');
        const waitUntil = normalized.waitUntil || 'domcontentloaded';
        const timeout = isFiniteNumber(normalized.timeout) ? Math.max(0, Number(normalized.timeout)) : 30000;
        const settleMs = isFiniteNumber(normalized.settleMs) ? Math.max(0, Number(normalized.settleMs)) : DEFAULT_SETTLE_MS;

        if (normalized.newTab === true) {
            const context = typeof page.context === 'function' ? page.context() : this._getBrowserContext(browserId);
            if (!context || typeof context.newPage !== 'function') {
                throw new Error('当前浏览器不支持新标签页');
            }

            const newPage = await context.newPage();
            await newPage.goto(url, { waitUntil, timeout });
            if (settleMs > 0) {
                await newPage.waitForTimeout(settleMs);
            }

            if (this.browserManager && typeof this.browserManager.setBrowserPage === 'function') {
                await this.browserManager.setBrowserPage(browserId, newPage).catch(() => {});
            }

            return {
                success: true,
                url,
                newTab: true,
                page: await this.getPageInfo(browserId)
            };
        }

        await page.goto(url, { waitUntil, timeout });
        if (settleMs > 0) {
            await page.waitForTimeout(settleMs);
        }

        return {
            success: true,
            url,
            newTab: false,
            page: await this.getPageInfo(browserId)
        };
    }

    async searchWeb(browserId, target = {}) {
        const normalized = target && typeof target === 'object' ? target : {};
        const query = normalizeWebText(normalized.query || normalized.text || normalized.value || '');
        if (!query) {
            throw new Error('搜索关键词不能为空');
        }

        const engine = normalizeSearchEngineName(normalized.engine || normalized.searchEngine || DEFAULT_WEB_SEARCH_ENGINE);
        const url = normalized.searchUrl
            ? normalizeWebUrl(normalized.searchUrl)
            : buildSearchUrl(query, engine);

        const result = await this.openUrl(browserId, {
            url,
            newTab: normalized.newTab !== false,
            waitUntil: normalized.waitUntil || 'domcontentloaded',
            timeout: normalized.timeout,
            settleMs: normalized.settleMs
        });

        const snapshot = normalized.captureSnapshot === false
            ? null
            : await this.capturePageSnapshot(browserId, {
                maxElements: normalized.maxElements,
                textLimit: normalized.textLimit
            });

        return {
            success: true,
            query,
            engine,
            url,
            result: result.page || null,
            snapshot
        };
    }

    async listPages(browserId) {
        const pages = await this._collectPages(browserId);
        return {
            success: true,
            browserId,
            currentPage: pages.find((item) => item.isCurrent) || pages[0] || null,
            pages,
            pageCount: pages.length
        };
    }

    async switchPage(browserId, target = {}) {
        const page = await this._ensurePage(browserId);
        const matchedPage = await this._findPageEntryByTarget(browserId, target);
        if (!matchedPage) {
            throw new Error('未找到可切换的页面');
        }

        const targetPage = matchedPage.page || page;
        if (this.browserManager && typeof this.browserManager.setBrowserPage === 'function') {
            await this.browserManager.setBrowserPage(browserId, targetPage);
        }

        if (typeof targetPage.bringToFront === 'function') {
            await targetPage.bringToFront().catch(() => {});
        }

        if (isFiniteNumber(target.settleMs) ? Number(target.settleMs) > 0 : DEFAULT_SETTLE_MS > 0) {
            await targetPage.waitForTimeout(isFiniteNumber(target.settleMs) ? Number(target.settleMs) : DEFAULT_SETTLE_MS).catch(() => {});
        }

        return {
            success: true,
            page: await this.getPageInfo(browserId)
        };
    }

    async getPageInfo(browserId) {
        const pagesResult = await this.listPages(browserId);
        return {
            success: true,
            browserId,
            activePage: pagesResult.currentPage,
            pages: pagesResult.pages,
            pageCount: pagesResult.pageCount
        };
    }

    async extractPageText(browserId, target = {}) {
        const page = await this._ensurePage(browserId);
        const normalized = target && typeof target === 'object' ? target : {};
        const maxLength = isFiniteNumber(normalized.maxLength)
            ? Math.max(100, Math.min(50000, Number(normalized.maxLength)))
            : DEFAULT_TEXT_LIMIT;

        if (normalized.selector || normalized.mcpId || normalized.role || normalized.name || normalized.label || normalized.placeholder || normalized.ariaLabel || normalized.text) {
            const locator = await this._resolveLocator(page, normalized);
            const text = await locator.first().innerText({ timeout: normalized.timeout || 8000 }).catch(async () => {
                return await locator.first().textContent({ timeout: normalized.timeout || 8000 }).catch(() => '');
            });
            return {
                success: true,
                text: truncateText(text, maxLength),
                source: 'element'
            };
        }

        const text = await page.evaluate(() => String(document.body?.innerText || '')).catch(() => '');
        return {
            success: true,
            text: truncateText(text, maxLength),
            source: 'page'
        };
    }

    async press(browserId, target = {}) {
        const page = await this._ensurePage(browserId);
        const normalized = normalizeActionTarget(target);
        const key = String(target.key || '').trim();
        if (!key) {
            throw new Error('按键不能为空');
        }

        try {
            if (normalized.selector || normalized.mcpId || normalized.text) {
                const locator = await this._resolveLocator(page, normalized);
                await locator.first().press(key, { timeout: normalized.timeout });
            } else {
                await page.keyboard.press(key);
            }

            if (normalized.settleMs > 0) {
                await page.waitForTimeout(normalized.settleMs);
            }

            return { success: true };
        } catch (error) {
            throw new Error(`按键失败: ${error.message}`);
        }
    }

    async wait(browserId, target = {}) {
        await this._ensurePage(browserId);
        const ms = isFiniteNumber(target.milliseconds)
            ? Math.max(0, Number(target.milliseconds))
            : (isFiniteNumber(target.seconds) ? Math.max(0, Number(target.seconds) * 1000) : 800);

        await new Promise((resolve) => setTimeout(resolve, ms));
        return { success: true };
    }

    async goto(browserId, target = {}) {
        const page = await this._ensurePage(browserId);
        const url = String(target.url || target.value || '').trim();
        if (!url) {
            throw new Error('跳转地址不能为空');
        }

        try {
            await page.goto(url, {
                waitUntil: target.waitUntil || 'domcontentloaded',
                timeout: isFiniteNumber(target.timeout) ? Math.max(0, Number(target.timeout)) : 30000
            });
            if (target.settleMs !== 0) {
                await page.waitForTimeout(isFiniteNumber(target.settleMs) ? Number(target.settleMs) : DEFAULT_SETTLE_MS);
            }
            return { success: true };
        } catch (error) {
            throw new Error(`跳转失败: ${error.message}`);
        }
    }

    async executeAction(browserId, action = {}) {
        const normalizedAction = action && typeof action === 'object' ? action : {};
        const type = String(normalizedAction.type || '').trim().toLowerCase();

        switch (type) {
            case 'click':
                return await this.click(browserId, normalizedAction.target || normalizedAction);
            case 'scroll':
                return await this.scroll(browserId, normalizedAction.target || normalizedAction);
            case 'goto':
            case 'open':
                return await this.goto(browserId, normalizedAction.target || normalizedAction);
            case 'open_url':
                return await this.openUrl(browserId, normalizedAction.target || normalizedAction);
            case 'search':
            case 'search_web':
                return await this.searchWeb(browserId, normalizedAction.target || normalizedAction);
            case 'list_pages':
                return await this.listPages(browserId);
            case 'switch_page':
                return await this.switchPage(browserId, normalizedAction.target || normalizedAction);
            case 'page_info':
                return await this.getPageInfo(browserId);
            case 'extract_text':
            case 'get_text':
                return await this.extractPageText(browserId, normalizedAction.target || normalizedAction);
            case 'type':
            case 'input':
                return await this.type(browserId, normalizedAction.target || normalizedAction);
            case 'select':
                return await this.select(browserId, normalizedAction.target || normalizedAction);
            case 'press':
                return await this.press(browserId, normalizedAction.target || normalizedAction);
            case 'wait':
                return await this.wait(browserId, normalizedAction.target || normalizedAction);
            case 'snapshot':
            case 'inspect':
                return {
                    success: true,
                    snapshot: await this.capturePageSnapshot(browserId, normalizedAction.target || normalizedAction)
                };
            default:
                throw new Error(`不支持的动作类型: ${type || 'unknown'}`);
        }
    }
}

module.exports = {
    BrowserMcp,
    DEFAULT_INTERACTIVE_SELECTOR,
    DEFAULT_MAX_ELEMENTS,
    DEFAULT_SETTLE_MS,
    truncateText
};
