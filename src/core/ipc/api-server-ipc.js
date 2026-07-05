const http = require('http');
const crypto = require('crypto');
const express = require('express');

const DEFAULT_API_SERVER_SETTINGS = {
    enabled: false,
    host: '127.0.0.1',
    port: 8787,
    api_key: '',
    model_params: {
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
    }
};

let localApiServer = null;
let localApiServerConfig = null;

function emitApiServerLog(app, payload = {}) {
    const message = String(payload.message || '').trim();
    if (!message) {
        return;
    }

    const eventPayload = {
        time: new Date().toISOString(),
        kind: payload.kind || 'http',
        level: payload.level || 'info',
        message
    };

    const windows = [
        app?.mainWindow,
        app?.desktopWindow,
        app?.headlessUiWindow,
        app?.cardEditorWindow
    ].filter(Boolean);
    const sent = new Set();
    windows.forEach(win => {
        if (!win || sent.has(win) || typeof win.isDestroyed !== 'function' || win.isDestroyed()) {
            return;
        }
        sent.add(win);
        if (win.webContents && typeof win.webContents.send === 'function') {
            win.webContents.send('api-server-log', eventPayload);
        }
    });
}

function clonePlainObject(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_error) {
        return { ...value };
    }
}

function normalizeModelParams(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const defaults = DEFAULT_API_SERVER_SETTINGS.model_params;
    return {
        text: source.text && typeof source.text === 'object' && !Array.isArray(source.text) ? source.text : defaults.text,
        image: source.image && typeof source.image === 'object' && !Array.isArray(source.image) ? source.image : defaults.image,
        video: source.video && typeof source.video === 'object' && !Array.isArray(source.video) ? source.video : defaults.video
    };
}

function normalizeApiServerSettings(settings = {}) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const modelParams = source.model_params && typeof source.model_params === 'object'
        ? source.model_params
        : (source.modelParams && typeof source.modelParams === 'object' ? source.modelParams : {});
    const host = String(source.host || DEFAULT_API_SERVER_SETTINGS.host).trim() || DEFAULT_API_SERVER_SETTINGS.host;
    const port = Number.parseInt(source.port, 10) || DEFAULT_API_SERVER_SETTINGS.port;

    return {
        enabled: source.enabled === true,
        host,
        port,
        api_key: String(source.api_key || source.apiKey || '').trim(),
        model_params: normalizeModelParams(modelParams)
    };
}

function getPublicServerConfig(config = null) {
    const source = config || localApiServerConfig || DEFAULT_API_SERVER_SETTINGS;
    const normalized = normalizeApiServerSettings(source);
    const running = Boolean(localApiServer);
    return {
        ...normalized,
        running,
        url: running ? `http://${normalized.host}:${normalized.port}` : ''
    };
}

async function readSavedConfig(app) {
    const runtimeConfig = typeof app.readExecutionRuntimeConfigFromDisk === 'function'
        ? await app.readExecutionRuntimeConfigFromDisk()
        : {};
    return normalizeApiServerSettings(runtimeConfig.apiServerSettings || {});
}

async function saveConfig(app, settings = {}) {
    const normalized = normalizeApiServerSettings(settings);
    const existing = typeof app.readExecutionRuntimeConfigFromDisk === 'function'
        ? await app.readExecutionRuntimeConfigFromDisk()
        : {};
    const nextConfig = {
        ...(existing && typeof existing === 'object' ? existing : {}),
        apiServerSettings: normalized
    };
    if (typeof app.saveAutomationRuntimeConfigToDisk !== 'function') {
        return { success: false, error: '运行配置保存接口不可用' };
    }

    const result = await app.saveAutomationRuntimeConfigToDisk(nextConfig);
    if (result && result.success === false) {
        return result;
    }

    return {
        success: true,
        config: getPublicServerConfig(normalized),
        configPath: result?.configPath || ''
    };
}

function getRequestApiKey(req) {
    const authorization = String(req.headers.authorization || '').trim();
    const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch) {
        return bearerMatch[1].trim();
    }

    return String(req.headers['x-api-key'] || req.query?.api_key || '').trim();
}

function hasValidApiKey(req, config) {
    const expectedApiKey = String(config.api_key || '').trim();
    if (!expectedApiKey) {
        return false;
    }

    return getRequestApiKey(req) === expectedApiKey;
}

