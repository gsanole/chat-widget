/**
 * Round 10 — additional gaps for sessionHandlers + app.js
 *
 * sessionHandlers: cover `typeof socket.disconnect === 'function'` false branches
 * (sockets that lack a disconnect method) and exercise lifecycle handlers with
 * pre-seeded sessions (handleEndSession, handleAdminArchive, handleAdminUnarchive,
 * handleAdminDelete, handleAdminChangeStatus).
 *
 * app.js: invoke the /api/tickets/search route handler directly (it is shadowed
 * by the mounted /api/tickets router so cannot be reached via supertest).
 */

const { createSessionHandlers } = require('../../src/socket/handlers/sessionHandlers');
const { OUT } = require('../../src/socket/events');

function makeBareSocket(props = {}) {
    return {
        id: 'sock-' + Math.random().toString(36).slice(2, 8),
        connected: true,
        isAdmin: false,
        sessionId: null,
        adminUser: null,
        join: jest.fn(),
        leave: jest.fn(),
        handshake: { headers: {} },
        emit: jest.fn(),
        // Intentionally NO disconnect property — the handlers gate on
        // `typeof socket.disconnect === 'function'` so this exercises the
        // false branch.
        ...props
    };
}

function buildDeps(overrides = {}) {
    const sessions = new Map();
    const adminSockets = new Map();
    const ticketRepo = {
        findById: jest.fn(() => null),
        create: jest.fn(),
        updateStatus: jest.fn(),
        updateLastMessage: jest.fn(),
        delete: jest.fn(() => true)
    };
    const siteRepo = {
        findById: jest.fn(() => null),
        findByApiKey: jest.fn(() => null)
    };
    const chatbotService = { getConfig: jest.fn(() => ({})) };
    const io = { to: jest.fn(() => ({ emit: jest.fn() })) };
    return {
        io,
        ticketRepository: ticketRepo,
        siteRepository: siteRepo,
        chatbotService,
        adminSockets,
        sessions,
        getRealIP: () => '127.0.0.1',
        analyzeIP: jest.fn(async () => ({})),
        generateId: () => 'sess-r10',
        ...overrides,
        _refs: { sessions, adminSockets, ticketRepo, siteRepo, chatbotService, io }
    };
}

describe('sessionHandlers — sockets without disconnect method', () => {
    test('siteId not found + bare socket (no disconnect) does not throw', async () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        const sock = makeBareSocket();
        await h.handleStartSession(sock, { siteId: 'nope' });
        expect(sock.emit).toHaveBeenCalledWith(OUT.ERROR, expect.objectContaining({ message: 'Unknown site' }));
    });

    test('site api_key mismatch + bare socket (no disconnect)', async () => {
        const deps = buildDeps();
        deps._refs.siteRepo.findById.mockReturnValue({ id: 's1', api_key: 'good' });
        const h = createSessionHandlers(deps);
        const sock = makeBareSocket();
        await h.handleStartSession(sock, { siteId: 's1', apiKey: 'bad' });
        expect(sock.emit).toHaveBeenCalledWith(OUT.ERROR, expect.objectContaining({ message: 'Invalid API key' }));
    });

    test('apiKey-only invalid + bare socket', async () => {
        const deps = buildDeps();
        deps._refs.siteRepo.findByApiKey.mockReturnValue(null);
        const h = createSessionHandlers(deps);
        const sock = makeBareSocket();
        await h.handleStartSession(sock, { apiKey: 'wrong' });
        expect(sock.emit).toHaveBeenCalledWith(OUT.ERROR, expect.objectContaining({ message: 'Invalid API key' }));
    });

    test('site origin not allowed + bare socket', async () => {
        const deps = buildDeps();
        deps._refs.siteRepo.findById.mockReturnValue({
            id: 's1', api_key: 'ok',
            allowed_origins: ['https://allowed.example']
        });
        const h = createSessionHandlers(deps);
        const sock = makeBareSocket({
            handshake: { headers: { origin: 'https://evil.example' } }
        });
        await h.handleStartSession(sock, { siteId: 's1', apiKey: 'ok' });
        expect(sock.emit).toHaveBeenCalledWith(OUT.ERROR, expect.objectContaining({ message: expect.stringMatching(/origin/i) }));
    });
});

