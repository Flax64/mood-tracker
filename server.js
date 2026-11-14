require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const app = express();
app.disable('x-powered-by');

// Cabeceras de seguridad HTTP
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
    );
    next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '64kb' }));
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

function inicializarTablasSeguridad() {
    const tablasSql = [
        `CREATE TABLE IF NOT EXISTS RegistrosAgenda (
            id INT AUTO_INCREMENT PRIMARY KEY,
            fecha DATE NOT NULL,
            bloque VARCHAR(30) NOT NULL,
            hora TIME NOT NULL,
            actividad VARCHAR(255) NOT NULL,
            completada TINYINT(1) NOT NULL DEFAULT 0,
            fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_agenda_fecha (fecha)
        )`,
        `CREATE TABLE IF NOT EXISTS Usuarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(80) NOT NULL,
            email VARCHAR(150) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            rol ENUM('admin', 'psiquiatra') NOT NULL DEFAULT 'psiquiatra',
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
            tipo ENUM('registro', 'reset') NOT NULL,
            token_hash CHAR(64) NOT NULL,
            expira_en DATETIME NOT NULL,
            usado TINYINT(1) NOT NULL DEFAULT 0,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_codigo_email_tipo (email, tipo)
        )`
    ];
    tablasSql.forEach(sql => {
        db.query(sql, err => {
            if (err) console.error('Error asegurando tabla:', err.message);
        });
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

// Rate limiter en memoria contra fuerza bruta
const rateLimitStore = new Map();
function checkRateLimit(key, maxAttempts = 10, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    const record = rateLimitStore.get(key);
    if (!record || now > record.resetAt) {
        rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
        return true;
    }
    if (record.count >= maxAttempts) {
        return false;
    }
    record.count += 1;
    return true;
}

function resetRateLimit(key) {
    rateLimitStore.delete(key);
}

// Transporte de correo (Gmail SMTP)
function crearTransporterCorreo() {
    const smtpUser = (process.env.SMTP_USER || ADMIN_EMAIL).trim();
    const smtpPass = (process.env.SMTP_PASS || '').trim();
    if (!smtpPass) return null;

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
        throw new Error('El servidor aún no tiene configurado SMTP_PASS (Contraseña de aplicación de Gmail) en .env');
    }
    const fromUser = (process.env.SMTP_USER || ADMIN_EMAIL).trim();
    await transporter.sendMail({
        from: `"Personal Mood Tracker" <${fromUser}>`,
        to,
        subject,
        html
    });
}

// Middleware de autenticación
function requireAuth(req, res, next) {
    const cookies = parseCookies(req);
    const rawToken = cookies.mt_session;
    if (!rawToken || rawToken.length < 32) {
        return res.status(401).send('Sesión no iniciada o expirada');
    }

    const tokenHash = sha256Hex(rawToken);
    const nowSql = formatMySqlDateTime(new Date());

    const sql = `
        SELECT s.id AS sesion_id, s.expira_en, u.id, u.nombre, u.email, u.rol
        FROM SesionesAuth s
        INNER JOIN Usuarios u ON u.id = s.usuario_id
        WHERE s.token_hash = ? AND s.expira_en > ?
        LIMIT 1
    `;

    db.query(sql, [tokenHash, nowSql], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al verificar sesión');
        }
        if (!rows || rows.length === 0) {
            clearSessionCookie(res);
            return res.status(401).send('Tu sesión ha expirado. Por favor inicia sesión nuevamente.');
        }

        req.user = {
            id: rows[0].id,
            nombre: rows[0].nombre,
            email: rows[0].email,
            rol: rows[0].rol,
            expira_en: rows[0].expira_en
        };
        req.sessionTokenHash = tokenHash;
        next();
    });
}

function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
        if (req.user.rol !== 'admin') {
            return res.status(403).send('Acceso de solo lectura: esta cuenta solo puede visualizar el resumen.');
        }
        next();
    });
}

// ==========================================
// RUTAS DE AUTENTICACIÓN Y SEGURIDAD
// ==========================================

// Consultar sesión activa
app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ authenticated: true, user: req.user });
});

