/**
 * Unit tests for src/routes/tickets.js
 *
 * Mocks ticketService + ticketRepository + auditRepository and exercises
 * each endpoint path including the not-found and validation branches.
 */

const request = require('supertest');
const { buildRouterApp } = require('./_routerTestHelper');
const { createTicketsRouter } = require('../../src/routes/tickets');

function build({ service = {}, repo = {}, audit = {} } = {}) {
    const ticketService = {
        getAll: jest.fn(() => [{ id: 't1' }]),
        getOpen: jest.fn(() => [{ id: 't1', status: 'OPEN' }]),
        getStats: jest.fn(() => ({ open: 1 })),
        getById: jest.fn(() => ({ id: 't1' })),
        getMessages: jest.fn(() => [{ id: 'm1' }]),
        updateStatus: jest.fn(() => ({ success: true, ticket: { id: 't1' } })),
        assignTo: jest.fn(() => ({ success: true, ticket: { id: 't1' } })),
        archive: jest.fn(() => ({ success: true })),
        delete: jest.fn(() => ({ success: true })),
        ...service
    };
    const ticketRepository = {
        findById: jest.fn(() => ({ id: 't1', status: 'OPEN' })),
        updateStatus: jest.fn((id, s) => ({ id, status: s })),
        updatePriority: jest.fn((id, p) => ({ id, priority: p })),
        updateNotes: jest.fn((id, n) => ({ id, notes: n })),
        assign: jest.fn((id, a) => ({ id, assignedTo: a })),
        updateTags: jest.fn((id, t) => ({ id, tags: t })),
        ...repo
    };
    const auditRepository = { log: jest.fn(), ...audit };
    const messageRepository = {};
    const app = buildRouterApp({
        basePath: '/api/tickets',
        factory: createTicketsRouter,
        deps: { ticketService, ticketRepository, messageRepository, auditRepository }
    });
    return { app, ticketService, ticketRepository, auditRepository };
}

