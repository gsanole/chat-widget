/**
 * Sites Routes
 * 
 * Single Responsibility: HTTP endpoints for multi-tenant site management
 */

const express = require('express');

/**
 * Create sites router
 * @param {Object} deps - Dependencies
 * @param {Object} deps.siteRepository - Site repository
 * @param {Object} deps.auditRepository - Audit repository
 * @param {Object} deps.authMiddleware - Auth middleware
 * @returns {Router}
 */
function createSitesRouter({ siteRepository, ticketRepository, auditRepository, authMiddleware }) {
    const router = express.Router();
    const { requireAuth, requirePermission } = authMiddleware;

    // Normalize allowed_origins input: accepts array or comma/newline-separated string.
    // Returns null (= allow all) if empty/falsy, else array of trimmed lowercase origins.
    function normalizeOrigins(input) {
        if (input == null || input === '') return null;
        const list = Array.isArray(input)
            ? input
            : String(input).split(/[,\n]/);
        const cleaned = list
            .map(s => String(s).trim().toLowerCase())
            .filter(Boolean);
        return cleaned.length ? cleaned : null;
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

    // Get all sites
    router.get('/', requireAuth, requirePermission('settings'), (req, res) => {
        const sites = siteRepository.findAll();
        res.json(sites);
    });

    // Get active sites (for dropdowns)
    router.get('/active', requireAuth, (req, res) => {
        const sites = siteRepository.findActive();
        res.json(sites.map(s => ({
            id: s.id,
            name: s.name,
            domain: s.domain
        })));
    });

    // Get single site
    router.get('/:id', requireAuth, requirePermission('settings'), (req, res) => {
        const site = siteRepository.findById(req.params.id);
        if (!site) {
            return res.status(404).json({ error: 'Site not found' });
        }
        res.json(site);
    });

    // Get site statistics
    router.get('/:id/stats', requireAuth, (req, res) => {
        const stats = siteRepository.getStats(req.params.id);
        res.json(stats);
    });

    // Create site
    router.post('/', requireAuth, requirePermission('settings'), (req, res) => {
        const { name, domain, description, allowed_origins } = req.body;

        if (!name || !domain) {
            return res.status(400).json({ error: 'Name and domain are required' });
        }

        // Check for duplicate domain
        const existing = siteRepository.findByDomain(domain);
        if (existing) {
            return res.status(400).json({ error: 'Domain already registered' });
        }

        const site = siteRepository.create({
            name,
            domain,
            description,
            allowed_origins: normalizeOrigins(allowed_origins)
        });
        auditLog(req, 'SITE_CREATED', 'site', site.id, { name, domain });

        res.status(201).json({ success: true, site, ...site });
    });

    // Update site (PUT alias for PATCH)
    const updateSiteHandler = (req, res) => {
        const { name, domain, description, is_active, color_primary, color_secondary, welcome_message, allowed_origins } = req.body;
        const site = siteRepository.findById(req.params.id);
        if (!site) return res.status(404).json({ error: 'Site not found' });
        if (domain && domain !== site.domain) {
            const existing = siteRepository.findByDomain(domain);
            if (existing) return res.status(400).json({ error: 'Domain already registered' });
        }
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (domain !== undefined) updates.domain = domain;
        if (description !== undefined) updates.description = description;
        if (is_active !== undefined) updates.is_active = is_active;
        if (color_primary !== undefined) updates.color_primary = color_primary;
        if (color_secondary !== undefined) updates.color_secondary = color_secondary;
        if (welcome_message !== undefined) updates.welcome_message = welcome_message;
        if (allowed_origins !== undefined) updates.allowed_origins = normalizeOrigins(allowed_origins);
        const updated = siteRepository.update(req.params.id, updates);
        auditLog(req, 'SITE_UPDATED', 'site', req.params.id, updates);
        res.json({ success: true, site: updated, ...(updated || {}) });
    };
    router.put('/:id', requireAuth, requirePermission('settings'), updateSiteHandler);
    router.put('/:id/chatbot', requireAuth, requirePermission('settings'), (req, res) => {
        const site = siteRepository.findById(req.params.id);
        if (!site) return res.status(404).json({ error: 'Site not found' });
        const updated = siteRepository.updateChatbotConfig(req.params.id, req.body.config || req.body);
        res.json({ success: true, site: updated });
    });

    // Update site
    router.patch('/:id', requireAuth, requirePermission('settings'), (req, res) => {
        const { name, domain, description, is_active, color_primary, color_secondary, welcome_message, allowed_origins } = req.body;

        const site = siteRepository.findById(req.params.id);
        if (!site) {
            return res.status(404).json({ error: 'Site not found' });
        }

        // Check for domain conflict if changing domain
        if (domain && domain !== site.domain) {
            const existing = siteRepository.findByDomain(domain);
            if (existing) {
                return res.status(400).json({ error: 'Domain already registered' });
            }
        }

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (domain !== undefined) updates.domain = domain;
        if (description !== undefined) updates.description = description;
        if (is_active !== undefined) updates.is_active = is_active;
        if (color_primary !== undefined) updates.color_primary = color_primary;
        if (color_secondary !== undefined) updates.color_secondary = color_secondary;
        if (welcome_message !== undefined) updates.welcome_message = welcome_message;
        if (allowed_origins !== undefined) updates.allowed_origins = normalizeOrigins(allowed_origins);

        const updated = siteRepository.update(req.params.id, updates);
        auditLog(req, 'SITE_UPDATED', 'site', req.params.id, updates);

        res.json({ success: true, site: updated });
    });

    // Get site chatbot config
    router.get('/:id/chatbot', requireAuth, (req, res) => {
        const site = siteRepository.findById(req.params.id);
        if (!site) return res.status(404).json({ error: 'Site not found' });
        res.json(site.chatbot_config || site.chatbotConfig || {});
    });

    // Update site chatbot config
    router.patch('/:id/chatbot', requireAuth, requirePermission('settings'), (req, res) => {
        const { config } = req.body;

        const site = siteRepository.findById(req.params.id);
        if (!site) {
            return res.status(404).json({ error: 'Site not found' });
        }

        const updated = siteRepository.updateChatbotConfig(req.params.id, config);
        auditLog(req, 'SITE_CHATBOT_UPDATED', 'site', req.params.id);

        res.json({ success: true, site: updated });
    });

    // Regenerate API key
    router.post('/:id/regenerate-key', requireAuth, requirePermission('settings'), (req, res) => {
        const site = siteRepository.findById(req.params.id);
        if (!site) {
            return res.status(404).json({ error: 'Site not found' });
        }

        const newKey = siteRepository.regenerateApiKey(req.params.id);
        auditLog(req, 'SITE_API_KEY_REGENERATED', 'site', req.params.id);

        res.json({ success: true, api_key: newKey });
    });

    // ===========================================
    // INTEGRATION (per-site webhook config)
    // ===========================================

    // Get integration config (omits secret for safety; only flags presence)
    router.get('/:id/integration', requireAuth, requirePermission('settings'), (req, res) => {
        const site = siteRepository.findById(req.params.id);
        if (!site) return res.status(404).json({ error: 'Site not found' });
        const integ = site.integration || {};
        res.json({
            enabled: !!integ.enabled,
            url: integ.url || null,
            events: integ.events || null,
            hasSecret: !!integ.secret
        });
    });

    // Replace integration config. Body: { enabled, url, secret?, events? }
    // If `secret` is omitted on first save, the server auto-generates one
    // and returns it ONCE in the response. Caller must store it.
    router.put('/:id/integration', requireAuth, requirePermission('settings'), (req, res) => {
        const site = siteRepository.findById(req.params.id);
        if (!site) return res.status(404).json({ error: 'Site not found' });

        const { enabled, url, secret, events } = req.body || {};
        let secretToStore = secret;
        let generatedSecret = null;
        if (!secretToStore) {
            // Reuse existing if any; otherwise generate.
            secretToStore = site.integration?.secret;
            if (!secretToStore) {
                secretToStore = require('crypto').randomBytes(32).toString('hex');
                generatedSecret = secretToStore;
            }
        }

        const updated = siteRepository.updateIntegration(req.params.id, {
            enabled,
            url,
            secret: secretToStore,
            events
        });

        auditLog(req, 'SITE_INTEGRATION_UPDATED', 'site', req.params.id, {
            url: updated?.integration?.url || null,
            enabled: !!updated?.integration?.enabled,
            secretRotated: !!generatedSecret
        });

        res.json({
            success: true,
            integration: updated?.integration
                ? {
                    enabled: !!updated.integration.enabled,
                    url: updated.integration.url,
                    events: updated.integration.events,
                    hasSecret: !!updated.integration.secret
                }
                : null,
            // Returned only when freshly generated. Never echoed back later.
            generatedSecret
        });
    });

    // Rotate the secret. Returns the new secret ONCE.
    router.post('/:id/integration/regenerate-secret', requireAuth, requirePermission('settings'), (req, res) => {
        const site = siteRepository.findById(req.params.id);
        if (!site) return res.status(404).json({ error: 'Site not found' });
        const newSecret = siteRepository.regenerateIntegrationSecret(req.params.id);
        auditLog(req, 'SITE_INTEGRATION_SECRET_ROTATED', 'site', req.params.id);
        res.json({ success: true, secret: newSecret });
    });

    // Disable / clear integration entirely
    router.delete('/:id/integration', requireAuth, requirePermission('settings'), (req, res) => {
        const site = siteRepository.findById(req.params.id);
        if (!site) return res.status(404).json({ error: 'Site not found' });
        siteRepository.updateIntegration(req.params.id, null);
        auditLog(req, 'SITE_INTEGRATION_DISABLED', 'site', req.params.id);
        res.json({ success: true });
    });

    // Delete site
    router.delete('/:id', requireAuth, requirePermission('settings'), (req, res) => {
        const site = siteRepository.findById(req.params.id);
        if (!site) {
            return res.status(404).json({ error: 'Site not found' });
        }

        // Block deletion if site has open tickets
        try {
            if (ticketRepository && ticketRepository.findAll) {
                const all = ticketRepository.findAll() || [];
                const openTickets = all.filter(t => (t.site_id === req.params.id || t.siteId === req.params.id) && (t.status === 'open' || t.status === 'in_progress' || t.status === 'active' || !t.status));
                if (openTickets.length > 0) {
                    return res.status(400).json({ error: 'Cannot delete site with open tickets' });
                }
            }
        } catch (e) { }

        const deleted = siteRepository.delete(req.params.id);
        if (deleted) {
            auditLog(req, 'SITE_DELETED', 'site', req.params.id, { name: site.name });
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to delete site' });
        }
    });

    return router;
}

module.exports = { createSitesRouter };
