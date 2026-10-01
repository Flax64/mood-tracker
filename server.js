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
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});

db.connect(err => {
    if (err) throw err;
    console.log('Conectado a la Base de Datos');
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

// Ruta para consultar con el fin de llenar el calendario
app.get('/api/get-moods', (req, res) => {
    const { inicio, fin } = req.query;

    // Busca los registros cuya fecha esté entre el Lunes y el Domingo seleccionados
    const sql = 'SELECT fecha, momento_dia, color_hex FROM RegistrosMood WHERE fecha BETWEEN ? AND ?';

    db.query(sql, [inicio, fin], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al consultar la base de datos');
        }
        res.json(results); // Devuelve los registros al frontend
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});