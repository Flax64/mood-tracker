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
const inputSemana = document.getElementById('semanaSeleccionada');

// Solo ejecutamos esto si estamos en la página del visualizador
if (inputSemana) {
    function obtenerRangoFechas(semanaString) {
        if (!semanaString) return null;
        const [year, week] = semanaString.split('-W');
        const simple = new Date(year, 0, 1 + (week - 1) * 7);
        const diaSemana = simple.getDay();
        const inicioSemanaISO = simple;

        if (diaSemana <= 4) {
            inicioSemanaISO.setDate(simple.getDate() - simple.getDay() + 1);
        } else {
            inicioSemanaISO.setDate(simple.getDate() + 8 - simple.getDay());
        }

        // --- CÁLCULO ACTUALIZADO: DE DOMINGO A SÁBADO ---
        // inicioSemanaISO es el Lunes. Retrocedemos 1 día para sacar el Domingo.
        const domingo = new Date(inicioSemanaISO);
        domingo.setDate(inicioSemanaISO.getDate() - 1);

        // Avanzamos 5 días desde el Lunes para sacar el Sábado.
        const sabado = new Date(inicioSemanaISO);
        sabado.setDate(inicioSemanaISO.getDate() + 5);

        return {
            inicio: domingo.toISOString().split('T')[0],
            fin: sabado.toISOString().split('T')[0]
        };
    }

    inputSemana.addEventListener('change', () => {
        const rango = obtenerRangoFechas(inputSemana.value);
        if (!rango) return;

        document.querySelectorAll('.mood-cell').forEach(celda => celda.innerHTML = '');

        fetch(`/api/moods?inicio=${rango.inicio}&fin=${rango.fin}`)
            .then(response => response.json())
            .then(registros => {
                const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

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

    window.addEventListener('DOMContentLoaded', () => {
        const hoy = new Date();
        const año = hoy.getFullYear();
        const numSemana = Math.ceil(Math.floor((hoy - new Date(año, 0, 1)) / (24 * 60 * 60 * 1000)) / 7);
        inputSemana.value = `${año}-W${numSemana.toString().padStart(2, '0')}`;
        inputSemana.dispatchEvent(new Event('change'));
    });
}