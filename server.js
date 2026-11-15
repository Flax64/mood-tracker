require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const {
    TRANSPORT_PROTOCOL,
    createTransportManager
} = require('./lib/transport-crypto');
const {
    RECOMMENDED_GEMINI_MODELS,
    getLanguageRegistry,
    normalizeStudyLanguage,
    validateGeminiModelId,
    hangulToRomanization,
    detectScriptKind,
    sanitizeLanguageMemory,
    mergeLanguageMemory,
    normalizeTranslationDirection,
    analyzeTextOffline,
    analyzeWithGemini,
    translateOffline,
    translateWithGemini
} = require('./lib/language-studio');

const transportManager = createTransportManager();

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'loopback') {
    app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : 'loopback');
}

// Cabeceras de seguridad HTTP
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(), camera=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com; frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com; connect-src 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
    );
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    if (req.secure || proto === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

app.use(cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-Idempotency-Key', 'X-Transport-Session', 'X-Transport-Accept-Enc'],
    exposedHeaders: ['X-Transport-Encrypted', 'X-Transport-Inner-Type', 'X-Transport-Rehandshake', 'X-Transport-Server-Ms']
}));
app.use(express.json({ limit: '512kb' }));
app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).send('Invalid JSON payload.');
    }
    if (err && err.type === 'entity.too.large') {
        return res.status(413).send('Request payload exceeds maximum allowed size.');
    }
    return next(err);
});
app.use('/api', (req, res, next) => {
    if (req.path === '/transport/handshake') {
        return next();
    }

    const headerKid = typeof req.headers['x-transport-session'] === 'string'
        ? req.headers['x-transport-session'].trim()
        : '';
    const wantsEncryptedRes = req.headers['x-transport-accept-enc'] === '1';

    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) && req.body.__enc) {
        try {
            const t0 = performance.now();
            const dec = transportManager.decryptEnvelope(req.body, 'c2s');
            req.transportDecryptMs = Number((performance.now() - t0).toFixed(3));
            req.transportSession = dec.session;
            req.transportSeq = dec.seq;
            req.transportEncryptedIn = true;

            if (dec.plaintext === '') {
                req.body = {};
            } else {
                const parsed = JSON.parse(dec.plaintext);
                req.body = parsed;
            }
        } catch (err) {
            if (err && err.code === 'TRANSPORT_SESSION_EXPIRED') {
                res.setHeader('X-Transport-Rehandshake', '1');
            }
            return res.status(err.status || 400).json({
                error: err.message || 'Encrypted transport decryption failed.',
                code: err.code || 'TRANSPORT_ERROR'
            });
        }
    } else if (headerKid) {
        try {
            req.transportSession = transportManager.getActiveSession(headerKid, { touch: true });
        } catch (err) {
            res.setHeader('X-Transport-Rehandshake', '1');
            return res.status(428).json({
                error: err.message || 'Transport session expired.',
                code: 'TRANSPORT_SESSION_EXPIRED'
            });
        }
    }

    if (req.transportSession && wantsEncryptedRes && !res.locals._transportWrapped) {
        res.locals._transportWrapped = true;
        const rawJson = res.json.bind(res);
        const rawSend = res.send.bind(res);
        let encryptingOut = false;

        const sendEncrypted = (plaintextStr, innerType) => {
            if (encryptingOut) return rawSend(plaintextStr);
            encryptingOut = true;
            try {
                const tEnc0 = performance.now();
                const envelope = transportManager.encryptPayload(
                    req.transportSession.kid,
                    plaintextStr,
                    's2c',
                    req.transportSeq || 0
                );
                res.setHeader('X-Transport-Encrypted', TRANSPORT_PROTOCOL);
                res.setHeader('X-Transport-Inner-Type', innerType);
                res.setHeader('X-Transport-Server-Ms', String(Number((performance.now() - tEnc0).toFixed(3))));
                return rawJson(envelope);
            } finally {
                encryptingOut = false;
            }
        };

        res.json = (body) => {
            if (encryptingOut) return rawJson(body);
            return sendEncrypted(JSON.stringify(body === undefined ? null : body), 'application/json; charset=utf-8');
        };

        res.send = (body) => {
            if (encryptingOut) return rawSend(body);
            if (body === undefined || body === null) {
                return sendEncrypted('', 'text/plain; charset=utf-8');
            }
            if (Buffer.isBuffer(body)) {
                return rawSend(body);
            }
            if (typeof body === 'object') {
                return sendEncrypted(JSON.stringify(body), 'application/json; charset=utf-8');
            }
            const currentType = String(res.getHeader('Content-Type') || 'text/plain; charset=utf-8');
            return sendEncrypted(String(body), currentType);
        };
    }

    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        if (req.body === undefined) {
            req.body = {};
        } else if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).send('Request body must be a valid JSON object.');
        }
    }
    return next();
});
app.use(express.static(path.join(__dirname, 'public'), {
    etag: true,
    maxAge: '10m',
    setHeaders(res, filePath) {
        if (/\.(js|css)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        }
    }
}));

// Configuración de MySQL optimizada para poca RAM (t3.micro)
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 4,
    maxIdle: 2,
    idleTimeout: 60000,
    enableKeepAlive: false
});

function inicializarTablasSeguridad() {
    const tablasSql = [
        `CREATE TABLE IF NOT EXISTS RegistrosAgenda (
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
        )`,
        `CREATE TABLE IF NOT EXISTS Usuarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(80) NOT NULL,
            email VARCHAR(150) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            rol ENUM('admin', 'psiquiatra') NOT NULL DEFAULT 'psiquiatra',
            estado ENUM('activo', 'inactivo', 'suspendido') NOT NULL DEFAULT 'activo',
            fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS SesionesAuth (
            id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            expira_en DATETIME NOT NULL,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_sesion_token (token_hash),
            INDEX idx_sesion_expira (expira_en),
            FOREIGN KEY (usuario_id) REFERENCES Usuarios(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS CodigosSeguridad (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(150) NOT NULL,
            tipo ENUM('registro', 'reset', 'mfa') NOT NULL,
            token_hash CHAR(64) NOT NULL,
            expira_en DATETIME NOT NULL,
            usado TINYINT(1) NOT NULL DEFAULT 0,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_codigo_email_tipo (email, tipo)
        )`,
        `CREATE TABLE IF NOT EXISTS ConfiguracionUsuario (
            usuario_id INT PRIMARY KEY,
            config_json LONGTEXT NOT NULL,
            actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES Usuarios(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS RecordatoriosEstado (
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
        )`,
        `CREATE TABLE IF NOT EXISTS RegistrosSleep (
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
        )`,
        `CREATE TABLE IF NOT EXISTS RegistrosCrisis (
            id INT AUTO_INCREMENT PRIMARY KEY,
            fecha DATE NOT NULL,
            hora VARCHAR(5) NOT NULL,
            tipo_crisis VARCHAR(40) NOT NULL,
            intensidad TINYINT NOT NULL DEFAULT 3,
            motivo VARCHAR(1000) NOT NULL,
            fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_crisis_fecha (fecha, hora)
        )`
    ];
    tablasSql.forEach(sql => {
        db.query(sql, err => {
            if (err) console.error('Error asegurando tabla:', err.message);
        });
    });

    const musicaTablasSql = [
        `CREATE TABLE IF NOT EXISTS MusicaArtistas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT NOT NULL,
            nombre VARCHAR(140) NOT NULL,
            nombre_normalizado VARCHAR(140) NOT NULL,
            tipo_artista ENUM('solo','group','duo','collab_project') NOT NULL DEFAULT 'solo',
            notas_cortas VARCHAR(255) NULL,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_usuario_artista (usuario_id, nombre_normalizado),
            FOREIGN KEY (usuario_id) REFERENCES Usuarios(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS MusicaAlbumes (
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
        )`,
        `CREATE TABLE IF NOT EXISTS MusicaCanciones (
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
        )`,
        `CREATE TABLE IF NOT EXISTS MusicaCancionArtistas (
            cancion_id INT NOT NULL,
            artista_id INT NOT NULL,
            rol ENUM('main','feat','collab','producer') NOT NULL DEFAULT 'main',
            orden SMALLINT NOT NULL DEFAULT 1,
            PRIMARY KEY (cancion_id, artista_id),
            INDEX idx_mca_artista (artista_id, rol),
            FOREIGN KEY (cancion_id) REFERENCES MusicaCanciones(id) ON DELETE CASCADE,
            FOREIGN KEY (artista_id) REFERENCES MusicaArtistas(id) ON DELETE CASCADE
        )`
    ];
    const ejecutarTablasMusicaSecuencial = idx => {
        if (idx >= musicaTablasSql.length) return;
        db.query(musicaTablasSql[idx], err => {
            if (err) console.error('Error asegurando tabla musical:', err.message);
            ejecutarTablasMusicaSecuencial(idx + 1);
        });
    };
    ejecutarTablasMusicaSecuencial(0);

    // Migración automática idempotente para bases de datos ya existentes
    const agendaCols = [
        {
            name: 'tipo',
            sql: "ALTER TABLE RegistrosAgenda ADD COLUMN tipo ENUM('evento', 'tarea') NOT NULL DEFAULT 'evento' AFTER actividad"
        },
        {
            name: 'categoria',
            sql: "ALTER TABLE RegistrosAgenda ADD COLUMN categoria ENUM('universidad', 'personal') NOT NULL DEFAULT 'personal' AFTER tipo"
        },
        {
            name: 'estado',
            sql: "ALTER TABLE RegistrosAgenda ADD COLUMN estado ENUM('todo', 'in_progress', 'done') NOT NULL DEFAULT 'todo' AFTER categoria",
            afterMigrate: "UPDATE RegistrosAgenda SET estado = 'done' WHERE completada = 1"
        },
        {
            name: 'recordatorio_min',
            sql: 'ALTER TABLE RegistrosAgenda ADD COLUMN recordatorio_min SMALLINT NULL DEFAULT NULL AFTER completada'
        }
    ];
    agendaCols.forEach(col => {
        db.query('SHOW COLUMNS FROM RegistrosAgenda LIKE ?', [col.name], (errCol, cols) => {
            if (!errCol && Array.isArray(cols) && cols.length === 0) {
                db.query(col.sql, (errAlt) => {
                    if (errAlt) {
                        console.error(`Error migrando columna ${col.name} en RegistrosAgenda:`, errAlt.message);
                    } else if (col.afterMigrate) {
                        db.query(col.afterMigrate, () => {});
                    }
                });
            }
        });
    });

    const sleepCols = [
        {
            name: 'hora_dormir',
            sql: 'ALTER TABLE RegistrosSleep ADD COLUMN hora_dormir VARCHAR(5) NULL DEFAULT NULL AFTER calidad'
        },
        {
            name: 'hora_despertar',
            sql: 'ALTER TABLE RegistrosSleep ADD COLUMN hora_despertar VARCHAR(5) NULL DEFAULT NULL AFTER hora_dormir'
        },
        {
            name: 'es_desvelo',
            sql: 'ALTER TABLE RegistrosSleep ADD COLUMN es_desvelo TINYINT(1) NOT NULL DEFAULT 0 AFTER hora_despertar'
        },
        {
            name: 'tipo_registro',
            sql: "ALTER TABLE RegistrosSleep ADD COLUMN tipo_registro VARCHAR(30) NOT NULL DEFAULT 'normal' AFTER es_desvelo"
        },
        {
            name: 'motivo_desvelo',
            sql: 'ALTER TABLE RegistrosSleep ADD COLUMN motivo_desvelo VARCHAR(500) NULL DEFAULT NULL AFTER tipo_registro'
        }
    ];
    const ejecutarMigracionSleepSecuencial = (idx = 0) => {
        if (idx >= sleepCols.length) return;
        const col = sleepCols[idx];
        db.query('SHOW COLUMNS FROM RegistrosSleep LIKE ?', [col.name], (errCol, cols) => {
            if (!errCol && Array.isArray(cols) && cols.length === 0) {
                db.query(col.sql, (errAlt) => {
                    if (errAlt) {
                        console.error(`Error migrando columna ${col.name} en RegistrosSleep:`, errAlt.message);
                    }
                    ejecutarMigracionSleepSecuencial(idx + 1);
                });
            } else {
                ejecutarMigracionSleepSecuencial(idx + 1);
            }
        });
    };
    ejecutarMigracionSleepSecuencial(0);
    db.query("SHOW COLUMNS FROM Usuarios LIKE 'estado'", (errCol, cols) => {
        if (!errCol && Array.isArray(cols) && cols.length === 0) {
            db.query(
                "ALTER TABLE Usuarios ADD COLUMN estado ENUM('activo', 'inactivo', 'suspendido') NOT NULL DEFAULT 'activo' AFTER rol",
                (errAlt) => {
                    if (errAlt) console.error('Error migrando columna estado en Usuarios:', errAlt.message);
                }
            );
        }
    });

    db.query("SHOW COLUMNS FROM CodigosSeguridad LIKE 'tipo'", (errCol, cols) => {
        if (!errCol && Array.isArray(cols) && cols.length > 0 && !String(cols[0].Type || '').includes("'mfa'")) {
            db.query(
                "ALTER TABLE CodigosSeguridad MODIFY COLUMN tipo ENUM('registro', 'reset', 'mfa') NOT NULL",
                (errAlt) => {
                    if (errAlt) console.error('Error migrando enum tipo en CodigosSeguridad:', errAlt.message);
                }
            );
        }
    });
}

db.getConnection((err, connection) => {
    if (err) throw err;
    console.log('Conectado a la Base de Datos');
    connection.release();
    inicializarTablasSeguridad();
});

// ==========================================
// UTILIDADES DE SEGURIDAD, SESIONES Y CORREO
// ==========================================
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'flavio.flax1234@gmail.com').trim().toLowerCase();
const BCRYPT_ROUNDS = 12;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const ESTADOS_CUENTA_VALIDOS = new Set(['activo', 'inactivo', 'suspendido']);
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
const ENABLE_LOGIN_MFA = String(process.env.ENABLE_LOGIN_MFA || 'false').trim().toLowerCase() === 'true';
const MFA_HMAC_SECRET = String(
    process.env.MFA_CHALLENGE_SECRET ||
    process.env.ADMIN_SECRET ||
    process.env.JOURNAL_SECRET_KEY ||
    process.env.DB_PASS ||
    crypto.randomBytes(32).toString('hex')
);

function parsePositiveInt(rawVal, fallback) {
    const num = Number(rawVal);
    return Number.isInteger(num) && num > 0 ? num : fallback;
}

function normalizeEmail(raw) {
    if (typeof raw !== 'string') return '';
    if (/[\r\n\0]/.test(raw)) return '';
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed || trimmed.length > 150 || trimmed.includes('..') || !EMAIL_REGEX.test(trimmed)) {
        return '';
    }
    return trimmed;
}

function validatePasswordFormat(password) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        return 'Password must be between 8 and 128 characters long.';
    }
    if (/[\x00-\x1f\x7f]/.test(password)) {
        return 'Password cannot contain control characters.';
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        return 'Password must be 8–128 characters long and include at least one letter and one number.';
    }
    return null;
}

function requireNonEmptyBody(req, res, next) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length === 0) {
        return res.status(400).send('Request body cannot be empty.');
    }
    return next();
}

function signMfaChallenge(payload) {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', MFA_HMAC_SECRET).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
}

function verifyMfaChallenge(token) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [encoded, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', MFA_HMAC_SECRET).update(encoded).digest('base64url');
    if (!safeCompareStrings(sig, expectedSig)) return null;
    try {
        const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (!parsed || typeof parsed.userId !== 'number' || !parsed.email || Date.now() > Number(parsed.exp)) {
            return null;
        }
        return parsed;
    } catch (_) {
        return null;
    }
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeCompareStrings(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const hashA = crypto.createHash('sha256').update(a).digest();
    const hashB = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(hashA, hashB);
}

function formatMySqlDateTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

// Calcula el próximo domingo a las 00:00:00
function getNextSundayMidnight(fromDate = new Date()) {
    const d = new Date(fromDate);
    const day = d.getDay(); // 0 = Domingo
    const daysUntilSunday = day === 0 ? 7 : (7 - day);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysUntilSunday, 0, 0, 0, 0);
}

function parseCookies(req) {
    const raw = req.headers.cookie || '';
    const out = {};
    raw.split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx > 0) {
            const k = part.slice(0, idx).trim();
            const v = part.slice(idx + 1).trim();
            out[k] = decodeURIComponent(v);
        }
    });
    return out;
}

function setSessionCookie(res, rawToken, expiresAt) {
    const maxAgeSec = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    res.setHeader(
        'Set-Cookie',
        `mt_session=${encodeURIComponent(rawToken)}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; Expires=${expiresAt.toUTCString()}; SameSite=Lax`
    );
}

function clearSessionCookie(res) {
    res.setHeader(
        'Set-Cookie',
        'mt_session=; HttpOnly; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax'
    );
}

// Rate limiters en memoria con expiración, cabeceras estándar y limpieza automática (sin saturar RAM)
const MAX_RATE_LIMIT_ENTRIES = 1000;
const rateLimiterStores = [];

function getClientIp(req) {
    const raw = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    return String(raw).replace(/^::ffff:/, '') || 'unknown';
}

function pruneMapExpired(store, now = Date.now()) {
    for (const [k, rec] of store.entries()) {
        if (now > rec.resetAt) {
            store.delete(k);
        }
    }
}

setInterval(() => {
    const now = Date.now();
    rateLimiterStores.forEach(store => pruneMapExpired(store, now));
}, 5 * 60 * 1000).unref();

function createRateLimiter({
    maxAttempts = 60,
    windowMs = 60 * 1000,
    message = 'Too many requests. Please slow down and try again later.',
    keyGenerator = (req) => getClientIp(req)
} = {}) {
    const store = new Map();
    rateLimiterStores.push(store);

    function consume(key) {
        const now = Date.now();
        if (store.size >= MAX_RATE_LIMIT_ENTRIES && !store.has(key)) {
            pruneMapExpired(store, now);
            while (store.size >= MAX_RATE_LIMIT_ENTRIES) {
                const oldestKey = store.keys().next().value;
                if (oldestKey === undefined) break;
                store.delete(oldestKey);
            }
        }

        const record = store.get(key);
        if (!record || now > record.resetAt) {
            const resetAt = now + windowMs;
            store.set(key, { count: 1, resetAt });
            return {
                allowed: true,
                remaining: Math.max(0, maxAttempts - 1),
                resetAt,
                retryAfterSec: 0
            };
        }

        if (record.count >= maxAttempts) {
            return {
                allowed: false,
                remaining: 0,
                resetAt: record.resetAt,
                retryAfterSec: Math.max(1, Math.ceil((record.resetAt - now) / 1000))
            };
        }

        record.count += 1;
        return {
            allowed: true,
            remaining: Math.max(0, maxAttempts - record.count),
            resetAt: record.resetAt,
            retryAfterSec: 0
        };
    }

    function applyHeaders(res, result) {
        res.setHeader('X-RateLimit-Limit', String(maxAttempts));
        res.setHeader('X-RateLimit-Remaining', String(result.remaining));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
        if (!result.allowed) {
            res.setHeader('Retry-After', String(result.retryAfterSec));
        }
    }

    function middleware(req, res, next) {
        const key = String(keyGenerator(req) || getClientIp(req));
        const result = consume(key);
        applyHeaders(res, result);
        if (!result.allowed) {
            return res.status(429).send(message);
        }
        return next();
    }

    function reset(key) {
        store.delete(key);
    }

    return { consume, applyHeaders, middleware, reset };
}

const apiGlobalLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_API_MAX, 500),
    windowMs: parsePositiveInt(process.env.RATE_LIMIT_API_WINDOW_MS, 60 * 1000),
    message: 'Too many requests to the server. Please wait a moment and try again.'
});

const loginIpLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_LOGIN_IP_MAX, 30),
    windowMs: 15 * 60 * 1000,
    message: 'Too many login attempts from this IP. Please wait 15 minutes.'
});

const loginAccountLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_LOGIN_MAX, 10),
    windowMs: 15 * 60 * 1000,
    message: 'Too many failed attempts. Please wait 15 minutes.'
});

const regCodeLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_REGCODE_MAX, 6),
    windowMs: 15 * 60 * 1000,
    message: 'Too many verification code requests. Please wait a few minutes.'
});

const registerLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_REGISTER_MAX, 8),
    windowMs: 15 * 60 * 1000,
    message: 'Too many registration attempts. Please wait 15 minutes.'
});

const forgotPasswordLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_FORGOT_MAX, 5),
    windowMs: 15 * 60 * 1000,
    message: 'Too many password recovery requests. Please wait 15 minutes.'
});

const resetPasswordLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_RESET_MAX, 8),
    windowMs: 15 * 60 * 1000,
    message: 'Too many password reset attempts. Please wait 15 minutes.'
});

const mfaVerifyLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_MFA_MAX, 8),
    windowMs: 15 * 60 * 1000,
    message: 'Too many verification attempts. Please wait 15 minutes.'
});

const apiReadLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_READ_MAX, 120),
    windowMs: 60 * 1000,
    message: 'Too many read requests. Please slow down briefly.'
});

const apiWriteLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_WRITE_MAX, 60),
    windowMs: 60 * 1000,
    message: 'Too many write requests. Please slow down briefly.'
});

const pcQueueWriteLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_PC_WRITE_MAX, 120),
    windowMs: 60 * 1000,
    message: 'Too many PC sync enqueue requests. Please wait a moment.',
    keyGenerator: (req) => `${getClientIp(req)}:${req.path}`
});

const pcPullLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_PC_PULL_MAX, 60),
    windowMs: 60 * 1000,
    message: 'Too many PC sync polling requests. Please wait a moment.',
    keyGenerator: (req) => `${getClientIp(req)}:${req.path}`
});

const reminderActionLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_REMINDER_ACTION_MAX, 30),
    windowMs: 15 * 60 * 1000,
    message: 'Too many reminder actions. Please wait a moment.'
});

const transportHandshakeLimiter = createRateLimiter({
    maxAttempts: parsePositiveInt(process.env.RATE_LIMIT_HANDSHAKE_MAX, 120),
    windowMs: 60 * 1000,
    message: 'Too many transport handshake attempts. Please wait a moment.'
});

// Middleware global anti-DoS sobre /api/*
app.use('/api', apiGlobalLimiter.middleware);

// Limpieza periódica de sesiones y códigos vencidos para ahorrar espacio en MySQL
function limpiarRegistrosExpirados() {
    const nowSql = formatMySqlDateTime(new Date());
    const cutoff14Days = formatMySqlDateTime(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));
    db.query('DELETE FROM SesionesAuth WHERE expira_en <= ?', [nowSql], () => {});
    db.query('DELETE FROM CodigosSeguridad WHERE usado = 1 OR expira_en <= ?', [nowSql], () => {});
    db.query('DELETE FROM RecordatoriosEstado WHERE actualizado_en < ?', [cutoff14Days], () => {});
}

setInterval(limpiarRegistrosExpirados, 6 * 60 * 60 * 1000).unref();

// Transporte de correo (Gmail SMTP)
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getResetBaseUrl(req) {
    const envBase = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    if (envBase && /^https?:\/\/[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(envBase)) {
        return envBase;
    }

    const rawProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
        .split(',')[0]
        .trim()
        .toLowerCase();
    const proto = rawProto === 'https' ? 'https' : 'http';
    const rawHost = String(req.headers.host || '').trim();
    if (!/^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(rawHost)) {
        return `${proto}://localhost:${process.env.PORT || 3000}`;
    }
    return `${proto}://${rawHost}`;
}

function crearTransporterCorreo() {
    const smtpUser = (process.env.SMTP_USER || ADMIN_EMAIL).trim();
    const smtpPass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
    if (!smtpUser || !smtpPass) return null;

    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });
}

async function enviarCorreo({ to, subject, html }) {
    const transporter = crearTransporterCorreo();
    if (!transporter) {
        throw new Error('SMTP_USER and SMTP_PASS (Gmail App Password) are missing in .env or GitHub Secrets.');
    }
    const fromUser = (process.env.SMTP_USER || ADMIN_EMAIL).trim();
    try {
        await transporter.sendMail({
            from: `"Personal Daily Hub" <${fromUser}>`,
            to,
            subject,
            html
        });
    } catch (err) {
        if (err && (err.code === 'EAUTH' || err.responseCode === 535)) {
            throw new Error('Gmail rejected the SMTP credentials. Check that SMTP_USER and the 16-character App Password (SMTP_PASS) match.');
        }
        throw err;
    }
}

// Middleware de autenticación (incluye validación de estado de cuenta)
function requireAuth(req, res, next) {
    const cookies = parseCookies(req);
    const rawToken = cookies.mt_session;
    if (!rawToken || rawToken.length < 32) {
        return res.status(401).send('Session not started or expired.');
    }

    const tokenHash = sha256Hex(rawToken);
    const nowSql = formatMySqlDateTime(new Date());

    const sql = `
        SELECT s.id AS sesion_id, s.expira_en, u.id, u.nombre, u.email, u.rol, u.estado
        FROM SesionesAuth s
        INNER JOIN Usuarios u ON u.id = s.usuario_id
        WHERE s.token_hash = ? AND s.expira_en > ?
        LIMIT 1
    `;

    db.query(sql, [tokenHash, nowSql], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error verifying session.');
        }
        if (!rows || rows.length === 0) {
            clearSessionCookie(res);
            return res.status(401).send('Your session has expired. Please sign in again.');
        }

        const estadoCuenta = rows[0].estado || 'activo';
        if (estadoCuenta !== 'activo') {
            clearSessionCookie(res);
            db.query('DELETE FROM SesionesAuth WHERE token_hash = ?', [tokenHash], () => {});
            return res.status(403).send('Your account is inactive or suspended. Contact the administrator.');
        }

        req.user = {
            id: rows[0].id,
            nombre: rows[0].nombre,
            email: rows[0].email,
            rol: rows[0].rol,
            estado: estadoCuenta,
            expira_en: rows[0].expira_en
        };
        req.sessionTokenHash = tokenHash;
        next();
    });
}

function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
        if (req.user.rol !== 'admin') {
            return res.status(403).send('Read-only access: this account can only view the weekly summary.');
        }
        next();
    });
}

// ==========================================
// PROTECCIÓN CONTRA DOBLE ENVÍO, CONCURRENCIA E IDEMPOTENCIA
// ==========================================
const MAX_IDEMPOTENCY_ENTRIES = 300;
const IN_FLIGHT_MAX_AGE_MS = 60 * 1000;
const DEFAULT_IDEMPOTENCY_TTL_MS = 2 * 60 * 1000;
const IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9._:-]{1,128}$/;

const inFlightMutations = new Map();
const idempotencyReplayCache = new Map();
const recentSubmissionCache = new Map();

function pruneTimedMap(map, now = Date.now(), maxAgeMs = 0) {
    for (const [key, entry] of map.entries()) {
        if (maxAgeMs > 0) {
            if (now - entry > maxAgeMs) map.delete(key);
        } else if (now > entry.expiresAt) {
            map.delete(key);
        }
    }
}

function setBoundedMapEntry(map, key, value, maxEntries = MAX_IDEMPOTENCY_ENTRIES) {
    if (map.size >= maxEntries && !map.has(key)) {
        const now = Date.now();
        pruneTimedMap(map, now);
        while (map.size >= maxEntries) {
            const oldestKey = map.keys().next().value;
            if (oldestKey === undefined) break;
            map.delete(oldestKey);
        }
    }
    map.set(key, value);
}

setInterval(() => {
    const now = Date.now();
    pruneTimedMap(inFlightMutations, now, IN_FLIGHT_MAX_AGE_MS);
    pruneTimedMap(idempotencyReplayCache, now);
    pruneTimedMap(recentSubmissionCache, now);
}, 5 * 60 * 1000).unref();

function canonicalPayloadString(val) {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) {
        return `[${val.map(canonicalPayloadString).join(',')}]`;
    }
    if (typeof val === 'object') {
        const keys = Object.keys(val).sort();
        return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalPayloadString(val[k])}`).join(',')}}`;
    }
    return JSON.stringify(val);
}

function preventDuplicateSubmit(options = {}) {
    const {
        dedupeWindowMs = 0,
        ttlMs = DEFAULT_IDEMPOTENCY_TTL_MS,
        cacheReplay = true
    } = options;

    return (req, res, next) => {
        const rawKey = req.get('x-idempotency-key');
        const idemKey = typeof rawKey === 'string' ? rawKey.trim() : '';
        if (idemKey && !IDEMPOTENCY_KEY_REGEX.test(idemKey)) {
            return res.status(400).send('Invalid X-Idempotency-Key header.');
        }

        const now = Date.now();
        const actorId = req.user && req.user.id ? `u:${req.user.id}` : `ip:${req.ip || 'unknown'}`;
        const routePath = (req.originalUrl || req.url || '').split('?')[0];
        const routeKey = `${req.method}:${routePath}`;
        const payloadHash = sha256Hex(canonicalPayloadString(req.body || {}));
        const payloadKey = `${actorId}|${routeKey}|${payloadHash}`;
        const scopedIdemKey = idemKey ? `${actorId}|${routeKey}|k:${idemKey}` : '';

        if (cacheReplay && scopedIdemKey) {
            const cached = idempotencyReplayCache.get(scopedIdemKey);
            if (cached) {
                if (now <= cached.expiresAt) {
                    if (cached.payloadHash !== payloadHash) {
                        return res.status(409).send('Idempotency key cannot be reused with different data.');
                    }
                    res.setHeader('X-Idempotent-Replay', 'true');
                    if (cached.contentType) {
                        res.setHeader('Content-Type', cached.contentType);
                    }
                    return res.status(cached.status).send(cached.body);
                }
                idempotencyReplayCache.delete(scopedIdemKey);
            }
        }

        const existingPayloadFlight = inFlightMutations.get(payloadKey);
        const existingKeyFlight = scopedIdemKey ? inFlightMutations.get(scopedIdemKey) : undefined;
        if (
            (existingPayloadFlight && now - existingPayloadFlight < IN_FLIGHT_MAX_AGE_MS) ||
            (existingKeyFlight && now - existingKeyFlight < IN_FLIGHT_MAX_AGE_MS)
        ) {
            return res.status(409).send('Request is already being processed. Please wait.');
        }

        if (dedupeWindowMs > 0) {
            const recent = recentSubmissionCache.get(payloadKey);
            if (recent) {
                if (now <= recent.expiresAt) {
                    return res.status(409).send('Duplicate submission detected. Avoid sending identical data repeatedly.');
                }
                recentSubmissionCache.delete(payloadKey);
            }
        }

        inFlightMutations.set(payloadKey, now);
        if (scopedIdemKey) {
            inFlightMutations.set(scopedIdemKey, now);
        }

        let released = false;
        const releaseInFlight = () => {
            if (released) return;
            released = true;
            inFlightMutations.delete(payloadKey);
            if (scopedIdemKey) inFlightMutations.delete(scopedIdemKey);
        };
        res.on('finish', releaseInFlight);
        res.on('close', releaseInFlight);

        const originalSend = res.send.bind(res);
        let captured = false;
        res.send = function patchedSend(body) {
            if (!captured && res.statusCode >= 200 && res.statusCode < 300) {
                captured = true;
                const completedAt = Date.now();
                if (dedupeWindowMs > 0) {
                    setBoundedMapEntry(recentSubmissionCache, payloadKey, {
                        expiresAt: completedAt + dedupeWindowMs
                    });
                }
                if (cacheReplay && scopedIdemKey) {
                    const isObjBody = typeof body === 'object' && body !== null && !Buffer.isBuffer(body);
                    const serializedBody = Buffer.isBuffer(body)
                        ? body
                        : (typeof body === 'string' ? body : JSON.stringify(body));
                    const contentType = res.getHeader('content-type') || (isObjBody ? 'application/json; charset=utf-8' : '');
                    setBoundedMapEntry(idempotencyReplayCache, scopedIdemKey, {
                        status: res.statusCode,
                        body: serializedBody,
                        contentType,
                        payloadHash,
                        expiresAt: completedAt + ttlMs
                    });
                }
            }
            res.send = originalSend;
            return originalSend(body);
        };

        return next();
    };
}

