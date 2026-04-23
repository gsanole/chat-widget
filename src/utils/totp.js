const crypto = require('crypto');

// ===========================================
// TOTP (Time-based One-Time Password) Implementation
// Compatible with Google Authenticator, Authy, etc.
// ===========================================

const TOTP_CONFIG = {
  digits: 6,
  period: 30, // seconds
  algorithm: 'sha1',
  secretLength: 20 // bytes
};

/**
 * Generate a random TOTP secret
 */
function generateSecret() {
  return crypto.randomBytes(TOTP_CONFIG.secretLength);
}

/**
 * Encode secret to Base32 (for QR codes and authenticator apps)
 */
function encodeBase32(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  let bits = 0;
  let value = 0;

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }

  return result;
}

/**
 * Decode Base32 string to Buffer
 */
function decodeBase32(encoded) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  encoded = encoded.toUpperCase().replace(/\s/g, '');

  let bits = 0;
  let value = 0;
  const result = [];

  for (let i = 0; i < encoded.length; i++) {
    const char = encoded[i];
    const index = alphabet.indexOf(char);
    if (index === -1) continue;

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      result.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(result);
}

// ===========================================
// Encryption-at-rest for TOTP secrets
// ===========================================
//
// When TOTP_ENCRYPTION_KEY is set (any printable string, recommended >=32
// chars), TOTP secrets are stored on disk as:
//   enc:v1:<base64-iv>:<base64-tag>:<base64-ciphertext>
//
// The wrapping key is derived deterministically from the env var with
// scrypt(N=16384,r=8,p=1) so the same env var always unlocks the same
// data. Algorithm: AES-256-GCM (authenticated; tampering -> decrypt fails).
//
// If TOTP_ENCRYPTION_KEY is NOT set we fall back to plaintext base32 (the
// pre-encryption behavior). This keeps the feature opt-in and avoids
// locking anyone out who hasn't configured the env var yet.
//
// If a stored secret is encrypted but no key is configured, decryption
// returns null and verification fails closed (safer than guessing).

const ENC_PREFIX = 'enc:v1:';
const ENC_SCRYPT_SALT = Buffer.from('chatbot-totp-v1', 'utf8');

let _cachedKeyEnv = null;
let _cachedKey = null;
function _deriveKey() {
  const env = process.env.TOTP_ENCRYPTION_KEY;
  if (!env) return null;
  if (env === _cachedKeyEnv && _cachedKey) return _cachedKey;
  _cachedKey = crypto.scryptSync(env, ENC_SCRYPT_SALT, 32);
  _cachedKeyEnv = env;
  return _cachedKey;
}

/**
 * Encrypt a base32 secret string for storage. Returns the original string
 * unchanged when no encryption key is configured, so callers can use this
 * unconditionally.
 */
