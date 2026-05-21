const path = require('path');
const { spawn } = require('child_process');

function resolveRepoRoot() {
    return path.resolve(__dirname, '..', '..', '..', '..');
}

function resolveElectronExecutablePath() {
    try {
        const electronExecutable = require('electron');
        if (electronExecutable) {
            return String(electronExecutable).trim();
        }
    } catch (_error) {
    }

    return path.join(resolveRepoRoot(), 'node_modules', 'electron', 'dist', 'electron.exe');
}

function stripRemoteDebuggingPort(args = []) {
    const filtered = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = String(args[index] || '');
        if (arg === '--remote-debugging-port') {
            index += 1;
            continue;
        }

        if (arg.startsWith('--remote-debugging-port=')) {
            continue;
        }

        filtered.push(arg);
    }

    return filtered;
}

async function main() {
    const electronExecutablePath = resolveElectronExecutablePath();
    const electronArgs = stripRemoteDebuggingPort(process.argv.slice(2));
    const childEnv = {
        ...process.env
    };
    delete childEnv.NODE_OPTIONS;
    delete childEnv.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronExecutablePath, electronArgs, {
        cwd: resolveRepoRoot(),
        env: childEnv,
        stdio: 'inherit',
        windowsHide: false
    });

    let exited = false;
    const finish = (code) => {
        if (exited) {
            return;
        }
        exited = true;
        process.exit(code);
    };

    child.on('error', (error) => {
        console.error(`Electron wrapper 启动失败: ${error.message}`);
        finish(1);
    });

    child.on('close', (code, signal) => {
        if (signal) {
            console.error(`Electron wrapper 已退出，signal=${signal}`);
            finish(1);
            return;
        }

        finish(Number.isInteger(code) ? code : 0);
    });

    const forwardSignal = (signal) => {
        if (!child.killed) {
            child.kill(signal);
        }
    };

    process.on('SIGINT', () => forwardSignal('SIGINT'));
    process.on('SIGTERM', () => forwardSignal('SIGTERM'));
    process.on('SIGHUP', () => forwardSignal('SIGHUP'));
}

main().catch((error) => {
    console.error(`Electron wrapper 异常: ${error && error.stack ? error.stack : error}`);
    process.exit(1);
});
