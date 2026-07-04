/**
 * Clash Verge Rev 配置管理器
 * 读取当前使用的订阅和节点，允许用户选择并切换订阅/节点
 */

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const http = require('http');
const { exec } = require('child_process');
const { getBrowserRegionDnsConfig } = require('../browser/browser-region');

class ClashManager {
    constructor() {
        this.logger = console;
        this.configPath = this.getVergeConfigPath();
        this.apiConfig = {
            hostname: '127.0.0.1',
            port: 9097, // Default Clash API external-controller port
            secret: '',
            timeout: 5000
        };
        this.loadApiConfig();
    }

    /**
     * 加载 API 配置 (尝试从 Clash Verge 配置文件中读取端口和密钥)
     */
    loadApiConfig() {
        if (!this.configPath) return;
        
        const configFiles = ['config.yaml', 'verge.yaml'];
        
        for (const file of configFiles) {
            const configPath = path.join(this.configPath, file);
            if (fs.existsSync(configPath)) {
                try {
                    const content = fs.readFileSync(configPath, 'utf8');
                    const config = yaml.load(content);
                    
                    if (config) {
                        let updated = false;
                        
                        // Extract secret
                        if (config.secret !== undefined) {
                            this.apiConfig.secret = config.secret;
                            updated = true;
                        }
                        
                        // Extract port from external-controller
                        if (config['external-controller']) {
                            const parts = config['external-controller'].split(':');
                            if (parts.length === 2) {
                                this.apiConfig.hostname = parts[0];
                                this.apiConfig.port = parseInt(parts[1], 10);
                                updated = true;
                            }
                        }
                        
                        if (updated) {
                            this.logger.info(`Loaded Clash API config from ${file}: Host=${this.apiConfig.hostname}, Port=${this.apiConfig.port}, Secret=${this.apiConfig.secret ? '******' : 'Empty'}`);
                            break;
                        }
                    }
                } catch (e) {
                    this.logger.warn(`Failed to load config from ${file}: ${e.message}`);
                }
            }
        }
    }

