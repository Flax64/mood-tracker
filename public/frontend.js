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
            'Sunday': { horas: 0, calidades: [] },
            'Monday': { horas: 0, calidades: [] },
            'Tuesday': { horas: 0, calidades: [] },
            'Wednesday': { horas: 0, calidades: [] },
            'Thursday': { horas: 0, calidades: [] },
            'Friday': { horas: 0, calidades: [] },
            'Saturday': { horas: 0, calidades: [] }
        };

        fetch(`/api/get-sleep?begin=${begin}&end=${end}`)
            .then(response => response.json())
            .then(registros => {
                // 1. Sumamos las horas de todos los registros que lleguen
                registros.forEach(registro => {
                    const fechaObj = new Date(registro.fecha);
                    const nombreDia = diasSemana[fechaObj.getUTCDay()]; // getUTCDay evita desfases

                    sumatoriaSueno[nombreDia].horas += parseFloat(registro.horas);
                    sumatoriaSueno[nombreDia].calidades.push(registro.calidad);
                });

                // 2. Dibujamos las 7 tarjetas
                diasSemana.forEach((dia, index) => {
                    const datosDia = sumatoriaSueno[dia];
                    let emoji = '➖';
                    let colorBorde = '#e9ecef';

                    // Lógica de calidad: Si hubo al menos un registro ese día
                    if (datosDia.horas > 0) {
                        // Si en tus pausas tuviste al menos un descanso "Bad", predomina el rojo
                        if (datosDia.calidades.includes('Bad')) {
                            emoji = '🔴';
                            colorBorde = '#EF4444'; // Rojo
                        } else if (datosDia.calidades.includes('Regular')) {
                            emoji = '🟡';
                            colorBorde = '#FDE047'; // Amarillo
                        } else {
                            emoji = '🟢';
                            colorBorde = '#4ADE80'; // Verde
                        }
                    }

                    // Crear el bloque HTML de la tarjeta
                    const card = document.createElement('div');
                    card.className = 'sleep-card';
                    card.style.borderColor = datosDia.horas > 0 ? colorBorde : '#e9ecef';

                    card.innerHTML = `
                <div class="day-name">${diasNombres[index]}</div>
                <div class="sleep-hours">${datosDia.horas > 0 ? datosDia.horas.toFixed(1) + 'h' : '--'}</div>
                <div class="sleep-quality">${emoji}</div>
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
                    resopnse.text().then(text => { throw new Error(text) })
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