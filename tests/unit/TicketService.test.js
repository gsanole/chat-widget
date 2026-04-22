/**
 * Unit tests for TicketService.
 */

const { TicketService } = require('../../src/services/TicketService');
const { TICKET_STATUS } = require('../../src/config/ticketStatus');

function makeRepos() {
    return {
        ticketRepository: {
            create: jest.fn(t => ({ ...t })),
            findById: jest.fn(),
            findAll: jest.fn(() => []),
            findOpen: jest.fn(() => []),
            updateStatus: jest.fn((id, s) => ({ id, status: s })),
            updateAssignee: jest.fn((id, a) => ({ id, assigned_to: a })),
            delete: jest.fn(() => true),
            getStats: jest.fn(() => ({ total: 0 })),
            cleanupOldResolved: jest.fn(() => 7)
        },
        messageRepository: {
            findByTicket: jest.fn(() => []),
            findRecent: jest.fn(() => []),
            create: jest.fn(m => ({ ...m, id: 'm1' }))
        },
        auditRepository: { log: jest.fn() }
    };
}

describe('TicketService', () => {
    let repos, svc, user;

    beforeEach(() => {
        repos = makeRepos();
        svc = new TicketService(repos);
        user = { userId: 'u1', username: 'alice' };
    });

    test('create delegates to repository', async () => {
        const r = await svc.create({ id: 't1', customerName: 'C' });
        expect(repos.ticketRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({ id: 't1', customerName: 'C' })
        );
        expect(r.id).toBe('t1');
    });

    describe('getById', () => {
        test('returns null when ticket missing', () => {
            repos.ticketRepository.findById.mockReturnValue(null);
            expect(svc.getById('nope')).toBeNull();
        });

        test('returns ticket merged with messages', () => {
            repos.ticketRepository.findById.mockReturnValue({ id: 't1', status: 'open' });
            repos.messageRepository.findByTicket.mockReturnValue([{ id: 'm1' }]);
            const r = svc.getById('t1');
            expect(r).toEqual({ id: 't1', status: 'open', messages: [{ id: 'm1' }] });
        });
    });

    describe('getAll', () => {
        const sample = [
            { id: '1', status: 'open', site_id: 'sA', assigned_to: 'u1' },
            { id: '2', status: 'closed', site_id: 'sB', assigned_to: 'u2' },
            { id: '3', status: 'open', site_id: 'sA', assigned_to: 'u2' }
        ];

        test('no filter returns everything', () => {
            repos.ticketRepository.findAll.mockReturnValue(sample);
            expect(svc.getAll()).toHaveLength(3);
        });

        test('filters by status', () => {
            repos.ticketRepository.findAll.mockReturnValue(sample);
            expect(svc.getAll({ status: 'open' })).toHaveLength(2);
        });

        test('filters by siteId', () => {
            repos.ticketRepository.findAll.mockReturnValue(sample);
            expect(svc.getAll({ siteId: 'sB' })).toHaveLength(1);
        });

        test('filters by assignedTo', () => {
            repos.ticketRepository.findAll.mockReturnValue(sample);
            expect(svc.getAll({ assignedTo: 'u2' })).toHaveLength(2);
        });

        test('combines filters', () => {
            repos.ticketRepository.findAll.mockReturnValue(sample);
            expect(svc.getAll({ status: 'open', siteId: 'sA', assignedTo: 'u2' }))
                .toHaveLength(1);
        });
    });

    test('getOpen delegates to repository', () => {
        svc.getOpen();
        expect(repos.ticketRepository.findOpen).toHaveBeenCalled();
    });

    describe('updateStatus', () => {
        test('rejects an invalid status', () => {
            const r = svc.updateStatus('t1', 'bogus', user);
            expect(r).toEqual({ success: false, error: 'Invalid status' });
        });

        test('rejects when ticket missing', () => {
            repos.ticketRepository.findById.mockReturnValue(null);
            const r = svc.updateStatus('t1', TICKET_STATUS.OPEN, user);
            expect(r).toEqual({ success: false, error: 'Ticket not found' });
        });

        test('rejects an invalid transition', () => {
            repos.ticketRepository.findById.mockReturnValue({ id: 't1', status: TICKET_STATUS.NEW });
            const r = svc.updateStatus('t1', TICKET_STATUS.RESOLVED, user);
            expect(r.success).toBe(false);
            expect(r.error).toMatch(/Cannot change status/);
        });

        test('applies a valid transition and audits', () => {
            repos.ticketRepository.findById.mockReturnValue({ id: 't1', status: TICKET_STATUS.OPEN });
            const r = svc.updateStatus('t1', TICKET_STATUS.RESOLVED, user, { ip: '1.1.1.1' });
            expect(r.success).toBe(true);
            expect(repos.ticketRepository.updateStatus)
                .toHaveBeenCalledWith('t1', TICKET_STATUS.RESOLVED);
            expect(repos.auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({
                action: 'ticket_status_change'
            }));
        });
    });

    describe('assignTo', () => {
        test('rejects when ticket missing', () => {
            repos.ticketRepository.findById.mockReturnValue(null);
            const r = svc.assignTo('t1', 'u2', user);
            expect(r.success).toBe(false);
        });

        test('updates assignee and audits on success', () => {
            repos.ticketRepository.findById.mockReturnValue({ id: 't1' });
            const r = svc.assignTo('t1', 'u2', user);
            expect(r.success).toBe(true);
            expect(repos.ticketRepository.updateAssignee).toHaveBeenCalledWith('t1', 'u2');
            expect(repos.auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({
                action: 'ticket_assigned'
            }));
        });
    });

    describe('addMessage', () => {
        test('rejects when ticket missing', () => {
            repos.ticketRepository.findById.mockReturnValue(null);
            expect(svc.addMessage('t1', { message: 'hi' })).toEqual({
                success: false, error: 'Ticket not found'
            });
        });

        test('persists message on success', () => {
            repos.ticketRepository.findById.mockReturnValue({ id: 't1' });
            const r = svc.addMessage('t1', { sender: 'admin', message: 'hi' });
            expect(r.success).toBe(true);
            expect(repos.messageRepository.create).toHaveBeenCalledWith(expect.objectContaining({
                ticketId: 't1', sender: 'admin', message: 'hi'
            }));
        });
    });

    test('getMessages delegates with default limit', () => {
        svc.getMessages('t1');
        expect(repos.messageRepository.findRecent).toHaveBeenCalledWith('t1', 50);
    });

    test('getMessages respects custom limit', () => {
        svc.getMessages('t1', 10);
        expect(repos.messageRepository.findRecent).toHaveBeenCalledWith('t1', 10);
    });

    describe('delete', () => {
        test('rejects when ticket missing', () => {
            repos.ticketRepository.findById.mockReturnValue(null);
            expect(svc.delete('t1', user)).toEqual({
                success: false, error: 'Ticket not found'
            });
        });

        test('deletes and audits on success', () => {
            repos.ticketRepository.findById.mockReturnValue({ id: 't1', customer_name: 'C' });
            const r = svc.delete('t1', user, { ip: 'i' });
            expect(r).toEqual({ success: true });
            expect(repos.auditRepository.log).toHaveBeenCalledWith(expect.objectContaining({
                action: 'ticket_deleted'
            }));
        });
    });

    describe('archive', () => {
        test('moves to CLOSED when transition is valid', () => {
            repos.ticketRepository.findById.mockReturnValue({ id: 't1', status: TICKET_STATUS.OPEN });
            const r = svc.archive('t1', user);
            expect(r.success).toBe(true);
            expect(repos.ticketRepository.updateStatus)
                .toHaveBeenCalledWith('t1', TICKET_STATUS.CLOSED);
        });
    });

    test('getStats delegates to repository', () => {
        expect(svc.getStats()).toEqual({ total: 0 });
    });

    test('cleanupOld passes daysOld through', () => {
        expect(svc.cleanupOld(30)).toBe(7);
        expect(repos.ticketRepository.cleanupOldResolved).toHaveBeenCalledWith(30);
    });

    test('cleanupOld defaults to 15 days', () => {
        svc.cleanupOld();
        expect(repos.ticketRepository.cleanupOldResolved).toHaveBeenCalledWith(15);
    });
});
