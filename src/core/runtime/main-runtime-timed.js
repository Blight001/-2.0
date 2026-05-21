module.exports = {
    _getTimedRegistrationPlanTotals(state = this.timedRegistrationState) {
        const batchSize = Math.max(1, parseInt(state?.totalCount, 10) || 1);
        const cycleLimit = Math.max(1, parseInt(state?.cycleLimit, 10) || 1);
        return {
            batchSize,
            cycleLimit,
            totalPlannedCount: batchSize * cycleLimit
        };
    },

    _getTimedRegistrationCycleLabel(state = this.timedRegistrationState, cycleIndex = null) {
        const { cycleLimit } = this._getTimedRegistrationPlanTotals(state);
        const normalizedCycleIndex = Math.max(
            1,
            Math.min(
                parseInt(cycleIndex, 10) || parseInt(state?.currentCycleIndex, 10) || 1,
                cycleLimit
            )
        );

        return `第 ${normalizedCycleIndex}/${cycleLimit} 轮`;
    },

    _getTimedRegistrationProgressTaskId(state = this.timedRegistrationState) {
        if (!state || !state.sessionId) {
            return null;
        }

        return `timed-registration-${state.sessionId}`;
    },

    _formatTimedRegistrationDuration(durationMs = 0) {
        const totalSeconds = Math.max(0, Math.ceil(Number(durationMs) / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const parts = [];
        if (hours > 0) {
            parts.push(`${hours}小时`);
        }
        if (minutes > 0 || hours > 0) {
            parts.push(`${minutes}分`);
        }
        parts.push(`${seconds}秒`);
        return parts.join('');
    },

    _getNextTimedRegistrationLaunchAt(state = this.timedRegistrationState) {
        if (!state || !state.pendingTimers || state.pendingTimers.size === 0) {
            return null;
        }

        let nextLaunchAt = null;
        for (const launchAt of state.pendingTimers.values()) {
            const normalizedLaunchAt = Number(launchAt);
            if (!Number.isFinite(normalizedLaunchAt)) {
                continue;
            }

            if (nextLaunchAt === null || normalizedLaunchAt < nextLaunchAt) {
                nextLaunchAt = normalizedLaunchAt;
            }
        }

        return nextLaunchAt;
    },

    _buildTimedRegistrationProgressPayload(state = this.timedRegistrationState, options = {}) {
        if (!state) {
            return null;
        }

        const {
            batchSize,
            cycleLimit,
            totalPlannedCount
        } = this._getTimedRegistrationPlanTotals(state);
        const completedCount = Math.max(0, Math.min(parseInt(state.completedCount, 10) || 0, totalPlannedCount));
        const startedCount = Math.max(0, Math.min(parseInt(state.startedCount, 10) || 0, totalPlannedCount));
        const cycleCompletedCount = Math.max(0, Math.min(parseInt(state.cycleCompletedCount, 10) || 0, batchSize));
        const cycleStartedCount = Math.max(0, Math.min(parseInt(state.cycleStartedCount, 10) || 0, batchSize));
        const startingCount = Math.max(0, parseInt(state.startingCount, 10) || 0);
        const waitingCount = Math.max(0, Number.isFinite(options.waitingCount) ? options.waitingCount : (this.runningTasks.size + startingCount));
        const remainingCount = Math.max(0, batchSize - cycleStartedCount - startingCount);
        const currentCycleIndex = Math.max(
            1,
            Math.min(
                parseInt(state.currentCycleIndex, 10) || (parseInt(state.completedCycleCount, 10) || 0) + 1,
                cycleLimit
            )
        );
        const completedCyclesBeforeCurrent = Math.max(0, Math.min(parseInt(state.completedCycleCount, 10) || 0, Math.max(0, cycleLimit - 1)));
        const taskId = options.taskId || this._getTimedRegistrationProgressTaskId(state);
        const taskLabel = options.taskLabel || this._getTimedRegistrationBatchLabel();
        const taskNumber = options.taskNumber !== undefined ? String(options.taskNumber) : this._getTimedRegistrationCycleLabel(state, currentCycleIndex);
        const progress = batchSize > 0 ? Math.round((cycleCompletedCount / batchSize) * 100) : 100;
        const nextLaunchAt = options.nextLaunchAt !== undefined
            ? options.nextLaunchAt
            : this._getNextTimedRegistrationLaunchAt(state);
        const normalizedNextLaunchAt = Number.isFinite(Number(nextLaunchAt)) ? Number(nextLaunchAt) : null;
        const nextLaunchInMs = normalizedNextLaunchAt !== null
            ? Math.max(0, normalizedNextLaunchAt - Date.now())
            : null;
        const sessionCompletedCount = Math.max(0, Math.min(completedCount, totalPlannedCount));
        const sessionStartedCount = Math.max(0, Math.min(startedCount, totalPlannedCount));
        const sessionRemainingCount = Math.max(0, totalPlannedCount - sessionStartedCount);
        const sessionProgress = totalPlannedCount > 0
            ? Math.round((sessionCompletedCount / totalPlannedCount) * 100)
            : 100;

        let statusText = options.statusText;
        if (!statusText) {
            if (waitingCount > 0 && remainingCount <= 0) {
                statusText = '等待当前任务结束';
            } else if (options.completed || (sessionCompletedCount >= totalPlannedCount && currentCycleIndex >= cycleLimit && cycleCompletedCount >= batchSize)) {
                statusText = '已完成';
            } else if (nextLaunchInMs !== null && remainingCount <= 0) {
                statusText = '等待下一轮';
            } else if (nextLaunchInMs !== null && remainingCount > 0 && cycleCompletedCount === 0 && cycleStartedCount === 0 && sessionCompletedCount === 0 && completedCyclesBeforeCurrent === 0) {
                statusText = '等待开始';
            } else if (remainingCount > 0 && nextLaunchInMs !== null) {
                statusText = '等待下一次执行';
            } else if (remainingCount > 0) {
                statusText = startedCount > completedCount ? '执行中' : '等待任务启动';
            } else {
                statusText = '执行中';
            }
        }

        let message = options.message;
        if (!message) {
            const messageParts = [];
            if (options.completed || (sessionCompletedCount >= totalPlannedCount && currentCycleIndex >= cycleLimit && cycleCompletedCount >= batchSize)) {
                messageParts.push(`定时注册完成，共完成 ${sessionCompletedCount}/${totalPlannedCount}`);
            } else if (nextLaunchInMs !== null && cycleCompletedCount === 0 && cycleStartedCount === 0 && completedCount === 0 && completedCyclesBeforeCurrent === 0) {
                messageParts.push(`准备开始定时注册，首轮将在 ${this._formatTimedRegistrationDuration(nextLaunchInMs)} 后开始`);
                messageParts.push(`共 ${cycleLimit} 轮，每轮 ${batchSize} 个`);
            } else if (nextLaunchInMs !== null && remainingCount <= 0) {
                messageParts.push(`${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}已完成`);
                messageParts.push(`下一轮还有 ${this._formatTimedRegistrationDuration(nextLaunchInMs)}`);
                messageParts.push(`累计已完成 ${sessionCompletedCount}/${totalPlannedCount}`);
            } else {
                messageParts.push(`${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}进行中`);
                messageParts.push(`本轮已完成 ${cycleCompletedCount}/${batchSize}`);
                if (remainingCount > 0) {
                    messageParts.push(`本轮剩余 ${remainingCount} 个`);
                }
                messageParts.push(`累计已完成 ${sessionCompletedCount}/${totalPlannedCount}`);
                if (sessionRemainingCount > 0) {
                    messageParts.push(`还剩 ${sessionRemainingCount} 个注册计划`);
                }
            }
            message = messageParts.join('，');
        }

        return {
            mode: 'timed',
            taskType: 'timed-registration-summary',
            sessionId: state.sessionId,
            taskId,
            taskLabel,
            taskNumber,
            progress,
            statusText,
            message,
            totalCount: batchSize,
            startedCount: cycleStartedCount,
            startingCount,
            completedCount: cycleCompletedCount,
            waitingCount,
            remainingCount,
            cycleLimit,
            currentCycleIndex,
            completedCycleCount: completedCyclesBeforeCurrent,
            sessionStartedCount,
            sessionCompletedCount,
            sessionRemainingCount,
            totalPlannedCount,
            cycleProgress: progress,
            sessionProgress,
            delayMs: state.delayMs,
            startMode: state.startMode,
            nextLaunchAt: normalizedNextLaunchAt,
            nextLaunchInMs,
            completed: !!options.completed,
            stage: options.stage || (
                waitingCount > 0 && remainingCount <= 0
                    ? 'finishing'
                    : options.completed || (sessionCompletedCount >= totalPlannedCount && currentCycleIndex >= cycleLimit && cycleCompletedCount >= batchSize)
                        ? 'completed'
                        : nextLaunchInMs !== null && remainingCount > 0
                            ? 'waiting'
                            : 'running'
            )
        };
    },

    _emitTimedRegistrationProgress(state = this.timedRegistrationState, options = {}) {
        if (!state || !this.mainWindow) {
            return null;
        }

        const payload = this._buildTimedRegistrationProgressPayload(state, options);
        if (!payload) {
            return null;
        }

        this._emitRegistrationCycleStatus(payload.message, payload);
        return payload;
    },

    _clearTimedRegistrationCountdownReporter(state = this.timedRegistrationState) {
        if (!state) {
            return;
        }

        if (state.reportTimer) {
            clearInterval(state.reportTimer);
            state.reportTimer = null;
        }

        state.nextLaunchAt = null;
    },

    _syncTimedRegistrationCountdownReporter(state = this.timedRegistrationState) {
        if (!state) {
            return;
        }

        const nextLaunchAt = this._getNextTimedRegistrationLaunchAt(state);
        state.nextLaunchAt = nextLaunchAt;

        if (!state.active || state.stopRequested || nextLaunchAt === null) {
            this._clearTimedRegistrationCountdownReporter(state);
            return;
        }

        if (state.reportTimer) {
            return;
        }

        state.reportTimer = setInterval(() => {
            const currentState = this.timedRegistrationState;
            if (!currentState || currentState !== state || currentState.sessionId !== this.timedRegistrationSessionId) {
                this._clearTimedRegistrationCountdownReporter(state);
                return;
            }

            if (!currentState.active || currentState.stopRequested) {
                this._clearTimedRegistrationCountdownReporter(state);
                return;
            }

            const currentNextLaunchAt = this._getNextTimedRegistrationLaunchAt(currentState);
            currentState.nextLaunchAt = currentNextLaunchAt;
            if (currentNextLaunchAt === null) {
                this._clearTimedRegistrationCountdownReporter(currentState);
                return;
            }

            const {
                batchSize,
                cycleLimit,
                totalPlannedCount
            } = this._getTimedRegistrationPlanTotals(currentState);
            const currentCycleIndex = Math.max(
                1,
                Math.min(
                    parseInt(currentState.currentCycleIndex, 10) || (parseInt(currentState.completedCycleCount, 10) || 0) + 1,
                    cycleLimit
                )
            );
            const isInitialWaiting = currentState.completedCount === 0 && currentState.cycleCompletedCount === 0 && currentCycleIndex === 1;
            const countdownLabel = isInitialWaiting ? '首轮' : '下一轮';
            const cycleLabel = this._getTimedRegistrationCycleLabel(currentState, currentCycleIndex);
            const payload = this._buildTimedRegistrationProgressPayload(currentState, {
                nextLaunchAt: currentNextLaunchAt,
                statusText: '等待下一次执行',
                message: isInitialWaiting
                    ? `定时注册倒计时：${countdownLabel}还有 ${this._formatTimedRegistrationDuration(currentNextLaunchAt - Date.now())}，本轮已完成 ${Math.max(0, currentState.cycleCompletedCount || 0)}/${batchSize}，累计已完成 ${Math.max(0, currentState.completedCount || 0)}/${totalPlannedCount}`
                    : `定时注册倒计时：${countdownLabel}还有 ${this._formatTimedRegistrationDuration(currentNextLaunchAt - Date.now())}，${cycleLabel}已完成，本轮已完成 ${Math.max(0, currentState.cycleCompletedCount || 0)}/${batchSize}，累计已完成 ${Math.max(0, currentState.completedCount || 0)}/${totalPlannedCount}`,
                stage: 'waiting'
            });

            if (!payload) {
                return;
            }

            this.logger.info(payload.message);
            this._emitRegistrationCycleStatus(payload.message, payload);
        }, 1000);
    },

    _clearTimedRegistrationTimers() {
        const state = this.timedRegistrationState;
        if (!state) {
            return;
        }

        if (state.pendingTimers && state.pendingTimers.size > 0) {
            for (const timerId of state.pendingTimers.keys()) {
                clearTimeout(timerId);
            }
            state.pendingTimers.clear();
        }

        this._clearTimedRegistrationCountdownReporter(state);
    },

    _isTimedRegistrationSessionActive() {
        const state = this.timedRegistrationState;
        return !!(state && state.active && !state.stopRequested);
    },

    _emitRegistrationCycleStatus(text, extra = {}) {
        if (this.mainWindow && text) {
            this.mainWindow.webContents.send('registration-cycle-status', {
                text,
                ...extra
            });
        }
    },

    _createTimedRegistrationState(config = {}) {
        const totalCount = Math.max(1, parseInt(config.timedRegistrationCount, 10) || 1);
        const cycleLimit = Math.max(1, parseInt(config.timedRegistrationCycleCount, 10) || 1);
        const delayMs = Math.max(0, parseInt(config.timedRegistrationDelayMs, 10) || 0);
        const startMode = config.timedRegistrationStartMode === 'delayed' ? 'delayed' : 'immediate';
        const state = {
            active: true,
            stopRequested: false,
            sessionId: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            totalCount,
            cycleLimit,
            delayMs,
            startMode,
            currentCycleIndex: 1,
            completedCycleCount: 0,
            startedCount: 0,
            completedCount: 0,
            cycleStartedCount: 0,
            cycleCompletedCount: 0,
            startingCount: 0,
            pendingTimers: new Map(),
            reportTimer: null,
            nextLaunchAt: null
        };

        this.timedRegistrationState = state;
        this.timedRegistrationSessionId = state.sessionId;
        this.isTimedRunning = true;
        return state;
    },

    _finalizeTimedRegistrationSession(reason = '定时注册已完成') {
        const state = this.timedRegistrationState;
        if (!state) {
            return false;
        }

        const {
            batchSize,
            cycleLimit,
            totalPlannedCount
        } = this._getTimedRegistrationPlanTotals(state);
        const currentCycleIndex = Math.max(
            1,
            Math.min(
                parseInt(state.currentCycleIndex, 10) || (parseInt(state.completedCycleCount, 10) || 0) + 1,
                cycleLimit
            )
        );
        const finalPayload = this._buildTimedRegistrationProgressPayload(state, {
            completed: true,
            stage: 'completed',
            statusText: '已完成',
            message: `${reason}，第 ${currentCycleIndex}/${cycleLimit} 轮已完成，共完成 ${Math.max(0, state.completedCount || 0)}/${totalPlannedCount}（单轮 ${batchSize} 个，最多 ${cycleLimit} 轮）`
        });

        state.active = false;
        state.stopRequested = false;
        this._clearTimedRegistrationTimers();
        this.timedRegistrationState = null;
        this.timedRegistrationSessionId = null;
        this.isTimedRunning = false;

        if (finalPayload) {
            this._emitRegistrationCycleStatus(finalPayload.message, finalPayload);
        } else {
            this._emitRegistrationCycleStatus(reason, {
                mode: 'timed',
                completed: true
            });
        }

        if (this.mainWindow) {
            this.mainWindow.webContents.send('all-tasks-finished');
        }

        return true;
    },

    async _launchTimedRegistrationCycle(state = this.timedRegistrationState, options = {}) {
        if (this.registrationStopRequested || !state || !state.active || state.stopRequested) {
            return false;
        }

        const {
            batchSize,
            cycleLimit,
            totalPlannedCount
        } = this._getTimedRegistrationPlanTotals(state);
        const normalizedCycleIndex = Math.max(
            1,
            Math.min(
                parseInt(options.cycleIndex, 10) || (parseInt(state.completedCycleCount, 10) || 0) + 1,
                cycleLimit
            )
        );

        state.currentCycleIndex = normalizedCycleIndex;
        state.cycleStartedCount = 0;
        state.cycleCompletedCount = 0;
        state.startingCount = 0;
        this._clearTimedRegistrationCountdownReporter(state);

        const cycleLabel = this._getTimedRegistrationCycleLabel(state, normalizedCycleIndex);
        const initialMessage = options.message || `${cycleLabel}开始，本轮 ${batchSize} 个，累计计划 ${totalPlannedCount} 个`;

        this._emitTimedRegistrationProgress(state, {
            statusText: options.statusText || '执行中',
            message: initialMessage,
            stage: options.stage || 'running',
            taskNumber: cycleLabel
        });

        const initialLaunchCount = Math.min(this.concurrentCount, batchSize);
        for (let i = 0; i < initialLaunchCount; i++) {
            if (this.registrationStopRequested || !state.active || state.stopRequested || this.timedRegistrationState !== state) {
                break;
            }

            const launched = await this._launchTimedRegistrationTask(options.trigger || 'timed-cycle');
            if (!launched) {
                break;
            }
        }

        return true;
    },

    _scheduleTimedRegistrationCycleStart(state = this.timedRegistrationState, launchCycleIndex = 1, delayMs = 0, options = {}) {
        if (!state || !state.active || state.stopRequested || this.registrationStopRequested) {
            return false;
        }

        const {
            batchSize,
            cycleLimit,
            totalPlannedCount
        } = this._getTimedRegistrationPlanTotals(state);
        const normalizedLaunchCycleIndex = Math.max(
            1,
            Math.min(parseInt(launchCycleIndex, 10) || 1, cycleLimit)
        );
        const normalizedDelayMs = Math.max(0, parseInt(delayMs, 10) || 0);
        const displayCycleIndex = Math.max(
            0,
            Math.min(
                parseInt(options.displayCycleIndex, 10) || (normalizedLaunchCycleIndex > 1 ? normalizedLaunchCycleIndex - 1 : 0),
                cycleLimit
            )
        );

        if (state.pendingTimers && state.pendingTimers.size > 0) {
            for (const pendingTimerId of state.pendingTimers.keys()) {
                clearTimeout(pendingTimerId);
            }
            state.pendingTimers.clear();
        }

        const launchCycle = async (timerId = null) => {
            if (timerId && state.pendingTimers) {
                state.pendingTimers.delete(timerId);
            }

            if (this.timedRegistrationState !== state || state.sessionId !== this.timedRegistrationSessionId) {
                this._clearTimedRegistrationCountdownReporter(state);
                return false;
            }

            if (!state.active || state.stopRequested || this.registrationStopRequested) {
                this._clearTimedRegistrationCountdownReporter(state);
                return false;
            }

            state.completedCycleCount = Math.max(0, Math.min(normalizedLaunchCycleIndex - 1, Math.max(0, cycleLimit - 1)));
            return this._launchTimedRegistrationCycle(state, {
                cycleIndex: normalizedLaunchCycleIndex,
                trigger: options.trigger || (normalizedLaunchCycleIndex === 1 ? 'timed-start' : 'timed-delay')
            });
        };

        if (normalizedDelayMs === 0) {
            return launchCycle();
        }

        const nextLaunchAt = Date.now() + normalizedDelayMs;
        const timerId = setTimeout(() => {
            launchCycle(timerId).catch(error => {
                this.logger.error(`启动定时注册轮次失败: ${error.message}`);
            });
        }, normalizedDelayMs);

        if (!state.pendingTimers) {
            state.pendingTimers = new Map();
        }
        state.pendingTimers.set(timerId, nextLaunchAt);
        state.nextLaunchAt = nextLaunchAt;

        const isInitialStart = displayCycleIndex <= 0 && normalizedLaunchCycleIndex === 1 && state.completedCount === 0 && state.cycleCompletedCount === 0 && state.completedCycleCount === 0;
        const cycleLabel = displayCycleIndex > 0
            ? this._getTimedRegistrationCycleLabel(state, displayCycleIndex)
            : '首轮';
        const message = options.message || (
            isInitialStart
                ? `准备开始定时注册批次，共 ${cycleLimit} 轮，每轮 ${batchSize} 个，首轮将在 ${this._formatTimedRegistrationDuration(normalizedDelayMs)} 后开始`
                : `${cycleLabel}已完成，下一轮将在 ${this._formatTimedRegistrationDuration(normalizedDelayMs)} 后开始，累计计划 ${totalPlannedCount} 个`
        );

        this._emitTimedRegistrationProgress(state, {
            statusText: options.statusText || (isInitialStart ? '等待开始' : '等待下一轮'),
            message,
            stage: 'waiting',
            taskNumber: isInitialStart ? this._getTimedRegistrationCycleLabel(state, 1) : cycleLabel,
            nextLaunchAt
        });

        this._syncTimedRegistrationCountdownReporter(state);
        return true;
    },

    async _launchTimedRegistrationTask(trigger = 'timed-delay') {
        const state = this.timedRegistrationState;
        if (this.registrationStopRequested || !state || !state.active || state.stopRequested) {
            return false;
        }

        const {
            batchSize,
            totalPlannedCount
        } = this._getTimedRegistrationPlanTotals(state);

        if (state.cycleStartedCount + state.startingCount >= batchSize) {
            return false;
        }

        if (this.runningTasks.size + state.startingCount >= this.concurrentCount) {
            return false;
        }

        state.startingCount += 1;

        try {
            const startResult = await this.startSingleRegistrationTask({
                taskLabel: this._getTimedRegistrationTaskLabel()
            });

            if (state.stopRequested || !state.active || this.timedRegistrationState !== state) {
                if (startResult && startResult.taskId && this.runningTasks.has(startResult.taskId)) {
                    const launchedTask = this.runningTasks.get(startResult.taskId);
                    if (launchedTask && typeof launchedTask.stop === 'function') {
                        launchedTask.stop('定时注册已停止');
                    }
                }
                return false;
            }

            if (!startResult || startResult.success !== true) {
                const errorText = startResult && startResult.error ? startResult.error : '未知错误';
                this.logger.error(`定时注册启动下一次任务失败: ${errorText}`);
                return false;
            }

            state.startedCount += 1;
            state.cycleStartedCount += 1;
            const remainingToLaunch = Math.max(0, batchSize - state.cycleStartedCount - state.startingCount);
            const currentCycleIndex = Math.max(
                1,
                Math.min(
                    parseInt(state.currentCycleIndex, 10) || (parseInt(state.completedCycleCount, 10) || 0) + 1,
                    Math.max(1, parseInt(state.cycleLimit, 10) || 1)
                )
            );
            const statusText = remainingToLaunch > 0
                ? `${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}进行中... 已启动 ${state.cycleStartedCount}/${batchSize} 个，剩余 ${remainingToLaunch} 个`
                : `${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}已启动最后一个，本轮共 ${batchSize} 个`;

            this._emitTimedRegistrationProgress(state, {
                statusText: '执行中',
                message: statusText,
                trigger
            });

            this.logger.info(statusText);
            return true;
        } catch (error) {
            this.logger.error(`定时注册启动下一次任务异常: ${error.message}`);
            return false;
        } finally {
            state.startingCount = Math.max(0, state.startingCount - 1);
        }
    },

    _scheduleTimedRegistrationContinuation(taskId, result = {}) {
        const state = this.timedRegistrationState;
        if (!state || !state.active || state.stopRequested) {
            return false;
        }

        const {
            cycleLimit
        } = this._getTimedRegistrationPlanTotals(state);
        const currentCycleIndex = Math.max(
            1,
            Math.min(
                parseInt(state.currentCycleIndex, 10) || (parseInt(state.completedCycleCount, 10) || 0) + 1,
                cycleLimit
            )
        );

        if (currentCycleIndex >= cycleLimit) {
            if (this.runningTasks.size === 0 && state.startingCount === 0) {
                this._finalizeTimedRegistrationSession('定时注册已完成');
            }
            return false;
        }

        const delayMs = Math.max(0, state.delayMs || 0);
        const nextCycleIndex = currentCycleIndex + 1;
        const schedulePayload = this._buildTimedRegistrationProgressPayload(state, {
            statusText: delayMs > 0 ? '等待下一轮' : '执行中',
            message: delayMs > 0
                ? `${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}已完成，下一轮将在 ${this._formatTimedRegistrationDuration(delayMs)} 后开始`
                : `${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}已完成，立即开始下一轮`,
            stage: delayMs > 0 ? 'waiting' : 'running'
        });

        if (schedulePayload) {
            this.logger.info(schedulePayload.message);
            this._emitRegistrationCycleStatus(schedulePayload.message, schedulePayload);
        }

        return this._scheduleTimedRegistrationCycleStart(state, nextCycleIndex, delayMs, {
            displayCycleIndex: currentCycleIndex,
            trigger: 'timed-delay',
            statusText: delayMs > 0 ? '等待下一轮' : '执行中',
            message: schedulePayload ? schedulePayload.message : undefined
        });
    },

    async _handleTimedRegistrationTaskCompletion(taskId, result = {}, options = {}) {
        const state = this.timedRegistrationState;
        if (!state || !state.active || state.stopRequested) {
            return false;
        }

        const {
            batchSize,
            cycleLimit,
            totalPlannedCount
        } = this._getTimedRegistrationPlanTotals(state);
        const currentCycleIndex = Math.max(
            1,
            Math.min(
                parseInt(state.currentCycleIndex, 10) || (parseInt(state.completedCycleCount, 10) || 0) + 1,
                cycleLimit
            )
        );

        state.completedCount = Math.min(totalPlannedCount, (state.completedCount || 0) + 1);
        state.cycleCompletedCount = Math.min(batchSize, (state.cycleCompletedCount || 0) + 1);

        const remainingToLaunch = Math.max(0, batchSize - state.cycleStartedCount - state.startingCount);
        if (remainingToLaunch > 0 && !this.registrationStopRequested) {
            await this._launchTimedRegistrationTask(options.trigger || 'timed-cycle');
        }

        const waitingCount = this.runningTasks.size + state.startingCount;
        if (state.cycleCompletedCount >= batchSize) {
            if (waitingCount <= 0) {
                if (currentCycleIndex >= cycleLimit) {
                    this._finalizeTimedRegistrationSession('定时注册已完成');
                    return true;
                }

                return this._scheduleTimedRegistrationContinuation(taskId, result);
            }

            this._emitTimedRegistrationProgress(state, {
                waitingCount,
                statusText: '等待当前任务结束',
                message: `${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}已完成，等待 ${waitingCount} 个任务结束`,
                stage: 'finishing'
            });
            return true;
        }

        this._emitTimedRegistrationProgress(state, {
            waitingCount,
            statusText: waitingCount > 0 ? '执行中' : '等待任务启动',
            message: `${this._getTimedRegistrationCycleLabel(state, currentCycleIndex)}进行中，已完成 ${state.cycleCompletedCount}/${batchSize}，累计已完成 ${state.completedCount}/${totalPlannedCount}`,
            stage: 'running'
        });
        return true;
    }
};
