const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');

class Logger {
    constructor(options = {}) {
        this.consoleOutput = options.console_output || true;
        this.consoleColorEnabled = this._detectConsoleColorSupport(options.consoleColorEnabled);
        this.logFile = options.log_file || this._getLogFilePath();
        this.level = options.level || 'INFO';
        this.mainWindow = options.mainWindow || null; // 主窗口引用，用于IPC通信
        this.logBuffer = [];
        this.maxBufferLines = Number.isFinite(Number(options.maxBufferLines))
            ? Math.max(100, Number(options.maxBufferLines))
            : 1000;
        this.levels = {
            'DEBUG': 0,
            'INFO': 1,
            'WARNING': 2,
            'ERROR': 3,
            'CRITICAL': 4
        };

        // 确保日志目录存在
        fs.ensureDirSync(path.dirname(this.logFile));
    }

    _detectConsoleColorSupport(forcedValue) {
        if (typeof forcedValue === 'boolean') {
            return forcedValue;
        }

        const noColor = String(process.env.NO_COLOR || '').trim().toLowerCase();
        const forceColor = String(process.env.FORCE_COLOR || '').trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(noColor)) {
            return false;
        }
        if (['0', 'false', 'no', 'off'].includes(forceColor)) {
            return false;
        }

        if (process.stdout && typeof process.stdout.isTTY === 'boolean') {
            return process.stdout.isTTY;
        }

        return true;
    }

    _getLogFilePath() {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
        const candidates = [];

        try {
            if (app && typeof app.getPath === 'function') {
                candidates.push(path.join(app.getPath('userData'), 'logs'));
            }
        } catch (_) {}

        candidates.push(path.join(__dirname, '../../../logs'));
        candidates.push(path.join(process.cwd(), 'logs'));

        for (const logDir of candidates) {
            try {
                fs.ensureDirSync(logDir);
                return path.join(logDir, `autoregister_${dateStr}.log`);
            } catch (_) {}
        }

        return path.join(process.cwd(), `autoregister_${dateStr}.log`);
    }

    _formatMessage(level, message) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level}] ${message}`;
    }

    _writeToFile(message) {
        try {
            fs.appendFileSync(this.logFile, message + '\n');
        } catch (error) {
            console.error('写入日志文件失败:', error);
        }
    }

    _shouldLog(level) {
        return this.levels[level] >= this.levels[this.level];
    }

    _sendToRenderer(level, message) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            try {
                this.mainWindow.webContents.send('main-log', { level, message });
            } catch (error) {
                // 静默处理错误，避免递归日志
                console.error('发送日志到渲染进程失败:', error.message);
            }
        }
    }

    _pushToBuffer(level, message, formatted) {
        this.logBuffer.push({
            timestamp: new Date().toISOString(),
            level,
            message: String(message),
            formatted: formatted || String(message)
        });

        if (this.logBuffer.length > this.maxBufferLines) {
            this.logBuffer = this.logBuffer.slice(-this.maxBufferLines);
        }
    }

    getRecentLogs(limit = 200) {
        const safeLimit = Number.isFinite(Number(limit))
            ? Math.max(1, Math.min(this.maxBufferLines, Number(limit)))
            : 200;
        return this.logBuffer.slice(-safeLimit);
    }

    clearRecentLogs() {
        this.logBuffer = [];
    }

    _writeConsole(method, formatted, colorCode) {
        if (!this.consoleOutput) {
            return;
        }

        if (this.consoleColorEnabled && colorCode) {
            console[method](`\x1b[${colorCode}m${formatted}\x1b[0m`);
            return;
        }

        console[method](formatted);
    }

    debug(message) {
        if (this._shouldLog('DEBUG')) {
            const formatted = this._formatMessage('DEBUG', message);
            this._writeToFile(formatted);
            this._writeConsole('log', formatted, '36');
            this._pushToBuffer('DEBUG', message, formatted);
            this._sendToRenderer('DEBUG', message);
        }
    }

    info(message) {
        if (this._shouldLog('INFO')) {
            const formatted = this._formatMessage('INFO', message);
            this._writeToFile(formatted);
            this._writeConsole('log', formatted, '32');
            this._pushToBuffer('INFO', message, formatted);
            this._sendToRenderer('INFO', message);
        }
    }

    warning(message) {
        if (this._shouldLog('WARNING')) {
            const formatted = this._formatMessage('WARNING', message);
            this._writeToFile(formatted);
            this._writeConsole('log', formatted, '33');
            this._pushToBuffer('WARNING', message, formatted);
            this._sendToRenderer('WARNING', message);
        }
    }

    warn(message) {
        this.warning(message);
    }

    error(message) {
        if (this._shouldLog('ERROR')) {
            const formatted = this._formatMessage('ERROR', message);
            this._writeToFile(formatted);
            this._writeConsole('error', formatted, '31');
            this._pushToBuffer('ERROR', message, formatted);
            this._sendToRenderer('ERROR', message);
        }
    }

    critical(message) {
        if (this._shouldLog('CRITICAL')) {
            const formatted = this._formatMessage('CRITICAL', message);
            this._writeToFile(formatted);
            this._writeConsole('error', formatted, '35');
            this._pushToBuffer('CRITICAL', message, formatted);
            this._sendToRenderer('CRITICAL', message);
        }
    }
}

module.exports = Logger;
