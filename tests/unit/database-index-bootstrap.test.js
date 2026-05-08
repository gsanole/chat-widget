/**
 * Cover the fire-and-forget catch handler in src/database/index.js around
 * the bootstrapAdminFromEnv() call. Loads the module with the seed module
 * mocked so bootstrap rejects.
 */

jest.mock('../../src/database/seed', () => ({
    runSeed: jest.fn(),
    bootstrapAdminFromEnv: jest.fn(() => Promise.reject(new Error('boot fail')))
}));

describe('database index bootstrap catch', () => {
    test('logs and swallows when bootstrap rejects', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.resetModules();
        // Re-require the mock (resetModules clears it).
        jest.doMock('../../src/database/seed', () => ({
            runSeed: jest.fn(),
            bootstrapAdminFromEnv: jest.fn(() => Promise.reject(new Error('boot fail')))
        }));
        require('../../src/database');
        // Wait a microtask tick so the .catch handler runs.
        await new Promise(r => setImmediate(r));
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('[seed] bootstrap admin failed:'),
            'boot fail'
        );
        warn.mockRestore();
    });

    test('handles a non-Error rejection value', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.resetModules();
        jest.doMock('../../src/database/seed', () => ({
            runSeed: jest.fn(),
            bootstrapAdminFromEnv: jest.fn(() => Promise.reject('plain-string'))
        }));
        require('../../src/database');
        await new Promise(r => setImmediate(r));
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('[seed] bootstrap admin failed:'),
            'plain-string'
        );
        warn.mockRestore();
    });
});
