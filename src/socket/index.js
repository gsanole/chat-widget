/**
 * Socket.IO Setup
 * 
 * Single Responsibility: Wire up all socket handlers with dependencies
 */

const { createAdminHandlers } = require('./handlers/adminHandlers');
const { createChatHandlers } = require('./handlers/chatHandlers');
const { createSessionHandlers } = require('./handlers/sessionHandlers');
const { SocketRateLimiter } = require('../middleware/rateLimiter');
const { createWebhookBridge } = require('../services/lygHubWebhook');
const { IN } = require('./events');

/**
 * Set up Socket.IO with all handlers
 * @param {Object} io - Socket.IO server instance
 * @param {Object} deps - Dependencies
 * @param {Object} deps.authService - Authentication service
 * @param {Object} deps.ticketRepository - Ticket repository
 * @param {Object} deps.messageRepository - Message repository
 * @param {Object} deps.userRepository - User repository
 * @param {Object} deps.sessionRepository - Session repository
 * @param {Object} deps.auditRepository - Audit repository
 * @param {Object} deps.siteRepository - Site repository
 * @param {Object} deps.chatbotService - Chatbot service
 * @param {Object} deps.totp - TOTP module
 * @param {Object} deps.hasPermission - Permission checker
 * @param {Function} deps.getRealIP - IP extraction function
 * @param {Function} deps.analyzeIP - IP analysis function
 * @param {Function} deps.generateId - ID generator function
 */
function setupSocketIO(io, deps) {
    const {
        authService,
        ticketRepository,
        messageRepository,
        userRepository,
        sessionRepository,
        auditRepository,
        siteRepository,
        chatbotService,
        totp,
        hasPermission,
        getRealIP,
        analyzeIP,
        generateId
    } = deps;

    // Shared state
    const adminSockets = new Map();
    const sessions = new Map();
    const rateLimiter = new SocketRateLimiter({
        maxConnectionsPerIP: 10,
        connectionWindowMs: 60000
    });

    // Per-site outbound webhook bridge. Resolves the destination URL +
    // secret at send-time from each site's `integration` config; sites
    // without integration get a no-op. Override via deps.webhook for tests.
    const webhook = deps.webhook || createWebhookBridge({
        siteRepository
    });

    // Create handlers with dependencies
    const adminHandlers = createAdminHandlers({
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
    });

    const chatHandlers = createChatHandlers({
        io,
        messageRepository,
        ticketRepository,
        adminSockets,
        sessions,
        getRealIP,
        hasPermission,
        chatbotService,
        webhook
    });

    const sessionHandlers = createSessionHandlers({
        io,
        ticketRepository,
        siteRepository,
        chatbotService,
        adminSockets,
        sessions,
        getRealIP,
        analyzeIP,
        generateId,
        webhook
    });

    // Connection handling
    io.on('connection', (socket) => {
        const ip = getRealIP(socket);

        // Rate limit connections
        if (!rateLimiter.trackConnection(ip)) {
            console.log(`Rate limited connection from ${ip}`);
            socket.emit('error', { message: 'Too many connections. Please wait.' });
            socket.disconnect(true);
            return;
        }

        console.log(`New connection from ${ip}`);

        // Admin authentication events
        socket.on(IN.ADMIN_AUTH, (data) => adminHandlers.handleAuth(socket, data));
        socket.on(IN.ADMIN_SUBMIT_2FA, (code) => adminHandlers.handleSubmit2FA(socket, code));
        socket.on(IN.ADMIN_TOKEN_AUTH, (token) => adminHandlers.handleTokenAuth(socket, token));
        // Alias: client (admin.html, widget) emits 'admin:auth-token'
        socket.on(IN.ADMIN_AUTH_TOKEN, (token) => adminHandlers.handleTokenAuth(socket, token));
        socket.on(IN.ADMIN_LOGOUT, () => adminHandlers.handleLogout(socket));

        // Admin chat management
        socket.on(IN.ADMIN_JOIN_CHAT, (sessionId) => chatHandlers.handleAdminJoin(socket, sessionId));
        socket.on(IN.ADMIN_LEAVE_CHAT, (sessionId) => chatHandlers.handleAdminLeave(socket, sessionId));
        socket.on(IN.ADMIN_MESSAGE, (data) => chatHandlers.handleAdminMessage(socket, data));
        socket.on(IN.ADMIN_TYPING, (data) => chatHandlers.handleTyping(socket, data));
        socket.on(IN.ADMIN_MARK_READ, (data) => chatHandlers.handleMarkRead(socket, data));

        // Admin session management
        socket.on(IN.ADMIN_CLOSE_SESSION, (sessionId) => sessionHandlers.handleAdminClose(socket, sessionId));
        socket.on(IN.ADMIN_ARCHIVE_SESSION, (sessionId) => sessionHandlers.handleAdminArchive(socket, sessionId));
        socket.on(IN.ADMIN_UNARCHIVE_SESSION, (sessionId) => sessionHandlers.handleAdminUnarchive(socket, sessionId));
        socket.on(IN.ADMIN_DELETE_SESSION, (sessionId) => sessionHandlers.handleAdminDelete(socket, sessionId));
        socket.on(IN.ADMIN_RESOLVE_SESSION, (sessionId) => sessionHandlers.handleAdminResolve(socket, sessionId));
        socket.on(IN.ADMIN_REOPEN_SESSION, (sessionId) => sessionHandlers.handleAdminReopen(socket, sessionId));
        socket.on(IN.ADMIN_CHANGE_STATUS, (data) => sessionHandlers.handleAdminChangeStatus(socket, data));

        // Customer session events
        socket.on(IN.SESSION_START, (data) => sessionHandlers.handleStartSession(socket, data));
        socket.on(IN.SESSION_RESUME, (sessionId) => sessionHandlers.handleResumeSession(socket, sessionId));
        socket.on(IN.SESSION_END, () => sessionHandlers.handleEndSession(socket));

        // Customer chat events
        socket.on(IN.CHAT_MESSAGE, (data) => chatHandlers.handleCustomerMessage(socket, data));
        socket.on(IN.CHAT_TYPING, (data) => chatHandlers.handleTyping(socket, data));

        // Disconnection
        socket.on(IN.DISCONNECT, () => {
            rateLimiter.releaseConnection(ip);

            if (socket.isAdmin) {
                adminSockets.delete(socket.id);
                if (socket.adminUser) {
                    console.log(`Admin ${socket.adminUser.username} disconnected`);
                }
            } else if (socket.sessionId) {
                sessionHandlers.handleDisconnect(socket);
            }
        });
    });

    // Return shared state for external access
    return {
        adminSockets,
        sessions,

        // Helper methods
        broadcastToAdmins: (event, data) => {
            for (const { socket } of adminSockets.values()) {
                socket.emit(event, data);
            }
        },

        getSessionCount: () => sessions.size,
        getAdminCount: () => adminSockets.size,

        // For testing/debugging
        getSession: (id) => sessions.get(id),
        getAdminSocket: (id) => adminSockets.get(id)
    };
}

module.exports = { setupSocketIO };
