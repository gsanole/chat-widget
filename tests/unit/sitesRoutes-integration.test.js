/**
 * Unit tests for the per-site integration sub-routes mounted under
 * /api/sites/:id/integration.
 *
 * Covers:
 *   GET    /:id/integration                       (never returns the secret)
 *   PUT    /:id/integration                       (auto-generates secret on first save, returns once)
 *   POST   /:id/integration/regenerate-secret     (returns the new secret once)
 *   DELETE /:id/integration                       (clears)
 */

const request = require('supertest');
const { buildRouterApp } = require('./_routerTestHelper');
const { createSitesRouter } = require('../../src/routes/sites');

function build({ initialSite, audit = {}, repoOverrides = {} } = {}) {
    let stored = initialSite || {
        id: 's1',
        name: 'Site A',
        domain: 'a.com',
        integration: null
    };

    const siteRepository = {
        findById: jest.fn(id => (stored && stored.id === id ? stored : null)),
        findByDomain: jest.fn(() => null),
        findActive: jest.fn(() => []),
        findAll: jest.fn(() => [stored]),
        create: jest.fn(),
        update: jest.fn(),
        updateChatbotConfig: jest.fn(),
        regenerateApiKey: jest.fn(),
        delete: jest.fn(),
        getStats: jest.fn(() => ({})),
        updateIntegration: jest.fn((id, integration) => {
            if (!stored || stored.id !== id) return null;
            if (integration === null) {
                stored = { ...stored, integration: null };
                return stored;
            }
            stored = {
                ...stored,
                integration: {
                    enabled: integration.enabled !== false && !!integration.url,
                    url: integration.url ? String(integration.url).replace(/\/+$/, '') : null,
                    secret: integration.secret || null,
                    events: Array.isArray(integration.events) ? integration.events : null
                }
            };
            return stored;
        }),
        regenerateIntegrationSecret: jest.fn(id => {
            if (!stored || stored.id !== id) return null;
            const newSecret = 'rotated-' + Math.random().toString(16).slice(2);
            stored = {
                ...stored,
                integration: {
                    enabled: stored.integration?.enabled || false,
                    url: stored.integration?.url || null,
                    secret: newSecret,
                    events: stored.integration?.events || null
                }
            };
            return newSecret;
        }),
        ...repoOverrides
    };

    const auditRepository = { log: jest.fn(), ...audit };
    const ticketRepository = { findAll: jest.fn(() => []) };

    const app = buildRouterApp({
        basePath: '/api/sites',
        factory: createSitesRouter,
        deps: { siteRepository, ticketRepository, auditRepository }
    });

    return {
        app,
        siteRepository,
        auditRepository,
        getStored: () => stored
    };
}

