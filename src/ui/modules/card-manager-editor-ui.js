const { ipcRenderer } = require('electron');
const { IPC_CHANNELS } = require('../../core/ipc/channels');
const createCardManagerStepEditor = require('./card-manager-step-editor');

const {
    STEP_EDITOR_TEMPLATE_OPTIONS,
    STEP_EDITOR_PRESETS,
    STEP_EDITOR_TYPE_ACCENT_CLASS_MAP,
    STEP_EDITOR_TEMPLATE_SELECT_ACCENT_CLASS_MAP,
    STEP_EDITOR_DYNAMIC_FIELD_VISIBILITY,
    STEP_EDITOR_FIELDS_MODE,
    stripStepEditorUiState,
    parseStepEditorValue,
    getStepEditorFieldValue,
    escapeCssIdentifier,
    normalizeHasTextSelector,
    normalizeStepEditorSelectorValue,
    normalizeStepEditorSelectorField,
    buildStepEditorExtraEntries,
    normalizeStepEditorFieldsMode,
    getStepEditorTemplate
} = createCardManagerStepEditor();

module.exports = function createCardManagerEditorUi(deps = {}) {
    const {
        getCardModeConfig,
        resolveCardMinCookieSizeInputValue,
        resolveCardPasswordRandomConfig,
        resolveUploadTargetScoreConfig,
        setUploadTargetScoreControlsVisibility,
        DEFAULT_MIN_COOKIE_SIZE_BYTES,
        DEFAULT_UPLOAD_TARGET_SCORE_SCOPE
    } = deps;

    function escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeStepTitle(step, index) {
        const rawName = String(step?.name || '').trim();
        if (rawName) {
            return rawName;
        }

        const rawType = String(step?.type || '').trim();
        if (rawType) {
            return `步骤${index + 1} · ${rawType}`;
        }

        return `步骤${index + 1}`;
    }

    function parseCardSteps(elements) {
        const rawValue = String(elements?.cardStepsTextarea?.value || '').trim();
        if (!rawValue) {
            return [];
        }

        const parsed = JSON.parse(rawValue);
        if (!Array.isArray(parsed)) {
            throw new Error('注册步骤必须是数组格式');
        }

        return parsed;
    }

    function getStepRowState(index, debugState, totalSteps) {
        const currentIndex = Number.isFinite(Number(debugState?.currentStepIndex))
            ? Number(debugState.currentStepIndex)
            : -1;
        const progressValue = Number.isFinite(Number(debugState?.progress))
            ? Math.max(0, Math.min(100, Number(debugState.progress)))
            : 0;
        const isActive = debugState?.active === true || debugState?.paused === true || debugState?.completed === true;
        const isErrorPause = Boolean(debugState?.error) || debugState?.pauseReason === 'error' || /错误暂停/.test(String(debugState?.statusText || ''));
        const isCompleted = debugState?.completed === true;
        const isStopped = !isActive;
        const currentStepIndex = currentIndex >= 0 ? currentIndex : -1;
        const nextStepIndex = currentStepIndex >= 0 ? currentStepIndex + 1 : -1;
        const completedStepIndex = Number.isFinite(Number(debugState?.completedStepIndex))
            ? Number(debugState.completedStepIndex)
            : -1;
        const failedStepError = String(debugState?.failedStepError || debugState?.error || '').trim();

        if (isStopped) {
            return {
                status: '',
                statusText: '',
                progress: 0,
                isCurrent: false,
                isCompleted: false,
                isFailed: false,
                isNext: false
            };
        }

        if (isCompleted) {
            return {
                status: 'success',
                statusText: '已完成',
                progress: 100,
                isCurrent: false,
                isCompleted: true,
                isFailed: false,
                isNext: false
            };
        }

        if (isErrorPause) {
            if (index <= completedStepIndex || (currentStepIndex >= 0 && index < currentStepIndex)) {
                return {
                    status: 'success',
                    statusText: '已完成',
                    progress: 100,
                    isCurrent: false,
                    isCompleted: true,
                    isFailed: false,
                    isNext: false
                };
            }

            const isCurrentErrorStep = currentStepIndex >= 0 && index === currentStepIndex;
            const isFailed = isCurrentErrorStep || (currentStepIndex < 0 && index < totalSteps);
            return {
                status: isFailed ? 'error' : '',
                statusText: isFailed ? (failedStepError || '执行失败') : '',
                progress: isFailed ? 100 : 0,
                isCurrent: isCurrentErrorStep,
                isCompleted: false,
                isFailed,
                isNext: false
            };
        }

        if (currentStepIndex < 0) {
            return {
                status: index === 0 ? 'running' : '',
                statusText: index === 0 ? '等待执行' : '',
                progress: index === 0 ? progressValue : 0,
                isCurrent: index === 0,
                isCompleted: false,
                isFailed: false,
                isNext: false
            };
        }

        if (index <= completedStepIndex || index < currentStepIndex) {
            return {
                status: 'success',
                statusText: '已完成',
                progress: 100,
                isCurrent: false,
                isCompleted: true,
                isFailed: false,
                isNext: false
            };
        }

        if (index === currentStepIndex) {
            if (isErrorPause) {
                return {
                    status: 'error',
                    statusText: failedStepError || '执行失败',
                    progress: 100,
                    isCurrent: true,
                    isCompleted: false,
                    isFailed: true,
                    isNext: false
                };
            }

            if (debugState?.paused === true && completedStepIndex >= index) {
                return {
                    status: 'success',
                    statusText: '已完成',
                    progress: 100,
                    isCurrent: true,
                    isCompleted: true,
                    isFailed: false,
                    isNext: false
                };
            }

            return {
                status: 'running',
                statusText: debugState?.paused === true ? '等待继续' : '执行中',
                progress: debugState?.paused === true ? 0 : progressValue,
                isCurrent: true,
                isCompleted: false,
                isFailed: false,
                isNext: false
            };
        }

        if (index === nextStepIndex) {
            return {
                status: 'next',
                statusText: '下一步',
                progress: 0,
                isCurrent: false,
                isCompleted: false,
                isFailed: false,
                isNext: true
            };
        }

        return {
            status: '',
            statusText: '',
            progress: 0,
            isCurrent: false,
            isCompleted: false,
            isFailed: false,
            isNext: false
        };
    }

    function syncCardDebugRunButton(elements, payload = {}) {
        if (!elements || !elements.debugCardBtn) {
            return;
        }

        const isStopping = payload.stopping === true
            || /停止中|正在停止/.test(String(payload.statusText || payload.message || ''));
        const isActive = payload.active === true
            || payload.paused === true
            || payload.canPause === true
            || payload.canResume === true
            || isStopping;

        elements.debugCardBtn.disabled = isStopping;
        elements.debugCardBtn.textContent = isStopping
            ? '停止中'
            : isActive
                ? '停止调试运行'
            : '调试运行';
    }

    function syncCardDebugModeButtons(elements, payload = {}) {
        if (!elements) {
            return;
        }

        const isPaused = payload.paused === true;
        const isActive = payload.active === true || isPaused || payload.canPause === true || payload.canResume === true;

        if (elements.cardDebugLoopBtn) {
            elements.cardDebugLoopBtn.hidden = false;
            elements.cardDebugLoopBtn.disabled = !isActive;
            elements.cardDebugLoopBtn.textContent = '上一步';
        }
        if (elements.cardDebugPauseBtn) {
            const canToggle = isPaused ? payload.canResume === true : payload.canPause !== false && payload.completed !== true;
            elements.cardDebugPauseBtn.disabled = !canToggle;
            elements.cardDebugPauseBtn.textContent = isPaused ? '继续' : '暂停';
            elements.cardDebugPauseBtn.setAttribute('aria-pressed', isPaused ? 'true' : 'false');
        }
        if (elements.cardDebugStepBtn) {
            elements.cardDebugStepBtn.textContent = '下一步';
            elements.cardDebugStepBtn.disabled = !isActive;
        }
    }

    function resetCardDebugPanel(elements) {
        if (elements.cardDebugStatusText) {
            elements.cardDebugStatusText.textContent = '未开始';
        }
        if (elements.cardDebugProgressText) {
            elements.cardDebugProgressText.textContent = '0%';
        }
        if (elements.cardDebugStepText) {
            elements.cardDebugStepText.textContent = '当前步骤：-';
        }
        if (elements.cardDebugProgressFill) {
            elements.cardDebugProgressFill.style.width = '0%';
        }
        if (elements.cardDebugPauseBtn) {
            elements.cardDebugPauseBtn.disabled = true;
            elements.cardDebugPauseBtn.textContent = '继续';
            elements.cardDebugPauseBtn.setAttribute('aria-pressed', 'false');
        }
        if (elements.cardDebugStepBtn) {
            elements.cardDebugStepBtn.textContent = '下一步';
        }
        if (elements.cardDebugLoopBtn) {
            elements.cardDebugLoopBtn.hidden = false;
            elements.cardDebugLoopBtn.disabled = true;
            elements.cardDebugLoopBtn.textContent = '上一步';
        }
        syncCardDebugModeButtons(elements, { paused: false });
        elements.cardDebugState = null;
        syncCardDebugRunButton(elements, { active: false });
        renderCardStepProgressList(elements, null);
    }

    async function openCardEditorWindow(cardData, cardMode = 'register', extraPayload = {}) {
        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.openCardEditorWindow, {
                cardData,
                cardMode,
                ...(extraPayload && typeof extraPayload === 'object' ? extraPayload : {})
            });
            return result && result.success === true ? result : null;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    function activateCardEditorTab(elements, targetTabId = 'card-dialog-base-tab') {
        if (!elements) {
            return;
        }

        const tabs = [
            {
                button: elements.cardDialogBaseTabBtn,
                content: elements.cardDialogBaseTab,
                tabId: 'card-dialog-base-tab'
            },
            {
                button: elements.cardDialogDebugTabBtn,
                content: elements.cardDialogDebugTab,
                tabId: 'card-dialog-debug-tab'
            },
            {
                button: elements.cardDialogApiServiceTabBtn,
                content: elements.cardDialogApiServiceTab,
                tabId: 'card-dialog-api-service-tab'
            },
            {
                button: elements.cardDialogStepsTabBtn,
                content: elements.cardDialogStepsTab,
                tabId: 'card-right-panel-steps-tab'
            },
            {
                button: elements.cardDialogPopupsTabBtn,
                content: elements.cardDialogPopupsTab,
                tabId: 'card-right-panel-popups-tab'
            }
        ];

        tabs.forEach(({ button, content, tabId }) => {
            const isActive = tabId === targetTabId;
            if (button) {
                button.classList.toggle('active', isActive);
                button.setAttribute('aria-selected', isActive ? 'true' : 'false');
            }
            if (content) {
                content.classList.toggle('active', isActive);
                content.style.display = isActive ? '' : 'none';
            }
        });
    }

    function activateCardDialogTab(elements, targetTabId = 'card-dialog-base-tab') {
        activateCardEditorTab(elements, targetTabId);
    }

    function activateCardDialogRightTab(elements, targetTabId = 'card-right-panel-steps-tab') {
        activateCardEditorTab(elements, targetTabId);
    }

    function updateCardDebugPanel(elements, payload = {}) {
        const progressValue = Number.isFinite(Number(payload.progress))
            ? Math.max(0, Math.min(100, Number(payload.progress)))
            : 0;
        const currentStepName = String(payload.currentStepName || payload.stepName || '').trim() || '-';
        const statusText = String(payload.statusText || payload.message || '调试中').trim();
        const isPaused = payload.paused === true;
        const canPause = payload.canPause !== false && payload.completed !== true;
        const canResume = payload.canResume === true || isPaused;

        if (elements.cardDebugStatusText) {
            elements.cardDebugStatusText.textContent = statusText;
        }
        if (elements.cardDebugProgressText) {
            elements.cardDebugProgressText.textContent = `${progressValue}%`;
        }
        if (elements.cardDebugStepText) {
            elements.cardDebugStepText.textContent = `当前步骤：${currentStepName}`;
        }
        if (elements.cardDebugProgressFill) {
            elements.cardDebugProgressFill.style.width = `${progressValue}%`;
        }
        if (elements.cardDebugPauseBtn) {
            elements.cardDebugPauseBtn.disabled = isPaused ? !canResume : !canPause;
            elements.cardDebugPauseBtn.textContent = isPaused ? '继续' : '暂停';
            elements.cardDebugPauseBtn.setAttribute('aria-pressed', isPaused ? 'true' : 'false');
        }
        syncCardDebugModeButtons(elements, payload);
        elements.cardDebugState = {
            ...(elements.cardDebugState && typeof elements.cardDebugState === 'object' ? elements.cardDebugState : {}),
            ...payload,
            progress: progressValue,
            currentStepName,
            statusText,
            paused: isPaused,
            canPause,
            canResume,
            failedStepError: (payload.failedStepError !== undefined || payload.error !== undefined)
                ? String(payload.failedStepError || payload.error || '').trim()
                : String(elements.cardDebugState?.failedStepError || '').trim(),
            completedStepIndex: Number.isFinite(Number(payload.completedStepIndex))
                ? Number(payload.completedStepIndex)
                : (Number.isFinite(Number(elements.cardDebugState?.completedStepIndex)) ? Number(elements.cardDebugState.completedStepIndex) : -1)
        };
        syncCardDebugRunButton(elements, elements.cardDebugState);
        renderCardStepProgressList(elements, elements.cardDebugState);
    }

    function renderCardStepProgressList(elements, debugState = null) {
        if (!elements?.cardStepProgressList) {
            return;
        }

        const steps = parseCardSteps(elements);
        if (steps.length === 0) {
            elements.cardStepProgressList.innerHTML = `
                <div class="card-step-progress-empty">暂无步骤可展示</div>
            `;
            return;
        }

        const items = steps.map((step, index) => {
            const rowState = getStepRowState(index, debugState, steps.length);
            const stepNumber = index + 1;
            const classes = ['card-step-row'];
            if (rowState.isCurrent) classes.push('is-current');
            if (rowState.isCompleted) classes.push('is-completed');
            if (rowState.isFailed) classes.push('is-failed');
            if (rowState.isNext) classes.push('is-next');
            const title = normalizeStepTitle(step, index);
            const detailParts = [];
            if (step?.type) detailParts.push(String(step.type));
            if (step?.selector) detailParts.push(String(step.selector));
            if (step?.url) detailParts.push(String(step.url));
            const detailText = detailParts.join(' · ');
            const progressWidth = Math.max(0, Math.min(100, Number(rowState.progress) || 0));
            const statusTitle = rowState.statusText || '待执行';

            return `
                <div class="${classes.join(' ')}" data-step-index="${index}">
                    <div class="card-step-row__header">
                        <div class="card-step-row__title">
                            <span class="card-step-row__index">${stepNumber}</span>
                            <span class="card-step-row__name" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
                        </div>
                        <div class="card-step-row__status" title="${escapeHtml(statusTitle)}">${escapeHtml(statusTitle)}</div>
                    </div>
                    ${detailText ? `<div class="card-step-row__detail" title="${escapeHtml(detailText)}">${escapeHtml(detailText)}</div>` : ''}
                    <div class="card-step-row__progress">
                        <div class="card-step-row__progress-fill" style="width: ${progressWidth}%"></div>
                    </div>
                </div>
            `;
        }).join('');

        elements.cardStepProgressList.innerHTML = items;
    }

    function getStepEditorAccentClass(stepType = '') {
        const normalizedType = String(stepType || '').trim();
        return STEP_EDITOR_TYPE_ACCENT_CLASS_MAP[normalizedType] || 'step-card--accent-default';
    }

    function syncStepTemplateSelectAccent(elements) {
        const valueInput = elements?.cardStepTemplateValue;
        const label = elements?.cardStepTemplateLabel;
        const btn = elements?.cardStepTemplateBtn;
        const menu = elements?.cardStepTemplateMenu;
        if (!valueInput || !label || !btn || !menu) {
            return;
        }

        const templateType = String(valueInput.value || 'navigate').trim() || 'navigate';
        const accentClass = STEP_EDITOR_TEMPLATE_SELECT_ACCENT_CLASS_MAP[templateType] || 'step-editor-template-select--accent-default';
        const knownAccentClasses = Object.values(STEP_EDITOR_TEMPLATE_SELECT_ACCENT_CLASS_MAP).concat('step-editor-template-select--accent-default');

        btn.classList.remove(...knownAccentClasses);
        btn.classList.add(accentClass);
        btn.dataset.templateType = templateType;

        const selectedOption = Array.from(menu.querySelectorAll('[data-step-template-option]')).find(item => String(item.dataset.stepTemplateOption || '').trim() === templateType);
        if (label) {
            label.textContent = String(selectedOption?.textContent || templateType || 'navigate').trim();
        }
        if (btn) {
            btn.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
        }

        menu.querySelectorAll('[data-step-template-option]').forEach(item => {
            const isSelected = String(item.dataset.stepTemplateOption || '').trim() === templateType;
            item.classList.toggle('is-selected', isSelected);
            item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });
    }

    function setStepTemplatePickerOpen(elements, isOpen) {
        const btn = elements?.cardStepTemplateBtn;
        const menu = elements?.cardStepTemplateMenu;
        if (!btn || !menu) {
            return;
        }

        const nextOpen = Boolean(isOpen);
        menu.hidden = !nextOpen;
        menu.style.display = nextOpen ? '' : 'none';
        btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    }

    function syncStepEditorCardAccent(stepCard) {
        if (!stepCard) {
            return;
        }

        const typeSelect = stepCard.querySelector('[data-step-field="type"]');
        const stepType = String(typeSelect?.value || '').trim();
        const accentClass = getStepEditorAccentClass(stepType);
        const knownAccentClasses = Object.values(STEP_EDITOR_TYPE_ACCENT_CLASS_MAP).concat('step-card--accent-default');

        stepCard.classList.remove(...knownAccentClasses);
        stepCard.classList.add(accentClass);
        stepCard.dataset.stepType = stepType || 'navigate';

        const typeBadgeText = stepCard.querySelector('[data-step-type-badge-text]');
        if (typeBadgeText) {
            const selectedOption = stepCard.querySelector('[data-step-field="type"] option:checked');
            typeBadgeText.textContent = String(selectedOption?.textContent || stepType || 'navigate').trim();
        }
    }

    function getStepEditorSelectorPreviewText(fieldName, rawValue) {
        const value = String(rawValue ?? '').trim();
        if (!value) {
            return '支持 HTML 片段、CSS 选择器、:has-text("文本")';
        }

        const normalized = normalizeStepEditorSelectorField(fieldName, value);
        if (!normalized) {
            return '无法自动识别，保留原样';
        }

        return normalized === value
            ? `兼容格式：${normalized}`
            : `已转换为：${normalized}`;
    }

    function updateStepEditorSelectorPreview(stepCard, fieldName) {
        if (!stepCard || !fieldName) {
            return;
        }

        const preview = stepCard.querySelector(`[data-step-selector-preview="${fieldName}"]`);
        const control = stepCard.querySelector(`[data-step-field="${fieldName}"]`);
        if (!preview || !control) {
            return;
        }

        preview.textContent = getStepEditorSelectorPreviewText(fieldName, control.value);
    }

    function refreshStepEditorSelectorPreviews(elements) {
        if (!elements?.cardStepEditorList) {
            return;
        }

        collectCardStepEditors(elements).forEach((card) => {
            ['selector', 'stop_selector', 'wait_for_element', 'wait_for_element_hidden'].forEach(fieldName => {
                updateStepEditorSelectorPreview(card, fieldName);
            });
        });
    }

    function cycleStepEditorFieldsMode(stepCard) {
        if (!stepCard) {
            return STEP_EDITOR_FIELDS_MODE.COLLAPSED;
        }

        const currentMode = normalizeStepEditorFieldsMode(stepCard.dataset, STEP_EDITOR_FIELDS_MODE.COLLAPSED);
        const nextMode = currentMode === STEP_EDITOR_FIELDS_MODE.COLLAPSED
            ? STEP_EDITOR_FIELDS_MODE.FILLER
            : (currentMode === STEP_EDITOR_FIELDS_MODE.FILLER ? STEP_EDITOR_FIELDS_MODE.ALL : STEP_EDITOR_FIELDS_MODE.COLLAPSED);

        stepCard.dataset.stepFieldsMode = nextMode;
        applyStepEditorCardVisibility(stepCard);
        return nextMode;
    }

    function buildStepEditorCardHtml(step = {}, index = 0) {
        const templateType = String(step.type || 'navigate').trim() || 'navigate';
        const title = String(step.name || '').trim() || `步骤${index + 1}`;
        const extraEntries = buildStepEditorExtraEntries(step);
        const paramRowsHtml = extraEntries.map((entry, paramIndex) => `
            <div class="step-param-row" data-step-param-row>
                <input type="text" class="step-param-key" data-step-param-key placeholder="参数名" value="${escapeHtml(entry.key || '')}">
                <input type="text" class="step-param-value" data-step-param-value placeholder="参数值" value="${escapeHtml(typeof entry.value === 'object' ? JSON.stringify(entry.value) : String(entry.value ?? ''))}">
                <button type="button" class="btn btn-secondary btn-small step-param-remove-btn" data-step-param-action="remove" title="删除参数">删除</button>
            </div>
        `).join('');

        const typeOptions = [...STEP_EDITOR_TEMPLATE_OPTIONS];
        if (templateType && !typeOptions.some(option => option.value === templateType)) {
            typeOptions.unshift({ value: templateType, label: `原始类型：${templateType}` });
        }

        const typeOptionsHtml = typeOptions.map(option => `
            <option value="${escapeHtml(option.value)}" ${option.value === templateType ? 'selected' : ''}>${escapeHtml(option.label)}</option>
        `).join('');
        const selectedBy = String(getStepEditorFieldValue(step, 'by', 'auto') || 'auto').trim() || 'auto';

        const getChecked = (key) => Object.prototype.hasOwnProperty.call(step, key) && step[key] === true ? 'checked' : '';
        const fieldsMode = normalizeStepEditorFieldsMode(step);
        const headerTitle = `步骤 ${index + 1}${title ? ` · ${title}` : ''}`;
        const accentClass = getStepEditorAccentClass(templateType);
        const nextActionLabel = fieldsMode === STEP_EDITOR_FIELDS_MODE.COLLAPSED
            ? '展开'
            : (fieldsMode === STEP_EDITOR_FIELDS_MODE.FILLER ? '其它' : '收起');

        return `
            <div class="step-card ${accentClass}" data-step-card data-step-index="${index}" data-step-fields-mode="${fieldsMode}" data-step-type="${escapeHtml(templateType)}">
                <div class="step-card__header">
                    <button type="button" class="step-card__drag-handle" data-step-drag-handle aria-label="拖拽调整顺序" title="拖拽调整顺序">⋮⋮</button>
                    <div class="step-card__title-group">
                        <div class="step-card__title">${escapeHtml(headerTitle)}</div>
                        <div class="step-card__subtitle">操作类型：${escapeHtml(templateType)}</div>
                    </div>
                    <div class="step-card__actions">
                        <button type="button" class="btn btn-secondary btn-small" data-step-action="toggle-fields">${escapeHtml(nextActionLabel)}</button>
                        <button type="button" class="btn btn-secondary btn-small" data-step-action="up">上移</button>
                        <button type="button" class="btn btn-secondary btn-small" data-step-action="down">下移</button>
                        <button type="button" class="btn btn-secondary btn-small" data-step-action="duplicate">复制</button>
                        <button type="button" class="btn btn-danger btn-small" data-step-action="remove">删除</button>
                    </div>
                </div>
                <div class="step-card__body">
                    <div class="step-fields">
                        <div class="step-field">
                            <label>步骤名称</label>
                            <input type="text" data-step-field="name" value="${escapeHtml(title)}" placeholder="请输入步骤名称">
                        </div>
                        <div class="step-field step-field--type" data-step-field-wrap data-step-field-name="type">
                            <div class="step-field__label-row">
                                <label>步骤类型</label>
                                <span class="step-card__type-badge" aria-hidden="true">
                                    <span class="step-card__type-badge-dot"></span>
                                    <span class="step-card__type-badge-text" data-step-type-badge-text>${escapeHtml(typeOptions.find(option => option.value === templateType)?.label || templateType)}</span>
                                </span>
                            </div>
                            <select data-step-field="type" data-step-field-role="type" class="step-card__type-select" data-step-type-select>
                                ${typeOptionsHtml}
                            </select>
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="by">
                            <label>选择器类型 by</label>
                            <select data-step-field="by">
                                <option value="auto" ${selectedBy === 'auto' ? 'selected' : ''}>自动识别</option>
                                <option value="css_selector" ${selectedBy === 'css_selector' ? 'selected' : ''}>CSS 选择器</option>
                                <option value="xpath" ${selectedBy === 'xpath' ? 'selected' : ''}>XPath</option>
                                <option value="id" ${selectedBy === 'id' ? 'selected' : ''}>ID</option>
                            </select>
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="selector">
                            <label>选择器 selector</label>
                            <input type="text" data-step-field="selector" value="${escapeHtml(String(getStepEditorFieldValue(step, 'selector', '')))}" placeholder="例如 .submit-btn / #email">
                            <div class="step-field__preview" data-step-selector-preview="selector"></div>
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="text">
                            <label>输入文本 text</label>
                            <input type="text" data-step-field="text" value="${escapeHtml(String(getStepEditorFieldValue(step, 'text', '')))}" placeholder="仅输入步骤需要">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="url">
                            <label>网址 url</label>
                            <input type="text" data-step-field="url" value="${escapeHtml(String(getStepEditorFieldValue(step, 'url', '')))}" placeholder="仅访问网页步骤需要">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="script">
                            <label>脚本 script</label>
                            <textarea data-step-field="script" rows="3" placeholder="仅脚本步骤需要">${escapeHtml(String(getStepEditorFieldValue(step, 'script', '')))}</textarea>
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="filename">
                            <label>文件名 filename</label>
                            <input type="text" data-step-field="filename" value="${escapeHtml(String(getStepEditorFieldValue(step, 'filename', '')))}" placeholder="仅截图步骤需要">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="timeout">
                            <label>超时 timeout</label>
                            <input type="number" data-step-field="timeout" value="${escapeHtml(String(getStepEditorFieldValue(step, 'timeout', '')))}" step="1" min="0" placeholder="秒">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="wait">
                            <label>等待 wait</label>
                            <input type="number" data-step-field="wait" value="${escapeHtml(String(getStepEditorFieldValue(step, 'wait', '')))}" step="0.1" min="0" placeholder="秒">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="page_sync_timeout_ms">
                            <label>页面同步超时 page_sync_timeout_ms</label>
                            <input type="number" data-step-field="page_sync_timeout_ms" value="${escapeHtml(String(getStepEditorFieldValue(step, 'page_sync_timeout_ms', '')))}" step="1" min="0" placeholder="毫秒">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="wait_for_element">
                            <label>等待元素 wait_for_element</label>
                            <input type="text" data-step-field="wait_for_element" value="${escapeHtml(String(getStepEditorFieldValue(step, 'wait_for_element', '')))}" placeholder="例如 #email">
                            <div class="step-field__preview" data-step-selector-preview="wait_for_element"></div>
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="wait_for_text">
                            <label>等待文本 wait_for_text</label>
                            <input type="text" data-step-field="wait_for_text" value="${escapeHtml(String(getStepEditorFieldValue(step, 'wait_for_text', '')))}" placeholder="例如 验证码">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="wait_for_text_hidden">
                            <label>隐藏文本 wait_for_text_hidden</label>
                            <input type="text" data-step-field="wait_for_text_hidden" value="${escapeHtml(String(getStepEditorFieldValue(step, 'wait_for_text_hidden', '')))}" placeholder="例如 处理中">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="wait_for_element_hidden">
                            <label>隐藏元素 wait_for_element_hidden</label>
                            <input type="text" data-step-field="wait_for_element_hidden" value="${escapeHtml(String(getStepEditorFieldValue(step, 'wait_for_element_hidden', '')))}" placeholder="例如 .loading">
                            <div class="step-field__preview" data-step-selector-preview="wait_for_element_hidden"></div>
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="recovery_jump_to_step">
                            <label>恢复跳转 recovery_jump_to_step</label>
                            <input type="text" data-step-field="recovery_jump_to_step" value="${escapeHtml(String(getStepEditorFieldValue(step, 'recovery_jump_to_step', '')))}" placeholder="例如 下一步">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="type_chunk_size">
                            <label>分段大小 type_chunk_size</label>
                            <input type="number" data-step-field="type_chunk_size" value="${escapeHtml(String(getStepEditorFieldValue(step, 'type_chunk_size', '')))}" step="1" min="0" placeholder="字符数">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="type_chunk_delay_ms">
                            <label>分段延迟 type_chunk_delay_ms</label>
                            <input type="number" data-step-field="type_chunk_delay_ms" value="${escapeHtml(String(getStepEditorFieldValue(step, 'type_chunk_delay_ms', '')))}" step="1" min="0" placeholder="毫秒">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="type_char_delay_ms">
                            <label>字符延迟 type_char_delay_ms</label>
                            <input type="number" data-step-field="type_char_delay_ms" value="${escapeHtml(String(getStepEditorFieldValue(step, 'type_char_delay_ms', '')))}" step="1" min="0" placeholder="毫秒">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="type_operation_timeout_ms">
                            <label>输入超时 type_operation_timeout_ms</label>
                            <input type="number" data-step-field="type_operation_timeout_ms" value="${escapeHtml(String(getStepEditorFieldValue(step, 'type_operation_timeout_ms', '')))}" step="1" min="0" placeholder="毫秒">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="type_search_poll_interval_ms">
                            <label>轮询间隔 type_search_poll_interval_ms</label>
                            <input type="number" data-step-field="type_search_poll_interval_ms" value="${escapeHtml(String(getStepEditorFieldValue(step, 'type_search_poll_interval_ms', '')))}" step="1" min="0" placeholder="毫秒">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="type_search_probe_timeout_ms">
                            <label>探测超时 type_search_probe_timeout_ms</label>
                            <input type="number" data-step-field="type_search_probe_timeout_ms" value="${escapeHtml(String(getStepEditorFieldValue(step, 'type_search_probe_timeout_ms', '')))}" step="1" min="0" placeholder="毫秒">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="type_search_log_interval_ms">
                            <label>日志间隔 type_search_log_interval_ms</label>
                            <input type="number" data-step-field="type_search_log_interval_ms" value="${escapeHtml(String(getStepEditorFieldValue(step, 'type_search_log_interval_ms', '')))}" step="1" min="0" placeholder="毫秒">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="poll_interval_ms">
                            <label>轮询间隔 poll_interval_ms</label>
                            <input type="number" data-step-field="poll_interval_ms" value="${escapeHtml(String(getStepEditorFieldValue(step, 'poll_interval_ms', '')))}" step="1" min="0" placeholder="毫秒">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="stop_selector">
                            <label>停止选择器 stop_selector</label>
                            <input type="text" data-step-field="stop_selector" value="${escapeHtml(String(getStepEditorFieldValue(step, 'stop_selector', '')))}" placeholder="仅循环点击步骤需要">
                            <div class="step-field__preview" data-step-selector-preview="stop_selector"></div>
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="interval">
                            <label>循环间隔 interval</label>
                            <input type="number" data-step-field="interval" value="${escapeHtml(String(getStepEditorFieldValue(step, 'interval', '')))}" step="1" min="0" placeholder="毫秒">
                        </div>
                        <div class="step-field step-field--dynamic" data-step-field-wrap data-step-field-name="max_loop_attempts">
                            <label>最大循环次数 max_loop_attempts</label>
                            <input type="number" data-step-field="max_loop_attempts" value="${escapeHtml(String(getStepEditorFieldValue(step, 'max_loop_attempts', '')))}" step="1" min="0" placeholder="次数">
                        </div>
                        <div class="step-field step-field--wide">
                            <label class="step-card__checkbox" data-step-field-wrap data-step-field-name="optional">
                                <input type="checkbox" data-step-field="optional" ${getChecked('optional')}>
                                <span>可选步骤 optional</span>
                            </label>
                            <label class="step-card__checkbox" data-step-field-wrap data-step-field-name="strict">
                                <input type="checkbox" data-step-field="strict" ${getChecked('strict')}>
                                <span>严格步骤 strict</span>
                            </label>
                            <label class="step-card__checkbox" data-step-field-wrap data-step-field-name="skip_page_sync">
                                <input type="checkbox" data-step-field="skip_page_sync" ${getChecked('skip_page_sync')}>
                                <span>跳过页面同步 skip_page_sync</span>
                            </label>
                            <label class="step-card__checkbox" data-step-field-wrap data-step-field-name="clear_first">
                                <input type="checkbox" data-step-field="clear_first" ${getChecked('clear_first')}>
                                <span>输入前清空 clear_first</span>
                            </label>
                        </div>
                    </div>
                    <div class="step-extra">
                        <div class="step-extra__header">
                            <div class="step-extra__title">自定义参数</div>
                            <button type="button" class="btn btn-secondary btn-small" data-step-action="add-param">添加参数</button>
                        </div>
                        <div class="step-extra__hint">支持字符串、数字、布尔值和 JSON。保存时会自动合并到步骤对象中。</div>
                        ${paramRowsHtml ? `<div class="step-params" data-step-params-list>${paramRowsHtml}</div>` : '<div class="step-params__empty">暂无自定义参数</div>'}
                    </div>
                </div>
                <div class="step-card__collapsed-summary">
                    ${extraEntries.length > 0 ? `<span class="step-card__collapsed-summary-item">${extraEntries.length} 个参数</span>` : ''}
                </div>
            </div>
        `;
    }

    function getStepEditorVisibleFields(stepType = '') {
        const normalizedType = String(stepType || '').trim();
        const visibleFields = STEP_EDITOR_DYNAMIC_FIELD_VISIBILITY[normalizedType];
        return visibleFields ? new Set(visibleFields) : null;
    }

    function applyStepEditorCardVisibility(stepCard) {
        if (!stepCard) {
            return;
        }

        const typeSelect = stepCard.querySelector('[data-step-field="type"]');
        const toggleButton = stepCard.querySelector('[data-step-action="toggle-fields"]');
        const body = stepCard.querySelector('.step-card__body');
        const collapsedSummary = stepCard.querySelector('.step-card__collapsed-summary');
        const dynamicFields = Array.from(stepCard.querySelectorAll('[data-step-field-wrap][data-step-field-name]'));
        const checkboxFields = Array.from(stepCard.querySelectorAll('.step-card__checkbox[data-step-field-wrap][data-step-field-name]'));
        const stepType = String(typeSelect?.value || '').trim();
        const fieldsMode = normalizeStepEditorFieldsMode(stepCard.dataset, STEP_EDITOR_FIELDS_MODE.COLLAPSED);
        const isCollapsed = fieldsMode === STEP_EDITOR_FIELDS_MODE.COLLAPSED;
        const isFilledMode = fieldsMode === STEP_EDITOR_FIELDS_MODE.FILLER;
        const isAllMode = fieldsMode === STEP_EDITOR_FIELDS_MODE.ALL;

        const hasVisibleValue = (field) => {
            const control = field.querySelector('[data-step-field]');
            if (!control) {
                return false;
            }

            if (control.type === 'checkbox') {
                return control.checked === true;
            }

            return String(control.value || '').trim() !== '';
        };

        dynamicFields.forEach(field => {
            const shouldShow = isAllMode || (isFilledMode && hasVisibleValue(field));
            field.style.display = shouldShow ? '' : 'none';
        });

        checkboxFields.forEach(field => {
            const control = field.querySelector('[data-step-field]');
            const isChecked = control && control.type === 'checkbox' ? control.checked === true : false;
            const shouldShow = isAllMode || isFilledMode && isChecked;
            field.style.display = shouldShow ? '' : 'none';
        });

        if (toggleButton) {
            toggleButton.textContent = fieldsMode === STEP_EDITOR_FIELDS_MODE.COLLAPSED
                ? '展开'
                : (fieldsMode === STEP_EDITOR_FIELDS_MODE.FILLER ? '其它' : '收起');
        }

        const extraSection = stepCard.querySelector('.step-extra');
        const extraRows = stepCard.querySelector('[data-step-params-list]');
        const extraEmpty = stepCard.querySelector('.step-params__empty');
        const extraHint = stepCard.querySelector('.step-extra__hint');
        const hasParams = Boolean(extraRows);
        if (extraSection) {
            extraSection.style.display = isCollapsed ? 'none' : '';
        }
        if (extraRows) {
            extraRows.style.display = hasParams ? '' : (isAllMode ? '' : 'none');
        }
        if (extraEmpty) {
            extraEmpty.style.display = hasParams ? 'none' : (isAllMode ? 'block' : 'none');
        }
        if (extraHint) {
            extraHint.style.display = hasParams || isAllMode ? '' : 'none';
        }

        stepCard.classList.toggle('step-card--collapsed', isCollapsed);
        stepCard.classList.toggle('step-card--fields-filled', isFilledMode);
        stepCard.classList.toggle('step-card--fields-all', isAllMode);
        if (body) {
            body.style.display = isCollapsed ? 'none' : '';
        }
        if (collapsedSummary) {
            collapsedSummary.style.display = 'none';
        }
    }

    function renderCardStepEditor(elements, steps = []) {
        if (!elements?.cardStepEditorList) {
            return;
        }

        const normalizedSteps = Array.isArray(steps) ? steps : [];
        if (elements.cardStepsTextarea) {
            elements.cardStepsTextarea.value = JSON.stringify(normalizedSteps, null, 2);
        }

        if (normalizedSteps.length === 0) {
            elements.cardStepEditorList.innerHTML = `
                <div class="step-editor-empty">
                    还没有注册步骤。选择一个模板后点击“新增步骤”，或先手动添加第一段步骤。
                </div>
            `;
            return;
        }

        elements.cardStepEditorList.innerHTML = normalizedSteps.map((step, index) => buildStepEditorCardHtml(step, index)).join('');
        collectCardStepEditors(elements).forEach((card) => {
            syncStepEditorCardAccent(card);
            applyStepEditorCardVisibility(card);
        });
        refreshStepEditorSelectorPreviews(elements);
    }

    function collectCardStepEditors(elements) {
        if (!elements?.cardStepEditorList) {
            return [];
        }

        return Array.from(elements.cardStepEditorList.querySelectorAll('[data-step-card]'));
    }

    function collectCardStepParams(stepCard) {
        if (!stepCard) {
            return [];
        }

        return Array.from(stepCard.querySelectorAll('[data-step-param-row]')).map(row => {
            const keyInput = row.querySelector('[data-step-param-key]');
            const valueInput = row.querySelector('[data-step-param-value]');
            return {
                key: String(keyInput?.value || '').trim(),
                value: String(valueInput?.value || '').trim()
            };
        }).filter(entry => entry.key);
    }

    function serializeCardStepCard(stepCard, index = 0) {
        if (!stepCard) {
            return null;
        }

        const getFieldValue = (fieldName) => {
            const control = stepCard.querySelector(`[data-step-field="${fieldName}"]`);
            if (!control) {
                return '';
            }

            if (control.type === 'checkbox') {
                return control.checked === true;
            }

            return String(control.value || '').trim();
        };

        const getNormalizedFieldValue = (fieldName) => normalizeStepEditorSelectorField(fieldName, getFieldValue(fieldName));

        const step = {};
        const name = String(getFieldValue('name') || '').trim();
        const type = String(getFieldValue('type') || '').trim();
        step.name = name || `步骤${index + 1}`;
        step.type = type || 'navigate';

        const textFields = ['by', 'selector', 'text', 'url', 'script', 'filename', 'wait_for_element', 'wait_for_text', 'wait_for_text_hidden', 'wait_for_element_hidden', 'stop_selector', 'recovery_jump_to_step'];
        for (const fieldName of textFields) {
            const value = String(getNormalizedFieldValue(fieldName) || '').trim();
            if (value) {
                step[fieldName] = value;
            }
        }

        const numericFields = ['timeout', 'wait', 'page_sync_timeout_ms', 'stability_timeout', 'retry_delay', 'max_retries', 'interval', 'max_loop_attempts', 'poll_interval_ms', 'type_chunk_size', 'type_chunk_delay_ms', 'type_char_delay_ms', 'type_operation_timeout_ms', 'type_search_poll_interval_ms', 'type_search_probe_timeout_ms', 'type_search_log_interval_ms'];
        for (const fieldName of numericFields) {
            const value = String(getFieldValue(fieldName) || '').trim();
            if (!value) {
                continue;
            }

            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                step[fieldName] = parsed;
            }
        }

        const booleanFields = ['optional', 'strict', 'skip_page_sync', 'clear_first'];
        for (const fieldName of booleanFields) {
            const value = getFieldValue(fieldName);
            if (value === true) {
                step[fieldName] = true;
            }
        }

        for (const entry of collectCardStepParams(stepCard)) {
            const parsed = parseStepEditorValue(entry.value);
            if (parsed !== undefined) {
                step[entry.key] = parsed;
            }
        }

        const fieldsMode = normalizeStepEditorFieldsMode(stepCard.dataset, STEP_EDITOR_FIELDS_MODE.COLLAPSED);
        step.ui_fields_mode = fieldsMode;

        return step;
    }

    function collectCardStepsFromEditor(elements) {
        if (!elements?.cardStepEditorList) {
            try {
                const rawValue = String(elements?.cardStepsTextarea?.value || '').trim();
                return {
                    success: true,
                    steps: rawValue ? JSON.parse(rawValue) : []
                };
            } catch (error) {
                return { success: false, error: `步骤JSON格式错误: ${error.message}` };
            }
        }

        const cards = collectCardStepEditors(elements);
        const steps = cards.map((card, index) => serializeCardStepCard(card, index)).filter(Boolean);
        return {
            success: true,
            steps
        };
    }

    function reorderCardStepEditorSteps(elements, fromIndex, toIndex) {
        const result = collectCardStepsFromEditor(elements);
        if (!result.success) {
            return result;
        }

        const steps = Array.isArray(result.steps) ? [...result.steps] : [];
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
            return { success: false, error: '步骤索引无效' };
        }

        if (fromIndex < 0 || fromIndex >= steps.length || toIndex < 0 || toIndex >= steps.length) {
            return { success: false, error: '步骤索引超出范围' };
        }

        const [moved] = steps.splice(fromIndex, 1);
        steps.splice(toIndex, 0, moved);
        renderCardStepEditor(elements, steps);
        return { success: true, steps };
    }

    function getStepEditorDropLocation(elements, clientY) {
        const cards = collectCardStepEditors(elements);
        if (!cards.length) {
            return { index: 0, insertIndex: 0, position: 'after' };
        }

        for (let index = 0; index < cards.length; index += 1) {
            const card = cards[index];
            const rect = card.getBoundingClientRect();
            const middle = rect.top + rect.height / 2;
            if (clientY < middle) {
                return { index, insertIndex: index, position: 'before' };
            }
        }

        return { index: cards.length - 1, insertIndex: cards.length, position: 'after' };
    }

    function applyStepEditorReorderFromIndex(elements, fromIndex, insertIndex) {
        const result = collectCardStepsFromEditor(elements);
        if (!result.success) {
            return result;
        }

        const steps = Array.isArray(result.steps) ? [...result.steps] : [];
        if (!Number.isInteger(fromIndex) || !Number.isInteger(insertIndex)) {
            return { success: false, error: '步骤索引无效' };
        }
        if (fromIndex < 0 || fromIndex >= steps.length || insertIndex < 0 || insertIndex > steps.length) {
            return { success: false, error: '步骤索引超出范围' };
        }

        const [moved] = steps.splice(fromIndex, 1);
        let nextIndex = insertIndex;
        if (fromIndex < insertIndex) {
            nextIndex -= 1;
        }
        nextIndex = Math.max(0, Math.min(steps.length, nextIndex));
        steps.splice(nextIndex, 0, moved);
        renderCardStepEditor(elements, steps);
        return { success: true, steps };
    }

    function clearStepEditorDropIndicator(elements) {
        collectCardStepEditors(elements).forEach((card) => {
            card.classList.remove('step-card--dragging', 'step-card--drop-target', 'step-card--drop-before', 'step-card--drop-after');
        });
    }

    function setStepEditorDropIndicator(elements, location) {
        clearStepEditorDropIndicator(elements);
        if (!location || !Number.isInteger(location.index)) {
            return;
        }

        const cards = collectCardStepEditors(elements);
        const card = cards[location.index] || null;
        if (!card) {
            return;
        }

        card.classList.add('step-card--drop-target');
        card.classList.add(location.position === 'before' ? 'step-card--drop-before' : 'step-card--drop-after');
    }

    function syncCardStepsTextareaFromEditor(elements) {
        const result = collectCardStepsFromEditor(elements);
        if (!result.success) {
            return result;
        }

        if (elements.cardStepsTextarea) {
            elements.cardStepsTextarea.value = JSON.stringify(result.steps || [], null, 2);
        }

        return result;
    }

    function addCardStepFromTemplate(elements, stepType = 'navigate') {
        const result = syncCardStepsTextareaFromEditor(elements);
        if (!result.success) {
            return result;
        }

        const template = getStepEditorTemplate(stepType);
        const steps = Array.isArray(result.steps) ? [...result.steps] : [];
        steps.push(JSON.parse(JSON.stringify(template)));
        renderCardStepEditor(elements, steps);
        return { success: true, steps };
    }

    function showCardDialog(cardData, elements, toggleCharsetField, cardMode = 'register', relatedApiCardName = '') {
        elements.cardForm.reset();
        if (elements.cardDebugStepPause) {
            elements.cardDebugStepPause.checked = true;
        }
        resetCardDebugPanel(elements);
        delete elements.cardDialog.dataset.originalCardName;
        delete elements.cardDialog.dataset.apiCardName;

        elements.cardDialog.dataset.cardMode = cardMode;
        const modeConfig = getCardModeConfig(cardMode);
        const isStandaloneCardEditorWindow = String(document.body?.dataset.view || document.documentElement?.dataset.view || '').trim() === 'card-editor';
        activateCardEditorTab(elements, 'card-dialog-base-tab');
        if (elements.cardStepTemplateValue) {
            elements.cardStepTemplateValue.value = 'navigate';
        }
        setStepTemplatePickerOpen(elements, false);
        syncStepTemplateSelectAccent(elements);
        if (isStandaloneCardEditorWindow) {
            document.title = `${modeConfig.label}卡片编辑器`;
        }
        const defaultApiServiceParams = {
            model: '',
            prompt: '',
            size: '',
            n: 1,
            quality: '',
            response_format: ''
        };
        const apiService = cardData && typeof cardData.api_service === 'object'
            ? cardData.api_service
            : (cardData && typeof cardData.apiService === 'object' ? cardData.apiService : {});
        const apiServiceType = String(
            apiService.type
            || cardData?.api_service_type
            || cardData?.apiServiceType
            || 'image'
        ).trim() || 'image';
        const apiServiceEndpoint = String(
            apiService.endpoint
            || cardData?.api_service_endpoint
            || cardData?.apiServiceEndpoint
            || (apiServiceType === 'text' ? '/v1/chat/completions' : (apiServiceType === 'video' ? '/v1/videos/generations' : '/v1/images/generations'))
        ).trim();
        const apiServiceParams = apiService.request_params && typeof apiService.request_params === 'object'
            ? apiService.request_params
            : (apiService.requestParams && typeof apiService.requestParams === 'object' ? apiService.requestParams : defaultApiServiceParams);
        if (elements.cardApiServiceType) {
            elements.cardApiServiceType.value = ['text', 'image', 'video'].includes(apiServiceType) ? apiServiceType : 'image';
        }
        if (elements.cardApiServiceEndpoint) {
            elements.cardApiServiceEndpoint.value = apiServiceEndpoint;
        }
        if (elements.cardApiServiceParams) {
            elements.cardApiServiceParams.value = JSON.stringify(apiServiceParams, null, 2);
        }

        if (cardData) {
            elements.dialogTitle.textContent = `编辑${modeConfig.label}卡片`;
            elements.cardDialog.dataset.originalCardName = cardData.name || '';
            const apiCardName = String(
                cardData.api_card_name
                || cardData.apiCardName
                || cardData.api_name
                || cardData.apiName
                || relatedApiCardName
                || ''
            ).trim();
            if (apiCardName) {
                elements.cardDialog.dataset.apiCardName = apiCardName;
            }
            elements.cardName.value = cardData.name || '';
            elements.cardWebsite.value = cardData.website || '';
            elements.cardDescription.value = cardData.description || '';
            elements.cardPassword.value = cardData.password || '';
            elements.cardPoints.value = cardData.points || 0;
            if (elements.cardMinCookieSize) {
                elements.cardMinCookieSize.value = cardData
                    ? resolveCardMinCookieSizeInputValue(cardData)
                    : DEFAULT_MIN_COOKIE_SIZE_BYTES;
            }
            if (elements.cardPasswordRandomLength) {
                elements.cardPasswordRandomLength.value = String(resolveCardPasswordRandomConfig(cardData).length);
            }
            if (elements.cardPasswordRandomType) {
                elements.cardPasswordRandomType.value = resolveCardPasswordRandomConfig(cardData).type;
            }

            if (cardData.popups) {
                elements.cardPopupsTextarea.value = JSON.stringify(cardData.popups, null, 2);
            } else {
                elements.cardPopupsTextarea.value = '[]';
            }

            if (cardData.steps) {
                const normalizedSteps = Array.isArray(cardData.steps)
                    ? cardData.steps.map(step => stripStepEditorUiState(step))
                    : [];
                renderCardStepEditor(elements, normalizedSteps);
            } else {
                renderCardStepEditor(elements, []);
            }
        } else {
            elements.dialogTitle.textContent = `添加${modeConfig.label}卡片`;
            const apiCardName = String(relatedApiCardName || '').trim();
            if (apiCardName) {
                elements.cardDialog.dataset.apiCardName = apiCardName;
            }
            elements.cardPopupsTextarea.value = '[]';
            renderCardStepEditor(elements, []);
        }

        activateCardEditorTab(elements, 'card-right-panel-steps-tab');

        if (elements.cardMinCookieSizeGroup) {
            const isRegisterMode = cardMode === 'register';
            elements.cardMinCookieSizeGroup.style.display = isRegisterMode ? '' : 'none';
        }
        if (elements.cardPasswordRandomGroup) {
            const isRegisterMode = cardMode === 'register';
            elements.cardPasswordRandomGroup.style.display = isRegisterMode ? '' : 'none';
        }
        if (elements.cardDialogApiServiceTabBtn || elements.cardDialogApiServiceTab) {
            const isModelMode = cardMode === 'model';
            if (elements.cardDialogApiServiceTabBtn) {
                elements.cardDialogApiServiceTabBtn.style.display = isModelMode ? '' : 'none';
            }
            if (elements.cardDialogApiServiceTab) {
                elements.cardDialogApiServiceTab.style.display = isModelMode ? '' : 'none';
            }
        }
        if (elements.cardUploadTargetScoreScope || elements.cardUploadTargetScoreTypesGroup) {
            const isRegisterMode = cardMode === 'register';
            if (isRegisterMode) {
                const uploadTargetScoreConfig = resolveUploadTargetScoreConfig(cardData || {});
                if (elements.cardUploadTargetScoreScope) {
                    elements.cardUploadTargetScoreScope.value = uploadTargetScoreConfig.scope;
                }
                if (elements.cardUploadTargetScoreTypes) {
                    elements.cardUploadTargetScoreTypes.value = uploadTargetScoreConfig.types.join('\n');
                }
            } else {
                if (elements.cardUploadTargetScoreScope) {
                    elements.cardUploadTargetScoreScope.value = DEFAULT_UPLOAD_TARGET_SCORE_SCOPE;
                }
                if (elements.cardUploadTargetScoreTypes) {
                    elements.cardUploadTargetScoreTypes.value = '';
                }
            }
            setUploadTargetScoreControlsVisibility(elements);
        }

        syncCardStepsTextareaFromEditor(elements);
        renderCardStepProgressList(elements, elements.cardDebugState);
        elements.cardDialog.style.display = 'flex';
    }

    function hideCardDialog(elements) {
        const isCardEditorView = String(document.body?.dataset.view || document.documentElement?.dataset.view || '').trim() === 'card-editor';
        if (isCardEditorView) {
            try {
                window.close();
            } catch (_error) {
                if (elements.cardDialog) {
                    elements.cardDialog.style.display = 'none';
                }
            }
        } else if (elements.cardDialog) {
            elements.cardDialog.style.display = 'none';
        }
        delete elements.cardDialog.dataset.cardMode;
        delete elements.cardDialog.dataset.originalCardName;
        delete elements.cardDialog.dataset.apiCardName;
        resetCardDebugPanel(elements);
    }

    return {
        openCardEditorWindow,
        syncCardDebugRunButton,
        syncCardDebugModeButtons,
        resetCardDebugPanel,
        activateCardEditorTab,
        activateCardDialogTab,
        activateCardDialogRightTab,
        updateCardDebugPanel,
        escapeHtml,
        normalizeStepTitle,
        parseCardSteps,
        getStepRowState,
        renderCardStepProgressList,
        getStepEditorAccentClass,
        syncStepTemplateSelectAccent,
        setStepTemplatePickerOpen,
        syncStepEditorCardAccent,
        getStepEditorSelectorPreviewText,
        updateStepEditorSelectorPreview,
        refreshStepEditorSelectorPreviews,
        cycleStepEditorFieldsMode,
        buildStepEditorCardHtml,
        getStepEditorVisibleFields,
        applyStepEditorCardVisibility,
        renderCardStepEditor,
        collectCardStepEditors,
        collectCardStepParams,
        serializeCardStepCard,
        collectCardStepsFromEditor,
        reorderCardStepEditorSteps,
        getStepEditorDropLocation,
        applyStepEditorReorderFromIndex,
        clearStepEditorDropIndicator,
        setStepEditorDropIndicator,
        syncCardStepsTextareaFromEditor,
        addCardStepFromTemplate,
        showCardDialog,
        hideCardDialog
    };
};
