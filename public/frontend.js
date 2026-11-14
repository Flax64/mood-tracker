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
// E2EE CLIENT CRYPTO HELPERS (SHARED BY JOURNAL & ENGLISH NOTEBOOK)
// ==========================================
function obtenerLlaveE2EE() {
    let llaveTexto = localStorage.getItem('diario_llave_secreta');

    if (!llaveTexto || llaveTexto.length !== 32) {
        llaveTexto = prompt(
            '🔒 E2EE Security:\nEnter your 32-character secret key.\nIt will only be requested once on this device:'
        );

        if (llaveTexto && llaveTexto.length === 32) {
            localStorage.setItem('diario_llave_secreta', llaveTexto);
        } else {
            alert('Canceled: Your secret key must be exactly 32 characters long.');
            return null;
        }
    }

    return llaveTexto;
}

function encriptarTextoE2EE(textoPlano, llaveTexto) {
    const keyWords = CryptoJS.enc.Utf8.parse(llaveTexto);
    const iv = CryptoJS.lib.WordArray.random(16);
    const encrypted = CryptoJS.AES.encrypt(textoPlano, keyWords, { iv: iv });
    return iv.toString(CryptoJS.enc.Hex) + ':' + encrypted.toString();
}

// ==========================================
// MAIN NAVIGATION & FIXED SIDEBAR
// ==========================================
const VALID_VIEWS = new Set(['inicio', 'mood', 'sueno', 'journal', 'english', 'agenda', 'resumen', 'medico', 'settings']);
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

function showView(viewName, updateHash = true) {
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
        if (fechaInput) fechaInput.value = formatLocalDate(new Date());
        if (momentoSelect) momentoSelect.value = getMomentoInfo(new Date().getHours()).moodKey;
    } else if (targetView === 'resumen') {
        const selectSemana = document.getElementById('semanaSeleccionada');
        if (selectSemana) selectSemana.dispatchEvent(new Event('change'));
    } else if (targetView === 'agenda') {
        cargarAgendaSemana();
    } else if (targetView === 'medico') {
        cargarMedicos();
    } else if (targetView === 'settings') {
        cargarSettingsVista();
    }
    if (currentUser && currentUser.rol === 'admin') {
        cargarRecordatoriosActivos();
    }
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
            const totalH = registros.reduce((acc, r) => acc + parseFloat(r.horas || 0), 0);
            const horasEnteras = Math.floor(totalH);
            const minutosRest = Math.round((totalH - horasEnteras) * 60);
            const p = document.createElement('p');
            p.style.margin = '0';
            const plural = registros.length === 1 ? 'session' : 'sessions';
            p.innerHTML = `<strong>${horasEnteras}:${String(minutosRest).padStart(2, '0')} hrs</strong> logged across ${registros.length} ${plural}.`;
            sleepBox.appendChild(p);
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

