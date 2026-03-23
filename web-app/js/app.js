// App State
const state = {
    isAuthenticated: false,
    pin: '',
    host: localStorage.getItem('sc_host') || '',
    volume: 50,
    muted: false,
    isPlaying: false
};

// Elements
const els = {
    screens: {
        connection: document.getElementById('connection-screen'),
        scanner: document.getElementById('scanner-screen'),
        login: document.getElementById('login-screen'),
        app: document.getElementById('app-screen')
    },
    mode: {
        auto: document.getElementById('btn-mode-auto'),
        manual: document.getElementById('btn-mode-manual')
    },
    scanner: {
        element: document.getElementById('reader'),
        back: document.getElementById('btn-scanner-back')
    },
    login: {
        pinDisplay: document.getElementById('pin-display'),
        keyboard: document.querySelectorAll('.btn-keypad'),
        del: document.getElementById('btn-del'),
        go: document.getElementById('btn-go'),
        error: document.getElementById('login-error'),
        settingsBtn: document.getElementById('btn-settings'),
        settingsPanel: document.getElementById('settings-panel'),
        serverInput: document.getElementById('server-url')
    },
    app: {
        volDisplay: document.getElementById('vol-display'),
        volSlider: document.getElementById('vol-slider'),
        volUp: document.getElementById('btn-vol-up'),
        volDown: document.getElementById('btn-vol-down'),
        muteBtn: document.getElementById('btn-mute'),
        muteIcon: document.getElementById('icon-mute'),
        prev: document.getElementById('btn-prev'),
        next: document.getElementById('btn-next'),
        play: document.getElementById('btn-playpause'),
        playIcon: document.getElementById('icon-play')
    }
};

const scanner = {
    instance: null,
    active: false
};

// Init
function init() {
    // Check URL params for auto-login
    const urlParams = new URLSearchParams(window.location.search);
    const pinParam = urlParams.get('pin');

    if (pinParam) {
        state.pin = pinParam;
        // Assume current host if scanned
        state.host = window.location.origin;
        els.screens.connection.classList.add('d-none');
        attemptLogin();
    } else {
        // Show Connection Screen (default)
        setupConnectionModes();
    }

    setupLogin();
    setupControls();

    // Auto-fill host if saved
    if (state.host) {
        els.login.serverInput.value = state.host;
    }

    // Dev fallback
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        if (!state.host) {
            state.host = window.location.origin;
            els.login.serverInput.value = state.host;
        }
    }
}

// --- Connection Modes ---

function setupConnectionModes() {
    // Manual
    els.mode.manual.addEventListener('click', () => {
        els.screens.connection.classList.add('d-none');
        els.screens.login.classList.remove('d-none');
        els.screens.login.classList.add('d-flex');
    });

    // Auto (Scanner)
    els.mode.auto.addEventListener('click', startScanner);

    // Scanner Back
    els.scanner.back.addEventListener('click', stopScanner);
}

function startScanner() {
    els.screens.connection.classList.add('d-none');
    els.screens.scanner.classList.remove('d-none');
    els.screens.scanner.classList.add('d-flex');

    if (!scanner.instance) {
        scanner.instance = new Html5Qrcode("reader");
    }

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    // Attempt to use back camera
    scanner.instance.start(
        { facingMode: "environment" },
        config,
        onScanSuccess,
        onScanError
    ).catch(err => {
        console.error("Camera start fail:", err);
        // Fallback or alert user
        alert("Camera error: " + err);
        stopScanner();
    });

    scanner.active = true;
}

async function stopScanner(restoreUI = true) {
    if (scanner.instance && scanner.active) {
        try {
            await scanner.instance.stop();
        } catch (e) { console.error(e); }
        scanner.active = false;
    }
    els.screens.scanner.classList.add('d-none');
    els.screens.scanner.classList.remove('d-flex');

    if (restoreUI) {
        els.screens.connection.classList.remove('d-none');
    }

    // Reset overlay style if it was green
    const overlay = document.querySelector('.scan-overlay');
    if (overlay) {
        overlay.classList.remove('border-success');
        overlay.style.boxShadow = '';
    }
}

