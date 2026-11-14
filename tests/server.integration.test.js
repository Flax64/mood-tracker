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

                if (normalized.startsWith('SELECT fecha, momento_dia, color_hex FROM RegistrosMood')) {
                    return finish(null, moodInserts);
                }

                if (normalized.startsWith('INSERT INTO RegistrosSleep')) {
                    sleepInserts.push({ fecha: params[0], horas: params[1], calidad: params[2] });
                    return finish(null, { insertId: sleepInserts.length });
                }

                if (normalized.includes('FROM RegistrosSleep')) {
                    return finish(null, sleepInserts);
                }

                if (normalized.startsWith('INSERT INTO RegistrosAgenda')) {
                    agendaInserts.push({ fecha: params[0], bloque: params[1], hora: params[2], actividad: params[3] });
                    return finish(null, { insertId: agendaInserts.length });
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
