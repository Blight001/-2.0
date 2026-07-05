/**
 * 卡片管理模块
 * 处理卡片的加载、渲染、编辑、删除等功能
 */

const { ipcRenderer } = require('electron');
const { logger } = require('../console.js');
const {
    filterAutomationCards,
    isAllowedAutomationCardName
} = require('../../core/execution/execution-ui-state');
const { IPC_CHANNELS } = require('../../core/ipc/channels');
const cardManagerShared = require('./card-manager-shared');
const createCardManagerStepEditor = require('./card-manager-step-editor');
const createCardManagerEditorUi = require('./card-manager-editor-ui');

const DEFAULT_MIN_COOKIE_SIZE_BYTES = cardManagerShared.DEFAULT_MIN_COOKIE_SIZE_BYTES;
const DEFAULT_UPLOAD_TARGET_SCORE_SCOPE = cardManagerShared.DEFAULT_UPLOAD_TARGET_SCORE_SCOPE;

const cardManagerStepEditor = createCardManagerStepEditor();

const {
    STEP_EDITOR_TEMPLATE_OPTIONS,
    STEP_EDITOR_PRESETS,
    createStepEditorDragSession,
    parseStepEditorValue,
    normalizeStepEditorSelectorField,
} = cardManagerStepEditor;

const cardManagerEditorUi = createCardManagerEditorUi({
    getCardModeConfig,
    resolveCardMinCookieSizeInputValue,
    resolveCardPasswordRandomConfig,
    resolveUploadTargetScoreConfig,
    setUploadTargetScoreControlsVisibility,
    DEFAULT_MIN_COOKIE_SIZE_BYTES,
    DEFAULT_UPLOAD_TARGET_SCORE_SCOPE
});

const {
    openCardEditorWindow,
    syncCardDebugRunButton,
    syncCardDebugModeButtons,
    resetCardDebugPanel,
    activateCardEditorTab,
    activateCardDialogTab,
    activateCardDialogRightTab,
    updateCardDebugPanel,
    escapeHtml,
    normalizeStepTitle,
    parseCardSteps,
    getStepRowState,
    renderCardStepProgressList,
    getStepEditorAccentClass,
    syncStepTemplateSelectAccent,
    setStepTemplatePickerOpen,
    syncStepEditorCardAccent,
    getStepEditorSelectorPreviewText,
    updateStepEditorSelectorPreview,
    refreshStepEditorSelectorPreviews,
    cycleStepEditorFieldsMode,
    buildStepEditorCardHtml,
    getStepEditorVisibleFields,
    applyStepEditorCardVisibility,
    renderCardStepEditor,
    collectCardStepEditors,
    collectCardStepParams,
    serializeCardStepCard,
    collectCardStepsFromEditor,
    reorderCardStepEditorSteps,
    getStepEditorDropLocation,
    applyStepEditorReorderFromIndex,
    clearStepEditorDropIndicator,
    setStepEditorDropIndicator,
    syncCardStepsTextareaFromEditor,
    addCardStepFromTemplate,
    showCardDialog,
    hideCardDialog
} = cardManagerEditorUi;

function normalizeCardMode(cardMode = 'automation') {
    return cardManagerShared.normalizeCardMode(cardMode);
}

// 全局状态
let currentCard = null;
let currentTestCard = null;
let currentHaikaBindCard = null;
let currentApiCard = null;
let currentModelCard = null;
let cardControlMode = 'local';
let executionCardAccessMode = 'restricted';
const loadedCardModes = new Set();
const loadingCardModes = new Map();

function normalizeCardControlMode(mode = 'local') {
    const normalized = String(mode || '').trim().toLowerCase();
    return normalized === 'tcp' || normalized === 'remote' ? 'remote' : 'local';
}

function setCardControlMode(mode = 'local') {
    cardControlMode = normalizeCardControlMode(mode);
}

function getCardControlMode() {
    return cardControlMode;
}

function isRemoteCardControlMode() {
    return cardControlMode === 'remote';
}

function setAutomationCardAccessMode(mode = 'restricted') {
    const normalized = String(mode || '').trim().toLowerCase();
    executionCardAccessMode = normalized === 'all' || normalized === 'unrestricted' ? 'all' : 'restricted';
}

function canUseAnyAutomationCard() {
    return executionCardAccessMode === 'all';
}

function getRemoteCardControlMessage(cardMode = 'automation') {
    const modeConfig = getCardModeConfig(cardMode);
    return `服务器控制状态下${modeConfig.label}卡片由服务器接管`;
}

function resolveCardMinCookieSizeBytes(cardData) {
    const candidates = [
        cardData?.min_cookie_size_bytes,
        cardData?.minCookieSizeBytes,
        cardData?.min_cookie_size,
        cardData?.minCookieSize
    ];

    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null || candidate === '') {
            continue;
        }

        const parsed = parseInt(candidate, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
        }
    }

    return DEFAULT_MIN_COOKIE_SIZE_BYTES;
}

