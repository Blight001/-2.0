/**
 * 浏览器设置相关的渲染功能。
 *
 * 这里负责统一浏览器设置同步和浏览器自动检测。
 */

module.exports = function createRendererBrowser(deps) {
    const { elements, utils, logger, clashManager } = deps;

    function isStandaloneCardEditorWindow() {
        return typeof document !== 'undefined'
            && String(document.body?.dataset.view || document.documentElement?.dataset.view || '').trim() === 'card-editor';
    }

    function getActiveClashNodePatch() {
        if (!clashManager || typeof clashManager.getClashState !== 'function') {
            return {};
        }

        const clashState = clashManager.getClashState() || {};
        if (clashState.tunMode !== true && clashState.systemProxy !== true) {
            return {};
        }

        const currentNode = String(clashState.currentNode || '').trim();
        if (!currentNode) {
            return {};
        }

        return {
            currentNode,
            current_node: currentNode,
            clashCurrentNode: currentNode
        };
    }

    function updateBrowserSettings() {
        if (isStandaloneCardEditorWindow()) {
            return { success: true, skipped: true };
        }
        return utils.updateBrowserSettings(elements, getActiveClashNodePatch());
    }

    // 复用浏览器检测逻辑：目标下拉框和后续动作都可以单独指定，避免临时替换全局引用
    async function detectBrowserForSelect(browserTypeElement, detectButtonElement, options = {}) {
        if (!browserTypeElement || !detectButtonElement) {
            return;
        }

        const {
            afterDetect = () => {},
            mirrorTarget = null
        } = options;

        const proxyElements = {
            ...elements,
            browserType: browserTypeElement,
            detectBrowserBtn: detectButtonElement
        };

        await utils.detectBrowser(
            proxyElements,
            utils.showMessage,
            utils.updateBrowserOptions,
            afterDetect,
            logger
        );

        if (mirrorTarget && mirrorTarget !== browserTypeElement) {
            mirrorTarget.innerHTML = browserTypeElement.innerHTML;
            mirrorTarget.value = browserTypeElement.value;
        }
    }

    return {
        updateBrowserSettings,
        detectBrowserForSelect
    };
};
