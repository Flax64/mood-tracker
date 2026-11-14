// ==========================================
// UTILIDADES GENERALES DE FECHA Y ESTADO
// ==========================================
function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getMomentoInfo(hour) {
    if (hour >= 0 && hour < 6) {
        return { moodKey: 'Madrugada', moodLabel: 'Madrugada', saludo: '¡Buenas madrugadas!', agendaBloque: 'noche' };
    }
    if (hour >= 6 && hour < 12) {
        return { moodKey: 'Morning', moodLabel: 'Mañana', saludo: '¡Buenos días!', agendaBloque: hour < 9 ? 'manana' : 'cole' };
    }
    if (hour >= 12 && hour < 14) {
        return { moodKey: 'Noon', moodLabel: 'Mediodía', saludo: '¡Buenas tardes!', agendaBloque: 'cole' };
    }
    if (hour >= 14 && hour < 20) {
        return { moodKey: 'Afternoon', moodLabel: 'Tarde', saludo: '¡Buenas tardes!', agendaBloque: 'tarde' };
    }
    return { moodKey: 'Night', moodLabel: 'Noche', saludo: '¡Buenas noches!', agendaBloque: 'noche' };
}

const MOMENTOS_ES = {
    Madrugada: 'Madrugada',
    Morning: 'Mañana',
    Noon: 'Mediodía',
    Afternoon: 'Tarde',
    Night: 'Noche'
};

const ESTADOS_ES = {
    Happy: 'Feliz',
    Calm: 'Tranquilo',
    Excited: 'Emocionado',
    Tired: 'Cansado',
    Sad: 'Triste',
    Angry: 'Enojado',
    Worried: 'Preocupado',
    Scared: 'Asustado',
    Focused: 'Enfocado',
    Motivated: 'Motivado',
    Stressed: 'Estresado',
    Frustrated: 'Frustrado',
    Bored: 'Aburrido',
    Anxious: 'Ansioso',
    Distracted: 'Distraído',
    Desperation: 'Desesperado'
};

// ==========================================
// NAVEGACIÓN PRINCIPAL Y BARRA LATERAL FIJA
// ==========================================
const VALID_VIEWS = new Set(['inicio', 'mood', 'sueno', 'journal', 'agenda', 'resumen', 'medico']);
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

    // Si es el psiquiatra (solo lectura), bloquear acceso a cualquier otra vista
    if (currentUser && currentUser.rol === 'psiquiatra') {
        targetView = 'resumen';
    }

    document.querySelectorAll('.app-view').forEach(section => {
        const isTarget = section.id === `view-${targetView}`;
        section.classList.toggle('active', isTarget);
        if (isTarget && mobileViewTitle) {
            mobileViewTitle.textContent = section.getAttribute('data-title') || 'Mood Tracker';
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
    // Estado guardado de barra lateral en PC
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

    // Grupos desplegables dentro de la barra lateral
    document.querySelectorAll('.nav-group-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const group = toggle.closest('.nav-group');
            if (!group) return;
            const willOpen = !group.classList.contains('open');
            group.classList.toggle('open', willOpen);
            toggle.setAttribute('aria-expanded', String(willOpen));
        });
    });

    // Botones del menú lateral
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            showView(btn.getAttribute('data-view'));
        });
    });

    // Accesos directos dentro de las vistas
    document.querySelectorAll('[data-go-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            showView(btn.getAttribute('data-go-view'));
        });
    });

    // Soporte de navegación por hash
    window.addEventListener('hashchange', () => {
        const hashView = window.location.hash.replace('#', '');
        if (VALID_VIEWS.has(hashView)) {
            showView(hashView, false);
        }
    });
}

