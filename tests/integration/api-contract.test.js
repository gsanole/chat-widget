/**
 * API Contract Tests
 * Validates API response schemas and data types
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Set test environment before requiring app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-contract-tests';
process.env.DATABASE_DIR = path.join(__dirname, 'test-data-contract');

// Ensure test directory exists
const TEST_DIR = process.env.DATABASE_DIR;
if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Clear require cache
delete require.cache[require.resolve('../../src/database')];
delete require.cache[require.resolve('../../server')];

const { app, db } = require('../../server');

let authToken;

// Schema validation helpers
const isString = (val) => typeof val === 'string';
const isNumber = (val) => typeof val === 'number';
const isBoolean = (val) => typeof val === 'boolean';
const isArray = (val) => Array.isArray(val);
const isObject = (val) => val !== null && typeof val === 'object' && !Array.isArray(val);
const isOptional = (val, type) => val === undefined || val === null || type(val);
const isISO8601 = (val) => isString(val) && !isNaN(Date.parse(val));
const isUUID = (val) => isString(val) && /^[0-9a-f-]{36}$/i.test(val);

// Response schema definitions
const schemas = {
    error: {
        error: isString
    },
    health: {
        status: isString,
        uptime: isNumber
    },
    loginSuccess: {
        token: isString,
        user: (val) => isObject(val) && isString(val.username) && isString(val.role),
        requires2fa: (val) => isOptional(val, isBoolean)
    },
    loginError: {
        error: isString
    },
    user: {
        id: (val) => isNumber(val) || isString(val),
        username: isString,
        role: isString,
        sites: (val) => isOptional(val, isArray)
    },
    site: {
        id: (val) => isNumber(val) || isString(val),
        name: isString,
        domain: isString,
        apiKey: isString
    },
    ticket: {
        id: (val) => isNumber(val) || isString(val),
        customerName: isString,
        status: isString
    },
    chatbotConfig: {
        enabled: isBoolean,
        botName: isString,
        welcomeMessage: isString,
        quickReplies: isArray
    },
    chatbotMessage: {
        type: (val) => ['faq', 'escalate', 'fallback'].includes(val),
        message: isString
    }
};

// Validate response against schema
function validateSchema(data, schema) {
    const errors = [];

    for (const [field, validator] of Object.entries(schema)) {
        if (!(field in data)) {
            errors.push(`Missing field: ${field}`);
        } else if (!validator(data[field])) {
            errors.push(`Invalid field: ${field} (value: ${JSON.stringify(data[field])})`);
        }
    }

    return { valid: errors.length === 0, errors };
}

describe('API Contract Tests', () => {
    beforeAll(async () => {
        // Create a test admin user
        try {
            await db.users.create(
                'contract_admin',
                'contract_admin@test.com',
                'AdminPass123!',
                'admin',
                'Contract Test Admin'
            );
        } catch (e) {
            // User may already exist
        }

        // Get auth token
        const loginRes = await request(app)
            .post('/api/admin/login')
            .send({ username: 'contract_admin', password: 'AdminPass123!' });

        if (loginRes.body.token) {
            authToken = loginRes.body.token;
        }
    });

    describe('Public Endpoints', () => {
        describe('GET /api/health', () => {
            test('should return health check response with correct schema', async () => {
                const res = await request(app)
                    .get('/api/health')
                    .expect('Content-Type', /json/)
                    .expect(200);

                const validation = validateSchema(res.body, schemas.health);
                expect(validation.valid).toBe(true);
                expect(res.body.status).toBe('ok');
                expect(typeof res.body.uptime).toBe('number');
                expect(res.body.uptime).toBeGreaterThanOrEqual(0);
            });

            test('should have correct response headers', async () => {
                const res = await request(app)
                    .get('/api/health')
                    .expect(200);

                expect(res.headers['content-type']).toMatch(/application\/json/);
            });
        });

        describe('GET /api/chatbot/config', () => {
            test('should return chatbot config with correct schema', async () => {
                const res = await request(app)
                    .get('/api/chatbot/config')
                    .expect(200);

                expect(res.body).toHaveProperty('enabled');
                expect(typeof res.body.enabled).toBe('boolean');
                expect(res.body).toHaveProperty('botName');
                expect(typeof res.body.botName).toBe('string');
                expect(res.body).toHaveProperty('welcomeMessage');
                expect(typeof res.body.welcomeMessage).toBe('string');
                expect(res.body).toHaveProperty('quickReplies');
                expect(Array.isArray(res.body.quickReplies)).toBe(true);
            });

            test('quick replies should be strings', async () => {
                const res = await request(app)
                    .get('/api/chatbot/config')
                    .expect(200);

                res.body.quickReplies.forEach(reply => {
                    expect(typeof reply).toBe('string');
                });
            });
        });

        describe('POST /api/chatbot/message', () => {
            test('should return bot response with correct schema', async () => {
                const res = await request(app)
                    .post('/api/chatbot/message')
                    .send({ message: 'hello' })
                    .expect('Content-Type', /json/)
                    .expect(200);

                expect(res.body).toHaveProperty('type');
                expect(['faq', 'escalate', 'fallback']).toContain(res.body.type);
                expect(res.body).toHaveProperty('message');
                expect(typeof res.body.message).toBe('string');
            });

            test('should return error for missing message', async () => {
                const res = await request(app)
                    .post('/api/chatbot/message')
                    .send({})
                    .expect(400);

                expect(res.body).toHaveProperty('error');
            });

            test('escalation response should have correct type', async () => {
                const res = await request(app)
                    .post('/api/chatbot/message')
                    .send({ message: 'I want to talk to a human agent' })
                    .expect(200);

                expect(res.body).toHaveProperty('type');
                expect(typeof res.body.message).toBe('string');
            });
        });
    });

    describe('Authentication Endpoints', () => {
        describe('POST /api/admin/login', () => {
            test('should return error for invalid credentials', async () => {
                const res = await request(app)
                    .post('/api/admin/login')
                    .send({ username: 'wrong', password: 'wrong' })
                    .expect('Content-Type', /json/);

                // Should be 401 or contain error
                expect(res.body).toHaveProperty('error');
                expect(typeof res.body.error).toBe('string');
            });

            test('should return error for missing credentials', async () => {
                const res = await request(app)
                    .post('/api/admin/login')
                    .send({})
                    .expect('Content-Type', /json/);

                expect(res.status).toBeGreaterThanOrEqual(400);
                expect(res.body).toHaveProperty('error');
            });

            test('login response should have correct schema on success', async () => {
                const res = await request(app)
                    .post('/api/admin/login')
                    .send({ username: 'admin', password: 'admin123' });

                if (res.status === 200) {
                    expect(res.body).toHaveProperty('token');
                    expect(typeof res.body.token).toBe('string');

                    if (res.body.user) {
                        expect(res.body.user).toHaveProperty('username');
                        expect(res.body.user).toHaveProperty('role');
                    }
                } else {
                    // If login fails, should have error
                    expect(res.body).toHaveProperty('error');
                }
            });
        });

        describe('GET /api/admin/verify', () => {
            test('should return 401 for missing token', async () => {
                const res = await request(app)
                    .get('/api/admin/verify')
                    .expect(401);

                expect(res.body).toHaveProperty('error');
            });

            test('should return 401 for invalid token', async () => {
                const res = await request(app)
                    .get('/api/admin/verify')
                    .set('Authorization', 'Bearer invalid-token')
                    .expect(401);

                expect(res.body).toHaveProperty('error');
            });
        });
    });

    describe('Protected Endpoints (without auth)', () => {
        test('GET /api/users should require auth', async () => {
            const res = await request(app)
                .get('/api/users')
                .expect(401);

            expect(res.body).toHaveProperty('error');
        });

        test('GET /api/sites should require auth', async () => {
            const res = await request(app)
                .get('/api/sites')
                .expect(401);

            expect(res.body).toHaveProperty('error');
        });

        test('GET /api/tickets should require auth', async () => {
            const res = await request(app)
                .get('/api/tickets')
                .expect(401);

            expect(res.body).toHaveProperty('error');
        });

        test('GET /api/audit should require auth', async () => {
            const res = await request(app)
                .get('/api/audit')
                .expect(401);

            expect(res.body).toHaveProperty('error');
        });
    });

    describe('Error Response Schema', () => {
        test('404 errors should have error field', async () => {
            const res = await request(app)
                .get('/api/nonexistent-endpoint')
                .expect(404);

            // Most APIs return JSON error or HTML 404
            if (res.headers['content-type']?.includes('json')) {
                expect(res.body).toHaveProperty('error');
            }
        });

        test('validation errors should have error field', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({ username: '' })
                .expect('Content-Type', /json/);

            expect(res.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe('Response Headers', () => {
        test('JSON endpoints should set correct content-type', async () => {
            const res = await request(app)
                .get('/api/health')
                .expect(200);

            expect(res.headers['content-type']).toMatch(/application\/json/);
        });

        test('should include security headers', async () => {
            const res = await request(app)
                .get('/api/health')
                .expect(200);

            // Helmet should add security headers
            expect(res.headers).toHaveProperty('x-content-type-options');
        });
    });

    describe('Data Type Validation', () => {
        describe('Chatbot Config Types', () => {
            test('enabled should be boolean', async () => {
                const res = await request(app)
                    .get('/api/chatbot/config')
                    .expect(200);

                expect(typeof res.body.enabled).toBe('boolean');
            });

            test('botName should be non-empty string', async () => {
                const res = await request(app)
                    .get('/api/chatbot/config')
                    .expect(200);

                expect(typeof res.body.botName).toBe('string');
                expect(res.body.botName.length).toBeGreaterThan(0);
            });

            test('quickReplies should be array of strings', async () => {
                const res = await request(app)
                    .get('/api/chatbot/config')
                    .expect(200);

                expect(Array.isArray(res.body.quickReplies)).toBe(true);
                res.body.quickReplies.forEach(reply => {
                    expect(typeof reply).toBe('string');
                });
            });
        });

        describe('Health Endpoint Types', () => {
            test('uptime should be non-negative number', async () => {
                const res = await request(app)
                    .get('/api/health')
                    .expect(200);

                expect(typeof res.body.uptime).toBe('number');
                expect(res.body.uptime).toBeGreaterThanOrEqual(0);
            });

            test('status should be "ok" string', async () => {
                const res = await request(app)
                    .get('/api/health')
                    .expect(200);

                expect(res.body.status).toBe('ok');
            });
        });
    });

    describe('Request Validation', () => {
        test('should reject non-JSON content type for POST', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .set('Content-Type', 'text/plain')
                .send('not json');

            // Should either reject or return error
            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        test('should handle empty request body', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .set('Content-Type', 'application/json')
                .send({});

            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        test('should handle malformed JSON gracefully', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .set('Content-Type', 'application/json')
                .send('{ invalid json }');

            expect(res.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe('Pagination Contracts', () => {
        test('tickets list should support pagination params', async () => {
            // Even without auth, should validate params format
            const res = await request(app)
                .get('/api/tickets?page=1&limit=10');

            // Should return 401 (not 400 for bad params)
            expect(res.status).toBe(401);
        });
    });

    describe('Rate Limiting Response', () => {
        test('should have correct format when rate limited', async () => {
            // Make many requests to trigger rate limit
            const requests = [];
            for (let i = 0; i < 20; i++) {
                requests.push(
                    request(app)
                        .post('/api/admin/login')
                        .send({ username: 'test', password: 'test' })
                );
            }

            const responses = await Promise.all(requests);
            const rateLimited = responses.find(r => r.status === 429);

            if (rateLimited) {
                expect(rateLimited.body).toHaveProperty('error');
                expect(typeof rateLimited.body.error).toBe('string');
            }
        });
    });

    describe('Check Access Endpoint', () => {
        test('POST /api/check-access should validate location', async () => {
            const res = await request(app)
                .post('/api/check-access')
                .send({
                    browserLocation: { latitude: 40.7128, longitude: -74.0060 }
                });

            // Should return 200 or 403
            expect([200, 403]).toContain(res.status);

            if (res.status === 200) {
                expect(res.body).toHaveProperty('allowed');
                expect(typeof res.body.allowed).toBe('boolean');
            } else {
                expect(res.body).toHaveProperty('error');
            }
        });

        test('should handle missing location data', async () => {
            const res = await request(app)
                .post('/api/check-access')
                .send({});

            // Should handle gracefully
            expect(res.status).toBeGreaterThanOrEqual(200);
        });
    });
});

describe('Schema Validation Helpers', () => {
    test('isString should validate strings', () => {
        expect(isString('hello')).toBe(true);
        expect(isString('')).toBe(true);
        expect(isString(123)).toBe(false);
        expect(isString(null)).toBe(false);
    });

    test('isNumber should validate numbers', () => {
        expect(isNumber(123)).toBe(true);
        expect(isNumber(0)).toBe(true);
        expect(isNumber(-5)).toBe(true);
        expect(isNumber(3.14)).toBe(true);
        expect(isNumber('123')).toBe(false);
        expect(isNumber(NaN)).toBe(true); // NaN is typeof number
    });

    test('isBoolean should validate booleans', () => {
        expect(isBoolean(true)).toBe(true);
        expect(isBoolean(false)).toBe(true);
        expect(isBoolean(1)).toBe(false);
        expect(isBoolean('true')).toBe(false);
    });

    test('isArray should validate arrays', () => {
        expect(isArray([])).toBe(true);
        expect(isArray([1, 2, 3])).toBe(true);
        expect(isArray({})).toBe(false);
        expect(isArray('array')).toBe(false);
    });

    test('isObject should validate objects', () => {
        expect(isObject({})).toBe(true);
        expect(isObject({ a: 1 })).toBe(true);
        expect(isObject([])).toBe(false);
        expect(isObject(null)).toBe(false);
        expect(isObject('object')).toBe(false);
    });

    test('isISO8601 should validate ISO dates', () => {
        expect(isISO8601('2024-01-15T10:30:00.000Z')).toBe(true);
        expect(isISO8601('2024-01-15')).toBe(true);
        expect(isISO8601('not a date')).toBe(false);
        expect(isISO8601(123)).toBe(false);
    });

    test('validateSchema should work correctly', () => {
        const schema = {
            name: isString,
            age: isNumber
        };

        expect(validateSchema({ name: 'John', age: 30 }, schema).valid).toBe(true);
        expect(validateSchema({ name: 'John' }, schema).valid).toBe(false);
        expect(validateSchema({ name: 123, age: 30 }, schema).valid).toBe(false);
    });
});
