const shared = require('./shared');
const core = require('./core');
const click = require('./click');
const type = require('./type');
const misc = require('./misc');
const page = require('./page');

module.exports = Object.assign({}, shared, core, click, type, misc, page);
