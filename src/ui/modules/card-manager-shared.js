const DEFAULT_MIN_COOKIE_SIZE_BYTES = 8192;
const DEFAULT_UPLOAD_TARGET_SCORE_SCOPE = 'all';

function normalizeCardMode(cardMode = 'automation') {
    return cardMode === 'test' || cardMode === 'haikaBind' || cardMode === 'api' || cardMode === 'model' ? cardMode : 'automation';
}

function normalizeCardControlMode(mode = 'local') {
    return String(mode || '').trim().toLowerCase() === 'remote' ? 'remote' : 'local';
}

function setCardControlMode(mode = 'local') {
    return normalizeCardControlMode(mode);
}

function getCardControlMode() {
    return 'local';
}

function isRemoteCardControlMode() {
    return false;
}

function setAutomationCardAccessMode(mode = 'restricted') {
    return String(mode || '').trim().toLowerCase() === 'any' ? 'any' : 'restricted';
}

function canUseAnyAutomationCard() {
    return false;
}

function getRemoteCardControlMessage(cardMode = 'automation') {
    const mode = normalizeCardMode(cardMode);
    return mode === 'automation'
        ? '当前自动化卡片处于远程控制模式，无法在本地编辑'
        : '当前卡片处于远程控制模式，无法在本地编辑';
}