function resolveCardMinCookieSizeInputValue(cardData) {
    const minCookieSizeBytes = resolveCardMinCookieSizeBytes(cardData);
    if (minCookieSizeBytes <= 0) {
        return 0;
    }

    return Math.max(1, Math.round(minCookieSizeBytes / 1024));
}

function resolveCardPasswordRandomConfig(cardData = {}) {
    const randomConfig = cardData && typeof cardData.random === 'object' ? cardData.random : {};
    const passwordConfig = randomConfig && typeof randomConfig.password === 'object' ? randomConfig.password : {};
    return {
        length: Number.isFinite(Number(passwordConfig.length)) && Number(passwordConfig.length) > 0
            ? Number(passwordConfig.length)
            : 12,
        type: String(passwordConfig.type || 'mixed').trim() || 'mixed'
    };
}

function normalizeCardPasswordRandomLength(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 12;
}

function normalizeMinCookieSizeInput(rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
        return DEFAULT_MIN_COOKIE_SIZE_BYTES;
    }

    const parsed = parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return DEFAULT_MIN_COOKIE_SIZE_BYTES;
    }

    if (parsed === 0) {
        return 0;
    }

    return Math.max(1, Math.round(parsed * 1024));
}

function normalizeUploadTargetScoreScope(rawValue) {
    const normalized = String(rawValue || '').trim().toLowerCase();
    if (!normalized) {
        return DEFAULT_UPLOAD_TARGET_SCORE_SCOPE;
    }

    if (normalized === 'custom' || normalized === 'single' || normalized === 'specific' || normalized === 'specified') {
        return 'custom';
    }

    return DEFAULT_UPLOAD_TARGET_SCORE_SCOPE;
}

function parseUploadTargetScoreTypes(rawValue) {
    const rawList = Array.isArray(rawValue)
        ? rawValue
        : String(rawValue || '').split(/[\n,，;；]+/);

    const normalizedList = [];
    const seen = new Set();

    rawList.forEach(item => {
        const value = String(item || '').trim();
        if (!value || seen.has(value)) {
            return;
        }

        seen.add(value);
        normalizedList.push(value);
    });

    return normalizedList;
}

function resolveUploadTargetScoreConfig(cardData = {}) {
    const uploadConfig = cardData && typeof cardData.upload === 'object' ? cardData.upload : {};
    const rawScope = cardData?.upload_target_score_scope
        ?? cardData?.uploadTargetScoreScope
        ?? uploadConfig.target_score_scope
        ?? uploadConfig.targetScoreScope;
    const rawTypes = cardData?.upload_target_score_types
        ?? cardData?.uploadTargetScoreTypes
        ?? uploadConfig.target_score_types
        ?? uploadConfig.targetScoreTypes
        ?? cardData?.upload_target_score_type
        ?? cardData?.uploadTargetScoreType
        ?? uploadConfig.target_score_type
        ?? uploadConfig.targetScoreType;

    const parsedTypes = parseUploadTargetScoreTypes(rawTypes);
    const hasExplicitScope = rawScope !== undefined && rawScope !== null && String(rawScope).trim() !== '';
    let scope = normalizeUploadTargetScoreScope(rawScope);
    if (!hasExplicitScope && parsedTypes.length > 0) {
        scope = 'custom';
    }

    if (scope !== 'custom') {
        return {
            scope: DEFAULT_UPLOAD_TARGET_SCORE_SCOPE,
            types: []
        };
    }

    return {
        scope: 'custom',
        types: parsedTypes
    };
}

function setUploadTargetScoreControlsVisibility(elements) {
    if (!elements) {
        return;
    }

    const scope = elements.cardUploadTargetScoreScope
        ? normalizeUploadTargetScoreScope(elements.cardUploadTargetScoreScope.value)
        : DEFAULT_UPLOAD_TARGET_SCORE_SCOPE;
    const isCustom = scope === 'custom';

    if (elements.cardUploadTargetScoreTypesGroup) {
        elements.cardUploadTargetScoreTypesGroup.style.display = isCustom ? '' : 'none';
    }
    if (elements.cardUploadTargetScoreTypes) {
        elements.cardUploadTargetScoreTypes.disabled = !isCustom;
    }
}

