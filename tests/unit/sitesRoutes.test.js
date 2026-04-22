/**
 * Unit tests for src/routes/sites.js
 */

const request = require('supertest');
const { buildRouterApp } = require('./_routerTestHelper');
const { createSitesRouter } = require('../../src/routes/sites');

function build({ siteRepo = {}, ticketRepo, audit = {} } = {}) {
    const siteRepository = {
        findAll: jest.fn(() => [{ id: 's1' }]),
        findActive: jest.fn(() => [{ id: 's1', name: 'A', domain: 'a.com', secret: 'x' }]),
        findById: jest.fn(() => ({ id: 's1', name: 'A', domain: 'a.com' })),
        findByDomain: jest.fn(() => null),
        create: jest.fn(({ name, domain }) => ({ id: 's-new', name, domain })),
        update: jest.fn((id, u) => ({ id, ...u })),
        updateChatbotConfig: jest.fn((id, c) => ({ id, chatbot_config: c })),
        regenerateApiKey: jest.fn(() => 'new-key'),
        delete: jest.fn(() => true),
        getStats: jest.fn(() => ({ tickets: 3 })),
        ...siteRepo
    };
    const auditRepository = { log: jest.fn(), ...audit };
    const ticketRepository = ticketRepo || { findAll: jest.fn(() => []) };
    const app = buildRouterApp({
        basePath: '/api/sites',
        factory: createSitesRouter,
        deps: { siteRepository, ticketRepository, auditRepository }
    });
    return { app, siteRepository, ticketRepository, auditRepository };
}

