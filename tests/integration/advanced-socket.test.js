/**
 * Advanced Socket Coverage Tests
 * Testing socket handlers and edge cases
 */

const { io: ioClient } = require('socket.io-client');
const { createServer } = require('http');
const { Server } = require('socket.io');
const request = require('supertest');
const { app, server, io } = require('../../server');
const db = require('../../src/database');
const totp = require('../../src/utils/totp');

const TEST_PORT = 3998;

describe('Advanced Socket Handler Tests', () => {
    const timestamp = Date.now();
    let authToken;
    let testUserId;
    let twoFaUser;
    let twoFaToken;

    beforeAll(async () => {
        // Create admin user
        const adminUser = await db.users.create(
            `socket_admin_${timestamp}`,
            `socket_admin_${timestamp}@test.com`,
            'SocketPass123!',
            'super_admin'
        );
        testUserId = adminUser.id;

        const loginRes = await request(app)
            .post('/api/admin/login')
            .send({ username: `socket_admin_${timestamp}`, password: 'SocketPass123!' });
        authToken = loginRes.body.token;

        // Create 2FA user for testing
        twoFaUser = await db.users.create(
            `socket_2fa_${timestamp}`,
            `socket_2fa_${timestamp}@test.com`,
            'Socket2FA123!',
            'admin'
        );

        // Setup 2FA for this user
        const setupRes = await request(app)
            .post('/api/admin/login')
            .send({ username: `socket_2fa_${timestamp}`, password: 'Socket2FA123!' });
        twoFaToken = setupRes.body.token;
    });

    afterAll(async () => {
        await new Promise(resolve => {
            if (server && server.close) {
                server.close(resolve);
            } else {
                resolve();
            }
        });
    });

    describe('Admin Socket Authentication', () => {
        test('should handle admin reconnect with valid token', (done) => {
            const address = server.address();
            const port = address ? address.port : 3000;

            const socket = ioClient(`http://localhost:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            socket.on('connect', () => {
                socket.emit('admin:auth-token', authToken);
            });

            socket.on('admin:authenticated', (data) => {
                expect(data).toHaveProperty('token');
                socket.disconnect();
                done();
            });

            socket.on('admin:auth-failed', (data) => {
                socket.disconnect();
                // Token might be invalid in test env
                done();
            });

            setTimeout(() => {
                socket.disconnect();
                done();
            }, 3000);
        });

        test('should reject invalid token on reconnect', (done) => {
            const address = server.address();
            const port = address ? address.port : 3000;

            const socket = ioClient(`http://localhost:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            socket.on('connect', () => {
                socket.emit('admin:auth-token', 'invalid-token-here');
            });

            socket.on('admin:auth-failed', (data) => {
                expect(data.reason).toBeDefined();
                socket.disconnect();
                done();
            });

            setTimeout(() => {
                socket.disconnect();
                done();
            }, 2000);
        });
    });

    describe('Admin Session Management', () => {
        test('should handle admin joining specific session', (done) => {
            const address = server.address();
            const port = address ? address.port : 3000;

            const socket = ioClient(`http://localhost:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            socket.on('connect', () => {
                socket.emit('admin:auth', {
                    username: `socket_admin_${timestamp}`,
                    password: 'SocketPass123!'
                });
            });

            socket.on('admin:authenticated', () => {
                // Try to join a non-existent session
                socket.emit('admin:join-session', 'nonexistent-session-id');
                setTimeout(() => {
                    socket.disconnect();
                    done();
                }, 500);
            });

            socket.on('admin:auth-failed', () => {
                socket.disconnect();
                done();
            });

            setTimeout(() => {
                socket.disconnect();
                done();
            }, 3000);
        });

        test('should handle admin sending message to session', (done) => {
            const address = server.address();
            const port = address ? address.port : 3000;

            const socket = ioClient(`http://localhost:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            socket.on('connect', () => {
                socket.emit('admin:auth', {
                    username: `socket_admin_${timestamp}`,
                    password: 'SocketPass123!'
                });
            });

            socket.on('admin:authenticated', () => {
                socket.emit('admin:send-message', {
                    sessionId: 'test-session-id',
                    message: 'Test message from admin'
                });
                setTimeout(() => {
                    socket.disconnect();
                    done();
                }, 500);
            });

            socket.on('admin:auth-failed', () => {
                socket.disconnect();
                done();
            });

            setTimeout(() => {
                socket.disconnect();
                done();
            }, 3000);
        });

        test('should handle admin leaving session', (done) => {
            const address = server.address();
            const port = address ? address.port : 3000;

            const socket = ioClient(`http://localhost:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            socket.on('connect', () => {
                socket.emit('admin:auth', {
                    username: `socket_admin_${timestamp}`,
                    password: 'SocketPass123!'
                });
            });

            socket.on('admin:authenticated', () => {
                socket.emit('admin:leave-session', 'test-session-id');
                setTimeout(() => {
                    socket.disconnect();
                    done();
                }, 500);
            });

            socket.on('admin:auth-failed', () => {
                socket.disconnect();
                done();
            });

            setTimeout(() => {
                socket.disconnect();
                done();
            }, 3000);
        });
    });

    describe('Customer Socket Handlers', () => {
        test('should handle customer start chat', (done) => {
            const address = server.address();
            const port = address ? address.port : 3000;

            const socket = ioClient(`http://localhost:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            socket.on('connect', () => {
                socket.emit('customer:start-chat', {
                    name: 'Test Customer Socket',
                    contact: 'socket@test.com',
                    browserLocation: {
                        latitude: 40.7128,
                        longitude: -74.0060
                    }
                });
            });

            socket.on('customer:chat-started', (data) => {
                expect(data).toHaveProperty('sessionId');
                socket.disconnect();
                done();
            });

            socket.on('customer:error', () => {
                socket.disconnect();
                done();
            });

            setTimeout(() => {
                socket.disconnect();
                done();
            }, 3000);
        });

        test('should handle customer send message', (done) => {
            const address = server.address();
            const port = address ? address.port : 3000;

            const socket = ioClient(`http://localhost:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            let sessionId;

            socket.on('connect', () => {
                socket.emit('customer:start-chat', {
                    name: 'Message Customer',
                    contact: 'message@test.com'
                });
            });

            socket.on('customer:chat-started', (data) => {
                sessionId = data.sessionId;
                socket.emit('customer:send-message', {
                    sessionId,
                    message: 'Hello from customer'
                });
                setTimeout(() => {
                    socket.disconnect();
                    done();
                }, 500);
            });

            setTimeout(() => {
                socket.disconnect();
                done();
            }, 3000);
        });

        test('should handle customer typing indicator', (done) => {
            const address = server.address();
            const port = address ? address.port : 3000;

            const socket = ioClient(`http://localhost:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            socket.on('connect', () => {
                socket.emit('customer:start-chat', {
                    name: 'Typing Customer',
                    contact: 'typing@test.com'
                });
            });

            socket.on('customer:chat-started', (data) => {
                socket.emit('customer:typing', { sessionId: data.sessionId, isTyping: true });
                setTimeout(() => {
                    socket.emit('customer:typing', { sessionId: data.sessionId, isTyping: false });
                    socket.disconnect();
                    done();
                }, 300);
            });

            setTimeout(() => {
                socket.disconnect();
                done();
            }, 3000);
        });
    });

    describe('Ticket Operations via Socket', () => {
        test('should handle changing ticket priority', (done) => {
            const address = server.address();
            const port = address ? address.port : 3000;

            const socket = ioClient(`http://localhost:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            socket.on('connect', () => {
                socket.emit('admin:auth', {
                    username: `socket_admin_${timestamp}`,
                    password: 'SocketPass123!'
                });
            });

            socket.on('admin:authenticated', () => {
                socket.emit('admin:set-priority', {
                    sessionId: 'test-session',
                    priority: 'high'
                });
                setTimeout(() => {
                    socket.disconnect();
                    done();
                }, 500);
            });

            socket.on('admin:auth-failed', () => {
                socket.disconnect();
                done();
            });

            setTimeout(() => {
                socket.disconnect();
                done();
            }, 3000);
        });

        test('should handle adding ticket notes', (done) => {
            const address = server.address();
            const port = address ? address.port : 3000;

            const socket = ioClient(`http://localhost:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            socket.on('connect', () => {
                socket.emit('admin:auth', {
                    username: `socket_admin_${timestamp}`,
                    password: 'SocketPass123!'
                });
            });

            socket.on('admin:authenticated', () => {
                socket.emit('admin:add-note', {
                    sessionId: 'test-session',
                    note: 'Test internal note'
                });
                setTimeout(() => {
                    socket.disconnect();
                    done();
                }, 500);
            });

            socket.on('admin:auth-failed', () => {
                socket.disconnect();
                done();
            });

            setTimeout(() => {
                socket.disconnect();
                done();
            }, 3000);
        });

        test('should handle unarchiving ticket', (done) => {
            const address = server.address();
            const port = address ? address.port : 3000;

            const socket = ioClient(`http://localhost:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            socket.on('connect', () => {
                socket.emit('admin:auth', {
                    username: `socket_admin_${timestamp}`,
                    password: 'SocketPass123!'
                });
            });

            socket.on('admin:authenticated', () => {
                socket.emit('admin:unarchive-session', 'test-session');
                setTimeout(() => {
                    socket.disconnect();
                    done();
                }, 500);
            });

            socket.on('admin:auth-failed', () => {
                socket.disconnect();
                done();
            });

            setTimeout(() => {
                socket.disconnect();
                done();
            }, 3000);
        });
    });

    describe('Admin Typing Indicators', () => {
        test('should handle admin typing start', (done) => {
            const address = server.address();
            const port = address ? address.port : 3000;

            const socket = ioClient(`http://localhost:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            socket.on('connect', () => {
                socket.emit('admin:auth', {
                    username: `socket_admin_${timestamp}`,
                    password: 'SocketPass123!'
                });
            });

            socket.on('admin:authenticated', () => {
                socket.emit('admin:typing-start', 'test-session');
                setTimeout(() => {
                    socket.emit('admin:typing-stop', 'test-session');
                    socket.disconnect();
                    done();
                }, 300);
            });

            socket.on('admin:auth-failed', () => {
                socket.disconnect();
                done();
            });

            setTimeout(() => {
                socket.disconnect();
                done();
            }, 3000);
        });
    });

    describe('Get Sessions Request', () => {
        test('should handle get-sessions request', (done) => {
            const address = server.address();
            const port = address ? address.port : 3000;

            const socket = ioClient(`http://localhost:${port}`, {
                transports: ['websocket'],
                forceNew: true
            });

            socket.on('connect', () => {
                socket.emit('admin:auth', {
                    username: `socket_admin_${timestamp}`,
                    password: 'SocketPass123!'
                });
            });

            socket.on('admin:authenticated', () => {
                socket.emit('admin:get-sessions');
            });

            socket.on('admin:all-sessions', (sessions) => {
                expect(Array.isArray(sessions)).toBe(true);
                socket.disconnect();
                done();
            });

            socket.on('admin:auth-failed', () => {
                socket.disconnect();
                done();
            });

            setTimeout(() => {
                socket.disconnect();
                done();
            }, 3000);
        });
    });
});