function getCardModeConfig(cardMode = 'automation') {
    const mode = normalizeCardMode(cardMode);
    const modeConfig = {
        automation: {
            mode: 'automation',
            label: '自动化',
            listSelector: '#card-list .card-item',
            itemSelector: name => `#card-list [data-card-name="${name}"]`,
            listElementKey: 'cardList',
            loadEvent: 'cards-loaded',
            loadChannel: 'load-cards',
            importChannel: 'import-card',
            saveChannel: 'save-card',
            getChannel: 'get-card',
            deleteChannel: 'delete-card',
            setChannel: 'set-current-card'
        },
        test: {
            mode: 'test',
            label: '测试',
            listSelector: '#test-card-list .card-item',
            itemSelector: name => `#test-card-list [data-card-name="${name}"]`,
            listElementKey: 'testCardList',
            loadEvent: 'test-cards-loaded',
            loadChannel: 'load-test-cards',
            importChannel: 'import-test-card',
            saveChannel: 'save-test-card',
            getChannel: 'get-test-card',
            deleteChannel: 'delete-test-card',
            setChannel: 'set-current-test-card'
        },
        api: {
            mode: 'api',
            label: 'API',
            listSelector: '#api-card-list .card-item',
            itemSelector: name => `#api-card-list [data-card-name="${name}"]`,
            listElementKey: 'apiCardList',
            loadEvent: 'api-cards-loaded',
            loadChannel: 'load-api-cards',
            importChannel: 'import-api-card',
            saveChannel: 'save-api-card',
            getChannel: 'get-api-card',
            deleteChannel: 'delete-api-card',
            setChannel: 'set-current-api-card'
        },
        model: {
            mode: 'model',
            label: '模型',
            listSelector: '#model-card-list .card-item',
            itemSelector: name => `#model-card-list [data-card-name="${name}"]`,
            listElementKey: 'modelCardList',
            loadEvent: 'model-cards-loaded',
            loadChannel: 'load-model-cards',
            importChannel: 'import-model-card',
            saveChannel: 'save-model-card',
            getChannel: 'get-model-card',
            deleteChannel: 'delete-model-card',
            setChannel: 'set-current-model-card'
        },
        haikaBind: {
            mode: 'haikaBind',
            label: '海卡绑定',
            listSelector: '#haika-bind-card-list .card-item',
            itemSelector: name => `#haika-bind-card-list [data-card-name="${name}"]`,
            listElementKey: 'haikaBindCardList',
            loadEvent: 'haika-bind-cards-loaded',
            loadChannel: 'load-haika-bind-cards',
            importChannel: 'import-haika-bind-card',
            saveChannel: 'save-haika-bind-card',
            getChannel: 'get-haika-bind-card',
            deleteChannel: 'delete-haika-bind-card',
            setChannel: 'set-current-haika-bind-card'
        }
    };

    return modeConfig[mode];
}

function getCurrentCardByMode(cardMode = 'automation') {
    if (cardMode === 'test') return currentTestCard;
    if (cardMode === 'api') return currentApiCard;
    if (cardMode === 'model') return currentModelCard;
    if (cardMode === 'haikaBind') return currentHaikaBindCard;
    return currentCard;
}

function isCardModeLoaded(cardMode = 'automation') {
    return loadedCardModes.has(normalizeCardMode(cardMode));
}

function markCardModeLoaded(cardMode = 'automation', loaded = true) {
    const mode = normalizeCardMode(cardMode);
    if (loaded) {
        loadedCardModes.add(mode);
        return;
    }

    loadedCardModes.delete(mode);
}

function renderDeferredLoadPlaceholder(elements, cardMode = 'automation', message = '') {
    const modeConfig = getCardModeConfig(cardMode);
    const listElement = elements && elements[modeConfig.listElementKey];
    if (!listElement) {
        return;
    }

    const placeholderMessage = message || (
        isRemoteCardControlMode()
            ? getRemoteCardControlMessage(cardMode)
            : `卡片未自动加载，点击这里加载${modeConfig.label}卡片`
    );
    listElement.innerHTML = `
        <div class="no-cards card-load-placeholder" data-card-load-mode="${modeConfig.mode}">
            ${placeholderMessage}
        </div>
    `;
}

async function ensureCardsLoaded(cardMode = 'automation', options = {}) {
    const mode = normalizeCardMode(cardMode);
    const forceReload = Boolean(options && options.forceReload);
    const allowLocalLoadInRemoteMode = Boolean(options && options.allowLocalLoadInRemoteMode);

    if (isRemoteCardControlMode() && !allowLocalLoadInRemoteMode) {
        return [];
    }

    if (!forceReload && isCardModeLoaded(mode)) {
        return [];
    }

    if (!forceReload && loadingCardModes.has(mode)) {
        return loadingCardModes.get(mode);
    }

    let loader = loadCards;
    if (mode === 'test') {
        loader = loadTestCards;
    } else if (mode === 'api') {
        loader = loadApiCards;
    } else if (mode === 'model') {
        loader = loadModelCards;
    } else if (mode === 'haikaBind') {
        loader = loadHaikaBindCards;
    }

    const loadingPromise = Promise.resolve(loader({ forceReload }))
        .finally(() => {
            loadingCardModes.delete(mode);
        });

    loadingCardModes.set(mode, loadingPromise);
    return loadingPromise;
}

