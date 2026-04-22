/**
 * Smoke test that simply require()s the barrel index files so they
 * register against the coverage report. These files are pure
 * re-exports and have no behavior worth asserting individually, but
 * they need to be loaded at least once to count as covered.
 */

describe('barrel re-exports load successfully', () => {
    test('src/index.js exports core modules', () => {
        const all = require('../../src/index');
        expect(all).toBeDefined();
        expect(typeof all).toBe('object');
    });

    test('src/middleware/index.js exposes auth + rate limiter', () => {
        const m = require('../../src/middleware');
        expect(typeof m.createAuthMiddleware).toBe('function');
        expect(typeof m.createApiLimiter).toBe('function');
        expect(typeof m.SocketRateLimiter).toBe('function');
    });

    test('src/config/index.js re-exports config submodules', () => {
        const c = require('../../src/config');
        expect(c.JWT_SECRET).toBeDefined();
    });

    test('src/socket/handlers/index.js exposes handler factories', () => {
        const h = require('../../src/socket/handlers');
        expect(typeof h.createAdminHandlers).toBe('function');
        expect(typeof h.createChatHandlers).toBe('function');
        expect(typeof h.createSessionHandlers).toBe('function');
    });
});
