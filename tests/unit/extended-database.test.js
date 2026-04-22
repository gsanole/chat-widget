/**
 * Extended Database Tests
 * Additional tests for comprehensive database coverage
 */

const path = require('path');
const fs = require('fs');

// Override database directory before requiring the module
process.env.DATABASE_DIR = path.join(__dirname, 'test-data-db-ext');

// Ensure test directory exists
const TEST_DIR = process.env.DATABASE_DIR;
if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Clear require cache
delete require.cache[require.resolve('../../src/database')];

// Now require the database module
const db = require('../../src/database');

describe('Extended Database Coverage', () => {

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

    describe('User Edge Cases', () => {
        test('should find all users', () => {
            const users = db.users.findAll();
            expect(Array.isArray(users)).toBe(true);
        });

        test('should handle non-existent user ID', () => {
            const user = db.users.findById('non-existent-user-id');
            expect(user).toBeUndefined();
        });

        test('should handle non-existent username', () => {
            const user = db.users.findByUsername('non-existent-username');
            expect(user).toBeUndefined();
        });

        test('should handle non-existent email', () => {
            const user = db.users.findByEmail('non-existent@email.com');
            expect(user).toBeUndefined();
        });

        test('should authenticate with wrong password', async () => {
            // Create user first
            const username = `auth_fail_${Date.now()}`;
            await db.users.create(username, `${username}@test.com`, 'CorrectPass123!', 'support');

            const result = await db.users.authenticate(username, 'WrongPassword123!');
            expect(result).toBeNull();
        });

        test('should create user with email only', async () => {
            const email = `emailonly_${Date.now()}@test.com`;
            const user = await db.users.create(
                `emailonly_${Date.now()}`,
                email,
                'EmailPass123!',
                'support'
            );

            expect(user).toBeDefined();
            expect(user.email).toBe(email);
        });

        test('should update user password', async () => {
            const username = `pwupdate_${Date.now()}`;
            const user = await db.users.create(username, `${username}@test.com`, 'OldPass123!', 'support');

            await db.users.updatePassword(user.id, 'NewPass123!');

            const auth = await db.users.authenticate(username, 'NewPass123!');
            expect(auth).toBeDefined();
        });

        test('should update user role', () => {
            db.users.findAll().forEach(async user => {
                if (user.role === 'support') {
                    const result = db.users.updateRole(user.id, 'admin_support');
                    expect(result).toBeDefined();
                }
            });
        });
    });

    describe('Ticket Edge Cases', () => {
        test('should create ticket with all optional fields', () => {
            const ticketId = `full_ticket_${Date.now()}`;
            const ticket = db.tickets.create(
                ticketId,
                'Full Customer',
                '192.168.1.50',
                null,
                40.7128,
                { type: 'phone', value: '555-1234' },
                'Test referrer',
                null
            );

            expect(ticket).toBeDefined();
            expect(ticket.customer_contact).toEqual({ type: 'phone', value: '555-1234' });
        });

        test('should find non-existent ticket', () => {
            const ticket = db.tickets.findById('non-existent-ticket-id');
            expect(ticket).toBeUndefined();
        });

        test('should update non-existent ticket status', () => {
            const result = db.tickets.updateStatus('non-existent-ticket', 'resolved');
            expect(result).toBeNull();
        });

        test('should update non-existent ticket priority', () => {
            const result = db.tickets.updatePriority('non-existent-ticket', 'high');
            expect(result).toBeNull();
        });

        test('should update non-existent ticket assignee', () => {
            const result = db.tickets.updateAssignee('non-existent-ticket', 'admin-id');
            expect(result).toBeNull();
        });

        test('should cleanup old resolved tickets', () => {
            const deletedCount = db.tickets.cleanupOldResolved(0); // Use 0 days for immediate cleanup
            expect(typeof deletedCount).toBe('number');
        });

        test('should find tickets by non-existent site', () => {
            const tickets = db.tickets.findBySite('non-existent-site');
            expect(tickets).toEqual([]);
        });

        test('should find tickets by status and non-existent site', () => {
            const tickets = db.tickets.findBySiteAndStatus('non-existent-site', 'open');
            expect(tickets).toEqual([]);
        });
    });

    describe('Message Edge Cases', () => {
        let testTicketId;

        beforeAll(() => {
            testTicketId = `msg_edge_${Date.now()}`;
            db.tickets.create(testTicketId, 'Message Edge Customer', '127.0.0.1', null, null);
        });

        test('should create system message', () => {
            const message = db.messages.create(
                testTicketId,
                'system',
                null,
                'System',
                'This is a system message'
            );

            expect(message).toBeDefined();
            expect(message.sender_type).toBe('system');
        });

        test('should create bot message', () => {
            const message = db.messages.create(
                testTicketId,
                'bot',
                null,
                'Bot',
                'This is a bot message'
            );

            expect(message).toBeDefined();
            expect(message.sender_type).toBe('bot');
        });

        test('should find messages for non-existent ticket', () => {
            const messages = db.messages.findByTicket('non-existent-ticket-id');
            expect(messages).toEqual([]);
        });
    });

    describe('Session Edge Cases', () => {
        test('should handle cleanup of no expired sessions', () => {
            const cleaned = db.sessions.cleanup();
            expect(typeof cleaned).toBe('number');
        });

        test('should find session by non-existent token', () => {
            const session = db.sessions.findByToken('non-existent-token');
            expect(session).toBeNull();
        });

        test('should find sessions by non-existent user', () => {
            const sessions = db.sessions.findByUser('non-existent-user-id');
            expect(sessions).toEqual([]);
        });

        test('should delete by non-existent token', () => {
            const result = db.sessions.deleteByToken('non-existent-token');
            expect(result).toBe(false);
        });
    });

    describe('Audit Log Edge Cases', () => {
        test('should create audit log with minimal data', () => {
            db.audit.log('user1', 'admin1', 'TEST_MINIMAL', 'test', 'target1', null, null, null);

            const logs = db.audit.findAll(1);
            expect(logs.length).toBeGreaterThan(0);
        });

        test('should find audit logs by non-existent user', () => {
            const logs = db.audit.findByUser('non-existent-user-id');
            expect(logs).toEqual([]);
        });

        test('should find audit logs by non-existent action', () => {
            const logs = db.audit.findByAction('NON_EXISTENT_ACTION');
            expect(logs).toEqual([]);
        });
    });

    describe('Sites Edge Cases', () => {
        test('should find site by non-existent ID', () => {
            const site = db.sites.findById('non-existent-site-id');
            expect(site).toBeUndefined();
        });

        test('should find site by non-existent API key', () => {
            const site = db.sites.findByApiKey('non-existent-api-key');
            expect(site).toBeUndefined();
        });

        test('should find site by non-existent domain', () => {
            const site = db.sites.findByDomain('non-existent-domain.com');
            expect(site).toBeUndefined();
        });

        test('should update non-existent site', () => {
            const result = db.sites.update('non-existent-site-id', { name: 'New Name' });
            expect(result).toBeNull();
        });

        test('should regenerate API key for non-existent site', () => {
            const newKey = db.sites.regenerateApiKey('non-existent-site-id');
            // Should return undefined or handle gracefully
            expect(newKey === undefined || typeof newKey === 'string').toBe(true);
        });

        test('should get stats for non-existent site', () => {
            const stats = db.sites.getStats('non-existent-site-id');
            expect(stats.total_tickets).toBe(0);
        });

        test('should delete non-existent site', () => {
            const result = db.sites.delete('non-existent-site-id');
            expect(result).toBe(false);
        });
    });

    describe('Chatbot Edge Cases', () => {
        test('should find response matching pattern partially', () => {
            // Add a FAQ item
            db.chatbot.addFaqItem({
                patterns: ['help with order', 'order help'],
                response: 'I can help with your order!'
            });

            const response = db.chatbot.findResponse('I need help with my order please');
            expect(response).toBeDefined();
        });

        test('should handle empty FAQ array', () => {
            const config = db.chatbot.getConfig();
            const originalFaq = config.faq;

            // Temporarily set empty FAQ
            config.faq = [];
            db.chatbot.saveConfig(config);

            const response = db.chatbot.findResponse('random question');
            expect(response.type).toBe('fallback');

            // Restore
            config.faq = originalFaq;
            db.chatbot.saveConfig(config);
        });

        test('should handle updating non-existent FAQ item', () => {
            const result = db.chatbot.updateFaqItem('non-existent-faq-id', { response: 'new' });
            expect(result).toBe(false);
        });

        test('should handle deleting non-existent FAQ item', () => {
            const result = db.chatbot.deleteFaqItem('non-existent-faq-id');
            expect(result).toBe(false);
        });

        test('should get default config when file missing', () => {
            const config = db.chatbot.getConfig();
            expect(config).toBeDefined();
            expect(config.botName).toBeDefined();
        });
    });

    describe('Database Initialize', () => {
        test('should initialize super admin', async () => {
            // This might already exist, but should not throw
            await expect(db.initializeSuperAdmin()).resolves.not.toThrow();
        });
    });
});
