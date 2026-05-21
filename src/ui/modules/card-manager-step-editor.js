const {
    defaultEscapeCssIdentifier,
    extractNativeElementSelectorCandidates,
    buildHasTextSelector
} = require('../../core/selector-utils');

const STEP_EDITOR_FIELDS_MODE = {
    COLLAPSED: 'collapsed',
    FILLER: 'filled',
    ALL: 'all'
};

const STEP_EDITOR_TEMPLATE_OPTIONS = [
    { value: 'navigate', label: '访问网页' },
    { value: 'click', label: '点击元素' },
    { value: 'type', label: '输入内容' },
    { value: 'wait', label: '等待条件' },
    { value: 'screenshot', label: '截图' },
    { value: 'get_credits', label: '获取积分' },
    { value: 'external_script', label: '执行脚本' },
    { value: 'wait_verification_code', label: '等待验证码' },
    { value: 'save_cookies', label: '获取Cookie' },
    { value: 'loop_click', label: '循环点击' },
    { value: 'clash-system-proxy', label: '切换代理' }
];

const STEP_EDITOR_PRESETS = {
    navigate: {
        type: 'navigate',
        name: '访问网站',
        url: 'https://example.com',
        wait: 0,
        page_sync_timeout_ms: 8000
    },
    click: {
        type: 'click',
        name: '点击元素',
        by: 'css_selector',
        selector: '',
        timeout: 5000,
        wait: 0
    },
    type: {
        type: 'type',
        name: '输入内容',
        by: 'auto',
        selector: '',
        text: '',
        timeout: 5000,
        wait: 0,
        clear_first: true
    },
    wait: {
        type: 'wait',
        name: '等待条件',
        timeout: 3,
        wait_for_element: '',
        wait_for_text: '',
        wait_for_text_hidden: '',
        wait_for_element_hidden: ''
    },
    screenshot: {
        type: 'screenshot',
        name: '截图',
        filename: ''
    },
    get_credits: {
        type: 'get_credits',
        name: '获取积分',
        timeout: 10
    },
    external_script: {
        type: 'external_script',
        name: '执行脚本',
        script: ''
    },
    wait_verification_code: {
        type: 'wait_verification_code',
        name: '等待验证码',
        timeout: 300,
        poll_interval_ms: 3000
    },
    save_cookies: {
        type: 'save_cookies',
        name: '获取Cookie',
        account: '{email}',
        password: '{code}'
    },
    loop_click: {
        type: 'loop_click',
        name: '循环点击',
        by: 'auto',
        selector: '',
        stop_selector: '',
        interval: 2000,
        max_loop_attempts: 20
    },
    'clash-system-proxy': {
        type: 'clash-system-proxy',
        name: '切换代理'
    }
};

const STEP_EDITOR_BOOLEAN_FIELDS = new Set([
    'optional',
    'strict',
    'skip_page_sync',
    'skipPageSync',
    'clear_first',
    'clearFirst',
    'click_before_type',
    'clickBeforeType'
]);

const STEP_EDITOR_NUMERIC_FIELDS = new Set([
    'timeout',
    'wait',
    'wait_ms',
    'waitMs',
    'wait_after_ms',
    'waitAfterMs',
    'page_sync_timeout_ms',
    'pageSyncTimeoutMs',
    'stability_timeout',
    'stabilityTimeout',
    'retry_delay',
    'retryDelay',
    'max_retries',
    'maxRetries',
    'interval',
    'max_loop_attempts',
    'maxLoopAttempts',
    'poll_interval_ms',
    'pollIntervalMs',
    'type_chunk_size',
    'typeChunkSize',
    'type_chunk_delay_ms',
    'typeChunkDelayMs',
    'type_char_delay_ms',
    'typeCharDelayMs',
    'type_operation_timeout_ms',
    'typeOperationTimeoutMs',
    'type_search_poll_interval_ms',
    'typeSearchPollIntervalMs',
    'type_search_probe_timeout_ms',
    'typeSearchProbeTimeoutMs',
    'type_search_log_interval_ms',
    'typeSearchLogIntervalMs'
]);

const STEP_EDITOR_TYPE_ACCENT_CLASS_MAP = {
    navigate: 'step-card--accent-navigate',
    click: 'step-card--accent-click',
    type: 'step-card--accent-type',
    wait: 'step-card--accent-wait',
    screenshot: 'step-card--accent-screenshot',
    get_credits: 'step-card--accent-credits',
    external_script: 'step-card--accent-script',
    wait_verification_code: 'step-card--accent-code',
    save_cookies: 'step-card--accent-cookie',
    loop_click: 'step-card--accent-loop',
    'clash-system-proxy': 'step-card--accent-proxy'
};

