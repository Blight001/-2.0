const ExecutionThread = require('../execution-thread');
const { normalizeHaikaExpiryDateValue } = require('./main-runtime-utils');

module.exports = {
    async startHaikaBindingTask(config = {}) {
        try {
            if (this.haikaBindingState && (
                this.haikaBindingState.active ||
                this.haikaBindingState.runningCount > 0 ||
                this.haikaBindingState.queue.length > 0
            )) {
                return { success: false, error: '海卡绑定任务正在运行中' };
            }

            const cardName = config.cardName || this.currentHaikaBindCard;
            if (!cardName) {
                return { success: false, error: '请先选择一个海卡绑定卡片' };
            }

            const cardConfig = await this.cardManager.getHaikaBindCard(cardName);
            if (!cardConfig) {
                return { success: false, error: `无法获取海卡绑定卡片配置: ${cardName}` };
            }
            this.currentHaikaBindCard = cardName;

            const initialSmsCode = String(
                config.smsCode
                || config.sms_code
                || config.bindingContent?.smsCode
                || config.bindingContent?.sms_code
                || ''
            ).trim();
            const bindingContent = {
                ...(config.bindingContent || {}),
                ...(config.contextVariables || {})
            };
            bindingContent.sms_code = initialSmsCode || String(bindingContent.sms_code || bindingContent.smsCode || '').trim();
            bindingContent.smsCode = bindingContent.sms_code;
            const browserSettings = {
                ...(this.browserSettings && typeof this.browserSettings === 'object' ? this.browserSettings : {}),
                ...((config.browserSettings || config.browser_settings) && typeof (config.browserSettings || config.browser_settings) === 'object'
                    ? (config.browserSettings || config.browser_settings)
                    : {})
            };
            const browserType = String(
                config.browserType
                || browserSettings.browser_type
                || browserSettings.browserType
                || this.currentBrowserType
                || 'electron'
            ).trim() || 'electron';
            browserSettings.browser_type = browserType;
            browserSettings.browserType = browserType;
            browserSettings.headless = config.headless !== undefined
                ? config.headless
                : (browserSettings.headless !== undefined ? browserSettings.headless : false);

            const allCookies = await this.cookieManager.listCookies();
            let accountFolder = config.accountFolder || 'all';
            let accountFilter = config.accountFilter || 'all';
            let selectedAccounts = [];
            let concurrentCount = Math.max(1, parseInt(config.concurrentCount, 10) || 1);

            if (config.singleAccount) {
                const singleAccount = this.normalizeHaikaBindingAccount(config.singleAccount);
                if (!singleAccount) {
                    return { success: false, error: '单独绑卡账号信息无效' };
                }

                selectedAccounts = [singleAccount];
                accountFolder = singleAccount.card_name || accountFolder;
                accountFilter = `single:${singleAccount.aid || singleAccount.email || singleAccount.fileName || 'account'}`;
                concurrentCount = 1;
            } else {
                selectedAccounts = this.filterHaikaBindingAccounts(allCookies, accountFolder, accountFilter);
            }

            const batchId = `haika_bind_batch_${Date.now()}`;
            this.haikaBindingState = {
                active: true,
                stopRequested: false,
                batchId,
                cardName,
                cardConfig,
                bindingContent,
                browserType,
                browserSettings,
                accountFolder,
                accountFilter,
                concurrentCount,
                queue: [...selectedAccounts],
                runningCount: 0,
                total: selectedAccounts.length,
                completedCount: 0,
                successCount: 0,
                failCount: 0,
                nextTaskIndex: 0
            };

            if (this.mainWindow) {
                this.mainWindow.webContents.send('haika-binding-batch-started', {
                    batchId,
                    total: selectedAccounts.length,
                    concurrentCount,
                    cardName,
                    accountFolder,
                    accountFilter,
                    progress: 0,
                    message: '准备开始海卡绑定'
                });
            }

            if (selectedAccounts.length === 0) {
                this.logger.info(`海卡绑定没有找到符合条件的账号: 文件夹=${accountFolder}, 筛选=${accountFilter}`);
                await this.finishHaikaBindingBatch();
                return {
                    success: true,
                    batchId,
                    total: 0,
                    started: 0,
                    message: '未找到符合条件的账号'
                };
            }

            this.logger.info(`开始海卡绑定${config.singleAccount ? '单独任务' : '批量任务'} - 卡片: ${cardName}, 账号数: ${selectedAccounts.length}, 并发数: ${concurrentCount}, 文件夹: ${accountFolder}, 筛选: ${accountFilter}`);

            const startCount = Math.min(concurrentCount, selectedAccounts.length);
            for (let i = 0; i < startCount; i++) {
                await this.startNextHaikaBindingTask();
            }

            await this.updateStats();
            return {
                success: true,
                batchId,
                total: selectedAccounts.length,
                started: startCount,
                message: `海卡绑定批量任务已启动，共 ${selectedAccounts.length} 个账号`
            };
        } catch (error) {
            this.logger.error(`开始海卡绑定失败: ${error.message}`);
            if (this.haikaBindingState && this.haikaBindingState.runningCount === 0 && this.haikaBindingState.queue.length === 0) {
                try {
                    await this.finishHaikaBindingBatch();
                } catch (cleanupError) {
                    this.logger.warning(`清理海卡绑定状态失败: ${cleanupError.message}`);
                }
            }
            return { success: false, error: error.message };
        }
    },

    filterHaikaBindingAccounts(allCookies, accountFolder = 'all', accountFilter = 'all') {
        let targetCookies = Array.isArray(allCookies) ? [...allCookies] : [];

        if (accountFolder && accountFolder !== 'all') {
            targetCookies = targetCookies.filter(cookie => cookie.card_name === accountFolder);
        }

        if (accountFilter && accountFilter !== 'all') {
            if (accountFilter === 'points_unknown') {
                targetCookies = targetCookies.filter(cookie =>
                    cookie.points === null ||
                    cookie.points === undefined ||
                    cookie.points === 'null' ||
                    cookie.points === '' ||
                    isNaN(parseInt(cookie.points, 10))
                );
            } else if (accountFilter.startsWith('points_')) {
                const pointsValue = parseInt(accountFilter.replace('points_', ''), 10);
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

        return targetCookies;
    },

    normalizeHaikaBindingAccount(accountInfo = {}) {
        if (!accountInfo || typeof accountInfo !== 'object') {
            return null;
        }

        const fileName = accountInfo.fileName || accountInfo.name || accountInfo.cookieFileName || '';
        if (!fileName) {
            return null;
        }

        const cardName = accountInfo.card_name || accountInfo.cardName || accountInfo.folder || '';

        return {
            ...accountInfo,
            aid: accountInfo.aid || accountInfo.id || '',
            email: accountInfo.email || accountInfo.account || '',
            account: accountInfo.account || accountInfo.email || accountInfo.aid || '',
            points: accountInfo.points,
            card_name: cardName,
            sourceCardName: accountInfo.sourceCardName || accountInfo.card_name || accountInfo.cardName || accountInfo.folder || cardName,
            sourceFilePath: accountInfo.sourceFilePath || accountInfo.filePath || '',
            fileName,
            name: accountInfo.name || fileName
        };
    },

    normalizeHaikaExpiryDate(expiryDate = '') {
        return normalizeHaikaExpiryDateValue(expiryDate);
    },

    extractHaikaBindingResponse(result = {}) {
        const response = result?.result || result?.response || result?.data || result || null;
        if (!response || typeof response !== 'object') {
            return null;
        }

        if (response.card && response.content) {
            return response;
        }

        if (response.result && response.result.card && response.result.content) {
            return response.result;
        }

        if (response.data && response.data.card && response.data.content) {
            return response.data;
        }

        return null;
    },

    async exchangeNextHaikaBindingCard(currentContext = {}, options = {}) {
        const previousLock = this._haikaBindingKeySwitchLock || Promise.resolve();
        let releaseLock = null;
        this._haikaBindingKeySwitchLock = new Promise(resolve => {
            releaseLock = resolve;
        });

        await previousLock.catch(() => {});

        try {
            const context = currentContext && typeof currentContext === 'object' ? currentContext : {};
            const normalizeText = (value) => String(value || '').trim();
            const requestedCategoryName = normalizeText(
                options.categoryName
                || context.haika_category
                || context.haikaCategory
                || '默认分类'
            ) || '默认分类';
            const stateBindingContent = this.haikaBindingState?.bindingContent && typeof this.haikaBindingState.bindingContent === 'object'
                ? this.haikaBindingState.bindingContent
                : null;
            const stateCategoryName = normalizeText(
                stateBindingContent?.haika_category
                || stateBindingContent?.haikaCategory
            );
            const categoryName = stateCategoryName || requestedCategoryName;
            let currentKey = normalizeText(
                options.currentKey
                || context.haika_key
                || context.haikaKey
            );
            let configuredIndex = parseInt(
                options.currentIndex
                ?? context.haika_key_index
                ?? context.haikaKeyIndex,
                10
            );

            if (stateBindingContent && (!stateCategoryName || stateCategoryName === categoryName)) {
                const globalKey = normalizeText(stateBindingContent.haika_key || stateBindingContent.haikaKey);
                const globalIndex = parseInt(
                    stateBindingContent.haika_key_index
                    ?? stateBindingContent.haikaKeyIndex,
                    10
                );

                if (globalKey) {
                    currentKey = globalKey;
                }
                if (Number.isFinite(globalIndex) && globalIndex > 0) {
                    configuredIndex = globalIndex;
                }
            }

            if (!currentKey) {
                try {
                    const latestState = typeof this.loadHaikaLatestState === 'function'
                        ? await this.loadHaikaLatestState({})
                        : null;
                    currentKey = normalizeText(latestState?.latestExchange?.key);
                } catch (_error) {}
            }

            if (!currentKey) {
                return { success: false, error: '缺少当前海卡卡密，无法切换到下一张' };
            }

            const haikaManager = await this.ensureHaikaManager();
            const keys = await haikaManager.loadCategoryKeys(categoryName);
            if (!Array.isArray(keys) || keys.length === 0) {
                return { success: false, error: `海卡分类 ${categoryName} 下没有可用卡密` };
            }

            let currentIndex = keys.findIndex(item => normalizeText(item?.key) === currentKey);
            if (currentIndex < 0 && Number.isFinite(configuredIndex) && configuredIndex > 0) {
                currentIndex = configuredIndex - 1;
            }

            if (currentIndex < 0) {
                return { success: false, error: `未在分类 ${categoryName} 中找到当前海卡卡密，无法切换下一张` };
            }

            const nextEntry = keys[currentIndex + 1];
            if (!nextEntry || !normalizeText(nextEntry.key)) {
                return { success: false, error: `海卡分类 ${categoryName} 已经没有下一张卡密可用` };
            }

            this.logger.info(`海卡绑定准备切换到下一张卡密: 分类=${categoryName}, 序号=${nextEntry.index}`);
            const exchangeResult = await this.licenseManager.exchangeHaikaKey(nextEntry.key);
            if (!exchangeResult || !exchangeResult.success) {
                return {
                    success: false,
                    error: exchangeResult?.error || `兑换下一张海卡失败: 序号 ${nextEntry.index}`
                };
            }

            if (typeof this.saveHaikaLatestExchange === 'function') {
                await this.saveHaikaLatestExchange({
                    key: nextEntry.key,
                    response: exchangeResult,
                    savedAt: new Date().toISOString(),
                    source: 'haika-binding-next-key'
                });
            }

            const binding = this.extractHaikaBindingResponse(exchangeResult);
            if (!binding || !binding.content || typeof binding.content !== 'object') {
                return { success: false, error: `海卡兑换成功，但未返回可用的绑定信息: 序号 ${nextEntry.index}` };
            }

            if (this.haikaBindingState && this.haikaBindingState.bindingContent) {
                this.haikaBindingState.bindingContent = {
                    ...this.haikaBindingState.bindingContent,
                    ...binding.content,
                    haika_key: nextEntry.key,
                    haikaKey: nextEntry.key,
                    haika_key_index: nextEntry.index,
                    haikaKeyIndex: nextEntry.index,
                    haika_category: categoryName,
                    haikaCategory: categoryName
                };
            }

            return {
                success: true,
                key: nextEntry.key,
                index: nextEntry.index,
                categoryName,
                binding,
                bindingContent: binding.content
            };
        } finally {
            if (typeof releaseLock === 'function') {
                releaseLock();
            }
        }
    },

    buildHaikaBindingContext(bindingContent = {}, accountInfo = {}, smsCode = '') {
        const mergedAccount = {
            ...accountInfo,
            email: accountInfo.email || accountInfo.account || '',
            password: accountInfo.password || '',
            account: accountInfo.email || accountInfo.account || accountInfo.aid || '',
            account_type: accountInfo.card_name || '',
            account_folder: accountInfo.card_name || '',
            points: accountInfo.points,
            aid: accountInfo.aid || '',
            file_name: accountInfo.fileName || '',
            created_at: accountInfo.createdAt || ''
        };

        return {
            ...bindingContent,
            ...mergedAccount,
            card_number: bindingContent.card_number || '',
            expiry_date: normalizeHaikaExpiryDateValue(bindingContent.expiry_date || ''),
            cvv: bindingContent.cvv || '',
            name: bindingContent.name || '',
            phone: bindingContent.phone || '',
            address: bindingContent.address || '',
            sms_code: smsCode || bindingContent.sms_code || bindingContent.smsCode || '',
            smsCode: smsCode || bindingContent.smsCode || bindingContent.sms_code || '',
            haika_key: bindingContent.haika_key || bindingContent.haikaKey || '',
            haikaKey: bindingContent.haikaKey || bindingContent.haika_key || '',
            haika_key_index: bindingContent.haika_key_index || bindingContent.haikaKeyIndex || '',
            haikaKeyIndex: bindingContent.haikaKeyIndex || bindingContent.haika_key_index || '',
            haika_category: bindingContent.haika_category || bindingContent.haikaCategory || '',
            haikaCategory: bindingContent.haikaCategory || bindingContent.haika_category || '',
            email: mergedAccount.email || bindingContent.email || '',
            password: mergedAccount.password || bindingContent.password || '',
            account: mergedAccount.account || bindingContent.account || ''
        };
    },

    async startNextHaikaBindingTask() {
        const state = this.haikaBindingState;
        if (!state || !state.active || state.stopRequested) {
            return false;
        }

        if (state.runningCount >= state.concurrentCount) {
            return true;
        }

        const accountInfo = state.queue.shift();
        if (!accountInfo) {
            return false;
        }

        const taskIndex = state.nextTaskIndex++;
        const taskId = `haika_bind_${Date.now()}_${taskIndex}`;
        const contextVariables = this.buildHaikaBindingContext(
            state.bindingContent,
            accountInfo,
            state.bindingContent?.sms_code || state.bindingContent?.smsCode || ''
        );
        const initialCookies = await this.cookieManager.getCookieDataByFile(
            accountInfo.sourceCardName || accountInfo.card_name,
            accountInfo.fileName,
            accountInfo.sourceFilePath
        );
        if (initialCookies.length > 0) {
            this.logger.info(`准备注入海卡绑定Cookie: ${(accountInfo.sourceCardName || accountInfo.card_name)}/${accountInfo.fileName} (${initialCookies.length} 条)`);
        } else {
            this.logger.warning(`未找到可注入的Cookie: ${(accountInfo.sourceCardName || accountInfo.card_name)}/${accountInfo.fileName}`);
        }

        const task = new ExecutionThread(taskId, state.cardConfig, {
            app: this,
            browserManager: this.browserManager,
            cookieManager: this.cookieManager,
            logger: this.logger,
            emailClient: this.emailClient,
            browserType: state.browserType,
            browserSettings: state.browserSettings,
            clashManager: this.clashManager,
            skipCookieSave: true,
            contextVariables,
            initialCookies,
            emailSuffix: this.getEmailSuffix ? this.getEmailSuffix() : '',
            emailRandomConfig: this.getEmailRandomConfig ? this.getEmailRandomConfig() : this.emailRandomConfig || {},
            applyCardKeyPrefix: false
        });

        task.credentials.email = accountInfo.email || accountInfo.account || task.credentials.email || '';
        task.credentials.password = accountInfo.password || task.credentials.password || '';
        task.generatedAccount = accountInfo.email || accountInfo.account || accountInfo.aid || '';

        task.on('progress', (progress, message) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('task-progress', { taskId, progress, message, taskType: 'haika-binding' });
            }
        });

        task.on('finished', async (result) => {
            await this.onHaikaBindingFinished(taskId, result, accountInfo);
        });

        task.on('error', (error) => {
            this.onHaikaBindingError(taskId, error, accountInfo);
        });

        task.on('browser-created', (browserId) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('browser-created', { taskId, browserId, taskType: 'haika-binding' });
            }
        });

        state.runningCount += 1;
        this.runningTasks.set(taskId, task);

        try {
            task.start();
        } catch (error) {
            this.logger.error(`启动海卡绑定任务失败: ${error.message}`);
            this.onHaikaBindingError(taskId, error, accountInfo);
            return false;
        }

        if (this.mainWindow) {
            this.mainWindow.webContents.send('task-started', {
                taskId,
                taskNumber: `${Math.max(1, state.completedCount + state.runningCount)}/${state.total}`,
                taskType: 'haika-binding',
                batchId: state.batchId,
                parentTaskId: state.batchId,
                parentTaskLabel: '海卡绑定批次',
                taskLabel: accountInfo.email || accountInfo.account || accountInfo.aid || '海卡绑定任务'
            });
        }

        this.logger.info(`开始海卡绑定任务: ${taskId} (卡片: ${state.cardName}, 账号: ${accountInfo.email || accountInfo.account || accountInfo.aid || '未知'})`);
        return true;
    },

    async finishHaikaBindingBatch() {
        const state = this.haikaBindingState;
        if (!state) {
            this.haikaBindingState = null;
            return;
        }

        if (state.runningCount > 0 || state.queue.length > 0) {
            return;
        }

        state.active = false;

        const summary = {
            batchId: state.batchId,
            cardName: state.cardName,
            total: state.total,
            successCount: state.successCount,
            failCount: state.failCount,
            stopped: !!state.stopRequested
        };

        this.logger.info(`海卡绑定批量完成 - 总计: ${summary.total}, 成功: ${summary.successCount}, 失败: ${summary.failCount}`);

        if (this.mainWindow) {
            this.mainWindow.webContents.send('haika-binding-batch-finished', summary);
        }

        this.haikaBindingState = null;
        await this.updateStats();
    },

    emitHaikaBindingProgress() {
        const state = this.haikaBindingState;
        if (!state || !this.mainWindow) {
            return;
        }

        const total = state.total || 0;
        const completed = Math.min(state.completedCount || 0, total);
        const progress = total > 0 ? Math.round((completed / total) * 100) : 100;
        const message = total > 0
            ? `已完成 ${completed}/${total} 个账号 (成功: ${state.successCount}, 失败: ${state.failCount})`
            : '未找到符合条件的账号';

        this.mainWindow.webContents.send('haika-binding-batch-progress', {
            batchId: state.batchId,
            progress,
            message,
            total,
            completed,
            successCount: state.successCount,
            failCount: state.failCount,
            runningCount: state.runningCount
        });
    },

    async stopHaikaBinding() {
        const state = this.haikaBindingState;
        if (!state) {
            return { success: false, error: '当前没有正在运行的海卡绑定任务' };
        }

        state.stopRequested = true;
        state.active = false;
        state.queue = [];

        const closePromises = [];
        for (const [taskId, task] of this.runningTasks) {
            if (taskId && String(taskId).startsWith('haika_bind_')) {
                try {
                    task.stop('海卡绑定任务已停止');
                    if (task.browserId) {
                        closePromises.push(
                            this.browserManager.closeBrowser(task.browserId).catch(error => {
                                this.logger.warning(`关闭海卡绑定浏览器失败: ${taskId} - ${error.message}`);
                            })
                        );
                    }
                } catch (error) {
                    this.logger.warning(`停止海卡绑定任务失败: ${taskId} - ${error.message}`);
                }
            }
        }

        if (closePromises.length > 0) {
            await Promise.allSettled(closePromises);
        }

        this.logger.info('海卡绑定停止请求已发送');
        this.emitHaikaBindingProgress();
        if (state.runningCount === 0 && state.queue.length === 0) {
            await this.finishHaikaBindingBatch();
        }
        return { success: true };
    },

    async onHaikaBindingFinished(taskId, result, accountInfo = null) {
        const state = this.haikaBindingState;
        const browserClosed = result?.browserClosed === true
            || /浏览器.*任务已终止|浏览器实例已(?:关闭|断开)|浏览器页面已关闭/i.test(this.getErrorText(result?.error || ''));
        if (this.runningTasks.has(taskId)) {
            this.runningTasks.delete(taskId);
        }

        if (this.mainWindow) {
            this.mainWindow.webContents.send('task-finished', { taskId });
        }

        if (result && result.success) {
            this.logger.info(`海卡绑定任务 ${taskId} 成功完成`);
            if (state) {
                state.successCount += 1;
                state.completedCount += 1;
            }

            const resolvedEmail = (accountInfo && (accountInfo.email || accountInfo.account || accountInfo.aid))
                || result.email
                || '';
            const resolvedCardName = (accountInfo && (accountInfo.card_name || accountInfo.cardName))
                || state?.cardName
                || '';
            const previousCreditsValue = Number.parseInt(accountInfo?.points, 10);
            const hasPreviousCredits = Number.isFinite(previousCreditsValue);
            const previousCredits = hasPreviousCredits ? previousCreditsValue : Number.parseInt(result.points, 10);
            const newCreditsValue = Number.parseInt(result?.points, 10);

            if (resolvedEmail && resolvedCardName && Number.isFinite(newCreditsValue)) {
                try {
                    let updateSuccess = false;
                    if (accountInfo?.sourceFilePath && typeof this.cookieManager.updateCookiePointsBySource === 'function') {
                        updateSuccess = await this.cookieManager.updateCookiePointsBySource(
                            accountInfo.sourceCardName || resolvedCardName,
                            accountInfo.sourceFilePath,
                            newCreditsValue
                        );
                    } else if (accountInfo?.fileName && typeof this.cookieManager.updateCookiePointsByFile === 'function') {
                        updateSuccess = await this.cookieManager.updateCookiePointsByFile(
                            resolvedCardName,
                            accountInfo.fileName,
                            newCreditsValue
                        );
                    }

                    if (!updateSuccess && typeof this.cookieManager.updateCookiePoints === 'function') {
                        updateSuccess = await this.cookieManager.updateCookiePoints(
                            resolvedEmail,
                            resolvedCardName,
                            newCreditsValue
                        );
                    }

                    if (!updateSuccess && typeof this.cookieManager.updateLatestCookiePoints === 'function') {
                        updateSuccess = await this.cookieManager.updateLatestCookiePoints(
                            resolvedCardName,
                            newCreditsValue
                        );
                    }

                    if (updateSuccess) {
                        if (accountInfo) {
                            accountInfo.points = newCreditsValue;
                        }

                        const change = Number.isFinite(previousCredits) ? (newCreditsValue - previousCredits) : 0;
                        const changeText = change > 0
                            ? `(+${change})`
                            : change < 0
                                ? `(${change})`
                                : '(无变化)';

                        this.logger.info(`海卡绑定积分已同步回写: ${resolvedEmail} (${previousCredits ?? 'unknown'} -> ${newCreditsValue})`);

                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('cookie-credits-changed', {
                                email: resolvedEmail,
                                cardName: resolvedCardName,
                                oldCredits: Number.isFinite(previousCredits) ? previousCredits : newCreditsValue,
                                newCredits: newCreditsValue,
                                change,
                                changeText,
                                aid: accountInfo?.aid || null
                            });
                            this.mainWindow.webContents.send('cookies-refreshed', {
                                success: true,
                                source: 'haika-binding',
                                email: resolvedEmail,
                                cardName: resolvedCardName,
                                newCredits: newCreditsValue
                            });
                        }
                    } else {
                        this.logger.warning(`海卡绑定积分回写失败: ${resolvedEmail} (${resolvedCardName})`);
                    }
                } catch (syncError) {
                    this.logger.warning(`海卡绑定积分回写异常: ${syncError.message}`);
                }
            } else {
                this.logger.warning(`海卡绑定成功但缺少回写积分所需信息: email=${resolvedEmail || 'unknown'}, card=${resolvedCardName || 'unknown'}, points=${result?.points ?? 'unknown'}`);
            }

            if (this.mainWindow && !(state && state.stopRequested)) {
                this.mainWindow.webContents.send('haika-binding-success', {
                    taskId,
                    result
                });
            }
        } else {
            const errorText = result?.error || result?.message || '海卡绑定失败';
            this.logger.error(`海卡绑定任务 ${taskId} 失败: ${errorText}`);
            if (state) {
                state.failCount += 1;
                state.completedCount += 1;
                if (browserClosed) {
                    state.active = false;
                    state.stopRequested = true;
                    state.queue = [];
                    this.logger.warning('检测到浏览器关闭，海卡绑定批次已停止继续派发任务');
                }
            }
            if (this.mainWindow && !(state && state.stopRequested)) {
                this.mainWindow.webContents.send('haika-binding-error', {
                    taskId,
                    error: errorText
                });
            }
        }

        if (state) {
            state.runningCount = Math.max(0, state.runningCount - 1);
            this.emitHaikaBindingProgress();
            if (state.active && !state.stopRequested) {
                await this.startNextHaikaBindingTask();
            }
            if (state.runningCount === 0 && state.queue.length === 0) {
                await this.finishHaikaBindingBatch();
                return;
            }
        }

        await this.updateStats();
    },

    onHaikaBindingError(taskId, error, accountInfo = null) {
        const state = this.haikaBindingState;
        const errorText = this.getErrorText(error);
        const browserClosed = /浏览器.*任务已终止|浏览器实例已(?:关闭|断开)|浏览器页面已关闭/i.test(errorText);
        this.logger.error(`海卡绑定任务 ${taskId} 错误: ${errorText}`);

        if (this.runningTasks.has(taskId)) {
            this.runningTasks.delete(taskId);
        }

        if (state) {
            state.failCount += 1;
            state.completedCount += 1;
            state.runningCount = Math.max(0, state.runningCount - 1);
            if (browserClosed) {
                state.active = false;
                state.stopRequested = true;
                state.queue = [];
                this.logger.warning('检测到浏览器关闭，海卡绑定批次已停止继续派发任务');
            }
            this.emitHaikaBindingProgress();
        }

        if (this.mainWindow && !(state && state.stopRequested)) {
            this.mainWindow.webContents.send('task-error', {
                taskId,
                error: errorText,
                parentTaskId: state?.batchId || '',
                parentTaskLabel: '海卡绑定批次'
            });
            this.mainWindow.webContents.send('haika-binding-error', {
                taskId,
                error: errorText
            });
        }

        if (state && state.active && !state.stopRequested) {
            this.startNextHaikaBindingTask()
                .then(() => {
                    return this.updateStats();
                })
                .catch(updateError => {
                    this.logger.error(`推进海卡绑定队列失败: ${updateError.message}`);
                });
        }

        if (state && state.runningCount === 0 && state.queue.length === 0) {
            this.finishHaikaBindingBatch()
                .catch(finishError => {
                    this.logger.error(`结束海卡绑定批次失败: ${finishError.message}`);
                });
            return;
        }

        this.updateStats().catch(updateError => {
            this.logger.error(`更新海卡绑定统计失败: ${updateError.message}`);
        });
    }
};
