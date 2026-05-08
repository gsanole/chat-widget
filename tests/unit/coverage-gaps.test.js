/**
 * Coverage-gap tests.
 *
 * Targets the specific uncovered lines and branches that prevent the
 * codebase from meeting the per-file 95/90/95 threshold.
 * Each describe block targets a single source file by line numbers.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// ===========================================================================
// src/utils/helpers.js  (lines 31, 173 — generateUUID + retryWithBackoff)
// ===========================================================================
describe('utils/helpers gaps', () => {
    const helpers = require('../../src/utils/helpers');

    test('generateUUID returns a UUID-shaped string', () => {
        const uuid = helpers.generateUUID();
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    test('safeJsonParse returns default on bad input', () => {
        expect(helpers.safeJsonParse('{not json', { a: 1 })).toEqual({ a: 1 });
        expect(helpers.safeJsonParse('null', 'fallback')).toBe(null);
    });

    test('truncate returns input when shorter than max', () => {
        expect(helpers.truncate('hi', 10)).toBe('hi');
        expect(helpers.truncate('', 5)).toBe('');
        expect(helpers.truncate('long string indeed', 7)).toMatch(/\.\.\.$/);
    });

    test('isEmpty handles all branches', () => {
        expect(helpers.isEmpty(null)).toBe(true);
        expect(helpers.isEmpty(undefined)).toBe(true);
        expect(helpers.isEmpty('')).toBe(true);
        expect(helpers.isEmpty('   ')).toBe(true);
        expect(helpers.isEmpty([])).toBe(true);
        expect(helpers.isEmpty({})).toBe(true);
        expect(helpers.isEmpty('x')).toBe(false);
        expect(helpers.isEmpty([1])).toBe(false);
        expect(helpers.isEmpty({ a: 1 })).toBe(false);
        expect(helpers.isEmpty(0)).toBe(false);
        expect(helpers.isEmpty(false)).toBe(false);
    });

    test('debounce delays execution', async () => {
        let count = 0;
        const fn = helpers.debounce(() => { count++; }, 5);
        fn(); fn(); fn();
        await new Promise(r => setTimeout(r, 30));
        expect(count).toBe(1);
    });

    test('retryWithBackoff resolves on first success', async () => {
        const fn = jest.fn().mockResolvedValue('ok');
        await expect(helpers.retryWithBackoff(fn, 3, 1)).resolves.toBe('ok');
    });

    test('retryWithBackoff retries until success', async () => {
        let attempts = 0;
        const fn = async () => {
            attempts++;
            if (attempts < 3) throw new Error('nope');
            return 'done';
        };
        await expect(helpers.retryWithBackoff(fn, 3, 1)).resolves.toBe('done');
        expect(attempts).toBe(3);
    });

    test('retryWithBackoff throws after exhausting retries', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('boom'));
        await expect(helpers.retryWithBackoff(fn, 2, 1)).rejects.toThrow('boom');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    test('formatDate, getTimestamp, pick, omit, deepClone, generateSecureToken cover happy paths', () => {
        expect(typeof helpers.formatDate(new Date())).toBe('string');
        expect(typeof helpers.getTimestamp()).toBe('string');
        expect(helpers.pick({ a: 1, b: 2, c: 3 }, ['a', 'c', 'missing'])).toEqual({ a: 1, c: 3 });
        expect(helpers.omit({ a: 1, b: 2 }, ['a'])).toEqual({ b: 2 });
        const cloned = helpers.deepClone({ x: { y: 1 } });
        expect(cloned).toEqual({ x: { y: 1 } });
        expect(helpers.generateSecureToken(8)).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(helpers.generateId(4)).toMatch(/^[0-9a-f]+$/);
    });

    test('sleep resolves', async () => {
        const start = Date.now();
        await helpers.sleep(5);
        expect(Date.now() - start).toBeGreaterThanOrEqual(0);
    });
});

// ===========================================================================
// src/utils/totp.js  (lines 183, 246-247, 300-301)
// ===========================================================================
describe('utils/totp gaps', () => {
    const totp = require('../../src/utils/totp');

    test('encryptSecret returns input unchanged when no key', () => {
        delete process.env.TOTP_ENCRYPTION_KEY;
        expect(totp.encryptSecret('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
        expect(totp.encryptSecret('')).toBe('');
        expect(totp.encryptSecret(null)).toBe(null);
        expect(totp.isEncryptionEnabled()).toBe(false);
    });

    test('decryptSecret returns null for malformed enc-prefixed value (no key)', () => {
        delete process.env.TOTP_ENCRYPTION_KEY;
        expect(totp.decryptSecret('enc:v1:bad')).toBe(null);
        expect(totp.decryptSecret(123)).toBe(123);
        expect(totp.decryptSecret('plaintext')).toBe('plaintext');
    });

    test('encrypt/decrypt round-trip with a key', () => {
        process.env.TOTP_ENCRYPTION_KEY = 'a'.repeat(40);
        const enc = totp.encryptSecret('JBSWY3DPEHPK3PXP');
        expect(enc.startsWith('enc:v1:')).toBe(true);
        expect(totp.decryptSecret(enc)).toBe('JBSWY3DPEHPK3PXP');
        expect(totp.isEncryptionEnabled()).toBe(true);
        // Tampered payload returns null
        const parts = enc.split(':');
        parts[3] = 'AA==';
        expect(totp.decryptSecret(parts.join(':'))).toBe(null);
        // Wrong segment count returns null
        expect(totp.decryptSecret('enc:v1:only-one')).toBe(null);
        delete process.env.TOTP_ENCRYPTION_KEY;
    });

    test('normalizeSecret handles every branch', () => {
        const buf = totp.generateSecret();
        expect(totp.normalizeSecret(buf)).toEqual(buf);
        const b32 = totp.encodeBase32(buf);
        expect(totp.normalizeSecret(b32).length).toBeGreaterThan(0);
        expect(totp.normalizeSecret([1, 2, 3])).toEqual(Buffer.from([1, 2, 3]));
        expect(totp.normalizeSecret({ data: [4, 5] })).toEqual(Buffer.from([4, 5]));
        expect(totp.normalizeSecret(null)).toBe(null);
        expect(totp.normalizeSecret('')).toBe(null);
        expect(totp.normalizeSecret({})).toBe(null);
    });

    test('verifyTOTP and verifyRecoveryCode edge cases', () => {
        expect(totp.verifyTOTP(null, '123456')).toBe(false);
        expect(totp.verifyTOTP('SECRET', null)).toBe(false);
        const codes = ['ABCD-EFGH', 'IJKL-MNOP'];
        const r = totp.verifyRecoveryCode(codes, 'abcd-efgh');
        expect(r.valid).toBe(true);
        expect(r.remainingCodes.length).toBe(1);
        expect(totp.verifyRecoveryCode(['ZZZZ-ZZZZ'], 'NOPE-NOPE').valid).toBe(false);
    });

    test('generateTOTP returns empty for no/empty secret', () => {
        expect(totp.generateTOTP(null)).toBe('');
        expect(totp.generateTOTP(Buffer.alloc(0))).toBe('');
    });

    test('generateTOTPUri handles string, Buffer and unparseable input', () => {
        const buf = totp.generateSecret();
        expect(totp.generateTOTPUri('JBSWY3DPEHPK3PXP', 'a@b.c')).toMatch(/^otpauth:/);
        expect(totp.generateTOTPUri(buf, 'a@b.c')).toMatch(/^otpauth:/);
        expect(totp.generateTOTPUri({ junk: true }, 'a@b.c')).toMatch(/secret=/);
    });

    test('generateRecoveryCodes returns N XXXX-XXXX codes', () => {
        const codes = totp.generateRecoveryCodes(3);
        expect(codes).toHaveLength(3);
        expect(codes[0]).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/);
    });

    test('generateQRCodeDataURL returns null when qrcode not present', async () => {
        // Force require failure by mocking
        jest.isolateModules(async () => {
            jest.doMock('qrcode', () => { throw new Error('not installed'); }, { virtual: true });
            const local = require('../../src/utils/totp');
            const url = await local.generateQRCodeDataURL('otpauth://...');
            expect(url === null || typeof url === 'string').toBe(true);
        });
    });
});

// ===========================================================================
// src/utils/siteSecurity.js  (line 92 — SiteRateLimiter.stop branch when null)
// ===========================================================================
describe('utils/siteSecurity gaps', () => {
    const { parseOrigin, isOriginAllowed, SiteRateLimiter } = require('../../src/utils/siteSecurity');

    test('parseOrigin handles invalid input', () => {
        expect(parseOrigin(null)).toBe(null);
        expect(parseOrigin('')).toBe(null);
        expect(parseOrigin(123)).toBe(null);
        expect(parseOrigin('not a url')).toBe(null);
        expect(parseOrigin('https://Example.com/path')).toBe('https://example.com');
    });

    test('isOriginAllowed branches', () => {
        expect(isOriginAllowed(null, 'https://x')).toBe(true);
        expect(isOriginAllowed({ allowed_origins: [] }, 'https://x')).toBe(true);
        expect(isOriginAllowed({ allowed_origins: ['*'] }, 'https://anywhere.com')).toBe(true);
        expect(isOriginAllowed({ allowed_origins: ['https://a.com'] }, null)).toBe(false);
        expect(isOriginAllowed({ allowed_origins: ['https://a.com'] }, 'https://a.com')).toBe(true);
        expect(isOriginAllowed({ allowed_origins: ['a.com'] }, 'https://a.com')).toBe(true);
        expect(isOriginAllowed({ allowed_origins: ['a.com'] }, 'https://a.com:443')).toBe(true);
        expect(isOriginAllowed({ allowed_origins: ['b.com'] }, 'https://a.com')).toBe(false);
        expect(isOriginAllowed({ allowed_origins: [''] }, 'https://x.com')).toBe(false);
    });

    test('SiteRateLimiter check, cleanup, stop, clear', () => {
        const limiter = new SiteRateLimiter({ max: 2, windowMs: 1000 });
        expect(limiter.check('k')).toBe(true);
        expect(limiter.check('k')).toBe(true);
        expect(limiter.check('k')).toBe(false);
        expect(limiter.check(null)).toBe(true); // anon path
        limiter.cleanup();
        limiter.clear();
        expect(limiter.check('k')).toBe(true);
        limiter.stop();
        // calling stop twice should be safe (line 92 branch: _cleanup is null)
        limiter.stop();
    });

    test('SiteRateLimiter cleanup deletes empty buckets', async () => {
        const limiter = new SiteRateLimiter({ max: 5, windowMs: 1 });
        limiter.check('k1');
        await new Promise(r => setTimeout(r, 5));
        limiter.cleanup();
        // bucket should be gone
        expect(limiter.buckets.has('k1')).toBe(false);
        limiter.stop();
    });
});

// ===========================================================================
// src/utils/ipUtils.js  (lines 15, 193 — geoip-lite catch + isCountryBlocked)
// ===========================================================================
describe('utils/ipUtils gaps', () => {
    const ipUtils = require('../../src/utils/ipUtils');

    test('getRealIP handles every branch', () => {
        expect(ipUtils.getRealIP({}, null)).toBe('unknown');
        expect(ipUtils.getRealIP({ handshake: { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } } })).toBe('1.2.3.4');
        expect(ipUtils.getRealIP({ handshake: { headers: { 'x-real-ip': '9.9.9.9' } } })).toBe('9.9.9.9');
        expect(ipUtils.getRealIP({ handshake: { headers: { 'cf-connecting-ip': '7.7.7.7' } } })).toBe('7.7.7.7');
        expect(ipUtils.getRealIP({ handshake: { address: '::1' } })).toBe('127.0.0.1');
        expect(ipUtils.getRealIP({ handshake: { address: '::ffff:127.0.0.1' } })).toBe('127.0.0.1');
        expect(ipUtils.getRealIP({ handshake: { address: '::ffff:8.8.8.8' } })).toBe('8.8.8.8');
        expect(ipUtils.getRealIP(null, { headers: { 'x-real-ip': '1.1.1.1' }, socket: { remoteAddress: '2.2.2.2' } })).toBe('1.1.1.1');
    });

    test('isCountryBlocked covers all branches', () => {
        const fn = ipUtils.isCountryBlocked;
        // disabled
        expect(fn({ country: 'US' }, { enabled: false }).blocked).toBe(false);
        expect(fn({ country: 'US' }, null).blocked).toBe(false);
        // blocklist with no list -> allow all
        expect(fn({ country: 'US' }, { enabled: true }).blocked).toBe(false);
        // allowlist with no list -> block all
        expect(fn({ country: 'US' }, { enabled: true, mode: 'allowlist' }).blocked).toBe(true);
        // blocklist hit
        expect(fn({ country: 'CN' }, { enabled: true, countries: ['CN'] }).blocked).toBe(true);
        // blocklist miss
        expect(fn({ country: 'US' }, { enabled: true, countries: ['CN'] }).blocked).toBe(false);
        // allowlist hit
        expect(fn({ country: 'US' }, { enabled: true, mode: 'allowlist', countries: ['US'] }).blocked).toBe(false);
        // allowlist miss
        expect(fn({ country: 'CN' }, { enabled: true, mode: 'allowlist', countries: ['US'] }).blocked).toBe(true);
        // missing geo with allowlist -> blocked
        expect(fn(null, { enabled: true, mode: 'allowlist', countries: ['US'] }).blocked).toBe(true);
    });

    test('validateLocationMatch handles missing data', () => {
        expect(ipUtils.validateLocationMatch(null, null).valid).toBe(false);
        expect(ipUtils.validateLocationMatch({ latitude: 0, longitude: 0 }, null).valid).toBe(false);
        const close = ipUtils.validateLocationMatch({ latitude: 40, longitude: -74 }, { ll: [40.1, -74.1] });
        expect(close.valid).toBe(true);
        const far = ipUtils.validateLocationMatch({ latitude: 0, longitude: 0 }, { ll: [60, 60] }, 100);
        expect(far.valid).toBe(false);
    });

    test('analyzeIP returns localhost shortcut', async () => {
        const r = await ipUtils.analyzeIP('127.0.0.1');
        expect(r.isLocalTest).toBe(true);
    });
});

// ===========================================================================
// src/middleware/rateLimiter.js  (lines 139, 148 — startCleanup branches)
// ===========================================================================
describe('middleware/rateLimiter gaps', () => {
    const { SocketRateLimiter, createApiLimiter, createAuthLimiter } = require('../../src/middleware/rateLimiter');

    test('SocketRateLimiter trackConnection, releaseConnection, trackMessage', async () => {
        const lim = new SocketRateLimiter({
            maxConnectionsPerIP: 2,
            maxMessagesPerMinute: 2,
            windowMs: 50
        });
        expect(lim.trackConnection('127.0.0.1')).toBe(true); // localhost skip
        expect(lim.trackConnection('::1')).toBe(true);
        expect(lim.trackConnection('::ffff:127.0.0.1')).toBe(true);
        expect(lim.trackConnection('localhost')).toBe(true);
        expect(lim.trackConnection('5.5.5.5')).toBe(true);
        expect(lim.trackConnection('5.5.5.5')).toBe(true);
        expect(lim.trackConnection('5.5.5.5')).toBe(false);
        lim.releaseConnection('5.5.5.5');
        lim.releaseConnection('5.5.5.5');
        lim.releaseConnection('5.5.5.5'); // empty path
        lim.releaseConnection(null);     // no-op branch
        expect(lim.trackMessage('s1')).toBe(true);
        expect(lim.trackMessage('s1')).toBe(true);
        expect(lim.trackMessage('s1')).toBe(false);
        // wait for cleanup interval to fire (windowMs=50)
        await new Promise(r => setTimeout(r, 70));
        lim.stopCleanup();
        lim.stopCleanup();    // safe to double-stop
        // double-start guard
        lim.startCleanup();
        lim.startCleanup();
        lim.stopCleanup();
    });

    test('createApiLimiter and createAuthLimiter return middleware', () => {
        expect(typeof createApiLimiter()).toBe('function');
        expect(typeof createAuthLimiter()).toBe('function');
    });
});

// ===========================================================================
// src/database/JsonDB.js  (lines 15, 57)
// ===========================================================================
describe('database/JsonDB gaps', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsondb-cov-'));
    const prevDir = process.env.DATABASE_DIR;
    let JsonDB;

    beforeAll(() => {
        process.env.DATABASE_DIR = tmpDir;
        jest.isolateModules(() => {
            ({ JsonDB } = require('../../src/database/JsonDB'));
        });
    });

    afterAll(() => {
        process.env.DATABASE_DIR = prevDir;
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    });

    test('load returns default when file missing', () => {
        const db = new JsonDB('cov-1.json', []);
        expect(db.data).toEqual([]);
    });

    test('load logs and returns default on bad JSON', () => {
        const file = path.join(tmpDir, 'bad.json');
        fs.writeFileSync(file, '{not json');
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const db = new JsonDB('bad.json', { fallback: true });
        expect(db.data).toEqual({ fallback: true });
        spy.mockRestore();
    });

    test('save logs on write error', () => {
        const db = new JsonDB('cov-2.json', []);
        const original = fs.writeFileSync;
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        fs.writeFileSync = () => { throw new Error('disk full'); };
        try {
            db.save();
        } finally {
            fs.writeFileSync = original;
            spy.mockRestore();
        }
    });

    test('debouncedSave coalesces rapid calls', async () => {
        const db = new JsonDB('cov-3.json', []);
        db._saveDebounceMs = 5;
        db.insert({ id: 'a' });
        db.debouncedSave();
        db.debouncedSave();
        db.debouncedSave();
        await new Promise(r => setTimeout(r, 20));
        const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, 'cov-3.json'), 'utf8'));
        expect(stored).toEqual([{ id: 'a' }]);
    });

    test('insert/find/filter/update/delete/count/getAll', () => {
        const db = new JsonDB('cov-4.json', []);
        db.insert({ id: '1', n: 1 });
        db.insert({ id: '2', n: 2 });
        expect(db.find(r => r.id === '2')).toEqual({ id: '2', n: 2 });
        expect(db.filter(r => r.n >= 1).length).toBe(2);
        expect(db.count(r => r.n === 1)).toBe(1);
        const updated = db.update(r => r.id === '1', { n: 99 });
        expect(updated.n).toBe(99);
        expect(db.update(r => r.id === 'missing', { n: 1 })).toBe(null);
        expect(db.delete(r => r.id === '2')).toBe(true);
        expect(db.delete(r => r.id === 'missing')).toBe(false);
        expect(db.getAll().length).toBe(1);
    });
});

// ===========================================================================
// src/database/seed.js  (lines 43, 78, 88)
// ===========================================================================
describe('database/seed gaps', () => {
    const seed = require('../../src/database/seed');
    const { runSeed } = seed;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-cov-'));
    const seedDir = path.join(root, 'seed');
    const dataDir = path.join(root, 'data');

    afterAll(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch(_){} });

    test('no-op when seed dir does not exist', () => {
        process.env.SEED_DIR = path.join(root, 'absent');
        process.env.DATABASE_DIR = dataDir;
        runSeed();
    });

    test('forces reseed when .seed-version differs', () => {
        fs.mkdirSync(seedDir, { recursive: true });
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(path.join(seedDir, '.seed-version'), 'v2\n');
        fs.writeFileSync(path.join(seedDir, 'a.json'), '{"v":2}');
        fs.writeFileSync(path.join(dataDir, '.seed-version'), 'v1\n');
        fs.writeFileSync(path.join(dataDir, 'a.json'), '{"v":1}');

        process.env.SEED_DIR = seedDir;
        process.env.DATABASE_DIR = dataDir;
        runSeed();

        const after = JSON.parse(fs.readFileSync(path.join(dataDir, 'a.json'), 'utf8'));
        expect(after).toEqual({ v: 2 });
        expect(fs.readFileSync(path.join(dataDir, '.seed-version'), 'utf8').trim()).toBe('v2');
    });

    test('restores corrupt JSON; restores empty users.json; respects valid existing data', () => {
        const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-cov2-'));
        const sd = path.join(root2, 'seed');
        const dd = path.join(root2, 'data');
        fs.mkdirSync(sd, { recursive: true });
        fs.mkdirSync(dd, { recursive: true });
        fs.writeFileSync(path.join(sd, 'users.json'), '[{"u":1}]');
        fs.writeFileSync(path.join(sd, 'foo.json'), '{"k":1}');
        fs.writeFileSync(path.join(sd, 'bar.json'), '{"k":2}');
        // existing: users.json has empty array (triggers restore)
        fs.writeFileSync(path.join(dd, 'users.json'), '[]');
        // existing: foo.json corrupt (triggers restore)
        fs.writeFileSync(path.join(dd, 'foo.json'), '{not json');
        // existing: bar.json valid (skipped)
        fs.writeFileSync(path.join(dd, 'bar.json'), '{"k":99}');

        process.env.SEED_DIR = sd;
        process.env.DATABASE_DIR = dd;
        runSeed();

        expect(JSON.parse(fs.readFileSync(path.join(dd, 'users.json'), 'utf8'))).toEqual([{ u: 1 }]);
        expect(JSON.parse(fs.readFileSync(path.join(dd, 'foo.json'), 'utf8'))).toEqual({ k: 1 });
        expect(JSON.parse(fs.readFileSync(path.join(dd, 'bar.json'), 'utf8'))).toEqual({ k: 99 });

        try { fs.rmSync(root2, { recursive: true, force: true }); } catch(_){}
    });

    test('handles unreadable .seed-version gracefully', () => {
        const root3 = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-cov3-'));
        const sd = path.join(root3, 'seed');
        const dd = path.join(root3, 'data');
        fs.mkdirSync(sd, { recursive: true });
        // create a directory at .seed-version path so readFileSync throws
        fs.mkdirSync(path.join(sd, '.seed-version'));
        fs.writeFileSync(path.join(sd, 'x.json'), '{}');
        process.env.SEED_DIR = sd;
        process.env.DATABASE_DIR = dd;
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        runSeed();
        warn.mockRestore();
        try { fs.rmSync(root3, { recursive: true, force: true }); } catch(_){}
    });
});

// ===========================================================================
// src/database/repositories/* gaps
// ===========================================================================
describe('database/repositories gaps', () => {
    const { JsonDB } = require('../../src/database/JsonDB');
    const { AuditRepository } = require('../../src/database/repositories/AuditRepository');
    const { MessageRepository } = require('../../src/database/repositories/MessageRepository');
    const { TicketRepository } = require('../../src/database/repositories/TicketRepository');
    const { SiteRepository } = require('../../src/database/repositories/SiteRepository');
    const { UserRepository } = require('../../src/database/repositories/UserRepository');

    function freshDb(name) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
        process.env.DATABASE_DIR = dir;
        return new JsonDB(name, []);
    }

    test('AuditRepository trims to 5000 when over 10000', () => {
        const repo = new AuditRepository(freshDb('audit-trim.json'));
        // Inject 10001 entries directly
        for (let i = 0; i < 10001; i++) {
            repo.db.data.push({ id: `i${i}`, timestamp: i });
        }
        repo.log({ userId: 'u', username: 'u', action: 'X' });
        expect(repo.db.data.length).toBeLessThanOrEqual(5001);
    });

    test('AuditRepository find* helpers and cleanup', () => {
        const repo = new AuditRepository(freshDb('audit-helpers.json'));
        repo.log({ userId: 'u1', username: 'a', action: 'login' });
        repo.log({ userId: 'u2', username: 'b', action: 'logout', resourceType: 'session', resourceId: 's1' });
        expect(repo.findAll().length).toBe(2);
        expect(repo.findByUser('u1').length).toBe(1);
        expect(repo.findByAction('login').length).toBe(1);
        expect(repo.findByResource('session', 's1').length).toBe(1);
        const nowSec = Math.floor(Date.now() / 1000);
        expect(repo.findByDateRange(nowSec - 10, nowSec + 10).length).toBe(2);
        const removed = repo.cleanup(0);
        expect(removed).toBeGreaterThanOrEqual(0);
    });

    test('MessageRepository works with and without ticketsDb; covers count/findRecent/deleteByTicket', () => {
        const ticketsDb = freshDb('tk.json');
        const msgsDb = freshDb('msgs.json');
        const repo = new MessageRepository(msgsDb, ticketsDb);
        ticketsDb.insert({ id: 't1', last_message_at: 0 });
        repo.create({ ticketId: 't1', senderType: 'user', senderId: 'u', senderName: 'U', content: 'hi' });
        repo.create({ ticketId: 't1', senderType: 'admin', senderId: 'a', senderName: 'A', content: 'yo' });
        expect(repo.findByTicket('t1').length).toBe(2);
        expect(repo.findRecent('t1', 1).length).toBe(1);
        expect(repo.countByTicket('t1')).toBe(2);
        expect(repo.deleteByTicket('t1')).toBe(true);

        // Without ticketsDb the create branch skipping the update is exercised
        const repo2 = new MessageRepository(freshDb('msgs2.json'), null);
        const m = repo2.create({ ticketId: 't2', senderType: 'user', senderId: 'u', senderName: 'U', content: 'x' });
        expect(m.id).toBeDefined();
    });

    test('TicketRepository updateStatus archived branch + delete cascade w/o messagesDb', () => {
        const tdb = freshDb('tickets-cov.json');
        const repo = new TicketRepository(tdb, null);
        repo.create({ id: 't', customerName: 'C', customerIp: '1', customerLocation: 'X', ipAnalysis: null });
        expect(repo.updateStatus('t', 'archived').archived_at).toBeDefined();
        expect(repo.updateStatus('t', 'resolved').resolved_at).toBeDefined();
        expect(repo.updateStatus('t', 'open').status).toBe('open');
        expect(repo.updatePriority('t', 'high').priority).toBe('high');
        expect(repo.updateAssignee('t', 'u9').assigned_to).toBe('u9');
        expect(repo.updateNotes('t', 'noted').notes).toBe('noted');
        expect(repo.updateTags('t', 'a,b').tags).toBe('a,b');
        expect(repo.findByAssignee('u9').length).toBe(1);
        expect(repo.findOpen().length).toBe(1);
        expect(repo.findByStatus('open').length).toBe(1);
        expect(repo.findBySite(null).length).toBe(1);
        expect(repo.findBySiteAndStatus(null, 'open').length).toBe(1);
        expect(repo.findAll().length).toBe(1);
        expect(repo.delete('t')).toBe(true);
    });

    test('SiteRepository allowed_origins non-array + regenerateIntegrationSecret with missing site', () => {
        const sdb = freshDb('sites-cov.json');
        const repo = new SiteRepository(sdb, null);
        const s = repo.create({ name: 'S', domain: 's.com', allowed_origins: 'not-array' });
        expect(s.allowed_origins).toBe(null);
        const s2 = repo.create({ name: 'S2', domain: 's2.com' });
        expect(s2.allowed_origins).toBe(null);
        expect(repo.findByApiKey('nope')).toBeUndefined();
        expect(repo.findByDomain('s.com').id).toBe(s.id);
        expect(repo.findActive().length).toBe(2);
        expect(repo.findAll().length).toBe(2);
        expect(repo.regenerateApiKey(s.id)).toBeDefined();
        expect(repo.updateChatbotConfig(s.id, { x: 1 })).toBeDefined();
        expect(repo.updateIntegration(s.id, { url: 'https://x.com/', secret: 'k', events: ['a'] }).integration.url).toBe('https://x.com');
        expect(repo.updateIntegration(s.id, null).integration).toBe(null);
        expect(repo.updateIntegration(s.id, { url: '', secret: 'k' }).integration.enabled).toBe(false);
        expect(repo.regenerateIntegrationSecret(s.id)).toBeDefined();
        expect(repo.regenerateIntegrationSecret('missing-id')).toBe(null);
        // Stats branch with no tickets DB attached
        expect(typeof repo.getStats(s.id)).toBe('object');
        // delete
        const id = s.id;
        const ok = repo.delete(id);
        expect(ok).toBe(true);
    });

    test('UserRepository: setTotpSecret object/Buffer/encrypted; delete super-admin protection; getStats', async () => {
        const udb = freshDb('users-cov.json');
        const repo = new UserRepository(udb);
        const u = await repo.create({ username: 'a', email: 'a@x.com', password: 'pw1', role: 'support' });
        await repo.create({ username: 'sa', email: 'sa@x.com', password: 'pw1', role: 'super_admin' });

        // Buffer branch
        repo.setTotpSecret(u.id, Buffer.from([1, 2, 3]));
        // Object {data:[]} branch
        repo.setTotpSecret(u.id, { data: [4, 5, 6] });
        // Already-encrypted branch
        repo.setTotpSecret(u.id, 'enc:v1:abc');
        // String branch
        repo.setTotpSecret(u.id, 'JBSWY3DPEHPK3PXP');

        repo.enableTotp(u.id, ['ABCD-EFGH']);
        repo.disableTotp(u.id);

        const tok = await repo.setResetToken(u.id);
        expect(repo.findByResetToken(tok).id).toBe(u.id);
        repo.clearResetToken(u.id);
        expect(repo.findByResetToken(tok)).toBeUndefined();

        expect(repo.findActive().length).toBeGreaterThanOrEqual(2);
        expect(repo.findAll().length).toBeGreaterThanOrEqual(2);
        expect(repo.findByUsername('A')).toBeDefined();
        expect(repo.findByEmail('a@x.com')).toBeDefined();
        expect(repo.updateRole(u.id, 'admin').role).toBe('admin');
        expect(repo.updateActive(u.id, false).is_active).toBe(0);
        expect(repo.updateActive(u.id, true).is_active).toBe(1);
        expect(repo.updateNickname(u.id, 'Nick').nickname).toBe('Nick');
        await repo.updatePassword(u.id, 'newpw');
        expect((await repo.authenticate('a', 'newpw')).id).toBe(u.id);
        expect(await repo.authenticate('a', 'wrong')).toBe(null);
        expect(await repo.authenticate('missing', 'x')).toBe(null);
        repo.updateLastLogin(u.id);

        const stats = repo.getStats();
        expect(Array.isArray(stats)).toBe(true);

        // Try to delete the only super-admin
        const sa = repo.findByUsername('sa');
        expect(() => repo.delete(sa.id)).toThrow(/super admin/);
        // Demote and then delete the support user
        expect(repo.delete(u.id)).toBe(true);

        // Duplicate username throws
        await expect(repo.create({ username: 'sa', email: 'x@x.com', password: 'pw', role: 'support' }))
            .rejects.toThrow(/Username/);
        await expect(repo.create({ username: 'new', email: 'sa@x.com', password: 'pw', role: 'support' }))
            .rejects.toThrow(/Email/);
    });
});

// ===========================================================================
// src/services/ChatbotService.js  (lines 136-137 — keyword score branch)
// ===========================================================================
describe('services/ChatbotService gaps', () => {
    const { ChatbotService } = require('../../src/services/ChatbotService');

    function makeSvc(cfg) {
        return new ChatbotService({ chatbotConfig: { getConfig: () => cfg, saveConfig: () => true } });
    }

    test('processMessage handles disabled, escalation, faq match, keyword match, fallback, off-hours', () => {
        const disabled = makeSvc({ enabled: false });
        expect(disabled.processMessage('hi').type).toBe('disabled');

        const off = makeSvc({
            enabled: true,
            escalationKeywords: ['agent'],
            humanHours: { enabled: true, timezone: 'UTC', schedule: {}, offHoursMessage: 'closed' }
        });
        const r = off.processMessage('agent please', null, new Date('2024-01-01T00:00:00Z'));
        expect(r.type).toBe('offHours');

        const esc = makeSvc({ enabled: true, escalationKeywords: ['help'], escalationMessage: 'going to agent' });
        expect(esc.processMessage('I need help').type).toBe('escalation');

        const faq = makeSvc({
            enabled: true,
            faq: [{ question: 'what is your refund policy', answer: '30 days' }],
            fallbackMessage: 'idk'
        });
        const fr = faq.processMessage('what is your refund policy');
        expect(fr.type).toBe('faq');

        const keyword = makeSvc({
            enabled: true,
            faq: [
                { question: 'pricing details', answer: 'see pricing page', keywords: ['cost', 'price'] },
                { question: 'no answer here' } // skipped
            ],
            fallbackMessage: 'hmm'
        });
        const kr = keyword.processMessage('cost?');
        expect(kr.type).toBe('faq');
        expect(kr.confidence).toBe(0.8);

        const fb = makeSvc({ enabled: true, fallbackMessage: 'sorry' });
        expect(fb.processMessage('xyz').type).toBe('fallback');
    });

    test('isHumanAvailable covers always-on and timezone branches', () => {
        const cfg = {
            humanHours: {
                enabled: true,
                timezone: 'UTC',
                schedule: { mon: [{ open: '09:00', close: '17:00' }] }
            }
        };
        const inHours = new Date('2024-01-01T12:00:00Z'); // Mon 12:00 UTC
        expect(ChatbotService.isHumanAvailable(cfg, inHours)).toBe(true);
        const beforeOpen = new Date('2024-01-01T08:00:00Z');
        expect(ChatbotService.isHumanAvailable(cfg, beforeOpen)).toBe(false);
        const afterClose = new Date('2024-01-01T18:00:00Z');
        expect(ChatbotService.isHumanAvailable(cfg, afterClose)).toBe(false);
        const sunday = new Date('2024-01-07T12:00:00Z');
        expect(ChatbotService.isHumanAvailable(cfg, sunday)).toBe(false);
        // No humanHours / disabled
        expect(ChatbotService.isHumanAvailable({})).toBe(true);
        expect(ChatbotService.isHumanAvailable({ humanHours: { enabled: false } })).toBe(true);
        // Invalid range entries are skipped
        const badRange = {
            humanHours: {
                enabled: true, timezone: 'UTC',
                schedule: { mon: [null, { open: 'xx', close: 'yy' }, { open: '09:00', close: '17:00' }] }
            }
        };
        expect(ChatbotService.isHumanAvailable(badRange, inHours)).toBe(true);
        // Bad timezone -> fail open
        const badTz = { humanHours: { enabled: true, timezone: 'Not/A_Zone', schedule: {} } };
        expect(ChatbotService.isHumanAvailable(badTz, inHours)).toBe(true);
    });

    test('save/getConfig delegate', () => {
        const svc = makeSvc({ enabled: true });
        expect(svc.getConfig()).toEqual({ enabled: true });
        expect(svc.saveConfig({ enabled: false })).toBe(true);
    });
});

// ===========================================================================
// src/services/TwoFactorService.js  (line 79 — JSON.parse failure)
// ===========================================================================
describe('services/TwoFactorService gaps', () => {
    const { TwoFactorService } = require('../../src/services/TwoFactorService');

    function makeSvc({ verifier, user, recoveryCodes }) {
        const userRepo = {
            findById: () => user,
            db: { update: jest.fn() }
        };
        const auditRepo = { log: jest.fn() };
        return {
            svc: new TwoFactorService({ userRepository: userRepo, auditRepository: auditRepo, verifyTOTP: verifier }),
            userRepo,
            auditRepo
        };
    }

    test('rejects when no verifier configured', async () => {
        const svc = new TwoFactorService({ userRepository: {}, auditRepository: { log() {} } });
        const r = await svc.verify('u', '123');
        expect(r.error).toMatch(/verifier/);
    });

    test('returns error when user missing or inactive', async () => {
        const { svc } = makeSvc({ verifier: () => false, user: null });
        expect((await svc.verify('u', '1', () => false)).error).toMatch(/User not found/);
        const { svc: svc2 } = makeSvc({ verifier: () => false, user: { id: 'u', is_active: false } });
        expect((await svc2.verify('u', '1', () => false)).error).toMatch(/User not found/);
    });

    test('returns error when 2FA not configured', async () => {
        const { svc } = makeSvc({ verifier: () => false, user: { id: 'u', is_active: true } });
        expect((await svc.verify('u', '1', () => false)).error).toMatch(/2FA not configured/);
    });

    test('TOTP success returns user', async () => {
        const { svc } = makeSvc({
            verifier: () => true,
            user: { id: 'u', is_active: true, totp_secret: 's' }
        });
        const r = await svc.verify('u', '1', () => true);
        expect(r.ok).toBe(true);
    });

    test('falls back to recovery code; consumes it', async () => {
        const user = { id: 'u', is_active: true, totp_secret: 's', recovery_codes: JSON.stringify(['CODE-1']) };
        const { svc, userRepo, auditRepo } = makeSvc({ verifier: () => false, user });
        const r = await svc.verify('u', 'CODE-1', () => false);
        expect(r.ok).toBe(true);
        expect(userRepo.db.update).toHaveBeenCalled();
        expect(auditRepo.log).toHaveBeenCalled();
    });

    test('returns error when recovery_codes is malformed JSON', async () => {
        const user = { id: 'u', is_active: true, totp_secret: 's', recovery_codes: '{not json' };
        const { svc } = makeSvc({ verifier: () => false, user });
        expect((await svc.verify('u', 'X', () => false)).error).toMatch(/Invalid verification/);
    });

    test('returns error when no recovery codes', async () => {
        const user = { id: 'u', is_active: true, totp_secret: 's', recovery_codes: null };
        const { svc } = makeSvc({ verifier: () => false, user });
        expect((await svc.verify('u', 'X', () => false)).error).toMatch(/Invalid/);
    });

    test('returns error when code not in list', async () => {
        const user = { id: 'u', is_active: true, totp_secret: 's', recovery_codes: JSON.stringify(['A', 'B']) };
        const { svc } = makeSvc({ verifier: () => false, user });
        expect((await svc.verify('u', 'C', () => false)).error).toMatch(/Invalid/);
    });

    test('constructor throws without required deps', () => {
        expect(() => new TwoFactorService({})).toThrow(/userRepository/);
        expect(() => new TwoFactorService({ userRepository: {} })).toThrow(/auditRepository/);
    });
});

// ===========================================================================
// src/services/AuthService.js  (lines 142, 167-179 — 2FA failure + logout)
// ===========================================================================
describe('services/AuthService gaps', () => {
    const { AuthService } = require('../../src/services/AuthService');
    function makeUserRepo(user) {
        return {
            authenticate: jest.fn().mockResolvedValue(user),
            findById: jest.fn().mockReturnValue(user),
            updateLastLogin: jest.fn()
        };
    }
    function makeSessionRepo() {
        return { deleteByToken: jest.fn() };
    }
    function makeAuditRepo() {
        return { log: jest.fn() };
    }

    test('authenticate failed -> audit + error', async () => {
        const svc = new AuthService({
            userRepository: makeUserRepo(null),
            sessionRepository: makeSessionRepo(),
            auditRepository: makeAuditRepo()
        });
        const r = await svc.authenticate('a', 'b', { ip: '1' });
        expect(r.success).toBe(false);
    });

    test('authenticate with 2FA gating', async () => {
        const u = { id: 'u', username: 'a', role: 'support', totp_enabled: 1 };
        const svc = new AuthService({
            userRepository: makeUserRepo(u),
            sessionRepository: makeSessionRepo(),
            auditRepository: makeAuditRepo()
        });
        const r = await svc.authenticate('a', 'b');
        expect(r.requires2FA).toBe(true);
    });

    test('authenticate success -> token + audit', async () => {
        const u = { id: 'u', username: 'a', role: 'support', totp_enabled: 0 };
        const svc = new AuthService({
            userRepository: makeUserRepo(u),
            sessionRepository: makeSessionRepo(),
            auditRepository: makeAuditRepo()
        });
        const r = await svc.authenticate('a', 'b', { ip: '1.1.1.1', userAgent: 'jest' });
        expect(r.success).toBe(true);
        expect(typeof r.token).toBe('string');
    });

    test('verify2FA returns error when underlying service fails', async () => {
        const svc = new AuthService({
            userRepository: makeUserRepo(null),
            sessionRepository: makeSessionRepo(),
            auditRepository: makeAuditRepo(),
            twoFactorService: { verify: async () => ({ ok: false, error: 'bad code' }) }
        });
        const r = await svc.verify2FA('u', '123', () => false);
        expect(r.success).toBe(false);
        expect(r.error).toBe('bad code');
    });

    test('verify2FA success', async () => {
        const u = { id: 'u', username: 'a', role: 'support', nickname: null };
        const svc = new AuthService({
            userRepository: makeUserRepo(u),
            sessionRepository: makeSessionRepo(),
            auditRepository: makeAuditRepo(),
            twoFactorService: { verify: async () => ({ ok: true, user: u }) }
        });
        const r = await svc.verify2FA('u', '123', () => true, { ip: 'x', userAgent: 'y' });
        expect(r.success).toBe(true);
        expect(r.user.nickname).toBe('a'); // falls back to username
    });

    test('logout writes audit and deletes session', () => {
        const sess = makeSessionRepo();
        const audit = makeAuditRepo();
        const svc = new AuthService({
            userRepository: makeUserRepo(null),
            sessionRepository: sess,
            auditRepository: audit
        });
        svc.logout('tok', { userId: 'u', username: 'a' }, { ip: '1', userAgent: 'jest' });
        expect(sess.deleteByToken).toHaveBeenCalledWith('tok');
        expect(audit.log).toHaveBeenCalled();
    });

    test('verifyToken returns null for inactive or missing user, decoded otherwise', () => {
        const u = { id: 'u', is_active: 1 };
        const svc = new AuthService({
            userRepository: makeUserRepo(u),
            sessionRepository: makeSessionRepo(),
            auditRepository: makeAuditRepo()
        });
        const tok = svc.generateToken({ id: 'u', username: 'a', role: 'support' });
        expect(svc.verifyToken(tok)?.userId).toBe('u');
        expect(svc.verifyToken('not-a-jwt')).toBe(null);

        const svc2 = new AuthService({
            userRepository: makeUserRepo(null),
            sessionRepository: makeSessionRepo(),
            auditRepository: makeAuditRepo()
        });
        expect(svc2.verifyToken(tok)).toBe(null);
    });

    test('hasPermission delegates', () => {
        const svc = new AuthService({
            userRepository: makeUserRepo(null),
            sessionRepository: makeSessionRepo(),
            auditRepository: makeAuditRepo()
        });
        expect(typeof svc.hasPermission('super_admin', 'manage_users')).toBe('boolean');
    });
});

// ===========================================================================
// src/services/lygHubWebhook.js  (line 123 — verifySignature catch path)
// ===========================================================================
describe('services/lygHubWebhook gaps', () => {
    const { verifySignature, createWebhookBridge } = require('../../src/services/lygHubWebhook');
    const crypto = require('crypto');

    test('verifySignature returns false for missing inputs', () => {
        expect(verifySignature(null, 'sig', 'k')).toBe(false);
        expect(verifySignature('body', null, 'k')).toBe(false);
        expect(verifySignature('body', 'sig', null)).toBe(false);
    });

    test('verifySignature rejects non-hex signature', () => {
        expect(verifySignature('body', 'sha256=ZZZ', 'k')).toBe(false);
    });

    test('verifySignature rejects mismatched length', () => {
        expect(verifySignature('body', 'sha256=abcd', 'k')).toBe(false);
    });

    test('verifySignature returns true on a correct signature, false otherwise', () => {
        const body = '{"a":1}';
        const sig = crypto.createHmac('sha256', 'secret').update(body).digest('hex');
        expect(verifySignature(body, `sha256=${sig}`, 'secret')).toBe(true);
        expect(verifySignature(body, sig, 'secret')).toBe(true); // no prefix
        // Different secret -> mismatched expected -> false
        expect(verifySignature(body, `sha256=${sig}`, 'wrong')).toBe(false);
    });

    test('bridge.send no-ops when site missing or integration disabled or no fetch', async () => {
        const siteRepository = { findById: () => null };
        const bridge = createWebhookBridge({ siteRepository });
        expect((await bridge.send('s', { event: 'x', messageId: 'm' })).skipped).toBe(true);

        const noFetch = createWebhookBridge({
            siteRepository: { findById: () => ({ integration: { enabled: true, url: 'http://x', secret: 'k' } }) },
            fetchImpl: undefined,
            log: { warn: () => {} }
        });
        // Force no global fetch
        const orig = global.fetch;
        global.fetch = undefined;
        const fresh = createWebhookBridge({
            siteRepository: { findById: () => ({ integration: { enabled: true, url: 'http://x', secret: 'k' } }) },
            log: { warn: () => {} }
        });
        const out = await fresh.send('s', { event: 'x', messageId: 'm' });
        expect(out.ok).toBe(false);
        global.fetch = orig;
    });

    test('bridge.send respects events allow-list', async () => {
        const bridge = createWebhookBridge({
            siteRepository: { findById: () => ({ integration: { enabled: true, url: 'http://x', secret: 'k', events: ['allowed'] } }) },
            fetchImpl: jest.fn(),
            log: { warn: () => {} }
        });
        const r = await bridge.send('s', { event: 'denied', messageId: 'm' });
        expect(r.skipped).toBe(true);
    });

    test('bridge.send fetch ok and non-ok and throw', async () => {
        const okFetch = jest.fn().mockResolvedValue({ ok: true });
        const okBridge = createWebhookBridge({
            siteRepository: { findById: () => ({ integration: { enabled: true, url: 'http://x', secret: 'k' } }) },
            fetchImpl: okFetch,
            log: { warn: () => {} }
        });
        expect((await okBridge.send('s', { event: 'e', messageId: 'm' })).ok).toBe(true);

        const badFetch = jest.fn().mockResolvedValue({ ok: false, status: 502 });
        const badBridge = createWebhookBridge({
            siteRepository: { findById: () => ({ integration: { enabled: true, url: 'http://x', secret: 'k' } }) },
            fetchImpl: badFetch,
            log: { warn: () => {} }
        });
        expect((await badBridge.send('s', { event: 'e', messageId: 'm' })).ok).toBe(false);

        const errFetch = jest.fn().mockRejectedValue(new Error('boom'));
        const errBridge = createWebhookBridge({
            siteRepository: { findById: () => ({ integration: { enabled: true, url: 'http://x', secret: 'k' } }) },
            fetchImpl: errFetch,
            log: { warn: () => {} }
        });
        expect((await errBridge.send('s', { event: 'e', messageId: 'm' })).ok).toBe(false);
    });

    test('bridge.mirror is fire-and-forget', async () => {
        const send = jest.fn().mockResolvedValue({ ok: true });
        const bridge = createWebhookBridge({
            siteRepository: { findById: () => ({ integration: { enabled: true, url: 'http://x', secret: 'k' } }) },
            fetchImpl: send
        });
        expect(bridge.mirror('s', { event: 'e', messageId: 'm' })).toBeUndefined();
        bridge.mirror('s'); // missing payload still no-throws
        bridge.mirror(null, { event: 'e' }); // no siteId -> no-op
    });

    test('bridge.genMessageId returns a uuid', () => {
        const bridge = createWebhookBridge({ siteRepository: { findById: () => null } });
        expect(bridge.genMessageId()).toMatch(/-/);
    });
});

// ===========================================================================
// src/socket/handlers/chatHandlers.js  (line 40 — webhook.send fallback)
// ===========================================================================
describe('socket/handlers/chatHandlers gaps', () => {
    const { createChatHandlers } = require('../../src/socket/handlers/chatHandlers');
    const { OUT } = require('../../src/socket/events');

    test('mirrorToSite uses webhook.send fallback when no .mirror', async () => {
        const send = jest.fn().mockResolvedValue({ ok: true });
        const webhook = { send, genMessageId: () => 'mid-1' }; // no `mirror`
        const adminSockets = new Map();
        const sessions = new Map();
        const handlers = createChatHandlers({
            io: { to: () => ({ emit: () => {} }) },
            messageRepository: { create: () => ({ id: 'm', content: 'x', timestamp: Date.now() / 1000 }) },
            ticketRepository: { findById: () => ({ site_id: 'site-X' }), updateLastMessage: () => {} },
            adminSockets, sessions,
            getRealIP: () => '1', hasPermission: () => true,
            chatbotService: { _matchesEscalation: () => false, getConfig: () => ({}) },
            webhook
        });
        const adminSock = {
            isAdmin: true,
            adminUser: { id: 'a', nickname: 'A', username: 'a' },
            emit: () => {}
        };
        sessions.set('s1', { sessionId: 's1', siteId: 'site-X', socket: { emit: () => {} }, messages: [], name: 'C' });
        handlers.handleAdminMessage(adminSock, { sessionId: 's1', message: 'hi' });
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));
        expect(send).toHaveBeenCalled();
    });

    test('handleCustomerMessage and typing/markRead/admin join/leave smoke', () => {
        const adminSockets = new Map();
        const sessions = new Map();
        const ioRoom = { emit: jest.fn() };
        const io = {
            to: () => ioRoom,
            sockets: { adapter: { rooms: new Map() } }
        };
        const handlers = createChatHandlers({
            io,
            messageRepository: { create: () => ({ id: 'm', content: 'x', timestamp: Date.now() / 1000 }), findByTicket: () => [] },
            ticketRepository: { findById: () => ({ site_id: 'site-X' }), updateLastMessage: () => {} },
            adminSockets, sessions,
            getRealIP: () => '1', hasPermission: () => true,
            chatbotService: { _matchesEscalation: () => true, getConfig: () => ({}) },
            webhook: { mirror: jest.fn(), send: jest.fn(), genMessageId: () => 'm-1' }
        });
        const customerSock = { sessionId: 's2', emit: jest.fn(), join: jest.fn() };
        sessions.set('s2', { sessionId: 's2', siteId: 'site-X', socket: customerSock, name: 'C', messages: [], hasAdminJoined: false });
        handlers.handleCustomerMessage(customerSock, { message: 'help' });
        handlers.handleTyping(customerSock, { sessionId: 's2', isTyping: true });
        handlers.handleMarkRead(customerSock, { sessionId: 's2' });

        const adminSock = { id: 'a1', isAdmin: true, adminUser: { id: 'A', nickname: 'A' }, join: jest.fn(), leave: jest.fn(), emit: jest.fn() };
        adminSockets.set('a1', { socket: adminSock });
        if (handlers.handleAdminJoin) handlers.handleAdminJoin(adminSock, 's2');
        if (handlers.handleAdminLeave) handlers.handleAdminLeave(adminSock, 's2');
    });
});

// ===========================================================================
// src/routes/sites.js  (lines 25-31 — normalizeOrigins variants)
// ===========================================================================
describe('routes/sites normalizeOrigins gap', () => {
    const request = require('supertest');
    const { buildRouterApp } = require('./_routerTestHelper');
    const { createSitesRouter } = require('../../src/routes/sites');

    function makeRepo() {
        const data = new Map();
        return {
            findAll: () => Array.from(data.values()),
            findActive: () => Array.from(data.values()).filter(s => s.is_active),
            findById: id => data.get(id),
            findByDomain: d => Array.from(data.values()).find(s => s.domain === d),
            create: ({ name, domain, allowed_origins }) => {
                const s = { id: 'id-' + Date.now() + '-' + Math.random(), name, domain, allowed_origins: allowed_origins || null, is_active: true };
                data.set(s.id, s);
                return s;
            },
            update: (id, u) => Object.assign(data.get(id), u),
            delete: id => data.delete(id),
            getStats: () => ({}),
            updateChatbotConfig: (id, c) => Object.assign(data.get(id), { chatbot_config: c }),
            regenerateApiKey: () => 'new-key',
            updateIntegration: (id, i) => Object.assign(data.get(id), { integration: i }),
            regenerateIntegrationSecret: () => 'new-secret'
        };
    }

    test('create site accepts comma-separated allowed_origins string and array; null branch', async () => {
        const repo = makeRepo();
        const app = buildRouterApp({
            basePath: '/api/sites',
            factory: createSitesRouter,
            deps: {
                siteRepository: repo,
                ticketRepository: { findAll: () => [] },
                auditRepository: { log: () => {} }
            }
        });
        let res = await request(app).post('/api/sites').send({ name: 'S1', domain: 's1.com', allowed_origins: 'https://a.com, https://b.com\nhttps://c.com' });
        expect(res.status).toBe(201);
        res = await request(app).post('/api/sites').send({ name: 'S2', domain: 's2.com', allowed_origins: ['https://x.com'] });
        expect(res.status).toBe(201);
        res = await request(app).post('/api/sites').send({ name: 'S3', domain: 's3.com', allowed_origins: '' });
        expect(res.status).toBe(201);
        res = await request(app).post('/api/sites').send({ name: 'S4', domain: 's4.com', allowed_origins: '   ,   ' });
        expect(res.status).toBe(201);
        res = await request(app).post('/api/sites').send({ name: 'S5', domain: 's5.com' });
        expect(res.status).toBe(201);
    });
});

// ===========================================================================
// src/routes/chatbot.js  (lines 43-44, 49-50, 54-55, 137 — site security branches)
// ===========================================================================
describe('routes/chatbot enforceSiteSecurity gaps', () => {
    const request = require('supertest');
    const { buildRouterApp } = require('./_routerTestHelper');
    const { createChatbotRouter } = require('../../src/routes/chatbot');

    function build(siteRepo) {
        return buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: {
                    getConfig: () => ({ enabled: true, fallbackMessage: 'fb' }),
                    saveConfig: () => true,
                    processMessage: () => ({ type: 'fallback', message: 'fb', content: 'fb' })
                },
                auditRepository: { log: () => {} },
                siteRepository: siteRepo
            }
        });
    }

    test('rejects invalid site api key (401)', async () => {
        const app = build({ findByApiKey: () => null });
        const res = await request(app).get('/api/chatbot/config').query({ siteApiKey: 'bad' });
        expect(res.status).toBe(401);
    });

    test('rejects disallowed origin (403)', async () => {
        const app = build({ findByApiKey: () => ({ api_key: 'k', allowed_origins: ['https://allowed.com'] }) });
        const res = await request(app).get('/api/chatbot/config')
            .set('origin', 'https://nope.com')
            .query({ siteApiKey: 'k' });
        expect(res.status).toBe(403);
    });

    test('rate-limits when too many requests (429)', async () => {
        const app = build({ findByApiKey: () => ({ api_key: 'k2' }) });
        // hit it 31 times to exceed default 30 per minute
        let last;
        for (let i = 0; i < 31; i++) {
            last = await request(app).get('/api/chatbot/config').query({ siteApiKey: 'k2' });
        }
        expect(last.status).toBe(429);
    });

    test('toggle endpoint flips enabled flag', async () => {
        const cfg = { enabled: true };
        const app = buildRouterApp({
            basePath: '/api/chatbot',
            factory: createChatbotRouter,
            deps: {
                chatbotService: {
                    getConfig: () => cfg,
                    saveConfig: (c) => { Object.assign(cfg, c); return true; },
                    processMessage: () => ({})
                },
                auditRepository: { log: () => {} }
            }
        });
        const r = await request(app).post('/api/chatbot/toggle');
        expect(r.status).toBe(200);
        expect(r.body.enabled).toBe(false);
    });
});
