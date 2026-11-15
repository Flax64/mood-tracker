const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const ROOT = path.resolve(__dirname, '..');

function request({ port, method = 'GET', reqPath = '/', headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
        const reqHeaders = { ...headers };
        let payload = null;
        if (body !== null) {
            payload = JSON.stringify(body);
            reqHeaders['Content-Type'] = 'application/json';
            reqHeaders['Content-Length'] = Buffer.byteLength(payload);
        }
        const req = http.request(
            { hostname: '127.0.0.1', port, path: reqPath, method, headers: reqHeaders },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf8')
                    });
                });
            }
        );
        req.on('error', reject);
        if (payload !== null) req.write(payload);
        req.end();
    });
}

describe('API y seguridad de server.js (pruebas de integración)', () => {
    let port;
    let capturedServer = null;
    let capturedPoolConfig = null;
    let origLoad;
    let origListen;
    let adminCookie;
    let medicoCookie;

    const queryLog = [];
    const sessions = new Map();
    const moodInserts = [];
    const sleepInserts = [];
    const agendaInserts = [];
    const userSettingsMap = new Map();
    const reminderStatesMap = new Map();
    const musicArtists = [];
    const musicAlbums = [];
    const musicSongs = [];
    const musicSongArtists = [];

    const testHash = bcrypt.hashSync('ClavePrueba2026!', 4);
    const users = [
        { id: 1, nombre: 'Flavio', email: 'admin@example.com', password_hash: testHash, rol: 'admin', estado: 'activo' },
        { id: 2, nombre: 'Dr. Perez', email: 'medico@example.com', password_hash: testHash, rol: 'psiquiatra', estado: 'activo' },
        { id: 3, nombre: 'Dr. Suspendido', email: 'suspendido@example.com', password_hash: testHash, rol: 'psiquiatra', estado: 'suspendido' }
    ];

    before(async () => {
        process.env.PORT = '0';
        process.env.DB_HOST = 'localhost';
        process.env.DB_USER = 'test';
        process.env.DB_PASSWORD = 'test';
        process.env.DB_NAME = 'test_db';
        process.env.ADMIN_EMAIL = 'admin@example.com';
        process.env.ADMIN_SECRET = 'secreto-test';
        process.env.SMTP_USER = 'smtp@example.com';
        process.env.SMTP_PASS = 'abcdefghijklmnop';
        process.env.DISABLE_REMINDER_SCHEDULER = 'true';

        const mockDb = {
            query(sql, paramsOrCb, maybeCb) {
                const params = Array.isArray(paramsOrCb) ? paramsOrCb : [];
                const cb = typeof paramsOrCb === 'function' ? paramsOrCb : maybeCb;
                const normalized = String(sql).replace(/\s+/g, ' ').trim();
                queryLog.push({ sql: normalized, params });

                const finish = (err, rows = []) => {
                    if (cb) process.nextTick(() => cb(err, rows));
                };

                if (normalized.startsWith('SELECT s.id AS sesion_id')) {
                    const [tokenHash, nowSql] = params;
                    const ses = sessions.get(tokenHash);
                    if (!ses || ses.expira_en <= nowSql) return finish(null, []);
                    const u = users.find((x) => x.id === ses.usuario_id);
                    if (!u) return finish(null, []);
                    return finish(null, [{
                        sesion_id: ses.id,
                        expira_en: ses.expira_en,
                        id: u.id,
                        nombre: u.nombre,
                        email: u.email,
                        rol: u.rol,
                        estado: u.estado
                    }]);
                }

                if (normalized.startsWith('SELECT id, nombre, email, COALESCE(estado')) {
                    return finish(null, users.filter((x) => x.rol === 'psiquiatra'));
                }

                if (normalized.startsWith('UPDATE Usuarios SET estado = ?')) {
                    const [estado, id] = params;
                    const u = users.find((x) => x.id === Number(id) && x.rol === 'psiquiatra');
                    if (!u) return finish(null, { affectedRows: 0 });
                    u.estado = estado;
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith('DELETE FROM SesionesAuth WHERE usuario_id = ?')) {
                    const targetUserId = Number(params[0]);
                    for (const [k, s] of sessions.entries()) {
                        if (s.usuario_id === targetUserId) sessions.delete(k);
                    }
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith('SHOW COLUMNS FROM RegistrosAgenda')) {
                    return finish(null, [
                        { Field: 'tipo' },
                        { Field: 'categoria' },
                        { Field: 'estado' },
                        { Field: 'recordatorio_min' }
                    ]);
                }

                if (normalized.startsWith('SELECT id, rol, estado FROM Usuarios WHERE id = ?')) {
                    const targetId = Number(params[0]);
                    const u = users.find((x) => x.id === targetId);
                    return finish(null, u ? [u] : []);
                }

                if (normalized.includes('FROM Usuarios') && normalized.includes("rol = 'admin'")) {
                    const admins = users.filter((x) => x.rol === 'admin' && (x.estado || 'activo') === 'activo');
                    return finish(null, admins);
                }

                if (normalized.includes('FROM Usuarios') && normalized.includes('WHERE')) {
                    const email = String(params[0] || '').toLowerCase();
                    const u = users.find((x) => x.email === email);
                    return finish(null, u ? [u] : []);
                }

                if (normalized.startsWith('INSERT INTO SesionesAuth')) {
                    const [usuario_id, token_hash, expira_en] = params;
                    sessions.set(token_hash, { id: sessions.size + 1, usuario_id, token_hash, expira_en });
                    return finish(null, { insertId: sessions.size });
                }

                if (normalized.startsWith('DELETE FROM SesionesAuth WHERE token_hash = ?')) {
                    sessions.delete(params[0]);
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith('INSERT INTO RegistrosMood')) {
                    moodInserts.push({
                        fecha: params[0],
                        momento_dia: params[1],
                        estado_animo: params[2],
                        color_hex: params[3]
                    });
                    return finish(null, { insertId: moodInserts.length });
                }

                if (normalized.startsWith('SELECT * FROM RegistrosMood WHERE fecha = ?')) {
                    const existing = moodInserts.filter((m) => m.fecha === params[0] && m.momento_dia === params[1]);
                    return finish(null, existing);
                }

                if (normalized.startsWith('SELECT momento_dia FROM RegistrosMood WHERE fecha = ?')) {
                    const existing = moodInserts.filter((m) => m.fecha === params[0]);
                    return finish(null, existing);
                }

                if (normalized.startsWith('SELECT fecha, momento_dia, color_hex FROM RegistrosMood')) {
                    return finish(null, moodInserts);
                }

                if (normalized.startsWith('INSERT INTO RegistrosSleep')) {
                    sleepInserts.push({ id: sleepInserts.length + 1, fecha: params[0], horas: params[1], calidad: params[2] });
                    return finish(null, { insertId: sleepInserts.length });
                }

                if (normalized.startsWith('SELECT id FROM RegistrosSleep WHERE fecha = ?')) {
                    const existing = sleepInserts.filter((s) => s.fecha === params[0]);
                    return finish(null, existing);
                }

                if (normalized.includes('FROM RegistrosSleep')) {
                    return finish(null, sleepInserts);
                }

                if (normalized.startsWith('INSERT INTO RegistrosAgenda')) {
                    const newItem = {
                        id: agendaInserts.length + 1,
                        fecha: params[0],
                        bloque: params[1],
                        hora: params[2],
                        actividad: params[3],
                        tipo: params[4] || 'evento',
                        categoria: params[5] || 'personal',
                        estado: params[6] || 'todo',
                        completada: params[7] ?? 0,
                        recordatorio_min: params[8] ?? null
                    };
                    agendaInserts.push(newItem);
                    return finish(null, { insertId: newItem.id });
                }

                if (normalized.includes('FROM RegistrosAgenda') && normalized.includes('WHERE fecha BETWEEN ? AND ?')) {
                    const [begin, end] = params;
                    return finish(null, agendaInserts.filter((a) => a.fecha >= begin && a.fecha <= end));
                }

                if (normalized.includes('FROM RegistrosAgenda') && normalized.includes('WHERE fecha = ?')) {
                    return finish(null, agendaInserts.filter((a) => a.fecha === params[0]));
                }

                if (normalized.startsWith('UPDATE RegistrosAgenda SET fecha = ?')) {
                    const id = Number(params[9]);
                    const item = agendaInserts.find((a) => a.id === id);
                    if (!item) return finish(null, { affectedRows: 0 });
                    item.fecha = params[0];
                    item.bloque = params[1];
                    item.hora = params[2];
                    item.actividad = params[3];
                    item.tipo = params[4];
                    item.categoria = params[5];
                    item.estado = params[6];
                    item.completada = params[7];
                    item.recordatorio_min = params[8];
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith('UPDATE RegistrosAgenda SET estado = ?, completada = ? WHERE id = ?')) {
                    const id = Number(params[2]);
                    const item = agendaInserts.find((a) => a.id === id);
                    if (!item) return finish(null, { affectedRows: 0 });
                    item.estado = params[0];
                    item.completada = params[1];
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith('UPDATE RegistrosAgenda SET completada = NOT completada')) {
                    const id = Number(params[0]);
                    const item = agendaInserts.find((a) => a.id === id);
                    if (!item) return finish(null, { affectedRows: 0 });
                    item.completada = item.completada ? 0 : 1;
                    item.estado = item.completada ? 'done' : 'todo';
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith('DELETE FROM RegistrosAgenda WHERE id = ?')) {
                    const idx = agendaInserts.findIndex((a) => a.id === Number(params[0]));
                    if (idx === -1) return finish(null, { affectedRows: 0 });
                    agendaInserts.splice(idx, 1);
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith('SELECT config_json FROM ConfiguracionUsuario WHERE usuario_id = ?')) {
                    const cfg = userSettingsMap.get(Number(params[0]));
                    return finish(null, cfg ? [{ config_json: cfg }] : []);
                }

                if (normalized.startsWith('INSERT INTO ConfiguracionUsuario')) {
                    userSettingsMap.set(Number(params[0]), params[1]);
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith('SELECT clave_unica, tipo, titulo, mensaje, estado, snooze_hasta, enviado_push_en FROM RecordatoriosEstado')) {
                    const uid = Number(params[0]);
                    const rows = [...reminderStatesMap.values()].filter((r) => r.usuario_id === uid);
                    return finish(null, rows);
                }

                if (normalized.startsWith('INSERT INTO RecordatoriosEstado')) {
                    const [uid, key, tipo, refId, titulo, mensaje] = params;
                    const isDismiss = normalized.includes("'dismissed'");
                    const isSnooze = normalized.includes("'snoozed'");
                    const estado = isDismiss ? 'dismissed' : (isSnooze ? 'snoozed' : 'active');
                    const snoozeHasta = isSnooze ? params[6] : null;
                    const pushAt = !isDismiss && !isSnooze ? params[6] : null;
                    reminderStatesMap.set(`${uid}:${key}`, {
                        usuario_id: Number(uid),
                        clave_unica: key,
                        tipo,
                        ref_id: refId,
                        titulo,
                        mensaje,
                        estado,
                        snooze_hasta: snoozeHasta,
                        enviado_push_en: pushAt
                    });
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith("UPDATE RecordatoriosEstado SET estado = 'dismissed' WHERE ref_id = ?")) {
                    const targetRefId = Number(params[0]);
                    for (const val of reminderStatesMap.values()) {
                        if (Number(val.ref_id) === targetRefId && val.tipo === 'agenda') {
                            val.estado = 'dismissed';
                        }
                    }
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith('DELETE FROM RecordatoriosEstado WHERE ref_id = ?')) {
                    const targetRefId = Number(params[0]);
                    for (const [k, val] of reminderStatesMap.entries()) {
                        if (Number(val.ref_id) === targetRefId && val.tipo === 'agenda') {
                            reminderStatesMap.delete(k);
                        }
                    }
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith('SELECT id FROM MusicaArtistas WHERE usuario_id = ? AND nombre_normalizado = ?')) {
                    const [uid, norm] = params;
                    const match = musicArtists.find((a) => a.usuario_id === Number(uid) && a.nombre_normalizado === norm);
                    return finish(null, match ? [{ id: match.id }] : []);
                }

                if (normalized.startsWith('INSERT INTO MusicaArtistas')) {
                    const [uid, nombre, norm, tipo] = params;
                    const id = musicArtists.length + 1;
                    musicArtists.push({
                        id,
                        usuario_id: Number(uid),
                        nombre,
                        nombre_normalizado: norm,
                        tipo_artista: tipo || 'solo',
                        notas_cortas: null,
                        creado_en: '2026-11-14 16:00:00'
                    });
                    return finish(null, { insertId: id });
                }

                if (normalized.startsWith('SELECT id FROM MusicaAlbumes WHERE usuario_id = ? AND titulo_normalizado = ?')) {
                    const [uid, norm, mainId] = params;
                    const match = musicAlbums.find(
                        (al) =>
                            al.usuario_id === Number(uid) &&
                            al.titulo_normalizado === norm &&
                            Number(al.artista_principal_id || 0) === Number(mainId || 0)
                    );
                    return finish(null, match ? [{ id: match.id }] : []);
                }

                if (normalized.startsWith('UPDATE MusicaAlbumes SET tipo_lanzamiento = ?')) {
                    const [tipo, anio, albumId, uid] = params;
                    const alb = musicAlbums.find((a) => a.id === Number(albumId) && a.usuario_id === Number(uid));
                    if (alb) {
                        alb.tipo_lanzamiento = tipo;
                        if (anio !== null && anio !== undefined) alb.anio = anio;
                    }
                    return finish(null, { affectedRows: alb ? 1 : 0 });
                }

                if (normalized.startsWith('INSERT INTO MusicaAlbumes')) {
                    const [uid, mainArtistId, titulo, norm, tipo, anio] = params;
                    const id = musicAlbums.length + 1;
                    musicAlbums.push({
                        id,
                        usuario_id: Number(uid),
                        artista_principal_id: mainArtistId || null,
                        titulo,
                        titulo_normalizado: norm,
                        tipo_lanzamiento: tipo || 'album',
                        anio: anio || null,
                        notas_cortas: null,
                        creado_en: '2026-11-14 16:00:00'
                    });
                    return finish(null, { insertId: id });
                }

                if (normalized.startsWith('INSERT INTO MusicaCanciones')) {
                    const [uid, albumId, titulo, numPista, idioma, ytUrl, ytId, thumb, estado, enfoque] = params;
                    const id = musicSongs.length + 1;
                    musicSongs.push({
                        id,
                        usuario_id: Number(uid),
                        album_id: albumId || null,
                        titulo,
                        numero_pista: numPista,
                        idioma,
                        yt_music_url: ytUrl,
                        yt_video_id: ytId,
                        thumbnail_url: thumb,
                        estado_estudio: estado,
                        enfoque_corto: enfoque,
                        word_sincronizado: 0,
                        ultimo_estudio_en: null,
                        creado_en: '2026-11-14 16:00:00',
                        actualizado_en: '2026-11-14 16:00:00'
                    });
                    return finish(null, { insertId: id });
                }

                if (normalized.startsWith('DELETE FROM MusicaCancionArtistas WHERE cancion_id = ?')) {
                    const songId = Number(params[0]);
                    for (let i = musicSongArtists.length - 1; i >= 0; i--) {
                        if (musicSongArtists[i].cancion_id === songId) musicSongArtists.splice(i, 1);
                    }
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith('INSERT INTO MusicaCancionArtistas')) {
                    const [songId, artistId, rol, orden] = params;
                    musicSongArtists.push({
                        cancion_id: Number(songId),
                        artista_id: Number(artistId),
                        rol,
                        orden
                    });
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith('SELECT id, nombre, tipo_artista, notas_cortas, creado_en FROM MusicaArtistas')) {
                    const uid = Number(params[0]);
                    return finish(
                        null,
                        musicArtists
                            .filter((a) => a.usuario_id === uid)
                            .sort((a, b) => a.nombre.localeCompare(b.nombre))
                    );
                }

                if (normalized.startsWith('SELECT al.id, al.artista_principal_id, ma.nombre AS artista_principal_nombre')) {
                    const uid = Number(params[0]);
                    return finish(
                        null,
                        musicAlbums
                            .filter((al) => al.usuario_id === uid)
                            .map((al) => {
                                const artist = musicArtists.find((a) => a.id === al.artista_principal_id);
                                return { ...al, artista_principal_nombre: artist ? artist.nombre : null };
                            })
                    );
                }

                if (normalized.startsWith('SELECT c.id, c.album_id, al.titulo AS album_titulo')) {
                    const uid = Number(params[0]);
                    return finish(
                        null,
                        musicSongs
                            .filter((c) => c.usuario_id === uid)
                            .map((c) => {
                                const al = musicAlbums.find((a) => a.id === c.album_id);
                                return {
                                    ...c,
                                    album_titulo: al ? al.titulo : null,
                                    album_tipo: al ? al.tipo_lanzamiento : null,
                                    album_anio: al ? al.anio : null
                                };
                            })
                    );
                }

                if (normalized.startsWith('SELECT mca.cancion_id, mca.artista_id, mca.rol, mca.orden, ma.nombre FROM MusicaCancionArtistas')) {
                    const uid = Number(params[0]);
                    const ownedSongIds = new Set(musicSongs.filter((c) => c.usuario_id === uid).map((c) => c.id));
                    return finish(
                        null,
                        musicSongArtists
                            .filter((l) => ownedSongIds.has(l.cancion_id))
                            .map((l) => {
                                const artist = musicArtists.find((a) => a.id === l.artista_id);
                                return { ...l, nombre: artist ? artist.nombre : '' };
                            })
                    );
                }

                if (normalized.startsWith('SELECT id FROM MusicaCanciones WHERE id = ? AND usuario_id = ?')) {
                    const [songId, uid] = params;
                    const match = musicSongs.find((c) => c.id === Number(songId) && c.usuario_id === Number(uid));
                    return finish(null, match ? [{ id: match.id }] : []);
                }

                if (normalized.startsWith('SELECT id, estado_estudio, word_sincronizado FROM MusicaCanciones WHERE id = ? AND usuario_id = ?')) {
                    const [songId, uid] = params;
                    const match = musicSongs.find((c) => c.id === Number(songId) && c.usuario_id === Number(uid));
                    return finish(null, match ? [{ id: match.id, estado_estudio: match.estado_estudio, word_sincronizado: match.word_sincronizado }] : []);
                }

                if (normalized.startsWith('UPDATE MusicaCanciones SET album_id = ?')) {
                    const [albumId, titulo, numPista, idioma, ytUrl, ytId, thumb, estado, enfoque, songId, uid] = params;
                    const song = musicSongs.find((c) => c.id === Number(songId) && c.usuario_id === Number(uid));
                    if (song) {
                        Object.assign(song, {
                            album_id: albumId || null,
                            titulo,
                            numero_pista: numPista,
                            idioma,
                            yt_music_url: ytUrl,
                            yt_video_id: ytId,
                            thumbnail_url: thumb,
                            estado_estudio: estado,
                            enfoque_corto: enfoque
                        });
                    }
                    return finish(null, { affectedRows: song ? 1 : 0 });
                }

                if (normalized.startsWith('UPDATE MusicaCanciones SET estado_estudio = ?')) {
                    const [estado, wordSynced, ultimoEstudio, songId, uid] = params;
                    const song = musicSongs.find((c) => c.id === Number(songId) && c.usuario_id === Number(uid));
                    if (song) {
                        song.estado_estudio = estado;
                        song.word_sincronizado = wordSynced;
                        song.ultimo_estudio_en = ultimoEstudio;
                    }
                    return finish(null, { affectedRows: song ? 1 : 0 });
                }

                if (normalized.startsWith('DELETE FROM MusicaCanciones WHERE id = ? AND usuario_id = ?')) {
                    const [songId, uid] = params;
                    const idx = musicSongs.findIndex((c) => c.id === Number(songId) && c.usuario_id === Number(uid));
                    if (idx === -1) return finish(null, { affectedRows: 0 });
                    musicSongs.splice(idx, 1);
                    for (let i = musicSongArtists.length - 1; i >= 0; i--) {
                        if (musicSongArtists[i].cancion_id === Number(songId)) musicSongArtists.splice(i, 1);
                    }
                    return finish(null, { affectedRows: 1 });
                }

                return finish(null, []);
            },
            getConnection(cb) {
                cb(null, { release() {} });
            },
            end(cb) {
                if (cb) cb();
            }
        };

        origLoad = Module._load;
        Module._load = function (requestName) {
            if (requestName === 'dotenv') return { config: () => ({ parsed: {} }) };
            if (requestName === 'mysql2') {
                return {
                    createPool(cfg) {
                        capturedPoolConfig = cfg;
                        return mockDb;
                    }
                };
            }
            if (requestName === 'nodemailer') {
                return { createTransport: () => ({ async sendMail() { return { messageId: 'mock' }; } }) };
            }
            return origLoad.apply(this, arguments);
        };

        origListen = http.Server.prototype.listen;
        http.Server.prototype.listen = function (...args) {
            capturedServer = this;
            return origListen.apply(this, args);
        };

        const serverPath = path.join(ROOT, 'server.js');
        delete require.cache[require.resolve(serverPath)];
        require(serverPath);

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout esperando server.listen')), 5000);
            const wait = () => {
                if (capturedServer && capturedServer.listening) {
                    clearTimeout(timeout);
                    resolve();
                } else {
                    setTimeout(wait, 15);
                }
            };
            wait();
        });

        port = capturedServer.address().port;

        // Crear sesión directa para psiquiatra (no expira en 24h)
        const medicoRaw = crypto.randomBytes(24).toString('hex');
        const medicoHash = crypto.createHash('sha256').update(medicoRaw).digest('hex');
        const exp = new Date(Date.now() + 24 * 3600 * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        const expSql = `${exp.getFullYear()}-${pad(exp.getMonth() + 1)}-${pad(exp.getDate())} ${pad(exp.getHours())}:${pad(exp.getMinutes())}:${pad(exp.getSeconds())}`;
        sessions.set(medicoHash, { id: 99, usuario_id: 2, token_hash: medicoHash, expira_en: expSql });
        medicoCookie = `mt_session=${medicoRaw}`;
    });

    after(async () => {
        if (origLoad) Module._load = origLoad;
        if (origListen) http.Server.prototype.listen = origListen;
        if (capturedServer && capturedServer.listening) {
            await new Promise((resolve) => capturedServer.close(resolve));
        }
    });

    it('configura pool MySQL de bajo consumo para t3.micro', () => {
        assert.strictEqual(capturedPoolConfig.connectionLimit, 4);
        assert.strictEqual(capturedPoolConfig.maxIdle, 2);
        assert.strictEqual(capturedPoolConfig.idleTimeout, 60000);
        assert.strictEqual(capturedPoolConfig.enableKeepAlive, false);
    });

    it('envía cabeceras de seguridad HTTP y caché estático con ETag', async () => {
        const res = await request({ port, reqPath: '/index.html' });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers['x-powered-by'], undefined);
        assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
        assert.strictEqual(res.headers['x-frame-options'], 'DENY');
        assert.strictEqual(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
        assert.strictEqual(res.headers['cross-origin-opener-policy'], 'same-origin');
        assert.strictEqual(res.headers['cross-origin-resource-policy'], 'same-origin');
        assert.strictEqual(res.headers['x-permitted-cross-domain-policies'], 'none');
        assert.strictEqual(res.headers['x-dns-prefetch-control'], 'off');
        assert.ok(String(res.headers['content-security-policy'] || '').includes("default-src 'self'"));
        assert.ok(String(res.headers['content-security-policy'] || '').includes("form-action 'self'"));
        assert.ok(res.headers.etag);
        assert.ok(String(res.headers['cache-control'] || '').includes('max-age=600'));

        for (const assetPath of ['/frontend.js', '/style.css']) {
            const assetRes = await request({ port, reqPath: assetPath });
            assert.strictEqual(assetRes.status, 200);
            assert.ok(assetRes.headers.etag, `${assetPath} debe enviar ETag`);
            assert.match(
                String(assetRes.headers['cache-control'] || ''),
                /max-age=0,\s*must-revalidate/,
                `${assetPath} debe revalidar caché tras despliegues`
            );
        }
    });

    it('bloquea rutas protegidas sin sesión, valida bcrypt y limpia registros vencidos al hacer login', async () => {
        const unauth = await request({ port, reqPath: '/api/auth/me' });
        assert.strictEqual(unauth.status, 401);

        const wrongPass = await request({
            port,
            method: 'POST',
            reqPath: '/api/auth/login',
            body: { email: 'admin@example.com', password: 'IncorrectaPassword1!' }
        });
        assert.strictEqual(wrongPass.status, 401);

        const qBefore = queryLog.length;
        const okLogin = await request({
            port,
            method: 'POST',
            reqPath: '/api/auth/login',
            body: { email: 'admin@example.com', password: 'ClavePrueba2026!' }
        });
        assert.strictEqual(okLogin.status, 200);
        const setCookie = (okLogin.headers['set-cookie'] || []).join('; ');
        assert.match(setCookie, /HttpOnly/i);
        const tokenMatch = setCookie.match(/mt_session=([^;]+)/);
        assert.ok(tokenMatch, 'Debe entregar cookie mt_session');
        adminCookie = `mt_session=${tokenMatch[1]}`;

        await new Promise((r) => setTimeout(r, 40));
        const loginSqls = queryLog.slice(qBefore).map((q) => q.sql);
        assert.ok(loginSqls.some((s) => s.startsWith('DELETE FROM SesionesAuth WHERE expira_en <=')));
        assert.ok(loginSqls.some((s) => s.startsWith('DELETE FROM CodigosSeguridad WHERE')));

        const me = await request({ port, reqPath: '/api/auth/me', headers: { Cookie: adminCookie } });
        assert.strictEqual(me.status, 200);
        assert.strictEqual(JSON.parse(me.body).user.rol, 'admin');
    });

    it('aplica RBAC: psiquiatra solo puede leer ánimo y sueño y recibe 403 al editar', async () => {
        for (const reqOpts of [
            { method: 'POST', reqPath: '/api/insert-mood', body: { fecha: '2026-11-14', momento_dia: 'Madrugada', estado_animo: 'Feliz', color_hex: '#4caf50' } },
            { method: 'POST', reqPath: '/api/insert-sleep', body: { fecha: '2026-11-14', horas: 7.5, calidad: 'Good' } },
            { method: 'GET', reqPath: '/api/get-agenda?begin=2026-11-01&end=2026-11-14' },
            { method: 'POST', reqPath: '/api/insert-agenda', body: { fecha: '2026-11-14', bloque: 'manana', hora: '08:00', actividad: 'Leer' } },
            { method: 'POST', reqPath: '/api/send-to-pc', body: { texto: 'cifrado' } },
            { method: 'POST', reqPath: '/api/send-english', body: { texto: 'cifrado-english' } }
        ]) {
            const res = await request({ port, headers: { Cookie: medicoCookie }, ...reqOpts });
            assert.strictEqual(res.status, 403, `${reqOpts.reqPath} debe responder 403 para psiquiatra`);
        }

        const readMoods = await request({
            port,
            reqPath: '/api/get-moods?begin=2026-11-01&end=2026-11-14',
            headers: { Cookie: medicoCookie }
        });
        assert.strictEqual(readMoods.status, 200);

        const readSleep = await request({
            port,
            reqPath: '/api/get-sleep?begin=2026-11-01&end=2026-11-14',
            headers: { Cookie: medicoCookie }
        });
        assert.strictEqual(readSleep.status, 200);
    });

    it('valida fechas, campos de ánimo (incluyendo Madrugada), sueño y agenda', async () => {
        for (const ep of ['/api/get-moods', '/api/get-sleep']) {
            const missing = await request({ port, reqPath: ep, headers: { Cookie: adminCookie } });
            assert.strictEqual(missing.status, 400);
            const bad = await request({ port, reqPath: `${ep}?begin=14-11-2026&end=2026-11-14`, headers: { Cookie: adminCookie } });
            assert.strictEqual(bad.status, 400);
        }

        const badHex = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-mood',
            headers: { Cookie: adminCookie },
            body: { fecha: '2026-11-14', momento_dia: 'Madrugada', estado_animo: 'Tranquilo', color_hex: 'verde' }
        });
        assert.strictEqual(badHex.status, 400);

        const okMood = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-mood',
            headers: { Cookie: adminCookie },
            body: { fecha: '2026-11-14', momento_dia: 'Madrugada', estado_animo: 'Tranquilo', color_hex: '#4caf50' }
        });
        assert.strictEqual(okMood.status, 200);
        assert.strictEqual(moodInserts.length, 1);
        assert.strictEqual(moodInserts[0].momento_dia, 'Madrugada');

        const badSleep = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-sleep',
            headers: { Cookie: adminCookie },
            body: { fecha: '2026-11-14', horas: 30, calidad: 'Good' }
        });
        assert.strictEqual(badSleep.status, 400);

        const okSleep = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-sleep',
            headers: { Cookie: adminCookie },
            body: { fecha: '2026-11-14', horas: 7.5, calidad: 'Good' }
        });
        assert.strictEqual(okSleep.status, 200);

        const badAgenda = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-agenda',
            headers: { Cookie: adminCookie },
            body: { fecha: '2026-11-14', bloque: 'invalido', hora: '08:00', actividad: 'Test' }
        });
        assert.strictEqual(badAgenda.status, 400);

        const okAgenda = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-agenda',
            headers: { Cookie: adminCookie },
            body: { fecha: '2026-11-14', bloque: 'manana', hora: '08:00', actividad: 'Meditar' }
        });
        assert.strictEqual(okAgenda.status, 201);
        assert.strictEqual(JSON.parse(okAgenda.body).item.bloque, 'manana');
    });

    it('acota la cola /api/send-to-pc a 100 elementos y devuelve arreglo JSON compatible con sincronizador.py en /api/pull-text', async () => {
        for (let i = 1; i <= 100; i++) {
            const res = await request({
                port,
                method: 'POST',
                reqPath: '/api/send-to-pc',
                headers: { Cookie: adminCookie },
                body: { texto: `cipher-${i}` }
            });
            assert.strictEqual(res.status, 200, `Item ${i} debe aceptarse`);
        }

        const overflow = await request({
            port,
            method: 'POST',
            reqPath: '/api/send-to-pc',
            headers: { Cookie: adminCookie },
            body: { texto: 'cipher-101' }
        });
        assert.strictEqual(overflow.status, 429);

        const pull1 = await request({ port, reqPath: '/api/pull-text' });
        assert.strictEqual(pull1.status, 200);
        const list1 = JSON.parse(pull1.body);
        assert.strictEqual(Array.isArray(list1), true);
        assert.strictEqual(list1.length, 100);
        assert.strictEqual(list1[0], 'cipher-1');

        const pull2 = await request({ port, reqPath: '/api/pull-text' });
        assert.strictEqual(pull2.status, 200);
        assert.deepStrictEqual(JSON.parse(pull2.body), []);

        const afterDrain = await request({
            port,
            method: 'POST',
            reqPath: '/api/send-to-pc',
            headers: { Cookie: adminCookie },
            body: { texto: 'after-drain' }
        });
        assert.strictEqual(afterDrain.status, 200);
    });

    it('acota la cola /api/send-english a 100 elementos, aísla del journal y drena en /api/pull-english', async () => {
        const unauth = await request({
            port,
            method: 'POST',
            reqPath: '/api/send-english',
            body: { texto: 'unauth' }
        });
        assert.strictEqual(unauth.status, 401);

        const emptyPayload = await request({
            port,
            method: 'POST',
            reqPath: '/api/send-english',
            headers: { Cookie: adminCookie },
            body: {}
        });
        assert.strictEqual(emptyPayload.status, 400);

        for (let i = 1; i <= 100; i++) {
            const res = await request({
                port,
                method: 'POST',
                reqPath: '/api/send-english',
                headers: { Cookie: adminCookie },
                body: { texto: `english-cipher-${i}` }
            });
            assert.strictEqual(res.status, 200, `Item inglés ${i} debe aceptarse`);
        }

        const overflow = await request({
            port,
            method: 'POST',
            reqPath: '/api/send-english',
            headers: { Cookie: adminCookie },
            body: { texto: 'english-cipher-101' }
        });
        assert.strictEqual(overflow.status, 429);

        // La cola /api/pull-english NO debe mezclarse con /api/pull-text (solo tiene 'after-drain')
        const journalPull = await request({ port, reqPath: '/api/pull-text' });
        assert.strictEqual(journalPull.status, 200);
        assert.deepStrictEqual(JSON.parse(journalPull.body), ['after-drain']);

        const pull1 = await request({ port, reqPath: '/api/pull-english' });
        assert.strictEqual(pull1.status, 200);
        const list1 = JSON.parse(pull1.body);
        assert.strictEqual(Array.isArray(list1), true);
        assert.strictEqual(list1.length, 100);
        assert.strictEqual(list1[0], 'english-cipher-1');

        const pull2 = await request({ port, reqPath: '/api/pull-english' });
        assert.strictEqual(pull2.status, 200);
        assert.deepStrictEqual(JSON.parse(pull2.body), []);
    });

    it('evita envíos duplicados, aplica X-Idempotency-Key, detecta cola repetida y bloquea concurrencia en vuelo', async () => {
        // 1. Sleep: replay con misma X-Idempotency-Key devuelve 200 cacheado sin duplicar inserción y 409 sin clave
        const sleepCountBefore = sleepInserts.length;
        const sleepPayload = { fecha: '2026-11-15', horas: 8.25, calidad: 'Good' };

        const s1 = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-sleep',
            headers: { Cookie: adminCookie, 'X-Idempotency-Key': 'sleep-idem-key-1' },
            body: sleepPayload
        });
        assert.strictEqual(s1.status, 200);
        assert.strictEqual(sleepInserts.length, sleepCountBefore + 1);

        const sReplay = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-sleep',
            headers: { Cookie: adminCookie, 'X-Idempotency-Key': 'sleep-idem-key-1' },
            body: sleepPayload
        });
        assert.strictEqual(sReplay.status, 200);
        assert.strictEqual(sReplay.headers['x-idempotent-replay'], 'true');
        assert.strictEqual(sleepInserts.length, sleepCountBefore + 1);

        const sMismatch = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-sleep',
            headers: { Cookie: adminCookie, 'X-Idempotency-Key': 'sleep-idem-key-1' },
            body: { fecha: '2026-11-15', horas: 6, calidad: 'Regular' }
        });
        assert.strictEqual(sMismatch.status, 409);

        const sDup = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-sleep',
            headers: { Cookie: adminCookie, 'X-Idempotency-Key': 'sleep-idem-key-2' },
            body: sleepPayload
        });
        assert.strictEqual(sDup.status, 409);
        assert.strictEqual(sleepInserts.length, sleepCountBefore + 1);

        // 2. Agenda: replay 201 cacheado y bloqueo 409 de actividad idéntica repetida
        const agendaCountBefore = agendaInserts.length;
        const agendaPayload = { fecha: '2026-11-15', bloque: 'tarde', hora: '16:00', actividad: 'Practice Speaking' };

        const a1 = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-agenda',
            headers: { Cookie: adminCookie, 'X-Idempotency-Key': 'agenda-idem-key-1' },
            body: agendaPayload
        });
        assert.strictEqual(a1.status, 201);
        assert.strictEqual(agendaInserts.length, agendaCountBefore + 1);

        const aReplay = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-agenda',
            headers: { Cookie: adminCookie, 'X-Idempotency-Key': 'agenda-idem-key-1' },
            body: agendaPayload
        });
        assert.strictEqual(aReplay.status, 201);
        assert.strictEqual(aReplay.headers['x-idempotent-replay'], 'true');
        assert.strictEqual(agendaInserts.length, agendaCountBefore + 1);

        const aDup = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-agenda',
            headers: { Cookie: adminCookie },
            body: agendaPayload
        });
        assert.strictEqual(aDup.status, 409);
        assert.strictEqual(agendaInserts.length, agendaCountBefore + 1);

        // 3. Colas E2EE (/api/send-to-pc y /api/send-english): replay 200 y rechazo 409 de duplicados
        const pc1 = await request({
            port,
            method: 'POST',
            reqPath: '/api/send-to-pc',
            headers: { Cookie: adminCookie, 'X-Idempotency-Key': 'pc-idem-1' },
            body: { texto: 'cipher-unique-note' }
        });
        assert.strictEqual(pc1.status, 200);

        const pcReplay = await request({
            port,
            method: 'POST',
            reqPath: '/api/send-to-pc',
            headers: { Cookie: adminCookie, 'X-Idempotency-Key': 'pc-idem-1' },
            body: { texto: 'cipher-unique-note' }
        });
        assert.strictEqual(pcReplay.status, 200);
        assert.strictEqual(pcReplay.headers['x-idempotent-replay'], 'true');

        const pcDup = await request({
            port,
            method: 'POST',
            reqPath: '/api/send-to-pc',
            headers: { Cookie: adminCookie, 'X-Idempotency-Key': 'pc-idem-2' },
            body: { texto: 'cipher-unique-note' }
        });
        assert.strictEqual(pcDup.status, 409);

        const pcPull = await request({ port, reqPath: '/api/pull-text' });
        assert.deepStrictEqual(JSON.parse(pcPull.body), ['cipher-unique-note']);

        const eng1 = await request({
            port,
            method: 'POST',
            reqPath: '/api/send-english',
            headers: { Cookie: adminCookie, 'X-Idempotency-Key': 'eng-idem-1' },
            body: { texto: 'english-unique-entry' }
        });
        assert.strictEqual(eng1.status, 200);

        const engDup = await request({
            port,
            method: 'POST',
            reqPath: '/api/send-english',
            headers: { Cookie: adminCookie, 'X-Idempotency-Key': 'eng-idem-2' },
            body: { texto: 'english-unique-entry' }
        });
        assert.strictEqual(engDup.status, 409);

        const engPull = await request({ port, reqPath: '/api/pull-english' });
        assert.deepStrictEqual(JSON.parse(engPull.body), ['english-unique-entry']);

        // 4. Concurrencia simultánea en vuelo (bcrypt async): solo 1 procede y la 2ª recibe 409
        const medicoPayload = { nombre: 'Dra. Concurrencia', email: 'concurrencia@example.com', password: 'ClaveMedico2026!' };
        const [concA, concB] = await Promise.all([
            request({ port, method: 'POST', reqPath: '/api/auth/create-medico', headers: { Cookie: adminCookie }, body: medicoPayload }),
            request({ port, method: 'POST', reqPath: '/api/auth/create-medico', headers: { Cookie: adminCookie }, body: medicoPayload })
        ]);
        assert.deepStrictEqual([concA.status, concB.status].sort(), [200, 409]);

        // Cierre de sesión limpia la cookie y elimina sesión
        const logout = await request({ port, method: 'POST', reqPath: '/api/auth/logout', headers: { Cookie: adminCookie } });
        assert.strictEqual(logout.status, 200);
        const meAfterLogout = await request({ port, reqPath: '/api/auth/me', headers: { Cookie: adminCookie } });
        assert.strictEqual(meAfterLogout.status, 401);
    });

    it('cumple Checklist U2: estado de cuenta, anti-enumeración, validación estricta y errores controlados', async () => {
        // Re-iniciar sesión de admin para pruebas autenticadas
        const reLogin = await request({
            port,
            method: 'POST',
            reqPath: '/api/auth/login',
            body: { email: 'admin@example.com', password: 'ClavePrueba2026!' }
        });
        assert.strictEqual(reLogin.status, 200);
        const reCookie = `mt_session=${(reLogin.headers['set-cookie'] || []).join('; ').match(/mt_session=([^;]+)/)[1]}`;

        // 1. Manejo controlado de errores (JSON malformado -> 400, ruta inexistente -> 404 sin stack trace)
        const malformedJson = await new Promise((resolve, reject) => {
            const badPayload = '{maljson';
            const req = http.request(
                {
                    hostname: '127.0.0.1',
                    port,
                    path: '/api/auth/login',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(badPayload) }
                },
                (res) => {
                    const chunks = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
                }
            );
            req.on('error', reject);
            req.write(badPayload);
            req.end();
        });
        assert.strictEqual(malformedJson.status, 400);
        assert.strictEqual(malformedJson.body, 'Invalid JSON payload.');

        const notFoundApi = await request({ port, reqPath: '/api/ruta-inexistente' });
        assert.strictEqual(notFoundApi.status, 404);
        assert.strictEqual(notFoundApi.body, 'API endpoint not found.');

        // 2. Validación de campos vacíos, arreglo en vez de objeto, correo inválido y contraseña débil
        const emptyObj = await request({ port, method: 'POST', reqPath: '/api/auth/login', body: {} });
        assert.strictEqual(emptyObj.status, 400);

        const arrayBody = await request({ port, method: 'POST', reqPath: '/api/auth/login', body: ['a'] });
        assert.strictEqual(arrayBody.status, 400);

        const badEmail = await request({
            port,
            method: 'POST',
            reqPath: '/api/auth/create-medico',
            headers: { Cookie: reCookie },
            body: { nombre: 'Dr. Test', email: 'correo-invalido', password: 'Password2026!' }
        });
        assert.strictEqual(badEmail.status, 400);

        for (const weakPw of ['1234567', 'abcdefgh', '12345678']) {
            const weakRes = await request({
                port,
                method: 'POST',
                reqPath: '/api/auth/create-medico',
                headers: { Cookie: reCookie },
                body: { nombre: 'Dr. Test', email: 'nuevo@example.com', password: weakPw }
            });
            assert.strictEqual(weakRes.status, 400, `Contraseña débil "${weakPw}" debe rechazarse`);
        }

        // 3. Anti-enumeración en login y forgot-password
        const nonExistentLogin = await request({
            port,
            method: 'POST',
            reqPath: '/api/auth/login',
            body: { email: 'noexiste@example.com', password: 'ClavePrueba2026!' }
        });
        const wrongPassLogin = await request({
            port,
            method: 'POST',
            reqPath: '/api/auth/login',
            body: { email: 'admin@example.com', password: 'WrongPassword1!' }
        });
        assert.strictEqual(nonExistentLogin.status, 401);
        assert.strictEqual(wrongPassLogin.status, 401);
        assert.strictEqual(nonExistentLogin.body, wrongPassLogin.body);

        const forgotKnown = await request({
            port,
            method: 'POST',
            reqPath: '/api/auth/forgot-password',
            body: { email: 'admin@example.com' }
        });
        const forgotUnknown = await request({
            port,
            method: 'POST',
            reqPath: '/api/auth/forgot-password',
            body: { email: 'desconocido@example.com' }
        });
        assert.strictEqual(forgotKnown.status, 200);
        assert.strictEqual(forgotUnknown.status, 200);
        assert.strictEqual(JSON.parse(forgotKnown.body).message, JSON.parse(forgotUnknown.body).message);

        // 4. Validación del estado de cuenta (suspendido/inactivo bloquea login y revoca sesiones vivas)
        const suspendedLogin = await request({
            port,
            method: 'POST',
            reqPath: '/api/auth/login',
            body: { email: 'suspendido@example.com', password: 'ClavePrueba2026!' }
        });
        assert.strictEqual(suspendedLogin.status, 403);

        const suspendMedico = await request({
            port,
            method: 'PATCH',
            reqPath: '/api/auth/medicos/2/estado',
            headers: { Cookie: reCookie },
            body: { estado: 'suspendido' }
        });
        assert.strictEqual(suspendMedico.status, 200);

        const medicoMeAfterSuspend = await request({ port, reqPath: '/api/auth/me', headers: { Cookie: medicoCookie } });
        assert.notStrictEqual(medicoMeAfterSuspend.status, 200);

        const medicoLoginWhileSuspended = await request({
            port,
            method: 'POST',
            reqPath: '/api/auth/login',
            body: { email: 'medico@example.com', password: 'ClavePrueba2026!' }
        });
        assert.strictEqual(medicoLoginWhileSuspended.status, 403);

        const reactivateMedico = await request({
            port,
            method: 'PATCH',
            reqPath: '/api/auth/medicos/2/estado',
            headers: { Cookie: reCookie },
            body: { estado: 'activo' }
        });
        assert.strictEqual(reactivateMedico.status, 200);

        const medicoLoginAfterReactivate = await request({
            port,
            method: 'POST',
            reqPath: '/api/auth/login',
            body: { email: 'medico@example.com', password: 'ClavePrueba2026!' }
        });
        assert.strictEqual(medicoLoginAfterReactivate.status, 200);
    });

    it('soporta Agenda Event/Task, categorías University/Personal, estados Jira (To Do/In Progress/Done), Configuración y Recordatorios con Snooze', async () => {
        // Re-iniciar sesión de admin limpio para pruebas de agenda/settings/reminders
        const reLogin = await request({
            port,
            method: 'POST',
            reqPath: '/api/auth/login',
            body: { email: 'admin@example.com', password: 'ClavePrueba2026!' }
        });
        assert.strictEqual(reLogin.status, 200);
        const tokenMatch = (reLogin.headers['set-cookie'] || []).join('; ').match(/mt_session=([^;]+)/);
        assert.ok(tokenMatch);
        adminCookie = `mt_session=${tokenMatch[1]}`;

        const medicoReLogin = await request({
            port,
            method: 'POST',
            reqPath: '/api/auth/login',
            body: { email: 'medico@example.com', password: 'ClavePrueba2026!' }
        });
        assert.strictEqual(medicoReLogin.status, 200);
        const medTokenMatch = (medicoReLogin.headers['set-cookie'] || []).join('; ').match(/mt_session=([^;]+)/);
        assert.ok(medTokenMatch);
        medicoCookie = `mt_session=${medTokenMatch[1]}`;

        // 1. Psiquiatra no debe acceder a settings ni reminders (RBAC 403)
        for (const restrictedPath of ['/api/settings', '/api/reminders/active']) {
            const forb = await request({ port, reqPath: restrictedPath, headers: { Cookie: medicoCookie } });
            assert.strictEqual(forb.status, 403, `${restrictedPath} debe bloquear a psiquiatra`);
        }

        // 2. Agenda: rechaza tipo/categoria/estado inválidos
        const badCat = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-agenda',
            headers: { Cookie: adminCookie },
            body: {
                fecha: '2026-11-16',
                bloque: 'cole',
                hora: '09:00',
                actividad: 'Test clase',
                tipo: 'evento',
                categoria: 'trabajo'
            }
        });
        assert.strictEqual(badCat.status, 400);

        const badJira = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-agenda',
            headers: { Cookie: adminCookie },
            body: {
                fecha: '2026-11-16',
                bloque: 'cole',
                hora: '09:00',
                actividad: 'Test tarea',
                tipo: 'tarea',
                categoria: 'universidad',
                estado: 'blocked'
            }
        });
        assert.strictEqual(badJira.status, 400);

        // 3. Crear tarea de Universidad (To Do) y transicionar Jira: todo -> in_progress -> done -> todo
        const createdTask = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-agenda',
            headers: { Cookie: adminCookie, 'X-Idempotency-Key': 'agenda-task-jira-1' },
            body: {
                fecha: '2026-11-16',
                bloque: 'cole',
                hora: '10:30',
                actividad: 'Finish Cloud Architecture Lab',
                tipo: 'tarea',
                categoria: 'universidad',
                estado: 'todo',
                recordatorio_min: 15
            }
        });
        assert.strictEqual(createdTask.status, 201);
        const taskJson = JSON.parse(createdTask.body);
        assert.strictEqual(taskJson.item.tipo, 'tarea');
        assert.strictEqual(taskJson.item.categoria, 'universidad');
        assert.strictEqual(taskJson.item.estado, 'todo');
        assert.strictEqual(taskJson.item.completada, 0);
        const taskId = taskJson.item.id;

        const toInProgress = await request({
            port,
            method: 'PATCH',
            reqPath: `/api/toggle-agenda/${taskId}`,
            headers: { Cookie: adminCookie },
            body: { estado: 'in_progress' }
        });
        assert.strictEqual(toInProgress.status, 200);
        assert.strictEqual(JSON.parse(toInProgress.body).estado, 'in_progress');
        assert.strictEqual(JSON.parse(toInProgress.body).completada, 0);

        const toDone = await request({
            port,
            method: 'PATCH',
            reqPath: `/api/toggle-agenda/${taskId}`,
            headers: { Cookie: adminCookie },
            body: { estado: 'done' }
        });
        assert.strictEqual(toDone.status, 200);
        assert.strictEqual(JSON.parse(toDone.body).estado, 'done');
        assert.strictEqual(JSON.parse(toDone.body).completada, 1);

        const weekRead = await request({
            port,
            reqPath: '/api/get-agenda?begin=2026-11-16&end=2026-11-16',
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(weekRead.status, 200);
        const itemsList = JSON.parse(weekRead.body);
        const savedTask = itemsList.find((i) => i.id === taskId);
        assert.ok(savedTask);
        assert.strictEqual(savedTask.tipo, 'tarea');
        assert.strictEqual(savedTask.categoria, 'universidad');
        assert.strictEqual(savedTask.estado, 'done');

        // 4. Configuración: verifica valores por defecto (English OFF, Madrugada OFF, Desktop OFF)
        const getDefaults = await request({ port, reqPath: '/api/settings', headers: { Cookie: adminCookie } });
        assert.strictEqual(getDefaults.status, 200);
        const defSettings = JSON.parse(getDefaults.body).settings;
        assert.strictEqual(defSettings.englishReminderEnabled, false);
        assert.strictEqual(defSettings.moodIncludeLateNight, false);
        assert.strictEqual(defSettings.desktopNotificationsEnabled, false);
        assert.strictEqual(defSettings.moodRemindersEnabled, true);
        assert.strictEqual(defSettings.sleepReminderEnabled, true);
        assert.strictEqual(defSettings.wordEodReminderEnabled, true);

        // Rechaza URLs SSRF / locales o habilitar ntfy sin tópico
        for (const badSettings of [
            { phoneNotificationsEnabled: true, ntfyTopic: '' },
            { ntfyServerUrl: 'http://ntfy.sh' },
            { ntfyServerUrl: 'https://127.0.0.1/topic' },
            { ntfyServerUrl: 'https://localhost/topic' },
            { timezone: 'Mars/Olympus_Mons' }
        ]) {
            const badRes = await request({
                port,
                method: 'PUT',
                reqPath: '/api/settings',
                headers: { Cookie: adminCookie },
                body: badSettings
            });
            assert.strictEqual(badRes.status, 400);
        }

        // Elegir dinámicamente una zona horaria IANA cuya hora local actual esté entre 08:00 y 12:59
        const candidateTzs = [
            'UTC', 'America/Mexico_City', 'America/Los_Angeles', 'Pacific/Honolulu',
            'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Bangkok', 'Asia/Tokyo', 'Pacific/Auckland'
        ];
        const getTzHourAndDate = (tz) => {
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: tz,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23'
            }).formatToParts(new Date());
            const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
            return {
                tz,
                hour: Number(map.hour),
                dateStr: `${map.year}-${map.month}-${map.day}`
            };
        };
        const chosenTz = candidateTzs.map(getTzHourAndDate).find((x) => x.hour >= 8 && x.hour <= 12) || getTzHourAndDate('UTC');
        const dynamicEnglishTime = `${String(chosenTz.hour).padStart(2, '0')}:00`;
        const backupSleeps = sleepInserts.splice(0, sleepInserts.length);

        try {
            // Guardar configuración válida (activando English configurable en la hora local actual para prueba determinista)
            const saveSettingsRes = await request({
                port,
                method: 'PUT',
                reqPath: '/api/settings',
                headers: { Cookie: adminCookie },
                body: {
                    phoneNotificationsEnabled: false,
                    ntfyTopic: 'hub_flavio_test_99',
                    desktopNotificationsEnabled: false,
                    moodRemindersEnabled: true,
                    moodIncludeLateNight: false,
                    sleepReminderEnabled: true,
                    sleepReminderTime: '00:00',
                    wordEodReminderEnabled: true,
                    wordEodReminderTime: '00:00',
                    englishReminderEnabled: true,
                    englishReminderTime: dynamicEnglishTime,
                    englishReminderDays: [0, 1, 2, 3, 4, 5, 6],
                    englishReminderTopic: 'Practice 5 phrasal verbs',
                    defaultAgendaCategory: 'universidad',
                    youtubePlatformMode: 'auto',
                    timezone: chosenTz.tz
                }
            });
            assert.strictEqual(saveSettingsRes.status, 200);
            const savedSettings = JSON.parse(saveSettingsRes.body).settings;
            assert.strictEqual(savedSettings.englishReminderEnabled, true);
            assert.strictEqual(savedSettings.defaultAgendaCategory, 'universidad');
            assert.strictEqual(savedSettings.youtubePlatformMode, 'auto');

            const badYtModeRes = await request({
                port,
                method: 'PUT',
                reqPath: '/api/settings',
                headers: { Cookie: adminCookie },
                body: { youtubePlatformMode: 'invalid_mode' }
            });
            assert.strictEqual(badYtModeRes.status, 400);

            // 5. Recordatorios activos + Snooze (posponer) + seguridad de token de acción
            const activeRes = await request({ port, reqPath: '/api/reminders/active', headers: { Cookie: adminCookie } });
            assert.strictEqual(activeRes.status, 200);
            const remData = JSON.parse(activeRes.body);
            assert.ok(Array.isArray(remData.active));
            assert.ok(Array.isArray(remData.snoozed));
            const sleepRem = remData.active.find((r) => r.type === 'sleep');
            const wordRem = remData.active.find((r) => r.type === 'word');
            const engRem = remData.active.find((r) => r.type === 'english');
            assert.ok(sleepRem, `Debe aparecer recordatorio de sueño configurable (tz=${chosenTz.tz}, hour=${chosenTz.hour})`);
            assert.ok(wordRem, 'Debe aparecer recordatorio de cierre del día para notas Word');
            assert.ok(engRem, 'Debe aparecer recordatorio personalizado de inglés al activarlo');

            const snoozeRes = await request({
                port,
                method: 'POST',
                reqPath: '/api/reminders/snooze',
                headers: { Cookie: adminCookie },
                body: {
                    key: sleepRem.key,
                    action: 'snooze',
                    minutes: 30,
                    type: sleepRem.type,
                    title: sleepRem.title,
                    message: sleepRem.message
                }
            });
            assert.strictEqual(snoozeRes.status, 200);

            const afterSnoozeRes = await request({ port, reqPath: '/api/reminders/active', headers: { Cookie: adminCookie } });
            assert.strictEqual(afterSnoozeRes.status, 200);
            const afterSnooze = JSON.parse(afterSnoozeRes.body);
            assert.ok(afterSnooze.snoozed.some((s) => s.key === sleepRem.key), 'El recordatorio pospuesto debe pasar a snoozed');
            assert.equal(afterSnooze.active.some((a) => a.key === sleepRem.key), false, 'El recordatorio pospuesto no debe seguir activo');

            const badActionToken = await request({
                port,
                method: 'POST',
                reqPath: '/api/reminders/action?token=forged-token-123'
            });
            assert.strictEqual(badActionToken.status, 401);

            // 6. Envío push de prueba vía ntfy JSON API (evita error ByteString en headers y genera click/actions desde publicBaseUrl)
            const originalFetch = globalThis.fetch;
            let capturedPush = null;
            globalThis.fetch = async (url, options) => {
                capturedPush = { url, options };
                return {
                    ok: true,
                    status: 200,
                    text: async () => '{"id":"test123"}'
                };
            };
            try {
                const testPushRes = await request({
                    port,
                    method: 'POST',
                    reqPath: '/api/settings/test-notification',
                    headers: { Cookie: adminCookie },
                    body: {
                        ntfyServerUrl: 'https://ntfy.sh',
                        ntfyTopic: 'hub_flavio_test_99',
                        ntfyPriority: 4,
                        publicBaseUrl: 'http://203.0.113.10:3000'
                    }
                });
                assert.strictEqual(testPushRes.status, 200);
                assert.ok(capturedPush, 'Debe invocar fetch hacia ntfy');
                assert.strictEqual(capturedPush.url, 'https://ntfy.sh/');
                assert.strictEqual(capturedPush.options.method, 'POST');
                for (const [hdrName, hdrVal] of Object.entries(capturedPush.options.headers || {})) {
                    const strVal = String(hdrVal);
                    for (let i = 0; i < strVal.length; i++) {
                        assert.ok(strVal.charCodeAt(i) <= 255, `Header ${hdrName} debe ser ByteString ASCII/Latin1`);
                    }
                }
                const pushBody = JSON.parse(capturedPush.options.body);
                assert.strictEqual(pushBody.topic, 'hub_flavio_test_99');
                assert.strictEqual(pushBody.title, 'Personal Daily Hub - Phone Connected');
                assert.strictEqual(pushBody.priority, 4);
                assert.strictEqual(pushBody.click, 'http://203.0.113.10:3000/#settings');
                assert.ok(Array.isArray(pushBody.actions) && pushBody.actions.length === 1);
                assert.strictEqual(pushBody.actions[0].url, 'http://203.0.113.10:3000/#settings');
            } finally {
                globalThis.fetch = originalFetch;
            }
        } finally {
            sleepInserts.push(...backupSleeps);
        }
    });

    it('gestiona catálogo Learn with Music por artistas/colaboraciones/mini álbumes, valida YouTube Music y aísla notas en Word E2EE', async () => {
        // 1. RBAC: psiquiatra no puede acceder al módulo personal de English Music
        const psychCatalogRes = await request({ port, reqPath: '/api/english/music/catalog', headers: { Cookie: medicoCookie } });
        assert.strictEqual(psychCatalogRes.status, 403);

        const psychCreateRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/songs',
            headers: { Cookie: medicoCookie },
            body: { titulo: 'DRIP', mainArtist: 'BABYMONSTER' }
        });
        assert.strictEqual(psychCreateRes.status, 403);

        // 2. Búsqueda asistida hacia la cuenta del usuario en YouTube Music + bloqueo SSRF en resolve
        const searchRes = await request({
            port,
            reqPath: '/api/english/music/search?q=BABYMONSTER%20DRIP',
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(searchRes.status, 200);
        const searchJson = JSON.parse(searchRes.body);
        assert.strictEqual(searchJson.ytMusicSearchUrl, 'https://music.youtube.com/search?q=BABYMONSTER%20DRIP');
        assert.strictEqual(searchJson.ytMusicLibraryUrl, 'https://music.youtube.com/library');
        assert.strictEqual(searchJson.youtubeSearchUrl, 'https://www.youtube.com/results?search_query=BABYMONSTER%20DRIP');
        assert.strictEqual(searchJson.youtubeHomeUrl, 'https://www.youtube.com/');

        // 2b. Despojar &list=... de un track para nunca alterar playlists personales y devolver ambas URLs (PC vs Móvil)
        const trackWithListRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/resolve',
            headers: { Cookie: adminCookie },
            body: { url: 'https://music.youtube.com/watch?v=ekr2nIex040&list=PL_user_personal_playlist_123' }
        });
        assert.strictEqual(trackWithListRes.status, 200);
        const trackWithList = JSON.parse(trackWithListRes.body);
        assert.strictEqual(trackWithList.ytMusicUrl, 'https://music.youtube.com/watch?v=ekr2nIex040');
        assert.strictEqual(trackWithList.youtubeUrl, 'https://www.youtube.com/watch?v=ekr2nIex040');

        const ssrfResolveRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/resolve',
            headers: { Cookie: adminCookie },
            body: { url: 'https://evil.example.com/watch?v=ekr2nIex040' }
        });
        assert.strictEqual(ssrfResolveRes.status, 400);

        const credUrlRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/resolve',
            headers: { Cookie: adminCookie },
            body: { url: 'https://user:pass@music.youtube.com/watch?v=ekr2nIex040' }
        });
        assert.strictEqual(credUrlRes.status, 400);

        const strippedBrowseRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/resolve',
            headers: { Cookie: adminCookie },
            body: { url: 'https://music.youtube.com/browse/MPREb_test?authuser=0&si=secrettracking' }
        });
        assert.strictEqual(strippedBrowseRes.status, 200);
        assert.strictEqual(JSON.parse(strippedBrowseRes.body).ytMusicUrl, 'https://music.youtube.com/browse/MPREb_test');

        // 3. Guardrail anti-letras en MySQL (>255 chars o >4 líneas rechazado en metadatos)
        const lyricsInDbAttempt = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/songs',
            headers: { Cookie: adminCookie },
            body: {
                titulo: 'Test Lyrics Guard',
                mainArtist: 'BLACKPINK',
                enfoqueCorto: 'A'.repeat(260)
            }
        });
        assert.strictEqual(lyricsInDbAttempt.status, 400);

        // 4. Registrar colaboración (ROSÉ x Bruno Mars) y Mini Álbum (BABYMONSTER - BABYMONS7ER)
        const createCollabRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/songs',
            headers: { Cookie: adminCookie },
            body: {
                titulo: 'APT.',
                mainArtist: 'ROSÉ',
                artistType: 'solo',
                collaborators: 'Bruno Mars',
                albumTitle: 'APT.',
                albumType: 'collab_single',
                albumYear: 2024,
                ytMusicUrl: 'https://youtu.be/ekr2nIex040',
                enfoqueCorto: 'Slang & casual phrases in fast conversation'
            }
        });
        assert.strictEqual(createCollabRes.status, 201);
        const createdCollab = JSON.parse(createCollabRes.body);
        assert.strictEqual(createdCollab.ytMusicUrl, 'https://music.youtube.com/watch?v=ekr2nIex040');
        assert.strictEqual(createdCollab.youtubeUrl, 'https://www.youtube.com/watch?v=ekr2nIex040');

        const createMiniAlbumRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/songs',
            headers: { Cookie: adminCookie },
            body: {
                titulo: 'SHEESH',
                mainArtist: 'BABYMONSTER',
                artistType: 'group',
                albumTitle: 'BABYMONS7ER',
                albumType: 'mini_album',
                albumYear: 2024,
                trackNumber: 2,
                ytMusicUrl: 'https://www.youtube.com/watch?v=2wA_b6YHjqQ',
                enfoqueCorto: 'Expressions of surprise & confident idioms'
            }
        });
        assert.strictEqual(createMiniAlbumRes.status, 201);
        const miniSongId = JSON.parse(createMiniAlbumRes.body).songId;

        // 5. Consultar catálogo y verificar artistas, colaboraciones y mini álbum
        const catalogRes = await request({ port, reqPath: '/api/english/music/catalog', headers: { Cookie: adminCookie } });
        assert.strictEqual(catalogRes.status, 200);
        const catalog = JSON.parse(catalogRes.body);
        assert.strictEqual(catalog.stats.totalSongs, 2);
        assert.strictEqual(catalog.stats.totalArtists, 3);
        const aptSong = catalog.songs.find((s) => s.titulo === 'APT.');
        assert.ok(aptSong);
        assert.strictEqual(aptSong.yt_music_url, 'https://music.youtube.com/watch?v=ekr2nIex040');
        assert.strictEqual(aptSong.youtube_url, 'https://www.youtube.com/watch?v=ekr2nIex040');
        assert.strictEqual(aptSong.artists.length, 2);
        assert.ok(aptSong.artists.some((a) => a.nombre === 'ROSÉ' && a.rol === 'main'));
        assert.ok(aptSong.artists.some((a) => a.nombre === 'Bruno Mars' && a.rol === 'collab'));
        const sheeshSong = catalog.songs.find((s) => s.id === miniSongId);
        assert.ok(sheeshSong);
        assert.strictEqual(sheeshSong.album_tipo, 'mini_album');

        // 6. Actualizar estado + Word synced y enviar notas largas cifradas E2EE solo a cola Word (no MySQL)
        const patchRes = await request({
            port,
            method: 'PATCH',
            reqPath: `/api/english/music/songs/${miniSongId}/status`,
            headers: { Cookie: adminCookie },
            body: { estadoEstudio: 'mastered', wordSynced: true }
        });
        assert.strictEqual(patchRes.status, 200);
        const patched = JSON.parse(patchRes.body);
        assert.strictEqual(patched.estado_estudio, 'mastered');
        assert.strictEqual(patched.word_sincronizado, true);

        const e2eeCipher = 'ivhex123:encrypted-song-lyrics-and-meaning-notes';
        const queueRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/send-english',
            headers: { Cookie: adminCookie },
            body: { texto: e2eeCipher }
        });
        assert.strictEqual(queueRes.status, 200);

        const pullRes = await request({ port, reqPath: '/api/pull-english' });
        assert.strictEqual(pullRes.status, 200);
        const pulled = JSON.parse(pullRes.body);
        assert.ok(pulled.includes(e2eeCipher));

        // 7. Editar metadatos y eliminar canción del catálogo
        const updateRes = await request({
            port,
            method: 'PUT',
            reqPath: `/api/english/music/songs/${miniSongId}`,
            headers: { Cookie: adminCookie },
            body: {
                titulo: 'SHEESH (Live Encore)',
                mainArtist: 'BABYMONSTER',
                artistType: 'group',
                collaborators: 'feat. Rami',
                albumTitle: 'BABYMONS7ER',
                albumType: 'mini_album',
                albumYear: 2024
            }
        });
        assert.strictEqual(updateRes.status, 200);

        const delRes = await request({
            port,
            method: 'DELETE',
            reqPath: `/api/english/music/songs/${miniSongId}`,
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(delRes.status, 200);

        const afterDelRes = await request({ port, reqPath: '/api/english/music/catalog', headers: { Cookie: adminCookie } });
        const afterDel = JSON.parse(afterDelRes.body);
        assert.strictEqual(afterDel.stats.totalSongs, 1);
    });

    it('gestiona Horario ITS por semestre, croquis de aulas (R02/R11/N21), vacaciones, residencias, trabajo, auto-bloque de agenda y rutas con tráfico', async () => {
        // 1. RBAC: psiquiatra no puede acceder al planificador académico/laboral
        const psychPlannerRes = await request({ port, reqPath: '/api/planner', headers: { Cookie: medicoCookie } });
        assert.strictEqual(psychPlannerRes.status, 403);

        // 2. Obtener planificador inicial con materias MindBox 9no semestre del ITS y directorio del croquis
        const getPlannerRes = await request({ port, reqPath: '/api/planner', headers: { Cookie: adminCookie } });
        assert.strictEqual(getPlannerRes.status, 200);
        const plannerBody = JSON.parse(getPlannerRes.body);
        assert.ok(plannerBody.planner);
        assert.ok(plannerBody.campusDirectory);
        assert.ok(plannerBody.campusDirectory.principal);
        assert.ok(plannerBody.campusDirectory.miravalle);
        assert.ok(plannerBody.campusDirectory.boillot);
        assert.strictEqual(plannerBody.planner.activeSemesterId, 'sem-9no-2026');
        assert.ok(plannerBody.planner.semesters[0].courses.length >= 5, 'Debe incluir las 5 materias MindBox de 9no semestre');

        // 3. Resolver aulas del croquis oficial del ITS (R02/R11 -> Boillot CTO-004, N21 -> Miravalle CTO-003, S14 -> Principal CTO-002)
        const roomR02Res = await request({
            port,
            method: 'POST',
            reqPath: '/api/planner/resolve-room',
            headers: { Cookie: adminCookie },
            body: { room: 'R02' }
        });
        assert.strictEqual(roomR02Res.status, 200);
        const r02 = JSON.parse(roomR02Res.body).resolved;
        assert.strictEqual(r02.campusKey, 'boillot');
        assert.strictEqual(r02.croquisCode, 'CTO-004');

        const roomN21Res = await request({
            port,
            method: 'POST',
            reqPath: '/api/planner/resolve-room',
            headers: { Cookie: adminCookie },
            body: { room: 'N21' }
        });
        assert.strictEqual(roomN21Res.status, 200);
        const n21 = JSON.parse(roomN21Res.body).resolved;
        assert.strictEqual(n21.campusKey, 'miravalle');
        assert.strictEqual(n21.croquisCode, 'CTO-003');

        // 4. Calcular tiempo de traslado en carro y anticipación de notificación (lejos >= 30 min con tráfico vs cerca = 10 min)
        const farLocRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/planner/location',
            headers: { Cookie: adminCookie },
            body: { mapsUrl: '25.380000, -101.020000', label: 'Casa Sur Saltillo' }
        });
        assert.strictEqual(farLocRes.status, 200);
        const farData = JSON.parse(farLocRes.body);
        assert.ok(Array.isArray(farData.commutes) && farData.commutes.length >= 3);
        const farPrincipal = farData.commutes.find((c) => c.campusKey === 'principal');
        assert.strictEqual(farPrincipal.isNearCampus, false);
        assert.ok(farPrincipal.recommendedLeadMinutes >= 30, 'Si está lejos del ITS debe notificar mínimo 30 minutos antes');
        assert.ok(farPrincipal.mapsDirectionsUrl.includes('google.com/maps/dir/'));

        const nearLocRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/planner/location',
            headers: { Cookie: adminCookie },
            body: { lat: 25.4438, lng: -100.9939, label: 'En el Tec de Saltillo' }
        });
        assert.strictEqual(nearLocRes.status, 200);
        const nearData = JSON.parse(nearLocRes.body);
        const nearPrincipal = nearData.commutes.find((c) => c.campusKey === 'principal');
        assert.strictEqual(nearPrincipal.isNearCampus, true);
        assert.strictEqual(nearPrincipal.recommendedLeadMinutes, 10, 'Si ya está en o cerca del ITS debe notificar 10 minutos antes');

        // 5. Agenda: separación de título y descripción + auto-selección de bloque del día a partir de la hora
        const insertSeparatedRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-agenda',
            headers: { Cookie: adminCookie },
            body: {
                fecha: '2026-11-16',
                hora: '14:30',
                titulo: 'Software Engineering Sprint Review',
                descripcion: 'Present continuous deployment pipeline in room LC2',
                tipo: 'tarea',
                categoria: 'universidad',
                estado: 'todo'
            }
        });
        assert.strictEqual(insertSeparatedRes.status, 201);
        const insertedBody = JSON.parse(insertSeparatedRes.body).item;
        assert.strictEqual(insertedBody.bloque, 'cole', 'Con hora 14:30 y categoría universidad debe auto-seleccionar bloque cole');
        assert.strictEqual(insertedBody.titulo, 'Software Engineering Sprint Review');
        assert.strictEqual(insertedBody.descripcion, 'Present continuous deployment pipeline in room LC2');
        assert.ok(insertedBody.actividad.includes('Software Engineering Sprint Review — Present continuous deployment pipeline'));

        // 6. Sincronizar horario ITS a la Agenda Semanal (respetando vacaciones)
        const syncRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/planner/sync-agenda',
            headers: { Cookie: adminCookie },
            body: { weekStartDate: '2026-11-16' }
        });
        assert.strictEqual(syncRes.status, 200);
        const syncBody = JSON.parse(syncRes.body);
        assert.ok(syncBody.inserted >= 5, 'Debe sincronizar las clases de la semana a la agenda');

        // Si sincronizamos en semana de vacaciones (2026-03-30 Semana Santa), no debe insertar clases
        const syncVacRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/planner/sync-agenda',
            headers: { Cookie: adminCookie },
            body: { weekStartDate: '2026-03-30' }
        });
        assert.strictEqual(syncVacRes.status, 200);
        const syncVacBody = JSON.parse(syncVacRes.body);
        assert.strictEqual(syncVacBody.inserted, 0, 'Durante periodo de vacaciones no debe programar clases');
    });

    it('aplica rate limit contra fuerza bruta en login y saturación DoS en endpoints API', async () => {
        // 1. Fuerza bruta en login (10 intentos fallidos -> el 11° devuelve 429 con Retry-After)
        let blockedLoginRes = null;
        for (let i = 1; i <= 12; i++) {
            const res = await request({
                port,
                method: 'POST',
                reqPath: '/api/auth/login',
                body: { email: 'medico@example.com', password: `WrongAttempt${i}!` }
            });
            if (res.status === 429) {
                blockedLoginRes = res;
                break;
            }
            assert.strictEqual(res.status, 401);
        }
        assert.ok(blockedLoginRes, 'Debe activar 429 Too Many Requests tras múltiples intentos fallidos de login');
        assert.ok(Number(blockedLoginRes.headers['retry-after']) >= 1, 'Debe incluir cabecera Retry-After');
        assert.ok(blockedLoginRes.headers['x-ratelimit-limit'], 'Debe incluir X-RateLimit-Limit');
        assert.strictEqual(blockedLoginRes.headers['x-ratelimit-remaining'], '0');

        // 2. Protección contra saturación en /api/pull-text (pcPullLimiter = 60 req/min por IP)
        let blockedPullRes = null;
        for (let i = 1; i <= 65; i++) {
            const res = await request({ port, reqPath: '/api/pull-text' });
            if (res.status === 429) {
                blockedPullRes = res;
                break;
            }
            assert.strictEqual(res.status, 200);
        }
        assert.ok(blockedPullRes, 'Debe devolver 429 al exceder el límite de peticiones en /api/pull-text');
        assert.ok(Number(blockedPullRes.headers['retry-after']) >= 1);
        assert.strictEqual(blockedPullRes.headers['x-ratelimit-remaining'], '0');
    });
});
