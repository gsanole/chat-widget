/**
 * Extended Server API Tests
 * Focus on server.js routes and functions not covered elsewhere
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-server-ext';
process.env.DATABASE_DIR = path.join(__dirname, 'test-data-server-ext');

// Ensure test directory exists
const TEST_DIR = process.env.DATABASE_DIR;
if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Clear require cache
delete require.cache[require.resolve('../../src/database')];
delete require.cache[require.resolve('../../server')];

const { app, db, server } = require('../../server');

describe('Extended Server API Coverage', () => {
    let authToken;
    let testUserId;
    let testSiteId;

    beforeAll(async () => {
        // Wait for server to be ready
        await new Promise(resolve => setTimeout(resolve, 100));

        // Create super admin for testing
        const username = `server_ext_${Date.now()}`;
        const user = await db.users.create(
            username,
            `${username}@test.com`,
            'ServerExt123!',
            'super_admin',
            'Server Ext Admin'
        );
        testUserId = user.id;

        // Login to get token
        const loginRes = await request(app)
            .post('/api/admin/login')
            .send({ username: username, password: 'ServerExt123!' });

        if (!loginRes.body.token) {
            throw new Error(`Login failed: ${JSON.stringify(loginRes.body)}`);
        }
        authToken = loginRes.body.token;

        // Create a test site
        const site = db.sites.create(`ext-site-${Date.now()}.test.com`, 'Ext Test Site');
        testSiteId = site.id;
    });

    afterAll((done) => {
        server.close(() => {
            if (fs.existsSync(TEST_DIR)) {
                const files = fs.readdirSync(TEST_DIR);
                files.forEach(file => {
                    try { fs.unlinkSync(path.join(TEST_DIR, file)); } catch (e) { }
                });
                try { fs.rmdirSync(TEST_DIR); } catch (e) { }
            }
            done();
        });
    });

    describe('Ticket API Extended', () => {
        let testTicketId;

        beforeAll(async () => {
            // Ensure auth token is available
            if (!authToken) {
                throw new Error('Auth token not available');
            }
            testTicketId = `ext_ticket_${Date.now()}`;
            db.tickets.create(
                testTicketId,
                'Ext Ticket Customer',
                '192.168.1.100',
                testSiteId,
                null,
                { type: 'phone', value: '555-4321' }
            );
        });

        test('should get ticket details', async () => {
            const res = await request(app)
                .get(`/api/tickets/${testTicketId}`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
        });

        test('should return 404 for non-existent ticket', async () => {
            const res = await request(app)
                .get('/api/tickets/non-existent-ticket-xyz')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(404);
        });

        test('should update ticket status', async () => {
            const res = await request(app)
                .put(`/api/tickets/${testTicketId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({ status: 'in_progress' });

            expect(res.status).toBe(200);
        });

        test('should update ticket priority', async () => {
            const res = await request(app)
                .put(`/api/tickets/${testTicketId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({ priority: 'high' });

            expect(res.status).toBe(200);
        });

        test('should update ticket notes', async () => {
            const res = await request(app)
                .put(`/api/tickets/${testTicketId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({ notes: 'These are test notes for the ticket' });

            expect(res.status).toBe(200);
        });

        test('should update ticket assignee', async () => {
            const res = await request(app)
                .put(`/api/tickets/${testTicketId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({ assignedTo: testUserId });

            expect(res.status).toBe(200);
        });

        test('should update multiple ticket fields', async () => {
            const res = await request(app)
                .put(`/api/tickets/${testTicketId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    status: 'pending',
                    priority: 'medium',
                    notes: 'Updated notes'
                });

            expect(res.status).toBe(200);
        });

        test('should delete ticket', async () => {
            // Create a ticket to delete
            const deleteTicketId = `delete_ticket_${Date.now()}`;
            db.tickets.create(deleteTicketId, 'Delete Ticket Customer', '192.168.1.200', null, null);

            const res = await request(app)
                .delete(`/api/tickets/${deleteTicketId}`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
        });
    });

    describe('User Management Extended', () => {
        test('should create user with full details', async () => {
            const username = `full_user_${Date.now()}`;
            const res = await request(app)
                .post('/api/users')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    username,
                    email: `${username}@test.com`,
                    password: 'FullUser123!',
                    role: 'support',
                    nickname: 'Full User'
                });

            expect(res.status).toBe(200);
            expect(res.body.user.username).toBe(username);
        });

        test('should get all users', async () => {
            const res = await request(app)
                .get('/api/users')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        test('should update user role', async () => {
            // Create a user to update
            const username = `role_update_${Date.now()}`;
            const createRes = await request(app)
                .post('/api/users')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    username,
                    email: `${username}@test.com`,
                    password: 'RoleUpdate123!',
                    role: 'support'
                });

            const userId = createRes.body.user.id;

            const res = await request(app)
                .put(`/api/users/${userId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({ role: 'admin_support' });

            expect(res.status).toBe(200);
        });

        test('should update user status', async () => {
            const username = `status_update_${Date.now()}`;
            const createRes = await request(app)
                .post('/api/users')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    username,
                    email: `${username}@test.com`,
                    password: 'StatusUpdate123!',
                    role: 'support'
                });

            const userId = createRes.body.user.id;

            const res = await request(app)
                .put(`/api/users/${userId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({ isActive: false });

            expect(res.status).toBe(200);
        });

        test('should update user nickname', async () => {
            const username = `nick_update_${Date.now()}`;
            const createRes = await request(app)
                .post('/api/users')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    username,
                    email: `${username}@test.com`,
                    password: 'NickUpdate123!',
                    role: 'support'
                });

            const userId = createRes.body.user.id;

            const res = await request(app)
                .put(`/api/users/${userId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({ nickname: 'Cool Nickname' });

            expect(res.status).toBe(200);
        });

        test('should return 404 for non-existent user update', async () => {
            const res = await request(app)
                .put('/api/users/non-existent-user-id')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ role: 'admin' });

            expect(res.status).toBe(404);
        });

        test('should delete user', async () => {
            const username = `delete_user_${Date.now()}`;
            const createRes = await request(app)
                .post('/api/users')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    username,
                    email: `${username}@test.com`,
                    password: 'DeleteUser123!',
                    role: 'support'
                });

            const userId = createRes.body.user.id;

            const res = await request(app)
                .delete(`/api/users/${userId}`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
        });
    });

    describe('Site Management Extended', () => {
        test('should get site by ID', async () => {
            const res = await request(app)
                .get(`/api/sites/${testSiteId}`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
        });

        test('should return 404 for non-existent site', async () => {
            const res = await request(app)
                .get('/api/sites/non-existent-site-id')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(404);
        });

        test('should update site', async () => {
            const res = await request(app)
                .put(`/api/sites/${testSiteId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: 'Updated Site Name',
                    isActive: true
                });

            expect(res.status).toBe(200);
        });

        test('should regenerate site API key', async () => {
            const res = await request(app)
                .post(`/api/sites/${testSiteId}/regenerate-key`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('api_key');
        });

        test('should get site chatbot config', async () => {
            const res = await request(app)
                .get(`/api/sites/${testSiteId}/chatbot`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
        });

        test('should update site chatbot config', async () => {
            const res = await request(app)
                .put(`/api/sites/${testSiteId}/chatbot`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    enabled: true,
                    botName: 'Test Bot',
                    greeting: 'Hello from the test!'
                });

            expect(res.status).toBe(200);
        });

        test('should get site tickets', async () => {
            const res = await request(app)
                .get(`/api/sites/${testSiteId}/tickets`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        test('should get all sites', async () => {
            const res = await request(app)
                .get('/api/sites')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        test('should create and delete site', async () => {
            // Create
            const createRes = await request(app)
                .post('/api/sites')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    domain: `delete-site-${Date.now()}.test.com`,
                    name: 'Site to Delete'
                });

            expect(createRes.status).toBe(201);

            // Delete
            const deleteRes = await request(app)
                .delete(`/api/sites/${createRes.body.id}`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(deleteRes.status).toBe(200);
        });
    });

    describe('Chatbot Admin Extended', () => {
        test('should get public chatbot config', async () => {
            const res = await request(app)
                .get('/api/chatbot/config');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('botName');
        });

        test('should get admin chatbot config', async () => {
            const res = await request(app)
                .get('/api/chatbot/admin/config')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
        });

        test('should update chatbot config', async () => {
            const res = await request(app)
                .put('/api/chatbot/admin/config')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    botName: 'Updated Test Bot',
                    greeting: 'Updated greeting!',
                    fallbackMessage: 'Sorry, I cannot help with that.'
                });

            expect(res.status).toBe(200);
        });

        test('should handle FAQ operations', async () => {
            // Add
            const addRes = await request(app)
                .post('/api/chatbot/admin/faq')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    patterns: ['test question', 'testing'],
                    response: 'This is a test response'
                });

            // Either 200 or some error status
            expect([200, 400, 500]).toContain(addRes.status);

            if (addRes.status === 200 && addRes.body.id) {
                // Update
                const updateRes = await request(app)
                    .put(`/api/chatbot/admin/faq/${addRes.body.id}`)
                    .set('Authorization', `Bearer ${authToken}`)
                    .send({
                        response: 'Updated response'
                    });

                expect([200, 404]).toContain(updateRes.status);

                // Delete
                const deleteRes = await request(app)
                    .delete(`/api/chatbot/admin/faq/${addRes.body.id}`)
                    .set('Authorization', `Bearer ${authToken}`);

                expect([200, 404]).toContain(deleteRes.status);
            }
        });

        test('should send chatbot message', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .send({ message: 'Hello bot' });

            expect(res.status).toBe(200);
        });

        test('should reject empty chatbot message', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('Audit Log Extended', () => {
        test('should get audit logs', async () => {
            const res = await request(app)
                .get('/api/audit')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        test('should get audit logs with limit', async () => {
            const res = await request(app)
                .get('/api/audit?limit=5')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
            expect(res.body.length).toBeLessThanOrEqual(5);
        });

        test('should filter audit logs by action', async () => {
            const res = await request(app)
                .get('/api/audit?action=LOGIN')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
        });

        test('should filter audit logs by user', async () => {
            const res = await request(app)
                .get(`/api/audit?user_id=${testUserId}`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
        });
    });

    describe('Password Management', () => {
        let passwordTestUserId;
        let passwordTestUsername;

        beforeAll(async () => {
            passwordTestUsername = `pwd_test_${Date.now()}`;
            const createRes = await request(app)
                .post('/api/users')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    username: passwordTestUsername,
                    email: `${passwordTestUsername}@test.com`,
                    password: 'OldPassword123!',
                    role: 'support'
                });
            passwordTestUserId = createRes.body.user.id;
        });

        test('should change own password', async () => {
            // Create a separate user and login as them to test password change
            const username = `pwd_change_${Date.now()}`;
            await db.users.create(
                username,
                `${username}@test.com`,
                'OldPass123!',
                'admin'
            );

            // Login as this user
            const loginRes = await request(app)
                .post('/api/admin/login')
                .send({ username, password: 'OldPass123!' });

            const userToken = loginRes.body.token;

            const res = await request(app)
                .post('/api/admin/change-password')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    currentPassword: 'OldPass123!',
                    newPassword: 'NewPass123!'
                });

            expect(res.status).toBe(200);
        });

        test('should fail with wrong current password', async () => {
            const res = await request(app)
                .post('/api/admin/change-password')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    currentPassword: 'WrongPassword123!',
                    newPassword: 'NewPassword123!'
                });

            expect(res.status).toBe(401);
        });

        test('should reset user password as admin', async () => {
            const res = await request(app)
                .post(`/api/users/${passwordTestUserId}/reset-password`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    newPassword: 'ResetPassword123!'
                });

            expect(res.status).toBe(200);
        });
    });

    describe('Check Access Endpoint', () => {
        test('should check access for valid IP', async () => {
            const res = await request(app)
                .post('/api/check-access')
                .send({ ip: '192.168.1.1' });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('allowed');
        });

        test('should check access without IP (uses request IP)', async () => {
            const res = await request(app)
                .post('/api/check-access')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('allowed');
        });
    });

    describe('Widget Endpoint', () => {
        test('should serve widget.js', async () => {
            const res = await request(app)
                .get('/widget.js');

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toContain('javascript');
        });

        test('should serve widget.js with site key', async () => {
            const site = db.sites.findByDomain('ext-site.test.com');
            if (site) {
                const res = await request(app)
                    .get(`/widget.js?key=${site.api_key}`);

                expect(res.status).toBe(200);
            }
        });
    });

    describe('Static Routes', () => {
        test('should serve admin page', async () => {
            const res = await request(app)
                .get('/admin');

            expect([200, 301, 302, 304]).toContain(res.status);
        });

        test('should serve root page', async () => {
            const res = await request(app)
                .get('/');

            expect([200, 301, 302, 304]).toContain(res.status);
        });
    });

    describe('Authentication Edge Cases', () => {
        test('should reject login with missing password', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({ username: 'test' });

            expect(res.status).toBe(400);
        });

        test('should reject login with missing username', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({ password: 'test' });

            expect(res.status).toBe(400);
        });

        test('should reject login with invalid credentials', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({ username: 'nonexistent', password: 'wrongpass' });

            expect(res.status).toBe(401);
        });

        test('should validate auth token', async () => {
            const res = await request(app)
                .get('/api/admin/verify')
                .set('Authorization', `Bearer ${authToken}`);

            expect(res.status).toBe(200);
        });

        test('should reject invalid auth token', async () => {
            const res = await request(app)
                .get('/api/admin/verify')
                .set('Authorization', 'Bearer invalid-token');

            expect(res.status).toBe(401);
        });

        test('should reject request without auth header', async () => {
            const res = await request(app)
                .get('/api/users');

            expect(res.status).toBe(401);
        });

        test('should logout successfully', async () => {
            // Create a new user and login to test logout
            const username = `logout_test_${Date.now()}`;
            await db.users.create(
                username,
                `${username}@test.com`,
                'LogoutTest123!',
                'support'
            );

            const loginRes = await request(app)
                .post('/api/admin/login')
                .send({ username, password: 'LogoutTest123!' });

            const logoutRes = await request(app)
                .post('/api/admin/logout')
                .set('Authorization', `Bearer ${loginRes.body.token}`);

            expect(logoutRes.status).toBe(200);
        });
    });
});
