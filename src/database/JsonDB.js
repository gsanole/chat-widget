/**
 * Base JSON Database Class
 * 
 * Single Responsibility: File-based JSON storage
 * Open/Closed: Extensible via inheritance
 */

const fs = require('fs');
const path = require('path');

const DB_DIR = process.env.DATABASE_DIR || path.join(__dirname, '../../data');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

/**
 * Base class for JSON file-based database
 */
class JsonDB {
    /**
     * @param {string} filename - JSON file name (without path)
     * @param {*} defaultData - Default data structure
     */
    constructor(filename, defaultData = []) {
        this.filePath = path.join(DB_DIR, filename);
        this.data = this.load(defaultData);
        this._saveDebounceTimer = null;
        this._saveDebounceMs = 100;
    }

    /**
     * Load data from file
     * @param {*} defaultData - Default if file doesn't exist
     * @returns {*}
     */
    load(defaultData) {
        try {
            if (fs.existsSync(this.filePath)) {
                const content = fs.readFileSync(this.filePath, 'utf8');
                return JSON.parse(content);
            }
        } catch (err) {
            console.error(`Error loading ${this.filePath}:`, err.message);
        }
        return defaultData;
    }

    /**
     * Save data to file
     */
    save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
        } catch (err) {
            console.error(`Error saving ${this.filePath}:`, err.message);
        }
    }

    /**
     * Debounced save to prevent excessive writes
     */
    debouncedSave() {
        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
        }
        this._saveDebounceTimer = setTimeout(() => {
            this.save();
            this._saveDebounceTimer = null;
        }, this._saveDebounceMs);
    }

    /**
     * Insert a record
     * @param {Object} record - Record to insert
     * @returns {Object} Inserted record
     */
    insert(record) {
        this.data.push(record);
        this.save();
        return record;
    }

    /**
     * Find first matching record
     * @param {Function} predicate - Filter function
     * @returns {Object|undefined}
     */
    find(predicate) {
        return this.data.find(predicate);
    }

    /**
     * Find all matching records
     * @param {Function} predicate - Filter function
     * @returns {Array}
     */
    filter(predicate) {
        return this.data.filter(predicate);
    }

    /**
     * Update first matching record
     * @param {Function} predicate - Filter function
     * @param {Object} updates - Fields to update
     * @returns {Object|null}
     */
    update(predicate, updates) {
        const item = this.data.find(predicate);
        if (item) {
            Object.assign(item, updates, { updated_at: Math.floor(Date.now() / 1000) });
            this.save();
            return item;
        }
        return null;
    }

    /**
     * Delete matching records
     * @param {Function} predicate - Filter function
     * @returns {boolean} True if any deleted
     */
    delete(predicate) {
        const initialLength = this.data.length;
        this.data = this.data.filter(item => !predicate(item));
        if (this.data.length !== initialLength) {
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Count records
     * @param {Function} predicate - Optional filter function
     * @returns {number}
     */
    count(predicate) {
        return predicate ? this.data.filter(predicate).length : this.data.length;
    }

    /**
     * Get all data
     * @returns {Array}
     */
    getAll() {
        return [...this.data];
    }

    /**
     * Clear all data
     */
    clear() {
        this.data = [];
        this.save();
    }
}

module.exports = { JsonDB, DB_DIR };
