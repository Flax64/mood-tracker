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
                    titleEn: 'Crisis Log (Clinical)',
                    titleEs: 'Bitácora de Crisis (Clínica)',
                    flowEn: ['1. Tap ⏱️ Now + Type', '2. Intensity 1–5 + Spanish note', '3. Press Ctrl + Enter'],
                    flowEs: ['1. Toca ⏱️ Ahora + Tipo', '2. Intensidad 1–5 + motivo', '3. Presiona Ctrl + Enter'],
                    targetView: 'crisis',
                    tagEn: 'Read-only visible for doctor',
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
                    icon: '📘',
                    titleEn: 'Language Studio + AI',
                    titleEs: 'Estudio de Idiomas + IA',
                    flowEn: ['1. Glossary / Grammar / Phrasal Verbs', '2. Gemini AI or 0-RAM Local Hangul', '3. Auto-creates Word notebook + TOC'],
                    flowEs: ['1. Glosario / Gramática / Phrasal Verbs', '2. IA Gemini o Hangul Local sin RAM', '3. Crea Word de idiomas automático + Índice'],
                    targetView: 'english',
                    tagEn: 'Auto-creates .docx if missing!',
                    tagEs: '¡Crea el .docx si no existe!'
                },
                {
                    icon: '🎧',
                    titleEn: 'Music, yt-dlp & Word Lyrics',
                    titleEs: 'Música, yt-dlp y Letras en Word',
                    flowEn: ['1. Group by Artist & Album / Track #', '2. Click Load Lyrics -> PC reads Word/yt-dlp', '3. AI breakdowns auto-file under Album'],
                    flowEs: ['1. Agrupa por Artista, Álbum y Pista', '2. Cargar Letra -> PC lee Word/yt-dlp', '3. IA guarda análisis bajo su Álbum'],
                    targetView: 'english',
                    tagEn: '0 KB lyrics stored on EC2/MySQL',
                    tagEs: '0 KB de letras guardadas en la nube'
                },
                {
                    icon: '🌐',
                    titleEn: 'Floating Translator (Alt+T)',
                    titleEs: 'Traductor Flotante (Alt+T)',
                    flowEn: ['1. Press Alt+T anywhere or drag window', '2. EN↔ES · KO↔EN/ES + Romanization', '3. Click Window 🪟 for Chrome/YT dock'],
                    flowEs: ['1. Presiona Alt+T o arrastra cabecera', '2. EN↔ES · KO↔EN/ES + Romanización', '3. Ventana 🪟 aparte junto a YouTube'],
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
                    titleEn: 'Weekly Agenda & Class Tasks',
                    titleEs: 'Agenda Semanal y Tareas por Clase',
                    flowEn: ['1. Link Uni tasks to current ITS class', '2. Card badge shows the class name', '3. 1-click cycle: To Do -> Doing -> Done'],
                    flowEs: ['1. Vincula tareas Univ a tu clase actual', '2. La etiqueta muestra el nombre de la clase', '3. Flujo: Por hacer -> Progreso -> Hecho'],
                    targetView: 'agenda',
                    tagEn: 'Filter by class & ntfy alerts',
                    tagEs: 'Filtro por clase y alertas ntfy'
                },
                {
                    icon: '🏫',
                    titleEn: 'ITS Classes & Croquis Map',
                    titleEs: 'Clases ITS y Croquis Campus',
                    flowEn: ['1. Type room (R11, N21, A10, S15)', '2. Auto-detects CTO-002 / 003 / 004', '3. Pauses alerts during Vacations'],
                    flowEs: ['1. Escribe salón (R11, N21, A10, S15)', '2. Detecta campus CTO-002 / 003 / 004', '3. Pausa alertas en Vacaciones'],
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
            badgeEn: 'Security, Wire X25519 & PC',
            badgeEs: 'Seguridad, Túnel X25519 y PC',
            icon: '🔐',
            color: '#f59e0b',
            cards: [
                {
                    icon: '🛡️',
                    titleEn: 'Double Encryption Shield',
                    titleEs: 'Doble Capa de Cifrado',
                    flowEn: ['1. Transport: X25519 + AES-256-CTR', '2. Vault E2EE: Browser -> PC Word key', '3. EC2 RAM holds queue if PC offline'],
                    flowEs: ['1. Red HTTP: X25519 + AES-256-CTR', '2. E2EE: Llave de 32 chars (solo tuya)', '3. Cola segura en RAM EC2 si PC apagada'],
                    targetView: 'settings',
                    tagEn: 'Check live packets in Settings',
                    tagEs: 'Inspecciona paquetes en Ajustes'
                },
                {
                    icon: '⚙️',
                    titleEn: 'PC Python Sync & Paths',
                    titleEs: 'Python en PC y Rutas Word',
                    flowEn: ['1. Auto-reads EC2_HOST + YT_DLP_PATH', '2. Auto-reads WORD_FILE_PATH from GitHub', '3. DPAPI Windows Startup -> no password prompt'],
                    flowEs: ['1. Lee EC2_HOST + YT_DLP_PATH de GitHub', '2. Lee rutas Word si mueves archivos', '3. Autoinicio DPAPI sin pedir clave al prender'],
                    targetView: 'settings',
                    tagEn: 'English .docx auto-creates if missing',
                    tagEs: 'Crea Word de idiomas si no existe'
                },
                {
                    icon: '📱',
                    titleEn: 'Phone Alerts (ntfy) & EN/ES',
                    titleEs: 'Notificaciones ntfy e Idioma EN/ES',
                    flowEn: ['1. Subscribe private topic on Android', '2. Always Dark Mode (0 eye strain)', '3. Instant EN <-> ES switch anywhere'],
                    flowEs: ['1. Suscríbete al topic privado en Android', '2. Modo Oscuro Permanente integrado', '3. Cambia EN <-> ES en todo el sistema'],
                    targetView: 'settings',
                    tagEn: 'Syncs across tabs & mini window',
                    tagEs: 'Sincroniza pestañas y mini ventana'
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
                title: tr('1. Browser / Phone', '1. Navegador / Celular'),
                sub: tr('UI Dark + EN/ES · E2EE 32-char lock', 'Oscuro + EN/ES · Cifrado E2EE 32 chars')
            },
            {
                arrow: true,
                label: 'X25519 + AES'
            },
            {
                icon: '☁️',
                title: tr('2. EC2 + MySQL + Gemini', '2. EC2 + MySQL + Gemini'),
                sub: tr('Metadata, Mood, Sleep & encrypted RAM queue', 'Metadatos, Ánimo, Sueño y cola RAM cifrada')
            },
            {
                arrow: true,
                label: 'E2EE Pull'
            },
            {
                icon: '💻',
                title: tr('3. PC Python Sync', '3. Python Local en PC'),
                sub: tr('Auto yt-dlp + creates/updates Word (.docx)', 'Ejecuta yt-dlp + crea/actualiza tus Word (.docx)')
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
                        } else {
                            var fab = document.getElementById('btnFloatingTranslatorFab');
                            if (fab) fab.click();
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
        pyCard.appendChild(el('h4', '', tr('🐍 Local PC Python & Word Facts', '🐍 Python Local y Archivos Word')));
        var pyUl = el('ul', 'vg-facts-list');
        [
            tr('English_Learning_Notebook.docx auto-creates on PC if missing (with Table of Contents + 4 sections).', 'English_Learning_Notebook.docx se crea solo en tu PC si no existe (con Índice y 4 secciones).'),
            tr('Journal Word keeps your existing file & WORD_PASSWORD protection.', 'Tu Diario Word conserva tu archivo protegido con WORD_PASSWORD.'),
            tr('Moving either Word file? Just update WORD_FILE_PATH / ENGLISH_WORD_FILE_PATH in GitHub Variables.', '¿Moviste un archivo Word? Solo actualiza WORD_FILE_PATH / ENGLISH_WORD_FILE_PATH en GitHub Variables.'),
            tr('Full text docs: see guides/MANUAL_DE_USUARIO.md in repo.', 'Manual extendido completo: consulta guides/MANUAL_DE_USUARIO.md en el repositorio.')
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
