const {
    MSG_TYPE_REGISTRATION_COMMAND_REQ,
    MSG_TYPE_REGISTRATION_COMMAND_RESP,
    packTcpMessage
} = require('./protocol');
const {
    _buildCommandResponse,
    executeRegistrationTcpCommand
} = require('./commands');

async function _processRegistrationTcpIncomingPacket(app, socket, packet) {
    const state = app?.registrationTcpMonitorState || null;
    if (!state || !packet) {
        return;
    }

    if (state.pendingRequests instanceof Map && state.pendingRequests.has(packet.msgId)) {
        const pending = state.pendingRequests.get(packet.msgId);
        if (pending && packet.msgType === pending.expectedResponseType) {
            state.pendingRequests.delete(packet.msgId);
            if (pending.timer) {
                clearTimeout(pending.timer);
            }

            let responseData = {};
            try {
                responseData = JSON.parse(packet.body.toString('utf8'));
            } catch (_) {}

            pending.resolve(responseData);
            return;
        }
    }

    if (packet.msgType !== MSG_TYPE_REGISTRATION_COMMAND_REQ) {
        return;
    }

    let requestData = {};
    try {
        requestData = JSON.parse(packet.body.toString('utf8'));
    } catch (_) {
        requestData = {};
    }

    const executionResult = await executeRegistrationTcpCommand(app, requestData);
    const responseData = _buildCommandResponse(app, executionResult);
    const responseBuffer = packTcpMessage(packet.msgId, MSG_TYPE_REGISTRATION_COMMAND_RESP, responseData);
    try {
        socket.write(responseBuffer);
    } catch (error) {
        app?.logger?.warning?.(`注册器命令响应发送失败: ${error.message}`);
    }
}

module.exports = {
    _processRegistrationTcpIncomingPacket
};
