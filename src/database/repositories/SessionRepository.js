/**
 * Session Repository
 * 
 * Single Responsibility: Session data access
 */

const { BaseRepository, generateId, now } = require('./BaseRepository');

class SessionRepository extends BaseRepository {
    /**
     * @param {JsonDB} db - Sessions database
     * @param {JsonDB} usersDb - Users database (for joining user data)
     */
    constructor(db, usersDb = null) {
        super(db);
        this.usersDb = usersDb;
    }

    /**
     * Create a new session
     * @param {Object} sessionData
     * @returns {Object}
     */
    create({ userId, token, ipAddress, userAgent, expiresIn = 8 * 60 * 60 }) {
        const session = {
            id: generateId(),
            user_id: userId,
            token,
            ip_address: ipAddress,
            user_agent: userAgent,
            created_at: now(),
            expires_at: now() + expiresIn,
            last_activity: now()
        };

        this.db.insert(session);
        return session;
    }

    /**
     * Find valid session by token
     * @param {string} token
     * @returns {Object|null}
     */
    findByToken(token) {
        const session = this.db.find(s => s.token === token && s.expires_at > now());
        if (session && this.usersDb) {
            const user = this.usersDb.find(u => u.id === session.user_id);
            if (user) {
                return { ...session, username: user.username, role: user.role };
            }
        }
        return session || null;
    }

    /**
     * Find sessions by user
     * @param {string} userId
     * @returns {Array}
     */
    findByUser(userId) {
        return this.db.filter(s => s.user_id === userId)
            .sort((a, b) => b.created_at - a.created_at);
    }

    /**
     * Update session activity timestamp
     * @param {string} token
     * @returns {Object|null}
     */
    updateActivity(token) {
        return this.db.update(s => s.token === token, { last_activity: now() });
    }

    /**
     * Delete session by ID
     * @param {string} sessionId
     * @returns {boolean}
     */
    delete(sessionId) {
        return this.db.delete(s => s.id === sessionId);
    }

    /**
     * Delete session by token
     * @param {string} token
     * @returns {boolean}
     */
    deleteByToken(token) {
        return this.db.delete(s => s.token === token);
    }

    /**
     * Delete all sessions for a user
     * @param {string} userId
     * @returns {boolean}
     */
    deleteByUser(userId) {
        return this.db.delete(s => s.user_id === userId);
    }

    /**
     * Clean up expired sessions
     * @returns {number} Number deleted
     */
    cleanup() {
        const initialCount = this.db.data.length;
        this.db.data = this.db.filter(s => s.expires_at > now());
        this.db.save();
        return initialCount - this.db.data.length;
    }
}

module.exports = { SessionRepository };
