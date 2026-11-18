'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

const LEVELS = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    crash: 50
};

const SENSITIVE_QUERY_KEYS = new Set([
    'token',
    'code',
    'password',
    'pass',
    'secret',
    'apikey',
    'api_key',
    'key',
    'sig',
    'signature'
]);

function isAutomatedTestEnv(env = process.env) {
    if (String(env.DISABLE_FILE_LOGS || '').toLowerCase() === 'true') return true;
    if (String(env.NODE_ENV || '').toLowerCase() === 'test') return true;
    if (Array.isArray(process.execArgv) && process.execArgv.some((a) => a === '--test' || a.startsWith('--test-'))) {
        return true;
    }
    if (Array.isArray(process.argv) && process.argv.some((a) => /\.test\.js$/i.test(String(a || '')))) {
        return true;
    }
    return false;
}

function normalizeLevel(rawLevel) {
    const low = String(rawLevel || 'info').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(LEVELS, low) ? low : 'info';
}

function formatLocalTimestamp(date = new Date(), timeZone = process.env.TZ || '') {
    try {
        if (timeZone) {
            const parts = new Intl.DateTimeFormat('sv-SE', {
                timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).format(date);
            const ms = String(date.getMilliseconds()).padStart(3, '0');
            return `${parts}.${ms}`;
        }
    } catch (_) {}
    return date.toISOString();
}

function sanitizeUrlForLog(rawUrl) {
    const raw = String(rawUrl || '/');
    const qIdx = raw.indexOf('?');
    if (qIdx < 0) return raw;
    const base = raw.slice(0, qIdx);
    const qs = raw.slice(qIdx + 1);
    try {
        const params = new URLSearchParams(qs);
        let changed = false;
        for (const [k] of params.entries()) {
            if (SENSITIVE_QUERY_KEYS.has(k.toLowerCase())) {
                params.set(k, '[REDACTED]');
                changed = true;
            }
        }
        if (!changed) return raw;
        const rebuilt = params.toString();
        return rebuilt ? `${base}?${rebuilt}` : base;
    } catch (_) {
        return base;
    }
}

function sanitizeMessageText(text) {
    return String(text || '')
        .replace(/([?&](?:token|code|password|api_?key|secret|sig)=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/(mt_session=)[^;\s]+/gi, '$1[REDACTED]')
        .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');
}

function rotateFileIfNeeded(filePath, incomingBytes, maxBytes, maxFiles) {
    if (!fs.existsSync(filePath)) return;
    let size = 0;
    try {
        size = fs.statSync(filePath).size;
    } catch (_) {
        return;
    }
    if (size + incomingBytes < maxBytes) return;

    const keep = Math.max(1, Number(maxFiles) || 5);
    const oldest = `${filePath}.${keep}`;
    try {
        if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    } catch (_) {}

    for (let i = keep - 1; i >= 1; i -= 1) {
        const src = `${filePath}.${i}`;
        const dst = `${filePath}.${i + 1}`;
        try {
            if (fs.existsSync(src)) fs.renameSync(src, dst);
        } catch (_) {}
    }

    try {
        fs.renameSync(filePath, `${filePath}.1`);
    } catch (_) {}
}

function createServerLogger(opts = {}) {
    const env = opts.env || process.env;
    const rootDir = opts.rootDir || path.resolve(__dirname, '..');
    const logDir = opts.logDir
        ? path.resolve(String(opts.logDir))
        : (String(env.LOG_DIR || '').trim()
            ? path.resolve(String(env.LOG_DIR).trim())
            : path.join(rootDir, 'logs'));
    const minLevel = normalizeLevel(opts.level || env.LOG_LEVEL || 'info');
    const minScore = LEVELS[minLevel];
    const maxBytes = Math.max(64 * 1024, Number.parseInt(String(opts.maxBytes ?? env.LOG_MAX_BYTES ?? 5 * 1024 * 1024), 10) || 5 * 1024 * 1024);
    const maxFiles = Math.max(1, Math.min(20, Number.parseInt(String(opts.maxFiles ?? env.LOG_MAX_FILES ?? 5), 10) || 5));

    const fileEnabled = typeof opts.enableFileLogging === 'boolean'
        ? opts.enableFileLogging
        : !isAutomatedTestEnv(env);

    const serverLogPath = path.join(logDir, 'server.log');
    const errorLogPath = path.join(logDir, 'error.log');

    const rawStdoutWrite = opts.stdoutWrite || ((line) => process.stdout.write(`${line}\n`));
    const rawStderrWrite = opts.stderrWrite || ((line) => process.stderr.write(`${line}\n`));

    let dirReady = false;
    function ensureLogDir() {
        if (!fileEnabled || dirReady) return fileEnabled;
        try {
            fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
            try { fs.chmodSync(logDir, 0o700); } catch (_) {}
            dirReady = true;
            return true;
        } catch (_) {
            return false;
        }
    }

    function appendRotating(targetPath, line) {
        if (!ensureLogDir()) return;
        const payload = `${line}\n`;
        const byteLen = Buffer.byteLength(payload, 'utf8');
        try {
            rotateFileIfNeeded(targetPath, byteLen, maxBytes, maxFiles);
            fs.appendFileSync(targetPath, payload, { encoding: 'utf8', mode: 0o600 });
        } catch (_) {}
    }

    function formatMeta(meta) {
        if (!meta || typeof meta !== 'object') return '';
        const pairs = [];
        for (const [k, v] of Object.entries(meta)) {
            if (v === undefined || v === null || v === '') continue;
            const cleanVal = typeof v === 'string'
                ? sanitizeMessageText(v).replace(/\s+/g, ' ').trim().slice(0, 220)
                : String(v);
            pairs.push(`${k}=${cleanVal}`);
        }
        return pairs.length ? ` | ${pairs.join(' ')}` : '';
    }

    let writingInternal = false;

    function writeEntry(levelName, category, message, meta = null, { writeConsole = true } = {}) {
        const lvl = normalizeLevel(levelName);
        if (LEVELS[lvl] < minScore) return null;
        if (writingInternal) return null;

        writingInternal = true;
        try {
            const ts = formatLocalTimestamp(new Date(), env.TZ);
            const cat = String(category || 'SYSTEM').toUpperCase();
            const cleanMsg = sanitizeMessageText(message);
            const metaStr = formatMeta(meta);
            const line = `[${ts}] [${lvl.toUpperCase()}] [${cat}] ${cleanMsg}${metaStr}`;

            if (writeConsole) {
                if (LEVELS[lvl] >= LEVELS.warn) {
                    rawStderrWrite(line);
                } else {
                    rawStdoutWrite(line);
                }
            }

            if (fileEnabled) {
                appendRotating(serverLogPath, line);
                if (LEVELS[lvl] >= LEVELS.warn) {
                    appendRotating(errorLogPath, line);
                }
            }
            return line;
        } finally {
            writingInternal = false;
        }
    }

    let consoleTeed = false;
    function installConsoleTee() {
        if (consoleTeed || isAutomatedTestEnv(env)) return;
        consoleTeed = true;
        const origLog = console.log.bind(console);
        const origInfo = console.info.bind(console);
        const origWarn = console.warn.bind(console);
        const origError = console.error.bind(console);

        const forward = (lvl, origFn, args) => {
            if (writingInternal) return origFn(...args);
            const rendered = util.format(...args);
            const line = writeEntry(lvl, 'CONSOLE', rendered, null, { writeConsole: false });
            if (line) {
                origFn(line);
            } else {
                origFn(...args);
            }
        };

        console.log = (...args) => forward('info', origLog, args);
        console.info = (...args) => forward('info', origInfo, args);
        console.warn = (...args) => forward('warn', origWarn, args);
        console.error = (...args) => forward('error', origError, args);
    }

    function createHttpLoggerMiddleware() {
        return function httpAuditLogger(req, res, next) {
            const reqPath = String(req.path || '');
            if (!reqPath.startsWith('/api/')) {
                return next();
            }
            const startedAt = process.hrtime.bigint();
            res.on('finish', () => {
                const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
                const status = res.statusCode || 200;
                const level = status >= 500 ? 'error' : (status >= 400 ? 'warn' : 'info');
                const rawIp = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
                const cleanIp = String(rawIp).replace(/^::ffff:/, '');
                writeEntry(
                    level,
                    'HTTP',
                    `${req.method} ${sanitizeUrlForLog(req.originalUrl || reqPath)} -> ${status}`,
                    {
                        ms: elapsedMs.toFixed(1),
                        ip: cleanIp,
                        uid: req.user?.id,
                        rol: req.user?.rol
                    }
                );
            });
            return next();
        };
    }

    function getRecentLogTail({ kind = 'server', lines = 120 } = {}) {
        const cleanKind = kind === 'error' ? 'error' : 'server';
        const target = cleanKind === 'error' ? errorLogPath : serverLogPath;
        const maxLines = Math.max(1, Math.min(500, Number.parseInt(String(lines || 120), 10) || 120));
        if (!fileEnabled || !fs.existsSync(target)) {
            return { ok: true, kind: cleanKind, fileEnabled, exists: false, lines: [] };
        }
        try {
            const st = fs.statSync(target);
            const readSize = Math.min(st.size, 256 * 1024);
            const fd = fs.openSync(target, 'r');
            const buf = Buffer.alloc(readSize);
            try {
                fs.readSync(fd, buf, 0, readSize, Math.max(0, st.size - readSize));
            } finally {
                fs.closeSync(fd);
            }
            const rawLines = buf.toString('utf8').split(/\r?\n/).filter(Boolean);
            return {
                ok: true,
                kind: cleanKind,
                fileEnabled,
                exists: true,
                sizeBytes: st.size,
                lines: rawLines.slice(-maxLines)
            };
        } catch (err) {
            return { ok: false, kind: cleanKind, fileEnabled, exists: true, error: err.message, lines: [] };
        }
    }

    return {
        logDir,
        serverLogPath,
        errorLogPath,
        fileEnabled,
        info: (cat, msg, meta) => writeEntry('info', cat, msg, meta),
        warn: (cat, msg, meta) => writeEntry('warn', cat, msg, meta),
        error: (cat, msg, meta) => writeEntry('error', cat, msg, meta),
        crash: (cat, msg, meta) => writeEntry('crash', cat, msg, meta),
        installConsoleTee,
        createHttpLoggerMiddleware,
        getRecentLogTail
    };
}

module.exports = {
    createServerLogger,
    sanitizeUrlForLog,
    sanitizeMessageText,
    isAutomatedTestEnv
};