function setCurrentCardByMode(cardName, cardMode = 'automation') {
    if (cardMode === 'test') {
        currentTestCard = cardName;
        return;
    }
    if (cardMode === 'api') {
        currentApiCard = cardName;
        return;
    }
    if (cardMode === 'model') {
        currentModelCard = cardName;
        return;
    }
    if (cardMode === 'haikaBind') {
        currentHaikaBindCard = cardName;
        return;
    }
    currentCard = cardName;
}

/**
 * 加载卡片列表
 */
async function loadCards(options = {}) {
    try {
        const allowLocalLoadInRemoteMode = Boolean(options && options.allowLocalLoadInRemoteMode);
        if (isRemoteCardControlMode() && !allowLocalLoadInRemoteMode) {
            markCardModeLoaded('automation', false);
            return [];
        }

        const result = await ipcRenderer.invoke('load-cards', options);
        if (result.success) {
            markCardModeLoaded('automation', true);
            setAutomationCardAccessMode(result.allowAllAutomationCards === true ? 'all' : 'restricted');
            result.cards = canUseAnyAutomationCard()
                ? (Array.isArray(result.cards) ? result.cards : [])
                : filterAutomationCards(result.cards, 'automation');
            // 通过全局事件通知渲染进程更新卡片列表
            // elements 和 onCardChange 由 renderer.js 中的事件监听器处理
            window.dispatchEvent(new CustomEvent('cards-loaded', { detail: result.cards }));
            return result.cards;
        } else {
            markCardModeLoaded('automation', false);
            logger.error(`加载卡片失败: ${result.error}`);
        }
    } catch (error) {
        markCardModeLoaded('automation', false);
        logger.error(`加载卡片异常: ${error.message}`);
    }

    return [];
}

/**
 * 加载测试卡片列表
 */
async function loadTestCards(options = {}) {
    try {
        const allowLocalLoadInRemoteMode = Boolean(options && options.allowLocalLoadInRemoteMode);
        if (isRemoteCardControlMode() && !allowLocalLoadInRemoteMode) {
            markCardModeLoaded('test', false);
            return [];
        }

        const result = await ipcRenderer.invoke('load-test-cards', options);
        if (result.success) {
            markCardModeLoaded('test', true);
            window.dispatchEvent(new CustomEvent('test-cards-loaded', { detail: result.cards }));
            return result.cards;
        } else {
            markCardModeLoaded('test', false);
            logger.error(`加载测试卡片失败: ${result.error}`);
        }
    } catch (error) {
        markCardModeLoaded('test', false);
        logger.error(`加载测试卡片异常: ${error.message}`);
    }

    return [];
}

/**
 * 加载 API 卡片列表
 */
async function loadApiCards(options = {}) {
    try {
        const allowLocalLoadInRemoteMode = Boolean(options && options.allowLocalLoadInRemoteMode);
        if (isRemoteCardControlMode() && !allowLocalLoadInRemoteMode) {
            markCardModeLoaded('api', false);
            return [];
        }

        const result = await ipcRenderer.invoke('load-api-cards', options);
        if (result.success) {
            markCardModeLoaded('api', true);
            window.dispatchEvent(new CustomEvent('api-cards-loaded', { detail: result.cards }));
            return result.cards;
        } else {
            markCardModeLoaded('api', false);
            logger.error(`加载 API 卡片失败: ${result.error}`);
        }
    } catch (error) {
        markCardModeLoaded('api', false);
        logger.error(`加载 API 卡片异常: ${error.message}`);
    }

    return [];
}

/**
 * 加载模型卡片列表
 */
async function loadModelCards(options = {}) {
    try {
        const allowLocalLoadInRemoteMode = Boolean(options && options.allowLocalLoadInRemoteMode);
        if (isRemoteCardControlMode() && !allowLocalLoadInRemoteMode) {
            markCardModeLoaded('model', false);
            return [];
        }

        const result = await ipcRenderer.invoke('load-model-cards', options);
        if (result.success) {
            markCardModeLoaded('model', true);
            window.dispatchEvent(new CustomEvent('model-cards-loaded', { detail: result.cards }));
            return result.cards;
        } else {
            markCardModeLoaded('model', false);
            logger.error(`加载模型卡片失败: ${result.error}`);
        }
    } catch (error) {
        markCardModeLoaded('model', false);
        logger.error(`加载模型卡片异常: ${error.message}`);
    }

    return [];
}

/**
 * 加载海卡绑定卡片列表
 */
