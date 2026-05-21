const http = require('http');
const { exec } = require('child_process');
const { getBrowserRegionDnsConfig } = require('../browser/browser-region');

// Configuration
const CONFIG = {
    hostname: '127.0.0.1',
    port: 9097,
    secret: 'set-your-secret', // Replace with your actual secret if different
    timeout: 5000 // default timeout for requests
};

/**
 * Helper function to make HTTP requests to the Clash API
 * @param {string} method - HTTP method (GET, PUT, etc.)
 * @param {string} path - API endpoint path (must be already encoded)
 * @param {object} [body] - Request body (optional)
 * @returns {Promise<any>} - Response data
 */
function clashRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: CONFIG.hostname,
            port: CONFIG.port,
            path: path, 
            method: method,
            headers: {
                'Authorization': `Bearer ${CONFIG.secret}`,
                'Content-Type': 'application/json'
            },
            timeout: CONFIG.timeout
        };

        if (body) {
            const bodyString = JSON.stringify(body);
            options.headers['Content-Length'] = Buffer.byteLength(bodyString);
        }

        const req = http.request(options, (res) => {
            let data = '';

            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        if (data) {
                            resolve(JSON.parse(data));
                        } else {
                            resolve(null); // No content
                        }
                    } catch (e) {
                        resolve(data); // Return raw string if not JSON
                    }
                } else {
                    reject(new Error(`Request failed with status ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        if (body) {
            req.write(JSON.stringify(body));
        }

        req.end();
    });
}

/**
 * Switch a proxy node within a specific group
 * @param {string} groupName - The name of the proxy group (e.g., '节点选择')
 * @param {string} nodeName - The name of the node to switch to
 */
async function switchNode(groupName, nodeName) {
    console.log(`[Switch] Group: "${groupName}" -> Node: "${nodeName}"`);
    try {
        // Encode the group name for the URL path
        const encodedGroupName = encodeURIComponent(groupName);
        
        // The body contains the target node name
        await clashRequest('PUT', `/proxies/${encodedGroupName}`, { name: nodeName });
        console.log('✅ Successfully switched node.');
        return true;
    } catch (error) {
        console.error('❌ Failed to switch node:', error.message);
        return false;
    }
}

/**
 * Test latency for a specific node
 * @param {string} nodeName - The name of the node to test
 * @param {string} [testUrl] - URL to use for latency testing (optional)
 * @returns {Promise<number>} - Latency in milliseconds
 */
async function testNodeLatency(nodeName, testUrl = 'http://www.gstatic.com/generate_204') {
    console.log(`[Latency] Testing "${nodeName}"...`);
    try {
        const encodedNodeName = encodeURIComponent(nodeName);
        const encodedUrl = encodeURIComponent(testUrl);
        const path = `/proxies/${encodedNodeName}/delay?timeout=5000&url=${encodedUrl}`;
        
        const result = await clashRequest('GET', path);
        
        if (result && (typeof result.delay === 'number')) {
            console.log(`✅ Latency: ${result.delay}ms`);
            return result.delay;
        } else {
            console.warn(`⚠️ Unexpected response:`, result);
            return -1;
        }
    } catch (error) {
        console.error(`❌ Failed to test latency:`, error.message);
        return -1;
    }
}

/**
 * Get all proxies
 */
async function getProxies() {
    try {
        const data = await clashRequest('GET', '/proxies');
        return data.proxies;
    } catch (error) {
        console.error('❌ Failed to get proxies:', error.message);
        return {};
    }
}

/**
 * Get current configuration
 */
async function getConfigs() {
    try {
        const data = await clashRequest('GET', '/configs');
        return data;
    } catch (error) {
        console.error('❌ Failed to get configs:', error.message);
        return {};
    }
}

/**
 * Update configuration
 * @param {object} config - Configuration object to update
 */
async function updateConfig(config) {
    try {
        await clashRequest('PATCH', '/configs', config);
        console.log('✅ Successfully updated config.');
        return true;
    } catch (error) {
        console.error('❌ Failed to update config:', error.message);
        return false;
    }
}

/**
 * 启用 DNS 泄漏防护配置
 * @param {object} [browserSettings] - 可选地区/浏览器设置
 */
async function applyDnsLeakProtection(browserSettings = {}) {
    try {
        const dnsConfig = getBrowserRegionDnsConfig(browserSettings);
        await updateConfig({ dns: dnsConfig });
        console.log(`✅ DNS leak protection enabled: ${JSON.stringify({
            enable: dnsConfig.enable,
            enhancedMode: dnsConfig['enhanced-mode']
        })}`);
        return true;
    } catch (error) {
        console.warn(`DNS leak protection update failed: ${error.message}`);
        return false;
    }
}

/**
 * Set TUN mode (System Proxy equivalent for Core)
 * @param {boolean} enable - Enable or disable TUN mode
 */
async function setTunMode(enable, browserSettings = {}) {
    console.log(`[Config] Setting TUN mode to ${enable}...`);
    const result = await updateConfig({ tun: { enable: enable } });
    if (enable) {
        await applyDnsLeakProtection(browserSettings);
    }
    return result;
}

/**
 * Set Proxy Mode
 * @param {string} mode - rule, global, or direct
 */
async function setMode(mode) {
    console.log(`[Config] Setting mode to ${mode}...`);
    return await updateConfig({ mode: mode });
}

/**
 * Set Windows System Proxy
 * @param {boolean} enable - Enable or disable system proxy
 */
async function setSystemProxy(enable, browserSettings = {}) {
    console.log(`[System Proxy] Setting system proxy to ${enable}...`);
    
    // Get current port config from Clash
    const config = await getConfigs();
    let port = 7890; // Default fallback
    if (config['mixed-port'] && config['mixed-port'] !== 0) {
        port = config['mixed-port'];
    } else if (config['port'] && config['port'] !== 0) {
        port = config['port'];
    }
    
    const proxyAddress = `127.0.0.1:${port}`;
    console.log(`[System Proxy] Using proxy address: ${proxyAddress}`);

    return new Promise((resolve, reject) => {
        let command;
        if (enable) {
            // Enable proxy: Set ProxyServer and ProxyEnable=1
            // Using reg add for better compatibility
            command = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyAddress}" /f & reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`;
        } else {
            // Disable proxy: Set ProxyEnable=0
            command = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`;
        }

        exec(command, async (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Failed to set system proxy: ${error.message}`);
                resolve(false);
                return;
            }
            if (stderr) {
                console.warn(`⚠️ System proxy warning: ${stderr}`);
            }
            if (enable) {
                await applyDnsLeakProtection(browserSettings);
            }
            console.log(`✅ System proxy ${enable ? 'enabled' : 'disabled'}.`);
            resolve(true);
        });
    });
}

