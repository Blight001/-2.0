const os = require('os');
const packageJson = require('../../../../package.json');

const DEFAULT_TCP_HOST = '127.0.0.1';
const DEFAULT_TCP_PORT = 58113;
const DEFAULT_TCP_PROTOCOL = 'tcp';
const TCP_HEADER_SIZE = 10;
const MSG_TYPE_HEARTBEAT_REQ = 0x0007;
const MSG_TYPE_HEARTBEAT_RESP = 0x0008;
const MSG_TYPE_REGISTRATION_HELLO_REQ = 0x0201;
const MSG_TYPE_REGISTRATION_HELLO_RESP = 0x0202;
const MSG_TYPE_REGISTRATION_STATE_REPORT_REQ = 0x0203;
const MSG_TYPE_REGISTRATION_STATE_REPORT_RESP = 0x0204;
const MSG_TYPE_REGISTRATION_COMMAND_REQ = 0x0205;
const MSG_TYPE_REGISTRATION_COMMAND_RESP = 0x0206;
const MSG_TYPE_REGISTRATION_HEARTBEAT_REQ = 0x0207;
const MSG_TYPE_REGISTRATION_HEARTBEAT_RESP = 0x0208;
const MSG_TYPE_REGISTRATION_SUCCESS_REQ = 0x0209;
const MSG_TYPE_REGISTRATION_SUCCESS_RESP = 0x020A;
const REGISTRATION_CLIENT_ROLE = 'registration';
const REGISTRATION_APP_NAME = packageJson?.productName || 'AI账号注册器 2.0';
const REGISTRATION_APP_VERSION = packageJson?.version || '';

function packTcpMessage(msgId, msgType, payload = {}) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const header = Buffer.alloc(TCP_HEADER_SIZE);
    header.writeUInt32BE(msgId >>> 0, 0);
    header.writeUInt16BE(msgType & 0xffff, 4);
    header.writeUInt32BE(body.length >>> 0, 6);
    return Buffer.concat([header, body]);
}

function unpackTcpMessage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < TCP_HEADER_SIZE) {
        return null;
    }

    const msgId = buffer.readUInt32BE(0);
    const msgType = buffer.readUInt16BE(4);
    const dataLen = buffer.readUInt32BE(6);
    const totalLen = TCP_HEADER_SIZE + dataLen;
    if (buffer.length < totalLen) {
        return null;
    }

    return {
        msgId,
        msgType,
        dataLen,
        body: buffer.slice(TCP_HEADER_SIZE, totalLen),
        remaining: buffer.slice(totalLen)
    };
}

function clonePlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return { ...value };
    }
}

function buildRegistrationHardwareInfo(app) {
    const source = app?.hardwareInfo && typeof app.hardwareInfo === 'object' ? app.hardwareInfo : {};
    const cpuList = Array.isArray(os.cpus()) ? os.cpus() : [];
    const cpuModel = String(source.cpu_model || source.cpuModel || cpuList[0]?.model || os.arch() || '').trim();
    const cpuCores = Number.isFinite(Number(source.cpu_cores))
        ? Number(source.cpu_cores)
        : cpuList.length > 0
            ? cpuList.length
            : 1;
    const cpuPhysicalCores = Number.isFinite(Number(source.cpu_physical_cores))
        ? Number(source.cpu_physical_cores)
        : cpuCores;
    const totalMemoryBytes = Number(os.totalmem()) || 0;
    const memoryTotalMb = Number.isFinite(Number(source.memory_total_mb))
        ? Number(source.memory_total_mb)
        : Math.max(1, Math.round(totalMemoryBytes / 1024 / 1024));
    const memoryTotalGb = Number.isFinite(Number(source.memory_total_gb))
        ? Number(source.memory_total_gb)
        : Number((totalMemoryBytes / (1024 * 1024 * 1024)).toFixed(1));

    return {
        cpu_model: cpuModel,
        cpu_cores: cpuCores,
        cpu_physical_cores: cpuPhysicalCores,
        gpu_name: String(source.gpu_name || source.gpuName || '').trim() || '未知',
        gpu_vendor: String(source.gpu_vendor || source.gpuVendor || '').trim(),
        gpu_driver_version: String(source.gpu_driver_version || source.gpuDriverVersion || '').trim(),
        memory_total_mb: memoryTotalMb,
        memory_total_gb: memoryTotalGb,
        updated_at: String(source.updated_at || source.updatedAt || '').trim()
    };
}

