/**
 * Round-3 coverage-gap tests — chatbot enforceSiteSecurity, TicketRepository
 * remaining branches, lygHubWebhook, TwoFactorService recovery success,
 * integrations health endpoint.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// ===========================================================================
// chatbot routes — enforceSiteSecurity branches with siteRepository injected
// ===========================================================================
describe('chatbot enforceSiteSecurity branches', () => {
    const request = require('supertest');
    const { buildRouterApp } = require('./_routerTestHelper');
    const { createChatbotRouter } = require('../../src/routes/chatbot');

    function build(siteRepo) {
        return buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: {
                    getConfig: () => ({ enabled: true }),
                    saveConfig: () => true,
                    processMessage: () => ({ type: 'fallback', message: 'fb' })
                },
                auditRepository: { log: () => {} },
                siteRepository: siteRepo
            }
        });
    }

    test('rejects invalid API key (401)', async () => {
        const app = build({ findByApiKey: () => null });
        const r = await request(app)
            .get('/api/chatbot/config?siteApiKey=bad');
        expect(r.status).toBe(401);
    });

    test('rejects disallowed origin (403)', async () => {
        const app = build({
            findByApiKey: () => ({
                id: 's1', api_key: 'good',
                allowed_origins: ['https://allowed.example']
            })
        });
        const r = await request(app)
            .get('/api/chatbot/config?siteApiKey=good')
            .set('origin', 'https://denied.example');
        expect(r.status).toBe(403);
    });

    test('allows valid site + origin', async () => {
        const app = build({
            findByApiKey: () => ({
                id: 's1', api_key: 'good',
                allowed_origins: ['*']
            })
        });
        const r = await request(app)
            .get('/api/chatbot/config?siteApiKey=good');
        expect(r.status).toBe(200);
    });

    test('rate-limits per-site after burst (429)', async () => {
        const app = build({
            findByApiKey: () => ({
                id: 's2', api_key: 'good2',
                allowed_origins: ['*']
            })
        });
        // SiteRateLimiter default = 30/min
        let last;
        for (let i = 0; i < 35; i++) {
            last = await request(app)
                .get('/api/chatbot/config?siteApiKey=good2');
        }
        expect(last.status).toBe(429);
    });

    test('site-secured /message endpoint passes with apiKey via header', async () => {
        const app = build({
            findByApiKey: () => ({
                id: 's3', api_key: 'good3',
                allowed_origins: ['*']
            })
        });
        const r = await request(app)
            .post('/api/chatbot/message')
            .set('x-site-api-key', 'good3')
            .send({ message: 'hi' });
        expect(r.status).toBe(200);
    });
});

// ===========================================================================
// TicketRepository — remaining branches: findOpen sort, findBySite/SiteAndStatus,
// findByAssignee, updateAssignee/Priority/Notes/Tags, delete with messagesDb
// ===========================================================================
describe('TicketRepository remaining', () => {
    const { JsonDB } = require('../../src/database/JsonDB');
    const { TicketRepository } = require('../../src/database/repositories/TicketRepository');

    function freshRepo() {
        process.env.DATABASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-r3-'));
        const tdb = new JsonDB('tk.json', []);
        const mdb = new JsonDB('m.json', []);
        return { repo: new TicketRepository(tdb, mdb), tdb, mdb };
    }

    test('findOpen sorts by last_message_at, with mixed null entries', () => {
        const { repo, tdb } = freshRepo();
        const a = repo.create({ customerName: 'A', customerIp: '1', customerLocation: 'X', ipAnalysis: null });
        const b = repo.create({ customerName: 'B', customerIp: '1', customerLocation: 'X', ipAnalysis: null });
        const c = repo.create({ customerName: 'C', customerIp: '1', customerLocation: 'X', ipAnalysis: null });
        tdb.update(t => t.id === a.id, { last_message_at: 100 });
        tdb.update(t => t.id === b.id, { last_message_at: 50 });
        // c has no last_message_at -> covers `b.last_message_at || 0` branch
        const open = repo.findOpen();
        expect(open.length).toBe(3);
        expect(open.map(t => t.id).sort()).toEqual([a.id, b.id, c.id].sort());
    });

    test('findBySite + findBySiteAndStatus + findByAssignee', () => {
        const { repo, tdb } = freshRepo();
        const t1 = repo.create({ customerName: 'A', customerIp: '1', customerLocation: 'X', siteId: 'site-x', ipAnalysis: null });
        repo.create({ customerName: 'B', customerIp: '1', customerLocation: 'X', siteId: 'other', ipAnalysis: null });
        repo.updateStatus(t1.id, 'resolved');
        repo.updateAssignee(t1.id, 'user-1');
        repo.updatePriority(t1.id, 'high');
        repo.updateNotes(t1.id, 'note');
        repo.updateTags(t1.id, 'tag1,tag2');
        expect(repo.findBySite('site-x').length).toBe(1);
        expect(repo.findBySiteAndStatus('site-x', 'resolved').length).toBe(1);
        expect(repo.findBySiteAndStatus('site-x', 'open').length).toBe(0);
        expect(repo.findByAssignee('user-1').length).toBe(1);
        expect(repo.delete(t1.id)).toBe(true);
    });

    test('delete without messagesDb still removes ticket', () => {
        process.env.DATABASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-d-'));
        const tdb = new (require('../../src/database/JsonDB').JsonDB)('tk.json', []);
        const repo = new TicketRepository(tdb, null);
        const t = repo.create({ customerName: 'A', customerIp: '1', customerLocation: 'X', ipAnalysis: null });
        expect(repo.delete(t.id)).toBe(true);
    });
});

// ===========================================================================
// TwoFactorService — recovery code success path (st 79, fn @79)
// ===========================================================================
describe('TwoFactorService recovery success', () => {
    const { TwoFactorService } = require('../../src/services/TwoFactorService');

    test('verify with valid recovery code consumes it', async () => {
        const user = {
            id: 'u', is_active: true, totp_secret: 's',
            recovery_codes: JSON.stringify(['CODE-A', 'CODE-B'])
        };
        const updates = [];
        const userRepo = {
            findById: () => user,
            db: { update: (predicate, payload) => {
                expect(predicate({ id: 'u' })).toBe(true);
                updates.push(payload);
            } }
        };
        const audit = { log: jest.fn() };
        const svc = new TwoFactorService({ userRepository: userRepo, auditRepository: audit });
        const r = await svc.verify('u', 'CODE-A', () => false, { ip: '1.1.1.1', userAgent: 'jest' });
        expect(r.ok).toBe(true);
        expect(updates).toHaveLength(1);
        const persistedCodes = JSON.parse(updates[0].recovery_codes);
        expect(persistedCodes).toEqual(['CODE-B']);
        expect(audit.log).toHaveBeenCalled();
    });
});

// ===========================================================================
// lygHubWebhook — easy gaps
// ===========================================================================
describe('lygHubWebhook gaps', () => {
    const { createWebhookBridge, verifySignature } = require('../../src/services/lygHubWebhook');

    function siteRepo(integration) {
        return { findById: () => integration ? { id: 's', integration } : null };
    }

    test('resolveTarget returns null when site missing or not enabled', () => {
        const b = createWebhookBridge({ siteRepository: siteRepo(null) });
        expect(b.resolveTarget('s')).toBeNull();
        const b2 = createWebhookBridge({ siteRepository: siteRepo({ enabled: false, url: 'u', secret: 'k' }) });
        expect(b2.resolveTarget('s')).toBeNull();
        const b3 = createWebhookBridge({ siteRepository: siteRepo({ enabled: true, url: 'u', secret: 'k' }) });
        expect(b3.resolveTarget('s')).toEqual({ url: 'u', secret: 'k', events: null });
    });

    test('resolveTarget returns null when siteId missing or repo lacks findById', () => {
        const b = createWebhookBridge({ siteRepository: {} });
        expect(b.resolveTarget('any')).toBeNull();
        expect(b.resolveTarget()).toBeNull();
    });

    test('send: skipped when no integration', async () => {
        const b = createWebhookBridge({ siteRepository: siteRepo(null) });
        const r = await b.send('s', { event: 'x', messageId: '1' });
        expect(r).toEqual({ ok: true, skipped: true });
    });

    test('send: skipped when event not in allow-list', async () => {
        const b = createWebhookBridge({
            siteRepository: siteRepo({ enabled: true, url: 'u', secret: 'k', events: ['allowed'] })
        });
        const r = await b.send('s', { event: 'denied', messageId: '1' });
        expect(r).toEqual({ ok: true, skipped: true });
    });

    test('send: returns no-fetch when fetch unavailable', async () => {
        const orig = globalThis.fetch;
        globalThis.fetch = undefined;
        try {
            const b = createWebhookBridge({
                siteRepository: siteRepo({ enabled: true, url: 'u', secret: 'k' })
            });
            const r = await b.send('s', { event: 'e', messageId: '1' });
            expect(r.ok).toBe(false);
            expect(r.error).toBe('no-fetch');
        } finally {
            globalThis.fetch = orig;
        }
    });

    test('send: non-OK response returns ok:false', async () => {
        const fetchImpl = async () => ({ ok: false, status: 500 });
        const b = createWebhookBridge({
            siteRepository: siteRepo({ enabled: true, url: 'u', secret: 'k' }),
            fetchImpl
        });
        const r = await b.send('s', { event: 'e', messageId: '1' });
        expect(r.ok).toBe(false);
        expect(r.status).toBe(500);
    });

    test('send: thrown fetch error caught', async () => {
        const fetchImpl = async () => { throw new Error('net'); };
        const b = createWebhookBridge({
            siteRepository: siteRepo({ enabled: true, url: 'u', secret: 'k' }),
            fetchImpl
        });
        const r = await b.send('s', { event: 'e', messageId: '1' });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/net/);
    });

    test('send: success path with allow-list match', async () => {
        const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 }));
        const b = createWebhookBridge({
            siteRepository: siteRepo({ enabled: true, url: 'u', secret: 'k', events: ['allowed'] }),
            fetchImpl
        });
        const r = await b.send('s', { event: 'allowed', messageId: '1' });
        expect(r.ok).toBe(true);
        expect(fetchImpl).toHaveBeenCalled();
    });

    test('mirror: no-op when no integration', () => {
        const b = createWebhookBridge({ siteRepository: siteRepo(null) });
        expect(() => b.mirror('s', { event: 'e' })).not.toThrow();
    });

    test('mirror: schedules a send when target resolves', async () => {
        const fetchImpl = jest.fn(async () => ({ ok: true }));
        const b = createWebhookBridge({
            siteRepository: siteRepo({ enabled: true, url: 'u', secret: 'k' }),
            fetchImpl
        });
        b.mirror('s', { event: 'e', messageId: '1' });
        await new Promise(r => setImmediate(r));
        expect(fetchImpl).toHaveBeenCalled();
    });

    test('genMessageId returns a non-empty UUID', () => {
        const b = createWebhookBridge({ siteRepository: siteRepo(null) });
        expect(typeof b.genMessageId()).toBe('string');
        expect(b.genMessageId().length).toBeGreaterThan(8);
    });

    test('verifySignature catch-branch when timingSafeEqual throws', () => {
        const original = crypto.timingSafeEqual;
        crypto.timingSafeEqual = () => { throw new Error('boom'); };
        try {
            const expected = crypto.createHmac('sha256', 'k').update('body').digest('hex');
            expect(verifySignature('body', `sha256=${expected}`, 'k')).toBe(false);
        } finally {
            crypto.timingSafeEqual = original;
        }
    });

    test('verifySignature returns false on missing inputs', () => {
        expect(verifySignature(null, 'sha256=abc', 'k')).toBe(false);
        expect(verifySignature('x', null, 'k')).toBe(false);
        expect(verifySignature('x', 'sha256=abc', null)).toBe(false);
    });

    test('verifySignature rejects non-hex provided', () => {
        expect(verifySignature('x', 'sha256=GGGGGG', 'k')).toBe(false);
    });

    test('verifySignature rejects length mismatch', () => {
        expect(verifySignature('x', 'sha256=abcd', 'k')).toBe(false);
    });
});

// ===========================================================================
// integrations — health endpoint (uncovered L224 branch + arrow function)
// ===========================================================================
describe('integrations health', () => {
    const request = require('supertest');
    const express = require('express');
    const { createIntegrationsRouter } = require('../../src/routes/integrations');

    function build(sites) {
        const router = createIntegrationsRouter({
            io: { to: () => ({ emit: jest.fn() }) },
            messageRepository: { create: () => ({ id: 'm' }), findByTicket: () => [], db: {} },
            ticketRepository: { findById: () => null, updateStatus: jest.fn(), updateLastMessage: jest.fn() },
            siteRepository: { findById: id => sites.get(id) || null },
            auditRepository: { log: jest.fn() },
            getSessions: () => new Map(),
            getAdminSockets: () => new Map()
        });
        const app = express();
        app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
        app.use('/api/integrations', router);
        return app;
    }

    test('health: 404 on unknown', async () => {
        const app = build(new Map());
        const r = await request(app).get('/api/integrations/sites/x/health');
        expect(r.status).toBe(404);
    });

    test('health: integrationEnabled true when fully configured', async () => {
        const sites = new Map([['s1', { id: 's1', integration: { enabled: true, url: 'u', secret: 'k' } }]]);
        const r = await request(build(sites)).get('/api/integrations/sites/s1/health');
        expect(r.status).toBe(200);
        expect(r.body.integrationEnabled).toBe(true);
    });

    test('health: integrationEnabled false when partially configured', async () => {
        const sites = new Map([['s2', { id: 's2', integration: { enabled: true } }]]);
        const r = await request(build(sites)).get('/api/integrations/sites/s2/health');
        expect(r.status).toBe(200);
        expect(r.body.integrationEnabled).toBe(false);
    });
});
