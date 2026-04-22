/**
 * TwoFactorService
 *
 * Single Responsibility: validate TOTP / recovery codes against a user
 * record and persist recovery-code consumption. Owns nothing about
 * passwords, JWTs, or sessions — those stay in AuthService.
 *
 * Dependency Inversion: receives userRepository, auditRepository, and
 * the TOTP verifier function as constructor injections so the service
 * is trivially testable with stubs.
 */

class TwoFactorService {
    /**
     * @param {Object}   deps
     * @param {Object}   deps.userRepository
     * @param {Object}   deps.auditRepository
     * @param {Function} [deps.verifyTOTP]  (secret, code) => boolean. May
     *                                      also be passed per-call for
     *                                      backward compatibility.
     */
    constructor({ userRepository, auditRepository, verifyTOTP } = {}) {
        if (!userRepository) throw new Error('TwoFactorService: userRepository is required');
        if (!auditRepository) throw new Error('TwoFactorService: auditRepository is required');
        this.userRepository = userRepository;
        this.auditRepository = auditRepository;
        this.verifyTOTP = verifyTOTP || null;
    }

    /**
     * Verify a TOTP code OR a single-use recovery code for the given user.
     * Consumes the recovery code on success.
     *
     * @param {string|number} userId
     * @param {string} code
     * @param {Function} [verifyTOTPOverride]  Optional per-call verifier
     *                                          (used by callers that don't
     *                                          inject it at construction).
     * @param {Object} [context]                { ip, userAgent } for audit.
     * @returns {Promise<{ ok: boolean, user?: Object, error?: string }>}
     */
    async verify(userId, code, verifyTOTPOverride, context = {}) {
        const verifyFn = verifyTOTPOverride || this.verifyTOTP;
        if (typeof verifyFn !== 'function') {
            return { ok: false, error: 'TOTP verifier not configured' };
        }

        const user = this.userRepository.findById(userId);
        if (!user || !user.is_active) {
            return { ok: false, error: 'User not found' };
        }
        if (!user.totp_secret) {
            return { ok: false, error: '2FA not configured' };
        }

        if (verifyFn(user.totp_secret, code)) {
            return { ok: true, user };
        }

        // Fall back to single-use recovery codes.
        if (!user.recovery_codes) {
            return { ok: false, error: 'Invalid verification code' };
        }

        let codes;
        try {
            codes = JSON.parse(user.recovery_codes);
        } catch (e) {
            return { ok: false, error: 'Invalid verification code' };
        }

        const idx = codes.indexOf(code);
        if (idx === -1) {
            return { ok: false, error: 'Invalid verification code' };
        }

        codes.splice(idx, 1);
        this.userRepository.db.update(
            u => u.id === userId,
            { recovery_codes: JSON.stringify(codes) }
        );

        this.auditRepository.log({
            userId: user.id,
            username: user.username,
            action: 'recovery_code_used',
            details: `Recovery code used. ${codes.length} remaining.`,
            ipAddress: context.ip,
            userAgent: context.userAgent
        });

        return { ok: true, user };
    }
}

module.exports = { TwoFactorService };
