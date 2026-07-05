/**
 * AI 自动化工具 2.0 - 渲染进程核心
 *
 * `renderer.js` 现在只是一个轻入口。
 * 这个文件保留状态、DOM 和模块组装；
 * 浏览器、后端配置、执行控制、进度、Cookie、海卡和 wiring 已拆到 `src/ui/modules`。
 */

const { ipcRenderer } = require('electron');
const { consoleManager, logger } = require('../console.js');

// ==================== 导入模块 ====================
const cardManager = require('./card-manager');
const cookieManager = require('./cookie-manager');
const cookieTester = require('./cookie-tester');
const clashManager = require('./clash-manager');
const utils = require('./utils');

// ==================== 全局状态 ====================
// 运行与任务状态
let currentCard = null;
let activeTestTasks = new Map(); // 存储正在进行的测试任务
let runningTasks = new Map();
let taskProgressBars = new Map();
let taskProgressCleanupTimers = new Map();
const DEFAULT_REGISTRATION_RUN_MODE = 0;
const THEME_STORAGE_KEY = 'ui-theme';

// 上传与上下文菜单状态
let cachedUploadDeviceId = '';
let cookieAccountContextMenu = null;
let cookieAccountContextInfo = null;
let cookieBatchContextMenu = null;
let cookieBatchTaskControllers = new Map();

// 海卡状态
let currentTrialBinding = null;
let currentHaikaCategory = '';
let currentHaikaKeys = [];
let currentHaikaBindCard = null;
let currentApiCard = null;
let currentModelCard = null;
let currentHaikaBindBatchId = null;
let currentHaikaBindBatchActive = false;
let currentHaikaBindBatchTotal = 0;
let currentTimedRegistrationTaskId = null;
let currentCardDebugTaskId = null;
let currentCardDebugState = null;
let hideHaikaSuggestionsTimer = null;
let lastTcpConnectionConsoleSignature = '';
function groupCookiesByCardName(cookies = []) {
    return (Array.isArray(cookies) ? cookies : []).reduce((groups, cookie) => {
        const cardName = cookie?.card_name || '未分类';
        if (!groups[cardName]) {
            groups[cardName] = [];
        }
        groups[cardName].push(cookie);
        return groups;
    }, {});
}

function getStoredTheme() {
    try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'dark' || stored === 'light') {
            return stored;
        }
    } catch (_) {}

    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }

    return 'light';
}

function applyTheme(theme) {
    const normalizedTheme = theme === 'dark' ? 'dark' : 'light';

    if (document.body) {
        document.body.dataset.theme = normalizedTheme;
    }

    if (elements.themeToggleBtn) {
        const isDark = normalizedTheme === 'dark';
        elements.themeToggleBtn.textContent = isDark ? '浅色' : '深色';
        elements.themeToggleBtn.setAttribute('aria-pressed', String(isDark));
        elements.themeToggleBtn.title = isDark ? '切换到浅色模式' : '切换到深色模式';
    }

    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
    } catch (_) {}
}

