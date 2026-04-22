/**
 * Audit Routes
 * 
 * Single Responsibility: HTTP endpoints for audit logs
 */

const express = require('express');

/**
 * Create audit router
 * @param {Object} deps - Dependencies
 * @param {Object} deps.auditRepository - Audit repository
 * @param {Object} deps.authMiddleware - Auth middleware
 * @returns {Router}
 */
function createAuditRouter({ auditRepository, authMiddleware }) {
    const router = express.Router();
    const { requireAuth, requirePermission } = authMiddleware;

    // Get audit logs
    router.get('/', requireAuth, requirePermission('view_audit'), (req, res) => {
        const limit = parseInt(req.query.limit) || 100;
        const logs = auditRepository.findAll(limit);
        res.json(logs);
    });

    // Get logs by user
    router.get('/user/:userId', requireAuth, requirePermission('view_audit'), (req, res) => {
        const limit = parseInt(req.query.limit) || 100;
        const logs = auditRepository.findByUser(req.params.userId, limit);
        res.json(logs);
    });

    // Get logs by action
    router.get('/action/:action', requireAuth, requirePermission('view_audit'), (req, res) => {
        const limit = parseInt(req.query.limit) || 100;
        const logs = auditRepository.findByAction(req.params.action, limit);
        res.json(logs);
    });

    // Get logs by resource
    router.get('/resource/:type/:id', requireAuth, requirePermission('view_audit'), (req, res) => {
        const logs = auditRepository.findByResource(req.params.type, req.params.id);
        res.json(logs);
    });

    // Get logs by date range
    router.get('/range', requireAuth, requirePermission('view_audit'), (req, res) => {
        const { start, end } = req.query;
        if (!start || !end) {
            return res.status(400).json({ error: 'Start and end timestamps required' });
        }
        const logs = auditRepository.findByDateRange(parseInt(start), parseInt(end));
        res.json(logs);
    });

    return router;
}

module.exports = { createAuditRouter };
