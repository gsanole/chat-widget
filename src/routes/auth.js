/**
 * Authentication Routes
 * 
 * Single Responsibility: HTTP endpoints for authentication
 */

const express = require('express');

/**
 * Create auth router
 * @param {Object} deps - Dependencies
 * @param {Object} deps.authService - Authentication service
 * @param {Object} deps.userRepository - User repository
 * @param {Object} deps.sessionRepository - Session repository
 * @param {Object} deps.auditRepository - Audit repository
 * @param {Object} deps.totp - TOTP module
 * @param {Function} deps.authLimiter - Rate limiter middleware
 * @param {Object} deps.authMiddleware - Auth middleware
 * @returns {Router}
 */
function createAuthRouter({
    authService,
    userRepository,
    sessionRepository,
    auditRepository,
    totp,
    authLimiter,
    authMiddleware
}) {
    const router = express.Router();
    const { requireAuth } = authMiddleware;

    // Health check
    router.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    });

    // Admin login
    router.post('/admin/login', authLimiter, async (req, res) => {
        // Trim whitespace - copy/paste from password managers and mobile
        // keyboards frequently appends a trailing space.
        const username = typeof req.body.username === 'string' ? req.body.username.trim() : req.body.username;
        const password = typeof req.body.password === 'string' ? req.body.password.trim() : req.body.password;
        const totpCode = typeof req.body.totpCode === 'string' ? req.body.totpCode.trim() : req.body.totpCode;
        const ip = req.ip || req.socket?.remoteAddress;
        const userAgent = req.headers['user-agent'];

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        try {
            const user = await userRepository.authenticate(username, password);

            if (!user) {
                auditRepository.log({
                    userId: null,
                    username,
                    action: 'LOGIN_FAILED',
                    resourceType: 'user',
                    details: { reason: 'Invalid credentials' },
                    ipAddress: ip,
                    userAgent
                });
                return res.status(401).json({ error: 'Invalid username or password' });
            }

            // Check if 2FA is enabled
            if (user.totp_enabled) {
                if (!totpCode) {
                    return res.status(200).json({
                        requires2FA: true,
                        message: 'Please enter your 2FA code'
                    });
                }

                // Verify TOTP code
                if (!totp.verifyTOTP(user.totp_secret, totpCode)) {
                    // Check recovery codes
                    if (user.recovery_codes) {
                        const codes = Array.isArray(user.recovery_codes)
                            ? [...user.recovery_codes]
                            : (typeof user.recovery_codes === 'string'
                                ? JSON.parse(user.recovery_codes)
                                : []);
                        const result = totp.verifyRecoveryCode(codes, totpCode);
                        if (result.valid) {
                            userRepository.enableTotp(user.id, result.remainingCodes);
                            auditRepository.log({
                                userId: user.id,
                                username,
                                action: 'RECOVERY_CODE_USED',
                                resourceType: 'user',
                                resourceId: user.id,
                                details: { codesRemaining: result.remainingCodes.length },
                                ipAddress: ip,
                                userAgent
                            });
                        } else {
                            auditRepository.log({
                                userId: user.id,
                                username,
                                action: 'LOGIN_FAILED',
                                resourceType: 'user',
                                resourceId: user.id,
                                details: { reason: 'Invalid 2FA code' },
                                ipAddress: ip,
                                userAgent
                            });
                            return res.status(401).json({ error: 'Invalid 2FA code' });
                        }
                    } else {
                        auditRepository.log({
                            userId: user.id,
                            username,
                            action: 'LOGIN_FAILED',
                            resourceType: 'user',
                            resourceId: user.id,
                            details: { reason: 'Invalid 2FA code' },
                            ipAddress: ip,
                            userAgent
                        });
                        return res.status(401).json({ error: 'Invalid 2FA code' });
                    }
                }
            }

            // Generate token
            const token = authService.generateToken(user);

            // Update last login
            userRepository.updateLastLogin(user.id);

            // Create session
            sessionRepository.create({
                userId: user.id,
                token,
                ipAddress: ip,
                userAgent
            });

            // Audit log
            auditRepository.log({
                userId: user.id,
                username,
                action: 'LOGIN_SUCCESS',
                resourceType: 'user',
                resourceId: user.id,
                ipAddress: ip,
                userAgent
            });

            res.json({
                success: true,
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    totp_enabled: user.totp_enabled
                }
            });
        } catch (err) {
            console.error('Login error:', err);
            res.status(500).json({ error: 'Login failed' });
        }
    });

    // Verify token
    router.get('/admin/verify', requireAuth, (req, res) => {
        const user = userRepository.findById(req.user.userId);
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }
        res.json({
            valid: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                totp_enabled: user.totp_enabled
            }
        });
    });

    // Logout
    router.post('/admin/logout', requireAuth, (req, res) => {
        const token = req.headers.authorization.substring(7);
        sessionRepository.deleteByToken(token);
        auditRepository.log({
            userId: req.user.userId,
            username: req.user.username,
            action: 'LOGOUT',
            resourceType: 'user',
            resourceId: req.user.userId,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        });
        res.json({ success: true });
    });

    return router;
}

module.exports = { createAuthRouter };
