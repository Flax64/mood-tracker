require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors')
const path = require('path');
const e = require('express');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de MySQL
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

db.getConnection((err, connection) => {
    if (err) throw err;
    console.log('Conectado a la Base de Datos');
    connection.release();
});

// Ruta para guardar el estado de ánimo (Tu código)
app.post('/api/insert-mood', (req, res) => {
    const { fecha, momento_dia, estado_animo, color_hex } = req.body;

    const checkSql = 'SELECT * FROM RegistrosMood WHERE fecha = ? AND momento_dia = ?';

    db.query(checkSql, [fecha, momento_dia], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al consultar la base de datos');
        }

        if (result.length > 0) {
            if (puedeModificar(fecha, momento_dia)) {
                const sqlUpdate = 'UPDATE RegistrosMood SET estado_animo = ?, color_hex = ? WHERE fecha = ? AND momento_dia = ?';
                db.query(sqlUpdate, [estado_animo, color_hex, fecha, momento_dia], (errUpdate) => {
                    if (errUpdate) {
                        console.error(errUpdate);
                        return res.status(500).send('Error al actualizar el registro');
                    }
                    res.send('Registro actualizado correctamente \nAún estabas a tiempo');
                });
            } else {
                res.status(400).send('El lapso de tiempo para modificar este momento del día ya expiró');
            }
        } else {
            const sqlInsert = 'INSERT INTO RegistrosMood (fecha, momento_dia, estado_animo, color_hex) VALUES (?, ?, ?, ?)';
            db.query(sqlInsert, [fecha, momento_dia, estado_animo, color_hex], (errInsert) => {
                if (errInsert) {
                    console.error(errInsert);
                    return res.status(500).send('Error al guardar en la base de datos');
                }

                res.send('Estado de ánimo registrado correctamente')
            });
        }
    });
});

// Ruta para dar de alta un nuevo registro de sueño
app.post('/api/insert-sleep', (req, res) => {
    const { fecha, horas, calidad } = req.body;

    const sql = 'INSERT INTO RegistrosSleep (fecha, horas, calidad) VALUES (?, ?, ?)';
    db.query(sql, [fecha, horas, calidad], (err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al guardar el registro de sueño');
        }
        res.send('Registro de sueño gruardado con éxito');
    });
});

// Ruta para consultar con el fin de llenar el calendario
app.get('/api/get-moods', (req, res) => {
    const { begin, end } = req.query;

    // Busca los registros cuya fecha esté entre el Lunes y el Domingo seleccionados
    const sql = 'SELECT fecha, momento_dia, color_hex FROM RegistrosMood WHERE fecha BETWEEN ? AND ?';

    db.query(sql, [begin, end], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al consultar la base de datos');
        }
        res.json(result);
    });
});

// Ruta para consultar con el fin de consultar las horas de sueño
app.get('/api/get-sleep', (req, res) => {
    const { begin, end } = req.query;

    const sql = 'SELECT fecha, horas, calidad FROM RegistrosSleep WHERE fecha BETWEEN ? AND ?';

    db.query(sql, [begin, end], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al consultar la base de datos');
        }
        res.json(result);
    });
});

// Funcion que verifica si aun es tiempo de poder modifiar un estado de animo
function puedeModificar(fecha, momento_dia) {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const currentDate = `${year}-${month}-${day}`;

    // 1. Si la fecha que intentas modificar no es hoy, se bloquea automáticamente
    if (fecha !== currentDate) {
        return false;
    }

    // 2. Si es hoy, validamos el rango de horas (formato 24h)
    const hour = now.getHours();
    switch (momento_dia) {
        case 'Morning':
            return hour >= 6 && hour < 12;
        case 'Noon':
            return hour >= 12 && hour < 14;
        case 'Afternoon':
            return hour >= 14 && hour < 20;
        case 'Night':
            return hour >= 20 || hour < 6;
        default:
            return false;
    }
}

// Memoria temporal para guardar los textos
let colaDeTextos = [];

// 1. Ruta para que tu página web mande el texto al servidor
app.post('/api/send-to-pc', (req, res) => {
    const { texto } = req.body;
    if (texto) {
        colaDeTextos.push(texto);
        res.send('Texto encolado esperando a tu PC');
    } else {
        res.status(400).send('El texto no puede estar vacío');
    }
});

// 2. Ruta para que tu PC consulte si hay textos nuevos
app.get('/api/pull-text', (req, res) => {
    // Enviamos los textos a la PC
    res.json(colaDeTextos);
    // Vaciamos la cola inmediatamente para no repetir textos
    colaDeTextos = [];
});

// ==========================================
// RUTAS PARA LA AGENDA PERSONAL SEMANAL
// ==========================================
const BLOQUES_VALIDOS = new Set(['manana', 'cole', 'tarde', 'noche']);

