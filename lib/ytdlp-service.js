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
let _heavyTaskActive = false;
const _heavyTaskWaiters = [];

/**
 * Serialize heavy subprocess or memory-intensive tasks (maxConcurrency = 1).
 * @template T
 * @param {() => Promise<T>} taskFn
 * @returns {Promise<T>}
 */
async function runWithHeavyTaskLock(taskFn) {
    if (_heavyTaskActive) {
        await new Promise((resolve) => _heavyTaskWaiters.push(resolve));
    }
    _heavyTaskActive = true;
    try {
        return await taskFn();
    } finally {
        _heavyTaskActive = false;
        const nextWake = _heavyTaskWaiters.shift();
        if (nextWake) nextWake();
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
    // Ensure XML timedtext / TTML cues and inline <br>/\N break cleanly across lines before cleaning
    const withBreaks = str
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/\\N/g, '\n');
    const prepared = /<(?:transcript|timedtext|tt[\s>]|text[\s>]|p[\s>]|div[\s>])/i.test(withBreaks)
        ? withBreaks.replace(/<\/(?:text|p|div)>/gi, '\n')
        : withBreaks;
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

const STRUCTURAL_TAG_CLIENT_RE = /^\s*\[(?:intro|verse(?:\s*\d+)?|pre-?chorus|post-?chorus|chorus|refrain|bridge|rap(?:\s*part)?|interlude|outro|hook|solo|breakdown|instrumental|coro|verso(?:\s*\d+)?|estrofa(?:\s*\d+)?|puente|estribillo|final)(?:\s+[^\]]*|\s*\d*)?\]\s*$/i;
const LANG_SECTION_HEADER_RE = /^(?:===\s*\[([^\]]+)\]\s*===|\[((?:ORIGINAL|ORIG|FULL|MULTI|MIX|WORD|KO|KR|EN|JA|JP|JP-EN|EN-JP|ES|SUB|UND)(?:[-_][A-Za-z0-9]+)*(?:\s*[—\-]\s*[^\]]*)?)\])$/i;
const NOISE_LYRIC_LINE_RE = /^\[(?:음악|박수|音楽|歌|music|applause|laughter|cheering|instrumental|singing|música|aplausos|risas)\]$/i;
const SPANISH_LEXICAL_CUE_RE = /\b(?:que|para|pero|una|unas|unos|los|las|del|estoy|estás|estas|quiero|quieres|siempre|noche|dime|tengo|puedo|nada|cuando|eres|porque|contigo|conmigo|corazón|corazon|también|tambien|aquí|aqui)\b/i;

function isStructuralLyricTag(line) {
    return STRUCTURAL_TAG_CLIENT_RE.test(String(line || ''));
}

