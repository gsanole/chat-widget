/**
 * Chatbot Service
 * 
 * Single Responsibility: Chatbot business logic and FAQ matching
 */

class ChatbotService {
    /**
     * @param {Object} deps - Dependencies
     * @param {Object} deps.chatbotConfig - Chatbot configuration provider
     */
    constructor({ chatbotConfig }) {
        this.chatbotConfig = chatbotConfig;
    }

    /**
     * Get chatbot configuration
     * @returns {Object}
     */
    getConfig() {
        return this.chatbotConfig.getConfig();
    }

    /**
     * Save chatbot configuration
     * @param {Object} config
     * @returns {boolean}
     */
    saveConfig(config) {
        return this.chatbotConfig.saveConfig(config);
    }

    /**
     * Process user message and generate bot response
     * @param {string} message - User message
     * @param {Object} siteConfig - Site-specific config (optional)
     * @returns {Object} Bot response
     */
    processMessage(message, siteConfig = null, now = new Date()) {
        const config = siteConfig || this.getConfig();

        if (!config.enabled) {
            return { type: 'disabled', content: null };
        }

        const lowerMessage = message.toLowerCase().trim();

        // Check for escalation keywords
        if (this._matchesEscalation(lowerMessage, config)) {
            // Gate escalation by humanHours schedule (if enabled).
            if (!ChatbotService.isHumanAvailable(config, now)) {
                const offHoursMessage = (config.humanHours && config.humanHours.offHoursMessage)
                    || "Our support team is currently offline. Please leave a message and we'll get back to you when we're available.";
                return {
                    type: 'offHours',
                    content: offHoursMessage,
                    shouldEscalate: false
                };
            }
            return {
                type: 'escalation',
                content: config.escalationMessage,
                shouldEscalate: true
            };
        }

        // Match FAQ
        const faqMatch = this._matchFaq(lowerMessage, config.faq);
        if (faqMatch) {
            return {
                type: 'faq',
                content: faqMatch.answer,
                matchedQuestion: faqMatch.question,
                confidence: faqMatch.confidence
            };
        }

        // Fallback response
        return {
            type: 'fallback',
            content: config.fallbackMessage,
            quickReplies: config.quickReplies
        };
    }

    /**
     * Check if message matches escalation keywords
     * @param {string} message
     * @param {Object} config
     * @returns {boolean}
     */
    _matchesEscalation(message, config) {
        if (!config.escalationKeywords || config.escalationKeywords.length === 0) {
            return false;
        }

        return config.escalationKeywords.some(keyword =>
            message.includes(keyword.toLowerCase())
        );
    }

    /**
     * Match message against FAQ entries
     * @param {string} message
     * @param {Array} faq
     * @returns {Object|null}
     */
    _matchFaq(message, faq) {
        if (!faq || faq.length === 0) {
            return null;
        }

        let bestMatch = null;
        let highestScore = 0;

        for (const item of faq) {
            if (!item.question || !item.answer) continue;

            const score = this._calculateMatchScore(message, item.question.toLowerCase());

            if (score > highestScore && score >= 0.5) { // 50% threshold
                highestScore = score;
                bestMatch = {
                    question: item.question,
                    answer: item.answer,
                    confidence: score
                };
            }

            // Also check keywords if available
            if (item.keywords && Array.isArray(item.keywords)) {
                for (const keyword of item.keywords) {
                    if (message.includes(keyword.toLowerCase())) {
                        const keywordScore = 0.8; // High confidence for keyword match
                        if (keywordScore > highestScore) {
                            highestScore = keywordScore;
                            bestMatch = {
                                question: item.question,
                                answer: item.answer,
                                confidence: keywordScore
                            };
                        }
                    }
                }
            }
        }

        return bestMatch;
    }

    /**
     * Calculate match score between message and question
     * Uses simple word overlap scoring
     * @param {string} message
     * @param {string} question
     * @returns {number} Score between 0 and 1
     */
    _calculateMatchScore(message, question) {
        const messageWords = this._tokenize(message);
        const questionWords = this._tokenize(question);

        if (messageWords.length === 0 || questionWords.length === 0) {
            return 0;
        }

        // Count matching words
        let matches = 0;
        for (const word of messageWords) {
            if (questionWords.includes(word)) {
                matches++;
            }
        }

        // Calculate Jaccard similarity
        const union = new Set([...messageWords, ...questionWords]).size;
        return matches / union;
    }