describe('sites routes', () => {
    test('GET /', async () => {
        const { app } = build();
        const res = await request(app).get('/api/sites');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('GET /active strips internal fields', async () => {
        const { app } = build();
        const res = await request(app).get('/api/sites/active');
        expect(res.status).toBe(200);
        expect(res.body[0]).toEqual({ id: 's1', name: 'A', domain: 'a.com' });
    });

    test('GET /:id 404 when missing', async () => {
        const { app } = build({ siteRepo: { findById: () => null } });
        const res = await request(app).get('/api/sites/x');
        expect(res.status).toBe(404);
    });

    test('GET /:id success', async () => {
        const { app } = build();
        const res = await request(app).get('/api/sites/s1');
        expect(res.status).toBe(200);
    });

    test('GET /:id/stats', async () => {
        const { app } = build();
        const res = await request(app).get('/api/sites/s1/stats');
        expect(res.body).toEqual({ tickets: 3 });
    });

    test('POST / requires name+domain', async () => {
        const { app } = build();
        const res = await request(app).post('/api/sites').send({ name: 'X' });
        expect(res.status).toBe(400);
    });

    test('POST / blocks duplicate domain', async () => {
        const { app } = build({ siteRepo: { findByDomain: () => ({ id: 'dup' }) } });
        const res = await request(app).post('/api/sites').send({ name: 'X', domain: 'a.com' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Domain already/);
    });

    test('POST / creates and audits', async () => {
        const { app, auditRepository } = build();
        const res = await request(app).post('/api/sites').send({ name: 'X', domain: 'x.com' });
        expect(res.status).toBe(201);
        expect(auditRepository.log).toHaveBeenCalled();
    });

    test('PUT /:id 404 when missing', async () => {
        const { app } = build({ siteRepo: { findById: () => null } });
        const res = await request(app).put('/api/sites/x').send({ name: 'Y' });
        expect(res.status).toBe(404);
    });

    test('PUT /:id rejects domain conflict', async () => {
        const { app } = build({
            siteRepo: {
                findById: () => ({ id: 's1', domain: 'a.com' }),
                findByDomain: () => ({ id: 'other' })
            }
        });
        const res = await request(app).put('/api/sites/s1').send({ domain: 'b.com' });
        expect(res.status).toBe(400);
    });

    test('PUT /:id applies provided fields and audits', async () => {
        const { app, siteRepository, auditRepository } = build();
        const res = await request(app)
            .put('/api/sites/s1')
            .send({ name: 'New', is_active: false, color_primary: '#fff' });
        expect(res.status).toBe(200);
        expect(siteRepository.update).toHaveBeenCalledWith('s1', expect.objectContaining({
            name: 'New',
            is_active: false,
            color_primary: '#fff'
        }));
        expect(auditRepository.log).toHaveBeenCalled();
    });

    test('PUT /:id/chatbot 404 when missing', async () => {
        const { app } = build({ siteRepo: { findById: () => null } });
        const res = await request(app).put('/api/sites/x/chatbot').send({ config: { a: 1 } });
        expect(res.status).toBe(404);
    });

    test('PUT /:id/chatbot success', async () => {
        const { app, siteRepository } = build();
        const res = await request(app).put('/api/sites/s1/chatbot').send({ config: { greeting: 'hi' } });
        expect(res.status).toBe(200);
        expect(siteRepository.updateChatbotConfig).toHaveBeenCalled();
    });

    test('PATCH /:id matches PUT update logic', async () => {
        const { app } = build();
        const res = await request(app).patch('/api/sites/s1').send({ name: 'P' });
        expect(res.status).toBe(200);
    });

    test('PATCH /:id 404 + domain conflict', async () => {
        const r404 = build({ siteRepo: { findById: () => null } });
        expect((await request(r404.app).patch('/api/sites/x').send({ name: 'X' })).status).toBe(404);

        const dup = build({
            siteRepo: {
                findById: () => ({ id: 's1', domain: 'a.com' }),
                findByDomain: () => ({ id: 'other' })
            }
        });
        const r = await request(dup.app).patch('/api/sites/s1').send({ domain: 'b.com' });
        expect(r.status).toBe(400);
    });

    test('GET /:id/chatbot 404', async () => {
        const { app } = build({ siteRepo: { findById: () => null } });
        const res = await request(app).get('/api/sites/x/chatbot');
        expect(res.status).toBe(404);
    });

    test('GET /:id/chatbot returns config', async () => {
        const { app } = build({
            siteRepo: { findById: () => ({ id: 's1', chatbot_config: { greeting: 'hi' } }) }
        });
        const res = await request(app).get('/api/sites/s1/chatbot');
        expect(res.body).toEqual({ greeting: 'hi' });
    });

    test('PATCH /:id/chatbot 404', async () => {
        const { app } = build({ siteRepo: { findById: () => null } });
        const res = await request(app).patch('/api/sites/x/chatbot').send({ config: {} });
        expect(res.status).toBe(404);
    });

    test('PATCH /:id/chatbot success audits', async () => {
        const { app, auditRepository } = build();
        const res = await request(app).patch('/api/sites/s1/chatbot').send({ config: { x: 1 } });
        expect(res.status).toBe(200);
        expect(auditRepository.log).toHaveBeenCalled();
    });

    test('POST /:id/regenerate-key 404 + success', async () => {
        const r404 = build({ siteRepo: { findById: () => null } });
        expect((await request(r404.app).post('/api/sites/x/regenerate-key')).status).toBe(404);

        const ok = build();
        const res = await request(ok.app).post('/api/sites/s1/regenerate-key');
        expect(res.status).toBe(200);
        expect(res.body.api_key).toBe('new-key');
    });

    test('DELETE /:id 404', async () => {
        const { app } = build({ siteRepo: { findById: () => null } });
        const res = await request(app).delete('/api/sites/x');
        expect(res.status).toBe(404);
    });

    test('DELETE /:id blocks when open tickets exist', async () => {
        const { app } = build({
            ticketRepo: { findAll: () => [{ site_id: 's1', status: 'open' }] }
        });
        const res = await request(app).delete('/api/sites/s1');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/open tickets/);
    });

    test('DELETE /:id success when no blocking tickets', async () => {
        const { app, auditRepository } = build();
        const res = await request(app).delete('/api/sites/s1');
        expect(res.status).toBe(200);
        expect(auditRepository.log).toHaveBeenCalled();
    });

    test('DELETE /:id 500 when repository.delete returns false', async () => {
        const { app } = build({ siteRepo: { delete: () => false } });
        const res = await request(app).delete('/api/sites/s1');
        expect(res.status).toBe(500);
    });
});