function getRegistrationTcpInstanceId(app) {
    if (!app) {
        return '';
    }

    if (typeof app.registrationTcpInstanceId === 'string' && app.registrationTcpInstanceId.trim()) {
        return app.registrationTcpInstanceId.trim();
    }

    const generated = `registration-${process.pid || 'pid'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    app.registrationTcpInstanceId = generated;
    return generated;
}

function buildRegistrationTcpSnapshot(app, extra = {}) {
    const runningTaskCount = app?.runningTasks instanceof Map ? app.runningTasks.size : 0;
    const currentCardName = String(app?.currentCardName || app?.currentCard || '').trim();
    const currentTestCardName = String(app?.currentTestCardName || app?.currentTestCard || '').trim();
    const currentHaikaBindCardName = String(app?.currentHaikaBindCardName || app?.currentHaikaBindCard || '').trim();
    // 当前内存态的 browserSettings 才是这次运行中真正生效的配置；
    // 磁盘/启动时的 runtime 配置只作为兜底，避免把旧预设回填到网页端。
    const liveBrowserSettings = clonePlainObject(app?.browserSettings);
    const runtimeBrowserSettings = clonePlainObject(
        app?.registrationRuntimeBrowserSettings
        || app?.registrationRuntimeConfig?.browserSettings
        || app?.registrationRuntimeConfig?.browser_settings
    );
    const browserSettings = Object.keys(liveBrowserSettings).length > 0
        ? {
            ...runtimeBrowserSettings,
            ...liveBrowserSettings
        }
        : runtimeBrowserSettings;
    const registrationDefaultExecutionPlan = clonePlainObject(app?.registrationDefaultExecutionPlan);
    const registrationRuntimeConfig = clonePlainObject(app?.registrationRuntimeConfig);
    const hardwareInfo = buildRegistrationHardwareInfo(app);
    const timedState = app?.timedRegistrationState && typeof app.timedRegistrationState === 'object'
        ? app.timedRegistrationState
        : null;
    const hasRegistrationDefaultExecutionPlan = Object.keys(registrationDefaultExecutionPlan).length > 0;

    return {
        instanceId: getRegistrationTcpInstanceId(app),
        appName: REGISTRATION_APP_NAME,
        appVersion: REGISTRATION_APP_VERSION,
        clientName: REGISTRATION_APP_NAME,
        clientRole: REGISTRATION_CLIENT_ROLE,
        startupMode: app?.startupMode || 'local',
        timestamp: new Date().toISOString(),
        isValidated: app?.isValidated === true,
        runningTaskCount,
        isLoopRunning: app?.isLoopRunning === true,
        isTimedRunning: app?.isTimedRunning === true,
        registrationStopRequested: app?.registrationStopRequested === true,
        concurrentCount: Number.isFinite(Number(app?.concurrentCount)) ? Number(app.concurrentCount) : 1,
        currentCardName,
        currentCard: currentCardName,
        currentTestCardName,
        currentTestCard: currentTestCardName,
        currentHaikaBindCardName,
        currentHaikaBindCard: currentHaikaBindCardName,
        currentBrowserType: app?.currentBrowserType || '',
        deviceId: app?.deviceId || '',
        browserSettings,
        registrationRuntimeConfig,
        registration_runtime_config: registrationRuntimeConfig,
        hardwareInfo,
        hardware_info: hardwareInfo,
        cpuModel: hardwareInfo.cpu_model,
        cpu_model: hardwareInfo.cpu_model,
        cpuCores: hardwareInfo.cpu_cores,
        cpu_cores: hardwareInfo.cpu_cores,
        cpuPhysicalCores: hardwareInfo.cpu_physical_cores,
        cpu_physical_cores: hardwareInfo.cpu_physical_cores,
        gpuName: hardwareInfo.gpu_name,
        gpu_name: hardwareInfo.gpu_name,
        gpuVendor: hardwareInfo.gpu_vendor,
        gpu_vendor: hardwareInfo.gpu_vendor,
        gpuDriverVersion: hardwareInfo.gpu_driver_version,
        gpu_driver_version: hardwareInfo.gpu_driver_version,
        memoryTotalMb: hardwareInfo.memory_total_mb,
        memory_total_mb: hardwareInfo.memory_total_mb,
        memoryTotalGb: hardwareInfo.memory_total_gb,
        memory_total_gb: hardwareInfo.memory_total_gb,
        ...(hasRegistrationDefaultExecutionPlan ? {
            registrationDefaultExecutionPlan,
            registration_default_execution_plan: registrationDefaultExecutionPlan,
            registrationDefaultExecutionPlanUpdatedAt: String(
                app?.registrationDefaultExecutionPlan?.updated_at
                || app?.registrationDefaultExecutionPlan?.updatedAt
                || ''
            ).trim()
        } : {}),
        webControlEnabled: app?.webControlConfig?.enabled === true,
        webControlHeadless: app?.webControlConfig?.headless === true,
        webControlHost: app?.webControlConfig?.host || '',
        webControlPort: app?.webControlConfig?.port ?? null,
        controlLocked: typeof app?.isRegistrationControlLocked === 'function'
            ? app.isRegistrationControlLocked()
            : false,
        cardKeyPrefix: typeof app?.getCardKeyPrefix === 'function' ? app.getCardKeyPrefix() : '',
        activeRegistrationCardName: String(app?.activeRegistrationCardName || '').trim(),
        activeRegistrationCardConfig: clonePlainObject(app?.activeRegistrationCardConfig),
        lastRegistrationConfig: clonePlainObject(app?.lastRegistrationConfig),
        timedRegistration: timedState ? {
            active: timedState.active === true,
            stopRequested: timedState.stopRequested === true,
            sessionId: timedState.sessionId || '',
            totalCount: Number.isFinite(Number(timedState.totalCount)) ? Number(timedState.totalCount) : 0,
            cycleLimit: Number.isFinite(Number(timedState.cycleLimit)) ? Number(timedState.cycleLimit) : 0,
            delayMs: Number.isFinite(Number(timedState.delayMs)) ? Number(timedState.delayMs) : 0,
            startMode: timedState.startMode || 'immediate',
            currentCycleIndex: Number.isFinite(Number(timedState.currentCycleIndex)) ? Number(timedState.currentCycleIndex) : 1,
            completedCycleCount: Number.isFinite(Number(timedState.completedCycleCount)) ? Number(timedState.completedCycleCount) : 0,
            startedCount: Number.isFinite(Number(timedState.startedCount)) ? Number(timedState.startedCount) : 0,
            completedCount: Number.isFinite(Number(timedState.completedCount)) ? Number(timedState.completedCount) : 0,
            cycleStartedCount: Number.isFinite(Number(timedState.cycleStartedCount)) ? Number(timedState.cycleStartedCount) : 0,
            cycleCompletedCount: Number.isFinite(Number(timedState.cycleCompletedCount)) ? Number(timedState.cycleCompletedCount) : 0
        } : null,
        reason: extra.reason || '',
        connected: extra.connected === true
    };
}

function buildRegistrationTcpClientMetadata(app, snapshot) {
    const resolvedSnapshot = snapshot && typeof snapshot === 'object'
        ? snapshot
        : buildRegistrationTcpSnapshot(app);

    return {
        instance_id: resolvedSnapshot.instanceId,
        client_name: REGISTRATION_APP_NAME,
        client_role: REGISTRATION_CLIENT_ROLE,
        app_name: REGISTRATION_APP_NAME,
        app_version: REGISTRATION_APP_VERSION,
        host: os.hostname(),
        port: app?.webControlConfig?.enabled === true ? app.webControlConfig.port ?? null : null,
        web_ui: app?.webControlConfig?.enabled === true,
        headless_web: app?.webControlConfig?.headless === true,
        startup_mode: app?.startupMode || 'local',
        pid: process.pid,
        snapshot: resolvedSnapshot
    };
}

function normalizeRegistrationTcpEndpoint(input = {}) {
    const source = input && typeof input === 'object' ? input : {};

    const buildEndpoint = (host, port) => {
        const resolvedHost = String(host || '').trim() || DEFAULT_TCP_HOST;
        const resolvedPort = Number.isFinite(port) && port > 0 ? port : DEFAULT_TCP_PORT;
        return {
            host: resolvedHost,
            port: resolvedPort,
            protocol: DEFAULT_TCP_PROTOCOL,
            url: `${DEFAULT_TCP_PROTOCOL}://${resolvedHost}:${resolvedPort}`
        };
    };

    const rawUrl = String(
        source.tcp_server_url ||
        source.tcpServerUrl ||
        source.server_url ||
        source.serverUrl ||
        source.registration_server_url ||
        source.registrationServerUrl ||
        source.mqtt_server_url ||
        source.mqttServerUrl ||
        ''
    ).trim();
    const rawHost = String(
        source.tcp_host ||
        source.tcpHost ||
        source.server_host ||
        source.serverHost ||
        source.registration_server_host ||
        source.registrationServerHost ||
        source.mqtt_host ||
        source.mqttHost ||
        ''
    ).trim();
    const rawPort = Number.parseInt(
        source.tcp_port ??
        source.tcpPort ??
        source.server_port ??
        source.serverPort ??
        source.registration_server_port ??
        source.registrationServerPort ??
        source.mqtt_port ??
        source.mqttPort,
        10
    );
    const resolvedPort = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : DEFAULT_TCP_PORT;

    if (rawUrl) {
        try {
            const parsed = new URL(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawUrl) ? rawUrl : `${DEFAULT_TCP_PROTOCOL}://${rawUrl}`);
            return buildEndpoint(
                parsed.hostname || DEFAULT_TCP_HOST,
                Number.isFinite(Number.parseInt(parsed.port, 10)) && Number.parseInt(parsed.port, 10) > 0
                    ? Number.parseInt(parsed.port, 10)
                    : resolvedPort
            );
        } catch (_) {}
    }

    if (rawHost) {
        return buildEndpoint(rawHost, resolvedPort);
    }

    if (Number.isFinite(rawPort) && rawPort > 0) {
        return buildEndpoint(DEFAULT_TCP_HOST, rawPort);
    }

    return buildEndpoint(DEFAULT_TCP_HOST, DEFAULT_TCP_PORT);
}

