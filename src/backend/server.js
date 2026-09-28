const express = require('express');
const mysql = require('mysql2');
const cors = require('cors')

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de MySQL
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});

db.connect(err => {
    if(err) throw err;
    console.log('Conectado a la BD MoodTrackerLocal');
});

// Ruta para guardar el estado de ánimo
app.post('/api/mood', (req, res) => {
    const {fecha, momento_dia, estado_animo, color_hex} = req.body;

    const sql = 'INSERT INTO RegistrosMood (fecha, momento_dia, estado_animo, color_hex) VALUES (?, ?, ?, ?)';

    db.query(sql, [fecha, momento_dia, estado_animo, color_hex], (err, result) => {
        if (err) {
            if(err.code === 'ER_DUP_ENTRY'){
                return res.status(400).send('Ya registraste tu estado de ánimo para este momento del día');
            }
            console.error(err);
            return res.status(500).send('Error al guardar en la base de datos');
        }
        res.send('Estado de ánimo registrado correctamente');
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});