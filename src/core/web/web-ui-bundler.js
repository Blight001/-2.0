const fs = require('fs');
const path = require('path');

const REQUIRE_PATTERN = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

function toPosixPath(inputPath) {
    return inputPath.split(path.sep).join('/');
}

function normalizeModuleId(parts) {
    const stack = [];
    parts.forEach((part) => {
        if (!part || part === '.') {
            return;
        }
        if (part === '..') {
            if (stack.length > 0) {
                stack.pop();
            }
            return;
        }
        stack.push(part);
    });
    return stack.join('/');
}

function resolveRelativeModule(fromFile, request) {
    const basePath = path.resolve(path.dirname(fromFile), request);
    const candidates = [
        basePath,
        `${basePath}.js`,
        `${basePath}.json`,
        path.join(basePath, 'index.js')
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }

    throw new Error(`无法解析前端模块依赖: ${request} (from ${fromFile})`);
}

function resolveBundledModuleId(fromId, request, moduleSources) {
    if (request === 'electron') {
        return 'electron';
    }

    if (!request.startsWith('.')) {
        return request;
    }

    const baseParts = String(fromId).split('/');
    baseParts.pop();
    const requestParts = String(request).split('/');
    const resolved = normalizeModuleId(baseParts.concat(requestParts));
    const candidates = [
        resolved,
        `${resolved}.js`,
        `${resolved}/index.js`
    ];

    for (const candidate of candidates) {
        if (Object.prototype.hasOwnProperty.call(moduleSources, candidate)) {
            return candidate;
        }
    }

    throw new Error(`找不到前端模块: ${candidates[candidates.length - 1]}`);
}

function collectModules(entryFile, projectRoot, modules, visited) {
    const absoluteEntry = path.resolve(entryFile);
    if (visited.has(absoluteEntry)) {
        return;
    }

    visited.add(absoluteEntry);
    const extname = path.extname(absoluteEntry).toLowerCase();
    const rawSource = fs.readFileSync(absoluteEntry, 'utf8');
    const source = extname === '.json'
        ? `module.exports = ${rawSource.trim()};`
        : rawSource;
    const dependencies = [];
    let match = null;
    REQUIRE_PATTERN.lastIndex = 0;

    while ((match = REQUIRE_PATTERN.exec(source)) !== null) {
        const request = String(match[1] || '').trim();
        if (!request || !request.startsWith('.')) {
            continue;
        }

        dependencies.push(resolveRelativeModule(absoluteEntry, request));
    }

    for (const dependency of dependencies) {
        collectModules(dependency, projectRoot, modules, visited);
    }

    modules.push({
        id: toPosixPath(path.relative(projectRoot, absoluteEntry)),
        source
    });
}

function buildBundle(projectRoot, entryRelativePath = 'src/ui/renderer.js') {
    const modules = [];
    collectModules(path.join(projectRoot, entryRelativePath), projectRoot, modules, new Set());

    const builtinModules = {
        os: `({
            arch: () => 'x64',
            cpus: () => [{
                model: navigator?.platform || 'browser',
                speed: 0
            }],
            homedir: () => '',
            hostname: () => '',
            networkInterfaces: () => ({}),
            platform: () => 'browser',
            release: () => '',
            tmpdir: () => '',
            totalmem: () => 0,
            type: () => 'Browser',
            uptime: () => 0,
            userInfo: () => ({
                username: '',
                homedir: ''
            })
        })`
    };

    const moduleDefinitions = modules.map(({ id, source }) => {
        return `${JSON.stringify(id)}: ${JSON.stringify(source)}`;
    }).join(',\n');

    return `(() => {
    'use strict';

    const listeners = new Map();
    let snapshotEvents = [];

    function emitToListeners(channel, args) {
        const channelListeners = listeners.get(channel);
        if (!channelListeners || channelListeners.length === 0) {
            return;
        }

        channelListeners.forEach((listener) => {
            try {
                listener({ sender: ipcRenderer }, ...(Array.isArray(args) ? args : []));
            } catch (error) {
                console.error('[WebUI] 事件监听执行失败:', channel, error);
            }
        });
    }

    const ipcRenderer = {
        async invoke(channel, ...args) {
            const response = await fetch('/api/invoke', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
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
        },

        on(channel, listener) {
            const resolvedChannel = String(channel);
            const channelListeners = listeners.get(resolvedChannel) || [];
            channelListeners.push(listener);
            listeners.set(resolvedChannel, channelListeners);
            return this;
        },

        flushPendingSnapshot() {
            const events = Array.isArray(snapshotEvents) ? [...snapshotEvents] : [];
            snapshotEvents = [];
            events.forEach((item) => {
                if (!item || !item.channel) {
                    return;
                }
                emitToListeners(item.channel, item.args);
            });
        }
    };

    const eventSource = new EventSource('/api/events');
    eventSource.addEventListener('snapshot', (event) => {
        try {
            const payload = JSON.parse(event.data);
            snapshotEvents = Array.isArray(payload.events) ? payload.events : [];
        } catch (error) {
            console.error('[WebUI] 解析快照失败:', error);
        }
    });

    eventSource.addEventListener('ipc', (event) => {
        try {
            const payload = JSON.parse(event.data);
            emitToListeners(payload.channel, payload.args);
        } catch (error) {
            console.error('[WebUI] 解析实时事件失败:', error);
        }
    });

    function normalizeModuleId(parts) {
        const stack = [];
        parts.forEach((part) => {
            if (!part || part === '.') {
                return;
            }
            if (part === '..') {
                if (stack.length > 0) {
                    stack.pop();
                }
                return;
            }
            stack.push(part);
        });
        return stack.join('/');
    }

    const moduleSources = {
        os: ${builtinModules.os},
${moduleDefinitions}
    };

    const cache = {};

    const resolveModuleId = ${resolveBundledModuleId.toString()};

    function loadModule(moduleId) {
        if (moduleId === 'electron') {
            return { ipcRenderer };
        }

        if (moduleId === 'os') {
            return moduleSources.os;
        }

        if (cache[moduleId]) {
            return cache[moduleId].exports;
        }

        const source = moduleSources[moduleId];
        if (typeof source !== 'string') {
            throw new Error('找不到前端模块: ' + moduleId);
        }

        const module = { exports: {} };
        cache[moduleId] = module;
        const factory = new Function('require', 'module', 'exports', source);
        factory((request) => loadModule(resolveModuleId(moduleId, request, moduleSources)), module, module.exports);
        return module.exports;
    }

    loadModule(${JSON.stringify(toPosixPath(entryRelativePath))});
    ipcRenderer.flushPendingSnapshot();
})();`;
}

module.exports = {
    buildBundle,
    resolveBundledModuleId
};
