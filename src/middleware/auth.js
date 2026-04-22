/**
 * Authentication Middleware
 * 
 * Single Responsibility: Handles JWT authentication and authorization
 * Dependency Inversion: Receives authService as dependency
 */

/**
 * Create authentication middleware factory
 * @param {Object} deps - Dependencies
 * @param {Object} deps.authService - Authentication service
 * @param {Function} deps.hasPermission - Permission checker function
 * @returns {Object} Middleware functions
 */
function createAuthMiddleware({ authService, hasPermission }) {
    /**
     * Require authenticated user
     */
    function requireAuth(req, res, next) {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const token = authHeader.substring(7);
        const decoded = authService.verifyToken(token);

        if (!decoded) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        req.user = decoded;
        next();
    }

    /**
     * Require specific permission
     * @param {string} permission - Required permission
     * @returns {Function} Middleware function
     */
    function requirePermission(permission) {
        return (req, res, next) => {
            if (!hasPermission(req.user.role, permission)) {
                return res.status(403).json({ error: 'Permission denied' });
            }
            next();
        };
    }

    /**
     * Optional authentication - sets req.user if token is valid, continues otherwise
     */
    function optionalAuth(req, res, next) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const decoded = authService.verifyToken(token);
            if (decoded) {
                req.user = decoded;
            }
        }
        next();
    }

    return {
        requireAuth,
        requirePermission,
        optionalAuth
    };
}

module.exports = { createAuthMiddleware };
