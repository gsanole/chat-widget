/**
 * Unit tests for lyg_hub webhook bridge.
 *
 * Verifies:
 *  - Disabled when no URL configured.
 *  - HMAC-SHA256 over JSON body in `X-LygHub-Signature: sha256=<hex>`.
 *  - Sends to `${url}/inbound/chat` with POST + JSON body.
 *  - Network errors are swallowed (returns ok:false, never throws).
 *  - Non-OK responses return ok:false.
 *  - genMessageId returns a uuid-shaped string.
 */

const crypto = require('crypto');
const { createLygHubWebhook } = require('../../src/services/lygHubWebhook');

const SILENT = { warn: () => {}, info: () => {} };

describe('lygHubWebhook', () => {
    test('disabled when no url configured', async () => {
        const fetchImpl = jest.fn();
        const wh = createLygHubWebhook({ secret: 'x', fetchImpl, log: SILENT });
        expect(wh.enabled).toBe(false);
        const r = await wh.send({ event: 'message', messageId: 'a' });
        expect(r).toEqual({ ok: true, skipped: true });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('signs body with HMAC-SHA256 and POSTs JSON to /inbound/chat', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
        const secret = 'shared-secret-1234567890abcdef';
        const wh = createLygHubWebhook({
            url: 'https://hub.example.com/',
            secret,
            fetchImpl,
            log: SILENT
        });

        expect(wh.enabled).toBe(true);
        expect(wh.endpoint).toBe('https://hub.example.com/inbound/chat');

        const payload = {
            event: 'message',
            messageId: '11111111-1111-1111-1111-111111111111',
            sessionId: 'sess-abc',
            siteApiKey: 'sk-test',
            from: 'customer',
            senderId: 'sess-abc',
            senderName: 'Visitor',
            text: 'hello',
            escalate: false,
            ts: 1700000000000
        };

        const r = await wh.send(payload);
        expect(r).toEqual({ ok: true });
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        const [url, opts] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://hub.example.com/inbound/chat');
        expect(opts.method).toBe('POST');
        expect(opts.headers['content-type']).toBe('application/json');

        const expectedSig =
            'sha256=' +
            crypto.createHmac('sha256', secret).update(opts.body).digest('hex');
        expect(opts.headers['x-lyghub-signature']).toBe(expectedSig);

        // body is the same JSON we passed
        expect(JSON.parse(opts.body)).toEqual(payload);
    });

    test('omits signature header when no secret', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
        const wh = createLygHubWebhook({
            url: 'https://hub.example.com',
            fetchImpl,
            log: SILENT
        });
        await wh.send({ event: 'session.opened', messageId: 'x', sessionId: 's' });
        const [, opts] = fetchImpl.mock.calls[0];
        expect(opts.headers['x-lyghub-signature']).toBeUndefined();
    });

    test('swallows network errors (never throws)', async () => {
        const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        const wh = createLygHubWebhook({
            url: 'https://hub.example.com',
            secret: 'shared-secret-1234567890abcdef',
            fetchImpl,
            log: SILENT
        });
        const r = await wh.send({ event: 'message', messageId: 'x', sessionId: 's' });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/ECONNREFUSED/);
    });

    test('returns ok:false on non-OK response', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 502 });
        const wh = createLygHubWebhook({
            url: 'https://hub.example.com',
            secret: 'shared-secret-1234567890abcdef',
            fetchImpl,
            log: SILENT
        });
        const r = await wh.send({ event: 'message', messageId: 'x', sessionId: 's' });
        expect(r).toEqual({ ok: false, status: 502 });
    });

    test('genMessageId returns a uuid-shaped string', () => {
        const wh = createLygHubWebhook({
            url: 'https://hub.example.com',
            secret: 'shared-secret-1234567890abcdef',
            fetchImpl: jest.fn(),
            log: SILENT
        });
        const id = wh.genMessageId();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test('handles missing global fetch gracefully', async () => {
        const originalFetch = globalThis.fetch;
        // simulate environment without global fetch and no override
        // eslint-disable-next-line no-global-assign
        delete globalThis.fetch;
        try {
            const wh = createLygHubWebhook({
                url: 'https://hub.example.com',
                secret: 'shared-secret-1234567890abcdef',
                log: SILENT
            });
            const r = await wh.send({ event: 'message', messageId: 'x', sessionId: 's' });
            expect(r.ok).toBe(false);
            expect(r.error).toBe('no-fetch');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
