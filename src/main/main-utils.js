const os = require('os');
const {
    normalizeBooleanValue
} = require('../core/infra/config-utils');
const {
    normalizeRegistrationTcpEndpoint: normalizeRegistrationTcpEndpointValue,
    hasRegistrationTcpConfig
} = require('../core/registration/tcp-control');

function readFlagValue(flagName, argv = process.argv) {
    const matched = Array.isArray(argv)
        ? argv.find(item => typeof item === 'string' && item.startsWith(`${flagName}=`))
        : null;
    if (!matched) {
        return '';
    }

    return matched.slice(flagName.length + 1).trim();
}

function resolveStartupMode(argv = process.argv, env = process.env, packageJson = {}) {
    const rawValue = readFlagValue('--startup-mode', argv)
        || env.APP_STARTUP_MODE
        || packageJson.startupMode
        || '';
    const normalized = String(rawValue || '').trim().toLowerCase();
    if (normalized === 'tcp' || normalized === 'remote') {
        return 'tcp';
    }

    return 'local';
}

function normalizeRegistrationMode(value, fallback = 'standalone') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'embedded' || normalized === 'embed') {
        return 'embedded';
    }
    if (normalized === 'standalone' || normalized === 'desktop' || normalized === 'local') {
        return 'standalone';
    }
    return fallback === 'embedded' ? 'embedded' : 'standalone';
}

function normalizeBrowserSource(value, fallback = 'local-browser') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'client-browser' || normalized === 'client' || normalized === 'host-browser') {
        return 'client-browser';
    }
    if (normalized === 'local-browser' || normalized === 'local' || normalized === 'builtin-browser' || normalized === 'builtin') {
        return 'local-browser';
    }
    const normalizedFallback = String(fallback || '').trim().toLowerCase();
    if (normalizedFallback === 'client-browser') {
        return 'client-browser';
    }
    return 'local-browser';
}

function extractGpuNameFromInfo(gpuInfo) {
    const seen = new Set();
    const names = [];

    const pushName = (value) => {
        const text = String(value || '').trim();
        if (text) {
            names.push(text);
        }
    };

    const visit = (value, depth = 0) => {
        if (value === null || value === undefined || depth > 4) {
            return;
        }

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            pushName(value);
            return;
        }

        if (typeof value === 'object') {
            if (seen.has(value)) {
                return;
            }
            seen.add(value);
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                visit(item, depth + 1);
            }
            return;
        }

        const preferredKeys = [
            'deviceString',
            'device_string',
            'gpuName',
            'gpu_name',
            'name',
            'renderer',
            'glRenderer',
            'gl_renderer',
            'vendorString',
            'vendor_string'
        ];
        for (const key of preferredKeys) {
            if (typeof value[key] === 'string' && value[key].trim()) {
                pushName(value[key]);
            }
        }

        const nestedKeys = ['gpuDevice', 'gpuDevices', 'devices', 'auxAttributes', 'aux_attributes', 'featureStatus', 'basicInfo'];
        for (const key of nestedKeys) {
            if (value[key]) {
                visit(value[key], depth + 1);
            }
        }
    };

    visit(gpuInfo);
    return names.find(Boolean) || '';
}

function buildHardwareInfoFallback(gpuInfo = null) {
    const cpuList = Array.isArray(os.cpus()) ? os.cpus() : [];
    const cpuModel = String(cpuList[0]?.model || os.arch() || '').trim();
    const cpuCores = cpuList.length > 0 ? cpuList.length : 1;
    const totalMemoryBytes = Number(os.totalmem()) || 0;
    const totalMemoryMb = Math.max(1, Math.round(totalMemoryBytes / 1024 / 1024));
    const totalMemoryGb = Number((totalMemoryBytes / (1024 * 1024 * 1024)).toFixed(1));

    return {
        cpu_model: cpuModel,
        cpu_cores: cpuCores,
        cpu_physical_cores: cpuCores,
        gpu_name: extractGpuNameFromInfo(gpuInfo) || '未知',
        memory_total_mb: totalMemoryMb,
        memory_total_gb: totalMemoryGb,
        updated_at: new Date().toISOString()
    };
}

function buildTcpConfigSnapshot(source = {}) {
    const config = source && typeof source === 'object' ? source : {};
    if (!hasRegistrationTcpConfig(config)) {
        return {};
    }

    const endpoint = normalizeRegistrationTcpEndpointValue(config);
    return {
        tcp_server_url: `${endpoint.host}:${endpoint.port}`,
        tcp_auto_reconnect_enabled: normalizeBooleanValue(
            config.tcp_auto_reconnect_enabled
            ?? config.tcpAutoReconnectEnabled
            ?? config.registration_tcp_auto_reconnect_enabled
            ?? config.registrationTcpAutoReconnectEnabled,
            true
        )
    };
}

const DEFAULT_EMAIL_RANDOM_CONFIG = {
    email: {
        length: 8,
        type: 'lowercase'
    }
};

function normalizeEmailRandomSection(section = {}, fallback = {}) {
    const source = section && typeof section === 'object' ? section : {};
    const fallbackSection = fallback && typeof fallback === 'object' ? fallback : {};
    const lengthValue = Number.parseInt(source.length ?? source.random_length ?? source.randomLength, 10);
    const typeValue = String(source.type ?? source.random_type ?? source.randomType ?? fallbackSection.type ?? '').trim();
    const normalizedType = !typeValue || typeValue === 'custom' ? String(fallbackSection.type || '').trim() : typeValue;

    return {
        length: Number.isFinite(lengthValue) && lengthValue > 0
            ? lengthValue
            : Number.parseInt(fallbackSection.length, 10) || 0,
        type: normalizedType || String(fallbackSection.type || '').trim()
    };
}

function extractEmailRandomConfig(source = {}) {
    const config = source && typeof source === 'object' ? source : {};
    const emailSection = normalizeEmailRandomSection(
        {
            length: config.email_random_length ?? config.emailRandomLength,
            type: config.email_random_type ?? config.emailRandomType
        },
        DEFAULT_EMAIL_RANDOM_CONFIG.email
    );

    return {
        email_random_length: emailSection.length,
        email_random_type: emailSection.type || DEFAULT_EMAIL_RANDOM_CONFIG.email.type
    };
}

module.exports = {
    DEFAULT_EMAIL_RANDOM_CONFIG,
    buildHardwareInfoFallback,
    buildTcpConfigSnapshot,
    extractEmailRandomConfig,
    hasRegistrationTcpConfig,
    normalizeBrowserSource,
    normalizeRegistrationMode,
    resolveStartupMode
};
