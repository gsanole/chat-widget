/**
 * Integration: chat & session handlers fire lyg_hub webhook on the
 * right events with the right payload shape. The lygHub send() is
 * stubbed; we only verify what the handlers produce, not the network.
 */

const { createChatHandlers } = require('../../src/socket/handlers/chatHandlers');
const { createSessionHandlers } = require('../../src/socket/handlers/sessionHandlers');

function makeSocket(props = {}) {
    return {
        id: 'sock_' + Math.random().toString(36).slice(2, 8),
        connected: true,
        isAdmin: false,
        join: jest.fn(),
        leave: jest.fn(),
        disconnect: jest.fn(),
        emit: jest.fn(),
        ...props
    };
}

function makeLygHubStub() {
    let counter = 0;
    return {
        enabled: true,
        endpoint: 'https://hub.test/inbound/chat',
        send: jest.fn().mockResolvedValue({ ok: true }),
        genMessageId: jest.fn(() => `msg-${++counter}`)
    };
}

// Wait one microtask flush so fire-and-forget Promise chains run.
const flush = () => new Promise(r => setImmediate(r));

describe('lyg_hub bridge — handler integration', () => {
    let lygHub;
    let sessions;
    let adminSockets;
    let messageRepo;
    let ticketRepo;
    let chatbotService;
    let io;

    beforeEach(() => {
        lygHub = makeLygHubStub();
        sessions = new Map();
        adminSockets = new Map();
        messageRepo = { create: jest.fn(), findByTicket: jest.fn(() => []) };
        ticketRepo = {
            create: jest.fn(),
            findById: jest.fn(),
            updateLastMessage: jest.fn(),
            updateStatus: jest.fn()
        };
        chatbotService = {
            getConfig: jest.fn(() => ({ escalationKeywords: ['human', 'agent'] })),
            _matchesEscalation: jest.fn((msg, cfg) =>
                (cfg.escalationKeywords || []).some(k => msg.includes(k))
            )
        };
        io = {
            to: jest.fn(() => ({
                emit: jest.fn(),
                except: jest.fn(() => ({ emit: jest.fn() }))
            })),
            sockets: { adapter: { rooms: new Map() } }
        };
    });

    // -----------------------------------------------------------------------
    // chatHandlers — customer message
    // -----------------------------------------------------------------------
    test('customer message fires event=message, from=customer, escalate=false', async () => {
        const handlers = createChatHandlers({
            io, messageRepository: messageRepo, ticketRepository: ticketRepo,
            adminSockets, sessions,
            getRealIP: () => '10.0.0.1', hasPermission: () => true,
            chatbotService, lygHub
        });

        const sessionId = 'sess-A';
        sessions.set(sessionId, {
            sessionId, name: 'Visitor One', siteApiKey: 'sk-site-a',
            messages: [], hasAdminJoined: false, unreadCount: 0,
            socket: null
        });

        const sock = makeSocket({ sessionId });
        handlers.handleCustomerMessage(sock, { message: 'hello there' });

        await flush();

        expect(lygHub.send).toHaveBeenCalledTimes(1);
        const payload = lygHub.send.mock.calls[0][0];
        expect(payload).toMatchObject({
            event: 'message',
            from: 'customer',
            sessionId,
            siteApiKey: 'sk-site-a',
            senderId: sessionId,
            senderName: 'Visitor One',
            text: 'hello there',
            escalate: false
        });
        expect(payload.messageId).toMatch(/^msg-\d+$/);
        expect(typeof payload.ts).toBe('number');
    });

    test('customer message with escalation keyword fires escalate=true', async () => {
        const handlers = createChatHandlers({
            io, messageRepository: messageRepo, ticketRepository: ticketRepo,
            adminSockets, sessions,
            getRealIP: () => '10.0.0.1', hasPermission: () => true,
            chatbotService, lygHub
        });

        const sessionId = 'sess-B';
        sessions.set(sessionId, {
            sessionId, name: 'Visitor Two', siteApiKey: 'sk-site-b',
            messages: [], hasAdminJoined: false, unreadCount: 0, socket: null
        });

        const sock = makeSocket({ sessionId });
        handlers.handleCustomerMessage(sock, { message: 'I need a human now' });

        await flush();

        expect(lygHub.send).toHaveBeenCalledTimes(1);
        expect(lygHub.send.mock.calls[0][0].escalate).toBe(true);
    });

    test('customer message swallows webhook errors without breaking chat', async () => {
        lygHub.send.mockRejectedValue(new Error('boom'));
        const handlers = createChatHandlers({
            io, messageRepository: messageRepo, ticketRepository: ticketRepo,
            adminSockets, sessions,
            getRealIP: () => '10.0.0.1', hasPermission: () => true,
            chatbotService, lygHub
        });

        const sessionId = 'sess-C';
        sessions.set(sessionId, {
            sessionId, name: 'Visitor Three', siteApiKey: null,
            messages: [], hasAdminJoined: false, unreadCount: 0, socket: null
        });

        const sock = makeSocket({ sessionId });
        // Must not throw.
        expect(() =>
            handlers.handleCustomerMessage(sock, { message: 'hi' })
        ).not.toThrow();

        await flush();
        // Customer was still acknowledged.
        expect(sock.emit).toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // chatHandlers — admin message
    // -----------------------------------------------------------------------
    test('admin message fires event=message, from=agent, escalate=false', async () => {
        const handlers = createChatHandlers({
            io, messageRepository: messageRepo, ticketRepository: ticketRepo,
            adminSockets, sessions,
            getRealIP: () => '10.0.0.1', hasPermission: () => true,
            chatbotService, lygHub
        });

        const sessionId = 'sess-D';
        sessions.set(sessionId, {
            sessionId, name: 'Visitor Four', siteApiKey: 'sk-d',
            messages: [], hasAdminJoined: true, unreadCount: 0, socket: null
        });

        const adminSock = makeSocket({
            isAdmin: true,
            adminUser: { id: 7, nickname: 'Sam', username: 'sam' }
        });
        handlers.handleAdminMessage(adminSock, {
            sessionId,
            message: 'On it, one moment'
        });

        await flush();

        expect(lygHub.send).toHaveBeenCalledTimes(1);
        const payload = lygHub.send.mock.calls[0][0];
        expect(payload).toMatchObject({
            event: 'message',
            from: 'agent',
            sessionId,
            siteApiKey: 'sk-d',
            senderId: '7',
            senderName: 'Sam',
            text: 'On it, one moment',
            escalate: false
        });
    });

    // -----------------------------------------------------------------------
    // sessionHandlers — session.resolved
    // -----------------------------------------------------------------------
    test('admin resolve fires event=session.resolved (no inbound row on lyg_hub side)', async () => {
        const handlers = createSessionHandlers({
            io,
            ticketRepository: ticketRepo,
            siteRepository: { findById: jest.fn(), findByApiKey: jest.fn() },
            chatbotService,
            adminSockets,
            sessions,
            getRealIP: () => '10.0.0.1',
            analyzeIP: async () => null,
            generateId: () => 'gen',
            lygHub
        });

        const sessionId = 'sess-E';
        sessions.set(sessionId, {
            sessionId, name: 'Visitor Five', siteApiKey: 'sk-e',
            socket: null, status: 'open'
        });
        ticketRepo.findById.mockReturnValue({ id: sessionId, status: 'open' });

        const adminSock = makeSocket({
            isAdmin: true,
            adminUser: { id: 9, nickname: 'Lee', username: 'lee' }
        });

        handlers.handleAdminResolve(adminSock, sessionId);

        await flush();

        expect(lygHub.send).toHaveBeenCalledTimes(1);
        const payload = lygHub.send.mock.calls[0][0];
        expect(payload).toMatchObject({
            event: 'session.resolved',
            sessionId,
            from: 'agent',
            senderId: '9',
            senderName: 'Lee',
            siteApiKey: 'sk-e',
            escalate: false,
            text: ''
        });
    });

    test('admin resolve only fires once per resolve transition', async () => {
        const handlers = createSessionHandlers({
            io,
            ticketRepository: ticketRepo,
            siteRepository: { findById: jest.fn(), findByApiKey: jest.fn() },
            chatbotService,
            adminSockets,
            sessions,
            getRealIP: () => '10.0.0.1',
            analyzeIP: async () => null,
            generateId: () => 'gen',
            lygHub
        });

        const sessionId = 'sess-F';
        sessions.set(sessionId, { sessionId, name: 'V', socket: null });
        ticketRepo.findById.mockReturnValue({ id: sessionId });
        const adminSock = makeSocket({ isAdmin: true, adminUser: { id: 1 } });

        // Reopen → no webhook
        handlers.handleAdminReopen(adminSock, sessionId);
        await flush();
        expect(lygHub.send).not.toHaveBeenCalled();

        // Resolve → one webhook
        // Re-add session because resolve deletes it
        sessions.set(sessionId, { sessionId, name: 'V', socket: null });
        handlers.handleAdminResolve(adminSock, sessionId);
        await flush();
        expect(lygHub.send).toHaveBeenCalledTimes(1);
    });

    // -----------------------------------------------------------------------
    // No-op when bridge disabled
    // -----------------------------------------------------------------------
    test('no calls when lygHub.enabled is false', async () => {
        const disabled = { ...makeLygHubStub(), enabled: false };
        const handlers = createChatHandlers({
            io, messageRepository: messageRepo, ticketRepository: ticketRepo,
            adminSockets, sessions,
            getRealIP: () => '10.0.0.1', hasPermission: () => true,
            chatbotService, lygHub: disabled
        });

        const sessionId = 'sess-G';
        sessions.set(sessionId, {
            sessionId, name: 'V', messages: [], hasAdminJoined: false,
            unreadCount: 0, socket: null
        });
        const sock = makeSocket({ sessionId });
        handlers.handleCustomerMessage(sock, { message: 'hi' });
        await flush();
        expect(disabled.send).not.toHaveBeenCalled();
    });
});
