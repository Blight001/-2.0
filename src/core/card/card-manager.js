const fs = require('fs-extra');
const path = require('path');

class CardManager {
    constructor() {
        this.resourceRoot = this.resolveResourceRoot();
        this.cardsDir = path.join(this.resourceRoot, 'register_cards');
        this.testCardsDir = path.join(this.resourceRoot, 'test_cards');
        this.apiCardsDir = path.join(this.resourceRoot, 'api_cards');
        this.modelCardsDir = path.join(this.resourceRoot, 'model_cards');
        this.haikaBindCardsDir = path.join(this.resourceRoot, 'haika_bind_cards');
        this.legacyCardsDir = path.join(path.dirname(this.resourceRoot), 'cards');
        this.legacyTestCardsDir = path.join(path.dirname(this.resourceRoot), 'test_cards');
        this.legacyApiCardsDir = path.join(path.dirname(this.resourceRoot), 'api_cards');
        this.legacyModelCardsDir = path.join(path.dirname(this.resourceRoot), 'model_cards');
        this.logger = console; // 暂时使用 console，后续会传入 Logger 实例
        this.storageReady = false;
        this.cardCache = new Map();
    }

    resolveResourceRoot() {
        const packagedResourceDir = path.join(process.resourcesPath || '', 'resource');
        const devResourceDir = path.resolve(__dirname, '..', '..', '..', 'resource');
        const cwdResourceDir = path.join(process.cwd(), 'resource');

        if (fs.existsSync(packagedResourceDir)) {
            return packagedResourceDir;
        }

        if (fs.existsSync(devResourceDir)) {
            return devResourceDir;
        }

        if (fs.existsSync(cwdResourceDir)) {
            return cwdResourceDir;
        }

        return devResourceDir;
    }

    async ensureStorageReady() {
        if (this.storageReady) {
            return;
        }

        await fs.ensureDir(this.resourceRoot);
        await fs.ensureDir(this.cardsDir);
        await fs.ensureDir(this.testCardsDir);
        await fs.ensureDir(this.apiCardsDir);
        await fs.ensureDir(this.modelCardsDir);
        await fs.ensureDir(this.haikaBindCardsDir);
        await this.migrateLegacyCardDirs();
        this.storageReady = true;
    }

    async migrateLegacyCardDirs() {
        const migrations = [
            { legacyDir: this.legacyCardsDir, targetDir: this.cardsDir, label: '注册卡片' },
            { legacyDir: this.legacyTestCardsDir, targetDir: this.testCardsDir, label: '测试卡片' },
            { legacyDir: this.legacyApiCardsDir, targetDir: this.apiCardsDir, label: 'API卡片' },
            { legacyDir: this.legacyModelCardsDir, targetDir: this.modelCardsDir, label: '模型卡片' }
        ];

        for (const migration of migrations) {
            if (!(await fs.pathExists(migration.legacyDir))) {
                continue;
            }

            const legacyFiles = await fs.readdir(migration.legacyDir);
            const legacyJsonFiles = legacyFiles.filter(file => file.endsWith('.json'));
            if (legacyJsonFiles.length === 0) {
                continue;
            }

            await fs.ensureDir(migration.targetDir);

            for (const fileName of legacyJsonFiles) {
                const sourceFile = path.join(migration.legacyDir, fileName);
                const targetFile = path.join(migration.targetDir, fileName);
                if (!(await fs.pathExists(targetFile))) {
                    await fs.copy(sourceFile, targetFile, { overwrite: false, errorOnExist: false });
                }
            }

            this.logger.info(`已迁移${migration.label}目录: ${migration.legacyDir} -> ${migration.targetDir}`);
        }
    }
    
    // ==================== 注册卡片方法 ====================

    getCardDirectory() {
        return this.cardsDir;
    }

    cloneCardData(data) {
        return JSON.parse(JSON.stringify(data));
    }

    getCacheKey(dirPath) {
        return path.resolve(dirPath);
    }

    getCachedCards(dirPath) {
        const cacheKey = this.getCacheKey(dirPath);
        if (!this.cardCache.has(cacheKey)) {
            return null;
        }

        return this.cloneCardData(this.cardCache.get(cacheKey));
    }

    setCachedCards(dirPath, cards) {
        const cacheKey = this.getCacheKey(dirPath);
        this.cardCache.set(cacheKey, this.cloneCardData(cards));
    }