describe('sites integration routes', () => {
    // -------------------------------------------------------------------
    // GET /:id/integration
    // -------------------------------------------------------------------
    test('GET 404 when site missing', async () => {
        const { app } = build({ initialSite: null });
        const res = await request(app).get('/api/sites/nope/integration');
        expect(res.status).toBe(404);
    });

    test('GET returns metadata only and never leaks the secret', async () => {
        const { app } = build({
            initialSite: {
                id: 's1', name: 'A', domain: 'a.com',
                integration: {
                    enabled: true,
                    url: 'https://hub.example.com',
                    secret: 'super-secret-value',
                    events: ['message']
                }
            }
        });
        const res = await request(app).get('/api/sites/s1/integration');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            enabled: true,
            url: 'https://hub.example.com',
            events: ['message'],
            hasSecret: true
        });
        expect(JSON.stringify(res.body)).not.toContain('super-secret-value');
    });

    test('GET reports defaults for sites with no integration', async () => {
        const { app } = build();
        const res = await request(app).get('/api/sites/s1/integration');
        expect(res.body).toEqual({
            enabled: false,
            url: null,
            events: null,
            hasSecret: false
        });
    });

    // -------------------------------------------------------------------
    // PUT /:id/integration
    // -------------------------------------------------------------------
    test('PUT 404 when site missing', async () => {
        const { app } = build({ initialSite: null });
        const res = await request(app)
            .put('/api/sites/x/integration')
            .send({ enabled: true, url: 'https://hub.example.com' });
        expect(res.status).toBe(404);
    });

    test('PUT auto-generates a secret on first save and returns it ONCE', async () => {
        const { app, getStored } = build();
        const res = await request(app)
            .put('/api/sites/s1/integration')
            .send({ enabled: true, url: 'https://hub.example.com' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.integration).toMatchObject({
            enabled: true,
            url: 'https://hub.example.com',
            hasSecret: true
        });
        expect(typeof res.body.generatedSecret).toBe('string');
        expect(res.body.generatedSecret.length).toBeGreaterThanOrEqual(32);
        // Secret IS stored
        expect(getStored().integration.secret).toBe(res.body.generatedSecret);
    });

    test('PUT does not regenerate if the site already has a secret', async () => {
        const { app } = build({
            initialSite: {
                id: 's1', name: 'A', domain: 'a.com',
                integration: { enabled: true, url: 'https://x', secret: 'preexisting', events: null }
            }
        });
        const res = await request(app)
            .put('/api/sites/s1/integration')
            .send({ enabled: true, url: 'https://hub.example.com' });
        expect(res.status).toBe(200);
        expect(res.body.generatedSecret).toBeNull();
        expect(res.body.integration.hasSecret).toBe(true);
    });

    test('PUT respects an explicitly supplied secret', async () => {
        const { app, getStored } = build();
        const res = await request(app)
            .put('/api/sites/s1/integration')
            .send({ enabled: true, url: 'https://hub.example.com', secret: 'caller-supplied' });
        expect(res.status).toBe(200);
        expect(res.body.generatedSecret).toBeNull();
        expect(getStored().integration.secret).toBe('caller-supplied');
    });

    test('PUT writes an audit log entry with secretRotated flag', async () => {
        const { app, auditRepository } = build();
        await request(app)
            .put('/api/sites/s1/integration')
            .send({ enabled: true, url: 'https://hub.example.com' });
        expect(auditRepository.log).toHaveBeenCalled();
        const call = auditRepository.log.mock.calls[0][0];
        expect(call.action).toBe('SITE_INTEGRATION_UPDATED');
        expect(call.resourceId).toBe('s1');
        expect(call.details.secretRotated).toBe(true);
    });

    // -------------------------------------------------------------------
    // POST /:id/integration/regenerate-secret
    // -------------------------------------------------------------------
    test('POST regenerate-secret returns new secret once and audits', async () => {
        const { app, auditRepository, getStored } = build({
            initialSite: {
                id: 's1', name: 'A', domain: 'a.com',
                integration: { enabled: true, url: 'https://x', secret: 'old', events: null }
            }
        });
        const res = await request(app).post('/api/sites/s1/integration/regenerate-secret');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(typeof res.body.secret).toBe('string');
        expect(res.body.secret).not.toBe('old');
        expect(getStored().integration.secret).toBe(res.body.secret);
        expect(auditRepository.log).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'SITE_INTEGRATION_SECRET_ROTATED' })
        );
    });

    test('POST regenerate-secret 404 when site missing', async () => {
        const { app } = build({ initialSite: null });
        const res = await request(app).post('/api/sites/x/integration/regenerate-secret');
        expect(res.status).toBe(404);
    });

    // -------------------------------------------------------------------
    // DELETE /:id/integration
    // -------------------------------------------------------------------
    test('DELETE clears the integration and audits', async () => {
        const { app, getStored, auditRepository } = build({
            initialSite: {
                id: 's1', name: 'A', domain: 'a.com',
                integration: { enabled: true, url: 'https://x', secret: 's', events: null }
            }
        });
        const res = await request(app).delete('/api/sites/s1/integration');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true });
        expect(getStored().integration).toBeNull();
        expect(auditRepository.log).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'SITE_INTEGRATION_DISABLED' })
        );
    });

    test('DELETE 404 when site missing', async () => {
        const { app } = build({ initialSite: null });
        const res = await request(app).delete('/api/sites/x/integration');
        expect(res.status).toBe(404);
    });
});