function resolveRequestModel(req, defaults = {}) {
    return String(
        req.body?.model
        || defaults.model
        || req.query?.model
        || ''
    ).trim();
}

async function resolveSelectedModel(app, requestModel = '') {
    try {
        const currentModelCardName = String(app?.currentModelCardName || app?.currentModelCard || '').trim();
        const currentApiCardName = String(app?.currentApiCardName || app?.currentApiCard || '').trim();

        if (!currentModelCardName) {
            return {
                success: false,
                status: 400,
                error: '当前没有选中的模型卡片'
            };
        }

        if (requestModel !== currentModelCardName) {
            return {
                success: false,
                status: 404,
                error: `模型不匹配，请求模型为 ${requestModel || '空'}，当前模型为 ${currentModelCardName}`
            };
        }

        if (!app?.cardManager || typeof app.cardManager.getModelCard !== 'function') {
            return {
                success: false,
                status: 500,
                error: '模型卡片管理器不可用'
            };
        }

        const modelCard = await app.cardManager.getModelCard(currentModelCardName, { forceReload: true });
        if (!modelCard) {
            return {
                success: false,
                status: 404,
                error: `模型卡片不存在: ${currentModelCardName}`
            };
        }

        const modelApiCardName = String(
            modelCard.api_card_name
            || modelCard.apiCardName
            || modelCard.api_name
            || modelCard.apiName
            || ''
        ).trim();

        if (currentApiCardName && modelApiCardName && modelApiCardName !== currentApiCardName) {
            return {
                success: false,
                status: 409,
                error: `模型卡片不属于当前API卡片: ${modelApiCardName} != ${currentApiCardName}`
            };
        }

        return {
            success: true,
            modelCard,
            modelCardName: currentModelCardName,
            apiCardName: currentApiCardName || modelApiCardName
        };
    } catch (error) {
        return {
            success: false,
            status: 500,
            error: `读取模型卡片失败: ${error.message}`
        };
    }
}

function buildSuccessPayload(type, request, selected) {
    const id = `local-${type}-${Date.now()}`;
    if (type === 'text') {
        return {
            id,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: selected.modelCardName,
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: 'success'
                    },
                    finish_reason: 'stop'
                }
            ],
            local_api: {
                success: true,
                api_card_name: selected.apiCardName,
                model_card_name: selected.modelCardName,
                request
            }
        };
    }

    return {
        id,
        object: type === 'image' ? 'image.generation' : 'video.generation',
        created: Math.floor(Date.now() / 1000),
        model: selected.modelCardName,
        data: [],
        local_api: {
            success: true,
            api_card_name: selected.apiCardName,
            model_card_name: selected.modelCardName,
            request
        }
    };
}

function getTestRequestPath(type) {
    if (type === 'text') {
        return '/v1/chat/completions';
    }
    if (type === 'video') {
        return '/v1/videos/generations';
    }
    return '/v1/images/generations';
}

function extractResponseErrorMessage(rawBody, statusCode) {
    const text = String(rawBody || '').trim();
    if (!text) {
        return `请求失败: ${statusCode}`;
    }

    try {
        const parsed = JSON.parse(text);
        const errorMessage = parsed?.error?.message
            || parsed?.message
            || parsed?.error
            || '';
        if (errorMessage) {
            return String(errorMessage).trim();
        }
    } catch (_error) {
    }

    return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function sendHttpJsonRequest({ host, port, path, apiKey, body, timeout = 10000 }) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body || {});
        const request = http.request({
            host,
            port,
            path,
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (response) => {
            let responseText = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                responseText += chunk;
            });
            response.on('end', () => {
                resolve({
                    statusCode: response.statusCode || 0,
                    headers: response.headers || {},
                    rawBody: responseText
                });
            });
        });

        request.on('error', reject);
        request.setTimeout(timeout, () => {
            request.destroy(new Error(`请求超时 (${timeout}ms)`));
        });
        request.write(payload);
        request.end();
    });
}

