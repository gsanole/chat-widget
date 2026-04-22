/**
 * Tiny test helper for unit-testing Express routers in isolation.
 *
 * - Builds a real Express app
 * - Mounts the router under a base path
 * - Provides pass-through `requireAuth` / `requirePermission` middleware
 *   that injects a fake authenticated user
 */

const express = require('express');

function buildRouterApp({ basePath, factory, deps = {}, user }) {
    const fakeUser = user || {
        userId: 'u-test',
        username: 'tester',
        role: 'super_admin'
    };

    const authMiddleware = {
        requireAuth: (req, _res, next) => {
            req.user = fakeUser;
            next();
        },
        requirePermission: () => (req, _res, next) => {
            req.user = req.user || fakeUser;
            next();
        }
    };

    // authLimiter is required by some routers; supply a no-op
    const authLimiter = (_req, _res, next) => next();

    const router = factory({ ...deps, authMiddleware, authLimiter });

    const app = express();
    app.use(express.json());
    app.use(basePath, router);
    return app;
}

module.exports = { buildRouterApp };