function validarDatosAgenda({ fecha, bloque, hora, actividad }) {
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return 'La fecha debe tener el formato YYYY-MM-DD.';
    }
    if (!bloque || !BLOQUES_VALIDOS.has(bloque)) {
        return 'Bloque del día no válido.';
    }
    if (!hora || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(hora)) {
        return 'La hora debe tener el formato HH:MM.';
    }
    if (typeof actividad !== 'string' || !actividad.trim()) {
        return 'La descripción de la actividad es obligatoria.';
    }
    if (actividad.trim().length > 255) {
        return 'La actividad no puede exceder 255 caracteres.';
    }
    return null;
}

function parseAgendaId(rawId) {
    const id = Number(rawId);
    return Number.isInteger(id) && id > 0 ? id : null;
}

// Consultar actividades de la agenda por rango de fechas
app.get('/api/get-agenda', (req, res) => {
    const { begin, end } = req.query;
    if (!begin || !end || !/^\d{4}-\d{2}-\d{2}$/.test(begin) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        return res.status(400).send('Parámetros begin y end requeridos (YYYY-MM-DD).');
    }

    const sql = `
        SELECT id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, bloque,
               TIME_FORMAT(hora, '%H:%i') AS hora, actividad, completada
        FROM RegistrosAgenda
        WHERE fecha BETWEEN ? AND ?
        ORDER BY fecha ASC, hora ASC, id ASC
    `;

    db.query(sql, [begin, end], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al consultar la agenda en la base de datos');
        }
        res.json(result);
    });
});

// Crear nueva actividad en la agenda
app.post('/api/insert-agenda', (req, res) => {
    const errorValidacion = validarDatosAgenda(req.body);
    if (errorValidacion) {
        return res.status(400).send(errorValidacion);
    }

    const { fecha, bloque, hora } = req.body;
    const actividad = req.body.actividad.trim();
    const horaNormalizada = hora.slice(0, 5);

    const sql = 'INSERT INTO RegistrosAgenda (fecha, bloque, hora, actividad, completada) VALUES (?, ?, ?, ?, 0)';
    db.query(sql, [fecha, bloque, horaNormalizada, actividad], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al guardar la actividad en la agenda');
        }
        res.status(201).json({
            message: 'Actividad registrada correctamente',
            item: {
                id: result.insertId,
                fecha,
                bloque,
                hora: horaNormalizada,
                actividad,
                completada: 0
            }
        });
    });
});

// Editar una actividad existente de la agenda
app.put('/api/update-agenda/:id', (req, res) => {
    const id = parseAgendaId(req.params.id);
    if (!id) return res.status(400).send('ID de actividad no válido.');

    const errorValidacion = validarDatosAgenda(req.body);
    if (errorValidacion) {
        return res.status(400).send(errorValidacion);
    }

    const { fecha, bloque, hora } = req.body;
    const actividad = req.body.actividad.trim();
    const horaNormalizada = hora.slice(0, 5);

    const sql = 'UPDATE RegistrosAgenda SET fecha = ?, bloque = ?, hora = ?, actividad = ? WHERE id = ?';
    db.query(sql, [fecha, bloque, horaNormalizada, actividad, id], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al actualizar la actividad');
        }
        if (result.affectedRows === 0) {
            return res.status(404).send('Actividad no encontrada');
        }
        res.json({
            message: 'Actividad actualizada correctamente',
            item: { id, fecha, bloque, hora: horaNormalizada, actividad }
        });
    });
});

// Marcar o desmarcar una actividad como completada
app.patch('/api/toggle-agenda/:id', (req, res) => {
    const id = parseAgendaId(req.params.id);
    if (!id) return res.status(400).send('ID de actividad no válido.');

    const completada = req.body && req.body.completada !== undefined
        ? (req.body.completada ? 1 : 0)
        : null;

    const sql = completada === null
        ? 'UPDATE RegistrosAgenda SET completada = NOT completada WHERE id = ?'
        : 'UPDATE RegistrosAgenda SET completada = ? WHERE id = ?';
    const params = completada === null ? [id] : [completada, id];

    db.query(sql, params, (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al actualizar el estado de la actividad');
        }
        if (result.affectedRows === 0) {
            return res.status(404).send('Actividad no encontrada');
        }
        res.json({ message: 'Estado actualizado', id, completada });
    });
});

// Eliminar una actividad de la agenda
app.delete('/api/delete-agenda/:id', (req, res) => {
    const id = parseAgendaId(req.params.id);
    if (!id) return res.status(400).send('ID de actividad no válido.');

    const sql = 'DELETE FROM RegistrosAgenda WHERE id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al eliminar la actividad');
        }
        if (result.affectedRows === 0) {
            return res.status(404).send('Actividad no encontrada');
        }
        res.json({ message: 'Actividad eliminada correctamente', id });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});

// Capturar errores imprevistos para saber por qué se cayó
process.on('uncaughtException', (err) => {
    console.error(`\n[CRASH] ${new Date().toISOString()} - El servidor se cayó por este error:`);
    console.error(err);
    process.exit(1); // Obliga a cerrar el proceso para que Docker lo reinicie
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`\n[CRASH] ${new Date().toISOString()} - Promesa no manejada:`, reason);
    process.exit(1);
});