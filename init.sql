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
    hora_dormir VARCHAR(5) NULL DEFAULT NULL,
    hora_despertar VARCHAR(5) NULL DEFAULT NULL,
    es_desvelo TINYINT(1) NOT NULL DEFAULT 0,
    tipo_registro VARCHAR(30) NOT NULL DEFAULT 'normal',
    motivo_desvelo VARCHAR(500) NULL DEFAULT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sleep_fecha (fecha)
);

CREATE TABLE IF NOT EXISTS RegistrosCrisis (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fecha DATE NOT NULL,
    hora VARCHAR(5) NOT NULL,
    tipo_crisis VARCHAR(40) NOT NULL,
    intensidad TINYINT NOT NULL DEFAULT 3,
    motivo VARCHAR(1000) NOT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_crisis_fecha (fecha, hora)
);

CREATE TABLE IF NOT EXISTS RegistrosAgenda (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fecha DATE NOT NULL,
    bloque VARCHAR(30) NOT NULL,
    hora TIME NOT NULL,
    actividad VARCHAR(255) NOT NULL,
    tipo ENUM('evento', 'tarea') NOT NULL DEFAULT 'evento',
    categoria ENUM('universidad', 'personal') NOT NULL DEFAULT 'personal',
    materia_id VARCHAR(60) NULL DEFAULT NULL,
    materia_nombre VARCHAR(120) NULL DEFAULT NULL,
    estado ENUM('todo', 'in_progress', 'done') NOT NULL DEFAULT 'todo',
    completada TINYINT(1) NOT NULL DEFAULT 0,
    recordatorio_min SMALLINT NULL DEFAULT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agenda_fecha (fecha),
    INDEX idx_agenda_categoria_estado (categoria, estado),
    INDEX idx_agenda_materia (materia_id)
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

-- =========================================================================
-- MÓDULO DE APRENDIZAJE DE INGLÉS CON MÚSICA (SÓLO METADATOS, SIN LETRAS)
-- Las letras largas y notas detalladas se cifran E2EE hacia Word en tu PC.
-- =========================================================================

CREATE TABLE IF NOT EXISTS MusicaArtistas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    nombre VARCHAR(140) NOT NULL,
    nombre_normalizado VARCHAR(140) NOT NULL,
    tipo_artista ENUM('solo','group','duo','collab_project') NOT NULL DEFAULT 'solo',
    notas_cortas VARCHAR(255) NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_usuario_artista (usuario_id, nombre_normalizado),
    FOREIGN KEY (usuario_id) REFERENCES Usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS MusicaAlbumes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    artista_principal_id INT NULL,
    titulo VARCHAR(180) NOT NULL,
    titulo_normalizado VARCHAR(180) NOT NULL,
    tipo_lanzamiento ENUM('album','mini_album','ep','single','ost','collab_single') NOT NULL DEFAULT 'album',
    anio SMALLINT NULL,
    notas_cortas VARCHAR(255) NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_album_usuario (usuario_id, artista_principal_id),
    FOREIGN KEY (usuario_id) REFERENCES Usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (artista_principal_id) REFERENCES MusicaArtistas(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS MusicaCanciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    album_id INT NULL,
    titulo VARCHAR(180) NOT NULL,
    numero_pista SMALLINT NULL,
    idioma VARCHAR(40) NOT NULL DEFAULT 'English',
    yt_music_url VARCHAR(500) NULL,
    yt_video_id VARCHAR(32) NULL,
    thumbnail_url VARCHAR(500) NULL,
    estado_estudio ENUM('to_study','in_progress','mastered') NOT NULL DEFAULT 'to_study',
    enfoque_corto VARCHAR(255) NULL,
    word_sincronizado BOOLEAN NOT NULL DEFAULT FALSE,
    ultimo_estudio_en DATETIME NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cancion_usuario (usuario_id, album_id, estado_estudio),
    FOREIGN KEY (usuario_id) REFERENCES Usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (album_id) REFERENCES MusicaAlbumes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS MusicaCancionArtistas (
    cancion_id INT NOT NULL,
    artista_id INT NOT NULL,
    rol ENUM('main','feat','collab','producer') NOT NULL DEFAULT 'main',
    orden SMALLINT NOT NULL DEFAULT 1,
    PRIMARY KEY (cancion_id, artista_id),
    INDEX idx_mca_artista (artista_id, rol),
    FOREIGN KEY (cancion_id) REFERENCES MusicaCanciones(id) ON DELETE CASCADE,
    FOREIGN KEY (artista_id) REFERENCES MusicaArtistas(id) ON DELETE CASCADE
);

-- =========================================================================
-- PROGRESO DE LECCIONES Y PRÁCTICAS (ZERO-BLOAT: SÓLO ID, NOMBRE Y ESTADO)
-- El contenido de las prácticas y cuestionarios se guarda en el Word local.
-- =========================================================================
CREATE TABLE IF NOT EXISTS EstudioLecciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    idioma ENUM('en', 'ko') NOT NULL DEFAULT 'en',
    codigo_leccion VARCHAR(60) NOT NULL,
    nombre_practica VARCHAR(180) NOT NULL,
    orden_secuencia SMALLINT NOT NULL DEFAULT 1,
    completada TINYINT(1) NOT NULL DEFAULT 0,
    word_leido_en DATETIME NULL DEFAULT NULL,
    completada_en DATETIME NULL DEFAULT NULL,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_usuario_leccion (usuario_id, codigo_leccion),
    INDEX idx_leccion_orden (usuario_id, idioma, orden_secuencia),
    FOREIGN KEY (usuario_id) REFERENCES Usuarios(id) ON DELETE CASCADE
);