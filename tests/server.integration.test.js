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
    const crisisInserts = [];
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
        process.env.RATE_LIMIT_WRITE_MAX = '200';

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
                        { Field: 'materia_id' },
                        { Field: 'materia_nombre' },
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
                    const row = {
                        id: sleepInserts.length + 1,
                        fecha: params[0],
                        horas: params[1],
                        calidad: params[2],
                        hora_dormir: params[3] || null,
                        hora_despertar: params[4] || null,
                        es_desvelo: params[5] ?? 0,
                        tipo_registro: params[6] || 'normal',
                        motivo_desvelo: params[7] || null,
                        fecha_registro: '2026-11-15 09:00:00'
                    };
                    sleepInserts.push(row);
                    return finish(null, { insertId: row.id });
                }

                if (normalized.includes('FROM RegistrosSleep WHERE id = ?')) {
                    const targetId = Number(params[0]);
                    return finish(null, sleepInserts.filter((s) => s.id === targetId));
                }

                if (normalized.startsWith('UPDATE RegistrosSleep SET')) {
                    const targetId = Number(params[7]);
                    const row = sleepInserts.find((s) => s.id === targetId);
                    if (!row) return finish(null, { affectedRows: 0 });
                    row.hora_dormir = params[0];
                    row.hora_despertar = params[1];
                    row.horas = params[2];
                    row.calidad = params[3];
                    row.es_desvelo = params[4];
                    row.tipo_registro = params[5];
                    row.motivo_desvelo = params[6];
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.startsWith('DELETE FROM RegistrosSleep WHERE id = ?')) {
                    const idx = sleepInserts.findIndex((s) => s.id === Number(params[0]));
                    if (idx === -1) return finish(null, { affectedRows: 0 });
                    sleepInserts.splice(idx, 1);
                    return finish(null, { affectedRows: 1 });
                }

                if (normalized.includes('FROM RegistrosSleep WHERE fecha = ?')) {
                    const existing = sleepInserts.filter((s) => s.fecha === params[0]);
                    return finish(null, existing);
                }

                if (normalized.includes('FROM RegistrosSleep')) {
                    if (params.length === 2) {
                        const [begin, end] = params;
                        return finish(null, sleepInserts.filter((s) => s.fecha >= begin && s.fecha <= end));
                    }
                    return finish(null, sleepInserts);
                }

                if (normalized.startsWith('INSERT INTO RegistrosCrisis')) {
                    const row = {
                        id: crisisInserts.length + 1,
                        fecha: params[0],
                        hora: params[1],
                        tipo_crisis: params[2],
                        intensidad: Number(params[3]),
                        motivo: params[4],
                        fecha_registro: '2026-11-14 21:00:00'
                    };
                    crisisInserts.push(row);
                    return finish(null, { insertId: row.id });
                }

                if (normalized.includes('FROM RegistrosCrisis')) {
                    if (params.length === 2) {
                        const [begin, end] = params;
                        return finish(null, crisisInserts.filter((c) => c.fecha >= begin && c.fecha <= end));
                    }
                    return finish(null, [...crisisInserts].reverse());
                }

                if (normalized.startsWith('DELETE FROM RegistrosCrisis WHERE id = ?')) {
                    const idx = crisisInserts.findIndex((c) => c.id === Number(params[0]));
                    if (idx === -1) return finish(null, { affectedRows: 0 });
                    crisisInserts.splice(idx, 1);
                    return finish(null, { affectedRows: 1 });
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
                        recordatorio_min: params[8] ?? null,
                        materia_id: params[9] ?? null,
                        materia_nombre: params[10] ?? null
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
                    const id = Number(params[11]);
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
                    item.materia_id = params[9] ?? null;
                    item.materia_nombre = params[10] ?? null;
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

                if (normalized.startsWith('SELECT id FROM MusicaArtistas WHERE id = ? AND usuario_id = ?')) {
                    const [artistId, uid] = params;
                    const match = musicArtists.find((a) => a.id === Number(artistId) && a.usuario_id === Number(uid));
                    return finish(null, match ? [{ id: match.id }] : []);
                }

                if (normalized.startsWith('SELECT id FROM MusicaArtistas WHERE usuario_id = ? AND nombre_normalizado = ? AND id <> ?')) {
                    const [uid, norm, excludeId] = params;
                    const match = musicArtists.find(
                        (a) => a.usuario_id === Number(uid) && a.nombre_normalizado === norm && a.id !== Number(excludeId)
                    );
                    return finish(null, match ? [{ id: match.id }] : []);
                }

                if (normalized.startsWith('SELECT id FROM MusicaArtistas WHERE usuario_id = ? AND nombre_normalizado = ?')) {
                    const [uid, norm] = params;
                    const match = musicArtists.find((a) => a.usuario_id === Number(uid) && a.nombre_normalizado === norm);
                    return finish(null, match ? [{ id: match.id }] : []);
                }

                if (normalized.startsWith('UPDATE MusicaArtistas SET nombre = ?, tipo_artista = ? WHERE id = ? AND usuario_id = ?')) {
                    const [nombre, tipo, artistId, uid] = params;
                    const artist = musicArtists.find((a) => a.id === Number(artistId) && a.usuario_id === Number(uid));
                    if (artist) {
                        artist.nombre = nombre;
                        artist.tipo_artista = tipo;
                    }
                    return finish(null, { affectedRows: artist ? 1 : 0 });
                }

                if (normalized.startsWith('UPDATE MusicaArtistas SET nombre = ?, nombre_normalizado = ?, tipo_artista = ?, notas_cortas = ? WHERE id = ? AND usuario_id = ?')) {
                    const [nombre, norm, tipo, notasCortas, artistId, uid] = params;
                    const artist = musicArtists.find((a) => a.id === Number(artistId) && a.usuario_id === Number(uid));
                    if (artist) {
                        artist.nombre = nombre;
                        artist.nombre_normalizado = norm;
                        artist.tipo_artista = tipo;
                        artist.notas_cortas = notasCortas;
                    }
                    return finish(null, { affectedRows: artist ? 1 : 0 });
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

                if (normalized.startsWith('SELECT id FROM MusicaAlbumes WHERE id = ? AND usuario_id = ?')) {
                    const [albumId, uid] = params;
                    const match = musicAlbums.find((al) => al.id === Number(albumId) && al.usuario_id === Number(uid));
                    return finish(null, match ? [{ id: match.id }] : []);
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

                if (normalized.startsWith('UPDATE MusicaAlbumes SET titulo = ?, titulo_normalizado = ?, tipo_lanzamiento = ?, anio = ? WHERE id = ? AND usuario_id = ?')) {
                    const [titulo, norm, tipo, anio, albumId, uid] = params;
                    const alb = musicAlbums.find((a) => a.id === Number(albumId) && a.usuario_id === Number(uid));
                    if (alb) {
                        alb.titulo = titulo;
                        alb.titulo_normalizado = norm;
                        alb.tipo_lanzamiento = tipo;
                        alb.anio = anio;
                    }
                    return finish(null, { affectedRows: alb ? 1 : 0 });
                }

                if (normalized.startsWith('UPDATE MusicaAlbumes SET notas_cortas = ? WHERE id = ? AND usuario_id = ?')) {
                    const [notas, albumId, uid] = params;
                    const alb = musicAlbums.find((a) => a.id === Number(albumId) && a.usuario_id === Number(uid));
                    if (alb) alb.notas_cortas = notas;
                    return finish(null, { affectedRows: alb ? 1 : 0 });
                }

                if (normalized.startsWith('DELETE FROM MusicaAlbumes WHERE id = ? AND usuario_id = ?')) {
                    const [albumId, uid] = params;
                    const idx = musicAlbums.findIndex((a) => a.id === Number(albumId) && a.usuario_id === Number(uid));
                    if (idx !== -1) musicAlbums.splice(idx, 1);
                    return finish(null, { affectedRows: idx !== -1 ? 1 : 0 });
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

                if (normalized.startsWith('UPDATE MusicaCanciones SET album_id = NULL WHERE album_id = ? AND usuario_id = ?')) {
                    const [albumId, uid] = params;
                    let count = 0;
                    musicSongs.forEach((s) => {
                        if (s.album_id === Number(albumId) && s.usuario_id === Number(uid)) {
                            s.album_id = null;
                            count++;
                        }
                    });
                    return finish(null, { affectedRows: count });
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

                if (normalized.startsWith('SELECT id, titulo, idioma, yt_music_url, yt_video_id FROM MusicaCanciones WHERE id = ? AND usuario_id = ?')) {
                    const [songId, uid] = params;
                    const match = musicSongs.find((c) => c.id === Number(songId) && c.usuario_id === Number(uid));
                    return finish(null, match ? [match] : []);
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
        assert.strictEqual(res.headers['permissions-policy'], 'geolocation=(self), microphone=(), camera=()');
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
        assert.strictEqual(nearData.planner.locations.current.label, 'En el Tec de Saltillo');
        const nearPrincipal = nearData.commutes.find((c) => c.campusKey === 'principal');
        assert.strictEqual(nearPrincipal.isNearCampus, true);
        assert.strictEqual(nearPrincipal.recommendedLeadMinutes, 10, 'Si ya está en o cerca del ITS debe notificar 10 minutos antes');

        const embedMapsRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/planner/location',
            headers: { Cookie: adminCookie },
            body: {
                mapsUrl: 'https://www.google.com/maps/place/ITS/@25.443706,-100.993845,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d25.44395!4d-100.98965',
                label: 'Campus Boillot'
            }
        });
        assert.strictEqual(embedMapsRes.status, 200);

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

        // 7. Vincular tarea universitaria con clase actual y limpiar automáticamente si cambia a Personal
        const plannerForTask = JSON.parse((await request({ port, reqPath: '/api/planner', headers: { Cookie: adminCookie } })).body).planner;
        const activeCourse = plannerForTask.semesters[0].courses[0];
        assert.ok(activeCourse && activeCourse.id && activeCourse.name);

        const badClassTask = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-agenda',
            headers: { Cookie: adminCookie },
            body: {
                fecha: '2026-11-18',
                hora: '11:00',
                titulo: 'Entrega Unidad 2',
                tipo: 'tarea',
                categoria: 'universidad',
                materia_id: 'curso-inexistente-999'
            }
        });
        assert.strictEqual(badClassTask.status, 400);

        const classTaskRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-agenda',
            headers: { Cookie: adminCookie },
            body: {
                fecha: '2026-11-18',
                hora: '11:15',
                titulo: 'Práctica de Laboratorio 2',
                tipo: 'tarea',
                categoria: 'universidad',
                materia_id: activeCourse.id,
                estado: 'todo'
            }
        });
        assert.strictEqual(classTaskRes.status, 201);
        const classTaskItem = JSON.parse(classTaskRes.body).item;
        assert.strictEqual(classTaskItem.materia_id, activeCourse.id);
        assert.strictEqual(classTaskItem.materia_nombre, activeCourse.name);

        const readClassAgenda = JSON.parse((await request({
            port,
            reqPath: '/api/get-agenda?begin=2026-11-18&end=2026-11-18',
            headers: { Cookie: adminCookie }
        })).body);
        const fetchedClassTask = readClassAgenda.find((i) => i.id === classTaskItem.id);
        assert.ok(fetchedClassTask);
        assert.strictEqual(fetchedClassTask.materia_id, activeCourse.id);
        assert.strictEqual(fetchedClassTask.materia_nombre, activeCourse.name);

        const toPersonalRes = await request({
            port,
            method: 'PUT',
            reqPath: `/api/update-agenda/${classTaskItem.id}`,
            headers: { Cookie: adminCookie },
            body: {
                fecha: '2026-11-18',
                bloque: 'tarde',
                hora: '18:00',
                titulo: 'Mandado personal',
                tipo: 'tarea',
                categoria: 'personal',
                materia_id: activeCourse.id,
                materia_nombre: activeCourse.name,
                estado: 'todo'
            }
        });
        assert.strictEqual(toPersonalRes.status, 200);
        const personalItem = JSON.parse(toPersonalRes.body).item;
        assert.strictEqual(personalItem.categoria, 'personal');
        assert.strictEqual(personalItem.materia_id, null);
        assert.strictEqual(personalItem.materia_nombre, null);
    });

    it('soporta túnel de transporte cifrado X25519 + AES-256-CTR + HMAC-SHA256 para grandes volúmenes, rechaza manipulación/replay y expone Studio Multilingüe EN/KR/K-Pop', async () => {
        const clientTC = require('../public/transport-crypto');
        const tunnel = clientTC.createClientTunnel();
        const kp = clientTC.generateX25519KeyPair();

        // 1. Handshake asimétrico X25519 efímero con el servidor HTTP
        const hsRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/transport/handshake',
            body: { clientPub: Buffer.from(kp.publicKey).toString('base64') }
        });
        assert.strictEqual(hsRes.status, 200);
        const hsJson = JSON.parse(hsRes.body);
        assert.strictEqual(hsJson.protocol, 'x25519-aes256ctr-hmac-v1');
        tunnel.deriveSessionFromHandshake(kp.privateKey, hsJson);

        // 2. Payload grande (192 KB) viajando cifrado en petición Y respuesta (sin texto plano en red)
        const bigText = 'K-POP-ENCRYPTED-STREAM-'.repeat(8550); // ~196 KB
        assert.ok(bigText.length >= 190000);
        const envBig = tunnel.encryptText(JSON.stringify({ samplePayload: bigText, echo: false }));
        assert.ok(!envBig.ct.includes('K-POP-ENCRYPTED-STREAM'), 'El texto plano no debe viajar visible en ciphertext');

        const benchRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/transport/benchmark',
            headers: {
                Cookie: adminCookie,
                'X-Transport-Session': hsJson.kid,
                'X-Transport-Accept-Enc': '1'
            },
            body: envBig
        });
        assert.strictEqual(benchRes.status, 200);
        assert.strictEqual(benchRes.headers['x-transport-encrypted'], 'x25519-aes256ctr-hmac-v1');
        const encBenchEnv = JSON.parse(benchRes.body);
        assert.strictEqual(encBenchEnv.__enc, 'x25519-aes256ctr-hmac-v1');
        const decBench = JSON.parse(tunnel.decryptEnvelope(encBenchEnv, 's2c'));
        assert.strictEqual(decBench.encryptedIn, true);
        assert.ok(decBench.payloadBytes >= 190000);

        // 3. Defensa Encrypt-then-MAC contra manipulación del paquete (MITM bit-flip) y Replay
        const tamperedEnv = { ...envBig, ct: `${envBig.ct.slice(0, -4)}AAAA` };
        const tamperedRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/transport/benchmark',
            headers: { Cookie: adminCookie, 'X-Transport-Session': hsJson.kid },
            body: tamperedEnv
        });
        assert.strictEqual(tamperedRes.status, 400);
        assert.strictEqual(JSON.parse(tamperedRes.body).code, 'TRANSPORT_MAC_INVALID');

        const replayRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/transport/benchmark',
            headers: { Cookie: adminCookie, 'X-Transport-Session': hsJson.kid },
            body: envBig
        });
        assert.strictEqual(replayRes.status, 409);
        assert.strictEqual(JSON.parse(replayRes.body).code, 'TRANSPORT_REPLAY');

        // 4. Registro multilingüe, Romanización Hangul algorítmica y Analizador K-Pop EN+KR cifrado en tránsito
        const regRes = await request({
            port,
            reqPath: '/api/language/registry',
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(regRes.status, 200);
        const regJson = JSON.parse(regRes.body);
        assert.ok(regJson.languages.some((l) => l.id === 'ko'));
        assert.ok(regJson.languages.some((l) => l.id === 'en_ko'));

        const romRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/language/romanize',
            headers: { Cookie: adminCookie },
            body: { text: '사랑해 마음에 없어' }
        });
        assert.strictEqual(romRes.status, 200);
        assert.strictEqual(JSON.parse(romRes.body).romanization, 'saranghae maeume eopseo');

        const analyzeEnv = tunnel.encryptText(JSON.stringify({
            text: "I wanna hold on\n영원히 너의 마음에",
            language: 'en_ko',
            songTitle: 'Golden Hour',
            mode: 'offline'
        }));
        const analyzeRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/language/analyze',
            headers: {
                Cookie: adminCookie,
                'X-Transport-Session': hsJson.kid,
                'X-Transport-Accept-Enc': '1'
            },
            body: analyzeEnv
        });
        assert.strictEqual(analyzeRes.status, 200);
        const analyzeJson = JSON.parse(tunnel.decryptEnvelope(JSON.parse(analyzeRes.body), 's2c'));
        assert.strictEqual(analyzeJson.engine, 'local-linguistic');
        assert.strictEqual(analyzeJson.language, 'en_ko');
        assert.ok(analyzeJson.lines.some((l) => l.romanization.includes('yeongwonhi')));
        assert.ok(analyzeJson.vocabulary.some((v) => v.term === 'hold on' || v.term === '영원히'));
        assert.ok(analyzeJson.languageMemory && Array.isArray(analyzeJson.languageMemory.terms));
        assert.ok(analyzeJson.languageMemory.terms.length >= 1, 'Debe guardar vocabulario aprendido en languageMemory');

        // 4b. Consistencia de memoria de IA: al volver a estudiar una palabra ya vista, la recuerda de languageMemory
        const addMemRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/language/memory',
            headers: { Cookie: adminCookie },
            body: {
                terms: [{
                    term: '별빛',
                    romanization: 'byeolbit',
                    meaning: 'Starlight / Luz de las estrellas (saved by student)',
                    category: 'vocabulary',
                    language: 'ko'
                }]
            }
        });
        assert.strictEqual(addMemRes.status, 200);

        const secondAnalyzeRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/language/analyze',
            headers: { Cookie: adminCookie },
            body: {
                text: '밤하늘의 별빛 아래에서 hold on',
                language: 'en_ko',
                mode: 'offline'
            }
        });
        assert.strictEqual(secondAnalyzeRes.status, 200);
        const secondAnalyzeJson = JSON.parse(secondAnalyzeRes.body);
        assert.ok(
            Array.isArray(secondAnalyzeJson.recognizedFromMemory) &&
            secondAnalyzeJson.recognizedFromMemory.some((m) => m.term === '별빛' && m.meaning.includes('Starlight')),
            'La IA debe recordar términos aprendidos previamente y mantener su definición consistente'
        );
        assert.ok(
            secondAnalyzeJson.vocabulary.some((v) => v.term === '별빛' && v.learnedPreviously === true),
            'El vocabulario devuelto debe marcar learnedPreviously=true para palabras ya estudiadas'
        );

        // 4c. Recordatorios activos incluyen targetDate y targetMoment para autoseleccionar fecha y bloque al tocar la notificación
        const remCheckRes = await request({
            port,
            method: 'GET',
            reqPath: '/api/reminders/active',
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(remCheckRes.status, 200);
        const remCheckJson = JSON.parse(remCheckRes.body);
        if (Array.isArray(remCheckJson.active)) {
            for (const rem of remCheckJson.active) {
                if (rem.type === 'mood') {
                    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(rem.targetDate), 'Mood reminder debe incluir targetDate YYYY-MM-DD');
                    assert.ok(rem.targetMoment, 'Mood reminder debe incluir targetMoment');
                }
            }
        }

        // 5. Gemini API Key se guarda en ConfiguracionUsuario pero nunca se devuelve en texto plano en GET/PUT settings
        const saveAiSettingsRes = await request({
            port,
            method: 'PUT',
            reqPath: '/api/settings',
            headers: { Cookie: adminCookie },
            body: {
                preferredStudyLanguage: 'ko',
                geminiModel: 'gemini-2.5-pro',
                geminiApiKey: 'AIzaSyFakeIntegrationKey987654'
            }
        });
        assert.strictEqual(saveAiSettingsRes.status, 200);
        const savedSetJson = JSON.parse(saveAiSettingsRes.body).settings;
        assert.strictEqual(savedSetJson.preferredStudyLanguage, 'ko');
        assert.strictEqual(savedSetJson.geminiModel, 'gemini-2.5-pro');
        assert.strictEqual(savedSetJson.geminiApiKeyConfigured, true);
        assert.strictEqual(savedSetJson.geminiApiKey, undefined, 'La API key cruda nunca debe exponerse al cliente');
        assert.ok(savedSetJson.geminiApiKeyHint.startsWith('AIza'));
    });

    it('permite registrar crisis en español, las expone en modo solo lectura al psiquiatra y reconoce el repertorio musical en la IA', async () => {
        // 1. Admin registra crisis con fecha, hora, tipo, intensidad y motivo en español
        const createCrisisRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-crisis',
            headers: { Cookie: adminCookie },
            body: {
                fecha: '2026-11-14',
                hora: '21:15',
                tipoCrisis: 'Estrés',
                intensidad: 4,
                motivo: 'Sobrecarga por entregas de proyecto y falta de descanso.'
            }
        });
        assert.strictEqual(createCrisisRes.status, 200);
        const createdCrisis = JSON.parse(createCrisisRes.body);
        assert.strictEqual(createdCrisis.ok, true);
        assert.ok(createdCrisis.id > 0);

        // 2. Tanto admin como psiquiatra (solo lectura) pueden consultar las crisis de la semana
        const medicoCrisisRes = await request({
            port,
            method: 'GET',
            reqPath: '/api/get-crisis?begin=2026-11-08&end=2026-11-14',
            headers: { Cookie: medicoCookie }
        });
        assert.strictEqual(medicoCrisisRes.status, 200);
        const medicoCrisisList = JSON.parse(medicoCrisisRes.body);
        assert.ok(
            Array.isArray(medicoCrisisList) &&
            medicoCrisisList.some((c) => c.tipo_crisis === 'Estrés' && c.motivo.includes('Sobrecarga por entregas')),
            'El psiquiatra debe poder leer las crisis registradas'
        );

        // 3. Psiquiatra no puede insertar ni borrar crisis (RBAC 403)
        const medicoWriteCrisisRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-crisis',
            headers: { Cookie: medicoCookie },
            body: {
                fecha: '2026-11-14',
                hora: '21:30',
                tipoCrisis: 'Ira / Rabia',
                intensidad: 3,
                motivo: 'Intento bloqueado por RBAC'
            }
        });
        assert.strictEqual(medicoWriteCrisisRes.status, 403);

        const medicoDelCrisisRes = await request({
            port,
            method: 'DELETE',
            reqPath: `/api/delete-crisis/${createdCrisis.id}`,
            headers: { Cookie: medicoCookie }
        });
        assert.strictEqual(medicoDelCrisisRes.status, 403);

        // 4. IA de idiomas reconoce canciones ya registradas en el catálogo musical del usuario
        const addSongRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/songs',
            headers: { Cookie: adminCookie },
            body: {
                titulo: 'DRIP',
                mainArtist: 'BABYMONSTER',
                mainArtistType: 'group',
                albumTitle: 'DRIP',
                albumType: 'album',
                albumYear: 2024,
                idioma: 'English + Korean (K-Pop)',
                enfoqueCorto: 'Chorus idioms & rapid transitions'
            }
        });
        assert.ok([200, 201].includes(addSongRes.status));

        const aiRepertoireRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/language/analyze',
            headers: { Cookie: adminCookie },
            body: {
                text: 'BABYMONSTER DRIP\n너의 마음에 닿기를',
                question: 'Explain this song from my repertoire',
                language: 'en_ko',
                mode: 'offline'
            }
        });
        assert.strictEqual(aiRepertoireRes.status, 200);
        const aiRepJson = JSON.parse(aiRepertoireRes.body);
        assert.ok(
            Array.isArray(aiRepJson.matchedRepertoireSongs) &&
            aiRepJson.matchedRepertoireSongs.some((s) => s.titulo === 'DRIP'),
            'La IA debe reconocer canciones registradas en el repertorio del usuario'
        );

        // 5. Admin puede eliminar un registro de crisis
        const delCrisisRes = await request({
            port,
            method: 'DELETE',
            reqPath: `/api/delete-crisis/${createdCrisis.id}`,
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(delCrisisRes.status, 200);
    });

    it('permite editar canciones existentes, artistas y álbumes en el catálogo musical con validación de duplicados', async () => {
        // 1. Crear canción con artista y álbum únicos para esta prueba
        const createFirst = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/songs',
            headers: { Cookie: adminCookie },
            body: {
                titulo: 'Strategy',
                mainArtist: 'twice',
                artistType: 'group',
                albumTitle: 'STRATEGY',
                albumType: 'mini_album',
                albumYear: 2024,
                idioma: 'English + Korean (K-Pop)'
            }
        });
        assert.strictEqual(createFirst.status, 201);
        const createdFirst = JSON.parse(createFirst.body);

        // Crear un segundo artista para probar detección 409 de duplicados al renombrar
        const createSecond = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/songs',
            headers: { Cookie: adminCookie },
            body: {
                titulo: 'ABCD',
                mainArtist: 'NAYEON',
                artistType: 'solo',
                albumTitle: 'NA',
                albumType: 'mini_album',
                albumYear: 2024,
                idioma: 'English + Korean (K-Pop)'
            }
        });
        assert.strictEqual(createSecond.status, 201);

        // 2. PUT /api/english/music/songs/:id actualiza metadatos de la canción y formato/capitalización del artista
        const updateSongRes = await request({
            port,
            method: 'PUT',
            reqPath: `/api/english/music/songs/${createdFirst.songId}`,
            headers: { Cookie: adminCookie },
            body: {
                titulo: 'Strategy (Extended Ver.)',
                mainArtist: 'TWICE',
                artistType: 'duo',
                albumTitle: 'STRATEGY',
                albumType: 'mini_album',
                albumYear: 2024,
                idioma: 'English + Korean (K-Pop)',
                estadoEstudio: 'in_progress',
                enfoqueCorto: 'Updated chorus idioms'
            }
        });
        assert.strictEqual(updateSongRes.status, 200);

        const catalogAfterSongEdit = await request({
            port,
            reqPath: '/api/english/music/catalog',
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(catalogAfterSongEdit.status, 200);
        const catJson1 = JSON.parse(catalogAfterSongEdit.body);
        const targetArtist = catJson1.artists.find((a) => a.nombre === 'TWICE');
        const targetAlbum = catJson1.albums.find((al) => al.titulo === 'STRATEGY');
        const targetSong = catJson1.songs.find((s) => s.id === createdFirst.songId);
        assert.ok(targetArtist, 'Debe actualizar capitalización del artista existente');
        assert.strictEqual(targetArtist.tipo_artista, 'duo');
        assert.ok(targetAlbum);
        assert.strictEqual(targetSong.titulo, 'Strategy (Extended Ver.)');
        assert.strictEqual(targetSong.estado_estudio, 'in_progress');

        // 3. PATCH /api/english/music/artists/:id rechaza renombrado duplicado (409) y guarda edición válida
        const conflictArtistRes = await request({
            port,
            method: 'PATCH',
            reqPath: `/api/english/music/artists/${targetArtist.id}`,
            headers: { Cookie: adminCookie },
            body: { nombre: 'NAYEON', tipoArtista: 'group' }
        });
        assert.strictEqual(conflictArtistRes.status, 409);

        const patchArtistRes = await request({
            port,
            method: 'PATCH',
            reqPath: `/api/english/music/artists/${targetArtist.id}`,
            headers: { Cookie: adminCookie },
            body: {
                nombre: 'TWICE Official',
                tipoArtista: 'group',
                notasCortas: '9-member JYP girl group'
            }
        });
        assert.strictEqual(patchArtistRes.status, 200);

        // 4. PATCH /api/english/music/albums/:id edita título, tipo y año de lanzamiento
        const patchAlbumRes = await request({
            port,
            method: 'PATCH',
            reqPath: `/api/english/music/albums/${targetAlbum.id}`,
            headers: { Cookie: adminCookie },
            body: {
                titulo: 'STRATEGY (14th Mini Album)',
                tipoLanzamiento: 'mini_album',
                anio: 2025
            }
        });
        assert.strictEqual(patchAlbumRes.status, 200);

        const finalCatalog = await request({
            port,
            reqPath: '/api/english/music/catalog',
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(finalCatalog.status, 200);
        const finalJson = JSON.parse(finalCatalog.body);
        const updatedArtist = finalJson.artists.find((a) => a.id === targetArtist.id);
        const updatedSong = finalJson.songs.find((s) => s.id === createdFirst.songId);
        assert.strictEqual(updatedArtist.nombre, 'TWICE Official');
        assert.strictEqual(updatedArtist.tipo_artista, 'group');
        assert.strictEqual(updatedArtist.notas_cortas, '9-member JYP girl group');
        assert.strictEqual(updatedSong.album_titulo, 'STRATEGY (14th Mini Album)');
        assert.strictEqual(updatedSong.album_anio, 2025);
        assert.ok(updatedSong.artists.some((a) => a.nombre === 'TWICE Official'));
    });

    it('registra desvelos, dormir a las 3 AM y trasnoches (0 hrs) y los muestra en modo solo lectura al psiquiatra', async () => {
        // 1. Dormir a las 03:00 AM auto-detecta es_desvelo=1 y tipo_registro='desvelo_tarde'
        const lateSleepRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-sleep',
            headers: { Cookie: adminCookie },
            body: {
                fecha: '2026-11-16',
                horaDormir: '03:00',
                horaDespertar: '08:30',
                horas: 5.5,
                calidad: 'Regular',
                motivoDesvelo: 'Me dormí a las 3 de la mañana terminando un proyecto'
            }
        });
        assert.strictEqual(lateSleepRes.status, 200);

        // 2. Desvelo en curso (03:00 AM sin despertar aún) + PATCH al despertar
        const pendingBedRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-sleep',
            headers: { Cookie: adminCookie },
            body: {
                fecha: '2026-11-17',
                horaDormir: '03:00',
                horaDespertar: '',
                horas: 0,
                calidad: 'Regular',
                tipoRegistro: 'desvelo_tarde'
            }
        });
        assert.strictEqual(pendingBedRes.status, 200);

        // 3. Desvelo total (0 hrs sin dormir)
        const allNighterRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/insert-sleep',
            headers: { Cookie: adminCookie },
            body: {
                fecha: '2026-11-18',
                horaDormir: '03:00',
                horas: 0,
                calidad: 'Bad',
                tipoRegistro: 'desvelo_total',
                motivoDesvelo: 'Insomnio agudo, pasé la noche en vela'
            }
        });
        assert.strictEqual(allNighterRes.status, 200);

        // 4. El psiquiatra consulta GET /api/get-sleep y ve todos los campos de desvelo en solo lectura
        const psychReadRes = await request({
            port,
            reqPath: '/api/get-sleep?begin=2026-11-16&end=2026-11-18',
            headers: { Cookie: medicoCookie }
        });
        assert.strictEqual(psychReadRes.status, 200);
        const rows = JSON.parse(psychReadRes.body);
        const rowLate = rows.find((r) => r.fecha === '2026-11-16');
        const rowPending = rows.find((r) => r.fecha === '2026-11-17');
        const rowTotal = rows.find((r) => r.fecha === '2026-11-18');
        assert.ok(rowLate && rowPending && rowTotal);
        assert.strictEqual(rowLate.hora_dormir, '03:00');
        assert.strictEqual(rowLate.hora_despertar, '08:30');
        assert.strictEqual(Number(rowLate.es_desvelo), 1);
        assert.strictEqual(rowLate.tipo_registro, 'desvelo_tarde');
        assert.strictEqual(rowTotal.tipo_registro, 'desvelo_total');
        assert.strictEqual(Number(rowTotal.horas), 0);
        assert.match(rowTotal.motivo_desvelo, /Insomnio/i);

        // 5. Psiquiatra recibe 403 al intentar actualizar o eliminar sueño
        const psychPatch = await request({
            port,
            method: 'PATCH',
            reqPath: `/api/update-sleep/${rowPending.id}`,
            headers: { Cookie: medicoCookie },
            body: { horaDespertar: '09:00', horas: 6, calidad: 'Good' }
        });
        assert.strictEqual(psychPatch.status, 403);

        const psychDel = await request({
            port,
            method: 'DELETE',
            reqPath: `/api/delete-sleep/${rowPending.id}`,
            headers: { Cookie: medicoCookie }
        });
        assert.strictEqual(psychDel.status, 403);

        // 6. Admin completa hora de despertar del registro de las 3:00 AM y puede eliminar un registro
        const adminPatch = await request({
            port,
            method: 'PATCH',
            reqPath: `/api/update-sleep/${rowPending.id}`,
            headers: { Cookie: adminCookie },
            body: {
                horaDespertar: '09:00',
                horas: 6,
                calidad: 'Good',
                motivoDesvelo: 'Desperté a las 9 AM tras dormirme a las 3 AM'
            }
        });
        assert.strictEqual(adminPatch.status, 200);

        const psychAfterPatch = await request({
            port,
            reqPath: '/api/get-sleep?begin=2026-11-17&end=2026-11-17',
            headers: { Cookie: medicoCookie }
        });
        const updatedRow = JSON.parse(psychAfterPatch.body)[0];
        assert.strictEqual(updatedRow.hora_despertar, '09:00');
        assert.strictEqual(Number(updatedRow.horas), 6);
        assert.strictEqual(Number(updatedRow.es_desvelo), 1);

        const adminDel = await request({
            port,
            method: 'DELETE',
            reqPath: `/api/delete-sleep/${rowPending.id}`,
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(adminDel.status, 200);
    });

    it('rechaza coordenadas Null Island (0,0), soporta Casa/direcciones y webhook GPS HTTP del teléfono con token rotativo', async () => {
        // 1. Null Island (0,0) debe rechazarse con 400 en /api/planner/location
        for (const badBody of [
            { target: 'home', lat: 0, lng: 0 },
            { target: 'current', mapsUrl: '0.000000, 0.000000' },
            { target: 'current', mapsUrl: 'https://www.google.com/maps?q=0,0' }
        ]) {
            const badRes = await request({
                port,
                method: 'POST',
                reqPath: '/api/planner/location',
                headers: { Cookie: adminCookie },
                body: badBody
            });
            assert.strictEqual(badRes.status, 400, `Debe rechazar coordenadas inválidas (0,0): ${JSON.stringify(badBody)}`);
        }

        // 2. PUT /api/planner sanea lat=0,lng=0 heredados a null y nunca genera origin=0,0 en Maps
        const plannerBase = JSON.parse((await request({ port, reqPath: '/api/planner', headers: { Cookie: adminCookie } })).body).planner;
        plannerBase.locations.home = {
            label: 'Mi Casa',
            address: 'Margarita Maza de Juárez 924, Saltillo',
            mapsUrl: '',
            lat: 0,
            lng: 0
        };
        plannerBase.locations.current = {
            label: 'Ubicación actual',
            lat: 0,
            lng: 0,
            updatedAt: null,
            source: 'gps'
        };
        const sanitizedPut = await request({
            port,
            method: 'PUT',
            reqPath: '/api/planner',
            headers: { Cookie: adminCookie },
            body: { planner: plannerBase }
        });
        assert.strictEqual(sanitizedPut.status, 200);
        const putData = JSON.parse(sanitizedPut.body);
        assert.strictEqual(putData.planner.locations.home.lat, null);
        assert.strictEqual(putData.planner.locations.home.lng, null);
        assert.strictEqual(putData.planner.locations.current.lat, null);
        assert.strictEqual(putData.planner.locations.current.lng, null);
        for (const c of putData.commutePreview.commutes) {
            assert.ok(!c.mapsDirectionsUrl.includes('origin=0'), `No debe generar origin=0,0 en Maps: ${c.mapsDirectionsUrl}`);
        }

        // 3. Prioridad exacta !3d!4d sobre @ viewport al guardar Casa y decodificación de %2C
        const saveHomeRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/planner/location',
            headers: { Cookie: adminCookie },
            body: {
                target: 'home',
                label: 'Mi Casa Saltillo',
                address: 'Margarita Maza de Juárez 924, Saltillo',
                mapsUrl: 'https://www.google.com/maps/place/Casa/@25.440000,-101.010000,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d25.431683!4d-100.992006?entry=ttu'
            }
        });
        assert.strictEqual(saveHomeRes.status, 200);
        const savedHomeBody = JSON.parse(saveHomeRes.body);
        assert.strictEqual(savedHomeBody.planner.locations.home.lat, 25.431683);
        assert.strictEqual(savedHomeBody.planner.locations.home.lng, -100.992006);
        assert.strictEqual(savedHomeBody.planner.locations.home.label, 'Mi Casa Saltillo');

        // Clear current GPS -> origen vuelve a Casa guardada
        const clearRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/planner/location',
            headers: { Cookie: adminCookie },
            body: { target: 'clear_current' }
        });
        assert.strictEqual(clearRes.status, 200);
        const clearBody = JSON.parse(clearRes.body);
        assert.strictEqual(clearBody.commutePreview.originKind, 'home');
        assert.strictEqual(clearBody.commutePreview.originCoords.lat, 25.431683);
        assert.strictEqual(clearBody.commutePreview.originSource, 'Mi Casa Saltillo');

        // %2C encoded Maps query URL
        const encodedUrlRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/planner/location',
            headers: { Cookie: adminCookie },
            body: { target: 'current', mapsUrl: 'https://www.google.com/maps?q=25.432100%2C-100.991234', label: 'Encoded Link' }
        });
        assert.strictEqual(encodedUrlRes.status, 200);
        assert.strictEqual(JSON.parse(encodedUrlRes.body).planner.locations.current.lat, 25.4321);

        // 4. Phone GPS HTTP Webhook: RBAC, token secreto (no expuesto en /api/planner), GET/POST y rotación
        const psychTokenRes = await request({ port, reqPath: '/api/planner/phone-gps-token', headers: { Cookie: medicoCookie } });
        assert.strictEqual(psychTokenRes.status, 403);

        const plannerCheckRes = await request({ port, reqPath: '/api/planner', headers: { Cookie: adminCookie } });
        const plannerCheckBody = JSON.parse(plannerCheckRes.body);
        assert.strictEqual(plannerCheckBody.planner.phoneGpsNonce, undefined, 'No debe exponer el nonce raw al cliente');

        const tokenRes = await request({ port, reqPath: '/api/planner/phone-gps-token', headers: { Cookie: adminCookie } });
        assert.strictEqual(tokenRes.status, 200);
        const tokenBody = JSON.parse(tokenRes.body);
        assert.ok(tokenBody.token && tokenBody.webhookPostUrl.includes('/api/planner/phone-location?token='));

        const badPhoneZero = await request({
            port,
            method: 'GET',
            reqPath: `/api/planner/phone-location?token=${encodeURIComponent(tokenBody.token)}&lat=0&lng=0`
        });
        assert.strictEqual(badPhoneZero.status, 400);

        const okPhoneGet = await request({
            port,
            method: 'GET',
            reqPath: `/api/planner/phone-location?token=${encodeURIComponent(tokenBody.token)}&lat=25.439123&lng=-100.995456`
        });
        assert.strictEqual(okPhoneGet.status, 200);
        const phoneGetBody = JSON.parse(okPhoneGet.body);
        assert.strictEqual(phoneGetBody.ok, true);
        assert.strictEqual(phoneGetBody.location.lat, 25.439123);
        assert.strictEqual(phoneGetBody.location.lng, -100.995456);
        assert.strictEqual(phoneGetBody.commutePreview.originKind, 'current');

        const okPhonePost = await request({
            port,
            method: 'POST',
            reqPath: `/api/planner/phone-location?token=${encodeURIComponent(tokenBody.token)}`,
            body: { lat: 25.441234, lng: -100.994321, label: 'OPPO A79 GPS', source: 'macrodroid_gps' }
        });
        assert.strictEqual(okPhonePost.status, 200);
        assert.strictEqual(JSON.parse(okPhonePost.body).location.source, 'macrodroid_gps');

        // Rotación revoca token anterior
        const rotateRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/planner/phone-gps-token/rotate',
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(rotateRes.status, 200);
        const rotateBody = JSON.parse(rotateRes.body);
        assert.notStrictEqual(rotateBody.token, tokenBody.token);

        const revokedAttempt = await request({
            port,
            method: 'POST',
            reqPath: `/api/planner/phone-location?token=${encodeURIComponent(tokenBody.token)}`,
            body: { lat: 25.441, lng: -100.994 }
        });
        assert.strictEqual(revokedAttempt.status, 401);

        const newTokenAttempt = await request({
            port,
            method: 'POST',
            reqPath: `/api/planner/phone-location?token=${encodeURIComponent(rotateBody.token)}`,
            body: { lat: 25.442, lng: -100.993 }
        });
        assert.strictEqual(newTokenAttempt.status, 200);

        // Ping sin ntfy configurado debe responder 400 claro
        const pingNoNtfyRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/planner/request-phone-gps',
            headers: { Cookie: adminCookie },
            body: {}
        });
        assert.strictEqual(pingNoNtfyRes.status, 400);
    });

    it('crea álbum/mini álbum, agrega canción al álbum, edita nombre/vínculo y elimina álbum preservando canciones', async () => {
        // 1. Crear Mini Álbum vacío primero
        const createAlbumRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/albums',
            headers: { Cookie: adminCookie },
            body: {
                mainArtist: 'AESPA',
                artistType: 'group',
                albumTitle: 'Whiplash',
                albumType: 'mini_album',
                albumYear: 2024,
                notasCortas: '5th Mini Album'
            }
        });
        assert.strictEqual(createAlbumRes.status, 201);
        const createdAlbumJson = JSON.parse(createAlbumRes.body);
        const albumId = createdAlbumJson.album.id;
        assert.ok(albumId);
        assert.strictEqual(createdAlbumJson.album.tipo_lanzamiento, 'mini_album');

        // Catálogo debe mostrar el Mini Álbum aún vacío
        const emptyCatRes = await request({
            port,
            reqPath: '/api/english/music/catalog',
            headers: { Cookie: adminCookie }
        });
        const emptyCatJson = JSON.parse(emptyCatRes.body);
        const createdAlbRow = emptyCatJson.albums.find((a) => a.id === albumId);
        assert.ok(createdAlbRow);
        assert.strictEqual(createdAlbRow.notas_cortas, '5th Mini Album');

        // 2. Agregar canción directamente al Mini Álbum creado
        const addSongRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/songs',
            headers: { Cookie: adminCookie },
            body: {
                titulo: 'Whiplsh Draft',
                mainArtist: 'AESPA',
                artistType: 'group',
                albumTitle: 'Whiplash',
                albumType: 'mini_album',
                albumYear: 2024,
                trackNumber: 1,
                idioma: 'English + Korean (K-Pop)',
                ytMusicUrl: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ'
            }
        });
        assert.strictEqual(addSongRes.status, 201);
        const { songId } = JSON.parse(addSongRes.body);

        // 3. Editar título y vínculo YouTube de la canción (CRUD completo)
        const editSongRes = await request({
            port,
            method: 'PUT',
            reqPath: `/api/english/music/songs/${songId}`,
            headers: { Cookie: adminCookie },
            body: {
                titulo: 'Whiplash',
                mainArtist: 'AESPA',
                artistType: 'group',
                albumTitle: 'Whiplash',
                albumType: 'mini_album',
                albumYear: 2024,
                trackNumber: 1,
                idioma: 'English + Korean (K-Pop)',
                ytMusicUrl: 'https://www.youtube.com/watch?v=jWQx2f-CErU'
            }
        });
        assert.strictEqual(editSongRes.status, 200);

        const afterEditRes = await request({
            port,
            reqPath: '/api/english/music/catalog',
            headers: { Cookie: adminCookie }
        });
        const afterEditSong = JSON.parse(afterEditRes.body).songs.find((s) => s.id === songId);
        assert.strictEqual(afterEditSong.titulo, 'Whiplash');
        assert.strictEqual(afterEditSong.yt_video_id, 'jWQx2f-CErU');

        // 4. Eliminar álbum conserva la canción como track suelto
        const delAlbumRes = await request({
            port,
            method: 'DELETE',
            reqPath: `/api/english/music/albums/${albumId}`,
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(delAlbumRes.status, 200);

        const afterDelRes = await request({
            port,
            reqPath: '/api/english/music/catalog',
            headers: { Cookie: adminCookie }
        });
        const afterDelCat = JSON.parse(afterDelRes.body);
        assert.ok(!afterDelCat.albums.some((a) => a.id === albumId));
        const preservedSong = afterDelCat.songs.find((s) => s.id === songId);
        assert.ok(preservedSong);
        assert.strictEqual(preservedSong.album_id, null);
    });

    it('traduce inglés->español y coreano->inglés desde POST /api/language/translate y alimenta la memoria', async () => {
        // 1. Validación texto vacío -> 400
        const emptyRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/language/translate',
            headers: { Cookie: adminCookie },
            body: { text: '   ', direction: 'en_es', mode: 'offline' }
        });
        assert.strictEqual(emptyRes.status, 400);

        // 2. Inglés -> Español (frase / vocabulario)
        const enEsRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/language/translate',
            headers: { Cookie: adminCookie },
            body: { text: 'break through', direction: 'en_es', mode: 'offline' }
        });
        assert.strictEqual(enEsRes.status, 200);
        const enEsJson = JSON.parse(enEsRes.body);
        assert.strictEqual(enEsJson.direction, 'en_es');
        assert.match(enEsJson.translatedText, /abrirse paso|superar/i);
        assert.ok(enEsJson.spanishMeaning);

        // 3. Coreano -> English (con romanización y explicación en español para hablante nativo)
        const koEnRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/language/translate',
            headers: { Cookie: adminCookie },
            body: { text: '사랑해요', direction: 'ko_en', mode: 'offline' }
        });
        assert.strictEqual(koEnRes.status, 200);
        const koEnJson = JSON.parse(koEnRes.body);
        assert.strictEqual(koEnJson.direction, 'ko_en');
        assert.match(koEnJson.translatedText, /I love you/i);
        assert.match(koEnJson.spanishMeaning, /Te amo|Te quiero/i);
        assert.ok(koEnJson.romanization);
        assert.ok(koEnJson.memoryTotalTerms >= 2, 'Debe recordar los términos traducidos en languageMemory');

        // 4. Modo Auto detectando Hangul
        const autoKoRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/language/translate',
            headers: { Cookie: adminCookie },
            body: { text: '마음', direction: 'auto', mode: 'offline' }
        });
        assert.strictEqual(autoKoRes.status, 200);
        const autoKoJson = JSON.parse(autoKoRes.body);
        assert.ok(autoKoJson.romanization);
        assert.match(autoKoJson.translatedText, /heart|corazón/i);
    });

    it('auto-recupera Gemini HTTP 404 vía /v1beta/models, evita memory poisoning, autocorrige Hangul en en_es y prueba POST /api/language/test-gemini', async () => {
        const langStudio = require('../lib/language-studio');

        // 1. Limpieza unitaria de memoria envenenada heredada
        assert.strictEqual(
            langStudio.isPoisonedMemoryMeaning('Activa Google Gemini API en Settings (0 MB RAM) para traducciones ilimitadas'),
            true
        );
        assert.strictEqual(
            langStudio.isPoisonedMemoryMeaning('Sin traducción exacta en diccionario local (Gemini HTTP 404)'),
            true
        );
        const cleanedMem = langStudio.sanitizeLanguageMemory({
            terms: [
                { term: '한국어', meaning: 'Activa Google Gemini API en Settings (0 MB RAM)', language: 'ko' },
                { term: '마음', meaning: 'heart / mind (corazón, mente)', language: 'ko' }
            ],
            grammarNotes: [
                'Sin traducción exacta en diccionario local (Gemini HTTP 404)',
                'Use -는/-은 for topic marking'
            ]
        });
        assert.strictEqual(cleanedMem.terms.length, 1);
        assert.strictEqual(cleanedMem.terms[0].term, '마음');
        assert.deepStrictEqual(cleanedMem.grammarNotes, ['Use -는/-은 for topic marking']);

        // 2. Configurar modelo obsoleto (gemini-2.0-flash) para verificar auto-cambio transparente en runtime
        const prepSet = await request({
            port,
            method: 'PUT',
            reqPath: '/api/settings',
            headers: { Cookie: adminCookie },
            body: {
                geminiModel: 'gemini-2.0-flash',
                geminiApiKey: 'AIzaSyFakeIntegrationKey987654'
            }
        });
        assert.strictEqual(prepSet.status, 200);

        const origFetch = global.fetch;
        try {
            // 3. Simular 404 en modelo viejo + descubrimiento de gemini-2.5-flash en /v1beta/models
            global.fetch = async (url, opts = {}) => {
                const target = String(url);
                assert.strictEqual(target.includes('key='), false, 'La API key no debe enviarse en query string');
                assert.strictEqual(opts?.headers?.['x-goog-api-key'], 'AIzaSyFakeIntegrationKey987654');
                if (target.endsWith('/v1beta/models')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            models: [
                                { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
                                { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }
                            ]
                        })
                    };
                }
                if (target.includes('/models/gemini-2.0-flash:generateContent')) {
                    const errBody = JSON.stringify({ error: { message: 'models/gemini-2.0-flash is not found' } });
                    return {
                        ok: false,
                        status: 404,
                        text: async () => errBody,
                        json: async () => JSON.parse(errBody)
                    };
                }
                if (target.includes('/models/gemini-2.5-flash:generateContent')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            candidates: [{
                                content: {
                                    parts: [{
                                        text: JSON.stringify({
                                            detectedSourceLanguage: 'Korean',
                                            translatedText: 'Korean language',
                                            spanishMeaning: 'Idioma coreano',
                                            englishBridge: 'Korean language',
                                            romanization: 'han-gu-geo',
                                            partOfSpeech: 'noun',
                                            literalMeaning: 'Han country language',
                                            explanationEs: 'Nombre del idioma coreano.',
                                            alternatives: ['한국말'],
                                            examples: [{ source: '한국어를 배워요.', translation: 'Aprendo coreano.' }]
                                        })
                                    }]
                                }
                            }]
                        })
                    };
                }
                throw new Error(`Unexpected fetch URL in test: ${target}`);
            };

            const recoveredRes = await request({
                port,
                method: 'POST',
                reqPath: '/api/language/translate',
                headers: { Cookie: adminCookie },
                body: { text: '한국어', direction: 'en_es', mode: 'gemini' }
            });
            assert.strictEqual(recoveredRes.status, 200);
            const recoveredJson = JSON.parse(recoveredRes.body);
            assert.strictEqual(recoveredJson.engine, 'gemini');
            assert.strictEqual(recoveredJson.model, 'gemini-2.5-flash');
            assert.match(recoveredJson.autoSwitchedNote || '', /gemini-2\.5-flash/);
            assert.strictEqual(recoveredJson.spanishMeaning, 'Idioma coreano');

            // 4. Endpoint de diagnóstico POST /api/language/test-gemini (RBAC + OK)
            const psychDenied = await request({
                port,
                method: 'POST',
                reqPath: '/api/language/test-gemini',
                headers: { Cookie: medicoCookie },
                body: {}
            });
            assert.strictEqual(psychDenied.status, 403);

            const diagOk = await request({
                port,
                method: 'POST',
                reqPath: '/api/language/test-gemini',
                headers: { Cookie: adminCookie },
                body: { model: 'gemini-2.0-flash' }
            });
            assert.strictEqual(diagOk.status, 200);
            const diagJson = JSON.parse(diagOk.body);
            assert.strictEqual(diagJson.ok, true);
            assert.strictEqual(diagJson.suggestedModel, 'gemini-2.5-flash');
            assert.ok(Array.isArray(diagJson.availableModels) && diagJson.availableModels.includes('gemini-2.5-flash'));

            // 4b. Multi-hop fallback: omite modelos -tts y recupera en el 3er candidato vivo (gemini-flash-latest)
            global.fetch = async (url) => {
                const target = String(url);
                if (target.endsWith('/v1beta/models')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            models: [
                                { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
                                { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
                                { name: 'models/gemini-2.5-pro-preview-tts', supportedGenerationMethods: ['generateContent'] },
                                { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }
                            ]
                        })
                    };
                }
                if (target.includes('/models/gemini-flash-latest:generateContent')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            candidates: [{ content: { parts: [{ text: 'OK' }] } }]
                        })
                    };
                }
                const errBody = JSON.stringify({ error: { message: 'Model unavailable for generateContent' } });
                return { ok: false, status: 404, text: async () => errBody, json: async () => JSON.parse(errBody) };
            };
            const multiHopDiag = await request({
                port,
                method: 'POST',
                reqPath: '/api/language/test-gemini',
                headers: { Cookie: adminCookie },
                body: { model: 'gemini-2.5-flash-lite' }
            });
            assert.strictEqual(multiHopDiag.status, 200);
            const multiHopJson = JSON.parse(multiHopDiag.body);
            assert.strictEqual(multiHopJson.ok, true);
            assert.strictEqual(multiHopJson.suggestedModel, 'gemini-flash-latest');
            assert.strictEqual(multiHopJson.availableModels.some(m => m.includes('-tts')), false);

            // 4c. Recuperación ante TimeoutError en primer intento (p.ej. modelo lento / IPv6 stall)
            global.fetch = async (url) => {
                const target = String(url);
                if (target.endsWith('/v1beta/models')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            models: [
                                { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
                                { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }
                            ]
                        })
                    };
                }
                if (target.includes('/models/gemini-2.5-pro:generateContent')) {
                    const err = new Error('The operation was aborted due to timeout');
                    err.name = 'TimeoutError';
                    throw err;
                }
                if (target.includes('/models/gemini-flash-latest:generateContent')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            candidates: [{ content: { parts: [{ text: 'OK' }] } }]
                        })
                    };
                }
                const errBody = JSON.stringify({ error: { message: 'Not found' } });
                return { ok: false, status: 404, text: async () => errBody, json: async () => JSON.parse(errBody) };
            };
            const timeoutRecDiag = await request({
                port,
                method: 'POST',
                reqPath: '/api/language/test-gemini',
                headers: { Cookie: adminCookie },
                body: { model: 'gemini-2.5-pro' }
            });
            assert.strictEqual(timeoutRecDiag.status, 200);
            const timeoutRecJson = JSON.parse(timeoutRecDiag.body);
            assert.strictEqual(timeoutRecJson.ok, true);
            assert.strictEqual(timeoutRecJson.suggestedModel, 'gemini-flash-latest');

            // 5. Si Gemini falla completamente con 404 en palabra desconocida, cae a local SIN envenenar languageMemory
            global.fetch = async (url) => {
                const target = String(url);
                if (target.endsWith('/v1beta/models')) {
                    return { ok: true, status: 200, json: async () => ({ models: [] }) };
                }
                return {
                    ok: false,
                    status: 404,
                    text: async () => JSON.stringify({ error: { message: 'Model unavailable' } }),
                    json: async () => ({ error: { message: 'Model unavailable' } })
                };
            };

            const failKoRes = await request({
                port,
                method: 'POST',
                reqPath: '/api/language/translate',
                headers: { Cookie: adminCookie },
                body: { text: '컴퓨터', direction: 'ko_es', mode: 'gemini' }
            });
            assert.strictEqual(failKoRes.status, 200);
            const failKoJson = JSON.parse(failKoRes.body);
            assert.strictEqual(failKoJson.engine, 'local-linguistic');
            assert.strictEqual(failKoJson.rememberable, false);

            const failEnRes = await request({
                port,
                method: 'POST',
                reqPath: '/api/language/translate',
                headers: { Cookie: adminCookie },
                body: { text: 'ephemeral', direction: 'en_es', mode: 'gemini' }
            });
            assert.strictEqual(failEnRes.status, 200);
            const failEnJson = JSON.parse(failEnRes.body);
            assert.strictEqual(failEnJson.engine, 'local-linguistic');
            assert.strictEqual(failEnJson.rememberable, false);

            const settingsAfter = await request({
                port,
                reqPath: '/api/settings',
                headers: { Cookie: adminCookie }
            });
            assert.strictEqual(settingsAfter.status, 200);
            const savedMem = JSON.parse(settingsAfter.body).languageMemory || { terms: [] };
            assert.strictEqual(
                savedMem.terms.some(t => t.term === '컴퓨터' || t.term === 'ephemeral' || langStudio.isPoisonedMemoryMeaning(t.meaning)),
                false,
                'Nunca debe guardar errores de Gemini o instrucciones de Settings en languageMemory'
            );

            // 6. Escribir Hangul ('한국어') con selector en en_es en modo offline autocorrige dirección a ko_es
            const hangulAutoDirRes = await request({
                port,
                method: 'POST',
                reqPath: '/api/language/translate',
                headers: { Cookie: adminCookie },
                body: { text: '한국어', direction: 'en_es', mode: 'offline' }
            });
            assert.strictEqual(hangulAutoDirRes.status, 200);
            const hangulAutoDirJson = JSON.parse(hangulAutoDirRes.body);
            assert.strictEqual(hangulAutoDirJson.direction, 'ko_es');
            assert.match(hangulAutoDirJson.translatedText, /Coreano/i);
        } finally {
            global.fetch = origFetch;
            await request({
                port,
                method: 'PUT',
                reqPath: '/api/settings',
                headers: { Cookie: adminCookie },
                body: { geminiModel: 'gemini-2.5-flash' }
            });
        }
    });

    it('resuelve metadatos completos (álbum, año, artista y embeddable) desde POST /api/english/music/resolve', async () => {
        // Creamos mini álbum único para probar emparejamiento con catálogo incluso sin bloque "Provided to YouTube"
        const albRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/albums',
            headers: { Cookie: adminCookie },
            body: {
                mainArtist: 'BABYMONSTER',
                artistType: 'group',
                albumTitle: 'We go up',
                albumType: 'mini_album',
                albumYear: 2025
            }
        });
        assert.strictEqual(albRes.status, 201);

        const origFetch = global.fetch;
        global.fetch = async (url) => {
            const target = String(url);
            if (target.includes('youtube.com/oembed')) {
                const isWeGoUp = target.includes('wgu98765432');
                return {
                    ok: true,
                    json: async () => ({
                        title: isWeGoUp ? "BABYMONSTER - 'WE GO UP' M/V" : "BABYMONSTER - 'DRIP' M/V",
                        author_name: 'BABYMONSTER'
                    })
                };
            }
            if (target.includes('youtube.com/watch?v=Zp-Jhuhq0bQ')) {
                const playerResp = {
                    videoDetails: {
                        title: "BABYMONSTER - 'DRIP' M/V",
                        author: 'BABYMONSTER',
                        shortDescription: 'Provided to YouTube by YG PLUS\n\nDRIP · BABYMONSTER\n\nDRIP\n\nReleased on: 2024-11-01'
                    },
                    playabilityStatus: { status: 'OK', playableInEmbed: false }
                };
                return {
                    ok: true,
                    text: async () => `<script>var ytInitialPlayerResponse = ${JSON.stringify(playerResp)};</script>`
                };
            }
            if (target.includes('youtube.com/watch?v=wgu98765432')) {
                const playerResp = {
                    videoDetails: {
                        title: "BABYMONSTER - 'WE GO UP' M/V",
                        author: 'BABYMONSTER',
                        shortDescription: 'Official Music Video'
                    },
                    playabilityStatus: { status: 'OK', playableInEmbed: true }
                };
                return {
                    ok: true,
                    text: async () => `<script>var ytInitialPlayerResponse = ${JSON.stringify(playerResp)};</script>`
                };
            }
            return { ok: false };
        };

        try {
            const resolveRes = await request({
                port,
                method: 'POST',
                reqPath: '/api/english/music/resolve',
                headers: { Cookie: adminCookie },
                body: { url: 'https://music.youtube.com/watch?v=Zp-Jhuhq0bQ&list=RDAMVMZp-Jhuhq0bQ' }
            });
            assert.strictEqual(resolveRes.status, 200);
            const data = JSON.parse(resolveRes.body);
            assert.strictEqual(data.videoId, 'Zp-Jhuhq0bQ');
            assert.strictEqual(data.ytMusicUrl, 'https://music.youtube.com/watch?v=Zp-Jhuhq0bQ');
            assert.strictEqual(data.youtubeUrl, 'https://www.youtube.com/watch?v=Zp-Jhuhq0bQ');
            assert.strictEqual(data.suggestedTitle, 'DRIP');
            assert.strictEqual(data.suggestedArtist, 'BABYMONSTER');
            assert.strictEqual(data.suggestedAlbumTitle, 'DRIP');
            assert.strictEqual(data.suggestedAlbumType, 'album');
            assert.strictEqual(data.suggestedAlbumYear, 2024);
            assert.strictEqual(data.embeddable, false);

            const resolveWguRes = await request({
                port,
                method: 'POST',
                reqPath: '/api/english/music/resolve',
                headers: { Cookie: adminCookie },
                body: { url: 'https://www.youtube.com/watch?v=wgu98765432' }
            });
            assert.strictEqual(resolveWguRes.status, 200);
            const wguData = JSON.parse(resolveWguRes.body);
            assert.strictEqual(wguData.suggestedTitle, 'WE GO UP');
            assert.strictEqual(wguData.suggestedArtist, 'BABYMONSTER');
            assert.strictEqual(wguData.suggestedAlbumTitle, 'We go up');
            assert.strictEqual(wguData.suggestedAlbumType, 'mini_album');
            assert.strictEqual(wguData.suggestedAlbumYear, 2025);
            assert.strictEqual(wguData.embeddable, true);
        } finally {
            global.fetch = origFetch;
        }
    });

    it('soporta puente E2EE en RAM PC <-> EC2 (HMAC), extracción sin BD y streaming media 206 seguro', async () => {
        const nodeCrypto = require('node:crypto');
        const ytdlpService = require(path.join(ROOT, 'lib', 'ytdlp-service'));
        const origExtract = ytdlpService.extractSongLyrics;
        const origStream = ytdlpService.resolvePlayableMediaStream;
        const origFetch = global.fetch;

        const signPcBridge = (method, reqPath, encryptedBlob = '') => {
            const secret = process.env.JOURNAL_SECRET_KEY || process.env.ADMIN_SECRET;
            const cleanPath = reqPath.split('?')[0];
            const ts = String(Math.floor(Date.now() / 1000));
            const bodyHash = nodeCrypto.createHash('sha256').update(encryptedBlob, 'utf8').digest('hex');
            const canonical = `${method.toUpperCase()}:${cleanPath}:${ts}:${bodyHash}`;
            const sig = nodeCrypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
            return { 'X-PC-Timestamp': ts, 'X-PC-Signature': sig };
        };

        // 1. RBAC: solo admin puede consultar estado yt-dlp
        const medicoStatus = await request({
            port,
            reqPath: '/api/english/music/ytdlp-status',
            headers: { Cookie: medicoCookie }
        });
        assert.strictEqual(medicoStatus.status, 403);

        const adminStatusInitial = await request({
            port,
            reqPath: '/api/english/music/ytdlp-status',
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(adminStatusInitial.status, 200);
        const statusInitJson = JSON.parse(adminStatusInitial.body);
        assert.strictEqual(typeof statusInitJson.available, 'boolean');
        assert.strictEqual(statusInitJson.jsRuntime, 'node');
        assert.strictEqual(statusInitJson.pcOnline, false);

        // 2. Registrar canción para extraer letras y probar puente PC / stream
        const createRes = await request({
            port,
            method: 'POST',
            reqPath: '/api/english/music/songs',
            headers: { Cookie: adminCookie },
            body: {
                titulo: 'FOREVER',
                mainArtist: 'BABYMONSTER',
                artistType: 'group',
                albumTitle: 'Drip',
                albumType: 'album',
                albumYear: 2024,
                numeroPista: 7,
                idioma: 'English + Korean',
                ytMusicUrl: 'https://www.youtube.com/watch?v=eJCHKjt0MPw'
            }
        });
        assert.strictEqual(createRes.status, 201);
        const { songId } = JSON.parse(createRes.body);
        assert.ok(songId);

        ytdlpService.extractSongLyrics = async ({ videoId }) => ({
            ok: true,
            videoId,
            lyrics: 'Forever ever never fade\n영원히 빛나',
            source: 'yt-dlp:en',
            language: 'en',
            ytdlpAvailable: true,
            availableLangs: ['en', 'ko'],
            suggestedCommand: `python sincronitation/yt_lyrics_helper.py "https://www.youtube.com/watch?v=${videoId}" --clip`
        });

        ytdlpService.resolvePlayableMediaStream = async ({ videoId }) => ({
            ok: true,
            videoId,
            streamUrl: 'https://rr1---sn-test.googlevideo.com/videoplayback?id=forever',
            contentType: 'video/mp4',
            headers: { 'User-Agent': 'MockPlayerUA/1.0' }
        });

        global.fetch = async (url, opts) => {
            if (String(url).includes('googlevideo.com/videoplayback')) {
                assert.strictEqual(opts.headers.Range, 'bytes=0-9');
                return new Response(Buffer.from('0123456789'), {
                    status: 206,
                    headers: {
                        'Content-Type': 'video/mp4',
                        'Content-Length': '10',
                        'Content-Range': 'bytes 0-9/100'
                    }
                });
            }
            return origFetch(url, opts);
        };

        try {
            // 3. Extracción fallback sin almacenar en DB ni disco (storedInDb: false)
            const extractRes = await request({
                port,
                method: 'POST',
                reqPath: `/api/english/music/songs/${songId}/lyrics/extract`,
                headers: { Cookie: adminCookie },
                body: {}
            });
            assert.strictEqual(extractRes.status, 200);
            const extJson = JSON.parse(extractRes.body);
            assert.strictEqual(extJson.ok, true);
            assert.strictEqual(extJson.storedInDb, false);
            assert.strictEqual(extJson.source, 'yt-dlp:en');
            assert.match(extJson.lyrics, /Forever ever never fade/);

            // 4. Catálogo NO expone ni guarda letras en MySQL
            const catRes = await request({
                port,
                reqPath: '/api/english/music/catalog',
                headers: { Cookie: adminCookie }
            });
            assert.strictEqual(catRes.status, 200);
            const catData = JSON.parse(catRes.body);
            const savedSong = catData.songs.find((s) => Number(s.id) === Number(songId));
            assert.ok(savedSong);
            assert.strictEqual(savedSong.lyrics_text, undefined);
            assert.strictEqual(savedSong.lyrics_source, undefined);

            // 5. El endpoint antiguo PUT /lyrics en BD fue retirado
            const removedPutRes = await request({
                port,
                method: 'PUT',
                reqPath: `/api/english/music/songs/${songId}/lyrics`,
                headers: { Cookie: adminCookie },
                body: { lyrics: 'should not persist in DB' }
            });
            assert.strictEqual(removedPutRes.status, 404);

            // 6. Puente E2EE Site-to-Site PC <-> EC2 RAM (HMAC + purga inmediata en RAM)
            const unsignedPoll = await request({
                port,
                reqPath: '/api/english/music/pc-jobs/poll?waitMs=0'
            });
            assert.strictEqual(unsignedPoll.status, 401);

            const signedEmptyPoll = await request({
                port,
                reqPath: '/api/english/music/pc-jobs/poll?waitMs=0',
                headers: signPcBridge('GET', '/api/english/music/pc-jobs/poll')
            });
            assert.strictEqual(signedEmptyPoll.status, 200);
            assert.deepStrictEqual(JSON.parse(signedEmptyPoll.body).jobs, []);

            // Tras el poll de la PC, ytdlp-status reporta pcOnline: true
            const adminStatusOnline = await request({
                port,
                reqPath: '/api/english/music/ytdlp-status',
                headers: { Cookie: adminCookie }
            });
            assert.strictEqual(JSON.parse(adminStatusOnline.body).pcOnline, true);

            const medicoPostJob = await request({
                port,
                method: 'POST',
                reqPath: '/api/english/music/pc-jobs',
                headers: { Cookie: medicoCookie },
                body: { encryptedRequest: 'deadbeef:abc' }
            });
            assert.strictEqual(medicoPostJob.status, 403);

            const encryptedReqBlob = '00112233445566778899aabbccddeeff:ENCRYPTED_REQUEST_PAYLOAD';
            const postJobRes = await request({
                port,
                method: 'POST',
                reqPath: '/api/english/music/pc-jobs',
                headers: { Cookie: adminCookie },
                body: { encryptedRequest: encryptedReqBlob }
            });
            assert.strictEqual(postJobRes.status, 201);
            const postJobJson = JSON.parse(postJobRes.body);
            assert.strictEqual(postJobJson.ok, true);
            assert.strictEqual(postJobJson.pcOnline, true);
            assert.match(postJobJson.jobId, /^[0-9a-f]{32}$/);

            const signedJobPoll = await request({
                port,
                reqPath: '/api/english/music/pc-jobs/poll?waitMs=0',
                headers: signPcBridge('GET', '/api/english/music/pc-jobs/poll')
            });
            assert.strictEqual(signedJobPoll.status, 200);
            const polledJobs = JSON.parse(signedJobPoll.body).jobs;
            assert.strictEqual(polledJobs.length, 1);
            assert.strictEqual(polledJobs[0].jobId, postJobJson.jobId);
            assert.strictEqual(polledJobs[0].encryptedRequest, encryptedReqBlob);

            const encryptedResultBlob = 'ffeeddccbbaa99887766554433221100:ENCRYPTED_LYRICS_RESULT';
            const unsignedResult = await request({
                port,
                method: 'POST',
                reqPath: `/api/english/music/pc-jobs/${postJobJson.jobId}/result`,
                body: { encryptedResult: encryptedResultBlob }
            });
            assert.strictEqual(unsignedResult.status, 401);

            const signedResult = await request({
                port,
                method: 'POST',
                reqPath: `/api/english/music/pc-jobs/${postJobJson.jobId}/result`,
                headers: signPcBridge('POST', `/api/english/music/pc-jobs/${postJobJson.jobId}/result`, encryptedResultBlob),
                body: { encryptedResult: encryptedResultBlob }
            });
            assert.strictEqual(signedResult.status, 200);

            const medicoGetJob = await request({
                port,
                reqPath: `/api/english/music/pc-jobs/${postJobJson.jobId}`,
                headers: { Cookie: medicoCookie }
            });
            assert.strictEqual(medicoGetJob.status, 403);

            const adminGetJob = await request({
                port,
                reqPath: `/api/english/music/pc-jobs/${postJobJson.jobId}`,
                headers: { Cookie: adminCookie }
            });
            assert.strictEqual(adminGetJob.status, 200);
            const adminJobJson = JSON.parse(adminGetJob.body);
            assert.strictEqual(adminJobJson.status, 'completed');
            assert.strictEqual(adminJobJson.encryptedResult, encryptedResultBlob);

            // Al entregarlo al navegador, el trabajo se purga inmediatamente de la RAM EC2
            const purgedGetJob = await request({
                port,
                reqPath: `/api/english/music/pc-jobs/${postJobJson.jobId}`,
                headers: { Cookie: adminCookie }
            });
            assert.strictEqual(purgedGetJob.status, 404);

            // 7. Media streaming 206 Range passthrough + RBAC 403
            const medicoMedia = await request({
                port,
                reqPath: `/api/english/music/songs/${songId}/media`,
                headers: { Cookie: medicoCookie }
            });
            assert.strictEqual(medicoMedia.status, 403);

            const mediaRes = await request({
                port,
                reqPath: `/api/english/music/songs/${songId}/media`,
                headers: { Cookie: adminCookie, Range: 'bytes=0-9' }
            });
            assert.strictEqual(mediaRes.status, 206);
            assert.strictEqual(mediaRes.headers['content-type'], 'video/mp4');
            assert.strictEqual(mediaRes.headers['accept-ranges'], 'bytes');
            assert.strictEqual(mediaRes.headers['content-range'], 'bytes 0-9/100');
            assert.strictEqual(mediaRes.body, '0123456789');

            // 8. Defensa SSRF: URL CDN no permitida debe bloquearse con 502
            ytdlpService.resolvePlayableMediaStream = async ({ videoId }) => ({
                ok: true,
                videoId,
                streamUrl: 'http://169.254.169.254/latest/meta-data/'
            });
            const ssrfRes = await request({
                port,
                reqPath: `/api/english/music/songs/${songId}/media`,
                headers: { Cookie: adminCookie }
            });
            assert.strictEqual(ssrfRes.status, 502);
        } finally {
            ytdlpService.extractSongLyrics = origExtract;
            ytdlpService.resolvePlayableMediaStream = origStream;
            global.fetch = origFetch;
        }
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

    it('expone GET /api/version autenticado con versión actual e historial SemVer 2.0.0', async () => {
        const unauthRes = await request({ port, reqPath: '/api/version' });
        assert.strictEqual(unauthRes.status, 401);

        const authRes = await request({
            port,
            reqPath: '/api/version',
            headers: { Cookie: adminCookie }
        });
        assert.strictEqual(authRes.status, 200);
        const body = JSON.parse(authRes.body);
        assert.match(String(body.currentVersion), /^\d+\.\d+\.\d+$/);
        assert.strictEqual(body.tag, `v${body.currentVersion}`);
        assert.match(String(body.standard), /SemVer 2\.0\.0/i);
        assert.ok(Array.isArray(body.history) && body.history.length >= 1);
        assert.strictEqual(body.history[0].version, body.currentVersion);
    });
});