if (formRegistro) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    document.getElementById('fecha').value = `${year}-${month}-${day}`;

    let estadoSeleccionado = '';
    let colorSeleccionado = '';

    const botones = document.querySelectorAll('.mood-btn');
    botones.forEach(btn => {
        btn.addEventListener('click', () => {
            botones.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            estadoSeleccionado = btn.getAttribute('data-mood');
            colorSeleccionado = btn.getAttribute('data-color');
        });
    });

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

    let lastSavedMoodSignature = '';

    formRegistro.addEventListener('submit', (e) => {
        e.preventDefault();

        const btnGuardarMood = document.getElementById('btn-save-mood');
        if (!btnGuardarMood || busyActionElements.has(btnGuardarMood) || btnGuardarMood.disabled) return;

        if (!estadoSeleccionado) {
            alert('Please select a mood first.');
            return;
        }

        const datos = {
            fecha: document.getElementById('fecha').value,
            momento_dia: document.getElementById('momento').value,
            estado_animo: estadoSeleccionado,
            color_hex: colorSeleccionado
        };

        if (!datos.fecha || !datos.momento_dia) {
            alert('Please select date and time of day.');
            return;
        }

        const moodSignature = `${datos.fecha}|${datos.momento_dia}|${datos.estado_animo}`;
        if (moodSignature === lastSavedMoodSignature) {
            alert('This exact mood is already saved for this date and time of day.');
            return;
        }

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
                alert(mensaje);
                botones.forEach(b => b.classList.remove('selected'));
                estadoSeleccionado = '';
                colorSeleccionado = '';
                document.getElementById('momento').value = '';
                cargarRecordatoriosActivos();
            } catch (error) {
                alert('Error: ' + error.message);
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
        let pendingRequests = 2;
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
                        celda.innerHTML = `<span class="color-dot" style="background-color: ${registro.color_hex};"></span>`;
                    }
                });
            })
            .catch(error => {
                if (!isAbortError(error)) console.error('Error loading moods:', error);
            })
            .finally(markOneSettled);

        const sleepGrid = document.getElementById('sleepGrid');
        sleepGrid.replaceChildren(createLoadingBanner('Loading sleep logs...', 'sm'));

        const diasNombres = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const sumatoriaSueno = {
            Sunday: { horas: 0, calidades: [], sesiones: [] },
            Monday: { horas: 0, calidades: [], sesiones: [] },
            Tuesday: { horas: 0, calidades: [], sesiones: [] },
            Wednesday: { horas: 0, calidades: [], sesiones: [] },
            Thursday: { horas: 0, calidades: [], sesiones: [] },
            Friday: { horas: 0, calidades: [], sesiones: [] },
            Saturday: { horas: 0, calidades: [], sesiones: [] }
        };

        fetch(`/api/get-sleep?begin=${begin}&end=${end}`, fetchOpts)
            .then(response => response.ok ? response.json() : Promise.reject(new Error('Failed to load sleep logs')))
            .then(registros => {
                if (!resumenTracker.isCurrent(reqToken.seq)) return;
                sleepGrid.innerHTML = '';
                registros.forEach(registro => {
                    const fechaObj = new Date(registro.fecha);
                    const nombreDia = diasSemana[fechaObj.getUTCDay()];

                    const horasRegistro = parseFloat(registro.horas);
                    sumatoriaSueno[nombreDia].horas += horasRegistro;
                    sumatoriaSueno[nombreDia].calidades.push(registro.calidad);
                    sumatoriaSueno[nombreDia].sesiones.push(horasRegistro);
                });

                diasSemana.forEach((dia, index) => {
                    const datosDia = sumatoriaSueno[dia];
                    let emoji = '➖';
                    let colorBorde = '';
                    let textoHoras = '--';
                    let textoIntervalos = '';

                    if (datosDia.horas > 0) {
                        const totalH = datosDia.horas;
                        const cantidadSesiones = datosDia.sesiones.length;
                        const intermitente = cantidadSesiones > 1;

                        const horasEnteras = Math.floor(totalH);
                        const minutosRestantes = Math.round((totalH - horasEnteras) * 60);
                        textoHoras = `${horasEnteras}:${String(minutosRestantes).padStart(2, '0')} h`;

                        if (intermitente) {
                            const listaIntervalos = datosDia.sesiones.map(sesionH => {
                                const hE = Math.floor(sesionH);
                                const mR = Math.round((sesionH - hE) * 60);
                                return `${hE}:${String(mR).padStart(2, '0')}`;
                            });
                            textoIntervalos = `<div class="sleep-intervals">(${listaIntervalos.join(' + ')})</div>`;
                        }

                        if (totalH < 4 || (totalH < 6 && intermitente)) {
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
                    card.className = 'sleep-card';
                    if (colorBorde) card.style.borderColor = colorBorde;

                    card.innerHTML = `
                        <div class="day-name">${diasNombres[index]}</div>
                        <div class="sleep-hours" style="line-height: 1.1;">
                            ${textoHoras}
                            ${textoIntervalos}
                        </div>
                        <div class="sleep-quality" style="margin-top: 10px;">${emoji}</div>
                    `;
                    sleepGrid.appendChild(card);
                });
            })
            .catch(error => {
                if (!isAbortError(error) && resumenTracker.isCurrent(reqToken.seq)) {
                    console.error('Error loading sleep logs:', error);
                    sleepGrid.innerHTML = '<p class="muted-text">Could not load sleep logs.</p>';
                }
            })
            .finally(markOneSettled);
    });
}

