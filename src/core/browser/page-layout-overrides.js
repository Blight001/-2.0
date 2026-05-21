const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

function hashPart(value) {
    return crypto
        .createHash('sha256')
        .update(String(value || ''), 'utf8')
        .digest('hex');
}

function normalizeUrlKey(url) {
    try {
        const parsed = new URL(String(url || '').trim());
        parsed.hash = '';
        return parsed.toString();
    } catch (_error) {
        return String(url || '').trim();
    }
}

function normalizeBrowserUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw)) {
        return raw;
    }
    return `https://${raw}`;
}

async function resolveLayoutPath({ resourceRoot, cardKey, cardName, url }) {
    const root = resourceRoot || path.resolve(process.cwd(), 'resource');
    const keyHash = hashPart(cardKey).slice(0, 24);
    const cardHash = hashPart(cardName).slice(0, 24);
    const urlHash = hashPart(normalizeUrlKey(url)).slice(0, 24);
    const dirPath = path.join(root, 'test_card_page_layouts', keyHash, cardHash);
    await fs.ensureDir(dirPath);
    return path.join(dirPath, `${urlHash}.json`);
}

async function readLayoutOverride(scope) {
    try {
        const filePath = await resolveLayoutPath(scope);
        if (!(await fs.pathExists(filePath))) {
            return null;
        }
        const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_error) {
        return null;
    }
}

async function saveLayoutOverride(scope, snapshot = {}) {
    const filePath = await resolveLayoutPath(scope);
    const payload = {
        version: 1,
        cardName: String(scope.cardName || '').trim(),
        url: normalizeUrlKey(scope.url),
        savedAt: new Date().toISOString(),
        title: String(snapshot.title || '').slice(0, 500),
        operations: Array.isArray(snapshot.operations) ? snapshot.operations : [],
        fullHtml: String(snapshot.fullHtml || '')
    };
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return filePath;
}

