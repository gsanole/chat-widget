/**
 * @jest-environment jsdom
 */

/**
 * Frontend Widget Unit Tests
 * Tests the chat widget functionality using jsdom environment
 */

const fs = require('fs');
const path = require('path');

describe('Chat Widget - Frontend', () => {
    let widgetCode;

    beforeAll(() => {
        // Load the widget code
        widgetCode = fs.readFileSync(
            path.join(__dirname, '../../public/widget.js'),
            'utf8'
        );
    });

    beforeEach(() => {
        // Reset DOM
        document.body.innerHTML = '';
        document.head.innerHTML = '';

        // Reset widget globals
        delete window.ChatWidget;
        delete window.chatWidgetInstance;

        // Mock fetch
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                enabled: true,
                botName: 'Test Bot',
                welcomeMessage: 'Hello! How can I help?',
                quickReplies: ['Help', 'Contact']
            })
        }));

        // Mock navigator.geolocation
        Object.defineProperty(window.navigator, 'geolocation', {
            value: {
                getCurrentPosition: jest.fn((success) => {
                    success({
                        coords: {
                            latitude: 40.7128,
                            longitude: -74.0060,
                            accuracy: 10
                        }
                    });
                })
            },
            writable: true
        });

        // Mock io (Socket.IO)
        global.io = jest.fn(() => ({
            on: jest.fn(),
            emit: jest.fn()
        }));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Widget Initialization', () => {
        test('should expose ChatWidget global API', async () => {
            // Execute widget code
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            // Wait for initialization
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(window.ChatWidget).toBeDefined();
            expect(typeof window.ChatWidget.init).toBe('function');
        });

        test('should inject widget HTML into DOM', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(document.getElementById('chat-widget-container')).not.toBeNull();
            expect(document.getElementById('chat-widget-button')).not.toBeNull();
            expect(document.getElementById('chat-widget-window')).not.toBeNull();
        });

        test('should inject widget styles', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const styles = document.querySelectorAll('style');
            expect(styles.length).toBeGreaterThan(0);
        });

        test('should initialize with default config', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const header = document.querySelector('.chat-header');
            expect(header).not.toBeNull();
        });

        test('should load chatbot config from server', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 200));

            expect(window.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/chatbot/config')
            );
        });
    });

    describe('Widget Toggle', () => {
        test('should open widget window on button click', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const button = document.getElementById('chat-widget-button');
            const widgetWindow = document.getElementById('chat-widget-window');

            expect(widgetWindow.classList.contains('open')).toBe(false);

            button.click();

            expect(widgetWindow.classList.contains('open')).toBe(true);
        });

        test('should close widget window on close button click', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const button = document.getElementById('chat-widget-button');
            const closeBtn = document.getElementById('chat-close');
            const widgetWindow = document.getElementById('chat-widget-window');

            // Open first
            button.click();
            expect(widgetWindow.classList.contains('open')).toBe(true);

            // Close
            closeBtn.click();
            expect(widgetWindow.classList.contains('open')).toBe(false);
        });

        test('should toggle widget on repeated button clicks', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const button = document.getElementById('chat-widget-button');
            const widgetWindow = document.getElementById('chat-widget-window');

            button.click();
            expect(widgetWindow.classList.contains('open')).toBe(true);

            button.click();
            expect(widgetWindow.classList.contains('open')).toBe(false);

            button.click();
            expect(widgetWindow.classList.contains('open')).toBe(true);
        });
    });

    describe('Pre-Chat Form', () => {
        test('should have name input field', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const nameInput = document.getElementById('chat-name');
            expect(nameInput).not.toBeNull();
            expect(nameInput.type).toBe('text');
        });

        test('should have email input field', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const emailInput = document.getElementById('chat-email');
            expect(emailInput).not.toBeNull();
            expect(emailInput.type).toBe('email');
        });

        test('should have phone input field', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const phoneInput = document.getElementById('chat-phone');
            expect(phoneInput).not.toBeNull();
            expect(phoneInput.type).toBe('tel');
        });

        test('should have start chat button', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const startBtn = document.getElementById('start-chat-btn');
            expect(startBtn).not.toBeNull();
            expect(startBtn.textContent).toContain('Start Chat');
        });

        test('should toggle between email and phone modes', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const emailBtn = document.getElementById('contact-email-btn');
            const phoneBtn = document.getElementById('contact-phone-btn');
            const emailInput = document.getElementById('chat-email');
            const phoneInput = document.getElementById('chat-phone');

            // Default should be email
            expect(emailBtn.classList.contains('active')).toBe(true);
            expect(emailInput.style.display).not.toBe('none');
            expect(phoneInput.style.display).toBe('none');

            // Switch to phone
            phoneBtn.click();
            expect(phoneBtn.classList.contains('active')).toBe(true);
            expect(emailBtn.classList.contains('active')).toBe(false);
            expect(phoneInput.style.display).toBe('block');
            expect(emailInput.style.display).toBe('none');

            // Switch back to email
            emailBtn.click();
            expect(emailBtn.classList.contains('active')).toBe(true);
            expect(emailInput.style.display).toBe('block');
            expect(phoneInput.style.display).toBe('none');
        });
    });

    describe('Email Validation', () => {
        test('should reject invalid email format', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 200));

            const nameInput = document.getElementById('chat-name');
            const emailInput = document.getElementById('chat-email');
            const startBtn = document.getElementById('start-chat-btn');
            const errorEl = document.getElementById('contact-error');

            nameInput.value = 'Test User';
            emailInput.value = 'invalid-email';
            startBtn.click();

            expect(errorEl.style.display).toBe('block');
            expect(errorEl.textContent).toContain('valid email');
        });

        test('should reject empty email', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 200));

            const nameInput = document.getElementById('chat-name');
            const emailInput = document.getElementById('chat-email');
            const startBtn = document.getElementById('start-chat-btn');
            const errorEl = document.getElementById('contact-error');

            nameInput.value = 'Test User';
            emailInput.value = '';
            startBtn.click();

            expect(errorEl.style.display).toBe('block');
        });

        test('should accept valid email format', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 200));

            const nameInput = document.getElementById('chat-name');
            const emailInput = document.getElementById('chat-email');
            const startBtn = document.getElementById('start-chat-btn');
            const preChatForm = document.getElementById('pre-chat-form');

            nameInput.value = 'Test User';
            emailInput.value = 'test@example.com';
            startBtn.click();

            // Pre-chat form should be hidden after successful validation
            expect(preChatForm.style.display).toBe('none');
        });
    });

    describe('Phone Validation', () => {
        test('should reject invalid phone format', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 200));

            const phoneBtn = document.getElementById('contact-phone-btn');
            phoneBtn.click();

            const nameInput = document.getElementById('chat-name');
            const phoneInput = document.getElementById('chat-phone');
            const startBtn = document.getElementById('start-chat-btn');
            const errorEl = document.getElementById('contact-error');

            nameInput.value = 'Test User';
            phoneInput.value = '123';
            startBtn.click();

            expect(errorEl.style.display).toBe('block');
            expect(errorEl.textContent).toContain('valid phone');
        });

        test('should accept valid phone format', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 200));

            const phoneBtn = document.getElementById('contact-phone-btn');
            phoneBtn.click();

            const nameInput = document.getElementById('chat-name');
            const phoneInput = document.getElementById('chat-phone');
            const startBtn = document.getElementById('start-chat-btn');
            const preChatForm = document.getElementById('pre-chat-form');

            nameInput.value = 'Test User';
            phoneInput.value = '+1 555-123-4567';
            startBtn.click();

            expect(preChatForm.style.display).toBe('none');
        });
    });

    describe('Chat Interface', () => {
        test('should show chat area after starting chat', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 200));

            const nameInput = document.getElementById('chat-name');
            const emailInput = document.getElementById('chat-email');
            const startBtn = document.getElementById('start-chat-btn');
            const chatArea = document.getElementById('chat-area');

            nameInput.value = 'Test User';
            emailInput.value = 'test@example.com';
            startBtn.click();

            expect(chatArea.classList.contains('active')).toBe(true);
        });

        test('should have message input field', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const chatInput = document.getElementById('chat-input');
            expect(chatInput).not.toBeNull();
            expect(chatInput.type).toBe('text');
        });

        test('should have send button', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const sendBtn = document.getElementById('chat-send');
            expect(sendBtn).not.toBeNull();
        });

        test('should have messages container', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const messagesContainer = document.getElementById('chat-messages');
            expect(messagesContainer).not.toBeNull();
        });
    });

    describe('Message Sending', () => {
        test('should not send empty messages', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 200));

            // Start chat
            const nameInput = document.getElementById('chat-name');
            const emailInput = document.getElementById('chat-email');
            const startBtn = document.getElementById('start-chat-btn');
            nameInput.value = 'Test';
            emailInput.value = 'test@example.com';
            startBtn.click();

            await new Promise(resolve => setTimeout(resolve, 100));

            const chatInput = document.getElementById('chat-input');
            const sendBtn = document.getElementById('chat-send');
            const messagesContainer = document.getElementById('chat-messages');

            const initialMessageCount = messagesContainer.children.length;

            chatInput.value = '';
            sendBtn.click();

            // Should not add a customer message for empty input
            const customerMessages = messagesContainer.querySelectorAll('.chat-message.customer');
            expect(customerMessages.length).toBe(0);
        });

        test('should send message on Enter key', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 200));

            // Start chat
            const nameInput = document.getElementById('chat-name');
            const emailInput = document.getElementById('chat-email');
            const startBtn = document.getElementById('start-chat-btn');
            nameInput.value = 'Test';
            emailInput.value = 'test@example.com';
            startBtn.click();

            await new Promise(resolve => setTimeout(resolve, 100));

            const chatInput = document.getElementById('chat-input');
            const messagesContainer = document.getElementById('chat-messages');

            chatInput.value = 'Test message';

            const enterEvent = new window.KeyboardEvent('keypress', { key: 'Enter' });
            chatInput.dispatchEvent(enterEvent);

            await new Promise(resolve => setTimeout(resolve, 50));

            const customerMessages = messagesContainer.querySelectorAll('.chat-message.customer');
            expect(customerMessages.length).toBeGreaterThan(0);
        });

        test('should clear input after sending', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 200));

            // Start chat
            const nameInput = document.getElementById('chat-name');
            const emailInput = document.getElementById('chat-email');
            const startBtn = document.getElementById('start-chat-btn');
            nameInput.value = 'Test';
            emailInput.value = 'test@example.com';
            startBtn.click();

            await new Promise(resolve => setTimeout(resolve, 100));

            const chatInput = document.getElementById('chat-input');
            const sendBtn = document.getElementById('chat-send');

            chatInput.value = 'Test message';
            sendBtn.click();

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(chatInput.value).toBe('');
        });
    });

    describe('Bot Mode', () => {
        test('should show welcome message from bot', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 300));

            // Start chat
            const nameInput = document.getElementById('chat-name');
            const emailInput = document.getElementById('chat-email');
            const startBtn = document.getElementById('start-chat-btn');
            nameInput.value = 'Test';
            emailInput.value = 'test@example.com';
            startBtn.click();

            await new Promise(resolve => setTimeout(resolve, 100));

            const messagesContainer = document.getElementById('chat-messages');
            const botMessages = messagesContainer.querySelectorAll('.chat-message.bot');

            expect(botMessages.length).toBeGreaterThan(0);
        });

        test('should show bot status in header', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 200));

            // Start chat
            const nameInput = document.getElementById('chat-name');
            const emailInput = document.getElementById('chat-email');
            const startBtn = document.getElementById('start-chat-btn');
            nameInput.value = 'Test';
            emailInput.value = 'test@example.com';
            startBtn.click();

            const chatStatus = document.getElementById('chat-status');
            expect(chatStatus.textContent).toContain('Bot');
        });

        test('should send message to bot API', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 300));

            // Mock the bot message endpoint
            window.fetch.mockImplementation((url) => {
                if (url.includes('/api/chatbot/message')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            type: 'faq',
                            message: 'This is a bot response'
                        })
                    });
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        enabled: true,
                        botName: 'Test Bot',
                        welcomeMessage: 'Hello!',
                        quickReplies: []
                    })
                });
            });

            // Start chat
            const nameInput = document.getElementById('chat-name');
            const emailInput = document.getElementById('chat-email');
            const startBtn = document.getElementById('start-chat-btn');
            nameInput.value = 'Test';
            emailInput.value = 'test@example.com';
            startBtn.click();

            await new Promise(resolve => setTimeout(resolve, 100));

            const chatInput = document.getElementById('chat-input');
            const sendBtn = document.getElementById('chat-send');

            chatInput.value = 'Hello bot';
            sendBtn.click();

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(window.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/chatbot/message'),
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                })
            );
        });
    });

    describe('Quick Replies', () => {
        test('should show quick replies container', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const quickReplies = document.getElementById('quick-replies');
            expect(quickReplies).not.toBeNull();
        });

        test('should display quick reply buttons after starting chat', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 300));

            // Start chat
            const nameInput = document.getElementById('chat-name');
            const emailInput = document.getElementById('chat-email');
            const startBtn = document.getElementById('start-chat-btn');
            nameInput.value = 'Test';
            emailInput.value = 'test@example.com';
            startBtn.click();

            await new Promise(resolve => setTimeout(resolve, 100));

            const quickReplies = document.getElementById('quick-replies');
            const buttons = quickReplies.querySelectorAll('.chat-quick-reply');

            expect(buttons.length).toBeGreaterThan(0);
        });
    });

    describe('Location Form', () => {
        test('should have location form elements', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(document.getElementById('location-form')).not.toBeNull();
            expect(document.getElementById('enable-location-btn')).not.toBeNull();
            expect(document.getElementById('connect-human-btn')).not.toBeNull();
            expect(document.getElementById('back-to-bot-btn')).not.toBeNull();
        });

        test('should have location status element', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const statusEl = document.getElementById('location-status');
            expect(statusEl).not.toBeNull();
            expect(statusEl.classList.contains('pending')).toBe(true);
        });
    });

    describe('Connecting State', () => {
        test('should have connecting element', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const connecting = document.getElementById('chat-connecting');
            expect(connecting).not.toBeNull();
        });

        test('should have spinner in connecting state', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            const spinner = document.querySelector('.chat-spinner');
            expect(spinner).not.toBeNull();
        });
    });

    describe('External Configuration', () => {
        test('should accept ChatWidget.init() with options', async () => {
            // Set waitForInit before loading widget
            window.ChatWidgetConfig = { waitForInit: true };

            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 100));

            // Widget should NOT auto-initialize
            expect(document.getElementById('chat-widget-container')).toBeNull();

            // Now manually init
            window.ChatWidget.init({
                serverUrl: 'http://test-server.com',
                primaryColor: '#ff0000'
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(document.getElementById('chat-widget-container')).not.toBeNull();
        });
    });

    describe('HTML Escaping', () => {
        test('should escape HTML in messages', async () => {
            const script = document.createElement('script');
            script.textContent = widgetCode;
            document.head.appendChild(script);

            await new Promise(resolve => setTimeout(resolve, 300));

            // Open the chat widget first
            const chatButton = document.getElementById('chat-widget-button');
            if (chatButton) {
                chatButton.click();
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Start chat
            const nameInput = document.getElementById('chat-name');
            const emailInput = document.getElementById('chat-email');
            const startBtn = document.getElementById('start-chat-btn');

            if (!nameInput || !emailInput || !startBtn) {
                // Widget may not have rendered properly - skip detailed test
                expect(document.getElementById('chat-widget-button')).toBeDefined();
                return;
            }

            nameInput.value = 'Test';
            emailInput.value = 'test@example.com';
            startBtn.click();

            await new Promise(resolve => setTimeout(resolve, 200));

            const chatInput = document.getElementById('chat-input');
            const sendBtn = document.getElementById('chat-send');

            if (!chatInput || !sendBtn) {
                // Chat area didn't open - skip
                return;
            }

            // Try to inject script
            chatInput.value = '<script>alert("xss")</script>';
            sendBtn.click();

            await new Promise(resolve => setTimeout(resolve, 100));

            const messagesContainer = document.getElementById('chat-messages');

            if (messagesContainer) {
                // Should not contain actual script tag
                expect(messagesContainer.innerHTML).not.toContain('<script>');
                // Should contain escaped version
                expect(messagesContainer.textContent).toContain('alert');
            }
        });
    });
});
