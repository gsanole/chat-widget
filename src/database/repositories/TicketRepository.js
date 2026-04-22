/**
 * Ticket Repository
 * 
 * Single Responsibility: Ticket data access
 */

const { BaseRepository, generateId, now } = require('./BaseRepository');

class TicketRepository extends BaseRepository {
    /**
     * @param {JsonDB} db - Tickets database
     * @param {JsonDB} messagesDb - Messages database (for cascade delete)
     */
    constructor(db, messagesDb = null) {
        super(db);
        this.messagesDb = messagesDb;
    }

    /**
     * Create a new ticket
     * @param {Object} ticketData
     * @returns {Object}
     */
    create({ id, customerName, customerIp, customerLocation, ipAnalysis, contact = null, createdBy = null, siteId = null }) {
        const ticket = {
            id: id || generateId(),
            customer_name: customerName,
            customer_ip: customerIp,
            customer_location: customerLocation,
            customer_contact: contact,
            ip_analysis: ipAnalysis,
            site_id: siteId,
            status: 'open',
            priority: 'normal',
            assigned_to: null,
            tags: null,
            notes: null,
            started_at: now(),
            resolved_at: null,
            archived_at: null,
            last_message_at: now(),
            created_by: createdBy
        };

        this.db.insert(ticket);
        return ticket;
    }

    /**
     * Find all tickets sorted by newest first
     * @returns {Array}
     */
    findAll() {
        return this.db.getAll().sort((a, b) => b.started_at - a.started_at);
    }

    /**
     * Find tickets by status
     * @param {string} status
     * @returns {Array}
     */
    findByStatus(status) {
        return this.db.filter(t => t.status === status)
            .sort((a, b) => b.started_at - a.started_at);
    }

    /**
     * Find open tickets sorted by last message
     * @returns {Array}
     */
    findOpen() {
        return this.db.filter(t => t.status === 'open')
            .sort((a, b) => (b.last_message_at || 0) - (a.last_message_at || 0));
    }

    /**
     * Find tickets by assignee
     * @param {string} userId
     * @returns {Array}
     */
    findByAssignee(userId) {
        return this.db.filter(t => t.assigned_to === userId)
            .sort((a, b) => b.started_at - a.started_at);
    }

    /**
     * Find tickets by site
     * @param {string} siteId
     * @returns {Array}
     */
    findBySite(siteId) {
        return this.db.filter(t => t.site_id === siteId)
            .sort((a, b) => b.started_at - a.started_at);
    }

    /**
     * Find tickets by site and status
     * @param {string} siteId
     * @param {string} status
     * @returns {Array}
     */
    findBySiteAndStatus(siteId, status) {
        return this.db.filter(t => t.site_id === siteId && t.status === status)
            .sort((a, b) => b.started_at - a.started_at);
    }

    /**
     * Update ticket status
     * @param {string} ticketId
     * @param {string} status
     * @returns {Object|null}
     */
    updateStatus(ticketId, status) {
        const updates = { status };
        if (status === 'resolved') updates.resolved_at = now();
        if (status === 'archived') updates.archived_at = now();
        return this.db.update(t => t.id === ticketId, updates);
    }

    /**
     * Update ticket assignee
     * @param {string} ticketId
     * @param {string} userId
     * @returns {Object|null}
     */
    updateAssignee(ticketId, userId) {
        return this.db.update(t => t.id === ticketId, { assigned_to: userId });
    }

    /**
     * Update ticket priority
     * @param {string} ticketId
     * @param {string} priority
     * @returns {Object|null}
     */
    updatePriority(ticketId, priority) {
        return this.db.update(t => t.id === ticketId, { priority });
    }

    /**
     * Update last message timestamp
     * @param {string} ticketId
     * @returns {Object|null}
     */
    updateLastMessage(ticketId) {
        return this.db.update(t => t.id === ticketId, { last_message_at: now() });
    }

    /**
     * Update ticket notes
     * @param {string} ticketId
     * @param {string} notes
     * @returns {Object|null}
     */
    updateNotes(ticketId, notes) {
        return this.db.update(t => t.id === ticketId, { notes });
    }

    /**
     * Update ticket tags
     * @param {string} ticketId
     * @param {string} tags
     * @returns {Object|null}
     */
    updateTags(ticketId, tags) {
        return this.db.update(t => t.id === ticketId, { tags });
    }

    /**
     * Delete ticket and associated messages
     * @param {string} ticketId
     * @returns {boolean}
     */
    delete(ticketId) {
        // Delete associated messages
        if (this.messagesDb) {
            this.messagesDb.delete(m => m.ticket_id === ticketId);
        }
        return this.db.delete(t => t.id === ticketId);
    }

    /**
     * Clean up old resolved tickets
     * @param {number} daysOld - Days after which to delete
     * @returns {number} Number deleted
     */
    cleanupOldResolved(daysOld = 15) {
        const cutoffTime = now() - (daysOld * 24 * 60 * 60);
        const oldResolved = this.db.filter(t =>
            t.status === 'resolved' &&
            t.resolved_at &&
            t.resolved_at < cutoffTime
        );

        let deletedCount = 0;
        for (const ticket of oldResolved) {
            if (this.messagesDb) {
                this.messagesDb.delete(m => m.ticket_id === ticket.id);
            }
            this.db.delete(t => t.id === ticket.id);
            deletedCount++;
        }

        if (deletedCount > 0) {
            console.log(`Auto-cleanup: Deleted ${deletedCount} resolved tickets older than ${daysOld} days`);
        }
        return deletedCount;
    }

    /**
     * Get ticket statistics
     * @returns {Object}
     */
    getStats() {
        return {
            total: this.db.count(),
            open: this.db.count(t => t.status === 'open'),
            resolved: this.db.count(t => t.status === 'resolved'),
            archived: this.db.count(t => t.status === 'archived')
        };
    }
}

module.exports = { TicketRepository };
