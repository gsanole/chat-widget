/**
 * Tests for src/socket/index.js setupSocketIO wiring.
 * Boosts socket/index.js coverage (function% especially).
 */

const { setupSocketIO } = require('../../src/socket');
const { IN } = require('../../src/socket/events');

function makeFakeIo() {
    const handlers = {};
    return {
        on: jest.fn((event, cb) => { handlers[event] = cb; }),
        to: jest.fn().mockReturnValue({ emit: jest.fn() }),
        emit: jest.fn(),
        sockets: { sockets: new Map() },
        _trigger: (event, ...args) => handlers[event] && handlers[event](...args),
        _handlers: handlers
    };
}

function makeFakeSocket(id = 's1') {
    const socketHandlers = {};
    const socket = {
        id,
        handshake: { address: '1.2.3.4', headers: {} },
        request: { connection: { remoteAddress: '1.2.3.4' } },
        on: jest.fn((event, cb) => { socketHandlers[event] = cb; }),
        emit: jest.fn(),
        disconnect: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        _trigger: (event, ...args) => socketHandlers[event] && socketHandlers[event](...args),
        _handlers: socketHandlers
    };
    return socket;
}

function makeDeps() {
    return {
        authService: { authenticate: jest.fn(), verifyToken: jest.fn() },
        ticketRepository: {
            findById: jest.fn(),
            findAll: jest.fn(() => []),
            create: jest.fn(),
            updateStatus: jest.fn(),
            findOpen: jest.fn(() => [])
        },
        messageRepository: {
            create: jest.fn(),
            findByTicket: jest.fn(() => [])
        },
        userRepository: { findById: jest.fn(), findAll: jest.fn(() => []) },
        sessionRepository: {
            findByToken: jest.fn(),
            create: jest.fn(),
            delete: jest.fn(),
            updateActivity: jest.fn()
        },
        auditRepository: { log: jest.fn() },
        siteRepository: { findById: jest.fn(), findByDomain: jest.fn() },
        chatbotService: {
            getConfig: jest.fn(() => ({ enabled: true })),
            getWelcomeMessage: jest.fn(() => 'hi')
        },
        totp: { verify: jest.fn(), generateSecret: jest.fn() },
        hasPermission: jest.fn(() => true),
        getRealIP: jest.fn(() => '1.2.3.4'),
        analyzeIP: jest.fn(() => ({ private: false })),
        generateId: jest.fn(() => 'gen-id')
    };
}

describe('setupSocketIO', () => {
    let logSpy;
    beforeAll(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => { }); });
    afterAll(() => { logSpy.mockRestore(); });

    test('returns shared state with helper methods', () => {
        const io = makeFakeIo();
        const result = setupSocketIO(io, makeDeps());

        expect(result).toHaveProperty('adminSockets');
        expect(result).toHaveProperty('sessions');
        expect(typeof result.broadcastToAdmins).toBe('function');
        expect(typeof result.getSessionCount).toBe('function');
        expect(typeof result.getAdminCount).toBe('function');
        expect(typeof result.getSession).toBe('function');
        expect(typeof result.getAdminSocket).toBe('function');
        expect(io.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    test('helper methods reflect state', () => {
        const io = makeFakeIo();
        const result = setupSocketIO(io, makeDeps());

        expect(result.getSessionCount()).toBe(0);
        expect(result.getAdminCount()).toBe(0);
        expect(result.getSession('nope')).toBeUndefined();
        expect(result.getAdminSocket('nope')).toBeUndefined();

        // populate manually and verify
        const fakeAdminSock = { emit: jest.fn() };
        result.adminSockets.set('a1', { socket: fakeAdminSock });
        result.sessions.set('s1', { id: 's1' });
        expect(result.getAdminCount()).toBe(1);
        expect(result.getSessionCount()).toBe(1);
        expect(result.getAdminSocket('a1')).toBeDefined();
        expect(result.getSession('s1')).toEqual({ id: 's1' });

        result.broadcastToAdmins('event', { x: 1 });
        expect(fakeAdminSock.emit).toHaveBeenCalledWith('event', { x: 1 });
    });

    test('connection callback registers all socket events', () => {
        const io = makeFakeIo();
        setupSocketIO(io, makeDeps());

        const socket = makeFakeSocket();
        io._trigger('connection', socket);

        // Should register a bunch of handlers
        expect(socket.on).toHaveBeenCalledWith(IN.ADMIN_AUTH, expect.any(Function));
        expect(socket.on).toHaveBeenCalledWith(IN.ADMIN_TOKEN_AUTH, expect.any(Function));
        expect(socket.on).toHaveBeenCalledWith(IN.ADMIN_LOGOUT, expect.any(Function));
        expect(socket.on).toHaveBeenCalledWith(IN.SESSION_START, expect.any(Function));
        expect(socket.on).toHaveBeenCalledWith(IN.CHAT_MESSAGE, expect.any(Function));
        expect(socket.on).toHaveBeenCalledWith(IN.DISCONNECT, expect.any(Function));
    });

    test('rate-limited connection emits error and disconnects', () => {
        const io = makeFakeIo();
        const deps = makeDeps();
        // Force getRealIP to same IP and trigger > 10 connections
        setupSocketIO(io, deps);
        for (let i = 0; i < 10; i++) {
            io._trigger('connection', makeFakeSocket(`s${i}`));
        }
        const blocked = makeFakeSocket('s-blocked');
        io._trigger('connection', blocked);
        expect(blocked.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringMatching(/Too many/i) }));
        expect(blocked.disconnect).toHaveBeenCalledWith(true);
    });

    test('disconnect handler: admin path cleans adminSockets', () => {
        const io = makeFakeIo();
        const result = setupSocketIO(io, makeDeps());
        const socket = makeFakeSocket('admin-1');
        io._trigger('connection', socket);

        // Mark socket as admin and add to map
        socket.isAdmin = true;
        socket.adminUser = { username: 'alice' };
        result.adminSockets.set('admin-1', { socket });

        socket._trigger(IN.DISCONNECT);
        expect(result.adminSockets.has('admin-1')).toBe(false);
    });

    test('disconnect handler: customer path delegates to sessionHandlers', () => {
        jest.useFakeTimers();
        try {
            const io = makeFakeIo();
            const result = setupSocketIO(io, makeDeps());
            const socket = makeFakeSocket('cust-1');
            io._trigger('connection', socket);

            // Mark with sessionId
            socket.sessionId = 'sess-x';
            result.sessions.set('sess-x', { id: 'sess-x', socketId: 'cust-1' });

            // Should not throw — sessionHandlers.handleDisconnect schedules a setTimeout we don't want lingering
            expect(() => socket._trigger(IN.DISCONNECT)).not.toThrow();
            jest.clearAllTimers();
        } finally {
            jest.useRealTimers();
        }
    });

    test('disconnect handler: neither admin nor session is a no-op', () => {
        const io = makeFakeIo();
        setupSocketIO(io, makeDeps());
        const socket = makeFakeSocket('anon');
        io._trigger('connection', socket);
        expect(() => socket._trigger(IN.DISCONNECT)).not.toThrow();
    });
});
