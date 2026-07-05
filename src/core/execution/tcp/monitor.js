const net = require('net');

const {
    DEFAULT_TCP_HOST,
    DEFAULT_TCP_PORT,
    MSG_TYPE_HEARTBEAT_REQ,
    MSG_TYPE_HEARTBEAT_RESP,
    MSG_TYPE_REGISTRATION_HELLO_REQ,
    MSG_TYPE_REGISTRATION_HELLO_RESP,
    MSG_TYPE_REGISTRATION_STATE_REPORT_REQ,
    MSG_TYPE_REGISTRATION_STATE_REPORT_RESP,
    MSG_TYPE_REGISTRATION_HEARTBEAT_REQ,
    MSG_TYPE_REGISTRATION_HEARTBEAT_RESP,
    MSG_TYPE_REGISTRATION_SUCCESS_REQ,
    MSG_TYPE_REGISTRATION_SUCCESS_RESP,
    packTcpMessage,
    unpackTcpMessage,
    clonePlainObject,
    getExecutionTcpInstanceId,
    buildExecutionTcpSnapshot,
    buildExecutionTcpClientMetadata,
    normalizeExecutionTcpEndpoint,
    hasExecutionTcpConfig,
    buildExecutionTcpConnectionStatus
} = require('./protocol');
const { _processExecutionTcpIncomingPacket } = require('./bridge');

const DEFAULT_TCP_RECONNECT_INTERVAL_MS = 5000;
const DEFAULT_REGISTRATION_HEARTBEAT_INTERVAL_MS = 15000;
const DEFAULT_REGISTRATION_STATE_REPORT_INTERVAL_MS = 30000;
const TCP_HEARTBEAT_RESPONSE_TIMEOUT_MS = 2000;

function _getExecutionTcpMonitorState(app) {
    if (!app) {
        return null;
    }

    if (!app.executionTcpMonitorState) {
        app.executionTcpMonitorState = {
            socket: null,
            buffer: Buffer.alloc(0),
            connectPromise: null,
            retryTimer: null,
            heartbeatTimer: null,
            stateReportTimer: null,
            responseTimer: null,
            currentEndpoint: null,
            helloAcked: false,
            lastHealthyAt: 0,
            pendingRequests: new Map(),
        };
    } else if (!(app.executionTcpMonitorState.pendingRequests instanceof Map)) {
        app.executionTcpMonitorState.pendingRequests = new Map();
    }

    return app.executionTcpMonitorState;
}

function _isSameExecutionTcpEndpoint(left, right) {
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
        return false;
    }

    const leftHost = String(left.host || '').trim();
    const rightHost = String(right.host || '').trim();
    const leftPort = Number.parseInt(left.port, 10);
    const rightPort = Number.parseInt(right.port, 10);

    return leftHost === rightHost
        && Number.isFinite(leftPort)
        && Number.isFinite(rightPort)
        && leftPort === rightPort;
}

function _syncDefaultExecutionPlanFromResponse(app, response = {}) {
    if (!app || !response || typeof response !== 'object') {
        return null;
    }

    const plan = response.default_execution_plan
        || response.defaultExecutionPlan
        || response.registration_default_execution_plan
        || response.registrationDefaultExecutionPlan
        || (response.snapshot && typeof response.snapshot === 'object'
            ? response.snapshot.default_execution_plan
                || response.snapshot.defaultExecutionPlan
                || response.snapshot.registration_default_execution_plan
                || response.snapshot.registrationDefaultExecutionPlan
            : null);
    if (!plan || typeof plan !== 'object') {
        return null;
    }

    const clonedPlan = clonePlainObject(plan);
    app.defaultExecutionPlan = clonedPlan;
    app.defaultExecutionPlanUpdatedAt = String(
        clonedPlan.updated_at
        || clonedPlan.updatedAt
        || response.server_time
        || response.serverTime
        || ''
    ).trim();
    const logPayload = {
        enabled: clonedPlan.enabled === true,
        auto_start_execution: clonedPlan.auto_start_execution === true || clonedPlan.autoStartExecution === true,
        server_card_name: String(clonedPlan.server_card_name || clonedPlan.serverCardName || '').trim(),
        control_locked: clonedPlan.control_locked === true || clonedPlan.controlLocked === true,
        browser_settings: {
            browser_type: String(clonedPlan.browser_settings?.browser_type || clonedPlan.browser_settings?.browserType || '').trim(),
            browser_source: (() => {
                const normalized = String(
                    clonedPlan.browser_settings?.browser_source
                    || clonedPlan.browser_settings?.browserSource
                    || clonedPlan.browser_settings?.browser_type
                    || clonedPlan.browser_settings?.browserType
                    || 'local-browser'
                ).trim().toLowerCase();
                if (normalized === 'client-browser' || normalized === 'client' || normalized === 'host-browser') {
                    return 'client-browser';
                }
                return 'local-browser';
            })(),
            headless: clonedPlan.browser_settings?.headless === true,
            block_images_videos: clonedPlan.browser_settings?.block_images_videos !== false,
            sync_execution: clonedPlan.browser_settings?.sync_execution !== false,
            max_proxy_recovery_attempts: Number.parseInt(clonedPlan.browser_settings?.max_proxy_recovery_attempts, 10) || 3,
            execution_auto_upload: clonedPlan.browser_settings?.execution_auto_upload !== false,
            save_local_cookie: clonedPlan.browser_settings?.save_local_cookie === true,
            concurrent_count: Number.parseInt(clonedPlan.browser_settings?.concurrent_count, 10) || 1,
            run_mode: Number.parseInt(clonedPlan.browser_settings?.run_mode, 10) || 0,
            timed_execution_count: Number.parseInt(clonedPlan.browser_settings?.timed_execution_count, 10) || 1,
            timed_execution_cycle_count: Number.parseInt(clonedPlan.browser_settings?.timed_execution_cycle_count, 10) || 1,
            timed_execution_start_mode: String(clonedPlan.browser_settings?.timed_execution_start_mode || '').trim() === 'delayed' ? 'delayed' : 'immediate',
            timed_execution_delay_seconds: Number.parseInt(clonedPlan.browser_settings?.timed_execution_delay_seconds, 10) || 0
        }
    };
    const logSignature = JSON.stringify(logPayload);
    if (app.defaultExecutionPlanSignature !== logSignature) {
        app.defaultExecutionPlanSignature = logSignature;
        app?.logger?.info?.(`已同步自动化工具默认执行方案: ${logSignature}`);
    }

    return clonedPlan;
}

