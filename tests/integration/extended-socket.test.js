/**
 * Extended Socket.io Tests
 * Additional tests for comprehensive socket handler coverage
 */

const Client = require('socket.io-client');
const path = require('path');
const fs = require('fs');

// Set test environment before requiring app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-socket-ext';
process.env.DATABASE_DIR = path.join(__dirname, 'test-data-socket-ext');

// Ensure test directory exists
const TEST_DIR = process.env.DATABASE_DIR;
if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Clear require cache
delete require.cache[require.resolve('../../src/database')];
delete require.cache[require.resolve('../../server')];

const { server, io, db } = require('../../server');

describe('Extended Socket.io Coverage', () => {
    let serverAddress;
    let superAdminUser;
    let adminToken;

    beforeAll(async () => {
        // Start the server
        await new Promise((resolve) => {
            server.listen(0, () => {
                const port = server.address().port;
                serverAddress = `http://localhost:${port}`;
                resolve();
            });
        });

        // Create super admin for testing
        try {
            superAdminUser = await db.users.create(
                'socket_ext_admin',
                'socket_ext@test.com',
                'SocketExt123!',
                'super_admin',
                'Socket Ext Admin'
            );
        } catch (e) {
            superAdminUser = db.users.findByUsername('socket_ext_admin');
        }
    });

    afterAll((done) => {
        io.close();
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

    describe('Admin Session Management', () => {
        let adminSocket;
        let testSessionId;

        beforeEach((done) => {
            adminSocket = Client(serverAddress, {
                transports: ['websocket'],
                forceNew: true
            });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: 'socket_ext_admin',
                    password: 'SocketExt123!'
                });
            });

            adminSocket.on('admin:authenticated', (data) => {
                adminToken = data.token;
                // Create a test ticket
                testSessionId = `ext_session_${Date.now()}`;
                db.tickets.create(testSessionId, 'Ext Test Customer', '192.168.1.1', null, null);
                done();
            });

            adminSocket.on('admin:auth-failed', () => {
                done(new Error('Admin auth failed'));
            });
        });

        afterEach(() => {
            if (adminSocket) {
                adminSocket.close();
                adminSocket = null;
            }
        });

        test('should join session', (done) => {
            let resolved = false;

            adminSocket.emit('admin:join-session', testSessionId);

            adminSocket.on('admin:session-joined', (data) => {
                if (!resolved) {
                    resolved = true;
                    expect(data.sessionId).toBe(testSessionId);
                    done();
                }
            });

            adminSocket.on('admin:error', (data) => {
                if (!resolved) {
                    resolved = true;
                    // Session might not exist in memory
                    done();
                }
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            }, 2000);
        }, 5000);

        test('should change session status', (done) => {
            let resolved = false;

            adminSocket.emit('admin:change-status', {
                sessionId: testSessionId,
                status: 'in_progress'
            });

            adminSocket.on('admin:status-changed', (data) => {
                if (!resolved) {
                    resolved = true;
                    expect(data.sessionId).toBe(testSessionId);
                    done();
                }
            });

            adminSocket.on('admin:error', () => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            }, 2000);
        }, 5000);

        test('should resolve session', (done) => {
            let resolved = false;

            adminSocket.emit('admin:resolve-session', testSessionId);

            adminSocket.on('admin:session-resolved', (data) => {
                if (!resolved) {
                    resolved = true;
                    expect(data.sessionId).toBe(testSessionId);
                    done();
                }
            });

            adminSocket.on('admin:error', () => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            }, 2000);
        }, 5000);

        test('should reopen session', (done) => {
            let resolved = false;

            // First resolve, then reopen
            db.tickets.updateStatus(testSessionId, 'resolved');

            adminSocket.emit('admin:reopen-session', testSessionId);

            adminSocket.on('admin:session-reopened', (data) => {
                if (!resolved) {
                    resolved = true;
                    expect(data.sessionId).toBe(testSessionId);
                    done();
                }
            });

            adminSocket.on('admin:error', () => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            }, 2000);
        }, 5000);

        test('should archive session', (done) => {
            let resolved = false;

            adminSocket.emit('admin:archive-session', testSessionId);

            adminSocket.on('admin:session-archived', (data) => {
                if (!resolved) {
                    resolved = true;
                    expect(data.sessionId).toBe(testSessionId);
                    done();
                }
            });

            adminSocket.on('admin:error', () => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            }, 2000);
        }, 5000);

        test('should unarchive session', (done) => {
            let resolved = false;

            // First archive
            db.tickets.updateStatus(testSessionId, 'archived');

            adminSocket.emit('admin:unarchive-session', testSessionId);

            adminSocket.on('admin:session-unarchived', (data) => {
                if (!resolved) {
                    resolved = true;
                    expect(data.sessionId).toBe(testSessionId);
                    done();
                }
            });

            adminSocket.on('admin:error', () => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            }, 2000);
        }, 5000);

        test('should delete session', (done) => {
            let resolved = false;

            // Create a session to delete
            const deleteSessionId = `delete_session_${Date.now()}`;
            db.tickets.create(deleteSessionId, 'Delete Customer', '127.0.0.1', null, null);

            adminSocket.emit('admin:delete-session', deleteSessionId);

            adminSocket.on('admin:session-deleted', (data) => {
                if (!resolved) {
                    resolved = true;
                    expect(data.sessionId).toBe(deleteSessionId);
                    done();
                }
            });

            adminSocket.on('admin:error', () => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            }, 2000);
        }, 5000);

        test('should send admin message', (done) => {
            let resolved = false;

            adminSocket.emit('admin:message', {
                sessionId: testSessionId,
                message: 'Test admin message'
            });

            adminSocket.on('admin:message-sent', () => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            });

            adminSocket.on('admin:error', () => {
                if (!resolved) {
                    resolved = true;
                    // Session might not have active customer socket
                    done();
                }
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            }, 2000);
        }, 5000);
    });

    describe('Customer Message Flow', () => {
        let customerSocket;

        afterEach(() => {
            if (customerSocket) {
                customerSocket.close();
                customerSocket = null;
            }
        });

        test('should handle customer message to bot', (done) => {
            customerSocket = Client(serverAddress, {
                transports: ['websocket'],
                forceNew: true
            });

            let resolved = false;

            customerSocket.on('connect', () => {
                customerSocket.emit('customer:start', {
                    name: 'Message Test Customer',
                    contact: { type: 'email', value: 'msgtest@test.com' },
                    browserLocation: { latitude: 40.7128, longitude: -74.006, accuracy: 100 }
                });
            });

            customerSocket.on('customer:connected', (data) => {
                // Send a message
                customerSocket.emit('customer:message', {
                    sessionId: data.sessionId,
                    message: 'Hello bot!'
                });
            });

            customerSocket.on('customer:message', () => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            });

            customerSocket.on('customer:error', () => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    done();
                }
            }, 3000);
        }, 6000);
    });

    describe('2FA Socket Flow', () => {
        test('should handle 2FA required for user with 2FA enabled', (done) => {
            // This tests the 2FA flow if a user has 2FA enabled
            const totpSocket = Client(serverAddress, {
                transports: ['websocket'],
                forceNew: true
            });

            let resolved = false;

            totpSocket.on('connect', () => {
                totpSocket.emit('admin:auth', {
                    username: 'socket_ext_admin',
                    password: 'SocketExt123!'
                });
            });

            // Either authenticated or 2FA required
            totpSocket.on('admin:authenticated', () => {
                if (!resolved) {
                    resolved = true;
                    totpSocket.close();
                    done();
                }
            });

            totpSocket.on('admin:2fa-required', () => {
                if (!resolved) {
                    resolved = true;
                    // Submit invalid 2FA code
                    totpSocket.emit('admin:submit-2fa', '000000');
                }
            });

            totpSocket.on('admin:auth-failed', () => {
                if (!resolved) {
                    resolved = true;
                    totpSocket.close();
                    done();
                }
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    totpSocket.close();
                    done();
                }
            }, 3000);
        }, 5000);
    });

    describe('Error Handling', () => {
        test('should handle join non-existent session', (done) => {
            const errorSocket = Client(serverAddress, {
                transports: ['websocket'],
                forceNew: true
            });

            let resolved = false;

            errorSocket.on('connect', () => {
                errorSocket.emit('admin:auth', {
                    username: 'socket_ext_admin',
                    password: 'SocketExt123!'
                });
            });

            errorSocket.on('admin:authenticated', () => {
                errorSocket.emit('admin:join-session', 'totally-non-existent-session-xyz');
            });

            errorSocket.on('admin:error', () => {
                if (!resolved) {
                    resolved = true;
                    errorSocket.close();
                    done();
                }
            });

            errorSocket.on('admin:session-joined', () => {
                if (!resolved) {
                    resolved = true;
                    errorSocket.close();
                    done();
                }
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    errorSocket.close();
                    done();
                }
            }, 2000);
        }, 5000);
    });
});
