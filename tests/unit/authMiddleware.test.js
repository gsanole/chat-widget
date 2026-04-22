/**
 * Unit tests for src/middleware/auth.js
 *
 * Covers requireAuth, requirePermission and (previously uncovered)
 * optionalAuth across all branches.
 */

const express = require('express');
const request = require('supertest');
const { createAuthMiddleware } = require('../../src/middleware/auth');

function buildApp(authService, hasPermission = () => true) {
    const mw = createAuthMiddleware({ authService, hasPermission });
    const app = express();
    app.get('/required', mw.requireAuth, (req, res) => res.json({ user: req.user }));
    app.get(
        '/admin',
        mw.requireAuth,
        mw.requirePermission('manage_users'),
        (req, res) => res.json({ ok: true })
    );
    app.get('/optional', mw.optionalAuth, (req, res) => res.json({ user: req.user || null }));
    return app;
}

describe('createAuthMiddleware', () => {
    test('requireAuth: 401 when header missing', async () => {
        const app = buildApp({ verifyToken: () => null });
        const r = await request(app).get('/required');
        expect(r.status).toBe(401);
        expect(r.body.error).toMatch(/Authentication required/);
    });

    test('requireAuth: 401 when header missing Bearer prefix', async () => {
        const app = buildApp({ verifyToken: () => null });
        const r = await request(app).get('/required').set('Authorization', 'Token abc');
        expect(r.status).toBe(401);
    });

    test('requireAuth: 401 when token invalid', async () => {
        const app = buildApp({ verifyToken: jest.fn(() => null) });
        const r = await request(app).get('/required').set('Authorization', 'Bearer bad');
        expect(r.status).toBe(401);
        expect(r.body.error).toMatch(/Invalid or expired/);
    });

    test('requireAuth: success attaches decoded user', async () => {
        const verify = jest.fn(() => ({ userId: 'u1', role: 'admin' }));
        const app = buildApp({ verifyToken: verify });
        const r = await request(app).get('/required').set('Authorization', 'Bearer good');
        expect(r.status).toBe(200);
        expect(r.body.user).toEqual({ userId: 'u1', role: 'admin' });
        expect(verify).toHaveBeenCalledWith('good');
    });

    test('requirePermission: 403 when not allowed', async () => {
        const app = buildApp({ verifyToken: () => ({ userId: 'u', role: 'support' }) }, () => false);
        const r = await request(app).get('/admin').set('Authorization', 'Bearer t');
        expect(r.status).toBe(403);
        expect(r.body.error).toMatch(/Permission denied/);
    });

    test('requirePermission: passes through when allowed', async () => {
        const app = buildApp({ verifyToken: () => ({ userId: 'u', role: 'admin' }) }, () => true);
        const r = await request(app).get('/admin').set('Authorization', 'Bearer t');
        expect(r.status).toBe(200);
        expect(r.body.ok).toBe(true);
    });

    test('optionalAuth: continues with no user when header missing', async () => {
        const app = buildApp({ verifyToken: jest.fn() });
        const r = await request(app).get('/optional');
        expect(r.status).toBe(200);
        expect(r.body.user).toBeNull();
    });

    test('optionalAuth: continues with no user when prefix missing', async () => {
        const verify = jest.fn();
        const app = buildApp({ verifyToken: verify });
        const r = await request(app).get('/optional').set('Authorization', 'Token x');
        expect(r.status).toBe(200);
        expect(r.body.user).toBeNull();
        expect(verify).not.toHaveBeenCalled();
    });

    test('optionalAuth: continues with no user when verify returns null', async () => {
        const app = buildApp({ verifyToken: () => null });
        const r = await request(app).get('/optional').set('Authorization', 'Bearer bad');
        expect(r.status).toBe(200);
        expect(r.body.user).toBeNull();
    });

    test('optionalAuth: attaches user when token valid', async () => {
        const app = buildApp({ verifyToken: () => ({ userId: 'u9' }) });
        const r = await request(app).get('/optional').set('Authorization', 'Bearer ok');
        expect(r.status).toBe(200);
        expect(r.body.user).toEqual({ userId: 'u9' });
    });
});
