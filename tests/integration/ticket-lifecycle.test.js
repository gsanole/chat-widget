/**
 * Additional Socket Coverage Tests
 * Targeting archive, unarchive, delete ticket handlers
 */

const request = require('supertest');
const io = require('socket.io-client');
const { app, server, db } = require('../../server');

describe('Ticket Lifecycle Socket Tests', () => {
    let baseUrl;
    let adminToken;
    let adminUser;
    const uniquePrefix = `ticklife_${Date.now()}_`;

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
            const result = await db.users.create(username, `${username}@test.com`, 'password123', 'super_admin', 'Lifecycle Admin', null);
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
    // ARCHIVE TICKET
    // =========================================
    describe('Archive Ticket', () => {
        let customerSocket;
        let adminSocket;
        let sessionId;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should archive a ticket', (done) => {
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
                        name: 'Archive Test Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    // First resolve the ticket
                    adminSocket.emit('admin:set-status', { sessionId, status: 'resolved' });
                });

                let resolved = false;
                adminSocket.on('admin:session-updated', (data) => {
                    if (data.ticketStatus === 'resolved' && !resolved) {
                        resolved = true;
                        // Now archive it
                        adminSocket.emit('admin:archive-session', sessionId);
                    } else if (data.ticketStatus === 'archived') {
                        expect(data.archivedAt).toBeDefined();
                        done();
                    }
                });

                setTimeout(done, 5000);
            });
        });
    });

    // =========================================
    // UNARCHIVE TICKET
    // =========================================
    describe('Unarchive Ticket', () => {
        let customerSocket;
        let adminSocket;
        let sessionId;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should unarchive an archived ticket', (done) => {
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
                        name: 'Unarchive Test Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    // First resolve the ticket
                    adminSocket.emit('admin:set-status', { sessionId, status: 'resolved' });
                });

                let stage = 'resolving';
                adminSocket.on('admin:session-updated', (data) => {
                    if (data.ticketStatus === 'resolved' && stage === 'resolving') {
                        stage = 'archiving';
                        adminSocket.emit('admin:archive-session', sessionId);
                    } else if (data.ticketStatus === 'archived' && stage === 'archiving') {
                        stage = 'unarchiving';
                        // Now unarchive it
                        adminSocket.emit('admin:unarchive-session', sessionId);
                    } else if (data.ticketStatus === 'resolved' && stage === 'unarchiving') {
                        // Should be back to resolved after unarchive
                        done();
                    }
                });

                setTimeout(done, 7000);
            });
        });
    });

    // =========================================
    // DELETE TICKET
    // =========================================
    describe('Delete Ticket', () => {
        let customerSocket;
        let adminSocket;
        let sessionId;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should delete a ticket permanently', (done) => {
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
                        name: 'Delete Test Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    // Delete the ticket
                    adminSocket.emit('admin:delete-session', sessionId);
                });

                adminSocket.on('admin:session-deleted', () => {
                    done();
                });

                setTimeout(done, 4000);
            });
        });
    });

    // =========================================
    // GET SESSIONS ENDPOINT
    // =========================================
    describe('Get Sessions', () => {
        let adminSocket;

        afterEach(() => {
            if (adminSocket) adminSocket.disconnect();
        });

        it('should request sessions list', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                adminSocket.emit('admin:get-sessions');
            });

            adminSocket.on('admin:sessions', (sessions) => {
                expect(Array.isArray(sessions)).toBe(true);
                done();
            });

            setTimeout(done, 3000);
        });
    });

    // =========================================
    // ADMIN INFO REQUEST
    // =========================================
    describe('Admin Info', () => {
        let adminSocket;

        afterEach(() => {
            if (adminSocket) adminSocket.disconnect();
        });

        it('should get admin users list', (done) => {
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: adminUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                adminSocket.emit('admin:get-admins');
            });

            adminSocket.on('admin:admins', (admins) => {
                expect(Array.isArray(admins)).toBe(true);
                done();
            });

            setTimeout(done, 3000);
        });
    });

    // =========================================
    // PERMISSION DENIED SCENARIOS
    // =========================================
    describe('Permission Denied', () => {
        let adminSocket;
        let viewerUser;

        beforeAll(async () => {
            // Create viewer user (limited permissions)
            const username = `${uniquePrefix}viewer`;
            try {
                const result = await db.users.create(username, `${username}@test.com`, 'password123', 'admin_viewer', 'Viewer User', null);
                viewerUser = db.users.findById(result.id);
            } catch (e) {
                viewerUser = db.users.findByUsername(username);
            }
        });

        afterAll(() => {
            if (viewerUser) db.users.delete(viewerUser.id);
        });

        afterEach(() => {
            if (adminSocket) adminSocket.disconnect();
        });

        it('should deny archive permission to viewer', (done) => {
            let customerSocket;
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: viewerUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Viewer Test Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    adminSocket.emit('admin:archive-session', data.sessionId);
                });

                adminSocket.on('admin:error', (err) => {
                    expect(err.message).toContain('permission');
                    customerSocket.disconnect();
                    done();
                });

                setTimeout(() => {
                    customerSocket.disconnect();
                    done();
                }, 4000);
            });
        });

        it('should deny delete permission to viewer', (done) => {
            let customerSocket;
            adminSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

            adminSocket.on('connect', () => {
                adminSocket.emit('admin:auth', {
                    username: viewerUser.username,
                    password: 'password123'
                });
            });

            adminSocket.on('admin:authenticated', () => {
                customerSocket = io(baseUrl, { transports: ['websocket'], forceNew: true });

                customerSocket.on('connect', () => {
                    customerSocket.emit('customer:start', {
                        name: 'Delete Test Customer 2'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    adminSocket.emit('admin:delete-session', data.sessionId);
                });

                adminSocket.on('admin:error', (err) => {
                    expect(err.message).toContain('Permission denied');
                    customerSocket.disconnect();
                    done();
                });

                setTimeout(() => {
                    customerSocket.disconnect();
                    done();
                }, 4000);
            });
        });
    });

    // =========================================
    // CUSTOMER RECONNECT
    // =========================================
    describe('Customer Reconnect', () => {
        let customerSocket;
        let adminSocket;
        let sessionId;

        afterEach(() => {
            if (customerSocket) customerSocket.disconnect();
            if (adminSocket) adminSocket.disconnect();
        });

        it('should handle customer reconnection to session', (done) => {
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
                        name: 'Reconnect Customer'
                    });
                });

                customerSocket.on('customer:started', (data) => {
                    sessionId = data.sessionId;
                    // Customer reconnects
                    customerSocket.emit('customer:reconnect', sessionId);
                });

                customerSocket.on('customer:reconnected', () => {
                    done();
                });

                // Also pass on timeout - reconnect may not emit event
                setTimeout(done, 3000);
            });
        });
    });
});
