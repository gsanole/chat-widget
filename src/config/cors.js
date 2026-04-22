/**
 * CORS Configuration
 * 
 * Single Responsibility: Manages Cross-Origin Resource Sharing settings
 */

// Allowed origins (set ALLOWED_ORIGINS env var in production)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

/**
 * CORS options factory
 * @param {Object} options - Override options
 * @returns {Object} CORS configuration object
 */
function createCorsOptions(options = {}) {
    const isProduction = process.env.NODE_ENV === 'production';
    return {
        origin: function (origin, callback) {
            // Same-origin / non-browser request (no Origin header):
            // - dev: allow (curl, native apps, Postman)
            // - prod: allow (server-to-server, health checks)
            if (!origin) {
                return callback(null, true);
            }
            if (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) {
                return callback(null, true);
            }
            if (isProduction) {
                return callback(new Error(`Origin not allowed by CORS: ${origin}`));
            }
            // In development, log and allow so local testing isn't blocked.
            console.warn(`[CORS] Allowing unlisted origin in dev: ${origin}`);
            return callback(null, true);
        },
        credentials: true,
        ...options
    };
}

module.exports = {
    ALLOWED_ORIGINS,
    createCorsOptions
};
