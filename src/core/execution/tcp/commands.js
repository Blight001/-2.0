const {
    clonePlainObject,
    buildRegistrationTcpSnapshot,
    getRegistrationTcpInstanceId,
    REGISTRATION_APP_NAME
} = require('./protocol');

function _normalizeCardType(cardType = 'automation') {
    const normalizedType = String(cardType || 'automation').trim().toLowerCase();
    if (normalizedType === 'test' || normalizedType === 'test_card') {
        return 'test';
    }
    if (normalizedType === 'haika_bind' || normalizedType === 'haika' || normalizedType === 'haika-bind') {
        return 'haikaBind';
    }
    return 'automation';
}

function _resolveRegistrationCardSaver(app, cardType = 'automation') {
    const normalizedType = _normalizeCardType(cardType);
    if (normalizedType === 'test') {
        return {
            type: 'test',
            save: app?.cardManager?.saveTestCard?.bind(app.cardManager),
            get: app?.cardManager?.getTestCard?.bind(app.cardManager)
        };
    }

    if (normalizedType === 'haikaBind') {
        return {
            type: 'haikaBind',
            save: app?.cardManager?.saveHaikaBindCard?.bind(app.cardManager),
            get: app?.cardManager?.getHaikaBindCard?.bind(app.cardManager)
        };
    }

    return {
        type: 'automation',
        save: app?.cardManager?.saveCard?.bind(app.cardManager),
        get: app?.cardManager?.getCard?.bind(app.cardManager)
    };
}

function _applyRegistrationCurrentCard(app, cardType = 'automation', cardName = '') {
    const normalizedType = _normalizeCardType(cardType);
    const normalizedName = String(cardName || '').trim();
    if (!app) {
        return;
    }

    if (normalizedType === 'test') {
        app.currentTestCard = normalizedName;
        app.currentTestCardName = normalizedName;
        return;
    }

    if (normalizedType === 'haikaBind') {
        app.currentHaikaBindCard = normalizedName;
        app.currentHaikaBindCardName = normalizedName;
        return;
    }

    app.currentCard = normalizedName;
    app.currentCardName = normalizedName;
}

function _mergeBrowserSettings(app, input = {}) {
    const normalizedSettings = {
        ...(app?.browserSettings && typeof app.browserSettings === 'object' ? clonePlainObject(app.browserSettings) : {}),
        ...clonePlainObject(input)
    };
    if (app) {
        app.browserSettings = normalizedSettings;
        if (app.cookieTester && typeof app.cookieTester.setBrowserSettings === 'function') {
            app.cookieTester.setBrowserSettings(normalizedSettings);
        }
        const browserType = String(
            normalizedSettings.browser_type
            || normalizedSettings.browserType
            || ''
        ).trim();
        if (browserType) {
            app.currentBrowserType = browserType;
        }
    }
    return normalizedSettings;
}

async function _persistBrowserSettings(app, browserSettings = {}, source = 'tcp-command') {
    if (!app || typeof app.saveBrowserSettingsToConfig !== 'function') {
        return { success: true };
    }

    return await app.saveBrowserSettingsToConfig(browserSettings, { source });
}