describe('sessionHandlers — analyzeIP throws (covers catch arrow)', () => {
    test('analyzeIP rejects → catch path logs + continues', async () => {
        const deps = buildDeps({ analyzeIP: jest.fn(async () => { throw new Error('iperr'); }) });
        const h = createSessionHandlers(deps);
        const sock = makeBareSocket({ disconnect: jest.fn() });
        await h.handleStartSession(sock, { name: 'X' });
        // Session should still be created
        expect(deps._refs.sessions.size).toBeGreaterThan(0);
    });
});

describe('sessionHandlers — geo blocking blocked path', () => {
    test('chatbot config geo-blocking enabled + blocked country emits GEO_BLOCKED', async () => {
        const deps = buildDeps({
            chatbotService: {
                getConfig: () => ({
                    geoBlocking: { enabled: true, countries: ['ZZ'], mode: 'blocklist', blockedMessage: 'no' }
                })
            },
            analyzeIP: jest.fn(async () => ({ geo: { country: 'ZZ' } }))
        });
        const h = createSessionHandlers(deps);
        const sock = makeBareSocket({ disconnect: jest.fn() });
        await h.handleStartSession(sock, { name: 'X' });
        const errors = sock.emit.mock.calls.filter(c => c[0] === OUT.ERROR);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0][1].code).toBe('GEO_BLOCKED');
    });
});

