const express = require('express');
const cors = require('cors');
const loudness = require('loudness');
const localtunnel = require('localtunnel');
const qrcode = require('qrcode-terminal');
const { playPause, nextTrack, prevTrack } = require('./media');
const path = require('path');
const https = require('https');

const app = express();
const PORT = 3000;

// Config
app.use(cors());
app.use(express.json());

// Serve Frontend
// Serve Frontend
const distPath = path.join(__dirname, '../web-app');
app.use(express.static(distPath));


// Auth State
let AUTH_PIN = Math.floor(1000 + Math.random() * 9000).toString();
const MAX_RETRIES = 10;
let tunnelRetryCount = 0;
let activeTunnel = null;
let restartTimer = null;
let heartbeatTimer = null;
let heartbeatFailures = 0;
const HEARTBEAT_INTERVAL_MS = 30000;
const MAX_HEARTBEAT_FAILURES = 3;
const preferredSubdomain = (process.env.SC_TUNNEL_SUBDOMAIN || process.env.COMPUTERNAME || 'sound-control-pc')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const clearHeartbeat = () => {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    heartbeatFailures = 0;
};

const clearRestart = () => {
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
};

const closeActiveTunnel = () => {
    if (activeTunnel) {
        activeTunnel.removeAllListeners('close');
        activeTunnel.removeAllListeners('error');
        try {
            activeTunnel.close();
        } catch (e) {
            // Ignore close errors during forced restart.
        }
        activeTunnel = null;
    }
};

const pingTunnelHealth = (url) => new Promise((resolve, reject) => {
    const req = https.get(`${url}/api/health`, {
        headers: { 'Bypass-Tunnel-Reminder': 'true' }
    }, (res) => {
        const statusCode = res.statusCode || 0;
        res.resume();

        if (statusCode >= 200 && statusCode < 300) {
            resolve();
        } else {
            reject(new Error(`Heartbeat status ${statusCode}`));
        }
    });

    req.setTimeout(10000, () => {
        req.destroy(new Error('Heartbeat timeout'));
    });

    req.on('error', reject);
});

// Routes
// 1. Auth Check
app.post('/api/auth', (req, res) => {
    const { pin } = req.body;
    if (pin === AUTH_PIN) {
        res.json({ success: true, token: 'valid' });
    } else {
        res.status(401).json({ success: false, error: 'Invalid PIN' });
    }
});

// Unauthenticated endpoint used by tunnel heartbeat monitoring.
app.get('/api/health', (req, res) => {
    res.json({ ok: true, ts: Date.now() });
});

// Middleware for protected routes
const requireAuth = (req, res, next) => {
    const pin = req.headers['x-auth-pin'];
    if (pin === AUTH_PIN) return next();
    res.status(401).json({ error: 'Unauthorized' });
};

// 2. Volume Control
app.get('/api/volume', requireAuth, async (req, res) => {
    try {
        const [vol, muted] = await Promise.all([loudness.getVolume(), loudness.getMuted()]);
        res.json({ volume: vol, muted });
    } catch (e) {
        res.status(500).json({ error: 'System audio error' });
    }
});

app.post('/api/volume', requireAuth, async (req, res) => {
    const { volume, muted } = req.body;
    try {
        if (typeof volume === 'number') await loudness.setVolume(volume);
        if (typeof muted === 'boolean') await loudness.setMuted(muted);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to set volume' });
    }
});

// 3. Media Control
app.post('/api/media', requireAuth, (req, res) => {
    const { action } = req.body;
    switch (action) {
        case 'playpause': playPause(); break;
        case 'next': nextTrack(); break;
        case 'prev': prevTrack(); break;
    }
    res.json({ success: true });
});

// SPA Fallback
// app.get('*', (req, res) => {
//     res.sendFile(path.join(distPath, 'index.html'));
// });

// Start Server & Tunnel
const startTunnel = async () => {
    try {
        closeActiveTunnel();
        let tunnel;
        if (preferredSubdomain) {
            try {
                tunnel = await localtunnel({ port: PORT, subdomain: preferredSubdomain });
            } catch (subdomainErr) {
                console.warn(`Preferred subdomain failed (${preferredSubdomain}): ${subdomainErr.message}`);
                console.warn('Falling back to random tunnel URL...');
                tunnel = await localtunnel({ port: PORT });
            }
        } else {
            tunnel = await localtunnel({ port: PORT });
        }

        activeTunnel = tunnel;

        console.clear();
        console.log('\n' + '='.repeat(50));
        console.log('   FUTURE SOUND CONTROL - PC SERVER');
        console.log('='.repeat(50));

        console.log('\n1. SCAN THIS QR CODE WITH YOUR PHONE:');
        console.log('(Works on ANY network - 4G/5G/Wi-Fi)\n');

        const qrUrl = `${tunnel.url}?pin=${AUTH_PIN}`;
        qrcode.generate(qrUrl, { small: true });

        console.log(`\nURL: ${qrUrl}`);
        console.log('-'.repeat(50));
        console.log(`\n2. ENTER PIN ON PHONE:  [ ${AUTH_PIN} ]`);
        console.log(`\nServer is running on port ${PORT}...`);

        // Reset retry count on successful connection
        tunnelRetryCount = 0;
        clearRestart();
        clearHeartbeat();

        heartbeatTimer = setInterval(async () => {
            try {
                await pingTunnelHealth(tunnel.url);

                heartbeatFailures = 0;
            } catch (err) {
                heartbeatFailures += 1;
                console.warn(`Heartbeat failed (${heartbeatFailures}/${MAX_HEARTBEAT_FAILURES}): ${err.message}`);

                if (heartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
                    console.warn('Tunnel heartbeat failed repeatedly. Reconnecting tunnel...');
                    clearHeartbeat();
                    handleRestart();
                }
            }
        }, HEARTBEAT_INTERVAL_MS);

        tunnel.on('close', () => {
            console.log('Tunnel closed. Restarting...');
            clearHeartbeat();
            handleRestart();
        });

        tunnel.on('error', (err) => {
            console.error('Tunnel Connection Error:', err.message);
            clearHeartbeat();
            handleRestart();
        });

    } catch (err) {
        console.error('Tunnel Init Error:', err.message);
        handleRestart();
    }
};

const handleRestart = () => {
    clearRestart();
    closeActiveTunnel();

    if (tunnelRetryCount < MAX_RETRIES) {
        tunnelRetryCount++;
        console.log(`Retrying tunnel in 2s... (Attempt ${tunnelRetryCount}/${MAX_RETRIES})`);
        restartTimer = setTimeout(startTunnel, 2000);
    } else {
        console.error('Max retries reached. Please move to a better network or restart the app.');
        console.log('Will keep trying every 10s...');
        restartTimer = setTimeout(() => {
            tunnelRetryCount = 0;
            startTunnel();
        }, 10000);
    }
};

app.listen(PORT, () => {
    startTunnel();
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
