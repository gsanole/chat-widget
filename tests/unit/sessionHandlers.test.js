/**
 * Unit tests for sessionHandlers (socket).
 *
 * NOTE: handleDisconnect uses a raw setTimeout(... , 5min) without .unref().
 * Tests touching disconnect MUST run under jest.useFakeTimers().
 */

// Mock the lazily-required database module used inside handleResumeSession
jest.mock('../../src/database', () => ({
    messages: { findByTicket: jest.fn(() => []) }
}));

const { createSessionHandlers } = require('../../src/socket/handlers/sessionHandlers');
const { OUT } = require('../../src/socket/events');
const dbMock = require('../../src/database');

function makeSocket(props = {}) {
    const emitted = [];
    return {
        id: 'sock_' + Math.random().toString(36).slice(2, 8),
        connected: true,
        isAdmin: false,
        sessionId: null,
        adminUser: null,
        ...props,
        emit: jest.fn(function (event, data) { emitted.push({ event, data }); }),
        join: jest.fn(),
        leave: jest.fn(),
        emitted
    };
}

function makeIO() {
    const broadcasts = [];
    return {
        to: jest.fn(function (room) {
            return {
                emit: jest.fn(function (event, data) {
                    broadcasts.push({ room, event, data });
                })
            };
        }),
        broadcasts
    };
}

function lastEmitted(socket, event) {
    return [...socket.emitted].reverse().find(e => e.event === event);
}

