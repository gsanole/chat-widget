/**
 * Error Handling Middleware
 * 
 * Single Responsibility: Centralized error handling
 * Liskov Substitution: Custom error types extend AppError
 */

/**
 * Custom application error class
 */
class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Not found error
 */
class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404, 'NOT_FOUND');
        this.name = 'NotFoundError';
    }
}

/**
 * Validation error
 */
class ValidationError extends AppError {
    constructor(message, details = null) {
        super(message, 400, 'VALIDATION_ERROR');
        this.name = 'ValidationError';
        this.details = details;
    }
}

/**
 * Authentication error
 */
class AuthenticationError extends AppError {
    constructor(message = 'Authentication required') {
        super(message, 401, 'AUTHENTICATION_ERROR');
        this.name = 'AuthenticationError';
    }
}

/**
 * Authorization error
 */
class AuthorizationError extends AppError {
    constructor(message = 'Permission denied') {
        super(message, 403, 'AUTHORIZATION_ERROR');
        this.name = 'AuthorizationError';
    }
}

/**
 * Rate limit error
 */
class RateLimitError extends AppError {
    constructor(message = 'Too many requests') {
        super(message, 429, 'RATE_LIMIT_ERROR');
        this.name = 'RateLimitError';
    }
}

/**
 * Async handler wrapper to catch errors in async route handlers
 * @param {Function} fn - Async route handler
 * @returns {Function} Wrapped handler
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * 404 Not Found middleware
 * @param {Object} req - Request
 * @param {Object} res - Response
 * @param {Function} next - Next middleware
 */
function notFoundHandler(req, res, next) {
    next(new NotFoundError('Endpoint'));
}

/**
 * Global error handler middleware
 * @param {Error} err - Error object
 * @param {Object} req - Request
 * @param {Object} res - Response
 * @param {Function} next - Next middleware
 */
function errorHandler(err, req, res, next) {
    // Default error properties
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal server error';
    let code = err.code || 'INTERNAL_ERROR';

    // Handle specific error types
    if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Invalid token';
        code = 'INVALID_TOKEN';
    } else if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Token expired';
        code = 'TOKEN_EXPIRED';
    } else if (err.name === 'SyntaxError' && err.status === 400 && 'body' in err) {
        statusCode = 400;
        message = 'Invalid JSON';
        code = 'INVALID_JSON';
    }

    // Log error in development (suppressed in test mode to keep output readable;
    // tests assert on response bodies, not on console output).
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
        console.error(`[Error] ${statusCode} - ${message}`, err.stack);
    }

    // Send error response
    const response = {
        error: message,
        code
    };

    // Include validation details if present
    if (err.details) {
        response.details = err.details;
    }

    // Include stack trace in development
    if (process.env.NODE_ENV !== 'production' && err.stack) {
        response.stack = err.stack;
    }

    res.status(statusCode).json(response);
}

module.exports = {
    AppError,
    NotFoundError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    RateLimitError,
    asyncHandler,
    notFoundHandler,
    errorHandler
};
