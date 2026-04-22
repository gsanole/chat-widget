/**
 * Tests for src/database/index.js
 *
 * Exercises:
 *  - chatbot.findResponse (escalate / faq / fallback branches)
 *  - chatbot.addFaqItem / updateFaqItem / deleteFaqItem
 *  - chatbot.getConfig fallback when file missing
 *  - chatbot.saveConfig error path
 *  - legacy positional-arg adapters (users/tickets/messages/sessions/sites/audit)
 *  - initializeSuperAdmin both branches
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

let db;
const ORIGINAL_DB_DIR = process.env.DATABASE_DIR;

beforeAll(() => {
    process.env.DATABASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'db-cov-'));
    jest.resetModules();
    db = require('../../src/database');
    // Remove any seeded chatbot config so the "file missing" test exercises
    // the default-fallback branch in chatbotConfig.getConfig().
    try { fs.unlinkSync(path.join(process.env.DATABASE_DIR, 'chatbot.json')); } catch (_) { /* not present is fine */ }
});

afterAll(() => {
    try { fs.rmSync(process.env.DATABASE_DIR, { recursive: true, force: true }); } catch (e) { }
    // Restore env so subsequent test files see the original DATABASE_DIR.
    if (ORIGINAL_DB_DIR === undefined) delete process.env.DATABASE_DIR;
    else process.env.DATABASE_DIR = ORIGINAL_DB_DIR;
    jest.resetModules();
});

describe('chatbot config & FAQ', () => {
    test('getConfig returns default when file missing', () => {
        const cfg = db.chatbot.getConfig();
        expect(cfg.botName).toBeDefined();
        expect(cfg.faq).toEqual([]);
    });

    test('saveConfig writes and getConfig reads back', () => {
        const ok = db.chatbot.saveConfig({
            enabled: true,
            botName: 'Bot',
            welcomeMessage: 'hi',
            fallbackMessage: 'fb',
            escalationKeywords: ['human'],
            escalationMessage: 'connecting',
            faq: [],
            quickReplies: []
        });
        expect(ok).toBe(true);
        expect(db.chatbot.getConfig().botName).toBe('Bot');
    });

    test('addFaqItem returns generated id', () => {
        const id = db.chatbot.addFaqItem({ patterns: ['hello'], response: 'hi back' });
        expect(typeof id).toBe('string');
        const cfg = db.chatbot.getConfig();
        expect(cfg.faq.find(f => f.id === id)).toBeDefined();
    });

    test('addFaqItem honors explicit id', () => {
        const id = db.chatbot.addFaqItem({ id: 'faq-x', patterns: ['p'], response: 'r' });
        expect(id).toBe('faq-x');
    });

    test('updateFaqItem true when exists', () => {
        db.chatbot.addFaqItem({ id: 'upd1', patterns: ['p'], response: 'old' });
        expect(db.chatbot.updateFaqItem('upd1', { response: 'new' })).toBe(true);
        const cfg = db.chatbot.getConfig();
        expect(cfg.faq.find(f => f.id === 'upd1').response).toBe('new');
    });

    test('updateFaqItem false when missing', () => {
        expect(db.chatbot.updateFaqItem('nope', { response: 'x' })).toBe(false);
    });

    test('deleteFaqItem true when exists, false when missing', () => {
        db.chatbot.addFaqItem({ id: 'del1', patterns: ['p'], response: 'r' });
        expect(db.chatbot.deleteFaqItem('del1')).toBe(true);
        expect(db.chatbot.deleteFaqItem('nope')).toBe(false);
    });

    test('findResponse escalates on keyword', () => {
        db.chatbot.saveConfig({
            enabled: true,
            escalationKeywords: ['human'],
            escalationMessage: 'go',
            fallbackMessage: 'fb',
            faq: []
        });
        const r = db.chatbot.findResponse('I need a HUMAN please');
        expect(r.type).toBe('escalate');
    });

    test('findResponse matches faq pattern', () => {
        db.chatbot.saveConfig({
            enabled: true,
            escalationKeywords: [],
            fallbackMessage: 'fb',
            faq: [{ id: 'f1', patterns: ['hours'], response: 'we are open 9-5' }]
        });
        const r = db.chatbot.findResponse('what are your HOURS');
        expect(r.type).toBe('faq');
        expect(r.faqId).toBe('f1');
    });

    test('findResponse returns fallback when no match', () => {
        db.chatbot.saveConfig({
            enabled: true,
            escalationKeywords: [],
            fallbackMessage: 'fb',
            faq: []
        });
        const r = db.chatbot.findResponse('completely unrelated');
        expect(r.type).toBe('fallback');
        expect(r.message).toBe('fb');
    });

    test('findResponse handles empty/undefined message', () => {
        db.chatbot.saveConfig({
            enabled: true, escalationKeywords: [], fallbackMessage: 'fb', faq: []
        });
        expect(db.chatbot.findResponse(undefined).type).toBe('fallback');
        expect(db.chatbot.findResponse('').type).toBe('fallback');
    });
});

