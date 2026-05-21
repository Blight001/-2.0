const REGION_PRESETS = {
    cn: { label: '中国大陆' },
    hk: { label: '中国香港' },
    tw: { label: '中国台湾' },
    jp: { label: '日本' },
    kr: { label: '韩国' },
    sg: { label: '新加坡' },
    us: { label: '美国' },
    gb: { label: '英国' },
    de: { label: '德国' },
    fr: { label: '法国' },
    ca: { label: '加拿大' },
    au: { label: '澳大利亚' },
    nl: { label: '荷兰' },
    in: { label: '印度' },
    ru: { label: '俄罗斯' },
    th: { label: '泰国' }
};

const GENERIC_DNS_SERVERS = [
    'https://dns.google/dns-query',
    'https://cloudflare-dns.com/dns-query'
];

const CHINA_DNS_SERVERS = [
    'https://dns.alidns.com/dns-query',
    'https://doh.pub/dns-query'
];

const JAPAN_DNS_SERVERS = [
    'https://public.dns.iij.jp/dns-query'
];

const REGION_DNS_SERVERS = {
    cn: CHINA_DNS_SERVERS,
    jp: JAPAN_DNS_SERVERS
};

const NODE_REGION_PATTERNS = {
    cn: [
        /\bcn\b/,
        /\bchina\b/,
        /\bprc\b/,
        /\bmainland\b/,
        /中国/,
        /大陆/
    ],
    hk: [
        /\bhk\b/,
        /\bhong\s*kong\b/,
        /香港/
    ],
    tw: [
        /\btw\b/,
        /\btaiwan\b/,
        /\btaipei\b/,
        /台湾/,
        /臺灣/,
        /台灣/,
        /台北/
    ],
    jp: [
        /\bjp\b/,
        /\bjpn\b/,
        /\bjapan\b/,
        /\btokyo\b/,
        /\bosaka\b/,
        /\bkyoto\b/,
        /\bnagoya\b/,
        /\bhnd\b/,
        /\bnrt\b/,
        /\bosa\b/,
        /日本/,
        /東京/,
        /东京/,
        /大阪/,
        /名古屋/
    ],
    kr: [
        /\bkr\b/,
        /\bkorea\b/,
        /\bseoul\b/,
        /韩国/,
        /韓國/,
        /首尔/,
        /首爾/
    ],
    sg: [
        /\bsg\b/,
        /\bsingapore\b/,
        /新加坡/
    ],
    us: [
        /\bus\b/,
        /\busa\b/,
        /\bunited\s*states\b/,
        /\bamerica\b/,
        /\bnew\s*york\b/,
        /\blos\s*angeles\b/,
        /\bsan\s*francisco\b/,
        /\bchicago\b/,
        /美国/
    ],
    gb: [
        /\bgb\b/,
        /\buk\b/,
        /\bunited\s*kingdom\b/,
        /\bbritain\b/,
        /\blondon\b/,
        /英国/,
        /英國/
    ],
    de: [
        /\bde\b/,
        /\bgermany\b/,
        /\bberlin\b/,
        /\bfrankfurt\b/,
        /德国/,
        /德國/
    ],
    fr: [
        /\bfr\b/,
        /\bfrance\b/,
        /\bparis\b/,
        /法国/,
        /法國/
    ],
    ca: [
        /\bca\b/,
        /\bcanada\b/,
        /\btoronto\b/,
        /\bmontreal\b/,
        /\bvancouver\b/
    ],
    au: [
        /\bau\b/,
        /\baustralia\b/,
        /\bsydney\b/,
        /\bmelbourne\b/,
        /澳大利亚/,
        /澳洲/
    ],
    nl: [
        /\bnl\b/,
        /\bnetherlands\b/,
        /\bamsterdam\b/,
        /荷兰/,
        /荷蘭/
    ],
    in: [
        /\bin\b/,
        /\bindia\b/,
        /\bmumbai\b/,
        /\bdelhi\b/,
        /印度/
    ],
    ru: [
        /\bru\b/,
        /\brussia\b/,
        /\bmoscow\b/,
        /俄罗斯/,
        /俄羅斯/
    ],
    th: [
        /\bth\b/,
        /\bthailand\b/,
        /\bbangkok\b/,
        /泰国/,
        /泰國/
    ]
};

function normalizeBrowserRegionKey(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function getBrowserRegionPreset(region) {
    const key = normalizeBrowserRegionKey(region);
    if (!key || key === 'auto' || key === 'system') {
        return null;
    }

    const preset = REGION_PRESETS[key];
    if (!preset) {
        return null;
    }

    return {
        key,
        ...preset
    };
}

function getBrowserRegionOptions() {
    return [
        { value: '', label: '自动/系统' },
        ...Object.entries(REGION_PRESETS).map(([value, preset]) => ({
            value,
            label: preset.label
        }))
    ];
}

function inferBrowserRegionKeyFromNodeName(nodeName) {
    const normalizedNodeName = String(nodeName || '')
        .trim()
        .toLowerCase()
        .replace(/[_|/\\,;:·•]+/g, ' ')
        .replace(/\s+/g, ' ');

    if (!normalizedNodeName) {
        return null;
    }

    const matchesAnyPattern = (patterns) => Array.isArray(patterns) && patterns.some((pattern) => (
        pattern instanceof RegExp
            ? pattern.test(normalizedNodeName)
            : String(pattern || '').trim() && normalizedNodeName.includes(String(pattern).trim().toLowerCase())
    ));

    for (const [regionKey, patterns] of Object.entries(NODE_REGION_PATTERNS)) {
        if (matchesAnyPattern(patterns)) {
            return regionKey;
        }
    }

    return null;
}

function resolveBrowserRegionKeyFromSettings(settings = {}) {
    const normalizedRegion = normalizeBrowserRegionKey(
        settings.region
        || settings.browser_region
        || settings.proxy_region
        || settings.proxyRegion
        || ''
    );

    if (normalizedRegion && REGION_PRESETS[normalizedRegion]) {
        return normalizedRegion;
    }

    const nodeRegion = inferBrowserRegionKeyFromNodeName(
        settings.currentNode
        || settings.current_node
        || settings.nodeName
        || settings.node_name
        || settings.clashNode
        || settings.clash_node
        || settings.proxyNode
        || settings.proxy_node
        || settings.selectedNode
        || settings.selected_node
        || ''
    );

    if (nodeRegion && REGION_PRESETS[nodeRegion]) {
        return nodeRegion;
    }

    return null;
}

function getBrowserRegionDnsConfig(regionOrSettings = {}) {
    const regionKey = typeof regionOrSettings === 'string'
        ? normalizeBrowserRegionKey(regionOrSettings)
        : resolveBrowserRegionKeyFromSettings(regionOrSettings);

    const dnsServers = REGION_DNS_SERVERS[regionKey] || GENERIC_DNS_SERVERS;

    return {
        enable: true,
        'enhanced-mode': 'fake-ip',
        'respect-rules': true,
        'use-hosts': true,
        nameserver: dnsServers,
        fallback: dnsServers
    };
}

module.exports = {
    REGION_PRESETS,
    GENERIC_DNS_SERVERS,
    CHINA_DNS_SERVERS,
    normalizeBrowserRegionKey,
    getBrowserRegionPreset,
    getBrowserRegionOptions,
    inferBrowserRegionKeyFromNodeName,
    resolveBrowserRegionKeyFromSettings,
    getBrowserRegionDnsConfig
};
