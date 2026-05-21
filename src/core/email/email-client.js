const net = require('net');
const EventEmitter = require('events');
const ReconnectWrapper = require('../infra/reconnect-wrapper');
const { DEFAULT_EMAIL_HOST, DEFAULT_EMAIL_PORT } = require('./email-defaults');

/**
 * 邮箱验证客户端
 * 用于连接到本地Python邮箱服务，发送验证码等待请求并接收验证码
 * 已简化：移除复杂的事件广播和服务器端等待逻辑，改为客户端轮询
 */
class EmailVerificationClient extends EventEmitter {
    constructor(serverHost = DEFAULT_EMAIL_HOST, serverPort = DEFAULT_EMAIL_PORT) {
        super();
        this.setMaxListeners(0); // 允许无限监听器，防止多并发警告

        this.serverHost = serverHost;
        this.serverPort = serverPort;
        this.socket = null;
        this.connected = false;
        this.running = false;

        // 请求管理
        this.requestCounter = 0;
        this.pendingRequests = new Map(); // requestId -> {resolve, reject, timer}
        this.activeVerificationWaits = new Map(); // emailKey -> { email, timeout, deadline, lastRegisteredGeneration }

        this.logger = this._normalizeLogger(console);

        // 重连包装器实例
        this.reconnector = null;
        this._closedByUser = false;
        
        // 心跳控制
        this.heartbeatTimer = null;
        this.heartbeatInterval = 30000; // 30秒心跳
        this.pingFailCount = 0;
        this.connectionGeneration = 0;
        
        // 接收缓冲区
        this.receiveBuffer = '';
    }

    _normalizeLogger(logger) {
        const fallback = console;
        const source = logger || fallback;

        return {
            debug: typeof source.debug === 'function' ? source.debug.bind(source) : fallback.debug.bind(fallback),
            info: typeof source.info === 'function' ? source.info.bind(source) : fallback.info.bind(fallback),
            warning: typeof source.warning === 'function'
                ? source.warning.bind(source)
                : typeof source.warn === 'function'
                    ? source.warn.bind(source)
                    : fallback.warn.bind(fallback),
            warn: typeof source.warn === 'function'
                ? source.warn.bind(source)
                : typeof source.warning === 'function'
                    ? source.warning.bind(source)
                    : fallback.warn.bind(fallback),
            error: typeof source.error === 'function' ? source.error.bind(source) : fallback.error.bind(fallback)
        };
    }

    /**
     * 连接到邮箱服务
     */
    connect() {
        this._closedByUser = false;
        
        // 避免重复连接
        if (this.connected && this.reconnector && this.reconnector.socket) {
            return Promise.resolve();
        }

        if (!this.reconnector) {
            this.reconnector = new ReconnectWrapper({
                host: this.serverHost,
                port: this.serverPort,
                initialDelay: 1000,
                maxDelay: 30000,
                maxAttempts: 0, // 无限重试
                timeout: 10000,
                jitterFactor: 0.2
            });

            this._setupReconnectorEvents();
        } else {
            this.reconnector.host = this.serverHost;
            this.reconnector.port = this.serverPort;
        }

        return this.reconnector.connect();
    }