    /**
     * Tokenize text into words
     * @param {string} text
     * @returns {string[]}
     */
    _tokenize(text) {
        return text
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 2); // Ignore very short words
    }

    /**
     * Get welcome message
     * @param {Object} siteConfig
     * @returns {string}
     */
    getWelcomeMessage(siteConfig = null) {
        const config = siteConfig || this.getConfig();
        return config.welcomeMessage;
    }

    /**
     * Get bot name
     * @param {Object} siteConfig
     * @returns {string}
     */
    getBotName(siteConfig = null) {
        const config = siteConfig || this.getConfig();
        return config.botName;
    }

    /**
     * Add FAQ item
     * @param {Object} item
     * @returns {string} Item ID
     */
    addFaq(item) {
        return this.chatbotConfig.addFaqItem(item);
    }

    /**
     * Update FAQ item
     * @param {string} id
     * @param {Object} updates
     * @returns {boolean}
     */
    updateFaq(id, updates) {
        return this.chatbotConfig.updateFaqItem(id, updates);
    }

    /**
     * Delete FAQ item
     * @param {string} id
     * @returns {boolean}
     */
    deleteFaq(id) {
        return this.chatbotConfig.deleteFaqItem(id);
    }

    /**
     * Determine whether human escalation is currently allowed based on the
     * `humanHours` schedule in the chatbot config. If `humanHours.enabled` is
     * not true, returns true (24/7 — preserves existing behavior).
     *
     * Schedule shape:
     *   humanHours: {
     *     enabled: true,
     *     timezone: 'America/New_York',   // IANA tz; defaults to UTC
     *     schedule: {
     *       mon: [{ open: '09:00', close: '17:00' }],
     *       ...
     *       sun: []                        // empty/missing = closed
     *     },
     *     offHoursMessage: '...'
     *   }
     *
     * @param {Object} config - Chatbot config (or site-specific override)
     * @param {Date}   [now]  - Current time, defaults to new Date()
     * @returns {boolean}
     */
    static isHumanAvailable(config, now = new Date()) {
        const hh = config && config.humanHours;
        if (!hh || hh.enabled !== true) return true;

        const tz = hh.timezone || 'UTC';
        let parts;
        try {
            // en-GB gives 24h HH:MM:SS and weekday short
            const fmt = new Intl.DateTimeFormat('en-GB', {
                timeZone: tz,
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            parts = fmt.formatToParts(now);
        } catch (e) {
            // Bad timezone -> fail open (treat as available so admins aren't locked out
            // by a typo). Logging avoided to keep this path silent in tests.
            return true;
        }

        const get = (type) => (parts.find(p => p.type === type) || {}).value;
        const weekdayMap = {
            Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu',
            Fri: 'fri', Sat: 'sat', Sun: 'sun'
        };
        const day = weekdayMap[get('weekday')];
        const hour = parseInt(get('hour'), 10);
        const minute = parseInt(get('minute'), 10);
        if (!day || Number.isNaN(hour) || Number.isNaN(minute)) return true;

        const nowMin = hour * 60 + minute;
        const ranges = (hh.schedule && hh.schedule[day]) || [];
        if (!Array.isArray(ranges) || ranges.length === 0) return false;

        for (const r of ranges) {
            if (!r || typeof r.open !== 'string' || typeof r.close !== 'string') continue;
            const [oh, om] = r.open.split(':').map(n => parseInt(n, 10));
            const [ch, cm] = r.close.split(':').map(n => parseInt(n, 10));
            if ([oh, om, ch, cm].some(Number.isNaN)) continue;
            const openMin = oh * 60 + om;
            const closeMin = ch * 60 + cm;
            // Same-day window only. Inclusive open, exclusive close.
            if (nowMin >= openMin && nowMin < closeMin) return true;
        }
        return false;
    }
}

module.exports = { ChatbotService };
