/**
 * Unit tests for src/middleware/validation.js
 */

const validation = require('../../src/middleware/validation');

describe('validation - sanitizeMessage', () => {
    test('returns empty string for falsy/non-string input', () => {
        expect(validation.sanitizeMessage(null)).toBe('');
        expect(validation.sanitizeMessage(undefined)).toBe('');
        expect(validation.sanitizeMessage(123)).toBe('');
        expect(validation.sanitizeMessage('')).toBe('');
    });

    test('trims and strips control characters but keeps newlines', () => {
        expect(validation.sanitizeMessage('  hello\x00world  ')).toBe('helloworld');
        expect(validation.sanitizeMessage('line1\nline2')).toBe('line1\nline2');
        expect(validation.sanitizeMessage('tab\ttab')).toBe('tab\ttab');
    });

    test('truncates overly long messages', () => {
        const long = 'a'.repeat(10000);
        const out = validation.sanitizeMessage(long);
        expect(out.length).toBeLessThanOrEqual(10000);
        expect(out.length).toBeGreaterThan(0);
    });
});

describe('validation - sanitizeName', () => {
    test('returns "Anonymous" for invalid/empty', () => {
        expect(validation.sanitizeName(null)).toBe('Anonymous');
        expect(validation.sanitizeName('')).toBe('Anonymous');
        expect(validation.sanitizeName(42)).toBe('Anonymous');
        expect(validation.sanitizeName('   ')).toBe('Anonymous');
    });

    test('strips angle brackets and control chars', () => {
        expect(validation.sanitizeName('<script>Bob</script>')).toBe('scriptBob/script');
        expect(validation.sanitizeName('Alice\x01')).toBe('Alice');
    });

    test('passes through normal names', () => {
        expect(validation.sanitizeName('John Doe')).toBe('John Doe');
    });
});

describe('validation - sanitizeEmail', () => {
    test('returns null for invalid input', () => {
        expect(validation.sanitizeEmail(null)).toBeNull();
        expect(validation.sanitizeEmail('')).toBeNull();
        expect(validation.sanitizeEmail('not-an-email')).toBeNull();
        expect(validation.sanitizeEmail('a@')).toBeNull();
        expect(validation.sanitizeEmail(123)).toBeNull();
    });

    test('lowercases and trims valid emails', () => {
        expect(validation.sanitizeEmail('  User@Example.COM  ')).toBe('user@example.com');
    });
});

describe('validation - validateLocation', () => {
    test('rejects non-objects and missing/invalid coords', () => {
        expect(validation.validateLocation(null)).toBeNull();
        expect(validation.validateLocation('str')).toBeNull();
        expect(validation.validateLocation({})).toBeNull();
        expect(validation.validateLocation({ latitude: 'foo', longitude: 'bar' })).toBeNull();
        expect(validation.validateLocation({ latitude: 91, longitude: 0 })).toBeNull();
        expect(validation.validateLocation({ latitude: 0, longitude: 181 })).toBeNull();
    });

    test('accepts valid coords and normalizes accuracy', () => {
        const r = validation.validateLocation({ latitude: '40.5', longitude: '-74.1', accuracy: '10' });
        expect(r).toEqual({ latitude: 40.5, longitude: -74.1, accuracy: 10 });
    });

    test('clamps negative accuracy to 0', () => {
        const r = validation.validateLocation({ latitude: 0, longitude: 0, accuracy: -5 });
        expect(r.accuracy).toBe(0);
    });
});

describe('validation - validateUsername', () => {
    test('rejects empty/non-string', () => {
        expect(validation.validateUsername('').valid).toBe(false);
        expect(validation.validateUsername(null).valid).toBe(false);
        expect(validation.validateUsername(123).valid).toBe(false);
    });

    test('enforces length and charset rules', () => {
        expect(validation.validateUsername('ab').valid).toBe(false);
        expect(validation.validateUsername('a'.repeat(51)).valid).toBe(false);
        expect(validation.validateUsername('bad name!').valid).toBe(false);
    });

    test('accepts valid usernames', () => {
        const r = validation.validateUsername('  good_user-1  ');
        expect(r.valid).toBe(true);
        expect(r.value).toBe('good_user-1');
    });
});

describe('validation - validatePassword', () => {
    test('rejects missing/short/long', () => {
        expect(validation.validatePassword('').valid).toBe(false);
        expect(validation.validatePassword(null).valid).toBe(false);
        expect(validation.validatePassword('short1').valid).toBe(false);
        expect(validation.validatePassword('a'.repeat(129) + '1').valid).toBe(false);
    });

    test('requires letter and number', () => {
        expect(validation.validatePassword('alllettersnow').valid).toBe(false);
        expect(validation.validatePassword('12345678').valid).toBe(false);
        expect(validation.validatePassword('letters1').valid).toBe(true);
    });
});

describe('validation - sanitizeHtml', () => {
    test('escapes dangerous characters', () => {
        expect(validation.sanitizeHtml('<img src="x" onerror=\'alert(1)\'>'))
            .toBe('&lt;img src=&quot;x&quot; onerror=&#039;alert(1)&#039;&gt;');
    });

    test('handles empty/invalid input', () => {
        expect(validation.sanitizeHtml('')).toBe('');
        expect(validation.sanitizeHtml(null)).toBe('');
        expect(validation.sanitizeHtml(42)).toBe('');
    });
});

describe('validation - isValidTicketId / isValidSiteId', () => {
    test('ticket id checks', () => {
        expect(validation.isValidTicketId('ticket-123_abc')).toBe(false); // underscore not allowed
        expect(validation.isValidTicketId('ticket-123abc')).toBe(true);
        expect(validation.isValidTicketId('')).toBe(false);
        expect(validation.isValidTicketId(null)).toBe(false);
        expect(validation.isValidTicketId('x'.repeat(51))).toBe(false);
        expect(validation.isValidTicketId('bad id!')).toBe(false);
    });

    test('site id checks', () => {
        expect(validation.isValidSiteId('site_1-x')).toBe(true);
        expect(validation.isValidSiteId('')).toBe(false);
        expect(validation.isValidSiteId('site 1')).toBe(false);
        expect(validation.isValidSiteId('x'.repeat(51))).toBe(false);
    });
});

describe('validation - validateBody middleware', () => {
    function runMiddleware(mw, body) {
        return new Promise((resolve) => {
            const req = { body };
            const res = {
                statusCode: 200,
                status(code) { this.statusCode = code; return this; },
                json(payload) { this.body = payload; resolve({ req, res: this, nextCalled: false }); }
            };
            mw(req, res, () => resolve({ req, res, nextCalled: true }));
        });
    }

    test('calls next when all validators pass', async () => {
        const mw = validation.validateBody({
            username: validation.validateUsername,
            password: validation.validatePassword
        });
        const out = await runMiddleware(mw, { username: 'abc_user', password: 'password1' });
        expect(out.nextCalled).toBe(true);
        expect(out.req.body.username).toBe('abc_user');
    });

    test('returns 400 when validator fails', async () => {
        const mw = validation.validateBody({
            username: validation.validateUsername
        });
        const out = await runMiddleware(mw, { username: 'x' });
        expect(out.nextCalled).toBe(false);
        expect(out.res.statusCode).toBe(400);
        expect(out.res.body.error).toBe('Validation failed');
        expect(out.res.body.details[0].field).toBe('username');
    });

    test('ignores non-function validators', async () => {
        const mw = validation.validateBody({ username: 'not a function' });
        const out = await runMiddleware(mw, { username: 'x' });
        expect(out.nextCalled).toBe(true);
    });
});