// ==========================================
// LÓGICA DE INICIO (INTERFAZ PRINCIPAL)
// ==========================================
function actualizarCabecerasDeFecha() {
    const now = new Date();
    const info = getMomentoInfo(now.getHours());
    const fechaLarga = now.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
    const fechaCorta = now.toLocaleDateString('es-ES', {
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
    if (homeMomentBadge) homeMomentBadge.textContent = `Momento actual: ${info.moodLabel}`;
    if (sidebarMomentoActual) sidebarMomentoActual.textContent = `Momento: ${info.moodLabel}`;
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

    // 1. Mood de hoy
    fetch(`/api/get-moods?begin=${hoyStr}&end=${hoyStr}`)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('Error al consultar ánimo')))
        .then(registros => {
            moodBox.innerHTML = '';
            if (!registros.length) {
                const p = document.createElement('p');
                p.className = 'muted-text';
                p.textContent = 'Aún no registras tu estado de ánimo hoy.';
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
                txt.textContent = MOMENTOS_ES[r.momento_dia] || r.momento_dia;
                chip.append(dot, txt);
                wrap.appendChild(chip);
            });
            moodBox.appendChild(wrap);
        })
        .catch(() => {
            moodBox.innerHTML = '<p class="muted-text">No se pudo cargar el estado de ánimo.</p>';
        });

    // 2. Sueño de hoy
    fetch(`/api/get-sleep?begin=${hoyStr}&end=${hoyStr}`)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('Error al consultar sueño')))
        .then(registros => {
            sleepBox.innerHTML = '';
            if (!registros.length) {
                const p = document.createElement('p');
                p.className = 'muted-text';
                p.textContent = 'Sin registro de descanso el día de hoy.';
                sleepBox.appendChild(p);
                return;
            }
            const totalH = registros.reduce((acc, r) => acc + parseFloat(r.horas || 0), 0);
            const horasEnteras = Math.floor(totalH);
            const minutosRest = Math.round((totalH - horasEnteras) * 60);
            const p = document.createElement('p');
            p.style.margin = '0';
            p.innerHTML = `<strong>${horasEnteras}:${String(minutosRest).padStart(2, '0')} h</strong> registradas en ${registros.length} sesión(es).`;
            sleepBox.appendChild(p);
        })
        .catch(() => {
            sleepBox.innerHTML = '<p class="muted-text">No se pudo cargar el resumen de sueño.</p>';
        });

    // 3. Agenda de hoy
    fetch(`/api/get-agenda?begin=${hoyStr}&end=${hoyStr}`)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('Error al consultar agenda')))
        .then(items => {
            agendaBox.innerHTML = '';
            if (!items.length) {
                const p = document.createElement('p');
                p.className = 'muted-text';
                p.textContent = 'No tienes actividades programadas para hoy.';
                agendaBox.appendChild(p);
                return;
            }
            const completadas = items.filter(i => Number(i.completada) === 1).length;
            const summary = document.createElement('p');
            summary.style.margin = '0';
            summary.innerHTML = `<strong>${completadas} de ${items.length}</strong> actividades completadas hoy.`;
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
        .catch(() => {
            agendaBox.innerHTML = '<p class="muted-text">Agenda pendiente de sincronizar o sin tabla en BD.</p>';
        });
}

// ==========================================
// LÓGICA PARA MOOD TRACKER (REGISTRO)
// ==========================================
const formRegistro = document.getElementById('moodForm');

if (formRegistro) {
    const now = new Date();
    const year = now.getFullYear();
    // Sumamos 1 al mes porque en JavaScript enero es 0
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

    // 1. Declarar las variables necesarias
    const momentoDia = document.getElementById('momento');
    const hora = new Date().getHours();

    // 2. Definir la función (incluyendo Madrugada 00:00 - 05:59)
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

    formRegistro.addEventListener('submit', (e) => {
        e.preventDefault();

        // Prevenir el click fantasma o doble click
        const btnGuardarMood = document.getElementById('btn-save-mood');
        if (btnGuardarMood.disabled) return;

        if (!estadoSeleccionado) {
            alert('Por favor, selecciona un estado de ánimo.');
            return;
        }

        const textoBtnMood = btnGuardarMood.textContent;
        btnGuardarMood.disabled = true;
        btnGuardarMood.textContent = "Guardando...";

        const datos = {
            fecha: document.getElementById('fecha').value,
            momento_dia: document.getElementById('momento').value,
            estado_animo: estadoSeleccionado,
            color_hex: colorSeleccionado
        };

        fetch(`/api/insert-mood`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
        })
            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => { throw new Error(text); });
                }
                return response.text();
            })
            .then(mensaje => {
                alert(mensaje);
                botones.forEach(b => b.classList.remove('selected'));
                estadoSeleccionado = '';
                colorSeleccionado = '';
                document.getElementById('momento').value = "";
            })
            .catch(error => alert('Error: ' + error.message))
            .finally(() => {
                btnGuardarMood.disabled = false;
                btnGuardarMood.textContent = textoBtnMood;
            });
    });
}

// ==========================================
// LÓGICA PARA RESUMEN SEMANAL (TABLA MOOD & SUEÑO)
// ==========================================
const selectSemana = document.getElementById('semanaSeleccionada');