function issueUserSession(res, user, { statusCode = 200, message, errorMessage = 'Error creating session.' }) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = getNextSundayMidnight();
    const expiresSql = formatMySqlDateTime(expiresAt);

    db.query(
        'INSERT INTO SesionesAuth (usuario_id, token_hash, expira_en) VALUES (?, ?, ?)',
        [user.id, tokenHash, expiresSql],
        (errSes) => {
            if (errSes) {
                console.error(errSes);
                return res.status(500).send(errorMessage);
            }
            setSessionCookie(res, rawToken, expiresAt);
            return res.status(statusCode).json({
                message,
                user: {
                    id: user.id,
                    nombre: user.nombre,
                    email: user.email,
                    rol: user.rol,
                    estado: user.estado || 'activo',
                    expira_en: expiresAt.toISOString()
                }
            });
        }
    );
}

// ==========================================
// RUTAS DE AUTENTICACIÓN Y SEGURIDAD
// ==========================================

// Consultar sesión activa
app.get('/api/auth/me', apiReadLimiter.middleware, requireAuth, (req, res) => {
    res.json({ authenticated: true, user: req.user });
});

// Enviar código de verificación al correo propietario
app.post('/api/auth/send-register-code', regCodeLimiter.middleware, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 15000 }), async (req, res) => {
    const emailSolicitante = normalizeEmail(req.body.email);
    if (!emailSolicitante) {
        return res.status(400).send('Please enter a valid email address.');
    }

    const codigo = String(crypto.randomInt(100000, 999999));
    const codigoHash = sha256Hex(codigo);
    const expira = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    const expiraSql = formatMySqlDateTime(expira);

    db.query(
        'INSERT INTO CodigosSeguridad (email, tipo, token_hash, expira_en, usado) VALUES (?, "registro", ?, ?, 0)',
        [emailSolicitante, codigoHash, expiraSql],
        async (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error generating verification code.');
            }

            try {
                const rolSolicitado = emailSolicitante === ADMIN_EMAIL ? 'Administrator (Owner)' : 'Psychiatrist (Read-only)';
                await enviarCorreo({
                    to: ADMIN_EMAIL,
                    subject: 'Verification Code - Personal Daily Hub',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
                            <h2 style="color: #1e2430; margin-top: 0;">Registration Verification</h2>
                            <p>A registration request was submitted for <strong>${escapeHtml(emailSolicitante)}</strong> with role <strong>${rolSolicitado}</strong>.</p>
                            <p>Your authorization code (valid for 15 minutes) is:</p>
                            <div style="font-size: 28px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 14px; background: #f3f4f6; border-radius: 8px; color: #111827;">
                                ${codigo}
                            </div>
                        </div>
                    `
                });
                res.json({ message: 'Verification code sent to the owner email configured on the server.' });
            } catch (mailErr) {
                console.error('[AUTH_MAIL_ERROR]', mailErr.message);
                res.status(500).send(
                    'Could not send the verification email. You can register using your personal secret key in the validation field.'
                );
            }
        }
    );
});

// Registro de usuario por primera vez (valida correo o clave secreta personal)
app.post('/api/auth/register', registerLimiter.middleware, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 0, cacheReplay: false }), (req, res) => {
    const nombre = typeof req.body.nombre === 'string' ? req.body.nombre.trim() : '';
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const codigoValidacion = typeof req.body.codigoValidacion === 'string' ? req.body.codigoValidacion.trim() : '';

    if (!nombre || nombre.length < 2 || nombre.length > 80) {
        return res.status(400).send('Name must be between 2 and 80 characters.');
    }
    if (!email) {
        return res.status(400).send('Invalid email address.');
    }
    const passwordError = validatePasswordFormat(password);
    if (passwordError) {
        return res.status(400).send(passwordError);
    }
    if (!codigoValidacion) {
        return res.status(400).send('Enter the verification code or your personal secret key.');
    }

    // Asignación estricta de rol: únicamente ADMIN_EMAIL puede ser admin
    const rolAsignado = email === ADMIN_EMAIL ? 'admin' : 'psiquiatra';

    // Verificar si coincide con clave secreta personal del propietario (.env)
    const clavesPropietario = [
        process.env.ADMIN_SECRET,
        process.env.WORD_PASSWORD,
        process.env.JOURNAL_SECRET_KEY
    ].filter(Boolean);

    const validoPorClaveSecreta = clavesPropietario.some(clave => safeCompareStrings(codigoValidacion, String(clave).trim()));

    const procederConCreacion = () => {
        db.query('SELECT id FROM Usuarios WHERE email = ? LIMIT 1', [email], async (errExist, rowsExist) => {
            if (errExist) {
                console.error(errExist);
                return res.status(500).send('Error querying users.');
            }
            if (rowsExist && rowsExist.length > 0) {
                return res.status(400).send('This email is already registered. Sign in or reset your password.');
            }

            try {
                const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
                db.query(
                    'INSERT INTO Usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)',
                    [nombre, email, passwordHash, rolAsignado],
                    (errIns, result) => {
                        if (errIns) {
                            console.error(errIns);
                            return res.status(500).send('Error registering user.');
                        }

                        issueUserSession(
                            res,
                            { id: result.insertId, nombre, email, rol: rolAsignado, estado: 'activo' },
                            {
                                statusCode: 201,
                                message: 'Account verified and created successfully.',
                                errorMessage: 'Account created, but an error occurred while signing in.'
                            }
                        );
                    }
                );
            } catch (hashErr) {
                console.error(hashErr);
                res.status(500).send('Error processing password.');
            }
        });
    };

    if (validoPorClaveSecreta) {
        return procederConCreacion();
    }

    // Si no fue clave secreta, validar código OTP enviado por correo
    const codigoHash = sha256Hex(codigoValidacion);
    const nowSql = formatMySqlDateTime(new Date());
    const sqlCodigo = `
        SELECT id FROM CodigosSeguridad
        WHERE email = ? AND tipo = 'registro' AND token_hash = ? AND usado = 0 AND expira_en > ?
        ORDER BY id DESC LIMIT 1
    `;

    db.query(sqlCodigo, [email, codigoHash, nowSql], (errCod, rowsCod) => {
        if (errCod) {
            console.error(errCod);
            return res.status(500).send('Error validating security code.');
        }
        if (!rowsCod || rowsCod.length === 0) {
            return res.status(400).send('Incorrect or expired verification code / secret key.');
        }

        db.query('UPDATE CodigosSeguridad SET usado = 1 WHERE id = ?', [rowsCod[0].id], () => {
            procederConCreacion();
        });
    });
});

// Inicio de sesión (con anti-enumeración, timing parity, estado de cuenta y MFA opcional)
app.post('/api/auth/login', loginIpLimiter.middleware, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 0, cacheReplay: false }), async (req, res) => {
    const ip = getClientIp(req);
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password) {
        return res.status(400).send('Enter a valid email and password.');
    }

    const accountLimitKey = `${ip}:${email}`;
    const accountQuota = loginAccountLimiter.consume(accountLimitKey);
    loginAccountLimiter.applyHeaders(res, accountQuota);
    if (!accountQuota.allowed) {
        return res.status(429).send('Too many failed attempts. Please wait 15 minutes.');
    }

    db.query('SELECT id, nombre, email, password_hash, rol, estado FROM Usuarios WHERE email = ? LIMIT 1', [email], async (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database query error.');
        }
        if (!rows || rows.length === 0) {
            await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
            return res.status(401).send('Incorrect email or password.');
        }

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).send('Incorrect email or password.');
        }

        if ((user.estado || 'activo') !== 'activo') {
            return res.status(403).send('Your account is inactive or suspended. Contact the administrator.');
        }

        loginAccountLimiter.reset(accountLimitKey);

        // Limpiar sesiones/códigos vencidos
        limpiarRegistrosExpirados();

        // MFA opcional por correo si ENABLE_LOGIN_MFA=true y SMTP está configurado
        if (ENABLE_LOGIN_MFA && crearTransporterCorreo()) {
            const mfaCode = String(crypto.randomInt(100000, 999999));
            const mfaHash = sha256Hex(mfaCode);
            const mfaExpires = new Date(Date.now() + 10 * 60 * 1000);
            const mfaExpiresSql = formatMySqlDateTime(mfaExpires);
            const mfaToken = signMfaChallenge({
                userId: user.id,
                email: user.email,
                nonce: crypto.randomBytes(12).toString('hex'),
                exp: mfaExpires.getTime()
            });

            return db.query(
                'INSERT INTO CodigosSeguridad (email, tipo, token_hash, expira_en, usado) VALUES (?, "mfa", ?, ?, 0)',
                [user.email, mfaHash, mfaExpiresSql],
                async (errMfa) => {
                    if (errMfa) {
                        console.error(errMfa);
                        return res.status(500).send('Error generating verification challenge.');
                    }
                    try {
                        await enviarCorreo({
                            to: user.email,
                            subject: 'Login Verification Code - Personal Daily Hub',
                            html: `
                                <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
                                    <h2 style="color: #1e2430; margin-top: 0;">Two-Step Sign-In Verification</h2>
                                    <p>Hello <strong>${escapeHtml(user.nombre)}</strong>, enter this 6-digit code to finish signing in (valid for 10 minutes):</p>
                                    <div style="font-size: 28px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 14px; background: #f3f4f6; border-radius: 8px; color: #111827;">
                                        ${mfaCode}
                                    </div>
                                </div>
                            `
                        });
                        return res.json({
                            mfaRequired: true,
                            email: user.email,
                            mfaToken,
                            message: 'Enter the 6-digit verification code sent to your email.'
                        });
                    } catch (mailErr) {
                        console.error('[MFA_MAIL_ERROR]', mailErr.message);
                        return res.status(500).send('Verification email service is temporarily unavailable.');
                    }
                }
            );
        }

        issueUserSession(res, user, {
            statusCode: 200,
            message: 'Signed in successfully.',
            errorMessage: 'Error creating session.'
        });
    });
});

// Verificación de segundo factor por correo (MFA opcional al iniciar sesión)
app.post('/api/auth/verify-login-mfa', mfaVerifyLimiter.middleware, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 0, cacheReplay: false }), (req, res) => {
    const mfaToken = typeof req.body.mfaToken === 'string' ? req.body.mfaToken.trim() : '';
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';

    const challenge = verifyMfaChallenge(mfaToken);
    if (!challenge || !/^\d{6}$/.test(code)) {
        return res.status(400).send('Invalid or expired verification code.');
    }

    const codeHash = sha256Hex(code);
    const nowSql = formatMySqlDateTime(new Date());
    const sqlCode = `
        SELECT id FROM CodigosSeguridad
        WHERE email = ? AND tipo = 'mfa' AND token_hash = ? AND usado = 0 AND expira_en > ?
        ORDER BY id DESC LIMIT 1
    `;

    db.query(sqlCode, [challenge.email, codeHash, nowSql], (err, rowsCod) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error validating verification code.');
        }
        if (!rowsCod || rowsCod.length === 0) {
            return res.status(400).send('Invalid or expired verification code.');
        }

        db.query('SELECT id, nombre, email, rol, estado FROM Usuarios WHERE id = ? AND email = ? LIMIT 1', [challenge.userId, challenge.email], (errUsr, userRows) => {
            if (errUsr || !userRows || userRows.length === 0) {
                return res.status(401).send('Account could not be verified.');
            }
            const user = userRows[0];
            if ((user.estado || 'activo') !== 'activo') {
                return res.status(403).send('Your account is inactive or suspended. Contact the administrator.');
            }

            db.query('UPDATE CodigosSeguridad SET usado = 1 WHERE id = ?', [rowsCod[0].id], () => {
                issueUserSession(res, user, {
                    statusCode: 200,
                    message: 'Signed in successfully.',
                    errorMessage: 'Error creating session.'
                });
            });
        });
    });
});

// Cerrar sesión manualmente
app.post('/api/auth/logout', preventDuplicateSubmit({ dedupeWindowMs: 0, cacheReplay: false }), (req, res) => {
    const cookies = parseCookies(req);
    const rawToken = cookies.mt_session;
    clearSessionCookie(res);

    if (!rawToken) {
        return res.json({ message: 'Signed out.' });
    }

    const tokenHash = sha256Hex(rawToken);
    db.query('DELETE FROM SesionesAuth WHERE token_hash = ?', [tokenHash], () => {
        res.json({ message: 'Signed out successfully.' });
    });
});

// Solicitar enlace de recuperación de contraseña por correo (respuesta uniforme anti-enumeración)
app.post('/api/auth/forgot-password', forgotPasswordLimiter.middleware, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 15000 }), (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!email) {
        return res.status(400).send('Please enter a valid email address.');
    }

    const genericSuccessMsg = 'If this email is registered, you will receive a password reset link.';

    db.query('SELECT id, nombre, email, estado FROM Usuarios WHERE email = ? LIMIT 1', [email], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error processing request.');
        }
        if (!rows || rows.length === 0 || (rows[0].estado || 'activo') !== 'activo') {
            return res.json({ message: genericSuccessMsg });
        }

        const user = rows[0];
        const rawResetToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = sha256Hex(rawResetToken);
        const expira = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
        const expiraSql = formatMySqlDateTime(expira);

        db.query(
            'INSERT INTO CodigosSeguridad (email, tipo, token_hash, expira_en, usado) VALUES (?, "reset", ?, ?, 0)',
            [user.email, tokenHash, expiraSql],
            async (errIns) => {
                if (errIns) {
                    console.error(errIns);
                    return res.status(500).send('Error generating recovery link.');
                }

                const baseUrl = getResetBaseUrl(req);
                const resetUrl = `${baseUrl}/?resetToken=${rawResetToken}&email=${encodeURIComponent(user.email)}`;

                try {
                    await enviarCorreo({
                        to: user.email,
                        subject: 'Password Recovery - Personal Daily Hub',
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 22px; border: 1px solid #e5e7eb; border-radius: 12px;">
                                <h2 style="color: #1e2430; margin-top: 0;">Reset Password</h2>
                                <p>Hello <strong>${escapeHtml(user.nombre)}</strong>,</p>
                                <p>You requested a password reset on Personal Daily Hub. Click the button below (valid for 30 minutes):</p>
                                <p style="text-align: center; margin: 26px 0;">
                                    <a href="${resetUrl}" style="background: #1e2430; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: bold; display: inline-block;">
                                        Reset My Password
                                    </a>
                                </p>
                                <p style="font-size: 12px; color: #6b7280;">If you did not request this change, you can safely ignore this message.</p>
                            </div>
                        `
                    });
                    res.json({ message: genericSuccessMsg });
                } catch (mailErr) {
                    console.error('[RECOVERY_MAIL_ERROR]', mailErr.message);
                    res.status(500).send('Recovery email service is temporarily unavailable.');
                }
            }
        );
    });
});

// Restablecer contraseña con el token enviado por correo
app.post('/api/auth/reset-password', resetPasswordLimiter.middleware, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 0, cacheReplay: false }), (req, res) => {
    const email = normalizeEmail(req.body.email);
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';

    if (!email || !token || token.length < 32) {
        return res.status(400).send('Invalid recovery link.');
    }
    const passwordError = validatePasswordFormat(newPassword);
    if (passwordError) {
        return res.status(400).send(passwordError);
    }

    const tokenHash = sha256Hex(token);
    const nowSql = formatMySqlDateTime(new Date());
    const sqlCheck = `
        SELECT id FROM CodigosSeguridad
        WHERE email = ? AND tipo = 'reset' AND token_hash = ? AND usado = 0 AND expira_en > ?
        ORDER BY id DESC LIMIT 1
    `;

    db.query(sqlCheck, [email, tokenHash, nowSql], async (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error verifying recovery link.');
        }
        if (!rows || rows.length === 0) {
            return res.status(400).send('The recovery link is invalid or has expired.');
        }

        const codigoId = rows[0].id;
        db.query('SELECT id, estado FROM Usuarios WHERE email = ? LIMIT 1', [email], async (errUsr, userRows) => {
            if (errUsr || !userRows || userRows.length === 0) {
                return res.status(400).send('The recovery link is invalid or has expired.');
            }
            if ((userRows[0].estado || 'activo') !== 'activo') {
                return res.status(403).send('Your account is inactive or suspended. Contact the administrator.');
            }

            try {
                const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
                db.query('UPDATE Usuarios SET password_hash = ? WHERE email = ?', [passwordHash, email], (errUpd, resultUpd) => {
                    if (errUpd || resultUpd.affectedRows === 0) {
                        return res.status(500).send('Could not update password.');
                    }

                    db.query('UPDATE CodigosSeguridad SET usado = 1 WHERE id = ?', [codigoId], () => {});
                    db.query(
                        'DELETE FROM SesionesAuth WHERE usuario_id = (SELECT id FROM Usuarios WHERE email = ? LIMIT 1)',
                        [email],
                        () => {}
                    );

                    res.json({ message: 'Password updated successfully. You can now sign in.' });
                });
            } catch (e) {
                console.error(e);
                res.status(500).send('Error hashing the new password.');
            }
        });
    });
});

// Gestión de cuenta del Psiquiatra desde la cuenta de administrador
app.get('/api/auth/medicos', apiReadLimiter.middleware, requireAdmin, (req, res) => {
    db.query("SELECT id, nombre, email, COALESCE(estado, 'activo') AS estado, fecha_registro FROM Usuarios WHERE rol = \"psiquiatra\" ORDER BY id DESC", (err, rows) => {
        if (err) return res.status(500).send('Error loading psychiatrist accounts.');
        res.json(rows);
    });
});

app.post('/api/auth/create-medico', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 10000 }), async (req, res) => {
    const nombre = typeof req.body.nombre === 'string' ? req.body.nombre.trim() : '';
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!nombre || nombre.length < 2 || nombre.length > 80) {
        return res.status(400).send('Doctor name must be between 2 and 80 characters.');
    }
    if (!email || email === ADMIN_EMAIL) {
        return res.status(400).send('Enter a valid psychiatrist email (different from owner email).');
    }
    const passwordError = validatePasswordFormat(password);
    if (passwordError) {
        return res.status(400).send(passwordError);
    }

    try {
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const sql = `
            INSERT INTO Usuarios (nombre, email, password_hash, rol, estado)
            VALUES (?, ?, ?, 'psiquiatra', 'activo')
            ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), password_hash = VALUES(password_hash), rol = 'psiquiatra', estado = 'activo'
        `;
        db.query(sql, [nombre, email, passwordHash], (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error saving psychiatrist account.');
            }
            res.json({ message: 'Psychiatrist account (read-only) saved successfully.' });
        });
    } catch (e) {
        res.status(500).send('Error hashing password.');
    }
});

app.patch('/api/auth/medicos/:id/estado', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 0 }), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).send('Invalid ID.');

    const estado = typeof req.body.estado === 'string' ? req.body.estado.trim().toLowerCase() : '';
    if (!ESTADOS_CUENTA_VALIDOS.has(estado)) {
        return res.status(400).send('Invalid account status. Allowed: activo, inactivo, suspendido.');
    }

    db.query('UPDATE Usuarios SET estado = ? WHERE id = ? AND rol = "psiquiatra"', [estado, id], (err, result) => {
        if (err) return res.status(500).send('Error updating account status.');
        if (result.affectedRows === 0) return res.status(404).send('Account not found.');

        if (estado !== 'activo') {
            db.query('DELETE FROM SesionesAuth WHERE usuario_id = ?', [id], () => {});
        }
        res.json({ message: 'Psychiatrist account status updated.', id, estado });
    });
});

app.delete('/api/auth/medicos/:id', apiWriteLimiter.middleware, requireAdmin, preventDuplicateSubmit({ dedupeWindowMs: 0 }), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).send('Invalid ID.');

    db.query('DELETE FROM Usuarios WHERE id = ? AND rol = "psiquiatra"', [id], (err, result) => {
        if (err) return res.status(500).send('Error deleting account.');
        if (result.affectedRows === 0) return res.status(404).send('Account not found.');
        res.json({ message: 'Psychiatrist access revoked successfully.' });
    });
});

// ==========================================
// RUTAS DE MOOD Y SUEÑO (PROTEGIDAS POR ROL)
// ==========================================
const MOMENTOS_VALIDOS = new Set(['Madrugada', 'Morning', 'Noon', 'Afternoon', 'Night']);
const CALIDADES_SUENO_VALIDAS = new Set(['Good', 'Regular', 'Bad']);
const SLEEP_TIPOS_VALIDOS = new Set(['normal', 'desvelo_tarde', 'desvelo_total']);
const FECHA_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
const HORA_24H_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

function isLateBedtimeHHMM(hhmm = '') {
    if (!HORA_24H_REGEX.test(hhmm)) return false;
    const [h, m] = hhmm.split(':').map(Number);
    const totalMin = h * 60 + m;
    // 01:00 to 05:59 counts as late-night bedtime ("madrugada / desvelo")
    return totalMin >= 60 && totalMin < 360;
}

// Guardar el estado de ánimo (SOLO ADMIN)
app.post('/api/insert-mood', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 10000 }), (req, res) => {
    const { fecha, momento_dia, estado_animo, color_hex } = req.body;

    if (!fecha || !FECHA_ISO_REGEX.test(fecha)) {
        return res.status(400).send('Invalid date (expected YYYY-MM-DD).');
    }
    if (!momento_dia || !MOMENTOS_VALIDOS.has(momento_dia)) {
        return res.status(400).send('Invalid time of day.');
    }
    if (typeof estado_animo !== 'string' || !estado_animo.trim() || estado_animo.trim().length > 50) {
        return res.status(400).send('Invalid mood value.');
    }
    if (typeof color_hex !== 'string' || !HEX_COLOR_REGEX.test(color_hex)) {
        return res.status(400).send('Invalid hex color.');
    }

    const checkSql = 'SELECT * FROM RegistrosMood WHERE fecha = ? AND momento_dia = ?';

    db.query(checkSql, [fecha, momento_dia], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database query error.');
        }

        if (result.length > 0) {
            if (puedeModificar(fecha, momento_dia)) {
                const sqlUpdate = 'UPDATE RegistrosMood SET estado_animo = ?, color_hex = ? WHERE fecha = ? AND momento_dia = ?';
                db.query(sqlUpdate, [estado_animo.trim(), color_hex, fecha, momento_dia], (errUpdate) => {
                    if (errUpdate) {
                        console.error(errUpdate);
                        return res.status(500).send('Error updating record.');
                    }
                    res.send('Record updated successfully\nYou were still within the edit window.');
                });
            } else {
                res.status(400).send('The time window to edit this time of day has already expired.');
            }
        } else {
            const sqlInsert = 'INSERT INTO RegistrosMood (fecha, momento_dia, estado_animo, color_hex) VALUES (?, ?, ?, ?)';
            db.query(sqlInsert, [fecha, momento_dia, estado_animo.trim(), color_hex], (errInsert) => {
                if (errInsert) {
                    console.error(errInsert);
                    return res.status(500).send('Error saving to database.');
                }

                res.send('Mood saved successfully.');
            });
        }
    });
});