function _clearExecutionTcpTimer(timerRef) {
    if (timerRef) {
        clearTimeout(timerRef);
    }
}

function _clearExecutionTcpInterval(timerRef) {
    if (timerRef) {
        clearInterval(timerRef);
    }
}

function _rejectExecutionTcpPendingRequests(state, reason = '连接已关闭') {
    if (!state || !(state.pendingRequests instanceof Map) || state.pendingRequests.size === 0) {
        return;
    }

    for (const [requestId, pending] of state.pendingRequests.entries()) {
        try {
            if (pending?.timer) {
                clearTimeout(pending.timer);
            }
        } catch (_) {}

        if (typeof pending?.reject === 'function') {
            pending.reject(new Error(reason));
        }

        state.pendingRequests.delete(requestId);
    }
}

function _emitExecutionTcpConnectionUpdated(app, connectionStatus) {
    if (!app?.mainWindow?.webContents || typeof app.mainWindow.webContents.send !== 'function') {
        return;
    }

    app.mainWindow.webContents.send('execution-tcp-connection-updated', {
        executionTcpEnabled: connectionStatus?.enabled === true,
        executionTcpControlLocked: typeof app.isExecutionControlLocked === 'function'
            ? app.isExecutionControlLocked()
            : false,
        executionTcpControlState: { ...(app.executionTcpControlState || {}) },
        executionTcpEndpoint: connectionStatus?.endpoint || null,
        executionTcpEndpointUrl: connectionStatus?.endpoint?.url || '',
        executionTcpReconnectEnabled: app.executionTcpReconnectEnabled !== false,
        executionTcpConnectionStatus: connectionStatus || null
    });
}

function _updateExecutionTcpConnectionStatus(app, endpoint, connected = false, lastConnectError = '', statusCode = 0) {
    const resolvedEndpoint = endpoint && typeof endpoint === 'object'
        ? endpoint
        : endpoint === null
            ? null
            : app?.executionTcpEndpoint || null;

    const connectionStatus = buildExecutionTcpConnectionStatus({
        configured: app?.executionTcpConfigured === true || !!resolvedEndpoint,
        connected: connected === true,
        endpoint: resolvedEndpoint,
        lastConnectError,
        statusCode
    });

    if (app) {
        app.executionTcpConnectionStatus = connectionStatus;
        if (resolvedEndpoint) {
            app.executionTcpEndpoint = resolvedEndpoint;
        } else if (endpoint === null) {
            app.executionTcpEndpoint = null;
        }
    }

    _emitExecutionTcpConnectionUpdated(app, connectionStatus);
    return connectionStatus;
}

async function _sendExecutionTcpRequest(app, socket, requestType, payload, expectedResponseType, options = {}) {
    const state = _getExecutionTcpMonitorState(app);
    if (!state || !socket || socket.destroyed) {
        throw new Error('连接已关闭');
    }

    if (!(state.pendingRequests instanceof Map)) {
        state.pendingRequests = new Map();
    }

    let requestId = Number((Date.now() % 0xffffffff) >>> 0) || 1;
    while (state.pendingRequests.has(requestId)) {
        requestId = (requestId + 1) >>> 0;
    }

    const timeoutMs = Math.max(
        1000,
        Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : TCP_HEARTBEAT_RESPONSE_TIMEOUT_MS
    );
    const messagePayload = payload && typeof payload === 'object' ? payload : {};
    const requestBuffer = packTcpMessage(requestId, requestType, messagePayload);
    const purpose = String(options.purpose || '请求').trim() || '请求';

    return await new Promise((resolve, reject) => {
        const pending = {
            requestType,
            expectedResponseType,
            resolve,
            reject,
            purpose,
            timer: null,
        };

        pending.timer = setTimeout(() => {
            state.pendingRequests.delete(requestId);
            reject(new Error(`${purpose}响应超时`));
        }, timeoutMs);

        state.pendingRequests.set(requestId, pending);

        try {
            socket.write(requestBuffer);
        } catch (error) {
            clearTimeout(pending.timer);
            state.pendingRequests.delete(requestId);
            reject(error);
        }
    });
}

