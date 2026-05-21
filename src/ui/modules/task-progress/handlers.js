module.exports = function createTaskProgressHandlers(deps) {
    const {
        elements,
        state,
        utils,
        logger,
        activateMiddleTab,
        addTaskProgress,
        appendTaskHistory,
        clearTaskHistory,
        openTaskHistoryDialog,
        updateTaskProgress,
        finishTaskProgress,
        setTaskHistoryCollapsed,
        toggleTaskHistory
    } = deps;

    function focusTaskProgressTab() {
        if (typeof activateMiddleTab === 'function') {
            activateMiddleTab('middle-tab-progress');
        }
    }

    function bindTaskHistoryToggle() {
        if (elements.taskHistoryToggleBtn && typeof toggleTaskHistory === 'function') {
            elements.taskHistoryToggleBtn.addEventListener('click', toggleTaskHistory);
            if (typeof setTaskHistoryCollapsed === 'function') {
                setTaskHistoryCollapsed(false);
            }
        }
        if (elements.taskHistoryClearBtn && typeof clearTaskHistory === 'function') {
            elements.taskHistoryClearBtn.addEventListener('click', clearTaskHistory);
        }
        if (elements.taskHistoryMoreBtn && typeof openTaskHistoryDialog === 'function') {
            elements.taskHistoryMoreBtn.addEventListener('click', openTaskHistoryDialog);
        }
    }

    function handleTaskStarted(taskId, taskNumber, taskLabel, options = {}) {
        focusTaskProgressTab();
        if (typeof addTaskProgress === 'function') {
            addTaskProgress(taskId, taskNumber, taskLabel || '任务', null, options.stopButtonText || '⏹ 停止', {
                ...options,
                statusText: options.statusText || '进行中',
                statusKey: options.statusKey || 'running'
            });
        }
    }

    function handleTaskProgress(taskId, progress, message, options = {}) {
        focusTaskProgressTab();
        if (typeof updateTaskProgress === 'function') {
            updateTaskProgress(taskId, progress, message, options);
        }
    }

    function handleTaskFinished(taskId, error = '', isFailure = false, options = {}) {
        if (typeof finishTaskProgress !== 'function') {
            return;
        }

        const statusText = options.statusText || (isFailure ? '失败' : '已完成');
        const statusKey = options.statusKey || (isFailure ? 'error' : 'success');
        const shouldArchiveAsGroupParent = options.isGroupParent === true
            || options.enableChildren === true
            || /batch|group|summary/i.test(String(options.taskType || ''));
        const message = isFailure
            ? (error ? `任务失败: ${error}` : '任务失败')
            : (options.message || '任务已完成');
        finishTaskProgress(taskId, statusText, message, isFailure ? 5000 : 3000, {
            ...options,
            statusKey,
            stopDisabled: true
        });

        if (shouldArchiveAsGroupParent && typeof appendTaskHistory === 'function') {
            appendTaskHistory(taskId, options.taskLabel || '任务', options.taskNumber || '', statusText, isFailure ? 99 : 100, message, {
                ...options,
                statusKey,
                isGroupParent: true,
                maxHistoryEntries: options.maxHistoryEntries || 30
            });
        }
    }

    function handleTimedRegistrationCompleted(payload = {}) {
        if (!payload.completed) {
            return;
        }

        state.currentTimedRegistrationTaskId = null;
        if (typeof logger?.info === 'function') {
            logger.info(payload.message || payload.text || '定时注册完成');
        }
    }

    function handleHaikaBindingBatchFinished(payload = {}) {
        const taskId = state.currentHaikaBindBatchId;
        const successCount = payload.successCount || 0;
        const failCount = payload.failCount || 0;
        const total = payload.total || 0;
        const stopped = !!payload.stopped;

        state.currentHaikaBindBatchId = null;
        state.currentHaikaBindBatchActive = false;
        state.currentHaikaBindBatchTotal = 0;

        if (elements.haikaBindStartBtn) {
            elements.haikaBindStartBtn.disabled = false;
            elements.haikaBindStartBtn.textContent = '开始绑定';
        }
        if (elements.haikaBindStopBtn) {
            elements.haikaBindStopBtn.disabled = true;
            elements.haikaBindStopBtn.textContent = '停止绑定';
        }

        if (total > 0) {
            const text = stopped
                ? `海卡绑定已停止: 总计 ${total}, 成功 ${successCount}, 失败 ${failCount}`
                : `海卡绑定批量完成: 总计 ${total}, 成功 ${successCount}, 失败 ${failCount}`;
            utils.showMessage(text, stopped ? 'warning' : (failCount === 0 ? 'success' : 'warning'), elements);
        }

        logger.info(`海卡绑定批量完成: 总计 ${total}, 成功 ${successCount}, 失败 ${failCount}`);
    }

    return {
        bindTaskHistoryToggle,
        focusTaskProgressTab,
        handleHaikaBindingBatchFinished,
        handleTaskFinished,
        handleTaskProgress,
        handleTaskStarted,
        handleTimedRegistrationCompleted
    };
};
