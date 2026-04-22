/**
 * Socket.IO Load Test
 * Tests concurrent WebSocket connections to the chat server
 * 
 * Usage: node tests/load/socket-load-test.js [connections] [duration]
 * Example: node tests/load/socket-load-test.js 100 30
 */
const io = require('socket.io-client');

const CONNECTIONS = parseInt(process.argv[2]) || 50;
const DURATION = parseInt(process.argv[3]) || 30; // seconds
const SERVER_URL = process.argv[4] || 'http://localhost:3000';

const stats = {
    connected: 0,
    disconnected: 0,
    errors: 0,
    messagesSent: 0,
    messagesReceived: 0,
    chatSessions: 0,
    startTime: null,
    connectionTimes: []
};

const sockets = [];

function createConnection(index) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const socket = io(SERVER_URL, {
            transports: ['websocket'],
            forceNew: true,
            timeout: 10000
        });

        socket.on('connect', () => {
            const connectionTime = Date.now() - startTime;
            stats.connected++;
            stats.connectionTimes.push(connectionTime);

            // Start a chat session
            socket.emit('start-chat', {
                customerName: `LoadTest User ${index}`,
                customerContact: `loadtest${index}@example.com`
            });
        });

        socket.on('chat-started', () => {
            stats.chatSessions++;
        });

        socket.on('bot-message', () => {
            stats.messagesReceived++;
        });

        socket.on('admin-message', () => {
            stats.messagesReceived++;
        });

        socket.on('disconnect', () => {
            stats.disconnected++;
        });

        socket.on('connect_error', (err) => {
            stats.errors++;
            console.error(`Connection ${index} error:`, err.message);
        });

        socket.on('error', (err) => {
            stats.errors++;
            console.error(`Socket ${index} error:`, err.message);
        });

        sockets.push(socket);
        resolve(socket);
    });
}

async function sendRandomMessages() {
    const messages = [
        'Hello, I need help',
        'How can I contact support?',
        'What are your hours?',
        'Can you help me with my order?',
        'Thank you!',
        'I have a question about billing',
        'Where can I find documentation?'
    ];

    for (const socket of sockets) {
        if (socket.connected) {
            const message = messages[Math.floor(Math.random() * messages.length)];
            socket.emit('customer-message', { message });
            stats.messagesSent++;
        }
    }
}

function printStats() {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    const avgConnectionTime = stats.connectionTimes.length > 0
        ? (stats.connectionTimes.reduce((a, b) => a + b, 0) / stats.connectionTimes.length).toFixed(2)
        : 0;
    const minConnectionTime = stats.connectionTimes.length > 0
        ? Math.min(...stats.connectionTimes)
        : 0;
    const maxConnectionTime = stats.connectionTimes.length > 0
        ? Math.max(...stats.connectionTimes)
        : 0;

    console.log('\n========================================');
    console.log('Socket.IO Load Test Results');
    console.log('========================================');
    console.log(`Duration: ${elapsed.toFixed(2)}s`);
    console.log(`Target Connections: ${CONNECTIONS}`);
    console.log(`Connected: ${stats.connected}`);
    console.log(`Disconnected: ${stats.disconnected}`);
    console.log(`Errors: ${stats.errors}`);
    console.log(`Chat Sessions Started: ${stats.chatSessions}`);
    console.log(`Messages Sent: ${stats.messagesSent}`);
    console.log(`Messages Received: ${stats.messagesReceived}`);
    console.log('----------------------------------------');
    console.log('Connection Times:');
    console.log(`  Min: ${minConnectionTime}ms`);
    console.log(`  Avg: ${avgConnectionTime}ms`);
    console.log(`  Max: ${maxConnectionTime}ms`);
    console.log('========================================\n');
}

async function cleanup() {
    console.log('\nClosing connections...');
    for (const socket of sockets) {
        socket.disconnect();
    }
    printStats();
    process.exit(stats.errors > 0 ? 1 : 0);
}

async function main() {
    console.log(`\nStarting Socket.IO Load Test`);
    console.log(`Server: ${SERVER_URL}`);
    console.log(`Connections: ${CONNECTIONS}`);
    console.log(`Duration: ${DURATION}s\n`);

    stats.startTime = Date.now();

    // Create connections in batches
    const batchSize = 10;
    for (let i = 0; i < CONNECTIONS; i += batchSize) {
        const batch = [];
        for (let j = i; j < Math.min(i + batchSize, CONNECTIONS); j++) {
            batch.push(createConnection(j));
        }
        await Promise.all(batch);
        console.log(`Created ${Math.min(i + batchSize, CONNECTIONS)}/${CONNECTIONS} connections`);

        // Small delay between batches
        await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\nAll connections established. Running for ${DURATION}s...`);

    // Send messages periodically
    const messageInterval = setInterval(() => {
        sendRandomMessages();
    }, 2000);

    // Print periodic stats
    const statsInterval = setInterval(() => {
        console.log(`Connected: ${stats.connected} | Messages: ${stats.messagesSent}/${stats.messagesReceived} | Errors: ${stats.errors}`);
    }, 5000);

    // Cleanup after duration
    setTimeout(() => {
        clearInterval(messageInterval);
        clearInterval(statsInterval);
        cleanup();
    }, DURATION * 1000);
}

// Handle graceful shutdown
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

main().catch(err => {
    console.error('Load test failed:', err);
    process.exit(1);
});