// ==========================================
// SLEEP TRACKER FORM LOGIC
// ==========================================
const formSleep = document.getElementById('sleepForm');
if (formSleep) {
    function calcularHoras() {
        const sleepTime = document.getElementById('sleepTime').value;
        const wakeupTime = document.getElementById('wakeupTime').value;

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

            let visualText = `${intHours} ${intHours === 1 ? 'hr' : 'hrs'}`;
            if (intMinutes > 0) {
                visualText += ` ${intMinutes} ${intMinutes === 1 ? 'min' : 'mins'}`;
            }

            const inputSleep = document.getElementById('sleepHours');
            inputSleep.value = visualText;
            inputSleep.dataset.decimal = (totalMinutes / 60).toFixed(2);
        }
    }

    document.getElementById('sleepTime').addEventListener('change', () => calcularHoras());
    document.getElementById('wakeupTime').addEventListener('change', () => calcularHoras());

    let lastSavedSleepSignature = '';

    formSleep.addEventListener('submit', (e) => {
        e.preventDefault();
        const btnGuardarSleep = document.getElementById('btn-save-sleep');
        if (!btnGuardarSleep || busyActionElements.has(btnGuardarSleep) || btnGuardarSleep.disabled) return;

        const sleepTime = document.getElementById('sleepTime').value;
        const wakeupTime = document.getElementById('wakeupTime').value;
        const quality = document.getElementById('quality-sleep').value;

        if (!sleepTime || !wakeupTime || !quality) {
            alert('Please fill in all fields (bedtime, wake-up time, and sleep quality).');
            return;
        }

        const horas = parseFloat(document.getElementById('sleepHours').dataset.decimal);
        if (!Number.isFinite(horas) || horas <= 0) {
            alert('Bedtime and wake-up time cannot result in 0 hours of sleep.');
            return;
        }

        const fecha = formatLocalDate(new Date());
        const sleepSignature = `${fecha}|${sleepTime}|${wakeupTime}|${horas}|${quality}`;
        if (sleepSignature === lastSavedSleepSignature) {
            alert('This exact sleep session was already recorded.');
            return;
        }

        const datos = { fecha, horas, calidad: quality };

        runWithButtonLock(btnGuardarSleep, async () => {
            try {
                const mensaje = await submitMutationRequest({
                    url: '/api/insert-sleep',
                    method: 'POST',
                    scopeKey: 'sleep',
                    signature: sleepSignature,
                    buildBody: () => datos
                });
                lastSavedSleepSignature = sleepSignature;
                alert(mensaje);
                document.getElementById('sleepTime').value = '';
                document.getElementById('wakeupTime').value = '';
                const hoursInput = document.getElementById('sleepHours');
                hoursInput.value = '';
                delete hoursInput.dataset.decimal;
                document.getElementById('quality-sleep').value = '';
                cargarRecordatoriosActivos();
            } catch (error) {
                alert('Error: ' + error.message);
            }
        }, { loadingText: 'Saving...' });
    });
}

// ==========================================
// JOURNAL NOTES (ENCRYPTED NOTES TO PC WORD)
// ==========================================
const journalForm = document.getElementById('journalForm');

