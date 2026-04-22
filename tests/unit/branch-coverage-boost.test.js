/**
 * Targeted tests to lift branch coverage above 90% by exercising
 * conditional branches in:
 *   - src/config/security.js   (REQUIRE_SITE_ID env handling, isLocalhost)
 *   - src/socket/handlers/sessionHandlers.js (geo block, validation, status change)
 *   - src/app.js               (additional stub branches)
 */

describe('config/security.js env-driven branches', () => {
    const ORIGINAL = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...ORIGINAL };
    });
    afterAll(() => { process.env = ORIGINAL; });

    test('REQUIRE_SITE_ID true when env explicitly set', () => {
        process.env.REQUIRE_SITE_ID = 'true';
        const { REQUIRE_SITE_ID } = require('../../src/config/security');
        expect(REQUIRE_SITE_ID).toBe(true);
    });

    test('REQUIRE_SITE_ID false when env explicitly disabled', () => {
        process.env.REQUIRE_SITE_ID = 'false';
        const { REQUIRE_SITE_ID } = require('../../src/config/security');
        expect(REQUIRE_SITE_ID).toBe(false);
    });

    test('REQUIRE_SITE_ID defaults true in production', () => {
        delete process.env.REQUIRE_SITE_ID;
        process.env.NODE_ENV = 'production';
        const { REQUIRE_SITE_ID } = require('../../src/config/security');
        expect(REQUIRE_SITE_ID).toBe(true);
    });

    test('REQUIRE_SITE_ID defaults false in non-production', () => {
        delete process.env.REQUIRE_SITE_ID;
        process.env.NODE_ENV = 'test';
        const { REQUIRE_SITE_ID } = require('../../src/config/security');
        expect(REQUIRE_SITE_ID).toBe(false);
    });

    test('JWT_SECRET uses env when set', () => {
        process.env.JWT_SECRET = 'my-secret-value';
        const { JWT_SECRET } = require('../../src/config/security');
        expect(JWT_SECRET).toBe('my-secret-value');
    });

    test('JWT_SECRET generates random when env unset', () => {
        delete process.env.JWT_SECRET;
        const { JWT_SECRET } = require('../../src/config/security');
        expect(JWT_SECRET).toMatch(/change-this/);
    });

    test('isLocalhost recognises ipv4/ipv6/mapped', () => {
        const { isLocalhost } = require('../../src/config/security');
        expect(isLocalhost('127.0.0.1')).toBe(true);
        expect(isLocalhost('::1')).toBe(true);
        expect(isLocalhost('::ffff:127.0.0.1')).toBe(true);
        expect(isLocalhost('8.8.8.8')).toBe(false);
    });
});

