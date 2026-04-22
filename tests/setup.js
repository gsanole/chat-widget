/**
 * Jest Test Setup
 * Configures test environment and global utilities
 */

const path = require('path');
const fs = require('fs');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
process.env.DATABASE_DIR = path.join(__dirname, 'test-data');

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
    if (fs.existsSync(TEST_DATA_DIR)) {
        const files = fs.readdirSync(TEST_DATA_DIR);
        files.forEach(file => {
            fs.unlinkSync(path.join(TEST_DATA_DIR, file));
        });
        fs.rmdirSync(TEST_DATA_DIR);
    }
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
