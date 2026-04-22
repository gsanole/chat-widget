/**
 * Unit tests for src/utils/helpers.js
 */

const helpers = require('../../src/utils/helpers');

describe('helpers - id generators', () => {
    test('generateId produces hex string of 2*length chars', () => {
        const id = helpers.generateId(8);
        expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    test('generateId defaults to 32-hex chars', () => {
        expect(helpers.generateId()).toMatch(/^[0-9a-f]{32}$/);
    });

    test('generateUUID produces a v4 UUID', () => {
        expect(helpers.generateUUID()).toMatch(/^[0-9a-f-]{36}$/i);
    });

    test('generateSecureToken produces base64url output', () => {
        const t = helpers.generateSecureToken(16);
        expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    });
});

describe('helpers - sleep', () => {
    test('resolves after roughly the given delay', async () => {
        const start = Date.now();
        await helpers.sleep(25);
        expect(Date.now() - start).toBeGreaterThanOrEqual(20);
    });
});

describe('helpers - safeJsonParse', () => {
    test('parses valid JSON', () => {
        expect(helpers.safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    });

    test('returns default on invalid JSON', () => {
        expect(helpers.safeJsonParse('not json', { fallback: true })).toEqual({ fallback: true });
        expect(helpers.safeJsonParse('{')).toBeNull();
    });
});

describe('helpers - deepClone / pick / omit', () => {
    test('deepClone returns independent copy', () => {
        const src = { a: 1, b: { c: 2 } };
        const copy = helpers.deepClone(src);
        copy.b.c = 99;
        expect(src.b.c).toBe(2);
    });

    test('pick returns only requested keys that exist', () => {
        expect(helpers.pick({ a: 1, b: 2, c: 3 }, ['a', 'c', 'x'])).toEqual({ a: 1, c: 3 });
    });

    test('omit removes specified keys', () => {
        expect(helpers.omit({ a: 1, b: 2, c: 3 }, ['b'])).toEqual({ a: 1, c: 3 });
    });
});

describe('helpers - formatDate / getTimestamp', () => {
    test('formatDate returns a non-empty string', () => {
        expect(typeof helpers.formatDate(new Date('2024-01-15T12:00:00Z'))).toBe('string');
    });

    test('getTimestamp returns ISO format', () => {
        expect(helpers.getTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
});

describe('helpers - truncate', () => {
    test('returns string unchanged when short enough', () => {
        expect(helpers.truncate('hi', 10)).toBe('hi');
    });

    test('truncates with default suffix', () => {
        expect(helpers.truncate('abcdefghij', 6)).toBe('abc...');
    });

    test('truncates with custom suffix', () => {
        expect(helpers.truncate('abcdefghij', 5, '!')).toBe('abcd!');
    });

    test('returns falsy input unchanged', () => {
        expect(helpers.truncate('', 5)).toBe('');
        expect(helpers.truncate(null, 5)).toBe(null);
    });
});

describe('helpers - isEmpty', () => {
    test.each([
        [null, true],
        [undefined, true],
        ['', true],
        ['   ', true],
        ['x', false],
        [[], true],
        [[1], false],
        [{}, true],
        [{ a: 1 }, false],
        [0, false],
        [false, false]
    ])('isEmpty(%p) === %p', (input, expected) => {
        expect(helpers.isEmpty(input)).toBe(expected);
    });
});

describe('helpers - debounce', () => {
    test('invokes only once after wait when called rapidly', async () => {
        let calls = 0;
        const debounced = helpers.debounce(() => { calls++; }, 20);
        debounced(); debounced(); debounced();
        await helpers.sleep(50);
        expect(calls).toBe(1);
    });
});

describe('helpers - retryWithBackoff', () => {
    test('resolves when fn succeeds first try', async () => {
        const fn = jest.fn().mockResolvedValue('ok');
        await expect(helpers.retryWithBackoff(fn, 3, 1)).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries on failure and eventually succeeds', async () => {
        let attempt = 0;
        const fn = jest.fn(async () => {
            attempt++;
            if (attempt < 3) throw new Error('boom');
            return 'done';
        });
        await expect(helpers.retryWithBackoff(fn, 3, 1)).resolves.toBe('done');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    test('throws last error after exhausting retries', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('nope'));
        await expect(helpers.retryWithBackoff(fn, 2, 1)).rejects.toThrow('nope');
        expect(fn).toHaveBeenCalledTimes(2);
    });
});
