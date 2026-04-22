/**
 * Network-dependent unit tests for ipUtils.
 *
 * Stubs http/https `.get` so no real outbound requests are made.
 */

const { EventEmitter } = require('events');
const http = require('http');
const https = require('https');

// Build a fake response stream and a fake request that supports .on('error')
function makeFakeRequest(body, { fail = false, errorAfter = false } = {}) {
    const req = new EventEmitter();
    req.on = req.on.bind(req); // ensure `.on('error', cb)` is wired
    setImmediate(() => {
        if (fail) {
            req.emit('error', new Error('boom'));
            return;
        }
        const res = new EventEmitter();
        // Listener executes synchronously when callback is invoked
        if (typeof req._cb === 'function') req._cb(res);
        setImmediate(() => {
            if (body !== null) res.emit('data', body);
            if (errorAfter) {
                res.emit('data', 'not-json{');
            }
            res.emit('end');
        });
    });
    return req;
}

function spyHttp(module, body, opts = {}) {
    return jest.spyOn(module, 'get').mockImplementation((_url, cb) => {
        const req = makeFakeRequest(body, opts);
        req._cb = cb;
        return req;
    });
}

describe('ipUtils - network functions', () => {
    let ipUtils;

    beforeEach(() => {
        jest.resetModules();
        ipUtils = require('../../src/utils/ipUtils');
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // -----------------------------------------------------------------------
    // getPublicIP
    // -----------------------------------------------------------------------
    describe('getPublicIP', () => {
        test('returns the parsed ip on a successful response', async () => {
            spyHttp(https, JSON.stringify({ ip: '203.0.113.10' }));
            const ip = await ipUtils.getPublicIP();
            expect(ip).toBe('203.0.113.10');
        });

        test('returns the cached value on subsequent calls', async () => {
            const spy = spyHttp(https, JSON.stringify({ ip: '203.0.113.20' }));
            await ipUtils.getPublicIP();
            spy.mockClear();
            const second = await ipUtils.getPublicIP();
            expect(second).toBe('203.0.113.20');
            expect(spy).not.toHaveBeenCalled();
        });

        test('returns null on network error', async () => {
            spyHttp(https, null, { fail: true });
            const ip = await ipUtils.getPublicIP();
            expect(ip).toBeNull();
        });

        test('returns null on malformed JSON', async () => {
            spyHttp(https, 'not-json');
            const ip = await ipUtils.getPublicIP();
            expect(ip).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // fetchIPGeo
    // -----------------------------------------------------------------------
    describe('fetchIPGeo', () => {
        test('parses a successful ip-api response', async () => {
            spyHttp(http, JSON.stringify({
                status: 'success',
                country: 'United States', regionName: 'CA', city: 'LA',
                lat: 34.05, lon: -118.24, timezone: 'America/Los_Angeles',
                isp: 'Acme', org: 'Acme', as: 'AS1234',
                proxy: false, hosting: false
            }));
            const geo = await ipUtils.fetchIPGeo('203.0.113.5');
            expect(geo).toMatchObject({
                country: 'United States', city: 'LA',
                ll: [34.05, -118.24], isProxy: false, isHosting: false
            });
        });

        test('returns null when API status is not success', async () => {
            spyHttp(http, JSON.stringify({ status: 'fail' }));
            const geo = await ipUtils.fetchIPGeo('0.0.0.0');
            expect(geo).toBeNull();
        });

        test('returns null on network error', async () => {
            spyHttp(http, null, { fail: true });
            const geo = await ipUtils.fetchIPGeo('1.1.1.1');
            expect(geo).toBeNull();
        });

        test('returns null on malformed JSON', async () => {
            spyHttp(http, 'garbage');
            const geo = await ipUtils.fetchIPGeo('1.1.1.1');
            expect(geo).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // analyzeIP
    // -----------------------------------------------------------------------
    describe('analyzeIP', () => {
        test('flags localhost without making network calls', async () => {
            const spy = spyHttp(http, '{}');
            // Pre-warm cachedPublicIP so analyzeIP skips getPublicIP for localhost
            spyHttp(https, JSON.stringify({ ip: '203.0.113.50' }));
            await ipUtils.getPublicIP();
            spy.mockClear();

            // For localhost, after rewriting effectiveIP to public, it WILL try to fetch geo.
            // Stub http.get to return a "success" geo:
            spyHttp(http, JSON.stringify({
                status: 'success', country: 'X', regionName: 'Y', city: 'Z',
                lat: 0, lon: 0, timezone: 'UTC',
                isp: 'I', org: 'O', as: 'A',
                proxy: false, hosting: false
            }));
            const r = await ipUtils.analyzeIP('127.0.0.1');
            expect(r.isLocalTest).toBe(true);
            expect(r.geo).toBeDefined();
        });

        test('returns localhost-only result when no public IP and IP is localhost', async () => {
            // Force getPublicIP to fail so effectiveIP stays as localhost
            spyHttp(https, null, { fail: true });
            const r = await ipUtils.analyzeIP('127.0.0.1');
            expect(r.isLocalTest).toBe(true);
            expect(r.warnings).toContain('Localhost connection');
            expect(r.displayIP).toBe('127.0.0.1');
        });

        test('marks proxy/hosting from geo data', async () => {
            spyHttp(http, JSON.stringify({
                status: 'success',
                country: 'XX', regionName: 'X', city: 'X',
                lat: 0, lon: 0, timezone: 'UTC',
                isp: 'I', org: 'O', as: 'A',
                proxy: true, hosting: true
            }));
            const r = await ipUtils.analyzeIP('203.0.113.99');
            expect(r.isProxy).toBe(true);
            expect(r.isDatacenter).toBe(true);
            expect(r.vpnConfidence).toBeGreaterThanOrEqual(60);
            expect(r.warnings).toContain('Proxy detected');
            expect(r.warnings).toContain('Datacenter IP');
        });

        test('returns the base result when geo lookup fails entirely', async () => {
            spyHttp(http, JSON.stringify({ status: 'fail' }));
            const r = await ipUtils.analyzeIP('203.0.113.99');
            expect(r.isProxy).toBe(false);
            expect(r.isDatacenter).toBe(false);
            // geo may be null or filled by geoip-lite fallback if installed
        });
    });

    // -----------------------------------------------------------------------
    // initPublicIP
    // -----------------------------------------------------------------------
    describe('initPublicIP', () => {
        test('logs the detected public IP', async () => {
            spyHttp(https, JSON.stringify({ ip: '203.0.113.77' }));
            const log = jest.spyOn(console, 'log').mockImplementation(() => { });
            ipUtils.initPublicIP();
            // Wait microtasks to drain
            await new Promise(r => setImmediate(r));
            await new Promise(r => setImmediate(r));
            await new Promise(r => setImmediate(r));
            expect(log).toHaveBeenCalledWith(expect.stringMatching(/Public IP detected/));
            log.mockRestore();
        });
    });
});
