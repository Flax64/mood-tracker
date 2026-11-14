const fs = require('node:fs');

function stripAnsi(str) {
    return String(str).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function outcomeBadge(outcome) {
    if (outcome === 'success') return '✅ Pasó';
    if (outcome === 'failure') return '❌ Falló';
    if (outcome === 'skipped') return '⏭️ Omitido';
    if (outcome === 'cancelled') return '🚫 Cancelado';
    return outcome || 'N/A';
}

function escapeMd(text) {
    return String(text).replace(/\|/g, '\\|');
}

function parseSpecOutput(raw) {
    const clean = stripAnsi(raw).replace(/\r\n/g, '\n');
    const lines = clean.split('\n');

    const suites = new Set();
    const cases = [];
    const counters = {
        tests: 0,
        suites: 0,
        pass: 0,
        fail: 0,
        skipped: 0,
        cancelled: 0,
        durationMs: null
    };

    let currentSuite = 'General';
    let inFailureDetails = false;
    const failureLines = [];

    for (const line of lines) {
        const trimmed = line.trim();

        if (/^✖ failing tests:/i.test(trimmed)) {
            inFailureDetails = true;
            continue;
        }
        if (inFailureDetails) {
            failureLines.push(line);
            continue;
        }

        const suiteStart = line.match(/^▶\s+(.+)$/);
        if (suiteStart) {
            currentSuite = suiteStart[1].trim();
            suites.add(currentSuite);
            continue;
        }

        const topOutcome = line.match(/^[✔✖]\s+(.+?)\s+\([\d.]+m?s\)$/);
        if (topOutcome && suites.has(topOutcome[1].trim())) {
            continue;
        }

        const caseMatch = line.match(/^\s{2,}([✔✖])\s+(.+?)\s+\(([\d.]+m?s)\)$/);
        if (caseMatch) {
            cases.push({
                suite: currentSuite,
                ok: caseMatch[1] === '✔',
                name: caseMatch[2].trim(),
                duration: caseMatch[3]
            });
            continue;
        }

        const statMatch = line.match(/^ℹ\s+(tests|suites|pass|fail|skipped|cancelled|duration_ms)\s+([\d.]+)$/);
        if (statMatch) {
            const key = statMatch[1];
            const val = Number(statMatch[2]);
            if (key === 'duration_ms') {
                counters.durationMs = val;
            } else {
                counters[key] = val;
            }
        }
    }

    return { cases, counters, failureDetails: failureLines.join('\n').trim() };
}

function buildMarkdownSummary({ outputText, syntaxOutcome, testsOutcome, branch, eventName, sha }) {
    const { cases, counters, failureDetails } = parseSpecOutput(outputText);
    const overallOk = syntaxOutcome === 'success' && testsOutcome === 'success' && counters.fail === 0;
    const headerIcon = overallOk ? '✅' : '❌';
    const headerTitle = overallOk
        ? 'Validación y Pruebas Aprobadas'
        : 'Validación o Pruebas Fallidas';

    const lines = [];
    lines.push(`## ${headerIcon} ${headerTitle}`);
    lines.push('');
    if (branch || eventName || sha) {
        const shortSha = sha ? String(sha).slice(0, 7) : 'local';
        lines.push(`**Rama:** \`${branch || 'local'}\` · **Evento:** \`${eventName || 'local'}\` · **Commit:** \`${shortSha}\``);
        lines.push('');
    }

    lines.push('### Resumen por etapa');
    lines.push('');
    lines.push('| Etapa | Estado |');
    lines.push('| :--- | :--- |');
    lines.push(`| Sintaxis nativa (JS, Bash \`-n\`, Python, YAML) | ${outcomeBadge(syntaxOutcome)} |`);
    lines.push(`| Suite automatizada (\`node --test\`) | ${outcomeBadge(testsOutcome)} |`);
    lines.push('');

    if (counters.tests > 0 || cases.length > 0) {
        const durText = counters.durationMs !== null ? `${counters.durationMs.toFixed(1)} ms` : 'N/A';
        lines.push('### Métricas de pruebas');
        lines.push('');
        lines.push('| Total | Pasaron | Fallaron | Omitidas | Duración |');
        lines.push('| :---: | :---: | :---: | :---: | :---: |');
        lines.push(`| ${counters.tests} | ${counters.pass} | ${counters.fail} | ${counters.skipped} | ${durText} |`);
        lines.push('');
    }

    if (cases.length > 0) {
        lines.push('### Detalle de pruebas ejecutadas');
        lines.push('');
        lines.push('| Estado | Suite | Caso de prueba | Tiempo |');
        lines.push('| :---: | :--- | :--- | :---: |');
        for (const c of cases) {
            const icon = c.ok ? '✅' : '❌';
            lines.push(`| ${icon} | ${escapeMd(c.suite)} | ${escapeMd(c.name)} | ${c.duration} |`);
        }
        lines.push('');
    }

    if (failureDetails) {
        lines.push('<details>');
        lines.push('<summary>Ver detalle de fallos</summary>');
        lines.push('');
        lines.push('```text');
        lines.push(failureDetails.slice(0, 8000));
        lines.push('```');
        lines.push('</details>');
        lines.push('');
    }

    return lines.join('\n');
}

const inputPath = process.argv[2] || 'test-output.txt';
const outputText = fs.existsSync(inputPath) ? fs.readFileSync(inputPath, 'utf8') : '';

const markdown = buildMarkdownSummary({
    outputText,
    syntaxOutcome: process.env.SYNTAX_OUTCOME || 'N/A',
    testsOutcome: process.env.TESTS_OUTCOME || 'N/A',
    branch: process.env.GITHUB_REF_NAME || '',
    eventName: process.env.GITHUB_EVENT_NAME || '',
    sha: process.env.GITHUB_SHA || ''
});

const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) {
    fs.appendFileSync(summaryFile, `${markdown}\n`, 'utf8');
} else {
    process.stdout.write(`${markdown}\n`);
}