async function _sendExecutionTcpHello(app, socket, endpoint) {
    const snapshot = buildExecutionTcpSnapshot(app, { reason: 'hello' });
    const payload = {
        ...buildExecutionTcpClientMetadata(app, snapshot),
        host: endpoint?.host || '',
        port: endpoint?.port ?? null,
        snapshot
    };

    const response = await _sendExecutionTcpRequest(
        app,
        socket,
        MSG_TYPE_REGISTRATION_HELLO_REQ,
        payload,
        MSG_TYPE_REGISTRATION_HELLO_RESP,
        {
            timeoutMs: Math.max(TCP_HEARTBEAT_RESPONSE_TIMEOUT_MS, 5000),
            purpose: '自动化握手'
        }
    );

    if (response && response.instance_id) {
        app.executionTcpInstanceId = String(response.instance_id).trim();
    }
    await _syncDefaultExecutionPlanFromResponse(app, response);

    return response;
}

async function _sendExecutionTcpStateReport(app, socket, reason = 'periodic') {
    const snapshot = buildExecutionTcpSnapshot(app, { reason });
    const payload = {
        ...buildExecutionTcpClientMetadata(app, snapshot),
        reason,
        snapshot
    };

    const response = await _sendExecutionTcpRequest(
        app,
        socket,
        MSG_TYPE_REGISTRATION_STATE_REPORT_REQ,
        payload,
        MSG_TYPE_REGISTRATION_STATE_REPORT_RESP,
        {
            timeoutMs: Math.max(TCP_HEARTBEAT_RESPONSE_TIMEOUT_MS, 5000),
            purpose: '状态上报'
        }
    );

    await _syncDefaultExecutionPlanFromResponse(app, response);
    return response;
}

async function _sendExecutionTcpHeartbeatRequest(app, socket, reason = 'heartbeat') {
    const snapshot = buildExecutionTcpSnapshot(app, { reason });
    const payload = {
        ...buildExecutionTcpClientMetadata(app, snapshot),
        probe_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        reason,
        snapshot
    };

    const response = await _sendExecutionTcpRequest(
        app,
        socket,
        MSG_TYPE_REGISTRATION_HEARTBEAT_REQ,
        payload,
        MSG_TYPE_REGISTRATION_HEARTBEAT_RESP,
        {
            timeoutMs: TCP_HEARTBEAT_RESPONSE_TIMEOUT_MS,
            purpose: '自动化心跳'
        }
    );

    const state = _getExecutionTcpMonitorState(app);
    if (state) {
        state.lastHealthyAt = Date.now();
    }

    await _syncDefaultExecutionPlanFromResponse(app, response);
    return response;
}

async function notifyExecutionTcpSuccess(app, payload = {}) {
    const state = _getExecutionTcpMonitorState(app);
    if (!state || !state.socket || state.socket.destroyed || state.helloAcked !== true) {
        return { ok: false, message: 'TCP连接未就绪' };
    }

    const snapshot = buildExecutionTcpSnapshot(app, { reason: 'registration-success' });
    const requestPayload = {
        ...buildExecutionTcpClientMetadata(app, snapshot),
        event: 'registration_success',
        task_id: String(payload?.task_id || payload?.taskId || '').trim(),
        email: String(payload?.email || '').trim(),
        points: Number.isFinite(Number(payload?.points)) ? Number(payload.points) : 0,
        card_name: String(payload?.card_name || payload?.cardName || snapshot.currentCardName || '').trim(),
        cookies_saved: payload?.cookies_saved === true || payload?.cookiesSaved === true,
        timestamp: new Date().toISOString(),
        snapshot
    };

    const response = await _sendExecutionTcpRequest(
        app,
        state.socket,
        MSG_TYPE_REGISTRATION_SUCCESS_REQ,
        requestPayload,
        MSG_TYPE_REGISTRATION_SUCCESS_RESP,
        {
            timeoutMs: Math.max(TCP_HEARTBEAT_RESPONSE_TIMEOUT_MS, 5000),
            purpose: '执行成功通知'
        }
    );

    await _syncDefaultExecutionPlanFromResponse(app, response);
    return response;
}

function _destroyExecutionTcpMonitorSocket(app, reason = '') {
    const state = _getExecutionTcpMonitorState(app);
    if (!state) {
        return;
    }

    _clearExecutionTcpTimer(state.responseTimer);
    _clearExecutionTcpInterval(state.heartbeatTimer);
    _clearExecutionTcpInterval(state.stateReportTimer);
    _clearExecutionTcpTimer(state.retryTimer);
    state.responseTimer = null;
    state.heartbeatTimer = null;
    state.stateReportTimer = null;
    state.retryTimer = null;
    state.currentEndpoint = null;
    state.helloAcked = false;
    state.lastHealthyAt = 0;
    _rejectExecutionTcpPendingRequests(state, reason || '连接已关闭');

    const socket = state.socket;
    state.socket = null;
    state.connectPromise = null;

    if (socket) {
        try {
            socket.removeAllListeners();
            socket.destroy();
        } catch (_) {}
    }

    if (reason) {
        const endpoint = app?.executionTcpEndpoint || null;
        _updateExecutionTcpConnectionStatus(app, endpoint, false, reason, 0);
    }
}

