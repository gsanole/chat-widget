/**
 * Permissions Configuration
 * 
 * Single Responsibility: Manages role-based permissions
 * Open/Closed: New roles/permissions can be added via configuration
 * Interface Segregation: Provides specific permission checking functions
 */

// Role hierarchy: super_admin > admin > admin_support > support
const ROLES = Object.freeze({
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'admin',
    ADMIN_SUPPORT: 'admin_support',
    SUPPORT: 'support'
});

// Permission types
const PERMISSION_TYPES = Object.freeze({
    MANAGE_USERS: 'manage_users',
    VIEW_AUDIT: 'view_audit',
    MANAGE_TICKETS: 'manage_tickets',
    CHAT: 'chat',
    SETTINGS: 'settings',
    DELETE_TICKETS: 'delete_tickets',
    ARCHIVE_TICKETS: 'archive_tickets',
    CHANGE_STATUS: 'change_status',
    VIEW_TICKETS: 'view_tickets'
});

// Role-to-permissions mapping
const PERMISSIONS = Object.freeze({
    [ROLES.SUPER_ADMIN]: [
        PERMISSION_TYPES.MANAGE_USERS,
        PERMISSION_TYPES.VIEW_AUDIT,
        PERMISSION_TYPES.MANAGE_TICKETS,
        PERMISSION_TYPES.CHAT,
        PERMISSION_TYPES.SETTINGS,
        PERMISSION_TYPES.DELETE_TICKETS,
        PERMISSION_TYPES.ARCHIVE_TICKETS,
        PERMISSION_TYPES.CHANGE_STATUS
    ],
    [ROLES.ADMIN]: [
        PERMISSION_TYPES.MANAGE_TICKETS,
        PERMISSION_TYPES.CHAT,
        PERMISSION_TYPES.VIEW_AUDIT,
        PERMISSION_TYPES.SETTINGS,
        PERMISSION_TYPES.DELETE_TICKETS,
        PERMISSION_TYPES.ARCHIVE_TICKETS,
        PERMISSION_TYPES.CHANGE_STATUS
    ],
    [ROLES.ADMIN_SUPPORT]: [
        PERMISSION_TYPES.MANAGE_TICKETS,
        PERMISSION_TYPES.CHAT,
        PERMISSION_TYPES.VIEW_AUDIT,
        PERMISSION_TYPES.ARCHIVE_TICKETS,
        PERMISSION_TYPES.CHANGE_STATUS
    ],
    [ROLES.SUPPORT]: [
        PERMISSION_TYPES.CHAT,
        PERMISSION_TYPES.VIEW_TICKETS
    ]
});

/**
 * Check if a role has a specific permission
 * @param {string} role - User role
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
function hasPermission(role, permission) {
    return PERMISSIONS[role]?.includes(permission) || false;
}

/**
 * Get all permissions for a role
 * @param {string} role - User role
 * @returns {string[]}
 */
function getPermissionsForRole(role) {
    return PERMISSIONS[role] || [];
}

/**
 * Check if role is valid
 * @param {string} role - Role to validate
 * @returns {boolean}
 */
function isValidRole(role) {
    return Object.values(ROLES).includes(role);
}

module.exports = {
    ROLES,
    PERMISSION_TYPES,
    PERMISSIONS,
    hasPermission,
    getPermissionsForRole,
    isValidRole
};
