/**
 * 渲染层进度管理模块。
 *
 * 负责任务进度条、停止按钮和任务计数的通用渲染逻辑。
 */
module.exports = function createRendererProgress(deps) {
    const { elements, ipcRenderer } = deps;
    const state = deps;

    function buildTaskHeaderText(taskLabel = '任务', taskNumber = '') {
        const parts = [];
        if (taskLabel) {
            parts.push(String(taskLabel));
        }
        if (taskNumber !== undefined && taskNumber !== null && String(taskNumber).trim()) {
            parts.push(String(taskNumber).trim());
        }
        return parts.join(' ');
    }

    function normalizeTaskType(taskType = '') {
        return String(taskType || '').trim().toLowerCase();
    }

    function isGroupedTaskType(taskType = '') {
        const normalized = normalizeTaskType(taskType);
        return normalized.includes('batch') || normalized.includes('group') || normalized.includes('summary');
    }

    function getTaskProgressElement(taskId) {
        if (!taskId) {
            return null;
        }

        return state.taskProgressBars.get(taskId) || document.getElementById(`task-${taskId}`) || null;
    }

    function getTaskProgressParentContainer(progressElement) {
        if (!progressElement) {
            return elements.progressList || null;
        }

        const parentTaskId = String(progressElement.dataset.parentTaskId || '').trim();
        if (!parentTaskId) {
            return elements.progressList || null;
        }

        const parentElement = getTaskProgressElement(parentTaskId);
        if (!parentElement) {
            return elements.progressList || null;
        }

        return getTaskProgressChildrenContainer(parentElement);
    }

    function getTaskProgressChildrenContainer(progressElement, createIfMissing = true) {
        if (!progressElement) {
            return null;
        }

        let container = progressElement.querySelector(':scope > .task-progress-children');
        if (!container && createIfMissing) {
            container = document.createElement('div');
            container.className = 'task-progress-children';
            progressElement.appendChild(container);
        }
        return container;
    }

    function setTaskProgressCollapsed(progressElement, collapsed) {
        if (!progressElement) {
            return;
        }

        const childrenContainer = progressElement.querySelector(':scope > .task-progress-children');
        const toggleBtn = progressElement.querySelector('.task-collapse-btn');
        const isCollapsed = collapsed === true;

        progressElement.dataset.collapsed = isCollapsed ? 'true' : 'false';
        progressElement.classList.toggle('task-progress--collapsed', isCollapsed);

        if (childrenContainer) {
            childrenContainer.hidden = isCollapsed;
        }
        if (toggleBtn) {
            toggleBtn.textContent = isCollapsed ? '展开' : '折叠';
            toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
        }
    }

    function ensureTaskProgressLayout(progressElement, options = {}) {
        if (!progressElement) {
            return;
        }

        const allowChildren = options.enableChildren === true || options.isGroupParent === true || isGroupedTaskType(progressElement.dataset.taskType || options.taskType || '');
        const childContainer = allowChildren ? getTaskProgressChildrenContainer(progressElement, true) : null;
        const toggleBtn = progressElement.querySelector('.task-collapse-btn');

        if (toggleBtn) {
            toggleBtn.hidden = !allowChildren;
            toggleBtn.disabled = !allowChildren;
            if (allowChildren && progressElement.dataset.collapsed !== 'true') {
                toggleBtn.textContent = '折叠';
                toggleBtn.setAttribute('aria-expanded', 'true');
            }
        }

        if (childContainer && progressElement.dataset.collapsed === 'true') {
            childContainer.hidden = true;
        }
    }

    function moveTaskProgressToContainer(progressElement, container) {
        if (!progressElement || !container || progressElement.parentElement === container) {
            return;
        }

        container.appendChild(progressElement);
    }

    function cleanupNestedTaskProgress(progressElement) {
        if (!progressElement) {
            return;
        }

        const children = progressElement.querySelectorAll(':scope > .task-progress-children [data-task-id]');
        children.forEach((childElement) => {
            const childTaskId = String(childElement.dataset.taskId || '').trim();
            if (!childTaskId) {
                return;
            }

            clearTaskProgressCleanup(childTaskId);
            state.taskProgressBars.delete(childTaskId);
        });
    }

    function getTaskHistoryElement(taskId, container = null) {
        if (!taskId) {
            return null;
        }

        const escapedTaskId = String(taskId).replace(/"/g, '\\"');
        const selector = `[data-task-id="${escapedTaskId}"]`;
        if (container) {
            return container.querySelector(selector);
        }

        const previewList = getTaskHistoryList();
        const dialogList = elements.taskHistoryDialogList || null;
        return previewList?.querySelector(selector) || dialogList?.querySelector(selector) || null;
    }

    function getTaskHistoryList() {
        return elements.taskHistoryList || null;
    }

    function ensureTaskHistoryArchiveState() {
        if (!Array.isArray(state.taskHistoryArchive)) {
            state.taskHistoryArchive = [];
        }
        if (!(state.taskHistoryArchiveMap instanceof Map)) {
            state.taskHistoryArchiveMap = new Map();
        }
        if (!(state.taskHistoryExpandedIds instanceof Set)) {
            state.taskHistoryExpandedIds = new Set();
        }
        if (!Number.isFinite(Number(state.taskHistorySequence))) {
            state.taskHistorySequence = 0;
        }
        return state.taskHistoryArchive;
    }

    function getTaskHistoryArchiveEntries() {
        const archive = ensureTaskHistoryArchiveState();
        const archiveMap = state.taskHistoryArchiveMap;
        return archive
            .map((taskId) => archiveMap.get(taskId))
            .filter(Boolean)
            .sort((left, right) => {
                const leftOrder = Number(left?.historyOrder) || 0;
                const rightOrder = Number(right?.historyOrder) || 0;
                return rightOrder - leftOrder;
            });
    }

    function hasTaskHistoryRecord(taskId) {
        const key = String(taskId || '').trim();
        if (!key) {
            return false;
        }
        ensureTaskHistoryArchiveState();
        return state.taskHistoryArchiveMap.has(key);
    }

    function setTaskHistoryCollapsed(collapsed) {
        const panel = elements.taskHistoryPanel;
        const body = elements.taskHistoryBody;
        const button = elements.taskHistoryToggleBtn;

        if (!panel || !body || !button) {
            return;
        }

        const isCollapsed = collapsed === true;
        panel.classList.toggle('is-collapsed', isCollapsed);
        body.style.display = isCollapsed ? 'none' : '';
        button.textContent = isCollapsed ? '展开' : '折叠';
        button.setAttribute('aria-expanded', String(!isCollapsed));
    }

    function toggleTaskHistory() {
        const panel = elements.taskHistoryPanel;
        if (!panel) {
            return;
        }
        setTaskHistoryCollapsed(!panel.classList.contains('is-collapsed'));
    }

    function setTaskHistoryItemExpanded(historyItem, expanded) {
        if (!historyItem) {
            return;
        }

        const details = historyItem.querySelector('.task-history-details');
        const detailBtn = historyItem.querySelector('.task-history-detail-btn');
        const isExpanded = expanded === true;

        historyItem.dataset.expanded = isExpanded ? 'true' : 'false';
        if (details) {
            details.hidden = !isExpanded;
        }
        if (detailBtn) {
            detailBtn.textContent = isExpanded ? '收起' : '详情';
            detailBtn.setAttribute('aria-expanded', String(isExpanded));
        }
    }

    function isTaskHistoryExpanded(taskId) {
        const key = String(taskId || '').trim();
        if (!key) {
            return false;
        }
        ensureTaskHistoryArchiveState();
        return state.taskHistoryExpandedIds.has(key);
    }

    function setTaskHistoryRecordExpanded(taskId, expanded) {
        const key = String(taskId || '').trim();
        if (!key) {
            return;
        }

        ensureTaskHistoryArchiveState();
        if (expanded === true) {
            state.taskHistoryExpandedIds.add(key);
        } else {
            state.taskHistoryExpandedIds.delete(key);
        }

        [elements.taskHistoryList, elements.taskHistoryDialogList].forEach((container) => {
            const historyItem = getTaskHistoryElement(key, container || null);
            setTaskHistoryItemExpanded(historyItem, expanded);
        });
    }

    function bindTaskHistoryDetailToggle(historyItem) {
        if (!historyItem || historyItem.dataset.detailBound === 'true') {
            return;
        }

        const toggleDetails = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const taskId = String(historyItem.dataset.taskId || '').trim();
            if (!taskId) {
                return;
            }
            setTaskHistoryRecordExpanded(taskId, !isTaskHistoryExpanded(taskId));
        };

        const detailBtn = historyItem.querySelector('.task-history-detail-btn');
        if (detailBtn) {
            detailBtn.addEventListener('click', toggleDetails);
        }

        historyItem.addEventListener('click', (event) => {
            if (event.target.closest('button')) {
                return;
            }
            toggleDetails(event);
        });
        historyItem.dataset.detailBound = 'true';
    }

    function buildHistoryItemClassName(statusKey = 'neutral', isChild = false, isGroupParent = false) {
        const baseStatus = normalizeTaskStatusKey(statusKey);
        return [
            'task-history-item',
            `task-history-item--${baseStatus}`,
            isChild ? 'task-history-item--child' : '',
            isGroupParent ? 'task-history-item--group' : ''
        ].filter(Boolean).join(' ');
    }

    function normalizeTaskHistoryRecord(taskId, taskLabel, taskNumber, statusText, progress, message, options = {}) {
        const normalizedTaskId = String(taskId || '').trim();
        const parentTaskId = String(options.parentTaskId || '').trim();
        const parentTaskLabel = String(options.parentTaskLabel || '').trim();
        const taskType = String(options.taskType || 'task').trim() || 'task';
        const normalizedStatus = String(statusText || '').trim() || '已完成';
        const progressValue = Number.isFinite(Number(progress)) ? Math.max(0, Math.min(100, Number(progress))) : 0;

        return {
            taskId: normalizedTaskId,
            taskLabel: taskLabel !== undefined && taskLabel !== null ? String(taskLabel) : '任务',
            taskNumber: taskNumber !== undefined && taskNumber !== null ? String(taskNumber) : '',
            statusText: normalizedStatus,
            statusKey: normalizeTaskStatusKey(options.statusKey || normalizedStatus),
            progress: progressValue,
            message: String(message || ''),
            timeText: options.timeText || new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            parentTaskId,
            parentTaskLabel,
            taskType,
            isChild: !!parentTaskId,
            isGroupParent: options.isGroupParent === true || options.enableChildren === true || isGroupedTaskType(taskType),
            className: String(options.className || '').trim(),
            showStopButton: options.showStopButton !== false,
            rawOptions: { ...options }
        };
    }

    function renderTaskHistoryItem(historyItem, record) {
        if (!historyItem || !record) {
            return;
        }

        const titleText = buildTaskHeaderText(record.taskLabel, record.taskNumber);
        const relatedParts = [];
        if (record.parentTaskLabel) {
            relatedParts.push(`关联任务：${record.parentTaskLabel}`);
        } else if (record.parentTaskId) {
            relatedParts.push(`父任务ID：${record.parentTaskId}`);
        }
        if (record.taskType) {
            relatedParts.push(`类型：${record.taskType}`);
        }
        if (record.taskId) {
            relatedParts.push(`任务ID：${record.taskId}`);
        }

        historyItem.dataset.taskId = record.taskId;
        historyItem.dataset.taskType = record.taskType;
        if (record.parentTaskId) {
            historyItem.dataset.parentTaskId = record.parentTaskId;
        }
        if (record.parentTaskLabel) {
            historyItem.dataset.parentTaskLabel = record.parentTaskLabel;
        }
        historyItem.dataset.timeText = record.timeText;
        historyItem.dataset.lastProgress = String(record.progress);
        historyItem.dataset.lastStatusText = record.statusText;
        historyItem.dataset.lastMessage = record.message;
        historyItem.dataset.statusKey = record.statusKey;
        historyItem.dataset.taskLabel = record.taskLabel;
        historyItem.dataset.taskNumber = record.taskNumber;

        const nameEl = historyItem.querySelector('.task-history-name');
        const statusEl = historyItem.querySelector('.task-history-status');
        const metaTime = historyItem.querySelector('.task-history-meta__time');
        const metaProgress = historyItem.querySelector('.task-history-meta__progress');
        const messageEl = historyItem.querySelector('.task-history-message');
        const relatedEl = historyItem.querySelector('.task-history-related');

        if (nameEl) {
            nameEl.textContent = titleText;
        }
        if (statusEl) {
            statusEl.textContent = record.statusText;
        }
        if (metaTime) {
            metaTime.textContent = record.timeText;
        }
        if (metaProgress) {
            metaProgress.textContent = `进度 ${record.progress}%`;
        }
        if (messageEl) {
            messageEl.textContent = record.message || '无详细信息';
        }
        if (relatedEl) {
            relatedEl.textContent = relatedParts.join(' · ');
            relatedEl.hidden = relatedParts.length === 0;
        }

        historyItem.className = [
            buildHistoryItemClassName(record.statusKey, record.isChild, record.isGroupParent),
            record.className
        ].filter(Boolean).join(' ');
        setTaskHistoryItemExpanded(historyItem, isTaskHistoryExpanded(record.taskId));
        bindTaskHistoryDetailToggle(historyItem);
    }

    function createTaskHistoryItemElement(record) {
        const historyItem = document.createElement('div');
        historyItem.innerHTML = `
            <div class="task-history-item__header">
                <div class="task-history-item__header-main">
                    <span class="task-history-name"></span>
                    <span class="task-history-status"></span>
                </div>
                <div class="task-history-item__header-actions">
                    <button class="task-history-detail-btn" type="button" aria-expanded="false">详情</button>
                </div>
            </div>
            <div class="task-history-details" hidden>
                <div class="task-history-meta">
                    <span class="task-history-meta__time"></span>
                    <span class="task-history-meta__progress"></span>
                </div>
                <div class="task-history-message"></div>
                <div class="task-history-related"></div>
            </div>
        `;
        renderTaskHistoryItem(historyItem, record);
        return historyItem;
    }

    function renderTaskHistoryContainer(container, records, options = {}) {
        if (!container) {
            return;
        }

        container.innerHTML = '';
        const historyRecords = Array.isArray(records) ? records : [];
        if (historyRecords.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'task-history-empty';
            empty.textContent = options.emptyText || '暂无历史记录';
            container.appendChild(empty);
            return;
        }

        historyRecords.forEach((record) => {
            container.appendChild(createTaskHistoryItemElement(record));
        });
    }

    function updateTaskHistoryControls() {
        const archiveLength = getTaskHistoryArchiveEntries().length;
        if (elements.taskHistoryClearBtn) {
            elements.taskHistoryClearBtn.disabled = archiveLength === 0;
        }
        if (elements.taskHistoryMoreBtn) {
            elements.taskHistoryMoreBtn.disabled = archiveLength === 0;
        }
    }

    function syncTaskHistoryViews() {
        const archiveEntries = getTaskHistoryArchiveEntries();
        renderTaskHistoryContainer(elements.taskHistoryList, archiveEntries.slice(0, 3), {
            emptyText: '暂无历史记录'
        });
        renderTaskHistoryContainer(elements.taskHistoryDialogList, archiveEntries, {
            emptyText: '暂无历史记录'
        });
        updateTaskHistoryControls();
    }

    function bindTaskHistoryDialogControls() {
        if (state.taskHistoryDialogBound === true) {
            return;
        }

        const dialog = elements.taskHistoryDialog;
        const scheduleFrame = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (callback) => setTimeout(callback, 0);
        const closeDialog = () => {
            if (!dialog) {
                return;
            }
            dialog.classList.remove('show');
            dialog.classList.add('hide');
            setTimeout(() => {
                if (dialog.classList.contains('hide')) {
                    dialog.style.display = 'none';
                    dialog.classList.remove('hide');
                }
            }, 220);
        };

        const openDialog = () => {
            if (!dialog) {
                return;
            }
            dialog.style.display = 'flex';
            dialog.classList.remove('hide');
            scheduleFrame(() => dialog.classList.add('show'));
        };

        if (elements.taskHistoryDialogCloseBtn) {
            elements.taskHistoryDialogCloseBtn.addEventListener('click', closeDialog);
        }
        if (elements.taskHistoryDialogCloseBtn2) {
            elements.taskHistoryDialogCloseBtn2.addEventListener('click', closeDialog);
        }
        if (dialog) {
            dialog.addEventListener('click', (event) => {
                if (event.target === dialog) {
                    closeDialog();
                }
            });
        }

        state.taskHistoryDialogBound = true;
        state.taskHistoryDialogOpen = openDialog;
        state.taskHistoryDialogClose = closeDialog;
    }

    function openTaskHistoryDialog() {
        bindTaskHistoryDialogControls();
        syncTaskHistoryViews();
        if (typeof state.taskHistoryDialogOpen === 'function') {
            state.taskHistoryDialogOpen();
        } else if (elements.taskHistoryDialog) {
            elements.taskHistoryDialog.style.display = 'flex';
            const scheduleFrame = typeof requestAnimationFrame === 'function'
                ? requestAnimationFrame
                : (callback) => setTimeout(callback, 0);
            scheduleFrame(() => elements.taskHistoryDialog.classList.add('show'));
        }
    }

    function closeTaskHistoryDialog() {
        bindTaskHistoryDialogControls();
        if (typeof state.taskHistoryDialogClose === 'function') {
            state.taskHistoryDialogClose();
        }
    }

    function clearTaskHistory() {
        ensureTaskHistoryArchiveState();
        state.taskHistoryArchive.length = 0;
        state.taskHistoryArchiveMap.clear();
        state.taskHistoryExpandedIds.clear();
        state.taskHistorySequence = 0;
        state.taskHistoryPendingGroups = new Map();
        syncTaskHistoryViews();
        closeTaskHistoryDialog();
    }

    function appendTaskHistory(taskId, taskLabel = '任务', taskNumber = '', statusText = '已完成', progress = 100, message = '', options = {}) {
        const record = normalizeTaskHistoryRecord(taskId, taskLabel, taskNumber, statusText, progress, message, options);
        if (!record.taskId) {
            return null;
        }

        const archive = ensureTaskHistoryArchiveState();
        state.taskHistorySequence += 1;
        record.historyOrder = state.taskHistorySequence;
        record.historyCreatedAt = Date.now();
        const existingIndex = archive.indexOf(record.taskId);
        if (existingIndex >= 0) {
            archive.splice(existingIndex, 1);
        }
        archive.unshift(record.taskId);
        state.taskHistoryArchiveMap.set(record.taskId, record);

        syncTaskHistoryViews();
        return getTaskHistoryElement(record.taskId, elements.taskHistoryList) || getTaskHistoryElement(record.taskId, elements.taskHistoryDialogList);
    }

    function ensureTaskHistoryGroup(taskId, taskLabel = '任务', taskNumber = '', statusText = '进行中', progress = 0, message = '进行中...', options = {}) {
        return appendTaskHistory(taskId, taskLabel, taskNumber, statusText, progress, message, {
            ...options,
            isGroupParent: true
        });
    }

    function getTaskHistoryItem(taskId) {
        return getTaskHistoryElement(taskId);
    }

    function getProgressSnapshot(progressElement) {
        if (!progressElement) {
            return null;
        }

        const progressFill = progressElement.querySelector('.progress-fill');
        const taskMessage = progressElement.querySelector('.task-message');
        const taskStatus = progressElement.querySelector('.task-status');
        const taskName = progressElement.querySelector('.task-name');
        const widthText = progressFill?.style?.width || '';
        const widthValue = Number.parseFloat(widthText);
        const progressValue = Number.isFinite(Number(progressElement.dataset.lastProgress))
            ? Number(progressElement.dataset.lastProgress)
            : (Number.isFinite(widthValue) ? widthValue : 0);

        return {
            taskLabel: progressElement.dataset.taskLabel || taskName?.textContent || '任务',
            taskNumber: progressElement.dataset.taskNumber || '',
            statusText: progressElement.dataset.lastStatusText || taskStatus?.textContent || '进行中',
            progress: progressValue,
            message: progressElement.dataset.lastMessage || taskMessage?.textContent || '无详细信息'
        };
    }

    function normalizeTaskStatusKey(statusKey = '') {
        const normalized = String(statusKey || '').trim().toLowerCase();
        if (!normalized) {
            return 'neutral';
        }
        if (normalized.includes('error') || normalized.includes('fail') || normalized.includes('失败') || normalized.includes('错误')) {
            return 'error';
        }
        if (normalized.includes('warn') || normalized.includes('warning') || normalized.includes('停止') || normalized.includes('已停')) {
            return 'warning';
        }
        if (normalized.includes('success') || normalized.includes('done') || normalized.includes('完成')) {
            return 'success';
        }
        return 'neutral';
    }

    function applyTaskProgressStatus(progressElement, options = {}) {
        if (!progressElement) {
            return 'neutral';
        }

        const statusKey = normalizeTaskStatusKey(options.statusKey || options.statusText || progressElement.dataset.lastStatusText || '');
        progressElement.classList.remove(
            'task-progress--error',
            'task-progress--warning',
            'task-progress--success',
            'task-progress--neutral'
        );
        progressElement.classList.add(`task-progress--${statusKey}`);
        progressElement.dataset.statusKey = statusKey;
        return statusKey;
    }

    function clearTaskProgressCleanup(taskId) {
        if (!state.taskProgressCleanupTimers) {
            state.taskProgressCleanupTimers = new Map();
        }

        const timerId = state.taskProgressCleanupTimers.get(taskId);
        if (timerId) {
            clearTimeout(timerId);
            state.taskProgressCleanupTimers.delete(taskId);
        }
    }

    function scheduleTaskProgressRemoval(taskId, delayMs = 3000) {
        if (!taskId) {
            return;
        }

        clearTaskProgressCleanup(taskId);
        const timerId = setTimeout(() => {
            removeTaskProgress(taskId);
            clearTaskProgressCleanup(taskId);
        }, Math.max(0, Number(delayMs) || 0));

        if (!state.taskProgressCleanupTimers) {
            state.taskProgressCleanupTimers = new Map();
        }
        state.taskProgressCleanupTimers.set(taskId, timerId);
    }

    function addTaskProgress(taskId, taskNumber, taskLabel = '任务', stopHandler = null, stopButtonText = '⏹ 停止', options = {}) {
        if (!elements.progressList) {
            return;
        }

        const parentTaskId = String(options.parentTaskId || '').trim();
        const existingProgressElement = state.taskProgressBars.get(taskId);
        if (existingProgressElement) {
            clearTaskProgressCleanup(taskId);
            updateTaskProgress(taskId, Number.isFinite(Number(options.progress)) ? Number(options.progress) : 0, options.message || '进行中...', {
                taskLabel,
                taskNumber,
                statusText: options.statusText || '进行中',
                stopButtonText,
                stopDisabled: options.stopDisabled,
                parentTaskId,
                parentTaskLabel: options.parentTaskLabel,
                taskType: options.taskType
            });
            return existingProgressElement;
        }

        const progressElement = document.createElement('div');
        progressElement.className = 'task-progress fade-in';
        if (options.className) {
            progressElement.classList.add(...String(options.className).split(/\s+/).filter(Boolean));
        }
        progressElement.id = `task-${taskId}`;
        if (options.taskType) {
            progressElement.dataset.taskType = String(options.taskType);
        }
        if (options.parentTaskLabel) {
            progressElement.dataset.parentTaskLabel = String(options.parentTaskLabel);
        }
        if (parentTaskId) {
            progressElement.dataset.parentTaskId = parentTaskId;
            progressElement.classList.add('task-progress--child');
        }
        const isGroupParent = options.isGroupParent === true || isGroupedTaskType(options.taskType || '') || options.enableChildren === true;
        if (isGroupParent) {
            progressElement.classList.add('task-progress--group');
        }
        applyTaskProgressStatus(progressElement, options);
        if (taskLabel !== undefined && taskLabel !== null) {
            progressElement.dataset.taskLabel = String(taskLabel);
        }
        if (taskNumber !== undefined && taskNumber !== null) {
            progressElement.dataset.taskNumber = String(taskNumber);
        }

        progressElement.innerHTML = `
            <div class="task-progress-header">
                <div class="task-progress-header__main">
                    <span class="task-name">${buildTaskHeaderText(taskLabel, taskNumber)}</span>
                    <span class="task-status">${options.statusText || '初始化中...'}</span>
                </div>
                <div class="task-progress-header__actions">
                    <button class="task-collapse-btn" type="button" title="展开/折叠" hidden>折叠</button>
                    <button class="task-stop-btn" title="停止">⏹ 停止</button>
                </div>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${Number.isFinite(Number(options.progress)) ? Number(options.progress) : 0}%"></div>
            </div>
            <div class="task-message">${options.message || '准备开始...'}</div>
            <div class="task-progress-children" hidden></div>
        `;

        const stopBtn = progressElement.querySelector('.task-stop-btn');
        const collapseBtn = progressElement.querySelector('.task-collapse-btn');
        if (typeof stopHandler === 'function') {
            stopBtn.addEventListener('click', () => stopHandler(taskId, stopBtn, progressElement));
            stopBtn.textContent = stopButtonText;
        } else if (String(taskId).startsWith('haika_bind_batch_') && typeof state.stopHaikaBinding === 'function') {
            stopBtn.addEventListener('click', () => state.stopHaikaBinding());
            stopBtn.textContent = '⏹ 停止批次';
        } else {
            stopBtn.addEventListener('click', () => stopTask(taskId, stopBtn));
        }

        const showStopButton = options.showStopButton !== false && !parentTaskId;
        if (!showStopButton) {
            stopBtn.hidden = true;
        }

        if (collapseBtn) {
            collapseBtn.hidden = !isGroupParent;
            collapseBtn.disabled = !isGroupParent;
            if (isGroupParent) {
                collapseBtn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const collapsed = progressElement.dataset.collapsed === 'true';
                    setTaskProgressCollapsed(progressElement, !collapsed);
                });
                setTaskProgressCollapsed(progressElement, progressElement.dataset.collapsed === 'true');
            }
        }

        ensureTaskProgressLayout(progressElement, options);

        if (options.stopDisabled !== undefined) {
            stopBtn.disabled = !!options.stopDisabled;
        }

        const container = parentTaskId
            ? getTaskProgressParentContainer(progressElement)
            : elements.progressList;
        moveTaskProgressToContainer(progressElement, container || elements.progressList);
        state.taskProgressBars.set(taskId, progressElement);
        clearTaskProgressCleanup(taskId);
        return progressElement;
    }

    function stopTask(taskId, stopBtn) {
        const progressElement = document.getElementById(`task-${taskId}`);
        if (progressElement) {
            const taskMessage = progressElement.querySelector('.task-message');
            stopBtn.disabled = true;
            stopBtn.textContent = '停止中...';
            if (taskMessage) {
                taskMessage.textContent = '正在停止...';
            }
            ipcRenderer.invoke('stop-task', taskId);
        }
    }

    function updateTaskProgress(taskId, progress, message, options = {}) {
        let progressElement = state.taskProgressBars.get(taskId);
        if (!progressElement) {
            addTaskProgress(
                taskId,
                options.taskNumber !== undefined ? options.taskNumber : '',
                options.taskLabel || '任务',
                null,
                options.stopButtonText || '⏹ 停止',
                {
                    className: options.className || '',
                    taskType: options.taskType,
                    statusText: options.statusText || `${Math.max(0, Math.min(100, Number(progress) || 0))}%`,
                    progress: Number.isFinite(Number(progress)) ? Number(progress) : 0,
                    message: message || '进行中...',
                    stopDisabled: options.stopDisabled,
                    parentTaskId: options.parentTaskId,
                    parentTaskLabel: options.parentTaskLabel,
                    showStopButton: options.showStopButton
                }
            );
            progressElement = state.taskProgressBars.get(taskId);
        }

        if (!progressElement) {
            return;
        }

        const progressFill = progressElement.querySelector('.progress-fill');
        const taskMessage = progressElement.querySelector('.task-message');
        const taskStatus = progressElement.querySelector('.task-status');
        const taskName = progressElement.querySelector('.task-name');
        const stopBtn = progressElement.querySelector('.task-stop-btn');

        if (progressFill) {
            progressFill.style.width = `${progress}%`;
        }
        if (taskMessage) {
            taskMessage.textContent = message;
        }
        if (taskStatus) {
            taskStatus.textContent = options.statusText || `${progress}%`;
        }
        if (taskName && (options.taskLabel !== undefined || options.taskNumber !== undefined)) {
            if (options.taskLabel !== undefined) {
                progressElement.dataset.taskLabel = String(options.taskLabel);
            }
            if (options.taskNumber !== undefined) {
                progressElement.dataset.taskNumber = String(options.taskNumber);
            }
            taskName.textContent = buildTaskHeaderText(
                options.taskLabel !== undefined ? options.taskLabel : taskName.textContent,
                options.taskNumber !== undefined ? options.taskNumber : ''
            );
        }
        applyTaskProgressStatus(progressElement, options);
        if (stopBtn) {
            if (options.stopButtonText) {
                stopBtn.textContent = options.stopButtonText;
            }
            if (options.stopDisabled !== undefined) {
                stopBtn.disabled = !!options.stopDisabled;
            }
        }

        if (options.parentTaskId) {
            progressElement.dataset.parentTaskId = String(options.parentTaskId);
            progressElement.classList.add('task-progress--child');
            moveTaskProgressToContainer(progressElement, getTaskProgressParentContainer(progressElement) || elements.progressList);
        }
        if (options.parentTaskLabel !== undefined) {
            progressElement.dataset.parentTaskLabel = String(options.parentTaskLabel);
        }

        ensureTaskProgressLayout(progressElement, options);

        progressElement.dataset.lastProgress = String(Number.isFinite(Number(progress)) ? Number(progress) : 0);
        progressElement.dataset.lastStatusText = String(options.statusText || `${progress}%`);
        progressElement.dataset.lastMessage = String(message || '');
    }

    function finishTaskProgress(taskId, statusText = '已完成', message = '任务已完成', delayMs = 3000, options = {}) {
        if (!taskId) {
            return;
        }

        const progressElement = state.taskProgressBars.get(taskId);
        const snapshot = getProgressSnapshot(progressElement);
        const isFailure = normalizeTaskStatusKey(options.statusKey || statusText) === 'error';
        const currentProgress = Number.isFinite(Number(snapshot?.progress)) ? Number(snapshot.progress) : 0;
        const finalProgress = isFailure
            ? Math.max(0, Math.min(99, Number.isFinite(Number(options.progress)) ? Number(options.progress) : currentProgress))
            : 100;

        updateTaskProgress(taskId, finalProgress, message, {
            ...options,
            statusText,
            statusKey: options.statusKey || statusText,
            stopDisabled: true
        });
        const historyLabel = options.taskLabel || progressElement?.dataset.taskLabel || progressElement?.querySelector('.task-name')?.textContent || '任务';
        const historyNumber = options.taskNumber !== undefined
            ? options.taskNumber
            : (progressElement?.dataset.taskNumber || '');
        const parentTaskId = options.parentTaskId || progressElement?.dataset.parentTaskId || '';
        const parentTaskLabel = options.parentTaskLabel || progressElement?.dataset.parentTaskLabel || '';
        appendTaskHistory(
            taskId,
            historyLabel,
            historyNumber,
            statusText,
            finalProgress,
            message,
            {
                ...options,
                statusKey: options.statusKey || statusText,
                parentTaskId,
                parentTaskLabel,
                maxHistoryEntries: options.maxHistoryEntries || 30
            }
        );
        scheduleTaskProgressRemoval(taskId, delayMs);
    }

    function removeTaskProgress(taskId) {
        clearTaskProgressCleanup(taskId);
        const progressElement = state.taskProgressBars.get(taskId);
        if (progressElement && !hasTaskHistoryRecord(taskId)) {
            if (String(progressElement.dataset.parentTaskId || '').trim()) {
                progressElement.remove();
                state.taskProgressBars.delete(taskId);
                return;
            }
            cleanupNestedTaskProgress(progressElement);
            const snapshot = getProgressSnapshot(progressElement);
            const statusText = String(snapshot?.statusText || '').trim();
            const progressValue = Number.isFinite(Number(snapshot?.progress)) ? Number(snapshot.progress) : 0;
            const shouldArchive = progressValue >= 100
                || /完成|成功|失败|错误|停止|已停|done|error|finished/i.test(statusText);

            if (shouldArchive) {
                appendTaskHistory(
                    taskId,
                    snapshot?.taskLabel || '任务',
                    snapshot?.taskNumber || '',
                    statusText || '已完成',
                    progressValue,
                    snapshot?.message || '任务已完成',
                    {
                        statusKey: /失败|错误|error/i.test(statusText)
                            ? 'error'
                            : /停止|已停|warning/i.test(statusText)
                                ? 'warning'
                                : 'success',
                        parentTaskId: progressElement?.dataset.parentTaskId || '',
                        parentTaskLabel: progressElement?.dataset.parentTaskLabel || '',
                        maxHistoryEntries: 30
                    }
                );
            }
        }
        if (progressElement) {
            progressElement.remove();
            state.taskProgressBars.delete(taskId);
        }
    }

    function updateTaskCount() {
        if (elements.taskCount) {
            elements.taskCount.textContent = `任务: ${state.runningTasks.size}`;
        }
    }

    return {
        addTaskProgress,
        appendTaskHistory,
        clearTaskHistory,
        openTaskHistoryDialog,
        stopTask,
        updateTaskProgress,
        finishTaskProgress,
        setTaskHistoryCollapsed,
        toggleTaskHistory,
        scheduleTaskProgressRemoval,
        removeTaskProgress,
        updateTaskCount
    };
};
