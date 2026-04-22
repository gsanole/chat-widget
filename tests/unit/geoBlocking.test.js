/**
 * Unit tests for the country-based geo blocking feature.
 *
 * Covers:
 *   - isCountryBlocked() helper in src/utils/ipUtils.js
 *   - POST /api/chatbot/message enforcement
 */

const { isCountryBlocked } = require('../../src/utils/ipUtils');

describe('isCountryBlocked()', () => {
    test('returns not blocked when config is missing', () => {
        expect(isCountryBlocked({ countryCode: 'RU' }, null)).toEqual({
            blocked: false, reason: null, country: null
        });
        expect(isCountryBlocked({ countryCode: 'RU' }, undefined)).toEqual({
            blocked: false, reason: null, country: null
        });
    });

    test('returns not blocked when feature disabled', () => {
        const cfg = { enabled: false, mode: 'blocklist', countries: ['RU'] };
        const r = isCountryBlocked({ countryCode: 'RU' }, cfg);
        expect(r.blocked).toBe(false);
    });

    test('blocklist with empty country list allows everyone', () => {
        const cfg = { enabled: true, mode: 'blocklist', countries: [] };
        expect(isCountryBlocked({ countryCode: 'RU' }, cfg).blocked).toBe(false);
    });

    test('allowlist with empty country list blocks everyone', () => {
        const cfg = { enabled: true, mode: 'allowlist', countries: [] };
        const r = isCountryBlocked({ countryCode: 'US' }, cfg);
        expect(r.blocked).toBe(true);
        expect(r.reason).toMatch(/allowlist/i);
    });

    test('blocklist blocks listed ISO-2 country', () => {
        const cfg = { enabled: true, mode: 'blocklist', countries: ['RU', 'CN'] };
        const r = isCountryBlocked({ countryCode: 'ru' }, cfg);
        expect(r.blocked).toBe(true);
        expect(r.country).toBe('RU');
        expect(r.reason).toMatch(/blocked/i);
    });

    test('blocklist allows non-listed country', () => {
        const cfg = { enabled: true, mode: 'blocklist', countries: ['RU'] };
        expect(isCountryBlocked({ countryCode: 'US' }, cfg).blocked).toBe(false);
    });

    test('allowlist allows only listed countries', () => {
        const cfg = { enabled: true, mode: 'allowlist', countries: ['US', 'GB'] };
        expect(isCountryBlocked({ countryCode: 'US' }, cfg).blocked).toBe(false);
        expect(isCountryBlocked({ countryCode: 'CA' }, cfg).blocked).toBe(true);
    });

    test('matches against full country name when no countryCode present', () => {
        const cfg = { enabled: true, mode: 'blocklist', countries: ['Russia'] };
        const r = isCountryBlocked({ country: 'Russia' }, cfg);
        expect(r.blocked).toBe(true);
    });

    test('handles missing geo gracefully', () => {
        const cfg = { enabled: true, mode: 'blocklist', countries: ['RU'] };
        expect(isCountryBlocked(null, cfg).blocked).toBe(false);
        expect(isCountryBlocked({}, cfg).blocked).toBe(false);
    });

    test('ignores invalid mode and treats as blocklist', () => {
        const cfg = { enabled: true, mode: 'something-weird', countries: ['RU'] };
        expect(isCountryBlocked({ countryCode: 'RU' }, cfg).blocked).toBe(true);
        expect(isCountryBlocked({ countryCode: 'US' }, cfg).blocked).toBe(false);
    });

    test('ignores non-string entries in countries list', () => {
        const cfg = { enabled: true, mode: 'blocklist', countries: ['RU', null, 123, '   '] };
        expect(isCountryBlocked({ countryCode: 'RU' }, cfg).blocked).toBe(true);
        expect(isCountryBlocked({ countryCode: 'US' }, cfg).blocked).toBe(false);
    });

    test('countries: undefined defaults to no list', () => {
        const cfg = { enabled: true, mode: 'blocklist' };
        expect(isCountryBlocked({ countryCode: 'RU' }, cfg).blocked).toBe(false);
    });
});

