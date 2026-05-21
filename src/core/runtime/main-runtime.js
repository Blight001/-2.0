const shared = require('./main-runtime-shared');
const timed = require('./main-runtime-timed');
const registration = require('./main-runtime-registration');
const haika = require('./main-runtime-haika');
const recovery = require('./main-runtime-recovery');
const lifecycle = require('./main-runtime-lifecycle');

module.exports = Object.assign(
    {},
    shared,
    timed,
    registration,
    haika,
    recovery,
    lifecycle
);