    /**
     * 设置重连器事件监听
     */
    _setupReconnectorEvents() {
        this.reconnector.on('connected', () => {
            this.socket = this.reconnector.socket;
            this.connected = true;
            this.running = true;
            this.pingFailCount = 0;
            this.connectionGeneration += 1;
            this.logger.info(`✅ 邮箱客户端已连接到 ${this.serverHost}:${this.serverPort}`);
            this.startHeartbeat();
            try { this.emit('connected'); } catch (e) {}
            this._resendActiveVerificationWaits().catch((err) => {
                this.logger.warning(`重发等待验证码目标失败: ${err.message}`);
            });
        });

        this.reconnector.on('error', (error) => {
            if (this._closedByUser) {
                return;
            }

            const errorText = error && error.message ? error.message : String(error || '未知错误');
            const errorCode = error && (error.code || error.errno);
            const isTransientNetworkError = errorCode === 'ECONNRESET' ||
                /ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED/i.test(errorText);

            if (isTransientNetworkError) {
                this.logger.warning(`邮箱连接异常，正在自动恢复: ${errorText}`);
            } else {
                this.logger.warning(`邮箱连接错误，正在自动恢复: ${errorText}`);
            }
        });

        this.reconnector.on('disconnected', () => {
            if (this._closedByUser) {
                this.connected = false;
                this.running = false;
                this.receiveBuffer = '';
                this.stopHeartbeat();
                this._clearPendingRequests('客户端已手动断开连接');
                this.activeVerificationWaits.clear();
                return;
            }

            if (this.connected) {
                this.logger.warning(`⚠️ 邮箱服务器断开连接: ${this.serverHost}:${this.serverPort}`);
            }
            this.connected = false;
            this.running = false;
            this.receiveBuffer = '';
            this.stopHeartbeat();
            this._clearPendingRequests('邮箱连接已断开');
            try { this.emit('disconnected'); } catch (e) {}
        });

        this.reconnector.on('reconnect', (info) => {
            this.logger.info(`🔄 尝试重连邮箱服务器... (第 ${info.attempt} 次)`);
            try { this.emit('reconnect', info); } catch (e) {}
        });

        this.reconnector.on('data', (data) => {
            this._processData(data);
        });
    }

    /**
     * 断开连接
     */
    disconnect() {
        this._closedByUser = true;
        this.stopHeartbeat();

        if (this.reconnector) {
            try { this.reconnector.disconnect(); } catch (e) {}
            this.reconnector = null;
        }

        this.running = false;
        this.connected = false;
        if (this.socket) {
            try { this.socket.destroy(); } catch (e) {}
            this.socket = null;
        }
        
        // 清理所有等待的请求与验证码等待目标
        this._clearPendingRequests('客户端已断开连接');
        this.activeVerificationWaits.clear();
        this.logger.info('邮箱客户端已断开连接并清理资源');
    }

    /**
     * 启动心跳
     */
    startHeartbeat() {
        this.stopHeartbeat();
        this.pingFailCount = 0;
        this.heartbeatTimer = setInterval(async () => {
            if (this.connected) {
                try {
                    const pong = await this.ping();
                    if (pong) {
                        this.pingFailCount = 0;
                    } else {
                        this.pingFailCount++;
                        if (this.pingFailCount >= 3) {
                            this.logger.warning(`❌ 邮箱服务器心跳超时 (${this.pingFailCount} 次)，触发自动重连`);
                            if (this.reconnector && this.reconnector.socket) {
                                try { this.reconnector.socket.destroy(); } catch (e) {}
                            } else if (this.reconnector) {
                                this.connect().catch(() => {});
                            }
                        }
                    }
                } catch (e) {
                    // ping 方法内部已捕获错误返回 false，这里理论上不会触发
                    this.pingFailCount++;
                }
            }
        }, this.heartbeatInterval);
    }

