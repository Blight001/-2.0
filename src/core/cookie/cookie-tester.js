const Logger = require('../infra/logger');
const suiteHelpers = require('./cookie-tester-suite');
const actionHelpers = require('./cookie-tester-actions');

class CookieTester {
    constructor(options = {}) {
        this.browserManager = options.browserManager;
        this.cookieManager = options.cookieManager;
        this.cardManager = options.cardManager;
        this.clashManager = options.clashManager;
        this.browserType = options.browserType || 'electron';
        this.browserSettings = options.browserSettings || {};
        this.logger = options.logger || new Logger();
        this.shouldStop = false; // 停止测试标志
        this.mainWindow = options.mainWindow; // 主窗口引用，用于发送IPC消息

        // 测试配置
        this.testConfig = {
            headless: options.headless || false,      // 是否无头模式
            concurrentCount: options.concurrentCount || 1,  // 并发数量
            mode: options.mode || 'sequential'       // 'sequential' 或 'concurrent'
        };

        // 卡片数据缓存（避免重复加载）
        this.cardsCache = null;
        this.cardsCacheTime = 0;
        this.testCardsCache = null;
        this.testCardsCacheTime = 0;
        this.CACHE_DURATION = 60000; // 缓存有效期 60秒
    }

    async testAllCookies(progressCallback = null) { return suiteHelpers.testAllCookies.call(this, progressCallback); }
    async testSingleCookie(email, testWithCardName, originalCardName = null) { return suiteHelpers.testSingleCookie.call(this, email, testWithCardName, originalCardName); }
    async previewSingleCookie(email, testWithCardName, originalCardName = null) { return suiteHelpers.previewSingleCookie.call(this, email, testWithCardName, originalCardName); }
    async testCookieApiThenModel(email, apiCardName, modelCardName, originalCardName = null) { return suiteHelpers.testCookieApiThenModel.call(this, email, apiCardName, modelCardName, originalCardName); }
    async testCookieWithRawData(cookieData, cardName) { return suiteHelpers.testCookieWithRawData.call(this, cookieData, cardName); }
    async testCookiesByCard(cardName, progressCallback = null) { return suiteHelpers.testCookiesByCard.call(this, cardName, progressCallback); }
    async testCookiesByTestCard(testCard, progressCallback = null, folderName = 'all', filterType = 'all') { return suiteHelpers.testCookiesByTestCard.call(this, testCard, progressCallback, folderName, filterType); }
    async testCookiesByPoints(cardName, points, progressCallback = null, testWithCardName = null) { return suiteHelpers.testCookiesByPoints.call(this, cardName, points, progressCallback, testWithCardName); }
    async executeTestCardFlowOnPage(cookieInfo, cardData, page, options = {}) { return actionHelpers.executeTestCardFlowOnPage.call(this, cookieInfo, cardData, page, options); }
    async runConcurrentTests(cookieInfos, testFunction, progressCallback = null) { return suiteHelpers.runConcurrentTests.call(this, cookieInfos, testFunction, progressCallback); }
    async runSequentialTests(cookieInfos, testFunction, progressCallback = null) { return suiteHelpers.runSequentialTests.call(this, cookieInfos, testFunction, progressCallback); }
    stop() { this.shouldStop = true; }
    resetStopFlag() { this.shouldStop = false; }

    /**
     * 获取卡片数据（使用缓存）
     */
    async getCards() {
        const now = Date.now();
        // 如果缓存过期或不存在，重新加载
        if (!this.cardsCache || (now - this.cardsCacheTime) > this.CACHE_DURATION) {
            this.cardsCache = await this.cardManager.loadCards();
            this.cardsCacheTime = now;
            this.logger.debug(`卡片数据已刷新缓存 (${this.cardsCache.length} 个卡片)`);
        }
        return this.cardsCache;
    }

    /**
     * 获取测试卡片数据（使用缓存）
     */
    async getTestCards() {
        const now = Date.now();
        // 如果缓存过期或不存在，重新加载
        if (!this.testCardsCache || (now - this.testCardsCacheTime) > this.CACHE_DURATION) {
            this.testCardsCache = await this.cardManager.loadTestCards();
            this.testCardsCacheTime = now;
            this.logger.debug(`测试卡片数据已刷新缓存 (${this.testCardsCache.length} 个卡片)`);
        }
        return this.testCardsCache;
    }

    async injectCookies(page, cookies, options = {}) { return actionHelpers.injectCookies.call(this, page, cookies, options); }
    async injectBrowserStorage(page, browserStorage, options = {}) { return actionHelpers.injectBrowserStorage.call(this, page, browserStorage, options); }
    async updateCookieCredits(email, cardName, newCredits, oldCredits, aid = null) { return actionHelpers.updateCookieCredits.call(this, email, cardName, newCredits, oldCredits, aid); }
    async executeTestCardFlow(cookieInfo, cardData) { return actionHelpers.executeTestCardFlow.call(this, cookieInfo, cardData); }
    async executeStep(page, step) { return actionHelpers.executeStep.call(this, page, step); }
    async _performStepAction(page, step, timeout) { return actionHelpers._performStepAction.call(this, page, step, timeout); }
    async _raceFastestNode() { return actionHelpers._raceFastestNode.call(this); }
    async _getCreditsFromPage(page, step) { return actionHelpers._getCreditsFromPage.call(this, page, step); }
    async _tryGetCredits(page, selectors, by, timeout, step) { return actionHelpers._tryGetCredits.call(this, page, selectors, by, timeout, step); }
    _convertSelector(by, selector) { return actionHelpers._convertSelector.call(this, by, selector); }

    /**
     * 更新测试配置
     * @param {Object} config - 测试配置
     * @param {boolean} config.headless - 是否无头模式
     * @param {number} config.concurrentCount - 并发数量
     * @param {string} config.mode - 运行模式 ('sequential' 或 'concurrent')
     */
    updateTestConfig(config) {
        if (config.headless !== undefined) {
            this.testConfig.headless = config.headless;
        }
        if (config.concurrentCount !== undefined) {
            this.testConfig.concurrentCount = Math.max(1, config.concurrentCount);
        }
        if (config.mode !== undefined) {
            this.testConfig.mode = config.mode;
        }
        this.logger.info(`Cookie测试配置已更新: 模式=${this.testConfig.mode}, 并发数=${this.testConfig.concurrentCount}, 无头模式=${this.testConfig.headless}`);
    }

    setBrowserSettings(browserSettings = {}) {
        this.browserSettings = browserSettings && typeof browserSettings === 'object'
            ? { ...browserSettings }
            : {};
    }

    /**
     * 获取当前测试配置
     */
    getTestConfig() {
        return { ...this.testConfig };
    }

    /**
     * 设置Logger实例
     */
    setLogger(logger) {
        this.logger = logger;
    }

    /**
     * 设置主窗口引用
     */
    setMainWindow(mainWindow) {
        this.mainWindow = mainWindow;
    }
}

module.exports = CookieTester;
