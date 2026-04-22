/**
 * Unit tests for src/middleware/errorHandler.js
 *
 * Mounts each helper on a tiny express app and asserts response shape /
 * status code / log behavior. NODE_ENV is forced to 'test' so the
 * suppressed-console branch is exercised; an explicit 'development' test
 * covers the stack-trace branch.
 */

const express = require('express');
const request = require('supertest');

const {
    AppError,
    NotFoundError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    RateLimitError,
    asyncHandler,
    notFoundHandler,
    errorHandler
} = require('../../src/middleware/errorHandler');

function buildApp(handler, { dev = false } = {}) {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = dev ? 'development' : 'test';
    const app = express();
    app.use(express.json());
    app.get('/boom', handler);
    app.use(notFoundHandler);
    app.use(errorHandler);
    app._restoreEnv = () => { process.env.NODE_ENV = prevEnv; };
    return app;
}

describe('Custom error classes', () => {
    test('AppError defaults', () => {
        const e = new AppError('x');
        expect(e.statusCode).toBe(500);
        expect(e.code).toBe('INTERNAL_ERROR');
        expect(e.isOperational).toBe(true);
        expect(e.name).toBe('AppError');
    });

    test('NotFoundError', () => {
        const e = new NotFoundError('Widget');
        expect(e.statusCode).toBe(404);
        expect(e.code).toBe('NOT_FOUND');
        expect(e.message).toBe('Widget not found');
    });

    test('ValidationError carries details', () => {
        const e = new ValidationError('bad', { field: 'x' });
        expect(e.statusCode).toBe(400);
        expect(e.details).toEqual({ field: 'x' });
    });

    test('AuthenticationError default message', () => {
        expect(new AuthenticationError().statusCode).toBe(401);
    });

    test('AuthorizationError default message', () => {
        expect(new AuthorizationError().statusCode).toBe(403);
    });

    test('RateLimitError default message', () => {
        expect(new RateLimitError().statusCode).toBe(429);
    });
});

describe('asyncHandler', () => {
    test('passes resolved value through (no error)', async () => {
        const app = express();
        app.get('/ok', asyncHandler(async (req, res) => res.json({ ok: true })));
        const res = await request(app).get('/ok');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    test('forwards rejected promise to next()', async () => {
        const app = buildApp(asyncHandler(async () => {
            throw new ValidationError('nope', { f: 1 });
        }));
        const res = await request(app).get('/boom');
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('nope');
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details).toEqual({ f: 1 });
        app._restoreEnv();
    });
});

describe('notFoundHandler', () => {
    test('returns 404 with NOT_FOUND code for unknown route', async () => {
        const app = buildApp((req, res) => res.json({}));
        const res = await request(app).get('/does-not-exist');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
        expect(res.body.error).toMatch(/Endpoint not found/);
        app._restoreEnv();
    });
});

describe('errorHandler', () => {
    test('JsonWebTokenError -> 401 INVALID_TOKEN', async () => {
        const app = buildApp((req, res, next) => {
            const err = new Error('jwt malformed');
            err.name = 'JsonWebTokenError';
            next(err);
        });
        const res = await request(app).get('/boom');
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('INVALID_TOKEN');
        expect(res.body.error).toBe('Invalid token');
        app._restoreEnv();
    });

    test('TokenExpiredError -> 401 TOKEN_EXPIRED', async () => {
        const app = buildApp((req, res, next) => {
            const err = new Error('expired');
            err.name = 'TokenExpiredError';
            next(err);
        });
        const res = await request(app).get('/boom');
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('TOKEN_EXPIRED');
        app._restoreEnv();
    });

    test('SyntaxError with body -> 400 INVALID_JSON', async () => {
        const app = buildApp((req, res, next) => {
            const err = new SyntaxError('Unexpected token');
            err.status = 400;
            err.body = '{bad';
            next(err);
        });
        const res = await request(app).get('/boom');
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_JSON');
        app._restoreEnv();
    });

    test('Generic error -> 500 INTERNAL_ERROR', async () => {
        const app = buildApp((req, res, next) => next(new Error('kaboom')));
        const res = await request(app).get('/boom');
        expect(res.status).toBe(500);
        expect(res.body.code).toBe('INTERNAL_ERROR');
        expect(res.body.error).toBe('kaboom');
        app._restoreEnv();
    });

    test('development mode includes stack trace and logs', async () => {
        const consoleErr = jest.spyOn(console, 'error').mockImplementation(() => { });
        const app = buildApp((req, res, next) => next(new Error('dev err')), { dev: true });
        const res = await request(app).get('/boom');
        expect(res.status).toBe(500);
        expect(typeof res.body.stack).toBe('string');
        expect(consoleErr).toHaveBeenCalled();
        consoleErr.mockRestore();
        app._restoreEnv();
    });

    test('production mode hides stack and does not log via dev branch', async () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const consoleErr = jest.spyOn(console, 'error').mockImplementation(() => { });
        const app = express();
        app.get('/boom', (req, res, next) => next(new Error('prod err')));
        app.use(errorHandler);
        const res = await request(app).get('/boom');
        expect(res.status).toBe(500);
        expect(res.body.stack).toBeUndefined();
        expect(consoleErr).not.toHaveBeenCalled();
        consoleErr.mockRestore();
        process.env.NODE_ENV = prev;
    });
});
