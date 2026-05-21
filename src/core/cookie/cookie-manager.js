const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const CUSTOM_COOKIE_CARD_NAME = '自定义导入';

function extractCookieArray(cookieData) {
    if (Array.isArray(cookieData)) {
        return cookieData;
    }

    if (!cookieData || typeof cookieData !== 'object') {
        return [];
    }

    const candidates = [
        cookieData.cookies,
        cookieData.cookie,
        cookieData.cookie_list,
        cookieData.cookieList,
        cookieData.data?.cookies,
        cookieData.data?.cookie,
        cookieData.result?.cookies,
        cookieData.result?.cookie
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }

    if (cookieData.name && (cookieData.domain || cookieData.url)) {
        return [cookieData];
    }

    return [];
}

function extractBrowserStorageArray(cookieData) {
    if (!cookieData || typeof cookieData !== 'object' || Array.isArray(cookieData)) {
        return [];
    }

    const candidates = [
        cookieData.browserStorage,
        cookieData.browser_storage,
        cookieData.storage,
        cookieData.data?.browserStorage,
        cookieData.data?.browser_storage,
        cookieData.data?.storage,
        cookieData.result?.browserStorage,
        cookieData.result?.browser_storage,
        cookieData.result?.storage
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }

    return [];
}

function normalizeCookiePayload(cookiePayload = [], browserStorage = []) {
    if (Array.isArray(cookiePayload)) {
        return {
            version: 2,
            cookies: cookiePayload,
            browserStorage: Array.isArray(browserStorage) ? browserStorage : [],
            createdAt: new Date().toISOString()
        };
    }

    if (!cookiePayload || typeof cookiePayload !== 'object') {
        return {
            version: 2,
            cookies: [],
            browserStorage: Array.isArray(browserStorage) ? browserStorage : [],
            createdAt: new Date().toISOString()
        };
    }

    const cookies = extractCookieArray(cookiePayload);
    const storage = extractBrowserStorageArray(cookiePayload);
    const createdAt = String(cookiePayload.createdAt || cookiePayload.created_at || '').trim() || new Date().toISOString();

    return {
        ...cookiePayload,
        version: Number.isFinite(Number(cookiePayload.version)) ? Number(cookiePayload.version) : 2,
        cookies,
        browserStorage: storage,
        createdAt
    };
}

function parseCookieFileName(fileName) {
    const fileNameWithoutExt = String(fileName || '').replace(/\.json$/i, '');
    const parts = fileNameWithoutExt.split('_');
    const lastPart = parts[parts.length - 1];
    const isPointsNumber = /^\d+$/.test(lastPart);

    if (parts.length >= 2 && isPointsNumber && parts.length >= 3) {
        return {
            email: parts[0],
            password: parts.slice(1, -1).join('_'),
            points: parseInt(lastPart, 10)
        };
    }

    if (parts.length >= 2 && /@/.test(parts[0])) {
        return {
            email: parts[0],
            password: parts.slice(1).join('_'),
            points: null
        };
    }

    return {
        email: fileNameWithoutExt || 'unknown',
        password: '',
        points: null
    };
}

class CookieManager {
    constructor(options = {}) {
        this.persistToDesktop = options.persistToDesktop !== false;
        if (this.persistToDesktop) {
            // 保存到用户的桌面目录的cookies文件夹
            const desktopPath = path.join(os.homedir(), 'Desktop');
            this.cookiesDir = path.join(desktopPath, 'cookies');
        } else {
            this.cookiesDir = null;
        }
        this.logger = console; // 暂时使用 console，后续会传入 Logger 实例
    }

    isPersistenceEnabled() {
        return this.persistToDesktop === true && !!this.cookiesDir;
    }

    getCookieStorageMode() {
        return this.isPersistenceEnabled() ? 'desktop' : 'disabled';
    }

    getCookieDirectory() {
        return this.isPersistenceEnabled() ? this.cookiesDir : null;
    }

    _logPersistenceDisabled(action) {
        if (typeof this.logger?.info === 'function') {
            this.logger.info(`Cookie本地存储已禁用，已跳过${action}`);
        }
    }

    async _readCookieFileData(filePath) {
        const cookieData = await fs.readJson(filePath);
        return extractCookieArray(cookieData);
    }

    async _readCookiePayloadFileData(filePath) {
        const cookieData = await fs.readJson(filePath);
        return normalizeCookiePayload(cookieData);
    }

