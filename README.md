# Customer Chat System

A real-time customer support platform: an embeddable chat widget for visitors and a full admin/support dashboard with role-based access, multi-tenant sites, ticketing, a configurable bot, geo-blocking, and IP/VPN intelligence. Built on Node.js + Express + Socket.IO with a JSON-file database (no external DB required).

## Features

### Customer widget (`public/widget.js`)
- One-script embed on any site
- Pre-chat **bot** with FAQs, escalation keywords, and escalate-to-human flow
- Optional **browser geolocation** capture (compared against IP geolocation)
- **Geo-blocking** — admin can deny chat from specific countries with a custom message
- Live chat with a support agent once escalated; receives end-of-conversation notice when an agent resolves the ticket

### Admin / support dashboard (`public/admin.html`, `users.html`, `sites.html`)
- **JWT auth** with bcrypt-hashed passwords (cost 12) and optional **TOTP 2FA** (QR-code enrolment)
- **Role-based permissions**: `super_admin`, `admin`, `admin_support`, `support`
- Live session list with filters: **Open / Resolved / Archived** plus per-site filtering
- Per-chat actions: reply, change status, **resolve** (notifies + disconnects customer), archive, unarchive, delete
- **Sites** management — multi-tenant API keys so the same widget can serve multiple domains
- **Chatbot config** — bot name, welcome message, FAQs, escalation keywords, geo-blocking rules
- **User management** — create/edit/disable users, set nicknames (display name in chat), reset 2FA
- **Audit log** of admin actions

### Server
- IP intelligence: `geoip-lite` + ip-api.com lookup, VPN/proxy heuristics, browser-vs-IP location mismatch detection
- Rate limiting, helmet, input sanitization
- Persistence via `JsonDB` (files under `data/`) — restart the server to reload after manual edits

## Quick start

```powershell
npm install
npm start            # http://localhost:3000
# or
npm run dev          # nodemon
```

| URL | Purpose |
|---|---|
| `http://localhost:3000/` | Demo page hosting the widget |
| `http://localhost:3000/admin` | Support dashboard |
| `http://localhost:3000/users.html` | User management (super_admin) |
| `http://localhost:3000/sites.html` | Sites / API keys (super_admin) |

### Default credentials

The seeded super-admin lives in `data/users.json`. To set or rotate a password:

```powershell
npm run hash-password   # prints a bcrypt hash to paste into data/users.json
```

Then restart the server so the JSON file is reloaded.

## Embedding the widget

```html
<script>
  window.CHAT_SERVER_URL = 'https://your-chat-server.com';
  window.CHAT_SITE_API_KEY = 'your-site-api-key'; // from /sites.html
</script>
<script src="https://your-chat-server.com/widget.js"></script>
```

`CHAT_SITE_API_KEY` is required in multi-site setups so the message routes to the correct tenant.

## Configuration

### Environment

```env
PORT=3000
JWT_SECRET=change-me-to-a-long-random-string
NODE_ENV=production
```

### Geo-blocking

In the admin dashboard → **Bot & Geo settings**, enable geo-blocking and add ISO-2 country codes (e.g. `US`, `DE`, `IL`). Blocked customers see a clean "Chat unavailable in your region" card; the connection is closed server-side.

### Sites & API keys

Each site row in `/sites.html` issues an API key the widget must include via `CHAT_SITE_API_KEY` (or `apiKey` in `session:start`).

## Project structure

```
server.js                  # boot wrapper
src/
  app.js                   # Express app + HTTP routes
  index.js                 # composition root (wires services + socket)
  config/                  # cors, security, permissions, ticketStatus
  database/
    JsonDB.js              # in-memory JSON store, flushes to data/*.json
    repositories/          # Users, Sites, Tickets, Messages, Sessions, Audit
  middleware/              # auth (JWT), rate limit, validation, error handler
  routes/                  # /api/auth, /api/users, /api/sites,
                           # /api/tickets, /api/chatbot, /api/audit
  services/                # AuthService, ChatbotService, TicketService
  socket/
    events.js              # frozen IN/OUT event-name constants
    index.js               # Socket.IO bootstrap
    handlers/              # session, chat, admin, chatbot handlers
  utils/                   # ipUtils, totp, helpers
public/
  widget.js                # embeddable chat widget
  admin.html               # support dashboard
  users.html / sites.html  # super-admin management
  demo.html                # local demo
data/                      # JSON persistence (users, sites, tickets, messages, …)
scripts/hash-password.js   # bcrypt hashing helper
tests/                     # unit, integration (jest), e2e (playwright), load (artillery)
```

## HTTP API (selected)

All `/api/*` routes (except `/api/auth/*`) require a Bearer JWT.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/login` | username + password (+ optional `totpCode`) → JWT |
| `POST` | `/api/auth/2fa/setup` | enrol TOTP, returns QR data URL |
| `GET`  | `/api/users` | list (manage_users) |
| `PUT`  | `/api/users/:id` | update role / active / nickname / email |
| `GET`  | `/api/sites` | list sites |
| `POST` | `/api/sites` | create site (issues API key) |
| `GET`  | `/api/tickets` | list tickets, supports `?status=` and `?siteId=` |
| `PUT`  | `/api/chatbot/admin/config` | save bot + geo-blocking config |
| `GET`  | `/api/audit` | audit log (view_audit) |

## Socket.IO events

Single source of truth: `src/socket/events.js`. Convention: `<scope>:<action>` kebab-case.

### Inbound (client → server)
- Customer: `session:start`, `session:resume`, `session:end`, `chat:message`, `chat:typing`
- Admin: `admin:auth`, `admin:auth-token`, `admin:submit-2fa`, `admin:join-chat`, `admin:leave-chat`, `admin:message`, `admin:typing`, `admin:mark-read`, `admin:close-session`, `admin:archive-session`, `admin:unarchive-session`, `admin:delete-session`, `admin:resolve-session`, `admin:reopen-session`, `admin:change-status`

### Outbound (server → client)
- `admin:sessions`, `admin:authenticated`, `admin:auth-failed`, `admin:requires-2fa`
- `chat:history`, `chat:message`, `chat:message-sent`, `customer:typing`
- `session:started`, `session:resumed`, `session:not-found`, `session:ended`, `session:closed-by-admin`
- `session:new`, `session:new-message`, `session:updated`, `session:removed`
- `error`

## Permissions matrix

| Permission | super_admin | admin | admin_support | support |
|---|:-:|:-:|:-:|:-:|
| manage_users | ✓ | | | |
| settings | ✓ | ✓ | | |
| delete_tickets | ✓ | ✓ | | |
| archive_tickets | ✓ | ✓ | ✓ | |
| change_status | ✓ | ✓ | ✓ | |
| view_audit | ✓ | ✓ | ✓ | |
| chat (reply) | ✓ | ✓ | ✓ | ✓ |
| view_tickets | ✓ | ✓ | ✓ | ✓ |

Definitive list lives in `src/config/permissions.js`.

## Testing

```powershell
npm test                  # jest, unit + integration with coverage
npm run test:unit
npm run test:integration
npm run test:e2e          # playwright
npm run test:load         # artillery
```

## Production checklist

1. Serve over **HTTPS** (browser geolocation requires it).
2. Set a strong `JWT_SECRET` and rotate the seeded super-admin password.
3. Sit behind a reverse proxy (nginx / Caddy) and forward `X-Real-IP` / `X-Forwarded-For`:
   ```nginx
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   ```
4. Back up the `data/` directory (or migrate to a real DB by replacing the repositories).
5. Enable 2FA for every admin/support user.

## License

MIT

