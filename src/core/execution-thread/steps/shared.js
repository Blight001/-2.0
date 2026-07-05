const http = require('http');
const https = require('https');

const BROWSER_CLOSED_PATTERNS = [
    /target page, context or browser has been closed/i,
    /target page, context .* has been closed/i,
    /target page has been closed/i,
    /browser has been closed/i,
    /target closed/i,
    /page closed/i,
    /page crashed/i,
    /context closed/i,
    /browser closed/i,
    /browser disconnected/i,
    /has been closed/i
];

function normalizePageMatchValue(value) {
    const text = String(value ?? '').trim();
    if (!text) {
        return '';
    }

    if (text === 'about:blank') {
        return text;
    }

    const stripped = text.replace(/[?#]+$/, '');
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(stripped)) {
        try {
            const parsed = new URL(stripped);
            const pathname = parsed.pathname || '/';
            return `${parsed.origin}${pathname}`;
        } catch (_error) {}
    }

    return stripped;
}

function pageUrlMatchesNeedle(pageUrl, needle) {
    const normalizedPageUrl = normalizePageMatchValue(pageUrl);
    const normalizedNeedle = normalizePageMatchValue(needle);
    if (!normalizedPageUrl || !normalizedNeedle) {
        return false;
    }

    return (
        normalizedPageUrl === normalizedNeedle
        || normalizedPageUrl.includes(normalizedNeedle)
        || normalizedNeedle.includes(normalizedPageUrl)
        || String(pageUrl || '').includes(String(needle || ''))
    );
}

function extractVerificationCode(rawText = '') {
    const text = String(rawText || '').trim();
    if (!text) {
        return '';
    }

    const noCodeHint = /暂无验证码|no|none|null|nil|empty|未获取到验证码/i.test(text);
    const stopWords = new Set([
        'your',
        'the',
        'and',
        'for',
        'from',
        'this',
        'that',
        'with',
        'code',
        'codes',
        'otp',
        'sms',
        'verification',
        'verify',
        'verifying',
        'is',
        'are',
        'was',
        'were',
        'be',
        'to',
        'of',
        'continue',
        'submit',
        'next',
        'send',
        'click',
        'open',
        'confirm',
        'ok',
        'done',
        'help',
        'identity',
        'login',
        'access',
        'security',
        'challenge',
        'welcome',
        'hello',
        'dear',
        'please',
        'thanks',
        'thank',
        'subject',
        'content',
        'message',
        'notification',
        'alert',
        'warning',
        'success',
        'failed',
        'available',
        'required',
        'temporary',
        'recovery',
        'reset',
        'password',
        'account',
        'email',
        'inbox',
        'sender',
        'recipient'
    ]);
    const contextKeywords = [
        'verification',
        'verify',
        'code',
        'otp',
        'token',
        'passcode',
        'security',
        'auth',
        'login',
        'signup',
        'register',
        'challenge',
        'confirm',
        'email',
        'mail',
        '验证码',
        '校验码',
        '确认码',
        '安全码',
        '动态码',
        '登录码',
        '临时码'
    ];
    const normalizeCandidate = (value) => {
        if (value === null || value === undefined) return '';
        const candidate = String(value).trim();
        if (!candidate) return '';
        if (stopWords.has(candidate.toLowerCase())) {
            return '';
        }
        const compact = candidate.replace(/\s+/g, '').toUpperCase();
        if (/^\d{4,8}$/.test(compact)) {
            return compact;
        }
        if (/^[A-Z0-9]{4,15}$/.test(compact) && /\d/.test(compact)) {
            return compact;
        }
        if (/^[A-Z]{4,6}$/.test(compact)) {
            return compact;
        }
        return '';
    };
    const hasVerificationContext = (candidate = '') => {
        const normalized = String(candidate || '').toLowerCase();
        if (!normalized) {
            return false;
        }

        return contextKeywords.some((keyword) => normalized.includes(keyword));
    };
    const isLikelyNotCode = (value) => {
        const candidate = String(value || '').trim();
        if (!candidate) return true;
        if (/(.)\1{3,}/.test(candidate)) return true;
        if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return true;
        if (/^\d{2}:\d{2}(:\d{2})?$/.test(candidate)) return true;
        if (/^\d+\.\d+\.\d+\.\d+$/.test(candidate)) return true;
        return false;
    };
    const isLikelyCalendarYear = (value) => {
        const candidate = String(value || '').trim();
        if (!/^\d{4}$/.test(candidate)) {
            return false;
        }

        const year = Number(candidate);
        return Number.isFinite(year) && year >= 1900 && year <= 2099;
    };
    const splitVerificationLines = (value = '') => String(value || '')
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter(Boolean);
    const hasCodeContextAroundText = (value = '', candidate = '') => {
        const normalizedText = String(value || '').toLowerCase();
        const normalizedCandidate = String(candidate || '').trim().toLowerCase();
        if (!normalizedText || !normalizedCandidate) {
            return false;
        }

        const candidateIndex = normalizedText.indexOf(normalizedCandidate);
        const windowText = candidateIndex >= 0
            ? normalizedText.slice(Math.max(0, candidateIndex - 40), candidateIndex + normalizedCandidate.length + 40)
            : normalizedText;

        return contextKeywords.some((keyword) => windowText.includes(keyword));
    };
    const extractCodeFromVerificationLine = (line = '') => {
        const candidate = String(line || '').trim();
        if (!candidate || !hasVerificationContext(candidate)) {
            return '';
        }

        const linePatterns = [
            /(?:your\s+)?(?:verification|confirmation|activation|security|authentication)\s+code\s*[:：]\s*([A-Z0-9]{4,15})/i,
            /(?:verification\s+code|verify\s+code|auth\s+code|security\s+code|access\s+code|authenticator\s+code)\s*[:：]\s*([A-Z0-9]{4,15})/i,
            /(?:验证码|验证代码|校验码|确认码|激活码|注册码|安全码|动态码)\s*[:：]\s*([A-Z0-9]{4,15})/i,
            /(?:your\s+)?(?:verification|confirmation|activation|security|authentication)\s+code\s+(?:is|:|：)\s*([A-Z0-9]{4,15})/i,
            /(?:验证码|验证代码|校验码|确认码|激活码|注册码|安全码|动态码)\s+(?:是|为|:|：)\s*([A-Z0-9]{4,15})/i
        ];

        for (const pattern of linePatterns) {
            const match = candidate.match(pattern);
            if (!match) {
                continue;
            }

            const code = normalizeCandidate(match[1]);
            if (code && !isLikelyNotCode(code) && (!isLikelyCalendarYear(code) || /[A-Z]/.test(code))) {
                return code;
            }
        }

        return '';
    };
    const isLikelyCodePromptLine = (line = '') => {
        const candidate = String(line || '').trim();
        if (!candidate || !hasVerificationContext(candidate)) {
            return false;
        }

        return (
            /(?:verification|confirmation|activation|security|authentication)\s+code\b/i.test(candidate)
            || /(?:verification\s+code|verify\s+code|auth\s+code|security\s+code|access\s+code|authenticator\s+code)\s*[:：]?\s*$/i.test(candidate)
            || /(?:your\s+)?(?:verification|confirmation|activation|security|authentication)\s+code(?:\s+is)?\s*[:：]?\s*$/i.test(candidate)
            || /(?:your\s+code(?:\s+is)?\s*[:：]?\s*)$/i.test(candidate)
            || /(?:code|otp|token|passcode)(?:\s+is)?\s*[:：]?\s*$/i.test(candidate)
        );
    };
    const patterns = [
        /([A-Z0-9]{3,4})[-\s]\s*([A-Z0-9]{3,4})[-\s]\s*([A-Z0-9]{3,4})/,
        /(?:verification\s+code|verify\s+code|auth\s+code|security\s+code|access\s+code|authenticator\s+code)[:：]?\s*([A-Z0-9]{4,15})/i,
        /(?:验证码|验证代码|校验码|确认码|激活码|注册码|安全码|动态码)[:：]?\s*([A-Z0-9]{4,15})/i,
        /(?:your\s+)?(?:verification|confirmation|activation|security|authentication)\s+code\s+(?:is|[:：])\s*([A-Z0-9]{4,15})/i,
        /(?:邮箱|email)(?:验证|验证码|确认码|安全码)[:：]?\s*([A-Z0-9]{4,15})/i,
        /email\s+(?:verification|confirmation|security)\s+code[:：]?\s*([A-Z0-9]{4,15})/i,
        /(?:code|pin|otp|token|passcode)[:：]?\s*([0-9]{4,8})/i,
        /(?:验证码|PIN码|动态码|短信码|数字码)[:：]?\s*([0-9]{4,8})/i,
        /(?:verification|security|auth|login)\s+code[:：]?\s*([0-9]{4,8})/i,
        /(?:验证|安全|认证|登录)\s*码[:：]?\s*([0-9]{4,8})/i,
        /(?:one-time\s+password|temporary\s+code)[:：]?\s*([A-Z0-9]{4,15})/i,
        /(?:一次性密码|临时码|临时验证码)[:：]?\s*([A-Z0-9]{4,15})/i,
        /(?:login|sign\s+in|signin)\s+code[:：]?\s*([A-Z0-9]{4,15})/i,
        /(?:登录|登入|登录码)[:：]?\s*([A-Z0-9]{4,15})/i,
        /(?:password\s+reset|reset\s+code|recovery\s+code)[:：]?\s*([A-Z0-9]{4,15})/i,
        /(?:密码重置|重置码|恢复码)[:：]?\s*([A-Z0-9]{4,15})/i
    ];

    try {
        const rawLines = String(text || '')
            .split(/[\r\n]+/)
            .map((line) => line.trim())
            .filter(Boolean);
        const normalized = String(text || '')
            .replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p\s*>/gi, '\n')
            .replace(/<\/div\s*>/gi, '\n')
            .replace(/<\/h[1-6]\s*>/gi, '\n')
            .replace(/<\/li\s*>/gi, '\n')
            .replace(/<\/tr\s*>/gi, '\n')
            .replace(/<\/table\s*>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\s+/g, ' ')
            .trim();

        for (const line of rawLines) {
            const lineCode = extractCodeFromVerificationLine(line);
            if (lineCode) {
                return lineCode;
            }
        }

        for (let index = 0; index < rawLines.length; index += 1) {
            const currentLine = rawLines[index];
            const previousLine = index > 0 ? rawLines[index - 1] : '';
            const currentCandidate = normalizeCandidate(currentLine);
            if (
                currentCandidate
                && isLikelyCodePromptLine(previousLine)
                && !isLikelyNotCode(currentCandidate)
                && (!isLikelyCalendarYear(currentCandidate) || /[A-Z]/.test(currentCandidate))
            ) {
                return currentCandidate;
            }
        }

        const exactCandidate = normalizeCandidate(normalized);
        if (
            exactCandidate
            && !isLikelyNotCode(exactCandidate)
            && (
                (/\d/.test(exactCandidate) && !isLikelyCalendarYear(exactCandidate))
                || hasCodeContextAroundText(normalized, exactCandidate)
            )
        ) {
            return exactCandidate;
        }

        for (const pattern of patterns) {
            const matches = normalized.match(pattern);
            if (!matches) {
                continue;
            }

            const joined = matches.slice(1).filter(Boolean).join('').replace(/[-_\s]/g, '');
            const code = normalizeCandidate(joined);
            if (code && !isLikelyNotCode(code)) {
                return code;
            }
        }

        if (!noCodeHint) {
            const fallbackMatches = normalized.match(/\b[A-Z0-9]{4,15}\b/gi) || [];
            fallbackMatches.sort((left, right) => {
                const leftNumeric = /^\d+$/.test(left) ? 1 : 0;
                const rightNumeric = /^\d+$/.test(right) ? 1 : 0;
                if (leftNumeric !== rightNumeric) {
                    return rightNumeric - leftNumeric;
                }

                const leftMixed = /\d/.test(left) ? 1 : 0;
                const rightMixed = /\d/.test(right) ? 1 : 0;
                if (leftMixed !== rightMixed) {
                    return rightMixed - leftMixed;
                }

            return right.length - left.length;
        });
        for (const line of rawLines) {
            if (!hasVerificationContext(line)) {
                continue;
            }

                const lineExact = normalizeCandidate(line);
                if (lineExact && !isLikelyNotCode(lineExact) && (!isLikelyCalendarYear(lineExact) || hasVerificationContext(line))) {
                    return lineExact;
                }

                const lineMatches = line.match(/\b[A-Z0-9]{4,15}\b/gi) || [];
                lineMatches.sort((left, right) => {
                    const leftNumeric = /^\d+$/.test(left) ? 1 : 0;
                    const rightNumeric = /^\d+$/.test(right) ? 1 : 0;
                    if (leftNumeric !== rightNumeric) {
                        return rightNumeric - leftNumeric;
                    }

                    const leftMixed = /\d/.test(left) ? 1 : 0;
                    const rightMixed = /\d/.test(right) ? 1 : 0;
                    if (leftMixed !== rightMixed) {
                        return rightMixed - leftMixed;
                    }

                    return right.length - left.length;
                });

                for (const token of lineMatches) {
                    const code = normalizeCandidate(token);
                    if (code && !isLikelyNotCode(code) && /\d/.test(code)) {
                        return code;
                    }
                }
            }
        }
    } catch (_error) {
        return '';
    }

    return '';
}

