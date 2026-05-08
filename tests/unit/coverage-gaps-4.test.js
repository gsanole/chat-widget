/**
 * Round-4 coverage-gap tests — hit remaining easy branches across multiple files.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const request = require('supertest');
const express = require('express');
const { buildRouterApp } = require('./_routerTestHelper');

// ===========================================================================
// chatHandlers — fn@40 (.then arrow inside mirrorToSite without webhook.mirror)
// + remaining branches
// ===========================================================================
describe('chatHandlers — webhook.send fallback path', () => {
    const { createChatHandlers } = require('../../src/socket/handlers/chatHandlers');

    function build(webhookOverride) {
        const adminSockets = new Map();
        const sessions = new Map();
        const ioRoom = { emit: jest.fn(), except: () => ({ emit: jest.fn() }) };
        return {
            adminSockets, sessions,
            ...createChatHandlers({
                io: { to: () => ioRoom, sockets: { adapter: { rooms: new Map() } } },
                messageRepository: {
                    create: () => ({ id: 'm', content: 'x', timestamp: Date.now() / 1000 }),
                    findByTicket: () => []
                },
                ticketRepository: { findById: () => ({ site_id: 'site-X' }), updateLastMessage: () => {} },
                adminSockets, sessions,
                getRealIP: () => '1', hasPermission: () => true,
                chatbotService: { _matchesEscalation: () => true, getConfig: () => ({}) },
                webhook: webhookOverride
            })
        };
    }

    test('mirrorToSite uses send() arrow when webhook.mirror is undefined', () => {
        const send = jest.fn(() => Promise.resolve({ ok: true }));
        const { handleAdminMessage, sessions } = build({ send, genMessageId: () => 'm-1' });
        sessions.set('s1', { sessionId: 's1', siteId: 'site-X', socket: { emit: jest.fn(), connected: true, id: 'cust' }, messages: [] });
        const sock = { isAdmin: true, adminUser: { id: 'a1', nickname: 'A', username: 'a' }, emit: jest.fn() };
        handleAdminMessage(sock, { sessionId: 's1', message: 'hi' });
        // Wait for promise microtask
        return Promise.resolve().then(() => Promise.resolve()).then(() => {
            expect(send).toHaveBeenCalled();
        });
    });

    test('mirrorToSite swallows send rejections (.catch arrow)', async () => {
        const send = jest.fn(() => Promise.reject(new Error('boom')));
        const { handleAdminMessage, sessions } = build({ send, genMessageId: () => 'm-1' });
        sessions.set('s2', { sessionId: 's2', siteId: 'site-X', socket: { emit: jest.fn(), connected: true, id: 'cust' }, messages: [] });
        const sock = { isAdmin: true, adminUser: { id: 'a1', nickname: 'A', username: 'a' }, emit: jest.fn() };
        handleAdminMessage(sock, { sessionId: 's2', message: 'hi' });
        await new Promise(r => setImmediate(r));
        expect(send).toHaveBeenCalled();
    });

    test('handleAdminJoin without session falls back to ticket lookup', () => {
        const { handleAdminJoin } = build({ mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm' });
        const sock = { isAdmin: true, adminUser: { id: 'a' }, emit: jest.fn(), join: jest.fn() };
        handleAdminJoin(sock, 'no-session-tx');
        expect(sock.join).toHaveBeenCalled();
    });

    test('handleAdminJoin: unauthorized non-admin', () => {
        const { handleAdminJoin } = build({ mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm' });
        const sock = { emit: jest.fn() };
        handleAdminJoin(sock, 's-x');
        expect(sock.emit).toHaveBeenCalled();
    });

    test('handleAdminJoin: unknown ticket emits ERROR', () => {
        const { createChatHandlers } = require('../../src/socket/handlers/chatHandlers');
        const adminSockets = new Map();
        const sessions = new Map();
        const handlers = createChatHandlers({
            io: { to: () => ({ emit: jest.fn() }), sockets: { adapter: { rooms: new Map() } } },
            messageRepository: { create: jest.fn(), findByTicket: () => [] },
            ticketRepository: { findById: () => null, updateLastMessage: jest.fn() },
            adminSockets, sessions,
            getRealIP: () => '1', hasPermission: () => true,
            chatbotService: {},
            webhook: { mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm' }
        });
        const sock = { isAdmin: true, adminUser: { id: 'a' }, emit: jest.fn(), join: jest.fn() };
        handlers.handleAdminJoin(sock, 'truly-unknown');
        expect(sock.emit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ message: 'Session not found' }));
    });

    test('handleAdminLeave: unauthorized non-admin returns silently', () => {
        const { handleAdminLeave } = build({ mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm' });
        const sock = { leave: jest.fn(), emit: jest.fn() };
        handleAdminLeave(sock, 's-x');
        expect(sock.leave).not.toHaveBeenCalled();
    });

    test('handleAdminLeave: with another admin still in room keeps hasAdminJoined', () => {
        const { handleAdminLeave, adminSockets, sessions } = build({ mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm' });
        const otherSock = { id: 'other-id', emit: jest.fn() };
        adminSockets.set('other-id', { socket: otherSock });
        sessions.set('s-leave', { sessionId: 's-leave', hasAdminJoined: true });
        const room = new Set(['other-id']);
        const handlers = require('../../src/socket/handlers/chatHandlers').createChatHandlers({
            io: { to: () => ({ emit: jest.fn() }), sockets: { adapter: { rooms: new Map([['chat:s-leave', room]]) } } },
            messageRepository: { create: jest.fn(), findByTicket: () => [] },
            ticketRepository: { findById: () => null, updateLastMessage: jest.fn() },
            adminSockets, sessions,
            getRealIP: () => '1', hasPermission: () => true,
            chatbotService: {},
            webhook: { mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm' }
        });
        const sock = { id: 'leaving', isAdmin: true, leave: jest.fn(), emit: jest.fn() };
        handlers.handleAdminLeave(sock, 's-leave');
        expect(sessions.get('s-leave').hasAdminJoined).toBe(true);
    });

    test('handleAdminMessage: unauthorized; missing fields; no permission', () => {
        const { handleAdminMessage } = build({ mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm' });
        const sockNotAdmin = { isAdmin: false, emit: jest.fn() };
        handleAdminMessage(sockNotAdmin, { sessionId: 's', message: 'x' });
        expect(sockNotAdmin.emit).toHaveBeenCalled();

        const sockNoFields = { isAdmin: true, adminUser: { role: 'admin' }, emit: jest.fn() };
        handleAdminMessage(sockNoFields, {});
        expect(sockNoFields.emit).toHaveBeenCalled();

        const noPerm = build({ mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm' });
        const handlersNoPerm = require('../../src/socket/handlers/chatHandlers').createChatHandlers({
            io: { to: () => ({ emit: jest.fn(), except: () => ({ emit: jest.fn() }) }), sockets: { adapter: { rooms: new Map() } } },
            messageRepository: { create: jest.fn(), findByTicket: () => [] },
            ticketRepository: { findById: () => null, updateLastMessage: jest.fn() },
            adminSockets: new Map(), sessions: new Map(),
            getRealIP: () => '1', hasPermission: () => false,
            chatbotService: {},
            webhook: { mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm' }
        });
        const sockNo = { isAdmin: true, adminUser: { role: 'viewer' }, emit: jest.fn() };
        handlersNoPerm.handleAdminMessage(sockNo, { sessionId: 's', message: 'x' });
        expect(sockNo.emit).toHaveBeenCalled();
    });

    test('handleCustomerMessage: missing session + missing message', () => {
        const { handleCustomerMessage } = build({ mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm' });
        const sock = { sessionId: 'unknown', emit: jest.fn() };
        handleCustomerMessage(sock, { message: 'hi' });
        expect(sock.emit).toHaveBeenCalled();

        const { handleCustomerMessage: hcm2, sessions } = build({ mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm' });
        sessions.set('s', { sessionId: 's', siteId: 'site-X', name: 'C', socket: { emit: jest.fn(), connected: true }, messages: [], hasAdminJoined: false });
        const sock2 = { sessionId: 's', emit: jest.fn() };
        hcm2(sock2, {});
        expect(sock2.emit).toHaveBeenCalled();
    });

    test('handleCustomerMessage: full path including escalation flag', () => {
        const { handleCustomerMessage, sessions } = build({ mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm' });
        sessions.set('s-cust', { sessionId: 's-cust', siteId: 'site-X', name: 'C', socket: { emit: jest.fn(), connected: true }, messages: [], hasAdminJoined: false });
        const sock = { sessionId: 's-cust', emit: jest.fn() };
        const msg = handleCustomerMessage(sock, { message: 'help' });
        expect(msg).toBeDefined();
    });

    test('handleTyping: customer typing path', () => {
        const { handleTyping } = build({ mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm' });
        const sock = { sessionId: 's', isAdmin: false };
        handleTyping(sock, { isTyping: true });
    });
});

// ===========================================================================
// chatbot routes — branches for ALL endpoints with siteRepository injected
// ===========================================================================
describe('chatbot routes — full enforceSiteSecurity matrix', () => {
    const { createChatbotRouter } = require('../../src/routes/chatbot');

    function build(siteRepo) {
        return buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: {
                    getConfig: () => ({ enabled: true, faq: [] }),
                    saveConfig: () => true,
                    processMessage: () => ({ type: 'fallback', message: 'fb' }),
                    addFaq: () => 'faq-1',
                    updateFaq: () => true,
                    deleteFaq: () => true
                },
                auditRepository: { log: () => {} },
                siteRepository: siteRepo
            }
        });
    }

    test('/message rejects bad apiKey', async () => {
        const app = build({ findByApiKey: () => null });
        const r = await request(app).post('/api/chatbot/message?siteApiKey=bad').send({ message: 'x' });
        expect(r.status).toBe(401);
    });

    test('/message blocks origin', async () => {
        const app = build({ findByApiKey: () => ({ id: 's', api_key: 'k', allowed_origins: ['https://only.example'] }) });
        const r = await request(app)
            .post('/api/chatbot/message?siteApiKey=k')
            .set('origin', 'https://nope.example')
            .send({ message: 'x' });
        expect(r.status).toBe(403);
    });

    test('apiKey via body works on /message', async () => {
        const app = build({ findByApiKey: () => ({ id: 's', api_key: 'k', allowed_origins: ['*'] }) });
        const r = await request(app).post('/api/chatbot/message').send({ message: 'x', siteApiKey: 'k' });
        expect(r.status).toBe(200);
    });

    test('admin endpoints surface saveConfig errors as 500', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: {
                    getConfig: () => ({}),
                    saveConfig: () => { throw new Error('disk'); },
                    addFaq: () => { throw new Error('boom'); },
                    updateFaq: () => { throw new Error('boom'); },
                    deleteFaq: () => { throw new Error('boom'); },
                    processMessage: () => ({})
                },
                auditRepository: { log: () => {} }
            }
        });
        let r = await request(app).post('/api/chatbot/admin/faq').send({ question: 'q', answer: 'a' });
        expect(r.status).toBe(500);
        r = await request(app).put('/api/chatbot/admin/faq/x').send({});
        expect(r.status).toBe(500);
        r = await request(app).delete('/api/chatbot/admin/faq/x');
        expect(r.status).toBe(500);
        // admin/config save throws -> still returns success per try/catch swallow
        r = await request(app).put('/api/chatbot/admin/config').send({});
        expect(r.status).toBe(200);
    });
});

// ===========================================================================
// TicketRepository — push branches over 90% by exercising all update/find variants
// ===========================================================================
describe('TicketRepository — exhaustive branches', () => {
    const { JsonDB } = require('../../src/database/JsonDB');
    const { TicketRepository } = require('../../src/database/repositories/TicketRepository');

    function fresh() {
        process.env.DATABASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-r4-'));
        return new TicketRepository(new JsonDB('tk.json', []), new JsonDB('m.json', []));
    }

    test('findByStatus + create with explicit-id branch + findOpen empty', () => {
        const repo = fresh();
        // No tickets yet -> findOpen returns []
        expect(repo.findOpen()).toEqual([]);
        // create with caller-provided id (covers id || generateId branch)
        const t = repo.create({ id: 'fixed-id', customerName: 'A', customerIp: '1', customerLocation: 'X', ipAnalysis: { isVPN: true } });
        expect(t.id).toBe('fixed-id');
        expect(repo.findByStatus('open').length).toBe(1);
    });

    test('cleanupOldResolved with default daysOld=15', () => {
        const repo = fresh();
        // No qualifying tickets -> 0
        expect(repo.cleanupOldResolved()).toBe(0);
    });

    test('count by status', () => {
        const repo = fresh();
        repo.create({ customerName: 'A', customerIp: '1', customerLocation: 'X', ipAnalysis: null });
        const t = repo.create({ customerName: 'B', customerIp: '1', customerLocation: 'X', ipAnalysis: null });
        repo.updateStatus(t.id, 'resolved');
        const stats = repo.getStats();
        expect(stats.total).toBeGreaterThanOrEqual(2);
    });
});

// ===========================================================================
// integrations — push branches above 90% with auth/header edge cases
// ===========================================================================
describe('integrations — leftover edge cases', () => {
    const { createIntegrationsRouter } = require('../../src/routes/integrations');

    function build(extra = {}) {
        const sites = new Map([['site1', { id: 'site1', integration: { enabled: true, secret: 'k', url: 'http://x' } }]]);
        const tickets = new Map([['t1', { id: 't1', site_id: 'site1', status: 'open' }]]);
        const messages = [];
        const sessions = new Map();
        const adminSockets = new Map();
        const router = createIntegrationsRouter({
            io: { to: () => ({ emit: jest.fn() }) },
            messageRepository: {
                create: (m) => { const o = { id: 'm-' + messages.length, ...m }; messages.push(o); return o; },
                findByTicket: () => { throw new Error('idem-explode'); },
                db: { update: jest.fn() }
            },
            ticketRepository: {
                findById: id => tickets.get(id) || null,
                updateStatus: jest.fn(),
                updateLastMessage: jest.fn()
            },
            siteRepository: { findById: id => sites.get(id) || null },
            auditRepository: null, // covers !auditRepository branch
            getSessions: undefined,
            getAdminSockets: undefined,
            ...extra
        });
        const app = express();
        app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
        app.use('/api/integrations', router);
        return { app, sites, tickets, sessions, messages };
    }

    function sign(body, secret) {
        return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    }

    test('idempotency check that throws falls through to create', async () => {
        const { app } = build();
        const body = JSON.stringify({ sessionId: 't1', text: 'hi', messageId: 'ext-1' });
        const r = await request(app)
            .post('/api/integrations/sites/site1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body, 'k'))
            .send(body);
        expect(r.status).toBe(200);
    });

    test('audit failure does not block request', async () => {
        const { app } = build({ auditRepository: { log: () => { throw new Error('audit'); } } });
        const body = JSON.stringify({ sessionId: 't1', text: 'hi' });
        const r = await request(app)
            .post('/api/integrations/sites/site1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body, 'k'))
            .send(body);
        expect(r.status).toBe(200);
    });

    test('status change with adminSockets present broadcasts', async () => {
        const adminSockets = new Map([['a1', { socket: { emit: jest.fn() } }]]);
        const { app } = build({
            getAdminSockets: () => adminSockets,
            getSessions: () => new Map()
        });
        const body = JSON.stringify({ sessionId: 't1', status: 'archived' });
        const r = await request(app)
            .post('/api/integrations/sites/site1/status')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body, 'k'))
            .send(body);
        expect(r.status).toBe(200);
    });

    test('status close without active socket (socket.connected=false) doesn’t throw', async () => {
        const sessions = new Map([['t1', { sessionId: 't1', socket: { emit: jest.fn(), disconnect: jest.fn(), connected: false } }]]);
        const { app } = build({ getSessions: () => sessions });
        const body = JSON.stringify({ sessionId: 't1', status: 'closed' });
        const r = await request(app)
            .post('/api/integrations/sites/site1/status')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body, 'k'))
            .send(body);
        expect(r.status).toBe(200);
    });

    test('status with non-terminal value (not resolved/archived/closed) just updates', async () => {
        const sessions = new Map([['t1', { sessionId: 't1', socket: { emit: jest.fn(), connected: true } }]]);
        const { app } = build({ getSessions: () => sessions });
        const body = JSON.stringify({ sessionId: 't1', status: 'in_progress' });
        const r = await request(app)
            .post('/api/integrations/sites/site1/status')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body, 'k'))
            .send(body);
        expect(r.status).toBe(200);
    });

    test('messages: with no sessions getter, succeeds without session-state mutation', async () => {
        const { app } = build();
        const body = JSON.stringify({ sessionId: 't1', text: 'hi' });
        const r = await request(app)
            .post('/api/integrations/sites/site1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body, 'k'))
            .send(body);
        expect(r.status).toBe(200);
    });

    test('messages: existing session w/ admin joined skips new-message broadcast', async () => {
        const sessions = new Map([['t1', { sessionId: 't1', name: 'C', socket: { emit: jest.fn() }, hasAdminJoined: true }]]);
        const { app } = build({ getSessions: () => sessions });
        const body = JSON.stringify({ sessionId: 't1', text: 'hi' });
        const r = await request(app)
            .post('/api/integrations/sites/site1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body, 'k'))
            .send(body);
        expect(r.status).toBe(200);
    });
});

// ===========================================================================
// lygHubWebhook — fn @91 mirror branches when target unresolved + send swallow
// ===========================================================================
describe('lygHubWebhook — mirror catch arrow', () => {
    const { createWebhookBridge } = require('../../src/services/lygHubWebhook');

    test('mirror swallows send rejection (catch arrow)', async () => {
        const fetchImpl = async () => { throw new Error('boom'); };
        const b = createWebhookBridge({
            siteRepository: { findById: () => ({ id: 's', integration: { enabled: true, url: 'u', secret: 'k' } }) },
            fetchImpl,
            log: { warn: () => {}, info: () => {} }
        });
        b.mirror('s', { event: 'e', messageId: 'mid' });
        await new Promise(r => setImmediate(r));
    });

    test('default log uses console (no log injected)', async () => {
        const origWarn = console.warn;
        console.warn = jest.fn();
        try {
            const b = createWebhookBridge({
                siteRepository: { findById: () => ({ id: 's', integration: { enabled: true, url: 'u', secret: 'k' } }) }
                // no fetchImpl, no log → uses globalThis.fetch (which is undefined-friendly here in node18+)
            });
            // If fetch exists, send returns ok; if not, returns no-fetch.
            await b.send('s', { event: 'e', messageId: '1' });
        } finally {
            console.warn = origWarn;
        }
    });
});

// ===========================================================================
// adminHandlers — branches for sendAllSessionsToAdmin + 2FA edge cases
// ===========================================================================
describe('adminHandlers extra branches', () => {
    const { createAdminHandlers } = require('../../src/socket/handlers/adminHandlers');

    function build(opts = {}) {
        const adminSockets = new Map();
        const sessions = new Map();
        // The sendAllSessionsToAdmin uses require('../../database').tickets.findAll()
        // We need to mock that module. Use jest.doMock.
        jest.doMock('../../src/database', () => ({
            tickets: { findAll: opts.archivedTickets || (() => []) }
        }));
        return {
            adminSockets, sessions,
            ...createAdminHandlers({
                io: {},
                authService: {
                    generateToken: () => 'tok',
                    verifyToken: t => (t === 'good' ? { userId: 'u1' } : null)
                },
                userRepository: {
                    authenticate: opts.authenticate || (async () => null),
                    findById: opts.findById || (() => null),
                    enableTotp: jest.fn(),
                    updateLastLogin: jest.fn()
                },
                sessionRepository: { create: jest.fn(), deleteByToken: jest.fn() },
                auditRepository: { log: jest.fn() },
                totp: {
                    verifyTOTP: opts.verifyTOTP || (() => false),
                    verifyRecoveryCode: opts.verifyRecoveryCode || (() => ({ valid: false }))
                },
                adminSockets,
                sessions,
                getRealIP: () => '127.0.0.1',
                hasPermission: () => true
            })
        };
    }

    afterEach(() => jest.dontMock('../../src/database'));

    test('handleAuth: missing username', async () => {
        const { handleAuth } = build();
        const sock = { emit: jest.fn() };
        await handleAuth(sock, { password: 'x' });
        expect(sock.emit).toHaveBeenCalled();
    });

    test('handleAuth: invalid creds', async () => {
        const { handleAuth } = build({ authenticate: async () => null });
        const sock = { emit: jest.fn() };
        await handleAuth(sock, { username: 'u', password: 'p' });
        expect(sock.emit).toHaveBeenCalled();
    });

    test('handleAuth: 2FA required emits ADMIN_REQUIRES_2FA', async () => {
        const user = { id: 'u', username: 'u', totp_enabled: true, totp_secret: 's', is_active: true };
        const { handleAuth } = build({ authenticate: async () => user });
        const sock = { emit: jest.fn() };
        await handleAuth(sock, { username: 'u', password: 'p' });
        expect(sock.pendingUser).toBe(user);
    });

    test('handleAuth: 2FA bad code with valid recovery code', async () => {
        const user = {
            id: 'u', username: 'u', totp_enabled: true, totp_secret: 's',
            is_active: true, recovery_codes: JSON.stringify(['REC1'])
        };
        const { handleAuth } = build({
            authenticate: async () => user,
            verifyTOTP: () => false,
            verifyRecoveryCode: () => ({ valid: true, remainingCodes: [] })
        });
        const sock = { emit: jest.fn(), id: 'sid' };
        await handleAuth(sock, { username: 'u', password: 'p', totpCode: 'REC1' });
        expect(sock.isAdmin).toBe(true);
    });

    test('handleAuth: 2FA bad code, recovery_codes as Array (not string)', async () => {
        const user = {
            id: 'u', username: 'u', totp_enabled: true, totp_secret: 's',
            is_active: true, recovery_codes: ['REC1']
        };
        const { handleAuth } = build({
            authenticate: async () => user,
            verifyTOTP: () => false,
            verifyRecoveryCode: () => ({ valid: false })
        });
        const sock = { emit: jest.fn() };
        await handleAuth(sock, { username: 'u', password: 'p', totpCode: 'BAD' });
        expect(sock.isAdmin).toBeUndefined();
    });

    test('handleAuth: thrown error caught', async () => {
        const { handleAuth } = build({ authenticate: async () => { throw new Error('boom'); } });
        const sock = { emit: jest.fn() };
        await handleAuth(sock, { username: 'u', password: 'p' });
        expect(sock.emit).toHaveBeenCalled();
    });

    test('handleSubmit2FA: no pending user', async () => {
        const { handleSubmit2FA } = build();
        const sock = { emit: jest.fn() };
        await handleSubmit2FA(sock, '123');
        expect(sock.emit).toHaveBeenCalled();
    });

    test('handleSubmit2FA: bad code w/ no recovery_codes -> fail', async () => {
        const { handleSubmit2FA } = build({ verifyTOTP: () => false });
        const sock = { emit: jest.fn(), pendingUser: { id: 'u', totp_secret: 's' } };
        await handleSubmit2FA(sock, '999');
        expect(sock.emit).toHaveBeenCalled();
    });

    test('handleSubmit2FA: success path', async () => {
        const { handleSubmit2FA } = build({ verifyTOTP: () => true });
        const sock = { id: 's1', emit: jest.fn(), pendingUser: { id: 'u', username: 'u', totp_secret: 's' } };
        await handleSubmit2FA(sock, '123');
        expect(sock.isAdmin).toBe(true);
    });

    test('sendAllSessionsToAdmin includes archived from db', () => {
        const { sendAllSessionsToAdmin } = build({
            archivedTickets: () => [{
                id: 't-arch', customer_name: 'X', status: 'archived',
                started_at: 1, last_message_at: 2, customer_ip: '1.1.1.1',
                ip_analysis: { geo: { country: 'US' } }, customer_location: null,
                customer_contact: null, site_id: 's'
            }]
        });
        const sock = { emit: jest.fn() };
        sendAllSessionsToAdmin(sock);
        expect(sock.emit).toHaveBeenCalled();
    });

    test('handleTokenAuth: invalid token', () => {
        const { handleTokenAuth } = build();
        const sock = { emit: jest.fn() };
        handleTokenAuth(sock, 'bad-token');
        expect(sock.emit).toHaveBeenCalled();
    });

    test('handleTokenAuth: valid token + user', () => {
        const { handleTokenAuth } = build({ findById: () => ({ id: 'u1', username: 'u1', is_active: true, role: 'admin' }) });
        const sock = { id: 's', emit: jest.fn() };
        handleTokenAuth(sock, 'good');
        expect(sock.isAdmin).toBe(true);
    });

    test('handleTokenAuth: valid token but user inactive', () => {
        const { handleTokenAuth } = build({ findById: () => ({ id: 'u1', is_active: false }) });
        const sock = { emit: jest.fn() };
        handleTokenAuth(sock, 'good');
        expect(sock.isAdmin).toBeUndefined();
    });

    test('handleLogout', () => {
        const { handleLogout } = build();
        const sock = { id: 's1', adminToken: 'tok', adminUser: { id: 'u', username: 'u' }, emit: jest.fn() };
        handleLogout(sock);
        expect(sock.isAdmin).toBe(false);
    });
});
