'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { cleanCaptionTextToLyrics } = require('./youtube-metadata');

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const STREAM_CACHE_MAX_ENTRIES = 16;
const STREAM_CACHE_TTL_MS = 25 * 60 * 1000;
const YTDLP_PROGRESSIVE_FORMAT =
    '18/best[ext=mp4][vcodec!=none][acodec!=none][height<=480]/best[ext=mp4][vcodec!=none][acodec!=none]/bestaudio[ext=m4a]/bestaudio/best';

const DEFAULT_BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const streamResolutionCache = new Map();

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
    { execFileImpl = childProcess.execFile, timeoutMs = 22000, maxBuffer = 8 * 1024 * 1024, env = process.env } = {}
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
        return ['ja', 'en', 'es', 'ko'];
    }
    return ['en', 'ko', 'es', 'ja'];
}

function getBaseLanguageCode(langTag) {
    const clean = String(langTag || '').trim().toLowerCase().replace(/-orig$/i, '');
    if (!clean) return '';
    return clean.split(/[-_]/)[0];
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

function deduplicateAndFormatLyricTracks(candidates, maxTracks = 4) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return { tracks: [], combinedLyrics: '', combinedLanguage: '', primarySource: '' };
    }

    const sorted = [...candidates].sort((a, b) => (b.score || 0) - (a.score || 0));
    const chosen = [];
    const seenBaseLangs = new Set();

    for (const cand of sorted) {
        const cleanLyrics = String(cand?.lyrics || '').trim();
        if (!cleanLyrics) continue;
        const baseLang = getBaseLanguageCode(cand.language);
        if (baseLang && seenBaseLangs.has(baseLang)) continue;
        if (chosen.some((existing) => areLyricTracksRedundant(existing.lyrics, cleanLyrics))) continue;

        if (baseLang) seenBaseLangs.add(baseLang);
        chosen.push({
            ...cand,
            language: baseLang || String(cand.language || 'sub').toLowerCase(),
            lyrics: cleanLyrics
        });
        if (chosen.length >= maxTracks) break;
    }

    if (!chosen.length) {
        return { tracks: [], combinedLyrics: '', combinedLanguage: '', primarySource: '' };
    }
    if (chosen.length === 1) {
        return {
            tracks: chosen,
            combinedLyrics: chosen[0].lyrics,
            combinedLanguage: chosen[0].rawLanguage || chosen[0].language,
            primarySource: chosen[0].source
        };
    }

    const combinedLyrics = chosen
        .map((t) => `[${String(t.language || 'SUB').toUpperCase()}]\n${t.lyrics}`)
        .join('\n\n');
    return {
        tracks: chosen,
        combinedLyrics,
        combinedLanguage: chosen.map((t) => t.language).join(','),
        primarySource: chosen.map((t) => t.source).filter(Boolean).join('+')
    };
}

function scoreLanguageTag(langTag, preferredLangs) {
    const raw = String(langTag || '').toLowerCase();
    const isOrig = /-orig$/i.test(raw);
    const clean = raw.replace(/-orig$/i, '');
    const exactIdx = preferredLangs.findIndex((p) => p.toLowerCase() === clean);
    const regionalPenalty = (isOrig ? -8 : 0) + (clean.includes('-') || clean.includes('_') ? -3 : 4);
    if (exactIdx !== -1) return 100 - exactIdx * 5 + regionalPenalty;

    const base = getBaseLanguageCode(clean);
    const baseIdx = preferredLangs.findIndex((p) => getBaseLanguageCode(p) === base);
    if (baseIdx !== -1) return 75 - baseIdx * 5 + regionalPenalty;
    return 10 + regionalPenalty;
}

function buildSuggestedYtDlpCommand(videoId) {
    const cleanId = extractValidYouTubeVideoId(videoId) || 'VIDEO_ID';
    return `python sincronitation/yt_lyrics_helper.py "https://www.youtube.com/watch?v=${cleanId}" --clip`;
}

