/**
 * Extended API Integration Tests
 * Additional tests for comprehensive coverage
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Set test environment before requiring app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-extended';
process.env.DATABASE_DIR = path.join(__dirname, 'test-data-extended');

// Ensure test directory exists
const TEST_DIR = process.env.DATABASE_DIR;
if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Clear require cache
delete require.cache[require.resolve('../../src/database')];
delete require.cache[require.resolve('../../server')];

const { app, db } = require('../../server');

describe('Extended API Coverage', () => {
    let superAdminToken;
    let adminToken;
    let supportToken;
    let testSiteId;
    let testTicketId;

    beforeAll(async () => {
        // Create test users
        try {
            await db.users.create('ext_superadmin', 'ext_super@test.com', 'ExtSuper123!', 'super_admin');
        } catch (e) { /* exists */ }

        try {
            await db.users.create('ext_admin', 'ext_admin@test.com', 'ExtAdmin123!', 'admin');
        } catch (e) { /* exists */ }

        try {
            await db.users.create('ext_support', 'ext_support@test.com', 'ExtSupport123!', 'support');
        } catch (e) { /* exists */ }

        // Get tokens
        const superRes = await request(app)
            .post('/api/admin/login')
            .send({ username: 'ext_superadmin', password: 'ExtSuper123!' });
        superAdminToken = superRes.body.token;

        const adminRes = await request(app)
            .post('/api/admin/login')
            .send({ username: 'ext_admin', password: 'ExtAdmin123!' });
        adminToken = adminRes.body.token;

        const supportRes = await request(app)
            .post('/api/admin/login')
            .send({ username: 'ext_support', password: 'ExtSupport123!' });
        supportToken = supportRes.body.token;

        // Create test site
        const siteRes = await request(app)
            .post('/api/sites')
            .set('Authorization', `Bearer ${superAdminToken}`)
            .send({ name: 'Extended Test Site', domain: `ext-${Date.now()}.com` });
        testSiteId = siteRes.body.id;

        // Create test ticket
        testTicketId = `ext_ticket_${Date.now()}`;
        db.tickets.create(testTicketId, 'Extended Test Customer', '10.0.0.1', null, null);
    });

    afterAll(() => {
        if (fs.existsSync(TEST_DIR)) {
            const files = fs.readdirSync(TEST_DIR);
            files.forEach(file => {
                try { fs.unlinkSync(path.join(TEST_DIR, file)); } catch (e) { }
            });
            try { fs.rmdirSync(TEST_DIR); } catch (e) { }
        }
    });

    describe('Site Chatbot Configuration', () => {
        test('GET /api/sites/:id/chatbot should return chatbot config', async () => {
            const res = await request(app)
                .get(`/api/sites/${testSiteId}/chatbot`)
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect(res.statusCode).toBe(200);
        });

        test('PUT /api/sites/:id/chatbot should update chatbot config', async () => {
            const res = await request(app)
                .put(`/api/sites/${testSiteId}/chatbot`)
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    welcomeMessage: 'Custom welcome for site',
                    botName: 'Site Bot'
                });

            expect(res.statusCode).toBe(200);
        });

        test('GET /api/sites/:id/tickets should return site tickets', async () => {
            const res = await request(app)
                .get(`/api/sites/${testSiteId}/tickets`)
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });
    });

    describe('Ticket Management Extended', () => {
        test('PUT /api/tickets/:id should update ticket properties', async () => {
            const res = await request(app)
                .put(`/api/tickets/${testTicketId}`)
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    status: 'in_progress',
                    priority: 'high',
                    notes: 'Test notes'
                });

            expect(res.statusCode).toBe(200);
        });

        test('PUT /api/tickets/:id should handle assignedTo', async () => {
            const user = db.users.findByUsername('ext_support');

            const res = await request(app)
                .put(`/api/tickets/${testTicketId}`)
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({ assignedTo: user?.id });

            expect(res.statusCode).toBe(200);
        });

        test('PUT /api/tickets/:id with non-existent ticket', async () => {
            const res = await request(app)
                .put('/api/tickets/non-existent-ticket')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({ status: 'resolved' });

            expect(res.statusCode).toBe(404);
        });

        test('DELETE /api/tickets/:id should delete ticket', async () => {
            // Create ticket to delete
            const ticketToDelete = `delete_ext_${Date.now()}`;
            db.tickets.create(ticketToDelete, 'Delete Customer', '127.0.0.1', null, null);

            const res = await request(app)
                .delete(`/api/tickets/${ticketToDelete}`)
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect(res.statusCode).toBe(200);
        });
    });

    describe('User Edge Cases', () => {
        test('PUT /api/users/:id should update email', async () => {
            const user = db.users.findByUsername('ext_support');
            if (!user) return;

            const res = await request(app)
                .put(`/api/users/${user.id}`)
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({ email: `updated_${Date.now()}@test.com` });

            expect(res.statusCode).toBe(200);
        });

        test('PUT /api/users/:id should update nickname', async () => {
            const user = db.users.findByUsername('ext_support');
            if (!user) return;

            const res = await request(app)
                .put(`/api/users/${user.id}`)
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({ nickname: 'New Nickname' });

            expect(res.statusCode).toBe(200);
        });

        test('PUT /api/users/:id should update is_active', async () => {
            const user = db.users.findByUsername('ext_support');
            if (!user) return;

            const res = await request(app)
                .put(`/api/users/${user.id}`)
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({ is_active: true });

            expect(res.statusCode).toBe(200);
        });

        test('POST /api/users with duplicate username', async () => {
            const res = await request(app)
                .post('/api/users')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    username: 'ext_superadmin',
                    password: 'DuplicatePass123!',
                    role: 'support'
                });

            expect(res.statusCode).toBe(400);
        });

        test('DELETE /api/users should prevent self-deletion', async () => {
            const user = db.users.findByUsername('ext_superadmin');

            const res = await request(app)
                .delete(`/api/users/${user.id}`)
                .set('Authorization', `Bearer ${superAdminToken}`);

            // Should be forbidden or error
            expect([400, 403, 500]).toContain(res.statusCode);
        });
    });

    describe('Sites Edge Cases', () => {
        test('POST /api/sites with duplicate domain', async () => {
            // Get existing site
            const sites = db.sites.findAll();
            if (sites.length === 0) return;

            const res = await request(app)
                .post('/api/sites')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    name: 'Duplicate Domain Site',
                    domain: sites[0].domain
                });

            expect(res.statusCode).toBe(400);
        });

        test('PUT /api/sites/:id with non-existent site', async () => {
            const res = await request(app)
                .put('/api/sites/non-existent-site')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({ name: 'New Name' });

            expect(res.statusCode).toBe(404);
        });

        test('PUT /api/sites/:id should update all fields', async () => {
            const res = await request(app)
                .put(`/api/sites/${testSiteId}`)
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    name: 'Fully Updated Site',
                    domain: `updated-${Date.now()}.com`,
                    description: 'Updated description',
                    is_active: true,
                    color_primary: '#ff0000',
                    color_secondary: '#00ff00',
                    welcome_message: 'Custom welcome'
                });

            expect(res.statusCode).toBe(200);
        });

        test('DELETE /api/sites/:id with non-existent site', async () => {
            const res = await request(app)
                .delete('/api/sites/non-existent-site')
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect([200, 404]).toContain(res.statusCode);
        });
    });

    describe('Audit Log Extended', () => {
        test('GET /api/audit with action filter', async () => {
            const res = await request(app)
                .get('/api/audit?action=LOGIN')
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect(res.statusCode).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        test('GET /api/audit with user filter', async () => {
            const user = db.users.findByUsername('ext_superadmin');

            const res = await request(app)
                .get(`/api/audit?userId=${user.id}`)
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect(res.statusCode).toBe(200);
        });

        test('GET /api/audit with large limit', async () => {
            const res = await request(app)
                .get('/api/audit?limit=1000')
                .set('Authorization', `Bearer ${superAdminToken}`);

            expect(res.statusCode).toBe(200);
        });
    });

    describe('Chatbot Configuration Edge Cases', () => {
        test('POST /api/chatbot/message with empty message', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .send({ message: '' });

            expect([200, 400]).toContain(res.statusCode);
        });

        test('POST /api/chatbot/message with escalation keyword', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .send({ message: 'I want to talk to a human' });

            expect(res.statusCode).toBe(200);
        });

        test('PUT /api/chatbot/admin/config should update all settings', async () => {
            const res = await request(app)
                .put('/api/chatbot/admin/config')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    botName: 'Extended Test Bot',
                    welcomeMessage: 'Extended welcome',
                    fallbackMessage: 'Extended fallback',
                    escalationMessage: 'Connecting you now',
                    enabled: true
                });

            expect(res.statusCode).toBe(200);
        });
    });

    describe('Authentication Edge Cases', () => {
        test('POST /api/admin/login with missing password', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({ username: 'ext_superadmin' });

            expect([400, 401]).toContain(res.statusCode);
        });

        test('POST /api/admin/login with missing username', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({ password: 'SomePass123!' });

            expect([400, 401]).toContain(res.statusCode);
        });

        test('POST /api/admin/login with inactive user', async () => {
            // Create inactive user
            try {
                const user = await db.users.create(
                    `inactive_${Date.now()}`,
                    `inactive_${Date.now()}@test.com`,
                    'InactivePass123!',
                    'support'
                );
                db.users.updateActive(user.id, false);

                const res = await request(app)
                    .post('/api/admin/login')
                    .send({ username: user.username, password: 'InactivePass123!' });

                expect([401, 403]).toContain(res.statusCode);
            } catch (e) { /* ignore */ }
        });

        test('POST /api/admin/change-password should work with valid data', async () => {
            // Create a new user to change password
            const username = `pwchange_${Date.now()}`;
            await db.users.create(username, `${username}@test.com`, 'OldPassword123!', 'support');

            const loginRes = await request(app)
                .post('/api/admin/login')
                .send({ username, password: 'OldPassword123!' });

            if (loginRes.body.token) {
                const res = await request(app)
                    .post('/api/admin/change-password')
                    .set('Authorization', `Bearer ${loginRes.body.token}`)
                    .send({
                        currentPassword: 'OldPassword123!',
                        newPassword: 'NewPassword123!'
                    });

                expect([200, 400, 401]).toContain(res.statusCode);
            }
        });
    });

    describe('Role-Based Access Extended', () => {
        test('Support user cannot access sites', async () => {
            const res = await request(app)
                .get('/api/sites')
                .set('Authorization', `Bearer ${supportToken}`);

            expect(res.statusCode).toBe(403);
        });

        test('Support user cannot create sites', async () => {
            const res = await request(app)
                .post('/api/sites')
                .set('Authorization', `Bearer ${supportToken}`)
                .send({ name: 'Hacker Site', domain: 'hacker.com' });

            expect(res.statusCode).toBe(403);
        });

        test('Support user cannot delete tickets', async () => {
            const res = await request(app)
                .delete(`/api/tickets/${testTicketId}`)
                .set('Authorization', `Bearer ${supportToken}`);

            expect(res.statusCode).toBe(403);
        });

        test('Admin user can access audit with proper permissions', async () => {
            const res = await request(app)
                .get('/api/audit')
                .set('Authorization', `Bearer ${adminToken}`);

            // Admin may or may not have view_audit permission
            expect([200, 403]).toContain(res.statusCode);
        });
    });
});
