/**
 * Database seeder.
 *
 * On startup, copies any files from `data-seed/` into the active data
 * directory (DATABASE_DIR or ./data) when the destination file is missing.
 *
 * This exists so production deploys with a fresh persistent disk
 * (e.g. Render) get a working set of seed files (admin user, default
 * chatbot config, etc.) on first boot. Once a file exists in the
 * data directory, it is NEVER overwritten.
 */

const fs = require('fs');
const path = require('path');

function seedFromDirectory(seedDir, dataDir) {
    if (!fs.existsSync(seedDir)) {
        return;
    }
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // Seed-version handshake: when data-seed/.seed-version differs from
    // data/.seed-version (or is missing on disk), force a full reseed.
    // This lets us push corrections (e.g. fixing a bad password hash
    // on a stale persistent disk) by bumping data-seed/.seed-version.
    const seedVersionPath = path.join(seedDir, '.seed-version');
    const dataVersionPath = path.join(dataDir, '.seed-version');
    let forceReseed = false;
    let seedVersion = null;
    if (fs.existsSync(seedVersionPath)) {
        try {
            seedVersion = fs.readFileSync(seedVersionPath, 'utf8').trim();
            const dataVersion = fs.existsSync(dataVersionPath)
                ? fs.readFileSync(dataVersionPath, 'utf8').trim()
                : null;
            if (seedVersion && seedVersion !== dataVersion) {
                forceReseed = true;
                console.log(`[seed] version changed (${dataVersion} -> ${seedVersion}); forcing reseed`);
            }
        } catch (err) {
            console.warn('[seed] failed reading .seed-version:', err.message);
        }
    }

    const entries = fs.readdirSync(seedDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name === '.seed-version') continue;
        const src = path.join(seedDir, entry.name);
        const dest = path.join(dataDir, entry.name);

        // If the destination exists, only overwrite when it's unreadable,
        // unparseable JSON (corrupt), or a forced reseed is in effect.
        // Special case: users.json with zero users is treated as needing
        // re-seed so the bootstrap admin is always available.
        if (fs.existsSync(dest) && !forceReseed) {
            let valid = false;
            let needsReseed = false;
            try {
                const parsed = JSON.parse(fs.readFileSync(dest, 'utf8'));
                valid = true;
                if (entry.name === 'users.json' && Array.isArray(parsed) && parsed.length === 0) {
                    needsReseed = true;
                    console.warn('[seed] users.json on disk has no users; restoring from seed');
                }
            } catch (err) {
                console.warn(`[seed] ${entry.name} on disk is invalid JSON (${err.message}); restoring from seed`);
            }
            if (valid && !needsReseed) continue;
        }

        try {
            fs.copyFileSync(src, dest);
            console.log(`[seed] copied ${entry.name} -> ${dest}`);
        } catch (err) {
            console.error(`[seed] failed to copy ${entry.name}:`, err.message);
        }
    }

    // Record the seed version we just applied so future boots are no-ops
    // until the seed version is bumped again.
    if (seedVersion) {
        try {
            fs.writeFileSync(dataVersionPath, seedVersion + '\n');
        } catch (err) {
            console.warn('[seed] failed writing .seed-version on data dir:', err.message);
        }
    }
}

function runSeed() {
    const dataDir = process.env.DATABASE_DIR
        || path.join(__dirname, '../../data');
    const seedDir = process.env.SEED_DIR
        || path.join(__dirname, '../../data-seed');
    seedFromDirectory(seedDir, dataDir);
}

