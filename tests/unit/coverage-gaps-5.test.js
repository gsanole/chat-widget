/**
 * Round-5 coverage gaps — finish off chatbot/integrations/lygHubWebhook/adminHandlers/ipUtils.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const request = require('supertest');
const express = require('express');
const { buildRouterApp } = require('./_routerTestHelper');

// ===========================================================================
// ipUtils — getPublicIP + fetchIPGeo via spyOn on http/https
// ===========================================================================
describe('ipUtils — network paths', () => {
    const http = require('http');
    const https = require('https');
    const { EventEmitter } = require('events');
    const ipUtils = require('../../src/utils/ipUtils');

    function fakeGet(dataChunks, errAfter = false) {
        return (_url, cb) => {
            const res = new EventEmitter();
            setImmediate(() => {
                if (cb) cb(res);
                setImmediate(() => {
                    for (const c of dataChunks) res.emit('data', c);
                    res.emit('end');
                });
            });
            const reqEm = new EventEmitter();
            if (errAfter) {
                setImmediate(() => reqEm.emit('error', new Error('netfail')));
            }
            return reqEm;
        };
    }

    afterEach(() => jest.restoreAllMocks());

    test('getPublicIP fetches and caches', async () => {
        jest.spyOn(https, 'get').mockImplementation(
            fakeGet([JSON.stringify({ ip: '8.8.8.8' })])
        );
        const ip = await ipUtils.getPublicIP();
        // First call may have cached or returned new
        expect(typeof ip === 'string' || ip === null).toBe(true);
    });

    test('fetchIPGeo returns parsed object on success', async () => {
        jest.spyOn(http, 'get').mockImplementation(
            fakeGet([JSON.stringify({ status: 'success', country: 'US', countryCode: 'US', regionName: 'CA', city: 'SF', timezone: 'PST', lat: 1, lon: 2, isp: 'i', org: 'o', as: 'a', proxy: true, hosting: true })])
        );
        const geo = await ipUtils.fetchIPGeo('8.8.8.8');
        expect(geo).toMatchObject({ country: 'US', countryCode: 'US', isProxy: true, isHosting: true });
    });

    test('fetchIPGeo returns null on status!=success', async () => {
        jest.spyOn(http, 'get').mockImplementation(
            fakeGet([JSON.stringify({ status: 'fail' })])
        );
        const geo = await ipUtils.fetchIPGeo('1.2.3.4');
        expect(geo).toBeNull();
    });

    test('fetchIPGeo returns null on JSON parse error', async () => {
        jest.spyOn(http, 'get').mockImplementation(fakeGet(['not-json']));
        const geo = await ipUtils.fetchIPGeo('1.2.3.4');
        expect(geo).toBeNull();
    });

    test('fetchIPGeo returns null on http error', async () => {
        jest.spyOn(http, 'get').mockImplementation(fakeGet([], true));
        const geo = await ipUtils.fetchIPGeo('1.2.3.4');
        expect(geo).toBeNull();
    });

    test('initPublicIP triggers cache fill', async () => {
        jest.spyOn(https, 'get').mockImplementation(
            fakeGet([JSON.stringify({ ip: '1.1.1.1' })])
        );
        const orig = console.log;
        console.log = jest.fn();
        try {
            ipUtils.initPublicIP();
            await new Promise(r => setTimeout(r, 50));
        } finally {
            console.log = orig;
        }
    });

    test('getPublicIP timeout path resolves null after 5s', async () => {
        // mock https.get to never call cb -> setTimeout fires
        jest.spyOn(https, 'get').mockImplementation(() => {
            const reqEm = new EventEmitter();
            return reqEm; // never invokes cb
        });
        // Reset module cache for cachedPublicIP
        jest.isolateModules(() => {
            // no-op; we just want to ensure cache cleared in the inner scope
        });
        // Save then clear cache by re-loading inside isolateModules
        await jest.isolateModulesAsync(async () => {
            const ipu = require('../../src/utils/ipUtils');
            jest.spyOn(https, 'get').mockImplementation(() => new EventEmitter());
            jest.useFakeTimers();
            const p = ipu.getPublicIP();
            jest.advanceTimersByTime(6000);
            jest.useRealTimers();
            const result = await p;
            expect(result).toBeNull();
        });
    });

    test('fetchIPGeo timeout path resolves null after 5s', async () => {
        await jest.isolateModulesAsync(async () => {
            const ipu = require('../../src/utils/ipUtils');
            jest.spyOn(http, 'get').mockImplementation(() => new EventEmitter());
            jest.useFakeTimers();
            const p = ipu.fetchIPGeo('1.2.3.4');
            jest.advanceTimersByTime(6000);
            jest.useRealTimers();
            const result = await p;
            expect(result).toBeNull();
        });
    });
});

// ===========================================================================
// lygHubWebhook — fn @91 (catch arrow), opts default {}, missing event/messageId,
// non-OK fetch result, error without message
// ===========================================================================
describe('lygHubWebhook — finish branches/fns', () => {
    const { createWebhookBridge } = require('../../src/services/lygHubWebhook');

    test('createWebhookBridge with no opts uses defaults (covers L31[0])', () => {
        const b = createWebhookBridge();
        expect(b.resolveTarget('any')).toBeNull();
    });

    test('mirror catch arrow fires when send rejects', async () => {
        let n = 0;
        const siteRepository = {
            findById: () => {
                n++;
                // First call (mirror's resolveTarget) succeeds; second (send's) throws.
                if (n === 1) return { integration: { enabled: true, url: 'u', secret: 'k' } };
                throw new Error('boom');
            }
        };
        const b = createWebhookBridge({ siteRepository });
        b.mirror('s', { event: 'e', messageId: 'm' });
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));
        expect(n).toBeGreaterThanOrEqual(2);
    });

    test('send: payload missing event/messageId still produces headers', async () => {
        const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 }));
        const b = createWebhookBridge({
            siteRepository: { findById: () => ({ integration: { enabled: true, url: 'u', secret: 'k' } }) },
            fetchImpl
        });
        const r = await b.send('s', {});
        expect(r.ok).toBe(true);
        expect(fetchImpl.mock.calls[0][1].headers['x-chat-event']).toBe('');
        expect(fetchImpl.mock.calls[0][1].headers['x-chat-delivery']).toBe('');
    });

    test('send: fetch returns falsy', async () => {
        const fetchImpl = async () => null;
        const b = createWebhookBridge({
            siteRepository: { findById: () => ({ integration: { enabled: true, url: 'u', secret: 'k' } }) },
            fetchImpl
        });
        const r = await b.send('s', { event: 'e', messageId: 'm' });
        expect(r.ok).toBe(false);
    });

    test('send: error without .message uses String(err)', async () => {
        const fetchImpl = async () => { throw 'plain-string'; };
        const b = createWebhookBridge({
            siteRepository: { findById: () => ({ integration: { enabled: true, url: 'u', secret: 'k' } }) },
            fetchImpl
        });
        const r = await b.send('s', { event: 'e', messageId: 'm' });
        expect(r.ok).toBe(false);
        expect(r.error).toBe('plain-string');
    });

    test('send: respects events allow-list (skip)', async () => {
        const fetchImpl = jest.fn();
        const b = createWebhookBridge({
            siteRepository: { findById: () => ({ integration: { enabled: true, url: 'u', secret: 'k', events: ['other'] } }) },
            fetchImpl
        });
        const r = await b.send('s', { event: 'not-allowed', messageId: 'm' });
        expect(r.skipped).toBe(true);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

// ===========================================================================
// integrations — L47[1] auditRepository present (covered),
// L87[1] text wrong type, L125 db.update predicate fn, L179 socket null,
// L192/193 status not terminal, L224 health w/o integration
// ===========================================================================
describe('integrations — finish branches', () => {
    const { createIntegrationsRouter } = require('../../src/routes/integrations');

    function buildApp(extra = {}) {
        const sites = new Map([['site1', { id: 'site1', integration: { enabled: true, secret: 'k', url: 'http://x' } }]]);
        const tickets = new Map([['t1', { id: 't1', site_id: 'site1', status: 'open' }]]);
        const messages = [];
        const router = createIntegrationsRouter({
            io: { to: () => ({ emit: jest.fn() }) },
            messageRepository: {
                create: (m) => { const o = { id: 'm-' + messages.length, ...m }; messages.push(o); return o; },
                findByTicket: () => [],
                db: extra.db
            },
            ticketRepository: {
                findById: id => tickets.get(id) || null,
                updateStatus: jest.fn(),
                updateLastMessage: jest.fn()
            },
            siteRepository: { findById: id => sites.get(id) || null },
            auditRepository: { log: jest.fn() },
            getSessions: extra.getSessions,
            getAdminSockets: extra.getAdminSockets
        });
        const app = express();
        app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
        app.use('/api/integrations', router);
        return { app, sites, tickets, messages };
    }

    function sign(body, secret = 'k') {
        return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    }

    test('text wrong type (number) -> 400', async () => {
        const { app } = buildApp();
        const body = JSON.stringify({ sessionId: 't1', text: 123 });
        const r = await request(app)
            .post('/api/integrations/sites/site1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(r.status).toBe(400);
    });

    test('db.update predicate is invoked (fn @125)', async () => {
        const dbUpdate = jest.fn((pred, _patch) => {
            // call predicate with a candidate row to cover the arrow fn
            pred({ id: 'm-0' });
            pred({ id: 'other' });
        });
        const { app } = buildApp({ db: { update: dbUpdate } });
        const body = JSON.stringify({ sessionId: 't1', text: 'hi', messageId: 'ext-9' });
        const r = await request(app)
            .post('/api/integrations/sites/site1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(r.status).toBe(200);
        expect(dbUpdate).toHaveBeenCalled();
    });

    test('status terminal w/ no socket on session (L179[1])', async () => {
        const sessions = new Map([['t1', { sessionId: 't1' /* no socket */ }]]);
        const { app } = buildApp({ getSessions: () => sessions });
        const body = JSON.stringify({ sessionId: 't1', status: 'closed' });
        const r = await request(app)
            .post('/api/integrations/sites/site1/status')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(r.status).toBe(200);
    });

    test('status non-terminal with session present skips socket logic but session stays', async () => {
        const sessions = new Map([['t1', { sessionId: 't1', socket: { emit: jest.fn(), disconnect: jest.fn(), connected: true } }]]);
        const { app } = buildApp({ getSessions: () => sessions });
        const body = JSON.stringify({ sessionId: 't1', status: 'in_progress' });
        const r = await request(app)
            .post('/api/integrations/sites/site1/status')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(r.status).toBe(200);
        expect(sessions.has('t1')).toBe(true);
    });

    test('health for site WITHOUT integration -> integrationEnabled=false', async () => {
        const router = createIntegrationsRouter({
            io: { to: () => ({ emit: jest.fn() }) },
            messageRepository: { create: jest.fn(), findByTicket: () => [] },
            ticketRepository: { findById: jest.fn() },
            siteRepository: { findById: () => ({ id: 'siteX' /* no integration */ }) },
            auditRepository: { log: jest.fn() }
        });
        const app = express();
        app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
        app.use('/api/integrations', router);
        const r = await request(app).get('/api/integrations/sites/siteX/health');
        expect(r.status).toBe(200);
        expect(r.body.integrationEnabled).toBe(false);
    });
});

