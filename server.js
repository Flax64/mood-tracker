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

// Rate limiter en memoria con limpieza automática para evitar fugas de RAM
const rateLimitStore = new Map();
const MAX_RATE_LIMIT_ENTRIES = 300;

function pruneRateLimitStore(now = Date.now()) {
    for (const [k, rec] of rateLimitStore.entries()) {
        if (now > rec.resetAt) {
            rateLimitStore.delete(k);
        }
    }
}

setInterval(() => pruneRateLimitStore(), 15 * 60 * 1000).unref();

function checkRateLimit(key, maxAttempts = 10, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    if (rateLimitStore.size > MAX_RATE_LIMIT_ENTRIES) {
        pruneRateLimitStore(now);
        if (rateLimitStore.size > MAX_RATE_LIMIT_ENTRIES) {
            const oldestKey = rateLimitStore.keys().next().value;
            if (oldestKey !== undefined) rateLimitStore.delete(oldestKey);
        }
    }

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

// Limpieza periódica de sesiones y códigos vencidos para ahorrar espacio en MySQL
function limpiarRegistrosExpirados() {
    const nowSql = formatMySqlDateTime(new Date());
    db.query('DELETE FROM SesionesAuth WHERE expira_en <= ?', [nowSql], () => {});
    db.query('DELETE FROM CodigosSeguridad WHERE usado = 1 OR expira_en <= ?', [nowSql], () => {});
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
            from: `"Personal Mood Tracker" <${fromUser}>`,
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

// Middleware de autenticación
function requireAuth(req, res, next) {
    const cookies = parseCookies(req);
    const rawToken = cookies.mt_session;
    if (!rawToken || rawToken.length < 32) {
        return res.status(401).send('Session not started or expired.');
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
            return res.status(500).send('Error verifying session.');
        }
        if (!rows || rows.length === 0) {
            clearSessionCookie(res);
            return res.status(401).send('Your session has expired. Please sign in again.');
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
            return res.status(403).send('Read-only access: this account can only view the weekly summary.');
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
        return res.status(429).send('Too many attempts. Please wait a few minutes.');
    }

    const emailSolicitante = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(emailSolicitante)) {
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
                    subject: 'Verification Code - Personal Mood Tracker',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
                            <h2 style="color: #1e2430; margin-top: 0;">Registration Verification</h2>
                            <p>A registration request was submitted for <strong>${emailSolicitante}</strong> with role <strong>${rolSolicitado}</strong>.</p>
                            <p>Your authorization code (valid for 15 minutes) is:</p>
                            <div style="font-size: 28px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 14px; background: #f3f4f6; border-radius: 8px; color: #111827;">
                                ${codigo}
                            </div>
                        </div>
                    `
                });
                res.json({ message: 'Verification code sent to the owner email configured on the server.' });
            } catch (mailErr) {
                console.error(mailErr.message);
                res.status(500).send(
                    mailErr.message + ' You can also register using your personal secret key in the validation field.'
                );
            }
        }
    );
});

// Registro de usuario por primera vez (valida correo o clave secreta personal)
app.post('/api/auth/register', (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`register:${ip}`, 8, 15 * 60 * 1000)) {
        return res.status(429).send('Too many registration attempts. Please wait 15 minutes.');
    }

    const nombre = String(req.body.nombre || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const codigoValidacion = String(req.body.codigoValidacion || '').trim();

    if (!nombre || nombre.length < 2 || nombre.length > 80) {
        return res.status(400).send('Name must be between 2 and 80 characters.');
    }
    if (!EMAIL_REGEX.test(email) || email.length > 150) {
        return res.status(400).send('Invalid email address.');
    }
    if (password.length < 8 || password.length > 128) {
        return res.status(400).send('Password must be at least 8 characters long.');
    }
    if (!codigoValidacion) {
        return res.status(400).send('Enter the verification code or your personal secret key.');
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
                                    return res.status(500).send('Account created, but an error occurred while signing in.');
                                }
                                setSessionCookie(res, rawToken, expiresAt);
                                res.status(201).json({
                                    message: 'Account verified and created successfully.',
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

// Inicio de sesión
app.post('/api/auth/login', (req, res) => {
    const ip = req.ip || 'unknown';
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!checkRateLimit(`login:${ip}:${email}`, 10, 15 * 60 * 1000)) {
        return res.status(429).send('Too many failed attempts. Please wait 15 minutes.');
    }

    if (!EMAIL_REGEX.test(email) || !password) {
        return res.status(400).send('Enter your email and password.');
    }

    db.query('SELECT id, nombre, email, password_hash, rol FROM Usuarios WHERE email = ? LIMIT 1', [email], async (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database query error.');
        }
        if (!rows || rows.length === 0) {
            return res.status(401).send('Incorrect email or password.');
        }

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).send('Incorrect email or password.');
        }

        resetRateLimit(`login:${ip}:${email}`);

        // Limpiar sesiones/códigos vencidos y crear nueva sesión válida hasta el próximo domingo 00:00
        limpiarRegistrosExpirados();

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
                    return res.status(500).send('Error creating session.');
                }
                setSessionCookie(res, rawToken, expiresAt);
                res.json({
                    message: 'Signed in successfully.',
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
        return res.json({ message: 'Signed out.' });
    }

    const tokenHash = sha256Hex(rawToken);
    db.query('DELETE FROM SesionesAuth WHERE token_hash = ?', [tokenHash], () => {
        res.json({ message: 'Signed out successfully.' });
    });
});

// Solicitar enlace de recuperación de contraseña por correo
app.post('/api/auth/forgot-password', (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`forgot:${ip}`, 5, 15 * 60 * 1000)) {
        return res.status(429).send('Too many requests. Please wait 15 minutes.');
    }

    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
        return res.status(400).send('Please enter a valid email address.');
    }

    db.query('SELECT id, nombre, email FROM Usuarios WHERE email = ? LIMIT 1', [email], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error processing request.');
        }
        if (!rows || rows.length === 0) {
            return res.json({ message: 'If this email is registered, you will receive a password reset link.' });
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
                        subject: 'Password Recovery - Personal Mood Tracker',
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 22px; border: 1px solid #e5e7eb; border-radius: 12px;">
                                <h2 style="color: #1e2430; margin-top: 0;">Reset Password</h2>
                                <p>Hello <strong>${escapeHtml(user.nombre)}</strong>,</p>
                                <p>You requested a password reset on Personal Mood Tracker. Click the button below (valid for 30 minutes):</p>
                                <p style="text-align: center; margin: 26px 0;">
                                    <a href="${resetUrl}" style="background: #1e2430; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: bold; display: inline-block;">
                                        Reset My Password
                                    </a>
                                </p>
                                <p style="font-size: 12px; color: #6b7280;">If you did not request this change, you can safely ignore this message.</p>
                            </div>
                        `
                    });
                    res.json({ message: 'We sent a reset link to your email address.' });
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
        return res.status(429).send('Too many attempts. Please wait 15 minutes.');
    }

    const email = String(req.body.email || '').trim().toLowerCase();
    const token = String(req.body.token || '').trim();
    const newPassword = String(req.body.newPassword || '');

    if (!EMAIL_REGEX.test(email) || !token || token.length < 32) {
        return res.status(400).send('Invalid recovery link.');
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
        return res.status(400).send('New password must be at least 8 characters long.');
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

// Gestión de cuenta del Psiquiatra desde la cuenta de Flavio (admin)
app.get('/api/auth/medicos', requireAdmin, (req, res) => {
    db.query('SELECT id, nombre, email, fecha_registro FROM Usuarios WHERE rol = "psiquiatra" ORDER BY id DESC', (err, rows) => {
        if (err) return res.status(500).send('Error loading psychiatrist accounts.');
        res.json(rows);
    });
});

app.post('/api/auth/create-medico', requireAdmin, async (req, res) => {
    const nombre = String(req.body.nombre || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!nombre || nombre.length < 2 || nombre.length > 80) {
        return res.status(400).send('Doctor name must be between 2 and 80 characters.');
    }
    if (!EMAIL_REGEX.test(email) || email === ADMIN_EMAIL) {
        return res.status(400).send('Enter a valid psychiatrist email (different from owner email).');
    }
    if (password.length < 8 || password.length > 128) {
        return res.status(400).send('Password must be at least 8 characters long.');
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
                return res.status(500).send('Error saving psychiatrist account.');
            }
            res.json({ message: 'Psychiatrist account (read-only) saved successfully.' });
        });
    } catch (e) {
        res.status(500).send('Error hashing password.');
    }
});

