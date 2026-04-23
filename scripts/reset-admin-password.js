/**
 * Reset a user's password and disable 2FA. EMERGENCY-RECOVERY ONLY.
 *
 * Usage (in Render shell or locally):
 *   CONFIRM_RESET=<username> node scripts/reset-admin-password.js <username> <newPassword>
 *
 * Example:
 *   CONFIRM_RESET=superadmin node scripts/reset-admin-password.js superadmin "MyNewStrongPassword!42"
 *
 * Why the env-var confirmation?
 *   This script bypasses 2FA entirely. The CONFIRM_RESET=<username> guard
 *   forces you to type the username twice (once as arg, once as env) so it
 *   cannot be triggered by accident, by a stray shell-history recall, or
 *   by an attacker who can run a single short command but cannot also set
 *   environment variables.
 *
 * What it does:
 *   - Looks up the user by username in the active JsonDB data dir
 *     (DATABASE_DIR or ./data).
 *   - Hashes the new password with bcrypt cost 12.
 *   - Sets is_active=1, totp_enabled=0, totp_secret=null, recovery_codes=null
 *     so you can log in with just username + password.
 *   - Writes an audit-log entry (action=ADMIN_PASSWORD_RESET_SCRIPT) so the
 *     reset is visible in the admin Audit page.
 *   - Saves and exits.
 *
 * Safe to run multiple times. Does NOT create a new user.
 */

const bcrypt = require('bcrypt');
const path = require('path');

async function main() {
    const [, , username, newPassword] = process.argv;

    if (!username || !newPassword) {
        console.error('Usage: CONFIRM_RESET=<username> node scripts/reset-admin-password.js <username> <newPassword>');
        process.exit(1);
    }

    if (process.env.CONFIRM_RESET !== username) {
        console.error('Refusing to run: set CONFIRM_RESET=' + username + ' to confirm this destructive action.');
        console.error('  Example:  CONFIRM_RESET=' + username + ' node scripts/reset-admin-password.js ' + username + ' "<newPassword>"');
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

    const had2fa = user.totp_enabled === 1 || user.totp_enabled === true;
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

    // Audit-log the reset so it's visible in the admin UI.
    try {
        db.audit.log({
            userId: user.id,
            username: user.username,
            action: 'ADMIN_PASSWORD_RESET_SCRIPT',
            resourceType: 'user',
            resourceId: user.id,
            details: JSON.stringify({
                role: user.role,
                two_factor_disabled: had2fa,
                ran_by: process.env.USER || process.env.USERNAME || 'unknown',
                host: require('os').hostname()
            }),
            ipAddress: 'cli',
            userAgent: 'reset-admin-password.js'
        });
    } catch (auditErr) {
        console.warn('Audit log write failed (continuing):', auditErr.message);
    }

    console.log(`OK: password reset for "${username}" (role=${user.role}). 2FA ${had2fa ? 'was enabled and is now DISABLED' : 'was already disabled'}.`);
    console.log('Logged to audit as ADMIN_PASSWORD_RESET_SCRIPT.');
    console.log('You can now log in with the new password and no 2FA code.');
    process.exit(0);
}

main().catch(err => {
    console.error('Reset failed:', err);
    process.exit(3);
});

