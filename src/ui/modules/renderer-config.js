const { DEFAULT_EMAIL_HOST, DEFAULT_EMAIL_PORT } = require('../../core/email/email-defaults');
const {
    normalizeBooleanValue,
    normalizeTcpServerUrl
} = require('../../core/infra/config-utils');

/**
 * 运行配置相关的渲染功能。
 *
 * 这里主要负责配置面板的加载与保存。
 * 主配置、邮箱配置和 TCP 配置现在分别对应独立文件。
 */

module.exports = function createRendererConfig(deps) {
    const { elements, ipcRenderer, logger, cardManager } = deps;

    const DEFAULT_EMAIL_RANDOM_LENGTH = 8;
    const DEFAULT_API_MODEL_PARAMS = {
        text: {
            model: '',
            messages: [
                {
                    role: 'user',
                    content: ''
                }
            ],
            temperature: 1,
            stream: false
        },
        image: {
            model: '',
            prompt: '',
            size: '',
            n: 1,
            quality: '',
            response_format: ''
        },
        video: {
            model: '',
            prompt: '',
            size: '',
            n: 1,
            quality: '',
            response_format: ''
        }
    };

    function normalizeRandomLength(value, fallback) {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    function normalizeRandomType(value, fallback) {
        const text = String(value || '').trim();
        if (!text || text === 'custom') {
            return fallback;
        }

        return text;
    }

    function getEmailRandomConfigFromResult(result = {}) {
        const source = result && typeof result === 'object' ? result : {};
        const emailType = normalizeRandomType(source.email_random_type || source.emailRandomType, 'lowercase');

        return {
            email_random_length: normalizeRandomLength(source.email_random_length ?? source.emailRandomLength, DEFAULT_EMAIL_RANDOM_LENGTH),
            email_random_type: emailType
        };
    }

    function getStoredTcpServerUrl(config = {}) {
        const source = config && typeof config === 'object' ? config : {};
        return String(
            source.tcp_server_url ||
            source.tcpServerUrl ||
            source.server_url ||
            source.serverUrl ||
            source.execution_server_url ||
            source.executionServerUrl ||
            source.mqtt_server_url ||
            source.mqttServerUrl ||
            ''
        ).trim();
    }

    function getStoredTcpAutoReconnectEnabled(config = {}) {
        const source = config && typeof config === 'object' ? config : {};
        return normalizeBooleanValue(
            source.tcp_auto_reconnect_enabled ??
            source.tcpAutoReconnectEnabled ??
            source.execution_tcp_auto_reconnect_enabled ??
            source.executionTcpAutoReconnectEnabled,
            true
        );
    }

    async function readCurrentConfig() {
        const result = await ipcRenderer.invoke('get-cookie-user-config');
        if (!result.success) {
            throw new Error(result.error || '读取运行配置失败');
        }

        return result.config && typeof result.config === 'object' ? result.config : {};
    }

    async function loadEmailConfig() {
        try {
            const result = await ipcRenderer.invoke('get-email-config');
            if (!result || result.success !== true) {
                throw new Error(result?.error || '读取邮箱配置失败');
            }

            if (elements.emailHost) {
                elements.emailHost.value = typeof result.email_host === 'string' && result.email_host.trim()
                    ? result.email_host
                    : DEFAULT_EMAIL_HOST;
            }
            if (elements.emailPort) {
                elements.emailPort.value = result.email_port !== undefined && result.email_port !== null
                    ? String(result.email_port)
                    : String(DEFAULT_EMAIL_PORT);
            }
            if (elements.emailSuffix) {
                elements.emailSuffix.value = typeof result.email_suffix === 'string' && result.email_suffix.trim()
                    ? result.email_suffix
                    : 'heysure.top';
            }
            const randomConfig = getEmailRandomConfigFromResult(result);
            if (elements.emailRandomLength) {
                elements.emailRandomLength.value = String(randomConfig.email_random_length);
            }
            if (elements.emailRandomType) {
                elements.emailRandomType.value = randomConfig.email_random_type;
            }
        } catch (error) {
            logger.error(`加载邮箱配置失败: ${error.message}`);
        }
    }

    async function saveEmailConfig() {
        try {
            const result = await ipcRenderer.invoke('save-email-config', {
                email_host: elements.emailHost ? elements.emailHost.value : '',
                email_port: elements.emailPort ? elements.emailPort.value : '',
                email_suffix: elements.emailSuffix ? elements.emailSuffix.value : '',
                email_random_length: elements.emailRandomLength ? elements.emailRandomLength.value : '',
                email_random_type: elements.emailRandomType ? elements.emailRandomType.value : ''
            });
            if (result.success) {
                if (elements.emailHost) {
                    elements.emailHost.value = typeof result.email_host === 'string' && result.email_host.trim()
                        ? result.email_host
                        : DEFAULT_EMAIL_HOST;
                }
                if (elements.emailPort) {
                    elements.emailPort.value = result.email_port !== undefined && result.email_port !== null
                        ? String(result.email_port)
                        : String(DEFAULT_EMAIL_PORT);
                }
                if (elements.emailSuffix) {
                    elements.emailSuffix.value = typeof result.email_suffix === 'string' && result.email_suffix.trim()
                        ? result.email_suffix
                        : 'heysure.top';
                }
                const randomConfig = getEmailRandomConfigFromResult(result);
                if (elements.emailRandomLength) {
                    elements.emailRandomLength.value = String(randomConfig.email_random_length);
                }
                if (elements.emailRandomType) {
                    elements.emailRandomType.value = randomConfig.email_random_type;
                }
            } else {
                logger.error(`保存邮箱配置失败: ${result.error}`);
            }

            return result;
        } catch (error) {
            logger.error(`保存邮箱配置异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async function loadTcpServerConfig() {
        try {
            const result = await ipcRenderer.invoke('get-execution-tcp-config');
            if (!result || result.success !== true) {
                throw new Error(result?.error || '读取TCP配置失败');
            }
            if (elements.tcpServerUrl) {
                const tcpServerUrl = getStoredTcpServerUrl(result);
                elements.tcpServerUrl.value = normalizeTcpServerUrl(tcpServerUrl);
            }
            if (elements.tcpAutoReconnectEnabled) {
                const tcpAutoReconnectEnabled = getStoredTcpAutoReconnectEnabled(result);
                elements.tcpAutoReconnectEnabled.checked = tcpAutoReconnectEnabled !== false;
            }
        } catch (error) {
            logger.error(`加载TCP服务器配置失败: ${error.message}`);
        }
    }

    async function saveTcpServerConfig() {
        try {
            const rawTcpServerUrl = elements.tcpServerUrl ? elements.tcpServerUrl.value : '';
            const tcpServerUrl = normalizeTcpServerUrl(rawTcpServerUrl);
            const tcpAutoReconnectEnabled = elements.tcpAutoReconnectEnabled
                ? elements.tcpAutoReconnectEnabled.checked === true
                : true;

            const result = await ipcRenderer.invoke('save-execution-tcp-config', {
                tcp_server_url: tcpServerUrl,
                tcp_auto_reconnect_enabled: tcpAutoReconnectEnabled
            });
            if (result.success) {
                if (elements.tcpServerUrl) {
                    elements.tcpServerUrl.value = normalizeTcpServerUrl(getStoredTcpServerUrl(result) || tcpServerUrl);
                }
                if (elements.tcpAutoReconnectEnabled) {
                    elements.tcpAutoReconnectEnabled.checked = getStoredTcpAutoReconnectEnabled(result) !== false;
                }
            } else {
                logger.error(`保存TCP服务器地址失败: ${result.error}`);
            }

            return result;
        } catch (error) {
            logger.error(`保存TCP服务器地址异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    function normalizeApiServerConfig(config = {}) {
        const source = config && typeof config === 'object' ? config : {};
        const settings = source.apiServerSettings && typeof source.apiServerSettings === 'object'
            ? source.apiServerSettings
            : source;
        const modelParams = settings.model_params && typeof settings.model_params === 'object'
            ? settings.model_params
            : (settings.modelParams && typeof settings.modelParams === 'object' ? settings.modelParams : {});

        return {
            enabled: settings.enabled === true,
            running: settings.running === true,
            host: String(settings.host || '127.0.0.1').trim() || '127.0.0.1',
            port: Number.parseInt(settings.port, 10) || 8787,
            api_key: String(settings.api_key || settings.apiKey || '').trim(),
            url: String(settings.url || '').trim(),
            model_params: {
                text: modelParams.text && typeof modelParams.text === 'object' ? modelParams.text : DEFAULT_API_MODEL_PARAMS.text,
                image: modelParams.image && typeof modelParams.image === 'object' ? modelParams.image : DEFAULT_API_MODEL_PARAMS.image,
                video: modelParams.video && typeof modelParams.video === 'object' ? modelParams.video : DEFAULT_API_MODEL_PARAMS.video
            }
        };
    }

    function setApiServerStatus(config = {}, errorText = '') {
        const normalized = normalizeApiServerConfig(config);
        if (elements.apiServerStatus) {
            elements.apiServerStatus.classList.toggle('is-running', normalized.running);
            elements.apiServerStatus.classList.toggle('is-error', Boolean(errorText));
            elements.apiServerStatus.textContent = errorText ? '异常' : (normalized.running ? '运行中' : '未开启');
        }
        if (elements.apiServerUrl) {
            elements.apiServerUrl.textContent = errorText
                ? `本地地址: ${errorText}`
                : `本地地址: ${normalized.running && normalized.url ? normalized.url : '-'}`;
        }
        if (elements.apiServerStartBtn) {
            elements.apiServerStartBtn.disabled = normalized.running;
        }
        if (elements.apiServerStopBtn) {
            elements.apiServerStopBtn.disabled = !normalized.running;
        }
    }

    function fillApiServerForm(config = {}) {
        const normalized = normalizeApiServerConfig(config);
        if (elements.apiServerHost) {
            elements.apiServerHost.value = normalized.host;
        }
        if (elements.apiServerPort) {
            elements.apiServerPort.value = String(normalized.port);
        }
        if (elements.apiServerKey) {
            elements.apiServerKey.value = normalized.api_key;
        }
        if (elements.apiTextModelParams) {
            elements.apiTextModelParams.value = JSON.stringify(normalized.model_params.text, null, 2);
        }
        if (elements.apiImageModelParams) {
            elements.apiImageModelParams.value = JSON.stringify(normalized.model_params.image, null, 2);
        }
        if (elements.apiVideoModelParams) {
            elements.apiVideoModelParams.value = JSON.stringify(normalized.model_params.video, null, 2);
        }
        setApiServerStatus(normalized);
    }

    function readJsonTextarea(element, label, fallback) {
        const raw = String(element?.value || '').trim();
        if (!raw) {
            return fallback;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`${label}必须是JSON对象`);
        }
        return parsed;
    }

    function collectApiServerForm() {
        const host = String(elements.apiServerHost?.value || '127.0.0.1').trim() || '127.0.0.1';
        const port = Number.parseInt(elements.apiServerPort?.value, 10) || 8787;
        if (port < 1 || port > 65535) {
            throw new Error('API服务端口必须在 1-65535 之间');
        }

        return {
            host,
            port,
            api_key: String(elements.apiServerKey?.value || '').trim(),
            model_params: {
                text: readJsonTextarea(elements.apiTextModelParams, '文本模型请求参数', DEFAULT_API_MODEL_PARAMS.text),
                image: readJsonTextarea(elements.apiImageModelParams, '图片模型请求参数', DEFAULT_API_MODEL_PARAMS.image),
                video: readJsonTextarea(elements.apiVideoModelParams, '视频模型请求参数', DEFAULT_API_MODEL_PARAMS.video)
            }
        };
    }

    function collectApiServerRequestConfig(type = 'image') {
        const host = String(elements.apiServerHost?.value || '127.0.0.1').trim() || '127.0.0.1';
        const port = Number.parseInt(elements.apiServerPort?.value, 10) || 8787;
        if (port < 1 || port > 65535) {
            throw new Error('API服务端口必须在 1-65535 之间');
        }

        const normalizedType = ['text', 'image', 'video'].includes(String(type || '').trim())
            ? String(type).trim()
            : 'image';
        const paramsMap = {
            text: {
                element: elements.apiTextModelParams,
                label: '文本模型请求参数',
                fallback: DEFAULT_API_MODEL_PARAMS.text
            },
            image: {
                element: elements.apiImageModelParams,
                label: '图片模型请求参数',
                fallback: DEFAULT_API_MODEL_PARAMS.image
            },
            video: {
                element: elements.apiVideoModelParams,
                label: '视频模型请求参数',
                fallback: DEFAULT_API_MODEL_PARAMS.video
            }
        };
        const current = paramsMap[normalizedType];

        return {
            host,
            port,
            api_key: String(elements.apiServerKey?.value || '').trim(),
            model_params: {
                [normalizedType]: readJsonTextarea(current.element, current.label, current.fallback)
            }
        };
    }

    function getSelectedModelCardName() {
        const currentCardName = String(deps.currentModelCard || '').trim();
        if (currentCardName) {
            return currentCardName;
        }

        if (cardManager && typeof cardManager.getCurrentModelCard === 'function') {
            return String(cardManager.getCurrentModelCard() || '').trim();
        }

        return '';
    }

    function getApiRequestLabel(type) {
        if (type === 'text') {
            return '文本接口';
        }
        if (type === 'video') {
            return '视频接口';
        }
        return '图片接口';
    }

    async function testApiServerRequest(type = 'image', triggerButton = null) {
        const normalizedType = ['text', 'image', 'video'].includes(String(type || '').trim())
            ? String(type).trim()
            : 'image';
        const button = triggerButton && typeof triggerButton === 'object' ? triggerButton : null;
        const originalText = button ? button.textContent : '';

        if (button) {
            button.disabled = true;
            button.textContent = '测试中...';
        }

        try {
            const config = collectApiServerRequestConfig(normalizedType);
            if (!config.api_key) {
                throw new Error('请先填写 API Key');
            }

            const modelCardName = getSelectedModelCardName();
            if (!modelCardName) {
                throw new Error('请先选择当前模型卡片');
            }

            const result = await ipcRenderer.invoke('api-server-test-request', {
                type: normalizedType,
                config: {
                    host: config.host,
                    port: config.port,
                    api_key: config.api_key,
                    model_params: config.model_params
                },
                modelCardName
            });

            if (!result || result.success !== true) {
                throw new Error(result?.error || `测试请求失败${result?.statusCode ? ` (HTTP ${result.statusCode})` : ''}`);
            }

            logger.info(`${getApiRequestLabel(normalizedType)} 测试成功: HTTP ${result.statusCode}`);
            return result;
        } catch (error) {
            logger.error(`${getApiRequestLabel(normalizedType)} 测试失败: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = originalText || '测试';
            }
        }
    }

    async function loadApiServerConfig() {
        try {
            const result = await ipcRenderer.invoke('api-server-get-config');
            if (!result || result.success !== true) {
                throw new Error(result?.error || '读取API服务配置失败');
            }
            fillApiServerForm(result.config || {});
            return result;
        } catch (error) {
            logger.error(`加载API服务配置失败: ${error.message}`);
            setApiServerStatus({}, error.message);
            return { success: false, error: error.message };
        }
    }

    async function saveApiServerConfig() {
        try {
            const config = collectApiServerForm();
            const result = await ipcRenderer.invoke('api-server-save-config', config);
            if (!result || result.success !== true) {
                throw new Error(result?.error || '保存API服务配置失败');
            }
            fillApiServerForm(result.config || config);
            return result;
        } catch (error) {
            logger.error(`保存API服务配置失败: ${error.message}`);
            setApiServerStatus({}, error.message);
            return { success: false, error: error.message };
        }
    }

    async function startApiServer() {
        try {
            const config = collectApiServerForm();
            const result = await ipcRenderer.invoke('api-server-start', config);
            if (!result || result.success !== true) {
                throw new Error(result?.error || '开启API服务失败');
            }
            fillApiServerForm(result.config || config);
            return result;
        } catch (error) {
            logger.error(`开启API服务失败: ${error.message}`);
            setApiServerStatus({}, error.message);
            return { success: false, error: error.message };
        }
    }

    async function stopApiServer() {
        try {
            const result = await ipcRenderer.invoke('api-server-stop');
            if (!result || result.success !== true) {
                throw new Error(result?.error || '关闭API服务失败');
            }
            fillApiServerForm(result.config || {});
            return result;
        } catch (error) {
            logger.error(`关闭API服务失败: ${error.message}`);
            setApiServerStatus({}, error.message);
            return { success: false, error: error.message };
        }
    }

    async function generateApiServerKey() {
        try {
            const result = await ipcRenderer.invoke('api-server-generate-key');
            if (!result || result.success !== true || !result.apiKey) {
                throw new Error(result?.error || '生成API Key失败');
            }
            if (elements.apiServerKey) {
                elements.apiServerKey.value = result.apiKey;
            }
            return result;
        } catch (error) {
            logger.error(`生成API Key失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    return {
        loadCookieUserConfig: loadEmailConfig,
        saveCookieUserConfig: saveEmailConfig,
        loadEmailConfig,
        saveEmailConfig,
        loadTcpServerConfig,
        saveTcpServerConfig,
        loadApiServerConfig,
        saveApiServerConfig,
        startApiServer,
        stopApiServer,
        generateApiServerKey,
        testApiServerRequest
    };
};
