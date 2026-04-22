/**
 * Ticket Service
 * 
 * Single Responsibility: Ticket business logic
 * Dependency Inversion: Receives repositories as dependencies
 */

const { TICKET_STATUS, isValidStatus, isValidTransition } = require('../config/ticketStatus');

class TicketService {
    /**
     * @param {Object} deps - Dependencies
     * @param {Object} deps.ticketRepository - Ticket repository
     * @param {Object} deps.messageRepository - Message repository
     * @param {Object} deps.auditRepository - Audit repository
     * @param {Object} deps.ipUtils - IP utilities (optional)
     */
    constructor({ ticketRepository, messageRepository, auditRepository, ipUtils = null }) {
        this.ticketRepository = ticketRepository;
        this.messageRepository = messageRepository;
        this.auditRepository = auditRepository;
        this.ipUtils = ipUtils;
    }

    /**
     * Create a new ticket
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    async create(data) {
        const { id, customerName, customerIp, customerLocation, ipAnalysis, contact, siteId } = data;

        const ticket = this.ticketRepository.create({
            id,
            customerName,
            customerIp,
            customerLocation,
            ipAnalysis,
            contact,
            siteId
        });

        return ticket;
    }

    /**
     * Get ticket by ID with messages
     * @param {string} ticketId
     * @returns {Object|null}
     */
    getById(ticketId) {
        const ticket = this.ticketRepository.findById(ticketId);
        if (!ticket) return null;

        const messages = this.messageRepository.findByTicket(ticketId);
        return { ...ticket, messages };
    }

    /**
     * Get all tickets
     * @param {Object} filters - Optional filters
     * @returns {Array}
     */
    getAll(filters = {}) {
        let tickets = this.ticketRepository.findAll();

        if (filters.status) {
            tickets = tickets.filter(t => t.status === filters.status);
        }

        if (filters.siteId) {
            tickets = tickets.filter(t => t.site_id === filters.siteId);
        }

        if (filters.assignedTo) {
            tickets = tickets.filter(t => t.assigned_to === filters.assignedTo);
        }

        return tickets;
    }

    /**
     * Get open tickets
     * @returns {Array}
     */
    getOpen() {
        return this.ticketRepository.findOpen();
    }

    /**
     * Update ticket status
     * @param {string} ticketId
     * @param {string} newStatus
     * @param {Object} user - User making the change
     * @param {Object} context - Request context
     * @returns {Object}
     */
    updateStatus(ticketId, newStatus, user, context = {}) {
        if (!isValidStatus(newStatus)) {
            return { success: false, error: 'Invalid status' };
        }

        const ticket = this.ticketRepository.findById(ticketId);
        if (!ticket) {
            return { success: false, error: 'Ticket not found' };
        }

        const currentStatus = ticket.status;
        if (!isValidTransition(currentStatus, newStatus)) {
            return { success: false, error: `Cannot change status from ${currentStatus} to ${newStatus}` };
        }

        const updated = this.ticketRepository.updateStatus(ticketId, newStatus);

        this.auditRepository.log({
            userId: user.userId,
            username: user.username,
            action: 'ticket_status_change',
            resourceType: 'ticket',
            resourceId: ticketId,
            details: `Status: ${currentStatus} -> ${newStatus}`,
            ipAddress: context.ip,
            userAgent: context.userAgent
        });

        return { success: true, ticket: updated };
    }

    /**
     * Assign ticket to user
     * @param {string} ticketId
     * @param {string} assigneeId
     * @param {Object} user
     * @param {Object} context
     * @returns {Object}
     */
    assignTo(ticketId, assigneeId, user, context = {}) {
        const ticket = this.ticketRepository.findById(ticketId);
        if (!ticket) {
            return { success: false, error: 'Ticket not found' };
        }

        const updated = this.ticketRepository.updateAssignee(ticketId, assigneeId);

        this.auditRepository.log({
            userId: user.userId,
            username: user.username,
            action: 'ticket_assigned',
            resourceType: 'ticket',
            resourceId: ticketId,
            details: `Assigned to: ${assigneeId}`,
            ipAddress: context.ip,
            userAgent: context.userAgent
        });

        return { success: true, ticket: updated };
    }

    /**
     * Add message to ticket
     * @param {string} ticketId
     * @param {Object} messageData
     * @returns {Object}
     */
    addMessage(ticketId, messageData) {
        const ticket = this.ticketRepository.findById(ticketId);
        if (!ticket) {
            return { success: false, error: 'Ticket not found' };
        }

        const message = this.messageRepository.create({
            ticketId,
            ...messageData
        });

        return { success: true, message };
    }

    /**
     * Get messages for a ticket
     * @param {string} ticketId
     * @param {number} limit
     * @returns {Array}
     */
    getMessages(ticketId, limit = 50) {
        return this.messageRepository.findRecent(ticketId, limit);
    }

    /**
     * Delete ticket
     * @param {string} ticketId
     * @param {Object} user
     * @param {Object} context
     * @returns {Object}
     */
    delete(ticketId, user, context = {}) {
        const ticket = this.ticketRepository.findById(ticketId);
        if (!ticket) {
            return { success: false, error: 'Ticket not found' };
        }

        const deleted = this.ticketRepository.delete(ticketId);

        this.auditRepository.log({
            userId: user.userId,
            username: user.username,
            action: 'ticket_deleted',
            resourceType: 'ticket',
            resourceId: ticketId,
            details: `Customer: ${ticket.customer_name}`,
            ipAddress: context.ip,
            userAgent: context.userAgent
        });

        return { success: deleted };
    }

    /**
     * Archive ticket
     * @param {string} ticketId
     * @param {Object} user
     * @param {Object} context
     * @returns {Object}
     */
    archive(ticketId, user, context = {}) {
        return this.updateStatus(ticketId, TICKET_STATUS.CLOSED, user, context);
    }

    /**
     * Get ticket statistics
     * @returns {Object}
     */
    getStats() {
        return this.ticketRepository.getStats();
    }

    /**
     * Cleanup old resolved tickets
     * @param {number} daysOld
     * @returns {number}
     */
    cleanupOld(daysOld = 15) {
        return this.ticketRepository.cleanupOldResolved(daysOld);
    }
}

module.exports = { TicketService };
