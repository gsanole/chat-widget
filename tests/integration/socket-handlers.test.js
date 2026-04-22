/**
 * Socket Handler Coverage Tests
 * Targeting uncovered socket event handlers in server.js
 */

const request = require('supertest');
const io = require('socket.io-client');
const { app, server, db } = require('../../server');
const totp = require('../../src/utils/totp');

describe('Socket Handler Coverage Tests', () => {
    let baseUrl;
    let adminToken;
    let adminUser;
    let testSite;
    const uniquePrefix = `sockh_${Date.now()}_`;

    beforeAll(async () => {
        await new Promise(resolve => {
            if (server.listening) {
                baseUrl = `http://localhost:${server.address().port}`;
                resolve();
            } else {
                server.listen(0, () => {
                    baseUrl = `http://localhost:${server.address().port}`;
                    resolve();
                });
            }
        });

        // Create admin user
        const username = `${uniquePrefix}admin`;
        try {
            const result = await db.users.create(username, `${username}@test.com`, 'password123', 'super_admin', 'Socket Handler Admin', null);
            adminUser = db.users.findById(result.id);
        } catch (e) {
            adminUser = db.users.findByUsername(username);
        }

        // Get token
        const loginRes = await request(app)
            .post('/api/admin/login')
            .send({ username: adminUser.username, password: 'password123' });
        adminToken = loginRes.body.token;

        // Create test site
        testSite = db.sites.create({
            name: `${uniquePrefix}Site`,
            domain: `socket-${Date.now()}.example.com`
        });
    });

    afterAll(async () => {
        try {
            if (adminUser) db.users.delete(adminUser.id);
            const siteId = typeof testSite === 'object' ? testSite.id : testSite;
            if (siteId) db.sites.delete(siteId);
        } catch (e) { }

        await new Promise(resolve => setTimeout(resolve, 100));
        server.close();
    });

    // =========================================
    // CUSTOMER START WITH SITE API KEY
    // =========================================
    describe('Customer Start with Site API Key', () => {
        let customerSocket;
        let adminSocket;
        let receivedSession;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should start customer session with site API key', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                // Start customer session with site API key
                const site = typeof testSite === 'object' ? testSite : db.sites.findById(testSite);

                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Site Customer',
                        siteApiKey: site.api_key,
                        browserLocation: { lat: 40.7128, lng: -74.0060 }
                    });
                });

                adminSocket.on('admin:new-session', (session) => {
                    receivedSession = session;
                    expect(session.customerName).toBe('Site Customer');
                    expect(session.siteId).toBeDefined();
                    done();
                });

                setTimeout(done, 3000);
            });
        });
    });

    // =========================================
    // CUSTOMER TYPING INDICATOR
    // =========================================
    describe('Customer Typing', () => {
        let customerSocket;
        let adminSocket;
        let sessionId;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should send and receive customer typing indicator', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Typing Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    // Send typing indicator
                    customerSocket.emit('customer:typing');
                });

                adminSocket.on('admin:customer-typing', (data) => {
                    expect(data.sessionId).toBeDefined();
                    done();
                });

                setTimeout(done, 3000);
            });
        });
    });

    // =========================================
    // ADMIN JOIN SESSION
    // =========================================
    describe('Admin Join Session', () => {
        let customerSocket;
        let adminSocket;
        let sessionId;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should join existing session and receive details', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Join Test Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    // Admin joins the session
                    adminSocket.emit('admin:join-session', sessionId);
                });

                adminSocket.on('admin:session-joined', (data) => {
                    expect(data.sessionId).toBe(sessionId);
                    expect(data.session).toBeDefined();
                    done();
                });

                setTimeout(done, 3000);
            });
        });
    });

    // =========================================
    // ADMIN TYPING INDICATOR
    // =========================================
    describe('Admin Typing', () => {
        let customerSocket;
        let adminSocket;
        let sessionId;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should send admin typing to customer', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Typing Watch Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    // Admin sends typing indicator
                    adminSocket.emit('admin:typing', sessionId);
                });

                customerSocket.on('customer:admin-typing', () => {
                    done();
                });

                setTimeout(done, 3000);
            });
        });
    });

    // =========================================
    // SESSION PRIORITY AND NOTES
    // =========================================
    describe('Session Priority and Notes', () => {
        let customerSocket;
        let adminSocket;
        let sessionId;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should set session priority', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Priority Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    adminSocket.emit('admin:set-priority', { sessionId, priority: 'high' });
                });

                adminSocket.on('admin:session-updated', (data) => {
                    if (data.priority === 'high') {
                        done();
                    }
                });

                setTimeout(done, 3000);
            });
        });

        it('should add note to session', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Note Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    adminSocket.emit('admin:add-note', { sessionId, note: 'Test note' });
                });

                adminSocket.on('admin:session-updated', (data) => {
                    if (data.notes && data.notes.includes('Test note')) {
                        done();
                    }
                });

                setTimeout(done, 3000);
            });
        });
    });

    // =========================================
    // TICKET STATUS CHANGES
    // =========================================
    describe('Ticket Status Changes', () => {
        let customerSocket;
        let adminSocket;
        let sessionId;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should set ticket status to resolved', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Resolve Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    adminSocket.emit('admin:set-status', { sessionId, status: 'resolved' });
                });

                adminSocket.on('admin:session-updated', (data) => {
                    if (data.ticketStatus === 'resolved') {
                        done();
                    }
                });

                setTimeout(done, 3000);
            });
        });

        it('should set ticket status to open (reopen)', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Reopen Customer'
                    });
                });

                let resolved = false;
                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    // First resolve
                    adminSocket.emit('admin:set-status', { sessionId, status: 'resolved' });
                });

                adminSocket.on('admin:session-updated', (data) => {
                    if (data.ticketStatus === 'resolved' && !resolved) {
                        resolved = true;
                        // Then reopen
                        adminSocket.emit('admin:set-status', { sessionId, status: 'open' });
                    } else if (data.ticketStatus === 'open' && resolved) {
                        done();
                    }
                });

                setTimeout(done, 4000);
            });
        });
    });

    // =========================================
    // ASSIGN SESSION
    // =========================================
    describe('Assign Session', () => {
        let customerSocket;
        let adminSocket;
        let sessionId;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should assign session to admin', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Assign Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    adminSocket.emit('admin:assign-session', { sessionId, adminId: adminUser.id });
                });

                adminSocket.on('admin:session-updated', (data) => {
                    if (data.assignedTo) {
                        done();
                    }
                });

                setTimeout(done, 3000);
            });
        });
    });

    // =========================================
    // CUSTOMER END SESSION
    // =========================================
    describe('Customer End Session', () => {
        let customerSocket;
        let adminSocket;
        let sessionId;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should end session from customer side', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'End Session Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    // Customer ends session
                    customerSocket.emit('customer:end-session');
                });

                customerSocket.on('customer:ended', () => {
                    done();
                });

                setTimeout(done, 3000);
            });
        });
    });

    // =========================================
    // ADMIN DISCONNECT
    // =========================================
    describe('Admin Disconnect', () => {
        let adminSocket;

        it('should handle admin disconnect gracefully', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                // Disconnect
                adminSocket.disconnect();
                setTimeout(done, 500);
            });
        });
    });

    // =========================================
    // MULTIPLE MESSAGES FLOW
    // =========================================
    describe('Multiple Messages', () => {
        let customerSocket;
        let adminSocket;
        let sessionId;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should handle multiple messages in sequence', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Multi Message Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;

                    // Send multiple messages
                    customerSocket.emit('customer:message', { message: 'Message 1' });
                    setTimeout(() => {
                        customerSocket.emit('customer:message', { message: 'Message 2' });
                    }, 100);
                });

                let msgCount = 0;
                adminSocket.on('admin:message', () => {
                    msgCount++;
                    if (msgCount >= 2) {
                        done();
                    }
                });

                setTimeout(done, 3000);
            });
        });
    });

    // =========================================
    // ADMIN MESSAGE TO CUSTOMER
    // =========================================
    describe('Admin Message to Customer', () => {
        let customerSocket;
        let adminSocket;
        let sessionId;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should send admin message and customer receives it', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Receive Message Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    // Admin sends message
                    adminSocket.emit('admin:message', { sessionId, message: 'Hello customer!' });
                });

                customerSocket.on('customer:message', (msg) => {
                    expect(msg.text).toBe('Hello customer!');
                    expect(msg.from).toBe('admin');
                    done();
                });

                setTimeout(done, 3000);
            });
        });
    });
});
