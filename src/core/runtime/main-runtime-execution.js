const ExecutionThread = require('../execution-thread');
const StepSynchronizer = require('../infra/step-synchronizer');
const { IPC_CHANNELS } = require('../ipc/channels');
const {
    cloneRegistrationCardConfig,
    summarizeRegistrationDefaultExecutionPlan,
    toPositiveInteger
} = require('./main-runtime-utils');

module.exports = {
    async startRegistration(config) {
        try {
            config = this._resolveExecutionStartConfig(config);
            this.logger.info?.(`自动化默认执行方案已参与启动: ${JSON.stringify(summarizeRegistrationDefaultExecutionPlan(this.automationDefaultExecutionPlan || {}))}`);
            this.logger.info?.(`自动化启动最终配置: ${JSON.stringify({
                runMode: config.runMode,
                concurrentCount: config.concurrentCount,
                syncEnabled: config.syncEnabled,
                maxProxyRecoveryAttempts: config.maxProxyRecoveryAttempts,
                timedRegistrationCount: config.timedRegistrationCount,
                timedRegistrationCycleCount: config.timedRegistrationCycleCount,
                timedRegistrationStartMode: config.timedRegistrationStartMode,
                timedRegistrationDelayMs: config.timedRegistrationDelayMs,
                server_card_name: String(config?.server_card_name || config?.serverCardName || '').trim(),
                browserSettings: summarizeRegistrationDefaultExecutionPlan({
                    browser_settings: config.browserSettings || config.browser_settings || {}
                }).browser_settings
            })}`);
            const runtimeDefaultCardName = String(config?.server_card_name || config?.serverCardName || '').trim();
            let directCardConfig = cloneRegistrationCardConfig(config?.cardData);
            if (!directCardConfig && !this.currentCard && runtimeDefaultCardName) {
                directCardConfig = cloneRegistrationCardConfig(await this.cardManager.getCard(runtimeDefaultCardName));
            }
            if (!directCardConfig && !this.currentCard) {
                return { success: false, error: '请先选择一个自动化卡片' };
            }

            this.activeRegistrationCardConfig = directCardConfig;
            if (this.activeRegistrationCardConfig && !this.activeRegistrationCardConfig.name && config?.cardName) {
                this.activeRegistrationCardConfig.name = String(config.cardName || '').trim();
            }
            this.activeRegistrationCardName = String(
                this.activeRegistrationCardConfig?.name
                || config?.cardName
                || this.currentCard?.name
                || this.currentCardName
                || this.currentCard
                || ''
            ).trim();

            this.browserSettings = cloneRegistrationCardConfig(config.browserSettings || config.browser_settings) || {};
            if (this.browserSettings && typeof this.browserSettings === 'object') {
                this.currentBrowserType = String(
                    this.browserSettings.browser_type
                    || this.browserSettings.browserType
                    || this.currentBrowserType
                    || ''
                ).trim() || this.currentBrowserType;
            }

            this.lastRegistrationConfig = {
                ...(config || {}),
                cardData: this.activeRegistrationCardConfig ? cloneRegistrationCardConfig(this.activeRegistrationCardConfig) : undefined,
                cardName: this.activeRegistrationCardName
            };
            this.automationStopRequested = false;
            this.runMode = Number.isFinite(Number(config.runMode)) ? Number(config.runMode) : 0;
            this.concurrentCount = toPositiveInteger(config.concurrentCount, 1, 1, 99);
            this.syncEnabled = config.syncEnabled === true;
            this.maxProxyRecoveryAttempts = toPositiveInteger(config.maxProxyRecoveryAttempts, 3, 1, 20);
            this.isLoopRunning = (this.runMode === 1);
            this.isTimedRunning = (this.runMode === 2);
            this.proxyRecoveryState = {
                active: false,
                attempts: 0
            };
            this._clearTimedRegistrationTimers();
            this.timedRegistrationState = null;
            this.timedRegistrationSessionId = null;

            if (this.isTimedRunning) {
                this._createTimedRegistrationState(config);
            }

            const modeLabel = this._getExecutionModeLabel(this.runMode);
            const timedSummary = this.isTimedRunning && this.timedRegistrationState
                ? `, 单次数量: ${this.timedRegistrationState.totalCount}, 最大循环: ${this.timedRegistrationState.cycleLimit}, 间隔: ${this._formatTimedRegistrationDuration(this.timedRegistrationState.delayMs)}, 开始方式: ${this.timedRegistrationState.startMode === 'delayed' ? '延时开始' : '立即执行'}`
                : '';
            this.logger.info(`开始执行 - 模式: ${modeLabel}, 并发数: ${this.concurrentCount}, 同步: ${this.syncEnabled}, 自动恢复上限: ${this.maxProxyRecoveryAttempts}${timedSummary}`);

            if (this.syncEnabled && this.concurrentCount > 1) {
                this.stepSynchronizer = new StepSynchronizer(this.concurrentCount, this.logger);
            } else {
                this.stepSynchronizer = null;
            }

            if (this.isTimedRunning && this.timedRegistrationState) {
                const timedState = this.timedRegistrationState;
                const initialDelayMs = timedState.startMode === 'delayed' ? timedState.delayMs : 0;
                if (timedState.startMode === 'delayed' && initialDelayMs > 0) {
                    this._scheduleTimedRegistrationCycleStart(timedState, 1, initialDelayMs, {
                        displayCycleIndex: 0,
                        statusText: '等待开始'
                    });
                } else {
                    await this._launchTimedRegistrationCycle(timedState, {
                        cycleIndex: 1,
                        trigger: 'timed-start',
                        statusText: '执行中'
                    });
                }
            } else {
                const initialLaunchCount = Math.max(1, this.concurrentCount);
                this.logger.info(`启动初始自动化任务: ${initialLaunchCount} 个`);

                for (let i = 0; i < initialLaunchCount; i++) {
                    if (this.automationStopRequested) {
                        break;
                    }

                    const startResult = await this.startSingleRegistrationTask({
                        trigger: 'manual-start',
                        taskType: 'automation'
                    });

                    if (!startResult || startResult.success === false) {
                        throw new Error(startResult?.error || '启动自动化任务失败');
                    }
                }
            }

            return { success: true };
        } catch (error) {
            if (this.timedRegistrationState) {
                this._clearTimedRegistrationTimers();
                this.timedRegistrationState.active = false;
                this.timedRegistrationState.stopRequested = true;
                this.timedRegistrationState = null;
                this.timedRegistrationSessionId = null;
                this.isTimedRunning = false;
            }
            this.logger.error(`开始执行失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    async startSingleRegistrationTask(overrides = {}) {
        const taskType = overrides.taskType || 'automation';
        if (taskType === 'automation' && (this.automationStopRequested || (this.timedRegistrationState && this.timedRegistrationState.stopRequested))) {
            return { success: false, error: '自动化已停止' };
        }

        const taskId = overrides.taskId || `${taskType}_${Date.now()}_${this.runningTasks.size}`;
        const cardConfig = cloneRegistrationCardConfig(overrides.cardConfig)
            || cloneRegistrationCardConfig(this.activeRegistrationCardConfig)
            || await this.cardManager.getCard(this.currentCard);
        if (!cardConfig) {
            throw new Error(`无法获取卡片配置: ${this.activeRegistrationCardName || this.currentCard || '未命名卡片'}`);
        }

        const effectiveCardName = String(
            overrides.cardName
            || cardConfig?.name
            || this.activeRegistrationCardName
            || this.currentCard
            || ''
        ).trim();
        if (!cardConfig.name && effectiveCardName) {
            cardConfig.name = effectiveCardName;
        }

        if (taskType === 'automation' && (this.automationStopRequested || (this.timedRegistrationState && this.timedRegistrationState.stopRequested))) {
            return { success: false, error: '自动化已停止' };
        }

        let browserType = overrides.browserType || this.currentBrowserType;
        const browserSettings = overrides.browserSettings || this.browserSettings;
        if (taskType === 'automation' && String(browserType || '').trim().toLowerCase() === 'electron') {
            browserType = 'edge';
            if (browserSettings && typeof browserSettings === 'object') {
                browserSettings.browser_type = browserType;
                browserSettings.browserType = browserType;
                browserSettings.browser_source = 'local-browser';
                browserSettings.browserSource = 'local-browser';
            }
            this.logger.info?.('自动化任务检测到 Electron 浏览器，已切换到系统 Edge 以提高验证码兼容性');
        }
        if (taskType === 'automation' && browserSettings && typeof browserSettings === 'object' && browserSettings.headless === undefined) {
            browserSettings.headless = String(browserType || '').trim().toLowerCase() === 'electron' ? false : true;
        }
        if (taskType === 'automation' && browserSettings && typeof browserSettings === 'object') {
            browserSettings.headless = false;
            browserSettings.headlessMode = false;
            browserSettings.block_images_videos = false;
            browserSettings.blockImagesVideos = false;
            browserSettings.remove_watermark_plugin = false;
            browserSettings.removeWatermarkPlugin = false;
            browserSettings.captcha_compatibility_mode = true;
            browserSettings.captchaCompatibilityMode = true;
        }
        const hasLimitedLicenseUsage = taskType === 'automation' && this.licenseUsageLocked === true;
        if (hasLimitedLicenseUsage) {
            const normalizedBrowserType = String(browserType || '').trim().toLowerCase();
            if (!normalizedBrowserType || normalizedBrowserType === 'electron') {
                browserType = 'edge';
            }
            if (browserSettings && typeof browserSettings === 'object') {
                browserSettings.browser_type = browserType;
                browserSettings.browserType = browserType;
                browserSettings.headless = false;
                browserSettings.headlessMode = false;
                browserSettings.block_images_videos = false;
                browserSettings.blockImagesVideos = false;
                browserSettings.captcha_compatibility_mode = true;
                browserSettings.captchaCompatibilityMode = true;
            }
        }
        if (taskType === 'automation' && typeof this.isLicenseUsageExhausted === 'function') {
            const usageCheck = await this.isLicenseUsageExhausted(overrides.cardKey || this.currentCardKey || this.currentCardValidationSnapshot?.key || '');
            if (usageCheck?.exhausted === true) {
                return { success: false, error: '卡密次数已用完，请重新验证或更换卡密' };
            }
        }

        const normalizedBrowserType = String(browserType || '').trim().toLowerCase();
        let browserId = String(overrides.browserId || '').trim();
        const task = new RegistrationThread(taskId, cardConfig, {
            app: this,
            browserManager: this.browserManager,
            cookieManager: this.cookieManager,
            logger: this.logger,
            emailClient: this.emailClient,
            browserType,
            browserSettings,
            clashManager: this.clashManager,
            synchronizer: this.stepSynchronizer,
            cardKeyPrefix: this.getCardKeyPrefix ? this.getCardKeyPrefix() : '',
            emailSuffix: this.getEmailSuffix ? this.getEmailSuffix() : '',
            emailRandomConfig: this.getEmailRandomConfig ? this.getEmailRandomConfig() : this.emailRandomConfig || {},
            contextVariables: overrides.contextVariables || {},
            initialCookies: Array.isArray(overrides.initialCookies) ? overrides.initialCookies : [],
            skipCookieSave: overrides.skipCookieSave || false,
            debugMode: overrides.debugMode || false,
            keepBrowserOpen: overrides.keepBrowserOpen || hasLimitedLicenseUsage,
            debugDefaultStepPauseMs: overrides.debugDefaultStepPauseMs,
            debugStepPauseMs: overrides.debugStepPauseMs,
            debugErrorPauseMs: overrides.debugErrorPauseMs,
            browserId
        });

        task.on('progress', (progress, message) => {
            if (this.mainWindow || this.cardEditorWindow) {
                this.emitUiEvent('task-progress', { taskId, progress, message });
                if (task.debugMode === true) {
                    const debugState = task.debugState && typeof task.debugState === 'object' ? task.debugState : {};
                    this.emitUiEvent(IPC_CHANNELS.cardDebugState, {
                        taskId,
                        progress,
                        message,
                        statusText: message || '调试中',
                        currentStepName: task.currentStep || '',
                        currentStepIndex: Number.isFinite(Number(task.debugState?.currentStepIndex)) ? Number(task.debugState.currentStepIndex) : -1,
                        totalSteps: Number.isFinite(Number(task.debugState?.totalSteps)) ? Number(task.debugState.totalSteps) : 0,
                        awaitingRunMode: debugState.awaitingRunMode === true,
                        runMode: String(debugState.runMode || '').trim(),
                        canPause: debugState.canPause !== false,
                        canResume: debugState.canResume === true || debugState.paused === true,
                        paused: debugState.paused === true,
                        active: true
                    });
                }
            }
        });

        task.on('debug-state', (payload = {}) => {
            if (this.mainWindow || this.cardEditorWindow) {
                this.emitUiEvent(IPC_CHANNELS.cardDebugState, {
                    taskId,
                    ...payload
                });
            }
        });

        task.on('finished', async (result) => {
            const cardUploadConfig = (() => {
                const upload = cardConfig && typeof cardConfig.upload === 'object' ? cardConfig.upload : {};
                return {
                    cardName: effectiveCardName || cardConfig?.name || '',
                    serverUrl: cardConfig?.upload_server_url || cardConfig?.uploadServerUrl || upload.server_url || upload.serverUrl || '',
                    cardKey: cardConfig?.upload_card_key || cardConfig?.uploadCardKey || cardConfig?.card_key || upload.card_key || upload.cardKey || '',
                    minCookieSizeBytes: cardConfig?.min_cookie_size_bytes ?? cardConfig?.minCookieSizeBytes ?? cardConfig?.min_cookie_size ?? cardConfig?.minCookieSize ?? 8192,
                    targetScoreScope: cardConfig?.upload_target_score_scope || cardConfig?.uploadTargetScoreScope || upload.target_score_scope || upload.targetScoreScope || 'all',
                    targetScoreTypes: cardConfig?.upload_target_score_types || cardConfig?.uploadTargetScoreTypes || upload.target_score_types || upload.targetScoreTypes || []
                };
            })();
            const enrichedResult = (result && typeof result === 'object')
                ? {
                    ...result,
                    cardName: result.cardName || effectiveCardName || this.currentCard || '',
                    cardUploadConfig
                }
                : result;
            if (typeof overrides.onFinished === 'function') {
                await overrides.onFinished(taskId, enrichedResult);
                return;
            }
            await this.onRegistrationFinished(taskId, enrichedResult);
        });

        task.on('error', (error) => {
            if (typeof overrides.onError === 'function') {
                overrides.onError(taskId, error);
                return;
            }
            this.onRegistrationError(taskId, error);
        });

        task.on('browser-created', (browserId) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('browser-created', { taskId, browserId, taskType });
            }
        });

        this.runningTasks.set(taskId, task);
        task.start();

        if (this.mainWindow) {
            this.mainWindow.webContents.send('task-started', {
                taskId,
                taskNumber: this.runningTasks.size,
                taskType,
                taskLabel: overrides.taskLabel || (effectiveCardName || (taskType === 'debug' ? '调试任务' : '自动化任务'))
            });
        }

        this.logger.info(`开始${taskType === 'debug' ? '调试' : '自动化'}任务: ${taskId}`);
        await this.updateStats();
        return { success: true, taskId };
    },

    async startCardDebugTask(config = {}) {
        try {
            for (const [taskId, task] of this.runningTasks.entries()) {
                if (!task || task.debugMode !== true) {
                    continue;
                }

                if (task.running === false || task.stopReason || task.browserClosed === true) {
                    this.runningTasks.delete(taskId);
                }
            }

            if (this.runningTasks.size > 0) {
                return { success: false, error: '当前已有任务在运行，请先停止后再调试' };
            }

            const cardData = config.cardData;
            if (!cardData || typeof cardData !== 'object') {
                return { success: false, error: '调试数据无效' };
            }

            if (!Array.isArray(cardData.steps) || cardData.steps.length === 0) {
                return { success: false, error: '调试步骤为空，请先配置至少一个步骤' };
            }

            const runtimeConfig = typeof this.readExecutionRuntimeConfigFromDisk === 'function'
                ? await this.readExecutionRuntimeConfigFromDisk()
                : {};
            const runtimeBrowserSettings = runtimeConfig && typeof runtimeConfig === 'object'
                ? (runtimeConfig.browserSettings && typeof runtimeConfig.browserSettings === 'object'
                    ? runtimeConfig.browserSettings
                    : runtimeConfig.browser_settings && typeof runtimeConfig.browser_settings === 'object'
                        ? runtimeConfig.browser_settings
                        : {})
                : {};
            const incomingBrowserSettings = (config.browserSettings || config.browser_settings) && typeof (config.browserSettings || config.browser_settings) === 'object'
                ? { ...(config.browserSettings || config.browser_settings) }
                : {};
            const baseBrowserSettings = {
                ...runtimeBrowserSettings,
                ...(this.browserSettings && typeof this.browserSettings === 'object' ? this.browserSettings : {}),
                ...incomingBrowserSettings
            };
            const choosePreferredBrowserType = (...values) => {
                const normalizedValues = values
                    .map(value => String(value || '').trim())
                    .filter(Boolean);
                return normalizedValues.find(value => value.toLowerCase() !== 'electron')
                    || normalizedValues[0]
                    || 'electron';
            };
            const browserType = String(
                choosePreferredBrowserType(
                    incomingBrowserSettings.browser_type,
                    incomingBrowserSettings.browserType,
                    this.browserSettings?.browser_type,
                    this.browserSettings?.browserType,
                    this.currentBrowserType,
                    runtimeBrowserSettings.browser_type,
                    runtimeBrowserSettings.browserType,
                    config.browserType,
                    baseBrowserSettings.browser_type,
                    baseBrowserSettings.browserType
                )
            ).trim() || 'electron';

            baseBrowserSettings.browser_type = browserType;
            baseBrowserSettings.browserType = browserType;
            baseBrowserSettings.headless = false;
            baseBrowserSettings.headlessMode = false;
            baseBrowserSettings.block_images_videos = false;
            baseBrowserSettings.blockImagesVideos = false;
            baseBrowserSettings.remove_watermark_plugin = false;
            baseBrowserSettings.removeWatermarkPlugin = false;
            baseBrowserSettings.captcha_compatibility_mode = true;
            baseBrowserSettings.captchaCompatibilityMode = true;
            baseBrowserSettings.debug_mode = true;
            baseBrowserSettings.debugMode = true;
            baseBrowserSettings.debug_inspector_auto_open = false;
            this.browserSettings = baseBrowserSettings;
            this.currentBrowserType = browserType;
            this.logger.info?.(`卡片调试使用浏览器设置: ${browserType}`);
            const pauseEachStep = config.pauseEachStep !== false;

            const startResult = await this.startSingleRegistrationTask({
                taskType: 'debug',
                taskLabel: '卡片调试',
                cardConfig: cardData,
                browserType,
                browserSettings: baseBrowserSettings,
                skipCookieSave: true,
                debugMode: true,
                keepBrowserOpen: true,
                debugDefaultStepPauseMs: pauseEachStep ? 3000 : 0,
                debugStepPauseMs: pauseEachStep ? 3000 : 0,
                debugErrorPauseMs: 10000,
                onFinished: async (taskId, result) => {
                    if (this.runningTasks.has(taskId)) {
                        this.runningTasks.delete(taskId);
                    }

                    this.emitUiEvent('task-finished', { taskId });
                    this.emitUiEvent('card-debug-finished', { taskId, result });

                    const warningCount = Array.isArray(result?.warnings) ? result.warnings.length : 0;
                    this.logger.info(
                        `卡片调试任务 ${taskId} 完成${warningCount > 0 ? `，包含 ${warningCount} 个告警` : ''}`
                    );
                    await this.updateStats();
                },
                onError: (taskId, error) => {
                    if (this.runningTasks.has(taskId)) {
                        this.runningTasks.delete(taskId);
                    }

                    this.emitUiEvent('task-finished', { taskId });
                    this.emitUiEvent('card-debug-error', { taskId, error });

                    this.logger.error(`卡片调试任务 ${taskId} 失败: ${error}`);
                    this.updateStats();
                }
            });

            return startResult;
        } catch (error) {
            this.logger.error(`启动卡片调试失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    },

    async handleCardDebugAction(payload = {}) {
        const action = String(payload.action || '').trim();
        if (action !== 'get-random-email'
            && action !== 'set-debug-run-mode'
            && action !== 'set-debug-continue-mode'
            && action !== 'debug-step-navigation') {
            return { success: false, error: '不支持的调试动作' };
        }

        const debugEntry = Array.from(this.runningTasks.entries())
            .find(([taskId, task]) => String(taskId || '').startsWith('debug_') || task?.debugMode === true);
        if (!debugEntry) {
            return { success: false, error: '当前没有正在运行的卡片调试任务' };
        }

        const [taskId, task] = debugEntry;
        if (action === 'set-debug-run-mode') {
            const mode = String(payload.mode || '').trim();
            if (typeof task._setDebugRunMode !== 'function') {
                return { success: false, error: '当前调试任务不支持选择运行模式' };
            }
            const result = task._setDebugRunMode(mode);
            if (result && result.success === true) {
                this.emitUiEvent(IPC_CHANNELS.cardDebugState, {
                    taskId,
                    ...(task._getDebugState?.() || {})
                });
            }
            return result;
        }

        if (action === 'set-debug-continue-mode') {
            const mode = String(payload.mode || '').trim();
            if (typeof task._setDebugContinueMode !== 'function') {
                return { success: false, error: '当前调试任务不支持切换继续模式' };
            }
            const result = task._setDebugContinueMode(mode);
            if (result && result.success === true) {
                this.emitUiEvent(IPC_CHANNELS.cardDebugState, {
                    taskId,
                    ...(task._getDebugState?.() || {})
                });
            }
            return result;
        }

        if (action === 'debug-step-navigation') {
            const direction = String(payload.direction || '').trim();
            if (typeof task._setDebugStepNavigation !== 'function') {
                return { success: false, error: '当前调试任务不支持步骤跳转' };
            }
            const result = task._setDebugStepNavigation(direction);
            if (result && result.success === true) {
                this.emitUiEvent(IPC_CHANNELS.cardDebugState, {
                    taskId,
                    ...(task._getDebugState?.() || {})
                });
            }
            return result;
        }

        const email = String(task.generatedEmail || task.credentials?.email || task.cardConfig?.email || '').trim();
        if (!email) {
            return { success: false, error: '当前调试任务还没有生成随机邮箱' };
        }

        const result = {
            success: true,
            taskId,
            email,
            account: String(task.generatedAccount || '').trim()
        };
        this.emitUiEvent(IPC_CHANNELS.cardDebugRandomEmail, result);
        this.logger.info(`调试动作获取随机邮箱: ${email}`);
        return result;
    },

    _getActiveDebugTask(taskId = '') {
        const normalizedTaskId = String(taskId || '').trim();
        if (normalizedTaskId && this.runningTasks.has(normalizedTaskId)) {
            const directTask = this.runningTasks.get(normalizedTaskId);
            if (directTask && directTask.debugMode === true) {
                return { taskId: normalizedTaskId, task: directTask };
            }
        }

        for (const [candidateTaskId, task] of this.runningTasks.entries()) {
            if (task && task.debugMode === true) {
                if (!normalizedTaskId || normalizedTaskId === candidateTaskId) {
                    return { taskId: candidateTaskId, task };
                }
            }
        }

        return null;
    },

    async pauseCardDebugTask(taskId = '', reason = 'manual') {
        const entry = this._getActiveDebugTask(taskId);
        if (!entry) {
            return { success: false, error: '当前没有正在运行的卡片调试任务' };
        }

        const { task } = entry;
        if (typeof task._requestDebugPause !== 'function') {
            return { success: false, error: '当前调试任务不支持暂停' };
        }

        return task._requestDebugPause(reason, {
            taskId: entry.taskId,
            message: '已请求暂停，等待当前步骤安全停止'
        });
    },

    async resumeCardDebugTask(taskId = '') {
        const entry = this._getActiveDebugTask(taskId);
        if (!entry) {
            return { success: false, error: '当前没有正在运行的卡片调试任务' };
        }

        const { task } = entry;
        if (typeof task._resumeDebug !== 'function') {
            return { success: false, error: '当前调试任务不支持继续' };
        }

        return task._resumeDebug('manual');
    },

    async onRegistrationFinished(taskId, result) {
        const browserClosed = result?.browserClosed === true
            || /浏览器.*任务已终止|浏览器实例已(?:关闭|断开)|浏览器页面已关闭/i.test(this.getErrorText(result?.error || ''));
        if (this.runningTasks.has(taskId)) {
            this.runningTasks.delete(taskId);
        }

        if (this.automationStopRequested) {
            await this.updateStats();
            return;
        }

        if (result.success) {
            const successToastMessage = `执行成功!\n邮箱: ${result.email}\n积分: ${result.points}`;
            if (this.mainWindow) {
                this.mainWindow.webContents.send('task-finished', {
                    taskId,
                    taskLabel: result.cardName || this.activeRegistrationCardName || this.currentCardName || this.currentCard || '自动化任务',
                    taskType: 'automation'
                });
                this.mainWindow.webContents.send('app-toast', {
                    message: successToastMessage,
                    type: 'success'
                });
            }
            this.logger.info(`任务 ${taskId} 成功完成`);
            if (typeof this.notifyExecutionTcpSuccess === 'function') {
                try {
                    const tcpResult = await this.notifyExecutionTcpSuccess({
                        taskId,
                        email: result.email,
                        points: result.points,
                        cardName: result.cardName || this.activeRegistrationCardName || this.currentCardName || this.currentCard || '',
                        cookiesSaved: result.cookiesSaved === true
                    });
                    if (tcpResult && tcpResult.ok === false) {
                        this.logger.warning(`执行成功通知未发送: ${tcpResult.message || '未知原因'}`);
                    }
                } catch (error) {
                    this.logger.warning(`执行成功通知发送失败: ${error.message}`);
                }
            }
            if (this.mainWindow) {
                this.mainWindow.webContents.send('automation-result', {
                    taskId,
                    result
                });
            }
            const automationCardKey = String(
                this.currentCardKey
                || this.currentCardValidationSnapshot?.key
                || (typeof this.readSavedCardKey === 'function' ? await this.readSavedCardKey() : '')
                || ''
            ).trim();
            if (automationCardKey && typeof this.consumeSavedCardUsage === 'function') {
                try {
                    const usageResult = await this.consumeSavedCardUsage(automationCardKey, 1, {
                        source: 'automation-success',
                        cardName: result.cardName || this.activeRegistrationCardName || this.currentCardName || this.currentCard || ''
                    });
                    if (usageResult?.cache?.usageInfo) {
                        this.currentCardUsageSnapshot = usageResult.cache.usageInfo;
                        this.licenseUsageLocked = usageResult.cache.usageInfo.locked === true;
                        if (this.currentCardValidationSnapshot?.key === automationCardKey) {
                            this.currentCardValidationSnapshot = {
                                ...this.currentCardValidationSnapshot,
                                usageInfo: usageResult.cache.usageInfo
                            };
                        }
                        this.logger.info(
                            `执行成功后刷新剩余次数: ${usageResult.cache.usageInfo.remainingText || '0'} / ${usageResult.cache.usageInfo.totalText || '未知'}`
                        );
                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('license-usage-updated', {
                                cardKey: automationCardKey,
                                usageInfo: usageResult.cache.usageInfo
                            });
                        }
                    }
                } catch (usageError) {
                    this.logger.warning(`执行成功后扣减卡密次数失败: ${usageError.message}`);
                }
            }

            if (result.cookiesSaved && this.mainWindow) {
                this.logger.info('检测到Cookie保存成功，发送刷新消息');
                this.mainWindow.webContents.send('cookies-refreshed', { success: true });
            }
        } else {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('task-error', {
                    taskId,
                    error: result.error || result.message || '自动化任务失败',
                    taskLabel: result.cardName || this.activeRegistrationCardName || this.currentCardName || this.currentCard || '自动化任务',
                    taskType: 'automation',
                    statusKey: 'error'
                });
            }
            this.logger.error(`任务 ${taskId} 失败: ${result.error}`);
            let proxyRecovered = false;
            if (browserClosed) {
                this.logger.warning(`任务 ${taskId} 因浏览器关闭而结束，不再继续当前流程`);
                if (this.isLoopRunning || this._isTimedRegistrationSessionActive()) {
                    proxyRecovered = await this.recoverFromProxyError(taskId, result.error || result.message || '浏览器关闭');
                }

                if (!this._isTimedRegistrationSessionActive()) {
                if (!proxyRecovered) {
                    this.isLoopRunning = false;
                    if (this.mainWindow && !this.isLoopRunning) {
                        const failureToastMessage = `执行失败: ${this.getErrorText(result.error || '自动化任务失败')}`;
                        this.mainWindow.webContents.send('automation-error', { error: result.error });
                        this.mainWindow.webContents.send('app-toast', {
                            message: failureToastMessage,
                            type: 'error'
                        });
                        if (this.runningTasks.size === 0) {
                            this.mainWindow.webContents.send('all-tasks-finished');
                        }
                        }
                    }
                    await this.updateStats();
                    return;
                }

                if (!proxyRecovered && this.mainWindow && !this.isLoopRunning) {
                    const failureToastMessage = `执行失败: ${this.getErrorText(result.error || '自动化任务失败')}`;
                    this.mainWindow.webContents.send('automation-error', { error: result.error });
                    this.mainWindow.webContents.send('app-toast', {
                        message: failureToastMessage,
                        type: 'error'
                    });
                }
            } else {
                proxyRecovered = await this.recoverFromProxyError(taskId, result.error);
                if (proxyRecovered) {
                    if (this.isLoopRunning) {
                        await this.updateStats();
                        return;
                    }
                } else if (this.mainWindow && !this.isLoopRunning) {
                    const failureToastMessage = `执行失败: ${this.getErrorText(result.error || '自动化任务失败')}`;
                    this.mainWindow.webContents.send('automation-error', { error: result.error });
                    this.mainWindow.webContents.send('app-toast', {
                        message: failureToastMessage,
                        type: 'error'
                    });
                }
            }
        }

        if (this.proxyRecoveryState.active) {
            await this.updateStats();
            return;
        }

        if (this._isTimedRegistrationSessionActive()) {
            await this._handleTimedRegistrationTaskCompletion(taskId, result, {
                trigger: 'timed-complete'
            });
            await this.updateStats();
            return;
        }

        if (this.isLoopRunning) {
            if (this.syncEnabled && this.concurrentCount > 1) {
                if (this.runningTasks.size === 0) {
                    this.logger.info('所有同步任务已完成，开始下一轮循环');
                    this.stepSynchronizer = new StepSynchronizer(this.concurrentCount, this.logger);

                    for (let i = 0; i < this.concurrentCount; i++) {
                        await this.startSingleRegistrationTask();
                    }
                }
            } else {
                if (this.runningTasks.size < this.concurrentCount) {
                    await this.startSingleRegistrationTask();
                }
            }
        } else if (this.runningTasks.size === 0) {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('all-tasks-finished');
            }
            this.isLoopRunning = false;
        }

        await this.updateStats();
    },

    async onRegistrationError(taskId, error) {
        this.logger.error(`任务 ${taskId} 错误: ${error}`);
        const errorText = this.getErrorText(error);
        const browserClosed = /浏览器.*任务已终止|浏览器实例已(?:关闭|断开)|浏览器页面已关闭/i.test(errorText);
        if (this.runningTasks.has(taskId)) {
            this.runningTasks.delete(taskId);
        }

        if (this.mainWindow) {
            this.mainWindow.webContents.send('task-error', { taskId, error: errorText });
        }

        if (this.automationStopRequested) {
            this.updateStats().catch(updateError => {
                this.logger.error(`更新统计失败: ${updateError.message}`);
            });
            return;
        }

        if (this.proxyRecoveryState.active) {
            return;
        }

        if (browserClosed) {
            this.logger.warning(`任务 ${taskId} 因浏览器关闭而终止，不再继续当前流程`);
            if (!this._isTimedRegistrationSessionActive()) {
                this.isLoopRunning = false;
                if (this.mainWindow) {
                    const failureToastMessage = `执行失败: ${errorText}`;
                    this.mainWindow.webContents.send('automation-error', { error: errorText });
                    this.mainWindow.webContents.send('app-toast', {
                        message: failureToastMessage,
                        type: 'error'
                    });
                    if (this.runningTasks.size === 0) {
                        this.mainWindow.webContents.send('all-tasks-finished');
                    }
                }
                this.updateStats().catch(updateError => {
                    this.logger.error(`更新统计失败: ${updateError.message}`);
                });
                return;
            }
        }

        this.recoverFromProxyError(taskId, error).then(async (recovered) => {
            if (!recovered && this.mainWindow && !this.isLoopRunning) {
                const failureToastMessage = `执行失败: ${errorText}`;
                this.mainWindow.webContents.send('automation-error', { error });
                this.mainWindow.webContents.send('app-toast', {
                    message: failureToastMessage,
                    type: 'error'
                });
            }

            if (this._isTimedRegistrationSessionActive()) {
                await this._handleTimedRegistrationTaskCompletion(taskId, { success: false, error: errorText }, {
                    trigger: 'timed-error'
                });
                await this.updateStats();
                return;
            }
            await this.updateStats();
        }).catch(async (recoverError) => {
            this.logger.error(`处理任务 ${taskId} 失败时发生异常: ${recoverError.message}`);
            if (this.mainWindow && !this.isLoopRunning) {
                const failureToastMessage = `执行失败: ${errorText}`;
                this.mainWindow.webContents.send('automation-error', { error });
                this.mainWindow.webContents.send('app-toast', {
                    message: failureToastMessage,
                    type: 'error'
                });
            }

            if (this._isTimedRegistrationSessionActive()) {
                await this._handleTimedRegistrationTaskCompletion(taskId, { success: false, error: errorText }, {
                    trigger: 'timed-error'
                });
                await this.updateStats();
                return;
            }
            await this.updateStats();
        });
    },

    async stopRegistration(options = {}) {
        const {
            closeBrowsers = true
        } = options;

        this.automationStopRequested = true;
        this.isLoopRunning = false;
        this.isTimedRunning = false;
        this.proxyRecoveryState.active = false;
        this.proxyRecoveryState.attempts = 0;
        if (this.timedRegistrationState) {
            this.timedRegistrationState.active = false;
            this.timedRegistrationState.stopRequested = true;
        }
        this._clearTimedRegistrationTimers();
        this.timedRegistrationState = null;
        this.timedRegistrationSessionId = null;
        this.activeRegistrationCardConfig = null;
        this.activeRegistrationCardName = '';
        if (this.haikaBindingState) {
            this.haikaBindingState.active = false;
            this.haikaBindingState.stopRequested = true;
            this.haikaBindingState.queue = [];
        }

        for (const [taskId, task] of this.runningTasks) {
            task.stop('自动化任务已停止');
            this.logger.info(`停止执行任务: ${taskId}`);
        }

        this.runningTasks.clear();

        if (this.mainWindow) {
            this.mainWindow.webContents.send('all-tasks-stopped');
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        if (!closeBrowsers) {
            this.logger.info('任务已停止，浏览器清理交由外层流程处理');
            return { success: true };
        }

        const browserCount = this.browserManager.getBrowserCount();
        if (browserCount > 0) {
            this.logger.warning(`停止执行后仍有 ${browserCount} 个浏览器实例未关闭`);
            await this.browserManager.closeAll();
            await new Promise(resolve => setTimeout(resolve, 2000));
            const finalCount = this.browserManager.getBrowserCount();
            if (finalCount === 0) {
                this.logger.info('最终清理：所有浏览器实例已关闭');
            } else {
                this.logger.error(`最终清理失败：仍有 ${finalCount} 个浏览器实例`);
            }
        } else {
            this.logger.info('所有浏览器实例已正确关闭');
        }

        return { success: true };
    },

    async updateStats() {
        try {
            const taskCount = this.runningTasks.size;
            const cookies = await this.cookieManager.listCookies();

            if (this.mainWindow) {
                this.mainWindow.webContents.send('stats-updated', {
                    taskCount,
                    cookieCount: cookies.length
                });
            }
        } catch (error) {
            this.logger.error(`更新统计失败: ${error.message}`);
        }
    }
};