// Dar de alta un nuevo registro de sueño o desvelo (SOLO ADMIN)
app.post('/api/insert-sleep', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 15000 }), (req, res) => {
    const fecha = String(req.body.fecha || '').trim();
    const rawHoraDormir = String(req.body.horaDormir ?? req.body.hora_dormir ?? '').trim();
    const rawHoraDespertar = String(req.body.horaDespertar ?? req.body.hora_despertar ?? '').trim();
    const rawTipo = String(req.body.tipoRegistro ?? req.body.tipo_registro ?? 'normal').trim();
    const rawMotivo = String(req.body.motivoDesvelo ?? req.body.motivo_desvelo ?? '').trim();
    const hasExplicitDesvelo = req.body.esDesvelo !== undefined || req.body.es_desvelo !== undefined;
    const rawEsDesvelo = Boolean(req.body.esDesvelo ?? req.body.es_desvelo ?? false);
    const rawCalidad = String(req.body.calidad || (rawTipo === 'desvelo_total' ? 'Bad' : '')).trim();
    const rawHoras = req.body.horas;

    if (!fecha || !FECHA_ISO_REGEX.test(fecha)) {
        return res.status(400).send('Invalid date (expected YYYY-MM-DD).');
    }
    if (!SLEEP_TIPOS_VALIDOS.has(rawTipo)) {
        return res.status(400).send('Invalid sleep entry type.');
    }
    if (rawHoraDormir && !HORA_24H_REGEX.test(rawHoraDormir)) {
        return res.status(400).send('Invalid bedtime format (expected HH:MM).');
    }
    if (rawHoraDespertar && !HORA_24H_REGEX.test(rawHoraDespertar)) {
        return res.status(400).send('Invalid wake-up time format (expected HH:MM).');
    }
    if (rawMotivo.length > 500) {
        return res.status(400).send('Desvelo reason note cannot exceed 500 characters.');
    }
    if (!rawCalidad || !CALIDADES_SUENO_VALIDAS.has(rawCalidad)) {
        return res.status(400).send('Invalid sleep quality.');
    }

    const lateAuto = rawHoraDormir ? isLateBedtimeHHMM(rawHoraDormir) : false;
    let tipoRegistro = rawTipo;
    let esDesvelo = rawTipo !== 'normal' || rawEsDesvelo || (lateAuto && (!hasExplicitDesvelo || rawEsDesvelo));
    if (tipoRegistro === 'normal' && esDesvelo) {
        tipoRegistro = 'desvelo_tarde';
    }

    const isAllNighter = tipoRegistro === 'desvelo_total';
    const isPendingWakeup = tipoRegistro === 'desvelo_tarde' && Boolean(rawHoraDormir) && !rawHoraDespertar && (rawHoras === undefined || rawHoras === '' || Number(rawHoras) === 0);

    let horasNum = rawHoras === undefined || rawHoras === '' ? 0 : Number(rawHoras);
    if (isAllNighter) {
        if (!Number.isFinite(horasNum) || horasNum < 0 || horasNum > 24) {
            return res.status(400).send('Sleep hours must be between 0 and 24 for an all-nighter.');
        }
        horasNum = 0;
        esDesvelo = true;
    } else if (isPendingWakeup) {
        horasNum = 0;
        esDesvelo = true;
    } else if (!Number.isFinite(horasNum) || horasNum <= 0 || horasNum > 24) {
        return res.status(400).send('Sleep hours must be a number between 0.1 and 24.');
    }

    const sql = `
        INSERT INTO RegistrosSleep
            (fecha, horas, calidad, hora_dormir, hora_despertar, es_desvelo, tipo_registro, motivo_desvelo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
        fecha,
        horasNum,
        rawCalidad,
        rawHoraDormir || null,
        rawHoraDespertar || null,
        esDesvelo ? 1 : 0,
        tipoRegistro,
        rawMotivo || null
    ];

    db.query(sql, params, (err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error saving sleep record.');
        }
        if (isAllNighter) {
            return res.send('All-nighter / desvelo log saved successfully (0 hrs · visible to psychiatrist).');
        }
        if (isPendingWakeup) {
            return res.send(`Late bedtime (${rawHoraDormir}) saved! Complete your wake-up time when you get up.`);
        }
        if (esDesvelo) {
            return res.send('Sleep & desvelo record saved successfully (visible to psychiatrist).');
        }
        return res.send('Sleep record saved successfully.');
    });
});

// Completar hora de despertar o actualizar registro de sueño (SOLO ADMIN)
app.patch('/api/update-sleep/:id', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
        return res.status(400).send('Invalid sleep record ID.');
    }

    db.query(
        'SELECT id, fecha, horas, calidad, hora_dormir, hora_despertar, es_desvelo, tipo_registro, motivo_desvelo FROM RegistrosSleep WHERE id = ? LIMIT 1',
        [id],
        (errFind, rows) => {
            if (errFind) {
                console.error(errFind);
                return res.status(500).send('Database query error.');
            }
            if (!Array.isArray(rows) || rows.length === 0) {
                return res.status(404).send('Sleep record not found.');
            }

            const existing = rows[0];
            const horaDormir = req.body.horaDormir !== undefined || req.body.hora_dormir !== undefined
                ? String(req.body.horaDormir ?? req.body.hora_dormir ?? '').trim()
                : String(existing.hora_dormir || '').trim();
            const horaDespertar = req.body.horaDespertar !== undefined || req.body.hora_despertar !== undefined
                ? String(req.body.horaDespertar ?? req.body.hora_despertar ?? '').trim()
                : String(existing.hora_despertar || '').trim();
            const calidad = String(req.body.calidad ?? existing.calidad ?? 'Regular').trim();
            const tipoRegistro = String(req.body.tipoRegistro ?? req.body.tipo_registro ?? existing.tipo_registro ?? 'normal').trim();
            const motivoRaw = req.body.motivoDesvelo !== undefined || req.body.motivo_desvelo !== undefined
                ? String(req.body.motivoDesvelo ?? req.body.motivo_desvelo ?? '').trim()
                : String(existing.motivo_desvelo || '').trim();
            const horasNum = Number(req.body.horas ?? existing.horas ?? 0);

            if (horaDormir && !HORA_24H_REGEX.test(horaDormir)) {
                return res.status(400).send('Invalid bedtime format (expected HH:MM).');
            }
            if (horaDespertar && !HORA_24H_REGEX.test(horaDespertar)) {
                return res.status(400).send('Invalid wake-up time format (expected HH:MM).');
            }
            if (!CALIDADES_SUENO_VALIDAS.has(calidad) || !SLEEP_TIPOS_VALIDOS.has(tipoRegistro)) {
                return res.status(400).send('Invalid sleep quality or entry type.');
            }
            if (motivoRaw.length > 500) {
                return res.status(400).send('Desvelo reason note cannot exceed 500 characters.');
            }
            if (!Number.isFinite(horasNum) || horasNum <= 0 || horasNum > 24) {
                if (tipoRegistro !== 'desvelo_total') {
                    return res.status(400).send('Sleep hours must be a number between 0.1 and 24.');
                }
            }

            const esDesveloFlag = req.body.esDesvelo !== undefined || req.body.es_desvelo !== undefined
                ? Boolean(req.body.esDesvelo ?? req.body.es_desvelo)
                : Boolean(Number(existing.es_desvelo) === 1 || tipoRegistro !== 'normal' || isLateBedtimeHHMM(horaDormir));
            const finalTipo = tipoRegistro === 'normal' && esDesveloFlag ? 'desvelo_tarde' : tipoRegistro;

            const sqlUpdate = `
                UPDATE RegistrosSleep
                SET hora_dormir = ?, hora_despertar = ?, horas = ?, calidad = ?, es_desvelo = ?, tipo_registro = ?, motivo_desvelo = ?
                WHERE id = ?
            `;
            db.query(
                sqlUpdate,
                [
                    horaDormir || null,
                    horaDespertar || null,
                    tipoRegistro === 'desvelo_total' ? 0 : horasNum,
                    calidad,
                    esDesveloFlag ? 1 : 0,
                    finalTipo,
                    motivoRaw || null,
                    id
                ],
                (errUpd) => {
                    if (errUpd) {
                        console.error(errUpd);
                        return res.status(500).send('Error updating sleep record.');
                    }
                    res.json({ ok: true, id, message: 'Sleep session updated successfully.' });
                }
            );
        }
    );
});

// Eliminar un registro de sueño (SOLO ADMIN)
app.delete('/api/delete-sleep/:id', apiWriteLimiter.middleware, requireAdmin, (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
        return res.status(400).send('Invalid sleep record ID.');
    }
    db.query('DELETE FROM RegistrosSleep WHERE id = ?', [id], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error deleting sleep record.');
        }
        if (!result || Number(result.affectedRows) === 0) {
            return res.status(404).send('Sleep record not found.');
        }
        res.json({ ok: true, id, message: 'Sleep record removed.' });
    });
});

// Consultar estados de ánimo (PERMITIDO A ADMIN Y PSIQUIATRA)
app.get('/api/get-moods', apiReadLimiter.middleware, requireAuth, (req, res) => {
    const { begin, end } = req.query;
    if (!begin || !end || !FECHA_ISO_REGEX.test(begin) || !FECHA_ISO_REGEX.test(end)) {
        return res.status(400).send('Parameters begin and end are required (YYYY-MM-DD).');
    }

    const sql = 'SELECT fecha, momento_dia, color_hex FROM RegistrosMood WHERE fecha BETWEEN ? AND ?';

    db.query(sql, [begin, end], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database query error.');
        }
        res.json(result);
    });
});

// Consultar horas de sueño y desvelos (PERMITIDO A ADMIN Y PSIQUIATRA)
app.get('/api/get-sleep', apiReadLimiter.middleware, requireAuth, (req, res) => {
    const { begin, end } = req.query;
    if (!begin || !end || !FECHA_ISO_REGEX.test(begin) || !FECHA_ISO_REGEX.test(end)) {
        return res.status(400).send('Parameters begin and end are required (YYYY-MM-DD).');
    }

    const sql = `
        SELECT id, fecha, horas, calidad, hora_dormir, hora_despertar, es_desvelo, tipo_registro, motivo_desvelo, fecha_registro
        FROM RegistrosSleep
        WHERE fecha BETWEEN ? AND ?
        ORDER BY fecha ASC, id ASC
    `;

    db.query(sql, [begin, end], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database query error.');
        }
        res.json(result);
    });
});

// =======================================================
// REGISTRO DE CRISIS (SOLO ADMIN ESCRIBE; PSIQUIATRA SOLO LECTURA)
// =======================================================
const CRISIS_TIPOS_VALIDOS = new Set([
    'Estrés',
    'Ira / Rabia',
    'Ansiedad',
    'Pánico',
    'Llanto / Sobrecarga',
    'Bloqueo / Saturación',
    'Insomnio / Agitación',
    'Otro'
]);

app.post('/api/insert-crisis', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, (req, res) => {
    const fecha = String(req.body.fecha || '').trim();
    const hora = String(req.body.hora || '').trim();
    const tipoCrisis = String(req.body.tipoCrisis || req.body.tipo_crisis || '').trim();
    const intensidadNum = Number(req.body.intensidad ?? 3);
    const motivo = String(req.body.motivo || '').trim();

    if (!fecha || !FECHA_ISO_REGEX.test(fecha)) {
        return res.status(400).send('Fecha inválida (formato esperado YYYY-MM-DD).');
    }
    if (!hora || !HORA_24H_REGEX.test(hora)) {
        return res.status(400).send('Hora inválida (formato HH:MM 24h).');
    }
    if (!CRISIS_TIPOS_VALIDOS.has(tipoCrisis)) {
        return res.status(400).send('Tipo de crisis inválido.');
    }
    if (!Number.isInteger(intensidadNum) || intensidadNum < 1 || intensidadNum > 5) {
        return res.status(400).send('La intensidad debe ser un entero entre 1 y 5.');
    }
    if (!motivo || motivo.length > 1000) {
        return res.status(400).send('Escribe el motivo o detonante de la crisis (máx. 1000 caracteres).');
    }

    const sql = 'INSERT INTO RegistrosCrisis (fecha, hora, tipo_crisis, intensidad, motivo) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [fecha, hora, tipoCrisis, intensidadNum, motivo], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error saving crisis record.');
        }
        res.json({
            ok: true,
            id: result?.insertId || null,
            fecha,
            hora,
            tipo_crisis: tipoCrisis,
            intensidad: intensidadNum,
            motivo
        });
    });
});

// Consultar crisis registradas (PERMITIDO A ADMIN Y PSIQUIATRA EN MODO SOLO LECTURA)
app.get('/api/get-crisis', apiReadLimiter.middleware, requireAuth, (req, res) => {
    const { begin, end } = req.query;
    if ((begin || end) && (!begin || !end || !FECHA_ISO_REGEX.test(begin) || !FECHA_ISO_REGEX.test(end))) {
        return res.status(400).send('Parameters begin and end must both be YYYY-MM-DD.');
    }

    const sql = begin && end
        ? 'SELECT id, fecha, hora, tipo_crisis, intensidad, motivo, fecha_registro FROM RegistrosCrisis WHERE fecha BETWEEN ? AND ? ORDER BY fecha DESC, hora DESC, id DESC'
        : 'SELECT id, fecha, hora, tipo_crisis, intensidad, motivo, fecha_registro FROM RegistrosCrisis ORDER BY fecha DESC, hora DESC, id DESC LIMIT 50';
    const params = begin && end ? [begin, end] : [];

    db.query(sql, params, (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database query error.');
        }
        res.json(Array.isArray(result) ? result : []);
    });
});

app.delete('/api/delete-crisis/:id', apiWriteLimiter.middleware, requireAdmin, (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
        return res.status(400).send('Invalid crisis record ID.');
    }
    db.query('DELETE FROM RegistrosCrisis WHERE id = ?', [id], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error deleting crisis record.');
        }
        if (!result || result.affectedRows === 0) {
            return res.status(404).send('Crisis record not found.');
        }
        res.json({ ok: true, id });
    });
});

// Verifica si aún es tiempo de modificar un estado de ánimo (incluye Madrugada 00:00 - 05:59)
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
        case 'Madrugada':
            return hour >= 0 && hour < 6;
        case 'Morning':
            return hour >= 6 && hour < 12;
        case 'Noon':
            return hour >= 12 && hour < 14;
        case 'Afternoon':
            return hour >= 14 && hour < 20;
        case 'Night':
            return hour >= 20 && hour <= 23;
        default:
            return false;
    }
}

// Colas temporales acotadas en RAM hacia Word PC (Journal privado + English Notebook)
const MAX_COLA_TEXTOS = 100;

function createEncryptedPcQueue({ maxSize = MAX_COLA_TEXTOS, okMessage, emptyMessage, fullMessage }) {
    let queue = [];

    return {
        enqueue(req, res) {
            const { texto } = req.body || {};
            if (typeof texto !== 'string' || !texto.trim()) {
                return res.status(400).send(emptyMessage);
            }
            if (texto.length > 48000) {
                return res.status(400).send('Encrypted payload exceeds maximum allowed length.');
            }
            if (queue.includes(texto)) {
                return res.status(409).send('This encrypted entry is already queued for your PC.');
            }
            if (queue.length >= maxSize) {
                return res.status(429).send(fullMessage);
            }
            queue.push(texto);
            return res.send(okMessage);
        },
        pull(req, res) {
            const items = queue;
            queue = [];
            return res.json(items);
        },
        size() {
            return queue.length;
        }
    };
}

const journalQueue = createEncryptedPcQueue({
    maxSize: MAX_COLA_TEXTOS,
    okMessage: 'Text queued for your PC.',
    emptyMessage: 'Text cannot be empty.',
    fullMessage: 'Sync queue is full; please wait for your PC to pull pending entries.'
});

const englishQueue = createEncryptedPcQueue({
    maxSize: MAX_COLA_TEXTOS,
    okMessage: 'English entry queued for your PC Word notebook.',
    emptyMessage: 'Entry payload cannot be empty.',
    fullMessage: 'English sync queue is full; please wait for your PC to pull pending entries.'
});

// Enviar nota de Journal cifrada a la cola (SOLO ADMIN)
app.post('/api/send-to-pc', pcQueueWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 10000 }), journalQueue.enqueue);

// Ruta para que tu PC consulte notas de Journal pendientes (el contenido viaja cifrado E2EE)
app.get('/api/pull-text', pcPullLimiter.middleware, journalQueue.pull);

// Enviar entrada cifrada de English Learning Notebook a la cola (SOLO ADMIN, sin guardar en MySQL)
app.post('/api/send-english', pcQueueWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 10000 }), englishQueue.enqueue);

// Ruta para que tu PC consulte entradas de inglés pendientes (el contenido viaja cifrado E2EE)
app.get('/api/pull-english', pcPullLimiter.middleware, englishQueue.pull);

// ==========================================
// RUTAS PARA LA AGENDA PERSONAL SEMANAL (SOLO ADMIN)
// ==========================================
const BLOQUES_VALIDOS = new Set(['manana', 'cole', 'tarde', 'noche']);
const AGENDA_TIPOS_VALIDOS = new Set(['evento', 'tarea']);
const AGENDA_CATEGORIAS_VALIDAS = new Set(['universidad', 'personal']);
const AGENDA_ESTADOS_VALIDOS = new Set(['todo', 'in_progress', 'done']);
const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

function inferAgendaBlockFromTimeServer(horaStr, categoria = 'personal') {
    const match = String(horaStr || '').match(/^([01]\d|2[0-3]):([0-5]\d)/);
    if (!match) return 'manana';
    const hour = Number(match[1]);
    if (hour >= 20 || hour < 5) return 'noche';
    if (categoria === 'universidad' && hour >= 7 && hour < 19) return 'cole';
    if (hour >= 5 && hour < 12) return 'manana';
    return 'tarde';
}

function splitAgendaTitleAndDescription(rawActividad = '', rawTitulo = '', rawDescripcion = '') {
    const explicitTitle = typeof rawTitulo === 'string' ? rawTitulo.replace(/\s+/g, ' ').trim() : '';
    const explicitDesc = typeof rawDescripcion === 'string' ? rawDescripcion.replace(/\s+/g, ' ').trim() : '';
    if (explicitTitle) {
        return {
            titulo: explicitTitle.slice(0, 120),
            descripcion: explicitDesc.slice(0, 200)
        };
    }
    const cleanAct = typeof rawActividad === 'string' ? rawActividad.replace(/\s+/g, ' ').trim() : '';
    const sepMatch = cleanAct.match(/^(.+?)\s+(?:—|::|\|)\s+(.+)$/);
    if (sepMatch) {
        return {
            titulo: sepMatch[1].trim().slice(0, 120),
            descripcion: sepMatch[2].trim().slice(0, 200)
        };
    }
    return {
        titulo: cleanAct.slice(0, 120),
        descripcion: explicitDesc.slice(0, 200)
    };
}

function composeAgendaActividad(body = {}) {
    const rawAct = typeof body.actividad === 'string' ? body.actividad.replace(/\s+/g, ' ').trim() : '';
    const rawTit = typeof body.titulo === 'string' ? body.titulo.replace(/\s+/g, ' ').trim() : '';
    const rawDesc = typeof body.descripcion === 'string' ? body.descripcion.replace(/\s+/g, ' ').trim() : '';
    if (rawTit && rawDesc) {
        return `${rawTit} — ${rawDesc}`.slice(0, 255);
    }
    if (rawTit && !rawAct) {
        return rawTit.slice(0, 255);
    }
    if (rawAct && rawDesc && !rawAct.includes(rawDesc)) {
        return `${rawAct} — ${rawDesc}`.slice(0, 255);
    }
    return rawAct;
}

function enrichAgendaRow(row) {
    if (!row || typeof row !== 'object') return row;
    const { titulo, descripcion } = splitAgendaTitleAndDescription(row.actividad, row.titulo, row.descripcion);
    return {
        ...row,
        titulo,
        descripcion
    };
}

function normalizeAgendaItemFields(body = {}) {
    const tipo = body.tipo === undefined || body.tipo === null || body.tipo === ''
        ? 'evento'
        : String(body.tipo).trim().toLowerCase();
    const categoria = body.categoria === undefined || body.categoria === null || body.categoria === ''
        ? 'personal'
        : String(body.categoria).trim().toLowerCase();
    const estado = body.estado === undefined || body.estado === null || body.estado === ''
        ? 'todo'
        : String(body.estado).trim().toLowerCase();
    let recordatorioMin = null;
    if (body.recordatorio_min !== undefined && body.recordatorio_min !== null && body.recordatorio_min !== '') {
        recordatorioMin = Number(body.recordatorio_min);
    }
    return { tipo, categoria, estado, recordatorioMin };
}

function validarDatosAgenda(body = {}) {
    const { fecha, hora } = body;
    const { tipo, categoria, estado, recordatorioMin } = normalizeAgendaItemFields(body);
    const bloque = body.bloque && BLOQUES_VALIDOS.has(body.bloque)
        ? body.bloque
        : (body.bloque === undefined || body.bloque === null || body.bloque === ''
            ? inferAgendaBlockFromTimeServer(hora, categoria)
            : body.bloque);
    const actividadCompuesta = composeAgendaActividad(body);

    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return 'Date must use YYYY-MM-DD format.';
    }
    if (!bloque || !BLOQUES_VALIDOS.has(bloque)) {
        return 'Invalid day block.';
    }
    if (!hora || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(hora)) {
        return 'Time must use HH:MM format.';
    }
    if (typeof actividadCompuesta !== 'string' || !actividadCompuesta.trim()) {
        return 'Activity description is required.';
    }
    if (actividadCompuesta.trim().length > 255) {
        return 'Activity cannot exceed 255 characters.';
    }
    if (!AGENDA_TIPOS_VALIDOS.has(tipo)) {
        return 'Invalid activity type (allowed: evento, tarea).';
    }
    if (!AGENDA_CATEGORIAS_VALIDAS.has(categoria)) {
        return 'Invalid category (allowed: universidad, personal).';
    }
    if (!AGENDA_ESTADOS_VALIDOS.has(estado)) {
        return 'Invalid status (allowed: todo, in_progress, done).';
    }
    if (recordatorioMin !== null && (!Number.isInteger(recordatorioMin) || recordatorioMin < -1 || recordatorioMin > 180)) {
        return 'Reminder lead minutes must be -1 (disabled) or between 0 and 180.';
    }
    return null;
}

function parseAgendaId(rawId) {
    const id = Number(rawId);
    return Number.isInteger(id) && id > 0 ? id : null;
}

app.get('/api/get-agenda', apiReadLimiter.middleware, requireAdmin, (req, res) => {
    const { begin, end } = req.query;
    if (!begin || !end || !/^\d{4}-\d{2}-\d{2}$/.test(begin) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        return res.status(400).send('Parameters begin and end are required (YYYY-MM-DD).');
    }

    const sql = `
        SELECT id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, bloque,
               TIME_FORMAT(hora, '%H:%i') AS hora, actividad,
               COALESCE(tipo, 'evento') AS tipo,
               COALESCE(categoria, 'personal') AS categoria,
               COALESCE(estado, CASE WHEN completada = 1 THEN 'done' ELSE 'todo' END) AS estado,
               completada,
               recordatorio_min
        FROM RegistrosAgenda
        WHERE fecha BETWEEN ? AND ?
        ORDER BY fecha ASC, hora ASC, id ASC
    `;

    db.query(sql, [begin, end], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error querying agenda from database.');
        }
        res.json(Array.isArray(result) ? result.map(enrichAgendaRow) : []);
    });
});

app.post('/api/insert-agenda', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 15000 }), (req, res) => {
    const errorValidacion = validarDatosAgenda(req.body);
    if (errorValidacion) {
        return res.status(400).send(errorValidacion);
    }

    const { fecha, hora } = req.body;
    const { tipo, categoria, estado, recordatorioMin } = normalizeAgendaItemFields(req.body);
    const bloque = req.body.bloque && BLOQUES_VALIDOS.has(req.body.bloque)
        ? req.body.bloque
        : inferAgendaBlockFromTimeServer(hora, categoria);
    const actividad = composeAgendaActividad(req.body);
    const { titulo, descripcion } = splitAgendaTitleAndDescription(actividad, req.body.titulo, req.body.descripcion);
    const horaNormalizada = hora.slice(0, 5);
    const completada = estado === 'done' ? 1 : 0;

    const sql = `
        INSERT INTO RegistrosAgenda (fecha, bloque, hora, actividad, tipo, categoria, estado, completada, recordatorio_min)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.query(sql, [fecha, bloque, horaNormalizada, actividad, tipo, categoria, estado, completada, recordatorioMin], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error saving agenda activity.');
        }
        res.status(201).json({
            message: 'Activity saved successfully.',
            item: {
                id: result.insertId,
                fecha,
                bloque,
                hora: horaNormalizada,
                actividad,
                titulo,
                descripcion,
                tipo,
                categoria,
                estado,
                completada,
                recordatorio_min: recordatorioMin
            }
        });
    });
});

app.put('/api/update-agenda/:id', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 0 }), (req, res) => {
    const id = parseAgendaId(req.params.id);
    if (!id) return res.status(400).send('Invalid activity ID.');

    const errorValidacion = validarDatosAgenda(req.body);
    if (errorValidacion) {
        return res.status(400).send(errorValidacion);
    }

    const { fecha, hora } = req.body;
    const { tipo, categoria, estado, recordatorioMin } = normalizeAgendaItemFields(req.body);
    const bloque = req.body.bloque && BLOQUES_VALIDOS.has(req.body.bloque)
        ? req.body.bloque
        : inferAgendaBlockFromTimeServer(hora, categoria);
    const actividad = composeAgendaActividad(req.body);
    const { titulo, descripcion } = splitAgendaTitleAndDescription(actividad, req.body.titulo, req.body.descripcion);
    const horaNormalizada = hora.slice(0, 5);
    const completada = estado === 'done' ? 1 : 0;

    const sql = `
        UPDATE RegistrosAgenda
        SET fecha = ?, bloque = ?, hora = ?, actividad = ?, tipo = ?, categoria = ?, estado = ?, completada = ?, recordatorio_min = ?
        WHERE id = ?
    `;
    db.query(sql, [fecha, bloque, horaNormalizada, actividad, tipo, categoria, estado, completada, recordatorioMin, id], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error updating activity.');
        }
        if (result.affectedRows === 0) {
            return res.status(404).send('Activity not found.');
        }
        if (estado === 'done') {
            db.query("UPDATE RecordatoriosEstado SET estado = 'dismissed' WHERE ref_id = ? AND tipo = 'agenda'", [id], () => {});
        }
        res.json({
            message: 'Activity updated successfully.',
            item: {
                id,
                fecha,
                bloque,
                hora: horaNormalizada,
                actividad,
                titulo,
                descripcion,
                tipo,
                categoria,
                estado,
                completada,
                recordatorio_min: recordatorioMin
            }
        });
    });
});

app.patch('/api/toggle-agenda/:id', apiWriteLimiter.middleware, requireAdmin, preventDuplicateSubmit({ dedupeWindowMs: 0 }), (req, res) => {
    const id = parseAgendaId(req.params.id);
    if (!id) return res.status(400).send('Invalid activity ID.');

    const body = req.body || {};
    let resolvedEstado = null;
    let resolvedCompletada = null;

    if (body.estado !== undefined && body.estado !== null && body.estado !== '') {
        const candidate = String(body.estado).trim().toLowerCase();
        if (!AGENDA_ESTADOS_VALIDOS.has(candidate)) {
            return res.status(400).send('Invalid status (allowed: todo, in_progress, done).');
        }
        resolvedEstado = candidate;
        resolvedCompletada = candidate === 'done' ? 1 : 0;
    } else if (body.completada !== undefined) {
        resolvedCompletada = body.completada ? 1 : 0;
        resolvedEstado = resolvedCompletada === 1 ? 'done' : 'todo';
    }

    const sql = resolvedEstado === null
        ? "UPDATE RegistrosAgenda SET completada = NOT completada, estado = CASE WHEN completada = 1 THEN 'todo' ELSE 'done' END WHERE id = ?"
        : 'UPDATE RegistrosAgenda SET estado = ?, completada = ? WHERE id = ?';
    const params = resolvedEstado === null ? [id] : [resolvedEstado, resolvedCompletada, id];

    db.query(sql, params, (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error updating activity status.');
        }
        if (result.affectedRows === 0) {
            return res.status(404).send('Activity not found.');
        }
        if (resolvedEstado === 'done') {
            db.query("UPDATE RecordatoriosEstado SET estado = 'dismissed' WHERE ref_id = ? AND tipo = 'agenda'", [id], () => {});
        }
        res.json({ message: 'Status updated.', id, completada: resolvedCompletada, estado: resolvedEstado });
    });
});

app.delete('/api/delete-agenda/:id', apiWriteLimiter.middleware, requireAdmin, preventDuplicateSubmit({ dedupeWindowMs: 0 }), (req, res) => {
    const id = parseAgendaId(req.params.id);
    if (!id) return res.status(400).send('Invalid activity ID.');

    const sql = 'DELETE FROM RegistrosAgenda WHERE id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error deleting activity.');
        }
        if (result.affectedRows === 0) {
            return res.status(404).send('Activity not found.');
        }
        db.query("DELETE FROM RecordatoriosEstado WHERE ref_id = ? AND tipo = 'agenda'", [id], () => {});
        res.json({ message: 'Activity deleted successfully.', id });
    });
});

// ==========================================
// CONFIGURACIÓN PERSONAL, RECORDATORIOS Y NOTIFICACIONES MÓVILES
// ==========================================
function dbQueryAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// ==========================================
// DIRECTORIO DE CROQUIS TEC DE SALTILLO (ITS), UBICACIONES Y TRÁFICO
// ==========================================
const ITS_CAMPUS_DIRECTORY = {
    principal: {
        id: 'principal',
        name: 'ITS Campus Principal',
        plano: 'CTO-002',
        address: 'Blvd. V. Carranza #2400, Col. Tecnológico, Saltillo, Coah.',
        lat: 25.443706,
        lng: -100.993845,
        buildings: 'Aulas A-3..A-24 (Piso 1), B-2..B-21 (Piso 2), C-2..C-13 (Piso 3), CR-01..CR-15, AM-1..AM-5, TM1..TM3, LAC-L2A, SM1, LF1, SJMM'
    },
    miravalle: {
        id: 'miravalle',
        name: 'ITS Campus Miravalle',
        plano: 'CTO-003',
        address: 'Calle Miravalle y Calle Reynosa (Puente Peatonal 37), Saltillo, Coah.',
        lat: 25.445350,
        lng: -100.991200,
        buildings: 'Aulas N-1..N-42 (Edif. 60-65), LMA, LE2..LE4, PLC, LM1..LM2, LEL, LIN, LS1..LS5, LC1..LC3, AP1'
    },
    boillot: {
        id: 'boillot',
        name: 'ITS Campus Boillot (Sistemas y Mecatrónica)',
        plano: 'CTO-004',
        address: 'Blvd. Saltillo, Calle Reynosa y Cuatrociénegas, Saltillo, Coah.',
        lat: 25.443950,
        lng: -100.989650,
        buildings: 'Edif. 78 Sistemas (Aulas R-1..R-14), Edif. 79 Mecatrónica (S-13..S-20, LC3, CLO), Edif. 80 Ed. Distancia (ED1..ED4), Edif. 81 Vinculación (AV1..AV2)'
    }
};

function withRoomAliases(obj) {
    return {
        ...obj,
        campusKey: obj.campusId,
        croquisCode: obj.plano,
        buildingName: obj.building
    };
}

function resolveItsClassroom(rawRoom = '') {
    const clean = String(rawRoom || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!clean) {
        return withRoomAliases({
            room: 'S/A',
            campusId: 'principal',
            campusName: ITS_CAMPUS_DIRECTORY.principal.name,
            plano: 'CTO-002',
            building: 'Campus General ITS',
            lat: ITS_CAMPUS_DIRECTORY.principal.lat,
            lng: ITS_CAMPUS_DIRECTORY.principal.lng
        });
    }

    const normalized = clean.replace(/^(AULA|SALON|LAB)/, '').replace(/^-+/, '');

    if (/^R-?0?\d+$/.test(normalized)) {
        const num = parseInt(normalized.replace(/\D/g, ''), 10) || 1;
        return withRoomAliases({
            room: `R${String(num).padStart(2, '0')}`,
            campusId: 'boillot',
            campusName: ITS_CAMPUS_DIRECTORY.boillot.name,
            plano: 'CTO-004',
            building: 'Edif. 78 Sistemas y Computación (Aulas R-1 a R-14)',
            lat: ITS_CAMPUS_DIRECTORY.boillot.lat,
            lng: ITS_CAMPUS_DIRECTORY.boillot.lng
        });
    }

    if (/^(S-?\d+|CLO)$/.test(normalized)) {
        return withRoomAliases({
            room: normalized,
            campusId: 'boillot',
            campusName: ITS_CAMPUS_DIRECTORY.boillot.name,
            plano: 'CTO-004',
            building: 'Edif. 79 Ingeniería Mecatrónica (Aulas S-13 a S-20 / CLO)',
            lat: ITS_CAMPUS_DIRECTORY.boillot.lat,
            lng: ITS_CAMPUS_DIRECTORY.boillot.lng
        });
    }

    if (/^ED-?\d+$/.test(normalized)) {
        return withRoomAliases({
            room: normalized,
            campusId: 'boillot',
            campusName: ITS_CAMPUS_DIRECTORY.boillot.name,
            plano: 'CTO-004',
            building: 'Edif. 80 Educación a Distancia (Aulas ED1 a ED4)',
            lat: ITS_CAMPUS_DIRECTORY.boillot.lat,
            lng: ITS_CAMPUS_DIRECTORY.boillot.lng
        });
    }

    if (/^AV-?\d+$/.test(normalized)) {
        return withRoomAliases({
            room: normalized,
            campusId: 'boillot',
            campusName: ITS_CAMPUS_DIRECTORY.boillot.name,
            plano: 'CTO-004',
            building: 'Edif. 81 Gestión Tecnológica y Vinculación (AV1 - AV2)',
            lat: ITS_CAMPUS_DIRECTORY.boillot.lat,
            lng: ITS_CAMPUS_DIRECTORY.boillot.lng
        });
    }

    if (/^N-?0?\d+$/.test(normalized)) {
        const num = parseInt(normalized.replace(/\D/g, ''), 10) || 1;
        let edif = 'Edif. 60-65 (Aulas N-1 a N-42)';
        if (num >= 1 && num <= 8) edif = 'Edif. 60 (Aulas N-1 a N-8)';
        else if (num >= 9 && num <= 16) edif = 'Edif. 61 (Aulas N-9 a N-16)';
        else if (num >= 17 && num <= 24) edif = 'Edif. 62 (Aulas N-17 a N-24)';
        else if (num >= 25 && num <= 26) edif = 'Edif. 63 (Aulas N-25 a N-26)';
        else if (num >= 27 && num <= 28) edif = 'Edif. 64 (Aulas N-27 a N-28)';
        else if (num >= 29) edif = 'Edif. 65 (Aulas N-29 a N-42)';
        return withRoomAliases({
            room: `N${String(num).padStart(2, '0')}`,
            campusId: 'miravalle',
            campusName: ITS_CAMPUS_DIRECTORY.miravalle.name,
            plano: 'CTO-003',
            building: edif,
            lat: ITS_CAMPUS_DIRECTORY.miravalle.lat,
            lng: ITS_CAMPUS_DIRECTORY.miravalle.lng
        });
    }

    if (/^(LMA|LE[234]|PLC|LM[12]|LEL|LIN|LS[1-5]|LC[123]|AP1)$/.test(normalized)) {
        return withRoomAliases({
            room: normalized,
            campusId: 'miravalle',
            campusName: ITS_CAMPUS_DIRECTORY.miravalle.name,
            plano: 'CTO-003',
            building: 'Laboratorios y Aulas Especializadas Campus Miravalle (Edif. 50-66)',
            lat: ITS_CAMPUS_DIRECTORY.miravalle.lat,
            lng: ITS_CAMPUS_DIRECTORY.miravalle.lng
        });
    }

    if (/^[ABC]-?0?\d+$/.test(normalized)) {
        const letter = normalized[0];
        const piso = letter === 'A' ? 'Piso 1 (Edif. 22)' : (letter === 'B' ? 'Piso 2 (Edif. 23)' : 'Piso 3 (Edif. 24)');
        return withRoomAliases({
            room: normalized,
            campusId: 'principal',
            campusName: ITS_CAMPUS_DIRECTORY.principal.name,
            plano: 'CTO-002',
            building: `Aulas ${letter} · ${piso}`,
            lat: ITS_CAMPUS_DIRECTORY.principal.lat,
            lng: ITS_CAMPUS_DIRECTORY.principal.lng
        });
    }

    return withRoomAliases({
        room: normalized,
        campusId: 'principal',
        campusName: ITS_CAMPUS_DIRECTORY.principal.name,
        plano: 'CTO-002',
        building: 'Campus Principal ITS (CR / AM / TM / SM / LAC)',
        lat: ITS_CAMPUS_DIRECTORY.principal.lat,
        lng: ITS_CAMPUS_DIRECTORY.principal.lng
    });
}