if (journalForm) {
    let lastSentJournalText = '';

    journalForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const btnEnviarWord = document.getElementById('btn-send-word');
        if (!btnEnviarWord || busyActionElements.has(btnEnviarWord) || btnEnviarWord.disabled) return;

        const textInput = document.getElementById('journalText');
        const texto = textInput.value;
        const textoLimpio = texto.trim();
        if (!textoLimpio) return;

        if (textoLimpio === lastSentJournalText) {
            alert('This exact note was already queued in this session. Edit the text before sending again.');
            return;
        }

        const llaveTexto = obtenerLlaveE2EE();
        if (!llaveTexto) return;

        runWithButtonLock(btnEnviarWord, async () => {
            try {
                await submitMutationRequest({
                    url: '/api/send-to-pc',
                    method: 'POST',
                    scopeKey: 'journal',
                    signature: textoLimpio,
                    buildBody: () => ({ texto: encriptarTextoE2EE(texto, llaveTexto) })
                });
                lastSentJournalText = textoLimpio;
                alert('Note sent! Your Python sync script will save it to Word on the next scan.');
                textInput.value = '';
            } catch (error) {
                alert('Failed to send note: ' + error.message);
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
    const tabButtons = document.querySelectorAll('.english-tab-btn[data-english-cat]');
    const statusBanner = document.getElementById('englishStatusBanner');
    const recentList = document.getElementById('englishRecentList');

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

        if (category === 'vocabulary') {
            return {
                category: 'vocabulary',
                word: val('engWord'),
                part_of_speech: val('engPos'),
                spanish: val('engSpanish'),
                example: val('engVocabExample'),
                notes: val('engVocabNotes')
            };
        }

        if (category === 'grammar') {
            return {
                category: 'grammar',
                title: val('engGrammarTitle'),
                notes: val('engGrammarNotes'),
                example: val('engGrammarExample')
            };
        }

        return {
            category: 'phrasal_verb',
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
            titleSpan.textContent = `${entry.word} — ${entry.spanish}`;
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
            vocabulary: ['engWord', 'engPos', 'engSpanish', 'engVocabExample', 'engVocabNotes'],
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

    englishForm.addEventListener('submit', (e) => {
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

        const llaveTexto = obtenerLlaveE2EE();
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
                mostrarEstadoEnglish(
                    'ok',
                    'Queued! Your PC sync will add this entry to english-notes/English_Learning_Notebook.docx and refresh the Table of Contents.'
                );
            } catch (err) {
                mostrarEstadoEnglish('err', 'Failed to send entry: ' + err.message);
            }
        }, { loadingText: 'Sending...' });
    });

    cambiarCategoriaEnglish('vocabulary');
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
    embedOpen: false
};

async function cargarCatalogoMusical() {
    const container = document.getElementById('musicCatalogContainer');
    if (!container) return;

    container.replaceChildren(createLoadingIndicator('Loading songs & artists...', 'sm'));
    try {
        const res = await fetch('/api/english/music/catalog');
        if (!res.ok) throw new Error(await res.text() || 'Failed to load music catalog.');
        const data = await res.json();
        musicState.artists = Array.isArray(data.artists) ? data.artists : [];
        musicState.albums = Array.isArray(data.albums) ? data.albums : [];
        musicState.songs = Array.isArray(data.songs) ? data.songs : [];

        poblarSelectoresMusica();
        renderMusicStats(data.stats);
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
        if (song.yt_music_url) {
            openYtBtn.href = song.yt_music_url;
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

function renderMusicCatalog() {
    const container = document.getElementById('musicCatalogContainer');
    if (!container) return;

    const search = (document.getElementById('musicFilterSearch')?.value || '').trim().toLowerCase();
    const artistFilter = document.getElementById('musicFilterArtist')?.value || '';
    const releaseFilter = document.getElementById('musicFilterReleaseType')?.value || '';
    const statusFilter = document.getElementById('musicFilterStatus')?.value || '';

    const filteredSongs = musicState.songs.filter(song => {
        if (artistFilter) {
            const hasArtist = (song.artists || []).some(a => String(a.id) === String(artistFilter));
            if (!hasArtist) return false;
        }
        if (releaseFilter && (song.album_tipo || 'single') !== releaseFilter) return false;
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
        const countEl = document.createElement('span');
        countEl.className = 'muted-text';
        const totalInArtist = Array.from(artistGroup.albums.values()).reduce((sum, al) => sum + al.songs.length, 0);
        countEl.textContent = `${totalInArtist} song(s)`;
        header.append(nameEl, countEl);
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

            const typeBadge = document.createElement('span');
            typeBadge.className = 'music-release-badge';
            typeBadge.textContent = RELEASE_TYPE_LABELS[album.tipo] || album.tipo;

            albumHeader.append(albumTitleEl, typeBadge);
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
                if (Number(musicState.selectedSongId) === Number(song.id)) {
                    row.classList.add('selected');
                }

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

                if (song.yt_music_url) {
                    const ytLink = document.createElement('a');
                    ytLink.className = 'btn-secondary btn-small';
                    ytLink.href = song.yt_music_url;
                    ytLink.target = '_blank';
                    ytLink.rel = 'noopener noreferrer';
                    ytLink.textContent = 'YT Music';
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
                delBtn.addEventListener('click', () => {
                    if (!window.confirm(`Remove "${song.titulo}" from your music catalog? (Local Word notes are kept safely on your PC.)`)) {
                        return;
                    }
                    runWithButtonLock(delBtn, async () => {
                        const res = await fetch(`/api/english/music/songs/${song.id}`, { method: 'DELETE' });
                        if (res.ok) {
                            if (Number(musicState.selectedSongId) === Number(song.id)) {
                                musicState.selectedSongId = null;
                            }
                            await cargarCatalogoMusical();
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

    if (btnOpenLib) {
        btnOpenLib.addEventListener('click', () => {
            window.open('https://music.youtube.com/library', '_blank', 'noopener,noreferrer');
        });
    }

    if (btnSearchYt) {
        btnSearchYt.addEventListener('click', async () => {
            const q = (document.getElementById('musicYtSearchQuery')?.value || '').trim();
            const directUrl = q
                ? `https://music.youtube.com/search?q=${encodeURIComponent(q)}`
                : 'https://music.youtube.com/';
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
                            if (urlEl) urlEl.value = item.ytMusicUrl || '';
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
                    if (urlInput && data.ytMusicUrl) urlInput.value = data.ytMusicUrl;
                    const titleEl = document.getElementById('musicSongTitle');
                    const artistEl = document.getElementById('musicMainArtist');
                    if (titleEl && !titleEl.value.trim() && data.suggestedTitle) {
                        titleEl.value = data.suggestedTitle;
                    }
                    if (artistEl && !artistEl.value.trim() && data.suggestedArtist) {
                        artistEl.value = data.suggestedArtist;
                    }
                    mostrarBannerMusica('musicSongFormBanner', 'ok', 'YouTube Music link verified and normalized.');
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

    ['musicFilterSearch', 'musicFilterArtist', 'musicFilterReleaseType', 'musicFilterStatus'].forEach(fid => {
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
        wordForm.addEventListener('submit', e => {
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

            const llaveTexto = obtenerLlaveE2EE();
            if (!llaveTexto) return;

            const entry = selected
                ? {
                    category: 'music',
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
                } catch (err) {
                    mostrarBannerMusica('musicWordStatusBanner', 'err', 'Failed to send encrypted notes: ' + err.message);
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

    metaRow.append(timePill, catPill, typePill);

    const text = document.createElement('span');
    text.className = 'agenda-item-text';
    text.textContent = item.actividad;

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
    content.append(metaRow, text, jiraRow);

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
    row.append(checkBtn, content, actions);
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
        } catch (err) {
            if (ui.statusSelect) ui.statusSelect.value = prevEstado;
            alert('Failed to update activity status: ' + err.message);
        }
    }, { extraDisable: [ui.row, ui.checkBtn, ui.statusSelect, ui.editBtn, ui.delBtn] });
}

function eliminarAgendaItem(id, ui = {}) {
    const lockBtn = ui.delBtn || ui.row || document.createElement('button');
    runWithButtonLock(lockBtn, async () => {
        if (!confirm('Delete this activity from your agenda?')) return;
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
        } catch (err) {
            alert('Failed to delete activity: ' + err.message);
        }
    }, { extraDisable: [ui.row, ui.checkBtn, ui.statusSelect, ui.editBtn] });
}

const agendaModal = document.getElementById('agendaModal');
const agendaForm = document.getElementById('agendaForm');

let agendaOriginalSnapshot = null;

function abrirAgendaModal(prefill = {}) {
    if (!agendaModal || !agendaForm) return;
    const isEdit = Boolean(prefill.id);

    const now = new Date();
    const info = getMomentoInfo(now.getHours());
    const defaultDate = agendaState.layoutMode === 'day'
        ? agendaState.selectedDate
        : formatLocalDate(now);
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const resolvedFecha = prefill.fecha || defaultDate;
    const resolvedBloque = prefill.bloque || info.agendaBloque;
    const resolvedHora = String(prefill.hora || defaultTime).slice(0, 5);
    const resolvedActividad = String(prefill.actividad || '').trim();
    const resolvedTipo = prefill.tipo === 'tarea' ? 'tarea' : 'evento';
    const resolvedCategoria = prefill.categoria === 'universidad'
        ? 'universidad'
        : prefill.categoria === 'personal'
            ? 'personal'
            : (agendaState.filterCategory !== 'all' ? agendaState.filterCategory : 'personal');
    const resolvedEstado = getAgendaItemStatus(prefill);
    const resolvedRemMin = prefill.recordatorio_min !== undefined && prefill.recordatorio_min !== null && prefill.recordatorio_min !== ''
        ? String(prefill.recordatorio_min)
        : '';

    document.getElementById('agendaModalTitle').textContent = isEdit ? 'Edit Activity' : 'New Activity';
    document.getElementById('agendaEditId').value = isEdit ? String(prefill.id) : '';
    document.getElementById('agendaFecha').value = resolvedFecha;
    document.getElementById('agendaBloque').value = resolvedBloque;
    document.getElementById('agendaHora').value = resolvedHora;
    document.getElementById('agendaActividad').value = resolvedActividad;

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
            agendaState.layoutMode = agendaState.layoutMode === 'day' ? 'grid' : 'day';
            renderAgendaBoard();
        });
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
            }
        });
    });

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

        const payload = {
            fecha: document.getElementById('agendaFecha').value,
            bloque: document.getElementById('agendaBloque').value,
            hora: String(document.getElementById('agendaHora').value || '').slice(0, 5),
            actividad: document.getElementById('agendaActividad').value.replace(/\s+/g, ' ').trim(),
            tipo: tipoVal,
            categoria: catVal,
            estado: estadoVal,
            recordatorio_min: remVal
        };

        if (!payload.fecha || !payload.bloque || !payload.hora || !payload.actividad) {
            alert('Please fill in all activity fields.');
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
            alert('This exact activity is already scheduled for that date, category, block, and time.');
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
            } catch (err) {
                alert('Error: ' + err.message);
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
                alert('Your weekly session closed automatically (Sunday 00:00). Please sign in again.');
                showAuthScreen('authLoginForm');
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

        const initialHash = window.location.hash.replace('#', '');
        const startView = VALID_VIEWS.has(initialHash) ? initialHash : 'inicio';
        showView(startView, false);
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
                statusBtn.addEventListener('click', () => {
                    runWithButtonLock(statusBtn, async () => {
                        const verb = nextEstado === 'suspendido' ? 'Suspend' : 'Reactivate';
                        if (!confirm(`${verb} access for ${m.nombre} (${m.email})?`)) return;
                        try {
                            await submitMutationRequest({
                                url: `/api/auth/medicos/${m.id}/estado`,
                                method: 'PATCH',
                                scopeKey: `medico-estado:${m.id}`,
                                signature: `${m.id}|${nextEstado}`,
                                buildBody: () => ({ estado: nextEstado }),
                                parseJson: true
                            });
                            cargarMedicos();
                        } catch (err) {
                            alert('Error: ' + err.message);
                        }
                    }, { loadingText: 'Updating...', extraDisable: [delBtn] });
                });

                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'btn-revoke-medico';
                delBtn.textContent = 'Revoke access';
                delBtn.addEventListener('click', () => {
                    runWithButtonLock(delBtn, async () => {
                        if (!confirm(`Revoke access for ${m.nombre} (${m.email})?`)) return;
                        try {
                            await submitMutationRequest({
                                url: `/api/auth/medicos/${m.id}`,
                                method: 'DELETE',
                                scopeKey: `medico-revoke:${m.id}`,
                                signature: String(m.id),
                                parseJson: true
                            });
                            cargarMedicos();
                        } catch (err) {
                            alert('Error: ' + err.message);
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
                alert('Please enter a valid email address above first.');
                return;
            }

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
                    alert(data.message);
                } catch (err) {
                    alert(err.message);
                }
            }, { loadingText: 'Sending code...' });
        });
    }

    function bindLockedFormSubmit({ formId, btnId, url, loadingText, scopeKey, getSubmission, onSuccess, errorPrefix = '' }) {
        const form = document.getElementById(formId);
        if (!form) return;
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const btn = document.getElementById(btnId);
            if (!btn || busyActionElements.has(btn) || btn.disabled) return;
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
                    alert(`${errorPrefix}${err.message}`);
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
                alert('Please enter a valid email and password.');
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
                alert('Your sign-in verification session expired. Please sign in again.');
                showAuthForm('authLoginForm', 'Sign in to continue');
                return null;
            }
            if (!/^\d{6}$/.test(code)) {
                alert('Enter the 6-digit verification code from your email.');
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
                alert('Name must be between 2 and 80 characters.');
                return null;
            }
            if (!validateEmailClient(payload.email)) {
                alert('Please enter a valid email address.');
                return null;
            }
            const pwErr = validatePasswordFormatClient(payload.password);
            if (pwErr) {
                alert(pwErr);
                return null;
            }
            if (!payload.codigoValidacion) {
                alert('Please enter the verification code or your personal secret key.');
                return null;
            }
            return { payload, signature: payload.email.toLowerCase() };
        },
        onSuccess: (data, form) => {
            pendingSubmissions.clear();
            form.reset();
            resetPasswordToggles();
            alert(`Welcome, ${data.user.nombre}! Your session will remain active until Sunday at 00:00 or until you sign out.`);
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
                alert('Please enter a valid email address.');
                return null;
            }
            return { payload: { email }, signature: email.toLowerCase() };
        },
        onSuccess: (data) => {
            alert(data.message);
            showAuthForm('authLoginForm', 'Sign in to continue');
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
                alert(pwErr);
                return null;
            }
            if (newPassword !== confirmPassword) {
                alert('Passwords do not match.');
                return null;
            }
            return {
                payload: { email, token, newPassword },
                signature: `${email.toLowerCase()}|${token}`
            };
        },
        onSuccess: (data, form) => {
            alert(data.message);
            form.reset();
            resetPasswordToggles();
            history.replaceState(null, '', window.location.pathname);
            showAuthForm('authLoginForm', 'Sign in with your new password');
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
        errorPrefix: 'Error: ',
        getSubmission: () => {
            const payload = {
                nombre: document.getElementById('medicoNombre').value.trim(),
                email: document.getElementById('medicoEmail').value.trim(),
                password: document.getElementById('medicoPassword').value
            };
            if (payload.nombre.length < 2 || payload.nombre.length > 80) {
                alert('Doctor name must be between 2 and 80 characters.');
                return null;
            }
            if (!validateEmailClient(payload.email)) {
                alert('Please enter a valid doctor email address.');
                return null;
            }
            const pwErr = validatePasswordFormatClient(payload.password);
            if (pwErr) {
                alert(pwErr);
                return null;
            }
            const sig = `${payload.nombre}|${payload.email.toLowerCase()}|${payload.password}`;
            if (sig === lastSavedMedicoSignature) {
                alert('These exact psychiatrist credentials were already saved.');
                return null;
            }
            return { payload, signature: sig };
        },
        onSuccess: (data, form, payload) => {
            lastSavedMedicoSignature = `${payload.nombre}|${payload.email.toLowerCase()}|${payload.password}`;
            alert(data.message);
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
        journal: 'Open Journal',
        english: 'Open English'
    };

    activeList.forEach(reminder => {
        const card = document.createElement('div');
        card.className = `reminder-card type-${reminder.type || 'general'}`;

        const info = document.createElement('div');
        info.className = 'reminder-card-info';

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
            goBtn.addEventListener('click', () => showView(reminder.targetView, true));
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
                new Notification(reminder.title || 'Personal Control Hub', {
                    body: reminder.message || '',
                    tag: reminder.key
                });
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
            alert('Error updating reminder: ' + err.message);
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
        } catch (err) {
            alert('Error marking task as Done: ' + err.message);
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
    const statusEl = document.getElementById('settingsE2eeStatus');
    if (!statusEl) return;
    const keyVal = localStorage.getItem('diario_llave_secreta') || '';
    if (keyVal.length === 32) {
        statusEl.textContent = 'Configured on this browser (32-character AES key active).';
    } else {
        statusEl.textContent = 'Not set on this browser yet (will be requested when writing Journal or English notes).';
    }
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
    setCheck('setMoodLateNight', settings.moodIncludeLateNight === true);
    setCheck('setSleepEnabled', settings.sleepReminderEnabled !== false);
    setVal('setSleepTime', settings.sleepReminderTime || '08:30');

    setCheck('setAgendaRemEnabled', settings.agendaRemindersEnabled !== false);
    setCheck('setAgendaEvents', settings.agendaNotifyEvents !== false);
    setCheck('setAgendaTasks', settings.agendaNotifyTasks !== false);
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
    setVal('setTimezone', settings.timezone || 'America/Monterrey');
    setCheck('setShowWeekend', settings.agendaShowWeekend !== false);

    updateE2eeKeyStatusUI();
}

function collectSettingsFormPayload() {
    const selectedDays = Array.from(document.querySelectorAll('#setEnglishDaysGroup input[type="checkbox"]:checked'))
        .map(cb => Number(cb.value));

    return {
        phoneNotificationsEnabled: Boolean(document.getElementById('setPhoneEnabled')?.checked),
        ntfyTopic: String(document.getElementById('setNtfyTopic')?.value || '').trim(),
        ntfyServerUrl: String(document.getElementById('setNtfyServerUrl')?.value || 'https://ntfy.sh').trim(),
        ntfyPriority: Number(document.getElementById('setNtfyPriority')?.value || 4),
        publicBaseUrl: String(document.getElementById('setPublicBaseUrl')?.value || '').trim(),
        desktopNotificationsEnabled: Boolean(document.getElementById('setDesktopNotify')?.checked),

        moodRemindersEnabled: Boolean(document.getElementById('setMoodEnabled')?.checked),
        moodIncludeLateNight: Boolean(document.getElementById('setMoodLateNight')?.checked),
        sleepReminderEnabled: Boolean(document.getElementById('setSleepEnabled')?.checked),
        sleepReminderTime: String(document.getElementById('setSleepTime')?.value || '08:30').slice(0, 5),

        agendaRemindersEnabled: Boolean(document.getElementById('setAgendaRemEnabled')?.checked),
        agendaNotifyEvents: Boolean(document.getElementById('setAgendaEvents')?.checked),
        agendaNotifyTasks: Boolean(document.getElementById('setAgendaTasks')?.checked),
        agendaLeadMinutes: Number(document.getElementById('setAgendaLeadMin')?.value ?? 10),

        wordEodReminderEnabled: Boolean(document.getElementById('setWordEodEnabled')?.checked),
        wordEodReminderTime: String(document.getElementById('setWordEodTime')?.value || '21:30').slice(0, 5),

        englishReminderEnabled: Boolean(document.getElementById('setEnglishEnabled')?.checked),
        englishReminderTime: String(document.getElementById('setEnglishTime')?.value || '19:00').slice(0, 5),
        englishReminderDays: selectedDays,
        englishReminderTopic: String(document.getElementById('setEnglishTopic')?.value || '').trim(),

        defaultAgendaCategory: document.getElementById('setDefaultCat')?.value || 'all',
        defaultAgendaLayout: document.getElementById('setDefaultLayout')?.value || 'auto',
        timezone: String(document.getElementById('setTimezone')?.value || 'America/Monterrey').trim(),
        agendaShowWeekend: Boolean(document.getElementById('setShowWeekend')?.checked)
    };
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
        btnCopyTopic.addEventListener('click', () => {
            const topic = String(document.getElementById('setNtfyTopic')?.value || '').trim();
            if (!topic) {
                setSettingsBanner('err', 'Enter or generate a topic first before copying.');
                return;
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(topic).then(() => {
                    const prev = btnCopyTopic.textContent;
                    btnCopyTopic.textContent = 'Copied!';
                    setTimeout(() => { btnCopyTopic.textContent = prev; }, 1400);
                }).catch(() => {
                    prompt('Copy your private ntfy topic:', topic);
                });
            } else {
                prompt('Copy your private ntfy topic:', topic);
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
                setSettingsBanner('err', 'Enable phone notifications and set a private ntfy topic (8+ chars) first.');
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
                } catch (err) {
                    setSettingsBanner('err', 'Failed to send test push: ' + err.message);
                }
            }, { loadingText: 'Sending...' });
        });
    }

    if (btnSetE2ee) {
        btnSetE2ee.addEventListener('click', () => {
            const newKey = prompt('🔒 Enter your 32-character E2EE secret key (stored only in this browser):');
            if (newKey === null) return;
            if (newKey.length !== 32) {
                setSettingsBanner('err', 'Canceled: Key must be exactly 32 characters long.');
                return;
            }
            localStorage.setItem('diario_llave_secreta', newKey);
            updateE2eeKeyStatusUI();
            setSettingsBanner('ok', 'E2EE secret key updated on this browser.');
        });
    }

    if (btnClearE2ee) {
        btnClearE2ee.addEventListener('click', () => {
            if (!confirm('Remove the local 32-character E2EE key from this browser?')) return;
            localStorage.removeItem('diario_llave_secreta');
            updateE2eeKeyStatusUI();
            setSettingsBanner('ok', 'Local E2EE key cleared from this browser.');
        });
    }

    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!btnSaveSettings) return;
        const payload = collectSettingsFormPayload();

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
                setSettingsBanner('ok', resData.message || 'Settings saved successfully.');
                cargarRecordatoriosActivos();
            } catch (err) {
                setSettingsBanner('err', 'Error saving settings: ' + err.message);
            }
        }, { loadingText: 'Saving...' });
    });
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
