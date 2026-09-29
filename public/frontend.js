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

if (inputSemana) {
    // Nueva función que calcula Domingo a Sábado a partir de un solo día
    function obtenerRangoFechasDesdeDia(fechaString) {
        if (!fechaString) return null;
        
        // Separamos la fecha para evitar problemas de zonas horarias
        const [year, month, day] = fechaString.split('-');
        const fechaElegida = new Date(year, month - 1, day);
        
        const diaSemana = fechaElegida.getDay(); // 0 es Domingo, 6 es Sábado
        
        // Restamos los días necesarios para llegar al Domingo
        const domingo = new Date(fechaElegida);
        domingo.setDate(fechaElegida.getDate() - diaSemana);
        
        // Sumamos 6 días al Domingo para llegar al Sábado
        const sabado = new Date(domingo);
        sabado.setDate(domingo.getDate() + 6);
        
        return {
            inicio: domingo.toISOString().split('T')[0],
            fin: sabado.toISOString().split('T')[0]
        };
    }

    inputSemana.addEventListener('change', () => {
        const rango = obtenerRangoFechasDesdeDia(inputSemana.value);
        if (!rango) return;

        // Limpiar tabla
        document.querySelectorAll('.mood-cell').forEach(celda => celda.innerHTML = '');

        // Solicitar datos al backend
        fetch(`/api/moods?inicio=${rango.inicio}&fin=${rango.fin}`)
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

    // Poner la fecha de hoy por defecto al cargar la página
    window.addEventListener('DOMContentLoaded', () => {
        const hoy = new Date();
        const year = hoy.getFullYear();
        const month = String(hoy.getMonth() + 1).padStart(2, '0');
        const day = String(hoy.getDate()).padStart(2, '0');
        
        inputSemana.value = `${year}-${month}-${day}`;
        inputSemana.dispatchEvent(new Event('change'));
    });
}