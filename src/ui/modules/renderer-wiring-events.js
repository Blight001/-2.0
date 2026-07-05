module.exports = function createRendererWiringEvents(deps) {
    const {
        elements,
        state,
        cardManager,
        cookieManager,
        cookieTester,
        clashManager,
        utils,
        logger,
        ipcRenderer,
        loadCookies,
        saveExecutionControls,
        saveExecutionUploadControls,
        updateExecutionUploadStatus,
        updateBrowserSettings,
        detectBrowserForSelect,
        setRunMode,
        DEFAULT_REGISTRATION_RUN_MODE,
        saveEmailConfig,
        loadHaikaBindAccountControls,
        saveHaikaBindAccountControls,
        updateHaikaBindAccountControls,
        startHaikaBinding,
        stopHaikaBinding,
        startExecution,
        stopExecution,
        parseCookieAccountInfo,
        hideCookieAccountContextMenu,
        hideCookieBatchContextMenu,
        showCookieAccountContextMenu,
        showCookieBatchContextMenu,
        updateCookieSelectionButton,
        redeemTrialBinding,
        openHaikaCategoryModal,
        refreshTrialSmsCode,
        loadHaikaCategories,
        getSelectedHaikaCategory,
        createHaikaCategory,
        setSelectedHaikaCategory,
        syncHaikaImportTargetCategory,
        loadHaikaKeys,
        showHaikaSuggestions,
        clearHaikaSuggestions,
        confirmHaikaImport,
        closeHaikaCategoryModal,
        loadHaikaTrialState,
        clearTrialInfo,
        setTrialStatus,
        setupConsole,
        setupTempEmailPanel,
        tempEmail,
        taskProgress,
        loadDrawerState,
        applyDrawerLayout,
        toggleLeftDrawer,
        toggleRightDrawer,
        activateMiddleTab,
        openProxyQuickSite,
        loadTcpServerConfig,
        loadApiServerConfig,
        saveApiServerConfig,
        startApiServer,
        stopApiServer,
        generateApiServerKey,
        testApiServerRequest,
        applyTcpManagedUiLockdown,
        ensureTcpManagedUiObserver,
        initializeAppRuntimeMode,
        syncExecutionCardStateFromServer,
        updateTcpConnectionPanelState,
        refreshClashStatus,
        setupAiAssistantPanel,
        handleCustomTestAccountAction,
        updateCustomTestAccountButtons
    } = deps;
    const { IPC_CHANNELS } = require('../../core/ipc/channels');
    const CUSTOM_TEST_ACCOUNT_ACCOUNT_KEY = 'custom-test-account-account';
    const CUSTOM_TEST_ACCOUNT_PASSWORD_KEY = 'custom-test-account-password';
    const persistBrowserSettingsChange = async () => {
        try {
            const saveResult = typeof saveExecutionControls === 'function'
                ? await saveExecutionControls()
                : { success: true };
            const updateResult = typeof updateBrowserSettings === 'function'
                ? await updateBrowserSettings()
                : { success: true };

            if (saveResult?.success === false || updateResult?.success === false) {
                const error = saveResult?.error || updateResult?.error || '保存浏览器设置失败';
                logger.warning(`浏览器设置保存失败: ${error}`);
                return { success: false, error };
            }

            logger.info('浏览器设置已保存');
            return { success: true };
        } catch (error) {
            logger.warning(`浏览器设置保存异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    };

    function setupEventListeners() {
        applyDrawerLayout(loadDrawerState(), false);
        if (elements.leftDrawerBubble) {
            elements.leftDrawerBubble.addEventListener('click', toggleLeftDrawer);
        }
        if (elements.rightDrawerBubble) {
            elements.rightDrawerBubble.addEventListener('click', toggleRightDrawer);
        }

        if (taskProgress && typeof taskProgress.bindTaskHistoryToggle === 'function') {
            taskProgress.bindTaskHistoryToggle();
        }

        const refreshLinkedModelCards = async (apiCardName = '') => {
            const normalizedApiCardName = String(
                apiCardName
                || cardManager.getCurrentApiCard?.()
                || ''
            ).trim();

            if (elements.addModelCardBtn) {
                elements.addModelCardBtn.disabled = !normalizedApiCardName;
            }
            if (elements.refreshModelCardBtn) {
                elements.refreshModelCardBtn.disabled = !normalizedApiCardName;
            }

            if (!normalizedApiCardName) {
                cardManager.setCurrentModelCard?.(null);
                state.currentModelCard = null;
                cardManager.renderDeferredLoadPlaceholder(elements, 'model', '请先选择一个API卡片');
                return;
            }

            cardManager.setCurrentModelCard?.(null);
            state.currentModelCard = null;
            await cardManager.loadModelCards({ forceReload: true, apiCardName: normalizedApiCardName });
        };

        if (elements.cookieTabHeaders) {
            let dragState = {
                active: false,
                startX: 0,
                startScrollLeft: 0,
                moved: false,
                pointerId: null
            };

            const stopCookieTabDrag = () => {
                if (!dragState.active) {
                    return;
                }

                dragState.active = false;
                dragState.pointerId = null;
                elements.cookieTabHeaders.classList.remove('is-dragging');
            };

            elements.cookieTabHeaders.addEventListener('mousedown', (event) => {
                if (event.button !== 0) {
                    return;
                }

                const interactiveTarget = event.target.closest('button, a, input, label, select, textarea');
                if (!interactiveTarget) {
                    return;
                }

                dragState.active = true;
                dragState.startX = event.clientX;
                dragState.startScrollLeft = elements.cookieTabHeaders.scrollLeft;
                dragState.moved = false;
                dragState.pointerId = null;
                elements.cookieTabHeaders.classList.add('is-dragging');
            });

            elements.cookieTabHeaders.addEventListener('mousemove', (event) => {
                if (!dragState.active) {
                    return;
                }

                const deltaX = event.clientX - dragState.startX;
                if (Math.abs(deltaX) > 3) {
                    dragState.moved = true;
                }

                elements.cookieTabHeaders.scrollLeft = dragState.startScrollLeft - deltaX;
            });

            window.addEventListener('mouseup', () => {
                stopCookieTabDrag();
            });

            elements.cookieTabHeaders.addEventListener('mouseleave', () => {
                if (dragState.active) {
                    stopCookieTabDrag();
                }
            });

            elements.cookieTabHeaders.addEventListener('click', (event) => {
                if (dragState.moved) {
                    event.preventDefault();
                    event.stopPropagation();
                    stopCookieTabDrag();
                }
            }, true);
        }

        if (elements.middleTabButtons && typeof elements.middleTabButtons.forEach === 'function') {
            elements.middleTabButtons.forEach((button) => {
                button.addEventListener('click', () => {
                    activateMiddleTab(button.dataset.tab);
                });
            });
        }

        if (elements.exitAppBtn) {
            elements.exitAppBtn.addEventListener('click', async () => {
                const isEmbedded = state.executionEmbedded === true
                    || String(document.documentElement?.dataset?.executionEmbedded || '').trim() === 'true';

                if (isEmbedded) {
                    elements.exitAppBtn.disabled = true;
                    if (elements.statusLabel) {
                        elements.statusLabel.textContent = '由宿主接管关闭';
                    }
                    try {
                        const result = await ipcRenderer.invoke('close-main-window');
                        if (!result || result.success !== true) {
                            throw new Error(result?.error || '关闭标签失败');
                        }
                    } catch (error) {
                        elements.exitAppBtn.disabled = false;
                        if (elements.statusLabel) {
                            elements.statusLabel.textContent = '就绪';
                        }
                        logger.error(`关闭标签失败: ${error.message}`);
                        utils.showMessage(`关闭标签失败: ${error.message}`, 'error', elements);
                    }
                    return;
                }

                elements.exitAppBtn.disabled = true;
                if (elements.statusLabel) {
                    elements.statusLabel.textContent = '正在退出应用...';
                }

                try {
                    const result = await ipcRenderer.invoke('exit-app');
                    if (!result || result.success !== true) {
                        throw new Error(result?.error || '关闭失败');
                    }
                } catch (error) {
                    elements.exitAppBtn.disabled = false;
                    if (elements.statusLabel) {
                        elements.statusLabel.textContent = '就绪';
                    }
                    logger.error(`退出应用失败: ${error.message}`);
                    utils.showMessage(`退出失败: ${error.message}`, 'error', elements);
                }
            });
        }

        if (elements.emailConnectBtn) {
            elements.emailConnectBtn.addEventListener('click', async () => {
                if (typeof saveEmailConfig === 'function') {
                    await saveEmailConfig();
                }
                await utils.connectEmail(elements, utils.appendEmailLog, utils.updateEmailStatus);
            });
        }
        if (elements.emailDisconnectBtn) {
            elements.emailDisconnectBtn.addEventListener('click', async () => {
                await utils.disconnectEmail(elements, utils.appendEmailLog, utils.updateEmailStatus);
            });
        }
        if (elements.emailConfigSaveBtn) {
            elements.emailConfigSaveBtn.addEventListener('click', async () => {
                if (typeof saveEmailConfig === 'function') {
                    await saveEmailConfig();
                }
            });
        }
        if (elements.saveEmailLogBtn) {
            elements.saveEmailLogBtn.addEventListener('click', utils.saveEmailLog);
        }
        if (elements.clearEmailLogBtn) {
            elements.clearEmailLogBtn.addEventListener('click', utils.clearEmailLog);
        }

        if (elements.emailModeConnectBtn) {
            elements.emailModeConnectBtn.addEventListener('click', async () => {
                await utils.activateEmailMode('connect', elements, utils.appendEmailLog, utils.updateEmailStatus);
                if (tempEmail && typeof tempEmail.setMode === 'function') {
                    await tempEmail.setMode('tcp');
                }
            });
        }
        if (elements.emailModeOutlookBtn) {
            elements.emailModeOutlookBtn.addEventListener('click', async () => {
                await utils.activateEmailMode('outlook', elements, utils.appendEmailLog, utils.updateEmailStatus);
                if (tempEmail && typeof tempEmail.setOutlookMode === 'function') {
                    await tempEmail.setOutlookMode();
                } else if (tempEmail && typeof tempEmail.setMode === 'function') {
                    await tempEmail.setMode('outlook');
                }
            });
        }
        if (elements.emailModeTempBtn) {
            elements.emailModeTempBtn.addEventListener('click', async () => {
                await utils.activateEmailMode('temp', elements, utils.appendEmailLog, utils.updateEmailStatus);
                if (tempEmail && typeof tempEmail.setMode === 'function') {
                    await tempEmail.setMode('temp');
                }
            });
        }
        if (elements.emailModeApiBtn) {
            elements.emailModeApiBtn.addEventListener('click', async () => {
                await utils.activateEmailMode('api', elements, utils.appendEmailLog, utils.updateEmailStatus);
                if (tempEmail && typeof tempEmail.openApiMode === 'function') {
                    await tempEmail.openApiMode();
                }
            });
        }
        if (elements.emailApiBaseUrl || elements.emailApiKey) {
            const saveApiConfig = async () => {
                const apiConfig = {
                    ...(tempEmail?.state?.apiConfig || {}),
                    baseUrl: String(elements.emailApiBaseUrl?.value || '').trim(),
                    apiKey: String(elements.emailApiKey?.value || '').trim()
                };
                if (tempEmail && typeof tempEmail.setApiConfig === 'function') {
                    await tempEmail.setApiConfig(apiConfig);
                } else if (tempEmail && typeof tempEmail.state === 'object') {
                    tempEmail.state.apiConfig = apiConfig;
                    await ipcRenderer.invoke(IPC_CHANNELS.tempEmailSaveApiConfig, apiConfig);
                }
            };
            elements.emailApiBaseUrl?.addEventListener('blur', async () => {
                await saveApiConfig();
            });
            elements.emailApiKey?.addEventListener('blur', async () => {
                await saveApiConfig();
            });
        }
        if (elements.emailApiGenerateBtn) {
            elements.emailApiGenerateBtn.addEventListener('click', async () => {
                if (tempEmail && typeof tempEmail.generateEmail === 'function') {
                    logger.info('点击 API 按钮: 生成邮箱');
                    const result = await tempEmail.generateEmail();
                    if (!result?.success) {
                        utils.showMessage(result?.error || '生成邮箱失败', 'error', elements);
                    }
                }
            });
        }
        if (elements.emailApiCopyBtn) {
            elements.emailApiCopyBtn.addEventListener('click', async () => {
                if (tempEmail && typeof tempEmail.copyGeneratedEmail === 'function') {
                    logger.info('点击 API 按钮: 复制邮箱');
                    const result = await tempEmail.copyGeneratedEmail();
                    if (!result?.success) {
                        utils.showMessage(result?.error || '复制邮箱失败', 'error', elements);
                    }
                }
            });
        }
        if (elements.emailApiListBtn) {
            elements.emailApiListBtn.addEventListener('click', async () => {
                if (tempEmail && typeof tempEmail.listEmails === 'function') {
                    logger.info('点击 API 按钮: 查询收件箱');
                    const result = await tempEmail.listEmails();
                    if (!result?.success) {
                        utils.showMessage(result?.error || '查询收件箱失败', 'error', elements);
                    }
                }
            });
        }
        if (elements.emailApiDetailBtn) {
            elements.emailApiDetailBtn.addEventListener('click', async () => {
                if (tempEmail && typeof tempEmail.getEmailDetail === 'function') {
                    logger.info('点击 API 按钮: 查看详情');
                    const result = await tempEmail.getEmailDetail();
                    if (!result?.success) {
                        utils.showMessage(result?.error || '查看详情失败', 'error', elements);
                    }
                }
            });
        }
        if (elements.emailApiDeleteBtn) {
            elements.emailApiDeleteBtn.addEventListener('click', async () => {
                if (tempEmail && typeof tempEmail.deleteEmail === 'function') {
                    logger.info('点击 API 按钮: 删除邮件');
                    const result = await tempEmail.deleteEmail();
                    if (!result?.success) {
                        utils.showMessage(result?.error || '删除邮件失败', 'error', elements);
                    }
                }
            });
        }
        if (elements.emailApiClearBtn) {
            elements.emailApiClearBtn.addEventListener('click', async () => {
                if (tempEmail && typeof tempEmail.clearEmails === 'function') {
                    logger.info('点击 API 按钮: 清空收件箱');
                    const result = await tempEmail.clearEmails();
                    if (!result?.success) {
                        utils.showMessage(result?.error || '清空收件箱失败', 'error', elements);
                    }
                }
            });
        }

        if (typeof setupAiAssistantPanel === 'function') {
            setupAiAssistantPanel();
        }
        if (typeof setupTempEmailPanel === 'function') {
            setupTempEmailPanel();
        }

        cardManager.setupCardEventListeners(
            elements,
            (msg, type) => utils.showMessage(msg, type, elements),
            () => cardManager.hideCardDialog(elements),
            cardManager.loadCards,
            (type) => utils.toggleCharsetField(type, elements),
            cardManager.loadTestCards,
            cardManager.loadApiCards,
            cardManager.loadModelCards,
            cardManager.loadHaikaBindCards,
            deps.getActiveClashBrowserSettingsPatch,
            state
        );

        void refreshLinkedModelCards(cardManager.getCurrentApiCard?.() || '');

        if (String(document.body?.dataset?.view || '').trim() === 'card-editor') {
            void (async () => {
                try {
                    const result = await ipcRenderer.invoke(IPC_CHANNELS.getCardEditorWindowState);
                    const payload = result?.success ? result.payload : null;
                    if (String(payload?.cardMode || '').trim() === 'model' && String(payload?.apiCardName || '').trim()) {
                        cardManager.setCurrentApiCard?.(payload.apiCardName);
                        state.currentApiCard = String(payload.apiCardName || '').trim();
                    }
                    cardManager.showCardDialog(
                        payload?.cardData || null,
                        elements,
                        (type) => utils.toggleCharsetField(type, elements),
                        payload?.cardMode || 'register',
                        payload?.apiCardName || ''
                    );
                    if (String(payload?.cardMode || '').trim() === 'model') {
                        void refreshLinkedModelCards(payload?.apiCardName || cardManager.getCurrentApiCard?.() || state.currentApiCard || '');
                    }
                    if (elements.cardDialog) {
                        elements.cardDialog.style.display = 'flex';
                    }
                } catch (error) {
                    logger.warn?.(`加载卡片编辑器初始状态失败: ${error.message}`);
                }
            })();
        }

        cardManager.renderDeferredLoadPlaceholder(elements, 'register');
        cardManager.renderDeferredLoadPlaceholder(elements, 'test');
        cardManager.renderDeferredLoadPlaceholder(elements, 'api');
        cardManager.renderDeferredLoadPlaceholder(elements, 'model', '请先选择一个API卡片');
        cardManager.renderDeferredLoadPlaceholder(elements, 'haikaBind');

        window.addEventListener('cards-loaded', (e) => {
            cardManager.renderCardList(e.detail, elements, (cardName) => {
                cardManager.setCurrentCard(cardName);
                state.currentCard = cardName;
                loadCookies();
            }, 'register');
        });

        window.addEventListener('test-cards-loaded', (e) => {
            cardManager.renderCardList(e.detail, elements, (cardName) => {
                cardManager.setCurrentTestCard(cardName);
            }, 'test');
        });

        window.addEventListener('api-cards-loaded', (e) => {
            cardManager.renderCardList(e.detail, elements, (cardName) => {
                cardManager.setCurrentApiCard(cardName);
                state.currentApiCard = cardName;
                void refreshLinkedModelCards(cardName);
            }, 'api');

            void refreshLinkedModelCards(cardManager.getCurrentApiCard?.() || '');
        });

        window.addEventListener('model-cards-loaded', (e) => {
            cardManager.renderCardList(e.detail, elements, (cardName) => {
                cardManager.setCurrentModelCard(cardName);
                state.currentModelCard = cardName;
            }, 'model');
        });

        window.addEventListener('haika-bind-cards-loaded', (e) => {
            cardManager.renderCardList(e.detail, elements, (cardName) => {
                cardManager.setCurrentHaikaBindCard(cardName);
                state.currentHaikaBindCard = cardName;
            }, 'haikaBind');
        });

        ipcRenderer.on('execution-tcp-connection-updated', (_event, payload = {}) => {
            state.executionTcpEnabled = payload.executionTcpEnabled === true;
            state.executionTcpControlLocked = payload.executionTcpControlLocked === true;
            state.executionTcpControlState = payload.executionTcpControlState || {};
            state.executionTcpEndpoint = payload.executionTcpEndpoint || null;
            state.executionTcpReconnectEnabled = payload.executionTcpReconnectEnabled !== false;
            state.executionTcpConnectionStatus = payload.executionTcpConnectionStatus || null;
            updateTcpConnectionPanelState();
        });

        ipcRenderer.on('execution-card-updated', (_event, payload = {}) => {
            const cardMode = payload?.card_type === 'test'
                ? 'test'
                : payload?.card_type === 'haikaBind'
                    ? 'haikaBind'
                    : 'register';

            if (!state.executionTcpEnabled) {
                return;
            }

            const label = cardMode === 'test'
                ? '测试'
                : cardMode === 'haikaBind'
                    ? '海卡绑定'
                    : '自动化';
            const action = String(payload?.action || 'update');
            const cardName = String(payload?.card_name || '').trim();
            logger.info(`收到${label}卡片更新通知: ${action}${cardName ? ` -> ${cardName}` : ''}`);
            void syncExecutionCardStateFromServer(cardMode);
        });

        ipcRenderer.on(IPC_CHANNELS.cardEditorOpen, (_event, payload = {}) => {
            if (String(payload?.cardMode || '').trim() === 'model') {
                if (String(payload?.apiCardName || '').trim()) {
                    cardManager.setCurrentApiCard?.(payload.apiCardName);
                    state.currentApiCard = String(payload.apiCardName || '').trim();
                }
                void refreshLinkedModelCards(String(payload?.apiCardName || ''));
            }
        });

        ipcRenderer.on('execution-control-state-updated', (_event, payload = {}) => {
            state.executionTcpControlState = payload.control_state || {};
            state.executionTcpControlLocked = payload.control_locked === true;
            applyTcpManagedUiLockdown();
            ensureTcpManagedUiObserver();

            if (payload.control_locked === true) {
                logger.warning('服务器已锁定本地控制');
            } else {
                logger.info('服务器已恢复本地控制');
            }
        });

        if (elements.browserType) {
            elements.browserType.addEventListener('change', () => {
                void persistBrowserSettingsChange();
            });
        }
        if (elements.headlessMode) {
            elements.headlessMode.addEventListener('change', () => {
                void persistBrowserSettingsChange();
            });
        }
        if (elements.browserBlockImagesVideos) {
            elements.browserBlockImagesVideos.addEventListener('change', () => {
                void persistBrowserSettingsChange();
            });
        }
        if (elements.browserRemoveWatermarkPlugin) {
            elements.browserRemoveWatermarkPlugin.addEventListener('change', () => {
                void persistBrowserSettingsChange();
            });
        }
        if (elements.runModeButtons && typeof elements.runModeButtons.forEach === 'function') {
            elements.runModeButtons.forEach((button) => {
                button.addEventListener('click', () => {
                    const selectedMode = parseInt(button.dataset.runMode, 10);
                    setRunMode(Number.isFinite(selectedMode) ? selectedMode : DEFAULT_REGISTRATION_RUN_MODE);
                    saveExecutionControls();
                });
            });
        }
        if (elements.detectBrowserBtn) {
            elements.detectBrowserBtn.addEventListener('click', () =>
                detectBrowserForSelect(elements.browserType, elements.detectBrowserBtn, {
                    afterDetect: persistBrowserSettingsChange,
                    mirrorTarget: elements.testBrowserType
                })
            );
        }
        if (elements.testDetectBrowserBtn) {
            elements.testDetectBrowserBtn.addEventListener('click', () =>
                detectBrowserForSelect(elements.testBrowserType, elements.testDetectBrowserBtn)
            );
        }

        if (elements.haikaBindConcurrent) {
            elements.haikaBindConcurrent.addEventListener('change', saveHaikaBindAccountControls);
        }
        if (elements.haikaBindAccountFolder) {
            elements.haikaBindAccountFolder.addEventListener('change', async () => {
                saveHaikaBindAccountControls();
                const cookies = await cookieManager.loadCookies();
                updateHaikaBindAccountControls(cookies);
            });
        }
        if (elements.haikaBindAccountFilter) {
            elements.haikaBindAccountFilter.addEventListener('change', saveHaikaBindAccountControls);
        }
        if (elements.haikaBindStartBtn) {
            elements.haikaBindStartBtn.addEventListener('click', startHaikaBinding);
        }
        if (elements.haikaBindStopBtn) {
            elements.haikaBindStopBtn.addEventListener('click', stopHaikaBinding);
        }

        document.querySelectorAll('.tab-header').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const target = btn.dataset.tab;
                document.querySelectorAll('.tab-header').forEach((h) => h.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.tab-content').forEach((c) => {
                    if (c.id === target) {
                        c.style.display = '';
                    } else {
                        c.style.display = 'none';
                    }
                });

                if (target === 'tab-cards') {
                    await cardManager.ensureCardsLoaded('register');
                }
                if (target === 'tab-account-test') {
                    await cardManager.ensureCardsLoaded('test');
                }
                if (target === 'tab-automation') {
                    await cardManager.ensureCardsLoaded('api');
                    await cardManager.ensureCardsLoaded('model');
                }
                if (target === 'tab-trial-bind') {
                    await cardManager.ensureCardsLoaded('haikaBind');
                }
            });
        });

        document.querySelectorAll('.right-tab-header').forEach((btn) => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.tab;
                document.querySelectorAll('.right-tab-header').forEach((h) => h.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.right-tab-content').forEach((content) => {
                    if (content.id === target) {
                        content.style.display = '';
                        content.classList.add('active');
                    } else {
                        content.style.display = 'none';
                        content.classList.remove('active');
                    }
                });

                if (target === 'right-tab-proxy') {
                    refreshClashStatus(elements, clashManager.showClashError, clashManager.updateClashProfileSelect, clashManager.loadClashProfileNodes, logger);
                }
            });
        });

        document.querySelectorAll('.trial-bind-tab-header').forEach((btn) => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.tab;
                document.querySelectorAll('.trial-bind-tab-header').forEach((h) => {
                    const isActive = h === btn;
                    h.classList.toggle('active', isActive);
                    h.setAttribute('aria-selected', isActive ? 'true' : 'false');
                });
                document.querySelectorAll('.trial-bind-tab-content').forEach((content) => {
                    const isActive = content.id === target;
                    content.classList.toggle('active', isActive);
                    content.style.display = isActive ? '' : 'none';
                });
            });
        });

        elements.startBtn.addEventListener('click', startExecution);
        elements.stopBtn.addEventListener('click', stopExecution);
        if (elements.customTestAccountBtn && typeof handleCustomTestAccountAction === 'function') {
            elements.customTestAccountBtn.addEventListener('click', () => {
                void handleCustomTestAccountAction(loadCookies);
            });
        }
        if (elements.customTestAccountAccount) {
            const persistAccount = () => {
                try {
                    localStorage.setItem(CUSTOM_TEST_ACCOUNT_ACCOUNT_KEY, String(elements.customTestAccountAccount.value || '').trim());
                } catch (_error) {}
            };
            elements.customTestAccountAccount.addEventListener('input', persistAccount);
            elements.customTestAccountAccount.addEventListener('change', persistAccount);
            elements.customTestAccountAccount.addEventListener('blur', persistAccount);
        }
        if (elements.customTestAccountPassword) {
            const persistPassword = () => {
                try {
                    localStorage.setItem(CUSTOM_TEST_ACCOUNT_PASSWORD_KEY, String(elements.customTestAccountPassword.value || '').trim());
                } catch (_error) {}
            };
            elements.customTestAccountPassword.addEventListener('input', persistPassword);
            elements.customTestAccountPassword.addEventListener('change', persistPassword);
            elements.customTestAccountPassword.addEventListener('blur', persistPassword);
        }
        if (typeof updateCustomTestAccountButtons === 'function') {
            updateCustomTestAccountButtons();
        }
        elements.clearConsoleBtn.addEventListener('click', utils.clearConsole);

        if (elements.cookieSelectAllBtn) {
            elements.cookieSelectAllBtn.addEventListener('click', () => {
                const summary = cookieManager.getCookieSelectionSummary();
                if (summary.total === 0) {
                    return;
                }

                if (summary.allSelected) {
                    cookieManager.clearCookieSelection();
                } else {
                    cookieManager.selectAllCookies();
                }
            });
        }

        elements.refreshCookiesBtn.addEventListener('click', loadCookies);

        document.addEventListener('keydown', (event) => {
            if (!(event.ctrlKey || event.metaKey) || String(event.key || '').toLowerCase() !== 'a') {
                return;
            }

            const activeCookieTab = document.querySelector('#right-tab-cookie.right-tab-content.active');
            if (!activeCookieTab) {
                return;
            }

            const activeElement = document.activeElement;
            const isEditable = activeElement && (
                activeElement.isContentEditable ||
                ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName)
            );
            if (isEditable) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            cookieManager.selectCurrentCookieTabCookies();
        }, true);

        document.addEventListener('contextmenu', (event) => {
            const row = event.target.closest ? event.target.closest('tr[data-account-info]') : null;
            if (!row) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const accountInfo = parseCookieAccountInfo(row.dataset.accountInfo);
            if (!accountInfo) {
                utils.showMessage('无法识别该账号信息', 'warning', elements);
                return;
            }

            hideCookieAccountContextMenu();
            hideCookieBatchContextMenu();

            const summary = cookieManager.getCookieSelectionSummary();
            if (summary.selected > 1) {
                showCookieBatchContextMenu(event.clientX, event.clientY);
                return;
            }

            showCookieAccountContextMenu(event.clientX, event.clientY, accountInfo, row);
        }, true);

        document.addEventListener('click', (event) => {
            const clickedAccountMenu = event.target.closest && event.target.closest('#cookie-account-context-menu');
            const clickedBatchMenu = event.target.closest && event.target.closest('#cookie-batch-context-menu');
            if (clickedAccountMenu || clickedBatchMenu) {
                return;
            }

            hideCookieAccountContextMenu();
            hideCookieBatchContextMenu();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                hideCookieAccountContextMenu();
                hideCookieBatchContextMenu();
            }
        });

        window.addEventListener('scroll', hideCookieAccountContextMenu, true);
        window.addEventListener('resize', hideCookieAccountContextMenu);
        window.addEventListener('scroll', hideCookieBatchContextMenu, true);
        window.addEventListener('resize', hideCookieBatchContextMenu);
        window.addEventListener('cookie-selection-changed', updateCookieSelectionButton);

        if (elements.testCookiesBtn) {
            elements.testCookiesBtn.addEventListener('click', () => {
                void cookieTester.handleCookieTestToggle(
                    elements,
                    utils.showMessage,
                    () => {
                        const testCardName = cardManager.getCurrentTestCard();
                        if (!testCardName) {
                            utils.showMessage('请先选择一个测试卡片', 'warning', elements);
                            return;
                        }
                        return cookieTester.startCookieTesting(elements, utils.showMessage, logger, loadCookies, testCardName);
                    },
                    () => cookieTester.stopCookieTesting(logger, utils.showMessage, () => cookieTester.finishCookieTesting(elements))
                );
            });
        }

        if (elements.openCookieFolderBtn) {
            elements.openCookieFolderBtn.addEventListener('click', () =>
                cookieManager.openCookieFolder((msg, type) => utils.showMessage(msg, type, elements))
            );
        }

        if (elements.tcpSettingsSaveBtn) {
            elements.tcpSettingsSaveBtn.addEventListener('click', () => {
                void deps.handleTcpSettingsSave();
            });
        }
        if (elements.httpSettingsSaveBtn) {
            elements.httpSettingsSaveBtn.addEventListener('click', () => {
                void saveExecutionUploadControls();
            });
        }
        if (elements.tcpConnectionConsoleClearBtn) {
            elements.tcpConnectionConsoleClearBtn.addEventListener('click', () => {
                deps.clearTcpConnectionConsole();
            });
        }
        if (elements.uploadModeTcpBtn) {
            elements.uploadModeTcpBtn.addEventListener('click', () => {
                if (typeof activateUploadMode === 'function') {
                    activateUploadMode('tcp');
                } else if (typeof utils.activateUploadMode === 'function') {
                    utils.activateUploadMode('tcp');
                }
            });
        }
        if (elements.uploadModeHttpBtn) {
            elements.uploadModeHttpBtn.addEventListener('click', () => {
                if (typeof activateUploadMode === 'function') {
                    activateUploadMode('http');
                } else if (typeof utils.activateUploadMode === 'function') {
                    utils.activateUploadMode('http');
                }
            });
        }
        if (elements.tcpServerUrl) {
            elements.tcpServerUrl.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    elements.tcpSettingsSaveBtn?.click();
                }
            });
        }
        if (elements.tcpAutoReconnectEnabled) {
            elements.tcpAutoReconnectEnabled.addEventListener('change', () => {
                elements.tcpSettingsSaveBtn?.click();
            });
        }
        if (elements.apiSettingsSaveBtn) {
            elements.apiSettingsSaveBtn.addEventListener('click', async () => {
                const result = await saveApiServerConfig();
                utils.showMessage(result?.success ? 'API设置已保存' : (result?.error || 'API设置保存失败'), result?.success ? 'success' : 'error', elements);
            });
        }
        if (elements.apiSettingsReloadBtn) {
            elements.apiSettingsReloadBtn.addEventListener('click', async () => {
                const result = await loadApiServerConfig();
                utils.showMessage(result?.success ? 'API设置已重载' : (result?.error || 'API设置重载失败'), result?.success ? 'success' : 'error', elements);
            });
        }
        if (elements.apiServerStartBtn) {
            elements.apiServerStartBtn.addEventListener('click', async () => {
                const result = await startApiServer();
                utils.showMessage(result?.success ? '本地API服务已开启' : (result?.error || '本地API服务开启失败'), result?.success ? 'success' : 'error', elements);
            });
        }
        if (elements.apiServerStopBtn) {
            elements.apiServerStopBtn.addEventListener('click', async () => {
                const result = await stopApiServer();
                utils.showMessage(result?.success ? '本地API服务已关闭' : (result?.error || '本地API服务关闭失败'), result?.success ? 'success' : 'error', elements);
            });
        }
        if (elements.apiServerGenerateKeyBtn) {
            elements.apiServerGenerateKeyBtn.addEventListener('click', async () => {
                const result = await generateApiServerKey();
                utils.showMessage(result?.success ? 'API Key 已生成' : (result?.error || 'API Key 生成失败'), result?.success ? 'success' : 'error', elements);
            });
        }
        if (elements.apiTextTestBtn) {
            elements.apiTextTestBtn.addEventListener('click', async () => {
                const result = await testApiServerRequest('text', elements.apiTextTestBtn);
                utils.showMessage(
                    result?.success
                        ? `文本接口测试成功${result?.statusCode ? ` (HTTP ${result.statusCode})` : ''}`
                        : `文本接口测试失败${result?.statusCode ? ` (HTTP ${result.statusCode})` : `: ${result?.error || '未知错误'}`}`,
                    result?.success ? 'success' : 'error',
                    elements
                );
            });
        }
        if (elements.apiImageTestBtn) {
            elements.apiImageTestBtn.addEventListener('click', async () => {
                const result = await testApiServerRequest('image', elements.apiImageTestBtn);
                utils.showMessage(
                    result?.success
                        ? `图片接口测试成功${result?.statusCode ? ` (HTTP ${result.statusCode})` : ''}`
                        : `图片接口测试失败${result?.statusCode ? ` (HTTP ${result.statusCode})` : `: ${result?.error || '未知错误'}`}`,
                    result?.success ? 'success' : 'error',
                    elements
                );
            });
        }
        if (elements.apiVideoTestBtn) {
            elements.apiVideoTestBtn.addEventListener('click', async () => {
                const result = await testApiServerRequest('video', elements.apiVideoTestBtn);
                utils.showMessage(
                    result?.success
                        ? `视频接口测试成功${result?.statusCode ? ` (HTTP ${result.statusCode})` : ''}`
                        : `视频接口测试失败${result?.statusCode ? ` (HTTP ${result.statusCode})` : `: ${result?.error || '未知错误'}`}`,
                    result?.success ? 'success' : 'error',
                    elements
                );
            });
        }
        if (elements.apiServerConsoleClearBtn && elements.apiServerConsoleOutput) {
            elements.apiServerConsoleClearBtn.addEventListener('click', () => {
                elements.apiServerConsoleOutput.innerHTML = '<div class="api-server-console-empty">暂无请求记录</div>';
            });
        }

        if (elements.trialRedeemBtn) {
            elements.trialRedeemBtn.addEventListener('click', redeemTrialBinding);
        }
        if (elements.trialOpenCategoryModalBtn) {
            elements.trialOpenCategoryModalBtn.addEventListener('click', openHaikaCategoryModal);
        }
        if (elements.trialRefreshSmsBtn) {
            elements.trialRefreshSmsBtn.addEventListener('click', refreshTrialSmsCode);
        }
        if (elements.trialRefreshCategoriesBtn) {
            elements.trialRefreshCategoriesBtn.addEventListener('click', () => loadHaikaCategories(getSelectedHaikaCategory()));
        }
        if (elements.trialCreateCategoryBtn) {
            elements.trialCreateCategoryBtn.addEventListener('click', createHaikaCategory);
        }
        if (elements.trialCategorySelect) {
            elements.trialCategorySelect.addEventListener('change', async () => {
                setSelectedHaikaCategory(elements.trialCategorySelect.value);
                syncHaikaImportTargetCategory();
                await loadHaikaKeys();
            });
        }
        if (elements.trialCardKey) {
            elements.trialCardKey.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    openHaikaCategoryModal();
                }
            });
            elements.trialCardKey.addEventListener('input', () => {
                if (elements.trialCacheTip) {
                    elements.trialCacheTip.textContent = '仅用于接口测试';
                }
            });
            elements.trialCardKey.addEventListener('focus', () => {
                showHaikaSuggestions();
            });
            elements.trialCardKey.addEventListener('blur', () => {
                clearHaikaSuggestions();
            });
            elements.trialCardKey.addEventListener('click', showHaikaSuggestions);
        }
        if (elements.trialKeySuggestions) {
            elements.trialKeySuggestions.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });
        }
        if (elements.haikaImportConfirmBtn) {
            elements.haikaImportConfirmBtn.addEventListener('click', confirmHaikaImport);
        }
        if (elements.closeHaikaCategoryModalBtn) {
            elements.closeHaikaCategoryModalBtn.addEventListener('click', closeHaikaCategoryModal);
        }
        if (elements.closeHaikaCategoryModalBtn2) {
            elements.closeHaikaCategoryModalBtn2.addEventListener('click', closeHaikaCategoryModal);
        }
        if (elements.haikaCategoryModal) {
            elements.haikaCategoryModal.addEventListener('click', (e) => {
                if (e.target === elements.haikaCategoryModal) {
                    closeHaikaCategoryModal();
                }
            });
        }

        if (elements.popupsTutorialBtn) {
            elements.popupsTutorialBtn.addEventListener('click', () => utils.showTutorial('popups', elements));
        }
        if (elements.stepsTutorialBtn) {
            elements.stepsTutorialBtn.addEventListener('click', () => utils.showTutorial('steps', elements));
        }
        if (elements.closeTutorialBtn) {
            elements.closeTutorialBtn.addEventListener('click', () => utils.hideTutorial(elements));
        }
        if (elements.tutorialOkBtn) {
            elements.tutorialOkBtn.addEventListener('click', () => utils.hideTutorial(elements));
        }
        if (elements.tutorialDialog) {
            elements.tutorialDialog.addEventListener('click', (e) => {
                if (e.target === elements.tutorialDialog) {
                    utils.hideTutorial(elements);
                }
            });
        }

        if (elements.proxyIpipBtn) {
            elements.proxyIpipBtn.addEventListener('click', () => {
                void openProxyQuickSite('https://ipip0.net/', elements.proxyIpipBtn, 'ipip0.net');
            });
        }
        if (elements.proxyNexscanBtn) {
            elements.proxyNexscanBtn.addEventListener('click', () => {
                void openProxyQuickSite('https://nexscan.net/', elements.proxyNexscanBtn, 'nexscan.net');
            });
        }

        if (elements.clashSystemProxy) {
            elements.clashSystemProxy.addEventListener('change', (e) => {
                clashManager.updateClashSettings({ systemProxy: !!e.target.checked });
            });
        }
        if (elements.clashTunMode) {
            elements.clashTunMode.addEventListener('change', (e) => {
                clashManager.updateClashSettings({ tunMode: !!e.target.checked });
            });
        }
        if (elements.clashRefreshBtn) {
            elements.clashRefreshBtn.addEventListener('click', () => 
                refreshClashStatus(elements, clashManager.showClashError, clashManager.updateClashProfileSelect, clashManager.loadClashProfileNodes, logger)
            );
        }
        if (elements.clashProfileSelect) {
            elements.clashProfileSelect.addEventListener('change', () => 
                clashManager.switchClashProfile(elements.clashProfileSelect.value)
            );
        }
        if (elements.clashSwitchNodeBtn) {
            elements.clashSwitchNodeBtn.addEventListener('click', () => 
                clashManager.switchClashNode(elements.clashNodeSelect?.value || '', elements, logger)
            );
        }
        if (elements.clashTestLatencyBtn) {
            elements.clashTestLatencyBtn.addEventListener('click', () => 
                clashManager.testLatency(elements.clashNodeSelect?.value || '', elements, logger)
            );
        }
        if (elements.clashTestAllLatencyBtn) {
            elements.clashTestAllLatencyBtn.addEventListener('click', () => 
                clashManager.testAllLatency(elements, logger)
            );
        }
    }

    return {
        setupEventListeners
    };
};

