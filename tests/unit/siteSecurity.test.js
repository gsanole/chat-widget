/**
 * Unit tests for siteSecurity utilities
 */

const { parseOrigin, isOriginAllowed, SiteRateLimiter } = require('../../src/utils/siteSecurity');

describe('parseOrigin', () => {
    test('returns lowercase scheme://host[:port] for valid URL', () => {
        expect(parseOrigin('https://Example.com/path')).toBe('https://example.com');
        expect(parseOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    });

    test('returns null for empty / non-string input', () => {
        expect(parseOrigin('')).toBeNull();
        expect(parseOrigin(null)).toBeNull();
        expect(parseOrigin(undefined)).toBeNull();
        expect(parseOrigin(123)).toBeNull();
    });

    test('returns null for invalid URL', () => {
        expect(parseOrigin('not a url')).toBeNull();
    });
});

describe('isOriginAllowed', () => {
    test('allows when site has no allowed_origins (back-compat)', () => {
        expect(isOriginAllowed({}, 'https://anywhere.com')).toBe(true);
        expect(isOriginAllowed({ allowed_origins: null }, 'https://anywhere.com')).toBe(true);
        expect(isOriginAllowed({ allowed_origins: [] }, 'https://anywhere.com')).toBe(true);
    });

    test('allows when allowed_origins includes "*"', () => {
        expect(isOriginAllowed({ allowed_origins: ['*'] }, 'https://anywhere.com')).toBe(true);
    });

    test('denies when origin header is missing but allow-list exists', () => {
        expect(isOriginAllowed({ allowed_origins: ['https://a.com'] }, '')).toBe(false);
        expect(isOriginAllowed({ allowed_origins: ['https://a.com'] }, null)).toBe(false);
    });

    test('matches exact origin (case-insensitive)', () => {
        const site = { allowed_origins: ['https://thelyg.com'] };
        expect(isOriginAllowed(site, 'https://thelyg.com')).toBe(true);
        expect(isOriginAllowed(site, 'HTTPS://THELYG.COM')).toBe(true);
        expect(isOriginAllowed(site, 'https://other.com')).toBe(false);
    });

    test('matches bare hostname entry', () => {
        const site = { allowed_origins: ['thelyg.com'] };
        expect(isOriginAllowed(site, 'https://thelyg.com')).toBe(true);
        expect(isOriginAllowed(site, 'http://thelyg.com:80')).toBe(true);
        expect(isOriginAllowed(site, 'https://www.thelyg.com')).toBe(false);
    });

    test('skips empty entries in list', () => {
        const site = { allowed_origins: ['', '   ', 'https://thelyg.com'] };
        expect(isOriginAllowed(site, 'https://thelyg.com')).toBe(true);
    });

    test('returns false when origin header cannot be parsed', () => {
        const site = { allowed_origins: ['https://a.com'] };
        expect(isOriginAllowed(site, 'gibberish')).toBe(false);
    });
});

describe('SiteRateLimiter', () => {
    test('allows requests up to max', () => {
        const lim = new SiteRateLimiter({ max: 3, windowMs: 1000 });
        expect(lim.check('k')).toBe(true);
        expect(lim.check('k')).toBe(true);
        expect(lim.check('k')).toBe(true);
        expect(lim.check('k')).toBe(false);
        lim.stop();
    });

    test('separate keys have independent buckets', () => {
        const lim = new SiteRateLimiter({ max: 1, windowMs: 1000 });
        expect(lim.check('a')).toBe(true);
        expect(lim.check('b')).toBe(true);
        expect(lim.check('a')).toBe(false);
        lim.stop();
    });

    test('falls back to "anon" when no key supplied', () => {
        const lim = new SiteRateLimiter({ max: 1, windowMs: 1000 });
        expect(lim.check()).toBe(true);
        expect(lim.check(null)).toBe(false);
        lim.stop();
    });

    test('cleanup removes expired buckets', () => {
        const lim = new SiteRateLimiter({ max: 5, windowMs: 10 });
        lim.check('k');
        // Force time forward by manipulating bucket timestamps to be expired
        lim.buckets.set('k', [Date.now() - 1000]);
        lim.cleanup();
        expect(lim.buckets.has('k')).toBe(false);
        lim.stop();
    });

    test('clear empties all buckets', () => {
        const lim = new SiteRateLimiter({ max: 5, windowMs: 1000 });
        lim.check('k');
        lim.clear();
        expect(lim.buckets.size).toBe(0);
        lim.stop();
    });

    test('stop is idempotent', () => {
        const lim = new SiteRateLimiter();
        lim.stop();
        expect(() => lim.stop()).not.toThrow();
    });
});
