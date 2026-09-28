document.getElementById('fecha').valueAsDate = new Date();

let estadoSeleccionado = '';
let colorSeleccionado = '';

// Lógica para seleccionar estado de animo
const botones = document.querySelectorAll('.mood-btn');
botones.forEach(btn => {
    btn.addEventListener('click', () => {
        botones.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        estadoSeleccionado = btn.getAttribute('data-mood');
        colorSeleccionado = btn.getAttribute('data-color');
    });
});

// Enviar datos al backend
document.getElementById('moodForm').addEventListener('submit', function (e) {
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
            // Resetar opciones tras guardar
            botones.forEach(b => b.classList.remove('selected'));
            estadoSeleccionado = '';
            colorSeleccionado = '';
            document.getElementById('momento').value = "";
        })
        .catch(error => alert('Error: ' + error.message));
});