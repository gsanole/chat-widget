/**
 * Unit tests for the per-site webhook bridge (src/services/lygHubWebhook.js).
 *
 * Verifies:
 *  - resolveTarget returns null when the site is missing or integration is disabled / partially configured.
 *  - send() is a no-op (skipped:true) when the site has no integration.
 *  - send() POSTs JSON + correct HMAC headers to the site's URL.
 *  - send() honors per-site `events` allow-list.
 *  - send() swallows network errors and non-OK responses.
 *  - send() handles missing global fetch gracefully.
 *  - mirror() is fire-and-forget and never throws.
 *  - genMessageId returns a UUID-shaped string.
 *  - verifySignature accepts a valid signature, with or without `sha256=` prefix.
 *  - verifySignature rejects bad / missing / wrong-secret / non-hex signatures.
 *  - createLygHubWebhook is exported as an alias for back-compat.
 */

const crypto = require('crypto');
const {
    createWebhookBridge,
    createLygHubWebhook,
    verifySignature
} = require('../../src/services/lygHubWebhook');

const SILENT = { warn: () => {}, info: () => {} };

function siteRepoFor(site) {
    return { findById: jest.fn(id => (site && site.id === id ? site : null)) };
}

const ENABLED_SITE = {
    id: 'site-1',
    integration: {
        enabled: true,
        url: 'https://hub.example.com',
        secret: 'shared-secret-1234567890abcdef',
        events: null
    }
};

describe('createWebhookBridge — resolveTarget', () => {
    test('returns null when siteId is falsy', () => {
        const w = createWebhookBridge({ siteRepository: siteRepoFor(ENABLED_SITE), log: SILENT });
        expect(w.resolveTarget(null)).toBeNull();
        expect(w.resolveTarget('')).toBeNull();
    });

    test('returns null when siteRepository is missing or invalid', () => {
        const w1 = createWebhookBridge({ log: SILENT });
        expect(w1.resolveTarget('site-1')).toBeNull();

        const w2 = createWebhookBridge({ siteRepository: {}, log: SILENT });
        expect(w2.resolveTarget('site-1')).toBeNull();
    });

    test('returns null when site has no integration', () => {
        const w = createWebhookBridge({ siteRepository: siteRepoFor({ id: 's', integration: null }), log: SILENT });
        expect(w.resolveTarget('s')).toBeNull();
    });

    test('returns null when integration is disabled / missing url / missing secret', () => {
        const cases = [
            { enabled: false, url: 'https://x', secret: 'k' },
            { enabled: true, url: '', secret: 'k' },
            { enabled: true, url: 'https://x', secret: '' }
        ];
        for (const integration of cases) {
            const w = createWebhookBridge({
                siteRepository: siteRepoFor({ id: 's', integration }),
                log: SILENT
            });
            expect(w.resolveTarget('s')).toBeNull();
        }
    });

    test('returns target { url, secret, events } when enabled', () => {
        const w = createWebhookBridge({ siteRepository: siteRepoFor(ENABLED_SITE), log: SILENT });
        expect(w.resolveTarget('site-1')).toEqual({
            url: 'https://hub.example.com',
            secret: 'shared-secret-1234567890abcdef',
            events: null
        });
    });
});

