/**
 * Application Setup
 * 
 * Single Responsibility: Wire up all application components
 * 
 * This module follows the Dependency Injection pattern:
 * - Creates all dependencies
 * - Wires them together
 * - Exports the configured Express app and Socket.IO setup
 */

const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// Config modules
const {
    JWT_SECRET,
    SECURITY_LIMITS,
    LOCALHOST_IPS,
    isLocalhost
} = require('./config/security');
const {
    ROLES,
    PERMISSIONS,
    hasPermission,
    isValidRole
} = require('./config/permissions');
const {
    ALLOWED_ORIGINS,
    createCorsOptions
} = require('./config/cors');
const {
    TICKET_STATUS,
    isValidTransition
} = require('./config/ticketStatus');

// Middleware
const {
    createAuthMiddleware
} = require('./middleware/auth');
const {
    createApiLimiter,
    createAuthLimiter
} = require('./middleware/rateLimiter');
const {
    errorHandler,
    AppError,
    NotFoundError
} = require('./middleware/errorHandler');

// Database
const db = require('./database');

// Services
const {
    AuthService,
    TicketService,
    ChatbotService,
    createSessionCleanupService
} = require('./services');

// Routes
const {
    createAuthRouter,
    createUsersRouter,
    createTicketsRouter,
    createAuditRouter,
    createSitesRouter,
    createChatbotRouter
} = require('./routes');

// Socket handlers
const { setupSocketIO } = require('./socket');

// Utilities
const {
    getRealIP,
    analyzeIP,
    fetchIPGeo
} = require('./utils/ipUtils');
const {
    generateId,
    generateUUID
} = require('./utils/helpers');

// TOTP module
const totp = require('./utils/totp');

/**
 * Create and configure the Express application
 * @param {Object} options - Configuration options
 * @param {boolean} options.httpsEnabled - Whether HTTPS is enabled
 * @param {Object} options.httpsOptions - HTTPS certificate options
 * @returns {Object} { app, server, io, socketState }
 */
