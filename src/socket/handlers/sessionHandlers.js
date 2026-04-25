/**
 * Session Socket Handlers
 * 
 * Single Responsibility: Customer session management via Socket.IO
 */

const { sanitizeName, validateLocation } = require('../../middleware/validation');
const { isCountryBlocked, validateLocationMatch } = require('../../utils/ipUtils');
const { isOriginAllowed } = require('../../utils/siteSecurity');
const { REQUIRE_SITE_ID } = require('../../config/security');
const { OUT } = require('../events');

/**
 * Create session socket handlers
 * @param {Object} deps - Dependencies
 * @param {Object} deps.io - Socket.IO server instance
 * @param {Object} deps.ticketRepository - Ticket repository
 * @param {Object} deps.siteRepository - Site repository
 * @param {Object} deps.chatbotService - Chatbot service
 * @param {Map} deps.adminSockets - Admin sockets map
 * @param {Map} deps.sessions - Customer sessions map
 * @param {Function} deps.getRealIP - IP extraction function
 * @param {Function} deps.analyzeIP - IP analysis function
 * @param {Function} deps.generateId - ID generator function
 * @returns {Object} Handler functions
 */
function createSessionHandlers({
    io,
    ticketRepository,
    siteRepository,
    chatbotService,
    adminSockets,
    sessions,
    getRealIP,
    analyzeIP,
    generateId,
    lygHub
}) {

    /** Fire-and-forget lyg_hub mirror. Never throws. */
    function mirrorToLygHub(payload) {
        if (!lygHub || !lygHub.enabled) return;
        Promise.resolve()
            .then(() => lygHub.send(payload))
            .catch(() => { /* swallowed; chat must keep working */ });
    }

    /**
     * Broadcast to all admins
     * @param {string} event - Event name
     * @param {Object} data - Event data
     */
    function broadcastToAdmins(event, data) {
        for (const { socket } of adminSockets.values()) {
            socket.emit(event, data);
        }
    }

    /**
     * Handle customer starting a new session
     * @param {Object} socket - Customer socket
     * @param {Object} data - Session data
     */
    async function handleStartSession(socket, data) {
        const ip = getRealIP(socket);
        const { name, location, siteId, contact, apiKey } = data || {};

        // Validate site if provided. Support two modes:
        //   1. Legacy: explicit siteId + apiKey
        //   2. Publishable key: apiKey only (industry standard, like Intercom/Crisp)
        let site = null;
        if (siteId) {
            site = siteRepository.findById(siteId);
            if (!site) {
                socket.emit(OUT.ERROR, { message: 'Unknown site' });
                if (typeof socket.disconnect === 'function') socket.disconnect(true);
                return;
            }
            if (site.api_key && site.api_key !== apiKey) {
                socket.emit(OUT.ERROR, { message: 'Invalid API key' });
                if (typeof socket.disconnect === 'function') socket.disconnect(true);
                return;
            }
        } else if (apiKey) {
            site = siteRepository.findByApiKey(apiKey);
            if (!site) {
                socket.emit(OUT.ERROR, { message: 'Invalid API key' });
                if (typeof socket.disconnect === 'function') socket.disconnect(true);
                return;
            }
        } else if (REQUIRE_SITE_ID) {
            socket.emit(OUT.ERROR, { message: 'siteId is required' });
            if (typeof socket.disconnect === 'function') socket.disconnect(true);
            return;
        }

        if (site) {
            // Per-site origin allow-list (skipped if site has none configured)
            const originHeader = socket.handshake?.headers?.origin
                || socket.handshake?.headers?.referer
                || '';
            if (!isOriginAllowed(site, originHeader)) {
                socket.emit(OUT.ERROR, { message: 'Origin not allowed for this site' });
                if (typeof socket.disconnect === 'function') socket.disconnect(true);
                return;
            }
        }

        const sessionId = generateId();
        const sanitizedName = sanitizeName(name);
        const validatedLocation = validateLocation(location);

        // Analyze IP in background
        let ipAnalysis = null;
        try {
            ipAnalysis = await analyzeIP(ip);
        } catch (err) {
            console.error('IP analysis error:', err);
        }

        // Geo blocking enforcement (uses chatbot config; site config takes precedence if present)
        const cfgForBlocking = site?.chatbot_config || (chatbotService.getConfig() || {});
        const geoBlocking = cfgForBlocking.geoBlocking;
        if (geoBlocking && geoBlocking.enabled) {
            const decision = isCountryBlocked(ipAnalysis?.geo, geoBlocking);
            if (decision.blocked) {
                const blockedMessage = geoBlocking.blockedMessage ||
                    'Sorry, the chat is not available in your region.';
                socket.emit(OUT.ERROR, {
                    code: 'GEO_BLOCKED',
                    message: blockedMessage,
                    country: decision.country || null
                });
                console.log(`Geo-blocked session attempt from ${ip} (${decision.country || 'unknown'}): ${decision.reason}`);
                socket.disconnect(true);
                return;
            }
        }

        // Normalize contact: support both shapes
        //   - widget format: { type: 'email'|'phone', value: '...' }
        //   - legacy format: { email: '...', phone: '...' }
        let normalizedContact = null;
        if (contact) {
            if (contact.type === 'email' && contact.value) {
                normalizedContact = { type: 'email', value: contact.value, email: contact.value, phone: null };
            } else if (contact.type === 'phone' && contact.value) {
                normalizedContact = { type: 'phone', value: contact.value, email: null, phone: contact.value };
            } else if (contact.email || contact.phone) {
                normalizedContact = {
                    type: contact.email ? 'email' : 'phone',
                    value: contact.email || contact.phone,
                    email: contact.email || null,
                    phone: contact.phone || null
                };
            }
        }

        const session = {
            sessionId,
            socket,
            name: sanitizedName,
            location: validatedLocation,
            contact: normalizedContact,
            ip,
            geo: ipAnalysis?.geo,
            ipAnalysis,
            locationCheck: validateLocationMatch(validatedLocation, ipAnalysis?.geo),
            siteId: site?.id,
            siteName: site?.name,
            status: 'waiting',
            startTime: Date.now(),
            lastActivity: Date.now(),
            messages: [],
            hasAdminJoined: false,
            unreadCount: 0
        };

        sessions.set(sessionId, session);
        socket.sessionId = sessionId;
        socket.join(`chat:${sessionId}`);

        // Create ticket in database
        ticketRepository.create({
            id: sessionId,
            customer_name: sanitizedName,
            customer_location: validatedLocation,
            customer_ip: ip,
            customer_contact: session.contact,
            ip_analysis: ipAnalysis,
            site_id: site?.id,
            status: 'waiting'
        });

        // Get chatbot response if enabled
        let welcomeMessage = null;
        const chatbotConfig = site?.chatbot_config || chatbotService.getConfig();
        if (chatbotConfig?.enabled && chatbotConfig?.welcomeMessage) {
            welcomeMessage = chatbotConfig.welcomeMessage;
        }

        socket.emit(OUT.SESSION_STARTED, {
            sessionId,
            welcomeMessage
        });

        // Notify all admins
        broadcastToAdmins(OUT.SESSION_NEW, {
            sessionId,
            name: sanitizedName,
            location: validatedLocation,
            ip,
            geo: ipAnalysis?.geo,
            ipAnalysis,
            locationCheck: session.locationCheck,
            contact: session.contact,
            siteId: site?.id,
            siteName: site?.name,
            status: 'waiting',
            startTime: session.startTime,
            lastActivity: session.lastActivity
        });

        console.log(`New session ${sessionId} started by ${sanitizedName} from ${ip}`);

        // Mirror to lyg_hub: pending row only, no ticket created.
        if (lygHub && lygHub.enabled) {
            // Stash siteApiKey on the session so subsequent message
            // mirrors can include it without re-resolving the site.
            session.siteApiKey = site?.api_key || null;
            mirrorToLygHub({
                event: 'session.opened',
                messageId: lygHub.genMessageId(),
                sessionId,
                siteApiKey: session.siteApiKey,
                from: 'customer',
                senderId: sessionId,
                senderName: sanitizedName,
                text: '',
                escalate: false,
                ts: session.startTime
            });
        }
    }

    /**
     * Handle customer resuming an existing session
     * @param {Object} socket - Customer socket
     * @param {string} sessionId - Existing session ID
     */
    function handleResumeSession(socket, sessionId) {
        const ip = getRealIP(socket);

        // Check if session exists in memory
        const existingSession = sessions.get(sessionId);
        if (existingSession) {
            // Update socket reference
            existingSession.socket = socket;
            existingSession.lastActivity = Date.now();
            socket.sessionId = sessionId;
            socket.join(`chat:${sessionId}`);

            socket.emit(OUT.SESSION_RESUMED, {
                sessionId,
                messages: existingSession.messages
            });

            broadcastToAdmins(OUT.SESSION_UPDATED, {
                sessionId,
                updates: { lastActivity: existingSession.lastActivity }
            });

            console.log(`Session ${sessionId} resumed from ${ip}`);
            return;
        }

        // Try to load from database
        const ticket = ticketRepository.findById(sessionId);
        if (ticket && ticket.status !== 'archived') {
            const session = {
                sessionId,
                socket,
                name: ticket.customer_name,
                location: ticket.customer_location,
                contact: ticket.customer_contact,
                ip,
                geo: ticket.ip_analysis?.geo,
                ipAnalysis: ticket.ip_analysis,
                siteId: ticket.site_id,
                status: ticket.status,
                startTime: ticket.started_at * 1000,
                lastActivity: Date.now(),
                messages: [],
                hasAdminJoined: false,
                unreadCount: 0
            };

            sessions.set(sessionId, session);
            socket.sessionId = sessionId;
            socket.join(`chat:${sessionId}`);

            // Load messages from database
            const dbModule = require('../../database');
            const messages = dbModule.messages.findByTicket(sessionId, 100);
            session.messages = messages;

            socket.emit(OUT.SESSION_RESUMED, {
                sessionId,
                messages
            });

            broadcastToAdmins(OUT.SESSION_UPDATED, {
                sessionId,
                updates: { status: 'active', lastActivity: session.lastActivity }
            });

            console.log(`Session ${sessionId} restored from database for ${ip}`);
        } else {
            socket.emit(OUT.SESSION_NOT_FOUND, { sessionId });
        }
    }

    /**
     * Handle customer ending their session
     * @param {Object} socket - Customer socket
     */
    function handleEndSession(socket) {
        const sessionId = socket.sessionId;
        if (!sessionId) return;

        const session = sessions.get(sessionId);
        if (session) {
            session.status = 'ended';
            session.endTime = Date.now();

            // Update ticket status
            ticketRepository.updateStatus(sessionId, 'closed');

            // Notify admins
            io.to(`chat:${sessionId}`).emit(OUT.SESSION_ENDED, { sessionId });
            broadcastToAdmins(OUT.SESSION_UPDATED, {
                sessionId,
                updates: { status: 'ended' }
            });

            console.log(`Session ${sessionId} ended by customer`);
        }

        socket.leave(`chat:${sessionId}`);
        socket.sessionId = null;
    }

    /**
     * Handle customer disconnection
     * @param {Object} socket - Customer socket
     */
    function handleDisconnect(socket) {
        const sessionId = socket.sessionId;
        if (!sessionId) return;

        const session = sessions.get(sessionId);
        if (session) {
            // Mark as disconnected but keep session alive for potential reconnection
            session.status = 'disconnected';
            session.socket = null;

            broadcastToAdmins(OUT.SESSION_UPDATED, {
                sessionId,
                updates: { status: 'disconnected' }
            });

            // Clean up after timeout
            setTimeout(() => {
                const current = sessions.get(sessionId);
                if (current && current.status === 'disconnected' && !current.socket) {
                    // Archive the session
                    ticketRepository.updateStatus(sessionId, 'abandoned');
                    sessions.delete(sessionId);

                    broadcastToAdmins(OUT.SESSION_REMOVED, { sessionId });
                    console.log(`Session ${sessionId} cleaned up after timeout`);
                }
            }, 5 * 60 * 1000); // 5 minutes

            console.log(`Customer disconnected from session ${sessionId}`);
        }
    }

    /**
     * Handle admin closing a session
     * @param {Object} socket - Admin socket
     * @param {string} sessionId - Session ID to close
     */
    function handleAdminClose(socket, sessionId) {
        if (!socket.isAdmin) return;

        const session = sessions.get(sessionId);
        if (session) {
            session.status = 'closed';

            // Notify customer
            if (session.socket && session.socket.connected) {
                session.socket.emit(OUT.SESSION_CLOSED_BY_ADMIN, {
                    message: 'This conversation has been closed by the support team.'
                });
            }

            // Update ticket
            ticketRepository.updateStatus(sessionId, 'closed');

            // Notify admins
            broadcastToAdmins(OUT.SESSION_UPDATED, {
                sessionId,
                updates: { status: 'closed' }
            });

            console.log(`Session ${sessionId} closed by admin ${socket.adminUser?.username}`);
        }
    }

    /**
     * Handle admin archiving a session
     * @param {Object} socket - Admin socket
     * @param {string} sessionId - Session ID to archive
     */
    function handleAdminArchive(socket, sessionId) {
        if (!socket.isAdmin) return;

        const session = sessions.get(sessionId);
        if (session) {
            // Disconnect the customer socket if still connected, then remove from active map.
            if (session.socket && session.socket.connected) {
                try { session.socket.disconnect(true); } catch (_) { /* ignore */ }
            }
            sessions.delete(sessionId);
        }
        ticketRepository.updateStatus(sessionId, 'archived');
        broadcastToAdmins(OUT.SESSION_UPDATED, {
            sessionId,
            updates: { ticketStatus: 'archived', status: 'archived', isArchived: true }
        });
        // Also notify admins that the active session is gone (test/UI contract)
        broadcastToAdmins(OUT.SESSION_REMOVED, { sessionId });
        console.log(`Session ${sessionId} archived by admin ${socket.adminUser?.username}`);
    }

    /**
     * Handle admin unarchiving a session (move it back to open).
     */
    function handleAdminUnarchive(socket, sessionId) {
        if (!socket.isAdmin) return;
        if (!sessionId) return;

        const ticket = ticketRepository.findById(sessionId);
        if (!ticket) {
            socket.emit(OUT.ERROR, { message: 'Ticket not found' });
            return;
        }

        ticketRepository.updateStatus(sessionId, 'open');
        broadcastToAdmins(OUT.SESSION_UPDATED, {
            sessionId,
            updates: { ticketStatus: 'open', status: 'open' }
        });
        console.log(`Session ${sessionId} unarchived by admin ${socket.adminUser?.username}`);
    }

    /**
     * Handle admin permanently deleting a session and its messages.
     */
    function handleAdminDelete(socket, sessionId) {
        if (!socket.isAdmin) return;
        if (!sessionId) return;

        // Remove from in-memory active sessions if present
        const session = sessions.get(sessionId);
        if (session) {
            if (session.socket && session.socket.connected) {
                try { session.socket.disconnect(true); } catch (_) { /* ignore */ }
            }
            sessions.delete(sessionId);
        }

        const removed = ticketRepository.delete(sessionId);
        broadcastToAdmins(OUT.SESSION_REMOVED, { sessionId });
        console.log(`Session ${sessionId} deleted by admin ${socket.adminUser?.username} (db removed: ${removed})`);
    }

    /**
     * Handle admin changing a ticket status.
     */
    function handleAdminChangeStatus(socket, data) {
        if (!socket.isAdmin) return;
        const sessionId = typeof data === 'string' ? data : data?.sessionId;
        const status = typeof data === 'object' ? data?.status : null;
        if (!sessionId || !status) {
            socket.emit(OUT.ERROR, { message: 'sessionId and status are required' });
            return;
        }

        const ticket = ticketRepository.findById(sessionId);
        if (!ticket) {
            socket.emit(OUT.ERROR, { message: 'Ticket not found' });
            return;
        }

        ticketRepository.updateStatus(sessionId, status);

        const session = sessions.get(sessionId);
        if (session) session.ticketStatus = status;

        // When resolving, end the customer-side conversation: notify, disconnect, drop from active map.
        if (status === 'resolved' && session) {
            const closeMessage = 'Thank you for chatting with us. This conversation has been marked as resolved. Feel free to start a new chat if you need further assistance.';
            if (session.socket && session.socket.connected) {
                try {
                    session.socket.emit(OUT.SESSION_CLOSED_BY_ADMIN, { message: closeMessage, reason: 'resolved' });
                    session.socket.disconnect(true);
                } catch (_) { /* ignore */ }
            }
            sessions.delete(sessionId);
        }

        broadcastToAdmins(OUT.SESSION_UPDATED, {
            sessionId,
            updates: { ticketStatus: status, status }
        });

        // Mirror to lyg_hub on resolve so the linked ticket (if any)
        // closes. Sent for every resolve transition; lyg_hub treats
        // it as a control event and writes no inbound row.
        if (status === 'resolved' && lygHub && lygHub.enabled) {
            mirrorToLygHub({
                event: 'session.resolved',
                messageId: lygHub.genMessageId(),
                sessionId,
                siteApiKey: session?.siteApiKey || null,
                from: 'agent',
                senderId: socket.adminUser?.id ? String(socket.adminUser.id) : null,
                senderName: socket.adminUser?.nickname || socket.adminUser?.username || 'Admin',
                text: '',
                escalate: false,
                ts: Date.now()
            });
        }
    }

    function handleAdminResolve(socket, sessionId) {
        handleAdminChangeStatus(socket, { sessionId, status: 'resolved' });
    }

    function handleAdminReopen(socket, sessionId) {
        handleAdminChangeStatus(socket, { sessionId, status: 'open' });
    }

    return {
        handleStartSession,
        handleResumeSession,
        handleEndSession,
        handleDisconnect,
        handleAdminClose,
        handleAdminArchive,
        handleAdminUnarchive,
        handleAdminDelete,
        handleAdminChangeStatus,
        handleAdminResolve,
        handleAdminReopen,
        broadcastToAdmins
    };
}

module.exports = { createSessionHandlers };
