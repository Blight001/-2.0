const {
    installLayoutOverride,
    exposeLayoutSave,
    injectLayoutEditor
} = require('../browser/page-layout-overrides');

function _normalizeCookieTaskPart(value) {
    return String(value || '')
        .trim()
        .replace(/[^\w.-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64) || 'cookie';
}

function _buildCookieTaskId(batchTaskId, cookieInfo = {}, index = 0) {
    const emailPart = _normalizeCookieTaskPart(cookieInfo.email || cookieInfo.account || cookieInfo.fileName || cookieInfo.card_name);
    return `${String(batchTaskId || 'cookie-batch').trim()}::${index + 1}-${emailPart}`;
}

function _buildCookieTaskLabel(cookieInfo = {}) {
    return String(cookieInfo.email || cookieInfo.account || cookieInfo.fileName || cookieInfo.card_name || 'Cookie').trim() || 'Cookie';
}

function normalizePreviewUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw)) {
        return raw;
    }

    return `https://${raw}`;
}

async function resolveTesterCardKey(tester) {
    if (typeof tester.cardKeyResolver === 'function') {
        return String(await tester.cardKeyResolver() || '').trim();
    }
    return String(tester.currentCardKey || '').trim();
}

async function prepareLayoutScope(tester, cardData, targetUrl) {
    const cardKey = await resolveTesterCardKey(tester);
    if (!cardKey) {
        return null;
    }

    return {
        resourceRoot: tester.cardManager?.resourceRoot || '',
        cardKey,
        cardName: String(cardData?.name || '').trim(),
        url: targetUrl
    };
}