function resolveCardMinCookieSizeBytes(cardData) {
    const candidates = [
        cardData?.min_cookie_size_bytes,
        cardData?.minCookieSizeBytes,
        cardData?.min_cookie_size_kb,
        cardData?.minCookieSizeKb
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

function getBrowserConfigForMode(elements, cardMode = 'automation', browserSettingsPatch = {}) {
    const isStandaloneCardEditorWindow = typeof document !== 'undefined'
        && String(document.body?.dataset.view || document.documentElement?.dataset.view || '').trim() === 'card-editor';
    const hasBrowserTypeControl = Boolean(elements.browserType) && !isStandaloneCardEditorWindow;
    const browserType = hasBrowserTypeControl && elements.browserType.value ? elements.browserType.value : '';
    const headlessElement = elements.headlessMode;
    const activeBrowserSettingsPatch = browserSettingsPatch && typeof browserSettingsPatch === 'object'
        ? browserSettingsPatch
        : {};
    const browserSettings = {
        ...activeBrowserSettingsPatch
    };

    if (browserType) {
        browserSettings.browser_type = browserType;
        browserSettings.browser_source = 'local-browser';
    }

    if (elements.browserDisplayMode) {
        browserSettings.browser_display_mode = elements.browserDisplayMode.checked ? 'embedded' : 'window';
    }

    if (headlessElement) {
        browserSettings.headless = !!headlessElement.checked;
    }

    if (elements.browserBlockImagesVideos) {
        browserSettings.block_images_videos = elements.browserBlockImagesVideos.checked;
    }

    return {
        browserType,
        browserSettings
    };
}

function buildCardDataFromForm(elements, options = {}) {
    const cardMode = elements.cardDialog.dataset.cardMode || 'automation';
    const originalCardName = String(elements.cardDialog.dataset.originalCardName || '').trim();
    const relatedApiCardName = String(elements.cardDialog.dataset.apiCardName || '').trim();
    const collectSteps = typeof options.collectSteps === 'function'
        ? options.collectSteps
        : null;
    const uploadTargetScoreScope = elements.cardUploadTargetScoreScope
        ? normalizeUploadTargetScoreScope(elements.cardUploadTargetScoreScope.value)
        : DEFAULT_UPLOAD_TARGET_SCORE_SCOPE;
    const uploadTargetScoreTypes = uploadTargetScoreScope === 'custom'
        ? parseUploadTargetScoreTypes(elements.cardUploadTargetScoreTypes ? elements.cardUploadTargetScoreTypes.value : '')
        : [];

    if (cardMode === 'automation' && uploadTargetScoreScope === 'custom' && uploadTargetScoreTypes.length === 0) {
        return { success: false, error: '请填写目标积分账号/类型，或将目标积分类型改为“默认所有积分账号”' };
    }

    const cardData = {
        name: elements.cardName.value.trim(),
        website: elements.cardWebsite.value.trim(),
        description: elements.cardDescription.value.trim(),
        password: elements.cardPassword.value.trim(),
        points: parseInt(elements.cardPoints.value) || 0,
        steps: [],
        popups: []
    };

    if (cardMode === 'automation') {
        const uploadServerUrl = elements.executionUploadServerUrl ? elements.executionUploadServerUrl.value.trim() : '';
        const uploadCardKey = elements.executionUploadCardKey ? elements.executionUploadCardKey.value.trim() : '';
        const executionAutoUpload = elements.executionAutoUpload ? elements.executionAutoUpload.checked === true : true;
        const minCookieSizeBytes = elements.cardMinCookieSize
            ? normalizeMinCookieSizeInput(elements.cardMinCookieSize.value)
            : DEFAULT_MIN_COOKIE_SIZE_BYTES;
        const passwordRandomLength = elements.cardPasswordRandomLength
            ? normalizeCardPasswordRandomLength(elements.cardPasswordRandomLength.value)
            : 12;
        const passwordRandomType = elements.cardPasswordRandomType
            ? String(elements.cardPasswordRandomType.value || 'mixed').trim() || 'mixed'
            : 'mixed';
        const resolvedUploadTargetScoreTypes = uploadTargetScoreScope === 'custom' ? uploadTargetScoreTypes : [];
        cardData.upload_server_url = uploadServerUrl;
        cardData.upload_card_key = uploadCardKey;
        cardData.execution_auto_upload = executionAutoUpload;
        cardData.min_cookie_size_bytes = minCookieSizeBytes;
        cardData.upload_target_score_scope = uploadTargetScoreScope;
        cardData.upload_target_score_types = resolvedUploadTargetScoreTypes;
        cardData.upload_target_score_type = resolvedUploadTargetScoreTypes[0] || '';
        cardData.random = {
            password: {
                length: passwordRandomLength,
                type: passwordRandomType
            }
        };
        cardData.upload = {
            server_url: uploadServerUrl,
            card_key: uploadCardKey,
            execution_auto_upload: executionAutoUpload,
            target_score_scope: uploadTargetScoreScope,
            target_score_types: resolvedUploadTargetScoreTypes,
            target_score_type: resolvedUploadTargetScoreTypes[0] || ''
        };
    }

    try {
        const popupsJson = elements.cardPopupsTextarea.value.trim();
        cardData.popups = popupsJson ? JSON.parse(popupsJson) : [];
    } catch (error) {
        return { success: false, error: `弹窗规则JSON格式错误: ${error.message}` };
    }

    try {
        const stepsResult = collectSteps
            ? collectSteps(elements)
            : { success: true, steps: [] };
        if (!stepsResult.success) {
            return { success: false, error: stepsResult.error || '步骤配置错误' };
        }
        cardData.steps = Array.isArray(stepsResult.steps) ? stepsResult.steps : [];
    } catch (error) {
        return { success: false, error: `步骤JSON格式错误: ${error.message}` };
    }

    if (!cardData.name) {
        return { success: false, error: '请输入卡片名称' };
    }

    if (originalCardName) {
        cardData.original_name = originalCardName;
    }

    if (cardMode === 'model' && relatedApiCardName) {
        cardData.api_card_name = relatedApiCardName;
        cardData.apiCardName = relatedApiCardName;
    }

    if (cardMode === 'model') {
        const apiServiceType = String(elements.cardApiServiceType?.value || 'image').trim() || 'image';
        const apiServiceEndpoint = String(elements.cardApiServiceEndpoint?.value || '').trim();
        let apiServiceParams = {};
        try {
            const rawParams = String(elements.cardApiServiceParams?.value || '').trim();
            apiServiceParams = rawParams ? JSON.parse(rawParams) : {};
            if (!apiServiceParams || typeof apiServiceParams !== 'object' || Array.isArray(apiServiceParams)) {
                return { success: false, error: 'API服务请求参数必须是JSON对象' };
            }
        } catch (error) {
            return { success: false, error: `API服务请求参数JSON格式错误: ${error.message}` };
        }

        cardData.api_service = {
            type: ['text', 'image', 'video'].includes(apiServiceType) ? apiServiceType : 'image',
            endpoint: apiServiceEndpoint,
            request_params: apiServiceParams
        };
        cardData.apiService = {
            type: cardData.api_service.type,
            endpoint: apiServiceEndpoint,
            requestParams: apiServiceParams
        };
        cardData.api_service_type = cardData.api_service.type;
        cardData.api_service_endpoint = apiServiceEndpoint;
    }

    return { success: true, cardData };
}

function resolveModelCardApiName(card = {}) {
    return String(
        card?.api_card_name
        || card?.apiCardName
        || card?.api_name
        || card?.apiName
        || ''
    ).trim();
}

module.exports = {
    DEFAULT_MIN_COOKIE_SIZE_BYTES,
    DEFAULT_UPLOAD_TARGET_SCORE_SCOPE,
    normalizeCardMode,
    normalizeCardControlMode,
    setCardControlMode,
    getCardControlMode,
    isRemoteCardControlMode,
    setAutomationCardAccessMode,
    canUseAnyAutomationCard,
    getRemoteCardControlMessage,
    resolveCardMinCookieSizeBytes,
    resolveCardMinCookieSizeInputValue,
    resolveCardPasswordRandomConfig,
    normalizeCardPasswordRandomLength,
    normalizeMinCookieSizeInput,
    normalizeUploadTargetScoreScope,
    parseUploadTargetScoreTypes,
    resolveUploadTargetScoreConfig,
    setUploadTargetScoreControlsVisibility,
    getCardModeConfig,
    getBrowserConfigForMode,
    buildCardDataFromForm,
    resolveModelCardApiName
};
