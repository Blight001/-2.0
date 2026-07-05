const registerCardHandlers = require('./card-ipc');
const registerExecutionHandlers = require('./execution-ipc');
const registerCookieHandlers = require('./cookie-ipc');
const registerRuntimeConfigHandlers = require('./runtime-config-ipc');
const registerEmailHandlers = require('./email-ipc');
const registerLogHandlers = require('./log-ipc');
const registerClashHandlers = require('./clash-ipc');
const registerHaikaHandlers = require('./haika-ipc');
const registerHaikaAuthHandlers = require('./haika-auth-ipc');
const registerTempEmailHandlers = require('./temp-email-ipc');
const registerAppHandlers = require('./app-ipc');
const registerAiAssistantHandlers = require('./ai-ipc');
const registerApiServerHandlers = require('./api-server-ipc');

module.exports = function registerAllIpcHandlers(context) {
    registerCardHandlers(context);
    registerExecutionHandlers(context);
    registerCookieHandlers(context);
    registerRuntimeConfigHandlers(context);
    registerEmailHandlers(context);
    registerLogHandlers(context);
    registerClashHandlers(context);
    registerHaikaHandlers(context);
    registerHaikaAuthHandlers(context);
    registerTempEmailHandlers(context);
    registerAppHandlers(context);
    registerAiAssistantHandlers(context);
    registerApiServerHandlers(context);
};
