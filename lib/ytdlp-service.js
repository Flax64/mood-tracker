'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { cleanCaptionTextToLyrics, segmentLyricsIntoStanzas } = require('./youtube-metadata');
const { fetchYouTubeMusicLyrics } = require('./ytmusic-lyrics');

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const STREAM_CACHE_MAX_ENTRIES = 16;
const STREAM_CACHE_TTL_MS = 25 * 60 * 1000;
const YTDLP_PROGRESSIVE_FORMAT =
    '18/best[ext=mp4][vcodec!=none][acodec!=none][height<=480]/best[ext=mp4][vcodec!=none][acodec!=none]/bestaudio[ext=m4a]/bestaudio/best';

const DEFAULT_BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const streamResolutionCache = new Map();

// FIFO Concurrency Semaphore (maxConcurrency = 1) to protect 1 GB RAM t3.micro instances
// against simultaneous yt-dlp, rclone, or .docx parsing subprocess spikes.
let _heavyTaskChain = Promise.resolve();

/**
 * Serialize heavy subprocess or memory-intensive tasks (FIFO maxConcurrency = 1).
 * @template T
 * @param {() => Promise<T>} taskFn
 * @returns {Promise<T>}
 */
async function runWithHeavyTaskLock(taskFn) {
    let releaseLock;
    const prevTurn = _heavyTaskChain;
    _heavyTaskChain = new Promise((resolve) => {
        releaseLock = resolve;
    });
    await prevTurn;
    try {
        return await taskFn();
    } finally {
        releaseLock();
    }
}

/**
 * Validate and extract a strict 11-character YouTube video ID from a URL or raw ID.
 * Prevents command/argument injection and arbitrary non-YouTube host access.
 * @param {string} rawInput
 * @returns {string|null}
 */
function extractValidYouTubeVideoId(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) return null;
    if (VIDEO_ID_REGEX.test(raw)) return raw;

    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let parsed;
    try {
        parsed = new URL(candidate);
    } catch (_) {
        return null;
    }

    const host = (parsed.hostname || '').toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
        const seg = parsed.pathname.split('/').filter(Boolean)[0] || '';
        return VIDEO_ID_REGEX.test(seg) ? seg : null;
    }

    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
        const vParam = parsed.searchParams.get('v') || '';
        if (VIDEO_ID_REGEX.test(vParam)) return vParam;

        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0]) && VIDEO_ID_REGEX.test(parts[1])) {
            return parts[1];
        }
    }

    return null;
}

/**
 * Canonicalize a video ID into a safe YouTube watch URL.
 * @param {string} videoId
 * @returns {string}
 */
function buildCanonicalWatchUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Check whether an upstream CDN URL is an allowed HTTPS YouTube / GoogleVideo endpoint.
 * Prevents SSRF against internal IPs or arbitrary hosts.
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isAllowedMediaCdnUrl(rawUrl) {
    if (!rawUrl) return false;
    let parsed;
    try {
        parsed = new URL(String(rawUrl));
    } catch (_) {
        return false;
    }
    if (parsed.protocol !== 'https:') return false;
    const host = (parsed.hostname || '').toLowerCase();
    return (
        host === 'googlevideo.com' ||
        host.endsWith('.googlevideo.com') ||
        host === 'youtube.com' ||
        host.endsWith('.youtube.com')
    );
}

/**
 * Check whether a timedtext caption URL is a valid HTTPS YouTube endpoint.
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isAllowedCaptionUrl(rawUrl) {
    if (!rawUrl) return false;
    let parsed;
    try {
        parsed = new URL(String(rawUrl));
    } catch (_) {
        return false;
    }
    if (parsed.protocol !== 'https:') return false;
    const host = (parsed.hostname || '').toLowerCase();
    return host === 'youtube.com' || host.endsWith('.youtube.com');
}

/**
 * Anti-SSRF allowlist for YouTube Music InnerTube: only https://music.youtube.com/youtubei/v1/*
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isAllowedInnerTubeUrl(rawUrl) {
    if (!rawUrl) return false;
    let parsed;
    try {
        parsed = new URL(String(rawUrl));
    } catch (_) {
        return false;
    }
    return (
        parsed.protocol === 'https:' &&
        parsed.hostname.toLowerCase() === 'music.youtube.com' &&
        !parsed.username &&
        !parsed.password &&
        (parsed.port === '' || parsed.port === '443') &&
        parsed.pathname.startsWith('/youtubei/v1/') &&
        !parsed.pathname.includes('..')
    );
}

function stripOuterQuotes(value) {
    let clean = String(value || '').trim();
    if (
        (clean.startsWith('"') && clean.endsWith('"')) ||
        (clean.startsWith("'") && clean.endsWith("'"))
    ) {
        clean = clean.slice(1, -1).trim();
    }
    return clean;
}

function isWindowsSpecificPath(rawValue) {
    const val = String(rawValue || '').trim();
    return /^[A-Za-z]:[\\/]/.test(val) || /^\\\\/.test(val) || /\.exe$/i.test(val);
}

/**
 * Resolve `yt-dlp` binary across Windows local setups (GitHub Variable `YT_DLP_PATH`,
 * Download Videos folder, `.last_yt_dlp_path.json`, PATH) and Linux Docker containers
 * (`/usr/local/bin/yt-dlp`, `/usr/bin/yt-dlp`). Safely skips Windows paths when running on Linux.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.platform]
 * @param {object} [opts.fsImpl]
 * @param {object} [opts.pathImpl]
 * @param {string} [opts.projectRoot]
 * @returns {{ available: boolean, binPath: string|null, source: string, configuredValue: string|null, skippedCrossOs: boolean }}
 */
