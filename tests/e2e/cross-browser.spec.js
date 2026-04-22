/**
 * Cross-Browser Compatibility Tests
 * Tests that verify consistent behavior across different browsers
 */

const { test, expect } = require('@playwright/test');

test.describe('Cross-Browser Compatibility', () => {
    test.describe('Page Loading', () => {
        test('should load demo page correctly', async ({ page, browserName }) => {
            await page.goto('/');

            // Page should have correct title
            const title = await page.title();
            expect(title).toBeTruthy();

            // Widget button should be visible
            const button = page.locator('#chat-widget-button');
            await expect(button).toBeVisible();
        });

        test('should load admin page correctly', async ({ page, browserName }) => {
            await page.goto('/admin');

            // Login form should be visible
            const loginBox = page.locator('.login-box');
            await expect(loginBox).toBeVisible();
        });

        test('should serve static files correctly', async ({ page }) => {
            const response = await page.goto('/widget.js');
            expect(response.status()).toBe(200);
            expect(response.headers()['content-type']).toContain('javascript');
        });
    });

    test.describe('CSS Rendering', () => {
        test('chat button should have correct dimensions', async ({ page }) => {
            await page.goto('/');
            await page.waitForSelector('#chat-widget-button');

            const button = page.locator('#chat-widget-button');
            const box = await button.boundingBox();

            // Button should be approximately 60x60 (allow some variance)
            expect(box.width).toBeGreaterThan(50);
            expect(box.width).toBeLessThan(80);
            expect(box.height).toBeGreaterThan(50);
            expect(box.height).toBeLessThan(80);
        });

        test('chat window should have correct dimensions', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            const chatWindow = page.locator('#chat-widget-window');
            const box = await chatWindow.boundingBox();

            // Window should be 380x520 (with some tolerance)
            expect(box.width).toBeGreaterThan(350);
            expect(box.width).toBeLessThan(420);
            expect(box.height).toBeGreaterThan(480);
            expect(box.height).toBeLessThan(560);
        });

        test('chat button should be positioned correctly', async ({ page }) => {
            await page.goto('/');
            await page.waitForSelector('#chat-widget-button');

            const button = page.locator('#chat-widget-button');
            const box = await button.boundingBox();
            const viewport = page.viewportSize();

            // Button should be in bottom-right corner
            expect(box.x + box.width).toBeGreaterThan(viewport.width - 100);
            expect(box.y + box.height).toBeGreaterThan(viewport.height - 100);
        });

        test('chat header should have colored background', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('.chat-header');

            const header = page.locator('.chat-header');
            const bgColor = await header.evaluate(el =>
                window.getComputedStyle(el).backgroundColor
            );

            // Should not be transparent or white
            expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
            expect(bgColor).not.toBe('rgb(255, 255, 255)');
        });
    });

    test.describe('JavaScript Functionality', () => {
        test('widget toggle should work', async ({ page }) => {
            await page.goto('/');
            const button = page.locator('#chat-widget-button');
            const chatWindow = page.locator('#chat-widget-window');

            // Initially closed
            await expect(chatWindow).not.toHaveClass(/open/);

            // Click to open
            await button.click();
            await expect(chatWindow).toHaveClass(/open/);

            // Click to close (via close button)
            await page.click('#chat-close');
            await expect(chatWindow).not.toHaveClass(/open/);
        });

        test('form validation should work', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // Fill name but invalid email
            await page.fill('#chat-name', 'Test User');
            await page.fill('#chat-email', 'invalid');
            await page.click('#start-chat-btn');

            // Error should appear
            const error = page.locator('#contact-error');
            await expect(error).toBeVisible();
        });

        test('contact type toggle should work', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            const emailBtn = page.locator('#contact-email-btn');
            const phoneBtn = page.locator('#contact-phone-btn');
            const emailInput = page.locator('#chat-email');
            const phoneInput = page.locator('#chat-phone');

            // Default: email visible
            await expect(emailInput).toBeVisible();
            await expect(phoneInput).not.toBeVisible();

            // Switch to phone
            await phoneBtn.click();
            await expect(phoneInput).toBeVisible();
            await expect(emailInput).not.toBeVisible();
        });

        test('chat input should accept text', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // Start chat
            await page.fill('#chat-name', 'Test');
            await page.fill('#chat-email', 'test@example.com');
            await page.click('#start-chat-btn');

            // Wait for chat area
            await page.waitForSelector('#chat-area.active');

            const input = page.locator('#chat-input');
            await input.fill('Hello world');
            await expect(input).toHaveValue('Hello world');
        });
    });

    test.describe('Event Handling', () => {
        test('click events should work', async ({ page }) => {
            await page.goto('/');

            const button = page.locator('#chat-widget-button');
            await button.click();

            const chatWindow = page.locator('#chat-widget-window');
            await expect(chatWindow).toHaveClass(/open/);
        });

        test('keyboard events should work', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // Start chat first
            await page.fill('#chat-name', 'Test');
            await page.fill('#chat-email', 'test@example.com');
            await page.click('#start-chat-btn');
            await page.waitForSelector('#chat-area.active');

            const input = page.locator('#chat-input');
            await input.fill('Test message');
            await input.press('Enter');

            // Message should be sent (input cleared)
            await expect(input).toHaveValue('');
        });

        test('focus events should work', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            const nameInput = page.locator('#chat-name');
            await nameInput.focus();

            const isFocused = await nameInput.evaluate(el => el === document.activeElement);
            expect(isFocused).toBe(true);
        });
    });

    test.describe('Form Behavior', () => {
        test('input placeholder should be visible', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            const nameInput = page.locator('#chat-name');
            const placeholder = await nameInput.getAttribute('placeholder');
            expect(placeholder).toBeTruthy();
        });

        test('form should prevent empty submission', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // Try to submit without filling form
            await page.click('#start-chat-btn');

            // Should show error or stay on form
            const preChatForm = page.locator('#pre-chat-form');
            await expect(preChatForm).toBeVisible();
        });
    });

    test.describe('Network Requests', () => {
        test('should fetch chatbot config', async ({ page }) => {
            const configRequest = page.waitForRequest(req =>
                req.url().includes('/api/chatbot/config')
            );

            await page.goto('/');

            const request = await configRequest;
            expect(request.method()).toBe('GET');
        });

        test('should handle API responses', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // Start chat
            await page.fill('#chat-name', 'Test');
            await page.fill('#chat-email', 'test@example.com');
            await page.click('#start-chat-btn');
            await page.waitForSelector('#chat-area.active');

            // Set up response listener
            const responsePromise = page.waitForResponse(resp =>
                resp.url().includes('/api/chatbot/message')
            );

            // Send message
            await page.fill('#chat-input', 'Hello');
            await page.click('#chat-send');

            const response = await responsePromise;
            expect(response.status()).toBe(200);
        });
    });

    test.describe('Responsive Behavior', () => {
        test('widget should work at different viewport sizes', async ({ page }) => {
            // Test at various sizes
            const sizes = [
                { width: 1920, height: 1080 },
                { width: 1366, height: 768 },
                { width: 768, height: 1024 },
                { width: 375, height: 667 }
            ];

            for (const size of sizes) {
                await page.setViewportSize(size);
                await page.goto('/');

                const button = page.locator('#chat-widget-button');
                await expect(button).toBeVisible();

                await button.click();
                const chatWindow = page.locator('#chat-widget-window');
                await expect(chatWindow).toHaveClass(/open/);

                await page.click('#chat-close');
            }
        });

        test('admin page should be responsive', async ({ page }) => {
            const sizes = [
                { width: 1920, height: 1080 },
                { width: 768, height: 1024 },
                { width: 375, height: 667 }
            ];

            for (const size of sizes) {
                await page.setViewportSize(size);
                await page.goto('/admin');

                const loginBox = page.locator('.login-box');
                await expect(loginBox).toBeVisible();
            }
        });
    });

    test.describe('Browser-Specific Checks', () => {
        test('should report correct browser', async ({ page, browserName }) => {
            await page.goto('/');

            // Just verify we can detect browser name
            expect(['chromium', 'firefox', 'webkit']).toContain(browserName);
        });

        test('localStorage should work', async ({ page }) => {
            await page.goto('/');

            // Test localStorage functionality
            await page.evaluate(() => {
                localStorage.setItem('test', 'value');
            });

            const value = await page.evaluate(() => localStorage.getItem('test'));
            expect(value).toBe('value');
        });

        test('sessionStorage should work', async ({ page }) => {
            await page.goto('/');

            await page.evaluate(() => {
                sessionStorage.setItem('test', 'value');
            });

            const value = await page.evaluate(() => sessionStorage.getItem('test'));
            expect(value).toBe('value');
        });

        test('cookies should work', async ({ page, context }) => {
            await page.goto('/');

            await context.addCookies([{
                name: 'test',
                value: 'cookie',
                url: 'http://localhost:3000'
            }]);

            const cookies = await context.cookies();
            const testCookie = cookies.find(c => c.name === 'test');
            expect(testCookie?.value).toBe('cookie');
        });
    });

    test.describe('Animation and Transitions', () => {
        test('widget open animation should complete', async ({ page }) => {
            await page.goto('/');

            await page.click('#chat-widget-button');

            // Wait for animation to complete
            await page.waitForSelector('#chat-widget-window.open', { state: 'visible' });

            const chatWindow = page.locator('#chat-widget-window');
            await expect(chatWindow).toBeVisible();
        });

        test('button hover should work', async ({ page }) => {
            await page.goto('/');

            const button = page.locator('#chat-widget-button');
            await button.hover();

            // Button should still be interactive
            await button.click();
            const chatWindow = page.locator('#chat-widget-window');
            await expect(chatWindow).toHaveClass(/open/);
        });
    });

    test.describe('Text Rendering', () => {
        test('text should be readable', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('.chat-header');

            const headerText = await page.locator('.chat-header').textContent();
            expect(headerText.length).toBeGreaterThan(0);
        });

        test('special characters should render correctly', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // The emoji in "👋 Hi there!" should render
            const greeting = await page.locator('.chat-pre-chat h3').textContent();
            expect(greeting).toContain('Hi');
        });
    });

    test.describe('Scroll Behavior', () => {
        test('messages container should be scrollable', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // Start chat
            await page.fill('#chat-name', 'Test');
            await page.fill('#chat-email', 'test@example.com');
            await page.click('#start-chat-btn');
            await page.waitForSelector('#chat-area.active');

            const messagesContainer = page.locator('#chat-messages');

            // Check that overflow is set for scrolling
            const overflow = await messagesContainer.evaluate(el =>
                window.getComputedStyle(el).overflowY
            );
            expect(['auto', 'scroll']).toContain(overflow);
        });
    });
});

test.describe('Mobile-Specific Tests', () => {
    test('touch events should work on mobile', async ({ page, isMobile }) => {
        test.skip(!isMobile, 'Mobile-only test');

        await page.goto('/');

        const button = page.locator('#chat-widget-button');
        await button.tap();

        const chatWindow = page.locator('#chat-widget-window');
        await expect(chatWindow).toHaveClass(/open/);
    });

    test('virtual keyboard should not break layout', async ({ page, isMobile }) => {
        test.skip(!isMobile, 'Mobile-only test');

        await page.goto('/');
        await page.click('#chat-widget-button');
        await page.waitForSelector('#chat-widget-window.open');

        const nameInput = page.locator('#chat-name');
        await nameInput.tap();
        await nameInput.fill('Test');

        // Widget should still be visible
        const chatWindow = page.locator('#chat-widget-window');
        await expect(chatWindow).toBeVisible();
    });
});
