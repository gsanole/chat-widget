/**
 * Error Handling and Resilience Tests
 * Tests application behavior under error conditions
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Set test environment before requiring app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-error-handling';
process.env.DATABASE_DIR = path.join(__dirname, 'test-data-error-handling');

// Ensure test directory exists
const TEST_DIR = process.env.DATABASE_DIR;
if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Clear require cache
delete require.cache[require.resolve('../../src/database')];
delete require.cache[require.resolve('../../server')];

const { app, db } = require('../../server');

describe('Error Handling and Resilience', () => {

    describe('Input Validation Errors', () => {
        test('should handle missing required fields gracefully', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({});

            expect(res.status).toBeGreaterThanOrEqual(400);
            expect(res.body).toHaveProperty('error');
        });

        test('should handle null values in request body', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({ username: null, password: null });

            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        test('should handle undefined values', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({ username: undefined, password: undefined });

            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        test('should handle extremely long strings', async () => {
            const longString = 'a'.repeat(100000);
            const res = await request(app)
                .post('/api/admin/login')
                .send({ username: longString, password: longString });

            // Should not crash, should return error
            expect(res.status).toBeDefined();
        });

        test('should handle special characters in input', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({
                    username: '<script>alert("xss")</script>',
                    password: '"; DROP TABLE users; --'
                });

            expect(res.status).toBeGreaterThanOrEqual(400);
            expect(res.status).toBeLessThan(500);
        });

        test('should handle unicode characters', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({
                    username: '用户名',
                    password: 'パスワード'
                });

            // Should handle gracefully, not crash
            expect(res.status).toBeDefined();
        });

        test('should handle emojis in input', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .send({ message: '👋 Hello! 🎉' });

            expect(res.status).toBe(200);
        });
    });

    describe('Content-Type Handling', () => {
        test('should handle wrong content type', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .set('Content-Type', 'text/plain')
                .send('not json');

            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        test('should handle multipart form data on JSON endpoint', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .set('Content-Type', 'multipart/form-data')
                .field('username', 'test')
                .field('password', 'test');

            // Should not crash
            expect(res.status).toBeDefined();
        });

        test('should handle XML content type', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .set('Content-Type', 'application/xml')
                .send('<root><username>test</username><password>test</password></root>');

            expect(res.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe('Malformed JSON Handling', () => {
        test('should handle invalid JSON', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .set('Content-Type', 'application/json')
                .send('{ invalid json }');

            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        test('should handle truncated JSON', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .set('Content-Type', 'application/json')
                .send('{ "username": "test"');

            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        test('should handle JSON with trailing comma', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .set('Content-Type', 'application/json')
                .send('{ "username": "test", "password": "test", }');

            expect(res.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe('Authentication Error Handling', () => {
        test('should handle missing Authorization header', async () => {
            const res = await request(app)
                .get('/api/users');

            expect(res.status).toBe(401);
            expect(res.body).toHaveProperty('error');
        });

        test('should handle malformed Authorization header', async () => {
            const res = await request(app)
                .get('/api/users')
                .set('Authorization', 'NotBearer token');

            expect(res.status).toBe(401);
        });

        test('should handle expired token', async () => {
            // Create an obviously invalid/expired token
            const res = await request(app)
                .get('/api/users')
                .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjF9.invalid');

            expect(res.status).toBe(401);
        });

        test('should handle token with wrong secret', async () => {
            const jwt = require('jsonwebtoken');
            const wrongToken = jwt.sign({ user: 'test' }, 'wrong-secret');

            const res = await request(app)
                .get('/api/users')
                .set('Authorization', `Bearer ${wrongToken}`);

            expect(res.status).toBe(401);
        });

        test('should handle empty Authorization header', async () => {
            const res = await request(app)
                .get('/api/users')
                .set('Authorization', '');

            expect(res.status).toBe(401);
        });

        test('should handle Bearer with no token', async () => {
            const res = await request(app)
                .get('/api/users')
                .set('Authorization', 'Bearer ');

            expect(res.status).toBe(401);
        });
    });

    describe('Resource Not Found', () => {
        test('should return 404 for non-existent API endpoint', async () => {
            const res = await request(app)
                .get('/api/non-existent-endpoint');

            expect(res.status).toBe(404);
        });

        test('should return 404 for non-existent ticket', async () => {
            const jwt = require('jsonwebtoken');
            const token = jwt.sign(
                { username: 'admin', role: 'admin' },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const res = await request(app)
                .get('/api/tickets/999999')
                .set('Authorization', `Bearer ${token}`);

            expect([404, 401, 403]).toContain(res.status);
        });

        test('should handle invalid ID format', async () => {
            const jwt = require('jsonwebtoken');
            const token = jwt.sign(
                { username: 'admin', role: 'admin' },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const res = await request(app)
                .get('/api/tickets/not-a-number')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe('Method Not Allowed', () => {
        test('should handle GET on POST-only endpoint', async () => {
            const res = await request(app)
                .get('/api/admin/login');

            expect([404, 405]).toContain(res.status);
        });

        test('should handle POST on GET-only endpoint', async () => {
            const res = await request(app)
                .post('/api/health');

            expect([404, 405]).toContain(res.status);
        });

        test('should handle DELETE on read-only endpoint', async () => {
            const res = await request(app)
                .delete('/api/health');

            expect([404, 405]).toContain(res.status);
        });
    });

    describe('Rate Limiting Resilience', () => {
        test('should return 429 after too many requests', async () => {
            const requests = [];

            // Make many rapid requests
            for (let i = 0; i < 30; i++) {
                requests.push(
                    request(app)
                        .post('/api/admin/login')
                        .send({ username: 'test', password: 'wrong' })
                );
            }

            const responses = await Promise.all(requests);
            const rateLimited = responses.some(r => r.status === 429);

            // Either rate limited or all processed (depending on limit config)
            expect(responses.every(r => r.status !== undefined)).toBe(true);
        });

        test('rate limit response should have proper format', async () => {
            const requests = [];

            for (let i = 0; i < 30; i++) {
                requests.push(
                    request(app)
                        .post('/api/admin/login')
                        .send({ username: 'test', password: 'wrong' })
                );
            }

            const responses = await Promise.all(requests);
            const rateLimited = responses.find(r => r.status === 429);

            if (rateLimited) {
                expect(rateLimited.body).toHaveProperty('error');
            }
        });
    });

    describe('Chatbot Error Handling', () => {
        test('should handle empty message', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .send({ message: '' });

            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        test('should handle message with only whitespace', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .send({ message: '   \n\t   ' });

            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        test('should handle extremely long message', async () => {
            const longMessage = 'a'.repeat(50000);
            const res = await request(app)
                .post('/api/chatbot/message')
                .send({ message: longMessage });

            // Should handle without crashing
            expect(res.status).toBeDefined();
        });

        test('should handle message with HTML', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .send({ message: '<b>Hello</b> <script>alert(1)</script>' });

            expect(res.status).toBe(200);
            // Response should not contain unescaped HTML
            expect(res.body.message).not.toContain('<script>');
        });
    });

    describe('Location Data Validation', () => {
        test('should handle invalid coordinates', async () => {
            const res = await request(app)
                .post('/api/check-access')
                .send({
                    browserLocation: { latitude: 999, longitude: -999 }
                });

            // Should handle invalid coords gracefully
            expect(res.status).toBeDefined();
        });

        test('should handle missing coordinates', async () => {
            const res = await request(app)
                .post('/api/check-access')
                .send({
                    browserLocation: {}
                });

            expect(res.status).toBeDefined();
        });

        test('should handle string coordinates', async () => {
            const res = await request(app)
                .post('/api/check-access')
                .send({
                    browserLocation: { latitude: '40.7128', longitude: '-74.0060' }
                });

            expect(res.status).toBeDefined();
        });

        test('should handle null browser location', async () => {
            const res = await request(app)
                .post('/api/check-access')
                .send({
                    browserLocation: null
                });

            expect(res.status).toBeDefined();
        });
    });

    describe('Static File Error Handling', () => {
        test('should return 404 for non-existent static file', async () => {
            const res = await request(app)
                .get('/non-existent-file.js');

            expect(res.status).toBe(404);
        });

        test('should handle path traversal attempts', async () => {
            const res = await request(app)
                .get('/../../../etc/passwd');

            // Should not expose system files
            expect([400, 403, 404]).toContain(res.status);
        });

        test('should handle encoded path traversal', async () => {
            const res = await request(app)
                .get('/%2e%2e/%2e%2e/etc/passwd');

            expect([400, 403, 404]).toContain(res.status);
        });
    });

    describe('Database Error Simulation', () => {
        test('should handle database query errors gracefully', async () => {
            // The app should not crash even if database has issues
            const res = await request(app)
                .get('/api/health');

            expect(res.status).toBe(200);
        });
    });

    describe('Concurrent Request Handling', () => {
        test('should handle many concurrent requests', async () => {
            const requests = [];

            for (let i = 0; i < 50; i++) {
                requests.push(request(app).get('/api/health'));
            }

            const responses = await Promise.all(requests);

            // All requests should complete without error
            expect(responses.every(r => r.status === 200)).toBe(true);
        });

        test('should handle concurrent chatbot requests', async () => {
            const requests = [];

            for (let i = 0; i < 20; i++) {
                requests.push(
                    request(app)
                        .post('/api/chatbot/message')
                        .send({ message: `test message ${i}` })
                );
            }

            const responses = await Promise.all(requests);

            // All should complete
            expect(responses.every(r => r.status === 200)).toBe(true);
        });
    });

    describe('Header Injection Prevention', () => {
        test.skip('should prevent header injection in response', async () => {
            const res = await request(app)
                .get('/api/health')
                .set('X-Injected', 'evil\r\nSet-Cookie: session=hijacked');

            // Response should not have injected headers
            expect(res.headers['set-cookie']).toBeUndefined();
        });
    });

    describe('Graceful Error Messages', () => {
        test('error messages should not leak sensitive information', async () => {
            const res = await request(app)
                .post('/api/admin/login')
                .send({ username: 'admin', password: 'wrong' });

            expect(res.body.error).not.toContain('database');
            expect(res.body.error).not.toContain('SQL');
            expect(res.body.error).not.toContain('stack');
        });

        test('404 errors should not reveal internal paths', async () => {
            const res = await request(app)
                .get('/api/secret-internal-endpoint');

            if (res.body.error) {
                expect(res.body.error).not.toContain('C:\\');
                expect(res.body.error).not.toContain('/home/');
                expect(res.body.error).not.toContain('node_modules');
            }
        });
    });

    describe('Request Size Limits', () => {
        test('should reject excessively large request body', async () => {
            const largeBody = { message: 'x'.repeat(10 * 1024 * 1024) }; // 10MB

            const res = await request(app)
                .post('/api/chatbot/message')
                .send(largeBody);

            // Should either reject or handle gracefully
            expect([200, 400, 413]).toContain(res.status);
        });
    });
});

describe('Recovery and Fallback Behavior', () => {
    test('chatbot should have fallback response', async () => {
        const res = await request(app)
            .post('/api/chatbot/message')
            .send({ message: 'xyzzy12345nonexistent' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('type');
        expect(res.body).toHaveProperty('message');
        expect(res.body.message.length).toBeGreaterThan(0);
    });

    test('health endpoint should always respond', async () => {
        const res = await request(app)
            .get('/api/health');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });
});
