/**
 * Ticket Routes
 * 
 * Single Responsibility: HTTP endpoints for ticket management
 */

const express = require('express');

/**
 * Create tickets router
 * @param {Object} deps - Dependencies
 * @param {Object} deps.ticketService - Ticket service
 * @param {Object} deps.ticketRepository - Ticket repository
 * @param {Object} deps.messageRepository - Message repository
 * @param {Object} deps.auditRepository - Audit repository
 * @param {Object} deps.authMiddleware - Auth middleware
 * @returns {Router}
 */
function createTicketsRouter({
    ticketService,
    ticketRepository,
    messageRepository,
    auditRepository,
    authMiddleware
}) {
    const router = express.Router();
    const { requireAuth, requirePermission } = authMiddleware;

    // Helper for audit logging
    function auditLog(req, action, resourceType = null, resourceId = null, details = null) {
        const ip = req.ip || req.socket?.remoteAddress;
        const userAgent = req.headers['user-agent'];
        auditRepository.log({
            userId: req.user?.userId || null,
            username: req.user?.username || 'anonymous',
            action,
            resourceType,
            resourceId,
            details,
            ipAddress: ip,
            userAgent
        });
    }

    // Get all tickets
    router.get('/', requireAuth, (req, res) => {
        const { status, siteId } = req.query;
        const filters = {};
        if (status) filters.status = status;
        if (siteId) filters.siteId = siteId;

        const tickets = ticketService.getAll(filters);
        res.json(tickets);
    });

    // Get open tickets
    router.get('/open', requireAuth, (req, res) => {
        const tickets = ticketService.getOpen();
        res.json(tickets);
    });

    // Get ticket statistics
    router.get('/stats', requireAuth, (req, res) => {
        const stats = ticketService.getStats();
        res.json(stats);
    });

    // Get single ticket with messages
    router.get('/:id', requireAuth, (req, res) => {
        const ticket = ticketService.getById(req.params.id);
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }
        res.json(ticket);
    });

    // Get ticket messages
    router.get('/:id/messages', requireAuth, (req, res) => {
        const limit = parseInt(req.query.limit) || 50;
        const messages = ticketService.getMessages(req.params.id, limit);
        res.json(messages);
    });

    // PUT /:id - generic ticket update (status, priority, notes, assignedTo, tags)
    router.put('/:id', requireAuth, (req, res) => {
        const ticket = ticketRepository.findById(req.params.id);
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
        const { status, priority, notes, assignedTo, tags } = req.body || {};
        let updated = ticket;
        if (status !== undefined && ticketRepository.updateStatus) {
            updated = ticketRepository.updateStatus(req.params.id, status) || updated;
        }
        if (priority !== undefined && ticketRepository.updatePriority) {
            updated = ticketRepository.updatePriority(req.params.id, priority) || updated;
        }
        if (notes !== undefined && ticketRepository.updateNotes) {
            updated = ticketRepository.updateNotes(req.params.id, notes) || updated;
        }
        if (assignedTo !== undefined && ticketRepository.assign) {
            updated = ticketRepository.assign(req.params.id, assignedTo) || updated;
        }
        if (tags !== undefined && ticketRepository.updateTags) {
            updated = ticketRepository.updateTags(req.params.id, tags) || updated;
        }
        auditLog(req, 'TICKET_UPDATED', 'ticket', req.params.id);
        res.json({ success: true, ticket: updated, ...(updated || {}) });
    });

    // Update ticket status
    router.patch('/:id/status', requireAuth, requirePermission('change_status'), (req, res) => {
        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const context = {
            ip: req.ip,
            userAgent: req.headers['user-agent']
        };

        const result = ticketService.updateStatus(req.params.id, status, req.user, context);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, ticket: result.ticket });
    });

    // Assign ticket
    router.patch('/:id/assign', requireAuth, requirePermission('manage_tickets'), (req, res) => {
        const { assigneeId } = req.body;

        const context = {
            ip: req.ip,
            userAgent: req.headers['user-agent']
        };

        const result = ticketService.assignTo(req.params.id, assigneeId, req.user, context);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, ticket: result.ticket });
    });

    // Update ticket priority
    router.patch('/:id/priority', requireAuth, requirePermission('manage_tickets'), (req, res) => {
        const { priority } = req.body;
        if (!priority) {
            return res.status(400).json({ error: 'Priority is required' });
        }

        const updated = ticketRepository.updatePriority(req.params.id, priority);
        if (!updated) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        auditLog(req, 'TICKET_PRIORITY_CHANGED', 'ticket', req.params.id, { priority });
        res.json({ success: true, ticket: updated });
    });

    // Update ticket notes
    router.patch('/:id/notes', requireAuth, (req, res) => {
        const { notes } = req.body;

        const updated = ticketRepository.updateNotes(req.params.id, notes);
        if (!updated) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        res.json({ success: true, ticket: updated });
    });

    // Update ticket tags
    router.patch('/:id/tags', requireAuth, (req, res) => {
        const { tags } = req.body;

        const updated = ticketRepository.updateTags(req.params.id, tags);
        if (!updated) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        res.json({ success: true, ticket: updated });
    });

    // Archive ticket
    router.post('/:id/archive', requireAuth, requirePermission('archive_tickets'), (req, res) => {
        const context = {
            ip: req.ip,
            userAgent: req.headers['user-agent']
        };

        const result = ticketService.archive(req.params.id, req.user, context);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true });
    });

    // Delete ticket
    router.delete('/:id', requireAuth, requirePermission('delete_tickets'), (req, res) => {
        const context = {
            ip: req.ip,
            userAgent: req.headers['user-agent']
        };

        const result = ticketService.delete(req.params.id, req.user, context);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true });
    });

    return router;
}

module.exports = { createTicketsRouter };
