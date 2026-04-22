/**
 * IP & Geolocation Utilities
 * 
 * Single Responsibility: IP address handling and geolocation
 */

const http = require('http');
const https = require('https');

// Optional geoip-lite dependency
let geoip;
try {
    geoip = require('geoip-lite');
} catch (e) {
    geoip = null;
}

// Cache for public IP (for local testing)
let cachedPublicIP = null;

/**
 * Get public IP address from external service
 * @returns {Promise<string|null>}
 */
async function getPublicIP() {
    if (cachedPublicIP) return cachedPublicIP;

    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 5000);

        https.get('https://api.ipify.org?format=json', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                clearTimeout(timeout);
                try {
                    const json = JSON.parse(data);
                    cachedPublicIP = json.ip;
                    resolve(cachedPublicIP);
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => {
            clearTimeout(timeout);
            resolve(null);
        });
    });
}

/**
 * Initialize public IP cache
 */
function initPublicIP() {
    getPublicIP().then(ip => {
        if (ip) {
            console.log(`Public IP detected: ${ip}`);
        }
    });
}

/**
 * Get real IP from socket or request
 * @param {Object} socket - Socket.IO socket
 * @param {Object} req - HTTP request (optional)
 * @returns {string}
 */
function getRealIP(socket, req = null) {
    const headers = req?.headers || socket?.handshake?.headers || {};

    const forwardedFor = headers['x-forwarded-for'];
    const realIP = headers['x-real-ip'];
    const cfConnectingIP = headers['cf-connecting-ip'];

    let ip = cfConnectingIP || realIP ||
        (forwardedFor ? forwardedFor.split(',')[0].trim() : null) ||
        socket?.handshake?.address ||
        socket?.request?.connection?.remoteAddress ||
        req?.socket?.remoteAddress;

    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
        ip = '127.0.0.1';
    }

    if (ip && ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }

    return ip || 'unknown';
}

/**
 * Fetch IP geolocation from ip-api.com
 * @param {string} ip - IP address
 * @returns {Promise<Object|null>}
 */
