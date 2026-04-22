/**
 * Rate Limiting Middleware
 * 
 * Single Responsibility: Manages request rate limiting
 * Open/Closed: Configurable limits without code modification
 */

const rateLimit = require('express-rate-limit');
const { SECURITY_LIMITS, isLocalhost } = require('../config/security');

/**
 * Create API rate limiter
 * @param {Object} options - Override options
 * @returns {Function} Express middleware
 */
function createApiLimiter(options = {}) {
    return rateLimit({
        windowMs: options.windowMs || SECURITY_LIMITS.rateLimitWindowMs,
        max: options.max || SECURITY_LIMITS.rateLimitMaxRequests,
        message: { error: 'Too many requests, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => {
            const ip = req.ip || req.socket?.remoteAddress;
            return isLocalhost(ip);
        },
        ...options
    });
}

/**
 * Create stricter rate limiter for auth attempts
 * @param {Object} options - Override options
 * @returns {Function} Express middleware
 */
function createAuthLimiter(options = {}) {
    return rateLimit({
        windowMs: options.windowMs || SECURITY_LIMITS.rateLimitWindowMs,
        max: options.max || SECURITY_LIMITS.authRateLimitMaxAttempts,
        message: { error: 'Too many login attempts, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => {
            const ip = req.ip || req.socket?.remoteAddress;
            return isLocalhost(ip);
        },
        ...options
    });
}

/**
 * Socket connection rate tracker
 * Manages in-memory tracking of socket connections per IP
 */
class SocketRateLimiter {
    constructor(options = {}) {
        this.maxConnectionsPerIP = options.maxConnectionsPerIP || SECURITY_LIMITS.maxConnectionsPerIP;
        this.maxMessagesPerMinute = options.maxMessagesPerMinute || SECURITY_LIMITS.maxMessagesPerMinute;
        this.windowMs = options.windowMs || 60000; // 1 minute

        this.connectionTracker = new Map();
        this.messageTracker = new Map();

        // Start cleanup interval
        this._cleanupInterval = null;
        this.startCleanup();
    }

    /**
     * Track a new connection from an IP
     * @param {string} ip - IP address
     * @returns {boolean} Whether connection is allowed
     */
    trackConnection(ip) {
        // Skip rate limiting for localhost
        if (ip === '127.0.0.1' || ip === 'localhost' || ip === '::1' || ip === '::ffff:127.0.0.1') {
            return true;
        }

        const now = Date.now();
        const connections = this.connectionTracker.get(ip) || [];

        // Remove old entries
        const recent = connections.filter(time => now - time < this.windowMs);
        recent.push(now);
        this.connectionTracker.set(ip, recent);

        return recent.length <= this.maxConnectionsPerIP;
    }

    /**
     * Release a tracked connection for an IP (called on socket disconnect).
     * Decrements the most recent connection entry; clears IP if none remain.
     * @param {string} ip - IP address
     */
    releaseConnection(ip) {
        if (!ip) return;
        const connections = this.connectionTracker.get(ip);
        if (!connections || connections.length === 0) return;
        connections.pop();
        if (connections.length === 0) {
            this.connectionTracker.delete(ip);
        } else {
            this.connectionTracker.set(ip, connections);
        }
    }

    /**
     * Track a message from a session
     * @param {string} sessionId - Session ID
     * @returns {boolean} Whether message is allowed
     */
    trackMessage(sessionId) {
        const now = Date.now();
        const messages = this.messageTracker.get(sessionId) || [];

        // Remove old entries
        const recent = messages.filter(time => now - time < this.windowMs);
        recent.push(now);
        this.messageTracker.set(sessionId, recent);

        return recent.length <= this.maxMessagesPerMinute;
    }

    /**
     * Start periodic cleanup of old entries
     */
    startCleanup() {
        if (this._cleanupInterval) return;

        this._cleanupInterval = setInterval(() => {
            const now = Date.now();

            for (const [key, times] of this.connectionTracker.entries()) {
                const recent = times.filter(time => now - time < this.windowMs);
                if (recent.length === 0) {
                    this.connectionTracker.delete(key);
                } else {
                    this.connectionTracker.set(key, recent);
                }
            }

            for (const [key, times] of this.messageTracker.entries()) {
                const recent = times.filter(time => now - time < this.windowMs);
                if (recent.length === 0) {
                    this.messageTracker.delete(key);
                } else {
                    this.messageTracker.set(key, recent);
                }
            }
        }, this.windowMs);

        // Allow Node.js to exit even if interval is running
        if (this._cleanupInterval.unref) {
            this._cleanupInterval.unref();
        }
    }

    /**
     * Stop cleanup interval
     */
    stopCleanup() {
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
    }

    /**
     * Clear all tracking data
     */
    clear() {
        this.connectionTracker.clear();
        this.messageTracker.clear();
    }
}

module.exports = {
    createApiLimiter,
    createAuthLimiter,
    SocketRateLimiter
};
