/**
 * Site Integration Webhook Bridge
 *
 * Single Responsibility: deliver chat lifecycle / message events to the
 * outbound webhook URL configured **on each site**. Each tenant owns its
 * own receiver URL and HMAC secret (see SiteRepository.integration).
 *
 * Design rules:
 *   - Multi-tenant. There is no global hub. The bridge looks up the
 *     site by `siteId` at send-time. If the site has no integration
 *     enabled, the call is a no-op.
 *   - Fire-and-forget. Never throws into the calling socket handler.
 *     If a tenant's receiver is unreachable / slow / 5xx, the customer
 *     chat keeps working — webhook errors are logged and swallowed.
 *
 * Auth: HMAC-SHA256 over the raw JSON body, sent in
 *   X-Chat-Signature: sha256=<hex>
 * The secret is the site-specific `integration.secret`. The receiver
 * verifies with the SAME secret (configured on its side when the site
 * admin generated it from /sites/:id/integration).
 */

const crypto = require('crypto');

/**
 * @param {Object} opts
 * @param {Object} opts.siteRepository - SiteRepository (must expose findById)
 * @param {Function} [opts.fetchImpl]  - fetch impl (defaults to global fetch; injected in tests)
 * @param {{ warn?: Function, info?: Function }} [opts.log]
 */
function createWebhookBridge({ siteRepository, fetchImpl, log = console } = {}) {
    const f = fetchImpl || globalThis.fetch;

    /**
     * Resolve a site's integration config. Returns null if disabled / missing.
     */
    function resolveTarget(siteId) {
        if (!siteId || !siteRepository || typeof siteRepository.findById !== 'function') return null;
        const site = siteRepository.findById(siteId);
        const integ = site?.integration;
        if (!integ || !integ.enabled || !integ.url || !integ.secret) return null;
        return { url: integ.url, secret: integ.secret, events: integ.events || null };
    }

    /**
     * POST a payload to the resolved tenant. Always resolves; never throws.
     * Skipped silently if no integration is configured for this site or the
     * event is not in the site's allow-list.
     *
     * @param {string} siteId
     * @param {Object} payload  - must include `event` and `messageId`
     */
    async function send(siteId, payload) {
        const target = resolveTarget(siteId);
        if (!target) return { ok: true, skipped: true };
        if (target.events && Array.isArray(target.events) && target.events.length > 0) {
            if (!target.events.includes(payload.event)) return { ok: true, skipped: true };
        }
        if (typeof f !== 'function') {
            log.warn?.('[webhook] no fetch implementation available; skipping');
            return { ok: false, error: 'no-fetch' };
        }
        try {
            const body = JSON.stringify(payload);
            const sig = crypto.createHmac('sha256', target.secret).update(body).digest('hex');
            const headers = {
                'content-type': 'application/json',
                'x-chat-signature': `sha256=${sig}`,
                'x-chat-event': String(payload.event || ''),
                'x-chat-delivery': String(payload.messageId || '')
            };
            const res = await f(target.url, { method: 'POST', headers, body });
            if (!res || !res.ok) {
                log.warn?.(
                    `[webhook] site=${siteId} non-OK ${res?.status ?? 'no-response'} for ${payload.event} ${payload.messageId}`
                );
                return { ok: false, status: res?.status };
            }
            return { ok: true };
        } catch (err) {
            log.warn?.(`[webhook] site=${siteId} error: ${err?.message || err}`);
            return { ok: false, error: err?.message || String(err) };
        }
    }

    /** Fire-and-forget mirror. Never throws. */
    function mirror(siteId, payload) {
        if (!resolveTarget(siteId)) return;
        Promise.resolve()
            .then(() => send(siteId, payload))
            .catch(() => { /* swallowed */ });
    }

    /** Generate a per-delivery messageId (used as idempotency key). */
    function genMessageId() {
        return crypto.randomUUID();
    }

    return { send, mirror, genMessageId, resolveTarget };
}

/**
 * Verify an inbound HMAC signature using a known site secret.
 * Constant-time compare.
 *
 * @param {string|Buffer} rawBody    Raw request body bytes
 * @param {string} signatureHeader   Value of `X-Chat-Signature` (with or without `sha256=` prefix)
 * @param {string} secret            The site's integration.secret
 * @returns {boolean}
 */
function verifySignature(rawBody, signatureHeader, secret) {
    if (!secret || !signatureHeader || rawBody == null) return false;
    const provided = String(signatureHeader).replace(/^sha256=/i, '').trim();
    if (!/^[0-9a-f]+$/i.test(provided)) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (provided.length !== expected.length) return false;
    try {
        return crypto.timingSafeEqual(
            Buffer.from(provided, 'hex'),
            Buffer.from(expected, 'hex')
        );
    } catch {
        return false;
    }
}

module.exports = {
    createWebhookBridge,
    verifySignature,
    // Back-compat alias for older imports.
    createLygHubWebhook: createWebhookBridge
};
