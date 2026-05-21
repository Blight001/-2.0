const crypto = require('crypto');

function normalizeUsageSnapshot(usageInfo) {
    if (!usageInfo || typeof usageInfo !== 'object' || Array.isArray(usageInfo)) {
        return null;
    }

    const snapshot = { ...usageInfo };
    for (const key of ['summaryText', 'remainingText', 'usedText', 'totalText', 'unlimitedText']) {
        if (typeof snapshot[key] === 'string') {
            snapshot[key] = snapshot[key].trim();
        }
    }

    return snapshot;
}

function parseUsageCount(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
    }

    const text = String(value).trim();
    if (!text) {
        return null;
    }

    if (/无限|不限|永久|终身|unlimited|no\s*limit|no-limit/i.test(text)) {
        return null;
    }

    const match = text.replace(/[,，\s]/g, '').match(/\d+(?:\.\d+)?/);
    if (!match) {
        return null;
    }

    const parsed = Number(match[0]);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function normalizeUsageState(usageState) {
    if (!usageState || typeof usageState !== 'object' || Array.isArray(usageState)) {
        return null;
    }

    const snapshot = { ...usageState };
    const totalCount = parseUsageCount(snapshot.totalCount ?? snapshot.total_count ?? snapshot.total ?? snapshot.maxCount ?? snapshot.max_count);
    const consumedCountRaw = parseUsageCount(snapshot.consumedCount ?? snapshot.consumed_count ?? snapshot.usedCount ?? snapshot.used_count ?? snapshot.used);
    const remainingCountRaw = parseUsageCount(snapshot.remainingCount ?? snapshot.remaining_count ?? snapshot.remaining ?? snapshot.leftCount ?? snapshot.left_count);

    const normalized = {
        totalCount: Number.isFinite(totalCount) ? totalCount : null,
        consumedCount: Number.isFinite(consumedCountRaw) ? Math.max(0, consumedCountRaw) : 0,
        remainingCount: Number.isFinite(remainingCountRaw) ? Math.max(0, remainingCountRaw) : null,
        lastSyncedAt: typeof snapshot.lastSyncedAt === 'string' ? snapshot.lastSyncedAt.trim() : '',
        lastConsumedAt: typeof snapshot.lastConsumedAt === 'string' ? snapshot.lastConsumedAt.trim() : '',
        source: typeof snapshot.source === 'string' ? snapshot.source.trim() : '',
        unlimited: snapshot.unlimited === true
    };

    if (normalized.totalCount !== null) {
        normalized.consumedCount = Math.max(0, Math.min(normalized.totalCount, normalized.consumedCount));
        normalized.remainingCount = normalized.totalCount - normalized.consumedCount;
    } else if (normalized.remainingCount === null) {
        normalized.remainingCount = null;
    }

    return normalized;
}

function buildUsageSummaryFromState(usageState = {}) {
    const normalizedState = normalizeUsageState(usageState);
    if (!normalizedState) {
        return '';
    }

    if (normalizedState.unlimited === true) {
        return '无限次数';
    }

    if (normalizedState.totalCount === null) {
        return '';
    }

    return `剩余 ${Math.max(0, normalizedState.remainingCount ?? 0)}，已用 ${Math.max(0, normalizedState.consumedCount ?? 0)}，总数 ${normalizedState.totalCount}`;
}

