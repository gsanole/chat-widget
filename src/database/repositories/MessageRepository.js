/**
 * Message Repository
 * 
 * Single Responsibility: Message data access
 */

const { BaseRepository, generateId, now } = require('./BaseRepository');

class MessageRepository extends BaseRepository {
    /**
     * @param {JsonDB} db - Messages database
     * @param {JsonDB} ticketsDb - Tickets database (for updating last_message_at)
     */
    constructor(db, ticketsDb = null) {
        super(db);
        this.ticketsDb = ticketsDb;
    }

    /**
     * Create a new message
     * @param {Object} messageData
     * @returns {Object}
     */
    create({ ticketId, senderType, senderId, senderName, content }) {
        const message = {
            id: generateId(),
            ticket_id: ticketId,
            sender_type: senderType,
            sender_id: senderId,
            sender_name: senderName,
            content,
            timestamp: now()
        };

        this.db.insert(message);

        // Update ticket's last_message_at
        if (this.ticketsDb) {
            this.ticketsDb.update(t => t.id === ticketId, { last_message_at: now() });
        }

        return message;
    }

    /**
     * Find messages by ticket ID
     * @param {string} ticketId
     * @returns {Array}
     */
    findByTicket(ticketId) {
        return this.db.filter(m => m.ticket_id === ticketId)
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Find recent messages for a ticket
     * @param {string} ticketId
     * @param {number} limit
     * @returns {Array}
     */
    findRecent(ticketId, limit = 50) {
        return this.db.filter(m => m.ticket_id === ticketId)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit)
            .reverse();
    }

    /**
     * Delete all messages for a ticket
     * @param {string} ticketId
     * @returns {boolean}
     */
    deleteByTicket(ticketId) {
        return this.db.delete(m => m.ticket_id === ticketId);
    }

    /**
     * Count messages for a ticket
     * @param {string} ticketId
     * @returns {number}
     */
    countByTicket(ticketId) {
        return this.db.count(m => m.ticket_id === ticketId);
    }
}

module.exports = { MessageRepository };
