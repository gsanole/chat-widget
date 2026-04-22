/**
 * Configuration Index
 * 
 * Aggregates and exports all configuration modules
 * Single entry point for application configuration
 */

const security = require('./security');
const permissions = require('./permissions');
const cors = require('./cors');
const ticketStatus = require('./ticketStatus');

module.exports = {
    // Security
    JWT_SECRET: security.JWT_SECRET,
    SECURITY_LIMITS: security.SECURITY_LIMITS,
    LOCALHOST_IPS: security.LOCALHOST_IPS,
    isLocalhost: security.isLocalhost,

    // Permissions
    ROLES: permissions.ROLES,
    PERMISSION_TYPES: permissions.PERMISSION_TYPES,
    PERMISSIONS: permissions.PERMISSIONS,
    hasPermission: permissions.hasPermission,
    getPermissionsForRole: permissions.getPermissionsForRole,
    isValidRole: permissions.isValidRole,

    // CORS
    ALLOWED_ORIGINS: cors.ALLOWED_ORIGINS,
    createCorsOptions: cors.createCorsOptions,

    // Ticket Status
    TICKET_STATUS: ticketStatus.TICKET_STATUS,
    STATUS_TRANSITIONS: ticketStatus.STATUS_TRANSITIONS,
    isValidTransition: ticketStatus.isValidTransition,
    isValidStatus: ticketStatus.isValidStatus
};