function resolveYtDlpBinary({
    env = process.env,
    platform = process.platform,
    fsImpl = fs,
    pathImpl = null,
    projectRoot = path.resolve(__dirname, '..')
} = {}) {
    const activePath = pathImpl || (platform === 'win32' ? path.win32 : path.posix);

    const resolveCandidate = (rawCandidate) => {
        const cleaned = stripOuterQuotes(rawCandidate);
        if (!cleaned) return null;
        if (platform !== 'win32' && isWindowsSpecificPath(cleaned)) {
            return null;
        }
        try {
            if (!fsImpl.existsSync(cleaned)) return null;
            if (typeof fsImpl.statSync === 'function') {
                const st = fsImpl.statSync(cleaned);
                if (st && typeof st.isDirectory === 'function' && st.isDirectory()) {
                    const binNames = platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp', 'yt-dlp.exe'];
                    for (const name of binNames) {
                        const nested = activePath.join(cleaned, name);
                        if (fsImpl.existsSync(nested)) return nested;
                    }
                    return null;
                }
            }
            return cleaned;
        } catch (_) {
            return null;
        }
    };

    const rawEnvYtDlpPath = stripOuterQuotes(env?.YT_DLP_PATH || '');
    const rawEnvYtDlpBin = stripOuterQuotes(env?.YT_DLP_BIN || '');
    const configuredValue = rawEnvYtDlpPath || rawEnvYtDlpBin || null;
    const skippedCrossOs = Boolean(configuredValue && platform !== 'win32' && isWindowsSpecificPath(configuredValue));

    for (const [varName, val] of [
        ['env:YT_DLP_PATH', rawEnvYtDlpPath],
        ['env:YT_DLP_BIN', rawEnvYtDlpBin]
    ]) {
        const hit = resolveCandidate(val);
        if (hit) {
            return {
                available: true,
                binPath: hit,
                source: varName,
                configuredValue,
                skippedCrossOs: false
            };
        }
    }

    // Shared cache written by `sincronitation/yt_lyrics_helper.py` on Windows/local workstations
    const cacheCandidates = [
        activePath.join(projectRoot, 'sincronitation', '.last_yt_dlp_path.json'),
        activePath.join(projectRoot, '.last_yt_dlp_path.json')
    ];
    for (const cacheFile of cacheCandidates) {
        try {
            if (fsImpl.existsSync(cacheFile) && typeof fsImpl.readFileSync === 'function') {
                const parsed = JSON.parse(fsImpl.readFileSync(cacheFile, 'utf8'));
                const hit = resolveCandidate(parsed?.raw_value || '');
                if (hit) {
                    return {
                        available: true,
                        binPath: hit,
                        source: 'cache:.last_yt_dlp_path.json',
                        configuredValue,
                        skippedCrossOs
                    };
                }
            }
        } catch (_) {
            // Ignore unreadable or malformed local helper cache
        }
    }

    const osDefaults =
        platform === 'win32'
            ? [
                  env?.USERPROFILE ? activePath.join(env.USERPROFILE, 'Desktop', 'Download Videos', 'yt-dlp.exe') : '',
                  'C:\\Users\\flavi\\Desktop\\Download Videos\\yt-dlp.exe',
                  env?.LOCALAPPDATA ? activePath.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe') : ''
              ]
            : [
                  '/usr/local/bin/yt-dlp',
                  '/usr/bin/yt-dlp',
                  env?.HOME ? activePath.join(env.HOME, '.local', 'bin', 'yt-dlp') : ''
              ];

    for (const candidate of osDefaults) {
        const hit = resolveCandidate(candidate);
        if (hit) {
            return {
                available: true,
                binPath: hit,
                source: platform === 'win32' ? 'os-default:win32' : 'os-default:linux',
                configuredValue,
                skippedCrossOs
            };
        }
    }

    const pathEnv = String(env?.PATH || env?.Path || '');
    if (pathEnv) {
        const sep = platform === 'win32' ? ';' : ':';
        const exeNames = platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp'];
        for (const dirEntry of pathEnv.split(sep)) {
            const cleanDir = stripOuterQuotes(dirEntry);
            if (!cleanDir) continue;
            for (const exeName of exeNames) {
                const hit = resolveCandidate(activePath.join(cleanDir, exeName));
                if (hit) {
                    return {
                        available: true,
                        binPath: hit,
                        source: 'PATH',
                        configuredValue,
                        skippedCrossOs
                    };
                }
            }
        }
    }

    return {
        available: false,
        binPath: null,
        source: 'missing',
        configuredValue,
        skippedCrossOs
    };
}

/**
 * Clean `.vtt`, `.srt`, `.lrc`, `<transcript>` XML, or TTML subtitle text into readable lyrics.
 * @param {string} rawText
 * @returns {string}
 */
