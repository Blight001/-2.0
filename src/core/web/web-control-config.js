const packageJson = require('../../../package.json');

function readFlagValue(flagName, argv = []) {
    const matched = argv.find(item => typeof item === 'string' && item.startsWith(`${flagName}=`));
    if (!matched) {
        return '';
    }

    return matched.slice(flagName.length + 1).trim();
}

function resolveBooleanEnv(value) {
    return value === '1' || value === 'true' || value === 'TRUE';
}

function resolveRegistrationMode(argv = process.argv, env = process.env) {
    const rawMode = readFlagValue('--mode', argv)
        || env.REGISTRATION_MODE
        || '';
    const normalizedMode = String(rawMode || '').trim().toLowerCase();

    if (normalizedMode === 'embedded' || normalizedMode === 'embed') {
        return 'embedded';
    }

    if (normalizedMode === 'standalone' || normalizedMode === 'desktop' || normalizedMode === 'local') {
        return 'standalone';
    }

    if (argv.includes('--embed-host')
        || argv.includes('--embedded')
        || resolveBooleanEnv(env.REGISTRATION_EMBEDDED)) {
        return 'embedded';
    }

    return 'standalone';
}

function resolveRegistrationHostApp(argv = process.argv, env = process.env) {
    return String(
        readFlagValue('--embed-host', argv)
        || readFlagValue('--host-app', argv)
        || readFlagValue('--registration-host-app', argv)
        || env.REGISTRATION_HOST_APP
        || env.REGISTRATION_EMBED_HOST
        || ''
    ).trim();
}

function resolveWebControlConfig(argv = process.argv, env = process.env) {
    const packageLaunchMode = String(packageJson.launchMode || '').trim().toLowerCase();
    const packageWebDefault = packageLaunchMode === 'web';
    const webUiEnabled = argv.includes('--web-ui')
        || argv.includes('--headless-web')
        || resolveBooleanEnv(env.WEB_UI)
        || resolveBooleanEnv(env.HEADLESS_WEB)
        || packageWebDefault;
    const headless = argv.includes('--headless-web')
        || resolveBooleanEnv(env.HEADLESS_WEB)
        || packageWebDefault;
    const suppressAutoOpen = argv.includes('--no-web-ui-open')
        || argv.includes('--web-ui-no-auto-open')
        || resolveBooleanEnv(env.WEB_UI_NO_AUTO_OPEN)
        || resolveBooleanEnv(env.WEB_UI_SUPPRESS_OPEN);
    const rawHost = readFlagValue('--web-ui-host', argv) || env.WEB_UI_HOST || '127.0.0.1';
    const rawPort = readFlagValue('--web-ui-port', argv) || env.WEB_UI_PORT || '18765';
    const parsedPort = Number.parseInt(rawPort, 10);
    const registrationMode = resolveRegistrationMode(argv, env);
    const hostApp = resolveRegistrationHostApp(argv, env);
    const browserSource = String(
        readFlagValue('--browser-source', argv)
        || readFlagValue('--registration-browser-source', argv)
        || readFlagValue('--browser-type', argv)
        || readFlagValue('--registration-browser-type', argv)
        || env.REGISTRATION_BROWSER_SOURCE
        || env.BROWSER_SOURCE
        || env.REGISTRATION_BROWSER_TYPE
        || env.BROWSER_TYPE
        || 'local-browser'
    ).trim().toLowerCase();
    const normalizedBrowserSource = browserSource === 'client-browser' || browserSource === 'client' || browserSource === 'host-browser'
        ? 'client-browser'
        : 'local-browser';

    return {
        enabled: webUiEnabled,
        headless,
        host: rawHost.trim() || '127.0.0.1',
        port: Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 18765,
        autoOpenExternal: !suppressAutoOpen,
        registrationMode,
        embedded: registrationMode === 'embedded',
        hostApp,
        registrationHostApp: hostApp,
        requestedRegistrationMode: registrationMode,
        browserSource: normalizedBrowserSource === 'client-browser'
            ? 'client-browser'
            : 'local-browser'
    };
}

module.exports = {
    resolveWebControlConfig
};