function isValidNonZeroCoords(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
    // Evitar "Null Island" (0, 0) generado por inputs vacíos o errores de mapa
    if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) return false;
    return true;
}

function parseCoordinatesFromInput(input = {}) {
    if (!input || typeof input !== 'object') return null;
    const rawLat = input.lat !== undefined && input.lat !== null && input.lat !== '' ? input.lat : input.latitude;
    const rawLng = input.lng !== undefined && input.lng !== null && input.lng !== '' ? input.lng : input.longitude;
    let lat = rawLat !== undefined && rawLat !== null && rawLat !== '' ? Number(rawLat) : NaN;
    let lng = rawLng !== undefined && rawLng !== null && rawLng !== '' ? Number(rawLng) : NaN;

    if (!isValidNonZeroCoords(lat, lng)) {
        lat = NaN;
        lng = NaN;
    }

    const urlOrText = [input.mapsUrl, input.url, input.coords, input.query, input.input]
        .find(v => typeof v === 'string' && v.trim());

    if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && urlOrText) {
        const rawUrl = urlOrText.trim();
        let decodedUrl = rawUrl;
        try {
            decodedUrl = decodeURIComponent(rawUrl);
        } catch (_) {
            decodedUrl = rawUrl;
        }
        const candidateStr = `${rawUrl}\n${decodedUrl}`;
        const pinMatch = candidateStr.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) ||
                         candidateStr.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ||
                         candidateStr.match(/[?&](?:q|query|ll|center|destination|origin)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i) ||
                         candidateStr.match(/(?:^|[\s:/=])(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
        if (pinMatch) {
            const pLat = Number(pinMatch[1]);
            const pLng = Number(pinMatch[2]);
            if (isValidNonZeroCoords(pLat, pLng)) {
                lat = pLat;
                lng = pLng;
            }
        }
    }

    if (!isValidNonZeroCoords(lat, lng)) {
        return null;
    }
    return {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6))
    };
}

function calculateHaversineKm(lat1, lng1, lat2, lng2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getSaltilloTrafficFactor(minutesOfDay, weekday = 1) {
    const isWeekend = weekday === 0 || weekday === 6;
    if (isWeekend) {
        return { level: 'low', label: 'Tráfico ligero', factor: 1.1 };
    }
    // Horas pico en Saltillo (Blvd. V. Carranza / Reynosa / Blvd. Saltillo)
    if (
        (minutesOfDay >= 7 * 60 && minutesOfDay <= 9 * 60 + 15) ||
        (minutesOfDay >= 13 * 60 && minutesOfDay <= 15 * 60 + 15) ||
        (minutesOfDay >= 17 * 60 + 30 && minutesOfDay <= 20 * 60)
    ) {
        return { level: 'high', label: 'Tráfico hora pico', factor: 1.48 };
    }
    if (minutesOfDay >= 6 * 60 + 30 && minutesOfDay <= 21 * 60) {
        return { level: 'moderate', label: 'Tráfico moderado', factor: 1.24 };
    }
    return { level: 'low', label: 'Tráfico fluido', factor: 1.05 };
}

function buildGoogleMapsDirectionsUrl(originCoords, destCoords, mode = 'driving') {
    if (!destCoords || !isValidNonZeroCoords(Number(destCoords.lat), Number(destCoords.lng))) return '';
    const destParam = `${destCoords.lat},${destCoords.lng}`;
    const travelMode = mode === 'walking' ? 'walking' : 'driving';
    if (originCoords && isValidNonZeroCoords(Number(originCoords.lat), Number(originCoords.lng))) {
        const origParam = `${originCoords.lat},${originCoords.lng}`;
        return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origParam)}&destination=${encodeURIComponent(destParam)}&travelmode=${travelMode}`;
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destParam)}&travelmode=${travelMode}`;
}

function estimateCommuteDetails({
    originCoords,
    destCoords,
    targetMinutesOfDay = 9 * 60,
    weekday = 1,
    isFirstOfDay = true,
    nearRadiusKm = 0.85,
    minFarLeadMinutes = 30,
    nearLeadMinutes = 10,
    parkingBufferMinutes = 8
}) {
    if (!destCoords || !isValidNonZeroCoords(Number(destCoords.lat), Number(destCoords.lng))) {
        return {
            hasOrigin: false,
            isNear: !isFirstOfDay,
            distanceKm: 0,
            roadDistanceKm: 0,
            driveMinutes: isFirstOfDay ? 22 : 0,
            walkMinutes: 6,
            trafficLabel: 'Ruta estándar',
            recommendedLeadMinutes: isFirstOfDay ? Math.max(30, minFarLeadMinutes) : nearLeadMinutes,
            mapsUrl: ''
        };
    }

    if (!originCoords || !isValidNonZeroCoords(Number(originCoords.lat), Number(originCoords.lng))) {
        const fallbackLead = isFirstOfDay ? Math.max(30, minFarLeadMinutes) : nearLeadMinutes;
        return {
            hasOrigin: false,
            isNear: !isFirstOfDay,
            distanceKm: 0,
            roadDistanceKm: 0,
            driveMinutes: isFirstOfDay ? 20 : 0,
            walkMinutes: 5,
            trafficLabel: isFirstOfDay ? 'Estimado desde casa (sin GPS activo)' : 'En campus / cerca',
            recommendedLeadMinutes: fallbackLead,
            mapsUrl: buildGoogleMapsDirectionsUrl(null, destCoords, isFirstOfDay ? 'driving' : 'walking')
        };
    }

    const straightKm = calculateHaversineKm(originCoords.lat, originCoords.lng, destCoords.lat, destCoords.lng);
    const roadKm = Number((straightKm * 1.32).toFixed(2));
    const isNear = straightKm <= nearRadiusKm;
    const traffic = getSaltilloTrafficFactor(targetMinutesOfDay, weekday);
    // Velocidad base urbana en Saltillo ~30 km/h ajustada por factor de tráfico
    const baseDriveMin = (roadKm / 30) * 60 * traffic.factor;
    const driveMinutes = Math.max(3, Math.round(baseDriveMin));
    const walkMinutes = Math.max(2, Math.round((straightKm * 1.25 / 4.6) * 60));

    let recommendedLeadMinutes;
    if (isNear && !isFirstOfDay) {
        recommendedLeadMinutes = Math.max(nearLeadMinutes, Math.min(25, walkMinutes + 4));
    } else if (isNear && isFirstOfDay) {
        recommendedLeadMinutes = Math.max(nearLeadMinutes, Math.min(25, walkMinutes + 5));
    } else {
        recommendedLeadMinutes = Math.min(120, Math.max(30, minFarLeadMinutes, driveMinutes + parkingBufferMinutes));
    }

    return {
        hasOrigin: true,
        isNear,
        distanceKm: Number(straightKm.toFixed(2)),
        roadDistanceKm: roadKm,
        driveMinutes,
        walkMinutes,
        trafficLevel: traffic.level,
        trafficLabel: traffic.label,
        recommendedLeadMinutes,
        mapsUrl: buildGoogleMapsDirectionsUrl(originCoords, destCoords, isNear ? 'walking' : 'driving')
    };
}

function getItsMindboxPresetCourses() {
    return [
        {
            id: 'its-aca0910',
            code: 'ACA0910',
            name: 'Taller de Investigación II',
            teacher: 'Sorkee Quiroz Roxana Karina',
            group: 'B',
            room: 'R02',
            campusId: 'boillot',
            days: [1, 2, 3, 4],
            startTime: '09:00',
            endTime: '10:00'
        },
        {
            id: 'its-scg1009-lj',
            code: 'SCG1009',
            name: 'Gestión de Proyectos de Software',
            teacher: 'Fernández Chávez Eduardo',
            group: 'B',
            room: 'R11',
            campusId: 'boillot',
            days: [1, 2, 3, 4],
            startTime: '13:00',
            endTime: '14:00'
        },
        {
            id: 'its-scg1009-v',
            code: 'SCG1009',
            name: 'Gestión de Proyectos de Software (Viernes)',
            teacher: 'Fernández Chávez Eduardo',
            group: 'B',
            room: 'R11',
            campusId: 'boillot',
            days: [5],
            startTime: '12:00',
            endTime: '14:00'
        },
        {
            id: 'its-ded2504',
            code: 'DED2504',
            name: 'Integración y Despliegue Continuos',
            teacher: 'Manrique Peña Paola Denis',
            group: 'A',
            room: 'R11',
            campusId: 'boillot',
            days: [1, 2, 3, 4, 5],
            startTime: '14:00',
            endTime: '15:00'
        },
        {
            id: 'its-scc1019',
            code: 'SCC1019',
            name: 'Programación Lógica y Funcional',
            teacher: 'Espinoza Arzola Jesus Alberto',
            group: 'A',
            room: 'R11',
            campusId: 'boillot',
            days: [1, 2, 3, 4],
            startTime: '15:00',
            endTime: '16:00'
        },
        {
            id: 'its-ded2505',
            code: 'DED2505',
            name: 'Desarrollo Seguro',
            teacher: 'Cabrera Fraga Pricila',
            group: 'A',
            room: 'R11',
            campusId: 'boillot',
            days: [1, 2, 3, 4, 5],
            startTime: '16:00',
            endTime: '17:00'
        }
    ];
}

function getDefaultAcademicPlanner() {
    return {
        universityName: 'Instituto Tecnológico de Saltillo (TecNM)',
        activeSemesterId: 'sem-9no-2026',
        classRemindersEnabled: true,
        farLeadMinutesMin: 30,
        nearLeadMinutes: 10,
        nearRadiusKm: 0.85,
        parkingBufferMinutes: 8,
        locations: {
            home: {
                label: 'Mi Casa',
                address: 'Saltillo, Coahuila',
                mapsUrl: '',
                lat: null,
                lng: null
            },
            university: {
                label: 'Instituto Tecnológico de Saltillo (Blvd. V. Carranza #2400)',
                address: 'Blvd. V. Carranza #2400, Col. Tecnológico, Saltillo',
                mapsUrl: 'https://www.google.com/maps?q=25.443706,-100.993845',
                lat: 25.443706,
                lng: -100.993845
            },
            current: {
                label: 'Ubicación actual',
                lat: null,
                lng: null,
                updatedAt: null,
                source: 'none'
            }
        },
        semesters: [
            {
                id: 'sem-9no-2026',
                name: '9no Semestre · Ing. en Sistemas Computacionales',
                termCode: '2026-2',
                startDate: '2026-08-17',
                endDate: '2026-12-18',
                active: true,
                courses: getItsMindboxPresetCourses()
            }
        ],
        vacations: [
            {
                id: 'vac-semana-santa-2026',
                name: 'Vacaciones de Semana Santa TecNM',
                nombre: 'Vacaciones de Semana Santa TecNM',
                startDate: '2026-03-30',
                endDate: '2026-04-10',
                fechaInicio: '2026-03-30',
                fechaFin: '2026-04-10'
            },
            {
                id: 'vac-invierno-2026',
                name: 'Vacaciones de Invierno TecNM',
                nombre: 'Vacaciones de Invierno TecNM',
                startDate: '2026-12-19',
                endDate: '2027-01-17',
                fechaInicio: '2026-12-19',
                fechaFin: '2027-01-17'
            }
        ],
        residencias: {
            enabled: false,
            projectName: '',
            companyName: '',
            advisorName: '',
            modality: 'presencial',
            totalHoursGoal: 500,
            loggedHours: 0,
            days: [1, 2, 3, 4, 5],
            startTime: '08:00',
            endTime: '13:00',
            location: {
                label: 'Empresa de Residencias',
                address: '',
                mapsUrl: '',
                lat: null,
                lng: null
            }
        },
        work: {
            enabled: false,
            scheduleType: 'medio_tiempo',
            companyName: '',
            roleTitle: '',
            modality: 'presencial',
            days: [1, 2, 3, 4, 5],
            startTime: '08:00',
            endTime: '16:00',
            location: {
                label: 'Lugar de Trabajo',
                address: '',
                mapsUrl: '',
                lat: null,
                lng: null
            }
        }
    };
}

function sanitizeLocationObject(rawLoc = {}, fallback = {}) {
    const base = {
        label: String(fallback.label || 'Ubicación').slice(0, 120),
        address: String(fallback.address || '').slice(0, 200),
        mapsUrl: String(fallback.mapsUrl || '').slice(0, 500),
        lat: fallback.lat ?? null,
        lng: fallback.lng ?? null
    };
    if (!rawLoc || typeof rawLoc !== 'object') return base;
    if (typeof rawLoc.label === 'string') base.label = rawLoc.label.trim().slice(0, 120) || base.label;
    if (typeof rawLoc.address === 'string') base.address = rawLoc.address.trim().slice(0, 200);
    if (typeof rawLoc.mapsUrl === 'string') base.mapsUrl = rawLoc.mapsUrl.trim().slice(0, 500);

    const parsedCoords = parseCoordinatesFromInput({
        lat: rawLoc.lat,
        lng: rawLoc.lng,
        mapsUrl: base.mapsUrl
    });
    if (parsedCoords) {
        base.lat = parsedCoords.lat;
        base.lng = parsedCoords.lng;
    } else if (rawLoc.lat === null || rawLoc.lat === '' || rawLoc.lng === null || rawLoc.lng === '') {
        base.lat = null;
        base.lng = null;
    }
    if (!isValidNonZeroCoords(Number(base.lat), Number(base.lng))) {
        base.lat = null;
        base.lng = null;
    }
    return base;
}

function sanitizeAcademicPlanner(rawPlanner = {}, basePlanner = getDefaultAcademicPlanner()) {
    const def = getDefaultAcademicPlanner();
    const src = rawPlanner && typeof rawPlanner === 'object' ? rawPlanner : {};
    const prev = basePlanner && typeof basePlanner === 'object' ? basePlanner : def;

    const out = {
        universityName: typeof src.universityName === 'string' && src.universityName.trim()
            ? src.universityName.trim().slice(0, 140)
            : (prev.universityName || def.universityName),
        activeSemesterId: typeof src.activeSemesterId === 'string' && src.activeSemesterId.trim()
            ? src.activeSemesterId.trim().slice(0, 60)
            : (prev.activeSemesterId || def.activeSemesterId),
        classRemindersEnabled: typeof src.classRemindersEnabled === 'boolean'
            ? src.classRemindersEnabled
            : (typeof prev.classRemindersEnabled === 'boolean' ? prev.classRemindersEnabled : true),
        farLeadMinutesMin: Number.isFinite(Number(src.farLeadMinutesMin))
            ? Math.max(30, Math.min(120, Math.round(Number(src.farLeadMinutesMin))))
            : (prev.farLeadMinutesMin || 30),
        nearLeadMinutes: Number.isFinite(Number(src.nearLeadMinutes))
            ? Math.max(5, Math.min(45, Math.round(Number(src.nearLeadMinutes))))
            : (prev.nearLeadMinutes || 10),
        nearRadiusKm: Number.isFinite(Number(src.nearRadiusKm))
            ? Math.max(0.2, Math.min(5, Number(Number(src.nearRadiusKm).toFixed(2))))
            : (prev.nearRadiusKm || 0.85),
        parkingBufferMinutes: Number.isFinite(Number(src.parkingBufferMinutes))
            ? Math.max(0, Math.min(30, Math.round(Number(src.parkingBufferMinutes))))
            : (prev.parkingBufferMinutes ?? 8),
        locations: {
            home: sanitizeLocationObject(src.locations?.home, prev.locations?.home || def.locations.home),
            university: sanitizeLocationObject(src.locations?.university, prev.locations?.university || def.locations.university),
            current: {
                label: typeof src.locations?.current?.label === 'string' && src.locations.current.label.trim()
                    ? src.locations.current.label.trim().slice(0, 80)
                    : (prev.locations?.current?.label || 'Ubicación actual'),
                lat: null,
                lng: null,
                updatedAt: src.locations?.current?.updatedAt || prev.locations?.current?.updatedAt || null,
                source: String(src.locations?.current?.source || prev.locations?.current?.source || 'none').slice(0, 30)
            }
        },
        phoneGpsNonce: typeof src.phoneGpsNonce === 'string' && /^[a-f0-9]{16,64}$/i.test(src.phoneGpsNonce.trim())
            ? src.phoneGpsNonce.trim()
            : (typeof prev.phoneGpsNonce === 'string' && /^[a-f0-9]{16,64}$/i.test(prev.phoneGpsNonce.trim()) ? prev.phoneGpsNonce.trim() : ''),
        semesters: [],
        vacations: [],
        residencias: {},
        work: {}
    };

    const currCoords = parseCoordinatesFromInput(src.locations?.current || prev.locations?.current || {});
    if (currCoords) {
        out.locations.current.lat = currCoords.lat;
        out.locations.current.lng = currCoords.lng;
    } else {
        out.locations.current.lat = null;
        out.locations.current.lng = null;
        out.locations.current.updatedAt = null;
        out.locations.current.source = 'none';
    }

    const rawSemesters = Array.isArray(src.semesters) ? src.semesters : (Array.isArray(prev.semesters) ? prev.semesters : def.semesters);
    out.semesters = rawSemesters.slice(0, 16).map((sem, idx) => {
        const sId = typeof sem?.id === 'string' && sem.id.trim() ? sem.id.trim().slice(0, 60) : `sem-${idx + 1}`;
        const rawCourses = Array.isArray(sem?.courses) ? sem.courses : [];
        const courses = rawCourses.slice(0, 30).map((c, cIdx) => {
            const roomInfo = resolveItsClassroom(c?.room || '');
            const days = Array.isArray(c?.days)
                ? Array.from(new Set(c.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b)
                : [1, 2, 3, 4, 5];
            return {
                id: typeof c?.id === 'string' && c.id.trim() ? c.id.trim().slice(0, 60) : `course-${idx + 1}-${cIdx + 1}`,
                code: String(c?.code || '').trim().slice(0, 30),
                name: String(c?.name || 'Materia').trim().slice(0, 120) || 'Materia',
                teacher: String(c?.teacher || '').trim().slice(0, 120),
                group: String(c?.group || '').trim().slice(0, 20),
                room: roomInfo.room,
                campusId: ['principal', 'miravalle', 'boillot'].includes(c?.campusId) ? c.campusId : roomInfo.campusId,
                days: days.length ? days : [1, 2, 3, 4, 5],
                startTime: HHMM_REGEX.test(String(c?.startTime || '').trim()) ? String(c.startTime).trim() : '09:00',
                endTime: HHMM_REGEX.test(String(c?.endTime || '').trim()) ? String(c.endTime).trim() : '10:00'
            };
        });
        return {
            id: sId,
            name: String(sem?.name || `Semestre ${idx + 1}`).trim().slice(0, 120),
            termCode: String(sem?.termCode || '').trim().slice(0, 30),
            startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(sem?.startDate || '')) ? String(sem.startDate) : '2026-08-17',
            endDate: /^\d{4}-\d{2}-\d{2}$/.test(String(sem?.endDate || '')) ? String(sem.endDate) : '2026-12-18',
            active: Boolean(sem?.active),
            courses
        };
    });
    if (out.semesters.length === 0) {
        out.semesters = def.semesters;
    }
    if (!out.semesters.some(s => s.id === out.activeSemesterId)) {
        out.activeSemesterId = out.semesters[0].id;
    }

    const rawVacations = Array.isArray(src.vacations) ? src.vacations : (Array.isArray(prev.vacations) ? prev.vacations : def.vacations);
    out.vacations = rawVacations.slice(0, 30).filter(v =>
        v && /^\d{4}-\d{2}-\d{2}$/.test(String(v.startDate || '')) && /^\d{4}-\d{2}-\d{2}$/.test(String(v.endDate || ''))
    ).map((v, vIdx) => ({
        id: typeof v.id === 'string' && v.id.trim() ? v.id.trim().slice(0, 60) : `vac-${vIdx + 1}`,
        name: String(v.name || 'Periodo vacacional').trim().slice(0, 120),
        startDate: String(v.startDate),
        endDate: String(v.endDate)
    }));

    const rawRes = src.residencias && typeof src.residencias === 'object' ? src.residencias : (prev.residencias || def.residencias);
    const resDays = Array.isArray(rawRes.days)
        ? Array.from(new Set(rawRes.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b)
        : [1, 2, 3, 4, 5];
    out.residencias = {
        enabled: Boolean(rawRes.enabled),
        projectName: String(rawRes.projectName || '').trim().slice(0, 160),
        companyName: String(rawRes.companyName || '').trim().slice(0, 140),
        advisorName: String(rawRes.advisorName || '').trim().slice(0, 120),
        modality: ['presencial', 'hibrido', 'remoto'].includes(rawRes.modality) ? rawRes.modality : 'presencial',
        totalHoursGoal: Number.isFinite(Number(rawRes.totalHoursGoal)) ? Math.max(1, Math.min(2000, Math.round(Number(rawRes.totalHoursGoal)))) : 500,
        loggedHours: Number.isFinite(Number(rawRes.loggedHours)) ? Math.max(0, Math.min(2000, Number(Number(rawRes.loggedHours).toFixed(1)))) : 0,
        days: resDays.length ? resDays : [1, 2, 3, 4, 5],
        startTime: HHMM_REGEX.test(String(rawRes.startTime || '').trim()) ? String(rawRes.startTime).trim() : '08:00',
        endTime: HHMM_REGEX.test(String(rawRes.endTime || '').trim()) ? String(rawRes.endTime).trim() : '13:00',
        location: sanitizeLocationObject(rawRes.location, prev.residencias?.location || def.residencias.location)
    };

    const rawWork = src.work && typeof src.work === 'object' ? src.work : (prev.work || def.work);
    const workDays = Array.isArray(rawWork.days)
        ? Array.from(new Set(rawWork.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b)
        : [1, 2, 3, 4, 5];
    out.work = {
        enabled: Boolean(rawWork.enabled),
        scheduleType: ['tiempo_completo', 'medio_tiempo', 'por_turnos'].includes(rawWork.scheduleType) ? rawWork.scheduleType : 'medio_tiempo',
        companyName: String(rawWork.companyName || '').trim().slice(0, 140),
        roleTitle: String(rawWork.roleTitle || '').trim().slice(0, 120),
        modality: ['presencial', 'hibrido', 'remoto'].includes(rawWork.modality) ? rawWork.modality : 'presencial',
        days: workDays.length ? workDays : [1, 2, 3, 4, 5],
        startTime: HHMM_REGEX.test(String(rawWork.startTime || '').trim()) ? String(rawWork.startTime).trim() : '08:00',
        endTime: HHMM_REGEX.test(String(rawWork.endTime || '').trim()) ? String(rawWork.endTime).trim() : '16:00',
        location: sanitizeLocationObject(rawWork.location, prev.work?.location || def.work.location)
    };

    return out;
}

function getDefaultUserSettings() {
    return {
        defaultAgendaCategory: 'all',
        defaultAgendaLayout: 'auto',
        agendaShowWeekend: true,
        timezone: process.env.TZ || 'America/Monterrey',
        publicBaseUrl: '',
        youtubePlatformMode: 'auto',
        phoneNotificationsEnabled: false,
        ntfyServerUrl: 'https://ntfy.sh',
        ntfyTopic: '',
        ntfyPriority: 4,
        desktopNotificationsEnabled: false,
        moodRemindersEnabled: true,
        moodNotifyPending: true,
        moodIncludeLateNight: false,
        sleepReminderEnabled: true,
        sleepReminderTime: '08:30',
        agendaRemindersEnabled: true,
        agendaNotifyEvents: true,
        agendaNotifyTasks: true,
        agendaNotifyPendingTasks: true,
        agendaLeadMinutes: 10,
        wordEodReminderEnabled: true,
        wordEodReminderTime: '21:30',
        englishReminderEnabled: false,
        englishReminderTime: '19:00',
        englishReminderDays: [1, 2, 3, 4, 5],
        englishReminderTopic: 'Practice vocabulary, grammar notes, and phrasal verbs',
        preferredStudyLanguage: 'en_ko',
        geminiModel: 'gemini-2.5-flash',
        geminiApiKey: '',
        languageMemory: sanitizeLanguageMemory(),
        academicPlanner: getDefaultAcademicPlanner()
    };
}

function maskGeminiApiKey(key) {
    const clean = String(key || '').trim();
    if (!clean) return '';
    if (clean.length <= 8) return '••••••••';
    return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

function sanitizeSettingsForClient(settings = {}) {
    const { geminiApiKey, ...rest } = settings;
    const hasUserKey = Boolean(String(geminiApiKey || '').trim());
    const hasEnvKey = Boolean(String(process.env.GEMINI_API_KEY || '').trim());
    return {
        ...rest,
        geminiApiKeyConfigured: hasUserKey || hasEnvKey,
        geminiKeySource: hasUserKey ? 'user' : (hasEnvKey ? 'server_env' : 'none'),
        geminiApiKeyHint: hasUserKey
            ? maskGeminiApiKey(geminiApiKey)
            : (hasEnvKey ? 'Server GEMINI_API_KEY active' : '')
    };
}

function isBlockedPrivateHostname(hostname) {
    const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
        return true;
    }
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) {
        return true;
    }
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
        return true;
    }
    if (host === '::1' || /^(fe80:|fc|fd)/i.test(host)) {
        return true;
    }
    return false;
}

function validatePushServerUrl(rawUrl) {
    const raw = typeof rawUrl === 'string' && rawUrl.trim() ? rawUrl.trim() : 'https://ntfy.sh';
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (_) {
        return { error: 'Notification server URL must be a valid HTTPS URL (e.g. https://ntfy.sh).' };
    }
    if (parsed.protocol !== 'https:') {
        return { error: 'Notification server URL must use HTTPS.' };
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        return { error: 'Notification server URL cannot include credentials, query strings, or fragments.' };
    }
    if (isBlockedPrivateHostname(parsed.hostname)) {
        return { error: 'Private or local network hosts are not allowed for notification relays.' };
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    return { url: `${parsed.origin}${cleanPath}` };
}

function validateTimeZoneName(rawTz, fallbackTz) {
    const tz = typeof rawTz === 'string' && rawTz.trim() ? rawTz.trim() : fallbackTz;
    if (tz.length > 80) return null;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
        return tz;
    } catch (_) {
        return null;
    }
}