function _applyRegistrationRuntimePatch(app, patch = {}) {
    const input = patch && typeof patch === 'object' ? patch : {};
    const appliedFields = [];

    const assign = (field, value) => {
        if (value === undefined) {
            return;
        }
        if (!app) {
            return;
        }
        app[field] = value;
        appliedFields.push(field);
    };

    if (Object.prototype.hasOwnProperty.call(input, 'browser_settings') || Object.prototype.hasOwnProperty.call(input, 'browserSettings')) {
        const settings = _mergeBrowserSettings(app, input.browser_settings || input.browserSettings || {});
        appliedFields.push('browserSettings');
        if (settings.browser_type || settings.browserType) {
            appliedFields.push('currentBrowserType');
        }
        if (settings.browser_source || settings.browserSource) {
            appliedFields.push('browserSource');
        }
    }

    if (Object.prototype.hasOwnProperty.call(input, 'browser_type') || Object.prototype.hasOwnProperty.call(input, 'browserType')) {
        const browserType = String(input.browser_type || input.browserType || '').trim();
            if (browserType && app) {
                app.currentBrowserType = browserType;
                appliedFields.push('currentBrowserType');
                if (app.browserSettings && typeof app.browserSettings === 'object') {
                    app.browserSettings.browser_type = browserType;
                    app.browserSettings.browserType = browserType;
                    if (!app.browserSettings.browser_source && !app.browserSettings.browserSource) {
                        app.browserSettings.browser_source = 'local-browser';
                        app.browserSettings.browserSource = 'local-browser';
                    }
                }
            }
    }

    if (Object.prototype.hasOwnProperty.call(input, 'browser_source') || Object.prototype.hasOwnProperty.call(input, 'browserSource')) {
        const rawBrowserSource = String(
            input.browser_source
            || input.browserSource
            || input.browser_type
            || input.browserType
            || ''
        ).trim().toLowerCase();
        const browserSource = rawBrowserSource === 'client-browser' || rawBrowserSource === 'client' || rawBrowserSource === 'host-browser'
                ? 'client-browser'
                : 'local-browser';
        if (app && app.browserSettings && typeof app.browserSettings === 'object') {
            app.browserSettings.browser_source = browserSource;
            app.browserSettings.browserSource = browserSource;
        }
        appliedFields.push('browserSource');
    }

    if (Object.prototype.hasOwnProperty.call(input, 'card_type') || Object.prototype.hasOwnProperty.call(input, 'cardType')) {
        const cardType = String(input.card_type || input.cardType || 'automation').trim();
        const cardName = String(input.card_name || input.cardName || '').trim();
        if (cardName) {
            _applyRegistrationCurrentCard(app, cardType, cardName);
            appliedFields.push('currentCard');
            appliedFields.push('currentCardName');
        }
    }

    if (Object.prototype.hasOwnProperty.call(input, 'currentCardName') || Object.prototype.hasOwnProperty.call(input, 'currentCard')) {
        const cardName = String(input.currentCardName || input.currentCard || '').trim();
        if (cardName) {
            _applyRegistrationCurrentCard(app, 'automation', cardName);
            appliedFields.push('currentCard');
            appliedFields.push('currentCardName');
        }
    }

    if (Object.prototype.hasOwnProperty.call(input, 'currentTestCardName') || Object.prototype.hasOwnProperty.call(input, 'currentTestCard')) {
        const cardName = String(input.currentTestCardName || input.currentTestCard || '').trim();
        if (cardName) {
            _applyRegistrationCurrentCard(app, 'test', cardName);
            appliedFields.push('currentTestCard');
            appliedFields.push('currentTestCardName');
        }
    }

    if (Object.prototype.hasOwnProperty.call(input, 'currentHaikaBindCardName') || Object.prototype.hasOwnProperty.call(input, 'currentHaikaBindCard')) {
        const cardName = String(input.currentHaikaBindCardName || input.currentHaikaBindCard || '').trim();
        if (cardName) {
            _applyRegistrationCurrentCard(app, 'haikaBind', cardName);
            appliedFields.push('currentHaikaBindCard');
            appliedFields.push('currentHaikaBindCardName');
        }
    }

    if (Object.prototype.hasOwnProperty.call(input, 'activeRegistrationCardName')) {
        assign('activeRegistrationCardName', String(input.activeRegistrationCardName || '').trim());
    }

    if (Object.prototype.hasOwnProperty.call(input, 'activeRegistrationCardConfig')) {
        assign('activeRegistrationCardConfig', clonePlainObject(input.activeRegistrationCardConfig));
    }

    if (Object.prototype.hasOwnProperty.call(input, 'lastRegistrationConfig')) {
        assign('lastRegistrationConfig', clonePlainObject(input.lastRegistrationConfig));
    }

    if (Object.prototype.hasOwnProperty.call(input, 'registrationTcpReconnectEnabled')) {
        assign('registrationTcpReconnectEnabled', input.registrationTcpReconnectEnabled !== false);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'registrationTcpControlState')) {
        assign('registrationTcpControlState', clonePlainObject(input.registrationTcpControlState));
    }

    if (Object.prototype.hasOwnProperty.call(input, 'registrationStopRequested')) {
        assign('registrationStopRequested', input.registrationStopRequested === true);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'isValidated')) {
        assign('isValidated', input.isValidated === true);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'concurrentCount')) {
        const concurrentCount = Math.max(1, Number.parseInt(input.concurrentCount, 10) || 1);
        assign('concurrentCount', concurrentCount);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'runMode')) {
        const runMode = Number.parseInt(input.runMode, 10);
        assign('runMode', Number.isFinite(runMode) ? runMode : 0);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'syncEnabled')) {
        assign('syncEnabled', input.syncEnabled === true);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'maxProxyRecoveryAttempts')) {
        const attempts = Math.max(1, Number.parseInt(input.maxProxyRecoveryAttempts, 10) || 1);
        assign('maxProxyRecoveryAttempts', attempts);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'registrationTcpEndpoint')) {
        assign('registrationTcpEndpoint', input.registrationTcpEndpoint && typeof input.registrationTcpEndpoint === 'object'
            ? input.registrationTcpEndpoint
            : null);
        appliedFields.push('registrationTcpEndpoint');
    }

    return {
        ok: true,
        appliedFields: [...new Set(appliedFields)],
        patch: clonePlainObject(input)
    };
}