async function performApiServerTestRequest(app, settings = {}, type = 'image') {
    const normalized = normalizeApiServerSettings(settings);
    const requestType = ['text', 'image', 'video'].includes(String(type || '').trim()) ? String(type).trim() : 'image';
    const pathName = getTestRequestPath(requestType);
    const requestHost = normalized.host === '0.0.0.0' || normalized.host === '::'
        ? '127.0.0.1'
        : normalized.host;
    const selectedModelCardName = String(
        settings?.modelCardName
        || settings?.model_card_name
        || app?.currentModelCardName
        || app?.currentModelCard
        || ''
    ).trim();

    if (!normalized.host || !normalized.port) {
        return {
            success: false,
            error: 'API服务地址无效'
        };
    }

    if (!normalized.api_key) {
        return {
            success: false,
            error: 'API Key不能为空'
        };
    }

    if (!selectedModelCardName) {
        return {
            success: false,
            error: '请先选择一个模型卡片'
        };
    }

    const requestTemplate = clonePlainObject(normalized.model_params?.[requestType]);
    const requestBody = {
        ...requestTemplate,
        model: selectedModelCardName
    };

    emitApiServerLog(app, {
        kind: 'api',
        level: 'info',
        message: `测试请求开始: ${requestType} ${pathName} (model=${selectedModelCardName})`
    });

    try {
        const response = await sendHttpJsonRequest({
            host: requestHost,
            port: normalized.port,
            path: pathName,
            apiKey: normalized.api_key,
            body: requestBody
        });
        const rawBody = String(response.rawBody || '').trim();
        let parsedBody = null;
        if (rawBody) {
            try {
                parsedBody = JSON.parse(rawBody);
            } catch (_error) {
                parsedBody = null;
            }
        }

        const success = response.statusCode >= 200 && response.statusCode < 300;
        const result = {
            success,
            statusCode: response.statusCode,
            response: parsedBody || rawBody || null,
            rawBody,
            request: requestBody
        };

        emitApiServerLog(app, {
            kind: 'api',
            level: success ? 'info' : 'error',
            message: `测试请求完成: ${requestType} -> ${response.statusCode}`
        });

        if (!success) {
            result.error = extractResponseErrorMessage(rawBody, response.statusCode);
        }

        return result;
    } catch (error) {
        emitApiServerLog(app, {
            kind: 'api',
            level: 'error',
            message: `测试请求失败: ${requestType} - ${error.message}`
        });
        return {
            success: false,
            error: error.message
        };
    }
}

function createOpenAiCompatibleApp(app, config) {
    const serverApp = express();
    serverApp.use(express.json({ limit: '10mb' }));
    serverApp.use((req, res, next) => {
        const startedAt = Date.now();
        emitApiServerLog(app, {
            kind: 'http',
            level: 'info',
            message: `收到请求: ${req.method} ${req.originalUrl || req.url}`
        });
        res.on('finish', () => {
            emitApiServerLog(app, {
                kind: 'http',
                level: res.statusCode >= 400 ? 'error' : 'info',
                message: `${req.method} ${req.originalUrl || req.url} -> ${res.statusCode} (${Date.now() - startedAt}ms)`
            });
        });
        next();
    });
    serverApp.use((req, res, next) => {
        if (req.path === '/health') {
            next();
            return;
        }

        if (!hasValidApiKey(req, config)) {
            emitApiServerLog(app, {
                kind: 'api',
                level: 'error',
                message: `鉴权失败: ${req.method} ${req.originalUrl || req.url}`
            });
            res.status(401).json({
                error: {
                    message: 'API Key无效或缺失',
                    type: 'unauthorized'
                }
            });
            return;
        }

        next();
    });

    serverApp.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            service: 'local-api-server',
            auth_required: true,
            model_params: config.model_params
        });
    });

    const handleOpenAiRequest = (type) => async (req, res) => {
        try {
            const defaults = clonePlainObject(config.model_params?.[type]);
            const requestBody = req.body && typeof req.body === 'object' ? req.body : {};
            const request = {
                ...defaults,
                ...requestBody
            };
            const requestModel = resolveRequestModel(req, defaults);
            const selected = await resolveSelectedModel(app, requestModel);
            if (!selected.success) {
                emitApiServerLog(app, {
                    kind: 'api',
                    level: 'error',
                    message: `${type} 调用失败: ${selected.error}`
                });
                res.status(selected.status || 400).json({
                    error: {
                        message: selected.error,
                        type: 'model_selection_error'
                    }
                });
                return;
            }

            emitApiServerLog(app, {
                kind: 'api',
                level: 'info',
                message: `${type} 调用成功: model=${selected.modelCardName}, api=${selected.apiCardName || '-'}`
            });
            res.json(buildSuccessPayload(type, request, selected));
        } catch (error) {
            emitApiServerLog(app, {
                kind: 'api',
                level: 'error',
                message: `${type} 调用异常: ${error.message}`
            });
            if (res.headersSent) {
                return;
            }
            res.status(500).json({
                error: {
                    message: `服务处理失败: ${error.message}`,
                    type: 'server_error'
                }
            });
        }
    };

    serverApp.post('/v1/chat/completions', handleOpenAiRequest('text'));
    serverApp.post('/v1/images/generations', handleOpenAiRequest('image'));
    serverApp.post('/v1/videos/generations', handleOpenAiRequest('video'));
    serverApp.use((req, res) => {
        emitApiServerLog(app, {
            kind: 'api',
            level: 'error',
            message: `接口不存在: ${req.method} ${req.originalUrl || req.url}`
        });
        res.status(404).json({
            error: {
                message: '接口不存在',
                type: 'not_found'
            }
        });
    });

    serverApp.use((error, req, res, _next) => {
        emitApiServerLog(app, {
            kind: 'api',
            level: 'error',
            message: `请求处理异常: ${req.method} ${req.originalUrl || req.url} - ${error.message}`
        });

        if (res.headersSent) {
            return;
        }

        res.status(500).json({
            error: {
                message: `请求处理异常: ${error.message}`,
                type: 'server_error'
            }
        });
    });

    return serverApp;
}

