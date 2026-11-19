'use strict';

/**
 * External lyrics & studio metadata cascade (zero extra npm dependencies, strict anti-SSRF guards).
 * Sources:
 * - LRCLIB (https://lrclib.net/api/*)
 * - Lyrics.ovh (https://api.lyrics.ovh/v1/*)
 * - YouTube Watch Page HTML + captionTracks + Video Description Lyrics
 * - iTunes Search API (https://itunes.apple.com/search)
 * - MusicBrainz API (https://musicbrainz.org/ws/2/*)
 */

const {
    parseCleanTrackAndArtist,
    splitArtistCredits,
    isGenericUploaderChannel,
    extractYouTubeWatchPageMetadata,
    cleanCaptionTextToLyrics,
    segmentLyricsIntoStanzas,
    normalizeAlbumTitleAndType,
    decodeHtmlEntities
} = require('./youtube-metadata');

const APP_USER_AGENT = 'PersonalDailyHub/1.0 (self-hosted)';
const BROWSER_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const UNWANTED_VERSION_TERMS = [
    'instrumental',
    'karaoke',
    'tribute',
    'lullaby',
    'ringtone',
    'made famous',
    '8-bit',
    '8d audio',
    'sped up',
    'slowed',
    'nightcore',
    'reverb',
    'cover',
    'piano version',
    'acoustic',
    'remix',
    'live',
    'commentary'
];

const COMPILATION_ALBUM_RE = /\b(?:greatest\s+hits|best\s+of|now\s+that'?s\s+what\s+i\s+call|top\s+hits|compilation|essential|anthology|100\s+hits|summer\s+hits|workout\s+hits|ultimates?|collection)\b/i;

function validateStrictHttpsUrl(rawUrl, allowedHostFn, requiredPathPrefix = '/') {
    if (!rawUrl) return false;
    let parsed;
    try {
        parsed = new URL(String(rawUrl));
    } catch (_) {
        return false;
    }
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.port !== '' && parsed.port !== '443') return false;
    if (parsed.pathname.includes('..')) return false;
    const host = (parsed.hostname || '').toLowerCase();
    if (!allowedHostFn(host)) return false;
    return parsed.pathname.startsWith(requiredPathPrefix);
}

function isAllowedLrclibUrl(rawUrl) {
    return validateStrictHttpsUrl(rawUrl, (h) => h === 'lrclib.net', '/api/');
}

function isAllowedLyricsOvhUrl(rawUrl) {
    return validateStrictHttpsUrl(rawUrl, (h) => h === 'api.lyrics.ovh', '/v1/');
}

function isAllowedItunesUrl(rawUrl) {
    return validateStrictHttpsUrl(rawUrl, (h) => h === 'itunes.apple.com', '/search');
}

function isAllowedMusicBrainzUrl(rawUrl) {
    return validateStrictHttpsUrl(rawUrl, (h) => h === 'musicbrainz.org', '/ws/2/');
}

function isAllowedYouTubeWatchUrl(rawUrl) {
    return validateStrictHttpsUrl(
        rawUrl,
        (h) => h === 'www.youtube.com' || h === 'music.youtube.com',
        '/watch'
    );
}

function isAllowedYouTubeCaptionUrl(rawUrl) {
    return validateStrictHttpsUrl(
        rawUrl,
        (h) => h === 'youtube.com' || h.endsWith('.youtube.com'),
        '/'
    );
}

