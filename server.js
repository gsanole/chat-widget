/**
 * Server Entry Point
 *
 * Thin entry point that:
 *  1. Creates the app via the modular factory in src/app.js
 *  2. Provides startServer() for manual startup (used by tests)
 *  3. Auto-starts only when invoked as the main module
 *  4. Handles graceful shutdown signals
 *
 * Exports the same shape as the legacy monolithic server for
 * backwards-compatibility with existing test suites:
 *   { app, server, io, db, startServer }
 */

const fs = require('fs');
const { createApp } = require('./src/app');
const db = require('./src/database');

const PORT = process.env.PORT || 3000;
const HTTPS_ENABLED = process.env.HTTPS === 'true';

let httpsOptions = null;
if (HTTPS_ENABLED) {
  try {
    httpsOptions = {
      key: fs.readFileSync(process.env.SSL_KEY_PATH || './ssl/key.pem'),
      cert: fs.readFileSync(process.env.SSL_CERT_PATH || './ssl/cert.pem')
    };
  } catch (err) {
    console.error('Failed to load SSL certificates:', err.message);
    console.log('Falling back to HTTP');
  }
}

const { app, server, io, socketState, sessionCleanup, services, repositories } = createApp({
  httpsEnabled: HTTPS_ENABLED && httpsOptions,
  httpsOptions
});

async function startServer() {
  // Bind the port FIRST so platform health checks (Render, etc.) succeed
  // immediately. Slow DB init runs in the background.
  server.listen(PORT, () => {
    const protocol = HTTPS_ENABLED && httpsOptions ? 'https' : 'http';
    console.log('===========================================');
    console.log('  Chat Support Server Running');
    console.log('===========================================');
    console.log('  URL: ' + protocol + '://localhost:' + PORT);
    console.log('  Admin Panel: ' + protocol + '://localhost:' + PORT + '/admin');
    console.log('  Protocol: ' + protocol.toUpperCase());
    console.log('  Environment: ' + (process.env.NODE_ENV || 'development'));
    console.log('===========================================');
  });

  try {
    const created = await db.initializeSuperAdmin();
    if (created) {
      console.log('DEFAULT SUPER ADMIN CREATED - Username: superadmin / Password: changeme123!');
    }
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

function gracefulShutdown(signal) {
  console.log('\n' + signal + ' received. Shutting down gracefully...');
  server.close(() => {
    io.disconnectSockets(true);
    if (sessionCleanup && typeof sessionCleanup.stop === 'function') {
      sessionCleanup.stop();
    }
    if (typeof db.close === 'function') db.close();
    console.log('Shutdown complete');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = {
  app,
  server,
  io,
  db,
  startServer,
  socketState,
  services,
  repositories
};