/**
 * Customer Chat Widget
 * Embeddable chat widget with AI chatbot and location/VPN detection
 */
(function () {
  'use strict';

  // External configuration - can be set via window.ChatWidgetConfig before loading
  const externalConfig = window.ChatWidgetConfig || {};

  // Configuration - Update this to your server URL
  const CONFIG = {
    serverUrl: externalConfig.serverUrl || window.CHAT_SERVER_URL || window.location.origin,
    siteId: externalConfig.siteId || null,
    siteApiKey: externalConfig.siteApiKey || null,
    position: externalConfig.position || 'bottom-right',
    primaryColor: externalConfig.primaryColor || '#2563eb',
    secondaryColor: externalConfig.secondaryColor || '#1e40af',
    title: externalConfig.title || 'Chat Support'
  };

  // Styles for the widget
  const styles = `
    #chat-widget-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    #chat-widget-button {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: ${CONFIG.primaryColor};
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
    }

    #chat-widget-container.chat-open #chat-widget-button {
      opacity: 0;
      pointer-events: none;
      transform: scale(0.85);
    }

    #chat-widget-button:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 16px rgba(0,0,0,0.2);
    }

    #chat-widget-button svg {
      width: 28px;
      height: 28px;
      fill: white;
    }

    #chat-widget-window {
      position: absolute;
      bottom: 70px;
      right: 0;
      width: 380px;
      height: 520px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      display: none;
      flex-direction: column;
      overflow: hidden;
    }

    #chat-widget-window.open {
      display: flex;
    }

    /* Mobile: scale the popup to roughly 70% of the viewport so it feels
       like a chat bubble, not a takeover. Uses dvh so it adapts to
       browser chrome (URL bar) and respects iOS safe areas. */
    @media (max-width: 480px) {
      #chat-widget-container {
        bottom: 12px;
        right: 12px;
        left: 12px;
      }
      #chat-widget-window {
        position: fixed;
        bottom: 84px; /* clear of the bubble */
        right: 12px;
        left: 12px;
        top: auto;
        width: auto;
        max-width: none;
        /* ~70% of viewport, capped so it never overflows the safe area */
        height: min(70dvh, calc(100dvh - 96px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
        max-height: calc(100dvh - 96px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
        border-radius: 16px;
      }
    }

    /* Very small phones: drop to ~60% of viewport so messages + input still fit. */
    @media (max-width: 380px) {
      #chat-widget-window {
        height: min(60dvh, calc(100dvh - 110px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
      }
    }

    /* Short screens (landscape phones): cap by viewport height. */
    @media (max-height: 600px) and (max-width: 900px) {
      #chat-widget-window {
        height: calc(100dvh - 90px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
      }
    }

    .chat-header {
      background: ${CONFIG.primaryColor};
      color: white;
      padding: 16px 20px;
      font-weight: 600;
      font-size: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .chat-header-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .chat-header-status {
      font-size: 11px;
      opacity: 0.9;
      font-weight: normal;
    }

    .chat-header-close {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      font-size: 24px;
      line-height: 1;
      opacity: 0.8;
    }

    .chat-header-close:hover {
      opacity: 1;
    }

    .chat-body {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .chat-pre-chat {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .chat-pre-chat h3 {
      margin: 0;
      font-size: 18px;
      color: #1f2937;
    }

    .chat-pre-chat p {
      margin: 0;
      font-size: 14px;
      color: #6b7280;
    }

    .chat-input-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .chat-input-group label {
      font-size: 13px;
      font-weight: 500;
      color: #374151;
    }

    .chat-input-group input {
      padding: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      /* 16px prevents iOS Safari from auto-zooming the viewport on focus. */
      font-size: 16px;
      outline: none;
      transition: border-color 0.2s;
    }

    .chat-input-group input:focus {
      border-color: ${CONFIG.primaryColor};
    }

    .chat-location-status {
      padding: 12px;
      border-radius: 8px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .chat-location-status.pending {
      background: #fef3c7;
      color: #92400e;
    }

    .chat-location-status.success {
      background: #d1fae5;
      color: #065f46;
    }

    .chat-location-status.error {
      background: #fee2e2;
      color: #991b1b;
    }

    .chat-start-btn {
      padding: 14px;
      background: ${CONFIG.primaryColor};
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }

    .chat-start-btn:hover:not(:disabled) {
      background: #1d4ed8;
    }

    .chat-start-btn:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .chat-message {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.4;
    }

    .chat-message.customer {
      align-self: flex-end;
      background: ${CONFIG.primaryColor};
      color: white;
      border-bottom-right-radius: 4px;
    }

    .chat-message.admin, .chat-message.bot {
      align-self: flex-start;
      background: #f3f4f6;
      color: #1f2937;
      border-bottom-left-radius: 4px;
    }

    .chat-message.bot {
      background: linear-gradient(135deg, #e0e7ff 0%, #f3f4f6 100%);
    }

    .chat-message-sender {
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 4px;
      opacity: 0.8;
    }

    .chat-message-time {
      font-size: 11px;
      opacity: 0.7;
      margin-top: 4px;
    }

    .chat-input-area {
      padding: 12px 16px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      gap: 8px;
    }

    .chat-input-area input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid #e5e7eb;
      border-radius: 24px;
      /* 16px prevents iOS Safari from auto-zooming the viewport on focus. */
      font-size: 16px;
      outline: none;
    }

    .chat-input-area input:focus {
      border-color: ${CONFIG.primaryColor};
    }

    .chat-send-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: ${CONFIG.primaryColor};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .chat-send-btn svg {
      width: 18px;
      height: 18px;
      fill: white;
    }

    .chat-connecting {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      gap: 16px;
    }

    .chat-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #e5e7eb;
      border-top-color: ${CONFIG.primaryColor};
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .chat-system-message {
      text-align: center;
      font-size: 12px;
      color: #6b7280;
      padding: 8px;
    }

    .chat-quick-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px 16px 12px;
      border-top: 1px solid #e5e7eb;
    }

    .chat-quick-reply {
      padding: 8px 14px;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 20px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .chat-quick-reply:hover {
      background: ${CONFIG.primaryColor};
      color: white;
      border-color: ${CONFIG.primaryColor};
    }

    .chat-typing {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 10px 14px;
      background: #f3f4f6;
      border-radius: 16px;
      border-bottom-left-radius: 4px;
      align-self: flex-start;
    }

    .chat-typing-dot {
      width: 8px;
      height: 8px;
      background: #9ca3af;
      border-radius: 50%;
      animation: typing 1.4s infinite;
    }

    .chat-typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .chat-typing-dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes typing {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-4px); }
    }

    #chat-area {
      display: none;
      flex: 1;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    #chat-area.active {
      display: flex;
    }

    .chat-contact-toggle {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }

    .chat-contact-toggle button {
      flex: 1;
      padding: 8px;
      border: 1px solid #e5e7eb;
      background: white;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s;
    }

    .chat-contact-toggle button.active {
      background: ${CONFIG.primaryColor};
      color: white;
      border-color: ${CONFIG.primaryColor};
    }

    .chat-contact-toggle button:hover:not(.active) {
      background: #f3f4f6;
    }

    .chat-validation-error {
      color: #dc2626;
      font-size: 12px;
      margin-top: 4px;
    }
  `;

  // HTML template - simplified, starts in chatbot mode
  const template = `
    <div id="chat-widget-container">
      <div id="chat-widget-window">
        <div class="chat-header">
          <div class="chat-header-title">
            <span id="chat-title">${CONFIG.title}</span>
            <span class="chat-header-status" id="chat-status">🤖 Bot</span>
          </div>
          <button class="chat-header-close" id="chat-close">&times;</button>
        </div>
        <div class="chat-body" id="chat-body">
          <!-- Name entry (quick, no location) -->
          <div class="chat-pre-chat" id="pre-chat-form">
            <h3>👋 Hi there!</h3>
            <p>Chat with our bot or connect with a human agent.</p>
            
            <div class="chat-input-group">
              <label for="chat-name">Your name</label>
              <input type="text" id="chat-name" placeholder="Enter your name" required />
            </div>
            
            <div class="chat-input-group">
              <label>Contact Information <span style="color:#dc2626">*</span></label>
              <div class="chat-contact-toggle">
                <button type="button" id="contact-email-btn" class="active">📧 Email</button>
                <button type="button" id="contact-phone-btn">📱 Phone</button>
              </div>
              <input type="email" id="chat-email" placeholder="your@email.com" />
              <input type="tel" id="chat-phone" placeholder="Your phone number" style="display:none" />
              <div class="chat-validation-error" id="contact-error" style="display:none"></div>
            </div>
            
            <button class="chat-start-btn" id="start-chat-btn">Start Chat</button>
          </div>
          
          <!-- Location prompt (shown when escalating to human) -->
          <div class="chat-pre-chat" id="location-form" style="display:none">
            <h3>🔒 Connect with Support</h3>
            <p>To connect with a human agent, we need to verify your location for security purposes.</p>
            
            <div class="chat-location-status pending" id="location-status">
              <span>📍</span>
              <span id="location-text">Click below to enable location access</span>
            </div>
            
            <button class="chat-start-btn" id="enable-location-btn">Enable Location</button>
            <button class="chat-start-btn" id="connect-human-btn" style="display:none" disabled>Connect to Agent</button>
            <button class="chat-start-btn" id="back-to-bot-btn" style="background:#6b7280;margin-top:8px">← Back to Bot</button>
          </div>
          
          <!-- Connecting state -->
          <div class="chat-connecting" id="chat-connecting" style="display:none">
            <div class="chat-spinner"></div>
            <span id="connecting-text">Connecting to agent...</span>
          </div>
          
          <!-- Chat area -->
          <div id="chat-area">
            <div class="chat-messages" id="chat-messages"></div>
            <div class="chat-quick-replies" id="quick-replies" style="display:none"></div>
            <div class="chat-input-area">
              <input type="text" id="chat-input" placeholder="Type your message..." />
              <button class="chat-send-btn" id="chat-send">
                <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <button id="chat-widget-button">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h10v2H7zm0-3h10v2H7z"/></svg>
      </button>
    </div>
  `;

  // Session persistence: per-site key in sessionStorage
  // (sessionStorage persists across page navigations in the same tab,
  //  clears when the tab closes — exactly the right scope for a chat session)
  const STORAGE_KEY_PREFIX = 'chatWidgetSession_v1::';

  // Chat Widget Class
  class ChatWidget {
    constructor() {
      this.isOpen = false;
      this.isConnected = false;
      this.isBotMode = true;
      this.socket = null;
      this.sessionId = null;
      this.browserLocation = null;
      this.customerName = 'Visitor';
      this.customerContact = null;
      this.messages = [];
      this.chatbotConfig = null;
      this.escalationPending = false;
      this.endedByAdmin = false;
      this.chatStarted = false;
    }

    async init() {
      this.injectStyles();
      this.injectHTML();
      this.bindEvents();
      this.loadSocketIO();
      await this.loadChatbotConfig();
      // Restore prior session (if same tab navigated/reloaded)
      this.restoreState();
    }

    // ---- Session persistence ----
    storageKey() {
      return STORAGE_KEY_PREFIX + (CONFIG.siteApiKey || 'default');
    }

    saveState() {
      try {
        if (typeof sessionStorage === 'undefined') return;
        const state = {
          messages: this.messages,
          customerName: this.customerName,
          customerContact: this.customerContact || null,
          browserLocation: this.browserLocation || null,
          isBotMode: this.isBotMode,
          isConnected: this.isConnected,
          escalationPending: !!this.escalationPending,
          endedByAdmin: !!this.endedByAdmin,
          isOpen: this.isOpen,
          chatStarted: !!this.chatStarted,
          sessionId: this.sessionId || null
        };
        sessionStorage.setItem(this.storageKey(), JSON.stringify(state));
      } catch (e) { /* ignore quota / disabled storage */ }
    }

    loadState() {
      try {
        if (typeof sessionStorage === 'undefined') return null;
        const raw = sessionStorage.getItem(this.storageKey());
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) { return null; }
    }

    clearState() {
      try {
        if (typeof sessionStorage === 'undefined') return;
        sessionStorage.removeItem(this.storageKey());
      } catch (e) { /* ignore */ }
    }

    restoreState() {
      const state = this.loadState();
      if (!state || !state.chatStarted) return;

      // If the agent ended the conversation, treat refresh as a clean slate
      // (don't keep a closed chat open across page loads).
      if (state.endedByAdmin) {
        this.clearState();
        return;
      }

      this.messages = Array.isArray(state.messages) ? state.messages : [];
      this.customerName = state.customerName || 'Visitor';
      this.customerContact = state.customerContact || null;
      this.browserLocation = state.browserLocation || null;
      this.isBotMode = state.isBotMode !== false;
      this.escalationPending = !!state.escalationPending;
      this.endedByAdmin = !!state.endedByAdmin;
      this.chatStarted = true;
      this.isConnected = false; // socket needs to reconnect

      // Skip the pre-chat form, show the chat area
      const preChatForm = document.getElementById('pre-chat-form');
      if (preChatForm) preChatForm.style.display = 'none';
      const chatArea = document.getElementById('chat-area');
      if (chatArea) chatArea.classList.add('active');

      this.updateChatStatus(this.isBotMode ? 'bot' : 'human');
      this.replayMessages();

      if (this.isBotMode) {
        this.showQuickReplies();
      } else {
        const qr = document.getElementById('quick-replies');
        if (qr) qr.style.display = 'none';
      }

      // If they were in a live agent chat (and not ended), silently reconnect
      if (!this.isBotMode && !this.endedByAdmin) {
        this.reconnectHumanSession();
      }

      if (this.endedByAdmin) {
        const input = document.getElementById('chat-input');
        if (input) {
          input.disabled = true;
          input.placeholder = 'Conversation ended';
        }
      }

      // Always start with the bubble visible on page load; the user can
      // re-open the chat if they want to continue. Avoids the bubble
      // disappearing when restored isOpen=true gets out of sync with the
      // rendered chat window.
      this.isOpen = false;
    }

    replayMessages() {
      const container = document.getElementById('chat-messages');
      if (!container) return;
      container.innerHTML = '';
      const botName = this.chatbotConfig?.botName || 'Support Bot';
      for (const m of this.messages) {
        const time = m.timestamp ? new Date(m.timestamp) : new Date();
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgEl = document.createElement('div');
        if (m.type === 'bot') {
          msgEl.className = 'chat-message bot';
          msgEl.innerHTML =
            `<div class="chat-message-sender">🤖 ${this.escapeHtml(botName)}</div>` +
            `<div>${this.escapeHtml(m.text)}</div>` +
            `<div class="chat-message-time">${timeStr}</div>`;
        } else if (m.type === 'admin') {
          const senderHtml = m.senderName
            ? `<div class="chat-message-sender">${this.escapeHtml(m.senderName)}</div>`
            : '';
          msgEl.className = 'chat-message admin';
          msgEl.innerHTML =
            senderHtml +
            `<div>${this.escapeHtml(m.text)}</div>` +
            `<div class="chat-message-time">${timeStr}</div>`;
        } else {
          msgEl.className = `chat-message ${m.type || 'customer'}`;
          msgEl.innerHTML =
            `<div>${this.escapeHtml(m.text)}</div>` +
            `<div class="chat-message-time">${timeStr}</div>`;
        }
        container.appendChild(msgEl);
      }
      container.scrollTop = container.scrollHeight;
    }

    reconnectHumanSession() {
      if (typeof io === 'undefined') {
        // socket.io may not be loaded yet; retry shortly
        setTimeout(() => this.reconnectHumanSession(), 300);
        return;
      }
      this.socket = io(CONFIG.serverUrl);
      const startNewSession = () => {
        this.socket.emit('session:start', {
          name: this.customerName,
          contact: this.customerContact,
          location: this.browserLocation,
          chatHistory: this.messages,
          siteId: CONFIG.siteId,
          apiKey: CONFIG.siteApiKey
        });
      };
      this.socket.on('connect', () => {
        // If we have a previously-issued sessionId, try to resume it
        // so the support dashboard sees the SAME session, not a new one.
        if (this.sessionId) {
          this.socket.emit('session:resume', this.sessionId);
        } else {
          startNewSession();
        }
      });
      this.socket.on('session:not-found', () => {
        // Server doesn't have our session anymore — start fresh.
        this.sessionId = null;
        startNewSession();
      });
      this.socket.on('session:resumed', (data) => {
        this.sessionId = data.sessionId;
        this.isConnected = true;
        this.saveState();
      });
      this.socket.on('session:started', (data) => {
        this.sessionId = data.sessionId;
        this.isConnected = true;
        this.saveState();
      });
      this.socket.on('chat:message', (msg) => {
        if (msg.sender === 'customer') return;
        const body = msg.message != null ? msg.message : msg.text;
        this.addMessage(body, 'admin', msg.timestamp, msg.senderName);
      });
      this.socket.on('disconnect', () => {
        if (this.endedByAdmin) return;
      });
      this.socket.on('session:closed-by-admin', (data) => {
        this.endedByAdmin = true;
        const msg = (data && data.message) || 'This conversation has been closed by the support team.';
        this.addSystemMessage(msg);
        const input = document.getElementById('chat-input');
        if (input) {
          input.disabled = true;
          input.placeholder = 'Conversation ended';
        }
        this.saveState();
      });
    }
    // ---- end session persistence ----

    injectStyles() {
      const styleEl = document.createElement('style');
      styleEl.textContent = styles;
      document.head.appendChild(styleEl);
    }

    injectHTML() {
      const container = document.createElement('div');
      container.innerHTML = template;
      document.body.appendChild(container.firstElementChild);
    }

    bindEvents() {
      document.getElementById('chat-widget-button').addEventListener('click', () => this.toggle());
      document.getElementById('chat-close').addEventListener('click', () => this.close());
      document.getElementById('start-chat-btn').addEventListener('click', () => this.startBotChat());
      document.getElementById('enable-location-btn').addEventListener('click', () => this.requestLocation());
      document.getElementById('connect-human-btn').addEventListener('click', () => this.connectToHuman());
      document.getElementById('back-to-bot-btn').addEventListener('click', () => this.backToBot());
      document.getElementById('chat-send').addEventListener('click', () => this.sendMessage());
      document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendMessage();
      });

      // Contact type toggle
      document.getElementById('contact-email-btn').addEventListener('click', () => this.toggleContactType('email'));
      document.getElementById('contact-phone-btn').addEventListener('click', () => this.toggleContactType('phone'));
    }

    toggleContactType(type) {
      const emailBtn = document.getElementById('contact-email-btn');
      const phoneBtn = document.getElementById('contact-phone-btn');
      const emailInput = document.getElementById('chat-email');
      const phoneInput = document.getElementById('chat-phone');
      const errorEl = document.getElementById('contact-error');

      errorEl.style.display = 'none';

      if (type === 'email') {
        emailBtn.classList.add('active');
        phoneBtn.classList.remove('active');
        emailInput.style.display = 'block';
        phoneInput.style.display = 'none';
      } else {
        phoneBtn.classList.add('active');
        emailBtn.classList.remove('active');
        phoneInput.style.display = 'block';
        emailInput.style.display = 'none';
      }
    }

    loadSocketIO() {
      const script = document.createElement('script');
      script.src = CONFIG.serverUrl + '/socket.io/socket.io.js';
      script.onload = () => {
        console.log('Socket.IO loaded');
      };
      document.head.appendChild(script);
    }

    async loadChatbotConfig() {
      try {
        const url = CONFIG.siteApiKey
          ? CONFIG.serverUrl + '/api/chatbot/config?siteApiKey=' + encodeURIComponent(CONFIG.siteApiKey)
          : CONFIG.serverUrl + '/api/chatbot/config';
        const response = await fetch(url);
        if (response.ok) {
          this.chatbotConfig = await response.json();
          console.log('Chatbot config loaded:', this.chatbotConfig);
        }
      } catch (err) {
        console.error('Failed to load chatbot config:', err);
        this.chatbotConfig = {
          enabled: true,
          botName: 'Support Bot',
          welcomeMessage: "Hi! How can I help you today?",
          quickReplies: []
        };
      }
    }

    toggle() {
      this.isOpen ? this.close() : this.open();
    }

    open() {
      this.isOpen = true;
      document.getElementById('chat-widget-window').classList.add('open');
      const c = document.getElementById('chat-widget-container');
      if (c) c.classList.add('chat-open');
      this.saveState();
    }

    close() {
      this.isOpen = false;
      document.getElementById('chat-widget-window').classList.remove('open');
      const c = document.getElementById('chat-widget-container');
      if (c) c.classList.remove('chat-open');
      this.saveState();
    }

    startBotChat() {
      const nameInput = document.getElementById('chat-name');
      const emailInput = document.getElementById('chat-email');
      const phoneInput = document.getElementById('chat-phone');
      const errorEl = document.getElementById('contact-error');

      this.customerName = nameInput.value.trim() || 'Visitor';

      // Validate contact info
      const isEmailMode = document.getElementById('contact-email-btn').classList.contains('active');
      let contactValue = '';

      if (isEmailMode) {
        contactValue = emailInput.value.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!contactValue || !emailRegex.test(contactValue)) {
          errorEl.textContent = 'Please enter a valid email address';
          errorEl.style.display = 'block';
          emailInput.focus();
          return;
        }
        this.customerContact = { type: 'email', value: contactValue };
      } else {
        contactValue = phoneInput.value.trim();
        const phoneRegex = /^[+]?[0-9\s\-()]{7,}$/;
        if (!contactValue || !phoneRegex.test(contactValue)) {
          errorEl.textContent = 'Please enter a valid phone number';
          errorEl.style.display = 'block';
          phoneInput.focus();
          return;
        }
        this.customerContact = { type: 'phone', value: contactValue };
      }

      errorEl.style.display = 'none';

      // Show chat area in bot mode
      document.getElementById('pre-chat-form').style.display = 'none';
      const chatArea = document.getElementById('chat-area');
      chatArea.classList.add('active');

      // Update header to show bot mode
      this.updateChatStatus('bot');

      // Show welcome message from bot
      if (this.chatbotConfig?.welcomeMessage) {
        this.addBotMessage(this.chatbotConfig.welcomeMessage);
      }

      // Show quick replies
      this.showQuickReplies();

      // Focus input
      document.getElementById('chat-input').focus();

      this.chatStarted = true;
      this.saveState();
    }

    showQuickReplies() {
      const container = document.getElementById('quick-replies');
      if (!this.chatbotConfig?.quickReplies?.length || !this.isBotMode) {
        container.style.display = 'none';
        return;
      }

      // If business-hours gating is enabled and we're outside hours,
      // hide any quick reply that would trigger human escalation.
      let replies = this.chatbotConfig.quickReplies;
      if (this.chatbotConfig.humanAvailable === false) {
        const keywords = (this.chatbotConfig.escalationKeywords || []).map(k => String(k).toLowerCase());
        replies = replies.filter(r => {
          const lower = String(r).toLowerCase();
          return !keywords.some(k => lower.includes(k));
        });
      }

      if (!replies.length) {
        container.style.display = 'none';
        return;
      }

      container.style.display = 'flex';
      container.innerHTML = replies.map(reply =>
        `<button class="chat-quick-reply">${this.escapeHtml(reply)}</button>`
      ).join('');

      // Bind click events
      container.querySelectorAll('.chat-quick-reply').forEach(btn => {
        btn.addEventListener('click', () => {
          const text = btn.textContent;
          document.getElementById('chat-input').value = text;
          this.sendMessage();
        });
      });
    }

    async sendMessage() {
      const input = document.getElementById('chat-input');
      const message = input.value.trim();

      if (!message) return;

      // Add customer message to UI
      this.addMessage(message, 'customer');
      input.value = '';

      if (this.isBotMode) {
        // Process through chatbot
        await this.processBotMessage(message);
      } else if (this.isConnected) {
        // Send to human agent
        this.socket.emit('chat:message', { sessionId: this.sessionId, message });
      }
    }

    async processBotMessage(message) {
      // Show typing indicator
      this.showTyping();

      try {
        const url = CONFIG.siteApiKey
          ? CONFIG.serverUrl + '/api/chatbot/message?siteApiKey=' + encodeURIComponent(CONFIG.siteApiKey)
          : CONFIG.serverUrl + '/api/chatbot/message';
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, siteApiKey: CONFIG.siteApiKey || undefined })
        });

        if (response.ok) {
          const data = await response.json();

          // Remove typing indicator
          this.hideTyping();

          if (data.type === 'escalate') {
            // User wants to talk to human
            this.addBotMessage(data.message);
            this.escalationPending = true;

            // After a brief delay, show location form
            setTimeout(() => {
              this.promptForHumanSupport();
            }, 1500);
          } else if (data.type === 'offHours') {
            // Escalation requested but outside business hours.
            // Refresh local config so the quick-reply gets hidden too.
            this.chatbotConfig.humanAvailable = false;
            this.addBotMessage(data.message);
            this.showQuickReplies();
          } else {
            // Bot response (faq or fallback)
            this.addBotMessage(data.message);

            // Show quick replies again if it was a fallback
            if (data.type === 'fallback') {
              this.showQuickReplies();
            }
          }
        } else {
          this.hideTyping();
          this.addBotMessage("I'm having trouble connecting. Please try again.");
        }
      } catch (err) {
        this.hideTyping();
        this.addBotMessage("I'm having trouble connecting. Please try again.");
        console.error('Bot message error:', err);
      }
    }

    showTyping() {
      const container = document.getElementById('chat-messages');
      const typingEl = document.createElement('div');
      typingEl.className = 'chat-typing';
      typingEl.id = 'typing-indicator';
      typingEl.innerHTML = `
        <div class="chat-typing-dot"></div>
        <div class="chat-typing-dot"></div>
        <div class="chat-typing-dot"></div>
      `;
      container.appendChild(typingEl);
      container.scrollTop = container.scrollHeight;
    }

    hideTyping() {
      const typing = document.getElementById('typing-indicator');
      if (typing) typing.remove();
    }

    promptForHumanSupport() {
      // Hide chat area, show location form
      document.getElementById('chat-area').classList.remove('active');
      document.getElementById('location-form').style.display = 'flex';
      document.getElementById('quick-replies').style.display = 'none';
    }

    backToBot() {
      this.escalationPending = false;
      document.getElementById('location-form').style.display = 'none';
      document.getElementById('chat-area').classList.add('active');
      this.showQuickReplies();
      this.addBotMessage("No problem! I'm still here to help. What would you like to know?");
    }

    requestLocation() {
      const statusEl = document.getElementById('location-status');
      const textEl = document.getElementById('location-text');
      const enableBtn = document.getElementById('enable-location-btn');
      const connectBtn = document.getElementById('connect-human-btn');

      statusEl.className = 'chat-location-status pending';
      textEl.textContent = 'Requesting location access...';

      if (!navigator.geolocation) {
        statusEl.className = 'chat-location-status error';
        textEl.textContent = 'Geolocation is not supported by your browser';
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.browserLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          };

          statusEl.className = 'chat-location-status success';
          textEl.textContent = 'Location access granted ✓';
          enableBtn.style.display = 'none';
          connectBtn.style.display = 'block';
          connectBtn.disabled = false;
        },
        (error) => {
          statusEl.className = 'chat-location-status error';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              textEl.textContent = 'Location access denied. Please enable it to connect with support.';
              break;
            case error.POSITION_UNAVAILABLE:
              textEl.textContent = 'Location information unavailable.';
              break;
            case error.TIMEOUT:
              textEl.textContent = 'Location request timed out.';
              break;
            default:
              textEl.textContent = 'An error occurred getting your location.';
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    }

    async connectToHuman() {
      if (!this.browserLocation) {
        alert('Please enable location access first.');
        return;
      }

      // Show connecting state
      document.getElementById('location-form').style.display = 'none';
      document.getElementById('chat-connecting').style.display = 'flex';
      document.getElementById('connecting-text').textContent = 'Connecting to agent...';

      // Switch to human mode
      this.isBotMode = false;
      this.escalationPending = false;

      // Connect to server
      this.socket = io(CONFIG.serverUrl);

      this.socket.on('connect', () => {
        console.log('Connected to chat server');
        this.socket.emit('session:start', {
          name: this.customerName,
          contact: this.customerContact,
          location: this.browserLocation,
          chatHistory: this.messages, // Send bot conversation history
          siteId: CONFIG.siteId,
          apiKey: CONFIG.siteApiKey
        });
      });

      this.socket.on('session:started', (data) => {
        this.sessionId = data.sessionId;
        this.isConnected = true;

        // Show chat area
        document.getElementById('chat-connecting').style.display = 'none';
        const chatArea = document.getElementById('chat-area');
        chatArea.classList.add('active');

        // Hide quick replies in human mode
        document.getElementById('quick-replies').style.display = 'none';

        // Update header to show human mode
        this.updateChatStatus('human');

        this.addSystemMessage('Connected! A support agent will be with you shortly.');
        this.saveState();
      });

      this.socket.on('chat:message', (msg) => {
        // Don't echo our own messages back to us
        if (msg.sender === 'customer') return;
        const body = msg.message != null ? msg.message : msg.text;
        this.addMessage(body, 'admin', msg.timestamp, msg.senderName);
      });

      this.socket.on('error', (data) => {
        document.getElementById('chat-connecting').style.display = 'none';

        // Geo-block: show a clear, full-card blocked notice instead of the location-form red pin
        if (data && (data.code === 'GEO_BLOCKED' || data.error === 'GEO_BLOCKED')) {
          const body = document.getElementById('chat-body');
          if (body) {
            body.innerHTML = `
                            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 24px;height:100%;">
                                <div style="font-size:48px;margin-bottom:12px;">🌍</div>
                                <h3 style="margin:0;color:#111;font-size:18px;">Chat unavailable in your region</h3>
                            </div>`;
          }
          try { this.socket.disconnect(); } catch (e) { }
          return;
        }

        document.getElementById('location-form').style.display = 'flex';
        const statusEl = document.getElementById('location-status');
        const textEl = document.getElementById('location-text');
        statusEl.className = 'chat-location-status error';
        textEl.textContent = (data && data.message) || 'Could not connect.';
      });

      this.socket.on('disconnect', () => {
        if (this.endedByAdmin) return;
        this.addSystemMessage('Disconnected from server. Trying to reconnect...');
      });

      this.socket.on('session:closed-by-admin', (data) => {
        this.endedByAdmin = true;
        const msg = (data && data.message) || 'This conversation has been closed by the support team.';
        this.addSystemMessage(msg);
        const input = document.getElementById('chat-input');
        if (input) {
          input.value = '';
          input.disabled = true;
          input.placeholder = 'Conversation ended';
        }
        this.saveState();
      });
    }

    updateChatStatus(mode) {
      const statusEl = document.getElementById('chat-status');
      if (mode === 'bot') {
        statusEl.textContent = '🤖 Bot';
        statusEl.style.background = '';
      } else {
        statusEl.textContent = '👤 Live Agent';
        statusEl.style.background = '';
      }
    }

    addMessage(text, type, timestamp, senderName) {
      const container = document.getElementById('chat-messages');
      const time = timestamp ? new Date(timestamp) : new Date();

      const msgEl = document.createElement('div');
      msgEl.className = `chat-message ${type}`;

      let senderHtml = '';
      if (type === 'admin' && senderName) {
        senderHtml = `<div class="chat-message-sender">${this.escapeHtml(senderName)}</div>`;
      }

      msgEl.innerHTML = `
        ${senderHtml}
        <div>${this.escapeHtml(text)}</div>
        <div class="chat-message-time">${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      `;

      container.appendChild(msgEl);
      container.scrollTop = container.scrollHeight;

      // Store message in history
      this.messages.push({ text, type, timestamp: time.toISOString(), senderName: senderName || null });
      this.saveState();
    }

    addBotMessage(text) {
      const container = document.getElementById('chat-messages');
      const time = new Date();
      const botName = this.chatbotConfig?.botName || 'Support Bot';

      const msgEl = document.createElement('div');
      msgEl.className = 'chat-message bot';
      msgEl.innerHTML = `
        <div class="chat-message-sender">🤖 ${this.escapeHtml(botName)}</div>
        <div>${this.escapeHtml(text)}</div>
        <div class="chat-message-time">${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      `;

      container.appendChild(msgEl);
      container.scrollTop = container.scrollHeight;

      // Store in history
      this.messages.push({ text, type: 'bot', timestamp: time.toISOString() });
      this.saveState();
    }

    addSystemMessage(text) {
      const container = document.getElementById('chat-messages');
      const msgEl = document.createElement('div');
      msgEl.className = 'chat-system-message';
      msgEl.textContent = text;
      container.appendChild(msgEl);
      container.scrollTop = container.scrollHeight;
    }

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  }

  // Expose global ChatWidget API for external sites
  window.ChatWidget = {
    init: function (options) {
      // Allow re-configuration before init
      if (options) {
        if (options.serverUrl) CONFIG.serverUrl = options.serverUrl;
        if (options.siteApiKey) CONFIG.siteApiKey = options.siteApiKey;
        if (options.primaryColor) CONFIG.primaryColor = options.primaryColor;
        if (options.secondaryColor) CONFIG.secondaryColor = options.secondaryColor;
        if (options.title) CONFIG.title = options.title;
        if (options.position) CONFIG.position = options.position;
      }
      new ChatWidget().init();
    }
  };

  // Auto-initialize widget when DOM is ready (if no external config expected)
  // If siteApiKey is needed, external code should call ChatWidget.init() manually
  if (!window.ChatWidgetConfig?.waitForInit) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => new ChatWidget().init());
    } else {
      new ChatWidget().init();
    }
  }
})();
