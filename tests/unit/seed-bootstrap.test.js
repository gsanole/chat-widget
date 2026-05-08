/**
 * Coverage for bootstrapAdminFromEnv() in src/database/seed.js.
 *
 * Pattern lifted from lyg_hub: env-var bootstrap of a single admin when
 * the users table is empty. Idempotent on subsequent boots.
 */

const bcrypt = require('bcrypt');
const { bootstrapAdminFromEnv } = require('../../src/database/seed');

function makeRepo(initialUsers = []) {
    const rows = [...initialUsers];
    return {
        rows,
        findAll: () => rows.slice(),
        db: {
            insert: (u) => { rows.push(u); return u; }
        }
    };
}

const silent = { log: () => {}, warn: () => {} };

describe('bootstrapAdminFromEnv', () => {
    test('returns no-repository when repo missing', async () => {
        const r = await bootstrapAdminFromEnv(null, {}, silent);
        expect(r).toEqual({ seeded: false, reason: 'no-repository' });
    });

    test('skips when no username env var', async () => {
        const repo = makeRepo();
        const r = await bootstrapAdminFromEnv(repo, {}, silent);
        expect(r.seeded).toBe(false);
        expect(r.reason).toBe('no-username');
        expect(repo.rows).toHaveLength(0);
    });

    test('skips when no password material', async () => {
        const repo = makeRepo();
        const r = await bootstrapAdminFromEnv(repo, { BOOTSTRAP_ADMIN_USERNAME: 'a' }, silent);
        expect(r).toEqual({ seeded: false, reason: 'no-password' });
    });

    test('skips when users already exist', async () => {
        const repo = makeRepo([{ id: 'x', username: 'someone' }]);
        const r = await bootstrapAdminFromEnv(repo, {
            BOOTSTRAP_ADMIN_USERNAME: 'a',
            BOOTSTRAP_ADMIN_PASSWORD_HASH: '$2b$12$' + 'x'.repeat(53)
        }, silent);
        expect(r).toEqual({ seeded: false, reason: 'users-exist' });
        expect(repo.rows).toHaveLength(1);
    });

    test('rejects non-bcrypt hash format', async () => {
        const repo = makeRepo();
        const r = await bootstrapAdminFromEnv(repo, {
            BOOTSTRAP_ADMIN_USERNAME: 'a',
            BOOTSTRAP_ADMIN_PASSWORD_HASH: 'plaintext-not-a-hash'
        }, silent);
        expect(r).toEqual({ seeded: false, reason: 'bad-hash-format' });
        expect(repo.rows).toHaveLength(0);
    });

    test('seeds with a pre-hashed password', async () => {
        const repo = makeRepo();
        const hash = await bcrypt.hash('SomePassword!42', 4);
        const r = await bootstrapAdminFromEnv(repo, {
            BOOTSTRAP_ADMIN_USERNAME: 'superadmin',
            BOOTSTRAP_ADMIN_PASSWORD_HASH: hash,
            BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
            BOOTSTRAP_ADMIN_NICKNAME: 'Boss'
        }, silent);
        expect(r).toEqual({ seeded: true });
        expect(repo.rows).toHaveLength(1);
        expect(repo.rows[0]).toMatchObject({
            username: 'superadmin',
            email: 'admin@example.com',
            nickname: 'Boss',
            role: 'super_admin',
            is_active: 1,
            totp_enabled: 0,
            password_hash: hash
        });
    });

    test('hashes plaintext fallback and defaults email/nickname', async () => {
        const repo = makeRepo();
        const r = await bootstrapAdminFromEnv(repo, {
            BOOTSTRAP_ADMIN_USERNAME: 'root',
            BOOTSTRAP_ADMIN_PASSWORD: 'hunter2hunter2'
        }, silent);
        expect(r).toEqual({ seeded: true });
        expect(repo.rows[0].email).toBe('root@localhost');
        expect(repo.rows[0].nickname).toBe('Super Support');
        expect(await bcrypt.compare('hunter2hunter2', repo.rows[0].password_hash)).toBe(true);
    });

    test('returns read-failed when findAll throws', async () => {
        const repo = {
            findAll: () => { throw new Error('boom'); },
            db: { insert: () => {} }
        };
        const r = await bootstrapAdminFromEnv(repo, {
            BOOTSTRAP_ADMIN_USERNAME: 'a',
            BOOTSTRAP_ADMIN_PASSWORD_HASH: '$2b$12$' + 'x'.repeat(53)
        }, silent);
        expect(r).toEqual({ seeded: false, reason: 'read-failed' });
    });

    test('returns no-insert when repo lacks db.insert', async () => {
        const repo = { findAll: () => [] };
        const r = await bootstrapAdminFromEnv(repo, {
            BOOTSTRAP_ADMIN_USERNAME: 'a',
            BOOTSTRAP_ADMIN_PASSWORD_HASH: '$2b$12$' + 'x'.repeat(53)
        }, silent);
        expect(r).toEqual({ seeded: false, reason: 'no-insert' });
    });

    test('returns insert-failed when db.insert throws', async () => {
        const repo = {
            findAll: () => [],
            db: { insert: () => { throw new Error('disk full'); } }
        };
        const r = await bootstrapAdminFromEnv(repo, {
            BOOTSTRAP_ADMIN_USERNAME: 'a',
            BOOTSTRAP_ADMIN_PASSWORD_HASH: '$2b$12$' + 'x'.repeat(53)
        }, silent);
        expect(r).toEqual({ seeded: false, reason: 'insert-failed' });
    });

    test('treats missing findAll as empty users list', async () => {
        const repo = { db: { insert: (u) => repo._u = u } };
        const r = await bootstrapAdminFromEnv(repo, {
            BOOTSTRAP_ADMIN_USERNAME: 'a',
            BOOTSTRAP_ADMIN_PASSWORD_HASH: '$2b$12$' + 'x'.repeat(53)
        }, silent);
        expect(r).toEqual({ seeded: true });
        expect(repo._u.username).toBe('a');
    });
});
