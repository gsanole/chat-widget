/**
 * Unit tests for src/routes/audit.js
 *
 * Stubs auditRepository methods and verifies query handling, default
 * limits, and the missing-range-params 400.
 */

const request = require('supertest');
const { buildRouterApp } = require('./_routerTestHelper');
const { createAuditRouter } = require('../../src/routes/audit');

function makeRepo(overrides = {}) {
    return {
        findAll: jest.fn(() => [{ id: 'log-1' }]),
        findByUser: jest.fn(() => [{ id: 'log-2' }]),
        findByAction: jest.fn(() => [{ id: 'log-3' }]),
        findByResource: jest.fn(() => [{ id: 'log-4' }]),
        findByDateRange: jest.fn(() => [{ id: 'log-5' }]),
        ...overrides
    };
}

describe('audit routes', () => {
    test('GET / uses default limit when none supplied', async () => {
        const repo = makeRepo();
        const app = buildRouterApp({
            basePath: '/api/audit',
            factory: createAuditRouter,
            deps: { auditRepository: repo }
        });
        const res = await request(app).get('/api/audit');
        expect(res.status).toBe(200);
        expect(repo.findAll).toHaveBeenCalledWith(100);
    });

    test('GET / honors custom limit', async () => {
        const repo = makeRepo();
        const app = buildRouterApp({
            basePath: '/api/audit',
            factory: createAuditRouter,
            deps: { auditRepository: repo }
        });
        await request(app).get('/api/audit?limit=25');
        expect(repo.findAll).toHaveBeenCalledWith(25);
    });

    test('GET /user/:userId', async () => {
        const repo = makeRepo();
        const app = buildRouterApp({
            basePath: '/api/audit',
            factory: createAuditRouter,
            deps: { auditRepository: repo }
        });
        const res = await request(app).get('/api/audit/user/u1?limit=5');
        expect(res.status).toBe(200);
        expect(repo.findByUser).toHaveBeenCalledWith('u1', 5);
    });

    test('GET /action/:action', async () => {
        const repo = makeRepo();
        const app = buildRouterApp({
            basePath: '/api/audit',
            factory: createAuditRouter,
            deps: { auditRepository: repo }
        });
        await request(app).get('/api/audit/action/LOGIN_SUCCESS');
        expect(repo.findByAction).toHaveBeenCalledWith('LOGIN_SUCCESS', 100);
    });

    test('GET /resource/:type/:id', async () => {
        const repo = makeRepo();
        const app = buildRouterApp({
            basePath: '/api/audit',
            factory: createAuditRouter,
            deps: { auditRepository: repo }
        });
        await request(app).get('/api/audit/resource/ticket/t-7');
        expect(repo.findByResource).toHaveBeenCalledWith('ticket', 't-7');
    });

    test('GET /range without start/end -> 400', async () => {
        const repo = makeRepo();
        const app = buildRouterApp({
            basePath: '/api/audit',
            factory: createAuditRouter,
            deps: { auditRepository: repo }
        });
        const res = await request(app).get('/api/audit/range');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Start and end/);
    });

    test('GET /range parses numeric timestamps', async () => {
        const repo = makeRepo();
        const app = buildRouterApp({
            basePath: '/api/audit',
            factory: createAuditRouter,
            deps: { auditRepository: repo }
        });
        await request(app).get('/api/audit/range?start=100&end=200');
        expect(repo.findByDateRange).toHaveBeenCalledWith(100, 200);
    });
});