function encryptSecret(base32) {
  if (typeof base32 !== 'string' || !base32) return base32;
  const key = _deriveKey();
  if (!key) return base32;
  const iv = crypto.randomBytes(12); // GCM standard
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(base32, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX +
    iv.toString('base64') + ':' +
    tag.toString('base64') + ':' +
    ct.toString('base64');
}

/**
 * Decrypt a stored secret. Accepts both encrypted and plaintext input.
 * Returns the plaintext base32 string on success, null if the input is
 * encrypted but cannot be decrypted (missing key or tampered data).
 */
function decryptSecret(stored) {
  if (typeof stored !== 'string') return stored;
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const key = _deriveKey();
  if (!key) return null; // encrypted at rest but no key -> fail closed
  try {
    const parts = stored.slice(ENC_PREFIX.length).split(':');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const ct = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (_err) {
    return null;
  }
}

function isEncryptionEnabled() {
  return !!process.env.TOTP_ENCRYPTION_KEY;
}

/**
 * Normalize a stored TOTP secret into a Buffer, regardless of how it was
 * persisted. Handles:
 *   - Buffer (fresh in-memory after setup)
 *   - base32 string (preferred persistent form)
 *   - "enc:v1:..." encrypted base32 (when TOTP_ENCRYPTION_KEY is set)
 *   - Plain object {type:'Buffer', data:[...]} (legacy: how Node Buffers
 *     JSON-serialize when stored directly in JsonDB)
 *   - Array of bytes
 * Returns null on anything unparseable or undecryptable.
 */
function normalizeSecret(secret) {
  if (!secret) return null;
  if (Buffer.isBuffer(secret)) return secret;
  if (typeof secret === 'string') {
    let s = secret;
    if (s.startsWith(ENC_PREFIX)) {
      s = decryptSecret(s);
      if (!s) return null;
    }
    const buf = decodeBase32(s);
    return buf && buf.length ? buf : null;
  }
  if (Array.isArray(secret)) return Buffer.from(secret);
  if (typeof secret === 'object' && Array.isArray(secret.data)) {
    return Buffer.from(secret.data);
  }
  return null;
}

/**
 * Generate TOTP code for a given secret and time
 */
function generateTOTP(secret, time = null) {
  if (!secret) return '';
  const secretBuffer = normalizeSecret(secret);
  if (!secretBuffer || secretBuffer.length === 0) return '';
  let counter = Math.floor((time || Date.now() / 1000) / TOTP_CONFIG.period);

  // Convert counter to 8-byte buffer (big-endian)
  const counterBuffer = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    counterBuffer[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }

  // Generate HMAC
  const hmac = crypto.createHmac(TOTP_CONFIG.algorithm, secretBuffer);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  // Dynamic truncation
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, TOTP_CONFIG.digits);
  return otp.toString().padStart(TOTP_CONFIG.digits, '0');
}

/**
 * Verify a TOTP code (allows 2 periods drift for clock skew, ~±60s)
 */
function verifyTOTP(secret, code, window = 2) {
  if (!secret || !code) return false;
  const now = Date.now() / 1000;

  for (let i = -window; i <= window; i++) {
    const time = now + (i * TOTP_CONFIG.period);
    const expectedCode = generateTOTP(secret, time);

    if (code === expectedCode) {
      return true;
    }
  }

  return false;
}

/**
 * Generate TOTP URI for QR code (otpauth:// format)
 */
function generateTOTPUri(secret, accountName, issuer = 'ChatSupport') {
  let secretBase32;
  if (typeof secret === 'string') secretBase32 = secret;
  else if (Buffer.isBuffer(secret)) secretBase32 = encodeBase32(secret);
  else {
    const buf = normalizeSecret(secret);
    secretBase32 = buf ? encodeBase32(buf) : '';
  }
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedAccount = encodeURIComponent(accountName);

  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secretBase32}&issuer=${encodedIssuer}&algorithm=${TOTP_CONFIG.algorithm.toUpperCase()}&digits=${TOTP_CONFIG.digits}&period=${TOTP_CONFIG.period}`;
}

/**
 * Generate recovery codes
 */
function generateRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    // Generate 8-character codes in format XXXX-XXXX
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

/**
 * Verify a recovery code and remove it from the list
 */
function verifyRecoveryCode(codes, inputCode) {
  const normalizedInput = inputCode.toUpperCase().replace(/[^A-Z0-9]/g, '');

  for (let i = 0; i < codes.length; i++) {
    const normalizedCode = codes[i].replace(/[^A-Z0-9]/g, '');
    if (normalizedInput === normalizedCode) {
      // Remove used code
      codes.splice(i, 1);
      return { valid: true, remainingCodes: codes };
    }
  }

  return { valid: false, remainingCodes: codes };
}

/**
 * Generate QR code as data URL (simple ASCII for console, or use qrcode library)
 */
async function generateQRCodeDataURL(uri) {
  try {
    const QRCode = require('qrcode');
    return await QRCode.toDataURL(uri, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      width: 256,
      margin: 2
    });
  } catch (err) {
    // qrcode package not available, return the URI instead
    console.warn('QR code generation unavailable. Install qrcode package for QR support.');
    return null;
  }
}

// ===========================================
// EXPORTS
// ===========================================

module.exports = {
  generateSecret,
  encodeBase32,
  decodeBase32,
  normalizeSecret,
  encryptSecret,
  decryptSecret,
  isEncryptionEnabled,
  generateTOTP,
  verifyTOTP,
  generateTOTPUri,
  generateOTPAuthURL: generateTOTPUri,
  generateRecoveryCodes,
  verifyRecoveryCode,
  generateQRCodeDataURL,
  config: TOTP_CONFIG
};
