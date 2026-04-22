/**
 * Unit tests for geo-blocking enforcement in the socket session start handler.
 *
 * Lives in its own file so the jest.mock('../../src/database') hoist does not
 * affect the supertest-based tests in tests/unit/geoBlocking.test.js
 * (createApp() loads the real database module).
 */

jest.mock('../../src/database', () => ({
    messages: { findByTicket: jest.fn(() => []) }
}));

const { createSessionHandlers } = require('../../src/socket/handlers/sessionHandlers');
const { OUT } = require('../../src/socket/events');

function makeSocket() {
    const emitted = [];
    return {
        id: 'sock_block_' + Math.random().toString(36).slice(2, 8),
        isAdmin: false,
        sessionId: null,
        emit: jest.fn(function (e, d) { emitted.push({ event: e, data: d }); }),
        join: jest.fn(),
        leave: jest.fn(),
        disconnect: jest.fn(),
        emitted
    };
}

function buildDeps(geoCountry, blockingConfig) {
    return {
        io: { to: jest.fn(() => ({ emit: jest.fn() })) },
        ticketRepository: { findById: jest.fn(), create: jest.fn(), updateStatus: jest.fn() },
        siteRepository: { findById: jest.fn() },
        chatbotService: { getConfig: jest.fn(() => ({ geoBlocking: blockingConfig })) },
        adminSockets: new Map(),
        sessions: new Map(),
        getRealIP: () => '8.8.8.8',
        analyzeIP: jest.fn(async () => ({ geo: { countryCode: geoCountry } })),
        generateId: () => 'sess-blocked'
    };
}

describe('Socket session geo blocking', () => {
    let logSpy;
    beforeEach(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => { }); });
    afterEach(() => { logSpy.mockRestore(); });

    test('blocks customer session when country is on blocklist', async () => {
        const deps = buildDeps('XX', { enabled: true, mode: 'blocklist', countries: ['XX'] });
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { name: 'Bad' });

        const errEvent = sock.emitted.find(e => e.event === OUT.ERROR);
        expect(errEvent).toBeDefined();
        expect(errEvent.data.code).toBe('GEO_BLOCKED');
        expect(sock.disconnect).toHaveBeenCalledWith(true);
        expect(deps.sessions.size).toBe(0);
        expect(deps.ticketRepository.create).not.toHaveBeenCalled();
    });

    test('uses custom blockedMessage from geoBlocking config', async () => {
        const deps = buildDeps('XX', {
            enabled: true, mode: 'blocklist', countries: ['XX'],
            blockedMessage: 'You are blocked!'
        });
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { name: 'X' });
        const errEvent = sock.emitted.find(e => e.event === OUT.ERROR);
        expect(errEvent.data.message).toBe('You are blocked!');
        expect(errEvent.data.country).toBe('XX');
    });

    test('site-specific chatbot_config takes precedence over global config', async () => {
        const deps = buildDeps('XX', { enabled: false, mode: 'blocklist', countries: [] });
        deps.siteRepository.findById = jest.fn(() => ({
            id: 'site1',
            chatbot_config: { geoBlocking: { enabled: true, mode: 'blocklist', countries: ['XX'] } }
        }));
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { name: 'X', siteId: 'site1' });
        const errEvent = sock.emitted.find(e => e.event === OUT.ERROR);
        expect(errEvent).toBeDefined();
        expect(errEvent.data.code).toBe('GEO_BLOCKED');
        expect(sock.disconnect).toHaveBeenCalled();
    });

    test('allows session through when geoBlocking is disabled', async () => {
        const deps = buildDeps('XX', { enabled: false, mode: 'blocklist', countries: ['XX'] });
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { name: 'OK' });
        expect(sock.disconnect).not.toHaveBeenCalled();
        expect(deps.sessions.size).toBe(1);
    });

    test('allows session through when geoBlocking config absent on chatbot', async () => {
        const deps = buildDeps('XX', undefined);
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { name: 'OK2' });
        expect(sock.disconnect).not.toHaveBeenCalled();
        expect(deps.sessions.size).toBe(1);
    });

    test('uses default blocked message when geoBlocking.blockedMessage is empty', async () => {
        const deps = buildDeps('XX', { enabled: true, mode: 'blocklist', countries: ['XX'] });
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { name: 'X' });
        const errEvent = sock.emitted.find(e => e.event === OUT.ERROR);
        expect(errEvent.data.message).toMatch(/not available in your region/i);
    });

    test('uses "unknown" in log when decision.country is null (allowlist with empty list, geo missing)', async () => {
        const deps = buildDeps(undefined, { enabled: true, mode: 'allowlist', countries: [] });
        // Force analyzeIP to return geo without country info
        deps.analyzeIP = jest.fn(async () => ({ geo: null }));
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { name: 'NoGeo' });
        const errEvent = sock.emitted.find(e => e.event === OUT.ERROR);
        expect(errEvent).toBeDefined();
        expect(errEvent.data.country).toBeNull();
        expect(sock.disconnect).toHaveBeenCalled();
    });
});