function cleanSubtitleText(rawText) {
    const str = String(rawText || '');
    if (!str.trim()) return '';
    // Ensure XML timedtext / TTML cues break cleanly across lines before delegating to shared cleaner
    const prepared = /<(?:transcript|timedtext|tt[\s>]|text[\s>]|p[\s>])/i.test(str)
        ? str.replace(/<\/(?:text|p)>/gi, '\n')
        : str;
    return cleanCaptionTextToLyrics(prepared);
}

/**
 * Detect meaningful lyric content rather than bare instrumental markers like `[Music]` or `♪`.
 * @param {string} lyricsText
 * @returns {boolean}
 */
function hasMeaningfulLyrics(lyricsText) {
    const stripped = String(lyricsText || '')
        .replace(/\[(?:music|applause|laughter|cheering|instrumental|음악|박수)\]/gi, '')
        .replace(/[♪♫♩♬\s.,!?'"()\-_~]/g, '');
    return stripped.length >= 6;
}

/**
 * Parse `"captionTracks":[...]` JSON array from YouTube watch HTML without regex catastrophic backtracking.
 * @param {string} html
 * @returns {Array<{ languageCode: string, name: string, kind: string, isAutoGenerated: boolean, baseUrl: string }>}
 */
function parseWatchPageCaptionTracks(html) {
    const text = String(html || '');
    const keyIdx = text.indexOf('"captionTracks":');
    if (keyIdx === -1) return [];

    const startBracket = text.indexOf('[', keyIdx);
    if (startBracket === -1) return [];

    let depth = 0;
    let inString = false;
    let escaped = false;
    let endBracket = -1;

    const scanLimit = Math.min(text.length, startBracket + 60000);
    for (let i = startBracket; i < scanLimit; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === '[') {
            depth++;
        } else if (ch === ']') {
            depth--;
            if (depth === 0) {
                endBracket = i;
                break;
            }
        }
    }

    if (endBracket === -1) return [];

    let parsed;
    try {
        parsed = JSON.parse(text.slice(startBracket, endBracket + 1));
    } catch (_) {
        return [];
    }
    if (!Array.isArray(parsed)) return [];

    return parsed
        .map((track) => {
            if (!track || typeof track !== 'object') return null;
            const rawUrl = String(track.baseUrl || '').replace(/\\u0026/g, '&').trim();
            if (!isAllowedCaptionUrl(rawUrl)) return null;
            const langCode = String(track.languageCode || '').trim().slice(0, 24);
            const nameText =
                String(track.name?.simpleText || track.name?.runs?.[0]?.text || langCode || 'Unknown')
                    .trim()
                    .slice(0, 80);
            const kind = String(track.kind || '').trim().toLowerCase();
            return {
                languageCode: langCode,
                name: nameText,
                kind,
                isAutoGenerated: kind === 'asr',
                baseUrl: rawUrl
            };
        })
        .filter(Boolean);
}

function invokeExecFile(execFn, binPath, args, options) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const cb = (err, stdout, stderr) => {
            if (settled) return;
            settled = true;
            if (err) {
                err.stdout = stdout !== undefined ? String(stdout) : String(err.stdout || '');
                err.stderr = stderr !== undefined ? String(stderr) : String(err.stderr || '');
                return reject(err);
            }
            return resolve({
                stdout: String(stdout || ''),
                stderr: String(stderr || '')
            });
        };

        try {
            const maybePromise = execFn(binPath, args, options, cb);
            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.then(
                    (res) => {
                        if (settled) return;
                        settled = true;
                        resolve({
                            stdout: String(res?.stdout || ''),
                            stderr: String(res?.stderr || '')
                        });
                    },
                    (err) => {
                        if (settled) return;
                        settled = true;
                        reject(err);
                    }
                );
            }
        } catch (syncErr) {
            if (!settled) {
                settled = true;
                reject(syncErr);
            }
        }
    });
}

/**
 * Execute `yt-dlp` safely with `shell: false` and `--js-runtimes node`.
 * Automatically retries once without `--js-runtimes` on older `yt-dlp` releases.
 */
async function runYtDlp(
    binPath,
    args,
    { execFileImpl = childProcess.execFile, timeoutMs = 20000, maxBuffer = 2 * 1024 * 1024, env = process.env } = {}
) {
    const cleanEnv = { ...env, PYTHONIOENCODING: 'utf-8' };
    const execOptions = { timeout: timeoutMs, maxBuffer, windowsHide: true, env: cleanEnv };

    const hasJsRuntimeArg = args.includes('--js-runtimes');
    const primaryArgs = hasJsRuntimeArg ? args : ['--js-runtimes', 'node', ...args];

    try {
        return await invokeExecFile(execFileImpl, binPath, primaryArgs, execOptions);
    } catch (err) {
        const stderr = String(err?.stderr || err?.message || '');
        if (!hasJsRuntimeArg && /unrecognized arguments?:\s*--js-runtimes|no such option:\s*--js-runtimes/i.test(stderr)) {
            return invokeExecFile(execFileImpl, binPath, args, execOptions);
        }
        throw err;
    }
}

function hasHangulScript(text) {
    return /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(String(text || ''));
}

function hasJapaneseScript(text) {
    return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(String(text || ''));
}

