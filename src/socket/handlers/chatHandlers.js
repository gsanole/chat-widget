/**
 * Chat Socket Handlers
 * 
 * Single Responsibility: Real-time chat messages via Socket.IO
 */

const { sanitizeMessage } = require('../../middleware/validation');
const { OUT } = require('../events');

/**
 * Create chat socket handlers
 * @param {Object} deps - Dependencies
 * @param {Object} deps.io - Socket.IO server instance
 * @param {Object} deps.messageRepository - Message repository
 * @param {Object} deps.ticketRepository - Ticket repository
 * @param {Map} deps.adminSockets - Admin sockets map
 * @param {Map} deps.sessions - Customer sessions map
 * @param {Function} deps.getRealIP - IP extraction function
 * @param {Function} deps.hasPermission - Permission checker
 * @returns {Object} Handler functions
 */
function createChatHandlers({
    io,
    messageRepository,
    ticketRepository,
    adminSockets,
    sessions,
    getRealIP,
    hasPermission,
    chatbotService,
    webhook
}) {

    /** Fire-and-forget per-site mirror. Never throws. */
    function mirrorToSite(siteId, payload) {
        if (!siteId || !webhook) return;
        if (typeof webhook.mirror === 'function') {
            webhook.mirror(siteId, payload);
        } else {
            Promise.resolve().then(() => webhook.send(siteId, payload)).catch(() => {});
        }
    }

    /**
     * Resolve the siteId for a given session/ticket. Sessions in memory
     * carry it directly; for messages on a re-loaded ticket we fall back
     * to the ticket row.
     */
    function resolveSiteId(session, ticketId) {
        if (session?.siteId) return session.siteId;
        const ticket = ticketRepository.findById(ticketId);
        return ticket?.site_id || null;
    }

    /**
     * Broadcast message to all admins
     * @param {string} event - Event name
     * @param {Object} data - Event data
     */
    function broadcastToAdmins(event, data) {
        for (const { socket } of adminSockets.values()) {
            socket.emit(event, data);
        }
    }

    /**
     * Convert a stored message row (snake_case + seconds timestamp) into the
     * live event shape used over Socket.IO (camelCase + ms timestamp).
     */
    function toLiveMessage(row) {
        if (!row) return row;
        const ts = typeof row.timestamp === 'number'
            ? (row.timestamp < 1e12 ? row.timestamp * 1000 : row.timestamp)
            : Date.now();
        return {
            id: row.id,
            ticketId: row.ticket_id || row.ticketId,
            sender: row.sender_type || row.sender,
            senderId: row.sender_id || row.senderId,
            senderName: row.sender_name || row.senderName,
            message: row.content != null ? row.content : row.message,
            timestamp: ts
        };
    }

    /**
     * Handle admin joining a chat
     * @param {Object} socket - Admin socket
     * @param {string} sessionId - Customer session ID
     */
    function handleAdminJoin(socket, sessionId) {
        if (!socket.isAdmin) {
            socket.emit(OUT.ERROR, { message: 'Unauthorized' });
            return;
        }

        const session = sessions.get(sessionId);
        if (session) {
            socket.join(`chat:${sessionId}`);
            session.hasAdminJoined = true;
            session.unreadCount = 0;

            // Notify customer
            if (session.socket && session.socket.connected) {
                session.socket.emit(OUT.ADMIN_JOINED, {
                    adminNickname: socket.adminUser?.nickname || 'Support'
                });
            }

            // Send chat history
            const messages = messageRepository.findByTicket(sessionId, 100).map(toLiveMessage);
            socket.emit(OUT.CHAT_HISTORY, { sessionId, messages });

            broadcastToAdmins(OUT.SESSION_UPDATED, {
                sessionId,
                updates: { hasAdminJoined: true, unreadCount: 0 }
            });
        } else {
            // Try to load from database
            const ticket = ticketRepository.findById(sessionId);
            if (ticket) {
                socket.join(`chat:${sessionId}`);
                const messages = messageRepository.findByTicket(sessionId, 100).map(toLiveMessage);
                socket.emit(OUT.CHAT_HISTORY, { sessionId, messages });
            } else {
                socket.emit(OUT.ERROR, { message: 'Session not found' });
            }
        }
    }

    /**
     * Handle admin leaving a chat
     * @param {Object} socket - Admin socket
     * @param {string} sessionId - Customer session ID
     */
    function handleAdminLeave(socket, sessionId) {
        if (!socket.isAdmin) return;

        socket.leave(`chat:${sessionId}`);

        const session = sessions.get(sessionId);
        if (session) {
            // Check if any other admin is still in the chat
            const room = io.sockets.adapter.rooms.get(`chat:${sessionId}`);
            const adminStillInChat = room && Array.from(room).some(id => {
                const admin = adminSockets.get(id);
                return admin && admin.socket.id !== socket.id;
            });

            if (!adminStillInChat) {
                session.hasAdminJoined = false;
                broadcastToAdmins(OUT.SESSION_UPDATED, {
                    sessionId,
                    updates: { hasAdminJoined: false }
                });
            }
        }
    }

    /**
     * Handle admin sending a message
     * @param {Object} socket - Admin socket
     * @param {Object} data - Message data
     */
    function handleAdminMessage(socket, data) {
        if (!socket.isAdmin) {
            socket.emit(OUT.ERROR, { message: 'Unauthorized' });
            return;
        }

        const { sessionId, message, ticketId } = data;
        const targetId = sessionId || ticketId;

        if (!targetId || !message) {
            socket.emit(OUT.ERROR, { message: 'Session ID and message are required' });
            return;
        }

        if (!hasPermission(socket.adminUser?.role, 'chat')) {
            socket.emit(OUT.ERROR, { message: 'No permission to reply to chats' });
            return;
        }

        const sanitized = sanitizeMessage(message);
        const timestamp = Date.now();

        const msg = {
            id: require('../../utils').generateId(),
            ticketId: targetId,
            sender: 'admin',
            senderName: socket.adminUser?.nickname || socket.adminUser?.username || 'Admin',
            senderId: socket.adminUser?.id,
            message: sanitized,
            timestamp
        };

        // Save to database (repository expects { ticketId, senderType, senderId, senderName, content })
        messageRepository.create({
            ticketId: targetId,
            senderType: 'admin',
            senderId: msg.senderId,
            senderName: msg.senderName,
            content: sanitized
        });

        // Update ticket activity
        ticketRepository.updateLastMessage(targetId);

        // Send to customer if session is active
        const session = sessions.get(targetId);
        if (session && session.socket && session.socket.connected) {
            session.socket.emit(OUT.CHAT_MESSAGE, msg);
            session.lastActivity = timestamp;
        }

        // Broadcast to all admins in the chat room (excluding the customer socket if it joined the room)
        const room = io.to(`chat:${targetId}`);
        if (session && session.socket && session.socket.id) {
            room.except(session.socket.id).emit(OUT.CHAT_MESSAGE, msg);
        } else {
            room.emit(OUT.CHAT_MESSAGE, msg);
        }

        // Update session status for all admins
        broadcastToAdmins(OUT.SESSION_UPDATED, {
            sessionId: targetId,
            updates: { lastActivity: timestamp }
        });

        // Mirror to the site's integration receiver (agent reply).
        // Never escalate=true here — agent replies just append to the
        // ticket on the receiver side.
        const siteId = resolveSiteId(session, targetId);
        if (siteId) {
            mirrorToSite(siteId, {
                event: 'message',
                messageId: webhook.genMessageId(),
                siteId,
                sessionId: targetId,
                from: 'agent',
                senderId: msg.senderId ? String(msg.senderId) : null,
                senderName: msg.senderName,
                text: sanitized,
                escalate: false,
                ts: timestamp
            });
        }
    }

    /**
     * Handle customer sending a message
     * @param {Object} socket - Customer socket
     * @param {Object} data - Message data
     */
    function handleCustomerMessage(socket, data) {
        const session = sessions.get(socket.sessionId);
        if (!session) {
            socket.emit(OUT.ERROR, { message: 'Session not found' });
            return;
        }

        const { message } = data;
        if (!message) {
            socket.emit(OUT.ERROR, { message: 'Message is required' });
            return;
        }

        const sanitized = sanitizeMessage(message);
        const timestamp = Date.now();

        const msg = {
            id: require('../../utils').generateId(),
            ticketId: socket.sessionId,
            sender: 'customer',
            senderName: session.name,
            message: sanitized,
            timestamp
        };

        // Save to database (repository expects { ticketId, senderType, senderId, senderName, content })
        messageRepository.create({
            ticketId: socket.sessionId,
            senderType: 'customer',
            senderId: null,
            senderName: session.name,
            content: sanitized
        });

        // Update session
        session.lastActivity = timestamp;
        session.messages.push(msg);

        // Increment unread count if no admin has joined
        if (!session.hasAdminJoined) {
            session.unreadCount = (session.unreadCount || 0) + 1;
        }

        // Update ticket activity
        ticketRepository.updateLastMessage(socket.sessionId);

        // Broadcast to admins in the chat room
        io.to(`chat:${socket.sessionId}`).emit(OUT.CHAT_MESSAGE, msg);

        // Notify all admins of the new message
        broadcastToAdmins(OUT.SESSION_UPDATED, {
            sessionId: socket.sessionId,
            updates: {
                lastActivity: timestamp,
                unreadCount: session.unreadCount
            }
        });

        // If no admin in room, notify all admins
        if (!session.hasAdminJoined) {
            broadcastToAdmins(OUT.SESSION_NEW_MESSAGE, {
                sessionId: socket.sessionId,
                message: msg,
                customerName: session.name
            });
        }

        // Acknowledge receipt
        socket.emit(OUT.CHAT_MESSAGE_SENT, { id: msg.id, timestamp });

        // Mirror to the site's integration receiver. Set escalate=true
        // when the chatbot's escalation keywords match — receivers can
        // use that flag to graduate the chat into a real ticket.
        const siteId = resolveSiteId(session, socket.sessionId);
        if (siteId) {
            let escalate = false;
            try {
                const cfg = (chatbotService && typeof chatbotService.getConfig === 'function')
                    ? chatbotService.getConfig() || {}
                    : {};
                if (chatbotService && typeof chatbotService._matchesEscalation === 'function') {
                    escalate = !!chatbotService._matchesEscalation(
                        String(sanitized).toLowerCase(),
                        cfg
                    );
                }
            } catch (_) { /* never break chat for this */ }

            mirrorToSite(siteId, {
                event: 'message',
                messageId: webhook.genMessageId(),
                siteId,
                sessionId: socket.sessionId,
                from: 'customer',
                senderId: socket.sessionId, // visitors are anonymous; sessionId is stable
                senderName: session.name,
                text: sanitized,
                escalate,
                ts: timestamp
            });
        }

        return msg;
    }

    /**
     * Handle typing indicator
     * @param {Object} socket - Socket instance
     * @param {Object} data - Typing data
     */
    function handleTyping(socket, data) {
        const { sessionId, isTyping } = data;

        if (socket.isAdmin) {
            // Admin typing - notify customer
            const session = sessions.get(sessionId);
            if (session && session.socket && session.socket.connected) {
                session.socket.emit(OUT.ADMIN_TYPING, { isTyping });
            }
        } else {
            // Customer typing - notify admins in chat room
            io.to(`chat:${socket.sessionId}`).emit(OUT.CUSTOMER_TYPING, {
                sessionId: socket.sessionId,
                isTyping
            });
        }
    }

    /**
     * Handle message read acknowledgment
     * @param {Object} socket - Admin socket
     * @param {Object} data - Read data
     */
    function handleMarkRead(socket, data) {
        if (!socket.isAdmin) return;

        const { sessionId } = data;
        const session = sessions.get(sessionId);

        if (session) {
            session.unreadCount = 0;
            broadcastToAdmins(OUT.SESSION_UPDATED, {
                sessionId,
                updates: { unreadCount: 0 }
            });
        }
    }

    return {
        handleAdminJoin,
        handleAdminLeave,
        handleAdminMessage,
        handleCustomerMessage,
        handleTyping,
        handleMarkRead,
        broadcastToAdmins
    };
}

module.exports = { createChatHandlers };
