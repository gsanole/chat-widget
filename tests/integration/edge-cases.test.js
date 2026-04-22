/**
 * Edge Case Coverage Tests
 * Targeting remaining uncovered paths in server.js and database.js
 */

const request = require('supertest');
const { app, server, db } = require('../../server');

describe('Edge Case Coverage Tests', () => {
    let adminToken;
    let adminUser;
    const uniquePrefix = `edge_${Date.now()}_`;

    beforeAll(async () => {
        await new Promise(resolve => {
            if (server.listening) {
                resolve();
            } else {
                server.listen(0, resolve);
            }
        });

        // Create admin user
        const username = `${uniquePrefix}admin`;
        try {
            const result = await db.users.create(username, `${username}@test.com`, 'password123', 'super_admin', 'Edge Admin', null);
            adminUser = db.users.findById(result.id);
        } catch (e) {
            adminUser = db.users.findByUsername(username);
        }

        // Get token
        const loginRes = await request(app)
            .post('/api/admin/login')
            .send({ username: adminUser.username, password: 'password123' });
        adminToken = loginRes.body.token;
    });

    afterAll(async () => {
        try {
            if (adminUser) db.users.delete(adminUser.id);
        } catch (e) { }

        await new Promise(resolve => setTimeout(resolve, 100));
        server.close();
    });

    // =========================================
    // PASSWORD CHANGE
    // =========================================
    describe('Password Change', () => {
        it('should require current and new password', async () => {
            const res = await request(app)
                .post('/api/admin/change-password')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ currentPassword: '' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('required');
        });

        it('should require password at least 8 characters', async () => {
            const res = await request(app)
                .post('/api/admin/change-password')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ currentPassword: 'password123', newPassword: 'short' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('8 characters');
        });

        it('should reject incorrect current password', async () => {
            const res = await request(app)
                .post('/api/admin/change-password')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ currentPassword: 'wrongpassword', newPassword: 'newpassword123' });

            expect(res.status).toBe(401);
            expect(res.body.error).toContain('incorrect');
        });

        it('should change password successfully', async () => {
            const res = await request(app)
                .post('/api/admin/change-password')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ currentPassword: 'password123', newPassword: 'password456' });

            expect(res.status).toBe(200);

            // Change back
            await request(app)
                .post('/api/admin/change-password')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ currentPassword: 'password456', newPassword: 'password123' });
        });
    });

    // =========================================
    // CHATBOT FAQ MANAGEMENT
    // =========================================
    describe('Chatbot FAQ', () => {
        let faqId;

        it('should require patterns and response for FAQ', async () => {
            const res = await request(app)
                .post('/api/chatbot/admin/faq')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ patterns: ['test'] });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('required');
        });

        it('should add FAQ item', async () => {
            const res = await request(app)
                .post('/api/chatbot/admin/faq')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    patterns: ['test pattern', 'edge case'],
                    response: 'Test response for edge case'
                });

            expect(res.status).toBe(200);
            expect(res.body.id).toBeDefined();
            faqId = res.body.id;
        });

        it('should update FAQ item', async () => {
            if (!faqId) return;

            const res = await request(app)
                .put(`/api/chatbot/admin/faq/${faqId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    patterns: ['updated pattern'],
                    response: 'Updated response'
                });

            expect(res.status).toBe(200);
        });

        it('should delete FAQ item', async () => {
            if (!faqId) return;

            const res = await request(app)
                .delete(`/api/chatbot/admin/faq/${faqId}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
        });
    });

    // =========================================
    // CHATBOT CONFIG
    // =========================================
    describe('Chatbot Config', () => {
        it('should get chatbot config', async () => {
            const res = await request(app)
                .get('/api/chatbot/admin/config')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
        });

        it('should update chatbot config', async () => {
            const res = await request(app)
                .put('/api/chatbot/admin/config')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    enabled: true,
                    greeting: 'Test greeting',
                    fallbackMessage: 'Test fallback'
                });

            expect(res.status).toBe(200);
        });
    });

    // =========================================
    // AUDIT LOG QUERIES
    // =========================================
    describe('Audit Log', () => {
        it('should get all audit logs', async () => {
            const res = await request(app)
                .get('/api/audit')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('should get audit logs by user', async () => {
            const res = await request(app)
                .get(`/api/audit?userId=${adminUser.id}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
        });

        it('should get audit logs by action', async () => {
            const res = await request(app)
                .get('/api/audit?action=LOGIN_SUCCESS')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
        });
    });

    // =========================================
    // USER MANAGEMENT EDGE CASES
    // =========================================
    describe('User Management Edge Cases', () => {
        let testUser;

        beforeAll(async () => {
            const username = `${uniquePrefix}testuser`;
            try {
                const result = await db.users.create(username, `${username}@test.com`, 'password123', 'admin', 'Test User', adminUser.id);
                testUser = db.users.findById(result.id);
            } catch (e) {
                testUser = db.users.findByUsername(username);
            }
        });

        afterAll(() => {
            if (testUser) db.users.delete(testUser.id);
        });

        it('should update user with nickname', async () => {
            const res = await request(app)
                .put(`/api/users/${testUser.id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ nickname: 'Updated Nickname' });

            expect(res.status).toBe(200);
        });

        it('should update user password', async () => {
            const res = await request(app)
                .put(`/api/users/${testUser.id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ password: 'newpassword123' });

            expect(res.status).toBe(200);
        });

        it('should not allow deleting yourself', async () => {
            const res = await request(app)
                .delete(`/api/users/${adminUser.id}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('yourself');
        });

        it('should update user active status', async () => {
            const res = await request(app)
                .put(`/api/users/${testUser.id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ isActive: false });

            expect(res.status).toBe(200);

            // Re-activate
            await request(app)
                .put(`/api/users/${testUser.id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ isActive: true });
        });
    });

    // =========================================
    // SITE MANAGEMENT EDGE CASES
    // =========================================
    describe('Site Management Edge Cases', () => {
        let testSite;

        beforeAll(() => {
            testSite = db.sites.create({
                name: `${uniquePrefix}EdgeSite`,
                domain: `edge-${Date.now()}.example.com`
            });
        });

        afterAll(() => {
            const siteId = typeof testSite === 'object' ? testSite.id : testSite;
            if (siteId) db.sites.delete(siteId);
        });

        it('should update site with chatbot config', async () => {
            const siteId = typeof testSite === 'object' ? testSite.id : testSite;

            const res = await request(app)
                .put(`/api/sites/${siteId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    chatbot_config: {
                        greeting: 'Site-specific greeting',
                        enabled: true
                    }
                });

            expect(res.status).toBe(200);
        });

        it('should update site use_global_chatbot setting', async () => {
            const siteId = typeof testSite === 'object' ? testSite.id : testSite;

            const res = await request(app)
                .put(`/api/sites/${siteId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ use_global_chatbot: false });

            expect(res.status).toBe(200);
        });

        it('should regenerate site API key', async () => {
            const siteId = typeof testSite === 'object' ? testSite.id : testSite;

            const res = await request(app)
                .post(`/api/sites/${siteId}/regenerate-key`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.api_key).toBeDefined();
        });
    });

    // =========================================
    // DATABASE AUDIT OPERATIONS
    // =========================================
    describe('Database Audit Operations', () => {
        it('should find audit by resource', () => {
            const logs = db.audit.findByResource('user', adminUser.id);
            expect(Array.isArray(logs)).toBe(true);
        });

        it('should find recent audit logs', () => {
            const logs = db.audit.findAll(10);
            expect(Array.isArray(logs)).toBe(true);
            expect(logs.length).toBeLessThanOrEqual(10);
        });
    });

    // =========================================
    // DATABASE TICKET OPERATIONS
    // =========================================
    describe('Database Ticket Operations', () => {
        let ticketId;

        beforeAll(() => {
            // Create ticket using correct signature: (id, customerName, customerIp, customerLocation, ipAnalysis, contact, createdBy, siteId)
            ticketId = `edge-session-${Date.now()}`;
            db.tickets.create(ticketId, 'Edge Customer', '127.0.0.1', 'Test Location', null, 'edge@test.com', null, null);
        });

        afterAll(() => {
            if (ticketId) db.tickets.delete(ticketId);
        });

        it('should find tickets by status', () => {
            const tickets = db.tickets.findByStatus('open');
            expect(Array.isArray(tickets)).toBe(true);
        });

        it('should update ticket status', () => {
            db.tickets.updateStatus(ticketId, 'resolved');
            const ticket = db.tickets.findById(ticketId);
            expect(ticket.status).toBe('resolved');
        });

        it('should update ticket assignee', () => {
            db.tickets.updateAssignee(ticketId, adminUser.id);
            const ticket = db.tickets.findById(ticketId);
            expect(ticket.assigned_to).toBe(adminUser.id);
        });

        it('should update ticket notes', () => {
            db.tickets.updateNotes(ticketId, 'Test note');
            const ticket = db.tickets.findById(ticketId);
            expect(ticket.notes).toContain('Test note');
        });
    });

    // =========================================
    // DATABASE MESSAGE OPERATIONS
    // =========================================
    describe('Database Message Operations', () => {
        let ticketId;

        beforeAll(() => {
            ticketId = `msg-test-${Date.now()}`;
            // Use correct signature: (id, customerName, customerIp, customerLocation, ipAnalysis, contact, createdBy, siteId)
            db.tickets.create(ticketId, 'Message Customer', '127.0.0.1', 'Test Location', null, 'msg@test.com', null, null);
        });

        afterAll(() => {
            db.tickets.delete(ticketId);
        });

        it('should create message', () => {
            const msgId = db.messages.create(ticketId, 'customer', null, 'Test Customer', 'Hello');
            expect(msgId).toBeDefined();
        });

        it('should find messages by ticket', () => {
            const messages = db.messages.findByTicket(ticketId);
            expect(Array.isArray(messages)).toBe(true);
        });

        it('should find recent messages', () => {
            const messages = db.messages.findRecent(ticketId, 5);
            expect(Array.isArray(messages)).toBe(true);
        });
    });

    // =========================================
    // DATABASE STATS
    // =========================================
    describe('Database Stats', () => {
        it('should get ticket stats', () => {
            const stats = db.tickets.getStats();
            expect(stats).toBeDefined();
            expect(typeof stats.total).toBe('number');
        });

        it('should get users list', () => {
            const users = db.users.findAll();
            expect(Array.isArray(users)).toBe(true);
        });
    });
});
