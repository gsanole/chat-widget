const path = require('path');
const s = require(path.join(__dirname, '..', 'coverage', 'coverage-summary.json'));
const f = require(path.join(__dirname, '..', 'coverage', 'coverage-final.json'));
const targets = [
    'src/utils/ipUtils.js',
    'src/socket/handlers/sessionHandlers.js',
    'src/socket/handlers/chatHandlers.js',
    'src/utils/helpers.js',
    'src/database/JsonDB.js',
    'src/database/repositories/TicketRepository.js',
    'src/database/repositories/MessageRepository.js',
    'src/app.js',
    'src/config/cors.js',
    'src/middleware/rateLimiter.js',
    'src/services/TwoFactorService.js',
    'src/routes/integrations.js',
    'src/services/lygHubWebhook.js',
    'src/socket/index.js',
    'src/socket/handlers/adminHandlers.js',
    'src/routes/chatbot.js'
];
for (const t of targets) {
    const k = Object.keys(f).find(x => x.replace(/\\/g, '/').endsWith(t));
    if (!k) { console.log(t, 'MISSING'); continue; }
    const file = f[k];
    const branches = Object.entries(file.b || {})
        .filter(([_, arr]) => arr.some(c => c === 0))
        .map(([id, arr]) => {
            const loc = file.branchMap[id].loc || file.branchMap[id].locations[0];
            const which = arr.map((c, i) => c === 0 ? i : -1).filter(i => i >= 0).join('/');
            return `L${loc.start.line}[${which}]`;
        }).join(' ');
    const stmts = Object.entries(file.s || {})
        .filter(([_, c]) => c === 0)
        .map(([id]) => file.statementMap[id].start.line)
        .join(',');
    const fns = Object.entries(file.f || {})
        .filter(([_, c]) => c === 0)
        .map(([id]) => (file.fnMap[id].name || '?') + '@' + file.fnMap[id].decl.start.line)
        .join(' ');
    console.log(t);
    if (branches) console.log('  br :', branches);
    if (stmts) console.log('  st :', stmts);
    if (fns) console.log('  fn :', fns);
}