async function stopServer() {
    if (!localApiServer) {
        return;
    }

    const server = localApiServer;
    localApiServer = null;
    await new Promise((resolve, reject) => {
        server.close(error => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

async function startServer(settings = {}) {
    await stopServer();
    const config = normalizeApiServerSettings({
        ...settings,
        enabled: true
    });
    if (!config.api_key) {
        throw new Error('请先生成或填写API Key');
    }
    const serverApp = createOpenAiCompatibleApp(settings.app, config);
    const server = http.createServer(serverApp);

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
            server.off('error', reject);
            resolve();
        });
    });

    localApiServer = server;
    localApiServerConfig = config;
    emitApiServerLog(settings.app, {
        kind: 'api',
        level: 'info',
        message: `本地API服务已开启: http://${config.host}:${config.port}`
    });
    return config;
}

module.exports = function registerApiServerHandlers({ app, ipcMain }) {
    ipcMain.handle('api-server-get-config', async () => {
        try {
            const config = localApiServerConfig || await readSavedConfig(app);
            return {
                success: true,
                config: getPublicServerConfig(config)
            };
        } catch (error) {
            app.logger?.error?.(`读取API服务配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('api-server-save-config', async (_event, settings) => {
        try {
            const currentRunning = Boolean(localApiServer);
            const normalized = normalizeApiServerSettings({
                ...settings,
                enabled: currentRunning
            });
            localApiServerConfig = normalized;
            return await saveConfig(app, normalized);
        } catch (error) {
            app.logger?.error?.(`保存API服务配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('api-server-start', async (_event, settings) => {
        try {
            const config = await startServer({
                ...settings,
                app
            });
            await saveConfig(app, config);
            return {
                success: true,
                config: getPublicServerConfig(config)
            };
        } catch (error) {
            app.logger?.error?.(`开启API服务失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('api-server-stop', async () => {
        try {
            const config = localApiServerConfig || await readSavedConfig(app);
            await stopServer();
            const normalized = normalizeApiServerSettings({
                ...config,
                enabled: false
            });
            localApiServerConfig = normalized;
            await saveConfig(app, normalized);
            emitApiServerLog(app, {
                kind: 'api',
                level: 'info',
                message: '本地API服务已关闭'
            });
            return {
                success: true,
                config: getPublicServerConfig(normalized)
            };
        } catch (error) {
            app.logger?.error?.(`关闭API服务失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('api-server-generate-key', async () => {
        try {
            return {
                success: true,
                apiKey: `sk-local-${crypto.randomBytes(24).toString('hex')}`
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('api-server-test-request', async (_event, payload = {}) => {
        try {
            const source = payload && typeof payload === 'object' ? payload : {};
            const result = await performApiServerTestRequest(
                app,
                {
                    ...(source.config && typeof source.config === 'object' ? source.config : {}),
                    modelCardName: source.modelCardName || source.model_card_name || ''
                },
                source.type || 'image'
            );
            return result;
        } catch (error) {
            app.logger?.error?.(`API服务测试请求失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};