describe('tickets routes', () => {
    test('GET / with status+siteId filters', async () => {
        const { app, ticketService } = build();
        await request(app).get('/api/tickets?status=OPEN&siteId=s1');
        expect(ticketService.getAll).toHaveBeenCalledWith({ status: 'OPEN', siteId: 's1' });
    });

    test('GET /open', async () => {
        const { app, ticketService } = build();
        const res = await request(app).get('/api/tickets/open');
        expect(res.status).toBe(200);
        expect(ticketService.getOpen).toHaveBeenCalled();
    });

    test('GET /stats', async () => {
        const { app } = build();
        const res = await request(app).get('/api/tickets/stats');
        expect(res.body).toEqual({ open: 1 });
    });

    test('GET /:id 404 when missing', async () => {
        const { app } = build({ service: { getById: jest.fn(() => null) } });
        const res = await request(app).get('/api/tickets/missing');
        expect(res.status).toBe(404);
    });

    test('GET /:id/messages with limit', async () => {
        const { app, ticketService } = build();
        await request(app).get('/api/tickets/t1/messages?limit=10');
        expect(ticketService.getMessages).toHaveBeenCalledWith('t1', 10);
    });

    test('PUT /:id 404 when ticket missing', async () => {
        const { app } = build({ repo: { findById: jest.fn(() => null) } });
        const res = await request(app).put('/api/tickets/missing').send({ status: 'OPEN' });
        expect(res.status).toBe(404);
    });

    test('PUT /:id calls all matching update methods + audits', async () => {
        const { app, ticketRepository, auditRepository } = build();
        const res = await request(app)
            .put('/api/tickets/t1')
            .send({ status: 'RESOLVED', priority: 'HIGH', notes: 'n', assignedTo: 'u', tags: ['x'] });
        expect(res.status).toBe(200);
        expect(ticketRepository.updateStatus).toHaveBeenCalledWith('t1', 'RESOLVED');
        expect(ticketRepository.updatePriority).toHaveBeenCalledWith('t1', 'HIGH');
        expect(ticketRepository.updateNotes).toHaveBeenCalledWith('t1', 'n');
        expect(ticketRepository.assign).toHaveBeenCalledWith('t1', 'u');
        expect(ticketRepository.updateTags).toHaveBeenCalledWith('t1', ['x']);
        expect(auditRepository.log).toHaveBeenCalled();
    });

    test('PATCH /:id/status requires body.status', async () => {
        const { app } = build();
        const res = await request(app).patch('/api/tickets/t1/status').send({});
        expect(res.status).toBe(400);
    });

    test('PATCH /:id/status delegates to service; success=false bubbles 400', async () => {
        const { app } = build({
            service: { updateStatus: jest.fn(() => ({ success: false, error: 'bad transition' })) }
        });
        const res = await request(app).patch('/api/tickets/t1/status').send({ status: 'X' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('bad transition');
    });

    test('PATCH /:id/status success path', async () => {
        const { app } = build();
        const res = await request(app).patch('/api/tickets/t1/status').send({ status: 'OPEN' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('PATCH /:id/assign success and failure', async () => {
        const ok = build();
        const okRes = await request(ok.app).patch('/api/tickets/t1/assign').send({ assigneeId: 'u' });
        expect(okRes.status).toBe(200);

        const fail = build({
            service: { assignTo: jest.fn(() => ({ success: false, error: 'nope' })) }
        });
        const failRes = await request(fail.app).patch('/api/tickets/t1/assign').send({ assigneeId: 'u' });
        expect(failRes.status).toBe(400);
    });

    test('PATCH /:id/priority requires priority + handles 404', async () => {
        const { app } = build();
        const noBody = await request(app).patch('/api/tickets/t1/priority').send({});
        expect(noBody.status).toBe(400);

        const missing = build({ repo: { updatePriority: jest.fn(() => null) } });
        const res404 = await request(missing.app)
            .patch('/api/tickets/x/priority')
            .send({ priority: 'HIGH' });
        expect(res404.status).toBe(404);
    });

    test('PATCH /:id/priority audits on success', async () => {
        const { app, auditRepository } = build();
        const res = await request(app)
            .patch('/api/tickets/t1/priority')
            .send({ priority: 'LOW' });
        expect(res.status).toBe(200);
        expect(auditRepository.log).toHaveBeenCalled();
    });

    test('PATCH /:id/notes 404 when ticket missing', async () => {
        const { app } = build({ repo: { updateNotes: jest.fn(() => null) } });
        const res = await request(app).patch('/api/tickets/x/notes').send({ notes: 'n' });
        expect(res.status).toBe(404);
    });

    test('PATCH /:id/tags happy path', async () => {
        const { app } = build();
        const res = await request(app).patch('/api/tickets/t1/tags').send({ tags: ['a'] });
        expect(res.status).toBe(200);
    });

    test('PATCH /:id/tags 404', async () => {
        const { app } = build({ repo: { updateTags: jest.fn(() => null) } });
        const res = await request(app).patch('/api/tickets/x/tags').send({ tags: [] });
        expect(res.status).toBe(404);
    });

    test('POST /:id/archive success and failure', async () => {
        const ok = build();
        expect((await request(ok.app).post('/api/tickets/t1/archive')).status).toBe(200);
        const fail = build({ service: { archive: jest.fn(() => ({ success: false, error: 'no' })) } });
        const r = await request(fail.app).post('/api/tickets/t1/archive');
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('no');
    });

    test('DELETE /:id success and failure', async () => {
        const ok = build();
        expect((await request(ok.app).delete('/api/tickets/t1')).status).toBe(200);
        const fail = build({ service: { delete: jest.fn(() => ({ success: false, error: 'no' })) } });
        const r = await request(fail.app).delete('/api/tickets/t1');
        expect(r.status).toBe(400);
    });
});
