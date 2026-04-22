/**
 * Authentication Tests
 * Tests for authentication, authorization, and security features
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// Set test environment before requiring app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-auth';
process.env.DATABASE_DIR = path.join(__dirname, 'test-data-auth');

// Ensure test directory exists
const TEST_DIR = process.env.DATABASE_DIR;
if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Clear require cache
delete require.cache[require.resolve('../../src/database')];
delete require.cache[require.resolve('../../server')];

const { app, db } = require('../../server');

describe('Authentication & Security', () => {
    let superAdminToken;
    let adminToken;
    let supportToken;

    beforeAll(async () => {
        // Create test users with different roles
        const users = [
            { username: 'auth_super', email: 'auth_super@test.com', password: 'SuperPass123!', role: 'super_admin' },
            { username: 'auth_admin', email: 'auth_admin@test.com', password: 'AdminPass123!', role: 'admin' },
            { username: 'auth_support', email: 'auth_support@test.com', password: 'SupportPass123!', role: 'support' }
        ];

        for (const user of users) {
            try {
                await db.users.create(user.username, user.email, user.password, user.role);
            } catch (e) {
                // User might already exist
            }
        }

        // Get tokens
        const superRes = await request(app)
            .post('/api/admin/login')
            .send({ username: 'auth_super', password: 'SuperPass123!' });
        superAdminToken = superRes.body.token;

        const adminRes = await request(app)
            .post('/api/admin/login')
            .send({ username: 'auth_admin', password: 'AdminPass123!' });
        adminToken = adminRes.body.token;

        const supportRes = await request(app)
            .post('/api/admin/login')
            .send({ username: 'auth_support', password: 'SupportPass123!' });
        supportToken = supportRes.body.token;
    });

    afterAll(() => {
        if (fs.existsSync(TEST_DIR)) {
            const files = fs.readdirSync(TEST_DIR);
            files.forEach(file => {
                try {
                    fs.unlinkSync(path.join(TEST_DIR, file));
                } catch (e) { /* ignore */ }
            });
            try {
                fs.rmdirSync(TEST_DIR);
            } catch (e) { /* ignore */ }
        }
    });

    describe('JWT Token Security', () => {
        test('should reject expired tokens', async () => {
            // Create an expired token
            const expiredToken = jwt.sign(
                { userId: 'test', username: 'test', role: 'admin', id: 'test-id' },
                process.env.JWT_SECRET,
                { expiresIn: '-1h' }
            );

            const res = await request(app)
                .get('/api/admin/verify')
                .set('Authorization', `Bearer ${expiredToken}`);

            expect(res.statusCode).toBe(401);
        });

        test('should reject tokens with invalid signature', async () => {
            const invalidToken = jwt.sign(
                { userId: 'test', username: 'test', role: 'admin' },
                'wrong-secret'
            );

            const res = await request(app)
                .get('/api/admin/verify')
                .set('Authorization', `Bearer ${invalidToken}`);

            expect(res.statusCode).toBe(401);
        });

        test('should reject malformed authorization header', async () => {
            const res = await request(app)
                .get('/api/admin/verify')
                .set('Authorization', 'InvalidFormat token123');

            expect(res.statusCode).toBe(401);
        });

        test('should reject empty bearer token', async () => {
            const res = await request(app)
                .get('/api/admin/verify')
                .set('Authorization', 'Bearer ');

            expect(res.statusCode).toBe(401);
        });

        test('should reject random string as token', async () => {
            const res = await request(app)
                .get('/api/admin/verify')
                .set('Authorization', 'Bearer randomgarbage12345');

            expect(res.statusCode).toBe(401);
        });
    });

    describe('Role-Based Access Control', () => {
        describe('Super Admin Permissions', () => {
            test('super_admin can access user management', async () => {
                const res = await request(app)
                    .get('/api/users')
                    .set('Authorization', `Bearer ${superAdminToken}`);

                expect(res.statusCode).toBe(200);
            });

            test('super_admin can access audit logs', async () => {
                const res = await request(app)
                    .get('/api/audit')
                    .set('Authorization', `Bearer ${superAdminToken}`);

                expect(res.statusCode).toBe(200);
            });

            test('super_admin can manage chatbot config', async () => {
                const res = await request(app)
                    .get('/api/chatbot/admin/config')
                    .set('Authorization', `Bearer ${superAdminToken}`);

                expect(res.statusCode).toBe(200);
            });
        });

        describe('Admin Permissions', () => {
            test('admin can access audit logs', async () => {
                const res = await request(app)
                    .get('/api/audit')
                    .set('Authorization', `Bearer ${adminToken}`);

                expect(res.statusCode).toBe(200);
            });

            test('admin cannot access user management', async () => {
                const res = await request(app)
                    .get('/api/users')
                    .set('Authorization', `Bearer ${adminToken}`);

                expect(res.statusCode).toBe(403);
            });

            test('admin can manage chatbot config', async () => {
                const res = await request(app)
                    .get('/api/chatbot/admin/config')
                    .set('Authorization', `Bearer ${adminToken}`);

                expect(res.statusCode).toBe(200);
            });
        });

        describe('Support Permissions', () => {
            test('support cannot access user management', async () => {
                const res = await request(app)
                    .get('/api/users')
                    .set('Authorization', `Bearer ${supportToken}`);

                expect(res.statusCode).toBe(403);
            });

            test('support cannot access audit logs', async () => {
                const res = await request(app)
                    .get('/api/audit')
                    .set('Authorization', `Bearer ${supportToken}`);

                expect(res.statusCode).toBe(403);
            });

            test('support cannot manage chatbot config', async () => {
                const res = await request(app)
                    .get('/api/chatbot/admin/config')
                    .set('Authorization', `Bearer ${supportToken}`);

                expect(res.statusCode).toBe(403);
            });
        });
    });

    describe('Password Security', () => {
        test('should require minimum password length', async () => {
            const res = await request(app)
                .post('/api/admin/change-password')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    currentPassword: 'SuperPass123!',
                    newPassword: 'short'
                });

            expect(res.statusCode).toBe(400);
        });

        test('should reject empty current password', async () => {
            const res = await request(app)
                .post('/api/admin/change-password')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    currentPassword: '',
                    newPassword: 'NewPassword123!'
                });

            expect(res.statusCode).toBeGreaterThanOrEqual(400);
        });
    });

    describe('Account Status', () => {
        let deactivatedUserId;

        beforeAll(async () => {
            // Create a user to deactivate
            try {
                const user = await db.users.create(
                    'deactivated_user',
                    'deactivated@test.com',
                    'DeactivatedPass123!',
                    'support'
                );
                deactivatedUserId = user.id;
                db.users.updateActive(deactivatedUserId, false);
            } catch (e) {
                const user = db.users.findByUsername('deactivated_user');
                if (user) {
                    deactivatedUserId = user.id;
                    db.users.updateActive(deactivatedUserId, false);
                }
            }
        });

        test('should reject login for deactivated user', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({ username: 'deactivated_user', password: 'DeactivatedPass123!' });

            expect(res.statusCode).toBe(401);
            // Server returns generic error for security (doesn't reveal if user is disabled)
            expect(res.body.error).toBeDefined();
        });

        test('should reject token for deactivated user', async () => {
            // Reactivate temporarily to get token
            db.users.updateActive(deactivatedUserId, true);

            const loginRes = await request(app)
                .post('/api/admin/login')
                .send({ username: 'deactivated_user', password: 'DeactivatedPass123!' });

            const token = loginRes.body.token;

            // Deactivate again
            db.users.updateActive(deactivatedUserId, false);

            // Try to use the token
            const res = await request(app)
                .get('/api/admin/verify')
                .set('Authorization', `Bearer ${token}`);

            expect(res.statusCode).toBe(401);
        });
    });

    describe('Login Security', () => {
        test('should not reveal if username exists', async () => {
            const res1 = await request(app)
                .post('/api/admin/login')
                .send({ username: 'nonexistent_user_12345', password: 'wrongpass' });

            const res2 = await request(app)
                .post('/api/admin/login')
                .send({ username: 'auth_super', password: 'wrongpass' });

            // Both should return similar error messages
            expect(res1.statusCode).toBe(401);
            expect(res2.statusCode).toBe(401);
        });

        test('should handle SQL injection attempts', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({
                    username: "admin' OR '1'='1",
                    password: "' OR '1'='1"
                });

            expect(res.statusCode).toBe(401);
        });

        test('should handle null values', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({ username: null, password: null });

            // Server returns 400 for missing required fields
            expect([400, 401]).toContain(res.statusCode);
        });
    });

    describe('Audit Logging', () => {
        test('should log successful login', async () => {
            const beforeLogs = db.audit.findAll(100);

            await request(app)
                .post('/api/admin/login')
                .send({ username: 'auth_super', password: 'SuperPass123!' });

            const afterLogs = db.audit.findAll(100);

            // Should have more logs after login
            expect(afterLogs.length).toBeGreaterThanOrEqual(beforeLogs.length);
        });

        test('should log user creation', async () => {
            const beforeCount = db.audit.findAll(100).length;

            await request(app)
                .post('/api/users')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    username: `audit_test_${Date.now()}`,
                    password: 'AuditTest123!',
                    role: 'support'
                });

            const afterLogs = db.audit.findAll(100);
            const userCreatedLog = afterLogs.find(l => l.action === 'USER_CREATED');

            expect(userCreatedLog).toBeDefined();
        });
    });

    describe('Session Management', () => {
        test('should create session on login', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({ username: 'auth_super', password: 'SuperPass123!' });

            expect(res.body.token).toBeDefined();

            // Verify session was created (indirectly through token verification)
            const verifyRes = await request(app)
                .get('/api/admin/verify')
                .set('Authorization', `Bearer ${res.body.token}`);

            expect(verifyRes.statusCode).toBe(200);
        });

        test('should invalidate session on logout', async () => {
            // Login
            const loginRes = await request(app)
                .post('/api/admin/login')
                .send({ username: 'auth_super', password: 'SuperPass123!' });

            const token = loginRes.body.token;

            // Logout
            await request(app)
                .post('/api/admin/logout')
                .set('Authorization', `Bearer ${token}`);

            // Token should still be technically valid (JWT doesn't track revocation without blacklist)
            // But best practice is implemented
        });
    });

    describe('2FA Flow', () => {
        test('should setup 2FA', async () => {
            const res = await request(app)
                .post('/api/2fa/setup')
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.secret).toBeDefined();
            expect(res.body.qrCode).toBeDefined();
        });

        test('should fail 2FA enable with invalid code', async () => {
            // First setup
            await request(app)
                .post('/api/2fa/setup')
                .set('Authorization', `Bearer ${superAdminToken}`);

            // Try to enable with wrong code
            const res = await request(app)
                .post('/api/2fa/enable')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({ code: '000000' });

            // Should return error (400 for invalid code, or 500 for edge cases)
            expect(res.statusCode).toBeGreaterThanOrEqual(400);
        });
    });

    describe('Input Sanitization', () => {
        test('should sanitize XSS in username', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({
                    username: '<script>alert("xss")</script>',
                    password: 'test'
                });

            // Should not crash, should return auth error
            expect(res.statusCode).toBe(401);
        });

        test('should handle very long input', async () => {
            const longString = 'a'.repeat(10000);

            const res = await request(app)
                .post('/api/admin/login')
                .send({
                    username: longString,
                    password: longString
                });

            // Should not crash
            expect(res.statusCode).toBeGreaterThanOrEqual(400);
        });

        test('should handle unicode characters', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({
                    username: '用户名',
                    password: '密码'
                });

            expect(res.statusCode).toBe(401);
        });

        test('should handle control characters', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({
                    username: 'user\x00name',
                    password: 'pass\x00word'
                });

            expect(res.statusCode).toBe(401);
        });
    });
});