function buildApplyScript(override = null, targetUrl = '') {
    const operations = Array.isArray(override?.operations) ? override.operations : [];
    if (operations.length === 0) {
        return '';
    }

    return `
(() => {
    const operations = ${JSON.stringify(operations)};
    const targetUrl = ${JSON.stringify(normalizeUrlKey(targetUrl || override.url || ''))};
    const applied = new Set();
    const normalizeUrl = (value) => {
        try {
            const parsed = new URL(String(value || ''));
            parsed.hash = '';
            return parsed.toString();
        } catch (_error) {
            return String(value || '');
        }
    };
    const isTargetPage = () => {
        if (!targetUrl) return true;
        const current = normalizeUrl(window.location.href);
        if (current === targetUrl) return true;
        try {
            return new URL(current).origin === new URL(targetUrl).origin;
        } catch (_error) {
            return false;
        }
    };

    const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const findByCandidates = (operation) => {
        const candidates = Array.isArray(operation.selectorCandidates) ? operation.selectorCandidates : [];
        for (const selector of [operation.selector, ...candidates]) {
            if (!selector) continue;
            try {
                const element = document.querySelector(selector);
                if (element) return element;
            } catch (_error) {
            }
        }

        const tagName = String(operation.tagName || '').toLowerCase();
        const text = normalizeText(operation.text);
        const ariaLabel = normalizeText(operation.ariaLabel);
        const classList = Array.isArray(operation.classList)
            ? operation.classList.filter((item) => item && !String(item).startsWith('__ai_layout_editor_'))
            : [];
        if (!tagName && !text && !ariaLabel && classList.length === 0) {
            return null;
        }

        const elements = Array.from(document.querySelectorAll(tagName || '*'));
        return elements.find((element) => {
            let score = 0;
            let hasStrongMatcher = false;
            const elementAriaLabel = normalizeText(element.getAttribute('aria-label'));
            const elementText = normalizeText(element.innerText || element.textContent).slice(0, 160);

            if (ariaLabel) {
                if (elementAriaLabel !== ariaLabel) {
                    return false;
                }
                score += 4;
                hasStrongMatcher = true;
            }
            if (text) {
                if (elementText !== text) {
                    return false;
                }
                score += 3;
                hasStrongMatcher = true;
            }
            if (classList.length > 0) {
                const elementClasses = new Set(String(element.className || '').split(/\\s+/).filter(Boolean));
                const matchedClasses = classList.filter((item) => elementClasses.has(item));
                if (!hasStrongMatcher && matchedClasses.length < 1) {
                    return false;
                }
                score += matchedClasses.length;
            }
            return score > 0;
        }) || null;
    };

    const applyOne = (operation, index) => {
        if (!operation) return false;
        const key = String(operation.action || '') + '::' + String(operation.selector || '') + '::' + index;
        const element = findByCandidates(operation);
        if (!element) return false;
        if (operation.action === 'delete') {
            if (!applied.has(key)) {
                element.remove();
                applied.add(key);
            }
            return true;
        }
        if (operation.action === 'style') {
            const styleText = String(operation.style || '');
            if (styleText) {
                element.setAttribute('style', styleText);
            } else {
                element.removeAttribute('style');
            }
            applied.add(key);
            return true;
        }
        return false;
    };

    const applySavedLayout = () => {
        if (!isTargetPage()) return;
        try {
            operations.forEach((operation, index) => applyOne(operation, index));
        } catch (error) {
            console.warn('应用保存的页面布局失败:', error);
        }
    };

    let retryCount = 0;
    const retryTimer = window.setInterval(() => {
        retryCount += 1;
        applySavedLayout();
        if (retryCount >= 40) {
            window.clearInterval(retryTimer);
        }
    }, 500);

    const observer = new MutationObserver(() => {
        window.clearTimeout(window.__AI_TEST_CARD_LAYOUT_APPLY_TIMER__);
        window.__AI_TEST_CARD_LAYOUT_APPLY_TIMER__ = window.setTimeout(applySavedLayout, 120);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applySavedLayout, { once: true });
    } else {
        applySavedLayout();
    }
    try {
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
        window.setTimeout(() => observer.disconnect(), 30000);
    } catch (_error) {
    }
})();
`;
}

async function installLayoutOverride(context, scope) {
    if (!context || typeof context.addInitScript !== 'function') {
        return { installed: false, override: null };
    }

    const override = await readLayoutOverride(scope);
    const script = buildApplyScript(override, scope.url);
    if (!script) {
        return { installed: false, override };
    }

    await context.addInitScript({ content: script });
    return { installed: true, override };
}

async function exposeLayoutSave(page, scope, logger = null) {
    if (!page || typeof page.exposeFunction !== 'function') {
        return false;
    }

    await page.exposeFunction('__aiSaveTestCardLayoutOverride__', async (snapshot) => {
        await saveLayoutOverride(scope, snapshot);
        logger?.info?.(`测试卡片页面布局已保存: ${scope.cardName} -> ${normalizeUrlKey(scope.url)}`);
        return { success: true };
    });
    return true;
}