function _scheduleExecutionTcpReconnect(app, endpoint, delayMs = DEFAULT_TCP_RECONNECT_INTERVAL_MS) {
    const state = _getExecutionTcpMonitorState(app);
    if (!state || app?.executionTcpReconnectEnabled === false || app?.executionTcpConnectionMonitorActive !== true) {
        return;
    }

    _clearExecutionTcpTimer(state.retryTimer);
    state.retryTimer = setTimeout(() => {
        state.retryTimer = null;
        _openExecutionTcpMonitorConnection(app, endpoint).catch((error) => {
            app?.logger?.warning?.(`TCP重连失败: ${error.message}`);
        });
    }, Math.max(1000, Number.isFinite(delayMs) ? delayMs : DEFAULT_TCP_RECONNECT_INTERVAL_MS));
}

function _sendExecutionTcpHeartbeat(app) {
    const state = _getExecutionTcpMonitorState(app);
    if (!state || !state.socket || state.socket.destroyed) {
        return false;
    }

    void _sendExecutionTcpHeartbeatRequest(app, state.socket, 'heartbeat').catch((error) => {
        app?.logger?.warning?.(`自动化工具心跳失败: ${error.message}`);
        _destroyExecutionTcpMonitorSocket(app, error?.message || '自动化工具心跳失败');
        _scheduleExecutionTcpReconnect(app, app?.executionTcpEndpoint || state.currentEndpoint);
    });
    return true;
}

async function _openExecutionTcpMonitorConnection(app, endpoint) {
    const state = _getExecutionTcpMonitorState(app);
    if (!state) {
        return null;
    }

    let resolvedEndpoint = endpoint && typeof endpoint === 'object'
        ? normalizeExecutionTcpEndpoint(endpoint)
        : null;
    if (!resolvedEndpoint) {
        resolvedEndpoint = await resolveExecutionTcpEndpointFromConfig(app);
    }
    if (!resolvedEndpoint) {
        return null;
    }

    if (state.connectPromise) {
        return state.connectPromise;
    }

    if (state.socket && !state.socket.destroyed) {
        return app?.executionTcpConnectionStatus || null;
    }

    state.currentEndpoint = resolvedEndpoint;
    state.buffer = Buffer.alloc(0);
    state.helloAcked = false;
    state.lastHealthyAt = 0;

    state.connectPromise = new Promise((resolve) => {
        const socket = net.createConnection({
            host: resolvedEndpoint.host,
            port: resolvedEndpoint.port
        });

        state.socket = socket;

        let initialResolved = false;
        const finalizeInitialConnection = (status) => {
            if (initialResolved) {
                return;
            }
            initialResolved = true;
            state.connectPromise = null;
            resolve(status);
        };

        const ensureHeartbeatLoop = () => {
            if (state.heartbeatTimer) {
                return;
            }

            state.heartbeatTimer = setInterval(() => {
                if (!state.socket || state.socket.destroyed || state.helloAcked !== true) {
                    _clearExecutionTcpInterval(state.heartbeatTimer);
                    state.heartbeatTimer = null;
                    if (state.helloAcked === true) {
                        _scheduleExecutionTcpReconnect(app, resolvedEndpoint);
                    }
                    return;
                }

                _sendExecutionTcpHeartbeat(app);
            }, DEFAULT_REGISTRATION_HEARTBEAT_INTERVAL_MS);
        };

        const ensureStateReportLoop = () => {
            if (state.stateReportTimer) {
                return;
            }

            state.stateReportTimer = setInterval(() => {
                if (!state.socket || state.socket.destroyed || state.helloAcked !== true) {
                    _clearExecutionTcpInterval(state.stateReportTimer);
                    state.stateReportTimer = null;
                    if (state.helloAcked === true) {
                        _scheduleExecutionTcpReconnect(app, resolvedEndpoint);
                    }
                    return;
                }

                void _sendExecutionTcpStateReport(app, state.socket, 'periodic').catch((error) => {
                    app?.logger?.warning?.(`自动化工具状态上报失败: ${error.message}`);
                    _destroyExecutionTcpMonitorSocket(app, error?.message || '自动化工具状态上报失败');
                    _scheduleExecutionTcpReconnect(app, resolvedEndpoint);
                });
            }, DEFAULT_REGISTRATION_STATE_REPORT_INTERVAL_MS);
        };

        socket.once('connect', () => {
            void (async () => {
                try {
                    _updateExecutionTcpConnectionStatus(app, resolvedEndpoint, false, '正在握手', 0);
                    const helloResponse = await _sendExecutionTcpHello(app, socket, resolvedEndpoint);
                    const instanceId = String(helloResponse?.instance_id || getExecutionTcpInstanceId(app)).trim();
                    if (instanceId) {
                        app.executionTcpInstanceId = instanceId;
                    }

                    state.helloAcked = true;
                    state.lastHealthyAt = Date.now();
                    ensureHeartbeatLoop();
                    ensureStateReportLoop();

                    const status = _updateExecutionTcpConnectionStatus(app, resolvedEndpoint, true, '', 200);
                    if (state.connectPromise) {
                        finalizeInitialConnection(status);
                    }

                    void _sendExecutionTcpStateReport(app, socket, 'hello').catch((error) => {
                        app?.logger?.warning?.(`自动化工具初始状态上报失败: ${error.message}`);
                    });
                } catch (error) {
                    const status = _updateExecutionTcpConnectionStatus(app, resolvedEndpoint, false, error?.message || '自动化握手失败', 0);
                    _destroyExecutionTcpMonitorSocket(app, error?.message || '自动化握手失败');
                    _scheduleExecutionTcpReconnect(app, resolvedEndpoint);
                    finalizeInitialConnection(status);
                }
            })();
        });

        socket.on('data', (chunk) => {
            if (!state.socket || socket.destroyed) {
                return;
            }

            state.buffer = Buffer.concat([state.buffer, chunk]);
            while (true) {
                const packet = unpackTcpMessage(state.buffer);
                if (!packet) {
                    break;
                }
                state.buffer = packet.remaining;

                void _processExecutionTcpIncomingPacket(app, socket, packet).catch((error) => {
                    app?.logger?.warning?.(`自动化工具TCP消息处理失败: ${error.message}`);
                });
            }
        });

        socket.once('error', (error) => {
            const status = _updateExecutionTcpConnectionStatus(app, resolvedEndpoint, false, error?.message || '连接失败', 0);
            _destroyExecutionTcpMonitorSocket(app, error?.message || '连接失败');
            _scheduleExecutionTcpReconnect(app, resolvedEndpoint);
            finalizeInitialConnection(status);
        });

        socket.once('close', () => {
            if (state.socket === socket) {
                const shouldReconnect = app?.executionTcpConnectionMonitorActive === true;
                const status = _updateExecutionTcpConnectionStatus(app, resolvedEndpoint, false, '连接已关闭', 0);
                _destroyExecutionTcpMonitorSocket(app, '连接已关闭');
                if (shouldReconnect) {
                    _scheduleExecutionTcpReconnect(app, resolvedEndpoint);
                }
                finalizeInitialConnection(status);
            }
        });
    });

    return state.connectPromise;
}

