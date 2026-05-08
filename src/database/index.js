/**
 * Database Index
 * 
 * Dependency Inversion: Creates and wires up all database components
 * Single Entry Point: Provides configured database access object
 */

const fs = require('fs');
const path = require('path');
const { runSeed, bootstrapAdminFromEnv } = require('./seed');

// Seed the data directory from data-seed/ before loading any JsonDB
// instances. This is a no-op when data files already exist.
runSeed();

const { JsonDB, DB_DIR } = require('./JsonDB');
const {
    UserRepository,
    TicketRepository,
    MessageRepository,
    AuditRepository,
    SessionRepository,
    SiteRepository
} = require('./repositories');

// File paths
const CHATBOT_FILE = path.join(DB_DIR, 'chatbot.json');

// Create JsonDB instances
const usersDB = new JsonDB('users.json', []);
const ticketsDB = new JsonDB('tickets.json', []);
const messagesDB = new JsonDB('messages.json', []);
const auditDB = new JsonDB('audit.json', []);
const sessionsDB = new JsonDB('sessions.json', []);
const sitesDB = new JsonDB('sites.json', []);

// Create repositories with dependencies wired up
const userRepository = new UserRepository(usersDB);
const ticketRepository = new TicketRepository(ticketsDB, messagesDB);
const messageRepository = new MessageRepository(messagesDB, ticketsDB);
const auditRepository = new AuditRepository(auditDB);
const sessionRepository = new SessionRepository(sessionsDB, usersDB);
const siteRepository = new SiteRepository(sitesDB, ticketsDB);

// Bootstrap a single admin from env vars when the users table is empty.
// Idempotent: skipped silently once any user exists. See seed.js docs.
// Fire-and-forget at module load — failure must not crash the app, since
// the operator can always recover via scripts/reset-admin-password.js.
bootstrapAdminFromEnv(userRepository).then(result => {
    if (result && result.seeded) return; // success path already logs
    const reason = result && result.reason ? result.reason : 'unknown';
    console.log(`[seed] bootstrap admin skipped: ${reason}`);
}).catch(err => {
    console.warn('[seed] bootstrap admin failed:', err && err.message ? err.message : err);
});

// Chatbot configuration (file-based, not repository pattern)
const chatbotConfig = {
    getConfig() {
        try {
            if (fs.existsSync(CHATBOT_FILE)) {
                const content = fs.readFileSync(CHATBOT_FILE, 'utf8');
                return JSON.parse(content);
            }
        } catch (err) {
            console.error('Error loading chatbot config:', err.message);
        }
        // Return default config
        return {
            enabled: true,
            botName: 'Support Bot',
            welcomeMessage: "Hi! I'm your virtual assistant. How can I help you today?",
            fallbackMessage: "I'm not sure I understand. Would you like me to connect you with a human support agent?",
            escalationKeywords: ['human', 'agent', 'person', 'real person', 'live support', 'representative'],
            escalationMessage: "I'll connect you with a support agent right away.",
            faq: [],
            quickReplies: ['Talk to Human'],
            humanHours: {
                enabled: false,
                timezone: 'America/New_York',
                schedule: {
                    mon: [{ open: '09:00', close: '17:00' }],
                    tue: [{ open: '09:00', close: '17:00' }],
                    wed: [{ open: '09:00', close: '17:00' }],
                    thu: [{ open: '09:00', close: '17:00' }],
                    fri: [{ open: '09:00', close: '17:00' }],
                    sat: [],
                    sun: []
                },
                offHoursMessage: "Our support team is currently offline. Please leave a message and we'll get back to you when we're available."
            }
        };
    },

    saveConfig(config) {
        try {
            fs.writeFileSync(CHATBOT_FILE, JSON.stringify(config, null, 2));
            return true;
        } catch (err) {
            console.error('Error saving chatbot config:', err.message);
            return false;
        }
    },

    addFaqItem(item) {
        const config = this.getConfig();
        const id = item.id || `faq_${Date.now()}`;
        config.faq.push({ ...item, id });
        this.saveConfig(config);
        return id;
    },

    updateFaqItem(id, updates) {
        const config = this.getConfig();
        const index = config.faq.findIndex(f => f.id === id);
        if (index !== -1) {
            config.faq[index] = { ...config.faq[index], ...updates };
            this.saveConfig(config);
            return true;
        }
        return false;
    },

    deleteFaqItem(id) {
        const config = this.getConfig();
        const index = config.faq.findIndex(f => f.id === id);
        if (index !== -1) {
            config.faq.splice(index, 1);
            this.saveConfig(config);
            return true;
        }
        return false;
    }
};

