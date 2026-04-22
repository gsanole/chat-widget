/**
 * Unit tests for TwoFactorService.
 */

const { TwoFactorService } = require('../../src/services/TwoFactorService');

function makeUserRepo(user) {
    return {
        findById: jest.fn(() => user),
        db: {
            update: jest.fn()
        }
    };
}

function makeAuditRepo() {
    return { log: jest.fn() };
}

describe('TwoFactorService', () => {
    describe('constructor', () => {
        test('throws without userRepository', () => {
            expect(() => new TwoFactorService({ auditRepository: makeAuditRepo() }))
                .toThrow(/userRepository/);
        });

        test('throws without auditRepository', () => {
            expect(() => new TwoFactorService({ userRepository: makeUserRepo({}) }))
                .toThrow(/auditRepository/);
        });

        test('accepts an injected verifier', () => {
            const verify = jest.fn();
            const svc = new TwoFactorService({
                userRepository: makeUserRepo({}),
                auditRepository: makeAuditRepo(),
                verifyTOTP: verify
            });
            expect(svc.verifyTOTP).toBe(verify);
        });
    });

    describe('verify()', () => {
        const baseUser = {
            id: 'u1',
            username: 'alice',
            is_active: true,
            totp_secret: 'SECRET',
            recovery_codes: JSON.stringify(['rec-1', 'rec-2', 'rec-3'])
        };

        test('returns ok=false when no verifier is configured', async () => {
            const svc = new TwoFactorService({
                userRepository: makeUserRepo(baseUser),
                auditRepository: makeAuditRepo()
            });
            const r = await svc.verify('u1', '123456');
            expect(r).toEqual({ ok: false, error: 'TOTP verifier not configured' });
        });

        test('returns ok=false when user not found', async () => {
            const repo = makeUserRepo(null);
            const svc = new TwoFactorService({
                userRepository: repo,
                auditRepository: makeAuditRepo(),
                verifyTOTP: () => true
            });
            const r = await svc.verify('missing', '123456');
            expect(r).toEqual({ ok: false, error: 'User not found' });
        });

        test('returns ok=false when user inactive', async () => {
            const repo = makeUserRepo({ ...baseUser, is_active: false });
            const svc = new TwoFactorService({
                userRepository: repo,
                auditRepository: makeAuditRepo(),
                verifyTOTP: () => true
            });
            const r = await svc.verify('u1', '123456');
            expect(r).toEqual({ ok: false, error: 'User not found' });
        });

        test('returns error when 2FA not configured', async () => {
            const repo = makeUserRepo({ ...baseUser, totp_secret: null });
            const svc = new TwoFactorService({
                userRepository: repo,
                auditRepository: makeAuditRepo(),
                verifyTOTP: () => true
            });
            const r = await svc.verify('u1', '123456');
            expect(r).toEqual({ ok: false, error: '2FA not configured' });
        });

        test('returns ok with the user when TOTP code is valid', async () => {
            const repo = makeUserRepo(baseUser);
            const audit = makeAuditRepo();
            const verify = jest.fn(() => true);
            const svc = new TwoFactorService({
                userRepository: repo,
                auditRepository: audit,
                verifyTOTP: verify
            });

            const r = await svc.verify('u1', '123456', undefined, { ip: '1.2.3.4' });
            expect(r.ok).toBe(true);
            expect(r.user).toBe(baseUser);
            expect(verify).toHaveBeenCalledWith('SECRET', '123456');
            // Recovery codes are not consumed for a valid TOTP code
            expect(repo.db.update).not.toHaveBeenCalled();
            expect(audit.log).not.toHaveBeenCalled();
        });

        test('per-call verifier overrides constructor verifier', async () => {
            const ctorVerify = jest.fn(() => false);
            const callVerify = jest.fn(() => true);
            const repo = makeUserRepo(baseUser);
            const svc = new TwoFactorService({
                userRepository: repo,
                auditRepository: makeAuditRepo(),
                verifyTOTP: ctorVerify
            });

            const r = await svc.verify('u1', '999', callVerify);
            expect(r.ok).toBe(true);
            expect(callVerify).toHaveBeenCalled();
            expect(ctorVerify).not.toHaveBeenCalled();
        });

        test('consumes a single-use recovery code on TOTP failure', async () => {
            const user = { ...baseUser };
            const repo = makeUserRepo(user);
            const audit = makeAuditRepo();
            const svc = new TwoFactorService({
                userRepository: repo,
                auditRepository: audit,
                verifyTOTP: () => false
            });

            const r = await svc.verify('u1', 'rec-2', undefined, {
                ip: '1.1.1.1',
                userAgent: 'jest'
            });

            expect(r.ok).toBe(true);
            expect(repo.db.update).toHaveBeenCalledTimes(1);
            const [, patch] = repo.db.update.mock.calls[0];
            const remaining = JSON.parse(patch.recovery_codes);
            expect(remaining).toEqual(['rec-1', 'rec-3']);

            expect(audit.log).toHaveBeenCalledTimes(1);
            const entry = audit.log.mock.calls[0][0];
            expect(entry.action).toBe('recovery_code_used');
            expect(entry.userId).toBe('u1');
            expect(entry.ipAddress).toBe('1.1.1.1');
            expect(entry.userAgent).toBe('jest');
            expect(entry.details).toMatch(/2 remaining/);
        });

        test('rejects when neither TOTP nor recovery codes match', async () => {
            const repo = makeUserRepo(baseUser);
            const audit = makeAuditRepo();
            const svc = new TwoFactorService({
                userRepository: repo,
                auditRepository: audit,
                verifyTOTP: () => false
            });

            const r = await svc.verify('u1', 'nope');
            expect(r).toEqual({ ok: false, error: 'Invalid verification code' });
            expect(repo.db.update).not.toHaveBeenCalled();
            expect(audit.log).not.toHaveBeenCalled();
        });

        test('rejects gracefully when recovery_codes is unparseable JSON', async () => {
            const repo = makeUserRepo({ ...baseUser, recovery_codes: 'not-json' });
            const svc = new TwoFactorService({
                userRepository: repo,
                auditRepository: makeAuditRepo(),
                verifyTOTP: () => false
            });
            const r = await svc.verify('u1', 'something');
            expect(r).toEqual({ ok: false, error: 'Invalid verification code' });
        });

        test('rejects when there are no recovery codes at all', async () => {
            const repo = makeUserRepo({ ...baseUser, recovery_codes: null });
            const svc = new TwoFactorService({
                userRepository: repo,
                auditRepository: makeAuditRepo(),
                verifyTOTP: () => false
            });
            const r = await svc.verify('u1', 'rec-1');
            expect(r).toEqual({ ok: false, error: 'Invalid verification code' });
        });
    });
});
