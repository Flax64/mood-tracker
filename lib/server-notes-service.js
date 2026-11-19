'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');

const E2EE_ENVELOPE_REGEX = /^[0-9a-fA-F]{32}:[A-Za-z0-9+/=]+$/;
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function isServerAutonomousNotesEnabled(env = process.env) {
    return String(env?.SERVER_AUTONOMOUS_NOTES ?? 'true').trim().toLowerCase() !== 'false';
}

function isWindowsPathString(rawValue) {
    const val = String(rawValue || '').trim();
    if (!val) return false;
    return /^[A-Za-z]:[\\/]/.test(val) || /^\\\\/.test(val) || val.includes('\\');
}

function isValidE2eeEnvelope(rawText) {
    return typeof rawText === 'string' && E2EE_ENVELOPE_REGEX.test(rawText.trim());
}

function normalizeE2eeKeyBuffer(secretKey) {
    const raw = String(secretKey || '');
    if (!raw) return null;
    const buf = Buffer.from(raw, 'utf8');
    return buf.length === 32 ? buf : null;
}

function encryptClientE2ee(plainText, secretKey) {
    const keyBuf = normalizeE2eeKeyBuffer(secretKey);
    if (!keyBuf) {
        throw new Error('JOURNAL_SECRET_KEY must be exactly 32 UTF-8 bytes.');
    }
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, iv);
    const encrypted = Buffer.concat([cipher.update(String(plainText ?? ''), 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('base64')}`;
}

function decryptClientE2ee(rawCipher, secretKey) {
    if (!isValidE2eeEnvelope(rawCipher)) {
        return { ok: false, reason: 'NOT_E2EE_ENVELOPE' };
    }
    const keyBuf = normalizeE2eeKeyBuffer(secretKey);
    if (!keyBuf) {
        return { ok: false, reason: 'NO_VALID_SERVER_KEY' };
    }
    const trimmed = rawCipher.trim();
    const sepIdx = trimmed.indexOf(':');
    const iv = Buffer.from(trimmed.slice(0, sepIdx), 'hex');
    const cipherBuf = Buffer.from(trimmed.slice(sepIdx + 1), 'base64');
    if (iv.length !== 16 || cipherBuf.length === 0 || cipherBuf.length % 16 !== 0) {
        return { ok: false, reason: 'INVALID_CIPHERTEXT' };
    }
    try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, iv);
        const plain = Buffer.concat([decipher.update(cipherBuf), decipher.final()]).toString('utf8');
        return { ok: true, plainText: plain };
    } catch (_) {
        return { ok: false, reason: 'E2EE_KEY_MISMATCH' };
    }
}

function buildSafeRcloneExecEnv(env = process.env) {
    const cleanEnv = { ...env };
    for (const k of Object.keys(cleanEnv)) {
        if (k.startsWith('RCLONE_') || k.startsWith('STUDY_RCLONE_')) {
            delete cleanEnv[k];
        }
    }
    return cleanEnv;
}

function runRcloneCommand({
    rcloneConf,
    args,
    timeout = 30000,
    encoding = 'utf8',
    maxBuffer = 16 * 1024 * 1024,
    execFileFn = execFile,
    env = process.env
}) {
    return new Promise((resolve, reject) => {
        execFileFn(
            'rclone',
            ['--config', rcloneConf, ...args],
            { timeout, encoding, maxBuffer, env: buildSafeRcloneExecEnv(env) },
            (err, stdout, stderr) => {
                if (err) {
                    return reject(new Error(String(stderr || err.message || 'rclone failed').trim()));
                }
                resolve(stdout);
            }
        );
    });
}

async function uploadAndVerifyStudyDocx({
    docxBuffer,
    filePath,
    rcloneConf,
    remoteTarget,
    execFileFn = execFile,
    env = process.env
}) {
    if (!Buffer.isBuffer(docxBuffer) || docxBuffer.length < 64 || !docxBuffer.subarray(0, 4).equals(ZIP_MAGIC)) {
        throw new Error('Payload is not a valid .docx ZIP container.');
    }

    const localSha256 = crypto.createHash('sha256').update(docxBuffer).digest('hex');
    await runRcloneCommand({
        rcloneConf,
        args: ['copyto', '--retries', '2', filePath, remoteTarget],
        timeout: 60000,
        execFileFn,
        env
    });

    let verified = false;
    let remoteSize = null;
    let remoteModTime = '';
    try {
        const lsOut = await runRcloneCommand({
            rcloneConf,
            args: ['lsjson', remoteTarget],
            timeout: 15000,
            execFileFn,
            env
        });
        const entries = JSON.parse(String(lsOut || '[]'));
        if (Array.isArray(entries) && entries.length > 0) {
            remoteModTime = String(entries[0].ModTime || '');
            remoteSize = Number(entries[0].Size);
            if (remoteSize === docxBuffer.length) {
                verified = true;
            }
        }
    } catch (_) {
        verified = false;
    }

    return {
        uploaded: verified,
        verified,
        localSize: docxBuffer.length,
        remoteSize,
        remoteModTime,
        sha256: localSha256,
        remoteTarget
    };
}

function resolveLocalJournalPath({ env = process.env, platform = process.platform, rootDir = path.resolve(__dirname, '..') } = {}) {
    const pathImpl = platform === 'win32' ? path.win32 : path.posix;
    const rawExplicit = String(env.JOURNAL_LOCAL_PATH || env.WORD_FILE_PATH || '').trim();
    if (rawExplicit && (platform === 'win32' || !isWindowsPathString(rawExplicit))) {
        return pathImpl.resolve(rawExplicit);
    }
    const containerDir = '/app/journal-data';
    if (platform !== 'win32' && fs.existsSync(containerDir)) {
        return pathImpl.join(containerDir, 'Diario.docx');
    }
    return pathImpl.join(rootDir, 'data', 'journal', 'Diario.docx');
}

function resolveLocalEnglishPath({ env = process.env, platform = process.platform, rootDir = path.resolve(__dirname, '..') } = {}) {
    const pathImpl = platform === 'win32' ? path.win32 : path.posix;
    const rawExplicit = String(env.ENGLISH_WORD_FILE_PATH || '').trim();
    const journalPath = resolveLocalJournalPath({ env, platform, rootDir });
    let candidate = pathImpl.join(rootDir, 'english-notes', 'English_Learning_Notebook.docx');
    if (rawExplicit && (platform === 'win32' || !isWindowsPathString(rawExplicit))) {
        candidate = pathImpl.resolve(rawExplicit);
    }
    const base = pathImpl.basename(candidate);
    if (candidate === journalPath || /personal_journal|journal_notes|diario\.docx/i.test(base)) {
        return pathImpl.join(rootDir, 'english-notes', 'English_Learning_Notebook.docx');
    }
    return candidate;
}

function resolvePythonBinary({ env = process.env, platform = process.platform, execFileSyncFn = execFileSync } = {}) {
    const explicit = String(env.PYTHON_PATH || '').trim();
    const candidates = [];
    if (explicit && (platform === 'win32' || !isWindowsPathString(explicit))) {
        candidates.push(explicit);
    }
    if (platform === 'win32') {
        candidates.push('python', 'python3', 'py');
    } else {
        candidates.push('python3', 'python');
    }
    for (const cmd of candidates) {
        try {
            execFileSyncFn(cmd, ['--version'], { stdio: 'pipe', timeout: 3000 });
            return cmd;
        } catch (_) {}
    }
    return null;
}

function runDocxWriter({
    mode,
    payload,
    env = process.env,
    platform = process.platform,
    execFileFn = execFile,
    execFileSyncFn = execFileSync
}) {
    const pythonBin = resolvePythonBinary({ env, platform, execFileSyncFn });
    if (!pythonBin) {
        return Promise.resolve({ ok: false, reason: 'PYTHON_MISSING', error: 'Python 3 runtime is not installed.' });
    }
    const scriptPath = path.join(__dirname, 'docx_writer.py');
    const stdinPayload = JSON.stringify(payload || {});
    const pyEnv = { ...env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    return new Promise((resolve) => {
        const child = execFileFn(
            pythonBin,
            [scriptPath, '--mode', mode],
            { timeout: 30000, maxBuffer: 4 * 1024 * 1024, env: pyEnv },
            (err, stdout, stderr) => {
                const rawOut = String(stdout || '').trim();
                if (rawOut) {
                    try {
                        const parsed = JSON.parse(rawOut.split(/\r?\n/).pop());
                        return resolve(parsed);
                    } catch (_) {}
                }
                const errMsg = String(stderr || err?.message || 'docx_writer failed').trim();
                return resolve({ ok: false, reason: 'WRITER_EXEC_ERROR', error: errMsg.slice(0, 300) });
            }
        );
        if (child && child.stdin) {
            child.stdin.write(stdinPayload, 'utf8');
            child.stdin.end();
        }
    });
}

function writeBufferAtomic(targetPath, buf, mode = 0o644) {
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, buf, { mode });
    fs.renameSync(tmp, targetPath);
    try {
        fs.chmodSync(targetPath, mode);
    } catch (_) {}
}

async function saveEnglishEntryToCloudAndLocal({
    entry,
    resolveRcloneFn,
    resolveStudyTargetFn,
    updateCacheFn,
    rootDir = path.resolve(__dirname, '..'),
    env = process.env,
    platform = process.platform,
    execFileFn = execFile,
    execFileSyncFn = execFileSync
}) {
    const localMirrorPath = resolveLocalEnglishPath({ env, platform, rootDir });
    const shmDir = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
    const tmpWorkPath = path.join(shmDir, `English_Write_${process.pid}_${Date.now()}.docx`);

    const rcloneCtx = typeof resolveRcloneFn === 'function'
        ? resolveRcloneFn({ preferStudy: true })
        : { confPath: '', cleanup: false, usingStudyConfig: false };
    const rcloneConf = rcloneCtx?.confPath || '';
    const hasRclone = Boolean(rcloneConf && fs.existsSync(rcloneConf));
    const targetInfo = typeof resolveStudyTargetFn === 'function'
        ? resolveStudyTargetFn(rcloneConf, Boolean(rcloneCtx?.usingStudyConfig))
        : { remoteTarget: '' };
    const remoteTarget = targetInfo?.remoteTarget || '';

    let seededFrom = 'fresh';
    try {
        // Cloud-first: pull existing notebook from Google Drive when available
        if (hasRclone && remoteTarget) {
            try {
                const lsRaw = await runRcloneCommand({
                    rcloneConf,
                    args: ['lsjson', remoteTarget],
                    timeout: 15000,
                    execFileFn,
                    env
                });
                const entries = JSON.parse(String(lsRaw || '[]'));
                if (Array.isArray(entries) && entries.length > 0) {
                    await runRcloneCommand({
                        rcloneConf,
                        args: ['copyto', '--retries', '1', remoteTarget, tmpWorkPath],
                        timeout: 30000,
                        execFileFn,
                        env
                    });
                    if (fs.existsSync(tmpWorkPath) && fs.statSync(tmpWorkPath).size >= 64) {
                        seededFrom = 'drive-word';
                    }
                }
            } catch (_) {
                // Fall back to local mirror or fresh template if Drive check/download failed transiently
            }
        }

        if (seededFrom === 'fresh' && fs.existsSync(localMirrorPath)) {
            const stat = fs.statSync(localMirrorPath);
            if (stat.isFile() && stat.size >= 64) {
                fs.copyFileSync(localMirrorPath, tmpWorkPath);
                seededFrom = 'local-word';
            }
        }

        const writeRes = await runDocxWriter({
            mode: 'english',
            payload: { docxPath: tmpWorkPath, entry },
            rootDir,
            env,
            platform,
            execFileFn,
            execFileSyncFn
        });
        if (!writeRes || !writeRes.ok || !fs.existsSync(tmpWorkPath)) {
            return {
                ok: false,
                reason: writeRes?.reason || 'ENGLISH_DOCX_WRITE_FAILED',
                error: writeRes?.error || 'Could not update English_Learning_Notebook.docx'
            };
        }

        const updatedBuf = fs.readFileSync(tmpWorkPath);
        try {
            writeBufferAtomic(localMirrorPath, updatedBuf, 0o600);
        } catch (_) {}

        if (typeof updateCacheFn === 'function') {
            updateCacheFn(updatedBuf, hasRclone ? 'drive-word' : 'local-word', {
                size: updatedBuf.length,
                mtimeMs: Date.now()
            });
        }

        if (hasRclone && remoteTarget) {
            try {
                const syncRes = await uploadAndVerifyStudyDocx({
                    docxBuffer: updatedBuf,
                    filePath: tmpWorkPath,
                    rcloneConf,
                    remoteTarget,
                    execFileFn,
                    env
                });
                if (syncRes.verified) {
                    return {
                        ok: true,
                        mode: 'cloud_drive',
                        uploaded: true,
                        verified: true,
                        seededFrom,
                        heading: writeRes.heading,
                        deduplicated: Boolean(writeRes.deduplicated),
                        remoteTarget,
                        localMirrorPath
                    };
                }
                return {
                    ok: true,
                    mode: 'local_cache_pending_drive',
                    uploaded: false,
                    verified: false,
                    needsRetry: true,
                    heading: writeRes.heading,
                    error: 'Drive byte verification mismatch',
                    localMirrorPath
                };
            } catch (uploadErr) {
                return {
                    ok: true,
                    mode: 'local_cache_pending_drive',
                    uploaded: false,
                    verified: false,
                    needsRetry: true,
                    heading: writeRes.heading,
                    error: uploadErr.message,
                    localMirrorPath
                };
            }
        }

        return {
            ok: true,
            mode: 'local_volume',
            uploaded: false,
            verified: false,
            seededFrom,
            heading: writeRes.heading,
            deduplicated: Boolean(writeRes.deduplicated),
            localMirrorPath
        };
    } finally {
        try {
            if (fs.existsSync(tmpWorkPath)) fs.unlinkSync(tmpWorkPath);
            if (rcloneCtx?.cleanup && rcloneConf && fs.existsSync(rcloneConf)) fs.unlinkSync(rcloneConf);
        } catch (_) {}
    }
}

const JOURNAL_MONTH_NAMES_EN = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

function computeJournalHeadingForDateIso(dateIso = null) {
    const clean = String(dateIso || '').trim();
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(clean)
        ? clean
        : new Date().toISOString().slice(0, 10);
    const [year, month, day] = iso.split('-').map(Number);
    const epochMs = Date.UTC(2026, 7, 30); // 2026-08-30 -> D-500
    const targetMs = Date.UTC(year, month - 1, day);
    const daysPassed = Math.round((targetMs - epochMs) / 86400000);
    const dActual = 500 - daysPassed;
    const suffix = (day >= 11 && day <= 13)
        ? 'th'
        : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
    return `${JOURNAL_MONTH_NAMES_EN[month - 1]} ${String(day).padStart(2, '0')}${suffix} D-${dActual}`;
}

async function saveJournalNoteLocalEncrypted({
    plainText,
    wordPassword,
    targetDateIso = null,
    backfillMissingBefore = true,
    rootDir = path.resolve(__dirname, '..'),
    env = process.env,
    platform = process.platform,
    execFileFn = execFile,
    execFileSyncFn = execFileSync
}) {
    const journalPath = resolveLocalJournalPath({ env, platform, rootDir });
    if (!wordPassword) {
        return { ok: false, reason: 'PASSWORD_MISSING', error: 'WORD_PASSWORD is required to encrypt local Diario.docx.' };
    }
    return runDocxWriter({
        mode: 'journal',
        payload: {
            docxPath: journalPath,
            password: String(wordPassword),
            text: String(plainText || ''),
            targetDateIso,
            backfillMissingBefore: Boolean(backfillMissingBefore)
        },
        rootDir,
        env,
        platform,
        execFileFn,
        execFileSyncFn
    });
}

async function inspectJournalDailyCoverage({
    wordPassword,
    todayIso = null,
    rootDir = path.resolve(__dirname, '..'),
    env = process.env,
    platform = process.platform,
    execFileFn = execFile,
    execFileSyncFn = execFileSync
}) {
    const journalPath = resolveLocalJournalPath({ env, platform, rootDir });
    if (!wordPassword) {
        return { ok: false, reason: 'PASSWORD_MISSING', error: 'WORD_PASSWORD is required to inspect local Diario.docx.' };
    }
    return runDocxWriter({
        mode: 'journal-inspect',
        payload: {
            docxPath: journalPath,
            password: String(wordPassword),
            todayIso
        },
        rootDir,
        env,
        platform,
        execFileFn,
        execFileSyncFn
    });
}

async function verifyJournalDailyCoverage({
    wordPassword,
    todayIso = null,
    throughDateIso = null,
    createIfMissing = false,
    fillIfEmptyDoc = false,
    rootDir = path.resolve(__dirname, '..'),
    env = process.env,
    platform = process.platform,
    execFileFn = execFile,
    execFileSyncFn = execFileSync
}) {
    const journalPath = resolveLocalJournalPath({ env, platform, rootDir });
    if (!wordPassword) {
        return { ok: false, reason: 'PASSWORD_MISSING', error: 'WORD_PASSWORD is required to verify local Diario.docx.' };
    }
    return runDocxWriter({
        mode: 'journal-verify',
        payload: {
            docxPath: journalPath,
            password: String(wordPassword),
            todayIso,
            throughDateIso,
            createIfMissing: Boolean(createIfMissing),
            fillIfEmptyDoc: Boolean(fillIfEmptyDoc)
        },
        rootDir,
        env,
        platform,
        execFileFn,
        execFileSyncFn
    });
}

function getLocalJournalStatus({ env = process.env, platform = process.platform, rootDir = path.resolve(__dirname, '..') } = {}) {
    const journalPath = resolveLocalJournalPath({ env, platform, rootDir });
    const exists = fs.existsSync(journalPath);
    let sizeBytes = 0;
    let updatedAt = null;
    let encrypted = false;
    if (exists) {
        try {
            const st = fs.statSync(journalPath);
            sizeBytes = st.size;
            updatedAt = st.mtime ? st.mtime.toISOString() : null;
            const fd = fs.openSync(journalPath, 'r');
            try {
                const head = Buffer.alloc(8);
                const readBytes = fs.readSync(fd, head, 0, 8, 0);
                encrypted = readBytes === 8 && head.equals(OLE2_MAGIC);
            } finally {
                fs.closeSync(fd);
            }
        } catch (_) {}
    }
    return {
        exists,
        encrypted,
        sizeBytes,
        updatedAt,
        path: journalPath,
        passwordConfigured: Boolean(String(env.WORD_PASSWORD || '').trim())
    };
}

module.exports = {
    E2EE_ENVELOPE_REGEX,
    isServerAutonomousNotesEnabled,
    isWindowsPathString,
    isValidE2eeEnvelope,
    normalizeE2eeKeyBuffer,
    encryptClientE2ee,
    decryptClientE2ee,
    buildSafeRcloneExecEnv,
    runRcloneCommand,
    uploadAndVerifyStudyDocx,
    resolveLocalJournalPath,
    resolveLocalEnglishPath,
    resolvePythonBinary,
    runDocxWriter,
    computeJournalHeadingForDateIso,
    saveEnglishEntryToCloudAndLocal,
    saveJournalNoteLocalEncrypted,
    inspectJournalDailyCoverage,
    verifyJournalDailyCoverage,
    getLocalJournalStatus
};
