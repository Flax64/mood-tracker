const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const serverNotes = require('../lib/server-notes-service');
const serverLoggerMod = require('../lib/server-logger');
const langStudio = require('../lib/language-studio');

const ROOT = path.resolve(__dirname, '..');

function resolvePythonCmd() {
    const candidates = process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'];
    for (const cmd of candidates) {
        const res = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
        if (!res.error && res.status === 0) return cmd;
    }
    return null;
}

describe('lib/server-notes-service & lib/docx_writer.py (Notas autónomas en Ubuntu Server)', () => {
    it('cifra y descifra sobres E2EE compatibles con frontend.js (AES-256-CBC 32 bytes) y rechaza llaves erróneas', () => {
        const key32 = '1234567890abcdef1234567890abcdef';
        const wrongKey32 = 'abcdef1234567890abcdef1234567890';
        const sample = JSON.stringify({ category: 'vocabulary', word: 'Resilience', spanish: 'Resiliencia' });

        const cipher = serverNotes.encryptClientE2ee(sample, key32);
        assert.strictEqual(serverNotes.isValidE2eeEnvelope(cipher), true);

        const okDec = serverNotes.decryptClientE2ee(cipher, key32);
        assert.strictEqual(okDec.ok, true);
        assert.strictEqual(okDec.plainText, sample);

        const badDec = serverNotes.decryptClientE2ee(cipher, wrongKey32);
        assert.strictEqual(badDec.ok, false);
        assert.strictEqual(badDec.reason, 'E2EE_KEY_MISMATCH');

        assert.strictEqual(serverNotes.isValidE2eeEnvelope('cipher-1'), false);
        assert.strictEqual(serverNotes.decryptClientE2ee('cipher-1', key32).reason, 'NOT_E2EE_ENVELOPE');
    });

    it('resuelve rutas de Journal local y Cuaderno de Idiomas ignorando rutas Windows en Linux y aislando Diario', () => {
        const linuxJournal = serverNotes.resolveLocalJournalPath({
            env: { WORD_FILE_PATH: 'C:\\Users\\flavi\\Desktop\\Diario.docx' },
            platform: 'linux',
            rootDir: '/srv/hub'
        });
        assert.strictEqual(linuxJournal, '/srv/hub/data/journal/Diario.docx');

        const customLinuxJournal = serverNotes.resolveLocalJournalPath({
            env: { JOURNAL_LOCAL_PATH: '/var/lib/hub/Diario.docx' },
            platform: 'linux',
            rootDir: '/srv/hub'
        });
        assert.strictEqual(customLinuxJournal, '/var/lib/hub/Diario.docx');

        const isolatedEnglish = serverNotes.resolveLocalEnglishPath({
            env: {
                JOURNAL_LOCAL_PATH: '/srv/hub/data/journal/Diario.docx',
                ENGLISH_WORD_FILE_PATH: '/srv/hub/data/journal/Diario.docx'
            },
            platform: 'linux',
            rootDir: '/srv/hub'
        });
        assert.strictEqual(isolatedEnglish, '/srv/hub/english-notes/English_Learning_Notebook.docx');
    });

    it('crea, actualiza, fusiona canciones/traducciones y deduplica English_Learning_Notebook.docx vía OOXML sin MS Word', () => {
        const pyCmd = resolvePythonCmd();
        assert.ok(pyCmd, 'Python 3 debe estar disponible para probar lib/docx_writer.py');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdh-eng-docx-'));
        const docxPath = path.join(tmpDir, 'English_Learning_Notebook.docx');
        try {
            const utf8Env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
            const runWriter = (entry) => spawnSync(
                pyCmd,
                [path.join(ROOT, 'lib', 'docx_writer.py'), '--mode', 'english'],
                { input: JSON.stringify({ docxPath, entry }), encoding: 'utf8', env: utf8Env }
            );

            // 1. Vocabulario
            const r1 = runWriter({
                category: 'vocabulary',
                language: 'English',
                word: 'Ubiquitous',
                part_of_speech: 'adjective',
                spanish: 'Ubicuo / en todas partes',
                example: 'Tailscale makes private access ubiquitous.'
            });
            assert.strictEqual(r1.status, 0, r1.stderr);
            const j1 = JSON.parse(r1.stdout.trim());
            assert.strictEqual(j1.ok, true);
            assert.strictEqual(j1.deduplicated, false);

            // 2. Duplicado de vocabulario omitido
            const rDup = runWriter({
                category: 'vocabulary',
                language: 'English',
                word: 'Ubiquitous',
                part_of_speech: 'adjective',
                spanish: 'Ubicuo / en todas partes'
            });
            assert.strictEqual(rDup.status, 0, rDup.stderr);
            assert.strictEqual(JSON.parse(rDup.stdout.trim()).deduplicated, true);

            // 3. Canción inicial + actualización posterior conservando letra previa y agregando traducción ES
            const rSong1 = runWriter({
                category: 'music',
                language: 'English + Korean',
                song_title: 'FOREVER',
                artists_display: 'BABYMONSTER',
                album_title: 'DRIP',
                album_type: 'Album',
                release_year: '2024',
                track_number: 7,
                lyrics_study: '[EN]\nForever ever never fade'
            });
            assert.strictEqual(rSong1.status, 0, rSong1.stderr);

            const rSong2 = runWriter({
                category: 'music',
                language: 'English + Korean',
                song_title: 'FOREVER',
                artists_display: 'BABYMONSTER',
                album_title: 'DRIP',
                album_type: 'Album',
                release_year: '2024',
                track_number: 7,
                lyrics_study: '=== [ES — Traducción IA] ===\nPor siempre jamás se desvanecerá',
                vocabulary_list: 'fade: desvanecerse'
            });
            assert.strictEqual(rSong2.status, 0, rSong2.stderr);

            const parsed = langStudio.parseStudyNotebookDocxBuffer(fs.readFileSync(docxPath), { includeAllEntries: true });
            assert.strictEqual(parsed.ok, true);
            assert.strictEqual(parsed.counts.vocabulary, 1);
            assert.strictEqual(parsed.counts.music, 1);
            assert.deepStrictEqual(parsed.facets.artists, ['BABYMONSTER']);
            assert.deepStrictEqual(parsed.facets.albums, ['DRIP']);

            const songEntry = langStudio.findNotebookSongEntry(parsed, {
                songTitle: 'FOREVER',
                artistName: 'BABYMONSTER',
                albumTitle: 'DRIP'
            });
            assert.ok(songEntry);
            assert.match(songEntry.lyrics, /Forever ever never fade/);
            assert.match(songEntry.lyrics, /Por siempre jamás se desvanecerá/);
            assert.strictEqual(songEntry.trackNumber, 7);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('calcula encabezados Month DDth D-XXX, agrega entradas al Journal OOXML y evita escribir sin contraseña', () => {
        const pyCmd = resolvePythonCmd();
        assert.ok(pyCmd, 'Python 3 debe estar disponible');

        const pyCheck = spawnSync(
            pyCmd,
            [
                '-c',
                [
                    'import sys, json, zipfile, io, xml.etree.ElementTree as ET',
                    `sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'lib'))})`,
                    'import docx_writer as dw',
                    'assert dw.calcular_encabezado("2026-08-30") == "August 30th D-500"',
                    'assert dw.calcular_encabezado("2026-09-01") == "September 01st D-498"',
                    'assert dw.calcular_encabezado("2026-11-18") == "November 18th D-420"',
                    'plain = dw._build_minimal_docx_bytes(mode="journal")',
                    'p1, m1 = dw._append_journal_entry_to_docx_bytes(plain, "Primer pensamiento del día", "2026-11-18")',
                    'assert m1["heading"] == "November 18th D-420" and m1["skipped"] is False',
                    'p2, m2 = dw._append_journal_entry_to_docx_bytes(p1, "Nothing to report.", "2026-11-18")',
                    'assert m2["skipped"] is True',
                    'p3, m3 = dw._append_journal_entry_to_docx_bytes(p1, "Segunda nota del mismo día", "2026-11-18")',
                    'assert m3["skipped"] is False',
                    'with zipfile.ZipFile(io.BytesIO(p3), "r") as zf: xml_txt = zf.read("word/document.xml").decode("utf-8")',
                    'assert xml_txt.count("November 18th D-420") == 1',
                    'assert "Primer pensamiento del día" in xml_txt and "Segunda nota del mismo día" in xml_txt',
                    'no_pwd = dw.write_encrypted_journal_docx("/tmp/ignored.docx", "", "Hola")',
                    'assert no_pwd["ok"] is False and no_pwd["reason"] == "PASSWORD_MISSING"',
                    'print("JOURNAL_OOXML_OK")'
                ].join('\n')
            ],
            { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } }
        );
        assert.strictEqual(pyCheck.status, 0, pyCheck.stderr || pyCheck.stdout);
        assert.match(pyCheck.stdout, /JOURNAL_OOXML_OK/);
    });

    it('sincroniza English_Learning_Notebook.docx directo con Google Drive vía rclone mockeado y detecta reintentos', async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pdh-cloud-sync-'));
        const fakeConf = path.join(tmpRoot, 'rclone.conf');
        fs.writeFileSync(fakeConf, '[gdrive_study]\ntype = drive\n');

        let uploadedBuf = null;
        let failUpload = false;
        const fakeExecFile = (bin, args, _opts, cb) => {
            if (bin !== 'rclone') {
                return require('node:child_process').execFile(bin, args, _opts, cb);
            }
            // args: ['--config', conf, cmd, ...]
            const subCmd = args[2];
            if (subCmd === 'lsjson') {
                if (uploadedBuf) {
                    return cb(null, JSON.stringify([{ Size: uploadedBuf.length, ModTime: '2026-11-18T12:00:00Z' }]), '');
                }
                return cb(null, '[]', '');
            }
            if (subCmd === 'copyto') {
                const src = args[args.length - 2];
                const dst = args[args.length - 1];
                if (String(src).startsWith('gdrive_study:')) {
                    if (!uploadedBuf) return cb(new Error('not found'), '', 'not found');
                    fs.writeFileSync(dst, uploadedBuf);
                    return cb(null, '', '');
                }
                if (failUpload) {
                    return cb(new Error('network timeout'), '', 'network timeout');
                }
                uploadedBuf = fs.readFileSync(src);
                return cb(null, '', '');
            }
            return cb(new Error(`Unexpected rclone cmd: ${subCmd}`), '', '');
        };

        let cachedParsed = null;
        try {
            const resOk = await serverNotes.saveEnglishEntryToCloudAndLocal({
                entry: {
                    category: 'grammar',
                    language: 'English',
                    title: 'Present Perfect vs Past Simple',
                    notes: 'Use Present Perfect when the timeframe is unfinished.'
                },
                resolveRcloneFn: () => ({ confPath: fakeConf, cleanup: false, usingStudyConfig: true }),
                resolveStudyTargetFn: () => ({ remoteTarget: 'gdrive_study:NotasIdiomas/English_Learning_Notebook.docx' }),
                updateCacheFn: (buf, source) => {
                    cachedParsed = langStudio.parseStudyNotebookDocxBuffer(buf, { includeAllEntries: true });
                    cachedParsed.source = source;
                },
                rootDir: tmpRoot,
                execFileFn: fakeExecFile
            });

            assert.strictEqual(resOk.ok, true);
            assert.strictEqual(resOk.mode, 'cloud_drive');
            assert.strictEqual(resOk.uploaded, true);
            assert.strictEqual(resOk.verified, true);
            assert.ok(Buffer.isBuffer(uploadedBuf) && uploadedBuf.length > 500);
            assert.strictEqual(cachedParsed?.ok, true);
            assert.strictEqual(cachedParsed?.source, 'drive-word');
            assert.strictEqual(cachedParsed?.counts?.grammar, 1);

            // Simular fallo temporal de Drive -> conserva caché local y marca needsRetry
            failUpload = true;
            const resRetry = await serverNotes.saveEnglishEntryToCloudAndLocal({
                entry: {
                    category: 'phrasal_verb',
                    language: 'English',
                    verb: 'Look forward to',
                    meaning_es: 'Esperar con ilusión'
                },
                resolveRcloneFn: () => ({ confPath: fakeConf, cleanup: false, usingStudyConfig: true }),
                resolveStudyTargetFn: () => ({ remoteTarget: 'gdrive_study:NotasIdiomas/English_Learning_Notebook.docx' }),
                updateCacheFn: (buf) => {
                    cachedParsed = langStudio.parseStudyNotebookDocxBuffer(buf, { includeAllEntries: true });
                },
                rootDir: tmpRoot,
                execFileFn: fakeExecFile
            });

            assert.strictEqual(resRetry.ok, true);
            assert.strictEqual(resRetry.mode, 'local_cache_pending_drive');
            assert.strictEqual(resRetry.needsRetry, true);
            assert.strictEqual(cachedParsed?.counts?.grammar, 1);
            assert.strictEqual(cachedParsed?.counts?.phrasal_verb, 1);
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    it('genera logs rotativos del sistema en server.log y error.log, redacta secretos y respeta exclusión de Git', () => {
        const tmpLogs = fs.mkdtempSync(path.join(os.tmpdir(), 'pdh-sys-logs-'));
        try {
            assert.strictEqual(serverLoggerMod.isAutomatedTestEnv(), true);
            assert.strictEqual(
                serverLoggerMod.sanitizeUrlForLog('/api/planner/phone-location?token=secret123&mode=gps'),
                '/api/planner/phone-location?token=%5BREDACTED%5D&mode=gps'
            );

            const capturedOut = [];
            const capturedErr = [];
            const logger = serverLoggerMod.createServerLogger({
                logDir: tmpLogs,
                level: 'info',
                maxBytes: 64 * 1024,
                maxFiles: 3,
                enableFileLogging: true,
                stdoutWrite: (ln) => capturedOut.push(ln),
                stderrWrite: (ln) => capturedErr.push(ln)
            });

            logger.info('SYSTEM', 'Servidor iniciado', { port: 3000 });
            logger.warn('YTDLP', 'Sin subtítulos disponibles', { songId: 7 });
            logger.error('HTTP', 'GET /api/test?token=mySecretToken -> 500', { ms: '12.4' });

            assert.strictEqual(capturedOut.length, 1);
            assert.strictEqual(capturedErr.length, 2);
            assert.strictEqual(fs.existsSync(logger.serverLogPath), true);
            assert.strictEqual(fs.existsSync(logger.errorLogPath), true);

            const srvText = fs.readFileSync(logger.serverLogPath, 'utf8');
            const errText = fs.readFileSync(logger.errorLogPath, 'utf8');
            assert.match(srvText, /\[SYSTEM\] Servidor iniciado \| port=3000/);
            assert.match(srvText, /\[YTDLP\]/);
            assert.equal(srvText.includes('mySecretToken'), false, 'No debe filtrar tokens en logs');
            assert.match(errText, /\[WARN\] \[YTDLP\]/);
            assert.match(errText, /\[ERROR\] \[HTTP\]/);
            assert.equal(errText.includes('[SYSTEM]'), false, 'error.log solo debe incluir WARN/ERROR/CRASH');

            const tail = logger.getRecentLogTail({ kind: 'server', lines: 2 });
            assert.strictEqual(tail.ok, true);
            assert.strictEqual(tail.lines.length, 2);

            // Verificar que git ignore logs/, *.log y *.log.1
            const gitChk = spawnSync('git', ['check-ignore', '-q', '--no-index', 'logs/server.log', 'logs/server.log.1', 'server.log.2'], {
                cwd: ROOT,
                encoding: 'utf8'
            });
            if (!gitChk.error && gitChk.status !== 128) {
                assert.strictEqual(gitChk.status, 0, 'logs/, server.log y archivos rotados *.log.* deben ser ignorados por Git');
            }
        } finally {
            fs.rmSync(tmpLogs, { recursive: true, force: true });
        }
    });
});
