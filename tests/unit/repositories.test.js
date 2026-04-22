/**
 * Unit tests for the repository layer.
 *
 * Uses a minimal in-memory fake that implements the JsonDB interface
 * (insert/find/filter/update/delete/count/getAll/save/data) so we can
 * exercise repositories without touching disk.
 */

const { BaseRepository, generateId, generateToken, now } = require('../../src/database/repositories/BaseRepository');
const { MessageRepository } = require('../../src/database/repositories/MessageRepository');
const { SessionRepository } = require('../../src/database/repositories/SessionRepository');
const { TicketRepository } = require('../../src/database/repositories/TicketRepository');

function makeFakeDb(initial = []) {
    return {
        data: [...initial],
        insert(rec) { this.data.push(rec); return rec; },
        find(p) { return this.data.find(p); },
        filter(p) { return this.data.filter(p); },
        update(p, updates) {
            const item = this.data.find(p);
            if (item) { Object.assign(item, updates); return item; }
            return null;
        },
        delete(p) {
            const before = this.data.length;
            this.data = this.data.filter(x => !p(x));
            return this.data.length !== before;
        },
        count(p) { return p ? this.data.filter(p).length : this.data.length; },
        getAll() { return [...this.data]; },
        save: jest.fn()
    };
}

describe('BaseRepository helpers', () => {
    test('generateId returns a UUID-shaped string', () => {
        const id = generateId();
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(generateId()).not.toBe(id);
    });

    test('generateToken returns 64-char hex', () => {
        const tok = generateToken();
        expect(tok).toMatch(/^[0-9a-f]{64}$/);
    });

    test('now returns integer seconds', () => {
        const n = now();
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThan(1_700_000_000);
    });

    test('findById/findAll/count/deleteById', () => {
        const db = makeFakeDb([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
        const repo = new BaseRepository(db);
        expect(repo.findById('b')).toEqual({ id: 'b' });
        expect(repo.findAll()).toHaveLength(3);
        expect(repo.count()).toBe(3);
        expect(repo.count(x => x.id === 'a')).toBe(1);
        expect(repo.deleteById('a')).toBe(true);
        expect(repo.findById('a')).toBeUndefined();
    });
});

describe('MessageRepository', () => {
    test('create inserts message and updates parent ticket', () => {
        const db = makeFakeDb();
        const tickets = makeFakeDb([{ id: 't1', last_message_at: 0 }]);
        const repo = new MessageRepository(db, tickets);
        const msg = repo.create({
            ticketId: 't1', senderType: 'user', senderId: 'u1',
            senderName: 'User', content: 'hi'
        });
        expect(msg.id).toBeDefined();
        expect(db.data).toHaveLength(1);
        expect(tickets.data[0].last_message_at).toBeGreaterThan(0);
    });

    test('create works without tickets db (no cascade update)', () => {
        const db = makeFakeDb();
        const repo = new MessageRepository(db);
        const msg = repo.create({
            ticketId: 't1', senderType: 'user', senderId: 'u', senderName: 'n', content: 'c'
        });
        expect(msg).toBeDefined();
        expect(db.data).toHaveLength(1);
    });

    test('findByTicket sorts ascending by timestamp', () => {
        const db = makeFakeDb([
            { id: 'm2', ticket_id: 't1', timestamp: 200 },
            { id: 'm1', ticket_id: 't1', timestamp: 100 },
            { id: 'mX', ticket_id: 'tX', timestamp: 50 }
        ]);
        const repo = new MessageRepository(db);
        const out = repo.findByTicket('t1');
        expect(out.map(m => m.id)).toEqual(['m1', 'm2']);
    });

    test('findRecent returns most recent N in ascending order', () => {
        const db = makeFakeDb([
            { id: 'm1', ticket_id: 't1', timestamp: 100 },
            { id: 'm2', ticket_id: 't1', timestamp: 200 },
            { id: 'm3', ticket_id: 't1', timestamp: 300 }
        ]);
        const repo = new MessageRepository(db);
        expect(repo.findRecent('t1', 2).map(m => m.id)).toEqual(['m2', 'm3']);
    });

    test('deleteByTicket and countByTicket', () => {
        const db = makeFakeDb([
            { id: 'm1', ticket_id: 't1' }, { id: 'm2', ticket_id: 't1' }, { id: 'm3', ticket_id: 't2' }
        ]);
        const repo = new MessageRepository(db);
        expect(repo.countByTicket('t1')).toBe(2);
        expect(repo.deleteByTicket('t1')).toBe(true);
        expect(repo.countByTicket('t1')).toBe(0);
    });
});

describe('SessionRepository', () => {
    test('create inserts session with computed timestamps', () => {
        const db = makeFakeDb();
        const repo = new SessionRepository(db);
        const s = repo.create({ userId: 'u1', token: 'tok', ipAddress: '1.1.1.1', userAgent: 'ua' });
        expect(s.user_id).toBe('u1');
        expect(s.token).toBe('tok');
        expect(s.expires_at).toBeGreaterThan(s.created_at);
        expect(db.data).toHaveLength(1);
    });

    test('findByToken returns valid + joins user when usersDb provided', () => {
        const future = now() + 1000;
        const db = makeFakeDb([{ id: 's1', user_id: 'u1', token: 'tok', expires_at: future }]);
        const usersDb = makeFakeDb([{ id: 'u1', username: 'alice', role: 'admin' }]);
        const repo = new SessionRepository(db, usersDb);
        const out = repo.findByToken('tok');
        expect(out.username).toBe('alice');
        expect(out.role).toBe('admin');
    });

    test('findByToken returns session when user not found in usersDb', () => {
        const future = now() + 1000;
        const db = makeFakeDb([{ id: 's1', user_id: 'gone', token: 'tok', expires_at: future }]);
        const usersDb = makeFakeDb([]);
        const repo = new SessionRepository(db, usersDb);
        const out = repo.findByToken('tok');
        expect(out).toBeDefined();
        expect(out.username).toBeUndefined();
    });

    test('findByToken returns null when expired', () => {
        const past = now() - 1000;
        const db = makeFakeDb([{ id: 's1', user_id: 'u', token: 'tok', expires_at: past }]);
        const repo = new SessionRepository(db);
        expect(repo.findByToken('tok')).toBeNull();
    });

    test('findByUser sorts newest first', () => {
        const db = makeFakeDb([
            { id: 's1', user_id: 'u1', created_at: 100 },
            { id: 's2', user_id: 'u1', created_at: 200 },
            { id: 's3', user_id: 'other', created_at: 300 }
        ]);
        const repo = new SessionRepository(db);
        expect(repo.findByUser('u1').map(s => s.id)).toEqual(['s2', 's1']);
    });

    test('updateActivity / delete / deleteByToken / deleteByUser', () => {
        const db = makeFakeDb([
            { id: 's1', user_id: 'u1', token: 'tok', last_activity: 1 }
        ]);
        const repo = new SessionRepository(db);
        expect(repo.updateActivity('tok').last_activity).toBeGreaterThan(1);

        db.data.push({ id: 's2', user_id: 'u1', token: 't2' });
        expect(repo.deleteByToken('t2')).toBe(true);

        db.data.push({ id: 's3', user_id: 'u1' });
        expect(repo.delete('s3')).toBe(true);

        db.data.push({ id: 's4', user_id: 'u1' }, { id: 's5', user_id: 'u1' });
        expect(repo.deleteByUser('u1')).toBe(true);
        expect(db.data.find(s => s.user_id === 'u1')).toBeUndefined();
    });

    test('cleanup removes expired and returns count', () => {
        const db = makeFakeDb([
            { id: 's1', expires_at: now() + 1000 },
            { id: 's2', expires_at: now() - 1000 },
            { id: 's3', expires_at: now() - 5 }
        ]);
        const repo = new SessionRepository(db);
        const removed = repo.cleanup();
        expect(removed).toBe(2);
        expect(db.data.map(s => s.id)).toEqual(['s1']);
        expect(db.save).toHaveBeenCalled();
    });
});

describe('TicketRepository (low-coverage paths)', () => {
    let db, msgs, repo;
    beforeEach(() => {
        db = makeFakeDb();
        msgs = makeFakeDb();
        repo = new TicketRepository(db, msgs);
    });

    test('create with explicit id and minimal fields', () => {
        const t = repo.create({ id: 'fixed-id', customerName: 'C', customerIp: '1.1.1.1' });
        expect(t.id).toBe('fixed-id');
        expect(t.status).toBe('open');
        expect(t.priority).toBe('normal');
    });

    test('findAll/findByStatus/findOpen all sort newest first', () => {
        db.data.push(
            { id: 't1', status: 'open', started_at: 1, last_message_at: 1 },
            { id: 't2', status: 'open', started_at: 3, last_message_at: 3 },
            { id: 't3', status: 'resolved', started_at: 2, last_message_at: 2 }
        );
        expect(repo.findAll().map(t => t.id)).toEqual(['t2', 't3', 't1']);
        expect(repo.findByStatus('open').map(t => t.id)).toEqual(['t2', 't1']);
        expect(repo.findOpen().map(t => t.id)).toEqual(['t2', 't1']);
    });

    test('findByAssignee / findBySite / findBySiteAndStatus', () => {
        db.data.push(
            { id: 't1', assigned_to: 'u1', site_id: 's1', status: 'open', started_at: 1 },
            { id: 't2', assigned_to: 'u1', site_id: 's2', status: 'open', started_at: 2 },
            { id: 't3', assigned_to: 'u2', site_id: 's1', status: 'resolved', started_at: 3 }
        );
        expect(repo.findByAssignee('u1').map(t => t.id)).toEqual(['t2', 't1']);
        expect(repo.findBySite('s1').map(t => t.id)).toEqual(['t3', 't1']);
        expect(repo.findBySiteAndStatus('s1', 'resolved')).toEqual([
            expect.objectContaining({ id: 't3' })
        ]);
    });

    test('updateStatus stamps resolved_at and archived_at', () => {
        db.data.push({ id: 't1', status: 'open' });
        const r1 = repo.updateStatus('t1', 'resolved');
        expect(r1.resolved_at).toBeDefined();
        const r2 = repo.updateStatus('t1', 'archived');
        expect(r2.archived_at).toBeDefined();
    });

    test('updateAssignee/updatePriority/updateLastMessage/updateNotes/updateTags', () => {
        db.data.push({ id: 't1' });
        expect(repo.updateAssignee('t1', 'u9').assigned_to).toBe('u9');
        expect(repo.updatePriority('t1', 'high').priority).toBe('high');
        expect(repo.updateLastMessage('t1').last_message_at).toBeGreaterThan(0);
        expect(repo.updateNotes('t1', 'notes').notes).toBe('notes');
        expect(repo.updateTags('t1', ['a']).tags).toEqual(['a']);
    });

    test('delete cascades to messages', () => {
        db.data.push({ id: 't1' });
        msgs.data.push({ id: 'm1', ticket_id: 't1' }, { id: 'm2', ticket_id: 't2' });
        expect(repo.delete('t1')).toBe(true);
        expect(msgs.data.map(m => m.id)).toEqual(['m2']);
    });

    test('cleanupOldResolved deletes old resolved tickets and their messages', () => {
        const old = now() - (30 * 24 * 60 * 60);
        const recent = now() - 60;
        db.data.push(
            { id: 't1', status: 'resolved', resolved_at: old },
            { id: 't2', status: 'resolved', resolved_at: recent },
            { id: 't3', status: 'open' }
        );
        msgs.data.push({ id: 'm1', ticket_id: 't1' }, { id: 'm2', ticket_id: 't2' });
        const deleted = repo.cleanupOldResolved(15);
        expect(deleted).toBe(1);
        expect(db.data.map(t => t.id)).toEqual(['t2', 't3']);
        expect(msgs.data.map(m => m.id)).toEqual(['m2']);
    });
});
