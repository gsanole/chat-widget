/**
 * Tests for business-hours gating of human escalation.
 */

const { ChatbotService } = require('../../src/services/ChatbotService');

describe('ChatbotService.isHumanAvailable', () => {
    const baseConfig = {
        humanHours: {
            enabled: true,
            timezone: 'UTC',
            schedule: {
                mon: [{ open: '09:00', close: '17:00' }],
                tue: [{ open: '09:00', close: '17:00' }],
                wed: [{ open: '09:00', close: '17:00' }],
                thu: [{ open: '09:00', close: '17:00' }],
                fri: [{ open: '09:00', close: '17:00' }],
                sat: [],
                sun: []
            },
            offHoursMessage: 'Closed.'
        }
    };

    test('returns true when humanHours is missing', () => {
        expect(ChatbotService.isHumanAvailable({})).toBe(true);
    });

    test('returns true when humanHours.enabled is false (24/7)', () => {
        const cfg = { humanHours: { ...baseConfig.humanHours, enabled: false } };
        // Sunday at 03:00 UTC — outside any schedule, but feature off
        expect(ChatbotService.isHumanAvailable(cfg, new Date('2024-01-07T03:00:00Z'))).toBe(true);
    });

    test('open inside the window (Wed 12:00 UTC)', () => {
        // 2024-01-03 is a Wednesday
        expect(ChatbotService.isHumanAvailable(baseConfig, new Date('2024-01-03T12:00:00Z'))).toBe(true);
    });

    test('closed before window (Wed 08:59 UTC)', () => {
        expect(ChatbotService.isHumanAvailable(baseConfig, new Date('2024-01-03T08:59:00Z'))).toBe(false);
    });

    test('closed at exact close time (Wed 17:00 UTC, exclusive)', () => {
        expect(ChatbotService.isHumanAvailable(baseConfig, new Date('2024-01-03T17:00:00Z'))).toBe(false);
    });

    test('open at exact open time (Wed 09:00 UTC, inclusive)', () => {
        expect(ChatbotService.isHumanAvailable(baseConfig, new Date('2024-01-03T09:00:00Z'))).toBe(true);
    });

    test('closed on weekend (Sun 12:00 UTC)', () => {
        // 2024-01-07 is a Sunday
        expect(ChatbotService.isHumanAvailable(baseConfig, new Date('2024-01-07T12:00:00Z'))).toBe(false);
    });

    test('respects configured timezone (NYC 09:30 = 14:30 UTC in winter)', () => {
        const cfg = { humanHours: { ...baseConfig.humanHours, timezone: 'America/New_York' } };
        // 2024-01-03 14:30 UTC = Wednesday 09:30 EST -> open
        expect(ChatbotService.isHumanAvailable(cfg, new Date('2024-01-03T14:30:00Z'))).toBe(true);
        // 2024-01-03 13:30 UTC = Wednesday 08:30 EST -> closed
        expect(ChatbotService.isHumanAvailable(cfg, new Date('2024-01-03T13:30:00Z'))).toBe(false);
    });

    test('fails open on invalid timezone', () => {
        const cfg = { humanHours: { ...baseConfig.humanHours, timezone: 'Not/A_Real_Zone' } };
        expect(ChatbotService.isHumanAvailable(cfg, new Date('2024-01-07T03:00:00Z'))).toBe(true);
    });

    test('multiple ranges in a day (split shift)', () => {
        const cfg = {
            humanHours: {
                enabled: true,
                timezone: 'UTC',
                schedule: {
                    wed: [
                        { open: '09:00', close: '12:00' },
                        { open: '13:00', close: '17:00' }
                    ]
                }
            }
        };
        // 12:30 UTC Wed -> in lunch gap -> closed
        expect(ChatbotService.isHumanAvailable(cfg, new Date('2024-01-03T12:30:00Z'))).toBe(false);
        // 14:00 UTC Wed -> open
        expect(ChatbotService.isHumanAvailable(cfg, new Date('2024-01-03T14:00:00Z'))).toBe(true);
    });
});

describe('ChatbotService.processMessage business-hours gating', () => {
    function buildService(config) {
        return new ChatbotService({
            chatbotConfig: { getConfig: () => config }
        });
    }

    const inHours = new Date('2024-01-03T12:00:00Z'); // Wed noon UTC
    const outOfHours = new Date('2024-01-07T12:00:00Z'); // Sun noon UTC

    const config = {
        enabled: true,
        escalationKeywords: ['human', 'agent'],
        escalationMessage: "Connecting you now.",
        fallbackMessage: 'Sorry?',
        faq: [],
        quickReplies: ['Talk to Human'],
        humanHours: {
            enabled: true,
            timezone: 'UTC',
            schedule: {
                mon: [{ open: '09:00', close: '17:00' }],
                tue: [{ open: '09:00', close: '17:00' }],
                wed: [{ open: '09:00', close: '17:00' }],
                thu: [{ open: '09:00', close: '17:00' }],
                fri: [{ open: '09:00', close: '17:00' }],
                sat: [],
                sun: []
            },
            offHoursMessage: "We're closed. Leave a message."
        }
    };

    test('escalates normally when in business hours', () => {
        const svc = buildService(config);
        const r = svc.processMessage('I want to talk to a human', null, inHours);
        expect(r.type).toBe('escalation');
        expect(r.shouldEscalate).toBe(true);
        expect(r.content).toBe('Connecting you now.');
    });

    test('returns offHours response when outside business hours', () => {
        const svc = buildService(config);
        const r = svc.processMessage('I want to talk to a human', null, outOfHours);
        expect(r.type).toBe('offHours');
        expect(r.shouldEscalate).toBe(false);
        expect(r.content).toBe("We're closed. Leave a message.");
    });

    test('does not affect non-escalation messages outside hours', () => {
        const svc = buildService(config);
        const r = svc.processMessage('hello there', null, outOfHours);
        expect(r.type).toBe('fallback');
    });

    test('falls back to default offHours text when not configured', () => {
        const cfg = {
            ...config,
            humanHours: { ...config.humanHours, offHoursMessage: undefined }
        };
        const svc = buildService(cfg);
        const r = svc.processMessage('agent please', null, outOfHours);
        expect(r.type).toBe('offHours');
        expect(r.content).toMatch(/offline|away|closed|message/i);
    });
});