const STEP_EDITOR_TEMPLATE_SELECT_ACCENT_CLASS_MAP = {
    navigate: 'step-editor-template-select--accent-navigate',
    click: 'step-editor-template-select--accent-click',
    type: 'step-editor-template-select--accent-type',
    wait: 'step-editor-template-select--accent-wait',
    screenshot: 'step-editor-template-select--accent-screenshot',
    get_credits: 'step-editor-template-select--accent-credits',
    external_script: 'step-editor-template-select--accent-script',
    wait_verification_code: 'step-editor-template-select--accent-code',
    save_cookies: 'step-editor-template-select--accent-cookie',
    loop_click: 'step-editor-template-select--accent-loop',
    'clash-system-proxy': 'step-editor-template-select--accent-proxy'
};

const STEP_EDITOR_CORE_FIELDS = new Set([
    'type',
    'name',
    'by',
    'selector',
    'text',
    'url',
    'script',
    'filename',
    'wait',
    'timeout',
    'wait_for_element',
    'wait_for_text',
    'wait_for_text_hidden',
    'wait_for_element_hidden',
    'stop_selector',
    'recovery_jump_to_step'
]);

const STEP_EDITOR_DYNAMIC_FIELD_VISIBILITY = {
    navigate: ['url'],
    click: ['by', 'selector', 'timeout'],
    type: ['by', 'selector', 'text', 'timeout', 'clear_first'],
    wait: ['timeout', 'wait_for_element', 'wait_for_text', 'wait_for_text_hidden', 'wait_for_element_hidden'],
    screenshot: ['filename'],
    get_credits: ['timeout'],
    external_script: ['script'],
    wait_verification_code: ['timeout', 'poll_interval_ms'],
    save_cookies: ['account', 'password'],
    loop_click: ['by', 'selector', 'stop_selector', 'interval', 'max_loop_attempts'],
    'clash-system-proxy': []
};

function stripStepEditorUiState(step = {}) {
    if (!step || typeof step !== 'object') {
        return {};
    }

    const nextStep = { ...step };
    delete nextStep.ui_fields_mode;
    delete nextStep.ui_fields_expanded;
    return nextStep;
}

function createStepEditorDragSession() {
    return {
        active: false,
        fromIndex: -1,
        insertIndex: -1,
        pointerId: null
    };
}

function parseStepEditorValue(rawValue) {
    const value = String(rawValue ?? '').trim();
    if (value === '') {
        return undefined;
    }

    try {
        return JSON.parse(value);
    } catch (_error) {
        return value;
    }
}

function getStepEditorFieldValue(step, key, fallback = '') {
    const value = step && Object.prototype.hasOwnProperty.call(step, key) ? step[key] : fallback;
    return value === undefined || value === null ? fallback : value;
}

function escapeCssIdentifier(value) {
    return defaultEscapeCssIdentifier(value);
}

