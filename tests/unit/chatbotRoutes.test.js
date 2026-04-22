/**
 * Unit tests for src/routes/chatbot.js
 */

const request = require('supertest');
const { buildRouterApp } = require('./_routerTestHelper');
const { createChatbotRouter } = require('../../src/routes/chatbot');

function build(svc = {}) {
    const chatbotService = {
        getConfig: jest.fn(() => ({ enabled: true, botName: 'Bot', faq: [{ id: 'f1' }] })),
        saveConfig: jest.fn(() => true),
        processMessage: jest.fn(() => ({ message: 'hi', type: 'fallback' })),
        addFaq: jest.fn(() => 'faq-id'),
        updateFaq: jest.fn(() => true),
        deleteFaq: jest.fn(() => true),
        ...svc
    };
    const auditRepository = { log: jest.fn() };
    const app = buildRouterApp({
        basePath: '/api/chatbot',
        factory: createChatbotRouter,
        deps: { chatbotService, auditRepository }
    });
    return { app, chatbotService, auditRepository };
}

describe('chatbot routes', () => {
    test('GET /config returns sanitized public fields', async () => {
        const { app } = build({ getConfig: () => ({ botName: 'B', enabled: false, secret: 'x', welcomeMessage: 'hi' }) });
        const res = await request(app).get('/api/chatbot/config');
        expect(res.status).toBe(200);
        expect(res.body.botName).toBe('B');
        expect(res.body.enabled).toBe(false);
        expect(res.body.welcomeMessage).toBe('hi');
    });

    test('GET /config defaults when service returns nothing', async () => {
        const { app } = build({ getConfig: () => null });
        const res = await request(app).get('/api/chatbot/config');
        expect(res.body.botName).toBe('Assistant');
        expect(res.body.enabled).toBe(true);
    });

    test('POST /message rejects empty/invalid', async () => {
        const { app } = build();
        const r1 = await request(app).post('/api/chatbot/message').send({});
        expect(r1.status).toBe(400);
        const r2 = await request(app).post('/api/chatbot/message').send({ message: '   ' });
        expect(r2.status).toBe(400);
    });

    test('POST /message returns raw text and renames type escalation->escalate', async () => {
        const { app } = build({
            processMessage: () => ({ message: '<b>"x"&y</b>', type: 'escalation' })
        });
        const res = await request(app).post('/api/chatbot/message').send({ message: 'hi' });
        expect(res.status).toBe(200);
        expect(res.body.type).toBe('escalate');
        // Server returns raw text; clients escape at render time to avoid double-encoding.
        expect(res.body.message).toBe('<b>"x"&y</b>');
    });

    test('POST /message defaults type to fallback', async () => {
        const { app } = build({ processMessage: () => ({ message: 'plain' }) });
        const res = await request(app).post('/api/chatbot/message').send({ message: 'hi' });
        expect(res.body.type).toBe('fallback');
    });

    test('PUT /config 500 when save fails', async () => {
        const { app } = build({ saveConfig: () => false });
        const res = await request(app).put('/api/chatbot/config').send({ enabled: true });
        expect(res.status).toBe(500);
    });

    test('PUT /config success audits', async () => {
        const { app, auditRepository } = build();
        const res = await request(app).put('/api/chatbot/config').send({ enabled: true });
        expect(res.status).toBe(200);
        expect(auditRepository.log).toHaveBeenCalled();
    });

    test('POST /toggle flips enabled and audits', async () => {
        const { app, chatbotService, auditRepository } = build();
        const res = await request(app).post('/api/chatbot/toggle');
        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(false); // was true, now false
        expect(chatbotService.saveConfig).toHaveBeenCalled();
        expect(auditRepository.log).toHaveBeenCalled();
    });

    test('POST /toggle 500 when save fails', async () => {
        const { app } = build({ saveConfig: () => false });
        const res = await request(app).post('/api/chatbot/toggle');
        expect(res.status).toBe(500);
    });

    test('GET /faq returns array', async () => {
        const { app } = build();
        const res = await request(app).get('/api/chatbot/faq');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('POST /faq validates required fields', async () => {
        const { app } = build();
        const r = await request(app).post('/api/chatbot/faq').send({ question: 'q' });
        expect(r.status).toBe(400);
    });

    test('POST /faq success', async () => {
        const { app, chatbotService } = build();
        const res = await request(app).post('/api/chatbot/faq').send({ question: 'q', answer: 'a', keywords: ['k'] });
        expect(res.status).toBe(200);
        expect(chatbotService.addFaq).toHaveBeenCalled();
    });

    test('PATCH /faq/:id passes only provided fields', async () => {
        const { app, chatbotService } = build();
        const res = await request(app).patch('/api/chatbot/faq/f1').send({ answer: 'new' });
        expect(res.status).toBe(200);
        expect(chatbotService.updateFaq).toHaveBeenCalledWith('f1', { answer: 'new' });
    });

    test('PATCH /faq/:id 404 when not found', async () => {
        const { app } = build({ updateFaq: () => false });
        const res = await request(app).patch('/api/chatbot/faq/x').send({ answer: 'a' });
        expect(res.status).toBe(404);
    });

    test('DELETE /faq/:id success', async () => {
        const { app } = build();
        const res = await request(app).delete('/api/chatbot/faq/f1');
        expect(res.status).toBe(200);
    });

    test('DELETE /faq/:id 404', async () => {
        const { app } = build({ deleteFaq: () => false });
        const res = await request(app).delete('/api/chatbot/faq/x');
        expect(res.status).toBe(404);
    });

    test('POST /test requires message', async () => {
        const { app } = build();
        const r = await request(app).post('/api/chatbot/test').send({});
        expect(r.status).toBe(400);
    });

    test('POST /test returns processMessage result', async () => {
        const { app, chatbotService } = build();
        const res = await request(app).post('/api/chatbot/test').send({ message: 'hi', siteId: 's1' });
        expect(res.status).toBe(200);
        expect(chatbotService.processMessage).toHaveBeenCalled();
    });

    test('admin GET /admin/config returns full config', async () => {
        const { app } = build();
        const res = await request(app).get('/api/chatbot/admin/config');
        expect(res.status).toBe(200);
        expect(res.body).toBeDefined();
    });

    test('admin GET /admin/config returns {} when service returns nothing', async () => {
        const { app } = build({ getConfig: () => null });
        const res = await request(app).get('/api/chatbot/admin/config');
        expect(res.body).toEqual({});
    });

    test('admin PUT /admin/config swallows errors', async () => {
        const { app } = build({ saveConfig: () => { throw new Error('x'); } });
        const res = await request(app).put('/api/chatbot/admin/config').send({ a: 1 });
        expect(res.status).toBe(200);
    });

    test('admin POST /admin/faq accepts patterns/response shape', async () => {
        const { app, chatbotService } = build();
        const res = await request(app)
            .post('/api/chatbot/admin/faq')
            .send({ patterns: ['hello', 'hi'], response: 'world' });
        expect(res.status).toBe(200);
        expect(chatbotService.addFaq).toHaveBeenCalled();
    });

    test('admin POST /admin/faq validates required', async () => {
        const { app } = build();
        const res = await request(app).post('/api/chatbot/admin/faq').send({});
        expect(res.status).toBe(400);
    });

    test('admin POST /admin/faq 500 on service throw', async () => {
        const { app } = build({ addFaq: () => { throw new Error('boom'); } });
        const res = await request(app)
            .post('/api/chatbot/admin/faq')
            .send({ question: 'q', answer: 'a' });
        expect(res.status).toBe(500);
    });

    test('admin PUT /admin/faq/:id 404 + 500 paths', async () => {
        const r404 = build({ updateFaq: () => false });
        const a = await request(r404.app).put('/api/chatbot/admin/faq/x').send({ a: 1 });
        expect(a.status).toBe(404);

        const r500 = build({ updateFaq: () => { throw new Error('!'); } });
        const b = await request(r500.app).put('/api/chatbot/admin/faq/x').send({ a: 1 });
        expect(b.status).toBe(500);
    });

    test('admin DELETE /admin/faq/:id 404 + 500 paths', async () => {
        const r404 = build({ deleteFaq: () => false });
        expect((await request(r404.app).delete('/api/chatbot/admin/faq/x')).status).toBe(404);

        const r500 = build({ deleteFaq: () => { throw new Error('!'); } });
        expect((await request(r500.app).delete('/api/chatbot/admin/faq/x')).status).toBe(500);
    });
});