function isolateKoreanOnlyLyrics(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const kept = [];
    let pendingBreak = false;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            if (kept.length) pendingBreak = true;
            continue;
        }
        if (/^\[(?:음악|music|applause|laughter|cheering|instrumental)\]$/i.test(line)) continue;
        if (hasHangulScript(line)) {
            if (pendingBreak && kept.length && kept[kept.length - 1] !== '') kept.push('');
            pendingBreak = false;
            const lastNonEmpty = [...kept].reverse().find((l) => l !== '');
            if (lastNonEmpty !== line) kept.push(line);
        }
    }
    while (kept.length && kept[kept.length - 1] === '') kept.pop();
    return segmentLyricsIntoStanzas(kept.join('\n').trim());
}

function isolateJapaneseLyrics(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const kept = [];
    let pendingBreak = false;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            if (kept.length) pendingBreak = true;
            continue;
        }
        if (/^\[(?:音楽|歌|music|applause|laughter|cheering|instrumental)\]$/i.test(line)) continue;
        if (hasJapaneseScript(line) && !hasHangulScript(line)) {
            if (pendingBreak && kept.length && kept[kept.length - 1] !== '') kept.push('');
            pendingBreak = false;
            const lastNonEmpty = [...kept].reverse().find((l) => l !== '');
            if (lastNonEmpty !== line) kept.push(line);
        }
    }
    while (kept.length && kept[kept.length - 1] === '') kept.pop();
    return segmentLyricsIntoStanzas(kept.join('\n').trim());
}

function normalizePreferredLangs({ idioma, preferredLangs } = {}) {
    if (Array.isArray(preferredLangs) && preferredLangs.length > 0) {
        return preferredLangs.map((l) => String(l || '').trim()).filter(Boolean);
    }
    const langLower = String(idioma || '').toLowerCase();
    if (langLower.includes('korean') && !langLower.includes('english')) {
        return ['ko', 'en', 'es', 'ja'];
    }
    if (langLower.includes('korean')) {
        return ['ko', 'en', 'es', 'ja'];
    }
    if (langLower.includes('spanish')) {
        return ['es', 'en', 'ko', 'ja'];
    }
    if (langLower.includes('japanese')) {
        return ['ja', 'en', 'ko', 'es'];
    }
    return ['en', 'ko', 'es', 'ja'];
}

const LANG_ALIAS_MAP = { kr: 'ko', jp: 'ja' };

function getBaseLanguageCode(langTag) {
    const clean = String(langTag || '').trim().toLowerCase().replace(/-orig$/i, '');
    if (!clean) return '';
    const base = clean.split(/[-_]/)[0];
    return LANG_ALIAS_MAP[base] || base;
}

function areLyricTracksRedundant(textA, textB) {
    const normalizeLines = (txt) => String(txt || '')
        .split('\n')
        .map((line) => line.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim())
        .filter((line) => line.length >= 2);

    const linesA = normalizeLines(textA);
    const linesB = normalizeLines(textB);
    if (!linesA.length || !linesB.length) return false;
    if (linesA.join('\n') === linesB.join('\n')) return true;

    const setA = new Set(linesA);
    const setB = new Set(linesB);
    let intersection = 0;
    for (const line of setA) {
        if (setB.has(line)) intersection += 1;
    }
    const unionSize = new Set([...setA, ...setB]).size;
    const jaccard = unionSize > 0 ? intersection / unionSize : 0;
    const minOverlap = Math.min(setA.size, setB.size) > 0 ? intersection / Math.min(setA.size, setB.size) : 0;
    return jaccard >= 0.72 || minOverlap >= 0.85;
}

function classifyLyricsIntoFiveTracks(chosenList = [], { preferredLangs = ['ko', 'en', 'es', 'ja'], rawOriginal = '' } = {}) {
    const byLang = {};
    for (const item of chosenList) {
        const base = getBaseLanguageCode(item.rawLanguage || item.language);
        const txt = String(item.lyrics || '').trim();
        if (!txt) continue;
        if (base === 'multi' || base === 'original' || base === 'orig') {
            if (!rawOriginal) rawOriginal = txt;
            continue;
        }
        if (base && !byLang[base]) {
            byLang[base] = txt;
        }
    }

    const koRaw = byLang.ko || '';
    const enRaw = byLang.en || '';
    const jaRaw = byLang.ja || '';
    const esRaw = byLang.es || '';

    let original = String(rawOriginal || '').trim();
    if (!original) {
        const koHasMixedLatin = Boolean(koRaw && hasHangulScript(koRaw) && /[A-Za-z]{2,}/.test(koRaw));
        const jaHasMixedLatin = Boolean(jaRaw && hasJapaneseScript(jaRaw) && /[A-Za-z]{2,}/.test(jaRaw));
        if (koHasMixedLatin) {
            original = koRaw;
        } else if (jaHasMixedLatin) {
            original = jaRaw;
        } else {
            for (const pref of preferredLangs) {
                const b = getBaseLanguageCode(pref);
                if (b && byLang[b]) {
                    original = byLang[b];
                    break;
                }
            }
            if (!original) {
                original = koRaw || enRaw || jaRaw || esRaw || '';
            }
        }
    }

    const koOnly = isolateKoreanOnlyLyrics(koRaw || (hasHangulScript(original) ? original : ''));
    let jaClean = '';
    if (jaRaw && hasJapaneseScript(jaRaw) && /[A-Za-z]{2,}/.test(jaRaw)) {
        jaClean = isolateJapaneseLyrics(jaRaw);
    } else {
        jaClean = jaRaw || (hasJapaneseScript(original) ? isolateJapaneseLyrics(original) : '');
    }
    const enClean = enRaw || (original && !hasHangulScript(original) && !hasJapaneseScript(original) && original !== esRaw ? original : '');
    const esClean = esRaw;

    return {
        original: segmentLyricsIntoStanzas(original),
        ko: koOnly,
        en: segmentLyricsIntoStanzas(enClean),
        ja: segmentLyricsIntoStanzas(jaClean),
        es: segmentLyricsIntoStanzas(esClean)
    };
}