async function probeExecutionTcpEndpoint(endpoint, timeoutMs = 2000) {
    const resolved = normalizeExecutionTcpEndpoint(endpoint);
    return await new Promise((resolve) => {
        const socket = net.createConnection({
            host: resolved.host,
            port: resolved.port
        });

        let settled = false;
        let buffer = Buffer.alloc(0);
        const probeId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const requestId = Number.parseInt(String(Date.now() % 0xffffffff), 10) || 1;
        const finish = (payload) => {
            if (settled) {
                return;
            }
            settled = true;
            try {
                socket.destroy();
            } catch (_) {}
            resolve({
                endpoint: resolved,
                ...payload
            });
        };

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => {
            try {
                socket.write(packTcpMessage(requestId, MSG_TYPE_HEARTBEAT_REQ, {
                    action: 'ping',
                    source: 'registration-ui',
                    probe_id: probeId,
                    timestamp: Date.now()
                }));
            } catch (error) {
                finish({
                    connected: false,
                    enabled: false,
                    statusCode: 0,
                    lastConnectError: error?.message || String(error || '发送失败')
                });
            }
        });

        socket.on('data', (chunk) => {
            if (settled) {
                return;
            }

            buffer = Buffer.concat([buffer, chunk]);
            const packet = unpackTcpMessage(buffer);
            if (!packet) {
                return;
            }

            buffer = packet.remaining;
            if (packet.msgId !== requestId || packet.msgType !== MSG_TYPE_HEARTBEAT_RESP) {
                finish({
                    connected: false,
                    enabled: false,
                    statusCode: 0,
                    lastConnectError: '响应类型不匹配'
                });
                return;
            }

            let response = {};
            try {
                response = JSON.parse(packet.body.toString('utf8'));
            } catch (_) {}

            const matched = response && response.status === 'pong' && response.probe_id === probeId;
            finish({
                connected: matched,
                enabled: matched,
                statusCode: matched ? 200 : 0,
                lastConnectError: matched ? '' : '心跳响应不匹配'
            });
        });

        socket.once('close', () => {
            if (!settled) {
                finish({
                    connected: false,
                    enabled: false,
                    statusCode: 0,
                    lastConnectError: '连接已关闭'
                });
            }
        });

        socket.once('error', (error) => {
            finish({
                connected: false,
                enabled: false,
                statusCode: 0,
                lastConnectError: error?.message || String(error || '连接失败')
            });
        });

        socket.once('timeout', () => {
            finish({
                connected: false,
                enabled: false,
                statusCode: 0,
                lastConnectError: '连接超时'
            });
        });
    });
}