async function loadHaikaBindCards(options = {}) {
    try {
        const allowLocalLoadInRemoteMode = Boolean(options && options.allowLocalLoadInRemoteMode);
        if (isRemoteCardControlMode() && !allowLocalLoadInRemoteMode) {
            markCardModeLoaded('haikaBind', false);
            return [];
        }

        const result = await ipcRenderer.invoke('load-haika-bind-cards', options);
        if (result.success) {
            markCardModeLoaded('haikaBind', true);
            window.dispatchEvent(new CustomEvent('haika-bind-cards-loaded', { detail: result.cards }));
            return result.cards;
        } else {
            markCardModeLoaded('haikaBind', false);
            logger.error(`加载海卡绑定卡片失败: ${result.error}`);
        }
    } catch (error) {
        markCardModeLoaded('haikaBind', false);
        logger.error(`加载海卡绑定卡片异常: ${error.message}`);
    }

    return [];
}

/**
 * 渲染卡片列表
 * @param {Array} cards - 卡片数据数组
 * @param {Object} elements - DOM元素对象
 * @param {Function} onCardChange - 卡片变化回调（用于刷新Cookie列表等）
 * @param {string} cardMode - 卡片类型: automation | test | api | haikaBind
 */
function renderCardList(cards, elements, onCardChange, cardMode = 'automation') {
    const modeConfig = getCardModeConfig(cardMode);
    const listElement = elements[modeConfig.listElementKey];
    if (!elements || !listElement) return;

    const selectedApiCardName = String(currentApiCard || '').trim();
    const displayCards = cardMode === 'automation'
        ? (canUseAnyAutomationCard() ? (Array.isArray(cards) ? cards : []) : filterAutomationCards(cards, cardMode))
        : cardMode === 'model'
            ? (selectedApiCardName
                ? (Array.isArray(cards) ? cards : []).filter(card => cardManagerShared.resolveModelCardApiName(card) === selectedApiCardName)
                : [])
        : (Array.isArray(cards) ? cards : []);

    markCardModeLoaded(cardMode, true);
    listElement.innerHTML = '';

    if (cardMode === 'model' && elements.addModelCardBtn) {
        elements.addModelCardBtn.disabled = !selectedApiCardName;
    }
    if (cardMode === 'model' && elements.refreshModelCardBtn) {
        elements.refreshModelCardBtn.disabled = !selectedApiCardName;
    }

    if (cardMode === 'model' && !selectedApiCardName) {
        listElement.innerHTML = '<div class="no-cards">请先选择一个API卡片</div>';
        return;
    }

    if (displayCards.length === 0) {
        listElement.innerHTML = cardMode === 'model'
            ? `<div class="no-cards">暂无该API对应的模型卡片</div>`
            : `<div class="no-cards">暂无${modeConfig.label}卡片</div>`;
        return;
    }

    displayCards.forEach(card => {
        const cardElement = document.createElement('div');
        cardElement.className = 'card-item';
        cardElement.dataset.cardName = card.name;

        cardElement.innerHTML = `
            <div class="card-name">${card.name}</div>
            <div class="card-description">${card.description || '无描述'}</div>
        `;

        cardElement.addEventListener('click', () => selectCard(card.name, elements, (name) => {
            setCurrentCardByMode(name, cardMode);
        }, onCardChange, cardMode));
        listElement.appendChild(cardElement);
    });

    const selectedCardName = String(getCurrentCardByMode(cardMode) || '').trim();
    if (selectedCardName) {
        const selectedElement = Array.from(listElement.querySelectorAll('.card-item'))
            .find(item => item && item.dataset && item.dataset.cardName === selectedCardName);
        if (selectedElement) {
            selectedElement.classList.add('selected');
        } else if (cardMode === 'automation' && displayCards.length === 1 && (canUseAnyAutomationCard() || isAllowedAutomationCardName(displayCards[0]?.name))) {
            selectCard(displayCards[0].name, elements, (name) => {
                setCurrentCardByMode(name, cardMode);
            }, onCardChange, cardMode);
        }
    } else if (cardMode === 'automation' && displayCards.length === 1 && (canUseAnyAutomationCard() || isAllowedAutomationCardName(displayCards[0]?.name))) {
        selectCard(displayCards[0].name, elements, (name) => {
            setCurrentCardByMode(name, cardMode);
        }, onCardChange, cardMode);
    }
}

/**
 * 选择卡片
 * @param {string} cardName - 卡片名称
 * @param {Object} elements - DOM元素对象
 * @param {Function} onSelect - 选择回调函数
 * @param {Function} onCardChange - 卡片变化回调（用于刷新Cookie列表等）
 * @param {string} cardMode - 卡片类型: automation | test | api | haikaBind
 */