function deduplicateAndFormatLyricTracks(candidates, maxTracks = 5, { preferredLangs = ['ko', 'en', 'es', 'ja'], rawOriginal = '' } = {}) {
    const emptyFive = { original: '', ko: '', en: '', ja: '', es: '' };
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return { tracks: emptyFive, trackList: [], combinedLyrics: '', combinedLanguage: '', primarySource: '' };
    }

    const sorted = [...candidates].sort((a, b) => (b.score || 0) - (a.score || 0));
    const chosen = [];
    const seenBaseLangs = new Set();

    for (const cand of sorted) {
        const cleanLyrics = String(cand?.lyrics || '').trim();
        if (!cleanLyrics) continue;
        const baseLang = getBaseLanguageCode(cand.language);
        if (baseLang && seenBaseLangs.has(baseLang)) continue;
        // Solo descartar como redundante entre idiomas distintos si no aporta escritura nueva (ej. Hangul o Japonés)
        const addsDistinctScript = (baseLang === 'ko' && hasHangulScript(cleanLyrics))
            || (baseLang === 'ja' && hasJapaneseScript(cleanLyrics))
            || (baseLang === 'en' && chosen.some((e) => hasHangulScript(e.lyrics) || hasJapaneseScript(e.lyrics)));
        if (!addsDistinctScript && chosen.some((existing) => areLyricTracksRedundant(existing.lyrics, cleanLyrics))) continue;

        if (baseLang) seenBaseLangs.add(baseLang);
        chosen.push({
            ...cand,
            language: baseLang || String(cand.language || 'sub').toLowerCase(),
            lyrics: cleanLyrics
        });
        if (chosen.length >= maxTracks) break;
    }

    if (!chosen.length) {
        return { tracks: emptyFive, trackList: [], combinedLyrics: '', combinedLanguage: '', primarySource: '' };
    }

    const structured = classifyLyricsIntoFiveTracks(chosen, { preferredLangs, rawOriginal });
    const orderedSections = [];
    if (
        structured.original
        && structured.original !== structured.ko
        && structured.original !== structured.en
        && structured.original !== structured.ja
    ) {
        orderedSections.push({ key: 'original', tag: 'ORIGINAL', lyrics: structured.original });
    }
    if (structured.ko) orderedSections.push({ key: 'ko', tag: 'KO', lyrics: structured.ko });
    if (structured.en) orderedSections.push({ key: 'en', tag: 'EN', lyrics: structured.en });
    if (structured.ja) orderedSections.push({ key: 'ja', tag: 'JA', lyrics: structured.ja });
    if (structured.es) orderedSections.push({ key: 'es', tag: 'ES', lyrics: structured.es });

    const presentKeys = ['original', 'ko', 'en', 'ja', 'es'].filter((k) => Boolean(structured[k]));
    if (chosen.length === 1 && orderedSections.length <= 1) {
        return {
            tracks: structured,
            trackList: chosen,
            combinedLyrics: chosen[0].lyrics,
            combinedLanguage: chosen[0].rawLanguage || chosen[0].language,
            primarySource: chosen[0].source
        };
    }

    const combinedLyrics = orderedSections.length === 1
        ? orderedSections[0].lyrics
        : orderedSections.map((s) => `[${s.tag}]\n${s.lyrics}`).join('\n\n');

    return {
        tracks: structured,
        trackList: chosen,
        combinedLyrics,
        combinedLanguage: chosen.map((t) => t.language).join(',') || presentKeys.join(','),
        primarySource: chosen.map((t) => t.source).filter(Boolean).join('+')
    };
}

function scoreLanguageTag(langTag, preferredLangs, { isManual = null, rawContent = '' } = {}) {
    const raw = String(langTag || '').toLowerCase();
    const isOrig = /-orig$/i.test(raw);
    const clean = raw.replace(/-orig$/i, '');
    const base = getBaseLanguageCode(clean);
    const looksAutoGenerated = isManual === false || /\<\d{2}:\d{2}:\d{2}\.\d{3}\>\<c\>/i.test(rawContent);
    const manualBonus = isManual === true ? 45 : (looksAutoGenerated ? -20 : 15);
    const variantRankMap = { 'en-us': -1, 'en-gb': -2, 'en-kn': -6, 'es-419': -1, 'es-mx': -2, 'es-es': -3, 'ko-kr': -1, 'ja-jp': -1 };
    const exactIdx = preferredLangs.findIndex((p) => p.toLowerCase() === clean);
    const regionalPenalty = (isOrig ? -10 : 0) + (variantRankMap[clean] ?? (clean.includes('-') || clean.includes('_') ? -4 : 6));
    if (exactIdx !== -1) return 100 - exactIdx * 5 + manualBonus + regionalPenalty;

    const baseIdx = preferredLangs.findIndex((p) => getBaseLanguageCode(p) === base);
    if (baseIdx !== -1) return 80 - baseIdx * 5 + manualBonus + regionalPenalty;
    return 10 + manualBonus + regionalPenalty;
}

