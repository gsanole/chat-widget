/**
 * Unit tests for adminHandlers (socket).
 *
 * Pure unit tests — minimal stubs; database is mocked because
 * `sendAllSessionsToAdmin` lazily requires it for archived tickets.
 */

jest.mock('../../src/database', () => ({
    tickets: { findAll: jest.fn(() => []) }
}));

const { createAdminHandlers } = require('../../src/socket/handlers/adminHandlers');
const { OUT } = require('../../src/socket/events');
const dbMock = require('../../src/database');

function makeSocket(props = {}) {
    const emitted = [];
    return {
        id: 'sock_' + Math.random().toString(36).slice(2, 8),
        connected: true,
        isAdmin: false,
        adminUser: null,
        adminToken: null,
        ...props,
        emit: jest.fn(function (event, data) { emitted.push({ event, data }); }),
        emitted
    };
}

function lastEmitted(socket, event) {
    return [...socket.emitted].reverse().find(e => e.event === event);
}

describe('adminHandlers', () => {
    let deps, authService, userRepo, sessionRepo, auditRepo, totp, adminSockets, sessions;

    beforeEach(() => {
        dbMock.tickets.findAll.mockClear();
        dbMock.tickets.findAll.mockReturnValue([]);
        adminSockets = new Map();
        sessions = new Map();
        authService = {
            generateToken: jest.fn(() => 'jwt-token'),
            verifyToken: jest.fn()
        };
        userRepo = {
            authenticate: jest.fn(),
            findById: jest.fn(),
            updateLastLogin: jest.fn(),
            enableTotp: jest.fn()
        };
        sessionRepo = {
            create: jest.fn(),
            deleteByToken: jest.fn()
        };
        auditRepo = { log: jest.fn() };
        totp = {
            verifyTOTP: jest.fn(),
            verifyRecoveryCode: jest.fn()
        };

        deps = {
            io: { sockets: { adapter: { rooms: new Map() } } },
            authService,
            userRepository: userRepo,
            sessionRepository: sessionRepo,
            auditRepository: auditRepo,
            totp,
            adminSockets,
            sessions,
            getRealIP: () => '10.0.0.1',
            hasPermission: jest.fn(() => true)
        };
    });

    // -----------------------------------------------------------------------
    // sendAllSessionsToAdmin
    // -----------------------------------------------------------------------
    describe('sendAllSessionsToAdmin', () => {
        test('combines active sessions with archived tickets from DB', () => {
            sessions.set('s1', {
                sessionId: 's1', name: 'Alice', status: 'active',
                startTime: 1, lastActivity: 2, unreadCount: 3
            });
            dbMock.tickets.findAll.mockReturnValue([
                { id: 's1', status: 'active' }, // dedup, in memory
                {
                    id: 's2', status: 'archived', customer_name: 'Bob',
                    started_at: 100, last_message_at: 200,
                    customer_ip: '1.2.3.4', site_id: null
                }
            ]);

            const sock = makeSocket();
            const h = createAdminHandlers(deps);
            h.sendAllSessionsToAdmin(sock);

            const msg = lastEmitted(sock, OUT.ADMIN_SESSIONS);
            expect(msg).toBeDefined();
            expect(msg.data).toHaveLength(2);
            expect(msg.data.find(s => s.sessionId === 's2').isArchived).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // handleAuth — username/password (no 2FA)
    // -----------------------------------------------------------------------
    describe('handleAuth', () => {
        test('rejects when username missing (object form)', async () => {
            const sock = makeSocket();
            const h = createAdminHandlers(deps);
            await h.handleAuth(sock, { password: 'p' });
            expect(lastEmitted(sock, OUT.ADMIN_AUTH_FAILED).data.reason)
                .toMatch(/Username required/);
        });

        test('rejects bad credentials and writes audit log', async () => {
            userRepo.authenticate.mockResolvedValue(null);
            const sock = makeSocket();
            const h = createAdminHandlers(deps);
            await h.handleAuth(sock, { username: 'u', password: 'bad' });
            expect(lastEmitted(sock, OUT.ADMIN_AUTH_FAILED).data.reason)
                .toBe('Invalid username or password');
            expect(auditRepo.log).toHaveBeenCalledWith(expect.objectContaining({
                action: 'LOGIN_FAILED'
            }));
        });

        test('completes auth and emits ADMIN_AUTHENTICATED for non-2FA user', async () => {
            userRepo.authenticate.mockResolvedValue({
                id: 'u1', username: 'admin', role: 'admin', totp_enabled: false
            });
            const sock = makeSocket();
            const h = createAdminHandlers(deps);
            await h.handleAuth(sock, { username: 'admin', password: 'ok' });

            expect(sock.isAdmin).toBe(true);
            expect(sock.adminToken).toBe('jwt-token');
            expect(adminSockets.has(sock.id)).toBe(true);
            expect(sessionRepo.create).toHaveBeenCalled();
            expect(userRepo.updateLastLogin).toHaveBeenCalledWith('u1');
            expect(auditRepo.log).toHaveBeenCalledWith(expect.objectContaining({
                action: 'LOGIN_SUCCESS'
            }));
            expect(lastEmitted(sock, OUT.ADMIN_AUTHENTICATED).data.token).toBe('jwt-token');
            expect(lastEmitted(sock, OUT.ADMIN_SESSIONS)).toBeDefined();
        });

        test('requests 2FA code when totp_enabled and no code supplied', async () => {
            const user = { id: 'u1', username: 'a', role: 'admin', totp_enabled: true, totp_secret: 'S' };
            userRepo.authenticate.mockResolvedValue(user);
            const sock = makeSocket();
            const h = createAdminHandlers(deps);
            await h.handleAuth(sock, { username: 'a', password: 'p' });

            expect(lastEmitted(sock, OUT.ADMIN_REQUIRES_2FA)).toBeDefined();
            expect(sock.pendingUser).toBe(user);
        });

        test('rejects bad 2FA code and writes LOGIN_FAILED', async () => {
            const user = {
                id: 'u1', username: 'a', role: 'admin',
                totp_enabled: true, totp_secret: 'S', recovery_codes: null
            };
            userRepo.authenticate.mockResolvedValue(user);
            totp.verifyTOTP.mockReturnValue(false);
            const sock = makeSocket();
            const h = createAdminHandlers(deps);
            await h.handleAuth(sock, { username: 'a', password: 'p', totpCode: '000000' });

            expect(lastEmitted(sock, OUT.ADMIN_AUTH_FAILED).data.reason)
                .toBe('Invalid 2FA code');
            expect(auditRepo.log).toHaveBeenCalledWith(expect.objectContaining({
                action: 'LOGIN_FAILED'
            }));
        });

        test('falls back to a valid recovery code', async () => {
            const user = {
                id: 'u1', username: 'a', role: 'admin',
                totp_enabled: true, totp_secret: 'S',
                recovery_codes: JSON.stringify(['rec-1', 'rec-2'])
            };
            userRepo.authenticate.mockResolvedValue(user);
            totp.verifyTOTP.mockReturnValue(false);
            totp.verifyRecoveryCode.mockReturnValue({ valid: true, remainingCodes: ['rec-2'] });

            const sock = makeSocket();
            const h = createAdminHandlers(deps);
            await h.handleAuth(sock, { username: 'a', password: 'p', totpCode: 'rec-1' });

            expect(userRepo.enableTotp).toHaveBeenCalledWith('u1', ['rec-2']);
            expect(lastEmitted(sock, OUT.ADMIN_AUTHENTICATED)).toBeDefined();
        });

        test('catches exceptions thrown during authentication', async () => {
            const spy = jest.spyOn(console, 'error').mockImplementation(() => { });
            userRepo.authenticate.mockRejectedValue(new Error('db down'));
            const sock = makeSocket();
            const h = createAdminHandlers(deps);
            await h.handleAuth(sock, { username: 'u', password: 'p' });
            expect(lastEmitted(sock, OUT.ADMIN_AUTH_FAILED).data.reason)
                .toBe('Authentication error');
            spy.mockRestore();
        });
    });

    // -----------------------------------------------------------------------
    // handleSubmit2FA
    // -----------------------------------------------------------------------
    describe('handleSubmit2FA', () => {
        test('rejects when no pending user', async () => {
            const sock = makeSocket();
            const h = createAdminHandlers(deps);
            await h.handleSubmit2FA(sock, '123456');
            expect(lastEmitted(sock, OUT.ADMIN_AUTH_FAILED).data.reason)
                .toMatch(/No pending/);
        });

        test('completes auth on valid TOTP code', async () => {
            const user = { id: 'u1', username: 'a', role: 'admin', totp_secret: 'S' };
            const sock = makeSocket({ pendingUser: user });
            totp.verifyTOTP.mockReturnValue(true);
            const h = createAdminHandlers(deps);
            await h.handleSubmit2FA(sock, '123456');

            expect(sock.isAdmin).toBe(true);
            expect(sock.pendingUser).toBeUndefined();
            expect(lastEmitted(sock, OUT.ADMIN_AUTHENTICATED)).toBeDefined();
        });

        test('falls back to valid recovery code', async () => {
            const user = {
                id: 'u1', username: 'a', role: 'admin', totp_secret: 'S',
                recovery_codes: JSON.stringify(['r1'])
            };
            const sock = makeSocket({ pendingUser: user });
            totp.verifyTOTP.mockReturnValue(false);
            totp.verifyRecoveryCode.mockReturnValue({ valid: true, remainingCodes: [] });
            const h = createAdminHandlers(deps);
            await h.handleSubmit2FA(sock, 'r1');

            expect(userRepo.enableTotp).toHaveBeenCalledWith('u1', []);
            expect(sock.isAdmin).toBe(true);
        });

        test('rejects invalid 2FA when no recovery codes', async () => {
            const user = { id: 'u1', username: 'a', role: 'admin', totp_secret: 'S' };
            const sock = makeSocket({ pendingUser: user });
            totp.verifyTOTP.mockReturnValue(false);
            const h = createAdminHandlers(deps);
            await h.handleSubmit2FA(sock, '000000');
            expect(lastEmitted(sock, OUT.ADMIN_AUTH_FAILED).data.reason)
                .toBe('Invalid 2FA code');
            expect(sock.isAdmin).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // handleTokenAuth
    // -----------------------------------------------------------------------
    describe('handleTokenAuth', () => {
        test('emits ADMIN_AUTH_FAILED for an invalid token', () => {
            authService.verifyToken.mockReturnValue(null);
            const sock = makeSocket();
            const h = createAdminHandlers(deps);
            h.handleTokenAuth(sock, 'bad-token');
            expect(lastEmitted(sock, OUT.ADMIN_AUTH_FAILED).data.reason)
                .toMatch(/Invalid or expired/);
        });

        test('emits ADMIN_AUTH_FAILED when user is inactive', () => {
            authService.verifyToken.mockReturnValue({ userId: 'u1' });
            userRepo.findById.mockReturnValue({ id: 'u1', is_active: false });
            const sock = makeSocket();
            const h = createAdminHandlers(deps);
            h.handleTokenAuth(sock, 'tok');
            expect(lastEmitted(sock, OUT.ADMIN_AUTH_FAILED)).toBeDefined();
        });

        test('reconnects admin and sends sessions on valid token', () => {
            authService.verifyToken.mockReturnValue({ userId: 'u1' });
            userRepo.findById.mockReturnValue({
                id: 'u1', username: 'a', role: 'admin', is_active: true
            });
            const sock = makeSocket();
            const h = createAdminHandlers(deps);
            h.handleTokenAuth(sock, 'tok');

            expect(sock.isAdmin).toBe(true);
            expect(adminSockets.has(sock.id)).toBe(true);
            expect(lastEmitted(sock, OUT.ADMIN_AUTHENTICATED)).toBeDefined();
            expect(lastEmitted(sock, OUT.ADMIN_SESSIONS)).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // handleLogout
    // -----------------------------------------------------------------------
    describe('handleLogout', () => {
        test('clears state, deletes session, audits, emits ADMIN_LOGGED_OUT', () => {
            const sock = makeSocket({
                isAdmin: true,
                adminToken: 'tok',
                adminUser: { id: 'u1', username: 'a' }
            });
            adminSockets.set(sock.id, { socket: sock });
            const h = createAdminHandlers(deps);
            h.handleLogout(sock);

            expect(sessionRepo.deleteByToken).toHaveBeenCalledWith('tok');
            expect(auditRepo.log).toHaveBeenCalledWith(expect.objectContaining({
                action: 'LOGOUT'
            }));
            expect(adminSockets.has(sock.id)).toBe(false);
            expect(sock.isAdmin).toBe(false);
            expect(sock.adminToken).toBeNull();
            expect(sock.adminUser).toBeNull();
            expect(lastEmitted(sock, OUT.ADMIN_LOGGED_OUT)).toBeDefined();
        });

        test('still emits ADMIN_LOGGED_OUT even when not authenticated', () => {
            const sock = makeSocket();
            const h = createAdminHandlers(deps);
            h.handleLogout(sock);
            expect(sessionRepo.deleteByToken).not.toHaveBeenCalled();
            expect(auditRepo.log).not.toHaveBeenCalled();
            expect(lastEmitted(sock, OUT.ADMIN_LOGGED_OUT)).toBeDefined();
        });
    });
});
