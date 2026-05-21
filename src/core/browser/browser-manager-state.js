module.exports = {
    setMainWindow(mainWindow = null) {
        this.mainWindow = mainWindow || null;
    },

    setWebControlUrl(webControlUrl = '') {
        this.webControlUrl = String(webControlUrl || '').trim();
    },

    setWebControlServerStarter(starter = null) {
        this.webControlServerStarter = typeof starter === 'function' ? starter : null;
    },

    onBrowserLifecycle(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }

        this.browserLifecycleListeners.add(listener);
        return () => {
            this.browserLifecycleListeners.delete(listener);
        };
    },

    _emitBrowserLifecycle(event = {}) {
        for (const listener of this.browserLifecycleListeners) {
            try {
                listener(event);
            } catch (error) {
                this.logger.warning(`浏览器生命周期回调执行失败: ${error.message}`);
            }
        }
    },

    getBrowser(browserId) {
        const browserData = this.browsers.get(browserId);
        if (!browserData) {
            return null;
        }

        if (browserData.page && typeof browserData.page.isClosed === 'function' && !browserData.page.isClosed()) {
            return browserData.page;
        }

        try {
            const openPages = browserData.context && typeof browserData.context.pages === 'function'
                ? browserData.context.pages().filter(page => page && typeof page.isClosed === 'function' ? !page.isClosed() : !!page)
                : [];
            if (openPages.length > 0) {
                browserData.page = [...openPages].reverse().find(Boolean) || openPages[0];
                this.browsers.set(browserId, browserData);
                return browserData.page;
            }
        } catch (_error) {
        }

        return null;
    },

    getBrowserData(browserId) {
        return this.browsers.get(browserId) || null;
    },

    findBrowserIdBySource(browserSource = '') {
        const normalizedSource = String(browserSource || '').trim().toLowerCase();
        if (!normalizedSource) {
            return '';
        }

        const candidates = [...this.browsers.entries()]
            .filter(([, browserData]) => {
                if (!browserData) {
                    return false;
                }

                const source = String(browserData.browserSource || browserData.browser_source || browserData.type || '').trim().toLowerCase();
                if (source !== normalizedSource) {
                    return false;
                }

                const browser = browserData.browser;
                const page = browserData.page;
                const browserAlive = browser && typeof browser.isConnected === 'function'
                    ? browser.isConnected()
                    : true;
                const pageAlive = page && typeof page.isClosed === 'function'
                    ? !page.isClosed()
                    : !!page;

                return browserAlive && pageAlive;
            })
            .sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0));

        return candidates.length > 0 ? String(candidates[0][0] || '').trim() : '';
    },

    async setBrowserPage(browserId, page) {
        try {
            const browserData = this.browsers.get(browserId);
            if (!browserData) {
                return false;
            }

            if (!page || typeof page.isClosed !== 'function' || page.isClosed()) {
                return false;
            }

            browserData.page = page;
            this.browsers.set(browserId, browserData);
            if (typeof page.bringToFront === 'function') {
                await page.bringToFront().catch(() => {});
            }
            browserData.hidden = false;
            this.browsers.set(browserId, browserData);
            this.logger.info(`浏览器 ${browserId} 已切换到新页面: ${typeof page.url === 'function' ? page.url() : 'unknown'}`);
            return true;
        } catch (error) {
            this.logger.warning(`切换浏览器页面失败: ${error.message}`);
            return false;
        }
    },

    async hideBrowser(browserId) {
        try {
            const browserData = this.browsers.get(browserId);
            if (!browserData) {
                return false;
            }

            if (browserData.kind === 'electron' && browserData.browser && typeof browserData.browser.evaluate === 'function') {
                await browserData.browser.evaluate(({ BrowserWindow }) => {
                    for (const win of BrowserWindow.getAllWindows()) {
                        if (win && !win.isDestroyed()) {
                            win.hide();
                        }
                    }
                });
                browserData.hidden = true;
                this.browsers.set(browserId, browserData);
                this.logger.info(`浏览器实例已隐藏: ${browserId}`);
                return true;
            }

            return false;
        } catch (error) {
            this.logger.warning(`隐藏浏览器失败: ${error.message}`);
            return false;
        }
    },

    async showBrowser(browserId) {
        try {
            const browserData = this.browsers.get(browserId);
            if (!browserData) {
                return false;
            }

            if (browserData.kind === 'electron' && browserData.browser && typeof browserData.browser.evaluate === 'function') {
                if (browserData.page && typeof browserData.page.bringToFront === 'function') {
                    await browserData.page.bringToFront().catch(() => {});
                } else {
                    await browserData.browser.evaluate(({ BrowserWindow }) => {
                        const focusedWindow = BrowserWindow.getFocusedWindow();
                        if (focusedWindow && !focusedWindow.isDestroyed()) {
                            focusedWindow.show();
                            focusedWindow.focus();
                        }
                    });
                }
                browserData.hidden = false;
                this.browsers.set(browserId, browserData);
                this.logger.info(`浏览器实例已显示: ${browserId}`);
                return true;
            }

            return false;
        } catch (error) {
            this.logger.warning(`显示浏览器失败: ${error.message}`);
            return false;
        }
    },

    async getCookies(browserId) {
        try {
            const browserData = this.browsers.get(browserId);
            if (!browserData) {
                throw new Error(`浏览器实例不存在: ${browserId}`);
            }

            const cookies = await browserData.context.cookies();
            return cookies;
        } catch (error) {
            this.logger.error(`获取Cookie失败: ${error.message}`);
            return [];
        }
    },

    async getBrowserState(browserId) {
        try {
            const browserData = this.browsers.get(browserId);
            if (!browserData) {
                throw new Error(`浏览器实例不存在: ${browserId}`);
            }

            const readCookies = async () => {
                const directCookies = await browserData.context.cookies();
                const pages = typeof browserData.context.pages === 'function'
                    ? browserData.context.pages()
                    : (browserData.page ? [browserData.page] : []);
                const urls = [];
                for (const page of Array.isArray(pages) ? pages : []) {
                    if (!page || typeof page.url !== 'function') {
                        continue;
                    }
                    const url = String(page.url() || '').trim();
                    if (url) {
                        urls.push(url);
                    }
                }

                let urlCookies = [];
                if (urls.length > 0) {
                    try {
                        urlCookies = await browserData.context.cookies(urls);
                    } catch (error) {
                        this.logger.debug?.(`按页面 URL 读取 Cookie 失败: ${error.message}`);
                    }
                }

                const merged = [...(Array.isArray(directCookies) ? directCookies : []), ...(Array.isArray(urlCookies) ? urlCookies : [])];
                const seen = new Set();
                return merged.filter((cookie) => {
                    if (!cookie || !cookie.name) {
                        return false;
                    }
                    const key = `${cookie.name || ''}||${cookie.domain || ''}||${cookie.path || ''}||${cookie.url || ''}`;
                    if (seen.has(key)) {
                        return false;
                    }
                    seen.add(key);
                    return true;
                });
            };

            const pollCookies = async () => {
                const mergedCookies = [];
                const seenCookies = new Set();
                let stableRounds = 0;
                const maxRounds = 8;

                for (let round = 0; round < maxRounds; round += 1) {
                    const currentCookies = await readCookies();
                    let addedCount = 0;

                    for (const cookie of Array.isArray(currentCookies) ? currentCookies : []) {
                        const key = `${cookie.name || ''}||${cookie.domain || ''}||${cookie.path || ''}||${cookie.url || ''}`;
                        if (seenCookies.has(key)) {
                            continue;
                        }
                        seenCookies.add(key);
                        mergedCookies.push(cookie);
                        addedCount += 1;
                    }

                    if (addedCount === 0) {
                        stableRounds += 1;
                    } else {
                        stableRounds = 0;
                    }

                    if (stableRounds >= 2) {
                        break;
                    }

                    if (round < maxRounds - 1) {
                        await new Promise((resolve) => setTimeout(resolve, 400));
                    }
                }

                return mergedCookies;
            };

            const cookies = await pollCookies();

            const pages = typeof browserData.context.pages === 'function'
                ? browserData.context.pages()
                : (browserData.page ? [browserData.page] : []);

            const storageSnapshots = [];
            const seenOrigins = new Set();

            for (const page of Array.isArray(pages) ? pages : []) {
                if (!page || typeof page.evaluate !== 'function') {
                    continue;
                }

                let snapshot = null;
                try {
                    snapshot = await page.evaluate(() => {
                        const collect = (storage) => {
                            const result = {};
                            try {
                                const length = storage && typeof storage.length === 'number' ? storage.length : 0;
                                for (let index = 0; index < length; index += 1) {
                                    const key = storage.key(index);
                                    if (!key) {
                                        continue;
                                    }
                                    result[key] = storage.getItem(key);
                                }
                            } catch (_error) {
                            }
                            return result;
                        };

                        return {
                            url: String(window.location.href || ''),
                            origin: String(window.location.origin || ''),
                            localStorage: collect(window.localStorage),
                            sessionStorage: collect(window.sessionStorage)
                        };
                    });
                } catch (error) {
                    this.logger.debug?.(`读取页面浏览器存储失败: ${error.message}`);
                    continue;
                }

                const origin = String(snapshot?.origin || snapshot?.url || '').trim();
                if (!origin || seenOrigins.has(origin)) {
                    continue;
                }

                seenOrigins.add(origin);
                storageSnapshots.push(snapshot);
            }

            return {
                cookies: Array.isArray(cookies) ? cookies : [],
                browserStorage: storageSnapshots
            };
        } catch (error) {
            this.logger.error(`获取浏览器状态失败: ${error.message}`);
            return {
                cookies: [],
                browserStorage: []
            };
        }
    },

    async setCookies(browserId, cookies = []) {
        try {
            const browserData = this.browsers.get(browserId);
            if (!browserData) {
                throw new Error(`浏览器实例不存在: ${browserId}`);
            }

            if (!Array.isArray(cookies) || cookies.length === 0) {
                this.logger.info(`浏览器 ${browserId} 没有可注入的Cookie`);
                return true;
            }

            await browserData.context.addCookies(cookies);
            this.logger.info(`浏览器 ${browserId} 已注入 ${cookies.length} 个Cookie`);
            return true;
        } catch (error) {
            this.logger.error(`注入Cookie失败: ${error.message}`);
            return false;
        }
    },

    getBrowserCount() {
        return this.browsers.size;
    },

    setLogger(logger) {
        this.logger = logger;
    },

    getBrowserInfo() {
        const info = {};
        for (const [id, data] of this.browsers) {
            info[id] = {
                type: data.type,
                createdAt: new Date(data.createdAt).toISOString(),
                pageClosed: data.page ? data.page.isClosed() : true,
                browserConnected: data.browser ? data.browser.isConnected() : false,
                requestBlocking: data.requestBlocking || null,
                profile: data.profile ? {
                    viewport: data.profile.viewport,
                    screen: data.profile.screen,
                    browserType: data.profile.browserType,
                    browserVersion: data.profile.browserVersion
                } : null
            };
        }
        return info;
    }
};
