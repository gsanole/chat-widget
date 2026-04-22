/**
 * Security Configuration
 * 
 * Single Responsibility: Contains all security-related constants and limits
 * Open/Closed: New limits can be added without modifying existing code
 */

const { v4: uuidv4 } = require('uuid');

// JWT secret for admin sessions
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-to-a-random-string-in-production-' + uuidv4();

// Security limits for the application
const SECURITY_LIMITS = Object.freeze({
    maxMessageLength: 2000,
    maxNameLength: 50,
    maxMessagesPerMinute: 30,
    maxConnectionsPerIP: 5,
    adminSessionDuration: '8h',
    maxRequestBodySize: '10kb',
    rateLimitWindowMs: 15 * 60 * 1000, // 15 minutes
    rateLimitMaxRequests: 100,
    authRateLimitMaxAttempts: 10
});

// IP addresses that bypass rate limiting (for testing)
const LOCALHOST_IPS = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

/**
 * Check if an IP is a localhost address
 * @param {string} ip - IP address to check
 * @returns {boolean}
 */
function isLocalhost(ip) {
    return LOCALHOST_IPS.includes(ip);
}

module.exports = {
    JWT_SECRET,
    SECURITY_LIMITS,
    LOCALHOST_IPS,
    isLocalhost
};
