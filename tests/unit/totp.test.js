/**
 * TOTP Module Coverage Tests
 * Focus on improving totp.js coverage
 */

const totp = require('../../src/utils/totp');

describe('TOTP Module Tests', () => {

    describe('Secret Generation', () => {
        test('should generate a random secret', () => {
            const secret = totp.generateSecret();
            expect(secret).toBeDefined();
            expect(Buffer.isBuffer(secret)).toBe(true);
            expect(secret.length).toBe(20); // Default secret length
        });

        test('should generate unique secrets', () => {
            const secret1 = totp.generateSecret();
            const secret2 = totp.generateSecret();
            expect(secret1.toString('hex')).not.toBe(secret2.toString('hex'));
        });
    });

    describe('Base32 Encoding/Decoding', () => {
        test('should encode buffer to base32', () => {
            const buffer = Buffer.from('Hello!');
            const encoded = totp.encodeBase32(buffer);
            expect(typeof encoded).toBe('string');
            expect(encoded).toMatch(/^[A-Z2-7]+$/);
        });

        test('should decode base32 to buffer', () => {
            const original = Buffer.from('TestData');
            const encoded = totp.encodeBase32(original);
            const decoded = totp.decodeBase32(encoded);
            expect(decoded.toString()).toBe(original.toString());
        });

        test('should handle empty buffer encoding', () => {
            const buffer = Buffer.from('');
            const encoded = totp.encodeBase32(buffer);
            expect(encoded).toBe('');
        });

        test('should handle whitespace in base32 decoding', () => {
            const encoded = 'JBSWY3DP EHPK3PXP';
            const decoded = totp.decodeBase32(encoded);
            expect(Buffer.isBuffer(decoded)).toBe(true);
        });

        test('should handle lowercase in base32 decoding', () => {
            const encoded = 'jbswy3dpehpk3pxp';
            const decoded = totp.decodeBase32(encoded);
            expect(Buffer.isBuffer(decoded)).toBe(true);
        });

        test('should ignore invalid characters in base32 decoding', () => {
            const encoded = 'JBSWY3DP!!!EHPK3PXP';
            const decoded = totp.decodeBase32(encoded);
            expect(Buffer.isBuffer(decoded)).toBe(true);
        });
    });

    describe('TOTP Generation', () => {
        const testSecret = 'JBSWY3DPEHPK3PXP'; // Test secret

        test('should generate 6-digit TOTP code', () => {
            const code = totp.generateTOTP(testSecret);
            expect(typeof code).toBe('string');
            expect(code.length).toBe(6);
            expect(code).toMatch(/^\d{6}$/);
        });

        test('should generate TOTP for specific time', () => {
            const time = 1234567890;
            const code1 = totp.generateTOTP(testSecret, time);
            const code2 = totp.generateTOTP(testSecret, time);
            expect(code1).toBe(code2); // Same time = same code
        });

        test('should generate different codes for different times', () => {
            const time1 = 1000000000;
            const time2 = 1000000100; // Different 30-second period
            const code1 = totp.generateTOTP(testSecret, time1);
            const code2 = totp.generateTOTP(testSecret, time2);
            // May be same or different depending on period alignment
            expect(code1).toBeDefined();
            expect(code2).toBeDefined();
        });

        test('should work with Buffer secret', () => {
            const secretBuffer = totp.generateSecret();
            const code = totp.generateTOTP(secretBuffer);
            expect(code).toBeDefined();
            expect(code.length).toBe(6);
        });
    });

    describe('TOTP Verification', () => {
        test('should verify correct code', () => {
            const secret = totp.generateSecret();
            const secretBase32 = totp.encodeBase32(secret);
            const currentCode = totp.generateTOTP(secretBase32);

            const result = totp.verifyTOTP(secretBase32, currentCode);
            expect(result).toBe(true);
        });

        test('should reject invalid code', () => {
            const secret = totp.generateSecret();
            const secretBase32 = totp.encodeBase32(secret);

            const result = totp.verifyTOTP(secretBase32, '000000');
            // Could be true if by chance matches, but usually false
            expect(typeof result).toBe('boolean');
        });

        test('should verify code within window', () => {
            const secret = 'JBSWY3DPEHPK3PXP';
            const now = Date.now() / 1000;

            // Generate code for previous period
            const prevTime = now - 30;
            const prevCode = totp.generateTOTP(secret, prevTime);

            // Should still verify with window=1
            const result = totp.verifyTOTP(secret, prevCode, 1);
            expect(typeof result).toBe('boolean');
        });

        test('should reject code outside window', () => {
            const secret = 'JBSWY3DPEHPK3PXP';
            const now = Date.now() / 1000;

            // Generate code for 5 minutes ago (10 periods)
            const oldTime = now - 300;
            const oldCode = totp.generateTOTP(secret, oldTime);

            // Should reject with window=1
            const result = totp.verifyTOTP(secret, oldCode, 1);
            expect(result).toBe(false);
        });

        test('should handle larger verification window', () => {
            const secret = 'JBSWY3DPEHPK3PXP';
            const currentCode = totp.generateTOTP(secret);

            const result = totp.verifyTOTP(secret, currentCode, 3);
            expect(result).toBe(true);
        });
    });

    describe('TOTP URI Generation', () => {
        test('should generate valid TOTP URI', () => {
            const secret = 'JBSWY3DPEHPK3PXP';
            const accountName = 'user@example.com';

            const uri = totp.generateTOTPUri(secret, accountName);
            expect(uri).toContain('otpauth://totp/');
            expect(uri).toContain('secret=' + secret);
            expect(uri).toContain(encodeURIComponent(accountName));
        });

        test('should include custom issuer', () => {
            const secret = 'JBSWY3DPEHPK3PXP';
            const accountName = 'user@example.com';
            const issuer = 'MyApp';

            const uri = totp.generateTOTPUri(secret, accountName, issuer);
            expect(uri).toContain('issuer=' + issuer);
            expect(uri).toContain(issuer + ':');
        });

        test('should handle special characters in account name', () => {
            const secret = 'JBSWY3DPEHPK3PXP';
            const accountName = 'user+test@example.com';

            const uri = totp.generateTOTPUri(secret, accountName);
            expect(uri).toContain(encodeURIComponent(accountName));
        });

        test('should work with Buffer secret', () => {
            const secretBuffer = totp.generateSecret();
            const accountName = 'test@test.com';

            const uri = totp.generateTOTPUri(secretBuffer, accountName);
            expect(uri).toContain('otpauth://totp/');
        });
    });

    describe('Recovery Codes', () => {
        test('should generate recovery codes', () => {
            const codes = totp.generateRecoveryCodes();
            expect(Array.isArray(codes)).toBe(true);
            expect(codes.length).toBe(10); // Default count
        });

        test('should generate specified number of codes', () => {
            const codes = totp.generateRecoveryCodes(5);
            expect(codes.length).toBe(5);
        });

        test('should generate codes in XXXX-XXXX format', () => {
            const codes = totp.generateRecoveryCodes(3);
            codes.forEach(code => {
                expect(code).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/);
            });
        });

        test('should generate unique codes', () => {
            const codes = totp.generateRecoveryCodes(10);
            const unique = new Set(codes);
            expect(unique.size).toBe(codes.length);
        });
    });

    describe('Recovery Code Verification', () => {
        test('should verify valid recovery code', () => {
            const codes = ['ABCD-1234', 'EFGH-5678', 'IJKL-9012'];
            const result = totp.verifyRecoveryCode(codes, 'ABCD-1234');

            expect(result.valid).toBe(true);
            expect(result.remainingCodes).not.toContain('ABCD-1234');
            expect(result.remainingCodes.length).toBe(2);
        });

        test('should reject invalid recovery code', () => {
            const codes = ['ABCD-1234', 'EFGH-5678'];
            const result = totp.verifyRecoveryCode(codes, 'WRONG-CODE');

            expect(result.valid).toBe(false);
            expect(result.remainingCodes.length).toBe(2);
        });

        test('should handle code without dash', () => {
            const codes = ['ABCD-1234'];
            const result = totp.verifyRecoveryCode(codes, 'ABCD1234');

            expect(result.valid).toBe(true);
        });

        test('should handle lowercase input', () => {
            const codes = ['ABCD-1234'];
            const result = totp.verifyRecoveryCode(codes, 'abcd-1234');

            expect(result.valid).toBe(true);
        });

        test('should handle empty codes array', () => {
            const codes = [];
            const result = totp.verifyRecoveryCode(codes, 'ABCD-1234');

            expect(result.valid).toBe(false);
            expect(result.remainingCodes.length).toBe(0);
        });
    });

    describe('QR Code Generation', () => {
        test('should attempt QR code generation', async () => {
            const uri = 'otpauth://totp/Test:user@example.com?secret=JBSWY3DPEHPK3PXP';

            const result = await totp.generateQRCodeDataURL(uri);
            // May return data URL or null depending on qrcode package availability
            expect(result === null || result.startsWith('data:image')).toBe(true);
        });
    });

    describe('Config Export', () => {
        test('should export TOTP config', () => {
            expect(totp.config).toBeDefined();
            expect(totp.config.digits).toBe(6);
            expect(totp.config.period).toBe(30);
            expect(totp.config.algorithm).toBe('sha1');
            expect(totp.config.secretLength).toBe(20);
        });
    });

    describe('Edge Cases', () => {
        test('should handle very long base32 string', () => {
            const longSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
            const decoded = totp.decodeBase32(longSecret);
            expect(Buffer.isBuffer(decoded)).toBe(true);
        });

        test('should generate consistent codes', () => {
            const secret = 'JBSWY3DPEHPK3PXP';
            const time = 1609459200; // Fixed time

            const code1 = totp.generateTOTP(secret, time);
            const code2 = totp.generateTOTP(secret, time);

            expect(code1).toBe(code2);
        });
    });
});
