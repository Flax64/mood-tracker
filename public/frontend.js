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

function i18nGetLang() {
    return (typeof window !== 'undefined' && window.DailyHubI18n && typeof window.DailyHubI18n.getLang === 'function')
        ? window.DailyHubI18n.getLang()
        : 'en';
}

function tUi(en, es) {
    return (typeof window !== 'undefined' && window.DailyHubI18n && typeof window.DailyHubI18n.pick === 'function')
        ? window.DailyHubI18n.pick(en, es)
        : en;
}

function tServer(msg) {
    if (!msg) return '';
    return (typeof window !== 'undefined' && window.DailyHubI18n && typeof window.DailyHubI18n.translateServerMessage === 'function')
        ? window.DailyHubI18n.translateServerMessage(msg)
        : String(msg);
}

function tLocale() {
    return (typeof window !== 'undefined' && window.DailyHubI18n && typeof window.DailyHubI18n.locale === 'function')
        ? window.DailyHubI18n.locale()
        : 'en-US';
}

function protectUserNode(el) {
    if (el && typeof el.setAttribute === 'function') {
        el.setAttribute('data-no-i18n', 'true');
    }
    return el;
}

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
            authPill.textContent = tUi('⚠️ Wire: Plain HTTP fallback', '⚠️ Wire: HTTP plano (respaldo)');
            authPill.classList.add('is-pending');
        }
        setSidebarBadge('⚠️', tUi('Wire: Standard HTTP', 'Wire: HTTP estándar'));
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
            diagStats.textContent = tUi(
                `${totalReqs} encrypted msgs · ${formatCompactBytes(totalBytes)} on wire`,
                `${totalReqs} mensajes cifrados · ${formatCompactBytes(totalBytes)} en red`
            );
        }
    } else {
        if (authPill) {
            authPill.textContent = tUi('🔐 Wire Tunnel: Establishing X25519...', '🔐 Túnel Wire: Estableciendo X25519...');
            authPill.classList.add('is-pending');
        }
        setSidebarBadge('🔐', tUi('Wire: Connecting...', 'Wire: Conectando...'));
        if (diagKid) diagKid.textContent = tUi('Pending X25519 handshake...', 'Esperando handshake X25519...');
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
        if (!headers.has('X-UI-Lang')) {
            headers.set('X-UI-Lang', i18nGetLang());
        }
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
            return rawBrowserFetch(input, { ...init, headers });
        }

        const originalBody = typeof init.body === 'string' ? init.body : null;

        const sendAttempt = async () => {
            const attemptHeaders = new Headers(headers);
            const diagNow = clientTransportTunnel.getDiagnostics();
            if (diagNow.kid) {
                attemptHeaders.set('X-Transport-Session', diagNow.kid);
            }
            attemptHeaders.set('X-Transport-Accept-Enc', '1');
            if (!attemptHeaders.has('X-UI-Lang')) {
                attemptHeaders.set('X-UI-Lang', i18nGetLang());
            }

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
} else if (rawBrowserFetch) {
    window.fetch = async function langHeaderFetch(input, init = {}) {
        const urlStr = typeof input === 'string'
            ? input
            : (input && typeof input.url === 'string' ? input.url : '');
        if (!urlStr.startsWith('/api/')) {
            return rawBrowserFetch(input, init);
        }
        const headers = new Headers(init.headers || {});
        if (!headers.has('X-UI-Lang')) {
            headers.set('X-UI-Lang', i18nGetLang());
        }
        return rawBrowserFetch(input, { ...init, headers });
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
        return { moodKey: 'Madrugada', moodLabel: tUi('Late Night', 'Madrugada'), saludo: tUi('Good early morning!', '¡Buen inicio de madrugada!'), agendaBloque: 'noche' };
    }
    if (hour >= 6 && hour < 12) {
        return { moodKey: 'Morning', moodLabel: tUi('Morning', 'Mañana'), saludo: tUi('Good morning!', '¡Buenos días!'), agendaBloque: hour < 9 ? 'manana' : 'cole' };
    }
    if (hour >= 12 && hour < 14) {
        return { moodKey: 'Noon', moodLabel: tUi('Noon', 'Mediodía'), saludo: tUi('Good afternoon!', '¡Buenas tardes!'), agendaBloque: 'cole' };
    }
    if (hour >= 14 && hour < 20) {
        return { moodKey: 'Afternoon', moodLabel: tUi('Afternoon', 'Tarde'), saludo: tUi('Good afternoon!', '¡Buenas tardes!'), agendaBloque: 'tarde' };
    }
    return { moodKey: 'Night', moodLabel: tUi('Night', 'Noche'), saludo: tUi('Good evening!', '¡Buenas noches!'), agendaBloque: 'noche' };
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

function formatHumanNetworkError(status, rawText = '', err = null) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return tUi(
            'No internet connection. Your notes remain saved locally; retry when the network is back.',
            'Sin conexión a internet. Tus notas permanecen guardadas localmente; reintenta cuando vuelva la red.'
        );
    }
    if (err && err.name === 'TimeoutError') {
        return tUi(
            'Connection took too long to respond (timeout). Retry in a few seconds.',
            'La conexión tardó demasiado en responder (timeout). Reintenta en unos segundos.'
        );
    }
    if (isAbortError(err)) {
        return tUi(
            'Request aborted or timed out due to unstable network. Retry without reloading the page.',
            'Petición cancelada o tiempo agotado por red inestable. Reintenta sin recargar la página.'
        );
    }
    if (err && /failed to fetch|networkerror|load failed/i.test(String(err.message || ''))) {
        return tUi(
            'Could not reach the server (unstable or disconnected network). Your data was not lost.',
            'No se pudo contactar al servidor (red inestable o desconectada). Tus datos no se perdieron.'
        );
    }
    if (status === 401) {
        return tUi(
            'Your session expired. Sign in again (your local drafts remain safe).',
            'Tu sesión expiró. Vuelve a iniciar sesión (tus borradores locales se mantienen seguros).'
        );
    }
    if (status === 429) {
        return tUi(
            'Too many requests in a row. Wait a few seconds and try again.',
            'Demasiadas peticiones seguidas. Espera unos segundos e intenta de nuevo.'
        );
    }
    if (status === 502 || status === 503 || status === 504) {
        return tUi(
            `The server or proxy temporarily responded with HTTP ${status}. Retry in a moment.`,
            `El servidor o proxy respondió temporalmente con HTTP ${status}. Reintenta en un momento.`
        );
    }
    const cleanText = String(rawText || '').trim();
    if (!cleanText || /^\s*</.test(cleanText)) {
        return status
            ? tUi(`Temporary network/server error (HTTP ${status}).`, `Error temporal de red/servidor (HTTP ${status}).`)
            : tUi('Unexpected network error.', 'Error de red inesperado.');
    }
    return tServer(cleanText.slice(0, 260));
}

async function resilientFetchJson(url, fetchOpts = {}, { timeoutMs = 26000, externalSignal = null } = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    const timer = controller && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs)
        : null;
    const onExternalAbort = () => {
        if (controller) controller.abort();
    };
    if (externalSignal && typeof externalSignal.addEventListener === 'function') {
        if (externalSignal.aborted) controller?.abort();
        else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
        const mergedHeaders = new Headers(fetchOpts.headers || {});
        if (!mergedHeaders.has('X-UI-Lang')) {
            mergedHeaders.set('X-UI-Lang', i18nGetLang());
        }
        const res = await fetch(url, {
            ...fetchOpts,
            headers: mergedHeaders,
            signal: controller ? controller.signal : externalSignal || undefined
        });
        const rawText = await res.text();
        if (!res.ok) {
            return {
                ok: false,
                aborted: false,
                status: res.status,
                data: null,
                isNetworkIssue: res.status >= 500 || res.status === 0,
                errorMessage: formatHumanNetworkError(res.status, rawText)
            };
        }
        try {
            const parsed = rawText ? JSON.parse(rawText) : {};
            return { ok: true, aborted: false, status: res.status, data: parsed, isNetworkIssue: false, errorMessage: '' };
        } catch (_) {
            return {
                ok: false,
                aborted: false,
                status: res.status,
                data: null,
                isNetworkIssue: true,
                errorMessage: tUi(
                    'Unexpected server response (possible network cut). Retry.',
                    'Respuesta inesperada del servidor (posible corte de red). Reintenta.'
                )
            };
        }
    } catch (err) {
        if (isAbortError(err) && !timedOut && externalSignal?.aborted) {
            return { ok: false, aborted: true, status: 0, data: null, isNetworkIssue: false, errorMessage: '' };
        }
        const effectiveErr = timedOut ? Object.assign(new Error('Request timeout'), { name: 'TimeoutError' }) : err;
        return {
            ok: false,
            aborted: false,
            status: 0,
            data: null,
            isNetworkIssue: true,
            errorMessage: formatHumanNetworkError(0, '', effectiveErr)
        };
    } finally {
        if (timer) clearTimeout(timer);
        if (externalSignal && typeof externalSignal.removeEventListener === 'function') {
            externalSignal.removeEventListener('abort', onExternalAbort);
        }
    }
}

function hangulToRomanizationClient(text = '') {
    const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
    const MEDIALS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
    const FINALS = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'lk', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
    return String(text || '')
        .split(/(\s+)/)
        .map(chunk => {
            if (!chunk || /^\s+$/.test(chunk)) return chunk;
            let out = '';
            let prevHangul = false;
            for (const ch of chunk) {
                const code = ch.charCodeAt(0);
                if (code >= 0xAC00 && code <= 0xD7A3) {
                    const offset = code - 0xAC00;
                    const iIdx = Math.floor(offset / 588);
                    const mIdx = Math.floor((offset % 588) / 28);
                    const fIdx = offset % 28;
                    const syl = `${INITIALS[iIdx]}${MEDIALS[mIdx]}${FINALS[fIdx]}`;
                    out += (prevHangul ? '-' : '') + syl;
                    prevHangul = true;
                } else {
                    out += ch;
                    prevHangul = false;
                }
            }
            return out;
        })
        .join('')
        .trim();
}

function renderAiNetworkFallback(container, { title = 'Conexión inestable o sin red', message = '', sampleText = '', onRetry = null, onInsertOfflineRom = null } = {}) {
    if (!container) return;
    container.replaceChildren();
    container.hidden = false;

    const card = document.createElement('div');
    card.className = 'ai-network-fallback';

    const strong = document.createElement('strong');
    strong.textContent = `⚠️ ${title}`;
    const desc = document.createElement('p');
    desc.className = 'muted-text';
    desc.style.margin = '0';
    desc.textContent = message || 'No se pudo completar la consulta en línea. Tus notas escritas permanecen intactas.';
    card.append(strong, desc);

    const hasHangul = /[\uAC00-\uD7A3]/.test(String(sampleText || ''));
    const offlineRom = hasHangul ? hangulToRomanizationClient(sampleText) : '';
    if (offlineRom) {
        const romBox = document.createElement('div');
        romBox.className = 'ai-line-rom';
        romBox.textContent = `Romanización local sin internet: ${offlineRom}`;
        card.appendChild(romBox);
    }

    const actions = document.createElement('div');
    actions.className = 'ai-network-fallback-actions';
    if (typeof onRetry === 'function') {
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'btn-secondary btn-small';
        retryBtn.textContent = '🔄 Reintentar conexión';
        retryBtn.addEventListener('click', () => onRetry());
        actions.appendChild(retryBtn);
    }
    if (offlineRom && typeof onInsertOfflineRom === 'function') {
        const useRomBtn = document.createElement('button');
        useRomBtn.type = 'button';
        useRomBtn.className = 'btn-mini-add';
        useRomBtn.textContent = '↘ Usar romanización local en notas';
        useRomBtn.addEventListener('click', () => onInsertOfflineRom(offlineRom));
        actions.appendChild(useRomBtn);
    }
    if (actions.childElementCount) {
        card.appendChild(actions);
    }
    container.appendChild(card);
}

const STUDY_DRAFTS_CONFIG = {
    english: ['engWord', 'engRomanization', 'engSpanish', 'engVocabExample', 'engVocabNotes', 'engGrammarTitle', 'engGrammarExplanation', 'engPvVerb', 'engPvMeaningEs'],
    music: ['musicStudyLyrics', 'musicStudyVocab', 'musicStudyPronunciation', 'musicStudyExtraNotes'],
    ai: ['langAiQuestion']
};
const STUDY_DRAFTS_STORAGE_PREFIX = 'mt_study_draft_v1:';

function syncStudyDraftForId(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    try {
        const v = String(el.value || '');
        if (v.trim()) localStorage.setItem(`${STUDY_DRAFTS_STORAGE_PREFIX}${elId}`, v);
        else localStorage.removeItem(`${STUDY_DRAFTS_STORAGE_PREFIX}${elId}`);
    } catch (_) { }
}

function clearStudyNoteDrafts(scope = 'all') {
    const groups = scope === 'all'
        ? [...STUDY_DRAFTS_CONFIG.english, ...STUDY_DRAFTS_CONFIG.music, ...STUDY_DRAFTS_CONFIG.ai]
        : (STUDY_DRAFTS_CONFIG[scope] || []);
    groups.forEach(id => {
        try { localStorage.removeItem(`${STUDY_DRAFTS_STORAGE_PREFIX}${id}`); } catch (_) { }
    });
}

function initStudyNoteDrafts() {
    const allIds = [...STUDY_DRAFTS_CONFIG.english, ...STUDY_DRAFTS_CONFIG.music, ...STUDY_DRAFTS_CONFIG.ai];
    allIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el || el.dataset.draftWired === 'true') return;
        el.dataset.draftWired = 'true';
        try {
            const saved = localStorage.getItem(`${STUDY_DRAFTS_STORAGE_PREFIX}${id}`);
            if (saved && !String(el.value || '').trim()) {
                el.value = saved;
            }
        } catch (_) { }
        el.addEventListener('input', () => syncStudyDraftForId(id));
    });
}

