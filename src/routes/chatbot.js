/**
 * Chatbot Routes
 * 
 * Single Responsibility: HTTP endpoints for chatbot configuration
 */

const express = require('express');
const ipUtils = require('../utils/ipUtils');
const { isOriginAllowed, SiteRateLimiter } = require('../utils/siteSecurity');

/**
 * Create chatbot router
 * @param {Object} deps - Dependencies
 * @param {Object} deps.chatbotService - Chatbot service
 * @param {Object} deps.auditRepository - Audit repository
 * @param {Object} deps.authMiddleware - Auth middleware
 * @param {Object} [deps.siteRepository] - Site repository (enables per-site origin/rate enforcement)
 * @returns {Router}
 */
function createChatbotRouter({ chatbotService, auditRepository, authMiddleware, siteRepository }) {
    const router = express.Router();
    const { requireAuth, requirePermission } = authMiddleware;

    // Per-site rate limiter for public widget endpoints (default 30 req/min/site).
    const siteLimiter = new SiteRateLimiter({ max: 30, windowMs: 60 * 1000 });

    /**
     * Resolve site from request (?siteApiKey=... or x-site-api-key header or body.siteApiKey)
     * and enforce origin + per-site rate limit.
     * Returns true if request should proceed, false if it has been rejected.
     */
    function enforceSiteSecurity(req, res) {
        if (!siteRepository) return true;
        const apiKey = (req.query && req.query.siteApiKey)
            || req.headers['x-site-api-key']
            || (req.body && req.body.siteApiKey)
            || null;
        if (!apiKey) return true; // anonymous widget calls remain allowed (back-compat)

        const site = siteRepository.findByApiKey(apiKey);
        if (!site) {
            res.status(401).json({ error: 'Invalid site API key' });
            return false;
        }

        const originHeader = req.headers.origin || req.headers.referer || '';
        if (!isOriginAllowed(site, originHeader)) {
            res.status(403).json({ error: 'Origin not allowed for this site' });
            return false;
        }

        if (!siteLimiter.check(site.api_key)) {
            res.status(429).json({ error: 'Too many requests for this site, slow down.' });
            return false;
        }

        req.site = site;
        return true;
    }

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

    // Get chatbot configuration (public; returns sanitized public fields)
    router.get('/config', (req, res) => {
        if (!enforceSiteSecurity(req, res)) return;
        const config = chatbotService.getConfig() || {};
        res.json({
            botName: config.botName || config.name || 'Assistant',
            enabled: config.enabled !== false,
            welcomeMessage: config.welcomeMessage || '',
            ...config
        });
    });

    // Public chatbot message endpoint (used by widget)
    router.post('/message', async (req, res) => {
        if (!enforceSiteSecurity(req, res)) return;
        const { message, siteConfig } = req.body || {};
        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Geo blocking enforcement (best-effort: if lookup fails, allow through)
        const cfg = chatbotService.getConfig() || {};
        const geoBlocking = cfg.geoBlocking;
        if (geoBlocking && geoBlocking.enabled) {
            try {
                const ip = ipUtils.getRealIP(null, req);
                if (ip && ip !== '127.0.0.1' && ip !== 'localhost' && ip !== 'unknown') {
                    const geo = await ipUtils.fetchIPGeo(ip);
                    const decision = ipUtils.isCountryBlocked(geo, geoBlocking);
                    if (decision.blocked) {
                        return res.status(403).json({
                            error: 'GEO_BLOCKED',
                            message: geoBlocking.blockedMessage ||
                                'Sorry, the chat is not available in your region.',
                            country: decision.country || null
                        });
                    }
                }
            } catch (e) {
                // fall through; do not break chat on geo lookup error
            }
        }

        const response = chatbotService.processMessage(message, siteConfig || null) || {};
        // Normalize response shape: ensure `message` field, rename type 'escalation' -> 'escalate'.
        // NOTE: Do not HTML-escape here. All clients (widget, admin) already escape on render,
        // so escaping here causes double-encoding (e.g. "I'm" -> "I&#39;m" displayed verbatim).
        const text = response.message || response.content || response.answer || '';
        const type = response.type === 'escalation' ? 'escalate' : (response.type || 'fallback');
        res.json({ ...response, type, message: text, content: text });
    });

    // Update chatbot configuration
    router.put('/config', requireAuth, requirePermission('settings'), (req, res) => {
        const config = req.body;

        if (!config) {
            return res.status(400).json({ error: 'Configuration is required' });
        }

        const saved = chatbotService.saveConfig(config);
        if (saved) {
            auditLog(req, 'CHATBOT_CONFIG_UPDATED', 'chatbot', null);
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to save configuration' });
        }
    });

    // Toggle chatbot enabled/disabled
    router.post('/toggle', requireAuth, requirePermission('settings'), (req, res) => {
        const config = chatbotService.getConfig();
        config.enabled = !config.enabled;

        const saved = chatbotService.saveConfig(config);
        if (saved) {
            auditLog(req, config.enabled ? 'CHATBOT_ENABLED' : 'CHATBOT_DISABLED', 'chatbot', null);
            res.json({ success: true, enabled: config.enabled });
        } else {
            res.status(500).json({ error: 'Failed to toggle chatbot' });
        }
    });

    // Get FAQ items
    router.get('/faq', requireAuth, (req, res) => {
        const config = chatbotService.getConfig();
        res.json(config.faq || []);
    });

    // Add FAQ item
    router.post('/faq', requireAuth, requirePermission('settings'), (req, res) => {
        const { question, answer, keywords } = req.body;

        if (!question || !answer) {
            return res.status(400).json({ error: 'Question and answer are required' });
        }

        const id = chatbotService.addFaq({ question, answer, keywords });
        auditLog(req, 'FAQ_ITEM_ADDED', 'chatbot', id, { question });

        res.json({ success: true, id });
    });

    // Update FAQ item
    router.patch('/faq/:id', requireAuth, requirePermission('settings'), (req, res) => {
        const { question, answer, keywords } = req.body;

        const updates = {};
        if (question !== undefined) updates.question = question;
        if (answer !== undefined) updates.answer = answer;
        if (keywords !== undefined) updates.keywords = keywords;

        const updated = chatbotService.updateFaq(req.params.id, updates);
        if (updated) {
            auditLog(req, 'FAQ_ITEM_UPDATED', 'chatbot', req.params.id);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'FAQ item not found' });
        }
    });

    // Delete FAQ item
    router.delete('/faq/:id', requireAuth, requirePermission('settings'), (req, res) => {
        const deleted = chatbotService.deleteFaq(req.params.id);
        if (deleted) {
            auditLog(req, 'FAQ_ITEM_DELETED', 'chatbot', req.params.id);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'FAQ item not found' });
        }
    });

    // Test chatbot response
    router.post('/test', requireAuth, (req, res) => {
        const { message, siteId } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Get site-specific config if provided
        let siteConfig = null;
        if (siteId) {
            // Would need siteRepository injected for this
            // For now, use global config
        }

        const response = chatbotService.processMessage(message, siteConfig);
        res.json(response);
    });

    // ============ ADMIN ENDPOINTS ============
    // Full config (admin)
    router.get('/admin/config', requireAuth, requirePermission('settings'), (req, res) => {
        res.json(chatbotService.getConfig() || {});
    });
    router.put('/admin/config', requireAuth, requirePermission('settings'), (req, res) => {
        try { chatbotService.saveConfig(req.body || {}); } catch (e) { }
        res.json({ success: true });
    });
    router.post('/admin/faq', requireAuth, requirePermission('settings'), (req, res) => {
        const body = req.body || {};
        const question = body.question || (Array.isArray(body.patterns) ? body.patterns[0] : body.patterns);
        const answer = body.answer || body.response;
        const keywords = body.keywords || body.patterns;
        if (!question || !answer) return res.status(400).json({ error: 'Question and answer are required' });
        try {
            const id = chatbotService.addFaq({ question, answer, keywords });
            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.put('/admin/faq/:id', requireAuth, requirePermission('settings'), (req, res) => {
        try {
            const updated = chatbotService.updateFaq(req.params.id, req.body || {});
            if (!updated) return res.status(404).json({ error: 'FAQ not found' });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.delete('/admin/faq/:id', requireAuth, requirePermission('settings'), (req, res) => {
        try {
            const ok = chatbotService.deleteFaq(req.params.id);
            if (!ok) return res.status(404).json({ error: 'FAQ not found' });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    return router;
}

module.exports = { createChatbotRouter };
