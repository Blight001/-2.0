const path = require('path');

module.exports = function registerLogHandlers({ app, ipcMain, fs }) {
    ipcMain.handle('save-log', async (_event, { filename, content }) => {
        try {
            const logsDir = path.dirname(app.logger?.logFile || path.join(app.projectRoot, 'logs', 'placeholder.log'));
            await fs.ensureDir(logsDir);
            const filePath = path.join(logsDir, filename);
            await fs.writeFile(filePath, content, 'utf8');
            app.logger.info(`日志已保存: ${filePath}`);
            return { success: true, path: filePath };
        } catch (error) {
            app.logger.error(`保存日志失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};
