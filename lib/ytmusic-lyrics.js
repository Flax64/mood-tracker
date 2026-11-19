'use strict';

/**
 * YouTube Music InnerTube (WEB_REMIX) lyrics & metadata extractor.
 * Flow: next(videoId) -> MPLYt_ browseId -> browse(browseId) -> text lines.
 * Fallback: search Song (audio-only) by cleaned title + artist and rank candidates.
 * Also supports fast track metadata lookup and alternative video search for closed-caption fallback.
 * Never throws: always resolves to { ok, ... } so callers can cascade cleanly.
 */

const {
    segmentLyricsIntoStanzas,
    parseCleanTrackAndArtist,
    splitArtistCredits,
    isGenericUploaderChannel,
    normalizeLookupText
} = require('./youtube-metadata');

const INNERTUBE_BASE = 'https://music.youtube.com/youtubei/v1/';
const SONGS_FILTER_PARAMS = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';
const VIDEOS_FILTER_PARAMS = 'EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D';
const MAX_DEPTH = 40;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const UNWANTED_VARIANT_TOKENS = [
    'instrumental',
    'karaoke',
    'mr removed',
    'sped up',
    'slowed',
    'reverb',
    '8d',
    'nightcore',
    'remix',
    'cover',
    'piano ver',
    'live',
    'concert',
    'fancam',
    'teaser',
    'shorts',
    'reaction'
];

function buildContext() {
    return {
        client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20260101.01.00',
            hl: 'en',
            gl: 'US'
        }
    };
}

/** Iterative-safe recursive walk; visitor returns truthy to stop and return that value. */
function walk(node, visitor, depth = 0) {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return undefined;
    const hit = visitor(node);
    if (hit) return hit;
    const children = Array.isArray(node) ? node : Object.values(node);
    for (const child of children) {
        const res = walk(child, visitor, depth + 1);
        if (res) return res;
    }
    return undefined;
}

/** Collect all matching objects in tree (bounded by maxDepth). */
function walkAll(node, collector, depth = 0) {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
    collector(node);
    const children = Array.isArray(node) ? node : Object.values(node);
    for (const child of children) {
        walkAll(child, collector, depth + 1);
    }
}

function findLyricsBrowseId(nextJson) {
    return walk(nextJson, (n) =>
        typeof n.browseId === 'string' && n.browseId.startsWith('MPLYt_') ? n.browseId : null
    ) || '';
}

function runsToText(runs) {
    return Array.isArray(runs) ? runs.map((r) => r?.text || '').join('') : '';
}

/** Extract lyrics text from a `browse` response. Prefers timedLyricsModel, then description shelf. */
function parseLyricsFromBrowse(browseJson) {
    const timed = walk(browseJson, (n) =>
        Array.isArray(n.timedLyricsData) ? n.timedLyricsData : null
    );
    if (timed) {
        const lines = [];
        let prevEndMs = null;
        for (const l of timed) {
            const rawLine = String(l?.lyricLine ?? '').replace(/\r\n?/g, '\n').trimEnd();
            const startMs = Number(l?.cueRange?.startTimeMilliseconds);
            const endMs = Number(l?.cueRange?.endTimeMilliseconds);
            if (
                prevEndMs !== null
                && Number.isFinite(startMs)
                && (startMs - prevEndMs) >= 2500
                && rawLine.trim()
                && lines.length > 0
                && lines[lines.length - 1] !== ''
            ) {
                lines.push('');
            }
            if (rawLine.includes('\n')) {
                for (const sub of rawLine.split('\n')) lines.push(sub.trimEnd());
            } else {
                lines.push(rawLine);
            }
            if (Number.isFinite(endMs) && endMs > 0) prevEndMs = endMs;
        }
        const rawText = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        const text = segmentLyricsIntoStanzas(rawText);
        if (text) return text;
    }
    const shelf = walk(browseJson, (n) => n.musicDescriptionShelfRenderer || null);
    if (shelf) {
        const rawText = runsToText(shelf.description?.runs).replace(/\r\n?/g, '\n').trim();
        const text = segmentLyricsIntoStanzas(rawText);
        if (text) return text;
    }
    return '';
}

