const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

function normalizeMachineId(value) {
    return String(value || '').trim();
}

function readWindowsMachineIdSync() {
    try {
        const output = execFileSync(
            'reg',
            ['query', 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
            { encoding: 'utf8', windowsHide: true }
        );
        const match = String(output || '').match(/MachineGuid\s+REG_\w+\s+([^\r\n]+)/i);
        return normalizeMachineId(match ? match[1] : '');
    } catch (_error) {
        return '';
    }
}

function readLinuxMachineIdSync() {
    const candidates = [
        '/etc/machine-id',
        '/var/lib/dbus/machine-id'
    ];

    for (const filePath of candidates) {
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                const machineId = normalizeMachineId(content);
                if (machineId) {
                    return machineId;
                }
            }
        } catch (_error) {
            // ignore and try next candidate
        }
    }

    return '';
}

function readMacMachineIdSync() {
    try {
        const output = execFileSync(
            'ioreg',
            ['-rd1', '-c', 'IOPlatformExpertDevice'],
            { encoding: 'utf8' }
        );
        const match = String(output || '').match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i);
        return normalizeMachineId(match ? match[1] : '');
    } catch (_error) {
        return '';
    }
}

function machineIdSync(_options = {}) {
    switch (os.platform()) {
        case 'win32':
            return readWindowsMachineIdSync();
        case 'linux':
            return readLinuxMachineIdSync();
        case 'darwin':
            return readMacMachineIdSync();
        default:
            return '';
    }
}

async function machineId(_options = {}) {
    return machineIdSync();
}

module.exports = {
    machineIdSync,
    machineId
};
