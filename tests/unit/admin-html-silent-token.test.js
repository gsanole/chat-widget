/**
 * Static guard for public/admin.html: ensures the silent-token-auth fix
 * stays in place. If someone removes `isSilentTokenAuth` or stops gating
 * the admin:auth-failed handler on it, the stale-token red banner returns.
 *
 * This isn't a runtime browser test — it's a regression check on the
 * shipped HTML/JS so refactors of the file can't quietly undo the fix.
 */

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'admin.html'),
    'utf8'
);

describe('public/admin.html silent token-auth', () => {
    test('declares isSilentTokenAuth flag', () => {
        expect(html).toMatch(/let\s+isSilentTokenAuth\s*=\s*false/);
    });

    test('sets the flag when auto-emitting admin:auth-token on page load', () => {
        // The auto-reconnect block must mark the attempt as silent BEFORE
        // calling setupAuthListeners(), so the flag is set when auth-failed
        // arrives.
        const block = html.match(/if\s*\(savedToken\)\s*{[\s\S]*?setupAuthListeners\(\);\s*}/);
        expect(block).not.toBeNull();
        expect(block[0]).toMatch(/isSilentTokenAuth\s*=\s*true/);
        expect(block[0]).toMatch(/admin:auth-token/);
    });

    test('admin:auth-failed handler short-circuits on silent attempts', () => {
        const handler = html.match(/socket\.on\(\s*['"]admin:auth-failed['"][\s\S]*?\}\);/);
        expect(handler).not.toBeNull();
        expect(handler[0]).toMatch(/if\s*\(\s*isSilentTokenAuth\s*\)/);
        expect(handler[0]).toMatch(/localStorage\.removeItem\(['"]adminToken['"]\)/);
        // Must `return` before calling showLoginError on the silent path.
        const silentBlock = handler[0].match(/if\s*\(\s*isSilentTokenAuth\s*\)\s*{[\s\S]*?\}/);
        expect(silentBlock[0]).toMatch(/return\s*;/);
    });

    test('admin:authenticated clears the silent flag', () => {
        const handler = html.match(/socket\.on\(\s*['"]admin:authenticated['"][\s\S]*?\}\);/);
        expect(handler).not.toBeNull();
        expect(handler[0]).toMatch(/isSilentTokenAuth\s*=\s*false/);
    });
});
