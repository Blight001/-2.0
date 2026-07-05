const http = require('http');
const path = require('path');
const fs = require('fs-extra');
const express = require('express');
const { buildBundle } = require('./web-ui-bundler');
const { TempEmailService } = require('../temp-email/temp-email-service');

function escapeInlineJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');
}

function readQueryValue(query = {}, keys = []) {
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(query, key)) {
            continue;
        }
        const value = query[key];
        if (Array.isArray(value)) {
            const first = value.find((item) => String(item || '').trim());
            if (first !== undefined) {
                return String(first || '').trim();
            }
            continue;
        }
        const text = String(value || '').trim();
        if (text) {
            return text;
        }
    }
    return '';
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

function buildExecutionRouteUrl(baseUrl, context = {}, routePath = '/') {
    const url = new URL(baseUrl);
    url.pathname = routePath.startsWith('/') ? routePath : `/${routePath}`;
    url.search = '';

    const registrationMode = normalizeRegistrationMode(context.registrationMode, 'standalone');
    const embedded = context.embedded === true || registrationMode === 'embedded';
    if (embedded) {
        url.searchParams.set('mode', 'embedded');
    }
    if (String(context.hostApp || '').trim()) {
        url.searchParams.set('host', String(context.hostApp).trim());
    }
    if (String(context.browserSource || '').trim()) {
        url.searchParams.set('browserSource', String(context.browserSource).trim());
    }

    return url.toString();
}

class WebControlServer {
    constructor(options = {}) {
        this.app = options.app;
        this.projectRoot = options.projectRoot;
        this.logger = options.logger || console;
        this.rpcRegistry = options.rpcRegistry;
        this.uiChannelManager = options.uiChannelManager;
        this.host = options.host || '127.0.0.1';
        this.port = Number.isFinite(Number(options.port)) ? Number(options.port) : 18765;
        this.registrationMode = normalizeRegistrationMode(options.registrationMode || options.mode || 'standalone');
        this.hostApp = String(options.hostApp || options.registrationHostApp || '').trim();
        this.server = null;
        this.sockets = new Set();
    }

    getUrl() {
        return `http://${this.host}:${this.port}`;
    }

    isRunning() {
        return !!this.server;
    }

