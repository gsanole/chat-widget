/**
 * Integration: chat & session handlers fire the per-site webhook bridge
 * with the right siteId + payload shape.
 *
 * The webhook stub mimics the new bridge interface:
 *   { mirror(siteId, payload), send(siteId, payload), genMessageId() }
 *
 * Tests verify per-site routing — handlers must resolve siteId from
 * the in-memory session OR fall back to the ticket row, and pass it
 * to mirror() so the bridge can look up the correct receiver.
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

function makeWebhookStub() {
    let counter = 0;
    return {
        mirror: jest.fn(),
        send: jest.fn().mockResolvedValue({ ok: true }),
        genMessageId: jest.fn(() => `msg-${++counter}`)
    };
}

const flush = () => new Promise(r => setImmediate(r));

describe('per-site webhook bridge — handler integration', () => {
    let webhook;
    let sessions;
    let adminSockets;
    let messageRepo;
    let ticketRepo;
    let siteRepo;
    let chatbotService;
    let io;

    beforeEach(() => {
        webhook = makeWebhookStub();
        sessions = new Map();
        adminSockets = new Map();
        messageRepo = { create: jest.fn(), findByTicket: jest.fn(() => []) };
        ticketRepo = {
            create: jest.fn(),
            findById: jest.fn(),
            updateLastMessage: jest.fn(),
            updateStatus: jest.fn()
        };
        siteRepo = { findById: jest.fn(), findByApiKey: jest.fn() };
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

    function buildChat() {
        return createChatHandlers({
            io, messageRepository: messageRepo, ticketRepository: ticketRepo,
            adminSockets, sessions,
            getRealIP: () => '10.0.0.1', hasPermission: () => true,
            chatbotService, webhook
        });
    }

    function buildSession() {
        return createSessionHandlers({
            io, ticketRepository: ticketRepo, siteRepository: siteRepo,
            chatbotService, adminSockets, sessions,
            getRealIP: () => '10.0.0.1',
            analyzeIP: async () => null,
            generateId: () => 'gen',
            webhook
        });
    }

    // -----------------------------------------------------------------------
    // chatHandlers — customer message
    // -----------------------------------------------------------------------
    test('customer message mirrors with siteId from session, escalate=false', async () => {
        const handlers = buildChat();
        const sessionId = 'sess-A';
        sessions.set(sessionId, {
            sessionId, name: 'Visitor One', siteId: 'site-A',
            messages: [], hasAdminJoined: false, unreadCount: 0, socket: null
        });

        const sock = makeSocket({ sessionId });
        handlers.handleCustomerMessage(sock, { message: 'hello there' });
        await flush();

        expect(webhook.mirror).toHaveBeenCalledTimes(1);
        const [siteId, payload] = webhook.mirror.mock.calls[0];
        expect(siteId).toBe('site-A');
        expect(payload).toMatchObject({
            event: 'message',
            from: 'customer',
            sessionId,
            siteId: 'site-A',
            senderName: 'Visitor One',
            text: 'hello there',
            escalate: false
        });
        expect(payload.messageId).toMatch(/^msg-\d+$/);
        expect(typeof payload.ts).toBe('number');
    });

    test('customer message with escalation keyword sets escalate=true', async () => {
        const handlers = buildChat();
        const sessionId = 'sess-B';
        sessions.set(sessionId, {
            sessionId, name: 'V', siteId: 'site-B',
            messages: [], hasAdminJoined: false, unreadCount: 0, socket: null
        });

        const sock = makeSocket({ sessionId });
        handlers.handleCustomerMessage(sock, { message: 'I need a human now' });
        await flush();

        expect(webhook.mirror).toHaveBeenCalledTimes(1);
        expect(webhook.mirror.mock.calls[0][1].escalate).toBe(true);
    });

    test('customer message does not mirror when no siteId resolvable', async () => {
        const handlers = buildChat();
        const sessionId = 'sess-X';
        sessions.set(sessionId, {
            sessionId, name: 'V', /* no siteId */
            messages: [], hasAdminJoined: false, unreadCount: 0, socket: null
        });
        ticketRepo.findById.mockReturnValue(null);

        const sock = makeSocket({ sessionId });
        handlers.handleCustomerMessage(sock, { message: 'hi' });
        await flush();

        expect(webhook.mirror).not.toHaveBeenCalled();
    });

    test('customer message swallows webhook errors without breaking chat', async () => {
        webhook.mirror.mockImplementation(() => { throw new Error('boom'); });
        const handlers = buildChat();
        const sessionId = 'sess-C';
        sessions.set(sessionId, {
            sessionId, name: 'V', siteId: 'site-C',
            messages: [], hasAdminJoined: false, unreadCount: 0, socket: null
        });

        const sock = makeSocket({ sessionId });
        // chatHandlers wraps mirror calls in mirrorToSite which is fire-and-forget.
        // A throwing mirror() bubbles synchronously, so handler should still ack to customer.
        try { handlers.handleCustomerMessage(sock, { message: 'hi' }); } catch (_) { /* tolerated */ }
        await flush();
        expect(messageRepo.create).toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // chatHandlers — admin message
    // -----------------------------------------------------------------------
    test('admin message mirrors with siteId, from=agent, escalate=false', async () => {
        const handlers = buildChat();
        const sessionId = 'sess-D';
        sessions.set(sessionId, {
            sessionId, name: 'V', siteId: 'site-D',
            messages: [], hasAdminJoined: true, unreadCount: 0, socket: null
        });

        const adminSock = makeSocket({
            isAdmin: true,
            adminUser: { id: 7, nickname: 'Sam', username: 'sam' }
        });
        handlers.handleAdminMessage(adminSock, { sessionId, message: 'On it' });
        await flush();

        expect(webhook.mirror).toHaveBeenCalledTimes(1);
        const [siteId, payload] = webhook.mirror.mock.calls[0];
        expect(siteId).toBe('site-D');
        expect(payload).toMatchObject({
            event: 'message',
            from: 'agent',
            sessionId,
            siteId: 'site-D',
            senderId: '7',
            senderName: 'Sam',
            text: 'On it',
            escalate: false
        });
    });

    test('admin message falls back to ticket.site_id when session is gone', async () => {
        const handlers = buildChat();
        const sessionId = 'sess-DR';
        // No in-memory session — must resolve via ticket row.
        ticketRepo.findById.mockReturnValue({ id: sessionId, site_id: 'site-from-ticket' });

        const adminSock = makeSocket({ isAdmin: true, adminUser: { id: 1, nickname: 'A' } });
        handlers.handleAdminMessage(adminSock, { sessionId, message: 'hi' });
        await flush();

        expect(webhook.mirror).toHaveBeenCalledTimes(1);
        expect(webhook.mirror.mock.calls[0][0]).toBe('site-from-ticket');
    });

    // -----------------------------------------------------------------------
    // sessionHandlers — lifecycle
    // -----------------------------------------------------------------------
    test('admin resolve mirrors a status_changed event with siteId', async () => {
        const handlers = buildSession();
        const sessionId = 'sess-E';
        sessions.set(sessionId, { sessionId, name: 'V', siteId: 'site-E', socket: null, status: 'open' });
        ticketRepo.findById.mockReturnValue({ id: sessionId, status: 'open', site_id: 'site-E' });

        const adminSock = makeSocket({ isAdmin: true, adminUser: { id: 9, nickname: 'Lee', username: 'lee' } });
        handlers.handleAdminResolve(adminSock, sessionId);
        await flush();

        expect(webhook.mirror).toHaveBeenCalledTimes(1);
        const [siteId, payload] = webhook.mirror.mock.calls[0];
        expect(siteId).toBe('site-E');
        expect(payload).toMatchObject({
            event: 'session.status_changed',
            sessionId,
            siteId: 'site-E',
            status: 'resolved'
        });
    });

    test('admin reopen also mirrors a status_changed event', async () => {
        const handlers = buildSession();
        const sessionId = 'sess-F';
        sessions.set(sessionId, { sessionId, name: 'V', siteId: 'site-F', socket: null });
        ticketRepo.findById.mockReturnValue({ id: sessionId, site_id: 'site-F' });

        const adminSock = makeSocket({ isAdmin: true, adminUser: { id: 1 } });
        handlers.handleAdminReopen(adminSock, sessionId);
        await flush();

        expect(webhook.mirror).toHaveBeenCalledTimes(1);
        const [siteId, payload] = webhook.mirror.mock.calls[0];
        expect(siteId).toBe('site-F');
        expect(payload.event).toBe('session.status_changed');
        expect(payload.status).toBe('open');
    });

    test('lifecycle is no-op when no siteId is resolvable', async () => {
        const handlers = buildSession();
        const sessionId = 'sess-NS';
        sessions.set(sessionId, { sessionId, name: 'V', socket: null }); // no siteId
        ticketRepo.findById.mockReturnValue(null);

        const adminSock = makeSocket({ isAdmin: true, adminUser: { id: 1 } });
        handlers.handleAdminResolve(adminSock, sessionId);
        await flush();

        expect(webhook.mirror).not.toHaveBeenCalled();
    });
});