function createApp(options = {}) {
    const app = express();

    // Trust the first reverse proxy (Render, nginx, Heroku, etc.) so
    // req.ip / X-Forwarded-For is honored by rate limiter and IP utils.
    // Set TRUST_PROXY=0 to disable, or to a number for multiple hops.
    const trustProxy = process.env.TRUST_PROXY !== undefined
        ? (isNaN(Number(process.env.TRUST_PROXY)) ? process.env.TRUST_PROXY : Number(process.env.TRUST_PROXY))
        : 1;
    app.set('trust proxy', trustProxy);

    // Create HTTP or HTTPS server
    const server = options.httpsEnabled && options.httpsOptions
        ? https.createServer(options.httpsOptions, app)
        : http.createServer(app);

    // Configure Socket.IO
    const io = new Server(server, {
        cors: createCorsOptions(),
        pingTimeout: 60000,
        pingInterval: 25000
    });

    // ===========================================
    // MIDDLEWARE SETUP
    // ===========================================

    // Security headers (Helmet)
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                connectSrc: ["'self'", "wss:", "ws:", "http://ip-api.com"],
                imgSrc: ["'self'", "data:"],
            },
        },
        crossOriginEmbedderPolicy: false,
    }));

    // CORS
    app.use(cors(createCorsOptions()));

    // Body parsing
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true }));

    // Rate limiting
    app.use('/api/', createApiLimiter());
    app.use('/api/admin/login', createAuthLimiter());
    app.use('/api/admin/auth', createAuthLimiter());

    // Static files
    app.use(express.static(path.join(__dirname, '../public')));
    app.use('/admin', express.static(path.join(__dirname, '../public/admin')));

    // ===========================================
    // SERVICE LAYER SETUP
    // ===========================================

    const authService = new AuthService({
        userRepository: db.users,
        sessionRepository: db.sessions,
        auditRepository: db.audit,
        jwtSecret: JWT_SECRET,
        totp
    });

    const ticketService = new TicketService({
        ticketRepository: db.tickets,
        messageRepository: db.messages,
        auditRepository: db.audit
    });

    const chatbotService = new ChatbotService({
        chatbotConfig: db.chatbot
    });

    // ===========================================
    // AUTH MIDDLEWARE SETUP
    // ===========================================

    const authMiddleware = createAuthMiddleware({
        authService,
        hasPermission
    });

    // ===========================================
    // ROUTE SETUP
    // ===========================================

    const authLimiter = createAuthLimiter();

    const routeDeps = {
        authService,
        ticketService,
        chatbotService,
        userRepository: db.users,
        ticketRepository: db.tickets,
        messageRepository: db.messages,
        auditRepository: db.audit,
        sessionRepository: db.sessions,
        siteRepository: db.sites,
        authMiddleware,
        authLimiter,
        totp
    };

    // ===========================================
    // LEGACY URL COMPAT (rewrite old paths to new router structure)
    // ===========================================
    app.use((req, res, next) => {
        const url = req.url;
        // Split path/query
        const qIdx = url.indexOf('?');
        const pathPart = qIdx === -1 ? url : url.slice(0, qIdx);
        const queryPart = qIdx === -1 ? '' : url.slice(qIdx);

        let newPath = pathPart;

        // 2FA aliases -> /api/users/profile/2fa/*
        if (pathPart === '/api/2fa/setup') newPath = '/api/users/profile/2fa/setup';
        else if (pathPart === '/api/2fa/enable') newPath = '/api/users/profile/2fa/enable';
        else if (pathPart === '/api/2fa/disable') newPath = '/api/users/profile/2fa/disable';
        else if (pathPart === '/api/2fa/verify') newPath = '/api/users/profile/2fa/verify';
        else if (pathPart === '/api/2fa/status') newPath = '/api/users/profile/2fa/status';
        // /api/admin/users -> /api/users
        else if (pathPart === '/api/admin/users' || pathPart.startsWith('/api/admin/users/')) {
            newPath = pathPart.replace('/api/admin/users', '/api/users');
        }
        // /api/admin/profile -> /api/users/profile
        else if (pathPart === '/api/admin/profile') newPath = '/api/users/profile';
        // /api/admin/change-password -> /api/users/profile/password
        else if (pathPart === '/api/admin/change-password') newPath = '/api/users/profile/password';
        // /api/admin/sessions -> /api/sessions (handled by stub router)
        else if (pathPart.startsWith('/api/admin/sessions')) {
            newPath = pathPart.replace('/api/admin/sessions', '/api/sessions');
        }
        // /api/auth/login -> /api/admin/login
        else if (pathPart === '/api/auth/login') newPath = '/api/admin/login';
        // /api/chatbot/admin/* -> handled by router directly (admin paths)
        // (no rewrite - routes are added directly in chatbot router)

        if (newPath !== pathPart) {
            req.url = newPath + queryPart;
        }
        next();
    });

    // Mount routes
    app.use('/api', createAuthRouter(routeDeps));
    app.use('/api/users', createUsersRouter(routeDeps));
    app.use('/api/tickets', createTicketsRouter(routeDeps));
    app.use('/api/audit', createAuditRouter(routeDeps));
    app.use('/api/sites', createSitesRouter(routeDeps));
    app.use('/api/chatbot', createChatbotRouter(routeDeps));

    // ===========================================
    // LEGACY STUB ENDPOINTS (rarely-used legacy paths)
    // ===========================================
    const { requireAuth, requirePermission } = authMiddleware;

    // Ready check
    app.get('/api/ready', (req, res) => {
        res.json({ ready: true });
    });

    // Sessions list / clear
    app.get('/api/sessions', requireAuth, (req, res) => {
        try {
            const sessions = db.sessions.findAll ? db.sessions.findAll() : [];
            res.json({ sessions });
        } catch (e) { res.json({ sessions: [] }); }
    });
    app.delete('/api/sessions/all', requireAuth, (req, res) => {
        try { db.sessions.deleteAll && db.sessions.deleteAll(); } catch (e) { }
        res.json({ success: true });
    });
    app.delete('/api/sessions/:id', requireAuth, (req, res) => {
        try {
            const ok = db.sessions.delete ? db.sessions.delete(req.params.id) : false;
            res.json({ success: !!ok });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Password reset stubs
    app.post('/api/auth/request-reset', (req, res) => {
        const { username, email } = req.body || {};
        if (!username && !email) return res.status(400).json({ error: 'Username or email required' });
        res.json({ success: true });
    });
    app.post('/api/auth/validate-reset', (req, res) => {
        const { token } = req.body || {};
        if (!token) return res.status(400).json({ error: 'Token required' });
        res.status(400).json({ valid: false, error: 'Invalid or expired reset token' });
    });
    app.post('/api/auth/reset-password', (req, res) => {
        const { token, newPassword } = req.body || {};
        if (!token || !newPassword) return res.status(400).json({ error: 'Token and newPassword required' });
        res.status(400).json({ error: 'Invalid or expired reset token' });
    });

    // User reset password (admin)
    app.post('/api/users/:id/reset-password', requireAuth, requirePermission('manage_users'), (req, res) => {
        const user = db.users.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const { newPassword } = req.body || {};
        if (newPassword) {
            return db.users.updatePassword(req.params.id, newPassword)
                .then(() => res.json({ success: true }))
                .catch(err => res.status(500).json({ error: err.message }));
        }
        // Generate a reset token for the user
        const crypto = require('crypto');
        const token = crypto.randomBytes(24).toString('hex');
        try {
            if (db.users.setResetToken) db.users.setResetToken(req.params.id, token);
            else if (db.users.update) db.users.update(req.params.id, { reset_token: token });
        } catch (e) { }
        res.json({ success: true, resetToken: token });
    });

    // Check access
    app.post('/api/check-access', (req, res) => {
        res.json({ allowed: true, reason: 'ok' });
    });

    // Site tickets
    app.get('/api/sites/:id/tickets', requireAuth, (req, res) => {
        const site = db.sites.findById ? db.sites.findById(req.params.id) : null;
        if (!site) return res.status(404).json({ error: 'Site not found' });
        const tickets = db.tickets.findAll ? db.tickets.findAll().filter(t => t.siteId === req.params.id) : [];
        res.json(tickets);
    });
    app.get('/api/sites/:id/sessions', requireAuth, (req, res) => {
        const site = db.sites.findById ? db.sites.findById(req.params.id) : null;
        if (!site) return res.status(404).json({ error: 'Site not found' });
        res.json({ sessions: [] });
    });

    // Tickets search
    app.get('/api/tickets/search', requireAuth, (req, res) => {
        const q = (req.query.q || '').toLowerCase();
        const all = db.tickets.findAll ? db.tickets.findAll() : [];
        const filtered = q ? all.filter(t =>
            (t.customerName || '').toLowerCase().includes(q) ||
            (t.id || '').toLowerCase().includes(q)
        ) : all;
        res.json(filtered);
    });

    // Admin panel routes
    app.get('/admin', (req, res) => {
        const candidates = [
            path.join(__dirname, '../public/admin/index.html'),
            path.join(__dirname, '../public/admin.html'),
        ];
        const fp = candidates.find(p => fs.existsSync(p));
        if (fp) return res.sendFile(fp);
        res.type('html').send('<!doctype html><html><body>Admin Panel</body></html>');
    });

    app.get('/admin/*', (req, res) => {
        const candidates = [
            path.join(__dirname, '../public/admin/index.html'),
            path.join(__dirname, '../public/admin.html'),
        ];
        const fp = candidates.find(p => fs.existsSync(p));
        if (fp) return res.sendFile(fp);
        res.type('html').send('<!doctype html><html><body>Admin Panel</body></html>');
    });

    // Root
    app.get('/', (req, res, next) => {
        const fp = path.join(__dirname, '../public/index.html');
        if (fs.existsSync(fp)) return res.sendFile(fp);
        res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Chat Support</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 640px; margin: 4rem auto; padding: 0 1rem; color: #1f2937; }
  h1 { margin-top: 0; }
  ul { line-height: 1.9; padding-left: 1.25rem; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { background: #f3f4f6; padding: 0.1rem 0.35rem; border-radius: 4px; }
</style>
</head>
<body>
  <h1>Chat Support</h1>
  <p>Server is running. Available pages:</p>
  <ul>
    <li><a href="/demo.html">/demo.html</a> &mdash; customer chat widget demo</li>
    <li><a href="/admin">/admin</a> &mdash; admin dashboard</li>
    <li><a href="/sites.html">/sites.html</a> &mdash; sites management</li>
    <li><a href="/users.html">/users.html</a> &mdash; users management</li>
    <li><code>/widget.js</code> &mdash; embeddable widget script</li>
  </ul>
</body>
</html>`);
    });

    // Widget endpoint
    app.get('/widget.js', (req, res) => {
        res.type('application/javascript');
        res.sendFile(path.join(__dirname, '../public/widget.js'));
    });

    // 404 handler
    app.use((req, res, next) => {
        // Don't 404 for static files or socket.io
        if (req.path.startsWith('/socket.io')) {
            return next();
        }
        next(new NotFoundError('Route not found'));
    });

    // Error handler
    app.use(errorHandler);

    // ===========================================
    // SOCKET.IO SETUP
    // ===========================================

    const socketDeps = {
        authService,
        ticketRepository: db.tickets,
        messageRepository: db.messages,
        userRepository: db.users,
        sessionRepository: db.sessions,
        auditRepository: db.audit,
        siteRepository: db.sites,
        chatbotService,
        totp,
        hasPermission,
        getRealIP: (socket) => getRealIP(socket),
        analyzeIP,
        generateId
    };

    const socketState = setupSocketIO(io, socketDeps);

    // ===========================================
    // BACKGROUND SERVICES
    // ===========================================

    const sessionCleanup = createSessionCleanupService({ db });
    sessionCleanup.start();

    return {
        app,
        server,
        io,
        socketState,
        sessionCleanup,

        // Expose for testing
        services: {
            authService,
            ticketService,
            chatbotService,
            sessionCleanup
        },
        repositories: {
            users: db.users,
            tickets: db.tickets,
            messages: db.messages,
            audit: db.audit,
            sessions: db.sessions,
            sites: db.sites
        }
    };
}

module.exports = { createApp };