function selectCard(cardName, elements, onSelect, onCardChange, cardMode = 'automation') {
    const modeConfig = getCardModeConfig(cardMode);
    if (isRemoteCardControlMode()) {
        logger.info(getRemoteCardControlMessage(cardMode));
        return;
    }

    if (cardMode === 'automation' && !canUseAnyAutomationCard() && !isAllowedAutomationCardName(cardName)) {
        logger.info('自动化卡片页面仅允许使用国际版即梦自动化卡片');
        return;
    }

    const listSelector = modeConfig.listSelector;
    const itemSelector = modeConfig.itemSelector(cardName);

    // 清除之前的选择
    document.querySelectorAll(listSelector).forEach(item => {
        item.classList.remove('selected');
    });

    // 选择新的卡片
    const selectedCard = document.querySelector(itemSelector);
    if (selectedCard) {
        selectedCard.classList.add('selected');
        
        setCurrentCardByMode(cardName, cardMode);
        logger.info(`选择${modeConfig.label}卡片: ${cardName}`);

        if (modeConfig.setChannel) {
            ipcRenderer.invoke(modeConfig.setChannel, cardName).catch(error => {
                logger.error(`设置当前${modeConfig.label}卡片失败: ${error.message}`);
            });
        }

        if (cardMode === 'automation' && elements.startBtn) {
            elements.startBtn.disabled = false;
            elements.statusLabel.textContent = `已选择卡片: ${cardName}`;
        }

        if (onSelect) {
            onSelect(cardName);
        }

        // 触发卡片变化回调（用于刷新Cookie列表等）
        if (onCardChange) {
            onCardChange(cardName);
        }
    }
}

/**
 * 获取当前选中的卡片
 */
function getCurrentCard() {
    return currentCard;
}

/**
 * 获取当前选中的测试卡片
 */
function getCurrentTestCard() {
    return currentTestCard;
}

/**
 * 获取当前选中的海卡绑定卡片
 */
function getCurrentHaikaBindCard() {
    return currentHaikaBindCard;
}

/**
 * 设置当前卡片（从外部设置）
 */
function setCurrentCard(cardName) {
    currentCard = cardName;
}

/**
 * 设置当前测试卡片（从外部设置）
 */
function setCurrentTestCard(cardName) {
    currentTestCard = cardName;
}

/**
 * 设置当前海卡绑定卡片（从外部设置）
 */
function setCurrentHaikaBindCard(cardName) {
    currentHaikaBindCard = cardName;
}


/**
 * 保存卡片
 */
