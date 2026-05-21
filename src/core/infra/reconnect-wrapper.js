const net = require('net');
const EventEmitter = require('events');

class ReconnectWrapper extends EventEmitter {
    constructor({ host = 'localhost', port = 0, initialDelay = 1000, maxDelay = 30000, maxAttempts = 0, timeout = 10000, jitterFactor = 0.2 } = {}) {
        super();
        this.host = host;
        this.port = port;
        this.initialDelay = initialDelay;
        this.maxDelay = maxDelay;
        this.maxAttempts = maxAttempts; // 0 => 无限次
        this.timeout = timeout;
        this.jitterFactor = jitterFactor;

        this.socket = null;
        this.connected = false;
        this._closedByUser = false;
        this._disconnectEmitted = false; // 防止 disconnected 事件重复触发

        this.attempt = 0;
        this.reconnectTimer = null;
        this.nextRetryAt = null;

        // 发送队列（{message,resolve,reject}）
        this._sendQueue = [];
    }

    async connect() {
        return new Promise((resolve, reject) => {
            try {
                this._closedByUser = false;
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }

                this.socket = new net.Socket();
                this.socket.setTimeout(this.timeout);

                let settled = false;

                const onConnect = () => {
                    this.connected = true;
                    this.attempt = 0;
                    this._disconnectEmitted = false; // 重置断开标志
                    this.emit('connected');
                    this._flushQueue();
                    if (!settled) {
                        settled = true;
                        resolve(true);
                    }
                };

                const onError = (err) => {
                    this.emit('error', err);
                    this.connected = false;
                    if (!settled) {
                        settled = true;
                        reject(err);
                    }
                    if (!this._closedByUser) this._scheduleReconnect();
                };

                const onClose = () => {
                    if (this._disconnectEmitted) return; // 防止重复触发
                    this._disconnectEmitted = true;
                    this.connected = false;
                    this.emit('disconnected');
                    if (!this._closedByUser) this._scheduleReconnect();
                };

                this.socket.on('connect', onConnect);
                this.socket.on('error', onError);
                this.socket.on('close', onClose);
                this.socket.on('end', onClose);

                this.socket.on('data', (data) => {
                    this.emit('data', data);
                });

                this.socket.connect(this.port, this.host);
            } catch (err) {
                this.emit('error', err);
                if (!this._closedByUser) this._scheduleReconnect();
                reject(err);
            }
        });
    }

    send(message) {
        return new Promise((resolve, reject) => {
            if (!this.socket || !this.connected) {
                this._sendQueue.push({ message, resolve, reject });
                return;
            }
            try {
                // 添加换行符作为消息分隔符，与服务端协议对齐
                const messageStr = JSON.stringify(message) + '\n';
                this.socket.write(messageStr, 'utf8', (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    _flushQueue() {
        if (!this.socket || !this.connected) return;
        while (this._sendQueue.length) {
            const item = this._sendQueue.shift();
            try {
                // 添加换行符作为消息分隔符
                const messageStr = JSON.stringify(item.message) + '\n';
                this.socket.write(messageStr, 'utf8', (err) => {
                    if (err) {
                        try { item.reject(err); } catch (e) {}
                    } else {
                        try { item.resolve(); } catch (e) {}
                    }
                });
            } catch (e) {
                try { item.reject(e); } catch (e2) {}
            }
        }
    }

    _scheduleReconnect() {
        if (this._closedByUser) return;
        this.attempt += 1;
        if (this.maxAttempts > 0 && this.attempt > this.maxAttempts) {
            this.emit('reconnect_failed', { attempt: this.attempt });
            return;
        }
        const base = Math.min(this.initialDelay * Math.pow(2, this.attempt - 1), this.maxDelay);
        const jitter = Math.floor(Math.random() * base * this.jitterFactor);
        const delay = Math.floor(base + jitter);
        this.nextRetryAt = Date.now() + delay;
        this.emit('reconnect', { attempt: this.attempt, nextRetryAt: this.nextRetryAt });
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect().catch(() => { /* connect will re-schedule if needed */ });
        }, delay);
    }

    disconnect() {
        this._closedByUser = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.socket) {
            try { this.socket.destroy(); } catch (e) {}
            this.socket = null;
        }
        // reject queued sends
        while (this._sendQueue.length) {
            const it = this._sendQueue.shift();
            try { it.reject(new Error('Disconnected')); } catch (e) {}
        }
        this.connected = false;
        this.emit('disconnected');
    }

    getStatus() {
        return {
            connected: this.connected,
            host: this.host,
            port: this.port,
            attempt: this.attempt,
            nextRetryAt: this.nextRetryAt
        };
    }
}

module.exports = ReconnectWrapper;