function fetchHaikaSmsCodeFromUrl(smsApiUrl, timeoutMs = 10000) {
    return new Promise((resolve) => {
        let targetUrl;
        try {
            targetUrl = new URL(smsApiUrl);
        } catch (error) {
            resolve({ success: false, error: `无效的验证码接口地址: ${error.message}` });
            return;
        }

        const transport = targetUrl.protocol === 'https:' ? https : http;

        const options = {
            protocol: targetUrl.protocol,
            hostname: targetUrl.hostname,
            port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
            path: `${targetUrl.pathname}${targetUrl.search}`,
            method: 'GET',
            timeout: timeoutMs,
            headers: {
                'User-Agent': 'AI-Automation-Tool-2.0'
            }
        };

        const req = transport.request(options, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    resolve({ success: false, error: `验证码接口返回状态码 ${res.statusCode}` });
                    return;
                }

                const code = extractVerificationCode(data);
                if (!code) {
                    resolve({ success: false, error: '未在验证码接口响应中找到有效验证码' });
                    return;
                }

                resolve({ success: true, code, raw: data });
            });
        });

        req.on('error', (error) => {
            resolve({ success: false, error: error.message });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, error: '验证码接口请求超时' });
        });

        req.end();
    });
}

module.exports = {
    normalizePageMatchValue,
    pageUrlMatchesNeedle,
    _getErrorText(error) {
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
        } catch (_jsonError) {
            return String(error);
        }
    },

    _isBrowserClosedError(error) {
        const text = this._getErrorText(error).trim();
        if (!text) {
            return false;
        }

        return BROWSER_CLOSED_PATTERNS.some(pattern => pattern.test(text));
    },

    _markTaskStopped(reason = '', options = {}) {
        const normalizedReason = String(reason || '').trim() || this.stopReason || '任务已停止';
        const silent = options.silent === true;
        const replaceReason = options.replaceReason === true;

        if (!this.stopReason || replaceReason) {
            this.stopReason = normalizedReason;
        }

        this.running = false;
        if (typeof this._cancelDebugWaiters === 'function') {
            this._cancelDebugWaiters(normalizedReason);
        }

        if (!silent && this.logger && typeof this.logger.info === 'function') {
            const logMessage = `停止任务: ${this.taskId}${this.stopReason ? ` (${this.stopReason})` : ''}`;
            if (this._lastStopLogMessage !== logMessage) {
                this._lastStopLogMessage = logMessage;
                this.logger.info(logMessage);
            }
        }

        return this.stopReason;
    },

    _markBrowserClosed(reason = '浏览器已关闭，任务已终止', options = {}) {
        const normalizedReason = String(reason || '').trim() || '浏览器已关闭，任务已终止';
        this.browserClosed = true;

        if (!this.stopReason || options.replaceReason === true) {
            this.stopReason = normalizedReason;
        }

        this.running = false;
        if (typeof this._cancelDebugWaiters === 'function') {
            this._cancelDebugWaiters(normalizedReason);
        }

        if (options.silent !== true && this.logger && typeof this.logger.warning === 'function') {
            if (this._lastBrowserClosedLog !== normalizedReason) {
                this._lastBrowserClosedLog = normalizedReason;
                this.logger.warning(normalizedReason);
            }
        }

        return this.stopReason;
    },

    _cancelDebugWaiters(reason = '任务已停止') {
        const normalizedReason = String(reason || '').trim() || this.stopReason || '任务已停止';
        const cancellation = {
            success: false,
            cancelled: true,
            reason: normalizedReason
        };

        const pauseResolver = this._debugPauseResolver;
        this._debugPauseResolver = null;
        this._debugPausePromise = null;

        const runModeResolver = this._debugRunModeResolver;
        this._debugRunModeResolver = null;
        this._debugRunModePromise = null;

        if (typeof pauseResolver === 'function') {
            try {
                pauseResolver(cancellation);
            } catch (_error) {}
        }

        if (typeof runModeResolver === 'function') {
            try {
                runModeResolver(cancellation);
            } catch (_error) {}
        }

        return cancellation;
    },

    _normalizeRuntimeError(error, context = '') {
        const rawMessage = this._getErrorText(error).trim();
        const fallbackMessage = context ? `${context}失败` : '执行失败';

        if (!this.running && this.stopReason) {
            return new Error(this.stopReason);
        }

        if (this._isBrowserClosedError(error)) {
            const reason = this.stopReason || '浏览器已关闭，任务已终止';
            this._markBrowserClosed(reason, { silent: true });
            return new Error(this.stopReason || reason);
        }

        if (error instanceof Error) {
            return error;
        }

        return new Error(rawMessage || fallbackMessage);
    },

    _getDebugState() {
        const state = this.debugState && typeof this.debugState === 'object' ? this.debugState : {};
        return {
            active: state.active === true,
            paused: state.paused === true,
            pauseRequested: state.pauseRequested === true,
            awaitingRunMode: state.awaitingRunMode === true,
            runMode: String(state.runMode || '').trim(),
            pauseReason: String(state.pauseReason || '').trim(),
            currentStepName: String(state.currentStepName || '').trim(),
            currentStepIndex: Number.isFinite(Number(state.currentStepIndex)) ? Number(state.currentStepIndex) : -1,
            totalSteps: Number.isFinite(Number(state.totalSteps)) ? Math.max(0, Number(state.totalSteps)) : 0,
            progress: Number.isFinite(Number(state.progress)) ? Math.max(0, Math.min(100, Number(state.progress))) : 0,
            message: String(state.message || '').trim(),
            statusText: String(state.statusText || '').trim() || '未开始',
            canPause: state.canPause !== false,
            canResume: state.canResume === true,
            completed: state.completed === true,
            error: String(state.error || '').trim()
        };
    },

    _emitDebugState(patch = {}) {
        const current = this._getDebugState();
        const next = {
            ...current,
            ...patch
        };

        next.active = next.active === true;
        next.paused = next.paused === true;
        next.pauseRequested = next.pauseRequested === true;
        next.awaitingRunMode = next.awaitingRunMode === true;
        next.runMode = String(next.runMode || '').trim();
        next.pauseReason = String(next.pauseReason || '').trim();
        next.currentStepName = String(next.currentStepName || '').trim();
        next.currentStepIndex = Number.isFinite(Number(next.currentStepIndex)) ? Number(next.currentStepIndex) : -1;
        next.totalSteps = Number.isFinite(Number(next.totalSteps)) ? Math.max(0, Number(next.totalSteps)) : 0;
        next.progress = Number.isFinite(Number(next.progress)) ? Math.max(0, Math.min(100, Number(next.progress))) : 0;
        next.message = String(next.message || '').trim();
        next.statusText = String(next.statusText || '').trim() || '未开始';
        next.canPause = next.canPause !== false;
        next.canResume = next.canResume === true;
        next.completed = next.completed === true;
        next.error = String(next.error || '').trim();
        next.failedStepError = String(next.failedStepError || '').trim();
        next.completedStepIndex = Number.isFinite(Number(next.completedStepIndex)) ? Number(next.completedStepIndex) : -1;

        this.debugState = next;
        if (typeof this.emit === 'function') {
            this.emit('debug-state', { ...next });
        }
        return next;
    },

    _setDebugRunMode(mode = '') {
        const normalizedMode = String(mode || '').trim().toLowerCase();
        if (!['loop', 'step', 'step-by-step', 'step_by_step', 'single', 'manual'].includes(normalizedMode)) {
            return { success: false, error: '不支持的调试运行模式' };
        }

        const resolvedMode = (normalizedMode === 'loop') ? 'loop' : 'step';
        this.debugStepPauseMs = resolvedMode === 'step'
            ? (Number.isFinite(Number(this.debugDefaultStepPauseMs)) ? Math.max(0, Number(this.debugDefaultStepPauseMs)) : Math.max(0, Number(this.debugStepPauseMs) || 0))
            : 0;

        const resolver = this._debugRunModeResolver;
        this._debugRunModeResolver = null;
        this._debugRunModePromise = null;

        this._emitDebugState({
            active: true,
            awaitingRunMode: false,
            runMode: resolvedMode,
            paused: false,
            pauseRequested: false,
            pauseReason: '',
            statusText: resolvedMode === 'loop' ? '循环运行' : '逐步运行',
            message: resolvedMode === 'loop' ? '已选择循环运行' : '已选择逐步运行',
            canPause: true,
            canResume: false
        });

        if (typeof resolver === 'function') {
            try {
                resolver({ success: true, runMode: resolvedMode });
            } catch (_error) {}
        }

        return { success: true, runMode: resolvedMode };
    },

    _setDebugContinueMode(mode = '') {
        const resolvedMode = 'step';
        const defaultStepPauseMs = Number.isFinite(Number(this.debugDefaultStepPauseMs))
            ? Math.max(0, Number(this.debugDefaultStepPauseMs))
            : 1200;

        this.debugStepPauseMs = defaultStepPauseMs > 0 ? defaultStepPauseMs : 1200;

        this._emitDebugState({
            active: this.debugState?.active === true || this.running === true,
            runMode: resolvedMode,
            statusText: '单步继续',
            message: '已切换为单步继续',
            canPause: true,
            canResume: this.debugState?.paused === true || this.debugState?.pauseRequested === true
        });

        return {
            success: true,
            runMode: resolvedMode,
            debugStepPauseMs: this.debugStepPauseMs
        };
    },

    _setDebugStepNavigation(direction = '') {
        const normalizedDirection = String(direction || '').trim().toLowerCase();
        const currentIndex = Number.isFinite(Number(this.debugState?.currentStepIndex))
            ? Number(this.debugState.currentStepIndex)
            : -1;
        const totalSteps = Number.isFinite(Number(this.debugState?.totalSteps))
            ? Math.max(0, Number(this.debugState.totalSteps))
            : 0;

        if (currentIndex < 0 || totalSteps <= 0) {
            return { success: false, error: '当前没有可跳转的调试步骤' };
        }

        const delta = normalizedDirection === 'previous' || normalizedDirection === 'prev' || normalizedDirection === 'back'
            ? -1
            : 1;
        const targetStepIndex = Math.max(0, Math.min(totalSteps - 1, currentIndex + delta));
        this._debugTargetStepIndex = targetStepIndex;
        this.debugStepPauseMs = Number.isFinite(Number(this.debugDefaultStepPauseMs))
            ? Math.max(1, Number(this.debugDefaultStepPauseMs))
            : Math.max(1, Number(this.debugStepPauseMs) || 1200);

        const label = delta < 0 ? '上一步' : '下一步';
        const currentCompletedStepIndex = Number.isFinite(Number(this.debugState?.completedStepIndex))
            ? Number(this.debugState.completedStepIndex)
            : -1;
        this._emitDebugState({
            active: true,
            paused: true,
            pauseRequested: false,
            pauseReason: 'manual',
            currentStepIndex: targetStepIndex,
            completedStepIndex: Math.min(currentCompletedStepIndex, targetStepIndex - 1),
            progress: targetStepIndex > currentIndex
                ? Math.max(0, Math.min(100, Number(this.debugState?.progress) || 0))
                : 0,
            message: `已选择${label}，点击继续后执行`,
            statusText: `已选择${label}，等待继续`,
            canPause: false,
            canResume: true,
            error: '',
            failedStepError: ''
        });

        return { success: true, targetStepIndex };
    },

    async _waitForDebugRunModeSelection(context = '') {
        if (this.debugMode !== true) {
            return { success: true, runMode: 'loop', skipped: true };
        }

        if (!this.running) {
            return { success: false, cancelled: true, reason: this.stopReason || '任务已停止' };
        }

        const currentMode = String(this.debugState?.runMode || '').trim();
        if (currentMode === 'loop' || currentMode === 'step') {
            return { success: true, runMode: currentMode, skipped: true };
        }

        this._emitDebugState({
            active: true,
            awaitingRunMode: true,
            paused: false,
            pauseRequested: false,
            runMode: '',
            currentStepName: '',
            currentStepIndex: -1,
            progress: 0,
            message: '等待选择运行模式',
            statusText: '等待选择运行模式',
            canPause: false,
            canResume: false
        });

        if (!this._debugRunModePromise) {
            this._debugRunModePromise = new Promise(resolve => {
                this._debugRunModeResolver = resolve;
            });
        }

        const waitResult = await this._debugRunModePromise;
        if (context && this.logger && typeof this.logger.info === 'function') {
            this.logger.info(`调试运行模式已选择: ${context}`);
        }
        return waitResult || { success: true, runMode: String(this.debugState?.runMode || 'loop').trim() || 'loop' };
    },

    _requestDebugPause(reason = 'manual', meta = {}) {
        const normalizedReason = String(reason || '').trim() || 'manual';
        const patch = {
            pauseRequested: true,
            pauseReason: normalizedReason,
            statusText: normalizedReason === 'manual' ? '请求暂停中' : '准备暂停',
            canPause: false,
            canResume: false,
            ...meta
        };
        this._emitDebugState(patch);
        return { success: true, paused: this.debugState?.paused === true || this.debugState?.pauseRequested === true };
    },

    _resumeDebug(reason = 'manual') {
        const resolver = this._debugPauseResolver;
        this._debugPauseResolver = null;
        this._debugPausePromise = null;
        this._debugCardConfigRefreshPending = true;
        const targetStepIndex = Number.isFinite(Number(this._debugTargetStepIndex))
            ? Number(this._debugTargetStepIndex)
            : undefined;
        this._debugTargetStepIndex = undefined;
        this._emitDebugState({
            paused: false,
            pauseRequested: false,
            pauseReason: '',
            statusText: String(reason || '').trim() === 'manual' ? '继续执行中' : '继续执行中',
            canPause: true,
            canResume: false,
            error: '',
            failedStepError: ''
        });

        if (typeof resolver === 'function') {
            try {
                resolver({ success: true, resumed: true, targetStepIndex });
            } catch (_error) {}
        }

        return { success: true, targetStepIndex };
    },

    async _waitForDebugResume(context = '') {
        if (this.debugState?.paused !== true) {
            return { success: true, resumed: true, skipped: true };
        }

        if (!this.running) {
            return { success: false, cancelled: true, reason: this.stopReason || '任务已停止' };
        }

        if (!this._debugPausePromise) {
            this._debugPausePromise = new Promise(resolve => {
                this._debugPauseResolver = resolve;
            });
        }

        const waitResult = await this._debugPausePromise;
        if (context && this.logger && typeof this.logger.info === 'function') {
            this.logger.info(`调试继续: ${context}`);
        }
        return waitResult || { success: true, resumed: true };
    },

    async _enterDebugPause(options = {}) {
        const reason = String(options.reason || 'manual').trim() || 'manual';
        const stepName = String(options.stepName || options.currentStepName || '').trim();
        const message = String(options.message || '').trim();
        const stepIndex = Number.isFinite(Number(options.stepIndex)) ? Number(options.stepIndex) : (Number.isFinite(Number(this.debugState?.currentStepIndex)) ? Number(this.debugState.currentStepIndex) : -1);
        const progress = Number.isFinite(Number(options.progress)) ? Number(options.progress) : (Number.isFinite(Number(this.debugState?.progress)) ? Number(this.debugState.progress) : 0);
        const completedStepIndex = Number.isFinite(Number(options.completedStepIndex))
            ? Number(options.completedStepIndex)
            : (Number.isFinite(Number(this.debugState?.completedStepIndex)) ? Number(this.debugState.completedStepIndex) : -1);
        const failedStepError = String(options.failedStepError || '').trim();
        const errorText = String(options.error || '').trim();

        if (!this.running) {
            return { success: false, cancelled: true, reason: this.stopReason || '任务已停止' };
        }

        if (this.debugState?.paused === true && this._debugPausePromise) {
            this._emitDebugState({
                pauseReason: reason,
                currentStepName: stepName || this.debugState.currentStepName || '',
                currentStepIndex: stepIndex,
                progress,
                message: message || this.debugState.message || '',
                statusText: reason === 'error' ? '错误暂停，等待修改后继续' : '已暂停，等待继续',
                completedStepIndex,
                failedStepError,
                error: errorText
            });
            return this._debugPausePromise;
        }

        this._emitDebugState({
            active: true,
            paused: true,
            pauseRequested: false,
            pauseReason: reason,
            currentStepName: stepName || this.debugState?.currentStepName || '',
            currentStepIndex: stepIndex,
            progress,
            message,
            statusText: reason === 'error' ? '错误暂停，等待修改后继续' : '已暂停，等待继续',
            canPause: false,
            canResume: true,
            completedStepIndex,
            failedStepError,
            error: errorText
        });

        if (!this._debugPausePromise) {
            this._debugPausePromise = new Promise(resolve => {
                this._debugPauseResolver = resolve;
            });
        }

        return this._debugPausePromise;
    },

    async _ensureBrowserAvailable(context = '') {
        if (!this.running) {
            throw new Error(this.stopReason || '任务已停止');
        }

        const isBridgeMode = typeof this._isBrowserBridgeMode === 'function'
            ? this._isBrowserBridgeMode(this.browserId)
            : String(this.browserType || '').trim().toLowerCase() === 'plugin-browser';

        if (isBridgeMode) {
            const session = typeof this._getBrowserBridgeSession === 'function'
                ? this._getBrowserBridgeSession(this.browserId)
                : null;
            if (!session || session.connected !== true) {
                throw new Error(this.stopReason || '插件浏览器会话未连接');
            }
            return session;
        }

        if (!this.browserId || !this.browserManager || typeof this.browserManager.getBrowserData !== 'function') {
            throw new Error(this.stopReason || '浏览器实例未初始化');
        }

        const browserData = this.browserManager.getBrowserData(this.browserId);
        const contextPrefix = context ? `${context}: ` : '';

        if (!browserData) {
            const reason = `${contextPrefix}浏览器实例已关闭，任务已终止`;
            this._markBrowserClosed(reason, { silent: true, replaceReason: true });
            throw new Error(this.stopReason);
        }

        if (browserData.browser && typeof browserData.browser.isConnected === 'function' && !browserData.browser.isConnected()) {
            const reason = `${contextPrefix}浏览器实例已断开，任务已终止`;
            this._markBrowserClosed(reason, { silent: true, replaceReason: true });
            throw new Error(this.stopReason);
        }

        let openPages = [];
        try {
            if (browserData.context && typeof browserData.context.pages === 'function') {
                openPages = browserData.context.pages().filter(page => {
                    try {
                        return page && typeof page.isClosed === 'function' ? !page.isClosed() : !!page;
                    } catch (_error) {
                        return false;
                    }
                });
            }
        } catch (_error) {
            openPages = [];
        }

        if (browserData.page && typeof browserData.page.isClosed === 'function' && !browserData.page.isClosed()) {
            return browserData.page;
        }

        if (openPages.length > 0) {
            const nextPage = [...openPages].reverse().find(Boolean) || openPages[0];
            if (nextPage && typeof this.browserManager.setBrowserPage === 'function') {
                await this.browserManager.setBrowserPage(this.browserId, nextPage).catch(() => {});
            }
            return nextPage;
        }

        const reason = `${contextPrefix}浏览器页面已关闭，任务已终止`;
        this._markBrowserClosed(reason, { silent: true, replaceReason: true });
        throw new Error(this.stopReason);
    },

    async _sleepInterruptibly(ms, context = '', intervalMs = 100) {
        const durationMs = Math.max(0, parseInt(ms, 10) || 0);
        const probeContext = context || '等待中';

        if (durationMs <= 0) {
            if (this.browserId) {
                await this._ensureBrowserAvailable(probeContext);
            } else if (!this.running) {
                throw new Error(this.stopReason || '任务已停止');
            }
            return;
        }

        let remainingMs = durationMs;
        const pollIntervalMs = Math.max(25, parseInt(intervalMs, 10) || 100);

        while (remainingMs > 0) {
            if (!this.running) {
                throw new Error(this.stopReason || '任务已停止');
            }

            if (this.browserId) {
                await this._ensureBrowserAvailable(probeContext);
            }

            if (this.debugMode === true) {
                if (this.debugState?.paused === true) {
                    await this._waitForDebugResume(probeContext);
                    continue;
                }

                if (this.debugState?.pauseRequested === true) {
                    await this._enterDebugPause({
                        reason: this.debugState.pauseReason || 'manual',
                        stepName: probeContext,
                        message: this.debugState.message || probeContext
                    });
                    continue;
                }
            }

            const sleepMs = Math.min(pollIntervalMs, remainingMs);
            await new Promise(resolve => setTimeout(resolve, sleepMs));
            remainingMs -= sleepMs;
        }

        if (this.browserId) {
            await this._ensureBrowserAvailable(probeContext);
        } else if (!this.running) {
            throw new Error(this.stopReason || '任务已停止');
        }
    },

    async _bindBrowserLifecycle() {
        const isBridgeMode = typeof this._isBrowserBridgeMode === 'function'
            ? this._isBrowserBridgeMode(this.browserId)
            : String(this.browserType || '').trim().toLowerCase() === 'plugin-browser';

        if (isBridgeMode || this._browserLifecycleBound || !this.browserId || !this.browserManager || typeof this.browserManager.getBrowserData !== 'function') {
            return false;
        }

        const browserData = this.browserManager.getBrowserData(this.browserId);
        if (!browserData) {
            return false;
        }

        this._browserLifecycleBound = true;
        this._browserLifecycleCleanup = Array.isArray(this._browserLifecycleCleanup) ? this._browserLifecycleCleanup : [];
        this._boundBrowserPages = this._boundBrowserPages || new WeakSet();

        const pushCleanup = (target, eventName, handler) => {
            if (!target || typeof target.on !== 'function') {
                return;
            }

            target.on(eventName, handler);
            this._browserLifecycleCleanup.push(() => {
                if (typeof target.off === 'function') {
                    target.off(eventName, handler);
                } else if (typeof target.removeListener === 'function') {
                    target.removeListener(eventName, handler);
                }
            });
        };

        const notifyBrowserUnavailable = (reason) => {
            if (this._finalizing) {
                return;
            }

            const normalizedReason = String(reason || '').trim() || '浏览器已关闭，任务已终止';
            this._markBrowserClosed(normalizedReason, { silent: true, replaceReason: true });
            if (this.logger && typeof this.logger.warning === 'function' && this._lastBrowserClosedLog !== normalizedReason) {
                this._lastBrowserClosedLog = normalizedReason;
                this.logger.warning(normalizedReason);
            }
        };

        const inspectPagesAfterClose = () => {
            if (this._finalizing) {
                return;
            }

            setTimeout(() => {
                this._ensureBrowserAvailable('浏览器页面关闭')
                    .catch(error => {
                        const normalized = this._normalizeRuntimeError(error, '浏览器页面关闭');
                        notifyBrowserUnavailable(normalized.message);
                    });
            }, 0);
        };

        const bindPageClose = (page) => {
            if (!page || typeof page.on !== 'function' || this._boundBrowserPages.has(page)) {
                return;
            }

            this._boundBrowserPages.add(page);
            pushCleanup(page, 'close', inspectPagesAfterClose);
        };

        pushCleanup(browserData.browser, 'disconnected', () => {
            notifyBrowserUnavailable('浏览器实例已关闭，任务已终止');
        });
        pushCleanup(browserData.context, 'close', () => {
            notifyBrowserUnavailable('浏览器上下文已关闭，任务已终止');
        });
        pushCleanup(browserData.context, 'page', (page) => {
            bindPageClose(page);
        });

        try {
            const existingPages = browserData.context && typeof browserData.context.pages === 'function'
                ? browserData.context.pages()
                : [];
            for (const page of existingPages) {
                bindPageClose(page);
            }
        } catch (_error) {}

        return true;
    },

    _cleanupBrowserLifecycle() {
        const cleanups = Array.isArray(this._browserLifecycleCleanup) ? [...this._browserLifecycleCleanup] : [];
        this._browserLifecycleCleanup = [];
        this._browserLifecycleBound = false;

        for (const cleanup of cleanups.reverse()) {
            try {
                cleanup();
            } catch (_error) {}
        }
    },

    _collectStepPageNeedles(step = {}) {
        const pageNeedles = [];
        const configuredGroups = [
            step.preferred_page_contains,
            step.wait_for_page_contains,
            step.waitForPageContains,
            step.wait_for_url_contains,
            step.waitForUrlContains,
            step.post_click_required_page_contains,
            step.postClickRequiredPageContains
        ];

        const pushNeedle = (value) => {
            if (typeof value !== 'string') {
                return;
            }

            const needle = normalizePageMatchValue(value);
            if (needle && !pageNeedles.includes(needle)) {
                pageNeedles.push(needle);
            }
        };

        for (const group of configuredGroups) {
            const values = Array.isArray(group) ? group : (group ? [group] : []);
            for (const value of values) {
                pushNeedle(value);
            }
        }

        return pageNeedles;
    },

    _collectStepSelectors(step = {}) {
        const selectors = [];
        const by = step.by || 'css_selector';
        const pushSelector = (value) => {
            if (Array.isArray(value)) {
                value.forEach(pushSelector);
                return;
            }

            if (typeof value !== 'string') {
                return;
            }

            const selector = value.trim();
            if (selector && !selectors.includes(selector)) {
                selectors.push(selector);
            }
        };

        const resolveSelectorCandidates = (value, selectorBy = by) => {
            const resolvedValue = typeof this._resolveStepTemplate === 'function'
                ? this._resolveStepTemplate(value)
                : value;

            if (typeof this._resolveSelectorCandidates === 'function') {
                return this._resolveSelectorCandidates(selectorBy, resolvedValue);
            }

            if (typeof this._convertSelector === 'function') {
                return [this._convertSelector(selectorBy, resolvedValue)];
            }

            return [resolvedValue];
        };

        pushSelector(resolveSelectorCandidates(step.selector, by));

        const fallbackSelectors = Array.isArray(step.fallback_selectors)
            ? step.fallback_selectors
            : (step.fallback_selectors ? [step.fallback_selectors] : []);
        for (const fallback of fallbackSelectors) {
            pushSelector(resolveSelectorCandidates(fallback, by));
        }

        if (typeof step.wait_for_element === 'string' && step.wait_for_element.trim()) {
            pushSelector(resolveSelectorCandidates(step.wait_for_element, step.wait_element_by || by));
        }

        if (typeof step.wait_for_text === 'string' && step.wait_for_text.trim()) {
            const waitText = typeof this._resolveStepTemplate === 'function'
                ? this._resolveStepTemplate(step.wait_for_text)
                : step.wait_for_text;
            pushSelector(`text=${String(waitText).trim()}`);
        }

        if (typeof step.text_match === 'string' && step.text_match.trim()) {
            const textMatch = typeof this._resolveStepTemplate === 'function'
                ? this._resolveStepTemplate(step.text_match)
                : step.text_match;
            pushSelector(`text=${String(textMatch).trim()}`);
        }

        return selectors;
    },

    async _isStepReady(browser, step = {}) {
        try {
            if (!step || typeof step !== 'object') {
                return false;
            }

            const stepType = String(step.type || '').toLowerCase();
            const pageNeedles = this._collectStepPageNeedles(step);
            const selectors = this._collectStepSelectors(step);

            const pages = [];
            try {
                if (browser && typeof browser.context === 'function') {
                    const context = browser.context();
                    if (context && typeof context.pages === 'function') {
                        pages.push(...context.pages().filter(page => page && typeof page.isClosed === 'function' ? !page.isClosed() : true));
                    }
                }
            } catch (_error) {}

            if (pages.length === 0 && browser) {
                pages.push(browser);
            }

            const resolveUrl = (target) => {
                try {
                    return typeof target.url === 'function' ? target.url() : target.url;
                } catch (_error) {
                    return '';
                }
            };

            const isVisibleLocator = async (target, selector) => {
                const inspectScope = async (scope) => {
                    try {
                        const locator = scope.locator(selector);
                        const count = await locator.count().catch(() => 0);
                        if (count <= 0) {
                            return false;
                        }

                        const limit = Number.isFinite(step.nth) && step.nth >= 0
                            ? Math.min(count, step.nth + 1)
                            : Math.min(count, 3);
                        const startIndex = Number.isFinite(step.nth) && step.nth >= 0 ? step.nth : 0;

                        for (let index = startIndex; index < limit; index++) {
                            const candidate = locator.nth(index);
                            if (await candidate.isVisible().catch(() => false)) {
                                return true;
                            }
                        }

                        return false;
                    } catch (_error) {
                        return false;
                    }
                };

                try {
                    if (await inspectScope(target)) {
                        return true;
                    }

                    if (target && typeof target.frames === 'function') {
                        for (const frame of target.frames()) {
                            if (await inspectScope(frame)) {
                                return true;
                            }
                        }
                    }

                    return false;
                } catch (_error) {
                    return false;
                }
            };

            if (stepType === 'wait') {
                const waitForTextHidden = typeof this._resolveStepTemplate === 'function'
                    ? this._resolveStepTemplate(step.wait_for_text_hidden || step.waitForTextHidden)
                    : (step.wait_for_text_hidden || step.waitForTextHidden || '');
                const waitForElementHidden = typeof this._resolveStepTemplate === 'function'
                    ? this._resolveStepTemplate(step.wait_for_element_hidden || step.waitForElementHidden)
                    : (step.wait_for_element_hidden || step.waitForElementHidden || '');
                const waitForText = typeof this._resolveStepTemplate === 'function'
                    ? this._resolveStepTemplate(step.wait_for_text || step.waitForText)
                    : (step.wait_for_text || step.waitForText || '');
                const waitForElement = typeof this._resolveStepTemplate === 'function'
                    ? this._resolveStepTemplate(step.wait_for_element || step.waitForElement)
                    : (step.wait_for_element || step.waitForElement || '');

                if (pageNeedles.length > 0) {
                    for (const page of pages) {
                        const pageUrl = resolveUrl(page);
                        if (typeof pageUrl === 'string' && pageNeedles.some(needle => pageUrlMatchesNeedle(pageUrl, needle))) {
                            return true;
                        }
                    }
                }

                const hasHiddenCheck = Boolean((waitForTextHidden && String(waitForTextHidden).trim()) || (waitForElementHidden && String(waitForElementHidden).trim()));
                const hasVisibleCheck = Boolean((waitForText && String(waitForText).trim()) || (waitForElement && String(waitForElement).trim()));

                if (!hasHiddenCheck && !hasVisibleCheck) {
                    return pageNeedles.length === 0;
                }

                for (const page of pages) {
                    const pageUrl = resolveUrl(page);

                    if (hasHiddenCheck) {
                        if (waitForTextHidden && String(waitForTextHidden).trim()) {
                            const textSelector = `text=${String(waitForTextHidden).trim()}`;
                            if (await isVisibleLocator(page, textSelector)) {
                                return false;
                            }
                        }

                        if (waitForElementHidden && String(waitForElementHidden).trim()) {
                            const hiddenSelectors = typeof this._resolveSelectorCandidates === 'function'
                                ? this._resolveSelectorCandidates(step.wait_element_by || step.by || 'css_selector', String(waitForElementHidden).trim())
                                : [typeof this._convertSelector === 'function'
                                    ? this._convertSelector(step.wait_element_by || step.by || 'css_selector', String(waitForElementHidden).trim())
                                    : String(waitForElementHidden).trim()];
                            for (const hiddenSelector of hiddenSelectors) {
                                if (await isVisibleLocator(page, hiddenSelector)) {
                                    return false;
                                }
                            }
                        }
                    }

                    if (hasVisibleCheck) {
                        if (waitForText && String(waitForText).trim()) {
                            const textSelector = `text=${String(waitForText).trim()}`;
                            if (await isVisibleLocator(page, textSelector)) {
                                return true;
                            }
                        }

                        if (waitForElement && String(waitForElement).trim()) {
                            const visibleSelectors = typeof this._resolveSelectorCandidates === 'function'
                                ? this._resolveSelectorCandidates(step.wait_element_by || step.by || 'css_selector', String(waitForElement).trim())
                                : [typeof this._convertSelector === 'function'
                                    ? this._convertSelector(step.wait_element_by || step.by || 'css_selector', String(waitForElement).trim())
                                    : String(waitForElement).trim()];
                            for (const visibleSelector of visibleSelectors) {
                                if (await isVisibleLocator(page, visibleSelector)) {
                                    return true;
                                }
                            }
                        }

                        if (pageNeedles.length > 0 && pageNeedles.some(needle => typeof pageUrl === 'string' && pageUrl.includes(needle))) {
                            return true;
                        }
                    }
                }

                return hasHiddenCheck && !hasVisibleCheck;
            }

            if (selectors.length === 0) {
                if (pageNeedles.length === 0) {
                    return true;
                }

                return pages.some(page => {
                    const pageUrl = resolveUrl(page);
                    return typeof pageUrl === 'string' && pageNeedles.some(needle => pageUrlMatchesNeedle(pageUrl, needle));
                });
            }

            for (const page of pages) {
                const pageUrl = resolveUrl(page);
                const pageMatchesNeedle = pageNeedles.length === 0
                    || (typeof pageUrl === 'string' && pageNeedles.some(needle => pageUrlMatchesNeedle(pageUrl, needle)));

                for (const selector of selectors) {
                    if (await isVisibleLocator(page, selector)) {
                        return true;
                    }
                }

                if (pageMatchesNeedle && pageNeedles.length > 0) {
                    for (const selector of selectors) {
                        try {
                            const locator = page.locator(selector);
                            const count = await locator.count().catch(() => 0);
                            if (count > 0) {
                                return true;
                            }
                        } catch (_error) {}
                    }
                }
            }

            return false;
        } catch (_error) {
            return false;
        }
    },

    extractVerificationCode,
    fetchHaikaSmsCodeFromUrl
};
