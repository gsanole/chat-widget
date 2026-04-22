/**
 * Unit tests for rateLimiter middleware module.
 *
 * Focus: SocketRateLimiter (pure JS, no Express). The express-rate-limit
 * factories are smoke-tested for shape only.
 */

const { createApiLimiter, createAuthLimiter, SocketRateLimiter } =
    require('../../src/middleware/rateLimiter');

describe('createApiLimiter / createAuthLimiter', () => {
    test('returns Express middleware (function with 3 args)', () => {
        const mw = createApiLimiter();
        expect(typeof mw).toBe('function');
        // express-rate-limit middleware accepts (req, res, next)
        expect(mw.length).toBeGreaterThanOrEqual(2);
    });

    test('createAuthLimiter accepts overrides', () => {
        const mw = createAuthLimiter({ max: 1, windowMs: 1000 });
        expect(typeof mw).toBe('function');
    });
});

describe('SocketRateLimiter', () => {
    let limiter;

    afterEach(() => {
        if (limiter) limiter.stopCleanup();
    });

    test('skips rate limiting for localhost variants', () => {
        limiter = new SocketRateLimiter({ maxConnectionsPerIP: 1 });
        for (const ip of ['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']) {
            for (let i = 0; i < 10; i++) {
                expect(limiter.trackConnection(ip)).toBe(true);
            }
        }
    });

    test('allows up to max connections, then rejects', () => {
        limiter = new SocketRateLimiter({ maxConnectionsPerIP: 2 });
        expect(limiter.trackConnection('1.2.3.4')).toBe(true);
        expect(limiter.trackConnection('1.2.3.4')).toBe(true);
        expect(limiter.trackConnection('1.2.3.4')).toBe(false);
    });

    test('releaseConnection drops the most recent entry', () => {
        limiter = new SocketRateLimiter({ maxConnectionsPerIP: 2 });
        limiter.trackConnection('5.6.7.8');
        limiter.trackConnection('5.6.7.8');
        limiter.releaseConnection('5.6.7.8');
        expect(limiter.trackConnection('5.6.7.8')).toBe(true);
    });

    test('releaseConnection deletes ip when empty', () => {
        limiter = new SocketRateLimiter({ maxConnectionsPerIP: 1 });
        limiter.trackConnection('9.9.9.9');
        limiter.releaseConnection('9.9.9.9');
        expect(limiter.connectionTracker.has('9.9.9.9')).toBe(false);
    });

    test('releaseConnection is safe for unknown / falsy ip', () => {
        limiter = new SocketRateLimiter();
        expect(() => limiter.releaseConnection(null)).not.toThrow();
        expect(() => limiter.releaseConnection('never-tracked')).not.toThrow();
    });

    test('trackMessage allows up to max per minute, then rejects', () => {
        limiter = new SocketRateLimiter({ maxMessagesPerMinute: 3 });
        expect(limiter.trackMessage('s1')).toBe(true);
        expect(limiter.trackMessage('s1')).toBe(true);
        expect(limiter.trackMessage('s1')).toBe(true);
        expect(limiter.trackMessage('s1')).toBe(false);
    });

    test('clear() empties all tracking maps', () => {
        limiter = new SocketRateLimiter();
        limiter.trackConnection('1.1.1.1');
        limiter.trackMessage('s1');
        limiter.clear();
        expect(limiter.connectionTracker.size).toBe(0);
        expect(limiter.messageTracker.size).toBe(0);
    });

    test('startCleanup is idempotent (does not double-schedule)', () => {
        limiter = new SocketRateLimiter();
        const first = limiter._cleanupInterval;
        limiter.startCleanup();
        expect(limiter._cleanupInterval).toBe(first);
    });

    test('stopCleanup is safe to call multiple times', () => {
        limiter = new SocketRateLimiter();
        limiter.stopCleanup();
        expect(() => limiter.stopCleanup()).not.toThrow();
        expect(limiter._cleanupInterval).toBeNull();
    });

    test('cleanup interval prunes stale entries', () => {
        jest.useFakeTimers();
        limiter = new SocketRateLimiter({
            maxConnectionsPerIP: 5,
            maxMessagesPerMinute: 5,
            windowMs: 1000
        });
        limiter.trackConnection('1.1.1.1');
        limiter.trackMessage('s1');
        // Advance past the window so the cleanup tick removes entries
        jest.advanceTimersByTime(2000);
        expect(limiter.connectionTracker.size).toBe(0);
        expect(limiter.messageTracker.size).toBe(0);
        jest.useRealTimers();
    });

    test('windowMs defaults to 60000', () => {
        limiter = new SocketRateLimiter();
        expect(limiter.windowMs).toBe(60000);
    });
});