function extractTrackInfo(nextJson, videoId) {
    const item = walk(nextJson, (n) => {
        const r = n.playlistPanelVideoRenderer;
        return r && (!videoId || r.videoId === videoId) ? r : null;
    });
    if (!item) {
        return { title: '', artist: '', collaborators: [], album: '', year: null, allArtists: [] };
    }
    const title = runsToText(item.title?.runs).trim();
    const bylineRuns = item.longBylineText?.runs || item.shortBylineText?.runs || [];

    // Split runs into bullet segments ("Artist1 & Artist2", "Album", "2024")
    const segments = [[]];
    for (const run of bylineRuns) {
        const t = String(run?.text || '');
        if (!t) continue;
        if (t.trim() === '•' || t.trim() === '·') {
            segments.push([]);
            continue;
        }
        if (t.includes('•')) {
            const parts = t.split('•');
            parts.forEach((p, idx) => {
                if (idx > 0) segments.push([]);
                if (p.trim()) segments[segments.length - 1].push({ ...run, text: p });
            });
        } else {
            segments[segments.length - 1].push(run);
        }
    }

    const nonEmptySegments = segments
        .map((runs) => ({ runs, text: runs.map((r) => r.text || '').join('').trim() }))
        .filter((s) => s.text.length > 0);

    let artist = '';
    const collaborators = [];
    const allArtists = [];
    let album = '';
    let year = null;

    if (nonEmptySegments.length > 0) {
        const firstSeg = nonEmptySegments[0];
        const parsedCredit = splitArtistCredits(firstSeg.text);
        artist = parsedCredit.mainArtist || firstSeg.text;
        parsedCredit.collaborators.forEach((c) => {
            if (!collaborators.includes(c)) collaborators.push(c);
        });

        // If InnerTube marked multiple artist links with navigationEndpoint (even comma-separated), capture them too
        const linkedArtists = firstSeg.runs
            .filter((r) => r?.navigationEndpoint?.browseEndpoint && r.text?.trim())
            .map((r) => r.text.trim());
        if (linkedArtists.length > 1) {
            artist = linkedArtists[0];
            linkedArtists.slice(1).forEach((extra) => {
                const sub = splitArtistCredits(extra);
                if (sub.mainArtist && sub.mainArtist !== artist && !collaborators.includes(sub.mainArtist)) {
                    collaborators.push(sub.mainArtist);
                }
                sub.collaborators.forEach((c) => {
                    if (c !== artist && !collaborators.includes(c)) collaborators.push(c);
                });
            });
        }
        if (artist) allArtists.push(artist);
        collaborators.forEach((c) => {
            if (!allArtists.includes(c)) allArtists.push(c);
        });

        for (const seg of nonEmptySegments.slice(1)) {
            const s = seg.text.trim();
            if (/^(?:19|20)\d{2}$/.test(s)) {
                const yr = Number(s);
                if (!year && yr >= 1900 && yr <= 2100) year = yr;
                continue;
            }
            if (
                /^\d+(?:[.,]\d+)?\s*[KMB]?\s*(?:views|likes|plays|reproducciones|vistas|me gusta)?$/i.test(s) ||
                /^\d{1,2}:\d{2}(?::\d{2})?$/.test(s)
            ) {
                continue;
            }
            if (!album) {
                album = s.slice(0, 180);
            }
        }
    }

    return { title, artist, collaborators, album, year, allArtists };
}

function tokenizeNormalizedWords(str) {
    return normalizeLookupText(str)
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2);
}

