/**
 * Branch-coverage tests for sites routes.
 * Targets each individual conditional in PUT /:id and PATCH /:id update handlers,
 * plus the domain-conflict branches and the "no findAll" defensive branches.
 */

const express = require('express');
const request = require('supertest');
const { createSitesRouter } = require('../../src/routes/sites');

function makeAuth() {
    return {
        requireAuth: (req, _res, next) => { req.user = { userId: 'u1', username: 'u', role: 'super_admin' }; next(); },
        requirePermission: () => (_req, _res, next) => next()
    };
}

function makeApp(deps) {
    const app = express();
    app.use(express.json());
    app.use('/api/sites', createSitesRouter(deps));
    return app;
}

function makeAuditRepo() { return { log: jest.fn() }; }

describe('sites routes - branch coverage for PUT /:id', () => {
    function setup({ initialSite = { id: 's1', name: 'Old', domain: 'old.com' }, conflictDomain = null } = {}) {
        const siteRepository = {
            findById: jest.fn(() => initialSite),
            findByDomain: jest.fn((d) => conflictDomain && d === conflictDomain ? { id: 'other' } : null),
            update: jest.fn((_id, updates) => ({ ...initialSite, ...updates })),
            findAll: jest.fn(() => [])
        };
        const ticketRepository = { findAll: jest.fn(() => []) };
        const app = makeApp({ siteRepository, ticketRepository, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        return { app, siteRepository };
    }

    test('returns 404 if site not found', async () => {
        const siteRepository = { findById: jest.fn(() => null) };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        await request(app).put('/api/sites/missing').send({ name: 'x' }).expect(404);
    });

    test('domain conflict returns 400', async () => {
        const { app } = setup({ conflictDomain: 'taken.com' });
        await request(app).put('/api/sites/s1').send({ domain: 'taken.com' }).expect(400);
    });

    test('updates name only', async () => {
        const { app, siteRepository } = setup();
        await request(app).put('/api/sites/s1').send({ name: 'New' }).expect(200);
        expect(siteRepository.update).toHaveBeenCalledWith('s1', { name: 'New' });
    });

    test('updates domain only', async () => {
        const { app, siteRepository } = setup();
        await request(app).put('/api/sites/s1').send({ domain: 'new.com' }).expect(200);
        expect(siteRepository.update).toHaveBeenCalledWith('s1', { domain: 'new.com' });
    });

    test('updates description only', async () => {
        const { app, siteRepository } = setup();
        await request(app).put('/api/sites/s1').send({ description: 'd' }).expect(200);
        expect(siteRepository.update).toHaveBeenCalledWith('s1', { description: 'd' });
    });

    test('updates is_active only', async () => {
        const { app, siteRepository } = setup();
        await request(app).put('/api/sites/s1').send({ is_active: false }).expect(200);
        expect(siteRepository.update).toHaveBeenCalledWith('s1', { is_active: false });
    });

    test('updates color_primary only', async () => {
        const { app, siteRepository } = setup();
        await request(app).put('/api/sites/s1').send({ color_primary: '#fff' }).expect(200);
        expect(siteRepository.update).toHaveBeenCalledWith('s1', { color_primary: '#fff' });
    });

    test('updates color_secondary only', async () => {
        const { app, siteRepository } = setup();
        await request(app).put('/api/sites/s1').send({ color_secondary: '#000' }).expect(200);
        expect(siteRepository.update).toHaveBeenCalledWith('s1', { color_secondary: '#000' });
    });

    test('updates welcome_message only', async () => {
        const { app, siteRepository } = setup();
        await request(app).put('/api/sites/s1').send({ welcome_message: 'hi' }).expect(200);
        expect(siteRepository.update).toHaveBeenCalledWith('s1', { welcome_message: 'hi' });
    });

    test('empty body sends empty updates object', async () => {
        const { app, siteRepository } = setup();
        await request(app).put('/api/sites/s1').send({}).expect(200);
        expect(siteRepository.update).toHaveBeenCalledWith('s1', {});
    });

    test('falsy update result still returns success', async () => {
        const initialSite = { id: 's1', name: 'X', domain: 'x.com' };
        const siteRepository = {
            findById: jest.fn(() => initialSite),
            findByDomain: jest.fn(() => null),
            update: jest.fn(() => null)
        };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        const res = await request(app).put('/api/sites/s1').send({ name: 'Y' }).expect(200);
        expect(res.body.success).toBe(true);
    });
});

describe('sites routes - branch coverage for PATCH /:id', () => {
    function setup({ initialSite = { id: 's1', name: 'Old', domain: 'old.com' }, conflictDomain = null } = {}) {
        const siteRepository = {
            findById: jest.fn(() => initialSite),
            findByDomain: jest.fn((d) => conflictDomain && d === conflictDomain ? { id: 'other' } : null),
            update: jest.fn((_id, updates) => ({ ...initialSite, ...updates }))
        };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        return { app, siteRepository };
    }

    test('PATCH 404 when missing', async () => {
        const siteRepository = { findById: jest.fn(() => null) };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        await request(app).patch('/api/sites/missing').send({ name: 'x' }).expect(404);
    });

    test('PATCH domain conflict 400', async () => {
        const { app } = setup({ conflictDomain: 'taken.com' });
        await request(app).patch('/api/sites/s1').send({ domain: 'taken.com' }).expect(400);
    });

    test('PATCH updates each field independently', async () => {
        for (const body of [
            { name: 'n' }, { domain: 'd.com' }, { description: 'x' },
            { is_active: true }, { color_primary: '#1' },
            { color_secondary: '#2' }, { welcome_message: 'w' }
        ]) {
            const { app } = setup();
            await request(app).patch('/api/sites/s1').send(body).expect(200);
        }
    });
});

describe('sites routes - DELETE /:id branches', () => {
    function setup(opts = {}) {
        const siteRepository = {
            findById: jest.fn(() => opts.site === undefined ? { id: 's1', name: 'X' } : opts.site),
            delete: jest.fn(() => opts.deleteResult !== undefined ? opts.deleteResult : true)
        };
        const ticketRepository = opts.ticketRepository === undefined
            ? { findAll: jest.fn(() => opts.tickets || []) }
            : opts.ticketRepository;
        const app = makeApp({ siteRepository, ticketRepository, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        return { app, siteRepository };
    }

    test('404 when site not found', async () => {
        const { app } = setup({ site: null });
        await request(app).delete('/api/sites/x').expect(404);
    });

    test('400 when site has open tickets', async () => {
        const { app } = setup({ tickets: [{ id: 't1', site_id: 's1', status: 'open' }] });
        await request(app).delete('/api/sites/s1').expect(400);
    });

    test('400 when site has tickets without status (treated as open)', async () => {
        const { app } = setup({ tickets: [{ id: 't1', siteId: 's1' }] });
        await request(app).delete('/api/sites/s1').expect(400);
    });

    test('200 when ticketRepository is missing findAll', async () => {
        const { app } = setup({ ticketRepository: {} });
        await request(app).delete('/api/sites/s1').expect(200);
    });

    test('200 when ticketRepository.findAll throws', async () => {
        const { app } = setup({ ticketRepository: { findAll: () => { throw new Error('x'); } } });
        await request(app).delete('/api/sites/s1').expect(200);
    });

    test('500 when delete returns falsy', async () => {
        const { app } = setup({ tickets: [], deleteResult: false });
        await request(app).delete('/api/sites/s1').expect(500);
    });

    test('200 when only resolved tickets exist', async () => {
        const { app } = setup({ tickets: [{ id: 't1', site_id: 's1', status: 'resolved' }] });
        await request(app).delete('/api/sites/s1').expect(200);
    });
});

describe('sites routes - PUT /:id/chatbot branches', () => {
    test('404 when site missing', async () => {
        const siteRepository = { findById: jest.fn(() => null), updateChatbotConfig: jest.fn() };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        await request(app).put('/api/sites/x/chatbot').send({ config: { a: 1 } }).expect(404);
    });

    test('uses req.body.config when present', async () => {
        const siteRepository = { findById: jest.fn(() => ({ id: 's1' })), updateChatbotConfig: jest.fn(() => ({ id: 's1' })) };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        await request(app).put('/api/sites/s1/chatbot').send({ config: { botName: 'A' } }).expect(200);
        expect(siteRepository.updateChatbotConfig).toHaveBeenCalledWith('s1', { botName: 'A' });
    });

    test('falls back to req.body when config missing', async () => {
        const siteRepository = { findById: jest.fn(() => ({ id: 's1' })), updateChatbotConfig: jest.fn(() => ({ id: 's1' })) };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        await request(app).put('/api/sites/s1/chatbot').send({ botName: 'B' }).expect(200);
        expect(siteRepository.updateChatbotConfig).toHaveBeenCalledWith('s1', { botName: 'B' });
    });
});

describe('sites routes - GET /:id/chatbot branches', () => {
    test('404 when missing', async () => {
        const siteRepository = { findById: jest.fn(() => null) };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        await request(app).get('/api/sites/x/chatbot').expect(404);
    });

    test('returns chatbot_config when present', async () => {
        const siteRepository = { findById: jest.fn(() => ({ id: 's1', chatbot_config: { x: 1 } })) };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        const res = await request(app).get('/api/sites/s1/chatbot').expect(200);
        expect(res.body).toEqual({ x: 1 });
    });

    test('falls back to chatbotConfig camelCase', async () => {
        const siteRepository = { findById: jest.fn(() => ({ id: 's1', chatbotConfig: { y: 2 } })) };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        const res = await request(app).get('/api/sites/s1/chatbot').expect(200);
        expect(res.body).toEqual({ y: 2 });
    });

    test('returns empty object when neither set', async () => {
        const siteRepository = { findById: jest.fn(() => ({ id: 's1' })) };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        const res = await request(app).get('/api/sites/s1/chatbot').expect(200);
        expect(res.body).toEqual({});
    });
});

describe('sites routes - PATCH /:id/chatbot, regenerate-key, POST / branches', () => {
    test('PATCH /:id/chatbot 404 when missing', async () => {
        const siteRepository = { findById: jest.fn(() => null) };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        await request(app).patch('/api/sites/x/chatbot').send({ config: {} }).expect(404);
    });

    test('regenerate-key 404 when missing', async () => {
        const siteRepository = { findById: jest.fn(() => null), regenerateApiKey: jest.fn() };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        await request(app).post('/api/sites/x/regenerate-key').expect(404);
    });

    test('regenerate-key 200', async () => {
        const siteRepository = { findById: jest.fn(() => ({ id: 's1' })), regenerateApiKey: jest.fn(() => 'NEWKEY') };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        const res = await request(app).post('/api/sites/s1/regenerate-key').expect(200);
        expect(res.body.api_key).toBe('NEWKEY');
    });

    test('POST / 400 when name or domain missing', async () => {
        const siteRepository = { findByDomain: jest.fn(), create: jest.fn() };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        await request(app).post('/api/sites').send({ name: 'X' }).expect(400);
        await request(app).post('/api/sites').send({ domain: 'x.com' }).expect(400);
        await request(app).post('/api/sites').send({}).expect(400);
    });

    test('POST / 400 when domain already exists', async () => {
        const siteRepository = { findByDomain: jest.fn(() => ({ id: 'exists' })), create: jest.fn() };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        await request(app).post('/api/sites').send({ name: 'X', domain: 'x.com' }).expect(400);
    });

    test('POST / 201 success', async () => {
        const siteRepository = { findByDomain: jest.fn(() => null), create: jest.fn(() => ({ id: 's1', name: 'X', domain: 'x.com' })) };
        const app = makeApp({ siteRepository, ticketRepository: {}, auditRepository: makeAuditRepo(), authMiddleware: makeAuth() });
        const res = await request(app).post('/api/sites').send({ name: 'X', domain: 'x.com' }).expect(201);
        expect(res.body.success).toBe(true);
        expect(res.body.id).toBe('s1');
    });
});
