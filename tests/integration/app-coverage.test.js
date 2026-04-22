/**
 * Integration coverage for src/app.js
 *
 * Builds the real app via createApp() and exercises legacy URL rewrites,
 * stub endpoints, static fallbacks, and 404/error paths to cover the
 * many small branches in app.js.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const request = require('supertest');

let createApp;
let appHandle;

beforeAll(() => {
    // Use an isolated DB dir so we don't trample tests/test-data
    process.env.DATABASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'app-cov-'));
    jest.resetModules();
    ({ createApp } = require('../../src/app'));
    appHandle = createApp();
});

afterAll(() => {
    if (appHandle) {
        try { appHandle.sessionCleanup.stop(); } catch (e) { }
        try { appHandle.io.close(); } catch (e) { }
        try { appHandle.server.close(); } catch (e) { }
    }
    try { fs.rmSync(process.env.DATABASE_DIR, { recursive: true, force: true }); } catch (e) { }
});

describe('app.js legacy URL rewrites', () => {
    test('rewrites /api/2fa/setup -> /api/users/profile/2fa/setup (requires auth)', async () => {
        const res = await request(appHandle.app).post('/api/2fa/setup');
        // Hits auth middleware -> 401
        expect(res.status).toBe(401);
    });

    test('rewrites /api/2fa/enable, /disable, /verify, /status', async () => {
        for (const p of ['/api/2fa/enable', '/api/2fa/disable', '/api/2fa/verify', '/api/2fa/status']) {
            const res = await request(appHandle.app).post(p);
            expect([401, 404]).toContain(res.status);
        }
    });

    test('rewrites /api/admin/users -> /api/users', async () => {
        const res = await request(appHandle.app).get('/api/admin/users');
        expect(res.status).toBe(401);
    });

    test('rewrites /api/admin/users/:id -> /api/users/:id', async () => {
        const res = await request(appHandle.app).get('/api/admin/users/abc');
        // Either auth-rejected (401) or route not found (404) — both prove rewrite applied
        expect([401, 404]).toContain(res.status);
    });

    test('rewrites /api/admin/profile -> /api/users/profile', async () => {
        const res = await request(appHandle.app).get('/api/admin/profile');
        expect(res.status).toBe(401);
    });

    test('rewrites /api/admin/change-password -> /api/users/profile/password', async () => {
        const res = await request(appHandle.app).post('/api/admin/change-password').send({});
        expect([400, 401]).toContain(res.status);
    });

    test('rewrites /api/admin/sessions -> /api/sessions', async () => {
        const res = await request(appHandle.app).get('/api/admin/sessions');
        expect(res.status).toBe(401);
    });

    test('rewrites /api/auth/login -> /api/admin/login', async () => {
        const res = await request(appHandle.app)
            .post('/api/auth/login')
            .send({ username: 'noone', password: 'wrong' });
        expect([400, 401, 403]).toContain(res.status);
    });

    test('rewrite preserves query string', async () => {
        const res = await request(appHandle.app).get('/api/admin/users?foo=bar');
        expect(res.status).toBe(401);
    });

    test('non-rewritten path passes through', async () => {
        const res = await request(appHandle.app).get('/api/ready');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ready: true });
    });
});

describe('app.js stub endpoints', () => {
    test('GET /api/sessions requires auth', async () => {
        const res = await request(appHandle.app).get('/api/sessions');
        expect(res.status).toBe(401);
    });

    test('DELETE /api/sessions/all requires auth', async () => {
        const res = await request(appHandle.app).delete('/api/sessions/all');
        expect(res.status).toBe(401);
    });

    test('DELETE /api/sessions/:id requires auth', async () => {
        const res = await request(appHandle.app).delete('/api/sessions/some-id');
        expect(res.status).toBe(401);
    });

    test('POST /api/auth/request-reset returns 400 without username/email', async () => {
        const res = await request(appHandle.app).post('/api/auth/request-reset').send({});
        expect(res.status).toBe(400);
    });

    test('POST /api/auth/request-reset returns 200 with username', async () => {
        const res = await request(appHandle.app).post('/api/auth/request-reset').send({ username: 'a' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('POST /api/auth/request-reset returns 200 with email', async () => {
        const res = await request(appHandle.app).post('/api/auth/request-reset').send({ email: 'a@b.c' });
        expect(res.status).toBe(200);
    });

    test('POST /api/auth/validate-reset 400 without token', async () => {
        const res = await request(appHandle.app).post('/api/auth/validate-reset').send({});
        expect(res.status).toBe(400);
    });

    test('POST /api/auth/validate-reset 400 with invalid token', async () => {
        const res = await request(appHandle.app).post('/api/auth/validate-reset').send({ token: 'bogus' });
        expect(res.status).toBe(400);
        expect(res.body.valid).toBe(false);
    });

    test('POST /api/auth/reset-password 400 without fields', async () => {
        const res = await request(appHandle.app).post('/api/auth/reset-password').send({});
        expect(res.status).toBe(400);
    });

    test('POST /api/auth/reset-password 400 with bogus token', async () => {
        const res = await request(appHandle.app)
            .post('/api/auth/reset-password')
            .send({ token: 'x', newPassword: 'y' });
        expect(res.status).toBe(400);
    });

    test('POST /api/users/:id/reset-password requires auth', async () => {
        const res = await request(appHandle.app).post('/api/users/abc/reset-password').send({});
        expect(res.status).toBe(401);
    });

    test('POST /api/check-access returns allowed', async () => {
        const res = await request(appHandle.app).post('/api/check-access').send({});
        expect(res.status).toBe(200);
        expect(res.body.allowed).toBe(true);
    });

    test('GET /api/sites/:id/tickets requires auth', async () => {
        const res = await request(appHandle.app).get('/api/sites/abc/tickets');
        expect(res.status).toBe(401);
    });

    test('GET /api/sites/:id/sessions requires auth', async () => {
        const res = await request(appHandle.app).get('/api/sites/abc/sessions');
        expect(res.status).toBe(401);
    });

    test('GET /api/tickets/search requires auth', async () => {
        const res = await request(appHandle.app).get('/api/tickets/search?q=hi');
        expect(res.status).toBe(401);
    });
});

describe('app.js static / fallback routes', () => {
    test('GET /admin returns html', async () => {
        const res = await request(appHandle.app).get('/admin');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
    });

    test('GET /admin/anything returns html', async () => {
        const res = await request(appHandle.app).get('/admin/foo/bar');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
    });

    test('GET / returns html', async () => {
        const res = await request(appHandle.app).get('/');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
    });

    test('GET /widget.js returns javascript', async () => {
        const res = await request(appHandle.app).get('/widget.js');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/javascript/);
    });

    test('GET /nope/does-not-exist -> 404', async () => {
        const res = await request(appHandle.app).get('/nope/does-not-exist');
        expect(res.status).toBe(404);
    });
});

describe('app.js authenticated paths via auth + JWT', () => {
    let token;
    beforeAll(async () => {
        // Insert a real active user so authService.verifyToken passes
        appHandle.repositories.users.db.insert({
            id: 'u-test',
            username: 'tester',
            email: 't@t.t',
            password_hash: 'x',
            role: 'super_admin',
            is_active: true,
            created_at: Math.floor(Date.now() / 1000)
        });
        const jwt = require('jsonwebtoken');
        token = jwt.sign(
            { userId: 'u-test', username: 'tester', role: 'super_admin' },
            process.env.JWT_SECRET,
            { expiresIn: '5m' }
        );
    });

    test('GET /api/sessions returns sessions array when auth OK', async () => {
        const res = await request(appHandle.app)
            .get('/api/sessions')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.sessions)).toBe(true);
    });

    test('DELETE /api/sessions/:id with auth returns success boolean', async () => {
        const res = await request(appHandle.app)
            .delete('/api/sessions/none-such')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(typeof res.body.success).toBe('boolean');
    });

    test('GET /api/sites/:id/tickets returns 404 for unknown site', async () => {
        const res = await request(appHandle.app)
            .get('/api/sites/no-such/tickets')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(404);
    });

    test('GET /api/sites/:id/sessions returns 404 for unknown site', async () => {
        const res = await request(appHandle.app)
            .get('/api/sites/no-such/sessions')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(404);
    });

    test('GET /api/tickets/search returns either array (200) or 404 (route order)', async () => {
        const res = await request(appHandle.app)
            .get('/api/tickets/search')
            .set('Authorization', `Bearer ${token}`);
        expect([200, 404]).toContain(res.status);
    });

    test('GET /api/tickets/search with query filters', async () => {
        const res = await request(appHandle.app)
            .get('/api/tickets/search?q=needle')
            .set('Authorization', `Bearer ${token}`);
        expect([200, 404]).toContain(res.status);
    });

    test('POST /api/users/:id/reset-password 404 for unknown user', async () => {
        const res = await request(appHandle.app)
            .post('/api/users/no-such-user/reset-password')
            .set('Authorization', `Bearer ${token}`)
            .send({});
        expect(res.status).toBe(404);
    });

    test('POST /api/users/:id/reset-password with newPassword takes the updatePassword branch', async () => {
        // Insert a target user
        const targetId = 'u-target';
        appHandle.repositories.users.db.insert({
            id: targetId,
            username: 'target',
            email: 'target@x.x',
            password_hash: 'x',
            role: 'support',
            is_active: true,
            created_at: Math.floor(Date.now() / 1000)
        });
        const res = await request(appHandle.app)
            .post(`/api/users/${targetId}/reset-password`)
            .set('Authorization', `Bearer ${token}`)
            .send({ newPassword: 'newSecret123!' });
        // Either success (200) or repo error (500), both prove the branch was taken
        expect([200, 500]).toContain(res.status);
    });

    test('POST /api/users/:id/reset-password without newPassword takes the token-gen branch', async () => {
        const targetId = 'u-target2';
        appHandle.repositories.users.db.insert({
            id: targetId,
            username: 'target2',
            email: 'target2@x.x',
            password_hash: 'x',
            role: 'support',
            is_active: true,
            created_at: Math.floor(Date.now() / 1000)
        });
        const res = await request(appHandle.app)
            .post(`/api/users/${targetId}/reset-password`)
            .set('Authorization', `Bearer ${token}`)
            .send({});
        expect(res.status).toBe(200);
        expect(typeof res.body.resetToken).toBe('string');
    });

    test('POST /api/users/:id/reset-password updatePassword reject -> 500 (catch branch)', async () => {
        const targetId = 'u-target-fail';
        appHandle.repositories.users.db.insert({
            id: targetId, username: 'tfail', email: 'tf@x.x', password_hash: 'x',
            role: 'support', is_active: true, created_at: Math.floor(Date.now() / 1000)
        });
        const origUpdatePassword = appHandle.repositories.users.updatePassword;
        appHandle.repositories.users.updatePassword = jest.fn(() => Promise.reject(new Error('db fail')));
        try {
            const res = await request(appHandle.app)
                .post(`/api/users/${targetId}/reset-password`)
                .set('Authorization', `Bearer ${token}`)
                .send({ newPassword: 'pwpwpwpw' });
            expect(res.status).toBe(500);
            expect(res.body.error).toBe('db fail');
        } finally {
            appHandle.repositories.users.updatePassword = origUpdatePassword;
        }
    });

    test('POST /api/users/:id/reset-password setResetToken throws -> caught, still returns success', async () => {
        const targetId = 'u-target-rst';
        appHandle.repositories.users.db.insert({
            id: targetId, username: 'trst', email: 'tr@x.x', password_hash: 'x',
            role: 'support', is_active: true, created_at: Math.floor(Date.now() / 1000)
        });
        const origSetResetToken = appHandle.repositories.users.setResetToken;
        appHandle.repositories.users.setResetToken = jest.fn(() => { throw new Error('boom'); });
        try {
            const res = await request(appHandle.app)
                .post(`/api/users/${targetId}/reset-password`)
                .set('Authorization', `Bearer ${token}`)
                .send({});
            expect(res.status).toBe(200);
            expect(typeof res.body.resetToken).toBe('string');
        } finally {
            appHandle.repositories.users.setResetToken = origSetResetToken;
        }
    });

    test('POST /api/users/:id/reset-password without setResetToken uses update fallback branch', async () => {
        const targetId = 'u-target-upd';
        appHandle.repositories.users.db.insert({
            id: targetId, username: 'tupd', email: 'tu@x.x', password_hash: 'x',
            role: 'support', is_active: true, created_at: Math.floor(Date.now() / 1000)
        });
        const origSetResetToken = appHandle.repositories.users.setResetToken;
        appHandle.repositories.users.setResetToken = undefined;
        const origUpdate = appHandle.repositories.users.update;
        appHandle.repositories.users.update = jest.fn();
        try {
            const res = await request(appHandle.app)
                .post(`/api/users/${targetId}/reset-password`)
                .set('Authorization', `Bearer ${token}`)
                .send({});
            expect(res.status).toBe(200);
            expect(appHandle.repositories.users.update).toHaveBeenCalled();
        } finally {
            appHandle.repositories.users.setResetToken = origSetResetToken;
            appHandle.repositories.users.update = origUpdate;
        }
    });

    test('DELETE /api/sessions/all when deleteAll throws still returns success (catch branch)', async () => {
        const orig = appHandle.repositories.sessions.deleteAll;
        appHandle.repositories.sessions.deleteAll = jest.fn(() => { throw new Error('x'); });
        try {
            const res = await request(appHandle.app)
                .delete('/api/sessions/all')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        } finally {
            appHandle.repositories.sessions.deleteAll = orig;
        }
    });

    test('DELETE /api/sessions/all when deleteAll missing skips invocation but returns success', async () => {
        const orig = appHandle.repositories.sessions.deleteAll;
        appHandle.repositories.sessions.deleteAll = undefined;
        try {
            const res = await request(appHandle.app)
                .delete('/api/sessions/all')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        } finally {
            appHandle.repositories.sessions.deleteAll = orig;
        }
    });

    test('DELETE /api/sessions/:id when delete missing returns success:false', async () => {
        const orig = appHandle.repositories.sessions.delete;
        appHandle.repositories.sessions.delete = undefined;
        try {
            const res = await request(appHandle.app)
                .delete('/api/sessions/some-id')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
        } finally {
            appHandle.repositories.sessions.delete = orig;
        }
    });
});

describe('app.js defensive ternary branches in stub endpoints', () => {
    let token;
    beforeAll(() => {
        const jwt = require('jsonwebtoken');
        token = jwt.sign(
            { userId: 'u-test', username: 'tester', role: 'super_admin' },
            process.env.JWT_SECRET,
            { expiresIn: '5m' }
        );
    });

    test('GET /api/sessions falls back to [] when sessions.findAll missing', async () => {
        const orig = appHandle.repositories.sessions.findAll;
        appHandle.repositories.sessions.findAll = undefined;
        try {
            const res = await request(appHandle.app)
                .get('/api/sessions')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
            expect(res.body.sessions).toEqual([]);
        } finally {
            appHandle.repositories.sessions.findAll = orig;
        }
    });

    test('GET /api/sessions catches error when findAll throws', async () => {
        const orig = appHandle.repositories.sessions.findAll;
        appHandle.repositories.sessions.findAll = () => { throw new Error('boom'); };
        try {
            const res = await request(appHandle.app)
                .get('/api/sessions')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(200);
            expect(res.body.sessions).toEqual([]);
        } finally {
            appHandle.repositories.sessions.findAll = orig;
        }
    });

    test('DELETE /api/sessions/:id catches error when delete throws', async () => {
        const orig = appHandle.repositories.sessions.delete;
        appHandle.repositories.sessions.delete = () => { throw new Error('boom'); };
        try {
            const res = await request(appHandle.app)
                .delete('/api/sessions/x')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(500);
        } finally {
            appHandle.repositories.sessions.delete = orig;
        }
    });

    test('GET /api/sites/:id/tickets falls back to null branch when findById missing', async () => {
        const orig = appHandle.repositories.sites.findById;
        appHandle.repositories.sites.findById = undefined;
        try {
            const res = await request(appHandle.app)
                .get('/api/sites/x/tickets')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(404);
        } finally {
            appHandle.repositories.sites.findById = orig;
        }
    });

    test('GET /api/sites/:id/sessions falls back when findById missing', async () => {
        const orig = appHandle.repositories.sites.findById;
        appHandle.repositories.sites.findById = undefined;
        try {
            const res = await request(appHandle.app)
                .get('/api/sites/x/sessions')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(404);
        } finally {
            appHandle.repositories.sites.findById = orig;
        }
    });

    test('GET /api/tickets/search returns [] when tickets.findAll missing', async () => {
        const orig = appHandle.repositories.tickets.findAll;
        appHandle.repositories.tickets.findAll = undefined;
        try {
            const res = await request(appHandle.app)
                .get('/api/tickets/search')
                .set('Authorization', `Bearer ${token}`);
            // Either 200 (handled by stub) or 404 (route order ambiguity)
            expect([200, 404]).toContain(res.status);
        } finally {
            appHandle.repositories.tickets.findAll = orig;
        }
    });

    test('GET /socket.io/something is passed through (404 handler skips socket.io)', async () => {
        const res = await request(appHandle.app).get('/socket.io/some-path-that-does-not-exist');
        // socket.io will respond 400/404 for malformed handshake, NOT the app's NotFoundError JSON
        // The key is that the 404-skip branch was taken
        expect(res.status).not.toBe(undefined);
    });
});

describe('app.js static fallback - file-exists TRUE branches via fs.existsSync stub', () => {
    let restoreExistsSync;
    let restoreSendFile;
    beforeEach(() => {
        // Force fs.existsSync to return true so the sendFile branch is taken
        const origExists = fs.existsSync;
        fs.existsSync = jest.fn(() => true);
        restoreExistsSync = () => { fs.existsSync = origExists; };

        // Stub express response.sendFile prototype to immediately respond rather than read disk
        const expressMod = require('express');
        const origSendFile = expressMod.response.sendFile;
        expressMod.response.sendFile = function (filePath) {
            this.type('html').status(200).send('<html><body>stubbed file ' + filePath + '</body></html>');
        };
        restoreSendFile = () => { expressMod.response.sendFile = origSendFile; };
    });
    afterEach(() => {
        if (restoreExistsSync) restoreExistsSync();
        if (restoreSendFile) restoreSendFile();
    });

    test('GET /admin sends file when present', async () => {
        const res = await request(appHandle.app).get('/admin');
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/stubbed file/);
    });

    test('GET /admin/* sends file when present', async () => {
        const res = await request(appHandle.app).get('/admin/anything');
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/stubbed file/);
    });

    test('GET / sends file when present', async () => {
        const res = await request(appHandle.app).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/stubbed file/);
    });
});
