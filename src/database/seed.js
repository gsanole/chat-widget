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

module.exports = { runSeed, seedFromDirectory };
