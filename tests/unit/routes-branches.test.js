/**
 * Branch-coverage tests for chatbot, tickets, and users routes.
 * Targets specific uncovered branches identified in the latest coverage report.
 */

const request = require('supertest');
const { buildRouterApp } = require('./_routerTestHelper');
const { createChatbotRouter } = require('../../src/routes/chatbot');
const { createTicketsRouter } = require('../../src/routes/tickets');
const { createUsersRouter } = require('../../src/routes/users');

function makeAudit() { return { log: jest.fn() }; }

// =====================================================================
// chatbot.js — line 67 branch (saveConfig returns false → 500)
// =====================================================================
describe('chatbot router - PUT /config saveConfig false branch', () => {
    test('returns 500 when saveConfig returns false', async () => {
        const chatbotService = {
            getConfig: jest.fn(() => ({})),
            saveConfig: jest.fn(() => false),
            processMessage: jest.fn(),
            addFaq: jest.fn(),
            updateFaq: jest.fn(),
            deleteFaq: jest.fn()
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        const res = await request(app).put('/api/chatbot/config').send({ x: 1 }).expect(500);
        expect(res.body.error).toMatch(/Failed/);
    });

    test('POST /toggle returns 500 when saveConfig returns false', async () => {
        const chatbotService = {
            getConfig: jest.fn(() => ({ enabled: true })),
            saveConfig: jest.fn(() => false),
            processMessage: jest.fn()
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        await request(app).post('/api/chatbot/toggle').send({}).expect(500);
    });

    test('POST /toggle returns 200 when saveConfig succeeds (enabled flips)', async () => {
        const chatbotService = {
            getConfig: jest.fn(() => ({ enabled: false })),
            saveConfig: jest.fn(() => true),
            processMessage: jest.fn()
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        const res = await request(app).post('/api/chatbot/toggle').send({}).expect(200);
        expect(res.body.enabled).toBe(true);
    });

    test('POST /faq returns 400 when missing question or answer', async () => {
        const chatbotService = { addFaq: jest.fn(), getConfig: jest.fn(() => ({})), processMessage: jest.fn() };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        await request(app).post('/api/chatbot/faq').send({ question: 'q' }).expect(400);
        await request(app).post('/api/chatbot/faq').send({ answer: 'a' }).expect(400);
    });

    test('PATCH /faq/:id with empty body, returns 200 if updateFaq returns truthy', async () => {
        const chatbotService = {
            updateFaq: jest.fn(() => true),
            getConfig: jest.fn(() => ({})),
            processMessage: jest.fn()
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        await request(app).patch('/api/chatbot/faq/f1').send({}).expect(200);
    });

    test('PATCH /faq/:id 404 when updateFaq returns falsy', async () => {
        const chatbotService = {
            updateFaq: jest.fn(() => null),
            getConfig: jest.fn(() => ({})),
            processMessage: jest.fn()
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        await request(app).patch('/api/chatbot/faq/missing').send({ question: 'q' }).expect(404);
    });

    test('DELETE /faq/:id 404 when deleteFaq returns falsy', async () => {
        const chatbotService = {
            deleteFaq: jest.fn(() => false),
            getConfig: jest.fn(() => ({})),
            processMessage: jest.fn()
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        await request(app).delete('/api/chatbot/faq/missing').expect(404);
    });

    test('POST /test returns 400 when message missing', async () => {
        const chatbotService = { processMessage: jest.fn(), getConfig: jest.fn(() => ({})) };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        await request(app).post('/api/chatbot/test').send({}).expect(400);
    });

    test('POST /test with siteId branch (siteConfig=null path)', async () => {
        const chatbotService = {
            processMessage: jest.fn(() => ({ message: 'ok' })),
            getConfig: jest.fn(() => ({}))
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        await request(app).post('/api/chatbot/test').send({ message: 'hi', siteId: 's1' }).expect(200);
    });

    test('POST /admin/faq accepts patterns array as fallback for question', async () => {
        const chatbotService = {
            addFaq: jest.fn(() => 'id1'),
            getConfig: jest.fn(() => ({})),
            processMessage: jest.fn()
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        const res = await request(app).post('/api/chatbot/admin/faq')
            .send({ patterns: ['hello'], response: 'hi' }).expect(200);
        expect(res.body.success).toBe(true);
    });

    test('POST /admin/faq accepts patterns string (non-array) as question', async () => {
        const chatbotService = {
            addFaq: jest.fn(() => 'id1'),
            getConfig: jest.fn(() => ({})),
            processMessage: jest.fn()
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        await request(app).post('/api/chatbot/admin/faq')
            .send({ patterns: 'hello', response: 'hi' }).expect(200);
    });

    test('POST /admin/faq returns 400 when missing question and answer', async () => {
        const chatbotService = { addFaq: jest.fn(), getConfig: jest.fn(() => ({})), processMessage: jest.fn() };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        await request(app).post('/api/chatbot/admin/faq').send({}).expect(400);
    });

    test('POST /admin/faq 500 when addFaq throws', async () => {
        const chatbotService = {
            addFaq: jest.fn(() => { throw new Error('x'); }),
            getConfig: jest.fn(() => ({})), processMessage: jest.fn()
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        await request(app).post('/api/chatbot/admin/faq').send({ question: 'q', answer: 'a' }).expect(500);
    });

    test('PUT /admin/faq/:id 404 when not found, 500 on throw', async () => {
        let throwIt = false;
        const chatbotService = {
            updateFaq: jest.fn(() => { if (throwIt) throw new Error('x'); return null; }),
            getConfig: jest.fn(() => ({})), processMessage: jest.fn()
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        await request(app).put('/api/chatbot/admin/faq/x').send({}).expect(404);
        throwIt = true;
        await request(app).put('/api/chatbot/admin/faq/x').send({}).expect(500);
    });

    test('DELETE /admin/faq/:id 404 when not found, 500 on throw', async () => {
        let throwIt = false;
        const chatbotService = {
            deleteFaq: jest.fn(() => { if (throwIt) throw new Error('x'); return false; }),
            getConfig: jest.fn(() => ({})), processMessage: jest.fn()
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        await request(app).delete('/api/chatbot/admin/faq/x').expect(404);
        throwIt = true;
        await request(app).delete('/api/chatbot/admin/faq/x').expect(500);
    });

    test('POST /message returns raw text and renames type escalation→escalate', async () => {
        const chatbotService = {
            processMessage: jest.fn(() => ({ message: '<b>hi</b>', type: 'escalation' })),
            getConfig: jest.fn(() => ({}))
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        const res = await request(app).post('/api/chatbot/message').send({ message: 'q' }).expect(200);
        expect(res.body.type).toBe('escalate');
        // Server returns raw text; client is responsible for HTML escaping at render time.
        expect(res.body.message).toBe('<b>hi</b>');
    });

    test('POST /message uses content/answer fallbacks and default type "fallback"', async () => {
        const chatbotService = {
            processMessage: jest.fn(() => ({ content: 'hello' })),
            getConfig: jest.fn(() => ({}))
        };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        const res = await request(app).post('/api/chatbot/message').send({ message: 'q' }).expect(200);
        expect(res.body.type).toBe('fallback');
    });

    test('POST /message rejects empty/whitespace messages', async () => {
        const chatbotService = { processMessage: jest.fn(), getConfig: jest.fn(() => ({})) };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: { chatbotService, auditRepository: makeAudit() }
        });
        await request(app).post('/api/chatbot/message').send({ message: '   ' }).expect(400);
        await request(app).post('/api/chatbot/message').send({ message: 123 }).expect(400);
        await request(app).post('/api/chatbot/message').send({}).expect(400);
    });
});

// =====================================================================
// tickets.js — additional 404 branches and patch handlers
// =====================================================================
describe('tickets router - additional branch coverage', () => {
    function setup(repoOverrides = {}) {
        const ticketRepository = {
            findById: jest.fn(() => ({ id: 't1' })),
            updateNotes: jest.fn(() => ({ id: 't1' })),
            updateTags: jest.fn(() => ({ id: 't1' })),
            updatePriority: jest.fn(() => ({ id: 't1' })),
            ...repoOverrides
        };
        const ticketService = {
            updateStatus: jest.fn(() => ({ success: true, ticket: { id: 't1' } })),
            assignTo: jest.fn(() => ({ success: true, ticket: { id: 't1' } })),
            archive: jest.fn(() => ({ success: true })),
            delete: jest.fn(() => ({ success: true }))
        };
        const messageRepository = {};
        const app = buildRouterApp({
            basePath: '/api/tickets',
            factory: createTicketsRouter,
            deps: { ticketRepository, ticketService, messageRepository, auditRepository: makeAudit() }
        });
        return { app, ticketService };
    }

    test('PATCH /:id/notes returns 404 when updateNotes returns falsy', async () => {
        const { app } = setup({ updateNotes: jest.fn(() => null) });
        await request(app).patch('/api/tickets/t1/notes').send({ notes: 'x' }).expect(404);
    });

    test('PATCH /:id/tags returns 404 when updateTags returns falsy', async () => {
        const { app } = setup({ updateTags: jest.fn(() => null) });
        await request(app).patch('/api/tickets/t1/tags').send({ tags: ['a'] }).expect(404);
    });

    test('PATCH /:id/priority returns 400 when priority missing', async () => {
        const { app } = setup();
        await request(app).patch('/api/tickets/t1/priority').send({}).expect(400);
    });

    test('PATCH /:id/priority returns 404 when ticket missing', async () => {
        const { app } = setup({ updatePriority: jest.fn(() => null) });
        await request(app).patch('/api/tickets/t1/priority').send({ priority: 'high' }).expect(404);
    });

    test('PATCH /:id/status returns 400 when status missing', async () => {
        const { app } = setup();
        await request(app).patch('/api/tickets/t1/status').send({}).expect(400);
    });

    test('PATCH /:id/status returns 400 when ticketService rejects', async () => {
        const { app, ticketService } = setup();
        ticketService.updateStatus.mockReturnValue({ success: false, error: 'invalid' });
        await request(app).patch('/api/tickets/t1/status').send({ status: 'closed' }).expect(400);
    });

    test('PATCH /:id/assign returns 400 when ticketService rejects', async () => {
        const { app, ticketService } = setup();
        ticketService.assignTo.mockReturnValue({ success: false, error: 'invalid' });
        await request(app).patch('/api/tickets/t1/assign').send({ assigneeId: 'u' }).expect(400);
    });

    test('POST /:id/archive returns 400 on failure', async () => {
        const { app, ticketService } = setup();
        ticketService.archive.mockReturnValue({ success: false, error: 'x' });
        await request(app).post('/api/tickets/t1/archive').send({}).expect(400);
    });

    test('DELETE /:id returns 400 on failure', async () => {
        const { app, ticketService } = setup();
        ticketService.delete.mockReturnValue({ success: false, error: 'x' });
        await request(app).delete('/api/tickets/t1').expect(400);
    });
});

// =====================================================================
// users.js — line 294 branch (2FA disable wrong password)
// =====================================================================
describe('users router - 2FA disable branch coverage', () => {
    function setup(opts = {}) {
        const userRepository = {
            findById: jest.fn(() => ({ id: 'u-test', username: 'tester' })),
            authenticate: jest.fn(() => Promise.resolve(opts.authResult !== undefined ? opts.authResult : true)),
            disableTotp: jest.fn(),
            ...(opts.repo || {})
        };
        const userService = {};
        const authService = {};
        const totp = {};
        const app = buildRouterApp({
            basePath: '/api/users',
            factory: createUsersRouter,
            deps: { userRepository, userService, authService, auditRepository: makeAudit(), totp }
        });
        return { app, userRepository };
    }

    test('returns 401 when password is wrong', async () => {
        const { app } = setup({ authResult: false });
        await request(app).post('/api/users/profile/2fa/disable').send({ password: 'wrong' }).expect(401);
    });

    test('returns 500 when authenticate throws', async () => {
        const userRepository = {
            findById: jest.fn(() => ({ id: 'u-test', username: 'tester' })),
            authenticate: jest.fn(() => Promise.reject(new Error('bad')))
        };
        const app = buildRouterApp({
            basePath: '/api/users',
            factory: createUsersRouter,
            deps: { userRepository, userService: {}, authService: {}, auditRepository: makeAudit(), totp: {} }
        });
        await request(app).post('/api/users/profile/2fa/disable').send({ password: 'p' }).expect(500);
    });
});
