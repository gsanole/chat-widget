/**
 * lyg_hub Webhook Bridge
 *
 * Single Responsibility: fire chat lifecycle events at the lyg_hub
 * `/inbound/chat` endpoint so the support team can triage them in
 * the lyg_hub /inbox.
 *
 * Design rules (mirror lyg_hub side):
 *   - chat events are NOT auto-tickets in lyg_hub by default; they
 *     land as `pending`. lyg_hub only routes a delivery into a
 *     ticket when `escalate=true` OR the session is already linked.
 *   - this client never throws into the calling socket handler.
 *     If lyg_hub is unreachable / slow / 5xx, the customer chat
 *     keeps working — webhook errors are logged and swallowed.
 *
 * Auth: HMAC-SHA256 over the raw JSON body, sent in
 * `X-LygHub-Signature: sha256=<hex>`. Secret comes from
 * LYG_HUB_INBOUND_CHAT_SECRET (must match lyg_hub's).
 *
 * Disabled when LYG_HUB_URL is unset (e.g. local dev without lyg_hub).
 */

const crypto = require('crypto');

/**
 * @param {Object} opts
 * @param {string} [opts.url]    - Base URL of lyg_hub (e.g. https://hub.example.com)
 * @param {string} [opts.secret] - HMAC secret shared with lyg_hub
 * @param {Function} [opts.fetchImpl] - fetch impl (defaults to global fetch; injected in tests)
 * @param {{ warn?: Function, info?: Function }} [opts.log]
 */
function createLygHubWebhook({ url, secret, fetchImpl, log = console } = {}) {
    const enabled = !!url;
    const f = fetchImpl || globalThis.fetch;
    const endpoint = enabled ? `${url.replace(/\/+$/, '')}/inbound/chat` : null;

    /**
     * Send an event to lyg_hub. Always resolves; never throws.
     * @param {Object} payload - Event payload (see lyg_hub chatInboundPayload schema)
     * @returns {Promise<{ok:boolean, skipped?:boolean, status?:number, error?:string}>}
     */
    async function send(payload) {
        if (!enabled) return { ok: true, skipped: true };
        if (typeof f !== 'function') {
            log.warn?.('[lygHub] no fetch implementation available; skipping');
            return { ok: false, error: 'no-fetch' };
        }
        try {
            const body = JSON.stringify(payload);
            const headers = { 'content-type': 'application/json' };
            if (secret) {
                const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
                headers['x-lyghub-signature'] = `sha256=${sig}`;
            }
            const res = await f(endpoint, { method: 'POST', headers, body });
            if (!res || !res.ok) {
                log.warn?.(
                    `[lygHub] non-OK ${res?.status ?? 'no-response'} for ${payload.event} ${payload.messageId}`
                );
                return { ok: false, status: res?.status };
            }
            return { ok: true };
        } catch (err) {
            log.warn?.(`[lygHub] webhook error: ${err?.message || err}`);
            return { ok: false, error: err?.message || String(err) };
        }
    }

    /** Generate a per-delivery messageId (lyg_hub uses this as idempotency key). */
    function genMessageId() {
        return crypto.randomUUID();
    }

    return { send, genMessageId, enabled, endpoint };
}

module.exports = { createLygHubWebhook };
