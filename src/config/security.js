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
    maxMessagesPerMinute: 15,
    maxConnectionsPerIP: 3,
    adminSessionDuration: '8h',
    maxRequestBodySize: '10kb',
    rateLimitWindowMs: 15 * 60 * 1000, // 15 minutes
    rateLimitMaxRequests: 60,
    authRateLimitMaxAttempts: 10
});

// In production, reject chat sessions that don't reference a registered siteId.
// This prevents anonymous spam from curl/scripts since attackers would need a valid
// siteId+apiKey from the admin panel to create sessions.
const REQUIRE_SITE_ID = process.env.REQUIRE_SITE_ID === undefined
    ? process.env.NODE_ENV === 'production'
    : process.env.REQUIRE_SITE_ID === 'true';

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
    REQUIRE_SITE_ID,
    LOCALHOST_IPS,
    isLocalhost
};
