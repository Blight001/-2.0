const fs = require('fs-extra');
const path = require('path');
const {
    DEFAULT_API_CONFIG,
    ensureUniqueProviderId,
    mergeOutlookAccounts,
    mergeProviders,
    normalizeApiConfig,
    normalizeProvider,
    normalizeProviders,
    sanitizeId
} = require('./temp-email-utils');

module.exports = {
    _getConfigPath() {
        const resourceRootPath = this._getResourceRootPath();
        const resourceConfigPath = path.join(resourceRootPath, 'temp_email_config.json');

        return {
            installed: resourceConfigPath,
            dev: this._isPackaged() ? null : resourceConfigPath,
            bundled: resourceConfigPath
        };
    },

    async _ensureConfigPathReady() {
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
                this.log('info', `已初始化临时邮箱配置: ${bundledPath} -> ${targetPath}`);
            } catch (error) {
                this.log('warning', `初始化临时邮箱配置失败: ${error.message}`);
            }
        }

        return paths;
    },

    async _readBundledConfig() {
        if (this.defaultBundledConfig) {
            return this.defaultBundledConfig;
        }

        const paths = this._getConfigPath();
        const bundledPath = paths?.bundled;
        if (!bundledPath || !(await fs.pathExists(bundledPath))) {
            this.defaultBundledConfig = {};
            return this.defaultBundledConfig;
        }

        try {
            const config = await fs.readJson(bundledPath);
            this.defaultBundledConfig = config && typeof config === 'object' ? config : {};
        } catch (error) {
            this.log('warning', `读取内置临时邮箱配置失败: ${error.message}`);
            this.defaultBundledConfig = {};
        }

        return this.defaultBundledConfig;
    },

    async _mergeBundledConfig(source = {}) {
        const bundled = await this._readBundledConfig();
        const outlookRecords = this.outlookEmailService
            ? await this.outlookEmailService.readBundledOutlookRecords()
            : { outlook_accounts: [] };

        return {
            ...source,
            selected_mode: source.selected_mode ?? source.selectedMode ?? bundled.selected_mode ?? bundled.selectedMode,
            selected_provider: source.selected_provider ?? source.selectedProviderId ?? bundled.selected_provider ?? bundled.selectedProviderId,
            api_config: {
                ...(bundled.api_config || bundled.apiConfig || {}),
                ...(source.api_config || source.apiConfig || {})
            },
            providers: mergeProviders(
                bundled.providers || bundled.temp_email_providers || bundled.tempEmailProviders,
                source.providers || source.temp_email_providers || source.tempEmailProviders
            ),
            outlook_accounts: mergeOutlookAccounts(
                outlookRecords.outlook_accounts || [],
                source.outlook_accounts || source.outlookAccounts || []
            )
        };
    },

    async _readConfig() {
        try {
            const paths = await this._ensureConfigPathReady();
            const candidatePaths = [paths?.installed || paths?.dev, paths?.bundled].filter(Boolean);

            for (const candidatePath of candidatePaths) {
                if (!candidatePath || !(await fs.pathExists(candidatePath))) {
                    continue;
                }

                const config = await fs.readJson(candidatePath);
                if (config && typeof config === 'object') {
                    const merged = await this._mergeBundledConfig(config);
                    return merged;
                }
            }
        } catch (error) {
            this.log('warning', `读取临时邮箱配置失败: ${error.message}`);
        }

        return await this._mergeBundledConfig({});
    },

    async _writeConfig(config = {}) {
        const paths = await this._ensureConfigPathReady();
        const targetPath = paths?.installed || paths?.dev;
        if (!targetPath) {
            throw new Error('临时邮箱配置路径不可用');
        }

        let existingConfig = {};
        if (await fs.pathExists(targetPath)) {
            try {
                existingConfig = await fs.readJson(targetPath);
            } catch (_error) {
                existingConfig = {};
            }
        }

        const merged = {
            ...(existingConfig && typeof existingConfig === 'object' ? existingConfig : {}),
            ...(config && typeof config === 'object' ? config : {})
        };

        await fs.ensureDir(path.dirname(targetPath));
        await fs.writeJson(targetPath, merged, { spaces: 4 });
        return merged;
    },

    _normalizeConfig(source = {}) {
        const providers = normalizeProviders(source.providers || source.temp_email_providers || source.tempEmailProviders);
        const selectedProviderId = sanitizeId(
            source.selected_provider || source.selectedProviderId || source.current_provider || source.currentProviderId || providers[0]?.id || '',
            providers[0]?.id || ''
        );
        const normalizedMode = String(source.selected_mode || source.selectedMode || 'api').trim().toLowerCase();
        const selectedMode = normalizedMode === 'outlook'
            ? 'outlook'
            : normalizedMode === 'temp'
            ? 'temp'
            : normalizedMode === 'api'
                ? 'api'
                : 'tcp';
        const apiConfig = normalizeApiConfig(
            source.api_config || source.apiConfig || source.api || {}
        );

        return {
            selectedMode,
            selectedProviderId,
            providers,
            apiConfig
        };
    },

    async getConfig() {
        const config = this._normalizeConfig(await this._readConfig());
        const outlookRecords = await this.outlookEmailService.readOutlookRecords();
        this.providers = config.providers;
        this.currentMode = config.selectedMode;
        this.currentProviderId = config.selectedProviderId;
        this.apiConfig = config.apiConfig;
        this.currentProvider = this.providers.find((item) => item.id === this.currentProviderId) || this.providers[0] || null;

        return {
            ...config,
            outlookAccounts: outlookRecords.outlook_accounts || [],
            state: this.getState()
        };
    },

    async saveConfig(payload = {}) {
        const source = payload && typeof payload === 'object' ? payload : {};
        const normalized = this._normalizeConfig({
            ...(await this.getConfig()),
            selected_mode: source.selectedMode || source.selected_mode || this.currentMode,
            selected_provider: source.selectedProviderId || source.selected_provider || this.currentProviderId,
            providers: source.providers || this.providers,
            api_config: source.apiConfig || source.api_config || this.apiConfig
        });

        const merged = await this._writeConfig({
            selected_mode: normalized.selectedMode,
            selected_provider: normalized.selectedProviderId,
            providers: normalized.providers,
            api_config: normalized.apiConfig
        });

        this.providers = normalized.providers;
        this.currentMode = normalized.selectedMode;
        this.currentProviderId = normalized.selectedProviderId;
        this.apiConfig = normalized.apiConfig;
        this.currentProvider = this.providers.find((item) => item.id === this.currentProviderId) || this.providers[0] || null;

        return {
            success: true,
            config: this._normalizeConfig(merged),
            state: this.getState()
        };
    },

    async saveProvider(providerData = {}) {
        const source = providerData && typeof providerData === 'object' ? providerData : {};
        const config = await this.getConfig();
        const providers = Array.isArray(config.providers) ? [...config.providers] : [];
        const originalId = sanitizeId(source.originalId || source.original_id || source.existingId || source.existing_id || source.id || '', '');
        const incomingName = String(source.name || source.siteName || '').trim();
        const incomingUrl = String(source.url || source.link || '').trim();
        if (!incomingName) {
            throw new Error('请填写临时邮箱站点名称');
        }
        if (!incomingUrl) {
            throw new Error('请填写临时邮箱站点网址');
        }

        const normalizedProvider = normalizeProvider({
            ...source,
            id: source.id || originalId || incomingName || incomingUrl
        }, providers.length);
        const nextId = ensureUniqueProviderId(providers, normalizedProvider.id, originalId);
        const provider = {
            ...normalizedProvider,
            id: nextId,
            name: incomingName || normalizedProvider.name,
            url: incomingUrl || normalizedProvider.url
        };

        const existingIndex = originalId
            ? providers.findIndex((item) => item.id === originalId)
            : providers.findIndex((item) => item.id === provider.id);

        if (existingIndex >= 0) {
            providers.splice(existingIndex, 1, provider);
        } else {
            providers.push(provider);
        }

        const result = await this.saveConfig({
            selectedMode: 'temp',
            selectedProviderId: provider.id,
            providers,
            apiConfig: this.apiConfig
        });

        this.currentProviderId = provider.id;
        this.currentProvider = provider;
        this.currentMode = 'temp';
        this._emitState({ reason: originalId ? 'provider-updated' : 'provider-added' });

        return {
            success: true,
            provider: { ...provider },
            state: result.state
        };
    },

    async deleteProvider(providerId = '') {
        const targetId = sanitizeId(providerId, '');
        if (!targetId) {
            throw new Error('请选择一个临时邮箱卡片');
        }

        const config = await this.getConfig();
        const providers = Array.isArray(config.providers) ? [...config.providers] : [];
        const targetIndex = providers.findIndex((item) => item.id === targetId);
        if (targetIndex < 0) {
            throw new Error('未找到临时邮箱卡片');
        }

        providers.splice(targetIndex, 1);
        const nextSelectedProviderId = providers.find((item) => item.id !== targetId)?.id || providers[0]?.id || '';
        const result = await this.saveConfig({
            selectedMode: 'temp',
            selectedProviderId: nextSelectedProviderId,
            providers,
            apiConfig: this.apiConfig
        });

        if (this.currentProviderId === targetId) {
            this.currentProviderId = nextSelectedProviderId;
            this.currentProvider = providers.find((item) => item.id === nextSelectedProviderId) || providers[0] || null;
        }

        this._emitState({ reason: 'provider-deleted' });

        return {
            success: true,
            deletedProviderId: targetId,
            state: result.state
        };
    },

    async importProviders(input = {}) {
        const source = Array.isArray(input) ? { providers: input } : (input && typeof input === 'object' ? input : {});
        const importedProviders = Array.isArray(source.providers)
            ? source.providers
            : source.id || source.name || source.url
                ? [source]
                : [];
        const normalizedImported = normalizeProviders(importedProviders);
        if (!normalizedImported.length) {
            throw new Error('导入文件中没有可用的临时邮箱站点');
        }

        const config = await this.getConfig();
        const providers = Array.isArray(config.providers) ? [...config.providers] : [];
        const providerMap = new Map(providers.map((item, index) => [item.id || `existing-${index}`, { ...item }]));

        for (const provider of normalizedImported) {
            const candidateId = sanitizeId(provider.id || provider.name || provider.url || '', '');
            const id = candidateId && providerMap.has(candidateId)
                ? candidateId
                : ensureUniqueProviderId(Array.from(providerMap.values()), candidateId || provider.name || provider.url || 'temp-email-provider');
            providerMap.set(id, {
                ...provider,
                id
            });
        }

        const mergedProviders = Array.from(providerMap.values());
        const selectedProviderId = sanitizeId(
            source.selected_provider || source.selectedProviderId || source.current_provider || source.currentProviderId || mergedProviders[0]?.id || '',
            mergedProviders[0]?.id || ''
        );

        const result = await this.saveConfig({
            selectedMode: 'temp',
            selectedProviderId,
            providers: mergedProviders,
            apiConfig: this.apiConfig
        });

        this._emitState({ reason: 'providers-imported' });

        return {
            success: true,
            count: normalizedImported.length,
            providers: mergedProviders.map((item) => ({ ...item })),
            state: result.state
        };
    },

    async setMode(mode = 'tcp') {
        const normalizedMode = String(mode || 'tcp').trim().toLowerCase();
        const nextMode = normalizedMode === 'outlook'
            ? 'outlook'
            : normalizedMode === 'temp'
            ? 'temp'
            : normalizedMode === 'api'
                ? 'api'
                : 'tcp';
        const result = await this.saveConfig({ selectedMode: nextMode });
        this._emitState({ reason: 'mode-changed' });
        return result;
    },

    async setApiConfig(apiConfig = {}) {
        const normalizedApiConfig = normalizeApiConfig(apiConfig);
        const result = await this.saveConfig({
            apiConfig: normalizedApiConfig,
            selectedMode: this.currentMode,
            selectedProviderId: this.currentProviderId,
            providers: this.providers
        });

        this.apiConfig = normalizedApiConfig;
        this._emitState({ reason: 'api-config-updated' });
        return {
            success: true,
            apiConfig: { ...normalizedApiConfig, endpoints: { ...normalizedApiConfig.endpoints } },
            state: result.state
        };
    },

    getApiConfig() {
        return {
            ...this.apiConfig,
            endpoints: { ...(this.apiConfig?.endpoints || DEFAULT_API_CONFIG.endpoints) }
        };
    },

    async setProvider(providerId = '') {
        const nextId = sanitizeId(providerId, '');
        if (!nextId) {
            throw new Error('请选择一个临时邮箱卡片');
        }

        const providers = this.providers.length > 0 ? this.providers : (await this.getConfig()).providers;
        const provider = providers.find((item) => item.id === nextId);
        if (!provider) {
            throw new Error('未找到临时邮箱卡片');
        }

        const result = await this.saveConfig({
            selectedMode: 'temp',
            selectedProviderId: nextId,
            providers
        });
        this._emitState({ reason: 'provider-changed' });
        return result;
    }
};