function toggleTheme() {
    const currentTheme = document.body?.dataset.theme || getStoredTheme();
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

// ==================== DOM 元素 ====================
const elements = {
    // 状态显示
    taskCount: document.getElementById('task-count'),
    cookieCount: document.getElementById('cookie-count'),
    statusLabel: document.getElementById('status-label'),
    licenseUsageLabel: document.getElementById('license-usage-label'),
    themeToggleBtn: document.getElementById('theme-toggle-btn'),
    exitAppBtn: document.getElementById('exit-app-btn'),
    leftDrawerBubble: document.getElementById('left-drawer-bubble'),
    rightDrawerBubble: document.getElementById('right-drawer-bubble'),
    mainContainer: document.querySelector('.main-container'),
    contentArea: document.querySelector('.content-area'),
    leftPanel: document.querySelector('.left-panel'),
    middlePanel: document.querySelector('.middle-panel'),
    rightPanel: document.querySelector('.right-panel'),
    middleTabButtons: document.querySelectorAll('.middle-tab-header'),
    middleTabContents: document.querySelectorAll('.middle-tab-content'),

    // 卡片管理
    cardList: document.getElementById('card-list'),
    addCardBtn: document.getElementById('add-card-btn'),
    refreshCardBtn: document.getElementById('refresh-card-btn'),
    importCardBtn: document.getElementById('import-card-btn'),
    editCardBtn: document.getElementById('edit-card-btn'),
    deleteCardBtn: document.getElementById('delete-card-btn'),

    // 测试卡片管理
    testCardList: document.getElementById('test-card-list'),
    addTestCardBtn: document.getElementById('add-test-card-btn'),
    importTestCardBtn: document.getElementById('import-test-card-btn'),
    editTestCardBtn: document.getElementById('edit-test-card-btn'),
    deleteTestCardBtn: document.getElementById('delete-test-card-btn'),

    // API卡片管理
    apiCardList: document.getElementById('api-card-list'),
    addApiCardBtn: document.getElementById('add-api-card-btn'),
    importApiCardBtn: document.getElementById('import-api-card-btn'),
    refreshApiCardBtn: document.getElementById('refresh-api-card-btn'),
    editApiCardBtn: document.getElementById('edit-api-card-btn'),
    deleteApiCardBtn: document.getElementById('delete-api-card-btn'),

    // 模型卡片管理
    modelCardList: document.getElementById('model-card-list'),
    addModelCardBtn: document.getElementById('add-model-card-btn'),
    importModelCardBtn: document.getElementById('import-model-card-btn'),
    refreshModelCardBtn: document.getElementById('refresh-model-card-btn'),
    editModelCardBtn: document.getElementById('edit-model-card-btn'),
    deleteModelCardBtn: document.getElementById('delete-model-card-btn'),

    // 浏览器设置
    browserType: document.getElementById('browser-type'),
    headlessMode: document.getElementById('headless-mode'),
    browserBlockImagesVideos: document.getElementById('browser-block-images-videos'),
    browserRemoveWatermarkPlugin: document.getElementById('browser-remove-watermark-plugin'),
    detectBrowserBtn: document.getElementById('detect-browser-btn'),

    // API 设置
    apiServerStartBtn: document.getElementById('api-server-start-btn'),
    apiServerStopBtn: document.getElementById('api-server-stop-btn'),
    apiServerStatus: document.getElementById('api-server-status'),
    apiServerUrl: document.getElementById('api-server-url'),
    apiServerHost: document.getElementById('api-server-host'),
    apiServerPort: document.getElementById('api-server-port'),
    apiServerKey: document.getElementById('api-server-key'),
    apiServerGenerateKeyBtn: document.getElementById('api-server-generate-key-btn'),
    apiTextModelParams: document.getElementById('api-text-model-params'),
    apiTextTestBtn: document.getElementById('api-text-test-btn'),
    apiImageModelParams: document.getElementById('api-image-model-params'),
    apiImageTestBtn: document.getElementById('api-image-test-btn'),
    apiVideoModelParams: document.getElementById('api-video-model-params'),
    apiVideoTestBtn: document.getElementById('api-video-test-btn'),
    apiSettingsSaveBtn: document.getElementById('api-settings-save-btn'),
    apiSettingsReloadBtn: document.getElementById('api-settings-reload-btn'),
    apiServerConsoleOutput: document.getElementById('api-server-console-output'),
    apiServerConsoleClearBtn: document.getElementById('api-server-console-clear-btn'),

    // 运行控制
    runModeButtons: document.querySelectorAll('.run-mode-btn'),
    registrationTimedSettings: document.getElementById('registration-timed-settings'),
    registrationTimedCount: document.getElementById('registration-timed-count'),
    registrationTimedCycleCount: document.getElementById('registration-timed-cycle-count'),
    registrationTimedStartMode: document.getElementById('registration-timed-start-mode'),
    registrationTimedDelaySeconds: document.getElementById('registration-timed-delay-seconds'),
    concurrentCount: document.getElementById('concurrent-count'),
    proxyRecoveryAttempts: document.getElementById('proxy-recovery-attempts'),
    startBtn: document.getElementById('start-btn'),
    stopBtn: document.getElementById('stop-btn'),
    customTestAccountAccount: document.getElementById('custom-test-account-account'),
    customTestAccountPassword: document.getElementById('custom-test-account-password'),
    customTestAccountBtn: document.getElementById('custom-test-account-btn'),
    syncControlWrapper: document.getElementById('sync-control-wrapper'),
    syncExecution: document.getElementById('sync-execution'),
    registrationAutoUpload: document.getElementById('registration-auto-upload'),
    registrationSaveLocalCookie: document.getElementById('registration-save-local-cookie'),
    registrationUploadServerUrl: document.getElementById('registration-upload-server-url'),
    registrationUploadCardKey: document.getElementById('registration-upload-card-key'),
    cardUploadConfigGroup: document.getElementById('card-upload-config-group'),
    cardUploadTargetScoreScope: document.getElementById('card-upload-target-score-scope'),
    cardUploadTargetScoreTypes: document.getElementById('card-upload-target-score-types'),
    cardUploadTargetScoreTypesGroup: document.getElementById('card-upload-target-score-types-group'),
    uploadSettingsCard: document.querySelector('.upload-settings-card'),
    uploadModeTcpBtn: document.getElementById('upload-mode-tcp-btn'),
    uploadModeHttpBtn: document.getElementById('upload-mode-http-btn'),
    uploadModeTcpPanel: document.getElementById('upload-mode-tcp-panel'),
    uploadModeHttpPanel: document.getElementById('upload-mode-http-panel'),
    httpSettingsSaveBtn: document.getElementById('http-settings-save-btn'),

    // 控制台
    consoleOutput: document.getElementById('console-output'),
    clearConsoleBtn: document.getElementById('clear-console-btn'),

    // 进度列表
    progressList: document.getElementById('progress-list'),
    taskHistoryPanel: document.getElementById('task-history-panel'),
    taskHistoryBody: document.getElementById('task-history-body'),
    taskHistoryList: document.getElementById('task-history-list'),
    taskHistoryClearBtn: document.getElementById('task-history-clear-btn'),
    taskHistoryMoreBtn: document.getElementById('task-history-more-btn'),
    taskHistoryToggleBtn: document.getElementById('task-history-toggle-btn'),
    taskHistoryDialog: document.getElementById('task-history-dialog'),
    taskHistoryDialogList: document.getElementById('task-history-dialog-list'),
    taskHistoryDialogCloseBtn: document.getElementById('task-history-dialog-close-btn'),
    taskHistoryDialogCloseBtn2: document.getElementById('task-history-dialog-close-btn-2'),

    // Cookie 管理
    cookieTabHeaders: document.querySelector('.cookie-tab-headers'),
    cookieTabContents: document.querySelector('.cookie-tab-contents'),
    cookieTableBodyOverview: document.getElementById('cookie-table-body-overview'),
    cookieSelectAllBtn: document.getElementById('cookie-select-all-btn'),
    refreshCookiesBtn: document.getElementById('refresh-cookies-btn'),
    testCookiesBtn: document.getElementById('test-cookies-btn'),
    openCookieFolderBtn: document.getElementById('open-cookie-folder-btn'),

    // 海卡兑换
    trialRedeemBtn: document.getElementById('trial-redeem-btn'),
    trialCardKey: document.getElementById('trial-card-key'),
    trialOpenCategoryModalBtn: document.getElementById('trial-open-category-modal-btn'),
    addHaikaBindCardBtn: document.getElementById('add-haika-bind-card-btn'),
    importHaikaBindCardBtn: document.getElementById('import-haika-bind-card-btn'),
    editHaikaBindCardBtn: document.getElementById('edit-haika-bind-card-btn'),
    deleteHaikaBindCardBtn: document.getElementById('delete-haika-bind-card-btn'),
    haikaBindCardList: document.getElementById('haika-bind-card-list'),
    haikaBindAccountFolder: document.getElementById('haika-bind-account-folder'),
    haikaBindAccountFilter: document.getElementById('haika-bind-account-filter'),
    haikaBindStartBtn: document.getElementById('haika-bind-start-btn'),
    haikaBindStopBtn: document.getElementById('haika-bind-stop-btn'),
    trialCategorySelect: document.getElementById('trial-category-select'),
    trialCategoryName: document.getElementById('trial-category-name'),
    trialCreateCategoryBtn: document.getElementById('trial-create-category-btn'),
    trialRefreshCategoriesBtn: document.getElementById('trial-refresh-categories-btn'),
    trialKeySuggestions: document.getElementById('trial-key-suggestions'),
    haikaCategoryModal: document.getElementById('haika-category-modal'),
    closeHaikaCategoryModalBtn: document.getElementById('close-haika-category-modal-btn'),
    closeHaikaCategoryModalBtn2: document.getElementById('close-haika-category-modal-btn-2'),
    haikaImportTargetCategory: document.getElementById('haika-import-target-category'),
    haikaImportText: document.getElementById('haika-import-text'),
    haikaImportConfirmBtn: document.getElementById('haika-import-confirm-btn'),
    trialStatusPill: document.getElementById('trial-status-pill'),
    trialCacheTip: document.getElementById('trial-cache-tip'),
    trialCardNumber: document.getElementById('trial-card-number'),
    trialExpiryDate: document.getElementById('trial-expiry-date'),
    trialCvv: document.getElementById('trial-cvv'),
    trialName: document.getElementById('trial-name'),
    trialPhone: document.getElementById('trial-phone'),
    trialAddress: document.getElementById('trial-address'),
    trialSmsCode: document.getElementById('trial-sms-code'),
    trialRefreshSmsBtn: document.getElementById('trial-refresh-sms-btn'),
    trialSmsStatus: document.getElementById('trial-sms-status'),
    trialResponseJson: document.getElementById('trial-response-json'),

    // Cookie测试配置
    cookieTestFolder: document.getElementById('cookie-test-folder'),
    cookieTestFilter: document.getElementById('cookie-test-filter'),

    // 邮箱连接
    emailModeConnectBtn: document.getElementById('email-mode-connect-btn'),
    emailModeOutlookBtn: document.getElementById('email-mode-outlook-btn'),
    emailModeTempBtn: document.getElementById('email-mode-temp-btn'),
    emailModeApiBtn: document.getElementById('email-mode-api-btn'),
    emailModeConnectPanel: document.getElementById('email-mode-connect-panel'),
    emailModeOutlookPanel: document.getElementById('email-mode-outlook-panel'),
    outlookEmailImportBtn: document.getElementById('outlook-email-import-btn'),
    outlookEmailClearBtn: document.getElementById('outlook-email-clear-btn'),
    outlookEmailList: document.getElementById('outlook-email-list'),
    outlookEmailContent: document.getElementById('outlook-email-content'),
    outlookEmailImportDialog: document.getElementById('outlook-email-import-dialog'),
    outlookEmailImportText: document.getElementById('outlook-email-import-text'),
    outlookEmailImportCloseBtn: document.getElementById('outlook-email-import-close-btn'),
    outlookEmailImportCancelBtn: document.getElementById('outlook-email-import-cancel-btn'),
    outlookEmailImportConfirmBtn: document.getElementById('outlook-email-import-confirm-btn'),
    emailModeTempPanel: document.getElementById('email-mode-temp-panel'),
    emailModeApiPanel: document.getElementById('email-mode-api-panel'),
    emailHost: document.getElementById('email-host'),
    emailPort: document.getElementById('email-port'),
    emailSuffix: document.getElementById('email-suffix'),
    emailConfigSaveBtn: document.getElementById('email-config-save-btn'),
    emailConnectBtn: document.getElementById('email-connect-btn'),
    emailDisconnectBtn: document.getElementById('email-disconnect-btn'),
    emailStatus: document.getElementById('email-status'),
    tempEmailCardList: document.getElementById('temp-email-card-list'),
    tempEmailAddBtn: document.getElementById('temp-email-add-btn'),
    tempEmailImportBtn: document.getElementById('temp-email-import-btn'),
    tempEmailEditBtn: document.getElementById('temp-email-edit-btn'),
    tempEmailDeleteBtn: document.getElementById('temp-email-delete-btn'),
    tempEmailOpenBtn: document.getElementById('temp-email-open-btn'),
    tempEmailRefreshEmailBtn: document.getElementById('temp-email-refresh-email-btn'),
    tempEmailGetEmailBtn: document.getElementById('temp-email-get-email-btn'),
    tempEmailGetCodeBtn: document.getElementById('temp-email-get-code-btn'),
    tempEmailConsoleOutput: document.getElementById('temp-email-console-output'),
    tempEmailAutoScroll: document.getElementById('temp-email-auto-scroll'),
    tempEmailProviderDialog: document.getElementById('temp-email-provider-dialog'),
    tempEmailProviderDialogTitle: document.getElementById('temp-email-provider-dialog-title'),
    tempEmailProviderDialogCloseBtn: document.getElementById('temp-email-provider-dialog-close-btn'),
    tempEmailProviderForm: document.getElementById('temp-email-provider-form'),
    tempEmailProviderOriginalId: document.getElementById('temp-email-provider-original-id'),
    tempEmailProviderName: document.getElementById('temp-email-provider-name'),
    tempEmailProviderUrl: document.getElementById('temp-email-provider-url'),
    tempEmailProviderClosePopups: document.getElementById('temp-email-provider-close-popups'),
    tempEmailProviderEmailElement: document.getElementById('temp-email-provider-email-element'),
    tempEmailProviderRefreshButton: document.getElementById('temp-email-provider-refresh-button'),
    tempEmailProviderCodeClickElement: document.getElementById('temp-email-provider-code-click-element'),
    tempEmailProviderCodeElement: document.getElementById('temp-email-provider-code-element'),
    tempEmailProviderCancelBtn: document.getElementById('temp-email-provider-cancel-btn'),
    tempEmailProviderDebugBtn: document.getElementById('temp-email-provider-debug-btn'),
    tempEmailProviderSaveBtn: document.getElementById('temp-email-provider-save-btn'),
    tempEmailHttpOpenBtn: document.getElementById('temp-email-http-open-btn'),
    tempEmailHttpCloseBtn: document.getElementById('temp-email-http-close-btn'),
    tempEmailHttpGetEmailBtn: document.getElementById('temp-email-http-get-email-btn'),
    tempEmailHttpGetCodeBtn: document.getElementById('temp-email-http-get-code-btn'),
    tempEmailHttpStatus: document.getElementById('temp-email-http-status'),
    tempEmailHttpResult: document.getElementById('temp-email-http-result'),
    tempEmailHttpBaseUrl: document.getElementById('temp-email-http-base-url'),
    tempEmailApiPanel: document.getElementById('email-mode-api-panel'),
    emailApiBaseUrl: document.getElementById('email-api-base-url'),
    emailApiKey: document.getElementById('email-api-key'),
    emailApiCopyBtn: document.getElementById('email-api-copy-btn'),
    emailApiGenerateBtn: document.getElementById('email-api-generate-btn'),
    emailApiListBtn: document.getElementById('email-api-list-btn'),
    emailApiDetailBtn: document.getElementById('email-api-detail-btn'),
    emailApiDeleteBtn: document.getElementById('email-api-delete-btn'),
    emailApiClearBtn: document.getElementById('email-api-clear-btn'),
    emailApiGeneratedEmail: document.getElementById('email-api-generated-email'),
    emailApiInboxResult: document.getElementById('email-api-inbox-result'),
    emailApiDetailResult: document.getElementById('email-api-detail-result'),
    emailApiRawDetailResult: document.getElementById('email-api-raw-detail-result'),
    emailApiDeleteResult: document.getElementById('email-api-delete-result'),
    emailApiClearResult: document.getElementById('email-api-clear-result'),
    proxyIpipBtn: document.getElementById('proxy-ipip-btn'),
    proxyNexscanBtn: document.getElementById('proxy-nexscan-btn'),

    // 上传设置 / TCP连接
    mqttConnectionStatus: document.getElementById('mqtt-connection-status'),
    mqttConnectionEnabled: document.getElementById('mqtt-connection-enabled'),
    mqttConnectionConnected: document.getElementById('mqtt-connection-connected'),
    mqttConnectionSubscribed: document.getElementById('mqtt-connection-subscribed'),
    mqttConnectionEndpoint: document.getElementById('mqtt-connection-endpoint'),
    mqttConnectionReconnect: document.getElementById('mqtt-connection-reconnect'),
    mqttConnectionLocked: document.getElementById('mqtt-connection-locked'),
    mqttConnectionNote: document.getElementById('mqtt-connection-note'),
    tcpConnectionConsoleOutput: document.getElementById('tcp-connection-console-output'),
    tcpConnectionConsoleClearBtn: document.getElementById('tcp-connection-console-clear-btn'),
    tcpServerUrl: document.getElementById('tcp-server-url'),
    tcpAutoReconnectEnabled: document.getElementById('tcp-auto-reconnect-enabled'),
    tcpSettingsSaveBtn: document.getElementById('tcp-settings-save-btn'),

    // AI 管理
    aiAssistantConfigOpenBtn: document.getElementById('ai-assistant-config-open-btn'),
    aiAssistantConfigDialog: document.getElementById('ai-assistant-config-dialog'),
    aiAssistantConfigCloseBtn: document.getElementById('ai-assistant-config-close-btn'),
    aiAssistantConfigReloadBtn: document.getElementById('ai-assistant-config-reload-btn'),
    aiAssistantConfigCancelBtn: document.getElementById('ai-assistant-config-cancel-btn'),
    aiAssistantConfigSaveBtn: document.getElementById('ai-assistant-config-save-btn'),
    aiAssistantConfigBaseUrl: document.getElementById('ai-assistant-config-base-url'),
    aiAssistantConfigModel: document.getElementById('ai-assistant-config-model'),
    aiAssistantConfigApiKey: document.getElementById('ai-assistant-config-api-key'),
    aiAssistantConfigActiveProfiles: document.getElementById('ai-assistant-config-active-profiles'),
    aiAssistantConfigProfileNote: document.getElementById('ai-assistant-config-profile-note'),
    aiAssistantConfigStatus: document.getElementById('ai-assistant-config-status'),
    aiAssistantChatSummary: document.getElementById('ai-assistant-chat-summary'),
    aiAssistantHistoryDropdown: document.getElementById('ai-assistant-history-dropdown'),
    aiAssistantHistoryToggleBtn: document.getElementById('ai-assistant-history-toggle-btn'),
    aiAssistantHistoryCurrentLabel: document.getElementById('ai-assistant-history-current-label'),
    aiAssistantHistoryMenu: document.getElementById('ai-assistant-history-menu'),
    aiAssistantClearBtn: document.getElementById('ai-assistant-clear-btn'),
    aiAssistantChatList: document.getElementById('ai-assistant-chat-list'),
    aiAssistantInput: document.getElementById('ai-assistant-input'),
    aiAssistantSendBtn: document.getElementById('ai-assistant-send-btn'),

    // 对话框
    cardDialog: document.getElementById('card-dialog'),
    dialogTitle: document.getElementById('dialog-title'),
    cardForm: document.getElementById('card-form'),
    cardDialogBaseTabBtn: document.getElementById('card-dialog-base-tab-btn'),
    cardDialogDebugTabBtn: document.getElementById('card-dialog-debug-tab-btn'),
    cardDialogApiServiceTabBtn: document.getElementById('card-dialog-api-service-tab-btn'),
    cardDialogBaseTab: document.getElementById('card-dialog-base-tab'),
    cardDialogDebugTab: document.getElementById('card-dialog-debug-tab'),
    cardDialogApiServiceTab: document.getElementById('card-dialog-api-service-tab'),
    cardDialogStepsTabBtn: document.getElementById('card-right-panel-steps-tab-btn'),
    cardDialogPopupsTabBtn: document.getElementById('card-right-panel-popups-tab-btn'),
    cardDialogStepsTab: document.getElementById('card-right-panel-steps-tab'),
    cardDialogPopupsTab: document.getElementById('card-right-panel-popups-tab'),
    cardName: document.getElementById('card-name'),
    cardWebsite: document.getElementById('card-website'),
    cardPassword: document.getElementById('card-password'),
    cardPoints: document.getElementById('card-points'),
    cardDescription: document.getElementById('card-description'),
    cardApiServiceType: document.getElementById('card-api-service-type'),
    cardApiServiceEndpoint: document.getElementById('card-api-service-endpoint'),
    cardApiServiceParams: document.getElementById('card-api-service-params'),
    cardMinCookieSize: document.getElementById('card-min-cookie-size'),
    cardMinCookieSizeGroup: document.getElementById('card-min-cookie-size-group'),

    // 邮箱随机配置
    emailRandomLength: document.getElementById('email-random-length'),
    emailRandomType: document.getElementById('email-random-type'),
    cardPasswordRandomLength: document.getElementById('card-password-random-length'),
    cardPasswordRandomType: document.getElementById('card-password-random-type'),
    cardPasswordRandomGroup: document.getElementById('card-password-random-group'),

    cardPopupsTextarea: document.getElementById('card-popups'),
    cardStepsTextarea: document.getElementById('card-steps'),
    cardStepTemplatePicker: document.getElementById('card-step-template-picker'),
    cardStepTemplateBtn: document.getElementById('card-step-template-btn'),
    cardStepTemplateLabel: document.getElementById('card-step-template-label'),
    cardStepTemplateValue: document.getElementById('card-step-template-value'),
    cardStepTemplateMenu: document.getElementById('card-step-template-menu'),
    cardStepAddBtn: document.getElementById('card-step-add-btn'),
    cardStepEditorList: document.getElementById('card-step-editor-list'),
    cardStepsUpdateBtn: document.getElementById('card-steps-update-btn'),
    cardDebugStepPause: document.getElementById('card-debug-step-pause'),
    debugCardBtn: document.getElementById('debug-card-btn'),
    cardDebugPanel: document.getElementById('card-debug-panel'),
    cardDebugStatusText: document.getElementById('card-debug-status-text'),
    cardDebugProgressText: document.getElementById('card-debug-progress-text'),
    cardDebugStepText: document.getElementById('card-debug-step-text'),
    cardDebugProgressFill: document.getElementById('card-debug-progress-fill'),
    cardDebugPauseBtn: document.getElementById('card-debug-pause-btn'),
    cardDebugLoopBtn: document.getElementById('card-debug-loop-btn'),
    cardDebugStepBtn: document.getElementById('card-debug-step-btn'),
    cardStepProgressSummary: document.getElementById('card-step-progress-summary'),
    cardStepProgressList: document.getElementById('card-step-progress-list'),
    saveCardBtn: document.getElementById('save-card-btn'),
    cancelCardBtn: document.getElementById('cancel-card-btn'),
    closeDialogBtn: document.getElementById('close-dialog-btn'),

    // 教程弹窗
    tutorialDialog: document.getElementById('tutorial-dialog'),
    tutorialTitle: document.getElementById('tutorial-title'),
    tutorialContent: document.getElementById('tutorial-content'),
    closeTutorialBtn: document.getElementById('close-tutorial-btn'),
    tutorialOkBtn: document.getElementById('tutorial-ok-btn'),
    popupsTutorialBtn: document.getElementById('popups-tutorial-btn'),
    stepsTutorialBtn: document.getElementById('steps-tutorial-btn'),

    // 消息对话框
    messageDialog: document.getElementById('message-dialog'),
    messageText: document.getElementById('message-text'),
    messageOkBtn: document.getElementById('message-ok-btn'),
    confirmDialog: document.getElementById('confirm-dialog'),
    confirmTitle: document.getElementById('confirm-title'),
    confirmText: document.getElementById('confirm-text'),
    confirmCloseBtn: document.getElementById('confirm-close-btn'),
    confirmCancelBtn: document.getElementById('confirm-cancel-btn'),
    confirmOkBtn: document.getElementById('confirm-ok-btn'),

    // Clash Verge Rev
    clashRefreshBtn: document.getElementById('clash-refresh-btn'),
    clashStatus: document.getElementById('clash-status'),
    clashCurrentProfileName: document.getElementById('clash-current-profile-name'),
    clashCurrentNodeName: document.getElementById('clash-current-node-name'),
    clashProfileSelect: document.getElementById('clash-profile-select'),
    clashNodesList: document.getElementById('clash-nodes-list'),
    clashSwitchNodeBtn: document.getElementById('clash-switch-node-btn'),
    clashTestLatencyBtn: document.getElementById('clash-test-latency-btn'),
    clashTestAllLatencyBtn: document.getElementById('clash-test-all-latency-btn'),
    clashSystemProxy: document.getElementById('clash-system-proxy'),
    clashTunMode: document.getElementById('clash-tun-mode')
};

// ==================== 模块组装 ====================
const createRendererWiring = require('./renderer-wiring');
const createRendererConfig = require('./renderer-config');
const createRendererExecution = require('./renderer-execution');
const createRendererProgress = require('./task-progress');
const createRendererCookie = require('./renderer-cookie');
const createRendererHaika = require('./renderer-haika');
const createRendererBrowser = require('./renderer-browser');
const createRendererConsole = require('./renderer-console');
const createRendererTempEmail = require('./renderer-temp-email');
const createRendererAiAssistant = require('./renderer-ai-assistant');

const rendererWiringDeps = {
    elements,
    cardManager,
    cookieManager,
    cookieTester,
    clashManager,
    utils,
    logger,
    ipcRenderer,
    DEFAULT_REGISTRATION_RUN_MODE,
    groupCookiesByCardName,
    applyTheme,
    getStoredTheme,
    toggleTheme
};

const bindState = (name, getter, setter) => Object.defineProperty(rendererWiringDeps, name, {
    enumerable: true,
    get: getter,
    set: setter
});

bindState('currentCard', () => currentCard, value => { currentCard = value; });
bindState('activeTestTasks', () => activeTestTasks, value => { activeTestTasks = value; });
bindState('runningTasks', () => runningTasks, value => { runningTasks = value; });
bindState('taskProgressBars', () => taskProgressBars, value => { taskProgressBars = value; });
bindState('taskProgressCleanupTimers', () => taskProgressCleanupTimers, value => { taskProgressCleanupTimers = value; });
bindState('cachedUploadDeviceId', () => cachedUploadDeviceId, value => { cachedUploadDeviceId = value; });
bindState('cookieAccountContextMenu', () => cookieAccountContextMenu, value => { cookieAccountContextMenu = value; });
bindState('cookieAccountContextInfo', () => cookieAccountContextInfo, value => { cookieAccountContextInfo = value; });
bindState('cookieBatchContextMenu', () => cookieBatchContextMenu, value => { cookieBatchContextMenu = value; });
bindState('cookieBatchTaskControllers', () => cookieBatchTaskControllers, value => { cookieBatchTaskControllers = value; });
bindState('currentTrialBinding', () => currentTrialBinding, value => { currentTrialBinding = value; });
bindState('currentHaikaCategory', () => currentHaikaCategory, value => { currentHaikaCategory = value; });
bindState('currentHaikaKeys', () => currentHaikaKeys, value => { currentHaikaKeys = value; });
bindState('currentHaikaBindCard', () => currentHaikaBindCard, value => { currentHaikaBindCard = value; });
bindState('currentApiCard', () => currentApiCard, value => { currentApiCard = value; });
bindState('currentModelCard', () => currentModelCard, value => { currentModelCard = value; });
bindState('currentHaikaBindBatchId', () => currentHaikaBindBatchId, value => { currentHaikaBindBatchId = value; });
bindState('currentHaikaBindBatchActive', () => currentHaikaBindBatchActive, value => { currentHaikaBindBatchActive = value; });
bindState('currentHaikaBindBatchTotal', () => currentHaikaBindBatchTotal, value => { currentHaikaBindBatchTotal = value; });
bindState('currentTimedRegistrationTaskId', () => currentTimedRegistrationTaskId, value => { currentTimedRegistrationTaskId = value; });
bindState('currentCardDebugTaskId', () => currentCardDebugTaskId, value => { currentCardDebugTaskId = value; });
bindState('currentCardDebugState', () => currentCardDebugState, value => { currentCardDebugState = value; });
bindState('hideHaikaSuggestionsTimer', () => hideHaikaSuggestionsTimer, value => { hideHaikaSuggestionsTimer = value; });
bindState('lastTcpConnectionConsoleSignature', () => lastTcpConnectionConsoleSignature, value => { lastTcpConnectionConsoleSignature = value; });

const rendererBrowserApi = createRendererBrowser(rendererWiringDeps);
Object.assign(rendererWiringDeps, rendererBrowserApi);

const rendererConfigApi = createRendererConfig(rendererWiringDeps);
Object.assign(rendererWiringDeps, rendererConfigApi);

const rendererExecutionApi = createRendererExecution(rendererWiringDeps);
Object.assign(rendererWiringDeps, rendererExecutionApi);

const rendererProgressApi = createRendererProgress(rendererWiringDeps);
Object.assign(rendererWiringDeps, rendererProgressApi);

const rendererHaikaApi = createRendererHaika(rendererWiringDeps);
Object.assign(rendererWiringDeps, rendererHaikaApi);

const rendererCookieApi = createRendererCookie(rendererWiringDeps);
Object.assign(rendererWiringDeps, rendererCookieApi);

const rendererAiAssistantApi = createRendererAiAssistant(rendererWiringDeps);
Object.assign(rendererWiringDeps, rendererAiAssistantApi);

const rendererConsoleApi = createRendererConsole({
    ...rendererWiringDeps,
    consoleManager
});
Object.assign(rendererWiringDeps, rendererConsoleApi);

const rendererTempEmailApi = createRendererTempEmail(rendererWiringDeps);
Object.assign(rendererWiringDeps, rendererTempEmailApi);
rendererWiringDeps.tempEmail = rendererTempEmailApi;

// 把事件绑定、IPC 和初始化交给单独的 wiring 层，主文件只保留共享状态与基础工具
createRendererWiring(rendererWiringDeps);
