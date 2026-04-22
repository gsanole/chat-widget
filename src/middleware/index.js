/**
 * Middleware Index
 * 
 * Aggregates and exports all middleware modules
 */

const { createAuthMiddleware } = require('./auth');
const { createApiLimiter, createAuthLimiter, SocketRateLimiter } = require('./rateLimiter');
const validation = require('./validation');
const errorHandler = require('./errorHandler');

module.exports = {
    // Auth middleware factory
    createAuthMiddleware,

    // Rate limiting
    createApiLimiter,
    createAuthLimiter,
    SocketRateLimiter,

    // Validation utilities
    ...validation,

    // Error handling
    ...errorHandler
};