function validateUserSettingsPayload(input = {}, base = getDefaultUserSettings()) {
    const next = { ...base };

    if (input.defaultAgendaCategory !== undefined) {
        const val = String(input.defaultAgendaCategory).trim().toLowerCase();
        if (!['all', 'universidad', 'personal'].includes(val)) {
            return { error: 'Invalid default agenda category.' };
        }
        next.defaultAgendaCategory = val;
    }

    if (input.defaultAgendaLayout !== undefined) {
        const val = String(input.defaultAgendaLayout).trim().toLowerCase();
        if (!['auto', 'grid', 'day'].includes(val)) {
            return { error: 'Invalid default agenda layout.' };
        }
        next.defaultAgendaLayout = val;
    }
    if (input.youtubePlatformMode !== undefined) {
        const val = String(input.youtubePlatformMode).trim().toLowerCase();
        if (!['auto', 'youtube', 'yt_music'].includes(val)) {
            return { error: 'Invalid YouTube platform mode.' };
        }
        next.youtubePlatformMode = val;
    }

    const boolKeys = [
        'agendaShowWeekend',
        'phoneNotificationsEnabled',
        'desktopNotificationsEnabled',
        'moodRemindersEnabled',
        'moodNotifyPending',
        'moodIncludeLateNight',
        'sleepReminderEnabled',
        'agendaRemindersEnabled',
        'agendaNotifyEvents',
        'agendaNotifyTasks',
        'agendaNotifyPendingTasks',
        'wordEodReminderEnabled',
        'englishReminderEnabled'
    ];
    for (const key of boolKeys) {
        if (input[key] !== undefined) {
            if (typeof input[key] !== 'boolean') {
                return { error: `Field ${key} must be a boolean.` };
            }
            next[key] = input[key];
        }
    }

    if (input.timezone !== undefined) {
        const validTz = validateTimeZoneName(input.timezone, base.timezone);
        if (!validTz) {
            return { error: 'Invalid IANA timezone (e.g. America/Monterrey).' };
        }
        next.timezone = validTz;
    }

    if (input.publicBaseUrl !== undefined) {
        const rawBase = String(input.publicBaseUrl || '').trim().replace(/\/+$/, '');
        if (rawBase && !/^https?:\/\/[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(rawBase)) {
            return { error: 'App public URL must look like http://host:3000 or https://example.com.' };
        }
        next.publicBaseUrl = rawBase;
    }

    if (input.ntfyServerUrl !== undefined) {
        const urlCheck = validatePushServerUrl(input.ntfyServerUrl);
        if (urlCheck.error) return { error: urlCheck.error };
        next.ntfyServerUrl = urlCheck.url;
    }

    if (input.ntfyTopic !== undefined) {
        const topic = String(input.ntfyTopic || '').trim();
        if (topic && !/^[a-zA-Z0-9_-]{8,80}$/.test(topic)) {
            return { error: 'Phone notification topic must be 8–80 characters (letters, numbers, "_" or "-").' };
        }
        next.ntfyTopic = topic;
    }

    if (next.phoneNotificationsEnabled && !next.ntfyTopic) {
        return { error: 'Enter or generate a private ntfy topic before enabling phone notifications.' };
    }

    if (input.ntfyPriority !== undefined) {
        const prio = Number(input.ntfyPriority);
        if (!Number.isInteger(prio) || prio < 1 || prio > 5) {
            return { error: 'Notification priority must be an integer between 1 and 5.' };
        }
        next.ntfyPriority = prio;
    }

    const timeKeys = ['sleepReminderTime', 'wordEodReminderTime', 'englishReminderTime'];
    for (const tKey of timeKeys) {
        if (input[tKey] !== undefined) {
            const tVal = String(input[tKey] || '').trim();
            if (!HHMM_REGEX.test(tVal)) {
                return { error: `Field ${tKey} must use HH:MM format (00:00 - 23:59).` };
            }
            next[tKey] = tVal;
        }
    }

    if (input.agendaLeadMinutes !== undefined) {
        const mins = Number(input.agendaLeadMinutes);
        if (!Number.isInteger(mins) || mins < 0 || mins > 120) {
            return { error: 'Agenda lead minutes must be between 0 and 120.' };
        }
        next.agendaLeadMinutes = mins;
    }

    if (input.englishReminderDays !== undefined) {
        if (!Array.isArray(input.englishReminderDays)) {
            return { error: 'English study days must be an array of weekday numbers (0-6).' };
        }
        const uniqueDays = Array.from(new Set(input.englishReminderDays.map(Number)));
        if (uniqueDays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
            return { error: 'English study days must contain integers from 0 (Sun) to 6 (Sat).' };
        }
        next.englishReminderDays = uniqueDays.sort((a, b) => a - b);
    }

    if (input.englishReminderTopic !== undefined) {
        const topicText = String(input.englishReminderTopic || '').trim();
        if (topicText.length > 200) {
            return { error: 'English study reminder note cannot exceed 200 characters.' };
        }
        next.englishReminderTopic = topicText || getDefaultUserSettings().englishReminderTopic;
    }

    if (input.preferredStudyLanguage !== undefined) {
        next.preferredStudyLanguage = normalizeStudyLanguage(input.preferredStudyLanguage);
    }

    if (input.geminiModel !== undefined) {
        next.geminiModel = validateGeminiModelId(input.geminiModel);
    }

    if (input.clearGeminiApiKey === true) {
        next.geminiApiKey = '';
    } else if (input.geminiApiKey !== undefined) {
        const rawKey = String(input.geminiApiKey || '').trim();
        if (rawKey.length > 180) {
            return { error: 'Gemini API key exceeds maximum allowed length (180 characters).' };
        }
        next.geminiApiKey = rawKey;
    }

    if (input.languageMemory !== undefined) {
        next.languageMemory = sanitizeLanguageMemory(input.languageMemory);
    } else {
        next.languageMemory = sanitizeLanguageMemory(base.languageMemory);
    }

    if (input.academicPlanner !== undefined) {
        next.academicPlanner = sanitizeAcademicPlanner(input.academicPlanner, base.academicPlanner);
    } else {
        next.academicPlanner = sanitizeAcademicPlanner(base.academicPlanner);
    }

    return { settings: next };
}

async function loadUserSettings(userId) {
    const defaults = getDefaultUserSettings();
    const rows = await dbQueryAsync('SELECT config_json FROM ConfiguracionUsuario WHERE usuario_id = ? LIMIT 1', [userId]);
    if (!rows || rows.length === 0 || !rows[0].config_json) {
        return defaults;
    }
    try {
        const parsed = typeof rows[0].config_json === 'string'
            ? JSON.parse(rows[0].config_json)
            : rows[0].config_json;
        const validated = validateUserSettingsPayload(parsed, defaults);
        return validated.settings || defaults;
    } catch (_) {
        return defaults;
    }
}

async function saveUserSettings(userId, settings) {
    const jsonText = JSON.stringify(settings);
    await dbQueryAsync(
        `INSERT INTO ConfiguracionUsuario (usuario_id, config_json)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)`,
        [userId, jsonText]
    );
}

function getLocalNowParts(timeZone) {
    const safeTz = validateTimeZoneName(timeZone, process.env.TZ || 'America/Monterrey') || 'UTC';
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: safeTz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(now);

    const map = {};
    parts.forEach(p => {
        map[p.type] = p.value;
    });
    const hourNum = Number(map.hour) % 24;
    const minNum = Number(map.minute) || 0;
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        dateStr: `${map.year}-${map.month}-${map.day}`,
        weekday: dayMap[map.weekday] !== undefined ? dayMap[map.weekday] : now.getDay(),
        hhmm: `${String(hourNum).padStart(2, '0')}:${String(minNum).padStart(2, '0')}`,
        minutesOfDay: hourNum * 60 + minNum,
        timeZone: safeTz
    };
}

function hhmmToMinutes(hhmm) {
    const [h, m] = String(hhmm || '00:00').split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

const MOOD_REMINDER_WINDOWS = [
    { key: 'Morning', label: 'Morning', triggerMin: 9 * 60, startMin: 6 * 60, endMin: 12 * 60, optional: false },
    { key: 'Noon', label: 'Noon', triggerMin: 13 * 60, startMin: 12 * 60, endMin: 14 * 60, optional: false },
    { key: 'Afternoon', label: 'Afternoon', triggerMin: 17 * 60, startMin: 14 * 60, endMin: 20 * 60, optional: false },
    { key: 'Night', label: 'Night', triggerMin: 22 * 60, startMin: 20 * 60, endMin: 24 * 60, optional: false },
    { key: 'Madrugada', label: 'Late Night', triggerMin: 3 * 60, startMin: 0, endMin: 6 * 60, optional: true }
];

function isDateInVacation(dateStr, vacations = []) {
    if (!Array.isArray(vacations)) return null;
    return vacations.find(v => v && v.startDate && v.endDate && dateStr >= v.startDate && dateStr <= v.endDate) || null;
}

function resolveUserOriginCoords(planner, isFirstClassOrShift = true) {
    const curr = parseCoordinatesFromInput(planner?.locations?.current || {});
    const home = parseCoordinatesFromInput(planner?.locations?.home || {});
    const uni = parseCoordinatesFromInput(planner?.locations?.university || {}) || {
        lat: ITS_CAMPUS_DIRECTORY.principal.lat,
        lng: ITS_CAMPUS_DIRECTORY.principal.lng
    };

    if (curr) {
        return { coords: curr, sourceLabel: planner?.locations?.current?.label || 'tu ubicación GPS actual' };
    }
    if (isFirstClassOrShift && home) {
        return { coords: home, sourceLabel: planner?.locations?.home?.label || 'tu Casa' };
    }
    if (!isFirstClassOrShift) {
        return { coords: uni, sourceLabel: 'Campus ITS' };
    }
    return { coords: home || null, sourceLabel: home ? 'tu Casa' : 'tu ubicación' };
}

function computeCandidateReminders({
    settings,
    localNow,
    moodLogsToday = [],
    sleepLogsToday = [],
    agendaItemsToday = [],
    pendingTasksWeek = [],
    queueCounts = { journal: 0, english: 0 }
}) {
    const candidates = [];
    const { dateStr, weekday, minutesOfDay } = localNow;

    // 1. Automatic Mood Tracker mid-window reminders + Pending earlier mood check-ins
    if (settings.moodRemindersEnabled) {
        const loggedMoments = new Set(moodLogsToday.map(r => r.momento_dia));
        const activeWin = MOOD_REMINDER_WINDOWS.find(w =>
            minutesOfDay >= w.startMin &&
            minutesOfDay < w.endMin &&
            (!w.optional || settings.moodIncludeLateNight)
        );
        if (activeWin && minutesOfDay >= activeWin.triggerMin && !loggedMoments.has(activeWin.key)) {
            candidates.push({
                key: `mood:${dateStr}:${activeWin.key}`,
                type: 'mood',
                refId: null,
                title: `Mood Check-in (${activeWin.label})`,
                message: `Mid-${activeWin.label.toLowerCase()} check-in: log how you feel right now in Daily Hub.`,
                targetView: 'mood',
                targetDate: dateStr,
                targetMoment: activeWin.key,
                pendingMoments: [activeWin.key],
                canSnooze: true,
                canComplete: false
            });
        }

        if (settings.moodNotifyPending !== false) {
            const missedWindows = MOOD_REMINDER_WINDOWS.filter(w =>
                minutesOfDay >= w.endMin &&
                (!w.optional || settings.moodIncludeLateNight) &&
                !loggedMoments.has(w.key)
            );
            if (missedWindows.length > 0) {
                const missedLabels = missedWindows.map(w => w.label).join(', ');
                const firstMissed = missedWindows[0];
                const latestMissed = missedWindows[missedWindows.length - 1];
                candidates.push({
                    key: `mood-pending:${dateStr}:${latestMissed.key}`,
                    type: 'mood',
                    refId: null,
                    title: `Pending Mood Check-in (${missedLabels})`,
                    message: `You still have unlogged mood block(s) for today (${missedLabels}). Tap to record your mood in Daily Hub.`,
                    targetView: 'mood',
                    targetDate: dateStr,
                    targetMoment: firstMissed.key,
                    pendingMoments: missedWindows.map(w => w.key),
                    canSnooze: true,
                    canComplete: false
                });
            }
        }
    }

    // 2. Sleep Tracker morning reminder (with Postpone/Snooze + Pending Wake-up support)
    if (settings.sleepReminderEnabled) {
        const sleepStartMin = hhmmToMinutes(settings.sleepReminderTime);
        const hasCompletedOrAllNighter = sleepLogsToday.some(r =>
            Number(r.horas) > 0 ||
            Boolean(r.hora_despertar) ||
            r.tipo_registro === 'desvelo_total' ||
            (r.id && r.horas === undefined && r.tipo_registro === undefined)
        );
        const pendingBedtimeRow = !hasCompletedOrAllNighter
            ? sleepLogsToday.find(r => r.hora_dormir && !r.hora_despertar)
            : null;

        if (minutesOfDay >= sleepStartMin && minutesOfDay < 14 * 60) {
            if (pendingBedtimeRow) {
                candidates.push({
                    key: `sleep-wakeup:${dateStr}`,
                    type: 'sleep',
                    refId: pendingBedtimeRow.id || null,
                    title: 'Finish Morning Sleep Log',
                    message: `You logged bedtime at ${pendingBedtimeRow.hora_dormir} (Desvelo). Tap to record when you woke up.`,
                    targetView: 'sueno',
                    targetDate: dateStr,
                    canSnooze: true,
                    canComplete: false
                });
            } else if (sleepLogsToday.length === 0) {
                candidates.push({
                    key: `sleep:${dateStr}`,
                    type: 'sleep',
                    refId: null,
                    title: 'Morning Sleep Log',
                    message: 'Remember to log last night’s bedtime, wake-up time, and rest quality. You can snooze if needed.',
                    targetView: 'sueno',
                    targetDate: dateStr,
                    canSnooze: true,
                    canComplete: false
                });
            }
        }
    }

    // 3. Weekly Agenda Events & Tasks reminders (University / Personal) + Pending Tasks
    if (settings.agendaRemindersEnabled) {
        const notifiedTaskIds = new Set();

        agendaItemsToday.forEach(item => {
            const estado = item.estado || (Number(item.completada) === 1 ? 'done' : 'todo');
            if (estado === 'done' || Number(item.completada) === 1) return;

            const tipo = item.tipo === 'tarea' ? 'tarea' : 'evento';
            if (tipo === 'evento' && !settings.agendaNotifyEvents) return;
            if (tipo === 'tarea' && !settings.agendaNotifyTasks) return;

            const itemLead = item.recordatorio_min !== null && item.recordatorio_min !== undefined
                ? Number(item.recordatorio_min)
                : Number(settings.agendaLeadMinutes || 10);
            if (itemLead < 0) return;

            const itemMin = hhmmToMinutes(item.hora);
            const triggerMin = Math.max(0, itemMin - itemLead);
            const windowEndMin = tipo === 'tarea' ? 1439 : Math.min(1439, itemMin + 120);

            if (minutesOfDay >= triggerMin && minutesOfDay <= windowEndMin) {
                const catLabel = item.categoria === 'universidad' ? 'University' : 'Personal';
                const isOverdueToday = tipo === 'tarea' && minutesOfDay > itemMin + 30;
                const typeLabel = tipo === 'tarea' ? (isOverdueToday ? 'Pending Task' : 'Task') : 'Event';
                const statusBadge = estado === 'in_progress' ? ' [In Progress]' : '';
                if (tipo === 'tarea') notifiedTaskIds.add(Number(item.id));
                candidates.push({
                    key: `agenda:${item.id}:${dateStr}`,
                    type: 'agenda',
                    refId: item.id,
                    title: `[${catLabel} ${typeLabel}] ${item.hora}${statusBadge}`,
                    message: `${item.actividad}${itemLead > 0 && minutesOfDay < itemMin ? ` (starts at ${item.hora})` : (isOverdueToday ? ' — Pending completion' : '')}`,
                    targetView: 'agenda',
                    targetDate: item.fecha || dateStr,
                    targetTime: item.hora || '',
                    targetBlock: item.bloque || '',
                    canSnooze: true,
                    canComplete: true
                });
            }
        });

        if (settings.agendaNotifyTasks && settings.agendaNotifyPendingTasks !== false && Array.isArray(pendingTasksWeek)) {
            pendingTasksWeek.forEach(task => {
                const estado = task.estado || (Number(task.completada) === 1 ? 'done' : 'todo');
                if (estado === 'done' || Number(task.completada) === 1) return;
                if ((task.tipo || 'evento') !== 'tarea') return;
                if (notifiedTaskIds.has(Number(task.id))) return;
                if (task.recordatorio_min !== null && task.recordatorio_min !== undefined && Number(task.recordatorio_min) < 0) return;

                const isPastDay = task.fecha && task.fecha < dateStr;
                const taskMin = hhmmToMinutes(task.hora || '09:00');
                if (!isPastDay && minutesOfDay < taskMin) return;

                const catLabel = task.categoria === 'universidad' ? 'University' : 'Personal';
                candidates.push({
                    key: `task-pending:${task.id}:${dateStr}`,
                    type: 'agenda',
                    refId: task.id,
                    title: `[Pending ${catLabel} Task] ${task.fecha === dateStr ? task.hora : task.fecha}`,
                    message: `${task.actividad} (${estado === 'in_progress' ? 'In Progress' : 'To Do'} — tap Mark Done when finished)`,
                    targetView: 'agenda',
                    targetDate: task.fecha || dateStr,
                    targetTime: task.hora || '',
                    targetBlock: task.bloque || '',
                    canSnooze: true,
                    canComplete: true
                });
            });
        }
    }

    // 4. Smart Academic Semester Classes (Tec de Saltillo), Residencias & Work Schedule Commute Alerts
    const planner = sanitizeAcademicPlanner(settings.academicPlanner);
    const activeVacation = isDateInVacation(dateStr, planner.vacations);

    if (planner.classRemindersEnabled && !activeVacation) {
        const activeSem = planner.semesters.find(s => s.id === planner.activeSemesterId) ||
                          planner.semesters.find(s => s.active) ||
                          planner.semesters[0];

        if (activeSem && dateStr >= activeSem.startDate && dateStr <= activeSem.endDate) {
            const todaysCourses = (activeSem.courses || [])
                .filter(c => Array.isArray(c.days) && c.days.includes(weekday))
                .sort((a, b) => hhmmToMinutes(a.startTime) - hhmmToMinutes(b.startTime));

            todaysCourses.forEach((course, idx) => {
                const startMin = hhmmToMinutes(course.startTime);
                const prevCourse = idx > 0 ? todaysCourses[idx - 1] : null;
                const prevEndMin = prevCourse ? hhmmToMinutes(prevCourse.endTime) : -999;
                const isFirstOrAfterLongBreak = idx === 0 || (startMin - prevEndMin >= 120);

                const roomMeta = resolveItsClassroom(course.room);
                const prevRoomMeta = prevCourse ? resolveItsClassroom(prevCourse.room) : null;

                let originInfo;
                if (!isFirstOrAfterLongBreak && prevRoomMeta && !parseCoordinatesFromInput(planner.locations?.current || {})) {
                    originInfo = {
                        coords: { lat: prevRoomMeta.lat, lng: prevRoomMeta.lng },
                        sourceLabel: `Aula ${prevRoomMeta.room} (${prevRoomMeta.campusName})`
                    };
                } else {
                    originInfo = resolveUserOriginCoords(planner, isFirstOrAfterLongBreak);
                }

                const commute = estimateCommuteDetails({
                    originCoords: originInfo.coords,
                    destCoords: { lat: roomMeta.lat, lng: roomMeta.lng },
                    targetMinutesOfDay: startMin,
                    weekday,
                    isFirstOfDay: isFirstOrAfterLongBreak,
                    nearRadiusKm: planner.nearRadiusKm || 0.85,
                    minFarLeadMinutes: planner.farLeadMinutesMin || 30,
                    nearLeadMinutes: planner.nearLeadMinutes || 10,
                    parkingBufferMinutes: planner.parkingBufferMinutes ?? 8
                });

                const leadMin = commute.recommendedLeadMinutes;
                const triggerMin = Math.max(0, startMin - leadMin);
                const endMin = Math.min(1439, startMin + 45);

                if (minutesOfDay >= triggerMin && minutesOfDay <= endMin) {
                    const routeSummary = commute.isNear
                        ? `En el Tec / cerca (~${commute.walkMinutes} min caminando desde ${originInfo.sourceLabel})`
                        : `Desde ${originInfo.sourceLabel}: ~${commute.driveMinutes} min en carro (${commute.trafficLabel}, ${commute.roadDistanceKm || '--'} km) + estacionamiento`;

                    candidates.push({
                        key: `class:${activeSem.id}:${course.id}:${dateStr}`,
                        type: 'class',
                        refId: null,
                        title: `[Clase ITS ${course.startTime}] ${course.name} · Aula ${roomMeta.room}`,
                        message: `${roomMeta.campusName} (${roomMeta.plano} · ${roomMeta.building}). ${routeSummary}. Aviso ${leadMin} min antes.`,
                        targetView: 'horario',
                        targetTab: 'semesters',
                        targetDate: dateStr,
                        mapsUrl: commute.mapsUrl,
                        canSnooze: true,
                        canComplete: false
                    });
                }
            });
        }
    }

    if (planner.residencias && planner.residencias.enabled && Array.isArray(planner.residencias.days) && planner.residencias.days.includes(weekday)) {
        const resStartMin = hhmmToMinutes(planner.residencias.startTime);
        const destCoords = parseCoordinatesFromInput(planner.residencias.location || {}) || {
            lat: ITS_CAMPUS_DIRECTORY.principal.lat,
            lng: ITS_CAMPUS_DIRECTORY.principal.lng
        };
        const originInfo = resolveUserOriginCoords(planner, true);
        const commute = estimateCommuteDetails({
            originCoords: originInfo.coords,
            destCoords,
            targetMinutesOfDay: resStartMin,
            weekday,
            isFirstOfDay: true,
            nearRadiusKm: planner.nearRadiusKm || 0.85,
            minFarLeadMinutes: planner.farLeadMinutesMin || 30,
            nearLeadMinutes: 15,
            parkingBufferMinutes: planner.parkingBufferMinutes ?? 8
        });
        const leadMin = planner.residencias.modality === 'remoto' ? 10 : commute.recommendedLeadMinutes;
        const triggerMin = Math.max(0, resStartMin - leadMin);
        if (minutesOfDay >= triggerMin && minutesOfDay <= Math.min(1439, resStartMin + 60)) {
            const placeLabel = planner.residencias.companyName || planner.residencias.location?.label || 'Residencias Profesionales';
            const transitText = planner.residencias.modality === 'remoto'
                ? 'Modalidad remota — prepárate para iniciar sesión.'
                : `Traslado en carro: ~${commute.driveMinutes} min (${commute.trafficLabel}) hacia ${placeLabel}.`;
            candidates.push({
                key: `residencias:${dateStr}:${planner.residencias.startTime}`,
                type: 'residencias',
                refId: null,
                title: `[Residencias ${planner.residencias.startTime}] ${placeLabel}`,
                message: `${planner.residencias.projectName ? `${planner.residencias.projectName}. ` : ''}${transitText}`,
                targetView: 'horario',
                targetTab: 'residencias',
                targetDate: dateStr,
                mapsUrl: planner.residencias.modality === 'remoto' ? '' : commute.mapsUrl,
                canSnooze: true,
                canComplete: false
            });
        }
    }

    if (planner.work && planner.work.enabled && Array.isArray(planner.work.days) && planner.work.days.includes(weekday)) {
        const workStartMin = hhmmToMinutes(planner.work.startTime);
        const destCoords = parseCoordinatesFromInput(planner.work.location || {});
        const originInfo = resolveUserOriginCoords(planner, true);
        const commute = estimateCommuteDetails({
            originCoords: originInfo.coords,
            destCoords,
            targetMinutesOfDay: workStartMin,
            weekday,
            isFirstOfDay: true,
            nearRadiusKm: planner.nearRadiusKm || 0.85,
            minFarLeadMinutes: planner.farLeadMinutesMin || 30,
            nearLeadMinutes: 15,
            parkingBufferMinutes: planner.parkingBufferMinutes ?? 8
        });
        const leadMin = planner.work.modality === 'remoto' ? 10 : commute.recommendedLeadMinutes;
        const triggerMin = Math.max(0, workStartMin - leadMin);
        if (minutesOfDay >= triggerMin && minutesOfDay <= Math.min(1439, workStartMin + 60)) {
            const shiftTypeLabel = planner.work.scheduleType === 'tiempo_completo' ? 'Tiempo Completo' : 'Medio Tiempo';
            const companyLabel = planner.work.companyName || planner.work.location?.label || 'Trabajo';
            const transitText = planner.work.modality === 'remoto'
                ? 'Turno remoto por iniciar.'
                : `Ruta en carro: ~${commute.driveMinutes} min (${commute.trafficLabel}) hacia ${companyLabel}.`;
            candidates.push({
                key: `work:${dateStr}:${planner.work.startTime}`,
                type: 'work',
                refId: null,
                title: `[Trabajo ${shiftTypeLabel} ${planner.work.startTime}] ${companyLabel}`,
                message: `${planner.work.roleTitle ? `${planner.work.roleTitle} — ` : ''}${transitText}`,
                targetView: 'horario',
                targetTab: 'work',
                targetDate: dateStr,
                mapsUrl: planner.work.modality === 'remoto' ? '' : commute.mapsUrl,
                canSnooze: true,
                canComplete: false
            });
        }
    }

    // 5. End-of-day Word Notes check reminder
    if (settings.wordEodReminderEnabled) {
        const wordMin = hhmmToMinutes(settings.wordEodReminderTime);
        if (minutesOfDay >= wordMin) {
            const pendingTotal = Number(queueCounts.journal || 0) + Number(queueCounts.english || 0);
            const wordMsg = pendingTotal > 0
                ? `You have ${queueCounts.journal || 0} Journal and ${queueCounts.english || 0} English note(s) waiting for PC Word sync.`
                : 'End-of-day check: verify your Journal and English Word documents or add any final notes before bed.';
            candidates.push({
                key: `word:${dateStr}`,
                type: 'word',
                refId: null,
                title: 'End-of-Day Word Notes Check',
                message: wordMsg,
                targetView: pendingTotal > 0 ? 'journal' : 'english',
                canSnooze: true,
                canComplete: false
            });
        }
    }

    // 6. Configurable English Study reminder (OFF by default!)
    if (settings.englishReminderEnabled) {
        const allowedDays = Array.isArray(settings.englishReminderDays) ? settings.englishReminderDays : [];
        const engMin = hhmmToMinutes(settings.englishReminderTime);
        if (allowedDays.includes(weekday) && minutesOfDay >= engMin && minutesOfDay <= Math.min(1439, engMin + 180)) {
            candidates.push({
                key: `english:${dateStr}:${settings.englishReminderTime}`,
                type: 'english',
                refId: null,
                title: 'English Study Session',
                message: settings.englishReminderTopic || 'Practice vocabulary, grammar notes, and phrasal verbs.',
                targetView: 'english',
                canSnooze: true,
                canComplete: false
            });
        }
    }

    return candidates;
}

function buildPublicBaseUrlForUser(settings, req = null) {
    if (settings && settings.publicBaseUrl) return settings.publicBaseUrl;
    if (req) return getResetBaseUrl(req);
    const envBase = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    if (envBase && /^https?:\/\/[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(envBase)) {
        return envBase;
    }
    return '';
}

function signReminderActionToken(payload) {
    return signMfaChallenge({
        ...payload,
        purpose: 'reminder_action',
        exp: Date.now() + 12 * 60 * 60 * 1000
    });
}

function verifyReminderActionToken(token) {
    const parsed = verifyMfaChallenge(token);
    if (!parsed || parsed.purpose !== 'reminder_action' || !parsed.reminderKey || !parsed.action) {
        return null;
    }
    return parsed;
}

async function sendPhonePushViaNtfy({ settings, reminder, baseUrl = '', userId }) {
    if (!settings || !settings.phoneNotificationsEnabled || !settings.ntfyTopic) {
        return { skipped: true };
    }
    const urlCheck = validatePushServerUrl(settings.ntfyServerUrl);
    if (urlCheck.error) {
        throw new Error(urlCheck.error);
    }

    const endpoint = `${urlCheck.url}/`;
    const tagMap = {
        mood: 'brain',
        sleep: 'crescent_moon',
        agenda: 'calendar',
        class: 'mortar_board',
        residencias: 'office',
        work: 'briefcase',
        word: 'memo',
        english: 'books',
        test: 'white_check_mark'
    };

    const jsonPayload = {
        topic: settings.ntfyTopic,
        title: String(reminder.title || 'Personal Daily Hub').slice(0, 140),
        message: String(reminder.message || '').slice(0, 500),
        priority: Number(settings.ntfyPriority || 4),
        tags: [tagMap[reminder.type] || 'bell']
    };

    if (baseUrl) {
        const params = new URLSearchParams();
        if (reminder.targetDate) params.set('rDate', String(reminder.targetDate));
        if (reminder.targetMoment) params.set('rMoment', String(reminder.targetMoment));
        if (reminder.targetTime) params.set('rTime', String(reminder.targetTime));
        if (reminder.targetBlock) params.set('rBlock', String(reminder.targetBlock));
        if (reminder.targetTab) params.set('rTab', String(reminder.targetTab));
        if (reminder.refId) params.set('rRef', String(reminder.refId));
        if (reminder.extraQuery && typeof reminder.extraQuery === 'object') {
            for (const [k, v] of Object.entries(reminder.extraQuery)) {
                if (v !== undefined && v !== null && String(v) !== '') {
                    params.set(String(k), String(v));
                }
            }
        }
        if (Array.from(params.keys()).length > 0 && reminder.targetView) {
            params.set('rView', String(reminder.targetView));
        }
        const qs = params.toString();
        const targetUrl = `${baseUrl}/${qs ? `?${qs}` : ''}#${reminder.targetView || 'inicio'}`;
        jsonPayload.click = targetUrl;
        const actions = [
            {
                action: 'view',
                label: 'Open App',
                url: targetUrl
            }
        ];

        if (reminder.mapsUrl && /^https:\/\/www\.google\.com\/maps\//.test(reminder.mapsUrl)) {
            actions.push({
                action: 'view',
                label: 'Google Maps Route',
                url: reminder.mapsUrl
            });
        }

        if (reminder.canSnooze && userId && reminder.key && reminder.type !== 'test') {
            const snooze15Token = signReminderActionToken({
                userId,
                reminderKey: reminder.key,
                type: reminder.type,
                refId: reminder.refId || null,
                action: 'snooze',
                mins: 15
            });
            actions.push({
                action: 'http',
                label: 'Snooze 15m',
                url: `${baseUrl}/api/reminders/action?token=${encodeURIComponent(snooze15Token)}`,
                method: 'POST',
                clear: true
            });

            if (actions.length < 3) {
                if (reminder.canComplete && reminder.refId) {
                    const doneToken = signReminderActionToken({
                        userId,
                        reminderKey: reminder.key,
                        type: reminder.type,
                        refId: reminder.refId,
                        action: 'complete'
                    });
                    actions.push({
                        action: 'http',
                        label: 'Mark Done',
                        url: `${baseUrl}/api/reminders/action?token=${encodeURIComponent(doneToken)}`,
                        method: 'POST',
                        clear: true
                    });
                } else {
                    const snooze30Token = signReminderActionToken({
                        userId,
                        reminderKey: reminder.key,
                        type: reminder.type,
                        refId: reminder.refId || null,
                        action: 'snooze',
                        mins: 30
                    });
                    actions.push({
                        action: 'http',
                        label: 'Snooze 30m',
                        url: `${baseUrl}/api/reminders/action?token=${encodeURIComponent(snooze30Token)}`,
                        method: 'POST',
                        clear: true
                    });
                }
            }
        }

        jsonPayload.click = targetUrl;
        jsonPayload.actions = actions.slice(0, 3);
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(jsonPayload),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
    });

    if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`Push relay returned HTTP ${response.status}${errBody ? `: ${errBody.slice(0, 120)}` : ''}`);
    }
    return { sent: true };
}

function getDateStrDaysAgo(dateStr, daysAgo = 7) {
    const [y, m, d] = String(dateStr || '2026-01-01').split('-').map(Number);
    const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, (d || 1) - daysAgo));
    return dt.toISOString().slice(0, 10);
}

