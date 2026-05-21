const { BrowserMcp } = require('../../browser/browser-mcp');

const BROWSER_MCP_CAPABILITY_SUMMARY = '浏览器页面快照、元素定位、点击、输入、选择、滚动、按键、在内置浏览器打开网址、切换标签、网页搜索、页面文本提取';
const BROWSER_MCP_PROMPT_HINTS = Object.freeze([
    '优先使用 mcpId 定位元素；如果能直接点击、输入、选择、滚动、打开网址、切换标签或搜索网页，就不要只给抽象建议。',
    '当用户给出网址、搜索结果或明确页面链接时，优先主动用 browser.open_url 在内置浏览器打开；需要最新资料时，优先用 browser.search_web 或 browser.open_url 打开搜索结果，再基于页面证据回答。',
    '如果证据不足，明确说明还缺哪类页面信息，而不是直接写“无法实现”。'
]);

const BROWSER_MCP_TOOL_DEFINITIONS = Object.freeze([
    {
        name: 'browser.capture_page_snapshot',
        description: 'Capture a browser page snapshot with structured element and layout data.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                browserId: { type: 'string' },
                maxElements: { type: 'number' },
                textLimit: { type: 'number' }
            }
        }
    },
    {
        name: 'browser.format_page_snapshot',
        description: 'Format a browser snapshot into human-readable text.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                snapshot: { type: 'object' }
            }
        }
    },
    {
        name: 'browser.get_page_info',
        description: 'Get the current browser page and open page list.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                browserId: { type: 'string' }
            },
            required: ['browserId']
        }
    },
    {
        name: 'browser.list_pages',
        description: 'List all open pages in the active browser context.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                browserId: { type: 'string' }
            },
            required: ['browserId']
        }
    },
    {
        name: 'browser.open_url',
        description: 'Open a web URL in the built-in browser current page or a new tab.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                browserId: { type: 'string' },
                url: { type: 'string' },
                newTab: { type: 'boolean' },
                waitUntil: { type: 'string' },
                timeout: { type: 'number' },
                settleMs: { type: 'number' }
            },
            required: ['browserId', 'url']
        }
    },
    {
        name: 'browser.search_web',
        description: 'Search the web for up-to-date information and optionally capture the result page.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                browserId: { type: 'string' },
                query: { type: 'string' },
                engine: { type: 'string' },
                searchUrl: { type: 'string' },
                newTab: { type: 'boolean' },
                captureSnapshot: { type: 'boolean' },
                maxElements: { type: 'number' },
                textLimit: { type: 'number' },
                waitUntil: { type: 'string' },
                timeout: { type: 'number' },
                settleMs: { type: 'number' }
            },
            required: ['browserId', 'query']
        }
    },
    {
        name: 'browser.switch_page',
        description: 'Switch the active browser page by index, title, or URL fragment.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                browserId: { type: 'string' },
                index: { type: 'number' },
                title: { type: 'string' },
                url: { type: 'string' },
                text: { type: 'string' },
                name: { type: 'string' },
                settleMs: { type: 'number' }
            },
            required: ['browserId']
        }
    },
    {
        name: 'browser.get_page_text',
        description: 'Extract visible text from the current page or a targeted element.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                browserId: { type: 'string' },
                selector: { type: 'string' },
                mcpId: { type: 'string' },
                role: { type: 'string' },
                name: { type: 'string' },
                label: { type: 'string' },
                placeholder: { type: 'string' },
                ariaLabel: { type: 'string' },
                text: { type: 'string' },
                maxLength: { type: 'number' },
                timeout: { type: 'number' }
            },
            required: ['browserId']
        }
    },
    {
        name: 'browser.format_page_snapshot_for_prompt',
        description: 'Format a browser snapshot into a compact prompt payload for AI use.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                snapshot: { type: 'object' },
                maxElements: { type: 'number' },
                maxVisibleTextSegments: { type: 'number' },
                maxVisibleTextLength: { type: 'number' }
            }
        }
    },
    {
        name: 'browser.describe_action',
        description: 'Describe a browser action in a readable summary.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                action: { type: 'object' }
            }
        }
    },
    {
        name: 'browser.execute_action',
        description: 'Execute a browser action against the active browser page.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                browserId: { type: 'string' },
                action: { type: 'object' }
            },
            required: ['browserId', 'action']
        }
    }
]);

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
    return String(value || '').trim();
}