function normalizeHasTextSelector(value = '') {
    const text = String(value ?? '').trim();
    if (!text) {
        return '';
    }

    const match = text.match(/^(.+?):has-text\(\s*(['"])([\s\S]*?)\2\s*\)$/i);
    if (!match) {
        return text;
    }

    const prefix = String(match[1] || '').trim();
    const innerText = String(match[3] || '');
    return buildHasTextSelector(prefix, innerText);
}

function normalizeStepEditorSelectorValue(rawValue) {
    const value = String(rawValue ?? '').trim();
    if (!value) {
        return '';
    }

    const normalizedTextSelector = normalizeHasTextSelector(value);
    if (normalizedTextSelector !== value) {
        return normalizedTextSelector;
    }

    if (/^(?:text=|xpath=|id=|css=)/i.test(value)) {
        return value;
    }

    if (value.startsWith('#') || value.startsWith('.') || value.startsWith('[') || value.includes(':has-text(')) {
        return value;
    }

    if (!/^<\s*[a-zA-Z][\w:-]*/.test(value)) {
        return value;
    }

    const nativeCandidates = extractNativeElementSelectorCandidates(value, { escapeCssIdentifier });
    if (nativeCandidates.length > 0) {
        return nativeCandidates[0];
    }

    return value;
}

function normalizeStepEditorSelectorField(fieldName, rawValue) {
    const value = String(rawValue ?? '').trim();
    if (!value) {
        return '';
    }

    if (fieldName === 'selector' || fieldName === 'stop_selector' || fieldName === 'wait_for_element' || fieldName === 'wait_for_element_hidden') {
        return normalizeStepEditorSelectorValue(value);
    }

    return value;
}

function buildStepEditorExtraEntries(step = {}, reservedKeys = new Set()) {
    return Object.entries(step)
        .filter(([key, value]) => {
            if (key === 'ui_fields_expanded' || key === 'ui_fields_mode') {
                return false;
            }
            if (reservedKeys.has(key)) {
                return false;
            }
            if (STEP_EDITOR_CORE_FIELDS.has(key) || STEP_EDITOR_BOOLEAN_FIELDS.has(key) || STEP_EDITOR_NUMERIC_FIELDS.has(key)) {
                return false;
            }
            return value !== undefined && value !== null && value !== '';
        })
        .map(([key, value]) => ({ key, value }));
}

function normalizeStepEditorFieldsMode(step, fallback = STEP_EDITOR_FIELDS_MODE.COLLAPSED) {
    const rawMode = String(step?.stepFieldsMode || step?.ui_fieldsMode || step?.ui_fields_mode || '').trim();
    if (rawMode === STEP_EDITOR_FIELDS_MODE.ALL || rawMode === STEP_EDITOR_FIELDS_MODE.FILLER || rawMode === STEP_EDITOR_FIELDS_MODE.COLLAPSED) {
        return rawMode;
    }

    if (step?.ui_fields_expanded === true) {
        return STEP_EDITOR_FIELDS_MODE.FILLER;
    }

    return fallback;
}

function cycleStepEditorFieldsMode(stepCard, applyStepEditorCardVisibility = null) {
    if (!stepCard) {
        return STEP_EDITOR_FIELDS_MODE.COLLAPSED;
    }

    const currentMode = normalizeStepEditorFieldsMode(stepCard.dataset, STEP_EDITOR_FIELDS_MODE.COLLAPSED);
    const nextMode = currentMode === STEP_EDITOR_FIELDS_MODE.COLLAPSED
        ? STEP_EDITOR_FIELDS_MODE.FILLER
        : (currentMode === STEP_EDITOR_FIELDS_MODE.FILLER ? STEP_EDITOR_FIELDS_MODE.ALL : STEP_EDITOR_FIELDS_MODE.COLLAPSED);

    stepCard.dataset.stepFieldsMode = nextMode;
    if (typeof applyStepEditorCardVisibility === 'function') {
        applyStepEditorCardVisibility(stepCard);
    }
    return nextMode;
}

function getStepEditorTemplate(stepType = 'navigate', presets = STEP_EDITOR_PRESETS) {
    const normalizedType = String(stepType || 'navigate').trim();
    return presets[normalizedType] || presets.navigate || null;
}

module.exports = function createCardManagerStepEditor(deps = {}) {
    const applyStepEditorCardVisibility = typeof deps.applyStepEditorCardVisibility === 'function'
        ? deps.applyStepEditorCardVisibility
        : null;

    return {
        STEP_EDITOR_TEMPLATE_OPTIONS,
        STEP_EDITOR_PRESETS,
        STEP_EDITOR_BOOLEAN_FIELDS,
        STEP_EDITOR_NUMERIC_FIELDS,
        STEP_EDITOR_TYPE_ACCENT_CLASS_MAP,
        STEP_EDITOR_TEMPLATE_SELECT_ACCENT_CLASS_MAP,
        STEP_EDITOR_CORE_FIELDS,
        STEP_EDITOR_DYNAMIC_FIELD_VISIBILITY,
        STEP_EDITOR_FIELDS_MODE,
        stripStepEditorUiState,
        createStepEditorDragSession,
        parseStepEditorValue,
        getStepEditorFieldValue,
        escapeCssIdentifier,
        normalizeHasTextSelector,
        normalizeStepEditorSelectorValue,
        normalizeStepEditorSelectorField,
        buildStepEditorExtraEntries,
        normalizeStepEditorFieldsMode,
        cycleStepEditorFieldsMode: (stepCard) => cycleStepEditorFieldsMode(stepCard, applyStepEditorCardVisibility),
        getStepEditorTemplate
    };
};
