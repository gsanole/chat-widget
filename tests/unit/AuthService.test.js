/**
 * Unit tests for AuthService.
 *
 * AuthService.generateToken / verifyToken use the real `jsonwebtoken` against
 * the real JWT_SECRET (loaded by the module on require), so we issue tokens
 * via the service itself rather than fabricating them.
 */

const { AuthService } = require('../../src/services/AuthService');

function makeRepos() {
    return {
        userRepository: {
            authenticate: jest.fn(),
            findById: jest.fn(),
            updateLastLogin: jest.fn()
        },
        sessionRepository: {
            create: jest.fn(),
            deleteByToken: jest.fn()
        },
        auditRepository: {
            log: jest.fn()
        }
    };
}

describe('AuthService', () => {
    let repos, svc;

    beforeEach(() => {
        repos = makeRepos();
        svc = new AuthService(repos);
    });

    // -----------------------------------------------------------------------
    // generateToken / verifyToken
    // -----------------------------------------------------------------------
    describe('generateToken + verifyToken', () => {
        test('verifyToken returns decoded payload for a freshly generated token', () => {
            const user = { id: 'u1', username: 'alice', role: 'admin' };
            const token = svc.generateToken(user);
            repos.userRepository.findById.mockReturnValue({ ...user, is_active: true });

            const decoded = svc.verifyToken(token);
            expect(decoded).toMatchObject({
                userId: 'u1', username: 'alice', role: 'admin'
            });
        });

        test('verifyToken returns null when user no longer exists', () => {
            const token = svc.generateToken({ id: 'gone', username: 'g', role: 'admin' });
            repos.userRepository.findById.mockReturnValue(null);
            expect(svc.verifyToken(token)).toBeNull();
        });

        test('verifyToken returns null when user inactive', () => {
            const token = svc.generateToken({ id: 'u1', username: 'a', role: 'admin' });
            repos.userRepository.findById.mockReturnValue({ id: 'u1', is_active: false });
            expect(svc.verifyToken(token)).toBeNull();
        });

        test('verifyToken returns null for malformed tokens', () => {
            expect(svc.verifyToken('not-a-jwt')).toBeNull();
        });

        test('two generated tokens have different jti (id)', () => {
            const t1 = svc.generateToken({ id: 'u1', username: 'a', role: 'admin' });
            const t2 = svc.generateToken({ id: 'u1', username: 'a', role: 'admin' });
            repos.userRepository.findById.mockReturnValue({ id: 'u1', is_active: true });
            const d1 = svc.verifyToken(t1);
            const d2 = svc.verifyToken(t2);
            expect(d1.id).not.toBe(d2.id);
        });
    });

    // -----------------------------------------------------------------------
    // authenticate
    // -----------------------------------------------------------------------
    describe('authenticate', () => {
        test('returns failure and audits invalid credentials', async () => {
            repos.userRepository.authenticate.mockResolvedValue(null);
            const r = await svc.authenticate('u', 'p', { ip: '1.1.1.1' });
            expect(r).toEqual({ success: false, error: 'Invalid credentials' });
            expect(repos.auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({
                action: 'login_failed', ipAddress: '1.1.1.1'
            }));
        });

        test('signals 2FA required without issuing a token', async () => {
            repos.userRepository.authenticate.mockResolvedValue({
                id: 'u1', username: 'alice', totp_enabled: true
            });
            const r = await svc.authenticate('alice', 'p');
            expect(r).toEqual({
                success: false, requires2FA: true, userId: 'u1', username: 'alice'
            });
            expect(repos.userRepository.updateLastLogin).not.toHaveBeenCalled();
        });

        test('issues JWT, updates last login, audits success on valid creds', async () => {
            repos.userRepository.authenticate.mockResolvedValue({
                id: 'u1', username: 'alice', role: 'admin', totp_enabled: false
            });
            const r = await svc.authenticate('alice', 'p', { ip: '2.2.2.2' });
            expect(r.success).toBe(true);
            expect(typeof r.token).toBe('string');
            expect(r.user).toEqual({
                id: 'u1', username: 'alice', nickname: 'alice',
                role: 'admin', totp_enabled: false
            });
            expect(repos.userRepository.updateLastLogin).toHaveBeenCalledWith('u1');
            expect(repos.auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({
                action: 'login'
            }));
        });

        test('uses nickname when present', async () => {
            repos.userRepository.authenticate.mockResolvedValue({
                id: 'u1', username: 'alice', nickname: 'Ally', role: 'admin'
            });
            const r = await svc.authenticate('alice', 'p');
            expect(r.user.nickname).toBe('Ally');
        });
    });

    // -----------------------------------------------------------------------
    // verify2FA — delegates to TwoFactorService
    // -----------------------------------------------------------------------
    describe('verify2FA', () => {
        test('returns failure when 2FA service rejects', async () => {
            const tfs = { verify: jest.fn(async () => ({ ok: false, error: 'bad code' })) };
            const s = new AuthService({ ...repos, twoFactorService: tfs });
            const r = await s.verify2FA('u1', '000000', () => false, { ip: 'x' });
            expect(r).toEqual({ success: false, error: 'bad code' });
            expect(tfs.verify).toHaveBeenCalledWith('u1', '000000', expect.any(Function), { ip: 'x' });
        });

        test('issues token and audits 2FA login on success', async () => {
            const user = { id: 'u1', username: 'alice', role: 'admin', nickname: 'Ally' };
            const tfs = { verify: jest.fn(async () => ({ ok: true, user })) };
            const s = new AuthService({ ...repos, twoFactorService: tfs });
            const r = await s.verify2FA('u1', '123456', () => true, { ip: 'i' });

            expect(r.success).toBe(true);
            expect(typeof r.token).toBe('string');
            expect(r.user).toEqual({
                id: 'u1', username: 'alice', nickname: 'Ally', role: 'admin'
            });
            expect(repos.userRepository.updateLastLogin).toHaveBeenCalledWith('u1');
            expect(repos.auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({
                action: 'login_2fa'
            }));
        });
    });

    // -----------------------------------------------------------------------
    // logout / hasPermission / getUserFromToken
    // -----------------------------------------------------------------------
    describe('logout', () => {
        test('deletes session and writes audit log', () => {
            svc.logout('tok', { userId: 'u1', username: 'alice' }, { ip: '1.1.1.1' });
            expect(repos.sessionRepository.deleteByToken).toHaveBeenCalledWith('tok');
            expect(repos.auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({
                action: 'logout', userId: 'u1', ipAddress: '1.1.1.1'
            }));
        });
    });

    describe('hasPermission', () => {
        test('delegates to permissions config', () => {
            expect(svc.hasPermission('super_admin', 'manage_users')).toBe(true);
            expect(svc.hasPermission('support', 'manage_users')).toBe(false);
            expect(svc.hasPermission('support', 'chat')).toBe(true);
        });
    });

    describe('getUserFromToken', () => {
        test('returns the user when token verifies', () => {
            const user = { id: 'u1', username: 'a', is_active: true };
            const tok = svc.generateToken({ id: 'u1', username: 'a', role: 'admin' });
            repos.userRepository.findById.mockReturnValue(user);
            expect(svc.getUserFromToken(tok)).toBe(user);
        });

        test('returns null for invalid token', () => {
            expect(svc.getUserFromToken('garbage')).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // constructor
    // -----------------------------------------------------------------------
    describe('constructor', () => {
        test('builds a default TwoFactorService when none supplied', () => {
            expect(svc.twoFactorService).toBeDefined();
            expect(typeof svc.twoFactorService.verify).toBe('function');
        });

        test('uses an injected TwoFactorService when supplied', () => {
            const tfs = { verify: jest.fn() };
            const s = new AuthService({ ...repos, twoFactorService: tfs });
            expect(s.twoFactorService).toBe(tfs);
        });
    });
});
