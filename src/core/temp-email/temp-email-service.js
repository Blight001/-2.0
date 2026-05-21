const path = require('path');
const { OutlookEmailService } = require('../outlook-email');
const {
    normalizeApiConfig,
    normalizeProvider,
    normalizeProviders
} = require('./temp-email-utils');

class TempEmailService {
    constructor(app) {
        this.app = app;
        this.defaultSessionId = 'default';
        this.browserId = '';
        this.currentMode = 'tcp';
        this.currentProviderId = '';
        this.currentProvider = null;
        this.currentUrl = '';
        this.currentEmail = '';
        this.currentCode = '';
        this.currentSelection = '';
        this.providers = [];
        this.apiConfig = normalizeApiConfig();
        this.browserSessions = new Map();
        this.defaultBundledConfig = null;
        this.defaultSessionState = null;
        this.outlookEmailService = new OutlookEmailService(this);
    }

    _getElectronApp() {
        const directApp = this.app && typeof this.app === 'object' ? this.app : null;
        const nestedApp = directApp && directApp.app && typeof directApp.app === 'object' ? directApp.app : null;
        return nestedApp || directApp || null;
    }

    _isPackaged() {
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

    _getLogger() {
        return this.app?.logger || console;
    }

    log(level, message) {
        const logger = this._getLogger();
        const method = typeof logger[level] === 'function'
            ? level
            : level === 'warning' && typeof logger.warn === 'function'
                ? 'warn'
                : 'info';

        if (typeof logger[method] === 'function') {
            logger[method](message);
        }

        if (typeof this.app?.emitUiEvent === 'function') {
            this.app.emitUiEvent('temp-email-log', { level, message });
        }
    }

    async saveOutlookAccounts(accounts = []) {
        return this.outlookEmailService.saveOutlookAccounts(accounts);
    }

    async importOutlookAccounts(accounts = []) {
        return this.outlookEmailService.importOutlookAccounts(accounts);
    }

    async setOutlookMode() {
        return this.outlookEmailService.setOutlookMode();
    }

    async fetchOutlookContent(payload = {}) {
        return this.outlookEmailService.fetchOutlookContent(payload);
    }
}

Object.assign(
    TempEmailService.prototype,
    require('./temp-email-config-service'),
    require('./temp-email-browser-service'),
    require('./temp-email-api-service')
);

module.exports = {
    TempEmailService,
    normalizeProviders,
    normalizeProvider
};
