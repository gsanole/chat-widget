/**
 * Database Unit Tests
 * Tests for JSON file database operations
 */

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Override database directory before requiring the module
process.env.DATABASE_DIR = path.join(__dirname, 'test-data-db');

// Ensure test directory exists
const TEST_DIR = process.env.DATABASE_DIR;
if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Now require the database module
const db = require('../../src/database');

describe('Database Module', () => {

    // Cleanup after all tests
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

    describe('User Operations', () => {
        let testUserId;
        const testUsername = `testuser_${Date.now()}`;
        const testEmail = `test_${Date.now()}@example.com`;
        const testPassword = 'SecurePassword123!';

        test('should create a new user', async () => {
            const user = await db.users.create(
                testUsername,
                testEmail,
                testPassword,
                'support',
                null,
                null
            );

            expect(user).toBeDefined();
            expect(user.id).toBeDefined();
            expect(user.username).toBe(testUsername);
            expect(user.email).toBe(testEmail);
            expect(user.role).toBe('support');
            expect(user.nickname).toBe(testUsername); // Defaults to username

            testUserId = user.id;
        });

        test('should throw error for duplicate username', async () => {
            await expect(
                db.users.create(testUsername, 'other@email.com', 'password123', 'support')
            ).rejects.toThrow('Username already exists');
        });

        test('should throw error for duplicate email', async () => {
            await expect(
                db.users.create('otherusername', testEmail, 'password123', 'support')
            ).rejects.toThrow('Email already exists');
        });

        test('should find user by ID', () => {
            const user = db.users.findById(testUserId);
            expect(user).toBeDefined();
            expect(user.username).toBe(testUsername);
        });

        test('should find user by username (case insensitive)', () => {
            const user = db.users.findByUsername(testUsername.toUpperCase());
            expect(user).toBeDefined();
            expect(user.id).toBe(testUserId);
        });

        test('should find user by email (case insensitive)', () => {
            const user = db.users.findByEmail(testEmail.toUpperCase());
            expect(user).toBeDefined();
            expect(user.id).toBe(testUserId);
        });

        test('should return all users', () => {
            const users = db.users.findAll();
            expect(Array.isArray(users)).toBe(true);
            expect(users.length).toBeGreaterThan(0);

            const testUser = users.find(u => u.id === testUserId);
            expect(testUser).toBeDefined();
        });

        test('should update user role', () => {
            const result = db.users.updateRole(testUserId, 'admin');
            expect(result).toBeDefined();

            const user = db.users.findById(testUserId);
            expect(user.role).toBe('admin');
        });

        test('should update user active status', () => {
            db.users.updateActive(testUserId, false);
            let user = db.users.findById(testUserId);
            expect(user.is_active).toBe(0);

            db.users.updateActive(testUserId, true);
            user = db.users.findById(testUserId);
            expect(user.is_active).toBe(1);
        });

        test('should update user nickname', () => {
            db.users.updateNickname(testUserId, 'Test Nickname');
            const user = db.users.findById(testUserId);
            expect(user.nickname).toBe('Test Nickname');
        });

        test('should update password', async () => {
            const newPassword = 'NewSecurePassword456!';
            await db.users.updatePassword(testUserId, newPassword);

            const user = db.users.findById(testUserId);
            const isValid = await bcrypt.compare(newPassword, user.password_hash);
            expect(isValid).toBe(true);
        });

        test('should verify password correctly via authenticate', async () => {
            // Create a user with known password
            const authUsername = `authtest_${Date.now()}`;
            const authPassword = 'TestVerify123!';
            await db.users.create(authUsername, `${authUsername}@test.com`, authPassword, 'support');

            // Test successful authentication
            const user = await db.users.authenticate(authUsername, authPassword);
            expect(user).toBeDefined();
            expect(user.username).toBe(authUsername);

            // Test failed authentication
            const failedAuth = await db.users.authenticate(authUsername, 'wrongpassword');
            expect(failedAuth).toBeNull();
        });

        test('should update last login', () => {
            const beforeUpdate = db.users.findById(testUserId).last_login;
            db.users.updateLastLogin(testUserId);
            const afterUpdate = db.users.findById(testUserId).last_login;

            expect(afterUpdate).toBeDefined();
            expect(afterUpdate).not.toBe(beforeUpdate);
        });

        test('should find active users only', () => {
            // Deactivate the test user
            db.users.updateActive(testUserId, false);

            const activeUsers = db.users.findActive();
            const found = activeUsers.find(u => u.id === testUserId);
            expect(found).toBeUndefined();

            // Reactivate
            db.users.updateActive(testUserId, true);
        });
    });

    describe('Ticket Operations', () => {
        let testTicketId;

        test('should create a new ticket', () => {
            testTicketId = `ticket_${Date.now()}`;
            const ticket = db.tickets.create(
                testTicketId,
                'Test Customer',
                '192.168.1.1',
                null,
                null,
                { type: 'email', value: 'customer@test.com' }
            );

            expect(ticket).toBeDefined();
            expect(ticket.id).toBe(testTicketId);
            expect(ticket.customer_name).toBe('Test Customer');
            expect(ticket.status).toBe('open');
            expect(ticket.customer_contact).toEqual({ type: 'email', value: 'customer@test.com' });
        });

        test('should find ticket by ID', () => {
            const ticket = db.tickets.findById(testTicketId);
            expect(ticket).toBeDefined();
            expect(ticket.id).toBe(testTicketId);
        });

        test('should update ticket status', () => {
            db.tickets.updateStatus(testTicketId, 'in_progress');
            const ticket = db.tickets.findById(testTicketId);
            expect(ticket.status).toBe('in_progress');
        });

        test('should resolve ticket (set status to resolved)', () => {
            db.tickets.updateStatus(testTicketId, 'resolved');
            const ticket = db.tickets.findById(testTicketId);
            expect(ticket.status).toBe('resolved');
            expect(ticket.resolved_at).toBeDefined();
        });

        test('should reopen ticket (set status to open)', () => {
            db.tickets.updateStatus(testTicketId, 'open');
            const ticket = db.tickets.findById(testTicketId);
            expect(ticket.status).toBe('open');
        });

        test('should archive ticket (set status to archived)', () => {
            db.tickets.updateStatus(testTicketId, 'archived');
            const ticket = db.tickets.findById(testTicketId);
            expect(ticket.status).toBe('archived');
            expect(ticket.archived_at).toBeDefined();
        });

        test('should find all tickets', () => {
            const tickets = db.tickets.findAll();
            expect(Array.isArray(tickets)).toBe(true);
        });

        test('should count tickets by status', () => {
            const stats = db.tickets.getStats();
            expect(typeof stats.total).toBe('number');
            expect(typeof stats.open).toBe('number');
            expect(typeof stats.resolved).toBe('number');
            expect(typeof stats.archived).toBe('number');
        });
    });

    describe('Message Operations', () => {
        let testTicketId;

        beforeAll(() => {
            testTicketId = `msg_ticket_${Date.now()}`;
            db.tickets.create(testTicketId, 'Message Test Customer', '127.0.0.1', null, null);
        });

        test('should create a customer message', () => {
            const message = db.messages.create(
                testTicketId,
                'customer',
                null,
                'Test Customer',
                'Hello, I need help!'
            );

            expect(message).toBeDefined();
            expect(message.id).toBeDefined();
            expect(message.ticket_id).toBe(testTicketId);
            expect(message.sender_type).toBe('customer');
            expect(message.content).toBe('Hello, I need help!');
        });

        test('should create an admin message', () => {
            const message = db.messages.create(
                testTicketId,
                'admin',
                'admin-id-123',
                'Admin User',
                'How can I assist you?'
            );

            expect(message.sender_type).toBe('admin');
            expect(message.sender_id).toBe('admin-id-123');
        });

        test('should find messages by ticket ID', () => {
            const messages = db.messages.findByTicket(testTicketId);
            expect(Array.isArray(messages)).toBe(true);
            expect(messages.length).toBe(2);
        });

        test('should count messages for ticket', () => {
            const messages = db.messages.findByTicket(testTicketId);
            expect(messages.length).toBe(2);
        });
    });

    describe('Audit Log Operations', () => {
        test('should create audit log entry', () => {
            db.audit.log(
                'user-123',
                'testadmin',
                'USER_LOGIN',
                'user',
                'user-123',
                { method: 'password' },
                '192.168.1.1',
                'Mozilla/5.0'
            );

            const logs = db.audit.findAll(10);
            expect(logs.length).toBeGreaterThan(0);
        });

        test('should find recent audit logs', () => {
            const logs = db.audit.findAll(10);
            expect(Array.isArray(logs)).toBe(true);
            expect(logs.length).toBeLessThanOrEqual(10);
        });

        test('should find audit logs by user', () => {
            const logs = db.audit.findByUser('user-123');
            expect(Array.isArray(logs)).toBe(true);
            expect(logs.length).toBeGreaterThan(0);
        });
    });

    describe('Session Operations', () => {
        const testUserId = 'session-user-123';
        const testToken = 'test-token-abc123';

        test('should create a session', () => {
            const session = db.sessions.create(
                testUserId,
                testToken,
                '192.168.1.1',
                'Mozilla/5.0'
            );

            expect(session).toBeDefined();
            expect(session.user_id).toBe(testUserId);
            expect(session.token).toBe(testToken);
        });

        test('should invalidate session by token', () => {
            db.sessions.deleteByToken(testToken);
            const session = db.sessions.findByToken(testToken);
            expect(session).toBeNull();
        });

        test('should cleanup expired sessions', () => {
            // This should not throw
            expect(() => {
                db.sessions.cleanup();
            }).not.toThrow();
        });
    });

    describe('Chatbot Configuration', () => {
        test('should get chatbot config', () => {
            const config = db.chatbot.getConfig();
            expect(config).toBeDefined();
            expect(typeof config).toBe('object');
        });

        test('should update chatbot config', () => {
            const config = db.chatbot.getConfig();
            const newConfig = {
                ...config,
                botName: 'Test Bot',
                welcomeMessage: 'Hello from tests!'
            };

            db.chatbot.saveConfig(newConfig);
            const updatedConfig = db.chatbot.getConfig();

            expect(updatedConfig.botName).toBe('Test Bot');
            expect(updatedConfig.welcomeMessage).toBe('Hello from tests!');
        });

        test('should get FAQ items', () => {
            const config = db.chatbot.getConfig();
            expect(Array.isArray(config.faq)).toBe(true);
        });

        test('should add FAQ item', () => {
            const faqId = db.chatbot.addFaqItem({
                patterns: ['test question', 'testing'],
                response: 'This is a test answer'
            });

            expect(faqId).toBeDefined();

            const config = db.chatbot.getConfig();
            const faq = config.faq.find(f => f.id === faqId);
            expect(faq).toBeDefined();
            expect(faq.patterns).toContain('test question');
            expect(faq.response).toBe('This is a test answer');
        });

        test('should update FAQ item', () => {
            const config = db.chatbot.getConfig();
            if (config.faq.length > 0) {
                const faqId = config.faq[0].id;
                db.chatbot.updateFaqItem(faqId, {
                    patterns: ['updated pattern'],
                    response: 'Updated response'
                });

                const updatedConfig = db.chatbot.getConfig();
                const updated = updatedConfig.faq.find(f => f.id === faqId);
                expect(updated.patterns).toContain('updated pattern');
            }
        });

        test('should delete FAQ item', () => {
            const config = db.chatbot.getConfig();
            if (config.faq.length > 0) {
                const faqId = config.faq[config.faq.length - 1].id;
                const initialCount = config.faq.length;

                db.chatbot.deleteFaqItem(faqId);

                const afterConfig = db.chatbot.getConfig();
                expect(afterConfig.faq.length).toBe(initialCount - 1);
            }
        });

        test('should find response for message', () => {
            // Add a test FAQ with a unique pattern that does not collide with
            // any seeded FAQ pattern (the seed includes 'hours', 'open', etc.).
            db.chatbot.addFaqItem({
                patterns: ['zzqqfoobarbaz'],
                response: 'We are open 9-5'
            });

            const response = db.chatbot.findResponse('please tell me zzqqfoobarbaz now');
            expect(response).toBeDefined();
            expect(response.type).toBe('faq');
            expect(response.message).toBe('We are open 9-5');
        });

        test('should return fallback for unknown message', () => {
            const response = db.chatbot.findResponse('xyzabc123random');
            expect(response).toBeDefined();
            expect(response.type).toBe('fallback');
        });
    });

    describe('Sites Operations', () => {
        let testSiteId;
        let testSiteApiKey;

        test('should create a new site', () => {
            const site = db.sites.create('Test Site', 'test-site.com', 'A test site');

            expect(site).toBeDefined();
            expect(site.id).toBeDefined();
            expect(site.name).toBe('Test Site');
            expect(site.domain).toBe('test-site.com');
            expect(site.description).toBe('A test site');
            expect(site.api_key).toBeDefined();
            expect(site.is_active).toBe(true);
            expect(site.color_primary).toBe('#2563eb');
            expect(site.color_secondary).toBe('#1e40af');

            testSiteId = site.id;
            testSiteApiKey = site.api_key;
        });

        test('should find site by ID', () => {
            const site = db.sites.findById(testSiteId);
            expect(site).toBeDefined();
            expect(site.name).toBe('Test Site');
        });

        test('should find site by API key', () => {
            const site = db.sites.findByApiKey(testSiteApiKey);
            expect(site).toBeDefined();
            expect(site.id).toBe(testSiteId);
        });

        test('should find site by domain', () => {
            const site = db.sites.findByDomain('test-site.com');
            expect(site).toBeDefined();
            expect(site.id).toBe(testSiteId);
        });

        test('should return all sites', () => {
            const sites = db.sites.findAll();
            expect(Array.isArray(sites)).toBe(true);
            expect(sites.length).toBeGreaterThan(0);
        });

        test('should return active sites only', () => {
            const sites = db.sites.findActive();
            expect(Array.isArray(sites)).toBe(true);
            const found = sites.find(s => s.id === testSiteId);
            expect(found).toBeDefined();
        });

        test('should update site', () => {
            const result = db.sites.update(testSiteId, {
                name: 'Updated Test Site',
                description: 'Updated description',
                color_primary: '#ff0000'
            });

            expect(result).toBeDefined();
            expect(result).not.toBeNull();

            const site = db.sites.findById(testSiteId);
            expect(site.name).toBe('Updated Test Site');
            expect(site.description).toBe('Updated description');
            expect(site.color_primary).toBe('#ff0000');
        });

        test('should not allow updating api_key through update method', () => {
            const originalSite = db.sites.findById(testSiteId);
            const originalKey = originalSite.api_key;

            db.sites.update(testSiteId, { api_key: 'hacked-key' });

            const site = db.sites.findById(testSiteId);
            expect(site.api_key).toBe(originalKey);
        });

        test('should regenerate API key', () => {
            const originalSite = db.sites.findById(testSiteId);
            const originalKey = originalSite.api_key;

            const newKey = db.sites.regenerateApiKey(testSiteId);

            expect(newKey).toBeDefined();
            expect(newKey).not.toBe(originalKey);

            const site = db.sites.findById(testSiteId);
            expect(site.api_key).toBe(newKey);

            testSiteApiKey = newKey;
        });

        test('should update chatbot config for site', () => {
            const config = { welcomeMessage: 'Custom welcome!', botName: 'Site Bot' };
            const result = db.sites.updateChatbotConfig(testSiteId, config);

            expect(result).toBeDefined();
            expect(result).not.toBeNull();

            const site = db.sites.findById(testSiteId);
            expect(site.chatbot_config).toEqual(config);
        });

        test('should get site stats', () => {
            const stats = db.sites.getStats(testSiteId);

            expect(stats).toBeDefined();
            expect(typeof stats.total_tickets).toBe('number');
            expect(typeof stats.open_tickets).toBe('number');
            expect(typeof stats.resolved_tickets).toBe('number');
        });

        test('should create ticket with site_id', () => {
            const ticketId = `site_ticket_${Date.now()}`;
            const ticket = db.tickets.create(
                ticketId,
                'Site Customer',
                '192.168.1.1',
                null,
                null,
                null,
                null,
                testSiteId
            );

            expect(ticket).toBeDefined();
            expect(ticket.site_id).toBe(testSiteId);

            // Verify stats updated
            const stats = db.sites.getStats(testSiteId);
            expect(stats.total_tickets).toBeGreaterThan(0);
        });

        test('should find tickets by site', () => {
            const tickets = db.tickets.findBySite(testSiteId);
            expect(Array.isArray(tickets)).toBe(true);
            expect(tickets.length).toBeGreaterThan(0);
            expect(tickets[0].site_id).toBe(testSiteId);
        });

        test('should find tickets by site and status', () => {
            const openTickets = db.tickets.findBySiteAndStatus(testSiteId, 'open');
            expect(Array.isArray(openTickets)).toBe(true);
        });

        test('should not find inactive site by API key', () => {
            // Deactivate site
            db.sites.update(testSiteId, { is_active: false });

            const site = db.sites.findByApiKey(testSiteApiKey);
            expect(site).toBeUndefined();

            // Reactivate
            db.sites.update(testSiteId, { is_active: true });
        });

        test('should delete site', () => {
            // Create a site to delete
            const siteToDelete = db.sites.create('Delete Me', 'delete.me', '');

            const result = db.sites.delete(siteToDelete.id);
            expect(result).toBe(true);

            const site = db.sites.findById(siteToDelete.id);
            expect(site).toBeUndefined();
        });
    });

    describe('Additional Ticket Operations', () => {
        let testTicketId;

        beforeAll(() => {
            testTicketId = `extra_ticket_${Date.now()}`;
            db.tickets.create(testTicketId, 'Extra Customer', '10.0.0.1', null, null);
        });

        test('should find tickets by status', () => {
            const openTickets = db.tickets.findByStatus('open');
            expect(Array.isArray(openTickets)).toBe(true);
        });

        test('should find open tickets', () => {
            const tickets = db.tickets.findOpen();
            expect(Array.isArray(tickets)).toBe(true);
        });

        test('should assign ticket to admin', () => {
            const result = db.tickets.updateAssignee(testTicketId, 'admin-123');
            expect(result).toBeDefined();
            expect(result).not.toBeNull();

            const ticket = db.tickets.findById(testTicketId);
            expect(ticket.assigned_to).toBe('admin-123');
        });

        test('should find tickets by assignee', () => {
            const tickets = db.tickets.findByAssignee('admin-123');
            expect(Array.isArray(tickets)).toBe(true);
            expect(tickets.length).toBeGreaterThan(0);
        });

        test('should update ticket priority', () => {
            const result = db.tickets.updatePriority(testTicketId, 'high');
            expect(result).toBeDefined();
            expect(result).not.toBeNull();

            const ticket = db.tickets.findById(testTicketId);
            expect(ticket.priority).toBe('high');
        });

        test('should update ticket notes', () => {
            const result = db.tickets.updateNotes(testTicketId, 'Some important notes');
            expect(result).toBeDefined();
            expect(result).not.toBeNull();

            const ticket = db.tickets.findById(testTicketId);
            expect(ticket.notes).toBe('Some important notes');
        });

        test('should update ticket tags', () => {
            const result = db.tickets.updateTags(testTicketId, ['urgent', 'bug']);
            expect(result).toBeDefined();
            expect(result).not.toBeNull();

            const ticket = db.tickets.findById(testTicketId);
            expect(ticket.tags).toEqual(['urgent', 'bug']);
        });

        test('should update last message time', () => {
            const before = db.tickets.findById(testTicketId).last_message_at;
            db.tickets.updateLastMessage(testTicketId);
            const after = db.tickets.findById(testTicketId).last_message_at;

            expect(after).toBeGreaterThanOrEqual(before || 0);
        });

        test('should set pending status', () => {
            db.tickets.updateStatus(testTicketId, 'pending');
            const ticket = db.tickets.findById(testTicketId);
            expect(ticket.status).toBe('pending');
        });

        test('should set on_hold status', () => {
            db.tickets.updateStatus(testTicketId, 'on_hold');
            const ticket = db.tickets.findById(testTicketId);
            expect(ticket.status).toBe('on_hold');
        });

        test('should delete ticket', () => {
            const ticketToDelete = `delete_ticket_${Date.now()}`;
            db.tickets.create(ticketToDelete, 'Delete Customer', '127.0.0.1', null, null);

            const result = db.tickets.delete(ticketToDelete);
            expect(result).toBe(true);

            const ticket = db.tickets.findById(ticketToDelete);
            expect(ticket).toBeUndefined();
        });
    });

    describe('Additional User Operations', () => {
        let testUserId;

        beforeAll(async () => {
            const user = await db.users.create(
                `extra_user_${Date.now()}`,
                `extra_${Date.now()}@test.com`,
                'ExtraPass123!',
                'support'
            );
            testUserId = user.id;
        });

        test('should delete user', () => {
            const result = db.users.delete(testUserId);
            expect(result).toBe(true);

            const user = db.users.findById(testUserId);
            expect(user).toBeUndefined();
        });
    });

    describe('2FA Operations', () => {
        let test2FAUserId;

        beforeAll(async () => {
            const user = await db.users.create(
                `totp_user_${Date.now()}`,
                `totp_${Date.now()}@test.com`,
                'TotpPass123!',
                'admin'
            );
            test2FAUserId = user.id;
        });

        test('should set TOTP secret', () => {
            db.users.setTotpSecret(test2FAUserId, 'TEST_SECRET_123');
            const user = db.users.findById(test2FAUserId);
            expect(user.totp_secret).toBe('TEST_SECRET_123');
        });

        test('should enable TOTP', () => {
            db.users.enableTotp(test2FAUserId, ['code1', 'code2']);
            const user = db.users.findById(test2FAUserId);
            expect(user.totp_enabled).toBe(1);
        });

        test('should disable TOTP', () => {
            db.users.disableTotp(test2FAUserId);
            const user = db.users.findById(test2FAUserId);
            expect(user.totp_enabled).toBe(0);
            expect(user.totp_secret).toBeNull();
        });
    });

    describe('Additional Session Operations', () => {
        let sessionTestUserId;

        beforeAll(async () => {
            // Create a user to associate with sessions
            const user = await db.users.create(
                `session_test_user_${Date.now()}`,
                `session_test_${Date.now()}@test.com`,
                'SessionTest123!',
                'support'
            );
            sessionTestUserId = user.id;
        });

        test('should find session by token', () => {
            const token = `find_token_${Date.now()}`;
            db.sessions.create(sessionTestUserId, token, '127.0.0.1', 'Test UA');

            const session = db.sessions.findByToken(token);
            expect(session).toBeDefined();
            expect(session.user_id).toBe(sessionTestUserId);
        });

        test('should update session activity', () => {
            const token = `activity_token_${Date.now()}`;
            db.sessions.create(sessionTestUserId, token, '127.0.0.1', 'Test UA');

            const result = db.sessions.updateActivity(token);
            expect(result).toBeDefined();
        });

        test('should delete sessions by user ID', () => {
            // Create user-specific sessions
            const token1 = `user_token1_${Date.now()}`;
            const token2 = `user_token2_${Date.now()}`;
            db.sessions.create(sessionTestUserId, token1, '127.0.0.1', 'UA1');
            db.sessions.create(sessionTestUserId, token2, '127.0.0.1', 'UA2');

            db.sessions.deleteByUser(sessionTestUserId);

            const session1 = db.sessions.findByToken(token1);
            const session2 = db.sessions.findByToken(token2);
            expect(session1).toBeNull();
            expect(session2).toBeNull();
        });

        test('should find sessions by user', () => {
            // Create fresh user for this test
            const token = `find_user_token_${Date.now()}`;
            db.sessions.create(sessionTestUserId, token, '127.0.0.1', 'Test UA');

            const sessions = db.sessions.findByUser(sessionTestUserId);
            expect(Array.isArray(sessions)).toBe(true);
        });
    });

    describe('Audit Log Additional Operations', () => {
        test('should find audit logs by action type', () => {
            // Create some audit logs
            db.audit.log('user1', 'admin1', 'TEST_ACTION', 'test', 'target1', {}, '127.0.0.1', 'UA');
            db.audit.log('user2', 'admin2', 'TEST_ACTION', 'test', 'target2', {}, '127.0.0.1', 'UA');

            const logs = db.audit.findByAction('TEST_ACTION');
            expect(Array.isArray(logs)).toBe(true);
            expect(logs.length).toBeGreaterThanOrEqual(2);
        });
    });
});