function onScanSuccess(decodedText) {
    if (!scanner.active) return; // Prevent multiple triggers

    // Visual Success Feedback
    const overlay = document.querySelector('.scan-overlay');
    overlay.style.borderColor = '#198754'; // Bootstrap success green
    overlay.style.boxShadow = '0 0 0 1000px rgba(0, 0, 0, 0.8)';

    if (navigator.vibrate) navigator.vibrate(200);

    // Stop scanning after short delay to show success state
    setTimeout(async () => {
        // Don't restore UI yet, we are processing
        await stopScanner(false);
        processScanResult(decodedText);
    }, 500);
}

function processScanResult(decodedText) {

    try {
        // Expected format: URL?pin=...
        // Or if simple URL, maybe just prompt PIN?
        // But user asked for auto connect.

        let urlObj;
        try {
            urlObj = new URL(decodedText);
        } catch {
            // Invalid URL
            alert('Invalid QR Code');
            return;
        }

        const pin = urlObj.searchParams.get('pin');
        if (pin) {
            state.pin = pin;
            state.host = urlObj.origin;

            // Force HTTPS to prevent Mixed Content
            if (state.host.startsWith('http://')) {
                state.host = state.host.replace('http://', 'https://');
            }

            localStorage.setItem('sc_host', state.host);

            // Go to login
            attemptLogin();
        } else {
            alert('QR Code does not contain a PIN. Please update PC App.');
            state.host = urlObj.origin;
            // Go to manual login with host prefilled
            els.screens.login.classList.remove('d-none');
            els.screens.login.classList.add('d-flex');
            els.login.serverInput.value = state.host;
            els.login.settingsPanel.classList.remove('d-none'); // Show it so they see why
        }

    } catch (e) {
        console.error(e);
        alert('Failed to process QR Code');
    }
}

function onScanError(err) {
    // console.warn(err);
}

// --- Logic ---

function getUrl(path) {
    let base = state.host;
    // Fallback if empty, but for Vercel providing an empty host is bad if not manually set.
    // If base is empty, we assume current origin.
    if (!base) base = window.location.origin;

    // Remove trailing slash
    base = base.replace(/\/$/, '');

    // Ensure protocol
    if (!base.startsWith('http')) {
        base = `https://${base}`;
    }
    // Force HTTPS (Mixed Content Fix)
    if (base.startsWith('http://')) {
        base = base.replace('http://', 'https://');
    }

    return `${base}${path}`;
}

async function apiCall(path, body = null) {
    const headers = {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true'
    };
    if (state.pin) headers['x-auth-pin'] = state.pin;

    const opts = {
        method: body ? 'POST' : 'GET',
        headers
    };
    if (body) opts.body = JSON.stringify(body);

    try {
        const url = getUrl(path);
        const res = await fetch(url, opts);

        // Handle non-JSON responses (like 404 HTML, or Tunnel crash)
        const text = await res.text();
        try {
            const json = JSON.parse(text);
            if (!res.ok) throw new Error(json.error || `Status: ${res.status}`);
            return json;
        } catch (e) {
            console.error("Invalid JSON:", text.substring(0, 100)); // Log first 100 chars
            throw new Error(`Server Error: ${res.status}`);
        }
    } catch (e) {
        console.error(`API Fail: ${path}`, e);
        throw e;
    }
}

// --- Login Screen ---

function setupLogin() {
    els.login.keyboard.forEach(btn => {
        btn.addEventListener('click', () => {
            if (state.pin.length < 4) {
                state.pin += btn.dataset.key;
                updatePinDisplay();
            }
        });
    });

    els.login.del.addEventListener('click', () => {
        state.pin = state.pin.slice(0, -1);
        updatePinDisplay();
    });

    els.login.go.addEventListener('click', attemptLogin);

    // Settings Toggle
    els.login.settingsBtn.addEventListener('click', () => {
        els.login.settingsPanel.classList.toggle('d-none');
    });

    // Save Host on Input
    els.login.serverInput.addEventListener('input', (e) => {
        state.host = e.target.value.trim();
        localStorage.setItem('sc_host', state.host);
    });
}

function updatePinDisplay() {
    const dots = els.login.pinDisplay.children;
    for (let i = 0; i < 4; i++) {
        if (i < state.pin.length) {
            dots[i].classList.add('active');
        } else {
            dots[i].classList.remove('active');
        }
    }
    els.login.error.classList.add('d-none');
}

