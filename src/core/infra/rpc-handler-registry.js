class RpcHandlerRegistry {
    constructor() {
        this.handlers = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(String(channel), handler);
    }

    removeHandler(channel) {
        this.handlers.delete(String(channel));
    }

    has(channel) {
        return this.handlers.has(String(channel));
    }

    async invoke(channel, ...args) {
        const resolvedChannel = String(channel);
        const handler = this.handlers.get(resolvedChannel);
        if (typeof handler !== 'function') {
            throw new Error(`未注册调用通道: ${resolvedChannel}`);
        }

        return await handler(null, ...args);
    }
}

module.exports = RpcHandlerRegistry;