async function injectLayoutEditor(page, context = {}) {
    await page.evaluate(({ cardName, hasSavedLayout }) => {
        const existing = document.getElementById('__ai_layout_editor_toolbar__');
        if (existing) {
            existing.remove();
        }

        const style = document.createElement('style');
        style.id = '__ai_layout_editor_style__';
        style.textContent = `
#__ai_layout_editor_toolbar__ {
  position: fixed; top: 12px; left: 12px; z-index: 2147483647;
  display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
  max-width: calc(100vw - 24px); padding: 8px; background: rgba(17, 24, 39, 0.94);
  color: #fff; border: 1px solid rgba(255,255,255,0.16); border-radius: 8px;
  font: 12px/1.4 Arial, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,0.22);
}
#__ai_layout_editor_toolbar__ button {
  border: 0; border-radius: 5px; padding: 5px 8px; cursor: pointer;
  background: #e5e7eb; color: #111827; font: inherit;
}
#__ai_layout_editor_toolbar__ button[data-primary="true"] { background: #2563eb; color: #fff; }
#__ai_layout_editor_toolbar__ .__ai_layout_editor_title {
  font-weight: 700; margin-right: 4px; cursor: move; user-select: none;
}
.__ai_layout_editor_selected__ { outline: 2px solid #2563eb !important; outline-offset: 2px !important; }
body[contenteditable="true"] * { cursor: text; }
`;
        document.head.appendChild(style);

        const toolbar = document.createElement('div');
        toolbar.id = '__ai_layout_editor_toolbar__';
        toolbar.contentEditable = 'false';
        toolbar.innerHTML = `
<span class="__ai_layout_editor_title">布局编辑：${cardName || '测试卡片'}${hasSavedLayout ? '（已载入）' : ''}</span>
<button type="button" data-action="save" data-primary="true">保存布局</button>
<button type="button" data-action="undo">撤回</button>
<button type="button" data-action="hide">隐藏选中</button>
<button type="button" data-action="delete">删除选中</button>
<button type="button" data-action="wider">加宽</button>
<button type="button" data-action="narrower">变窄</button>
<button type="button" data-action="fontUp">字大</button>
<button type="button" data-action="fontDown">字小</button>
<button type="button" data-action="up">上移</button>
<button type="button" data-action="down">下移</button>
<button type="button" data-action="left">左移</button>
<button type="button" data-action="right">右移</button>
`;
        document.body.appendChild(toolbar);
        document.body.setAttribute('contenteditable', 'true');
        document.body.spellcheck = false;

        let selected = null;
        const undoStack = [];
        const layoutOperations = [];

        const clampToolbarPosition = (left, top) => {
            const rect = toolbar.getBoundingClientRect();
            const maxLeft = Math.max(0, window.innerWidth - rect.width - 6);
            const maxTop = Math.max(0, window.innerHeight - rect.height - 6);
            toolbar.style.left = `${Math.max(6, Math.min(maxLeft, left))}px`;
            toolbar.style.top = `${Math.max(6, Math.min(maxTop, top))}px`;
            toolbar.style.right = 'auto';
            toolbar.style.bottom = 'auto';
        };

        toolbar.addEventListener('mousedown', (event) => {
            if (event.target.closest('button')) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const rect = toolbar.getBoundingClientRect();
            const startOffsetX = event.clientX - rect.left;
            const startOffsetY = event.clientY - rect.top;

            const onMouseMove = (moveEvent) => {
                clampToolbarPosition(moveEvent.clientX - startOffsetX, moveEvent.clientY - startOffsetY);
            };
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove, true);
                document.removeEventListener('mouseup', onMouseUp, true);
            };

            document.addEventListener('mousemove', onMouseMove, true);
            document.addEventListener('mouseup', onMouseUp, true);
        }, true);

        const selectElement = (element) => {
            if (!element || element === document.body || toolbar.contains(element)) {
                return;
            }
            if (selected) {
                selected.classList.remove('__ai_layout_editor_selected__');
            }
            selected = element;
            selected.classList.add('__ai_layout_editor_selected__');
        };

        const getElementPath = (element) => {
            if (!element || element === document.body || toolbar.contains(element)) {
                return '';
            }

            const parts = [];
            let current = element;
            while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
                const tagName = String(current.tagName || '').toLowerCase();
                if (!tagName || tagName === 'html') {
                    break;
                }
                if (current.id && current.id !== '__ai_layout_editor_toolbar__') {
                    parts.unshift(`#${CSS.escape(current.id)}`);
                    break;
                }

                let nth = 1;
                let sibling = current;
                while ((sibling = sibling.previousElementSibling)) {
                    if (String(sibling.tagName || '').toLowerCase() === tagName) {
                        nth += 1;
                    }
                }
                parts.unshift(`${tagName}:nth-of-type(${nth})`);
                current = current.parentElement;
            }

            return parts.length > 0 ? `body > ${parts.join(' > ')}` : '';
        };

        const getStableElementPath = (element) => {
            if (!element || element === document.body || toolbar.contains(element)) {
                return '';
            }

            const parts = [];
            let current = element;
            while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
                const tagName = String(current.tagName || '').toLowerCase();
                if (!tagName || tagName === 'html') {
                    break;
                }

                const id = String(current.id || '').trim();
                if (id && !/^react-aria/i.test(id) && !/^:r/i.test(id)) {
                    parts.unshift(`#${CSS.escape(id)}`);
                    break;
                }

                let nth = 1;
                let sibling = current;
                while ((sibling = sibling.previousElementSibling)) {
                    if (String(sibling.tagName || '').toLowerCase() === tagName) {
                        nth += 1;
                    }
                }
                parts.unshift(`${tagName}:nth-of-type(${nth})`);
                current = current.parentElement;
            }

            return parts.length > 0 ? `body > ${parts.join(' > ')}` : '';
        };

        const getElementOperationMeta = (element) => {
            if (!element) {
                return {};
            }

            const stablePath = getStableElementPath(element);
            const dataTestId = String(element.getAttribute('data-testid') || element.getAttribute('data-test-id') || '').trim();
            const ariaLabel = String(element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
            const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
            const classList = String(element.className || '')
                .split(/\s+/)
                .filter((item) => item && item.length <= 80 && !/^css-/.test(item) && !item.startsWith('__ai_layout_editor_'))
                .slice(0, 8);
            const selectorCandidates = [];
            if (dataTestId) {
                selectorCandidates.push(`[data-testid="${CSS.escape(dataTestId)}"]`);
                selectorCandidates.push(`[data-test-id="${CSS.escape(dataTestId)}"]`);
            }
            if (ariaLabel) {
                selectorCandidates.push(`${String(element.tagName || '').toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`);
            }
            if (stablePath) {
                selectorCandidates.push(stablePath);
            }

            return {
                selectorCandidates,
                tagName: String(element.tagName || '').toLowerCase(),
                text,
                ariaLabel,
                classList
            };
        };

        const recordStyleOperation = () => {
            if (!selected || !selected.isConnected) {
                return;
            }
            const selector = getElementPath(selected);
            if (!selector) {
                return;
            }
            layoutOperations.push({
                action: 'style',
                selector,
                style: selected.getAttribute('style') || '',
                ...getElementOperationMeta(selected)
            });
        };

        const recordDeleteOperation = (element) => {
            const selector = getElementPath(element);
            if (!selector) {
                return;
            }
            layoutOperations.push({
                action: 'delete',
                selector,
                ...getElementOperationMeta(element)
            });
        };

        const pushStyleUndo = () => {
            if (!selected) {
                return false;
            }
            undoStack.push({
                type: 'style',
                element: selected,
                style: selected.getAttribute('style')
            });
            return true;
        };

        const pushDeleteUndo = () => {
            if (!selected || !selected.parentNode) {
                return false;
            }
            undoStack.push({
                type: 'delete',
                parent: selected.parentNode,
                nextSibling: selected.nextSibling,
                node: selected.cloneNode(true)
            });
            return true;
        };

        const undoLast = () => {
            const item = undoStack.pop();
            if (!item) {
                return;
            }
            layoutOperations.pop();

            if (item.type === 'style' && item.element && item.element.isConnected) {
                if (item.style === null) {
                    item.element.removeAttribute('style');
                } else {
                    item.element.setAttribute('style', item.style);
                }
                selectElement(item.element);
                return;
            }

            if (item.type === 'delete' && item.parent && item.parent.isConnected && item.node) {
                const restored = item.node.cloneNode(true);
                item.parent.insertBefore(restored, item.nextSibling && item.nextSibling.isConnected ? item.nextSibling : null);
                selectElement(restored);
            }
        };

        document.addEventListener('click', (event) => {
            if (!toolbar.contains(event.target)) {
                selectElement(event.target);
            }
        }, true);

        const adjustNumberStyle = (property, delta, fallback, unit = 'px') => {
            if (!selected) return;
            const computed = window.getComputedStyle(selected);
            const current = Number.parseFloat(selected.style[property] || computed[property] || fallback);
            selected.style[property] = `${Math.max(0, (Number.isFinite(current) ? current : fallback) + delta)}${unit}`;
        };

        const moveSelected = (axis, delta) => {
            if (!selected) return;
            if (!selected.style.position) {
                selected.style.position = 'relative';
            }
            const property = axis === 'x' ? 'left' : 'top';
            const current = Number.parseFloat(selected.style[property] || '0');
            selected.style[property] = `${(Number.isFinite(current) ? current : 0) + delta}px`;
        };

        const cleanupClone = (root) => {
            root.querySelector('#__ai_layout_editor_toolbar__')?.remove();
            root.querySelector('#__ai_layout_editor_style__')?.remove();
            root.querySelectorAll('.__ai_layout_editor_selected__').forEach((node) => node.classList.remove('__ai_layout_editor_selected__'));
            root.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'));
            root.body?.removeAttribute('contenteditable');
            root.body?.removeAttribute('spellcheck');
        };

        toolbar.addEventListener('click', async (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();

            switch (button.dataset.action) {
                case 'hide':
                    pushStyleUndo();
                    if (selected) {
                        selected.style.display = 'none';
                        recordStyleOperation();
                    }
                    break;
                case 'delete':
                    if (selected) {
                        pushDeleteUndo();
                        recordDeleteOperation(selected);
                        const next = selected.parentElement;
                        selected.remove();
                        selected = next;
                    }
                    break;
                case 'wider':
                    pushStyleUndo();
                    adjustNumberStyle('width', 40, selected ? selected.getBoundingClientRect().width : 0);
                    recordStyleOperation();
                    break;
                case 'narrower':
                    pushStyleUndo();
                    adjustNumberStyle('width', -40, selected ? selected.getBoundingClientRect().width : 0);
                    recordStyleOperation();
                    break;
                case 'fontUp':
                    pushStyleUndo();
                    adjustNumberStyle('fontSize', 2, 14);
                    recordStyleOperation();
                    break;
                case 'fontDown':
                    pushStyleUndo();
                    adjustNumberStyle('fontSize', -2, 14);
                    recordStyleOperation();
                    break;
                case 'up':
                    pushStyleUndo();
                    moveSelected('y', -10);
                    recordStyleOperation();
                    break;
                case 'down':
                    pushStyleUndo();
                    moveSelected('y', 10);
                    recordStyleOperation();
                    break;
                case 'left':
                    pushStyleUndo();
                    moveSelected('x', -10);
                    recordStyleOperation();
                    break;
                case 'right':
                    pushStyleUndo();
                    moveSelected('x', 10);
                    recordStyleOperation();
                    break;
                case 'undo':
                    undoLast();
                    break;
                case 'save': {
                    const cloned = document.cloneNode(true);
                    cleanupClone(cloned);
                    button.disabled = true;
                    button.textContent = '保存中...';
                    try {
                        const result = await window.__aiSaveTestCardLayoutOverride__({
                            title: document.title || '',
                            operations: layoutOperations,
                            fullHtml: '<!doctype html>\\n' + cloned.documentElement.outerHTML
                        });
                        button.textContent = result && result.success ? '已保存' : '保存失败';
                    } catch (error) {
                        button.textContent = '保存失败';
                        console.error(error);
                    }
                    setTimeout(() => {
                        button.disabled = false;
                        button.textContent = '保存布局';
                    }, 1600);
                    break;
                }
                default:
                    break;
            }
        }, true);
    }, context);
}

module.exports = {
    normalizeBrowserUrl,
    normalizeUrlKey,
    readLayoutOverride,
    saveLayoutOverride,
    installLayoutOverride,
    exposeLayoutSave,
    injectLayoutEditor
};