    /**
     * 停止心跳
     */
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /**
     * 发送请求并等待响应 (Promise based)
     * @param {Object} requestData 请求数据
     * @param {number} timeout 超时时间(毫秒)
     * @returns {Promise<Object>} 响应数据
     */
    async sendRequest(requestData, timeout = 10000) {
        if (!this.connected) {
            throw new Error('邮箱客户端未连接');
        }

        const requestId = ++this.requestCounter;
        requestData._request_id = requestId;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error(`请求超时 (${requestData.action})`));
                }
            }, timeout);

            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                timer
            });

            this._sendMessage(requestData).catch(err => {
                clearTimeout(timer);
                this.pendingRequests.delete(requestId);
                reject(err);
            });
        });
    }

    /**
     * 检查服务器健康状态 (Ping)
     */
    async ping() {
        try {
            const response = await this.sendRequest({ action: 'ping' }, 5000);
            if (response && response.status === 'pong') {
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    /**
     * 获取验证码 (立即返回)
     * @param {string} email 邮箱地址
     * @param {boolean} consume 是否消费(删除)验证码，默认true
     * @returns {Promise<string|null>} 验证码或null
     */
    async getVerificationCode(email, consume = true) {
        try {
            const response = await this.sendRequest({
                action: 'get_verification_code',
                email: email,
                consume: consume
            }, 5000);

            if (response && response.status === 'success' && response.code) {
                this.logger.info(`✅ 获取到验证码: ${email} -> ${response.code} (consume=${consume})`);
                return response.code;
            }
        } catch (e) {
            // this.logger.warning(`查询验证码失败: ${e.message}`);
        }
        return null;
    }

    /**
     * 删除验证码 (通过消费方式)
     * @param {string} email 邮箱地址
     */
    async deleteVerificationCode(email) {
        this.logger.info(`🗑️ 删除验证码记录: ${email}`);
        return this.getVerificationCode(email, true);
    }

    /**
     * 等待指定邮箱的验证码 (客户端轮询模式)
     * @param {string} email 邮箱地址
     * @param {number} timeout 超时时间(秒)
     * @param {Function} checkCancel 取消检查回调，返回true则取消等待
     * @returns {Promise<string>} 验证码
     */
    async waitForVerificationCode(email, timeout = 300, checkCancel = null) {
        // if (!this.connected) {
        //     throw new Error('邮箱客户端未连接，请先连接到邮箱服务器');
        // }

        const emailKey = email.toLowerCase().trim();
        const waitState = {
            email,
            timeout,
            deadline: Date.now() + timeout * 1000,
            lastRegisteredGeneration: -1
        };
        this.activeVerificationWaits.set(emailKey, waitState);
        this.logger.info(`开始轮询获取验证码: ${email} (超时: ${timeout}s)`);

        const startTime = Date.now();
        const endTime = waitState.deadline;

        try {
            if (this.connected) {
                await this._registerWaitingEmail(waitState, true);
            }

            while (Date.now() < endTime) {
                // 检查是否取消
                if (checkCancel && checkCancel()) {
                    this.logger.info(`停止轮询验证码 (任务已取消): ${email}`);
                    throw new Error('获取验证码已取消');
                }

                // 如果连接断开，等待重连，而不是直接报错
                if (!this.connected) {
                    this.logger.debug('等待过程中连接断开，等待重连...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }

                try {
                    await this._registerWaitingEmail(waitState);
                    // 使用 consume=false 进行窥视，不删除验证码，以便后续"填写后删除"流程
                    const code = await this.getVerificationCode(email, false);
                    if (code) {
                        this.logger.info(`✅ [轮询成功] 获取到验证码: ${email} -> ${code}`);
                        return code;
                    }
                } catch (error) {
                    // 忽略单次请求错误，可能是网络波动
                    this.logger.debug(`轮询请求异常 (可忽略): ${error.message}`);
                }

                // 等待2秒后重试
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            throw new Error(`获取验证码失败或超时 (${timeout}秒)`);
        } finally {
            this.activeVerificationWaits.delete(emailKey);
        }
    }

    /**
     * 发送消息到服务器
     */
    async _sendMessage(message) {
        return new Promise((resolve, reject) => {
            if (this.reconnector) {
                this.reconnector.send(message).then(resolve).catch(reject);
                return;
            }

            if (!this.socket || !this.connected) {
                reject(new Error('连接未建立'));
                return;
            }

            const messageStr = JSON.stringify(message) + '\n';
            this.socket.write(messageStr, 'utf8', (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }

    /**
     * 处理接收到的原始数据
     */
    _processData(data) {
        if (!data) return;
        this.receiveBuffer += data.toString();

        // 提取并处理所有完整的JSON消息
        const messages = this._extractJsonMessages();
        
        for (const msg of messages) {
            this._handleMessage(msg);
        }
    }

    _normalizeEmailKey(email) {
        return String(email || '').toLowerCase().trim();
    }

    _clearPendingRequests(reason = '连接已断开') {
        for (const [requestId, req] of this.pendingRequests) {
            if (req && req.timer) {
                clearTimeout(req.timer);
            }
            if (req && req.reject) {
                try {
                    req.reject(new Error(reason));
                } catch (e) {}
            }
        }
        this.pendingRequests.clear();
    }

    async _registerWaitingEmail(waitState, force = false) {
        if (!waitState || !waitState.email) {
            return false;
        }

        if (!this.connected) {
            return false;
        }

        const remainingSeconds = Math.max(1, Math.ceil((waitState.deadline - Date.now()) / 1000));
        if (remainingSeconds <= 0) {
            return false;
        }

        if (!force && waitState.lastRegisteredGeneration === this.connectionGeneration) {
            return false;
        }

        const message = {
            action: 'wait_verification_code',
            email: waitState.email,
            timeout: remainingSeconds
        };

        try {
            await this._sendMessage(message);
            waitState.lastRegisteredGeneration = this.connectionGeneration;
            this.logger.info(`📨 已向邮箱服务登记等待验证码: ${waitState.email} (剩余 ${remainingSeconds}s)`);
            return true;
        } catch (error) {
            this.logger.warning(`登记等待验证码失败: ${waitState.email} - ${error.message}`);
            return false;
        }
    }

    async _resendActiveVerificationWaits() {
        if (!this.connected || this.activeVerificationWaits.size === 0) {
            return;
        }

        const tasks = [];
        for (const waitState of this.activeVerificationWaits.values()) {
            tasks.push(this._registerWaitingEmail(waitState, true));
        }

        await Promise.allSettled(tasks);
    }

    /**
     * 从缓冲区提取JSON消息
     * @returns {Array} 解析出的消息对象数组
     */
    _extractJsonMessages() {
        const messages = [];
        let startIndex = 0;
        let loopCount = 0;
        const maxLoop = 100;

        while (loopCount++ < maxLoop) {
            const jsonStart = this.receiveBuffer.indexOf('{', startIndex);
            if (jsonStart === -1) break;

            let braceCount = 0;
            let inString = false;
            let escapeNext = false;
            let jsonEnd = -1;

            for (let i = jsonStart; i < this.receiveBuffer.length; i++) {
                const char = this.receiveBuffer[i];
                if (escapeNext) { escapeNext = false; continue; }
                if (char === '\\') { escapeNext = true; continue; }
                if (char === '"' && !escapeNext) { inString = !inString; continue; }

                if (!inString) {
                    if (char === '{') braceCount++;
                    else if (char === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                            jsonEnd = i;
                            break;
                        }
                    }
                }
            }

            if (jsonEnd !== -1) {
                const jsonStr = this.receiveBuffer.substring(jsonStart, jsonEnd + 1);
                try {
                    const message = JSON.parse(jsonStr);
                    messages.push(message);
                    startIndex = jsonEnd + 1;
                } catch (e) {
                    startIndex = jsonStart + 1;
                }
            } else {
                break;
            }
        }

        if (startIndex > 0) {
            this.receiveBuffer = this.receiveBuffer.substring(startIndex);
        }

        return messages;
    }

    /**
     * 处理单个消息对象
     */
    _handleMessage(message) {
        try {
            // 触发 raw-message 事件，供外部监听并显示完整内容
            this.emit('raw-message', message);

            // 仅处理请求响应
            if (message._request_id !== undefined) {
                const requestId = message._request_id;
                if (this.pendingRequests.has(requestId)) {
                    const req = this.pendingRequests.get(requestId);
                    if (req.resolve) {
                        clearTimeout(req.timer);
                        req.resolve(message);
                    }
                    this.pendingRequests.delete(requestId);
                }
            }
        } catch (error) {
            this.logger.error(`处理消息出错: ${error.message}`);
        }
    }

    setLogger(logger) {
        this.logger = logger;
    }

    getConnectionStatus() {
        return {
            connected: this.connected,
            server: `${this.serverHost}:${this.serverPort}`
        };
    }
}

module.exports = EmailVerificationClient;
