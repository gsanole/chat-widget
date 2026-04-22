/**
 * Socket.IO Event Name Constants
 *
 * Single source of truth for every socket event string used between
 * server and clients (admin panel + customer widget). Keeping these
 * in one place prevents desync bugs (e.g. server listening for
 * `admin:token-auth` while the client emits `admin:auth-token`).
 *
 * Convention: `<scope>:<action>` — kebab-case actions.
 */

// ---------------------------------------------------------------------------
// INBOUND  (client -> server)  — register with socket.on(...)
// ---------------------------------------------------------------------------
const IN = Object.freeze({
    // Admin auth
    ADMIN_AUTH: 'admin:auth',
    ADMIN_SUBMIT_2FA: 'admin:submit-2fa',
    ADMIN_TOKEN_AUTH: 'admin:token-auth',
    ADMIN_AUTH_TOKEN: 'admin:auth-token',   // alias emitted by widget/admin.html
    ADMIN_LOGOUT: 'admin:logout',

    // Admin chat management
    ADMIN_JOIN_CHAT: 'admin:join-chat',
    ADMIN_LEAVE_CHAT: 'admin:leave-chat',
    ADMIN_MESSAGE: 'admin:message',
    ADMIN_TYPING: 'admin:typing',
    ADMIN_MARK_READ: 'admin:mark-read',

    // Admin session management
    ADMIN_CLOSE_SESSION: 'admin:close-session',
    ADMIN_ARCHIVE_SESSION: 'admin:archive-session',
    ADMIN_UNARCHIVE_SESSION: 'admin:unarchive-session',
    ADMIN_DELETE_SESSION: 'admin:delete-session',
    ADMIN_RESOLVE_SESSION: 'admin:resolve-session',
    ADMIN_REOPEN_SESSION: 'admin:reopen-session',
    ADMIN_CHANGE_STATUS: 'admin:change-status',

    // Customer session lifecycle
    SESSION_START: 'session:start',
    SESSION_RESUME: 'session:resume',
    SESSION_END: 'session:end',

    // Customer chat
    CHAT_MESSAGE: 'chat:message',
    CHAT_TYPING: 'chat:typing',

    // Built-in
    DISCONNECT: 'disconnect'
});

// ---------------------------------------------------------------------------
// OUTBOUND  (server -> client)  — emit with socket.emit(...) / io.to(...).emit(...)
// ---------------------------------------------------------------------------
const OUT = Object.freeze({
    // Generic
    ERROR: 'error',

    // Admin auth responses
    ADMIN_SESSIONS: 'admin:sessions',
    ADMIN_AUTHENTICATED: 'admin:authenticated',
    ADMIN_AUTH_FAILED: 'admin:auth-failed',
    ADMIN_REQUIRES_2FA: 'admin:requires-2fa',
    ADMIN_LOGGED_OUT: 'admin:logged-out',
    ADMIN_JOINED: 'admin:joined',
    ADMIN_TYPING: 'admin:typing',

    // Chat
    CHAT_HISTORY: 'chat:history',
    CHAT_MESSAGE: 'chat:message',
    CHAT_MESSAGE_SENT: 'chat:message-sent',
    CUSTOMER_TYPING: 'customer:typing',

    // Customer session lifecycle responses
    SESSION_STARTED: 'session:started',
    SESSION_RESUMED: 'session:resumed',
    SESSION_NOT_FOUND: 'session:not-found',
    SESSION_ENDED: 'session:ended',
    SESSION_CLOSED_BY_ADMIN: 'session:closed-by-admin',

    // Admin broadcast events (session list updates)
    SESSION_NEW: 'session:new',
    SESSION_NEW_MESSAGE: 'session:new-message',
    SESSION_UPDATED: 'session:updated',
    SESSION_REMOVED: 'session:removed'
});

module.exports = { IN, OUT };
