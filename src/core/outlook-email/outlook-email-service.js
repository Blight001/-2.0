const fs = require('fs-extra');
const path = require('path');
const { mergeOutlookAccounts, normalizeOutlookAccounts } = require('../temp-email/temp-email-utils');

class OutlookEmailService {
    constructor(service) {
        this.service = service;
        this.defaultBundledOutlookRecords = null;
    }

    _getService() {
        return this.service || null;
    }

    _getLogger() {
        const service = this._getService();
        return service && typeof service._getLogger === 'function'
            ? service._getLogger()
            : console;
    }

    log(level, message) {
        const service = this._getService();
        if (service && typeof service.log === 'function') {
            service.log(level, message);
            return;
        }

        const logger = this._getLogger();
        const method = typeof logger?.[level] === 'function'
            ? level
            : level === 'warning' && typeof logger?.warn === 'function'
                ? 'warn'
                : 'info';
        if (typeof logger?.[method] === 'function') {
            logger[method](message);
        }
    }

    _getElectronApp() {
        const service = this._getService();
        if (service && typeof service._getElectronApp === 'function') {
            return service._getElectronApp();
        }

        const directApp = service && typeof service.app === 'object' ? service.app : null;
        const nestedApp = directApp && directApp.app && typeof directApp.app === 'object' ? directApp.app : null;
        return nestedApp || directApp || null;
    }

    _isPackaged() {
        const service = this._getService();
        if (service && typeof service._isPackaged === 'function') {
            return service._isPackaged();
        }

        const electronApp = this._getElectronApp();
        if (!electronApp) {
            return false;
        }

        if (typeof electronApp.isPackaged === 'boolean') {
            return electronApp.isPackaged;
        }

        return false;
    }

    _getResourceRootPath() {
        const service = this._getService();
        if (service && typeof service._getResourceRootPath === 'function') {
            return service._getResourceRootPath();
        }

        const electronApp = this._getElectronApp();
        if (this._isPackaged()) {
            if (electronApp && typeof electronApp.resourcesPath === 'string' && electronApp.resourcesPath.trim()) {
                return path.join(electronApp.resourcesPath, 'resource');
            }

            if (typeof process.resourcesPath === 'string' && process.resourcesPath.trim()) {
                return path.join(process.resourcesPath, 'resource');
            }
        }

        return path.join(process.cwd(), 'resource');
    }

    _getConfigPath() {
        const resourceRootPath = this._getResourceRootPath();
        const recordsPath = path.join(resourceRootPath, 'outlook_email_records.json');

        return {
            installed: recordsPath,
            dev: this._isPackaged() ? null : recordsPath,
            bundled: recordsPath
        };
    }

    async _ensureRecordsPathReady() {
        const paths = this._getConfigPath();
        const targetPath = paths.dev || paths.installed;
        const bundledPath = paths.bundled;

        if (!targetPath) {
            return paths;
        }

        await fs.ensureDir(path.dirname(targetPath));

        if (!(await fs.pathExists(targetPath)) && bundledPath && bundledPath !== targetPath && await fs.pathExists(bundledPath)) {
            try {
                await fs.copy(bundledPath, targetPath);
                this.log('info', `已初始化 Outlook 记录: ${bundledPath} -> ${targetPath}`);
            } catch (error) {
                this.log('warning', `初始化 Outlook 记录失败: ${error.message}`);
            }
        }

        return paths;
    }

    async readBundledOutlookRecords() {
        if (this.defaultBundledOutlookRecords) {
            return this.defaultBundledOutlookRecords;
        }

        const paths = this._getConfigPath();
        const bundledPath = paths?.bundled;
        if (!bundledPath || !(await fs.pathExists(bundledPath))) {
            this.defaultBundledOutlookRecords = { outlook_accounts: [] };
            return this.defaultBundledOutlookRecords;
        }

        try {
            const records = await fs.readJson(bundledPath);
            const outlook_accounts = Array.isArray(records?.outlook_accounts)
                ? normalizeOutlookAccounts(records.outlook_accounts)
                : [];
            this.defaultBundledOutlookRecords = { outlook_accounts };
        } catch (error) {
            this.log('warning', `读取内置 Outlook 记录失败: ${error.message}`);
            this.defaultBundledOutlookRecords = { outlook_accounts: [] };
        }

        return this.defaultBundledOutlookRecords;
    }

