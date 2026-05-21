const { contextBridge, ipcRenderer } = require('electron');

const CARD_DEBUG_ACTION_CHANNEL = 'card-debug-action';

contextBridge.exposeInMainWorld('cardDebugActions', {
    getRandomEmail() {
        return ipcRenderer.invoke(CARD_DEBUG_ACTION_CHANNEL, {
            action: 'get-random-email'
        });
    }
});
