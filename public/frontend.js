// ==========================================
// LÓGICA PARA INDEX.HTML (REGISTRO)
// ==========================================
const formRegistro = document.getElementById('moodForm');

// Solo ejecutamos esto si estamos en la página del formulario
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

    // 2. Definir la función
    const obtenerMomentoDia = (horaActual) => {
        if (horaActual >= 6 && horaActual < 12) {
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

    formRegistro.addEventListener('submit', function (e) {
        e.preventDefault();

        if (!estadoSeleccionado) {
            alert('Por favor, selecciona un estado de ánimo.');
            return;
        }

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
                    return response.text().then(text => { throw new Error(text) })
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
            .catch(error => alert('Error: ' + error.message));
    });
}

// ==========================================
// LÓGICA PARA DASHBOARD.HTML (TABLA)
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
            .catch(error => alert('Error:' + error.message));

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

                    // NUEVO: Guardamos el fragmento exacto para saber si es intermitente
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
                            // Dibuja algo como: (5:00 + 2:30) en texto más pequeño
                            textoIntervalos = `<div style="font-size: 0.8rem; color: #777; margin-top: 5px; font-weight: normal;">(${listaIntervalos.join(' + ')})</div>`;
                        }

                        // === LÓGICA DE CALIDAD INTELIGENTE ===
                        if (totalH < 4 || (totalH < 6 && intermitente)) {
                            // Rojo: Menor a 4h en total, o menor a 6h pero interrumpido
                            emoji = '🔴';
                            colorBorde = '#EF4444';
                        } else if (totalH >= 7 && !intermitente) {
                            // Verde: ÚNICAMENTE si es 7h o más, y NO fue interrumpido (1 sola sesión)
                            emoji = '🟢';
                            colorBorde = '#4ADE80';
                        } else {
                            // Amarillo: Todo lo demás (ej. 4 a 6.9h de corrido, o cualquier sueño interrumpido mayor a 6h)
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

    // 3. Disparar el evento inmediatamente al abrir la página para cargar la tabla
    selectSemana.dispatchEvent(new Event('change'));
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

    document.getElementById('btn-save-sleep').addEventListener('click', () => {
        const sleepTime = document.getElementById('sleepTime').value;
        const wakeupTime = document.getElementById('wakeupTime').value;
        const quality = document.getElementById('quality-sleep').value;

        // 2. VALIDACIÓN ESTRICTA
        if (!sleepTime || !wakeupTime || !quality) {
            alert('Por favor, llena todos los campos (hora de dormir, despertar y calidad de sueño).');
            return;
        }

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
                    return resopnse.text().then(text => { throw new Error(text) })
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
    });
}

// ==========================================
// LÓGICA PARA EL JOURNAL (NOTAS A WORD)
// ==========================================
const journalForm = document.getElementById('journalForm');

if (journalForm) {
    journalForm.addEventListener('submit', function (e) {
        e.preventDefault(); // Evita que la página se recargue

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
        // ... (El resto del .then() y .catch() se queda igual) ...            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => { throw new Error(text) });
                }
                return response.text();
            })
            .then(mensaje => {
                alert('¡Nota enviada! Tu script de Python la guardará en el Word en el próximo escaneo.');
                textInput.value = '';
            })
            .catch(error => alert('Error al enviar la nota: ' + error.message));
    });
}