describe('sessionHandlers', () => {
    let deps, io, sessions, adminSockets, ticketRepo, siteRepo, chatbotService, generateId;

    beforeEach(() => {
        sessions = new Map();
        adminSockets = new Map();
        io = makeIO();
        ticketRepo = {
            findById: jest.fn(),
            create: jest.fn(),
            updateStatus: jest.fn(),
            updateActivity: jest.fn()
        };
        siteRepo = { findById: jest.fn() };
        chatbotService = { getConfig: jest.fn(() => ({ enabled: false })) };
        generateId = jest.fn(() => 'sess-new');
        dbMock.messages.findByTicket.mockClear();
        dbMock.messages.findByTicket.mockReturnValue([]);

        deps = {
            io,
            ticketRepository: ticketRepo,
            siteRepository: siteRepo,
            chatbotService,
            adminSockets,
            sessions,
            getRealIP: () => '127.0.0.1',
            analyzeIP: jest.fn(async () => ({ geo: { country: 'XX' } })),
            generateId
        };
    });

    // -----------------------------------------------------------------------
    // handleStartSession
    // -----------------------------------------------------------------------
    describe('handleStartSession', () => {
        test('creates session, joins room, persists ticket, and notifies customer + admins', async () => {
            const sock = makeSocket();
            const admin = makeSocket({ isAdmin: true });
            adminSockets.set(admin.id, { socket: admin });

            const h = createSessionHandlers(deps);
            await h.handleStartSession(sock, { name: 'Alice', location: 'NYC' });

            expect(generateId).toHaveBeenCalled();
            expect(sock.sessionId).toBe('sess-new');
            expect(sock.join).toHaveBeenCalledWith('chat:sess-new');
            expect(sessions.has('sess-new')).toBe(true);
            expect(ticketRepo.create).toHaveBeenCalledTimes(1);
            expect(ticketRepo.create.mock.calls[0][0].id).toBe('sess-new');

            expect(lastEmitted(sock, OUT.SESSION_STARTED).data.sessionId).toBe('sess-new');
            expect(lastEmitted(admin, OUT.SESSION_NEW).data.sessionId).toBe('sess-new');
        });

        test('rejects with ERROR when API key does not match site', async () => {
            siteRepo.findById.mockReturnValue({ id: 'site1', api_key: 'real-key' });
            const sock = makeSocket();
            const h = createSessionHandlers(deps);
            await h.handleStartSession(sock, {
                name: 'Bob', siteId: 'site1', apiKey: 'wrong'
            });
            expect(lastEmitted(sock, OUT.ERROR).data.message).toBe('Invalid API key');
            expect(sessions.size).toBe(0);
        });

        test('uses chatbot welcomeMessage when enabled', async () => {
            chatbotService.getConfig.mockReturnValue({
                enabled: true, welcomeMessage: 'Hello there!'
            });
            const sock = makeSocket();
            const h = createSessionHandlers(deps);
            await h.handleStartSession(sock, { name: 'Cara' });
            expect(lastEmitted(sock, OUT.SESSION_STARTED).data.welcomeMessage)
                .toBe('Hello there!');
        });

        test('continues even if analyzeIP throws', async () => {
            const spy = jest.spyOn(console, 'error').mockImplementation(() => { });
            deps.analyzeIP = jest.fn(async () => { throw new Error('geo down'); });
            const sock = makeSocket();
            const h = createSessionHandlers(deps);
            await h.handleStartSession(sock, { name: 'Dan' });
            expect(sessions.has('sess-new')).toBe(true);
            spy.mockRestore();
        });
    });

    // -----------------------------------------------------------------------
    // handleResumeSession
    // -----------------------------------------------------------------------
    describe('handleResumeSession', () => {
        test('resumes from in-memory session and broadcasts update', () => {
            const sock = makeSocket();
            sessions.set('s1', {
                sessionId: 's1',
                socket: makeSocket(),
                messages: [{ id: 'm1' }],
                lastActivity: 1
            });
            const admin = makeSocket({ isAdmin: true });
            adminSockets.set(admin.id, { socket: admin });

            const h = createSessionHandlers(deps);
            h.handleResumeSession(sock, 's1');

            expect(sock.join).toHaveBeenCalledWith('chat:s1');
            expect(sock.sessionId).toBe('s1');
            expect(lastEmitted(sock, OUT.SESSION_RESUMED).data.messages).toHaveLength(1);
            expect(lastEmitted(admin, OUT.SESSION_UPDATED)).toBeDefined();
        });

        test('restores from database when ticket exists and is not archived', () => {
            ticketRepo.findById.mockReturnValue({
                id: 's2',
                customer_name: 'Eve',
                customer_location: 'LA',
                customer_ip: '1.2.3.4',
                customer_contact: null,
                ip_analysis: { geo: { country: 'US' } },
                site_id: null,
                status: 'active',
                started_at: 1700000000
            });
            dbMock.messages.findByTicket.mockReturnValue([{ id: 'old' }]);

            const sock = makeSocket();
            const h = createSessionHandlers(deps);
            h.handleResumeSession(sock, 's2');

            expect(sessions.has('s2')).toBe(true);
            expect(dbMock.messages.findByTicket).toHaveBeenCalledWith('s2', 100);
            expect(lastEmitted(sock, OUT.SESSION_RESUMED).data.messages).toEqual([{ id: 'old' }]);
        });

        test('emits SESSION_NOT_FOUND when ticket missing', () => {
            ticketRepo.findById.mockReturnValue(null);
            const sock = makeSocket();
            const h = createSessionHandlers(deps);
            h.handleResumeSession(sock, 'nope');
            expect(lastEmitted(sock, OUT.SESSION_NOT_FOUND).data.sessionId).toBe('nope');
        });

        test('emits SESSION_NOT_FOUND when ticket is archived', () => {
            ticketRepo.findById.mockReturnValue({ id: 's3', status: 'archived' });
            const sock = makeSocket();
            const h = createSessionHandlers(deps);
            h.handleResumeSession(sock, 's3');
            expect(lastEmitted(sock, OUT.SESSION_NOT_FOUND)).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // handleEndSession
    // -----------------------------------------------------------------------
    describe('handleEndSession', () => {
        test('no-op when socket has no sessionId', () => {
            const sock = makeSocket();
            const h = createSessionHandlers(deps);
            h.handleEndSession(sock);
            expect(ticketRepo.updateStatus).not.toHaveBeenCalled();
        });

        test('marks session ended, updates ticket, emits SESSION_ENDED', () => {
            sessions.set('s1', { sessionId: 's1', status: 'active' });
            const sock = makeSocket({ sessionId: 's1' });
            const admin = makeSocket({ isAdmin: true });
            adminSockets.set(admin.id, { socket: admin });

            const h = createSessionHandlers(deps);
            h.handleEndSession(sock);

            expect(sessions.get('s1').status).toBe('ended');
            expect(ticketRepo.updateStatus).toHaveBeenCalledWith('s1', 'closed');
            expect(io.broadcasts.find(b => b.event === OUT.SESSION_ENDED)).toBeDefined();
            expect(lastEmitted(admin, OUT.SESSION_UPDATED).data.updates.status).toBe('ended');
            expect(sock.leave).toHaveBeenCalledWith('chat:s1');
            expect(sock.sessionId).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // handleDisconnect — needs fake timers because of 5-minute setTimeout
    // -----------------------------------------------------------------------
    describe('handleDisconnect', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        test('no-op when socket has no sessionId', () => {
            const sock = makeSocket();
            const h = createSessionHandlers(deps);
            h.handleDisconnect(sock);
            // no scheduled timers
            expect(jest.getTimerCount()).toBe(0);
        });

        test('marks disconnected and archives after 5 minutes', () => {
            sessions.set('s1', {
                sessionId: 's1', status: 'active', socket: makeSocket()
            });
            const sock = makeSocket({ sessionId: 's1' });
            const admin = makeSocket({ isAdmin: true });
            adminSockets.set(admin.id, { socket: admin });

            const h = createSessionHandlers(deps);
            h.handleDisconnect(sock);

            expect(sessions.get('s1').status).toBe('disconnected');
            expect(sessions.get('s1').socket).toBeNull();
            expect(lastEmitted(admin, OUT.SESSION_UPDATED).data.updates.status)
                .toBe('disconnected');

            // Fast-forward 5 minutes
            jest.advanceTimersByTime(5 * 60 * 1000);

            expect(sessions.has('s1')).toBe(false);
            expect(ticketRepo.updateStatus).toHaveBeenCalledWith('s1', 'abandoned');
            expect(lastEmitted(admin, OUT.SESSION_REMOVED).data.sessionId).toBe('s1');
        });

        test('does NOT archive if customer reconnected before timeout', () => {
            sessions.set('s1', {
                sessionId: 's1', status: 'active', socket: makeSocket()
            });
            const sock = makeSocket({ sessionId: 's1' });
            const h = createSessionHandlers(deps);
            h.handleDisconnect(sock);

            // Simulate reconnection: status goes back to active and socket is restored
            const live = sessions.get('s1');
            live.status = 'active';
            live.socket = makeSocket();

            jest.advanceTimersByTime(5 * 60 * 1000);

            expect(sessions.has('s1')).toBe(true);
            expect(ticketRepo.updateStatus).not.toHaveBeenCalledWith('s1', 'abandoned');
        });
    });

    // -----------------------------------------------------------------------
    // handleAdminClose
    // -----------------------------------------------------------------------
    describe('handleAdminClose', () => {
        test('non-admin is ignored', () => {
            sessions.set('s1', { sessionId: 's1' });
            const sock = makeSocket();
            const h = createSessionHandlers(deps);
            h.handleAdminClose(sock, 's1');
            expect(ticketRepo.updateStatus).not.toHaveBeenCalled();
        });

        test('emits SESSION_CLOSED_BY_ADMIN to customer and updates admins', () => {
            const customer = makeSocket();
            sessions.set('s1', { sessionId: 's1', socket: customer, status: 'active' });
            const adminSock = makeSocket({
                isAdmin: true,
                adminUser: { username: 'mod' }
            });
            adminSockets.set(adminSock.id, { socket: adminSock });

            const h = createSessionHandlers(deps);
            h.handleAdminClose(adminSock, 's1');

            expect(sessions.get('s1').status).toBe('closed');
            expect(lastEmitted(customer, OUT.SESSION_CLOSED_BY_ADMIN)).toBeDefined();
            expect(ticketRepo.updateStatus).toHaveBeenCalledWith('s1', 'closed');
            expect(lastEmitted(adminSock, OUT.SESSION_UPDATED).data.updates.status).toBe('closed');
        });
    });

    // -----------------------------------------------------------------------
    // handleAdminArchive
    // -----------------------------------------------------------------------
    describe('handleAdminArchive', () => {
        test('non-admin is ignored', () => {
            sessions.set('s1', { sessionId: 's1' });
            const sock = makeSocket();
            const h = createSessionHandlers(deps);
            h.handleAdminArchive(sock, 's1');
            expect(ticketRepo.updateStatus).not.toHaveBeenCalled();
            expect(sessions.has('s1')).toBe(true);
        });

        test('removes from active sessions and archives ticket', () => {
            sessions.set('s1', { sessionId: 's1' });
            const adminSock = makeSocket({
                isAdmin: true, adminUser: { username: 'mod' }
            });
            adminSockets.set(adminSock.id, { socket: adminSock });

            const h = createSessionHandlers(deps);
            h.handleAdminArchive(adminSock, 's1');

            expect(sessions.has('s1')).toBe(false);
            expect(ticketRepo.updateStatus).toHaveBeenCalledWith('s1', 'archived');
            expect(lastEmitted(adminSock, OUT.SESSION_REMOVED)).toBeDefined();
        });

        test('archives ticket even when not in memory', () => {
            const adminSock = makeSocket({
                isAdmin: true, adminUser: { username: 'mod' }
            });
            adminSockets.set(adminSock.id, { socket: adminSock });

            const h = createSessionHandlers(deps);
            h.handleAdminArchive(adminSock, 'gone');

            expect(ticketRepo.updateStatus).toHaveBeenCalledWith('gone', 'archived');
            expect(lastEmitted(adminSock, OUT.SESSION_REMOVED).data.sessionId).toBe('gone');
        });
    });
});