    /**
     * 发送 Clash API 请求
     */
    clashRequest(method, path, body = null) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: this.apiConfig.hostname,
                port: this.apiConfig.port,
                path: path,
                method: method,
                headers: {
                    'Authorization': `Bearer ${this.apiConfig.secret}`,
                    'Content-Type': 'application/json'
                },
                timeout: this.apiConfig.timeout
            };

            if (body) {
                const bodyString = JSON.stringify(body);
                options.headers['Content-Length'] = Buffer.byteLength(bodyString);
            }

            const req = http.request(options, (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            if (data) {
                                resolve(JSON.parse(data));
                            } else {
                                resolve(null);
                            }
                        } catch (e) {
                            resolve(data);
                        }
                    } else {
                        reject(new Error(`Request failed with status ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', (e) => reject(e));

            if (body) {
                req.write(JSON.stringify(body));
            }

            req.end();
        });
    }

    /**
     * 设置系统代理 (Windows)
     */
    async setSystemProxy(enable, browserSettings = {}) {
        this.logger.info(`[System Proxy] Setting system proxy to ${enable}...`);
        
        try {
            // 获取当前端口配置
            let port = 7890; // Default fallback
            try {
                const config = await this.getConfigs();
                if (config) {
                    if (config['mixed-port'] && config['mixed-port'] !== 0) {
                        port = config['mixed-port'];
                    } else if (config['port'] && config['port'] !== 0) {
                        port = config['port'];
                    }
                }
            } catch (e) {
                this.logger.warn(`Failed to get clash config, using default port ${port}: ${e.message}`);
            }
            
            const proxyAddress = `127.0.0.1:${port}`;
            this.logger.info(`[System Proxy] Using proxy address: ${proxyAddress}`);

            return new Promise((resolve, reject) => {
                let command;
                if (enable) {
                    command = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyAddress}" /f & reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`;
                } else {
                    command = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`;
                }

                exec(command, async (error, _stdout, stderr) => {
                    if (error) {
                        this.logger.error(`❌ Failed to set system proxy: ${error.message}`);
                        resolve(false);
                        return;
                    }
                    if (stderr) {
                        this.logger.warn(`⚠️ System proxy warning: ${stderr}`);
                    }
                    if (enable) {
                        await this.applyDnsLeakProtection(browserSettings);
                    }
                    this.logger.info(`✅ System proxy ${enable ? 'enabled' : 'disabled'}.`);
                    resolve(true);
                });
            });
        } catch (error) {
            this.logger.error(`Failed to set system proxy: ${error.message}`);
            return false;
        }
    }

    /**
     * 设置 TUN 模式
     */
    async setTunMode(enable, browserSettings = {}) {
        this.logger.info(`[Config] Setting TUN mode to ${enable}...`);
        try {
            await this.updateConfig({ tun: { enable: enable } });
            if (enable) {
                await this.applyDnsLeakProtection(browserSettings);
            }
            return true;
        } catch (error) {
            this.logger.error(`Failed to set TUN mode: ${error.message}`);
            return false;
        }
    }

    /**
     * 启用 DNS 泄漏防护配置
     * @param {object} [browserSettings] - 浏览器/地区设置
     */
    async applyDnsLeakProtection(browserSettings = {}) {
        try {
            const dnsConfig = getBrowserRegionDnsConfig(browserSettings);
            await this.updateConfig({ dns: dnsConfig });
            this.logger.info(`✅ DNS leak protection enabled: ${JSON.stringify({
                enable: dnsConfig.enable,
                enhancedMode: dnsConfig['enhanced-mode'],
                region: browserSettings.region || browserSettings.browser_region || ''
            })}`);
            return true;
        } catch (error) {
            this.logger.warn(`DNS leak protection update failed: ${error.message}`);
            return false;
        }
    }

    /**
     * 设置代理模式
     * @param {string} mode - rule, global, or direct
     */
    async setMode(mode) {
        this.logger.info(`[Config] Setting mode to ${mode}...`);
        try {
            await this.updateConfig({ mode: mode });
            return true;
        } catch (error) {
            this.logger.error(`Failed to set mode: ${error.message}`);
            return false;
        }
    }

    /**
     * 测试节点延迟
     * @param {string} nodeName - The name of the node to test
     * @param {string} [testUrl] - URL to use for latency testing
     */
    async testNodeLatency(nodeName, testUrl = 'http://www.gstatic.com/generate_204') {
        this.logger.info(`[Latency] Testing "${nodeName}"...`);
        try {
            const encodedNodeName = encodeURIComponent(nodeName);
            const encodedUrl = encodeURIComponent(testUrl);
            const path = `/proxies/${encodedNodeName}/delay?timeout=5000&url=${encodedUrl}`;
            
            const result = await this.clashRequest('GET', path);
            
            if (result && (typeof result.delay === 'number')) {
                this.logger.info(`✅ Latency: ${result.delay}ms`);
                return { success: true, delay: result.delay };
            } else {
                this.logger.warn(`⚠️ Unexpected response:`, result);
                return { success: false, error: 'Unexpected response' };
            }
        } catch (error) {
            this.logger.error(`❌ Failed to test latency: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取 Clash 配置
     */
    async getConfigs() {
        try {
            const data = await this.clashRequest('GET', '/configs');
            return data;
        } catch (error) {
            // this.logger.error('❌ Failed to get configs:', error.message);
            throw error;
        }
    }

    /**
     * 更新 Clash 配置
     */
    async updateConfig(config) {
        try {
            await this.clashRequest('PATCH', '/configs', config);
            this.logger.info('✅ Successfully updated config.');
            return true;
        } catch (error) {
            this.logger.error('❌ Failed to update config:', error.message);
            throw error;
        }
    }

    /**
     * 获取所有代理组
     */
    async getProxies() {
        try {
            const data = await this.clashRequest('GET', '/proxies');
            return data ? data.proxies : {};
        } catch (error) {
            this.logger.error('❌ Failed to get proxies:', error.message);
            return {};
        }
    }

    /**
     * 查找选择器组名称 (通常是 "节点选择" 或 "Proxy")
     */
    async findSelectorGroup() {
        const proxies = await this.getProxies();
        // 优先查找名为 '节点选择' 的组
        if (proxies['节点选择']) return '节点选择';
        // 其次查找名为 'Proxy' 的组
        if (proxies['Proxy']) return 'Proxy';
        // 查找第一个类型为 Selector 的组 (排除 GLOBAL)
        for (const [name, group] of Object.entries(proxies)) {
            if (group.type === 'Selector' && name !== 'GLOBAL' && name !== 'REJECT' && name !== 'DIRECT') {
                return name;
            }
        }
        return '节点选择'; // 默认
    }

    /**
     * 获取当前选择组的状态
     */
    async getSelectorGroupState() {
        const proxies = await this.getProxies();
        const groupName = await this.findSelectorGroup();
        const group = proxies[groupName];

        if (!group) {
            throw new Error(`未找到选择器组: ${groupName}`);
        }

        const nodes = Array.isArray(group.all)
            ? [...new Set(group.all)].filter(name => name && !['DIRECT', 'REJECT', 'GLOBAL'].includes(name))
            : [];

        return {
            success: true,
            data: {
                groupName,
                currentNode: group.now || '',
                nodes
            }
        };
    }

    /**
     * 获取 Clash Verge Rev 配置文件夹路径
     */
    getVergeConfigPath() {
        const appdata = process.env.APPDATA || '';
        if (!appdata) {
            this.logger.error('无法获取 %APPDATA% 环境变量');
            return null;
        }

        // 尝试多个可能的路径
        const possiblePaths = [
            path.join(appdata, 'io.github.clash-verge-rev.clash-verge-rev'),
            path.join(appdata, 'io.github.clash-verge-rev', 'clash-verge-rev'),
            path.join(appdata, 'Clash-Verge-Rev'),
        ];

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }

        // 如果都不存在，使用第一个路径
        return possiblePaths[0];
    }

    /**
     * 加载 profiles.yaml 配置文件
     */
    loadProfilesConfig() {
        if (!this.configPath) {
            throw new Error('Clash Verge Rev 配置路径不存在');
        }

        const profilesFile = path.join(this.configPath, 'profiles.yaml');

        if (!fs.existsSync(profilesFile)) {
            throw new Error(`找不到配置文件: ${profilesFile}`);
        }

        try {
            const content = fs.readFileSync(profilesFile, 'utf8');
            return yaml.load(content);
        } catch (e) {
            throw new Error(`读取配置文件失败: ${e.message}`);
        }
    }

    /**
     * 获取当前使用的订阅UID
     */
    getCurrentProfileUid(profilesConfig) {
        return profilesConfig.getCurrentProfile || profilesConfig.current || '';
    }

    /**
     * 查找当前订阅的配置项
     */
    findProfileItem(profilesConfig, uid) {
        const items = profilesConfig.items || [];
        return items.find(item => item.uid === uid);
    }

    /**
     * 获取所有可用的订阅列表（仅远程订阅）
     */
    getAllProfiles(profilesConfig) {
        const items = profilesConfig.items || [];
        const profiles = [];

        for (const item of items) {
            const itemType = item.type || '';
            // 只显示 remote 类型的订阅
            if (itemType === 'remote') {
                profiles.push({
                    uid: item.uid || '',
                    name: item.name || item.file || '',
                    url: item.url || '',
                    file: item.file || '',
                });
            }
        }

        return profiles;
    }

    /**
     * 获取当前选中的节点
     */
    getCurrentNode(profilesConfig, uid) {
        const items = profilesConfig.items || [];

        for (const item of items) {
            if (item.uid === uid) {
                const selected = item.selected || [];
                if (selected.length > 0) {
                    return selected[0].now || '';
                }
                return '';
            }
        }

        return '';
    }

    /**
     * 获取订阅配置文件的完整路径
     */
    getProfileFilePath(item) {
        if (!this.configPath) {
            throw new Error('Clash Verge Rev 配置路径不存在');
        }

        const fileName = item.file || '';
        if (!fileName) {
            throw new Error('订阅配置文件名为空');
        }

        // 先检查 profiles 文件夹
        let filePath = path.join(this.configPath, 'profiles', fileName);

        if (!fs.existsSync(filePath)) {
            // 直接在配置目录查找
            filePath = path.join(this.configPath, fileName);
        }

        if (!fs.existsSync(filePath)) {
            throw new Error(`找不到配置文件: ${filePath}`);
        }

        return filePath;
    }

    /**
     * 从配置文件中加载所有节点名称
     */
    loadProxyNodes(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`找不到节点配置文件: ${filePath}`);
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const config = yaml.load(content);

            const proxies = config.proxies || [];
            const nodeNames = [];

            for (const proxy of proxies) {
                const name = proxy.name || '';
                if (name && !nodeNames.includes(name)) {
                    nodeNames.push(name);
                }
            }

            return nodeNames;
        } catch (e) {
            throw new Error(`读取节点配置文件失败: ${e.message}`);
        }
    }

    /**
     * 更新 profiles.yaml 中的当前订阅
     */
    updateCurrentProfile(newUid) {
        const profilesFile = path.join(this.configPath, 'profiles.yaml');

        try {
            const config = this.loadProfilesConfig();
            config.current = newUid;

            fs.writeFileSync(profilesFile, yaml.dump(config, {
                allowUnicode: true,
                sortKeys: false,
                lineWidth: -1
            }));

            return true;
        } catch (e) {
            this.logger.error(`更新订阅配置失败: ${e.message}`);
            return false;
        }
    }

    /**
     * 更新 profiles.yaml 中的节点选择
     */
    updateProfileNode(uid, newNode) {
        const profilesFile = path.join(this.configPath, 'profiles.yaml');

        try {
            const config = this.loadProfilesConfig();
            const items = config.items || [];

            for (const item of items) {
                if (item.uid === uid) {
                    if (!item.selected || !item.selected.length) {
                        item.selected = [{ name: '节点选择', now: newNode }];
                    } else {
                        item.selected[0].now = newNode;
                    }
                    break;
                }
            }

            fs.writeFileSync(profilesFile, yaml.dump(config, {
                allowUnicode: true,
                sortKeys: false,
                lineWidth: -1
            }));

            return true;
        } catch (e) {
            this.logger.error(`更新节点配置失败: ${e.message}`);
            return false;
        }
    }

    /**
     * 获取系统代理状态
     */
    async getSystemProxyStatus() {
        return new Promise((resolve) => {
            const command = 'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable';
            exec(command, (error, stdout, stderr) => {
                if (error || stderr) {
                    // 如果查询失败，假设未开启
                    resolve(false);
                    return;
                }
                // 检查输出中是否包含 0x1
                resolve(stdout.includes('0x1'));
            });
        });
    }

    /**
     * 获取当前 Clash 状态
     */
    async getStatus() {
        try {
            // 检查配置文件是否存在
            if (!this.configPath) {
                return {
                    success: false,
                    error: 'Clash Verge Rev 配置目录不存在'
                };
            }

            const profilesFile = path.join(this.configPath, 'profiles.yaml');
            if (!fs.existsSync(profilesFile)) {
                return {
                    success: false,
                    error: 'Clash Verge Rev 配置文件不存在'
                };
            }

            // 加载配置
            const config = this.loadProfilesConfig();
            const currentUid = this.getCurrentProfileUid(config);
            const currentItem = this.findProfileItem(config, currentUid);
            const currentProfileName = currentItem?.name || currentItem?.file || 'Unknown';
            const currentNode = this.getCurrentNode(config, currentUid);

            // 获取所有订阅
            const profiles = this.getAllProfiles(config);

            // 获取 TUN 模式状态和系统代理状态
            let tunMode = false;
            let systemProxy = false;
            
            try {
                const apiConfig = await this.getConfigs();
                if (apiConfig && apiConfig.tun && apiConfig.tun.enable) {
                    tunMode = true;
                }
            } catch (e) {
                // API 可能未连接
            }

            try {
                systemProxy = await this.getSystemProxyStatus();
            } catch (e) {
                // 忽略错误
            }

            return {
                success: true,
                data: {
                    configPath: this.configPath,
                    currentUid,
                    currentProfileName,
                    currentNode,
                    profiles,
                    profilesCount: profiles.length,
                    tunMode,
                    systemProxy
                }
            };
        } catch (e) {
            return {
                success: false,
                error: e.message
            };
        }
    }

    /**
     * 获取指定订阅的节点列表
     */
    async getProfileNodes(profileUid) {
        try {
            const config = this.loadProfilesConfig();
            const currentItem = this.findProfileItem(config, profileUid);

            if (!currentItem) {
                throw new Error(`未找到UID为 ${profileUid} 的订阅`);
            }

            const profileFile = this.getProfileFilePath(currentItem);
            const nodes = this.loadProxyNodes(profileFile);

            return {
                success: true,
                nodes,
                profileName: currentItem.name || currentItem.file
            };
        } catch (e) {
            return {
                success: false,
                error: e.message
            };
        }
    }

    /**
     * 切换订阅
     */
    async switchProfile(newUid) {
        try {
            const config = this.loadProfilesConfig();
            const profiles = this.getAllProfiles(config);

            const targetProfile = profiles.find(p => p.uid === newUid);
            if (!targetProfile) {
                throw new Error(`未找到UID为 ${newUid} 的订阅`);
            }

            const result = this.updateCurrentProfile(newUid);

            if (result) {
                // 重新加载配置获取最新状态
                const newConfig = this.loadProfilesConfig();
                const currentNode = this.getCurrentNode(newConfig, newUid);
                const profileNodes = await this.getProfileNodes(newUid);

                return {
                    success: true,
                    data: {
                        profileName: targetProfile.name,
                        currentNode,
                        nodes: profileNodes.success ? profileNodes.nodes : []
                    }
                };
            } else {
                throw new Error('更新订阅配置失败');
            }
        } catch (e) {
            return {
                success: false,
                error: e.message
            };
        }
    }

    /**
     * 切换节点
     */
    async switchNode(profileUid, nodeName) {
        try {
            // 1. 尝试使用 API 切换 (立即生效，无需重启)
            try {
                const groupName = await this.findSelectorGroup();
                this.logger.info(`[Switch] Group: "${groupName}" -> Node: "${nodeName}"`);
                
                // Encode the group name for the URL path
                const encodedGroupName = encodeURIComponent(groupName);
                
                await this.clashRequest('PUT', `/proxies/${encodedGroupName}`, { name: nodeName });
                this.logger.info('✅ Successfully switched node via API.');
            } catch (apiError) {
                this.logger.warn(`⚠️ Failed to switch node via API: ${apiError.message}. Fallback to config only.`);
            }

            // 2. 更新配置文件 (持久化)
            const config = this.loadProfilesConfig();
            const currentItem = this.findProfileItem(config, profileUid);

            if (!currentItem) {
                throw new Error(`未找到UID为 ${profileUid} 的订阅`);
            }

            const result = this.updateProfileNode(profileUid, nodeName);

            if (result) {
                return {
                    success: true,
                    data: {
                        profileName: currentItem.name || currentItem.file,
                        oldNode: this.getCurrentNode(config, profileUid),
                        newNode: nodeName
                    }
                };
            } else {
                throw new Error('更新节点配置失败');
            }
        } catch (e) {
            return {
                success: false,
                error: e.message
            };
        }
    }

    /**
     * 设置日志记录器
     */
    setLogger(logger) {
        this.logger = logger;
    }
}

module.exports = ClashManager;

