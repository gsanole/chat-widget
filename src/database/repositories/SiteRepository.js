/**
 * Site Repository
 * 
 * Single Responsibility: Site/app data access (multi-tenant support)
 */

const { BaseRepository, generateId, generateToken, now } = require('./BaseRepository');

class SiteRepository extends BaseRepository {
    /**
     * @param {JsonDB} db - Sites database
     * @param {JsonDB} ticketsDb - Tickets database (for stats)
     */
    constructor(db, ticketsDb = null) {
        super(db);
        this.ticketsDb = ticketsDb;
    }

    /**
     * Create a new site
     * @param {Object} siteData
     * @returns {Object}
     */
    create({ name, domain, description = '' }) {
        const site = {
            id: generateId(),
            name,
            domain,
            description,
            api_key: generateToken(),
            is_active: true,
            chatbot_config: null,
            color_primary: '#2563eb',
            color_secondary: '#1e40af',
            welcome_message: null,
            created_at: now(),
            updated_at: now()
        };

        this.db.insert(site);
        return site;
    }

    /**
     * Find site by API key
     * @param {string} apiKey
     * @returns {Object|undefined}
     */
    findByApiKey(apiKey) {
        return this.db.find(s => s.api_key === apiKey && s.is_active);
    }

    /**
     * Find site by domain
     * @param {string} domain
     * @returns {Object|undefined}
     */
    findByDomain(domain) {
        return this.db.find(s => s.domain === domain);
    }

    /**
     * Find all sites
     * @returns {Array}
     */
    findAll() {
        return this.db.getAll().sort((a, b) => b.created_at - a.created_at);
    }

    /**
     * Find active sites
     * @returns {Array}
     */
    findActive() {
        return this.db.filter(s => s.is_active).sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Update site (excluding api_key and id)
     * @param {string} id
     * @param {Object} updates
     * @returns {Object|null}
     */
    update(id, updates) {
        delete updates.api_key;
        delete updates.id;
        return this.db.update(s => s.id === id, updates);
    }

    /**
     * Regenerate API key for a site
     * @param {string} id
     * @returns {string} New API key
     */
    regenerateApiKey(id) {
        const newKey = generateToken();
        this.db.update(s => s.id === id, { api_key: newKey });
        return newKey;
    }

    /**
     * Update chatbot configuration for a site
     * @param {string} id
     * @param {Object} config
     * @returns {Object|null}
     */
    updateChatbotConfig(id, config) {
        return this.db.update(s => s.id === id, { chatbot_config: config });
    }

    /**
     * Delete a site
     * @param {string} id
     * @returns {boolean}
     */
    delete(id) {
        return this.db.delete(s => s.id === id);
    }

    /**
     * Get ticket statistics for a site
     * @param {string} id
     * @returns {Object}
     */
    getStats(id) {
        if (!this.ticketsDb) {
            return { total_tickets: 0, open_tickets: 0, resolved_tickets: 0 };
        }

        const tickets = this.ticketsDb.filter(t => t.site_id === id);
        return {
            total_tickets: tickets.length,
            open_tickets: tickets.filter(t => t.status === 'open').length,
            resolved_tickets: tickets.filter(t => t.status === 'resolved').length
        };
    }
}

module.exports = { SiteRepository };
