const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
// Rutas absolutas resueltas desde la raíz del proyecto (independientes del cwd de `node --test`).
// Evita ENOENT cuando la suite se ejecuta desde otra carpeta (Issue #84).
const SYNC_PY_PATH = path.resolve(__dirname, '..', 'sincronitation', 'sincronizador.py');
const YT_HELPER_PY_PATH = path.resolve(__dirname, '..', 'sincronitation', 'yt_lyrics_helper.py');

function readText(relPath) {
    return fs.readFileSync(path.resolve(ROOT, relPath), 'utf8');
}

function resolvePythonCmd() {
    const candidates = process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'];
    for (const cmd of candidates) {
        try {
            execFileSync(cmd, ['--version'], { stdio: 'pipe' });
            return cmd;
        } catch (_) { /* siguiente candidato */ }
    }
    return null;
}

describe('Sintaxis de código (JS, HTML, CSS, Python, Bash)', () => {
    it('valida sintaxis de server.js, módulos lib/, scripts públicos y tests/ci-summary.js con node --check', () => {
        for (const rel of [
            'server.js',
            'lib/transport-crypto.js',
            'lib/language-studio.js',
            'lib/youtube-metadata.js',
            'lib/ytdlp-service.js',
            'lib/server-notes-service.js',
            'public/theme-init.js',
            'public/i18n.js',
            'public/guia-visual.js',
            'public/transport-crypto.js',
            'public/translator-widget.js',
            'public/translator-popup.js',
            'public/frontend.js',
            'scripts/release-version.js',
            'tests/ci-summary.js'
        ]) {
            execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' });
        }

        const popupHtml = fs.readFileSync(path.join(ROOT, 'public/translator-popup.html'), 'utf8');
        for (const token of [
            '<script src="theme-init.js"></script>',
            '<link rel="stylesheet" href="style.css">',
            '<script src="translator-widget.js" defer></script>',
            '<script src="translator-popup.js" defer></script>',
            'id="popupTranslatorInput"',
            'class="english-textarea translator-extension-textarea"',
            'id="btnRunPopupTranslator"',
            'id="popupTranslatorResultBox"'
        ]) {
            assert.ok(popupHtml.includes(token), `public/translator-popup.html missing required token: ${token}`);
        }
        assert.ok(
            !/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(popupHtml),
            'public/translator-popup.html must not include inline <script> tags due to strict CSP'
        );
    });

    it('valida sintaxis de scripts embebidos y estructura básica de HTML', () => {
        const indexHtml = readText('public/index.html');
        assert.match(indexHtml, /<html\s+lang=["']en["']/i);
        assert.match(indexHtml, /<script[^>]+src=["']theme-init\.js["']/i);
        assert.match(indexHtml, /<script[^>]+src=["']frontend\.js["']/i);
        assert.match(indexHtml, /href=["']style\.css["']/i);
        assert.match(indexHtml, /id=["']themeToggleBtn["']|data-theme/i);
        assert.match(indexHtml, /id=["']appBootScreen["']/i);
        assert.match(indexHtml, /id=["']authOverlay["'][^>]*\bhidden\b/i);
        assert.match(indexHtml, /Personal Daily Hub/);
        assert.match(indexHtml, /Daily Hub/);
        assert.match(indexHtml, /id=["']agendaLoadingBanner["']/i);
        assert.match(indexHtml, /id=["']resumenLoadingBanner["']/i);
        assert.match(indexHtml, /id=["']view-english["']/i);
        assert.match(indexHtml, /id=["']englishForm["']/i);
        for (const fieldId of [
            'loginPassword',
            'regPassword',
            'regCodigoValidacion',
            'resetNewPassword',
            'resetConfirmPassword',
            'medicoPassword',
            'mfaCodeInput'
        ]) {
            assert.ok(
                indexHtml.includes(`data-toggle-password="${fieldId}"`),
                `Falta botón ojito data-toggle-password="${fieldId}" en index.html`
            );
        }
        assert.ok(indexHtml.includes('id="authMfaForm"'), 'Falta formulario #authMfaForm en index.html');
        const frontendJs = readText('public/frontend.js');
        assert.match(frontendJs, /function\s+initPasswordToggles\s*\(/);
        for (const fnName of [
            'runWithButtonLock',
            'createIdempotencyKey',
            'createRequestTracker',
            'submitMutationRequest',
            'createLoadingBanner',
            'hideBootScreen',
            'validateEmailClient',
            'validatePasswordFormatClient'
        ]) {
            assert.match(frontendJs, new RegExp(`function\\s+${fnName}\\s*\\(`), `Falta helper ${fnName} en frontend.js`);
        }

        const serverJs = readText('server.js');
        assert.match(serverJs, /Permissions-Policy['"],\s*['"]geolocation=\(self\)/);
        for (const fnName of [
            'preventDuplicateSubmit',
            'createRateLimiter',
            'normalizeEmail',
            'validatePasswordFormat',
            'requireNonEmptyBody'
        ]) {
            assert.match(serverJs, new RegExp(`function\\s+${fnName}\\s*\\(`), `Falta helper ${fnName} en server.js`);
        }
        assert.match(serverJs, /Personal Daily Hub/);

        const dashHtml = readText('public/dashboard.html');
        assert.match(dashHtml, /<html\s+lang=["']en["']/i);
        assert.match(dashHtml, /Daily Hub/);
        const scriptMatches = [...dashHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
        assert.ok(scriptMatches.length > 0, 'dashboard.html debe incluir script de redirección');
        for (const m of scriptMatches) {
            new vm.Script(m[1], { filename: 'public/dashboard.html' });
        }
    });

    it('verifica llaves balanceadas, spinners, tema oscuro y responsividad de agenda en public/style.css', () => {
        const css = readText('public/style.css');
        assert.match(css, /\[data-theme=["']dark["']\]/);
        assert.match(css, /\.spinner-circle\b/);
        assert.match(css, /\.boot-screen\b/);
        assert.match(css, /\.agenda-item-top\b/);
        assert.match(css, /\.jira-status-select\s*\{[\s\S]*?max-width:\s*100%/);
        assert.match(css, /\.jira-status-select\s*\{[\s\S]*?min-width:\s*0/);
        assert.match(css, /\.agenda-cat-pill,\s*\.agenda-type-pill\s*\{[\s\S]*?white-space:\s*nowrap/);
        assert.match(css, /\.agenda-cell\s*\{[\s\S]*?min-width:\s*0/);
        assert.match(css, /\.music-catalog-container\s*\{[\s\S]*?overflow-y:\s*auto/);
        assert.match(css, /\.music-artist-group\s*\{[\s\S]*?flex-shrink:\s*0/);
        assert.match(css, /\.music-song-row\s*\{[\s\S]*?flex-shrink:\s*0/);
        assert.match(css, /\.rep-item\s*\{[\s\S]*?flex-shrink:\s*0/);

        const frontendJs = readText('public/frontend.js');
        assert.match(frontendJs, /agenda-item-top/);

        const stripped = css
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
        const opens = (stripped.match(/\{/g) || []).length;
        const closes = (stripped.match(/\}/g) || []).length;
        assert.ok(opens > 20, 'style.css debe contener reglas CSS');
        assert.strictEqual(opens, closes, `Llaves desbalanceadas en style.css: ${opens} vs ${closes}`);
    });

    it('valida sintaxis Python de sincronitation/*.py y lib/docx_writer.py', () => {
        const DOCX_WRITER_PY_PATH = path.resolve(ROOT, 'lib', 'docx_writer.py');
        const pyFiles = [SYNC_PY_PATH, YT_HELPER_PY_PATH, DOCX_WRITER_PY_PATH];
        for (const pyPath of pyFiles) {
            assert.ok(fs.existsSync(pyPath), `Falta ${path.relative(ROOT, pyPath)}`);
        }
        const pyCmd = resolvePythonCmd();
        for (const pyPath of pyFiles) {
            const pyCode = fs.readFileSync(pyPath, 'utf8');
            if (pyPath === SYNC_PY_PATH) {
                assert.match(pyCode, /EC2_HOST/);
                assert.match(pyCode, /JOURNAL_SECRET_KEY/);
            }
            if (!pyCmd) continue;
            execFileSync(
                pyCmd,
                ['-c', 'import ast, sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())', pyPath],
                { stdio: 'pipe' }
            );
        }
    });

    it('valida formato Unix (LF), cabecera e higiene de los scripts bash', () => {
        const scripts = ['scripts/backup.sh', 'scripts/env-vault.sh', 'scripts/restore.sh'];
        for (const rel of scripts) {
            const full = path.join(ROOT, rel);
            const content = fs.readFileSync(full, 'utf8');
            assert.strictEqual(content.includes('\r\n'), false, `${rel} no debe contener saltos CRLF`);
            assert.ok(content.startsWith('#!/bin/bash\n'), `${rel} debe iniciar con #!/bin/bash`);
            assert.match(content, /set -euo pipefail/, `${rel} debe usar set -euo pipefail`);

            if (process.platform !== 'win32') {
                execFileSync('bash', ['-n', full], { stdio: 'pipe' });
            }
        }

        const backupSh = readText('scripts/backup.sh');
        const restoreSh = readText('scripts/restore.sh');
        assert.match(backupSh, /unset RCLONE_BACKUP_DIR RCLONE_REMOTE/);
        assert.match(restoreSh, /unset RCLONE_BACKUP_DIR RCLONE_REMOTE/);
    });
});

describe('Integridad de configuración, Docker, SQL y CI/CD', () => {
    it('mantiene package.json y package-lock.json válidos y sincronizados', () => {
        const pkg = JSON.parse(readText('package.json'));
        const lock = JSON.parse(readText('package-lock.json'));
        assert.ok(pkg.scripts && pkg.scripts.test, 'package.json debe definir script test');
        const deps = Object.keys(pkg.dependencies || {});
        assert.ok(deps.length > 0);
        for (const dep of deps) {
            assert.ok(
                lock.packages && lock.packages[`node_modules/${dep}`],
                `Falta ${dep} en package-lock.json`
            );
        }
    });

    it('define las 13 tablas requeridas (incluyendo música/inglés/crisis) en init.sql', () => {
        const sql = readText('init.sql');
        for (const table of [
            'RegistrosMood',
            'RegistrosSleep',
            'RegistrosCrisis',
            'RegistrosAgenda',
            'Usuarios',
            'SesionesAuth',
            'CodigosSeguridad',
            'ConfiguracionUsuario',
            'RecordatoriosEstado',
            'MusicaArtistas',
            'MusicaAlbumes',
            'MusicaCanciones',
            'MusicaCancionArtistas'
        ]) {
            assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), `Falta tabla ${table}`);
        }
        assert.match(sql, /estado\s+ENUM\('activo',\s*'inactivo',\s*'suspendido'\)/);
        assert.match(sql, /hora_dormir\s+VARCHAR\(5\)/);
        assert.match(sql, /es_desvelo\s+TINYINT\(1\)/);
        assert.match(sql, /tipo_registro\s+VARCHAR\(30\)/);
        assert.match(sql, /motivo_desvelo\s+VARCHAR\(500\)/);
        assert.match(sql, /tipo\s+ENUM\('registro',\s*'reset',\s*'mfa'\)/);
        assert.match(sql, /tipo\s+ENUM\('evento',\s*'tarea'\)/);
        assert.match(sql, /categoria\s+ENUM\('universidad',\s*'personal'\)/);
        assert.match(sql, /estado\s+ENUM\('todo',\s*'in_progress',\s*'done',\s*'skipped'\)/);
        assert.match(sql, /tipo_lanzamiento\s+ENUM\('album',\s*'mini_album',\s*'ep',\s*'single',\s*'ost',\s*'collab_single'\)/);
        assert.match(sql, /fecha_lanzamiento\s+DATE\s+NULL/i);
    });

    it('reemplaza el arcoíris, expone controles de Settings/Jira/Recordatorios/Música y agrega índices a las guías', () => {
        for (const relPath of [
            'public/index.html',
            'public/dashboard.html',
            'README.md',
            'guides/MANUAL_DE_USUARIO.md',
            'guides/GUIA_TECNICA_ARQUITECTURA.md',
            'guides/GUIA_OPERACION_Y_MIGRACION.md'
        ]) {
            const content = readText(relPath);
            assert.equal(content.includes('🌈'), false, `${relPath} no debe contener el emoji arcoíris`);
        }

        for (const docPath of [
            'README.md',
            'guides/MANUAL_DE_USUARIO.md',
            'guides/GUIA_TECNICA_ARQUITECTURA.md',
            'guides/GUIA_OPERACION_Y_MIGRACION.md',
            'guides/GUIA_COMANDOS.md',
            'guides/GUIA_TECNICA.md',
            'guides/GUIA_MIGRACION.md',
            'guides/GUIA_INSTALACION_UBUNTU_SERVER_26.md'
        ]) {
            const top = readText(docPath).slice(0, 1200);
            assert.match(top, /## .*[ÍI]ndice/i, `${docPath} debe incluir un índice al inicio`);
        }

        const indexHtml = readText('public/index.html');
        for (const requiredId of [
            'id="btnMobileHome"',
            'id="reminderTray"',
            'id="agendaCategoryFilters"',
            'id="agendaTypeFilters"',
            'id="agendaTipo"',
            'id="agendaCategoria"',
            'id="agendaEstado"',
            'id="view-settings"',
            'id="settingsForm"',
            'id="setPhoneEnabled"',
            'id="setNtfyTopic"',
            'id="setEnglishEnabled"',
            'id="setMoodLateNight"',
            'id="setYoutubePlatformMode"',
            'id="setGeminiMode"',
            'data-english-cat="music"',
            'id="englishMusicStudio"',
            'id="ytPlatformBar"',
            'id="ytPlatformModeGroup"',
            'id="musicSongForm"',
            'id="musicFilterSort"',
            'id="musicCatalogContainer"',
            'id="musicWordNotesForm"',
            'id="btnMusicSearchYt"',
            'id="e2eeKeyModal"',
            'id="confirmActionModal"',
            'id="appToastContainer"',
            'id="moodTodayChecklist"',
            'id="sleepTodaySummary"',
            'id="studyLanguageSelectorBar"',
            'id="btnToggleStudyCourse"',
            'id="btnStartMicPronunciation"',
            'id="languageAiPanel"',
            'id="btnAskLangAi"',
            'id="btnMusicAiExplainLyrics"',
            'id="transportSecurityCard"',
            'id="btnTransportBenchmark"',
            'id="setGeminiModel"',
            'id="view-crisis"',
            'id="crisisForm"',
            'id="resumenCrisisList"',
            'id="resumenCalendarioDia"',
            'id="btnResumenWeekStartToggle"',
            'id="resumenVisualWeekDays"',
            'id="btnResumenWeekAllDays"',
            'id="musicEntityEditModal"',
            'id="musicAlbumCreateModal"',
            'id="btnMusicNewAlbum"',
            'id="btnMusicQuickNewAlbum"',
            'id="btnMusicStudyEditSelected"',
            'id="btnDeleteMusicEntityModal"',
            'id="quickLocationModal"',
            'id="homeLocationLabel"',
            'id="btnSaveHomeLocation"',
            'id="homeLocationVerifyLink"',
            'id="btnPingPhoneGps"',
            'id="btnClearCurrentGps"',
            'id="btnLoadPhoneWebhook"',
            'id="btnModalPingPhoneGps"',
            'id="sleepModePills"',
            'id="sleepEsDesvelo"',
            'id="sleepStillAwake"',
            'id="resumenSleepDetailsList"',
            'id="btnMusicCleanTimestamps"',
            'id="btnTestGeminiConnection"',
            'id="settingsGeminiTestResult"',
            'id="floatingTranslatorModal"',
            'id="floatingTranslatorDragHandle"',
            'floating-translator-drag-grip',
            'id="btnResetFloatTranslatorPos"',
            'id="btnFloatPopoutTranslator"',
            'id="btnSidebarOpenTranslator"',
            'id="btnMobileTranslator"',
            'id="floatTranslatorInput"',
            'translator-extension-textarea',
            'id="musicLyricsViewerCard"',
            'id="musicLyricsMetaBadge"',
            'id="musicPcBridgeBadge"',
            'id="musicLyricsAlbumPlaylistBox"',
            'id="btnMusicExtractLyrics"',
            'id="btnMusicCopyLyricsToStudy"',
            'id="btnMusicTranslateLyricsSel"',
            'id="btnMinimizeFloatingTranslator"',
            'floating-translate-sel-btn',
            'id="musicSongLyricsViewer"',
            'id="musicLyricsStatusHint"',
            'id="chkAutoSyncAiToWord"',
            'id="chkAutoSyncQuickAiToWord"'
        ]) {
            assert.ok(indexHtml.includes(requiredId), `public/index.html debe incluir ${requiredId}`);
        }
        for (const removedId of [
            'id="semanaSeleccionada"',
            'id="musicRepertoireNavigator"',
            'id="btnMusicSaveLyrics"',
            'id="btnMusicToggleYtdlpHint"',
            'id="musicYtdlpHelperBox"',
            'id="musicDockedTranslatorPane"',
            'id="musicDockedTransInput"',
            'id="btnMusicDockedTranslateRun"'
        ]) {
            assert.equal(indexHtml.includes(removedId), false, `public/index.html debe retirar el elemento obsoleto ${removedId}`);
        }
        assert.equal(
            indexHtml.includes('id="languageTranslatorPanel"'),
            false,
            'public/index.html no debe incluir panel inline de traductor en Learn with AI'
        );
        assert.equal(
            indexHtml.includes('id="translatorInput"'),
            false,
            'public/index.html no debe incluir translatorInput obsoleto'
        );
        assert.match(indexHtml, /<script[^>]+src=["']transport-crypto\.js["']/i);

        const dockerfileText = readText('Dockerfile');
        assert.ok(dockerfileText.includes('COPY lib ./lib'), 'Dockerfile debe copiar carpeta lib/');
        assert.match(dockerfileText, /python3/);
        assert.match(dockerfileText, /\brclone\b/);

        const serverJs = readText('server.js');
        assert.match(serverJs, /media-src 'self'/);

        const initSql = readText('init.sql');
        assert.doesNotMatch(initSql, /\blyrics_text\b/i);
        assert.doesNotMatch(initSql, /\blyrics_source\b/i);

        const styleCss = readText('public/style.css');
        for (const requiredClass of [
            '.view-shell',
            '.view-header-card',
            '.yt-platform-bar',
            '.app-toast-container',
            '.english-row-2',
            '.select-input',
            '.tunnel-pill',
            '.lang-ai-panel',
            '.lang-translator-panel',
            '.ai-network-fallback',
            '.music-yt-search-hint',
            '.music-filter-bar > input[type="search"]',
            '.rep-item > span:first-child',
            '.btn-mini-edit',
            '.btn-mini-add',
            '.is-editing-song',
            '.music-empty-album-cta',
            '.agenda-week-board .jira-status-select',
            '.quick-loc-presets',
            '.phone-webhook-box',
            '.sleep-desvelo-badge',
            '.sleep-mode-pill',
            '.music-embed-toolbar',
            '.music-embed-fallback-note',
            '.music-lyrics-label-actions',
            '.music-ytdlp-helper',
            '.floating-translator-drawer',
            '.translator-popup-shell',
            '.music-html5-player',
            '.music-lyrics-viewer-card',
            '.music-lyrics-textarea',
            '.music-album-tracklist-box',
            '.music-album-track-btn',
            '.ai-autosync-toggle',
            '.lang-toggle-pill',
            '.btn-lang-sidebar',
            '.vg-root',
            '.vg-standalone-shell'
        ]) {
            assert.ok(styleCss.includes(requiredClass), `public/style.css debe definir ${requiredClass}`);
        }
    });

    it('protege archivos secretos y configura Dockerfile / docker-compose.yml para Ubuntu Server (8 GB RAM + Tailscale)', () => {
        const gitignore = readText('.gitignore');
        for (const entry of ['.env', '.env.enc', '.env.*.tmp', 'english-notes/', 'data/']) {
            assert.ok(gitignore.includes(entry), `.gitignore debe excluir ${entry}`);
        }

        const dockerignore = readText('.dockerignore');
        for (const entry of ['.git', '.env', '.env.enc', 'node_modules', 'test', 'tests', 'guides', 'english-notes', 'data']) {
            assert.ok(dockerignore.includes(entry), `.dockerignore debe excluir ${entry}`);
        }

        for (const guidePath of [
            'guides/MANUAL_DE_USUARIO.md',
            'guides/GUIA_TECNICA_ARQUITECTURA.md',
            'guides/GUIA_OPERACION_Y_MIGRACION.md',
            'guides/GUIA_COMANDOS.md',
            'guides/GUIA_TECNICA.md',
            'guides/GUIA_MIGRACION.md',
            'guides/GUIA_INSTALACION_UBUNTU_SERVER_26.md'
        ]) {
            const guide = readText(guidePath);
            assert.equal(guide.includes('file:///'), false, `${guidePath} no debe contener enlaces locales file:///`);
            assert.equal(guide.includes('docs-privados'), false, `${guidePath} no debe referenciar docs-privados`);
        }

        const dockerfile = readText('Dockerfile');
        assert.match(dockerfile, /FROM node:20-alpine/);
        assert.match(dockerfile, /npm ci --omit=dev/);
        assert.match(dockerfile, /--max-old-space-size=768/);
        assert.match(dockerfile, /msoffcrypto-tool/);
        assert.match(dockerfile, /\bffmpeg\b/);
        assert.match(dockerfile, /\/usr\/local\/bin\/yt-dlp/);
        assert.match(dockerfile, /YTM_INNERTUBE=1/);

        const compose = readText('docker-compose.yml');
        assert.match(compose, /mem_limit:\s*1024m/);
        assert.match(compose, /--performance-schema=OFF/);
        assert.match(compose, /--skip-log-bin/);
        assert.match(compose, /\/app\/journal-data/);
        assert.match(compose, /\/app\/english-notes/);
        assert.match(compose, /TRUST_PROXY=\$\{TRUST_PROXY:-1\}/);
        assert.match(compose, /SERVER_AUTONOMOUS_NOTES=\$\{SERVER_AUTONOMOUS_NOTES:-true\}/);
        assert.match(compose, /YT_DLP_PATH=\$\{YT_DLP_PATH:-\}/);
        assert.ok((compose.match(/restart:\s*always/g) || []).length >= 3, 'db, app y proxy deben usar restart: always');
        assert.ok((compose.match(/healthcheck:/g) || []).length >= 3, 'db, app y proxy deben definir healthcheck');
    });

    it('mantiene sincronizadas las variables env y envs en deploy.yml sin dejar .env en disco', () => {
        const deploy = readText('.github/workflows/deploy.yml');
        const envSection = deploy.match(/uses:\s*appleboy\/ssh-action@[^\r\n]+\r?\n\s+env:\r?\n([\s\S]*?)\r?\n\s+with:/);
        assert.ok(envSection, 'No se encontró bloque env: en el paso ssh-action de deploy.yml');
        const envKeys = [...envSection[1].matchAll(/^\s+([A-Z0-9_]+):/gm)].map((m) => m[1]);

        const envsLine = deploy.match(/\benvs:\s*([^\r\n]+)/);
        assert.ok(envsLine, 'No se encontró línea envs: en deploy.yml');
        const forwardedKeys = envsLine[1].split(',').map((s) => s.trim()).filter(Boolean);

        for (const key of envKeys) {
            assert.ok(
                forwardedKeys.includes(key),
                `La variable ${key} está en env: pero falta en envs: de ssh-action`
            );
        }

        assert.match(deploy, /cleanup_deploy_env/);
        assert.match(deploy, /git remote set-url origin "https:\/\/github\.com\/\$\{GITHUB_REPO\}\.git"/);
        assert.match(deploy, /\/swapfile/);
        assert.match(deploy, /fallocate -l 2G \/swapfile/);
        assert.match(deploy, /swapon\s+\/swapfile/);
        assert.match(deploy, /vm\.swappiness=15/);
        assert.match(deploy, /vm\.vfs_cache_pressure=50/);
        assert.match(deploy, /apt-get upgrade -y/);
        assert.match(deploy, /\bffmpeg\b/);
        assert.match(deploy, /yt-dlp -U/);
        assert.ok(
            deploy.indexOf('/swapfile') < deploy.indexOf('# 1. Instalar dependencias base'),
            'El paso de activación Swap debe ejecutarse primero al entrar por SSH antes de instalar dependencias'
        );
        assert.match(deploy, /BACKUP_CRON_SCHEDULE:-30 3 \* \* \*/);
        assert.match(deploy, /SEAL_ENV_AFTER_DEPLOY:-true/);
        assert.match(deploy, /SECRET_YT_DLP_PATH/);

        const ci = readText('.github/workflows/ci.yml');
        assert.match(ci, /branches-ignore:\r?\n\s+-\s*main/);
        assert.match(ci, /pull_request:\r?\n\s+branches:\r?\n\s+-\s*main/);
        assert.match(ci, /GITHUB_STEP_SUMMARY|ci-summary\.js/);
    });
});

describe('Modo Oscuro Permanente, Motor Bilingüe EN/ES y Guía Visual Interactiva', () => {
    it('mantiene modo oscuro permanente sin botones de tema claro en HTML/JS', () => {
        const indexHtml = readText('public/index.html');
        const dashHtml = readText('public/dashboard.html');
        const popupHtml = readText('public/translator-popup.html');
        const guideHtml = readText('public/guia-visual.html');
        const themeInit = readText('public/theme-init.js');

        assert.match(indexHtml, /<html\b[^>]*lang=["']en["'][^>]*data-theme=["']dark["']/i);
        assert.match(dashHtml, /<html\b[^>]*lang=["']en["'][^>]*data-theme=["']dark["']/i);
        assert.match(popupHtml, /<html\b[^>]*data-theme=["']dark["']/i);
        assert.match(guideHtml, /<html\b[^>]*data-theme=["']dark["']/i);
        assert.match(themeInit, /data-theme.*dark|setAttribute\(['"]data-theme['"],\s*['"]dark['"]\)/);

        for (const removedId of ['id="btnThemeToggle"', 'id="btnThemeToggleMobile"', 'id="btnThemeToggleAuth"', 'id="setTheme"', 'id="btnPopupThemeToggle"']) {
            assert.equal(indexHtml.includes(removedId), false, `index.html no debe reintroducir ${removedId}`);
            assert.equal(popupHtml.includes(removedId), false, `translator-popup.html no debe reintroducir ${removedId}`);
        }

        // CSP estricto sin script inline en guia-visual.html ni translator-popup.html
        assert.equal(/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(guideHtml), false, 'guia-visual.html no debe contener <script> inline');
        assert.match(guideHtml, /<script\s+src=["']theme-init\.js["'][^>]*><\/script>/i);
        assert.match(guideHtml, /<script\s+src=["']i18n\.js["'][^>]*><\/script>/i);
        assert.match(guideHtml, /<script\s+src=["']guia-visual\.js["'][^>]*><\/script>/i);
        assert.match(guideHtml, /id=["']visualGuideStandaloneHost["']/);
    });

    it('expone controles EN/ES y Guía Visual en index.html y popup', () => {
        const indexHtml = readText('public/index.html');
        const popupHtml = readText('public/translator-popup.html');

        for (const requiredAttr of [
            'id="btnLangToggleSidebar"',
            'id="btnLangToggleMobile"',
            'id="btnLangToggleAuth"',
            'id="btnSettingsLangToggle"',
            'id="setUiLanguage"',
            'data-view="guia"',
            'id="view-guia"',
            'id="visualGuideAppHost"'
        ]) {
            assert.ok(indexHtml.includes(requiredAttr), `public/index.html debe incluir ${requiredAttr}`);
        }

        assert.ok(popupHtml.includes('id="btnPopupLangToggle"'), 'translator-popup.html debe incluir #btnPopupLangToggle');
        assert.ok(popupHtml.includes('src="i18n.js"'), 'translator-popup.html debe cargar i18n.js');
    });

    it('verifica traducciones EN <-> ES, HTML_BLOCKS y conservación de claves MySQL en public/i18n.js y public/guia-visual.js', () => {
        const i18nCode = readText('public/i18n.js');
        const guideCode = readText('public/guia-visual.js');

        const store = new Map();
        const sandboxWindow = {
            localStorage: {
                getItem: (k) => (store.has(k) ? store.get(k) : null),
                setItem: (k, v) => store.set(k, String(v)),
                removeItem: (k) => store.delete(k)
            },
            document: {
                readyState: 'complete',
                documentElement: { lang: 'en', style: {}, setAttribute: () => {}, classList: { add: () => {}, remove: () => {} } },
                body: null,
                getElementById: () => null,
                querySelectorAll: () => [],
                createTreeWalker: () => ({ nextNode: () => null }),
                addEventListener: () => {}
            },
            addEventListener: () => {}
        };
        sandboxWindow.window = sandboxWindow;
        const ctx = vm.createContext({
            window: sandboxWindow,
            document: sandboxWindow.document,
            localStorage: sandboxWindow.localStorage,
            NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
            MutationObserver: class { observe() {} },
            console
        });

        vm.runInContext(i18nCode, ctx, { filename: 'public/i18n.js' });
        vm.runInContext(guideCode, ctx, { filename: 'public/guia-visual.js' });

        const i18n = sandboxWindow.DailyHubI18n;
        const guide = sandboxWindow.DailyHubVisualGuide;
        assert.ok(i18n && typeof i18n.setLang === 'function', 'DailyHubI18n debe exportarse');
        assert.ok(guide && Array.isArray(guide.SECTIONS) && guide.SECTIONS.length >= 4, 'DailyHubVisualGuide.SECTIONS debe exportarse');
        for (const sec of guide.SECTIONS) {
            assert.ok(sec.badgeEn && sec.badgeEs, `Sección visual ${sec.id} debe incluir badgeEn y badgeEs`);
        }

        // Verificar que todo data-i18n-html usado en HTML exista en HTML_BLOCKS
        for (const htmlFile of ['public/index.html', 'public/translator-popup.html', 'public/guia-visual.html']) {
            const rawHtml = readText(htmlFile);
            for (const m of rawHtml.matchAll(/data-i18n-html=["']([^"']+)["']/g)) {
                const key = m[1];
                assert.ok(i18n.HTML_BLOCKS[key], `Falta HTML_BLOCKS["${key}"] usado en ${htmlFile}`);
                assert.ok(i18n.HTML_BLOCKS[key].en && i18n.HTML_BLOCKS[key].es, `HTML_BLOCKS["${key}"] debe tener .en y .es`);
            }
        }

        // Roundtrip ES <-> EN + preservación de claves MySQL
        i18n.setLang('es', { silent: true });
        assert.equal(i18n.getLang(), 'es');
        assert.equal(i18n.translateText('Home'), 'Inicio');
        assert.equal(i18n.momentLabel('Madrugada'), 'Madrugada');
        assert.equal(i18n.agendaStatusLabel('in_progress'), 'En progreso');
        assert.match(i18n.translateServerMessage('Synced 3 schedule item(s) to Weekly Agenda.'), /Se sincronizaron 3 actividades a tu Agenda Semanal/i);
        assert.match(i18n.translateServerMessage('Selected class was not found in your semester schedule.'), /La clase seleccionada no se encontró/i);
        assert.equal(i18n.translateText('🎓 All Classes'), '🎓 Todas las clases');

        i18n.setLang('en', { silent: true });
        assert.equal(i18n.getLang(), 'en');
        assert.equal(i18n.translateText('Inicio'), 'Home');
        assert.equal(i18n.momentLabel('Madrugada'), 'Late Night');
        assert.equal(i18n.agendaStatusLabel('in_progress'), 'In Progress');
        assert.match(i18n.translateServerMessage('Sin traducción exacta en diccionario local (Gemini HTTP 404)'), /No exact match in local dictionary \(Gemini HTTP 404\)/i);

        const indexHtml = readText('public/index.html');
        const frontendJs = readText('public/frontend.js');
        assert.ok(indexHtml.includes('id="agendaCourseFilter"'), 'index.html debe exponer filtro de clase actual en Agenda');
        assert.ok(indexHtml.includes('id="agendaMateriaId"') && indexHtml.includes('id="agendaMateriaGroup"'), 'index.html debe exponer selector de materia universitaria');
        assert.ok(frontendJs.includes('resolveAgendaItemClassLabel') && frontendJs.includes('syncAgendaMateriaFieldUI'), 'frontend.js debe vincular tareas universitarias con clases actuales');
    });

    it('adapta lib/language-studio.js al idioma uiLang (en vs es) sin envenenar languageMemory', async () => {
        const langStudio = require('../lib/language-studio');
        assert.equal(langStudio.normalizeUiLang('en-US'), 'en');
        assert.equal(langStudio.normalizeUiLang('es-MX'), 'es');
        assert.equal(langStudio.normalizeUiLang(undefined), 'es');

        const offlineEs = langStudio.translateOffline({ text: 'not_in_dict_xyz', direction: 'en_es' });
        assert.match(offlineEs.explanationEs, /Google Gemini API en Ajustes/i);
        assert.equal(langStudio.isPoisonedMemoryMeaning(offlineEs.explanationEs), true);

        const offlineEn = langStudio.translateOffline({ text: 'not_in_dict_xyz', direction: 'en_es', uiLang: 'en' });
        assert.match(offlineEn.explanationEs, /Enable Google Gemini API in Settings/i);
        assert.equal(langStudio.isPoisonedMemoryMeaning(offlineEn.explanationEs), true);

        const analyzeEn = langStudio.analyzeTextOffline({ text: '사랑해\nI hold on', language: 'en_ko', uiLang: 'en' });
        const analyzeEs = langStudio.analyzeTextOffline({ text: '사랑해\nI hold on', language: 'en_ko', uiLang: 'es' });
        assert.match(analyzeEn.summary, /Instant Local Analysis/i);
        assert.match(analyzeEs.summary, /Análisis Local Instantáneo/i);
    });
});

describe('Versionado Automático SemVer 2.0.0 e Historial de Despliegues', () => {
    it('calcula incrementos MAJOR/MINOR/PATCH con Conventional Commits y actualiza artefactos de versión', () => {
        const relMod = require('../scripts/release-version');

        assert.deepEqual(relMod.parseSemver('v1.2.3'), { major: 1, minor: 2, patch: 3 });
        assert.equal(relMod.bumpSemver('1.0.0', 'patch'), '1.0.1');
        assert.equal(relMod.bumpSemver('1.0.1', 'minor'), '1.1.0');
        assert.equal(relMod.bumpSemver('1.1.0', 'major'), '2.0.0');

        assert.equal(relMod.classifyCommit({ sha: 'a1', subject: 'fix: resolve agenda pill crash' }).kind, 'fix');
        assert.equal(relMod.classifyCommit({ sha: 'a2', subject: 'feat(ui): add version history modal' }).kind, 'feature');
        assert.equal(relMod.classifyCommit({ sha: 'a3', subject: 'feat!: redesign auth schema' }).kind, 'breaking');
        assert.equal(relMod.classifyCommit({ sha: 'a4', subject: 'chore: docs', body: 'BREAKING CHANGE: drop legacy v0' }).kind, 'breaking');
        assert.equal(relMod.analyzeCommits([{ sha: 'a1', subject: 'fix: resolve agenda pill crash' }]).bumpType, 'patch');
        assert.equal(relMod.analyzeCommits([{ sha: 'a2', subject: 'feat(ui): add version history modal' }]).bumpType, 'minor');
        assert.equal(relMod.analyzeCommits([{ sha: 'a3', subject: 'feat!: redesign auth schema' }]).bumpType, 'major');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdh-semver-'));
        try {
            fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'tmp-hub', version: '1.0.0' }, null, 2));
            fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), JSON.stringify({ name: 'tmp-hub', version: '1.0.0', lockfileVersion: 3, packages: { '': { version: '1.0.0' } } }, null, 2));

            const r1 = relMod.runRelease({
                cwd: tmpDir,
                apply: true,
                headShaOverride: 'abc1234',
                releasedAt: '2026-11-15T10:00:00.000Z',
                commitsOverride: [{ sha: 'abc1234', subject: 'fix(audio): repair range header check', body: '' }]
            });
            assert.equal(r1.nextVersion, '1.0.1');
            assert.equal(r1.bumpType, 'patch');

            const r2 = relMod.runRelease({
                cwd: tmpDir,
                apply: true,
                headShaOverride: 'def5678',
                releasedAt: '2026-11-15T11:00:00.000Z',
                commitsOverride: [
                    { sha: 'def5677', subject: 'fix: typo in tooltip', body: '' },
                    { sha: 'def5678', subject: 'feat: link tasks to semester classes', body: '' }
                ]
            });
            assert.equal(r2.nextVersion, '1.1.0');
            assert.equal(r2.bumpType, 'minor');

            const pkgAfter = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));
            const lockAfter = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package-lock.json'), 'utf8'));
            const historyAfter = JSON.parse(fs.readFileSync(path.join(tmpDir, 'version-history.json'), 'utf8'));
            const changelogAfter = fs.readFileSync(path.join(tmpDir, 'CHANGELOG.md'), 'utf8');

            assert.equal(pkgAfter.version, '1.1.0');
            assert.equal(lockAfter.version, '1.1.0');
            assert.equal(lockAfter.packages[''].version, '1.1.0');
            assert.equal(historyAfter.currentVersion, '1.1.0');
            assert.equal(historyAfter.releases.length, 2);
            assert.equal(historyAfter.releases[0].tag, 'v1.1.0');
            assert.equal(historyAfter.releases[1].tag, 'v1.0.1');
            assert.match(changelogAfter, /## \[v1\.1\.0\]/);
            assert.match(changelogAfter, /## \[v1\.0\.1\]/);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('integra auto-versionado en deploy.yml, Dockerfile y UI modal de Version History', () => {
        const deploy = readText('.github/workflows/deploy.yml');
        const dockerfile = readText('Dockerfile');
        const historyJson = JSON.parse(readText('version-history.json'));
        const changelog = readText('CHANGELOG.md');
        const indexHtml = readText('public/index.html');
        const styleCss = readText('public/style.css');
        const frontendJs = readText('public/frontend.js');

        assert.match(deploy, /scripts\/release-version\.js\s+--apply\s+--github-output/);
        assert.match(deploy, /permissions:\r?\n\s+contents:\s*write/);
        assert.match(deploy, /needs:\s*release/);
        assert.match(deploy, /APP_VERSION/);
        assert.match(deploy, /RELEASE_HISTORY_B64/);
        assert.match(dockerfile, /version-history\.json/);
        assert.match(dockerfile, /CHANGELOG\.md/);
        assert.match(String(historyJson.standard), /SemVer 2\.0\.0/);
        assert.ok(Array.isArray(historyJson.releases) && historyJson.releases.length >= 1);
        assert.match(changelog, /^# Historial de Versiones/m);

        for (const id of ['id="btnOpenVersionHistory"', 'id="sidebarVersionText"', 'id="btnSettingsVersionHistory"', 'id="versionHistoryModal"', 'id="versionHistoryBody"']) {
            assert.ok(indexHtml.includes(id), `public/index.html debe incluir ${id}`);
        }
        assert.ok(styleCss.includes('.ver-badge') && styleCss.includes('.version-history-list'));
        assert.ok(frontendJs.includes('cargarVersionInfo') && frontendJs.includes('initVersionHistoryHandlers'));
    });

    it('verifica integridad lógica de DOM IDs en frontend.js y ausencia de llaves duplicadas en public/i18n.js', () => {
        const indexHtml = readText('public/index.html');
        const frontendJs = readText('public/frontend.js');
        assert.ok(indexHtml.includes('id="englishForm"'));
        assert.ok(!frontendJs.includes('englishPracticeForm'), 'frontend.js no debe referenciar #englishPracticeForm inexistente');
        assert.ok(frontendJs.includes("getElementById('englishForm')?.scrollIntoView"));

        const i18nSrc = readText('public/i18n.js');
        const m = i18nSrc.match(/(?:const|var|let)\s+PAIRS\s*=\s*(\[[\s\S]*?\r?\n\s*\]);/);
        assert.ok(m, 'No se pudo localizar PAIRS en public/i18n.js');
        const pairs = vm.runInNewContext(`(${m[1]})`, Object.create(null));
        const seen = new Map();
        const duplicates = [];
        for (const [en] of pairs) {
            seen.set(en, (seen.get(en) || 0) + 1);
            if (seen.get(en) === 2) duplicates.push(en);
        }
        assert.deepEqual(duplicates, [], `Llaves EN duplicadas en public/i18n.js: ${duplicates.join(', ')}`);
    });
});

describe('Arquitectura Fases 1-5: Plug-and-Play Cloud, Caddy HTTPS, Dual Drive, Campus y Word Bloque A/B', () => {
    it('elimina credenciales, rutas locales y repositorios hardcodeados (Cloud Agnostic)', () => {
        for (const file of ['.env.example', 'docker-compose.yml', '.github/workflows/deploy.yml', 'server.js']) {
            const text = readText(file);
            assert.equal(/flavio\.flax1234@gmail\.com/i.test(text), false, `${file} no debe hardcodear correo personal`);
            assert.equal(/C:\\\\Users\\\\flavi|C:\\Users\\flavi/i.test(text), false, `${file} no debe hardcodear rutas locales Windows de usuario`);
        }
        for (const absPath of [SYNC_PY_PATH, YT_HELPER_PY_PATH]) {
            assert.ok(fs.existsSync(absPath), `No se encontró ${absPath} (ruta resuelta desde la raíz del proyecto)`);
            const text = fs.readFileSync(absPath, 'utf8');
            const rel = path.relative(ROOT, absPath);
            assert.equal(/flavio\.flax1234@gmail\.com/i.test(text), false, `${rel} no debe hardcodear correo personal`);
            assert.equal(/C:\\\\Users\\\\flavi|C:\\Users\\flavi/i.test(text), false, `${rel} no debe hardcodear rutas locales Windows de usuario`);
        }

        const caddyfile = readText('Caddyfile');
        assert.match(caddyfile, /reverse_proxy\s+app:/);
        assert.match(caddyfile, /tls internal/);

        const compose = readText('docker-compose.yml');
        assert.match(compose, /caddy:2-alpine/);
        assert.match(compose, /STUDY_RCLONE_REMOTE/);
        assert.match(compose, /STUDY_RCLONE_CONF_B64/);
    });

    it('verifica coordenadas oficiales TecNM Saltillo, responsividad OPPO A79, Dual Drive y Guías nuevas', () => {
        const indexHtml = readText('public/index.html');
        const styleCss = readText('public/style.css');
        const frontendJs = readText('public/frontend.js');
        const serverJs = readText('server.js');

        assert.match(serverJs, /25\.4414/);
        assert.match(serverJs, /-100\.9922/);
        assert.match(serverJs, /25\.4385/);
        assert.match(serverJs, /-100\.994/);
        assert.match(serverJs, /25\.4194/);
        assert.match(serverJs, /-101\.0232/);

        assert.match(styleCss, /position:\s*fixed/);
        assert.match(styleCss, /orientation:\s*landscape/);
        assert.match(styleCss, /mobile-landscape-song-study/);

        assert.equal(indexHtml.includes('id="semanaSeleccionada"'), false);
        assert.equal(indexHtml.includes('id="btnLoadDriveMonthsRam"'), false, 'La UI no debe exponer botones manuales de Google Drive al usuario');
        assert.equal(indexHtml.includes('id="resumenDriveMonthsSelect"'), false, 'La UI no debe exponer selector manual de Drive al usuario');
        assert.equal(indexHtml.includes('id="setDriveStudySyncEnabled"'), false, 'La sincronización Drive debe ser automática, no configurable en UI');
        assert.equal(indexHtml.includes('id="setDriveStudyDir"'), false, 'La carpeta Drive no debe quedar expuesta en Configuración UI');
        assert.equal(frontendJs.includes('/lyrics/extract'), false, 'frontend no debe depender del endpoint antiguo de extracción bloqueada');
        assert.ok(frontendJs.includes('/resolve-lyrics'), 'frontend debe usar /resolve-lyrics autónomo en la nube');
        assert.equal(frontendJs.includes('/media'), false, 'frontend debe usar embeds oficiales y nunca descargar audio/video al servidor');
        assert.ok(frontendJs.includes('play_on_pc') && frontendJs.includes('onError'));

        const backupSh = readText('scripts/backup.sh');
        assert.match(backupSh, /ARCHIVE_READY/, 'backup.sh debe verificar respaldo histórico antes de purgar registros > 30 días');
        assert.match(backupSh, /historico_sql\/respaldo_/, 'backup.sh debe conservar instantáneas mensuales SQL completas en Drive');
        assert.match(serverJs, /buildSafeRcloneExecEnv/, 'server.js debe limpiar variables RCLONE_* al invocar rclone CLI');

        const cmdGuide = readText('guides/GUIA_COMANDOS.md');
        const techGuide = readText('guides/GUIA_TECNICA.md');
        const migGuide = readText('guides/GUIA_MIGRACION.md');
        assert.match(cmdGuide, /\| Parámetro/);
        assert.match(techGuide, /Gratuito/i);
        assert.match(techGuide, /Pago/i);
        assert.match(migGuide, /Google Cloud Platform|GCP/i);

        assert.ok(indexHtml.includes('id="studyViewerSongFilter"'));
        assert.ok(indexHtml.includes('id="studyViewerLangFilter"'));
        assert.ok(indexHtml.includes('id="btnOpenStudyViewerFromMusic"'));

        const langStudio = require(path.join(ROOT, 'lib', 'language-studio.js'));
        assert.equal(typeof langStudio.parseStudyNotebookDocxBuffer, 'function');
        assert.equal(typeof langStudio.filterStudyNotebookData, 'function');
        assert.equal(typeof langStudio.findNotebookTranslationMatch, 'function');
        assert.equal(langStudio.parseStudyNotebookDocxBuffer(Buffer.from('PK\x03\x04invalid')).ok, false);
        const synMatch = langStudio.findNotebookTranslationMatch({
            allEntries: [{
                section: 'music',
                title: 'Test Track',
                artist: 'Test Artist',
                fields: {
                    lyrics_study: '[EN]\nHello world line one\n=== [ES — Traducción IA] ===\nHola mundo línea uno'
                }
            }]
        }, { songTitle: 'Test Track', artistName: 'Test Artist', mode: 'lyrics' });
        assert.equal(synMatch?.hit, true);
        assert.match(synMatch?.spanishLyrics || '', /Hola mundo línea uno/);

        assert.equal(typeof langStudio.findNotebookSongEntry, 'function');
        const songNbMatch = langStudio.findNotebookSongEntry({
            allEntries: [{
                section: 'music',
                title: 'Track Without ES',
                artist: 'Test Artist',
                album: 'Test Album',
                trackNumber: 4,
                fields: {
                    lyrics_study: 'Line one\nLine two',
                    vocabulary_list: 'fade: desvanecerse'
                }
            }]
        }, { songTitle: 'Track Without ES', artistName: 'Test Artist', albumTitle: 'Test Album' });
        assert.equal(songNbMatch?.lyrics, 'Line one\nLine two');
        assert.equal(songNbMatch?.trackNumber, 4);
        assert.equal(songNbMatch?.fields?.vocabulary_list, 'fade: desvanecerse');

        // Regresión Fase Japonés (JP / JP-EN), Romaji y Guía de Comandos en 1ª página
        assert.match(cmdGuide.slice(0, 3200), /Stop-Process[\s\S]*sincronizador\.py/);
        assert.match(cmdGuide.slice(0, 4200), /--configurar-autoinicio/);
        assert.ok(indexHtml.includes('data-study-lang="ja"') && indexHtml.includes('data-study-lang="en_ja"'));
        assert.equal(langStudio.normalizeStudyLanguage('jp-en'), 'en_ja');
        assert.equal(langStudio.normalizeStudyLanguage('日本語'), 'ja');
        assert.equal(langStudio.detectScriptKind('夢を見る midnight'), 'mixed-jpop');
        assert.equal(langStudio.detectScriptKind('ずっとありがとう'), 'japanese');
        assert.equal(langStudio.kanaToRomaji('ずっとありがとう'), 'zuttoarigatou');
        const romWithKanji = langStudio.kanaToRomaji('愛してる shining star');
        assert.match(romWithKanji, /aishiteru/i);
        assert.match(romWithKanji, /shining star/);
        const jaOff = langStudio.translateOffline({ text: 'ありがとう', direction: 'auto', uiLang: 'es' });
        assert.equal(jaOff.direction, 'ja_es');
        assert.match(jaOff.translatedText, /Gracias/i);
        const jpEnAnalysis = langStudio.analyzeTextOffline({ text: 'Shining star\n夢を見る', language: 'en_ja', uiLang: 'es' });
        assert.equal(jpEnAnalysis.language, 'en_ja');
        assert.ok(jpEnAnalysis.lines.some((l) => l.script === 'japanese' && /yume/i.test(l.romanization)));

        // Regresión UX Modo Estudio: Traductor flotante movible/minimizable, botón Traducir Selección contextual, OPPO A79 y filtro por idioma
        assert.ok(styleCss.includes('.floating-translate-sel-btn'), 'style.css debe definir .floating-translate-sel-btn');
        assert.ok(styleCss.includes('.floating-translator-drawer.is-minimized'), 'style.css debe definir .floating-translator-drawer.is-minimized');
        assert.match(styleCss, /min\(92vw,\s*360px\)/, 'style.css debe definir ancho responsivo OPPO A79 vertical min(92vw, 360px)');
        assert.match(styleCss, /70dvh/, 'style.css debe limitar altura en móvil vertical a 70dvh');
        assert.match(styleCss, /calc\(100dvh\s*-\s*24px\)/, 'style.css debe limitar altura en paisaje a calc(100dvh - 24px)');
        assert.match(styleCss, /touch-action:\s*none/, 'style.css debe incluir touch-action: none para arrastre táctil fluido');
        assert.ok(frontendJs.includes('orientationchange'), 'frontend.js debe recalcular coordenadas flotantes en orientationchange');
        assert.ok(frontendJs.includes('selectionchange'), 'frontend.js debe escuchar selectionchange para mostrar Traducir Selección');
        assert.ok(frontendJs.includes('extractLyricsForActiveLanguage'), 'frontend.js debe filtrar estrofas por el idioma seleccionado');

        // Verificación funcional en VM de parseAndDivideLyricsByLanguage + extractLyricsForActiveLanguage
        const vm = require('node:vm');
        const extractFnBlock = (name, nextFnName) => {
            const start = frontendJs.indexOf(`function ${name}(`);
            assert.ok(start >= 0, `Debe existir function ${name} en frontend.js`);
            const end = frontendJs.indexOf(`function ${nextFnName}(`, start);
            assert.ok(end > start, `Debe existir límite ${nextFnName} tras ${name}`);
            return frontendJs.slice(start, end);
        };
        const sandbox = {};
        vm.runInNewContext([
            extractFnBlock('_isolateHangulLinesClient', 'renderLyricsSectionsIntoContainer'),
            extractFnBlock('_isStructuralLyricTagClient', 'renderReadonlyLyricsByLanguage')
        ].join('\n'), sandbox);

        const multiLangSample = [
            '=== [ORIGINAL] ===',
            '사랑해 forever',
            '[saranghae forever]',
            'Shining night together',
            '=== [KO] ===',
            '사랑해',
            '[saranghae]',
            '영원히 함께해',
            '=== [EN] ===',
            'Shining night together',
            'Forever by my side',
            '=== [ES — Traducción IA] ===',
            'Te amo por siempre',
            'Noche brillante juntos'
        ].join('\n');

        const koFiltered = sandbox.extractLyricsForActiveLanguage(multiLangSample, 'ko');
        assert.equal(koFiltered.langCode, 'ko');
        assert.ok(koFiltered.text.includes('사랑해') && koFiltered.text.includes('영원히 함께해'));
        assert.equal(/saranghae|Shining night|Te amo/i.test(koFiltered.text), false, 'El filtro Coreano no debe incluir inglés, español ni romanización');

        const enFiltered = sandbox.extractLyricsForActiveLanguage(multiLangSample, 'en');
        assert.equal(enFiltered.langCode, 'en');
        assert.ok(enFiltered.text.includes('Shining night together') && enFiltered.text.includes('Forever by my side'));
        assert.equal(/사랑해|Te amo/i.test(enFiltered.text), false, 'El filtro Inglés no debe incluir coreano ni español');

        const origFiltered = sandbox.extractLyricsForActiveLanguage(multiLangSample, 'original');
        assert.equal(origFiltered.langCode, 'original');
        assert.ok(origFiltered.text.includes('사랑해 forever') && origFiltered.text.includes('Shining night together'));
        assert.equal(/Te amo por siempre/.test(origFiltered.text), false, 'El filtro Original no debe incluir el bloque de traducción al español');

        // K-Pop mixto sin etiqueta [EN] explícita ni etiquetas [ORIGINAL] visibles; y coreano puro sin pestaña Original redundante
        const dividedMixed = Array.from(sandbox.parseAndDivideLyricsByLanguage(
            '[ORIGINAL]\n끝없는 가치\nWhen I dress I don\'t think so much\n\n[KO]\n끝없는 가치\n\n[EN]\nWhen I dress I don\'t think so much'
        ));
        assert.deepEqual(dividedMixed.map(s => s.code), ['original', 'ko', 'en']);
        assert.equal(dividedMixed[0].lines.some(l => /^\[(?:ORIGINAL|EN|KO)\]$/i.test(l)), false, 'No deben quedar cabeceras [ORIGINAL]/[EN] en el cuerpo');

        const dividedPureKo = Array.from(sandbox.parseAndDivideLyricsByLanguage('', { original: '사랑해\n영원히', ko: '사랑해\n영원히', en: '', ja: '', es: '' }));
        assert.deepEqual(dividedPureKo.map(s => s.code), ['ko'], 'Canción en coreano puro debe renderizarse únicamente en Coreano puro');

        // Regresión Planificador Semanal V2: orden Título/Descripción arriba, Posponer, Skip, Repeticiones y Calendarios
        for (const reqAgendaSel of [
            'id="btnToggleAgendaCalendar"',
            'id="agendaCalendarDropdown"',
            'id="agendaModalQuickDateBar"',
            'id="agendaModalCalendarBox"',
            'id="agendaRepeatMode"',
            'id="agendaRepeatSummaryPreview"',
            'id="agendaPostponePopover"',
            'value="skipped"'
        ]) {
            assert.ok(indexHtml.includes(reqAgendaSel), `public/index.html debe incluir ${reqAgendaSel}`);
        }
        const modalStartIdx = indexHtml.indexOf('id="agendaModal"');
        const actPos = indexHtml.indexOf('id="agendaActividad"', modalStartIdx);
        const descPos = indexHtml.indexOf('id="agendaDescripcion"', modalStartIdx);
        const datePos = indexHtml.indexOf('id="agendaFecha"', modalStartIdx);
        const repModePos = indexHtml.indexOf('id="agendaRepeatMode"', modalStartIdx);
        assert.ok(actPos > modalStartIdx && descPos > actPos && datePos > descPos && repModePos > datePos,
            'En #agendaModal, Título y Descripción deben aparecer antes que Fecha y Repeticiones');

        for (const cssCls of ['.agenda-item.is-skipped', '.agenda-calendar-popover', '.agenda-postpone-popover', '.agenda-repeat-section']) {
            assert.ok(styleCss.includes(cssCls), `public/style.css debe definir ${cssCls}`);
        }
        assert.ok(frontendJs.includes('posponerAgendaItem') && frontendJs.includes('openAgendaPostponePopover'));

        const agendaSandbox = {};
        vm.runInNewContext(extractFnBlock('shiftYmdDateClient', 'toggleAgendaItem'), agendaSandbox);
        assert.deepEqual(
            Array.from(agendaSandbox.computeAgendaRepeatDates({
                startDate: '2026-11-18',
                mode: 'interval',
                intervalDays: 2,
                endMode: 'count',
                countExtra: 3
            })),
            ['2026-11-18', '2026-11-20', '2026-11-22', '2026-11-24']
        );
        assert.deepEqual(
            Array.from(agendaSandbox.computeAgendaRepeatDates({
                startDate: '2026-11-16',
                mode: 'weekdays',
                weekdays: [1, 3, 5],
                endMode: 'until',
                untilDate: '2026-11-23'
            })),
            ['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-23']
        );
        assert.equal(agendaSandbox.buildMonthCalendarMatrix(2026, 10).length >= 35, true);
    });
});

describe('Traductor Global por Selección e Integridad Bilingüe EN/ES', () => {
    it('elimina el pill flotante fijo (#btnFloatingTranslatorFab), habilita selección global y soporta japonés en popup', () => {
        const indexHtml = readText('public/index.html');
        const styleCss = readText('public/style.css');
        const frontendJs = readText('public/frontend.js');
        const popupHtml = readText('public/translator-popup.html');

        assert.equal(indexHtml.includes('id="btnFloatingTranslatorFab"'), false, 'public/index.html no debe renderizar #btnFloatingTranslatorFab');
        assert.equal(/\.translator-fab\b/.test(styleCss), false, 'public/style.css no debe definir .translator-fab');
        assert.equal(frontendJs.includes('btnFloatingTranslatorFab'), false, 'public/frontend.js no debe referenciar btnFloatingTranslatorFab');

        assert.ok(frontendJs.includes('function initGlobalSelectionTranslator('), 'frontend.js debe definir initGlobalSelectionTranslator');
        assert.ok(frontendJs.includes("document.addEventListener('selectionchange'"), 'frontend.js debe escuchar selectionchange globalmente');
        assert.ok(
            frontendJs.includes("activeEl.tagName === 'TEXTAREA'") &&
            frontendJs.includes('#floatingTranslatorModal, #btnMusicTranslateLyricsSel, #authOverlay, #singleTabGuardModal'),
            'initGlobalSelectionTranslator debe soportar selección global y textarea/input excluyendo auth/traductor'
        );

        for (const jaDir of ['data-dir="ja_es"', 'data-dir="ja_en"', 'data-dir="en_ja"', 'data-dir="es_ja"']) {
            assert.ok(popupHtml.includes(jaDir), `public/translator-popup.html debe incluir opción de dirección ${jaDir}`);
        }
    });

    it('garantiza traducciones bidireccionales EN <-> ES consistentes en public/i18n.js sin llaves ES autorreferenciales', () => {
        const i18nSrc = readText('public/i18n.js');
        const mockDoc = {
            readyState: 'loading',
            title: '',
            documentElement: { lang: 'es', style: {}, setAttribute() {}, querySelector() { return null; } },
            getElementById() { return null; },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            addEventListener() {},
            dispatchEvent() {}
        };
        const sandbox = {
            window: {},
            document: mockDoc,
            localStorage: { getItem: () => 'en', setItem() {} },
            CustomEvent: function CustomEvent(name, opts) { this.type = name; this.detail = opts && opts.detail; },
            NodeFilter: { SHOW_TEXT: 4 },
            dispatchEvent() {}
        };
        sandbox.window = sandbox;
        vm.runInNewContext(i18nSrc, sandbox);
        const i18n = sandbox.DailyHubI18n;
        assert.ok(i18n && typeof i18n.translateText === 'function', 'DailyHubI18n debe exponerse en sandbox');

        i18n.setLang('en');
        assert.equal(i18n.translateText('📄 Extraer letra'), '📄 Extract lyrics');
        assert.equal(i18n.translateText('🌐 Traducir selección'), '🌐 Translate selection');
        assert.equal(i18n.translateText('Por hacer'), 'To Do');
        assert.equal(i18n.translateText('🏢 Residencias Profesionales'), '🏢 Professional Internships');
        assert.equal(i18n.translateText('0 / 250 máx.'), '0 / 250 max');
        assert.equal(i18n.translateText('Página 2'), 'Page 2');
        assert.equal(i18n.translateText('12 líneas · Solo lectura'), '12 lines · Read-only');
        assert.equal(i18n.translateText('🎵 Original (Mezcla Nativa)'), '🎵 Original (Native Mix)');
        assert.equal(i18n.translateText('🌐 Switch to Español'), '🌐 Switch to Español');

        i18n.setLang('es');
        assert.equal(i18n.translateText('📄 Extract lyrics'), '📄 Extraer letra');
        assert.equal(i18n.translateText('🌐 Translate selection'), '🌐 Traducir selección');
        assert.equal(i18n.translateText('To Do'), 'Por hacer');
        assert.equal(i18n.translateText('🏢 Professional Internships'), '🏢 Residencias Profesionales');
        assert.equal(i18n.translateText('0 / 250 max'), '0 / 250 máx.');
        assert.equal(i18n.translateText('Page 2'), 'Página 2');
        assert.equal(i18n.translateText('12 lines · Read-only'), '12 líneas · Solo lectura');
        assert.equal(i18n.translateText('🎵 Original (Native Mix)'), '🎵 Original (Mezcla Nativa)');
        assert.equal(i18n.translateText('🌐 Switch to Español'), '🌐 Cambiar a Inglés');

        // Verificar que ninguna pareja no-idéntica en PAIRS quede atrapada en español al traducir a EN
        const pairsMatch = i18nSrc.match(/var\s+PAIRS\s*=\s*(\[[\s\S]*?\n\s*\]);/);
        assert.ok(pairsMatch, 'public/i18n.js debe declarar var PAIRS = [...]');
        const pairs = vm.runInNewContext(pairsMatch[1], {});
        const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        i18n.setLang('en');
        const trappedEs = [];
        for (const [enText, esText] of pairs) {
            if (norm(enText) !== norm(esText)) {
                const backToEn = i18n.translateText(esText);
                if (norm(backToEn) === norm(esText)) {
                    trappedEs.push({ enText, esText, backToEn });
                }
            }
        }
        assert.deepEqual(trappedEs, [], `Entradas de PAIRS que no regresan a inglés: ${JSON.stringify(trappedEs.slice(0, 5))}`);
    });
});
