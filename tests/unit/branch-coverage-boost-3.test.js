/**
 * Targeted branch coverage for src/app.js validation/404 paths,
 * src/routes/chatbot.js validation/404 paths, and src/utils/ipUtils.js.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const ORIGINAL_DB_DIR = process.env.DATABASE_DIR;
const ORIGINAL_TRUST_PROXY = process.env.TRUST_PROXY;

let appHandle;
let token;

beforeAll(() => {
    process.env.DATABASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cov3-'));
    // Exercise the named-string branch of TRUST_PROXY parsing
    process.env.TRUST_PROXY = 'loopback';
    jest.resetModules();
    const { createApp } = require('../../src/app');
    appHandle = createApp();
    appHandle.repositories.users.db.insert({
        id: 'u-cov3',
        username: 'cov3',
        email: 'c@v.3',
        password_hash: 'x',
        role: 'super_admin',
        is_active: true,
        created_at: Math.floor(Date.now() / 1000)
    });
    token = jwt.sign(
        { userId: 'u-cov3', username: 'cov3', role: 'super_admin' },
        process.env.JWT_SECRET, { expiresIn: '5m' }
    );
});

afterAll(() => {
    try { appHandle.sessionCleanup.stop(); } catch (_) { }
    try { appHandle.io.close(); } catch (_) { }
    try { appHandle.server.close(); } catch (_) { }
    try { fs.rmSync(process.env.DATABASE_DIR, { recursive: true, force: true }); } catch (_) { }
    if (ORIGINAL_DB_DIR === undefined) delete process.env.DATABASE_DIR;
    else process.env.DATABASE_DIR = ORIGINAL_DB_DIR;
    if (ORIGINAL_TRUST_PROXY === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = ORIGINAL_TRUST_PROXY;
    jest.resetModules();
});

describe('app.js validation/404 branches', () => {
    test('POST /api/auth/request-reset requires username or email', async () => {
        const res = await request(appHandle.app)
            .post('/api/auth/request-reset').send({});
        expect(res.status).toBe(400);
    });

    test('POST /api/auth/request-reset accepts email-only', async () => {
        const res = await request(appHandle.app)
            .post('/api/auth/request-reset').send({ email: 'a@b.c' });
        expect(res.status).toBe(200);
    });

    test('POST /api/auth/validate-reset requires token', async () => {
        const r1 = await request(appHandle.app)
            .post('/api/auth/validate-reset').send({});
        expect(r1.status).toBe(400);
        const r2 = await request(appHandle.app)
            .post('/api/auth/validate-reset').send({ token: 'abc' });
        expect(r2.status).toBe(400);
    });

    test('POST /api/auth/reset-password requires token+newPassword', async () => {
        const r1 = await request(appHandle.app)
            .post('/api/auth/reset-password').send({ token: 'x' });
        expect(r1.status).toBe(400);
        const r2 = await request(appHandle.app)
            .post('/api/auth/reset-password').send({ token: 'x', newPassword: 'y' });
        expect(r2.status).toBe(400);
    });

    test('POST /api/users/:id/reset-password 404 when user missing', async () => {
        const res = await request(appHandle.app)
            .post('/api/users/does-not-exist/reset-password')
            .set('Authorization', `Bearer ${token}`)
            .send({});
        expect(res.status).toBe(404);
    });

    test('POST /api/users/:id/reset-password generates token for existing user', async () => {
        const res = await request(appHandle.app)
            .post('/api/users/u-cov3/reset-password')
            .set('Authorization', `Bearer ${token}`)
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.resetToken).toBeDefined();
    });

    test('GET /api/sites/:id/tickets 404 when site missing', async () => {
        const res = await request(appHandle.app)
            .get('/api/sites/no-such-site/tickets')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(404);
    });

    test('GET /api/sites/:id/sessions 404 when site missing', async () => {
        const res = await request(appHandle.app)
            .get('/api/sites/no-such-site/sessions')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(404);
    });

    test('POST /api/check-access returns allowed', async () => {
        const res = await request(appHandle.app)
            .post('/api/check-access').send({});
        expect(res.body.allowed).toBe(true);
    });

    test('GET /admin returns html', async () => {
        const res = await request(appHandle.app).get('/admin');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
    });

    test('GET /admin/anything returns html', async () => {
        const res = await request(appHandle.app).get('/admin/dashboard');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
    });

    test('GET /widget.js returns javascript', async () => {
        const res = await request(appHandle.app).get('/widget.js');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/javascript/);
    });
});

describe('chatbot.js routes branches', () => {
    test('POST /api/chatbot/message requires non-empty message', async () => {
        const r1 = await request(appHandle.app)
            .post('/api/chatbot/message').send({});
        expect(r1.status).toBe(400);
        const r2 = await request(appHandle.app)
            .post('/api/chatbot/message').send({ message: '   ' });
        expect(r2.status).toBe(400);
        const r3 = await request(appHandle.app)
            .post('/api/chatbot/message').send({ message: 123 });
        expect(r3.status).toBe(400);
    });

    test('POST /api/chatbot/message returns response for valid message', async () => {
        const res = await request(appHandle.app)
            .post('/api/chatbot/message').send({ message: 'hello' });
        expect(res.status).toBe(200);
        expect(typeof res.body.message).toBe('string');
    });

    test('POST /api/chatbot/faq 400 without question/answer', async () => {
        const r1 = await request(appHandle.app)
            .post('/api/chatbot/faq')
            .set('Authorization', `Bearer ${token}`)
            .send({ question: 'q' });
        expect(r1.status).toBe(400);
        const r2 = await request(appHandle.app)
            .post('/api/chatbot/faq')
            .set('Authorization', `Bearer ${token}`)
            .send({ answer: 'a' });
        expect(r2.status).toBe(400);
    });

    test('POST /api/chatbot/faq adds and returns id', async () => {
        const res = await request(appHandle.app)
            .post('/api/chatbot/faq')
            .set('Authorization', `Bearer ${token}`)
            .send({ question: 'Q?', answer: 'A.', keywords: ['k'] });
        expect(res.status).toBe(200);
        expect(res.body.id).toBeDefined();
    });

    test('PATCH /api/chatbot/faq/:id 404 when missing', async () => {
        const res = await request(appHandle.app)
            .patch('/api/chatbot/faq/nope-' + Date.now())
            .set('Authorization', `Bearer ${token}`)
            .send({ question: 'X' });
        expect(res.status).toBe(404);
    });

    test('DELETE /api/chatbot/faq/:id 404 when missing', async () => {
        const res = await request(appHandle.app)
            .delete('/api/chatbot/faq/nope-' + Date.now())
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(404);
    });

    test('POST /api/chatbot/test 400 without message', async () => {
        const res = await request(appHandle.app)
            .post('/api/chatbot/test')
            .set('Authorization', `Bearer ${token}`)
            .send({});
        expect(res.status).toBe(400);
    });

    test('POST /api/chatbot/test returns response with siteId', async () => {
        const res = await request(appHandle.app)
            .post('/api/chatbot/test')
            .set('Authorization', `Bearer ${token}`)
            .send({ message: 'hi', siteId: 'some-site' });
        expect(res.status).toBe(200);
    });

    test('POST /api/chatbot/toggle flips enabled', async () => {
        const res = await request(appHandle.app)
            .post('/api/chatbot/toggle')
            .set('Authorization', `Bearer ${token}`)
            .send({});
        expect(res.status).toBe(200);
        expect(typeof res.body.enabled).toBe('boolean');
    });

    test('PUT /api/chatbot/admin/faq/:id 404 when missing', async () => {
        const res = await request(appHandle.app)
            .put('/api/chatbot/admin/faq/no-such-' + Date.now())
            .set('Authorization', `Bearer ${token}`)
            .send({ question: 'X', answer: 'Y' });
        expect(res.status).toBe(404);
    });

    test('DELETE /api/chatbot/admin/faq/:id 404 when missing', async () => {
        const res = await request(appHandle.app)
            .delete('/api/chatbot/admin/faq/no-such-' + Date.now())
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(404);
    });

    test('POST /api/chatbot/admin/faq accepts patterns/response shape', async () => {
        const res = await request(appHandle.app)
            .post('/api/chatbot/admin/faq')
            .set('Authorization', `Bearer ${token}`)
            .send({ patterns: ['hi', 'hello'], response: 'world' });
        expect(res.status).toBe(200);
    });
});

describe('ipUtils branches', () => {
    let ipUtils;
    beforeAll(() => { ipUtils = require('../../src/utils/ipUtils'); });

    test('getRealIP extracts first X-Forwarded-For entry', () => {
        const req = { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } };
        expect(ipUtils.getRealIP(null, req)).toBe('203.0.113.5');
    });

    test('getRealIP prefers cf-connecting-ip when present', () => {
        const req = {
            headers: {
                'cf-connecting-ip': '198.51.100.7',
                'x-forwarded-for': '203.0.113.5'
            }
        };
        expect(ipUtils.getRealIP(null, req)).toBe('198.51.100.7');
    });

    test('getRealIP normalizes IPv6 loopback to 127.0.0.1', () => {
        const req = { headers: { 'x-real-ip': '::1' } };
        expect(ipUtils.getRealIP(null, req)).toBe('127.0.0.1');
    });

    test('getRealIP strips ::ffff: prefix', () => {
        const req = { headers: { 'x-real-ip': '::ffff:192.0.2.5' } };
        expect(ipUtils.getRealIP(null, req)).toBe('192.0.2.5');
    });

    test('getRealIP returns "unknown" when nothing available', () => {
        expect(ipUtils.getRealIP(null, { headers: {} })).toBe('unknown');
    });

    test('isCountryBlocked returns blocked=false when geoBlocking disabled', () => {
        const decision = ipUtils.isCountryBlocked(
            { country: 'United States', countryCode: 'US' },
            null
        );
        expect(decision.blocked).toBe(false);
    });

    test('isCountryBlocked blocklist with empty list allows everyone', () => {
        const decision = ipUtils.isCountryBlocked(
            { countryCode: 'US' },
            { enabled: true, mode: 'blocklist', countries: [] }
        );
        expect(decision.blocked).toBe(false);
    });

    test('isCountryBlocked allowlist with empty list blocks everyone', () => {
        const decision = ipUtils.isCountryBlocked(
            { countryCode: 'US' },
            { enabled: true, mode: 'allowlist', countries: [] }
        );
        expect(decision.blocked).toBe(true);
    });

    test('isCountryBlocked blocklist blocks listed country code', () => {
        const decision = ipUtils.isCountryBlocked(
            { countryCode: 'US' },
            { enabled: true, mode: 'blocklist', countries: ['us', 'CA'] }
        );
        expect(decision.blocked).toBe(true);
        expect(decision.country).toBe('US');
    });

    test('isCountryBlocked allowlist blocks unlisted country', () => {
        const decision = ipUtils.isCountryBlocked(
            { countryCode: 'BR' },
            { enabled: true, mode: 'allowlist', countries: ['US', 'CA'] }
        );
        expect(decision.blocked).toBe(true);
    });

    test('isCountryBlocked allowlist allows listed country', () => {
        const decision = ipUtils.isCountryBlocked(
            { countryCode: 'US' },
            { enabled: true, mode: 'allowlist', countries: ['US'] }
        );
        expect(decision.blocked).toBe(false);
    });
});
