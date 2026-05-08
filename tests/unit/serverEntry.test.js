/**
 * Tests for server.js entry point
 *
 * Server.js is normally not exercised because tests import src/app.js
 * directly. This file imports server.js and invokes startServer() and
 * gracefulShutdown() to cover those code paths (currently 0% functions).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

let serverModule;
let tmpDir;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-cov-'));
    process.env.DATABASE_DIR = tmpDir;
    process.env.PORT = '0'; // Let OS pick a free port
    delete process.env.HTTPS;
    jest.resetModules();
    serverModule = require('../../server');
});

afterAll((done) => {
    try { serverModule.io.close(); } catch (e) { }
    serverModule.server.close(() => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { }
        done();
    });
});

describe('server.js exports', () => {
    test('exports the legacy shape { app, server, io, db, startServer }', () => {
        expect(serverModule).toHaveProperty('app');
        expect(serverModule).toHaveProperty('server');
        expect(serverModule).toHaveProperty('io');
        expect(serverModule).toHaveProperty('db');
        expect(typeof serverModule.startServer).toBe('function');
    });
});

describe('startServer()', () => {
    test('starts listening and creates super admin on first run', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
        await serverModule.startServer();
        // Wait for the server.listen callback to fire (banner is logged in the callback)
        await new Promise((resolve) => {
            if (serverModule.server.listening) {
                // Give the listen callback a tick to fire
                setTimeout(resolve, 50);
            } else {
                serverModule.server.once('listening', () => setTimeout(resolve, 50));
            }
        });
        expect(serverModule.server.listening).toBe(true);
        const calls = logSpy.mock.calls.flat().join('\n');
        expect(calls).toMatch(/Chat Support Server Running/);
        logSpy.mockRestore();
    });

    test('startServer is idempotent and resolves on already-listening server', async () => {
        // Second invocation must not throw and must leave the server listening.
        await expect(serverModule.startServer()).resolves.toBeUndefined();
        expect(serverModule.server.listening).toBe(true);
    });
});

describe('SIGTERM/SIGINT graceful shutdown handlers are registered', () => {
    test('process has SIGTERM listener', () => {
        const listeners = process.listeners('SIGTERM');
        expect(listeners.length).toBeGreaterThan(0);
    });

    test('process has SIGINT listener', () => {
        const listeners = process.listeners('SIGINT');
        expect(listeners.length).toBeGreaterThan(0);
    });

    test('SIGTERM listener invokes gracefulShutdown which closes server and exits', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
        const origExit = process.exit;
        const exitMock = jest.fn();
        process.exit = exitMock;

        // Stub server.close to call its callback synchronously, and io.disconnectSockets
        const origClose = serverModule.server.close.bind(serverModule.server);
        serverModule.server.close = (cb) => { if (cb) cb(); return serverModule.server; };
        const origDisconnect = serverModule.io.disconnectSockets;
        serverModule.io.disconnectSockets = jest.fn();

        // Grab and invoke the SIGTERM listener directly
        const listeners = process.listeners('SIGTERM');
        const handler = listeners[listeners.length - 1];

        jest.useFakeTimers();
        try {
            handler('SIGTERM');
            // Allow any microtasks to flush
            await Promise.resolve();
            const out = logSpy.mock.calls.flat().join('\n');
            expect(out).toMatch(/SIGTERM received/);
            expect(out).toMatch(/Shutdown complete/);
            expect(exitMock).toHaveBeenCalledWith(0);
            // Clear the 10s forced-exit timer
            jest.clearAllTimers();
        } finally {
            jest.useRealTimers();
            process.exit = origExit;
            serverModule.server.close = origClose;
            serverModule.io.disconnectSockets = origDisconnect;
            logSpy.mockRestore();
        }
    });
});

describe('SIGINT gracefulShutdown - missing sessionCleanup.stop and db.close branches', () => {
    test('SIGINT handler runs through with sessionCleanup.stop missing AND db.close missing', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
        const origExit = process.exit;
        const exitMock = jest.fn();
        process.exit = exitMock;

        // Stub server.close to call its callback synchronously
        const origClose = serverModule.server.close.bind(serverModule.server);
        serverModule.server.close = (cb) => { if (cb) cb(); return serverModule.server; };
        const origDisconnect = serverModule.io.disconnectSockets;
        serverModule.io.disconnectSockets = jest.fn();

        // Mutate the live references the gracefulShutdown closure holds
        const origStop = serverModule.sessionCleanup ? serverModule.sessionCleanup.stop : undefined;
        if (serverModule.sessionCleanup) {
            serverModule.sessionCleanup.stop = undefined; // hits the typeof !== 'function' branch
        }
        const origDbClose = serverModule.db.close;
        serverModule.db.close = undefined; // hits the typeof !== 'function' branch

        const listeners = process.listeners('SIGINT');
        const handler = listeners[listeners.length - 1];

        jest.useFakeTimers();
        try {
            handler('SIGINT');
            await Promise.resolve();
            const out = logSpy.mock.calls.flat().join('\n');
            expect(out).toMatch(/SIGINT received/);
            expect(out).toMatch(/Shutdown complete/);
            expect(exitMock).toHaveBeenCalledWith(0);
            jest.clearAllTimers();
        } finally {
            jest.useRealTimers();
            process.exit = origExit;
            serverModule.server.close = origClose;
            serverModule.io.disconnectSockets = origDisconnect;
            if (serverModule.sessionCleanup && origStop !== undefined) {
                serverModule.sessionCleanup.stop = origStop;
            }
            serverModule.db.close = origDbClose;
            logSpy.mockRestore();
        }
    });

    test('SIGINT handler covers forced-shutdown setTimeout branch when server.close never calls back', () => {
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
        const origExit = process.exit;
        const exitMock = jest.fn();
        process.exit = exitMock;

        // server.close that NEVER invokes callback - this lets the 10s setTimeout fire
        const origClose = serverModule.server.close.bind(serverModule.server);
        serverModule.server.close = jest.fn(() => serverModule.server);

        const listeners = process.listeners('SIGINT');
        const handler = listeners[listeners.length - 1];

        jest.useFakeTimers();
        try {
            handler('SIGINT');
            // Trigger only the forced-shutdown timer
            jest.advanceTimersByTime(10001);
            expect(errSpy).toHaveBeenCalledWith('Forced shutdown after timeout');
            expect(exitMock).toHaveBeenCalledWith(1);
            jest.clearAllTimers();
        } finally {
            jest.useRealTimers();
            process.exit = origExit;
            serverModule.server.close = origClose;
            errSpy.mockRestore();
            logSpy.mockRestore();
        }
    });
});

describe('HTTPS configuration error path', () => {
    test('logs error and falls back to HTTP when SSL files are missing', () => {
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'server-https-'));
        let mod;
        jest.isolateModules(() => {
            const prevHttps = process.env.HTTPS;
            const prevKey = process.env.SSL_KEY_PATH;
            const prevCert = process.env.SSL_CERT_PATH;
            const prevDir = process.env.DATABASE_DIR;
            process.env.HTTPS = 'true';
            process.env.SSL_KEY_PATH = path.join(tmp, 'no-key.pem');
            process.env.SSL_CERT_PATH = path.join(tmp, 'no-cert.pem');
            process.env.DATABASE_DIR = tmp;
            try {
                mod = require('../../server');
            } finally {
                process.env.HTTPS = prevHttps;
                if (prevKey) process.env.SSL_KEY_PATH = prevKey; else delete process.env.SSL_KEY_PATH;
                if (prevCert) process.env.SSL_CERT_PATH = prevCert; else delete process.env.SSL_CERT_PATH;
                if (prevDir) process.env.DATABASE_DIR = prevDir;
            }
        });

        expect(errSpy).toHaveBeenCalledWith('Failed to load SSL certificates:', expect.any(String));
        const out = logSpy.mock.calls.flat().join('\n');
        expect(out).toMatch(/Falling back to HTTP/);

        // Cleanup the spawned io/server from the isolated module
        try { mod.io.close(); } catch (e) { }
        try { mod.server.close(); } catch (e) { }
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }

        errSpy.mockRestore();
        logSpy.mockRestore();
    });
});