// ---------------------------------------------------------------------------
// Backward-compatibility adapters
// The repositories above expose a clean object-based API. The legacy callers
// (and existing test suites) still pass positional arguments. The thin wrappers
// below accept both forms so we don't have to mutate the repositories.
// ---------------------------------------------------------------------------

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const usersAdapter = Object.create(userRepository);
usersAdapter.create = function (...args) {
    if (args.length === 1 && isPlainObject(args[0])) {
        return userRepository.create(args[0]);
    }
    const [username, email, password, role, nickname = null, createdBy = null] = args;
    return userRepository.create({ username, email, password, role, nickname, createdBy });
};

const ticketsAdapter = Object.create(ticketRepository);
ticketsAdapter.create = function (...args) {
    if (args.length === 1 && isPlainObject(args[0])) {
        return ticketRepository.create(args[0]);
    }
    const [id, customerName, customerIp, customerLocation, ipAnalysis, contact = null, createdBy = null, siteId = null] = args;
    return ticketRepository.create({
        id, customerName, customerIp, customerLocation, ipAnalysis, contact, createdBy, siteId
    });
};

const messagesAdapter = Object.create(messageRepository);
messagesAdapter.create = function (...args) {
    if (args.length === 1 && isPlainObject(args[0])) {
        return messageRepository.create(args[0]);
    }
    const [ticketId, senderType, senderId, senderName, content] = args;
    return messageRepository.create({ ticketId, senderType, senderId, senderName, content });
};

const sessionsAdapter = Object.create(sessionRepository);
sessionsAdapter.create = function (...args) {
    if (args.length === 1 && isPlainObject(args[0])) {
        return sessionRepository.create(args[0]);
    }
    const [userId, token, ipAddress, userAgent, expiresIn] = args;
    const payload = { userId, token, ipAddress, userAgent };
    if (expiresIn !== undefined) payload.expiresIn = expiresIn;
    return sessionRepository.create(payload);
};

const sitesAdapter = Object.create(siteRepository);
sitesAdapter.create = function (...args) {
    if (args.length === 1 && isPlainObject(args[0])) {
        return siteRepository.create(args[0]);
    }
    const [name, domain, description = ''] = args;
    return siteRepository.create({ name, domain, description });
};

const auditAdapter = Object.create(auditRepository);
auditAdapter.log = function (...args) {
    if (args.length === 1 && isPlainObject(args[0])) {
        return auditRepository.log(args[0]);
    }
    const [userId, username, action, resourceType = null, resourceId = null, details = null, ipAddress = null, userAgent = null] = args;
    return auditRepository.log({ userId, username, action, resourceType, resourceId, details, ipAddress, userAgent });
};

// Add legacy chatbot.findResponse (FAQ + escalation matching)
chatbotConfig.findResponse = function (message) {
    const config = this.getConfig();
    const lowerMsg = (message || '').toLowerCase();

    for (const keyword of (config.escalationKeywords || [])) {
        if (lowerMsg.includes(keyword.toLowerCase())) {
            return { type: 'escalate', message: config.escalationMessage };
        }
    }

    for (const faq of (config.faq || [])) {
        for (const pattern of (faq.patterns || [])) {
            if (lowerMsg.includes(pattern.toLowerCase())) {
                return { type: 'faq', message: faq.response, faqId: faq.id };
            }
        }
    }

    return { type: 'fallback', message: config.fallbackMessage };
};

// Unified database API (maintains backward compatibility)
const db = {
    users: usersAdapter,
    tickets: ticketsAdapter,
    messages: messagesAdapter,
    audit: auditAdapter,
    sessions: sessionsAdapter,
    sites: sitesAdapter,
    chatbot: chatbotConfig,

    /**
     * Initialize a default super admin if none exists. Returns true if created.
     */
    async initializeSuperAdmin() {
        const superAdminCount = usersDB.count(u => u.role === 'super_admin' && u.is_active === 1);
        if (superAdminCount > 0) return false;

        const defaultPassword = process.env.SUPER_ADMIN_PASSWORD || 'changeme123!';
        const defaultEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@localhost';

        await userRepository.create({
            username: 'superadmin',
            email: defaultEmail,
            password: defaultPassword,
            role: 'super_admin'
        });
        return true;
    },

    close() {
        usersDB.save();
        ticketsDB.save();
        messagesDB.save();
        auditDB.save();
        sessionsDB.save();
        sitesDB.save();
    },

    // Raw DB access (for advanced use cases)
    _raw: {
        usersDB,
        ticketsDB,
        messagesDB,
        auditDB,
        sessionsDB,
        sitesDB
    }
};

module.exports = db;