    async start() {
        if (this.server) {
            return {
                success: true,
                url: this.getUrl(),
                alreadyRunning: true
            };
        }

        const app = express();
        app.use((request, response, next) => {
            response.setHeader('Access-Control-Allow-Origin', '*');
            response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            if (request.method === 'OPTIONS') {
                response.sendStatus(204);
                return;
            }
            next();
        });
        app.use(express.json({ limit: '50mb' }));
        app.use('/ui', express.static(path.join(this.projectRoot, 'src/ui')));

        app.get('/', async (request, response) => {
            const html = await this._buildCurrentPageHtml(request);
            response.type('html').send(html);
        });

        app.get('/login', async (request, response) => {
            const runtimeContext = this._resolveRequestRuntimeContext(request);

            if (this._shouldBypassLogin()) {
                response.redirect(302, buildExecutionRouteUrl(this.getUrl(), runtimeContext, '/'));
                return;
            }

            const html = await this._buildLoginPageHtml(request, runtimeContext);
            response.type('html').send(html);
        });

        app.get('/web/ui-bundle.js', (_request, response) => {
            const bundle = buildBundle(this.projectRoot);
            response.type('application/javascript').send(bundle);
        });

        app.get('/health', (_request, response) => {
            response.json({
                success: true,
                service: 'web-control',
                url: this.getUrl()
            });
        });

        app.post('/api/temp-email/open-window', async (request, response) => {
            await this._handleTempEmailRequest(request, response, async (service, payload) => {
                const result = await service.openProvider(payload);
                return {
                    ...result,
                    state: result.state || service.getState()
                };
            });
        });

        app.post('/api/temp-email/close-window', async (request, response) => {
            await this._handleTempEmailRequest(request, response, async (service, payload) => {
                const result = await service.closeSession(payload.sessionId || payload.taskId || payload.browserSessionId || 'default');
                return {
                    ...result,
                    state: service.getState()
                };
            });
        });

        app.post('/api/temp-email/get-email', async (request, response) => {
            await this._handleTempEmailRequest(request, response, async (service, payload) => {
                const result = await service.getEmail(payload);
                return {
                    ...result,
                    state: result.state || service.getState()
                };
            });
        });

        app.post('/api/temp-email/get-code', async (request, response) => {
            await this._handleTempEmailRequest(request, response, async (service, payload) => {
                const result = await service.getCode(payload);
                return {
                    ...result,
                    state: result.state || service.getState()
                };
            });
        });

        app.post('/api/invoke', async (request, response) => {
            try {
                const channel = String(request.body?.channel || '').trim();
                const args = Array.isArray(request.body?.args) ? request.body.args : [];

                if (!channel) {
                    response.status(400).json({ error: '调用通道不能为空' });
                    return;
                }

                const result = await this.rpcRegistry.invoke(channel, ...args);
                response.json({ result });
            } catch (error) {
                response.status(500).json({ error: error.message || '调用失败' });
            }
        });

        app.get('/api/events', (request, response) => {
            response.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });
            response.write('\n');

            const clientId = this.uiChannelManager.addWebClient(response);
            const heartbeatTimer = setInterval(() => {
                if (!response.writableEnded) {
                    response.write(': keep-alive\n\n');
                }
            }, 20000);

            request.on('close', () => {
                clearInterval(heartbeatTimer);
                this.uiChannelManager.removeWebClient(clientId);
            });
        });

        await new Promise((resolve, reject) => {
            const server = http.createServer(app);
            server.on('connection', (socket) => {
                this.sockets.add(socket);
                socket.on('close', () => {
                    this.sockets.delete(socket);
                });
            });
            server.once('error', reject);
            server.listen(this.port, this.host, () => {
                this.server = server;
                resolve();
            });
        });

        this.logger.info(`网页控制台已启动: ${this.getUrl()}`);
        return {
            success: true,
            url: this.getUrl(),
            registrationMode: this.registrationMode,
            embedded: this.registrationMode === 'embedded',
            hostApp: this.hostApp
        };
    }

    _getTempEmailService() {
        if (!this.app) {
            return null;
        }

        if (this.app.tempEmailService) {
            return this.app.tempEmailService;
        }

        const tempEmailService = new TempEmailService(this.app);
        this.app.tempEmailService = tempEmailService;
        return tempEmailService;
    }

    async _handleTempEmailRequest(request, response, handler) {
        try {
            const service = this._getTempEmailService();
            if (!service) {
                response.status(500).json({ success: false, error: '临时邮箱服务不可用' });
                return;
            }

            const payload = request.body && typeof request.body === 'object' ? request.body : {};
            const result = await handler(service, payload);
            if (!result || result.success !== true) {
                response.status(400).json(result || { success: false, error: '操作失败' });
                return;
            }

            response.json(result);
        } catch (error) {
            response.status(500).json({
                success: false,
                error: error.message || '临时邮箱 HTTP 调试失败'
            });
        }
    }

    _resolveRequestRuntimeContext(request = null) {
        const query = request && request.query && typeof request.query === 'object'
            ? request.query
            : {};
        const queryMode = normalizeRegistrationMode(
            readQueryValue(query, ['mode', 'registration_mode', 'registrationMode']),
            this.registrationMode
        );
        const embeddedByQuery = queryMode === 'embedded'
            || readQueryValue(query, ['embed', 'embedded', 'registration_embedded']) === '1'
            || /^true$/i.test(readQueryValue(query, ['embed', 'embedded', 'registration_embedded']));
        const hostApp = readQueryValue(query, ['host', 'host_app', 'registration_host_app'])
            || readQueryValue(query, ['embed-host', 'embed_host', 'registration_embed_host'])
            || this.hostApp
            || '';
        const browserSource = readQueryValue(query, ['browserSource', 'browser_source', 'registration_browser_source'])
            || readQueryValue(query, ['browserType', 'browser_type', 'registration_browser_type'])
            || this.browserSource
            || 'local-browser';
        const normalizedBrowserSource = (() => {
            const normalized = String(browserSource || '').trim().toLowerCase();
            if (normalized === 'plugin-browser' || normalized === 'plugin' || normalized === 'extension-browser' || normalized === 'extension') {
                return 'plugin-browser';
            }
            if (normalized === 'client-browser' || normalized === 'client' || normalized === 'host-browser') {
                return 'client-browser';
            }
            return 'local-browser';
        })();
        const registrationMode = embeddedByQuery ? 'embedded' : queryMode;

        return {
            url: this.getUrl(),
            registrationMode,
            embedded: registrationMode === 'embedded',
            hostApp,
            browserSource: normalizedBrowserSource,
            source: registrationMode === 'embedded' ? 'embedded' : 'standalone'
        };
    }

    _buildRuntimeBootstrapScript(context = {}) {
        const runtime = {
            registrationMode: normalizeRegistrationMode(context.registrationMode, this.registrationMode),
            embedded: context.embedded === true || normalizeRegistrationMode(context.registrationMode, this.registrationMode) === 'embedded',
            hostApp: String(context.hostApp || this.hostApp || '').trim(),
                browserSource: (() => {
                    const normalized = String(context.browserSource || context.browserType || this.browserSource || 'local-browser').trim().toLowerCase();
                    if (normalized === 'plugin-browser' || normalized === 'plugin' || normalized === 'extension-browser' || normalized === 'extension') {
                        return 'plugin-browser';
                    }
                return normalized === 'client-browser' || normalized === 'client' || normalized === 'host-browser'
                    ? 'client-browser'
                    : 'local-browser';
            })(),
            webUiUrl: this.getUrl(),
            executionHomeUrl: buildExecutionRouteUrl(this.getUrl(), context, '/'),
            executionLoginUrl: buildExecutionRouteUrl(this.getUrl(), context, '/login'),
            source: String(context.source || '').trim() || 'standalone'
        };
        const json = escapeInlineJson(runtime);
        return `<script>
(function () {
  var runtime = ${json};
  window.__REGISTRATION_RUNTIME__ = runtime;
  window.__WEB_CONTROL_RUNTIME__ = runtime;
  window.__REGISTRATION_EMBEDDED__ = runtime.embedded === true;
  window.__REGISTRATION_HOST_APP__ = runtime.hostApp || '';
  window.__REGISTRATION_BROWSER_SOURCE__ = runtime.browserSource || 'local-browser';
  window.__REGISTRATION_HOME_URL__ = runtime.executionHomeUrl || runtime.webUiUrl || '/';
  window.__REGISTRATION_LOGIN_URL__ = runtime.executionLoginUrl || '/login';
  try {
    document.documentElement.dataset.registrationMode = runtime.registrationMode || 'standalone';
    document.documentElement.dataset.registrationEmbedded = runtime.embedded ? 'true' : 'false';
    document.documentElement.dataset.registrationHostApp = runtime.hostApp || '';
    document.documentElement.dataset.registrationBrowserSource = runtime.browserSource || 'local-browser';
  } catch (_error) {}
})();
</script>`;
    }

    async _buildCurrentPageHtml(request = null) {
        const runtimeContext = this._resolveRequestRuntimeContext(request);
        if (!this._shouldBypassLogin()) {
            return await this._buildLoginPageHtml(request, runtimeContext);
        }

        return await this._buildMainPageHtml(request, runtimeContext);
    }

    _shouldBypassLogin() {
        if (!this.app) {
            return false;
        }

        if (this.app.webControlConfig?.enabled === true) {
            return true;
        }

        if (this.app.isValidated === true) {
            return true;
        }

        return false;
    }

    async _buildMainPageHtml(request = null, runtimeContext = null) {
        const indexHtmlPath = path.join(this.projectRoot, 'src/ui', 'index.html');
        const source = await fs.readFile(indexHtmlPath, 'utf8');
        const runtime = runtimeContext || this._resolveRequestRuntimeContext(request);
        return source
            .replace('</head>', `${this._buildRuntimeBootstrapScript(runtime)}</head>`)
            .replace('href="styles.css"', 'href="/ui/styles.css"')
            .replace('src="renderer.js"', 'src="/web/ui-bundle.js"');
    }

    async _buildLoginPageHtml(request = null, runtimeContext = null) {
        const title = '卡密验证 - AI 自动化工具 2.0';
        const runtime = runtimeContext || this._resolveRequestRuntimeContext(request);
        const bootstrapScript = this._buildRuntimeBootstrapScript(runtime);
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        * { box-sizing: border-box; }
        html, body { width: 100%; height: 100%; margin: 0; }
        body {
            font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
            background: linear-gradient(180deg, #101826 0%, #0b1220 100%);
            color: #e9eefb;
            overflow: hidden;
        }
        .wrap {
            width: 100%;
            min-height: 100%;
            display: grid;
            place-items: center;
            padding: 18px;
        }
        .card {
            width: 100%;
            max-width: 370px;
            padding: 20px 20px 18px;
            border-radius: 18px;
            background: rgba(17, 25, 38, 0.92);
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.38);
        }
        .error-message {
            display: none;
            margin-bottom: 12px;
            padding: 10px 12px;
            border-radius: 10px;
            background: rgba(255, 96, 96, 0.12);
            color: #ffc9c9;
            font-size: 13px;
            line-height: 1.5;
        }
        .error-message.show { display: block; }
        .field { margin-bottom: 12px; }
        .field label {
            display: block;
            margin-bottom: 8px;
            font-size: 13px;
            color: #dfe7f6;
        }
        .input {
            width: 100%;
            padding: 11px 14px;
            border: 1px solid rgba(255, 255, 255, 0.10);
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.05);
            color: #fff;
            outline: none;
            font-size: 14px;
        }
        .input:focus { border-color: rgba(122, 162, 255, 0.55); }
        .device-id {
            padding: 11px 14px;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.08);
            font-family: Consolas, monospace;
            font-size: 12px;
            line-height: 1.5;
            word-break: break-all;
            color: #dbe5f7;
        }
        .row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin: 10px 0 12px;
            font-size: 13px;
        }
        .remember {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #dfe7f6;
        }
        .remember input { accent-color: #7aa2ff; }
        .link-btn {
            border: 0;
            background: transparent;
            color: #9eb7ff;
            cursor: pointer;
            padding: 0;
            font-size: 13px;
        }
        .btn {
            width: 100%;
            height: 44px;
            border: 0;
            border-radius: 12px;
            background: linear-gradient(135deg, #7aa2ff 0%, #63e6be 100%);
            color: #09111d;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
        }
        .btn:disabled { opacity: 0.7; cursor: not-allowed; }
        .loading-spinner {
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid rgba(9, 17, 29, 0.28);
            border-top-color: #09111d;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-right: 8px;
            vertical-align: middle;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .success-tip {
            margin-top: 10px;
            color: #9fe8c2;
            font-size: 12px;
            line-height: 1.5;
            min-height: 18px;
        }
        .validation-info {
            display: none;
            margin-top: 14px;
            padding: 12px;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.08);
            color: #dfe7f6;
            font-size: 12px;
            line-height: 1.6;
        }
        .validation-info.show { display: block; }
        .validation-info__title {
            margin-bottom: 8px;
            font-size: 13px;
            font-weight: 700;
            color: #ffffff;
        }
        .validation-info__grid {
            display: grid;
            gap: 6px;
        }
        .validation-info__row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
        }
        .validation-info__label {
            color: #9fb0d1;
            flex: 0 0 auto;
        }
        .validation-info__value {
            text-align: right;
            word-break: break-all;
            flex: 1 1 auto;
        }
        .validation-info details {
            margin-top: 10px;
        }
        .validation-info summary {
            cursor: pointer;
            color: #9eb7ff;
        }
        .validation-info pre {
            margin: 8px 0 0;
            padding: 10px;
            max-height: 170px;
            overflow: auto;
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.2);
            color: #dfe7f6;
            white-space: pre-wrap;
            word-break: break-word;
        }
    </style>
    ${bootstrapScript}
