/**
 * Encryption-at-rest hardening for TOTP secrets.
 *
 * Verifies:
 *  - When TOTP_ENCRYPTION_KEY is set, secrets persist as enc:v1:... and
 *    still verify correctly.
 *  - Without the key, secrets persist as plaintext base32 (back-compat).
 *  - An encrypted secret with NO key configured fails closed (verify=false)
 *    rather than appearing to succeed or crashing.
 *  - Wrong key fails closed.
 *  - Legacy {type:'Buffer',data:[...]} shape still verifies (no re-enroll).
 *  - Double-wrapping is prevented when an enc:v1: string is passed in.
 */

const path = require('path');

describe('TOTP encryption-at-rest', () => {
    const ORIGINAL_KEY = process.env.TOTP_ENCRYPTION_KEY;

    afterEach(() => {
        if (ORIGINAL_KEY === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
        else process.env.TOTP_ENCRYPTION_KEY = ORIGINAL_KEY;
        // Drop module caches so totp.js re-derives its key.
        jest.resetModules();
    });

    test('encryptSecret returns input unchanged when no key is configured', () => {
        delete process.env.TOTP_ENCRYPTION_KEY;
        const totp = require('../../src/utils/totp');
        const base32 = totp.encodeBase32(totp.generateSecret());
        expect(totp.encryptSecret(base32)).toBe(base32);
        expect(totp.isEncryptionEnabled()).toBe(false);
    });

    test('encryptSecret -> decryptSecret round-trip with key', () => {
        process.env.TOTP_ENCRYPTION_KEY = 'k'.repeat(48);
        jest.resetModules();
        const totp = require('../../src/utils/totp');
        const base32 = totp.encodeBase32(totp.generateSecret());
        const wrapped = totp.encryptSecret(base32);
        expect(wrapped.startsWith('enc:v1:')).toBe(true);
        expect(wrapped).not.toContain(base32);
        expect(totp.decryptSecret(wrapped)).toBe(base32);
        expect(totp.isEncryptionEnabled()).toBe(true);
    });

    test('verifyTOTP works on an encrypted-at-rest secret', () => {
        process.env.TOTP_ENCRYPTION_KEY = 'unit-test-key-please-be-very-long-1234567890';
        jest.resetModules();
        const totp = require('../../src/utils/totp');
        const secret = totp.generateSecret();
        const stored = totp.encryptSecret(totp.encodeBase32(secret));
        const code = totp.generateTOTP(secret);
        expect(totp.verifyTOTP(stored, code)).toBe(true);
    });

    test('encrypted secret with NO key fails closed (verify=false, never throws)', () => {
        process.env.TOTP_ENCRYPTION_KEY = 'first-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        jest.resetModules();
        const totp1 = require('../../src/utils/totp');
        const secret = totp1.generateSecret();
        const code = totp1.generateTOTP(secret);
        const wrapped = totp1.encryptSecret(totp1.encodeBase32(secret));

        delete process.env.TOTP_ENCRYPTION_KEY;
        jest.resetModules();
        const totp2 = require('../../src/utils/totp');
        expect(() => totp2.verifyTOTP(wrapped, code)).not.toThrow();
        expect(totp2.verifyTOTP(wrapped, code)).toBe(false);
        expect(totp2.normalizeSecret(wrapped)).toBeNull();
    });

    test('wrong key fails closed', () => {
        process.env.TOTP_ENCRYPTION_KEY = 'real-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
        jest.resetModules();
        const totp1 = require('../../src/utils/totp');
        const secret = totp1.generateSecret();
        const code = totp1.generateTOTP(secret);
        const wrapped = totp1.encryptSecret(totp1.encodeBase32(secret));

        process.env.TOTP_ENCRYPTION_KEY = 'wrong-key-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy';
        jest.resetModules();
        const totp2 = require('../../src/utils/totp');
        expect(totp2.verifyTOTP(wrapped, code)).toBe(false);
    });

    test('legacy {type:Buffer,data:[...]} shape still verifies (no re-enroll required)', () => {
        delete process.env.TOTP_ENCRYPTION_KEY;
        jest.resetModules();
        const totp = require('../../src/utils/totp');
        const secret = totp.generateSecret();
        const code = totp.generateTOTP(secret);
        const legacy = JSON.parse(JSON.stringify(secret)); // {type:'Buffer',data:[...]}
        expect(legacy.type).toBe('Buffer');
        expect(totp.verifyTOTP(legacy, code)).toBe(true);
    });

    test('plaintext base32 string still verifies (back-compat path)', () => {
        delete process.env.TOTP_ENCRYPTION_KEY;
        jest.resetModules();
        const totp = require('../../src/utils/totp');
        const secret = totp.generateSecret();
        const stored = totp.encodeBase32(secret);
        const code = totp.generateTOTP(secret);
        expect(totp.verifyTOTP(stored, code)).toBe(true);
    });

    test('passing an already-encrypted string into setTotpSecret does not double-wrap', () => {
        process.env.TOTP_ENCRYPTION_KEY = 'no-double-wrap-zzzzzzzzzzzzzzzzzzzzzzzzz';
        jest.resetModules();
        // Use a fresh JsonDB-backed UserRepository in a temp dir.
        const fs = require('fs');
        const os = require('os');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totp-enc-'));
        process.env.DATABASE_DIR = tmpDir;
        jest.resetModules();
        const { JsonDB } = require('../../src/database/JsonDB');
        const { UserRepository } = require('../../src/database/repositories/UserRepository');
        const totp = require('../../src/utils/totp');

        const usersDB = new JsonDB('users.json', []);
        usersDB.insert({ id: 'u1', username: 'alice', totp_secret: null });
        const repo = new UserRepository(usersDB);

        const secret = totp.generateSecret();
        const code = totp.generateTOTP(secret);
        const wrappedOnce = totp.encryptSecret(totp.encodeBase32(secret));

        repo.setTotpSecret('u1', wrappedOnce);
        const stored = usersDB.find(u => u.id === 'u1').totp_secret;

        // Stored unchanged; verification succeeds; not double-wrapped.
        expect(stored).toBe(wrappedOnce);
        expect(totp.verifyTOTP(stored, code)).toBe(true);

        // Cleanup
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        delete process.env.DATABASE_DIR;
    });
});
