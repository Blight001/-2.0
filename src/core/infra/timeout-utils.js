const MAX_TIMEOUT_DELAY_MS = 0x7fffffff;

function clearChunkedTimeout(timerRef) {
    if (!timerRef) {
        return;
    }

    if (typeof timerRef.cancel === 'function') {
        timerRef.cancel();
        return;
    }

    clearTimeout(timerRef);
}

function createChunkedTimeout(delayMs, callback) {
    let remainingMs = Math.max(0, Math.floor(Number(delayMs) || 0));
    let timerId = null;

    const scheduleNextChunk = () => {
        if (remainingMs <= 0) {
            callback();
            return;
        }

        const nextDelayMs = Math.min(remainingMs, MAX_TIMEOUT_DELAY_MS);
        timerId = setTimeout(() => {
            timerId = null;
            remainingMs -= nextDelayMs;
            scheduleNextChunk();
        }, nextDelayMs);

        if (timerId && typeof timerId.unref === 'function') {
            timerId.unref();
        }
    };

    scheduleNextChunk();

    return {
        cancel() {
            if (timerId) {
                clearTimeout(timerId);
                timerId = null;
            }
            remainingMs = 0;
        }
    };
}

module.exports = {
    MAX_TIMEOUT_DELAY_MS,
    clearChunkedTimeout,
    createChunkedTimeout
};