</head>
<body>
    <div class="wrap">
        <div class="card">
            <div id="error-message" class="error-message"></div>
            <div class="field">
                <label for="card-key">卡密</label>
                <input id="card-key" class="input" type="text" placeholder="请输入卡密" autocomplete="off" spellcheck="false">
            </div>
            <div class="field">
                <div id="device-id" class="device-id">获取中...</div>
            </div>
            <div class="row">
                <label class="remember">
                    <input type="checkbox" id="remember-key" checked>
                    记住卡密
                </label>
                <button id="clear-saved-btn" class="link-btn" type="button">清除记录</button>
            </div>
            <button id="validate-btn" class="btn">验证并进入</button>
            <div id="success-tip" class="success-tip"></div>
            <div id="validation-info" class="validation-info" aria-live="polite"></div>
        </div>
    </div>

    <script>
        const invoke = async (channel, ...args) => {
            const response = await fetch('/api/invoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel, args })
            });

            let payload = null;
            try {
                payload = await response.json();
            } catch (_error) {
                payload = null;
            }

            if (!response.ok) {
                throw new Error(payload && payload.error ? payload.error : '网页调用失败');
            }

            return payload ? payload.result : null;
        };

        const elements = {
            cardKey: document.getElementById('card-key'),
            deviceId: document.getElementById('device-id'),
            errorMessage: document.getElementById('error-message'),
            validateBtn: document.getElementById('validate-btn'),
            rememberKey: document.getElementById('remember-key'),
            clearSavedBtn: document.getElementById('clear-saved-btn'),
            successTip: document.getElementById('success-tip'),
            validationInfo: document.getElementById('validation-info')
        };

        let deviceId = '';
        let isSubmitting = false;

        document.addEventListener('DOMContentLoaded', async () => {
            await init();

            elements.cardKey.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    validateKey();
                }
            });

            elements.cardKey.addEventListener('input', () => {
                hideError();
                elements.successTip.textContent = '';
                hideValidationInfo();
            });

            elements.validateBtn.addEventListener('click', validateKey);
            elements.clearSavedBtn.addEventListener('click', clearSavedKey);
        });

        async function init() {
            try {
                const [deviceResult, savedResult] = await Promise.all([
                    invoke('get-device-id'),
                    invoke('get-saved-card-key')
                ]);

                deviceId = deviceResult || '';
                elements.deviceId.textContent = deviceId || '获取失败';

                if (savedResult && savedResult.success && savedResult.cardKey) {
                    elements.cardKey.value = savedResult.cardKey;
                    elements.rememberKey.checked = true;
                    setTimeout(() => validateKey(), 0);
                }
            } catch (error) {
                elements.deviceId.textContent = '获取失败';
                showError('初始化失败: ' + error.message);
            }
        }

        async function validateKey() {
            if (isSubmitting) return;

            const cardKey = elements.cardKey.value.trim();
            if (!cardKey) {
                showError('请输入卡密');
                return;
            }

            isSubmitting = true;
            setLoading(true);
            hideError();
            elements.successTip.textContent = '';

            try {
                const result = await invoke('validate-card-key', {
                    key: cardKey,
                    deviceId
                });

                if (result && result.success) {
                    await saveCardKey(cardKey);
                    elements.validateBtn.textContent = '验证成功';
                    elements.successTip.textContent = '验证通过，正在进入主界面...';
                    renderValidationInfo(result);
                    elements.validateBtn.disabled = true;
                    const confirmResult = await invoke('confirm-validation-success');
                    if (!confirmResult || confirmResult.success !== true) {
                        throw new Error(confirmResult?.error || '进入主界面失败');
                    }
                    const homeUrl = window.__REGISTRATION_HOME_URL__ || '/';
                    window.location.href = homeUrl;
                } else {
                    showError(result?.error || '验证失败，请检查卡密');
                    setLoading(false);
                }
            } catch (error) {
                showError('验证请求失败: ' + error.message);
                setLoading(false);
            } finally {
                isSubmitting = false;
            }
        }

        async function saveCardKey(cardKey) {
            try {
                if (elements.rememberKey.checked) {
                    await invoke('save-saved-card-key', cardKey);
                } else {
                    await invoke('clear-saved-card-key');
                }
            } catch (error) {}
        }

        async function clearSavedKey() {
            try {
                await invoke('clear-saved-card-key');
                elements.cardKey.value = '';
                elements.rememberKey.checked = false;
                hideError();
                elements.successTip.textContent = '本地记录已清除';
                hideValidationInfo();
            } catch (error) {
                showError('清除记录失败: ' + error.message);
            }
        }

        function extractLicenseExpiryText(result) {
            const candidates = [
                result?.valid_date,
                result?.validDate,
                result?.expiry_date,
                result?.expire_date,
                result?.expires_at,
                result?.expireAt,
                result?.content?.valid_date,
                result?.content?.validDate,
                result?.content?.expiry_date,
                result?.content?.expire_date,
                result?.data?.valid_date,
                result?.data?.validDate,
                result?.data?.expiry_date,
                result?.data?.expire_date
            ];

            return candidates.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
        }

        function setLoading(loading) {
            elements.validateBtn.disabled = loading;
            if (loading) {
                elements.validateBtn.innerHTML = '<span class="loading-spinner"></span>验证中...';
            } else {
                elements.validateBtn.textContent = '验证并进入';
            }
        }

        function showError(text) {
            elements.errorMessage.textContent = text;
            elements.errorMessage.classList.add('show');
        }

        function hideError() {
            elements.errorMessage.textContent = '';
            elements.errorMessage.classList.remove('show');
        }

        function normalizeUsageText(value) {
            if (value === null || value === undefined) {
                return '';
            }
            return String(value).trim();
        }

        function hasExplicitNullUsageTotal(result) {
            const candidates = [
                result?.max_usage_times,
                result?.maxUsageTimes,
                result?.total_times,
                result?.totalTimes,
                result?.limit_times,
                result?.limitTimes,
                result?.times,
                result?.count,
                result?.content?.max_usage_times,
                result?.content?.maxUsageTimes,
                result?.content?.total_times,
                result?.content?.totalTimes,
                result?.content?.limit_times,
                result?.content?.limitTimes,
                result?.content?.times,
                result?.content?.count,
                result?.data?.max_usage_times,
                result?.data?.maxUsageTimes,
                result?.data?.total_times,
                result?.data?.totalTimes,
                result?.data?.limit_times,
                result?.data?.limitTimes,
                result?.data?.times,
                result?.data?.count,
                result?.result?.max_usage_times,
                result?.result?.maxUsageTimes,
                result?.result?.total_times,
                result?.result?.totalTimes,
                result?.result?.limit_times,
                result?.result?.limitTimes,
                result?.result?.times,
                result?.result?.count,
                result?.validationResult?.max_usage_times,
                result?.validationResult?.maxUsageTimes,
                result?.validationResult?.total_times,
                result?.validationResult?.totalTimes,
                result?.validationResult?.limit_times,
                result?.validationResult?.limitTimes,
                result?.validationResult?.times,
                result?.validationResult?.count
            ];

            return candidates.some((value) => value === null);
        }

        function extractLicenseExpiryText(result) {
            const candidates = [
                result?.expire_at,
                result?.expireAt,
                result?.valid_at,
                result?.valid_date,
                result?.validDate,
                result?.expiry_date,
                result?.expire_date,
                result?.expires_at,
                result?.content?.expire_at,
                result?.content?.valid_date,
                result?.content?.validDate,
                result?.content?.expiry_date,
                result?.content?.expire_date,
                result?.content?.expires_at,
                result?.content?.expireAt,
                result?.data?.expire_at,
                result?.data?.valid_date,
                result?.data?.validDate,
                result?.data?.expiry_date,
                result?.data?.expire_date,
                result?.data?.expires_at,
                result?.data?.expireAt
            ];

            return candidates.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
        }

        function extractLicenseUsageText(result) {
            const usageInfoText = normalizeUsageText(result?.usageInfo?.summaryText);
            if (usageInfoText) {
                return usageInfoText;
            }
            if (result?.usageInfo?.unlimited === true) {
                return '无限次数';
            }
            if (hasExplicitNullUsageTotal(result)) {
                return '无限次数';
            }

            const unlimitedCandidates = [
                result?.is_unlimited,
                result?.isUnlimited,
                result?.unlimited,
                result?.no_limit,
                result?.noLimit,
                result?.remaining_usage_times,
                result?.remainingUsageTimes,
                result?.remaining_times,
                result?.remainingTimes,
                result?.remaining_count,
                result?.remainingCount,
                result?.surplus_times,
                result?.surplusTimes,
                result?.usage_times,
                result?.usageTimes,
                result?.used_times,
                result?.usedTimes,
                result?.used_count,
                result?.usedCount,
                result?.max_usage_times,
                result?.maxUsageTimes,
                result?.total_times,
                result?.totalTimes,
                result?.limit_times,
                result?.limitTimes,
                result?.times,
                result?.count,
                result?.content?.is_unlimited,
                result?.content?.isUnlimited,
                result?.content?.unlimited,
                result?.content?.no_limit,
                result?.content?.noLimit,
                result?.content?.remaining_usage_times,
                result?.content?.remainingUsageTimes,
                result?.content?.remaining_times,
                result?.content?.remainingTimes,
                result?.content?.remaining_count,
                result?.content?.remainingCount,
                result?.content?.surplus_times,
                result?.content?.surplusTimes,
                result?.content?.usage_times,
                result?.content?.usageTimes,
                result?.content?.used_times,
                result?.content?.usedTimes,
                result?.content?.used_count,
                result?.content?.usedCount,
                result?.content?.max_usage_times,
                result?.content?.maxUsageTimes,
                result?.content?.total_times,
                result?.content?.totalTimes,
                result?.content?.limit_times,
                result?.content?.limitTimes,
                result?.content?.times,
                result?.content?.count,
                result?.data?.is_unlimited,
                result?.data?.isUnlimited,
                result?.data?.unlimited,
                result?.data?.no_limit,
                result?.data?.noLimit,
                result?.data?.remaining_usage_times,
                result?.data?.remainingUsageTimes,
                result?.data?.remaining_times,
                result?.data?.remainingTimes,
                result?.data?.remaining_count,
                result?.data?.remainingCount,
                result?.data?.surplus_times,
                result?.data?.surplusTimes,
                result?.data?.usage_times,
                result?.data?.usageTimes,
                result?.data?.used_times,
                result?.data?.usedTimes,
                result?.data?.used_count,
                result?.data?.usedCount,
                result?.data?.max_usage_times,
                result?.data?.maxUsageTimes,
                result?.data?.total_times,
                result?.data?.totalTimes,
                result?.data?.limit_times,
                result?.data?.limitTimes,
                result?.data?.times,
                result?.data?.count
            ];

            const unlimitedText = unlimitedCandidates.find((value) => {
                const text = normalizeUsageText(value);
                return text === 'true' || /无限|不限|终身|永久|unlimited|no\s*limit/i.test(text);
            });
            if (unlimitedText !== undefined) {
                return '无限次数';
            }

            const remainingCandidates = [
                result?.remaining_usage_times,
                result?.remainingUsageTimes,
                result?.remaining_times,
                result?.remainingTimes,
                result?.remaining_count,
                result?.remainingCount,
                result?.surplus_times,
                result?.surplusTimes,
                result?.content?.remaining_usage_times,
                result?.content?.remainingUsageTimes,
                result?.content?.remaining_times,
                result?.content?.remainingTimes,
                result?.content?.remaining_count,
                result?.content?.remainingCount,
                result?.content?.surplus_times,
                result?.content?.surplusTimes,
                result?.data?.remaining_usage_times,
                result?.data?.remainingUsageTimes,
                result?.data?.remaining_times,
                result?.data?.remainingTimes,
                result?.data?.remaining_count,
                result?.data?.remainingCount,
                result?.data?.surplus_times,
                result?.data?.surplusTimes
            ];
            const usedCandidates = [
                result?.usage_times,
                result?.usageTimes,
                result?.used_times,
                result?.usedTimes,
                result?.used_count,
                result?.usedCount,
                result?.content?.usage_times,
                result?.content?.usageTimes,
                result?.content?.used_times,
                result?.content?.usedTimes,
                result?.content?.used_count,
                result?.content?.usedCount,
                result?.data?.usage_times,
                result?.data?.usageTimes,
                result?.data?.used_times,
                result?.data?.usedTimes,
                result?.data?.used_count,
                result?.data?.usedCount
            ];
            const totalCandidates = [
                result?.max_usage_times,
                result?.maxUsageTimes,
                result?.total_times,
                result?.totalTimes,
                result?.limit_times,
                result?.limitTimes,
                result?.times,
                result?.count,
                result?.content?.max_usage_times,
                result?.content?.maxUsageTimes,
                result?.content?.total_times,
                result?.content?.totalTimes,
                result?.content?.limit_times,
                result?.content?.limitTimes,
                result?.content?.times,
                result?.content?.count,
                result?.data?.max_usage_times,
                result?.data?.maxUsageTimes,
                result?.data?.total_times,
                result?.data?.totalTimes,
                result?.data?.limit_times,
                result?.data?.limitTimes,
                result?.data?.times,
                result?.data?.count
            ];

            const remainingText = remainingCandidates.map(normalizeUsageText).find(Boolean);
            const usedText = usedCandidates.map(normalizeUsageText).find(Boolean);
            const totalText = totalCandidates.map(normalizeUsageText).find(Boolean);

            if (remainingText && totalText) {
                return '剩余 ' + remainingText + ' / ' + totalText;
            }
            if (remainingText) {
                return '剩余 ' + remainingText;
            }
            if (usedText && totalText) {
                return '已用 ' + usedText + ' / ' + totalText;
            }
            if (usedText) {
                return '已用 ' + usedText;
            }
            if (totalText) {
                return '总次数 ' + totalText;
            }
            return '未识别到次数字段';
        }

        function renderValidationInfo(result) {
            if (!elements.validationInfo) {
                return;
            }

            const escapeHtml = (value) => String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
            const summaryRows = [
                ['有效期', extractLicenseExpiryText(result) || '未提供'],
                ['次数信息', extractLicenseUsageText(result)],
                ['验证状态', '成功']
            ];
            const rawResult = JSON.stringify(result, null, 2);

            const summaryHtml = summaryRows.map(([label, value]) => {
                return '<div class="validation-info__row">'
                    + '<div class="validation-info__label">' + escapeHtml(label) + '</div>'
                    + '<div class="validation-info__value">' + escapeHtml(value) + '</div>'
                    + '</div>';
            }).join('');

            elements.validationInfo.innerHTML = [
                '<div class="validation-info__title">验证卡密信息</div>',
                '<div class="validation-info__grid">',
                summaryHtml,
                '</div>',
                '<details open>',
                '<summary>查看原始响应</summary>',
                '<pre>' + escapeHtml(rawResult) + '</pre>',
                '</details>'
            ].join('');
            elements.validationInfo.classList.add('show');
        }

        function hideValidationInfo() {
            if (!elements.validationInfo) {
                return;
            }

            elements.validationInfo.classList.remove('show');
            elements.validationInfo.innerHTML = '';
        }
    </script>
</body>
</html>`;
    }

    async stop() {
        if (!this.server) {
            return;
        }

        this.uiChannelManager.closeAllWebClients();

        for (const socket of this.sockets) {
            try {
                socket.destroy();
            } catch (_error) {
                // Ignore socket teardown errors while shutting down.
            }
        }

        const server = this.server;
        this.server = null;

        await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 3000);
            try {
                server.close(() => {
                    clearTimeout(timeout);
                    resolve();
                });
            } catch (_error) {
                clearTimeout(timeout);
                resolve();
            }
        });

        this.sockets.clear();
    }
}

module.exports = WebControlServer;

