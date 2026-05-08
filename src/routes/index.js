/**
 * Routes Index
 * 
 * Exports all route factory functions
 */

const { createAuthRouter } = require('./auth');
const { createUsersRouter } = require('./users');
const { createTicketsRouter } = require('./tickets');
const { createAuditRouter } = require('./audit');
const { createSitesRouter } = require('./sites');
const { createChatbotRouter } = require('./chatbot');
const { createIntegrationsRouter } = require('./integrations');

module.exports = {
    createAuthRouter,
    createUsersRouter,
    createTicketsRouter,
    createAuditRouter,
    createSitesRouter,
    createChatbotRouter,
    createIntegrationsRouter
};
