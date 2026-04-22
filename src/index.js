/**
 * Source Index
 * 
 * Main entry point for the modular application structure.
 * Exports all modules for easy importing.
 */

// Config
const config = require('./config');

// Middleware
const middleware = require('./middleware');

// Database
const database = require('./database');

// Services
const services = require('./services');

// Routes
const routes = require('./routes');

// Socket
const socket = require('./socket');

// Utilities
const utils = require('./utils');

// App factory
const { createApp } = require('./app');

module.exports = {
    // Config exports
    ...config,

    // Factory function
    createApp,

    // Modules
    config,
    middleware,
    database,
    services,
    routes,
    socket,
    utils
};