function hasRegistrationTcpConfig(config = {}) {
    const source = config && typeof config === 'object' ? config : {};
    return [
        'tcp_server_url',
        'tcpServerUrl',
        'server_url',
        'serverUrl',
        'registration_server_url',
        'registrationServerUrl',
        'mqtt_server_url',
        'mqttServerUrl',
        'tcp_host',
        'tcpHost',
        'server_host',
        'serverHost',
        'registration_server_host',
        'registrationServerHost',
        'mqtt_host',
        'mqttHost',
        'tcp_port',
        'tcpPort',
        'server_port',
        'serverPort',
        'registration_server_port',
        'registrationServerPort',
        'mqtt_port',
        'mqttPort'
    ].some((key) => Object.prototype.hasOwnProperty.call(source, key));
}

function buildRegistrationTcpConnectionStatus({
    configured = false,
    connected = false,
    endpoint = null,
    lastConnectError = '',
    statusCode = 0
} = {}) {
    const resolvedEndpoint = endpoint && typeof endpoint === 'object' ? endpoint : null;
    const resolvedConnected = connected === true;
    const resolvedConfigured = configured === true;

    return {
        enabled: resolvedConfigured,
        running: resolvedConfigured,
        connected: resolvedConnected,
        endpoint: resolvedEndpoint,
        lastConnectError: resolvedConnected ? '' : String(lastConnectError || (resolvedConfigured ? '连接失败' : '未配置')).trim(),
        statusCode: Number.isFinite(statusCode) ? statusCode : 0,
        subscribeResult: {
            success: resolvedConfigured && resolvedConnected,
            totalTopics: 0,
            subscribedTopics: [],
            failedTopics: resolvedConfigured && resolvedConnected
                ? []
                : [{
                    topic: resolvedEndpoint?.url || '',
                    error: resolvedConnected ? '' : String(lastConnectError || (resolvedConfigured ? '连接失败' : '未配置')).trim()
                }]
        }
    };
}

