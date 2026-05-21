const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeSmsApiKey(smsApiUrl) {
    return normalizeText(smsApiUrl);
}

class HaikaStateStore {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.filePath = options.filePath || path.join(app.getPath('userData'), 'haika-state.json');
        this.stateCache = null;
    }

    setLogger(logger) {
        this.logger = logger || console;
    }

    getDefaultState() {
        return {
            version: 1,
            updatedAt: null,
            latestExchange: null,
            latestSms: null,
            latestSmsRecords: {}
        };
    }

    normalizeState(rawState = {}) {
        const state = this.getDefaultState();
        if (!rawState || typeof rawState !== 'object') {
            return state;
        }

        const latestExchange = rawState.latestExchange && typeof rawState.latestExchange === 'object'
            ? rawState.latestExchange
            : null;
        const latestSms = rawState.latestSms && typeof rawState.latestSms === 'object'
            ? rawState.latestSms
            : null;
        const latestSmsRecords = rawState.latestSmsRecords && typeof rawState.latestSmsRecords === 'object'
            ? rawState.latestSmsRecords
            : {};

        return {
            version: Number.isFinite(rawState.version) ? rawState.version : 1,
            updatedAt: typeof rawState.updatedAt === 'string' ? rawState.updatedAt : null,
            latestExchange,
            latestSms,
            latestSmsRecords
        };
    }

    async loadState() {
        if (this.stateCache) {
            return this.stateCache;
        }

        try {
            if (!(await fs.pathExists(this.filePath))) {
                this.stateCache = this.getDefaultState();
                return this.stateCache;
            }

            const rawState = await fs.readJson(this.filePath);
            this.stateCache = this.normalizeState(rawState);
            return this.stateCache;
        } catch (error) {
            this.logger?.warning?.(`读取海卡状态失败: ${error.message}`);
            this.stateCache = this.getDefaultState();
            return this.stateCache;
        }
    }

    async saveState(state) {
        this.stateCache = this.normalizeState(state);
        await fs.ensureDir(path.dirname(this.filePath));
        await fs.writeJson(this.filePath, this.stateCache, { spaces: 2 });
        return this.stateCache;
    }

    async updateLatestExchange(record = {}) {
        const state = await this.loadState();
        const nextState = {
            ...state,
            latestExchange: this.normalizeExchangeRecord(record),
            updatedAt: new Date().toISOString()
        };

        await this.saveState(nextState);
        return nextState.latestExchange;
    }

    normalizeExchangeRecord(record = {}) {
        const rawRecord = record && typeof record === 'object' ? record : {};
        const key = normalizeText(rawRecord.key);
        const response = rawRecord.response && typeof rawRecord.response === 'object'
            ? rawRecord.response
            : (rawRecord.result && typeof rawRecord.result === 'object'
                ? rawRecord.result
                : null);

        return {
            key,
            savedAt: normalizeText(rawRecord.savedAt) || new Date().toISOString(),
            response,
            source: normalizeText(rawRecord.source) || 'exchange-haika-key'
        };
    }

    async updateLatestSmsRecord(record = {}) {
        const state = await this.loadState();
        const smsApiUrl = normalizeSmsApiKey(record.smsApiUrl);
        const code = normalizeText(record.code);
        const previousCode = normalizeText(record.previousCode);
        const raw = record.raw !== undefined ? record.raw : null;

        if (!smsApiUrl) {
            throw new Error('验证码接口地址为空');
        }

        const nextRecord = {
            smsApiUrl,
            code,
            previousCode,
            duplicate: record.duplicate === true,
            savedAt: normalizeText(record.savedAt) || new Date().toISOString(),
            raw
        };

        const nextState = {
            ...state,
            latestSms: nextRecord,
            latestSmsRecords: {
                ...(state.latestSmsRecords || {}),
                [smsApiUrl]: nextRecord
            },
            updatedAt: new Date().toISOString()
        };

        await this.saveState(nextState);
        return nextRecord;
    }

    async getLatestSmsRecord(smsApiUrl) {
        const state = await this.loadState();
        const normalizedKey = normalizeSmsApiKey(smsApiUrl);
        if (!normalizedKey) {
            return state.latestSms || null;
        }

        return state.latestSmsRecords?.[normalizedKey] || null;
    }

    async buildSnapshot(options = {}) {
        const state = await this.loadState();
        const latestExchange = state.latestExchange || null;
        const requestedSmsApiUrl = normalizeSmsApiKey(options.smsApiUrl);
        const exchangeSmsApiUrl = normalizeSmsApiKey(
            latestExchange?.response?.content?.sms_api ||
            latestExchange?.response?.content?.smsApi ||
            latestExchange?.response?.sms_api ||
            latestExchange?.response?.smsApi ||
            ''
        );

        let latestSms = null;
        if (requestedSmsApiUrl) {
            latestSms = state.latestSmsRecords?.[requestedSmsApiUrl] || null;
        } else if (exchangeSmsApiUrl) {
            latestSms = state.latestSmsRecords?.[exchangeSmsApiUrl] || state.latestSms || null;
        } else {
            latestSms = state.latestSms || null;
        }

        return {
            ...state,
            latestSms
        };
    }
}

module.exports = HaikaStateStore;