function buildSuggestedYtDlpCommand(videoId) {
    const cleanId = extractValidYouTubeVideoId(videoId) || 'VIDEO_ID';
    return `python sincronitation/yt_lyrics_helper.py "https://www.youtube.com/watch?v=${cleanId}" --clip`;
}

/**
 * Extract clean song lyrics from YouTube / YouTube Music subtitles exclusively via `yt-dlp`.
 * Never issues direct `fetch()` requests from the server IP to YouTube watch/timedtext pages,
 * preventing EC2 anti-bot blocks and delegating cleanly to `sincronizador.py` / `yt_lyrics_helper.py`.
 * Never caches subtitles on disk; deletes temporary files in `finally`.
 *
 * @param {object} opts
 * @returns {Promise<object>}
 */
async function extractSongLyrics({
    url = '',
    videoId = '',
    idioma = '',
    preferredLangs = null,
    ytdlpPath = '',
    fetchImpl: _fetchImpl = fetch,
    execFileImpl = childProcess.execFile,
    env = process.env,
    platform = process.platform,
    fsImpl = fs,
    useInnerTube = false,
    trackTitle = '',
    trackArtist = ''
} = {}) {
    const cleanId = extractValidYouTubeVideoId(videoId) || extractValidYouTubeVideoId(url);
    if (!cleanId) {
        return {
            ok: false,
            reason: 'invalid_video_id',
            error: 'Invalid or missing YouTube video ID.'
        };
    }

    // Cascade step 2: YouTube Music InnerTube (WEB_REMIX / MPLYt_) — best for audio-only Art Tracks.
    // Opt-in on the server (YTM_INNERTUBE=1 or useInnerTube) because EC2 IPs are often throttled;
    // always falls through cleanly to yt-dlp subtitles on any failure.
    const innerTubeEnabled = useInnerTube === true || String(env?.YTM_INNERTUBE || '').trim() === '1';
    if (innerTubeEnabled) {
        try {
            const yt = await fetchYouTubeMusicLyrics({
                videoId: cleanId,
                title: trackTitle,
                artist: trackArtist,
                fetchImpl: _fetchImpl,
                isAllowedUrl: isAllowedInnerTubeUrl
            });
            if (yt.ok && hasMeaningfulLyrics(yt.lyrics)) {
                const tracksFive = classifyLyricsIntoFiveTracks(
                    [{ rawLanguage: 'multi', lyrics: yt.lyrics, source: yt.source }],
                    { rawOriginal: yt.lyrics }
                );
                return {
                    ok: true,
                    videoId: cleanId,
                    lyrics: yt.lyrics,
                    language: 'multi',
                    source: yt.source,
                    ytdlpAvailable: null,
                    availableLangs: [],
                    tracks: tracksFive,
                    trackList: [{ language: 'original', lyrics: yt.lyrics, source: yt.source }],
                    suggestedCommand: buildSuggestedYtDlpCommand(cleanId)
                };
            }
        } catch (_) {
            // fall through to yt-dlp
        }
    }

    const langs = normalizePreferredLangs({ idioma, preferredLangs });
    const resolution = ytdlpPath
        ? { available: true, binPath: ytdlpPath, source: 'explicit', configuredValue: ytdlpPath, skippedCrossOs: false }
        : resolveYtDlpBinary({ env, platform, fsImpl });

    const watchUrl = buildCanonicalWatchUrl(cleanId);
    const suggestedCommand = buildSuggestedYtDlpCommand(cleanId);

    if (!resolution.available || !resolution.binPath) {
        return {
            ok: false,
            videoId: cleanId,
            reason: 'ytdlp_missing',
            error: 'yt-dlp no está disponible en este servidor EC2. Usa tu PC local (sincronizador.py / yt_lyrics_helper.py) para extraer la letra sin restricciones de IP.',
            ytdlpAvailable: false,
            ytdlpSource: resolution.source,
            availableLangs: [],
            suggestedCommand
        };
    }

    return runWithHeavyTaskLock(async () => {
        const tmpDir = await fsImpl.promises.mkdtemp(path.join(os.tmpdir(), 'pdh-lyrics-'));
        try {
            const subLangPattern = [...new Set([
                ...langs,
                'en', 'en-US', 'en-GB', 'ko', 'ko-KR', 'ja', 'ja-JP', 'es', 'es-419', 'es-MX', 'es-ES'
            ])].join(',');
            const outTemplate = path.join(tmpDir, '%(id)s.%(ext)s');
            const cookiesPath = String(env?.YTDLP_COOKIES_PATH || '').trim();
            const cookieArgs = cookiesPath && fsImpl.existsSync(cookiesPath) ? ['--cookies', cookiesPath] : [];

            const runAttempt = async (extraArgs = []) => {
                await runYtDlp(
                    resolution.binPath,
                    [
                        '--ignore-errors',
                        '--skip-download',
                        '--no-playlist',
                        '--no-warnings',
                        '--write-subs',
                        '--write-auto-subs',
                        '--sub-langs',
                        subLangPattern,
                        '--sub-format',
                        'vtt/srt/ttml/best',
                        ...cookieArgs,
                        ...extraArgs,
                        '--output',
                        outTemplate,
                        watchUrl
                    ],
                    { execFileImpl, timeoutMs: 20000, maxBuffer: 2 * 1024 * 1024, env }
                );
            };

            try {
                await runAttempt([]);
            } catch (firstErr) {
                const firstMsg = String(firstErr?.stderr || firstErr?.message || '');
                // Retry once with alternate YouTube player clients when web client is gated or throttled
                await runAttempt(['--extractor-args', 'youtube:player_client=tv,web_embedded']);
                void firstMsg;
            }

            let files = await fsImpl.promises.readdir(tmpDir);
            let subFiles = files.filter((f) => /\.(?:vtt|srt|lrc|ttml|xml)$/i.test(f));
            if (!subFiles.length) {
                try {
                    await runAttempt(['--extractor-args', 'youtube:player_client=tv,web_embedded,android_vr']);
                    files = await fsImpl.promises.readdir(tmpDir);
                    subFiles = files.filter((f) => /\.(?:vtt|srt|lrc|ttml|xml)$/i.test(f));
                } catch (_) {}
            }

            const parsedCandidates = [];
            const availableLangs = [];
            for (const fileName of subFiles) {
                const rawContent = await fsImpl.promises.readFile(path.join(tmpDir, fileName), 'utf8');
                const cleaned = cleanSubtitleText(rawContent);
                const stemParts = fileName.split('.');
                const langTag = stemParts.length >= 3 ? stemParts[stemParts.length - 2] : 'sub';
                availableLangs.push(langTag);
                if (!cleaned || !hasMeaningfulLyrics(cleaned)) continue;

                const extScore = fileName.endsWith('.vtt') ? 10 : fileName.endsWith('.srt') ? 8 : 4;
                const score = scoreLanguageTag(langTag, langs, { rawContent }) + extScore;
                parsedCandidates.push({
                    lyrics: cleaned,
                    language: langTag,
                    rawLanguage: langTag,
                    source: `yt-dlp:${langTag}`,
                    score
                });
            }

            const formatted = deduplicateAndFormatLyricTracks(parsedCandidates, 5, { preferredLangs: langs });
            if (formatted.combinedLyrics) {
                return {
                    ok: true,
                    videoId: cleanId,
                    lyrics: formatted.combinedLyrics,
                    language: formatted.combinedLanguage,
                    source: formatted.trackList.length === 1
                        ? formatted.trackList[0].source
                        : `yt-dlp:${formatted.combinedLanguage}`,
                    ytdlpAvailable: true,
                    ytdlpSource: resolution.source,
                    availableLangs: [...new Set(availableLangs)],
                    tracks: formatted.tracks,
                    trackList: formatted.trackList,
                    suggestedCommand
                };
            }

            return {
                ok: false,
                videoId: cleanId,
                reason: 'no_subtitles',
                error: 'yt-dlp se ejecutó correctamente en el servidor pero este video no expuso subtítulos descargables.',
                ytdlpAvailable: true,
                ytdlpSource: resolution.source,
                availableLangs: [...new Set(availableLangs)],
                suggestedCommand
            };
        } catch (err) {
            const msg = String(err?.stderr || err?.message || 'yt-dlp failed').trim();
            const botBlocked = /sign in to confirm you.?re not a bot|cookies|login required|429/i.test(msg);
            return {
                ok: false,
                videoId: cleanId,
                reason: botBlocked ? 'bot_check' : 'ytdlp_error',
                error: botBlocked
                    ? 'YouTube bloqueó la IP de AWS EC2 con verificación anti-bot. Tu PC local (sincronizador.py) extraerá la letra automáticamente sin este bloqueo.'
                    : `Error ejecutando yt-dlp: ${msg.split('\n')[0].slice(0, 200)}`,
                ytdlpAvailable: true,
                ytdlpSource: resolution.source,
                availableLangs: [],
                suggestedCommand
            };
        } finally {
            try {
                await fsImpl.promises.rm(tmpDir, { recursive: true, force: true });
            } catch (_) {
                // Best-effort cleanup in OS temp
            }
        }
    });
}

