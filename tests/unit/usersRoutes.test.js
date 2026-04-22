/**
 * Unit tests for src/routes/users.js
 */

const request = require('supertest');
const { buildRouterApp } = require('./_routerTestHelper');
const { createUsersRouter } = require('../../src/routes/users');

function build({ repo = {}, totp = {}, user } = {}) {
    const userRepository = {
        findAll: jest.fn(() => [{ id: 'u1' }]),
        findById: jest.fn((id) => ({
            id, username: 'tester', role: 'support',
            totp_enabled: false, totp_secret: 'SECRET',
            email: 'a@b.c', nickname: 'T', created_at: 1
        })),
        create: jest.fn(async (u) => ({ id: 'new-id', ...u })),
        update: jest.fn((id, u) => ({ id, ...u })),
        updateRole: jest.fn((id, r) => ({ id, role: r })),
        updateActive: jest.fn((id, a) => ({ id, isActive: a })),
        updateNickname: jest.fn((id, n) => ({ id, nickname: n })),
        delete: jest.fn(() => true),
        getStats: jest.fn(() => ({ total: 5 })),
        authenticate: jest.fn(async () => true),
        updatePassword: jest.fn(async () => true),
        setTotpSecret: jest.fn(),
        enableTotp: jest.fn(),
        disableTotp: jest.fn(),
        ...repo
    };
    const auditRepository = { log: jest.fn() };
    const totpMod = {
        generateSecret: jest.fn(() => 'SECRET'),
        generateTOTPUri: jest.fn(() => 'otpauth://totp/x'),
        generateQRCodeDataURL: jest.fn(async () => 'data:image/png;base64,xx'),
        verifyTOTP: jest.fn(() => true),
        generateRecoveryCodes: jest.fn(() => ['a', 'b']),
        ...totp
    };
    const app = buildRouterApp({
        basePath: '/api/users',
        factory: createUsersRouter,
        deps: { userRepository, auditRepository, totp: totpMod },
        user: user || { userId: 'admin1', username: 'admin', role: 'super_admin' }
    });
    return { app, userRepository, auditRepository, totp: totpMod };
}

