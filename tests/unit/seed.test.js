/**
 * Direct branch coverage for src/database/seed.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ORIG_DB = process.env.DATABASE_DIR;
const ORIG_SEED = process.env.SEED_DIR;

let workDir;

function mkSeed(filesByName, version) {
    const seed = fs.mkdtempSync(path.join(os.tmpdir(), 'seedsrc-'));
    for (const [name, content] of Object.entries(filesByName)) {
        fs.writeFileSync(path.join(seed, name), content);
    }
    if (version !== undefined) {
        fs.writeFileSync(path.join(seed, '.seed-version'), version);
    }
    // Add a directory entry to test the "!entry.isFile()" branch
    fs.mkdirSync(path.join(seed, 'subdir'));
    return seed;
}

function freshDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'seeddata-'));
}

function loadSeed() {
    jest.resetModules();
    return require('../../src/database/seed');
}

beforeEach(() => {
    workDir = [];
});

afterEach(() => {
    for (const d of workDir) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { }
    }
});

afterAll(() => {
    if (ORIG_DB === undefined) delete process.env.DATABASE_DIR;
    else process.env.DATABASE_DIR = ORIG_DB;
    if (ORIG_SEED === undefined) delete process.env.SEED_DIR;
    else process.env.SEED_DIR = ORIG_SEED;
    jest.resetModules();
});

describe('seedFromDirectory branches', () => {
    test('returns immediately when seedDir does not exist', () => {
        const seed = loadSeed();
        const dataDir = freshDataDir();
        workDir.push(dataDir);
        // Remove dataDir so we can verify mkdir branch
        fs.rmSync(dataDir, { recursive: true, force: true });
        // Pass non-existent seed dir
        expect(() => seed.seedFromDirectory(
            path.join(os.tmpdir(), 'does-not-exist-' + Date.now()),
            dataDir
        )).not.toThrow();
        expect(fs.existsSync(dataDir)).toBe(false);
    });

    test('creates dataDir when missing and copies files', () => {
        const seed = loadSeed();
        const seedDir = mkSeed({ 'a.json': '{"x":1}' });
        workDir.push(seedDir);
        const dataDir = path.join(os.tmpdir(), 'seeddata-new-' + Date.now());
        workDir.push(dataDir);
        seed.seedFromDirectory(seedDir, dataDir);
        expect(fs.existsSync(path.join(dataDir, 'a.json'))).toBe(true);
    });

    test('skips when dest exists and is valid JSON', () => {
        const seed = loadSeed();
        const seedDir = mkSeed({ 'cfg.json': '{"new":true}' });
        const dataDir = freshDataDir();
        workDir.push(seedDir, dataDir);
        fs.writeFileSync(path.join(dataDir, 'cfg.json'), '{"old":true}');
        seed.seedFromDirectory(seedDir, dataDir);
        const result = JSON.parse(fs.readFileSync(path.join(dataDir, 'cfg.json'), 'utf8'));
        expect(result.old).toBe(true);
    });

    test('overwrites when dest is invalid JSON', () => {
        const seed = loadSeed();
        const seedDir = mkSeed({ 'broken.json': '{"valid":true}' });
        const dataDir = freshDataDir();
        workDir.push(seedDir, dataDir);
        fs.writeFileSync(path.join(dataDir, 'broken.json'), '{not json');
        seed.seedFromDirectory(seedDir, dataDir);
        const result = JSON.parse(fs.readFileSync(path.join(dataDir, 'broken.json'), 'utf8'));
        expect(result.valid).toBe(true);
    });

    test('reseeds users.json when on-disk users array is empty', () => {
        const seed = loadSeed();
        const seedDir = mkSeed({ 'users.json': '[{"id":"admin"}]' });
        const dataDir = freshDataDir();
        workDir.push(seedDir, dataDir);
        fs.writeFileSync(path.join(dataDir, 'users.json'), '[]');
        seed.seedFromDirectory(seedDir, dataDir);
        const result = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'));
        expect(result.length).toBe(1);
    });

    test('forces reseed when seed-version differs', () => {
        const seed = loadSeed();
        const seedDir = mkSeed({ 'data.json': '{"v":2}' }, 'v2');
        const dataDir = freshDataDir();
        workDir.push(seedDir, dataDir);
        fs.writeFileSync(path.join(dataDir, 'data.json'), '{"v":1}');
        fs.writeFileSync(path.join(dataDir, '.seed-version'), 'v1');
        seed.seedFromDirectory(seedDir, dataDir);
        const result = JSON.parse(fs.readFileSync(path.join(dataDir, 'data.json'), 'utf8'));
        expect(result.v).toBe(2);
        expect(fs.readFileSync(path.join(dataDir, '.seed-version'), 'utf8').trim()).toBe('v2');
    });

    test('skips reseed when versions match', () => {
        const seed = loadSeed();
        const seedDir = mkSeed({ 'data.json': '{"v":2}' }, 'v2');
        const dataDir = freshDataDir();
        workDir.push(seedDir, dataDir);
        fs.writeFileSync(path.join(dataDir, 'data.json'), '{"v":1}');
        fs.writeFileSync(path.join(dataDir, '.seed-version'), 'v2');
        seed.seedFromDirectory(seedDir, dataDir);
        const result = JSON.parse(fs.readFileSync(path.join(dataDir, 'data.json'), 'utf8'));
        expect(result.v).toBe(1);
    });

    test('runSeed uses env DATABASE_DIR and SEED_DIR', () => {
        const seed = loadSeed();
        const seedDir = mkSeed({ 'env-test.json': '{"ok":1}' });
        const dataDir = freshDataDir();
        workDir.push(seedDir, dataDir);
        process.env.SEED_DIR = seedDir;
        process.env.DATABASE_DIR = dataDir;
        try {
            seed.runSeed();
            expect(fs.existsSync(path.join(dataDir, 'env-test.json'))).toBe(true);
        } finally {
            if (ORIG_SEED === undefined) delete process.env.SEED_DIR;
            else process.env.SEED_DIR = ORIG_SEED;
            if (ORIG_DB === undefined) delete process.env.DATABASE_DIR;
            else process.env.DATABASE_DIR = ORIG_DB;
        }
    });

    test('runSeed falls back to default dirs without env (no-op when seed dir missing)', () => {
        const seed = loadSeed();
        const savedSeed = process.env.SEED_DIR;
        const savedData = process.env.DATABASE_DIR;
        delete process.env.SEED_DIR;
        delete process.env.DATABASE_DIR;
        try {
            // Should not throw even if data-seed/data dirs don't exist
            expect(() => seed.runSeed()).not.toThrow();
        } finally {
            if (savedSeed !== undefined) process.env.SEED_DIR = savedSeed;
            if (savedData !== undefined) process.env.DATABASE_DIR = savedData;
        }
    });
});
