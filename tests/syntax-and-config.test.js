const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function readText(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('Sintaxis de código (JS, HTML, CSS, Python, Bash)', () => {
    it('valida sintaxis de server.js, módulos lib/, scripts públicos y tests/ci-summary.js con node --check', () => {
        for (const rel of [
            'server.js',
            'lib/transport-crypto.js',
            'lib/language-studio.js',
            'lib/youtube-metadata.js',
            'public/theme-init.js',
            'public/transport-crypto.js',
            'public/translator-widget.js',
            'public/translator-popup.js',
            'public/frontend.js',
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

    it('valida sintaxis Python de sincronitation/sincronizador.py y yt_lyrics_helper.py cuando están presentes en disco', () => {
        const pyFiles = [
            path.join(ROOT, 'sincronitation', 'sincronizador.py'),
            path.join(ROOT, 'sincronitation', 'yt_lyrics_helper.py')
        ];
        const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
        for (const pyPath of pyFiles) {
            if (!fs.existsSync(pyPath)) continue;
            const pyCode = fs.readFileSync(pyPath, 'utf8');
            if (pyPath.endsWith('sincronizador.py')) {
                assert.match(pyCode, /EC2_HOST/);
                assert.match(pyCode, /JOURNAL_SECRET_KEY/);
            }
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
        assert.match(sql, /estado\s+ENUM\('todo',\s*'in_progress',\s*'done'\)/);
        assert.match(sql, /tipo_lanzamiento\s+ENUM\('album',\s*'mini_album',\s*'ep',\s*'single',\s*'ost',\s*'collab_single'\)/);
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
            'guides/GUIA_OPERACION_Y_MIGRACION.md'
        ]) {
            const top = readText(docPath).slice(0, 1200);
            assert.match(top, /## .*[ÍI]ndice/i, `${docPath} debe incluir un índice al inicio`);
        }

        const indexHtml = readText('public/index.html');
        for (const requiredId of [
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
            'data-english-cat="music"',
            'id="englishMusicStudio"',
            'id="ytPlatformBar"',
            'id="ytPlatformModeGroup"',
            'id="musicSongForm"',
            'id="musicCatalogContainer"',
            'id="musicWordNotesForm"',
            'id="btnMusicSearchYt"',
            'id="e2eeKeyModal"',
            'id="confirmActionModal"',
            'id="appToastContainer"',
            'id="moodTodayChecklist"',
            'id="sleepTodaySummary"',
            'id="studyLanguageSelectorBar"',
            'id="languageAiPanel"',
            'id="btnAskLangAi"',
            'id="btnMusicAiExplainLyrics"',
            'id="transportSecurityCard"',
            'id="btnTransportBenchmark"',
            'id="setGeminiModel"',
            'id="view-crisis"',
            'id="crisisForm"',
            'id="resumenCrisisList"',
            'id="musicRepertoireNavigator"',
            'id="musicEntityEditModal"',
            'id="musicAlbumCreateModal"',
            'id="btnMusicNewAlbum"',
            'id="btnMusicQuickNewAlbum"',
            'id="btnMusicStudyEditSelected"',
            'id="btnDeleteMusicEntityModal"',
            'id="languageTranslatorPanel"',
            'id="translatorInput"',
            'id="btnRunTranslator"',
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
            'id="btnMusicImportLyricsFile"',
            'id="musicLyricsFileInput"',
            'id="btnMusicCleanTimestamps"',
            'id="btnMusicToggleYtdlpHint"',
            'id="musicYtdlpHelperBox"',
            'id="btnTestGeminiConnection"',
            'id="settingsGeminiTestResult"',
            'id="btnFloatingTranslatorFab"',
            'id="floatingTranslatorModal"',
            'id="btnFloatPopoutTranslator"',
            'id="btnSidebarOpenTranslator"',
            'id="btnMobileTranslator"',
            'id="btnPopoutTranslator"',
            'id="floatTranslatorInput"'
        ]) {
            assert.ok(indexHtml.includes(requiredId), `public/index.html debe incluir ${requiredId}`);
        }
        assert.match(indexHtml, /<script[^>]+src=["']transport-crypto\.js["']/i);

        const dockerfileText = readText('Dockerfile');
        assert.ok(dockerfileText.includes('COPY lib ./lib'), 'Dockerfile debe copiar carpeta lib/');

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
            '.translator-fab',
            '.floating-translator-drawer',
            '.translator-popup-shell'
        ]) {
            assert.ok(styleCss.includes(requiredClass), `public/style.css debe definir ${requiredClass}`);
        }
    });

    it('protege archivos secretos y optimiza Dockerfile / docker-compose.yml para t3.micro', () => {
        const gitignore = readText('.gitignore');
        for (const entry of ['.env', '.env.enc', '.env.*.tmp', 'english-notes/']) {
            assert.ok(gitignore.includes(entry), `.gitignore debe excluir ${entry}`);
        }

        const dockerignore = readText('.dockerignore');
        for (const entry of ['.git', '.env', '.env.enc', 'node_modules', 'test', 'tests', 'guides', 'english-notes']) {
            assert.ok(dockerignore.includes(entry), `.dockerignore debe excluir ${entry}`);
        }

        for (const guidePath of ['guides/MANUAL_DE_USUARIO.md', 'guides/GUIA_TECNICA_ARQUITECTURA.md', 'guides/GUIA_OPERACION_Y_MIGRACION.md']) {
            const guide = readText(guidePath);
            assert.equal(guide.includes('file:///'), false, `${guidePath} no debe contener enlaces locales file:///`);
            assert.equal(guide.includes('docs-privados'), false, `${guidePath} no debe referenciar docs-privados`);
        }

        const dockerfile = readText('Dockerfile');
        assert.match(dockerfile, /FROM node:20-alpine/);
        assert.match(dockerfile, /npm ci --omit=dev/);
        assert.match(dockerfile, /--max-old-space-size=128/);

        const compose = readText('docker-compose.yml');
        assert.match(compose, /mem_limit:\s*512m/);
        assert.match(compose, /mem_limit:\s*220m/);
        assert.match(compose, /--performance-schema=OFF/);
        assert.match(compose, /--skip-log-bin/);
    });

    it('mantiene sincronizadas las variables env y envs en deploy.yml sin dejar .env en disco', () => {
        const deploy = readText('.github/workflows/deploy.yml');
        const envSection = deploy.match(/\benv:\r?\n([\s\S]*?)\r?\n\s+with:/);
        assert.ok(envSection, 'No se encontró bloque env: en deploy.yml');
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
        assert.match(deploy, /swapon\s+\/swapfile/);
        assert.ok(
            deploy.indexOf('/swapfile') < deploy.indexOf('# 1. Instalar dependencias base'),
            'El paso de activación Swap debe ejecutarse primero al entrar por SSH antes de instalar dependencias'
        );
        assert.match(deploy, /BACKUP_CRON_SCHEDULE:-30 3 \* \* \*/);
        assert.match(deploy, /SEAL_ENV_AFTER_DEPLOY:-true/);

        const ci = readText('.github/workflows/ci.yml');
        assert.match(ci, /branches-ignore:\r?\n\s+-\s*main/);
        assert.match(ci, /pull_request:\r?\n\s+branches:\r?\n\s+-\s*main/);
        assert.match(ci, /GITHUB_STEP_SUMMARY|ci-summary\.js/);
    });
});