describe('users routes', () => {
    test('GET /', async () => {
        const { app } = build();
        const res = await request(app).get('/api/users');
        expect(res.status).toBe(200);
    });

    test('POST / validates required fields', async () => {
        const { app } = build();
        const res = await request(app).post('/api/users').send({ username: 'x' });
        expect(res.status).toBe(400);
    });

    test('POST / validates role', async () => {
        const { app } = build();
        const res = await request(app)
            .post('/api/users')
            .send({ username: 'u', password: 'p', role: 'kingpin' });
        expect(res.status).toBe(400);
    });

    test('POST / success path', async () => {
        const { app, userRepository, auditRepository } = build();
        const res = await request(app)
            .post('/api/users')
            .send({ username: 'u', password: 'pw', role: 'support', email: 'e' });
        expect(res.status).toBe(200);
        expect(userRepository.create).toHaveBeenCalled();
        expect(auditRepository.log).toHaveBeenCalled();
    });

    test('POST / repository throws -> 400', async () => {
        const { app } = build({
            repo: { create: jest.fn(async () => { throw new Error('dup'); }) }
        });
        const res = await request(app)
            .post('/api/users')
            .send({ username: 'u', password: 'p', role: 'support' });
        expect(res.status).toBe(400);
    });

    test('PUT /:id 404 when not found', async () => {
        const { app } = build({ repo: { findById: () => null } });
        const res = await request(app).put('/api/users/x').send({ role: 'support' });
        expect(res.status).toBe(404);
    });

    test('PUT /:id blocks role change on self', async () => {
        const { app } = build();
        const res = await request(app).put('/api/users/admin1').send({ role: 'support' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/own role/);
    });

    test('PUT /:id blocks self-deactivation', async () => {
        const { app } = build();
        const res = await request(app).put('/api/users/admin1').send({ isActive: false });
        expect(res.status).toBe(400);
    });

    test('PUT /:id applies role/isActive/nickname/email', async () => {
        const { app, userRepository } = build();
        const res = await request(app)
            .put('/api/users/u1')
            .send({ role: 'support', isActive: true, nickname: 'N', email: 'e@e' });
        expect(res.status).toBe(200);
        expect(userRepository.updateRole).toHaveBeenCalled();
        expect(userRepository.updateActive).toHaveBeenCalled();
        expect(userRepository.updateNickname).toHaveBeenCalled();
        expect(userRepository.update).toHaveBeenCalled();
    });

    test('PATCH /:id/role requires role + 404 + self-block', async () => {
        const noBody = build();
        expect((await request(noBody.app).patch('/api/users/u1/role').send({})).status).toBe(400);

        const missing = build({ repo: { findById: () => null } });
        expect((await request(missing.app).patch('/api/users/x/role').send({ role: 'support' })).status).toBe(404);

        const self = build();
        const r = await request(self.app).patch('/api/users/admin1/role').send({ role: 'support' });
        expect(r.status).toBe(400);
    });

    test('PATCH /:id/role success', async () => {
        const { app, userRepository } = build();
        const res = await request(app).patch('/api/users/u1/role').send({ role: 'support' });
        expect(res.status).toBe(200);
        expect(userRepository.updateRole).toHaveBeenCalled();
    });

    test('PATCH /:id/active 404 + self-block + success', async () => {
        const missing = build({ repo: { findById: () => null } });
        expect((await request(missing.app).patch('/api/users/x/active').send({ isActive: true })).status).toBe(404);

        const self = build();
        expect((await request(self.app).patch('/api/users/admin1/active').send({ isActive: false })).status).toBe(400);

        const ok = build();
        const r = await request(ok.app).patch('/api/users/u1/active').send({ isActive: true });
        expect(r.status).toBe(200);
    });

    test('DELETE /:id self-block + 404 + success + repo error', async () => {
        const self = build();
        expect((await request(self.app).delete('/api/users/admin1')).status).toBe(400);

        const notFound = build({ repo: { delete: () => false } });
        expect((await request(notFound.app).delete('/api/users/x')).status).toBe(404);

        const ok = build();
        expect((await request(ok.app).delete('/api/users/u1')).status).toBe(200);

        const err = build({ repo: { delete: () => { throw new Error('boom'); } } });
        expect((await request(err.app).delete('/api/users/u1')).status).toBe(400);
    });

    test('GET /stats', async () => {
        const { app } = build();
        const res = await request(app).get('/api/users/stats');
        expect(res.body).toEqual({ total: 5 });
    });

    test('GET /profile success and 404', async () => {
        const ok = build();
        const r1 = await request(ok.app).get('/api/users/profile');
        expect(r1.status).toBe(200);
        expect(r1.body.username).toBe('tester');

        const missing = build({ repo: { findById: () => null } });
        expect((await request(missing.app).get('/api/users/profile')).status).toBe(404);
    });

    test('PATCH /profile/nickname requires body', async () => {
        const { app } = build();
        const r = await request(app).patch('/api/users/profile/nickname').send({});
        expect(r.status).toBe(400);
    });

    test('PATCH /profile/nickname success', async () => {
        const { app } = build();
        const r = await request(app).patch('/api/users/profile/nickname').send({ nickname: 'New' });
        expect(r.status).toBe(200);
        expect(r.body.nickname).toBe('New');
    });

    test('POST /profile/password validates', async () => {
        const { app } = build();
        const r1 = await request(app).post('/api/users/profile/password').send({});
        expect(r1.status).toBe(400);

        const r2 = await request(app)
            .post('/api/users/profile/password')
            .send({ currentPassword: 'x', newPassword: 'short' });
        expect(r2.status).toBe(400);
    });

    test('POST /profile/password 404 when user missing', async () => {
        const { app } = build({ repo: { findById: () => null } });
        const r = await request(app)
            .post('/api/users/profile/password')
            .send({ currentPassword: 'old', newPassword: 'newpassword' });
        expect(r.status).toBe(404);
    });

    test('POST /profile/password rejects bad current', async () => {
        const { app } = build({ repo: { authenticate: async () => false } });
        const r = await request(app)
            .post('/api/users/profile/password')
            .send({ currentPassword: 'wrong', newPassword: 'newpassword' });
        expect(r.status).toBe(401);
    });

    test('POST /profile/password success', async () => {
        const { app, userRepository } = build();
        const r = await request(app)
            .post('/api/users/profile/password')
            .send({ currentPassword: 'old', newPassword: 'newpassword' });
        expect(r.status).toBe(200);
        expect(userRepository.updatePassword).toHaveBeenCalled();
    });

    test('POST /profile/2fa/setup user missing', async () => {
        const { app } = build({ repo: { findById: () => null } });
        const r = await request(app).post('/api/users/profile/2fa/setup');
        expect(r.status).toBe(404);
    });

    test('POST /profile/2fa/setup blocks if already enabled', async () => {
        const { app } = build({
            repo: { findById: (id) => ({ id, username: 't', totp_enabled: true }) }
        });
        const r = await request(app).post('/api/users/profile/2fa/setup');
        expect(r.status).toBe(400);
    });

    test('POST /profile/2fa/setup success returns secret + qr', async () => {
        const { app } = build();
        const r = await request(app).post('/api/users/profile/2fa/setup');
        expect(r.status).toBe(200);
        expect(r.body.secret).toBe('SECRET');
        expect(r.body.qrCode).toBeDefined();
    });

    test('POST /profile/2fa/setup falls back when QR fails', async () => {
        const { app } = build({
            totp: { generateQRCodeDataURL: async () => { throw new Error('no png'); } }
        });
        const r = await request(app).post('/api/users/profile/2fa/setup');
        expect(r.status).toBe(200);
        expect(r.body.qrCode).toMatch(/otpauth/);
    });

    test('POST /profile/2fa/enable validates and 400/404 paths', async () => {
        const noCode = build();
        expect((await request(noCode.app).post('/api/users/profile/2fa/enable').send({})).status).toBe(400);

        const noSecret = build({
            repo: { findById: (id) => ({ id, username: 't' }) }
        });
        expect((await request(noSecret.app).post('/api/users/profile/2fa/enable').send({ code: '123' })).status).toBe(400);

        const badCode = build({ totp: { verifyTOTP: () => false } });
        expect((await request(badCode.app).post('/api/users/profile/2fa/enable').send({ code: 'bad' })).status).toBe(400);
    });

    test('POST /profile/2fa/enable success', async () => {
        const { app, userRepository } = build();
        const r = await request(app).post('/api/users/profile/2fa/enable').send({ code: '123456' });
        expect(r.status).toBe(200);
        expect(r.body.recoveryCodes).toEqual(['a', 'b']);
        expect(userRepository.enableTotp).toHaveBeenCalled();
    });

    test('POST /profile/2fa/disable validates / 404 / wrong-pw / success', async () => {
        const noPw = build();
        expect((await request(noPw.app).post('/api/users/profile/2fa/disable').send({})).status).toBe(400);

        const missing = build({ repo: { findById: () => null } });
        expect((await request(missing.app).post('/api/users/profile/2fa/disable').send({ password: 'p' })).status).toBe(404);

        const wrong = build({ repo: { authenticate: async () => false } });
        expect((await request(wrong.app).post('/api/users/profile/2fa/disable').send({ password: 'p' })).status).toBe(401);

        const ok = build();
        const r = await request(ok.app).post('/api/users/profile/2fa/disable').send({ password: 'p' });
        expect(r.status).toBe(200);
        expect(ok.userRepository.disableTotp).toHaveBeenCalled();
    });
});