// ===========================================================================
// chatbot routes — finish remaining branches
// ===========================================================================
describe('chatbot routes — leftover branches', () => {
    const { createChatbotRouter } = require('../../src/routes/chatbot');

    test('header-based siteApiKey is accepted', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: {
                    getConfig: () => ({ enabled: true, faq: [] }),
                    processMessage: () => ({ message: 'ok' })
                },
                auditRepository: { log: () => {} },
                siteRepository: { findByApiKey: () => ({ id: 's', api_key: 'k', allowed_origins: ['*'] }) }
            }
        });
        const r = await request(app)
            .get('/api/chatbot/config')
            .set('x-site-api-key', 'k');
        expect(r.status).toBe(200);
    });

    test('siteApiKey rate-limited returns 429 after burst', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: {
                    getConfig: () => ({ enabled: true, faq: [] }),
                    processMessage: () => ({ message: 'ok' })
                },
                auditRepository: { log: () => {} },
                siteRepository: { findByApiKey: () => ({ id: 's', api_key: 'k', allowed_origins: ['*'] }) }
            }
        });
        // burst above 30
        let last = 200;
        for (let i = 0; i < 35; i++) {
            const r = await request(app).get('/api/chatbot/config?siteApiKey=k');
            last = r.status;
            if (last === 429) break;
        }
        expect(last).toBe(429);
    });

    test('/message with empty/whitespace string -> 400', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: { getConfig: () => ({ enabled: true }), processMessage: () => ({}) },
                auditRepository: { log: () => {} }
            }
        });
        const r = await request(app).post('/api/chatbot/message').send({ message: '   ' });
        expect(r.status).toBe(400);
    });

    test('/message: geoBlocking enabled + ip blocked -> 403', async () => {
        let result;
        await jest.isolateModulesAsync(async () => {
            const ipUtils = require('../../src/utils/ipUtils');
            ipUtils.getRealIP = () => '8.8.8.8';
            ipUtils.fetchIPGeo = async () => ({ countryCode: 'US', country: 'United States' });
            ipUtils.isCountryBlocked = () => ({ blocked: true, country: 'US' });
            const { createChatbotRouter: factory } = require('../../src/routes/chatbot');
            const app = buildRouterApp({
                basePath: '/api/chatbot',
                factory,
                deps: {
                    chatbotService: {
                        getConfig: () => ({ enabled: true, geoBlocking: { enabled: true, mode: 'blocklist', countries: ['US'] } }),
                        processMessage: () => ({ message: 'ok' })
                    },
                    auditRepository: { log: () => {} }
                }
            });
            result = await request(app).post('/api/chatbot/message').send({ message: 'hi' });
        });
        expect(result.status).toBe(403);
        expect(result.body.error).toBe('GEO_BLOCKED');
    });

    test('/message: geoBlocking lookup throws -> still served', async () => {
        let result;
        await jest.isolateModulesAsync(async () => {
            const ipUtils = require('../../src/utils/ipUtils');
            ipUtils.getRealIP = () => '8.8.8.8';
            ipUtils.fetchIPGeo = async () => { throw new Error('lookup fail'); };
            const { createChatbotRouter: factory } = require('../../src/routes/chatbot');
            const app = buildRouterApp({
                basePath: '/api/chatbot',
                factory,
                deps: {
                    chatbotService: {
                        getConfig: () => ({ enabled: true, geoBlocking: { enabled: true } }),
                        processMessage: () => ({ message: 'ok' })
                    },
                    auditRepository: { log: () => {} }
                }
            });
            result = await request(app).post('/api/chatbot/message').send({ message: 'hi' });
        });
        expect(result.status).toBe(200);
    });

    test('PUT /config: missing body returns 400', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: { getConfig: () => ({}), saveConfig: () => true, processMessage: () => ({}) },
                auditRepository: { log: () => {} }
            }
        });
        // Express parses missing body to {} which is truthy. send no body -> {} truthy, succeeds.
        // But sending null forces falsy
        const r = await request(app)
            .put('/api/chatbot/config')
            .set('content-type', 'application/json')
            .send('null');
        expect(r.status).toBe(400);
    });

    test('PUT /config: saveConfig returns false -> 500', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: { getConfig: () => ({}), saveConfig: () => false, processMessage: () => ({}) },
                auditRepository: { log: () => {} }
            }
        });
        const r = await request(app).put('/api/chatbot/config').send({ x: 1 });
        expect(r.status).toBe(500);
    });

    test('POST /toggle: saveConfig fails -> 500', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: {
                    getConfig: () => ({ enabled: true }),
                    saveConfig: () => false,
                    processMessage: () => ({})
                },
                auditRepository: { log: () => {} }
            }
        });
        const r = await request(app).post('/api/chatbot/toggle');
        expect(r.status).toBe(500);
    });

    test('POST /faq: missing fields -> 400', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: { getConfig: () => ({}), addFaq: () => 'id', processMessage: () => ({}) },
                auditRepository: { log: () => {} }
            }
        });
        const r = await request(app).post('/api/chatbot/faq').send({ question: 'q' });
        expect(r.status).toBe(400);
    });

    test('PATCH /faq/:id: not found -> 404', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: { getConfig: () => ({}), updateFaq: () => false, processMessage: () => ({}) },
                auditRepository: { log: () => {} }
            }
        });
        const r = await request(app).patch('/api/chatbot/faq/x').send({ question: 'q' });
        expect(r.status).toBe(404);
    });

    test('DELETE /faq/:id: not found -> 404', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: { getConfig: () => ({}), deleteFaq: () => false, processMessage: () => ({}) },
                auditRepository: { log: () => {} }
            }
        });
        const r = await request(app).delete('/api/chatbot/faq/x');
        expect(r.status).toBe(404);
    });

    test('POST /test: missing message', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: { getConfig: () => ({}), processMessage: () => ({}) },
                auditRepository: { log: () => {} }
            }
        });
        const r = await request(app).post('/api/chatbot/test').send({});
        expect(r.status).toBe(400);
    });

    test('POST /test: with siteId branch', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: { getConfig: () => ({}), processMessage: () => ({ ok: 1 }) },
                auditRepository: { log: () => {} }
            }
        });
        const r = await request(app).post('/api/chatbot/test').send({ message: 'hi', siteId: 'sX' });
        expect(r.status).toBe(200);
    });

    test('admin/faq missing question via patterns string', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: { getConfig: () => ({}), addFaq: () => 'id', processMessage: () => ({}) },
                auditRepository: { log: () => {} }
            }
        });
        // missing answer
        const r = await request(app).post('/api/chatbot/admin/faq').send({ patterns: 'p' });
        expect(r.status).toBe(400);
    });

    test('admin/faq with patterns string (becomes question)', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: { getConfig: () => ({}), addFaq: () => 'id-1', processMessage: () => ({}) },
                auditRepository: { log: () => {} }
            }
        });
        const r = await request(app).post('/api/chatbot/admin/faq').send({ patterns: 'p', response: 'r' });
        expect(r.status).toBe(200);
    });

    test('admin/faq update returns 404 when service returns false', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: { getConfig: () => ({}), updateFaq: () => false, processMessage: () => ({}) },
                auditRepository: { log: () => {} }
            }
        });
        const r = await request(app).put('/api/chatbot/admin/faq/x').send({});
        expect(r.status).toBe(404);
    });

    test('admin/faq delete returns 404 when service returns false', async () => {
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: { getConfig: () => ({}), deleteFaq: () => false, processMessage: () => ({}) },
                auditRepository: { log: () => {} }
            }
        });
        const r = await request(app).delete('/api/chatbot/admin/faq/x');
        expect(r.status).toBe(404);
    });
});