function isRomanizationBracketLine(line) {
    const t = String(line || '').trim();
    if (!t.startsWith('[') || !t.endsWith(']')) return false;
    if (isStructuralLyricTag(t) || LANG_SECTION_HEADER_RE.test(t) || NOISE_LYRIC_LINE_RE.test(t)) return false;
    return /^\s*\[[a-z][a-z0-9\s,'’.\-?!~()]{1,140}\]\s*$/.test(t);
}

function isLikelySpanishLine(line) {
    const t = String(line || '').trim();
    if (!t || hasHangulScript(t) || hasJapaneseScript(t)) return false;
    if (/[áéíóúüñ¿¡]/i.test(t)) return true;
    return SPANISH_LEXICAL_CUE_RE.test(t);
}

function isPredominantlySpanishText(text) {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !LANG_SECTION_HEADER_RE.test(l) && !isStructuralLyricTag(l) && /[A-Za-záéíóúüñ]/i.test(l));
    if (!lines.length || hasHangulScript(text) || hasJapaneseScript(text)) return false;
    const esCount = lines.filter((l) => isLikelySpanishLine(l)).length;
    return (esCount >= 2 && esCount / lines.length >= 0.3) || (lines.length === 1 && esCount === 1);
}

function mapSectionTagToKey(rawTag) {
    const upper = String(rawTag || '').trim().toUpperCase();
    if (!upper) return '';
    if (upper === 'WORD') return '__ignore__';
    if (
        upper.startsWith('ORIGINAL') || upper.startsWith('ORIG') || upper.startsWith('FULL')
        || upper.startsWith('MULTI') || upper.startsWith('MIX')
        || /(?:EN[-_\s/&]+(?:KO|KR|JA|JP)|(?:KO|KR|JA|JP)[-_\s/&]+EN)/.test(upper)
    ) {
        return 'original';
    }
    if (upper.startsWith('KO') || upper.startsWith('KR') || upper.includes('COREANO') || upper.includes('KOREAN')) {
        return 'ko';
    }
    if (upper.startsWith('JA') || upper.startsWith('JP') || upper.includes('JAPON')) {
        return 'ja';
    }
    if (upper.startsWith('ES') || upper.includes('ESPAÑOL') || upper.includes('ESPANOL') || upper.includes('SPANISH') || upper.includes('TRADUCCI')) {
        return 'es';
    }
    if (upper.startsWith('EN') || upper.includes('INGL') || upper.includes('ENGLISH')) {
        return 'en';
    }
    return '';
}

function parseTaggedLyricsSections(rawText) {
    const clean = String(rawText || '').replace(/\r\n?/g, '\n').trim();
    const empty = { hasTags: false, original: '', ko: '', en: '', ja: '', es: '' };
    if (!clean) return empty;

    const buckets = { original: [], ko: [], en: [], ja: [], es: [] };
    let currentKey = 'original';
    let hasTags = false;

    for (const rawLine of clean.split('\n')) {
        const trimmed = rawLine.trim();
        const headerMatch = trimmed.match(LANG_SECTION_HEADER_RE);
        if (headerMatch) {
            const mapped = mapSectionTagToKey(headerMatch[1] || headerMatch[2]);
            if (mapped === '__ignore__') {
                hasTags = true;
                continue;
            }
            if (mapped) {
                hasTags = true;
                currentKey = mapped;
                continue;
            }
        }
        buckets[currentKey].push(rawLine.trimEnd());
    }

    const trimLines = (arr) => arr.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return {
        hasTags,
        original: trimLines(buckets.original),
        ko: trimLines(buckets.ko),
        en: trimLines(buckets.en),
        ja: trimLines(buckets.ja),
        es: trimLines(buckets.es)
    };
}

function stripLanguageHeaderLines(text) {
    const clean = String(text || '').replace(/\r\n?/g, '\n');
    const kept = [];
    for (const rawLine of clean.split('\n')) {
        const trimmed = rawLine.trim();
        if (LANG_SECTION_HEADER_RE.test(trimmed) || NOISE_LYRIC_LINE_RE.test(trimmed)) continue;
        kept.push(rawLine.trimEnd());
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripStandaloneLatinFromCjkLine(line) {
    let s = String(line || '');
    // 1. Quitar ad-libs puramente latinos entre paréntesis, corchetes o comillas dobles (incl. puntuación pegada)
    s = s
        .replace(/\s*\([^()\r\n\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]*[A-Za-z][^()\r\n\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]*\)(?:[.,!?;:]+)?/g, ' ')
        .replace(/\s*\[[^\[\]\r\n\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]*[A-Za-z][^\[\]\r\n\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]*\](?:[.,!?;:]+)?/g, ' ')
        .replace(/\s*["“][^"”\r\n\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]*[A-Za-z][^"”\r\n\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]*["”](?:[.,!?;:]+)?/g, ' ');
    // 2. Quitar tokens latinos iterativamente (con contracciones, guiones y puntuación pegada) preservando CJK y su puntuación propia
    const latinTokenRe = /(^|[\s(\[{"'“‘¿¡,;/|·–—-\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF])[A-Za-z][A-Za-z'’\-]*(?:[.,!?;:]*)(?=$|[\s)\]}"'”’,;/|·–—-\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF])/g;
    let prev;
    do {
        prev = s;
        s = s.replace(latinTokenRe, '$1 ');
    } while (prev !== s);
    // 3. Limpiar paréntesis vacíos, comillas huérfanas, espacios antes de puntuación y separadores sobrantes
    return s
        .replace(/[\(\[]\s*[,.\-?!;:/|·]*\s*[\)\]]/g, ' ')
        .replace(/([(\[])\s*[,;:\s]+/g, '$1')
        .replace(/\s+\)/g, ')')
        .replace(/[,;:]\s*([)\]])/g, '$1')
        .replace(/(?:^|\s)["'“‘”’]+(?=\s|$)/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/([,;])\s*([,;])+/g, '$1')
        .replace(/\s+/g, ' ')
        .replace(/^[\s/|·,;:–—-]+|[\s/|·,;:–—-]+$/g, '')
        .trim();
}

function isolateKoreanOnlyLyrics(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const kept = [];
    let pendingBreak = false;
    for (const rawLine of lines) {
        let line = rawLine.trim();
        if (!line) {
            if (kept.length) pendingBreak = true;
            continue;
        }
        if (LANG_SECTION_HEADER_RE.test(line) || NOISE_LYRIC_LINE_RE.test(line) || isRomanizationBracketLine(line)) continue;
        const arrowIdx = line.indexOf(' → ');
        if (arrowIdx > 0) line = line.slice(0, arrowIdx).trim();
        if (!hasHangulScript(line)) continue;
        line = stripStandaloneLatinFromCjkLine(line);
        if (!hasHangulScript(line)) continue;
        if (pendingBreak && kept.length && kept[kept.length - 1] !== '') kept.push('');
        pendingBreak = false;
        const lastNonEmpty = [...kept].reverse().find((l) => l !== '');
        if (lastNonEmpty !== line) kept.push(line);
    }
    while (kept.length && kept[kept.length - 1] === '') kept.pop();
    return segmentLyricsIntoStanzas(kept.join('\n').trim());
}

function isolateJapaneseLyrics(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const kept = [];
    let pendingBreak = false;
    for (const rawLine of lines) {
        let line = rawLine.trim();
        if (!line) {
            if (kept.length) pendingBreak = true;
            continue;
        }
        if (LANG_SECTION_HEADER_RE.test(line) || NOISE_LYRIC_LINE_RE.test(line) || isRomanizationBracketLine(line)) continue;
        const arrowIdx = line.indexOf(' → ');
        if (arrowIdx > 0) line = line.slice(0, arrowIdx).trim();
        if (!hasJapaneseScript(line) || hasHangulScript(line)) continue;
        line = stripStandaloneLatinFromCjkLine(line);
        if (!hasJapaneseScript(line)) continue;
        if (pendingBreak && kept.length && kept[kept.length - 1] !== '') kept.push('');
        pendingBreak = false;
        const lastNonEmpty = [...kept].reverse().find((l) => l !== '');
        if (lastNonEmpty !== line) kept.push(line);
    }
    while (kept.length && kept[kept.length - 1] === '') kept.pop();
    return segmentLyricsIntoStanzas(kept.join('\n').trim());
}

function isolateEnglishOnlyLyrics(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const kept = [];
    let pendingBreak = false;
    let pendingTag = '';
    for (const rawLine of lines) {
        let line = rawLine.trim();
        if (!line) {
            if (kept.length) pendingBreak = true;
            continue;
        }
        if (LANG_SECTION_HEADER_RE.test(line) || NOISE_LYRIC_LINE_RE.test(line) || isRomanizationBracketLine(line)) continue;
        const arrowIdx = line.indexOf(' → ');
        if (arrowIdx > 0) line = line.slice(0, arrowIdx).trim();
        if (!line) continue;

        if (isStructuralLyricTag(line)) {
            pendingTag = line;
            continue;
        }

        if (hasHangulScript(line) || hasJapaneseScript(line)) {
            const asciiChunk = line
                .replace(/[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]+/g, ' ')
                .replace(/\s+/g, ' ')
                .replace(/^[\s/|·,–—-]+|[\s/|·,–—-]+$/g, '')
                .trim();
            if (!/[A-Za-z]{2,}\s+[A-Za-z'’]{1,}/.test(asciiChunk) || isLikelySpanishLine(asciiChunk)) {
                continue;
            }
            line = asciiChunk;
        } else {
            if (!/[A-Za-z]/.test(line) || isLikelySpanishLine(line)) continue;
        }

        if (pendingBreak && kept.length && kept[kept.length - 1] !== '') kept.push('');
        pendingBreak = false;
        if (pendingTag) {
            const lastNonEmpty = [...kept].reverse().find((l) => l !== '');
            if (lastNonEmpty !== pendingTag) kept.push(pendingTag);
            pendingTag = '';
        }
        const lastNonEmpty = [...kept].reverse().find((l) => l !== '');
        if (lastNonEmpty !== line) kept.push(line);
    }
    while (kept.length && kept[kept.length - 1] === '') kept.pop();
    return segmentLyricsIntoStanzas(kept.join('\n').trim());
}

function normalizePreferredLangs({ idioma, preferredLangs } = {}) {
    if (Array.isArray(preferredLangs) && preferredLangs.length > 0) {
        return preferredLangs.map((l) => String(l || '').trim()).filter(Boolean);
    }
    const langLower = String(idioma || '').trim().toLowerCase();
    if (!langLower) return ['en', 'ko', 'es', 'ja'];
    if (
        /(?:^|[\s_\-/])(ko|kr|kpop|k-pop|korean|coreano)(?:$|[\s_\-/])|한국어/i.test(langLower)
        || langLower.includes('korean')
        || langLower.includes('coreano')
        || langLower.includes('kpop')
        || langLower.includes('k-pop')
    ) {
        return ['ko', 'en', 'es', 'ja'];
    }
    if (
        /(?:^|[\s_\-/])(ja|jp|jpop|j-pop|japanese|japon[eé]s)(?:$|[\s_\-/])|日本語/i.test(langLower)
        || langLower.includes('japanese')
        || langLower.includes('japonés')
        || langLower.includes('japones')
        || langLower.includes('jpop')
        || langLower.includes('j-pop')
    ) {
        return ['ja', 'en', 'ko', 'es'];
    }
    if (
        /(?:^|[\s_\-/])(es|spanish|espa[nñ]ol)(?:$|[\s_\-/])/i.test(langLower)
        || langLower.includes('spanish')
        || langLower.includes('español')
        || langLower.includes('espanol')
    ) {
        return ['es', 'en', 'ko', 'ja'];
    }
    return ['en', 'ko', 'es', 'ja'];
}

const LANG_ALIAS_MAP = { kr: 'ko', jp: 'ja' };
const COMPOUND_BILINGUAL_LANG_RE = /^(?:en[-_](?:ko|kr|ja|jp)|(?:ko|kr|ja|jp)[-_]en)$/;

function getBaseLanguageCode(langTag) {
    const clean = String(langTag || '').trim().toLowerCase().replace(/-orig$/i, '');
    if (!clean) return '';
    if (COMPOUND_BILINGUAL_LANG_RE.test(clean)) return 'original';
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

function normalizeComparableLyrics(txt) {
    return String(txt || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((l) => l.trim().replace(/\s+/g, ' ').toLowerCase())
        .filter(Boolean)
        .join('\n');
}

function classifyLyricsIntoFiveTracks(chosenList = [], { preferredLangs = ['ko', 'en', 'es', 'ja'], rawOriginal = '' } = {}) {
    const byLang = {};
    let parsedOriginal = '';

    const absorbTaggedOrPlain = (rawBody, fallbackKey = '') => {
        const parsed = parseTaggedLyricsSections(rawBody);
        if (parsed.hasTags) {
            if (parsed.original && !parsedOriginal) parsedOriginal = parsed.original;
            for (const k of ['ko', 'en', 'ja', 'es']) {
                if (parsed[k] && !byLang[k]) byLang[k] = parsed[k];
            }
            return;
        }
        const stripped = stripLanguageHeaderLines(rawBody);
        if (!stripped) return;
        if (['ko', 'en', 'ja', 'es'].includes(fallbackKey)) {
            if (!byLang[fallbackKey]) byLang[fallbackKey] = stripped;
        } else {
            if (!parsedOriginal) parsedOriginal = stripped;
        }
    };

    if (rawOriginal) {
        absorbTaggedOrPlain(rawOriginal, 'original');
    }
    for (const item of chosenList) {
        const txt = String(item?.lyrics || '').trim();
        if (!txt) continue;
        const base = getBaseLanguageCode(item.rawLanguage || item.language);
        absorbTaggedOrPlain(txt, base || 'original');
    }

    const koRaw = byLang.ko || '';
    const enRaw = byLang.en || '';
    const jaRaw = byLang.ja || '';
    const esRaw = byLang.es || '';

    const enRawHasCjk = Boolean(enRaw && (hasHangulScript(enRaw) || hasJapaneseScript(enRaw)));
    let origCandidate = parsedOriginal;
    if (!origCandidate) {
        const koHasMixedLatin = Boolean(koRaw && hasHangulScript(koRaw) && /[A-Za-z]{2,}/.test(stripLanguageHeaderLines(koRaw)));
        const jaHasMixedLatin = Boolean(jaRaw && hasJapaneseScript(jaRaw) && /[A-Za-z]{2,}/.test(stripLanguageHeaderLines(jaRaw)));
        if (koHasMixedLatin) {
            origCandidate = koRaw;
        } else if (jaHasMixedLatin) {
            origCandidate = jaRaw;
        } else if (enRawHasCjk) {
            origCandidate = enRaw;
        } else {
            for (const pref of preferredLangs) {
                const b = getBaseLanguageCode(pref);
                if (b && byLang[b]) {
                    origCandidate = byLang[b];
                    break;
                }
            }
            if (!origCandidate) {
                origCandidate = koRaw || enRaw || jaRaw || esRaw || '';
            }
        }
    }

    const koSource = koRaw || (hasHangulScript(origCandidate) ? origCandidate : (enRawHasCjk && hasHangulScript(enRaw) ? enRaw : ''));
    const koOnly = isolateKoreanOnlyLyrics(koSource);

    const jaSource = jaRaw || (hasJapaneseScript(origCandidate) ? origCandidate : (enRawHasCjk && hasJapaneseScript(enRaw) ? enRaw : ''));
    const jaClean = jaSource ? isolateJapaneseLyrics(jaSource) : '';

    let esClean = esRaw ? segmentLyricsIntoStanzas(stripLanguageHeaderLines(esRaw)) : '';
    if (!esClean && !koRaw && !jaRaw && !enRaw && isPredominantlySpanishText(origCandidate)) {
        esClean = segmentLyricsIntoStanzas(stripLanguageHeaderLines(origCandidate));
    }

    let enClean = '';
    if (enRaw && !enRawHasCjk) {
        enClean = segmentLyricsIntoStanzas(stripLanguageHeaderLines(enRaw));
    } else if (enRaw && enRawHasCjk) {
        enClean = isolateEnglishOnlyLyrics(enRaw);
    } else if (origCandidate && !isPredominantlySpanishText(origCandidate)) {
        enClean = isolateEnglishOnlyLyrics(origCandidate);
    }

    const origSeg = segmentLyricsIntoStanzas(stripLanguageHeaderLines(origCandidate));
    const normOrig = normalizeComparableLyrics(origSeg);
    const hasBothKoEn = Boolean(hasHangulScript(origSeg) && /[A-Za-z]{2,}/.test(origSeg) && isolateEnglishOnlyLyrics(origSeg));
    const hasBothJaEn = Boolean(hasJapaneseScript(origSeg) && /[A-Za-z]{2,}/.test(origSeg) && isolateEnglishOnlyLyrics(origSeg));
    const hasBothKoJa = Boolean(hasHangulScript(origSeg) && hasJapaneseScript(origSeg));
    const matchesSinglePure = Boolean(
        normOrig
        && (
            normOrig === normalizeComparableLyrics(koOnly)
            || normOrig === normalizeComparableLyrics(enClean)
            || normOrig === normalizeComparableLyrics(jaClean)
            || normOrig === normalizeComparableLyrics(esClean)
        )
    );
    const originalOut = origSeg && (hasBothKoEn || hasBothJaEn || hasBothKoJa || !matchesSinglePure)
        ? origSeg
        : '';

    return {
        original: originalOut,
        ko: koOnly,
        en: enClean,
        ja: jaClean,
        es: esClean
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
            || (baseLang === 'en' && chosen.some((e) => hasHangulScript(e.lyrics) || hasJapaneseScript(e.lyrics)))
            || baseLang === 'es';
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
        && normalizeComparableLyrics(structured.original) !== normalizeComparableLyrics(structured.ko)
        && normalizeComparableLyrics(structured.original) !== normalizeComparableLyrics(structured.en)
        && normalizeComparableLyrics(structured.original) !== normalizeComparableLyrics(structured.ja)
    ) {
        orderedSections.push({ key: 'original', tag: 'ORIGINAL', lyrics: structured.original });
    }
    if (structured.ko) orderedSections.push({ key: 'ko', tag: 'KO', lyrics: structured.ko });
    if (structured.en) orderedSections.push({ key: 'en', tag: 'EN', lyrics: structured.en });
    if (structured.ja) orderedSections.push({ key: 'ja', tag: 'JA', lyrics: structured.ja });
    if (structured.es) orderedSections.push({ key: 'es', tag: 'ES', lyrics: structured.es });

    const presentKeys = ['original', 'ko', 'en', 'ja', 'es'].filter((k) => Boolean(structured[k]));
    if (chosen.length === 1 && orderedSections.length <= 1) {
        const singleBody = orderedSections[0]?.lyrics || chosen[0].lyrics;
        return {
            tracks: structured,
            trackList: chosen,
            combinedLyrics: singleBody,
            combinedLanguage: chosen[0].rawLanguage || chosen[0].language || presentKeys[0] || '',
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
async function fetchSubtitlesViaYtDlp({
    cleanId,
    langs,
    binPath,
    execFileImpl,
    env,
    fsImpl,
    budgetDeadlineAt = 0
}) {
    const watchUrl = buildCanonicalWatchUrl(cleanId);
    return runWithHeavyTaskLock(async () => {
        const tmpDir = await fsImpl.promises.mkdtemp(path.join(os.tmpdir(), 'pdh-lyrics-'));
        try {
            const subLangPattern = [...new Set([
                ...langs,
                'en', 'en-US', 'en-GB', 'en-.*',
                'ko', 'ko-KR', 'ko-.*',
                'ja', 'ja-JP', 'ja-.*',
                'es', 'es-419', 'es-MX', 'es-ES', 'es-US', 'es-.*'
            ])].join(',');
            const outTemplate = path.join(tmpDir, '%(id)s.%(ext)s');
            const cookiesPath = String(env?.YTDLP_COOKIES_PATH || '').trim();
            const cookieArgs = cookiesPath && fsImpl.existsSync(cookiesPath) ? ['--cookies', cookiesPath] : [];

            const runAttempt = async (extraArgs = []) => {
                let attemptTimeoutMs = 20000;
                if (budgetDeadlineAt) {
                    const remainingMs = budgetDeadlineAt - Date.now();
                    if (remainingMs < 3000) {
                        throw new Error('yt-dlp time budget exhausted');
                    }
                    attemptTimeoutMs = Math.min(attemptTimeoutMs, remainingMs);
                }
                await runYtDlp(
                    binPath,
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
                    { execFileImpl, timeoutMs: attemptTimeoutMs, maxBuffer: 2 * 1024 * 1024, env }
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

            return { ok: true, parsedCandidates, availableLangs: [...new Set(availableLangs)] };
        } finally {
            try {
                await fsImpl.promises.rm(tmpDir, { recursive: true, force: true });
            } catch (_) {
                // Best-effort cleanup in OS temp
            }
        }
    });
}

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
    enrichCaptions = false,
    trackTitle = '',
    trackArtist = '',
    budgetMs = 0
} = {}) {
    const cleanId = extractValidYouTubeVideoId(videoId) || extractValidYouTubeVideoId(url);
    if (!cleanId) {
        return {
            ok: false,
            reason: 'invalid_video_id',
            error: 'Invalid or missing YouTube video ID.'
        };
    }

    const langs = normalizePreferredLangs({ idioma, preferredLangs });
    const resolution = ytdlpPath
        ? { available: true, binPath: ytdlpPath, source: 'explicit', configuredValue: ytdlpPath, skippedCrossOs: false }
        : resolveYtDlpBinary({ env, platform, fsImpl });
    const suggestedCommand = buildSuggestedYtDlpCommand(cleanId);
    const budgetDeadlineAt = budgetMs > 0 ? Date.now() + budgetMs : 0;

    // Cascade step 2: YouTube Music InnerTube (WEB_REMIX / MPLYt_) — best for audio-only Art Tracks.
    // Opt-in on the server (YTM_INNERTUBE=1 or useInnerTube); when enrichCaptions is enabled and
    // yt-dlp is available with remaining budget, also harvests official YouTube es/en captions (0 AI tokens).
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
                const innerFormatted = deduplicateAndFormatLyricTracks(
                    [{ rawLanguage: 'multi', lyrics: yt.lyrics, source: yt.source, score: 100 }],
                    5,
                    { preferredLangs: langs, rawOriginal: yt.lyrics }
                );
                const remainingBudget = budgetDeadlineAt ? budgetDeadlineAt - Date.now() : 20000;
                if (enrichCaptions && !innerFormatted.tracks.es && resolution.available && resolution.binPath && remainingBudget >= 6500) {
                    try {
                        const capRes = await fetchSubtitlesViaYtDlp({
                            cleanId,
                            langs,
                            binPath: resolution.binPath,
                            execFileImpl,
                            env,
                            fsImpl,
                            budgetDeadlineAt
                        });
                        if (capRes.parsedCandidates.length > 0) {
                            const merged = deduplicateAndFormatLyricTracks(
                                capRes.parsedCandidates,
                                5,
                                { preferredLangs: langs, rawOriginal: yt.lyrics }
                            );
                            if (merged.combinedLyrics) {
                                const mergedSources = [...new Set([yt.source, ...merged.trackList.map((t) => t.source)])].filter(Boolean);
                                return {
                                    ok: true,
                                    videoId: cleanId,
                                    lyrics: merged.combinedLyrics,
                                    language: merged.combinedLanguage || 'multi',
                                    source: mergedSources.join('+'),
                                    ytdlpAvailable: true,
                                    ytdlpSource: resolution.source,
                                    availableLangs: capRes.availableLangs,
                                    tracks: merged.tracks,
                                    trackList: merged.trackList,
                                    suggestedCommand
                                };
                            }
                        }
                    } catch (_) {
                        // InnerTube already succeeded; ignore optional caption-enrichment errors
                    }
                }
                return {
                    ok: true,
                    videoId: cleanId,
                    lyrics: enrichCaptions ? (innerFormatted.combinedLyrics || yt.lyrics) : yt.lyrics,
                    language: innerFormatted.combinedLanguage || 'multi',
                    source: yt.source,
                    ytdlpAvailable: enrichCaptions ? resolution.available : null,
                    availableLangs: [],
                    tracks: innerFormatted.tracks,
                    trackList: [{ language: 'original', lyrics: yt.lyrics, source: yt.source }],
                    suggestedCommand
                };
            }
        } catch (_) {
            // fall through to yt-dlp
        }
    }

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

    try {
        const capRes = await fetchSubtitlesViaYtDlp({
            cleanId,
            langs,
            binPath: resolution.binPath,
            execFileImpl,
            env,
            fsImpl,
            budgetDeadlineAt
        });
        const formatted = deduplicateAndFormatLyricTracks(capRes.parsedCandidates, 5, { preferredLangs: langs });
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
                availableLangs: capRes.availableLangs,
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
            availableLangs: capRes.availableLangs,
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
    }
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
        const cookiesPath = String(env?.YTDLP_COOKIES_PATH || '').trim();
        const cookieArgs = cookiesPath && fsImpl.existsSync(cookiesPath) ? ['--cookies', cookiesPath] : [];
        const { stdout } = await runWithHeavyTaskLock(() => runYtDlp(
            resolution.binPath,
            [
                '--no-playlist',
                '--no-warnings',
                '--skip-download',
                '--format',
                YTDLP_PROGRESSIVE_FORMAT,
                ...cookieArgs,
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
    parseTaggedLyricsSections,
    stripLanguageHeaderLines,
    stripStandaloneLatinFromCjkLine,
    normalizePreferredLangs,
    getBaseLanguageCode,
    mapSectionTagToKey,
    isolateKoreanOnlyLyrics,
    isolateJapaneseLyrics,
    isolateEnglishOnlyLyrics,
    classifyLyricsIntoFiveTracks,
    deduplicateAndFormatLyricTracks,
    parseWatchPageCaptionTracks,
    runYtDlp,
    extractSongLyrics,
    resolvePlayableMediaStream,
    getYtDlpStatus,
    clearMediaStreamCacheForTest
};