module.exports = {
    async testAllCookies(progressCallback = null) {
        try {
            this.resetStopFlag();
            this.logger.info('开始刷新Cookie并测试最后一步...');

            const allCookies = await this.cookieManager.listCookies();
            this.logger.info(`找到 ${allCookies.length} 个Cookie文件`);

            if (progressCallback) {
                progressCallback(0, `准备测试 ${allCookies.length} 个Cookie...`);
            }

            const testFunction = async (cookieInfo) => {
                const cards = await this.getCards();
                const cardData = cards.find(card => card.name === cookieInfo.card_name);

                if (!cardData) {
                    return { success: false, message: '未找到卡片配置' };
                }

                return this.executeTestCardFlow(cookieInfo, cardData);
            };

            const result = await this.runConcurrentTests(allCookies, testFunction, progressCallback);
            this.logger.info(`Cookie刷新测试完成 - 成功: ${result.successCount}, 失败: ${result.failCount}`);

            return {
                success: true,
                total: allCookies.length,
                successCount: result.successCount,
                failCount: result.failCount,
                cookiesUpdated: result.successCount > 0
            };
        } catch (error) {
            this.logger.error(`Cookie刷新测试异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    async testSingleCookie(email, testWithCardName, originalCardName = null) {
        try {
            this.logger.info(`开始测试单个Cookie: ${email} (测试卡片: ${testWithCardName})`);

            if (!testWithCardName) {
                return { success: false, error: '请先在左侧选择一个测试卡片' };
            }

            const cookies = await this.cookieManager.listCookies();
            let cookieInfo;
            if (originalCardName) {
                cookieInfo = cookies.find(c =>
                    (c.email === email || c.account === email) &&
                    c.card_name === originalCardName
                );
            } else {
                cookieInfo = cookies.find(c => c.email === email || c.account === email);
            }

            if (!cookieInfo) {
                return { success: false, error: '未找到Cookie信息' };
            }

            const cards = await this.getTestCards();
            const cardData = cards.find(card => card.name === testWithCardName);
            if (!cardData) {
                return { success: false, error: `未找到测试卡片 ${testWithCardName} 的配置` };
            }

            const result = await this.executeTestCardFlow(cookieInfo, cardData);
            if (result && result.success === false) {
                return {
                    success: false,
                    error: result.message || result.error || 'Cookie测试失败',
                    result
                };
            }

            return { success: true, result };
        } catch (error) {
            this.logger.error(`Cookie测试异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    async previewSingleCookie(email, testWithCardName, originalCardName = null) {
        try {
            this.logger.info(`打开单个Cookie预览: ${email} (测试卡片: ${testWithCardName})`);

            if (!testWithCardName) {
                return { success: false, error: '请先在左侧选择一个测试卡片' };
            }

            const cookies = await this.cookieManager.listCookies();
            let cookieInfo;
            if (originalCardName) {
                cookieInfo = cookies.find(c =>
                    (c.email === email || c.account === email) &&
                    c.card_name === originalCardName
                );
            } else {
                cookieInfo = cookies.find(c => c.email === email || c.account === email);
            }

            if (!cookieInfo) {
                return { success: false, error: '未找到Cookie信息' };
            }

            const cards = await this.getTestCards();
            const cardData = cards.find(card => card.name === testWithCardName);
            if (!cardData) {
                return { success: false, error: `未找到测试卡片 ${testWithCardName} 的配置` };
            }

            const targetUrl = normalizePreviewUrl(cardData.website || cardData.url || '');
            if (!targetUrl) {
                return { success: false, error: `测试卡片 ${testWithCardName} 未配置可打开的网站地址` };
            }

            const cookiePayload = typeof this.cookieManager.getCookiePayloadByFile === 'function' && cookieInfo.sourceFilePath
                ? await this.cookieManager.getCookiePayloadByFile(cookieInfo.card_name, cookieInfo.fileName, cookieInfo.sourceFilePath)
                : null;
            const cookiesData = Array.isArray(cookieInfo.cookies) && cookieInfo.cookies.length > 0
                ? cookieInfo.cookies
                : (Array.isArray(cookiePayload?.cookies) && cookiePayload.cookies.length > 0
                    ? cookiePayload.cookies
                    : await this.cookieManager.getCookies(email));
            const browserStorage = Array.isArray(cookiePayload?.browserStorage)
                ? cookiePayload.browserStorage
                : (Array.isArray(cookieInfo.browserStorage) ? cookieInfo.browserStorage : []);
            if ((!Array.isArray(cookiesData) || cookiesData.length === 0) && browserStorage.length === 0) {
                return { success: false, error: '无法获取Cookie或浏览器存储数据' };
            }

            const browserId = await this.browserManager.createBrowser(
                this.browserType,
                false,
                this.browserSettings
            );

            if (!browserId) {
                return { success: false, error: '创建浏览器失败' };
            }

            const page = this.browserManager.getBrowser(browserId);
            if (!page) {
                return { success: false, error: '获取浏览器页面失败' };
            }

            let layoutInstall = { override: null };
            const layoutScope = await prepareLayoutScope(this, cardData, targetUrl);
            if (layoutScope) {
                const browserData = typeof this.browserManager.getBrowserData === 'function'
                    ? this.browserManager.getBrowserData(browserId)
                    : null;
                const context = browserData?.context || (typeof page.context === 'function' ? page.context() : null);
                layoutInstall = await installLayoutOverride(context, layoutScope);
                await exposeLayoutSave(page, layoutScope, this.logger);
            }

            if (Array.isArray(cookiesData) && cookiesData.length > 0) {
                await this.injectCookies(page, cookiesData, { fallbackUrl: targetUrl });
            }
            await this.injectBrowserStorage(page, browserStorage, { fallbackUrl: targetUrl });

            try {
                await page.goto(targetUrl, {
                    timeout: 60000,
                    waitUntil: 'domcontentloaded'
                });
            } catch (navigationError) {
                this.logger.warning(`Cookie预览页面打开失败，浏览器已保留: ${navigationError.message}`);
            }

            if (layoutScope) {
                try {
                    await page.waitForLoadState?.('domcontentloaded', { timeout: 5000 }).catch(() => {});
                    await injectLayoutEditor(page, {
                        cardName: cardData.name || testWithCardName,
                        hasSavedLayout: Array.isArray(layoutInstall?.override?.operations)
                            && layoutInstall.override.operations.length > 0
                    });
                } catch (layoutError) {
                    this.logger.warning(`注入页面布局操作工具失败: ${layoutError.message}`);
                }
            }

            return {
                success: true,
                browserId,
                url: targetUrl,
                message: '浏览器已打开，未执行测试步骤'
            };
        } catch (error) {
            this.logger.error(`Cookie预览异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    async testCookieApiThenModel(email, apiCardName, modelCardName, originalCardName = null) {
        try {
            this.resetStopFlag();

            const normalizedApiCardName = String(apiCardName || '').trim();
            const normalizedModelCardName = String(modelCardName || '').trim();
            const normalizedEmail = String(email || '').trim();
            const normalizedOriginalCardName = String(originalCardName || '').trim();

            this.logger.info(
                `开始API测试: ${normalizedEmail} (API卡片: ${normalizedApiCardName}, 模型卡片: ${normalizedModelCardName})`
            );

            if (!normalizedEmail) {
                return { success: false, error: '账号邮箱不能为空' };
            }
            if (!normalizedApiCardName) {
                return { success: false, error: '请先选择一个API卡片' };
            }
            if (!normalizedModelCardName) {
                return { success: false, error: '请先选择一个模型卡片' };
            }

            const cookies = await this.cookieManager.listCookies();
            const cookieInfo = normalizedOriginalCardName
                ? cookies.find(c =>
                    (c.email === normalizedEmail || c.account === normalizedEmail) &&
                    c.card_name === normalizedOriginalCardName
                )
                : cookies.find(c => c.email === normalizedEmail || c.account === normalizedEmail);

            if (!cookieInfo) {
                return { success: false, error: '未找到Cookie信息' };
            }

            const apiCardData = await this.cardManager.getApiCard(normalizedApiCardName);
            if (!apiCardData) {
                return { success: false, error: `API卡片不存在: ${normalizedApiCardName}` };
            }

            const modelCardData = await this.cardManager.getModelCard(normalizedModelCardName);
            if (!modelCardData) {
                return { success: false, error: `模型卡片不存在: ${normalizedModelCardName}` };
            }

            const modelApiCardName = String(
                modelCardData.api_card_name
                || modelCardData.apiCardName
                || ''
            ).trim();
            if (modelApiCardName && modelApiCardName !== normalizedApiCardName) {
                return {
                    success: false,
                    error: `模型卡片 ${normalizedModelCardName} 不属于 API 卡片 ${normalizedApiCardName}`
                };
            }

            let executionCookieInfo = cookieInfo;
            if (typeof this.cookieManager.getCookiePayloadByFile === 'function' && cookieInfo.sourceFilePath) {
                const payload = await this.cookieManager.getCookiePayloadByFile(
                    cookieInfo.card_name,
                    cookieInfo.fileName,
                    cookieInfo.sourceFilePath
                );
                if (payload && typeof payload === 'object') {
                    executionCookieInfo = {
                        ...cookieInfo,
                        cookies: Array.isArray(payload.cookies) ? payload.cookies : [],
                        browserStorage: Array.isArray(payload.browserStorage) ? payload.browserStorage : []
                    };
                }
            }

            const browserId = await this.browserManager.createBrowser(
                this.browserType,
                this.testConfig.headless,
                this.browserSettings
            );
            if (!browserId) {
                return { success: false, error: '创建浏览器失败' };
            }

            try {
                let page = this.browserManager.getBrowser(browserId);
                if (!page) {
                    return { success: false, error: '获取浏览器页面失败' };
                }

                const apiResult = await this.executeTestCardFlowOnPage(
                    executionCookieInfo,
                    apiCardData,
                    page,
                    {
                        injectCookies: true,
                        injectBrowserStorage: true
                    }
                );
                if (!apiResult || apiResult.success === false) {
                    return {
                        success: false,
                        stage: 'api',
                        error: apiResult?.message || apiResult?.error || 'API卡片测试失败',
                        apiResult
                    };
                }

                const apiCredits = Number.isFinite(Number(apiResult?.credits))
                    ? Number(apiResult.credits)
                    : executionCookieInfo.points;
                const modelExecutionCookieInfo = {
                    ...executionCookieInfo,
                    points: apiCredits
                };

                page = this.browserManager.getBrowser(browserId) || page;
                const modelResult = await this.executeTestCardFlowOnPage(
                    modelExecutionCookieInfo,
                    modelCardData,
                    page,
                    {
                        injectCookies: false,
                        injectBrowserStorage: false
                    }
                );
                if (!modelResult || modelResult.success === false) {
                    return {
                        success: false,
                        stage: 'model',
                        error: modelResult?.message || modelResult?.error || '模型卡片测试失败',
                        apiResult,
                        modelResult
                    };
                }

                return {
                    success: true,
                    apiResult,
                    modelResult,
                    message: `API卡片 ${normalizedApiCardName} 与模型卡片 ${normalizedModelCardName} 测试完成`
                };
            } finally {
                const delay = this.testConfig.headless ? 1000 : 5000;
                await new Promise(resolve => setTimeout(resolve, delay));
                await this.browserManager.closeBrowser(browserId);
            }
        } catch (error) {
            this.logger.error(`API测试异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    async testCookieWithRawData(cookieData, cardName) {
        const cards = await this.getCards();
        const cardData = cards.find(c => c.name === cardName);
        if (!cardData) {
            return { success: false, message: `未找到卡片配置: ${cardName}` };
        }

        const cookieInfo = {
            email: 'temp_test',
            card_name: cardName,
            cookies: Array.isArray(cookieData?.cookies) ? cookieData.cookies : cookieData,
            browserStorage: Array.isArray(cookieData?.browserStorage) ? cookieData.browserStorage : [],
            points: 0
        };

        return this.executeTestCardFlow(cookieInfo, cardData);
    },

    async testCookiesByCard(cardName, progressCallback = null) {
        try {
            this.resetStopFlag();
            this.logger.info(`开始测试卡片 ${cardName} 的Cookie...`);

            const allCookies = await this.cookieManager.listCookies();
            const cardCookies = allCookies.filter(cookie => cookie.card_name === cardName);
            this.logger.info(`找到 ${cardCookies.length} 个 ${cardName} 卡片的Cookie`);

            if (cardCookies.length === 0) {
                if (progressCallback) {
                    progressCallback(0, `未找到 ${cardName} 卡片的Cookie`);
                }
                return {
                    success: true,
                    total: 0,
                    successCount: 0,
                    failCount: 0,
                    message: `未找到 ${cardName} 卡片的Cookie`
                };
            }

            if (progressCallback) {
                progressCallback(0, `准备测试 ${cardName} 的 ${cardCookies.length} 个Cookie...`);
            }

            const cards = await this.getCards();
            const cardData = cards.find(card => card.name === cardName);
            if (!cardData) {
                return { success: false, error: '未找到卡片配置' };
            }

            const testFunction = async (cookieInfo) => this.executeTestCardFlow(cookieInfo, cardData);
            const result = await this.runConcurrentTests(cardCookies, testFunction, progressCallback, {
                batchTaskId: progressCallback?.batchTaskId || null
            });

            this.logger.info(`卡片 ${cardName} Cookie测试完成 - 成功: ${result.successCount}, 失败: ${result.failCount}`);
            return {
                success: true,
                total: cardCookies.length,
                successCount: result.successCount,
                failCount: result.failCount,
                cookiesUpdated: result.successCount > 0
            };
        } catch (error) {
            this.logger.error(`测试卡片Cookie异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    async testCookiesByTestCard(testCard, progressCallback = null, folderName = 'all', filterType = 'all') {
        try {
            this.resetStopFlag();
            const cardName = testCard.name;
            const folderDesc = folderName === 'all' ? '所有文件夹' : `文件夹 ${folderName}`;
            const filterDesc = filterType === 'all' ? '' : ` (筛选: ${filterType})`;
            this.logger.info(`开始使用测试卡片 ${cardName} 测试 ${folderDesc}${filterDesc} 的Cookie...`);

            const allCookies = await this.cookieManager.listCookies();

            let targetCookies = allCookies;
            if (folderName && folderName !== 'all') {
                targetCookies = allCookies.filter(cookie => cookie.card_name === folderName);
            }

            if (filterType && filterType !== 'all') {
                if (filterType === 'points_unknown') {
                    targetCookies = targetCookies.filter(cookie =>
                        cookie.points === null ||
                        cookie.points === undefined ||
                        cookie.points === 'null' ||
                        cookie.points === '' ||
                        isNaN(parseInt(cookie.points, 10))
                    );
                } else if (filterType.startsWith('points_')) {
                    const pointsValue = parseInt(filterType.replace('points_', ''), 10);
                    if (!isNaN(pointsValue)) {
                        targetCookies = targetCookies.filter(cookie => {
                            if (cookie.points === null ||
                                cookie.points === undefined ||
                                cookie.points === 'null' ||
                                cookie.points === '' ||
                                isNaN(parseInt(cookie.points, 10))) {
                                return false;
                            }
                            return parseInt(cookie.points, 10) === pointsValue;
                        });
                    }
                }
            }

            this.logger.info(`找到 ${targetCookies.length} 个Cookie文件待测试`);

            if (targetCookies.length === 0) {
                if (progressCallback) {
                    progressCallback(100, '未找到符合条件的Cookie文件');
                }
                return {
                    success: true,
                    total: 0,
                    successCount: 0,
                    failCount: 0,
                    message: '未找到符合条件的Cookie文件'
                };
            }

            if (progressCallback) {
                progressCallback(0, `准备使用 ${cardName} 测试 ${targetCookies.length} 个Cookie...`);
            }

            const testFunction = async (cookieInfo) => this.executeTestCardFlow(cookieInfo, testCard);
            const result = await this.runConcurrentTests(targetCookies, testFunction, progressCallback, {
                batchTaskId: progressCallback?.batchTaskId || null
            });

            this.logger.info(`测试卡片 ${cardName} 测试完成 - 成功: ${result.successCount}, 失败: ${result.failCount}`);
            return {
                success: true,
                total: targetCookies.length,
                successCount: result.successCount,
                failCount: result.failCount,
                cookiesUpdated: result.successCount > 0
            };
        } catch (error) {
            this.logger.error(`测试卡片 ${testCard.name} 测试异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    async testCookiesByPoints(cardName, points, progressCallback = null, testWithCardName = null) {
        try {
            this.resetStopFlag();
            const cardDesc = cardName === 'overview' ? '所有卡片' : `卡片 ${cardName}`;
            const isUnknownPoints = points === 'unknown';
            const pointsDisplay = isUnknownPoints ? '未知' : points;
            this.logger.info(`开始测试${cardDesc}中积分 ${pointsDisplay} 的Cookie...`);

            const allCookies = await this.cookieManager.listCookies();
            let targetCookies;
            if (cardName === 'overview') {
                targetCookies = allCookies.filter(cookie => {
                    if (isUnknownPoints) {
                        return cookie.points === null || cookie.points === undefined ||
                               cookie.points === 'null' || cookie.points === '' ||
                               isNaN(parseInt(cookie.points, 10));
                    }

                    if (cookie.points === null || cookie.points === undefined ||
                        cookie.points === 'null' || cookie.points === '' ||
                        isNaN(parseInt(cookie.points, 10))) {
                        return false;
                    }
                    return parseInt(cookie.points, 10) === parseInt(points, 10);
                });
            } else {
                targetCookies = allCookies.filter(cookie => {
                    if (cookie.card_name !== cardName) return false;
                    if (isUnknownPoints) {
                        return cookie.points === null || cookie.points === undefined ||
                               cookie.points === 'null' || cookie.points === '' ||
                               isNaN(parseInt(cookie.points, 10));
                    }

                    if (cookie.points === null || cookie.points === undefined ||
                        cookie.points === 'null' || cookie.points === '' ||
                        isNaN(parseInt(cookie.points, 10))) {
                        return false;
                    }
                    return parseInt(cookie.points, 10) === parseInt(points, 10);
                });
            }

            this.logger.info(`找到 ${targetCookies.length} 个${cardDesc}中积分 ${points} 的Cookie`);

            if (targetCookies.length === 0) {
                if (progressCallback) {
                    progressCallback(0, `未找到${cardDesc}中积分 ${points} 的Cookie`);
                }
                return {
                    success: true,
                    total: 0,
                    successCount: 0,
                    failCount: 0,
                    message: `未找到${cardDesc}中积分 ${points} 的Cookie`
                };
            }

            if (progressCallback) {
                progressCallback(0, `准备测试${cardDesc}中积分 ${points} 的 ${targetCookies.length} 个Cookie...`);
            }

            const testFunction = async (cookieInfo) => {
                const cards = await this.getCards();
                const targetCardName = testWithCardName || cookieInfo.card_name;
                let cardData = cards.find(card => card.name === targetCardName);
                if (!cardData) {
                    const testCards = await this.getTestCards();
                    cardData = testCards.find(card => card.name === targetCardName);
                }

                if (!cardData) {
                    return { success: false, message: `未找到卡片配置: ${targetCardName}` };
                }
                return this.executeTestCardFlow(cookieInfo, cardData);
            };

            const result = await this.runConcurrentTests(targetCookies, testFunction, progressCallback, {
                batchTaskId: progressCallback?.batchTaskId || null
            });
            const total = result.successCount + result.failCount;
            this.logger.info(`积分 ${points} Cookie测试完成 - 总计: ${total}, 成功: ${result.successCount}, 失败: ${result.failCount}`);

            return {
                success: true,
                total,
                successCount: result.successCount,
                failCount: result.failCount,
                message: `积分 ${points} Cookie测试完成`
            };
        } catch (error) {
            this.logger.error(`积分 ${points} Cookie测试异常: ${error.message}`);
            return {
                success: false,
                total: 0,
                successCount: 0,
                failCount: 0,
                error: error.message
            };
        }
    },

    async runConcurrentTests(cookieInfos, testFunction, progressCallback = null, options = {}) {
        const { concurrentCount, mode } = this.testConfig;
        const batchTaskId = String(options.batchTaskId || '').trim();

        if (mode === 'sequential' || concurrentCount === 1) {
            return this.runSequentialTests(cookieInfos, testFunction, progressCallback, { batchTaskId });
        }

        let completedCount = 0;
        let successCount = 0;
        let failCount = 0;
        const runningPromises = new Set();

        this.logger.info(`开始并发Cookie测试 - 并发数: ${concurrentCount}, 总任务数: ${cookieInfos.length}`);

        return new Promise((resolve) => {
            let currentIndex = 0;

            const startNextTest = () => {
                if (currentIndex >= cookieInfos.length || this.shouldStop) {
                    return;
                }

                const index = currentIndex++;
                const cookieInfo = cookieInfos[index];

                const childTaskId = _buildCookieTaskId(batchTaskId || 'cookie-batch', cookieInfo, index);
                const taskLabel = _buildCookieTaskLabel(cookieInfo);
                const taskNumber = `${index + 1}/${cookieInfos.length}`;

                if (progressCallback) {
                    progressCallback(0, `准备测试 ${taskLabel}`, {
                        phase: 'started',
                        taskId: childTaskId,
                        taskLabel,
                        taskNumber,
                        taskType: 'cookie-test',
                        cookieInfo,
                        index,
                        total: cookieInfos.length,
                        batchTaskId
                    });
                }

                const testPromise = testFunction(cookieInfo, index)
                    .then(result => {
                        completedCount++;
                        if (result.success) {
                            successCount++;
                        } else {
                            failCount++;
                        }

                        if (progressCallback) {
                            const progress = Math.round((completedCount / cookieInfos.length) * 100);
                            progressCallback(progress, result.success
                                ? `测试成功 ${taskLabel}`
                                : `测试失败 ${taskLabel}: ${result.message || result.error || '未知错误'}`, {
                                phase: 'finished',
                                taskId: childTaskId,
                                taskLabel,
                                taskNumber,
                                taskType: 'cookie-test',
                                success: result.success !== false,
                                error: result.message || result.error || '',
                                cookieInfo,
                                index,
                                total: cookieInfos.length,
                                batchTaskId
                            });
                        }

                        runningPromises.delete(testPromise);
                        startNextTest();
                    })
                    .catch(error => {
                        completedCount++;
                        failCount++;
                        this.logger.error(`Cookie测试异常: ${cookieInfo.email} - ${error.message}`);

                        if (progressCallback) {
                            const progress = Math.round((completedCount / cookieInfos.length) * 100);
                            progressCallback(progress, `测试失败 ${taskLabel}: ${error.message}`, {
                                phase: 'finished',
                                taskId: childTaskId,
                                taskLabel,
                                taskNumber,
                                taskType: 'cookie-test',
                                success: false,
                                error: error.message,
                                cookieInfo,
                                index,
                                total: cookieInfos.length,
                                batchTaskId
                            });
                        }

                        runningPromises.delete(testPromise);
                        startNextTest();
                    });

                runningPromises.add(testPromise);
            };

            for (let i = 0; i < Math.min(concurrentCount, cookieInfos.length); i++) {
                startNextTest();
            }

            const checkCompletion = () => {
                if (completedCount >= cookieInfos.length) {
                    resolve({
                        success: true,
                        total: cookieInfos.length,
                        successCount,
                        failCount
                    });
                } else if (runningPromises.size === 0 && currentIndex >= cookieInfos.length) {
                    resolve({
                        success: true,
                        total: cookieInfos.length,
                        successCount,
                        failCount
                    });
                } else {
                    setTimeout(checkCompletion, 100);
                }
            };

            checkCompletion();
        });
    },

    async runSequentialTests(cookieInfos, testFunction, progressCallback = null, options = {}) {
        let successCount = 0;
        let failCount = 0;
        const batchTaskId = String(options.batchTaskId || '').trim();

        this.logger.info(`开始顺序Cookie测试 - 总任务数: ${cookieInfos.length}`);

        for (let index = 0; index < cookieInfos.length; index++) {
            if (this.shouldStop) {
                this.logger.info('Cookie测试已被用户停止');
                break;
            }

            const cookieInfo = cookieInfos[index];
            const childTaskId = _buildCookieTaskId(batchTaskId || 'cookie-batch', cookieInfo, index);
            const taskLabel = _buildCookieTaskLabel(cookieInfo);
            const taskNumber = `${index + 1}/${cookieInfos.length}`;

            if (progressCallback) {
                progressCallback(0, `准备测试 ${taskLabel}`, {
                    phase: 'started',
                    taskId: childTaskId,
                    taskLabel,
                    taskNumber,
                    taskType: 'cookie-test',
                    cookieInfo,
                    index,
                    total: cookieInfos.length,
                    batchTaskId
                });
            }

            try {
                const result = await testFunction(cookieInfo, index);
                if (result.success) {
                    successCount++;
                } else {
                    failCount++;
                }

                if (progressCallback) {
                    const progress = Math.round(((index + 1) / cookieInfos.length) * 100);
                    progressCallback(progress, result.success
                        ? `测试成功 ${taskLabel}`
                        : `测试失败 ${taskLabel}: ${result.message || result.error || '未知错误'}`, {
                        phase: 'finished',
                        taskId: childTaskId,
                        taskLabel,
                        taskNumber,
                        taskType: 'cookie-test',
                        success: result.success !== false,
                        error: result.message || result.error || '',
                        cookieInfo,
                        index,
                        total: cookieInfos.length,
                        batchTaskId
                    });
                }
            } catch (error) {
                failCount++;
                this.logger.error(`Cookie测试异常: ${cookieInfo.email} - ${error.message}`);

                if (progressCallback) {
                    const progress = Math.round(((index + 1) / cookieInfos.length) * 100);
                    progressCallback(progress, `测试失败 ${taskLabel}: ${error.message}`, {
                        phase: 'finished',
                        taskId: childTaskId,
                        taskLabel,
                        taskNumber,
                        taskType: 'cookie-test',
                        success: false,
                        error: error.message,
                        cookieInfo,
                        index,
                        total: cookieInfos.length,
                        batchTaskId
                    });
                }
            }
        }

        return {
            success: true,
            total: cookieInfos.length,
            successCount,
            failCount
        };
    }
};
