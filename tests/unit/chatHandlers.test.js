/**
 * Unit tests for chatHandlers (socket).
 *
 * Pure unit tests — no real Socket.IO server. Sockets, IO, and repos
 * are minimal fakes capturing emitted events.
 */

const { createChatHandlers } = require('../../src/socket/handlers/chatHandlers');
const { OUT } = require('../../src/socket/events');

function makeSocket(props = {}) {
    const emitted = [];
    const joined = [];
    const left = [];
    return {
        id: props.id || 'socket_' + Math.random().toString(36).slice(2, 8),
        connected: true,
        isAdmin: false,
        sessionId: null,
        adminUser: null,
        ...props,
        emit: jest.fn(function (event, data) { emitted.push({ event, data }); }),
        join: jest.fn(function (room) { joined.push(room); }),
        leave: jest.fn(function (room) { left.push(room); }),
        emitted,
        joined,
        left
    };
}

function makeIO() {
    const broadcasts = [];
    const rooms = new Map();
    return {
        sockets: { adapter: { rooms } },
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

describe('chatHandlers', () => {
    let deps, sessions, adminSockets, io, msgRepo, ticketRepo;

    beforeEach(() => {
        sessions = new Map();
        adminSockets = new Map();
        io = makeIO();
        msgRepo = {
            findByTicket: jest.fn(() => [{ id: 'm1', message: 'hi' }]),
            create: jest.fn()
        };
        ticketRepo = {
            findById: jest.fn(),
            updateLastMessage: jest.fn()
        };
        deps = {
            io,
            messageRepository: msgRepo,
            ticketRepository: ticketRepo,
            adminSockets,
            sessions,
            getRealIP: () => '127.0.0.1',
            hasPermission: jest.fn(() => true)
        };
    });

    // -----------------------------------------------------------------------
    // handleAdminJoin
    // -----------------------------------------------------------------------
    describe('handleAdminJoin', () => {
        test('rejects non-admins with ERROR', () => {
            const h = createChatHandlers(deps);
            const sock = makeSocket();
            h.handleAdminJoin(sock, 'sess-1');
            expect(lastEmitted(sock, OUT.ERROR).data.message).toBe('Unauthorized');
        });

        test('joins active session, marks joined, sends history, broadcasts update', () => {
            const customer = makeSocket({ id: 'cust-1' });
            sessions.set('sess-1', {
                sessionId: 'sess-1',
                socket: customer,
                hasAdminJoined: false,
                unreadCount: 5
            });
            const adminSock = makeSocket({
                isAdmin: true,
                adminUser: { nickname: 'Bob', role: 'support' }
            });
            adminSockets.set(adminSock.id, { socket: adminSock });

            const h = createChatHandlers(deps);
            h.handleAdminJoin(adminSock, 'sess-1');

            expect(adminSock.joined).toContain('chat:sess-1');
            const session = sessions.get('sess-1');
            expect(session.hasAdminJoined).toBe(true);
            expect(session.unreadCount).toBe(0);

            const customerNotified = lastEmitted(customer, OUT.ADMIN_JOINED);
            expect(customerNotified.data.adminNickname).toBe('Bob');

            const history = lastEmitted(adminSock, OUT.CHAT_HISTORY);
            expect(history.data.sessionId).toBe('sess-1');
            expect(msgRepo.findByTicket).toHaveBeenCalledWith('sess-1', 100);

            // Broadcast went out via broadcastToAdmins (admin's own socket is in the map).
            const broadcast = lastEmitted(adminSock, OUT.SESSION_UPDATED);
            expect(broadcast.data.updates.hasAdminJoined).toBe(true);
        });

        test('falls back to ticketRepository when not in active sessions', () => {
            ticketRepo.findById.mockReturnValue({ id: 'sess-2' });
            const adminSock = makeSocket({ isAdmin: true });

            const h = createChatHandlers(deps);
            h.handleAdminJoin(adminSock, 'sess-2');

            expect(adminSock.joined).toContain('chat:sess-2');
            expect(lastEmitted(adminSock, OUT.CHAT_HISTORY)).toBeDefined();
        });

        test('emits ERROR Session not found when ticket also missing', () => {
            ticketRepo.findById.mockReturnValue(null);
            const adminSock = makeSocket({ isAdmin: true });

            const h = createChatHandlers(deps);
            h.handleAdminJoin(adminSock, 'sess-x');

            expect(lastEmitted(adminSock, OUT.ERROR).data.message).toBe('Session not found');
        });
    });

    // -----------------------------------------------------------------------
    // handleAdminLeave
    // -----------------------------------------------------------------------
    describe('handleAdminLeave', () => {
        test('does nothing for non-admins', () => {
            const h = createChatHandlers(deps);
            const sock = makeSocket();
            h.handleAdminLeave(sock, 'sess-1');
            expect(sock.left).toEqual([]);
        });

        test('marks hasAdminJoined=false when last admin leaves', () => {
            const adminSock = makeSocket({ isAdmin: true });
            adminSockets.set(adminSock.id, { socket: adminSock });
            sessions.set('sess-1', { sessionId: 'sess-1', hasAdminJoined: true });
            // Empty room -> no other admin
            io.sockets.adapter.rooms.set('chat:sess-1', new Set());

            const h = createChatHandlers(deps);
            h.handleAdminLeave(adminSock, 'sess-1');

            expect(adminSock.left).toContain('chat:sess-1');
            expect(sessions.get('sess-1').hasAdminJoined).toBe(false);
            expect(lastEmitted(adminSock, OUT.SESSION_UPDATED).data.updates.hasAdminJoined).toBe(false);
        });

        test('keeps hasAdminJoined=true when another admin remains in room', () => {
            const a1 = makeSocket({ id: 'a1', isAdmin: true });
            const a2 = makeSocket({ id: 'a2', isAdmin: true });
            adminSockets.set('a1', { socket: a1 });
            adminSockets.set('a2', { socket: a2 });
            sessions.set('sess-1', { sessionId: 'sess-1', hasAdminJoined: true });
            io.sockets.adapter.rooms.set('chat:sess-1', new Set(['a2']));

            const h = createChatHandlers(deps);
            h.handleAdminLeave(a1, 'sess-1');

            expect(sessions.get('sess-1').hasAdminJoined).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // handleAdminMessage
    // -----------------------------------------------------------------------
    describe('handleAdminMessage', () => {
        test('rejects non-admins', () => {
            const h = createChatHandlers(deps);
            const sock = makeSocket();
            h.handleAdminMessage(sock, { sessionId: 's1', message: 'hi' });
            expect(lastEmitted(sock, OUT.ERROR).data.message).toBe('Unauthorized');
        });

        test('rejects when sessionId or message missing', () => {
            const h = createChatHandlers(deps);
            const sock = makeSocket({ isAdmin: true, adminUser: { role: 'support' } });
            h.handleAdminMessage(sock, { sessionId: 's1' });
            expect(lastEmitted(sock, OUT.ERROR).data.message)
                .toBe('Session ID and message are required');
        });

        test('rejects when admin lacks reply_chats permission', () => {
            deps.hasPermission = jest.fn(() => false);
            const h = createChatHandlers(deps);
            const sock = makeSocket({ isAdmin: true, adminUser: { role: 'viewer' } });
            h.handleAdminMessage(sock, { sessionId: 's1', message: 'hi' });
            expect(lastEmitted(sock, OUT.ERROR).data.message)
                .toBe('No permission to reply to chats');
            expect(msgRepo.create).not.toHaveBeenCalled();
        });

        test('persists message, emits to customer, broadcasts to room and admins', () => {
            const customer = makeSocket({ id: 'cust' });
            sessions.set('s1', {
                sessionId: 's1', socket: customer, lastActivity: 0
            });
            const admin = makeSocket({
                isAdmin: true,
                adminUser: { id: 'a1', username: 'admin1', nickname: 'Admin', role: 'support' }
            });
            adminSockets.set(admin.id, { socket: admin });

            const h = createChatHandlers(deps);
            h.handleAdminMessage(admin, { sessionId: 's1', message: 'hello world' });

            expect(msgRepo.create).toHaveBeenCalledTimes(1);
            const saved = msgRepo.create.mock.calls[0][0];
            expect(saved.sender).toBe('admin');
            expect(saved.message).toBe('hello world');

            expect(ticketRepo.updateLastMessage).toHaveBeenCalledWith('s1');

            // Customer got CHAT_MESSAGE
            expect(lastEmitted(customer, OUT.CHAT_MESSAGE)).toBeDefined();
            // Room broadcast
            expect(io.broadcasts.find(b => b.room === 'chat:s1' && b.event === OUT.CHAT_MESSAGE))
                .toBeDefined();
            // Admin broadcast
            expect(lastEmitted(admin, OUT.SESSION_UPDATED)).toBeDefined();
        });

        test('falls back to ticketId when sessionId is absent', () => {
            const admin = makeSocket({
                isAdmin: true,
                adminUser: { role: 'support' }
            });
            adminSockets.set(admin.id, { socket: admin });

            const h = createChatHandlers(deps);
            h.handleAdminMessage(admin, { ticketId: 't9', message: 'hi' });

            expect(msgRepo.create).toHaveBeenCalled();
            expect(msgRepo.create.mock.calls[0][0].ticketId).toBe('t9');
        });
    });

    // -----------------------------------------------------------------------
    // handleCustomerMessage
    // -----------------------------------------------------------------------
    describe('handleCustomerMessage', () => {
        test('emits ERROR when session unknown', () => {
            const sock = makeSocket({ sessionId: 'gone' });
            const h = createChatHandlers(deps);
            h.handleCustomerMessage(sock, { message: 'hi' });
            expect(lastEmitted(sock, OUT.ERROR).data.message).toBe('Session not found');
        });

        test('emits ERROR when message missing', () => {
            const sock = makeSocket({ sessionId: 's1' });
            sessions.set('s1', { sessionId: 's1', name: 'C', messages: [], unreadCount: 0 });
            const h = createChatHandlers(deps);
            h.handleCustomerMessage(sock, {});
            expect(lastEmitted(sock, OUT.ERROR).data.message).toBe('Message is required');
        });

        test('saves message, increments unread when no admin joined, sends new-message broadcast', () => {
            const sock = makeSocket({ sessionId: 's1' });
            sessions.set('s1', {
                sessionId: 's1',
                name: 'Customer',
                messages: [],
                unreadCount: 0,
                hasAdminJoined: false
            });
            const admin = makeSocket({ isAdmin: true });
            adminSockets.set(admin.id, { socket: admin });

            const h = createChatHandlers(deps);
            h.handleCustomerMessage(sock, { message: 'help' });

            expect(msgRepo.create).toHaveBeenCalledTimes(1);
            const session = sessions.get('s1');
            expect(session.unreadCount).toBe(1);
            expect(session.messages).toHaveLength(1);

            // Room broadcast of CHAT_MESSAGE
            expect(io.broadcasts.find(b => b.event === OUT.CHAT_MESSAGE)).toBeDefined();
            // Admin notifications
            expect(lastEmitted(admin, OUT.SESSION_UPDATED)).toBeDefined();
            expect(lastEmitted(admin, OUT.SESSION_NEW_MESSAGE)).toBeDefined();
            // Ack to customer
            expect(lastEmitted(sock, OUT.CHAT_MESSAGE_SENT)).toBeDefined();
        });

        test('does not send new-message broadcast when admin already joined', () => {
            const sock = makeSocket({ sessionId: 's1' });
            sessions.set('s1', {
                sessionId: 's1',
                name: 'C',
                messages: [],
                unreadCount: 0,
                hasAdminJoined: true
            });
            const admin = makeSocket({ isAdmin: true });
            adminSockets.set(admin.id, { socket: admin });

            const h = createChatHandlers(deps);
            h.handleCustomerMessage(sock, { message: 'hi' });

            expect(lastEmitted(admin, OUT.SESSION_NEW_MESSAGE)).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // handleTyping
    // -----------------------------------------------------------------------
    describe('handleTyping', () => {
        test('admin typing notifies the customer', () => {
            const customer = makeSocket();
            sessions.set('s1', { sessionId: 's1', socket: customer });
            const admin = makeSocket({ isAdmin: true });
            const h = createChatHandlers(deps);
            h.handleTyping(admin, { sessionId: 's1', isTyping: true });
            expect(lastEmitted(customer, OUT.ADMIN_TYPING).data.isTyping).toBe(true);
        });

        test('customer typing broadcasts to chat room', () => {
            const sock = makeSocket({ sessionId: 's1' });
            const h = createChatHandlers(deps);
            h.handleTyping(sock, { isTyping: false });
            const broadcast = io.broadcasts.find(b => b.event === OUT.CUSTOMER_TYPING);
            expect(broadcast).toBeDefined();
            expect(broadcast.room).toBe('chat:s1');
            expect(broadcast.data.isTyping).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // handleMarkRead
    // -----------------------------------------------------------------------
    describe('handleMarkRead', () => {
        test('non-admin is ignored', () => {
            const sock = makeSocket();
            sessions.set('s1', { sessionId: 's1', unreadCount: 3 });
            const h = createChatHandlers(deps);
            h.handleMarkRead(sock, { sessionId: 's1' });
            expect(sessions.get('s1').unreadCount).toBe(3);
        });

        test('zeros unread and broadcasts update', () => {
            sessions.set('s1', { sessionId: 's1', unreadCount: 7 });
            const admin = makeSocket({ isAdmin: true });
            adminSockets.set(admin.id, { socket: admin });
            const h = createChatHandlers(deps);
            h.handleMarkRead(admin, { sessionId: 's1' });
            expect(sessions.get('s1').unreadCount).toBe(0);
            expect(lastEmitted(admin, OUT.SESSION_UPDATED).data.updates.unreadCount).toBe(0);
        });
    });
});
