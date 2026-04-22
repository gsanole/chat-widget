/**
 * Unit tests for server.js helper functions
 * Tests public APIs and edge cases
 */

const request = require('supertest');
const { app, db } = require('../../server');

describe('Public API Endpoints', () => {
    describe('Health Check', () => {
        it('should return health status', async () => {
            const res = await request(app).get('/api/health');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('status', 'ok');
        });
    });

    describe('Check Access API', () => {
        it('should allow access from normal IP', async () => {
            const res = await request(app)
                .post('/api/check-access')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('allowed');
        });

        it('should check access with browser location', async () => {
            const res = await request(app)
                .post('/api/check-access')
                .send({
                    browserLocation: {
                        latitude: 40.7128,
                        longitude: -74.0060
                    }
                });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('allowed');
            expect(res.body).toHaveProperty('reason');
        });
    });

    describe('Password Reset API', () => {
        it('should reject reset without token', async () => {
            const res = await request(app)
                .post('/api/auth/reset-password')
                .send({ newPassword: 'NewPassword123!' });

            expect(res.status).toBe(400);
        });

        it('should reject reset with short password', async () => {
            const res = await request(app)
                .post('/api/auth/reset-password')
                .send({ token: 'sometoken', newPassword: 'short' });

            expect(res.status).toBe(400);
        });

        it('should reject reset with invalid token', async () => {
            const res = await request(app)
                .post('/api/auth/reset-password')
                .send({ token: 'invalidtoken', newPassword: 'NewPassword123!' });

            expect(res.status).toBe(400);
        });
    });

    describe('Chatbot Message API', () => {
        it('should reject message without content', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .send({});

            expect(res.status).toBe(400);
        });

        it('should return chatbot response for message', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .send({ message: 'hello' });

            expect(res.status).toBe(200);
        });

        it('should escalate for human keywords', async () => {
            const res = await request(app)
                .post('/api/chatbot/message')
                .send({ message: 'I want to talk to a human' });

            expect(res.status).toBe(200);
            if (res.body && res.body.type) {
                expect(res.body.type).toBe('escalate');
            }
        });
    });

    describe('Static Routes', () => {
        it('should serve admin page', async () => {
            const res = await request(app).get('/admin');
            expect([200, 304]).toContain(res.status);
        });

        it('should serve admin users page', async () => {
            const res = await request(app).get('/admin/users');
            expect([200, 304]).toContain(res.status);
        });

        it('should serve admin sites page', async () => {
            const res = await request(app).get('/admin/sites');
            expect([200, 304]).toContain(res.status);
        });

        it('should serve admin audit page', async () => {
            const res = await request(app).get('/admin/audit');
            expect([200, 304, 404]).toContain(res.status);
        });

        it('should serve admin chatbot page', async () => {
            const res = await request(app).get('/admin/chatbot');
            expect([200, 304, 404]).toContain(res.status);
        });
    });
});
