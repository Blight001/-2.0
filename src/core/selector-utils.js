function defaultEscapeCssIdentifier(value) {
    const text = String(value ?? '').trim();
    if (!text) {
        return '';
    }

    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(text);
    }

    return text.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function parseNativeElementAttributes(rawAttributes = '') {
    const attributes = {};
    const attrPattern = /([^\s=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let attrMatch;

    while ((attrMatch = attrPattern.exec(rawAttributes)) !== null) {
        const key = String(attrMatch[1] || '').trim();
        if (!key || key === '/') {
            continue;
        }

        attributes[key.toLowerCase()] = String(attrMatch[2] || attrMatch[3] || attrMatch[4] || '').trim();
    }

    return attributes;
}

function isLikelyDynamicId(value = '') {
    const text = String(value || '').trim();
    if (!text) {
        return false;
    }

    if (
        /^react-aria\d*(?:-|$)/i.test(text)
        || /^react-select\d*(?:-|$)/i.test(text)
        || /^(?:chakra|mui|radix|headlessui|floating-ui|ember|svelte|vue|ng|ant)-/i.test(text)
    ) {
        return true;
    }

    if (/[_:-][a-z0-9]{3,}$/i.test(text) && /\d/.test(text)) {
        return true;
    }

    if (/[a-f0-9]{8,}/i.test(text) && /\d/.test(text)) {
        return true;
    }

    return false;
}

function isLikelyStableClassName(value = '') {
    const text = String(value || '').trim();
    if (!text) {
        return false;
    }

    if (/\s/.test(text)) {
        return false;
    }

    if (/[A-Z]/.test(text)) {
        return false;
    }

    if (/\d/.test(text) && /[a-z]/i.test(text)) {
        return false;
    }

    if (/^(?:react|chakra|mui|radix|headlessui|sc|css|title)-/i.test(text) && /\d/.test(text)) {
        return false;
    }

    return true;
}

function buildHasTextSelector(prefix, innerText) {
    const text = String(innerText ?? '').trim();
    if (!text) {
        return String(prefix || '').trim();
    }

    const normalizedPrefix = String(prefix || '').trim();
    return normalizedPrefix
        ? `${normalizedPrefix}:has-text(${JSON.stringify(text)})`
        : `:has-text(${JSON.stringify(text)})`;
}

function extractNativeElementSelectorCandidates(selector = '', options = {}) {
    const normalized = String(selector || '').trim();
    if (!normalized || normalized[0] !== '<') {
        return [];
    }

    const elementMatch = normalized.match(/^<\s*([a-zA-Z][\w:-]*)\b([^>]*)>([\s\S]*)<\/\s*\1\s*>$/)
        || normalized.match(/^<\s*([a-zA-Z][\w:-]*)\b([^>]*)\/?\s*>$/);
    if (!elementMatch) {
        return [];
    }

    const escapeCssIdentifier = typeof options.escapeCssIdentifier === 'function'
        ? options.escapeCssIdentifier
        : defaultEscapeCssIdentifier;
    const [, tagName, rawAttributes, innerHtml] = elementMatch;
    const selectors = [];
    const attributes = parseNativeElementAttributes(rawAttributes);
    const textContent = String(innerHtml || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const addSelector = (value) => {
        const normalizedSelector = String(value || '').trim();
        if (!normalizedSelector || selectors.includes(normalizedSelector)) {
            return;
        }

        selectors.push(normalizedSelector);
    };

    if (attributes.placeholder) {
        addSelector(`${tagName}[placeholder=${JSON.stringify(attributes.placeholder)}]`);
    }

    if (attributes['aria-label']) {
        addSelector(`${tagName}[aria-label=${JSON.stringify(attributes['aria-label'])}]`);
    }

    if (attributes.name) {
        addSelector(`${tagName}[name=${JSON.stringify(attributes.name)}]`);
    }

    if (attributes['data-testid']) {
        addSelector(`${tagName}[data-testid=${JSON.stringify(attributes['data-testid'])}]`);
    }

    if (attributes.slot) {
        addSelector(buildHasTextSelector(`${tagName}[slot=${JSON.stringify(attributes.slot)}]`, textContent));
        if (!textContent) {
            addSelector(`${tagName}[slot=${JSON.stringify(attributes.slot)}]`);
        }
    }

    if (attributes.role) {
        addSelector(buildHasTextSelector(`[role=${JSON.stringify(attributes.role)}]`, textContent));
        if (!textContent) {
            addSelector(`[role=${JSON.stringify(attributes.role)}]`);
        }
    }

    if (textContent) {
        addSelector(buildHasTextSelector(tagName, textContent));
    }

    if (attributes.id && !isLikelyDynamicId(attributes.id)) {
        addSelector(buildHasTextSelector(`#${escapeCssIdentifier(attributes.id)}`, textContent));
        if (!textContent) {
            addSelector(`#${escapeCssIdentifier(attributes.id)}`);
        }
    }

    const classNames = String(attributes.class || '')
        .split(/\s+/)
        .map(item => item.trim())
        .filter(Boolean)
        .filter(isLikelyStableClassName);
    if (classNames.length > 0) {
        const classSelector = `${tagName}${classNames.map(className => `.${escapeCssIdentifier(className)}`).join('')}`;
        addSelector(buildHasTextSelector(classSelector, textContent));
        if (!textContent) {
            addSelector(classSelector);
        }
    }

    return selectors;
}

module.exports = {
    defaultEscapeCssIdentifier,
    extractNativeElementSelectorCandidates,
    isLikelyDynamicId,
    isLikelyStableClassName,
    parseNativeElementAttributes,
    buildHasTextSelector
};
