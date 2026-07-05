const fs = require('fs-extra');
const path = require('path');
const { build } = require('electron-builder');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));

function deepClone(value) {
    return JSON.parse(JSON.stringify(value || {}));
}

function normalizeVariant(input) {
    const raw = String(input || 'app').trim().toLowerCase();
    if (['tcp-web', 'web-tcp', 'tcpwebsite', 'tcp-web-ui', 'tcp网页版', 'tcp网页'].includes(raw)) {
        return 'tcp-web';
    }
    if (['tcp-app', 'app-tcp', 'tcpapp', 'tcp软件版', 'tcp软件'].includes(raw)) {
        return 'tcp-app';
    }
    if (['web', 'website', 'web-ui', 'headless-web', '网页版', '网页'].includes(raw)) {
        return 'web';
    }
    return 'app';
}

function buildVariantConfig(variant) {
    const variantMap = {
        app: {
            label: '软件版',
            productName: 'AI 自动化工具 2.0',
            appId: 'com.ai.automation.tool',
            output: 'dist/app',
            launchMode: 'desktop',
            startupMode: 'local'
        },
        web: {
            label: '网页版',
            productName: 'AI 自动化工具 2.0 网页版',
            appId: 'com.ai.automation.tool.web',
            output: 'dist/web',
            launchMode: 'web',
            startupMode: 'local'
        },
        'tcp-app': {
            label: 'TCP软件版',
            productName: 'AI 自动化工具 2.0 TCP软件版',
            appId: 'com.ai.automation.tool.tcp',
            output: 'dist/tcp-app',
            launchMode: 'desktop',
            startupMode: 'tcp'
        },
        'tcp-web': {
            label: 'TCP网页版',
            productName: 'AI 自动化工具 2.0 TCP网页版',
            appId: 'com.ai.automation.tool.tcp.web',
            output: 'dist/tcp-web',
            launchMode: 'web',
            startupMode: 'tcp'
        }
    };
    const resolvedVariant = variantMap[variant] || variantMap.app;
    const baseBuild = deepClone(packageJson.build);

    baseBuild.productName = resolvedVariant.productName;
    baseBuild.appId = resolvedVariant.appId;
    baseBuild.directories = {
        ...(baseBuild.directories || {}),
        output: resolvedVariant.output
    };
    baseBuild.extraMetadata = {
        ...(baseBuild.extraMetadata || {}),
        launchMode: resolvedVariant.launchMode,
        startupMode: resolvedVariant.startupMode
    };

    if (baseBuild.nsis) {
        baseBuild.nsis = {
            ...baseBuild.nsis,
            shortcutName: resolvedVariant.productName
        };
    }

    if (baseBuild.nsisWeb) {
        baseBuild.nsisWeb = {
            ...baseBuild.nsisWeb,
            shortcutName: resolvedVariant.productName
        };
    }

    baseBuild.forceCodeSigning = false;
    baseBuild.win = {
        ...(baseBuild.win || {}),
        signAndEditExecutable: false,
        signDlls: false
    };
    baseBuild.win.sign = async () => undefined;

    return {
        config: baseBuild,
        label: resolvedVariant.label
    };
}

async function ensurePackagedDependencies() {
    const requiredDeps = ['graceful-fs', 'jsonfile', 'universalify', 'playwright-core'];

    for (const dep of requiredDeps) {
        const topLevelPath = path.join(projectRoot, 'node_modules', dep);
        const storePath = path.join(projectRoot, 'node_modules', '.store', 'node_modules', dep);

        if (await fs.pathExists(topLevelPath)) {
            continue;
        }

        if (!(await fs.pathExists(storePath))) {
            console.warn(`[build] 未找到依赖 ${dep}，跳过顶层补齐`);
            continue;
        }

        await fs.copy(storePath, topLevelPath, { dereference: true });
        console.log(`[build] 已补齐顶层依赖: ${dep}`);
    }

    const playwrightCorePath = path.join(projectRoot, 'node_modules', 'playwright-core');
    const nestedPlaywrightCorePath = path.join(
        projectRoot,
        'node_modules',
        'playwright',
        'node_modules',
        'playwright-core'
    );

    if (await fs.pathExists(playwrightCorePath) && !(await fs.pathExists(nestedPlaywrightCorePath))) {
        await fs.ensureDir(path.dirname(nestedPlaywrightCorePath));
        await fs.copy(playwrightCorePath, nestedPlaywrightCorePath, { dereference: true });
        console.log('[build] 已补齐 Playwright 嵌套依赖: playwright/node_modules/playwright-core');
    }
}

async function main() {
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    const variant = normalizeVariant(process.argv[2]);
    const { config, label } = buildVariantConfig(variant);
    const outputDir = path.join(projectRoot, config.directories.output);

    console.log(`[build] 开始打包${label}...`);
    console.log(`[build] 输出目录: ${config.directories.output}`);
    console.log(`[build] 版本: ${packageJson.version}`);
    console.log(`[build] 启动模式: ${config.extraMetadata.startupMode}`);
    console.log(`[build] 界面模式: ${config.extraMetadata.launchMode}`);

    await fs.remove(outputDir);
    console.log(`[build] 已清理旧输出: ${config.directories.output}`);

    await build({
        projectDir: projectRoot,
        config
    });

    console.log(`[build] ${label}打包完成`);
}

main().catch((error) => {
    console.error('[build] 打包失败:', error);
    process.exitCode = 1;
});