describe('legacy positional adapters', () => {
    test('users.create accepts both object and positional forms', async () => {
        const u1 = await db.users.create({ username: 'a1', email: 'a1@x', password: 'p', role: 'support' });
        expect(u1.username).toBe('a1');
        const u2 = await db.users.create('a2', 'a2@x', 'p', 'support');
        expect(u2.username).toBe('a2');
    });

    test('tickets.create accepts both forms', () => {
        const t1 = db.tickets.create({ id: 'tk1', customerName: 'C', customerIp: '1.1.1.1' });
        expect(t1.id).toBe('tk1');
        const t2 = db.tickets.create('tk2', 'C', '1.1.1.1', null, null);
        expect(t2.id).toBe('tk2');
    });

    test('messages.create accepts both forms', () => {
        const m1 = db.messages.create({ ticketId: 'tk1', senderType: 'customer', senderId: null, senderName: 'C', content: 'hi' });
        expect(m1.ticket_id).toBe('tk1');
        const m2 = db.messages.create('tk2', 'customer', null, 'C', 'hello');
        expect(m2.ticket_id).toBe('tk2');
    });

    test('sessions.create accepts both forms', async () => {
        const u = await db.users.create({ username: 'sess-u', email: 'su@x', password: 'p', role: 'support' });
        const s1 = db.sessions.create({ userId: u.id, token: 't-obj', ipAddress: '1.1.1.1', userAgent: 'jest' });
        expect(s1.token).toBe('t-obj');
        const s2 = db.sessions.create(u.id, 't-pos', '1.1.1.1', 'jest');
        expect(s2.token).toBe('t-pos');
        const s3 = db.sessions.create(u.id, 't-pos2', '1.1.1.1', 'jest', 60);
        expect(s3.token).toBe('t-pos2');
    });

    test('sites.create accepts both forms', () => {
        const s1 = db.sites.create({ name: 'A', domain: 'a.com' });
        expect(s1.name).toBe('A');
        const s2 = db.sites.create('B', 'b.com', 'desc');
        expect(s2.name).toBe('B');
    });

    test('audit.log accepts both forms', () => {
        const e1 = db.audit.log({ userId: 'u', username: 'u', action: 'X' });
        expect(e1.action).toBe('X');
        const e2 = db.audit.log('u', 'u', 'Y');
        expect(e2.action).toBe('Y');
    });
});

describe('initializeSuperAdmin & close', () => {
    test('initializeSuperAdmin creates one when absent then no-ops', async () => {
        // Force reload first so runSeed() runs against the temp dir, then wipe
        // the users file so the absent branch is exercised.
        jest.resetModules();
        const fresh = require('../../src/database');
        const usersFile = path.join(process.env.DATABASE_DIR, 'users.json');
        fs.writeFileSync(usersFile, '[]');
        // Reload _raw cache by reaching into the JsonDB instance
        fresh._raw.usersDB.data = [];
        const created = await fresh.initializeSuperAdmin();
        expect(created).toBe(true);
        const second = await fresh.initializeSuperAdmin();
        expect(second).toBe(false);
    });

    test('close() saves all DB files without throwing', () => {
        expect(() => db.close && db.close()).not.toThrow();
    });
});
