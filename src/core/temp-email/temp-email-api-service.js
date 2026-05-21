const {
    extractVerificationCodeFromEmailRecord,
    extractVerificationCodeFromEmailRecordDetailed,
    getRecordTimestamp,
    isLikelyVerificationCode
} = require('./temp-email-utils');

module.exports = {
    _buildApiUrl(endpoint = '', query = '') {
        const apiConfig = this.getApiConfig();
        const baseUrl = String(apiConfig.baseUrl || '').trim().replace(/\/+$/, '');
        const resolvedEndpoint = String(endpoint || '').trim();
        if (!baseUrl || !resolvedEndpoint) {
            throw new Error('临时邮箱 API 地址不可用');
        }

        const [rawPath, rawSearch = ''] = resolvedEndpoint.split('?');
        const url = new URL(`${baseUrl}/${String(rawPath || '').trim().replace(/^\/+/, '')}`);
        const searchParams = new URLSearchParams(rawSearch);
        const extraQuery = String(query || '').trim().replace(/^[?&]+/, '');
        if (extraQuery) {
            const extraParams = new URLSearchParams(extraQuery);
            for (const [key, value] of extraParams.entries()) {
                searchParams.set(key, value);
            }
        }

        const apiKey = String(apiConfig.apiKey || '').trim();
        const authQueryName = String(apiConfig.authQueryName || '').trim();
        if (apiKey && authQueryName && !searchParams.has(authQueryName)) {
            searchParams.set(authQueryName, apiKey);
        }

        url.search = searchParams.toString();
        return url.toString();
    },

    async _requestApi(method = 'GET', url = '', sessionId = this.defaultSessionId, body = null) {
        const apiConfig = this.getApiConfig();
        const apiKey = String(apiConfig.apiKey || '').trim();
        const headers = {
            Accept: 'application/json'
        };

        if (apiKey && apiConfig.authHeaderName) {
            headers[apiConfig.authHeaderName || 'X-API-Key'] = apiKey;
        }

        const options = {
            method,
            headers
        };

        if (body !== null && body !== undefined) {
            options.body = typeof body === 'string' ? body : JSON.stringify(body);
            options.headers = {
                ...options.headers,
                'Content-Type': 'application/json'
            };
        }

        const fetchFn = typeof globalThis.fetch === 'function'
            ? globalThis.fetch.bind(globalThis)
            : null;
        if (!fetchFn) {
            throw new Error('当前运行环境不支持 fetch');
        }

        this.log('info', `请求 ${method} ${url}`);
        const response = await fetchFn(url, options);
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (_error) {
            data = text;
        }

        if (!response.ok) {
            const errorMessage = typeof data === 'object' && data && data.error
                ? data.error
                : `${response.status} ${response.statusText}`;
            this.log('error', `请求失败 ${method} ${url}: ${errorMessage}`);
            throw new Error(errorMessage);
        }

        this.log('info', `请求成功 ${method} ${url}`);
        return data;
    },

    async getApiEmails(payload = {}) {
        const apiConfig = this.getApiConfig();
        const email = String(payload.email || payload.currentEmail || this.currentEmail || '').trim();
        if (!email) {
            return { success: false, error: '请先生成邮箱地址' };
        }

        if (!apiConfig?.endpoints?.emails) {
            return { success: false, error: '临时邮箱 API 未配置收件箱接口' };
        }

        const endpoint = String(apiConfig.endpoints.emails || '').replace('{email}', encodeURIComponent(email));
        const url = this._buildApiUrl(endpoint, payload.query || payload.queryString || '');
        const response = await this._requestApi('GET', url, payload.sessionId);
        const emails = Array.isArray(response?.data?.emails) ? response.data.emails : [];
        return {
            success: true,
            email,
            emails,
            count: Number(response?.data?.count ?? emails.length ?? 0),
            usage: response?.usage || null,
            raw: response
        };
    },

    async getApiEmail(payload = {}) {
        const apiConfig = this.getApiConfig();
        if (!apiConfig?.endpoints?.generateEmail) {
            return { success: false, error: '临时邮箱 API 未配置生成邮箱接口' };
        }

        const url = this._buildApiUrl(apiConfig.endpoints.generateEmail, payload.query || payload.queryString || '');
        const response = await this._requestApi('GET', url, payload.sessionId);
        const email = String(response?.data?.email || response?.data?.address || response?.email || '').trim();
        if (!email) {
            return { success: false, error: '未返回邮箱地址', raw: response };
        }

        this.currentEmail = email;
        this.currentCode = '';
        return {
            success: true,
            email,
            raw: response
        };
    },

    async waitForApiCode(payload = {}) {
        const timeoutSeconds = Number.isFinite(Number(payload.timeout)) ? Math.max(1, Number(payload.timeout)) : 120;
        const pollIntervalMs = Number.isFinite(Number(payload.pollIntervalMs))
            ? Math.max(250, Number(payload.pollIntervalMs))
            : 1500;
        const minCodeLength = Number.isFinite(Number(payload.minCodeLength))
            ? Math.max(4, Number(payload.minCodeLength))
            : 4;
        const maxCodeLength = Number.isFinite(Number(payload.maxCodeLength))
            ? Math.max(minCodeLength, Number(payload.maxCodeLength))
            : 12;
        const deadline = Date.now() + timeoutSeconds * 1000;
        let lastError = '';
        let lastCode = '';
        let lastRecordId = '';
        let lastTimestamp = 0;
        let baselineTimestamp = 0;
        const baselineRecordIds = new Set();

        try {
            const baselineResult = await this.getApiEmails(payload);
            if (baselineResult && baselineResult.success === true && Array.isArray(baselineResult.emails)) {
                for (const record of baselineResult.emails) {
                    const recordId = String(record?.id || '').trim();
                    const recordTimestamp = getRecordTimestamp(record);
                    if (recordId) {
                        baselineRecordIds.add(recordId);
                    }
                    baselineTimestamp = Math.max(baselineTimestamp, recordTimestamp || 0);
                }
            }
        } catch (_error) {}

        while (Date.now() <= deadline) {
            const emailResult = await this.getApiEmails(payload);
            if (!emailResult || emailResult.success !== true) {
                lastError = emailResult?.error || lastError;
            } else {
                const candidates = Array.isArray(emailResult.emails) ? [...emailResult.emails] : [];
                candidates.sort((left, right) => getRecordTimestamp(right) - getRecordTimestamp(left));

                for (const record of candidates) {
                    const recordId = String(record?.id || '').trim();
                    const recordTimestamp = getRecordTimestamp(record);
                    if (recordId && (baselineRecordIds.has(recordId) || (lastRecordId && recordId === lastRecordId))) {
                        continue;
                    }
                    if (recordTimestamp && ((baselineTimestamp && recordTimestamp <= baselineTimestamp) || (lastTimestamp && recordTimestamp <= lastTimestamp))) {
                        continue;
                    }

                    const matchInfo = extractVerificationCodeFromEmailRecordDetailed(record);
                    const code = matchInfo.code;
                    if (code && code.length >= minCodeLength && code.length <= maxCodeLength && isLikelyVerificationCode(code)) {
                        lastCode = code;
                        lastRecordId = recordId || lastRecordId;
                        lastTimestamp = Math.max(lastTimestamp, recordTimestamp || 0);
                        this.currentEmail = String(emailResult.email || payload.email || this.currentEmail || '').trim();
                        this.currentCode = code;
                        this.log('info', `已从API收件箱提取验证码: ${code}${matchInfo.source ? `（来源: ${matchInfo.source}` : ''}${matchInfo.matchedText ? `，内容: ${matchInfo.matchedText}` : ''}${matchInfo.source ? '）' : ''}`);
                        this.log('info', '📨 API 收件箱命中邮件完整内容:\n' + JSON.stringify({
                            email: this.currentEmail,
                            record_id: recordId || '',
                            extracted_code: code,
                            extracted_source: matchInfo.source || '',
                            record
                        }, null, 2));
                        return {
                            success: true,
                            code,
                            email: this.currentEmail,
                            record,
                            usage: emailResult.usage || null,
                            raw: emailResult.raw || null,
                            emails: Array.isArray(emailResult.emails) ? emailResult.emails : []
                        };
                    }
                }

                if (candidates.length > 0) {
                    const newest = candidates[0];
                    const code = extractVerificationCodeFromEmailRecord(newest);
                    if (code && isLikelyVerificationCode(code)) {
                        lastCode = code;
                        lastRecordId = String(newest?.id || lastRecordId || '').trim();
                        lastTimestamp = Math.max(lastTimestamp, getRecordTimestamp(newest) || 0);
                    }
                }
            }

            if (Date.now() >= deadline) {
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        return {
            success: false,
            error: lastError || (lastCode ? '验证码未通过重复校验' : '未找到验证码')
        };
    }
};
