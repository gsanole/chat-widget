/**
 * Re-persist all stored TOTP secrets in their canonical, encrypted form.
 *
 * Usage:
 *   TOTP_ENCRYPTION_KEY="<long random string>" node scripts/migrate-totp-secrets.js
 *
 * What it does (idempotent, safe to re-run):
 *   - Walks every user with a totp_secret.
 *   - Decrypts (if already enc:v1:), or accepts plaintext base32 / legacy
 *     {type:'Buffer',data:[...]} / raw Buffer.
 *   - Re-writes via UserRepository.setTotpSecret, which:
 *       * normalizes to base32, then
 *       * wraps with AES-256-GCM when TOTP_ENCRYPTION_KEY is set.
 *   - Skips users whose secret cannot be decrypted (logged as WARN; usually
 *     means the secret was encrypted with a different key — DO NOT delete
 *     it, just rotate back or re-enroll that user).
 *
 * Recommended workflow:
 *   1. Generate a strong key:  openssl rand -base64 48
 *   2. Set it as TOTP_ENCRYPTION_KEY in your Render environment variables
 *      (Settings -> Environment). Save (this triggers a restart).
 *   3. Open Render Shell and run this script once.
 *   4. Verify by logging in with 2FA.
 *   5. KEEP THE KEY SAFE. Losing it means existing 2FA secrets are
 *      unrecoverable and affected users must re-enroll.
 */

const path = require('path');

function main() {
    const db = require(path.join(__dirname, '..', 'src', 'database'));
    const totp = require(path.join(__dirname, '..', 'src', 'utils', 'totp'));

    const enabled = totp.isEncryptionEnabled();
    console.log('TOTP_ENCRYPTION_KEY is ' + (enabled ? 'SET (will encrypt)' : 'NOT SET (will only normalize format)'));

    const users = db.users.findAll();
    let migrated = 0;
    let skipped = 0;
    let alreadyEncrypted = 0;
    let failed = 0;

    for (const u of users) {
        if (!u.totp_secret) { skipped++; continue; }

        const isEnc = typeof u.totp_secret === 'string' && u.totp_secret.startsWith('enc:v1:');

        // Get plaintext base32 to re-persist.
        let base32 = null;
        if (isEnc) {
            const dec = totp.decryptSecret(u.totp_secret);
            if (!dec) {
                console.warn(`WARN  ${u.username}: cannot decrypt existing secret (wrong/missing key). Skipping.`);
                failed++;
                continue;
            }
            base32 = dec;
        } else if (Buffer.isBuffer(u.totp_secret)) {
            base32 = totp.encodeBase32(u.totp_secret);
        } else if (typeof u.totp_secret === 'object' && Array.isArray(u.totp_secret.data)) {
            base32 = totp.encodeBase32(Buffer.from(u.totp_secret.data));
        } else if (typeof u.totp_secret === 'string') {
            base32 = u.totp_secret;
        } else {
            console.warn(`WARN  ${u.username}: unrecognized secret shape, skipping.`);
            failed++;
            continue;
        }

        if (isEnc && enabled) {
            // Already encrypted with the current key; nothing to do.
            alreadyEncrypted++;
            continue;
        }

        db.users.setTotpSecret(u.id, base32);
        migrated++;
        console.log(`OK    ${u.username}: re-persisted (${enabled ? 'encrypted' : 'plaintext base32'}).`);
    }

    console.log('---');
    console.log(`Migrated: ${migrated}, already-encrypted: ${alreadyEncrypted}, no-secret: ${skipped}, failed: ${failed}`);
    process.exit(failed > 0 ? 4 : 0);
}

try {
    main();
} catch (err) {
    console.error('Migration failed:', err);
    process.exit(3);
}