async function resolveExecutionTcpEndpointFromConfig(app) {
    let sourceConfig = app?.executionTcpConfigSource && typeof app.executionTcpConfigSource === 'object'
        ? app.executionTcpConfigSource
        : null;
    const liveEndpoint = typeof app?.executionTcpEndpoint === 'object' && app.executionTcpEndpoint
        ? app.executionTcpEndpoint
        : null;

    if ((!sourceConfig || !hasExecutionTcpConfig(sourceConfig)) && typeof app?.readExecutionTcpConfigFromDisk === 'function') {
        try {
            const diskConfig = await app.readExecutionTcpConfigFromDisk();
            if (diskConfig && typeof diskConfig === 'object' && hasExecutionTcpConfig(diskConfig)) {
                sourceConfig = diskConfig;
            }
        } catch (error) {
            app?.logger?.warning?.(`从磁盘读取TCP配置失败: ${error.message}`);
        }
    }

    if (sourceConfig && hasExecutionTcpConfig(sourceConfig)) {
        return normalizeExecutionTcpEndpoint(sourceConfig);
    }

    if (liveEndpoint) {
        return liveEndpoint;
    }

    return null;
}

async function getExecutionTcpRuntimeInfo(app) {
    const endpoint = await resolveExecutionTcpEndpointFromConfig(app);
    const configured = app?.executionTcpConfigured === true || !!endpoint;
    const monitorState = _getExecutionTcpMonitorState(app);
    const cachedStatus = app?.executionTcpConnectionStatus || null;
    const cachedEndpoint = cachedStatus?.endpoint || null;
    const cachedMatchesConfig = !!endpoint && _isSameExecutionTcpEndpoint(cachedEndpoint, endpoint);
    const effectiveCachedStatus = cachedStatus && (!endpoint || cachedMatchesConfig)
        ? cachedStatus
        : null;

    if (!configured) {
        const disabledStatus = buildExecutionTcpConnectionStatus({
            configured: false,
            connected: false,
            endpoint: null,
            lastConnectError: '未配置',
            statusCode: 0
        });

        return {
            executionTcpEnabled: false,
            executionTcpControlLocked: typeof app?.isExecutionControlLocked === 'function'
                ? app.isExecutionControlLocked()
                : false,
            executionTcpControlState: { ...(app?.executionTcpControlState || {}) },
            defaultExecutionPlan: clonePlainObject(app?.defaultExecutionPlan),
            defaultExecutionPlanUpdatedAt: String(app?.defaultExecutionPlanUpdatedAt || '').trim(),
            executionTcpEndpoint: null,
            executionTcpEndpointUrl: '',
            executionTcpReconnectEnabled: app?.executionTcpReconnectEnabled !== false,
            executionTcpConnectionStatus: disabledStatus
        };
    }

    if (monitorState && ((monitorState.socket && !monitorState.socket.destroyed) || monitorState.connectPromise)) {
        return {
            executionTcpEnabled: true,
            executionTcpControlLocked: typeof app?.isExecutionControlLocked === 'function'
                ? app.isExecutionControlLocked()
                : false,
            executionTcpControlState: { ...(app?.executionTcpControlState || {}) },
            defaultExecutionPlan: clonePlainObject(app?.defaultExecutionPlan),
            defaultExecutionPlanUpdatedAt: String(app?.defaultExecutionPlanUpdatedAt || '').trim(),
            executionTcpEndpoint: endpoint || null,
            executionTcpEndpointUrl: endpoint?.url || '',
            executionTcpReconnectEnabled: app?.executionTcpReconnectEnabled !== false,
            executionTcpConnectionStatus: effectiveCachedStatus || buildExecutionTcpConnectionStatus({
                configured: true,
                connected: false,
                endpoint: endpoint || cachedEndpoint || null,
                lastConnectError: '连接中',
                statusCode: 0
            })
        };
    }

    let connectionStatus = effectiveCachedStatus;
    if (!connectionStatus || connectionStatus.enabled !== true || (endpoint && connectionStatus.endpoint && !_isSameExecutionTcpEndpoint(connectionStatus.endpoint, endpoint))) {
        if (!endpoint) {
            connectionStatus = buildExecutionTcpConnectionStatus({
                configured: true,
                connected: false,
                endpoint: cachedEndpoint || null,
                lastConnectError: cachedStatus?.lastConnectError || '未配置',
                statusCode: cachedStatus?.statusCode || 0
            });
        } else {
            const connection = await probeExecutionTcpEndpoint(endpoint);
            connectionStatus = buildExecutionTcpConnectionStatus({
                configured: true,
                connected: connection.connected === true,
                endpoint: connection.endpoint || endpoint || null,
                lastConnectError: connection.lastConnectError || '',
                statusCode: connection.statusCode || 0
            });
        }
        if (app) {
            app.executionTcpConnectionStatus = connectionStatus;
        }
    }

    return {
        executionTcpEnabled: configured,
        executionTcpControlLocked: typeof app?.isExecutionControlLocked === 'function'
            ? app.isExecutionControlLocked()
            : false,
        executionTcpControlState: { ...(app?.executionTcpControlState || {}) },
        defaultExecutionPlan: clonePlainObject(app?.defaultExecutionPlan),
        defaultExecutionPlanUpdatedAt: String(app?.defaultExecutionPlanUpdatedAt || '').trim(),
        executionTcpEndpoint: endpoint || null,
        executionTcpEndpointUrl: endpoint?.url || '',
        executionTcpReconnectEnabled: app?.executionTcpReconnectEnabled !== false,
        executionTcpConnectionStatus: connectionStatus
    };
}

