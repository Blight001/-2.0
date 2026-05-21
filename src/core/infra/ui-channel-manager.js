class UiChannelManager {
    constructor(options = {}) {
        this.maxLogEntries = Number.isFinite(Number(options.maxLogEntries))
            ? Math.max(10, Number(options.maxLogEntries))
            : 200;
        this.webClients = new Map();
        this.latestEvents = new Map();
        this.activeTasks = new Map();
        this.haikaBatchState = null;
        this.logEvents = [];
    }

    _cloneEvent(event) {
        if (!event || typeof event !== 'object') {
            return null;
        }

        return {
            ...event,
            args: Array.isArray(event.args) ? [...event.args] : []
        };
    }

    createHeadlessWindowProxy() {
        return {
            __webControlProxy: true,
            isDestroyed() {
                return false;
            },
            webContents: {
                send: (channel, ...args) => {
                    this.publish(channel, ...args);
                    return true;
                }
            }
        };
    }

    attachElectronWindow(window) {
        if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) {
            return;
        }

        const webContents = window.webContents;
        if (!webContents || typeof webContents.send !== 'function' || webContents.__uiChannelManagerPatched) {
            return;
        }

        const originalSend = webContents.send.bind(webContents);
        webContents.send = (channel, ...args) => {
            this.publish(channel, ...args);
            return originalSend(channel, ...args);
        };
        webContents.__uiChannelManagerPatched = true;
        webContents.__uiChannelManagerOriginalSend = originalSend;
    }

    publish(channel, ...args) {
        this._recordEvent(channel, args);
        this._broadcastToWebClients(channel, args);
    }

    addWebClient(response) {
        const clientId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        this.webClients.set(clientId, response);
        this._writeSseEvent(response, 'snapshot', {
            events: this.getSnapshotEvents()
        });
        return clientId;
    }

    removeWebClient(clientId) {
        const response = this.webClients.get(clientId);
        if (response && !response.writableEnded) {
            try {
                response.end();
            } catch (_error) {}
        }
        this.webClients.delete(clientId);
    }

    closeAllWebClients() {
        for (const clientId of [...this.webClients.keys()]) {
            this.removeWebClient(clientId);
        }
    }

    getSnapshotEvents() {
        const events = [];

        for (const logEvent of this.logEvents) {
            events.push(logEvent);
        }

        for (const channel of ['stats-updated', 'registration-cycle-status', 'email-connected', 'email-disconnected', 'email-reconnect', 'temp-email-log', 'temp-email-state', 'temp-email-selection']) {
            const event = this.latestEvents.get(channel);
            if (event) {
                events.push(event);
            }
        }

        if (this.haikaBatchState?.started) {
            events.push(this.haikaBatchState.started);
        }
        if (this.haikaBatchState?.progress) {
            events.push(this.haikaBatchState.progress);
        }

        for (const state of this.activeTasks.values()) {
            if (state.started) {
                events.push(state.started);
            }
            if (state.browserCreated) {
                events.push(state.browserCreated);
            }
            if (state.progress) {
                events.push(state.progress);
            }
        }

        return events;
    }

    getStateSnapshot() {
        const latestEvents = {};
        for (const [channel, event] of this.latestEvents.entries()) {
            latestEvents[channel] = this._cloneEvent(event);
        }

        const activeTasks = {};
        for (const [taskId, state] of this.activeTasks.entries()) {
            activeTasks[taskId] = {
                started: this._cloneEvent(state?.started || null),
                browserCreated: this._cloneEvent(state?.browserCreated || null),
                progress: this._cloneEvent(state?.progress || null)
            };
        }

        return {
            maxLogEntries: this.maxLogEntries,
            logEvents: this.logEvents.map((event) => this._cloneEvent(event)).filter(Boolean),
            latestEvents,
            activeTasks,
            haikaBatchState: this.haikaBatchState
                ? {
                    started: this._cloneEvent(this.haikaBatchState.started || null),
                    progress: this._cloneEvent(this.haikaBatchState.progress || null)
                }
                : null,
            snapshotEvents: this.getSnapshotEvents()
        };
    }

    _broadcastToWebClients(channel, args) {
        if (this.webClients.size === 0) {
            return;
        }

        const payload = {
            channel,
            args
        };

        for (const [clientId, response] of this.webClients) {
            if (!response || response.writableEnded || response.destroyed) {
                this.webClients.delete(clientId);
                continue;
            }

            this._writeSseEvent(response, 'ipc', payload);
        }
    }

    _writeSseEvent(response, eventName, payload) {
        try {
            response.write(`event: ${eventName}\n`);
            response.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch (_error) {
        }
    }

    _recordEvent(channel, args = []) {
        const event = {
            channel,
            args
        };
        const payload = Array.isArray(args) ? args[0] : undefined;

        if (channel === 'main-log') {
            this.logEvents.push(event);
            if (this.logEvents.length > this.maxLogEntries) {
                this.logEvents = this.logEvents.slice(-this.maxLogEntries);
            }
            return;
        }

        if (channel === 'task-started' && payload?.taskId) {
            const state = this.activeTasks.get(payload.taskId) || {};
            state.started = event;
            this.activeTasks.set(payload.taskId, state);
            return;
        }

        if (channel === 'task-progress' && payload?.taskId) {
            const state = this.activeTasks.get(payload.taskId) || {};
            if (!state.started) {
                state.started = {
                    channel: 'task-started',
                    args: [{
                        taskId: payload.taskId,
                        taskNumber: payload.taskNumber || '',
                        taskLabel: payload.taskLabel || payload.taskType || '任务'
                    }]
                };
            }
            state.progress = event;
            this.activeTasks.set(payload.taskId, state);
            return;
        }

        if (channel === 'browser-created' && payload?.taskId) {
            const state = this.activeTasks.get(payload.taskId) || {};
            state.browserCreated = event;
            this.activeTasks.set(payload.taskId, state);
            return;
        }

        if ((channel === 'task-finished' || channel === 'task-error') && payload?.taskId) {
            this.activeTasks.delete(payload.taskId);
            return;
        }

        if (channel === 'all-tasks-finished' || channel === 'all-tasks-stopped') {
            this.activeTasks.clear();
            this.latestEvents.set(channel, event);
            return;
        }

        if (channel === 'haika-binding-batch-started') {
            this.haikaBatchState = {
                started: event,
                progress: null
            };
            return;
        }

        if (channel === 'haika-binding-batch-progress') {
            this.haikaBatchState = this.haikaBatchState || {
                started: null,
                progress: null
            };
            this.haikaBatchState.progress = event;
            return;
        }

        if (channel === 'haika-binding-batch-finished') {
            this.haikaBatchState = null;
            return;
        }

        if (['stats-updated', 'registration-cycle-status', 'email-connected', 'email-disconnected', 'email-reconnect', 'temp-email-log', 'temp-email-state', 'temp-email-selection'].includes(channel)) {
            this.latestEvents.set(channel, event);
        }
    }
}

module.exports = UiChannelManager;