async function safeFetchJson(url, { validator, fetchImpl = fetch, timeoutMs = 4000, headers = {} } = {}) {
    if (typeof validator === 'function' && !validator(url)) {
        const err = new Error('blocked_by_ssrf_guard');
        err.code = 'ssrf';
        throw err;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, {
            method: 'GET',
            redirect: 'error',
            signal: ctrl.signal,
            headers
        });
        if (!res || !res.ok) return null;
        return await res.json();
    } catch (_) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function safeFetchText(url, { validator, fetchImpl = fetch, timeoutMs = 5000, headers = {}, maxBytes = 1400000 } = {}) {
    if (typeof validator === 'function' && !validator(url)) {
        const err = new Error('blocked_by_ssrf_guard');
        err.code = 'ssrf';
        throw err;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, {
            method: 'GET',
            redirect: 'error',
            signal: ctrl.signal,
            headers
        });
        if (!res || !res.ok) return null;
        const text = await res.text();
        return text.length > maxBytes ? text.slice(0, maxBytes) : text;
    } catch (_) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function normalizeMatchText(str) {
    return String(str || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\u2018\u2019\u201c\u201d"'`´]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function stripBilingualParens(str) {
    const clean = String(str || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    return clean || String(str || '').trim();
}

function tokenizeForSimilarity(str) {
    const norm = normalizeMatchText(str);
    if (!norm) return new Set();
    const tokens = new Set();

    // Latin/numeric words
    for (const part of norm.split(/\s+/)) {
        if (!part) continue;
        tokens.add(part);
    }

    // CJK runs -> overlapping bigrams + unigrams for short words
    const cjkRuns = norm.match(/[\uAC00-\uD7A3\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/g) || [];
    for (const run of cjkRuns) {
        if (run.length <= 2) tokens.add(run);
        for (let i = 0; i < run.length - 1; i += 1) {
            tokens.add(run.slice(i, i + 2));
        }
    }
    return tokens;
}

function computeTokenSimilarity(a, b) {
    const normA = normalizeMatchText(a);
    const normB = normalizeMatchText(b);
    if (!normA || !normB) return 0;
    if (normA === normB) return 1;

    const noParenA = normalizeMatchText(stripBilingualParens(a));
    const noParenB = normalizeMatchText(stripBilingualParens(b));
    if (noParenA && noParenB && noParenA === noParenB) return 0.96;

    const setA = tokenizeForSimilarity(a);
    const setB = tokenizeForSimilarity(b);
    if (!setA.size || !setB.size) return 0;

    let intersection = 0;
    for (const tok of setA) {
        if (setB.has(tok)) intersection += 1;
    }
    const dice = (2 * intersection) / (setA.size + setB.size);

    // Inclusion boost for substring matches like "Blueming(블루밍)" vs "Blueming"
    const minLen = Math.min(normA.length, normB.length);
    if (minLen >= 3 && (normA.includes(normB) || normB.includes(normA))) {
        return Math.max(dice, 0.82);
    }
    return dice;
}

function hasUnwantedVersionMismatch(requestedTitle, candidateTitle, candidateAlbum = '') {
    const reqNorm = normalizeMatchText(requestedTitle);
    const candTitleNorm = normalizeMatchText(candidateTitle);
    const candAlbumNorm = normalizeMatchText(candidateAlbum);
    const combined = `${candTitleNorm} ${candAlbumNorm}`.trim();
    if (!combined) return false;

    for (const term of UNWANTED_VERSION_TERMS) {
        if (reqNorm.includes(term)) continue;
        if (term === 'live' || term === 'acoustic' || term === 'remix') {
            if (new RegExp(`\\b${term}\\b`, 'i').test(candTitleNorm)) return true;
        } else if (combined.includes(term)) {
            return true;
        }
    }
    return false;
}

function hasMeaningfulLyricsText(text, { minChars = 25 } = {}) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    const stripped = raw
        .replace(/\[(?:music|applause|laughter|cheering|instrumental|음악|박수)\]/gi, '')
        .replace(/[♪♫♩♬\s.,!?'"()\-_~]/g, '');
    return stripped.length >= minChars;
}

function cleanLyricsOvhHeader(raw) {
    return String(raw || '')
        .replace(/\r\n?/g, '\n')
        .replace(/^\s*Paroles\s+de\s+la\s+chanson\s+[^\n]+\n+/i, '')
        .trim();
}

function scoreLrclibRecord(rec, { reqTitle, reqArtist, durationSec }) {
    if (!rec || rec.instrumental === true) return -1;
    const rawLyrics = String(rec.plainLyrics || '').trim() || cleanCaptionTextToLyrics(rec.syncedLyrics || '');
    if (!hasMeaningfulLyricsText(rawLyrics)) return -1;

    const trackName = String(rec.trackName || rec.name || '').trim();
    const artistName = String(rec.artistName || '').trim();
    const albumName = String(rec.albumName || '').trim();

    if (hasUnwantedVersionMismatch(reqTitle, trackName, albumName)) return -1;

    const titleSim = computeTokenSimilarity(reqTitle, trackName);
    if (titleSim < 0.45) return -1;

    const artistSim = reqArtist ? computeTokenSimilarity(reqArtist, artistName) : 0;
    if (reqArtist && artistSim < 0.35) return -1;

    let score = titleSim * 60 + (reqArtist ? artistSim * 45 : 15);
    if (durationSec && Number.isFinite(Number(durationSec)) && Number(rec.duration) > 0) {
        const diff = Math.abs(Number(rec.duration) - Number(durationSec));
        if (diff <= 4) score += 12;
        else if (diff <= 15) score += 5;
        else if (diff > 90) score -= 15;
    }
    if (rec.plainLyrics) score += 5;
    return score;
}

/**
 * Fetch song lyrics from LRCLIB (`/api/get` then `/api/search`). Never throws.
 * @param {object} opts
 */
async function fetchLyricsFromLrclib({
    title = '',
    artist = '',
    album = '',
    durationSec = null,
    fetchImpl = fetch,
    timeoutMs = 4500
} = {}) {
    const parsedHint = parseCleanTrackAndArtist(title, artist);
    const cleanTitle = String(parsedHint.title || title || '').trim();
    if (!cleanTitle) return { ok: false, reason: 'missing_title' };

    const rawCleanArtist = parsedHint.mainArtist || splitArtistCredits(artist).mainArtist || String(artist || '').trim();
    const cleanArtist = isGenericUploaderChannel(rawCleanArtist) ? '' : rawCleanArtist;
    const deadlineAt = Date.now() + timeoutMs;

    const buildHit = (rec) => {
        const plain = String(rec.plainLyrics || '').replace(/\r\n?/g, '\n').trim();
        const rawBody = plain || cleanCaptionTextToLyrics(rec.syncedLyrics || '');
        const lyrics = segmentLyricsIntoStanzas(rawBody);
        if (!hasMeaningfulLyricsText(lyrics)) return null;
        return {
            ok: true,
            lyrics,
            trackName: String(rec.trackName || rec.name || cleanTitle).trim(),
            artistName: String(rec.artistName || cleanArtist || '').trim(),
            albumName: String(rec.albumName || album || '').trim(),
            synced: !plain && Boolean(rec.syncedLyrics),
            source: 'lrclib'
        };
    };

    try {
        if (cleanArtist) {
            const artistVariants = [cleanArtist];
            const simpleArtist = stripBilingualParens(cleanArtist);
            if (simpleArtist && simpleArtist !== cleanArtist) artistVariants.push(simpleArtist);

            const titleVariants = [cleanTitle];
            const simpleTitle = stripBilingualParens(cleanTitle);
            if (simpleTitle && simpleTitle !== cleanTitle) titleVariants.push(simpleTitle);

            const getParams = new URLSearchParams({
                track_name: titleVariants[0],
                artist_name: artistVariants[0]
            });
            const getUrl = `https://lrclib.net/api/get?${getParams.toString()}`;
            const directRec = await safeFetchJson(getUrl, {
                validator: isAllowedLrclibUrl,
                fetchImpl,
                timeoutMs: Math.min(2800, Math.max(800, deadlineAt - Date.now())),
                headers: { 'User-Agent': APP_USER_AGENT }
            });
            if (directRec && typeof directRec === 'object' && !Array.isArray(directRec)) {
                const s = scoreLrclibRecord(directRec, { reqTitle: cleanTitle, reqArtist: cleanArtist, durationSec });
                if (s >= 50) {
                    const hit = buildHit(directRec);
                    if (hit) return hit;
                }
            }
        }

        const remaining = deadlineAt - Date.now();
        if (remaining < 700) return { ok: false, reason: 'timeout' };

        const qTitle = stripBilingualParens(cleanTitle);
        const qArtist = cleanArtist ? stripBilingualParens(cleanArtist) : '';
        const searchTerms = [];
        const combinedQ = `${qTitle} ${qArtist}`.trim();
        if (combinedQ) searchTerms.push(combinedQ);
        if (qTitle && qTitle !== combinedQ) searchTerms.push(qTitle);

        let best = null;
        let bestScore = -1;

        for (const term of searchTerms) {
            const leftMs = deadlineAt - Date.now();
            if (leftMs < 700) break;

            const searchParams = new URLSearchParams({ q: term });
            const searchUrl = `https://lrclib.net/api/search?${searchParams.toString()}`;
            const list = await safeFetchJson(searchUrl, {
                validator: isAllowedLrclibUrl,
                fetchImpl,
                timeoutMs: Math.min(3000, leftMs),
                headers: { 'User-Agent': APP_USER_AGENT }
            });

            if (Array.isArray(list) && list.length > 0) {
                for (const item of list.slice(0, 12)) {
                    const s = scoreLrclibRecord(item, { reqTitle: cleanTitle, reqArtist: cleanArtist, durationSec });
                    if (s >= 50 && s > bestScore) {
                        const hit = buildHit(item);
                        if (hit) {
                            best = hit;
                            bestScore = s;
                        }
                    }
                }
                if (best) return best;
            }
        }

        return { ok: false, reason: 'not_found' };
    } catch (_) {
        return { ok: false, reason: 'lrclib_error' };
    }
}

/**
 * Fetch song lyrics from Lyrics.ovh (`/v1/{artist}/{title}`). Never throws.
 * @param {object} opts
 */
async function fetchLyricsFromLyricsOvh({
    title = '',
    artist = '',
    fetchImpl = fetch,
    timeoutMs = 4000
} = {}) {
    const parsedHint = parseCleanTrackAndArtist(title, artist);
    const rawTitle = parsedHint.title || title;
    const rawArtist = parsedHint.mainArtist || splitArtistCredits(artist).mainArtist || artist;
    if (!rawTitle || !rawArtist || isGenericUploaderChannel(rawArtist)) {
        return { ok: false, reason: 'missing_metadata' };
    }

    const cleanTitle = stripBilingualParens(rawTitle);
    const cleanArtist = stripBilingualParens(rawArtist);
    if (!cleanTitle || !cleanArtist) return { ok: false, reason: 'missing_metadata' };

    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanTitle)}`;
    try {
        const data = await safeFetchJson(url, {
            validator: isAllowedLyricsOvhUrl,
            fetchImpl,
            timeoutMs,
            headers: { 'User-Agent': APP_USER_AGENT }
        });
        const rawLyrics = cleanLyricsOvhHeader(data && data.lyrics);
        if (!rawLyrics || rawLyrics.length < 40 || !hasMeaningfulLyricsText(rawLyrics, { minChars: 35 })) {
            return { ok: false, reason: 'not_found' };
        }
        return {
            ok: true,
            lyrics: segmentLyricsIntoStanzas(rawLyrics),
            source: 'lyrics-ovh'
        };
    } catch (_) {
        return { ok: false, reason: 'lyrics_ovh_error' };
    }
}

/**
 * Extract full song lyrics embedded explicitly inside a YouTube video description (`Lyrics:`, `Letra:`, `가사:`, `歌詞:`).
 * Rejects descriptions that only contain credits, promos, or social links.
 * @param {string} description
 * @returns {string}
 */
function extractLyricsFromVideoDescription(description) {
    const raw = String(description || '').replace(/\r\n?/g, '\n');
    if (!raw.trim()) return '';

    const lines = raw.split('\n');
    const startHeaderRe = /^\s*[\[(]?(?:lyrics?|official\s+lyrics?|letra(?:\s+oficial)?|가사|歌詞|song\s+lyrics?)[\])]?\s*(?:[:：\-]\s*(.*))?$/i;
    const stopMarkerRe = /^(?:credits?|produced\s+by|written\s+by|composed\s+by|arranged\s+by|mixed\s+by|mastered\s+by|directed\s+by|follow(?:\s+us)?|connect\s+with|subscribe|more\s+from|watch\s+more|stream(?:ing)?(?:\s+(?:on|here))?|download|available\s+on|listen\s+(?:on|here)|provided\s+to\s+youtube\s+by|auto-generated\s+by\s+youtube|copyright|all\s+rights\s+reserved|tracklist|[℗©]|https?:\/\/|#[A-Za-z0-9_]+)/i;

    let startIdx = -1;
    let firstInlineLine = '';
    for (let i = 0; i < lines.length; i += 1) {
        const m = lines[i].match(startHeaderRe);
        if (m) {
            startIdx = i + 1;
            firstInlineLine = String(m[1] || '').trim();
            break;
        }
    }
    if (startIdx < 0) return '';

    const collected = [];
    if (firstInlineLine && !stopMarkerRe.test(firstInlineLine)) {
        collected.push(firstInlineLine);
    }

    let consecutiveBlank = 0;
    for (let i = startIdx; i < lines.length; i += 1) {
        const trimmed = lines[i].trim();
        if (stopMarkerRe.test(trimmed)) break;
        if (/^[-=_*]{4,}$/.test(trimmed) && collected.length >= 6) break;

        if (!trimmed) {
            consecutiveBlank += 1;
            if (consecutiveBlank >= 2 && collected.length >= 6) break;
            if (collected.length > 0 && collected[collected.length - 1] !== '') {
                collected.push('');
            }
            continue;
        }
        consecutiveBlank = 0;
        collected.push(lines[i].trimEnd());
    }

    while (collected.length && collected[collected.length - 1] === '') collected.pop();
    const nonEmptyLines = collected.filter((l) => l.trim().length > 0);
    const body = segmentLyricsIntoStanzas(collected.join('\n').trim());
    if (nonEmptyLines.length < 6 || !hasMeaningfulLyricsText(body, { minChars: 70 })) {
        return '';
    }
    return body;
}

function parseWatchCaptionTracksLocal(html) {
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

    for (let i = startBracket; i < scanLimit; i += 1) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '[') depth += 1;
        else if (ch === ']') {
            depth -= 1;
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
            const rawUrl = decodeHtmlEntities(String(track.baseUrl || '').replace(/\\u0026/g, '&')).trim();
            if (!isAllowedYouTubeCaptionUrl(rawUrl)) return null;
            const langCode = String(track.languageCode || '').trim().slice(0, 24);
            const kind = String(track.kind || '').trim().toLowerCase();
            return {
                languageCode: langCode,
                kind,
                isAutoGenerated: kind === 'asr',
                baseUrl: rawUrl
            };
        })
        .filter(Boolean);
}

function cleanXmlOrVttCaptionPayload(rawText) {
    const str = String(rawText || '');
    if (!str.trim()) return '';
    const withBreaks = str.replace(/<br\s*\/?>/gi, '\n').replace(/\\N/g, '\n');
    const prepared = /<(?:transcript|timedtext|tt[\s>]|text[\s>]|p[\s>]|div[\s>])/i.test(withBreaks)
        ? withBreaks.replace(/<\/(?:text|p|div)>/gi, '\n')
        : withBreaks;
    return cleanCaptionTextToLyrics(prepared);
}

function baseLangOfTag(tag) {
    const clean = String(tag || '').toLowerCase().replace(/-orig$/i, '').split(/[-_]/)[0];
    if (clean === 'kr') return 'ko';
    if (clean === 'jp') return 'ja';
    return clean;
}

/**
 * Fetch YouTube Watch Page HTML (`https://www.youtube.com/watch?v=...&hl=en`) to extract
 * watch metadata, embedded description lyrics, and manual/ASR `captionTracks`. Never throws.
 * @param {object} opts
 */
async function fetchCaptionsFromYouTubeWatchPage({
    videoId,
    preferredLangs = ['en', 'ko', 'es', 'ja'],
    fetchImpl = fetch,
    timeoutMs = 5000
} = {}) {
    if (!videoId || !VIDEO_ID_RE.test(videoId)) {
        return { ok: false, manualCandidates: [], asrCandidates: [], watchMeta: null, descriptionLyrics: '' };
    }

    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`;
    const deadlineAt = Date.now() + timeoutMs;

    const html = await safeFetchText(watchUrl, {
        validator: isAllowedYouTubeWatchUrl,
        fetchImpl,
        timeoutMs: Math.min(3500, timeoutMs),
        headers: {
            'User-Agent': BROWSER_USER_AGENT,
            'Accept-Language': 'en-US,en;q=0.9',
            Cookie: 'CONSENT=YES+1'
        }
    });

    if (!html) {
        return { ok: false, manualCandidates: [], asrCandidates: [], watchMeta: null, descriptionLyrics: '' };
    }

    const watchMeta = extractYouTubeWatchPageMetadata(html);
    const descriptionLyrics = extractLyricsFromVideoDescription(watchMeta?.description || '');
    const tracks = parseWatchCaptionTracksLocal(html);

    if (!tracks.length) {
        return {
            ok: Boolean(descriptionLyrics),
            manualCandidates: [],
            asrCandidates: [],
            watchMeta,
            descriptionLyrics
        };
    }

    const prefBases = preferredLangs.map(baseLangOfTag).filter(Boolean);
    const scoredTracks = tracks.map((t) => {
        const base = baseLangOfTag(t.languageCode);
        const prefIdx = prefBases.indexOf(base);
        const langScore = prefIdx >= 0 ? 80 - prefIdx * 5 : (['ko', 'en', 'ja', 'es'].includes(base) ? 55 : 10);
        const manualBonus = t.isAutoGenerated ? -20 : 45;
        return { track: t, base, score: langScore + manualBonus };
    });
    scoredTracks.sort((a, b) => b.score - a.score);

    // Pick at most 1 best track per language (up to 4 tracks)
    const selected = [];
    const seenBases = new Set();
    for (const entry of scoredTracks) {
        if (!entry.base || seenBases.has(entry.base)) continue;
        seenBases.add(entry.base);
        selected.push(entry);
        if (selected.length >= 4) break;
    }

    const manualCandidates = [];
    const asrCandidates = [];

    for (const entry of selected) {
        const remMs = deadlineAt - Date.now();
        if (remMs < 500) break;

        const payload = await safeFetchText(entry.track.baseUrl, {
            validator: isAllowedYouTubeCaptionUrl,
            fetchImpl,
            timeoutMs: Math.min(2500, remMs),
            headers: {
                'User-Agent': BROWSER_USER_AGENT,
                Cookie: 'CONSENT=YES+1'
            },
            maxBytes: 400000
        });
        if (!payload) continue;

        const cleaned = cleanXmlOrVttCaptionPayload(payload);
        if (!cleaned || !hasMeaningfulLyricsText(cleaned, { minChars: 6 })) continue;

        const looksAsr = entry.track.isAutoGenerated || /<\d{2}:\d{2}:\d{2}\.\d{3}><c>/i.test(payload);
        const candidate = {
            lyrics: cleaned,
            language: entry.track.languageCode || 'sub',
            rawLanguage: entry.track.languageCode || 'sub',
            isAutoGenerated: looksAsr,
            source: looksAsr ? `youtube:asr-captions:${entry.track.languageCode}` : `youtube:watch-captions:${entry.track.languageCode}`,
            score: entry.score
        };

        if (looksAsr) asrCandidates.push(candidate);
        else manualCandidates.push(candidate);
    }

    return {
        ok: manualCandidates.length > 0 || asrCandidates.length > 0 || Boolean(descriptionLyrics),
        manualCandidates,
        asrCandidates,
        watchMeta,
        descriptionLyrics
    };
}

function parseReleaseYearAndDate(rawDate) {
    const str = String(rawDate || '').trim();
    const yrMatch = str.match(/^((?:19|20)\d{2})/);
    if (!yrMatch) return { year: null, date: null };
    const yr = Number(yrMatch[1]);
    if (yr < 1900 || yr > 2100) return { year: null, date: null };
    const fullMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
    return { year: yr, date: fullMatch ? fullMatch[1] : null };
}

/**
 * Enrich track metadata (studio release year, canonical title, artist, collabs, genre, track number)
 * from iTunes Search API and MusicBrainz. Never throws.
 * @param {object} opts
 */
async function fetchExternalTrackMetadata({
    title = '',
    artist = '',
    durationSec = null,
    fetchImpl = fetch,
    timeoutMs = 3800
} = {}) {
    const cleanTitle = stripBilingualParens(title || '');
    const rawArtist = artist && !isGenericUploaderChannel(artist) ? stripBilingualParens(artist) : '';
    const queryTerm = `${cleanTitle} ${rawArtist}`.trim() || String(title || '').trim();
    if (!queryTerm) return null;

    const deadlineAt = Date.now() + timeoutMs;
    let bestResult = null;

    // 1. iTunes Search API
    const itunesParams = new URLSearchParams({
        term: queryTerm,
        media: 'music',
        entity: 'song',
        limit: '10'
    });
    const itunesUrl = `https://itunes.apple.com/search?${itunesParams.toString()}`;
    const itunesData = await safeFetchJson(itunesUrl, {
        validator: isAllowedItunesUrl,
        fetchImpl,
        timeoutMs: Math.min(2800, timeoutMs),
        headers: { 'User-Agent': APP_USER_AGENT }
    });

    if (itunesData && Array.isArray(itunesData.results) && itunesData.results.length > 0) {
        const candidates = [];
        for (const item of itunesData.results) {
            if (!item || !item.trackName) continue;
            const tName = String(item.trackName || '').trim();
            const aName = String(item.artistName || '').trim();
            const cName = String(item.collectionName || '').trim();

            if (hasUnwantedVersionMismatch(cleanTitle || title, tName, cName)) continue;

            const tSim = computeTokenSimilarity(cleanTitle || title, tName);
            const aSim = rawArtist ? computeTokenSimilarity(rawArtist, aName) : 0;
            if (rawArtist) {
                if (tSim < 0.55 || aSim < 0.4) continue;
            } else if (tSim < 0.8) {
                continue;
            }

            const isCompilation = COMPILATION_ALBUM_RE.test(cName);
            const parsedRelease = parseReleaseYearAndDate(item.releaseDate);
            let score = tSim * 60 + (rawArtist ? aSim * 45 : 10) + (isCompilation ? -12 : 8);

            if (durationSec && Number.isFinite(Number(durationSec)) && Number(item.trackTimeMillis) > 0) {
                const diff = Math.abs(Number(item.trackTimeMillis) / 1000 - Number(durationSec));
                if (diff <= 5) score += 10;
                else if (diff > 90) score -= 12;
            }

            candidates.push({
                item,
                tName,
                aName,
                cName,
                isCompilation,
                releaseYear: parsedRelease.year,
                releaseDate: parsedRelease.date,
                score
            });
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score);
            const top = candidates[0];
            const nonCompYears = candidates
                .filter((c) => !c.isCompilation && c.releaseYear)
                .map((c) => ({ year: c.releaseYear, date: c.releaseDate }));
            const anyYears = candidates
                .filter((c) => c.releaseYear)
                .map((c) => ({ year: c.releaseYear, date: c.releaseDate }));
            const yearPool = nonCompYears.length ? nonCompYears : anyYears;
            yearPool.sort((a, b) => a.year - b.year);

            const parsedArtistCredit = splitArtistCredits(top.aName);
            const cleanTrackParsed = parseCleanTrackAndArtist(top.tName, top.aName);
            const collabs = [];
            for (const c of [...parsedArtistCredit.collaborators, ...cleanTrackParsed.collaborators]) {
                if (c && !collabs.includes(c)) collabs.push(c);
            }

            const normAlb = normalizeAlbumTitleAndType(top.cName);
            bestResult = {
                title: cleanTrackParsed.title || top.tName,
                artist: parsedArtistCredit.mainArtist || top.aName,
                collaborators: collabs,
                albumTitle: normAlb.albumTitle,
                albumType: normAlb.albumType,
                releaseYear: (yearPool[0] && yearPool[0].year) || top.releaseYear || null,
                releaseDate: (yearPool[0] && yearPool[0].date) || top.releaseDate || null,
                trackNumber: Number.isInteger(Number(top.item.trackNumber)) ? Number(top.item.trackNumber) : null,
                genre: String(top.item.primaryGenreName || '').trim() || null,
                source: 'itunes'
            };
        }
    }

    // 2. MusicBrainz fallback when iTunes missed match or releaseYear
    const remainingMs = deadlineAt - Date.now();
    if ((!bestResult || !bestResult.releaseYear) && remainingMs >= 1500) {
        const qParts = [`recording:"${(cleanTitle || title).replace(/"/g, '')}"`];
        if (rawArtist) qParts.push(`artist:"${rawArtist.replace(/"/g, '')}"`);
        const mbParams = new URLSearchParams({
            query: qParts.join(' AND '),
            fmt: 'json',
            limit: '5'
        });
        const mbUrl = `https://musicbrainz.org/ws/2/recording/?${mbParams.toString()}`;
        const mbData = await safeFetchJson(mbUrl, {
            validator: isAllowedMusicBrainzUrl,
            fetchImpl,
            timeoutMs: Math.min(2500, remainingMs),
            headers: {
                'User-Agent': APP_USER_AGENT,
                Accept: 'application/json'
            }
        });

        const recordings = Array.isArray(mbData?.recordings) ? mbData.recordings : [];
        for (const rec of recordings) {
            if (!rec || Number(rec.score || 0) < 85) continue;
            const mbTitle = String(rec.title || '').trim();
            const credits = Array.isArray(rec['artist-credit']) ? rec['artist-credit'] : [];
            const mbArtist = credits[0]?.name || credits[0]?.artist?.name || '';
            const mbCollabs = credits
                .slice(1)
                .map((c) => c?.name || c?.artist?.name || '')
                .filter(Boolean);

            const tSim = computeTokenSimilarity(cleanTitle || title, mbTitle);
            const aSim = rawArtist ? computeTokenSimilarity(rawArtist, mbArtist) : 1;
            if (tSim < 0.65 || aSim < 0.45) continue;

            const parsedMbRelease = parseReleaseYearAndDate(rec['first-release-date']);
            const firstRelTitle = Array.isArray(rec.releases) && rec.releases[0]?.title ? String(rec.releases[0].title).trim() : null;

            if (!bestResult) {
                bestResult = {
                    title: mbTitle,
                    artist: mbArtist,
                    collaborators: mbCollabs,
                    albumTitle: firstRelTitle,
                    albumType: null,
                    releaseYear: parsedMbRelease.year,
                    releaseDate: parsedMbRelease.date,
                    trackNumber: null,
                    genre: null,
                    source: 'musicbrainz'
                };
            } else if (!bestResult.releaseYear && parsedMbRelease.year) {
                bestResult.releaseYear = parsedMbRelease.year;
                bestResult.releaseDate = parsedMbRelease.date;
                bestResult.source = 'itunes+musicbrainz';
            }
            break;
        }
    }

    return bestResult;
}

module.exports = {
    isAllowedLrclibUrl,
    isAllowedLyricsOvhUrl,
    isAllowedItunesUrl,
    isAllowedMusicBrainzUrl,
    isAllowedYouTubeWatchUrl,
    isAllowedYouTubeCaptionUrl,
    normalizeMatchText,
    stripBilingualParens,
    computeTokenSimilarity,
    hasUnwantedVersionMismatch,
    fetchLyricsFromLrclib,
    fetchLyricsFromLyricsOvh,
    extractLyricsFromVideoDescription,
    fetchCaptionsFromYouTubeWatchPage,
    fetchExternalTrackMetadata,
    parseWatchCaptionTracksLocal
};