async function fetchIPGeo(ip) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 5000);

        http.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,lat,lon,timezone,isp,org,as,proxy,hosting`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                clearTimeout(timeout);
                try {
                    const json = JSON.parse(data);
                    if (json.status === 'success') {
                        resolve({
                            country: json.country,
                            countryCode: json.countryCode,
                            region: json.regionName,
                            city: json.city,
                            timezone: json.timezone,
                            ll: [json.lat, json.lon],
                            isp: json.isp,
                            org: json.org,
                            as: json.as,
                            isProxy: json.proxy,
                            isHosting: json.hosting
                        });
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => {
            clearTimeout(timeout);
            resolve(null);
        });
    });
}

/**
 * Analyze IP address for VPN/proxy detection
 * @param {string} ip - IP address
 * @returns {Promise<Object>}
 */
async function analyzeIP(ip) {
    let effectiveIP = ip;
    if (ip === '127.0.0.1' || ip === 'localhost') {
        effectiveIP = cachedPublicIP || await getPublicIP() || ip;
    }

    const result = {
        ip: ip,
        displayIP: effectiveIP,
        isVPN: false,
        isProxy: false,
        isDatacenter: false,
        vpnConfidence: 0,
        geo: null,
        isp: null,
        org: null,
        warnings: [],
        isLocalTest: ip === '127.0.0.1' || ip === 'localhost'
    };

    if (effectiveIP === '127.0.0.1' || effectiveIP === 'localhost') {
        result.warnings.push('Localhost connection');
        return result;
    }

    const geoData = await fetchIPGeo(effectiveIP);

    if (geoData) {
        result.geo = {
            country: geoData.country,
            countryCode: geoData.countryCode,
            region: geoData.region,
            city: geoData.city,
            timezone: geoData.timezone,
            ll: geoData.ll
        };
        result.isp = geoData.isp;
        result.org = geoData.org;

        if (geoData.isProxy) {
            result.isProxy = true;
            result.vpnConfidence = 80;
            result.warnings.push('Proxy detected');
        }
        if (geoData.isHosting) {
            result.isDatacenter = true;
            result.vpnConfidence = Math.max(result.vpnConfidence, 60);
            result.warnings.push('Datacenter IP');
        }
    } else if (geoip) {
        const geo = geoip.lookup(effectiveIP);
        if (geo) {
            result.geo = {
                country: geo.country,
                countryCode: geo.country, // geoip-lite returns ISO-2 in `country`
                region: geo.region,
                city: geo.city,
                timezone: geo.timezone,
                ll: geo.ll
            };
        }
    }

    return result;
}

/**
 * Validate browser location against IP geolocation
 * @param {Object} browserGeo - Browser geolocation { latitude, longitude }
 * @param {Object} ipGeo - IP geolocation { ll: [lat, lon] }
 * @param {number} toleranceKm - Tolerance in kilometers
 * @returns {Object} Validation result
 */
function validateLocationMatch(browserGeo, ipGeo, toleranceKm = 1500) {
    if (!browserGeo || !ipGeo || !ipGeo.ll) {
        return { valid: false, reason: 'Missing location data' };
    }

    const [ipLat, ipLon] = ipGeo.ll;
    const browserLat = browserGeo.latitude;
    const browserLon = browserGeo.longitude;

    // Haversine formula
    const R = 6371; // Earth radius in km
    const dLat = (browserLat - ipLat) * Math.PI / 180;
    const dLon = (browserLon - ipLon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(ipLat * Math.PI / 180) * Math.cos(browserLat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return {
        valid: distance <= toleranceKm,
        distance: Math.round(distance),
        reason: distance > toleranceKm ?
            `Location mismatch: ${Math.round(distance)}km` :
            'Location verified'
    };
}

/**
 * Calculate distance between two coordinates
 * @param {number} lat1 - First latitude
 * @param {number} lon1 - First longitude
 * @param {number} lat2 - Second latitude
 * @param {number} lon2 - Second longitude
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Check whether a geo result should be blocked according to a geoBlocking config.
 *
 * Config shape:
 *   { enabled: boolean, mode: 'blocklist'|'allowlist', countries: string[] }
 *
 * Country matching is case-insensitive and accepts either ISO-2 codes
 * (preferred, e.g. 'US') or full country names (e.g. 'United States').
 *
 * @param {Object|null} geo - Geolocation object (from analyzeIP result.geo)
 * @param {Object|null} geoBlocking - Geo blocking config
 * @returns {{ blocked: boolean, reason: string|null, country: string|null }}
 */
function isCountryBlocked(geo, geoBlocking) {
    if (!geoBlocking || !geoBlocking.enabled) {
        return { blocked: false, reason: null, country: null };
    }

    const list = Array.isArray(geoBlocking.countries) ? geoBlocking.countries : [];
    const mode = geoBlocking.mode === 'allowlist' ? 'allowlist' : 'blocklist';

    // No countries configured: blocklist allows everyone, allowlist blocks everyone
    if (list.length === 0) {
        if (mode === 'allowlist') {
            return { blocked: true, reason: 'No countries on allowlist', country: null };
        }
        return { blocked: false, reason: null, country: null };
    }

    const code = (geo && geo.countryCode ? String(geo.countryCode) : '').toUpperCase();
    const name = (geo && geo.country ? String(geo.country) : '').toUpperCase();
    const normalized = list
        .filter(c => typeof c === 'string' && c.trim())
        .map(c => c.trim().toUpperCase());

    const inList = normalized.some(entry => entry === code || entry === name);

    if (mode === 'allowlist') {
        return inList
            ? { blocked: false, reason: null, country: code || name || null }
            : { blocked: true, reason: `Country ${code || name || 'unknown'} not on allowlist`, country: code || name || null };
    }

    // blocklist
    return inList
        ? { blocked: true, reason: `Country ${code || name} is blocked`, country: code || name }
        : { blocked: false, reason: null, country: code || name || null };
}

module.exports = {
    getPublicIP,
    initPublicIP,
    getRealIP,
    fetchIPGeo,
    analyzeIP,
    validateLocationMatch,
    calculateDistance,
    isCountryBlocked
};