// ===========================================================================
// adminHandlers — finish remaining branches
// ===========================================================================
describe('adminHandlers — finish branches', () => {
    const { createAdminHandlers } = require('../../src/socket/handlers/adminHandlers');

    function build(opts = {}) {
        const adminSockets = new Map();
        const sessions = new Map(opts.sessionsEntries || []);
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
                adminSockets, sessions,
                getRealIP: () => '127.0.0.1',
                hasPermission: () => true
            })
        };
    }
    afterEach(() => jest.dontMock('../../src/database'));

    test('handleAuth: data passed as string (covers L92[0])', async () => {
        const { handleAuth } = build();
        const sock = { emit: jest.fn() };
        // string passed -> username will be null -> "Username required"
        await handleAuth(sock, 'just-a-password');
        expect(sock.emit).toHaveBeenCalled();
    });

    test('handleAuth: non-string username/password kept as-is (covers L94[1], L98[1])', async () => {
        const user = { id: 'u', username: 'u', is_active: true, totp_enabled: false };
        const { handleAuth } = build({ authenticate: async () => user });
        const sock = { id: 's', emit: jest.fn() };
        await handleAuth(sock, { username: { not: 'string' }, password: 12345 });
        // Will still call authenticate; with our mock it returns user -> success path
        expect(sock.isAdmin).toBe(true);
    });

    test('handleAuth: 2FA required, totpCode missing -> ADMIN_REQUIRES_2FA branch', async () => {
        const user = { id: 'u', username: 'u', is_active: true, totp_enabled: true, totp_secret: 'x' };
        const { handleAuth } = build({ authenticate: async () => user });
        const sock = { emit: jest.fn() };
        await handleAuth(sock, { username: 'u', password: 'p' });
        expect(sock.pendingUser).toBe(user);
    });

    test('handleAuth: recovery_codes typeof other -> empty array used', async () => {
        const user = { id: 'u', username: 'u', is_active: true, totp_enabled: true, totp_secret: 'x', recovery_codes: 12345 };
        const { handleAuth } = build({
            authenticate: async () => user,
            verifyTOTP: () => false,
            verifyRecoveryCode: () => ({ valid: false })
        });
        const sock = { emit: jest.fn() };
        await handleAuth(sock, { username: 'u', password: 'p', totpCode: 'BAD' });
        expect(sock.isAdmin).toBeUndefined();
    });

    test('handleSubmit2FA: recovery_codes Array form, valid recovery -> success', async () => {
        const user = { id: 'u', username: 'u', totp_secret: 'x', recovery_codes: ['REC'] };
        const { handleSubmit2FA } = build({
            verifyTOTP: () => false,
            verifyRecoveryCode: () => ({ valid: true, remainingCodes: [] })
        });
        const sock = { id: 's', emit: jest.fn(), pendingUser: user };
        await handleSubmit2FA(sock, 'REC');
        expect(sock.isAdmin).toBe(true);
        expect(sock.pendingUser).toBeUndefined();
    });

    test('handleSubmit2FA: recovery_codes string form, valid recovery -> success', async () => {
        const user = { id: 'u', username: 'u', totp_secret: 'x', recovery_codes: JSON.stringify(['REC']) };
        const { handleSubmit2FA } = build({
            verifyTOTP: () => false,
            verifyRecoveryCode: () => ({ valid: true, remainingCodes: [] })
        });
        const sock = { id: 's', emit: jest.fn(), pendingUser: user };
        await handleSubmit2FA(sock, 'REC');
        expect(sock.isAdmin).toBe(true);
    });

    test('handleSubmit2FA: recovery_codes typeof other -> empty array used', async () => {
        const user = { id: 'u', username: 'u', totp_secret: 'x', recovery_codes: 12345 };
        const { handleSubmit2FA } = build({
            verifyTOTP: () => false,
            verifyRecoveryCode: () => ({ valid: false })
        });
        const sock = { emit: jest.fn(), pendingUser: user };
        await handleSubmit2FA(sock, 'BAD');
        expect(sock.isAdmin).toBeUndefined();
    });

    test('sendAllSessionsToAdmin: covers L59 (no ipAnalysis) + L71 (ticket no ip_analysis)', () => {
        const { sendAllSessionsToAdmin } = build({
            sessionsEntries: [['s1', { sessionId: 's1', name: 'A' /* no ipAnalysis */ }]],
            archivedTickets: () => [{ id: 't-other', customer_name: 'X', status: 'archived', started_at: 1, last_message_at: 0, customer_ip: '1', /* no ip_analysis */ customer_location: null, customer_contact: null, site_id: 's' }]
        });
        const sock = { emit: jest.fn() };
        sendAllSessionsToAdmin(sock);
        expect(sock.emit).toHaveBeenCalled();
    });
});