    _resolveCookieFilePath(cardName, fileName) {
        if (!this.isPersistenceEnabled() || !fileName) {
            return '';
        }

        if (cardName === CUSTOM_COOKIE_CARD_NAME) {
            return path.join(this.cookiesDir, fileName);
        }

        return path.join(this.cookiesDir, cardName, fileName);
    }

    async _appendCookieFileInfo(cookies, cardName, fileName, filePath) {
        const content = await fs.readFile(filePath, 'utf8');
        const cookieData = JSON.parse(content);
        const cookieArray = extractCookieArray(cookieData);
        const browserStorage = extractBrowserStorageArray(cookieData);

        if (cookieArray.length === 0 && browserStorage.length === 0) {
            this.logger.warning(`Cookie文件格式不支持注入: ${filePath}`);
            return;
        }

        const fileStat = await fs.stat(filePath);
        const fileModifiedTime = fileStat.mtime.toISOString();

        let createdAt = fileModifiedTime;
        if (!Array.isArray(cookieData) && (cookieData.createdAt || cookieData.created_at)) {
            try {
                const jsonCreatedAt = new Date(cookieData.createdAt || cookieData.created_at);
                const fileMtime = new Date(fileModifiedTime);
                if (!isNaN(jsonCreatedAt.getTime()) && jsonCreatedAt > fileMtime) {
                    createdAt = cookieData.createdAt || cookieData.created_at;
                }
            } catch (e) {
            }
        }

        const parsedFile = parseCookieFileName(fileName);
        const email = (!Array.isArray(cookieData) && (cookieData.email || cookieData.account))
            || parsedFile.email;
        const password = (!Array.isArray(cookieData) && cookieData.password)
            || parsedFile.password;
        const points = (!Array.isArray(cookieData) && cookieData.points !== undefined)
            ? cookieData.points
            : parsedFile.points;
        const aid = !Array.isArray(cookieData) && cookieData && typeof cookieData === 'object'
            ? (cookieData.id || cookieData.aid)
            : undefined;

        cookies.push({
            email,
            account: email,
            password,
            points,
            card_name: cardName,
            sourceCardName: cardName,
            sourceFilePath: filePath,
            createdAt,
            fileName,
            name: fileName,
            aid,
            browserStorage
        });
    }

    async listCookies() {
        if (!this.isPersistenceEnabled()) {
            return [];
        }

        try {
            await fs.ensureDir(this.cookiesDir);

            const cookies = [];
            const cardDirs = await fs.readdir(this.cookiesDir);

            for (const cardDir of cardDirs) {
                const cardPath = path.join(this.cookiesDir, cardDir);
                const stat = await fs.stat(cardPath);

                if (stat.isFile() && cardDir.toLowerCase().endsWith('.json')) {
                    try {
                        await this._appendCookieFileInfo(cookies, CUSTOM_COOKIE_CARD_NAME, cardDir, cardPath);
                    } catch (error) {
                        this.logger.error(`加载Cookie文件失败 ${cardDir}: ${error.message}`);
                    }
                    continue;
                }

                if (stat.isDirectory()) {
                    if (cardDir === '服务器测试卡片') {
                        continue;
                    }

                    const cookieFiles = await fs.readdir(cardPath);
                    const jsonFiles = cookieFiles.filter(file => file.endsWith('.json'));

                    for (const file of jsonFiles) {
                        try {
                            const filePath = path.join(cardPath, file);
                            await this._appendCookieFileInfo(cookies, cardDir, file, filePath);
                        } catch (error) {
                            this.logger.error(`加载Cookie文件失败 ${file}: ${error.message}`);
                        }
                    }
                }
            }

            return cookies;
        } catch (error) {
            this.logger.error(`加载Cookie列表失败: ${error.message}`);
            return [];
        }
    }

    async saveCookie(email, password, points, cookies, cardName, browserStorage = []) {
        try {
            if (!this.isPersistenceEnabled()) {
                this._logPersistenceDisabled('Cookie保存');
                return false;
            }

            const cookieArray = extractCookieArray(cookies);
            const browserStorageArray = Array.isArray(browserStorage)
                ? browserStorage
                : extractBrowserStorageArray(cookies);
            if (cookieArray.length === 0 && browserStorageArray.length === 0) {
                this.logger.error('保存Cookie失败: 没有可保存的Cookie或浏览器存储');
                return false;
            }

            this.logger.info(`开始保存Cookie - 邮箱: ${email}, 密码: ${password}, 积分: ${points}, 卡片: ${cardName}`);
            this.logger.info(`Cookie数量: ${cookieArray.length}`);

            const cardDir = path.join(this.cookiesDir, cardName);
            await fs.ensureDir(cardDir);

            // 生成文件名
            const timestamp = Date.now();
            const fileName = `${email}_${password}_${points}.json`;
            const filePath = path.join(cardDir, fileName);

            this.logger.info(`保存路径: ${filePath}`);

            const payload = normalizeCookiePayload(cookies, browserStorageArray);
            await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
            this.logger.info(`保存Cookie成功: ${fileName}`);
            return true;
        } catch (error) {
            this.logger.error(`保存Cookie失败: ${error.message}`);
            return false;
        }
    }

