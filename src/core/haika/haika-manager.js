const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');

class HaikaManager {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.userRoot = options.userRoot || path.join(app.getPath('userData'), 'haika');
        this.defaultCategory = '默认分类';
    }

    setLogger(logger) {
        this.logger = logger || console;
    }

    getTemplateRoot() {
        const candidates = [
            path.join(process.resourcesPath || '', 'resource', 'haika'),
            path.resolve(__dirname, '..', '..', '..', 'resource', 'haika'),
            path.join(process.cwd(), 'resource', 'haika')
        ].filter(Boolean);

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    sanitizeCategoryName(name) {
        const safe = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_');
        return safe || this.defaultCategory;
    }

    getCategoryDir(categoryName) {
        return path.join(this.userRoot, this.sanitizeCategoryName(categoryName));
    }

    getKeysFilePath(categoryName) {
        return path.join(this.getCategoryDir(categoryName), 'keys.txt');
    }

    async initialize() {
        await fs.ensureDir(this.userRoot);

        const existing = await this._listCategoryDirs();
        if (existing.length === 0) {
            const templateRoot = this.getTemplateRoot();
            if (templateRoot) {
                await fs.copy(templateRoot, this.userRoot, {
                    overwrite: false,
                    errorOnExist: false
                });
            }
        }

        await this.ensureDefaultCategory();
    }

    async ensureDefaultCategory() {
        const defaultDir = this.getCategoryDir(this.defaultCategory);
        await fs.ensureDir(defaultDir);

        const keysFile = this.getKeysFilePath(this.defaultCategory);
        if (!(await fs.pathExists(keysFile))) {
            const seedContent = [
                '# 海卡分类文件',
                '# 每行一条卡密，空行和 # 开头的注释会被忽略',
                ''
            ].join('\n');
            await fs.writeFile(keysFile, seedContent, 'utf8');
        }
    }

    async _listCategoryDirs() {
        await fs.ensureDir(this.userRoot);
        const entries = await fs.readdir(this.userRoot, { withFileTypes: true });
        return entries
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    }

    normalizeKeysContent(content) {
        const lines = String(content || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#') && !line.startsWith('//'));

        const unique = [];
        const seen = new Set();
        for (const line of lines) {
            if (!seen.has(line)) {
                seen.add(line);
                unique.push(line);
            }
        }

        return unique;
    }

    async listCategories() {
        await this.initialize();

        const dirs = await this._listCategoryDirs();
        const categories = [];

        for (const dirName of dirs) {
            const categoryName = dirName;
            const keys = await this.loadCategoryKeys(categoryName);
            categories.push({
                name: categoryName,
                keyCount: keys.length,
                path: this.getCategoryDir(categoryName)
            });
        }

        categories.sort((a, b) => {
            if (a.name === this.defaultCategory) return -1;
            if (b.name === this.defaultCategory) return 1;
            return a.name.localeCompare(b.name, 'zh-CN');
        });

        return {
            success: true,
            categories
        };
    }

    async createCategory(categoryName) {
        await this.initialize();

        const safeName = this.sanitizeCategoryName(categoryName);
        const dirPath = this.getCategoryDir(safeName);
        const existed = await fs.pathExists(dirPath);

        await fs.ensureDir(dirPath);
        await this.ensureCategoryFile(safeName);

        return {
            success: true,
            category: {
                name: safeName,
                keyCount: (await this.loadCategoryKeys(safeName)).length,
                existed
            }
        };
    }

    async ensureCategoryFile(categoryName) {
        const keysFile = this.getKeysFilePath(categoryName);
        if (!(await fs.pathExists(keysFile))) {
            await fs.ensureDir(path.dirname(keysFile));
            await fs.writeFile(keysFile, '', 'utf8');
        }
        return keysFile;
    }

    async loadCategoryKeys(categoryName) {
        await this.initialize();

        const keysFile = await this.ensureCategoryFile(categoryName);
        const content = await fs.readFile(keysFile, 'utf8');
        const keys = this.normalizeKeysContent(content);

        return keys.map((key, index) => ({
            index: index + 1,
            key,
            label: `${index + 1}. ${key}`
        }));
    }

    async importKeysFromFile(categoryName, filePath) {
        await this.initialize();

        const text = await fs.readFile(filePath, 'utf8');
        return await this.importKeysFromText(categoryName, text);
    }

    async importKeysFromText(categoryName, text) {
        await this.initialize();

        const safeName = this.sanitizeCategoryName(categoryName);
        const dirPath = this.getCategoryDir(safeName);
        await fs.ensureDir(dirPath);

        const keysFile = await this.ensureCategoryFile(safeName);
        const existing = await this.loadCategoryKeys(safeName);
        const incoming = this.normalizeKeysContent(text);

        const merged = [];
        const seen = new Set();

        for (const item of existing) {
            if (!seen.has(item.key)) {
                seen.add(item.key);
                merged.push(item.key);
            }
        }

        for (const key of incoming) {
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(key);
            }
        }

        await fs.writeFile(keysFile, merged.join('\n') + (merged.length ? '\n' : ''), 'utf8');

        this.logger.info(`海卡分类 ${safeName} 已导入 ${incoming.length} 条卡密，当前共 ${merged.length} 条`);

        return {
            success: true,
            category: safeName,
            importedCount: incoming.length,
            totalCount: merged.length
        };
    }
}

module.exports = HaikaManager;
