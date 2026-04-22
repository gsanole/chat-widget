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

    const entries = fs.readdirSync(seedDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const src = path.join(seedDir, entry.name);
        const dest = path.join(dataDir, entry.name);

        // If the destination exists, only overwrite when it's unreadable
        // or unparseable JSON (corrupt). Valid existing data is preserved.
        // Special case: users.json with zero users is treated as needing
        // re-seed so the bootstrap admin is always available.
        if (fs.existsSync(dest)) {
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
}

function runSeed() {
    const dataDir = process.env.DATABASE_DIR
        || path.join(__dirname, '../../data');
    const seedDir = process.env.SEED_DIR
        || path.join(__dirname, '../../data-seed');
    seedFromDirectory(seedDir, dataDir);
}

module.exports = { runSeed, seedFromDirectory };