function setBoundedStreamCache(videoId, entry) {
    if (streamResolutionCache.has(videoId)) {
        streamResolutionCache.delete(videoId);
    }
    while (streamResolutionCache.size >= STREAM_CACHE_MAX_ENTRIES) {
        const oldestKey = streamResolutionCache.keys().next().value;
        if (!oldestKey) break;
        streamResolutionCache.delete(oldestKey);
    }
    streamResolutionCache.set(videoId, entry);
}

/**
 * Resolve a direct progressive MP4 or M4A YouTube CDN stream URL via `yt-dlp` so the
 * in-app `<video>` player can play tracks whose iframe embed is blocked by the label.
 *
 * @param {object} opts
 * @returns {Promise<object>}
 */
async function resolvePlayableMediaStream({
    url = '',
    videoId = '',
    ytdlpPath = '',
    forceRefresh = false,
    execFileImpl = childProcess.execFile,
    env = process.env,
    platform = process.platform,
    fsImpl = fs
} = {}) {
    const cleanId = extractValidYouTubeVideoId(videoId) || extractValidYouTubeVideoId(url);
    if (!cleanId) {
        return { ok: false, reason: 'invalid_video_id', error: 'Invalid YouTube video ID.' };
    }

    if (!forceRefresh) {
        const cached = streamResolutionCache.get(cleanId);
        if (cached && cached.expiresAt > Date.now()) {
            return { ...cached, cached: true };
        }
        if (cached) streamResolutionCache.delete(cleanId);
    } else {
        streamResolutionCache.delete(cleanId);
    }

    const resolution = ytdlpPath
        ? { available: true, binPath: ytdlpPath, source: 'explicit' }
        : resolveYtDlpBinary({ env, platform, fsImpl });

    if (!resolution.available || !resolution.binPath) {
        return {
            ok: false,
            reason: 'ytdlp_missing',
            error: 'yt-dlp binary is not available on this host to stream non-embeddable videos.'
        };
    }

    try {
        const watchUrl = buildCanonicalWatchUrl(cleanId);
        const { stdout } = await runWithHeavyTaskLock(() => runYtDlp(
            resolution.binPath,
            [
                '--no-playlist',
                '--no-warnings',
                '--skip-download',
                '--format',
                YTDLP_PROGRESSIVE_FORMAT,
                '--dump-single-json',
                watchUrl
            ],
            { execFileImpl, timeoutMs: 20000, maxBuffer: 2 * 1024 * 1024, env }
        ));

        const info = JSON.parse(String(stdout || '{}').trim() || '{}');
        const directUrl =
            String(info.url || '').trim() ||
            (Array.isArray(info.requested_formats) && info.requested_formats[0]?.url
                ? String(info.requested_formats[0].url).trim()
                : '');

        if (!directUrl || !isAllowedMediaCdnUrl(directUrl)) {
            return {
                ok: false,
                reason: 'no_direct_stream',
                error: 'yt-dlp did not return a direct progressive stream URL for this track.'
            };
        }

        const ext = String(info.ext || 'mp4').toLowerCase();
        const hasVideo = Boolean(info.vcodec && info.vcodec !== 'none');
        let contentType = 'video/mp4';
        if (ext === 'm4a' || (!hasVideo && ext === 'mp4')) {
            contentType = 'audio/mp4';
        } else if (ext === 'webm') {
            contentType = hasVideo ? 'video/webm' : 'audio/webm';
        }

        const ua = String(info.http_headers?.['User-Agent'] || DEFAULT_BROWSER_UA);
        const entry = {
            ok: true,
            videoId: cleanId,
            streamUrl: directUrl,
            contentType,
            hasVideo,
            title: String(info.title || '').slice(0, 180),
            duration: Number.isFinite(Number(info.duration)) ? Number(info.duration) : null,
            headers: {
                'User-Agent': ua
            },
            ytdlpSource: resolution.source,
            expiresAt: Date.now() + STREAM_CACHE_TTL_MS
        };

        setBoundedStreamCache(cleanId, entry);
        return entry;
    } catch (err) {
        const msg = String(err?.stderr || err?.message || 'Could not resolve stream').trim();
        const botBlocked = /sign in to confirm you.?re not a bot|cookies|login required/i.test(msg);
        return {
            ok: false,
            reason: botBlocked ? 'bot_check' : 'ytdlp_stream_error',
            error: botBlocked
                ? 'YouTube exigió verificación anti-bot en el servidor para reproducir directo. Usa Ventana flotante / Open on YouTube.'
                : `yt-dlp stream extraction failed: ${msg.split('\n')[0].slice(0, 220)}`
        };
    }
}

