/**
 * Targeted coverage boosters for permissions, cors, JsonDB, AuditRepository,
 * BaseRepository, TicketRepository (uncovered branches/funcs).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

describe('config/permissions extras', () => {
    const perm = require('../../src/config/permissions');

    test('hasPermission returns false for unknown role', () => {
        expect(perm.hasPermission('nobody', 'manage_users')).toBe(false);
    });

    test('hasPermission returns false for known role missing permission', () => {
        expect(perm.hasPermission(perm.ROLES.SUPPORT, 'manage_users')).toBe(false);
    });

    test('getPermissionsForRole returns array for known role', () => {
        const p = perm.getPermissionsForRole(perm.ROLES.SUPER_ADMIN);
        expect(Array.isArray(p)).toBe(true);
        expect(p.length).toBeGreaterThan(0);
    });

    test('getPermissionsForRole returns [] for unknown role', () => {
        expect(perm.getPermissionsForRole('ghost')).toEqual([]);
    });

    test('isValidRole true for known roles, false for unknown', () => {
        expect(perm.isValidRole(perm.ROLES.ADMIN)).toBe(true);
        expect(perm.isValidRole(perm.ROLES.SUPPORT)).toBe(true);
        expect(perm.isValidRole('zzz')).toBe(false);
    });
});

describe('config/cors origin callback', () => {
    const { createCorsOptions, ALLOWED_ORIGINS } = require('../../src/config/cors');

    test('allows missing origin in non-production', () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
        const opts = createCorsOptions();
        const cb = jest.fn();
        opts.origin(undefined, cb);
        expect(cb).toHaveBeenCalledWith(null, true);
        process.env.NODE_ENV = prev;
    });

    test('allows whitelisted origin', () => {
        const opts = createCorsOptions();
        const cb = jest.fn();
        opts.origin(ALLOWED_ORIGINS[0], cb);
        expect(cb).toHaveBeenCalledWith(null, true);
    });

    test('falls through to "allow all" branch for non-whitelisted origin', () => {
        const opts = createCorsOptions();
        const cb = jest.fn();
        opts.origin('http://evil.example.com', cb);
        expect(cb).toHaveBeenCalledWith(null, true);
    });

    test('passes overrides through', () => {
        const opts = createCorsOptions({ methods: ['GET'] });
        expect(opts.methods).toEqual(['GET']);
        expect(opts.credentials).toBe(true);
    });
});

describe('JsonDB extras', () => {
    let tmpDir;
    let JsonDB;
    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsondb-test-'));
        process.env.DATABASE_DIR = tmpDir;
        // Force fresh require so DB_DIR uses tmpDir
        jest.resetModules();
        JsonDB = require('../../src/database/JsonDB').JsonDB;
    });

    afterAll(() => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { }
    });

    test('debouncedSave writes after delay', (done) => {
        const db = new JsonDB('debounce.json', []);
        db._saveDebounceMs = 5;
        db.data.push({ id: 'a' });
        db.debouncedSave();
        // Call again quickly to clear timer
        db.debouncedSave();
        setTimeout(() => {
            const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, 'debounce.json'), 'utf8'));
            expect(onDisk).toEqual([{ id: 'a' }]);
            done();
        }, 30);
    });

    test('load handles malformed JSON by returning default', () => {
        const filename = 'broken.json';
        fs.writeFileSync(path.join(tmpDir, filename), 'not json{{{');
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const db = new JsonDB(filename, [{ d: 1 }]);
        expect(db.data).toEqual([{ d: 1 }]);
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });

    test('clear empties data and saves', () => {
        const db = new JsonDB('clear.json', [{ id: 1 }, { id: 2 }]);
        db.data = [{ id: 1 }, { id: 2 }];
        db.save();
        db.clear();
        expect(db.data).toEqual([]);
        const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, 'clear.json'), 'utf8'));
        expect(onDisk).toEqual([]);
    });

    test('count with and without predicate', () => {
        const db = new JsonDB('count.json', []);
        db.data = [{ a: 1 }, { a: 2 }, { a: 1 }];
        expect(db.count()).toBe(3);
        expect(db.count(x => x.a === 1)).toBe(2);
    });
});

describe('AuditRepository extras', () => {
    const { AuditRepository } = require('../../src/database/repositories/AuditRepository');

    function makeFakeDb(initial = []) {
        return {
            data: [...initial],
            insert(rec) { this.data.push(rec); return rec; },
            find(p) { return this.data.find(p); },
            filter(p) { return this.data.filter(p); },
            getAll() { return [...this.data]; },
            count(p) { return p ? this.data.filter(p).length : this.data.length; },
            delete(p) {
                const before = this.data.length;
                this.data = this.data.filter(x => !p(x));
                return this.data.length !== before;
            },
            save: jest.fn()
        };
    }

    test('log creates an entry with all fields', () => {
        const db = makeFakeDb();
        const repo = new AuditRepository(db);
        const entry = repo.log({
            userId: 'u1', username: 'alice', action: 'LOGIN',
            resourceType: 'user', resourceId: 'u1',
            details: { foo: 'bar' }, ipAddress: '1.1.1.1', userAgent: 'jest'
        });
        expect(entry.id).toBeDefined();
        expect(entry.user_id).toBe('u1');
        expect(entry.action).toBe('LOGIN');
        expect(entry.timestamp).toBeGreaterThan(0);
        expect(db.data).toHaveLength(1);
    });

    test('log with minimal fields uses defaults', () => {
        const db = makeFakeDb();
        const repo = new AuditRepository(db);
        const e = repo.log({ userId: 'u', username: 'u', action: 'X' });
        expect(e.resource_type).toBeNull();
        expect(e.resource_id).toBeNull();
        expect(e.details).toBeNull();
        expect(e.ip_address).toBeNull();
        expect(e.user_agent).toBeNull();
    });

    test('log rotates when > 10000 entries', () => {
        const db = makeFakeDb();
        // Pre-fill with 10000 entries
        db.data = Array.from({ length: 10000 }, (_, i) => ({ id: `${i}`, timestamp: i }));
        const repo = new AuditRepository(db);
        repo.log({ userId: 'u', username: 'u', action: 'OVERFLOW' });
        // 10001 > 10000 triggers slice to last 5000
        expect(db.data.length).toBe(5000);
        expect(db.save).toHaveBeenCalled();
    });

    test('findAll respects limit and sorts desc by timestamp', () => {
        const db = makeFakeDb([
            { id: 'a', timestamp: 1 },
            { id: 'b', timestamp: 5 },
            { id: 'c', timestamp: 3 }
        ]);
        const repo = new AuditRepository(db);
        const all = repo.findAll(2);
        expect(all.map(x => x.id)).toEqual(['b', 'c']);
    });

    test('findByUser, findByAction, findByResource, findByDateRange', () => {
        const db = makeFakeDb([
            { id: '1', user_id: 'u1', action: 'LOGIN', resource_type: 't', resource_id: 'r1', timestamp: 100 },
            { id: '2', user_id: 'u1', action: 'LOGOUT', resource_type: 't', resource_id: 'r1', timestamp: 200 },
            { id: '3', user_id: 'u2', action: 'LOGIN', resource_type: 'x', resource_id: 'r2', timestamp: 300 }
        ]);
        const repo = new AuditRepository(db);
        expect(repo.findByUser('u1').map(e => e.id)).toEqual(['2', '1']);
        expect(repo.findByAction('LOGIN').map(e => e.id)).toEqual(['3', '1']);
        expect(repo.findByResource('t', 'r1').map(e => e.id)).toEqual(['2', '1']);
        expect(repo.findByDateRange(150, 250).map(e => e.id)).toEqual(['2']);
    });

    test('cleanup deletes old entries and returns count', () => {
        const db = makeFakeDb();
        const cutoffSecs = Math.floor(Date.now() / 1000) - (200 * 24 * 60 * 60);
        db.data = [
            { id: 'old', timestamp: cutoffSecs },
            { id: 'recent', timestamp: Math.floor(Date.now() / 1000) }
        ];
        const repo = new AuditRepository(db);
        const deleted = repo.cleanup(90);
        expect(deleted).toBe(1);
        expect(db.data).toEqual([{ id: 'recent', timestamp: expect.any(Number) }]);
    });
});

describe('TicketRepository extras', () => {
    const { TicketRepository } = require('../../src/database/repositories/TicketRepository');

    function makeDb(initial = []) {
        return {
            data: [...initial],
            insert(rec) { this.data.push(rec); return rec; },
            find(p) { return this.data.find(p); },
            filter(p) { return this.data.filter(p); },
            update(p, updates) {
                const item = this.data.find(p);
                if (item) { Object.assign(item, updates); return item; }
                return null;
            },
            delete(p) {
                const before = this.data.length;
                this.data = this.data.filter(x => !p(x));
                return this.data.length !== before;
            },
            getAll() { return [...this.data]; },
            count(p) { return p ? this.data.filter(p).length : this.data.length; },
            save: jest.fn()
        };
    }

    test('delete without messagesDb still removes ticket', () => {
        const db = makeDb([{ id: 't1', status: 'open' }]);
        const repo = new TicketRepository(db); // no messagesDb
        expect(repo.delete('t1')).toBe(true);
        expect(db.data).toHaveLength(0);
    });

    test('cleanupOldResolved without messagesDb skips message deletion', () => {
        const cutoff = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
        const db = makeDb([
            { id: 'r1', status: 'resolved', resolved_at: cutoff },
            { id: 'o1', status: 'open' }
        ]);
        const repo = new TicketRepository(db);
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
        const n = repo.cleanupOldResolved(15);
        expect(n).toBe(1);
        expect(db.data.find(t => t.id === 'r1')).toBeUndefined();
        logSpy.mockRestore();
    });

    test('cleanupOldResolved returns 0 when nothing old', () => {
        const db = makeDb([{ id: 'r', status: 'resolved', resolved_at: Math.floor(Date.now() / 1000) }]);
        const repo = new TicketRepository(db);
        expect(repo.cleanupOldResolved(15)).toBe(0);
    });

    test('getStats returns counts by status', () => {
        const db = makeDb([
            { id: '1', status: 'open' },
            { id: '2', status: 'open' },
            { id: '3', status: 'resolved' },
            { id: '4', status: 'archived' }
        ]);
        const repo = new TicketRepository(db);
        const stats = repo.getStats();
        expect(stats).toEqual({ total: 4, open: 2, resolved: 1, archived: 1 });
    });
});

describe('BaseRepository direct usage', () => {
    const { BaseRepository } = require('../../src/database/repositories/BaseRepository');

    test('class methods delegate to db', () => {
        const db = {
            find: jest.fn(p => p({ id: 'x' }) ? { id: 'x' } : undefined),
            getAll: jest.fn(() => [{ id: 1 }]),
            count: jest.fn(p => p ? 1 : 5),
            delete: jest.fn(() => true)
        };
        const repo = new BaseRepository(db);
        expect(repo.findById('x')).toEqual({ id: 'x' });
        expect(repo.findAll()).toEqual([{ id: 1 }]);
        expect(repo.count()).toBe(5);
        expect(repo.count(() => true)).toBe(1);
        expect(repo.deleteById('x')).toBe(true);
    });
});