// --- CLI Argument Handling ---
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command) {
        console.log(`
Usage:
  node clash_api.js switch <GroupName> <NodeName>
  node clash_api.js latency <NodeName>
  node clash_api.js list [GroupName]
  node clash_api.js tun <on|off>
  node clash_api.js system-proxy <on|off>
  node clash_api.js mode <rule|global|direct>
  node clash_api.js config [key] [value]

Examples:
  node clash_api.js switch "节点选择" "香港-优化"
  node clash_api.js tun on
  node clash_api.js system-proxy on
  node clash_api.js mode rule
        `);
        return;
    }

    if (command === 'switch') {
        const group = args[1];
        const node = args[2];
        if (!group || !node) {
            console.error('Error: Missing group name or node name.');
            return;
        }
        await switchNode(group, node);
    } else if (command === 'latency') {
        const node = args[1];
        if (!node) {
            console.error('Error: Missing node name.');
            return;
        }
        await testNodeLatency(node);
    } else if (command === 'tun') {
        const state = args[1];
        if (state === 'on') {
            await setTunMode(true);
        } else if (state === 'off') {
            await setTunMode(false);
        } else {
            console.error('Usage: node clash_api.js tun <on|off>');
        }
    } else if (command === 'system-proxy') {
        const state = args[1];
        if (state === 'on') {
            await setSystemProxy(true);
        } else if (state === 'off') {
            await setSystemProxy(false);
        } else {
            console.error('Usage: node clash_api.js system-proxy <on|off>');
        }
    } else if (command === 'mode') {
        const mode = args[1];
        if (['rule', 'global', 'direct'].includes(mode)) {
            await setMode(mode);
        } else {
            console.error('Usage: node clash_api.js mode <rule|global|direct>');
        }
    } else if (command === 'list') {
        const group = args[1];
        const proxies = await getProxies();
        if (group) {
            if (proxies[group]) {
                console.log(`Group: ${group}`);
                console.log(`Current: ${proxies[group].now}`);
                console.log(`All: ${proxies[group].all.join(', ')}`);
            } else {
                console.error(`Group "${group}" not found.`);
            }
        } else {
            // List all groups of type 'Selector'
            Object.keys(proxies).forEach(key => {
                if (proxies[key].type === 'Selector') {
                    console.log(`[${key}] -> Current: ${proxies[key].now}`);
                }
            });
        }
    } else if (command === 'config') {
        const key = args[1];
        const value = args[2];
        if (key && value) {
            // Update specific config
            const config = {};
            // Handle boolean/number types simply
            if (value === 'true') config[key] = true;
            else if (value === 'false') config[key] = false;
            else if (!isNaN(value)) config[key] = Number(value);
            else config[key] = value;
            
            await updateConfig(config);
        } else if (key) {
            // Get specific config
            const configs = await getConfigs();
            if (configs[key] !== undefined) {
                console.log(JSON.stringify(configs[key], null, 2));
            } else {
                console.error(`Config key "${key}" not found.`);
            }
        } else {
            // List all configs
            const configs = await getConfigs();
            console.log(JSON.stringify(configs, null, 2));
        }
    } else {
        console.error('Unknown command:', command);
    }
}

// Only run main if called directly
if (require.main === module) {
    main();
}

module.exports = {
    switchNode,
    testNodeLatency,
    getProxies
};
