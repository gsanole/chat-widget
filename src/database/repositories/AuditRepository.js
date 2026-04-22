/**
 * Audit Repository
 * 
 * Single Responsibility: Audit log data access
 */

const { BaseRepository, generateId, now } = require('./BaseRepository');

class AuditRepository extends BaseRepository {
    /**
     * Log an audit entry
     * @param {Object} entryData
     * @returns {Object}
     */
    log({ userId, username, action, resourceType = null, resourceId = null, details = null, ipAddress = null, userAgent = null }) {
        const entry = {
            id: generateId(),
            user_id: userId,
            username,
            action,
            resource_type: resourceType,
            resource_id: resourceId,
            details,
            ip_address: ipAddress,
            user_agent: userAgent,
            timestamp: now()
        };

        this.db.insert(entry);

        // Keep audit log size manageable (max 10000 entries)
        if (this.db.data.length > 10000) {
            this.db.data = this.db.data.slice(-5000);
            this.db.save();
        }

        return entry;
    }

    /**
     * Find all audit entries with limit
     * @param {number} limit
     * @returns {Array}
     */
    findAll(limit = 100) {
        return this.db.getAll()
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * Find entries by user
     * @param {string} userId
     * @param {number} limit
     * @returns {Array}
     */
    findByUser(userId, limit = 100) {
        return this.db.filter(l => l.user_id === userId)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * Find entries by action
     * @param {string} action
     * @param {number} limit
     * @returns {Array}
     */
    findByAction(action, limit = 100) {
        return this.db.filter(l => l.action === action)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * Find entries by resource
     * @param {string} resourceType
     * @param {string} resourceId
     * @returns {Array}
     */
    findByResource(resourceType, resourceId) {
        return this.db.filter(l => l.resource_type === resourceType && l.resource_id === resourceId)
            .sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Find entries by date range
     * @param {number} startTimestamp
     * @param {number} endTimestamp
     * @returns {Array}
     */
    findByDateRange(startTimestamp, endTimestamp) {
        return this.db.filter(l => l.timestamp >= startTimestamp && l.timestamp <= endTimestamp)
            .sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Clean up old entries
     * @param {number} olderThanDays
     * @returns {number} Number deleted
     */
    cleanup(olderThanDays = 90) {
        const cutoff = now() - (olderThanDays * 24 * 60 * 60);
        const initialCount = this.db.data.length;
        this.db.data = this.db.filter(l => l.timestamp >= cutoff);
        this.db.save();
        return initialCount - this.db.data.length;
    }
}

module.exports = { AuditRepository };
