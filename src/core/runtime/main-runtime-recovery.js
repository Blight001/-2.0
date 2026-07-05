const StepSynchronizer = require('../infra/step-synchronizer');

module.exports = {
    getErrorText(error) {
        if (!error) {
            return '';
        }
        if (typeof error === 'string') {
            return error;
        }
        if (error instanceof Error) {
            return error.message || error.toString();
        }
        if (typeof error.message === 'string') {
            return error.message;
        }
        try {
            return JSON.stringify(error);
        } catch (jsonError) {
            return String(error);
        }
    },

    isProxyRelatedError(error) {
        const text = this.getErrorText(error).toLowerCase();
        if (!text) {
            return false;
        }

        const patterns = [
            /net::err_/i,
            /net::err_proxy_connection_failed/i,
            /net::err_tunnel_connection_failed/i,
            /net::err_timed_out/i,
            /err_connection/i,
            /econnreset/i,
            /econnrefused/i,
            /etimedout/i,
            /ehostunreach/i,
            /enetunreach/i,
            /eai_again/i,
            /socket hang up/i,
            /socket closed/i,
            /connection reset/i,
            /fetch failed/i,
            /proxy/i,
            /browser has been closed/i,
            /target closed/i,
            /page crashed/i,
            /网络错误/i,
            /连接超时/i,
            /无法连接/i,
            /代理.*失败/i
        ];

        return patterns.some(pattern => pattern.test(text));
    },

    async stopRunningTasksForRecovery() {
        for (const [taskId, task] of this.runningTasks) {
            try {
                task.stop('代理恢复前停止任务');
                this.logger.info(`代理恢复前停止任务: ${taskId}`);
            } catch (error) {
                this.logger.warning(`停止任务 ${taskId} 失败: ${error.message}`);
            }
        }

        this.runningTasks.clear();

        if (this.stepSynchronizer && typeof this.stepSynchronizer.reset === 'function') {
            try {
                this.stepSynchronizer.reset();
            } catch (error) {
                this.logger.debug(`重置同步器失败: ${error.message}`);
            }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
            const browserCount = this.browserManager.getBrowserCount();
            if (browserCount > 0) {
                this.logger.warning(`代理恢复前仍有 ${browserCount} 个浏览器实例未关闭，执行强制清理`);
                await this.browserManager.closeAll();
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            this.logger.warning(`代理恢复前清理浏览器失败: ${error.message}`);
        }
    },

    async getNextProxyNodeForRecovery() {
        this.clashManager.setLogger(this.logger);

        const status = await this.clashManager.getStatus();
        if (!status.success) {
            throw new Error(`获取Clash状态失败: ${status.error}`);
        }

        const profileUid = status.data.currentUid;
        if (!profileUid) {
            throw new Error('未找到当前订阅UID，无法切换节点');
        }

        const nodesResult = await this.clashManager.getProfileNodes(profileUid);
        if (!nodesResult.success) {
            throw new Error(`获取订阅节点失败: ${nodesResult.error}`);
        }

        const nodes = Array.isArray(nodesResult.nodes)
            ? [...new Set(nodesResult.nodes)].filter(name => name && !['DIRECT', 'REJECT', 'GLOBAL'].includes(name))
            : [];

        if (nodes.length < 2) {
            throw new Error('可用节点少于2个，无法自动切换');
        }

        const currentNode = status.data.currentNode || '';
        let nextIndex = nodes.indexOf(currentNode);

        if (nextIndex === -1) {
            nextIndex = 0;
        } else {
            nextIndex = (nextIndex + 1) % nodes.length;
        }

        if (nodes[nextIndex] === currentNode && nodes.length > 1) {
            nextIndex = (nextIndex + 1) % nodes.length;
        }

        return {
            profileUid,
            profileName: status.data.currentProfileName || '',
            currentNode,
            nextNode: nodes[nextIndex],
            nodes
        };
    },

    async recoverFromProxyError(taskId, error) {
        const errorText = this.getErrorText(error);

        if (!this.isLoopRunning && !this.isTimedRunning) {
            return false;
        }

        if (!this.isProxyRelatedError(errorText)) {
            return false;
        }

        if (this.proxyRecoveryState.active) {
            this.logger.warning(`任务 ${taskId} 命中代理错误，但恢复流程已在进行中`);
            return true;
        }

        if (this.proxyRecoveryState.attempts >= this.maxProxyRecoveryAttempts) {
            this.logger.error(`代理自动恢复已达到最大次数 ${this.maxProxyRecoveryAttempts}，停止自动切换`);
            this.isLoopRunning = false;
            this.isTimedRunning = false;
            if (this.timedRegistrationState) {
                this._clearTimedRegistrationTimers();
                this.timedRegistrationState.active = false;
                this.timedRegistrationState.stopRequested = true;
            }
            return false;
        }

        this.proxyRecoveryState.active = true;
        this.proxyRecoveryState.attempts += 1;

        try {
            this.logger.warning(`检测到疑似代理错误: ${errorText}`);
            this.logger.info(`开始第 ${this.proxyRecoveryState.attempts}/${this.maxProxyRecoveryAttempts} 次代理节点切换恢复`);

            await this.stopRunningTasksForRecovery();

            this.clashManager.setLogger(this.logger);
            const proxyEnabled = await this.clashManager.setSystemProxy(true, this.browserSettings || {});
            if (proxyEnabled) {
                this.logger.info('系统代理已开启，继续切换下一个节点');
            } else {
                this.logger.warning('系统代理开启失败，仍继续尝试切换下一个节点');
            }

            const target = await this.getNextProxyNodeForRecovery();
            this.logger.info(`准备切换节点: ${target.profileName || target.profileUid} - ${target.currentNode || '未知'} -> ${target.nextNode}`);

            const switchResult = await this.clashManager.switchNode(target.profileUid, target.nextNode);
            if (!switchResult.success) {
                throw new Error(switchResult.error || '切换节点失败');
            }

            this.logger.info(`代理节点切换成功: ${switchResult.data.profileName} -> ${switchResult.data.newNode}`);
            await new Promise(resolve => setTimeout(resolve, this.proxyRecoveryCooldownMs));

            if (this.isLoopRunning) {
                this.logger.info('代理恢复完成，重新启动注册循环');

                if (this.syncEnabled && this.concurrentCount > 1) {
                    this.stepSynchronizer = new StepSynchronizer(this.concurrentCount, this.logger);
                } else {
                    this.stepSynchronizer = null;
                }

                for (let i = 0; i < this.concurrentCount; i++) {
                    await this.startSingleRegistrationTask();
                }
            } else if (this.isTimedRunning && this.timedRegistrationState) {
                this.logger.info('代理恢复完成，定时执行将按原有延时策略继续');
            }

            return true;
        } catch (recoverError) {
            this.logger.error(`代理自动切换恢复失败: ${recoverError.message}`);
            this.isLoopRunning = false;
            this.isTimedRunning = false;
            if (this.timedRegistrationState) {
                this._clearTimedRegistrationTimers();
                this.timedRegistrationState.active = false;
                this.timedRegistrationState.stopRequested = true;
            }
            return false;
        } finally {
            this.proxyRecoveryState.active = false;
        }
    }
};