if (selectSemana) {
    // 1. Llenar el menú con semanas estrictas de Domingo a Sábado
    const now = new Date();
    // Encontrar el domingo de la semana actual
    const domingoActual = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());

    // Generar 5 semanas hacia atrás y 5 hacia adelante
    for (let i = -5; i <= 5; i++) {
        const dom = new Date(domingoActual);
        dom.setDate(dom.getDate() + (i * 7));
        const sab = new Date(dom);
        sab.setDate(sab.getDate() + 6);

        // Formatear las fechas para enviar al backend (YYYY-MM-DD)
        const domStr = `${dom.getFullYear()}-${String(dom.getMonth() + 1).padStart(2, '0')}-${String(dom.getDate()).padStart(2, '0')}`;
        const sabStr = `${sab.getFullYear()}-${String(sab.getMonth() + 1).padStart(2, '0')}-${String(sab.getDate()).padStart(2, '0')}`;

        // Crear el texto visual amigable en español
        const opcMes = { day: 'numeric', month: 'short' };
        const textoVisual = `${dom.toLocaleDateString('es-ES', opcMes)} - ${sab.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}`;

        const option = document.createElement('option');
        option.value = `${domStr}|${sabStr}`; // Guardamos inicio y fin unidos por un |
        option.textContent = `Semana: ${textoVisual}`;

        // Seleccionar automáticamente la semana actual
        if (i === 0) option.selected = true;

        selectSemana.appendChild(option);
    }

    // 2. Escuchar cuando eliges una semana distinta
    selectSemana.addEventListener('change', () => {
        // Extraer el inicio y fin del value elegido
        const [begin, end] = selectSemana.value.split('|');

        // Limpiar todos los cuadros de la tabla
        document.querySelectorAll('.mood-cell').forEach(celda => celda.innerHTML = '');
        const diasSemana = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        // Solicitar datos al backend
        fetch(`/api/get-moods?begin=${begin}&end=${end}`)
            .then(response => response.json())
            .then(registros => {
                registros.forEach(registro => {
                    const fechaObj = new Date(registro.fecha);
                    const nombreDia = diasSemana[fechaObj.getUTCDay()];
                    const celda = document.querySelector(`.mood-cell[data-day="${nombreDia}"][data-time="${registro.momento_dia}"]`);

                    if (celda) {
                        celda.innerHTML = `<span class="color-dot" style="background-color: ${registro.color_hex};"></span>`;
                    }
                });
            })
            .catch(error => console.error('Error cargando mood:', error));

        const sleepGrid = document.getElementById('sleepGrid');
        sleepGrid.innerHTML = ''; // Limpiar tarjetas anteriores

        // Preparamos un objeto vacío para sumar las horas de los 7 días
        const diasNombres = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        let sumatoriaSueno = {
            'Sunday': { horas: 0, calidades: [], sesiones: [] },
            'Monday': { horas: 0, calidades: [], sesiones: [] },
            'Tuesday': { horas: 0, calidades: [], sesiones: [] },
            'Wednesday': { horas: 0, calidades: [], sesiones: [] },
            'Thursday': { horas: 0, calidades: [], sesiones: [] },
            'Friday': { horas: 0, calidades: [], sesiones: [] },
            'Saturday': { horas: 0, calidades: [], sesiones: [] }
        };

        fetch(`/api/get-sleep?begin=${begin}&end=${end}`)
            .then(response => response.json())
            .then(registros => {
                // 1. Sumamos las horas de todos los registros que lleguen
                registros.forEach(registro => {
                    const fechaObj = new Date(registro.fecha);
                    const nombreDia = diasSemana[fechaObj.getUTCDay()];

                    const horasRegistro = parseFloat(registro.horas);
                    sumatoriaSueno[nombreDia].horas += horasRegistro;
                    sumatoriaSueno[nombreDia].calidades.push(registro.calidad);

                    // Guardamos el fragmento exacto para saber si es intermitente
                    sumatoriaSueno[nombreDia].sesiones.push(horasRegistro);
                });

                // 2. Dibujamos las 7 tarjetas
                diasSemana.forEach((dia, index) => {
                    const datosDia = sumatoriaSueno[dia];
                    let emoji = '➖';
                    let colorBorde = '#e9ecef';
                    let textoHoras = '--';
                    let textoIntervalos = ''; // Para mostrar (5h + 2h)

                    if (datosDia.horas > 0) {
                        const totalH = datosDia.horas;
                        const cantidadSesiones = datosDia.sesiones.length;
                        const intermitente = cantidadSesiones > 1; // Si hay más de un registro, es interrumpido

                        // Formato de reloj para el Total (Ej. 7:30 h)
                        const horasEnteras = Math.floor(totalH);
                        const minutosRestantes = Math.round((totalH - horasEnteras) * 60);
                        textoHoras = `${horasEnteras}:${String(minutosRestantes).padStart(2, '0')} h`;

                        // Si es intermitente, creamos el sub-texto con los fragmentos
                        if (intermitente) {
                            const listaIntervalos = datosDia.sesiones.map(sesionH => {
                                const hE = Math.floor(sesionH);
                                const mR = Math.round((sesionH - hE) * 60);
                                return `${hE}:${String(mR).padStart(2, '0')}`;
                            });
                            textoIntervalos = `<div style="font-size: 0.8rem; color: #777; margin-top: 5px; font-weight: normal;">(${listaIntervalos.join(' + ')})</div>`;
                        }

                        // === LÓGICA DE CALIDAD INTELIGENTE ===
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

                    // Crear el bloque HTML de la tarjeta
                    const card = document.createElement('div');
                    card.className = 'sleep-card';
                    card.style.borderColor = colorBorde;

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
            .catch(error => console.error('Error cargando el sueño:', error));
    });
}

// ==========================================
// LÓGICA PARA SLEEP TRACKER
// ==========================================
const formSleep = document.getElementById('sleepForm');
if (formSleep) {
    function calcularHoras() {
        const sleepTime = document.getElementById('sleepTime').value;
        const wakeupTime = document.getElementById('wakeupTime').value;

        if (sleepTime && wakeupTime) {
            const sleepDate = new Date(`2000-01-01T${sleepTime}`);
            const wakeupDate = new Date(`2000-01-01T${wakeupTime}`);

            // Si es otro dia
            if (wakeupDate < sleepDate) {
                wakeupDate.setDate(wakeupDate.getDate() + 1);
            }

            // Convertimos a minutos totales primero
            const diferenciaMilisegundos = wakeupDate - sleepDate;
            const totalMinutes = Math.floor(diferenciaMilisegundos / (1000 * 60));

            // Extraemos las horas y los minutos sobrantes
            const intHours = Math.floor(totalMinutes / 60);
            const intMinutes = totalMinutes % 60;

            let visualText = `${intHours} horas`;
            if (intMinutes > 0 && intMinutes <= 1) {
                visualText += ` y ${intMinutes} minuto`;
            } else if (intMinutes > 1) {
                visualText += ` y ${intMinutes} minutos`;
            }

            // Mostramos el texto en la pantalla
            const inputSleep = document.getElementById('sleepHours');
            inputSleep.value = visualText;

            // Escondemos el valor decimal exacto (ej. 5.5) en el HTML para la base de datos
            inputSleep.dataset.decimal = (totalMinutes / 60).toFixed(2);
        }
    }

    document.getElementById('sleepTime').addEventListener('change', () => calcularHoras());
    document.getElementById('wakeupTime').addEventListener('change', () => calcularHoras());

    formSleep.addEventListener('submit', (e) => {
        e.preventDefault();
        const btnGuardarSleep = document.getElementById('btn-save-sleep');
        if (btnGuardarSleep.disabled) return;

        const sleepTime = document.getElementById('sleepTime').value;
        const wakeupTime = document.getElementById('wakeupTime').value;
        const quality = document.getElementById('quality-sleep').value;

        // 2. VALIDACIÓN ESTRICTA
        if (!sleepTime || !wakeupTime || !quality) {
            alert('Por favor, llena todos los campos (hora de dormir, despertar y calidad de sueño).');
            return;
        }

        const textoBtnSleep = btnGuardarSleep.textContent;
        btnGuardarSleep.disabled = true;
        btnGuardarSleep.textContent = "Guardando...";

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');

        const fecha = `${year}-${month}-${day}`;
        const horas = parseFloat(document.getElementById('sleepHours').dataset.decimal);
        const calidad = document.getElementById('quality-sleep').value;

        const datos = {
            fecha: fecha,
            horas: horas,
            calidad: calidad
        };

        fetch('/api/insert-sleep', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
        })
            .then(resopnse => {
                if (!resopnse.ok) {
                    return resopnse.text().then(text => { throw new Error(text); });
                }
                return resopnse.text();
            })
            .then(mensaje => {
                alert(mensaje);
                document.getElementById('sleepTime').value = '';
                document.getElementById('wakeupTime').value = '';
                document.getElementById('sleepHours').value = '';
                document.getElementById('quality-sleep').value = '';
            })
            .catch(error => alert('Error: ' + error.message))
            .finally(() => {
                btnGuardarSleep.disabled = false;
                btnGuardarSleep.textContent = textoBtnSleep;
            });
    });
}

// ==========================================
// LÓGICA PARA EL JOURNAL (NOTAS A WORD)
// ==========================================
const journalForm = document.getElementById('journalForm');

if (journalForm) {
    journalForm.addEventListener('submit', function (e) {
        e.preventDefault(); // Evita que la página se recargue
        const btnEnviarWord = document.getElementById('btn-send-word');
        if (btnEnviarWord.disabled) return;

        const textInput = document.getElementById('journalText');
        const texto = textInput.value;

        // Evitar envíos vacíos
        if (!texto.trim()) return;

        // 1. Buscar la llave en la bóveda del navegador
        let llaveTexto = localStorage.getItem('diario_llave_secreta');

        // 2. Si no existe, pedírsela al usuario por única vez
        if (!llaveTexto || llaveTexto.length !== 32) {
            llaveTexto = prompt("🔒 Seguridad E2EE:\nIngresa tu clave secreta de 32 caracteres.\nSolo se te pedirá esta vez en este dispositivo:");

            if (llaveTexto && llaveTexto.length === 32) {
                // Guardarla permanentemente en el navegador
                localStorage.setItem('diario_llave_secreta', llaveTexto);
            } else {
                alert("Operación cancelada: La clave debe tener exactamente 32 caracteres.");
                return; // Detener el envío
            }
        }

        const textoBtnWord = btnEnviarWord.textContent;
        btnEnviarWord.disabled = true;
        btnEnviarWord.textContent = "Enviando...";

        // 3. Usar la llave guardada para encriptar
        const LLAVE_SECRETA = CryptoJS.enc.Utf8.parse(llaveTexto);
        const iv = CryptoJS.lib.WordArray.random(16);
        const encriptado = CryptoJS.AES.encrypt(texto, LLAVE_SECRETA, { iv: iv });
        const textoSeguro = iv.toString(CryptoJS.enc.Hex) + ":" + encriptado.toString();

        // 4. Enviar el texto ENCRIPTADO al backend
        fetch('/api/send-to-pc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texto: textoSeguro })
        })
            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => { throw new Error(text); });
                }
                return response.text();
            })
            .then(() => {
                alert('¡Nota enviada! Tu script de Python la guardará en el Word en el próximo escaneo.');
                textInput.value = '';
            })
            .catch(error => alert('Error al enviar la nota: ' + error.message))
            .finally(() => {
                btnEnviarWord.disabled = false;
                btnEnviarWord.textContent = textoBtnWord;
            });
    });
}

