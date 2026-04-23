/**
 * Reset a user's password and disable 2FA.
 *
 * Usage (in Render shell or locally):
 *   node scripts/reset-admin-password.js <username> <newPassword>
 *
 * Example:
 *   node scripts/reset-admin-password.js superadmin "MyNewStrongPassword!42"
 *
 * What it does:
 *   - Looks up the user by username in the active JsonDB data dir
 *     (DATABASE_DIR or ./data).
 *   - Hashes the new password with bcrypt cost 12.
 *   - Sets is_active=1, totp_enabled=0, totp_secret=null, recovery_codes=null
 *     so you can log in with just username + password.
 *   - Saves and exits.
 *
 * Safe to run multiple times. Does NOT create a new user — fails if the
 * username does not exist (use the seed file or a separate script for that).
 */

const bcrypt = require('bcrypt');
const path = require('path');

async function main() {
    const [, , username, newPassword] = process.argv;

    if (!username || !newPassword) {
        console.error('Usage: node scripts/reset-admin-password.js <username> <newPassword>');
        process.exit(1);
    }

    if (newPassword.length < 8) {
        console.error('Password must be at least 8 characters.');
        process.exit(1);
    }

    // Load DB the same way the server does so DATABASE_DIR is honored.
    const db = require(path.join(__dirname, '..', 'src', 'database'));

    const user = db.users.findByUsername(username);
    if (!user) {
        console.error(`User "${username}" not found in ${process.env.DATABASE_DIR || './data'}.`);
        console.error('Existing usernames:');
        for (const u of db.users.findAll()) {
            console.error('  - ' + u.username + ' (' + u.role + ')');
        }
        process.exit(2);
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    // JsonDB.update(predicate, updates) — match by id.
    db.users.db.update(
        u => u.id === user.id,
        {
            password_hash: passwordHash,
            is_active: 1,
            totp_enabled: 0,
            totp_secret: null,
            recovery_codes: null,
            password_reset_token: null,
            password_reset_expires: null
        }
    );

    console.log(`OK: password reset for "${username}" (role=${user.role}). 2FA disabled.`);
    console.log('You can now log in with the new password and no 2FA code.');
    process.exit(0);
}

main().catch(err => {
    console.error('Reset failed:', err);
    process.exit(3);
});
