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
    tipo ENUM('evento', 'tarea') NOT NULL DEFAULT 'evento',
    categoria ENUM('universidad', 'personal') NOT NULL DEFAULT 'personal',
    estado ENUM('todo', 'in_progress', 'done') NOT NULL DEFAULT 'todo',
    completada TINYINT(1) NOT NULL DEFAULT 0,
    recordatorio_min SMALLINT NULL DEFAULT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agenda_fecha (fecha),
    INDEX idx_agenda_categoria_estado (categoria, estado)
);

CREATE TABLE IF NOT EXISTS Usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol ENUM('admin', 'psiquiatra') NOT NULL DEFAULT 'psiquiatra',
    estado ENUM('activo', 'inactivo', 'suspendido') NOT NULL DEFAULT 'activo',
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS SesionesAuth (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expira_en DATETIME NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sesion_token (token_hash),
    INDEX idx_sesion_expira (expira_en),
    FOREIGN KEY (usuario_id) REFERENCES Usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS CodigosSeguridad (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(150) NOT NULL,
    tipo ENUM('registro', 'reset', 'mfa') NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expira_en DATETIME NOT NULL,
    usado TINYINT(1) NOT NULL DEFAULT 0,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_codigo_email_tipo (email, tipo)
);

CREATE TABLE IF NOT EXISTS ConfiguracionUsuario (
    usuario_id INT PRIMARY KEY,
    config_json LONGTEXT NOT NULL,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES Usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS RecordatoriosEstado (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    clave_unica VARCHAR(120) NOT NULL,
    tipo VARCHAR(30) NOT NULL,
    ref_id INT NULL,
    titulo VARCHAR(140) NOT NULL,
    mensaje VARCHAR(320) NOT NULL,
    estado ENUM('active', 'snoozed', 'sent', 'dismissed') NOT NULL DEFAULT 'active',
    snooze_hasta DATETIME NULL,
    enviado_push_en DATETIME NULL,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_usuario_clave (usuario_id, clave_unica),
    INDEX idx_rec_estado (usuario_id, estado),
    FOREIGN KEY (usuario_id) REFERENCES Usuarios(id) ON DELETE CASCADE
);