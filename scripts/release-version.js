#!/usr/bin/env node
/**
 * scripts/release-version.js
 *
 * Automatic SemVer 2.0.0 + Conventional Commits versioner and changelog generator.
 * - MAJOR (+1.0.0): Breaking changes ("BREAKING CHANGE:" or "<type>!:")
 * - MINOR (+0.1.0): New backward-compatible features ("feat:", "feat(...):", or feat/* PR merges)
 * - PATCH (+0.0.1): Bug fixes, security patches, docs, chore, refactor, or manual redeploy
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX_HISTORY_ENTRIES = 80;

function parseSemver(versionStr) {
    const clean = String(versionStr || '').trim().replace(/^v/i, '');
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(clean);
    if (!m) return null;
    return {
        major: Number(m[1]),
        minor: Number(m[2]),
        patch: Number(m[3])
    };
}

function compareSemver(a, b) {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    if (!pa && !pb) return 0;
    if (!pa) return -1;
    if (!pb) return 1;
    if (pa.major !== pb.major) return pa.major - pb.major;
    if (pa.minor !== pb.minor) return pa.minor - pb.minor;
    return pa.patch - pb.patch;
}

function formatSemver(parts) {
    return `${parts.major}.${parts.minor}.${parts.patch}`;
}

function bumpSemver(currentVersion, bumpType = 'patch') {
    const base = parseSemver(currentVersion) || { major: 1, minor: 0, patch: 0 };
    const mode = String(bumpType || 'patch').trim().toLowerCase();
    if (mode === 'major') {
        return formatSemver({ major: base.major + 1, minor: 0, patch: 0 });
    }
    if (mode === 'minor') {
        return formatSemver({ major: base.major, minor: base.minor + 1, patch: 0 });
    }
    return formatSemver({ major: base.major, minor: base.minor, patch: base.patch + 1 });
}

function sanitizeCommitLine(rawText = '', maxLen = 140) {
    return String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function classifyCommit({ sha = '', subject = '', body = '' } = {}) {
    const cleanSubject = sanitizeCommitLine(subject, 160);
    const cleanBody = String(body || '');
    const shortSha = String(sha || '').trim().slice(0, 7);

    if (!cleanSubject) {
        return { kind: 'ignore', sha: shortSha, subject: '' };
    }
    if (/^chore\(release\):/i.test(cleanSubject) || /\[skip ci\]/i.test(cleanSubject)) {
        return { kind: 'ignore', sha: shortSha, subject: cleanSubject };
    }

    const isBreakingHeader = /^[a-z]+(?:\([^)]+\))?!:/i.test(cleanSubject);
    const isBreakingFooter = /(?:^|\n)BREAKING[ -]CHANGE:/i.test(cleanBody) || /BREAKING[ -]CHANGE:/i.test(cleanSubject);
    if (isBreakingHeader || isBreakingFooter) {
        return { kind: 'breaking', sha: shortSha, subject: cleanSubject };
    }

    const isFeatConventional = /^(?:feat|feature)(?:\([^)]+\))?:/i.test(cleanSubject);
    const isFeatPrMerge = /^Merge pull request #\d+ from [^/]+\/feat\//i.test(cleanSubject);
    if (isFeatConventional || isFeatPrMerge) {
        return { kind: 'feature', sha: shortSha, subject: cleanSubject };
    }

    const isFixConventional = /^(?:fix|bugfix|hotfix|security|perf|refactor)(?:\([^)]+\))?:/i.test(cleanSubject)
        || /^fix\b/i.test(cleanSubject)
        || /^Merge pull request #\d+ from [^/]+\/fix\//i.test(cleanSubject);
    if (isFixConventional) {
        return { kind: 'fix', sha: shortSha, subject: cleanSubject };
    }

    return { kind: 'maintenance', sha: shortSha, subject: cleanSubject };
}

function analyzeCommits(commits = [], { forcedBump = 'auto', trigger = 'push' } = {}) {
    const breaking = [];
    const features = [];
    const fixes = [];
    const maintenance = [];
    const seenTexts = new Set();

    for (const commit of Array.isArray(commits) ? commits : []) {
        const parsed = classifyCommit(commit);
        if (parsed.kind === 'ignore' || !parsed.subject) continue;
        const entry = parsed.sha ? `${parsed.subject} (${parsed.sha})` : parsed.subject;
        const dedupKey = parsed.subject.toLowerCase();
        if (seenTexts.has(dedupKey)) continue;
        seenTexts.add(dedupKey);

        if (parsed.kind === 'breaking') breaking.push(entry);
        else if (parsed.kind === 'feature') features.push(entry);
        else if (parsed.kind === 'fix') fixes.push(entry);
        else maintenance.push(entry);
    }

    if (breaking.length + features.length + fixes.length + maintenance.length === 0) {
        if (trigger === 'workflow_dispatch') {
            maintenance.push('chore(deploy): manual redeployment via GitHub Actions');
        } else {
            maintenance.push('chore(deploy): deployment triggered on main branch');
        }
    }

    const cleanForce = String(forcedBump || 'auto').trim().toLowerCase();
    let bumpType = 'patch';
    if (cleanForce === 'major' || cleanForce === 'minor' || cleanForce === 'patch') {
        bumpType = cleanForce;
    } else if (breaking.length > 0) {
        bumpType = 'major';
    } else if (features.length > 0) {
        bumpType = 'minor';
    }

    return {
        bumpType,
        counts: {
            breaking: breaking.length,
            features: features.length,
            fixes: fixes.length,
            maintenance: maintenance.length
        },
        changes: {
            breaking: breaking.slice(0, 15),
            features: features.slice(0, 20),
            fixes: fixes.slice(0, 25),
            maintenance: maintenance.slice(0, 20)
        }
    };
}

function summarizeRelease(changes, bumpType) {
    if (changes.breaking.length > 0) {
        return changes.breaking[0].replace(/\s*\([a-f0-9]{7}\)$/i, '');
    }
    if (changes.features.length > 0) {
        return changes.features[0].replace(/\s*\([a-f0-9]{7}\)$/i, '');
    }
    if (changes.fixes.length > 0) {
        return changes.fixes[0].replace(/\s*\([a-f0-9]{7}\)$/i, '');
    }
    if (changes.maintenance.length > 0) {
        return changes.maintenance[0].replace(/\s*\([a-f0-9]{7}\)$/i, '');
    }
    return `Automated ${bumpType} deployment`;
}

function buildChangelogMarkdown(historyData = {}) {
    const standard = historyData.standard || 'SemVer 2.0.0 + Conventional Commits';
    const currentVersion = historyData.currentVersion || '1.0.0';
    const releases = Array.isArray(historyData.releases) ? historyData.releases : [];

    const lines = [
        '# Historial de Versiones / Changelog',
        '',
        `> Estándar aplicado: **${standard}** · Versión actual desplegada: **v${currentVersion}**`,
        '>',
        '> Reglas automáticas en cada despliegue a `main`:',
        '> - **MAJOR (`+1.0.0`)**: Cambios incompatibles (`BREAKING CHANGE:` o `<tipo>!:`).',
        '> - **MINOR (`+0.1.0`)**: Nuevas funcionalidades compatibles (`feat:` / `feat(alcance):`).',
        '> - **PATCH (`+0.0.1`)**: Corrección de errores (`fix:`), seguridad, documentación o mantenimiento.',
        ''
    ];

    for (const rel of releases) {
        const datePart = String(rel.releasedAt || '').slice(0, 10) || '1970-01-01';
        const bumpLabel = String(rel.bumpType || 'patch').toUpperCase();
        const shaTag = rel.commitSha ? ` · \`${rel.commitSha}\`` : '';
        lines.push(`## [v${rel.version}] - ${datePart} (${bumpLabel})${shaTag}`);
        if (rel.summary) {
            lines.push(`**${rel.summary}**`);
        }
        lines.push('');

        const groups = [
            ['breaking', '💥 Breaking Changes'],
            ['features', '✨ Features / Nuevas Funciones'],
            ['fixes', '🐛 Bug Fixes / Correcciones'],
            ['maintenance', '🔧 Maintenance & Docs']
        ];
        let printedAny = false;
        for (const [key, title] of groups) {
            const list = Array.isArray(rel.changes?.[key]) ? rel.changes[key] : [];
            if (list.length === 0) continue;
            printedAny = true;
            lines.push(`### ${title}`);
            for (const item of list) {
                lines.push(`- ${item}`);
            }
            lines.push('');
        }
        if (!printedAny) {
            lines.push('- Automated deployment release.', '');
        }
    }

    return `${lines.join('\n').trimEnd()}\n`;
}

function execGit(cwd, args) {
    try {
        return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (_) {
        return '';
    }
}

function isGitAncestor(cwd, ancestorSha, headRef) {
    try {
        execFileSync('git', ['merge-base', '--is-ancestor', ancestorSha, headRef], {
            cwd,
            stdio: ['ignore', 'ignore', 'ignore']
        });
        return true;
    } catch (_) {
        return false;
    }
}

function getCommitsForRelease(cwd, { beforeSha = '', headRef = 'HEAD' } = {}) {
    const tagsRaw = execGit(cwd, ['tag', '--list', 'v*', '--sort=-v:refname']);
    const tags = tagsRaw
        .split(/\r?\n/)
        .map(t => t.trim())
        .filter(t => parseSemver(t))
        .sort((a, b) => compareSemver(b, a));

    const latestTag = tags[0] || '';
    let range = '';
    if (latestTag) {
        range = `${latestTag}..${headRef}`;
    } else if (beforeSha && !/^0+$/.test(beforeSha)) {
        const exists = execGit(cwd, ['cat-file', '-t', beforeSha]);
        if (exists === 'commit' && isGitAncestor(cwd, beforeSha, headRef)) {
            range = `${beforeSha}..${headRef}`;
        }
    }

    const logArgs = range
        ? ['log', range, '--no-merges', '--format=%H%x1f%s%x1f%b%x1e']
        : ['log', headRef, '-n', '20', '--format=%H%x1f%s%x1f%b%x1e'];
    let raw = execGit(cwd, logArgs);

    // If only merge commit existed in range (e.g. squash/merge commit), inspect full range including merge titles
    if (!raw && range) {
        raw = execGit(cwd, ['log', range, '--format=%H%x1f%s%x1f%b%x1e']);
    }

    const commits = [];
    for (const chunk of raw.split('\x1e')) {
        const clean = chunk.replace(/^\r?\n+/, '');
        if (!clean) continue;
        const [sha = '', subject = '', body = ''] = clean.split('\x1f');
        if (/^chore\(release\):/i.test(subject.trim()) || /\[skip ci\]/i.test(subject.trim())) {
            if (!range) break;
            continue;
        }
        commits.push({ sha: sha.trim(), subject: subject.trim(), body: body.trim() });
    }

    const headSha = execGit(cwd, ['rev-parse', '--short=7', headRef]) || 'local';
    return { latestTag, commits, headSha };
}

function readJsonSafe(filePath, fallback = null) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return fallback;
    }
}

function runRelease({
    cwd = process.cwd(),
    apply = false,
    forcedBump = 'auto',
    trigger = process.env.GITHUB_EVENT_NAME || 'push',
    beforeSha = process.env.GITHUB_BEFORE_SHA || '',
    releasedAt = new Date().toISOString(),
    commitsOverride = null,
    headShaOverride = ''
} = {}) {
    const pkgPath = path.join(cwd, 'package.json');
    const lockPath = path.join(cwd, 'package-lock.json');
    const historyPath = path.join(cwd, 'version-history.json');
    const changelogPath = path.join(cwd, 'CHANGELOG.md');

    const pkg = readJsonSafe(pkgPath, { name: 'personal-daily-hub', version: '1.0.0' });
    const historyFile = readJsonSafe(historyPath, null);
    const existingReleases = Array.isArray(historyFile?.releases) ? historyFile.releases : [];

    const gitInfo = commitsOverride
        ? { latestTag: existingReleases[0]?.tag || '', commits: commitsOverride, headSha: headShaOverride || 'testsha' }
        : getCommitsForRelease(cwd, { beforeSha });

    let baseVersion = parseSemver(pkg.version) ? pkg.version : '1.0.0';
    if (gitInfo.latestTag && compareSemver(gitInfo.latestTag, baseVersion) > 0) {
        baseVersion = gitInfo.latestTag.replace(/^v/i, '');
    }
    if (existingReleases[0]?.version && compareSemver(existingReleases[0].version, baseVersion) > 0) {
        baseVersion = existingReleases[0].version;
    }

    const analysis = analyzeCommits(gitInfo.commits, { forcedBump, trigger });
    const nextVersion = bumpSemver(baseVersion, analysis.bumpType);
    const tagName = `v${nextVersion}`;
    const summary = summarizeRelease(analysis.changes, analysis.bumpType);

    const newEntry = {
        version: nextVersion,
        tag: tagName,
        bumpType: analysis.bumpType,
        previousVersion: baseVersion,
        releasedAt,
        commitSha: headShaOverride || gitInfo.headSha || 'local',
        trigger: String(trigger || 'push'),
        summary,
        counts: analysis.counts,
        changes: analysis.changes
    };

    const nextReleases = [newEntry, ...existingReleases.filter(r => r && r.version !== nextVersion)]
        .slice(0, MAX_HISTORY_ENTRIES);

    const nextHistory = {
        standard: 'SemVer 2.0.0 + Conventional Commits',
        currentVersion: nextVersion,
        updatedAt: releasedAt,
        releases: nextReleases
    };

    const changelogMarkdown = buildChangelogMarkdown(nextHistory);

    if (apply) {
        const updatedPkg = { ...pkg, version: nextVersion };
        fs.writeFileSync(pkgPath, `${JSON.stringify(updatedPkg, null, 2)}\n`, 'utf8');

        const lock = readJsonSafe(lockPath, null);
        if (lock && typeof lock === 'object') {
            lock.version = nextVersion;
            if (lock.packages && lock.packages['']) {
                lock.packages[''].version = nextVersion;
            }
            fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
        }

        fs.writeFileSync(historyPath, `${JSON.stringify(nextHistory, null, 2)}\n`, 'utf8');
        fs.writeFileSync(changelogPath, changelogMarkdown, 'utf8');
    }

    return {
        previousVersion: baseVersion,
        nextVersion,
        tagName,
        bumpType: analysis.bumpType,
        entry: newEntry,
        history: nextHistory,
        changelogMarkdown
    };
}

function buildReleaseNotesMarkdown(entry) {
    const lines = [
        `## Release ${entry.tag} (${String(entry.bumpType).toUpperCase()})`,
        '',
        `**Summary:** ${entry.summary}`,
        `- **Commit:** \`${entry.commitSha}\``,
        `- **Trigger:** \`${entry.trigger}\``,
        ''
    ];
    const groups = [
        ['breaking', '### 💥 Breaking Changes'],
        ['features', '### ✨ Features'],
        ['fixes', '### 🐛 Bug Fixes'],
        ['maintenance', '### 🔧 Maintenance']
    ];
    for (const [key, title] of groups) {
        const items = entry.changes?.[key] || [];
        if (!items.length) continue;
        lines.push(title);
        items.forEach(item => lines.push(`- ${item}`));
        lines.push('');
    }
    return lines.join('\n').trim();
}

function main() {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const writeGhOutput = args.includes('--github-output');
    const bumpIdx = args.indexOf('--bump');
    const forcedBump = bumpIdx !== -1 && args[bumpIdx + 1] ? args[bumpIdx + 1] : (process.env.FORCE_BUMP || 'auto');

    const res = runRelease({
        cwd: process.cwd(),
        apply,
        forcedBump,
        trigger: process.env.GITHUB_EVENT_NAME || 'push',
        beforeSha: process.env.GITHUB_BEFORE_SHA || ''
    });

    if (writeGhOutput && process.env.GITHUB_OUTPUT) {
        const notesText = buildReleaseNotesMarkdown(res.entry);
        const notesPath = path.join(process.env.RUNNER_TEMP || '/tmp', `release-notes-${res.nextVersion}.md`);
        fs.writeFileSync(notesPath, `${notesText}\n`, 'utf8');
        const historyB64 = Buffer.from(JSON.stringify(res.history), 'utf8').toString('base64');
        const outLines = [
            `previous_version=${res.previousVersion}`,
            `next_version=${res.nextVersion}`,
            `tag_name=${res.tagName}`,
            `bump_type=${res.bumpType}`,
            `summary=${res.entry.summary.replace(/[\r\n]+/g, ' ')}`,
            `notes_file=${notesPath}`,
            `history_b64=${historyB64}`
        ];
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `${outLines.join('\n')}\n`, 'utf8');
    }

    process.stdout.write(`${JSON.stringify({
        applied: apply,
        previousVersion: res.previousVersion,
        nextVersion: res.nextVersion,
        tagName: res.tagName,
        bumpType: res.bumpType,
        summary: res.entry.summary,
        counts: res.entry.counts
    }, null, 2)}\n`);
}

if (require.main === module) {
    main();
}

module.exports = {
    parseSemver,
    compareSemver,
    formatSemver,
    bumpSemver,
    classifyCommit,
    analyzeCommits,
    buildChangelogMarkdown,
    buildReleaseNotesMarkdown,
    runRelease
};