async function submitMutationRequest({
    url,
    method = 'POST',
    scopeKey = '',
    signature = '',
    buildBody = null,
    parseJson = false,
    timeoutMs = 20000
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

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    const timer = controller && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs)
        : null;
    if (controller) fetchOpts.signal = controller.signal;

    try {
        const res = await fetch(url, fetchOpts);
        if (!res.ok) {
            if (scopeKey && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
                clearIdempotentSubmission(scopeKey);
            }
            const errText = await res.text().catch(() => '');
            throw new Error(formatHumanNetworkError(res.status, errText));
        }

        clearIdempotentSubmission(scopeKey);
        return parseJson ? res.json() : res.text();
    } catch (err) {
        if (timedOut || isAbortError(err) || /failed to fetch|networkerror|load failed/i.test(String(err?.message || ''))) {
            const effectiveErr = timedOut ? Object.assign(new Error('Timeout'), { name: 'TimeoutError' }) : err;
            throw new Error(formatHumanNetworkError(0, '', effectiveErr));
        }
        throw err;
    } finally {
        if (timer) clearTimeout(timer);
    }
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
    text.textContent = tServer(String(message));

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'app-toast-close';
    closeBtn.setAttribute('aria-label', tUi('Dismiss notification', 'Cerrar notificación'));
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
    el.textContent = tServer(String(message));
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

function openConfirmDialog({ title, message, confirmText, danger = false } = {}) {
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

    if (titleEl) titleEl.textContent = tServer(title || tUi('Confirm Action', 'Confirmar acción'));
    if (msgEl) msgEl.textContent = tServer(message || tUi('Are you sure?', '¿Estás seguro?'));
    acceptBtn.textContent = tServer(confirmText || tUi('Confirm', 'Confirmar'));
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

function desencriptarTextoE2EE(textoCifrado, llaveTexto) {
    if (!textoCifrado || typeof textoCifrado !== 'string' || !textoCifrado.includes(':')) {
        throw new Error('Formato de respuesta cifrada E2EE inválido.');
    }
    const sepIdx = textoCifrado.indexOf(':');
    const ivHex = textoCifrado.slice(0, sepIdx).trim();
    const cipherB64 = textoCifrado.slice(sepIdx + 1).trim();
    const keyWords = CryptoJS.enc.Utf8.parse(llaveTexto);
    const iv = CryptoJS.enc.Hex.parse(ivHex);
    const cipherParams = CryptoJS.lib.CipherParams.create({
        ciphertext: CryptoJS.enc.Base64.parse(cipherB64)
    });
    const decrypted = CryptoJS.AES.decrypt(cipherParams, keyWords, { iv: iv });
    const plain = decrypted.toString(CryptoJS.enc.Utf8);
    if (!plain && cipherB64) {
        throw new Error('La llave E2EE no coincide para descifrar la respuesta de tu PC.');
    }
    return plain;
}

async function autoQueueAiLearningToWord({ entry, hintEl, songToMarkSynced = null }) {
    if (!entry) return false;
    const renderUnlockPrompt = () => {
        if (!hintEl) return;
        hintEl.hidden = false;
        const msg = document.createTextNode('🔐 Ingresa tu llave E2EE para registrar esto en Word (o RAM si tu PC está apagada): ');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-secondary btn-small';
        btn.textContent = 'Desbloquear y guardar en Word';
        btn.addEventListener('click', async () => {
            const key = await solicitarLlaveE2EEAsync();
            if (key) {
                await autoQueueAiLearningToWord({ entry, hintEl, songToMarkSynced });
            }
        });
        hintEl.replaceChildren(msg, btn);
    };

    const llaveTexto = obtenerLlaveE2EE();
    if (!llaveTexto) {
        renderUnlockPrompt();
        return false;
    }

    try {
        const signature = `ai-auto:${entry.category}:${entry.song_title || entry.word || entry.title || ''}`;
        await submitMutationRequest({
            url: '/api/send-english',
            method: 'POST',
            scopeKey: 'english:ai-auto-word',
            signature,
            buildBody: () => ({ texto: encriptarTextoE2EE(JSON.stringify(entry), llaveTexto) })
        });

        if (songToMarkSynced && songToMarkSynced.id) {
            const nextStatus = songToMarkSynced.estado_estudio === 'to_study' ? 'in_progress' : (songToMarkSynced.estado_estudio || 'in_progress');
            resilientFetchJson(`/api/english/music/songs/${songToMarkSynced.id}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estadoEstudio: nextStatus, wordSynced: true })
            }, { timeoutMs: 8000 }).then(() => {
                songToMarkSynced.word_sincronizado = 1;
            }).catch(() => { });
        }

        if (hintEl) {
            const pcOnline = Boolean(musicState?.ytdlpStatus?.pcOnline);
            hintEl.hidden = false;
            hintEl.textContent = pcOnline
                ? '✅ Aprendizaje cifrado E2EE y enviado a tu Word PC automáticamente.'
                : '☁️ PC offline: aprendizaje guardado cifrado E2EE en la RAM de EC2 (se escribirá en Word al conectar tu PC).';
        }
        return true;
    } catch (err) {
        if (hintEl) {
            hintEl.hidden = false;
            hintEl.textContent = `⚠️ No se pudo encolar a Word automáticamente: ${err.message || 'error de red'}`;
        }
        return false;
    }
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
        return { platform, url: youtubeUrl, shortLabel: 'YouTube', fullLabel: tUi('Open on YouTube (PC)', 'Abrir en YouTube (PC)') };
    }
    if (ytMusicUrl) {
        return { platform: 'yt_music', url: ytMusicUrl, shortLabel: 'YT Music', fullLabel: tUi('Open in YT Music (Mobile)', 'Abrir en YT Music (Móvil)') };
    }
    return { platform, url: youtubeUrl || '', shortLabel: 'YouTube', fullLabel: tUi('Open on YouTube', 'Abrir en YouTube') };
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
        const deviceStr = isMobile ? tUi('📱 Mobile', '📱 Móvil') : tUi('🖥️ PC Browser', '🖥️ Navegador PC');
        const targetStr = isStandardYt
            ? tUi('Standard YouTube (youtube.com)', 'YouTube estándar (youtube.com)')
            : 'YouTube Music (music.youtube.com)';
        badge.textContent = `${deviceStr} → ${targetStr}`;
    }

    document.querySelectorAll('#ytPlatformModeGroup [data-yt-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-yt-mode') === mode);
    });

    const heading = document.getElementById('musicFinderHeading');
    if (heading) {
        heading.textContent = isStandardYt
            ? tUi('YouTube Song Finder (PC Mode)', 'Buscador de YouTube (Modo PC)')
            : tUi('YouTube Music Song Finder (Mobile Mode)', 'Buscador de YT Music (Modo Móvil)');
    }

    const libBtn = document.getElementById('btnMusicOpenYtLibrary');
    if (libBtn) {
        libBtn.textContent = isStandardYt
            ? tUi('Open YouTube Home', 'Abrir YouTube Inicio')
            : tUi('My YT Music Library', 'Mi biblioteca de YT Music');
    }

    const searchBtn = document.getElementById('btnMusicSearchYt');
    if (searchBtn) {
        searchBtn.textContent = isStandardYt
            ? tUi('Find on YouTube', 'Buscar en YouTube')
            : tUi('Find on YT Music', 'Buscar en YT Music');
    }

    const urlInput = document.getElementById('musicSongYtUrl');
    if (urlInput) {
        urlInput.placeholder = isStandardYt
            ? tUi('https://www.youtube.com/watch?v=... or youtu.be/...', 'https://www.youtube.com/watch?v=... o youtu.be/...')
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
const VALID_VIEWS = new Set(['inicio', 'mood', 'crisis', 'sueno', 'journal', 'english', 'agenda', 'horario', 'resumen', 'medico', 'settings', 'guia']);
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
            const rawTitle = section.getAttribute('data-title') || 'Daily Hub';
            mobileViewTitle.textContent = (window.DailyHubI18n && typeof window.DailyHubI18n.translateText === 'function')
                ? window.DailyHubI18n.translateText(rawTitle)
                : rawTitle;
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
    } else if (targetView === 'guia') {
        if (window.DailyHubVisualGuide && typeof window.DailyHubVisualGuide.mount === 'function') {
            window.DailyHubVisualGuide.mount('visualGuideAppHost', { standalone: false });
        }
    }
    if (currentUser && currentUser.rol === 'admin') {
        cargarRecordatoriosActivos();
    }
    if (typeof initResponsiveTextareas === 'function') {
        setTimeout(initResponsiveTextareas, 30);
    }
}

if (typeof window !== 'undefined') {
    window.DailyHubNavigateView = (viewName) => showView(viewName, true);
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
    const fechaLarga = now.toLocaleDateString(tLocale(), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
    const fechaCorta = now.toLocaleDateString(tLocale(), {
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
    if (homeMomentBadge) homeMomentBadge.textContent = `${tUi('Current moment', 'Momento actual')}: ${info.moodLabel}`;
    if (sidebarMomentoActual) sidebarMomentoActual.textContent = `${tUi('Moment', 'Momento')}: ${info.moodLabel}`;
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

    moodBox.replaceChildren(createLoadingBanner(tUi('Loading...', 'Cargando...'), 'sm'));
    sleepBox.replaceChildren(createLoadingBanner(tUi('Loading...', 'Cargando...'), 'sm'));
    agendaBox.replaceChildren(createLoadingBanner(tUi('Loading...', 'Cargando...'), 'sm'));

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
                p.textContent = tUi('No mood entries logged yet today.', 'Aún no hay registros de ánimo hoy.');
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
                const mLbl = (window.DailyHubI18n && typeof window.DailyHubI18n.momentLabel === 'function')
                    ? window.DailyHubI18n.momentLabel(r.momento_dia)
                    : (MOMENTOS_LABELS[r.momento_dia] || r.momento_dia);
                txt.textContent = mLbl;
                chip.append(dot, txt);
                wrap.appendChild(chip);
            });
            moodBox.appendChild(wrap);
        })
        .catch(err => {
            if (isAbortError(err) || !homeSummaryTracker.isCurrent(reqToken.seq)) return;
            moodBox.innerHTML = `<p class="muted-text">${tUi("Could not load today's mood entries.", 'No se pudieron cargar los registros de ánimo de hoy.')}</p>`;
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
                p.textContent = tUi('No sleep log recorded today.', 'Sin registro de sueño hoy.');
                sleepBox.appendChild(p);
                return;
            }
            const totalH = registros.reduce((acc, r) => acc + (parseFloat(r.horas) || 0), 0);
            const desveloRows = registros.filter(r => Number(r.es_desvelo) === 1 || (r.tipo_registro && r.tipo_registro !== 'normal'));
            const hasAllNighter = desveloRows.some(r => r.tipo_registro === 'desvelo_total');
            const p = document.createElement('p');
            p.style.margin = '0';
            const plural = registros.length === 1 ? tUi('session', 'sesión') : tUi('sessions', 'sesiones');
            const strong = document.createElement('strong');
            strong.textContent = formatHoursMinutes(totalH);
            p.append(strong, document.createTextNode(
                tUi(
                    ` logged across ${registros.length} ${plural}.`,
                    ` registrados en ${registros.length} ${plural}.`
                )
            ));
            sleepBox.appendChild(p);
            if (desveloRows.length > 0) {
                const tag = document.createElement('div');
                tag.className = `sleep-desvelo-tag${hasAllNighter ? ' is-total' : ''}`;
                const bedList = desveloRows.map(r => r.hora_dormir ? formatClockTime12h(r.hora_dormir) : '').filter(Boolean);
                tag.textContent = hasAllNighter
                    ? tUi('⚡ Desvelo total / All-nighter logged', '⚡ Desvelo total / Noche sin dormir registrada')
                    : (bedList.length
                        ? tUi(`🦉 Stayed up late (bed ${bedList.join(', ')})`, `🦉 Desvelo (dormiste ${bedList.join(', ')})`)
                        : tUi(`🦉 Stayed up late (${desveloRows.length})`, `🦉 Desvelo (${desveloRows.length})`));
                sleepBox.appendChild(tag);
            }
        })
        .catch(err => {
            if (isAbortError(err) || !homeSummaryTracker.isCurrent(reqToken.seq)) return;
            sleepBox.innerHTML = `<p class="muted-text">${tUi('Could not load sleep summary.', 'No se pudo cargar el resumen de sueño.')}</p>`;
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
                p.textContent = tUi('No activities scheduled for today.', 'Sin actividades programadas para hoy.');
                agendaBox.appendChild(p);
                return;
            }
            const doneItems = items.filter(i => getAgendaItemStatus(i) === 'done').length;
            const inProgItems = items.filter(i => getAgendaItemStatus(i) === 'in_progress').length;
            const uniCount = items.filter(i => (i.categoria || 'personal') === 'universidad').length;
            const perCount = items.length - uniCount;

            const summary = document.createElement('p');
            summary.style.margin = '0';
            summary.textContent = tUi(
                `${doneItems} of ${items.length} done (${uniCount} University · ${perCount} Personal${inProgItems ? ` · ${inProgItems} In Progress` : ''}).`,
                `${doneItems} de ${items.length} completadas (${uniCount} Universidad · ${perCount} Personal${inProgItems ? ` · ${inProgItems} En progreso` : ''}).`
            );
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
                const classMeta = isUni ? resolveAgendaItemClassLabel(item) : null;
                catTag.className = `agenda-cat-pill ${isUni ? 'is-uni' : 'is-personal'}${classMeta ? ' is-class-linked' : ''}`;
                if (classMeta) {
                    protectUserNode(catTag);
                    catTag.textContent = `🎓 ${classMeta.name}`;
                    catTag.title = `${tUi('Class', 'Clase')}: ${classMeta.code ? `${classMeta.code} · ` : ''}${classMeta.name}`;
                } else {
                    catTag.textContent = isUni ? tUi('Uni', 'Univ') : 'Personal';
                }
                const textSpan = document.createElement('span');
                protectUserNode(textSpan);
                textSpan.textContent = item.actividad;
                li.append(timeSpan, catTag, textSpan);
                ul.appendChild(li);
            });
            agendaBox.appendChild(ul);
        })
        .catch(err => {
            if (isAbortError(err) || !homeSummaryTracker.isCurrent(reqToken.seq)) return;
            agendaBox.innerHTML = `<p class="muted-text">${tUi('Agenda unavailable or missing table in DB.', 'Agenda no disponible o tabla faltante en BD.')}</p>`;
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
        title.textContent = (window.DailyHubI18n && typeof window.DailyHubI18n.momentLabel === 'function')
            ? window.DailyHubI18n.momentLabel(block.key)
            : block.label;
        const sub = document.createElement('span');
        sub.textContent = block.range;
        left.append(title, sub);

        const status = document.createElement('div');
        status.className = 'today-check-status';
        if (entry && entry.color_hex) {
            const hex = String(entry.color_hex).toUpperCase();
            const rawMood = MOOD_COLOR_LABELS[hex] || '';
            const label = rawMood && window.DailyHubI18n && typeof window.DailyHubI18n.moodLabel === 'function'
                ? window.DailyHubI18n.moodLabel(rawMood)
                : (rawMood || tUi('Logged', 'Registrado'));
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
            emptyTxt.textContent = tUi('Not logged', 'Sin registrar');
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
        const textoVisual = `${dom.toLocaleDateString(tLocale(), opcMes)} - ${sab.toLocaleDateString(tLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}`;

        const option = document.createElement('option');
        option.value = `${domStr}|${sabStr}`;
        option.dataset.weekRange = `${domStr}|${sabStr}`;
        option.textContent = `${tUi('Week', 'Semana')}: ${textoVisual}`;

        if (i === 0) option.selected = true;

        selectSemana.appendChild(option);
    }

    const calDiaInput = document.getElementById('resumenCalendarioDia');
    const badgeRango = document.getElementById('resumenRangoVisualBadge');
    const btnPrevWk = document.getElementById('btnResumenPrevWeek');
    const btnTodayWk = document.getElementById('btnResumenTodayWeek');
    const btnNextWk = document.getElementById('btnResumenNextWeek');

    function seleccionarSemanaPorFechaCalendario(dateObj) {
        if (!dateObj || Number.isNaN(dateObj.getTime())) return;
        const dom = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate() - dateObj.getDay());
        const sab = new Date(dom);
        sab.setDate(dom.getDate() + 6);

        const domStr = `${dom.getFullYear()}-${String(dom.getMonth() + 1).padStart(2, '0')}-${String(dom.getDate()).padStart(2, '0')}`;
        const sabStr = `${sab.getFullYear()}-${String(sab.getMonth() + 1).padStart(2, '0')}-${String(sab.getDate()).padStart(2, '0')}`;
        const valKey = `${domStr}|${sabStr}`;

        let existingOpt = Array.from(selectSemana.options).find(o => o.value === valKey);
        if (!existingOpt) {
            const textoVisual = `${dom.toLocaleDateString(tLocale(), { day: 'numeric', month: 'short' })} - ${sab.toLocaleDateString(tLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}`;
            existingOpt = document.createElement('option');
            existingOpt.value = valKey;
            existingOpt.dataset.weekRange = valKey;
            existingOpt.textContent = `${tUi('Week', 'Semana')}: ${textoVisual}`;
            selectSemana.prepend(existingOpt);
        }
        selectSemana.value = valKey;
        if (calDiaInput) {
            calDiaInput.value = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        }
        if (badgeRango) {
            badgeRango.textContent = existingOpt.textContent;
        }
        selectSemana.dispatchEvent(new Event('change'));
    }

    if (calDiaInput) {
        calDiaInput.value = formatLocalDate(now);
        calDiaInput.addEventListener('change', () => {
            if (!calDiaInput.value) return;
            const [yy, mm, dd] = calDiaInput.value.split('-').map(Number);
            seleccionarSemanaPorFechaCalendario(new Date(yy, mm - 1, dd));
        });
    }
    if (btnPrevWk) {
        btnPrevWk.addEventListener('click', () => {
            const [bStr] = (selectSemana.value || '').split('|');
            const [yy, mm, dd] = (bStr || formatLocalDate(now)).split('-').map(Number);
            seleccionarSemanaPorFechaCalendario(new Date(yy, mm - 1, dd - 7));
        });
    }
    if (btnNextWk) {
        btnNextWk.addEventListener('click', () => {
            const [bStr] = (selectSemana.value || '').split('|');
            const [yy, mm, dd] = (bStr || formatLocalDate(now)).split('-').map(Number);
            seleccionarSemanaPorFechaCalendario(new Date(yy, mm - 1, dd + 7));
        });
    }
    if (btnTodayWk) {
        btnTodayWk.addEventListener('click', () => {
            seleccionarSemanaPorFechaCalendario(new Date());
        });
    }
    const btnDriveRam = document.getElementById('btnLoadDriveMonthsRam');
    const selDriveMonths = document.getElementById('resumenDriveMonthsSelect');
    const boxDriveHistory = document.getElementById('resumenDriveHistoryBox');
    const hintDriveStatus = document.getElementById('resumenDriveStatusHint');

    if (btnDriveRam && boxDriveHistory) {
        btnDriveRam.addEventListener('click', () => {
            const months = Number(selDriveMonths?.value || 6);
            runWithButtonLock(btnDriveRam, async () => {
                try {
                    const res = await fetch(`/api/archive/drive-range?months=${months}`, { cache: 'no-store' });
                    if (!res.ok) throw new Error(await res.text() || 'No se pudo consultar el historial en Drive.');
                    const data = await res.json();

                    if (hintDriveStatus) {
                        hintDriveStatus.textContent = `✅ Extraídos en RAM temporal (${data.begin} → ${data.end}): ${data.counts.moods} estados de ánimo · ${data.counts.sleeps} registros de sueño · ${data.counts.crises} episodios de crisis (0 KB guardados en disco local).`;
                    }

                    boxDriveHistory.hidden = false;
                    boxDriveHistory.replaceChildren();

                    const summaryHead = document.createElement('div');
                    summaryHead.className = 'ai-summary-box';
                    summaryHead.textContent = `☁️ Historial Temporal desde Google Drive (Últimos ${months} meses: ${data.begin} a ${data.end}) — Ánimo: ${data.counts.moods} · Sueño: ${data.counts.sleeps} · Crisis: ${data.counts.crises}`;
                    boxDriveHistory.appendChild(summaryHead);

                    // Generar botones rápidos para las semanas con actividad en esos 6 meses
                    const weekSet = new Set();
                    [...(data.moods || []), ...(data.sleeps || []), ...(data.crises || [])].forEach(r => {
                        const f = String(r.fecha || '').slice(0, 10);
                        if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
                            const [yy, mm, dd] = f.split('-').map(Number);
                            const dt = new Date(yy, mm - 1, dd);
                            const dom = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - dt.getDay());
                            const domIso = `${dom.getFullYear()}-${String(dom.getMonth() + 1).padStart(2, '0')}-${String(dom.getDate()).padStart(2, '0')}`;
                            weekSet.add(domIso);
                        }
                    });

                    const sortedWeeks = Array.from(weekSet).sort().reverse().slice(0, 26);
                    if (sortedWeeks.length > 0) {
                        const weeksBar = document.createElement('div');
                        weeksBar.style.display = 'flex';
                        weeksBar.style.flexWrap = 'wrap';
                        weeksBar.style.gap = '6px';
                        weeksBar.style.marginTop = '8px';

                        sortedWeeks.forEach(domIso => {
                            const [yy, mm, dd] = domIso.split('-').map(Number);
                            const btnWk = document.createElement('button');
                            btnWk.type = 'button';
                            btnWk.className = 'btn-secondary btn-small';
                            btnWk.textContent = `📅 Semana ${domIso}`;
                            btnWk.title = 'Cargar esta semana histórica desde Google Drive en la tabla de arriba';
                            btnWk.addEventListener('click', () => {
                                seleccionarSemanaPorFechaCalendario(new Date(yy, mm - 1, dd));
                            });
                            weeksBar.appendChild(btnWk);
                        });
                        boxDriveHistory.appendChild(weeksBar);
                    }
                } catch (err) {
                    showToast('err', err.message || 'Error consultando Google Drive.');
                }
            }, { loadingText: 'Extrayendo de Drive en RAM...' });
        });
    }

    // 2. Fetch week data when changed
    selectSemana.addEventListener('change', () => {
        const [begin, end] = selectSemana.value.split('|');
        const reqToken = resumenTracker.begin();
        const fetchOpts = reqToken.signal ? { signal: reqToken.signal } : {};

        const resumenBanner = document.getElementById('resumenLoadingBanner');
        if (resumenBanner) {
            resumenBanner.replaceChildren(createLoadingBanner(tUi('Loading weekly data...', 'Cargando datos semanales...'), 'sm'));
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
                        const rawMood = MOOD_COLOR_LABELS[hex] || '';
                        const moodName = rawMood && window.DailyHubI18n && typeof window.DailyHubI18n.moodLabel === 'function'
                            ? window.DailyHubI18n.moodLabel(rawMood)
                            : (rawMood || tUi('Logged Mood', 'Ánimo registrado'));
                        const dayLoc = window.DailyHubI18n && typeof window.DailyHubI18n.agendaDayName === 'function'
                            ? window.DailyHubI18n.agendaDayName(nombreDia, false)
                            : nombreDia;
                        const momentLoc = window.DailyHubI18n && typeof window.DailyHubI18n.momentLabel === 'function'
                            ? window.DailyHubI18n.momentLabel(registro.momento_dia)
                            : (registro.momento_dia === 'Madrugada' ? 'Late Night' : registro.momento_dia);
                        const dot = document.createElement('span');
                        dot.className = 'color-dot';
                        dot.style.backgroundColor = registro.color_hex;
                        dot.title = `${dayLoc} (${momentLoc}): ${moodName}`;
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
        sleepGrid.replaceChildren(createLoadingBanner(tUi('Loading sleep logs...', 'Cargando registros de sueño...'), 'sm'));
        if (sleepDetailsList) {
            sleepDetailsList.replaceChildren(createLoadingBanner(tUi('Loading sleep & desvelo details...', 'Cargando detalles de sueño y desvelos...'), 'sm'));
        }

        const diasNombres = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(d => (
            window.DailyHubI18n && typeof window.DailyHubI18n.agendaDayName === 'function'
                ? window.DailyHubI18n.agendaDayName(d, true)
                : d.slice(0, 3)
        ));
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
                            desveloTagText = tUi('⚡ All-nighter', '⚡ Desvelo total');
                            desveloTagIsTotal = true;
                        } else if (datosDia.desvelos > 0) {
                            emoji = totalH < 4 ? '🔴' : '🦉';
                            colorBorde = totalH < 4 ? '#EF4444' : '#8B5CF6';
                            desveloTagText = datosDia.lateBedtimes.length
                                ? `🦉 ${datosDia.lateBedtimes[0]}`
                                : tUi(
                                    `🦉 ${datosDia.desvelos} late night${datosDia.desvelos > 1 ? 's' : ''}`,
                                    `🦉 ${datosDia.desvelos} desvelo${datosDia.desvelos > 1 ? 's' : ''}`
                                );
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
                    const sessLbl = list.length === 1 ? tUi('session', 'sesión') : tUi('sessions', 'sesiones');
                    const desvLbl = totalDesvelos === 1 ? tUi('late night', 'desvelo') : tUi('late nights', 'desvelos');
                    sleepResumenCount.textContent = list.length === 0
                        ? tUi('No sleep records this week', 'Sin registros de sueño esta semana')
                        : `${list.length} ${sessLbl}${totalDesvelos > 0 ? ` · 🦉 ${totalDesvelos} ${desvLbl}` : ''}`;
                }
                if (typeof renderSleepDetailCards === 'function') {
                    renderSleepDetailCards(sleepDetailsList, list);
                }
            })
            .catch(error => {
                if (!isAbortError(error) && resumenTracker.isCurrent(reqToken.seq)) {
                    console.error('Error loading sleep logs:', error);
                    sleepGrid.innerHTML = `<p class="muted-text">${tUi('Could not load sleep logs.', 'No se pudieron cargar los registros de sueño.')}</p>`;
                    if (sleepDetailsList) {
                        sleepDetailsList.innerHTML = `<p class="muted-text">${tUi('Could not load sleep & desvelo details.', 'No se pudieron cargar los detalles de sueño y desvelos.')}</p>`;
                    }
                }
            })
            .finally(markOneSettled);

        const crisisResumenList = document.getElementById('resumenCrisisList');
        const crisisResumenCount = document.getElementById('resumenCrisisCount');
        if (crisisResumenList) {
            crisisResumenList.replaceChildren(createLoadingBanner(tUi('Loading crisis logs...', 'Cargando registros de crisis...'), 'sm'));
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
    if (window.DailyHubI18n && typeof window.DailyHubI18n.sleepQualityLabel === 'function') {
        return window.DailyHubI18n.sleepQualityLabel(calidad);
    }
    if (calidad === 'Good') return '🟢 Good / Restorative';
    if (calidad === 'Bad') return '🔴 Poor / Heavy';
    return '🟡 Fair / Light';
}

function formatSleepIntervalText(row = {}) {
    const tipo = row.tipo_registro || 'normal';
    const hrsText = formatHoursMinutes(row.horas);
    if (tipo === 'desvelo_total') {
        const atTime = row.hora_dormir
            ? tUi(` · Awake at ${formatClockTime12h(row.hora_dormir)}`, ` · Despierto a las ${formatClockTime12h(row.hora_dormir)}`)
            : '';
        return tUi(`All-Nighter / No Sleep (${hrsText})${atTime}`, `Desvelo Total / Sin dormir (${hrsText})${atTime}`);
    }
    if (row.hora_dormir && row.hora_despertar) {
        return tUi(
            `Bed: ${formatClockTime12h(row.hora_dormir)} → Wake: ${formatClockTime12h(row.hora_despertar)} (${hrsText})`,
            `Dormido: ${formatClockTime12h(row.hora_dormir)} → Despertar: ${formatClockTime12h(row.hora_despertar)} (${hrsText})`
        );
    }
    if (row.hora_dormir && !row.hora_despertar) {
        return tUi(
            `Bedtime: ${formatClockTime12h(row.hora_dormir)} (wake-up pending)`,
            `Hora de dormir: ${formatClockTime12h(row.hora_dormir)} (despertar pendiente)`
        );
    }
    return tUi(`Duration: ${hrsText}`, `Duración: ${hrsText}`);
}

function renderSleepDetailCards(container, rows = []) {
    if (!container) return;
    const list = Array.isArray(rows) ? [...rows] : [];
    if (!list.length) {
        const p = document.createElement('p');
        p.className = 'muted-text';
        p.textContent = tUi('No sleep or desvelo sessions recorded during this week.', 'Sin sesiones de sueño o desvelos registradas esta semana.');
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
            typeBadge.textContent = tUi('⚡ All-Nighter (No sleep)', '⚡ Desvelo Total (Sin dormir)');
        } else if (isDesvelo) {
            typeBadge.textContent = item.hora_dormir
                ? tUi(`🦉 Late Sleep · Bed ${formatClockTime12h(item.hora_dormir)}`, `🦉 Desvelo · Dormido ${formatClockTime12h(item.hora_dormir)}`)
                : tUi('🦉 Late Bedtime / Desvelo', '🦉 Desvelo / Dormido de madrugada');
        } else {
            typeBadge.textContent = tUi('🌙 Regular Sleep', '🌙 Sueño Normal');
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
            protectUserNode(noteP);
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
        ? tUi("Today's accumulated sleep", 'Sueño acumulado de hoy')
        : tUi(`Sleep on ${formatCrisisDateLabel(targetDate)}`, `Sueño del ${formatCrisisDateLabel(targetDate)}`);

    if (!list.length) {
        const p = document.createElement('p');
        p.className = 'muted-text';
        p.textContent = !targetDate || targetDate === todayStr
            ? tUi('No sleep or desvelo logged for today yet. Record your session on the left.', 'Aún no hay sueño ni desvelo registrado hoy. Registra tu sesión a la izquierda.')
            : tUi(`No sleep or desvelo recorded for ${targetDate}.`, `Sin registros de sueño ni desvelo para el ${targetDate}.`);
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
    const sessWord = list.length === 1 ? tUi('session', 'sesión') : tUi('sessions', 'sesiones');
    const desvWord = desveloCount === 1 ? tUi('late night', 'desvelo') : tUi('late nights', 'desvelos');
    left.textContent = `${headingLabel} (${list.length} ${sessWord}${desveloCount ? ` · 🦉 ${desveloCount} ${desvWord}` : ''})`;
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
            protectUserNode(note);
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
                completeBtn.textContent = tUi('⏰ Complete Wake-Up Now', '⏰ Completar despertar ahora');
                completeBtn.addEventListener('click', () => enterSleepWakeupCompletion(r));
                actions.appendChild(completeBtn);
            }
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn-secondary btn-small';
            delBtn.textContent = tUi('Delete', 'Eliminar');
            delBtn.addEventListener('click', async () => {
                const ok = await openConfirmDialog({
                    title: tUi('Delete Sleep Log?', '¿Eliminar registro de sueño?'),
                    message: tUi('Remove this sleep / desvelo session from your records?', '¿Quitar esta sesión de sueño / desvelo de tus registros?'),
                    confirmText: tUi('Delete', 'Eliminar'),
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

let initSleepViewDefaults = () => { };
let enterSleepWakeupCompletion = () => { };

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
                title: tUi('Clear Draft?', '¿Limpiar borrador?'),
                message: tUi('Erase your unsent text in the Journal box?', '¿Borrar el texto no enviado del diario?'),
                confirmText: tUi('Clear Draft', 'Limpiar borrador'),
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
            setInlineBanner('journalStatusBanner', 'err', tUi('Please write a short entry before sending.', 'Por favor escribe una nota breve antes de enviar.'));
            return;
        }

        const composedJournalText = titleClean ? `[${titleClean}] — ${textoLimpio}` : texto;
        const composedClean = composedJournalText.trim();

        if (composedClean === lastSentJournalText) {
            setInlineBanner('journalStatusBanner', 'info', tUi('This exact note was already queued in this session. Edit the text before sending again.', 'Esta misma nota ya se envió a cola en esta sesión. Edita el texto antes de volver a enviarla.'));
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
                clearStudyNoteDrafts('english');

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
                    .catch(() => { });

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
    initStudyNoteDrafts();
}

let cachedLanguageMemory = { terms: [], grammarNotes: [], songs: [], customContext: '' };

function updateAiMemoryBadgeUI(mem) {
    if (mem && typeof mem === 'object') {
        cachedLanguageMemory = mem;
    }
    const badge = document.getElementById('langAiMemoryBadge');
    if (!badge) return;
    const count = Array.isArray(cachedLanguageMemory.terms) ? cachedLanguageMemory.terms.length : 0;
    badge.textContent = tUi(`🧠 Memory: ${count} learned`, `🧠 Memoria: ${count} aprendidos`);
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
        repBadge.textContent = tUi(
            `🎵 Repertoire: ${analysis.repertoireCount} song${analysis.repertoireCount === 1 ? '' : 's'}`,
            `🎵 Repertorio: ${analysis.repertoireCount} canción${analysis.repertoireCount === 1 ? '' : 'es'}`
        );
    }

    if (Array.isArray(analysis.matchedRepertoireSongs) && analysis.matchedRepertoireSongs.length) {
        const repBox = document.createElement('div');
        repBox.className = 'ai-summary-box';
        protectUserNode(repBox);
        const titles = analysis.matchedRepertoireSongs.map(s =>
            `"${s.titulo}"${s.artistas?.length ? ` (${s.artistas.join(', ')})` : ''}${s.album ? ` · ${s.album}` : ''}`
        );
        repBox.textContent = tUi(
            `🎵 Matched from Your Music Catalog: ${titles.join(' | ')}`,
            `🎵 Coincidencias de tu Catálogo Musical: ${titles.join(' | ')}`
        );
        container.appendChild(repBox);
    }

    const summaryEl = document.createElement('div');
    summaryEl.className = 'ai-summary-box';
    protectUserNode(summaryEl);
    const engineTag = analysis.engine === 'gemini'
        ? `🤖 Gemini (${analysis.model || 'gemini-2.5-flash'})`
        : tUi('⚡ Instant Local Engine (Hangul + EN · 0 MB RAM)', '⚡ Motor Local Instantáneo (Hangul + EN · 0 MB RAM)');
    summaryEl.textContent = `${engineTag}: ${tServer(analysis.summary) || tUi('Breakdown ready.', 'Análisis listo.')}`;
    container.appendChild(summaryEl);

    if (analysis.fallbackReason) {
        const warnEl = document.createElement('p');
        warnEl.className = 'muted-text';
        warnEl.textContent = `${tUi('Fallback notice', 'Nota de respaldo')}: ${tServer(analysis.fallbackReason)}`;
        container.appendChild(warnEl);
    }

    if (Array.isArray(analysis.stanzas) && analysis.stanzas.length) {
        analysis.stanzas.forEach((stanza, sIdx) => {
            const det = document.createElement('details');
            det.className = 'ai-line-card';
            if (sIdx < 2) det.open = true;

            const sum = document.createElement('summary');
            sum.style.cursor = 'pointer';
            sum.style.fontWeight = '700';
            protectUserNode(sum);
            sum.textContent = `🎵 [${stanza.section || `Estrofa ${sIdx + 1}`}] — ${stanza.meaningSummary || ''}`;
            det.appendChild(sum);

            if (stanza.phoneticGuide) {
                const ph = document.createElement('div');
                ph.className = 'ai-line-rom';
                protectUserNode(ph);
                ph.textContent = `🗣️ Fonética de estrofa: [${stanza.phoneticGuide}]`;
                det.appendChild(ph);
            }

            (Array.isArray(stanza.lines) ? stanza.lines : []).forEach(l => {
                const row = document.createElement('div');
                row.style.padding = '4px 0';
                row.style.borderTop = '1px solid rgba(148,163,184,0.15)';
                protectUserNode(row);
                row.textContent = `${l.original || ''}${l.phonetic ? ` [${l.phonetic}]` : ''} → ${l.meaning || ''}`;
                det.appendChild(row);
            });
            container.appendChild(det);
        });
    }

    if (Array.isArray(analysis.lines) && analysis.lines.length) {
        analysis.lines.slice(0, 24).forEach(line => {
            const card = document.createElement('div');
            card.className = 'ai-line-card';

            const orig = document.createElement('div');
            orig.className = 'ai-line-original';
            protectUserNode(orig);
            orig.textContent = line.original || '';
            card.appendChild(orig);

            if (line.romanization) {
                const rom = document.createElement('div');
                rom.className = 'ai-line-rom';
                protectUserNode(rom);
                rom.textContent = `${tUi('Romanization', 'Romanización')}: ${line.romanization}`;
                card.appendChild(rom);
            }
            if (line.meaning) {
                const meaning = document.createElement('div');
                protectUserNode(meaning);
                meaning.textContent = `${tUi('Meaning', 'Significado')}: ${line.meaning}`;
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
            } catch (_) { }

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

    const langAiTracker = createRequestTracker();
    const musicAiTracker = createRequestTracker();

    const triggerQuickAi = () => {
        if (!btnAskQuick) return;
        const questionEl = document.getElementById('langAiQuestion');
        const fallbackWord = (document.getElementById('engWord')?.value || '').trim();
        const query = (questionEl?.value || '').trim() || fallbackWord;
        if (!query) {
            showToast('err', 'Type a phrase, Korean lyric, or question for the AI tutor.');
            questionEl?.focus();
            return;
        }
        const mode = document.getElementById('langAiEngineSelect')?.value || 'auto';
        const language = document.getElementById('studyLanguageInput')?.value || 'en_ko';
        const selected = typeof getCancionSeleccionada === 'function' ? getCancionSeleccionada() : null;
        const songTitle = selected?.titulo || (document.getElementById('musicSongTitle')?.value || '').trim();
        const artistName = selected
            ? (selected.artists || []).map(a => a.nombre).join(', ')
            : (document.getElementById('musicMainArtist')?.value || '').trim();

        const { seq, signal } = langAiTracker.begin();
        if (quickBox) {
            quickBox.hidden = false;
            quickBox.replaceChildren(createLoadingBanner('Analizando frase / letra con IA o motor local...', 'sm'));
        }

        runWithButtonLock(btnAskQuick, async () => {
            const resp = await resilientFetchJson('/api/language/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: query, question: query, language, mode, songTitle, artistName })
            }, { timeoutMs: 28000, externalSignal: signal });

            if (resp.aborted || !langAiTracker.isCurrent(seq)) return;

            if (!resp.ok || !resp.data) {
                renderAiNetworkFallback(quickBox, {
                    title: 'No se pudo completar el análisis con IA',
                    message: resp.errorMessage,
                    sampleText: query,
                    onRetry: triggerQuickAi
                });
                if (quickModeBadge) quickModeBadge.textContent = '⚠️ Sin conexión';
                showToast('err', resp.errorMessage);
                return;
            }

            const data = resp.data;
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

            const chkAutoQuick = document.getElementById('chkAutoSyncQuickAiToWord');
            const quickSyncHint = document.getElementById('quickAiWordSyncHint');
            if (chkAutoQuick && chkAutoQuick.checked) {
                const draft = data.wordNoteDraft || {};
                const firstVocab = (data.vocabulary || [])[0] || {};
                const vocabNotes = (data.vocabulary || [])
                    .map(v => `• ${v.term}${v.romanization ? ` (${v.romanization})` : ''}: ${v.meaning}`)
                    .join('\n');
                const extraNotes = [
                    data.summary,
                    ...(data.culturalAndGrammarNotes || []),
                    draft.notes,
                    songTitle ? `Song context: ${songTitle}${artistName ? ` — ${artistName}` : ''}` : ''
                ].filter(Boolean).join('\n');

                const quickEntry = {
                    category: 'vocabulary',
                    language: language === 'en_ko' ? 'English + Korean (K-Pop)' : language,
                    word: (firstVocab.term || draft.word || query).slice(0, 180),
                    romanization: firstVocab.romanization || ((data.lines || [])[0]?.romanization || ''),
                    part_of_speech: firstVocab.pos || 'expression',
                    spanish: (draft.meaning || data.summary || '').slice(0, 400),
                    example: draft.example || ((data.lines || []).slice(0, 3).map(l => `${l.original} -> ${l.translationEs || l.translationEn || ''}`).join('\n')),
                    notes: [vocabNotes, extraNotes].filter(Boolean).join('\n\n')
                };
                autoQueueAiLearningToWord({ entry: quickEntry, hintEl: quickSyncHint });
            }
        }, { loadingText: 'Analyzing...' });
    };

    if (btnAskQuick) {
        btnAskQuick.addEventListener('click', triggerQuickAi);
    }

    if (btnApplyQuick) {
        btnApplyQuick.addEventListener('click', () => {
            const draft = lastQuickAnalysis && lastQuickAnalysis.wordNoteDraft;
            if (!draft) return;
            const vocabBtn = document.querySelector('.english-tab-btn[data-english-cat="vocabulary"]');
            if (vocabBtn) vocabBtn.click();
            const setIf = (id, v) => {
                const el = document.getElementById(id);
                if (el && v) {
                    el.value = v;
                    syncStudyDraftForId(id);
                }
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

    const triggerMusicLyricsAi = () => {
        if (!btnMusicAi) return;
        const studyLyricsEl = document.getElementById('musicStudyLyrics');
        const viewerLyricsEl = document.getElementById('musicSongLyricsViewer');
        if (studyLyricsEl && !studyLyricsEl.value.trim() && viewerLyricsEl && viewerLyricsEl.value.trim()) {
            studyLyricsEl.value = viewerLyricsEl.value.trim().slice(0, 12000);
            studyLyricsEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const lyrics = (studyLyricsEl?.value || '').trim();
        if (!lyrics) {
            showToast('err', 'Extrae o pega primero la letra de la canción (arriba en Letra yt-dlp o en Lyrics Breakdown).');
            (viewerLyricsEl && !viewerLyricsEl.closest('[hidden]') ? viewerLyricsEl : studyLyricsEl)?.focus();
            return;
        }
        const selected = typeof getCancionSeleccionada === 'function' ? getCancionSeleccionada() : null;
        const songTitle = selected?.titulo || (document.getElementById('musicSongTitle')?.value || '').trim();
        const artistName = selected
            ? (selected.artists || []).map(a => a.nombre).join(', ')
            : (document.getElementById('musicMainArtist')?.value || '').trim();
        const language = selected?.idioma || document.getElementById('musicSongLanguage')?.value || 'en_ko';
        const mode = document.getElementById('langAiEngineSelect')?.value || 'auto';

        const { seq, signal } = musicAiTracker.begin();
        if (musicAiBox) {
            musicAiBox.hidden = false;
            musicAiBox.replaceChildren(createLoadingBanner('Desglosando letra, vocabulario y romanización Hangul...', 'sm'));
        }

        runWithButtonLock(btnMusicAi, async () => {
            const resp = await resilientFetchJson('/api/language/analyze', {
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
            }, { timeoutMs: 28000, externalSignal: signal });

            if (resp.aborted || !musicAiTracker.isCurrent(seq)) return;

            if (!resp.ok || !resp.data) {
                renderAiNetworkFallback(musicAiBox, {
                    title: 'Red inestable o sin conexión al analizar letra',
                    message: resp.errorMessage,
                    sampleText: lyrics,
                    onRetry: triggerMusicLyricsAi,
                    onInsertOfflineRom: (romText) => {
                        const pronEl = document.getElementById('musicStudyPronunciation');
                        if (pronEl && romText && !pronEl.value.includes(romText)) {
                            pronEl.value = [pronEl.value.trim(), romText].filter(Boolean).join('\n');
                            syncStudyDraftForId('musicStudyPronunciation');
                            showToast('ok', 'Romanización local agregada a tus notas de pronunciación.');
                        }
                    }
                });
                showToast('err', resp.errorMessage);
                return;
            }

            const data = resp.data;
            lastMusicAnalysis = data;
            renderAiAnalysisIntoBox(musicAiBox, data);
            if (musicApplyRow) musicApplyRow.hidden = false;

            const chkAutoMusic = document.getElementById('chkAutoSyncAiToWord');
            const musicSyncHint = document.getElementById('musicAiWordSyncHint');
            if (chkAutoMusic && chkAutoMusic.checked) {
                const selected = typeof getCancionSeleccionada === 'function' ? getCancionSeleccionada() : null;
                const val = id => (document.getElementById(id)?.value || '').trim();
                const fallbackTitle = val('musicSongTitle') || 'Untitled Song';
                const fallbackArtist = val('musicMainArtist') || 'Unknown Artist';
                const breakdownText = (data.lines || [])
                    .map(l => {
                        const parts = [l.original];
                        if (l.romanization) parts.push(`[${l.romanization}]`);
                        const trMeaning = l.meaning || l.translationEs || l.translationEn;
                        if (trMeaning) parts.push(`-> ${trMeaning}`);
                        return parts.join(' ');
                    })
                    .filter(Boolean)
                    .join('\n');
                const romNotes = (data.lines || [])
                    .filter(l => l.romanization)
                    .map(l => `${l.original} -> ${l.romanization}`)
                    .join('\n');
                const vocabText = (data.vocabulary || [])
                    .map(v => `• ${v.term}${v.romanization ? ` (${v.romanization})` : ''}: ${v.meaning}`)
                    .join('\n');
                const culturalNotes = [
                    data.summary,
                    ...(data.culturalAndGrammarNotes || [])
                ].filter(Boolean).join('\n');

                const musicAiEntry = selected
                    ? {
                        category: 'music',
                        append_study_fields: true,
                        language: selected.idioma || 'English',
                        song_title: selected.titulo,
                        artists_display: formatSongArtistsSummary(selected),
                        album_title: selected.album_titulo || '',
                        album_type: RELEASE_TYPE_LABELS[selected.album_tipo] || selected.album_tipo || '',
                        release_year: selected.album_anio ? String(selected.album_anio) : '',
                        track_number: selected.numero_pista || null,
                        yt_music_url: selected.yt_music_url || '',
                        focus_summary: selected.enfoque_corto || '',
                        lyrics_study: breakdownText,
                        vocabulary_list: vocabText,
                        pronunciation_notes: romNotes,
                        notes: culturalNotes
                    }
                    : {
                        category: 'music',
                        append_study_fields: true,
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
                        lyrics_study: breakdownText,
                        vocabulary_list: vocabText,
                        pronunciation_notes: romNotes,
                        notes: culturalNotes
                    };
                autoQueueAiLearningToWord({
                    entry: musicAiEntry,
                    hintEl: musicSyncHint,
                    songToMarkSynced: selected
                });
            }
        }, { loadingText: 'Analyzing Lyrics...' });
    };

    if (btnMusicAi) {
        btnMusicAi.addEventListener('click', triggerMusicLyricsAi);
    }

    if (btnMusicInsert) {
        btnMusicInsert.addEventListener('click', () => {
            if (!lastMusicAnalysis) return;
            const vocabEl = document.getElementById('musicStudyVocab');
            const pronEl = document.getElementById('musicStudyPronunciation');
            const notesEl = document.getElementById('musicStudyExtraNotes');

            const appendUnique = (el, text) => {
                if (!el || !text) return;
                const clean = String(text).trim();
                if (!clean || el.value.includes(clean)) return;
                el.value = [el.value.trim(), clean].filter(Boolean).join('\n');
                syncStudyDraftForId(el.id);
            };

            const romLines = (lastMusicAnalysis.lines || [])
                .filter(l => l.romanization)
                .map(l => `${l.original} -> ${l.romanization}`)
                .join('\n');
            appendUnique(pronEl, romLines);

            const vocabLines = (lastMusicAnalysis.vocabulary || [])
                .map(v => `• ${v.term}${v.romanization ? ` (${v.romanization})` : ''}: ${v.meaning}`)
                .join('\n');
            appendUnique(vocabEl, vocabLines);

            const summaryNotes = [
                lastMusicAnalysis.summary,
                ...(lastMusicAnalysis.culturalAndGrammarNotes || [])
            ].filter(Boolean).join('\n');
            appendUnique(notesEl, summaryNotes);
            showToast('ok', 'Added Romanization, Vocabulary & AI Notes below—ready to encrypt & save to Word!');
        });
    }

    // Lecciones secuenciales (15 min, Zero-Bloat en BD + guardado en Word) y Pronunciación por Micrófono
    async function cargarLeccionesSecuencialesUI() {
        const listEl = document.getElementById('seqLessonsListContainer');
        const hintEl = document.getElementById('seqLessonStatusHint');
        const btnToggle = document.getElementById('btnToggleStudyCourse');
        if (!listEl) return;

        try {
            const res = await fetch('/api/language/lessons', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();

            if (btnToggle) {
                btnToggle.textContent = data.studyEnabled
                    ? '⏸️ Pausar Curso de Idiomas (Activo · 15 min)'
                    : '▶️ Iniciar Curso de Idiomas (Sin fecha fija · 15 min)';
            }
            if (hintEl && data.currentLesson) {
                hintEl.textContent = data.needsPracticeAlert
                    ? `⚠️ Lección actual pendiente de lectura/práctica en Word (15 min): ${data.currentLesson.nombre}`
                    : `✅ Lección activa lista: ${data.currentLesson.nombre}`;
            }

            listEl.replaceChildren();
            (data.lessons || []).forEach(lesson => {
                const row = document.createElement('div');
                row.className = 'ai-line-card';
                row.style.display = 'flex';
                row.style.justifyContent = 'space-between';
                row.style.alignItems = 'center';
                row.style.gap = '8px';
                row.style.opacity = lesson.locked ? '0.55' : '1';

                const titleSpan = document.createElement('span');
                const statusIcon = lesson.completada ? '✅' : (lesson.locked ? '🔒' : '🎯');
                titleSpan.textContent = `${statusIcon} [${lesson.idioma.toUpperCase()}] ${lesson.nombre}`;

                const actions = document.createElement('div');
                actions.style.display = 'flex';
                actions.style.gap = '6px';

                const btnPractice = document.createElement('button');
                btnPractice.type = 'button';
                btnPractice.className = 'btn-secondary btn-small';
                btnPractice.disabled = lesson.locked;
                btnPractice.title = lesson.locked
                    ? 'Completa primero la lección anterior para desbloquear esta'
                    : 'Genera la práctica de 15 minutos y guárdala automáticamente en tu documento Word';
                btnPractice.textContent = '📖 Practicar (15 min -> Word)';
                btnPractice.addEventListener('click', () => {
                    runWithButtonLock(btnPractice, async () => {
                        const pRes = await resilientFetchJson(`/api/language/lessons/${lesson.id}/generate-practice`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({})
                        }, { timeoutMs: 25000 });
                        if (!pRes.ok || !pRes.data?.practice) {
                            showToast('err', pRes.errorMessage || 'No se pudo generar la práctica.');
                            return;
                        }
                        const prac = pRes.data.practice;
                        const box = document.getElementById('seqActivePracticeBox');
                        if (box) {
                            box.hidden = false;
                            box.replaceChildren();
                            const h = document.createElement('div');
                            h.className = 'ai-summary-box';
                            h.textContent = `🎯 ${prac.lessonName} (Guardada en tu Word local)`;
                            box.appendChild(h);

                            (prac.practicalDrills || []).forEach((d, idx) => {
                                const det = document.createElement('details');
                                det.className = 'ai-line-card';
                                const s = document.createElement('summary');
                                s.style.cursor = 'pointer';
                                s.textContent = `Ejercicio ${idx + 1}: ${d.prompt} (Clic para ver respuesta)`;
                                const ans = document.createElement('p');
                                ans.className = 'muted-text';
                                ans.textContent = `✔️ ${d.answer}`;
                                det.append(s, ans);
                                box.appendChild(det);
                            });
                        }
                        if (prac.wordPayload && (!musicState.ytdlpStatus || musicState.ytdlpStatus.pcOnline !== false)) {
                            await autoQueueAiLearningToWord({ entry: prac.wordPayload, hintEl });
                        }
                        await cargarLeccionesSecuencialesUI();
                    });
                });

                const btnDone = document.createElement('button');
                btnDone.type = 'button';
                btnDone.className = 'btn-primary btn-small';
                btnDone.disabled = lesson.locked || lesson.completada;
                btnDone.title = 'Marca esta lección como completada después de practicar para avanzar a la siguiente';
                btnDone.textContent = lesson.completada ? 'Completada' : '✓ Completar';
                btnDone.addEventListener('click', () => {
                    runWithButtonLock(btnDone, async () => {
                        const cRes = await fetch(`/api/language/lessons/${lesson.id}/complete`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ wordReadConfirmed: true })
                        });
                        if (!cRes.ok) {
                            showToast('err', await cRes.text());
                            return;
                        }
                        showToast('ok', '¡Lección completada! Se desbloqueó la siguiente lección.');
                        await cargarLeccionesSecuencialesUI();
                    });
                });

                actions.append(btnPractice, btnDone);
                row.append(titleSpan, actions);
                listEl.appendChild(row);
            });
        } catch (_) { }
    }

    document.getElementById('btnToggleStudyCourse')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        runWithButtonLock(btn, async () => {
            const nextState = !(currentSettings && currentSettings.englishReminderEnabled);
            const res = await submitMutationRequest({
                url: '/api/settings',
                method: 'PUT',
                scopeKey: 'toggle-study-course',
                signature: String(Date.now()),
                buildBody: () => ({
                    englishReminderEnabled: nextState,
                    englishReminderTopic: 'Dedica 15 minutos a tu lección activa de Inglés / Coreano en Word'
                }),
                parseJson: true
            });
            if (res?.settings) aplicarSettingsEnEstado(res.settings);
            await cargarLeccionesSecuencialesUI();
            showToast('ok', nextState
                ? 'Curso de idiomas activado (recordatorios de 15 min encendidos).'
                : 'Curso de idiomas en pausa.');
        });
    });

    document.getElementById('btnStartMicPronunciation')?.addEventListener('click', () => {
        const resultBox = document.getElementById('micPronunciationResultBox');
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRec) {
            if (resultBox) {
                resultBox.hidden = false;
                resultBox.className = 'inline-status-banner is-error';
                resultBox.textContent = '⚠️ Tu navegador bloqueó el micrófono por usar HTTP plano o no soporta Web Speech API. En tu OPPO A79 habilita el origen en chrome://flags/#unsafely-treat-insecure-origin-as-secure o usa HTTPS.';
            }
            return;
        }
        const targetText = (
            document.getElementById('engWord')?.value ||
            document.getElementById('langAiQuestion')?.value ||
            document.getElementById('musicSongTitle')?.value ||
            ''
        ).trim().slice(0, 200);

        if (!targetText) {
            showToast('info', 'Escribe primero una palabra en Glosario o una frase en el cuadro de IA para evaluar tu pronunciación.');
            return;
        }

        const langCode = document.getElementById('studyLanguageInput')?.value || 'en';
        const rec = new SpeechRec();
        rec.lang = langCode === 'ko' || /[\uAC00-\uD7A3]/.test(targetText) ? 'ko-KR' : 'en-US';
        rec.interimResults = false;

        if (resultBox) {
            resultBox.hidden = false;
            resultBox.className = 'inline-status-banner is-info';
            resultBox.textContent = `🎙️ Escuchando (${rec.lang})... Pronuncia en voz alta: "${targetText}"`;
        }

        rec.onresult = async (event) => {
            const spokenText = event.results?.[0]?.[0]?.transcript || '';
            const evalRes = await resilientFetchJson('/api/language/pronunciation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetText, spokenText, language: langCode })
            }, { timeoutMs: 18000 });

            if (evalRes.ok && evalRes.data && resultBox) {
                const d = evalRes.data;
                resultBox.className = d.score >= 75 ? 'inline-status-banner is-ok' : 'inline-status-banner is-info';
                resultBox.textContent = `🎯 Puntaje: ${d.score}% · Captado: "${d.spokenText}" · Fonética: [${d.phoneticTarget}] — ${d.feedback} (${d.mouthTip})`;
            }
        };
        rec.onerror = (e) => {
            if (resultBox) {
                resultBox.hidden = false;
                resultBox.className = 'inline-status-banner is-error';
                resultBox.textContent = `⚠️ No se pudo capturar el micrófono (${e.error || 'permiso denegado'}).`;
            }
        };
        rec.start();
    });

    // Poblar selector de modelos en Ajustes SOLO con los modelos disponibles en GEMINI_API_KEY
    fetch('/api/language/registry', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(reg => {
            if (!reg) return;
            const modelSel = document.getElementById('setGeminiModel');
            if (modelSel && Array.isArray(reg.geminiModels) && reg.geminiModels.length) {
                const currentVal = reg.activeGeminiModel || modelSel.value || 'gemini-2.5-flash';
                modelSel.replaceChildren();
                reg.geminiModels.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.label || m.id;
                    modelSel.appendChild(opt);
                });
                const customOpt = document.createElement('option');
                customOpt.value = '__custom__';
                customOpt.textContent = 'Custom Model ID (enter below)';
                modelSel.appendChild(customOpt);
                if (Array.from(modelSel.options).some(o => o.value === currentVal)) {
                    modelSel.value = currentVal;
                }
            }
        })
        .catch(() => { });

    cargarLeccionesSecuencialesUI();
}

function applyTranslationToVocabularyForm(translation, { switchToEnglish = true } = {}) {
    if (!translation) return;
    if (switchToEnglish && typeof showView === 'function') {
        showView('english', true);
    }
    const vocabTab = document.querySelector('.english-tab-btn[data-english-cat="vocabulary"]');
    if (vocabTab) vocabTab.click();
    const draft = translation.wordNoteDraft || {};
    const setIf = (id, v) => {
        const el = document.getElementById(id);
        if (el && v) {
            el.value = v;
            if (typeof syncStudyDraftForId === 'function') syncStudyDraftForId(id);
        }
    };
    const firstEx = translation.examples && translation.examples[0];
    const firstExText = typeof firstEx === 'string'
        ? firstEx
        : [firstEx?.source, firstEx?.translation].filter(Boolean).join(' -> ');

    setIf('engWord', draft.word || translation.sourceText || '');
    setIf('engRomanization', draft.romanization || translation.romanization || '');
    setIf('engSpanish', draft.meaning || translation.spanishMeaning || translation.translatedText || '');
    setIf('engVocabExample', draft.example || firstExText || '');
    setIf('engVocabNotes', draft.notes || translation.explanationEs || '');
    document.getElementById('englishForm')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast('ok', 'Copied translation into Glossary Study Form!');
}

function openAiSettingsSection() {
    if (typeof showView === 'function') {
        showView('settings', true);
    }
    const aiCard = document.getElementById('setGeminiApiKey')?.closest('.settings-card');
    if (aiCard && typeof aiCard.scrollIntoView === 'function') {
        aiCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => {
        document.getElementById('setGeminiApiKey')?.focus();
    }, 250);
}

const FLOATING_TRANSLATOR_POS_KEY = 'pdh_floating_translator_pos_v1';
let floatingTranslatorController = null;

function clampFloatingTranslatorCoords(drawer, left, top) {
    const rect = drawer.getBoundingClientRect();
    const width = rect.width || Math.min(500, window.innerWidth - 24);
    const height = rect.height || Math.min(520, window.innerHeight - 24);
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
        left: Math.round(Math.min(maxLeft, Math.max(margin, left))),
        top: Math.round(Math.min(maxTop, Math.max(margin, top)))
    };
}

function applyFloatingTranslatorPosition(drawer, left, top) {
    const clamped = clampFloatingTranslatorCoords(drawer, left, top);
    drawer.style.left = `${clamped.left}px`;
    drawer.style.top = `${clamped.top}px`;
    drawer.style.right = 'auto';
    drawer.style.bottom = 'auto';
    return clamped;
}

function restoreFloatingTranslatorPosition(drawer) {
    if (!drawer || drawer.hidden) return;
    try {
        const raw = localStorage.getItem(FLOATING_TRANSLATOR_POS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.top)) {
            applyFloatingTranslatorPosition(drawer, parsed.left, parsed.top);
        }
    } catch (_) { }
}

function resetFloatingTranslatorPosition(drawer) {
    if (!drawer) return;
    drawer.style.left = '';
    drawer.style.top = '';
    drawer.style.right = '';
    drawer.style.bottom = '';
    try {
        localStorage.removeItem(FLOATING_TRANSLATOR_POS_KEY);
    } catch (_) { }
}

function initFloatingTranslatorDrag(drawer) {
    const handle = document.getElementById('floatingTranslatorDragHandle')
        || drawer.querySelector('.floating-translator-header');
    if (!handle || handle.dataset.dragWired === 'true') return;
    handle.dataset.dragWired = 'true';

    let activeDrag = null;
    let lastCoords = null;

    handle.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.target && e.target.closest('button, a, input, select, textarea, .floating-translator-win-actions')) {
            return;
        }
        const rect = drawer.getBoundingClientRect();
        activeDrag = {
            pointerId: e.pointerId,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            moved: false
        };
        lastCoords = { left: rect.left, top: rect.top };
        drawer.classList.add('is-dragging');
        if (typeof handle.setPointerCapture === 'function') {
            try { handle.setPointerCapture(e.pointerId); } catch (_) { }
        }
        e.preventDefault();
    });

    const onPointerMove = (e) => {
        if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
        e.preventDefault();
        activeDrag.moved = true;
        lastCoords = applyFloatingTranslatorPosition(
            drawer,
            e.clientX - activeDrag.offsetX,
            e.clientY - activeDrag.offsetY
        );
    };

    const endDrag = (e) => {
        if (!activeDrag || (e.pointerId !== undefined && e.pointerId !== activeDrag.pointerId)) return;
        drawer.classList.remove('is-dragging');
        if (typeof handle.releasePointerCapture === 'function') {
            try { handle.releasePointerCapture(activeDrag.pointerId); } catch (_) { }
        }
        if (activeDrag.moved && lastCoords) {
            try {
                localStorage.setItem(FLOATING_TRANSLATOR_POS_KEY, JSON.stringify(lastCoords));
            } catch (_) { }
        }
        activeDrag = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', () => {
        if (!drawer.hidden) restoreFloatingTranslatorPosition(drawer);
    });
}

function openFloatingTranslator({ text = '', toggle = false } = {}) {
    if (!currentUser || currentUser.rol !== 'admin') return;
    const drawer = document.getElementById('floatingTranslatorModal');
    if (!drawer) return;

    if (toggle && !drawer.hidden && !text) {
        drawer.hidden = true;
        return;
    }

    drawer.hidden = false;
    restoreFloatingTranslatorPosition(drawer);
    if (floatingTranslatorController) {
        if (text) {
            floatingTranslatorController.setInputText(text);
            floatingTranslatorController.triggerTranslate();
        } else {
            floatingTranslatorController.focusInput();
        }
    }
}

function closeFloatingTranslator() {
    const drawer = document.getElementById('floatingTranslatorModal');
    if (drawer) drawer.hidden = true;
}

function consumePendingPopupTranslatorVocab() {
    try {
        const raw = localStorage.getItem('pdh_pending_translator_vocab');
        if (!raw) return;
        localStorage.removeItem('pdh_pending_translator_vocab');
        const parsed = JSON.parse(raw);
        if (parsed && currentUser && currentUser.rol === 'admin') {
            applyTranslationToVocabularyForm(parsed, { switchToEnglish: true });
        }
    } catch (_) { }
}

function initGlobalFloatingTranslator() {
    const drawer = document.getElementById('floatingTranslatorModal');
    const widgetApi = window.DailyHubTranslator;
    if (!drawer || !widgetApi || drawer.dataset.globalWired === 'true') return;
    drawer.dataset.globalWired = 'true';

    floatingTranslatorController = widgetApi.mountTranslatorInstance({
        panel: drawer,
        dirPills: Array.from(drawer.querySelectorAll('#floatTranslatorDirPills [data-dir]')),
        dirSelect: document.getElementById('floatTranslatorDirectionSelect'),
        engineSelect: document.getElementById('floatTranslatorEngineSelect'),
        inputEl: document.getElementById('floatTranslatorInput'),
        contextEl: document.getElementById('floatTranslatorContextInput'),
        btnRun: document.getElementById('btnRunFloatTranslator'),
        btnPaste: document.getElementById('btnFloatTranslatorPaste'),
        btnClear: document.getElementById('btnFloatTranslatorClear'),
        btnPopout: document.getElementById('btnFloatPopoutTranslator'),
        resultBox: document.getElementById('floatTranslatorResultBox'),
        fetchJsonFn: resilientFetchJson,
        buttonLockFn: runWithButtonLock,
        renderFallbackFn: renderAiNetworkFallback,
        createLoadingFn: createLoadingBanner,
        onMemoryUpdate: updateAiMemoryBadgeUI,
        onSendToStudyForm: data => {
            closeFloatingTranslator();
            applyTranslationToVocabularyForm(data, { switchToEnglish: true });
        },
        onOpenAiSettings: () => {
            closeFloatingTranslator();
            openAiSettingsSection();
        },
        onToast: showToast
    });

    const getSelectionText = () => {
        try {
            return String(window.getSelection ? window.getSelection().toString() : '').trim().slice(0, 600);
        } catch (_) {
            return '';
        }
    };

    const btnFab = document.getElementById('btnFloatingTranslatorFab');
    if (btnFab) {
        btnFab.addEventListener('click', () => {
            openFloatingTranslator({ text: getSelectionText(), toggle: true });
        });
    }

    const btnSidebar = document.getElementById('btnSidebarOpenTranslator');
    if (btnSidebar) {
        btnSidebar.addEventListener('click', () => {
            if (typeof setMobileMenuOpen === 'function') setMobileMenuOpen(false);
            openFloatingTranslator({ text: getSelectionText(), toggle: false });
        });
    }

    const btnMobileTop = document.getElementById('btnMobileTranslator');
    if (btnMobileTop) {
        btnMobileTop.addEventListener('click', () => {
            openFloatingTranslator({ text: getSelectionText(), toggle: true });
        });
    }

    const btnClose = document.getElementById('btnCloseFloatingTranslator');
    if (btnClose) {
        btnClose.addEventListener('click', closeFloatingTranslator);
    }

    const btnResetPos = document.getElementById('btnResetFloatTranslatorPos');
    if (btnResetPos) {
        btnResetPos.addEventListener('click', () => {
            resetFloatingTranslatorPosition(drawer);
            showToast('ok', 'Translator window position reset.');
        });
    }

    initFloatingTranslatorDrag(drawer);

    document.addEventListener('keydown', (e) => {
        if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 't' || e.key === 'T')) {
            if (!currentUser || currentUser.rol !== 'admin') return;
            e.preventDefault();
            openFloatingTranslator({ text: getSelectionText(), toggle: true });
        } else if (e.key === 'Escape' && !drawer.hidden) {
            closeFloatingTranslator();
        }
    });

    window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) return;
        const msg = event.data;
        if (msg && msg.type === 'pdh_translator_send_vocab' && msg.translation) {
            try { localStorage.removeItem('pdh_pending_translator_vocab'); } catch (_) { }
            if (currentUser && currentUser.rol === 'admin') {
                applyTranslationToVocabularyForm(msg.translation, { switchToEnglish: true });
            }
        } else if (msg && msg.type === 'pdh_open_ai_settings') {
            if (currentUser && currentUser.rol === 'admin') {
                closeFloatingTranslator();
                openAiSettingsSection();
            }
        }
    });

    window.addEventListener('focus', consumePendingPopupTranslatorVocab);
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
    embedHost: 'youtube',
    embedMode: 'ytdlp',
    ytdlpStatus: null,
    embeddableByVideoId: {},
    navArtistId: null,
    navAlbumKey: null,
    openArtistFolders: new Set(),
    openAlbumFolders: new Set(),
    sessionLyricsBySongId: {}
};

function cleanCaptionTextToLyricsClient(rawText) {
    const normalized = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!normalized.trim()) return '';
    const out = [];
    let skippingBlock = false;

    for (const rawLine of normalized.split('\n')) {
        let line = rawLine.trim();
        if (!line) {
            skippingBlock = false;
            continue;
        }
        if (/^(?:WEBVTT(?:\s|$)|Kind:|Language:)/i.test(line)) continue;
        if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(line)) {
            skippingBlock = true;
            continue;
        }
        if (skippingBlock) continue;
        if (/^\d+$/.test(line)) continue;
        if (/^(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{2,3}\s*-->\s*(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{2,3}/.test(line)) continue;
        if (/^\[(?:ar|ti|al|au|by|offset|re|ve|length)\s*:[^\]]*\]$/i.test(line)) continue;

        line = line
            .replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '')
            .replace(/<\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,3})?>/g, '')
            .replace(/<\/?[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;|&apos;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!line) continue;
        if (out.length > 0 && out[out.length - 1] === line) continue;
        out.push(line);
    }
    return out.join('\n').trim();
}

function getYtdlpCommandForSong(song) {
    const targetUrl = (song && song.yt_video_id)
        ? `https://www.youtube.com/watch?v=${song.yt_video_id}`
        : ((song && (song.youtube_url || song.yt_music_url)) || 'https://www.youtube.com/watch?v=VIDEO_ID');
    return `python sincronitation/yt_lyrics_helper.py "${targetUrl}" --clip`;
}

async function cargarCatalogoMusical() {
    const container = document.getElementById('musicCatalogContainer');
    if (!container) return;

    container.replaceChildren(createLoadingBanner('Loading songs & artists...', 'sm'));
    try {
        const [res, ytdlpRes] = await Promise.all([
            fetch('/api/english/music/catalog'),
            fetch('/api/english/music/ytdlp-status').catch(() => null)
        ]);
        if (!res.ok) throw new Error(await res.text() || 'Failed to load music catalog.');
        const data = await res.json();
        if (ytdlpRes && ytdlpRes.ok) {
            try {
                musicState.ytdlpStatus = await ytdlpRes.json();
            } catch (_) { }
        }
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

function getDefaultEmbedModeForSong(song) {
    if (!song) return 'iframe';
    if (musicState.ytdlpStatus && musicState.ytdlpStatus.available) return 'ytdlp';
    const knownBlocked = song.yt_video_id && musicState.embeddableByVideoId[song.yt_video_id] === false;
    const isRemoteHttp = window.location.protocol === 'http:' &&
        !['localhost', '127.0.0.1'].includes(window.location.hostname);
    return (knownBlocked || isRemoteHttp) ? 'ytdlp' : 'iframe';
}

function actualizarBadgePuentePc() {
    const pcBadge = document.getElementById('musicPcBridgeBadge');
    if (!pcBadge) return;
    const stat = musicState.ytdlpStatus;
    if (stat && stat.pcOnline) {
        pcBadge.textContent = tUi('🟢 PC online · Word sync', '🟢 PC en línea · Sync Word');
        pcBadge.className = 'badge-pill badge-pill-ok';
    } else if (stat) {
        const queued = Number(stat.pendingEnglishQueueCount || 0);
        pcBadge.textContent = queued > 0
            ? tUi(`☁️ PC offline · ${queued} in EC2 RAM`, `☁️ PC desconectada · ${queued} en RAM EC2`)
            : tUi('☁️ PC offline · EC2 RAM queue', '☁️ PC desconectada · Cola RAM EC2');
        pcBadge.className = 'badge-pill badge-pill-subtle';
    } else {
        pcBadge.textContent = tUi('⚪ Checking PC...', '⚪ Verificando PC...');
        pcBadge.className = 'badge-pill badge-pill-subtle';
    }
}

function renderMusicLyricsAlbumPlaylist(song) {
    const box = document.getElementById('musicLyricsAlbumPlaylistBox');
    if (!box) return;
    if (!song) {
        box.hidden = true;
        box.replaceChildren();
        return;
    }

    const albumTitleNorm = String(song.album_titulo || '').trim().toLowerCase();
    const mainArtistIds = new Set(
        (Array.isArray(song.artists) ? song.artists : [])
            .filter(a => a.rol === 'main')
            .map(a => Number(a.id))
    );

    let groupLabel = '';
    let groupSongs = [];
    if (song.album_id) {
        groupSongs = musicState.songs.filter(s => Number(s.album_id) === Number(song.album_id));
        const relType = RELEASE_TYPE_LABELS[song.album_tipo] || song.album_tipo || 'Album';
        const yr = song.album_anio ? `, ${song.album_anio}` : '';
        groupLabel = `📀 ${song.album_titulo || 'Álbum'} (${relType}${yr})`;
    } else if (albumTitleNorm) {
        groupSongs = musicState.songs.filter(s => String(s.album_titulo || '').trim().toLowerCase() === albumTitleNorm);
        groupLabel = `📀 ${song.album_titulo}`;
    } else {
        groupSongs = musicState.songs.filter(s => {
            if (s.album_id || String(s.album_titulo || '').trim()) return false;
            if (mainArtistIds.size === 0) return Number(s.id) === Number(song.id);
            return (Array.isArray(s.artists) ? s.artists : []).some(a => a.rol === 'main' && mainArtistIds.has(Number(a.id)));
        });
        groupLabel = `🎵 Standalone / Singles (${formatSongArtistsSummary(song)})`;
    }

    groupSongs.sort((a, b) => {
        const ta = a.numero_pista ? Number(a.numero_pista) : 999999;
        const tb = b.numero_pista ? Number(b.numero_pista) : 999999;
        if (ta !== tb) return ta - tb;
        return String(a.titulo || '').localeCompare(String(b.titulo || ''));
    });

    if (groupSongs.length === 0) {
        box.hidden = true;
        box.replaceChildren();
        return;
    }

    const head = document.createElement('div');
    head.className = 'music-album-tracklist-head';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = `${groupLabel} · ${groupSongs.length} pista${groupSongs.length === 1 ? '' : 's'} (orden Word)`;
    head.appendChild(titleSpan);

    const list = document.createElement('div');
    list.className = 'music-album-tracklist-items';
    groupSongs.forEach((trackSong, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isCurrent = Number(trackSong.id) === Number(song.id);
        btn.className = `music-album-track-btn${isCurrent ? ' is-active' : ''}`;
        const numLabel = trackSong.numero_pista
            ? String(trackSong.numero_pista).padStart(2, '0')
            : String(idx + 1).padStart(2, '0');
        btn.textContent = `${numLabel}. ${trackSong.titulo}${musicState.sessionLyricsBySongId[trackSong.id]?.lyrics ? ' ✓' : ''}`;
        btn.title = `${formatSongArtistsSummary(trackSong)} — ${trackSong.titulo}`;
        btn.addEventListener('click', () => {
            if (Number(trackSong.id) === Number(song.id)) return;
            seleccionarCancionParaEstudio(trackSong);
            if (musicState.ytdlpStatus?.pcOnline && obtenerLlaveE2EE() && !musicState.sessionLyricsBySongId[trackSong.id]?.lyrics) {
                solicitarOExtraerLetraViaPc(trackSong, { silent: true, forceExtract: false });
            }
        });
        list.appendChild(btn);
    });

    box.replaceChildren(head, list);
    box.hidden = false;
}

async function solicitarOExtraerLetraViaPc(song, { silent = false, forceExtract = false } = {}) {
    const hintEl = document.getElementById('musicLyricsStatusHint');
    if (!song) return false;

    try {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 2500) : null;
        const liveStatusRes = await fetch('/api/english/music/ytdlp-status', {
            cache: 'no-store',
            signal: controller ? controller.signal : undefined
        });
        if (timer) clearTimeout(timer);
        if (liveStatusRes.ok) {
            musicState.ytdlpStatus = await liveStatusRes.json();
            actualizarBadgePuentePc();
        }
    } catch (_) {
        if (musicState.ytdlpStatus) {
            musicState.ytdlpStatus.pcOnline = false;
            actualizarBadgePuentePc();
        }
    }

    if (!musicState.ytdlpStatus || musicState.ytdlpStatus.pcOnline === false) {
        const offlineMsg = tUi(
            '⚠️ Your PC is currently offline (sincronizador.py is not connected). Lyrics extraction is blocked in real time to avoid saturating the server queue.',
            '⚠️ Tu PC está apagada o desconectada en este momento (sincronizador.py no está activo). Se bloqueó la extracción en tiempo real para no saturar la cola del servidor.'
        );
        if (hintEl) hintEl.textContent = offlineMsg;
        if (!silent) showToast('err', offlineMsg);
        return false;
    }

    const llaveTexto = silent ? obtenerLlaveE2EE() : await solicitarLlaveE2EEAsync();
    if (!llaveTexto) return false;

    const wordEntryBase = {
        category: 'music',
        language: song.idioma || 'English',
        song_title: song.titulo,
        artists_display: formatSongArtistsSummary(song),
        album_title: song.album_titulo || '',
        album_type: RELEASE_TYPE_LABELS[song.album_tipo] || song.album_tipo || '',
        release_year: song.album_anio ? String(song.album_anio) : '',
        track_number: song.numero_pista || null,
        yt_music_url: song.yt_music_url || song.youtube_url || '',
        focus_summary: song.enfoque_corto || ''
    };

    const markWordSyncedLocal = () => {
        song.word_sincronizado = 1;
        const nextStatus = song.estado_estudio === 'to_study' ? 'in_progress' : (song.estado_estudio || 'in_progress');
        resilientFetchJson(`/api/english/music/songs/${song.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estadoEstudio: nextStatus, wordSynced: true })
        }, { timeoutMs: 8000 }).catch(() => { });
    };

    // 1. Intentar primero vía puente cifrado E2EE hacia tu PC (Word -> yt-dlp local -> Word)
    try {
        if (hintEl) {
            hintEl.textContent = tUi(
                '🔐 Querying your PC via E2EE encrypted tunnel (RAM)...',
                '🔐 Consultando tu PC por túnel cifrado E2EE (RAM)...'
            );
        }
        const jobPayload = {
            action: forceExtract ? 'extract_lyrics' : 'load_or_extract_lyrics',
            forceExtract: Boolean(forceExtract),
            songId: song.id,
            videoId: song.yt_video_id || '',
            ytMusicUrl: song.yt_music_url || song.youtube_url || '',
            idioma: song.idioma || 'English',
            songTitle: song.titulo,
            artistsDisplay: formatSongArtistsSummary(song),
            albumTitle: song.album_titulo || '',
            albumType: RELEASE_TYPE_LABELS[song.album_tipo] || song.album_tipo || '',
            releaseYear: song.album_anio ? String(song.album_anio) : '',
            trackNumber: song.numero_pista || null,
            focusSummary: song.enfoque_corto || ''
        };

        const createResp = await submitMutationRequest({
            url: '/api/english/music/pc-jobs',
            method: 'POST',
            buildBody: () => ({
                encryptedRequest: encriptarTextoE2EE(JSON.stringify(jobPayload), llaveTexto),
                timeoutMs: 40000
            }),
            parseJson: true,
            timeoutMs: 12000
        });

        if (createResp && createResp.jobId) {
            let jobResult = null;
            const maxPolls = createResp.pcOnline ? 2 : 1;
            for (let attempt = 0; attempt < maxPolls; attempt++) {
                const waitMs = createResp.pcOnline ? 18000 : 3500;
                const pollResp = await resilientFetchJson(
                    `/api/english/music/pc-jobs/${encodeURIComponent(createResp.jobId)}?waitMs=${waitMs}`,
                    { method: 'GET' },
                    { timeoutMs: waitMs + 5000 }
                );
                if (pollResp.ok && pollResp.data) {
                    if ((pollResp.data.status === 'completed' || pollResp.data.status === 'done') && pollResp.data.encryptedResult) {
                        jobResult = JSON.parse(desencriptarTextoE2EE(pollResp.data.encryptedResult, llaveTexto));
                        break;
                    }
                    if (pollResp.data.status === 'expired') {
                        break;
                    }
                } else if (pollResp.status === 404) {
                    break;
                }
            }

            if (jobResult) {
                if (musicState.ytdlpStatus) musicState.ytdlpStatus.pcOnline = true;
                actualizarBadgePuentePc();
                if (jobResult.ok && jobResult.lyrics) {
                    musicState.sessionLyricsBySongId[song.id] = {
                        lyrics: jobResult.lyrics,
                        source: jobResult.source || 'word-pc'
                    };
                    actualizarPanelLetraCancion(song, { forceSyncText: true });
                    if (jobResult.wordSaved) markWordSyncedLocal();
                    if (hintEl) {
                        hintEl.textContent = jobResult.source === 'word-pc'
                            ? tUi('✅ Lyrics loaded directly from your PC Word file (E2EE · 0 KB in DB).', '✅ Letra cargada directamente desde tu Word PC (E2EE · 0 KB en BD).')
                            : tUi(`✅ Extracted on your PC (${jobResult.source || 'yt-dlp'}) and filed in Word under Album/Track.`, `✅ Extraída en tu PC (${jobResult.source || 'yt-dlp'}) y organizada en tu Word bajo Álbum/Pista.`);
                    }
                    if (!silent) {
                        showToast('ok', jobResult.source === 'word-pc'
                            ? tUi('Lyrics loaded from PC Word!', '¡Letra cargada desde Word PC!')
                            : tUi('Lyrics extracted with yt-dlp on your PC and saved to Word!', '¡Letra extraída con yt-dlp en tu PC y guardada en Word!'));
                    }
                    return true;
                }
                if (jobResult.error && !silent) {
                    const ytdlpCmdEl = document.getElementById('musicYtdlpCommandCode');
                    const helperBox = document.getElementById('musicYtdlpHelperBox');
                    if (ytdlpCmdEl && jobResult.suggestedCommand) ytdlpCmdEl.textContent = jobResult.suggestedCommand;
                    if (helperBox && jobResult.reason === 'YTDLP_NOT_FOUND') helperBox.hidden = false;
                    const errTxt = tServer(jobResult.error);
                    if (hintEl) hintEl.textContent = `⚠️ ${errTxt}`;
                    showToast('info', errTxt);
                    return false;
                }
            } else if (musicState.ytdlpStatus && !createResp.pcOnline) {
                musicState.ytdlpStatus.pcOnline = false;
                actualizarBadgePuentePc();
            }
        }
    } catch (pcErr) {
        if (!silent && hintEl) {
            hintEl.textContent = tUi(
                `☁️ PC did not respond (${pcErr.message || 'offline'}), trying temporary RAM extraction...`,
                `☁️ PC no respondió (${pcErr.message || 'offline'}), probando extracción temporal en RAM...`
            );
        }
    }

    if (silent) return false;

    // 2. Fallback sin BD: extraer en RAM de instancia y encolar E2EE en RAM para Word cuando vuelva la PC
    try {
        const data = await submitMutationRequest({
            url: `/api/english/music/songs/${encodeURIComponent(song.id)}/lyrics/extract`,
            method: 'POST',
            buildBody: () => ({}),
            parseJson: true,
            timeoutMs: 32000
        });
        if (data && data.ok && data.lyrics) {
            musicState.sessionLyricsBySongId[song.id] = {
                lyrics: data.lyrics,
                source: `${data.source || 'yt-dlp'} (RAM)`
            };
            actualizarPanelLetraCancion(song, { forceSyncText: true });

            const wordEntry = { ...wordEntryBase, lyrics_study: data.lyrics };
            await submitMutationRequest({
                url: '/api/send-english',
                method: 'POST',
                scopeKey: 'english:music-lyrics-ram',
                signature: `lyrics-ram:${song.id}`,
                buildBody: () => ({ texto: encriptarTextoE2EE(JSON.stringify(wordEntry), llaveTexto) })
            }).catch(() => { });
            markWordSyncedLocal();

            if (hintEl) {
                hintEl.textContent = tUi(
                    `✅ Extracted into RAM (${data.source || 'yt-dlp'} · 0 KB in DB) and queued E2EE in EC2 RAM for your PC Word.`,
                    `✅ Extraída en RAM (${data.source || 'yt-dlp'} · 0 KB en BD) y encolada cifrada E2EE en RAM EC2 para tu Word PC.`
                );
            }
            showToast('ok', tUi(
                'Lyrics loaded in RAM and queued E2EE for your PC Word!',
                '¡Letra cargada en RAM y encolada E2EE para tu Word PC!'
            ));
            return true;
        }

        const ytdlpCmdEl = document.getElementById('musicYtdlpCommandCode');
        const helperBox = document.getElementById('musicYtdlpHelperBox');
        if (ytdlpCmdEl && data?.suggestedCommand) ytdlpCmdEl.textContent = data.suggestedCommand;
        if (helperBox && (data?.reason === 'bot_check' || data?.ytdlpAvailable === false)) helperBox.hidden = false;
        const fallbackErr = tServer(data?.error) || tUi(
            'PC is offline and no automatic CC subtitles are available. Paste lyrics manually or start sincronizador.py.',
            'PC offline y sin subtítulos CC automáticos disponibles. Pega la letra manual o enciende sincronizador.py.'
        );
        if (hintEl) {
            hintEl.textContent = `⚠️ ${fallbackErr}`;
        }
        showToast('info', tServer(data?.error) || tUi('This video did not expose automatic CC subtitles.', 'Este video no expuso subtítulos CC automáticos.'));
    } catch (err) {
        const msgErr = tServer(err.message) || tUi('Error extracting lyrics.', 'Error extrayendo letra.');
        if (hintEl) hintEl.textContent = `⚠️ ${msgErr}`;
        showToast('err', msgErr);
    }
    return false;
}

function parseAndDivideLyricsByLanguage(rawLyrics = '') {
    const clean = String(rawLyrics || '').replace(/\r\n/g, '\n').trim();
    if (!clean) return [];

    const headerPattern = /(?:^|\n)(?:===\s*\[([^\]]+)\]\s*===|\[([A-Za-z]{2,12}(?:\s*[—-][^\]]*)?)\])\s*\n/g;
    const matches = [];
    let m;
    while ((m = headerPattern.exec(clean)) !== null) {
        const rawTag = String(m[1] || m[2] || '').trim().toUpperCase();
        matches.push({
            rawTag,
            headerStart: m.index,
            bodyStart: m.index + m[0].length
        });
    }

    const classifyTag = (rawTag) => {
        if (rawTag.startsWith('KO') || rawTag.includes('COREANO') || rawTag.includes('KOREAN')) {
            return { code: 'ko', title: '🇰🇷 Coreano (Hangul + Romanización)' };
        }
        if (rawTag.startsWith('EN') || rawTag.includes('INGL')) {
            return { code: 'en', title: '🇺🇸 Inglés (English)' };
        }
        if (rawTag.startsWith('ES') || rawTag.includes('ESPAÑOL') || rawTag.includes('TRADUCCI')) {
            return { code: 'es', title: '🇪🇸 Español (Traducción Completa)' };
        }
        return { code: 'full', title: `🎵 ${rawTag || 'Letra Original'}` };
    };

    const splitLinesByScript = (linesArr) => {
        const koLines = [];
        const enLines = [];
        const esLines = [];
        const hasSpanishCues = /\b(que|para|como|pero|por|con|una|los|las|del|estoy|quiero|corazón|amor|siempre|noche|dime|todo|nada)\b/i;

        linesArr.forEach(line => {
            const t = line.trim();
            if (!t) return;
            if (/[\uAC00-\uD7A3\u3131-\u318E]/.test(t)) {
                koLines.push(t);
            } else if (/[áéíóúñ¿¡]/i.test(t) || hasSpanishCues.test(t)) {
                esLines.push(t);
            } else {
                enLines.push(t);
            }
        });
        return { koLines, enLines, esLines };
    };

    const blocks = [];

    if (matches.length > 0) {
        const leadingText = clean.slice(0, matches[0].headerStart).trim();
        if (leadingText) {
            const leadingLines = leadingText.split('\n');
            blocks.push({
                code: 'full',
                title: '🎵 Letra Original Completa (Sin cortes)',
                lines: leadingLines
            });
            const { koLines, enLines } = splitLinesByScript(leadingLines);
            if (enLines.length > 0) {
                blocks.push({ code: 'en', title: `🇺🇸 Inglés (${enLines.length} líneas)`, lines: enLines });
            }
            if (koLines.length > 0) {
                blocks.push({ code: 'ko', title: `🇰🇷 Coreano + Romanización (${koLines.length} líneas)`, lines: koLines });
            }
        }

        for (let i = 0; i < matches.length; i += 1) {
            const cur = matches[i];
            const nextStart = i + 1 < matches.length ? matches[i + 1].headerStart : clean.length;
            const body = clean.slice(cur.bodyStart, nextStart).trim();
            if (!body) continue;
            const meta = classifyTag(cur.rawTag);
            const bodyLines = body.split('\n');
            blocks.push({
                code: meta.code,
                title: meta.title,
                lines: bodyLines
            });
        }
        return blocks;
    }

    const allLines = clean.split('\n');
    const { koLines, enLines, esLines } = splitLinesByScript(allLines);

    blocks.push({
        code: 'full',
        title: '🎵 Letra Original Completa (Sin cortes)',
        lines: allLines
    });
    if (enLines.length > 0) {
        blocks.push({
            code: 'en',
            title: `🇺🇸 Inglés (${enLines.length} líneas)`,
            lines: enLines
        });
    }
    if (koLines.length > 0) {
        blocks.push({
            code: 'ko',
            title: `🇰🇷 Coreano + Romanización (${koLines.length} líneas)`,
            lines: koLines
        });
    }
    if (esLines.length > 0) {
        blocks.push({
            code: 'es',
            title: `🇪🇸 Español (${esLines.length} líneas)`,
            lines: esLines
        });
    }
    return blocks;
}

function renderReadonlyLyricsByLanguage(rawLyrics = '', filterLang = 'all') {
    const host = document.getElementById('musicLyricsReadonlyBlocks');
    if (!host) return;
    host.replaceChildren();

    const clean = String(rawLyrics || '').trim();
    if (!clean) {
        const emptyBox = document.createElement('div');
        emptyBox.className = 'lyrics-lang-section';
        emptyBox.textContent = 'Presiona "📄 Extraer Letra" arriba para cargar la letra completa en solo lectura desde tu Word o PC.';
        host.appendChild(emptyBox);
        return;
    }

    const sections = parseAndDivideLyricsByLanguage(clean);
    let listToRender = sections;

    if (filterLang === 'all') {
        const hasExplicitLangs = sections.some(s => s.code === 'ko' || s.code === 'en') && !sections.some(s => s.code === 'full');
        listToRender = hasExplicitLangs
            ? sections
            : sections.filter(s => s.code === 'full' || s.code === 'es' || (!sections.some(x => x.code === 'full') && s.code !== 'mix'));
        if (!listToRender.length) listToRender = sections;
    } else {
        const matching = sections.filter(s => s.code === filterLang);
        listToRender = matching.length ? matching : sections.filter(s => s.code === 'full');
    }

    listToRender.forEach(sec => {
        const card = document.createElement('div');
        card.className = 'lyrics-lang-section';

        const head = document.createElement('div');
        head.className = 'lyrics-lang-section-head';
        const titleSpan = document.createElement('span');
        titleSpan.textContent = sec.title;
        const countSpan = document.createElement('small');
        countSpan.className = 'muted-text';
        countSpan.textContent = `${sec.lines.filter(l => l.trim()).length} líneas · Solo lectura`;
        head.append(titleSpan, countSpan);

        const body = document.createElement('div');
        body.className = 'lyrics-lang-body';

        sec.lines.forEach(line => {
            const lineDiv = document.createElement('div');
            lineDiv.textContent = line || ' ';
            body.appendChild(lineDiv);

            if (/[\uAC00-\uD7A3]/.test(line) && typeof hangulToRomanizationClient === 'function') {
                const rom = hangulToRomanizationClient(line);
                if (rom && rom !== line) {
                    const romSmall = document.createElement('small');
                    romSmall.className = 'lyrics-line-rom-hint';
                    romSmall.textContent = `[${rom}]`;
                    body.appendChild(romSmall);
                }
            }
        });

        card.append(head, body);
        host.appendChild(card);
    });
}

function actualizarPanelLetraCancion(song, { forceSyncText = false } = {}) {
    const card = document.getElementById('musicLyricsViewerCard');
    const badge = document.getElementById('musicLyricsMetaBadge');
    const viewer = document.getElementById('musicSongLyricsViewer');
    const hint = document.getElementById('musicLyricsStatusHint');
    const extractBtn = document.getElementById('btnMusicExtractLyrics');
    const langFilterEl = document.getElementById('musicLyricsTrackLangFilter');
    if (!card || !viewer) return;

    viewer.readOnly = true;
    viewer.hidden = true;

    if (!song) {
        card.hidden = true;
        viewer.value = '';
        viewer.dataset.loadedSongId = '';
        renderReadonlyLyricsByLanguage('', 'all');
        if (badge) badge.textContent = tUi('PC Word Only', 'Solo en Word PC');
        renderMusicLyricsAlbumPlaylist(null);
        return;
    }

    card.hidden = false;
    const songIdStr = String(song.id);
    const cachedSession = musicState.sessionLyricsBySongId[song.id] || null;
    const savedLyrics = String(cachedSession?.lyrics || '');
    const songChanged = viewer.dataset.loadedSongId !== songIdStr;
    if (forceSyncText || songChanged || (!viewer.value.trim() && savedLyrics)) {
        viewer.value = savedLyrics;
        viewer.dataset.loadedSongId = songIdStr;
    }

    const activeLangFilter = langFilterEl ? langFilterEl.value : 'all';
    renderReadonlyLyricsByLanguage(viewer.value, activeLangFilter);

    if (badge) {
        if (savedLyrics.trim()) {
            const lineCount = savedLyrics.split(/\r?\n/).filter(l => l.trim()).length;
            badge.textContent = tUi(`${lineCount} lines · Read-Only`, `${lineCount} líneas · Solo lectura`);
        } else {
            badge.textContent = song.word_sincronizado
                ? tUi('In PC Word (click Extract Lyrics)', 'En Word PC (pulsa Extraer Letra)')
                : tUi('PC Word Only', 'Solo en Word PC');
        }
    }

    actualizarBadgePuentePc();
    renderMusicLyricsAlbumPlaylist(song);

    const hasVideoId = Boolean(song.yt_video_id && /^[A-Za-z0-9_-]{11}$/.test(song.yt_video_id)) || Boolean(song.yt_music_url);
    if (extractBtn) extractBtn.disabled = !hasVideoId;

    if (hint && !savedLyrics.trim()) {
        hint.textContent = 'Letra en modo solo lectura completa y dividida por idiomas (selecciona cualquier frase con el mouse o dedo para traducirla).';
    }
}

function buildMusicEmbedToolbar({ song, targetPlayback, isYtdlpActive, isNoCookie }) {
    const toolbar = document.createElement('div');
    toolbar.className = 'music-embed-toolbar';

    const btnToggleMode = document.createElement('button');
    btnToggleMode.type = 'button';
    btnToggleMode.className = isYtdlpActive ? 'btn-secondary btn-small' : 'btn-primary btn-small';
    btnToggleMode.textContent = isYtdlpActive
        ? '▶️ Probar YouTube iframe'
        : '🎧 Reproducir en App (yt-dlp · sin bloqueo)';
    btnToggleMode.addEventListener('click', () => {
        musicState.embedMode = isYtdlpActive ? 'iframe' : 'ytdlp';
        actualizarBarraCancionEstudio();
    });

    const btnPopup = document.createElement('button');
    btnPopup.type = 'button';
    btnPopup.className = 'btn-secondary btn-small';
    btnPopup.textContent = '📺 Ventana flotante (sin bloqueo)';
    btnPopup.addEventListener('click', () => {
        const popUrl = targetPlayback.url || `https://www.youtube.com/watch?v=${encodeURIComponent(song.yt_video_id)}`;
        window.open(popUrl, 'ytStudyFloatingPlayer', 'width=540,height=380,resizable=yes,scrollbars=yes');
    });

    toolbar.append(btnToggleMode, btnPopup);

    if (!isYtdlpActive) {
        const btnSwitchHost = document.createElement('button');
        btnSwitchHost.type = 'button';
        btnSwitchHost.className = 'btn-secondary btn-small';
        btnSwitchHost.textContent = isNoCookie ? '🔄 Usar youtube.com' : '🔄 Probar nocookie';
        btnSwitchHost.addEventListener('click', () => {
            musicState.embedHost = isNoCookie ? 'youtube' : 'nocookie';
            actualizarBarraCancionEstudio();
        });
        toolbar.appendChild(btnSwitchHost);
    }

    if (targetPlayback.url) {
        const extLink = document.createElement('a');
        extLink.className = 'btn-secondary btn-small';
        extLink.href = targetPlayback.url;
        extLink.target = '_blank';
        extLink.rel = 'noopener noreferrer';
        extLink.textContent = `↗ ${targetPlayback.fullLabel}`;
        toolbar.appendChild(extLink);
    }

    return toolbar;
}

function actualizarBarraCancionEstudio() {
    const bar = document.getElementById('musicStudySelectedBar');
    const songIdInput = document.getElementById('musicWordSongId');
    const editSelectedBtn = document.getElementById('btnMusicStudyEditSelected');
    const openYtBtn = document.getElementById('btnMusicStudyOpenYt');
    const toggleEmbedBtn = document.getElementById('btnMusicToggleEmbed');
    const embedBox = document.getElementById('musicEmbedPlayerBox');
    const ytdlpCmdEl = document.getElementById('musicYtdlpCommandCode');
    const song = getCancionSeleccionada();

    if (songIdInput) songIdInput.value = song ? String(song.id) : '';
    if (editSelectedBtn) editSelectedBtn.hidden = !song;
    if (ytdlpCmdEl) ytdlpCmdEl.textContent = getYtdlpCommandForSong(song);
    actualizarPanelLetraCancion(song);

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

    const targetPlayback = getSongTargetPlaybackInfo(song);
    if (openYtBtn) {
        if (targetPlayback.url) {
            openYtBtn.href = targetPlayback.url;
            openYtBtn.textContent = targetPlayback.fullLabel;
            openYtBtn.hidden = false;
        } else {
            openYtBtn.hidden = true;
        }
    }

    const validVideoId = song.yt_video_id && /^[A-Za-z0-9_-]{11}$/.test(song.yt_video_id);
    if (toggleEmbedBtn) {
        if (validVideoId) {
            toggleEmbedBtn.hidden = false;
            toggleEmbedBtn.textContent = musicState.embedOpen
                ? tUi('Hide Mini Player', 'Ocultar Mini Reproductor')
                : tUi('Mini Player', 'Mini Reproductor');
        } else {
            toggleEmbedBtn.hidden = true;
            musicState.embedOpen = false;
        }
    }

    if (embedBox) {
        if (musicState.embedOpen && validVideoId) {
            const isYtdlpActive = musicState.embedMode === 'ytdlp';
            const isNoCookie = musicState.embedHost === 'nocookie';
            const toolbar = buildMusicEmbedToolbar({ song, targetPlayback, isYtdlpActive, isNoCookie });

            const note = document.createElement('div');
            const knownBlocked = musicState.embeddableByVideoId[song.yt_video_id] === false;

            if (isYtdlpActive) {
                const videoEl = document.createElement('video');
                videoEl.className = 'music-html5-player';
                videoEl.controls = true;
                videoEl.playsInline = true;
                videoEl.preload = 'metadata';
                videoEl.poster = song.thumbnail_url || `https://i.ytimg.com/vi/${encodeURIComponent(song.yt_video_id)}/hqdefault.jpg`;
                videoEl.src = `/api/english/music/songs/${encodeURIComponent(song.id)}/media`;

                note.className = musicState.ytdlpStatus && musicState.ytdlpStatus.available === false
                    ? 'music-embed-fallback-note is-warning'
                    : 'music-embed-fallback-note';
                note.textContent = musicState.ytdlpStatus && musicState.ytdlpStatus.available === false
                    ? tUi(
                        '⚠️ yt-dlp is unavailable on this server: try "▶️ Try YouTube iframe" or "📺 Floating Window (unblocked)".',
                        '⚠️ yt-dlp no está disponible en este servidor: prueba "▶️ Probar YouTube iframe" o "📺 Ventana flotante (sin bloqueo)".'
                    )
                    : tUi(
                        '🎧 Direct yt-dlp player active inside the app (bypasses YouTube/label iframe blocks).',
                        '🎧 Reproductor directo yt-dlp activo dentro de la app (evita bloqueos de iframe de YouTube/sellos).'
                    );

                videoEl.addEventListener('canplay', () => {
                    note.className = 'music-embed-fallback-note';
                    note.textContent = tUi(
                        '🎧 Direct yt-dlp stream ready inside the app (seekable playback without iframe restrictions).',
                        '🎧 Stream directo yt-dlp listo dentro de la app (seek/progreso compatible sin bloqueo de iframe).'
                    );
                }, { once: true });

                videoEl.addEventListener('error', async () => {
                    let msg = tUi(
                        'Direct yt-dlp player could not start streaming right now.',
                        'El reproductor directo yt-dlp no pudo iniciar el stream en este momento.'
                    );
                    try {
                        const probe = await fetch(`/api/english/music/songs/${encodeURIComponent(song.id)}/media`, {
                            headers: { Range: 'bytes=0-1' }
                        });
                        if (!probe.ok) {
                            const errJson = await probe.json().catch(() => null);
                            if (errJson && errJson.error) msg = tServer(errJson.error);
                        }
                    } catch (_) { }
                    note.className = 'music-embed-fallback-note is-warning';
                    note.textContent = tUi(
                        `⚠️ ${msg} -> Use "📺 Floating Window (unblocked)" or "▶️ Try YouTube iframe".`,
                        `⚠️ ${msg} -> Usa "📺 Ventana flotante (sin bloqueo)" o "▶️ Probar YouTube iframe".`
                    );
                }, { once: true });

                embedBox.replaceChildren(videoEl, toolbar, note);
                embedBox.hidden = false;
                return;
            }

            const hostDomain = isNoCookie ? 'www.youtube-nocookie.com' : 'www.youtube.com';
            const iframe = document.createElement('iframe');
            iframe.src = `https://${hostDomain}/embed/${encodeURIComponent(song.yt_video_id)}?rel=0&playsinline=1`;
            iframe.title = `${song.titulo} - ${tUi('Audio / Video Study Player', 'Reproductor Audio / Video')}`;
            iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
            iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
            iframe.allowFullscreen = true;

            note.className = knownBlocked ? 'music-embed-fallback-note is-warning' : 'music-embed-fallback-note';
            note.textContent = knownBlocked
                ? tUi(
                    '⚠️ The owner channel/label restricted embedding. Use "🎧 Play in App (yt-dlp · no block)" or "📺 Floating Window (unblocked)".',
                    '⚠️ El sello/canal dueño restringió el iframe. Usa "🎧 Reproducir en App (yt-dlp · sin bloqueo)" o "📺 Ventana flotante (sin bloqueo)".'
                )
                : tUi(
                    '💡 If "This video is unavailable" appears, click "🎧 Play in App (yt-dlp · no block)" or "📺 Floating Window (unblocked)".',
                    '💡 Si aparece "Este video no está disponible", presiona "🎧 Reproducir en App (yt-dlp · sin bloqueo)" o "📺 Ventana flotante (sin bloqueo)".'
                );

            embedBox.replaceChildren(iframe, toolbar, note);
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
    musicState.embedMode = getDefaultEmbedModeForSong(song);
    actualizarPanelLetraCancion(song, { forceSyncText: true });
    actualizarBarraCancionEstudio();
    renderMusicCatalog();
    const card = document.getElementById('musicWordStudyCard');
    if (card && typeof card.scrollIntoView === 'function') {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function prepararAgregarCancionAAlbum({ mainArtist = '', artistType = '', albumTitle = '', albumType = 'mini_album', albumYear = '' } = {}) {
    cancelarEdicionCancionMusica();
    const musicTab = document.querySelector('.english-tab-btn[data-english-cat="music"]');
    if (musicTab) musicTab.click();

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val ?? '';
    };

    const matchedArtist = (musicState.artists || []).find(
        a => String(a.nombre || '').toLowerCase() === String(mainArtist || '').trim().toLowerCase()
    );
    setVal('musicMainArtist', mainArtist || '');
    setVal('musicMainArtistType', artistType || matchedArtist?.tipo_artista || 'group');
    setVal('musicAlbumTitle', albumTitle || '');
    setVal('musicAlbumType', albumType || 'mini_album');
    setVal('musicAlbumYear', albumYear ? String(albumYear) : '');

    if (albumTitle) {
        const matchingTracks = (musicState.songs || [])
            .filter(s => String(s.album_titulo || '').toLowerCase() === String(albumTitle).trim().toLowerCase())
            .map(s => Number(s.numero_pista) || 0);
        const maxTrack = matchingTracks.length ? Math.max(...matchingTracks) : 0;
        setVal('musicSongTrackNumber', String(maxTrack + 1));
    }

    const titleEl = document.getElementById('musicSongFormTitle');
    if (titleEl) {
        titleEl.textContent = albumTitle
            ? tUi(`Add Song to "${albumTitle}"`, `Agregar canción a "${albumTitle}"`)
            : (mainArtist ? tUi(`Add Song for ${mainArtist}`, `Agregar canción para ${mainArtist}`) : tUi('Register or Link Song', 'Registrar o Vincular Canción'));
    }

    const songTitleEl = document.getElementById('musicSongTitle');
    const form = document.getElementById('musicSongForm');
    if (form && typeof form.scrollIntoView === 'function') {
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (songTitleEl && typeof songTitleEl.focus === 'function') {
        songTitleEl.focus();
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
    setVal('musicSongLanguage', song.idioma || 'English + Korean (K-Pop)');
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
    form?.closest('.music-panel-card')?.classList.add('is-editing-song');
    if (form && typeof form.scrollIntoView === 'function') {
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    document.getElementById('musicSongTitle')?.focus();
}

function cancelarEdicionCancionMusica() {
    musicState.editingSongId = null;
    const form = document.getElementById('musicSongForm');
    if (form) {
        form.reset();
        form.closest('.music-panel-card')?.classList.remove('is-editing-song');
    }
    const langInput = document.getElementById('musicSongLanguage');
    if (langInput) langInput.value = 'English + Korean (K-Pop)';
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
    const deleteBtn = document.getElementById('btnDeleteMusicEntityModal');
    if (deleteBtn) deleteBtn.hidden = isArtist;

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
    const btnDelete = document.getElementById('btnDeleteMusicEntityModal');
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

    if (btnDelete) {
        btnDelete.addEventListener('click', async () => {
            const kind = document.getElementById('musicEntityKind')?.value;
            const entityId = Number(document.getElementById('musicEntityId')?.value || 0);
            const rawName = (document.getElementById('musicEntityName')?.value || '').trim();
            if (kind !== 'album' || !entityId) return;

            const ok = await openConfirmDialog({
                title: tUi('Delete Album / Mini Album?', '¿Eliminar álbum / mini álbum?'),
                message: tUi(
                    `Delete "${rawName || 'this album'}"? Its songs will NOT be deleted—they will move cleanly to Standalone Singles & Tracks.`,
                    `¿Eliminar "${rawName || 'este álbum'}"? Sus canciones NO se eliminarán: pasarán a Sencillos y Pistas Independientes.`
                ),
                confirmText: tUi('Delete Album', 'Eliminar Álbum'),
                danger: true
            });
            if (!ok) return;

            runWithButtonLock(btnDelete, async () => {
                const res = await fetch(`/api/english/music/albums/${entityId}`, { method: 'DELETE' });
                if (res.ok) {
                    closeModal();
                    showToast('ok', tUi(`Deleted album "${rawName}" (songs preserved).`, `Álbum "${rawName}" eliminado (canciones conservadas).`));
                    await cargarCatalogoMusical();
                } else {
                    const errText = await res.text();
                    mostrarBannerMusica('musicEntityEditBanner', 'err', tServer(errText) || tUi('Could not delete album.', 'No se pudo eliminar el álbum.'));
                }
            }, { loadingText: tUi('Deleting...', 'Eliminando...') });
        });
    }

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

function openMusicAlbumCreateModal({ artistName = '', artistType = '' } = {}) {
    const modal = document.getElementById('musicAlbumCreateModal');
    const form = document.getElementById('musicAlbumCreateForm');
    if (!modal || !form) return;

    form.reset();
    const artistInput = document.getElementById('newAlbumArtist');
    const artistTypeInput = document.getElementById('newAlbumArtistType');
    const albumTypeInput = document.getElementById('newAlbumType');
    const titleInput = document.getElementById('newAlbumTitle');

    const resolvedArtist = artistName || (document.getElementById('musicMainArtist')?.value || '').trim();
    const matched = (musicState.artists || []).find(
        a => String(a.nombre || '').toLowerCase() === String(resolvedArtist).toLowerCase()
    );

    if (artistInput) artistInput.value = resolvedArtist;
    if (artistTypeInput) {
        artistTypeInput.value = artistType || matched?.tipo_artista || document.getElementById('musicMainArtistType')?.value || 'group';
    }
    if (albumTypeInput) albumTypeInput.value = 'mini_album';
    mostrarBannerMusica('musicAlbumCreateBanner', '', '');
    modal.hidden = false;

    if (resolvedArtist && titleInput) {
        titleInput.focus();
    } else if (artistInput) {
        artistInput.focus();
    }
}

function initMusicAlbumCreateModal() {
    const modal = document.getElementById('musicAlbumCreateModal');
    const form = document.getElementById('musicAlbumCreateForm');
    const btnClose = document.getElementById('btnCloseMusicAlbumCreateModal');
    const btnCancel = document.getElementById('btnCancelMusicAlbumCreateModal');
    const btnSaveOnly = document.getElementById('btnSaveAlbumOnly');
    const btnSaveAndAdd = document.getElementById('btnSaveAlbumAndAddSong');
    if (!modal || !form || form.dataset.wired === 'true') return;
    form.dataset.wired = 'true';

    const closeModal = () => {
        modal.hidden = true;
        mostrarBannerMusica('musicAlbumCreateBanner', '', '');
    };

    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.hidden) closeModal();
    });

    const submitCreateAlbum = (andAddSong) => {
        const val = id => (document.getElementById(id)?.value || '').trim();
        const payload = {
            mainArtist: val('newAlbumArtist'),
            artistType: val('newAlbumArtistType') || 'group',
            albumTitle: val('newAlbumTitle'),
            albumType: val('newAlbumType') || 'mini_album',
            albumYear: val('newAlbumYear'),
            notasCortas: val('newAlbumNotes')
        };

        if (!payload.mainArtist || !payload.albumTitle) {
            mostrarBannerMusica('musicAlbumCreateBanner', 'err', 'Main artist and Album / Mini Album title are required.');
            return;
        }

        const lockTarget = andAddSong ? btnSaveAndAdd : btnSaveOnly;
        mostrarBannerMusica('musicAlbumCreateBanner', '', '');
        runWithButtonLock(lockTarget, async () => {
            try {
                const resData = await submitMutationRequest({
                    url: '/api/english/music/albums',
                    method: 'POST',
                    scopeKey: 'english-music-album:create',
                    signature: JSON.stringify(payload),
                    buildBody: () => payload,
                    parseJson: true
                });
                closeModal();
                if (resData?.album?.artista_principal_id) {
                    musicState.navArtistId = Number(resData.album.artista_principal_id);
                }
                if (resData?.album?.id) {
                    musicState.navAlbumKey = `alb_${resData.album.id}`;
                }
                showToast('ok', resData?.message || `Saved "${payload.albumTitle}".`);
                await cargarCatalogoMusical();
                if (andAddSong) {
                    prepararAgregarCancionAAlbum({
                        mainArtist: payload.mainArtist,
                        artistType: payload.artistType,
                        albumTitle: payload.albumTitle,
                        albumType: payload.albumType,
                        albumYear: payload.albumYear
                    });
                }
            } catch (err) {
                mostrarBannerMusica('musicAlbumCreateBanner', 'err', err.message || 'Could not create album.');
            }
        }, { loadingText: 'Saving...' });
    };

    if (btnSaveOnly) {
        btnSaveOnly.addEventListener('click', () => submitCreateAlbum(false));
    }
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitCreateAlbum(true);
    });
}

function renderMusicCatalog() {
    const container = document.getElementById('musicCatalogContainer');
    if (!container) return;

    const search = (document.getElementById('musicFilterSearch')?.value || '').trim().toLowerCase();
    const artistFilter = (document.getElementById('musicFilterArtist')?.value || '').trim();
    const releaseFilter = (document.getElementById('musicFilterReleaseType')?.value || '').trim().toLowerCase();
    const langFilter = (document.getElementById('musicFilterLanguage')?.value || '').trim().toLowerCase();
    const statusFilter = (document.getElementById('musicFilterStatus')?.value || '').trim().toLowerCase();

    const matchesLang = (songLangRaw) => {
        if (!langFilter) return true;
        const sLang = String(songLangRaw || 'English').trim().toLowerCase();
        if (sLang === langFilter) return true;
        if (langFilter === 'english' && sLang.includes('english')) return true;
        if (langFilter === 'korean' && (sLang.includes('korean') || sLang.includes('k-pop'))) return true;
        return false;
    };

    const filteredSongs = (musicState.songs || []).filter(song => {
        if (artistFilter) {
            const hasArtist = (song.artists || []).some(a => String(a.id) === String(artistFilter));
            if (!hasArtist) return false;
        }
        if (releaseFilter && String(song.album_tipo || 'single').toLowerCase() !== releaseFilter) return false;
        if (!matchesLang(song.idioma)) return false;
        if (statusFilter && String(song.estado_estudio || 'to_study').toLowerCase() !== statusFilter) return false;
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

    const artistBuckets = new Map();
    const ensureArtistBucket = (id, nombre) => {
        const key = id || 0;
        if (!artistBuckets.has(key)) {
            artistBuckets.set(key, {
                id: key,
                nombre: nombre || 'Unknown Artist',
                albums: new Map()
            });
        }
        return artistBuckets.get(key);
    };

    filteredSongs.forEach(song => {
        const artists = Array.isArray(song.artists) && song.artists.length
            ? song.artists
            : [{ id: 0, nombre: 'Unknown Artist', rol: 'main' }];

        artists.forEach(art => {
            if (artistFilter && String(art.id) !== String(artistFilter)) return;
            const bucket = ensureArtistBucket(art.id, art.nombre);
            const albumKey = song.album_id ? `alb_${song.album_id}` : 'single_none';
            if (!bucket.albums.has(albumKey)) {
                bucket.albums.set(albumKey, {
                    key: albumKey,
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

    if (!langFilter && !statusFilter) {
        (musicState.albums || []).forEach(al => {
            const aid = al.artista_principal_id || 0;
            const aname = al.artista_principal_nombre || 'Independent Releases';
            if (artistFilter && String(aid) !== String(artistFilter)) return;
            if (releaseFilter && String(al.tipo_lanzamiento || 'album').toLowerCase() !== releaseFilter) return;
            if (search) {
                const hay = [al.titulo, aname, al.notas_cortas].filter(Boolean).join(' ').toLowerCase();
                if (!hay.includes(search)) return;
            }
            const bucket = ensureArtistBucket(aid, aname);
            const albumKey = `alb_${al.id}`;
            if (!bucket.albums.has(albumKey)) {
                bucket.albums.set(albumKey, {
                    key: albumKey,
                    albumId: al.id,
                    titulo: al.titulo,
                    tipo: al.tipo_lanzamiento || 'album',
                    anio: al.anio || null,
                    songs: []
                });
            }
        });
    }

    if (!artistBuckets.size) {
        const hasCatalogItems = Boolean((musicState.songs && musicState.songs.length) || (musicState.albums && musicState.albums.length));
        const wrap = document.createElement('div');
        const emptyP = document.createElement('p');
        emptyP.className = 'muted-text';
        emptyP.textContent = hasCatalogItems
            ? tUi('No songs or albums match your current filters.', 'Ninguna canción o álbum coincide con los filtros actuales.')
            : tUi('No songs or albums registered yet.', 'Aún no hay canciones o álbumes registrados.');
        wrap.appendChild(emptyP);

        if (hasCatalogItems && (search || artistFilter || releaseFilter || langFilter || statusFilter)) {
            const resetBtn = document.createElement('button');
            resetBtn.type = 'button';
            resetBtn.id = 'btnResetMusicFilters';
            resetBtn.className = 'btn-secondary btn-small';
            resetBtn.textContent = tUi('Reset Catalog Filters', 'Restablecer filtros');
            resetBtn.addEventListener('click', () => {
                ['musicFilterSearch', 'musicFilterArtist', 'musicFilterReleaseType', 'musicFilterLanguage', 'musicFilterStatus'].forEach(fid => {
                    const el = document.getElementById(fid);
                    if (el) el.value = '';
                });
                renderMusicCatalog();
            });
            wrap.appendChild(resetBtn);
        }
        container.replaceChildren(wrap);
        return;
    }

    const sortedArtists = Array.from(artistBuckets.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const isFilteringActive = Boolean(search || artistFilter || releaseFilter || langFilter || statusFilter);
    const fragment = document.createDocumentFragment();

    if (musicState.openArtistFolders.size === 0 && sortedArtists.length > 0) {
        musicState.openArtistFolders.add(String(sortedArtists[0].id || sortedArtists[0].nombre));
    }

    const createWinFolderTile = ({ title, subtitle, thumbUrl, isOpen, onClick }) => {
        const tile = document.createElement('div');
        tile.className = `win-folder-tile${isOpen ? ' is-open' : ''}`;
        const graphic = document.createElement('div');
        graphic.className = 'win-folder-graphic';
        const back = document.createElement('div');
        back.className = 'win-folder-back';
        graphic.appendChild(back);

        if (thumbUrl && /^https:\/\/i\.ytimg\.com\//i.test(thumbUrl)) {
            const img = document.createElement('img');
            img.className = 'win-folder-thumb';
            img.src = thumbUrl;
            img.alt = title;
            img.loading = 'lazy';
            graphic.appendChild(img);
        }
        const front = document.createElement('div');
        front.className = 'win-folder-front';
        graphic.appendChild(front);

        const tEl = document.createElement('div');
        tEl.className = 'win-folder-title';
        protectUserNode(tEl);
        tEl.textContent = title;

        const sEl = document.createElement('div');
        sEl.className = 'win-folder-sub';
        sEl.textContent = subtitle;

        tile.append(graphic, tEl, sEl);
        tile.addEventListener('click', onClick);
        return tile;
    };

    const artistsGrid = document.createElement('div');
    artistsGrid.className = 'win-folders-grid';

    sortedArtists.forEach(artistGroup => {
        const artistFolderKey = String(artistGroup.id || artistGroup.nombre);
        const isArtistOpen = isFilteringActive || musicState.openArtistFolders.has(artistFolderKey);
        const totalSongs = Array.from(artistGroup.albums.values()).reduce((acc, al) => acc + al.songs.length, 0);
        const sampleSong = Array.from(artistGroup.albums.values())
            .flatMap(al => al.songs)
            .map(x => x.song)
            .find(s => s.thumbnail_url);

        const tile = createWinFolderTile({
            title: artistGroup.nombre,
            subtitle: `${artistGroup.albums.size} álbum(es) · ${totalSongs} canción(es)`,
            thumbUrl: sampleSong?.thumbnail_url || '',
            isOpen: isArtistOpen,
            onClick: () => {
                if (musicState.openArtistFolders.has(artistFolderKey)) {
                    musicState.openArtistFolders.delete(artistFolderKey);
                } else {
                    musicState.openArtistFolders.add(artistFolderKey);
                }
                renderMusicCatalog();
            }
        });
        artistsGrid.appendChild(tile);
    });
    fragment.appendChild(artistsGrid);

    sortedArtists.forEach(artistGroup => {
        const artistFolderKey = String(artistGroup.id || artistGroup.nombre);
        const isArtistOpen = isFilteringActive || musicState.openArtistFolders.has(artistFolderKey);
        if (!isArtistOpen) return;

        const artistRecord = (musicState.artists || []).find(a => Number(a.id) === Number(artistGroup.id));
        const artistSection = document.createElement('div');
        artistSection.className = 'win-folder-expanded-panel music-artist-group is-open';

        const head = document.createElement('div');
        head.className = 'win-folder-expanded-head';
        const hTitle = document.createElement('strong');
        protectUserNode(hTitle);
        hTitle.textContent = `📂 ${artistGroup.nombre} — Haz clic en una carpeta de Álbum para desplegar sus canciones`;

        const headActions = document.createElement('div');
        headActions.className = 'music-artist-head-actions';
        if (artistGroup.id > 0) {
            const newAlbBtn = document.createElement('button');
            newAlbBtn.type = 'button';
            newAlbBtn.className = 'btn-mini-add';
            newAlbBtn.textContent = '💿 + Álbum';
            newAlbBtn.addEventListener('click', () => openMusicAlbumCreateModal({
                artistName: artistGroup.nombre,
                artistType: artistRecord?.tipo_artista || 'group'
            }));

            const addSongBtn = document.createElement('button');
            addSongBtn.type = 'button';
            addSongBtn.className = 'btn-mini-add';
            addSongBtn.textContent = '➕ Agregar Canción';
            addSongBtn.addEventListener('click', () => prepararAgregarCancionAAlbum({
                mainArtist: artistGroup.nombre,
                artistType: artistRecord?.tipo_artista || 'group',
                albumTitle: '',
                albumType: 'single'
            }));

            const editArtBtn = document.createElement('button');
            editArtBtn.type = 'button';
            editArtBtn.className = 'btn-mini-edit';
            editArtBtn.textContent = '✏️ Editar Artista';
            editArtBtn.addEventListener('click', () => openMusicEntityEditModal('artist', {
                id: artistGroup.id,
                nombre: artistGroup.nombre,
                tipo_artista: artistRecord?.tipo_artista || 'group',
                notas_cortas: artistRecord?.notas_cortas || ''
            }));
            headActions.append(newAlbBtn, addSongBtn, editArtBtn);
        }
        head.append(hTitle, headActions);
        artistSection.appendChild(head);

        const sortedAlbums = Array.from(artistGroup.albums.values()).sort((a, b) => {
            if (a.titulo === 'Standalone Singles & Tracks') return 1;
            if (b.titulo === 'Standalone Singles & Tracks') return -1;
            return (b.anio || 0) - (a.anio || 0) || a.titulo.localeCompare(b.titulo);
        });

        const albumsGrid = document.createElement('div');
        albumsGrid.className = 'win-folders-grid';

        sortedAlbums.forEach(album => {
            const albumFolderKey = `${artistFolderKey}::${album.albumId || album.titulo}`;
            const isAlbumOpen = isFilteringActive || musicState.openAlbumFolders.has(albumFolderKey);
            const displayAlbTitle = album.titulo === 'Standalone Singles & Tracks'
                ? tUi('Standalone Singles & Tracks', 'Sencillos y Pistas Sueltas')
                : album.titulo;
            const firstThumb = album.songs.map(x => x.song).find(s => s.thumbnail_url)?.thumbnail_url || '';
            const relTypeLabel = RELEASE_TYPE_LABELS[album.tipo] || album.tipo || 'Album';

            const albTile = createWinFolderTile({
                title: album.anio ? `${displayAlbTitle} (${album.anio})` : displayAlbTitle,
                subtitle: `${relTypeLabel} · ${album.songs.length} pista(s)`,
                thumbUrl: firstThumb,
                isOpen: isAlbumOpen,
                onClick: () => {
                    if (musicState.openAlbumFolders.has(albumFolderKey)) {
                        musicState.openAlbumFolders.delete(albumFolderKey);
                    } else {
                        musicState.openAlbumFolders.add(albumFolderKey);
                    }
                    renderMusicCatalog();
                }
            });
            albumsGrid.appendChild(albTile);
        });
        artistSection.appendChild(albumsGrid);

        sortedAlbums.forEach(album => {
            const albumFolderKey = `${artistFolderKey}::${album.albumId || album.titulo}`;
            const isAlbumOpen = isFilteringActive || musicState.openAlbumFolders.has(albumFolderKey);
            if (!isAlbumOpen) return;

            const displayAlbTitle = album.titulo === 'Standalone Singles & Tracks'
                ? tUi('Standalone Singles & Tracks', 'Sencillos y Pistas Sueltas')
                : album.titulo;

            const albumBlock = document.createElement('div');
            albumBlock.className = 'win-folder-expanded-panel music-album-block is-open';

            const albHead = document.createElement('div');
            albHead.className = 'win-folder-expanded-head';
            const albTitleStrong = document.createElement('strong');
            protectUserNode(albTitleStrong);
            albTitleStrong.textContent = `💿 ${album.anio ? `${displayAlbTitle} (${album.anio})` : displayAlbTitle}`;

            const albActions = document.createElement('div');
            albActions.className = 'music-artist-head-actions';
            const addTrackBtn = document.createElement('button');
            addTrackBtn.type = 'button';
            addTrackBtn.className = 'btn-mini-add';
            addTrackBtn.textContent = '➕ Agregar Canción';
            addTrackBtn.addEventListener('click', () => prepararAgregarCancionAAlbum({
                mainArtist: artistGroup.id > 0 ? artistGroup.nombre : '',
                artistType: artistRecord?.tipo_artista || 'group',
                albumTitle: album.albumId ? album.titulo : '',
                albumType: album.albumId ? (album.tipo || 'mini_album') : 'single',
                albumYear: album.anio || ''
            }));
            albActions.appendChild(addTrackBtn);

            if (album.albumId) {
                const editAlbumBtn = document.createElement('button');
                editAlbumBtn.type = 'button';
                editAlbumBtn.className = 'btn-mini-edit';
                editAlbumBtn.textContent = '✏️ Editar Álbum';
                editAlbumBtn.addEventListener('click', () => openMusicEntityEditModal('album', {
                    id: album.albumId,
                    titulo: album.titulo,
                    tipo_lanzamiento: album.tipo || 'album',
                    anio: album.anio || ''
                }));
                albActions.appendChild(editAlbumBtn);
            }

            const closeAlbBtn = document.createElement('button');
            closeAlbBtn.type = 'button';
            closeAlbBtn.className = 'btn-secondary btn-small';
            closeAlbBtn.textContent = '▲ Cerrar Carpeta';
            closeAlbBtn.addEventListener('click', () => {
                musicState.openAlbumFolders.delete(albumFolderKey);
                renderMusicCatalog();
            });
            albActions.appendChild(closeAlbBtn);

            albHead.append(albTitleStrong, albActions);
            albumBlock.appendChild(albHead);

            const songList = document.createElement('div');
            songList.className = 'music-song-list';

            if (!album.songs.length) {
                const emptyP = document.createElement('p');
                emptyP.className = 'muted-text';
                emptyP.textContent = tUi('No songs in this folder yet.', 'Aún no hay canciones en esta carpeta.');
                songList.appendChild(emptyP);
            }

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
                if (Number(musicState.selectedSongId) === Number(song.id)) {
                    row.classList.add('selected');
                }
                row.addEventListener('click', (ev) => {
                    if (ev.target && ev.target.closest('button, a')) return;
                    seleccionarCancionParaEstudio(song);
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
                protectUserNode(titleSpan);
                titleSpan.textContent = `${prefix}${song.titulo}`;
                titleLine.appendChild(titleSpan);

                if (artistRole !== 'main') {
                    const collabRole = document.createElement('span');
                    collabRole.className = 'music-release-badge';
                    collabRole.textContent = artistRole === 'feat' ? tUi('Featured', 'Colaborador') : tUi('Collab', 'Colab.');
                    titleLine.appendChild(collabRole);
                }
                info.appendChild(titleLine);

                const badgeRow = document.createElement('div');
                badgeRow.className = 'music-badge-row';
                const stMeta = MUSIC_STATUS_META[song.estado_estudio] || MUSIC_STATUS_META.to_study;
                const statusBtn = document.createElement('button');
                statusBtn.type = 'button';
                statusBtn.className = `music-status-pill state-${song.estado_estudio}`;
                statusBtn.textContent = (window.DailyHubI18n && typeof window.DailyHubI18n.musicStatusLabel === 'function')
                    ? window.DailyHubI18n.musicStatusLabel(song.estado_estudio)
                    : stMeta.label;
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
                    wordBadge.textContent = tUi('Word Notes Queued', 'Notas Word Sincronizadas');
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
                    actions.appendChild(ytLink);
                }

                const studyBtn = document.createElement('button');
                studyBtn.type = 'button';
                studyBtn.className = 'btn-primary btn-small';
                studyBtn.textContent = tUi('Study -> Word', 'Estudiar -> Word');
                studyBtn.addEventListener('click', () => seleccionarCancionParaEstudio(song));

                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = 'btn-secondary btn-small';
                editBtn.textContent = tUi('Edit', 'Editar');
                editBtn.addEventListener('click', () => cargarCancionEnFormularioEdicion(song));

                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'btn-secondary btn-small';
                delBtn.textContent = tUi('Delete', 'Eliminar');
                delBtn.addEventListener('click', async () => {
                    const ok = await openConfirmDialog({
                        title: tUi('Remove Song?', '¿Quitar canción?'),
                        message: tUi(
                            `Remove "${song.titulo}" from your music catalog?`,
                            `¿Quitar "${song.titulo}" de tu catálogo musical?`
                        ),
                        confirmText: tUi('Remove Song', 'Quitar Canción'),
                        danger: true
                    });
                    if (!ok) return;
                    runWithButtonLock(delBtn, async () => {
                        const res = await fetch(`/api/english/music/songs/${song.id}`, { method: 'DELETE' });
                        if (res.ok) await cargarCatalogoMusical();
                    });
                });

                actions.append(studyBtn, editBtn, delBtn);
                row.append(main, actions);
                songList.appendChild(row);
            });

            albumBlock.appendChild(songList);
            artistSection.appendChild(albumBlock);
        });

        fragment.appendChild(artistSection);
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
    const btnNewAlbum = document.getElementById('btnMusicNewAlbum');
    const btnQuickNewAlbum = document.getElementById('btnMusicQuickNewAlbum');
    const btnStudyEditSelected = document.getElementById('btnMusicStudyEditSelected');
    const songForm = document.getElementById('musicSongForm');
    const wordForm = document.getElementById('musicWordNotesForm');

    initMusicAlbumCreateModal();

    if (btnNewAlbum) {
        btnNewAlbum.addEventListener('click', () => {
            openMusicAlbumCreateModal();
        });
    }

    if (btnQuickNewAlbum) {
        btnQuickNewAlbum.addEventListener('click', () => {
            openMusicAlbumCreateModal({
                artistName: (document.getElementById('musicMainArtist')?.value || '').trim(),
                artistType: document.getElementById('musicMainArtistType')?.value || 'group'
            });
        });
    }

    if (btnStudyEditSelected) {
        btnStudyEditSelected.addEventListener('click', () => {
            const selected = getCancionSeleccionada();
            if (selected) cargarCancionEnFormularioEdicion(selected);
        });
    }

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
            const qEl = document.getElementById('musicYtSearchQuery');
            const q = (qEl?.value || '').trim();
            const resultsBox = document.getElementById('musicYtSearchResults');
            if (!q) {
                showToast('err', 'Type a song or artist name first (e.g. BABYMONSTER DRIP).');
                qEl?.focus();
                return;
            }

            const directUrl = getYouTubeSearchUrl(q);
            window.open(directUrl, '_blank', 'noopener,noreferrer');

            if (!resultsBox) return;
            resultsBox.hidden = false;
            resultsBox.replaceChildren(createLoadingBanner('Buscando resultados en YouTube...', 'sm'));

            runWithButtonLock(btnSearchYt, async () => {
                const resp = await resilientFetchJson(`/api/english/music/search?q=${encodeURIComponent(q)}`, {}, { timeoutMs: 10000 });
                if (!resp.ok || !resp.data) {
                    const hint = document.createElement('div');
                    hint.className = 'music-yt-search-hint';
                    hint.textContent = `No se pudieron cargar vistas previas dentro de la app (${resp.errorMessage}). Se abrió la búsqueda externa; pega el enlace encontrado abajo y presiona "Auto-fill".`;
                    resultsBox.replaceChildren(hint);
                    resultsBox.hidden = false;
                    return;
                }

                const data = resp.data;
                const items = Array.isArray(data.results) ? data.results : [];
                if (!items.length) {
                    const hint = document.createElement('div');
                    hint.className = 'music-yt-search-hint';
                    hint.textContent = data.configured === false
                        ? 'YouTube Data API no configurada en servidor: usa la pestaña que se abrió arriba, copia el link de YouTube / YT Music, pégalo en el formulario y presiona "Auto-fill".'
                        : (data.apiUnavailable
                            ? 'La API de YouTube no respondió en este momento. Copia el enlace desde la pestaña externa y presiona "Auto-fill".'
                            : `No direct preview results for "${q}". Copy the track link from the opened YouTube tab and click "Auto-fill".`);
                    resultsBox.replaceChildren(hint);
                    resultsBox.hidden = false;
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

                    if (data.videoId && typeof data.embeddable === 'boolean') {
                        musicState.embeddableByVideoId[data.videoId] = data.embeddable;
                    }

                    const titleEl = document.getElementById('musicSongTitle');
                    const artistEl = document.getElementById('musicMainArtist');
                    const collabsEl = document.getElementById('musicCollaborators');
                    const albumEl = document.getElementById('musicAlbumTitle');
                    const albumTypeEl = document.getElementById('musicAlbumType');
                    const albumYearEl = document.getElementById('musicAlbumYear');

                    const currentTitle = (titleEl?.value || '').trim();
                    const looksRawYtTitle = !currentTitle || /[\[(]?(?:M\/V|Official\s+(?:Music\s+)?Video|Official\s+Audio|Lyric\s+Video)[\])]?|\s-\s*['"]/i.test(currentTitle);
                    if (titleEl && looksRawYtTitle && data.suggestedTitle) {
                        titleEl.value = data.suggestedTitle;
                    }

                    const currentArtist = (artistEl?.value || '').trim();
                    if (artistEl && (!currentArtist || /\s*-\s*Topic$/i.test(currentArtist)) && data.suggestedArtist) {
                        artistEl.value = data.suggestedArtist;
                    }

                    if (collabsEl && !collabsEl.value.trim() && data.suggestedCollaborators) {
                        collabsEl.value = data.suggestedCollaborators;
                    }

                    let albumWasAutoFilled = false;
                    if (albumEl && !albumEl.value.trim() && data.suggestedAlbumTitle) {
                        albumEl.value = data.suggestedAlbumTitle;
                        albumWasAutoFilled = true;
                    }

                    if (albumTypeEl && data.suggestedAlbumType && (albumWasAutoFilled || albumTypeEl.value === 'album')) {
                        albumTypeEl.value = data.suggestedAlbumType;
                    }

                    if (albumYearEl && !albumYearEl.value.trim() && data.suggestedAlbumYear) {
                        albumYearEl.value = String(data.suggestedAlbumYear);
                    }

                    const summaryParts = [];
                    if (data.suggestedTitle) summaryParts.push(`Track: "${data.suggestedTitle}"`);
                    if (data.suggestedArtist) summaryParts.push(`Artist: ${data.suggestedArtist}`);
                    if (data.suggestedAlbumTitle) {
                        summaryParts.push(`Album: ${data.suggestedAlbumTitle}${data.suggestedAlbumYear ? ` (${data.suggestedAlbumYear})` : ''}`);
                    }
                    const embedWarning = data.embeddable === false
                        ? ' · ⚠️ Owner blocks iframe embed (use Ventana flotante in Study Player).'
                        : '';
                    const msg = summaryParts.length
                        ? `Auto-fill detected -> ${summaryParts.join(' · ')}${embedWarning}`
                        : `Link verified and cleaned (single-track, playlist-safe).${embedWarning}`;
                    mostrarBannerMusica('musicSongFormBanner', 'ok', msg);
                    actualizarBarraCancionEstudio();
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
            if (musicState.embedOpen) {
                musicState.embedMode = getDefaultEmbedModeForSong(getCancionSeleccionada());
            }
            actualizarBarraCancionEstudio();
        });
    }

    const btnMusicExtractLyrics = document.getElementById('btnMusicExtractLyrics');
    const btnMusicSaveLyrics = document.getElementById('btnMusicSaveLyrics');
    const btnMusicCopyLyricsToStudy = document.getElementById('btnMusicCopyLyricsToStudy');
    const btnMusicTranslateLyricsSel = document.getElementById('btnMusicTranslateLyricsSel');
    const btnMusicTranslateFullLyricsEs = document.getElementById('btnMusicTranslateFullLyricsEs');
    const songLyricsViewerEl = document.getElementById('musicSongLyricsViewer');

    function extractExistingSpanishLyricsSection(rawLyrics) {
        const clean = String(rawLyrics || '').replace(/\r\n/g, '\n');
        const ytMatch = clean.match(/(?:^|\n)\[ES\]\s*\n([\s\S]*?)(?=\n(?:\[[A-Z]{2,}(?:\s*[—-][^\]]*)?\]|===\s*\[)|$)/i);
        if (ytMatch && ytMatch[1] && ytMatch[1].trim().length >= 8) {
            return { kind: 'youtube-es', text: ytMatch[1].trim() };
        }
        const aiMatch = clean.match(/(?:^|\n)===\s*\[ES\s*[—-]\s*Traducción[^\]]*\]\s*===\s*\n([\s\S]*?)(?=\n===\s*\[|$)/i);
        if (aiMatch && aiMatch[1] && aiMatch[1].trim().length >= 8) {
            return { kind: 'ai-es', text: aiMatch[1].trim() };
        }
        return null;
    }

    function mergeSpanishLyricsSection(rawLyrics, spanishText, headerLabel = '=== [ES — Traducción IA] ===') {
        const base = String(rawLyrics || '')
            .replace(/\r\n/g, '\n')
            .replace(/(?:^|\n)===\s*\[ES\s*[—-]\s*Traducción[^\]]*\]\s*===\s*\n[\s\S]*?(?=\n===\s*\[|$)/gi, '\n')
            .trim();
        const esClean = String(spanishText || '').trim();
        if (!esClean) return base;
        return base ? `${base}\n\n${headerLabel}\n${esClean}` : `${headerLabel}\n${esClean}`;
    }

    async function guardarLetraYNotasEnWordPc(song, { lyricsStudy, extraNotes = '', scopeKey = 'english:music-lyrics-save' } = {}) {
        const llaveTexto = await solicitarLlaveE2EEAsync();
        if (!llaveTexto) return false;

        const cleanLyrics = String(lyricsStudy || '').trim();
        const studyVocab = (document.getElementById('musicStudyVocab')?.value || '').trim();
        const studyPron = (document.getElementById('musicStudyPronunciation')?.value || '').trim();
        const studyNotesVal = String(extraNotes || document.getElementById('musicStudyExtraNotes')?.value || '').trim();

        const entry = {
            category: 'music',
            language: song.idioma || 'English',
            song_title: song.titulo,
            artists_display: formatSongArtistsSummary(song),
            album_title: song.album_titulo || '',
            album_type: RELEASE_TYPE_LABELS[song.album_tipo] || song.album_tipo || '',
            release_year: song.album_anio ? String(song.album_anio) : '',
            track_number: song.numero_pista || null,
            yt_music_url: song.yt_music_url || song.youtube_url || '',
            focus_summary: song.enfoque_corto || '',
            lyrics_study: cleanLyrics,
            ...(studyVocab ? { vocabulary_list: studyVocab } : {}),
            ...(studyPron ? { pronunciation_notes: studyPron } : {}),
            ...(studyNotesVal ? { notes: studyNotesVal } : {})
        };
        await submitMutationRequest({
            url: '/api/send-english',
            method: 'POST',
            scopeKey,
            signature: `lyrics:${song.id}:${cleanLyrics.length}:${studyNotesVal.length}`,
            buildBody: () => ({ texto: encriptarTextoE2EE(JSON.stringify(entry), llaveTexto) })
        });
        musicState.sessionLyricsBySongId[song.id] = { lyrics: cleanLyrics, source: 'Word PC (E2EE)' };
        song.word_sincronizado = 1;
        const nextStatus = song.estado_estudio === 'to_study' ? 'in_progress' : (song.estado_estudio || 'in_progress');
        await resilientFetchJson(`/api/english/music/songs/${song.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estadoEstudio: nextStatus, wordSynced: true })
        }, { timeoutMs: 8000 }).catch(() => { });
        actualizarPanelLetraCancion(song, { forceSyncText: true });
        return true;
    }

    if (btnMusicExtractLyrics) {
        btnMusicExtractLyrics.addEventListener('click', ev => {
            const song = getCancionSeleccionada();
            if (!song) {
                showToast('err', 'Selecciona primero una canción del catálogo ("Study -> Word").');
                return;
            }
            const alreadyLoaded = Boolean((songLyricsViewerEl?.value || '').trim());
            const forceExtract = Boolean(ev.shiftKey || alreadyLoaded);
            runWithButtonLock(btnMusicExtractLyrics, async () => {
                await solicitarOExtraerLetraViaPc(song, { silent: false, forceExtract });
            }, { loadingText: 'Consultando PC...' });
        });
    }

    if (btnMusicSaveLyrics) {
        btnMusicSaveLyrics.addEventListener('click', () => {
            const song = getCancionSeleccionada();
            if (!song || !songLyricsViewerEl) {
                showToast('err', 'Selecciona primero una canción del catálogo.');
                return;
            }
            const nextLyrics = songLyricsViewerEl.value.trim();
            if (!nextLyrics) {
                delete musicState.sessionLyricsBySongId[song.id];
                actualizarPanelLetraCancion(song, { forceSyncText: true });
                showToast('info', 'Visor en sesión limpiado (0 KB en BD; Word intacto).');
                return;
            }
            runWithButtonLock(btnMusicSaveLyrics, async () => {
                try {
                    const saved = await guardarLetraYNotasEnWordPc(song, {
                        lyricsStudy: nextLyrics,
                        scopeKey: 'english:music-lyrics-save'
                    });
                    if (!saved) return;
                    showToast('ok', musicState.ytdlpStatus?.pcOnline
                        ? 'Letra cifrada E2EE y enviada al instante a tu Word PC!'
                        : 'Letra cifrada E2EE en RAM EC2; se guardará en Word en cuanto conectes tu PC.');
                } catch (err) {
                    showToast('err', err.message || 'No se pudo cifrar/enviar la letra al túnel RAM.');
                }
            }, { loadingText: 'Cifrando E2EE...' });
        });
    }

    if (songLyricsViewerEl) {
        let lyricsAutoSaveTimer = null;
        songLyricsViewerEl.addEventListener('input', () => {
            clearTimeout(lyricsAutoSaveTimer);
            const song = getCancionSeleccionada();
            const text = songLyricsViewerEl.value.trim();
            if (!song || !text || (musicState.ytdlpStatus && musicState.ytdlpStatus.pcOnline === false)) return;
            lyricsAutoSaveTimer = setTimeout(() => {
                if (obtenerLlaveE2EE()) {
                    guardarLetraYNotasEnWordPc(song, {
                        lyricsStudy: text,
                        scopeKey: 'english:music-lyrics-autosave'
                    }).catch(() => { });
                }
            }, 1800);
        });
    }

    const trackLangFilterEl = document.getElementById('musicLyricsTrackLangFilter');
    if (trackLangFilterEl && songLyricsViewerEl) {
        trackLangFilterEl.addEventListener('change', () => {
            renderReadonlyLyricsByLanguage(songLyricsViewerEl.value, trackLangFilterEl.value);
        });
    }

    if (btnMusicCopyLyricsToStudy) {
        btnMusicCopyLyricsToStudy.addEventListener('click', () => {
            const raw = (songLyricsViewerEl?.value || '').trim();
            if (!raw) {
                showToast('err', 'Primero extrae o pega la letra arriba.');
                songLyricsViewerEl?.focus();
                return;
            }
            const studyLyricsEl = document.getElementById('musicStudyLyrics');
            if (studyLyricsEl) {
                studyLyricsEl.value = raw.slice(0, 12000);
                studyLyricsEl.dispatchEvent(new Event('input', { bubbles: true }));
                studyLyricsEl.focus();
                studyLyricsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                showToast('ok', 'Letra copiada a Breakdown / IA. Ahora puedes explicar/romanizar o guardar a Word.');
            }
        });
    }

    if (btnMusicTranslateLyricsSel) {
        btnMusicTranslateLyricsSel.addEventListener('click', () => {
            let selectedText = '';
            if (songLyricsViewerEl && typeof songLyricsViewerEl.selectionStart === 'number' && songLyricsViewerEl.selectionEnd > songLyricsViewerEl.selectionStart) {
                selectedText = songLyricsViewerEl.value.slice(songLyricsViewerEl.selectionStart, songLyricsViewerEl.selectionEnd).trim();
            } else if (window.getSelection) {
                selectedText = String(window.getSelection().toString() || '').trim();
            }
            if (typeof openFloatingTranslator === 'function') {
                openFloatingTranslator({ text: selectedText, toggle: false });
            }
        });
    }

    if (btnMusicTranslateFullLyricsEs) {
        btnMusicTranslateFullLyricsEs.addEventListener('click', ev => {
            const song = getCancionSeleccionada();
            if (!song || !songLyricsViewerEl) {
                showToast('err', tUi('Select a song from the catalog first ("Study -> Word").', 'Selecciona primero una canción del catálogo ("Study -> Word").'));
                return;
            }
            runWithButtonLock(btnMusicTranslateFullLyricsEs, async () => {
                let rawLyrics = songLyricsViewerEl.value.trim();
                if (!rawLyrics && (song.yt_music_url || song.youtube_url)) {
                    await solicitarOExtraerLetraViaPc(song, { silent: false, forceExtract: false });
                    rawLyrics = songLyricsViewerEl.value.trim();
                }
                if (!rawLyrics) {
                    showToast('err', tUi('Load or extract the song lyrics first.', 'Primero extrae la letra de la canción.'));
                    return;
                }

                const hintEl = document.getElementById('musicLyricsStatusHint');
                const extraNotesEl = document.getElementById('musicStudyExtraNotes');
                const studyLyricsEl = document.getElementById('musicStudyLyrics');
                const existingEs = extractExistingSpanishLyricsSection(rawLyrics);
                const forceAiRefresh = Boolean(ev.shiftKey);

                let spanishText = '';
                let updatedLyrics = rawLyrics;
                let sourceTag = 'gemini';
                let usedGemini = false;

                if (existingEs && existingEs.kind === 'youtube-es' && !forceAiRefresh) {
                    spanishText = existingEs.text;
                    sourceTag = 'youtube-es';
                    updatedLyrics = mergeSpanishLyricsSection(rawLyrics, spanishText, '=== [ES — Traducción Subtítulos] ===');
                    songLyricsViewerEl.value = updatedLyrics;
                } else {
                    const trResp = await resilientFetchJson('/api/english/music/translate-lyrics', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-ui-lang': typeof i18nGetLang === 'function' ? i18nGetLang() : 'es'
                        },
                        body: JSON.stringify({
                            lyrics: rawLyrics.slice(0, 12000),
                            songTitle: song.titulo || '',
                            artistName: formatSongArtistsSummary(song),
                            language: song.idioma || '',
                            mode: 'auto',
                            uiLang: typeof i18nGetLang === 'function' ? i18nGetLang() : 'es'
                        })
                    }, { timeoutMs: 36000 });

                    const payloadData = trResp?.data || trResp || {};
                    spanishText = String(payloadData.spanishLyrics || payloadData.translatedText || '').trim();
                    if (!spanishText) {
                        throw new Error(trResp?.errorMessage || tUi('Could not generate a Spanish translation for these lyrics.', 'No se pudo generar traducción al español para esta letra.'));
                    }
                    usedGemini = Boolean(payloadData.usedGemini);
                    sourceTag = usedGemini ? 'gemini' : 'offline';
                    const headerLabel = usedGemini ? '=== [ES — Traducción IA] ===' : '=== [ES — Traducción Local] ===';
                    updatedLyrics = mergeSpanishLyricsSection(rawLyrics, spanishText, headerLabel);
                    songLyricsViewerEl.value = updatedLyrics;
                }

                musicState.sessionLyricsBySongId[song.id] = {
                    lyrics: updatedLyrics,
                    source: `Word + ES (${sourceTag})`
                };
                const langFilterEl = document.getElementById('musicLyricsTrackLangFilter');
                if (langFilterEl) langFilterEl.value = 'all';
                renderReadonlyLyricsByLanguage(updatedLyrics, 'all');

                const noteBlock = `[Traducción ES — ${sourceTag === 'youtube-es' ? 'Subtítulos YouTube' : (usedGemini ? 'Gemini IA' : 'Modo Local')}]\n${spanishText}`;
                if (extraNotesEl) {
                    const prevNotes = extraNotesEl.value
                        .replace(/\[Traducción ES — [^\]]+\]\n[\s\S]*$/i, '')
                        .trim();
                    extraNotesEl.value = (prevNotes ? `${prevNotes}\n\n${noteBlock}` : noteBlock).slice(0, 3000);
                }
                if (studyLyricsEl) {
                    studyLyricsEl.value = updatedLyrics.slice(0, 12000);
                }

                const saved = await guardarLetraYNotasEnWordPc(song, {
                    lyricsStudy: updatedLyrics,
                    extraNotes: (extraNotesEl?.value || noteBlock).slice(0, 3000),
                    scopeKey: 'english:music-lyrics-translate-save'
                });

                if (hintEl) {
                    hintEl.textContent = saved
                        ? tUi(
                            `✅ Spanish translation (${sourceTag}) appended at the bottom & automatically saved to Word PC.`,
                            `✅ Traducción al español (${sourceTag}) mostrada al final de la letra y guardada automáticamente en tu Word PC.`
                        )
                        : tUi(
                            '⚠️ Translation shown at the bottom; unlock your E2EE key to sync it to PC Word.',
                            '⚠️ Traducción mostrada al final; desbloquea tu llave E2EE para guardarla en Word PC.'
                        );
                }
                showToast('ok', tUi('Spanish translation added at the end & saved to Word!', '¡Traducción al español mostrada al final y guardada en Word!'));
            }, { loadingText: tUi('Translating lyrics to Spanish...', 'Traduciendo letra a español...') });
        });
    }

    const btnImportLyricsFile = document.getElementById('btnMusicImportLyricsFile');
    const lyricsFileInput = document.getElementById('musicLyricsFileInput');
    const btnCleanTimestamps = document.getElementById('btnMusicCleanTimestamps');
    const btnToggleYtdlpHint = document.getElementById('btnMusicToggleYtdlpHint');
    const ytdlpHelperBox = document.getElementById('musicYtdlpHelperBox');
    const btnCopyYtdlpCmd = document.getElementById('btnMusicCopyYtdlpCmd');

    if (btnImportLyricsFile && lyricsFileInput) {
        btnImportLyricsFile.addEventListener('click', () => {
            lyricsFileInput.value = '';
            lyricsFileInput.click();
        });
        lyricsFileInput.addEventListener('change', async () => {
            const file = lyricsFileInput.files && lyricsFileInput.files[0];
            if (!file) return;
            try {
                const rawText = await file.text();
                const cleaned = cleanCaptionTextToLyricsClient(rawText);
                const lyricsEl = document.getElementById('musicStudyLyrics');
                if (!cleaned) {
                    showToast('err', 'The selected subtitle/lyrics file was empty after cleaning.');
                    return;
                }
                if (lyricsEl) {
                    lyricsEl.value = cleaned.slice(0, 12000);
                    lyricsEl.dispatchEvent(new Event('input', { bubbles: true }));
                    lyricsEl.focus();
                }
                showToast('ok', `Imported ${cleaned.split('\n').length} lyric lines cleanly (E2EE local only).`);
            } catch (err) {
                showToast('err', 'Could not read file: ' + err.message);
            }
        });
    }

    if (btnCleanTimestamps) {
        btnCleanTimestamps.addEventListener('click', () => {
            const lyricsEl = document.getElementById('musicStudyLyrics');
            const raw = lyricsEl ? lyricsEl.value : '';
            if (!raw.trim()) {
                showToast('err', 'Paste subtitles or lyrics first.');
                return;
            }
            const cleaned = cleanCaptionTextToLyricsClient(raw);
            if (lyricsEl && cleaned) {
                lyricsEl.value = cleaned.slice(0, 12000);
                lyricsEl.dispatchEvent(new Event('input', { bubbles: true }));
                showToast('ok', `Cleaned timestamps (${cleaned.split('\n').length} lines ready).`);
            }
        });
    }

    if (btnToggleYtdlpHint && ytdlpHelperBox) {
        btnToggleYtdlpHint.addEventListener('click', () => {
            ytdlpHelperBox.hidden = !ytdlpHelperBox.hidden;
            const ytdlpCmdEl = document.getElementById('musicYtdlpCommandCode');
            if (!ytdlpHelperBox.hidden && ytdlpCmdEl) {
                ytdlpCmdEl.textContent = getYtdlpCommandForSong(getCancionSeleccionada());
            }
        });
    }

    if (btnCopyYtdlpCmd) {
        btnCopyYtdlpCmd.addEventListener('click', async () => {
            const ytdlpCmdEl = document.getElementById('musicYtdlpCommandCode');
            const cmdText = (ytdlpCmdEl && ytdlpCmdEl.textContent) || '';
            if (!cmdText) return;
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(cmdText);
                } else {
                    const tmp = document.createElement('textarea');
                    tmp.value = cmdText;
                    tmp.setAttribute('readonly', '');
                    tmp.style.position = 'fixed';
                    tmp.style.opacity = '0';
                    document.body.appendChild(tmp);
                    tmp.select();
                    document.execCommand('copy');
                    document.body.removeChild(tmp);
                }
                showToast('ok', 'yt-dlp command copied! Run it in your PC PowerShell.');
            } catch (_err) {
                showToast('err', 'Copy failed — select the command text manually.');
            }
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
                    track_number: selected.numero_pista || null,
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

                    clearStudyNoteDrafts('music');
                    ['musicStudyLyrics', 'musicStudyVocab', 'musicStudyPronunciation', 'musicStudyExtraNotes'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.value = '';
                    });

                    if (selected) {
                        const nextStatus = selected.estado_estudio === 'to_study' ? 'in_progress' : selected.estado_estudio;
                        try {
                            await resilientFetchJson(`/api/english/music/songs/${selected.id}/status`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ estadoEstudio: nextStatus, wordSynced: true })
                            }, { timeoutMs: 12000 });
                            await cargarCatalogoMusical();
                        } catch (_) {
                            // E2EE note already queued safely; status refresh can recover on next catalog load
                        }
                    }

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
    filterCourse: '',
    items: []
};

function getActiveSemesterCourses() {
    const activeSem = typeof getActiveSemesterObj === 'function' ? getActiveSemesterObj() : null;
    return Array.isArray(activeSem?.courses) ? activeSem.courses : [];
}

function findPlannerCourseById(courseId) {
    const cleanId = String(courseId || '').trim();
    if (!cleanId || !academicPlannerState || !Array.isArray(academicPlannerState.semesters)) return null;
    const activeSem = typeof getActiveSemesterObj === 'function' ? getActiveSemesterObj() : null;
    const ordered = activeSem
        ? [activeSem, ...academicPlannerState.semesters.filter(s => s && s.id !== activeSem.id)]
        : academicPlannerState.semesters;
    for (const sem of ordered) {
        const hit = (Array.isArray(sem?.courses) ? sem.courses : []).find(c => String(c?.id || '').trim() === cleanId);
        if (hit) return hit;
    }
    return null;
}

function resolveAgendaItemClassLabel(item) {
    if (!item || (item.categoria || 'personal') !== 'universidad') return null;
    const course = item.materia_id ? findPlannerCourseById(item.materia_id) : null;
    if (course && course.name) {
        return {
            id: String(course.id || item.materia_id || ''),
            name: String(course.name).trim(),
            code: String(course.code || '').trim(),
            room: String(course.room || '').trim()
        };
    }
    const rawName = String(item.materia_nombre || '').trim();
    if (rawName) {
        return {
            id: String(item.materia_id || ''),
            name: rawName,
            code: '',
            room: ''
        };
    }
    return null;
}

let academicPlannerLoadPromise = null;
function ensureAcademicPlannerLoaded() {
    if (academicPlannerState && Array.isArray(academicPlannerState.semesters)) {
        return Promise.resolve(academicPlannerState);
    }
    if (!currentUser || currentUser.rol !== 'admin') {
        return Promise.resolve(null);
    }
    if (academicPlannerLoadPromise) {
        return academicPlannerLoadPromise;
    }
    academicPlannerLoadPromise = fetch('/api/planner', { cache: 'no-store' })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
            if (data && data.planner) {
                academicPlannerState = data.planner;
                if (data.campusDirectory) academicPlannerDirectory = data.campusDirectory;
                if (data.mindboxPreset) academicPlannerMindboxPreset = data.mindboxPreset;
                renderAgendaCourseFilterOptions();
                if (typeof renderAgendaBoard === 'function') renderAgendaBoard();
                if (agendaModal && !agendaModal.hidden && typeof syncAgendaMateriaFieldUI === 'function') {
                    const sel = document.getElementById('agendaMateriaId');
                    syncAgendaMateriaFieldUI(sel ? sel.value : '');
                }
            }
            return academicPlannerState;
        })
        .catch(() => null)
        .finally(() => {
            academicPlannerLoadPromise = null;
        });
    return academicPlannerLoadPromise;
}

function renderAgendaCourseFilterOptions() {
    const group = document.getElementById('agendaCourseFilterGroup');
    const sel = document.getElementById('agendaCourseFilter');
    if (!sel) return;

    const isPersonalFilter = agendaState.filterCategory === 'personal';
    if (group) group.hidden = isPersonalFilter;
    if (isPersonalFilter && agendaState.filterCourse) {
        agendaState.filterCourse = '';
    }

    const courses = getActiveSemesterCourses();
    const prevVal = agendaState.filterCourse || '';
    sel.replaceChildren();

    const optAll = document.createElement('option');
    optAll.value = '';
    optAll.textContent = tUi('🎓 All Classes', '🎓 Todas las clases');
    sel.appendChild(optAll);

    const optUnlinked = document.createElement('option');
    optUnlinked.value = '__unlinked__';
    optUnlinked.textContent = tUi('📌 General University (no class)', '📌 Universidad general (sin clase)');
    sel.appendChild(optUnlinked);

    const seenIds = new Set();
    courses.forEach(course => {
        const cid = String(course?.id || '').trim();
        const cname = String(course?.name || '').trim();
        if (!cid || !cname || seenIds.has(cid)) return;
        seenIds.add(cid);
        const opt = document.createElement('option');
        opt.value = cid;
        protectUserNode(opt);
        opt.textContent = `📚 ${course.code ? `${course.code} · ` : ''}${cname}`;
        sel.appendChild(opt);
    });

    if (prevVal && prevVal !== '__unlinked__' && !seenIds.has(prevVal)) {
        const archived = findPlannerCourseById(prevVal);
        if (archived) {
            const optArch = document.createElement('option');
            optArch.value = prevVal;
            protectUserNode(optArch);
            optArch.textContent = `📚 ${archived.name}`;
            sel.appendChild(optArch);
        } else {
            agendaState.filterCourse = '';
        }
    }
    sel.value = agendaState.filterCourse || '';
}

function matchesAgendaFilters(item) {
    const cat = item.categoria === 'universidad' ? 'universidad' : 'personal';
    const tipo = item.tipo === 'tarea' ? 'tarea' : 'evento';
    if (agendaState.filterCategory !== 'all' && cat !== agendaState.filterCategory) return false;
    if (agendaState.filterType !== 'all' && tipo !== agendaState.filterType) return false;
    if (agendaState.filterCourse && agendaState.filterCategory !== 'personal') {
        if (cat !== 'universidad') return false;
        const classMeta = resolveAgendaItemClassLabel(item);
        if (agendaState.filterCourse === '__unlinked__') {
            return !classMeta;
        }
        return Boolean(item.materia_id === agendaState.filterCourse || (classMeta && classMeta.id === agendaState.filterCourse));
    }
    return true;
}

function appendCategorizedAgendaItems(container, listItems) {
    const uniItems = listItems.filter(i => (i.categoria || 'personal') === 'universidad');
    const personalItems = listItems.filter(i => (i.categoria || 'personal') !== 'universidad');

    if (agendaState.filterCategory === 'all' && listItems.length > 0) {
        if (uniItems.length > 0) {
            const uniHead = document.createElement('div');
            uniHead.className = 'agenda-cat-divider is-uni';
            uniHead.textContent = tUi(`🎓 University (${uniItems.length})`, `🎓 Universidad (${uniItems.length})`);
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
        todo: tUi('To Do — click to mark In Progress', 'Por hacer — clic para marcar En progreso'),
        in_progress: tUi('In Progress — click to mark Done', 'En progreso — clic para marcar Completado'),
        done: tUi('Done — click to reset to To Do', 'Completado — clic para volver a Por hacer')
    };
    checkBtn.title = checkLabels[estado] || tUi('Toggle workflow status', 'Cambiar estado');
    checkBtn.setAttribute('aria-label', checkLabels[estado] || tUi('Toggle workflow status', 'Cambiar estado'));
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
    const classMeta = categoria === 'universidad' ? resolveAgendaItemClassLabel(item) : null;
    catPill.className = `agenda-cat-pill ${categoria === 'universidad' ? 'is-uni' : 'is-personal'}${classMeta ? ' is-class-linked' : ''}`;
    if (classMeta) {
        protectUserNode(catPill);
        catPill.textContent = `🎓 ${classMeta.name}`;
        catPill.title = `${tUi('Class', 'Clase')}: ${classMeta.code ? `${classMeta.code} · ` : ''}${classMeta.name}${classMeta.room ? ` (${classMeta.room})` : ''}`;
    } else {
        catPill.textContent = categoria === 'universidad' ? tUi('🎓 Uni', '🎓 Univ') : '👤 Personal';
    }

    const typePill = document.createElement('span');
    typePill.className = 'agenda-type-pill';
    typePill.textContent = tipo === 'tarea' ? tUi('Task', 'Tarea') : tUi('Event', 'Evento');

    metaRow.append(catPill, typePill);

    const parsedParts = splitAgendaActividadClient(item.actividad, item.titulo, item.descripcion);

    const text = document.createElement('span');
    text.className = 'agenda-item-text';
    protectUserNode(text);
    text.textContent = parsedParts.titulo || item.actividad;

    const descEl = parsedParts.descripcion ? document.createElement('span') : null;
    if (descEl) {
        descEl.className = 'agenda-item-desc';
        protectUserNode(descEl);
        descEl.textContent = parsedParts.descripcion;
    }

    const jiraRow = document.createElement('div');
    jiraRow.className = 'jira-status-row';

    const statusSelect = document.createElement('select');
    statusSelect.className = `jira-status-select status-${estado}`;
    statusSelect.setAttribute('aria-label', tUi('Workflow status (Jira)', 'Estado del flujo (Jira)'));
    [
        { value: 'todo', label: tUi('To Do', 'Por hacer') },
        { value: 'in_progress', label: tUi('In Progress', 'En progreso') },
        { value: 'done', label: tUi('Done', 'Completado') }
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
    editBtn.title = tUi('Edit activity', 'Editar actividad');
    editBtn.setAttribute('aria-label', tUi('Edit activity', 'Editar actividad'));
    editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    editBtn.addEventListener('click', () => abrirAgendaModal(item));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'agenda-mini-btn';
    delBtn.title = tUi('Delete activity', 'Eliminar actividad');
    delBtn.setAttribute('aria-label', tUi('Delete activity', 'Eliminar actividad'));
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
    renderAgendaCourseFilterOptions();

    const diasVisibles = getVisibleAgendaDays();
    const hoyStr = formatLocalDate(new Date());

    if (!diasVisibles.some(d => d.fecha === agendaState.selectedDate)) {
        const todayInWeek = diasVisibles.find(d => d.fecha === hoyStr);
        agendaState.selectedDate = todayInWeek ? todayInWeek.fecha : diasVisibles[0].fecha;
    }

    const firstDate = diasVisibles[0].dateObj;
    const lastDate = diasVisibles[diasVisibles.length - 1].dateObj;
    if (weekLabel) {
        const f1 = firstDate.toLocaleDateString(tLocale(), { day: 'numeric', month: 'short' });
        const f2 = lastDate.toLocaleDateString(tLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
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
            ? tUi(
                `${doneCount} Done · ${inProgCount} In Progress · ${todoCount} To Do (${uniCount} University · ${perCount} Personal)`,
                `${doneCount} Completadas · ${inProgCount} En progreso · ${todoCount} Por hacer (${uniCount} Universidad · ${perCount} Personal)`
            )
            : tUi('Organize University & Personal events and Jira-style tasks', 'Organiza eventos de Universidad/Personal y tareas estilo Jira');
    }

    if (btnToggleWeekend) {
        btnToggleWeekend.textContent = agendaState.showWeekend
            ? tUi('Mon - Fri Only', 'Solo Lun - Vie')
            : tUi('Show Mon - Sun', 'Mostrar Lun - Dom');
        btnToggleWeekend.classList.toggle('active', !agendaState.showWeekend);
    }

    if (btnToggleLayout) {
        btnToggleLayout.textContent = agendaState.layoutMode === 'day'
            ? tUi('Grid View', 'Vista Rejilla')
            : tUi('Day View', 'Vista Día');
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
            const dayShortLoc = (window.DailyHubI18n && typeof window.DailyHubI18n.agendaDayName === 'function')
                ? window.DailyHubI18n.agendaDayName(dia.nombre, true)
                : dia.corto;
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = `agenda-day-tab day-${dia.key}${dia.fecha === agendaState.selectedDate ? ' active' : ''}`;
            tab.innerHTML = `
                <span class="tab-day">${dayShortLoc}${dia.fecha === hoyStr ? ' •' : ''}</span>
                <span class="tab-date">${dia.dateObj.toLocaleDateString(tLocale(), { month: 'short', day: 'numeric' })}</span>
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

            const bloqueLabelLoc = (window.DailyHubI18n && typeof window.DailyHubI18n.agendaBlockLabel === 'function')
                ? window.DailyHubI18n.agendaBlockLabel(bloque.id)
                : bloque.label;

            const card = document.createElement('div');
            card.className = `agenda-mobile-block-card day-${activeDay.key}`;

            const head = document.createElement('div');
            head.className = 'agenda-mobile-block-head';
            head.innerHTML = `
                <div class="agenda-mobile-block-head-left">
                    ${bloque.svg}
                    <span>${bloqueLabelLoc}</span>
                </div>
                <span>${blockItems.length}</span>
            `;

            const body = document.createElement('div');
            body.className = 'agenda-mobile-block-body';

            if (!blockItems.length) {
                const empty = document.createElement('p');
                empty.className = 'agenda-empty-block';
                empty.textContent = tUi('No activities matching active filters', 'Sin actividades con los filtros activos');
                body.appendChild(empty);
            } else {
                appendCategorizedAgendaItems(body, blockItems);
            }

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'agenda-cell-add';
            addBtn.textContent = `+ ${tUi('Add to', 'Agregar a')} ${bloqueLabelLoc.toLowerCase()}`;
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
    corner.textContent = tUi('Block / Day', 'Bloque / Día');
    weekBoard.appendChild(corner);

    diasVisibles.forEach(dia => {
        const header = document.createElement('div');
        header.className = `agenda-day-header day-${dia.key}${dia.fecha === hoyStr ? ' is-today' : ''}`;
        const dayNameLoc = (window.DailyHubI18n && typeof window.DailyHubI18n.agendaDayName === 'function')
            ? window.DailyHubI18n.agendaDayName(dia.nombre, false)
            : dia.nombre;
        const dateLabel = dia.dateObj.toLocaleDateString(tLocale(), { month: 'short', day: 'numeric' });
        header.innerHTML = `
                    <span class="agenda-day-name">${dayNameLoc}</span>
                    <span class="agenda-day-date">${dateLabel}${dia.fecha === hoyStr ? tUi(' · Today', ' · Hoy') : ''}</span>
                `;
        weekBoard.appendChild(header);
    });

    AGENDA_BLOQUES.forEach(bloque => {
        const bloqueLabelLoc = (window.DailyHubI18n && typeof window.DailyHubI18n.agendaBlockLabel === 'function')
            ? window.DailyHubI18n.agendaBlockLabel(bloque.id)
            : bloque.label;
        const blockHeader = document.createElement('div');
        blockHeader.className = 'agenda-block-header';
        blockHeader.innerHTML = `
                    ${bloque.svg}
                    <span class="agenda-block-title">${bloqueLabelLoc}</span>
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
            addBtn.textContent = tUi('+ Add', '+ Agregar');
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
    ensureAcademicPlannerLoaded();
    const monday = getMondayOfOffset(agendaState.weekOffset);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const begin = formatLocalDate(monday);
    const end = formatLocalDate(sunday);
    const reqToken = agendaLoadTracker.begin();
    const fetchOpts = reqToken.signal ? { signal: reqToken.signal } : {};

    const diasVisibles = getVisibleAgendaDays();
    const weekLabel = document.getElementById('agendaWeekLabel');
    if (weekLabel && diasVisibles.length > 0) {
        const f1 = diasVisibles[0].dateObj.toLocaleDateString(tLocale(), { day: 'numeric', month: 'short' });
        const f2 = diasVisibles[diasVisibles.length - 1].dateObj.toLocaleDateString(tLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
        weekLabel.textContent = `${f1} - ${f2}`;
    }

    const weekStats = document.getElementById('agendaWeekStats');
    if (weekStats) {
        weekStats.textContent = tUi('Loading activities...', 'Cargando actividades...');
    }

    const loadingBanner = document.getElementById('agendaLoadingBanner');
    if (loadingBanner) {
        loadingBanner.replaceChildren(createLoadingBanner(tUi('Loading agenda...', 'Cargando agenda...'), 'sm'));
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
                weekStats.textContent = tUi('Could not load agenda (check RegistrosAgenda table in DB).', 'No se pudo cargar la agenda (revisa la tabla RegistrosAgenda en la BD).');
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
            const movedLabel = (window.DailyHubI18n && typeof window.DailyHubI18n.agendaStatusLabel === 'function')
                ? window.DailyHubI18n.agendaStatusLabel(nextEstado)
                : (nextEstado === 'done' ? 'Done' : (nextEstado === 'in_progress' ? 'In Progress' : 'To Do'));
            showToast('ok', tUi(`Activity moved to ${movedLabel}.`, `Actividad movida a ${movedLabel}.`));
        } catch (err) {
            if (ui.statusSelect) ui.statusSelect.value = prevEstado;
            showToast('err', `${tUi('Failed to update activity status', 'Error al actualizar el estado de la actividad')}: ${tServer(err.message)}`);
        }
    }, { extraDisable: [ui.row, ui.checkBtn, ui.statusSelect, ui.editBtn, ui.delBtn] });
}

async function eliminarAgendaItem(id, ui = {}) {
    const ok = await openConfirmDialog({
        title: tUi('Delete Activity?', '¿Eliminar actividad?'),
        message: tUi('Remove this activity permanently from your Weekly Agenda?', '¿Quitar esta actividad permanentemente de tu Agenda Semanal?'),
        confirmText: tUi('Delete', 'Eliminar'),
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
            showToast('ok', tUi('Activity removed from Weekly Agenda.', 'Actividad eliminada de tu Agenda Semanal.'));
        } catch (err) {
            showToast('err', `${tUi('Failed to delete activity', 'Error al eliminar la actividad')}: ${tServer(err.message)}`);
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
        const blockLabels = {
            manana: tUi('☕ Morning', '☕ Mañana'),
            cole: tUi('🎓 School / University', '🎓 Escuela / Universidad'),
            tarde: tUi('☀️ Afternoon', '☀️ Tarde'),
            noche: tUi('🌙 Night', '🌙 Noche')
        };
        hintEl.textContent = tUi(
            `Auto-selected ${blockLabels[autoBlock] || autoBlock} from ${horaEl.value.slice(0, 5)}`,
            `Auto-seleccionado ${blockLabels[autoBlock] || autoBlock} por hora ${horaEl.value.slice(0, 5)}`
        );
    }
}

function syncAgendaMateriaFieldUI(preferredCourseId = null, preferredCourseName = '') {
    const groupEl = document.getElementById('agendaMateriaGroup');
    const selectEl = document.getElementById('agendaMateriaId');
    const hintEl = document.getElementById('agendaMateriaHint');
    const catEl = document.getElementById('agendaCategoria');
    const tipoEl = document.getElementById('agendaTipo');
    if (!groupEl || !selectEl) return;

    const isUniversity = (catEl ? catEl.value : 'personal') === 'universidad';
    if (!isUniversity) {
        groupEl.hidden = true;
        selectEl.value = '';
        return;
    }

    groupEl.hidden = false;
    const targetId = preferredCourseId !== null && preferredCourseId !== undefined
        ? String(preferredCourseId).trim()
        : String(selectEl.value || '').trim();
    const courses = getActiveSemesterCourses();

    selectEl.replaceChildren();
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = tUi('General University (no specific class)', 'Universidad general (sin clase específica)');
    selectEl.appendChild(defaultOpt);

    const seenIds = new Set();
    courses.forEach(course => {
        const cid = String(course?.id || '').trim();
        const cname = String(course?.name || '').trim();
        if (!cid || !cname || seenIds.has(cid)) return;
        seenIds.add(cid);
        const opt = document.createElement('option');
        opt.value = cid;
        protectUserNode(opt);
        opt.textContent = `${course.code ? `${course.code} · ` : ''}${cname}${course.room ? ` (${course.room})` : ''}`;
        selectEl.appendChild(opt);
    });

    if (targetId && !seenIds.has(targetId)) {
        const archived = findPlannerCourseById(targetId);
        const archName = archived?.name || String(preferredCourseName || '').trim() || targetId;
        const optArch = document.createElement('option');
        optArch.value = targetId;
        protectUserNode(optArch);
        optArch.textContent = `📚 ${archName}`;
        selectEl.appendChild(optArch);
    }

    selectEl.value = targetId || '';

    if (hintEl) {
        const isTask = (tipoEl ? tipoEl.value : 'evento') === 'tarea';
        if (courses.length === 0) {
            hintEl.textContent = tUi(
                'No classes in active semester yet — open Manage classes to add your schedule.',
                'Aún no hay materias en tu semestre activo — abre Gestionar clases para agregar tu horario.'
            );
        } else if (isTask) {
            hintEl.textContent = tUi(
                'Links this university task to a current class so the card badge shows the class name.',
                'Vincula esta tarea universitaria con una clase actual para que la etiqueta muestre el nombre de la clase.'
            );
        } else {
            hintEl.textContent = tUi(
                'Optional for university events (e.g. exam or lab) — hidden automatically for Personal items.',
                'Opcional para eventos universitarios (ej. examen o laboratorio) — se oculta en actividades Personales.'
            );
        }
    }
}

function abrirAgendaModal(prefill = {}) {
    if (!agendaModal || !agendaForm) return;
    ensureAcademicPlannerLoaded();
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
    const resolvedMateriaId = resolvedCategoria === 'universidad'
        ? (prefill.materia_id
            ? String(prefill.materia_id).trim()
            : (!isEdit && agendaState.filterCourse && agendaState.filterCourse !== '__unlinked__' ? agendaState.filterCourse : ''))
        : '';

    document.getElementById('agendaModalTitle').textContent = isEdit
        ? tUi('Edit Activity', 'Editar Actividad')
        : tUi('New Activity', 'Nueva Actividad');
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
    const subcatEl = document.getElementById('agendaSubcategoria');
    const repDiasEl = document.getElementById('agendaRepetirCadaDias');
    const repVecesEl = document.getElementById('agendaRepetirVeces');
    if (subcatEl) subcatEl.value = 'normal';
    if (repDiasEl) repDiasEl.value = '0';
    if (repVecesEl) repVecesEl.value = '1';
    syncAgendaMateriaFieldUI(resolvedMateriaId, prefill.materia_nombre || '');

    const currentMateriaVal = resolvedCategoria === 'universidad'
        ? (document.getElementById('agendaMateriaId')?.value || '')
        : '';

    agendaOriginalSnapshot = isEdit
        ? {
            fecha: resolvedFecha,
            bloque: resolvedBloque,
            hora: resolvedHora,
            actividad: resolvedActividad.replace(/\s+/g, ' '),
            tipo: resolvedTipo,
            categoria: resolvedCategoria,
            materia_id: currentMateriaVal,
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

    const agendaCourseFilterEl = document.getElementById('agendaCourseFilter');
    if (agendaCourseFilterEl) {
        agendaCourseFilterEl.addEventListener('change', () => {
            agendaState.filterCourse = agendaCourseFilterEl.value || '';
            renderAgendaBoard();
        });
    }

    const btnGoToPlannerClasses = document.getElementById('btnGoToPlannerClasses');
    if (btnGoToPlannerClasses) {
        btnGoToPlannerClasses.addEventListener('click', () => {
            cerrarAgendaModal();
            showView('horario', true);
        });
    }

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
    const agendaTipoInput = document.getElementById('agendaTipo');
    if (agendaHoraInput) {
        agendaHoraInput.addEventListener('change', syncAgendaBlockFromTimeUI);
        agendaHoraInput.addEventListener('input', syncAgendaBlockFromTimeUI);
    }
    if (agendaCatInput) {
        agendaCatInput.addEventListener('change', () => {
            syncAgendaBlockFromTimeUI();
            syncAgendaMateriaFieldUI();
        });
    }
    if (agendaTipoInput) {
        agendaTipoInput.addEventListener('change', () => syncAgendaMateriaFieldUI());
        const agendaSubcatInput = document.getElementById('agendaSubcategoria');
        if (agendaSubcatInput) {
            agendaSubcatInput.addEventListener('change', () => {
                const subVal = agendaSubcatInput.value;
                const catEl = document.getElementById('agendaCategoria');
                const tipoEl = document.getElementById('agendaTipo');
                const remEl = document.getElementById('agendaRecordatorioMin');
                if (subVal === 'leccion_idiomas') {
                    if (catEl) catEl.value = 'personal';
                    if (tipoEl) tipoEl.value = 'tarea';
                    if (remEl) remEl.value = '15';
                    syncAgendaMateriaFieldUI();
                } else if (subVal === 'tarea_larga') {
                    if (catEl) catEl.value = 'universidad';
                    if (tipoEl) tipoEl.value = 'tarea';
                    if (remEl) remEl.value = '1440';
                    syncAgendaMateriaFieldUI();
                }
            });
        }
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
        const materiaVal = catVal === 'universidad' ? (document.getElementById('agendaMateriaId')?.value || '') : '';
        const matchedCourse = materiaVal ? findPlannerCourseById(materiaVal) : null;
        const materiaNombreVal = matchedCourse?.name ? String(matchedCourse.name).trim() : '';
        const tituloRaw = document.getElementById('agendaActividad')?.value || '';
        const descRaw = document.getElementById('agendaDescripcion')?.value || '';
        const composedAct = composeAgendaActividadClient(tituloRaw, descRaw);
        const horaClean = String(document.getElementById('agendaHora').value || '').slice(0, 5);
        const bloqueVal = document.getElementById('agendaBloque').value || inferAgendaBlockClient(horaClean, catVal);
        const subcategoriaVal = document.getElementById('agendaSubcategoria')?.value || 'normal';
        const repetirCadaDiasVal = Number(document.getElementById('agendaRepetirCadaDias')?.value || 0);
        const repetirVecesVal = Number(document.getElementById('agendaRepetirVeces')?.value || 1);

        const payload = {
            fecha: document.getElementById('agendaFecha').value,
            bloque: bloqueVal,
            hora: horaClean,
            titulo: tituloRaw.replace(/\s+/g, ' ').trim(),
            descripcion: descRaw.replace(/\s+/g, ' ').trim(),
            actividad: composedAct,
            tipo: tipoVal,
            categoria: catVal,
            subcategoria: subcategoriaVal,
            repetir_cada_dias: repetirCadaDiasVal,
            repetir_veces: repetirVecesVal,
            materia_id: materiaVal || null,
            materia_nombre: materiaVal ? (materiaNombreVal || null) : null,
            estado: estadoVal,
            recordatorio_min: remVal
        };

        if (!payload.fecha || !payload.bloque || !payload.hora || !payload.actividad) {
            showToast('err', tUi('Please fill in all activity fields.', 'Por favor completa todos los campos de la actividad.'));
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
            (materiaVal || '') === (agendaOriginalSnapshot.materia_id || '') &&
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
            String(item.materia_id || '') === (materiaVal || '') &&
            String(item.actividad || '').trim().toLowerCase().replace(/\s+/g, ' ') === payload.actividad.toLowerCase()
        );
        if (duplicateExists) {
            showToast('err', tUi(
                'This exact activity is already scheduled for that date, category, block, and time.',
                'Esta misma actividad ya está programada para esa fecha, categoría, bloque y hora.'
            ));
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
                showToast('ok', editId
                    ? tUi('Activity updated!', '¡Actividad actualizada!')
                    : tUi('Activity added to your week!', '¡Actividad agregada a tu semana!'));
            } catch (err) {
                showToast('err', `${tUi('Error', 'Error')}: ${tServer(err.message)}`);
            }
        }, { loadingText: tUi('Saving...', 'Guardando...') });
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
    const fabEl = document.getElementById('btnFloatingTranslatorFab');
    if (fabEl) fabEl.hidden = true;
    closeFloatingTranslator();
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

    if (userNameEl) {
        protectUserNode(userNameEl);
        userNameEl.textContent = user.nombre;
    }
    if (userEmailEl) {
        protectUserNode(userEmailEl);
        userEmailEl.textContent = user.email;
    }
    if (roleLabelEl) {
        roleLabelEl.textContent = isPsiquiatra
            ? tUi('Psychiatrist Mode (Read-Only)', 'Modo Psiquiatra (Solo Lectura)')
            : tUi('Owner (Admin)', 'Propietario (Admin)');
    }

    document.querySelectorAll('.admin-only-nav').forEach(el => {
        el.hidden = isPsiquiatra;
    });
    if (readonlyBanner) {
        readonlyBanner.hidden = !isPsiquiatra;
    }

    actualizarCabecerasDeFecha();
    programarExpiracionDomingo(user.expira_en);
    if (typeof cargarVersionInfo === 'function') {
        cargarVersionInfo();
    }

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
            .catch(() => { });

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

    container.replaceChildren(createLoadingBanner(tUi('Loading psychiatrist accounts...', 'Cargando cuentas de psiquiatra...'), 'sm'));

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
                container.innerHTML = `<p class="muted-text">${tUi('You have not created a psychiatrist account yet.', 'Aún no has creado ninguna cuenta de psiquiatra.')}</p>`;
                return;
            }
            medicos.forEach(m => {
                const row = document.createElement('div');
                row.className = 'medico-item';

                const info = document.createElement('div');
                info.className = 'medico-item-info';
                const nameStrong = document.createElement('strong');
                protectUserNode(nameStrong);
                nameStrong.textContent = m.nombre;
                const emailSpan = document.createElement('span');
                protectUserNode(emailSpan);
                emailSpan.textContent = `${m.email} · ${tUi('Read-only (Sleep & Mood Summary)', 'Solo lectura (Resumen de Ánimo y Sueño)')}`;

                const estado = (m.estado || 'activo').toLowerCase();
                const statusBadge = document.createElement('span');
                statusBadge.className = `medico-status-badge ${estado === 'activo' ? 'is-active' : (estado === 'suspendido' ? 'is-suspended' : 'is-inactive')}`;
                statusBadge.textContent = estado === 'activo'
                    ? tUi('Active', 'Activa')
                    : (estado === 'suspendido' ? tUi('Suspended', 'Suspendida') : tUi('Inactive', 'Inactiva'));

                info.append(nameStrong, emailSpan, statusBadge);

                const actions = document.createElement('div');
                actions.className = 'medico-actions';

                const nextEstado = estado === 'activo' ? 'suspendido' : 'activo';
                const statusBtn = document.createElement('button');
                statusBtn.type = 'button';
                statusBtn.className = 'btn-status-medico';
                statusBtn.textContent = estado === 'activo' ? tUi('Suspend', 'Suspender') : tUi('Activate', 'Activar');
                statusBtn.addEventListener('click', async () => {
                    const verb = nextEstado === 'suspendido' ? tUi('Suspend', 'Suspender') : tUi('Reactivate', 'Reactivar');
                    const ok = await openConfirmDialog({
                        title: tUi(`${verb} Account?`, `¿${verb} cuenta?`),
                        message: tUi(
                            `${verb} read-only access for ${m.nombre} (${m.email})?`,
                            `¿${verb} el acceso de solo lectura para ${m.nombre} (${m.email})?`
                        ),
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
                            showToast('ok', tUi(`Account status updated for ${m.nombre}.`, `Estado de cuenta actualizado para ${m.nombre}.`));
                            cargarMedicos();
                        } catch (err) {
                            setInlineBanner('medicoStatusBanner', 'err', tServer(err.message));
                            showToast('err', tServer(err.message));
                        }
                    }, { loadingText: tUi('Updating...', 'Actualizando...'), extraDisable: [delBtn] });
                });

                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'btn-revoke-medico';
                delBtn.textContent = tUi('Revoke access', 'Revocar acceso');
                delBtn.addEventListener('click', async () => {
                    const ok = await openConfirmDialog({
                        title: tUi('Revoke Access?', '¿Revocar acceso?'),
                        message: tUi(
                            `Permanently revoke psychiatrist access for ${m.nombre} (${m.email})?`,
                            `¿Revocar permanentemente el acceso de psiquiatra para ${m.nombre} (${m.email})?`
                        ),
                        confirmText: tUi('Revoke Access', 'Revocar Acceso'),
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
                            showToast('ok', tUi(`Access revoked for ${m.nombre}.`, `Acceso revocado para ${m.nombre}.`));
                            cargarMedicos();
                        } catch (err) {
                            setInlineBanner('medicoStatusBanner', 'err', tServer(err.message));
                            showToast('err', tServer(err.message));
                        }
                    }, { loadingText: tUi('Revoking...', 'Revocando...'), extraDisable: [statusBtn] });
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
        btnGoRegister.addEventListener('click', () => showAuthForm('authRegisterForm', tUi('First-time registration and verification', 'Registro y verificación inicial')));
    }
    if (btnGoForgot) {
        btnGoForgot.addEventListener('click', () => showAuthForm('authForgotForm', tUi('We will email you a password reset link', 'Te enviaremos un enlace de restablecimiento a tu correo')));
    }
    if (btnBackFromRegister) {
        btnBackFromRegister.addEventListener('click', () => showAuthForm('authLoginForm', tUi('Sign in to continue', 'Inicia sesión para continuar')));
    }
    if (btnBackFromForgot) {
        btnBackFromForgot.addEventListener('click', () => showAuthForm('authLoginForm', tUi('Sign in to continue', 'Inicia sesión para continuar')));
    }
    if (btnBackFromReset) {
        btnBackFromReset.addEventListener('click', () => {
            history.replaceState(null, '', window.location.pathname);
            showAuthForm('authLoginForm', tUi('Sign in to continue', 'Inicia sesión para continuar'));
        });
    }
    if (btnBackFromMfa) {
        btnBackFromMfa.addEventListener('click', () => {
            pendingMfaState = { token: '', email: '' };
            const mfaForm = document.getElementById('authMfaForm');
            if (mfaForm) mfaForm.reset();
            showAuthForm('authLoginForm', tUi('Sign in to continue', 'Inicia sesión para continuar'));
        });
    }

    if (btnSendRegCode) {
        btnSendRegCode.addEventListener('click', () => {
            if (busyActionElements.has(btnSendRegCode) || btnSendRegCode.disabled) return;
            const email = document.getElementById('regEmail').value.trim();
            if (!validateEmailClient(email)) {
                setInlineBanner('authStatusBanner', 'err', tUi('Please enter a valid email address above first.', 'Por favor ingresa un correo válido arriba primero.'));
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
                    setInlineBanner('authStatusBanner', 'ok', tServer(data.message));
                } catch (err) {
                    setInlineBanner('authStatusBanner', 'err', tServer(err.message));
                }
            }, { loadingText: tUi('Sending code...', 'Enviando código...') });
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
                    clearStudyNoteDrafts('all');
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
// PERMANENT DARK THEME
// ==========================================
function applyTheme() {
    document.documentElement.setAttribute('data-theme', 'dark');
    try {
        document.documentElement.style.colorScheme = 'dark';
        localStorage.removeItem('mt_theme');
    } catch (_) { }
}

function initTheme() {
    applyTheme();
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
        mood: tUi('Log Mood', 'Registrar Ánimo'),
        sleep: tUi('Log Sleep', 'Registrar Sueño'),
        sueno: tUi('Log Sleep', 'Registrar Sueño'),
        agenda: tUi('Open Agenda', 'Abrir Agenda'),
        horario: tUi('Open Schedule', 'Abrir Horario'),
        journal: tUi('Open Journal', 'Abrir Diario'),
        english: tUi('Open English', 'Abrir Idiomas')
    };

    activeList.forEach(reminder => {
        const card = document.createElement('div');
        card.className = `reminder-card type-${reminder.type || 'general'}`;

        const info = document.createElement('div');
        info.className = 'reminder-card-info';
        if (reminder.targetView) {
            info.style.cursor = 'pointer';
            info.title = tUi('Click to open and pre-select the date & time block to register', 'Clic para abrir y preseleccionar la fecha y bloque');
            info.addEventListener('click', () => openReminderTarget(reminder));
        }

        const titleEl = document.createElement('div');
        titleEl.className = 'reminder-card-title';
        titleEl.textContent = tServer(reminder.title || tUi('Reminder', 'Recordatorio'));

        const msgEl = document.createElement('div');
        msgEl.className = 'reminder-card-msg';
        msgEl.textContent = tServer(reminder.message || '');

        info.append(titleEl, msgEl);

        const actions = document.createElement('div');
        actions.className = 'reminder-card-actions';

        if (reminder.targetView) {
            const goBtn = document.createElement('button');
            goBtn.type = 'button';
            goBtn.className = 'reminder-btn primary';
            goBtn.textContent = viewLabels[reminder.targetView] || tUi('Open', 'Abrir');
            goBtn.addEventListener('click', () => openReminderTarget(reminder));
            actions.appendChild(goBtn);
        }

        if (reminder.canComplete && reminder.refId) {
            const doneBtn = document.createElement('button');
            doneBtn.type = 'button';
            doneBtn.className = 'reminder-btn done';
            doneBtn.textContent = tUi('✓ Mark Done', '✓ Marcar hecha');
            doneBtn.addEventListener('click', () => completeReminderAgendaItem(reminder, doneBtn));
            actions.appendChild(doneBtn);
        }

        if (reminder.canSnooze) {
            [15, 30, 60].forEach(mins => {
                const snzBtn = document.createElement('button');
                snzBtn.type = 'button';
                snzBtn.className = 'reminder-btn';
                snzBtn.textContent = mins === 60 ? tUi('Snooze 1h', 'Posponer 1h') : tUi(`Snooze ${mins}m`, `Posponer ${mins}m`);
                snzBtn.title = tUi(`Postpone this reminder for ${mins} minutes`, `Posponer este recordatorio ${mins} minutos`);
                snzBtn.addEventListener('click', () => snoozeOrDismissReminder(reminder, 'snooze', mins, snzBtn));
                actions.appendChild(snzBtn);
            });
        }

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'reminder-btn';
        dismissBtn.textContent = tUi('Dismiss', 'Ocultar');
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
                : tUi('later', 'más tarde');
            return `${s.title} (${tUi('until', 'hasta')} ${until})`;
        }).join(' · ');
        snoozeSummary.textContent = `⏱️ ${tUi('Postponed', 'Pospuestos')} (${snoozedList.length}): ${itemsText}`;
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
            showToast('err', `${tUi('Error updating reminder', 'Error al actualizar recordatorio')}: ${tServer(err.message)}`);
        }
    }, { loadingText: action === 'dismiss' ? tUi('Dismissing...', 'Ocultando...') : tUi('Postponing...', 'Posponiendo...') });
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
            showToast('ok', tUi('Task marked as Done.', 'Tarea marcada como Completada.'));
        } catch (err) {
            showToast('err', `${tUi('Error marking task as Done', 'Error al marcar tarea como Completada')}: ${tServer(err.message)}`);
        }
    }, { loadingText: tUi('Completing...', 'Completando...') });
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
    if (settings.academicPlanner && !academicPlannerState) {
        academicPlannerState = settings.academicPlanner;
        if (typeof renderAgendaCourseFilterOptions === 'function') {
            renderAgendaCourseFilterOptions();
        }
    }

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
            ? tUi('Configured on this browser (32-character AES key active).', 'Configurada en este navegador (llave AES de 32 caracteres activa).')
            : tUi('Not set on this browser yet (will be requested when writing Journal or English notes).', 'Aún no configurada en este navegador (se solicitará al guardar Diario o notas de Idiomas).');
    }

    ['journalE2eePill', 'englishE2eePill'].forEach(pillId => {
        const pill = document.getElementById(pillId);
        if (!pill) return;
        pill.classList.toggle('is-ready', isReady);
        pill.classList.toggle('is-missing', !isReady);
        pill.textContent = isReady
            ? tUi('🔐 E2EE Key Ready', '🔐 Llave E2EE Lista')
            : tUi('🔑 Set 32-char Key', '🔑 Definir Llave 32 chars');
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
    banner.textContent = tServer(message);
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
    setCheck('setDriveStudySyncEnabled', settings.studyDriveSyncEnabled !== false);
    setVal('setDriveStudyDir', settings.studyDriveFolder || 'NotasIdiomas');

    // Multilingual & Gemini AI preferences
    const prefLang = ['en', 'ko', 'en_ko'].includes(settings.preferredStudyLanguage)
        ? settings.preferredStudyLanguage
        : 'en_ko';
    setVal('setPreferredStudyLang', prefLang);
    const activeModel = String(settings.geminiModel || 'gemini-2.5-flash');
    const modelSel = document.getElementById('setGeminiModel');
    const customGroup = document.getElementById('setGeminiCustomModelGroup');
    const customInput = document.getElementById('setGeminiCustomModel');
    if (modelSel) {
        const hasPreset = Array.from(modelSel.options).some(opt => opt.value === activeModel && opt.value !== '__custom__');
        if (hasPreset) {
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
        agendaShowWeekend: Boolean(document.getElementById('setShowWeekend')?.checked),
        studyDriveSyncEnabled: Boolean(document.getElementById('setDriveStudySyncEnabled')?.checked),
        studyDriveFolder: String(document.getElementById('setDriveStudyDir')?.value || 'NotasIdiomas').trim()
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
                }).catch(() => { });
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
                setSettingsBanner('ok', tUi('E2EE secret key updated on this browser.', 'Llave secreta E2EE actualizada en este navegador.'));
            }
        });
    }

    if (btnClearE2ee) {
        btnClearE2ee.addEventListener('click', async () => {
            const ok = await openConfirmDialog({
                title: tUi('Clear Local E2EE Key?', '¿Borrar llave E2EE local?'),
                message: tUi(
                    'Remove the 32-character E2EE key from this browser? You can re-enter it later when writing encrypted notes.',
                    '¿Quitar la llave E2EE de 32 caracteres de este navegador? Podrás volver a ingresarla cuando escribas notas cifradas.'
                ),
                confirmText: tUi('Clear Key', 'Borrar Llave'),
                danger: true
            });
            if (!ok) return;
            localStorage.removeItem('diario_llave_secreta');
            updateE2eeKeyStatusUI();
            setSettingsBanner('ok', tUi('Local E2EE key cleared from this browser.', 'Llave E2EE local eliminada de este navegador.'));
            showToast('info', tUi('Local E2EE key removed from this browser.', 'Llave E2EE local removida de este navegador.'));
        });
    }

    const geminiModelSelect = document.getElementById('setGeminiModel');
    const geminiCustomGroup = document.getElementById('setGeminiCustomModelGroup');
    if (geminiModelSelect && geminiCustomGroup) {
        geminiModelSelect.addEventListener('change', () => {
            geminiCustomGroup.hidden = geminiModelSelect.value !== '__custom__';
        });
    }

    const geminiKeyInput = document.getElementById('setGeminiApiKey');
    if (geminiKeyInput) {
        geminiKeyInput.addEventListener('input', () => {
            const keyStatus = document.getElementById('settingsGeminiKeyStatus');
            if (geminiKeyInput.value.trim()) {
                delete geminiKeyInput.dataset.pendingClear;
                if (keyStatus) {
                    keyStatus.textContent = 'New Gemini key entered — click "🧪 Test AI Connection" or "Save All Settings" to save it.';
                }
            }
        });
    }

    const btnClearGemini = document.getElementById('btnClearGeminiKey');
    if (btnClearGemini) {
        btnClearGemini.addEventListener('click', () => {
            const keyInput = document.getElementById('setGeminiApiKey');
            const keyStatus = document.getElementById('settingsGeminiKeyStatus');
            const testResultBox = document.getElementById('settingsGeminiTestResult');
            if (keyInput) {
                keyInput.value = '';
                keyInput.dataset.pendingClear = '1';
            }
            if (keyStatus) {
                keyStatus.textContent = 'Key marked for removal—click "Save All Settings" to confirm.';
            }
            if (testResultBox) {
                testResultBox.hidden = true;
                testResultBox.textContent = '';
            }
        });
    }

    const btnTestGemini = document.getElementById('btnTestGeminiConnection');
    if (btnTestGemini) {
        btnTestGemini.addEventListener('click', () => {
            const keyInput = document.getElementById('setGeminiApiKey');
            const keyStatus = document.getElementById('settingsGeminiKeyStatus');
            const modelSel = document.getElementById('setGeminiModel');
            const customModelInput = document.getElementById('setGeminiCustomModel');
            const customGroup = document.getElementById('setGeminiCustomModelGroup');
            const resultBox = document.getElementById('settingsGeminiTestResult');

            const rawKey = String(keyInput?.value || '').trim();
            if (rawKey && keyInput) {
                delete keyInput.dataset.pendingClear;
            }
            const selVal = modelSel?.value || 'gemini-2.5-flash';
            const requestedModel = selVal === '__custom__'
                ? (String(customModelInput?.value || '').trim() || 'gemini-2.5-flash')
                : selVal;

            runWithButtonLock(btnTestGemini, async () => {
                if (resultBox) {
                    resultBox.hidden = false;
                    resultBox.className = 'inline-status-banner info';
                    resultBox.textContent = 'Testing Google Gemini API connection & verifying live models...';
                }

                const resp = await resilientFetchJson('/api/language/test-gemini', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        apiKey: rawKey || undefined,
                        model: requestedModel
                    })
                }, { timeoutMs: 30000 });

                if (!resp.ok || !resp.data) {
                    if (resultBox) {
                        resultBox.hidden = false;
                        resultBox.className = 'inline-status-banner err';
                        resultBox.textContent = resp.errorMessage || 'Could not reach Gemini test endpoint.';
                    }
                    showToast('err', resp.errorMessage || 'Gemini test failed.');
                    return;
                }

                const diag = resp.data;
                const availList = Array.isArray(diag.availableModels) ? diag.availableModels : [];
                const availPreview = availList.length
                    ? ` Available text models: ${availList.slice(0, 8).join(', ')}.`
                    : '';

                if (diag.ok) {
                    const activeModel = diag.suggestedModel || diag.model || requestedModel;
                    const modelChanged = activeModel && activeModel !== requestedModel;
                    if (modelChanged && modelSel) {
                        const presetMatch = Array.from(modelSel.options).some(opt => opt.value === activeModel);
                        if (presetMatch) {
                            modelSel.value = activeModel;
                            if (customGroup) customGroup.hidden = true;
                        } else {
                            modelSel.value = '__custom__';
                            if (customModelInput) customModelInput.value = activeModel;
                            if (customGroup) customGroup.hidden = false;
                        }
                    }

                    if (rawKey && keyStatus) {
                        keyStatus.textContent = 'Key verified live — click "Save All Settings" below to store it encrypted.';
                    }

                    const saveReminder = rawKey
                        ? ' Click "Save All Settings" below to persist this key.'
                        : (modelChanged ? ' Click "Save All Settings" to save this recommended model.' : '');

                    if (resultBox) {
                        resultBox.hidden = false;
                        resultBox.className = 'inline-status-banner ok';
                        resultBox.textContent = `✅ ${diag.message || `Gemini connected (${activeModel}).`}${availPreview}${saveReminder}`;
                    }
                    showToast('ok', `Gemini OK (${activeModel})`);
                } else {
                    if (resultBox) {
                        resultBox.hidden = false;
                        resultBox.className = 'inline-status-banner err';
                        resultBox.textContent = `❌ ${diag.message || 'Gemini test failed.'}${availPreview}`;
                    }
                    showToast('err', diag.message || 'Gemini test failed.');
                }
            }, { loadingText: 'Testing Gemini...' });
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
            badgeEl.textContent = tUi('✓ Ready to check English spelling & grammar', '✓ Listo para revisar ortografía y gramática en inglés');
            if (fixAllBtn) fixAllBtn.hidden = true;
            return;
        }

        if (currentIssues.length === 0) {
            badgeEl.className = 'proofing-status-badge is-ok';
            badgeEl.textContent = tUi('✓ Spelling & Grammar look great (Word check passed)', '✓ Ortografía y gramática excelentes (revisión estilo Word aprobada)');
            if (fixAllBtn) fixAllBtn.hidden = true;
            return;
        }

        const spellCount = currentIssues.filter(i => i.type === 'spelling').length;
        const gramCount = currentIssues.filter(i => i.type === 'grammar').length;
        badgeEl.className = 'proofing-status-badge has-issues';
        badgeEl.textContent = tUi(
            `⚠ ${spellCount} Spelling · ${gramCount} Grammar suggestion${currentIssues.length === 1 ? '' : 's'} (tap to fix)`,
            `⚠ ${spellCount} Ortografía · ${gramCount} Gramática (${currentIssues.length} sugerencia${currentIssues.length === 1 ? '' : 's'} · toca para corregir)`
        );
        if (fixAllBtn) fixAllBtn.hidden = false;

        currentIssues.forEach(issue => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `proofing-issue-chip ${issue.type === 'spelling' ? 'is-spelling' : 'is-grammar'}`;
            chip.title = tUi(
                `${issue.reason} — Click to replace "${issue.original}" with "${issue.replacement}"`,
                `${issue.reason} — Clic para reemplazar "${issue.original}" por "${issue.replacement}"`
            );
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
            showToast('ok', tUi('Applied all English spelling & grammar suggestions.', 'Se aplicaron todas las sugerencias de ortografía y gramática en inglés.'));
        });
    }

    evaluateSuite();
}

function initWordStyleProofing() {
    bindProofingSuite({
        fields: [
            { id: 'journalTitle', get label() { return tUi('Title', 'Título'); } },
            { id: 'journalText', get label() { return tUi('Note', 'Nota'); } }
        ],
        badgeId: 'journalProofingBadge',
        fixAllBtnId: 'btnJournalFixAll',
        listId: 'journalProofingIssues'
    });

    bindProofingSuite({
        fields: [
            { id: 'palabra', get label() { return tUi('Word', 'Palabra'); } },
            { id: 'significado', get label() { return tUi('Meaning', 'Significado'); } },
            { id: 'ejemplo', get label() { return tUi('Example', 'Ejemplo'); } }
        ],
        badgeId: 'englishProofingBadge',
        fixAllBtnId: 'btnEnglishFixAll',
        listId: 'englishProofingIssues'
    });

    bindProofingSuite({
        fields: [
            { id: 'agendaActividad', get label() { return tUi('Title', 'Título'); } },
            { id: 'agendaDescripcion', get label() { return tUi('Desc', 'Desc'); } }
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
        mapLink.textContent = tUi('🗺️ Open Maps', '🗺️ Abrir Mapa');
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
    if (titleEl) titleEl.textContent = tUi('Add / Edit ITS Class', 'Agregar / Editar Materia ITS');
    const saveBtn = document.getElementById('btnSaveCourse');
    if (saveBtn) saveBtn.textContent = tUi('Save Class to Semester', 'Guardar Materia al Semestre');
    const cancelBtn = document.getElementById('btnCancelCourseEdit');
    if (cancelBtn) cancelBtn.hidden = true;
    const badge = document.getElementById('courseRoomCroquisBadge');
    if (badge) badge.textContent = tUi(
        'Type a room (R02, R11, N21, A10, S15) to detect ITS Campus & Croquis building.',
        'Escribe un salón (R02, R11, N21, A10, S15) para detectar Campus ITS y edificio del Croquis.'
    );
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
    if (titleEl) titleEl.textContent = tUi(`Edit Class: ${course.name || ''}`, `Editar Materia: ${course.name || ''}`);
    const saveBtn = document.getElementById('btnSaveCourse');
    if (saveBtn) saveBtn.textContent = tUi('Update Class', 'Actualizar Materia');
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
        const labelName = sem.name || sem.nombre || tUi('Semester', 'Semestre');
        const clsCount = (sem.courses || []).length;
        opt.textContent = `${labelName} (${clsCount} ${tUi(clsCount === 1 ? 'class' : 'classes', clsCount === 1 ? 'materia' : 'materias')})`;
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
    if (countBadge) countBadge.textContent = `${courses.length} ${tUi(courses.length === 1 ? 'class' : 'classes', courses.length === 1 ? 'materia' : 'materias')}`;
    if (!coursesList) return;

    coursesList.replaceChildren();
    const dayLabels = i18nGetLang() === 'es'
        ? { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' }
        : { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };

    if (courses.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'agenda-empty';
        empty.textContent = tUi(
            'No classes in this semester yet. Add one on the left or click "Load MindBox 9th Sem Preset".',
            'Aún no hay materias en este semestre. Agrega una a la izquierda o presiona "Cargar Plantilla MindBox 9°".'
        );
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
        const courseNameText = course.name || course.nombre || tUi('Course', 'Materia');
        const groupText = course.group || course.grupo || '';
        const roomText = course.room || course.aulaDefault || tUi('TBD', 'Por definir');
        const codeSpan = document.createElement('span');
        codeSpan.className = 'planner-room-pill';
        codeSpan.textContent = `${codeText} · ${roomText}`;
        h4.appendChild(codeSpan);
        h4.appendChild(document.createTextNode(` ${courseNameText}${groupText ? ` (${tUi('Grp', 'Gpo')} ${groupText})` : ''}`));

        const sub = document.createElement('p');
        sub.style.margin = '2px 0';
        const teacherText = course.teacher || course.docente || tUi('ITS Professor', 'Docente ITS');
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
        editBtn.textContent = tUi('Edit', 'Editar');
        editBtn.addEventListener('click', () => loadCourseIntoEditForm(course));

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-secondary btn-small btn-danger-outline';
        delBtn.textContent = tUi('Remove', 'Quitar');
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
            vacBanner.textContent = tUi(
                `🏖️ Vacation / Break Active Today: ${activeVac.name || activeVac.nombre} (${activeVac.startDate || activeVac.fechaInicio} → ${activeVac.endDate || activeVac.fechaFin}) — Class alerts paused.`,
                `🏖️ Vacaciones / Receso activo hoy: ${activeVac.name || activeVac.nombre} (${activeVac.startDate || activeVac.fechaInicio} → ${activeVac.endDate || activeVac.fechaFin}) — Alertas de clase pausadas.`
            );
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
        empty.textContent = tUi('No vacation periods registered.', 'No hay periodos vacacionales registrados.');
        listEl.appendChild(empty);
        return;
    }

    vacations.forEach((vac, idx) => {
        const item = document.createElement('div');
        item.className = 'planner-course-card';

        const meta = document.createElement('div');
        meta.className = 'planner-course-meta';
        const h4 = document.createElement('h4');
        h4.textContent = `🏖️ ${vac.name || vac.nombre || tUi('Break', 'Receso')}`;
        const p = document.createElement('p');
        p.style.margin = '0';
        p.textContent = `📅 ${vac.startDate || vac.fechaInicio} → ${vac.endDate || vac.fechaFin}`;
        meta.append(h4, p);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-secondary btn-small btn-danger-outline';
        delBtn.textContent = tUi('Remove', 'Quitar');
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
        barEl.textContent = `${tUi('Progress', 'Progreso')}: ${formatHoursMinutes(doneH, { compact: true })} / ${totalH} hrs (${pct}%)`;
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
            summaryEl.textContent = tUi(
                `✅ Home saved (${label || 'Mi Casa'}${addr ? ` · ${addr}` : ''}): ${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`,
                `✅ Casa guardada (${label || 'Mi Casa'}${addr ? ` · ${addr}` : ''}): ${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`
            );
        } else {
            summaryEl.textContent = tUi(
                'Enter your Saltillo street address or paste a Google Maps link, then click "Save & Find Home Location".',
                'Ingresa tu calle/colonia en Saltillo o pega un enlace de Google Maps y presiona "Guardar y Ubicar Casa".'
            );
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
            originTextEl.textContent = `${tUi('Origin', 'Origen')} (${preview.originSource || 'GPS'}): ${Number(preview.originCoords.lat).toFixed(5)}, ${Number(preview.originCoords.lng).toFixed(5)}`;
        } else {
            originTextEl.textContent = tUi(
                'Origin: Not set yet. Enter your Home street address on the left, click "Update My GPS", or pick a Saltillo preset.',
                'Origen: Sin configurar aún. Escribe la dirección de tu Casa a la izquierda, presiona "Actualizar Mi GPS" o elige un acceso rápido de Saltillo.'
            );
        }
    }

    if (originMetaEl) {
        if (hasValidOrigin && preview.originKind === 'current') {
            let timeStr = '';
            if (preview.originUpdatedAt) {
                const dt = new Date(preview.originUpdatedAt);
                if (!Number.isNaN(dt.getTime())) {
                    timeStr = ` · ${tUi('Updated', 'Actualizado')} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                }
            }
            originMetaEl.textContent = tUi(
                `📡 Active live origin (${preview.originTechnicalSource || 'gps'}${timeStr}). Click "🏠 Use Saved Home" above to reset origin back to Home.`,
                `📡 Origen en vivo activo (${preview.originTechnicalSource || 'gps'}${timeStr}). Presiona "🏠 Usar Casa Guardada" arriba para volver a tu Casa.`
            );
        } else if (hasValidOrigin && preview.originKind === 'home') {
            originMetaEl.textContent = tUi('🏠 Using your Saved Home location as origin.', '🏠 Usando tu Casa guardada como origen.');
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
            target: `🏢 Residencias (${academicPlannerState?.residencias?.companyName || tUi('Company', 'Empresa')})`,
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
            target: `💼 ${tUi('Work', 'Trabajo')} (${academicPlannerState?.work?.companyName || tUi('Workplace', 'Lugar de Trabajo')})`,
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
        p.textContent = tUi(
            'Set your current location or Home coordinates above to estimate driving time & traffic.',
            'Configura tu ubicación actual o las coordenadas de tu Casa arriba para estimar traslado y tráfico.'
        );
        container.appendChild(p);
        return;
    }

    rows.forEach(c => {
        const card = document.createElement('div');
        card.className = 'its-croquis-card';

        const meta = document.createElement('div');
        meta.className = 'planner-course-meta';
        const h4 = document.createElement('h4');
        protectUserNode(h4);
        h4.textContent = `🎯 ${c.target}`;

        const badge = document.createElement('span');
        badge.className = `proofing-issue-chip ${c.isNearCampus ? 'is-grammar' : 'is-spelling'}`;
        badge.textContent = c.isNearCampus
            ? tUi(
                `📍 On / Near (${c.distanceKm} km) → Notify ${c.recommendedLeadMinutes} min before`,
                `📍 En sitio / Cerca (${c.distanceKm} km) → Avisar ${c.recommendedLeadMinutes} min antes`
            )
            : tUi(
                `🚗 Driving (${c.distanceKm} km · ${c.trafficLabel}) → ~${c.driveMinutesWithTraffic} min drive · Notify ${c.recommendedLeadMinutes} min before`,
                `🚗 En auto (${c.distanceKm} km · ${c.trafficLabel}) → ~${c.driveMinutesWithTraffic} min traslado · Avisar ${c.recommendedLeadMinutes} min antes`
            );

        meta.append(h4, badge);

        const actions = document.createElement('div');
        if (c.mapsDirectionsUrl) {
            const link = document.createElement('a');
            link.href = c.mapsDirectionsUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'btn-secondary btn-small';
            link.style.textDecoration = 'none';
            link.textContent = tUi('🗺️ Open Route', '🗺️ Abrir Ruta');
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
        { label: '💻 ITS Blvd / Boillot · Sistemas R/S (CTO-004)', lat: 25.443650, lng: -100.989150 },
        { label: '🎓 ITS Principal (CTO-002)', lat: 25.444780, lng: -100.992420 },
        { label: '⚙️ ITS Miravalle · N/Labs (CTO-003)', lat: 25.444920, lng: -100.990850 }
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
        .then(res => (res.ok ? res.json() : Promise.reject(new Error(tUi('Could not load ITS Planner', 'No se pudo cargar el Planificador ITS')))))
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
            setPlannerBanner('err', `${tUi('Error loading ITS planner', 'Error al cargar el planificador ITS')}: ${tServer(err.message)}`);
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
            setPlannerBanner('info', tUi('Created new semester. Customize its dates and click "Save All..." at the bottom.', 'Nuevo semestre creado. Personaliza sus fechas y presiona "Guardar Todo..." abajo.'));
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
                setPlannerBanner('ok', tUi('Loaded your 5 MindBox 9th-semester ITS courses! Click "Save All..." at the bottom to persist.', '¡Cargadas tus 5 materias MindBox 9° semestre ITS! Presiona "Guardar Todo..." abajo para guardarlas.'));
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
                .catch(() => { });
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
                }).catch(() => { });
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
                setPlannerBanner('err', tUi('Enter your Saltillo street address, paste a Google Maps link, or enter valid Home coordinates first.', 'Ingresa tu dirección en Saltillo, pega un enlace de Google Maps o introduce coordenadas válidas de Casa primero.'));
                showToast('err', tUi('Enter a Home address, Maps link, or coordinates.', 'Ingresa una dirección, enlace Maps o coordenadas.'));
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
                        ? tUi(`Home located (${resData.geocodedDisplayName}) & routes recalculated!`, `Casa ubicada (${resData.geocodedDisplayName}) y rutas recalculadas.`)
                        : (tServer(resData?.message) || tUi('Home location saved & verified!', '¡Ubicación de Casa guardada y verificada!'));
                    setPlannerBanner('ok', msg);
                    showToast('ok', msg);
                } catch (err) {
                    setPlannerBanner('err', tServer(err.message) || tUi('Could not save or geocode Home location.', 'No se pudo guardar o geocodificar la ubicación de Casa.'));
                    showToast('err', tServer(err.message) || tUi('Could not locate Home address.', 'No se pudo ubicar la dirección de Casa.'));
                }
            }, { loadingText: tUi('Locating...', 'Ubicando...') });
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
                    setPlannerBanner('ok', tServer(resData.message) || tUi('ITS Schedule, Vacations, Residencias, Work & Locations saved!', '¡Horario ITS, Vacaciones, Residencias, Trabajo y Ubicaciones guardados!'));
                    showToast('ok', tUi('Planner saved!', '¡Planificador guardado!'));
                    cargarRecordatoriosActivos();
                } catch (err) {
                    setPlannerBanner('err', `${tUi('Failed to save planner', 'Error al guardar planificador')}: ${tServer(err.message)}`);
                    showToast('err', err.message);
                }
            }, { loadingText: tUi('Saving...', 'Guardando...') });
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
                    const syncMsg = tServer(syncRes.message) || tUi('Synced classes, Residencias & work to Weekly Agenda!', '¡Clases, Residencias y trabajo sincronizados con tu Agenda Semanal!');
                    setPlannerBanner('ok', syncMsg);
                    showToast('ok', syncMsg);
                } catch (err) {
                    setPlannerBanner('err', `${tUi('Failed to sync to Agenda', 'Error al sincronizar a la Agenda')}: ${tServer(err.message)}`);
                    showToast('err', err.message);
                }
            }, { loadingText: tUi('Syncing...', 'Sincronizando...') });
        });
    }
}

// ==========================================
// INTERACTIVE REPERTOIRE BROWSER (ARTIST -> ALBUM -> SONG)
// ==========================================
function buildMusicRepertoireBuckets() {
    const artistMap = new Map();
    const ensureArtist = (id, nombre) => {
        const key = id || 0;
        if (!artistMap.has(key)) {
            artistMap.set(key, {
                id: key,
                nombre: nombre || 'Unknown Artist',
                albums: new Map()
            });
        }
        return artistMap.get(key);
    };

    (musicState.songs || []).forEach(song => {
        const artists = Array.isArray(song.artists) && song.artists.length
            ? song.artists
            : [{ id: 0, nombre: 'Unknown Artist', rol: 'main' }];
        artists.forEach(art => {
            const bucket = ensureArtist(art.id, art.nombre);
            const albumKey = song.album_id ? `alb_${song.album_id}` : 'single_none';
            if (!bucket.albums.has(albumKey)) {
                bucket.albums.set(albumKey, {
                    key: albumKey,
                    albumId: song.album_id || null,
                    titulo: song.album_titulo || 'Standalone Singles & Tracks',
                    tipo: song.album_titulo ? (song.album_tipo || 'album') : 'single',
                    anio: song.album_anio || null,
                    songs: []
                });
            }
            bucket.albums.get(albumKey).songs.push(song);
        });
    });

    (musicState.albums || []).forEach(al => {
        const aid = al.artista_principal_id || 0;
        const aname = al.artista_principal_nombre || 'Independent Releases';
        const bucket = ensureArtist(aid, aname);
        const albumKey = `alb_${al.id}`;
        if (!bucket.albums.has(albumKey)) {
            bucket.albums.set(albumKey, {
                key: albumKey,
                albumId: al.id,
                titulo: al.titulo,
                tipo: al.tipo_lanzamiento || 'album',
                anio: al.anio || null,
                songs: []
            });
        }
    });

    return Array.from(artistMap.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function renderMusicRepertoireNavigator() {
    const navWrap = document.getElementById('musicRepertoireNavigator');
    if (navWrap) navWrap.hidden = true;
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
        : d.toLocaleDateString(tLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function renderCrisisCards(container, rows, { allowDelete = false } = {}) {
    if (!container) return;
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
        const p = document.createElement('p');
        p.className = 'muted-text';
        p.textContent = allowDelete
            ? tUi(
                'No crisis episodes recorded yet. If you have an episode, log date, time, and trigger in Spanish here.',
                'Sin episodios de crisis registrados aún. Si tienes uno, registra fecha, hora y detonante aquí.'
            )
            : tUi('No crisis episodes recorded during this week.', 'Sin episodios de crisis registrados esta semana.');
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
        const rawType = item.tipo_crisis || 'Crisis';
        typeBadge.textContent = (window.DailyHubI18n && typeof window.DailyHubI18n.crisisTypeLabel === 'function')
            ? window.DailyHubI18n.crisisTypeLabel(rawType, true)
            : rawType;

        const intBadge = document.createElement('span');
        intBadge.className = 'crisis-intensity-badge';
        const intVal = Number(item.intensidad || 3);
        intBadge.textContent = tUi(`Intensity ${intVal}/5`, `Intensidad ${intVal}/5`);

        badges.append(dateStrong, typeBadge, intBadge);
        head.appendChild(badges);

        if (allowDelete && item.id) {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn-secondary btn-small';
            delBtn.textContent = tUi('Delete', 'Eliminar');
            delBtn.addEventListener('click', async () => {
                const ok = await openConfirmDialog({
                    title: tUi('Delete Crisis Entry?', '¿Eliminar registro de crisis?'),
                    message: tUi('Remove this crisis episode from your clinical log?', '¿Quitar este episodio de crisis de tu bitácora clínica?'),
                    confirmText: tUi('Delete', 'Eliminar'),
                    danger: true
                });
                if (!ok) return;
                runWithButtonLock(delBtn, async () => {
                    const res = await fetch(`/api/delete-crisis/${item.id}`, { method: 'DELETE' });
                    if (res.ok) {
                        showToast('ok', tUi('Crisis record removed.', 'Registro de crisis eliminado.'));
                        cargarCrisisRecientes();
                    } else {
                        showToast('err', tUi('Could not remove crisis record.', 'No se pudo eliminar el registro de crisis.'));
                    }
                }, { loadingText: '...' });
            });
            head.appendChild(delBtn);
        }

        const motivoP = document.createElement('p');
        motivoP.className = 'crisis-entry-motivo';
        protectUserNode(motivoP);
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
    const otroGroup = document.getElementById('crisisOtroSpecGroup');
    const otroInput = document.getElementById('crisisOtroTexto');
    const motivoEl = document.getElementById('crisisMotivo');
    const counterEl = document.getElementById('crisisCharCounter');

    const updateCharCount = () => {
        if (!motivoEl || !counterEl) return;
        const len = motivoEl.value.length;
        counterEl.textContent = `${len} / 250 máx.`;
        counterEl.style.color = len >= 240 ? '#ef4444' : '';
    };
    if (motivoEl) {
        motivoEl.addEventListener('input', updateCharCount);
        updateCharCount();
    }

    document.querySelectorAll('#crisisTipoPills [data-crisis-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.getAttribute('data-crisis-type') || 'Estrés';
            if (tipoHidden) tipoHidden.value = val;
            document.querySelectorAll('#crisisTipoPills [data-crisis-type]').forEach(b =>
                b.classList.toggle('active', b === btn)
            );
            if (otroGroup) {
                otroGroup.hidden = val !== 'Otro';
                if (val === 'Otro' && otroInput) otroInput.focus();
            }
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
        const detalleOtro = (document.getElementById('crisisOtroTexto')?.value || '').trim();
        const motivo = (document.getElementById('crisisMotivo')?.value || '').trim();

        if (!fecha || !hora) {
            setInlineBanner('crisisStatusBanner', 'err', 'Completa la fecha y la hora del episodio.');
            return;
        }
        if (tipoCrisis === 'Otro' && !detalleOtro && !motivo) {
            setInlineBanner('crisisStatusBanner', 'err', 'Al elegir "Otro", especifica brevemente qué emoción sentiste o qué ocurrió.');
            otroInput?.focus();
            return;
        }
        if (motivo.length > 250) {
            setInlineBanner('crisisStatusBanner', 'err', 'La descripción no puede superar los 250 caracteres.');
            return;
        }
        setInlineBanner('crisisStatusBanner', '', '');

        runWithButtonLock(btnSave, async () => {
            try {
                const res = await fetch('/api/insert-crisis', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fecha,
                        hora,
                        tipoCrisis,
                        intensidad,
                        detalleOtro,
                        motivo,
                        allowOptionalMotivo: true
                    })
                });
                if (!res.ok) throw new Error(await res.text() || 'Error saving crisis log.');
                if (motivoEl) motivoEl.value = '';
                if (otroInput) otroInput.value = '';
                updateCharCount();
                prefillCrisisCurrentTimestamp();
                setInlineBanner('crisisStatusBanner', 'ok', 'Episodio guardado correctamente (visible para tu psiquiatra/psicóloga en Resumen Semanal).');
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
                showToast('info', tUi(`Selected "${match.titulo}" from catalog.`, `"${match.titulo}" seleccionada del catálogo.`));
            }
        });
    }
}

function refreshDynamicLanguageViews() {
    actualizarCabecerasDeFecha();
    updateTransportStatusBadges();
    updateE2eeKeyStatusUI();
    updateYouTubePlatformUI();
    if (typeof updateAiMemoryBadgeUI === 'function') updateAiMemoryBadgeUI();
    if (typeof actualizarBadgePuentePc === 'function') actualizarBadgePuentePc();

    const activeViewEl = document.querySelector('.app-view.active');
    if (activeViewEl && mobileViewTitle) {
        const rawTitle = activeViewEl.getAttribute('data-title') || 'Daily Hub';
        mobileViewTitle.textContent = (window.DailyHubI18n && typeof window.DailyHubI18n.translateText === 'function')
            ? window.DailyHubI18n.translateText(rawTitle)
            : rawTitle;
    }

    const roleLabelEl = document.getElementById('sidebarRoleLabel');
    if (roleLabelEl && currentUser) {
        roleLabelEl.textContent = currentUser.rol === 'psiquiatra'
            ? tUi('Psychiatrist Mode (Read-Only)', 'Modo Psiquiatra (Solo Lectura)')
            : tUi('Owner (Admin)', 'Propietario (Admin)');
    }

    const selectSemana = document.getElementById('semanaSeleccionada');
    if (selectSemana) {
        Array.from(selectSemana.options).forEach(opt => {
            const val = opt.dataset.weekRange || opt.value;
            const [s1, s2] = String(val || '').split('|');
            if (s1 && s2) {
                const p1 = s1.split('-').map(Number);
                const p2 = s2.split('-').map(Number);
                if (p1.length === 3 && p2.length === 3) {
                    const d1 = new Date(p1[0], p1[1] - 1, p1[2]);
                    const d2 = new Date(p2[0], p2[1] - 1, p2[2]);
                    const textoVisual = `${d1.toLocaleDateString(tLocale(), { day: 'numeric', month: 'short' })} - ${d2.toLocaleDateString(tLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}`;
                    opt.textContent = `${tUi('Week', 'Semana')}: ${textoVisual}`;
                }
            }
        });
    }

    if (activeViewEl) {
        const vid = activeViewEl.id;
        if (vid === 'view-inicio' && typeof cargarInicioResumen === 'function') cargarInicioResumen();
        else if (vid === 'view-mood' && typeof cargarMoodsHoy === 'function') cargarMoodsHoy();
        else if (vid === 'view-crisis' && typeof cargarCrisisRecientes === 'function') cargarCrisisRecientes();
        else if (vid === 'view-sueno' && typeof cargarSuenoHoy === 'function') cargarSuenoHoy();
        else if (vid === 'view-english') {
            if (typeof renderMusicCatalog === 'function') renderMusicCatalog();
            if (typeof renderMusicRepertoireNavigator === 'function') renderMusicRepertoireNavigator();
            if (typeof getCancionSeleccionada === 'function' && typeof actualizarPanelLetraCancion === 'function') {
                actualizarPanelLetraCancion(getCancionSeleccionada());
            }
        } else if (vid === 'view-agenda' && typeof renderAgendaBoard === 'function') renderAgendaBoard();
        else if (vid === 'view-horario') {
            if (typeof renderPlannerSemesterUI === 'function') renderPlannerSemesterUI();
            if (typeof renderLiveCommuteCards === 'function') renderLiveCommuteCards();
        } else if (vid === 'view-resumen' && selectSemana) {
            selectSemana.dispatchEvent(new Event('change'));
        } else if (vid === 'view-medico' && typeof cargarMedicos === 'function') {
            cargarMedicos();
        } else if (vid === 'view-guia' && window.DailyHubVisualGuide && typeof window.DailyHubVisualGuide.mount === 'function') {
            window.DailyHubVisualGuide.mount('visualGuideAppHost', { standalone: false });
        }
    }
    if (currentUser && currentUser.rol === 'admin' && typeof cargarRecordatoriosActivos === 'function') {
        cargarRecordatoriosActivos();
    }
    if (cachedVersionData && typeof updateVersionUiBadges === 'function') {
        updateVersionUiBadges(cachedVersionData);
    }
    const versionModalEl = document.getElementById('versionHistoryModal');
    if (versionModalEl && !versionModalEl.hidden && typeof renderVersionHistoryModal === 'function') {
        renderVersionHistoryModal();
    }
}

// ==========================================
// AUTOMATIC SEMVER 2.0.0 VERSION HISTORY UI
// ==========================================
let cachedVersionData = null;

function formatVersionTimestamp(rawIso) {
    if (!rawIso) return tUi('Baseline release', 'Versión base');
    const parsed = new Date(rawIso);
    if (Number.isNaN(parsed.getTime())) return String(rawIso).slice(0, 10);
    return parsed.toLocaleString(tLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

function formatBumpBadgeLabel(bumpType) {
    const clean = String(bumpType || 'patch').toLowerCase();
    if (clean === 'major') return tUi('MAJOR (+1.0.0)', 'MAYOR (+1.0.0)');
    if (clean === 'minor') return tUi('MINOR (+0.1.0)', 'MENOR (+0.1.0)');
    if (clean === 'initial') return tUi('INITIAL (BASELINE)', 'INICIAL (BASE)');
    return tUi('PATCH (+0.0.1)', 'PARCHE (+0.0.1)');
}

function formatReleaseTriggerLabel(trigger) {
    const clean = String(trigger || 'push').toLowerCase();
    if (clean === 'workflow_dispatch') return tUi('Manual Deploy', 'Despliegue Manual');
    if (clean === 'baseline') return tUi('Baseline', 'Línea Base');
    return tUi('Auto Deploy (main)', 'Auto Despliegue (main)');
}

function updateVersionUiBadges(data) {
    if (!data) return;
    const version = data.currentVersion || '1.0.0';
    const tag = data.tag || `v${version}`;
    const total = Number(data.totalReleases) || (Array.isArray(data.history) ? data.history.length : 1);

    const sidebarEl = document.getElementById('sidebarVersionText');
    if (sidebarEl) {
        protectUserNode(sidebarEl);
        sidebarEl.textContent = tag;
    }

    const summaryEl = document.getElementById('settingsVersionSummary');
    if (summaryEl) {
        protectUserNode(summaryEl);
        const countLabel = total === 1
            ? tUi('1 release recorded', '1 versión registrada')
            : tUi(`${total} releases recorded`, `${total} versiones registradas`);
        const dateStr = data.releasedAt ? ` · ${formatVersionTimestamp(data.releasedAt)}` : '';
        summaryEl.textContent = `${tag} · ${countLabel}${dateStr}`;
    }
}

function renderVersionHistoryModal() {
    const bodyEl = document.getElementById('versionHistoryBody');
    if (!bodyEl) return;

    if (!cachedVersionData) {
        bodyEl.replaceChildren(createLoadingBanner(tUi('Loading version history...', 'Cargando historial de versiones...'), 'sm'));
        return;
    }

    const releases = Array.isArray(cachedVersionData.history) ? cachedVersionData.history : [];
    if (!releases.length) {
        const empty = document.createElement('p');
        empty.className = 'muted-text';
        empty.textContent = tUi('No release history recorded yet.', 'Aún no hay historial de versiones registrado.');
        bodyEl.replaceChildren(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    releases.forEach((rel, idx) => {
        const card = document.createElement('div');
        card.className = `version-release-card${idx === 0 ? ' is-current' : ''}`;

        const top = document.createElement('div');
        top.className = 'version-release-top';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'version-release-title';

        const tagSpan = document.createElement('span');
        tagSpan.className = 'version-release-tag';
        tagSpan.textContent = rel.tag || `v${rel.version || '1.0.0'}`;
        titleWrap.appendChild(tagSpan);

        const bumpKey = ['major', 'minor', 'patch', 'initial'].includes(String(rel.bumpType || '').toLowerCase())
            ? String(rel.bumpType).toLowerCase()
            : 'patch';
        const bumpBadge = document.createElement('span');
        bumpBadge.className = `ver-badge is-${bumpKey}`;
        bumpBadge.textContent = formatBumpBadgeLabel(bumpKey);
        titleWrap.appendChild(bumpBadge);

        if (idx === 0) {
            const liveBadge = document.createElement('span');
            liveBadge.className = 'ver-badge is-minor';
            liveBadge.textContent = tUi('ACTIVE DEPLOY', 'ACTIVA');
            titleWrap.appendChild(liveBadge);
        }

        const metaWrap = document.createElement('div');
        metaWrap.className = 'version-release-meta';

        const dateSpan = document.createElement('span');
        dateSpan.textContent = formatVersionTimestamp(rel.releasedAt);
        metaWrap.appendChild(dateSpan);

        if (rel.commitSha) {
            const shaSpan = document.createElement('span');
            shaSpan.className = 'version-release-sha';
            shaSpan.textContent = String(rel.commitSha).slice(0, 12);
            metaWrap.appendChild(shaSpan);
        }

        const triggerSpan = document.createElement('span');
        triggerSpan.textContent = formatReleaseTriggerLabel(rel.trigger);
        metaWrap.appendChild(triggerSpan);

        top.append(titleWrap, metaWrap);
        card.appendChild(top);

        if (rel.summary) {
            const summaryP = document.createElement('p');
            summaryP.className = 'version-release-summary';
            summaryP.textContent = rel.summary;
            card.appendChild(summaryP);
        }

        const changeGroups = [
            ['breaking', tUi('💥 Breaking Changes', '💥 Cambios Incompatibles')],
            ['features', tUi('✨ Features', '✨ Nuevas Funciones')],
            ['fixes', tUi('🐛 Bug Fixes', '🐛 Correcciones de Errores')],
            ['maintenance', tUi('🔧 Maintenance & Docs', '🔧 Mantenimiento y Docs')]
        ];

        changeGroups.forEach(([groupKey, groupTitle]) => {
            const items = rel.changes && Array.isArray(rel.changes[groupKey]) ? rel.changes[groupKey] : [];
            if (!items.length) return;
            const groupDiv = document.createElement('div');
            groupDiv.className = 'version-change-group';
            const heading = document.createElement('strong');
            heading.textContent = groupTitle;
            const ul = document.createElement('ul');
            items.forEach(text => {
                const li = document.createElement('li');
                li.textContent = String(text);
                ul.appendChild(li);
            });
            groupDiv.append(heading, ul);
            card.appendChild(groupDiv);
        });

        fragment.appendChild(card);
    });

    bodyEl.replaceChildren(fragment);
}

function cargarVersionInfo() {
    return fetch('/api/version', { cache: 'no-store' })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
            if (!data || !data.currentVersion) return null;
            cachedVersionData = data;
            updateVersionUiBadges(data);
            const modalEl = document.getElementById('versionHistoryModal');
            if (modalEl && !modalEl.hidden) {
                renderVersionHistoryModal();
            }
            return data;
        })
        .catch(() => null);
}

function openVersionHistoryModal() {
    const modalEl = document.getElementById('versionHistoryModal');
    if (!modalEl) return;
    modalEl.hidden = false;
    renderVersionHistoryModal();
    cargarVersionInfo();
}

function closeVersionHistoryModal() {
    const modalEl = document.getElementById('versionHistoryModal');
    if (modalEl) modalEl.hidden = true;
}

function initVersionHistoryHandlers() {
    const btnSidebar = document.getElementById('btnOpenVersionHistory');
    const btnSettings = document.getElementById('btnSettingsVersionHistory');
    const btnClose = document.getElementById('btnCloseVersionModal');
    const modalEl = document.getElementById('versionHistoryModal');

    if (btnSidebar && !btnSidebar.dataset.bound) {
        btnSidebar.dataset.bound = '1';
        btnSidebar.addEventListener('click', openVersionHistoryModal);
    }
    if (btnSettings && !btnSettings.dataset.bound) {
        btnSettings.dataset.bound = '1';
        btnSettings.addEventListener('click', openVersionHistoryModal);
    }
    if (btnClose && !btnClose.dataset.bound) {
        btnClose.dataset.bound = '1';
        btnClose.addEventListener('click', closeVersionHistoryModal);
    }
    if (modalEl && !modalEl.dataset.boundBackdrop) {
        modalEl.dataset.boundBackdrop = '1';
        modalEl.addEventListener('click', (e) => {
            if (e.target === modalEl) closeVersionHistoryModal();
        });
    }
    if (!document.body.dataset.versionEscBound) {
        document.body.dataset.versionEscBound = '1';
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modalEl && !modalEl.hidden) {
                closeVersionHistoryModal();
            }
        });
    }
}

// ==========================================
// APP INITIALIZATION
// ==========================================
function autoResizeTextareaElement(el) {
    if (!el || el.hidden || el.id === 'musicSongLyricsViewer') return;
    const minH = el.id === 'journalText' ? 220 : 92;
    el.style.height = 'auto';
    const nextH = Math.max(minH, el.scrollHeight + 4);
    el.style.height = `${nextH}px`;
}

function initResponsiveTextareas() {
    const bindAll = () => {
        document.querySelectorAll('textarea').forEach(el => {
            if (el.id === 'musicSongLyricsViewer') return;
            if (el.dataset.autoResizeWired !== '1') {
                el.dataset.autoResizeWired = '1';
                el.addEventListener('input', () => autoResizeTextareaElement(el));
                el.addEventListener('focus', () => autoResizeTextareaElement(el));
                el.addEventListener('change', () => autoResizeTextareaElement(el));
            }
            if (!el.closest('[hidden]')) {
                autoResizeTextareaElement(el);
            }
        });
    };

    bindAll();
    if (!window.__pdhTextareasResizeWired) {
        window.__pdhTextareasResizeWired = true;
        window.addEventListener('resize', bindAll);
    }
}

function initApp() {
    initTheme();
    actualizarCabecerasDeFecha();
    initPasswordToggles();
    initAuthHandlers();
    initSettingsHandlers();
    initLanguageAiStudio();
    initGlobalFloatingTranslator();
    initWordStyleProofing();
    initAcademicPlannerHandlers();
    initQuickLocationModal();
    initCrisisHandlers();
    initMusicEntityEditModal();
    initKeyboardShortcuts();
    initResponsiveTextareas();
    initVersionHistoryHandlers();
    if (window.DailyHubI18n && typeof window.DailyHubI18n.onChange === 'function') {
        window.DailyHubI18n.onChange(() => refreshDynamicLanguageViews());
    }

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