function findSongCandidatesInSearch(
    searchJson,
    excludeVideoId,
    { title = '', artist = '', maxCandidates = 4, preferVideoKeywords = false } = {}
) {
    const rawItems = [];
    const seenIds = new Set();

    walkAll(searchJson, (n) => {
        const r = n.musicResponsiveListItemRenderer;
        if (!r || typeof r !== 'object') return;
        const id =
            r?.playlistItemData?.videoId ||
            (r?.overlay && walk(r.overlay, (m) => m.watchEndpoint?.videoId || null));
        if (typeof id !== 'string' || !VIDEO_ID_RE.test(id) || id === excludeVideoId || seenIds.has(id)) {
            return;
        }
        seenIds.add(id);

        const cols = Array.isArray(r.flexColumns) ? r.flexColumns : [];
        const candTitle = runsToText(cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs).trim();
        const subtitle = cols
            .slice(1)
            .map((col) => runsToText(col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs).trim())
            .filter(Boolean)
            .join(' • ');

        rawItems.push({ id, candTitle, subtitle, idx: rawItems.length });
    });

    if (!rawItems.length) return [];

    const hasScoringHints = Boolean(String(title || '').trim() || String(artist || '').trim() || preferVideoKeywords);
    if (!hasScoringHints) {
        return rawItems.slice(0, maxCandidates).map((x) => x.id);
    }

    const cleanedTitleReq = parseCleanTrackAndArtist(title, '').title || title;
    const reqTitleNorm = normalizeLookupText(cleanedTitleReq);
    const reqTitleWords = tokenizeNormalizedWords(cleanedTitleReq);
    const reqArtistNorm = normalizeLookupText(splitArtistCredits(artist).mainArtist || artist);
    const reqArtistWords = tokenizeNormalizedWords(reqArtistNorm);

    const scored = rawItems.map((item) => {
        const cleanCandTitle = parseCleanTrackAndArtist(item.candTitle, '').title || item.candTitle;
        const candTitleNorm = normalizeLookupText(cleanCandTitle);
        const candRawNorm = normalizeLookupText(item.candTitle);
        const subtitleNorm = normalizeLookupText(item.subtitle);
        const combinedNorm = `${candRawNorm} ${subtitleNorm}`.trim();

        let score = 0;

        if (!item.candTitle && !item.subtitle) {
            score += 5;
        } else {
            if (reqTitleNorm) {
                if (candTitleNorm === reqTitleNorm || candRawNorm === reqTitleNorm) {
                    score += 75;
                } else if (candTitleNorm && (candTitleNorm.includes(reqTitleNorm) || reqTitleNorm.includes(candTitleNorm))) {
                    score += 50;
                } else if (reqTitleWords.length > 0) {
                    const candWords = new Set(tokenizeNormalizedWords(cleanCandTitle || item.candTitle));
                    const hits = reqTitleWords.filter((w) => candWords.has(w)).length;
                    score += (hits / reqTitleWords.length) * 40;
                }
            }

            if (reqArtistNorm && combinedNorm) {
                if (combinedNorm.includes(reqArtistNorm)) {
                    score += 45;
                } else if (reqArtistWords.length > 0) {
                    const candAllWords = new Set(tokenizeNormalizedWords(combinedNorm));
                    const hits = reqArtistWords.filter((w) => candAllWords.has(w)).length;
                    score += (hits / reqArtistWords.length) * 30;
                }
            }

            for (const variant of UNWANTED_VARIANT_TOKENS) {
                if (
                    (candRawNorm.includes(variant) || subtitleNorm.includes(variant)) &&
                    !reqTitleNorm.includes(variant)
                ) {
                    score -= 55;
                }
            }

            if (preferVideoKeywords && /\b(?:lyric(?:\s+video|s)?|official\s+(?:music\s+)?video|official\s+m\/v|color\s+coded)\b/i.test(`${item.candTitle} ${item.subtitle}`)) {
                score += 25;
            }
        }

        score -= item.idx * 0.01;
        return { id: item.id, score };
    });

    return scored
        .filter((s) => s.score > -15)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxCandidates)
        .map((s) => s.id);
}

function findSongVideoIdInSearch(searchJson, excludeVideoId) {
    return findSongCandidatesInSearch(searchJson, excludeVideoId, { maxCandidates: 1 })[0] || '';
}

function createInnerTubePost({ fetchImpl = fetch, isAllowedUrl, timeoutMs = 12000 }) {
    return async (endpoint, body) => {
        const url = `${INNERTUBE_BASE}${endpoint}?prettyPrint=false`;
        if (typeof isAllowedUrl === 'function' && !isAllowedUrl(url)) {
            const e = new Error('blocked_by_ssrf_guard');
            e.code = 'ssrf';
            throw e;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetchImpl(url, {
                method: 'POST',
                redirect: 'error',
                signal: ctrl.signal,
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'https://music.youtube.com',
                    Referer: 'https://music.youtube.com/',
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
                },
                body: JSON.stringify({ context: buildContext(), ...body })
            });
            if (!res.ok) {
                const e = new Error(`HTTP ${res.status}`);
                e.status = res.status;
                throw e;
            }
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    };
}

/**
 * Fetch quick canonical track metadata (title, artist, collaborators, album, year) from YT Music InnerTube.
 * Never throws.
 * @param {object} opts
 */
async function fetchYouTubeMusicTrackMetadata({
    videoId,
    fetchImpl = fetch,
    isAllowedUrl,
    timeoutMs = 4500
} = {}) {
    if (!videoId || !VIDEO_ID_RE.test(videoId)) {
        return { ok: false, title: '', artist: '', collaborators: [], album: '', year: null, allArtists: [] };
    }
    const post = createInnerTubePost({ fetchImpl, isAllowedUrl, timeoutMs });
    try {
        const next = await post('next', { videoId });
        const info = extractTrackInfo(next, videoId);
        return {
            ok: Boolean(info.title || info.artist || info.album || info.year),
            videoId,
            ...info
        };
    } catch (_err) {
        return { ok: false, videoId, title: '', artist: '', collaborators: [], album: '', year: null, allArtists: [] };
    }
}

/**
 * Search alternative YouTube Music / YouTube videos (Official MV / Lyric Video) for closed-caption fallback.
 * Never throws.
 * @param {object} opts
 */
