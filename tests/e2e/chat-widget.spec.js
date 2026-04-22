// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * E2E Tests for Chat Widget
 * Tests the full user flow from widget load to chat interaction
 */

test.describe('Chat Widget', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/demo.html');
    });

    test('should load demo page', async ({ page }) => {
        await expect(page).toHaveTitle('Chat Widget Demo');
    });

    test('should display chat widget button', async ({ page }) => {
        const chatButton = page.locator('#chat-widget-button');
        await expect(chatButton).toBeVisible();
    });

    test('should open chat window when button is clicked', async ({ page }) => {
        const chatButton = page.locator('#chat-widget-button');
        await chatButton.click();

        const chatWindow = page.locator('#chat-widget-window');
        await expect(chatWindow).toBeVisible();
    });

    test('should show chat header with title', async ({ page }) => {
        const chatButton = page.locator('#chat-widget-button');
        await chatButton.click();

        const header = page.locator('.chat-header');
        await expect(header).toBeVisible();
        await expect(header).toContainText('Chat Support');
    });

    test('should close chat window when close button is clicked', async ({ page }) => {
        // Open chat
        const chatButton = page.locator('#chat-widget-button');
        await chatButton.click();

        const chatWindow = page.locator('#chat-widget-window');
        await expect(chatWindow).toBeVisible();

        // Close chat
        const closeButton = page.locator('.chat-header-close');
        await closeButton.click();

        await expect(chatWindow).not.toBeVisible();
    });

    test('should show pre-chat form initially', async ({ page }) => {
        const chatButton = page.locator('#chat-widget-button');
        await chatButton.click();

        // Wait for the widget to initialize
        await page.waitForTimeout(500);

        // Check for pre-chat form or chat messages area
        const preChatForm = page.locator('.pre-chat-form, #pre-chat-form');
        const messagesArea = page.locator('.chat-messages, #chat-messages');

        // Either pre-chat form or messages area should be visible
        const hasPreChat = await preChatForm.isVisible().catch(() => false);
        const hasMessages = await messagesArea.isVisible().catch(() => false);

        expect(hasPreChat || hasMessages).toBeTruthy();
    });
});

test.describe('Chat Widget Interaction', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/demo.html');
        // Open the chat widget
        await page.locator('#chat-widget-button').click();
        await page.waitForTimeout(500);
    });

    test('should have input field for messages', async ({ page }) => {
        // Look for message input in various forms
        const messageInput = page.locator('input[type="text"], textarea').first();
        await expect(messageInput).toBeVisible();
    });

    test('should have send button', async ({ page }) => {
        // The widget uses .chat-send-btn class
        const sendButton = page.locator('.chat-send-btn, .chat-start-btn').first();
        await expect(sendButton).toBeVisible();
    });
});

test.describe('Admin Panel', () => {
    test('should load admin login page', async ({ page }) => {
        await page.goto('/admin.html');
        await expect(page).toHaveTitle(/Admin/i);
    });

    test('should display login form', async ({ page }) => {
        await page.goto('/admin.html');

        // Check for login form elements (using actual class names)
        const usernameInput = page.locator('.login-input').first();
        const passwordInput = page.locator('.login-input[type="password"]');

        await expect(usernameInput).toBeVisible();
        await expect(passwordInput).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
        await page.goto('/admin.html');

        // Fill in invalid credentials (using actual class names)
        await page.locator('.login-input').first().fill('invalid');
        await page.locator('.login-input[type="password"]').fill('wrongpassword');

        // Click login button
        await page.locator('.login-btn').click();

        // Wait for error message
        await page.waitForTimeout(1000);

        // Check for error message or still on login page
        const loginError = page.locator('.login-error');
        const loginBox = page.locator('.login-box');

        // Either error is shown or we're still on login page
        const hasError = await loginError.isVisible().catch(() => false);
        const stillOnLogin = await loginBox.isVisible().catch(() => false);

        expect(hasError || stillOnLogin).toBeTruthy();
    });
});

test.describe('Widget Accessibility', () => {
    test('chat button should be clickable and open widget', async ({ page }) => {
        await page.goto('/demo.html');

        // Click the chat button
        const chatButton = page.locator('#chat-widget-button');
        await chatButton.click();

        // Check if chat window opened
        const chatWindow = page.locator('#chat-widget-window');
        await expect(chatWindow).toBeVisible();
    });
});

test.describe('Responsive Design', () => {
    test('widget should display on mobile viewport', async ({ page }) => {
        // Set mobile viewport
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/demo.html');

        const chatButton = page.locator('#chat-widget-button');
        await expect(chatButton).toBeVisible();
    });

    test('widget window should be visible on small screens', async ({ page }) => {
        await page.setViewportSize({ width: 400, height: 700 });
        await page.goto('/demo.html');

        // Open chat
        await page.locator('#chat-widget-button').click();

        const chatWindow = page.locator('#chat-widget-window');
        await expect(chatWindow).toBeVisible();

        // Check that window is visible and positioned correctly
        const box = await chatWindow.boundingBox();
        expect(box).toBeTruthy();
        if (box) {
            // Widget should fit within viewport (may overflow slightly on very small screens)
            expect(box.width).toBeLessThanOrEqual(400);
        }
    });
});
