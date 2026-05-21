function collectLicenseExpiryCandidates(result = {}) {
    return [
        result.expire_at,
        result.expireAt,
        result.valid_at,
        result.valid_date,
        result.validDate,
        result.expiry_date,
        result.expire_date,
        result.expires_at,
        result.content?.expire_at,
        result.content?.valid_date,
        result.content?.validDate,
        result.content?.expiry_date,
        result.content?.expire_date,
        result.content?.expires_at,
        result.content?.expireAt,
        result.data?.expire_at,
        result.data?.valid_date,
        result.data?.validDate,
        result.data?.expiry_date,
        result.data?.expire_date,
        result.data?.expires_at,
        result.data?.expireAt
    ];
}

function collectLicenseUsageCandidates(result = {}) {
    return [
        result.is_unlimited,
        result.isUnlimited,
        result.unlimited,
        result.no_limit,
        result.noLimit,
        result.remaining_usage_times,
        result.remainingUsageTimes,
        result.remaining_times,
        result.remainingTimes,
        result.remaining_count,
        result.remainingCount,
        result.surplus_times,
        result.surplusTimes,
        result.usage_times,
        result.usageTimes,
        result.used_times,
        result.usedTimes,
        result.used_count,
        result.usedCount,
        result.total_times,
        result.totalTimes,
        result.max_usage_times,
        result.maxUsageTimes,
        result.limit_times,
        result.limitTimes,
        result.times,
        result.count,
        result.content?.is_unlimited,
        result.content?.isUnlimited,
        result.content?.unlimited,
        result.content?.no_limit,
        result.content?.noLimit,
        result.content?.remaining_usage_times,
        result.content?.remainingUsageTimes,
        result.content?.remaining_times,
        result.content?.remainingTimes,
        result.content?.remaining_count,
        result.content?.remainingCount,
        result.content?.surplus_times,
        result.content?.surplusTimes,
        result.content?.usage_times,
        result.content?.usageTimes,
        result.content?.used_times,
        result.content?.usedTimes,
        result.content?.used_count,
        result.content?.usedCount,
        result.content?.total_times,
        result.content?.totalTimes,
        result.content?.max_usage_times,
        result.content?.maxUsageTimes,
        result.content?.limit_times,
        result.content?.limitTimes,
        result.content?.times,
        result.content?.count,
        result.data?.is_unlimited,
        result.data?.isUnlimited,
        result.data?.unlimited,
        result.data?.no_limit,
        result.data?.noLimit,
        result.data?.remaining_usage_times,
        result.data?.remainingUsageTimes,
        result.data?.remaining_times,
        result.data?.remainingTimes,
        result.data?.remaining_count,
        result.data?.remainingCount,
        result.data?.surplus_times,
        result.data?.surplusTimes,
        result.data?.usage_times,
        result.data?.usageTimes,
        result.data?.used_times,
        result.data?.usedTimes,
        result.data?.used_count,
        result.data?.usedCount,
        result.data?.total_times,
        result.data?.totalTimes,
        result.data?.max_usage_times,
        result.data?.maxUsageTimes,
        result.data?.limit_times,
        result.data?.limitTimes,
        result.data?.times,
        result.data?.count,
        result.result?.is_unlimited,
        result.result?.isUnlimited,
        result.result?.unlimited,
        result.result?.no_limit,
        result.result?.noLimit,
        result.result?.remaining_usage_times,
        result.result?.remainingUsageTimes,
        result.result?.remaining_times,
        result.result?.remainingTimes,
        result.result?.remaining_count,
        result.result?.remainingCount,
        result.result?.surplus_times,
        result.result?.surplusTimes,
        result.result?.usage_times,
        result.result?.usageTimes,
        result.result?.used_times,
        result.result?.usedTimes,
        result.result?.used_count,
        result.result?.usedCount,
        result.result?.total_times,
        result.result?.totalTimes,
        result.result?.max_usage_times,
        result.result?.maxUsageTimes,
        result.result?.limit_times,
        result.result?.limitTimes,
        result.result?.times,
        result.result?.count,
        result.validationResult?.is_unlimited,
        result.validationResult?.isUnlimited,
        result.validationResult?.unlimited,
        result.validationResult?.no_limit,
        result.validationResult?.noLimit,
        result.validationResult?.remaining_usage_times,
        result.validationResult?.remainingUsageTimes,
        result.validationResult?.remaining_times,
        result.validationResult?.remainingTimes,
        result.validationResult?.remaining_count,
        result.validationResult?.remainingCount,
        result.validationResult?.surplus_times,
        result.validationResult?.surplusTimes,
        result.validationResult?.usage_times,
        result.validationResult?.usageTimes,
        result.validationResult?.used_times,
        result.validationResult?.usedTimes,
        result.validationResult?.used_count,
        result.validationResult?.usedCount,
        result.validationResult?.total_times,
        result.validationResult?.totalTimes,
        result.validationResult?.max_usage_times,
        result.validationResult?.maxUsageTimes,
        result.validationResult?.limit_times,
        result.validationResult?.limitTimes,
        result.validationResult?.times,
        result.validationResult?.count
    ];
}

function normalizeLicenseUsageValue(value) {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }

    const text = String(value).trim();
    return text;
}

function includesUnlimitedText(value) {
    const text = normalizeLicenseUsageValue(value);
    return !!text && /无限|不限|终身|永久|unlimited|no\s*limit|no-limit/i.test(text);
}