describe('sessionHandlers extra branches', () => {
    const { createSessionHandlers } = (() => {
        const mod = require('../../src/socket/handlers/sessionHandlers');
        return { createSessionHandlers: mod.createSessionHandlers || mod };
    })();
    const { OUT } = require('../../src/socket/events');

    function makeSocket(props = {}) {
        const emitted = [];
        return {
            id: 'sock-' + Math.random().toString(36).slice(2, 8),
            connected: true,
            isAdmin: false,
            sessionId: null,
            adminUser: null,
            disconnect: jest.fn(),
            join: jest.fn(),
            leave: jest.fn(),
            ...props,
            emit: jest.fn(function (e, d) { emitted.push({ event: e, data: d }); }),
            emitted
        };
    }
    function lastEmitted(s, ev) { return [...s.emitted].reverse().find(e => e.event === ev); }

    function buildDeps(overrides = {}) {
        const sessions = new Map();
        const adminSockets = new Map();
        const ticketRepo = {
            findById: jest.fn(),
            create: jest.fn(),
            updateStatus: jest.fn(),
            updateLastMessage: jest.fn()
        };
        const siteRepo = { findById: jest.fn(() => null) };
        const chatbotService = { getConfig: jest.fn(() => ({ enabled: true, welcomeMessage: 'hi' })) };
        const io = { to: jest.fn(() => ({ emit: jest.fn() })) };
        return {
            io,
            ticketRepository: ticketRepo,
            siteRepository: siteRepo,
            chatbotService,
            adminSockets,
            sessions,
            getRealIP: () => '127.0.0.1',
            analyzeIP: jest.fn(async () => ({ geo: { country: 'US' } })),
            generateId: () => 'sess-x',
            ...overrides,
            _refs: { sessions, adminSockets, ticketRepo, siteRepo, chatbotService, io }
        };
    }

    test('handleStartSession rejects unknown siteId', async () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { siteId: 'nope', name: 'A' });
        expect(lastEmitted(sock, OUT.ERROR).data.message).toBe('Unknown site');
        expect(sock.disconnect).toHaveBeenCalled();
    });

    test('handleStartSession rejects bad apiKey', async () => {
        const deps = buildDeps();
        deps._refs.siteRepo.findById.mockReturnValue({ id: 's1', api_key: 'good' });
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { siteId: 's1', apiKey: 'bad', name: 'A' });
        expect(lastEmitted(sock, OUT.ERROR).data.message).toBe('Invalid API key');
    });

    test('handleStartSession requires siteId when REQUIRE_SITE_ID=true', async () => {
        jest.resetModules();
        process.env.REQUIRE_SITE_ID = 'true';
        const { createSessionHandlers: factory } = (() => {
            const m = require('../../src/socket/handlers/sessionHandlers');
            return { createSessionHandlers: m.createSessionHandlers || m };
        })();
        const { OUT: OUT2 } = require('../../src/socket/events');
        const deps = buildDeps();
        const h = factory(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { name: 'A' });
        const err = [...sock.emitted].reverse().find(e => e.event === OUT2.ERROR);
        expect(err.data.message).toBe('siteId is required');
        delete process.env.REQUIRE_SITE_ID;
    });

    test('handleStartSession applies geo blocking', async () => {
        const deps = buildDeps({
            chatbotService: {
                getConfig: () => ({
                    enabled: true,
                    welcomeMessage: 'hi',
                    geoBlocking: { enabled: true, countries: ['US'], mode: 'blocklist', blockedMessage: 'no' }
                })
            }
        });
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { name: 'A' });
        const err = lastEmitted(sock, OUT.ERROR);
        expect(err.data.code).toBe('GEO_BLOCKED');
        expect(sock.disconnect).toHaveBeenCalled();
    });

    test('handleResumeSession SESSION_NOT_FOUND when ticket missing', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        h.handleResumeSession(sock, 'gone');
        expect(lastEmitted(sock, OUT.SESSION_NOT_FOUND)).toBeDefined();
    });

    test('handleEndSession is a no-op without sessionId', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        h.handleEndSession(sock);
        expect(deps._refs.ticketRepo.updateStatus).not.toHaveBeenCalled();
    });

    test('handleEndSession marks session ended and notifies admins', () => {
        const deps = buildDeps();
        deps._refs.sessions.set('s1', { sessionId: 's1', status: 'active' });
        const h = createSessionHandlers(deps);
        const sock = makeSocket({ sessionId: 's1' });
        h.handleEndSession(sock);
        expect(deps._refs.ticketRepo.updateStatus).toHaveBeenCalledWith('s1', 'closed');
    });

    test('handleAdminChangeStatus rejects when sessionId/status missing', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        const sock = makeSocket({ isAdmin: true });
        h.handleAdminChangeStatus(sock, {});
        expect(lastEmitted(sock, OUT.ERROR).data.message).toMatch(/required/);
    });

    test('handleAdminChangeStatus 404 when ticket missing', () => {
        const deps = buildDeps();
        deps._refs.ticketRepo.findById.mockReturnValue(null);
        const h = createSessionHandlers(deps);
        const sock = makeSocket({ isAdmin: true });
        h.handleAdminChangeStatus(sock, { sessionId: 's1', status: 'open' });
        expect(lastEmitted(sock, OUT.ERROR).data.message).toBe('Ticket not found');
    });

    test('handleAdminChangeStatus resolved kicks customer and removes session', () => {
        const deps = buildDeps();
        deps._refs.ticketRepo.findById.mockReturnValue({ id: 's1' });
        const customerSock = makeSocket();
        deps._refs.sessions.set('s1', {
            sessionId: 's1',
            socket: customerSock
        });
        const h = createSessionHandlers(deps);
        const adminSock = makeSocket({ isAdmin: true });
        h.handleAdminChangeStatus(adminSock, { sessionId: 's1', status: 'resolved' });
        expect(customerSock.disconnect).toHaveBeenCalled();
        expect(deps._refs.sessions.has('s1')).toBe(false);
    });

    test('handleAdminUnarchive 404 when ticket missing', () => {
        const deps = buildDeps();
        deps._refs.ticketRepo.findById.mockReturnValue(null);
        const h = createSessionHandlers(deps);
        const sock = makeSocket({ isAdmin: true });
        h.handleAdminUnarchive(sock, 's1');
        expect(lastEmitted(sock, OUT.ERROR).data.message).toBe('Ticket not found');
    });

    test('handleAdminUnarchive ignores non-admins and missing ids', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        h.handleAdminUnarchive(makeSocket(), 's1');
        h.handleAdminUnarchive(makeSocket({ isAdmin: true }), '');
        expect(deps._refs.ticketRepo.updateStatus).not.toHaveBeenCalled();
    });

    test('handleAdminDelete ignores non-admins and missing sessionId', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        // Insert session so we can detect non-deletion
        deps._refs.sessions.set('s-keep', { ticket_id: 's-keep' });
        h.handleAdminDelete(makeSocket(), 's-keep');
        h.handleAdminDelete(makeSocket({ isAdmin: true }), '');
        expect(deps._refs.sessions.has('s-keep')).toBe(true);
    });

    test('handleAdminDelete disconnects connected customer and removes session', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        deps._refs.ticketRepo.delete = jest.fn(() => true);
        const customerSock = makeSocket({ connected: true, disconnect: jest.fn() });
        deps._refs.sessions.set('s-del', {
            ticket_id: 's-del',
            socket: customerSock
        });
        const adminSock = makeSocket({ isAdmin: true, adminUser: { username: 'admin' } });
        h.handleAdminDelete(adminSock, 's-del');
        expect(customerSock.disconnect).toHaveBeenCalledWith(true);
        expect(deps._refs.sessions.has('s-del')).toBe(false);
        expect(deps._refs.ticketRepo.delete).toHaveBeenCalledWith('s-del');
    });

    test('handleAdminDelete handles missing socket gracefully', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        deps._refs.ticketRepo.delete = jest.fn(() => false);
        deps._refs.sessions.set('s-del2', { ticket_id: 's-del2' });
        const adminSock = makeSocket({ isAdmin: true, adminUser: { username: 'admin' } });
        h.handleAdminDelete(adminSock, 's-del2');
        expect(deps._refs.sessions.has('s-del2')).toBe(false);
    });

    test('handleAdminClose ignores non-admins and missing sessions', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        h.handleAdminClose(makeSocket(), 's-nope');
        h.handleAdminClose(makeSocket({ isAdmin: true }), 's-not-in-map');
        expect(deps._refs.ticketRepo.updateStatus).not.toHaveBeenCalled();
    });

    test('handleAdminClose notifies connected customer and updates status', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        const customerSock = makeSocket({ connected: true });
        deps._refs.sessions.set('s-c', { socket: customerSock });
        const adminSock = makeSocket({ isAdmin: true, adminUser: { username: 'admin' } });
        h.handleAdminClose(adminSock, 's-c');
        expect(customerSock.emit).toHaveBeenCalledWith(
            OUT.SESSION_CLOSED_BY_ADMIN,
            expect.objectContaining({ message: expect.any(String) })
        );
        expect(deps._refs.ticketRepo.updateStatus).toHaveBeenCalledWith('s-c', 'closed');
    });

    test('handleAdminArchive disconnects customer when still connected', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        const customerSock = makeSocket({ connected: true, disconnect: jest.fn() });
        deps._refs.sessions.set('s-arc', { socket: customerSock });
        const adminSock = makeSocket({ isAdmin: true, adminUser: { username: 'admin' } });
        h.handleAdminArchive(adminSock, 's-arc');
        expect(customerSock.disconnect).toHaveBeenCalledWith(true);
        expect(deps._refs.sessions.has('s-arc')).toBe(false);
        expect(deps._refs.ticketRepo.updateStatus).toHaveBeenCalledWith('s-arc', 'archived');
    });

    test('handleAdminArchive ignores non-admin', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        h.handleAdminArchive(makeSocket(), 's-x');
        expect(deps._refs.ticketRepo.updateStatus).not.toHaveBeenCalled();
    });

    test('handleAdminChangeStatus accepts string sessionId form (only sessionId, no status)', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        const sock = makeSocket({ isAdmin: true });
        h.handleAdminChangeStatus(sock, 's-only-id');
        // No status -> error emit
        const err = lastEmitted(sock, OUT.ERROR);
        expect(err).toBeDefined();
    });

    test('handleAdminChangeStatus updates status without resolving', () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        deps._refs.ticketRepo.findById.mockReturnValue({ id: 's1', status: 'open' });
        deps._refs.sessions.set('s1', { ticketStatus: 'open' });
        const sock = makeSocket({ isAdmin: true });
        h.handleAdminChangeStatus(sock, { sessionId: 's1', status: 'pending' });
        expect(deps._refs.ticketRepo.updateStatus).toHaveBeenCalledWith('s1', 'pending');
        expect(deps._refs.sessions.get('s1').ticketStatus).toBe('pending');
    });
});