// Enviar código de verificación al correo propietario (flavio.flax1234@gmail.com)
app.post('/api/auth/send-register-code', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`regcode:${ip}`, 6, 15 * 60 * 1000)) {
        return res.status(429).send('Demasiados intentos. Espera unos minutos.');
    }

    const emailSolicitante = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(emailSolicitante)) {
        return res.status(400).send('Ingresa un correo electrónico válido.');
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
                return res.status(500).send('Error al generar código de verificación');
            }

            try {
                const rolSolicitado = emailSolicitante === ADMIN_EMAIL ? 'Administrador (Propietario)' : 'Psiquiatra (Solo lectura)';
                await enviarCorreo({
                    to: ADMIN_EMAIL,
                    subject: 'Código de verificación - Personal Mood Tracker',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
                            <h2 style="color: #1e2430; margin-top: 0;">Verificación de Registro</h2>
                            <p>Se solicitó registrar la cuenta <strong>${emailSolicitante}</strong> con rol <strong>${rolSolicitado}</strong>.</p>
                            <p>Tu código de autorización (válido por 15 minutos) es:</p>
                            <div style="font-size: 28px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 14px; background: #f3f4f6; border-radius: 8px; color: #111827;">
                                ${codigo}
                            </div>
                        </div>
                    `
                });
                res.json({ message: `Código enviado a ${ADMIN_EMAIL}` });
            } catch (mailErr) {
                console.error(mailErr.message);
                res.status(500).send(
                    mailErr.message + '. También puedes registrarte ingresando tu clave secreta personal en el campo de validación.'
                );
            }
        }
    );
});

// Registro de usuario por primera vez (valida correo o clave secreta personal)
app.post('/api/auth/register', (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`register:${ip}`, 8, 15 * 60 * 1000)) {
        return res.status(429).send('Demasiados intentos de registro. Espera 15 minutos.');
    }

    const nombre = String(req.body.nombre || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const codigoValidacion = String(req.body.codigoValidacion || '').trim();

    if (!nombre || nombre.length < 2 || nombre.length > 80) {
        return res.status(400).send('El nombre debe tener entre 2 y 80 caracteres.');
    }
    if (!EMAIL_REGEX.test(email) || email.length > 150) {
        return res.status(400).send('Correo electrónico no válido.');
    }
    if (password.length < 8 || password.length > 128) {
        return res.status(400).send('La contraseña debe tener al menos 8 caracteres.');
    }
    if (!codigoValidacion) {
        return res.status(400).send('Ingresa el código de verificación o tu clave secreta personal.');
    }

    // Asignación estricta de rol: únicamente flavio.flax1234@gmail.com puede ser admin
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
                return res.status(500).send('Error al consultar usuarios');
            }
            if (rowsExist && rowsExist.length > 0) {
                return res.status(400).send('Este correo ya está registrado. Inicia sesión o recupera tu contraseña.');
            }

            try {
                const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
                db.query(
                    'INSERT INTO Usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)',
                    [nombre, email, passwordHash, rolAsignado],
                    (errIns, result) => {
                        if (errIns) {
                            console.error(errIns);
                            return res.status(500).send('Error al registrar el usuario');
                        }

                        // Iniciar sesión automáticamente hasta el próximo domingo 00:00
                        const rawToken = crypto.randomBytes(32).toString('hex');
                        const tokenHash = sha256Hex(rawToken);
                        const expiresAt = getNextSundayMidnight();
                        const expiresSql = formatMySqlDateTime(expiresAt);

                        db.query(
                            'INSERT INTO SesionesAuth (usuario_id, token_hash, expira_en) VALUES (?, ?, ?)',
                            [result.insertId, tokenHash, expiresSql],
                            (errSes) => {
                                if (errSes) {
                                    console.error(errSes);
                                    return res.status(500).send('Cuenta creada, pero ocurrió un error al iniciar sesión.');
                                }
                                setSessionCookie(res, rawToken, expiresAt);
                                res.status(201).json({
                                    message: 'Cuenta verificada y creada exitosamente',
                                    user: {
                                        id: result.insertId,
                                        nombre,
                                        email,
                                        rol: rolAsignado,
                                        expira_en: expiresAt.toISOString()
                                    }
                                });
                            }
                        );
                    }
                );
            } catch (hashErr) {
                console.error(hashErr);
                res.status(500).send('Error al procesar la contraseña');
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
            return res.status(500).send('Error al validar código de seguridad');
        }
        if (!rowsCod || rowsCod.length === 0) {
            return res.status(400).send('Código de verificación o clave secreta incorrecta o expirada.');
        }

        db.query('UPDATE CodigosSeguridad SET usado = 1 WHERE id = ?', [rowsCod[0].id], () => {
            procederConCreacion();
        });
    });
});

// Inicio de sesión
app.post('/api/auth/login', (req, res) => {
    const ip = req.ip || 'unknown';
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!checkRateLimit(`login:${ip}:${email}`, 10, 15 * 60 * 1000)) {
        return res.status(429).send('Demasiados intentos fallidos. Por seguridad, espera 15 minutos.');
    }

    if (!EMAIL_REGEX.test(email) || !password) {
        return res.status(400).send('Ingresa tu correo y contraseña.');
    }

    db.query('SELECT id, nombre, email, password_hash, rol FROM Usuarios WHERE email = ? LIMIT 1', [email], async (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al consultar la base de datos');
        }
        if (!rows || rows.length === 0) {
            return res.status(401).send('Correo o contraseña incorrectos.');
        }

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).send('Correo o contraseña incorrectos.');
        }

        resetRateLimit(`login:${ip}:${email}`);

        // Limpiar sesiones vencidas y crear nueva sesión válida hasta el próximo domingo 00:00
        const nowSql = formatMySqlDateTime(new Date());
        db.query('DELETE FROM SesionesAuth WHERE expira_en <= ?', [nowSql], () => {});

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
                    return res.status(500).send('Error al crear la sesión');
                }
                setSessionCookie(res, rawToken, expiresAt);
                res.json({
                    message: 'Sesión iniciada correctamente',
                    user: {
                        id: user.id,
                        nombre: user.nombre,
                        email: user.email,
                        rol: user.rol,
                        expira_en: expiresAt.toISOString()
                    }
                });
            }
        );
    });
});

// Cerrar sesión manualmente
app.post('/api/auth/logout', (req, res) => {
    const cookies = parseCookies(req);
    const rawToken = cookies.mt_session;
    clearSessionCookie(res);

    if (!rawToken) {
        return res.json({ message: 'Sesión cerrada' });
    }

    const tokenHash = sha256Hex(rawToken);
    db.query('DELETE FROM SesionesAuth WHERE token_hash = ?', [tokenHash], () => {
        res.json({ message: 'Sesión cerrada correctamente' });
    });
});

// Solicitar enlace de recuperación de contraseña por correo
app.post('/api/auth/forgot-password', (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`forgot:${ip}`, 5, 15 * 60 * 1000)) {
        return res.status(429).send('Demasiadas solicitudes. Espera 15 minutos.');
    }

    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
        return res.status(400).send('Ingresa un correo electrónico válido.');
    }

    db.query('SELECT id, nombre, email FROM Usuarios WHERE email = ? LIMIT 1', [email], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al procesar la solicitud');
        }
        if (!rows || rows.length === 0) {
            return res.json({ message: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.' });
        }

        const user = rows[0];
        const rawResetToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = sha256Hex(rawResetToken);
        const expira = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos
        const expiraSql = formatMySqlDateTime(expira);

        db.query(
            'INSERT INTO CodigosSeguridad (email, tipo, token_hash, expira_en, usado) VALUES (?, "reset", ?, ?, 0)',
            [user.email, tokenHash, expiraSql],
            async (errIns) => {
                if (errIns) {
                    console.error(errIns);
                    return res.status(500).send('Error al generar el enlace de recuperación');
                }

                const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
                const host = req.headers.host;
                const resetUrl = `${proto}://${host}/?resetToken=${rawResetToken}&email=${encodeURIComponent(user.email)}`;

                try {
                    await enviarCorreo({
                        to: user.email,
                        subject: 'Recuperación de contraseña - Personal Mood Tracker',
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 22px; border: 1px solid #e5e7eb; border-radius: 12px;">
                                <h2 style="color: #1e2430; margin-top: 0;">Restablecer Contraseña</h2>
                                <p>Hola <strong>${user.nombre}</strong>,</p>
                                <p>Solicitaste cambiar tu contraseña en Personal Mood Tracker. Haz clic en el siguiente botón (válido por 30 minutos):</p>
                                <p style="text-align: center; margin: 26px 0;">
                                    <a href="${resetUrl}" style="background: #1e2430; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: bold; display: inline-block;">
                                        Cambiar mi contraseña
                                    </a>
                                </p>
                                <p style="font-size: 12px; color: #6b7280;">Si no solicitaste este cambio, puedes ignorar este mensaje.</p>
                            </div>
                        `
                    });
                    res.json({ message: 'Te enviamos un enlace a tu correo para restablecer tu contraseña.' });
                } catch (mailErr) {
                    console.error(mailErr.message);
                    res.status(500).send(mailErr.message);
                }
            }
        );
    });
});

// Restablecer contraseña con el token enviado por correo
app.post('/api/auth/reset-password', (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`reset:${ip}`, 8, 15 * 60 * 1000)) {
        return res.status(429).send('Demasiados intentos. Espera 15 minutos.');
    }

    const email = String(req.body.email || '').trim().toLowerCase();
    const token = String(req.body.token || '').trim();
    const newPassword = String(req.body.newPassword || '');

    if (!EMAIL_REGEX.test(email) || !token || token.length < 32) {
        return res.status(400).send('Enlace de recuperación inválido.');
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
        return res.status(400).send('La nueva contraseña debe tener al menos 8 caracteres.');
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
            return res.status(500).send('Error al verificar el enlace');
        }
        if (!rows || rows.length === 0) {
            return res.status(400).send('El enlace de recuperación es inválido o ya expiró.');
        }

        const codigoId = rows[0].id;
        try {
            const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
            db.query('UPDATE Usuarios SET password_hash = ? WHERE email = ?', [passwordHash, email], (errUpd, resultUpd) => {
                if (errUpd || resultUpd.affectedRows === 0) {
                    return res.status(500).send('No se pudo actualizar la contraseña');
                }

                db.query('UPDATE CodigosSeguridad SET usado = 1 WHERE id = ?', [codigoId], () => {});
                db.query(
                    'DELETE FROM SesionesAuth WHERE usuario_id = (SELECT id FROM Usuarios WHERE email = ? LIMIT 1)',
                    [email],
                    () => {}
                );

                res.json({ message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });
            });
        } catch (e) {
            console.error(e);
            res.status(500).send('Error al cifrar la nueva contraseña');
        }
    });
});

// Gestión de cuenta del Psiquiatra desde la cuenta de Flavio (admin)
app.get('/api/auth/medicos', requireAdmin, (req, res) => {
    db.query('SELECT id, nombre, email, fecha_registro FROM Usuarios WHERE rol = "psiquiatra" ORDER BY id DESC', (err, rows) => {
        if (err) return res.status(500).send('Error al consultar cuentas de psiquiatra');
        res.json(rows);
    });
});

app.post('/api/auth/create-medico', requireAdmin, async (req, res) => {
    const nombre = String(req.body.nombre || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!nombre || nombre.length < 2 || nombre.length > 80) {
        return res.status(400).send('El nombre del psiquiatra debe tener entre 2 y 80 caracteres.');
    }
    if (!EMAIL_REGEX.test(email) || email === ADMIN_EMAIL) {
        return res.status(400).send('Ingresa un correo válido para el psiquiatra (distinto al correo propietario).');
    }
    if (password.length < 8 || password.length > 128) {
        return res.status(400).send('La contraseña debe tener al menos 8 caracteres.');
    }

    try {
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const sql = `
            INSERT INTO Usuarios (nombre, email, password_hash, rol)
            VALUES (?, ?, ?, 'psiquiatra')
            ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), password_hash = VALUES(password_hash), rol = 'psiquiatra'
        `;
        db.query(sql, [nombre, email, passwordHash], (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error al guardar la cuenta del psiquiatra');
            }
            res.json({ message: 'Cuenta de psiquiatra (solo lectura) creada/actualizada correctamente.' });
        });
    } catch (e) {
        res.status(500).send('Error al cifrar la contraseña');
    }
});

app.delete('/api/auth/medicos/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).send('ID inválido');

    db.query('DELETE FROM Usuarios WHERE id = ? AND rol = "psiquiatra"', [id], (err, result) => {
        if (err) return res.status(500).send('Error al eliminar cuenta');
        if (result.affectedRows === 0) return res.status(404).send('Cuenta no encontrada');
        res.json({ message: 'Acceso de psiquiatra revocado correctamente' });
    });
});

// ==========================================
// RUTAS DE MOOD Y SUEÑO (PROTEGIDAS POR ROL)
// ==========================================
const MOMENTOS_VALIDOS = new Set(['Madrugada', 'Morning', 'Noon', 'Afternoon', 'Night']);
const CALIDADES_SUENO_VALIDAS = new Set(['Good', 'Regular', 'Bad']);
const FECHA_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

// Guardar el estado de ánimo (SOLO ADMIN)
app.post('/api/insert-mood', requireAdmin, (req, res) => {
    const { fecha, momento_dia, estado_animo, color_hex } = req.body;

    if (!fecha || !FECHA_ISO_REGEX.test(fecha)) {
        return res.status(400).send('Fecha inválida (formato esperado YYYY-MM-DD).');
    }
    if (!momento_dia || !MOMENTOS_VALIDOS.has(momento_dia)) {
        return res.status(400).send('Momento del día inválido.');
    }
    if (typeof estado_animo !== 'string' || !estado_animo.trim() || estado_animo.trim().length > 50) {
        return res.status(400).send('Estado de ánimo inválido.');
    }
    if (typeof color_hex !== 'string' || !HEX_COLOR_REGEX.test(color_hex)) {
        return res.status(400).send('Color hexadecimal inválido.');
    }

    const checkSql = 'SELECT * FROM RegistrosMood WHERE fecha = ? AND momento_dia = ?';

    db.query(checkSql, [fecha, momento_dia], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al consultar la base de datos');
        }

        if (result.length > 0) {
            if (puedeModificar(fecha, momento_dia)) {
                const sqlUpdate = 'UPDATE RegistrosMood SET estado_animo = ?, color_hex = ? WHERE fecha = ? AND momento_dia = ?';
                db.query(sqlUpdate, [estado_animo.trim(), color_hex, fecha, momento_dia], (errUpdate) => {
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
            db.query(sqlInsert, [fecha, momento_dia, estado_animo.trim(), color_hex], (errInsert) => {
                if (errInsert) {
                    console.error(errInsert);
                    return res.status(500).send('Error al guardar en la base de datos');
                }

                res.send('Estado de ánimo registrado correctamente');
            });
        }
    });
});

// Dar de alta un nuevo registro de sueño (SOLO ADMIN)
app.post('/api/insert-sleep', requireAdmin, (req, res) => {
    const { fecha, horas, calidad } = req.body;
    const horasNum = Number(horas);

    if (!fecha || !FECHA_ISO_REGEX.test(fecha)) {
        return res.status(400).send('Fecha inválida (formato esperado YYYY-MM-DD).');
    }
    if (!Number.isFinite(horasNum) || horasNum <= 0 || horasNum > 24) {
        return res.status(400).send('Las horas de sueño deben ser un número entre 0.1 y 24.');
    }
    if (!calidad || !CALIDADES_SUENO_VALIDAS.has(calidad)) {
        return res.status(400).send('Calidad de sueño inválida.');
    }

    const sql = 'INSERT INTO RegistrosSleep (fecha, horas, calidad) VALUES (?, ?, ?)';
    db.query(sql, [fecha, horasNum, calidad], (err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al guardar el registro de sueño');
        }
        res.send('Registro de sueño gruardado con éxito');
    });
});

// Consultar estados de ánimo (PERMITIDO A ADMIN Y PSIQUIATRA)
app.get('/api/get-moods', requireAuth, (req, res) => {
    const { begin, end } = req.query;

    const sql = 'SELECT fecha, momento_dia, color_hex FROM RegistrosMood WHERE fecha BETWEEN ? AND ?';

    db.query(sql, [begin, end], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error al consultar la base de datos');
        }
        res.json(result);
    });
});

// Consultar horas de sueño (PERMITIDO A ADMIN Y PSIQUIATRA)
app.get('/api/get-sleep', requireAuth, (req, res) => {
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

// Memoria temporal para guardar los textos cifrados hacia Word PC
let colaDeTextos = [];

// Enviar nota cifrada a la cola (SOLO ADMIN)
app.post('/api/send-to-pc', requireAdmin, (req, res) => {
    const { texto } = req.body;
    if (texto) {
        colaDeTextos.push(texto);
        res.send('Texto encolado esperando a tu PC');
    } else {
        res.status(400).send('El texto no puede estar vacío');
    }
});

// Ruta para que tu PC consulte si hay textos nuevos (el contenido viaja cifrado en AES-256)
app.get('/api/pull-text', (req, res) => {
    res.json(colaDeTextos);
    colaDeTextos = [];
});

// ==========================================
// RUTAS PARA LA AGENDA PERSONAL SEMANAL (SOLO ADMIN)
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

app.get('/api/get-agenda', requireAdmin, (req, res) => {
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

app.post('/api/insert-agenda', requireAdmin, (req, res) => {
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

app.put('/api/update-agenda/:id', requireAdmin, (req, res) => {
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

app.patch('/api/toggle-agenda/:id', requireAdmin, (req, res) => {
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

app.delete('/api/delete-agenda/:id', requireAdmin, (req, res) => {
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
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error(`\n[CRASH] ${new Date().toISOString()} - Promesa no manejada:`, reason);
    process.exit(1);
});
