/**
 * Authentication Service
 * 
 * Single Responsibility: Authentication and authorization
 * Dependency Inversion: Receives repositories as dependencies
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { JWT_SECRET, SECURITY_LIMITS } = require('../config/security');
const { hasPermission } = require('../config/permissions');
const { TwoFactorService } = require('./TwoFactorService');

/**
 * Authentication Service
 */
class AuthService {
    /**
     * @param {Object} deps - Dependencies
     * @param {Object} deps.userRepository    - User repository
     * @param {Object} deps.sessionRepository - Session repository
     * @param {Object} deps.auditRepository   - Audit repository
     * @param {Object} [deps.twoFactorService] - Optional injected 2FA
     *        service. If omitted, one is constructed from the supplied
     *        repositories.
     */
    constructor({ userRepository, sessionRepository, auditRepository, twoFactorService }) {
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
        this.auditRepository = auditRepository;
        this.twoFactorService = twoFactorService
            || new TwoFactorService({ userRepository, auditRepository });
    }

    /**
     * Generate JWT token for a user
     * @param {Object} user - User object
     * @returns {string}
     */
    generateToken(user) {
        return jwt.sign(
            {
                userId: user.id,
                username: user.username,
                role: user.role,
                id: crypto.randomUUID()
            },
            JWT_SECRET,
            { expiresIn: SECURITY_LIMITS.adminSessionDuration }
        );
    }

    /**
     * Verify JWT token
     * @param {string} token - JWT token
     * @returns {Object|null}
     */
    verifyToken(token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            // Verify user still exists and is active
            const user = this.userRepository.findById(decoded.userId);
            if (!user || !user.is_active) {
                return null;
            }
            return decoded;
        } catch (e) {
            return null;
        }
    }

    /**
     * Authenticate user with username and password
     * @param {string} username
     * @param {string} password
     * @param {Object} context - Request context (IP, user agent)
     * @returns {Promise<Object>}
     */
    async authenticate(username, password, context = {}) {
        const user = await this.userRepository.authenticate(username, password);

        if (!user) {
            // Log failed attempt
            this.auditRepository.log({
                userId: null,
                username: username,
                action: 'login_failed',
                details: 'Invalid credentials',
                ipAddress: context.ip,
                userAgent: context.userAgent
            });
            return { success: false, error: 'Invalid credentials' };
        }

        // Check if 2FA is required
        if (user.totp_enabled) {
            return {
                success: false,
                requires2FA: true,
                userId: user.id,
                username: user.username
            };
        }

        // Generate token and log success
        const token = this.generateToken(user);
        this.userRepository.updateLastLogin(user.id);

        this.auditRepository.log({
            userId: user.id,
            username: user.username,
            action: 'login',
            details: 'Login successful',
            ipAddress: context.ip,
            userAgent: context.userAgent
        });

        return {
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                nickname: user.nickname || user.username,
                role: user.role,
                totp_enabled: user.totp_enabled
            }
        };
    }

    /**
     * Complete 2FA authentication. Delegates code verification to
     * TwoFactorService and, on success, issues a JWT and writes the
     * login audit entry.
     *
     * @param {string} userId
     * @param {string} code - TOTP code or single-use recovery code.
     * @param {Function} verifyTOTP - TOTP verification function.
     * @param {Object} context - Request context.
     * @returns {Promise<Object>}
     */
    async verify2FA(userId, code, verifyTOTP, context = {}) {
        const result = await this.twoFactorService.verify(userId, code, verifyTOTP, context);
        if (!result.ok) {
            return { success: false, error: result.error };
        }

        const user = result.user;
        const token = this.generateToken(user);
        this.userRepository.updateLastLogin(user.id);

        this.auditRepository.log({
            userId: user.id,
            username: user.username,
            action: 'login_2fa',
            details: '2FA login successful',
            ipAddress: context.ip,
            userAgent: context.userAgent
        });

        return {
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                nickname: user.nickname || user.username,
                role: user.role
            }
        };
    }

    /**
     * Logout user
     * @param {string} token
     * @param {Object} user - User info from token
     * @param {Object} context
     */
    logout(token, user, context = {}) {
        this.sessionRepository.deleteByToken(token);

        this.auditRepository.log({
            userId: user.userId,
            username: user.username,
            action: 'logout',
            ipAddress: context.ip,
            userAgent: context.userAgent
        });
    }

    /**
     * Check if user has permission
     * @param {string} role
     * @param {string} permission
     * @returns {boolean}
     */
    hasPermission(role, permission) {
        return hasPermission(role, permission);
    }

    /**
     * Get user from token
     * @param {string} token
     * @returns {Object|null}
     */
    getUserFromToken(token) {
        const decoded = this.verifyToken(token);
        if (!decoded) return null;
        return this.userRepository.findById(decoded.userId);
    }
}

module.exports = { AuthService };
