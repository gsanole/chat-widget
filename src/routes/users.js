/**
 * User Management Routes
 * 
 * Single Responsibility: HTTP endpoints for user management
 */

const express = require('express');

/**
 * Create users router
 * @param {Object} deps - Dependencies
 * @param {Object} deps.userRepository - User repository
 * @param {Object} deps.auditRepository - Audit repository
 * @param {Object} deps.totp - TOTP module
 * @param {Object} deps.authMiddleware - Auth middleware
 * @returns {Router}
 */
function createUsersRouter({
    userRepository,
    auditRepository,
    totp,
    authMiddleware
}) {
    const router = express.Router();
    const { requireAuth, requirePermission } = authMiddleware;

    // Helper for audit logging
    function auditLog(req, action, resourceType = null, resourceId = null, details = null) {
        const ip = req.ip || req.socket?.remoteAddress;
        const userAgent = req.headers['user-agent'];
        auditRepository.log({
            userId: req.user?.userId || null,
            username: req.user?.username || 'anonymous',
            action,
            resourceType,
            resourceId,
            details,
            ipAddress: ip,
            userAgent
        });
    }

    // Get all users (super_admin only)
    router.get('/', requireAuth, requirePermission('manage_users'), (req, res) => {
        const users = userRepository.findAll();
        res.json(users);
    });

    // Create user (super_admin only)
    router.post('/', requireAuth, requirePermission('manage_users'), async (req, res) => {
        const { username, email, password, role, nickname } = req.body;

        if (!username || !password || !role) {
            return res.status(400).json({ error: 'Username, password, and role are required' });
        }
        const validRoles = ['super_admin', 'admin', 'admin_support', 'support', 'operator', 'viewer'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        try {
            const user = await userRepository.create({
                username,
                email,
                password,
                role,
                nickname,
                createdBy: req.user.userId
            });

            auditLog(req, 'USER_CREATED', 'user', user.id, { username, role });
            res.json({ success: true, user });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    // PUT alias for updating user (combines role/active/nickname)
    router.put('/:id', requireAuth, requirePermission('manage_users'), (req, res) => {
        const userId = req.params.id;
        const user = userRepository.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const { role, isActive, nickname, email } = req.body || {};
        if (role !== undefined && userId === req.user.userId && role !== user.role) {
            return res.status(400).json({ error: 'Cannot change your own role' });
        }
        if (isActive === false && userId === req.user.userId) {
            return res.status(400).json({ error: 'Cannot deactivate yourself' });
        }
        let updated = user;
        if (role !== undefined) updated = userRepository.updateRole(userId, role) || updated;
        if (isActive !== undefined) updated = userRepository.updateActive(userId, isActive) || updated;
        if (nickname !== undefined && userRepository.updateNickname) updated = userRepository.updateNickname(userId, nickname) || updated;
        if (email !== undefined && userRepository.update) updated = userRepository.update(userId, { email }) || updated;
        auditLog(req, 'USER_UPDATED', 'user', userId);
        res.json({ success: true, user: updated, ...updated });
    });

    // Update user role
    router.patch('/:id/role', requireAuth, requirePermission('manage_users'), (req, res) => {
        const { role } = req.body;
        const userId = req.params.id;

        if (!role) {
            return res.status(400).json({ error: 'Role is required' });
        }

        const user = userRepository.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Prevent changing own role
        if (userId === req.user.userId) {
            return res.status(400).json({ error: 'Cannot change your own role' });
        }

        const updated = userRepository.updateRole(userId, role);
        auditLog(req, 'USER_ROLE_CHANGED', 'user', userId, { oldRole: user.role, newRole: role });

        res.json({ success: true, user: updated });
    });

    // Update user active status
    router.patch('/:id/active', requireAuth, requirePermission('manage_users'), (req, res) => {
        const { isActive } = req.body;
        const userId = req.params.id;

        const user = userRepository.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Prevent deactivating self
        if (userId === req.user.userId && !isActive) {
            return res.status(400).json({ error: 'Cannot deactivate yourself' });
        }

        const updated = userRepository.updateActive(userId, isActive);
        auditLog(req, isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', 'user', userId);

        res.json({ success: true, user: updated });
    });

    // Delete user
    router.delete('/:id', requireAuth, requirePermission('manage_users'), (req, res) => {
        const userId = req.params.id;

        if (userId === req.user.userId) {
            return res.status(400).json({ error: 'Cannot delete yourself' });
        }

        try {
            const deleted = userRepository.delete(userId);
            if (deleted) {
                auditLog(req, 'USER_DELETED', 'user', userId);
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'User not found' });
            }
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    // Get user stats
    router.get('/stats', requireAuth, requirePermission('manage_users'), (req, res) => {
        const stats = userRepository.getStats();
        res.json(stats);
    });

    // Profile routes (self)
    router.get('/profile', requireAuth, (req, res) => {
        const user = userRepository.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({
            id: user.id,
            username: user.username,
            nickname: user.nickname,
            email: user.email,
            role: user.role,
            totp_enabled: user.totp_enabled,
            created_at: user.created_at
        });
    });

    // Update own nickname
    router.patch('/profile/nickname', requireAuth, (req, res) => {
        const { nickname } = req.body;
        if (!nickname) {
            return res.status(400).json({ error: 'Nickname is required' });
        }

        const updated = userRepository.updateNickname(req.user.userId, nickname);
        res.json({ success: true, nickname: updated?.nickname });
    });

    // Change own password
    router.post('/profile/password', requireAuth, async (req, res) => {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new password are required' });
        }
        if (typeof newPassword !== 'string' || newPassword.length < 8) {
            return res.status(400).json({ error: 'Password too weak (minimum 8 characters)' });
        }

        const user = userRepository.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify current password
        const isValid = await userRepository.authenticate(user.username, currentPassword);
        if (!isValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        await userRepository.updatePassword(req.user.userId, newPassword);
        auditLog(req, 'PASSWORD_CHANGED', 'user', req.user.userId);

        res.json({ success: true });
    });

    // 2FA Setup routes
    router.post('/profile/2fa/setup', requireAuth, async (req, res) => {
        const user = userRepository.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.totp_enabled) {
            return res.status(400).json({ error: '2FA is already enabled' });
        }

        const secret = totp.generateSecret();
        userRepository.setTotpSecret(req.user.userId, secret);

        const otpAuthUrl = totp.generateTOTPUri(secret, user.username, 'Support Chat');
        let qrCode = null;
        try { qrCode = await totp.generateQRCodeDataURL(otpAuthUrl); } catch (e) { qrCode = otpAuthUrl; }

        res.json({ secret, otpAuthUrl, qrCode });
    });

    router.post('/profile/2fa/enable', requireAuth, (req, res) => {
        const { code } = req.body;
        if (!code) {
            return res.status(400).json({ error: 'Verification code is required' });
        }

        const user = userRepository.findById(req.user.userId);
        if (!user || !user.totp_secret) {
            return res.status(400).json({ error: '2FA setup not started' });
        }

        if (!totp.verifyTOTP(user.totp_secret, code)) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        const recoveryCodes = totp.generateRecoveryCodes(8);
        userRepository.enableTotp(req.user.userId, recoveryCodes);
        auditLog(req, '2FA_ENABLED', 'user', req.user.userId);

        res.json({ success: true, recoveryCodes });
    });

    router.post('/profile/2fa/disable', requireAuth, (req, res) => {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ error: 'Password required to disable 2FA' });
        }

        const user = userRepository.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        userRepository.authenticate(user.username, password)
            .then(isValid => {
                if (!isValid) {
                    return res.status(401).json({ error: 'Invalid password' });
                }

                userRepository.disableTotp(req.user.userId);
                auditLog(req, '2FA_DISABLED', 'user', req.user.userId);

                res.json({ success: true });
            })
            .catch(err => {
                res.status(500).json({ error: 'Failed to disable 2FA' });
            });
    });

    return router;
}

module.exports = { createUsersRouter };
