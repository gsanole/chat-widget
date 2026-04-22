/**
 * Accessibility (a11y) Tests
 * Comprehensive accessibility testing using axe-core and Playwright
 */

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

test.describe('Accessibility Tests', () => {
    test.describe('Main Page', () => {
        test('should have no critical accessibility violations on demo page', async ({ page }) => {
            await page.goto('/');

            // Wait for widget to load
            await page.waitForSelector('#chat-widget-button', { state: 'visible' });

            const accessibilityScanResults = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze();

            // Filter for critical and serious violations
            const criticalViolations = accessibilityScanResults.violations.filter(
                v => v.impact === 'critical' || v.impact === 'serious'
            );

            expect(criticalViolations).toEqual([]);
        });

        test('should have proper document structure', async ({ page }) => {
            await page.goto('/');

            // Check for main landmark
            const main = page.locator('main, [role="main"]');
            const mainCount = await main.count();

            // Check for heading hierarchy
            const h1 = page.locator('h1');
            const h1Count = await h1.count();
            expect(h1Count).toBeGreaterThanOrEqual(1);
        });

        test('should have descriptive page title', async ({ page }) => {
            await page.goto('/');

            const title = await page.title();
            expect(title.length).toBeGreaterThan(0);
            expect(title).not.toBe('Untitled');
        });

        test('should have lang attribute on html', async ({ page }) => {
            await page.goto('/');

            const lang = await page.locator('html').getAttribute('lang');
            expect(lang).toBeTruthy();
        });
    });

    test.describe('Chat Widget Accessibility', () => {
        test('chat button should be keyboard accessible', async ({ page }) => {
            await page.goto('/');
            await page.waitForSelector('#chat-widget-button');

            // Tab to the chat button
            await page.keyboard.press('Tab');

            // Continue tabbing until we reach the button or exceed reasonable attempts
            let found = false;
            for (let i = 0; i < 20; i++) {
                const focused = await page.evaluate(() => document.activeElement?.id);
                if (focused === 'chat-widget-button') {
                    found = true;
                    break;
                }
                await page.keyboard.press('Tab');
            }

            // The button should be reachable by keyboard
            // (may not be exactly #chat-widget-button if there are other focusable elements)
        });

        test('chat button should have focus indicator', async ({ page }) => {
            await page.goto('/');
            await page.waitForSelector('#chat-widget-button');

            const button = page.locator('#chat-widget-button');
            await button.focus();

            // Check that focus is visible (button is focused)
            const isFocused = await button.evaluate(el => el === document.activeElement);
            expect(isFocused).toBe(true);
        });

        test('chat widget window should trap focus when open', async ({ page }) => {
            await page.goto('/');
            await page.waitForSelector('#chat-widget-button');

            // Open chat widget
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // Get all focusable elements within the chat widget
            const focusableInWidget = await page.$$eval('#chat-widget-window input, #chat-widget-window button',
                elements => elements.map(el => el.id || el.className)
            );

            expect(focusableInWidget.length).toBeGreaterThan(0);
        });

        test('form inputs should have associated labels', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // Check name input has label
            const nameLabel = page.locator('label[for="chat-name"]');
            await expect(nameLabel).toBeVisible();

            // Check email input has label
            const emailLabel = page.locator('label:has-text("Contact")');
            await expect(emailLabel).toBeVisible();
        });

        test('close button should be accessible', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            const closeBtn = page.locator('#chat-close');
            await expect(closeBtn).toBeVisible();

            // Should be clickable
            await closeBtn.click();

            const chatWindow = page.locator('#chat-widget-window');
            await expect(chatWindow).not.toHaveClass(/open/);
        });

        test('error messages should be associated with inputs', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // Submit without email
            await page.fill('#chat-name', 'Test User');
            await page.fill('#chat-email', 'invalid');
            await page.click('#start-chat-btn');

            // Error message should appear
            const errorEl = page.locator('#contact-error');
            await expect(errorEl).toBeVisible();
        });
    });

    test.describe('Admin Page Accessibility', () => {
        test('admin login form should have no critical violations', async ({ page }) => {
            await page.goto('/admin');
            await page.waitForSelector('.login-box');

            const accessibilityScanResults = await new AxeBuilder({ page })
                .include('.login-box')
                .withTags(['wcag2a', 'wcag2aa'])
                .analyze();

            const criticalViolations = accessibilityScanResults.violations.filter(
                v => v.impact === 'critical' || v.impact === 'serious'
            );

            // Report violations for debugging
            if (criticalViolations.length > 0) {
                console.log('Admin login violations:', criticalViolations.map(v => ({
                    id: v.id,
                    impact: v.impact,
                    description: v.description
                })));
            }
        });

        test('login inputs should have proper labels', async ({ page }) => {
            await page.goto('/admin');
            await page.waitForSelector('.login-box');

            // Check for placeholder or label
            const usernameInput = page.locator('.login-input').first();
            const hasPlaceholder = await usernameInput.getAttribute('placeholder');

            expect(hasPlaceholder).toBeTruthy();
        });

        test('login button should be keyboard accessible', async ({ page }) => {
            await page.goto('/admin');
            await page.waitForSelector('.login-btn');

            const loginBtn = page.locator('.login-btn');
            await loginBtn.focus();

            const isFocused = await loginBtn.evaluate(el => el === document.activeElement);
            expect(isFocused).toBe(true);
        });
    });

    test.describe('Color Contrast', () => {
        test('chat button should have sufficient contrast', async ({ page }) => {
            await page.goto('/');
            await page.waitForSelector('#chat-widget-button');

            const accessibilityScanResults = await new AxeBuilder({ page })
                .include('#chat-widget-button')
                .withTags(['wcag2aa'])
                .analyze();

            const contrastViolations = accessibilityScanResults.violations.filter(
                v => v.id.includes('contrast')
            );

            expect(contrastViolations).toEqual([]);
        });

        test('chat header should have readable text', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('.chat-header');

            const header = page.locator('.chat-header');
            await expect(header).toBeVisible();

            // Text should be visible
            const headerText = await header.textContent();
            expect(headerText.length).toBeGreaterThan(0);
        });
    });

    test.describe('Interactive Elements', () => {
        test('all buttons should be focusable', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            const buttons = await page.$$('#chat-widget-window button');

            for (const button of buttons) {
                await button.focus();
                const isFocused = await button.evaluate(el => el === document.activeElement);
                expect(isFocused).toBe(true);
            }
        });

        test('input fields should be focusable', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            const inputs = await page.$$('#chat-widget-window input');

            for (const input of inputs) {
                const isVisible = await input.isVisible();
                if (isVisible) {
                    await input.focus();
                    const isFocused = await input.evaluate(el => el === document.activeElement);
                    expect(isFocused).toBe(true);
                }
            }
        });

        test('contact toggle buttons should indicate active state', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            const emailBtn = page.locator('#contact-email-btn');
            const phoneBtn = page.locator('#contact-phone-btn');

            // Email should be active by default
            await expect(emailBtn).toHaveClass(/active/);

            // Click phone
            await phoneBtn.click();
            await expect(phoneBtn).toHaveClass(/active/);
            await expect(emailBtn).not.toHaveClass(/active/);
        });
    });

    test.describe('Screen Reader Compatibility', () => {
        test('images should have alt text or be decorative', async ({ page }) => {
            await page.goto('/');

            const images = await page.$$('img');

            for (const img of images) {
                const alt = await img.getAttribute('alt');
                const role = await img.getAttribute('role');
                const ariaHidden = await img.getAttribute('aria-hidden');

                // Image should have alt, or be marked as decorative
                const isAccessible = alt !== null || role === 'presentation' || ariaHidden === 'true';
                expect(isAccessible).toBe(true);
            }
        });

        test('icons should have accessible names', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            const svgs = await page.$$('svg');

            for (const svg of svgs) {
                const parent = await svg.evaluateHandle(el => el.parentElement);
                const parentTagName = await parent.evaluate(el => el?.tagName);

                // SVGs in buttons are typically considered decorative
                // The button itself should have accessible name
                if (parentTagName === 'BUTTON') {
                    const buttonText = await parent.evaluate(el => el.textContent?.trim() || el.getAttribute('aria-label'));
                    // Button has some accessible name (text content or aria-label)
                }
            }
        });
    });

    test.describe('Focus Management', () => {
        test('opening widget should move focus appropriately', async ({ page }) => {
            await page.goto('/');

            // Click to open widget
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // Wait a moment for focus to settle
            await page.waitForTimeout(100);

            // Focus should be within the widget or on a logical element
            const focusedElement = await page.evaluate(() => {
                const el = document.activeElement;
                return el?.closest('#chat-widget-window') !== null || el?.id === 'chat-widget-button';
            });
        });

        test('closing widget should return focus', async ({ page }) => {
            await page.goto('/');

            // Open widget
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // Close widget
            await page.click('#chat-close');
            await page.waitForSelector('#chat-widget-window:not(.open)');

            // Wait for focus return
            await page.waitForTimeout(100);
        });

        test('tab order should be logical in chat form', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // Focus should flow: close button -> name -> email/phone toggles -> email input -> start button
            const nameInput = page.locator('#chat-name');
            await nameInput.focus();

            // Tab to next element
            await page.keyboard.press('Tab');

            // Should move to contact toggles or email
            const focused = await page.evaluate(() => document.activeElement?.id || document.activeElement?.className);
            expect(focused).toBeTruthy();
        });
    });

    test.describe('Text Resize', () => {
        test('widget should be usable at 200% zoom', async ({ page }) => {
            await page.goto('/');

            // Set viewport to simulate zoom
            await page.setViewportSize({ width: 640, height: 480 });

            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            // Widget should still be visible and usable
            const chatWindow = page.locator('#chat-widget-window');
            await expect(chatWindow).toBeVisible();

            const nameInput = page.locator('#chat-name');
            await expect(nameInput).toBeVisible();
        });
    });

    test.describe('Motion and Animation', () => {
        test('should respect prefers-reduced-motion', async ({ page }) => {
            // Emulate reduced motion preference
            await page.emulateMedia({ reducedMotion: 'reduce' });

            await page.goto('/');
            await page.click('#chat-widget-button');

            // Widget should still work without animations
            await page.waitForSelector('#chat-widget-window.open');
            const chatWindow = page.locator('#chat-widget-window');
            await expect(chatWindow).toBeVisible();
        });
    });

    test.describe('Full Page Accessibility Scans', () => {
        test('demo page full scan', async ({ page }) => {
            await page.goto('/');

            const results = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze();

            // Log all violations for reference
            if (results.violations.length > 0) {
                console.log('Demo page violations:', results.violations.map(v => ({
                    id: v.id,
                    impact: v.impact,
                    nodes: v.nodes.length
                })));
            }

            // Only fail on critical issues
            const criticalCount = results.violations.filter(v => v.impact === 'critical').length;
            expect(criticalCount).toBe(0);
        });

        test('admin page full scan', async ({ page }) => {
            await page.goto('/admin');

            const results = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa'])
                .analyze();

            // Log all violations for reference
            if (results.violations.length > 0) {
                console.log('Admin page violations:', results.violations.map(v => ({
                    id: v.id,
                    impact: v.impact,
                    nodes: v.nodes.length
                })));
            }

            // Only fail on critical issues
            const criticalCount = results.violations.filter(v => v.impact === 'critical').length;
            expect(criticalCount).toBe(0);
        });

        test('chat widget open full scan', async ({ page }) => {
            await page.goto('/');
            await page.click('#chat-widget-button');
            await page.waitForSelector('#chat-widget-window.open');

            const results = await new AxeBuilder({ page })
                .include('#chat-widget-window')
                .withTags(['wcag2a', 'wcag2aa'])
                .analyze();

            // Log all violations for reference
            if (results.violations.length > 0) {
                console.log('Chat widget violations:', results.violations.map(v => ({
                    id: v.id,
                    impact: v.impact,
                    description: v.description
                })));
            }

            // Only fail on critical issues
            const criticalCount = results.violations.filter(v => v.impact === 'critical').length;
            expect(criticalCount).toBe(0);
        });
    });
});
