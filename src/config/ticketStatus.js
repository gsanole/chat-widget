/**
 * Ticket Status Configuration
 * 
 * Single Responsibility: Manages ticket lifecycle states
 */

const TICKET_STATUS = Object.freeze({
    NEW: 'new',
    OPEN: 'open',
    IN_PROGRESS: 'in_progress',
    WAITING: 'waiting_on_customer',
    RESOLVED: 'resolved',
    CLOSED: 'closed'
});

// Valid status transitions
const STATUS_TRANSITIONS = Object.freeze({
    [TICKET_STATUS.NEW]: [TICKET_STATUS.OPEN, TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.CLOSED],
    [TICKET_STATUS.OPEN]: [TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.WAITING, TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED],
    [TICKET_STATUS.IN_PROGRESS]: [TICKET_STATUS.WAITING, TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED],
    [TICKET_STATUS.WAITING]: [TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED],
    [TICKET_STATUS.RESOLVED]: [TICKET_STATUS.CLOSED, TICKET_STATUS.OPEN],
    [TICKET_STATUS.CLOSED]: [TICKET_STATUS.OPEN]
});

/**
 * Check if a status transition is valid
 * @param {string} fromStatus - Current status
 * @param {string} toStatus - Target status
 * @returns {boolean}
 */
function isValidTransition(fromStatus, toStatus) {
    const allowedTransitions = STATUS_TRANSITIONS[fromStatus];
    return allowedTransitions?.includes(toStatus) || false;
}

/**
 * Check if status is valid
 * @param {string} status - Status to validate
 * @returns {boolean}
 */
function isValidStatus(status) {
    return Object.values(TICKET_STATUS).includes(status);
}

module.exports = {
    TICKET_STATUS,
    STATUS_TRANSITIONS,
    isValidTransition,
    isValidStatus
};
