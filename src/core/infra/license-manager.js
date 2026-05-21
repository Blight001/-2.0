const http = require('http');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const { machineIdSync, machineId } = require('./machine-id');
const { URLSearchParams } = require('url');

class LicenseManager {
    constructor() {
        this.validateServerConfig = {
            hostname: '146.196.80.152',
            port: 58111,
            protocol: 'http:',
            path: '/api/validate_key'
        };

        this.exchangeServerConfig = {
            hostname: 'card.779.chat',
            port: 443,
            protocol: 'https:',
            path: '/api/exchange/verify'
        };
    }

    async getDeviceId() {
        let machineIdValue = '';

        try {
            machineIdValue = machineIdSync({ original: true });
        } catch (_error) {
            machineIdValue = '';
        }

        if (!machineIdValue) {
            try {
                machineIdValue = await machineId({ original: true });
            } catch (_error) {
                machineIdValue = '';
            }
        }

        if (machineIdValue) {
            return crypto.createHash('sha256').update(machineIdValue, 'utf8').digest('hex').slice(0, 20).toUpperCase();
        }

        const seed = [os.hostname(), process.platform, process.arch]
            .filter(Boolean)
            .join('|');
        return crypto.createHash('sha256').update(`fallback|${seed}`, 'utf8').digest('hex').slice(0, 20).toUpperCase();
    }

    async validateCardKey(key, deviceId) {
        const result = await this._requestJson(this.validateServerConfig, 'POST', {
            key: key,
            device_id: deviceId
        });

        if (!result.success) {
            return {
                success: false,
                error: result.error || '卡密验证失败'
            };
        }

        if (result.data && result.data.valid) {
            return { success: true, ...result.data };
        }

        return {
            success: false,
            error: result.data?.message || result.data?.error || '卡密验证失败'
        };
    }

    async exchangeHaikaKey(key) {
        const postResult = await this._requestJson(this.exchangeServerConfig, 'POST', {
            key: key
        });

        if (postResult.success) {
            return this._normalizeExchangeResult(postResult);
        }

        if (postResult.statusCode === 405) {
            const query = new URLSearchParams({ key }).toString();
            const getResult = await this._requestJson({
                ...this.exchangeServerConfig,
                path: `${this.exchangeServerConfig.path}?${query}`
            }, 'GET');
            if (getResult.success) {
                return this._normalizeExchangeResult(getResult);
            }

            return {
                success: false,
                error: getResult.error || postResult.error || '海卡兑换失败'
            };
        }

        return {
            success: false,
            error: postResult.error || '海卡兑换失败'
        };
    }

    _normalizeExchangeResult(result) {
        const data = result.data;
        if (data && data.success) {
            return {
                success: true,
                ...data
            };
        }

        return {
            success: false,
            error: data?.message || data?.error || '海卡兑换失败'
        };
    }

    async _requestJson(config, method, payload = null) {
        return new Promise((resolve) => {
            const hasBody = method !== 'GET' && payload !== null;
            const postData = hasBody ? JSON.stringify({ ...payload }) : '';

            const transport = config.protocol === 'https:' ? https : http;
            const options = {
                ...config,
                method,
                headers: hasBody ? {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                } : {},
                timeout: 10000
            };

            const req = transport.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = data ? JSON.parse(data) : {};
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve({ success: true, data: parsed, statusCode: res.statusCode });
                            return;
                        }

                        resolve({
                            success: false,
                            statusCode: res.statusCode,
                            data: parsed,
                            error: parsed.message || parsed.error || data || `请求失败 (${res.statusCode})`
                        });
                    } catch (e) {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve({ success: true, data: data, statusCode: res.statusCode });
                            return;
                        }

                        resolve({
                            success: false,
                            statusCode: res.statusCode,
                            data,
                            error: data || `服务器响应格式错误 (${res.statusCode})`
                        });
                    }
                });
            });

            req.on('error', (e) => {
                resolve({ success: false, error: `连接服务器失败: ${e.message}` });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false, error: '连接超时，请检查服务器是否运行' });
            });

            if (hasBody) {
                req.write(postData);
            }
            req.end();
        });
    }
}

module.exports = LicenseManager;