function isPositiveNumericText(value) {
    const text = normalizeLicenseUsageValue(value);
    if (!text) {
        return false;
    }

    const parsed = Number(text.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) && parsed > 0;
}

function hasExplicitNullField(result = {}, keys = []) {
    const sources = [result, result.content, result.data, result.result, result.validationResult]
        .filter((source) => source && typeof source === 'object');

    return keys.some((key) => sources.some((source) => Object.prototype.hasOwnProperty.call(source, key) && source[key] === null));
}

function extractLicenseUsageInfo(result = {}) {
    const rawCandidates = collectLicenseUsageCandidates(result);
    const usageEntries = [];
    const findFirst = (keys) => {
        for (const key of keys) {
            const directValue = result?.[key];
            const contentValue = result?.content?.[key];
            const dataValue = result?.data?.[key];
            const nestedResultValue = result?.result?.[key];
            const validationResultValue = result?.validationResult?.[key];
            const value = [directValue, contentValue, dataValue, nestedResultValue, validationResultValue]
                .find((candidate) => candidate !== undefined && candidate !== null && normalizeLicenseUsageValue(candidate) !== '');
            if (value !== undefined && value !== null) {
                return value;
            }
        }

        return '';
    };

    const unlimitedValue = findFirst(['is_unlimited', 'isUnlimited', 'unlimited', 'no_limit', 'noLimit']);
    const remainingValue = findFirst(['remaining_usage_times', 'remainingUsageTimes', 'remaining_times', 'remainingTimes', 'remaining_count', 'remainingCount', 'surplus_times', 'surplusTimes']);
    const usedValue = findFirst(['usage_times', 'usageTimes', 'used_times', 'usedTimes', 'used_count', 'usedCount']);
    const totalValue = findFirst(['max_usage_times', 'maxUsageTimes', 'total_times', 'totalTimes', 'limit_times', 'limitTimes', 'times', 'count']);
    const unlimitedByNullTotal = totalValue === '' && hasExplicitNullField(result, [
        'max_usage_times',
        'maxUsageTimes',
        'total_times',
        'totalTimes',
        'limit_times',
        'limitTimes',
        'times',
        'count'
    ]);

    const unlimited = unlimitedValue === true
        || unlimitedValue === 1
        || includesUnlimitedText(unlimitedValue)
        || includesUnlimitedText(remainingValue)
        || includesUnlimitedText(usedValue)
        || includesUnlimitedText(totalValue)
        || unlimitedByNullTotal;

    const hasMeaningfulUsageField = includesUnlimitedText(remainingValue)
        || includesUnlimitedText(usedValue)
        || includesUnlimitedText(totalValue)
        || isPositiveNumericText(remainingValue)
        || isPositiveNumericText(usedValue)
        || isPositiveNumericText(totalValue)
        || normalizeLicenseUsageValue(remainingValue) !== ''
        || normalizeLicenseUsageValue(usedValue) !== ''
        || normalizeLicenseUsageValue(totalValue) !== '';

    if (normalizeLicenseUsageValue(remainingValue)) {
        usageEntries.push({
            key: 'remaining_usage_times',
            value: normalizeLicenseUsageValue(remainingValue)
        });
    }

    if (normalizeLicenseUsageValue(usedValue)) {
        usageEntries.push({
            key: 'usage_times',
            value: normalizeLicenseUsageValue(usedValue)
        });
    }

    if (normalizeLicenseUsageValue(totalValue)) {
        usageEntries.push({
            key: 'max_usage_times',
            value: normalizeLicenseUsageValue(totalValue)
        });
    }

    const summaryParts = [];
    if (unlimited) {
        summaryParts.push('无限次数');
    } else {
        if (normalizeLicenseUsageValue(remainingValue)) {
            summaryParts.push(`剩余 ${normalizeLicenseUsageValue(remainingValue)}`);
        }
        if (normalizeLicenseUsageValue(usedValue)) {
            summaryParts.push(`已用 ${normalizeLicenseUsageValue(usedValue)}`);
        }
        if (normalizeLicenseUsageValue(totalValue)) {
            summaryParts.push(`总数 ${normalizeLicenseUsageValue(totalValue)}`);
        }
    }

    return {
        unlimited,
        locked: !unlimited && hasMeaningfulUsageField,
        summaryText: summaryParts.join('，'),
        remainingText: normalizeLicenseUsageValue(remainingValue),
        usedText: normalizeLicenseUsageValue(usedValue),
        totalText: normalizeLicenseUsageValue(totalValue) || (unlimitedByNullTotal ? '无限次数' : ''),
        unlimitedText: normalizeLicenseUsageValue(unlimitedValue),
        rawCandidates
    };
}

function extractLicenseExpiryText(result = {}) {
    return collectLicenseExpiryCandidates(result)
        .find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function parseLicenseExpiryTimestamp(expireAtValue = '') {
    const raw = String(expireAtValue || '').trim();
    if (!raw) {
        return 0;
    }

    const normalized = raw.replace(/\//g, '-');
    const match = normalized.match(
        /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
    );

    if (match) {
        const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
        const date = new Date(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute),
            Number(second)
        );
        const timestamp = date.getTime();
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    const fallbackDate = new Date(raw);
    const fallbackTimestamp = fallbackDate.getTime();
    return Number.isFinite(fallbackTimestamp) ? fallbackTimestamp : 0;
}

module.exports = {
    collectLicenseUsageCandidates,
    extractLicenseExpiryText,
    extractLicenseUsageInfo,
    parseLicenseExpiryTimestamp
};