async function saveCard(elements, showMessage, loadCardsFn, loadTestCardsFn = loadCardsFn, loadApiCardsFn = loadCardsFn, loadModelCardsFn = loadCardsFn, loadHaikaBindCardsFn = loadCardsFn, options = {}) {
    try {
        const cardMode = elements.cardDialog.dataset.cardMode || 'automation';
        const closeDialog = options.closeDialog !== false;
        if (isRemoteCardControlMode()) {
            showMessage(getRemoteCardControlMessage(cardMode), 'info');
            return;
        }

        const modeConfig = getCardModeConfig(cardMode);
        const built = cardManagerShared.buildCardDataFromForm(elements, {
            collectSteps: syncCardStepsTextareaFromEditor
        });
        if (!built.success) {
            showMessage(built.error, 'error');
            return;
        }

        const channel = modeConfig.saveChannel;
        const result = await ipcRenderer.invoke(channel, built.cardData);
        
        if (result.success) {
            if (closeDialog) {
                hideCardDialog(elements);
            }
            // 重新加载对应的卡片列表
            if (cardMode === 'test') {
                await loadTestCardsFn({ forceReload: true });
            } else if (cardMode === 'api') {
                await loadApiCardsFn({ forceReload: true });
            } else if (cardMode === 'model') {
                await loadModelCardsFn({ forceReload: true });
            } else if (cardMode === 'haikaBind') {
                await loadHaikaBindCardsFn({ forceReload: true });
            } else {
                await loadCardsFn({ forceReload: true });
                await ipcRenderer.invoke('refresh-execution-tab').catch(error => {
                    logger.warning(`刷新自动化卡片列表失败: ${error.message}`);
                });
            }
            showMessage(`${modeConfig.label}卡片保存成功`, 'success');
        } else {
            showMessage(`保存失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showMessage(`保存异常: ${error.message}`, 'error');
    }
}

async function debugCard(elements, showMessage, getBrowserSettingsPatchFn = null) {
    try {
        const cardMode = elements.cardDialog.dataset.cardMode || 'automation';
        const built = cardManagerShared.buildCardDataFromForm(elements, {
            collectSteps: syncCardStepsTextareaFromEditor
        });
        if (!built.success) {
            showMessage(built.error, 'error');
            return;
        }

        const browserSettingsPatch = typeof getBrowserSettingsPatchFn === 'function'
            ? getBrowserSettingsPatchFn() || {}
            : {};
        const browserConfig = cardManagerShared.getBrowserConfigForMode(elements, cardMode, browserSettingsPatch);
        if (browserConfig.browserType && browserConfig.browserSettings && Object.keys(browserConfig.browserSettings).length > 0) {
            await ipcRenderer.invoke('update-browser-settings', browserConfig.browserSettings).catch(error => {
                logger.warning(`调试前同步浏览器设置失败: ${error.message}`);
            });
        }
        const pauseEachStep = elements.cardDebugStepPause ? elements.cardDebugStepPause.checked : true;
        updateCardDebugPanel(elements, {
            progress: 0,
            currentStepName: '-',
            statusText: '已提交调试任务，等待浏览器启动...',
            canPause: false,
            canResume: false,
            awaitingRunMode: false,
            error: '',
            failedStepError: '',
            completedStepIndex: -1
        });
        const result = await ipcRenderer.invoke('debug-card', {
            cardMode,
            cardData: built.cardData,
            browserType: browserConfig.browserType,
            browserSettings: browserConfig.browserSettings,
            pauseEachStep
        });

        if (result && result.success) {
            showMessage('调试任务已启动，浏览器会保持打开', 'success');
            updateCardDebugPanel(elements, {
                taskId: result.taskId || '',
                active: true,
                progress: 0,
                currentStepName: '-',
                statusText: '调试已启动，正在自动执行第一步...',
                canPause: false,
                canResume: false,
                awaitingRunMode: false,
                canChooseLoop: false,
                canChooseStep: false,
                error: '',
                failedStepError: '',
                completedStepIndex: -1
            });
        } else {
            showMessage(`调试启动失败: ${result && result.error ? result.error : '未知错误'}`, 'error');
            resetCardDebugPanel(elements);
        }
    } catch (error) {
        showMessage(`调试启动异常: ${error.message}`, 'error');
        resetCardDebugPanel(elements);
    }
}

/**
 * 导入卡片
 */
async function importCard(showMessage, loadCardsFn, cardMode = 'automation', loadTestCardsFn = loadCardsFn, loadApiCardsFn = loadCardsFn, loadModelCardsFn = loadCardsFn, loadHaikaBindCardsFn = loadCardsFn) {
    try {
        if (isRemoteCardControlMode()) {
            showMessage(getRemoteCardControlMessage(cardMode), 'info');
            return;
        }

        const modeConfig = getCardModeConfig(cardMode);
        const channel = modeConfig.importChannel;
        const result = await ipcRenderer.invoke(channel);
        
        if (result.success) {
            if (cardMode === 'test') {
                await loadTestCardsFn({ forceReload: true });
            } else if (cardMode === 'api') {
                await loadApiCardsFn({ forceReload: true });
            } else if (cardMode === 'model') {
                await loadModelCardsFn({ forceReload: true });
            } else if (cardMode === 'haikaBind') {
                await loadHaikaBindCardsFn({ forceReload: true });
            } else {
                await loadCardsFn({ forceReload: true });
                await ipcRenderer.invoke('refresh-execution-tab').catch(error => {
                    logger.warning(`刷新自动化卡片列表失败: ${error.message}`);
                });
            }
            showMessage(`${modeConfig.label}卡片导入成功`, 'success');
        } else if (result.cancelled) {
            // 用户取消，不做任何操作
        } else {
            showMessage(`导入失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showMessage(`导入异常: ${error.message}`, 'error');
    }
}

/**
 * 编辑选中的卡片
 */
async function editSelectedCard(showMessage, selectedCardName, cardMode = 'automation') {
    if (isRemoteCardControlMode()) {
        showMessage(getRemoteCardControlMessage(cardMode), 'info');
        return null;
    }

    const modeConfig = getCardModeConfig(cardMode);
    if (!selectedCardName) {
        showMessage(`请先选择一个${modeConfig.label}卡片`, 'error');
        return null;
    }

    try {
        const channel = modeConfig.getChannel;
        const result = await ipcRenderer.invoke(channel, selectedCardName);
        if (result.success) {
            return result.card;
        } else {
            showMessage(`获取卡片数据失败: ${result.error}`, 'error');
            return null;
        }
    } catch (error) {
        showMessage(`获取卡片数据异常: ${error.message}`, 'error');
        return null;
    }
}

/**
 * 删除选中的卡片
 */
async function deleteSelectedCard(elements, showMessage, loadCardsFn, selectedCardName, setCurrentCardFn, cardMode = 'automation', loadTestCardsFn = loadCardsFn, loadApiCardsFn = loadCardsFn, loadModelCardsFn = loadCardsFn, loadHaikaBindCardsFn = loadCardsFn) {
    if (isRemoteCardControlMode()) {
        showMessage(getRemoteCardControlMessage(cardMode), 'info');
        return;
    }

    const modeConfig = getCardModeConfig(cardMode);
    if (!selectedCardName) {
        showMessage(`请先选择一个${modeConfig.label}卡片`, 'error');
        return;
    }

    try {
        const channel = modeConfig.deleteChannel;
        const result = await ipcRenderer.invoke(channel, selectedCardName);
        
        if (result.success) {
            setCurrentCardFn(null);
            
            if (cardMode === 'automation' && elements.startBtn) {
                elements.startBtn.disabled = true;
                elements.statusLabel.textContent = '未选择卡片';
            }
            
            if (cardMode === 'test') {
                loadTestCardsFn();
            } else if (cardMode === 'api') {
                loadApiCardsFn();
                loadModelCardsFn({ forceReload: true });
            } else if (cardMode === 'model') {
                loadModelCardsFn();
            } else if (cardMode === 'haikaBind') {
                loadHaikaBindCardsFn();
            } else {
                loadCardsFn();
            }
            showMessage(`${modeConfig.label}卡片删除成功`, 'success');

            // 通知主进程清除当前卡片
            const setChannel = modeConfig.setChannel;
            ipcRenderer.invoke(setChannel, null).catch(error => {
                logger.error(`清除当前${modeConfig.label}卡片失败: ${error.message}`);
            });
        } else {
            showMessage(`删除失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showMessage(`删除异常: ${error.message}`, 'error');
    }
}

async function ensureCardModeLoadedForAction(cardMode, loadCardsFn, loadTestCardsFn = loadCardsFn, loadApiCardsFn = loadCardsFn, loadModelCardsFn = loadCardsFn, loadHaikaBindCardsFn = loadCardsFn) {
    if (isRemoteCardControlMode()) {
        return false;
    }

    if (isCardModeLoaded(cardMode)) {
        return true;
    }

    if (cardMode === 'test') {
        await loadTestCardsFn();
        return isCardModeLoaded('test');
    }

    if (cardMode === 'api') {
        await loadApiCardsFn();
        return isCardModeLoaded('api');
    }

    if (cardMode === 'model') {
        await loadModelCardsFn();
        return isCardModeLoaded('model');
    }

    if (cardMode === 'haikaBind') {
        await loadHaikaBindCardsFn();
        return isCardModeLoaded('haikaBind');
    }

    await loadCardsFn();
    return isCardModeLoaded('automation');
}


const createCardManagerActions = require('./card-manager-actions');

const actionExports = createCardManagerActions({
    saveCard,
    debugCard,
    importCard,
    editSelectedCard,
    deleteSelectedCard,
    ensureCardModeLoadedForAction,
    showCardDialog,
    hideCardDialog,
    openCardEditorWindow,
    resetCardDebugPanel,
    updateCardDebugPanel,
    renderCardStepProgressList,
    renderCardStepEditor,
    syncCardStepsTextareaFromEditor,
    reorderCardStepEditorSteps,
    collectCardStepEditors,
    cycleStepEditorFieldsMode,
    syncStepEditorCardAccent,
    applyStepEditorCardVisibility,
    updateStepEditorSelectorPreview,
    normalizeStepEditorSelectorField,
    getStepEditorDropLocation,
    applyStepEditorReorderFromIndex,
    setStepEditorDropIndicator,
    clearStepEditorDropIndicator,
    addCardStepFromTemplate,
    setStepTemplatePickerOpen,
    syncStepTemplateSelectAccent,
    activateCardEditorTab,
    createStepEditorDragSession,
    setUploadTargetScoreControlsVisibility,
    getCurrentCard,
    getCurrentTestCard,
    getCurrentApiCard: () => currentApiCard,
    getCurrentModelCard: () => currentModelCard,
    getCurrentHaikaBindCard,
    setCurrentCard,
    setCurrentTestCard,
    setCurrentApiCard: (cardName) => { currentApiCard = cardName; },
    setCurrentModelCard: (cardName) => { currentModelCard = cardName; },
    setCurrentHaikaBindCard,
    isRemoteCardControlMode,
    getRemoteCardControlMessage,
    IPC_CHANNELS,
    ipcRenderer
});

// 导出模块
module.exports = {
    loadCards,
    loadTestCards,
    loadApiCards,
    loadModelCards,
    loadHaikaBindCards,
    ensureCardsLoaded,
    isCardModeLoaded,
    setCardControlMode,
    getCardControlMode,
    isRemoteCardControlMode,
    setAutomationCardAccessMode,
    buildCardDataFromForm: cardManagerShared.buildCardDataFromForm,
    renderDeferredLoadPlaceholder,
    renderCardList,
    selectCard,
    getCurrentCard,
    getCurrentTestCard,
    getCurrentApiCard: () => currentApiCard,
    getCurrentModelCard: () => currentModelCard,
    getCurrentHaikaBindCard,
    setCurrentCard,
    setCurrentTestCard,
    setCurrentApiCard: (cardName) => { currentApiCard = cardName; },
    setCurrentModelCard: (cardName) => { currentModelCard = cardName; },
    setCurrentHaikaBindCard,
    showCardDialog,
    hideCardDialog,
    saveCard,
    debugCard,
    resetCardDebugPanel,
    updateCardDebugPanel,
    renderCardStepProgressList,
    activateCardDialogTab,
    importCard,
    editSelectedCard,
    deleteSelectedCard,
    resolveUploadTargetScoreConfig,
    ...cardManagerStepEditor,
    ...actionExports
};