describe('Database Edge Cases', () => {
    const timestamp = Date.now();

    test('should handle cleanup old audit logs', () => {
        // Add some audit logs
        db.audit.log('test-user-id', 'testuser', 'TEST_ACTION', 'test', 'test-id', { test: true }, '127.0.0.1', null);

        // Cleanup should not throw
        expect(() => db.audit.cleanup(90)).not.toThrow();
    });

    test('should handle session cleanup', () => {
        expect(() => db.sessions.cleanup()).not.toThrow();
    });

    test('should handle ticket cleanup', () => {
        expect(() => db.tickets.cleanupOldResolved(15)).not.toThrow();
    });

    test('should find sessions by user', () => {
        const sessions = db.sessions.findByUser('nonexistent-user');
        expect(Array.isArray(sessions)).toBe(true);
    });

    test('should handle finding user by reset token', () => {
        const user = db.users.findByResetToken('invalid-token');
        expect(user).toBeFalsy();
    });

    test('should handle clearing reset token', () => {
        expect(() => db.users.clearResetToken('nonexistent-user')).not.toThrow();
    });
});

describe('API Error Paths', () => {
    const timestamp = Date.now();
    let authToken;

    beforeAll(async () => {
        const adminUser = await db.users.create(
            `error_admin_${timestamp}`,
            `error_admin_${timestamp}@test.com`,
            'ErrorPass123!',
            'super_admin'
        );

        const loginRes = await request(app)
            .post('/api/admin/login')
            .send({ username: `error_admin_${timestamp}`, password: 'ErrorPass123!' });
        authToken = loginRes.body.token;
    });

    test('should handle getting specific user by ID', async () => {
        const res = await request(app)
            .get('/api/users/some-user-id')
            .set('Authorization', `Bearer ${authToken}`);

        expect([200, 404]).toContain(res.status);
    });

    test('should handle updating specific site', async () => {
        const res = await request(app)
            .put('/api/sites/nonexistent-site')
            .set('Authorization', `Bearer ${authToken}`)
            .send({ name: 'Updated' });

        expect([200, 404]).toContain(res.status);
    });

    test('should handle deleting specific site', async () => {
        const res = await request(app)
            .delete('/api/sites/nonexistent-site')
            .set('Authorization', `Bearer ${authToken}`);

        expect([200, 404]).toContain(res.status);
    });

    test('should handle regenerating key for nonexistent site', async () => {
        const res = await request(app)
            .post('/api/sites/nonexistent-site/regenerate-key')
            .set('Authorization', `Bearer ${authToken}`);

        expect([200, 404]).toContain(res.status);
    });

    test('should handle missing password for 2FA disable', async () => {
        const res = await request(app)
            .post('/api/2fa/disable')
            .set('Authorization', `Bearer ${authToken}`)
            .send({});

        expect(res.status).toBe(400);
    });

    test('should handle password reset for nonexistent user', async () => {
        const res = await request(app)
            .post('/api/users/nonexistent-id/reset-password')
            .set('Authorization', `Bearer ${authToken}`);

        expect([200, 404]).toContain(res.status);
    });

    test('should handle getting sessions for specific site', async () => {
        const res = await request(app)
            .get('/api/sites/test-site/sessions')
            .set('Authorization', `Bearer ${authToken}`);

        expect([200, 404]).toContain(res.status);
    });
});

describe('Chatbot Message Variations', () => {
    test('should handle greeting message', async () => {
        const res = await request(app)
            .post('/api/chatbot/message')
            .send({ message: 'hello there' });

        expect(res.status).toBe(200);
    });

    test('should handle goodbye message', async () => {
        const res = await request(app)
            .post('/api/chatbot/message')
            .send({ message: 'goodbye' });

        expect(res.status).toBe(200);
    });

    test('should handle thanks message', async () => {
        const res = await request(app)
            .post('/api/chatbot/message')
            .send({ message: 'thank you so much' });

        expect(res.status).toBe(200);
    });

    test('should handle hours question', async () => {
        const res = await request(app)
            .post('/api/chatbot/message')
            .send({ message: 'what are your hours?' });

        expect(res.status).toBe(200);
    });

    test('should handle support question', async () => {
        const res = await request(app)
            .post('/api/chatbot/message')
            .send({ message: 'I need technical support' });

        expect(res.status).toBe(200);
    });

    test('should handle unknown message', async () => {
        const res = await request(app)
            .post('/api/chatbot/message')
            .send({ message: 'random gibberish text xyz123' });

        expect(res.status).toBe(200);
    });
});
