const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, ...args) {
    return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld('electronAPI', {
    getDeviceId() {
        return invoke('get-device-id');
    },
    getSavedCardKey() {
        return invoke('get-saved-card-key');
    },
    validateCardKey(payload) {
        return invoke('validate-card-key', payload);
    },
    saveSavedCardKey(cardKey) {
        return invoke('save-saved-card-key', cardKey);
    },
    clearSavedCardKey() {
        return invoke('clear-saved-card-key');
    },
    confirmValidationSuccess() {
        ipcRenderer.send('validation-success');
    }
});
