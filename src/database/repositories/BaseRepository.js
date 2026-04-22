/**
 * Base Repository Class
 * 
 * Single Responsibility: Common repository operations
 * Liskov Substitution: Subclasses can be used interchangeably
 * Interface Segregation: Minimal interface for data access
 */

const crypto = require('crypto');

/**
 * Generate unique ID
 * @returns {string}
 */
function generateId() {
    return crypto.randomUUID();
}

/**
 * Generate secure token
 * @returns {string}
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Get current Unix timestamp
 * @returns {number}
 */
function now() {
    return Math.floor(Date.now() / 1000);
}

/**
 * Base repository class
 */
class BaseRepository {
    /**
     * @param {JsonDB} db - JsonDB instance
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * Find by ID
     * @param {string} id - Record ID
     * @returns {Object|undefined}
     */
    findById(id) {
        return this.db.find(item => item.id === id);
    }

    /**
     * Find all records
     * @returns {Array}
     */
    findAll() {
        return this.db.getAll();
    }

    /**
     * Count records
     * @param {Function} predicate - Optional filter
     * @returns {number}
     */
    count(predicate = null) {
        return this.db.count(predicate);
    }

    /**
     * Delete by ID
     * @param {string} id - Record ID
     * @returns {boolean}
     */
    deleteById(id) {
        return this.db.delete(item => item.id === id);
    }
}

module.exports = {
    BaseRepository,
    generateId,
    generateToken,
    now
};