    invalidateCardCache(dirPath) {
        const cacheKey = this.getCacheKey(dirPath);
        this.cardCache.delete(cacheKey);
    }

    async loadCards(options = {}) {
        await this.ensureStorageReady();
        return this._loadCardsFromDir(this.cardsDir, options);
    }

    async saveCard(cardData) {
        await this.ensureStorageReady();
        return this._saveCardToDir(this.cardsDir, cardData);
    }

    async deleteCard(cardName) {
        await this.ensureStorageReady();
        return this._deleteCardFromDir(this.cardsDir, cardName);
    }

    async getCard(cardName, options = {}) {
        await this.ensureStorageReady();
        return this._getCardFromDir(this.cardsDir, cardName, options);
    }
    
    // ==================== 测试卡片方法 ====================

    async loadTestCards(options = {}) {
        await this.ensureStorageReady();
        return this._loadCardsFromDir(this.testCardsDir, options);
    }

    async saveTestCard(cardData) {
        await this.ensureStorageReady();
        return this._saveCardToDir(this.testCardsDir, cardData);
    }

    async deleteTestCard(cardName) {
        await this.ensureStorageReady();
        return this._deleteCardFromDir(this.testCardsDir, cardName);
    }

    async getTestCard(cardName, options = {}) {
        await this.ensureStorageReady();
        return this._getCardFromDir(this.testCardsDir, cardName, options);
    }

    // ==================== API卡片方法 ====================

    async loadApiCards(options = {}) {
        await this.ensureStorageReady();
        return this._loadCardsFromDir(this.apiCardsDir, options);
    }

    async saveApiCard(cardData) {
        await this.ensureStorageReady();
        return this._saveCardToDir(this.apiCardsDir, cardData);
    }

    // ==================== 模型卡片方法 ====================

    async loadModelCards(options = {}) {
        await this.ensureStorageReady();
        return this._loadCardsFromDir(this.modelCardsDir, options);
    }

    async saveModelCard(cardData) {
        await this.ensureStorageReady();
        return this._saveCardToDir(this.modelCardsDir, cardData);
    }

    async deleteModelCard(cardName) {
        await this.ensureStorageReady();
        return this._deleteCardFromDir(this.modelCardsDir, cardName);
    }

    async getModelCard(cardName, options = {}) {
        await this.ensureStorageReady();
        return this._getCardFromDir(this.modelCardsDir, cardName, options);
    }

    async deleteApiCard(cardName) {
        await this.ensureStorageReady();
        return this._deleteCardFromDir(this.apiCardsDir, cardName);
    }

    async getApiCard(cardName, options = {}) {
        await this.ensureStorageReady();
        return this._getCardFromDir(this.apiCardsDir, cardName, options);
    }

    // ==================== 海卡绑定卡片方法 ====================

    async loadHaikaBindCards(options = {}) {
        await this.ensureStorageReady();
        return this._loadCardsFromDir(this.haikaBindCardsDir, options);
    }

    async saveHaikaBindCard(cardData) {
        await this.ensureStorageReady();
        return this._saveCardToDir(this.haikaBindCardsDir, cardData);
    }

    async deleteHaikaBindCard(cardName) {
        await this.ensureStorageReady();
        return this._deleteCardFromDir(this.haikaBindCardsDir, cardName);
    }

    async getHaikaBindCard(cardName, options = {}) {
        await this.ensureStorageReady();
        return this._getCardFromDir(this.haikaBindCardsDir, cardName, options);
    }
    
    // ==================== 通用内部方法 ====================