/**
 * Bootstrap a single admin user from environment variables when no users
 * exist on disk. Idempotent — once the users table has any row, this is a
 * no-op forever (so rotating env vars doesn't silently re-create accounts).
 *
 * Required env vars (BOTH must be set, OR the username + a plaintext password):
 *   BOOTSTRAP_ADMIN_USERNAME       (required)
 *   BOOTSTRAP_ADMIN_PASSWORD_HASH  (preferred — pre-hashed bcrypt)
 *   BOOTSTRAP_ADMIN_PASSWORD       (fallback — hashed at startup, cost 12)
 *   BOOTSTRAP_ADMIN_EMAIL          (optional; defaults to <username>@localhost)
 *   BOOTSTRAP_ADMIN_NICKNAME       (optional; defaults to "Super Support")
 *
 * Pattern adopted from lyg_hub: keep credential material out of git.
 * On Render set these as dashboard env vars (sync: false).
 *
 * @param {Object} userRepository - the live UserRepository (must expose
 *                                  findAll(), and either db.insert() or
 *                                  create()).
 * @param {Object} [envVars]      - defaults to process.env (overridable for
 *                                  tests).
 * @param {Object} [logger]       - defaults to console.
 * @returns {Promise<{ seeded: boolean, reason?: string }>}
 */
async function bootstrapAdminFromEnv(userRepository, envVars = process.env, logger = console) {
    if (!userRepository) return { seeded: false, reason: 'no-repository' };

    const username = envVars.BOOTSTRAP_ADMIN_USERNAME;
    let passwordHash = envVars.BOOTSTRAP_ADMIN_PASSWORD_HASH;
    const plainPassword = envVars.BOOTSTRAP_ADMIN_PASSWORD;
    const email = envVars.BOOTSTRAP_ADMIN_EMAIL || (username ? `${username}@localhost` : null);
    const nickname = envVars.BOOTSTRAP_ADMIN_NICKNAME || 'Super Support';

    if (!username) return { seeded: false, reason: 'no-username' };
    if (!passwordHash && !plainPassword) return { seeded: false, reason: 'no-password' };

    // If anyone already exists, do nothing. Rotation is a deliberate manual
    // act (delete data/users.json on the persistent disk + restart).
    let existing;
    try {
        existing = typeof userRepository.findAll === 'function'
            ? userRepository.findAll()
            : [];
    } catch (err) {
        logger.warn?.('[seed] bootstrap: failed to read users:', err.message);
        return { seeded: false, reason: 'read-failed' };
    }
    if (Array.isArray(existing) && existing.length > 0) {
        return { seeded: false, reason: 'users-exist' };
    }

    if (!passwordHash) {
        // Hash the plaintext at boot (one-time, dev convenience). Cost 12
        // matches the rest of the project.
        try {
            const bcrypt = require('bcrypt');
            passwordHash = await bcrypt.hash(plainPassword, 12);
        } catch (err) {
            logger.warn?.('[seed] bootstrap: bcrypt hash failed:', err.message);
            return { seeded: false, reason: 'hash-failed' };
        }
    }

    if (!/^\$2[aby]\$\d{2}\$/.test(passwordHash)) {
        logger.warn?.('[seed] bootstrap: BOOTSTRAP_ADMIN_PASSWORD_HASH is not a bcrypt hash; refusing to seed');
        return { seeded: false, reason: 'bad-hash-format' };
    }

    // Insert directly via the repository's underlying db so we can preset
    // the pre-hashed password without re-hashing it through create().
    const { generateId } = require('./repositories/BaseRepository');
    const nowSec = Math.floor(Date.now() / 1000);
    const user = {
        id: generateId(),
        username,
        email,
        nickname,
        password_hash: passwordHash,
        role: 'super_admin',
        is_active: 1,
        totp_secret: null,
        totp_enabled: 0,
        recovery_codes: null,
        password_reset_token: null,
        password_reset_expires: null,
        last_login: null,
        created_at: nowSec,
        created_by: null,
        updated_at: nowSec
    };

    try {
        if (userRepository.db && typeof userRepository.db.insert === 'function') {
            userRepository.db.insert(user);
        } else {
            return { seeded: false, reason: 'no-insert' };
        }
    } catch (err) {
        logger.warn?.('[seed] bootstrap: insert failed:', err.message);
        return { seeded: false, reason: 'insert-failed' };
    }

    logger.log?.(`[seed] bootstrap: created super_admin "${username}" from env`);
    return { seeded: true };
}

module.exports = { runSeed, seedFromDirectory, bootstrapAdminFromEnv };
