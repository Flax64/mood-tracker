/* ==========================================================================
   public/guia-visual.js — Visual-First Interactive Guide (EN <-> ES · Dark)
   Renders scannable diagrams, color keys, shortcut chips, and 3-step cards
   inside #view-guia (SPA) OR standalone public/guia-visual.html.
   ========================================================================== */
(function (root) {
    'use strict';

    var activeCategory = 'all';

    function tr(en, es) {
        if (root.DailyHubI18n && typeof root.DailyHubI18n.pick === 'function') {
            return root.DailyHubI18n.pick(en, es);
        }
        return en;
    }

    var SECTIONS = [
        {
            id: 'health',
            badgeEn: 'Daily Wellness & Clinician',
            badgeEs: 'Salud Diaria y Psiquiatra',
            icon: '🧠',
            color: '#60a5fa',
            cards: [
                {
                    icon: '🎭',
                    titleEn: 'Mood Tracker (5 Blocks)',
                    titleEs: 'Estado de Ánimo (5 Bloques)',
                    flowEn: ['1. Pick Block (or tap alert)', '2. Tap 1 of 16 colors', '3. Save before window closes'],
                    flowEs: ['1. Elige bloque (o toca alerta)', '2. Toca 1 de 16 colores', '3. Guarda en el bloque activo'],
                    targetView: 'mood',
                    tagEn: 'Auto-synced with Weekly Grid',
                    tagEs: 'Sincroniza en Matriz Semanal'
                },
                {
                    icon: '⚠️',
                    titleEn: 'Compact Crisis Log (250 chars)',
                    titleEs: 'Bitácora de Crisis Compacta',
                    flowEn: ['1. Tap ⏱️ Now + emotion (or "Other") + 1–5', '2. Optional Spanish trigger (max 250 chars)', '3. Read-only visible to psychiatrist'],
                    flowEs: ['1. Elige fecha/hora (⏱️ Ahora), emoción (u Otro) y 1–5', '2. Descripción opcional máx. 250 caracteres (Ctrl+Enter)', '3. Visible en solo lectura para psiquiatra/psicóloga'],
                    targetView: 'crisis',
                    tagEn: 'Ctrl + Enter saves instantly',
                    tagEs: 'Solo lectura para especialista'
                },
                {
                    icon: '🦉',
                    titleEn: 'Sleep & Desvelo Tracker',
                    titleEs: 'Sueño y Desvelos (Madrugada)',
                    flowEn: ['1. Regular / 3 AM Desvelo / 0 hrs', '2. Bedtime 1–5:59 AM auto-flags 🦉', '3. "Sleeping now" -> finish at wake'],
                    flowEs: ['1. Normal / Desvelo 3 AM / 0 hrs', '2. 1–5:59 AM activa 🦉 automático', '3. "Durmiendo ahora" -> cierra al despertar'],
                    targetView: 'sueno',
                    tagEn: 'Intervals summed automatically',
                    tagEs: 'Suma intervalos en un día'
                },
                {
                    icon: '📈',
                    titleEn: 'Clinician Visual Calendar & History',
                    titleEs: 'Calendario Médico Visual e Historial',
                    flowEn: ['1. Pick exact day or Mon–Sun / Sun–Sat week', '2. All local history loads immediately from server DB', '3. Query months or years across local & cloud archive'],
                    flowEs: ['1. Elige un día exacto o semana Lun–Dom / Dom–Sáb', '2. Todo tu historial local carga al instante desde tu BD', '3. Consulta meses o años combinando histórico local y Drive'],
                    targetView: 'resumen',
                    tagEn: 'Visual week range without combobox',
                    tagEs: 'Calendario interactivo visual'
                },
                {
                    icon: '🩺',
                    titleEn: 'Psychiatrist Read-Only',
                    titleEs: 'Vista Psiquiatra Solo Lectura',
                    flowEn: ['1. Create doctor login in Access', '2. Doctor sees Mood + Sleep + Crisis', '3. Journal / Agenda stay 100% hidden'],
                    flowEs: ['1. Crea cuenta en Acceso Psiquiatra', '2. Ve solo Ánimo + Sueño + Crisis', '3. Diario y Agenda 100% ocultos'],
                    targetView: 'medico',
                    tagEn: 'HTTP 403 locked on private data',
                    tagEs: 'Bloqueo 403 en datos privados'
                }
            ]
        },
        {
            id: 'journal_lang',
            badgeEn: 'Word E2EE & Languages',
            badgeEs: 'Word Cifrado e Idiomas',
            icon: '🎵',
            color: '#34d399',
            cards: [
                {
                    icon: '✍️',
                    titleEn: 'Journal -> Encrypted Word',
                    titleEs: 'Diario -> Word Protegido',
                    flowEn: ['1. Write in English (auto-proofing)', '2. Encrypts with 32-char AES key', '3. PC Python appends to protected .docx'],
                    flowEs: ['1. Escribe en inglés (corrector)', '2. Cifra en navegador (AES 32 chars)', '3. Python en PC escribe en tu Word'],
                    targetView: 'journal',
                    tagEn: 'Requires existing password .docx',
                    tagEs: 'Usa tu archivo .docx protegido'
                },
                {
                    icon: '🎯',
                    titleEn: '15m Sequential Course & Voice',
                    titleEs: 'Curso Secuencial (15m) y Pronunciación',
                    flowEn: ['1. Priority: 1st EN->ES & 2nd KO->EN', '2. Complete Word practice to unlock next', '3. Tap 🎤 Practice Pronunciation with mic'],
                    flowEs: ['1. Prioridad: 1° Inglés (EN→ES) y 2° Coreano (KO→EN)', '2. Completa la práctica en Word para desbloquear', '3. Usa 🎤 Practicar Pronunciación con micrófono'],
                    targetView: 'english',
                    tagEn: 'Auto-creates Word + TOC',
                    tagEs: 'Crea Word e Índice automático'
                },
                {
                    icon: '📂',
                    titleEn: 'Win11 Music Folders & Read-Only Lyrics',
                    titleEs: 'Carpetas Musicales Win11 y Letras',
                    flowEn: ['1. Folders: Artist → Album → Song', '2. Extract Lyrics loads from Cloud / Word / PC & splits langs', '3. Translate ES / AI Stanzas saves to Word + Drive'],
                    flowEs: ['1. Carpeta Artista → carpeta Álbum → canción', '2. Extraer letra carga desde Nube / Word / PC y divide idiomas', '3. Traducir ES / Estrofas IA guarda en Word y Drive'],
                    targetView: 'english',
                    tagEn: '0 KB lyrics in DB · gdrive:NotasIdiomas',
                    tagEs: '0 KB en BD · Respaldo gdrive:NotasIdiomas'
                },
                {
                    icon: '🌐',
                    titleEn: 'Floating Translator (Alt+T & Select Text)',
                    titleEs: 'Traductor Flotante (Alt+T y Seleccionar Texto)',
                    flowEn: ['1. Select any text anywhere or press Alt+T', '2. EN↔ES · KO↔EN/ES · JP↔EN/ES + Romanization / Romaji', '3. Click Window 🪟 for Chrome/YT dock'],
                    flowEs: ['1. Selecciona cualquier texto en la app o presiona Alt+T', '2. EN↔ES · KO↔EN/ES · JP↔EN/ES + Romanización / Romaji', '3. Ventana 🪟 aparte junto a YouTube'],
                    targetAction: 'translator',
                    tagEn: 'Remembers position on screen',
                    tagEs: 'Recuerda su posición al moverlo'
                }
            ]
        },
        {
            id: 'planner_gps',
            badgeEn: 'ITS Schedule, Agenda & GPS',
            badgeEs: 'Horario ITS, Agenda y GPS',
            icon: '🎓',
            color: '#a78bfa',
            cards: [
                {
                    icon: '🗓️',
                    titleEn: 'Repetitive Agenda & Long Projects',
                    titleEs: 'Agenda Repetitiva y Proyectos Largos',
                    flowEn: ['1. Standard, Long Projects (1–7d) or Language', '2. Repeat every X days (up to 12 sessions)', '3. 1-click cycle: To Do -> Doing -> Done'],
                    flowEs: ['1. Estándar, Proyectos Largos (1–7d) o Idiomas', '2. Repite cada X días (hasta 12 sesiones)', '3. Flujo: Por hacer → Progreso → Hecho'],
                    targetView: 'agenda',
                    tagEn: 'Unified auto-resize textboxes',
                    tagEs: 'Cajas de texto auto-ajustables'
                },
                {
                    icon: '🏫',
                    titleEn: 'ITS Classes & Boulevard Coords',
                    titleEs: 'Clases ITS y Campus sobre Bulevar',
                    flowEn: ['1. Type room (R02, R11, N21, A10, S15)', '2. Exact boulevard coords (CTO-002/003/004)', '3. Real-time traffic ntfy + Snooze 15m/30m'],
                    flowEs: ['1. Escribe salón (R02, R11, N21, A10, S15)', '2. Campus exacto en bulevar (CTO-002/003/004)', '3. Alertas ntfy con Snooze 15m / 30m'],
                    targetView: 'horario',
                    tagEn: '1-click Sync Week -> Agenda',
                    tagEs: 'Sincroniza Semana -> Agenda en 1 clic'
                },
                {
                    icon: '🚗',
                    titleEn: 'Residencias, Work & Commute',
                    titleEs: 'Residencias, Trabajo y Tráfico',
                    flowEn: ['1. Save Home + Maps link', '2. OPPO A79 GPS via ntfy or Webhook', '3. 30+ min far alert / 10 min on campus'],
                    flowEs: ['1. Guarda Casa + enlace Maps', '2. GPS OPPO A79 vía ntfy o Webhook', '3. Avisa 30+ min lejos / 10 min en ITS'],
                    targetView: 'horario',
                    tagEn: '500h TecNM Residency bar included',
                    tagEs: 'Incluye barra 500h Residencias'
                }
            ]
        },
        {
            id: 'security_pc',
            badgeEn: 'Privacy, Security & PC Sync',
            badgeEs: 'Privacidad, Seguridad y PC',
            icon: '🔐',
            color: '#f59e0b',
            cards: [
                {
                    icon: '🛡️',
                    titleEn: 'End-to-End Privacy Shield',
                    titleEs: 'Doble Capa de Cifrado Privado',
                    flowEn: ['1. Private encrypted transport', '2. Personal 32-char lock -> Word only', '3. Safe sync queue when PC wakes up'],
                    flowEs: ['1. Conexión cifrada de extremo a extremo', '2. Llave personal de 32 caracteres para tus notas', '3. Sincronización segura automática al encender tu PC'],
                    targetView: 'settings',
                    tagEn: 'Check live protection in Settings',
                    tagEs: 'Consulta tu seguridad en Configuración'
                },
                {
                    icon: '⚙️',
                    titleEn: 'PC Companion & Automatic Word Sync',
                    titleEs: 'Sincronización Automática con Word en PC',
                    flowEn: ['1. Connects via environment variables (no hardcoded IPs)', '2. Organizes Language Word automatically', '3. Auto-starts cleanly on Windows login'],
                    flowEs: ['1. Se conecta de forma segura sin configuraciones manuales', '2. Ordena tu cuaderno de idiomas por bloques en Word', '3. Inicia automático al encender Windows sin pedir clave'],
                    targetView: 'settings',
                    tagEn: 'Auto-creates notebook if missing',
                    tagEs: 'Crea cuaderno de idiomas si no existe'
                },
                {
                    icon: '📱',
                    titleEn: 'Single-Tab Guard, Alerts & Dual Drive',
                    titleEs: 'Pestaña Única, Alertas y Doble Respaldo',
                    flowEn: ['1. 1 active tab + notification reuses it', '2. Snooze 15m/30m reminders', '3. Dual Drive: Clinical DB vs Study Word only'],
                    flowEs: ['1. 1 pestaña activa reutilizable desde avisos', '2. Recordatorios posponibles 15m/30m', '3. Drive 1 (Clínico) separado de Drive 2 (Cuaderno Idiomas)'],
                    targetView: 'settings',
                    tagEn: 'Dark Mode EN/ES · Dual Drive isolated',
                    tagEs: 'Modo Oscuro EN/ES · Drives independientes'
                },
                {
                    icon: '🏷️',
                    titleEn: 'Auto SemVer 2.0.0 Releases',
                    titleEs: 'Historial Automático SemVer 2.0.0',
                    flowEn: ['1. fix -> +0.0.1 · feat -> +0.1.0', '2. Every deploy creates tag & changelog', '3. Click sidebar badge or Settings'],
                    flowEs: ['1. fix -> +0.0.1 · feat -> +0.1.0', '2. Cada deploy crea tag + changelog', '3. Abre desde barra lateral o Ajustes'],
                    targetView: 'settings',
                    tagEn: 'Zero-effort deploy history',
                    tagEs: 'Control automático en cada deploy'
                }
            ]
        }
    ];

    var SHORTCUTS = [
        { key: 'Alt + T', en: 'Open / close floating Translator everywhere', es: 'Abrir / cerrar Traductor flotante donde sea' },
        { key: 'Ctrl + Enter', en: 'Quick save in Crisis Log box', es: 'Guardar rápido en Bitácora de Crisis' },
        { key: 'Enter / Shift+Enter', en: 'Translate / Ask AI (new line with Shift)', es: 'Traducir / Preguntar a IA (nueva línea con Shift)' },
        { key: '🌐 EN / ES', en: 'Instant full-system bilingual switch', es: 'Cambio total de idioma inglés/español' }
    ];

    function el(tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function buildArchitectureFlow() {
        var flow = el('div', 'vg-arch-flow');
        var steps = [
            {
                icon: '🌐',
                title: tr('1. Phone / Browser', '1. Celular / Navegador'),
                sub: tr('Dark UI + EN/ES · Private 32-char lock', 'Oscuro + EN/ES · Protección privada 32 chars')
            },
            {
                arrow: true,
                label: tr('Encrypted', 'Cifrado')
            },
            {
                icon: '☁️',
                title: tr('2. Cloud Hub + Gemini', '2. Nube Privada + Gemini'),
                sub: tr('Mood, Sleep, Agenda & smart tutor', 'Ánimo, Sueño, Agenda y tutor inteligente')
            },
            {
                arrow: true,
                label: tr('Private Sync', 'Sync Seguro')
            },
            {
                icon: '💻',
                title: tr('3. PC Companion', '3. Tu Computadora'),
                sub: tr('Auto lyrics extraction & organized Word notebook', 'Extrae letras y organiza tu cuaderno Word')
            }
        ];

        steps.forEach(function (st) {
            if (st.arrow) {
                var arr = el('div', 'vg-flow-arrow');
                arr.appendChild(el('span', 'vg-flow-badge', st.label));
                arr.appendChild(el('span', 'vg-flow-chevron', '➔'));
                flow.appendChild(arr);
            } else {
                var box = el('div', 'vg-flow-node');
                box.appendChild(el('div', 'vg-flow-icon', st.icon));
                box.appendChild(el('strong', 'vg-flow-title', st.title));
                box.appendChild(el('span', 'vg-flow-sub', st.sub));
                flow.appendChild(box);
            }
        });
        return flow;
    }

    function render(container, opts) {
        if (!container) return;
        var options = opts || {};
        var isStandalone = Boolean(options.standalone);
        container.innerHTML = '';

        var rootWrap = el('div', 'vg-root');

        // Hero Banner (Visual, minimal text)
        var hero = el('div', 'vg-hero-card');
        var heroLeft = el('div', 'vg-hero-left');
        heroLeft.appendChild(el('span', 'vg-kicker', tr('⚡ VISUAL CHEAT SHEET · NO WALLS OF TEXT', '⚡ GUÍA VISUAL RÁPIDA · CERO TEXTOS LARGOS')));
        heroLeft.appendChild(el('h2', 'vg-title', tr('How Personal Daily Hub Works in 30 Seconds', 'Cómo funciona Personal Daily Hub en 30 segundos')));
        heroLeft.appendChild(el('p', 'vg-sub', tr('Tap any visual card to jump straight to that tool. Dark mode is permanent and EN/ES switches everything live.', 'Toca cualquier tarjeta para ir directo al módulo. Modo oscuro permanente e idioma EN/ES en tiempo real.')));
        hero.appendChild(heroLeft);

        var heroActions = el('div', 'vg-hero-actions');
        if (!isStandalone) {
            var popLink = el('a', 'btn-secondary btn-small vg-open-link', tr('🪟 Open Standalone Page', '🪟 Abrir en Pestaña Aparte'));
            popLink.href = 'guia-visual.html';
            popLink.target = '_blank';
            popLink.rel = 'noopener noreferrer';
            heroActions.appendChild(popLink);
        } else {
            var backHub = el('a', 'btn-primary btn-small vg-open-link', tr('🏠 Open Daily Hub', '🏠 Abrir Daily Hub'));
            backHub.href = '/#inicio';
            heroActions.appendChild(backHub);

            var langBtn = el('button', 'lang-toggle-pill', tr('🌐 EN · English', '🌐 ES · Español'));
            langBtn.type = 'button';
            langBtn.addEventListener('click', function () {
                if (root.DailyHubI18n) root.DailyHubI18n.toggleLang();
            });
            heroActions.appendChild(langBtn);
        }
        hero.appendChild(heroActions);
        rootWrap.appendChild(hero);

        // Visual Architecture Flow Diagram
        rootWrap.appendChild(buildArchitectureFlow());

        // Interactive Category Filter Bar
        var filterBar = el('div', 'vg-filter-bar');
        var allBtn = el('button', 'vg-filter-pill' + (activeCategory === 'all' ? ' active' : ''), tr('🌟 All Modules', '🌟 Todo el Sistema'));
        allBtn.type = 'button';
        allBtn.addEventListener('click', function () {
            activeCategory = 'all';
            render(container, opts);
        });
        filterBar.appendChild(allBtn);

        SECTIONS.forEach(function (sec) {
            var btn = el('button', 'vg-filter-pill' + (activeCategory === sec.id ? ' active' : ''), sec.icon + ' ' + tr(sec.badgeEn, sec.badgeEs));
            btn.type = 'button';
            btn.addEventListener('click', function () {
                activeCategory = sec.id;
                render(container, opts);
            });
            filterBar.appendChild(btn);
        });
        rootWrap.appendChild(filterBar);

        // Visual Card Groups
        var visibleSections = activeCategory === 'all'
            ? SECTIONS
            : SECTIONS.filter(function (s) { return s.id === activeCategory; });

        visibleSections.forEach(function (sec) {
            var secWrap = el('div', 'vg-section-block');
            var secHead = el('div', 'vg-section-head');
            var dot = el('span', 'vg-section-dot');
            dot.style.backgroundColor = sec.color;
            secHead.appendChild(dot);
            secHead.appendChild(el('h3', '', sec.icon + ' ' + tr(sec.badgeEn, sec.badgeEs)));
            secWrap.appendChild(secHead);

            var grid = el('div', 'vg-cards-grid');
            sec.cards.forEach(function (card) {
                var c = el('article', 'vg-feature-card');
                c.style.borderTopColor = sec.color;

                var cTop = el('div', 'vg-card-top');
                cTop.appendChild(el('span', 'vg-card-icon', card.icon));
                cTop.appendChild(el('h4', 'vg-card-title', tr(card.titleEn, card.titleEs)));
                c.appendChild(cTop);

                var stepsList = el('ul', 'vg-steps-list');
                var flow = root.DailyHubI18n && root.DailyHubI18n.getLang() === 'es' ? card.flowEs : card.flowEn;
                flow.forEach(function (step) {
                    stepsList.appendChild(el('li', '', step));
                });
                c.appendChild(stepsList);

                var footer = el('div', 'vg-card-footer');
                footer.appendChild(el('span', 'vg-tag-chip', tr(card.tagEn, card.tagEs)));

                var goBtn = el('button', 'vg-go-btn', tr('Open →', 'Ir →'));
                goBtn.type = 'button';
                goBtn.addEventListener('click', function () {
                    if (card.targetAction === 'translator') {
                        if (isStandalone) {
                            root.location.href = '/translator-popup.html';
                        } else if (typeof root.DailyHubOpenTranslator === 'function') {
                            root.DailyHubOpenTranslator({ toggle: false });
                        } else {
                            var navTr = document.getElementById('btnMobileTranslator') || document.getElementById('btnSidebarOpenTranslator');
                            if (navTr) navTr.click();
                        }
                        return;
                    }
                    if (isStandalone) {
                        root.location.href = '/#' + (card.targetView || 'inicio');
                        return;
                    }
                    if (typeof root.DailyHubNavigateView === 'function') {
                        root.DailyHubNavigateView(card.targetView || 'inicio');
                    } else {
                        var navBtn = document.querySelector('.nav-item[data-view="' + card.targetView + '"]');
                        if (navBtn) navBtn.click();
                    }
                });
                footer.appendChild(goBtn);
                c.appendChild(footer);
                grid.appendChild(c);
            });
            secWrap.appendChild(grid);
            rootWrap.appendChild(secWrap);
        });

        // Bottom Strip: Keyboard Shortcuts + Quick Word & Python Facts
        var bottomGrid = el('div', 'vg-bottom-grid');

        var keysCard = el('div', 'vg-mini-panel');
        keysCard.appendChild(el('h4', '', tr('⌨️ Quick Shortcuts', '⌨️ Atajos Rápidos')));
        var keysList = el('div', 'vg-keys-list');
        SHORTCUTS.forEach(function (sc) {
            var row = el('div', 'vg-key-row');
            row.appendChild(el('kbd', 'vg-kbd', sc.key));
            row.appendChild(el('span', '', tr(sc.en, sc.es)));
            keysList.appendChild(row);
        });
        keysCard.appendChild(keysList);
        bottomGrid.appendChild(keysCard);

        var pyCard = el('div', 'vg-mini-panel');
        pyCard.appendChild(el('h4', '', tr('📄 Private Word & Backup Facts', '📄 Cuaderno Word y Respaldos')));
        var pyUl = el('ul', 'vg-facts-list');
        [
            tr('Your Language Notebook stays synced automatically whenever updated on your computer.', 'Tu Cuaderno de Idiomas se sincroniza automáticamente cada vez que cambia en tu computadora.'),
            tr('Personal Journal stays strictly private on your computer.', 'Tu Diario Personal permanece estrictamente privado en tu computadora.'),
            tr('Single active tab prevents duplicates when opening notifications on mobile.', 'Una sola pestaña activa evita duplicados al abrir notificaciones en celular.'),
            tr('All local history loads immediately from your server database with unlimited local retention.', 'Todo tu historial local carga al instante desde tu base de datos local con retención ilimitada.'),
            tr('Visual Interactive Guide — tap any card above to open its tool directly.', 'Guía Visual Interactiva — toca cualquier tarjeta arriba para ir directo a esa función.')
        ].forEach(function (txt) {
            pyUl.appendChild(el('li', '', txt));
        });
        pyCard.appendChild(pyUl);
        bottomGrid.appendChild(pyCard);

        rootWrap.appendChild(bottomGrid);
        container.appendChild(rootWrap);
    }

    var mountedRegistry = [];

    function mount(targetElOrId, opts) {
        var elTarget = typeof targetElOrId === 'string'
            ? document.getElementById(targetElOrId)
            : targetElOrId;
        if (!elTarget) return;
        if (!mountedRegistry.some(function (x) { return x.el === elTarget; })) {
            mountedRegistry.push({ el: elTarget, opts: opts || {} });
        }
        render(elTarget, opts || {});
    }

    if (root.DailyHubI18n && typeof root.DailyHubI18n.onChange === 'function') {
        root.DailyHubI18n.onChange(function () {
            mountedRegistry.forEach(function (item) {
                if (item.el && item.el.isConnected !== false) {
                    render(item.el, item.opts);
                }
            });
        });
    }

    // Auto-mount if standalone host exists
    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', function () {
            var standaloneHost = document.getElementById('visualGuideStandaloneHost');
            if (standaloneHost) {
                mount(standaloneHost, { standalone: true });
            }
            var appHost = document.getElementById('visualGuideAppHost');
            if (appHost) {
                mount(appHost, { standalone: false });
            }
        });
    }

    root.DailyHubVisualGuide = {
        mount: mount,
        render: render,
        SECTIONS: SECTIONS
    };
})(typeof window !== 'undefined' ? window : globalThis);