    async readOutlookRecords() {
        try {
            const paths = await this._ensureRecordsPathReady();
            const candidatePaths = [paths?.installed || paths?.dev, paths?.bundled].filter(Boolean);

            for (const candidatePath of candidatePaths) {
                if (!candidatePath || !(await fs.pathExists(candidatePath))) {
                    continue;
                }

                const records = await fs.readJson(candidatePath);
                if (records && typeof records === 'object') {
                    const bundled = await this.readBundledOutlookRecords();
                    return {
                        outlook_accounts: mergeOutlookAccounts(
                            bundled.outlook_accounts || [],
                            records.outlook_accounts || records.outlookAccounts || []
                        )
                    };
                }
            }
        } catch (error) {
            this.log('warning', `读取 Outlook 记录失败: ${error.message}`);
        }

        const bundled = await this.readBundledOutlookRecords();
        return {
            outlook_accounts: Array.isArray(bundled?.outlook_accounts) ? bundled.outlook_accounts : []
        };
    }

    async writeOutlookRecords(records = {}, options = {}) {
        const paths = await this._ensureRecordsPathReady();
        const targetPath = paths?.installed || paths?.dev;
        if (!targetPath) {
            throw new Error('Outlook 记录路径不可用');
        }

        const mode = String(options.mode || options.writeMode || 'replace').trim().toLowerCase();
        const nextAccounts = Array.isArray(records.outlook_accounts || records.outlookAccounts)
            ? normalizeOutlookAccounts(records.outlook_accounts || records.outlookAccounts)
            : [];

        let mergedAccounts = nextAccounts;
        if (mode === 'merge') {
            let existingRecords = { outlook_accounts: [] };
            if (await fs.pathExists(targetPath)) {
                try {
                    const raw = await fs.readJson(targetPath);
                    existingRecords = {
                        outlook_accounts: Array.isArray(raw?.outlook_accounts)
                            ? normalizeOutlookAccounts(raw.outlook_accounts)
                            : []
                    };
                } catch (_error) {
                    existingRecords = { outlook_accounts: [] };
                }
            }

            mergedAccounts = mergeOutlookAccounts(existingRecords.outlook_accounts, nextAccounts);
        }

        const merged = {
            outlook_accounts: mergedAccounts
        };

        await fs.ensureDir(path.dirname(targetPath));
        await fs.writeJson(targetPath, merged, { spaces: 4 });
        return merged;
    }

    async saveOutlookAccounts(accounts = []) {
        const normalized = normalizeOutlookAccounts(accounts);
        const merged = await this.writeOutlookRecords({ outlook_accounts: normalized }, { mode: 'replace' });
        return {
            success: true,
            outlookAccounts: merged.outlook_accounts
        };
    }

    async importOutlookAccounts(accounts = []) {
        const sourceAccounts = Array.isArray(accounts) ? accounts : [];
        const existing = await this.readOutlookRecords();
        const merged = mergeOutlookAccounts(existing.outlook_accounts || [], sourceAccounts);
        const result = await this.writeOutlookRecords({ outlook_accounts: merged }, { mode: 'merge' });
        return {
            success: true,
            outlookAccounts: result.outlook_accounts
        };
    }

    async setOutlookMode() {
        const service = this._getService();
        if (!service || typeof service.saveConfig !== 'function') {
            throw new Error('临时邮箱服务不可用');
        }

        const result = await service.saveConfig({ selectedMode: 'outlook' });
        if (typeof service._emitState === 'function') {
            service._emitState({ reason: 'outlook-mode-changed' });
        }
        return result;
    }

    async fetchOutlookContent(payload = {}) {
        const url = String(payload.url || '').trim();
        if (!url) {
            return { success: false, error: '获取链接为空' };
        }

        return {
            success: true,
            url
        };
    }
}

module.exports = {
    OutlookEmailService
};
