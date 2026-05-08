/**
 * Unit tests for SiteRepository.updateIntegration and
 * regenerateIntegrationSecret (per-site integration config).
 */

const { SiteRepository } = require('../../src/database/repositories/SiteRepository');

function makeStubDb(initial = []) {
    const rows = [...initial];
    return {
        rows,
        insert: jest.fn(row => { rows.push(row); return row; }),
        find: jest.fn(pred => rows.find(pred)),
        filter: jest.fn(pred => rows.filter(pred)),
        getAll: jest.fn(() => [...rows]),
        update: jest.fn((pred, updates) => {
            const idx = rows.findIndex(pred);
            if (idx === -1) return null;
            rows[idx] = { ...rows[idx], ...updates };
            return rows[idx];
        }),
        delete: jest.fn(pred => {
            const idx = rows.findIndex(pred);
            if (idx === -1) return false;
            rows.splice(idx, 1);
            return true;
        })
    };
}

describe('SiteRepository — integration config', () => {
    test('create() initializes integration to null', () => {
        const db = makeStubDb();
        const repo = new SiteRepository(db);
        const site = repo.create({ name: 'A', domain: 'a.com' });
        expect(site.integration).toBeNull();
    });

    test('updateIntegration normalizes shape and strips trailing slash', () => {
        const db = makeStubDb([{ id: 's1', integration: null }]);
        const repo = new SiteRepository(db);
        const updated = repo.updateIntegration('s1', {
            enabled: true,
            url: 'https://hub.example.com///',
            secret: 'k',
            events: ['message', 'session.opened']
        });
        expect(updated.integration).toEqual({
            enabled: true,
            url: 'https://hub.example.com',
            secret: 'k',
            events: ['message', 'session.opened']
        });
    });

    test('updateIntegration forces enabled=false when no url is provided', () => {
        const db = makeStubDb([{ id: 's1', integration: null }]);
        const repo = new SiteRepository(db);
        const updated = repo.updateIntegration('s1', {
            enabled: true,
            url: '',
            secret: 'k'
        });
        expect(updated.integration).toEqual({
            enabled: false,
            url: null,
            secret: 'k',
            events: null
        });
    });

    test('updateIntegration drops non-array events to null', () => {
        const db = makeStubDb([{ id: 's1', integration: null }]);
        const repo = new SiteRepository(db);
        const updated = repo.updateIntegration('s1', {
            enabled: true,
            url: 'https://x',
            secret: 'k',
            events: 'not-an-array'
        });
        expect(updated.integration.events).toBeNull();
    });

    test('updateIntegration with null clears the config', () => {
        const db = makeStubDb([{
            id: 's1',
            integration: { enabled: true, url: 'https://x', secret: 'k', events: null }
        }]);
        const repo = new SiteRepository(db);
        const updated = repo.updateIntegration('s1', null);
        expect(updated.integration).toBeNull();
    });

    test('updateIntegration on a missing site returns null', () => {
        const db = makeStubDb();
        const repo = new SiteRepository(db);
        const r = repo.updateIntegration('nope', { enabled: true, url: 'x', secret: 'k' });
        expect(r).toBeNull();
    });

    test('regenerateIntegrationSecret generates a token and preserves enabled+url+events', () => {
        const db = makeStubDb([{
            id: 's1',
            integration: {
                enabled: true,
                url: 'https://hub.example.com',
                secret: 'old-secret',
                events: ['message']
            }
        }]);
        const repo = new SiteRepository(db);
        const newSecret = repo.regenerateIntegrationSecret('s1');
        expect(typeof newSecret).toBe('string');
        expect(newSecret.length).toBeGreaterThanOrEqual(32);
        expect(newSecret).not.toBe('old-secret');

        const stored = db.find(s => s.id === 's1').integration;
        expect(stored.secret).toBe(newSecret);
        expect(stored.enabled).toBe(true);
        expect(stored.url).toBe('https://hub.example.com');
        expect(stored.events).toEqual(['message']);
    });

    test('regenerateIntegrationSecret bootstraps integration when none exists', () => {
        const db = makeStubDb([{ id: 's1', integration: null }]);
        const repo = new SiteRepository(db);
        const newSecret = repo.regenerateIntegrationSecret('s1');
        const stored = db.find(s => s.id === 's1').integration;
        expect(stored.secret).toBe(newSecret);
        expect(stored.enabled).toBe(false);
        expect(stored.url).toBeNull();
    });

    test('regenerateIntegrationSecret on a missing site returns null', () => {
        const db = makeStubDb();
        const repo = new SiteRepository(db);
        expect(repo.regenerateIntegrationSecret('nope')).toBeNull();
    });
});
