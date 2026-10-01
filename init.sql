CREATE DATABASE IF NOT EXISTS MoodTrackerLocal;
USE MoodTrackerLocal;

CREATE TABLE IF NOT EXISTS RegistrosMood (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fecha DATE NOT NULL,
    momento_dia VARCHAR(20) NOT NULL,
    estado_animo VARCHAR(30) NOT NULL,
    color_hex VARCHAR(10) NOT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(fecha, momento_dia)
);

CREATE TABLE IF NOT EXISTS RegistrosSleep (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fecha DATE NOT NULL,
    horas DECIMAL(4, 2) NOT NULL,
    calidad VARCHAR(20) NOT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(fecha)
);