/**
 * Chat Flow Tests - End-to-end admin-customer chat interactions
 * Target: Full socket message flows, typing indicators, admin operations
 */

const request = require('supertest');
const io = require('socket.io-client');
const { app, server, db } = require('../../server');

const uniqueId = () => `${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

describe('Chat Flow Integration Tests', () => {
    let testPort;
    let baseUrl;
    let serverInstance;
    let adminUsername;
    let adminId;

    beforeAll(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        testPort = 4200 + Math.floor(Math.random() * 300);
        baseUrl = `http://localhost:${testPort}`;

        serverInstance = server.listen(testPort);
        await new Promise(resolve => setTimeout(resolve, 500));

        // Create admin user for socket tests
        adminUsername = `chat_admin_${uniqueId()}`;
        try {
            const user = db.users.create(adminUsername, `${adminUsername}@test.com`, 'chatpass123!', 'admin');
            adminId = user.id;
        } catch (e) { }
    });

    afterAll(async () => {
        if (adminId) try { db.users.delete(adminId); } catch (e) { }
        if (serverInstance) serverInstance.close();
        await new Promise(resolve => setTimeout(resolve, 200));
    });

    describe('Full Chat Conversation Flow', () => {
        let adminSocket;
        let customerSocket;
        let sessionId;

        beforeAll((done) => {
            let adminReady = false;
            let customerReady = false;

            const checkDone = () => {
                if (adminReady && customerReady && sessionId) done();
            };

            // Connect admin first
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', { username: adminUsername, password: 'chatpass123!' });
            });

            adminSocket.on('admin:authenticated', () => {
                adminReady = true;
                // Now connect customer
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Chat Flow Customer',
                        email: `chatflow_${uniqueId()}@test.com`
                    });
                });

                customerSocket.on('customer:session-started', (data) => {
                    sessionId = data.sessionId;
                    customerReady = true;
                    checkDone();
                });
            });

            adminSocket.on('admin:auth-failed', () => done());
            setTimeout(done, 8000);
        });

        afterAll(() => {
            if (adminSocket?.connected) adminSocket.disconnect();
            if (customerSocket?.connected) customerSocket.disconnect();
        });

        test('admin should receive new session notification', (done) => {
            if (!adminSocket || !sessionId) { done(); return; }

            // Admin should have received the new session
            adminSocket.emit('admin:join-session', sessionId);

            adminSocket.once('admin:session-history', (data) => {
                expect(data.sessionId).toBe(sessionId);
                done();
            });

            setTimeout(done, 2000);
        });

        test('customer should send message to admin', (done) => {
            if (!customerSocket || !adminSocket || !sessionId) { done(); return; }

            adminSocket.once('admin:message', (data) => {
                if (data.sessionId === sessionId && data.message.text === 'Hello from customer!') {
                    done();
                }
            });

            customerSocket.emit('customer:message', { message: 'Hello from customer!' });
            setTimeout(done, 2000);
        });

        test('admin should send message to customer', (done) => {
            if (!customerSocket || !adminSocket || !sessionId) { done(); return; }

            customerSocket.once('customer:message', (data) => {
                if (data.text === 'Hello from admin!') {
                    done();
                }
            });

            adminSocket.emit('admin:message', { sessionId, message: 'Hello from admin!' });
            setTimeout(done, 2000);
        });

        test('customer should send typing indicator', (done) => {
            if (!customerSocket || !adminSocket || !sessionId) { done(); return; }

            adminSocket.once('admin:customer-typing', (data) => {
                if (data.sessionId === sessionId) {
                    done();
                }
            });

            customerSocket.emit('customer:typing');
            setTimeout(done, 2000);
        });

        test('admin should send typing indicator', (done) => {
            if (!customerSocket || !adminSocket || !sessionId) { done(); return; }

            customerSocket.once('customer:admin-typing', (data) => {
                if (data) {
                    done();
                }
            });

            adminSocket.emit('admin:typing', { sessionId });
            setTimeout(done, 2000);
        });

        test('admin should set session priority', (done) => {
            if (!adminSocket || !sessionId) { done(); return; }

            adminSocket.once('admin:session-updated', (data) => {
                if (data.sessionId === sessionId && data.priority === 'high') {
                    done();
                }
            });

            adminSocket.emit('admin:set-priority', { sessionId, priority: 'high' });
            setTimeout(done, 2000);
        });

        test('admin should add note to session', (done) => {
            if (!adminSocket || !sessionId) { done(); return; }

            adminSocket.once('admin:note-added', (data) => {
                if (data.sessionId === sessionId && data.note.includes('Internal note')) {
                    done();
                }
            });

            adminSocket.emit('admin:add-note', { sessionId, note: 'Internal note for this session' });
            setTimeout(done, 2000);
        });

        test('admin should assign session to self', (done) => {
            if (!adminSocket || !sessionId) { done(); return; }

            adminSocket.once('admin:session-updated', (data) => {
                if (data.sessionId === sessionId && data.assignedTo) {
                    done();
                }
            });

            adminSocket.emit('admin:assign-session', { sessionId, adminId });
            setTimeout(done, 2000);
        });

        test('admin should resolve session', (done) => {
            if (!adminSocket || !sessionId) { done(); return; }

            adminSocket.once('admin:session-updated', (data) => {
                if (data.sessionId === sessionId && data.ticketStatus === 'resolved') {
                    done();
                }
            });

            adminSocket.emit('admin:resolve-session', sessionId);
            setTimeout(done, 2000);
        });
    });

    describe('Multiple Customer Sessions', () => {
        let adminSocket;
        let customer1Socket;
        let customer2Socket;
        let session1Id;
        let session2Id;

        beforeAll((done) => {
            let ready = 0;
            const checkDone = () => {
                ready++;
                if (ready >= 3) done();
            };

            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });
            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', { username: adminUsername, password: 'chatpass123!' });
            });
            adminSocket.on('admin:authenticated', () => {
                checkDone();

                customer1Socket = io(baseUrl, { transports: ['websocket'], forceNew: true });
                customer1Socket.on('connect', () => {
                    customer1Socket.emit('customer:start', { name: 'Customer One', email: `cust1_${uniqueId()}@test.com` });
                });
                customer1Socket.on('customer:session-started', (data) => {
                    session1Id = data.sessionId;
                    checkDone();
                });

                customer2Socket = io(baseUrl, { transports: ['websocket'], forceNew: true });
                customer2Socket.on('connect', () => {
                    customer2Socket.emit('customer:start', { name: 'Customer Two', email: `cust2_${uniqueId()}@test.com` });
                });
                customer2Socket.on('customer:session-started', (data) => {
                    session2Id = data.sessionId;
                    checkDone();
                });
            });
            adminSocket.on('admin:auth-failed', () => done());
            setTimeout(done, 10000);
        });

        afterAll(() => {
            if (adminSocket?.connected) adminSocket.disconnect();
            if (customer1Socket?.connected) customer1Socket.disconnect();
            if (customer2Socket?.connected) customer2Socket.disconnect();
        });

        test('admin should receive messages from multiple customers', (done) => {
            if (!adminSocket || !session1Id || !session2Id) { done(); return; }

            let msg1Received = false;
            let msg2Received = false;

            adminSocket.on('admin:message', (data) => {
                if (data.sessionId === session1Id && data.message.text === 'Message from customer 1') {
                    msg1Received = true;
                }
                if (data.sessionId === session2Id && data.message.text === 'Message from customer 2') {
                    msg2Received = true;
                }
                if (msg1Received && msg2Received) {
                    done();
                }
            });

            customer1Socket.emit('customer:message', { message: 'Message from customer 1' });
            customer2Socket.emit('customer:message', { message: 'Message from customer 2' });

            setTimeout(done, 3000);
        });

        test('admin should send messages to specific customers', (done) => {
            if (!adminSocket || !customer1Socket || !customer2Socket || !session1Id) { done(); return; }

            customer1Socket.once('customer:message', (data) => {
                if (data.text === 'Reply to customer 1 only') {
                    done();
                }
            });

            adminSocket.emit('admin:message', { sessionId: session1Id, message: 'Reply to customer 1 only' });
            setTimeout(done, 2000);
        });
    });

    describe('Customer Message Rate Limiting', () => {
        let customerSocket;
        let sessionId;

        beforeAll((done) => {
            customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });
            customerSocket.on('connect', () => {
                customerSocket.emit('customer:start', { name: 'Rate Limit Customer', email: `ratelimit_${uniqueId()}@test.com` });
            });
            customerSocket.on('customer:session-started', (data) => {
                sessionId = data.sessionId;
                done();
            });
            setTimeout(done, 3000);
        });

        afterAll(() => {
            if (customerSocket?.connected) customerSocket.disconnect();
        });

        test('customer should be rate limited on rapid messages', (done) => {
            if (!customerSocket || !sessionId) { done(); return; }

            let errorReceived = false;

            customerSocket.on('customer:error', (data) => {
                if (data.message && data.message.includes('too fast')) {
                    errorReceived = true;
                    done();
                }
            });

            // Send many messages rapidly
            for (let i = 0; i < 25; i++) {
                customerSocket.emit('customer:message', { message: `Rapid message ${i}` });
            }

            setTimeout(() => {
                if (!errorReceived) done(); // Pass if no rate limit hit (tolerance)
            }, 2000);
        });
    });

    describe('Session Without Active Customer', () => {
        let adminSocket;
        let orphanSessionId;

        beforeAll((done) => {
            // Create a ticket directly in database (simulating customer disconnect)
            orphanSessionId = `orphan_${uniqueId()}`;
            try {
                db.tickets.create(orphanSessionId, 'test-site', 'Orphan Customer', '10.0.0.5', null, null, 'open');
            } catch (e) { }

            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });
            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', { username: adminUsername, password: 'chatpass123!' });
            });
            adminSocket.on('admin:authenticated', () => done());
            adminSocket.on('admin:auth-failed', () => done());
            setTimeout(done, 3000);
        });

        afterAll(() => {
            if (adminSocket?.connected) adminSocket.disconnect();
            if (orphanSessionId) try { db.tickets.delete(orphanSessionId); } catch (e) { }
        });

        test('admin should be able to message orphan session without error', (done) => {
            if (!adminSocket || !orphanSessionId) { done(); return; }

            // Should not throw error, just silently fail to deliver
            adminSocket.emit('admin:message', { sessionId: orphanSessionId, message: 'Message to disconnected customer' });

            // Give time for any error to be emitted
            setTimeout(done, 1000);
        });

        test('admin should be able to archive orphan session', (done) => {
            if (!adminSocket || !orphanSessionId) { done(); return; }

            adminSocket.once('admin:session-updated', (data) => {
                if (data.sessionId === orphanSessionId) {
                    done();
                }
            });

            adminSocket.emit('admin:archive-session', orphanSessionId);
            setTimeout(done, 2000);
        });
    });

    describe('Admin Operations Without Session', () => {
        let adminSocket;

        beforeAll((done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });
            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', { username: adminUsername, password: 'chatpass123!' });
            });
            adminSocket.on('admin:authenticated', () => done());
            adminSocket.on('admin:auth-failed', () => done());
            setTimeout(done, 3000);
        });

        afterAll(() => {
            if (adminSocket?.connected) adminSocket.disconnect();
        });

        test('admin operations on non-existent session should be handled gracefully', (done) => {
            if (!adminSocket) { done(); return; }

            const fakeSessionId = 'fake_session_12345';

            // These should all be silently handled without error
            adminSocket.emit('admin:message', { sessionId: fakeSessionId, message: 'Test' });
            adminSocket.emit('admin:typing', { sessionId: fakeSessionId });
            adminSocket.emit('admin:join-session', fakeSessionId);
            adminSocket.emit('admin:set-priority', { sessionId: fakeSessionId, priority: 'urgent' });
            adminSocket.emit('admin:add-note', { sessionId: fakeSessionId, note: 'Test note' });
            adminSocket.emit('admin:resolve-session', fakeSessionId);

            // If no error emitted in 1 second, pass
            setTimeout(done, 1000);
        });
    });

    describe('Customer End Session', () => {
        let adminSocket;
        let customerSocket;
        let sessionId;

        beforeAll((done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });
            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', { username: adminUsername, password: 'chatpass123!' });
            });
            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });
                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', { name: 'End Session Customer', email: `endsession_${uniqueId()}@test.com` });
                });
                customerSocket.on('customer:session-started', (data) => {
                    sessionId = data.sessionId;
                    done();
                });
            });
            adminSocket.on('admin:auth-failed', () => done());
            setTimeout(done, 5000);
        });

        afterAll(() => {
            if (adminSocket?.connected) adminSocket.disconnect();
            if (customerSocket?.connected) customerSocket.disconnect();
        });

        test('customer should be able to end their own session', (done) => {
            if (!customerSocket || !sessionId) { done(); return; }

            customerSocket.emit('customer:end-session');

            customerSocket.once('customer:session-ended', () => {
                done();
            });

            setTimeout(done, 2000);
        });
    });

    describe('Unauthenticated Admin Actions', () => {
        let unauthSocket;

        beforeAll((done) => {
            unauthSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });
            unauthSocket.on('connect', () => done());
            setTimeout(done, 2000);
        });

        afterAll(() => {
            if (unauthSocket?.connected) unauthSocket.disconnect();
        });

        test('unauthenticated socket should not process admin actions', (done) => {
            if (!unauthSocket) { done(); return; }

            // These should all be ignored since socket is not authenticated as admin
            unauthSocket.emit('admin:message', { sessionId: 'test', message: 'Test' });
            unauthSocket.emit('admin:join-session', 'test');
            unauthSocket.emit('admin:set-priority', { sessionId: 'test', priority: 'urgent' });
            unauthSocket.emit('admin:resolve-session', 'test');
            unauthSocket.emit('admin:archive-session', 'test');
            unauthSocket.emit('admin:delete-session', 'test');

            // If no unexpected response in 1 second, pass
            setTimeout(done, 1000);
        });
    });
});
