/**
 * Unit tests for the per-site integration inbound router
 * (src/routes/integrations.js).
 *
 * Covers:
 *   - HMAC verification with the SITE'S secret (not a global one)
 *   - 404 site-missing / 403 disabled / 401 bad signature
 *   - Tenant isolation (cross-site ticket → 403)
 *   - Idempotency on `messageId` via `external_id`
 *   - Loop avoidance: messages saved + emitted directly (no admin handler call)
 *   - Status update evicts in-memory session and broadcasts SESSION_REMOVED
 *   - Health endpoint never leaks the secret and doesn't require auth
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { createIntegrationsRouter } = require('../../src/routes/integrations');
const { OUT } = require('../../src/socket/events');

const SECRET = 'site-shared-secret-1234567890abcdef';

function sign(body) {
    return 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

function build({ siteOverrides = {}, ticket, sessions, repoOverrides = {} } = {}) {
    const site = {
        id: 'site-1',
        integration: {
            enabled: true,
            url: 'https://hub.example.com',
            secret: SECRET,
            events: null
        },
        ...siteOverrides
    };

    const siteRepository = {
        findById: jest.fn(id => (site && site.id === id ? site : null))
    };

    const messageRepository = {
        create: jest.fn(({ ticketId }) => ({ id: 'msg_' + Math.random().toString(36).slice(2), ticket_id: ticketId })),
        findByTicket: jest.fn(() => []),
        db: { update: jest.fn() }
    };

    const ticketRepository = {
        findById: jest.fn(id => (ticket && (ticket.id === id) ? ticket : null)),
        updateLastMessage: jest.fn(),
        updateStatus: jest.fn()
    };

    const auditRepository = { log: jest.fn() };

    const sessMap = sessions || new Map();
    const adminA = { socket: { emit: jest.fn(), id: 'a1' } };
    const adminSockets = new Map([['a1', adminA]]);

    // Minimal io stub: io.to(room).emit
    const roomEmit = jest.fn();
    const io = { to: jest.fn(() => ({ emit: roomEmit })) };

    Object.assign(messageRepository, repoOverrides);

    const app = express();
    app.use(express.json({
        verify: (req, _res, buf) => { req.rawBody = buf; }
    }));
    app.use('/api/integrations', createIntegrationsRouter({
        io,
        messageRepository,
        ticketRepository,
        siteRepository,
        auditRepository,
        getSessions: () => sessMap,
        getAdminSockets: () => adminSockets
    }));

    return {
        app,
        site,
        siteRepository,
        messageRepository,
        ticketRepository,
        auditRepository,
        adminSockets,
        adminA,
        sessMap,
        roomEmit,
        io
    };
}

describe('integrations router — verifySiteHmac', () => {
    test('404 when site does not exist', async () => {
        const { app } = build({ siteOverrides: { id: 'site-other' } });
        const body = JSON.stringify({ sessionId: 't', text: 'hi' });
        const res = await request(app)
            .post('/api/integrations/sites/site-1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        // siteOverrides made site.id = 'site-other', so :siteId='site-1' is missing
        expect(res.status).toBe(404);
    });

    test('403 when integration is disabled', async () => {
        const { app } = build({
            siteOverrides: {
                integration: { enabled: false, url: 'https://x', secret: SECRET }
            }
        });
        const body = JSON.stringify({ sessionId: 't', text: 'hi' });
        const res = await request(app)
            .post('/api/integrations/sites/site-1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(res.status).toBe(403);
    });

    test('403 when integration has no secret', async () => {
        const { app } = build({
            siteOverrides: {
                integration: { enabled: true, url: 'https://x', secret: null }
            }
        });
        const body = JSON.stringify({ sessionId: 't', text: 'hi' });
        const res = await request(app)
            .post('/api/integrations/sites/site-1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', 'sha256=deadbeef')
            .send(body);
        expect(res.status).toBe(403);
    });

    test('401 when signature header is missing', async () => {
        const { app } = build();
        const res = await request(app)
            .post('/api/integrations/sites/site-1/messages')
            .set('content-type', 'application/json')
            .send(JSON.stringify({ sessionId: 't', text: 'hi' }));
        expect(res.status).toBe(401);
    });

    test('401 when signature is invalid', async () => {
        const { app } = build();
        const body = JSON.stringify({ sessionId: 't', text: 'hi' });
        const wrongSig = 'sha256=' + crypto.createHmac('sha256', 'other').update(body).digest('hex');
        const res = await request(app)
            .post('/api/integrations/sites/site-1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', wrongSig)
            .send(body);
        expect(res.status).toBe(401);
    });
});

describe('POST /sites/:siteId/messages', () => {
    test('400 when sessionId or text is missing', async () => {
        const { app } = build({ ticket: { id: 't1', site_id: 'site-1' } });
        const body = JSON.stringify({ sessionId: 't1' });
        const res = await request(app)
            .post('/api/integrations/sites/site-1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(res.status).toBe(400);
    });

    test('404 when ticket does not exist', async () => {
        const { app } = build({ ticket: null });
        const body = JSON.stringify({ sessionId: 't-missing', text: 'hi' });
        const res = await request(app)
            .post('/api/integrations/sites/site-1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(res.status).toBe(404);
    });

    test('403 when ticket belongs to a different site (tenant isolation)', async () => {
        const { app } = build({ ticket: { id: 't1', site_id: 'site-OTHER' } });
        const body = JSON.stringify({ sessionId: 't1', text: 'hi' });
        const res = await request(app)
            .post('/api/integrations/sites/site-1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(res.status).toBe(403);
    });

    test('saves message, emits OUT.CHAT_MESSAGE to chat room, audits', async () => {
        const { app, messageRepository, ticketRepository, io, roomEmit, auditRepository } =
            build({ ticket: { id: 't1', site_id: 'site-1' } });
        const body = JSON.stringify({
            sessionId: 't1',
            text: 'hello from agent',
            senderName: 'Agent X',
            senderId: 'a-99',
            messageId: 'ext-1'
        });
        const res = await request(app)
            .post('/api/integrations/sites/site-1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(messageRepository.create).toHaveBeenCalledWith(expect.objectContaining({
            ticketId: 't1',
            senderType: 'admin',
            senderName: 'Agent X',
            content: 'hello from agent'
        }));
        expect(messageRepository.db.update).toHaveBeenCalled();
        expect(ticketRepository.updateLastMessage).toHaveBeenCalledWith('t1');
        expect(io.to).toHaveBeenCalledWith('chat:t1');
        expect(roomEmit).toHaveBeenCalledWith(OUT.CHAT_MESSAGE, expect.objectContaining({
            ticketId: 't1',
            sender: 'admin',
            source: 'integration'
        }));
        expect(auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({
            action: 'INTEGRATION_MESSAGE_RECEIVED'
        }));
    });

    test('idempotent on messageId: second call returns duplicate:true and does not re-create', async () => {
        const prior = { id: 'msg_X', external_id: 'ext-1' };
        const { app, messageRepository } = build({
            ticket: { id: 't1', site_id: 'site-1' },
            repoOverrides: { findByTicket: jest.fn(() => [prior]) }
        });
        const body = JSON.stringify({ sessionId: 't1', text: 'hi', messageId: 'ext-1' });
        const res = await request(app)
            .post('/api/integrations/sites/site-1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, duplicate: true, id: 'msg_X' });
        expect(messageRepository.create).not.toHaveBeenCalled();
    });

    test('broadcasts SESSION_NEW_MESSAGE when no admin has joined', async () => {
        const sessMap = new Map([['t1', {
            sessionId: 't1', name: 'V', hasAdminJoined: false, unreadCount: 0
        }]]);
        const { app, adminA } = build({
            ticket: { id: 't1', site_id: 'site-1' },
            sessions: sessMap
        });
        const body = JSON.stringify({ sessionId: 't1', text: 'hi' });
        await request(app)
            .post('/api/integrations/sites/site-1/messages')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);

        const events = adminA.socket.emit.mock.calls.map(c => c[0]);
        expect(events).toContain(OUT.SESSION_UPDATED);
        expect(events).toContain(OUT.SESSION_NEW_MESSAGE);
    });
});

describe('POST /sites/:siteId/status', () => {
    test('400 when sessionId/status missing', async () => {
        const { app } = build({ ticket: { id: 't1', site_id: 'site-1' } });
        const body = JSON.stringify({ sessionId: 't1' });
        const res = await request(app)
            .post('/api/integrations/sites/site-1/status')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(res.status).toBe(400);
    });

    test('404 when ticket missing', async () => {
        const { app } = build({ ticket: null });
        const body = JSON.stringify({ sessionId: 't-missing', status: 'resolved' });
        const res = await request(app)
            .post('/api/integrations/sites/site-1/status')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(res.status).toBe(404);
    });

    test('403 cross-site ticket', async () => {
        const { app } = build({ ticket: { id: 't1', site_id: 'OTHER' } });
        const body = JSON.stringify({ sessionId: 't1', status: 'resolved' });
        const res = await request(app)
            .post('/api/integrations/sites/site-1/status')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(res.status).toBe(403);
    });

    test('updates status, evicts in-memory session, disconnects customer, broadcasts SESSION_REMOVED', async () => {
        const customerSocket = { connected: true, emit: jest.fn(), disconnect: jest.fn() };
        const sessMap = new Map([['t1', { sessionId: 't1', socket: customerSocket }]]);
        const { app, adminA, ticketRepository, auditRepository } = build({
            ticket: { id: 't1', site_id: 'site-1' },
            sessions: sessMap
        });
        const body = JSON.stringify({ sessionId: 't1', status: 'resolved' });
        const res = await request(app)
            .post('/api/integrations/sites/site-1/status')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(res.status).toBe(200);
        expect(ticketRepository.updateStatus).toHaveBeenCalledWith('t1', 'resolved');
        expect(customerSocket.emit).toHaveBeenCalledWith(OUT.SESSION_CLOSED_BY_ADMIN, expect.any(Object));
        expect(customerSocket.disconnect).toHaveBeenCalledWith(true);
        expect(sessMap.has('t1')).toBe(false);

        const events = adminA.socket.emit.mock.calls.map(c => c[0]);
        expect(events).toContain(OUT.SESSION_UPDATED);
        expect(events).toContain(OUT.SESSION_REMOVED);

        expect(auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({
            action: 'INTEGRATION_STATUS_CHANGED'
        }));
    });

    test('does not evict session for non-terminal status', async () => {
        const sessMap = new Map([['t1', { sessionId: 't1', socket: null }]]);
        const { app, adminA } = build({
            ticket: { id: 't1', site_id: 'site-1' },
            sessions: sessMap
        });
        const body = JSON.stringify({ sessionId: 't1', status: 'open' });
        await request(app)
            .post('/api/integrations/sites/site-1/status')
            .set('content-type', 'application/json')
            .set('x-chat-signature', sign(body))
            .send(body);
        expect(sessMap.has('t1')).toBe(true);
        const events = adminA.socket.emit.mock.calls.map(c => c[0]);
        expect(events).not.toContain(OUT.SESSION_REMOVED);
    });
});

describe('GET /sites/:siteId/health', () => {
    test('returns ok + integrationEnabled, no auth, no secret leak', async () => {
        const { app } = build();
        const res = await request(app).get('/api/integrations/sites/site-1/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            ok: true,
            siteId: 'site-1',
            integrationEnabled: true
        });
        expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });

    test('reports integrationEnabled=false when not enabled', async () => {
        const { app } = build({
            siteOverrides: {
                integration: { enabled: false, url: 'https://x', secret: SECRET }
            }
        });
        const res = await request(app).get('/api/integrations/sites/site-1/health');
        expect(res.body.integrationEnabled).toBe(false);
    });

    test('404 when site missing', async () => {
        const { app } = build({ siteOverrides: { id: 'site-other' } });
        const res = await request(app).get('/api/integrations/sites/site-1/health');
        expect(res.status).toBe(404);
    });
});
