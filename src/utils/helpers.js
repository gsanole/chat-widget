/**
 * General Helper Utilities
 * 
 * Single Responsibility: Common helper functions
 */

const crypto = require('crypto');

/**
 * Generate a unique ID
 * @param {number} length - Length of the ID (default 16)
 * @returns {string}
 */
function generateId(length = 16) {
    return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate UUID v4
 * @returns {string}
 */
function generateUUID() {
    return crypto.randomUUID();
}

/**
 * Generate a random secure token
 * @param {number} bytes - Number of bytes (default 32)
 * @returns {string}
 */
function generateSecureToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safely parse JSON without throwing
 * @param {string} str - JSON string
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {*}
 */
function safeJsonParse(str, defaultValue = null) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return defaultValue;
    }
}

/**
 * Deep clone an object
 * @param {Object} obj - Object to clone
 * @returns {Object}
 */
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Pick specified keys from an object
 * @param {Object} obj - Source object
 * @param {string[]} keys - Keys to pick
 * @returns {Object}
 */
function pick(obj, keys) {
    return keys.reduce((result, key) => {
        if (key in obj) {
            result[key] = obj[key];
        }
        return result;
    }, {});
}

/**
 * Omit specified keys from an object
 * @param {Object} obj - Source object
 * @param {string[]} keys - Keys to omit
 * @returns {Object}
 */
function omit(obj, keys) {
    return Object.keys(obj).reduce((result, key) => {
        if (!keys.includes(key)) {
            result[key] = obj[key];
        }
        return result;
    }, {});
}

/**
 * Format date for display
 * @param {Date|string|number} date - Date to format
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string}
 */
function formatDate(date, options = {}) {
    const d = new Date(date);
    return d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        ...options
    });
}

/**
 * Get timestamp in ISO format
 * @returns {string}
 */
function getTimestamp() {
    return new Date().toISOString();
}

/**
 * Truncate string to specified length
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @param {string} suffix - Suffix to add (default '...')
 * @returns {string}
 */
function truncate(str, maxLength, suffix = '...') {
    if (!str || str.length <= maxLength) return str;
    return str.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Check if value is empty (null, undefined, empty string, empty array/object)
 * @param {*} value - Value to check
 * @returns {boolean}
 */
function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

/**
 * Debounce function execution
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function}
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Max retry attempts
 * @param {number} baseDelay - Base delay in ms
 * @returns {Promise<*>}
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, attempt);
                await sleep(delay);
            }
        }
    }

    throw lastError;
}

module.exports = {
    generateId,
    generateUUID,
    generateSecureToken,
    sleep,
    safeJsonParse,
    deepClone,
    pick,
    omit,
    formatDate,
    getTimestamp,
    truncate,
    isEmpty,
    debounce,
    retryWithBackoff
};