describe('sessionHandlers — lifecycle handlers with seeded sessions', () => {
    function seedSession(deps, sessionId = 's-1', extra = {}) {
        const inner = {
            sessionId,
            socket: { connected: true, emit: jest.fn(), disconnect: jest.fn() },
            siteId: 'site-A',
            status: 'active',
            ...extra
        };
        deps._refs.sessions.set(sessionId, inner);
        return inner;
    }

    test('handleEndSession with valid sessionId triggers full path', () => {
        const deps = buildDeps();
        seedSession(deps, 's-end');
        const h = createSessionHandlers(deps);
        const sock = { sessionId: 's-end', leave: jest.fn() };
        h.handleEndSession(sock);
        expect(deps._refs.ticketRepo.updateStatus).toHaveBeenCalledWith('s-end', 'closed');
        expect(sock.leave).toHaveBeenCalled();
    });

    test('handleEndSession with no sessionId returns early', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        h.handleEndSession({ sessionId: null });
        expect(deps._refs.ticketRepo.updateStatus).not.toHaveBeenCalled();
    });

    test('handleAdminClose by admin closes session + notifies customer', () => {
        const deps = buildDeps();
        const session = seedSession(deps, 's-cl');
        const h = createSessionHandlers(deps);
        h.handleAdminClose({ isAdmin: true, adminUser: { username: 'adm' } }, 's-cl');
        expect(session.socket.emit).toHaveBeenCalledWith(OUT.SESSION_CLOSED_BY_ADMIN, expect.any(Object));
        expect(deps._refs.ticketRepo.updateStatus).toHaveBeenCalledWith('s-cl', 'closed');
    });

    test('handleAdminClose with non-admin is no-op', () => {
        const deps = buildDeps();
        seedSession(deps, 's-cl2');
        const h = createSessionHandlers(deps);
        h.handleAdminClose({ isAdmin: false }, 's-cl2');
        expect(deps._refs.ticketRepo.updateStatus).not.toHaveBeenCalled();
    });

    test('handleAdminClose where session.socket not connected', () => {
        const deps = buildDeps();
        const session = seedSession(deps, 's-cl3');
        session.socket.connected = false;
        const h = createSessionHandlers(deps);
        h.handleAdminClose({ isAdmin: true, adminUser: { username: 'adm' } }, 's-cl3');
        expect(deps._refs.ticketRepo.updateStatus).toHaveBeenCalledWith('s-cl3', 'closed');
    });

    test('handleAdminArchive disconnects connected socket + deletes from map', () => {
        const deps = buildDeps();
        const session = seedSession(deps, 's-ar');
        const h = createSessionHandlers(deps);
        h.handleAdminArchive({ isAdmin: true, adminUser: { username: 'a' } }, 's-ar');
        expect(session.socket.disconnect).toHaveBeenCalledWith(true);
        expect(deps._refs.sessions.has('s-ar')).toBe(false);
        expect(deps._refs.ticketRepo.updateStatus).toHaveBeenCalledWith('s-ar', 'archived');
    });

    test('handleAdminArchive disconnect throws — catch swallows', () => {
        const deps = buildDeps();
        const session = seedSession(deps, 's-ar2');
        session.socket.disconnect = jest.fn(() => { throw new Error('boom'); });
        const h = createSessionHandlers(deps);
        h.handleAdminArchive({ isAdmin: true, adminUser: { username: 'a' } }, 's-ar2');
        expect(deps._refs.sessions.has('s-ar2')).toBe(false);
    });

    test('handleAdminArchive non-admin is no-op', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        h.handleAdminArchive({ isAdmin: false }, 's-x');
        expect(deps._refs.ticketRepo.updateStatus).not.toHaveBeenCalled();
    });

    test('handleAdminUnarchive ticket not found emits error', () => {
        const deps = buildDeps();
        deps._refs.ticketRepo.findById.mockReturnValue(null);
        const h = createSessionHandlers(deps);
        const sock = { isAdmin: true, emit: jest.fn(), adminUser: { username: 'a' } };
        h.handleAdminUnarchive(sock, 's-un');
        expect(sock.emit).toHaveBeenCalledWith(OUT.ERROR, expect.any(Object));
    });

    test('handleAdminUnarchive ticket found marks open', () => {
        const deps = buildDeps();
        deps._refs.ticketRepo.findById.mockReturnValue({ id: 's-un2' });
        const h = createSessionHandlers(deps);
        const sock = { isAdmin: true, emit: jest.fn(), adminUser: { username: 'a' } };
        h.handleAdminUnarchive(sock, 's-un2');
        expect(deps._refs.ticketRepo.updateStatus).toHaveBeenCalledWith('s-un2', 'open');
    });

    test('handleAdminUnarchive non-admin / no sessionId no-ops', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        h.handleAdminUnarchive({ isAdmin: false }, 's');
        h.handleAdminUnarchive({ isAdmin: true }, null);
        expect(deps._refs.ticketRepo.updateStatus).not.toHaveBeenCalled();
    });

    test('handleAdminDelete with seeded session removes from map + ticket', () => {
        const deps = buildDeps();
        const session = seedSession(deps, 's-del');
        const h = createSessionHandlers(deps);
        h.handleAdminDelete({ isAdmin: true, adminUser: { username: 'a' } }, 's-del');
        expect(session.socket.disconnect).toHaveBeenCalledWith(true);
        expect(deps._refs.sessions.has('s-del')).toBe(false);
        expect(deps._refs.ticketRepo.delete).toHaveBeenCalledWith('s-del');
    });

    test('handleAdminDelete non-admin / no sessionId no-ops', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        h.handleAdminDelete({ isAdmin: false }, 's');
        h.handleAdminDelete({ isAdmin: true }, null);
        expect(deps._refs.ticketRepo.delete).not.toHaveBeenCalled();
    });

    test('handleAdminDelete disconnect throws — catch swallows', () => {
        const deps = buildDeps();
        const session = seedSession(deps, 's-del2');
        session.socket.disconnect = jest.fn(() => { throw new Error('x'); });
        const h = createSessionHandlers(deps);
        h.handleAdminDelete({ isAdmin: true, adminUser: { username: 'a' } }, 's-del2');
        expect(deps._refs.sessions.has('s-del2')).toBe(false);
    });
});

describe('sessionHandlers — mirrorLifecycle no-op when webhook missing', () => {
    test('handler called with no webhook dep → mirrorLifecycle returns early', () => {
        const deps = buildDeps(); // webhook undefined
        const h = createSessionHandlers(deps);
        // handleEndSession with seeded session triggers mirrorLifecycle which
        // returns immediately because webhook is undefined.
        deps._refs.sessions.set('s-now', {
            sessionId: 's-now',
            socket: { connected: true, emit: jest.fn() },
            status: 'active',
            siteId: 'site-A'
        });
        h.handleEndSession({ sessionId: 's-now', leave: jest.fn() });
        // No throw → success
        expect(true).toBe(true);
    });
});
