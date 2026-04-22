/**
 * Unit tests for src/utils/ipUtils.js
 * Focus on pure synchronous helpers; network calls are not exercised.
 */

const ipUtils = require('../../src/utils/ipUtils');

describe('ipUtils - getRealIP', () => {
    test('prefers cf-connecting-ip header', () => {
        const socket = {
            handshake: { headers: { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' } }
        };
        expect(ipUtils.getRealIP(socket)).toBe('1.2.3.4');
    });

    test('falls back to x-real-ip', () => {
        const socket = {
            handshake: { headers: { 'x-real-ip': '5.6.7.8' } }
        };
        expect(ipUtils.getRealIP(socket)).toBe('5.6.7.8');
    });

    test('parses first entry from x-forwarded-for', () => {
        const socket = {
            handshake: { headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' } }
        };
        expect(ipUtils.getRealIP(socket)).toBe('10.0.0.1');
    });

    test('normalizes IPv6 loopback to 127.0.0.1', () => {
        const socket = { handshake: { headers: {}, address: '::1' } };
        expect(ipUtils.getRealIP(socket)).toBe('127.0.0.1');
    });

    test('strips ::ffff: prefix from IPv4-mapped addresses', () => {
        const socket = { handshake: { headers: {}, address: '::ffff:192.168.1.1' } };
        expect(ipUtils.getRealIP(socket)).toBe('192.168.1.1');
    });

    test('returns "unknown" when no IP can be determined', () => {
        expect(ipUtils.getRealIP({ handshake: { headers: {} } })).toBe('unknown');
    });

    test('uses req headers when provided', () => {
        const req = { headers: { 'x-real-ip': '8.8.8.8' }, socket: { remoteAddress: '1.1.1.1' } };
        expect(ipUtils.getRealIP(null, req)).toBe('8.8.8.8');
    });
});

describe('ipUtils - calculateDistance', () => {
    test('returns ~0 for identical points', () => {
        expect(ipUtils.calculateDistance(40.7, -74.0, 40.7, -74.0)).toBeCloseTo(0, 3);
    });

    test('computes reasonable NYC -> LA distance (~3940 km)', () => {
        const d = ipUtils.calculateDistance(40.7128, -74.0060, 34.0522, -118.2437);
        expect(d).toBeGreaterThan(3800);
        expect(d).toBeLessThan(4100);
    });
});

describe('ipUtils - validateLocationMatch', () => {
    test('returns invalid when data is missing', () => {
        expect(ipUtils.validateLocationMatch(null, { ll: [0, 0] }).valid).toBe(false);
        expect(ipUtils.validateLocationMatch({ latitude: 0, longitude: 0 }, null).valid).toBe(false);
        expect(ipUtils.validateLocationMatch({ latitude: 0, longitude: 0 }, {}).valid).toBe(false);
    });

    test('valid when distance within tolerance', () => {
        const r = ipUtils.validateLocationMatch(
            { latitude: 40.71, longitude: -74.00 },
            { ll: [40.72, -74.01] },
            50
        );
        expect(r.valid).toBe(true);
        expect(r.reason).toBe('Location verified');
    });

    test('invalid when distance exceeds tolerance', () => {
        const r = ipUtils.validateLocationMatch(
            { latitude: 40.71, longitude: -74.00 },
            { ll: [34.05, -118.24] },
            100
        );
        expect(r.valid).toBe(false);
        expect(r.reason).toMatch(/Location mismatch/);
        expect(r.distance).toBeGreaterThan(100);
    });
});

describe('ipUtils - module exports', () => {
    test('exposes the expected API', () => {
        expect(typeof ipUtils.getPublicIP).toBe('function');
        expect(typeof ipUtils.initPublicIP).toBe('function');
        expect(typeof ipUtils.getRealIP).toBe('function');
        expect(typeof ipUtils.fetchIPGeo).toBe('function');
        expect(typeof ipUtils.analyzeIP).toBe('function');
        expect(typeof ipUtils.validateLocationMatch).toBe('function');
        expect(typeof ipUtils.calculateDistance).toBe('function');
    });
});

// Note: analyzeIP() always performs outbound network I/O (HTTPS to ipify and HTTP
// to ip-api). It's exercised in integration tests. Skipping it here keeps unit
// tests offline and free of leaked TLS sockets.
