/**
 * Round 8 — coverage gaps for src/socket/handlers/sessionHandlers.js
 *
 * Covers:
 *  - mirrorLifecycle Promise.then/.catch arrows (webhook without mirror method) — L81
 *  - apiKey-only invalid → emit + disconnect (L111-L115)
 *  - origin-not-allowed branch (L128-L131)
 *  - legacy contact { email/phone } normalization (L171-L176)
 */

const { createSessionHandlers } = require('../../src/socket/handlers/sessionHandlers');
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
        handshake: { headers: {} },
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
        analyzeIP: jest.fn(async () => ({ geo: { country: 'US' } })),
        generateId: () => 'sess-x',
        ...overrides,
        _refs: { sessions, adminSockets, ticketRepo, siteRepo, chatbotService, io }
    };
}

describe('sessionHandlers — apiKey-only invalid path', () => {
    test('apiKey only with no matching site emits Invalid API key + disconnects', async () => {
        const deps = buildDeps();
        deps._refs.siteRepo.findByApiKey.mockReturnValue(null);
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { apiKey: 'wrong', name: 'A' });
        expect(lastEmitted(sock, OUT.ERROR).data.message).toBe('Invalid API key');
        expect(sock.disconnect).toHaveBeenCalled();
    });
});

describe('sessionHandlers — origin allow-list rejection', () => {
    test('site with allowed_origins set and bad origin → 403-style reject', async () => {
        const deps = buildDeps();
        deps._refs.siteRepo.findById.mockReturnValue({
            id: 's1',
            api_key: 'ok',
            allowed_origins: ['https://allowed.example']
        });
        const h = createSessionHandlers(deps);
        const sock = makeSocket({
            handshake: { headers: { origin: 'https://evil.example' } }
        });
        await h.handleStartSession(sock, { siteId: 's1', apiKey: 'ok', name: 'A' });
        expect(lastEmitted(sock, OUT.ERROR).data.message).toMatch(/origin/i);
        expect(sock.disconnect).toHaveBeenCalled();
    });

    test('site with allowed_origins, falls back to referer header', async () => {
        const deps = buildDeps();
        deps._refs.siteRepo.findById.mockReturnValue({
            id: 's2',
            api_key: 'ok',
            allowed_origins: ['https://allowed.example']
        });
        const h = createSessionHandlers(deps);
        const sock = makeSocket({
            handshake: { headers: { referer: 'https://evil.example/page' } }
        });
        await h.handleStartSession(sock, { siteId: 's2', apiKey: 'ok', name: 'A' });
        expect(lastEmitted(sock, OUT.ERROR).data.message).toMatch(/origin/i);
    });
});

describe('sessionHandlers — legacy contact { email|phone } normalization', () => {
    test('legacy { email } only — type=email, phone=null', async () => {
        const deps = buildDeps();
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, {
            name: 'A',
            contact: { email: 'a@b.c' }
        });
        // Session should be added to sessions map
        const session = deps._refs.sessions.get('sess-x');
        expect(session).toBeDefined();
        expect(session.contact).toEqual({
            type: 'email',
            value: 'a@b.c',
            email: 'a@b.c',
            phone: null
        });
    });

    test('legacy { phone } only — type=phone, email=null', async () => {
        const deps = buildDeps();
        deps.generateId = () => 'sess-y';
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, {
            name: 'B',
            contact: { phone: '555-1234' }
        });
        const session = deps._refs.sessions.get('sess-y');
        expect(session).toBeDefined();
        expect(session.contact).toEqual({
            type: 'phone',
            value: '555-1234',
            email: null,
            phone: '555-1234'
        });
    });

    test('legacy { email + phone } — type=email (email wins)', async () => {
        const deps = buildDeps();
        deps.generateId = () => 'sess-z';
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, {
            name: 'C',
            contact: { email: 'c@b.c', phone: '111' }
        });
        const session = deps._refs.sessions.get('sess-z');
        expect(session.contact.type).toBe('email');
        expect(session.contact.email).toBe('c@b.c');
        expect(session.contact.phone).toBe('111');
    });
});

describe('sessionHandlers — mirrorLifecycle Promise fallback (webhook w/o mirror)', () => {
    test('webhook with only send (+ genMessageId) triggers Promise.then().catch() arrows', async () => {
        const send = jest.fn().mockResolvedValue();
        const webhook = {
            // No `mirror` method → triggers else branch with Promise.resolve().then()
            genMessageId: () => 'mid-1',
            send
        };
        const deps = buildDeps({ webhook });
        deps._refs.siteRepo.findById.mockReturnValue({ id: 's-mr', api_key: 'k' });
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { siteId: 's-mr', apiKey: 'k', name: 'X' });
        // mirrorLifecycle is called with 'session.created' (or similar) — let microtask flush
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));
        expect(send).toHaveBeenCalled();
    });

    test('webhook send rejects → .catch arrow swallows the error', async () => {
        const send = jest.fn().mockRejectedValue(new Error('boom'));
        const webhook = {
            genMessageId: () => 'mid-2',
            send
        };
        const deps = buildDeps({ webhook });
        deps._refs.siteRepo.findById.mockReturnValue({ id: 's-mr2', api_key: 'k' });
        const h = createSessionHandlers(deps);
        const sock = makeSocket();
        await h.handleStartSession(sock, { siteId: 's-mr2', apiKey: 'k', name: 'X' });
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));
        expect(send).toHaveBeenCalled();
    });
});
