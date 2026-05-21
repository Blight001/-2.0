const { DEFAULT_EMAIL_HOST, DEFAULT_EMAIL_SUFFIX, DEFAULT_EMAIL_PORT } = require('../email/email-defaults');

module.exports = function registerEmailHandlers({ app, ipcMain }) {
    ipcMain.handle('get-email-config', async () => {
        try {
            const emailConfig = typeof app.readEmailConfigFromDisk === 'function'
                ? await app.readEmailConfigFromDisk()
                : {
                    email_host: DEFAULT_EMAIL_HOST,
                    email_port: DEFAULT_EMAIL_PORT,
                    email_suffix: DEFAULT_EMAIL_SUFFIX
                };
            const emailHost = String(emailConfig.email_host || emailConfig.emailHost || DEFAULT_EMAIL_HOST).trim() || DEFAULT_EMAIL_HOST;
            const emailPort = Number.isFinite(Number(emailConfig.email_port ?? emailConfig.emailPort))
                ? Number(emailConfig.email_port ?? emailConfig.emailPort)
                : DEFAULT_EMAIL_PORT;
            const emailSuffix = String(emailConfig.email_suffix || emailConfig.emailSuffix || DEFAULT_EMAIL_SUFFIX).trim() || DEFAULT_EMAIL_SUFFIX;
            const emailRandomLength = Number.isFinite(Number(emailConfig.email_random_length))
                ? Number(emailConfig.email_random_length)
                : Number.isFinite(Number(emailConfig.emailRandomLength))
                    ? Number(emailConfig.emailRandomLength)
                    : 8;
            const emailRandomType = String(emailConfig.email_random_type || emailConfig.emailRandomType || 'lowercase').trim() || 'lowercase';

            return {
                success: true,
                ...emailConfig,
                email_host: emailHost,
                emailHost,
                email_port: emailPort,
                emailPort,
                email_suffix: emailSuffix,
                emailSuffix,
                email_random_length: emailRandomLength,
                emailRandomLength,
                email_random_type: emailRandomType === 'custom' ? 'lowercase' : emailRandomType,
                emailRandomType: emailRandomType === 'custom' ? 'lowercase' : emailRandomType
            };
        } catch (error) {
            app.logger.error(`获取邮箱配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('save-email-config', async (_event, payload = {}) => {
        try {
            const incoming = payload && typeof payload === 'object' ? payload : {};
            const saveResult = typeof app.saveEmailConfigToDisk === 'function'
                ? await app.saveEmailConfigToDisk(incoming)
                : { success: false, error: '邮箱配置保存接口不可用' };

            if (!saveResult || saveResult.success !== true) {
                return saveResult || { success: false, error: '邮箱配置保存失败' };
            }

            const emailHost = String(saveResult.config?.email_host || DEFAULT_EMAIL_HOST).trim() || DEFAULT_EMAIL_HOST;
            const emailPort = Number.isFinite(Number(saveResult.config?.email_port))
                ? Number(saveResult.config.email_port)
                : DEFAULT_EMAIL_PORT;
            const emailSuffix = String(saveResult.config?.email_suffix || saveResult.config?.emailSuffix || DEFAULT_EMAIL_SUFFIX).trim() || DEFAULT_EMAIL_SUFFIX;
            const emailRandomConfig = typeof app.getEmailRandomConfig === 'function'
                ? app.getEmailRandomConfig()
                : {
                    email: {
                        length: Number(saveResult.config?.email_random_length) || 8,
                        type: String(saveResult.config?.email_random_type || 'lowercase').trim() || 'lowercase'
                    }
                };

            if (app.emailClient) {
                app.emailClient.serverHost = emailHost;
                app.emailClient.serverPort = emailPort;
            }
            app.emailAddressSuffix = emailSuffix;
            app.emailRandomConfig = emailRandomConfig;

            return {
                success: true,
                email_host: emailHost,
                emailHost,
                email_port: emailPort,
                emailPort,
                email_suffix: emailSuffix,
                emailSuffix,
                email_random_length: Number(emailRandomConfig.email?.length) || 8,
                emailRandomLength: Number(emailRandomConfig.email?.length) || 8,
                email_random_type: String(emailRandomConfig.email?.type || 'lowercase').trim() || 'lowercase',
                emailRandomType: String(emailRandomConfig.email?.type || 'lowercase').trim() || 'lowercase',
                configPath: saveResult.configPath || ''
            };
        } catch (error) {
            app.logger.error(`保存邮箱配置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('email-connect', async (_event, payload = {}) => {
        try {
            const host = typeof payload.host === 'string' && payload.host.trim()
                ? payload.host.trim()
                : DEFAULT_EMAIL_HOST;
            const port = Number.parseInt(payload.port, 10);
            const resolvedPort = Number.isFinite(port) ? port : DEFAULT_EMAIL_PORT;

            if (typeof app.emailClient.setLogger === 'function') {
                app.emailClient.setLogger(app.logger);
            }

            app.emailClient.serverHost = host;
            app.emailClient.serverPort = resolvedPort;

            app.logger.info(`尝试连接邮箱: ${host}:${resolvedPort}`);
            await app.emailClient.connect();

            return {
                success: true,
                status: app.emailClient.getConnectionStatus()
            };
        } catch (error) {
            app.logger.error(`连接邮箱失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('email-disconnect', async () => {
        try {
            if (typeof app.emailClient.setLogger === 'function') {
                app.emailClient.setLogger(app.logger);
            }

            app.emailClient.disconnect();
            return {
                success: true,
                status: app.emailClient.getConnectionStatus()
            };
        } catch (error) {
            app.logger.error(`断开邮箱失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};