async function evaluateAndDispatchUserReminders(user, { dispatchPush = true, req = null } = {}) {
    const settings = await loadUserSettings(user.id);
    const localNow = getLocalNowParts(settings.timezone);
    const baseUrl = buildPublicBaseUrlForUser(settings, req);
    const sevenDaysAgoStr = getDateStrDaysAgo(localNow.dateStr, 7);

    const [moodRows, sleepRows, agendaRows, weekAgendaRows, stateRows] = await Promise.all([
        dbQueryAsync('SELECT momento_dia FROM RegistrosMood WHERE fecha = ?', [localNow.dateStr]),
        dbQueryAsync('SELECT id, horas, hora_dormir, hora_despertar, tipo_registro FROM RegistrosSleep WHERE fecha = ?', [localNow.dateStr]),
        dbQueryAsync(
            `SELECT id, TIME_FORMAT(hora, '%H:%i') AS hora, actividad,
                    COALESCE(tipo, 'evento') AS tipo,
                    COALESCE(categoria, 'personal') AS categoria,
                    COALESCE(estado, CASE WHEN completada = 1 THEN 'done' ELSE 'todo' END) AS estado,
                    completada, recordatorio_min
             FROM RegistrosAgenda
             WHERE fecha = ?
             ORDER BY hora ASC`,
            [localNow.dateStr]
        ),
        dbQueryAsync(
            `SELECT id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, bloque,
                    TIME_FORMAT(hora, '%H:%i') AS hora, actividad,
                    COALESCE(tipo, 'evento') AS tipo,
                    COALESCE(categoria, 'personal') AS categoria,
                    COALESCE(estado, CASE WHEN completada = 1 THEN 'done' ELSE 'todo' END) AS estado,
                    completada, recordatorio_min
             FROM RegistrosAgenda
             WHERE fecha BETWEEN ? AND ?
             ORDER BY fecha ASC, hora ASC`,
            [sevenDaysAgoStr, localNow.dateStr]
        ),
        dbQueryAsync(
            'SELECT clave_unica, tipo, titulo, mensaje, estado, snooze_hasta, enviado_push_en FROM RecordatoriosEstado WHERE usuario_id = ?',
            [user.id]
        )
    ]);

    const candidates = computeCandidateReminders({
        settings,
        localNow,
        moodLogsToday: Array.isArray(moodRows) ? moodRows : [],
        sleepLogsToday: Array.isArray(sleepRows) ? sleepRows : [],
        agendaItemsToday: Array.isArray(agendaRows) ? agendaRows : [],
        pendingTasksWeek: Array.isArray(weekAgendaRows) ? weekAgendaRows : [],
        queueCounts: { journal: journalQueue.size(), english: englishQueue.size() }
    });

    const stateMap = new Map((Array.isArray(stateRows) ? stateRows : []).map(r => [r.clave_unica, r]));
    const nowMs = Date.now();
    const active = [];
    const snoozed = [];

    for (const candidate of candidates) {
        const existing = stateMap.get(candidate.key);
        if (existing && existing.estado === 'dismissed') {
            continue;
        }
        if (existing && existing.estado === 'snoozed' && existing.snooze_hasta) {
            const snoozeUntilMs = new Date(existing.snooze_hasta).getTime();
            if (Number.isFinite(snoozeUntilMs) && snoozeUntilMs > nowMs) {
                snoozed.push({
                    ...candidate,
                    snoozeUntil: new Date(snoozeUntilMs).toISOString()
                });
                continue;
            }
        }

        const shouldMarkPush = !existing || !existing.enviado_push_en || existing.estado === 'snoozed';
        let pushSentAtSql = existing && existing.enviado_push_en && existing.estado !== 'snoozed'
            ? existing.enviado_push_en
            : null;

        if (shouldMarkPush && dispatchPush && settings.phoneNotificationsEnabled && settings.ntfyTopic) {
            try {
                await sendPhonePushViaNtfy({ settings, reminder: candidate, baseUrl, userId: user.id });
                pushSentAtSql = formatMySqlDateTime(new Date());
            } catch (pushErr) {
                console.error('[PHONE_PUSH_ERROR]', pushErr.message);
            }
        }

        if (!existing || existing.estado === 'snoozed' || pushSentAtSql !== existing.enviado_push_en) {
            await dbQueryAsync(
                `INSERT INTO RecordatoriosEstado (usuario_id, clave_unica, tipo, ref_id, titulo, mensaje, estado, snooze_hasta, enviado_push_en)
                 VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, ?)
                 ON DUPLICATE KEY UPDATE
                    titulo = VALUES(titulo),
                    mensaje = VALUES(mensaje),
                    estado = 'active',
                    snooze_hasta = NULL,
                    enviado_push_en = COALESCE(VALUES(enviado_push_en), enviado_push_en)`,
                [
                    user.id,
                    candidate.key,
                    candidate.type,
                    candidate.refId || null,
                    candidate.title.slice(0, 140),
                    candidate.message.slice(0, 320),
                    pushSentAtSql
                ]
            );
        }

        active.push(candidate);
    }

    return {
        localNow,
        settings,
        active,
        snoozed
    };
}

let schedulerRunning = false;
async function runReminderSchedulerTick() {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
        const admins = await dbQueryAsync(
            "SELECT id, nombre, email FROM Usuarios WHERE rol = 'admin' AND COALESCE(estado, 'activo') = 'activo'"
        );
        if (!Array.isArray(admins) || admins.length === 0) return;
        for (const adminUser of admins) {
            await evaluateAndDispatchUserReminders(adminUser, { dispatchPush: true });
        }
    } catch (err) {
        if (err && err.code !== 'ER_NO_SUCH_TABLE') {
            console.error('[REMINDER_SCHEDULER_ERROR]', err.message);
        }
    } finally {
        schedulerRunning = false;
    }
}

if (process.env.DISABLE_REMINDER_SCHEDULER !== 'true') {
    setTimeout(runReminderSchedulerTick, 5000).unref();
    setInterval(runReminderSchedulerTick, 30 * 1000).unref();
}

app.get('/api/settings', apiReadLimiter.middleware, requireAdmin, async (req, res) => {
    try {
        const settings = await loadUserSettings(req.user.id);
        res.json({ settings: sanitizeSettingsForClient(settings) });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading settings.');
    }
});

app.put('/api/settings', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 0 }), async (req, res) => {
    try {
        const current = await loadUserSettings(req.user.id);
        const result = validateUserSettingsPayload(req.body, current);
        if (result.error) {
            return res.status(400).send(result.error);
        }
        await saveUserSettings(req.user.id, result.settings);
        res.json({
            message: 'Settings saved successfully.',
            settings: sanitizeSettingsForClient(result.settings)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error saving settings.');
    }
});

app.post('/api/settings/test-notification', apiWriteLimiter.middleware, requireAdmin, preventDuplicateSubmit({ dedupeWindowMs: 3000 }), async (req, res) => {
    try {
        const saved = await loadUserSettings(req.user.id);
        const body = req.body || {};
        const merged = {
            ...saved,
            phoneNotificationsEnabled: true,
            ntfyServerUrl: body.ntfyServerUrl !== undefined ? body.ntfyServerUrl : saved.ntfyServerUrl,
            ntfyTopic: body.ntfyTopic !== undefined ? body.ntfyTopic : saved.ntfyTopic,
            ntfyPriority: body.ntfyPriority !== undefined ? body.ntfyPriority : saved.ntfyPriority,
            publicBaseUrl: body.publicBaseUrl !== undefined ? body.publicBaseUrl : saved.publicBaseUrl
        };
        const validation = validateUserSettingsPayload(merged, saved);
        if (validation.error) {
            return res.status(400).send(validation.error);
        }

        const baseUrl = buildPublicBaseUrlForUser(validation.settings, req);
        await sendPhonePushViaNtfy({
            settings: validation.settings,
            reminder: {
                key: `test:${Date.now()}`,
                type: 'test',
                title: 'Personal Daily Hub - Phone Connected',
                message: 'Test alert delivered! Reminders for Mood, Sleep, Agenda, Word Notes, and English Study will appear here.',
                targetView: 'settings',
                canSnooze: false
            },
            baseUrl,
            userId: req.user.id
        });
        res.json({ message: 'Test notification sent to your phone notification channel.' });
    } catch (err) {
        console.error('[TEST_PUSH_ERROR]', err.message);
        res.status(502).send(err.message || 'Could not reach phone notification relay.');
    }
});

function sanitizePlannerForClient(planner = {}) {
    if (!planner || typeof planner !== 'object') return planner;
    const { phoneGpsNonce, ...rest } = planner;
    return {
        ...rest,
        hasPhoneWebhook: Boolean(phoneGpsNonce)
    };
}

function buildLiveCommutePreview(planner, localNow) {
    const originInfo = resolveUserOriginCoords(planner, true);
    const originCoords = originInfo.coords;
    const currCoords = parseCoordinatesFromInput(planner?.locations?.current || {});
    const homeCoords = parseCoordinatesFromInput(planner?.locations?.home || {});
    const originKind = currCoords ? 'current' : (homeCoords ? 'home' : 'none');
    const campuses = {};
    const commutes = [];
    for (const [key, campus] of Object.entries(ITS_CAMPUS_DIRECTORY)) {
        const comm = estimateCommuteDetails({
            originCoords,
            destCoords: { lat: campus.lat, lng: campus.lng },
            targetMinutesOfDay: localNow.minutesOfDay,
            weekday: localNow.weekday,
            isFirstOfDay: true,
            nearRadiusKm: planner.nearRadiusKm || 0.85,
            minFarLeadMinutes: planner.farLeadMinutesMin || 30,
            nearLeadMinutes: planner.nearLeadMinutes || 10,
            parkingBufferMinutes: planner.parkingBufferMinutes ?? 8
        });
        campuses[key] = {
            ...campus,
            commute: comm
        };
        commutes.push({
            campusKey: key,
            target: campus.name,
            isNearCampus: comm.isNear,
            distanceKm: comm.distanceKm,
            driveMinutesWithTraffic: comm.driveMinutes,
            trafficLabel: comm.trafficLabel,
            recommendedLeadMinutes: comm.recommendedLeadMinutes,
            mapsDirectionsUrl: comm.mapsUrl
        });
    }

    const resCoords = parseCoordinatesFromInput(planner.residencias?.location || {});
    const workCoords = parseCoordinatesFromInput(planner.work?.location || {});

    return {
        originSource: originInfo.sourceLabel,
        originKind,
        originUpdatedAt: currCoords ? (planner?.locations?.current?.updatedAt || null) : null,
        originTechnicalSource: currCoords ? (planner?.locations?.current?.source || 'gps') : (homeCoords ? 'home' : 'none'),
        homeConfigured: Boolean(homeCoords),
        originCoords,
        campuses,
        commutes,
        residenciasCommute: resCoords
            ? estimateCommuteDetails({
                originCoords,
                destCoords: resCoords,
                targetMinutesOfDay: hhmmToMinutes(planner.residencias?.startTime || '08:00'),
                weekday: localNow.weekday,
                isFirstOfDay: true,
                nearRadiusKm: planner.nearRadiusKm || 0.85,
                minFarLeadMinutes: planner.farLeadMinutesMin || 30,
                nearLeadMinutes: 15,
                parkingBufferMinutes: planner.parkingBufferMinutes ?? 8
            })
            : null,
        workCommute: workCoords
            ? estimateCommuteDetails({
                originCoords,
                destCoords: workCoords,
                targetMinutesOfDay: hhmmToMinutes(planner.work?.startTime || '08:00'),
                weekday: localNow.weekday,
                isFirstOfDay: true,
                nearRadiusKm: planner.nearRadiusKm || 0.85,
                minFarLeadMinutes: planner.farLeadMinutesMin || 30,
                nearLeadMinutes: 15,
                parkingBufferMinutes: planner.parkingBufferMinutes ?? 8
            })
            : null
    };
}

app.get('/api/planner', apiReadLimiter.middleware, requireAdmin, async (req, res) => {
    try {
        const settings = await loadUserSettings(req.user.id);
        const planner = sanitizeAcademicPlanner(settings.academicPlanner);
        const localNow = getLocalNowParts(settings.timezone);
        res.json({
            planner: sanitizePlannerForClient(planner),
            campusDirectory: ITS_CAMPUS_DIRECTORY,
            mindboxPreset: getItsMindboxPresetCourses(),
            activeVacation: isDateInVacation(localNow.dateStr, planner.vacations),
            commutePreview: buildLiveCommutePreview(planner, localNow)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading academic & work planner.');
    }
});

app.put('/api/planner', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 0 }), async (req, res) => {
    try {
        const current = await loadUserSettings(req.user.id);
        const incomingPlanner = req.body.planner !== undefined ? req.body.planner : req.body;
        const nextPlanner = sanitizeAcademicPlanner(incomingPlanner, current.academicPlanner);

        for (const locKey of ['home', 'university']) {
            const locObj = nextPlanner.locations?.[locKey];
            if (locObj && locObj.mapsUrl && !parseCoordinatesFromInput({ lat: locObj.lat, lng: locObj.lng })) {
                const expanded = await resolveGoogleMapsShortLinkIfNeeded(locObj.mapsUrl);
                if (expanded && expanded !== locObj.mapsUrl) {
                    locObj.mapsUrl = expanded.slice(0, 500);
                }
                const resolvedCoords = parseCoordinatesFromInput({ mapsUrl: locObj.mapsUrl });
                if (resolvedCoords) {
                    locObj.lat = resolvedCoords.lat;
                    locObj.lng = resolvedCoords.lng;
                }
            }
        }
        for (const extraLoc of [nextPlanner.residencias?.location, nextPlanner.work?.location]) {
            if (extraLoc && extraLoc.mapsUrl && !parseCoordinatesFromInput({ lat: extraLoc.lat, lng: extraLoc.lng })) {
                const expanded = await resolveGoogleMapsShortLinkIfNeeded(extraLoc.mapsUrl);
                if (expanded && expanded !== extraLoc.mapsUrl) {
                    extraLoc.mapsUrl = expanded.slice(0, 500);
                }
                const resolvedCoords = parseCoordinatesFromInput({ mapsUrl: extraLoc.mapsUrl });
                if (resolvedCoords) {
                    extraLoc.lat = resolvedCoords.lat;
                    extraLoc.lng = resolvedCoords.lng;
                }
            }
        }

        const nextSettings = {
            ...current,
            academicPlanner: nextPlanner
        };
        await saveUserSettings(req.user.id, nextSettings);
        const localNow = getLocalNowParts(nextSettings.timezone);
        res.json({
            message: 'Academic, Residencias & Work schedule saved.',
            planner: sanitizePlannerForClient(nextPlanner),
            activeVacation: isDateInVacation(localNow.dateStr, nextPlanner.vacations),
            commutePreview: buildLiveCommutePreview(nextPlanner, localNow)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error saving academic & work planner.');
    }
});

async function resolveGoogleMapsShortLinkIfNeeded(rawUrl = '') {
    const clean = String(rawUrl || '').trim();
    if (!clean || !/^https?:\/\//i.test(clean)) return clean;
    try {
        let currentUrl = new URL(clean);
        for (let hop = 0; hop < 4; hop++) {
            const host = currentUrl.hostname.toLowerCase();
            if (!['maps.app.goo.gl', 'goo.gl'].includes(host) || currentUrl.protocol !== 'https:') {
                return currentUrl.toString();
            }
            const headResp = await fetch(currentUrl.toString(), {
                method: 'HEAD',
                redirect: 'manual',
                signal: AbortSignal.timeout(4500)
            });
            let loc = headResp.headers.get('location');
            if (!loc) {
                const getResp = await fetch(currentUrl.toString(), {
                    method: 'GET',
                    redirect: 'manual',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; PersonalDailyHub/1.0)',
                        Accept: 'text/html,application/xhtml+xml'
                    },
                    signal: AbortSignal.timeout(4500)
                });
                loc = getResp.headers.get('location');
                if (!loc) {
                    const htmlSnippet = (await getResp.text()).slice(0, 65536);
                    const metaRefreshMatch = htmlSnippet.match(/content=["'][^"']*url=([^"'\s>]+)/i);
                    const canonicalMatch = htmlSnippet.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i);
                    const bodyUrlCandidate = (metaRefreshMatch && metaRefreshMatch[1]) || (canonicalMatch && canonicalMatch[1]) || '';
                    if (bodyUrlCandidate) {
                        const decodedCandidate = bodyUrlCandidate.replace(/&amp;/g, '&');
                        const nextFromBody = new URL(decodedCandidate, currentUrl);
                        if (nextFromBody.protocol === 'https:') {
                            currentUrl = nextFromBody;
                            if (parseCoordinatesFromInput({ mapsUrl: currentUrl.toString() })) {
                                return currentUrl.toString();
                            }
                            continue;
                        }
                    }
                    const directCoordsFromHtml = parseCoordinatesFromInput({ mapsUrl: htmlSnippet });
                    if (directCoordsFromHtml) {
                        return `https://www.google.com/maps/search/?api=1&query=${directCoordsFromHtml.lat},${directCoordsFromHtml.lng}`;
                    }
                    return currentUrl.toString();
                }
            }
            const nextUrl = new URL(loc, currentUrl);
            if (nextUrl.protocol !== 'https:') return clean;
            currentUrl = nextUrl;
            if (parseCoordinatesFromInput({ mapsUrl: currentUrl.toString() })) {
                return currentUrl.toString();
            }
        }
        return currentUrl.toString();
    } catch (_err) {
        return clean;
    }
}

