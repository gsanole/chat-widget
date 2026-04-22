/**
 * Unit tests for ChatbotService.
 */

const { ChatbotService } = require('../../src/services/ChatbotService');

function makeConfigProvider(config) {
    return {
        getConfig: jest.fn(() => config),
        saveConfig: jest.fn(() => true)
    };
}

const baseConfig = {
    enabled: true,
    botName: 'Helper',
    welcomeMessage: 'Hi there!',
    fallbackMessage: 'Sorry, I did not understand.',
    quickReplies: ['Pricing', 'Support'],
    escalationKeywords: ['agent', 'human'],
    escalationMessage: 'Connecting you to a human...',
    faq: [
        {
            question: 'How do I reset my password?',
            answer: 'Go to settings and click reset.',
            keywords: ['password', 'reset']
        },
        {
            question: 'What are your business hours?',
            answer: 'We are open 9 to 5.'
        }
    ]
};

describe('ChatbotService', () => {
    let provider, svc;

    beforeEach(() => {
        provider = makeConfigProvider(baseConfig);
        svc = new ChatbotService({ chatbotConfig: provider });
    });

    test('getConfig delegates to provider', () => {
        expect(svc.getConfig()).toBe(baseConfig);
    });

    test('saveConfig delegates to provider', () => {
        svc.saveConfig({ enabled: false });
        expect(provider.saveConfig).toHaveBeenCalledWith({ enabled: false });
    });

    test('getWelcomeMessage returns config welcomeMessage', () => {
        expect(svc.getWelcomeMessage()).toBe('Hi there!');
    });

    test('getWelcomeMessage uses site override when given', () => {
        expect(svc.getWelcomeMessage({ welcomeMessage: 'Howdy' })).toBe('Howdy');
    });

    test('getBotName returns config botName, with site override support', () => {
        expect(svc.getBotName()).toBe('Helper');
        expect(svc.getBotName({ botName: 'Custom' })).toBe('Custom');
    });

    describe('processMessage', () => {
        test('returns disabled when chatbot is off', () => {
            const off = new ChatbotService({
                chatbotConfig: makeConfigProvider({ ...baseConfig, enabled: false })
            });
            expect(off.processMessage('hi')).toEqual({ type: 'disabled', content: null });
        });

        test('triggers escalation when message contains a keyword', () => {
            const r = svc.processMessage('I want to talk to a human please');
            expect(r.type).toBe('escalation');
            expect(r.shouldEscalate).toBe(true);
            expect(r.content).toBe('Connecting you to a human...');
        });

        test('matches FAQ via keyword (high-confidence path)', () => {
            const r = svc.processMessage('How do I reset my password?');
            expect(r.type).toBe('faq');
            expect(r.content).toBe('Go to settings and click reset.');
            expect(r.confidence).toBeGreaterThanOrEqual(0.5);
        });

        test('matches FAQ via word overlap (Jaccard >= 0.5)', () => {
            const r = svc.processMessage('What are business hours');
            expect(r.type).toBe('faq');
            expect(r.matchedQuestion).toMatch(/business hours/);
        });

        test('falls back when nothing matches', () => {
            const r = svc.processMessage('xyzzy plugh');
            expect(r.type).toBe('fallback');
            expect(r.content).toBe('Sorry, I did not understand.');
            expect(r.quickReplies).toEqual(['Pricing', 'Support']);
        });

        test('site-specific config overrides default', () => {
            const r = svc.processMessage('hi', {
                ...baseConfig,
                fallbackMessage: 'Site fallback'
            });
            expect(r.content).toBe('Site fallback');
        });

        test('handles missing escalationKeywords gracefully', () => {
            const noEsc = new ChatbotService({
                chatbotConfig: makeConfigProvider({ ...baseConfig, escalationKeywords: [] })
            });
            expect(noEsc.processMessage('agent please').type).not.toBe('escalation');
        });

        test('handles empty FAQ', () => {
            const noFaq = new ChatbotService({
                chatbotConfig: makeConfigProvider({ ...baseConfig, faq: [] })
            });
            expect(noFaq.processMessage('whatever').type).toBe('fallback');
        });

        test('skips malformed FAQ entries (missing question or answer)', () => {
            const broken = new ChatbotService({
                chatbotConfig: makeConfigProvider({
                    ...baseConfig,
                    faq: [{ question: null, answer: 'x' }, { question: 'q', answer: null }]
                })
            });
            expect(broken.processMessage('q').type).toBe('fallback');
        });
    });
});
