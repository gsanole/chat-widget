/**
 * Site Integration Inbound Routes
 *
 * Path-scoped inbound REST endpoints. Lets a site's external backend
 * push agent replies and ticket-status changes back into this server
 * WITHOUT holding a Socket.IO admin connection open.
 *
 * Multi-tenant: each site owns its own integration.secret. The receiver
 * MUST sign the raw request body with HMAC-SHA256 using THAT site's
 * secret and put it in `X-Chat-Signature: sha256=<hex>`.
 *
 * Loop avoidance: messages saved here go straight to messageRepository
 * and are emitted into the chat room. They do NOT go through the
 * `admin:message` socket handler, so they are never re-mirrored to
 * the site's outbound webhook. Saved rows are tagged `source: 'integration'`.
 */

const express = require('express');
const { sanitizeMessage } = require('../middleware/validation');
const { verifySignature } = require('../services/lygHubWebhook');
const { OUT } = require('../socket/events');

function createIntegrationsRouter({
    io,
    messageRepository,
    ticketRepository,
    siteRepository,
    auditRepository,
    getSessions,
    getAdminSockets
}) {
    const router = express.Router();

    function broadcastToAdmins(event, data) {
        const adminSockets = typeof getAdminSockets === 'function' ? getAdminSockets() : null;
        if (!adminSockets) return;
        for (const { socket } of adminSockets.values()) {
            socket.emit(event, data);
        }
    }

    function audit(action, siteId, resourceId, details, req) {
        if (!auditRepository) return;
        try {
            auditRepository.log({
                userId: null,
                username: `integration:${siteId || 'unknown'}`,
                action,
                resourceType: 'ticket',
                resourceId,
                details,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent']
            });
        } catch (_) { /* never block on audit */ }
    }

    /**
     * Resolves the site by :siteId, verifies HMAC against THAT site's
     * integration.secret, and attaches `req.site` for the handler.
     * Requires `req.rawBody` (captured by app.js express.json verify hook).
     */
    function verifySiteHmac(req, res, next) {
        const site = siteRepository?.findById ? siteRepository.findById(req.params.siteId) : null;
        if (!site) return res.status(404).json({ error: 'Site not found' });

        const secret = site.integration?.secret;
        if (!secret || !site.integration?.enabled) {
            return res.status(403).json({ error: 'Integration not enabled for this site' });
        }

        const sig = req.headers['x-chat-signature'];
        if (!sig || !req.rawBody) return res.status(401).json({ error: 'Missing signature' });
        if (!verifySignature(req.rawBody, sig, secret)) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        req.site = site;
        next();
    }

    /**
     * POST /api/integrations/sites/:siteId/messages
     * Body: { sessionId, text, senderName?, senderId?, messageId? }
     */
    router.post('/sites/:siteId/messages', verifySiteHmac, (req, res) => {
        const { sessionId, text, senderName = 'Agent', senderId = null, messageId = null } = req.body || {};
        if (!sessionId || !text || typeof text !== 'string') {
            return res.status(400).json({ error: 'sessionId and text are required' });
        }

        const ticket = ticketRepository.findById(sessionId);
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        // Tenant isolation.
        if (ticket.site_id && ticket.site_id !== req.site.id) {
            return res.status(403).json({ error: 'Ticket does not belong to this site' });
        }

        // Idempotency.
        if (messageId) {
            try {
                const prior = messageRepository.findByTicket(sessionId)
                    .find(m => m.external_id === messageId);
                if (prior) {
                    return res.json({ success: true, duplicate: true, id: prior.id });
                }
            } catch (_) { /* fall through */ }
        }

        const sanitized = sanitizeMessage(text);
        const timestamp = Date.now();

        const saved = messageRepository.create({
            ticketId: sessionId,
            senderType: 'admin',
            senderId,
            senderName,
            content: sanitized
        });

        try {
            if (messageRepository.db && typeof messageRepository.db.update === 'function') {
                messageRepository.db.update(
                    m => m.id === saved.id,
                    { external_id: messageId || null, source: 'integration' }
                );
            }
        } catch (_) { /* best-effort */ }

        ticketRepository.updateLastMessage(sessionId);

        const msg = {
            id: saved.id,
            ticketId: sessionId,
            sender: 'admin',
            senderId,
            senderName,
            message: sanitized,
            timestamp,
            source: 'integration'
        };

        io.to(`chat:${sessionId}`).emit(OUT.CHAT_MESSAGE, msg);

        const sessions = typeof getSessions === 'function' ? getSessions() : null;
        const session = sessions ? sessions.get(sessionId) : null;
        if (session) {
            session.lastActivity = timestamp;
            if (!session.hasAdminJoined) {
                session.unreadCount = (session.unreadCount || 0) + 1;
            }
        }

        broadcastToAdmins(OUT.SESSION_UPDATED, {
            sessionId,
            updates: {
                lastActivity: timestamp,
                unreadCount: session?.unreadCount ?? undefined
            }
        });
        if (!session?.hasAdminJoined) {
            broadcastToAdmins(OUT.SESSION_NEW_MESSAGE, {
                sessionId,
                message: msg,
                customerName: session?.name || ticket.customer_name
            });
        }

        audit('INTEGRATION_MESSAGE_RECEIVED', req.site.id, sessionId, { messageId, senderName }, req);
        res.json({ success: true, id: saved.id });
    });

    /**
     * POST /api/integrations/sites/:siteId/status
     * Body: { sessionId, status }
     */
    router.post('/sites/:siteId/status', verifySiteHmac, (req, res) => {
        const { sessionId, status } = req.body || {};
        if (!sessionId || !status) {
            return res.status(400).json({ error: 'sessionId and status are required' });
        }

        const ticket = ticketRepository.findById(sessionId);
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
        if (ticket.site_id && ticket.site_id !== req.site.id) {
            return res.status(403).json({ error: 'Ticket does not belong to this site' });
        }

        ticketRepository.updateStatus(sessionId, status);

        const sessions = typeof getSessions === 'function' ? getSessions() : null;
        const session = sessions ? sessions.get(sessionId) : null;
        if (session && (status === 'resolved' || status === 'closed' || status === 'archived')) {
            try {
                if (session.socket && session.socket.connected) {
                    session.socket.emit(OUT.SESSION_CLOSED_BY_ADMIN, {
                        message: 'This conversation was closed.',
                        reason: status
                    });
                    session.socket.disconnect(true);
                }
            } catch (_) { /* ignore */ }
            sessions.delete(sessionId);
        }

        broadcastToAdmins(OUT.SESSION_UPDATED, {
            sessionId,
            updates: { ticketStatus: status, status }
        });
        if (status === 'archived' || status === 'resolved') {
            broadcastToAdmins(OUT.SESSION_REMOVED, { sessionId });
        }

        audit('INTEGRATION_STATUS_CHANGED', req.site.id, sessionId, { status }, req);
        res.json({ success: true });
    });

    /**
     * GET /api/integrations/sites/:siteId/health
     * Unauthenticated readiness probe. Never leaks the secret.
     */
    router.get('/sites/:siteId/health', (req, res) => {
        const site = siteRepository?.findById ? siteRepository.findById(req.params.siteId) : null;
        if (!site) return res.status(404).json({ error: 'Site not found' });
        res.json({
            ok: true,
            siteId: site.id,
            integrationEnabled: !!(site.integration?.enabled && site.integration?.secret && site.integration?.url)
        });
    });

    return router;
}

module.exports = { createIntegrationsRouter };
