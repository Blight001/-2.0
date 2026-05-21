const EventEmitter = require('events');

class StepSynchronizer extends EventEmitter {
    constructor(totalCount, logger) {
        super();
        this.totalCount = totalCount;
        this.activeThreads = totalCount;
        this.logger = logger;
        
        // Map<stepIndex, Array<resolve>>
        this.barriers = new Map();
        // Map<stepIndex, Set<threadId>>
        this.arrivedThreads = new Map();
    }

    async waitForStep(stepIndex, stepName, threadId, checkContinue = null, pollIntervalMs = 150) {
        // If only 1 (or 0) thread active, no need to wait
        if (this.activeThreads <= 1) return;

        if (!this.arrivedThreads.has(stepIndex)) {
            this.arrivedThreads.set(stepIndex, new Set());
        }
        
        const arrived = this.arrivedThreads.get(stepIndex);
        arrived.add(threadId);

        this.logger.debug(`[同步] 线程 ${threadId} 到达步骤 ${stepIndex} (${stepName}). 当前: ${arrived.size}/${this.activeThreads}`);

        // If all active threads arrived
        if (arrived.size >= this.activeThreads) {
            this.logger.info(`[同步] 步骤 ${stepIndex} (${stepName}) 所有线程已就绪，继续执行`);
            this._releaseBarrier(stepIndex);
            return;
        }

        // Wait
        return new Promise((resolve, reject) => {
            if (!this.barriers.has(stepIndex)) {
                this.barriers.set(stepIndex, []);
            }

            let released = false;
            const release = () => {
                if (released) {
                    return;
                }

                released = true;
                cleanup();
                resolve();
            };

            const cleanup = () => {
                if (intervalHandle) {
                    clearInterval(intervalHandle);
                }

                const waitingResolvers = this.barriers.get(stepIndex);
                if (!waitingResolvers) {
                    return;
                }

                const resolverIndex = waitingResolvers.indexOf(release);
                if (resolverIndex >= 0) {
                    waitingResolvers.splice(resolverIndex, 1);
                }

                if (waitingResolvers.length === 0) {
                    this.barriers.delete(stepIndex);
                }
            };

            this.barriers.get(stepIndex).push(release);

            let intervalHandle = null;
            if (typeof checkContinue === 'function') {
                intervalHandle = setInterval(() => {
                    let shouldContinue = true;
                    try {
                        shouldContinue = checkContinue() !== false;
                    } catch (_error) {
                        shouldContinue = false;
                    }

                    if (shouldContinue) {
                        return;
                    }

                    cleanup();
                    const arrivedThreads = this.arrivedThreads.get(stepIndex);
                    if (arrivedThreads) {
                        arrivedThreads.delete(threadId);
                    }
                    reject(new Error(`[同步] 步骤 ${stepIndex} (${stepName}) 等待已取消`));
                }, Math.max(50, pollIntervalMs));
            }
        });
    }

    _releaseBarrier(stepIndex) {
        if (this.barriers.has(stepIndex)) {
            const resolvers = this.barriers.get(stepIndex);
            this.barriers.delete(stepIndex);
            // Clear arrived set for this step (cleanup)
            this.arrivedThreads.delete(stepIndex);
            
            resolvers.forEach(resolve => resolve());
        }
    }

    notifyThreadFinished(threadId) {
        this.activeThreads--;
        this.logger.info(`[同步] 线程 ${threadId} 已结束. 剩余活动线程: ${this.activeThreads}`);
        
        // Check all existing barriers to see if we can release them now that count has dropped
        for (const [stepIndex, arrived] of this.arrivedThreads.entries()) {
            if (arrived.has(threadId)) {
                arrived.delete(threadId);
            }
            
            if (arrived.size >= this.activeThreads && this.activeThreads > 0) {
                this.logger.info(`[同步] 线程减少后，步骤 ${stepIndex} 满足条件，继续执行`);
                this._releaseBarrier(stepIndex);
            }
        }
        
        // If 0 or 1 thread left, release everything
        if (this.activeThreads <= 1) {
             for (const stepIndex of this.barriers.keys()) {
                 this._releaseBarrier(stepIndex);
             }
        }
    }
}

module.exports = StepSynchronizer;
