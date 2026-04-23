/**
 * Site Security Utilities
 *
 * Single Responsibility: Per-site security checks for widget endpoints.
 *  - Origin/Referer enforcement against site.allowed_origins
 *  - Per-site rate limiting (in-memory token bucket)
 */

/**
 * Extract the origin host from an Origin or Referer header value.
 * Returns lowercase "scheme://host[:port]" or null if invalid/empty.
 */
function parseOrigin(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        const u = new URL(value);
        return (u.origin || '').toLowerCase() || null;
    } catch (e) {
        return null;
    }
}

/**
 * Check if the given request Origin (or Referer) is allowed for a site.
 *
 * Behavior:
 *  - If site has no allowed_origins (null/empty) -> ALLOW (backward compatible).
 *  - If origin header is missing AND site has allowed_origins -> DENY.
 *  - Match is case-insensitive on full origin (scheme://host[:port]).
 *  - A configured entry of "*" allows any origin.
 *
 * @param {Object} site - Site record (must have allowed_origins).
 * @param {string|null|undefined} originHeader - Value of Origin or Referer header.
 * @returns {boolean}
 */
function isOriginAllowed(site, originHeader) {
    const allowed = site && site.allowed_origins;
    if (!Array.isArray(allowed) || allowed.length === 0) return true;
    if (allowed.includes('*')) return true;

    const origin = parseOrigin(originHeader);
    if (!origin) return false;

    return allowed.some(entry => {
        const e = String(entry || '').trim().toLowerCase();
        if (!e) return false;
        if (e === origin) return true;
        // Tolerate entries written as bare hostnames (e.g. "thelyg.com")
        try {
            const u = new URL(origin);
            if (u.host === e) return true;
            if (u.hostname === e) return true;
        } catch (_) { /* ignore */ }
        return false;
    });
}

/**
 * Per-site rate limiter (in-memory sliding window).
 *
 * Keyed by site api_key (or "anon" if no key supplied).
 * Default: 30 requests / minute per site key.
 */
class SiteRateLimiter {
    constructor(options = {}) {
        this.windowMs = options.windowMs || 60 * 1000;
        this.max = options.max || 30;
        this.buckets = new Map();

        this._cleanup = setInterval(() => this.cleanup(), this.windowMs);
        if (this._cleanup.unref) this._cleanup.unref();
    }

    /**
     * @param {string} key - Identifier (typically site api_key).
     * @returns {boolean} true = allowed, false = rate-limited.
     */
    check(key) {
        const id = key || 'anon';
        const now = Date.now();
        const arr = (this.buckets.get(id) || []).filter(t => now - t < this.windowMs);
        arr.push(now);
        this.buckets.set(id, arr);
        return arr.length <= this.max;
    }

    cleanup() {
        const now = Date.now();
        for (const [k, arr] of this.buckets.entries()) {
            const recent = arr.filter(t => now - t < this.windowMs);
            if (recent.length === 0) this.buckets.delete(k);
            else this.buckets.set(k, recent);
        }
    }

    stop() {
        if (this._cleanup) {
            clearInterval(this._cleanup);
            this._cleanup = null;
        }
    }

    clear() {
        this.buckets.clear();
    }
}

module.exports = {
    parseOrigin,
    isOriginAllowed,
    SiteRateLimiter
};