// ==========================================
// LÓGICA PARA AGENDA PERSONAL SEMANAL
// ==========================================
const AGENDA_BLOQUES = [
    {
        id: 'manana',
        label: 'Por la mañana',
        defaultHora: '08:00',
        svg: `<svg class="agenda-block-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9z"/>
                <path d="M16 10h2.5a2 2 0 0 1 0 4H16"/>
                <path d="M4 19h13"/>
              </svg>`
    },
    {
        id: 'cole',
        label: 'En el cole',
        defaultHora: '10:00',
        svg: `<svg class="agenda-block-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 10l9-5 9 5"/>
                <path d="M5 11v7c2.5-1.2 4.8-1.2 7 0 2.2-1.2 4.5-1.2 7 0v-7"/>
                <path d="M12 11v7"/>
              </svg>`
    },
    {
        id: 'tarde',
        label: 'Por la tarde',
        defaultHora: '16:00',
        svg: `<svg class="agenda-block-svg" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4"/>
                <path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
              </svg>`
    },
    {
        id: 'noche',
        label: 'Por la noche',
        defaultHora: '21:00',
        svg: `<svg class="agenda-block-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15.5 5.5a4.5 4.5 0 0 0 4 5.5 5 5 0 1 1-4-5.5z"/>
                <path d="M6 17h9a3 3 0 0 0 0-6 4 4 0 0 0-7.7-1A3 3 0 0 0 6 17z"/>
              </svg>`
    }
];