    async _loadCardsFromDir(dirPath, options = {}) {
        try {
            const forceReload = Boolean(options && options.forceReload);
            if (!forceReload) {
                const cachedCards = this.getCachedCards(dirPath);
                if (cachedCards) {
                    return cachedCards;
                }
            }

            await fs.ensureDir(dirPath);
            const files = await fs.readdir(dirPath);
            const jsonFiles = files.filter(file => file.endsWith('.json'));

            const cards = [];
            for (const file of jsonFiles) {
                try {
                    const filePath = path.join(dirPath, file);
                    const content = await fs.readFile(filePath, 'utf8');
                    const card = JSON.parse(content);
                    // 如果name字段与文件名不匹配，使用文件名作为name（兼容旧数据或损坏的数据）
                    const expectedName = file.replace(/\.json$/, '');
                    if (!card.name || card.name !== expectedName) {
                        const warn = typeof this.logger?.warning === 'function'
                            ? this.logger.warning.bind(this.logger)
                            : typeof this.logger?.warn === 'function'
                                ? this.logger.warn.bind(this.logger)
                                : console.warn.bind(console);
                        warn(`卡片 ${file} 的name字段不匹配，已修正`);
                        card.name = expectedName;
                    }
                    cards.push(card);
                    if (typeof this.logger?.debug === 'function') {
                        this.logger.debug(`卡片已加载: ${card.name}`);
                    }
                } catch (error) {
                    this.logger.error(`加载卡片文件失败: ${file} (${error.message})`);
                }
            }

            this.logger.info(`卡片加载完成: ${cards.length} 个`);
            this.setCachedCards(dirPath, cards);
            return this.cloneCardData(cards);
        } catch (error) {
            this.logger.error(`卡片目录加载失败: ${error.message}`);
            return [];
        }
    }

    async _saveCardToDir(dirPath, cardData) {
        try {
            await fs.ensureDir(dirPath);

            const nextName = String(cardData?.name || '').trim();
            const originalName = String(cardData?.original_name || cardData?.originalName || '').trim();
            const persistedCardData = { ...cardData };
            delete persistedCardData.original_name;
            delete persistedCardData.originalName;
            const filePath = path.join(dirPath, `${nextName}.json`);
            const originalFilePath = originalName && originalName !== nextName
                ? path.join(dirPath, `${originalName}.json`)
                : null;

            await fs.writeFile(filePath, JSON.stringify(persistedCardData, null, 2), 'utf8');
            if (originalFilePath && await fs.pathExists(originalFilePath)) {
                await fs.remove(originalFilePath);
            }
            this.invalidateCardCache(dirPath);
            return true;
        } catch (error) {
            this.logger.error(`保存卡片失败: ${error.message}`);
            return false;
        }
    }

    async _deleteCardFromDir(dirPath, cardName) {
        try {
            // 尝试多种文件名匹配方式
            const possibleFileNames = [
                `${cardName}.json`, // 原始名称
                cardName.endsWith('.json') ? cardName : null // 如果已经包含.json
            ].filter(Boolean);

            // 查找目录中与卡片名匹配的文件
            await fs.ensureDir(dirPath);
            const files = await fs.readdir(dirPath);
            
            // 查找完全匹配的文件
            let targetFile = files.find(file => possibleFileNames.includes(file));
            
            // 如果没找到，尝试模糊匹配
            if (!targetFile) {
                targetFile = files.find(file => {
                    const fileNameWithoutExt = file.replace(/\.json$/, '');
                    return fileNameWithoutExt === cardName;
                });
            }

            if (targetFile) {
                const filePath = path.join(dirPath, targetFile);
                await fs.remove(filePath);
                this.invalidateCardCache(dirPath);
                this.logger.info(`已删除卡片: ${cardName}`);
                return true;
            } else {
                const warn = typeof this.logger?.warning === 'function'
                    ? this.logger.warning.bind(this.logger)
                    : typeof this.logger?.warn === 'function'
                        ? this.logger.warn.bind(this.logger)
                        : console.warn.bind(console);
                warn(`卡片文件不存在: ${cardName} in ${dirPath}`);
                return false;
            }
        } catch (error) {
            this.logger.error(`删除卡片失败: ${error.message}`);
            return false;
        }
    }

    async _getCardFromDir(dirPath, cardName, options = {}) {
        try {
            const forceReload = options && options.forceReload === true;
            if (!forceReload) {
                const cachedCards = this.getCachedCards(dirPath);
                if (Array.isArray(cachedCards)) {
                    const cachedCard = cachedCards.find(card => card && card.name === cardName);
                    if (cachedCard) {
                        return this.cloneCardData(cachedCard);
                    }
                }
            }

            await fs.ensureDir(dirPath);
            const fileName = `${cardName}.json`;
            const filePath = path.join(dirPath, fileName);

            if (await fs.pathExists(filePath)) {
                const content = await fs.readFile(filePath, 'utf8');
                return this.cloneCardData(JSON.parse(content));
            } else {
                return null;
            }
        } catch (error) {
            this.logger.error(`获取卡片失败: ${error.message}`);
            return null;
        }
    }

    setLogger(logger) {
        this.logger = logger;
    }
}

module.exports = CardManager;
