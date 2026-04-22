/**
 * Jest Test Setup
 * Configures test environment and global utilities
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
// Each test file (worker) gets its own DATABASE_DIR to avoid cross-file
// races on the shared filesystem (Jest runs files in parallel workers, but
// they all share the same disk).
process.env.DATABASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbot-test-'));

// Test data directory
const TEST_DATA_DIR = process.env.DATABASE_DIR;

// Create test data directory
beforeAll(() => {
    if (!fs.existsSync(TEST_DATA_DIR)) {
        fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    }
});

// Clean up test data after all tests
afterAll(() => {
    // Clean up test data files
    try {
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
        }
    } catch (_) { /* ignore */ }
});

// Global test utilities
global.testUtils = {
    generateTestUser: (overrides = {}) => ({
        username: `testuser_${Date.now()}`,
        email: `test_${Date.now()}@example.com`,
        password: 'TestPassword123!',
        role: 'support',
        ...overrides
    }),

    generateTestTicket: (overrides = {}) => ({
        sessionId: `session_${Date.now()}`,
        customerName: 'Test Customer',
        customerContact: { type: 'email', value: 'customer@test.com' },
        ipAddress: '127.0.0.1',
        ...overrides
    }),

    wait: (ms) => new Promise(resolve => setTimeout(resolve, ms))
};

// Suppress console output during tests (optional - comment out for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };
