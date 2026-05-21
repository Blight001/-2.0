const protocol = require('./tcp/protocol');
const commands = require('./tcp/commands');
const bridge = require('./tcp/bridge');
const monitor = require('./tcp/monitor');

module.exports = {
    ...protocol,
    ...commands,
    ...bridge,
    ...monitor
};