describe('createWebhookBridge — send', () => {
    test('skipped when integration is not configured', async () => {
        const fetchImpl = jest.fn();
        const w = createWebhookBridge({
            siteRepository: siteRepoFor({ id: 's', integration: null }),
            fetchImpl,
            log: SILENT
        });
        const r = await w.send('s', { event: 'message', messageId: 'm1' });
        expect(r).toEqual({ ok: true, skipped: true });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('signs body with HMAC-SHA256 and sets x-chat-* headers', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
        const w = createWebhookBridge({
            siteRepository: siteRepoFor(ENABLED_SITE),
            fetchImpl,
            log: SILENT
        });

        const payload = {
            event: 'message',
            messageId: '11111111-1111-1111-1111-111111111111',
            sessionId: 'sess-abc',
            from: 'customer',
            text: 'hello',
            ts: 1700000000000
        };

        const r = await w.send('site-1', payload);
        expect(r).toEqual({ ok: true });
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        const [url, opts] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://hub.example.com');
        expect(opts.method).toBe('POST');
        expect(opts.headers['content-type']).toBe('application/json');

        const expected = crypto
            .createHmac('sha256', ENABLED_SITE.integration.secret)
            .update(opts.body)
            .digest('hex');
        expect(opts.headers['x-chat-signature']).toBe(`sha256=${expected}`);
        expect(opts.headers['x-chat-event']).toBe('message');
        expect(opts.headers['x-chat-delivery']).toBe('11111111-1111-1111-1111-111111111111');
        expect(JSON.parse(opts.body)).toEqual(payload);
    });

    test('honors per-site events allow-list (skips events not in list)', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({ ok: true });
        const site = {
            id: 'site-2',
            integration: {
                enabled: true,
                url: 'https://hub.example.com',
                secret: 'k',
                events: ['session.opened']
            }
        };
        const w = createWebhookBridge({ siteRepository: siteRepoFor(site), fetchImpl, log: SILENT });

        const skipped = await w.send('site-2', { event: 'message', messageId: 'm' });
        expect(skipped).toEqual({ ok: true, skipped: true });
        expect(fetchImpl).not.toHaveBeenCalled();

        const sent = await w.send('site-2', { event: 'session.opened', messageId: 'm' });
        expect(sent.ok).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('returns ok:false on non-OK HTTP response', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 502 });
        const w = createWebhookBridge({
            siteRepository: siteRepoFor(ENABLED_SITE),
            fetchImpl,
            log: SILENT
        });
        const r = await w.send('site-1', { event: 'message', messageId: 'm' });
        expect(r).toEqual({ ok: false, status: 502 });
    });

    test('swallows fetch errors (returns ok:false, never throws)', async () => {
        const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        const w = createWebhookBridge({
            siteRepository: siteRepoFor(ENABLED_SITE),
            fetchImpl,
            log: SILENT
        });
        const r = await w.send('site-1', { event: 'message', messageId: 'm' });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/ECONNREFUSED/);
    });

    test('returns ok:false { error: "no-fetch" } when no fetch is available', async () => {
        const originalFetch = globalThis.fetch;
        delete globalThis.fetch;
        try {
            const w = createWebhookBridge({
                siteRepository: siteRepoFor(ENABLED_SITE),
                log: SILENT
            });
            const r = await w.send('site-1', { event: 'message', messageId: 'm' });
            expect(r).toEqual({ ok: false, error: 'no-fetch' });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe('createWebhookBridge — mirror', () => {
    test('mirror is no-op when site has no integration (does not call fetch)', async () => {
        const fetchImpl = jest.fn();
        const w = createWebhookBridge({
            siteRepository: siteRepoFor({ id: 's', integration: null }),
            fetchImpl,
            log: SILENT
        });
        expect(() => w.mirror('s', { event: 'message', messageId: 'm' })).not.toThrow();
        await new Promise(r => setImmediate(r));
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('mirror dispatches send asynchronously (fire-and-forget)', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({ ok: true });
        const w = createWebhookBridge({
            siteRepository: siteRepoFor(ENABLED_SITE),
            fetchImpl,
            log: SILENT
        });
        w.mirror('site-1', { event: 'message', messageId: 'm' });
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('mirror swallows rejected sends without unhandled rejection', async () => {
        const fetchImpl = jest.fn().mockRejectedValue(new Error('boom'));
        const w = createWebhookBridge({
            siteRepository: siteRepoFor(ENABLED_SITE),
            fetchImpl,
            log: SILENT
        });
        expect(() => w.mirror('site-1', { event: 'message', messageId: 'm' })).not.toThrow();
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));
    });
});

describe('createWebhookBridge — misc', () => {
    test('genMessageId returns a UUID-shaped string', () => {
        const w = createWebhookBridge({ siteRepository: siteRepoFor(ENABLED_SITE), log: SILENT });
        const id = w.genMessageId();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test('createLygHubWebhook is an alias for back-compat', () => {
        expect(createLygHubWebhook).toBe(createWebhookBridge);
    });
});

describe('verifySignature', () => {
    const secret = 'shared-secret';
    const body = JSON.stringify({ hello: 'world' });
    const goodHex = crypto.createHmac('sha256', secret).update(body).digest('hex');

    test('accepts a valid signature with sha256= prefix', () => {
        expect(verifySignature(body, `sha256=${goodHex}`, secret)).toBe(true);
    });

    test('accepts a valid signature without prefix', () => {
        expect(verifySignature(body, goodHex, secret)).toBe(true);
    });

    test('rejects when secret / header / body is missing', () => {
        expect(verifySignature(body, `sha256=${goodHex}`, '')).toBe(false);
        expect(verifySignature(body, '', secret)).toBe(false);
        expect(verifySignature(null, `sha256=${goodHex}`, secret)).toBe(false);
    });

    test('rejects non-hex signature', () => {
        expect(verifySignature(body, 'sha256=ZZZZ-not-hex', secret)).toBe(false);
    });

    test('rejects wrong-length signature', () => {
        expect(verifySignature(body, 'sha256=deadbeef', secret)).toBe(false);
    });

    test('rejects signature signed with wrong secret', () => {
        const bad = crypto.createHmac('sha256', 'OTHER').update(body).digest('hex');
        expect(verifySignature(body, `sha256=${bad}`, secret)).toBe(false);
    });

    test('rejects when timingSafeEqual throws (defensive)', () => {
        // Force the buffers to differ in a way that should still go through the hex check
        // but produces a same-length string with valid hex characters but different bytes.
        const tampered = goodHex.replace(/[0-9]/g, '0').padEnd(goodHex.length, 'a').slice(0, goodHex.length);
        expect(verifySignature(body, `sha256=${tampered}`, secret)).toBe(false);
    });

    test('verifies a Buffer body the same as a string body', () => {
        const buf = Buffer.from(body, 'utf8');
        expect(verifySignature(buf, `sha256=${goodHex}`, secret)).toBe(true);
    });
});
