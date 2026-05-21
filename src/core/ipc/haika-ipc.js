module.exports = function registerHaikaHandlers({ app, ipcMain }) {
    ipcMain.handle('haika-list-categories', async () => {
        try {
            const haikaManager = await app.ensureHaikaManager();
            return await haikaManager.listCategories();
        } catch (error) {
            app.logger.error(`加载海卡分类失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('haika-load-keys', async (_event, categoryName) => {
        try {
            const haikaManager = await app.ensureHaikaManager();
            const keys = await haikaManager.loadCategoryKeys(categoryName);
            return { success: true, category: haikaManager.sanitizeCategoryName(categoryName), keys };
        } catch (error) {
            app.logger.error(`加载海卡卡密失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('haika-create-category', async (_event, categoryName) => {
        try {
            const haikaManager = await app.ensureHaikaManager();
            return await haikaManager.createCategory(categoryName);
        } catch (error) {
            app.logger.error(`创建海卡分类失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('haika-import-keys', async (_event, categoryName, importText) => {
        try {
            const haikaManager = await app.ensureHaikaManager();
            const targetCategory = haikaManager.sanitizeCategoryName(categoryName);
            const text = typeof importText === 'string' ? importText : '';

            if (!text.trim()) {
                return { success: false, error: '请先粘贴要导入的卡密内容' };
            }

            return await haikaManager.importKeysFromText(targetCategory, text);
        } catch (error) {
            app.logger.error(`导入海卡卡密失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};
