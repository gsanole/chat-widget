/**
 * Unit tests for SessionCleanupService.
 */

const { createSessionCleanupService } = require('../../src/services/SessionCleanupService');

function makeDb() {
    return {
        audit: { cleanup: jest.fn() },
        sessions: { cleanup: jest.fn() }
    };
}

describe('SessionCleanupService', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    test('throws if db is not provided', () => {
        expect(() => createSessionCleanupService({})).toThrow(/db is required/);
    });

    test('returns start, stop, runOnce', () => {
        const svc = createSessionCleanupService({ db: makeDb() });
        expect(typeof svc.start).toBe('function');
        expect(typeof svc.stop).toBe('function');
        expect(typeof svc.runOnce).toBe('function');
    });

    test('runOnce calls audit.cleanup and sessions.cleanup with defaults', () => {
        const db = makeDb();
        const svc = createSessionCleanupService({ db });
        svc.runOnce();
        expect(db.audit.cleanup).toHaveBeenCalledWith(30 * 24 * 60 * 60 * 1000);
        expect(db.sessions.cleanup).toHaveBeenCalledWith(8 * 60 * 60 * 1000);
    });

    test('runOnce respects custom retention values', () => {
        const db = makeDb();
        const svc = createSessionCleanupService({
            db,
            auditMaxAgeMs: 1000,
            sessionMaxAgeMs: 2000
        });
        svc.runOnce();
        expect(db.audit.cleanup).toHaveBeenCalledWith(1000);
        expect(db.sessions.cleanup).toHaveBeenCalledWith(2000);
    });

    test('runOnce tolerates missing audit/sessions cleanup methods', () => {
        const svc = createSessionCleanupService({ db: { audit: {}, sessions: {} } });
        expect(() => svc.runOnce()).not.toThrow();
    });

    test('runOnce calls onError when a cleanup throws', () => {
        const onError = jest.fn();
        const boom = new Error('boom');
        const db = {
            audit: { cleanup: () => { throw boom; } },
            sessions: { cleanup: jest.fn() }
        };
        const svc = createSessionCleanupService({ db, onError });
        svc.runOnce();
        expect(onError).toHaveBeenCalledWith(boom);
    });

    test('start schedules an interval that runs cleanup', () => {
        jest.useFakeTimers();
        const db = makeDb();
        const svc = createSessionCleanupService({ db, intervalMs: 1000 });
        svc.start();
        expect(db.audit.cleanup).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1000);
        expect(db.audit.cleanup).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(2000);
        expect(db.audit.cleanup).toHaveBeenCalledTimes(3);
        svc.stop();
    });

    test('start is idempotent (calling twice does not double-schedule)', () => {
        jest.useFakeTimers();
        const db = makeDb();
        const svc = createSessionCleanupService({ db, intervalMs: 1000 });
        svc.start();
        svc.start();
        jest.advanceTimersByTime(1000);
        expect(db.audit.cleanup).toHaveBeenCalledTimes(1);
        svc.stop();
    });

    test('stop clears the interval and is safe to call multiple times', () => {
        jest.useFakeTimers();
        const db = makeDb();
        const svc = createSessionCleanupService({ db, intervalMs: 1000 });
        svc.start();
        svc.stop();
        svc.stop(); // no-op
        jest.advanceTimersByTime(5000);
        expect(db.audit.cleanup).not.toHaveBeenCalled();
    });

    test('default onError logs to console.error without throwing', () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const db = {
            audit: { cleanup: () => { throw new Error('x'); } },
            sessions: { cleanup: jest.fn() }
        };
        const svc = createSessionCleanupService({ db });
        expect(() => svc.runOnce()).not.toThrow();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});
