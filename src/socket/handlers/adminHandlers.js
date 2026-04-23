/**
 * Admin Socket Handlers
 * 
 * Single Responsibility: Admin authentication and commands via Socket.IO
 */

const { OUT } = require('../events');

/**
 * Create admin socket handlers
 * @param {Object} deps - Dependencies
 * @param {Object} deps.io - Socket.IO server instance
 * @param {Object} deps.authService - Authentication service
 * @param {Object} deps.userRepository - User repository
 * @param {Object} deps.sessionRepository - Session repository
 * @param {Object} deps.auditRepository - Audit repository
 * @param {Object} deps.totp - TOTP module
 * @param {Map} deps.adminSockets - Admin sockets map
 * @param {Map} deps.sessions - Customer sessions map
 * @param {Function} deps.getRealIP - IP extraction function
 * @param {Object} deps.hasPermission - Permission checker
 * @returns {Object} Handler functions
 */
function createAdminHandlers({
    io,
    authService,
    userRepository,
    sessionRepository,
    auditRepository,
    totp,
    adminSockets,
    sessions,
    getRealIP,
    hasPermission
}) {

    /**
     * Send all sessions to admin
     * @param {Object} socket - Admin socket
     */
    function sendAllSessionsToAdmin(socket) {
        const activeSessions = Array.from(sessions.values()).map(s => ({
            sessionId: s.sessionId,
            name: s.name,
            status: s.status,
            ticketStatus: s.ticketStatus || 'open',
            startTime: s.startTime,
            lastActivity: s.lastActivity,
            ip: s.ip,
            geo: s.geo,
            ipAnalysis: s.ipAnalysis,
            location: s.location,
            locationCheck: s.locationCheck,
            contact: s.contact,
            isVPN: s.ipAnalysis?.isVPN,
            isProxy: s.ipAnalysis?.isProxy,
            siteId: s.siteId,
            hasAdminJoined: s.hasAdminJoined,
            unreadCount: s.unreadCount || 0
        }));

        const archivedTickets = require('../../database').tickets.findAll();
        const additionalFromDb = archivedTickets
            .filter(t => !sessions.has(t.id))
            .map(t => ({
                sessionId: t.id,
                name: t.customer_name,
                status: t.status,
                ticketStatus: t.status,
                startTime: t.started_at * 1000,
                lastActivity: (t.last_message_at || t.started_at) * 1000,
                ip: t.customer_ip,
                geo: t.ip_analysis?.geo,
                ipAnalysis: t.ip_analysis,
                location: t.customer_location,
                contact: t.customer_contact,
                siteId: t.site_id,
                isArchived: t.status === 'archived',
                isOnline: false
            }));

        socket.emit(OUT.ADMIN_SESSIONS, [...activeSessions, ...additionalFromDb]);
    }

    /**
     * Handle admin authentication
     * @param {Object} socket - Socket instance
     * @param {Object} data - Auth data
     */
    async function handleAuth(socket, data) {
        const ip = getRealIP(socket);
        const { username, password, totpCode } = typeof data === 'string'
            ? { username: null, password: data, totpCode: null }
            : data;

        try {
            if (!username) {
                socket.emit(OUT.ADMIN_AUTH_FAILED, { reason: 'Username required for login' });
                return;
            }

            const user = await userRepository.authenticate(username, password);

            if (!user) {
                auditRepository.log({
                    userId: null,
                    username,
                    action: 'LOGIN_FAILED',
                    resourceType: 'user',
                    details: { reason: 'Invalid credentials', via: 'socket' },
                    ipAddress: ip
                });
                socket.emit(OUT.ADMIN_AUTH_FAILED, { reason: 'Invalid username or password' });
                return;
            }

            // Check 2FA
            if (user.totp_enabled) {
                if (!totpCode) {
                    socket.emit(OUT.ADMIN_REQUIRES_2FA, { message: 'Please enter your 2FA code' });
                    socket.pendingUser = user;
                    return;
                }

                if (!totp.verifyTOTP(user.totp_secret, totpCode)) {
                    let validRecovery = false;
                    if (user.recovery_codes) {
                        // recovery_codes may be stored as a JSON string OR
                        // (when written via JsonDB) already as an array. Be tolerant.
                        const codes = Array.isArray(user.recovery_codes)
                            ? [...user.recovery_codes]
                            : (typeof user.recovery_codes === 'string'
                                ? JSON.parse(user.recovery_codes)
                                : []);
                        const result = totp.verifyRecoveryCode(codes, totpCode);
                        if (result.valid) {
                            userRepository.enableTotp(user.id, result.remainingCodes);
                            validRecovery = true;
                        }
                    }

                    if (!validRecovery) {
                        auditRepository.log({
                            userId: user.id,
                            username,
                            action: 'LOGIN_FAILED',
                            resourceType: 'user',
                            resourceId: user.id,
                            details: { reason: 'Invalid 2FA code', via: 'socket' },
                            ipAddress: ip
                        });
                        socket.emit(OUT.ADMIN_AUTH_FAILED, { reason: 'Invalid 2FA code' });
                        return;
                    }
                }
            }

            completeAdminAuth(socket, user, ip);
        } catch (err) {
            console.error('Socket auth error:', err);
            socket.emit(OUT.ADMIN_AUTH_FAILED, { reason: 'Authentication error' });
        }
    }

    /**
     * Handle 2FA submission
     * @param {Object} socket - Socket instance
     * @param {string} totpCode - TOTP code
     */
    async function handleSubmit2FA(socket, totpCode) {
        const ip = getRealIP(socket);
        const user = socket.pendingUser;

        if (!user) {
            socket.emit(OUT.ADMIN_AUTH_FAILED, { reason: 'No pending authentication' });
            return;
        }

        if (!totp.verifyTOTP(user.totp_secret, totpCode)) {
            let validRecovery = false;
            if (user.recovery_codes) {
                const codes = Array.isArray(user.recovery_codes)
                    ? [...user.recovery_codes]
                    : (typeof user.recovery_codes === 'string'
                        ? JSON.parse(user.recovery_codes)
                        : []);
                const result = totp.verifyRecoveryCode(codes, totpCode);
                if (result.valid) {
                    userRepository.enableTotp(user.id, result.remainingCodes);
                    validRecovery = true;
                }
            }

            if (!validRecovery) {
                socket.emit(OUT.ADMIN_AUTH_FAILED, { reason: 'Invalid 2FA code' });
                return;
            }
        }

        delete socket.pendingUser;
        completeAdminAuth(socket, user, ip);
    }

    /**
     * Complete admin authentication
     * @param {Object} socket - Socket instance
     * @param {Object} user - User object
     * @param {string} ip - IP address
     */
    function completeAdminAuth(socket, user, ip) {
        const token = authService.generateToken(user);
        socket.isAdmin = true;
        socket.adminToken = token;
        socket.adminUser = {
            id: user.id,
            username: user.username,
            nickname: user.nickname || user.username,
            role: user.role
        };

        adminSockets.set(socket.id, {
            socket,
            token,
            ip,
            user: socket.adminUser
        });

        userRepository.updateLastLogin(user.id);
        sessionRepository.create({
            userId: user.id,
            token,
            ipAddress: ip
        });

        auditRepository.log({
            userId: user.id,
            username: user.username,
            action: 'LOGIN_SUCCESS',
            resourceType: 'user',
            resourceId: user.id,
            details: { via: 'socket' },
            ipAddress: ip
        });

        socket.emit(OUT.ADMIN_AUTHENTICATED, {
            token,
            user: {
                id: user.id,
                username: user.username,
                nickname: user.nickname || user.username,
                role: user.role,
                totp_enabled: user.totp_enabled
            }
        });

        sendAllSessionsToAdmin(socket);
        console.log(`Admin ${user.username} connected from ${ip}`);
    }

    /**
     * Handle token-based authentication
     * @param {Object} socket - Socket instance
     * @param {string} token - JWT token
     */
    function handleTokenAuth(socket, token) {
        const ip = getRealIP(socket);
        const decoded = authService.verifyToken(token);

        if (decoded) {
            const user = userRepository.findById(decoded.userId);
            if (user && user.is_active) {
                socket.isAdmin = true;
                socket.adminToken = token;
                socket.adminUser = {
                    id: user.id,
                    username: user.username,
                    nickname: user.nickname || user.username,
                    role: user.role
                };

                adminSockets.set(socket.id, {
                    socket,
                    token,
                    ip,
                    user: socket.adminUser
                });

                socket.emit(OUT.ADMIN_AUTHENTICATED, {
                    token,
                    user: socket.adminUser
                });

                sendAllSessionsToAdmin(socket);
                console.log(`Admin ${user.username} reconnected via token from ${ip}`);
                return;
            }
        }

        socket.emit(OUT.ADMIN_AUTH_FAILED, { reason: 'Invalid or expired token' });
    }

    /**
     * Handle admin logout
     * @param {Object} socket - Socket instance
     */
    function handleLogout(socket) {
        if (socket.adminToken) {
            sessionRepository.deleteByToken(socket.adminToken);
        }

        if (socket.adminUser) {
            auditRepository.log({
                userId: socket.adminUser.id,
                username: socket.adminUser.username,
                action: 'LOGOUT',
                details: { via: 'socket' },
                ipAddress: getRealIP(socket)
            });
            console.log(`Admin ${socket.adminUser.username} logged out`);
        }

        adminSockets.delete(socket.id);
        socket.isAdmin = false;
        socket.adminToken = null;
        socket.adminUser = null;
        socket.emit(OUT.ADMIN_LOGGED_OUT);
    }

    return {
        handleAuth,
        handleSubmit2FA,
        handleTokenAuth,
        handleLogout,
        sendAllSessionsToAdmin,
        completeAdminAuth
    };
}

module.exports = { createAdminHandlers };
