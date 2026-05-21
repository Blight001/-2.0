module.exports = {
    async cleanupAndExit() {
        if (this.__cleanupAndExitInProgress) {
            return;
        }
        this.__cleanupAndExitInProgress = true;
        this.logger.info('应用程序关闭事件开始');

        const forceExitTimer = setTimeout(() => {
            this.logger.error('应用程序关闭超时，强制退出');
            const { app: electronApp } = require('electron');
            if (electronApp && typeof electronApp.exit === 'function') {
                electronApp.exit(0);
            } else if (typeof process !== 'undefined') {
                process.exit(0);
            }
        }, 15000);

        const withTimeout = async (promise, timeoutMs, timeoutMessage) => {
            let timer = null;
            try {
                return await Promise.race([
                    Promise.resolve(promise),
                    new Promise((_, reject) => {
                        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
                    })
                ]);
            } finally {
                if (timer) {
                    clearTimeout(timer);
                }
            }
        };

        try {
            if (typeof this.stopRegistrationTcpConnectionMonitor === 'function') {
                this.stopRegistrationTcpConnectionMonitor();
            }
            await withTimeout(this.stopRegistration({ closeBrowsers: false }), 10000, '停止注册流程超时');

            this.logger.info('开始关闭所有浏览器实例');
            await withTimeout(this.browserManager.closeAll(), 10000, '关闭浏览器实例超时');

            await new Promise(resolve => setTimeout(resolve, 1000));
            const finalCount = this.browserManager.getBrowserCount();
            if (finalCount > 0) {
                this.logger.error(`应用程序关闭时仍有 ${finalCount} 个浏览器实例未关闭`);
            } else {
                this.logger.info('所有浏览器实例已正确关闭');
            }

            if (this.webControlServer && typeof this.webControlServer.stop === 'function') {
                this.logger.info('开始关闭网页控制台服务');
                await withTimeout(this.webControlServer.stop(), 10000, '关闭网页控制台服务超时');
                this.logger.info('网页控制台服务已关闭');
            }

            this.logger.info('后台清理工作完成');
        } catch (error) {
            this.logger.error(`后台清理过程中发生错误: ${error.message}`);
        } finally {
            clearTimeout(forceExitTimer);

            const { app: electronApp } = require('electron');
            if (electronApp && typeof electronApp.exit === 'function') {
                electronApp.exit(0);
            } else if (electronApp && typeof electronApp.quit === 'function') {
                electronApp.quit();
            } else if (typeof process !== 'undefined') {
                process.exit(0);
            }
        }
    }
};
