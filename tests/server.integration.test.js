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
        { id: 1, nombre: 'Flavio', email: 'admin@example.com', password_hash: testHash, rol: 'admin' },
        { id: 2, nombre: 'Dr. Perez', email: 'medico@example.com', password_hash: testHash, rol: 'psiquiatra' }
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
                        rol: u.rol
                    }]);
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
        assert.ok(String(res.headers['content-security-policy'] || '').includes("default-src 'self'"));
        assert.ok(res.headers.etag);
        assert.ok(String(res.headers['cache-control'] || '').includes('max-age=600'));
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

        // Cierre de sesión limpia la cookie y elimina sesión
        const logout = await request({ port, method: 'POST', reqPath: '/api/auth/logout', headers: { Cookie: adminCookie } });
        assert.strictEqual(logout.status, 200);
        const meAfterLogout = await request({ port, reqPath: '/api/auth/me', headers: { Cookie: adminCookie } });
        assert.strictEqual(meAfterLogout.status, 401);
    });
});