async function refreshExecutionTcpConnection(app) {
    const endpoint = await resolveExecutionTcpEndpointFromConfig(app);
    const configured = app?.executionTcpConfigured === true || !!endpoint;
    const monitorState = _getExecutionTcpMonitorState(app);

    if (!configured) {
        const disabledStatus = buildExecutionTcpConnectionStatus({
            configured: false,
            connected: false,
            endpoint: null,
            lastConnectError: '未配置',
            statusCode: 0
        });
        if (app) {
            app.executionTcpConnectionStatus = disabledStatus;
        }
        return disabledStatus;
    }

    if (monitorState && ((monitorState.socket && !monitorState.socket.destroyed) || monitorState.connectPromise)) {
        const activeStatus = app?.executionTcpConnectionStatus || buildExecutionTcpConnectionStatus({
            configured: true,
            connected: true,
            endpoint: endpoint || app?.executionTcpConnectionStatus?.endpoint || null,
            lastConnectError: '',
            statusCode: 200
        });
        if (app?.mainWindow && app.mainWindow.webContents && typeof app.mainWindow.webContents.send === 'function') {
            app.mainWindow.webContents.send('execution-tcp-connection-updated', {
                executionTcpEnabled: true,
                executionTcpControlLocked: typeof app.isExecutionControlLocked === 'function'
                    ? app.isExecutionControlLocked()
                    : false,
                executionTcpControlState: { ...(app.executionTcpControlState || {}) },
                executionTcpEndpoint: activeStatus.endpoint,
                executionTcpEndpointUrl: activeStatus.endpoint?.url || '',
                executionTcpReconnectEnabled: app.executionTcpReconnectEnabled !== false,
                executionTcpConnectionStatus: activeStatus
            });
        }
        return activeStatus;
    }

    const connectionStatus = endpoint
        ? buildExecutionTcpConnectionStatus({
            configured: true,
            connected: false,
            endpoint,
            lastConnectError: '连接中',
            statusCode: 0
        })
        : buildExecutionTcpConnectionStatus({
            configured: true,
            connected: false,
            endpoint: app?.executionTcpConnectionStatus?.endpoint || null,
            lastConnectError: app?.executionTcpConnectionStatus?.lastConnectError || '未配置',
            statusCode: app?.executionTcpConnectionStatus?.statusCode || 0
        });

    if (endpoint) {
        const connection = await probeExecutionTcpEndpoint(endpoint);
        connectionStatus.connected = connection.connected === true;
        connectionStatus.endpoint = connection.endpoint || endpoint || null;
        connectionStatus.lastConnectError = connection.lastConnectError || '';
        connectionStatus.statusCode = connection.statusCode || 0;
    }

    if (app) {
        app.executionTcpConnectionStatus = connectionStatus;
    }

    if (app?.mainWindow && app.mainWindow.webContents && typeof app.mainWindow.webContents.send === 'function') {
        app.mainWindow.webContents.send('execution-tcp-connection-updated', {
            executionTcpEnabled: true,
            executionTcpControlLocked: typeof app.isExecutionControlLocked === 'function'
                ? app.isExecutionControlLocked()
                : false,
            executionTcpControlState: { ...(app.executionTcpControlState || {}) },
            executionTcpEndpoint: connectionStatus.endpoint,
            executionTcpEndpointUrl: connectionStatus.endpoint?.url || '',
            executionTcpReconnectEnabled: app.executionTcpReconnectEnabled !== false,
            executionTcpConnectionStatus: connectionStatus
        });
    }

    return connectionStatus;
}

async function startExecutionTcpConnectionMonitor(app, options = {}) {
    const source = options && typeof options === 'object' ? options : {};
    const immediate = source.immediate !== false;

    if (!app) {
        return null;
    }

    if (app?.executionTcpConfigured !== true) {
        app.executionTcpConnectionMonitorActive = false;
        return app.executionTcpConnectionStatus || null;
    }

    app.executionTcpConnectionMonitorActive = true;

    let latestStatus = app.executionTcpConnectionStatus || null;
    if (immediate) {
        latestStatus = await _openExecutionTcpMonitorConnection(app, null);
    }

    return latestStatus;
}

function stopExecutionTcpConnectionMonitor(app) {
    if (!app) {
        return;
    }

    app.executionTcpConnectionMonitorActive = false;
    _destroyExecutionTcpMonitorSocket(app, '连接已停止');
}

