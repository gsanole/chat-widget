/**
 * Regression tests for previously-fixed bugs.
 *
 * Each `describe` block locks in a specific bug fix so it cannot be
 * silently reintroduced. Reference the commit hash next to each block
 * for context.
 */

const path = require('path');
const fs = require('fs');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'regression-test-secret';
process.env.DATABASE_DIR = path.join(__dirname, 'test-data-regression');

if (!fs.existsSync(process.env.DATABASE_DIR)) {
    fs.mkdirSync(process.env.DATABASE_DIR, { recursive: true });
}

delete require.cache[require.resolve('../../src/database')];
delete require.cache[require.resolve('../../server')];

const { app } = require('../../server');
const { verifyTOTP, generateTOTP, generateSecret } = require('../../src/utils/totp');

// Non-localhost IP so the rate limiter doesn't skip via isLocalhost().
const PUBLIC_IP = '203.0.113.42';

describe('Regression: health endpoints exempt from rate limiter (commits 29d13ec, 958b7ae)', () => {
    test('GET /api/ready never returns 429 even when flooded from a public IP', async () => {
        const requests = [];
        for (let i = 0; i < 200; i++) {
            requests.push(
                request(app).get('/api/ready').set('x-forwarded-for', PUBLIC_IP)
            );
        }
        const responses = await Promise.all(requests);
        const statuses = responses.map((r) => r.status);
        expect(statuses.every((s) => s === 200)).toBe(true);
        expect(statuses).not.toContain(429);
    });

    test('GET /api/health never returns 429 even when flooded from a public IP', async () => {
        const requests = [];
        for (let i = 0; i < 200; i++) {
            requests.push(
                request(app).get('/api/health').set('x-forwarded-for', PUBLIC_IP)
            );
        }
        const responses = await Promise.all(requests);
        const statuses = responses.map((r) => r.status);
        expect(statuses.every((s) => s === 200)).toBe(true);
        expect(statuses).not.toContain(429);
    });

    test('GET /api/health body includes status, timestamp, and numeric uptime', async () => {
        const res = await request(app).get('/api/health').set('x-forwarded-for', PUBLIC_IP);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(typeof res.body.timestamp).toBe('string');
        expect(Number.isFinite(Date.parse(res.body.timestamp))).toBe(true);
        expect(typeof res.body.uptime).toBe('number');
        expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    });

    test('GET /api/ready body is { ready: true }', async () => {
        const res = await request(app).get('/api/ready').set('x-forwarded-for', PUBLIC_IP);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ready: true });
    });
});

describe('Regression: TOTP verification window tolerates ±60s drift (commit c1defcc)', () => {
    let secret;
    let realDateNow;

    beforeAll(() => {
        secret = generateSecret();
        realDateNow = Date.now;
    });

    afterEach(() => {
        Date.now = realDateNow;
    });

    test('code from 30s in the past still verifies', () => {
        const past = Math.floor(Date.now() / 1000) - 30;
        const code = generateTOTP(secret, past);
        expect(verifyTOTP(secret, code)).toBe(true);
    });

    test('code from 60s in the past still verifies', () => {
        const past = Math.floor(Date.now() / 1000) - 60;
        const code = generateTOTP(secret, past);
        expect(verifyTOTP(secret, code)).toBe(true);
    });

    test('code from 30s in the future still verifies', () => {
        const future = Math.floor(Date.now() / 1000) + 30;
        const code = generateTOTP(secret, future);
        expect(verifyTOTP(secret, code)).toBe(true);
    });

    test('code from 60s in the future still verifies', () => {
        const future = Math.floor(Date.now() / 1000) + 60;
        const code = generateTOTP(secret, future);
        expect(verifyTOTP(secret, code)).toBe(true);
    });

    test('code from 120s in the past does NOT verify (outside window)', () => {
        const tooOld = Math.floor(Date.now() / 1000) - 120;
        const code = generateTOTP(secret, tooOld);
        expect(verifyTOTP(secret, code)).toBe(false);
    });
});

describe('Regression: server.listen() guard against double-bind (commit 72d4037)', () => {
    test('startServer() can be called twice without throwing ERR_SERVER_ALREADY_LISTEN', async () => {
        const srv = require('../../server');
        // First call already happened during require; calling again must be a no-op,
        // not throw "Listen method has been called more than once without closing."
        await expect(srv.startServer()).resolves.not.toThrow();
        await expect(srv.startServer()).resolves.not.toThrow();
        expect(srv.server.listening).toBe(true);
    });
});

describe('Regression: /api/ready is registered BEFORE the rate limiter (commits 29d13ec, 958b7ae)', () => {
    test('rate-limit headers are NOT attached to /api/ready', async () => {
        const res = await request(app).get('/api/ready').set('x-forwarded-for', PUBLIC_IP);
        expect(res.status).toBe(200);
        // express-rate-limit (standardHeaders: true) sets RateLimit-* on
        // every request that passes through it. Their absence proves the
        // route is registered above the limiter.
        expect(res.headers['ratelimit-limit']).toBeUndefined();
        expect(res.headers['ratelimit-remaining']).toBeUndefined();
    });

    test('rate-limit headers ARE attached to other /api/* routes (control)', async () => {
        const res = await request(app).get('/api/users').set('x-forwarded-for', PUBLIC_IP);
        // Whether 401/403/200, the limiter ran and attached headers.
        expect(res.headers['ratelimit-limit']).toBeDefined();
    });
});
