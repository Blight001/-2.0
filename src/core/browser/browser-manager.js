const browserStateMixin = require('./browser-manager-state');
const browserProfileMixin = require('./browser-manager-profile');
const browserLifecycleMixin = require('./browser-manager-lifecycle');

class BrowserManager {
    constructor() {
        this.browsers = new Map();
        this.closingBrowsers = new Set();
        this.cleanupInProgress = false;
        this.browserLifecycleListeners = new Set();
        this.mainWindow = null;
        this.logger = {
            debug: (...args) => console.debug(...args),
            info: (...args) => console.info(...args),
            warning: (...args) => console.warn(...args),
            warn: (...args) => console.warn(...args),
            error: (...args) => console.error(...args)
        };
        this.enableSystemCleanup = true;
        this.webControlUrl = '';
        this.webControlServerStarter = null;
    }
}

Object.assign(
    BrowserManager.prototype,
    browserStateMixin,
    browserProfileMixin,
    browserLifecycleMixin
);

module.exports = BrowserManager;