describe('POST /api/chatbot/message geo blocking enforcement', () => {
    const path = require('path');
    const fs = require('fs');
    let request;
    let appHandle;
    let configBackup;

    beforeAll(() => {
        request = require('supertest');
        const { createApp } = require('../../src/app');
        appHandle = createApp({});
    });

    afterAll(() => {
        // Restore original config file if we mutated it
        if (configBackup !== undefined) {
            const cfgPath = path.join(process.env.DATABASE_DIR || 'tests/test-data', 'chatbot.json');
            try { fs.writeFileSync(cfgPath, configBackup); } catch (e) { /* ignore */ }
        }
    });

    test('returns chat response when geoBlocking disabled', async () => {
        const res = await request(appHandle.app)
            .post('/api/chatbot/message')
            .send({ message: 'hello' });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('message');
    });

    test('returns 403 GEO_BLOCKED when caller country is on blocklist', async () => {
        // Inject a blocking config via the chatbot service
        const svc = appHandle.services.chatbotService;
        const original = svc.getConfig();
        configBackup = JSON.stringify(original, null, 2);

        const blocked = {
            ...original,
            geoBlocking: {
                enabled: true,
                mode: 'blocklist',
                countries: ['XX'],
                blockedMessage: 'Blocked in your region.'
            }
        };

        // Stub getConfig to return our blocking config without persisting to disk
        const realGet = svc.getConfig.bind(svc);
        svc.getConfig = () => blocked;

        // Stub fetchIPGeo to return XX so we get blocked deterministically
        const ipUtils = require('../../src/utils/ipUtils');
        const realFetch = ipUtils.fetchIPGeo;
        ipUtils.fetchIPGeo = async () => ({ country: 'Nowhere', countryCode: 'XX' });

        try {
            const res = await request(appHandle.app)
                .post('/api/chatbot/message')
                .set('x-forwarded-for', '8.8.8.8')
                .send({ message: 'hello' });
            expect(res.status).toBe(403);
            expect(res.body.error).toBe('GEO_BLOCKED');
            expect(res.body.message).toMatch(/region/i);
            expect(res.body.country).toBe('XX');
        } finally {
            svc.getConfig = realGet;
            ipUtils.fetchIPGeo = realFetch;
        }
    });

    test('falls through to chat response when geo lookup throws', async () => {
        const svc = appHandle.services.chatbotService;
        const realGet = svc.getConfig.bind(svc);
        svc.getConfig = () => ({
            enabled: true,
            geoBlocking: { enabled: true, mode: 'blocklist', countries: ['XX'] }
        });

        const ipUtils = require('../../src/utils/ipUtils');
        const realFetch = ipUtils.fetchIPGeo;
        ipUtils.fetchIPGeo = async () => { throw new Error('lookup failed'); };

        try {
            const res = await request(appHandle.app)
                .post('/api/chatbot/message')
                .set('x-forwarded-for', '8.8.8.8')
                .send({ message: 'hi' });
            // Should NOT be 403 — geo lookup error is best-effort
            expect(res.status).toBe(200);
        } finally {
            svc.getConfig = realGet;
            ipUtils.fetchIPGeo = realFetch;
        }
    });

    test('skips geo lookup for localhost so local testing is never blocked', async () => {
        const svc = appHandle.services.chatbotService;
        const realGet = svc.getConfig.bind(svc);
        svc.getConfig = () => ({
            enabled: true,
            geoBlocking: { enabled: true, mode: 'allowlist', countries: ['JP'] }
        });

        try {
            const res = await request(appHandle.app)
                .post('/api/chatbot/message')
                // No x-forwarded-for → req.ip resolves to localhost in tests
                .send({ message: 'hi' });
            expect(res.status).toBe(200);
        } finally {
            svc.getConfig = realGet;
        }
    });

    test('uses custom blockedMessage from config when provided', async () => {
        const svc = appHandle.services.chatbotService;
        const realGet = svc.getConfig.bind(svc);
        svc.getConfig = () => ({
            enabled: true,
            geoBlocking: {
                enabled: true,
                mode: 'blocklist',
                countries: ['XX'],
                blockedMessage: 'Custom blocked text'
            }
        });

        const ipUtils = require('../../src/utils/ipUtils');
        const realFetch = ipUtils.fetchIPGeo;
        ipUtils.fetchIPGeo = async () => ({ countryCode: 'XX' });

        try {
            const res = await request(appHandle.app)
                .post('/api/chatbot/message')
                .set('x-forwarded-for', '8.8.8.8')
                .send({ message: 'hi' });
            expect(res.status).toBe(403);
            expect(res.body.message).toBe('Custom blocked text');
        } finally {
            svc.getConfig = realGet;
            ipUtils.fetchIPGeo = realFetch;
        }
    });

    test('uses default blocked message when blockedMessage missing and country null', async () => {
        const svc = appHandle.services.chatbotService;
        const realGet = svc.getConfig.bind(svc);
        // No blockedMessage in config; allowlist with empty list → blocked + decision.country=null
        svc.getConfig = () => ({
            enabled: true,
            geoBlocking: { enabled: true, mode: 'allowlist', countries: [] }
        });
        const ipUtils = require('../../src/utils/ipUtils');
        const realFetch = ipUtils.fetchIPGeo;
        ipUtils.fetchIPGeo = async () => ({});

        try {
            const res = await request(appHandle.app)
                .post('/api/chatbot/message')
                .set('x-forwarded-for', '8.8.8.8')
                .send({ message: 'hi' });
            expect(res.status).toBe(403);
            expect(res.body.message).toMatch(/not available in your region/i);
            expect(res.body.country).toBeNull();
        } finally {
            svc.getConfig = realGet;
            ipUtils.fetchIPGeo = realFetch;
        }
    });

    test('skips lookup when getRealIP returns "unknown"', async () => {
        const svc = appHandle.services.chatbotService;
        const realGet = svc.getConfig.bind(svc);
        svc.getConfig = () => ({
            enabled: true,
            geoBlocking: { enabled: true, mode: 'blocklist', countries: ['XX'] }
        });
        const ipUtils = require('../../src/utils/ipUtils');
        const realRealIP = ipUtils.getRealIP;
        const realFetch = ipUtils.fetchIPGeo;
        ipUtils.getRealIP = () => 'unknown';
        ipUtils.fetchIPGeo = jest.fn(async () => ({ countryCode: 'XX' }));

        try {
            const res = await request(appHandle.app)
                .post('/api/chatbot/message')
                .send({ message: 'hi' });
            expect(res.status).toBe(200);
            expect(ipUtils.fetchIPGeo).not.toHaveBeenCalled();
        } finally {
            ipUtils.getRealIP = realRealIP;
            ipUtils.fetchIPGeo = realFetch;
            svc.getConfig = realGet;
        }
    });

    test('treats null getConfig() as empty config (no geoBlocking)', async () => {
        const svc = appHandle.services.chatbotService;
        const realGet = svc.getConfig.bind(svc);
        // Stub getConfig only for the first call (geo-block check),
        // restore before processMessage runs to avoid breaking ChatbotService
        let calls = 0;
        svc.getConfig = () => {
            calls += 1;
            if (calls === 1) return null;
            return realGet();
        };

        try {
            const res = await request(appHandle.app)
                .post('/api/chatbot/message')
                .send({ message: 'hi' });
            expect(res.status).toBe(200);
        } finally {
            svc.getConfig = realGet;
        }
    });
});
