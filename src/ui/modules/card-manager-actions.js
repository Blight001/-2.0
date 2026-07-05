module.exports = function createCardManagerActions(deps = {}) {
    const {
        saveCard,
        debugCard,
        importCard,
        editSelectedCard,
        deleteSelectedCard,
        ensureCardModeLoadedForAction,
        showCardDialog,
        hideCardDialog,
        openCardEditorWindow,
        resetCardDebugPanel,
        updateCardDebugPanel,
        renderCardStepProgressList,
        renderCardStepEditor,
        syncCardStepsTextareaFromEditor,
        reorderCardStepEditorSteps,
        collectCardStepEditors,
        cycleStepEditorFieldsMode,
        syncStepEditorCardAccent,
        applyStepEditorCardVisibility,
        updateStepEditorSelectorPreview,
        normalizeStepEditorSelectorField,
        getStepEditorDropLocation,
        applyStepEditorReorderFromIndex,
        setStepEditorDropIndicator,
        clearStepEditorDropIndicator,
        addCardStepFromTemplate,
        setStepTemplatePickerOpen,
        syncStepTemplateSelectAccent,
        activateCardEditorTab,
        createStepEditorDragSession,
        setUploadTargetScoreControlsVisibility,
        getCurrentCard = () => null,
        getCurrentTestCard = () => null,
        getCurrentApiCard = () => null,
        getCurrentModelCard = () => null,
        getCurrentHaikaBindCard = () => null,
        setCurrentCard = () => {},
        setCurrentTestCard = () => {},
        setCurrentApiCard = () => {},
        setCurrentModelCard = () => {},
        setCurrentHaikaBindCard = () => {},
        isRemoteCardControlMode,
        getRemoteCardControlMessage,
        IPC_CHANNELS,
        ipcRenderer
    } = deps;

    const getCardNameByMode = (cardMode) => {
        if (cardMode === 'test') {
            return typeof getCurrentTestCard === 'function' ? getCurrentTestCard() : null;
        }

        if (cardMode === 'api') {
            return typeof getCurrentApiCard === 'function' ? getCurrentApiCard() : null;
        }

        if (cardMode === 'model') {
            return typeof getCurrentModelCard === 'function' ? getCurrentModelCard() : null;
        }

        if (cardMode === 'haikaBind') {
            return typeof getCurrentHaikaBindCard === 'function' ? getCurrentHaikaBindCard() : null;
        }

        return typeof getCurrentCard === 'function' ? getCurrentCard() : null;
    };

    const setCardNameByMode = (cardMode, cardName) => {
        if (cardMode === 'test') {
            return typeof setCurrentTestCard === 'function' ? setCurrentTestCard(cardName) : undefined;
        }

        if (cardMode === 'api') {
            return typeof setCurrentApiCard === 'function' ? setCurrentApiCard(cardName) : undefined;
        }

        if (cardMode === 'model') {
            return typeof setCurrentModelCard === 'function' ? setCurrentModelCard(cardName) : undefined;
        }

        if (cardMode === 'haikaBind') {
            return typeof setCurrentHaikaBindCard === 'function' ? setCurrentHaikaBindCard(cardName) : undefined;
        }

        return typeof setCurrentCard === 'function' ? setCurrentCard(cardName) : undefined;
    };

    function setupCardEventListeners(
        elements,
        showMessage,
        hideCardDialogFn,
        loadCardsFn,
        toggleCharsetField,
        loadTestCardsFn = loadCardsFn,
        loadApiCardsFn = loadCardsFn,
        loadModelCardsFn = loadCardsFn,
        loadHaikaBindCardsFn = loadCardsFn,
        getBrowserSettingsPatchFn = null,
        state = null
    ) {
        const getCurrentDebugTaskId = () => String(
            state?.currentCardDebugTaskId
            || elements?.cardDebugState?.taskId
            || ''
        ).trim();
        const hasCurrentDebugTaskState = () => {
            const debugState = elements?.cardDebugState && typeof elements.cardDebugState === 'object'
                ? elements.cardDebugState
                : {};
            return Boolean(getCurrentDebugTaskId())
                || debugState.active === true
                || debugState.paused === true
                || debugState.canPause === true
                || debugState.canResume === true;
        };

        const deferredLoadConfigs = [
            { listElement: elements.cardList, cardMode: 'automation', loadFn: loadCardsFn },
            { listElement: elements.testCardList, cardMode: 'test', loadFn: loadTestCardsFn },
            { listElement: elements.apiCardList, cardMode: 'api', loadFn: loadApiCardsFn },
            { listElement: elements.modelCardList, cardMode: 'model', loadFn: loadModelCardsFn },
            { listElement: elements.haikaBindCardList, cardMode: 'haikaBind', loadFn: loadHaikaBindCardsFn }
        ];

        deferredLoadConfigs.forEach(({ listElement, loadFn }) => {
            if (!listElement) {
                return;
            }

            listElement.addEventListener('click', async (event) => {
                const placeholder = event.target.closest('.card-load-placeholder');
                if (!placeholder) {
                    return;
                }

                if (typeof isRemoteCardControlMode === 'function' && isRemoteCardControlMode()) {
                    showMessage(getRemoteCardControlMessage(placeholder.dataset.cardLoadMode || 'automation'), 'info');
                    return;
                }

                await loadFn();
            });
        });

        if (elements.addCardBtn) {
            elements.addCardBtn.addEventListener('click', async () => {
                if (typeof isRemoteCardControlMode === 'function' && isRemoteCardControlMode()) {
                    showMessage(getRemoteCardControlMessage('automation'), 'info');
                    return;
                }

                const result = await openCardEditorWindow(null, 'automation');
                if (result && result.success === false) {
                    showMessage(`打开编辑窗口失败: ${result.error || '未知错误'}`, 'error');
                }
            });
        }
        if (elements.refreshCardBtn) {
            elements.refreshCardBtn.addEventListener('click', async () => {
                if (typeof isRemoteCardControlMode === 'function' && isRemoteCardControlMode()) {
                    showMessage(getRemoteCardControlMessage('automation'), 'info');
                    return;
                }

                try {
                    await loadCardsFn({ forceReload: true });
                    showMessage('自动化卡片列表已刷新', 'success');
                } catch (error) {
                    showMessage(`刷新自动化卡片列表失败: ${error.message}`, 'error');
                }
            });
        }
        if (elements.importCardBtn) {
            elements.importCardBtn.addEventListener('click', () => importCard(showMessage, loadCardsFn, 'automation', loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn));
        }
        if (elements.editCardBtn) {
            elements.editCardBtn.addEventListener('click', async () => {
                await ensureCardModeLoadedForAction('automation', loadCardsFn, loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
                const card = await editSelectedCard(showMessage, getCardNameByMode('automation'), 'automation');
                if (card) {
                    const result = await openCardEditorWindow(card, 'automation');
                    if (result && result.success === false) {
                        showMessage(`打开编辑窗口失败: ${result.error || '未知错误'}`, 'error');
                    }
                }
            });
        }
        if (elements.deleteCardBtn) {
            elements.deleteCardBtn.addEventListener('click', async () => {
                await ensureCardModeLoadedForAction('automation', loadCardsFn, loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
                deleteSelectedCard(elements, showMessage, loadCardsFn, getCardNameByMode('automation'), (name) => { setCardNameByMode('automation', name); }, 'automation', loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
            });
        }

        if (elements.addTestCardBtn) {
            elements.addTestCardBtn.addEventListener('click', async () => {
                if (typeof isRemoteCardControlMode === 'function' && isRemoteCardControlMode()) {
                    showMessage(getRemoteCardControlMessage('test'), 'info');
                    return;
                }

                const result = await openCardEditorWindow(null, 'test');
                if (result && result.success === false) {
                    showMessage(`打开编辑窗口失败: ${result.error || '未知错误'}`, 'error');
                }
            });
        }
        if (elements.importTestCardBtn) {
            elements.importTestCardBtn.addEventListener('click', () => importCard(showMessage, loadCardsFn, 'test', loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn));
        }
        if (elements.editTestCardBtn) {
            elements.editTestCardBtn.addEventListener('click', async () => {
                await ensureCardModeLoadedForAction('test', loadCardsFn, loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
                const card = await editSelectedCard(showMessage, getCardNameByMode('test'), 'test');
                if (card) {
                    const result = await openCardEditorWindow(card, 'test');
                    if (result && result.success === false) {
                        showMessage(`打开编辑窗口失败: ${result.error || '未知错误'}`, 'error');
                    }
                }
            });
        }
        if (elements.deleteTestCardBtn) {
            elements.deleteTestCardBtn.addEventListener('click', async () => {
                await ensureCardModeLoadedForAction('test', loadCardsFn, loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
                deleteSelectedCard(elements, showMessage, loadCardsFn, getCardNameByMode('test'), (name) => { setCardNameByMode('test', name); }, 'test', loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
            });
        }

        if (elements.addApiCardBtn) {
            elements.addApiCardBtn.addEventListener('click', async () => {
                if (typeof isRemoteCardControlMode === 'function' && isRemoteCardControlMode()) {
                    showMessage(getRemoteCardControlMessage('api'), 'info');
                    return;
                }

                const result = await openCardEditorWindow(null, 'api');
                if (result && result.success === false) {
                    showMessage(`打开编辑窗口失败: ${result.error || '未知错误'}`, 'error');
                }
            });
        }
        if (elements.importApiCardBtn) {
            elements.importApiCardBtn.addEventListener('click', () => importCard(showMessage, loadCardsFn, 'api', loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn));
        }
        if (elements.refreshApiCardBtn) {
            elements.refreshApiCardBtn.addEventListener('click', async () => {
                if (typeof isRemoteCardControlMode === 'function' && isRemoteCardControlMode()) {
                    showMessage(getRemoteCardControlMessage('api'), 'info');
                    return;
                }

                try {
                    await loadApiCardsFn({ forceReload: true });
                    showMessage('API卡片列表已刷新', 'success');
                } catch (error) {
                    showMessage(`刷新API卡片列表失败: ${error.message}`, 'error');
                }
            });
        }
        if (elements.editApiCardBtn) {
            elements.editApiCardBtn.addEventListener('click', async () => {
                await ensureCardModeLoadedForAction('api', loadCardsFn, loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
                const card = await editSelectedCard(showMessage, getCardNameByMode('api'), 'api');
                if (card) {
                    const result = await openCardEditorWindow(card, 'api');
                    if (result && result.success === false) {
                        showMessage(`打开编辑窗口失败: ${result.error || '未知错误'}`, 'error');
                    }
                }
            });
        }
        if (elements.deleteApiCardBtn) {
            elements.deleteApiCardBtn.addEventListener('click', async () => {
                await ensureCardModeLoadedForAction('api', loadCardsFn, loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
                deleteSelectedCard(elements, showMessage, loadCardsFn, getCardNameByMode('api'), (name) => { setCardNameByMode('api', name); }, 'api', loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
            });
        }

        if (elements.addModelCardBtn) {
            elements.addModelCardBtn.addEventListener('click', async () => {
                if (typeof isRemoteCardControlMode === 'function' && isRemoteCardControlMode()) {
                    showMessage(getRemoteCardControlMessage('model'), 'info');
                    return;
                }

                const apiCardName = String(typeof getCurrentApiCard === 'function' ? getCurrentApiCard() : '').trim();
                if (!apiCardName) {
                    showMessage('请先选择一个API卡片，再添加模型卡片', 'error');
                    return;
                }

                const result = await openCardEditorWindow(null, 'model', { apiCardName });
                if (result && result.success === false) {
                    showMessage(`打开编辑窗口失败: ${result.error || '未知错误'}`, 'error');
                }
            });
        }
        if (elements.importModelCardBtn) {
            elements.importModelCardBtn.addEventListener('click', () => importCard(showMessage, loadCardsFn, 'model', loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn));
        }
        if (elements.refreshModelCardBtn) {
            elements.refreshModelCardBtn.addEventListener('click', async () => {
                if (typeof isRemoteCardControlMode === 'function' && isRemoteCardControlMode()) {
                    showMessage(getRemoteCardControlMessage('model'), 'info');
                    return;
                }

                const apiCardName = String(typeof getCurrentApiCard === 'function' ? getCurrentApiCard() : '').trim();
                if (!apiCardName) {
                    showMessage('请先选择一个API卡片，再刷新模型卡片', 'error');
                    return;
                }

                try {
                    await loadModelCardsFn({ forceReload: true, apiCardName });
                    showMessage('模型卡片列表已刷新', 'success');
                } catch (error) {
                    showMessage(`刷新模型卡片列表失败: ${error.message}`, 'error');
                }
            });
        }
        if (elements.editModelCardBtn) {
            elements.editModelCardBtn.addEventListener('click', async () => {
                await ensureCardModeLoadedForAction('model', loadCardsFn, loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
                const card = await editSelectedCard(showMessage, getCardNameByMode('model'), 'model');
                if (card) {
                    const apiCardName = String(
                        card.api_card_name
                        || card.apiCardName
                        || card.api_name
                        || card.apiName
                        || (typeof getCurrentApiCard === 'function' ? getCurrentApiCard() : '')
                    ).trim();
                    const result = await openCardEditorWindow(card, 'model', { apiCardName });
                    if (result && result.success === false) {
                        showMessage(`打开编辑窗口失败: ${result.error || '未知错误'}`, 'error');
                    }
                }
            });
        }
        if (elements.deleteModelCardBtn) {
            elements.deleteModelCardBtn.addEventListener('click', async () => {
                await ensureCardModeLoadedForAction('model', loadCardsFn, loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
                deleteSelectedCard(elements, showMessage, loadCardsFn, getCardNameByMode('model'), (name) => { setCardNameByMode('model', name); }, 'model', loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
            });
        }

        if (elements.addHaikaBindCardBtn) {
            elements.addHaikaBindCardBtn.addEventListener('click', () => {
                if (typeof isRemoteCardControlMode === 'function' && isRemoteCardControlMode()) {
                    showMessage(getRemoteCardControlMessage('haikaBind'), 'info');
                    return;
                }

                showCardDialog(null, elements, toggleCharsetField, 'haikaBind');
            });
        }
        if (elements.importHaikaBindCardBtn) {
            elements.importHaikaBindCardBtn.addEventListener('click', () => importCard(showMessage, loadCardsFn, 'haikaBind', loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn));
        }
        if (elements.editHaikaBindCardBtn) {
            elements.editHaikaBindCardBtn.addEventListener('click', async () => {
                await ensureCardModeLoadedForAction('haikaBind', loadCardsFn, loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
                const card = await editSelectedCard(showMessage, getCardNameByMode('haikaBind'), 'haikaBind');
                if (card) {
                    showCardDialog(card, elements, toggleCharsetField, 'haikaBind');
                }
            });
        }
        if (elements.deleteHaikaBindCardBtn) {
            elements.deleteHaikaBindCardBtn.addEventListener('click', async () => {
                await ensureCardModeLoadedForAction('haikaBind', loadCardsFn, loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
                deleteSelectedCard(elements, showMessage, loadCardsFn, getCardNameByMode('haikaBind'), (name) => { setCardNameByMode('haikaBind', name); }, 'haikaBind', loadTestCardsFn, loadApiCardsFn, loadModelCardsFn, loadHaikaBindCardsFn);
            });
        }

        if (elements.closeDialogBtn) {
            elements.closeDialogBtn.addEventListener('click', () => hideCardDialogFn(elements));
        }
        if (elements.cancelCardBtn) {
            elements.cancelCardBtn.addEventListener('click', () => hideCardDialogFn(elements));
        }
        if (elements.cardForm) {
            elements.cardForm.addEventListener('submit', (event) => {
                event.preventDefault();
            });
        }
        if (elements.saveCardBtn) {
            elements.saveCardBtn.addEventListener('click', async () => {
                await saveCard(
                    elements,
                    showMessage,
                    loadCardsFn,
                    loadTestCardsFn,
                    loadApiCardsFn,
                    loadModelCardsFn,
                    loadHaikaBindCardsFn
                );
            });
        }
        if (elements.cardStepsUpdateBtn) {
            elements.cardStepsUpdateBtn.addEventListener('click', async () => {
                const syncResult = syncCardStepsTextareaFromEditor(elements);
                if (!syncResult.success) {
                    showMessage(syncResult.error || '步骤更新失败', 'error');
                    return;
                }

                await saveCard(
                    elements,
                    showMessage,
                    loadCardsFn,
                    loadTestCardsFn,
                    loadApiCardsFn,
                    loadModelCardsFn,
                    loadHaikaBindCardsFn,
                    { closeDialog: false }
                );
            });
        }
        if (elements.cardStepEditorList) {
            const dragSession = createStepEditorDragSession();

            const clearDragState = () => {
                dragSession.active = false;
                dragSession.fromIndex = -1;
                dragSession.insertIndex = -1;
                dragSession.pointerId = null;
                clearStepEditorDropIndicator(elements);
                collectCardStepEditors(elements).forEach(card => {
                    card.classList.remove('step-card--dragging', 'step-card--drop-target', 'step-card--drop-before', 'step-card--drop-after');
                });
            };

            elements.cardStepEditorList.addEventListener('click', (event) => {
                const actionButton = event.target.closest('[data-step-action], [data-step-param-action]');
                if (!actionButton) {
                    return;
                }

                const action = String(actionButton.dataset.stepAction || actionButton.dataset.stepParamAction || '').trim();
                const card = actionButton.closest('[data-step-card]');
                if (!card) {
                    return;
                }

                if (action === 'add-param') {
                    const paramsList = card.querySelector('[data-step-params-list]');
                    if (!paramsList) {
                        return;
                    }

                    const row = document.createElement('div');
                    row.className = 'step-param-row';
                    row.setAttribute('data-step-param-row', '');
                    row.innerHTML = `
                        <input type="text" class="step-param-key" data-step-param-key placeholder="参数名">
                        <input type="text" class="step-param-value" data-step-param-value placeholder="参数值">
                        <button type="button" class="btn btn-secondary btn-small step-param-remove-btn" data-step-param-action="remove" title="删除参数">删除</button>
                    `;
                    paramsList.appendChild(row);
                    return;
                }

                if (action === 'toggle-fields') {
                    cycleStepEditorFieldsMode(card);
                    return;
                }

                if (actionButton.dataset.stepParamAction === 'remove') {
                    const row = actionButton.closest('[data-step-param-row]');
                    if (row && row.parentElement) {
                        row.remove();
                    }
                    return;
                }

                const syncResult = syncCardStepsTextareaFromEditor(elements);
                if (!syncResult.success) {
                    showMessage(syncResult.error || '步骤处理失败', 'error');
                    return;
                }

                const steps = Array.isArray(syncResult.steps) ? [...syncResult.steps] : [];
                const cardIndex = Array.from(elements.cardStepEditorList.querySelectorAll('[data-step-card]')).indexOf(card);
                if (cardIndex < 0) {
                    return;
                }

                if (action === 'remove') {
                    steps.splice(cardIndex, 1);
                    renderCardStepEditor(elements, steps);
                    renderCardStepProgressList(elements, elements.cardDebugState);
                    return;
                }

                if (action === 'duplicate') {
                    const duplicated = JSON.parse(JSON.stringify(steps[cardIndex] || {}));
                    steps.splice(cardIndex + 1, 0, duplicated);
                    renderCardStepEditor(elements, steps);
                    renderCardStepProgressList(elements, elements.cardDebugState);
                    return;
                }

                if (action === 'up' && cardIndex > 0) {
                    const reorderResult = reorderCardStepEditorSteps(elements, cardIndex, cardIndex - 1);
                    if (!reorderResult.success) {
                        showMessage(reorderResult.error || '步骤重排失败', 'error');
                        return;
                    }
                    renderCardStepProgressList(elements, elements.cardDebugState);
                    return;
                }

                if (action === 'down' && cardIndex < steps.length - 1) {
                    const reorderResult = reorderCardStepEditorSteps(elements, cardIndex, cardIndex + 1);
                    if (!reorderResult.success) {
                        showMessage(reorderResult.error || '步骤重排失败', 'error');
                        return;
                    }
                    renderCardStepProgressList(elements, elements.cardDebugState);
                }
            });

            elements.cardStepEditorList.addEventListener('change', (event) => {
                const target = event.target;
                if (!target || typeof target.matches !== 'function') {
                    return;
                }

                if (target.matches('[data-step-field="type"]')) {
                    const card = target.closest('[data-step-card]');
                    if (card) {
                        syncStepEditorCardAccent(card);
                        applyStepEditorCardVisibility(card);
                    }
                    renderCardStepProgressList(elements, elements.cardDebugState);
                    return;
                }

                if (target.matches('[data-step-field="selector"], [data-step-field="stop_selector"], [data-step-field="wait_for_element"], [data-step-field="wait_for_element_hidden"]')) {
                    const card = target.closest('[data-step-card]');
                    if (card) {
                        updateStepEditorSelectorPreview(card, String(target.dataset.stepField || '').trim());
                    }
                }
            });

            elements.cardStepEditorList.addEventListener('input', (event) => {
                const target = event.target;
                if (!target || typeof target.matches !== 'function') {
                    return;
                }

                if (target.matches('[data-step-field="selector"], [data-step-field="stop_selector"], [data-step-field="wait_for_element"], [data-step-field="wait_for_element_hidden"]')) {
                    const card = target.closest('[data-step-card]');
                    if (card) {
                        updateStepEditorSelectorPreview(card, String(target.dataset.stepField || '').trim());
                    }
                }
            });

            elements.cardStepEditorList.addEventListener('focusout', (event) => {
                const target = event.target;
                if (!target || typeof target.matches !== 'function') {
                    return;
                }

                const selectorFieldNames = [
                    '[data-step-field="selector"]',
                    '[data-step-field="stop_selector"]',
                    '[data-step-field="wait_for_element"]',
                    '[data-step-field="wait_for_element_hidden"]'
                ];
                if (!selectorFieldNames.some(selector => target.matches(selector))) {
                    return;
                }

                const fieldName = String(target.dataset.stepField || '').trim();
                const normalizedValue = normalizeStepEditorSelectorField(fieldName, target.value);
                if (normalizedValue === String(target.value || '').trim()) {
                    return;
                }

                target.value = normalizedValue;
                const syncResult = syncCardStepsTextareaFromEditor(elements);
                if (!syncResult.success) {
                    showMessage(syncResult.error || '步骤处理失败', 'error');
                    return;
                }

                const card = target.closest('[data-step-card]');
                if (card) {
                    updateStepEditorSelectorPreview(card, fieldName);
                }
                renderCardStepProgressList(elements, elements.cardDebugState);
            });

            elements.cardStepEditorList.addEventListener('pointerdown', (event) => {
                const handle = event.target.closest('[data-step-drag-handle]');
                if (!handle || event.button !== 0) {
                    return;
                }

                const card = handle.closest('[data-step-card]');
                if (!card) {
                    return;
                }

                const cards = collectCardStepEditors(elements);
                const fromIndex = cards.indexOf(card);
                if (fromIndex < 0) {
                    return;
                }

                event.preventDefault();
                dragSession.active = true;
                dragSession.fromIndex = fromIndex;
                dragSession.pointerId = event.pointerId;
                dragSession.insertIndex = fromIndex;
                card.classList.add('step-card--dragging');
                setStepEditorDropIndicator(elements, { index: fromIndex, insertIndex: fromIndex, position: 'before' });

                if (typeof handle.setPointerCapture === 'function') {
                    try {
                        handle.setPointerCapture(event.pointerId);
                    } catch (_error) {
                        // 某些浏览器在按钮上捕获指针会失败，忽略即可。
                    }
                }
            });

            elements.cardStepEditorList.addEventListener('pointermove', (event) => {
                if (!dragSession.active || dragSession.pointerId !== event.pointerId) {
                    return;
                }

                const location = getStepEditorDropLocation(elements, event.clientY);
                if (!location) {
                    return;
                }

                dragSession.insertIndex = location.insertIndex;
                setStepEditorDropIndicator(elements, location);
            });

            const finishPointerDrag = (event) => {
                if (!dragSession.active || dragSession.pointerId !== event.pointerId) {
                    return;
                }

                const fromIndex = dragSession.fromIndex;
                const insertIndex = dragSession.insertIndex;
                const result = applyStepEditorReorderFromIndex(elements, fromIndex, insertIndex);
                clearDragState();
                if (!result.success) {
                    showMessage(result.error || '步骤重排失败', 'error');
                    return;
                }

                renderCardStepProgressList(elements, elements.cardDebugState);
            };

            elements.cardStepEditorList.addEventListener('pointerup', finishPointerDrag);
            elements.cardStepEditorList.addEventListener('pointercancel', () => {
                clearDragState();
            });
        }
        if (elements.cardStepAddBtn) {
            elements.cardStepAddBtn.addEventListener('click', () => {
                const templateType = elements.cardStepTemplateValue
                    ? String(elements.cardStepTemplateValue.value || 'navigate').trim() || 'navigate'
                    : 'navigate';
                const result = addCardStepFromTemplate(elements, templateType);
                if (!result.success) {
                    showMessage(result.error || '新增步骤失败', 'error');
                    return;
                }

                renderCardStepProgressList(elements, elements.cardDebugState);
            });
        }
        if (elements.cardStepTemplateBtn && elements.cardStepTemplateMenu) {
            elements.cardStepTemplateBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                const willOpen = elements.cardStepTemplateMenu.hidden;
                setStepTemplatePickerOpen(elements, willOpen);
            });
            elements.cardStepTemplateMenu.addEventListener('click', (event) => {
                const option = event.target.closest('[data-step-template-option]');
                if (!option) {
                    return;
                }

                const value = String(option.dataset.stepTemplateOption || 'navigate').trim() || 'navigate';
                if (elements.cardStepTemplateValue) {
                    elements.cardStepTemplateValue.value = value;
                }
                setStepTemplatePickerOpen(elements, false);
                syncStepTemplateSelectAccent(elements);
            });
            document.addEventListener('click', (event) => {
                if (!elements.cardStepTemplatePicker) {
                    return;
                }
                if (elements.cardStepTemplatePicker.contains(event.target)) {
                    return;
                }
                setStepTemplatePickerOpen(elements, false);
            });
        }

        if (elements.cardDialogBaseTabBtn) {
            elements.cardDialogBaseTabBtn.addEventListener('click', () => activateCardEditorTab(elements, 'card-dialog-base-tab'));
        }
        if (elements.cardDialogDebugTabBtn) {
            elements.cardDialogDebugTabBtn.addEventListener('click', () => activateCardEditorTab(elements, 'card-dialog-debug-tab'));
        }
        if (elements.cardDialogApiServiceTabBtn) {
            elements.cardDialogApiServiceTabBtn.addEventListener('click', () => activateCardEditorTab(elements, 'card-dialog-api-service-tab'));
        }
        if (elements.cardApiServiceType && elements.cardApiServiceEndpoint) {
            elements.cardApiServiceType.addEventListener('change', () => {
                const endpointByType = {
                    text: '/v1/chat/completions',
                    image: '/v1/images/generations',
                    video: '/v1/videos/generations'
                };
                const knownEndpoints = new Set(Object.values(endpointByType));
                const currentEndpoint = String(elements.cardApiServiceEndpoint.value || '').trim();
                if (!currentEndpoint || knownEndpoints.has(currentEndpoint)) {
                    elements.cardApiServiceEndpoint.value = endpointByType[elements.cardApiServiceType.value] || endpointByType.image;
                }
            });
        }
        if (elements.cardDialogStepsTabBtn) {
            elements.cardDialogStepsTabBtn.addEventListener('click', () => activateCardEditorTab(elements, 'card-right-panel-steps-tab'));
        }
        if (elements.cardDialogPopupsTabBtn) {
            elements.cardDialogPopupsTabBtn.addEventListener('click', () => activateCardEditorTab(elements, 'card-right-panel-popups-tab'));
        }
        if (elements.debugCardBtn) {
            elements.debugCardBtn.addEventListener('click', async () => {
                const taskId = getCurrentDebugTaskId();
                if (taskId) {
                    try {
                        elements.debugCardBtn.disabled = true;
                        const result = await ipcRenderer.invoke('stop-task', taskId);
                        if (!result || result.success !== true) {
                            throw new Error(result?.error || '停止调试失败');
                        }
                        updateCardDebugPanel(elements, {
                            active: true,
                            stopping: true,
                            statusText: '正在停止调试运行...',
                            canPause: false,
                            canResume: false
                        });
                        showMessage('已请求停止调试运行', 'info');
                    } catch (error) {
                        const errorMessage = String(error?.message || '').trim();
                        if (/没有正在运行|不存在|已结束|不可用/.test(errorMessage)) {
                            resetCardDebugPanel(elements);
                            showMessage('调试任务已经结束，已恢复为可重新调试状态', 'info');
                        } else {
                            showMessage(`停止调试失败: ${errorMessage || '未知错误'}`, 'error');
                            updateCardDebugPanel(elements, {
                                active: true,
                                statusText: '调试仍在运行中',
                                canPause: true,
                                canResume: false
                            });
                        }
                    }
                    return;
                }

                await debugCard(elements, showMessage, getBrowserSettingsPatchFn);
            });
        }
        if (elements.cardDebugPauseBtn) {
            elements.cardDebugPauseBtn.addEventListener('click', async () => {
                const taskId = getCurrentDebugTaskId();
                const currentState = elements.cardDebugState && typeof elements.cardDebugState === 'object'
                    ? elements.cardDebugState
                    : {};
                const isPaused = currentState.paused === true;

                if (!taskId && !hasCurrentDebugTaskState()) {
                    showMessage('当前没有可操作的调试任务', 'warning');
                    return;
                }

                try {
                    elements.cardDebugPauseBtn.disabled = true;
                    if (isPaused) {
                        const result = await ipcRenderer.invoke('resume-task', taskId);
                        if (!result || result.success !== true) {
                            throw new Error(result?.error || '继续失败');
                        }
                        updateCardDebugPanel(elements, {
                            statusText: '继续执行中',
                            canPause: true,
                            canResume: false,
                            paused: false
                        });
                    } else {
                        const result = await ipcRenderer.invoke('pause-task', taskId);
                        if (!result || result.success !== true) {
                            throw new Error(result?.error || '暂停失败');
                        }
                        updateCardDebugPanel(elements, {
                            statusText: '已请求暂停，等待调试任务进入暂停状态...',
                            canPause: false,
                            canResume: true,
                            paused: true
                        });
                    }
                } catch (error) {
                    showMessage(`${isPaused ? '继续' : '暂停'}失败: ${error.message}`, 'error');
                    updateCardDebugPanel(elements, {
                        canPause: Boolean(getCurrentDebugTaskId()),
                        canResume: Boolean(getCurrentDebugTaskId()),
                        paused: isPaused
                    });
                }
            });
        }
        if (elements.cardDebugLoopBtn) {
            elements.cardDebugLoopBtn.addEventListener('click', async () => {
                try {
                    elements.cardDebugLoopBtn.disabled = true;
                    const result = await ipcRenderer.invoke(IPC_CHANNELS.cardDebugAction, {
                        action: 'debug-step-navigation',
                        direction: 'previous'
                    });
                    if (!result || result.success !== true) {
                        throw new Error(result?.error || '退回上一步失败');
                    }
                    updateCardDebugPanel(elements, {
                        statusText: '已选择上一步，等待继续',
                        canPause: false,
                        canResume: true,
                        paused: true,
                        runMode: 'step',
                        error: '',
                        failedStepError: ''
                    });
                } catch (error) {
                    showMessage(`退回上一步失败: ${error.message}`, 'error');
                    updateCardDebugPanel(elements, {
                        canPause: Boolean(getCurrentDebugTaskId()),
                        canResume: true,
                        paused: true
                    });
                }
            });
        }
        if (elements.cardDebugStepBtn) {
            elements.cardDebugStepBtn.addEventListener('click', async () => {
                try {
                    elements.cardDebugStepBtn.disabled = true;
                    const result = await ipcRenderer.invoke(IPC_CHANNELS.cardDebugAction, {
                        action: 'debug-step-navigation',
                        direction: 'next'
                    });
                    if (!result || result.success !== true) {
                        throw new Error(result?.error || '跳转下一步失败');
                    }
                    updateCardDebugPanel(elements, {
                        statusText: '已选择下一步，等待继续',
                        canPause: false,
                        canResume: true,
                        paused: true,
                        runMode: 'step',
                        error: '',
                        failedStepError: ''
                    });
                } catch (error) {
                    showMessage(`跳转下一步失败: ${error.message}`, 'error');
                    updateCardDebugPanel(elements, {
                        canPause: Boolean(getCurrentDebugTaskId()),
                        canResume: true,
                        paused: true
                    });
                }
            });
        }
        ipcRenderer.on(IPC_CHANNELS.cardEditorOpen, (_event, payload = {}) => {
            showCardDialog(payload.cardData || null, elements, toggleCharsetField, payload.cardMode || 'automation', payload.apiCardName || '');
            if (elements.cardDialog) {
                elements.cardDialog.style.display = 'flex';
            }
        });

        if (elements.cardUploadTargetScoreScope) {
            elements.cardUploadTargetScoreScope.addEventListener('change', () => setUploadTargetScoreControlsVisibility(elements));
        }
    }

    return {
        setupCardEventListeners
    };
};