    async saveCookieFile(cardName, fileName, cookies, browserStorage = []) {
        try {
            if (!this.isPersistenceEnabled()) {
                this._logPersistenceDisabled('Cookie保存');
                return { success: false, error: '未启用本地Cookie存储' };
            }

            const normalizedCardName = String(cardName || '').trim();
            const normalizedFileName = String(fileName || '').trim();
            if (!normalizedCardName || !normalizedFileName) {
                return { success: false, error: 'Cookie目录或文件名不能为空' };
            }

            const cookieArray = extractCookieArray(cookies);
            const browserStorageArray = Array.isArray(browserStorage)
                ? browserStorage
                : extractBrowserStorageArray(cookies);
            if (cookieArray.length === 0 && browserStorageArray.length === 0) {
                return { success: false, error: '没有可保存的Cookie或浏览器存储' };
            }

            const safeCardName = normalizedCardName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
            const safeFileName = normalizedFileName
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
                .replace(/\.json$/i, '');
            const cardDir = path.join(this.cookiesDir, safeCardName);
            const filePath = path.join(cardDir, `${safeFileName}.json`);
            await fs.ensureDir(cardDir);
            const payload = normalizeCookiePayload(cookies, browserStorageArray);
            await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

            this.logger.info(`保存Cookie成功: ${safeCardName}/${path.basename(filePath)}`);
            return {
                success: true,
                cardName: safeCardName,
                fileName: path.basename(filePath),
                filePath
            };
        } catch (error) {
            this.logger.error(`保存Cookie失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async getCookies(email) {
        try {
            if (!this.isPersistenceEnabled()) {
                return null;
            }

            const cookies = await this.listCookies();
            const userCookies = cookies.filter(cookie => cookie.email === email);

            if (userCookies.length === 0) {
                return null;
            }

            // 返回最新的Cookie数据
            const latestCookie = userCookies.sort((a, b) =>
                new Date(b.createdAt) - new Date(a.createdAt)
            )[0];

            const filePath = latestCookie.sourceFilePath || this._resolveCookieFilePath(latestCookie.card_name, latestCookie.fileName);
            return await this._readCookieFileData(filePath);
        } catch (error) {
            this.logger.error(`获取Cookie失败: ${error.message}`);
            return null;
        }
    }

    async getCookiePayload(email) {
        try {
            if (!this.isPersistenceEnabled()) {
                return null;
            }

            const cookies = await this.listCookies();
            const userCookies = cookies.filter(cookie => cookie.email === email);

            if (userCookies.length === 0) {
                return null;
            }

            const latestCookie = userCookies.sort((a, b) =>
                new Date(b.createdAt) - new Date(a.createdAt)
            )[0];

            const filePath = latestCookie.sourceFilePath || this._resolveCookieFilePath(latestCookie.card_name, latestCookie.fileName);
            return await this._readCookiePayloadFileData(filePath);
        } catch (error) {
            this.logger.error(`获取Cookie载荷失败: ${error.message}`);
            return null;
        }
    }

    async getCookiePayloadByFile(cardName, fileName, sourceFilePath = '') {
        try {
            const resolvedSourceFilePath = typeof sourceFilePath === 'string' ? sourceFilePath.trim() : '';
            if (resolvedSourceFilePath) {
                if (!await fs.pathExists(resolvedSourceFilePath)) {
                    this.logger.warning(`Cookie文件不存在: ${resolvedSourceFilePath}`);
                    return normalizeCookiePayload([]);
                }

                return await this._readCookiePayloadFileData(resolvedSourceFilePath);
            }

            if (!this.isPersistenceEnabled() || !cardName || !fileName) {
                return normalizeCookiePayload([]);
            }

            const filePath = this._resolveCookieFilePath(cardName, fileName);
            if (!await fs.pathExists(filePath)) {
                this.logger.warning(`Cookie文件不存在: ${filePath}`);
                return normalizeCookiePayload([]);
            }

            return await this._readCookiePayloadFileData(filePath);
        } catch (error) {
            this.logger.error(`读取Cookie载荷失败: ${error.message}`);
            return normalizeCookiePayload([]);
        }
    }

    async getCookieDataByFile(cardName, fileName, sourceFilePath = '') {
        try {
            const resolvedSourceFilePath = typeof sourceFilePath === 'string' ? sourceFilePath.trim() : '';
            if (resolvedSourceFilePath) {
                if (!await fs.pathExists(resolvedSourceFilePath)) {
                    this.logger.warning(`Cookie文件不存在: ${resolvedSourceFilePath}`);
                    return [];
                }

                const cookieData = await fs.readJson(resolvedSourceFilePath);
                const cookies = extractCookieArray(cookieData);
                if (cookies.length > 0) {
                    return cookies;
                }

                this.logger.warning(`Cookie文件格式不支持注入: ${resolvedSourceFilePath}`);
                return [];
            }

            if (!this.isPersistenceEnabled()) {
                return [];
            }

            if (!cardName || !fileName) {
                return [];
            }

            const filePath = this._resolveCookieFilePath(cardName, fileName);
            if (!await fs.pathExists(filePath)) {
                this.logger.warning(`Cookie文件不存在: ${filePath}`);
                return [];
            }

            const cookieData = await fs.readJson(filePath);
            const cookies = extractCookieArray(cookieData);
            if (cookies.length > 0) {
                return cookies;
            }

            this.logger.warning(`Cookie文件格式不支持注入: ${filePath}`);
            return [];
        } catch (error) {
            this.logger.error(`读取Cookie文件失败: ${error.message}`);
            return [];
        }
    }

    async deleteCookie(email) {
        try {
            if (!this.isPersistenceEnabled()) {
                this._logPersistenceDisabled('Cookie删除');
                return false;
            }

            const cookies = await this.listCookies();
            const userCookies = cookies.filter(cookie => cookie.email === email);

            let deleted = false;
            for (const cookie of userCookies) {
                const cardDir = path.join(this.cookiesDir, cookie.card_name);
                const filePath = path.join(cardDir, cookie.fileName);

                if (await fs.pathExists(filePath)) {
                    await fs.remove(filePath);
                    deleted = true;
                    this.logger.info(`删除Cookie文件: ${cookie.fileName}`);
                }
            }

            return deleted;
        } catch (error) {
            this.logger.error(`删除Cookie失败: ${error.message}`);
            return false;
        }
    }

    async updateCookiePoints(email, cardName, newPoints) {
        try {
            if (!this.isPersistenceEnabled()) {
                this._logPersistenceDisabled('Cookie积分更新');
                return false;
            }

            const cookies = await this.listCookies();
            let userCookies = cookies.filter(cookie => cookie.email === email && cookie.card_name === cardName);
            let usedEmailFallback = false;

            if (userCookies.length === 0) {
                userCookies = cookies.filter(cookie => cookie.email === email);
                usedEmailFallback = userCookies.length > 0;
                if (usedEmailFallback) {
                    this.logger.warning(`按邮箱未找到指定卡片Cookie，改为按邮箱查找最新Cookie: ${email}, ${cardName}`);
                } else {
                    this.logger.warning(`按邮箱未找到Cookie文件，尝试按卡片目录查找最新Cookie: ${email}, ${cardName}`);
                    return await this.updateLatestCookiePoints(cardName, newPoints);
                }
            }

            // 使用最新的Cookie文件
            const latestCookie = userCookies.sort((a, b) =>
                new Date(b.createdAt) - new Date(a.createdAt)
            )[0];

            const actualCardName = latestCookie.card_name || cardName;
            const cardDir = path.join(this.cookiesDir, actualCardName);
            const oldFilePath = path.join(cardDir, latestCookie.fileName);

            // 更新内容中的积分
            const content = await fs.readJson(oldFilePath);
            const currentEmail = (content && !Array.isArray(content) && content.email) || latestCookie.email;
            const currentPassword = (content && !Array.isArray(content) && content.password) || latestCookie.password || '';
            const newFileName = `${currentEmail}_${currentPassword}_${newPoints}.json`;
            const newFilePath = path.join(cardDir, newFileName);

            if (Array.isArray(content)) {
                content.points = newPoints;
            } else if (content && typeof content === 'object') {
                content.points = newPoints;
            }

            if (newFilePath === oldFilePath) {
                await fs.writeJson(oldFilePath, content, { spaces: 2 });
                this.logger.info(`Cookie积分已是最新，无需重命名: ${email}, ${actualCardName} -> ${newPoints}`);
                return true;
            }

            await fs.writeJson(oldFilePath, content, { spaces: 2 });

            // 重命名文件
            await fs.rename(oldFilePath, newFilePath);
            this.logger.info(`更新Cookie积分成功${usedEmailFallback ? '（按邮箱回退）' : ''}: ${email}, ${actualCardName} -> ${newPoints}`);
            return true;
        } catch (error) {
            this.logger.error(`更新Cookie积分失败: ${error.message}`);
            return false;
        }
    }

    async updateCookiePointsBySource(sourceCardName, sourceFilePath, newPoints) {
        try {
            if (!sourceFilePath) {
                this.logger.error('按原始文件更新Cookie积分失败: sourceFilePath为空');
                return false;
            }

            const oldFilePath = sourceFilePath;
            if (!await fs.pathExists(oldFilePath)) {
                this.logger.error(`未找到指定Cookie文件: ${oldFilePath}`);
                return false;
            }

            const content = await fs.readJson(oldFilePath);
            const parsedFileName = path.basename(oldFilePath, '.json');
            const parts = parsedFileName.split('_');
            const emailFromFile = parts.length >= 2 ? parts[0] : '';
            const passwordFromFile = parts.length >= 2 ? parts.slice(1, -1).join('_') : '';
            const currentEmail = (content && !Array.isArray(content) && content.email) || emailFromFile || '';
            const currentPassword = (content && !Array.isArray(content) && content.password) || passwordFromFile || '';
            const newFileName = `${currentEmail}_${currentPassword}_${newPoints}.json`;
            const newFilePath = path.join(path.dirname(oldFilePath), newFileName);

            if (Array.isArray(content)) {
                content.points = newPoints;
            } else if (content && typeof content === 'object') {
                content.points = newPoints;
            }

            await fs.writeJson(oldFilePath, content, { spaces: 2 });

            if (newFilePath !== oldFilePath) {
                await fs.remove(newFilePath).catch(() => {});
                await fs.rename(oldFilePath, newFilePath);
            }

            this.logger.info(`按原始文件更新Cookie积分成功: ${sourceCardName || path.basename(path.dirname(oldFilePath))}/${path.basename(oldFilePath)} -> ${newPoints}`);
            return true;
        } catch (error) {
            this.logger.error(`按原始文件更新Cookie积分失败: ${error.message}`);
            return false;
        }
    }

    async updateLatestCookiePoints(cardName, newPoints) {
        try {
            if (!this.isPersistenceEnabled()) {
                this._logPersistenceDisabled('最新Cookie积分更新');
                return false;
            }

            if (!cardName) {
                this.logger.warning('更新最新Cookie积分失败: cardName为空');
                return false;
            }

            const cookies = await this.listCookies();
            const cardCookies = cookies.filter(cookie => cookie.card_name === cardName);

            if (cardCookies.length === 0) {
                this.logger.warning(`未找到Cookie文件: ${cardName}`);
                return false;
            }

            const latestCookie = cardCookies.sort((a, b) =>
                new Date(b.createdAt) - new Date(a.createdAt)
            )[0];
            const cardDir = path.join(this.cookiesDir, cardName);
            const oldFilePath = path.join(cardDir, latestCookie.fileName);

            if (!await fs.pathExists(oldFilePath)) {
                this.logger.warning(`最新Cookie文件不存在: ${oldFilePath}`);
                return false;
            }

            const content = await fs.readJson(oldFilePath);
            const currentEmail = (content && !Array.isArray(content) && content.email) || latestCookie.email || '';
            const currentPassword = (content && !Array.isArray(content) && content.password) || latestCookie.password || '';
            const newFileName = `${currentEmail}_${currentPassword}_${newPoints}.json`;
            const newFilePath = path.join(cardDir, newFileName);

            if (Array.isArray(content)) {
                content.points = newPoints;
            } else if (content && typeof content === 'object') {
                content.points = newPoints;
            }

            await fs.writeJson(oldFilePath, content, { spaces: 2 });

            if (newFilePath !== oldFilePath) {
                await fs.remove(newFilePath).catch(() => {});
                await fs.rename(oldFilePath, newFilePath);
            } else {
                this.logger.info(`Cookie文件名已是最新，无需重命名: ${cardName}/${latestCookie.fileName}`);
            }

            this.logger.info(`按卡片目录更新Cookie积分成功: ${cardName}/${latestCookie.fileName} -> ${newPoints}`);
            return true;
        } catch (error) {
            this.logger.error(`按卡片目录更新Cookie积分失败: ${error.message}`);
            return false;
        }
    }

    async updateCookiePointsByFile(cardName, fileName, newPoints) {
        try {
            if (!this.isPersistenceEnabled()) {
                this._logPersistenceDisabled('按文件更新Cookie积分');
                return false;
            }

            if (!cardName || !fileName) {
                this.logger.error('更新Cookie积分失败: cardName或fileName为空');
                return false;
            }

            const cardDir = path.join(this.cookiesDir, cardName);
            const oldFilePath = path.join(cardDir, fileName);
            if (!await fs.pathExists(oldFilePath)) {
                this.logger.error(`未找到指定Cookie文件: ${oldFilePath}`);
                return false;
            }

            const content = await fs.readJson(oldFilePath);
            const parsedFileName = path.basename(fileName, '.json');
            const parts = parsedFileName.split('_');
            const emailFromFile = parts.length >= 2 ? parts[0] : '';
            const passwordFromFile = parts.length >= 2 ? parts.slice(1, -1).join('_') : '';
            const currentEmail = content.email || emailFromFile || '';
            const currentPassword = content.password || passwordFromFile || '';
            const newFileName = `${currentEmail}_${currentPassword}_${newPoints}.json`;
            const newFilePath = path.join(cardDir, newFileName);

            if (Array.isArray(content)) {
                content.points = newPoints;
            } else if (content && typeof content === 'object') {
                content.points = newPoints;
            }

            await fs.writeJson(oldFilePath, content, { spaces: 2 });

            if (newFilePath !== oldFilePath) {
                await fs.remove(newFilePath).catch(() => {});
                await fs.rename(oldFilePath, newFilePath);
            } else {
                this.logger.info(`Cookie文件名已是最新，无需重命名: ${cardName}/${fileName}`);
            }

            this.logger.info(`按文件更新Cookie积分成功: ${cardName}/${fileName} -> ${newPoints}`);
            return true;
        } catch (error) {
            this.logger.error(`按文件更新Cookie积分失败: ${error.message}`);
            return false;
        }
    }

    async migrateCookieFormats() {
        try {
            if (!this.isPersistenceEnabled()) {
                this._logPersistenceDisabled('Cookie格式迁移');
                return 0;
            }

            this.logger.info('检查Cookie文件格式...');
            await fs.ensureDir(this.cookiesDir);

            const cardDirs = await fs.readdir(this.cookiesDir);
            let checkedCount = 0;
            let supportedCount = 0;
            let unknownCount = 0;

            for (const cardDir of cardDirs) {
                const cardPath = path.join(this.cookiesDir, cardDir);
                const stat = await fs.stat(cardPath);

                if (stat.isDirectory()) {
                    const cookieFiles = await fs.readdir(cardPath);
                    const jsonFiles = cookieFiles.filter(file => file.endsWith('.json'));

                    for (const file of jsonFiles) {
                        checkedCount++;
                        try {
                            const filePath = path.join(cardPath, file);
                            const content = await fs.readFile(filePath, 'utf8');
                            const cookieData = JSON.parse(content);

                            const extractedCookies = extractCookieArray(cookieData);
                            const hasSchemaV2 = cookieData && typeof cookieData === 'object' &&
                                !Array.isArray(cookieData) &&
                                Number.isFinite(Number(cookieData.version)) &&
                                Array.isArray(cookieData.cookies) &&
                                Array.isArray(cookieData.browserStorage);

                            if (Array.isArray(cookieData) || hasSchemaV2 || extractedCookies.length > 0) {
                                supportedCount++;
                                continue;
                            }

                            unknownCount++;
                            this.logger.warning(`发现不支持的Cookie文件格式，已跳过: ${file}`);
                        } catch (error) {
                            this.logger.error(`检查Cookie文件失败 ${file}: ${error.message}`);
                        }
                    }
                }
            }

            this.logger.info(`Cookie格式检查完成，共检查 ${checkedCount} 个文件，支持格式 ${supportedCount} 个，异常格式 ${unknownCount} 个`);
            return 0;
        } catch (error) {
            this.logger.error(`Cookie格式迁移异常: ${error.message}`);
            return 0;
        }
    }

    setLogger(logger) {
        this.logger = logger;
    }
}

module.exports = CookieManager;