const AGENDA_DIAS = [
    { key: 'lun', nombre: 'Lunes', corto: 'Lun', offset: 0 },
    { key: 'mar', nombre: 'Martes', corto: 'Mar', offset: 1 },
    { key: 'mie', nombre: 'Miércoles', corto: 'Mié', offset: 2 },
    { key: 'jue', nombre: 'Jueves', corto: 'Jue', offset: 3 },
    { key: 'vie', nombre: 'Viernes', corto: 'Vie', offset: 4 },
    { key: 'sab', nombre: 'Sábado', corto: 'Sáb', offset: 5 },
    { key: 'dom', nombre: 'Domingo', corto: 'Dom', offset: 6 }
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
    checkBtn.setAttribute('aria-label', Number(item.completada) === 1 ? 'Marcar como pendiente' : 'Marcar como completada');
    checkBtn.textContent = Number(item.completada) === 1 ? '✓' : '';
    checkBtn.addEventListener('click', () => toggleAgendaItem(item));

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
    editBtn.title = 'Editar actividad';
    editBtn.setAttribute('aria-label', 'Editar actividad');
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', () => abrirAgendaModal(item));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'agenda-mini-btn';
    delBtn.title = 'Eliminar actividad';
    delBtn.setAttribute('aria-label', 'Eliminar actividad');
    delBtn.textContent = '🗑️';
    delBtn.addEventListener('click', () => eliminarAgendaItem(item.id));

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

    // Asegurar que selectedDate pertenezca a la semana visible
    if (!diasVisibles.some(d => d.fecha === agendaState.selectedDate)) {
        const todayInWeek = diasVisibles.find(d => d.fecha === hoyStr);
        agendaState.selectedDate = todayInWeek ? todayInWeek.fecha : diasVisibles[0].fecha;
    }

    // Etiqueta de semana
    const firstDate = diasVisibles[0].dateObj;
    const lastDate = diasVisibles[diasVisibles.length - 1].dateObj;
    if (weekLabel) {
        const f1 = firstDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
        const f2 = lastDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
        weekLabel.textContent = `${f1} - ${f2}`;
    }

    // Estadísticas
    const visibleDatesSet = new Set(diasVisibles.map(d => d.fecha));
    const visibleItems = agendaState.items.filter(i => visibleDatesSet.has(i.fecha));
    const completadas = visibleItems.filter(i => Number(i.completada) === 1).length;
    if (weekStats) {
        weekStats.textContent = visibleItems.length
            ? `Progreso semanal: ${completadas} de ${visibleItems.length} actividades completadas`
            : 'Registra tus actividades y horarios por momento del día';
    }

    if (btnToggleWeekend) {
        btnToggleWeekend.textContent = agendaState.showWeekend ? 'Solo Lun - Vie' : 'Ver Lun - Dom';
        btnToggleWeekend.classList.toggle('active', !agendaState.showWeekend);
    }

    if (btnToggleLayout) {
        btnToggleLayout.textContent = agendaState.layoutMode === 'day' ? 'Vista Cuadrícula' : 'Vista Día';
    }

    const isDayLayout = agendaState.layoutMode === 'day';
    dayTabs.hidden = !isDayLayout;
    dayBoard.hidden = !isDayLayout;
    tableScroll.hidden = isDayLayout;

    // 1. Renderizar Vista Día (OPPO A79 / móvil / modo enfoque)
    if (isDayLayout) {
        dayTabs.innerHTML = '';
        diasVisibles.forEach(dia => {
            const count = agendaState.items.filter(i => i.fecha === dia.fecha).length;
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = `agenda-day-tab day-${dia.key}${dia.fecha === agendaState.selectedDate ? ' active' : ''}`;
            tab.innerHTML = `
                <span class="tab-day">${dia.corto}${dia.fecha === hoyStr ? ' •' : ''}</span>
                <span class="tab-date">${dia.dateObj.getDate()} ${dia.dateObj.toLocaleDateString('es-ES', { month: 'short' })}</span>
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
                empty.textContent = 'Sin actividades registradas';
                body.appendChild(empty);
            } else {
                blockItems.forEach(item => body.appendChild(crearElementoActividad(item)));
            }

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'agenda-cell-add';
            addBtn.textContent = `+ Agregar en ${bloque.label.toLowerCase()}`;
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

    // 2. Renderizar Vista Cuadrícula Semanal Pastel (estilo plantilla imagen)
    weekBoard.innerHTML = '';
    weekBoard.style.setProperty('--agenda-cols', String(diasVisibles.length));
    weekBoard.classList.toggle('cols-5', diasVisibles.length === 5);

    const corner = document.createElement('div');
    corner.className = 'agenda-corner-cell';
    corner.textContent = 'Bloque / Día';
    weekBoard.appendChild(corner);

    diasVisibles.forEach(dia => {
        const header = document.createElement('div');
        header.className = `agenda-day-header day-${dia.key}${dia.fecha === hoyStr ? ' is-today' : ''}`;
        const dateLabel = `${dia.dateObj.getDate()} ${dia.dateObj.toLocaleDateString('es-ES', { month: 'short' })}`;
        header.innerHTML = `
            <span class="agenda-day-name">${dia.nombre}</span>
            <span class="agenda-day-date">${dateLabel}${dia.fecha === hoyStr ? ' · Hoy' : ''}</span>
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
            addBtn.textContent = '+ Agregar';
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

    fetch(`/api/get-agenda?begin=${begin}&end=${end}`)
        .then(res => {
            if (!res.ok) return res.text().then(t => { throw new Error(t); });
            return res.json();
        })
        .then(items => {
            agendaState.items = Array.isArray(items) ? items : [];
            renderAgendaBoard();
        })
        .catch(err => {
            console.error('Error al cargar agenda:', err);
            agendaState.items = [];
            renderAgendaBoard();
            const weekStats = document.getElementById('agendaWeekStats');
            if (weekStats) {
                weekStats.textContent = 'No se pudo cargar la agenda (verifica la tabla RegistrosAgenda en la BD).';
            }
        });
}

function toggleAgendaItem(item) {
    const nuevoEstado = Number(item.completada) === 1 ? 0 : 1;
    fetch(`/api/toggle-agenda/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completada: nuevoEstado })
    })
        .then(res => {
            if (!res.ok) return res.text().then(t => { throw new Error(t); });
            return res.json();
        })
        .then(() => {
            item.completada = nuevoEstado;
            renderAgendaBoard();
        })
        .catch(err => alert('Error al actualizar estado: ' + err.message));
}

function eliminarAgendaItem(id) {
    if (!confirm('¿Eliminar esta actividad de tu agenda?')) return;

    fetch(`/api/delete-agenda/${id}`, {
        method: 'DELETE'
    })
        .then(res => {
            if (!res.ok) return res.text().then(t => { throw new Error(t); });
            return res.json();
        })
        .then(() => {
            agendaState.items = agendaState.items.filter(i => i.id !== id);
            renderAgendaBoard();
        })
        .catch(err => alert('Error al eliminar actividad: ' + err.message));
}

const agendaModal = document.getElementById('agendaModal');
const agendaForm = document.getElementById('agendaForm');

function abrirAgendaModal(prefill = {}) {
    if (!agendaModal || !agendaForm) return;
    const isEdit = Boolean(prefill.id);

    const now = new Date();
    const info = getMomentoInfo(now.getHours());
    const defaultDate = agendaState.layoutMode === 'day'
        ? agendaState.selectedDate
        : formatLocalDate(now);
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    document.getElementById('agendaModalTitle').textContent = isEdit ? 'Editar Actividad' : 'Nueva Actividad';
    document.getElementById('agendaEditId').value = isEdit ? String(prefill.id) : '';
    document.getElementById('agendaFecha').value = prefill.fecha || defaultDate;
    document.getElementById('agendaBloque').value = prefill.bloque || info.agendaBloque;
    document.getElementById('agendaHora').value = prefill.hora || defaultTime;
    document.getElementById('agendaActividad').value = prefill.actividad || '';

    agendaModal.hidden = false;
    setTimeout(() => document.getElementById('agendaActividad').focus(), 40);
}

function cerrarAgendaModal() {
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
        if (btnSave.disabled) return;

        const editId = document.getElementById('agendaEditId').value;
        const payload = {
            fecha: document.getElementById('agendaFecha').value,
            bloque: document.getElementById('agendaBloque').value,
            hora: document.getElementById('agendaHora').value,
            actividad: document.getElementById('agendaActividad').value.trim()
        };

        if (!payload.fecha || !payload.bloque || !payload.hora || !payload.actividad) {
            alert('Por favor completa todos los campos de la actividad.');
            return;
        }

        const originalText = btnSave.textContent;
        btnSave.disabled = true;
        btnSave.textContent = 'Guardando...';

        const url = editId ? `/api/update-agenda/${editId}` : '/api/insert-agenda';
        const method = editId ? 'PUT' : 'POST';

        fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(res => {
                if (!res.ok) return res.text().then(t => { throw new Error(t); });
                return res.json();
            })
            .then(() => {
                agendaState.selectedDate = payload.fecha;
                cerrarAgendaModal();
                cargarAgendaSemana();
            })
            .catch(err => alert('Error: ' + err.message))
            .finally(() => {
                btnSave.disabled = false;
                btnSave.textContent = originalText;
            });
    });
}

// ==========================================
// AUTENTICACIÓN, ROLES, SESIÓN Y ACCESO PSIQUIATRA
// ==========================================
function showAuthForm(formId, subtitleText) {
    ['authLoginForm', 'authRegisterForm', 'authForgotForm', 'authResetForm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.hidden = id !== formId;
    });
    const sub = document.getElementById('authSubtitle');
    if (sub && subtitleText) sub.textContent = subtitleText;
}

function showAuthScreen(defaultForm = 'authLoginForm') {
    currentUser = null;
    if (sundayWatcherInterval) {
        clearInterval(sundayWatcherInterval);
        sundayWatcherInterval = null;
    }
    if (appShell) appShell.hidden = true;
    if (authOverlay) authOverlay.hidden = false;

    const subtitles = {
        authLoginForm: 'Inicia sesión para continuar',
        authRegisterForm: 'Registro de cuenta verificada',
        authForgotForm: 'Recuperación de contraseña por correo',
        authResetForm: 'Crea tu nueva contraseña segura'
    };
    showAuthForm(defaultForm, subtitles[defaultForm]);
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
                alert('Tu sesión semanal se cerró automáticamente (Domingo 00:00). Por favor inicia sesión nuevamente.');
                showAuthScreen('authLoginForm');
            });
        }
    }, 30000);
}

function enterAppSession(user) {
    currentUser = user;
    if (authOverlay) authOverlay.hidden = true;
    if (appShell) appShell.hidden = false;

    const isPsiquiatra = user.rol === 'psiquiatra';

    // Actualizar datos del usuario en la barra lateral
    const userNameEl = document.getElementById('sidebarUserName');
    const userEmailEl = document.getElementById('sidebarUserEmail');
    const roleLabelEl = document.getElementById('sidebarRoleLabel');
    const readonlyBanner = document.getElementById('medicoReadonlyBanner');

    if (userNameEl) userNameEl.textContent = user.nombre;
    if (userEmailEl) userEmailEl.textContent = user.email;
    if (roleLabelEl) {
        roleLabelEl.textContent = isPsiquiatra ? 'Modo Psiquiatra (Lectura)' : 'Propietario (Admin)';
    }

    // Mostrar u ocultar secciones exclusivas del propietario
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
}

// Gestión de cuentas de psiquiatra (vista #view-medico)
function cargarMedicos() {
    const container = document.getElementById('medicosList');
    if (!container || !currentUser || currentUser.rol !== 'admin') return;

    fetch('/api/auth/medicos')
        .then(res => res.ok ? res.json() : Promise.reject(new Error('No se pudo consultar')))
        .then(medicos => {
            container.innerHTML = '';
            if (!Array.isArray(medicos) || medicos.length === 0) {
                container.innerHTML = '<p class="muted-text">Aún no has creado una cuenta para tu psiquiatra.</p>';
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
                emailSpan.textContent = `${m.email} · Solo lectura ( Sueño y Estado de Ánimo )`;
                info.append(nameStrong, emailSpan);

                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'btn-revoke-medico';
                delBtn.textContent = 'Revocar acceso';
                delBtn.addEventListener('click', () => {
                    if (!confirm(`¿Revocar el acceso de ${m.nombre} (${m.email})?`)) return;
                    fetch(`/api/auth/medicos/${m.id}`, { method: 'DELETE' })
                        .then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(t); }))
                        .then(() => cargarMedicos())
                        .catch(err => alert('Error: ' + err.message));
                });

                row.append(info, delBtn);
                container.appendChild(row);
            });
        })
        .catch(() => {
            container.innerHTML = '<p class="muted-text">Error al cargar cuentas de psiquiatra.</p>';
        });
}

function initAuthHandlers() {
    const btnGoRegister = document.getElementById('linkGoRegister');
    const btnGoForgot = document.getElementById('linkGoForgot');
    const btnBackFromRegister = document.getElementById('linkBackLoginFromReg');
    const btnBackFromForgot = document.getElementById('linkBackLoginFromForgot');
    const btnBackFromReset = document.getElementById('linkBackLoginFromReset');
    const btnSendRegCode = document.getElementById('btnSendRegCode');
    const btnLogout = document.getElementById('btnLogout');

    if (btnGoRegister) {
        btnGoRegister.addEventListener('click', () => showAuthForm('authRegisterForm', 'Registro por primera vez y verificación'));
    }
    if (btnGoForgot) {
        btnGoForgot.addEventListener('click', () => showAuthForm('authForgotForm', 'Te enviaremos un enlace a tu correo'));
    }
    if (btnBackFromRegister) {
        btnBackFromRegister.addEventListener('click', () => showAuthForm('authLoginForm', 'Inicia sesión para continuar'));
    }
    if (btnBackFromForgot) {
        btnBackFromForgot.addEventListener('click', () => showAuthForm('authLoginForm', 'Inicia sesión para continuar'));
    }
    if (btnBackFromReset) {
        btnBackFromReset.addEventListener('click', () => {
            history.replaceState(null, '', window.location.pathname);
            showAuthForm('authLoginForm', 'Inicia sesión para continuar');
        });
    }

    // Enviar código de verificación por correo
    if (btnSendRegCode) {
        btnSendRegCode.addEventListener('click', () => {
            const email = document.getElementById('regEmail').value.trim();
            if (!email) {
                alert('Primero escribe tu correo electrónico arriba.');
                return;
            }
            const origText = btnSendRegCode.textContent;
            btnSendRegCode.disabled = true;
            btnSendRegCode.textContent = 'Enviando código...';

            fetch('/api/auth/send-register-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            })
                .then(res => res.ok ? res.json() : res.text().then(t => { throw new Error(t); }))
                .then(data => alert(data.message))
                .catch(err => alert(err.message))
                .finally(() => {
                    btnSendRegCode.disabled = false;
                    btnSendRegCode.textContent = origText;
                });
        });
    }

    // Formulario de Login
    const loginForm = document.getElementById('authLoginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const btn = document.getElementById('btnLoginSubmit');
            if (btn.disabled) return;

            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;

            const origText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Verificando...';

            fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            })
                .then(res => res.ok ? res.json() : res.text().then(t => { throw new Error(t); }))
                .then(data => {
                    loginForm.reset();
                    enterAppSession(data.user);
                })
                .catch(err => alert(err.message))
                .finally(() => {
                    btn.disabled = false;
                    btn.textContent = origText;
                });
        });
    }

    // Formulario de Registro por primera vez
    const registerForm = document.getElementById('authRegisterForm');
    if (registerForm) {
        registerForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const btn = document.getElementById('btnRegSubmit');
            if (btn.disabled) return;

            const payload = {
                nombre: document.getElementById('regNombre').value.trim(),
                email: document.getElementById('regEmail').value.trim(),
                password: document.getElementById('regPassword').value,
                codigoValidacion: document.getElementById('regCodigoValidacion').value.trim()
            };

            const origText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Validando y registrando...';

            fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(res => res.ok ? res.json() : res.text().then(t => { throw new Error(t); }))
                .then(data => {
                    registerForm.reset();
                    alert(`¡Bienvenido, ${data.user.nombre}! Tu sesión permanecerá activa hasta el domingo a las 00:00 o hasta que cierres sesión.`);
                    enterAppSession(data.user);
                })
                .catch(err => alert(err.message))
                .finally(() => {
                    btn.disabled = false;
                    btn.textContent = origText;
                });
        });
    }

    // Formulario de Olvidé mi contraseña
    const forgotForm = document.getElementById('authForgotForm');
    if (forgotForm) {
        forgotForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const btn = document.getElementById('btnForgotSubmit');
            if (btn.disabled) return;

            const email = document.getElementById('forgotEmail').value.trim();
            const origText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Enviando enlace...';

            fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            })
                .then(res => res.ok ? res.json() : res.text().then(t => { throw new Error(t); }))
                .then(data => {
                    alert(data.message);
                    showAuthForm('authLoginForm', 'Inicia sesión para continuar');
                })
                .catch(err => alert('Error: ' + err.message))
                .finally(() => {
                    btn.disabled = false;
                    btn.textContent = origText;
                });
        });
    }

    // Formulario para restablecer contraseña desde el enlace del correo
    const resetForm = document.getElementById('authResetForm');
    if (resetForm) {
        resetForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const btn = document.getElementById('btnResetSubmit');
            if (btn.disabled) return;

            const params = new URLSearchParams(window.location.search);
            const token = params.get('resetToken') || '';
            const email = params.get('email') || '';
            const newPassword = document.getElementById('resetNewPassword').value;
            const confirmPassword = document.getElementById('resetConfirmPassword').value;

            if (newPassword !== confirmPassword) {
                alert('Las contraseñas no coinciden.');
                return;
            }

            const origText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Actualizando...';

            fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, token, newPassword })
            })
                .then(res => res.ok ? res.json() : res.text().then(t => { throw new Error(t); }))
                .then(data => {
                    alert(data.message);
                    resetForm.reset();
                    history.replaceState(null, '', window.location.pathname);
                    showAuthForm('authLoginForm', 'Inicia sesión con tu nueva contraseña');
                })
                .catch(err => alert('Error: ' + err.message))
                .finally(() => {
                    btn.disabled = false;
                    btn.textContent = origText;
                });
        });
    }

    // Botón Cerrar Sesión en el menú lateral
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            fetch('/api/auth/logout', { method: 'POST' })
                .finally(() => {
                    setMobileMenuOpen(false);
                    showAuthScreen('authLoginForm');
                });
        });
    }

    // Formulario de creación de cuenta del psiquiatra (#view-medico)
    const medicoForm = document.getElementById('medicoForm');
    if (medicoForm) {
        medicoForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const btn = document.getElementById('btnSaveMedico');
            if (btn.disabled) return;

            const payload = {
                nombre: document.getElementById('medicoNombre').value.trim(),
                email: document.getElementById('medicoEmail').value.trim(),
                password: document.getElementById('medicoPassword').value
            };

            const origText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Guardando...';

            fetch('/api/auth/create-medico', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(res => res.ok ? res.json() : res.text().then(t => { throw new Error(t); }))
                .then(data => {
                    alert(data.message);
                    medicoForm.reset();
                    cargarMedicos();
                })
                .catch(err => alert('Error: ' + err.message))
                .finally(() => {
                    btn.disabled = false;
                    btn.textContent = origText;
                });
        });
    }
}

// ==========================================
// INICIALIZACIÓN AL CARGAR LA APLICACIÓN
// ==========================================
function initApp() {
    initAuthHandlers();

    // Si el usuario abrió el enlace de recuperación enviado a su correo (?resetToken=...&email=...)
    const params = new URLSearchParams(window.location.search);
    if (params.get('resetToken') && params.get('email')) {
        const resetEmailEl = document.getElementById('resetEmail');
        const resetTokenEl = document.getElementById('resetTokenInput');
        if (resetEmailEl) resetEmailEl.value = params.get('email');
        if (resetTokenEl) resetTokenEl.value = params.get('resetToken');
        showAuthScreen('authResetForm');
        return;
    }

    // Verificar si existe una sesión activa (persistente hasta el domingo 00:00)
    fetch('/api/auth/me')
        .then(res => {
            if (!res.ok) throw new Error('No autenticado');
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