function _resolveStartTaskPayload(app, commandArgs = {}) {
    const input = commandArgs && typeof commandArgs === 'object' ? commandArgs : {};
    const browserSettings = clonePlainObject(input.browser_settings || input.browserSettings || app?.browserSettings || {});
    const saveLocalCookie = (() => {
        const candidates = [
            input.save_local_cookie,
            input.saveLocalCookie,
            input.skip_cookie_save === true ? false : undefined,
            input.skipCookieSave === true ? false : undefined,
            browserSettings.save_local_cookie,
            browserSettings.saveLocalCookie,
            browserSettings.skip_cookie_save === true ? false : undefined,
            browserSettings.skipCookieSave === true ? false : undefined
        ];
        for (const candidate of candidates) {
            if (candidate === undefined || candidate === null || candidate === '') {
                continue;
            }
            if (typeof candidate === 'boolean') {
                return candidate;
            }
            const normalized = String(candidate).trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(normalized)) {
                return true;
            }
            if (['0', 'false', 'no', 'off'].includes(normalized)) {
                return false;
            }
        }
        return false;
    })();
    const browserType = String(
        input.browser_type
        || input.browserType
        || browserSettings.browser_type
        || browserSettings.browserType
        || browserSettings.browser_source
        || browserSettings.browserSource
        || app?.currentBrowserType
        || ''
    ).trim();
    const cardData = clonePlainObject(input.card_data || input.cardData || input.card || null);
    const cardName = String(
        input.card_name
        || input.cardName
        || cardData.name
        || app?.activeRegistrationCardName
        || app?.currentCardName
        || app?.currentCard
        || ''
    ).trim();

    browserSettings.save_local_cookie = saveLocalCookie;
    browserSettings.saveLocalCookie = saveLocalCookie;
    browserSettings.skip_cookie_save = !saveLocalCookie;
    browserSettings.skipCookieSave = !saveLocalCookie;
    browserSettings.browser_source = String(
        input.browser_source
        || input.browserSource
        || ''
        || browserSettings.browser_type
        || browserSettings.browserType
        || 'local-browser'
    ).trim().toLowerCase();
    if (['client-browser', 'client', 'host-browser'].includes(browserSettings.browser_source)) {
        browserSettings.browser_source = 'client-browser';
    } else {
        browserSettings.browser_source = 'local-browser';
    }
    browserSettings.browserSource = browserSettings.browser_source;

    return {
        browserSettings,
        browserType,
        cardData: cardData && Object.keys(cardData).length > 0 ? cardData : null,
        cardName,
        skipCookieSave: saveLocalCookie === false,
        saveLocalCookie,
        keepBrowserOpen: input.keep_browser_open === true || input.keepBrowserOpen === true,
        debugMode: input.debug_mode === true || input.debugMode === true,
        contextVariables: clonePlainObject(input.context_variables || input.contextVariables || {}),
        initialCookies: Array.isArray(input.initial_cookies || input.initialCookies)
            ? [...(input.initial_cookies || input.initialCookies)]
            : [],
        extra: input
    };
}

function _buildCommandResponse(app, payload = {}) {
    const basePayload = payload && typeof payload === 'object' ? payload : {};
    return {
        instance_id: basePayload.instance_id || getRegistrationTcpInstanceId(app),
        ok: basePayload.ok === true,
        command: basePayload.command || '',
        message: basePayload.message || '',
        snapshot: basePayload.snapshot || buildRegistrationTcpSnapshot(app, { reason: 'command-response' }),
        ...basePayload
    };
}

function _emitRegistrationControlStateUpdated(app, controlState = {}) {
    if (!app) {
        return;
    }

    const normalizedState = clonePlainObject(controlState);
    app.registrationTcpControlState = normalizedState;
    if (typeof app.emitUiEvent === 'function') {
        app.emitUiEvent('registration-control-state-updated', {
            control_state: normalizedState,
            control_locked: normalizedState.control_locked === true
        });
    } else if (app.mainWindow?.webContents && typeof app.mainWindow.webContents.send === 'function') {
        app.mainWindow.webContents.send('registration-control-state-updated', {
            control_state: normalizedState,
            control_locked: normalizedState.control_locked === true
        });
    }
}

