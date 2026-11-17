const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MAGIC = Buffer.from('Salted__', 'ascii');
const PBKDF2_ITERATIONS = 600000;
const KEY_LEN = 32;
const IV_LEN = 16;

const PROJECT_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(PROJECT_DIR, '.env');
const ENC_FILE = path.join(PROJECT_DIR, '.env.enc');

function deriveKeyAndIv(password, salt) {
    const derived = crypto.pbkdf2Sync(
        Buffer.from(password, 'utf8'),
        salt,
        PBKDF2_ITERATIONS,
        KEY_LEN + IV_LEN,
        'sha256'
    );
    return {
        key: derived.subarray(0, KEY_LEN),
        iv: derived.subarray(KEY_LEN, KEY_LEN + IV_LEN)
    };
}

function encryptText(plainText, password) {
    const salt = crypto.randomBytes(8);
    const { key, iv } = deriveKeyAndIv(password, salt);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    return Buffer.concat([MAGIC, salt, encrypted]);
}

function decryptBuffer(encBuf, password) {
    if (!Buffer.isBuffer(encBuf) || encBuf.length < 32 || !encBuf.subarray(0, 8).equals(MAGIC)) {
        throw new Error('Formato de .env.enc inválido o corrupto.');
    }
    const salt = encBuf.subarray(8, 16);
    const payload = encBuf.subarray(16);
    const { key, iv } = deriveKeyAndIv(password, salt);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    try {
        const plain = Buffer.concat([decipher.update(payload), decipher.final()]);
        // Decodificación UTF-8 ESTRICTA (igual que `.decode("utf-8")` en sincronizador.py): con una
        // contraseña errónea, AES-CBC produce padding PKCS#7 "válido" ~1/256 veces; la basura
        // resultante casi nunca es UTF-8 válido, así que se rechaza en lugar de devolver texto corrupto.
        return new TextDecoder('utf-8', { fatal: true }).decode(plain);
    } catch {
        throw new Error('Contraseña incorrecta o archivo .env.enc corrupto.');
    }
}

function parseEnvContent(content) {
    const parsed = {};
    for (const rawLine of String(content).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || !line.includes('=')) continue;
        const eqIdx = line.indexOf('=');
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        parsed[key] = val;
    }
    return parsed;
}

function secureWipe(filePath) {
    if (!fs.existsSync(filePath)) return;
    const size = fs.statSync(filePath).size;
    if (size > 0) {
        const fd = fs.openSync(filePath, 'r+');
        try {
            fs.writeSync(fd, Buffer.alloc(size, 0), 0, size, 0);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
    }
    fs.unlinkSync(filePath);
}

function promptPasswordHidden(promptText) {
    if (process.env.MOOD_ENV_PASS !== undefined) {
        return Promise.resolve(process.env.MOOD_ENV_PASS);
    }
    if (!process.stdin.isTTY) {
        return new Promise((resolve) => {
            let data = '';
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', (chunk) => {
                data += chunk;
            });
            process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
        });
    }

    return new Promise((resolve, reject) => {
        process.stdout.write(promptText);
        const stdin = process.stdin;
        const wasRaw = Boolean(stdin.isRaw);
        let value = '';

        const cleanup = () => {
            stdin.removeListener('data', onData);
            if (!wasRaw && stdin.isTTY) stdin.setRawMode(false);
            stdin.pause();
        };

        const onData = (buf) => {
            const str = buf.toString('utf8');
            for (const ch of str) {
                if (ch === '\r' || ch === '\n') {
                    cleanup();
                    process.stdout.write('\n');
                    resolve(value);
                    return;
                }
                if (ch === '\u0003') {
                    cleanup();
                    process.stdout.write('\n');
                    reject(new Error('Operación cancelada por el usuario.'));
                    return;
                }
                if (ch === '\u007f' || ch === '\b') {
                    value = value.slice(0, -1);
                    continue;
                }
                value += ch;
            }
        };

        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
    });
}

async function cmdEncrypt(envFile = ENV_FILE, encFile = ENC_FILE) {
    if (!fs.existsSync(envFile)) {
        if (fs.existsSync(encFile)) {
            console.log('La bóveda local ya está sellada (.env.enc existe y .env plano ya fue eliminado).');
            return;
        }
        throw new Error(`No existe ${envFile} para cifrar.`);
    }

    const pass1 = await promptPasswordHidden('Crea una contraseña maestra para cifrar .env local (mín. 8 caracteres): ');
    if (pass1.length < 8) {
        throw new Error('La contraseña maestra debe tener al menos 8 caracteres.');
    }
    if (process.env.MOOD_ENV_PASS === undefined) {
        const pass2 = await promptPasswordHidden('Confirma la contraseña maestra: ');
        if (pass1 !== pass2) {
            throw new Error('Las contraseñas no coinciden.');
        }
    }

    const plainText = fs.readFileSync(envFile, 'utf8');
    const encBuf = encryptText(plainText, pass1);
    const verifyText = decryptBuffer(encBuf, pass1);
    if (verifyText !== plainText) {
        throw new Error('Falló la verificación interna del cifrado; .env se mantiene intacto.');
    }

    const tmpEnc = `${encFile}.tmp.${process.pid}`;
    fs.writeFileSync(tmpEnc, encBuf, { mode: 0o600 });
    fs.renameSync(tmpEnc, encFile);
    secureWipe(envFile);
    console.log(`Listo: .env cifrado en ${path.basename(encFile)} y archivo plano destruido de forma segura.`);
}

