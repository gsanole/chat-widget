/**
 * Session / Audit Cleanup Service
 *
 * Single Responsibility: periodically purge stale audit log entries and
 * expired sessions. Runs as an interval that can be started and stopped.
 *
 * Designed for testability: callers inject the database, the interval
 * period, and (optionally) a logger. The handle returned exposes
 * start() / stop() so the lifecycle is owned by the caller, not by
 * the service or by the Express app instance.
 */

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;          // every hour
const DEFAULT_AUDIT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;     // 8 hours

/**
 * Create a cleanup service.
 *
 * @param {Object}   opts
 * @param {Object}   opts.db                       Database with `audit.cleanup` and `sessions.cleanup`.
 * @param {number}   [opts.intervalMs]             How often to run the sweep.
 * @param {number}   [opts.auditMaxAgeMs]          Audit-log retention.
 * @param {number}   [opts.sessionMaxAgeMs]        Session retention.
 * @param {Function} [opts.onError]                Called on sweep failure (defaults to console.error).
 *
 * @returns {{ start: () => void, stop: () => void, runOnce: () => void }}
 */
function createSessionCleanupService({
    db,
    intervalMs = DEFAULT_INTERVAL_MS,
    auditMaxAgeMs = DEFAULT_AUDIT_MAX_AGE_MS,
    sessionMaxAgeMs = DEFAULT_SESSION_MAX_AGE_MS,
    onError = (err) => console.error('Cleanup error:', err)
} = {}) {
    if (!db) throw new Error('createSessionCleanupService: db is required');

    let timer = null;

    function runOnce() {
        try {
            if (db.audit && typeof db.audit.cleanup === 'function') {
                db.audit.cleanup(auditMaxAgeMs);
            }
            if (db.sessions && typeof db.sessions.cleanup === 'function') {
                db.sessions.cleanup(sessionMaxAgeMs);
            }
        } catch (err) {
            onError(err);
        }
    }

    function start() {
        if (timer) return;
        timer = setInterval(runOnce, intervalMs);
        // Don't let the cleanup timer keep the process (or Jest) alive.
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
    }

    function stop() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    return { start, stop, runOnce };
}

module.exports = { createSessionCleanupService };
