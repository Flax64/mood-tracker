// ==========================================
// SIMULATED HTTPS HYBRID TRANSPORT LAYER (X25519 + AES-256-CTR + HMAC-SHA256)
// ==========================================
const rawBrowserFetch = typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : null;

const clientTransportTunnel = (
    typeof window !== 'undefined'
    && window.TransportCrypto
    && window.CryptoJS
    && window.CryptoJS.algo
    && window.CryptoJS.algo.AES
    && typeof window.TransportCrypto.createClientTunnel === 'function'
)
    ? window.TransportCrypto.createClientTunnel({ CryptoJS: window.CryptoJS })
    : null;

let lastCapturedWirePacket = null;

function formatCompactBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function updateTransportStatusBadges() {
    const authPill = document.getElementById('authTunnelPill');
    const mobilePill = document.getElementById('mobileTunnelPill');
    const sidebarBadge = document.getElementById('sidebarTunnelBadge');
    const diagKid = document.getElementById('transportDiagKid');
    const diagStats = document.getElementById('transportDiagStats');

    const setSidebarBadge = (iconText, labelText) => {
        if (!sidebarBadge) return;
        const iconSpan = sidebarBadge.querySelector('.tunnel-icon');
        const labelSpan = sidebarBadge.querySelector('.tunnel-label');
        if (iconSpan && labelSpan) {
            iconSpan.textContent = iconText;
            labelSpan.textContent = labelText;
        } else {
            sidebarBadge.textContent = `${iconText} ${labelText}`;
        }
        sidebarBadge.title = `${iconText} ${labelText}`;
    };

    if (!clientTransportTunnel) {
        if (authPill) {
            authPill.textContent = '⚠️ Wire: Plain HTTP fallback';
            authPill.classList.add('is-pending');
        }
        setSidebarBadge('⚠️', 'Wire: Standard HTTP');
        return;
    }

    const diag = clientTransportTunnel.getDiagnostics();
    const totalBytes = (diag.metrics.totalBytesEncrypted || 0) + (diag.metrics.totalBytesDecrypted || 0);
    const totalReqs = Math.max(diag.metrics.encryptedRequests || 0, diag.metrics.decryptedResponses || 0);

    if (diag.ready && diag.kid) {
        if (authPill) {
            authPill.textContent = `🔐 Wire: AES-256-CTR (${diag.kid.slice(0, 8)}…)`;
            authPill.classList.remove('is-pending');
        }
        if (mobilePill) {
            mobilePill.textContent = '🔐 E2E';
            mobilePill.classList.remove('is-pending');
        }
        setSidebarBadge('🔐', `Wire: X25519+AES (${diag.kid.slice(0, 8)}…)`);
        if (diagKid) diagKid.textContent = `${diag.kid} (${diag.metrics.lastHandshakeMs} ms X25519)`;
        if (diagStats) {
            diagStats.textContent = `${totalReqs} encrypted msgs · ${formatCompactBytes(totalBytes)} on wire`;
        }
    } else {
        if (authPill) {
            authPill.textContent = '🔐 Wire Tunnel: Establishing X25519...';
            authPill.classList.add('is-pending');
        }
        setSidebarBadge('🔐', 'Wire: Connecting...');
        if (diagKid) diagKid.textContent = 'Pending X25519 handshake...';
    }
}

if (rawBrowserFetch && clientTransportTunnel) {
    window.fetch = async function encryptedTransportFetch(input, init = {}) {
        const urlStr = typeof input === 'string'
            ? input
            : (input && typeof input.url === 'string' ? input.url : '');

        const isSameOriginApi = urlStr.startsWith('/api/') && !urlStr.startsWith('/api/transport/handshake');
        if (!isSameOriginApi) {
            return rawBrowserFetch(input, init);
        }

        const headers = new Headers(init.headers || {});
        if (headers.has('X-Bypass-Transport-Encrypt')) {
            headers.delete('X-Bypass-Transport-Encrypt');
            return rawBrowserFetch(input, { ...init, headers });
        }

        try {
            if (!clientTransportTunnel.isReady()) {
                await clientTransportTunnel.establishSession(rawBrowserFetch);
                updateTransportStatusBadges();
            }
        } catch (hsErr) {
            // Do not crash app UI if transient network issue happens during handshake
            return rawBrowserFetch(input, init);
        }

        const originalBody = typeof init.body === 'string' ? init.body : null;

        const sendAttempt = async () => {
            const attemptHeaders = new Headers(headers);
            const diagNow = clientTransportTunnel.getDiagnostics();
            if (diagNow.kid) {
                attemptHeaders.set('X-Transport-Session', diagNow.kid);
            }
            attemptHeaders.set('X-Transport-Accept-Enc', '1');

            const nextInit = { ...init, headers: attemptHeaders };
            if (originalBody !== null) {
                const env = clientTransportTunnel.encryptText(originalBody);
                attemptHeaders.set('Content-Type', 'application/json');
                nextInit.body = JSON.stringify(env);
                lastCapturedWirePacket = {
                    capturedAt: new Date().toISOString(),
                    direction: 'Browser -> Server (Request)',
                    endpoint: `${String(init.method || 'GET').toUpperCase()} ${urlStr}`,
                    plaintextPreview: originalBody.slice(0, 120) + (originalBody.length > 120 ? '...' : ''),
                    plaintextBytes: originalBody.length,
                    wireEnvelope: {
                        ...env,
                        ct: env.ct.slice(0, 140) + (env.ct.length > 140 ? `... (+${env.ct.length - 140} base64 chars)` : '')
                    }
                };
            }
            return rawBrowserFetch(input, nextInit);
        };

        let res = await sendAttempt();
        if (res.status === 428 || res.headers.get('X-Transport-Rehandshake') === '1') {
            clientTransportTunnel.resetSession();
            await clientTransportTunnel.establishSession(rawBrowserFetch, true);
            res = await sendAttempt();
        }

        const encHeader = res.headers.get('X-Transport-Encrypted');
        if (encHeader === clientTransportTunnel.TRANSPORT_PROTOCOL) {
            const rawEnv = await res.json();
            if (originalBody === null) {
                lastCapturedWirePacket = {
                    capturedAt: new Date().toISOString(),
                    direction: 'Server -> Browser (Response)',
                    endpoint: `${String(init.method || 'GET').toUpperCase()} ${urlStr}`,
                    plaintextBytes: 'Encrypted response payload',
                    wireEnvelope: {
                        ...rawEnv,
                        ct: rawEnv.ct.slice(0, 140) + (rawEnv.ct.length > 140 ? `... (+${rawEnv.ct.length - 140} base64 chars)` : '')
                    }
                };
            }
            const plainText = clientTransportTunnel.decryptEnvelope(rawEnv, 's2c');
            const decodedHeaders = new Headers(res.headers);
            const innerType = res.headers.get('X-Transport-Inner-Type') || 'application/json; charset=utf-8';
            decodedHeaders.set('Content-Type', innerType);
            updateTransportStatusBadges();
            return new Response(plainText, {
                status: res.status,
                statusText: res.statusText,
                headers: decodedHeaders
            });
        }

        updateTransportStatusBadges();
        return res;
    };
}

// ==========================================
// GENERAL DATE & MOOD STATE UTILITIES
// ==========================================
function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getMomentoInfo(hour) {
    if (hour >= 0 && hour < 6) {
        return { moodKey: 'Madrugada', moodLabel: 'Late Night', saludo: 'Good early morning!', agendaBloque: 'noche' };
    }
    if (hour >= 6 && hour < 12) {
        return { moodKey: 'Morning', moodLabel: 'Morning', saludo: 'Good morning!', agendaBloque: hour < 9 ? 'manana' : 'cole' };
    }
    if (hour >= 12 && hour < 14) {
        return { moodKey: 'Noon', moodLabel: 'Noon', saludo: 'Good afternoon!', agendaBloque: 'cole' };
    }
    if (hour >= 14 && hour < 20) {
        return { moodKey: 'Afternoon', moodLabel: 'Afternoon', saludo: 'Good afternoon!', agendaBloque: 'tarde' };
    }
    return { moodKey: 'Night', moodLabel: 'Night', saludo: 'Good evening!', agendaBloque: 'noche' };
}

const MOMENTOS_LABELS = {
    Madrugada: 'Late Night',
    Morning: 'Morning',
    Noon: 'Noon',
    Afternoon: 'Afternoon',
    Night: 'Night'
};

// ==========================================
// ANTI-DOUBLE-CLICK, IDEMPOTENCY & STALE-FETCH GUARDS
// ==========================================
const busyActionElements = new WeakSet();
const pendingSubmissions = new Map();

function createIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
    return `mt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function createRequestTracker() {
    let seq = 0;
    let controller = null;
    return {
        begin() {
            seq += 1;
            if (controller) controller.abort();
            controller = typeof AbortController === 'function' ? new AbortController() : null;
            return { seq, signal: controller ? controller.signal : undefined };
        },
        isCurrent(tokenSeq) {
            return tokenSeq === seq;
        }
    };
}

function isAbortError(err) {
    return Boolean(err && err.name === 'AbortError');
}

function beginIdempotentSubmission(scopeKey, signature, buildBodyFn) {
    const existing = pendingSubmissions.get(scopeKey);
    if (existing && existing.signature === signature) {
        return {
            idempotencyKey: existing.idempotencyKey,
            body: existing.body
        };
    }
    const entry = {
        signature,
        idempotencyKey: createIdempotencyKey(),
        body: buildBodyFn ? buildBodyFn() : null
    };
    pendingSubmissions.set(scopeKey, entry);
    return {
        idempotencyKey: entry.idempotencyKey,
        body: entry.body
    };
}

function clearIdempotentSubmission(scopeKey) {
    if (scopeKey) pendingSubmissions.delete(scopeKey);
}

function createLoadingBanner(message = 'Loading...', size = 'md') {
    const wrap = document.createElement('div');
    wrap.className = 'loading-indicator';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');

    const spinner = document.createElement('span');
    spinner.className = `spinner-circle spinner-${size}`;
    spinner.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'loading-indicator-text';
    label.textContent = message;

    wrap.append(spinner, label);
    return wrap;
}

async function runWithButtonLock(btn, asyncFn, options = {}) {
    const { loadingText = '', extraDisable = [] } = options;
    if (!btn || busyActionElements.has(btn) || btn.disabled) {
        return undefined;
    }

    const targets = [btn, ...extraDisable].filter(Boolean);
    if (targets.some(el => busyActionElements.has(el))) {
        return undefined;
    }

    const prevStates = targets.map(el => ({
        el,
        hasDisabledProp: typeof el.disabled === 'boolean',
        disabled: Boolean(el.disabled),
        ariaBusy: el.getAttribute('aria-busy')
    }));
    const origChildNodes = loadingText ? Array.from(btn.childNodes) : null;

    targets.forEach(el => {
        busyActionElements.add(el);
        if (typeof el.disabled === 'boolean') el.disabled = true;
        el.setAttribute('aria-busy', 'true');
        el.classList.add('is-busy');
    });
    if (loadingText) {
        const loadingWrap = document.createElement('span');
        loadingWrap.className = 'btn-loading-content';
        const spinner = document.createElement('span');
        spinner.className = 'spinner-circle spinner-sm';
        spinner.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = loadingText;
        loadingWrap.append(spinner, label);
        btn.replaceChildren(loadingWrap);
    }

    try {
        return await asyncFn();
    } finally {
        targets.forEach(el => {
            busyActionElements.delete(el);
            el.classList.remove('is-busy');
        });
        prevStates.forEach(({ el, hasDisabledProp, disabled, ariaBusy }) => {
            if (hasDisabledProp) el.disabled = disabled;
            if (ariaBusy === null) el.removeAttribute('aria-busy');
            else el.setAttribute('aria-busy', ariaBusy);
        });
        if (origChildNodes !== null) {
            btn.replaceChildren(...origChildNodes);
        }
    }
}

async function submitMutationRequest({
    url,
    method = 'POST',
    scopeKey = '',
    signature = '',
    buildBody = null,
    parseJson = false
}) {
    let idempotencyKey = createIdempotencyKey();
    let bodyObj = buildBody ? buildBody() : null;

    if (scopeKey) {
        const sub = beginIdempotentSubmission(scopeKey, signature, () => (buildBody ? buildBody() : null));
        idempotencyKey = sub.idempotencyKey;
        bodyObj = sub.body;
    }

    const headers = { 'X-Idempotency-Key': idempotencyKey };
    const fetchOpts = { method, headers };

    if (bodyObj !== null && bodyObj !== undefined) {
        headers['Content-Type'] = 'application/json';
        fetchOpts.body = JSON.stringify(bodyObj);
    }

    const res = await fetch(url, fetchOpts);
    if (!res.ok) {
        if (scopeKey && res.status >= 400 && res.status < 500 && res.status !== 408) {
            clearIdempotentSubmission(scopeKey);
        }
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
    }

    clearIdempotentSubmission(scopeKey);
    return parseJson ? res.json() : res.text();
}

const homeSummaryTracker = createRequestTracker();
const resumenTracker = createRequestTracker();
const agendaLoadTracker = createRequestTracker();
const medicosTracker = createRequestTracker();
const settingsLoadTracker = createRequestTracker();
const remindersTracker = createRequestTracker();

function getAgendaItemStatus(item = {}) {
    const raw = String(item.estado || '').trim().toLowerCase();
    if (raw === 'todo' || raw === 'in_progress' || raw === 'done') return raw;
    return Number(item.completada) === 1 ? 'done' : 'todo';
}

function nextAgendaStatus(currentStatus) {
    if (currentStatus === 'todo') return 'in_progress';
    if (currentStatus === 'in_progress') return 'done';
    return 'todo';
}

// ==========================================
// UX HELPERS: TOASTS, BANNERS, MODALS & E2EE KEY
// ==========================================
const MOOD_COLOR_LABELS = {
    '#FDE047': 'Happy',
    '#4ADE80': 'Calm',
    '#7DD3FC': 'Excited',
    '#D8B4FE': 'Tired',
    '#3B82F6': 'Sad',
    '#EF4444': 'Angry',
    '#F97316': 'Worried',
    '#9CA3AF': 'Scared',
    '#14B8A6': 'Focused',
    '#F59E0B': 'Motivated',
    '#991B1B': 'Stressed',
    '#D946EF': 'Frustrated',
    '#D1D5DB': 'Bored',
    '#A3E635': 'Anxious',
    '#F9A8D4': 'Distracted',
    '#6B21A8': 'Desperate'
};

const MOOD_BLOCK_ORDER = [
    { key: 'Madrugada', label: 'Late Night', range: '00:00 - 05:59' },
    { key: 'Morning', label: 'Morning', range: '06:00 - 11:59' },
    { key: 'Noon', label: 'Noon', range: '12:00 - 13:59' },
    { key: 'Afternoon', label: 'Afternoon', range: '14:00 - 19:59' },
    { key: 'Night', label: 'Night', range: '20:00 - 23:59' }
];

function showToast(type, message, durationMs = 4200) {
    if (!message) return;
    const container = document.getElementById('appToastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `app-toast ${type === 'err' ? 'toast-err' : (type === 'ok' ? 'toast-ok' : '')}`;

    const text = document.createElement('span');
    text.textContent = String(message);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'app-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.textContent = '✕';

    const removeToast = () => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    };
    closeBtn.addEventListener('click', removeToast);

    toast.append(text, closeBtn);
    container.appendChild(toast);

    while (container.children.length > 4) {
        container.removeChild(container.firstElementChild);
    }

    if (durationMs > 0) {
        setTimeout(removeToast, durationMs);
    }
}

function setInlineBanner(bannerId, type, message) {
    const el = document.getElementById(bannerId);
    if (!el) return;
    if (!message) {
        el.hidden = true;
        el.textContent = '';
        el.className = 'inline-status-banner';
        return;
    }
    const cls = type === 'err' ? 'err' : (type === 'info' ? 'info' : 'ok');
    el.className = `inline-status-banner ${cls}`;
    el.textContent = String(message);
    el.hidden = false;
}

let activeConfirmResolver = null;
function closeConfirmDialog(accepted = false) {
    const modal = document.getElementById('confirmActionModal');
    if (modal) modal.hidden = true;
    const resolver = activeConfirmResolver;
    activeConfirmResolver = null;
    if (resolver) resolver(Boolean(accepted));
}

function openConfirmDialog({ title = 'Confirm Action', message = 'Are you sure?', confirmText = 'Confirm', danger = false } = {}) {
    const modal = document.getElementById('confirmActionModal');
    const titleEl = document.getElementById('confirmActionTitle');
    const msgEl = document.getElementById('confirmActionMessage');
    const acceptBtn = document.getElementById('btnConfirmAccept');
    const cancelBtn = document.getElementById('btnConfirmCancel');
    const closeBtn = document.getElementById('btnCloseConfirmModal');

    if (!modal || !acceptBtn || !cancelBtn) {
        return Promise.resolve(false);
    }

    if (activeConfirmResolver) closeConfirmDialog(false);

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    acceptBtn.textContent = confirmText;
    acceptBtn.style.backgroundColor = danger ? '#dc2626' : '';

    return new Promise((resolve) => {
        activeConfirmResolver = resolve;
        modal.hidden = false;

        acceptBtn.onclick = () => closeConfirmDialog(true);
        cancelBtn.onclick = () => closeConfirmDialog(false);
        if (closeBtn) closeBtn.onclick = () => closeConfirmDialog(false);
        modal.onclick = (e) => {
            if (e.target === modal) closeConfirmDialog(false);
        };
        setTimeout(() => cancelBtn.focus(), 20);
    });
}

// ==========================================
// E2EE CLIENT CRYPTO HELPERS (SHARED BY JOURNAL & ENGLISH NOTEBOOK)
// ==========================================
let activeE2eeResolver = null;
function closeE2eeModal(resultKey = null) {
    const modal = document.getElementById('e2eeKeyModal');
    if (modal) modal.hidden = true;
    const resolver = activeE2eeResolver;
    activeE2eeResolver = null;
    if (resolver) resolver(resultKey);
}

function updateE2eeCharCounter() {
    const input = document.getElementById('e2eeKeyInput');
    const countEl = document.getElementById('e2eeKeyCharCount');
    if (!input || !countEl) return;
    const len = input.value.length;
    countEl.textContent = `${len} / 32 characters`;
    countEl.style.color = len === 32 ? '#16a34a' : '';
}

function solicitarLlaveE2EEAsync({ forceEdit = false } = {}) {
    const saved = localStorage.getItem('diario_llave_secreta') || '';
    if (!forceEdit && saved.length === 32) {
        return Promise.resolve(saved);
    }

    const modal = document.getElementById('e2eeKeyModal');
    const form = document.getElementById('e2eeKeyForm');
    const input = document.getElementById('e2eeKeyInput');
    const forgetBtn = document.getElementById('btnForgetE2eeModal');
    const cancelBtn = document.getElementById('btnCancelE2eeModal');
    const closeBtn = document.getElementById('btnCloseE2eeModal');

    if (!modal || !form || !input) {
        return Promise.resolve(null);
    }

    if (activeE2eeResolver) closeE2eeModal(null);

    input.value = saved.length === 32 ? saved : '';
    input.type = 'password';
    updateE2eeCharCounter();
    setInlineBanner('e2eeKeyModalStatus', '', '');
    if (forgetBtn) forgetBtn.hidden = saved.length === 0;

    return new Promise((resolve) => {
        activeE2eeResolver = resolve;
        modal.hidden = false;
        setTimeout(() => input.focus(), 20);

        input.oninput = () => {
            updateE2eeCharCounter();
            setInlineBanner('e2eeKeyModalStatus', '', '');
        };

        form.onsubmit = (e) => {
            e.preventDefault();
            const candidate = input.value;
            if (candidate.length !== 32) {
                setInlineBanner('e2eeKeyModalStatus', 'err', 'Secret key must be exactly 32 characters long.');
                return;
            }
            localStorage.setItem('diario_llave_secreta', candidate);
            updateE2eeKeyStatusUI();
            showToast('ok', 'E2EE secret key saved in this browser.');
            closeE2eeModal(candidate);
        };

        if (forgetBtn) {
            forgetBtn.onclick = () => {
                localStorage.removeItem('diario_llave_secreta');
                input.value = '';
                updateE2eeCharCounter();
                updateE2eeKeyStatusUI();
                showToast('info', 'Local E2EE key removed from this browser.');
                closeE2eeModal(null);
            };
        }

        const handleCancel = () => closeE2eeModal(null);
        if (cancelBtn) cancelBtn.onclick = handleCancel;
        if (closeBtn) closeBtn.onclick = handleCancel;
        modal.onclick = (e) => {
            if (e.target === modal) handleCancel();
        };
    });
}

function obtenerLlaveE2EE() {
    const llaveTexto = localStorage.getItem('diario_llave_secreta') || '';
    return llaveTexto.length === 32 ? llaveTexto : null;
}

function encriptarTextoE2EE(textoPlano, llaveTexto) {
    const keyWords = CryptoJS.enc.Utf8.parse(llaveTexto);
    const iv = CryptoJS.lib.WordArray.random(16);
    const encrypted = CryptoJS.AES.encrypt(textoPlano, keyWords, { iv: iv });
    return iv.toString(CryptoJS.enc.Hex) + ':' + encrypted.toString();
}

// ==========================================
// DEVICE-AWARE YOUTUBE HELPERS (PC YOUTUBE VS MOBILE YT MUSIC)
// ==========================================
const YT_PLATFORM_STORAGE_KEY = 'mt_yt_platform_mode';

function isMobileYouTubeDevice() {
    const ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini|Silk/i.test(ua)) {
        return true;
    }
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
        return true;
    }
    return Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 900);
}

function getYouTubePlatformMode() {
    const localOverride = String(localStorage.getItem(YT_PLATFORM_STORAGE_KEY) || '').trim().toLowerCase();
    if (['auto', 'youtube', 'yt_music'].includes(localOverride)) {
        return localOverride;
    }
    const serverPref = String(currentSettings?.youtubePlatformMode || '').trim().toLowerCase();
    return ['auto', 'youtube', 'yt_music'].includes(serverPref) ? serverPref : 'auto';
}

function getEffectiveYouTubePlatform() {
    const mode = getYouTubePlatformMode();
    if (mode === 'youtube' || mode === 'yt_music') return mode;
    return isMobileYouTubeDevice() ? 'yt_music' : 'youtube';
}

function buildClientStandardYouTubeUrl({ videoId = null, ytMusicUrl = null, youtubeUrl = null } = {}) {
    if (youtubeUrl) return youtubeUrl;
    const cleanId = String(videoId || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(cleanId)) {
        return `https://www.youtube.com/watch?v=${cleanId}`;
    }
    const raw = String(ytMusicUrl || '').trim();
    if (!raw) return null;
    try {
        const parsed = new URL(raw);
        const vParam = parsed.searchParams.get('v');
        if (vParam && /^[A-Za-z0-9_-]{11}$/.test(vParam)) {
            return `https://www.youtube.com/watch?v=${vParam}`;
        }
        const listParam = parsed.searchParams.get('list');
        if (listParam && /^[A-Za-z0-9_-]{10,80}$/.test(listParam)) {
            return `https://www.youtube.com/playlist?list=${encodeURIComponent(listParam)}`;
        }
        return raw;
    } catch (_err) {
        return raw;
    }
}

function buildClientYtMusicUrl({ videoId = null, ytMusicUrl = null } = {}) {
    if (ytMusicUrl) return ytMusicUrl;
    const cleanId = String(videoId || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(cleanId)) {
        return `https://music.youtube.com/watch?v=${cleanId}`;
    }
    return null;
}

function getSongTargetPlaybackInfo(song = {}) {
    const platform = getEffectiveYouTubePlatform();
    const ytMusicUrl = buildClientYtMusicUrl({ videoId: song.yt_video_id || song.videoId, ytMusicUrl: song.yt_music_url || song.ytMusicUrl });
    const youtubeUrl = buildClientStandardYouTubeUrl({
        videoId: song.yt_video_id || song.videoId,
        ytMusicUrl,
        youtubeUrl: song.youtube_url || song.youtubeUrl
    });

    if (platform === 'youtube' && youtubeUrl) {
        return { platform, url: youtubeUrl, shortLabel: 'YouTube', fullLabel: 'Open on YouTube (PC)' };
    }
    if (ytMusicUrl) {
        return { platform: 'yt_music', url: ytMusicUrl, shortLabel: 'YT Music', fullLabel: 'Open in YT Music (Mobile)' };
    }
    return { platform, url: youtubeUrl || '', shortLabel: 'YouTube', fullLabel: 'Open on YouTube' };
}

function getYouTubeSearchUrl(queryText = '') {
    const q = String(queryText || '').trim();
    const platform = getEffectiveYouTubePlatform();
    if (platform === 'youtube') {
        return q ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : 'https://www.youtube.com/';
    }
    return q ? `https://music.youtube.com/search?q=${encodeURIComponent(q)}` : 'https://music.youtube.com/';
}

function getYouTubeHomeUrl() {
    return getEffectiveYouTubePlatform() === 'youtube'
        ? 'https://www.youtube.com/'
        : 'https://music.youtube.com/library';
}

function setYouTubePlatformMode(mode, { persistLocal = true } = {}) {
    const safeMode = ['auto', 'youtube', 'yt_music'].includes(mode) ? mode : 'auto';
    if (persistLocal) {
        localStorage.setItem(YT_PLATFORM_STORAGE_KEY, safeMode);
    }
    const setSelect = document.getElementById('setYoutubePlatformMode');
    if (setSelect) setSelect.value = safeMode;
    updateYouTubePlatformUI();
}

function updateYouTubePlatformUI() {
    const mode = getYouTubePlatformMode();
    const effective = getEffectiveYouTubePlatform();
    const isMobile = isMobileYouTubeDevice();
    const isStandardYt = effective === 'youtube';

    const badge = document.getElementById('ytPlatformDetectedBadge');
    if (badge) {
        const deviceStr = isMobile ? '📱 Mobile' : '🖥️ PC Browser';
        const targetStr = isStandardYt ? 'Standard YouTube (youtube.com)' : 'YouTube Music (music.youtube.com)';
        badge.textContent = `${deviceStr} → ${targetStr}`;
    }

    document.querySelectorAll('#ytPlatformModeGroup [data-yt-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-yt-mode') === mode);
    });

    const heading = document.getElementById('musicFinderHeading');
    if (heading) {
        heading.textContent = isStandardYt ? 'YouTube Song Finder (PC Mode)' : 'YouTube Music Song Finder (Mobile Mode)';
    }

    const libBtn = document.getElementById('btnMusicOpenYtLibrary');
    if (libBtn) {
        libBtn.textContent = isStandardYt ? 'Open YouTube Home' : 'My YT Music Library';
    }

    const searchBtn = document.getElementById('btnMusicSearchYt');
    if (searchBtn) {
        searchBtn.textContent = isStandardYt ? 'Find on YouTube' : 'Find on YT Music';
    }

    const urlInput = document.getElementById('musicSongYtUrl');
    if (urlInput) {
        urlInput.placeholder = isStandardYt
            ? 'https://www.youtube.com/watch?v=... or youtu.be/...'
            : 'https://music.youtube.com/watch?v=...';
    }

    if (typeof actualizarBarraCancionEstudio === 'function') {
        actualizarBarraCancionEstudio();
    }
    if (typeof renderMusicCatalog === 'function' && Array.isArray(musicState?.songs)) {
        renderMusicCatalog();
    }
}

// ==========================================
// MAIN NAVIGATION & FIXED SIDEBAR
// ==========================================
const VALID_VIEWS = new Set(['inicio', 'mood', 'crisis', 'sueno', 'journal', 'english', 'agenda', 'horario', 'resumen', 'medico', 'settings']);
let currentUser = null;
let sundayWatcherInterval = null;
let reminderPollInterval = null;
let currentSettings = null;
const lastDesktopNotifiedKeys = new Set();
const authOverlay = document.getElementById('authOverlay');
const appShell = document.getElementById('appShell');
const sidebar = document.getElementById('sidebar');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const mobileSidebarClose = document.getElementById('mobileSidebarClose');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const desktopSidebarToggle = document.getElementById('desktopSidebarToggle');
const desktopToggleIcon = document.getElementById('desktopToggleIcon');
const mobileViewTitle = document.getElementById('mobileViewTitle');

function setMobileMenuOpen(isOpen) {
    if (!appShell) return;
    appShell.classList.toggle('mobile-menu-open', isOpen);
    if (mobileMenuBtn) {
        mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
    }
}

function updateDesktopSidebarState(collapsed) {
    if (!appShell) return;
    appShell.classList.toggle('sidebar-collapsed', collapsed);
    if (desktopToggleIcon) {
        desktopToggleIcon.textContent = collapsed ? '▶' : '◀';
    }
    localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0');
}

function formatHoursMinutes(decimalHours, { compact = false } = {}) {
    const val = parseFloat(decimalHours);
    const totalMinutes = Number.isFinite(val) && val > 0 ? Math.round(val * 60) : 0;
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (compact) {
        return `${hrs}h ${String(mins).padStart(2, '0')}m`;
    }
    const hrLabel = hrs === 1 ? 'hr' : 'hrs';
    return `${hrs} ${hrLabel} ${mins} min`;
}

function formatClockTime12h(hhmm) {
    if (!hhmm || !/^\d{2}:\d{2}/.test(String(hhmm))) return '--';
    const [hStr, mStr] = String(hhmm).slice(0, 5).split(':');
    const h = Number(hStr);
    const m = Number(mStr);
    if (!Number.isInteger(h) || !Number.isInteger(m)) return String(hhmm);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function isLateBedtimeClock(hhmm) {
    if (!hhmm || !/^\d{2}:\d{2}/.test(String(hhmm))) return false;
    const [hStr, mStr] = String(hhmm).slice(0, 5).split(':');
    const totalMin = Number(hStr) * 60 + Number(mStr);
    return Number.isFinite(totalMin) && totalMin >= 60 && totalMin < 360;
}

function parseIsoDateToDayIndex(rawFecha) {
    if (!rawFecha) return -1;
    const iso = String(rawFecha).slice(0, 10);
    const parts = iso.split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
        const fallback = new Date(rawFecha);
        return Number.isNaN(fallback.getTime()) ? -1 : fallback.getUTCDay();
    }
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
    return Number.isNaN(d.getTime()) ? -1 : d.getUTCDay();
}

function showView(viewName, updateHash = true, options = {}) {
    let targetView = VALID_VIEWS.has(viewName) ? viewName : 'inicio';

    // Read-only psychiatrist accounts can only view Weekly Summary
    if (currentUser && currentUser.rol === 'psiquiatra') {
        targetView = 'resumen';
    }

    actualizarCabecerasDeFecha();

    document.querySelectorAll('.app-view').forEach(section => {
        const isTarget = section.id === `view-${targetView}`;
        section.classList.toggle('active', isTarget);
        if (isTarget && mobileViewTitle) {
            mobileViewTitle.textContent = section.getAttribute('data-title') || 'Daily Hub';
        }
    });

    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-view') === targetView);
    });

    if (updateHash && window.location.hash !== `#${targetView}`) {
        history.replaceState(null, '', `#${targetView}`);
    }

    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });

    if (targetView === 'inicio') {
        cargarInicioResumen();
    } else if (targetView === 'mood') {
        const fechaInput = document.getElementById('fecha');
        const momentoSelect = document.getElementById('momento');
        if (!options.preserveTarget) {
            if (fechaInput) fechaInput.value = formatLocalDate(new Date());
            if (momentoSelect) momentoSelect.value = getMomentoInfo(new Date().getHours()).moodKey;
        }
        if (typeof cargarMoodsHoy === 'function') cargarMoodsHoy();
    } else if (targetView === 'crisis') {
        if (!options.preserveTarget && typeof prefillCrisisCurrentTimestamp === 'function') {
            prefillCrisisCurrentTimestamp();
        }
        if (typeof cargarCrisisRecientes === 'function') cargarCrisisRecientes();
    } else if (targetView === 'sueno') {
        if (!options.preserveTarget && typeof initSleepViewDefaults === 'function') {
            initSleepViewDefaults();
        }
        if (typeof cargarSuenoHoy === 'function') cargarSuenoHoy();
    } else if (targetView === 'journal') {
        updateE2eeKeyStatusUI();
    } else if (targetView === 'english') {
        updateE2eeKeyStatusUI();
        updateYouTubePlatformUI();
        if (typeof musicCatalogLoadRequested !== 'undefined' && !musicCatalogLoadRequested && typeof cargarCatalogoMusical === 'function') {
            musicCatalogLoadRequested = true;
            cargarCatalogoMusical();
        }
    } else if (targetView === 'resumen') {
        const selectSemana = document.getElementById('semanaSeleccionada');
        if (selectSemana) selectSemana.dispatchEvent(new Event('change'));
    } else if (targetView === 'agenda') {
        cargarAgendaSemana();
    } else if (targetView === 'horario') {
        if (typeof cargarPlannerVista === 'function') cargarPlannerVista();
    } else if (targetView === 'medico') {
        cargarMedicos();
    } else if (targetView === 'settings') {
        cargarSettingsVista();
    }
    if (currentUser && currentUser.rol === 'admin') {
        cargarRecordatoriosActivos();
    }
}

function openReminderTarget(reminder = {}) {
    if (!reminder || typeof reminder !== 'object') return;
    const targetView = VALID_VIEWS.has(reminder.targetView) ? reminder.targetView : 'inicio';
    const targetDate = reminder.targetDate || formatLocalDate(new Date());
    const targetMoment = reminder.targetMoment || '';

    if (targetView === 'mood') {
        const fechaInput = document.getElementById('fecha');
        const momentoSelect = document.getElementById('momento');
        if (fechaInput) fechaInput.value = targetDate;
        if (momentoSelect) {
            const desiredMoment = targetMoment || getMomentoInfo(new Date().getHours()).moodKey;
            momentoSelect.value = desiredMoment;
        }
        showView('mood', true, { preserveTarget: true });
        const momentLabel = targetMoment === 'Madrugada' ? 'Late Night' : (targetMoment || 'current block');
        const pendingExtra = Array.isArray(reminder.pendingMoments) && reminder.pendingMoments.length > 1
            ? ` (Pending blocks: ${reminder.pendingMoments.map(m => m === 'Madrugada' ? 'Late Night' : m).join(' → ')})`
            : '';
        setInlineBanner(
            'moodStatusBanner',
            'info',
            `Selected ${targetDate} · ${momentLabel}${pendingExtra}. Pick your mood below and click Save!`
        );
        const firstMoodBtn = document.querySelector('#moodForm .mood-btn');
        if (firstMoodBtn) firstMoodBtn.focus({ preventScroll: true });
        return;
    }

    if (targetView === 'sueno') {
        const sleepDateEl = document.getElementById('sleepDate');
        if (sleepDateEl && targetDate) sleepDateEl.value = targetDate;
        showView('sueno', true, { preserveTarget: true });
        setInlineBanner(
            'sleepStatusBanner',
            'info',
            `Selected ${targetDate} sleep check-in — enter bedtime (auto-detects late desvelo like 3:00 AM), wake-up time, and rest quality.`
        );
        const sleepInput = document.getElementById('sleepTime');
        const wakeInput = document.getElementById('wakeupTime');
        if (sleepInput && sleepInput.value && wakeInput) {
            setTimeout(() => wakeInput.focus(), 60);
        } else if (sleepInput) {
            setTimeout(() => sleepInput.focus(), 60);
        }
        return;
    }

    if (targetView === 'agenda') {
        if (reminder.targetDate && /^\d{4}-\d{2}-\d{2}$/.test(reminder.targetDate)) {
            if (typeof agendaSelectedDayStr !== 'undefined') {
                agendaSelectedDayStr = reminder.targetDate;
            }
            if (typeof agendaCurrentMonday !== 'undefined' && typeof getMonday === 'function') {
                agendaCurrentMonday = getMonday(new Date(`${reminder.targetDate}T12:00:00`));
            }
            const fEl = document.getElementById('agendaFecha');
            if (fEl) fEl.value = reminder.targetDate;
        }
        if (reminder.targetTime) {
            const hEl = document.getElementById('agendaHora');
            if (hEl) hEl.value = reminder.targetTime;
        }
        if (reminder.targetBlock) {
            const bEl = document.getElementById('agendaBloque');
            if (bEl) bEl.value = reminder.targetBlock;
        }
        showView('agenda', true, { preserveTarget: true });
        if (reminder.refId) {
            setTimeout(() => {
                const cardEl = document.querySelector(`[data-agenda-id="${reminder.refId}"]`);
                if (cardEl && typeof cardEl.scrollIntoView === 'function') {
                    cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 250);
        }
        return;
    }

    if (targetView === 'horario') {
        showView('horario', true, { preserveTarget: true });
        const tabKey = reminder.targetTab || (reminder.type === 'residencias' ? 'residencias' : (reminder.type === 'work' ? 'work' : 'semesters'));
        setTimeout(() => {
            const tabBtn = document.querySelector(`.planner-tab-btn[data-planner-tab="${tabKey}"]`);
            if (tabBtn) tabBtn.click();
        }, 120);
        return;
    }

    showView(targetView, true);
}

if (appShell) {
    // Saved desktop sidebar state
    if (localStorage.getItem('sidebar_collapsed') === '1') {
        updateDesktopSidebarState(true);
    }

    if (desktopSidebarToggle) {
        desktopSidebarToggle.addEventListener('click', () => {
            const isCollapsed = appShell.classList.contains('sidebar-collapsed');
            updateDesktopSidebarState(!isCollapsed);
        });
    }

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            const isOpen = appShell.classList.contains('mobile-menu-open');
            setMobileMenuOpen(!isOpen);
        });
    }

    if (mobileSidebarClose) {
        mobileSidebarClose.addEventListener('click', () => setMobileMenuOpen(false));
    }

    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener('click', () => setMobileMenuOpen(false));
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            setMobileMenuOpen(false);
            cerrarAgendaModal();
            closeE2eeModal(null);
            closeConfirmDialog(false);
        }
    });

    // Collapsible nav groups inside sidebar
    document.querySelectorAll('.nav-group-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const group = toggle.closest('.nav-group');
            if (!group) return;
            const willOpen = !group.classList.contains('open');
            group.classList.toggle('open', willOpen);
            toggle.setAttribute('aria-expanded', String(willOpen));
        });
    });

    // Sidebar menu items
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            showView(btn.getAttribute('data-view'));
        });
    });

    // In-view shortcut buttons
    document.querySelectorAll('[data-go-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            showView(btn.getAttribute('data-go-view'));
        });
    });

    // URL hash navigation support
    window.addEventListener('hashchange', () => {
        if (!currentUser) return;
        const hashView = window.location.hash.replace('#', '');
        if (VALID_VIEWS.has(hashView)) {
            showView(hashView, false);
        }
    });
}

// ==========================================
// HOME DASHBOARD LOGIC
// ==========================================
function actualizarCabecerasDeFecha() {
    const now = new Date();
    const info = getMomentoInfo(now.getHours());
    const fechaLarga = now.toLocaleDateString('en-US', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
    const fechaCorta = now.toLocaleDateString('en-US', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
    });

    const homeGreeting = document.getElementById('homeGreeting');
    const homeDate = document.getElementById('homeDate');
    const homeMomentBadge = document.getElementById('homeMomentBadge');
    const sidebarMomentoActual = document.getElementById('sidebarMomentoActual');
    const sidebarFechaHoy = document.getElementById('sidebarFechaHoy');
    const mobileMomentBadge = document.getElementById('mobileMomentBadge');

    if (homeGreeting) homeGreeting.textContent = info.saludo;
    if (homeDate) homeDate.textContent = fechaLarga;
    if (homeMomentBadge) homeMomentBadge.textContent = `Current moment: ${info.moodLabel}`;
    if (sidebarMomentoActual) sidebarMomentoActual.textContent = `Moment: ${info.moodLabel}`;
    if (sidebarFechaHoy) sidebarFechaHoy.textContent = fechaCorta;
    if (mobileMomentBadge) mobileMomentBadge.textContent = info.moodLabel;
}

function cargarInicioResumen() {
    actualizarCabecerasDeFecha();
    const hoyStr = formatLocalDate(new Date());

    const moodBox = document.getElementById('homeMoodSummary');
    const sleepBox = document.getElementById('homeSleepSummary');
    const agendaBox = document.getElementById('homeAgendaSummary');
    if (!moodBox || !sleepBox || !agendaBox) return;

    moodBox.replaceChildren(createLoadingBanner('Loading...', 'sm'));
    sleepBox.replaceChildren(createLoadingBanner('Loading...', 'sm'));
    agendaBox.replaceChildren(createLoadingBanner('Loading...', 'sm'));

    const reqToken = homeSummaryTracker.begin();
    const fetchOpts = reqToken.signal ? { signal: reqToken.signal } : {};

    // 1. Today's mood
    fetch(`/api/get-moods?begin=${hoyStr}&end=${hoyStr}`, fetchOpts)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to fetch mood logs')))
        .then(registros => {
            if (!homeSummaryTracker.isCurrent(reqToken.seq)) return;
            moodBox.innerHTML = '';
            if (!registros.length) {
                const p = document.createElement('p');
                p.className = 'muted-text';
                p.textContent = 'No mood entries logged yet today.';
                moodBox.appendChild(p);
                return;
            }
            const wrap = document.createElement('div');
            wrap.className = 'home-mood-pills';
            registros.forEach(r => {
                const chip = document.createElement('span');
                chip.className = 'home-mood-chip';
                const dot = document.createElement('span');
                dot.className = 'mini-dot';
                dot.style.backgroundColor = r.color_hex;
                const txt = document.createElement('span');
                txt.textContent = MOMENTOS_LABELS[r.momento_dia] || r.momento_dia;
                chip.append(dot, txt);
                wrap.appendChild(chip);
            });
            moodBox.appendChild(wrap);
        })
        .catch(err => {
            if (isAbortError(err) || !homeSummaryTracker.isCurrent(reqToken.seq)) return;
            moodBox.innerHTML = '<p class="muted-text">Could not load today\'s mood entries.</p>';
        });

    // 2. Today's sleep
    fetch(`/api/get-sleep?begin=${hoyStr}&end=${hoyStr}`, fetchOpts)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to fetch sleep logs')))
        .then(registros => {
            if (!homeSummaryTracker.isCurrent(reqToken.seq)) return;
            sleepBox.innerHTML = '';
            if (!registros.length) {
                const p = document.createElement('p');
                p.className = 'muted-text';
                p.textContent = 'No sleep log recorded today.';
                sleepBox.appendChild(p);
                return;
            }
            const totalH = registros.reduce((acc, r) => acc + (parseFloat(r.horas) || 0), 0);
            const desveloRows = registros.filter(r => Number(r.es_desvelo) === 1 || (r.tipo_registro && r.tipo_registro !== 'normal'));
            const hasAllNighter = desveloRows.some(r => r.tipo_registro === 'desvelo_total');
            const p = document.createElement('p');
            p.style.margin = '0';
            const plural = registros.length === 1 ? 'session' : 'sessions';
            const strong = document.createElement('strong');
            strong.textContent = formatHoursMinutes(totalH);
            p.append(strong, document.createTextNode(` logged across ${registros.length} ${plural}.`));
            sleepBox.appendChild(p);
            if (desveloRows.length > 0) {
                const tag = document.createElement('div');
                tag.className = `sleep-desvelo-tag${hasAllNighter ? ' is-total' : ''}`;
                const bedList = desveloRows.map(r => r.hora_dormir ? formatClockTime12h(r.hora_dormir) : '').filter(Boolean);
                tag.textContent = hasAllNighter
                    ? '⚡ Desvelo total / All-nighter logged'
                    : `🦉 Desvelo (${bedList.length ? `bed ${bedList.join(', ')}` : `${desveloRows.length}`})`;
                sleepBox.appendChild(tag);
            }
        })
        .catch(err => {
            if (isAbortError(err) || !homeSummaryTracker.isCurrent(reqToken.seq)) return;
            sleepBox.innerHTML = '<p class="muted-text">Could not load sleep summary.</p>';
        });

    // 3. Today's agenda
    fetch(`/api/get-agenda?begin=${hoyStr}&end=${hoyStr}`, fetchOpts)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to fetch agenda')))
        .then(items => {
            if (!homeSummaryTracker.isCurrent(reqToken.seq)) return;
            agendaBox.innerHTML = '';
            if (!items.length) {
                const p = document.createElement('p');
                p.className = 'muted-text';
                p.textContent = 'No activities scheduled for today.';
                agendaBox.appendChild(p);
                return;
            }
            const doneItems = items.filter(i => getAgendaItemStatus(i) === 'done').length;
            const inProgItems = items.filter(i => getAgendaItemStatus(i) === 'in_progress').length;
            const uniCount = items.filter(i => (i.categoria || 'personal') === 'universidad').length;
            const perCount = items.length - uniCount;

            const summary = document.createElement('p');
            summary.style.margin = '0';
            summary.textContent = `${doneItems} of ${items.length} done (${uniCount} University · ${perCount} Personal${inProgItems ? ` · ${inProgItems} In Progress` : ''}).`;
            agendaBox.appendChild(summary);

            const ul = document.createElement('ul');
            ul.className = 'home-agenda-list';
            items.slice(0, 4).forEach(item => {
                const li = document.createElement('li');
                if (getAgendaItemStatus(item) === 'done') li.className = 'done';
                const timeSpan = document.createElement('strong');
                timeSpan.textContent = item.hora;
                const catTag = document.createElement('span');
                const isUni = (item.categoria || 'personal') === 'universidad';
                catTag.className = `agenda-cat-pill ${isUni ? 'is-uni' : 'is-personal'}`;
                catTag.textContent = isUni ? 'Uni' : 'Personal';
                const textSpan = document.createElement('span');
                textSpan.textContent = item.actividad;
                li.append(timeSpan, catTag, textSpan);
                ul.appendChild(li);
            });
            agendaBox.appendChild(ul);
        })
        .catch(err => {
            if (isAbortError(err) || !homeSummaryTracker.isCurrent(reqToken.seq)) return;
            agendaBox.innerHTML = '<p class="muted-text">Agenda unavailable or missing table in DB.</p>';
        });
}

// ==========================================
// MOOD TRACKER FORM LOGIC
// ==========================================
const formRegistro = document.getElementById('moodForm');

function renderMoodChecklist(rows = []) {
    const checklist = document.getElementById('moodTodayChecklist');
    const dateLabel = document.getElementById('moodTodayDateLabel');
    const targetDate = document.getElementById('fecha')?.value || formatLocalDate(new Date());
    const momentoSelect = document.getElementById('momento');
    if (dateLabel) dateLabel.textContent = targetDate;
    if (!checklist) return;

    const byMomento = new Map();
    (Array.isArray(rows) ? rows : []).forEach(r => {
        if (r && r.momento_dia) byMomento.set(r.momento_dia, r);
    });

    checklist.replaceChildren(...MOOD_BLOCK_ORDER.map(block => {
        const entry = byMomento.get(block.key);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'today-check-item';
        if (momentoSelect && momentoSelect.value === block.key) {
            btn.classList.add('is-active');
        }

        const left = document.createElement('div');
        left.className = 'today-check-left';
        const title = document.createElement('strong');
        title.textContent = block.label;
        const sub = document.createElement('span');
        sub.textContent = block.range;
        left.append(title, sub);

        const status = document.createElement('div');
        status.className = 'today-check-status';
        if (entry && entry.color_hex) {
            const hex = String(entry.color_hex).toUpperCase();
            const label = MOOD_COLOR_LABELS[hex] || 'Logged';
            const dot = document.createElement('span');
            dot.className = 'color-dot';
            dot.style.backgroundColor = entry.color_hex;
            dot.style.width = '14px';
            dot.style.height = '14px';
            const txt = document.createElement('span');
            txt.textContent = label;
            status.append(dot, txt);
        } else {
            const emptyTxt = document.createElement('span');
            emptyTxt.className = 'muted-text';
            emptyTxt.textContent = 'Not logged';
            status.appendChild(emptyTxt);
        }

        btn.append(left, status);
        btn.addEventListener('click', () => {
            if (momentoSelect) momentoSelect.value = block.key;
            checklist.querySelectorAll('.today-check-item').forEach(el => el.classList.remove('is-active'));
            btn.classList.add('is-active');
        });
        return btn;
    }));
}

function cargarMoodsHoy({ autoAdvancePending = false } = {}) {
    if (!currentUser || currentUser.rol !== 'admin') return;
    const targetDate = document.getElementById('fecha')?.value || formatLocalDate(new Date());
    fetch(`/api/get-moods?begin=${encodeURIComponent(targetDate)}&end=${encodeURIComponent(targetDate)}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : []))
        .then(rows => {
            if (autoAdvancePending) {
                const loggedSet = new Set((Array.isArray(rows) ? rows : []).map(r => r.momento_dia));
                const momentoSelect = document.getElementById('momento');
                if (momentoSelect) {
                    const orderedKeys = ['Morning', 'Noon', 'Afternoon', 'Night'];
                    const nextPending = orderedKeys.find(k => !loggedSet.has(k));
                    momentoSelect.value = nextPending || getMomentoInfo(new Date().getHours()).moodKey;
                }
            }
            renderMoodChecklist(rows);
        })
        .catch(() => renderMoodChecklist([]));
}

if (formRegistro) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    document.getElementById('fecha').value = `${year}-${month}-${day}`;

    let estadoSeleccionado = '';
    let colorSeleccionado = '';

    const updateMoodPreview = () => {
        const preview = document.getElementById('moodSelectionPreview');
        if (!preview) return;
        if (!estadoSeleccionado || !colorSeleccionado) {
            preview.classList.remove('has-mood');
            preview.textContent = 'No mood selected yet';
            return;
        }
        preview.classList.add('has-mood');
        const dot = document.createElement('span');
        dot.className = 'color-dot';
        dot.style.backgroundColor = colorSeleccionado;
        dot.style.width = '12px';
        dot.style.height = '12px';
        preview.replaceChildren(dot, document.createTextNode(estadoSeleccionado));
    };

    const botones = document.querySelectorAll('.mood-btn');
    botones.forEach(btn => {
        btn.addEventListener('click', () => {
            botones.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            estadoSeleccionado = btn.getAttribute('data-mood');
            colorSeleccionado = btn.getAttribute('data-color');
            updateMoodPreview();
            setInlineBanner('moodStatusBanner', '', '');
        });
    });

    const fechaEl = document.getElementById('fecha');
    const momentoDia = document.getElementById('momento');
    const hora = new Date().getHours();

    // Preserves DB enum 'Madrugada' for 00:00-05:59
    const obtenerMomentoDia = (horaActual) => {
        if (horaActual >= 0 && horaActual < 6) {
            momentoDia.value = 'Madrugada';
        } else if (horaActual >= 6 && horaActual < 12) {
            momentoDia.value = 'Morning';
        } else if (horaActual >= 12 && horaActual < 14) {
            momentoDia.value = 'Noon';
        } else if (horaActual >= 14 && horaActual < 20) {
            momentoDia.value = 'Afternoon';
        } else {
            momentoDia.value = 'Night';
        }
    };

    obtenerMomentoDia(hora);
    if (fechaEl) fechaEl.addEventListener('change', () => cargarMoodsHoy());
    if (momentoDia) {
        momentoDia.addEventListener('change', () => {
            cargarMoodsHoy();
        });
    }

    let lastSavedMoodSignature = '';

    formRegistro.addEventListener('submit', (e) => {
        e.preventDefault();

        const btnGuardarMood = document.getElementById('btn-save-mood');
        if (!btnGuardarMood || busyActionElements.has(btnGuardarMood) || btnGuardarMood.disabled) return;

        if (!estadoSeleccionado) {
            setInlineBanner('moodStatusBanner', 'err', 'Please select a mood tile before saving.');
            return;
        }

        const datos = {
            fecha: document.getElementById('fecha').value,
            momento_dia: document.getElementById('momento').value,
            estado_animo: estadoSeleccionado,
            color_hex: colorSeleccionado
        };

        if (!datos.fecha || !datos.momento_dia) {
            setInlineBanner('moodStatusBanner', 'err', 'Please select both date and time of day.');
            return;
        }

        const moodSignature = `${datos.fecha}|${datos.momento_dia}|${datos.estado_animo}`;
        if (moodSignature === lastSavedMoodSignature) {
            setInlineBanner('moodStatusBanner', 'info', 'This exact mood is already saved for this date and time block.');
            return;
        }

        setInlineBanner('moodStatusBanner', '', '');

        runWithButtonLock(btnGuardarMood, async () => {
            try {
                const mensaje = await submitMutationRequest({
                    url: '/api/insert-mood',
                    method: 'POST',
                    scopeKey: 'mood',
                    signature: moodSignature,
                    buildBody: () => datos
                });
                lastSavedMoodSignature = moodSignature;
                const cleanMsg = String(mensaje || 'Mood saved!').replace(/\n/g, ' · ');
                setInlineBanner('moodStatusBanner', 'ok', cleanMsg);
                showToast('ok', cleanMsg);
                botones.forEach(b => b.classList.remove('selected'));
                estadoSeleccionado = '';
                colorSeleccionado = '';
                updateMoodPreview();
                cargarMoodsHoy({ autoAdvancePending: true });
                cargarRecordatoriosActivos();
            } catch (error) {
                setInlineBanner('moodStatusBanner', 'err', 'Error: ' + error.message);
                showToast('err', error.message);
            }
        }, { loadingText: 'Saving...' });
    });
}

// ==========================================
// WEEKLY SUMMARY LOGIC (MOOD & SLEEP TABLE)
// ==========================================
const selectSemana = document.getElementById('semanaSeleccionada');

if (selectSemana) {
    // 1. Populate Sunday-to-Saturday weeks
    const now = new Date();
    const domingoActual = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());

    for (let i = -5; i <= 5; i++) {
        const dom = new Date(domingoActual);
        dom.setDate(dom.getDate() + (i * 7));
        const sab = new Date(dom);
        sab.setDate(sab.getDate() + 6);

        const domStr = `${dom.getFullYear()}-${String(dom.getMonth() + 1).padStart(2, '0')}-${String(dom.getDate()).padStart(2, '0')}`;
        const sabStr = `${sab.getFullYear()}-${String(sab.getMonth() + 1).padStart(2, '0')}-${String(sab.getDate()).padStart(2, '0')}`;

        const opcMes = { day: 'numeric', month: 'short' };
        const textoVisual = `${dom.toLocaleDateString('en-US', opcMes)} - ${sab.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`;

        const option = document.createElement('option');
        option.value = `${domStr}|${sabStr}`;
        option.textContent = `Week: ${textoVisual}`;

        if (i === 0) option.selected = true;

        selectSemana.appendChild(option);
    }

    // 2. Fetch week data when changed
    selectSemana.addEventListener('change', () => {
        const [begin, end] = selectSemana.value.split('|');
        const reqToken = resumenTracker.begin();
        const fetchOpts = reqToken.signal ? { signal: reqToken.signal } : {};

        const resumenBanner = document.getElementById('resumenLoadingBanner');
        if (resumenBanner) {
            resumenBanner.replaceChildren(createLoadingBanner('Loading weekly data...', 'sm'));
            resumenBanner.hidden = false;
        }
        let pendingRequests = 3;
        const markOneSettled = () => {
            if (!resumenTracker.isCurrent(reqToken.seq)) return;
            pendingRequests -= 1;
            if (pendingRequests <= 0 && resumenBanner) {
                resumenBanner.hidden = true;
                resumenBanner.innerHTML = '';
            }
        };

        document.querySelectorAll('.mood-cell').forEach(celda => celda.innerHTML = '');
        const diasSemana = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        fetch(`/api/get-moods?begin=${begin}&end=${end}`, fetchOpts)
            .then(response => response.ok ? response.json() : Promise.reject(new Error('Failed to load moods')))
            .then(registros => {
                if (!resumenTracker.isCurrent(reqToken.seq)) return;
                document.querySelectorAll('.mood-cell').forEach(celda => celda.innerHTML = '');
                registros.forEach(registro => {
                    const fechaObj = new Date(registro.fecha);
                    const nombreDia = diasSemana[fechaObj.getUTCDay()];
                    const celda = document.querySelector(`.mood-cell[data-day="${nombreDia}"][data-time="${registro.momento_dia}"]`);

                    if (celda) {
                        const hex = String(registro.color_hex || '').toUpperCase();
                        const moodName = MOOD_COLOR_LABELS[hex] || 'Logged Mood';
                        const dot = document.createElement('span');
                        dot.className = 'color-dot';
                        dot.style.backgroundColor = registro.color_hex;
                        dot.title = `${nombreDia} (${registro.momento_dia === 'Madrugada' ? 'Late Night' : registro.momento_dia}): ${moodName}`;
                        dot.setAttribute('aria-label', dot.title);
                        celda.replaceChildren(dot);
                    }
                });
            })
            .catch(error => {
                if (!isAbortError(error)) console.error('Error loading moods:', error);
            })
            .finally(markOneSettled);

        const sleepGrid = document.getElementById('sleepGrid');
        const sleepDetailsList = document.getElementById('resumenSleepDetailsList');
        const sleepResumenCount = document.getElementById('resumenSleepCount');
        sleepGrid.replaceChildren(createLoadingBanner('Loading sleep logs...', 'sm'));
        if (sleepDetailsList) {
            sleepDetailsList.replaceChildren(createLoadingBanner('Loading sleep & desvelo details...', 'sm'));
        }

        const diasNombres = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const sumatoriaSueno = {
            Sunday: { horas: 0, calidades: [], sesiones: [], desvelos: 0, totalAllNighters: 0, lateBedtimes: [], pendingCount: 0 },
            Monday: { horas: 0, calidades: [], sesiones: [], desvelos: 0, totalAllNighters: 0, lateBedtimes: [], pendingCount: 0 },
            Tuesday: { horas: 0, calidades: [], sesiones: [], desvelos: 0, totalAllNighters: 0, lateBedtimes: [], pendingCount: 0 },
            Wednesday: { horas: 0, calidades: [], sesiones: [], desvelos: 0, totalAllNighters: 0, lateBedtimes: [], pendingCount: 0 },
            Thursday: { horas: 0, calidades: [], sesiones: [], desvelos: 0, totalAllNighters: 0, lateBedtimes: [], pendingCount: 0 },
            Friday: { horas: 0, calidades: [], sesiones: [], desvelos: 0, totalAllNighters: 0, lateBedtimes: [], pendingCount: 0 },
            Saturday: { horas: 0, calidades: [], sesiones: [], desvelos: 0, totalAllNighters: 0, lateBedtimes: [], pendingCount: 0 }
        };

        fetch(`/api/get-sleep?begin=${begin}&end=${end}`, fetchOpts)
            .then(response => response.ok ? response.json() : Promise.reject(new Error('Failed to load sleep logs')))
            .then(registros => {
                if (!resumenTracker.isCurrent(reqToken.seq)) return;
                sleepGrid.innerHTML = '';
                const list = Array.isArray(registros) ? registros : [];

                list.forEach(registro => {
                    const dayIdx = parseIsoDateToDayIndex(registro.fecha);
                    if (dayIdx < 0 || dayIdx > 6) return;
                    const nombreDia = diasSemana[dayIdx];

                    const horasRegistro = parseFloat(registro.horas) || 0;
                    const isDesvelo = Number(registro.es_desvelo) === 1 || (registro.tipo_registro && registro.tipo_registro !== 'normal');
                    const isTotal = registro.tipo_registro === 'desvelo_total';
                    const isPending = registro.tipo_registro === 'desvelo_tarde' && registro.hora_dormir && !registro.hora_despertar && horasRegistro === 0;

                    sumatoriaSueno[nombreDia].horas += horasRegistro;
                    sumatoriaSueno[nombreDia].calidades.push(registro.calidad);
                    sumatoriaSueno[nombreDia].sesiones.push(horasRegistro);
                    if (isDesvelo) sumatoriaSueno[nombreDia].desvelos += 1;
                    if (isTotal) sumatoriaSueno[nombreDia].totalAllNighters += 1;
                    if (isPending) sumatoriaSueno[nombreDia].pendingCount += 1;
                    if (isDesvelo && registro.hora_dormir) {
                        sumatoriaSueno[nombreDia].lateBedtimes.push(formatClockTime12h(registro.hora_dormir));
                    }
                });

                diasSemana.forEach((dia, index) => {
                    const datosDia = sumatoriaSueno[dia];
                    const cantidadSesiones = datosDia.sesiones.length;
                    let emoji = '➖';
                    let colorBorde = '';
                    let textoHoras = '--';
                    let intervalText = '';
                    let desveloTagText = '';
                    let desveloTagIsTotal = false;

                    if (cantidadSesiones > 0) {
                        const totalH = datosDia.horas;
                        const intermitente = cantidadSesiones > 1;
                        textoHoras = datosDia.pendingCount > 0 && totalH === 0
                            ? 'Pending'
                            : formatHoursMinutes(totalH, { compact: true });

                        if (intermitente) {
                            const listaIntervalos = datosDia.sesiones.map(sesionH =>
                                formatHoursMinutes(sesionH, { compact: true })
                            );
                            intervalText = `(${listaIntervalos.join(' + ')})`;
                        }

                        if (datosDia.totalAllNighters > 0) {
                            emoji = '⚡';
                            colorBorde = '#EF4444';
                            desveloTagText = '⚡ Desvelo total';
                            desveloTagIsTotal = true;
                        } else if (datosDia.desvelos > 0) {
                            emoji = totalH < 4 ? '🔴' : '🦉';
                            colorBorde = totalH < 4 ? '#EF4444' : '#8B5CF6';
                            desveloTagText = datosDia.lateBedtimes.length
                                ? `🦉 ${datosDia.lateBedtimes[0]}`
                                : `🦉 ${datosDia.desvelos} desvelo${datosDia.desvelos > 1 ? 's' : ''}`;
                        } else if (totalH < 4 || (totalH < 6 && intermitente)) {
                            emoji = '🔴';
                            colorBorde = '#EF4444';
                        } else if (totalH >= 7 && !intermitente) {
                            emoji = '🟢';
                            colorBorde = '#4ADE80';
                        } else {
                            emoji = '🟡';
                            colorBorde = '#FDE047';
                        }
                    }

                    const card = document.createElement('div');
                    card.className = `sleep-card${datosDia.desvelos > 0 ? ' has-desvelo' : ''}`;
                    if (colorBorde) card.style.borderColor = colorBorde;

                    const dayEl = document.createElement('div');
                    dayEl.className = 'day-name';
                    dayEl.textContent = diasNombres[index];

                    const hrsEl = document.createElement('div');
                    hrsEl.className = 'sleep-hours';
                    hrsEl.style.lineHeight = '1.1';
                    hrsEl.append(document.createTextNode(textoHoras));
                    if (intervalText) {
                        const intEl = document.createElement('div');
                        intEl.className = 'sleep-intervals';
                        intEl.textContent = intervalText;
                        hrsEl.appendChild(intEl);
                    }

                    card.append(dayEl, hrsEl);

                    if (desveloTagText) {
                        const tagEl = document.createElement('div');
                        tagEl.className = `sleep-desvelo-tag${desveloTagIsTotal ? ' is-total' : ''}`;
                        tagEl.textContent = desveloTagText;
                        card.appendChild(tagEl);
                    }

                    const qualEl = document.createElement('div');
                    qualEl.className = 'sleep-quality';
                    qualEl.style.marginTop = '8px';
                    qualEl.textContent = emoji;
                    card.appendChild(qualEl);

                    sleepGrid.appendChild(card);
                });

                if (sleepResumenCount) {
                    const totalDesvelos = list.filter(r => Number(r.es_desvelo) === 1 || (r.tipo_registro && r.tipo_registro !== 'normal')).length;
                    sleepResumenCount.textContent = list.length === 0
                        ? 'No sleep records this week'
                        : `${list.length} session${list.length === 1 ? '' : 's'}${totalDesvelos > 0 ? ` · 🦉 ${totalDesvelos} desvelo${totalDesvelos === 1 ? '' : 's'}` : ''}`;
                }
                if (typeof renderSleepDetailCards === 'function') {
                    renderSleepDetailCards(sleepDetailsList, list);
                }
            })
            .catch(error => {
                if (!isAbortError(error) && resumenTracker.isCurrent(reqToken.seq)) {
                    console.error('Error loading sleep logs:', error);
                    sleepGrid.innerHTML = '<p class="muted-text">Could not load sleep logs.</p>';
                    if (sleepDetailsList) {
                        sleepDetailsList.innerHTML = '<p class="muted-text">Could not load sleep &amp; desvelo details.</p>';
                    }
                }
            })
            .finally(markOneSettled);

        const crisisResumenList = document.getElementById('resumenCrisisList');
        const crisisResumenCount = document.getElementById('resumenCrisisCount');
        if (crisisResumenList) {
            crisisResumenList.replaceChildren(createLoadingBanner('Loading crisis logs...', 'sm'));
        }
        fetch(`/api/get-crisis?begin=${begin}&end=${end}`, fetchOpts)
            .then(response => response.ok ? response.json() : Promise.reject(new Error('Failed to load crisis logs')))
            .then(registros => {
                if (!resumenTracker.isCurrent(reqToken.seq)) return;
                if (crisisResumenCount) {
                    const len = Array.isArray(registros) ? registros.length : 0;
                    crisisResumenCount.textContent = len === 0 ? 'No crises recorded this week' : `${len} episode${len === 1 ? '' : 's'}`;
                }
                renderCrisisCards(crisisResumenList, registros, { allowDelete: false });
            })
            .catch(error => {
                if (!isAbortError(error) && resumenTracker.isCurrent(reqToken.seq) && crisisResumenList) {
                    console.error('Error loading crisis logs:', error);
                    crisisResumenList.innerHTML = '<p class="muted-text">Could not load crisis logs for this week.</p>';
                }
            })
            .finally(markOneSettled);
    });
}

// ==========================================
// SLEEP & DESVELO TRACKER FORM LOGIC
// ==========================================
const SLEEP_BEDTIME_DRAFT_KEY = 'mt_sleep_bedtime_draft';
let editingSleepSessionId = null;

function formatSleepQualityBadge(calidad) {
    if (calidad === 'Good') return '🟢 Good / Restorative';
    if (calidad === 'Bad') return '🔴 Poor / Heavy';
    return '🟡 Fair / Light';
}

function formatSleepIntervalText(row = {}) {
    const tipo = row.tipo_registro || 'normal';
    const hrsText = formatHoursMinutes(row.horas);
    if (tipo === 'desvelo_total') {
        const atTime = row.hora_dormir ? ` · Awake at ${formatClockTime12h(row.hora_dormir)}` : '';
        return `All-Nighter / No Sleep (${hrsText})${atTime}`;
    }
    if (row.hora_dormir && row.hora_despertar) {
        return `Bed: ${formatClockTime12h(row.hora_dormir)} → Wake: ${formatClockTime12h(row.hora_despertar)} (${hrsText})`;
    }
    if (row.hora_dormir && !row.hora_despertar) {
        return `Bedtime: ${formatClockTime12h(row.hora_dormir)} (wake-up pending)`;
    }
    return `Duration: ${hrsText}`;
}

function renderSleepDetailCards(container, rows = []) {
    if (!container) return;
    const list = Array.isArray(rows) ? [...rows] : [];
    if (!list.length) {
        const p = document.createElement('p');
        p.className = 'muted-text';
        p.textContent = 'No sleep or desvelo sessions recorded during this week.';
        container.replaceChildren(p);
        return;
    }

    list.sort((a, b) => {
        const da = String(a.fecha || '').slice(0, 10);
        const db = String(b.fecha || '').slice(0, 10);
        if (da !== db) return db.localeCompare(da);
        return Number(b.id || 0) - Number(a.id || 0);
    });

    const fragment = document.createDocumentFragment();
    list.forEach(item => {
        const tipo = item.tipo_registro || 'normal';
        const isTotal = tipo === 'desvelo_total';
        const isDesvelo = Number(item.es_desvelo) === 1 || tipo !== 'normal';

        const card = document.createElement('div');
        card.className = `sleep-detail-card${isTotal ? ' is-total' : (isDesvelo ? ' is-desvelo' : '')}`;

        const head = document.createElement('div');
        head.className = 'sleep-detail-head';

        const titleStrong = document.createElement('strong');
        titleStrong.textContent = `📅 ${formatCrisisDateLabel(item.fecha)} · 🕒 ${formatSleepIntervalText(item)}`;

        const badges = document.createElement('div');
        badges.className = 'sleep-detail-badges';

        const typeBadge = document.createElement('span');
        typeBadge.className = `sleep-desvelo-badge${isTotal ? ' is-total' : (isDesvelo ? '' : ' is-normal')}`;
        if (isTotal) {
            typeBadge.textContent = '⚡ Desvelo Total (Sin dormir)';
        } else if (isDesvelo) {
            typeBadge.textContent = item.hora_dormir
                ? `🦉 Desvelo · Dormido ${formatClockTime12h(item.hora_dormir)}`
                : '🦉 Desvelo / Late Bedtime';
        } else {
            typeBadge.textContent = '🌙 Regular Sleep';
        }

        const qBadge = document.createElement('span');
        qBadge.className = 'home-mood-chip';
        qBadge.textContent = formatSleepQualityBadge(item.calidad);

        badges.append(typeBadge, qBadge);
        head.append(titleStrong, badges);
        card.appendChild(head);

        if (item.motivo_desvelo) {
            const noteP = document.createElement('p');
            noteP.className = 'sleep-detail-note';
            noteP.textContent = `📝 ${item.motivo_desvelo}`;
            card.appendChild(noteP);
        }

        fragment.appendChild(card);
    });

    container.replaceChildren(fragment);
}

function renderSleepTodaySummary(rows = [], targetDate = '') {
    const box = document.getElementById('sleepTodaySummary');
    if (!box) return;
    const list = Array.isArray(rows) ? rows : [];
    const todayStr = formatLocalDate(new Date());
    const headingLabel = !targetDate || targetDate === todayStr
        ? "Today's accumulated sleep"
        : `Sleep on ${formatCrisisDateLabel(targetDate)}`;

    if (!list.length) {
        const p = document.createElement('p');
        p.className = 'muted-text';
        p.textContent = !targetDate || targetDate === todayStr
            ? 'No sleep or desvelo logged for today yet. Record your session on the left.'
            : `No sleep or desvelo recorded for ${targetDate}.`;
        box.replaceChildren(p);
        return;
    }

    let totalHours = 0;
    let desveloCount = 0;
    list.forEach(r => {
        totalHours += parseFloat(r.horas) || 0;
        if (Number(r.es_desvelo) === 1 || (r.tipo_registro && r.tipo_registro !== 'normal')) {
            desveloCount += 1;
        }
    });

    const metric = document.createElement('div');
    metric.className = 'sleep-today-metric';
    const left = document.createElement('span');
    left.textContent = `${headingLabel} (${list.length} ${list.length === 1 ? 'session' : 'sessions'}${desveloCount ? ` · 🦉 ${desveloCount} desvelo${desveloCount > 1 ? 's' : ''}` : ''})`;
    const strong = document.createElement('strong');
    strong.textContent = formatHoursMinutes(totalHours);
    metric.append(left, strong);

    const cardsWrap = document.createElement('div');
    cardsWrap.style.display = 'flex';
    cardsWrap.style.flexDirection = 'column';
    cardsWrap.style.gap = '8px';

    list.forEach((r, idx) => {
        const tipo = r.tipo_registro || 'normal';
        const isTotal = tipo === 'desvelo_total';
        const isDesvelo = Number(r.es_desvelo) === 1 || tipo !== 'normal';
        const isPendingWake = tipo === 'desvelo_tarde' && r.hora_dormir && !r.hora_despertar && (parseFloat(r.horas) || 0) === 0;

        const card = document.createElement('div');
        card.className = `sleep-today-card${isTotal ? ' is-total' : (isDesvelo ? ' is-desvelo' : '')}`;

        const head = document.createElement('div');
        head.className = 'sleep-today-card-head';

        const title = document.createElement('strong');
        title.style.fontSize = '0.88rem';
        const prefix = isTotal ? '⚡' : (isDesvelo ? '🦉' : '🌙');
        title.textContent = `${prefix} #${idx + 1}: ${formatSleepIntervalText(r)}`;

        const qBadge = document.createElement('span');
        qBadge.className = 'home-mood-chip';
        qBadge.textContent = formatSleepQualityBadge(r.calidad);

        head.append(title, qBadge);
        card.appendChild(head);

        if (r.motivo_desvelo) {
            const note = document.createElement('div');
            note.className = 'muted-text';
            note.style.fontSize = '0.82rem';
            note.textContent = `📝 ${r.motivo_desvelo}`;
            card.appendChild(note);
        }

        if (r.id) {
            const actions = document.createElement('div');
            actions.className = 'sleep-today-actions';
            if (isPendingWake && typeof enterSleepWakeupCompletion === 'function') {
                const completeBtn = document.createElement('button');
                completeBtn.type = 'button';
                completeBtn.className = 'agenda-chip-btn';
                completeBtn.textContent = '⏰ Complete Wake-Up Now';
                completeBtn.addEventListener('click', () => enterSleepWakeupCompletion(r));
                actions.appendChild(completeBtn);
            }
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn-secondary btn-small';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async () => {
                const ok = await openConfirmDialog({
                    title: 'Delete Sleep Log?',
                    message: 'Remove this sleep / desvelo session from your records?',
                    confirmText: 'Delete',
                    danger: true
                });
                if (!ok) return;
                runWithButtonLock(delBtn, async () => {
                    const res = await fetch(`/api/delete-sleep/${r.id}`, { method: 'DELETE' });
                    if (res.ok) {
                        showToast('ok', 'Sleep log removed.');
                        cargarSuenoHoy();
                    } else {
                        showToast('err', 'Could not delete sleep log.');
                    }
                }, { loadingText: '...' });
            });
            actions.appendChild(delBtn);
            card.appendChild(actions);
        }

        cardsWrap.appendChild(card);
    });

    box.replaceChildren(metric, cardsWrap);
}

function cargarSuenoHoy(explicitDate = '') {
    if (!currentUser || currentUser.rol !== 'admin') return;
    const sleepDateInput = document.getElementById('sleepDate');
    const targetDate = explicitDate || (sleepDateInput && sleepDateInput.value) || formatLocalDate(new Date());
    fetch(`/api/get-sleep?begin=${encodeURIComponent(targetDate)}&end=${encodeURIComponent(targetDate)}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : []))
        .then(rows => renderSleepTodaySummary(rows, targetDate))
        .catch(() => renderSleepTodaySummary([], targetDate));
}

let initSleepViewDefaults = () => {};
let enterSleepWakeupCompletion = () => {};

const formSleep = document.getElementById('sleepForm');
if (formSleep) {
    const tipoInput = document.getElementById('sleepTipoRegistro');
    const modePills = document.querySelectorAll('#sleepModePills [data-sleep-mode]');
    const dateInput = document.getElementById('sleepDate');
    const sleepTimeInput = document.getElementById('sleepTime');
    const wakeupTimeInput = document.getElementById('wakeupTime');
    const wakeupGroup = document.getElementById('sleepWakeupGroup');
    const sleepTimeLabel = document.getElementById('sleepTimeLabel');
    const esDesveloCheck = document.getElementById('sleepEsDesvelo');
    const esDesveloRow = document.getElementById('sleepEsDesveloRow');
    const stillAwakeCheck = document.getElementById('sleepStillAwake');
    const stillAwakeRow = document.getElementById('sleepStillAwakeRow');
    const autoBanner = document.getElementById('sleepDesveloAutoBanner');
    const detectedText = document.getElementById('sleepDetectedBedtimeText');
    const motivoGroup = document.getElementById('sleepMotivoGroup');
    const motivoInput = document.getElementById('sleepMotivoDesvelo');
    const durationLabel = document.getElementById('sleepDurationLabel');
    const badgeEl = document.getElementById('sleepDurationBadge');
    const inputSleep = document.getElementById('sleepHours');
    const qualitySelect = document.getElementById('quality-sleep');
    const qualityCards = document.querySelectorAll('#sleepQualityCards .sleep-quality-card');
    const submitBtn = document.getElementById('btn-save-sleep');

    let userManuallyToggledDesvelo = false;
    let lastSavedSleepSignature = '';

    function saveSleepBedtimeDraft() {
        if (editingSleepSessionId) return;
        const horaDormir = sleepTimeInput?.value || '';
        const motivo = motivoInput?.value || '';
        if (!horaDormir && !motivo) {
            localStorage.removeItem(SLEEP_BEDTIME_DRAFT_KEY);
            return;
        }
        try {
            localStorage.setItem(SLEEP_BEDTIME_DRAFT_KEY, JSON.stringify({
                fecha: dateInput?.value || formatLocalDate(new Date()),
                horaDormir,
                tipoRegistro: tipoInput?.value || 'normal',
                esDesvelo: Boolean(esDesveloCheck?.checked),
                motivoDesvelo: motivo,
                savedAt: Date.now()
            }));
        } catch {
            // ignore storage errors
        }
    }

    function clearSleepBedtimeDraft() {
        try {
            localStorage.removeItem(SLEEP_BEDTIME_DRAFT_KEY);
        } catch {
            // ignore
        }
    }

    function syncQualityCards(val) {
        qualityCards.forEach(card => {
            card.classList.toggle('active', card.getAttribute('data-quality') === val);
        });
    }

    function syncSleepModeUI({ preserveManualDesvelo = false } = {}) {
        const mode = tipoInput?.value || 'normal';
        modePills.forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-sleep-mode') === mode);
        });

        const isAllNighter = mode === 'desvelo_total';
        const isLateMode = mode === 'desvelo_tarde';
        const sleepClock = sleepTimeInput?.value || '';
        const lateDetected = isLateBedtimeClock(sleepClock);

        if (isAllNighter) {
            if (sleepTimeLabel) sleepTimeLabel.textContent = 'Stayed awake / Desvelo time (optional):';
            if (sleepTimeInput) sleepTimeInput.required = false;
            if (wakeupGroup) wakeupGroup.hidden = true;
            if (wakeupTimeInput) wakeupTimeInput.required = false;
            if (stillAwakeRow) stillAwakeRow.hidden = true;
            if (stillAwakeCheck) stillAwakeCheck.checked = false;
            if (esDesveloRow) esDesveloRow.hidden = true;
            if (esDesveloCheck) esDesveloCheck.checked = true;
            if (autoBanner) autoBanner.hidden = true;
            if (motivoGroup) motivoGroup.hidden = false;
            if (qualitySelect && !qualitySelect.value) {
                qualitySelect.value = 'Bad';
                syncQualityCards('Bad');
            }
            if (submitBtn && !editingSleepSessionId) submitBtn.textContent = 'Log All-Nighter (0 hrs Desvelo)';
        } else {
            if (sleepTimeLabel) sleepTimeLabel.textContent = 'Fell asleep at:';
            if (sleepTimeInput) sleepTimeInput.required = true;
            if (esDesveloRow) esDesveloRow.hidden = false;
            if (stillAwakeRow) stillAwakeRow.hidden = !(isLateMode || lateDetected);
            if (!isLateMode && !lateDetected && stillAwakeCheck) {
                stillAwakeCheck.checked = false;
            }
            const stillAwake = Boolean(stillAwakeCheck?.checked);
            if (wakeupGroup) wakeupGroup.hidden = stillAwake;
            if (wakeupTimeInput) {
                wakeupTimeInput.required = !stillAwake;
                wakeupTimeInput.disabled = stillAwake;
            }
            if (isLateMode) {
                if (esDesveloCheck) esDesveloCheck.checked = true;
            } else if (!preserveManualDesvelo) {
                if (esDesveloCheck && lateDetected && !userManuallyToggledDesvelo) {
                    esDesveloCheck.checked = true;
                } else if (esDesveloCheck && !lateDetected && !userManuallyToggledDesvelo) {
                    esDesveloCheck.checked = false;
                }
            }
            if (autoBanner) {
                autoBanner.hidden = !lateDetected;
                if (lateDetected && detectedText) {
                    detectedText.textContent = formatClockTime12h(sleepClock);
                }
            }
            const showMotivo = isLateMode || lateDetected || Boolean(esDesveloCheck?.checked) || Boolean(motivoInput?.value.trim());
            if (motivoGroup) motivoGroup.hidden = !showMotivo;
            if (submitBtn && !editingSleepSessionId) {
                if (stillAwake) {
                    submitBtn.textContent = 'Save Late Bedtime Now';
                } else if (esDesveloCheck?.checked) {
                    submitBtn.textContent = 'Log Sleep & Desvelo';
                } else {
                    submitBtn.textContent = 'Log Sleep Session';
                }
            }
        }

        if (editingSleepSessionId && submitBtn) {
            submitBtn.textContent = 'Complete Sleep Wake-Up';
        }
        calcularHoras();
    }

    function calcularHoras() {
        const mode = tipoInput?.value || 'normal';
        const sleepTime = sleepTimeInput?.value || '';
        const wakeupTime = wakeupTimeInput?.value || '';
        const stillAwake = Boolean(stillAwakeCheck?.checked);

        if (mode === 'desvelo_total') {
            if (durationLabel) durationLabel.textContent = 'All-nighter / No sleep logged';
            if (inputSleep) {
                inputSleep.value = '0 hrs 0 min';
                inputSleep.dataset.decimal = '0';
            }
            if (badgeEl) badgeEl.textContent = '0 hrs 0 min (Desvelo Total)';
            return;
        }

        if (stillAwake && sleepTime) {
            if (durationLabel) durationLabel.textContent = 'Pending wake-up (Bedtime saved)';
            if (inputSleep) {
                inputSleep.value = 'Pending';
                inputSleep.dataset.decimal = '0';
            }
            if (badgeEl) badgeEl.textContent = `Bedtime ${formatClockTime12h(sleepTime)} (Pending)`;
            return;
        }

        if (durationLabel) durationLabel.textContent = 'Calculated sleep duration';
        if (sleepTime && wakeupTime) {
            const sleepDate = new Date(`2000-01-01T${sleepTime}`);
            const wakeupDate = new Date(`2000-01-01T${wakeupTime}`);

            if (wakeupDate < sleepDate) {
                wakeupDate.setDate(wakeupDate.getDate() + 1);
            }

            const diferenciaMilisegundos = wakeupDate - sleepDate;
            const totalMinutes = Math.floor(diferenciaMilisegundos / (1000 * 60));

            const intHours = Math.floor(totalMinutes / 60);
            const intMinutes = totalMinutes % 60;

            const visualText = `${intHours} ${intHours === 1 ? 'hr' : 'hrs'} ${intMinutes} min`;

            inputSleep.value = visualText;
            inputSleep.dataset.decimal = (totalMinutes / 60).toFixed(2);
            if (badgeEl) badgeEl.textContent = visualText;
        } else {
            if (inputSleep) {
                inputSleep.value = '';
                delete inputSleep.dataset.decimal;
            }
            if (badgeEl) badgeEl.textContent = '-- hrs -- min';
        }
    }

    initSleepViewDefaults = function initSleepViewDefaultsImpl() {
        editingSleepSessionId = null;
        if (dateInput && !dateInput.value) {
            dateInput.value = formatLocalDate(new Date());
        }
        try {
            const rawDraft = localStorage.getItem(SLEEP_BEDTIME_DRAFT_KEY);
            if (rawDraft) {
                const draft = JSON.parse(rawDraft);
                const maxAgeMs = 36 * 60 * 60 * 1000;
                if (draft && (!draft.savedAt || Date.now() - draft.savedAt < maxAgeMs)) {
                    if (sleepTimeInput && draft.horaDormir && !sleepTimeInput.value) {
                        sleepTimeInput.value = draft.horaDormir;
                    }
                    if (tipoInput && draft.tipoRegistro && SLEEP_TIPOS_LIST_SET_OK(draft.tipoRegistro)) {
                        tipoInput.value = draft.tipoRegistro;
                    }
                    if (esDesveloCheck && typeof draft.esDesvelo === 'boolean') {
                        esDesveloCheck.checked = draft.esDesvelo;
                    }
                    if (motivoInput && draft.motivoDesvelo && !motivoInput.value) {
                        motivoInput.value = draft.motivoDesvelo;
                    }
                }
            }
        } catch {
            // ignore
        }
        syncSleepModeUI({ preserveManualDesvelo: true });
    };

    function SLEEP_TIPOS_LIST_SET_OK(val) {
        return val === 'normal' || val === 'desvelo_tarde' || val === 'desvelo_total';
    }

    enterSleepWakeupCompletion = function enterSleepWakeupCompletionImpl(row) {
        if (!row || !row.id) return;
        editingSleepSessionId = Number(row.id);
        const now = new Date();
        const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (dateInput && row.fecha) dateInput.value = String(row.fecha).slice(0, 10);
        if (tipoInput) tipoInput.value = row.tipo_registro || 'desvelo_tarde';
        if (sleepTimeInput && row.hora_dormir) sleepTimeInput.value = String(row.hora_dormir).slice(0, 5);
        if (stillAwakeCheck) stillAwakeCheck.checked = false;
        if (wakeupTimeInput) wakeupTimeInput.value = nowHHMM;
        if (esDesveloCheck) esDesveloCheck.checked = true;
        if (motivoInput) motivoInput.value = row.motivo_desvelo || '';
        if (qualitySelect && row.calidad) {
            qualitySelect.value = row.calidad;
            syncQualityCards(row.calidad);
        }
        syncSleepModeUI({ preserveManualDesvelo: true });
        setInlineBanner(
            'sleepStatusBanner',
            'info',
            `Completing wake-up for bedtime ${formatClockTime12h(row.hora_dormir)} — adjust wake-up time or quality if needed and click "Complete Sleep Wake-Up".`
        );
        formSleep.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    modePills.forEach(pill => {
        pill.addEventListener('click', () => {
            editingSleepSessionId = null;
            userManuallyToggledDesvelo = false;
            if (tipoInput) tipoInput.value = pill.getAttribute('data-sleep-mode') || 'normal';
            setInlineBanner('sleepStatusBanner', '', '');
            syncSleepModeUI();
            saveSleepBedtimeDraft();
        });
    });

    if (dateInput) {
        dateInput.value = formatLocalDate(new Date());
        dateInput.addEventListener('change', () => {
            cargarSuenoHoy(dateInput.value);
            saveSleepBedtimeDraft();
        });
    }

    const btnToday = document.getElementById('btnSleepDateToday');
    if (btnToday && dateInput) {
        btnToday.addEventListener('click', () => {
            dateInput.value = formatLocalDate(new Date());
            cargarSuenoHoy(dateInput.value);
            saveSleepBedtimeDraft();
        });
    }

    const btnYesterday = document.getElementById('btnSleepDateYesterday');
    if (btnYesterday && dateInput) {
        btnYesterday.addEventListener('click', () => {
            const y = new Date();
            y.setDate(y.getDate() - 1);
            dateInput.value = formatLocalDate(y);
            cargarSuenoHoy(dateInput.value);
            saveSleepBedtimeDraft();
        });
    }

    if (esDesveloCheck) {
        esDesveloCheck.addEventListener('change', () => {
            userManuallyToggledDesvelo = true;
            syncSleepModeUI({ preserveManualDesvelo: true });
            saveSleepBedtimeDraft();
        });
    }

    if (stillAwakeCheck) {
        stillAwakeCheck.addEventListener('change', () => {
            editingSleepSessionId = null;
            syncSleepModeUI({ preserveManualDesvelo: true });
        });
    }

    qualityCards.forEach(card => {
        card.addEventListener('click', () => {
            const q = card.getAttribute('data-quality') || '';
            if (qualitySelect) qualitySelect.value = q;
            syncQualityCards(q);
            setInlineBanner('sleepStatusBanner', '', '');
        });
    });

    if (qualitySelect) {
        qualitySelect.addEventListener('change', () => {
            syncQualityCards(qualitySelect.value);
            setInlineBanner('sleepStatusBanner', '', '');
        });
    }

    if (sleepTimeInput) {
        sleepTimeInput.addEventListener('change', () => {
            userManuallyToggledDesvelo = false;
            syncSleepModeUI();
            saveSleepBedtimeDraft();
        });
    }

    if (wakeupTimeInput) {
        wakeupTimeInput.addEventListener('change', () => calcularHoras());
    }

    if (motivoInput) {
        motivoInput.addEventListener('input', () => saveSleepBedtimeDraft());
    }

    const btnBedNow = document.getElementById('btnSleepBedtimeNow');
    if (btnBedNow && sleepTimeInput) {
        btnBedNow.addEventListener('click', () => {
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            sleepTimeInput.value = `${hh}:${mm}`;
            userManuallyToggledDesvelo = false;
            if (tipoInput && isLateBedtimeClock(sleepTimeInput.value) && tipoInput.value === 'normal') {
                tipoInput.value = 'desvelo_tarde';
            }
            syncSleepModeUI();
            saveSleepBedtimeDraft();
        });
    }

    const btnUseNow = document.getElementById('btnSleepUseNow');
    if (btnUseNow) {
        btnUseNow.addEventListener('click', () => {
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            if (wakeupTimeInput) wakeupTimeInput.value = `${hh}:${mm}`;
            if (stillAwakeCheck) stillAwakeCheck.checked = false;
            syncSleepModeUI({ preserveManualDesvelo: true });
        });
    }

    formSleep.addEventListener('submit', (e) => {
        e.preventDefault();
        const btnGuardarSleep = document.getElementById('btn-save-sleep');
        if (!btnGuardarSleep || busyActionElements.has(btnGuardarSleep) || btnGuardarSleep.disabled) return;

        const fecha = (dateInput?.value || formatLocalDate(new Date())).trim();
        const tipoRegistro = tipoInput?.value || 'normal';
        const sleepTime = (sleepTimeInput?.value || '').trim();
        const stillAwake = Boolean(stillAwakeCheck?.checked);
        const wakeupTime = stillAwake || tipoRegistro === 'desvelo_total' ? '' : (wakeupTimeInput?.value || '').trim();
        const quality = qualitySelect ? qualitySelect.value : '';
        const esDesvelo = Boolean(esDesveloCheck?.checked) || tipoRegistro !== 'normal' || isLateBedtimeClock(sleepTime);
        const motivoDesvelo = (motivoInput?.value || '').trim();

        if (!fecha) {
            setInlineBanner('sleepStatusBanner', 'err', 'Please select the date for this sleep or desvelo entry.');
            return;
        }
        if (tipoRegistro !== 'desvelo_total') {
            if (!sleepTime || (!stillAwake && !wakeupTime) || !quality) {
                setInlineBanner('sleepStatusBanner', 'err', 'Please fill in bedtime, wake-up time (or check "Going to sleep just now"), and rest quality.');
                return;
            }
        } else if (!quality) {
            setInlineBanner('sleepStatusBanner', 'err', 'Please select how you feel (quality) for this all-nighter log.');
            return;
        }

        const horas = tipoRegistro === 'desvelo_total' || stillAwake
            ? 0
            : parseFloat(document.getElementById('sleepHours').dataset.decimal);

        if (tipoRegistro !== 'desvelo_total' && !stillAwake && (!Number.isFinite(horas) || horas <= 0)) {
            setInlineBanner('sleepStatusBanner', 'err', 'Bedtime and wake-up time cannot result in 0 hours of sleep.');
            return;
        }

        const datos = {
            fecha,
            horas,
            calidad: quality,
            horaDormir: sleepTime,
            horaDespertar: wakeupTime,
            esDesvelo,
            tipoRegistro: tipoRegistro === 'normal' && esDesvelo ? 'desvelo_tarde' : tipoRegistro,
            motivoDesvelo
        };

        const sleepSignature = `${editingSleepSessionId || 'new'}|${fecha}|${sleepTime}|${wakeupTime}|${horas}|${quality}|${datos.tipoRegistro}|${esDesvelo ? 1 : 0}|${motivoDesvelo}`;
        if (!editingSleepSessionId && sleepSignature === lastSavedSleepSignature) {
            setInlineBanner('sleepStatusBanner', 'info', 'This exact sleep session was already logged.');
            return;
        }

        setInlineBanner('sleepStatusBanner', '', '');

        runWithButtonLock(btnGuardarSleep, async () => {
            try {
                let mensaje = '';
                if (editingSleepSessionId) {
                    const res = await fetch(`/api/update-sleep/${editingSleepSessionId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(datos)
                    });
                    if (!res.ok) throw new Error(await res.text() || 'Error updating sleep record.');
                    const json = await res.json();
                    mensaje = json.message || 'Sleep session completed!';
                    editingSleepSessionId = null;
                } else {
                    mensaje = await submitMutationRequest({
                        url: '/api/insert-sleep',
                        method: 'POST',
                        scopeKey: 'sleep',
                        signature: sleepSignature,
                        buildBody: () => datos
                    });
                    lastSavedSleepSignature = sleepSignature;
                }

                clearSleepBedtimeDraft();
                setInlineBanner('sleepStatusBanner', 'ok', mensaje);
                showToast('ok', mensaje);
                if (sleepTimeInput) sleepTimeInput.value = '';
                if (wakeupTimeInput) wakeupTimeInput.value = '';
                if (motivoInput) motivoInput.value = '';
                if (stillAwakeCheck) stillAwakeCheck.checked = false;
                if (esDesveloCheck) esDesveloCheck.checked = false;
                userManuallyToggledDesvelo = false;
                if (tipoInput) tipoInput.value = 'normal';
                if (inputSleep) {
                    inputSleep.value = '';
                    delete inputSleep.dataset.decimal;
                }
                if (badgeEl) badgeEl.textContent = '-- hrs -- min';
                if (qualitySelect) qualitySelect.value = '';
                syncQualityCards('');
                syncSleepModeUI();
                cargarSuenoHoy(fecha);
                cargarRecordatoriosActivos();
            } catch (error) {
                setInlineBanner('sleepStatusBanner', 'err', 'Error: ' + error.message);
                showToast('err', error.message);
            }
        }, { loadingText: 'Saving...' });
    });

    initSleepViewDefaults();
}

// ==========================================
// JOURNAL NOTES (ENCRYPTED NOTES TO PC WORD)
// ==========================================
const JOURNAL_DRAFT_KEY = 'mt_journal_draft';
const journalForm = document.getElementById('journalForm');

if (journalForm) {
    let lastSentJournalText = '';
    const textInput = document.getElementById('journalText');
    const wordCountEl = document.getElementById('journalWordCount');
    const draftStatusEl = document.getElementById('journalDraftStatus');
    const clearDraftBtn = document.getElementById('btnJournalClearDraft');
    const journalE2eeBtn = document.getElementById('journalE2eePill');
    const titleInput = document.getElementById('journalTitle');

    if (journalE2eeBtn) {
        journalE2eeBtn.addEventListener('click', () => {
            solicitarLlaveE2EEAsync({ forceEdit: true });
        });
    }

    document.querySelectorAll('#journalLabelChips [data-journal-tag]').forEach(chip => {
        chip.addEventListener('click', () => {
            if (!titleInput) return;
            titleInput.value = chip.getAttribute('data-journal-tag') || '';
            titleInput.focus();
            titleInput.dispatchEvent(new Event('input'));
        });
    });

    const refreshJournalEditorMeta = (saveDraft = false) => {
        if (!textInput) return;
        const val = textInput.value || '';
        const words = val.trim() ? val.trim().split(/\s+/).length : 0;
        if (wordCountEl) {
            wordCountEl.textContent = `${words} ${words === 1 ? 'word' : 'words'} · ${val.length} chars`;
        }
        if (clearDraftBtn) {
            clearDraftBtn.hidden = val.trim().length === 0 && !(titleInput && titleInput.value.trim().length > 0);
        }
        if (saveDraft) {
            if (val.trim()) {
                localStorage.setItem(JOURNAL_DRAFT_KEY, val);
                if (draftStatusEl) draftStatusEl.textContent = 'Draft saved locally';
            } else {
                localStorage.removeItem(JOURNAL_DRAFT_KEY);
                if (draftStatusEl) draftStatusEl.textContent = '';
            }
        }
    };

    if (textInput) {
        const savedDraft = localStorage.getItem(JOURNAL_DRAFT_KEY) || '';
        if (savedDraft && !textInput.value) {
            textInput.value = savedDraft;
            if (draftStatusEl) draftStatusEl.textContent = 'Restored unsent draft';
        }
        refreshJournalEditorMeta(false);
        textInput.addEventListener('input', () => {
            setInlineBanner('journalStatusBanner', '', '');
            refreshJournalEditorMeta(true);
        });
    }

    if (clearDraftBtn) {
        clearDraftBtn.addEventListener('click', async () => {
            const ok = await openConfirmDialog({
                title: 'Clear Draft?',
                message: 'Erase your unsent text in the Journal box?',
                confirmText: 'Clear Draft',
                danger: true
            });
            if (!ok) return;
            if (textInput) textInput.value = '';
            if (titleInput) titleInput.value = '';
            refreshJournalEditorMeta(true);
        });
    }

    journalForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const btnEnviarWord = document.getElementById('btn-send-word');
        if (!btnEnviarWord || busyActionElements.has(btnEnviarWord) || btnEnviarWord.disabled) return;

        const titleClean = titleInput ? titleInput.value.trim() : '';
        const texto = textInput.value;
        const textoLimpio = texto.trim();
        if (!textoLimpio) {
            setInlineBanner('journalStatusBanner', 'err', 'Please write a short entry before sending.');
            return;
        }

        const composedJournalText = titleClean ? `[${titleClean}] — ${textoLimpio}` : texto;
        const composedClean = composedJournalText.trim();

        if (composedClean === lastSentJournalText) {
            setInlineBanner('journalStatusBanner', 'info', 'This exact note was already queued in this session. Edit the text before sending again.');
            return;
        }

        const llaveTexto = await solicitarLlaveE2EEAsync();
        if (!llaveTexto) return;

        setInlineBanner('journalStatusBanner', '', '');

        runWithButtonLock(btnEnviarWord, async () => {
            try {
                await submitMutationRequest({
                    url: '/api/send-to-pc',
                    method: 'POST',
                    scopeKey: 'journal',
                    signature: composedClean,
                    buildBody: () => ({ texto: encriptarTextoE2EE(composedJournalText, llaveTexto) })
                });
                lastSentJournalText = composedClean;
                textInput.value = '';
                if (titleInput) titleInput.value = '';
                refreshJournalEditorMeta(true);
                const msg = 'Note encrypted & queued! Your PC sync will add it to Word on the next scan.';
                setInlineBanner('journalStatusBanner', 'ok', msg);
                showToast('ok', msg);
            } catch (error) {
                setInlineBanner('journalStatusBanner', 'err', 'Failed to send note: ' + error.message);
                showToast('err', error.message);
            }
        }, { loadingText: 'Sending...' });
    });
}

// ==========================================
// ENGLISH LEARNING NOTEBOOK (WORD DOCX IN english-notes/)
// ==========================================
const englishForm = document.getElementById('englishForm');

if (englishForm) {
    const englishCard = document.querySelector('#view-english .english-card');
    const englishRecentBox = document.getElementById('englishRecentBox');
    const englishMusicStudio = document.getElementById('englishMusicStudio');
    const categoryInput = document.getElementById('englishCategoryInput');
    const studyLanguageInput = document.getElementById('studyLanguageInput');
    const studyLangPills = document.querySelectorAll('.study-lang-pill[data-study-lang]');
    const studyLangHint = document.getElementById('studyLanguageHint');
    const engWordInput = document.getElementById('engWord');
    const engWordLabel = document.getElementById('engWordLabel');
    const engRomanizationInput = document.getElementById('engRomanization');
    const tabButtons = document.querySelectorAll('.english-tab-btn[data-english-cat]');
    const statusBanner = document.getElementById('englishStatusBanner');
    const recentList = document.getElementById('englishRecentList');

    const STUDY_LANGUAGE_UI = {
        en: {
            label: '🇺🇸 English',
            hint: 'Focus on vocabulary, idioms, phrasal verbs, and Word spelling/grammar proofing.',
            wordLabel: 'Word / Expression (English) *',
            wordPlaceholder: 'e.g. Resilience / Serendipity'
        },
        ko: {
            label: '🇰🇷 Korean (한국어)',
            hint: 'Auto Hangul -> Revised Romanization, particles (은/는·이/가·을/를), and polite endings.',
            wordLabel: 'Korean Word / Phrase (한국어 Hangul) *',
            wordPlaceholder: 'e.g. 마음 / 사랑해 / 보고 싶어'
        },
        en_ko: {
            label: '🎵 K-Pop (EN + 한국어)',
            hint: 'Dual-script mode: English hooks + Korean Hangul with instant Romanization & AI meaning bridge.',
            wordLabel: 'Word / Lyric Phrase (EN or 한국어) *',
            wordPlaceholder: 'e.g. 마음 (maeum) / Golden Hour'
        }
    };

    function applyStudyLanguageUi(langCode, { syncMusicSelect = true } = {}) {
        const norm = ['en', 'ko', 'en_ko'].includes(langCode) ? langCode : 'en_ko';
        if (studyLanguageInput) studyLanguageInput.value = norm;
        studyLangPills.forEach(btn => {
            const active = btn.getAttribute('data-study-lang') === norm;
            btn.classList.toggle('active', active);
        });
        const meta = STUDY_LANGUAGE_UI[norm];
        if (studyLangHint) studyLangHint.textContent = meta.hint;
        if (engWordLabel) engWordLabel.textContent = meta.wordLabel;
        if (engWordInput) engWordInput.placeholder = meta.wordPlaceholder;

        if (syncMusicSelect) {
            const musicLangSelect = document.getElementById('musicSongLanguage');
            if (musicLangSelect && !document.getElementById('musicSongEditId')?.value) {
                musicLangSelect.value = norm === 'ko'
                    ? 'Korean'
                    : (norm === 'en' ? 'English' : 'English + Korean (K-Pop)');
            }
        }
    }

    studyLangPills.forEach(btn => {
        btn.addEventListener('click', () => {
            applyStudyLanguageUi(btn.getAttribute('data-study-lang'));
        });
    });

    if (engWordInput && engRomanizationInput) {
        let romTimer = null;
        engWordInput.addEventListener('input', () => {
            const val = engWordInput.value.trim();
            if (!/[\uAC00-\uD7A3]/.test(val)) return;
            clearTimeout(romTimer);
            romTimer = setTimeout(async () => {
                try {
                    const res = await fetch('/api/language/romanize', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: val })
                    });
                    if (!res.ok) return;
                    const data = await res.json();
                    if (data && data.romanization && engWordInput.value.trim() === val) {
                        engRomanizationInput.value = data.romanization;
                    }
                } catch (_) {
                    // Best-effort auto-romanization
                }
            }, 220);
        });
    }

    const sectionConfig = {
        vocabulary: {
            fieldsetId: 'englishFieldsVocabulary',
            requiredIds: ['engWord', 'engSpanish'],
            focusId: 'engWord',
            badgeLabel: 'Glossary'
        },
        grammar: {
            fieldsetId: 'englishFieldsGrammar',
            requiredIds: ['engGrammarTitle', 'engGrammarNotes'],
            focusId: 'engGrammarTitle',
            badgeLabel: 'Grammar'
        },
        phrasal_verb: {
            fieldsetId: 'englishFieldsPhrasal',
            requiredIds: ['engPvVerb', 'engPvMeaningEs'],
            focusId: 'engPvVerb',
            badgeLabel: 'Phrasal Verb'
        }
    };

    function mostrarEstadoEnglish(tipo, mensaje) {
        if (!statusBanner) return;
        statusBanner.className = `english-status-banner ${tipo}`;
        statusBanner.textContent = mensaje;
        statusBanner.hidden = false;
    }

    function cambiarCategoriaEnglish(cat) {
        const isMusic = cat === 'music' && Boolean(englishMusicStudio);
        const safeCat = isMusic ? 'music' : (sectionConfig[cat] ? cat : 'vocabulary');
        if (categoryInput) categoryInput.value = safeCat;

        tabButtons.forEach(btn => {
            const active = btn.getAttribute('data-english-cat') === safeCat;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', String(active));
        });

        englishForm.hidden = isMusic;
        if (englishRecentBox) englishRecentBox.hidden = isMusic;
        if (englishMusicStudio) englishMusicStudio.hidden = !isMusic;
        if (englishCard) englishCard.classList.toggle('music-wide', isMusic);

        Object.entries(sectionConfig).forEach(([key, cfg]) => {
            const isTarget = !isMusic && key === safeCat;
            const fs = document.getElementById(cfg.fieldsetId);
            if (fs) fs.hidden = !isTarget;
            cfg.requiredIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.required = isTarget;
            });
        });

        if (statusBanner) statusBanner.hidden = true;
        if (isMusic && typeof ensureEnglishMusicCatalogLoaded === 'function') {
            ensureEnglishMusicCatalogLoaded();
        }
    }

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            cambiarCategoriaEnglish(btn.getAttribute('data-english-cat'));
        });
    });

    function buildEnglishEntryPayload(category) {
        const val = (id) => (document.getElementById(id)?.value || '').trim();
        const activeLangCode = studyLanguageInput ? studyLanguageInput.value : 'en_ko';
        const languageLabel = STUDY_LANGUAGE_UI[activeLangCode]?.label || 'English + Korean (K-Pop)';

        if (category === 'vocabulary') {
            return {
                category: 'vocabulary',
                language: languageLabel,
                word: val('engWord'),
                romanization: val('engRomanization'),
                part_of_speech: val('engPos'),
                spanish: val('engSpanish'),
                example: val('engVocabExample'),
                notes: val('engVocabNotes')
            };
        }

        if (category === 'grammar') {
            return {
                category: 'grammar',
                language: languageLabel,
                title: val('engGrammarTitle'),
                notes: val('engGrammarNotes'),
                example: val('engGrammarExample')
            };
        }

        return {
            category: 'phrasal_verb',
            language: languageLabel,
            verb: val('engPvVerb'),
            grammar_type: val('engPvType'),
            meaning_es: val('engPvMeaningEs'),
            meaning_en: val('engPvMeaningEn'),
            example: val('engPvExample'),
            notes: val('engPvNotes')
        };
    }

    function appendRecentEnglishItem(entry) {
        if (!recentList) return;
        const placeholder = recentList.querySelector('.muted-text');
        if (placeholder) placeholder.remove();

        const row = document.createElement('div');
        row.className = 'english-recent-item';

        const titleSpan = document.createElement('span');
        if (entry.category === 'vocabulary') {
            const romPart = entry.romanization ? ` [${entry.romanization}]` : '';
            titleSpan.textContent = `${entry.word}${romPart} — ${entry.spanish}`;
        } else if (entry.category === 'grammar') {
            titleSpan.textContent = entry.title;
        } else {
            titleSpan.textContent = `${entry.verb} — ${entry.meaning_es}`;
        }

        const badge = document.createElement('span');
        badge.className = 'english-badge';
        badge.textContent = sectionConfig[entry.category]?.badgeLabel || entry.category;

        row.append(titleSpan, badge);
        recentList.prepend(row);
    }

    function limpiarCamposEnglish(category) {
        const idsByCategory = {
            vocabulary: ['engWord', 'engRomanization', 'engPos', 'engSpanish', 'engVocabExample', 'engVocabNotes'],
            grammar: ['engGrammarTitle', 'engGrammarNotes', 'engGrammarExample'],
            phrasal_verb: ['engPvVerb', 'engPvType', 'engPvMeaningEs', 'engPvMeaningEn', 'engPvExample', 'engPvNotes']
        };
        (idsByCategory[category] || []).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const focusEl = document.getElementById(sectionConfig[category]?.focusId || 'engWord');
        if (focusEl) focusEl.focus();
    }

    const sentEnglishSignatures = new Set();

    function getEnglishEntrySignature(entry) {
        return JSON.stringify(
            Object.keys(entry)
                .sort()
                .reduce((acc, k) => {
                    acc[k] = String(entry[k] || '').trim().toLowerCase().replace(/\s+/g, ' ');
                    return acc;
                }, {})
        );
    }

    const englishE2eeBtn = document.getElementById('englishE2eePill');
    if (englishE2eeBtn) {
        englishE2eeBtn.addEventListener('click', () => {
            solicitarLlaveE2EEAsync({ forceEdit: true });
        });
    }

    englishForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnSendEnglish');
        if (!btn || busyActionElements.has(btn) || btn.disabled) return;

        const category = categoryInput ? categoryInput.value : 'vocabulary';
        const entry = buildEnglishEntryPayload(category);

        if (category === 'vocabulary' && (!entry.word || !entry.spanish)) {
            mostrarEstadoEnglish('err', 'Please enter both the English word and its Spanish meaning.');
            return;
        }
        if (category === 'grammar' && (!entry.title || !entry.notes)) {
            mostrarEstadoEnglish('err', 'Please enter a topic title and your grammar/usage notes.');
            return;
        }
        if (category === 'phrasal_verb' && (!entry.verb || !entry.meaning_es)) {
            mostrarEstadoEnglish('err', 'Please enter the phrasal verb and its Spanish meaning.');
            return;
        }

        const signature = getEnglishEntrySignature(entry);
        if (sentEnglishSignatures.has(signature)) {
            mostrarEstadoEnglish('err', 'This exact entry was already queued for your English Word notebook in this session.');
            return;
        }

        const llaveTexto = await solicitarLlaveE2EEAsync();
        if (!llaveTexto) return;

        if (statusBanner) statusBanner.hidden = true;

        runWithButtonLock(btn, async () => {
            try {
                await submitMutationRequest({
                    url: '/api/send-english',
                    method: 'POST',
                    scopeKey: `english:${category}`,
                    signature,
                    buildBody: () => ({ texto: encriptarTextoE2EE(JSON.stringify(entry), llaveTexto) })
                });
                sentEnglishSignatures.add(signature);
                appendRecentEnglishItem(entry);
                limpiarCamposEnglish(category);

                // Also sync this studied item into the persistent AI Learning Memory bank (non-blocking)
                const memPayload = category === 'vocabulary'
                    ? { terms: [{ term: entry.word, romanization: entry.romanization || '', meaning: entry.spanish, category: 'vocabulary', language: studyLanguageInput?.value || 'en_ko' }] }
                    : category === 'phrasal_verb'
                        ? { terms: [{ term: entry.verb, meaning: entry.meaning_es, category: 'phrasal_verb', language: 'en' }] }
                        : { grammarNotes: [`${entry.title}: ${entry.notes}`], language: studyLanguageInput?.value || 'en_ko' };
                fetch('/api/language/memory', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(memPayload)
                })
                    .then(r => (r.ok ? r.json() : null))
                    .then(d => {
                        if (d && d.languageMemory && typeof updateAiMemoryBadgeUI === 'function') {
                            updateAiMemoryBadgeUI(d.languageMemory);
                        }
                    })
                    .catch(() => {});

                const msg = 'Queued! Your PC sync will add this entry to english-notes/English_Learning_Notebook.docx and refresh the Table of Contents.';
                mostrarEstadoEnglish('ok', msg);
                showToast('ok', 'English note queued for Word (PC) & saved to AI Memory!');
            } catch (err) {
                mostrarEstadoEnglish('err', 'Failed to send entry: ' + err.message);
                showToast('err', err.message);
            }
        }, { loadingText: 'Sending...' });
    });

    const languageAiPanel = document.getElementById('languageAiPanel');

    const origCambiarCategoria = cambiarCategoriaEnglish;
    cambiarCategoriaEnglish = function (cat) {
        origCambiarCategoria(cat);
        if (languageAiPanel) {
            languageAiPanel.hidden = (cat === 'music');
        }
    };

    cambiarCategoriaEnglish('vocabulary');
    applyStudyLanguageUi(studyLanguageInput ? studyLanguageInput.value : 'en_ko');
}

let cachedLanguageMemory = { terms: [], grammarNotes: [], songs: [], customContext: '' };

function updateAiMemoryBadgeUI(mem) {
    if (mem && typeof mem === 'object') {
        cachedLanguageMemory = mem;
    }
    const badge = document.getElementById('langAiMemoryBadge');
    if (!badge) return;
    const count = Array.isArray(cachedLanguageMemory.terms) ? cachedLanguageMemory.terms.length : 0;
    badge.textContent = `🧠 Memory: ${count} learned`;
}

function renderAiAnalysisIntoBox(container, analysis) {
    if (!container || !analysis) return;
    container.replaceChildren();
    container.hidden = false;

    if (analysis.languageMemory) {
        updateAiMemoryBadgeUI(analysis.languageMemory);
    }

    const repBadge = document.getElementById('langAiRepertoireBadge');
    if (repBadge && typeof analysis.repertoireCount === 'number') {
        repBadge.textContent = `🎵 Repertoire: ${analysis.repertoireCount} song${analysis.repertoireCount === 1 ? '' : 's'}`;
    }

    if (Array.isArray(analysis.matchedRepertoireSongs) && analysis.matchedRepertoireSongs.length) {
        const repBox = document.createElement('div');
        repBox.className = 'ai-summary-box';
        const titles = analysis.matchedRepertoireSongs.map(s =>
            `"${s.titulo}"${s.artistas?.length ? ` (${s.artistas.join(', ')})` : ''}${s.album ? ` · ${s.album}` : ''}`
        );
        repBox.textContent = `🎵 Matched from Your Music Catalog: ${titles.join(' | ')}`;
        container.appendChild(repBox);
    }

    const summaryEl = document.createElement('div');
    summaryEl.className = 'ai-summary-box';
    const engineTag = analysis.engine === 'gemini'
        ? `🤖 Gemini (${analysis.model || 'gemini-2.5-flash'})`
        : '⚡ Instant Local Engine (Hangul + EN · 0 MB RAM)';
    summaryEl.textContent = `${engineTag}: ${analysis.summary || 'Breakdown ready.'}`;
    container.appendChild(summaryEl);

    if (analysis.fallbackReason) {
        const warnEl = document.createElement('p');
        warnEl.className = 'muted-text';
        warnEl.textContent = `Fallback notice: ${analysis.fallbackReason}`;
        container.appendChild(warnEl);
    }

    if (Array.isArray(analysis.lines) && analysis.lines.length) {
        analysis.lines.slice(0, 24).forEach(line => {
            const card = document.createElement('div');
            card.className = 'ai-line-card';

            const orig = document.createElement('div');
            orig.className = 'ai-line-original';
            orig.textContent = line.original || '';
            card.appendChild(orig);

            if (line.romanization) {
                const rom = document.createElement('div');
                rom.className = 'ai-line-rom';
                rom.textContent = `Romanization: ${line.romanization}`;
                card.appendChild(rom);
            }
            if (line.meaning) {
                const meaning = document.createElement('div');
                meaning.textContent = `Meaning: ${line.meaning}`;
                card.appendChild(meaning);
            }
            if (line.explanation) {
                const exp = document.createElement('div');
                exp.className = 'muted-text';
                exp.textContent = line.explanation;
                card.appendChild(exp);
            }
            container.appendChild(card);
        });
    }

    if (Array.isArray(analysis.vocabulary) && analysis.vocabulary.length) {
        const vocabTitle = document.createElement('strong');
        vocabTitle.textContent = 'Key Vocabulary, Particles & Expressions:';
        container.appendChild(vocabTitle);

        const grid = document.createElement('div');
        grid.className = 'ai-vocab-grid';
        analysis.vocabulary.forEach(item => {
            const chip = document.createElement('div');
            chip.className = 'ai-vocab-chip';
            const head = document.createElement('strong');
            const label = item.romanization ? `${item.term} (${item.romanization})` : item.term;
            head.textContent = item.learnedPreviously ? `🧠 ${label} [Learned]` : label;
            const body = document.createElement('div');
            body.textContent = item.meaning || '';
            chip.append(head, body);
            if (item.example) {
                const ex = document.createElement('small');
                ex.className = 'muted-text';
                ex.textContent = `Ex: ${item.example}`;
                chip.appendChild(ex);
            }
            grid.appendChild(chip);
        });
        container.appendChild(grid);
    }

    if (Array.isArray(analysis.culturalAndGrammarNotes) && analysis.culturalAndGrammarNotes.length) {
        const ul = document.createElement('ul');
        ul.style.margin = '10px 0 0 18px';
        analysis.culturalAndGrammarNotes.forEach(note => {
            const li = document.createElement('li');
            li.textContent = note;
            ul.appendChild(li);
        });
        container.appendChild(ul);
    }
}

function initLanguageAiStudio() {
    let lastQuickAnalysis = null;
    let lastMusicAnalysis = null;

    const btnAskQuick = document.getElementById('btnAskLangAi');
    const btnApplyQuick = document.getElementById('btnApplyAiToForm');
    const btnViewMemory = document.getElementById('btnViewAiMemory');
    const quickBox = document.getElementById('langAiResultBox');
    const quickModeBadge = document.getElementById('langAiModeBadge');

    if (btnViewMemory && quickBox) {
        btnViewMemory.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/language/memory', { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.languageMemory) {
                        updateAiMemoryBadgeUI(data.languageMemory);
                    }
                }
            } catch (_) {}

            quickBox.replaceChildren();
            quickBox.hidden = false;

            const terms = Array.isArray(cachedLanguageMemory.terms) ? cachedLanguageMemory.terms : [];
            const grammar = Array.isArray(cachedLanguageMemory.grammarNotes) ? cachedLanguageMemory.grammarNotes : [];
            const songs = Array.isArray(cachedLanguageMemory.songs) ? cachedLanguageMemory.songs : [];

            const header = document.createElement('div');
            header.className = 'ai-summary-box';
            header.textContent = `🧠 Persistent AI Learning Memory: ${terms.length} vocabulary/expressions · ${grammar.length} grammar insights · ${songs.length} studied songs. Injected automatically into Gemini & Local Linguistic Engine for 100% consistency.`;
            quickBox.appendChild(header);

            if (!terms.length && !grammar.length && !songs.length) {
                const empty = document.createElement('p');
                empty.className = 'muted-text';
                empty.textContent = 'Your AI memory bank will populate automatically as you analyze lyrics/phrases or save entries to your Word notebook.';
                quickBox.appendChild(empty);
                return;
            }

            if (terms.length) {
                const grid = document.createElement('div');
                grid.className = 'ai-vocab-grid';
                terms.slice(0, 24).forEach(t => {
                    const chip = document.createElement('div');
                    chip.className = 'ai-vocab-chip';
                    const st = document.createElement('strong');
                    st.textContent = `${t.term}${t.romanization ? ` (${t.romanization})` : ''}`;
                    const m = document.createElement('div');
                    m.textContent = t.meaning || '';
                    chip.append(st, m);
                    grid.appendChild(chip);
                });
                quickBox.appendChild(grid);
            }
        });
    }

    if (btnAskQuick) {
        btnAskQuick.addEventListener('click', () => {
            const questionEl = document.getElementById('langAiQuestion');
            const fallbackWord = (document.getElementById('engWord')?.value || '').trim();
            const query = (questionEl?.value || '').trim() || fallbackWord;
            if (!query) {
                showToast('err', 'Type a phrase, Korean lyric, or question for the AI tutor.');
                return;
            }
            const mode = document.getElementById('langAiEngineSelect')?.value || 'auto';
            const language = document.getElementById('studyLanguageInput')?.value || 'en_ko';
            const selected = typeof getCancionSeleccionada === 'function' ? getCancionSeleccionada() : null;
            const songTitle = selected?.titulo || (document.getElementById('musicSongTitle')?.value || '').trim();
            const artistName = selected
                ? (selected.artists || []).map(a => a.nombre).join(', ')
                : (document.getElementById('musicMainArtist')?.value || '').trim();

            runWithButtonLock(btnAskQuick, async () => {
                try {
                    const res = await fetch('/api/language/analyze', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: query, question: query, language, mode, songTitle, artistName })
                    });
                    if (!res.ok) throw new Error(await res.text() || 'AI analysis failed');
                    const data = await res.json();
                    lastQuickAnalysis = data;
                    renderAiAnalysisIntoBox(quickBox, data);
                    if (quickModeBadge) {
                        quickModeBadge.textContent = data.engine === 'gemini'
                            ? `🤖 ${data.model}`
                            : '⚡ Local KR+EN';
                    }
                    if (btnApplyQuick && data.wordNoteDraft) {
                        btnApplyQuick.hidden = false;
                    }
                } catch (err) {
                    showToast('err', err.message || 'Could not analyze language query.');
                }
            }, { loadingText: 'Analyzing...' });
        });
    }

    if (btnApplyQuick) {
        btnApplyQuick.addEventListener('click', () => {
            const draft = lastQuickAnalysis && lastQuickAnalysis.wordNoteDraft;
            if (!draft) return;
            const vocabBtn = document.querySelector('.english-tab-btn[data-english-cat="vocabulary"]');
            if (vocabBtn) vocabBtn.click();
            const setIf = (id, v) => {
                const el = document.getElementById(id);
                if (el && v) el.value = v;
            };
            const firstVocab = lastQuickAnalysis?.vocabulary?.[0];
            setIf('engWord', firstVocab?.term || draft.word || '');
            setIf('engRomanization', firstVocab?.romanization || '');
            setIf('engSpanish', draft.meaning || '');
            setIf('engVocabExample', draft.example || '');
            setIf('engVocabNotes', draft.notes || '');
            showToast('ok', 'Filled Glossary study form from AI breakdown!');
        });
    }

    const btnMusicAi = document.getElementById('btnMusicAiExplainLyrics');
    const musicAiBox = document.getElementById('musicAiBreakdownPanel');
    const musicApplyRow = document.getElementById('musicAiApplyRow');
    const btnMusicInsert = document.getElementById('btnMusicAiInsertToNotes');

    if (btnMusicAi) {
        btnMusicAi.addEventListener('click', () => {
            const lyrics = (document.getElementById('musicStudyLyrics')?.value || '').trim();
            if (!lyrics) {
                showToast('err', 'Paste song lyrics (English, Korean, or K-Pop) first.');
                return;
            }
            const selected = typeof getCancionSeleccionada === 'function' ? getCancionSeleccionada() : null;
            const songTitle = selected?.titulo || (document.getElementById('musicSongTitle')?.value || '').trim();
            const artistName = selected
                ? (selected.artists || []).map(a => a.nombre).join(', ')
                : (document.getElementById('musicMainArtist')?.value || '').trim();
            const language = selected?.idioma || document.getElementById('musicSongLanguage')?.value || 'en_ko';
            const mode = document.getElementById('langAiEngineSelect')?.value || 'auto';

            runWithButtonLock(btnMusicAi, async () => {
                try {
                    const res = await fetch('/api/language/analyze', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            text: lyrics,
                            question: 'Explain the lyrics meanings, Korean Hangul romanization, grammar particles, idioms, and K-Pop code-switching.',
                            language,
                            songTitle,
                            artistName,
                            mode
                        })
                    });
                    if (!res.ok) throw new Error(await res.text() || 'Lyrics analysis failed');
                    const data = await res.json();
                    lastMusicAnalysis = data;
                    renderAiAnalysisIntoBox(musicAiBox, data);
                    if (musicApplyRow) musicApplyRow.hidden = false;
                } catch (err) {
                    showToast('err', err.message || 'Could not analyze song lyrics.');
                }
            }, { loadingText: 'Analyzing Lyrics...' });
        });
    }

    if (btnMusicInsert) {
        btnMusicInsert.addEventListener('click', () => {
            if (!lastMusicAnalysis) return;
            const vocabEl = document.getElementById('musicStudyVocab');
            const pronEl = document.getElementById('musicStudyPronunciation');
            const notesEl = document.getElementById('musicStudyExtraNotes');

            const romLines = (lastMusicAnalysis.lines || [])
                .filter(l => l.romanization)
                .map(l => `${l.original} -> ${l.romanization}`)
                .join('\n');
            if (pronEl && romLines) {
                pronEl.value = [pronEl.value.trim(), romLines].filter(Boolean).join('\n');
            }

            const vocabLines = (lastMusicAnalysis.vocabulary || [])
                .map(v => `• ${v.term}${v.romanization ? ` (${v.romanization})` : ''}: ${v.meaning}`)
                .join('\n');
            if (vocabEl && vocabLines) {
                vocabEl.value = [vocabEl.value.trim(), vocabLines].filter(Boolean).join('\n');
            }

            const summaryNotes = [
                lastMusicAnalysis.summary,
                ...(lastMusicAnalysis.culturalAndGrammarNotes || [])
            ].filter(Boolean).join('\n');
            if (notesEl && summaryNotes) {
                notesEl.value = [notesEl.value.trim(), summaryNotes].filter(Boolean).join('\n\n');
            }
            showToast('ok', 'Added Romanization, Vocabulary & AI Notes below—ready to encrypt & save to Word!');
        });
    }
}

// ==========================================
// ENGLISH LEARN WITH MUSIC STUDIO (MYSQL METADATA + E2EE WORD NOTES)
// ==========================================
let musicCatalogLoadRequested = false;

function ensureEnglishMusicCatalogLoaded() {
    if (!musicCatalogLoadRequested && typeof cargarCatalogoMusical === 'function') {
        musicCatalogLoadRequested = true;
        cargarCatalogoMusical();
    }
}

const RELEASE_TYPE_LABELS = {
    album: 'Album',
    mini_album: 'Mini Album',
    ep: 'EP',
    single: 'Single',
    collab_single: 'Collab Single',
    ost: 'OST'
};

const MUSIC_STATUS_META = {
    to_study: { label: 'To Study', next: 'in_progress' },
    in_progress: { label: 'In Progress', next: 'mastered' },
    mastered: { label: 'Mastered', next: 'to_study' }
};

const englishMusicStudioRoot = document.getElementById('englishMusicStudio');
const musicState = {
    artists: [],
    albums: [],
    songs: [],
    selectedSongId: null,
    editingSongId: null,
    embedOpen: false,
    navArtistId: null,
    navAlbumKey: null
};

async function cargarCatalogoMusical() {
    const container = document.getElementById('musicCatalogContainer');
    if (!container) return;

    container.replaceChildren(createLoadingBanner('Loading songs & artists...', 'sm'));
    try {
        const res = await fetch('/api/english/music/catalog');
        if (!res.ok) throw new Error(await res.text() || 'Failed to load music catalog.');
        const data = await res.json();
        musicState.artists = Array.isArray(data.artists) ? data.artists : [];
        musicState.albums = Array.isArray(data.albums) ? data.albums : [];
        musicState.songs = (Array.isArray(data.songs) ? data.songs : []).map(song => ({
            ...song,
            youtube_url: buildClientStandardYouTubeUrl({
                videoId: song.yt_video_id,
                ytMusicUrl: song.yt_music_url,
                youtubeUrl: song.youtube_url || song.youtubeUrl
            })
        }));

        poblarSelectoresMusica();
        renderMusicStats(data.stats);
        const repBadge = document.getElementById('langAiRepertoireBadge');
        if (repBadge) {
            repBadge.textContent = `🎵 Repertoire: ${musicState.songs.length} song${musicState.songs.length === 1 ? '' : 's'}`;
        }
        renderMusicRepertoireNavigator();
        renderMusicCatalog();
        actualizarBarraCancionEstudio();
    } catch (err) {
        musicCatalogLoadRequested = false;
        const p = document.createElement('p');
        p.className = 'muted-text';
        p.textContent = 'Could not load music catalog: ' + err.message;
        container.replaceChildren(p);
    }
}

function poblarSelectoresMusica() {
    const artistSelect = document.getElementById('musicFilterArtist');
    const artistDatalist = document.getElementById('musicArtistsDatalist');
    const albumDatalist = document.getElementById('musicAlbumsDatalist');

    if (artistSelect) {
        const prev = artistSelect.value;
        const firstOpt = document.createElement('option');
        firstOpt.value = '';
        firstOpt.textContent = 'All Artists';
        artistSelect.replaceChildren(firstOpt);

        musicState.artists.forEach(a => {
            const opt = document.createElement('option');
            opt.value = String(a.id);
            opt.textContent = a.nombre;
            artistSelect.appendChild(opt);
        });
        if (prev && musicState.artists.some(a => String(a.id) === prev)) {
            artistSelect.value = prev;
        }
    }

    if (artistDatalist) {
        artistDatalist.replaceChildren();
        musicState.artists.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.nombre;
            artistDatalist.appendChild(opt);
        });
    }

    if (albumDatalist) {
        albumDatalist.replaceChildren();
        const seenAlbums = new Set();
        musicState.albums.forEach(al => {
            const key = al.titulo.toLowerCase();
            if (seenAlbums.has(key)) return;
            seenAlbums.add(key);
            const opt = document.createElement('option');
            opt.value = al.titulo;
            albumDatalist.appendChild(opt);
        });
    }
}

function renderMusicStats(stats) {
    const statsEl = document.getElementById('musicCatalogStats');
    if (!statsEl) return;
    const s = stats || {};
    const items = [
        `${s.totalSongs || 0} songs`,
        `${s.totalArtists || 0} artists`,
        `${s.totalAlbums || 0} releases`,
        `${s.mastered || 0} mastered`,
        `${s.wordSynced || 0} synced to Word`
    ];
    statsEl.replaceChildren(...items.map(label => {
        const span = document.createElement('span');
        span.className = 'music-stat-pill';
        span.textContent = label;
        return span;
    }));
}

function formatSongArtistsSummary(song) {
    const list = Array.isArray(song.artists) ? song.artists : [];
    const main = list.filter(a => a.rol === 'main').map(a => a.nombre);
    const collabs = list.filter(a => a.rol !== 'main').map(a => (a.rol === 'feat' ? `feat. ${a.nombre}` : a.nombre));
    const head = main.join(', ') || 'Unknown Artist';
    return collabs.length ? `${head} (${collabs.join(', ')})` : head;
}

function mostrarBannerMusica(id, tipo, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!msg) {
        el.hidden = true;
        return;
    }
    el.className = `english-status-banner ${tipo}`;
    el.textContent = msg;
    el.hidden = false;
}

function getCancionSeleccionada() {
    if (!musicState.selectedSongId) return null;
    return musicState.songs.find(s => Number(s.id) === Number(musicState.selectedSongId)) || null;
}

function actualizarBarraCancionEstudio() {
    const bar = document.getElementById('musicStudySelectedBar');
    const songIdInput = document.getElementById('musicWordSongId');
    const openYtBtn = document.getElementById('btnMusicStudyOpenYt');
    const toggleEmbedBtn = document.getElementById('btnMusicToggleEmbed');
    const embedBox = document.getElementById('musicEmbedPlayerBox');
    const song = getCancionSeleccionada();

    if (songIdInput) songIdInput.value = song ? String(song.id) : '';

    if (!song) {
        if (bar) {
            bar.textContent = 'Select any registered song from the catalog (or fill Song Title + Main Artist above) to save private notes encrypted into Word.';
        }
        if (openYtBtn) openYtBtn.hidden = true;
        if (toggleEmbedBtn) toggleEmbedBtn.hidden = true;
        if (embedBox) {
            embedBox.hidden = true;
            embedBox.replaceChildren();
        }
        musicState.embedOpen = false;
        return;
    }

    const artistsText = formatSongArtistsSummary(song);
    const albumText = song.album_titulo ? ` · ${song.album_titulo}` : '';
    if (bar) {
        bar.textContent = `Studying: ${artistsText} — ${song.titulo}${albumText}`;
    }

    if (openYtBtn) {
        const targetPlayback = getSongTargetPlaybackInfo(song);
        if (targetPlayback.url) {
            openYtBtn.href = targetPlayback.url;
            openYtBtn.textContent = targetPlayback.fullLabel;
            openYtBtn.hidden = false;
        } else {
            openYtBtn.hidden = true;
        }
    }

    if (toggleEmbedBtn) {
        if (song.yt_video_id && /^[A-Za-z0-9_-]{11}$/.test(song.yt_video_id)) {
            toggleEmbedBtn.hidden = false;
            toggleEmbedBtn.textContent = musicState.embedOpen ? 'Hide Mini Player' : 'Mini Player';
        } else {
            toggleEmbedBtn.hidden = true;
            musicState.embedOpen = false;
        }
    }

    if (embedBox) {
        if (musicState.embedOpen && song.yt_video_id && /^[A-Za-z0-9_-]{11}$/.test(song.yt_video_id)) {
            const iframe = document.createElement('iframe');
            iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(song.yt_video_id)}?rel=0`;
            iframe.title = `${song.titulo} - Audio / Video Study Player`;
            iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
            iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            iframe.allowFullscreen = true;
            embedBox.replaceChildren(iframe);
            embedBox.hidden = false;
        } else {
            embedBox.hidden = true;
            embedBox.replaceChildren();
        }
    }
}

function seleccionarCancionParaEstudio(song) {
    musicState.selectedSongId = song ? Number(song.id) : null;
    musicState.embedOpen = false;
    actualizarBarraCancionEstudio();
    renderMusicCatalog();
    const card = document.getElementById('musicWordStudyCard');
    if (card && typeof card.scrollIntoView === 'function') {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function cargarCancionEnFormularioEdicion(song) {
    if (!song) return;
    musicState.editingSongId = song.id;
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val ?? '';
    };

    const mainArtistObj = (song.artists || []).find(a => a.rol === 'main') || (song.artists || [])[0];
    const artistRecord = (musicState.artists || []).find(a => Number(a.id) === Number(mainArtistObj?.id));
    const collabs = (song.artists || [])
        .filter(a => !mainArtistObj || a.id !== mainArtistObj.id)
        .map(a => (a.rol === 'feat' ? `feat. ${a.nombre}` : a.nombre))
        .join(', ');

    setVal('musicSongEditId', String(song.id));
    setVal('musicSongYtUrl', song.yt_music_url || '');
    setVal('musicSongTitle', song.titulo || '');
    setVal('musicSongTrackNumber', song.numero_pista || '');
    setVal('musicSongLanguage', song.idioma || 'English');
    setVal('musicMainArtist', mainArtistObj ? mainArtistObj.nombre : '');
    setVal('musicMainArtistType', artistRecord?.tipo_artista || 'group');
    setVal('musicCollaborators', collabs);
    setVal('musicAlbumTitle', song.album_titulo || '');
    setVal('musicAlbumType', song.album_tipo || 'album');
    setVal('musicAlbumYear', song.album_anio || '');
    setVal('musicStudyStatus', song.estado_estudio || 'to_study');
    setVal('musicFocusSummary', song.enfoque_corto || '');

    const titleEl = document.getElementById('musicSongFormTitle');
    const cancelBtn = document.getElementById('btnMusicCancelEdit');
    const saveBtn = document.getElementById('btnMusicSaveSong');
    if (titleEl) titleEl.textContent = `Edit Song: ${song.titulo}`;
    if (cancelBtn) cancelBtn.hidden = false;
    if (saveBtn) saveBtn.textContent = 'Update Song Metadata';
    mostrarBannerMusica('musicSongFormBanner', '', '');

    const form = document.getElementById('musicSongForm');
    if (form && typeof form.scrollIntoView === 'function') {
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function cancelarEdicionCancionMusica() {
    musicState.editingSongId = null;
    const form = document.getElementById('musicSongForm');
    if (form) form.reset();
    const langInput = document.getElementById('musicSongLanguage');
    if (langInput) langInput.value = 'English';
    const editId = document.getElementById('musicSongEditId');
    if (editId) editId.value = '';
    const titleEl = document.getElementById('musicSongFormTitle');
    const cancelBtn = document.getElementById('btnMusicCancelEdit');
    const saveBtn = document.getElementById('btnMusicSaveSong');
    if (titleEl) titleEl.textContent = 'Register or Link Song';
    if (cancelBtn) cancelBtn.hidden = true;
    if (saveBtn) saveBtn.textContent = 'Save Song Metadata';
}

function openMusicEntityEditModal(kind, entity) {
    const modal = document.getElementById('musicEntityEditModal');
    const form = document.getElementById('musicEntityEditForm');
    if (!modal || !form || !entity) return;

    const isArtist = kind === 'artist';
    const titleEl = document.getElementById('musicEntityEditTitle');
    const kindEl = document.getElementById('musicEntityKind');
    const idEl = document.getElementById('musicEntityId');
    const nameLabel = document.getElementById('musicEntityNameLabel');
    const nameInput = document.getElementById('musicEntityName');
    const typeLabel = document.getElementById('musicEntityTypeLabel');
    const typeSelect = document.getElementById('musicEntityType');
    const yearGroup = document.getElementById('musicEntityYearGroup');
    const yearInput = document.getElementById('musicEntityYear');
    const notesGroup = document.getElementById('musicEntityNotesGroup');
    const notesInput = document.getElementById('musicEntityNotes');

    if (titleEl) titleEl.textContent = isArtist ? `Edit Artist: ${entity.nombre || ''}` : `Edit Album: ${entity.titulo || ''}`;
    if (kindEl) kindEl.value = isArtist ? 'artist' : 'album';
    if (idEl) idEl.value = String(entity.id || '');
    if (nameLabel) nameLabel.textContent = isArtist ? 'Artist / Group Name *' : 'Album / Release Title *';
    if (nameInput) {
        nameInput.value = isArtist ? (entity.nombre || '') : (entity.titulo || '');
        nameInput.placeholder = isArtist ? 'e.g. BABYMONSTER' : 'e.g. DRIP';
    }
    if (typeLabel) typeLabel.textContent = isArtist ? 'Artist Format' : 'Release Type';

    if (typeSelect) {
        const opts = isArtist
            ? [
                ['group', 'Group'],
                ['solo', 'Solo Artist'],
                ['duo', 'Duo'],
                ['collab_project', 'Collab Unit']
            ]
            : [
                ['album', 'Album'],
                ['mini_album', 'Mini Album'],
                ['ep', 'EP'],
                ['single', 'Single'],
                ['collab_single', 'Collab Single'],
                ['ost', 'OST / Soundtrack']
            ];
        typeSelect.replaceChildren();
        opts.forEach(([val, text]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = text;
            typeSelect.appendChild(opt);
        });
        const currentType = isArtist ? (entity.tipo_artista || 'group') : (entity.tipo_lanzamiento || 'album');
        typeSelect.value = currentType;
    }

    if (yearGroup) yearGroup.hidden = isArtist;
    if (yearInput) yearInput.value = !isArtist && entity.anio ? String(entity.anio) : '';
    if (notesGroup) notesGroup.hidden = !isArtist;
    if (notesInput) notesInput.value = isArtist ? (entity.notas_cortas || '') : '';

    mostrarBannerMusica('musicEntityEditBanner', '', '');
    modal.hidden = false;
    if (nameInput && typeof nameInput.focus === 'function') {
        nameInput.focus();
    }
}

function initMusicEntityEditModal() {
    const modal = document.getElementById('musicEntityEditModal');
    const form = document.getElementById('musicEntityEditForm');
    const btnClose = document.getElementById('btnCloseMusicEntityModal');
    const btnCancel = document.getElementById('btnCancelMusicEntityModal');
    if (!modal || !form || form.dataset.wired === 'true') return;
    form.dataset.wired = 'true';

    const closeModal = () => {
        modal.hidden = true;
        mostrarBannerMusica('musicEntityEditBanner', '', '');
    };

    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.hidden) closeModal();
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const btnSave = document.getElementById('btnSaveMusicEntityModal');
        const kind = document.getElementById('musicEntityKind')?.value === 'album' ? 'album' : 'artist';
        const entityId = Number(document.getElementById('musicEntityId')?.value || 0);
        const rawName = (document.getElementById('musicEntityName')?.value || '').trim();
        const typeVal = document.getElementById('musicEntityType')?.value || '';
        const yearRaw = (document.getElementById('musicEntityYear')?.value || '').trim();
        const notesRaw = (document.getElementById('musicEntityNotes')?.value || '').trim();

        if (!entityId || !rawName) {
            mostrarBannerMusica('musicEntityEditBanner', 'err', 'Name/title is required.');
            return;
        }

        const isArtist = kind === 'artist';
        const targetUrl = isArtist
            ? `/api/english/music/artists/${entityId}`
            : `/api/english/music/albums/${entityId}`;
        const payload = isArtist
            ? {
                nombre: rawName,
                tipoArtista: typeVal || 'group',
                notasCortas: notesRaw
            }
            : {
                titulo: rawName,
                tipoLanzamiento: typeVal || 'album',
                anio: yearRaw ? Number(yearRaw) : null
            };

        mostrarBannerMusica('musicEntityEditBanner', '', '');
        runWithButtonLock(btnSave, async () => {
            try {
                const resData = await submitMutationRequest({
                    url: targetUrl,
                    method: 'PATCH',
                    scopeKey: `english-music-entity:${kind}:${entityId}`,
                    signature: JSON.stringify(payload),
                    buildBody: () => payload,
                    parseJson: true
                });
                closeModal();
                showToast('ok', resData?.message || (isArtist ? 'Artist updated.' : 'Album updated.'));
                await cargarCatalogoMusical();
            } catch (err) {
                mostrarBannerMusica('musicEntityEditBanner', 'err', err.message || 'Could not update metadata.');
            }
        }, { loadingText: 'Saving...' });
    });
}

function renderMusicCatalog() {
    const container = document.getElementById('musicCatalogContainer');
    if (!container) return;

    const search = (document.getElementById('musicFilterSearch')?.value || '').trim().toLowerCase();
    const artistFilter = document.getElementById('musicFilterArtist')?.value || '';
    const releaseFilter = document.getElementById('musicFilterReleaseType')?.value || '';
    const langFilter = document.getElementById('musicFilterLanguage')?.value || '';
    const statusFilter = document.getElementById('musicFilterStatus')?.value || '';

    const filteredSongs = musicState.songs.filter(song => {
        if (artistFilter) {
            const hasArtist = (song.artists || []).some(a => String(a.id) === String(artistFilter));
            if (!hasArtist) return false;
        }
        if (releaseFilter && (song.album_tipo || 'single') !== releaseFilter) return false;
        if (langFilter && (song.idioma || 'English') !== langFilter) return false;
        if (statusFilter && song.estado_estudio !== statusFilter) return false;
        if (search) {
            const haystack = [
                song.titulo,
                song.album_titulo,
                song.enfoque_corto,
                ...(song.artists || []).map(a => a.nombre)
            ].filter(Boolean).join(' ').toLowerCase();
            if (!haystack.includes(search)) return false;
        }
        return true;
    });

    if (!filteredSongs.length) {
        const emptyP = document.createElement('p');
        emptyP.className = 'muted-text';
        emptyP.textContent = musicState.songs.length
            ? 'No songs match your current filters.'
            : 'No songs registered yet. Search in YouTube Music above or add your first song on the left!';
        container.replaceChildren(emptyP);
        return;
    }

    // Agrupar por Artista (las colaboraciones aparecen también bajo cada artista colaborador)
    const artistBuckets = new Map();
    filteredSongs.forEach(song => {
        const artists = Array.isArray(song.artists) && song.artists.length
            ? song.artists
            : [{ id: 0, nombre: 'Unknown Artist', rol: 'main' }];

        artists.forEach(art => {
            if (artistFilter && String(art.id) !== String(artistFilter)) return;
            if (!artistBuckets.has(art.id)) {
                artistBuckets.set(art.id, {
                    id: art.id,
                    nombre: art.nombre,
                    albums: new Map()
                });
            }
            const bucket = artistBuckets.get(art.id);
            const albumKey = song.album_id ? `alb_${song.album_id}` : `single_none`;
            if (!bucket.albums.has(albumKey)) {
                bucket.albums.set(albumKey, {
                    albumId: song.album_id || null,
                    titulo: song.album_titulo || 'Standalone Singles & Tracks',
                    tipo: song.album_titulo ? (song.album_tipo || 'album') : 'single',
                    anio: song.album_anio || null,
                    songs: []
                });
            }
            bucket.albums.get(albumKey).songs.push({ song, artistRole: art.rol });
        });
    });

    const sortedArtists = Array.from(artistBuckets.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const fragment = document.createDocumentFragment();

    sortedArtists.forEach(artistGroup => {
        const groupCard = document.createElement('div');
        groupCard.className = 'music-artist-group';

        const header = document.createElement('div');
        header.className = 'music-artist-header';
        const nameEl = document.createElement('span');
        nameEl.className = 'music-artist-name';
        nameEl.textContent = `🎤 ${artistGroup.nombre}`;

        const artistRecord = (musicState.artists || []).find(a => Number(a.id) === Number(artistGroup.id));
        const headActions = document.createElement('div');
        headActions.className = 'music-artist-head-actions';

        const countEl = document.createElement('span');
        countEl.className = 'muted-text';
        const totalInArtist = Array.from(artistGroup.albums.values()).reduce((sum, al) => sum + al.songs.length, 0);
        countEl.textContent = `${totalInArtist} song(s)`;
        headActions.appendChild(countEl);

        if (artistGroup.id > 0) {
            const editArtistBtn = document.createElement('button');
            editArtistBtn.type = 'button';
            editArtistBtn.className = 'btn-mini-edit';
            editArtistBtn.textContent = '✏️ Edit Artist';
            editArtistBtn.title = 'Rename artist, change format or notes';
            editArtistBtn.addEventListener('click', () => {
                openMusicEntityEditModal('artist', {
                    id: artistGroup.id,
                    nombre: artistGroup.nombre,
                    tipo_artista: artistRecord?.tipo_artista || 'group',
                    notas_cortas: artistRecord?.notas_cortas || ''
                });
            });
            headActions.appendChild(editArtistBtn);
        }

        header.append(nameEl, headActions);
        groupCard.appendChild(header);

        const sortedAlbums = Array.from(artistGroup.albums.values()).sort((a, b) => {
            if (a.titulo === 'Standalone Singles & Tracks') return 1;
            if (b.titulo === 'Standalone Singles & Tracks') return -1;
            const yearDiff = (b.anio || 0) - (a.anio || 0);
            if (yearDiff !== 0) return yearDiff;
            return a.titulo.localeCompare(b.titulo);
        });

        sortedAlbums.forEach(album => {
            const albumBlock = document.createElement('div');
            albumBlock.className = 'music-album-block';

            const albumHeader = document.createElement('div');
            albumHeader.className = 'music-album-header';

            const albumTitleEl = document.createElement('span');
            albumTitleEl.className = 'music-album-title';
            albumTitleEl.textContent = album.anio ? `${album.titulo} (${album.anio})` : album.titulo;

            const albumMetaWrap = document.createElement('div');
            albumMetaWrap.className = 'music-artist-head-actions';

            const typeBadge = document.createElement('span');
            typeBadge.className = 'music-release-badge';
            typeBadge.textContent = RELEASE_TYPE_LABELS[album.tipo] || album.tipo;
            albumMetaWrap.appendChild(typeBadge);

            if (album.albumId) {
                const editAlbumBtn = document.createElement('button');
                editAlbumBtn.type = 'button';
                editAlbumBtn.className = 'btn-mini-edit';
                editAlbumBtn.textContent = '✏️ Edit Album';
                editAlbumBtn.title = 'Edit album title, release type or year';
                editAlbumBtn.addEventListener('click', () => {
                    openMusicEntityEditModal('album', {
                        id: album.albumId,
                        titulo: album.titulo,
                        tipo_lanzamiento: album.tipo || 'album',
                        anio: album.anio || ''
                    });
                });
                albumMetaWrap.appendChild(editAlbumBtn);
            }

            albumHeader.append(albumTitleEl, albumMetaWrap);
            albumBlock.appendChild(albumHeader);

            const songList = document.createElement('div');
            songList.className = 'music-song-list';

            album.songs.sort((a, b) => {
                const ta = a.song.numero_pista || 9999;
                const tb = b.song.numero_pista || 9999;
                if (ta !== tb) return ta - tb;
                return a.song.titulo.localeCompare(b.song.titulo);
            });

            album.songs.forEach(({ song, artistRole }) => {
                const row = document.createElement('div');
                row.className = 'music-song-row';
                row.setAttribute('data-song-id', String(song.id));
                row.title = 'Click song to select it for Study & AI Analysis';
                if (Number(musicState.selectedSongId) === Number(song.id)) {
                    row.classList.add('selected');
                }
                row.addEventListener('click', (ev) => {
                    if (ev.target && ev.target.closest('button, a')) return;
                    seleccionarCancionParaEstudio(song);
                    if (typeof renderMusicRepertoireNavigator === 'function') {
                        renderMusicRepertoireNavigator();
                    }
                });

                const main = document.createElement('div');
                main.className = 'music-song-main';
                if (song.thumbnail_url && /^https:\/\/i\.ytimg\.com\//i.test(song.thumbnail_url)) {
                    const img = document.createElement('img');
                    img.className = 'music-song-thumb';
                    img.src = song.thumbnail_url;
                    img.alt = song.titulo;
                    img.loading = 'lazy';
                    main.appendChild(img);
                }

                const info = document.createElement('div');
                info.className = 'music-song-info';

                const titleLine = document.createElement('div');
                titleLine.className = 'music-song-title-line';
                const prefix = song.numero_pista ? `${song.numero_pista}. ` : '';
                const titleSpan = document.createElement('span');
                titleSpan.textContent = `${prefix}${song.titulo}`;
                titleLine.appendChild(titleSpan);

                if (artistRole !== 'main') {
                    const collabRole = document.createElement('span');
                    collabRole.className = 'music-release-badge';
                    collabRole.textContent = artistRole === 'feat' ? 'Featured' : 'Collab';
                    titleLine.appendChild(collabRole);
                }
                info.appendChild(titleLine);

                const collabs = (song.artists || []).filter(a => Number(a.id) !== Number(artistGroup.id));
                if (collabs.length) {
                    const collabLine = document.createElement('div');
                    collabLine.className = 'music-song-collabs';
                    collabLine.textContent = `With: ${collabs.map(c => (c.rol === 'feat' ? `feat. ${c.nombre}` : c.nombre)).join(', ')}`;
                    info.appendChild(collabLine);
                }

                if (song.enfoque_corto) {
                    const focusLine = document.createElement('div');
                    focusLine.className = 'music-song-focus';
                    focusLine.textContent = song.enfoque_corto;
                    info.appendChild(focusLine);
                }

                const badgeRow = document.createElement('div');
                badgeRow.className = 'music-badge-row';

                const stMeta = MUSIC_STATUS_META[song.estado_estudio] || MUSIC_STATUS_META.to_study;
                const statusBtn = document.createElement('button');
                statusBtn.type = 'button';
                statusBtn.className = `music-status-pill state-${song.estado_estudio}`;
                statusBtn.textContent = stMeta.label;
                statusBtn.title = 'Click to advance study status';
                statusBtn.addEventListener('click', () => {
                    runWithButtonLock(statusBtn, async () => {
                        const res = await fetch(`/api/english/music/songs/${song.id}/status`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ estadoEstudio: stMeta.next })
                        });
                        if (res.ok) await cargarCatalogoMusical();
                    });
                });
                badgeRow.appendChild(statusBtn);

                if (song.idioma) {
                    const langBadge = document.createElement('span');
                    langBadge.className = 'music-word-badge';
                    langBadge.textContent = song.idioma;
                    badgeRow.appendChild(langBadge);
                }

                if (song.word_sincronizado) {
                    const wordBadge = document.createElement('span');
                    wordBadge.className = 'music-word-badge';
                    wordBadge.textContent = 'Word Notes Queued';
                    badgeRow.appendChild(wordBadge);
                }

                info.appendChild(badgeRow);
                main.appendChild(info);

                const actions = document.createElement('div');
                actions.className = 'music-song-actions';

                const playbackInfo = getSongTargetPlaybackInfo(song);
                if (playbackInfo.url) {
                    const ytLink = document.createElement('a');
                    ytLink.className = 'btn-secondary btn-small';
                    ytLink.href = playbackInfo.url;
                    ytLink.target = '_blank';
                    ytLink.rel = 'noopener noreferrer';
                    ytLink.textContent = playbackInfo.shortLabel;
                    ytLink.title = playbackInfo.fullLabel;
                    actions.appendChild(ytLink);
                }

                const studyBtn = document.createElement('button');
                studyBtn.type = 'button';
                studyBtn.className = 'btn-primary btn-small';
                studyBtn.textContent = 'Study -> Word';
                studyBtn.addEventListener('click', () => seleccionarCancionParaEstudio(song));
                actions.appendChild(studyBtn);

                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = 'btn-secondary btn-small';
                editBtn.textContent = 'Edit';
                editBtn.addEventListener('click', () => cargarCancionEnFormularioEdicion(song));
                actions.appendChild(editBtn);

                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'btn-secondary btn-small';
                delBtn.textContent = 'Delete';
                delBtn.addEventListener('click', async () => {
                    const ok = await openConfirmDialog({
                        title: 'Remove Song?',
                        message: `Remove "${song.titulo}" from your music catalog? Your local Word notes stay safely on your PC.`,
                        confirmText: 'Remove Song',
                        danger: true
                    });
                    if (!ok) return;
                    runWithButtonLock(delBtn, async () => {
                        const res = await fetch(`/api/english/music/songs/${song.id}`, { method: 'DELETE' });
                        if (res.ok) {
                            if (Number(musicState.selectedSongId) === Number(song.id)) {
                                musicState.selectedSongId = null;
                            }
                            showToast('ok', `Removed "${song.titulo}" from catalog.`);
                            await cargarCatalogoMusical();
                        } else {
                            showToast('err', 'Could not remove song.');
                        }
                    }, { loadingText: '...' });
                });
                actions.appendChild(delBtn);

                row.append(main, actions);
                songList.appendChild(row);
            });

            albumBlock.appendChild(songList);
            groupCard.appendChild(albumBlock);
        });

        fragment.appendChild(groupCard);
    });

    container.replaceChildren(fragment);
}

if (englishMusicStudioRoot) {
    const btnOpenLib = document.getElementById('btnMusicOpenYtLibrary');
    const btnSearchYt = document.getElementById('btnMusicSearchYt');
    const btnResolveYt = document.getElementById('btnMusicResolveYt');
    const btnRefreshCatalog = document.getElementById('btnMusicRefreshCatalog');
    const btnCancelEdit = document.getElementById('btnMusicCancelEdit');
    const btnToggleEmbed = document.getElementById('btnMusicToggleEmbed');
    const songForm = document.getElementById('musicSongForm');
    const wordForm = document.getElementById('musicWordNotesForm');

    document.querySelectorAll('#ytPlatformModeGroup [data-yt-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            setYouTubePlatformMode(btn.getAttribute('data-yt-mode') || 'auto');
            showToast('info', `Playback link mode set to: ${btn.textContent.trim()}`);
        });
    });

    updateYouTubePlatformUI();

    if (btnOpenLib) {
        btnOpenLib.addEventListener('click', () => {
            window.open(getYouTubeHomeUrl(), '_blank', 'noopener,noreferrer');
        });
    }

    if (btnSearchYt) {
        btnSearchYt.addEventListener('click', async () => {
            const q = (document.getElementById('musicYtSearchQuery')?.value || '').trim();
            const directUrl = getYouTubeSearchUrl(q);
            window.open(directUrl, '_blank', 'noopener,noreferrer');

            const resultsBox = document.getElementById('musicYtSearchResults');
            if (!q || !resultsBox) return;

            runWithButtonLock(btnSearchYt, async () => {
                try {
                    const res = await fetch(`/api/english/music/search?q=${encodeURIComponent(q)}`);
                    if (!res.ok) return;
                    const data = await res.json();
                    const items = Array.isArray(data.results) ? data.results : [];
                    if (!items.length) {
                        resultsBox.hidden = true;
                        return;
                    }
                    const effectivePlatform = getEffectiveYouTubePlatform();
                    resultsBox.replaceChildren(...items.map(item => {
                        const card = document.createElement('div');
                        card.className = 'music-yt-result-item';
                        if (item.thumbnailUrl && /^https:\/\/i\.ytimg\.com\//i.test(item.thumbnailUrl)) {
                            const img = document.createElement('img');
                            img.src = item.thumbnailUrl;
                            img.alt = item.title;
                            card.appendChild(img);
                        }
                        const meta = document.createElement('div');
                        meta.className = 'music-yt-result-meta';
                        const t = document.createElement('div');
                        t.className = 'music-yt-result-title';
                        t.textContent = item.title;
                        const ch = document.createElement('div');
                        ch.className = 'music-yt-result-channel';
                        ch.textContent = item.channelTitle;
                        const useBtn = document.createElement('button');
                        useBtn.type = 'button';
                        useBtn.className = 'btn-primary btn-small';
                        useBtn.textContent = 'Select Song';
                        useBtn.addEventListener('click', () => {
                            const urlEl = document.getElementById('musicSongYtUrl');
                            const titleEl = document.getElementById('musicSongTitle');
                            const artistEl = document.getElementById('musicMainArtist');
                            const chosenUrl = effectivePlatform === 'youtube'
                                ? (item.youtubeUrl || item.ytMusicUrl || '')
                                : (item.ytMusicUrl || item.youtubeUrl || '');
                            if (urlEl) urlEl.value = chosenUrl;
                            if (titleEl && !titleEl.value.trim()) titleEl.value = item.title || '';
                            if (artistEl && !artistEl.value.trim()) artistEl.value = item.channelTitle || '';
                        });
                        meta.append(t, ch, useBtn);
                        card.appendChild(meta);
                        return card;
                    }));
                    resultsBox.hidden = false;
                } catch (_err) {
                    resultsBox.hidden = true;
                }
            }, { loadingText: 'Searching...' });
        });
    }

    if (btnResolveYt) {
        btnResolveYt.addEventListener('click', () => {
            const urlInput = document.getElementById('musicSongYtUrl');
            const rawUrl = (urlInput?.value || '').trim();
            if (!rawUrl) {
                mostrarBannerMusica('musicSongFormBanner', 'err', 'Paste a YouTube or YouTube Music song link first.');
                return;
            }
            mostrarBannerMusica('musicSongFormBanner', '', '');
            runWithButtonLock(btnResolveYt, async () => {
                try {
                    const data = await submitMutationRequest({
                        url: '/api/english/music/resolve',
                        method: 'POST',
                        buildBody: () => ({ url: rawUrl }),
                        parseJson: true
                    });
                    const effectivePlatform = getEffectiveYouTubePlatform();
                    const resolvedUrl = effectivePlatform === 'youtube'
                        ? (data.youtubeUrl || data.ytMusicUrl)
                        : (data.ytMusicUrl || data.youtubeUrl);
                    if (urlInput && resolvedUrl) urlInput.value = resolvedUrl;
                    const titleEl = document.getElementById('musicSongTitle');
                    const artistEl = document.getElementById('musicMainArtist');
                    if (titleEl && !titleEl.value.trim() && data.suggestedTitle) {
                        titleEl.value = data.suggestedTitle;
                    }
                    if (artistEl && !artistEl.value.trim() && data.suggestedArtist) {
                        artistEl.value = data.suggestedArtist;
                    }
                    mostrarBannerMusica('musicSongFormBanner', 'ok', 'Link verified and cleaned (single-track, playlist-safe).');
                } catch (err) {
                    mostrarBannerMusica('musicSongFormBanner', 'err', err.message || 'Could not resolve link.');
                }
            }, { loadingText: 'Checking...' });
        });
    }

    if (btnCancelEdit) btnCancelEdit.addEventListener('click', cancelarEdicionCancionMusica);
    if (btnRefreshCatalog) btnRefreshCatalog.addEventListener('click', cargarCatalogoMusical);

    if (btnToggleEmbed) {
        btnToggleEmbed.addEventListener('click', () => {
            musicState.embedOpen = !musicState.embedOpen;
            actualizarBarraCancionEstudio();
        });
    }

    ['musicFilterSearch', 'musicFilterArtist', 'musicFilterReleaseType', 'musicFilterLanguage', 'musicFilterStatus'].forEach(fid => {
        const el = document.getElementById(fid);
        if (el) {
            el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', renderMusicCatalog);
        }
    });

    if (songForm) {
        songForm.addEventListener('submit', e => {
            e.preventDefault();
            const btnSave = document.getElementById('btnMusicSaveSong');
            const val = id => (document.getElementById(id)?.value || '').trim();

            const editId = val('musicSongEditId');
            const payload = {
                titulo: val('musicSongTitle'),
                mainArtist: val('musicMainArtist'),
                artistType: val('musicMainArtistType') || 'group',
                collaborators: val('musicCollaborators'),
                albumTitle: val('musicAlbumTitle'),
                albumType: val('musicAlbumType') || 'album',
                albumYear: val('musicAlbumYear'),
                trackNumber: val('musicSongTrackNumber'),
                idioma: val('musicSongLanguage') || 'English',
                ytMusicUrl: val('musicSongYtUrl'),
                estadoEstudio: val('musicStudyStatus') || 'to_study',
                enfoqueCorto: val('musicFocusSummary')
            };

            if (!payload.titulo || !payload.mainArtist) {
                mostrarBannerMusica('musicSongFormBanner', 'err', 'Song title and main artist are required.');
                return;
            }

            mostrarBannerMusica('musicSongFormBanner', '', '');
            const targetUrl = editId ? `/api/english/music/songs/${editId}` : '/api/english/music/songs';
            const method = editId ? 'PUT' : 'POST';

            runWithButtonLock(btnSave, async () => {
                try {
                    const data = await submitMutationRequest({
                        url: targetUrl,
                        method,
                        scopeKey: `english-music:${method}:${editId || 'new'}`,
                        signature: JSON.stringify(payload),
                        buildBody: () => payload,
                        parseJson: true
                    });

                    cancelarEdicionCancionMusica();
                    mostrarBannerMusica('musicSongFormBanner', 'ok', data.message || 'Song metadata saved.');
                    if (data && data.songId) {
                        musicState.selectedSongId = Number(data.songId);
                    }
                    await cargarCatalogoMusical();
                } catch (err) {
                    mostrarBannerMusica('musicSongFormBanner', 'err', err.message || 'Failed to save song.');
                }
            }, { loadingText: editId ? 'Updating...' : 'Saving...' });
        });
    }

    if (wordForm) {
        wordForm.addEventListener('submit', async e => {
            e.preventDefault();
            const btnSend = document.getElementById('btnSendMusicWord');
            const val = id => (document.getElementById(id)?.value || '').trim();
            const lyricsStudy = val('musicStudyLyrics');
            if (!lyricsStudy) {
                mostrarBannerMusica('musicWordStatusBanner', 'err', 'Write your personal song meanings or study lines first.');
                return;
            }

            const selected = getCancionSeleccionada();
            const fallbackTitle = val('musicSongTitle');
            const fallbackArtist = val('musicMainArtist');

            if (!selected && (!fallbackTitle || !fallbackArtist)) {
                mostrarBannerMusica(
                    'musicWordStatusBanner',
                    'err',
                    'Select a song from the catalog (click "Study -> Word") or fill Song Title + Main Artist above.'
                );
                return;
            }

            const llaveTexto = await solicitarLlaveE2EEAsync();
            if (!llaveTexto) return;

            const entry = selected
                ? {
                    category: 'music',
                    language: selected.idioma || 'English',
                    song_title: selected.titulo,
                    artists_display: formatSongArtistsSummary(selected),
                    album_title: selected.album_titulo || '',
                    album_type: RELEASE_TYPE_LABELS[selected.album_tipo] || selected.album_tipo || '',
                    release_year: selected.album_anio ? String(selected.album_anio) : '',
                    yt_music_url: selected.yt_music_url || '',
                    focus_summary: selected.enfoque_corto || '',
                    lyrics_study: lyricsStudy,
                    vocabulary_list: val('musicStudyVocab'),
                    pronunciation_notes: val('musicStudyPronunciation'),
                    notes: val('musicStudyExtraNotes')
                }
                : {
                    category: 'music',
                    language: val('musicSongLanguage') || 'English',
                    song_title: fallbackTitle,
                    artists_display: val('musicCollaborators')
                        ? `${fallbackArtist} (${val('musicCollaborators')})`
                        : fallbackArtist,
                    album_title: val('musicAlbumTitle'),
                    album_type: RELEASE_TYPE_LABELS[val('musicAlbumType')] || val('musicAlbumType'),
                    release_year: val('musicAlbumYear'),
                    yt_music_url: val('musicSongYtUrl'),
                    focus_summary: val('musicFocusSummary'),
                    lyrics_study: lyricsStudy,
                    vocabulary_list: val('musicStudyVocab'),
                    pronunciation_notes: val('musicStudyPronunciation'),
                    notes: val('musicStudyExtraNotes')
                };

            mostrarBannerMusica('musicWordStatusBanner', '', '');

            runWithButtonLock(btnSend, async () => {
                try {
                    const signature = `${entry.song_title}|${entry.artists_display}|${entry.lyrics_study}`;
                    await submitMutationRequest({
                        url: '/api/send-english',
                        method: 'POST',
                        scopeKey: 'english:music-word',
                        signature,
                        buildBody: () => ({ texto: encriptarTextoE2EE(JSON.stringify(entry), llaveTexto) })
                    });

                    if (selected) {
                        const nextStatus = selected.estado_estudio === 'to_study' ? 'in_progress' : selected.estado_estudio;
                        await fetch(`/api/english/music/songs/${selected.id}/status`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ estadoEstudio: nextStatus, wordSynced: true })
                        });
                        await cargarCatalogoMusical();
                    }

                    ['musicStudyLyrics', 'musicStudyVocab', 'musicStudyPronunciation', 'musicStudyExtraNotes'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.value = '';
                    });

                    mostrarBannerMusica(
                        'musicWordStatusBanner',
                        'ok',
                        'Encrypted E2EE & queued! Your PC sync will add this song study breakdown under Section 4 in English_Learning_Notebook.docx.'
                    );
                    showToast('ok', 'Song study notes encrypted & queued for Word!');
                } catch (err) {
                    mostrarBannerMusica('musicWordStatusBanner', 'err', 'Failed to send encrypted notes: ' + err.message);
                    showToast('err', err.message);
                }
            }, { loadingText: 'Encrypting...' });
        });
    }
}

// ==========================================
// WEEKLY PERSONAL AGENDA LOGIC
// ==========================================
const AGENDA_BLOQUES = [
    {
        id: 'manana',
        label: 'Morning',
        defaultHora: '08:00',
        svg: `<svg class="agenda-block-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9z"/>
                <path d="M16 10h2.5a2 2 0 0 1 0 4H16"/>
                <path d="M4 19h13"/>
              </svg>`
    },
    {
        id: 'cole',
        label: 'At School / Classes',
        defaultHora: '10:00',
        svg: `<svg class="agenda-block-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 10l9-5 9 5"/>
                <path d="M5 11v7c2.5-1.2 4.8-1.2 7 0 2.2-1.2 4.5-1.2 7 0v-7"/>
                <path d="M12 11v7"/>
              </svg>`
    },
    {
        id: 'tarde',
        label: 'Afternoon',
        defaultHora: '16:00',
        svg: `<svg class="agenda-block-svg" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4"/>
                <path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
              </svg>`
    },
    {
        id: 'noche',
        label: 'Night',
        defaultHora: '21:00',
        svg: `<svg class="agenda-block-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15.5 5.5a4.5 4.5 0 0 0 4 5.5 5 5 0 1 1-4-5.5z"/>
                <path d="M6 17h9a3 3 0 0 0 0-6 4 4 0 0 0-7.7-1A3 3 0 0 0 6 17z"/>
              </svg>`
    }
];

const AGENDA_DIAS = [
    { key: 'lun', nombre: 'Monday', corto: 'Mon', offset: 0 },
    { key: 'mar', nombre: 'Tuesday', corto: 'Tue', offset: 1 },
    { key: 'mie', nombre: 'Wednesday', corto: 'Wed', offset: 2 },
    { key: 'jue', nombre: 'Thursday', corto: 'Thu', offset: 3 },
    { key: 'vie', nombre: 'Friday', corto: 'Fri', offset: 4 },
    { key: 'sab', nombre: 'Saturday', corto: 'Sat', offset: 5 },
    { key: 'dom', nombre: 'Sunday', corto: 'Sun', offset: 6 }
];

const agendaState = {
    weekOffset: 0,
    showWeekend: true,
    layoutMode: window.innerWidth <= 820 ? 'day' : 'grid',
    manualLayoutOverride: false,
    selectedDate: formatLocalDate(new Date()),
    filterCategory: 'all',
    filterType: 'all',
    items: []
};

function matchesAgendaFilters(item) {
    const cat = item.categoria === 'universidad' ? 'universidad' : 'personal';
    const tipo = item.tipo === 'tarea' ? 'tarea' : 'evento';
    if (agendaState.filterCategory !== 'all' && cat !== agendaState.filterCategory) return false;
    if (agendaState.filterType !== 'all' && tipo !== agendaState.filterType) return false;
    return true;
}

function appendCategorizedAgendaItems(container, listItems) {
    const uniItems = listItems.filter(i => (i.categoria || 'personal') === 'universidad');
    const personalItems = listItems.filter(i => (i.categoria || 'personal') !== 'universidad');

    if (agendaState.filterCategory === 'all' && listItems.length > 0) {
        if (uniItems.length > 0) {
            const uniHead = document.createElement('div');
            uniHead.className = 'agenda-cat-divider is-uni';
            uniHead.textContent = `🎓 University (${uniItems.length})`;
            container.appendChild(uniHead);
            uniItems.forEach(item => container.appendChild(crearElementoActividad(item)));
        }
        if (personalItems.length > 0) {
            const perHead = document.createElement('div');
            perHead.className = 'agenda-cat-divider is-personal';
            perHead.textContent = `👤 Personal (${personalItems.length})`;
            container.appendChild(perHead);
            personalItems.forEach(item => container.appendChild(crearElementoActividad(item)));
        }
        return;
    }

    listItems.forEach(item => container.appendChild(crearElementoActividad(item)));
}

function getMondayOfOffset(offsetWeeks) {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday + (offsetWeeks * 7));
}

function getVisibleAgendaDays() {
    const monday = getMondayOfOffset(agendaState.weekOffset);
    const list = agendaState.showWeekend ? AGENDA_DIAS : AGENDA_DIAS.slice(0, 5);
    return list.map(d => {
        const dateObj = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + d.offset);
        return {
            ...d,
            fecha: formatLocalDate(dateObj),
            dateObj
        };
    });
}

function crearElementoActividad(item) {
    const tipo = item.tipo === 'tarea' ? 'tarea' : 'evento';
    const categoria = item.categoria === 'universidad' ? 'universidad' : 'personal';
    const estado = getAgendaItemStatus(item);
    const isDone = estado === 'done';

    const row = document.createElement('div');
    row.className = `agenda-item${isDone ? ' is-done' : ''}`;

    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = `agenda-check-circle status-${estado}`;
    const checkLabels = {
        todo: 'To Do — click to mark In Progress',
        in_progress: 'In Progress — click to mark Done',
        done: 'Done — click to reset to To Do'
    };
    checkBtn.title = checkLabels[estado] || 'Toggle workflow status';
    checkBtn.setAttribute('aria-label', checkLabels[estado] || 'Toggle workflow status');
    checkBtn.textContent = estado === 'done' ? '✓' : estado === 'in_progress' ? '◐' : '';

    const topRow = document.createElement('div');
    topRow.className = 'agenda-item-top';

    const topLeft = document.createElement('div');
    topLeft.className = 'agenda-item-top-left';

    const content = document.createElement('div');
    content.className = 'agenda-item-content';

    const metaRow = document.createElement('div');
    metaRow.className = 'agenda-item-meta-row';

    const timePill = document.createElement('span');
    timePill.className = 'agenda-time-pill';
    timePill.textContent = item.hora;

    const catPill = document.createElement('span');
    catPill.className = `agenda-cat-pill ${categoria === 'universidad' ? 'is-uni' : 'is-personal'}`;
    catPill.textContent = categoria === 'universidad' ? '🎓 Uni' : '👤 Personal';

    const typePill = document.createElement('span');
    typePill.className = 'agenda-type-pill';
    typePill.textContent = tipo === 'tarea' ? 'Task' : 'Event';

    metaRow.append(catPill, typePill);

    const parsedParts = splitAgendaActividadClient(item.actividad, item.titulo, item.descripcion);

    const text = document.createElement('span');
    text.className = 'agenda-item-text';
    text.textContent = parsedParts.titulo || item.actividad;

    const descEl = parsedParts.descripcion ? document.createElement('span') : null;
    if (descEl) {
        descEl.className = 'agenda-item-desc';
        descEl.textContent = parsedParts.descripcion;
    }

    const jiraRow = document.createElement('div');
    jiraRow.className = 'jira-status-row';

    const statusSelect = document.createElement('select');
    statusSelect.className = `jira-status-select status-${estado}`;
    statusSelect.setAttribute('aria-label', 'Workflow status (Jira)');
    [
        { value: 'todo', label: 'To Do' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'done', label: 'Done' }
    ].forEach(optDef => {
        const opt = document.createElement('option');
        opt.value = optDef.value;
        opt.textContent = optDef.label;
        statusSelect.appendChild(opt);
    });
    statusSelect.value = estado;

    jiraRow.appendChild(statusSelect);
    if (descEl) {
        content.append(metaRow, text, descEl, jiraRow);
    } else {
        content.append(metaRow, text, jiraRow);
    }

    const actions = document.createElement('div');
    actions.className = 'agenda-item-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'agenda-mini-btn';
    editBtn.title = 'Edit activity';
    editBtn.setAttribute('aria-label', 'Edit activity');
    editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    editBtn.addEventListener('click', () => abrirAgendaModal(item));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'agenda-mini-btn';
    delBtn.title = 'Delete activity';
    delBtn.setAttribute('aria-label', 'Delete activity');
    delBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';

    const uiRefs = { row, checkBtn, statusSelect, editBtn, delBtn };
    checkBtn.addEventListener('click', () => toggleAgendaItem(item, uiRefs, nextAgendaStatus(getAgendaItemStatus(item))));
    statusSelect.addEventListener('change', () => toggleAgendaItem(item, uiRefs, statusSelect.value));
    delBtn.addEventListener('click', () => eliminarAgendaItem(item.id, uiRefs));

    actions.append(editBtn, delBtn);
    topLeft.append(checkBtn, timePill);
    topRow.append(topLeft, actions);
    row.append(topRow, content);
    return row;
}

function renderAgendaBoard() {
    const weekBoard = document.getElementById('agendaWeekBoard');
    const dayTabs = document.getElementById('agendaDayTabs');
    const dayBoard = document.getElementById('agendaDayBoard');
    const tableScroll = document.getElementById('agendaTableScroll');
    const weekLabel = document.getElementById('agendaWeekLabel');
    const weekStats = document.getElementById('agendaWeekStats');
    const btnToggleWeekend = document.getElementById('btnToggleWeekend');
    const btnToggleLayout = document.getElementById('btnToggleAgendaLayout');

    if (!weekBoard || !dayTabs || !dayBoard || !tableScroll) return;

    document.querySelectorAll('#agendaCategoryFilters .agenda-filter-pill[data-agenda-cat]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-agenda-cat') === agendaState.filterCategory);
    });
    document.querySelectorAll('#agendaTypeFilters .agenda-filter-pill[data-agenda-type]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-agenda-type') === agendaState.filterType);
    });

    const diasVisibles = getVisibleAgendaDays();
    const hoyStr = formatLocalDate(new Date());

    if (!diasVisibles.some(d => d.fecha === agendaState.selectedDate)) {
        const todayInWeek = diasVisibles.find(d => d.fecha === hoyStr);
        agendaState.selectedDate = todayInWeek ? todayInWeek.fecha : diasVisibles[0].fecha;
    }

    const firstDate = diasVisibles[0].dateObj;
    const lastDate = diasVisibles[diasVisibles.length - 1].dateObj;
    if (weekLabel) {
        const f1 = firstDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
        const f2 = lastDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
        weekLabel.textContent = `${f1} - ${f2}`;
    }

    const visibleDatesSet = new Set(diasVisibles.map(d => d.fecha));
    const filteredItems = agendaState.items.filter(matchesAgendaFilters);
    const visibleItems = filteredItems.filter(i => visibleDatesSet.has(i.fecha));
    const doneCount = visibleItems.filter(i => getAgendaItemStatus(i) === 'done').length;
    const inProgCount = visibleItems.filter(i => getAgendaItemStatus(i) === 'in_progress').length;
    const todoCount = visibleItems.length - doneCount - inProgCount;
    const uniCount = visibleItems.filter(i => (i.categoria || 'personal') === 'universidad').length;
    const perCount = visibleItems.length - uniCount;

    if (weekStats) {
        weekStats.textContent = visibleItems.length
            ? `${doneCount} Done · ${inProgCount} In Progress · ${todoCount} To Do (${uniCount} University · ${perCount} Personal)`
            : 'Organize University & Personal events and Jira-style tasks';
    }

    if (btnToggleWeekend) {
        btnToggleWeekend.textContent = agendaState.showWeekend ? 'Mon - Fri Only' : 'Show Mon - Sun';
        btnToggleWeekend.classList.toggle('active', !agendaState.showWeekend);
    }

    if (btnToggleLayout) {
        btnToggleLayout.textContent = agendaState.layoutMode === 'day' ? 'Grid View' : 'Day View';
    }

    const isDayLayout = agendaState.layoutMode === 'day';
    dayTabs.hidden = !isDayLayout;
    dayBoard.hidden = !isDayLayout;
    tableScroll.hidden = isDayLayout;

    const defaultModalCategory = agendaState.filterCategory !== 'all'
        ? agendaState.filterCategory
        : (currentSettings && currentSettings.defaultAgendaCategory && currentSettings.defaultAgendaCategory !== 'all'
            ? currentSettings.defaultAgendaCategory
            : 'personal');
    const defaultModalType = agendaState.filterType !== 'all' ? agendaState.filterType : 'evento';

    // 1. Day View (mobile / focus mode)
    if (isDayLayout) {
        dayTabs.innerHTML = '';
        diasVisibles.forEach(dia => {
            const count = filteredItems.filter(i => i.fecha === dia.fecha).length;
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = `agenda-day-tab day-${dia.key}${dia.fecha === agendaState.selectedDate ? ' active' : ''}`;
            tab.innerHTML = `
                <span class="tab-day">${dia.corto}${dia.fecha === hoyStr ? ' •' : ''}</span>
                <span class="tab-date">${dia.dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                <span class="tab-count">${count}</span>
            `;
            tab.addEventListener('click', () => {
                agendaState.selectedDate = dia.fecha;
                renderAgendaBoard();
            });
            dayTabs.appendChild(tab);
        });

        dayBoard.innerHTML = '';
        const activeDay = diasVisibles.find(d => d.fecha === agendaState.selectedDate) || diasVisibles[0];

        AGENDA_BLOQUES.forEach(bloque => {
            const blockItems = filteredItems.filter(
                i => i.fecha === activeDay.fecha && i.bloque === bloque.id
            );

            const card = document.createElement('div');
            card.className = `agenda-mobile-block-card day-${activeDay.key}`;

            const head = document.createElement('div');
            head.className = 'agenda-mobile-block-head';
            head.innerHTML = `
                <div class="agenda-mobile-block-head-left">
                    ${bloque.svg}
                    <span>${bloque.label}</span>
                </div>
                <span>${blockItems.length}</span>
            `;

            const body = document.createElement('div');
            body.className = 'agenda-mobile-block-body';

            if (!blockItems.length) {
                const empty = document.createElement('p');
                empty.className = 'agenda-empty-block';
                empty.textContent = 'No activities matching active filters';
                body.appendChild(empty);
            } else {
                appendCategorizedAgendaItems(body, blockItems);
            }

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'agenda-cell-add';
            addBtn.textContent = `+ Add to ${bloque.label.toLowerCase()}`;
            addBtn.addEventListener('click', () => abrirAgendaModal({
                fecha: activeDay.fecha,
                bloque: bloque.id,
                hora: bloque.defaultHora,
                categoria: defaultModalCategory,
                tipo: defaultModalType
            }));

            body.appendChild(addBtn);
            card.append(head, body);
            dayBoard.appendChild(card);
        });
        return;
    }

    // 2. Pastel Weekly Grid View
    weekBoard.innerHTML = '';
    weekBoard.style.setProperty('--agenda-cols', String(diasVisibles.length));
    weekBoard.classList.toggle('cols-5', diasVisibles.length === 5);

    const corner = document.createElement('div');
    corner.className = 'agenda-corner-cell';
    corner.textContent = 'Block / Day';
    weekBoard.appendChild(corner);

    diasVisibles.forEach(dia => {
        const header = document.createElement('div');
        header.className = `agenda-day-header day-${dia.key}${dia.fecha === hoyStr ? ' is-today' : ''}`;
        const dateLabel = dia.dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        header.innerHTML = `
            <span class="agenda-day-name">${dia.nombre}</span>
            <span class="agenda-day-date">${dateLabel}${dia.fecha === hoyStr ? ' · Today' : ''}</span>
        `;
        weekBoard.appendChild(header);
    });

    AGENDA_BLOQUES.forEach(bloque => {
        const blockHeader = document.createElement('div');
        blockHeader.className = 'agenda-block-header';
        blockHeader.innerHTML = `
            ${bloque.svg}
            <span class="agenda-block-title">${bloque.label}</span>
        `;
        weekBoard.appendChild(blockHeader);

        diasVisibles.forEach(dia => {
            const cell = document.createElement('div');
            cell.className = `agenda-cell day-${dia.key}`;

            const list = document.createElement('div');
            list.className = 'agenda-items-list';

            const cellItems = filteredItems.filter(
                i => i.fecha === dia.fecha && i.bloque === bloque.id
            );

            appendCategorizedAgendaItems(list, cellItems);

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'agenda-cell-add';
            addBtn.textContent = '+ Add';
            addBtn.addEventListener('click', () => abrirAgendaModal({
                fecha: dia.fecha,
                bloque: bloque.id,
                hora: bloque.defaultHora,
                categoria: defaultModalCategory,
                tipo: defaultModalType
            }));

            cell.append(list, addBtn);
            weekBoard.appendChild(cell);
        });
    });
}

function cargarAgendaSemana() {
    const monday = getMondayOfOffset(agendaState.weekOffset);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const begin = formatLocalDate(monday);
    const end = formatLocalDate(sunday);
    const reqToken = agendaLoadTracker.begin();
    const fetchOpts = reqToken.signal ? { signal: reqToken.signal } : {};

    const diasVisibles = getVisibleAgendaDays();
    const weekLabel = document.getElementById('agendaWeekLabel');
    if (weekLabel && diasVisibles.length > 0) {
        const f1 = diasVisibles[0].dateObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
        const f2 = diasVisibles[diasVisibles.length - 1].dateObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
        weekLabel.textContent = `${f1} - ${f2}`;
    }

    const weekStats = document.getElementById('agendaWeekStats');
    if (weekStats) {
        weekStats.textContent = 'Loading activities...';
    }

    const loadingBanner = document.getElementById('agendaLoadingBanner');
    if (loadingBanner) {
        loadingBanner.replaceChildren(createLoadingBanner('Loading agenda...', 'sm'));
        loadingBanner.hidden = false;
    }

    fetch(`/api/get-agenda?begin=${begin}&end=${end}`, fetchOpts)
        .then(res => {
            if (!res.ok) return res.text().then(t => { throw new Error(t); });
            return res.json();
        })
        .then(items => {
            if (!agendaLoadTracker.isCurrent(reqToken.seq)) return;
            if (loadingBanner) {
                loadingBanner.hidden = true;
                loadingBanner.innerHTML = '';
            }
            agendaState.items = Array.isArray(items) ? items : [];
            renderAgendaBoard();
        })
        .catch(err => {
            if (isAbortError(err) || !agendaLoadTracker.isCurrent(reqToken.seq)) return;
            console.error('Error loading agenda:', err);
            if (loadingBanner) {
                loadingBanner.hidden = true;
                loadingBanner.innerHTML = '';
            }
            agendaState.items = [];
            renderAgendaBoard();
            if (weekStats) {
                weekStats.textContent = 'Could not load agenda (check RegistrosAgenda table in DB).';
            }
        });
}

function toggleAgendaItem(item, ui = {}, targetEstado = null) {
    const prevEstado = getAgendaItemStatus(item);
    const nextEstado = targetEstado && ['todo', 'in_progress', 'done'].includes(targetEstado)
        ? targetEstado
        : nextAgendaStatus(prevEstado);
    const nuevoCompletada = nextEstado === 'done' ? 1 : 0;
    const lockBtn = ui.checkBtn || ui.statusSelect || ui.row || document.createElement('button');

    runWithButtonLock(lockBtn, async () => {
        try {
            await submitMutationRequest({
                url: `/api/toggle-agenda/${item.id}`,
                method: 'PATCH',
                scopeKey: `agenda-toggle:${item.id}`,
                signature: nextEstado,
                buildBody: () => ({ estado: nextEstado, completada: nuevoCompletada }),
                parseJson: true
            });
            item.estado = nextEstado;
            item.completada = nuevoCompletada;
            renderAgendaBoard();
            cargarRecordatoriosActivos();
            showToast('ok', `Activity moved to ${nextEstado === 'done' ? 'Done' : (nextEstado === 'in_progress' ? 'In Progress' : 'To Do')}.`);
        } catch (err) {
            if (ui.statusSelect) ui.statusSelect.value = prevEstado;
            showToast('err', 'Failed to update activity status: ' + err.message);
        }
    }, { extraDisable: [ui.row, ui.checkBtn, ui.statusSelect, ui.editBtn, ui.delBtn] });
}

async function eliminarAgendaItem(id, ui = {}) {
    const ok = await openConfirmDialog({
        title: 'Delete Activity?',
        message: 'Remove this activity permanently from your Weekly Agenda?',
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;

    const lockBtn = ui.delBtn || ui.row || document.createElement('button');
    runWithButtonLock(lockBtn, async () => {
        try {
            await submitMutationRequest({
                url: `/api/delete-agenda/${id}`,
                method: 'DELETE',
                scopeKey: `agenda-delete:${id}`,
                signature: String(id),
                parseJson: true
            });
            agendaState.items = agendaState.items.filter(i => i.id !== id);
            renderAgendaBoard();
            cargarRecordatoriosActivos();
            showToast('ok', 'Activity removed from Weekly Agenda.');
        } catch (err) {
            showToast('err', 'Failed to delete activity: ' + err.message);
        }
    }, { extraDisable: [ui.row, ui.checkBtn, ui.statusSelect, ui.editBtn] });
}

const agendaModal = document.getElementById('agendaModal');
const agendaForm = document.getElementById('agendaForm');

let agendaOriginalSnapshot = null;

function inferAgendaBlockClient(horaStr, categoria = 'personal') {
    const m = /^(\d{2}):(\d{2})/.exec(String(horaStr || '').trim());
    if (!m) return 'manana';
    const hour = Number(m[1]);
    if (categoria === 'universidad' && hour >= 7 && hour < 17) return 'cole';
    if (hour >= 5 && hour < 12) return 'manana';
    if (hour >= 12 && hour < 19) return 'tarde';
    return 'noche';
}

function splitAgendaActividadClient(rawActividad, explicitTitulo = '', explicitDesc = '') {
    const tExp = String(explicitTitulo || '').trim();
    const dExp = String(explicitDesc || '').trim();
    if (tExp) return { titulo: tExp, descripcion: dExp };
    const clean = String(rawActividad || '').trim();
    if (!clean) return { titulo: '', descripcion: '' };
    const sepIdx = clean.indexOf(' — ');
    if (sepIdx > 0) {
        return {
            titulo: clean.slice(0, sepIdx).trim(),
            descripcion: clean.slice(sepIdx + 3).trim()
        };
    }
    return { titulo: clean, descripcion: '' };
}

function composeAgendaActividadClient(titulo, descripcion) {
    const t = String(titulo || '').replace(/\s+/g, ' ').trim();
    const d = String(descripcion || '').replace(/\s+/g, ' ').trim();
    if (!t) return d;
    if (!d) return t;
    return `${t} — ${d}`.slice(0, 255);
}

function syncAgendaBlockFromTimeUI() {
    const horaEl = document.getElementById('agendaHora');
    const catEl = document.getElementById('agendaCategoria');
    const bloqueEl = document.getElementById('agendaBloque');
    const hintEl = document.getElementById('agendaBloqueAutoHint');
    if (!horaEl || !bloqueEl || !horaEl.value) return;
    const autoBlock = inferAgendaBlockClient(horaEl.value, catEl ? catEl.value : 'personal');
    bloqueEl.value = autoBlock;
    if (hintEl) {
        const blockLabels = { manana: '☕ Morning', cole: '🎓 School / University', tarde: '☀️ Afternoon', noche: '🌙 Night' };
        hintEl.textContent = `Auto-selected ${blockLabels[autoBlock] || autoBlock} from ${horaEl.value.slice(0, 5)}`;
    }
}

function abrirAgendaModal(prefill = {}) {
    if (!agendaModal || !agendaForm) return;
    const isEdit = Boolean(prefill.id);

    const now = new Date();
    const defaultDate = agendaState.layoutMode === 'day'
        ? agendaState.selectedDate
        : formatLocalDate(now);
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const resolvedFecha = prefill.fecha || defaultDate;
    const resolvedHora = String(prefill.hora || defaultTime).slice(0, 5);
    const resolvedCategoria = prefill.categoria === 'universidad'
        ? 'universidad'
        : prefill.categoria === 'personal'
            ? 'personal'
            : (agendaState.filterCategory !== 'all' ? agendaState.filterCategory : 'personal');
    const resolvedBloque = prefill.bloque || inferAgendaBlockClient(resolvedHora, resolvedCategoria);
    const splitAct = splitAgendaActividadClient(prefill.actividad, prefill.titulo, prefill.descripcion);
    const resolvedTitulo = splitAct.titulo;
    const resolvedDescripcion = splitAct.descripcion;
    const resolvedActividad = composeAgendaActividadClient(resolvedTitulo, resolvedDescripcion);
    const resolvedTipo = prefill.tipo === 'tarea' ? 'tarea' : 'evento';
    const resolvedEstado = getAgendaItemStatus(prefill);
    const resolvedRemMin = prefill.recordatorio_min !== undefined && prefill.recordatorio_min !== null && prefill.recordatorio_min !== ''
        ? String(prefill.recordatorio_min)
        : '';

    document.getElementById('agendaModalTitle').textContent = isEdit ? 'Edit Activity' : 'New Activity';
    document.getElementById('agendaEditId').value = isEdit ? String(prefill.id) : '';
    document.getElementById('agendaFecha').value = resolvedFecha;
    document.getElementById('agendaBloque').value = resolvedBloque;
    document.getElementById('agendaHora').value = resolvedHora;
    document.getElementById('agendaActividad').value = resolvedTitulo;
    const descInputEl = document.getElementById('agendaDescripcion');
    if (descInputEl) descInputEl.value = resolvedDescripcion;

    const tipoEl = document.getElementById('agendaTipo');
    const catEl = document.getElementById('agendaCategoria');
    const estadoEl = document.getElementById('agendaEstado');
    const remEl = document.getElementById('agendaRecordatorioMin');
    if (tipoEl) tipoEl.value = resolvedTipo;
    if (catEl) catEl.value = resolvedCategoria;
    if (estadoEl) estadoEl.value = resolvedEstado;
    if (remEl) remEl.value = resolvedRemMin;

    agendaOriginalSnapshot = isEdit
        ? {
            fecha: resolvedFecha,
            bloque: resolvedBloque,
            hora: resolvedHora,
            actividad: resolvedActividad.replace(/\s+/g, ' '),
            tipo: resolvedTipo,
            categoria: resolvedCategoria,
            estado: resolvedEstado,
            recordatorio_min: resolvedRemMin
        }
        : null;

    agendaModal.hidden = false;
    setTimeout(() => document.getElementById('agendaActividad').focus(), 40);
}

function cerrarAgendaModal() {
    agendaOriginalSnapshot = null;
    if (agendaModal) agendaModal.hidden = true;
}

if (agendaForm) {
    const btnOpenModal = document.getElementById('btnOpenAgendaModal');
    const btnCloseModal = document.getElementById('btnCloseAgendaModal');
    const btnCancelModal = document.getElementById('btnCancelAgenda');
    const btnPrevWeek = document.getElementById('btnAgendaPrevWeek');
    const btnNextWeek = document.getElementById('btnAgendaNextWeek');
    const btnToday = document.getElementById('btnAgendaToday');
    const btnToggleWeekend = document.getElementById('btnToggleWeekend');
    const btnToggleLayout = document.getElementById('btnToggleAgendaLayout');

    if (btnOpenModal) btnOpenModal.addEventListener('click', () => abrirAgendaModal());
    if (btnCloseModal) btnCloseModal.addEventListener('click', cerrarAgendaModal);
    if (btnCancelModal) btnCancelModal.addEventListener('click', cerrarAgendaModal);

    if (agendaModal) {
        agendaModal.addEventListener('click', (e) => {
            if (e.target === agendaModal) cerrarAgendaModal();
        });
    }

    if (btnPrevWeek) {
        btnPrevWeek.addEventListener('click', () => {
            agendaState.weekOffset -= 1;
            cargarAgendaSemana();
        });
    }

    if (btnNextWeek) {
        btnNextWeek.addEventListener('click', () => {
            agendaState.weekOffset += 1;
            cargarAgendaSemana();
        });
    }

    if (btnToday) {
        btnToday.addEventListener('click', () => {
            agendaState.weekOffset = 0;
            agendaState.selectedDate = formatLocalDate(new Date());
            cargarAgendaSemana();
        });
    }

    if (btnToggleWeekend) {
        btnToggleWeekend.addEventListener('click', () => {
            agendaState.showWeekend = !agendaState.showWeekend;
            renderAgendaBoard();
        });
    }

    if (btnToggleLayout) {
        btnToggleLayout.addEventListener('click', () => {
            agendaState.manualLayoutOverride = true;
            agendaState.layoutMode = agendaState.layoutMode === 'day' ? 'grid' : 'day';
            renderAgendaBoard();
        });
    }

    if (window.matchMedia) {
        const agendaMq = window.matchMedia('(max-width: 820px)');
        const onAgendaViewportChange = (ev) => {
            const pref = currentSettings && currentSettings.defaultAgendaLayout;
            if (agendaState.manualLayoutOverride || pref === 'grid' || pref === 'day') return;
            const target = ev.matches ? 'day' : 'grid';
            if (agendaState.layoutMode !== target) {
                agendaState.layoutMode = target;
                renderAgendaBoard();
            }
        };
        if (typeof agendaMq.addEventListener === 'function') {
            agendaMq.addEventListener('change', onAgendaViewportChange);
        } else if (typeof agendaMq.addListener === 'function') {
            agendaMq.addListener(onAgendaViewportChange);
        }
    }

    document.querySelectorAll('#agendaCategoryFilters .agenda-filter-pill[data-agenda-cat]').forEach(btn => {
        btn.addEventListener('click', () => {
            agendaState.filterCategory = btn.getAttribute('data-agenda-cat') || 'all';
            renderAgendaBoard();
        });
    });

    document.querySelectorAll('#agendaTypeFilters .agenda-filter-pill[data-agenda-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            agendaState.filterType = btn.getAttribute('data-agenda-type') || 'all';
            renderAgendaBoard();
        });
    });

    document.querySelectorAll('#agendaSuggestions .suggestion-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const input = document.getElementById('agendaActividad');
            if (input) {
                input.value = chip.getAttribute('data-text') || '';
                input.focus();
                input.dispatchEvent(new Event('input'));
            }
        });
    });

    const agendaHoraInput = document.getElementById('agendaHora');
    const agendaCatInput = document.getElementById('agendaCategoria');
    if (agendaHoraInput) {
        agendaHoraInput.addEventListener('change', syncAgendaBlockFromTimeUI);
        agendaHoraInput.addEventListener('input', syncAgendaBlockFromTimeUI);
    }
    if (agendaCatInput) {
        agendaCatInput.addEventListener('change', syncAgendaBlockFromTimeUI);
    }

    agendaForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const btnSave = document.getElementById('btnSaveAgenda');
        if (!btnSave || busyActionElements.has(btnSave) || btnSave.disabled) return;

        const editId = document.getElementById('agendaEditId').value;
        const tipoVal = document.getElementById('agendaTipo')?.value || 'evento';
        const catVal = document.getElementById('agendaCategoria')?.value || 'personal';
        const estadoVal = document.getElementById('agendaEstado')?.value || 'todo';
        const remRaw = document.getElementById('agendaRecordatorioMin')?.value ?? '';
        const remVal = remRaw === '' ? null : Number(remRaw);
        const tituloRaw = document.getElementById('agendaActividad')?.value || '';
        const descRaw = document.getElementById('agendaDescripcion')?.value || '';
        const composedAct = composeAgendaActividadClient(tituloRaw, descRaw);
        const horaClean = String(document.getElementById('agendaHora').value || '').slice(0, 5);
        const bloqueVal = document.getElementById('agendaBloque').value || inferAgendaBlockClient(horaClean, catVal);

        const payload = {
            fecha: document.getElementById('agendaFecha').value,
            bloque: bloqueVal,
            hora: horaClean,
            titulo: tituloRaw.replace(/\s+/g, ' ').trim(),
            descripcion: descRaw.replace(/\s+/g, ' ').trim(),
            actividad: composedAct,
            tipo: tipoVal,
            categoria: catVal,
            estado: estadoVal,
            recordatorio_min: remVal
        };

        if (!payload.fecha || !payload.bloque || !payload.hora || !payload.actividad) {
            showToast('err', 'Please fill in all activity fields.');
            return;
        }

        if (
            editId &&
            agendaOriginalSnapshot &&
            payload.fecha === agendaOriginalSnapshot.fecha &&
            payload.bloque === agendaOriginalSnapshot.bloque &&
            payload.hora === String(agendaOriginalSnapshot.hora || '').slice(0, 5) &&
            payload.actividad === agendaOriginalSnapshot.actividad &&
            payload.tipo === agendaOriginalSnapshot.tipo &&
            payload.categoria === agendaOriginalSnapshot.categoria &&
            payload.estado === agendaOriginalSnapshot.estado &&
            remRaw === agendaOriginalSnapshot.recordatorio_min
        ) {
            cerrarAgendaModal();
            return;
        }

        const duplicateExists = agendaState.items.some(item =>
            String(item.id) !== String(editId || '') &&
            item.fecha === payload.fecha &&
            item.bloque === payload.bloque &&
            String(item.hora || '').slice(0, 5) === payload.hora &&
            (item.tipo || 'evento') === payload.tipo &&
            (item.categoria || 'personal') === payload.categoria &&
            String(item.actividad || '').trim().toLowerCase().replace(/\s+/g, ' ') === payload.actividad.toLowerCase()
        );
        if (duplicateExists) {
            showToast('err', 'This exact activity is already scheduled for that date, category, block, and time.');
            return;
        }

        const url = editId ? `/api/update-agenda/${editId}` : '/api/insert-agenda';
        const method = editId ? 'PUT' : 'POST';
        const scopeKey = editId ? `agenda-edit:${editId}` : 'agenda-create';

        runWithButtonLock(btnSave, async () => {
            try {
                await submitMutationRequest({
                    url,
                    method,
                    scopeKey,
                    signature: JSON.stringify(payload),
                    buildBody: () => payload,
                    parseJson: true
                });
                agendaState.selectedDate = payload.fecha;
                cerrarAgendaModal();
                cargarAgendaSemana();
                cargarRecordatoriosActivos();
                showToast('ok', editId ? 'Activity updated!' : 'Activity added to your week!');
            } catch (err) {
                showToast('err', 'Error: ' + err.message);
            }
        }, { loadingText: 'Saving...' });
    });
}

// ==========================================
// AUTHENTICATION, ROLES, SESSION & PSYCHIATRIST ACCESS
// ==========================================
let pendingMfaState = { token: '', email: '' };

function validateEmailClient(email) {
    return typeof email === 'string' && email.length <= 150 && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}

function validatePasswordFormatClient(password) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        return 'Password must be between 8 and 128 characters long.';
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        return 'Password must include at least one letter and one number.';
    }
    return null;
}

function hideBootScreen() {
    const bootScreen = document.getElementById('appBootScreen');
    if (bootScreen) bootScreen.hidden = true;
}

function showAuthForm(formId, subtitleText) {
    ['authLoginForm', 'authRegisterForm', 'authForgotForm', 'authResetForm', 'authMfaForm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.hidden = id !== formId;
    });
    const sub = document.getElementById('authSubtitle');
    if (sub && subtitleText) sub.textContent = subtitleText;
    setInlineBanner('authStatusBanner', '', '');
    resetPasswordToggles();
}

function showAuthScreen(defaultForm = 'authLoginForm') {
    currentUser = null;
    pendingMfaState = { token: '', email: '' };
    if (sundayWatcherInterval) {
        clearInterval(sundayWatcherInterval);
        sundayWatcherInterval = null;
    }
    if (reminderPollInterval) {
        clearInterval(reminderPollInterval);
        reminderPollInterval = null;
    }
    currentSettings = null;
    lastDesktopNotifiedKeys.clear();
    const trayEl = document.getElementById('reminderTray');
    if (trayEl) {
        trayEl.hidden = true;
        trayEl.innerHTML = '';
    }

    const subtitles = {
        authLoginForm: 'Sign in to continue',
        authRegisterForm: 'Verified account registration',
        authForgotForm: 'Email password recovery',
        authResetForm: 'Create your new secure password',
        authMfaForm: 'Two-step email verification'
    };
    showAuthForm(defaultForm, subtitles[defaultForm]);

    if (appShell) appShell.hidden = true;
    hideBootScreen();
    if (authOverlay) authOverlay.hidden = false;
}

function programarExpiracionDomingo(expiraEnIso) {
    if (sundayWatcherInterval) clearInterval(sundayWatcherInterval);
    const expiraMs = expiraEnIso ? new Date(expiraEnIso).getTime() : null;

    sundayWatcherInterval = setInterval(() => {
        const ahora = new Date();
        const vencioToken = expiraMs && Date.now() >= expiraMs;
        const esDomingoMedianoche = ahora.getDay() === 0 && ahora.getHours() === 0 && ahora.getMinutes() === 0;

        if (vencioToken || esDomingoMedianoche) {
            clearInterval(sundayWatcherInterval);
            sundayWatcherInterval = null;
            fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
                showAuthScreen('authLoginForm');
                setInlineBanner('authStatusBanner', 'info', 'Your weekly session closed automatically (Sunday 00:00). Please sign in again.');
            });
        }
    }, 30000);
}

function enterAppSession(user) {
    currentUser = user;
    resetPasswordToggles();

    const isPsiquiatra = user.rol === 'psiquiatra';

    const userNameEl = document.getElementById('sidebarUserName');
    const userEmailEl = document.getElementById('sidebarUserEmail');
    const roleLabelEl = document.getElementById('sidebarRoleLabel');
    const readonlyBanner = document.getElementById('medicoReadonlyBanner');

    if (userNameEl) userNameEl.textContent = user.nombre;
    if (userEmailEl) userEmailEl.textContent = user.email;
    if (roleLabelEl) {
        roleLabelEl.textContent = isPsiquiatra ? 'Psychiatrist Mode (Read-Only)' : 'Owner (Admin)';
    }

    document.querySelectorAll('.admin-only-nav').forEach(el => {
        el.hidden = isPsiquiatra;
    });
    if (readonlyBanner) {
        readonlyBanner.hidden = !isPsiquiatra;
    }

    actualizarCabecerasDeFecha();
    programarExpiracionDomingo(user.expira_en);

    if (isPsiquiatra) {
        showView('resumen', true);
    } else {
        fetch('/api/settings', { cache: 'no-store' })
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                if (data && data.settings) {
                    aplicarSettingsEnEstado(data.settings, { syncAgendaDefaults: true });
                    if (data.settings.languageMemory && typeof updateAiMemoryBadgeUI === 'function') {
                        updateAiMemoryBadgeUI(data.settings.languageMemory);
                    }
                }
            })
            .catch(() => {});

        cargarRecordatoriosActivos();
        if (reminderPollInterval) clearInterval(reminderPollInterval);
        reminderPollInterval = setInterval(() => {
            if (currentUser && currentUser.rol === 'admin') {
                cargarRecordatoriosActivos();
            }
        }, 60 * 1000);

        const urlParams = new URLSearchParams(window.location.search);
        const rView = urlParams.get('rView');
        const shouldCaptureGps = urlParams.get('captureGps') === '1';
        const initialHash = window.location.hash.replace('#', '');
        if (rView && VALID_VIEWS.has(rView)) {
            openReminderTarget({
                targetView: rView,
                targetDate: urlParams.get('rDate') || '',
                targetMoment: urlParams.get('rMoment') || '',
                targetTime: urlParams.get('rTime') || '',
                targetBlock: urlParams.get('rBlock') || '',
                targetTab: urlParams.get('rTab') || '',
                refId: urlParams.get('rRef') || null
            });
            history.replaceState(null, '', `${window.location.pathname}#${rView}`);
            if (shouldCaptureGps && currentUser?.rol === 'admin') {
                setTimeout(() => triggerSmartGpsCapture('current'), 450);
            }
        } else if (shouldCaptureGps && currentUser?.rol === 'admin') {
            openReminderTarget({ targetView: 'horario', targetTab: 'locations' });
            history.replaceState(null, '', `${window.location.pathname}#horario`);
            setTimeout(() => triggerSmartGpsCapture('current'), 450);
        } else {
            const startView = VALID_VIEWS.has(initialHash) ? initialHash : 'inicio';
            showView(startView, false);
        }
    }

    hideBootScreen();
    if (authOverlay) authOverlay.hidden = true;
    if (appShell) appShell.hidden = false;
}

function cargarMedicos() {
    const container = document.getElementById('medicosList');
    if (!container || !currentUser || currentUser.rol !== 'admin') return;

    container.replaceChildren(createLoadingBanner('Loading psychiatrist accounts...', 'sm'));

    const reqToken = medicosTracker.begin();
    const fetchOpts = reqToken.signal ? { signal: reqToken.signal } : {};

    fetch('/api/auth/medicos', fetchOpts)
        .then(res => {
            if (res.status === 401 || res.status === 403) {
                showAuthScreen('authLoginForm');
                throw new Error('Session no longer authorized');
            }
            return res.ok ? res.json() : Promise.reject(new Error('Could not fetch accounts'));
        })
        .then(medicos => {
            if (!medicosTracker.isCurrent(reqToken.seq)) return;
            container.innerHTML = '';
            if (!Array.isArray(medicos) || medicos.length === 0) {
                container.innerHTML = '<p class="muted-text">You have not created a psychiatrist account yet.</p>';
                return;
            }
            medicos.forEach(m => {
                const row = document.createElement('div');
                row.className = 'medico-item';

                const info = document.createElement('div');
                info.className = 'medico-item-info';
                const nameStrong = document.createElement('strong');
                nameStrong.textContent = m.nombre;
                const emailSpan = document.createElement('span');
                emailSpan.textContent = `${m.email} · Read-only (Sleep & Mood Summary)`;

                const estado = (m.estado || 'activo').toLowerCase();
                const statusBadge = document.createElement('span');
                statusBadge.className = `medico-status-badge ${estado === 'activo' ? 'is-active' : (estado === 'suspendido' ? 'is-suspended' : 'is-inactive')}`;
                statusBadge.textContent = estado === 'activo' ? 'Active' : (estado === 'suspendido' ? 'Suspended' : 'Inactive');

                info.append(nameStrong, emailSpan, statusBadge);

                const actions = document.createElement('div');
                actions.className = 'medico-actions';

                const nextEstado = estado === 'activo' ? 'suspendido' : 'activo';
                const statusBtn = document.createElement('button');
                statusBtn.type = 'button';
                statusBtn.className = 'btn-status-medico';
                statusBtn.textContent = estado === 'activo' ? 'Suspend' : 'Activate';
                statusBtn.addEventListener('click', async () => {
                    const verb = nextEstado === 'suspendido' ? 'Suspend' : 'Reactivate';
                    const ok = await openConfirmDialog({
                        title: `${verb} Account?`,
                        message: `${verb} read-only access for ${m.nombre} (${m.email})?`,
                        confirmText: verb,
                        danger: nextEstado === 'suspendido'
                    });
                    if (!ok) return;
                    runWithButtonLock(statusBtn, async () => {
                        try {
                            await submitMutationRequest({
                                url: `/api/auth/medicos/${m.id}/estado`,
                                method: 'PATCH',
                                scopeKey: `medico-estado:${m.id}`,
                                signature: `${m.id}|${nextEstado}`,
                                buildBody: () => ({ estado: nextEstado }),
                                parseJson: true
                            });
                            showToast('ok', `Account status updated for ${m.nombre}.`);
                            cargarMedicos();
                        } catch (err) {
                            setInlineBanner('medicoStatusBanner', 'err', err.message);
                            showToast('err', err.message);
                        }
                    }, { loadingText: 'Updating...', extraDisable: [delBtn] });
                });

                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'btn-revoke-medico';
                delBtn.textContent = 'Revoke access';
                delBtn.addEventListener('click', async () => {
                    const ok = await openConfirmDialog({
                        title: 'Revoke Access?',
                        message: `Permanently revoke psychiatrist access for ${m.nombre} (${m.email})?`,
                        confirmText: 'Revoke Access',
                        danger: true
                    });
                    if (!ok) return;
                    runWithButtonLock(delBtn, async () => {
                        try {
                            await submitMutationRequest({
                                url: `/api/auth/medicos/${m.id}`,
                                method: 'DELETE',
                                scopeKey: `medico-revoke:${m.id}`,
                                signature: String(m.id),
                                parseJson: true
                            });
                            showToast('ok', `Access revoked for ${m.nombre}.`);
                            cargarMedicos();
                        } catch (err) {
                            setInlineBanner('medicoStatusBanner', 'err', err.message);
                            showToast('err', err.message);
                        }
                    }, { loadingText: 'Revoking...', extraDisable: [statusBtn] });
                });

                actions.append(statusBtn, delBtn);
                row.append(info, actions);
                container.appendChild(row);
            });
        })
        .catch(err => {
            if (isAbortError(err) || !medicosTracker.isCurrent(reqToken.seq)) return;
            container.innerHTML = '<p class="muted-text">Error loading psychiatrist accounts.</p>';
        });
}

const PASSWORD_EYE_OPEN_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const PASSWORD_EYE_OFF_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function setPasswordVisibilityState(input, btn, visible) {
    if (!input || !btn) return;
    input.type = visible ? 'text' : 'password';
    btn.innerHTML = visible ? PASSWORD_EYE_OFF_SVG : PASSWORD_EYE_OPEN_SVG;
    const label = visible ? 'Hide password' : 'Show password';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.setAttribute('aria-pressed', String(visible));
}

function resetPasswordToggles() {
    document.querySelectorAll('.password-toggle-btn[data-toggle-password]').forEach(btn => {
        const input = document.getElementById(btn.getAttribute('data-toggle-password'));
        setPasswordVisibilityState(input, btn, false);
    });
}

function initPasswordToggles() {
    document.querySelectorAll('.password-toggle-btn[data-toggle-password]').forEach(btn => {
        const targetId = btn.getAttribute('data-toggle-password');
        const input = document.getElementById(targetId);
        if (!input) return;

        setPasswordVisibilityState(input, btn, false);
        btn.addEventListener('click', () => {
            const willShow = input.type === 'password';
            setPasswordVisibilityState(input, btn, willShow);
            input.focus();
        });
    });
}

function initAuthHandlers() {
    const btnGoRegister = document.getElementById('linkGoRegister');
    const btnGoForgot = document.getElementById('linkGoForgot');
    const btnBackFromRegister = document.getElementById('linkBackLoginFromReg');
    const btnBackFromForgot = document.getElementById('linkBackLoginFromForgot');
    const btnBackFromReset = document.getElementById('linkBackLoginFromReset');
    const btnBackFromMfa = document.getElementById('linkBackLoginFromMfa');
    const btnSendRegCode = document.getElementById('btnSendRegCode');
    const btnLogout = document.getElementById('btnLogout');

    if (btnGoRegister) {
        btnGoRegister.addEventListener('click', () => showAuthForm('authRegisterForm', 'First-time registration and verification'));
    }
    if (btnGoForgot) {
        btnGoForgot.addEventListener('click', () => showAuthForm('authForgotForm', 'We will email you a password reset link'));
    }
    if (btnBackFromRegister) {
        btnBackFromRegister.addEventListener('click', () => showAuthForm('authLoginForm', 'Sign in to continue'));
    }
    if (btnBackFromForgot) {
        btnBackFromForgot.addEventListener('click', () => showAuthForm('authLoginForm', 'Sign in to continue'));
    }
    if (btnBackFromReset) {
        btnBackFromReset.addEventListener('click', () => {
            history.replaceState(null, '', window.location.pathname);
            showAuthForm('authLoginForm', 'Sign in to continue');
        });
    }
    if (btnBackFromMfa) {
        btnBackFromMfa.addEventListener('click', () => {
            pendingMfaState = { token: '', email: '' };
            const mfaForm = document.getElementById('authMfaForm');
            if (mfaForm) mfaForm.reset();
            showAuthForm('authLoginForm', 'Sign in to continue');
        });
    }

    if (btnSendRegCode) {
        btnSendRegCode.addEventListener('click', () => {
            if (busyActionElements.has(btnSendRegCode) || btnSendRegCode.disabled) return;
            const email = document.getElementById('regEmail').value.trim();
            if (!validateEmailClient(email)) {
                setInlineBanner('authStatusBanner', 'err', 'Please enter a valid email address above first.');
                return;
            }
            setInlineBanner('authStatusBanner', '', '');

            runWithButtonLock(btnSendRegCode, async () => {
                try {
                    const data = await submitMutationRequest({
                        url: '/api/auth/send-register-code',
                        method: 'POST',
                        scopeKey: 'reg-code',
                        signature: email.toLowerCase(),
                        buildBody: () => ({ email }),
                        parseJson: true
                    });
                    setInlineBanner('authStatusBanner', 'ok', data.message);
                } catch (err) {
                    setInlineBanner('authStatusBanner', 'err', err.message);
                }
            }, { loadingText: 'Sending code...' });
        });
    }

    function bindLockedFormSubmit({ formId, btnId, url, loadingText, scopeKey, getSubmission, onSuccess, errorPrefix = '', bannerId = 'authStatusBanner' }) {
        const form = document.getElementById(formId);
        if (!form) return;
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const btn = document.getElementById(btnId);
            if (!btn || busyActionElements.has(btn) || btn.disabled) return;
            setInlineBanner(bannerId, '', '');
            const spec = getSubmission(form);
            if (!spec) return;

            runWithButtonLock(btn, async () => {
                try {
                    const data = await submitMutationRequest({
                        url,
                        method: 'POST',
                        scopeKey,
                        signature: spec.signature,
                        buildBody: () => spec.payload,
                        parseJson: true
                    });
                    onSuccess(data, form, spec.payload);
                } catch (err) {
                    setInlineBanner(bannerId, 'err', `${errorPrefix}${err.message}`);
                }
            }, { loadingText });
        });
    }

    bindLockedFormSubmit({
        formId: 'authLoginForm',
        btnId: 'btnLoginSubmit',
        url: '/api/auth/login',
        loadingText: 'Verifying...',
        scopeKey: 'login',
        getSubmission: () => {
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;
            if (!validateEmailClient(email) || !password) {
                setInlineBanner('authStatusBanner', 'err', 'Please enter a valid email and password.');
                return null;
            }
            return { payload: { email, password }, signature: `${email.toLowerCase()}|${password}` };
        },
        onSuccess: (data, form) => {
            pendingSubmissions.clear();
            form.reset();
            resetPasswordToggles();
            if (data && data.mfaRequired && data.mfaToken) {
                pendingMfaState = { token: data.mfaToken, email: data.email || '' };
                const mfaEmailLabel = document.getElementById('mfaEmailLabel');
                if (mfaEmailLabel) mfaEmailLabel.textContent = pendingMfaState.email || 'your email';
                showAuthForm('authMfaForm', 'Two-step email verification');
                setInlineBanner('authStatusBanner', 'info', 'Verification code sent! Check your inbox.');
                return;
            }
            enterAppSession(data.user);
        }
    });

    bindLockedFormSubmit({
        formId: 'authMfaForm',
        btnId: 'btnMfaSubmit',
        url: '/api/auth/verify-login-mfa',
        loadingText: 'Verifying code...',
        scopeKey: 'mfa-verify',
        getSubmission: () => {
            const code = document.getElementById('mfaCodeInput').value.trim();
            if (!pendingMfaState.token) {
                showAuthForm('authLoginForm', 'Sign in to continue');
                setInlineBanner('authStatusBanner', 'err', 'Your sign-in verification session expired. Please sign in again.');
                return null;
            }
            if (!/^\d{6}$/.test(code)) {
                setInlineBanner('authStatusBanner', 'err', 'Enter the 6-digit verification code from your email.');
                return null;
            }
            return {
                payload: { mfaToken: pendingMfaState.token, code },
                signature: `${pendingMfaState.token}|${code}`
            };
        },
        onSuccess: (data, form) => {
            pendingMfaState = { token: '', email: '' };
            pendingSubmissions.clear();
            form.reset();
            resetPasswordToggles();
            enterAppSession(data.user);
        }
    });

    bindLockedFormSubmit({
        formId: 'authRegisterForm',
        btnId: 'btnRegSubmit',
        url: '/api/auth/register',
        loadingText: 'Validating & creating...',
        scopeKey: 'register',
        getSubmission: () => {
            const payload = {
                nombre: document.getElementById('regNombre').value.trim(),
                email: document.getElementById('regEmail').value.trim(),
                password: document.getElementById('regPassword').value,
                codigoValidacion: document.getElementById('regCodigoValidacion').value.trim()
            };
            if (payload.nombre.length < 2 || payload.nombre.length > 80) {
                setInlineBanner('authStatusBanner', 'err', 'Name must be between 2 and 80 characters.');
                return null;
            }
            if (!validateEmailClient(payload.email)) {
                setInlineBanner('authStatusBanner', 'err', 'Please enter a valid email address.');
                return null;
            }
            const pwErr = validatePasswordFormatClient(payload.password);
            if (pwErr) {
                setInlineBanner('authStatusBanner', 'err', pwErr);
                return null;
            }
            if (!payload.codigoValidacion) {
                setInlineBanner('authStatusBanner', 'err', 'Please enter the verification code or your personal secret key.');
                return null;
            }
            return { payload, signature: payload.email.toLowerCase() };
        },
        onSuccess: (data, form) => {
            pendingSubmissions.clear();
            form.reset();
            resetPasswordToggles();
            showToast('ok', `Welcome, ${data.user.nombre}! Your session stays active until Sunday at 00:00.`);
            enterAppSession(data.user);
        }
    });

    bindLockedFormSubmit({
        formId: 'authForgotForm',
        btnId: 'btnForgotSubmit',
        url: '/api/auth/forgot-password',
        loadingText: 'Sending link...',
        scopeKey: 'forgot',
        errorPrefix: 'Error: ',
        getSubmission: () => {
            const email = document.getElementById('forgotEmail').value.trim();
            if (!validateEmailClient(email)) {
                setInlineBanner('authStatusBanner', 'err', 'Please enter a valid email address.');
                return null;
            }
            return { payload: { email }, signature: email.toLowerCase() };
        },
        onSuccess: (data) => {
            showAuthForm('authLoginForm', 'Sign in to continue');
            setInlineBanner('authStatusBanner', 'ok', data.message);
        }
    });

    bindLockedFormSubmit({
        formId: 'authResetForm',
        btnId: 'btnResetSubmit',
        url: '/api/auth/reset-password',
        loadingText: 'Updating...',
        scopeKey: 'reset',
        errorPrefix: 'Error: ',
        getSubmission: () => {
            const params = new URLSearchParams(window.location.search);
            const token = params.get('resetToken') || '';
            const email = params.get('email') || '';
            const newPassword = document.getElementById('resetNewPassword').value;
            const confirmPassword = document.getElementById('resetConfirmPassword').value;
            const pwErr = validatePasswordFormatClient(newPassword);
            if (pwErr) {
                setInlineBanner('authStatusBanner', 'err', pwErr);
                return null;
            }
            if (newPassword !== confirmPassword) {
                setInlineBanner('authStatusBanner', 'err', 'Passwords do not match.');
                return null;
            }
            return {
                payload: { email, token, newPassword },
                signature: `${email.toLowerCase()}|${token}`
            };
        },
        onSuccess: (data, form) => {
            form.reset();
            resetPasswordToggles();
            history.replaceState(null, '', window.location.pathname);
            showAuthForm('authLoginForm', 'Sign in with your new password');
            setInlineBanner('authStatusBanner', 'ok', data.message);
        }
    });

    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            runWithButtonLock(btnLogout, async () => {
                try {
                    await submitMutationRequest({
                        url: '/api/auth/logout',
                        method: 'POST',
                        scopeKey: 'logout',
                        signature: currentUser ? String(currentUser.id) : 'anon',
                        parseJson: true
                    });
                } catch (_) {
                    // Proceed to clear UI session even on flaky network
                } finally {
                    pendingSubmissions.clear();
                    resetPasswordToggles();
                    setMobileMenuOpen(false);
                    showAuthScreen('authLoginForm');
                }
            }, { loadingText: 'Signing out...' });
        });
    }

    let lastSavedMedicoSignature = '';
    bindLockedFormSubmit({
        formId: 'medicoForm',
        btnId: 'btnSaveMedico',
        url: '/api/auth/create-medico',
        loadingText: 'Saving...',
        scopeKey: 'medico',
        bannerId: 'medicoStatusBanner',
        errorPrefix: 'Error: ',
        getSubmission: () => {
            const payload = {
                nombre: document.getElementById('medicoNombre').value.trim(),
                email: document.getElementById('medicoEmail').value.trim(),
                password: document.getElementById('medicoPassword').value
            };
            if (payload.nombre.length < 2 || payload.nombre.length > 80) {
                setInlineBanner('medicoStatusBanner', 'err', 'Doctor name must be between 2 and 80 characters.');
                return null;
            }
            if (!validateEmailClient(payload.email)) {
                setInlineBanner('medicoStatusBanner', 'err', 'Please enter a valid doctor email address.');
                return null;
            }
            const pwErr = validatePasswordFormatClient(payload.password);
            if (pwErr) {
                setInlineBanner('medicoStatusBanner', 'err', pwErr);
                return null;
            }
            const sig = `${payload.nombre}|${payload.email.toLowerCase()}|${payload.password}`;
            if (sig === lastSavedMedicoSignature) {
                setInlineBanner('medicoStatusBanner', 'info', 'These exact psychiatrist credentials were already saved.');
                return null;
            }
            return { payload, signature: sig };
        },
        onSuccess: (data, form, payload) => {
            lastSavedMedicoSignature = `${payload.nombre}|${payload.email.toLowerCase()}|${payload.password}`;
            setInlineBanner('medicoStatusBanner', 'ok', data.message);
            showToast('ok', data.message);
            form.reset();
            resetPasswordToggles();
            cargarMedicos();
        }
    });
}

// ==========================================
// DARK / LIGHT THEME
// ==========================================
function applyTheme(theme) {
    const resolved = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem('mt_theme', resolved);

    const isDark = resolved === 'dark';
    const authBtn = document.getElementById('btnThemeToggleAuth');
    const mobileBtn = document.getElementById('btnThemeToggleMobile');
    const sidebarBtn = document.getElementById('btnThemeToggleSidebar');
    const settingsBtn = document.getElementById('btnSettingsThemeToggle');

    if (authBtn) {
        authBtn.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
    }
    if (mobileBtn) {
        mobileBtn.textContent = isDark ? '☀️' : '🌙';
        mobileBtn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    }
    if (sidebarBtn) {
        const iconEl = sidebarBtn.querySelector('.theme-icon');
        const labelEl = sidebarBtn.querySelector('.theme-label');
        if (iconEl) iconEl.textContent = isDark ? '☀️' : '🌙';
        if (labelEl) labelEl.textContent = isDark ? 'Light Theme' : 'Dark Theme';
    }
    if (settingsBtn) {
        settingsBtn.textContent = isDark ? '☀️ Switch to Light Theme' : '🌙 Switch to Dark Theme';
    }
}

function initTheme() {
    const savedTheme = localStorage.getItem('mt_theme') || 'dark';
    applyTheme(savedTheme);

    ['btnThemeToggleAuth', 'btnThemeToggleMobile', 'btnThemeToggleSidebar', 'btnSettingsThemeToggle'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
                applyTheme(current === 'dark' ? 'light' : 'dark');
            });
        }
    });
}

// ==========================================
// IN-APP REMINDER TRAY, SNOOZE & PHONE SETTINGS
// ==========================================
function renderReminderTray(data) {
    const tray = document.getElementById('reminderTray');
    if (!tray) return;

    if (!currentUser || currentUser.rol !== 'admin' || !data) {
        tray.hidden = true;
        tray.innerHTML = '';
        return;
    }

    const activeList = Array.isArray(data.active) ? data.active : [];
    const snoozedList = Array.isArray(data.snoozed) ? data.snoozed : [];

    if (activeList.length === 0 && snoozedList.length === 0) {
        tray.hidden = true;
        tray.innerHTML = '';
        return;
    }

    tray.innerHTML = '';
    const viewLabels = {
        mood: 'Log Mood',
        sleep: 'Log Sleep',
        sueno: 'Log Sleep',
        agenda: 'Open Agenda',
        horario: 'Open Schedule',
        journal: 'Open Journal',
        english: 'Open English'
    };

    activeList.forEach(reminder => {
        const card = document.createElement('div');
        card.className = `reminder-card type-${reminder.type || 'general'}`;

        const info = document.createElement('div');
        info.className = 'reminder-card-info';
        if (reminder.targetView) {
            info.style.cursor = 'pointer';
            info.title = 'Click to open and pre-select the date & time block to register';
            info.addEventListener('click', () => openReminderTarget(reminder));
        }

        const titleEl = document.createElement('div');
        titleEl.className = 'reminder-card-title';
        titleEl.textContent = reminder.title || 'Reminder';

        const msgEl = document.createElement('div');
        msgEl.className = 'reminder-card-msg';
        msgEl.textContent = reminder.message || '';

        info.append(titleEl, msgEl);

        const actions = document.createElement('div');
        actions.className = 'reminder-card-actions';

        if (reminder.targetView) {
            const goBtn = document.createElement('button');
            goBtn.type = 'button';
            goBtn.className = 'reminder-btn primary';
            goBtn.textContent = viewLabels[reminder.targetView] || 'Open';
            goBtn.addEventListener('click', () => openReminderTarget(reminder));
            actions.appendChild(goBtn);
        }

        if (reminder.canComplete && reminder.refId) {
            const doneBtn = document.createElement('button');
            doneBtn.type = 'button';
            doneBtn.className = 'reminder-btn done';
            doneBtn.textContent = '✓ Mark Done';
            doneBtn.addEventListener('click', () => completeReminderAgendaItem(reminder, doneBtn));
            actions.appendChild(doneBtn);
        }

        if (reminder.canSnooze) {
            [15, 30, 60].forEach(mins => {
                const snzBtn = document.createElement('button');
                snzBtn.type = 'button';
                snzBtn.className = 'reminder-btn';
                snzBtn.textContent = mins === 60 ? 'Snooze 1h' : `Snooze ${mins}m`;
                snzBtn.title = `Postpone this reminder for ${mins} minutes`;
                snzBtn.addEventListener('click', () => snoozeOrDismissReminder(reminder, 'snooze', mins, snzBtn));
                actions.appendChild(snzBtn);
            });
        }

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'reminder-btn';
        dismissBtn.textContent = 'Dismiss';
        dismissBtn.addEventListener('click', () => snoozeOrDismissReminder(reminder, 'dismiss', 0, dismissBtn));
        actions.appendChild(dismissBtn);

        card.append(info, actions);
        tray.appendChild(card);

        if (
            currentSettings &&
            currentSettings.desktopNotificationsEnabled === true &&
            'Notification' in window &&
            Notification.permission === 'granted' &&
            !lastDesktopNotifiedKeys.has(reminder.key)
        ) {
            lastDesktopNotifiedKeys.add(reminder.key);
            try {
                const n = new Notification(reminder.title || 'Personal Control Hub', {
                    body: reminder.message || '',
                    tag: reminder.key
                });
                n.onclick = () => {
                    window.focus();
                    openReminderTarget(reminder);
                };
            } catch (_) {
                // Ignore browser Notification runtime error
            }
        }
    });

    if (snoozedList.length > 0) {
        const snoozeSummary = document.createElement('div');
        snoozeSummary.className = 'reminder-snoozed-summary';
        const itemsText = snoozedList.slice(0, 3).map(s => {
            const until = s.snoozeUntil
                ? new Date(s.snoozeUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : 'later';
            return `${s.title} (until ${until})`;
        }).join(' · ');
        snoozeSummary.textContent = `⏱️ Postponed (${snoozedList.length}): ${itemsText}`;
        tray.appendChild(snoozeSummary);
    }

    tray.hidden = false;
}

function snoozeOrDismissReminder(reminder, action, minutes, triggerBtn) {
    runWithButtonLock(triggerBtn, async () => {
        try {
            await submitMutationRequest({
                url: '/api/reminders/snooze',
                method: 'POST',
                scopeKey: `reminder-${action}:${reminder.key}`,
                signature: `${action}:${minutes}`,
                buildBody: () => ({
                    key: reminder.key,
                    action,
                    minutes,
                    type: reminder.type,
                    refId: reminder.refId || null,
                    title: reminder.title,
                    message: reminder.message
                }),
                parseJson: true
            });
            cargarRecordatoriosActivos();
        } catch (err) {
            showToast('err', 'Error updating reminder: ' + err.message);
        }
    }, { loadingText: action === 'dismiss' ? 'Dismissing...' : 'Postponing...' });
}

function completeReminderAgendaItem(reminder, triggerBtn) {
    if (!reminder.refId) return;
    runWithButtonLock(triggerBtn, async () => {
        try {
            await submitMutationRequest({
                url: `/api/toggle-agenda/${reminder.refId}`,
                method: 'PATCH',
                scopeKey: `agenda-toggle:${reminder.refId}`,
                signature: 'done',
                buildBody: () => ({ estado: 'done', completada: 1 }),
                parseJson: true
            });
            const found = agendaState.items.find(i => Number(i.id) === Number(reminder.refId));
            if (found) {
                found.estado = 'done';
                found.completada = 1;
                renderAgendaBoard();
            }
            cargarRecordatoriosActivos();
            showToast('ok', 'Task marked as Done.');
        } catch (err) {
            showToast('err', 'Error marking task as Done: ' + err.message);
        }
    }, { loadingText: 'Completing...' });
}

function cargarRecordatoriosActivos() {
    if (!currentUser || currentUser.rol !== 'admin') return;
    const reqToken = remindersTracker.begin();
    const fetchOpts = reqToken.signal ? { signal: reqToken.signal } : {};

    fetch('/api/reminders/active', fetchOpts)
        .then(res => (res.ok ? res.json() : Promise.reject(new Error('Failed to load reminders'))))
        .then(data => {
            if (!remindersTracker.isCurrent(reqToken.seq)) return;
            renderReminderTray(data);
        })
        .catch(err => {
            if (!isAbortError(err)) {
                console.warn('Reminder check skipped:', err.message);
            }
        });
}

function aplicarSettingsEnEstado(settings, { syncAgendaDefaults = false } = {}) {
    if (!settings) return;
    currentSettings = settings;

    if (typeof updateYouTubePlatformUI === 'function') {
        updateYouTubePlatformUI();
    }

    if (syncAgendaDefaults) {
        if (settings.defaultAgendaCategory) {
            agendaState.filterCategory = settings.defaultAgendaCategory;
        }
        if (settings.defaultAgendaLayout === 'grid' || settings.defaultAgendaLayout === 'day') {
            agendaState.layoutMode = settings.defaultAgendaLayout;
        } else {
            agendaState.layoutMode = window.innerWidth <= 820 ? 'day' : 'grid';
        }
        if (typeof settings.agendaShowWeekend === 'boolean') {
            agendaState.showWeekend = settings.agendaShowWeekend;
        }
        renderAgendaBoard();
    }
}

function updateE2eeKeyStatusUI() {
    const keyVal = localStorage.getItem('diario_llave_secreta') || '';
    const isReady = keyVal.length === 32;

    const statusEl = document.getElementById('settingsE2eeStatus');
    if (statusEl) {
        statusEl.textContent = isReady
            ? 'Configured on this browser (32-character AES key active).'
            : 'Not set on this browser yet (will be requested when writing Journal or English notes).';
    }

    ['journalE2eePill', 'englishE2eePill'].forEach(pillId => {
        const pill = document.getElementById(pillId);
        if (!pill) return;
        pill.classList.toggle('is-ready', isReady);
        pill.classList.toggle('is-missing', !isReady);
        pill.textContent = isReady ? '🔐 E2EE Key Ready' : '🔑 Set 32-char Key';
    });
}

function setSettingsBanner(type, message) {
    const banner = document.getElementById('settingsStatusBanner');
    if (!banner) return;
    if (!message) {
        banner.hidden = true;
        banner.textContent = '';
        banner.className = 'english-status-banner';
        return;
    }
    banner.className = `english-status-banner ${type === 'err' ? 'err' : 'ok'}`;
    banner.textContent = message;
    banner.hidden = false;
}

function populateSettingsForm(settings = {}) {
    const setCheck = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = Boolean(val);
    };
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val !== undefined && val !== null) el.value = String(val);
    };

    setCheck('setPhoneEnabled', settings.phoneNotificationsEnabled);
    setVal('setNtfyTopic', settings.ntfyTopic || '');
    setVal('setNtfyServerUrl', settings.ntfyServerUrl || 'https://ntfy.sh');
    setVal('setNtfyPriority', settings.ntfyPriority ?? 4);
    setVal('setPublicBaseUrl', settings.publicBaseUrl || '');
    setCheck('setDesktopNotify', settings.desktopNotificationsEnabled);

    setCheck('setMoodEnabled', settings.moodRemindersEnabled !== false);
    setCheck('setMoodNotifyPending', settings.moodNotifyPending !== false);
    setCheck('setMoodLateNight', settings.moodIncludeLateNight === true);
    setCheck('setSleepEnabled', settings.sleepReminderEnabled !== false);
    setVal('setSleepTime', settings.sleepReminderTime || '08:30');

    setCheck('setAgendaRemEnabled', settings.agendaRemindersEnabled !== false);
    setCheck('setAgendaEvents', settings.agendaNotifyEvents !== false);
    setCheck('setAgendaTasks', settings.agendaNotifyTasks !== false);
    setCheck('setAgendaNotifyPendingTasks', settings.agendaNotifyPendingTasks !== false);
    setVal('setAgendaLeadMin', settings.agendaLeadMinutes ?? 10);

    setCheck('setWordEodEnabled', settings.wordEodReminderEnabled !== false);
    setVal('setWordEodTime', settings.wordEodReminderTime || '21:30');

    setCheck('setEnglishEnabled', settings.englishReminderEnabled === true);
    setVal('setEnglishTime', settings.englishReminderTime || '19:00');
    setVal('setEnglishTopic', settings.englishReminderTopic || '');

    const activeDays = new Set(Array.isArray(settings.englishReminderDays) ? settings.englishReminderDays.map(Number) : [1, 2, 3, 4, 5]);
    document.querySelectorAll('#setEnglishDaysGroup input[type="checkbox"]').forEach(cb => {
        cb.checked = activeDays.has(Number(cb.value));
    });

    setVal('setDefaultCat', settings.defaultAgendaCategory || 'all');
    setVal('setDefaultLayout', settings.defaultAgendaLayout || 'auto');
    setVal('setYoutubePlatformMode', getYouTubePlatformMode());
    setVal('setTimezone', settings.timezone || 'America/Monterrey');
    setCheck('setShowWeekend', settings.agendaShowWeekend !== false);

    // Multilingual & Gemini AI preferences
    const prefLang = ['en', 'ko', 'en_ko'].includes(settings.preferredStudyLanguage)
        ? settings.preferredStudyLanguage
        : 'en_ko';
    setVal('setPreferredStudyLang', prefLang);
    const activeModel = String(settings.geminiModel || 'gemini-2.5-flash');
    const presetModels = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];
    const modelSel = document.getElementById('setGeminiModel');
    const customGroup = document.getElementById('setGeminiCustomModelGroup');
    const customInput = document.getElementById('setGeminiCustomModel');
    if (modelSel) {
        if (presetModels.includes(activeModel)) {
            modelSel.value = activeModel;
            if (customGroup) customGroup.hidden = true;
        } else {
            modelSel.value = '__custom__';
            if (customGroup) customGroup.hidden = false;
            if (customInput) customInput.value = activeModel;
        }
    }
    const apiKeyEl = document.getElementById('setGeminiApiKey');
    if (apiKeyEl) {
        apiKeyEl.value = '';
        apiKeyEl.dataset.pendingClear = '0';
    }
    const keyStatusEl = document.getElementById('settingsGeminiKeyStatus');
    if (keyStatusEl) {
        keyStatusEl.textContent = settings.geminiApiKeyConfigured
            ? `Active key: ${settings.geminiApiKeyHint || 'Configured'}`
            : 'No Gemini key saved yet (Instant built-in 0-RAM Korean Romanization & EN/KR analyzer active).';
    }

    updateE2eeKeyStatusUI();
    updateTransportStatusBadges();
}

function collectSettingsFormPayload() {
    const selectedDays = Array.from(document.querySelectorAll('#setEnglishDaysGroup input[type="checkbox"]:checked'))
        .map(cb => Number(cb.value));

    const modelSelVal = document.getElementById('setGeminiModel')?.value || 'gemini-2.5-flash';
    const customModelVal = String(document.getElementById('setGeminiCustomModel')?.value || '').trim();
    const resolvedGeminiModel = modelSelVal === '__custom__'
        ? (customModelVal || 'gemini-2.5-flash')
        : modelSelVal;

    const apiKeyInput = document.getElementById('setGeminiApiKey');
    const typedGeminiKey = String(apiKeyInput?.value || '').trim();
    const pendingClearGeminiKey = apiKeyInput?.dataset?.pendingClear === '1';

    const payload = {
        phoneNotificationsEnabled: Boolean(document.getElementById('setPhoneEnabled')?.checked),
        ntfyTopic: String(document.getElementById('setNtfyTopic')?.value || '').trim(),
        ntfyServerUrl: String(document.getElementById('setNtfyServerUrl')?.value || 'https://ntfy.sh').trim(),
        ntfyPriority: Number(document.getElementById('setNtfyPriority')?.value || 4),
        publicBaseUrl: String(document.getElementById('setPublicBaseUrl')?.value || '').trim(),
        desktopNotificationsEnabled: Boolean(document.getElementById('setDesktopNotify')?.checked),

        moodRemindersEnabled: Boolean(document.getElementById('setMoodEnabled')?.checked),
        moodNotifyPending: Boolean(document.getElementById('setMoodNotifyPending')?.checked),
        moodIncludeLateNight: Boolean(document.getElementById('setMoodLateNight')?.checked),
        sleepReminderEnabled: Boolean(document.getElementById('setSleepEnabled')?.checked),
        sleepReminderTime: String(document.getElementById('setSleepTime')?.value || '08:30').slice(0, 5),

        agendaRemindersEnabled: Boolean(document.getElementById('setAgendaRemEnabled')?.checked),
        agendaNotifyEvents: Boolean(document.getElementById('setAgendaEvents')?.checked),
        agendaNotifyTasks: Boolean(document.getElementById('setAgendaTasks')?.checked),
        agendaNotifyPendingTasks: Boolean(document.getElementById('setAgendaNotifyPendingTasks')?.checked),
        agendaLeadMinutes: Number(document.getElementById('setAgendaLeadMin')?.value ?? 10),

        wordEodReminderEnabled: Boolean(document.getElementById('setWordEodEnabled')?.checked),
        wordEodReminderTime: String(document.getElementById('setWordEodTime')?.value || '21:30').slice(0, 5),

        englishReminderEnabled: Boolean(document.getElementById('setEnglishEnabled')?.checked),
        englishReminderTime: String(document.getElementById('setEnglishTime')?.value || '19:00').slice(0, 5),
        englishReminderDays: selectedDays,
        englishReminderTopic: String(document.getElementById('setEnglishTopic')?.value || '').trim(),

        preferredStudyLanguage: document.getElementById('setPreferredStudyLang')?.value || 'en_ko',
        geminiModel: resolvedGeminiModel,

        defaultAgendaCategory: document.getElementById('setDefaultCat')?.value || 'all',
        defaultAgendaLayout: document.getElementById('setDefaultLayout')?.value || 'auto',
        youtubePlatformMode: document.getElementById('setYoutubePlatformMode')?.value || 'auto',
        timezone: String(document.getElementById('setTimezone')?.value || 'America/Monterrey').trim(),
        agendaShowWeekend: Boolean(document.getElementById('setShowWeekend')?.checked)
    };

    if (pendingClearGeminiKey) {
        payload.clearGeminiApiKey = true;
    } else if (typedGeminiKey) {
        payload.geminiApiKey = typedGeminiKey;
    }

    return payload;
}

function cargarSettingsVista() {
    if (!currentUser || currentUser.rol !== 'admin') return;
    setSettingsBanner('', '');
    updateE2eeKeyStatusUI();

    const loadingBanner = document.getElementById('settingsLoadingBanner');
    if (loadingBanner) {
        loadingBanner.replaceChildren(createLoadingBanner('Loading settings...', 'sm'));
        loadingBanner.hidden = false;
    }

    const reqToken = settingsLoadTracker.begin();
    const fetchOpts = reqToken.signal ? { signal: reqToken.signal } : {};

    fetch('/api/settings', fetchOpts)
        .then(res => (res.ok ? res.json() : Promise.reject(new Error('Could not load settings'))))
        .then(data => {
            if (!settingsLoadTracker.isCurrent(reqToken.seq)) return;
            if (loadingBanner) {
                loadingBanner.hidden = true;
                loadingBanner.innerHTML = '';
            }
            const settings = data && data.settings ? data.settings : {};
            aplicarSettingsEnEstado(settings);
            populateSettingsForm(settings);
        })
        .catch(err => {
            if (isAbortError(err) || !settingsLoadTracker.isCurrent(reqToken.seq)) return;
            if (loadingBanner) {
                loadingBanner.hidden = true;
                loadingBanner.innerHTML = '';
            }
            setSettingsBanner('err', 'Failed to load settings: ' + err.message);
        });
}

async function copyTextToClipboard(text, sourceInput = null) {
    if (window.isSecureContext && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) {
            // Fall back to execCommand below
        }
    }

    // Works reliably on HTTP mobile browsers (e.g. http://EC2-IP:3000)
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.top = '0';
    helper.style.left = '-9999px';
    helper.style.fontSize = '16px';
    helper.style.opacity = '0';
    document.body.appendChild(helper);

    let copied = false;
    try {
        helper.focus({ preventScroll: true });
        helper.select();
        helper.setSelectionRange(0, text.length);
        copied = Boolean(document.execCommand && document.execCommand('copy'));
    } catch (_) {
        copied = false;
    } finally {
        document.body.removeChild(helper);
    }

    if (!copied && sourceInput && typeof sourceInput.focus === 'function') {
        sourceInput.focus();
        if (typeof sourceInput.select === 'function') sourceInput.select();
        if (typeof sourceInput.setSelectionRange === 'function') {
            sourceInput.setSelectionRange(0, text.length);
        }
    }
    return copied;
}

function initSettingsHandlers() {
    const settingsForm = document.getElementById('settingsForm');
    if (!settingsForm) return;

    const btnGenTopic = document.getElementById('btnGenerateNtfyTopic');
    const btnCopyTopic = document.getElementById('btnCopyNtfyTopic');
    const btnTestPush = document.getElementById('btnTestPhonePush');
    const desktopCheck = document.getElementById('setDesktopNotify');
    const btnSetE2ee = document.getElementById('btnSetE2eeKey');
    const btnClearE2ee = document.getElementById('btnClearE2eeKey');
    const btnSaveSettings = document.getElementById('btnSaveSettings');

    if (btnGenTopic) {
        btnGenTopic.addEventListener('click', () => {
            const input = document.getElementById('setNtfyTopic');
            const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
            let suffix = '';
            if (window.crypto && window.crypto.getRandomValues) {
                const bytes = new Uint8Array(12);
                window.crypto.getRandomValues(bytes);
                bytes.forEach(b => { suffix += alphabet[b % alphabet.length]; });
            } else {
                for (let i = 0; i < 12; i += 1) {
                    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
                }
            }
            if (input) {
                input.value = `hub_personal_${suffix}`;
                setSettingsBanner('ok', 'Generated a private topic. Subscribe to it in the ntfy phone app and save settings.');
            }
        });
    }

    if (btnCopyTopic) {
        btnCopyTopic.addEventListener('click', async () => {
            const topicInput = document.getElementById('setNtfyTopic');
            const topic = String(topicInput?.value || '').trim();
            if (!topic) {
                setSettingsBanner('err', 'Enter or generate a topic first before copying.');
                showToast('err', 'Enter or generate a topic first.');
                return;
            }
            const copied = await copyTextToClipboard(topic, topicInput);
            if (copied) {
                const prev = btnCopyTopic.textContent;
                btnCopyTopic.textContent = 'Copied!';
                setSettingsBanner('ok', `Copied "${topic}"! Now paste it into the ntfy app on your phone.`);
                showToast('ok', 'Private ntfy topic copied to clipboard.');
                setTimeout(() => { btnCopyTopic.textContent = prev; }, 1600);
            } else {
                setSettingsBanner('info', `Tap Copy in your keyboard bar to copy: ${topic}`);
                showToast('info', 'Select "Copy" on the highlighted topic field.');
            }
        });
    }

    if (desktopCheck) {
        desktopCheck.addEventListener('change', () => {
            if (desktopCheck.checked && 'Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission().then(perm => {
                    if (perm === 'denied') {
                        desktopCheck.checked = false;
                        setSettingsBanner('err', 'Browser denied desktop notifications. Phone notifications remain independent via ntfy.');
                    }
                }).catch(() => {});
            }
        });
    }

    if (btnTestPush) {
        btnTestPush.addEventListener('click', () => {
            const payload = collectSettingsFormPayload();
            if (!payload.phoneNotificationsEnabled || !payload.ntfyTopic) {
                const msg = 'Enable phone notifications and set a private ntfy topic (8+ chars) first.';
                setSettingsBanner('err', msg);
                showToast('err', msg);
                return;
            }
            runWithButtonLock(btnTestPush, async () => {
                try {
                    const saved = await submitMutationRequest({
                        url: '/api/settings',
                        method: 'PUT',
                        scopeKey: 'settings-save-before-test',
                        signature: JSON.stringify(payload),
                        buildBody: () => payload,
                        parseJson: true
                    });
                    if (saved && saved.settings) {
                        aplicarSettingsEnEstado(saved.settings, { syncAgendaDefaults: true });
                    }
                    const resData = await submitMutationRequest({
                        url: '/api/settings/test-notification',
                        method: 'POST',
                        scopeKey: 'settings-test-push',
                        signature: String(Date.now()),
                        buildBody: () => ({}),
                        parseJson: true
                    });
                    setSettingsBanner('ok', resData.message || 'Test push notification sent to your phone!');
                    showToast('ok', 'Test notification sent to your phone!');
                } catch (err) {
                    const errMsg = 'Failed to send test push: ' + err.message;
                    setSettingsBanner('err', errMsg);
                    showToast('err', errMsg);
                }
            }, { loadingText: 'Sending...' });
        });
    }

    if (btnSetE2ee) {
        btnSetE2ee.addEventListener('click', async () => {
            const updatedKey = await solicitarLlaveE2EEAsync({ forceEdit: true });
            if (updatedKey) {
                setSettingsBanner('ok', 'E2EE secret key updated on this browser.');
            }
        });
    }

    if (btnClearE2ee) {
        btnClearE2ee.addEventListener('click', async () => {
            const ok = await openConfirmDialog({
                title: 'Clear Local E2EE Key?',
                message: 'Remove the 32-character E2EE key from this browser? You can re-enter it later when writing encrypted notes.',
                confirmText: 'Clear Key',
                danger: true
            });
            if (!ok) return;
            localStorage.removeItem('diario_llave_secreta');
            updateE2eeKeyStatusUI();
            setSettingsBanner('ok', 'Local E2EE key cleared from this browser.');
            showToast('info', 'Local E2EE key removed from this browser.');
        });
    }

    const geminiModelSelect = document.getElementById('setGeminiModel');
    const geminiCustomGroup = document.getElementById('setGeminiCustomModelGroup');
    if (geminiModelSelect && geminiCustomGroup) {
        geminiModelSelect.addEventListener('change', () => {
            geminiCustomGroup.hidden = geminiModelSelect.value !== '__custom__';
        });
    }

    const btnClearGemini = document.getElementById('btnClearGeminiKey');
    if (btnClearGemini) {
        btnClearGemini.addEventListener('click', () => {
            const keyInput = document.getElementById('setGeminiApiKey');
            const keyStatus = document.getElementById('settingsGeminiKeyStatus');
            if (keyInput) {
                keyInput.value = '';
                keyInput.dataset.pendingClear = '1';
            }
            if (keyStatus) {
                keyStatus.textContent = 'Key marked for removal—click "Save All Settings" to confirm.';
            }
        });
    }

    const btnRotateTransport = document.getElementById('btnTransportRotateKey');
    if (btnRotateTransport) {
        btnRotateTransport.addEventListener('click', () => {
            if (!clientTransportTunnel || !rawBrowserFetch) {
                showToast('err', 'Encrypted transport tunnel is unavailable.');
                return;
            }
            runWithButtonLock(btnRotateTransport, async () => {
                clientTransportTunnel.resetSession();
                await clientTransportTunnel.establishSession(rawBrowserFetch, true);
                updateTransportStatusBadges();
                const diag = clientTransportTunnel.getDiagnostics();
                showToast('ok', `Rotated ephemeral X25519 keys -> new session ${diag.kid.slice(0, 8)}…`);
            }, { loadingText: 'Rotating X25519...' });
        });
    }

    const btnInspectWire = document.getElementById('btnTransportInspectPacket');
    const transportResultBox = document.getElementById('transportBenchmarkResult');
    if (btnInspectWire && transportResultBox) {
        btnInspectWire.addEventListener('click', () => {
            transportResultBox.hidden = false;
            transportResultBox.replaceChildren();
            const heading = document.createElement('strong');
            heading.textContent = '🔍 Live Wire Packet Capture (What HTTP / tcpdump / Wireshark sees on port 3000):';
            transportResultBox.appendChild(heading);

            if (!lastCapturedWirePacket) {
                const p = document.createElement('p');
                p.className = 'muted-text';
                p.textContent = 'No encrypted packet captured yet—click "Benchmark Large Payloads" or save any form.';
                transportResultBox.appendChild(p);
                return;
            }

            const meta = document.createElement('p');
            meta.className = 'muted-text';
            meta.textContent = `${lastCapturedWirePacket.direction} · ${lastCapturedWirePacket.endpoint} · ${lastCapturedWirePacket.capturedAt}`;
            const pre = document.createElement('pre');
            pre.className = 'transport-wire-preview';
            pre.textContent = JSON.stringify(lastCapturedWirePacket.wireEnvelope, null, 2);
            transportResultBox.append(meta, pre);
        });
    }

    const btnBenchTransport = document.getElementById('btnTransportBenchmark');
    if (btnBenchTransport && transportResultBox) {
        btnBenchTransport.addEventListener('click', () => {
            if (!clientTransportTunnel) {
                showToast('err', 'Transport crypto tunnel is inactive.');
                return;
            }
            runWithButtonLock(btnBenchTransport, async () => {
                try {
                    const sizesKb = [1, 64, 192];
                    const results = [];
                    for (const kb of sizesKb) {
                        const targetBytes = kb * 1024;
                        const samplePayload = 'K-POP/EN-TRANSPORT-BENCHMARK-'.repeat(Math.ceil(targetBytes / 29)).slice(0, targetBytes);
                        const tStart = performance.now();
                        const res = await fetch('/api/transport/benchmark', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ samplePayload, echo: false })
                        });
                        if (!res.ok) throw new Error(await res.text() || 'Benchmark failed');
                        const data = await res.json();
                        const rttMs = Number((performance.now() - tStart).toFixed(2));
                        const diag = clientTransportTunnel.getDiagnostics();
                        results.push({
                            kb,
                            payloadBytes: data.payloadBytes,
                            rttMs,
                            clientEncryptMs: diag.metrics.lastEncryptMs,
                            serverDecryptMs: data.serverDecryptMs,
                            sha256Prefix: data.sha256Prefix,
                            encryptedIn: data.encryptedIn
                        });
                    }
                    const diagNow = clientTransportTunnel.getDiagnostics();
                    updateTransportStatusBadges();

                    transportResultBox.hidden = false;
                    transportResultBox.replaceChildren();
                    const title = document.createElement('strong');
                    title.textContent = `⚡ Hybrid Throughput Benchmark (X25519 Handshake: ${diagNow.metrics.lastHandshakeMs} ms -> Bulk AES-256-CTR + HMAC-SHA256):`;
                    transportResultBox.appendChild(title);

                    const explain = document.createElement('p');
                    explain.className = 'muted-text';
                    explain.textContent = 'Asymmetric ECDH (X25519) runs ONLY once at session start; bulk large payloads use symmetric AES-256-CTR + HMAC-SHA256 in constant memory with O(N) speed.';
                    transportResultBox.appendChild(explain);

                    results.forEach(r => {
                        const line = document.createElement('div');
                        const throughputMBs = r.clientEncryptMs > 0
                            ? ((r.payloadBytes / (1024 * 1024)) / (r.clientEncryptMs / 1000)).toFixed(2)
                            : '∞';
                        line.textContent = `• ${r.kb} KB (${r.payloadBytes.toLocaleString()} B): Verified Encrypted=${r.encryptedIn} | Client AES-CTR=${r.clientEncryptMs} ms (~${throughputMBs} MB/s) | Server OpenSSL Decrypt=${r.serverDecryptMs ?? '--'} ms | Total RTT=${r.rttMs} ms | SHA256=${r.sha256Prefix}…`;
                        transportResultBox.appendChild(line);
                    });
                } catch (err) {
                    showToast('err', err.message || 'Benchmark error.');
                }
            }, { loadingText: 'Benchmarking...' });
        });
    }

    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!btnSaveSettings) return;
        const payload = collectSettingsFormPayload();
        setYouTubePlatformMode(payload.youtubePlatformMode || 'auto', { persistLocal: true });

        runWithButtonLock(btnSaveSettings, async () => {
            try {
                const resData = await submitMutationRequest({
                    url: '/api/settings',
                    method: 'PUT',
                    scopeKey: 'settings-save',
                    signature: JSON.stringify(payload),
                    buildBody: () => payload,
                    parseJson: true
                });
                if (resData && resData.settings) {
                    aplicarSettingsEnEstado(resData.settings, { syncAgendaDefaults: true });
                    populateSettingsForm(resData.settings);
                }
                const okMsg = resData.message || 'Settings saved successfully.';
                setSettingsBanner('ok', okMsg);
                showToast('ok', okMsg);
                cargarRecordatoriosActivos();
            } catch (err) {
                setSettingsBanner('err', 'Error saving settings: ' + err.message);
                showToast('err', err.message);
            }
        }, { loadingText: 'Saving...' });
    });
}

// ==========================================
// WORD-STYLE ENGLISH SPELLING & GRAMMAR PROOFING ENGINE
// ==========================================
const WORD_SPELLING_DICTIONARY = {
    accomodate: 'accommodate',
    acheive: 'achieve',
    adress: 'address',
    agressive: 'aggressive',
    alot: 'a lot',
    apparantly: 'apparently',
    arguement: 'argument',
    assigment: 'assignment',
    assingment: 'assignment',
    basicly: 'basically',
    becuase: 'because',
    beacuse: 'because',
    begining: 'beginning',
    beleive: 'believe',
    buisness: 'business',
    calender: 'calendar',
    catagory: 'category',
    collegue: 'colleague',
    comming: 'coming',
    commited: 'committed',
    concious: 'conscious',
    curiousity: 'curiosity',
    definately: 'definitely',
    definitly: 'definitely',
    dependant: 'dependent',
    desireable: 'desirable',
    developement: 'development',
    diffrent: 'different',
    disapoint: 'disappoint',
    embarass: 'embarrass',
    enviroment: 'environment',
    existance: 'existence',
    experiance: 'experience',
    explaination: 'explanation',
    familar: 'familiar',
    finaly: 'finally',
    foriegn: 'foreign',
    fourty: 'forty',
    freind: 'friend',
    futher: 'further',
    goverment: 'government',
    grammer: 'grammar',
    gaurd: 'guard',
    happend: 'happened',
    harass: 'harass',
    homewrok: 'homework',
    humourous: 'humorous',
    immediatly: 'immediately',
    independant: 'independent',
    interupt: 'interrupt',
    irresistable: 'irresistible',
    knowlege: 'knowledge',
    labratory: 'laboratory',
    liason: 'liaison',
    maintainance: 'maintenance',
    managment: 'management',
    millenium: 'millennium',
    mischievious: 'mischievous',
    neccessary: 'necessary',
    necesary: 'necessary',
    noticable: 'noticeable',
    occassion: 'occasion',
    occured: 'occurred',
    ocurred: 'occurred',
    parliment: 'parliament',
    passtime: 'pastime',
    perseverence: 'perseverance',
    personel: 'personnel',
    plagarism: 'plagiarism',
    posession: 'possession',
    prefered: 'preferred',
    priviledge: 'privilege',
    proffesor: 'professor',
    programing: 'programming',
    pronounciation: 'pronunciation',
    publically: 'publicly',
    questionaire: 'questionnaire',
    recieve: 'receive',
    recieved: 'received',
    recomend: 'recommend',
    refference: 'reference',
    relevent: 'relevant',
    religous: 'religious',
    rember: 'remember',
    repitition: 'repetition',
    resistence: 'resistance',
    responsability: 'responsibility',
    restaraunt: 'restaurant',
    rythm: 'rhythm',
    scedule: 'schedule',
    scheduel: 'schedule',
    seperate: 'separate',
    seperated: 'separated',
    sieze: 'seize',
    similer: 'similar',
    sincerly: 'sincerely',
    speach: 'speech',
    studing: 'studying',
    succesful: 'successful',
    successfull: 'successful',
    suprise: 'surprise',
    tattooes: 'tattoos',
    tendancy: 'tendency',
    therefor: 'therefore',
    threshhold: 'threshold',
    tommorow: 'tomorrow',
    tomorow: 'tomorrow',
    tounge: 'tongue',
    truely: 'truly',
    unforeseen: 'unforeseen',
    unfortunatly: 'unfortunately',
    univeristy: 'university',
    untill: 'until',
    weird: 'weird',
    whereever: 'wherever',
    wich: 'which',
    wierd: 'weird',
    writting: 'writing',
    dont: "don't",
    doesnt: "doesn't",
    didnt: "didn't",
    cant: "can't",
    wont: "won't",
    isnt: "isn't",
    arent: "aren't",
    wasnt: "wasn't",
    werent: "weren't",
    ive: "I've",
    im: "I'm",
    id: "I'd",
    youre: "you're",
    theyre: "they're",
    weve: "we've"
};

const WORD_GRAMMAR_PATTERNS = [
    {
        regex: /\bi\b/g,
        fix: () => 'I',
        reason: 'Capitalize pronoun "I"'
    },
    {
        regex: /\b(a)\s+([aeiouAEIOU][a-zA-Z]{2,})\b/g,
        filter: (match, art, nextWord) => !/^(uni|use|usu|eur|one)/i.test(nextWord),
        fix: (match, art, nextWord) => `${art === 'A' ? 'An' : 'an'} ${nextWord}`,
        reason: 'Use "an" before vowel sounds'
    },
    {
        regex: /\b(an)\s+([bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ][a-zA-Z]{1,})\b/g,
        filter: (match, art, nextWord) => !/^(hour|honest|honor|heir)/i.test(nextWord),
        fix: (match, art, nextWord) => `${art === 'An' ? 'A' : 'a'} ${nextWord}`,
        reason: 'Use "a" before consonant sounds'
    },
    {
        regex: /\b([A-Za-z]+)\s+\1\b/gi,
        fix: (match, word) => word,
        reason: 'Repeated word'
    },
    {
        regex: /\b(should|could|would|must|might)\s+of\b/gi,
        fix: (match, modal) => `${modal} have`,
        reason: 'Use "have" instead of "of" after modal verbs'
    },
    {
        regex: /\b(he|she|it)\s+don't\b/gi,
        fix: (match, subj) => `${subj} doesn't`,
        reason: 'Subject-verb agreement ("doesn\'t")'
    },
    {
        regex: /\b(he|she|it)\s+have\b/gi,
        fix: (match, subj) => `${subj} has`,
        reason: 'Subject-verb agreement ("has")'
    },
    {
        regex: /\b(I|you|we|they)\s+was\b/gi,
        fix: (match, subj) => `${subj === 'I' || subj === 'i' ? 'I was' : `${subj} were`}`,
        filter: (match, subj) => subj.toLowerCase() !== 'i',
        reason: 'Plural verb agreement ("were")'
    },
    {
        regex: /\b(informations|homeworks|advices|equipments|knowledges|furnitures)\b/gi,
        fix: (match) => match.slice(0, -1),
        reason: 'Uncountable noun (no plural "-s")'
    },
    {
        regex: /\b(didn't|did not)\s+(went|saw|ate|took|made|did|wrote|bought|came|found|gave|knew|left|ran|said|thought|told)\b/gi,
        fix: (match, aux, verb) => {
            const baseMap = {
                went: 'go', saw: 'see', ate: 'eat', took: 'take', made: 'make', did: 'do',
                wrote: 'write', bought: 'buy', came: 'come', found: 'find', gave: 'give',
                knew: 'know', left: 'leave', ran: 'run', said: 'say', thought: 'think', told: 'tell'
            };
            return `${aux} ${baseMap[verb.toLowerCase()] || verb}`;
        },
        reason: 'Use base verb after "didn\'t"'
    },
    {
        regex: /\bI\s+am\s+agree\b/gi,
        fix: () => 'I agree',
        reason: '"Agree" is a verb ("I agree")'
    },
    {
        regex: /\bdepends\s+of\b/gi,
        fix: () => 'depends on',
        reason: 'Preposition: "depends on"'
    }
];

function analyzeEnglishTextWordStyle(text, fieldElement, fieldLabel = '') {
    const raw = String(text || '');
    if (!raw.trim()) return [];
    const issues = [];

    // 1. Spelling check word-by-word
    const wordRegex = /\b([A-Za-z']{2,})\b/g;
    let m;
    while ((m = wordRegex.exec(raw)) !== null) {
        const original = m[1];
        const lower = original.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(WORD_SPELLING_DICTIONARY, lower)) {
            let suggestion = WORD_SPELLING_DICTIONARY[lower];
            if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase() && suggestion[0]) {
                suggestion = suggestion[0].toUpperCase() + suggestion.slice(1);
            }
            if (suggestion !== original) {
                issues.push({
                    type: 'spelling',
                    original,
                    replacement: suggestion,
                    reason: 'Spelling',
                    fieldElement,
                    fieldLabel
                });
            }
        }
    }

    // 2. Grammar & style patterns
    WORD_GRAMMAR_PATTERNS.forEach(rule => {
        const rgx = new RegExp(rule.regex.source, rule.regex.flags);
        let gm;
        while ((gm = rgx.exec(raw)) !== null) {
            if (typeof rule.filter === 'function' && !rule.filter(...gm)) continue;
            const replacement = rule.fix(...gm);
            if (replacement && replacement !== gm[0]) {
                issues.push({
                    type: 'grammar',
                    original: gm[0],
                    replacement,
                    reason: rule.reason || 'Grammar',
                    fieldElement,
                    fieldLabel
                });
            }
        }
    });

    // 3. Sentence initial capitalization
    const firstCharMatch = /^\s*([a-z][a-z]{1,})\b/.exec(raw);
    if (firstCharMatch) {
        const w = firstCharMatch[1];
        const cap = w[0].toUpperCase() + w.slice(1);
        if (!issues.some(it => it.original === w)) {
            issues.push({
                type: 'grammar',
                original: w,
                replacement: cap,
                reason: 'Capitalize start of sentence',
                fieldElement,
                fieldLabel
            });
        }
    }

    return issues.slice(0, 12);
}

function applySingleProofingFix(issue) {
    if (!issue || !issue.fieldElement) return;
    const current = String(issue.fieldElement.value || '');
    const escaped = issue.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rgx = new RegExp(`\\b${escaped}\\b`);
    if (rgx.test(current)) {
        issue.fieldElement.value = current.replace(rgx, issue.replacement);
    } else {
        issue.fieldElement.value = current.replace(issue.original, issue.replacement);
    }
    issue.fieldElement.dispatchEvent(new Event('input'));
}

function bindProofingSuite({ fields, badgeId, fixAllBtnId, listId }) {
    const badgeEl = document.getElementById(badgeId);
    const fixAllBtn = document.getElementById(fixAllBtnId);
    const listEl = document.getElementById(listId);
    if (!badgeEl || !listEl) return;

    let currentIssues = [];

    const evaluateSuite = () => {
        currentIssues = [];
        let hasText = false;
        fields.forEach(f => {
            const el = document.getElementById(f.id);
            if (!el) return;
            if (String(el.value || '').trim()) hasText = true;
            const found = analyzeEnglishTextWordStyle(el.value, el, f.label);
            currentIssues.push(...found);
        });

        listEl.innerHTML = '';

        if (!hasText) {
            badgeEl.className = 'proofing-status-badge is-ok';
            badgeEl.textContent = '✓ Ready to check English spelling & grammar';
            if (fixAllBtn) fixAllBtn.hidden = true;
            return;
        }

        if (currentIssues.length === 0) {
            badgeEl.className = 'proofing-status-badge is-ok';
            badgeEl.textContent = '✓ Spelling & Grammar look great (Word check passed)';
            if (fixAllBtn) fixAllBtn.hidden = true;
            return;
        }

        const spellCount = currentIssues.filter(i => i.type === 'spelling').length;
        const gramCount = currentIssues.filter(i => i.type === 'grammar').length;
        badgeEl.className = 'proofing-status-badge has-issues';
        badgeEl.textContent = `⚠ ${spellCount} Spelling · ${gramCount} Grammar suggestion${currentIssues.length === 1 ? '' : 's'} (tap to fix)`;
        if (fixAllBtn) fixAllBtn.hidden = false;

        currentIssues.forEach(issue => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `proofing-issue-chip ${issue.type === 'spelling' ? 'is-spelling' : 'is-grammar'}`;
            chip.title = `${issue.reason} — Click to replace "${issue.original}" with "${issue.replacement}"`;
            const prefix = issue.fieldLabel ? `${issue.fieldLabel}: ` : '';
            chip.innerHTML = `<span class="issue-wrong">${prefix}${issue.original}</span><span class="issue-arrow">→</span><span class="issue-fix">${issue.replacement}</span><span class="issue-reason">(${issue.reason})</span>`;
            chip.addEventListener('click', () => {
                applySingleProofingFix(issue);
            });
            listEl.appendChild(chip);
        });
    };

    fields.forEach(f => {
        const el = document.getElementById(f.id);
        if (el) {
            el.setAttribute('spellcheck', 'true');
            el.setAttribute('lang', 'en');
            el.addEventListener('input', evaluateSuite);
            el.addEventListener('change', evaluateSuite);
        }
    });

    if (fixAllBtn) {
        fixAllBtn.addEventListener('click', () => {
            const snapshot = [...currentIssues];
            snapshot.forEach(issue => applySingleProofingFix(issue));
            evaluateSuite();
            showToast('ok', 'Applied all English spelling & grammar suggestions.');
        });
    }

    evaluateSuite();
}

function initWordStyleProofing() {
    bindProofingSuite({
        fields: [
            { id: 'journalTitle', label: 'Title' },
            { id: 'journalText', label: 'Note' }
        ],
        badgeId: 'journalProofingBadge',
        fixAllBtnId: 'btnJournalFixAll',
        listId: 'journalProofingIssues'
    });

    bindProofingSuite({
        fields: [
            { id: 'palabra', label: 'Word' },
            { id: 'significado', label: 'Meaning' },
            { id: 'ejemplo', label: 'Example' }
        ],
        badgeId: 'englishProofingBadge',
        fixAllBtnId: 'btnEnglishFixAll',
        listId: 'englishProofingIssues'
    });

    bindProofingSuite({
        fields: [
            { id: 'agendaActividad', label: 'Title' },
            { id: 'agendaDescripcion', label: 'Desc' }
        ],
        badgeId: 'agendaProofingBadge',
        fixAllBtnId: 'btnAgendaFixAll',
        listId: 'agendaProofingIssues'
    });
}

// ==========================================
// ITS SALTILLO ACADEMIC PLANNER, CROQUIS, VACATIONS, RESIDENCIAS, WORK & GPS
// ==========================================
let academicPlannerState = null;
let academicPlannerDirectory = null;
let academicPlannerMindboxPreset = null;
let academicPlannerCommutePreview = null;

function setPlannerBanner(type, message) {
    setInlineBanner('plannerStatusBanner', type, message);
}

function renderItsCroquisDirectory(directory) {
    const grid = document.getElementById('itsCroquisDirectoryCards');
    if (!grid || !directory) return;
    grid.replaceChildren();
    Object.values(directory).forEach(camp => {
        const card = document.createElement('div');
        card.className = 'its-croquis-card';

        const meta = document.createElement('div');
        meta.className = 'planner-course-meta';
        const title = document.createElement('h4');
        title.textContent = `🏫 ${camp.name || 'Campus ITS'} (${camp.plano || ''})`;
        const addr = document.createElement('p');
        addr.className = 'form-hint';
        addr.style.margin = '0';
        addr.textContent = `📍 ${camp.address || ''}`;
        const buildings = document.createElement('p');
        buildings.className = 'form-hint';
        buildings.style.margin = '2px 0 0';
        buildings.textContent = Array.isArray(camp.buildings)
            ? camp.buildings.map(b => `${b.code} · ${b.name}`).join(' | ')
            : String(camp.buildings || '');
        meta.append(title, addr, buildings);

        const actions = document.createElement('div');
        const mapLink = document.createElement('a');
        mapLink.href = `https://www.google.com/maps/search/?api=1&query=${camp.lat},${camp.lng}`;
        mapLink.target = '_blank';
        mapLink.rel = 'noopener noreferrer';
        mapLink.className = 'btn-secondary btn-small';
        mapLink.style.textDecoration = 'none';
        mapLink.textContent = '🗺️ Open Maps';
        actions.appendChild(mapLink);

        card.append(meta, actions);
        grid.appendChild(card);
    });
}

function getActiveSemesterObj() {
    if (!academicPlannerState || !Array.isArray(academicPlannerState.semesters)) return null;
    return academicPlannerState.semesters.find(s => s.id === academicPlannerState.activeSemesterId) || academicPlannerState.semesters[0] || null;
}

function resetPlannerCourseForm() {
    const form = document.getElementById('plannerCourseForm');
    if (form) form.reset();
    const editIdEl = document.getElementById('plannerCourseEditId');
    if (editIdEl) editIdEl.value = '';
    const titleEl = document.getElementById('plannerCourseFormTitle');
    if (titleEl) titleEl.textContent = 'Add / Edit ITS Class';
    const saveBtn = document.getElementById('btnSaveCourse');
    if (saveBtn) saveBtn.textContent = 'Save Class to Semester';
    const cancelBtn = document.getElementById('btnCancelCourseEdit');
    if (cancelBtn) cancelBtn.hidden = true;
    const badge = document.getElementById('courseRoomCroquisBadge');
    if (badge) badge.textContent = 'Type a room (R02, R11, N21, A10, S15) to detect ITS Campus & Croquis building.';
    document.querySelectorAll('#courseDaysGroup input[type="checkbox"]').forEach(cb => {
        cb.checked = [1, 2, 3, 4].includes(Number(cb.value));
    });
}

function loadCourseIntoEditForm(course) {
    if (!course) return;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
    setVal('plannerCourseEditId', course.id || '');
    setVal('courseCode', course.code || '');
    setVal('courseGroup', course.group || '');
    setVal('courseName', course.name || '');
    setVal('courseTeacher', course.teacher || '');
    setVal('courseRoom', course.room || '');
    setVal('courseCampus', course.campusId || 'boillot');
    setVal('courseStartTime', course.startTime || '09:00');
    setVal('courseEndTime', course.endTime || '10:00');
    const daySet = new Set(Array.isArray(course.days) ? course.days.map(Number) : [1, 2, 3, 4]);
    document.querySelectorAll('#courseDaysGroup input[type="checkbox"]').forEach(cb => {
        cb.checked = daySet.has(Number(cb.value));
    });
    const titleEl = document.getElementById('plannerCourseFormTitle');
    if (titleEl) titleEl.textContent = `Edit Class: ${course.name || ''}`;
    const saveBtn = document.getElementById('btnSaveCourse');
    if (saveBtn) saveBtn.textContent = 'Update Class';
    const cancelBtn = document.getElementById('btnCancelCourseEdit');
    if (cancelBtn) cancelBtn.hidden = false;
    document.getElementById('plannerCourseForm')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderPlannerSemesterUI() {
    const semSelect = document.getElementById('plannerSemesterSelect');
    const semName = document.getElementById('plannerSemName');
    const semCode = document.getElementById('plannerSemCode');
    const semStart = document.getElementById('plannerSemStart');
    const semEnd = document.getElementById('plannerSemEnd');
    const coursesList = document.getElementById('plannerCoursesContainer');
    const countBadge = document.getElementById('plannerCoursesCountBadge');
    if (!academicPlannerState || !semSelect) return;

    semSelect.replaceChildren();
    (academicPlannerState.semesters || []).forEach(sem => {
        const opt = document.createElement('option');
        opt.value = sem.id;
        const labelName = sem.name || sem.nombre || 'Semester';
        opt.textContent = `${labelName} (${(sem.courses || []).length} classes)`;
        semSelect.appendChild(opt);
    });
    const activeSem = getActiveSemesterObj();
    if (!activeSem) return;

    semSelect.value = activeSem.id;
    if (semName) semName.value = activeSem.name || activeSem.nombre || '';
    if (semCode) semCode.value = activeSem.termCode || '';
    if (semStart) semStart.value = activeSem.startDate || activeSem.fechaInicio || '';
    if (semEnd) semEnd.value = activeSem.endDate || activeSem.fechaFin || '';

    const courses = Array.isArray(activeSem.courses) ? activeSem.courses : [];
    if (countBadge) countBadge.textContent = `${courses.length} class(es)`;
    if (!coursesList) return;

    coursesList.replaceChildren();
    const dayLabels = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };

    if (courses.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'agenda-empty';
        empty.textContent = 'No classes in this semester yet. Add one on the left or click "Load MindBox 9th Sem Preset".';
        coursesList.appendChild(empty);
        return;
    }

    courses.forEach((course, idx) => {
        const card = document.createElement('div');
        card.className = 'planner-course-card';

        const meta = document.createElement('div');
        meta.className = 'planner-course-meta';

        const h4 = document.createElement('h4');
        const codeText = course.code || course.clave || 'ITS';
        const courseNameText = course.name || course.nombre || 'Course';
        const groupText = course.group || course.grupo || '';
        const roomText = course.room || course.aulaDefault || 'TBD';
        const codeSpan = document.createElement('span');
        codeSpan.className = 'planner-room-pill';
        codeSpan.textContent = `${codeText} · ${roomText}`;
        h4.appendChild(codeSpan);
        h4.appendChild(document.createTextNode(` ${courseNameText}${groupText ? ` (Grp ${groupText})` : ''}`));

        const sub = document.createElement('p');
        sub.style.margin = '2px 0';
        const teacherText = course.teacher || course.docente || 'Docente ITS';
        const campusObj = academicPlannerDirectory && academicPlannerDirectory[course.campusId || course.campusKey];
        const campusLabel = campusObj ? `${campusObj.name} (${campusObj.plano})` : (course.campusId || 'Tec de Saltillo');
        sub.textContent = `👩‍🏫 ${teacherText} · 🏛️ ${campusLabel}`;

        const daysText = (Array.isArray(course.days) ? course.days : [1, 2, 3, 4]).map(d => dayLabels[Number(d)] || d).join('/');
        const timeP = document.createElement('p');
        timeP.className = 'muted-text';
        timeP.style.margin = '0';
        timeP.textContent = `📅 ${daysText} · ⏰ ${course.startTime || '09:00'} – ${course.endTime || '10:00'}`;

        meta.append(h4, sub, timeP);

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '6px';
        actions.style.flexWrap = 'wrap';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn-secondary btn-small';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => loadCourseIntoEditForm(course));

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-secondary btn-small btn-danger-outline';
        delBtn.textContent = 'Remove';
        delBtn.addEventListener('click', () => {
            const sem = getActiveSemesterObj();
            if (!sem || !Array.isArray(sem.courses)) return;
            sem.courses.splice(idx, 1);
            renderPlannerSemesterUI();
        });

        actions.append(editBtn, delBtn);
        card.append(meta, actions);
        coursesList.appendChild(card);
    });
}

function renderPlannerVacationsUI() {
    const listEl = document.getElementById('plannerVacationsList');
    const vacBanner = document.getElementById('plannerVacationActiveBanner');
    if (!academicPlannerState) return;
    const vacations = academicPlannerState.vacations || [];

    if (vacBanner) {
        const todayStr = formatLocalDate(new Date());
        const activeVac = vacations.find(v => (v.startDate || v.fechaInicio) <= todayStr && todayStr <= (v.endDate || v.fechaFin));
        if (activeVac) {
            vacBanner.textContent = `🏖️ Vacation / Break Active Today: ${activeVac.name || activeVac.nombre} (${activeVac.startDate || activeVac.fechaInicio} → ${activeVac.endDate || activeVac.fechaFin}) — Class alerts paused.`;
            vacBanner.hidden = false;
        } else {
            vacBanner.hidden = true;
        }
    }

    if (!listEl) return;
    listEl.replaceChildren();
    if (vacations.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'agenda-empty';
        empty.textContent = 'No vacation periods registered.';
        listEl.appendChild(empty);
        return;
    }

    vacations.forEach((vac, idx) => {
        const item = document.createElement('div');
        item.className = 'planner-course-card';

        const meta = document.createElement('div');
        meta.className = 'planner-course-meta';
        const h4 = document.createElement('h4');
        h4.textContent = `🏖️ ${vac.name || vac.nombre || 'Break'}`;
        const p = document.createElement('p');
        p.style.margin = '0';
        p.textContent = `📅 ${vac.startDate || vac.fechaInicio} → ${vac.endDate || vac.fechaFin}`;
        meta.append(h4, p);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-secondary btn-small btn-danger-outline';
        delBtn.textContent = 'Remove';
        delBtn.addEventListener('click', () => {
            academicPlannerState.vacations.splice(idx, 1);
            renderPlannerVacationsUI();
        });

        item.append(meta, delBtn);
        listEl.appendChild(item);
    });
}

function updateResHoursProgressDisplay() {
    const totalH = Math.max(1, Number(document.getElementById('resTotalHours')?.value) || 500);
    const doneH = Math.max(0, Number(document.getElementById('resLoggedHours')?.value) || 0);
    const pct = Math.min(100, Math.round((doneH / totalH) * 100));
    const barEl = document.getElementById('resHoursProgressBar');
    if (barEl) {
        barEl.textContent = `Progress: ${formatHoursMinutes(doneH, { compact: true })} / ${totalH} hrs (${pct}%)`;
    }
}

function isValidNonZeroCoordPair(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
    if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) return false;
    return true;
}

function extractCoordsFromMapsUrlClient(rawUrl = '') {
    const raw = String(rawUrl || '').trim();
    if (!raw) return null;
    let decoded = raw;
    try {
        decoded = decodeURIComponent(raw);
    } catch (_) {
        decoded = raw;
    }
    const candidateStr = `${raw}\n${decoded}`;
    const pinMatch = candidateStr.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) ||
                     candidateStr.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ||
                     candidateStr.match(/[?&](?:q|query|ll|center|destination|origin)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i) ||
                     candidateStr.match(/(?:^|[\s:/=])(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
    if (!pinMatch) return null;
    const lat = Number(pinMatch[1]);
    const lng = Number(pinMatch[2]);
    if (!isValidNonZeroCoordPair(lat, lng)) return null;
    return {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6))
    };
}

function updateHomeLocationVerifyUI() {
    const latNum = Number(document.getElementById('homeLocationLat')?.value);
    const lngNum = Number(document.getElementById('homeLocationLng')?.value);
    const latRaw = String(document.getElementById('homeLocationLat')?.value || '').trim();
    const lngRaw = String(document.getElementById('homeLocationLng')?.value || '').trim();
    const verifyLink = document.getElementById('homeLocationVerifyLink');
    const summaryEl = document.getElementById('homeLocationSummaryText');
    const label = String(document.getElementById('homeLocationLabel')?.value || 'Mi Casa').trim();
    const addr = String(document.getElementById('homeLocationAddress')?.value || '').trim();

    const valid = Boolean(latRaw && lngRaw && isValidNonZeroCoordPair(latNum, lngNum));
    if (verifyLink) {
        if (valid) {
            verifyLink.href = `https://www.google.com/maps?q=${latNum.toFixed(6)},${lngNum.toFixed(6)}`;
            verifyLink.hidden = false;
        } else {
            verifyLink.href = '#';
            verifyLink.hidden = true;
        }
    }
    if (summaryEl) {
        if (valid) {
            summaryEl.textContent = `✅ Home saved (${label || 'Mi Casa'}${addr ? ` · ${addr}` : ''}): ${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`;
        } else {
            summaryEl.textContent = 'Enter your Saltillo street address or paste a Google Maps link, then click "Save & Find Home Location".';
        }
    }
}

async function triggerClearCurrentGpsOrigin(btnEl, onAfterDone = null) {
    const run = async () => {
        try {
            const resData = await submitMutationRequest({
                url: '/api/planner/location',
                method: 'POST',
                scopeKey: 'planner-clear-current-gps',
                signature: `clear:${Date.now()}`,
                buildBody: () => ({ target: 'clear_current' }),
                parseJson: true
            });
            if (resData?.planner) {
                academicPlannerState = resData.planner;
                renderPlannerResidenciasAndWorkUI();
            }
            if (resData?.commutePreview) renderLiveCommuteCards(resData.commutePreview);
            showToast('ok', resData?.message || 'Commutes now use your Saved Home as origin.');
            if (typeof onAfterDone === 'function') onAfterDone(resData);
        } catch (err) {
            showToast('err', err.message || 'Could not switch origin to Home.');
        }
    };
    if (btnEl) {
        return runWithButtonLock(btnEl, run, { loadingText: 'Switching...' });
    }
    return run();
}

async function triggerPingPhoneForGps(btnEl, bannerEl = null) {
    const run = async () => {
        try {
            const resData = await submitMutationRequest({
                url: '/api/planner/request-phone-gps',
                method: 'POST',
                scopeKey: 'planner-request-phone-gps',
                signature: String(Date.now()),
                buildBody: () => ({}),
                parseJson: true
            });
            const msg = resData?.message || 'GPS request sent to your phone via ntfy! Tap the notification on your phone.';
            showToast('ok', msg);
            if (bannerEl) {
                bannerEl.className = 'inline-status-banner is-ok';
                bannerEl.textContent = msg;
                bannerEl.hidden = false;
            }
        } catch (err) {
            const msg = err.message || 'Could not ping phone via ntfy.';
            showToast('err', msg);
            if (bannerEl) {
                bannerEl.className = 'inline-status-banner is-error';
                bannerEl.textContent = msg;
                bannerEl.hidden = false;
            }
        }
    };
    if (btnEl) {
        return runWithButtonLock(btnEl, run, { loadingText: 'Sending...' });
    }
    return run();
}

function renderPlannerResidenciasAndWorkUI() {
    if (!academicPlannerState) return;
    const setCheck = (id, v) => { const el = document.getElementById(id); if (el) el.checked = Boolean(v); };
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v !== undefined && v !== null ? String(v) : ''; };

    const res = academicPlannerState.residencias || {};
    setCheck('resEnabled', res.enabled);
    setVal('resProjectName', res.projectName || '');
    setVal('resCompanyName', res.companyName || '');
    setVal('resAdvisorName', res.advisorName || '');
    setVal('resModality', res.modality || 'presencial');
    setVal('resLoggedHours', res.loggedHours ?? 0);
    setVal('resTotalHours', res.totalHoursGoal ?? 500);
    setVal('resStartTime', res.startTime || '08:00');
    setVal('resEndTime', res.endTime || '13:00');
    setVal('resLocationAddress', res.location?.address || '');
    setVal('resLocationMapsUrl', res.location?.mapsUrl || '');
    setVal('resLocationLat', res.location?.lat ?? '');
    setVal('resLocationLng', res.location?.lng ?? '');

    const resDays = new Set(Array.isArray(res.days) ? res.days.map(Number) : [1, 2, 3, 4, 5]);
    document.querySelectorAll('#resDaysGroup input[type="checkbox"]').forEach(cb => {
        cb.checked = resDays.has(Number(cb.value));
    });
    updateResHoursProgressDisplay();

    const wk = academicPlannerState.work || {};
    setCheck('workEnabled', wk.enabled);
    setVal('workScheduleType', wk.scheduleType || 'medio_tiempo');
    setVal('workModality', wk.modality || 'presencial');
    setVal('workCompanyName', wk.companyName || '');
    setVal('workRoleTitle', wk.roleTitle || '');
    setVal('workStartTime', wk.startTime || '08:00');
    setVal('workEndTime', wk.endTime || '16:00');
    setVal('workLocationAddress', wk.location?.address || '');
    setVal('workLocationMapsUrl', wk.location?.mapsUrl || '');
    setVal('workLocationLat', wk.location?.lat ?? '');
    setVal('workLocationLng', wk.location?.lng ?? '');

    const workDays = new Set(Array.isArray(wk.days) ? wk.days.map(Number) : [1, 2, 3, 4, 5]);
    document.querySelectorAll('#workDaysGroup input[type="checkbox"]').forEach(cb => {
        cb.checked = workDays.has(Number(cb.value));
    });

    setCheck('plannerClassRemindersEnabled', academicPlannerState.classRemindersEnabled !== false);
    setVal('plannerFarLeadMin', academicPlannerState.farLeadMinutesMin ?? 30);
    setVal('plannerNearLeadMin', academicPlannerState.nearLeadMinutes ?? 10);
    setVal('plannerParkingBufferMin', academicPlannerState.parkingBufferMinutes ?? 8);
    setVal('plannerNearRadiusKm', academicPlannerState.nearRadiusKm ?? 0.85);

    const locs = academicPlannerState.locations || {};
    const homeLat = Number(locs.home?.lat);
    const homeLng = Number(locs.home?.lng);
    const hasHomePair = locs.home?.lat !== null && locs.home?.lat !== undefined && locs.home?.lng !== null && locs.home?.lng !== undefined && isValidNonZeroCoordPair(homeLat, homeLng);
    setVal('homeLocationLabel', locs.home?.label || 'Mi Casa');
    setVal('homeLocationAddress', locs.home?.address || '');
    setVal('homeLocationMapsUrl', locs.home?.mapsUrl || '');
    setVal('homeLocationLat', hasHomePair ? homeLat : '');
    setVal('homeLocationLng', hasHomePair ? homeLng : '');
    setVal('uniLocationLat', locs.university?.lat ?? 25.443706);
    setVal('uniLocationLng', locs.university?.lng ?? -100.993845);
    updateHomeLocationVerifyUI();
}

function collectPlannerStateFromDOM() {
    if (!academicPlannerState) return null;
    const val = id => String(document.getElementById(id)?.value ?? '').trim();
    const numOrNull = id => {
        const s = val(id);
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    };
    const cleanCoordPair = (latId, lngId) => {
        const lat = numOrNull(latId);
        const lng = numOrNull(lngId);
        if (lat === null || lng === null || !isValidNonZeroCoordPair(lat, lng)) {
            return { lat: null, lng: null };
        }
        return { lat, lng };
    };

    const activeSem = getActiveSemesterObj();
    if (activeSem) {
        activeSem.name = val('plannerSemName') || activeSem.name || '9no Semestre';
        activeSem.termCode = val('plannerSemCode') || activeSem.termCode || '';
        activeSem.startDate = val('plannerSemStart') || activeSem.startDate;
        activeSem.endDate = val('plannerSemEnd') || activeSem.endDate;
    }

    const resCoords = cleanCoordPair('resLocationLat', 'resLocationLng');
    const resDays = Array.from(document.querySelectorAll('#resDaysGroup input[type="checkbox"]:checked')).map(cb => Number(cb.value));
    academicPlannerState.residencias = {
        ...academicPlannerState.residencias,
        enabled: Boolean(document.getElementById('resEnabled')?.checked),
        projectName: val('resProjectName'),
        companyName: val('resCompanyName'),
        advisorName: val('resAdvisorName'),
        modality: val('resModality') || 'presencial',
        loggedHours: Number(document.getElementById('resLoggedHours')?.value || 0),
        totalHoursGoal: Number(document.getElementById('resTotalHours')?.value || 500),
        days: resDays.length ? resDays : [1, 2, 3, 4, 5],
        startTime: (val('resStartTime') || '08:00').slice(0, 5),
        endTime: (val('resEndTime') || '13:00').slice(0, 5),
        location: {
            label: val('resCompanyName') || 'Empresa de Residencias',
            address: val('resLocationAddress'),
            mapsUrl: val('resLocationMapsUrl'),
            lat: resCoords.lat,
            lng: resCoords.lng
        }
    };

    const workCoords = cleanCoordPair('workLocationLat', 'workLocationLng');
    const workDays = Array.from(document.querySelectorAll('#workDaysGroup input[type="checkbox"]:checked')).map(cb => Number(cb.value));
    academicPlannerState.work = {
        ...academicPlannerState.work,
        enabled: Boolean(document.getElementById('workEnabled')?.checked),
        scheduleType: val('workScheduleType') || 'medio_tiempo',
        modality: val('workModality') || 'presencial',
        companyName: val('workCompanyName'),
        roleTitle: val('workRoleTitle'),
        days: workDays.length ? workDays : [1, 2, 3, 4, 5],
        startTime: (val('workStartTime') || '08:00').slice(0, 5),
        endTime: (val('workEndTime') || '16:00').slice(0, 5),
        location: {
            label: val('workCompanyName') || 'Lugar de Trabajo',
            address: val('workLocationAddress'),
            mapsUrl: val('workLocationMapsUrl'),
            lat: workCoords.lat,
            lng: workCoords.lng
        }
    };

    academicPlannerState.classRemindersEnabled = Boolean(document.getElementById('plannerClassRemindersEnabled')?.checked);
    academicPlannerState.farLeadMinutesMin = Number(document.getElementById('plannerFarLeadMin')?.value || 30);
    academicPlannerState.nearLeadMinutes = Number(document.getElementById('plannerNearLeadMin')?.value || 10);
    academicPlannerState.parkingBufferMinutes = Number(document.getElementById('plannerParkingBufferMin')?.value || 8);
    academicPlannerState.nearRadiusKm = Number(document.getElementById('plannerNearRadiusKm')?.value || 0.85);

    const homeCoords = cleanCoordPair('homeLocationLat', 'homeLocationLng');
    const uniCoords = cleanCoordPair('uniLocationLat', 'uniLocationLng');

    academicPlannerState.locations = {
        ...academicPlannerState.locations,
        home: {
            label: val('homeLocationLabel') || 'Mi Casa',
            address: val('homeLocationAddress'),
            mapsUrl: val('homeLocationMapsUrl'),
            lat: homeCoords.lat,
            lng: homeCoords.lng
        },
        university: {
            label: 'Instituto Tecnológico de Saltillo (Blvd. V. Carranza #2400)',
            address: 'Blvd. V. Carranza #2400, Col. Tecnológico, Saltillo',
            mapsUrl: (uniCoords.lat !== null && uniCoords.lng !== null)
                ? `https://www.google.com/maps?q=${uniCoords.lat},${uniCoords.lng}`
                : 'https://www.google.com/maps?q=25.443706,-100.993845',
            lat: uniCoords.lat ?? 25.443706,
            lng: uniCoords.lng ?? -100.993845
        }
    };

    return academicPlannerState;
}

function renderLiveCommuteCards(previewOrList = []) {
    const originTextEl = document.getElementById('liveCommuteOriginText');
    const originMetaEl = document.getElementById('liveCommuteOriginMeta');
    const container = document.getElementById('liveCommuteCardsContainer');
    const preview = Array.isArray(previewOrList)
        ? { commutes: previewOrList }
        : (previewOrList || academicPlannerCommutePreview || {});

    if (previewOrList && !Array.isArray(previewOrList)) {
        academicPlannerCommutePreview = previewOrList;
    }

    const hasValidOrigin = preview.originCoords &&
        isValidNonZeroCoordPair(Number(preview.originCoords.lat), Number(preview.originCoords.lng));

    if (originTextEl) {
        if (hasValidOrigin) {
            originTextEl.textContent = `Origin (${preview.originSource || 'GPS'}): ${Number(preview.originCoords.lat).toFixed(5)}, ${Number(preview.originCoords.lng).toFixed(5)}`;
        } else {
            originTextEl.textContent = 'Origin: Not set yet. Enter your Home street address on the left, click "Update My GPS", or pick a Saltillo preset.';
        }
    }

    if (originMetaEl) {
        if (hasValidOrigin && preview.originKind === 'current') {
            let timeStr = '';
            if (preview.originUpdatedAt) {
                const dt = new Date(preview.originUpdatedAt);
                if (!Number.isNaN(dt.getTime())) {
                    timeStr = ` · Updated ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                }
            }
            originMetaEl.textContent = `📡 Active live origin (${preview.originTechnicalSource || 'gps'}${timeStr}). Click "🏠 Use Saved Home" above to reset origin back to Home.`;
        } else if (hasValidOrigin && preview.originKind === 'home') {
            originMetaEl.textContent = '🏠 Using your Saved Home location as origin.';
        } else {
            originMetaEl.textContent = '';
        }
    }

    if (!container) return;
    container.replaceChildren();

    const rows = Array.isArray(preview.commutes) ? [...preview.commutes] : [];
    if (preview.residenciasCommute) {
        const rc = preview.residenciasCommute;
        rows.push({
            target: `🏢 Residencias (${academicPlannerState?.residencias?.companyName || 'Company'})`,
            isNearCampus: rc.isNear,
            distanceKm: rc.distanceKm,
            driveMinutesWithTraffic: rc.driveMinutes,
            trafficLabel: rc.trafficLabel,
            recommendedLeadMinutes: rc.recommendedLeadMinutes,
            mapsDirectionsUrl: rc.mapsUrl
        });
    }
    if (preview.workCommute) {
        const wc = preview.workCommute;
        rows.push({
            target: `💼 Work (${academicPlannerState?.work?.companyName || 'Workplace'})`,
            isNearCampus: wc.isNear,
            distanceKm: wc.distanceKm,
            driveMinutesWithTraffic: wc.driveMinutes,
            trafficLabel: wc.trafficLabel,
            recommendedLeadMinutes: wc.recommendedLeadMinutes,
            mapsDirectionsUrl: wc.mapsUrl
        });
    }

    if (!rows.length) {
        const p = document.createElement('p');
        p.className = 'muted-text';
        p.textContent = 'Set your current location or Home coordinates above to estimate driving time & traffic.';
        container.appendChild(p);
        return;
    }

    rows.forEach(c => {
        const card = document.createElement('div');
        card.className = 'its-croquis-card';

        const meta = document.createElement('div');
        meta.className = 'planner-course-meta';
        const h4 = document.createElement('h4');
        h4.textContent = `🎯 ${c.target}`;

        const badge = document.createElement('span');
        badge.className = `proofing-issue-chip ${c.isNearCampus ? 'is-grammar' : 'is-spelling'}`;
        badge.textContent = c.isNearCampus
            ? `📍 On / Near (${c.distanceKm} km) → Notify ${c.recommendedLeadMinutes} min before`
            : `🚗 Driving (${c.distanceKm} km · ${c.trafficLabel}) → ~${c.driveMinutesWithTraffic} min drive · Notify ${c.recommendedLeadMinutes} min before`;

        meta.append(h4, badge);

        const actions = document.createElement('div');
        if (c.mapsDirectionsUrl) {
            const link = document.createElement('a');
            link.href = c.mapsDirectionsUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'btn-secondary btn-small';
            link.style.textDecoration = 'none';
            link.textContent = '🗺️ Open Route';
            actions.appendChild(link);
        }

        card.append(meta, actions);
        container.appendChild(card);
    });
}

function applyCapturedLocationToTarget(target, coords, label, source = 'gps') {
    if (!coords) return;
    const lat = Number(coords.lat);
    const lng = Number(coords.lng);
    if (!isValidNonZeroCoordPair(lat, lng)) {
        showToast('err', 'Rejected invalid (0, 0) coordinates.');
        return Promise.reject(new Error('Invalid (0, 0) coordinates.'));
    }
    const mapUrl = `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };

    if (target === 'home') {
        setVal('homeLocationLat', lat.toFixed(6));
        setVal('homeLocationLng', lng.toFixed(6));
        setVal('homeLocationMapsUrl', mapUrl);
        updateHomeLocationVerifyUI();
    } else if (target === 'residencias') {
        setVal('resLocationLat', lat.toFixed(6));
        setVal('resLocationLng', lng.toFixed(6));
        setVal('resLocationMapsUrl', mapUrl);
    } else if (target === 'work') {
        setVal('workLocationLat', lat.toFixed(6));
        setVal('workLocationLng', lng.toFixed(6));
        setVal('workLocationMapsUrl', mapUrl);
    }

    return submitMutationRequest({
        url: '/api/planner/location',
        method: 'POST',
        scopeKey: `planner-loc:${target}`,
        signature: `${target}:${lat}:${lng}:${Date.now()}`,
        buildBody: () => ({ target, lat, lng, mapsUrl: mapUrl, label: label || 'Current Location', source }),
        parseJson: true
    }).then(data => {
        if (data?.planner) {
            academicPlannerState = data.planner;
            renderPlannerResidenciasAndWorkUI();
        }
        if (data?.commutePreview) renderLiveCommuteCards(data.commutePreview);
        else if (data?.commutes) renderLiveCommuteCards({ originCoords: { lat, lng }, originSource: label || 'Current Location', commutes: data.commutes });
        return data;
    });
}

function openQuickLocationModal(target = 'current', { showHttpNotice = false, errorMsg = '' } = {}) {
    const modal = document.getElementById('quickLocationModal');
    const targetInput = document.getElementById('quickLocationTarget');
    const titleEl = document.getElementById('quickLocationModalTitle');
    const noticeEl = document.getElementById('quickLocationHttpNotice');
    const originCodeEl = document.getElementById('quickLocationOriginCode');
    const presetsEl = document.getElementById('quickLocationPresets');
    const inputEl = document.getElementById('quickLocationInput');
    const btnUseHome = document.getElementById('btnModalUseHomeOrigin');
    if (!modal || !presetsEl) return;

    const targetLabels = {
        current: '📍 Update My Current Location',
        home: '🏠 Set Home Coordinates',
        residencias: '🏢 Set Residencias Company Location',
        work: '💼 Set Workplace Location'
    };
    if (titleEl) titleEl.textContent = targetLabels[target] || targetLabels.current;
    if (targetInput) targetInput.value = target;
    if (noticeEl) noticeEl.hidden = !showHttpNotice;
    if (originCodeEl) originCodeEl.textContent = window.location.origin;

    const bannerEl = document.getElementById('quickLocationBanner');
    if (bannerEl) {
        if (errorMsg) {
            bannerEl.className = 'inline-status-banner is-info';
            bannerEl.textContent = errorMsg;
            bannerEl.hidden = false;
        } else {
            bannerEl.hidden = true;
        }
    }

    const presets = [];
    const locs = academicPlannerState?.locations || {};
    const hasValidHome = locs.home && isValidNonZeroCoordPair(Number(locs.home.lat), Number(locs.home.lng));
    if (hasValidHome) {
        presets.push({ label: `🏠 ${locs.home.label || 'Saved Home'}`, lat: Number(locs.home.lat), lng: Number(locs.home.lng) });
    }
    if (btnUseHome) {
        btnUseHome.hidden = target !== 'current' || !hasValidHome;
    }
    presets.push(
        { label: '💻 ITS Boillot · Sistemas R/S (CTO-004)', lat: 25.443950, lng: -100.989650 },
        { label: '🎓 ITS Principal (CTO-002)', lat: 25.443706, lng: -100.993845 },
        { label: '⚙️ ITS Miravalle · N/Labs (CTO-003)', lat: 25.445350, lng: -100.991200 }
    );
    const resLoc = academicPlannerState?.residencias?.location;
    if (resLoc && isValidNonZeroCoordPair(Number(resLoc.lat), Number(resLoc.lng))) {
        presets.push({ label: '🏢 Saved Residencias', lat: Number(resLoc.lat), lng: Number(resLoc.lng) });
    }
    const workLoc = academicPlannerState?.work?.location;
    if (workLoc && isValidNonZeroCoordPair(Number(workLoc.lat), Number(workLoc.lng))) {
        presets.push({ label: '💼 Saved Work', lat: Number(workLoc.lat), lng: Number(workLoc.lng) });
    }

    presetsEl.replaceChildren();
    presets.forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quick-loc-chip';
        btn.textContent = p.label;
        btn.addEventListener('click', () => {
            runWithButtonLock(btn, async () => {
                try {
                    await applyCapturedLocationToTarget(target, { lat: p.lat, lng: p.lng }, p.label, 'preset');
                    modal.hidden = true;
                    showToast('ok', `Location updated: ${p.label} — commute recalculated!`);
                } catch (err) {
                    if (bannerEl) {
                        bannerEl.className = 'inline-status-banner is-error';
                        bannerEl.textContent = err.message || 'Could not apply location.';
                        bannerEl.hidden = false;
                    }
                }
            }, { loadingText: 'Saving...' });
        });
        presetsEl.appendChild(btn);
    });

    if (inputEl) {
        inputEl.value = '';
        modal.hidden = false;
        inputEl.focus();
    } else {
        modal.hidden = false;
    }
}

function triggerSmartGpsCapture(target = 'current') {
    const isHttpBlockedOrigin = window.isSecureContext === false &&
        !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

    if (!navigator.geolocation || isHttpBlockedOrigin) {
        openQuickLocationModal(target, { showHttpNotice: isHttpBlockedOrigin });
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            try {
                const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                if (!isValidNonZeroCoordPair(coords.lat, coords.lng)) {
                    throw new Error('Browser returned empty (0, 0) coordinates.');
                }
                await applyCapturedLocationToTarget(target, coords, 'Phone/Browser GPS', 'gps');
                const modal = document.getElementById('quickLocationModal');
                if (modal) modal.hidden = true;
                showToast('ok', 'Live GPS captured & commute routes recalculated!');
            } catch (err) {
                showToast('err', err.message || 'Could not update location.');
            }
        },
        (err) => {
            const msg = String(err?.message || '');
            const blockedByOrigin = /secure origin/i.test(msg);
            const friendly = blockedByOrigin
                ? 'Browser blocked native GPS because this address uses plain HTTP.'
                : `Browser GPS unavailable (${msg || 'permission denied'}). Choose a quick preset or paste a street address / Google Maps link below.`;
            openQuickLocationModal(target, {
                showHttpNotice: blockedByOrigin,
                errorMsg: friendly
            });
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function initQuickLocationModal() {
    const modal = document.getElementById('quickLocationModal');
    const form = document.getElementById('quickLocationForm');
    const btnClose = document.getElementById('btnCloseQuickLocModal');
    const btnCancel = document.getElementById('btnCancelQuickLocModal');
    const btnRetryGps = document.getElementById('btnRetryBrowserGps');
    const btnCopyOrigin = document.getElementById('btnCopyQuickLocOrigin');
    const btnModalPing = document.getElementById('btnModalPingPhoneGps');
    const btnModalUseHome = document.getElementById('btnModalUseHomeOrigin');
    if (!modal || !form || form.dataset.wired === 'true') return;
    form.dataset.wired = 'true';

    const closeModal = () => { modal.hidden = true; };
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.hidden) closeModal();
    });

    if (btnCopyOrigin) {
        btnCopyOrigin.addEventListener('click', async () => {
            const copied = await copyTextToClipboard(window.location.origin);
            showToast(copied ? 'ok' : 'info', copied
                ? `Copied ${window.location.origin} for chrome://flags`
                : `Copy manually: ${window.location.origin}`);
        });
    }

    if (btnModalPing) {
        btnModalPing.addEventListener('click', () => {
            const bannerEl = document.getElementById('quickLocationBanner');
            triggerPingPhoneForGps(btnModalPing, bannerEl);
        });
    }

    if (btnModalUseHome) {
        btnModalUseHome.addEventListener('click', () => {
            triggerClearCurrentGpsOrigin(btnModalUseHome, closeModal);
        });
    }

    if (btnRetryGps) {
        btnRetryGps.addEventListener('click', () => {
            const target = document.getElementById('quickLocationTarget')?.value || 'current';
            if (!navigator.geolocation) {
                showToast('err', 'Geolocation API not supported in this browser.');
                return;
            }
            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    try {
                        await applyCapturedLocationToTarget(target, { lat: pos.coords.latitude, lng: pos.coords.longitude }, 'Phone/Browser GPS', 'gps');
                        closeModal();
                        showToast('ok', 'Browser GPS worked & routes recalculated!');
                    } catch (err) {
                        showToast('err', err.message);
                    }
                },
                (err) => {
                    const bannerEl = document.getElementById('quickLocationBanner');
                    if (bannerEl) {
                        bannerEl.className = 'inline-status-banner is-error';
                        bannerEl.textContent = /secure origin/i.test(err?.message || '')
                            ? `Still blocked on ${window.location.origin}. Use 1-Tap Presets, Ping Phone, or paste a Google Maps link / address above, or enable the insecure-origin flag.`
                            : (err?.message || 'Could not read GPS.');
                        bannerEl.hidden = false;
                    }
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        });
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const target = document.getElementById('quickLocationTarget')?.value || 'current';
        const raw = String(document.getElementById('quickLocationInput')?.value || '').trim();
        const btnApply = document.getElementById('btnApplyQuickLocModal');
        const bannerEl = document.getElementById('quickLocationBanner');

        if (!raw) {
            if (bannerEl) {
                bannerEl.className = 'inline-status-banner is-error';
                bannerEl.textContent = 'Paste a street address, coordinates (e.g. 25.4437, -100.9938), or a Google Maps link first.';
                bannerEl.hidden = false;
            }
            return;
        }

        runWithButtonLock(btnApply, async () => {
            try {
                const isUrlOrCoords = /^https?:\/\//i.test(raw) || Boolean(extractCoordsFromMapsUrlClient(raw));
                const bodyPayload = isUrlOrCoords
                    ? { target, mapsUrl: raw, label: target === 'home' ? 'Mi Casa' : 'Google Maps / Manual', source: 'manual' }
                    : { target, address: raw, query: raw, label: raw.slice(0, 80), source: 'address_geocode' };
                const resData = await submitMutationRequest({
                    url: '/api/planner/location',
                    method: 'POST',
                    scopeKey: `planner-quick-loc:${target}`,
                    signature: `${target}:${raw}:${Date.now()}`,
                    buildBody: () => bodyPayload,
                    parseJson: true
                });
                if (resData?.planner) {
                    academicPlannerState = resData.planner;
                    renderPlannerResidenciasAndWorkUI();
                }
                if (resData?.commutePreview) renderLiveCommuteCards(resData.commutePreview);
                closeModal();
                showToast('ok', resData?.geocodedDisplayName
                    ? `Found "${raw}" & recalculated commute!`
                    : 'Location applied & traffic routes recalculated!');
            } catch (err) {
                if (bannerEl) {
                    bannerEl.className = 'inline-status-banner is-error';
                    bannerEl.textContent = err.message || 'Could not extract coordinates from that link.';
                    bannerEl.hidden = false;
                }
            }
        }, { loadingText: 'Applying...' });
    });
}

function cargarPlannerVista() {
    if (!currentUser || currentUser.rol !== 'admin') return;
    fetch('/api/planner', { cache: 'no-store' })
        .then(res => (res.ok ? res.json() : Promise.reject(new Error('Could not load ITS Planner'))))
        .then(data => {
            academicPlannerState = data.planner || {};
            academicPlannerDirectory = data.campusDirectory || null;
            academicPlannerMindboxPreset = data.mindboxPreset || null;
            renderItsCroquisDirectory(academicPlannerDirectory);
            renderPlannerSemesterUI();
            renderPlannerVacationsUI();
            renderPlannerResidenciasAndWorkUI();
            renderLiveCommuteCards(data.commutePreview);
        })
        .catch(err => {
            setPlannerBanner('err', 'Error loading ITS planner: ' + err.message);
        });
}

function initAcademicPlannerHandlers() {
    const viewEl = document.getElementById('view-horario');
    if (!viewEl) return;

    const panelIds = {
        classes: 'plannerPanelClasses',
        vacations: 'plannerPanelVacations',
        residencias: 'plannerPanelResidencias',
        work: 'plannerPanelWork',
        locations: 'plannerPanelLocations'
    };

    // Tab switching
    document.querySelectorAll('#plannerTabsBar [data-planner-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-planner-tab');
            document.querySelectorAll('#plannerTabsBar [data-planner-tab]').forEach(b => {
                const active = b === btn;
                b.classList.toggle('active', active);
                b.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            Object.entries(panelIds).forEach(([k, pId]) => {
                const panel = document.getElementById(pId);
                if (panel) panel.hidden = k !== tab;
            });
        });
    });

    const semSelect = document.getElementById('plannerSemesterSelect');
    if (semSelect) {
        semSelect.addEventListener('change', () => {
            if (!academicPlannerState) return;
            academicPlannerState.activeSemesterId = semSelect.value;
            resetPlannerCourseForm();
            renderPlannerSemesterUI();
        });
    }

    const btnNewSem = document.getElementById('btnNewSemester');
    if (btnNewSem) {
        btnNewSem.addEventListener('click', () => {
            if (!academicPlannerState) return;
            const newId = `sem-${Date.now()}`;
            academicPlannerState.semesters = academicPlannerState.semesters || [];
            academicPlannerState.semesters.push({
                id: newId,
                name: `Nuevo Semestre ITS (${academicPlannerState.semesters.length + 1})`,
                termCode: '2027-1',
                startDate: '2027-01-18',
                endDate: '2027-06-04',
                active: true,
                courses: []
            });
            academicPlannerState.activeSemesterId = newId;
            resetPlannerCourseForm();
            renderPlannerSemesterUI();
            setPlannerBanner('info', 'Created new semester. Customize its dates and click "Save All..." at the bottom.');
        });
    }

    const btnLoadPreset = document.getElementById('btnLoadMindboxPreset');
    if (btnLoadPreset) {
        btnLoadPreset.addEventListener('click', () => {
            const applyPreset = (presetCourses) => {
                const activeSem = getActiveSemesterObj();
                if (!activeSem || !Array.isArray(presetCourses)) return;
                activeSem.courses = presetCourses.map(c => ({ ...c }));
                resetPlannerCourseForm();
                renderPlannerSemesterUI();
                setPlannerBanner('ok', 'Loaded your 5 MindBox 9th-semester ITS courses! Click "Save All..." at the bottom to persist.');
            };
            if (Array.isArray(academicPlannerMindboxPreset) && academicPlannerMindboxPreset.length) {
                applyPreset(academicPlannerMindboxPreset);
                return;
            }
            fetch('/api/planner', { cache: 'no-store' })
                .then(r => r.json())
                .then(data => {
                    academicPlannerMindboxPreset = data.mindboxPreset || [];
                    applyPreset(academicPlannerMindboxPreset);
                })
                .catch(() => {});
        });
    }

    // Live classroom croquis detector
    const courseRoomInput = document.getElementById('courseRoom');
    const roomBadge = document.getElementById('courseRoomCroquisBadge');
    const courseCampusSelect = document.getElementById('courseCampus');
    if (courseRoomInput && roomBadge) {
        let roomTimer = null;
        courseRoomInput.addEventListener('input', () => {
            clearTimeout(roomTimer);
            const roomVal = courseRoomInput.value.trim();
            if (!roomVal) {
                roomBadge.textContent = 'Type a room (R02, R11, N21, A10, S15) to detect ITS Campus & Croquis building.';
                return;
            }
            roomTimer = setTimeout(() => {
                submitMutationRequest({
                    url: '/api/planner/resolve-room',
                    method: 'POST',
                    scopeKey: 'resolve-room',
                    signature: roomVal,
                    buildBody: () => ({ room: roomVal }),
                    parseJson: true
                }).then(data => {
                    if (data && data.resolved) {
                        const r = data.resolved;
                        roomBadge.textContent = `📍 Aula ${r.room} → ${r.buildingName} · ${r.campusName} (${r.croquisCode})`;
                        if (courseCampusSelect && r.campusId) {
                            courseCampusSelect.value = r.campusId;
                        }
                    }
                }).catch(() => {});
            }, 180);
        });
    }

    document.getElementById('btnCancelCourseEdit')?.addEventListener('click', resetPlannerCourseForm);

    const courseForm = document.getElementById('plannerCourseForm');
    if (courseForm) {
        courseForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const activeSem = getActiveSemesterObj();
            if (!activeSem) return;

            const editId = String(document.getElementById('plannerCourseEditId')?.value || '').trim();
            const code = String(document.getElementById('courseCode')?.value || '').trim().toUpperCase();
            const group = String(document.getElementById('courseGroup')?.value || '').trim().toUpperCase();
            const name = String(document.getElementById('courseName')?.value || '').trim();
            const teacher = String(document.getElementById('courseTeacher')?.value || '').trim();
            const room = String(document.getElementById('courseRoom')?.value || '').trim().toUpperCase();
            const campusId = document.getElementById('courseCampus')?.value || 'boillot';
            const startTime = String(document.getElementById('courseStartTime')?.value || '09:00').slice(0, 5);
            const endTime = String(document.getElementById('courseEndTime')?.value || '10:00').slice(0, 5);
            const days = Array.from(document.querySelectorAll('#courseDaysGroup input[type="checkbox"]:checked')).map(cb => Number(cb.value));

            if (!name || !room || days.length === 0) {
                showToast('err', 'Enter subject name, ITS classroom, and at least one class day.');
                return;
            }

            activeSem.courses = activeSem.courses || [];
            const nextCourse = {
                id: editId || `course-${Date.now()}`,
                code,
                name,
                teacher,
                group,
                room,
                campusId,
                days,
                startTime,
                endTime
            };

            const existingIdx = editId ? activeSem.courses.findIndex(c => c.id === editId) : -1;
            if (existingIdx >= 0) {
                activeSem.courses[existingIdx] = nextCourse;
                showToast('ok', `Updated "${name}" (${room}). Remember to click "Save All" below.`);
            } else {
                activeSem.courses.push(nextCourse);
                showToast('ok', `Added "${name}" (${room}) to semester.`);
            }
            resetPlannerCourseForm();
            renderPlannerSemesterUI();
        });
    }

    const vacForm = document.getElementById('plannerVacationForm');
    if (vacForm) {
        vacForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!academicPlannerState) return;
            const name = String(document.getElementById('vacName')?.value || '').trim();
            const startDate = document.getElementById('vacStartDate')?.value || '';
            const endDate = document.getElementById('vacEndDate')?.value || '';
            if (!name || !startDate || !endDate) {
                showToast('err', 'Enter vacation name, start date, and end date.');
                return;
            }
            academicPlannerState.vacations = academicPlannerState.vacations || [];
            academicPlannerState.vacations.push({
                id: `vac-${Date.now()}`,
                name,
                startDate,
                endDate
            });
            vacForm.reset();
            renderPlannerVacationsUI();
            showToast('ok', `Added vacation break: ${name}`);
        });
    }

    document.getElementById('resLoggedHours')?.addEventListener('input', updateResHoursProgressDisplay);
    document.getElementById('resTotalHours')?.addEventListener('input', updateResHoursProgressDisplay);

    // Unified Smart GPS Capture (Header button + Home / Residencias / Work / Refresh buttons)
    document.getElementById('btnUpdateLiveGps')?.addEventListener('click', () => {
        triggerSmartGpsCapture('current');
    });

    document.querySelectorAll('#view-horario [data-use-gps-target]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-use-gps-target') || 'current';
            triggerSmartGpsCapture(target);
        });
    });

    // Home Location live Google Maps URL parsing + Save & Geocode button + Verify link
    const homeMapsInput = document.getElementById('homeLocationMapsUrl');
    const homeLatInput = document.getElementById('homeLocationLat');
    const homeLngInput = document.getElementById('homeLocationLng');
    if (homeMapsInput) {
        const tryExtractHomeUrl = () => {
            const extracted = extractCoordsFromMapsUrlClient(homeMapsInput.value);
            if (extracted) {
                if (homeLatInput) homeLatInput.value = extracted.lat.toFixed(6);
                if (homeLngInput) homeLngInput.value = extracted.lng.toFixed(6);
                updateHomeLocationVerifyUI();
            }
        };
        homeMapsInput.addEventListener('input', tryExtractHomeUrl);
        homeMapsInput.addEventListener('change', tryExtractHomeUrl);
    }
    [homeLatInput, homeLngInput, document.getElementById('homeLocationAddress'), document.getElementById('homeLocationLabel')].forEach(el => {
        if (el) el.addEventListener('input', updateHomeLocationVerifyUI);
    });

    const btnSaveHome = document.getElementById('btnSaveHomeLocation');
    if (btnSaveHome) {
        btnSaveHome.addEventListener('click', () => {
            const label = String(document.getElementById('homeLocationLabel')?.value || 'Mi Casa').trim() || 'Mi Casa';
            const address = String(document.getElementById('homeLocationAddress')?.value || '').trim();
            const mapsUrl = String(homeMapsInput?.value || '').trim();
            const rawLat = String(homeLatInput?.value || '').trim();
            const rawLng = String(homeLngInput?.value || '').trim();
            const lat = rawLat !== '' ? Number(rawLat) : null;
            const lng = rawLng !== '' ? Number(rawLng) : null;
            const hasPair = lat !== null && lng !== null && isValidNonZeroCoordPair(lat, lng);

            if (!hasPair && !mapsUrl && !address) {
                setPlannerBanner('err', 'Enter your Saltillo street address, paste a Google Maps link, or enter valid Home coordinates first.');
                showToast('err', 'Enter a Home address, Maps link, or coordinates.');
                return;
            }

            runWithButtonLock(btnSaveHome, async () => {
                try {
                    const body = { target: 'home', label, address, mapsUrl };
                    if (hasPair) {
                        body.lat = lat;
                        body.lng = lng;
                    } else if (address && !mapsUrl) {
                        body.query = address;
                    }
                    const resData = await submitMutationRequest({
                        url: '/api/planner/location',
                        method: 'POST',
                        scopeKey: 'planner-save-home',
                        signature: `${label}:${address}:${mapsUrl}:${rawLat}:${rawLng}`,
                        buildBody: () => body,
                        parseJson: true
                    });
                    if (resData?.planner) {
                        academicPlannerState = resData.planner;
                        renderPlannerResidenciasAndWorkUI();
                    }
                    if (resData?.commutePreview) renderLiveCommuteCards(resData.commutePreview);
                    const msg = resData?.geocodedDisplayName
                        ? `Home located (${resData.geocodedDisplayName}) & routes recalculated!`
                        : (resData?.message || 'Home location saved & verified!');
                    setPlannerBanner('ok', msg);
                    showToast('ok', msg);
                } catch (err) {
                    setPlannerBanner('err', err.message || 'Could not save or geocode Home location.');
                    showToast('err', err.message || 'Could not locate Home address.');
                }
            }, { loadingText: 'Locating...' });
        });
    }

    document.getElementById('btnPingPhoneGps')?.addEventListener('click', (e) => {
        triggerPingPhoneForGps(e.currentTarget, document.getElementById('plannerStatusBanner'));
    });

    document.getElementById('btnClearCurrentGps')?.addEventListener('click', (e) => {
        triggerClearCurrentGpsOrigin(e.currentTarget);
    });

    const btnLoadWebhook = document.getElementById('btnLoadPhoneWebhook');
    const btnRotateWebhook = document.getElementById('btnRotatePhoneWebhook');
    const btnCopyWebhook = document.getElementById('btnCopyPhoneWebhook');
    const webhookBox = document.getElementById('phoneWebhookCredentialsBox');
    const webhookUrlCode = document.getElementById('phoneWebhookUrlCode');

    const renderPhoneWebhookPayload = (data) => {
        if (webhookUrlCode && data?.webhookPostUrl) {
            webhookUrlCode.textContent = data.webhookPostUrl;
        }
        if (webhookBox) webhookBox.hidden = false;
    };

    if (btnLoadWebhook) {
        btnLoadWebhook.addEventListener('click', () => {
            runWithButtonLock(btnLoadWebhook, async () => {
                try {
                    const res = await fetch('/api/planner/phone-gps-token', { cache: 'no-store' });
                    if (!res.ok) throw new Error(await res.text() || 'Could not load phone GPS webhook.');
                    const data = await res.json();
                    renderPhoneWebhookPayload(data);
                    showToast('ok', 'Phone HTTP webhook URL ready.');
                } catch (err) {
                    showToast('err', err.message);
                }
            }, { loadingText: 'Loading...' });
        });
    }

    if (btnRotateWebhook) {
        btnRotateWebhook.addEventListener('click', () => {
            runWithButtonLock(btnRotateWebhook, async () => {
                try {
                    const data = await submitMutationRequest({
                        url: '/api/planner/phone-gps-token/rotate',
                        method: 'POST',
                        scopeKey: 'planner-rotate-phone-webhook',
                        signature: String(Date.now()),
                        buildBody: () => ({}),
                        parseJson: true
                    });
                    renderPhoneWebhookPayload(data);
                    showToast('ok', data?.message || 'Phone webhook token rotated.');
                } catch (err) {
                    showToast('err', err.message || 'Could not rotate token.');
                }
            }, { loadingText: 'Rotating...' });
        });
    }

    if (btnCopyWebhook && webhookUrlCode) {
        btnCopyWebhook.addEventListener('click', async () => {
            const urlText = String(webhookUrlCode.textContent || '').trim();
            if (!urlText) return;
            const copied = await copyTextToClipboard(urlText);
            showToast(copied ? 'ok' : 'info', copied
                ? 'Signed Phone GPS Webhook URL copied!'
                : 'Long-press the URL box to copy.');
        });
    }

    const btnSaveAll = document.getElementById('btnSaveAllPlanner');
    if (btnSaveAll) {
        btnSaveAll.addEventListener('click', () => {
            const payload = collectPlannerStateFromDOM();
            if (!payload) return;
            runWithButtonLock(btnSaveAll, async () => {
                try {
                    const resData = await submitMutationRequest({
                        url: '/api/planner',
                        method: 'PUT',
                        scopeKey: 'planner-save-all',
                        signature: JSON.stringify(payload),
                        buildBody: () => payload,
                        parseJson: true
                    });
                    if (resData?.planner) {
                        academicPlannerState = resData.planner;
                        renderPlannerSemesterUI();
                        renderPlannerVacationsUI();
                        renderPlannerResidenciasAndWorkUI();
                    }
                    if (resData?.commutePreview) renderLiveCommuteCards(resData.commutePreview);
                    setPlannerBanner('ok', resData.message || 'ITS Schedule, Vacations, Residencias, Work & Locations saved!');
                    showToast('ok', 'Planner saved!');
                    cargarRecordatoriosActivos();
                } catch (err) {
                    setPlannerBanner('err', 'Failed to save planner: ' + err.message);
                    showToast('err', err.message);
                }
            }, { loadingText: 'Saving...' });
        });
    }

    const btnSyncWeek = document.getElementById('btnSyncScheduleToAgenda');
    if (btnSyncWeek) {
        btnSyncWeek.addEventListener('click', () => {
            const payload = collectPlannerStateFromDOM();
            runWithButtonLock(btnSyncWeek, async () => {
                try {
                    if (payload) {
                        await submitMutationRequest({
                            url: '/api/planner',
                            method: 'PUT',
                            scopeKey: 'planner-save-before-sync',
                            signature: JSON.stringify(payload),
                            buildBody: () => payload,
                            parseJson: true
                        });
                    }
                    const syncRes = await submitMutationRequest({
                        url: '/api/planner/sync-agenda',
                        method: 'POST',
                        scopeKey: 'planner-sync-agenda',
                        signature: String(Date.now()),
                        buildBody: () => ({ weekStartDate: getMonday(new Date()) ? formatLocalDate(getMonday(new Date())) : formatLocalDate(new Date()) }),
                        parseJson: true
                    });
                    setPlannerBanner('ok', syncRes.message || 'Synced classes, Residencias & work to Weekly Agenda!');
                    showToast('ok', syncRes.message || 'Synced to Weekly Agenda!');
                } catch (err) {
                    setPlannerBanner('err', 'Failed to sync to Agenda: ' + err.message);
                    showToast('err', err.message);
                }
            }, { loadingText: 'Syncing...' });
        });
    }
}

// ==========================================
// INTERACTIVE REPERTOIRE BROWSER (ARTIST -> ALBUM -> SONG)
// ==========================================
function buildMusicRepertoireBuckets() {
    const artistMap = new Map();
    (musicState.songs || []).forEach(song => {
        const artists = Array.isArray(song.artists) && song.artists.length
            ? song.artists
            : [{ id: 0, nombre: 'Unknown Artist', rol: 'main' }];
        artists.forEach(art => {
            if (!artistMap.has(art.id)) {
                artistMap.set(art.id, {
                    id: art.id,
                    nombre: art.nombre,
                    albums: new Map()
                });
            }
            const bucket = artistMap.get(art.id);
            const albumKey = song.album_id ? `alb_${song.album_id}` : 'single_none';
            if (!bucket.albums.has(albumKey)) {
                bucket.albums.set(albumKey, {
                    key: albumKey,
                    titulo: song.album_titulo || 'Standalone Singles & Tracks',
                    tipo: song.album_titulo ? (song.album_tipo || 'album') : 'single',
                    anio: song.album_anio || null,
                    songs: []
                });
            }
            bucket.albums.get(albumKey).songs.push(song);
        });
    });
    return Array.from(artistMap.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function renderMusicRepertoireNavigator() {
    const artistListEl = document.getElementById('repArtistList');
    const albumListEl = document.getElementById('repAlbumList');
    const songListEl = document.getElementById('repSongList');
    const navWrap = document.getElementById('musicRepertoireNavigator');
    if (!artistListEl || !albumListEl || !songListEl || !navWrap) return;

    const artists = buildMusicRepertoireBuckets();
    if (!artists.length) {
        navWrap.hidden = true;
        return;
    }
    navWrap.hidden = false;

    if (!artists.some(a => String(a.id) === String(musicState.navArtistId))) {
        musicState.navArtistId = artists[0].id;
    }

    const renderSongsColumn = (artistObj, albumObj) => {
        songListEl.replaceChildren();
        const songs = albumObj
            ? albumObj.songs
            : Array.from(artistObj.albums.values()).flatMap(al => al.songs);
        const uniqueSongs = [];
        const seenIds = new Set();
        songs.forEach(s => {
            if (!seenIds.has(s.id)) {
                seenIds.add(s.id);
                uniqueSongs.push(s);
            }
        });
        uniqueSongs.sort((a, b) => (a.numero_pista || 999) - (b.numero_pista || 999) || a.titulo.localeCompare(b.titulo));

        uniqueSongs.forEach(song => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'rep-item';
            if (Number(musicState.selectedSongId) === Number(song.id)) {
                btn.classList.add('active');
            }
            const label = document.createElement('span');
            label.textContent = `${song.numero_pista ? `${song.numero_pista}. ` : ''}${song.titulo}`;
            const tag = document.createElement('span');
            tag.className = 'rep-item-count';
            tag.textContent = song.idioma === 'Korean' ? 'KR' : (song.idioma === 'English + Korean (K-Pop)' ? 'EN+KR' : 'EN');
            btn.append(label, tag);
            btn.title = 'Click to select song for Word Notes & AI Tutor';
            btn.addEventListener('click', () => {
                seleccionarCancionParaEstudio(song);
                renderMusicRepertoireNavigator();
                showToast('info', `Selected "${song.titulo}" for Study & AI Tutor.`);
            });
            songListEl.appendChild(btn);
        });
    };

    const renderAlbumsColumn = (artistObj) => {
        albumListEl.replaceChildren();
        const albums = Array.from(artistObj.albums.values()).sort((a, b) => {
            if (a.key === 'single_none') return 1;
            if (b.key === 'single_none') return -1;
            return (b.anio || 0) - (a.anio || 0) || a.titulo.localeCompare(b.titulo);
        });

        const allBtn = document.createElement('button');
        allBtn.type = 'button';
        allBtn.className = `rep-item${musicState.navAlbumKey === null ? ' active' : ''}`;
        const allSpan = document.createElement('span');
        allSpan.textContent = 'All Releases';
        const allCount = document.createElement('span');
        allCount.className = 'rep-item-count';
        allCount.textContent = String(albums.reduce((n, al) => n + al.songs.length, 0));
        allBtn.append(allSpan, allCount);
        allBtn.addEventListener('click', () => {
            musicState.navAlbumKey = null;
            renderAlbumsColumn(artistObj);
            renderSongsColumn(artistObj, null);
        });
        albumListEl.appendChild(allBtn);

        let activeAlbum = null;
        albums.forEach(al => {
            const isActive = musicState.navAlbumKey === al.key;
            if (isActive) activeAlbum = al;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `rep-item${isActive ? ' active' : ''}`;
            const label = document.createElement('span');
            label.textContent = al.anio ? `${al.titulo} (${al.anio})` : al.titulo;
            const cnt = document.createElement('span');
            cnt.className = 'rep-item-count';
            cnt.textContent = String(al.songs.length);
            btn.append(label, cnt);

            const focusAlbum = () => {
                musicState.navAlbumKey = al.key;
                renderAlbumsColumn(artistObj);
                renderSongsColumn(artistObj, al);
            };
            btn.addEventListener('click', () => {
                focusAlbum();
                if (!musicState.editingSongId && al.key !== 'single_none') {
                    const albInput = document.getElementById('musicAlbumTitle');
                    const albType = document.getElementById('musicAlbumType');
                    const albYear = document.getElementById('musicAlbumYear');
                    if (albInput) albInput.value = al.titulo;
                    if (albType && al.tipo) albType.value = al.tipo;
                    if (albYear && al.anio) albYear.value = String(al.anio);
                }
            });
            btn.addEventListener('mouseenter', () => {
                renderSongsColumn(artistObj, al);
            });
            albumListEl.appendChild(btn);
        });

        renderSongsColumn(artistObj, activeAlbum);
    };

    artistListEl.replaceChildren();
    let activeArtist = artists[0];
    artists.forEach(art => {
        const isActive = String(art.id) === String(musicState.navArtistId);
        if (isActive) activeArtist = art;
        const totalSongs = Array.from(art.albums.values()).reduce((sum, al) => sum + al.songs.length, 0);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `rep-item${isActive ? ' active' : ''}`;
        const label = document.createElement('span');
        label.textContent = art.nombre;
        const cnt = document.createElement('span');
        cnt.className = 'rep-item-count';
        cnt.textContent = String(totalSongs);
        btn.append(label, cnt);

        btn.addEventListener('mouseenter', () => {
            if (String(musicState.navArtistId) !== String(art.id)) {
                musicState.navArtistId = art.id;
                musicState.navAlbumKey = null;
                renderMusicRepertoireNavigator();
            }
        });
        btn.addEventListener('click', () => {
            musicState.navArtistId = art.id;
            musicState.navAlbumKey = null;
            renderMusicRepertoireNavigator();
            if (!musicState.editingSongId) {
                const artInput = document.getElementById('musicMainArtist');
                const artTypeInput = document.getElementById('musicMainArtistType');
                if (artInput) artInput.value = art.nombre;
                const matchedArtist = (musicState.artists || []).find(a => Number(a.id) === Number(art.id));
                if (artTypeInput && matchedArtist?.tipo_artista) {
                    artTypeInput.value = matchedArtist.tipo_artista;
                }
            }
        });
        artistListEl.appendChild(btn);
    });

    renderAlbumsColumn(activeArtist);
}

// ==========================================
// CRISIS LOG (BITÁCORA CLÍNICA PARA PSIQUIATRA)
// ==========================================
function prefillCrisisCurrentTimestamp() {
    const now = new Date();
    const fechaEl = document.getElementById('crisisFecha');
    const horaEl = document.getElementById('crisisHora');
    if (fechaEl) fechaEl.value = formatLocalDate(now);
    if (horaEl) {
        horaEl.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
}

function formatCrisisDateLabel(rawFecha) {
    if (!rawFecha) return '--';
    const iso = String(rawFecha).slice(0, 10);
    const parts = iso.split('-');
    if (parts.length !== 3) return iso;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return Number.isNaN(d.getTime())
        ? iso
        : d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function renderCrisisCards(container, rows, { allowDelete = false } = {}) {
    if (!container) return;
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
        const p = document.createElement('p');
        p.className = 'muted-text';
        p.textContent = allowDelete
            ? 'No crisis episodes recorded yet. If you have an episode, log date, time, and trigger in Spanish here.'
            : 'No crisis episodes recorded during this week.';
        container.replaceChildren(p);
        return;
    }

    const fragment = document.createDocumentFragment();
    list.forEach(item => {
        const card = document.createElement('div');
        card.className = 'crisis-entry-card';

        const head = document.createElement('div');
        head.className = 'crisis-entry-head';

        const badges = document.createElement('div');
        badges.className = 'crisis-entry-badges';

        const dateStrong = document.createElement('strong');
        dateStrong.textContent = `📅 ${formatCrisisDateLabel(item.fecha)} · 🕒 ${String(item.hora || '--:--').slice(0, 5)}`;

        const typeBadge = document.createElement('span');
        typeBadge.className = 'crisis-type-badge';
        typeBadge.textContent = item.tipo_crisis || 'Crisis';

        const intBadge = document.createElement('span');
        intBadge.className = 'crisis-intensity-badge';
        const intVal = Number(item.intensidad || 3);
        intBadge.textContent = `Intensidad ${intVal}/5`;

        badges.append(dateStrong, typeBadge, intBadge);
        head.appendChild(badges);

        if (allowDelete && item.id) {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn-secondary btn-small';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async () => {
                const ok = await openConfirmDialog({
                    title: 'Delete Crisis Entry?',
                    message: 'Remove this crisis episode from your clinical log?',
                    confirmText: 'Delete',
                    danger: true
                });
                if (!ok) return;
                runWithButtonLock(delBtn, async () => {
                    const res = await fetch(`/api/delete-crisis/${item.id}`, { method: 'DELETE' });
                    if (res.ok) {
                        showToast('ok', 'Crisis record removed.');
                        cargarCrisisRecientes();
                    } else {
                        showToast('err', 'Could not remove crisis record.');
                    }
                }, { loadingText: '...' });
            });
            head.appendChild(delBtn);
        }

        const motivoP = document.createElement('p');
        motivoP.className = 'crisis-entry-motivo';
        motivoP.textContent = item.motivo || '';

        card.append(head, motivoP);
        fragment.appendChild(card);
    });

    container.replaceChildren(fragment);
}

function cargarCrisisRecientes() {
    if (!currentUser || currentUser.rol !== 'admin') return;
    const container = document.getElementById('crisisHistoryList');
    const countEl = document.getElementById('crisisRecentCount');
    if (!container) return;

    fetch('/api/get-crisis', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : []))
        .then(rows => {
            const list = Array.isArray(rows) ? rows : [];
            if (countEl) countEl.textContent = `${list.length} record${list.length === 1 ? '' : 's'}`;
            renderCrisisCards(container, list, { allowDelete: true });
        })
        .catch(() => renderCrisisCards(container, [], { allowDelete: true }));
}

function initCrisisHandlers() {
    const form = document.getElementById('crisisForm');
    if (!form) return;

    prefillCrisisCurrentTimestamp();

    const btnNow = document.getElementById('btnCrisisUseNow');
    if (btnNow) {
        btnNow.addEventListener('click', () => {
            prefillCrisisCurrentTimestamp();
            showToast('info', 'Updated to current date & time.');
        });
    }

    const tipoHidden = document.getElementById('crisisTipo');
    document.querySelectorAll('#crisisTipoPills [data-crisis-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.getAttribute('data-crisis-type') || 'Estrés';
            if (tipoHidden) tipoHidden.value = val;
            document.querySelectorAll('#crisisTipoPills [data-crisis-type]').forEach(b =>
                b.classList.toggle('active', b === btn)
            );
        });
    });

    const intHidden = document.getElementById('crisisIntensidad');
    document.querySelectorAll('#crisisIntensityPills [data-crisis-intensity]').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.getAttribute('data-crisis-intensity') || '3';
            if (intHidden) intHidden.value = val;
            document.querySelectorAll('#crisisIntensityPills [data-crisis-intensity]').forEach(b =>
                b.classList.toggle('active', b === btn)
            );
        });
    });

    form.addEventListener('submit', e => {
        e.preventDefault();
        const btnSave = document.getElementById('btnSaveCrisis');
        const fecha = (document.getElementById('crisisFecha')?.value || '').trim();
        const hora = (document.getElementById('crisisHora')?.value || '').trim();
        const tipoCrisis = (document.getElementById('crisisTipo')?.value || 'Estrés').trim();
        const intensidad = Number(document.getElementById('crisisIntensidad')?.value || 3);
        const motivo = (document.getElementById('crisisMotivo')?.value || '').trim();

        if (!fecha || !hora || !motivo) {
            setInlineBanner('crisisStatusBanner', 'err', 'Completa la fecha, hora y el motivo en español.');
            return;
        }
        setInlineBanner('crisisStatusBanner', '', '');

        runWithButtonLock(btnSave, async () => {
            try {
                const res = await fetch('/api/insert-crisis', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fecha, hora, tipoCrisis, intensidad, motivo })
                });
                if (!res.ok) throw new Error(await res.text() || 'Error saving crisis log.');
                document.getElementById('crisisMotivo').value = '';
                prefillCrisisCurrentTimestamp();
                setInlineBanner('crisisStatusBanner', 'ok', 'Crisis guardada correctamente (visible para tu psiquiatra/psicóloga en Resumen Semanal).');
                showToast('ok', 'Crisis episode saved.');
                cargarCrisisRecientes();
            } catch (err) {
                setInlineBanner('crisisStatusBanner', 'err', err.message || 'Could not save crisis record.');
            }
        }, { loadingText: 'Saving...' });
    });
}

// ==========================================
// OPTIMAL KEYBOARD SHORTCUTS (ENTER / CTRL+ENTER)
// ==========================================
function initKeyboardShortcuts() {
    const bindEnterToButton = (inputId, buttonId, { ctrlOrCmd = false, multilinePlainEnter = false } = {}) => {
        const input = document.getElementById(inputId);
        const btn = document.getElementById(buttonId);
        if (!input || !btn) return;
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (e.isComposing) return;
            if (ctrlOrCmd) {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    btn.click();
                }
                return;
            }
            if (multilinePlainEnter) {
                if (!e.shiftKey) {
                    e.preventDefault();
                    btn.click();
                }
                return;
            }
            e.preventDefault();
            btn.click();
        });
    };

    // Music search -> Enter immediately searches YT
    bindEnterToButton('musicYtSearchQuery', 'btnMusicSearchYt');
    // YouTube URL field -> Enter auto-fills title & artist
    bindEnterToButton('musicSongYtUrl', 'btnMusicResolveYt');
    // AI Question box -> Enter asks AI (Shift+Enter adds newline)
    bindEnterToButton('langAiQuestion', 'btnAskLangAi', { multilinePlainEnter: true });
    // Lyrics study textarea -> Ctrl+Enter runs AI Lyrics Breakdown
    bindEnterToButton('musicStudyLyrics', 'btnMusicAiExplainLyrics', { ctrlOrCmd: true });
    // Crisis Spanish reason textarea -> Ctrl+Enter saves immediately
    bindEnterToButton('crisisMotivo', 'btnSaveCrisis', { ctrlOrCmd: true });
    // Sleep desvelo note textarea -> Ctrl+Enter saves sleep log
    bindEnterToButton('sleepMotivoDesvelo', 'btn-save-sleep', { ctrlOrCmd: true });

    // Catalog search filter -> Enter selects first visible matching song in catalog
    const filterSearchEl = document.getElementById('musicFilterSearch');
    if (filterSearchEl) {
        filterSearchEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const firstRow = document.querySelector('#musicCatalogContainer .music-song-row[data-song-id]');
            const songId = firstRow ? Number(firstRow.getAttribute('data-song-id')) : 0;
            const match = (musicState.songs || []).find(s => Number(s.id) === songId);
            if (match) {
                seleccionarCancionParaEstudio(match);
                renderMusicRepertoireNavigator();
                showToast('info', `Selected "${match.titulo}" from catalog.`);
            }
        });
    }
}

// ==========================================
// APP INITIALIZATION
// ==========================================
function initApp() {
    initTheme();
    actualizarCabecerasDeFecha();
    initPasswordToggles();
    initAuthHandlers();
    initSettingsHandlers();
    initLanguageAiStudio();
    initWordStyleProofing();
    initAcademicPlannerHandlers();
    initQuickLocationModal();
    initCrisisHandlers();
    initMusicEntityEditModal();
    initKeyboardShortcuts();

    if (clientTransportTunnel && rawBrowserFetch) {
        clientTransportTunnel.establishSession(rawBrowserFetch)
            .then(() => updateTransportStatusBadges())
            .catch(() => updateTransportStatusBadges());
    } else {
        updateTransportStatusBadges();
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('resetToken') && params.get('email')) {
        const resetEmailEl = document.getElementById('resetEmail');
        const resetTokenEl = document.getElementById('resetTokenInput');
        if (resetEmailEl) resetEmailEl.value = params.get('email');
        if (resetTokenEl) resetTokenEl.value = params.get('resetToken');
        showAuthScreen('authResetForm');
        return;
    }

    fetch('/api/auth/me', { cache: 'no-store' })
        .then(res => {
            if (!res.ok) throw new Error('Not authenticated');
            return res.json();
        })
        .then(data => {
            enterAppSession(data.user);
        })
        .catch(() => {
            showAuthScreen('authLoginForm');
        });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
