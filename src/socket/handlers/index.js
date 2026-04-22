/**
 * Socket Handlers Index
 * 
 * Exports all socket handler factories
 */

const { createAdminHandlers } = require('./adminHandlers');
const { createChatHandlers } = require('./chatHandlers');
const { createSessionHandlers } = require('./sessionHandlers');

module.exports = {
    createAdminHandlers,
    createChatHandlers,
    createSessionHandlers
};