class BrowserMcpTool {
    constructor({ app = null, browserManager = null, logger = console, browserMcp = null } = {}) {
        this.app = app || null;
        this.logger = logger || console;
        this.browserMcp = browserMcp || new BrowserMcp({
            browserManager: browserManager || app?.browserManager || null,
            logger: this.logger
        });

        if (this.app) {
            this.app.browserMcpTool = this;
        }
    }

    setBrowserManager(browserManager = null) {
        if (this.browserMcp && typeof this.browserMcp.setBrowserManager === 'function') {
            this.browserMcp.setBrowserManager(browserManager);
        }

        return this;
    }

    setLogger(logger = console) {
        this.logger = logger || console;
        if (this.browserMcp && typeof this.browserMcp.setLogger === 'function') {
            this.browserMcp.setLogger(this.logger);
        }

        return this;
    }

    getToolDefinitions() {
        return BROWSER_MCP_TOOL_DEFINITIONS.map((item) => ({ ...item }));
    }

    listTools() {
        return this.getToolDefinitions();
    }

    describeAction(action = {}) {
        return this.browserMcp.describeAction(action);
    }

    formatPageSnapshot(snapshot = {}) {
        return this.browserMcp.formatPageSnapshot(snapshot);
    }

    async getPageInfo(browserId) {
        return this.browserMcp.getPageInfo(browserId);
    }

    async listPages(browserId) {
        return this.browserMcp.listPages(browserId);
    }

    async openUrl(browserId, target = {}) {
        return this.browserMcp.openUrl(browserId, target);
    }

    async searchWeb(browserId, target = {}) {
        return this.browserMcp.searchWeb(browserId, target);
    }

    async switchPage(browserId, target = {}) {
        return this.browserMcp.switchPage(browserId, target);
    }

    async getPageText(browserId, target = {}) {
        return this.browserMcp.extractPageText(browserId, target);
    }

    formatPageSnapshotForPrompt(snapshot = {}, options = {}) {
        return this.browserMcp.formatPageSnapshotForPrompt(snapshot, options);
    }

    async capturePageSnapshot(browserId, options = {}) {
        return this.browserMcp.capturePageSnapshot(browserId, options);
    }

    async executeAction(browserId, action = {}) {
        return this.browserMcp.executeAction(browserId, action);
    }

