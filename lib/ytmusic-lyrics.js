'use strict';

/**
 * YouTube Music InnerTube (WEB_REMIX) lyrics extractor.
 * Flow: next(videoId) -> MPLYt_ browseId -> browse(browseId) -> text lines.
 * Fallback: search Song (audio-only) by title + artist when the MV has no Lyrics tab.
 * Never throws: always resolves to { ok, ... } so callers can cascade cleanly.
 */

const { segmentLyricsIntoStanzas } = require('./youtube-metadata');

const INNERTUBE_BASE = 'https://music.youtube.com/youtubei/v1/';
const SONGS_FILTER_PARAMS = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';
const MAX_DEPTH = 40;

function buildContext() {
    return {
        client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20250310.01.00',
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
    if (!item) return { title: '', artist: '' };
    const title = runsToText(item.title?.runs);
    const byline = item.longBylineText?.runs || item.shortBylineText?.runs || [];
    // First run is the artist; later runs are album / year separated by " • "
    const artist = byline[0]?.text || '';
    return { title, artist };
}

function findSongVideoIdInSearch(searchJson, excludeVideoId) {
    return walk(searchJson, (n) => {
        const r = n.musicResponsiveListItemRenderer;
        const id = r?.playlistItemData?.videoId || r?.overlay && walk(r.overlay, (m) => m.watchEndpoint?.videoId || null);
        return typeof id === 'string' && id.length === 11 && id !== excludeVideoId ? id : null;
    }) || '';
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
    const post = async (endpoint, body) => {
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
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
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

    const lyricsFor = async (id) => {
        const next = await post('next', { videoId: id });
        const browseId = findLyricsBrowseId(next);
        if (!browseId) return { next, lyrics: '' };
        const browse = await post('browse', { browseId });
        return { next, lyrics: parseLyricsFromBrowse(browse), browseId };
    };

    try {
        const direct = await lyricsFor(videoId);
        if (direct.lyrics) {
            return { ok: true, lyrics: direct.lyrics, videoId, source: 'ytmusic:innertube', browseId: direct.browseId };
        }

        // Song fallback: MV without Lyrics tab -> official audio-only track by title + artist
        const info = extractTrackInfo(direct.next, videoId);
        const q = `${title || info.title} ${artist || info.artist}`.trim();
        if (q) {
            const search = await post('search', { query: q, params: decodeURIComponent(SONGS_FILTER_PARAMS) });
            const songId = findSongVideoIdInSearch(search, videoId);
            if (songId) {
                const alt = await lyricsFor(songId);
                if (alt.lyrics) {
                    return {
                        ok: true,
                        lyrics: alt.lyrics,
                        videoId,
                        songVideoId: songId,
                        source: 'ytmusic:innertube:song',
                        browseId: alt.browseId
                    };
                }
            }
        }
        return { ok: false, reason: 'lyrics_not_available', error: 'Lyrics not available' };
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
    findLyricsBrowseId,
    parseLyricsFromBrowse,
    extractTrackInfo,
    findSongVideoIdInSearch
};
