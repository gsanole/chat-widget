/**
 * User Repository
 * 
 * Single Responsibility: User data access
 * Interface Segregation: User-specific operations
 */

const bcrypt = require('bcrypt');
const { BaseRepository, generateId, generateToken, now } = require('./BaseRepository');

class UserRepository extends BaseRepository {
    /**
     * Create a new user
     * @param {Object} userData - User data
     * @returns {Promise<Object>}
     */
    async create({ username, email, password, role, nickname = null, createdBy = null }) {
        // Check for duplicates
        if (this.findByUsername(username)) {
            throw new Error('Username already exists');
        }
        if (email && this.findByEmail(email)) {
            throw new Error('Email already exists');
        }

        const id = generateId();
        const passwordHash = await this._hashPassword(password);

        const user = {
            id,
            username,
            email,
            nickname: nickname || username,
            password_hash: passwordHash,
            role,
            is_active: 1,
            totp_secret: null,
            totp_enabled: 0,
            recovery_codes: null,
            password_reset_token: null,
            password_reset_expires: null,
            last_login: null,
            created_at: now(),
            created_by: createdBy,
            updated_at: now()
        };

        this.db.insert(user);
        return { id, username, email, nickname: user.nickname, role };
    }

    /**
     * Find user by username (case-insensitive)
     * @param {string} username
     * @returns {Object|undefined}
     */
    findByUsername(username) {
        return this.db.find(u => u.username.toLowerCase() === username.toLowerCase());
    }

    /**
     * Find user by email (case-insensitive)
     * @param {string} email
     * @returns {Object|undefined}
     */
    findByEmail(email) {
        return this.db.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
    }

    /**
     * Find all users (sanitized)
     * @returns {Array}
     */
    findAll() {
        return this.db.getAll()
            .map(u => this._sanitizeUser(u))
            .sort((a, b) => b.created_at - a.created_at);
    }

    /**
     * Find active users
     * @returns {Array}
     */
    findActive() {
        return this.db.filter(u => u.is_active === 1)
            .map(u => this._sanitizeUser(u));
    }

    /**
     * Update user nickname
     * @param {string} userId
     * @param {string} nickname
     * @returns {Object|null}
     */
    updateNickname(userId, nickname) {
        return this.db.update(u => u.id === userId, { nickname });
    }

    /**
     * Update user password
     * @param {string} userId
     * @param {string} newPassword
     * @returns {Promise<Object|null>}
     */
    async updatePassword(userId, newPassword) {
        const hash = await this._hashPassword(newPassword);
        return this.db.update(u => u.id === userId, { password_hash: hash });
    }

    /**
     * Update last login timestamp
     * @param {string} userId
     * @returns {Object|null}
     */
    updateLastLogin(userId) {
        return this.db.update(u => u.id === userId, { last_login: now() });
    }

    /**
     * Update user role
     * @param {string} userId
     * @param {string} role
     * @returns {Object|null}
     */
    updateRole(userId, role) {
        return this.db.update(u => u.id === userId, { role });
    }

    /**
     * Update user active status
     * @param {string} userId
     * @param {boolean} isActive
     * @returns {Object|null}
     */
    updateActive(userId, isActive) {
        return this.db.update(u => u.id === userId, { is_active: isActive ? 1 : 0 });
    }

    /**
     * Set TOTP secret
     * @param {string} userId
     * @param {string} secret
     * @returns {Object|null}
     */
    setTotpSecret(userId, secret) {
        // Always persist as a base32 string. Storing a raw Buffer would
        // JSON-serialize as { type: 'Buffer', data: [...] } and fail to
        // verify after the next process restart.
        let stored = secret;
        if (Buffer.isBuffer(secret)) {
            stored = require('../../utils/totp').encodeBase32(secret);
        } else if (secret && typeof secret === 'object' && Array.isArray(secret.data)) {
            stored = require('../../utils/totp').encodeBase32(Buffer.from(secret.data));
        }
        return this.db.update(u => u.id === userId, { totp_secret: stored });
    }

    /**
     * Enable TOTP with recovery codes
     * @param {string} userId
     * @param {string[]} recoveryCodes
     * @returns {Object|null}
     */
    enableTotp(userId, recoveryCodes) {
        return this.db.update(u => u.id === userId, {
            totp_enabled: 1,
            recovery_codes: JSON.stringify(recoveryCodes)
        });
    }

    /**
     * Disable TOTP
     * @param {string} userId
     * @returns {Object|null}
     */
    disableTotp(userId) {
        return this.db.update(u => u.id === userId, {
            totp_enabled: 0,
            totp_secret: null,
            recovery_codes: null
        });
    }

    /**
     * Set password reset token
     * @param {string} userId
     * @returns {Promise<string>} The reset token
     */
    async setResetToken(userId) {
        const token = generateToken();
        const expires = now() + 3600; // 1 hour
        this.db.update(u => u.id === userId, {
            password_reset_token: token,
            password_reset_expires: expires
        });
        return token;
    }

    /**
     * Clear password reset token
     * @param {string} userId
     * @returns {Object|null}
     */
    clearResetToken(userId) {
        return this.db.update(u => u.id === userId, {
            password_reset_token: null,
            password_reset_expires: null
        });
    }

    /**
     * Find user by valid reset token
     * @param {string} token
     * @returns {Object|undefined}
     */
    findByResetToken(token) {
        return this.db.find(u =>
            u.password_reset_token === token &&
            u.password_reset_expires > now()
        );
    }

    /**
     * Delete user (with super admin protection)
     * @param {string} userId
     * @returns {boolean}
     */
    delete(userId) {
        const superAdminCount = this.db.count(u => u.role === 'super_admin' && u.is_active === 1);
        const user = this.findById(userId);
        if (user && user.role === 'super_admin' && superAdminCount <= 1) {
            throw new Error('Cannot delete the last super admin');
        }
        return this.db.delete(u => u.id === userId);
    }

    /**
     * Get user statistics by role
     * @returns {Array}
     */
    getStats() {
        const stats = {};
        this.db.filter(u => u.is_active === 1).forEach(u => {
            stats[u.role] = (stats[u.role] || 0) + 1;
        });
        return Object.entries(stats).map(([role, count]) => ({ role, count }));
    }

    /**
     * Authenticate user
     * @param {string} username
     * @param {string} password
     * @returns {Promise<Object|null>}
     */
    async authenticate(username, password) {
        const user = this.findByUsername(username);
        if (!user || !user.is_active) {
            return null;
        }
        const valid = await this._verifyPassword(password, user.password_hash);
        return valid ? user : null;
    }

    // Private methods

    async _hashPassword(password) {
        return bcrypt.hash(password, 12);
    }

    async _verifyPassword(password, hash) {
        return bcrypt.compare(password, hash);
    }

    _sanitizeUser(user) {
        return {
            id: user.id,
            username: user.username,
            nickname: user.nickname || user.username,
            email: user.email,
            role: user.role,
            is_active: user.is_active,
            totp_enabled: user.totp_enabled,
            last_login: user.last_login,
            created_at: user.created_at
        };
    }
}

module.exports = { UserRepository };