app.delete('/api/auth/medicos/:id', requireAdmin, (req, res) => {
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
const FECHA_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

// Guardar el estado de ánimo (SOLO ADMIN)
app.post('/api/insert-mood', requireAdmin, (req, res) => {
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

// Dar de alta un nuevo registro de sueño (SOLO ADMIN)
app.post('/api/insert-sleep', requireAdmin, (req, res) => {
    const { fecha, horas, calidad } = req.body;
    const horasNum = Number(horas);

    if (!fecha || !FECHA_ISO_REGEX.test(fecha)) {
        return res.status(400).send('Invalid date (expected YYYY-MM-DD).');
    }
    if (!Number.isFinite(horasNum) || horasNum <= 0 || horasNum > 24) {
        return res.status(400).send('Sleep hours must be a number between 0.1 and 24.');
    }
    if (!calidad || !CALIDADES_SUENO_VALIDAS.has(calidad)) {
        return res.status(400).send('Invalid sleep quality.');
    }

    const sql = 'INSERT INTO RegistrosSleep (fecha, horas, calidad) VALUES (?, ?, ?)';
    db.query(sql, [fecha, horasNum, calidad], (err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error saving sleep record.');
        }
        res.send('Sleep record saved successfully.');
    });
});

// Consultar estados de ánimo (PERMITIDO A ADMIN Y PSIQUIATRA)
app.get('/api/get-moods', requireAuth, (req, res) => {
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

// Consultar horas de sueño (PERMITIDO A ADMIN Y PSIQUIATRA)
app.get('/api/get-sleep', requireAuth, (req, res) => {
    const { begin, end } = req.query;
    if (!begin || !end || !FECHA_ISO_REGEX.test(begin) || !FECHA_ISO_REGEX.test(end)) {
        return res.status(400).send('Parameters begin and end are required (YYYY-MM-DD).');
    }

    const sql = 'SELECT fecha, horas, calidad FROM RegistrosSleep WHERE fecha BETWEEN ? AND ?';

    db.query(sql, [begin, end], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database query error.');
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
app.post('/api/send-to-pc', requireAdmin, journalQueue.enqueue);

// Ruta para que tu PC consulte notas de Journal pendientes (el contenido viaja cifrado E2EE)
app.get('/api/pull-text', journalQueue.pull);

// Enviar entrada cifrada de English Learning Notebook a la cola (SOLO ADMIN, sin guardar en MySQL)
app.post('/api/send-english', requireAdmin, englishQueue.enqueue);

// Ruta para que tu PC consulte entradas de inglés pendientes (el contenido viaja cifrado E2EE)
app.get('/api/pull-english', englishQueue.pull);

// ==========================================
// RUTAS PARA LA AGENDA PERSONAL SEMANAL (SOLO ADMIN)
// ==========================================
const BLOQUES_VALIDOS = new Set(['manana', 'cole', 'tarde', 'noche']);

function validarDatosAgenda({ fecha, bloque, hora, actividad }) {
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return 'Date must use YYYY-MM-DD format.';
    }
    if (!bloque || !BLOQUES_VALIDOS.has(bloque)) {
        return 'Invalid day block.';
    }
    if (!hora || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(hora)) {
        return 'Time must use HH:MM format.';
    }
    if (typeof actividad !== 'string' || !actividad.trim()) {
        return 'Activity description is required.';
    }
    if (actividad.trim().length > 255) {
        return 'Activity cannot exceed 255 characters.';
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
        return res.status(400).send('Parameters begin and end are required (YYYY-MM-DD).');
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
            return res.status(500).send('Error querying agenda from database.');
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
                completada: 0
            }
        });
    });
});

app.put('/api/update-agenda/:id', requireAdmin, (req, res) => {
    const id = parseAgendaId(req.params.id);
    if (!id) return res.status(400).send('Invalid activity ID.');

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
            return res.status(500).send('Error updating activity.');
        }
        if (result.affectedRows === 0) {
            return res.status(404).send('Activity not found.');
        }
        res.json({
            message: 'Activity updated successfully.',
            item: { id, fecha, bloque, hora: horaNormalizada, actividad }
        });
    });
});

app.patch('/api/toggle-agenda/:id', requireAdmin, (req, res) => {
    const id = parseAgendaId(req.params.id);
    if (!id) return res.status(400).send('Invalid activity ID.');

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
            return res.status(500).send('Error updating activity status.');
        }
        if (result.affectedRows === 0) {
            return res.status(404).send('Activity not found.');
        }
        res.json({ message: 'Status updated.', id, completada });
    });
});

app.delete('/api/delete-agenda/:id', requireAdmin, (req, res) => {
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
        res.json({ message: 'Activity deleted successfully.', id });
    });
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