async function fetchCaptionTrackFallback({
    videoId,
    preferredLangs,
    fetchImpl = fetch,
    timeoutMs = 7000
}) {
    const watchUrl = `${buildCanonicalWatchUrl(videoId)}&hl=en`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let html = '';
    try {
        const resp = await fetchImpl(watchUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': DEFAULT_BROWSER_UA,
                'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8'
            }
        });
        if (!resp || !resp.ok) return { ok: false, reason: 'watch_fetch_failed' };
        html = await resp.text();
    } catch (err) {
        return { ok: false, reason: 'watch_fetch_error', error: err.message };
    } finally {
        clearTimeout(timer);
    }

    const tracks = parseWatchPageCaptionTracks(html);
    if (!tracks.length) {
        return { ok: false, reason: 'no_caption_tracks', availableLangs: [] };
    }

    const ranked = tracks
        .map((t) => ({
            ...t,
            baseLang: getBaseLanguageCode(t.languageCode),
            score: scoreLanguageTag(t.languageCode, preferredLangs) + (t.isAutoGenerated ? 0 : 40)
        }))
        .sort((a, b) => b.score - a.score);

    const availableLangs = [...new Set(tracks.map((t) => t.languageCode).filter(Boolean))];
    const pickedByBase = [];
    const seenPickBases = new Set();
    for (const t of ranked) {
        if (t.baseLang && seenPickBases.has(t.baseLang)) continue;
        if (t.baseLang) seenPickBases.add(t.baseLang);
        pickedByBase.push(t);
        if (pickedByBase.length >= 4) break;
    }

    const fetchedCandidates = [];
    for (const track of pickedByBase) {
        const trackUrl = track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=vtt`;
        if (!isAllowedCaptionUrl(trackUrl)) continue;
        const c2 = new AbortController();
        const t2 = setTimeout(() => c2.abort(), 5000);
        try {
            const capResp = await fetchImpl(trackUrl, {
                signal: c2.signal,
                headers: { 'User-Agent': DEFAULT_BROWSER_UA }
            });
            if (!capResp || !capResp.ok) continue;
            const rawCap = await capResp.text();
            const cleaned = cleanSubtitleText(rawCap);
            if (cleaned && hasMeaningfulLyrics(cleaned)) {
                fetchedCandidates.push({
                    lyrics: cleaned,
                    language: track.languageCode || 'en',
                    rawLanguage: track.languageCode || 'en',
                    isAutoGenerated: track.isAutoGenerated,
                    source: track.isAutoGenerated ? 'youtube-auto-captions' : 'youtube-captions',
                    score: track.score
                });
            }
        } catch (_) {
            // Try next candidate track
        } finally {
            clearTimeout(t2);
        }
    }

    if (fetchedCandidates.length > 0) {
        const formatted = deduplicateAndFormatLyricTracks(fetchedCandidates, 4);
        if (formatted.combinedLyrics) {
            return {
                ok: true,
                lyrics: formatted.combinedLyrics,
                language: formatted.combinedLanguage,
                isAutoGenerated: formatted.tracks.every((t) => t.isAutoGenerated),
                source: formatted.tracks.length === 1 ? formatted.tracks[0].source : 'youtube-captions',
                availableLangs,
                tracks: formatted.tracks
            };
        }
    }

    return { ok: false, reason: 'empty_caption_tracks', availableLangs };
}

/**
 * Extract clean song lyrics from YouTube / YouTube Music subtitles using `yt-dlp`
 * (with automatic fallback to YouTube watch-page `captionTracks` when available).
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
    fetchImpl = fetch,
    execFileImpl = childProcess.execFile,
    env = process.env,
    platform = process.platform,
    fsImpl = fs
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

    const watchUrl = buildCanonicalWatchUrl(cleanId);
    const suggestedCommand = buildSuggestedYtDlpCommand(cleanId);
    let ytdlpError = '';
    let availableLangs = [];

    if (resolution.available && resolution.binPath) {
        const tmpDir = await fsImpl.promises.mkdtemp(path.join(os.tmpdir(), 'pdh-lyrics-'));
        try {
            const subLangPattern = [...new Set([
                ...langs,
                'en', 'en-US', 'en-GB', 'ko', 'ko-KR', 'es', 'es-419', 'es-MX', 'ja'
            ])].join(',');
            const outTemplate = path.join(tmpDir, '%(id)s.%(ext)s');
            await runYtDlp(
                resolution.binPath,
                [
                    '--skip-download',
                    '--no-playlist',
                    '--no-warnings',
                    '--write-subs',
                    '--write-auto-subs',
                    '--sub-langs',
                    subLangPattern,
                    '--sub-format',
                    'vtt/srt/ttml/best',
                    '--output',
                    outTemplate,
                    watchUrl
                ],
                { execFileImpl, env }
            );

            const files = await fsImpl.promises.readdir(tmpDir);
            const subFiles = files.filter((f) => /\.(?:vtt|srt|lrc|ttml|xml)$/i.test(f));

            const parsedCandidates = [];
            for (const fileName of subFiles) {
                const rawContent = await fsImpl.promises.readFile(path.join(tmpDir, fileName), 'utf8');
                const cleaned = cleanSubtitleText(rawContent);
                const stemParts = fileName.split('.');
                const langTag = stemParts.length >= 3 ? stemParts[stemParts.length - 2] : 'sub';
                availableLangs.push(langTag);
                if (!cleaned || !hasMeaningfulLyrics(cleaned)) continue;

                const extScore = fileName.endsWith('.vtt') ? 10 : fileName.endsWith('.srt') ? 8 : 4;
                const score = scoreLanguageTag(langTag, langs) + extScore;
                parsedCandidates.push({
                    lyrics: cleaned,
                    language: langTag,
                    rawLanguage: langTag,
                    source: `yt-dlp:${langTag}`,
                    score
                });
            }

            const formatted = deduplicateAndFormatLyricTracks(parsedCandidates, 4);
            if (formatted.combinedLyrics) {
                return {
                    ok: true,
                    videoId: cleanId,
                    lyrics: formatted.combinedLyrics,
                    language: formatted.combinedLanguage,
                    source: formatted.tracks.length === 1
                        ? formatted.tracks[0].source
                        : `yt-dlp:${formatted.combinedLanguage}`,
                    ytdlpAvailable: true,
                    ytdlpSource: resolution.source,
                    availableLangs: [...new Set(availableLangs)],
                    tracks: formatted.tracks,
                    suggestedCommand
                };
            }
        } catch (err) {
            ytdlpError = String(err?.stderr || err?.message || 'yt-dlp execution failed').trim().slice(0, 320);
        } finally {
            try {
                await fsImpl.promises.rm(tmpDir, { recursive: true, force: true });
            } catch (_) {
                // Best-effort cleanup in OS temp
            }
        }
    }

    // Zero-RAM Watch Page timedtext fallback (useful if yt-dlp lacked a binary or hit transient challenge)
    const fallback = await fetchCaptionTrackFallback({
        videoId: cleanId,
        preferredLangs: langs,
        fetchImpl
    });

    if (fallback.ok && fallback.lyrics) {
        return {
            ok: true,
            videoId: cleanId,
            lyrics: fallback.lyrics,
            language: fallback.language,
            source: fallback.source,
            ytdlpAvailable: resolution.available,
            ytdlpSource: resolution.source,
            availableLangs: fallback.availableLangs || availableLangs,
            suggestedCommand
        };
    }

    const mergedLangs = [...new Set([...availableLangs, ...(fallback.availableLangs || [])])];
    const botBlocked = /sign in to confirm you.?re not a bot|cookies|login required/i.test(ytdlpError);

    let reason = 'no_subtitles';
    let error =
        'Este video no tiene subtítulos/CC disponibles en YouTube (algunos MVs oficiales omiten CC). Puedes pegar la letra aquí o ejecutar el helper en tu PC.';

    if (!resolution.available) {
        reason = botBlocked ? 'bot_check' : 'no_subtitles_or_binary';
        error =
            'El video no expuso subtítulos automáticos y yt-dlp no está instalado en este servidor. Ejecuta el helper local en tu PC con YT_DLP_PATH o pega la letra directamente.';
    } else if (botBlocked) {
        reason = 'bot_check';
        error =
            'YouTube pidió verificación anti-bot en la IP del servidor para este video. Usa el comando yt-dlp en tu PC (o pega la letra manualmente).';
    } else if (ytdlpError && mergedLangs.length === 0) {
        error = `yt-dlp no encontró subtítulos descargables para este video (${ytdlpError.split('\n')[0]}).`;
    }

    return {
        ok: false,
        videoId: cleanId,
        reason,
        error,
        ytdlpAvailable: resolution.available,
        ytdlpSource: resolution.source,
        availableLangs: mergedLangs,
        suggestedCommand
    };
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
        const { stdout } = await runYtDlp(
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
            { execFileImpl, timeoutMs: 25000, env }
        );

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
    extractValidYouTubeVideoId,
    buildCanonicalWatchUrl,
    isAllowedMediaCdnUrl,
    isAllowedCaptionUrl,
    resolveYtDlpBinary,
    cleanSubtitleText,
    deduplicateAndFormatLyricTracks,
    parseWatchPageCaptionTracks,
    runYtDlp,
    extractSongLyrics,
    resolvePlayableMediaStream,
    getYtDlpStatus,
    clearMediaStreamCacheForTest
};