async function cmdDecrypt(envFile = ENV_FILE, encFile = ENC_FILE) {
    if (!fs.existsSync(encFile)) {
        throw new Error(`No existe la bóveda cifrada ${encFile}.`);
    }
    const pass = await promptPasswordHidden('Contraseña maestra de .env.enc: ');
    const plainText = decryptBuffer(fs.readFileSync(encFile), pass);
    const tmpPlain = `${envFile}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPlain, plainText, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPlain, envFile);
    console.log('Archivo .env descifrado temporalmente. Ejecuta "node scripts/local-vault.js encrypt" o "lock" al terminar.');
}

function cmdLock(envFile = ENV_FILE, encFile = ENC_FILE) {
    if (!fs.existsSync(encFile)) {
        throw new Error('No existe .env.enc. Ejecuta primero "node scripts/local-vault.js encrypt" para no perder tu configuración.');
    }
    if (fs.existsSync(envFile)) {
        secureWipe(envFile);
        console.log('Archivo plano .env destruido; solo permanece .env.enc.');
    } else {
        console.log('La bóveda local ya está sellada (.env plano no existe en disco).');
    }
}

function cmdStatus(envFile = ENV_FILE, encFile = ENC_FILE) {
    console.log(`Estado de la bóveda local en ${path.dirname(encFile)}:`);
    console.log(fs.existsSync(envFile)
        ? '  [EXPUESTO] .env en texto plano presente en disco.'
        : '  [OK]       .env en texto plano NO existe en disco.');
    console.log(fs.existsSync(encFile)
        ? '  [SELLADO]  .env.enc cifrado presente en disco.'
        : '  [PENDIENTE] .env.enc aún no ha sido creado.');
}

async function cmdRun(args, envFile = ENV_FILE, encFile = ENC_FILE) {
    if (!args || args.length === 0) {
        throw new Error('Debes indicar el comando a ejecutar. Ejemplo: node scripts/local-vault.js run python sincronitation/sincronizador.py');
    }

    let extraEnv = {};
    if (fs.existsSync(encFile)) {
        const pass = await promptPasswordHidden('Contraseña maestra de .env.enc: ');
        const plainText = decryptBuffer(fs.readFileSync(encFile), pass);
        extraEnv = parseEnvContent(plainText);
    } else if (fs.existsSync(envFile)) {
        extraEnv = parseEnvContent(fs.readFileSync(envFile, 'utf8'));
    } else {
        throw new Error('No se encontró ni .env.enc ni .env en la raíz del proyecto.');
    }

    const [command, ...cmdArgs] = args;
    const childEnv = { ...process.env, ...extraEnv };
    delete childEnv.MOOD_ENV_PASS;

    const result = spawnSync(command, cmdArgs, {
        cwd: PROJECT_DIR,
        env: childEnv,
        stdio: 'inherit'
    });
    if (result.error) throw result.error;
    process.exitCode = result.status === null ? 1 : result.status;
}

async function main() {
    const action = process.argv[2] || 'help';
    switch (action) {
        case 'encrypt':
            await cmdEncrypt();
            break;
        case 'decrypt':
            await cmdDecrypt();
            break;
        case 'lock':
            cmdLock();
            break;
        case 'status':
            cmdStatus();
            break;
        case 'run':
            await cmdRun(process.argv.slice(3));
            break;
        default:
            console.log(`Uso: node scripts/local-vault.js <comando>

Comandos disponibles:
  encrypt           Cifra .env -> .env.enc (AES-256-CBC + PBKDF2) y borra .env plano
  run <cmd...>      Descifra .env.enc solo en RAM y ejecuta <cmd...> (sin crear .env)
  decrypt           Restaura .env temporalmente para editarlo
  lock              Destruye .env plano si ya existe .env.enc
  status            Muestra si .env local está sellado o expuesto`);
            break;
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    });
}

module.exports = {
    MAGIC,
    PBKDF2_ITERATIONS,
    encryptText,
    decryptBuffer,
    parseEnvContent,
    secureWipe,
    cmdEncrypt,
    cmdDecrypt,
    cmdLock,
    cmdRun
};