    async callTool(toolName, args = {}) {
        const name = normalizeString(toolName);
        const payload = isPlainObject(args) ? args : {};

        switch (name) {
            case 'browser.capture_page_snapshot':
                if (!normalizeString(payload.browserId)) {
                    throw new Error('browserId 不能为空');
                }
                return {
                    success: true,
                    snapshot: await this.capturePageSnapshot(payload.browserId, {
                        maxElements: payload.maxElements,
                        textLimit: payload.textLimit
                    })
                };
            case 'browser.format_page_snapshot':
                return {
                    success: true,
                    text: this.formatPageSnapshot(payload.snapshot || {})
                };
            case 'browser.get_page_info':
                if (!normalizeString(payload.browserId)) {
                    throw new Error('browserId 不能为空');
                }
                return await this.getPageInfo(payload.browserId);
            case 'browser.list_pages':
                if (!normalizeString(payload.browserId)) {
                    throw new Error('browserId 不能为空');
                }
                return await this.listPages(payload.browserId);
            case 'browser.open_url':
                if (!normalizeString(payload.browserId)) {
                    throw new Error('browserId 不能为空');
                }
                if (!normalizeString(payload.url)) {
                    throw new Error('url 不能为空');
                }
                return await this.openUrl(payload.browserId, {
                    url: payload.url,
                    newTab: payload.newTab === true,
                    waitUntil: payload.waitUntil,
                    timeout: payload.timeout,
                    settleMs: payload.settleMs
                });
            case 'browser.search_web':
                if (!normalizeString(payload.browserId)) {
                    throw new Error('browserId 不能为空');
                }
                if (!normalizeString(payload.query)) {
                    throw new Error('query 不能为空');
                }
                return await this.searchWeb(payload.browserId, {
                    query: payload.query,
                    engine: payload.engine,
                    searchUrl: payload.searchUrl,
                    newTab: payload.newTab,
                    captureSnapshot: payload.captureSnapshot,
                    maxElements: payload.maxElements,
                    textLimit: payload.textLimit,
                    waitUntil: payload.waitUntil,
                    timeout: payload.timeout,
                    settleMs: payload.settleMs
                });
            case 'browser.switch_page':
                if (!normalizeString(payload.browserId)) {
                    throw new Error('browserId 不能为空');
                }
                return await this.switchPage(payload.browserId, {
                    index: payload.index,
                    title: payload.title,
                    url: payload.url,
                    text: payload.text,
                    name: payload.name,
                    settleMs: payload.settleMs
                });
            case 'browser.get_page_text':
                if (!normalizeString(payload.browserId)) {
                    throw new Error('browserId 不能为空');
                }
                return await this.getPageText(payload.browserId, {
                    selector: payload.selector,
                    mcpId: payload.mcpId,
                    role: payload.role,
                    name: payload.name,
                    label: payload.label,
                    placeholder: payload.placeholder,
                    ariaLabel: payload.ariaLabel,
                    text: payload.text,
                    maxLength: payload.maxLength,
                    timeout: payload.timeout
                });
            case 'browser.format_page_snapshot_for_prompt':
                return {
                    success: true,
                    text: this.formatPageSnapshotForPrompt(payload.snapshot || {}, {
                        maxElements: payload.maxElements,
                        maxVisibleTextSegments: payload.maxVisibleTextSegments,
                        maxVisibleTextLength: payload.maxVisibleTextLength
                    })
                };
            case 'browser.describe_action':
                return {
                    success: true,
                    description: this.describeAction(payload.action || {})
                };
            case 'browser.execute_action':
                if (!normalizeString(payload.browserId)) {
                    throw new Error('browserId 不能为空');
                }
                if (!payload.action || typeof payload.action !== 'object') {
                    throw new Error('action 不能为空');
                }
                return {
                    success: true,
                    result: await this.executeAction(payload.browserId, payload.action)
                };
            default:
                throw new Error(`不支持的浏览器 MCP 工具: ${name || 'unknown'}`);
        }
    }
}

function getBrowserMcpTool(app, options = {}) {
    if (!app) {
        return new BrowserMcpTool(options);
    }

    if (app.browserMcpTool instanceof BrowserMcpTool) {
        if (options.browserManager || options.logger || options.browserMcp) {
            if (options.browserMcp) {
                app.browserMcpTool.browserMcp = options.browserMcp;
            }
            app.browserMcpTool.setBrowserManager(options.browserManager || app.browserManager || null);
            app.browserMcpTool.setLogger(options.logger || app.logger || console);
        }

        return app.browserMcpTool;
    }

    const tool = new BrowserMcpTool({
        app,
        browserManager: options.browserManager || app.browserManager || null,
        logger: options.logger || app.logger || console,
        browserMcp: options.browserMcp || null
    });

    app.browserMcpTool = tool;
    return tool;
}

function formatBrowserPageSnapshotForPrompt(snapshot = {}, options = {}, logger = console) {
    return new BrowserMcpTool({ logger }).formatPageSnapshotForPrompt(snapshot, options);
}

function getBrowserMcpCapabilitySummary() {
    return BROWSER_MCP_CAPABILITY_SUMMARY;
}

function getBrowserMcpPromptHints() {
    return [...BROWSER_MCP_PROMPT_HINTS];
}

module.exports = {
    BrowserMcpTool,
    BROWSER_MCP_TOOL_DEFINITIONS,
    getBrowserMcpTool,
    formatBrowserPageSnapshotForPrompt,
    getBrowserMcpCapabilitySummary,
    getBrowserMcpPromptHints
};