async function geocodeAddressWithNominatim(rawAddress = '') {
    const clean = String(rawAddress || '').trim().slice(0, 220);
    if (!clean || clean.length < 4 || /^https?:\/\//i.test(clean)) return null;
    if (/^\s*-?\d+(?:\.\d+)?\s*[,\s]\s*-?\d+(?:\.\d+)?\s*$/.test(clean)) return null;

    const tryQuery = async (queryText) => {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=mx&q=${encodeURIComponent(queryText)}`;
        const resp = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'PersonalDailyHub/1.0 (self-hosted academic planner)',
                Accept: 'application/json'
            },
            signal: AbortSignal.timeout(4500)
        });
        if (!resp.ok) return null;
        const list = await resp.json();
        if (!Array.isArray(list)) return null;
        for (const item of list) {
            const lat = Number(item?.lat);
            const lng = Number(item?.lon);
            if (isValidNonZeroCoords(lat, lng)) {
                return {
                    lat: Number(lat.toFixed(6)),
                    lng: Number(lng.toFixed(6)),
                    displayName: String(item.display_name || clean).slice(0, 200),
                    source: 'nominatim'
                };
            }
        }
        return null;
    };

    try {
        const hasRegionHint = /\b(saltillo|coahuila|mexico|méxico|ramos|arteaga)\b/i.test(clean);
        const primaryQuery = hasRegionHint ? clean : `${clean}, Saltillo, Coahuila, México`;
        const hit = await tryQuery(primaryQuery);
        if (hit) return hit;
        if (!hasRegionHint && clean.includes(',')) {
            return await tryQuery(clean);
        }
        return null;
    } catch (_err) {
        return null;
    }
}

function ensureUserPhoneGpsNonce(planner) {
    const existing = typeof planner?.phoneGpsNonce === 'string' && /^[a-f0-9]{16,64}$/i.test(planner.phoneGpsNonce.trim())
        ? planner.phoneGpsNonce.trim()
        : '';
    if (existing) {
        return { nonce: existing, changed: false };
    }
    const fresh = crypto.randomBytes(16).toString('hex');
    planner.phoneGpsNonce = fresh;
    return { nonce: fresh, changed: true };
}

function signPhoneGpsToken({ userId, email = 'phone@dailyhub.local', nonce }) {
    return signMfaChallenge({
        userId: Number(userId),
        email: String(email || 'phone@dailyhub.local'),
        purpose: 'phone_gps_webhook',
        nonce: String(nonce || ''),
        exp: Date.now() + 365 * 24 * 60 * 60 * 1000
    });
}

function verifyPhoneGpsToken(token) {
    const parsed = verifyMfaChallenge(token);
    if (!parsed || parsed.purpose !== 'phone_gps_webhook' || !parsed.nonce || !Number.isInteger(Number(parsed.userId))) {
        return null;
    }
    return parsed;
}

app.post('/api/planner/location', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 0 }), async (req, res) => {
    try {
        const current = await loadUserSettings(req.user.id);
        const planner = sanitizeAcademicPlanner(current.academicPlanner);
        const target = String(req.body.target || 'current').trim();

        if (target === 'clear_current') {
            planner.locations.current = {
                label: 'Ubicación actual',
                lat: null,
                lng: null,
                updatedAt: null,
                source: 'none'
            };
            const nextSettings = { ...current, academicPlanner: planner };
            await saveUserSettings(req.user.id, nextSettings);
            const localNow = getLocalNowParts(nextSettings.timezone);
            const preview = buildLiveCommutePreview(planner, localNow);
            return res.json({
                message: 'Live GPS cleared. Commutes now use your Saved Home as origin.',
                planner: sanitizePlannerForClient(planner),
                commutePreview: preview,
                commutes: preview.commutes
            });
        }

        const rawUrlInput = String(req.body.mapsUrl || req.body.url || '').trim();
        const rawTextInput = String(req.body.query || req.body.input || rawUrlInput || '').trim();
        let expandedUrl = rawUrlInput;
        let coords = parseCoordinatesFromInput({
            ...req.body,
            mapsUrl: rawUrlInput || rawTextInput
        });
        if (!coords && rawUrlInput && /^https?:\/\//i.test(rawUrlInput)) {
            expandedUrl = await resolveGoogleMapsShortLinkIfNeeded(rawUrlInput);
            coords = parseCoordinatesFromInput({ ...req.body, mapsUrl: expandedUrl });
        }

        let geocodedMeta = null;
        if (!coords) {
            const addrCandidate = String(
                req.body.address ||
                (!/^https?:\/\//i.test(rawTextInput) ? rawTextInput : '') ||
                ''
            ).trim();
            if (addrCandidate) {
                geocodedMeta = await geocodeAddressWithNominatim(addrCandidate);
                if (geocodedMeta) {
                    coords = { lat: geocodedMeta.lat, lng: geocodedMeta.lng };
                }
            }
        }

        if (!coords) {
            return res.status(400).send('Valid non-zero latitude/longitude, a Google Maps link with coordinates, or a street address (e.g. Margarita Maza de Juárez 924, Saltillo) is required.');
        }

        const resolvedMapsUrl = expandedUrl && /^https?:\/\//i.test(expandedUrl)
            ? expandedUrl.slice(0, 500)
            : `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;

        const customLabel = typeof req.body.label === 'string' && req.body.label.trim()
            ? req.body.label.trim().slice(0, 80)
            : '';

        if (target === 'home') {
            planner.locations.home = sanitizeLocationObject({
                ...planner.locations.home,
                ...req.body,
                address: req.body.address || (geocodedMeta ? rawTextInput : planner.locations.home.address),
                mapsUrl: req.body.mapsUrl ? resolvedMapsUrl : (planner.locations.home.mapsUrl || resolvedMapsUrl),
                ...coords
            }, planner.locations.home);
        } else if (target === 'university') {
            planner.locations.university = sanitizeLocationObject({
                ...planner.locations.university,
                ...req.body,
                mapsUrl: req.body.mapsUrl ? resolvedMapsUrl : (planner.locations.university.mapsUrl || resolvedMapsUrl),
                ...coords
            }, planner.locations.university);
        } else if (target === 'residencias') {
            planner.residencias.location = sanitizeLocationObject({
                ...planner.residencias.location,
                ...req.body,
                mapsUrl: req.body.mapsUrl ? resolvedMapsUrl : (planner.residencias.location.mapsUrl || resolvedMapsUrl),
                ...coords
            }, planner.residencias.location);
        } else if (target === 'work') {
            planner.work.location = sanitizeLocationObject({
                ...planner.work.location,
                ...req.body,
                mapsUrl: req.body.mapsUrl ? resolvedMapsUrl : (planner.work.location.mapsUrl || resolvedMapsUrl),
                ...coords
            }, planner.work.location);
        } else {
            planner.locations.current = {
                label: customLabel || (geocodedMeta ? rawTextInput.slice(0, 80) : 'Ubicación GPS actual'),
                lat: coords.lat,
                lng: coords.lng,
                updatedAt: new Date().toISOString(),
                source: String(req.body.source || (geocodedMeta ? 'address_geocode' : 'gps')).slice(0, 30)
            };
        }

        const nextSettings = { ...current, academicPlanner: planner };
        await saveUserSettings(req.user.id, nextSettings);
        const localNow = getLocalNowParts(nextSettings.timezone);
        const preview = buildLiveCommutePreview(planner, localNow);
        res.json({
            message: target === 'home'
                ? 'Home location saved & coordinates verified.'
                : 'Location updated and routes recalculated.',
            resolvedCoords: coords,
            geocodedDisplayName: geocodedMeta?.displayName || null,
            planner: sanitizePlannerForClient(planner),
            commutePreview: preview,
            commutes: preview.commutes
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating location.');
    }
});

app.get('/api/planner/phone-gps-token', apiReadLimiter.middleware, requireAdmin, async (req, res) => {
    try {
        const current = await loadUserSettings(req.user.id);
        const planner = sanitizeAcademicPlanner(current.academicPlanner);
        const { nonce, changed } = ensureUserPhoneGpsNonce(planner);
        if (changed) {
            await saveUserSettings(req.user.id, { ...current, academicPlanner: planner });
        }
        const token = signPhoneGpsToken({ userId: req.user.id, email: req.user.email, nonce });
        const baseUrl = buildPublicBaseUrlForUser(current, req);
        const webhookPostUrl = `${baseUrl}/api/planner/phone-location?token=${encodeURIComponent(token)}`;
        const webhookGetExampleUrl = `${webhookPostUrl}&lat={lat}&lng={lng}`;
        res.json({
            token,
            baseUrl,
            webhookPostUrl,
            webhookGetExampleUrl,
            macroDroidJson: '{"lat":[lv=lat],"lng":[lv=lng],"source":"macrodroid_gps","label":"Teléfono GPS (HTTP)"}',
            currentLocation: planner.locations.current
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error generating phone GPS webhook token.');
    }
});

app.post('/api/planner/phone-gps-token/rotate', apiWriteLimiter.middleware, requireAdmin, async (req, res) => {
    try {
        const current = await loadUserSettings(req.user.id);
        const planner = sanitizeAcademicPlanner(current.academicPlanner);
        const nonce = crypto.randomBytes(16).toString('hex');
        planner.phoneGpsNonce = nonce;
        await saveUserSettings(req.user.id, { ...current, academicPlanner: planner });

        const token = signPhoneGpsToken({ userId: req.user.id, email: req.user.email, nonce });
        const baseUrl = buildPublicBaseUrlForUser(current, req);
        const webhookPostUrl = `${baseUrl}/api/planner/phone-location?token=${encodeURIComponent(token)}`;
        const webhookGetExampleUrl = `${webhookPostUrl}&lat={lat}&lng={lng}`;
        res.json({
            message: 'Phone GPS webhook token rotated. Previous token revoked.',
            token,
            baseUrl,
            webhookPostUrl,
            webhookGetExampleUrl,
            macroDroidJson: '{"lat":[lv=lat],"lng":[lv=lng],"source":"macrodroid_gps","label":"Teléfono GPS (HTTP)"}'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error rotating phone GPS webhook token.');
    }
});

async function handlePhoneLocationWebhook(req, res) {
    try {
        const bearerMatch = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
        const token = String(
            req.query?.token ||
            req.body?.token ||
            req.headers['x-phone-gps-token'] ||
            (bearerMatch ? bearerMatch[1] : '') ||
            ''
        ).trim();

        if (!token) {
            return res.status(401).send('Signed phone GPS token is required.');
        }

        const parsed = verifyPhoneGpsToken(token);
        if (!parsed) {
            return res.status(401).send('Invalid or expired phone GPS token.');
        }

        const settings = await loadUserSettings(parsed.userId);
        const planner = sanitizeAcademicPlanner(settings.academicPlanner);
        if (!planner.phoneGpsNonce || !safeCompareStrings(String(parsed.nonce), String(planner.phoneGpsNonce))) {
            return res.status(401).send('Phone GPS webhook token has been revoked or rotated.');
        }

        const payload = {
            ...(req.query || {}),
            ...(req.body && typeof req.body === 'object' ? req.body : {})
        };
        let coords = parseCoordinatesFromInput(payload);
        if (!coords && typeof payload.mapsUrl === 'string' && payload.mapsUrl.trim()) {
            const expanded = await resolveGoogleMapsShortLinkIfNeeded(payload.mapsUrl);
            coords = parseCoordinatesFromInput({ ...payload, mapsUrl: expanded });
        }
        if (!coords) {
            return res.status(400).send('Valid non-zero lat and lng parameters are required (0, 0 is rejected).');
        }

        const customLabel = typeof payload.label === 'string' && payload.label.trim()
            ? payload.label.trim().slice(0, 80)
            : 'Teléfono GPS (HTTP Webhook)';
        const customSource = typeof payload.source === 'string' && payload.source.trim()
            ? payload.source.trim().slice(0, 30)
            : 'phone_webhook';

        planner.locations.current = {
            label: customLabel,
            lat: coords.lat,
            lng: coords.lng,
            updatedAt: new Date().toISOString(),
            source: customSource
        };

        const nextSettings = { ...settings, academicPlanner: planner };
        await saveUserSettings(parsed.userId, nextSettings);
        const localNow = getLocalNowParts(nextSettings.timezone);
        const preview = buildLiveCommutePreview(planner, localNow);

        res.json({
            ok: true,
            message: 'Phone GPS location updated over HTTP webhook.',
            location: planner.locations.current,
            commutePreview: preview,
            commutes: preview.commutes
        });
    } catch (err) {
        console.error('[PHONE_GPS_WEBHOOK_ERROR]', err);
        res.status(500).send('Error processing phone GPS webhook.');
    }
}

app.get('/api/planner/phone-location', apiWriteLimiter.middleware, handlePhoneLocationWebhook);
app.post('/api/planner/phone-location', apiWriteLimiter.middleware, handlePhoneLocationWebhook);

app.post('/api/planner/request-phone-gps', apiWriteLimiter.middleware, requireAdmin, preventDuplicateSubmit({ dedupeWindowMs: 2500 }), async (req, res) => {
    try {
        const settings = await loadUserSettings(req.user.id);
        if (!settings.phoneNotificationsEnabled || !settings.ntfyTopic) {
            return res.status(400).send('Configure Phone Notifications (ntfy topic) in Settings first so Daily Hub can ping your phone.');
        }
        const baseUrl = buildPublicBaseUrlForUser(settings, req);
        if (!baseUrl) {
            return res.status(400).send('Public Server URL could not be determined. Set it in Settings first.');
        }

        await sendPhonePushViaNtfy({
            settings,
            reminder: {
                key: `capture-gps:${Date.now()}`,
                type: 'class',
                title: '📍 Send Your Phone GPS to Daily Hub',
                message: 'Tap to capture your OPPO A79 location (or paste a Maps link) and update campus commute times.',
                targetView: 'horario',
                targetTab: 'locations',
                extraQuery: { captureGps: '1' },
                canSnooze: false
            },
            baseUrl,
            userId: req.user.id
        });

        res.json({
            message: 'GPS request sent to your phone via ntfy! Tap the notification on your phone to send its location.'
        });
    } catch (err) {
        console.error('[REQUEST_PHONE_GPS_ERROR]', err.message);
        res.status(502).send(err.message || 'Could not reach ntfy push relay.');
    }
});

app.post('/api/planner/resolve-room', apiReadLimiter.middleware, requireAdmin, (req, res) => {
    const room = String((req.body && req.body.room) || (req.query && req.query.room) || '').trim();
    const classroom = resolveItsClassroom(room);
    res.json({ classroom, resolved: classroom });
});

app.post('/api/planner/sync-agenda', apiWriteLimiter.middleware, requireAdmin, preventDuplicateSubmit({ dedupeWindowMs: 2000 }), async (req, res) => {
    try {
        const settings = await loadUserSettings(req.user.id);
        const planner = sanitizeAcademicPlanner(settings.academicPlanner);
        const localNow = getLocalNowParts(settings.timezone);

        const rawStart = String(req.body?.begin || req.body?.weekStartDate || '');
        const begin = /^\d{4}-\d{2}-\d{2}$/.test(rawStart)
            ? rawStart
            : localNow.dateStr;
        const end = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.end || ''))
            ? String(req.body.end)
            : getDateStrDaysAgo(begin, -6);

        const existingRows = await dbQueryAsync(
            `SELECT id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, bloque,
                    TIME_FORMAT(hora, '%H:%i') AS hora, actividad,
                    COALESCE(tipo, 'evento') AS tipo,
                    COALESCE(categoria, 'personal') AS categoria,
                    COALESCE(estado, CASE WHEN completada = 1 THEN 'done' ELSE 'todo' END) AS estado,
                    completada, recordatorio_min
             FROM RegistrosAgenda
             WHERE fecha BETWEEN ? AND ?
             ORDER BY fecha ASC, hora ASC`,
            [begin, end]
        );
        const existingSet = new Set(
            (Array.isArray(existingRows) ? existingRows : []).map(r => `${r.fecha}|${String(r.hora).slice(0, 5)}|${r.actividad}`)
        );

        const activeSem = planner.semesters.find(s => s.id === planner.activeSemesterId) || planner.semesters[0];
        const [by, bm, bd] = begin.split('-').map(Number);
        const [ey, em, ed] = end.split('-').map(Number);
        const startDt = new Date(Date.UTC(by, bm - 1, bd));
        const endDt = new Date(Date.UTC(ey, em - 1, ed));

        let insertedCount = 0;
        let skippedVacationDays = 0;

        for (let dt = new Date(startDt); dt <= endDt && insertedCount < 70; dt.setUTCDate(dt.getUTCDate() + 1)) {
            const dStr = dt.toISOString().slice(0, 10);
            const dayOfWeek = dt.getUTCDay();
            const vac = isDateInVacation(dStr, planner.vacations);
            if (vac) {
                skippedVacationDays += 1;
            }

            if (!vac && activeSem && dStr >= activeSem.startDate && dStr <= activeSem.endDate) {
                const dayCourses = (activeSem.courses || [])
                    .filter(c => Array.isArray(c.days) && c.days.includes(dayOfWeek))
                    .sort((a, b) => hhmmToMinutes(a.startTime) - hhmmToMinutes(b.startTime));

                for (let idx = 0; idx < dayCourses.length; idx++) {
                    const c = dayCourses[idx];
                    const roomMeta = resolveItsClassroom(c.room);
                    const isFirst = idx === 0 || (hhmmToMinutes(c.startTime) - hhmmToMinutes(dayCourses[idx - 1].endTime) >= 120);
                    const originInfo = resolveUserOriginCoords(planner, isFirst);
                    const commute = estimateCommuteDetails({
                        originCoords: originInfo.coords,
                        destCoords: { lat: roomMeta.lat, lng: roomMeta.lng },
                        targetMinutesOfDay: hhmmToMinutes(c.startTime),
                        weekday: dayOfWeek,
                        isFirstOfDay: isFirst,
                        nearRadiusKm: planner.nearRadiusKm || 0.85,
                        minFarLeadMinutes: planner.farLeadMinutesMin || 30,
                        nearLeadMinutes: planner.nearLeadMinutes || 10,
                        parkingBufferMinutes: planner.parkingBufferMinutes ?? 8
                    });

                    const titulo = `${c.code ? `${c.code} ` : ''}${c.name} (${roomMeta.room})`;
                    const descripcion = `${roomMeta.campusName} · ${c.startTime}-${c.endTime}${c.teacher ? ` · Prof. ${c.teacher}` : ''}`;
                    const actividad = composeAgendaActividad({ titulo, descripcion });
                    const sig = `${dStr}|${c.startTime}|${actividad}`;
                    if (existingSet.has(sig)) continue;

                    await dbQueryAsync(
                        `INSERT INTO RegistrosAgenda (fecha, bloque, hora, actividad, tipo, categoria, estado, completada, recordatorio_min)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [dStr, 'cole', c.startTime, actividad, 'evento', 'universidad', 'todo', 0, commute.recommendedLeadMinutes]
                    );
                    existingSet.add(sig);
                    insertedCount += 1;
                }
            }

            if (planner.residencias?.enabled && Array.isArray(planner.residencias.days) && planner.residencias.days.includes(dayOfWeek)) {
                const titulo = `Residencias: ${planner.residencias.projectName || planner.residencias.companyName || 'Proyecto Profesional'}`;
                const descripcion = `${planner.residencias.companyName || 'Empresa'} (${planner.residencias.startTime}-${planner.residencias.endTime})`;
                const actividad = composeAgendaActividad({ titulo, descripcion });
                const bloque = inferAgendaBlockFromTimeServer(planner.residencias.startTime, 'universidad');
                const sig = `${dStr}|${planner.residencias.startTime}|${actividad}`;
                if (!existingSet.has(sig)) {
                    await dbQueryAsync(
                        `INSERT INTO RegistrosAgenda (fecha, bloque, hora, actividad, tipo, categoria, estado, completada, recordatorio_min)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [dStr, bloque, planner.residencias.startTime, actividad, 'evento', 'universidad', 'todo', 0, Math.max(30, planner.farLeadMinutesMin || 30)]
                    );
                    existingSet.add(sig);
                    insertedCount += 1;
                }
            }

            if (planner.work?.enabled && Array.isArray(planner.work.days) && planner.work.days.includes(dayOfWeek)) {
                const shiftLabel = planner.work.scheduleType === 'tiempo_completo' ? 'Tiempo Completo' : 'Medio Tiempo';
                const titulo = `Trabajo (${shiftLabel}): ${planner.work.companyName || planner.work.roleTitle || 'Jornada'}`;
                const descripcion = `${planner.work.roleTitle ? `${planner.work.roleTitle} · ` : ''}${planner.work.startTime}-${planner.work.endTime}`;
                const actividad = composeAgendaActividad({ titulo, descripcion });
                const bloque = inferAgendaBlockFromTimeServer(planner.work.startTime, 'personal');
                const sig = `${dStr}|${planner.work.startTime}|${actividad}`;
                if (!existingSet.has(sig)) {
                    await dbQueryAsync(
                        `INSERT INTO RegistrosAgenda (fecha, bloque, hora, actividad, tipo, categoria, estado, completada, recordatorio_min)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [dStr, bloque, planner.work.startTime, actividad, 'evento', 'personal', 'todo', 0, Math.max(30, planner.farLeadMinutesMin || 30)]
                    );
                    existingSet.add(sig);
                    insertedCount += 1;
                }
            }
        }

        res.json({
            message: `Synced ${insertedCount} schedule item(s) to Weekly Agenda${skippedVacationDays ? ` (${skippedVacationDays} vacation day(s) skipped)` : ''}.`,
            inserted: insertedCount,
            insertedCount,
            skippedVacationDays
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error syncing schedule to agenda.');
    }
});

app.get('/api/reminders/active', apiReadLimiter.middleware, requireAdmin, async (req, res) => {
    try {
        const state = await evaluateAndDispatchUserReminders(req.user, {
            dispatchPush: false,
            req
        });
        res.json({
            localNow: state.localNow,
            active: state.active,
            snoozed: state.snoozed
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error checking active reminders.');
    }
});

async function applyReminderSnoozeOrDismiss({ userId, key, type = 'general', refId = null, action = 'snooze', minutes = 15, title = 'Reminder', message = '' }) {
    if (action === 'dismiss') {
        await dbQueryAsync(
            `INSERT INTO RecordatoriosEstado (usuario_id, clave_unica, tipo, ref_id, titulo, mensaje, estado, snooze_hasta)
             VALUES (?, ?, ?, ?, ?, ?, 'dismissed', NULL)
             ON DUPLICATE KEY UPDATE estado = 'dismissed', snooze_hasta = NULL`,
            [userId, key, type, refId, title.slice(0, 140), message.slice(0, 320)]
        );
        return { action: 'dismissed', snoozeUntil: null };
    }

    const safeMins = Number.isInteger(Number(minutes)) && Number(minutes) >= 1 && Number(minutes) <= 240
        ? Number(minutes)
        : 15;
    const snoozeUntil = new Date(Date.now() + safeMins * 60 * 1000);
    const snoozeSql = formatMySqlDateTime(snoozeUntil);

    await dbQueryAsync(
        `INSERT INTO RecordatoriosEstado (usuario_id, clave_unica, tipo, ref_id, titulo, mensaje, estado, snooze_hasta, enviado_push_en)
         VALUES (?, ?, ?, ?, ?, ?, 'snoozed', ?, NULL)
         ON DUPLICATE KEY UPDATE estado = 'snoozed', snooze_hasta = VALUES(snooze_hasta), enviado_push_en = NULL`,
        [userId, key, type, refId, title.slice(0, 140), message.slice(0, 320), snoozeSql]
    );
    return { action: 'snoozed', snoozeUntil: snoozeUntil.toISOString(), minutes: safeMins };
}

app.post('/api/reminders/snooze', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 0 }), async (req, res) => {
    const key = typeof req.body.key === 'string' ? req.body.key.trim() : '';
    const action = req.body.action === 'dismiss' ? 'dismiss' : 'snooze';
    const type = typeof req.body.type === 'string' && req.body.type.trim() ? req.body.type.trim().slice(0, 30) : 'general';
    const title = typeof req.body.title === 'string' ? req.body.title : 'Reminder';
    const message = typeof req.body.message === 'string' ? req.body.message : '';
    const refId = req.body.refId ? parseAgendaId(req.body.refId) : null;

    if (!key || key.length > 120) {
        return res.status(400).send('Invalid reminder key.');
    }
    if (action === 'snooze') {
        const mins = Number(req.body.minutes ?? 15);
        if (!Number.isInteger(mins) || mins < 1 || mins > 240) {
            return res.status(400).send('Snooze minutes must be an integer between 1 and 240.');
        }
    }

    try {
        const result = await applyReminderSnoozeOrDismiss({
            userId: req.user.id,
            key,
            type,
            refId,
            action,
            minutes: Number(req.body.minutes ?? 15),
            title,
            message
        });
        res.json({
            message: result.action === 'dismissed'
                ? 'Reminder dismissed.'
                : `Reminder postponed for ${result.minutes} minutes.`,
            key,
            ...result
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating reminder state.');
    }
});

app.post('/api/reminders/action', reminderActionLimiter.middleware, async (req, res) => {
    const token = String((req.query && req.query.token) || (req.body && req.body.token) || '').trim();
    const parsed = verifyReminderActionToken(token);
    if (!parsed) {
        return res.status(401).send('Invalid or expired reminder action token.');
    }

    try {
        const userRows = await dbQueryAsync('SELECT id, rol, estado FROM Usuarios WHERE id = ? LIMIT 1', [parsed.userId]);
        if (!userRows || userRows.length === 0 || (userRows[0].estado || 'activo') !== 'activo' || userRows[0].rol !== 'admin') {
            return res.status(403).send('Account not authorized for this action.');
        }

        if (parsed.action === 'complete' && parsed.refId) {
            await dbQueryAsync("UPDATE RegistrosAgenda SET estado = 'done', completada = 1 WHERE id = ?", [parsed.refId]);
            await applyReminderSnoozeOrDismiss({
                userId: parsed.userId,
                key: parsed.reminderKey,
                type: parsed.type || 'agenda',
                refId: parsed.refId,
                action: 'dismiss'
            });
            return res.json({ message: 'Agenda item marked as Done.', id: parsed.refId });
        }

        if (parsed.action === 'snooze') {
            const result = await applyReminderSnoozeOrDismiss({
                userId: parsed.userId,
                key: parsed.reminderKey,
                type: parsed.type || 'general',
                refId: parsed.refId || null,
                action: 'snooze',
                minutes: Number(parsed.mins || 15)
            });
            return res.json({ message: `Postponed for ${result.minutes} minutes.`, ...result });
        }

        return res.status(400).send('Unsupported reminder action.');
    } catch (err) {
        console.error(err);
        return res.status(500).send('Error processing reminder action.');
    }
});

// =========================================================================
// APRENDIZAJE DE INGLÉS CON MÚSICA (SÓLO METADATOS EN MYSQL + YOUTUBE MUSIC)
// Las notas largas y fragmentos de estudio se envían cifrados E2EE a Word (.docx).
// =========================================================================
const MUSIC_RELEASE_TYPES = new Set(['album', 'mini_album', 'ep', 'single', 'ost', 'collab_single']);
const MUSIC_STUDY_STATES = new Set(['to_study', 'in_progress', 'mastered']);
const MUSIC_ARTIST_ROLES = new Set(['main', 'feat', 'collab', 'producer']);
const YOUTUBE_ALLOWED_HOSTS = new Set([
    'music.youtube.com',
    'www.youtube.com',
    'youtube.com',
    'm.youtube.com',
    'youtu.be'
]);

function normalizarTextoCatalogo(valor) {
    return String(valor || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildStandardYouTubeUrl({ videoId, ytMusicUrl }) {
    const cleanId = String(videoId || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(cleanId)) {
        return `https://www.youtube.com/watch?v=${cleanId}`;
    }

    const rawUrl = String(ytMusicUrl || '').trim();
    if (!rawUrl) return null;

    try {
        const parsed = new URL(rawUrl);
        const vParam = parsed.searchParams.get('v');
        if (vParam && /^[A-Za-z0-9_-]{11}$/.test(vParam)) {
            return `https://www.youtube.com/watch?v=${vParam}`;
        }
        const listParam = parsed.searchParams.get('list');
        if (listParam && /^[A-Za-z0-9_-]{10,80}$/.test(listParam)) {
            return `https://www.youtube.com/playlist?list=${encodeURIComponent(listParam)}`;
        }
        if (parsed.pathname === '/search' && parsed.searchParams.get('q')) {
            return `https://www.youtube.com/results?search_query=${encodeURIComponent(parsed.searchParams.get('q').slice(0, 120))}`;
        }
        if (parsed.pathname === '/' || parsed.pathname === '') {
            return 'https://www.youtube.com/';
        }
        return rawUrl;
    } catch (_err) {
        return null;
    }
}

function parseYouTubeMusicInput(rawInput) {
    const trimmed = String(rawInput || '').trim();
    if (!trimmed) {
        return { valid: true, videoId: null, ytMusicUrl: null, youtubeUrl: null, thumbnailUrl: null };
    }

    // Permitir ingresar únicamente el ID de 11 caracteres si el usuario lo prefiere
    if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
        return {
            valid: true,
            videoId: trimmed,
            ytMusicUrl: `https://music.youtube.com/watch?v=${trimmed}`,
            youtubeUrl: `https://www.youtube.com/watch?v=${trimmed}`,
            thumbnailUrl: `https://i.ytimg.com/vi/${trimmed}/hqdefault.jpg`
        };
    }

    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch (_err) {
        return { valid: false, error: 'Invalid YouTube / YouTube Music URL.' };
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { valid: false, error: 'YouTube Music URL must use HTTPS.' };
    }

    if (parsed.username || parsed.password) {
        return { valid: false, error: 'URLs cannot contain embedded credentials.' };
    }

    const host = parsed.hostname.toLowerCase();
    if (!YOUTUBE_ALLOWED_HOSTS.has(host)) {
        return { valid: false, error: 'Only youtube.com, music.youtube.com, or youtu.be URLs are allowed.' };
    }

    let videoId = null;
    if (host === 'youtu.be') {
        const candidate = parsed.pathname.replace(/^\/+/, '').split('/')[0];
        if (/^[A-Za-z0-9_-]{11}$/.test(candidate)) videoId = candidate;
    } else {
        const vParam = parsed.searchParams.get('v');
        if (vParam && /^[A-Za-z0-9_-]{11}$/.test(vParam)) {
            videoId = vParam;
        } else {
            const pathMatch = parsed.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
            if (pathMatch) videoId = pathMatch[1];
        }
    }

    if (videoId) {
        return {
            valid: true,
            videoId,
            ytMusicUrl: `https://music.youtube.com/watch?v=${videoId}`,
            youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
            thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        };
    }

    const listParam = parsed.searchParams.get('list');
    if (listParam && /^[A-Za-z0-9_-]{10,80}$/.test(listParam)) {
        return {
            valid: true,
            videoId: null,
            ytMusicUrl: `https://music.youtube.com/playlist?list=${encodeURIComponent(listParam)}`,
            youtubeUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(listParam)}`,
            thumbnailUrl: null
        };
    }

    if (host === 'music.youtube.com') {
        const cleanParams = new URLSearchParams();
        if (parsed.pathname === '/search' && parsed.searchParams.get('q')) {
            cleanParams.set('q', parsed.searchParams.get('q').slice(0, 120));
        }
        const suffix = cleanParams.toString() ? `?${cleanParams.toString()}` : '';
        const ytMusicUrl = `https://music.youtube.com${parsed.pathname}${suffix}`.slice(0, 490);
        return {
            valid: true,
            videoId: null,
            ytMusicUrl,
            youtubeUrl: buildStandardYouTubeUrl({ videoId: null, ytMusicUrl }),
            thumbnailUrl: null
        };
    }

    return { valid: false, error: 'Could not extract a valid YouTube Music track, video, or playlist link.' };
}

function parseCollaboratorsInput(rawCollaborators, mainArtistName) {
    const mainNorm = normalizarTextoCatalogo(mainArtistName);
    const seen = new Set(mainNorm ? [mainNorm] : []);
    const result = [];

    let items = [];
    if (Array.isArray(rawCollaborators)) {
        items = rawCollaborators;
    } else if (typeof rawCollaborators === 'string' && rawCollaborators.trim()) {
        items = rawCollaborators.split(/[,;&\n]+/).map(part => {
            const cleaned = part.trim();
            const featMatch = cleaned.match(/^(?:feat\.?|ft\.?)\s+(.+)$/i);
            return featMatch ? { nombre: featMatch[1], rol: 'feat' } : { nombre: cleaned, rol: 'collab' };
        });
    }

    for (const item of items) {
        const nombre = String(typeof item === 'string' ? item : (item && item.nombre) || '').trim().replace(/\s+/g, ' ');
        if (!nombre || nombre.length > 140) continue;
        const norm = normalizarTextoCatalogo(nombre);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        const rawRol = String((item && item.rol) || 'collab').trim().toLowerCase();
        const rol = MUSIC_ARTIST_ROLES.has(rawRol) && rawRol !== 'main' ? rawRol : 'collab';
        result.push({ nombre, rol });
        if (result.length >= 8) break;
    }
    return result;
}

async function upsertMusicaArtista(usuarioId, nombre, tipoArtista = 'solo', { updateExisting = false } = {}) {
    const cleanName = String(nombre || '').trim().replace(/\s+/g, ' ').slice(0, 140);
    const norm = normalizarTextoCatalogo(cleanName);
    if (!norm) return null;

    const tipo = ['solo', 'group', 'duo', 'collab_project'].includes(tipoArtista) ? tipoArtista : 'solo';
    const existing = await dbQueryAsync(
        'SELECT id FROM MusicaArtistas WHERE usuario_id = ? AND nombre_normalizado = ? LIMIT 1',
        [usuarioId, norm]
    );
    if (existing.length) {
        if (updateExisting) {
            await dbQueryAsync(
                'UPDATE MusicaArtistas SET nombre = ?, tipo_artista = ? WHERE id = ? AND usuario_id = ?',
                [cleanName, tipo, existing[0].id, usuarioId]
            );
        }
        return existing[0].id;
    }

    const inserted = await dbQueryAsync(
        'INSERT INTO MusicaArtistas (usuario_id, nombre, nombre_normalizado, tipo_artista) VALUES (?, ?, ?, ?)',
        [usuarioId, cleanName, norm, tipo]
    );
    return inserted.insertId;
}

async function upsertMusicaAlbum({ usuarioId, albumTitle, albumType, albumYear, mainArtistId }) {
    const cleanTitle = String(albumTitle || '').trim().replace(/\s+/g, ' ').slice(0, 180);
    const norm = normalizarTextoCatalogo(cleanTitle);
    if (!norm) return null;

    const tipo = MUSIC_RELEASE_TYPES.has(albumType) ? albumType : 'album';
    const yearVal = albumYear && Number.isInteger(Number(albumYear)) && Number(albumYear) >= 1900 && Number(albumYear) <= 2100
        ? Number(albumYear)
        : null;

    const existing = await dbQueryAsync(
        `SELECT id FROM MusicaAlbumes
         WHERE usuario_id = ? AND titulo_normalizado = ? AND COALESCE(artista_principal_id, 0) = COALESCE(?, 0)
         LIMIT 1`,
        [usuarioId, norm, mainArtistId || null]
    );
    if (existing.length) {
        await dbQueryAsync(
            'UPDATE MusicaAlbumes SET tipo_lanzamiento = ?, anio = COALESCE(?, anio) WHERE id = ? AND usuario_id = ?',
            [tipo, yearVal, existing[0].id, usuarioId]
        );
        return existing[0].id;
    }

    const inserted = await dbQueryAsync(
        `INSERT INTO MusicaAlbumes (usuario_id, artista_principal_id, titulo, titulo_normalizado, tipo_lanzamiento, anio)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [usuarioId, mainArtistId || null, cleanTitle, norm, tipo, yearVal]
    );
    return inserted.insertId;
}

function validateAndExtractSongPayload(body) {
    const titulo = String(body.titulo || body.title || '').trim().replace(/\s+/g, ' ');
    const mainArtist = String(body.mainArtist || body.artistaPrincipal || '').trim().replace(/\s+/g, ' ');
    if (!titulo || titulo.length > 180) {
        return { error: 'Song title is required (max 180 characters).' };
    }
    if (!mainArtist || mainArtist.length > 140) {
        return { error: 'Main artist or group name is required (max 140 characters).' };
    }

    const enfoqueRaw = String(body.enfoqueCorto || body.focus || '').trim();
    if (enfoqueRaw.length > 255 || enfoqueRaw.split(/\r?\n/).length > 4) {
        return {
            error: 'Short study focus must be <= 255 chars. Keep long lyrics & translations encrypted to Word on your PC.'
        };
    }

    const ytParsed = parseYouTubeMusicInput(body.ytMusicUrl || body.youtubeUrl || '');
    if (!ytParsed.valid) {
        return { error: ytParsed.error };
    }

    const albumTitle = String(body.albumTitle || '').trim().replace(/\s+/g, ' ');
    if (albumTitle.length > 180) {
        return { error: 'Album / Mini Album title must be <= 180 characters.' };
    }

    const rawType = String(body.albumType || 'album').trim().toLowerCase();
    const albumType = MUSIC_RELEASE_TYPES.has(rawType) ? rawType : 'album';

    let albumYear = null;
    if (body.albumYear !== undefined && body.albumYear !== null && String(body.albumYear).trim() !== '') {
        const y = Number.parseInt(body.albumYear, 10);
        if (!Number.isInteger(y) || y < 1900 || y > 2100) {
            return { error: 'Album release year must be between 1900 and 2100.' };
        }
        albumYear = y;
    }

    let numeroPista = null;
    if (body.trackNumber !== undefined && body.trackNumber !== null && String(body.trackNumber).trim() !== '') {
        const n = Number.parseInt(body.trackNumber, 10);
        if (!Number.isInteger(n) || n < 1 || n > 999) {
            return { error: 'Track number must be between 1 and 999.' };
        }
        numeroPista = n;
    }

    const rawState = String(body.estadoEstudio || body.status || 'to_study').trim().toLowerCase();
    const estadoEstudio = MUSIC_STUDY_STATES.has(rawState) ? rawState : 'to_study';
    const idioma = String(body.idioma || body.language || 'English').trim().slice(0, 40) || 'English';
    const artistType = ['solo', 'group', 'duo', 'collab_project'].includes(body.artistType)
        ? body.artistType
        : 'solo';
    const collaborators = parseCollaboratorsInput(body.collaborators, mainArtist);

    return {
        data: {
            titulo,
            mainArtist,
            artistType,
            collaborators,
            albumTitle,
            albumType,
            albumYear,
            numeroPista,
            idioma,
            ytMusicUrl: ytParsed.ytMusicUrl,
            youtubeUrl: ytParsed.youtubeUrl,
            ytVideoId: ytParsed.videoId,
            thumbnailUrl: ytParsed.thumbnailUrl,
            estadoEstudio,
            enfoqueCorto: enfoqueRaw || null
        }
    };
}

app.get('/api/english/music/catalog', apiReadLimiter.middleware, requireAdmin, async (req, res) => {
    try {
        const uid = req.user.id;
        const [artists, albums, songs, songArtists] = await Promise.all([
            dbQueryAsync(
                `SELECT id, nombre, tipo_artista, notas_cortas, creado_en
                 FROM MusicaArtistas WHERE usuario_id = ? ORDER BY nombre ASC`,
                [uid]
            ),
            dbQueryAsync(
                `SELECT al.id, al.artista_principal_id, ma.nombre AS artista_principal_nombre,
                        al.titulo, al.tipo_lanzamiento, al.anio, al.notas_cortas, al.creado_en
                 FROM MusicaAlbumes al
                 LEFT JOIN MusicaArtistas ma ON ma.id = al.artista_principal_id
                 WHERE al.usuario_id = ?
                 ORDER BY COALESCE(al.anio, 0) DESC, al.titulo ASC`,
                [uid]
            ),
            dbQueryAsync(
                `SELECT c.id, c.album_id, al.titulo AS album_titulo, al.tipo_lanzamiento AS album_tipo,
                        al.anio AS album_anio, c.titulo, c.numero_pista, c.idioma,
                        c.yt_music_url, c.yt_video_id, c.thumbnail_url, c.estado_estudio,
                        c.enfoque_corto, c.word_sincronizado, c.ultimo_estudio_en,
                        c.creado_en, c.actualizado_en
                 FROM MusicaCanciones c
                 LEFT JOIN MusicaAlbumes al ON al.id = c.album_id
                 WHERE c.usuario_id = ?
                 ORDER BY c.actualizado_en DESC, c.id DESC`,
                [uid]
            ),
            dbQueryAsync(
                `SELECT mca.cancion_id, mca.artista_id, mca.rol, mca.orden, ma.nombre
                 FROM MusicaCancionArtistas mca
                 INNER JOIN MusicaCanciones c ON c.id = mca.cancion_id
                 INNER JOIN MusicaArtistas ma ON ma.id = mca.artista_id
                 WHERE c.usuario_id = ?
                 ORDER BY mca.orden ASC, ma.nombre ASC`,
                [uid]
            )
        ]);

        const artistsBySong = new Map();
        for (const link of songArtists) {
            if (!artistsBySong.has(link.cancion_id)) artistsBySong.set(link.cancion_id, []);
            artistsBySong.get(link.cancion_id).push({
                id: link.artista_id,
                nombre: link.nombre,
                rol: link.rol,
                orden: link.orden
            });
        }

        const enrichedSongs = songs.map(song => {
            const youtubeUrl = buildStandardYouTubeUrl({
                videoId: song.yt_video_id || song.youtube_video_id,
                ytMusicUrl: song.yt_music_url
            });
            return {
                ...song,
                word_sincronizado: Boolean(song.word_sincronizado),
                youtube_url: youtubeUrl,
                youtubeUrl,
                artists: artistsBySong.get(song.id) || []
            };
        });

        const stats = {
            totalSongs: enrichedSongs.length,
            totalArtists: artists.length,
            totalAlbums: albums.length,
            toStudy: enrichedSongs.filter(s => s.estado_estudio === 'to_study').length,
            inProgress: enrichedSongs.filter(s => s.estado_estudio === 'in_progress').length,
            mastered: enrichedSongs.filter(s => s.estado_estudio === 'mastered').length,
            wordSynced: enrichedSongs.filter(s => s.word_sincronizado).length
        };

        res.json({ artists, albums, songs: enrichedSongs, stats });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading English music catalog.');
    }
});

app.get('/api/english/music/search', apiReadLimiter.middleware, requireAdmin, async (req, res) => {
    const queryText = String(req.query.q || '').trim().slice(0, 120);
    const ytMusicSearchUrl = queryText
        ? `https://music.youtube.com/search?q=${encodeURIComponent(queryText)}`
        : 'https://music.youtube.com/';
    const ytMusicLibraryUrl = 'https://music.youtube.com/library';
    const youtubeSearchUrl = queryText
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(queryText)}`
        : 'https://www.youtube.com/';
    const youtubeHomeUrl = 'https://www.youtube.com/';

    const apiKey = String(process.env.YOUTUBE_API_KEY || '').trim();
    if (!apiKey || !queryText) {
        return res.json({
            configured: Boolean(apiKey),
            ytMusicSearchUrl,
            ytMusicLibraryUrl,
            youtubeSearchUrl,
            youtubeHomeUrl,
            results: []
        });
    }

    try {
        const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
        searchUrl.searchParams.set('part', 'snippet');
        searchUrl.searchParams.set('type', 'video');
        searchUrl.searchParams.set('videoCategoryId', '10');
        searchUrl.searchParams.set('maxResults', '8');
        searchUrl.searchParams.set('q', queryText);
        searchUrl.searchParams.set('key', apiKey);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const apiRes = await fetch(searchUrl.toString(), { signal: controller.signal });
        clearTimeout(timer);

        if (!apiRes.ok) {
            return res.json({
                configured: true,
                apiUnavailable: true,
                ytMusicSearchUrl,
                ytMusicLibraryUrl,
                youtubeSearchUrl,
                youtubeHomeUrl,
                results: []
            });
        }

        const payload = await apiRes.json();
        const results = (Array.isArray(payload.items) ? payload.items : [])
            .map(item => {
                const videoId = item && item.id && item.id.videoId;
                const snippet = (item && item.snippet) || {};
                if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
                return {
                    videoId,
                    title: String(snippet.title || '').slice(0, 180),
                    channelTitle: String(snippet.channelTitle || '').replace(/\s*-\s*Topic$/i, '').slice(0, 140),
                    ytMusicUrl: `https://music.youtube.com/watch?v=${videoId}`,
                    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
                    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
                };
            })
            .filter(Boolean);

        return res.json({
            configured: true,
            ytMusicSearchUrl,
            ytMusicLibraryUrl,
            youtubeSearchUrl,
            youtubeHomeUrl,
            results
        });
    } catch (_err) {
        return res.json({
            configured: Boolean(apiKey),
            apiUnavailable: true,
            ytMusicSearchUrl,
            ytMusicLibraryUrl,
            youtubeSearchUrl,
            youtubeHomeUrl,
            results: []
        });
    }
});

app.post('/api/english/music/resolve', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, async (req, res) => {
    const parsed = parseYouTubeMusicInput(req.body.url || '');
    if (!parsed.valid || (!parsed.ytMusicUrl && !parsed.videoId)) {
        return res.status(400).send(parsed.error || 'Provide a valid YouTube or YouTube Music URL.');
    }

    let suggestedTitle = null;
    let suggestedArtist = null;

    if (parsed.videoId) {
        try {
            const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${parsed.videoId}`)}&format=json`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 4000);
            const oRes = await fetch(oembedUrl, { signal: controller.signal });
            clearTimeout(timer);
            if (oRes.ok) {
                const meta = await oRes.json();
                suggestedTitle = meta && meta.title ? String(meta.title).slice(0, 180) : null;
                suggestedArtist = meta && meta.author_name
                    ? String(meta.author_name).replace(/\s*-\s*Topic$/i, '').slice(0, 140)
                    : null;
            }
        } catch (_err) {
            // Si oEmbed falla o no hay red, devolvemos igualmente el enlace normalizado
        }
    }

    res.json({
        videoId: parsed.videoId,
        ytMusicUrl: parsed.ytMusicUrl,
        youtubeUrl: parsed.youtubeUrl,
        thumbnailUrl: parsed.thumbnailUrl,
        suggestedTitle,
        suggestedArtist
    });
});

async function syncMusicaCancionArtistas(uid, songId, mainArtistId, collaborators, clearExisting = false) {
    if (clearExisting) {
        await dbQueryAsync('DELETE FROM MusicaCancionArtistas WHERE cancion_id = ?', [songId]);
    }
    await dbQueryAsync(
        'INSERT INTO MusicaCancionArtistas (cancion_id, artista_id, rol, orden) VALUES (?, ?, ?, ?)',
        [songId, mainArtistId, 'main', 1]
    );

    let order = 2;
    for (const collab of collaborators) {
        const collabId = await upsertMusicaArtista(uid, collab.nombre, 'solo');
        if (collabId && collabId !== mainArtistId) {
            await dbQueryAsync(
                'INSERT INTO MusicaCancionArtistas (cancion_id, artista_id, rol, orden) VALUES (?, ?, ?, ?)',
                [songId, collabId, collab.rol, order++]
            );
        }
    }
}

app.post('/api/english/music/songs', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 8000 }), async (req, res) => {
    const validated = validateAndExtractSongPayload(req.body);
    if (validated.error) return res.status(400).send(validated.error);

    const d = validated.data;
    const uid = req.user.id;

    try {
        const mainArtistId = await upsertMusicaArtista(uid, d.mainArtist, d.artistType, { updateExisting: true });
        const albumId = await upsertMusicaAlbum({
            usuarioId: uid,
            albumTitle: d.albumTitle,
            albumType: d.albumType,
            albumYear: d.albumYear,
            mainArtistId
        });

        const insertedSong = await dbQueryAsync(
            `INSERT INTO MusicaCanciones
             (usuario_id, album_id, titulo, numero_pista, idioma, yt_music_url, yt_video_id, thumbnail_url, estado_estudio, enfoque_corto)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                uid,
                albumId,
                d.titulo,
                d.numeroPista,
                d.idioma,
                d.ytMusicUrl,
                d.ytVideoId,
                d.thumbnailUrl,
                d.estadoEstudio,
                d.enfoqueCorto
            ]
        );
        const songId = insertedSong.insertId;
        await syncMusicaCancionArtistas(uid, songId, mainArtistId, d.collaborators, false);

        res.status(201).json({
            message: 'Song registered in your English Music catalog.',
            songId,
            ytMusicUrl: d.ytMusicUrl,
            youtubeUrl: d.youtubeUrl
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error saving song to music catalog.');
    }
});

app.put('/api/english/music/songs/:id', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 0 }), async (req, res) => {
    const songId = parsePositiveInt(req.params.id);
    if (!songId) return res.status(400).send('Invalid song ID.');

    const validated = validateAndExtractSongPayload(req.body);
    if (validated.error) return res.status(400).send(validated.error);

    const d = validated.data;
    const uid = req.user.id;

    try {
        const existing = await dbQueryAsync(
            'SELECT id FROM MusicaCanciones WHERE id = ? AND usuario_id = ? LIMIT 1',
            [songId, uid]
        );
        if (!existing.length) return res.status(404).send('Song not found.');

        const mainArtistId = await upsertMusicaArtista(uid, d.mainArtist, d.artistType, { updateExisting: true });
        const albumId = await upsertMusicaAlbum({
            usuarioId: uid,
            albumTitle: d.albumTitle,
            albumType: d.albumType,
            albumYear: d.albumYear,
            mainArtistId
        });

        await dbQueryAsync(
            `UPDATE MusicaCanciones
             SET album_id = ?, titulo = ?, numero_pista = ?, idioma = ?,
                 yt_music_url = ?, yt_video_id = ?, thumbnail_url = ?,
                 estado_estudio = ?, enfoque_corto = ?
             WHERE id = ? AND usuario_id = ?`,
            [
                albumId,
                d.titulo,
                d.numeroPista,
                d.idioma,
                d.ytMusicUrl,
                d.ytVideoId,
                d.thumbnailUrl,
                d.estadoEstudio,
                d.enfoqueCorto,
                songId,
                uid
            ]
        );

        await syncMusicaCancionArtistas(uid, songId, mainArtistId, d.collaborators, true);

        res.json({ message: 'Song metadata updated.' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating song metadata.');
    }
});

app.patch('/api/english/music/songs/:id/status', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, async (req, res) => {
    const songId = parsePositiveInt(req.params.id);
    if (!songId) return res.status(400).send('Invalid song ID.');

    const uid = req.user.id;
    const rawState = req.body.estadoEstudio !== undefined ? String(req.body.estadoEstudio).trim().toLowerCase() : null;
    if (rawState !== null && !MUSIC_STUDY_STATES.has(rawState)) {
        return res.status(400).send('Unsupported study status.');
    }
    const wordSyncedProvided = req.body.wordSynced !== undefined;
    const wordSyncedVal = wordSyncedProvided ? (req.body.wordSynced ? 1 : 0) : null;

    if (rawState === null && !wordSyncedProvided) {
        return res.status(400).send('Nothing to update.');
    }

    try {
        const currentRows = await dbQueryAsync(
            'SELECT id, estado_estudio, word_sincronizado FROM MusicaCanciones WHERE id = ? AND usuario_id = ? LIMIT 1',
            [songId, uid]
        );
        if (!currentRows.length) return res.status(404).send('Song not found.');

        const nextState = rawState !== null ? rawState : currentRows[0].estado_estudio;
        const nextWord = wordSyncedProvided ? wordSyncedVal : (currentRows[0].word_sincronizado ? 1 : 0);

        await dbQueryAsync(
            `UPDATE MusicaCanciones
             SET estado_estudio = ?, word_sincronizado = ?, ultimo_estudio_en = ?
             WHERE id = ? AND usuario_id = ?`,
            [nextState, nextWord, formatMySqlDateTime(new Date()), songId, uid]
        );

        res.json({ message: 'Song study state updated.', estado_estudio: nextState, word_sincronizado: Boolean(nextWord) });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating song study state.');
    }
});

app.delete('/api/english/music/songs/:id', apiWriteLimiter.middleware, requireAdmin, async (req, res) => {
    const songId = parsePositiveInt(req.params.id);
    if (!songId) return res.status(400).send('Invalid song ID.');

    try {
        const result = await dbQueryAsync(
            'DELETE FROM MusicaCanciones WHERE id = ? AND usuario_id = ?',
            [songId, req.user.id]
        );
        if (!result.affectedRows) return res.status(404).send('Song not found.');

        res.json({ message: 'Song deleted from music catalog.' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error deleting song.');
    }
});

app.patch('/api/english/music/artists/:id', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, async (req, res) => {
    const artistId = parsePositiveInt(req.params.id);
    if (!artistId) return res.status(400).send('Invalid artist ID.');

    const cleanName = String(req.body.nombre || '').trim().replace(/\s+/g, ' ').slice(0, 140);
    const norm = normalizarTextoCatalogo(cleanName);
    if (!norm) return res.status(400).send('Artist name is required.');

    const tipo = ['solo', 'group', 'duo', 'collab_project'].includes(req.body.tipoArtista)
        ? req.body.tipoArtista
        : 'group';
    const notasCortas = String(req.body.notasCortas || '').trim().slice(0, 255) || null;
    const uid = req.user.id;

    try {
        const existing = await dbQueryAsync(
            'SELECT id FROM MusicaArtistas WHERE id = ? AND usuario_id = ? LIMIT 1',
            [artistId, uid]
        );
        if (!existing.length) return res.status(404).send('Artist not found.');

        const conflict = await dbQueryAsync(
            'SELECT id FROM MusicaArtistas WHERE usuario_id = ? AND nombre_normalizado = ? AND id <> ? LIMIT 1',
            [uid, norm, artistId]
        );
        if (conflict.length) {
            return res.status(409).send('Another artist with that name already exists in your catalog.');
        }

        await dbQueryAsync(
            'UPDATE MusicaArtistas SET nombre = ?, nombre_normalizado = ?, tipo_artista = ?, notas_cortas = ? WHERE id = ? AND usuario_id = ?',
            [cleanName, norm, tipo, notasCortas, artistId, uid]
        );
        res.json({ message: 'Artist updated successfully.', id: artistId, nombre: cleanName, tipo_artista: tipo, notas_cortas: notasCortas });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating artist.');
    }
});

app.patch('/api/english/music/albums/:id', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, async (req, res) => {
    const albumId = parsePositiveInt(req.params.id);
    if (!albumId) return res.status(400).send('Invalid album ID.');

    const cleanTitle = String(req.body.titulo || '').trim().replace(/\s+/g, ' ').slice(0, 180);
    const norm = normalizarTextoCatalogo(cleanTitle);
    if (!norm) return res.status(400).send('Album title is required.');

    const tipo = MUSIC_RELEASE_TYPES.has(req.body.tipoLanzamiento) ? req.body.tipoLanzamiento : 'album';
    const rawYear = req.body.anio !== undefined && req.body.anio !== '' && req.body.anio !== null ? Number(req.body.anio) : null;
    const anio = rawYear && Number.isInteger(rawYear) && rawYear >= 1950 && rawYear <= 2100 ? rawYear : null;
    const uid = req.user.id;

    try {
        const existing = await dbQueryAsync(
            'SELECT id FROM MusicaAlbumes WHERE id = ? AND usuario_id = ? LIMIT 1',
            [albumId, uid]
        );
        if (!existing.length) return res.status(404).send('Album not found.');

        await dbQueryAsync(
            'UPDATE MusicaAlbumes SET titulo = ?, titulo_normalizado = ?, tipo_lanzamiento = ?, anio = ? WHERE id = ? AND usuario_id = ?',
            [cleanTitle, norm, tipo, anio, albumId, uid]
        );
        res.json({ message: 'Album updated successfully.', id: albumId, titulo: cleanTitle, tipo_lanzamiento: tipo, anio });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating album.');
    }
});

app.post('/api/english/music/albums', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, preventDuplicateSubmit({ dedupeWindowMs: 6000 }), async (req, res) => {
    const cleanTitle = String(req.body.albumTitle || req.body.titulo || req.body.title || '').trim().replace(/\s+/g, ' ');
    const normTitle = normalizarTextoCatalogo(cleanTitle);
    if (!normTitle || cleanTitle.length > 180) {
        return res.status(400).send('Album / Mini Album title is required (max 180 characters).');
    }

    const mainArtist = String(req.body.mainArtist || req.body.artistaPrincipal || '').trim().replace(/\s+/g, ' ');
    if (!mainArtist || mainArtist.length > 140) {
        return res.status(400).send('Main artist or group name is required (max 140 characters).');
    }

    const rawType = String(req.body.albumType || req.body.tipoLanzamiento || 'mini_album').trim().toLowerCase();
    const tipoLanzamiento = MUSIC_RELEASE_TYPES.has(rawType) ? rawType : 'mini_album';

    const rawYear = req.body.albumYear ?? req.body.anio;
    let anio = null;
    if (rawYear !== undefined && rawYear !== null && String(rawYear).trim() !== '') {
        const y = Number.parseInt(rawYear, 10);
        if (!Number.isInteger(y) || y < 1900 || y > 2100) {
            return res.status(400).send('Album release year must be between 1900 and 2100.');
        }
        anio = y;
    }

    const artistType = ['solo', 'group', 'duo', 'collab_project'].includes(req.body.artistType)
        ? req.body.artistType
        : 'solo';
    const notasCortas = req.body.notasCortas ? String(req.body.notasCortas).trim().slice(0, 255) : null;
    const uid = req.user.id;

    try {
        const mainArtistId = await upsertMusicaArtista(uid, mainArtist, artistType, { updateExisting: true });
        const albumId = await upsertMusicaAlbum({
            usuarioId: uid,
            albumTitle: cleanTitle,
            albumType: tipoLanzamiento,
            albumYear: anio,
            mainArtistId
        });

        if (albumId && notasCortas) {
            await dbQueryAsync(
                'UPDATE MusicaAlbumes SET notas_cortas = ? WHERE id = ? AND usuario_id = ?',
                [notasCortas, albumId, uid]
            );
        }

        res.status(201).json({
            message: 'Album / Mini Album saved to catalog.',
            album: {
                id: albumId,
                artista_principal_id: mainArtistId,
                artista_principal_nombre: mainArtist,
                titulo: cleanTitle,
                tipo_lanzamiento: tipoLanzamiento,
                anio,
                notas_cortas: notasCortas
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error saving album to catalog.');
    }
});

app.delete('/api/english/music/albums/:id', apiWriteLimiter.middleware, requireAdmin, async (req, res) => {
    const albumId = parsePositiveInt(req.params.id);
    if (!albumId) return res.status(400).send('Invalid album ID.');

    try {
        const uid = req.user.id;
        await dbQueryAsync(
            'UPDATE MusicaCanciones SET album_id = NULL WHERE album_id = ? AND usuario_id = ?',
            [albumId, uid]
        );
        const del = await dbQueryAsync(
            'DELETE FROM MusicaAlbumes WHERE id = ? AND usuario_id = ?',
            [albumId, uid]
        );
        if (!del.affectedRows) return res.status(404).send('Album not found.');

        res.json({ message: 'Album deleted successfully (its songs were preserved as standalone tracks).', id: albumId });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error deleting album.');
    }
});

// =========================================================================
// SIMULATED HTTPS HYBRID TRANSPORT LAYER (X25519 + AES-256-CTR + HMAC-SHA256)
// =========================================================================
app.post('/api/transport/handshake', transportHandshakeLimiter.middleware, requireNonEmptyBody, (req, res) => {
    try {
        const result = transportManager.createHandshakeResponse(req.body.clientPub);
        res.json(result);
    } catch (err) {
        res.status(err.status || 400).json({
            error: err.message || 'Transport handshake failed.',
            code: err.code || 'TRANSPORT_HANDSHAKE_ERROR'
        });
    }
});

app.get('/api/transport/status', apiReadLimiter.middleware, (req, res) => {
    const kid = typeof req.headers['x-transport-session'] === 'string'
        ? req.headers['x-transport-session'].trim()
        : null;
    res.json(transportManager.getStatusSnapshot(kid));
});

app.post('/api/transport/benchmark', apiWriteLimiter.middleware, requireAuth, requireNonEmptyBody, (req, res) => {
    const startedNs = process.hrtime.bigint();
    const rawPayload = typeof req.body.samplePayload === 'string'
        ? req.body.samplePayload
        : JSON.stringify(req.body.samplePayload || {});
    const byteLength = Buffer.byteLength(rawPayload, 'utf8');
    const sha256 = crypto.createHash('sha256').update(rawPayload, 'utf8').digest('hex').slice(0, 16);
    const serverProcessMs = Number(Number(process.hrtime.bigint() - startedNs) / 1e6).toFixed(3);

    res.json({
        ok: true,
        encryptedIn: Boolean(req.transportEncryptedIn),
        serverDecryptMs: req.transportDecryptMs ?? null,
        serverProcessMs: Number(serverProcessMs),
        payloadBytes: byteLength,
        sha256Prefix: sha256,
        echoSample: req.body.echo ? rawPayload : undefined,
        protocol: TRANSPORT_PROTOCOL
    });
});

// =========================================================================
// MULTI-LANGUAGE STUDY & AI LYRICS ENGINE (English, Korean, K-Pop EN+KR)
// =========================================================================
app.get('/api/language/registry', apiReadLimiter.middleware, requireAdmin, async (req, res) => {
    try {
        const settings = await loadUserSettings(req.user.id);
        const mem = sanitizeLanguageMemory(settings.languageMemory);
        res.json({
            languages: getLanguageRegistry(),
            geminiModels: RECOMMENDED_GEMINI_MODELS,
            preferredStudyLanguage: settings.preferredStudyLanguage || 'en_ko',
            activeGeminiModel: settings.geminiModel || 'gemini-2.5-flash',
            geminiKeyConfigured: Boolean(settings.geminiApiKey || process.env.GEMINI_API_KEY),
            languageMemory: mem
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading language registry.');
    }
});

app.get('/api/language/memory', apiReadLimiter.middleware, requireAdmin, async (req, res) => {
    try {
        const settings = await loadUserSettings(req.user.id);
        res.json({
            languageMemory: sanitizeLanguageMemory(settings.languageMemory)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading AI language learning memory.');
    }
});

app.post('/api/language/memory', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, async (req, res) => {
    try {
        const settings = await loadUserSettings(req.user.id);
        if (req.body.clear === true) {
            settings.languageMemory = sanitizeLanguageMemory();
        } else {
            settings.languageMemory = mergeLanguageMemory(settings.languageMemory, {
                terms: Array.isArray(req.body.terms) ? req.body.terms : (req.body.term || req.body.word ? [req.body] : []),
                grammarNotes: Array.isArray(req.body.grammarNotes) ? req.body.grammarNotes : [],
                songTitle: req.body.songTitle || '',
                artistName: req.body.artistName || '',
                language: req.body.language || settings.preferredStudyLanguage || 'en_ko',
                customContext: req.body.customContext
            });
        }
        await saveUserSettings(req.user.id, settings);
        res.json({
            message: 'AI Learning Memory updated.',
            languageMemory: settings.languageMemory
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating AI language learning memory.');
    }
});

app.post('/api/language/romanize', apiReadLimiter.middleware, requireAdmin, requireNonEmptyBody, (req, res) => {
    const text = String(req.body.text || '').trim().slice(0, 5000);
    if (!text) {
        return res.status(400).send('Provide Korean text or mixed lyrics to romanize.');
    }
    return res.json({
        text,
        script: detectScriptKind(text),
        romanization: hangulToRomanization(text)
    });
});

async function loadUserRepertoireForAi(uid) {
    try {
        const [songs, songArtists] = await Promise.all([
            dbQueryAsync(
                `SELECT c.id, c.album_id, al.titulo AS album_titulo, al.tipo_lanzamiento AS album_tipo,
                        al.anio AS album_anio, c.titulo, c.numero_pista, c.idioma,
                        c.yt_music_url, c.yt_video_id, c.thumbnail_url, c.estado_estudio,
                        c.enfoque_corto, c.word_sincronizado, c.ultimo_estudio_en,
                        c.creado_en, c.actualizado_en
                 FROM MusicaCanciones c
                 LEFT JOIN MusicaAlbumes al ON al.id = c.album_id
                 WHERE c.usuario_id = ?
                 ORDER BY c.actualizado_en DESC, c.id DESC`,
                [uid]
            ),
            dbQueryAsync(
                `SELECT mca.cancion_id, mca.artista_id, mca.rol, mca.orden, ma.nombre
                 FROM MusicaCancionArtistas mca
                 INNER JOIN MusicaCanciones c ON c.id = mca.cancion_id
                 INNER JOIN MusicaArtistas ma ON ma.id = mca.artista_id
                 WHERE c.usuario_id = ?
                 ORDER BY mca.orden ASC, ma.nombre ASC`,
                [uid]
            )
        ]);
        const artistsBySong = new Map();
        for (const link of songArtists || []) {
            if (!artistsBySong.has(link.cancion_id)) artistsBySong.set(link.cancion_id, []);
            artistsBySong.get(link.cancion_id).push(link.nombre);
        }
        return (songs || []).slice(0, 60).map((s) => ({
            id: s.id,
            titulo: s.titulo,
            album: s.album_titulo || '',
            albumTipo: s.album_tipo || '',
            anio: s.album_anio || null,
            idioma: s.idioma || '',
            estado: s.estado_estudio || 'to_study',
            enfoque: s.enfoque_corto || '',
            artistas: artistsBySong.get(s.id) || []
        }));
    } catch (_) {
        return [];
    }
}

app.post('/api/language/analyze', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, async (req, res) => {
    try {
        const text = String(req.body.text || '').trim();
        const question = String(req.body.question || '').trim();
        if (!text && !question) {
            return res.status(400).send('Paste lyrics, a phrase, or a language question to analyze.');
        }
        if (text.length > 10000 || question.length > 1000) {
            return res.status(400).send('Lyrics text cannot exceed 10,000 characters.');
        }

        const [settings, repertoire] = await Promise.all([
            loadUserSettings(req.user.id),
            loadUserRepertoireForAi(req.user.id)
        ]);
        const currentMemory = sanitizeLanguageMemory(settings.languageMemory);
        const mode = ['auto', 'gemini', 'offline'].includes(String(req.body.mode || 'auto').toLowerCase())
            ? String(req.body.mode || 'auto').toLowerCase()
            : 'auto';
        const language = normalizeStudyLanguage(req.body.language || settings.preferredStudyLanguage || 'en_ko');
        const model = validateGeminiModelId(req.body.model || settings.geminiModel || 'gemini-2.5-flash');
        const inlineKey = typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : '';
        const effectiveKey = inlineKey || settings.geminiApiKey || process.env.GEMINI_API_KEY || '';
        const songTitle = String(req.body.songTitle || '').trim().slice(0, 180);
        const artistName = String(req.body.artistName || '').trim().slice(0, 140);

        let result;
        if (mode === 'offline' || (mode === 'auto' && !effectiveKey)) {
            result = analyzeTextOffline({
                text,
                question,
                language,
                songTitle,
                artistName,
                learningMemory: currentMemory,
                repertoire
            });
        } else {
            result = await analyzeWithGemini({
                apiKey: effectiveKey,
                model,
                text,
                question,
                language,
                songTitle,
                artistName,
                learningMemory: currentMemory,
                repertoire
            });
        }

        // Persist newly learned terms, grammar notes, and studied songs into user's AI memory bank
        if (req.body.remember !== false) {
            const matchedFirst = Array.isArray(result.matchedRepertoireSongs) && result.matchedRepertoireSongs[0];
            const termsToRemember = [
                ...(Array.isArray(result.vocabulary) ? result.vocabulary.slice(0, 8) : []),
                ...(result.wordNoteDraft && result.wordNoteDraft.word
                    ? [{
                        term: result.wordNoteDraft.word,
                        meaning: result.wordNoteDraft.meaning,
                        category: 'vocabulary',
                        language: result.language || language
                    }]
                    : [])
            ];
            settings.languageMemory = mergeLanguageMemory(currentMemory, {
                terms: termsToRemember,
                grammarNotes: Array.isArray(result.culturalAndGrammarNotes)
                    ? result.culturalAndGrammarNotes.filter((n) => !String(n).startsWith('🧠 Memory Recall:') && !String(n).startsWith('🎵 Repertoire Match:')).slice(0, 3)
                    : [],
                songTitle: songTitle || (matchedFirst ? matchedFirst.titulo : ''),
                artistName: artistName || (matchedFirst && matchedFirst.artistas ? matchedFirst.artistas.join(', ') : ''),
                language: result.language || language
            });
            await saveUserSettings(req.user.id, settings);
        }

        res.json({
            ...result,
            languageMemory: settings.languageMemory,
            memoryTotalTerms: settings.languageMemory.terms.length,
            availableModels: RECOMMENDED_GEMINI_MODELS,
            geminiKeyConfigured: Boolean(effectiveKey)
        });
    } catch (err) {
        console.error('[LANGUAGE_ANALYZE_ERROR]', err);
        res.status(500).send('Error running language & lyrics analysis.');
    }
});

app.post('/api/language/translate', apiWriteLimiter.middleware, requireAdmin, requireNonEmptyBody, async (req, res) => {
    try {
        const text = String(req.body.text || req.body.word || '').trim();
        if (!text) {
            return res.status(400).send('Enter a word, phrase, or lyric line to translate.');
        }
        if (text.length > 4000) {
            return res.status(400).send('Translation text cannot exceed 4,000 characters.');
        }

        const direction = normalizeTranslationDirection(req.body.direction || 'auto');
        const mode = ['auto', 'gemini', 'offline'].includes(String(req.body.mode || 'auto').toLowerCase())
            ? String(req.body.mode || 'auto').toLowerCase()
            : 'auto';
        const context = String(req.body.context || '').trim().slice(0, 400);

        const settings = await loadUserSettings(req.user.id);
        const currentMemory = sanitizeLanguageMemory(settings.languageMemory);
        const model = validateGeminiModelId(req.body.model || settings.geminiModel || 'gemini-2.5-flash');
        const inlineKey = typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : '';
        const effectiveKey = inlineKey || settings.geminiApiKey || process.env.GEMINI_API_KEY || '';

        let result;
        if (mode === 'offline' || (mode === 'auto' && !effectiveKey)) {
            result = translateOffline({
                text,
                direction,
                learningMemory: currentMemory
            });
        } else {
            result = await translateWithGemini({
                apiKey: effectiveKey,
                model,
                text,
                direction,
                context,
                learningMemory: currentMemory
            });
        }

        if (req.body.remember !== false && text.length <= 160 && result.translatedText) {
            const langCode = direction === 'ko_en' || direction === 'ko_es' || /hangul/i.test(String(result.detectedScript || ''))
                ? 'ko'
                : 'en';
            const memoryMeaning = result.spanishMeaning || result.translatedText;
            settings.languageMemory = mergeLanguageMemory(currentMemory, {
                terms: [{
                    term: text.slice(0, 120),
                    meaning: String(memoryMeaning).slice(0, 240),
                    romanization: result.romanization || '',
                    category: 'vocabulary',
                    language: langCode
                }],
                grammarNotes: [],
                songTitle: '',
                artistName: '',
                language: langCode
            });
            await saveUserSettings(req.user.id, settings);
        }

        res.json({
            ...result,
            languageMemory: settings.languageMemory,
            memoryTotalTerms: settings.languageMemory.terms.length,
            availableModels: RECOMMENDED_GEMINI_MODELS,
            geminiKeyConfigured: Boolean(effectiveKey)
        });
    } catch (err) {
        console.error('[LANGUAGE_TRANSLATE_ERROR]', err);
        res.status(500).send('Error running translator.');
    }
});

// Manejo controlado de rutas inexistentes y errores inesperados en API (sin filtrar stack traces)
app.use('/api', (req, res) => {
    res.status(404).send('API endpoint not found.');
});

app.use((err, req, res, _next) => {
    console.error(`[API_ERROR] ${req.method} ${req.originalUrl}:`, err && err.message ? err.message : err);
    if (res.headersSent) return;
    res.status(500).send('An internal server error occurred.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend server running at http://localhost:${PORT}`);
});

// Capturar errores imprevistos para saber por qué se cayó
process.on('uncaughtException', (err) => {
    console.error(`\n[CRASH] ${new Date().toISOString()} - Server crashed with uncaughtException:`);
    console.error(err);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error(`\n[CRASH] ${new Date().toISOString()} - Unhandled promise rejection:`, reason);
    process.exit(1);
});
