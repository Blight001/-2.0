/**
 * 渲染层 Cookie 功能模块。
 *
 * 负责 Cookie 列表加载、选择状态、右键菜单以及批量验证/上传/API测试。
 */
module.exports = function createRendererCookie(deps) {
    const state = deps;
    const {
        elements,
        cookieManager,
        cardManager,
        utils,
        logger,
        ipcRenderer,
        addTaskProgress,
        updateTaskProgress,
        finishTaskProgress,
        updateTaskCount,
        getRegistrationUploadDeviceId,
        getRegistrationUploadConfig,
        validateCookieUploadSize,
        DEFAULT_MIN_COOKIE_SIZE_BYTES,
        startHaikaBinding,
        updateHaikaBindAccountControls,
        groupCookiesByCardName
    } = deps;

    let cookieAccountContextMenu = state.cookieAccountContextMenu || null;
    let cookieAccountContextInfo = state.cookieAccountContextInfo || null;
    let cookieBatchContextMenu = state.cookieBatchContextMenu || null;
    let cookieBatchTaskControllers = state.cookieBatchTaskControllers || new Map();

        function normalizeAccountCookieInfo(rawValue) {
            const info = parseCookieAccountInfo(rawValue);
            if (!info || typeof info !== 'object') {
                return null;
            }

            return {
                aid: info.aid || info.id || '',
                email: info.email || info.account || '',
                account: info.account || info.email || '',
                password: info.password || '',
                points: info.points,
                card_name: info.card_name || '',
                fileName: info.fileName || info.name || '',
                name: info.name || info.fileName || info.email || '',
                source: info.source || 'cookie-manager'
            };
        }

        function getBatchActionCookies(fallbackCookie = null) {
            const selectedCookies = cookieManager.getSelectedCookies();
            if (selectedCookies.length > 1) {
                return selectedCookies;
            }

            if (selectedCookies.length === 1) {
                return selectedCookies;
            }

            if (fallbackCookie) {
                return [fallbackCookie];
            }

            return [];
        }

        async function runBatchActionWithFallback(action, fallbackCookie = null) {
            const cookies = getBatchActionCookies(fallbackCookie);
            if (!cookies.length) {
                utils.showMessage('请先选中要操作的 Cookie', 'warning', elements);
                return false;
            }

            if (cookies.length === 1 && fallbackCookie) {
                const cookie = cookies[0];
                if (action === 'validate') {
                    const testCardName = cardManager.getCurrentTestCard();
                    if (!testCardName) {
                        utils.showMessage('请先选择一个测试卡片', 'warning', elements);
                        return false;
                    }
                    const result = await ipcRenderer.invoke('test-cookie', {
                        email: cookie.email || cookie.account || '',
                        testWithCardName: testCardName,
                        originalCardName: cookie.card_name || ''
                    });
                    return !!(result && result.success);
                }

                if (action === 'upload') {
                    const deviceId = await getRegistrationUploadDeviceId();
                    if (!deviceId) {
                        utils.showMessage('获取设备ID失败，无法上传', 'warning', elements);
                        return false;
                    }

                    const uploadConfig = await getRegistrationUploadConfig(cookie.card_name || '');
                    if (!uploadConfig) {
                        utils.showMessage('当前账号未配置上传信息', 'warning', elements);
                        return false;
                    }

                    const cookieResult = await ipcRenderer.invoke('cookie-get-cookie-data-by-file', cookie.card_name || '', cookie.fileName || cookie.name || '');
                    if (!cookieResult || !cookieResult.success) {
                        utils.showMessage(cookieResult?.error || '读取 Cookie 失败', 'error', elements);
                        return false;
                    }

                    const cookiesData = Array.isArray(cookieResult.cookies) ? cookieResult.cookies : [];
                    const sizeCheck = validateCookieUploadSize(cookiesData, uploadConfig.minCookieSizeBytes ?? DEFAULT_MIN_COOKIE_SIZE_BYTES);
                    if (!sizeCheck.allowed) {
                        utils.showMessage('Cookie 大小不足，无法上传', 'warning', elements);
                        return false;
                    }

                    const uploadPayload = buildCookieBatchUploadPayload(
                        cookie,
                        { cookies: cookiesData },
                        deviceId,
                        uploadConfig.cardKey,
                        cookie.card_name || '',
                        uploadConfig.targetScoreScope || 'all',
                        uploadConfig.targetScoreTypes || []
                    );
                    const uploadResult = await ipcRenderer.invoke('cookie-upload-ai-cookie', uploadConfig.serverUrl, uploadPayload);
                    return !!(uploadResult && uploadResult.success);
                }
            }

            if (action === 'validate') {
                return runSelectedCookieBatchValidation(cookies);
            }

            if (action === 'upload') {
                return runSelectedCookieBatchUpload(cookies);
            }

            return false;
        }

        async function resolveLinkedModelCardName(apiCardName) {
            const selectedModelCardName = String(
                cardManager.getCurrentModelCard?.()
                || state.currentModelCard
                || ''
            ).trim();

            const result = await ipcRenderer.invoke('load-model-cards', { forceReload: true });
            if (!result || result.success !== true) {
                return '';
            }

            const matchedCards = Array.isArray(result.cards)
                ? result.cards.filter(card => String(card?.api_card_name || card?.apiCardName || '').trim() === String(apiCardName || '').trim())
                : [];
            if (selectedModelCardName && matchedCards.some(card => String(card?.name || '').trim() === selectedModelCardName)) {
                return selectedModelCardName;
            }
            if (matchedCards.length === 1) {
                return String(matchedCards[0].name || '').trim();
            }

            return '';
        }

        async function runApiModelTestWithFallback(accountInfo = null) {
            const cookie = accountInfo || cookieAccountContextInfo;
            if (!cookie) {
                utils.showMessage('请先选择一个账号', 'warning', elements);
                return false;
            }

            const email = String(cookie.email || cookie.account || '').trim();
            const originalCardName = String(cookie.card_name || '').trim();
            const apiCardName = String(
                cardManager.getCurrentApiCard?.()
                || state.currentApiCard
                || ''
            ).trim();

            if (!email) {
                utils.showMessage('无法识别账号邮箱', 'warning', elements);
                return false;
            }
            if (!apiCardName) {
                utils.showMessage('请先选择一个API卡片', 'warning', elements);
                return false;
            }

            const modelCardName = await resolveLinkedModelCardName(apiCardName);
            if (!modelCardName) {
                utils.showMessage('请先选择一个对应的模型卡片', 'warning', elements);
                return false;
            }

            logger.info(`开始API测试: ${email} -> ${apiCardName} / ${modelCardName}`);
            const result = await ipcRenderer.invoke('test-cookie-api-model', {
                email,
                apiCardName,
                modelCardName,
                originalCardName
            });

            if (result && result.success) {
                utils.showMessage(
                    `API测试完成\n账号: ${email}\nAPI卡片: ${apiCardName}\n模型卡片: ${modelCardName}`,
                    'success',
                    elements
                );
                return true;
            }

            const stageLabel = result?.stage === 'api'
                ? 'API卡片'
                : result?.stage === 'model'
                    ? '模型卡片'
                    : 'API测试';
            utils.showMessage(
                `${stageLabel}失败: ${result?.error || '未知错误'}`,
                'error',
                elements
            );
            return false;
        }

        async function loadCookies() {
            const cookies = await cookieManager.loadCookies();
            const testCard = cardManager.getCurrentCard();
            cookieManager.renderCookieTabs(cookies, elements, cookieManager.createCardCookieTab, null, testCard);
            cookieManager.updateCookieCount(cookies.length, elements);
            if (typeof updateHaikaBindAccountControls === 'function') {
                updateHaikaBindAccountControls(cookies);
            }
            updateCookieSelectionButton();
        }

        function updateCookieSelectionButton() {
            if (!elements.cookieSelectAllBtn) {
                return;
            }

            const summary = cookieManager.getCookieSelectionSummary();
            if (summary.total === 0) {
                elements.cookieSelectAllBtn.disabled = true;
                elements.cookieSelectAllBtn.textContent = '全选';
                return;
            }

            elements.cookieSelectAllBtn.disabled = false;
            elements.cookieSelectAllBtn.textContent = summary.allSelected ? '取消全选' : '全选';
            elements.cookieSelectAllBtn.title = summary.hasSelection
                ? `已选中 ${summary.selected}/${summary.total} 个账号`
                : `共 ${summary.total} 个账号`;
        }

        function parseCookieAccountInfo(rawValue) {
            if (!rawValue) {
                return null;
            }

            if (typeof rawValue === 'object') {
                return rawValue;
            }

            try {
                return JSON.parse(decodeURIComponent(rawValue));
            } catch (_decodeError) {
                try {
                    return JSON.parse(rawValue);
                } catch (_parseError) {
                    return null;
                }
            }
        }

        function hideCookieAccountContextMenu() {
            if (cookieAccountContextMenu) {
                cookieAccountContextMenu.style.display = 'none';
            }
            cookieAccountContextInfo = null;
        }

        function updateCookieAccountContextMenuMode(menu, mode = 'single') {
            if (!menu) {
                return;
            }

            const normalizedMode = String(mode || '').trim().toLowerCase() === 'batch' ? 'batch' : 'single';
            menu.dataset.contextMode = normalizedMode;

            const apiTestButton = menu.querySelector('[data-action="api-test"]');
            if (apiTestButton) {
                apiTestButton.hidden = normalizedMode === 'batch';
            }
        }

        function ensureCookieAccountContextMenu() {
            if (cookieAccountContextMenu) {
                return cookieAccountContextMenu;
            }

            const menu = document.createElement('div');
            menu.id = 'cookie-account-context-menu';
            menu.className = 'cookie-account-context-menu';
            menu.innerHTML = `
                <button type="button" data-action="bind">独立测试绑卡</button>
                <button type="button" data-action="api-test">API测试</button>
                <button type="button" data-action="validate">批量验证</button>
                <button type="button" data-action="upload">批量上传</button>
            `;

            menu.addEventListener('click', async (event) => {
                const actionButton = event.target.closest('[data-action]');
                if (!actionButton) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();

                const action = actionButton.dataset.action;
                const accountInfo = cookieAccountContextInfo;
                hideCookieAccountContextMenu();

                if (action === 'bind') {
                    if (!accountInfo) {
                        utils.showMessage('未找到账号信息', 'warning', elements);
                        return;
                    }
                    if (typeof startHaikaBinding === 'function') {
                        await startHaikaBinding(accountInfo);
                    } else {
                        utils.showMessage('海卡绑定功能未就绪', 'warning', elements);
                    }
                    return;
                }

                if (action === 'api-test') {
                    await runApiModelTestWithFallback(accountInfo);
                    return;
                }

                await runBatchActionWithFallback(action, accountInfo);

            });

            document.body.appendChild(menu);
            cookieAccountContextMenu = menu;
            state.cookieAccountContextMenu = menu;
            return menu;
        }

        function showCookieAccountContextMenu(x, y, accountInfo, rowElement) { // rowElement 保留给调用方语义
            const menu = ensureCookieAccountContextMenu();
            cookieAccountContextInfo = accountInfo || null;
            state.cookieAccountContextInfo = cookieAccountContextInfo;
            cookieBatchContextMenu = menu;
            state.cookieBatchContextMenu = menu;
            updateCookieAccountContextMenuMode(menu, 'single');

            const menuWidth = 220;
            const menuHeight = 180;
            const maxLeft = window.innerWidth - menuWidth - 12;
            const maxTop = window.innerHeight - menuHeight - 12;

            menu.style.display = 'block';
            menu.style.left = `${Math.max(12, Math.min(x, maxLeft))}px`;
            menu.style.top = `${Math.max(12, Math.min(y, maxTop))}px`;
        }

        function hideCookieBatchContextMenu() {
            if (cookieBatchContextMenu) {
                cookieBatchContextMenu.style.display = 'none';
            }
        }

        function showCookieBatchContextMenu(x, y) {
            const menu = ensureCookieAccountContextMenu();
            cookieBatchContextMenu = menu;
            state.cookieBatchContextMenu = menu;
            updateCookieAccountContextMenuMode(menu, 'batch');
            const menuWidth = 220;
            const menuHeight = 140;
            const maxLeft = window.innerWidth - menuWidth - 12;
            const maxTop = window.innerHeight - menuHeight - 12;

            menu.style.display = 'block';
            menu.style.left = `${Math.max(12, Math.min(x, maxLeft))}px`;
            menu.style.top = `${Math.max(12, Math.min(y, maxTop))}px`;
        }

        function createCookieBatchTask(taskLabel, totalCount) {
            const taskId = `cookie-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const controller = {
                cancelRequested: false,
                totalCount,
                completedCount: 0
            };

            cookieBatchTaskControllers.set(taskId, controller);
            addTaskProgress(
                taskId,
                runningTasks.size + 1,
                taskLabel,
                (_id, stopBtn) => {
                    controller.cancelRequested = true;
                    stopBtn.disabled = true;
                    stopBtn.textContent = '取消中...';
                },
                '⏹ 取消'
            );
            runningTasks.set(taskId, { type: 'cookie-batch' });
            updateTaskCount();
            return { taskId, controller };
        }

        async function finishCookieBatchTask(taskId, statusText, message, delayMs = 2500, options = {}) {
            if (!taskId) {
                return;
            }

            finishTaskProgress(taskId, statusText, message, delayMs, {
                taskLabel: options.taskLabel || 'Cookie批量任务',
                taskNumber: options.taskNumber || '',
                statusKey: options.statusKey || (String(statusText || '').includes('失败') ? 'error' : String(statusText || '').includes('取消') ? 'warning' : 'success'),
                stopDisabled: true,
                maxHistoryEntries: 30
            });
            runningTasks.delete(taskId);
            cookieBatchTaskControllers.delete(taskId);
            updateTaskCount();
        }

        function buildCookieBatchUploadPayload(cookie, cookieResult, deviceId, cardKey, cardName, targetScoreScope = 'all', targetScoreTypes = []) {
            const scoreValue = Number.parseInt(cookie.points, 10);
            return {
                key: cardKey,
                device_id: deviceId,
                account: cookie.email || cookie.account || '',
                password: cookie.password || '',
                cookies: Array.isArray(cookieResult.cookies) ? cookieResult.cookies : [],
                score: Number.isFinite(scoreValue) ? scoreValue : 0,
                today_used: 2,
                today_score: null,
                last_used_at: '',
                note: `Cookie批量上传 (${cookie.fileName || cookie.name || cookie.email || 'unknown'})`,
                card_name: cardName,
                target_score_scope: targetScoreScope || 'all',
                target_score_types: Array.isArray(targetScoreTypes) ? targetScoreTypes : [],
                target_score_type: Array.isArray(targetScoreTypes) && targetScoreTypes.length > 0 ? targetScoreTypes[0] : ''
            };
        }

        async function runSelectedCookieBatchValidation(cookiesOverride = null) {
            const selectedCookies = Array.isArray(cookiesOverride) && cookiesOverride.length > 0
                ? cookiesOverride
                : cookieManager.getSelectedCookies();
            if (!selectedCookies.length) {
                utils.showMessage('请先选中要验证的 Cookie', 'warning', elements);
                return false;
            }

            const testCardName = cardManager.getCurrentTestCard();
            if (!testCardName) {
                utils.showMessage('请先选择一个测试卡片', 'warning', elements);
                return false;
            }

            const { taskId, controller } = createCookieBatchTask('Cookie批量验证', selectedCookies.length);
            updateTaskProgress(taskId, 0, `准备批量验证，共 ${selectedCookies.length} 个账号...`);

            let successCount = 0;
            let failCount = 0;
            let cleanedUp = false;
            const cleanup = async (delayMs = 2500) => {
                if (cleanedUp) {
                    return;
                }
                cleanedUp = true;
                await finishCookieBatchTask(
                    taskId,
                    controller.cancelRequested ? '已取消' : '已完成',
                    controller.cancelRequested
                        ? `批量验证已取消，成功 ${successCount}，失败 ${failCount}`
                        : `批量验证完成，成功 ${successCount}，失败 ${failCount}`,
                    delayMs,
                    {
                        taskLabel: 'Cookie批量验证',
                        taskNumber: `${Math.min(selectedCookies.length, successCount + failCount)}/${selectedCookies.length}`
                    }
                );
            };

            try {
                for (let index = 0; index < selectedCookies.length; index++) {
                    if (controller.cancelRequested) {
                        updateTaskProgress(taskId, Math.round((index / selectedCookies.length) * 100), `已取消，完成 ${successCount}/${selectedCookies.length}`);
                        break;
                    }

                    const cookie = selectedCookies[index];
                    const displayName = cookie.email || cookie.account || cookie.fileName || '未知账号';
                    updateTaskProgress(taskId, Math.round((index / selectedCookies.length) * 100), `验证中 [${index + 1}/${selectedCookies.length}] ${displayName}`);

                    try {
                        const result = await ipcRenderer.invoke('test-cookie', {
                            email: cookie.email || cookie.account || '',
                            testWithCardName: testCardName,
                            originalCardName: cookie.card_name || ''
                        });

                        const flowResult = result?.result || result;
                        const isSuccess = !!(result && result.success && flowResult && flowResult.success !== false);

                        if (isSuccess) {
                            successCount += 1;
                            logger.info(`批量验证成功: ${displayName} (${cookie.card_name || '未分类'})`);
                        } else {
                            failCount += 1;
                            logger.warning(`批量验证失败: ${displayName} - ${flowResult?.message || result?.error || '未知错误'}`);
                        }
                    } catch (error) {
                        failCount += 1;
                        logger.error(`批量验证异常: ${displayName} - ${error.message}`);
                    }

                    updateTaskProgress(taskId, Math.round(((index + 1) / selectedCookies.length) * 100), `验证完成 [${index + 1}/${selectedCookies.length}] 成功 ${successCount} 失败 ${failCount}`);
                }

                if (!controller.cancelRequested) {
                    updateTaskProgress(taskId, 100, `批量验证完成，成功 ${successCount}，失败 ${failCount}`);
                }
                logger.info(`Cookie 批量验证完成: 成功 ${successCount}, 失败 ${failCount}`);
                return true;
            } finally {
                await cleanup();
            }
        }

        async function runSelectedCookieBatchUpload(cookiesOverride = null) {
            const selectedCookies = Array.isArray(cookiesOverride) && cookiesOverride.length > 0
                ? cookiesOverride
                : cookieManager.getSelectedCookies();
            if (!selectedCookies.length) {
                utils.showMessage('请先选中要上传的 Cookie', 'warning', elements);
                return false;
            }

            const { taskId, controller } = createCookieBatchTask('Cookie批量上传', selectedCookies.length);
            updateTaskProgress(taskId, 0, `准备批量上传，共 ${selectedCookies.length} 个账号...`);

            let successCount = 0;
            let failCount = 0;
            let skippedCount = 0;
            let cleanedUp = false;
            const cleanup = async (delayMs = 2500) => {
                if (cleanedUp) {
                    return;
                }
                cleanedUp = true;
                await finishCookieBatchTask(
                    taskId,
                    controller.cancelRequested ? '已取消' : '已完成',
                    controller.cancelRequested
                        ? `批量上传已取消，成功 ${successCount}，失败 ${failCount}，跳过 ${skippedCount}`
                        : `批量上传完成，成功 ${successCount}，失败 ${failCount}，跳过 ${skippedCount}`,
                    delayMs,
                    {
                        taskLabel: 'Cookie批量上传',
                        taskNumber: `${Math.min(selectedCookies.length, successCount + failCount + skippedCount)}/${selectedCookies.length}`
                    }
                );
            };

            const configCache = new Map();
            const deviceId = await getRegistrationUploadDeviceId();
            if (!deviceId) {
                updateTaskProgress(taskId, 0, '获取设备ID失败，批量上传终止');
                logger.warning('批量上传已终止：获取设备ID失败');
                await cleanup(1500);
                return false;
            }

            try {
                for (let index = 0; index < selectedCookies.length; index++) {
                    if (controller.cancelRequested) {
                        updateTaskProgress(taskId, Math.round((index / selectedCookies.length) * 100), `已取消，完成 ${successCount}/${selectedCookies.length}`);
                        break;
                    }

                    const cookie = selectedCookies[index];
                    const displayName = cookie.email || cookie.account || cookie.fileName || '未知账号';
                    const cardName = cookie.card_name || '';
                    const fileName = cookie.fileName || cookie.name || '';

                    updateTaskProgress(taskId, Math.round((index / selectedCookies.length) * 100), `上传中 [${index + 1}/${selectedCookies.length}] ${displayName}`);

                    try {
                        let uploadConfig = configCache.get(cardName);
                        if (uploadConfig === undefined) {
                            uploadConfig = await getRegistrationUploadConfig(cardName);
                            configCache.set(cardName, uploadConfig || null);
                        }

                        if (!uploadConfig) {
                            skippedCount += 1;
                            logger.warning(`批量上传跳过: ${displayName}，卡片 ${cardName || '未分类'} 未配置上传信息`);
                            continue;
                        }

                        if (!fileName) {
                            skippedCount += 1;
                            logger.warning(`批量上传跳过: ${displayName} 缺少文件名`);
                            continue;
                        }

                        const cookieResult = await ipcRenderer.invoke('cookie-get-cookie-data-by-file', cardName, fileName);
                        if (!cookieResult || !cookieResult.success) {
                            failCount += 1;
                            logger.error(`批量上传读取 Cookie 失败: ${displayName} - ${cookieResult?.error || '未知错误'}`);
                            continue;
                        }

                        const cookies = Array.isArray(cookieResult.cookies) ? cookieResult.cookies : [];
                        if (cookies.length === 0) {
                            skippedCount += 1;
                            logger.warning(`批量上传跳过: ${displayName} 没有可上传的 Cookie`);
                            continue;
                        }

                        const sizeCheck = validateCookieUploadSize(cookies, uploadConfig.minCookieSizeBytes ?? DEFAULT_MIN_COOKIE_SIZE_BYTES);
                        if (!sizeCheck.allowed) {
                            skippedCount += 1;
                            logger.warning(`批量上传跳过: ${displayName} Cookie 大小不足（当前 ${sizeCheck.payloadBytes} 字节，要求 ${sizeCheck.minBytes} 字节）`);
                            continue;
                        }

                        const uploadPayload = buildCookieBatchUploadPayload(
                            cookie,
                            { cookies },
                            deviceId,
                            uploadConfig.cardKey,
                            cardName,
                            uploadConfig.targetScoreScope || 'all',
                            uploadConfig.targetScoreTypes || []
                        );
                        const uploadResult = await ipcRenderer.invoke('cookie-upload-ai-cookie', uploadConfig.serverUrl, uploadPayload);
                        if (uploadResult && uploadResult.success) {
                            successCount += 1;
                            logger.info(`批量上传成功: ${displayName} (${cardName}) -> ${uploadConfig.serverUrl}`);
                        } else {
                            failCount += 1;
                            logger.error(`批量上传失败: ${displayName} - ${uploadResult?.error || '未知错误'}`);
                        }
                    } catch (error) {
                        failCount += 1;
                        logger.error(`批量上传异常: ${displayName} - ${error.message}`);
                    }

                    updateTaskProgress(taskId, Math.round(((index + 1) / selectedCookies.length) * 100), `上传完成 [${index + 1}/${selectedCookies.length}] 成功 ${successCount} 失败 ${failCount} 跳过 ${skippedCount}`);
                }

                if (!controller.cancelRequested) {
                    updateTaskProgress(taskId, 100, `批量上传完成，成功 ${successCount}，失败 ${failCount}，跳过 ${skippedCount}`);
                }
                logger.info(`Cookie 批量上传完成: 成功 ${successCount}, 失败 ${failCount}, 跳过 ${skippedCount}`);
                return true;
            } finally {
                await cleanup();
            }
        }

        return {
            groupCookiesByCardName,
            loadCookies,
            updateCookieSelectionButton,
            parseCookieAccountInfo,
            hideCookieAccountContextMenu,
            ensureCookieAccountContextMenu,
            showCookieAccountContextMenu,
            hideCookieBatchContextMenu,
            showCookieBatchContextMenu,
            createCookieBatchTask,
            finishCookieBatchTask,
            buildCookieBatchUploadPayload,
            runSelectedCookieBatchValidation,
            runSelectedCookieBatchUpload
        };
};
