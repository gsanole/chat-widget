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
    test('server.js wraps server.listen() in an "if (!server.listening)" guard', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
        // The guard prevents the "Listen method has been called more than
        // once without closing" error when tests reuse the server.
        expect(src).toMatch(/if\s*\(\s*!\s*server\.listening\s*\)\s*server\.listen\s*\(\s*PORT/);
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

describe('Regression: mobile widget sizes responsively to viewport (commit 5ca75c2 + this fix)', () => {
    const widgetSrc = fs.readFileSync(
        path.join(__dirname, '..', '..', 'public', 'widget.js'),
        'utf8'
    );

    test('widget defines a mobile breakpoint at max-width: 480px', () => {
        expect(widgetSrc).toMatch(/@media\s*\(\s*max-width:\s*480px\s*\)/);
    });

    test('mobile chat window height uses dynamic viewport units (dvh) so it tracks the browser chrome', () => {
        expect(widgetSrc).toMatch(/dvh/);
    });

    test('mobile chat window is NOT a full-screen takeover (must use min() or a viewport-relative cap)', () => {
        // Either min(Xvh, ...) or an explicit < 100% cap is acceptable.
        // What we explicitly disallow: a single "height: 100dvh" / "100vh" with no cap.
        const lines = widgetSrc.split('\n');
        const offending = lines.find(l =>
            /^\s*height:\s*100d?vh\s*;?\s*$/.test(l) ||
            /^\s*max-height:\s*100d?vh\s*;?\s*$/.test(l)
        );
        expect(offending).toBeUndefined();
    });

    test('widget reserves space for the bubble + safe-area insets on mobile', () => {
        // The mobile sizing math must account for the 60px bubble and iOS safe areas.
        expect(widgetSrc).toMatch(/env\(\s*safe-area-inset-(top|bottom)/);
    });

    test('widget has an additional breakpoint for very small phones (<= 380px)', () => {
        expect(widgetSrc).toMatch(/@media\s*\(\s*max-width:\s*380px\s*\)/);
    });

    test('widget input font-size is >= 16px to prevent iOS Safari auto-zoom on focus', () => {
        // iOS Safari zooms the viewport whenever a focused input has font-size < 16px,
        // and does NOT zoom back out. Every input rule must therefore declare 16px+.
        const inputBlocks = widgetSrc.match(/\.chat-[a-z-]*input[a-z-]*\s+input[^{]*\{[^}]*\}/gi) || [];
        expect(inputBlocks.length).toBeGreaterThan(0);
        for (const block of inputBlocks) {
            const fontSize = block.match(/font-size:\s*(\d+)px/);
            if (fontSize) {
                expect(Number(fontSize[1])).toBeGreaterThanOrEqual(16);
            }
        }
    });
});

describe('Regression: admin login trims whitespace from copy-pasted credentials (this fix)', () => {
    const bcrypt = require('bcrypt');
    const db = require('../../src/database');

    const TEST_USER = 'regression-trim-user-' + Date.now();
    const TEST_PASS = 'CorrectHorseBatteryStaple!42';

    beforeAll(async () => {
        // Seed a known user with a known password. Username is unique per
        // run so we never collide with prior state.
        await db.users.create({
            username: TEST_USER,
            password: TEST_PASS,
            role: 'admin',
            email: TEST_USER + '@test.local'
        });
    });

    test('login succeeds when username has trailing whitespace (mobile copy-paste)', async () => {
        const res = await request(app)
            .post('/api/admin/login')
            .set('x-forwarded-for', PUBLIC_IP)
            .send({ username: TEST_USER + ' ', password: TEST_PASS });
        expect(res.status).toBe(200);
        expect(res.body.error).toBeUndefined();
    });

    test('login succeeds when password has trailing whitespace (mobile copy-paste)', async () => {
        const res = await request(app)
            .post('/api/admin/login')
            .set('x-forwarded-for', PUBLIC_IP)
            .send({ username: TEST_USER, password: TEST_PASS + ' ' });
        expect(res.status).toBe(200);
        expect(res.body.error).toBeUndefined();
    });

    test('login still rejects a genuinely wrong password', async () => {
        const res = await request(app)
            .post('/api/admin/login')
            .set('x-forwarded-for', PUBLIC_IP)
            .send({ username: TEST_USER, password: 'definitely-not-the-password' });
        expect(res.status).toBe(401);
    });
});
