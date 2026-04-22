/**
 * Unit tests for src/routes/auth.js
 */

const request = require('supertest');
const { buildRouterApp } = require('./_routerTestHelper');
const { createAuthRouter } = require('../../src/routes/auth');

function build({ repo = {}, sessions = {}, audit = {}, totp = {}, svc = {} } = {}) {
    const authService = {
        generateToken: jest.fn(() => 'jwt-token'),
        ...svc
    };
    const userRepository = {
        authenticate: jest.fn(async () => ({
            id: 'u1', username: 'tester', role: 'support', totp_enabled: false, totp_secret: null
        })),
        findById: jest.fn(() => ({
            id: 'u1', username: 'tester', role: 'support', totp_enabled: false
        })),
        updateLastLogin: jest.fn(),
        enableTotp: jest.fn(),
        ...repo
    };
    const sessionRepository = {
        create: jest.fn(),
        deleteByToken: jest.fn(),
        ...sessions
    };
    const auditRepository = { log: jest.fn(), ...audit };
    const totpMod = {
        verifyTOTP: jest.fn(() => true),
        verifyRecoveryCode: jest.fn(() => ({ valid: true, remainingCodes: ['x'] })),
        ...totp
    };
    const app = buildRouterApp({
        basePath: '/api/auth',
        factory: createAuthRouter,
        deps: {
            authService, userRepository, sessionRepository,
            auditRepository, totp: totpMod
        }
    });
    return { app, authService, userRepository, sessionRepository, auditRepository, totp: totpMod };
}

describe('auth routes', () => {
    test('GET /health', async () => {
        const { app } = build();
        const res = await request(app).get('/api/auth/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(typeof res.body.uptime).toBe('number');
    });

    test('POST /admin/login validates required', async () => {
        const { app } = build();
        const r = await request(app).post('/api/auth/admin/login').send({});
        expect(r.status).toBe(400);
    });

    test('POST /admin/login bad creds -> 401 + audit', async () => {
        const { app, auditRepository } = build({
            repo: { authenticate: async () => null }
        });
        const r = await request(app).post('/api/auth/admin/login').send({ username: 'x', password: 'y' });
        expect(r.status).toBe(401);
        expect(auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({
            action: 'LOGIN_FAILED'
        }));
    });

    test('POST /admin/login asks for 2FA code when enabled', async () => {
        const { app } = build({
            repo: {
                authenticate: async () => ({
                    id: 'u1', username: 't', role: 'support', totp_enabled: true, totp_secret: 'S'
                })
            }
        });
        const r = await request(app).post('/api/auth/admin/login').send({ username: 't', password: 'p' });
        expect(r.status).toBe(200);
        expect(r.body.requires2FA).toBe(true);
    });

    test('POST /admin/login bad TOTP code w/ no recovery codes -> 401', async () => {
        const { app } = build({
            repo: {
                authenticate: async () => ({
                    id: 'u1', username: 't', role: 'support',
                    totp_enabled: true, totp_secret: 'S', recovery_codes: null
                })
            },
            totp: { verifyTOTP: () => false }
        });
        const r = await request(app)
            .post('/api/auth/admin/login')
            .send({ username: 't', password: 'p', totpCode: '000000' });
        expect(r.status).toBe(401);
        expect(r.body.error).toMatch(/2FA/);
    });

    test('POST /admin/login bad TOTP but valid recovery code -> success', async () => {
        const { app, userRepository } = build({
            repo: {
                authenticate: async () => ({
                    id: 'u1', username: 't', role: 'support',
                    totp_enabled: true, totp_secret: 'S',
                    recovery_codes: JSON.stringify(['code-1', 'code-2'])
                })
            },
            totp: {
                verifyTOTP: () => false,
                verifyRecoveryCode: () => ({ valid: true, remainingCodes: ['code-2'] })
            }
        });
        const r = await request(app)
            .post('/api/auth/admin/login')
            .send({ username: 't', password: 'p', totpCode: 'code-1' });
        expect(r.status).toBe(200);
        expect(r.body.token).toBe('jwt-token');
        expect(userRepository.enableTotp).toHaveBeenCalledWith('u1', ['code-2']);
    });

    test('POST /admin/login bad TOTP + invalid recovery -> 401', async () => {
        const { app } = build({
            repo: {
                authenticate: async () => ({
                    id: 'u1', username: 't', role: 'support',
                    totp_enabled: true, totp_secret: 'S',
                    recovery_codes: JSON.stringify(['code-1'])
                })
            },
            totp: {
                verifyTOTP: () => false,
                verifyRecoveryCode: () => ({ valid: false })
            }
        });
        const r = await request(app)
            .post('/api/auth/admin/login')
            .send({ username: 't', password: 'p', totpCode: 'wrong' });
        expect(r.status).toBe(401);
    });

    test('POST /admin/login success path generates token + session + audit', async () => {
        const { app, sessionRepository, auditRepository } = build();
        const r = await request(app)
            .post('/api/auth/admin/login')
            .send({ username: 'tester', password: 'p' });
        expect(r.status).toBe(200);
        expect(r.body.token).toBe('jwt-token');
        expect(sessionRepository.create).toHaveBeenCalled();
        expect(auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({
            action: 'LOGIN_SUCCESS'
        }));
    });

    test('POST /admin/login service throw -> 500', async () => {
        const consoleErr = jest.spyOn(console, 'error').mockImplementation(() => { });
        const { app } = build({
            repo: { authenticate: async () => { throw new Error('db down'); } }
        });
        const r = await request(app)
            .post('/api/auth/admin/login')
            .send({ username: 'x', password: 'y' });
        expect(r.status).toBe(500);
        consoleErr.mockRestore();
    });

    test('GET /admin/verify success and 401', async () => {
        const ok = build();
        const r1 = await request(ok.app).get('/api/auth/admin/verify');
        expect(r1.status).toBe(200);
        expect(r1.body.valid).toBe(true);

        const missing = build({ repo: { findById: () => null } });
        expect((await request(missing.app).get('/api/auth/admin/verify')).status).toBe(401);
    });

    test('POST /admin/logout deletes session and audits', async () => {
        const { app, sessionRepository, auditRepository } = build();
        const r = await request(app)
            .post('/api/auth/admin/logout')
            .set('Authorization', 'Bearer fake-token');
        expect(r.status).toBe(200);
        expect(sessionRepository.deleteByToken).toHaveBeenCalledWith('fake-token');
        expect(auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({
            action: 'LOGOUT'
        }));
    });
});