function resolveUsageState(existingCache = null, incomingUsageInfo = null, options = {}) {
    const normalizedIncoming = normalizeUsageSnapshot(incomingUsageInfo);
    const existingState = normalizeUsageState(existingCache?.usageState);
    const consumeCount = Number.isFinite(Number(options.consumeCount))
        ? Math.max(0, Math.floor(Number(options.consumeCount)))
        : 0;
    const incomingUnlimited = normalizedIncoming?.unlimited === true;
    const incomingTotalCount = parseUsageCount(normalizedIncoming?.totalText);
    const incomingRemainingCount = parseUsageCount(normalizedIncoming?.remainingText);
    const incomingUsedCount = parseUsageCount(normalizedIncoming?.usedText);
    const incomingSummaryCount = parseUsageCount(normalizedIncoming?.summaryText);
    const existingTotalCount = existingState?.totalCount;
    const sameTotal = Number.isFinite(existingTotalCount)
        && Number.isFinite(incomingTotalCount)
        && existingTotalCount === incomingTotalCount;
    const hasIncomingUsageData = incomingUnlimited
        || Number.isFinite(incomingTotalCount)
        || Number.isFinite(incomingRemainingCount)
        || Number.isFinite(incomingUsedCount)
        || Number.isFinite(incomingSummaryCount)
        || !!normalizedIncoming?.summaryText
        || !!normalizedIncoming?.remainingText
        || !!normalizedIncoming?.usedText
        || !!normalizedIncoming?.totalText;

    if (!hasIncomingUsageData && consumeCount <= 0) {
        const existingUsageInfo = normalizeUsageSnapshot(existingCache?.usageInfo);
        if (hasFiniteUsageSnapshot(existingUsageInfo)) {
            return {
                usageInfo: existingUsageInfo,
                usageState: existingState || {
                    totalCount: parseUsageCount(existingUsageInfo.totalText) || null,
                    consumedCount: parseUsageCount(existingUsageInfo.usedText) || 0,
                    remainingCount: parseUsageCount(existingUsageInfo.remainingText),
                    lastSyncedAt: new Date().toISOString(),
                    lastConsumedAt: existingState?.lastConsumedAt || '',
                    source: existingState?.source || 'cache',
                    unlimited: existingUsageInfo.unlimited === true
                }
            };
        }
    }

    if (incomingUnlimited) {
        const usageInfo = normalizedIncoming || {};
        return {
            usageInfo: {
                ...usageInfo,
                unlimited: true,
                locked: false,
                summaryText: '无限次数',
                remainingText: usageInfo.remainingText || '',
                usedText: usageInfo.usedText || '',
                totalText: usageInfo.totalText || '无限次数'
            },
            usageState: {
                unlimited: true,
                totalCount: null,
                consumedCount: 0,
                remainingCount: null,
                lastSyncedAt: new Date().toISOString(),
                lastConsumedAt: existingState?.lastConsumedAt || '',
                source: existingState?.source || 'validation'
            }
        };
    }

    let totalCount = Number.isFinite(incomingTotalCount) ? incomingTotalCount : existingTotalCount;
    let consumedCount = 0;

    if (sameTotal && Number.isFinite(existingState?.consumedCount)) {
        consumedCount = existingState.consumedCount;
    } else if (Number.isFinite(incomingUsedCount)) {
        consumedCount = incomingUsedCount;
    } else if (Number.isFinite(totalCount) && Number.isFinite(incomingRemainingCount)) {
        consumedCount = Math.max(0, totalCount - incomingRemainingCount);
    } else if (Number.isFinite(existingState?.consumedCount)) {
        consumedCount = existingState.consumedCount;
    } else if (Number.isFinite(incomingSummaryCount) && Number.isFinite(totalCount)) {
        consumedCount = Math.max(0, totalCount - incomingSummaryCount);
    }

    if (consumeCount > 0) {
        consumedCount += consumeCount;
    }

    if (!Number.isFinite(totalCount) && Number.isFinite(incomingRemainingCount) && Number.isFinite(incomingUsedCount)) {
        totalCount = incomingRemainingCount + incomingUsedCount;
    }

    if (Number.isFinite(totalCount)) {
        consumedCount = Math.max(0, Math.min(totalCount, consumedCount));
    } else {
        consumedCount = Math.max(0, consumedCount);
    }

    const remainingCount = Number.isFinite(totalCount)
        ? Math.max(0, totalCount - consumedCount)
        : Number.isFinite(incomingRemainingCount)
            ? incomingRemainingCount
            : null;

    const summaryText = buildUsageSummaryFromState({
        totalCount,
        consumedCount,
        remainingCount,
        unlimited: false
    }) || normalizedIncoming?.summaryText || '';

    const usageInfo = {
        ...(normalizedIncoming || {}),
        unlimited: false,
        locked: Number.isFinite(totalCount) ? true : (normalizedIncoming?.locked === true),
        totalText: Number.isFinite(totalCount) ? String(totalCount) : (normalizedIncoming?.totalText || ''),
        remainingText: Number.isFinite(remainingCount) ? String(remainingCount) : (normalizedIncoming?.remainingText || ''),
        usedText: Number.isFinite(consumedCount) ? String(consumedCount) : (normalizedIncoming?.usedText || ''),
        summaryText,
        source: normalizedIncoming?.source || ''
    };

    const usageState = {
        totalCount: Number.isFinite(totalCount) ? totalCount : null,
        consumedCount: Number.isFinite(consumedCount) ? consumedCount : 0,
        remainingCount: Number.isFinite(remainingCount) ? remainingCount : null,
        lastSyncedAt: new Date().toISOString(),
        lastConsumedAt: consumeCount > 0 ? new Date().toISOString() : (existingState?.lastConsumedAt || ''),
        source: normalizedIncoming?.source || existingState?.source || 'validation',
        unlimited: false
    };

    return { usageInfo, usageState };
}

