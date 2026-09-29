// ==========================================
// LÓGICA PARA INDEX.HTML (REGISTRO)
// ==========================================
const formRegistro = document.getElementById('moodForm');

// Solo ejecutamos esto si estamos en la página del formulario
if (formRegistro) {
    document.getElementById('fecha').valueAsDate = new Date();

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

        fetch(`/api/mood`, {
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
    const hoy = new Date();
    // Encontrar el domingo de la semana actual
    const domingoActual = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - hoy.getDay());

    // Generar 5 semanas hacia atrás y 5 hacia adelante
    for (let i = -5; i <= 5; i++) {
        const dom = new Date(domingoActual);
        dom.setDate(dom.getDate() + (i * 7));
        const sab = new Date(dom);
        sab.setDate(sab.getDate() + 6);

        // Formatear las fechas para enviar al backend (YYYY-MM-DD)
        const domStr = `${dom.getFullYear()}-${String(dom.getMonth()+1).padStart(2,'0')}-${String(dom.getDate()).padStart(2,'0')}`;
        const sabStr = `${sab.getFullYear()}-${String(sab.getMonth()+1).padStart(2,'0')}-${String(sab.getDate()).padStart(2,'0')}`;
        
        // Crear el texto visual amigable en español
        const opcMes = { day: 'numeric', month: 'short' };
        const textoVisual = `${dom.toLocaleDateString('es-ES', opcMes)} - ${sab.toLocaleDateString('es-ES', {day: 'numeric', month: 'short', year: 'numeric'})}`;

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
        const [inicio, fin] = selectSemana.value.split('|');

        // Limpiar todos los cuadros de la tabla
        document.querySelectorAll('.mood-cell').forEach(celda => celda.innerHTML = '');

        // Solicitar datos al backend
        fetch(`/api/moods?inicio=${inicio}&fin=${fin}`)
            .then(response => response.json())
            .then(registros => {
                const diasSemana = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

                registros.forEach(registro => {
                    const fechaObj = new Date(registro.fecha);
                    const nombreDia = diasSemana[fechaObj.getUTCDay()];
                    const celda = document.querySelector(`.mood-cell[data-day="${nombreDia}"][data-time="${registro.momento_dia}"]`);

                    if (celda) {
                        celda.innerHTML = `<span class="color-dot" style="background-color: ${registro.color_hex};"></span>`;
                    }
                });
            })
            .catch(error => console.error('Error cargando los datos:', error));
    });

    // 3. Disparar el evento inmediatamente al abrir la página para cargar la tabla
    selectSemana.dispatchEvent(new Event('change'));
}