module.exports = {
    DEFAULT_TCP_HOST,
    DEFAULT_TCP_PORT,
    DEFAULT_TCP_PROTOCOL,
    TCP_HEADER_SIZE,
    MSG_TYPE_HEARTBEAT_REQ,
    MSG_TYPE_HEARTBEAT_RESP,
    MSG_TYPE_REGISTRATION_HELLO_REQ,
    MSG_TYPE_REGISTRATION_HELLO_RESP,
    MSG_TYPE_REGISTRATION_STATE_REPORT_REQ,
    MSG_TYPE_REGISTRATION_STATE_REPORT_RESP,
    MSG_TYPE_REGISTRATION_COMMAND_REQ,
    MSG_TYPE_REGISTRATION_COMMAND_RESP,
    MSG_TYPE_REGISTRATION_HEARTBEAT_REQ,
    MSG_TYPE_REGISTRATION_HEARTBEAT_RESP,
    MSG_TYPE_REGISTRATION_SUCCESS_REQ,
    MSG_TYPE_REGISTRATION_SUCCESS_RESP,
    REGISTRATION_CLIENT_ROLE,
    REGISTRATION_APP_NAME,
    REGISTRATION_APP_VERSION,
    packTcpMessage,
    unpackTcpMessage,
    clonePlainObject,
    getRegistrationTcpInstanceId,
    buildRegistrationTcpSnapshot,
    buildRegistrationTcpClientMetadata,
    normalizeRegistrationTcpEndpoint,
    hasRegistrationTcpConfig,
    buildRegistrationTcpConnectionStatus
};