/**
 * Safe diagnostic status for `GET /api/english/music/ytdlp-status` without exposing filesystem secrets.
 * @param {object} [opts]
 * @returns {{ available: boolean, source: string, binaryName: string|null, jsRuntime: string, skippedWindowsVarOnLinux: boolean }}
 */
function getYtDlpStatus(opts = {}) {
    const resolved = resolveYtDlpBinary(opts);
    const binName = resolved.binPath ? path.basename(resolved.binPath) : null;
    return {
        available: resolved.available,
        source: resolved.source,
        binaryName: binName,
        jsRuntime: 'node',
        skippedWindowsVarOnLinux: Boolean(resolved.skippedCrossOs)
    };
}

function clearMediaStreamCacheForTest() {
    streamResolutionCache.clear();
}

module.exports = {
    runWithHeavyTaskLock,
    extractValidYouTubeVideoId,
    buildCanonicalWatchUrl,
    isAllowedMediaCdnUrl,
    isAllowedCaptionUrl,
    isAllowedInnerTubeUrl,
    resolveYtDlpBinary,
    cleanSubtitleText,
    isolateKoreanOnlyLyrics,
    isolateJapaneseLyrics,
    classifyLyricsIntoFiveTracks,
    deduplicateAndFormatLyricTracks,
    parseWatchPageCaptionTracks,
    runYtDlp,
    extractSongLyrics,
    resolvePlayableMediaStream,
    getYtDlpStatus,
    clearMediaStreamCacheForTest
};