async function searchYouTubeMusicVideos({
    query = '',
    excludeVideoId = '',
    title = '',
    artist = '',
    fetchImpl = fetch,
    isAllowedUrl,
    timeoutMs = 4500,
    maxCandidates = 3
} = {}) {
    const cleanQ = String(query || `${title} ${artist}`).trim();
    if (!cleanQ) return { ok: false, videoIds: [] };
    const post = createInnerTubePost({ fetchImpl, isAllowedUrl, timeoutMs });

    try {
        const search = await post('search', {
            query: cleanQ,
            params: decodeURIComponent(VIDEOS_FILTER_PARAMS)
        });
        let videoIds = findSongCandidatesInSearch(search, excludeVideoId, {
            title,
            artist,
            maxCandidates,
            preferVideoKeywords: true
        });
        if (!videoIds.length) {
            const unfiltered = await post('search', { query: cleanQ });
            videoIds = findSongCandidatesInSearch(unfiltered, excludeVideoId, {
                title,
                artist,
                maxCandidates,
                preferVideoKeywords: true
            });
        }
        return { ok: videoIds.length > 0, videoIds };
    } catch (_err) {
        return { ok: false, videoIds: [] };
    }
}

/**
 * @param {object} opts
 * @param {string} opts.videoId
 * @param {string} [opts.title]
 * @param {string} [opts.artist]
 * @param {Function} opts.fetchImpl
 * @param {(url:string)=>boolean} opts.isAllowedUrl  Anti-SSRF validator
 * @param {number} [opts.timeoutMs]
 */
async function fetchYouTubeMusicLyrics({
    videoId,
    title = '',
    artist = '',
    fetchImpl = fetch,
    isAllowedUrl,
    timeoutMs = 12000
} = {}) {
    const post = createInnerTubePost({ fetchImpl, isAllowedUrl, timeoutMs });

    const lyricsFor = async (id) => {
        const next = await post('next', { videoId: id });
        const browseId = findLyricsBrowseId(next);
        if (!browseId) return { next, lyrics: '' };
        const browse = await post('browse', { browseId });
        return { next, lyrics: parseLyricsFromBrowse(browse), browseId };
    };

    try {
        const direct = await lyricsFor(videoId);
        const info = extractTrackInfo(direct.next, videoId);
        if (direct.lyrics) {
            return {
                ok: true,
                lyrics: direct.lyrics,
                videoId,
                source: 'ytmusic:innertube',
                browseId: direct.browseId,
                trackInfo: info
            };
        }

        // Song fallback: MV without Lyrics tab -> clean title + artist and try top ranked Song candidates
        const rawTitle = String(title || info.title || '').trim();
        const rawArtist = String(artist || info.artist || '').trim();
        const parsedHint = parseCleanTrackAndArtist(rawTitle, rawArtist);
        const cleanTitle = parsedHint.title || rawTitle;
        const cleanArtist = parsedHint.mainArtist && !isGenericUploaderChannel(parsedHint.mainArtist)
            ? parsedHint.mainArtist
            : (isGenericUploaderChannel(rawArtist) ? '' : splitArtistCredits(rawArtist).mainArtist);

        const queries = [];
        const qPrimary = `${cleanTitle} ${cleanArtist}`.trim();
        if (qPrimary) queries.push(qPrimary);
        if (cleanTitle && cleanTitle !== qPrimary) queries.push(cleanTitle);

        for (let qi = 0; qi < queries.length; qi += 1) {
            const q = queries[qi];
            const search = await post('search', { query: q, params: decodeURIComponent(SONGS_FILTER_PARAMS) });
            const candidates = findSongCandidatesInSearch(search, videoId, {
                title: cleanTitle,
                artist: cleanArtist,
                maxCandidates: qi === 0 ? 4 : 2
            });
            for (const songId of candidates) {
                const alt = await lyricsFor(songId);
                if (alt.lyrics) {
                    return {
                        ok: true,
                        lyrics: alt.lyrics,
                        videoId,
                        songVideoId: songId,
                        source: 'ytmusic:innertube:song',
                        browseId: alt.browseId,
                        trackInfo: info
                    };
                }
            }
        }
        return { ok: false, reason: 'lyrics_not_available', error: 'Lyrics not available', trackInfo: info };
    } catch (err) {
        const status = err?.status || 0;
        return {
            ok: false,
            reason: status === 429 ? 'rate_limited' : err?.code === 'ssrf' ? 'ssrf_blocked' : 'innertube_error',
            error: String(err?.message || 'InnerTube request failed').slice(0, 200)
        };
    }
}

module.exports = {
    fetchYouTubeMusicLyrics,
    fetchYouTubeMusicTrackMetadata,
    searchYouTubeMusicVideos,
    findLyricsBrowseId,
    parseLyricsFromBrowse,
    extractTrackInfo,
    findSongCandidatesInSearch,
    findSongVideoIdInSearch
};
