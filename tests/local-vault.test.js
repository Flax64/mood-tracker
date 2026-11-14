const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const vault = require('../scripts/local-vault');

const ROOT_DIR = path.resolve(__dirname, '..');
const VAULT_SCRIPT = path.join(ROOT_DIR, 'scripts', 'local-vault.js');
const PY_SYNC = path.join(ROOT_DIR, 'sincronitation', 'sincronizador.py');

describe('Bóveda local (.env / .env.enc)', () => {
    test('scripts/local-vault.js tiene sintaxis JavaScript válida', () => {
        const res = spawnSync(process.execPath, ['--check', VAULT_SCRIPT], {
            cwd: ROOT_DIR,
            encoding: 'utf8'
        });
        assert.equal(res.status, 0, res.stderr || res.stdout);
    });

    test('.gitignore y .dockerignore excluyen docs-privados y secretos locales', () => {
        const gitignore = fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf8')
            .split(/\r?\n/)
            .map((l) => l.trim());
        for (const entry of ['.env', '.env.enc', '.ssh/', 'sincronitation/', 'docs-privados/']) {
            assert.ok(gitignore.includes(entry), `Falta "${entry}" en .gitignore`);
        }

        const dockerignore = fs.readFileSync(path.join(ROOT_DIR, '.dockerignore'), 'utf8')
            .split(/\r?\n/)
            .map((l) => l.trim());
        for (const entry of ['.env', '.env.enc', '.env.*.tmp', '.ssh', 'scripts', 'tests', 'docs-privados']) {
            assert.ok(dockerignore.includes(entry), `Falta "${entry}" en .dockerignore`);
        }
    });

    test('encryptText y decryptBuffer cifran con cabecera Salted__, PBKDF2-SHA256 y rechazan claves erróneas', () => {
        assert.equal(vault.MAGIC.toString('ascii'), 'Salted__');
        assert.equal(vault.PBKDF2_ITERATIONS, 600000);

        const sample = [
            '# Comentario con ñáéíóú',
            'DB_HOST=127.0.0.1',
            'JOURNAL_SECRET_KEY="clave=compleja#2026"',
            "WORD_FILE_PATH='C:\\Docs\\Diario.docx'",
            ''
        ].join('\n');

        const encBuf = vault.encryptText(sample, 'MiClaveMaestra#99');
        assert.ok(Buffer.isBuffer(encBuf));
        assert.ok(encBuf.length >= 32);
        assert.ok(encBuf.subarray(0, 8).equals(vault.MAGIC));

        const restored = vault.decryptBuffer(encBuf, 'MiClaveMaestra#99');
        assert.equal(restored, sample);

        assert.throws(
            () => vault.decryptBuffer(encBuf, 'ClaveIncorrecta'),
            /incorrecta|corrupto/i
        );
        assert.throws(
            () => vault.decryptBuffer(Buffer.from('invalido'), 'MiClaveMaestra#99'),
            /inválido|corrupto/i
        );
    });

    test('parseEnvContent ignora comentarios o claves inválidas y elimina comillas envolventes', () => {
        const parsed = vault.parseEnvContent([
            '# comentario',
            '',
            'NO_ES_ASIGNACION',
            '123INVALID=omitir',
            'KEY_SIMPLE=valor123',
            'KEY_DOBLES="valor con = y espacios"',
            "KEY_SIMPLES='texto simple'"
        ].join('\n'));

        assert.deepEqual(parsed, {
            KEY_SIMPLE: 'valor123',
            KEY_DOBLES: 'valor con = y espacios',
            KEY_SIMPLES: 'texto simple'
        });
    });

    test('ciclo cmdEncrypt -> cmdRun -> cmdDecrypt -> cmdLock funciona en directorio temporal sin exponer .env', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-vault-'));
        const tmpEnv = path.join(tmpDir, '.env');
        const tmpEnc = path.join(tmpDir, '.env.enc');
        const outJson = path.join(tmpDir, 'child-env.json');

        const origPass = process.env.MOOD_ENV_PASS;
        const origExitCode = process.exitCode;
        const origLog = console.log;
        console.log = () => {};

        try {
            const plainEnv = [
                'DB_HOST=127.0.0.1',
                'JOURNAL_SECRET_KEY="secreto=prueba#1"',
                'WORD_FILE_PATH=C:\\Ruta\\Mi Diario.docx'
            ].join('\n');
            fs.writeFileSync(tmpEnv, plainEnv, 'utf8');

            process.env.MOOD_ENV_PASS = 'corta';
            await assert.rejects(
                () => vault.cmdEncrypt(tmpEnv, tmpEnc),
                /al menos 8 caracteres/i
            );
            assert.equal(fs.existsSync(tmpEnv), true, '.env no debe borrarse si falla encrypt');

            process.env.MOOD_ENV_PASS = 'ClaveSegura!2026';
            await vault.cmdEncrypt(tmpEnv, tmpEnc);

            assert.equal(fs.existsSync(tmpEnv), false, '.env plano debe ser destruido tras encrypt');
            assert.equal(fs.existsSync(tmpEnc), true, '.env.enc debe existir tras encrypt');
            assert.ok(fs.readFileSync(tmpEnc).subarray(0, 8).equals(vault.MAGIC));

            const childCode = [
                "const fs = require('node:fs');",
                `fs.writeFileSync(${JSON.stringify(outJson)}, JSON.stringify({`,
                '  db: process.env.DB_HOST,',
                '  secret: process.env.JOURNAL_SECRET_KEY,',
                '  word: process.env.WORD_FILE_PATH,',
                '  passLeaked: process.env.MOOD_ENV_PASS !== undefined',
                '}));'
            ].join(' ');

            await vault.cmdRun([process.execPath, '-e', childCode], tmpEnv, tmpEnc);
            assert.equal(process.exitCode, 0);
            assert.equal(fs.existsSync(tmpEnv), false, 'cmdRun no debe escribir .env en disco');

            const captured = JSON.parse(fs.readFileSync(outJson, 'utf8'));
            assert.deepEqual(captured, {
                db: '127.0.0.1',
                secret: 'secreto=prueba#1',
                word: 'C:\\Ruta\\Mi Diario.docx',
                passLeaked: false
            });

            await vault.cmdDecrypt(tmpEnv, tmpEnc);
            assert.equal(fs.existsSync(tmpEnv), true);
            assert.equal(fs.readFileSync(tmpEnv, 'utf8'), plainEnv);

            vault.cmdLock(tmpEnv, tmpEnc);
            assert.equal(fs.existsSync(tmpEnv), false);
            assert.equal(fs.existsSync(tmpEnc), true);
        } finally {
            console.log = origLog;
            process.exitCode = origExitCode;
            if (origPass === undefined) {
                delete process.env.MOOD_ENV_PASS;
            } else {
                process.env.MOOD_ENV_PASS = origPass;
            }
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('interoperabilidad de .env.enc con sincronitation/sincronizador.py (cuando está presente en local)', () => {
        if (!fs.existsSync(PY_SYNC)) {
            return;
        }

        const pyCheck = spawnSync('python', ['--version'], { encoding: 'utf8' });
        if (pyCheck.error || pyCheck.status !== 0) {
            return;
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-py-vault-'));
        const tmpEnc = path.join(tmpDir, '.env.enc');
        const tmpDpapi = path.join(tmpDir, 'vault.dpapi');

        try {
            const password = 'ClavePythonInterop!2026';
            const sample = [
                '# Env local para sincronizador',
                'WORD_FILE_PATH="C:\\Users\\flavi\\OneDrive\\Documentos\\DIARIO.docx"',
                'JOURNAL_SECRET_KEY=mi_token_secreto_123',
                'EC2_API_URL="http://3.149.248.153:3000"'
            ].join('\n');

            fs.writeFileSync(tmpEnc, vault.encryptText(sample, password));

            const pyCode = [
                'import ctypes, json, os, sys',
                'from ctypes import wintypes',
                '',
                'sys.dont_write_bytecode = True',
                'sync_dir, enc_path, password, dpapi_path = sys.argv[1:5]',
                'sys.path.insert(0, sync_dir)',
                'os.environ["MOOD_DPAPI_VAULT_PATH"] = dpapi_path',
                'import sincronizador',
                '',
                'with open(enc_path, "rb") as fh:',
                '    raw = fh.read()',
                'plain = sincronizador._descifrar_vault_bytes(raw, password)',
                'parsed = sincronizador._parsear_y_cargar_env(plain)',
                'bad_rejected = False',
                'try:',
                '    sincronizador._descifrar_vault_bytes(raw, "clave-equivocada")',
                'except RuntimeError:',
                '    bad_rejected = True',
                '',
                'dpapi_ok = True',
                'if sys.platform == "win32":',
                '    saved_path = sincronizador._guardar_dpapi_password(password)',
                '    assert saved_path == dpapi_path',
                '    raw_dpapi = open(dpapi_path, "rb").read()',
                '    assert password.encode("utf-8") not in raw_dpapi, "DPAPI no debe guardar clave en claro"',
                '    unprotected = sincronizador._leer_dpapi_password()',
                '    assert unprotected == password',
                '    plain_dpapi = sincronizador._descifrar_vault_bytes(raw, unprotected)',
                '    assert plain_dpapi == plain',
                '    removed, _ = sincronizador._eliminar_dpapi_password()',
                '    assert removed and not os.path.exists(dpapi_path)',
                '    dpapi_ok = True',
                '',
                'print(json.dumps({"parsed": parsed, "bad_rejected": bad_rejected, "dpapi_ok": dpapi_ok}))'
            ].join('\n');

            const pyEnv = { ...process.env };
            delete pyEnv.WORD_FILE_PATH;
            delete pyEnv.JOURNAL_SECRET_KEY;
            delete pyEnv.EC2_API_URL;
            delete pyEnv.MOOD_ENV_PASS;

            const res = spawnSync('python', ['-B', '-c', pyCode, path.dirname(PY_SYNC), tmpEnc, password, tmpDpapi], {
                cwd: ROOT_DIR,
                env: pyEnv,
                encoding: 'utf8'
            });
            assert.equal(res.status, 0, res.stderr || res.stdout);

            const out = JSON.parse(res.stdout.trim());
            assert.equal(out.bad_rejected, true, 'Python debe rechazar contraseña incorrecta');
            assert.equal(out.dpapi_ok, true, 'DPAPI debe proteger y desproteger la clave sin texto plano');
            assert.equal(out.parsed.WORD_FILE_PATH, 'C:\\Users\\flavi\\OneDrive\\Documentos\\DIARIO.docx');
            assert.equal(out.parsed.JOURNAL_SECRET_KEY, 'mi_token_secreto_123');
            assert.equal(out.parsed.EC2_API_URL, 'http://3.149.248.153:3000');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