async function executeRegistrationTcpCommand(app, commandPayload = {}) {
    const payload = commandPayload && typeof commandPayload === 'object' ? commandPayload : {};
    const command = String(payload.command || '').trim();
    const commandArgs = payload.payload && typeof payload.payload === 'object' ? payload.payload : {};
    let snapshot = buildRegistrationTcpSnapshot(app, { reason: `command:${command}` });

    if (!command) {
        return {
            ok: false,
            command: '',
            message: '缺少命令名',
            snapshot
        };
    }

    try {
        if (command === 'ping') {
            return {
                ok: true,
                command,
                message: 'pong',
                snapshot
            };
        }

        if (command === 'get_snapshot' || command === 'get_registration_ui_state') {
            try {
                const runtimeConfig = typeof app?.readRegistrationRuntimeConfigFromDisk === 'function'
                    ? await app.readRegistrationRuntimeConfigFromDisk()
                    : {};
                const runtimeBrowserSettings = runtimeConfig && typeof runtimeConfig === 'object'
                    ? (runtimeConfig.browserSettings && typeof runtimeConfig.browserSettings === 'object'
                        ? runtimeConfig.browserSettings
                        : runtimeConfig.browser_settings && typeof runtimeConfig.browser_settings === 'object'
                            ? runtimeConfig.browser_settings
                            : {})
                    : {};
                app.registrationRuntimeConfig = runtimeConfig && typeof runtimeConfig === 'object' ? { ...runtimeConfig } : {};
                app.registrationRuntimeBrowserSettings = runtimeBrowserSettings && typeof runtimeBrowserSettings === 'object'
                    ? { ...runtimeBrowserSettings }
                    : {};
                snapshot = buildRegistrationTcpSnapshot(app, { reason: `command:${command}` });
            } catch (error) {
                app?.logger?.warning?.(`刷新注册运行配置失败: ${error.message}`);
            }
            const runtimeInfo = typeof app?.getAppRuntimeInfo === 'function'
                ? await app.getAppRuntimeInfo()
                : null;
            const uiState = typeof app?.getRegistrationUiState === 'function'
                ? await app.getRegistrationUiState({
                    cardMode: commandArgs.card_mode || commandArgs.cardMode || commandArgs.card_type || commandArgs.cardType || 'automation',
                    log_limit: commandArgs.log_limit || commandArgs.logLimit
                })
                : null;
            const safeUiState = uiState && typeof uiState === 'object' ? uiState : {};
            return {
                ok: true,
                command,
                message: 'registration ui state ok',
                snapshot,
                runtime_info: runtimeInfo,
                ui_state: safeUiState,
                ...safeUiState
            };
        }

        if (command === 'update_browser_settings') {
            const normalizedSettings = _mergeBrowserSettings(app, commandArgs.browser_settings || commandArgs.browserSettings || commandArgs.settings);
            const persistResult = await _persistBrowserSettings(app, normalizedSettings, 'tcp-update-browser-settings');
            if (persistResult?.success === false) {
                return {
                    ok: false,
                    command,
                    message: persistResult.error || '保存浏览器设置失败',
                    browser_settings: normalizedSettings,
                    browser_type: String(
                        normalizedSettings.browser_type
                        || normalizedSettings.browserType
                        || app?.currentBrowserType
                        || ''
                    ).trim(),
                    snapshot
                };
            }
            if (app?.clashManager && typeof app.clashManager.applyDnsLeakProtection === 'function') {
                try {
                    await app.clashManager.applyDnsLeakProtection(normalizedSettings);
                } catch (error) {
                    app?.logger?.warning?.(`刷新 DNS 泄漏保护失败: ${error.message}`);
                }
            }
            return {
                ok: true,
                command,
                message: '浏览器设置已更新',
                browser_settings: normalizedSettings,
                browser_type: String(
                    normalizedSettings.browser_type
                    || normalizedSettings.browserType
                    || app?.currentBrowserType
                    || ''
                ).trim(),
                snapshot
            };
        }

        if (command === 'update_patch') {
            const patchInput = commandArgs.patch && typeof commandArgs.patch === 'object'
                ? commandArgs.patch
                : commandArgs;
            const patchResult = _applyRegistrationRuntimePatch(app, patchInput);
            return {
                ok: true,
                command,
                message: '运行时补丁已应用',
                applied_fields: patchResult.appliedFields,
                patch: patchResult.patch,
                snapshot
            };
        }

        if (command === 'save_card') {
            const cardType = String(commandArgs.card_type || commandArgs.cardType || 'automation').trim();
            const cardData = commandArgs.card && typeof commandArgs.card === 'object'
                ? clonePlainObject(commandArgs.card)
                : null;
            if (!cardData) {
                return {
                    ok: false,
                    command,
                    message: '缺少卡片数据',
                    snapshot
                };
            }

            const saver = _resolveRegistrationCardSaver(app, cardType);
            if (!saver.save) {
                return {
                    ok: false,
                    command,
                    message: `卡片类型不受支持: ${cardType}`,
                    snapshot
                };
            }

            const success = await saver.save(cardData);
            return {
                ok: success === true,
                command,
                message: success === true ? '卡片已保存' : '保存卡片失败',
                card_type: saver.type,
                card_name: String(cardData.name || '').trim(),
                snapshot
            };
        }

        if (command === 'set_current_card') {
            const cardType = String(commandArgs.card_type || commandArgs.cardType || 'automation').trim();
            const cardName = String(commandArgs.card_name || commandArgs.cardName || '').trim();
            if (!cardName) {
                return {
                    ok: false,
                    command,
                    message: '缺少卡片名称',
                    snapshot
                };
            }

            _applyRegistrationCurrentCard(app, cardType, cardName);
            return {
                ok: true,
                command,
                message: '当前卡片已切换',
                card_type: _normalizeCardType(cardType),
                card_name: cardName,
                snapshot
            };
        }

        if (command === 'start_registration') {
            const startTask = _resolveStartTaskPayload(app, commandArgs.config && typeof commandArgs.config === 'object'
                ? commandArgs.config
                : commandArgs);
            if (startTask.browserSettings && Object.keys(startTask.browserSettings).length > 0) {
                const mergedSettings = _mergeBrowserSettings(app, startTask.browserSettings);
                await _persistBrowserSettings(app, mergedSettings, 'tcp-start-registration');
                if (app?.clashManager && typeof app.clashManager.applyDnsLeakProtection === 'function') {
                    try {
                        await app.clashManager.applyDnsLeakProtection(mergedSettings);
                    } catch (error) {
                        app?.logger?.warning?.(`刷新 DNS 泄漏保护失败: ${error.message}`);
                    }
                }
            }

            if (startTask.cardData && typeof app?.startSingleRegistrationTask === 'function') {
                const result = await app.startSingleRegistrationTask({
                    cardConfig: startTask.cardData,
                    cardName: startTask.cardName,
                    browserType: startTask.browserType || app?.currentBrowserType,
                    browserSettings: startTask.browserSettings,
                    skipCookieSave: startTask.skipCookieSave,
                    keepBrowserOpen: startTask.keepBrowserOpen,
                    debugMode: startTask.debugMode,
                    contextVariables: startTask.contextVariables,
                    initialCookies: startTask.initialCookies,
                    taskType: commandArgs.task_type || commandArgs.taskType || 'registration',
                    taskLabel: commandArgs.task_label || commandArgs.taskLabel || '注册任务'
                });

                return {
                    ok: result && result.success !== false,
                    command,
                    message: result && result.success !== false ? '单任务执行已启动' : (result?.error || '启动单任务执行失败'),
                    entrypoint: 'startSingleRegistrationTask',
                    task_type: commandArgs.task_type || commandArgs.taskType || 'registration',
                    task_id: result?.taskId || null,
                    taskId: result?.taskId || null,
                    card_name: startTask.cardName,
                    browser_type: startTask.browserType || app?.currentBrowserType || '',
                    browser_settings: startTask.browserSettings,
                    result,
                    snapshot
                };
            }

            if (typeof app?.startRegistration !== 'function') {
                return {
                    ok: false,
                    command,
                    message: '注册启动能力不可用',
                    snapshot
                };
            }

            const startConfig = clonePlainObject(startTask.extra);
            if (Object.keys(startTask.browserSettings || {}).length > 0) {
                startConfig.browserSettings = startTask.browserSettings;
            }
            if (startTask.browserType) {
                startConfig.browserType = startTask.browserType;
            }
            if (startTask.cardData) {
                startConfig.cardData = startTask.cardData;
            }
            if (startTask.cardName) {
                startConfig.cardName = startTask.cardName;
            }

            const result = await app.startRegistration(startConfig);
            return {
                ok: result && result.success !== false,
                command,
                message: result && result.success !== false ? '执行已启动' : (result?.error || '启动执行失败'),
                entrypoint: 'startRegistration',
                task_type: commandArgs.task_type || commandArgs.taskType || 'registration',
                task_id: result?.taskId || null,
                taskId: result?.taskId || null,
                card_name: startTask.cardName,
                browser_type: startTask.browserType || app?.currentBrowserType || '',
                browser_settings: startTask.browserSettings,
                result,
                snapshot
            };
        }

        if (command === 'stop_registration') {
            const wantsExitApp = commandArgs.exit_app === true
                || commandArgs.exitApp === true
                || commandArgs.shutdown_app === true
                || commandArgs.shutdownApp === true;

            if (wantsExitApp) {
                if (typeof app?.cleanupAndExit !== 'function') {
                    return {
                        ok: false,
                        command,
                        message: '应用退出能力不可用',
                        snapshot
                    };
                }

                setImmediate(() => {
                    Promise.resolve(app.cleanupAndExit()).catch((error) => {
                        try {
                            app?.logger?.error?.(`应用退出失败: ${error?.message || error}`);
                        } catch (_) {}
                    });
                });

                return {
                    ok: true,
                    command,
                    message: '应用已开始关闭',
                    entrypoint: 'cleanupAndExit',
                    result: {
                        success: true,
                        scheduled: true
                    },
                    snapshot
                };
            }

            if (typeof app?.stopRegistration !== 'function') {
                return {
                    ok: false,
                    command,
                    message: '注册停止能力不可用',
                    snapshot
                };
            }

            const result = await app.stopRegistration(clonePlainObject(commandArgs));
            return {
                ok: result && result.success !== false,
                command,
                message: result && result.success !== false ? '执行已停止' : (result?.error || '停止执行失败'),
                entrypoint: 'stopRegistration',
                result,
                snapshot
            };
        }

        if (command === 'set_control_locked') {
            const locked = commandArgs.control_locked === true
                || commandArgs.controlLocked === true
                || commandArgs.locked === true;
            const reason = String(
                commandArgs.reason
                || commandArgs.lock_reason
                || commandArgs.lockReason
                || (locked ? '服务器禁用客户端操作' : '服务器恢复客户端操作')
            ).trim();
            const controlState = {
                ...(clonePlainObject(app?.registrationTcpControlState) || {}),
                control_locked: locked,
                reason,
                source: 'tcp-command',
                updated_at: new Date().toISOString()
            };
            _emitRegistrationControlStateUpdated(app, controlState);
            return {
                ok: true,
                command,
                message: locked ? '已禁用客户端操作' : '已恢复客户端操作',
                control_locked: locked,
                control_state: controlState,
                snapshot
            };
        }

        if (command === 'set_saved_card_key') {
            const cardKey = String(commandArgs.card_key || commandArgs.cardKey || commandArgs.key || '').trim();
            if (!cardKey) {
                return {
                    ok: false,
                    command,
                    message: '缺少卡密',
                    snapshot
                };
            }

            if (typeof app?.saveCardKeyToCache === 'function') {
                await app.saveCardKeyToCache(cardKey);
            }
            if (app) {
                app.currentCardKey = cardKey;
                app.currentCardKeyPrefix = cardKey.slice(0, 4);
            }
            return {
                ok: true,
                command,
                message: '卡密已保存',
                snapshot
            };
        }

        if (command === 'clear_saved_card_key') {
            if (typeof app?.clearSavedCardKey === 'function') {
                await app.clearSavedCardKey();
            }
            if (app) {
                app.currentCardKey = '';
                app.currentCardKeyPrefix = '';
            }
            return {
                ok: true,
                command,
                message: '卡密已清理',
                snapshot
            };
        }

        return {
            ok: false,
            command,
            message: `未支持的自动化命令: ${command}`,
            snapshot
        };
    } catch (error) {
        return {
            ok: false,
            command,
            message: error?.message || '命令执行失败',
            snapshot
        };
    }
}

module.exports = {
    REGISTRATION_APP_NAME,
    _resolveRegistrationCardSaver,
    _applyRegistrationCurrentCard,
    _mergeBrowserSettings,
    _resolveStartTaskPayload,
    _buildCommandResponse,
    executeRegistrationTcpCommand
};
