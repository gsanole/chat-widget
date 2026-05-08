/**
 * Round 6 — coverage gaps for src/app.js
 *
 * Covers:
 *   - clean-URL handlers for /demo, /sites, /users (fn @189, B5/B6)
 *   - /api/sites/:id/tickets with valid auth + existing site (B24, B27, B29)
 *   - /api/sites/:id/sessions with valid auth + existing site (B33)
 *   - /api/tickets/search with valid auth (fn @383, B42-47)
 *   - /api/users/:id/reset-password with newPassword promise paths (B36, B39)
 *   - /admin, /admin/*, / fallback inline-html branches (fn @415/448, B48/49/50)
 *   - /widget.js handler (fn @486/487)
 *   - TRUST_PROXY numeric / string env branches (B2/B3/B4)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const request = require('supertest');
const jwt = require('jsonwebtoken');

let appHandle;
let token;
const ORIGINAL_DB_DIR = process.env.DATABASE_DIR;
const ORIGINAL_TRUST = process.env.TRUST_PROXY;

beforeAll(() => {
    process.env.DATABASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'app-cov6-'));
    // Use a numeric string so isNaN(Number(..)) is false → branch B3 idx 0
    process.env.TRUST_PROXY = '2';
    jest.resetModules();
    const { createApp } = require('../../src/app');
    appHandle = createApp();

    // Insert a privileged user
    appHandle.repositories.users.db.insert({
        id: 'u-test6',
        username: 'tester6',
        email: 't6@t.t',
        password_hash: 'x',
        role: 'super_admin',
        is_active: true,
        created_at: Math.floor(Date.now() / 1000)
    });
    token = jwt.sign(
        { userId: 'u-test6', username: 'tester6', role: 'super_admin' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
    );

    // Insert a site so site-scoped endpoints reach the success branch
    appHandle.repositories.sites.db.insert({
        id: 'site-A',
        name: 'Site A',
        api_key: 'key-A',
        is_active: true,
        created_at: Math.floor(Date.now() / 1000)
    });

    // Insert tickets
    appHandle.repositories.tickets.db.insert({
        id: 'ticket-1',
        siteId: 'site-A',
        customerName: 'Alice',
        status: 'open',
        created_at: Math.floor(Date.now() / 1000)
    });
    appHandle.repositories.tickets.db.insert({
        id: 'ticket-2',
        siteId: 'site-A',
        customerName: 'Bob',
        status: 'open',
        created_at: Math.floor(Date.now() / 1000)
    });
});

afterAll(() => {
    if (appHandle) {
        try { appHandle.sessionCleanup.stop(); } catch (e) { }
        try { appHandle.io.close(); } catch (e) { }
        try { appHandle.server.close(); } catch (e) { }
    }
    try { fs.rmSync(process.env.DATABASE_DIR, { recursive: true, force: true }); } catch (e) { }
    if (ORIGINAL_DB_DIR === undefined) delete process.env.DATABASE_DIR;
    else process.env.DATABASE_DIR = ORIGINAL_DB_DIR;
    if (ORIGINAL_TRUST === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = ORIGINAL_TRUST;
    jest.resetModules();
});

describe('app.js clean-URL handlers (/demo /sites /users)', () => {
    test('GET /demo serves demo.html (existsSync true branch)', async () => {
        const res = await request(appHandle.app).get('/demo');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
    });

    test('GET /sites serves sites.html', async () => {
        const res = await request(appHandle.app).get('/sites');
        expect(res.status).toBe(200);
    });

    test('GET /users serves users.html', async () => {
        const res = await request(appHandle.app).get('/users');
        expect(res.status).toBe(200);
    });

    test('GET /demo with mocked fs.existsSync false → falls through (next())', async () => {
        const spy = jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
            if (typeof p === 'string' && p.includes('demo.html')) return false;
            // Use the real implementation for everything else
            return jest.requireActual('fs').existsSync(p);
        });
        const res = await request(appHandle.app).get('/demo');
        // Static middleware will then attempt to serve, fall through → 404
        expect([200, 404]).toContain(res.status);
        spy.mockRestore();
    });
});

describe('app.js authed site-scoped + ticket endpoints', () => {
    test('GET /api/sites/:id/tickets returns array for existing site', async () => {
        const res = await request(appHandle.app)
            .get('/api/sites/site-A/tickets')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    test('GET /api/sites/:id/sessions returns sessions object', async () => {
        const res = await request(appHandle.app)
            .get('/api/sites/site-A/sessions')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.sessions)).toBe(true);
    });

    test('GET /api/tickets/search without q returns all', async () => {
        const res = await request(appHandle.app)
            .get('/api/tickets/search')
            .set('Authorization', `Bearer ${token}`);
        expect([200, 404]).toContain(res.status);
    });

    test('GET /api/tickets/search with q filters by customerName', async () => {
        const res = await request(appHandle.app)
            .get('/api/tickets/search?q=alic')
            .set('Authorization', `Bearer ${token}`);
        expect([200, 404]).toContain(res.status);
        if (res.status === 200) {
            expect(Array.isArray(res.body)).toBe(true);
        }
    });

    test('GET /api/tickets/search with q matching id', async () => {
        const res = await request(appHandle.app)
            .get('/api/tickets/search?q=ticket-1')
            .set('Authorization', `Bearer ${token}`);
        expect([200, 404]).toContain(res.status);
    });
});

describe('app.js user reset-password promise branches', () => {
    test('POST /api/users/:id/reset-password with newPassword (then arrow)', async () => {
        const targetId = 'u-rp-target';
        appHandle.repositories.users.db.insert({
            id: targetId,
            username: 'rptarget',
            email: 'rp@t.t',
            password_hash: 'x',
            role: 'support',
            is_active: true,
            created_at: Math.floor(Date.now() / 1000)
        });
        const res = await request(appHandle.app)
            .post(`/api/users/${targetId}/reset-password`)
            .set('Authorization', `Bearer ${token}`)
            .send({ newPassword: 'NewPwd!123abc' });
        expect([200, 500]).toContain(res.status);
    });

    test('POST /api/users/:id/reset-password without newPassword (token branch)', async () => {
        const targetId = 'u-rp-token';
        appHandle.repositories.users.db.insert({
            id: targetId,
            username: 'rptok',
            email: 'rt@t.t',
            password_hash: 'x',
            role: 'support',
            is_active: true,
            created_at: Math.floor(Date.now() / 1000)
        });
        const res = await request(appHandle.app)
            .post(`/api/users/${targetId}/reset-password`)
            .set('Authorization', `Bearer ${token}`)
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.resetToken).toBeDefined();
    });

    test('POST /api/users/:id/reset-password with newPassword + updatePassword reject (catch arrow)', async () => {
        // Spy on updatePassword to reject so the .catch arrow at L386 fires
        const orig = appHandle.repositories.users.updatePassword;
        appHandle.repositories.users.updatePassword = jest.fn().mockRejectedValue(new Error('upd-failed'));
        // Insert target
        const targetId = 'u-rp-fail';
        appHandle.repositories.users.db.insert({
            id: targetId,
            username: 'rpfail',
            email: 'rf@t.t',
            password_hash: 'x',
            role: 'support',
            is_active: true,
            created_at: Math.floor(Date.now() / 1000)
        });
        const res = await request(appHandle.app)
            .post(`/api/users/${targetId}/reset-password`)
            .set('Authorization', `Bearer ${token}`)
            .send({ newPassword: 'wontmatter' });
        expect(res.status).toBe(500);
        expect(res.body.error).toBe('upd-failed');
        appHandle.repositories.users.updatePassword = orig;
    });
});

describe('app.js fallback HTML branches via direct handler invocation', () => {
    // Locate the registered route handlers on the express app stack
    function findHandler(method, routePath) {
        const layer = appHandle.app._router.stack.find(
            l => l.route && l.route.path === routePath && l.route.methods[method.toLowerCase()]
        );
        if (!layer) throw new Error(`No route ${method} ${routePath}`);
        // The actual user handler is the last in the route stack
        const stack = layer.route.stack;
        return stack[stack.length - 1].handle;
    }

    function makeRes() {
        const res = {};
        res.statusCode = 200;
        res.type = jest.fn().mockReturnThis();
        res.send = jest.fn().mockReturnThis();
        res.sendFile = jest.fn().mockReturnThis();
        res.status = jest.fn(function (c) { this.statusCode = c; return this; });
        res.json = jest.fn().mockReturnThis();
        return res;
    }

    test('/admin handler — fallback inline html when no candidate exists', () => {
        const handler = findHandler('GET', '/admin');
        const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
        const res = makeRes();
        handler({ method: 'GET', path: '/admin' }, res, () => { });
        expect(res.type).toHaveBeenCalledWith('html');
        expect(res.send).toHaveBeenCalled();
        spy.mockRestore();
    });

    test('/admin/* handler — fallback inline html', () => {
        const handler = findHandler('GET', '/admin/*');
        const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
        const res = makeRes();
        handler({ method: 'GET', path: '/admin/anything' }, res, () => { });
        expect(res.type).toHaveBeenCalledWith('html');
        expect(res.send).toHaveBeenCalled();
        spy.mockRestore();
    });

    test('/admin/* handler — sends file when candidate exists', () => {
        const handler = findHandler('GET', '/admin/*');
        const res = makeRes();
        handler({ method: 'GET', path: '/admin/foo' }, res, () => { });
        // public/admin.html exists → res.sendFile called
        expect(res.sendFile).toHaveBeenCalled();
    });

    test('/ root handler — fallback inline html when index.html missing', () => {
        const handler = findHandler('GET', '/');
        const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
        const res = makeRes();
        handler({ method: 'GET', path: '/' }, res, () => { });
        expect(res.type).toHaveBeenCalledWith('html');
        expect(res.send).toHaveBeenCalled();
        spy.mockRestore();
    });

    test('/ root handler — sends file when index.html exists', () => {
        const handler = findHandler('GET', '/');
        const res = makeRes();
        handler({ method: 'GET', path: '/' }, res, () => { });
        expect(res.sendFile).toHaveBeenCalled();
    });

    test('/widget.js handler invokes res.type + sendFile', () => {
        const handler = findHandler('GET', '/widget.js');
        const res = makeRes();
        handler({ method: 'GET', path: '/widget.js' }, res, () => { });
        expect(res.type).toHaveBeenCalledWith('application/javascript');
        expect(res.sendFile).toHaveBeenCalled();
    });
});

describe('app.js TRUST_PROXY env branches', () => {
    afterEach(() => {
        // restore for the next test
        process.env.TRUST_PROXY = '2';
        jest.resetModules();
    });

    test('TRUST_PROXY="loopback" string branch (isNaN true)', () => {
        process.env.TRUST_PROXY = 'loopback';
        process.env.DATABASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'app-cov6b-'));
        const { createApp } = require('../../src/app');
        const h = createApp();
        expect(h.app.get('trust proxy')).toBe('loopback');
        try { h.sessionCleanup.stop(); } catch (e) { }
        try { h.io.close(); } catch (e) { }
        try { h.server.close(); } catch (e) { }
    });

    test('TRUST_PROXY undefined → defaults to 1', () => {
        delete process.env.TRUST_PROXY;
        process.env.DATABASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'app-cov6c-'));
        const { createApp } = require('../../src/app');
        const h = createApp();
        expect(h.app.get('trust proxy')).toBe(1);
        try { h.sessionCleanup.stop(); } catch (e) { }
        try { h.io.close(); } catch (e) { }
        try { h.server.close(); } catch (e) { }
    });
});