async function attemptLogin() {
    if (state.pin.length !== 4) return;

    // UI Loading state could go here
    els.login.go.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

    try {
        const res = await apiCall('/api/auth', { pin: state.pin });
        if (res.success) {
            state.isAuthenticated = true;
            showApp();
            fetchState();
            setInterval(fetchState, 3000); // Poll
        }
    } catch (e) {
        // If we are on login screen, show error there
        if (!els.screens.login.classList.contains('d-none')) {
            els.login.error.classList.remove('d-none');
            els.login.error.textContent = 'Connection Failed or Invalid PIN';
        } else {
            // Auto-login failure
            alert('Connection Failed. Please check if PC App is running.');
            // Go back to connection screen
            els.screens.connection.classList.remove('d-none');
        }
    } finally {
        els.login.go.textContent = 'GO';
    }
}

function showApp() {
    els.screens.login.classList.add('d-none');
    els.screens.login.classList.remove('d-flex');
    els.screens.connection.classList.add('d-none'); // Ensure this is gone too
    els.screens.app.classList.remove('d-none');
    els.screens.app.classList.add('d-flex');
}

// --- App Control ---

async function fetchState() {
    try {
        const data = await apiCall('/api/volume');
        updateUI(data.volume, data.muted);
        updateConnectionStatus(true);
    } catch (e) {
        console.error('Sync failed', e);
        updateConnectionStatus(false);
    }
}

function updateConnectionStatus(connected) {
    const statusText = document.querySelector('.text-uppercase.small.fw-bold.text-cyan.tracking-widest');
    const statusDot = document.querySelector('.status-indicator');

    if (connected) {
        statusText.textContent = 'CONNECTED';
        statusText.classList.remove('text-danger');
        statusText.classList.add('text-cyan');
        statusDot.className = 'status-indicator bg-success rounded-circle';
    } else {
        statusText.textContent = 'DISCONNECTED';
        statusText.classList.remove('text-cyan');
        statusText.classList.add('text-danger');
        statusDot.className = 'status-indicator bg-danger rounded-circle';
    }
}

function updateUI(vol, muted) {
    state.volume = vol;
    state.muted = muted;

    els.app.volDisplay.textContent = vol;
    els.app.volSlider.value = vol;

    // Update Mute
    if (muted) {
        els.app.muteIcon.className = 'bi bi-volume-mute-fill text-danger fs-3';
    } else {
        els.app.muteIcon.className = 'bi bi-volume-up-fill fs-3';
    }
}

function setupControls() {
    // Volume Helper
    let volDebounce;
    const setVolume = (val) => {
        val = parseInt(val);
        if (isNaN(val)) val = 0;
        if (val < 0) val = 0;
        if (val > 100) val = 100;

        updateUI(val, state.muted); // Optimistic UI update

        // Debounce network request
        clearTimeout(volDebounce);
        volDebounce = setTimeout(() => {
            apiCall('/api/volume', { volume: val }).catch(() => {
                // Ignore error
            });
        }, 150);
    };

    // Slider
    els.app.volSlider.addEventListener('input', (e) => {
        setVolume(e.target.value);
    });

    // Buttons
    els.app.volUp.addEventListener('click', () => {
        setVolume(state.volume + 5);
    });

    els.app.volDown.addEventListener('click', () => {
        setVolume(state.volume - 5);
    });

    // Mute
    els.app.muteBtn.addEventListener('click', () => {
        const newVal = !state.muted;
        updateUI(state.volume, newVal);
        apiCall('/api/volume', { muted: newVal });
    });

    // Media
    const media = async (action) => {
        if (navigator.vibrate) navigator.vibrate(20);
        apiCall('/api/media', { action });

        if (action === 'playpause') {
            // Toggle Icon Optimistically
            const icon = els.app.playIcon;
            icon.className = icon.className.includes('play') ? 'bi bi-pause-fill fs-1' : 'bi bi-play-fill fs-1';
        }
    };

    els.app.prev.addEventListener('click', () => media('prev'));
    els.app.next.addEventListener('click', () => media('next'));
    els.app.play.addEventListener('click', () => media('playpause'));
}

// Run
window.addEventListener('DOMContentLoaded', init);
