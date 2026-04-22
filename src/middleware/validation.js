/**
 * Input Validation Middleware
 * 
 * Single Responsibility: Input sanitization and validation
 * Open/Closed: Validators can be extended via composition
 */

const { SECURITY_LIMITS } = require('../config/security');

/**
 * Sanitize a message string
 * @param {string} message - Raw message input
 * @returns {string} Sanitized message
 */
function sanitizeMessage(message) {
    if (!message || typeof message !== 'string') return '';

    // Trim and limit length
    let clean = message.trim().slice(0, SECURITY_LIMITS.maxMessageLength);

    // Remove null bytes and control characters (except newlines)
    clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    return clean;
}

/**
 * Sanitize a name string
 * @param {string} name - Raw name input
 * @returns {string} Sanitized name
 */
function sanitizeName(name) {
    if (!name || typeof name !== 'string') return 'Anonymous';

    let clean = name.trim().slice(0, SECURITY_LIMITS.maxNameLength);
    clean = clean.replace(/[\x00-\x1F\x7F<>]/g, '');

    return clean || 'Anonymous';
}

/**
 * Sanitize email address
 * @param {string} email - Raw email input
 * @returns {string|null} Sanitized email or null if invalid
 */
function sanitizeEmail(email) {
    if (!email || typeof email !== 'string') return null;

    const clean = email.trim().toLowerCase().slice(0, 254);
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    return emailRegex.test(clean) ? clean : null;
}

/**
 * Validate and sanitize location data
 * @param {Object} location - Location object
 * @returns {Object|null} Validated location or null
 */
function validateLocation(location) {
    if (!location || typeof location !== 'object') return null;

    const lat = parseFloat(location.latitude);
    const lon = parseFloat(location.longitude);

    if (isNaN(lat) || isNaN(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

    return {
        latitude: lat,
        longitude: lon,
        accuracy: Math.max(0, parseFloat(location.accuracy) || 0)
    };
}

/**
 * Validate username format
 * @param {string} username - Username to validate
 * @returns {Object} Validation result { valid: boolean, error?: string }
 */
function validateUsername(username) {
    if (!username || typeof username !== 'string') {
        return { valid: false, error: 'Username is required' };
    }

    const clean = username.trim();

    if (clean.length < 3) {
        return { valid: false, error: 'Username must be at least 3 characters' };
    }

    if (clean.length > 50) {
        return { valid: false, error: 'Username must be 50 characters or less' };
    }

    // Alphanumeric, underscore, hyphen only
    if (!/^[a-zA-Z0-9_-]+$/.test(clean)) {
        return { valid: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' };
    }

    return { valid: true, value: clean };
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {Object} Validation result { valid: boolean, error?: string }
 */
function validatePassword(password) {
    if (!password || typeof password !== 'string') {
        return { valid: false, error: 'Password is required' };
    }

    if (password.length < 8) {
        return { valid: false, error: 'Password must be at least 8 characters' };
    }

    if (password.length > 128) {
        return { valid: false, error: 'Password must be 128 characters or less' };
    }

    // Require at least one letter and one number
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one letter and one number' };
    }

    return { valid: true };
}

/**
 * Sanitize HTML content (basic XSS prevention)
 * @param {string} html - HTML content
 * @returns {string} Sanitized content
 */
function sanitizeHtml(html) {
    if (!html || typeof html !== 'string') return '';

    return html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Validate ticket ID format
 * @param {string} ticketId - Ticket ID to validate
 * @returns {boolean}
 */
function isValidTicketId(ticketId) {
    if (!ticketId || typeof ticketId !== 'string') return false;
    // Ticket IDs are expected to be timestamps or UUIDs
    return /^[a-zA-Z0-9-]+$/.test(ticketId) && ticketId.length >= 1 && ticketId.length <= 50;
}

/**
 * Validate site ID format
 * @param {string} siteId - Site ID to validate
 * @returns {boolean}
 */
function isValidSiteId(siteId) {
    if (!siteId || typeof siteId !== 'string') return false;
    return /^[a-zA-Z0-9_-]+$/.test(siteId) && siteId.length >= 1 && siteId.length <= 50;
}

/**
 * Express middleware factory for validating request body
 * @param {Object} schema - Validation schema { field: validator }
 * @returns {Function} Express middleware
 */
function validateBody(schema) {
    return (req, res, next) => {
        const errors = [];

        for (const [field, validator] of Object.entries(schema)) {
            const value = req.body[field];

            if (typeof validator === 'function') {
                const result = validator(value);
                if (result && result.valid === false) {
                    errors.push({ field, error: result.error });
                } else if (result && result.value !== undefined) {
                    req.body[field] = result.value;
                }
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({ error: 'Validation failed', details: errors });
        }

        next();
    };
}

module.exports = {
    sanitizeMessage,
    sanitizeName,
    sanitizeEmail,
    validateLocation,
    validateUsername,
    validatePassword,
    sanitizeHtml,
    isValidTicketId,
    isValidSiteId,
    validateBody
};
