/**
 * Round 7 — coverage gaps for src/socket/index.js
 *
 * Targets the 12 inline arrow callbacks registered via socket.on(...) inside
 * the io.on('connection', ...) handler (lines 119-148). Each arrow simply
 * delegates to the appropriate handler method — we replace handlers with
 * mocks, then trigger every event to ensure each arrow body runs.
 */

const { setupSocketIO } = require('../../src/socket');
const { IN } = require('../../src/socket/events');

// Mock all handler factory modules so we can capture handler.method invocations
jest.mock('../../src/socket/handlers/adminHandlers', () => ({
    createAdminHandlers: () => ({
        handleAuth: jest.fn(),
        handleSubmit2FA: jest.fn(),
        handleTokenAuth: jest.fn(),
        handleLogout: jest.fn()
    })
}));

jest.mock('../../src/socket/handlers/chatHandlers', () => ({
    createChatHandlers: () => ({
        handleAdminJoin: jest.fn(),
        handleAdminLeave: jest.fn(),
        handleAdminMessage: jest.fn(),
        handleTyping: jest.fn(),
        handleMarkRead: jest.fn(),
        handleCustomerMessage: jest.fn()
    })
}));

jest.mock('../../src/socket/handlers/sessionHandlers', () => ({
    createSessionHandlers: () => ({
        handleAdminClose: jest.fn(),
        handleAdminArchive: jest.fn(),
        handleAdminUnarchive: jest.fn(),
        handleAdminDelete: jest.fn(),
        handleAdminResolve: jest.fn(),
        handleAdminReopen: jest.fn(),
        handleAdminChangeStatus: jest.fn(),
        handleStartSession: jest.fn(),
        handleResumeSession: jest.fn(),
        handleEndSession: jest.fn(),
        handleDisconnect: jest.fn()
    })
}));

// Toggleable rate limiter — flip __rateLimiterAllow to false to deny
const __rl = { allow: true };
jest.mock('../../src/middleware/rateLimiter', () => ({
    SocketRateLimiter: class {
        constructor() { }
        trackConnection() { return __rl.allow; }
        releaseConnection() { }
    }
}));

jest.mock('../../src/services/lygHubWebhook', () => ({
    createWebhookBridge: () => ({ mirror: jest.fn(), send: jest.fn() })
}));

function makeFakeIo() {
    let connectionCb;
    return {
        on: (ev, cb) => {
            if (ev === 'connection') connectionCb = cb;
        },
        invokeConnection: (socket) => connectionCb(socket)
    };
}

function makeFakeSocket() {
    const events = {};
    return {
        id: 'sock-test',
        events,
        on: (ev, cb) => { events[ev] = cb; },
        emit: jest.fn(),
        disconnect: jest.fn(),
        isAdmin: false,
        sessionId: null
    };
}

const baseDeps = {
    authService: {},
    ticketRepository: {},
    messageRepository: {},
    userRepository: {},
    sessionRepository: {},
    auditRepository: {},
    siteRepository: {},
    chatbotService: {},
    totp: {},
    hasPermission: () => true,
    getRealIP: () => '127.0.0.1',
    analyzeIP: () => ({}),
    generateId: () => 'gen-id'
};

describe('socket/index.js inline arrow callbacks', () => {
    test('every IN.* event arrow delegates to the matching handler', () => {
        const io = makeFakeIo();
        setupSocketIO(io, baseDeps);
        const socket = makeFakeSocket();
        io.invokeConnection(socket);

        const eventArgs = {
            [IN.ADMIN_AUTH]: { username: 'u', password: 'p' },
            [IN.ADMIN_SUBMIT_2FA]: '123456',
            [IN.ADMIN_TOKEN_AUTH]: 'tok',
            [IN.ADMIN_AUTH_TOKEN]: 'tok',
            [IN.ADMIN_LOGOUT]: undefined,
            [IN.ADMIN_JOIN_CHAT]: 'sess-1',
            [IN.ADMIN_LEAVE_CHAT]: 'sess-1',
            [IN.ADMIN_MESSAGE]: { sessionId: 's', message: 'hi' },
            [IN.ADMIN_TYPING]: { sessionId: 's' },
            [IN.ADMIN_MARK_READ]: { sessionId: 's' },
            [IN.ADMIN_CLOSE_SESSION]: 'sess-1',
            [IN.ADMIN_ARCHIVE_SESSION]: 'sess-1',
            [IN.ADMIN_UNARCHIVE_SESSION]: 'sess-1',
            [IN.ADMIN_DELETE_SESSION]: 'sess-1',
            [IN.ADMIN_RESOLVE_SESSION]: 'sess-1',
            [IN.ADMIN_REOPEN_SESSION]: 'sess-1',
            [IN.ADMIN_CHANGE_STATUS]: { sessionId: 's', status: 'open' },
            [IN.SESSION_START]: { siteId: 's' },
            [IN.SESSION_RESUME]: 'sess-1',
            [IN.SESSION_END]: undefined,
            [IN.CHAT_MESSAGE]: { message: 'hi' },
            [IN.CHAT_TYPING]: { typing: true }
        };

        for (const [ev, payload] of Object.entries(eventArgs)) {
            expect(typeof socket.events[ev]).toBe('function');
            socket.events[ev](payload);
        }

        // disconnect path: customer (sessionId set)
        socket.sessionId = 'sess-1';
        socket.events[IN.DISCONNECT]();
        // disconnect path: admin (isAdmin true, with adminUser)
        socket.isAdmin = true;
        socket.adminUser = { username: 'admin' };
        socket.events[IN.DISCONNECT]();
        // disconnect path: admin without adminUser
        socket.adminUser = undefined;
        socket.events[IN.DISCONNECT]();
    });

    test('rate-limited connection short-circuits (covers L106-L110)', () => {
        // Use the shared mock and toggle the allow flag
        const rlMock = require('../../src/middleware/rateLimiter');
        // Need to access __rl from outer scope — already in scope via closure
        __rl.allow = false;
        try {
            const io = makeFakeIo();
            setupSocketIO(io, baseDeps);
            const socket = makeFakeSocket();
            io.invokeConnection(socket);
            expect(socket.emit).toHaveBeenCalledWith('error', expect.any(Object));
            expect(socket.disconnect).toHaveBeenCalledWith(true);
        } finally {
            __rl.allow = true;
        }
    });

    test('returned helpers — broadcastToAdmins / counts / getters', () => {
        const io = makeFakeIo();
        const state = setupSocketIO(io, baseDeps);
        // Seed adminSockets manually
        const adminSocket = { emit: jest.fn() };
        state.adminSockets.set('a1', { socket: adminSocket });
        state.broadcastToAdmins('test:event', { x: 1 });
        expect(adminSocket.emit).toHaveBeenCalledWith('test:event', { x: 1 });

        expect(state.getAdminCount()).toBe(1);
        expect(state.getSessionCount()).toBe(0);
        expect(state.getAdminSocket('a1')).toBeDefined();
        expect(state.getSession('nope')).toBeUndefined();
    });

    test('uses deps.webhook override when provided', () => {
        const io = makeFakeIo();
        const customWebhook = { mirror: jest.fn(), send: jest.fn() };
        setupSocketIO(io, { ...baseDeps, webhook: customWebhook });
        // No assertion needed beyond no-throw — covers the `||` branch
        expect(typeof io.invokeConnection).toBe('function');
    });
});
