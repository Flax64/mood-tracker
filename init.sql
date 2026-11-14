-- Docker ejecuta este script dentro de la base de datos definida en MYSQL_DATABASE (.env)
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
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS RegistrosAgenda (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fecha DATE NOT NULL,
    bloque VARCHAR(30) NOT NULL,
    hora TIME NOT NULL,
    actividad VARCHAR(255) NOT NULL,
    completada TINYINT(1) NOT NULL DEFAULT 0,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agenda_fecha (fecha)
);