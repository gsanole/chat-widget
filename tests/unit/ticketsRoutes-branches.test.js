/**
 * Extra branch coverage for src/routes/tickets.js PUT /:id
 *
 * The PUT handler has 5 conditional update branches (status, priority,
 * notes, assignedTo, tags) that each check both `field !== undefined`
 * AND `repo.<method>` exists. The existing tests only cover the path
 * where all fields are present and all methods exist. These tests
 * exercise the falsy halves.
 */

const request = require('supertest');
const { buildRouterApp } = require('./_routerTestHelper');
const { createTicketsRouter } = require('../../src/routes/tickets');

function build({ service = {}, repo = {}, audit = {} } = {}) {
    const ticketService = {
        getAll: jest.fn(() => []),
        getOpen: jest.fn(() => []),
        getStats: jest.fn(() => ({})),
        getById: jest.fn(() => null),
        getMessages: jest.fn(() => []),
        updateStatus: jest.fn(() => ({ success: true, ticket: {} })),
        assignTo: jest.fn(() => ({ success: true, ticket: {} })),
        archive: jest.fn(() => ({ success: true })),
        delete: jest.fn(() => ({ success: true })),
        ...service
    };
    const ticketRepository = {
        findById: jest.fn(() => ({ id: 't1' })),
        ...repo
    };
    const auditRepository = { log: jest.fn(), ...audit };
    const app = buildRouterApp({
        basePath: '/api/tickets',
        factory: createTicketsRouter,
        deps: { ticketService, ticketRepository, messageRepository: {}, auditRepository }
    });
    return { app, ticketRepository, auditRepository, ticketService };
}

describe('PUT /:id branch coverage', () => {
    test('PUT /:id with empty body still 200 (no updates applied)', async () => {
        const { app, auditRepository } = build();
        const res = await request(app).put('/api/tickets/t1').send({});
        expect(res.status).toBe(200);
        expect(auditRepository.log).toHaveBeenCalled();
    });

    test('PUT /:id only status, repo lacks updateStatus -> branch falsy', async () => {
        // updateStatus key absent on repo: condition (ticketRepository.updateStatus) is false
        const { app } = build({ repo: { findById: jest.fn(() => ({ id: 't1' })) } });
        const res = await request(app).put('/api/tickets/t1').send({ status: 'X' });
        expect(res.status).toBe(200);
    });

    test('PUT /:id only priority, repo provides updatePriority', async () => {
        const updatePriority = jest.fn(() => ({ id: 't1', priority: 'HI' }));
        const { app } = build({ repo: { findById: jest.fn(() => ({ id: 't1' })), updatePriority } });
        const res = await request(app).put('/api/tickets/t1').send({ priority: 'HI' });
        expect(res.status).toBe(200);
        expect(updatePriority).toHaveBeenCalledWith('t1', 'HI');
    });

    test('PUT /:id only notes, repo provides updateNotes', async () => {
        const updateNotes = jest.fn(() => ({ id: 't1', notes: 'n' }));
        const { app } = build({ repo: { findById: jest.fn(() => ({ id: 't1' })), updateNotes } });
        const res = await request(app).put('/api/tickets/t1').send({ notes: 'n' });
        expect(res.status).toBe(200);
        expect(updateNotes).toHaveBeenCalled();
    });

    test('PUT /:id only assignedTo, repo provides assign', async () => {
        const assign = jest.fn(() => ({ id: 't1', assignedTo: 'u' }));
        const { app } = build({ repo: { findById: jest.fn(() => ({ id: 't1' })), assign } });
        const res = await request(app).put('/api/tickets/t1').send({ assignedTo: 'u' });
        expect(res.status).toBe(200);
        expect(assign).toHaveBeenCalled();
    });

    test('PUT /:id only tags, repo provides updateTags', async () => {
        const updateTags = jest.fn(() => ({ id: 't1', tags: ['a'] }));
        const { app } = build({ repo: { findById: jest.fn(() => ({ id: 't1' })), updateTags } });
        const res = await request(app).put('/api/tickets/t1').send({ tags: ['a'] });
        expect(res.status).toBe(200);
        expect(updateTags).toHaveBeenCalled();
    });

    test('PUT /:id update method returns null -> falls back to original ticket', async () => {
        const updateStatus = jest.fn(() => null); // falsy -> uses `updated` (the original ticket)
        const { app } = build({ repo: { findById: jest.fn(() => ({ id: 't1' })), updateStatus } });
        const res = await request(app).put('/api/tickets/t1').send({ status: 'X' });
        expect(res.status).toBe(200);
        expect(res.body.ticket).toEqual({ id: 't1' });
    });
});