function hasFiniteUsageSnapshot(usageInfo) {
    const snapshot = normalizeUsageSnapshot(usageInfo);
    if (!snapshot || snapshot.unlimited === true) {
        return false;
    }

    const text = String(
        snapshot.summaryText
        || snapshot.remainingText
        || snapshot.usedText
        || snapshot.totalText
        || ''
    ).trim();

    return snapshot.locked === true || text.length > 0;
}

function hasPersistedUsageState(usageState) {
    const normalized = normalizeUsageState(usageState);
    return !!(normalized && (normalized.unlimited === true || Number.isFinite(normalized.totalCount)));
}

function selectUsageSnapshotForCache(existingCache = null, cardKey = '', incomingUsageInfo = null) {
    const normalizedKey = String(cardKey || '').trim();
    const existingKey = String(existingCache?.cardKey || '').trim();
    const scopedCache = existingKey && existingKey === normalizedKey ? existingCache : null;
    return resolveUsageState(scopedCache, incomingUsageInfo).usageInfo;
}

function normalizeLicenseCacheRecord(record = {}) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return null;
    }

    const normalizedRecord = {
        version: Number.isFinite(Number(record.version)) ? Number(record.version) : 1,
        cardKey: String(record.cardKey || '').trim(),
        expireAt: typeof record.expireAt === 'string' ? record.expireAt.trim() : '',
        expireAtTimestamp: Number.isFinite(Number(record.expireAtTimestamp))
            ? Number(record.expireAtTimestamp)
            : 0,
        usageInfo: normalizeUsageSnapshot(record.usageInfo),
        usageState: normalizeUsageState(record.usageState),
        savedAt: typeof record.savedAt === 'string' ? record.savedAt.trim() : '',
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt.trim() : '',
        source: typeof record.source === 'string' ? record.source.trim() : ''
    };

    if (record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)) {
        normalizedRecord.metadata = { ...record.metadata };
    }

    return normalizedRecord;
}

function buildLicenseCacheSecret(seedParts = []) {
    const seed = Array.isArray(seedParts)
        ? seedParts.filter(Boolean).map((value) => String(value)).join('|')
        : String(seedParts || '');

    return crypto.createHash('sha256').update(`license-cache|${seed}`, 'utf8').digest();
}

function createLicenseCacheCodec(seedParts = []) {
    const secret = buildLicenseCacheSecret(seedParts);

    return {
        encryptCacheRecord(record = {}) {
            const normalizedRecord = normalizeLicenseCacheRecord(record) || {};
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
            const plaintext = Buffer.from(JSON.stringify(normalizedRecord), 'utf8');
            const payload = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            const tag = cipher.getAuthTag();

            return {
                version: 2,
                encrypted: true,
                algorithm: 'aes-256-gcm',
                iv: iv.toString('base64'),
                tag: tag.toString('base64'),
                payload: payload.toString('base64')
            };
        },

        decryptCacheRecord(cache = {}) {
            if (!cache || typeof cache !== 'object') {
                return null;
            }

            if (cache.encrypted !== true || !cache.payload) {
                return normalizeLicenseCacheRecord(cache);
            }

            try {
                const iv = Buffer.from(String(cache.iv || ''), 'base64');
                const tag = Buffer.from(String(cache.tag || ''), 'base64');
                const payload = Buffer.from(String(cache.payload || ''), 'base64');
                if (!iv.length || !tag.length || !payload.length) {
                    return null;
                }

                const decipher = crypto.createDecipheriv('aes-256-gcm', secret, iv);
                decipher.setAuthTag(tag);

                const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
                const parsed = JSON.parse(decrypted);
                return normalizeLicenseCacheRecord(parsed);
            } catch (_error) {
                return null;
            }
        }
    };
}

module.exports = {
    buildLicenseCacheSecret,
    buildUsageSummaryFromState,
    createLicenseCacheCodec,
    hasFiniteUsageSnapshot,
    hasPersistedUsageState,
    normalizeUsageState,
    normalizeLicenseCacheRecord,
    normalizeUsageSnapshot,
    parseUsageCount,
    resolveUsageState,
    selectUsageSnapshotForCache
};
