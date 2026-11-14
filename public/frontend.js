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
const VALID_VIEWS = new Set(['inicio', 'mood', 'sueno', 'journal', 'english', 'agenda', 'resumen', 'medico']);
let currentUser = null;
let sundayWatcherInterval = null;
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
            const completadas = items.filter(i => Number(i.completada) === 1).length;
            const summary = document.createElement('p');
            summary.style.margin = '0';
            summary.innerHTML = `<strong>${completadas} of ${items.length}</strong> activities completed today.`;
            agendaBox.appendChild(summary);

            const ul = document.createElement('ul');
            ul.className = 'home-agenda-list';
            items.slice(0, 4).forEach(item => {
                const li = document.createElement('li');
                if (Number(item.completada) === 1) li.className = 'done';
                const timeSpan = document.createElement('strong');
                timeSpan.textContent = item.hora;
                const textSpan = document.createElement('span');
                textSpan.textContent = item.actividad;
                li.append(timeSpan, textSpan);
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
        const safeCat = sectionConfig[cat] ? cat : 'vocabulary';
        if (categoryInput) categoryInput.value = safeCat;

        tabButtons.forEach(btn => {
            const active = btn.getAttribute('data-english-cat') === safeCat;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', String(active));
        });

        Object.entries(sectionConfig).forEach(([key, cfg]) => {
            const isTarget = key === safeCat;
            const fs = document.getElementById(cfg.fieldsetId);
            if (fs) fs.hidden = !isTarget;
            cfg.requiredIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.required = isTarget;
            });
        });

        if (statusBanner) statusBanner.hidden = true;
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
    items: []
};

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
    const row = document.createElement('div');
    row.className = `agenda-item${Number(item.completada) === 1 ? ' is-done' : ''}`;

    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'agenda-check-circle';
    checkBtn.setAttribute('aria-label', Number(item.completada) === 1 ? 'Mark as pending' : 'Mark as completed');
    checkBtn.textContent = Number(item.completada) === 1 ? '✓' : '';

    const content = document.createElement('div');
    content.className = 'agenda-item-content';

    const timePill = document.createElement('span');
    timePill.className = 'agenda-time-pill';
    timePill.textContent = item.hora;

    const text = document.createElement('span');
    text.className = 'agenda-item-text';
    text.textContent = item.actividad;

    content.append(timePill, text);

    const actions = document.createElement('div');
    actions.className = 'agenda-item-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'agenda-mini-btn';
    editBtn.title = 'Edit activity';
    editBtn.setAttribute('aria-label', 'Edit activity');
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', () => abrirAgendaModal(item));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'agenda-mini-btn';
    delBtn.title = 'Delete activity';
    delBtn.setAttribute('aria-label', 'Delete activity');
    delBtn.textContent = '🗑️';

    const uiRefs = { row, checkBtn, editBtn, delBtn };
    checkBtn.addEventListener('click', () => toggleAgendaItem(item, uiRefs));
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
    const visibleItems = agendaState.items.filter(i => visibleDatesSet.has(i.fecha));
    const completadas = visibleItems.filter(i => Number(i.completada) === 1).length;
    if (weekStats) {
        weekStats.textContent = visibleItems.length
            ? `Weekly progress: ${completadas} of ${visibleItems.length} activities completed`
            : 'Organize your activities and schedule by time of day';
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

    // 1. Day View (mobile / focus mode)
    if (isDayLayout) {
        dayTabs.innerHTML = '';
        diasVisibles.forEach(dia => {
            const count = agendaState.items.filter(i => i.fecha === dia.fecha).length;
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
            const blockItems = agendaState.items.filter(
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
                empty.textContent = 'No activities scheduled';
                body.appendChild(empty);
            } else {
                blockItems.forEach(item => body.appendChild(crearElementoActividad(item)));
            }

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'agenda-cell-add';
            addBtn.textContent = `+ Add to ${bloque.label.toLowerCase()}`;
            addBtn.addEventListener('click', () => abrirAgendaModal({
                fecha: activeDay.fecha,
                bloque: bloque.id,
                hora: bloque.defaultHora
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

            const cellItems = agendaState.items.filter(
                i => i.fecha === dia.fecha && i.bloque === bloque.id
            );

            cellItems.forEach(item => list.appendChild(crearElementoActividad(item)));

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'agenda-cell-add';
            addBtn.textContent = '+ Add';
            addBtn.addEventListener('click', () => abrirAgendaModal({
                fecha: dia.fecha,
                bloque: bloque.id,
                hora: bloque.defaultHora
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

function toggleAgendaItem(item, ui = {}) {
    const nuevoEstado = Number(item.completada) === 1 ? 0 : 1;
    const lockBtn = ui.checkBtn || ui.row || document.createElement('button');
    runWithButtonLock(lockBtn, async () => {
        try {
            await submitMutationRequest({
                url: `/api/toggle-agenda/${item.id}`,
                method: 'PATCH',
                scopeKey: `agenda-toggle:${item.id}`,
                signature: String(nuevoEstado),
                buildBody: () => ({ completada: nuevoEstado }),
                parseJson: true
            });
            item.completada = nuevoEstado;
            renderAgendaBoard();
        } catch (err) {
            alert('Failed to update activity status: ' + err.message);
        }
    }, { extraDisable: [ui.row, ui.editBtn, ui.delBtn] });
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
        } catch (err) {
            alert('Failed to delete activity: ' + err.message);
        }
    }, { extraDisable: [ui.row, ui.checkBtn, ui.editBtn] });
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

    document.getElementById('agendaModalTitle').textContent = isEdit ? 'Edit Activity' : 'New Activity';
    document.getElementById('agendaEditId').value = isEdit ? String(prefill.id) : '';
    document.getElementById('agendaFecha').value = resolvedFecha;
    document.getElementById('agendaBloque').value = resolvedBloque;
    document.getElementById('agendaHora').value = resolvedHora;
    document.getElementById('agendaActividad').value = resolvedActividad;

    agendaOriginalSnapshot = isEdit
        ? { fecha: resolvedFecha, bloque: resolvedBloque, hora: resolvedHora, actividad: resolvedActividad.replace(/\s+/g, ' ') }
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
        const payload = {
            fecha: document.getElementById('agendaFecha').value,
            bloque: document.getElementById('agendaBloque').value,
            hora: String(document.getElementById('agendaHora').value || '').slice(0, 5),
            actividad: document.getElementById('agendaActividad').value.replace(/\s+/g, ' ').trim()
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
            payload.actividad === agendaOriginalSnapshot.actividad
        ) {
            cerrarAgendaModal();
            return;
        }

        const duplicateExists = agendaState.items.some(item =>
            String(item.id) !== String(editId || '') &&
            item.fecha === payload.fecha &&
            item.bloque === payload.bloque &&
            String(item.hora || '').slice(0, 5) === payload.hora &&
            String(item.actividad || '').trim().toLowerCase().replace(/\s+/g, ' ') === payload.actividad.toLowerCase()
        );
        if (duplicateExists) {
            alert('This exact activity is already scheduled for that date, block, and time.');
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
}

function initTheme() {
    const savedTheme = localStorage.getItem('mt_theme') || 'dark';
    applyTheme(savedTheme);

    ['btnThemeToggleAuth', 'btnThemeToggleMobile', 'btnThemeToggleSidebar'].forEach(id => {
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
// APP INITIALIZATION
// ==========================================
function initApp() {
    initTheme();
    actualizarCabecerasDeFecha();
    initPasswordToggles();
    initAuthHandlers();

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
