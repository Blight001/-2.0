/**
 * 控制台管理器 - 统一管理所有控制台输出
 */
class ConsoleManager {
    constructor() {
        this.logBuffer = [];
        this.maxLines = 1000;
        this.autoScroll = true;
        this.currentLevel = 'INFO';
        this.levels = {
            'DEBUG': 0,
            'INFO': 1,
            'WARNING': 2,
            'WARN': 2,
            'ERROR': 3,
            'CRITICAL': 4
        };
        this.colors = {
            'DEBUG': '#74b9ff',
            'INFO': '#6bcf7f',
            'WARNING': '#ffd93d',
            'ERROR': '#ff6b6b',
            'CRITICAL': '#ff0000'
        };
    }

    /**
     * 设置控制台输出元素
     * @param {HTMLElement} consoleElement - 控制台容器元素
     */
    setConsoleElement(consoleElement) {
        this.consoleElement = consoleElement;
        this.setupConsoleElement();
    }

    /**
     * 设置控制台元素
     */
    setupConsoleElement() {
        if (!this.consoleElement) return;

        // 设置样式
        this.consoleElement.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 0;
            height: 100%;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 12px;
            line-height: 1.55;
            background: var(--surface-2);
            color: var(--text);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 12px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-wrap: break-word;
        `;
    }

    /**
     * 设置日志级别
     * @param {string} level - 日志级别
     */
    setLevel(level) {
        if (this.levels.hasOwnProperty(level)) {
            this.currentLevel = level;
        }
    }

    /**
     * 设置是否自动滚动
     * @param {boolean} autoScroll - 是否自动滚动
     */
    setAutoScroll(autoScroll) {
        this.autoScroll = autoScroll;
    }

    /**
     * 设置最大行数
     * @param {number} maxLines - 最大行数
     */
    setMaxLines(maxLines) {
        this.maxLines = maxLines;
        this.trimBuffer();
    }

    /**
     * 记录调试信息
     * @param {string} message - 消息内容
     * @param {Object} data - 附加数据
     */
    debug(message, data = null) {
        this.log(message, 'DEBUG', data);
    }

    /**
     * 记录信息
     * @param {string} message - 消息内容
     * @param {Object} data - 附加数据
     */
    info(message, data = null) {
        this.log(message, 'INFO', data);
    }

    /**
     * 记录警告
     * @param {string} message - 消息内容
     * @param {Object} data - 附加数据
     */
    warning(message, data = null) {
        this.log(message, 'WARNING', data);
    }

    /**
     * 记录警告（warn的别名）
     * @param {string} message - 消息内容
     * @param {Object} data - 附加数据
     */
    warn(message, data = null) {
        this.warning(message, data);
    }

    /**
     * 记录错误
     * @param {string} message - 消息内容
     * @param {Object} data - 附加数据
     */
    error(message, data = null) {
        this.log(message, 'ERROR', data);
    }

    /**
     * 记录严重错误
     * @param {string} message - 消息内容
     * @param {Object} data - 附加数据
     */
    critical(message, data = null) {
        this.log(message, 'CRITICAL', data);
    }

    /**
     * 记录日志
     * @param {string} message - 消息内容
     * @param {string} level - 日志级别
     * @param {Object} data - 附加数据
     */
    log(message, level = 'INFO', data = null) {
        // 检查级别过滤
        if (this.levels[level] < this.levels[this.currentLevel]) {
            return;
        }

        const timestamp = new Date().toLocaleTimeString();
        const logEntry = {
            timestamp,
            level,
            message: String(message),
            data,
            formatted: this.formatMessage(timestamp, level, message, data)
        };

        // 添加到缓冲区
        this.logBuffer.push(logEntry);
        this.trimBuffer();

        // 输出到控制台元素
        this.outputToConsole(logEntry);
    }

    /**
     * 格式化消息
     * @param {string} timestamp - 时间戳
     * @param {string} level - 日志级别
     * @param {string} message - 消息内容
     * @param {Object} data - 附加数据
     * @returns {string} 格式化后的消息
     */
    formatMessage(timestamp, level, message, data) {
        let formatted = `[${timestamp}] [${level}] ${message}`;

        if (data !== null) {
            try {
                if (typeof data === 'object') {
                    formatted += `\n${JSON.stringify(data, null, 2)}`;
                } else {
                    formatted += ` ${String(data)}`;
                }
            } catch (e) {
                formatted += ` ${String(data)}`;
            }
        }

        return formatted;
    }

    /**
     * 输出到控制台元素
     * @param {Object} logEntry - 日志条目
     */
    outputToConsole(logEntry) {
        if (!this.consoleElement) return;

        // 创建日志卡片
        const logLine = document.createElement('div');
        logLine.className = `console-line console-line--${String(logEntry.level || 'INFO').toLowerCase()}`;
        logLine.dataset.level = logEntry.level;

        const header = document.createElement('div');
        header.className = 'console-line__header';

        const meta = document.createElement('div');
        meta.className = 'console-line__meta';
        meta.textContent = `${logEntry.timestamp} ${logEntry.level}`;

        const badge = document.createElement('span');
        badge.className = 'console-line__badge';
        badge.textContent = String(logEntry.level || 'INFO').toUpperCase();

        header.appendChild(meta);
        header.appendChild(badge);

        const body = document.createElement('div');
        body.className = 'console-line__body';
        body.textContent = logEntry.message;

        logLine.appendChild(header);
        logLine.appendChild(body);

        if (logEntry.data !== null && logEntry.data !== undefined && logEntry.data !== '') {
            const detail = document.createElement('pre');
            detail.className = 'console-line__detail';
            if (typeof logEntry.data === 'object') {
                try {
                    detail.textContent = JSON.stringify(logEntry.data, null, 2);
                } catch (_) {
                    detail.textContent = String(logEntry.data);
                }
            } else {
                detail.textContent = String(logEntry.data);
            }
            logLine.appendChild(detail);
        }

        // 添加到控制台
        this.consoleElement.appendChild(logLine);

        // 自动滚动
        if (this.autoScroll) {
            this.consoleElement.scrollTop = this.consoleElement.scrollHeight;
        }

        // 限制DOM元素数量以提高性能
        this.trimConsoleElements();
    }

    /**
     * 输出到浏览器控制台
     * @param {Object} logEntry - 日志条目
     */
    outputToBrowserConsole(logEntry) {
        const method = {
            'DEBUG': 'debug',
            'INFO': 'info',
            'WARNING': 'warn',
            'ERROR': 'error',
            'CRITICAL': 'error'
        }[logEntry.level] || 'log';

        console[method](logEntry.formatted, logEntry.data || '');
    }

    /**
     * 修剪缓冲区
     */
    trimBuffer() {
        if (this.logBuffer.length > this.maxLines) {
            this.logBuffer = this.logBuffer.slice(-this.maxLines);
        }
    }

    /**
     * 修剪控制台元素
     */
    trimConsoleElements() {
        if (!this.consoleElement) return;

        const lines = this.consoleElement.querySelectorAll('.console-line');
        if (lines.length > this.maxLines) {
            const excess = lines.length - this.maxLines;
            for (let i = 0; i < excess; i++) {
                lines[i].remove();
            }
        }
    }

    /**
     * 清空控制台
     */
    clear() {
        this.logBuffer = [];
        if (this.consoleElement) {
            this.consoleElement.innerHTML = '';
        }
    }

    /**
     * 获取日志内容
     * @returns {string} 日志内容
     */
    getLogContent() {
        return this.logBuffer.map(entry => entry.formatted).join('\n');
    }

    /**
     * 保存日志到文件
     * @param {string} filename - 文件名
     * @returns {boolean} 是否成功
     */
    saveLog(filename) {
        try {
            const content = this.getLogContent();
            // 在Electron中，这需要通过主进程来处理
            // 这里只是准备数据，主进程会处理实际的文件写入
            const { ipcRenderer } = require('electron');
            ipcRenderer.invoke('save-log', { filename, content });
            return true;
        } catch (error) {
            this.error(`保存日志失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 获取统计信息
     * @returns {Object} 统计信息
     */
    getStats() {
        const stats = {
            total: this.logBuffer.length,
            debug: 0,
            info: 0,
            warning: 0,
            error: 0,
            critical: 0
        };

        this.logBuffer.forEach(entry => {
            const level = entry.level.toLowerCase();
            if (stats.hasOwnProperty(level)) {
                stats[level]++;
            }
        });

        return stats;
    }

    /**
     * 过滤日志
     * @param {string} filter - 过滤条件
     * @returns {Array} 过滤后的日志
     */
    filterLogs(filter) {
        if (!filter) return this.logBuffer;

        const lowerFilter = filter.toLowerCase();
        return this.logBuffer.filter(entry =>
            entry.message.toLowerCase().includes(lowerFilter) ||
            entry.level.toLowerCase().includes(lowerFilter)
        );
    }

    /**
     * 导出日志
     * @param {string} format - 导出格式 ('text', 'json')
     * @returns {string} 导出的内容
     */
    exportLogs(format = 'text') {
        if (format === 'json') {
            return JSON.stringify(this.logBuffer, null, 2);
        } else {
            return this.getLogContent();
        }
    }
}

// 创建全局控制台管理器实例
const consoleManager = new ConsoleManager();

// 便捷函数
const logger = {
    debug: (message, data) => consoleManager.debug(message, data),
    info: (message, data) => consoleManager.info(message, data),
    warning: (message, data) => consoleManager.warning(message, data),
    warn: (message, data) => consoleManager.warn(message, data),
    error: (message, data) => consoleManager.error(message, data),
    critical: (message, data) => consoleManager.critical(message, data),
    log: (message, level, data) => consoleManager.log(message, level, data),
    setLevel: (level) => consoleManager.setLevel(level),
    setAutoScroll: (autoScroll) => consoleManager.setAutoScroll(autoScroll),
    clear: () => consoleManager.clear(),
    save: (filename) => consoleManager.saveLog(filename),
    getStats: () => consoleManager.getStats(),
    filter: (filter) => consoleManager.filterLogs(filter),
    export: (format) => consoleManager.exportLogs(format)
};

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ConsoleManager, consoleManager, logger };
} else {
    window.ConsoleManager = ConsoleManager;
    window.consoleManager = consoleManager;
    window.logger = logger;
}