async function applyExecutionTcpUserConfig(app, config = {}, options = {}) {
    const source = config && typeof config === 'object' ? config : {};
    const summary = {
        emailApplied: false,
        tcpConfigApplied: false,
        tcpReconnectApplied: false,
        tcpRestarted: false,
        tcpRestartError: '',
        executionTcpEndpoint: typeof app?.getExecutionTcpEndpoint === 'function'
            ? app.getExecutionTcpEndpoint()
            : normalizeExecutionTcpEndpoint(),
        executionTcpReconnectEnabled: app?.executionTcpReconnectEnabled !== false
    };

    if (Object.prototype.hasOwnProperty.call(source, 'browserSettings') || Object.prototype.hasOwnProperty.call(source, 'browser_settings')) {
        const browserSettings = clonePlainObject(source.browserSettings || source.browser_settings || {});
        const mergedBrowserSettings = {
            ...(app?.browserSettings && typeof app.browserSettings === 'object' ? clonePlainObject(app.browserSettings) : {}),
            ...browserSettings
        };

        if (mergedBrowserSettings.browser_type && !mergedBrowserSettings.browserType) {
            mergedBrowserSettings.browserType = mergedBrowserSettings.browser_type;
        }
        if (mergedBrowserSettings.browserType && !mergedBrowserSettings.browser_type) {
            mergedBrowserSettings.browser_type = mergedBrowserSettings.browserType;
        }

        if (app) {
            app.browserSettings = mergedBrowserSettings;
            if (app.cookieTester && typeof app.cookieTester.setBrowserSettings === 'function') {
                app.cookieTester.setBrowserSettings(mergedBrowserSettings);
            }
            const browserType = String(
                mergedBrowserSettings.browser_type
                || mergedBrowserSettings.browserType
                || ''
            ).trim();
            if (browserType) {
                app.currentBrowserType = browserType;
            }
        }

        summary.browserSettingsApplied = true;
    }

    if (Object.prototype.hasOwnProperty.call(source, 'email_host')) {
        const host = String(source.email_host || '').trim();
        if (host && app?.emailClient) {
            app.emailClient.serverHost = host;
            summary.emailApplied = true;
        }
    }

    if (Object.prototype.hasOwnProperty.call(source, 'email_port')) {
        const port = Number.parseInt(source.email_port, 10);
        if (Number.isFinite(port) && port > 0 && app?.emailClient) {
            app.emailClient.serverPort = port;
            summary.emailApplied = true;
        }
    }

    if (hasExecutionTcpConfig(source)) {
        const endpoint = normalizeExecutionTcpEndpoint(source);
        if (app) {
            app.executionTcpEndpoint = endpoint;
            app.executionTcpConfigured = true;
            app.executionTcpConfigSource = { ...source };
            app.executionTcpConnectionStatus = buildExecutionTcpConnectionStatus({
                configured: true,
                connected: false,
                endpoint,
                lastConnectError: app.executionTcpConnectionStatus?.lastConnectError || '连接中',
                statusCode: 0
            });
        }
        summary.tcpConfigApplied = true;
        summary.executionTcpEndpoint = endpoint;
    } else if (app) {
        if (app.executionTcpConnectionMonitorActive === true) {
            stopExecutionTcpConnectionMonitor(app);
        }
        app.executionTcpEndpoint = null;
        app.executionTcpConfigured = false;
        app.executionTcpConfigSource = null;
        app.executionTcpConnectionStatus = buildExecutionTcpConnectionStatus({
            configured: false,
            connected: false,
            endpoint: null,
            lastConnectError: '未配置',
            statusCode: 0
        });
        summary.executionTcpEndpoint = null;
    }

    if (
        Object.prototype.hasOwnProperty.call(source, 'tcp_auto_reconnect_enabled')
        || Object.prototype.hasOwnProperty.call(source, 'tcpAutoReconnectEnabled')
        || Object.prototype.hasOwnProperty.call(source, 'execution_tcp_auto_reconnect_enabled')
        || Object.prototype.hasOwnProperty.call(source, 'executionTcpAutoReconnectEnabled')
    ) {
        const rawReconnectEnabled = source.tcp_auto_reconnect_enabled
            ?? source.tcpAutoReconnectEnabled
            ?? source.execution_tcp_auto_reconnect_enabled
            ?? source.executionTcpAutoReconnectEnabled;
        const reconnectEnabled = !(String(rawReconnectEnabled).trim().toLowerCase() === 'false'
            || String(rawReconnectEnabled).trim() === '0'
            || rawReconnectEnabled === false);
        if (app) {
            app.executionTcpReconnectEnabled = reconnectEnabled;
        }
        summary.tcpReconnectApplied = true;
        summary.executionTcpReconnectEnabled = reconnectEnabled;
    }

    if (options.restartTcpBridge === true && app) {
        try {
            if (app.executionTcpConnectionMonitorActive === true) {
                stopExecutionTcpConnectionMonitor(app);
            }
            await startExecutionTcpConnectionMonitor(app, { immediate: true });
            summary.tcpRestarted = true;
        } catch (error) {
            summary.tcpRestartError = error?.message || String(error || 'TCP重连失败');
        }
    }

    return summary;
}

module.exports = {
    DEFAULT_TCP_HOST,
    DEFAULT_TCP_PORT,
    normalizeExecutionTcpEndpoint,
    hasExecutionTcpConfig,
    probeExecutionTcpEndpoint,
    getExecutionTcpRuntimeInfo,
    refreshExecutionTcpConnection,
    startExecutionTcpConnectionMonitor,
    stopExecutionTcpConnectionMonitor,
    notifyExecutionTcpSuccess,
    buildExecutionTcpConnectionStatus,
    applyExecutionTcpUserConfig,
    _getExecutionTcpMonitorState
};



