'use strict';

/**
 * Clean helpers for parsing YouTube / YouTube Music track metadata, album details,
 * embeddability flags, and caption/subtitle text (.srt, .vtt, .lrc) into lyrics.
 * Zero heavy dependencies; safe for low-RAM Node containers (AWS t3.micro).
 */

const VALID_RELEASE_TYPES = new Set(['album', 'mini_album', 'ep', 'single', 'collab_single', 'ost']);

const TITLE_NOISE_PATTERNS = [
    /\s*[\[(]\s*(?:official\s+)?(?:music\s+)?(?:video|m\/v|mv|audio|visualizer|performance(?:\s+video)?|lyric(?:\s+video)?|lyrics?|color\s+coded(?:\s+lyrics?)?|live(?:\s+performance)?|hd|4k|8k|remastered(?:\s+\d{4})?)\s*[\])]/gi,
    /\s*[\[(]\s*(?:가사|한글|번역|발음|eng\s*\/?\s*kor|kor\s*\/?\s*eng|en\s*\/?\s*es)\s*[\])]/gi,
    /\s+(?:official\s+)?(?:music\s+video|m\/v|mv)\s*$/i
];

/**
 * Decode minimal HTML/XML entities common in YouTube HTML metadata and captions.
 * @param {string} value
 * @returns {string}
 */
function decodeHtmlEntities(value) {
    return String(value || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#(\d+);/g, (_m, dec) => {
            const code = Number(dec);
            return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
        })
        .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Normalize text for fuzzy matching against the user's catalog.
 * @param {string} value
 * @returns {string}
 */
function normalizeLookupText(value) {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .replace(/[\u2018\u2019\u201c\u201d"'`´]/g, '')
        .replace(/\s+/g, ' ');
}

/**
 * Strip surrounding single/double/smart quotes from a track title.
 * @param {string} text
 * @returns {string}
 */
function stripOuterQuotes(text) {
    let out = String(text || '').trim();
    if (
        (out.startsWith("'") && out.endsWith("'")) ||
        (out.startsWith('"') && out.endsWith('"')) ||
        (out.startsWith('“') && out.endsWith('”')) ||
        (out.startsWith('‘') && out.endsWith('’')) ||
        (out.startsWith('[') && out.endsWith(']') && !out.includes('] ['))
    ) {
        out = out.slice(1, -1).trim();
    }
    return out;
}

/**
 * Infer release type (`album`, `mini_album`, `ep`, `single`, `collab_single`, `ost`) from free text.
 * @param {string} text
 * @returns {string}
 */
function inferReleaseType(text) {
    const lower = String(text || '').toLowerCase();
    if (!lower) return 'album';
    if (/\bost\b|original\s+soundtrack|soundtrack/.test(lower)) return 'ost';
    if (/mini[\s_-]*album|미니\s*앨범|\bmini\b/.test(lower)) return 'mini_album';
    if (/\bep\b|extended\s+play/.test(lower)) return 'ep';
    if (/\bsingle\b|digital\s+single|pre-release\s+single|싱글/.test(lower)) return 'single';
    return 'album';
}

/**
 * Split an artist string into main artist and collaborators (`&`, `x`, `feat.`, `ft.`, `with`).
 * Avoids breaking legitimate band names when only a standalone channel is given unless separators match.
 * @param {string} rawArtist
 * @returns {{ mainArtist: string, collaborators: string[] }}
 */
function splitArtistCredits(rawArtist) {
    const cleaned = String(rawArtist || '')
        .replace(/\s*-\s*Topic$/i, '')
        .replace(/\s+(?:VEVO|Official)$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) return { mainArtist: '', collaborators: [] };

    const featMatch = cleaned.match(/^(.+?)\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i);
    if (featMatch) {
        const extra = featMatch[2]
            .split(/\s*[,&]\s*/)
            .map(s => s.trim())
            .filter(Boolean);
        return { mainArtist: featMatch[1].trim(), collaborators: extra };
    }

    const duetMatch = cleaned.match(/^(.+?)\s+(?:&|×|\bx\b|\bwith\b)\s+(.+)$/i);
    if (duetMatch && duetMatch[1].trim().length >= 2 && duetMatch[2].trim().length >= 2) {
        const collabs = duetMatch[2]
            .split(/\s*[,&]\s*/)
            .map(s => s.trim())
            .filter(Boolean);
        return { mainArtist: duetMatch[1].trim(), collaborators: collabs };
    }

    return { mainArtist: cleaned, collaborators: [] };
}

/**
 * Clean a raw YouTube / YT Music title and channel author into track title, main artist, and collaborators.
 * Examples handled:
 * - "BABYMONSTER - 'DRIP' M/V" -> title: "DRIP", mainArtist: "BABYMONSTER"
 * - "ROSÉ & Bruno Mars - APT. (Official Music Video)" -> title: "APT.", mainArtist: "ROSÉ", collabs: ["Bruno Mars"]
 * - "aespa 에스파 'Supernova' MV" -> title: "Supernova", mainArtist: "aespa 에스파"
 * @param {string} rawTitle
 * @param {string} rawChannel
 * @returns {{ title: string, mainArtist: string, collaborators: string[] }}
 */
function parseCleanTrackAndArtist(rawTitle, rawChannel) {
    let working = decodeHtmlEntities(String(rawTitle || '')).replace(/\s+/g, ' ').trim();
    const channelCredit = splitArtistCredits(decodeHtmlEntities(String(rawChannel || '')));
    const collaborators = [...channelCredit.collaborators];

    for (const pat of TITLE_NOISE_PATTERNS) {
        working = working.replace(pat, '');
    }
    working = working.replace(/\s+/g, ' ').trim();

    let title = working;
    let mainArtist = channelCredit.mainArtist;

    // Extract `(feat. X)` or `[ft. X]` embedded in song title before splitting.
    const titleFeatMatch = working.match(/\s*[\[(]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^\]()]+)[\])]/i);
    if (titleFeatMatch) {
        titleFeatMatch[1]
            .split(/\s*[,&]\s*/)
            .map(s => s.trim())
            .filter(Boolean)
            .forEach(c => {
                if (!collaborators.includes(c)) collaborators.push(c);
            });
        working = working.replace(titleFeatMatch[0], '').replace(/\s+/g, ' ').trim();
    }

    // Pattern 1: "Artist - Song" (en-dash, em-dash, or hyphen)
    const dashMatch = working.match(/^(.{1,90}?)\s+[-–—]\s+(.{1,160})$/);
    if (dashMatch) {
        const parsedArtist = splitArtistCredits(dashMatch[1]);
        if (parsedArtist.mainArtist) {
            mainArtist = parsedArtist.mainArtist;
            parsedArtist.collaborators.forEach(c => {
                if (!collaborators.includes(c)) collaborators.push(c);
            });
        }
        title = stripOuterQuotes(dashMatch[2]);
    } else {
        // Pattern 2: "Artist 'Song Title'" (common in SM / K-Pop M/V titles)
        const quotedMatch = working.match(/^(.{1,70}?)\s+['"‘“]([^'"’”]{1,120})['"’”]\s*$/);
        if (quotedMatch) {
            const parsedArtist = splitArtistCredits(quotedMatch[1]);
            if (parsedArtist.mainArtist) {
                mainArtist = parsedArtist.mainArtist;
                parsedArtist.collaborators.forEach(c => {
                    if (!collaborators.includes(c)) collaborators.push(c);
                });
            }
            title = quotedMatch[2].trim();
        } else {
            title = stripOuterQuotes(working);
        }
    }

    const dedupedCollabs = [];
    const mainNorm = normalizeLookupText(mainArtist);
    const seen = new Set(mainNorm ? [mainNorm] : []);
    for (const c of collaborators) {
        const norm = normalizeLookupText(c);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        dedupedCollabs.push(c);
    }

    return {
        title: title.slice(0, 180),
        mainArtist: mainArtist.slice(0, 140),
        collaborators: dedupedCollabs
    };
}

/**
 * Parse YouTube Music "Provided to YouTube by ..." Art Track description blocks.
 * Standard block format:
 *   Provided to YouTube by <Distributor>
 *   <Track> · <Artist 1> · <Artist 2>
 *   <Album Title>
 *   ℗ <Label>
 *   Released on: YYYY-MM-DD
 * @param {string} description
 * @returns {{ title: string|null, mainArtist: string|null, collaborators: string[], albumTitle: string|null, albumType: string|null, albumYear: number|null } | null}
 */
function parseProvidedToYouTubeDescription(description) {
    const raw = String(description || '');
    if (!/Provided to YouTube by/i.test(raw)) return null;

    const lines = raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const headerIdx = lines.findIndex(line => /^Provided to YouTube by/i.test(line));
    if (headerIdx < 0) return null;

    let title = null;
    let mainArtist = null;
    const collaborators = [];
    let albumTitle = null;
    let albumYear = null;

    const afterHeader = lines.slice(headerIdx + 1);
    const creditLine = afterHeader[0] || '';
    if (creditLine && !/^[℗©]/.test(creditLine) && !/^Released on:/i.test(creditLine)) {
        const parts = creditLine.split(/\s+·\s+/).map(p => p.trim()).filter(Boolean);
        title = parts[0] || null;
        if (parts.length > 1) {
            const firstArtist = splitArtistCredits(parts[1]);
            mainArtist = firstArtist.mainArtist || parts[1];
            firstArtist.collaborators.forEach(c => collaborators.push(c));
            parts.slice(2).forEach(extra => {
                const splitExtra = splitArtistCredits(extra);
                if (splitExtra.mainArtist) collaborators.push(splitExtra.mainArtist);
                splitExtra.collaborators.forEach(c => collaborators.push(c));
            });
        }
    }

    const potentialAlbumLine = afterHeader[1] || '';
    if (
        potentialAlbumLine &&
        !/^[℗©]/.test(potentialAlbumLine) &&
        !/^(?:Released on:|Auto-generated by YouTube|Composer:|Lyricist:|Producer:|Main\s+Artist:)/i.test(potentialAlbumLine)
    ) {
        albumTitle = potentialAlbumLine.slice(0, 180);
    }

    let releaseDate = null;
    const releasedMatch = raw.match(/Released on:\s*((\d{4})-\d{2}-\d{2})/i);
    if (releasedMatch) {
        releaseDate = releasedMatch[1];
        const parsedYear = Number(releasedMatch[2]);
        if (parsedYear >= 1900 && parsedYear <= 2100) albumYear = parsedYear;
    }

    return {
        title: title ? title.slice(0, 180) : null,
        mainArtist: mainArtist ? mainArtist.slice(0, 140) : null,
        collaborators,
        albumTitle,
        albumType: albumTitle ? inferReleaseType(`${albumTitle} ${raw}`) : null,
        albumYear,
        releaseDate
    };
}

/**
 * Parse general video description cues for album name, release year, and release type.
 * Useful on official M/Vs (e.g. "BABYMONSTER 1st FULL ALBUM [DRIP]", "Album: DRIP").
 * @param {string} description
 * @returns {{ albumTitle: string|null, albumType: string|null, albumYear: number|null }}
 */
function parseGeneralDescriptionAlbumHints(description) {
    const raw = String(description || '');
    if (!raw.trim()) return { albumTitle: null, albumType: null, albumYear: null };

    let albumTitle = null;
    let albumType = null;
    let albumYear = null;

    const explicitAlbumLine = raw.match(/(?:^|\n)\s*(?:Album|Mini\s+Album|EP|OST|앨범)\s*[:：]\s*([^\n\r]{2,120})/i);
    if (explicitAlbumLine) {
        albumTitle = stripOuterQuotes(explicitAlbumLine[1].replace(/\s*[-–|].*$/, '').trim()).slice(0, 180);
        albumType = inferReleaseType(explicitAlbumLine[0]);
    }

    if (!albumTitle) {
        const promoMatch = raw.match(
            /(?:1st|2nd|3rd|\d+th)?\s*(?:Full|Mini|Digital)?\s*(Mini\s+Album|Album|EP|Single|OST)\s*[\["'‘“]([^\]"'’”\n]{1,100})[\]"'’”]/i
        );
        if (promoMatch) {
            albumType = inferReleaseType(promoMatch[1]);
            albumTitle = promoMatch[2].trim().slice(0, 180);
        }
    }

    if (!albumTitle) {
        const fromAlbumMatch = raw.match(/from\s+(?:the\s+)?(?:upcoming\s+)?(?:new\s+)?(?:album|mini[\s-]album|ep)\s*['"‘“]([^'"’”\n]{1,100})['"’”]/i);
        if (fromAlbumMatch) {
            albumType = inferReleaseType(fromAlbumMatch[0]);
            albumTitle = fromAlbumMatch[1].trim().slice(0, 180);
        }
    }

    const yearMatch = raw.match(/(?:Released on|Release date)\s*[:：]?\s*(\d{4})/i);
    if (yearMatch) {
        const yr = Number(yearMatch[1]);
        if (yr >= 1900 && yr <= 2100) albumYear = yr;
    }

    return {
        albumTitle: albumTitle || null,
        albumType: albumType && VALID_RELEASE_TYPES.has(albumType) ? albumType : null,
        albumYear
    };
}

/**
 * Extract a balanced JSON object assigned to a variable (e.g. `ytInitialPlayerResponse = {...}`)
 * without loading or parsing the rest of a huge HTML page.
 * @param {string} html
 * @param {string} varName
 * @returns {object|null}
 */
function extractAssignedJsonObject(html, varName) {
    if (!html || !varName) return null;
    const escapedName = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:var\\s+|window\\["${escapedName}"\\]\\s*=\\s*|${escapedName}\\s*=\\s*)(\\{)`).exec(html);
    if (!match) return null;

    const startIdx = match.index + match[0].length - 1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    const maxScan = Math.min(html.length, startIdx + 450000);

    for (let i = startIdx; i < maxScan; i++) {
        const ch = html[i];
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
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                const jsonSlice = html.slice(startIdx, i + 1);
                try {
                    return JSON.parse(jsonSlice);
                } catch (_err) {
                    return null;
                }
            }
        }
    }
    return null;
}

/**
 * Recursively find `"Song"` / `"Artist"` / `"Album"` credit rows inside `ytInitialData`
 * (the "Music in this video" info rows on YouTube watch pages).
 * @param {any} node
 * @param {object} acc
 * @param {number} depth
 */
function collectMusicCreditRows(node, acc, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 22) return;
    if (acc.album && acc.song && acc.artist) return;

    if (node.infoRowRenderer && typeof node.infoRowRenderer === 'object') {
        const row = node.infoRowRenderer;
        const label = String(row.title?.simpleText || row.title?.runs?.[0]?.text || '').trim().toLowerCase();
        const val = String(
            row.defaultMetadata?.simpleText ||
            (Array.isArray(row.defaultMetadata?.runs) ? row.defaultMetadata.runs.map(r => r.text).join('') : '') ||
            ''
        ).trim();
        if (val) {
            if ((label === 'album' || label === 'álbum' || label === '앨범') && !acc.album) acc.album = val;
            if ((label === 'song' || label === 'canción' || label === '노래') && !acc.song) acc.song = val;
            if ((label === 'artist' || label === 'artista' || label === '아티스트') && !acc.artist) acc.artist = val;
        }
    }

    if (Array.isArray(node)) {
        for (const item of node) {
            collectMusicCreditRows(item, acc, depth + 1);
            if (acc.album && acc.song && acc.artist) break;
        }
        return;
    }

    for (const key of Object.keys(node)) {
        if (key === 'contents' || key === 'engagementPanels' || key === 'structuredDescriptionContentRenderer' || key === 'horizontalCardListRenderer' || key === 'cards' || key === 'items' || key === 'infoRows' || key === 'videoDescriptionMusicSectionRenderer' || key === 'carouselLockups' || key === 'twoColumnWatchNextResults' || key === 'secondaryResults' || key === 'panel' || key === 'content') {
            collectMusicCreditRows(node[key], acc, depth + 1);
        }
    }
}

/**
 * Extract rich track metadata and embeddability from a YouTube `watch?v=...` HTML response.
 * @param {string} html
 * @returns {{ rawTitle: string|null, rawAuthor: string|null, description: string, publishYear: number|null, embeddable: boolean|null, creditSong: string|null, creditArtist: string|null, creditAlbum: string|null }}
 */
function extractYouTubeWatchPageMetadata(html) {
    const out = {
        rawTitle: null,
        rawAuthor: null,
        description: '',
        publishYear: null,
        embeddable: null,
        creditSong: null,
        creditArtist: null,
        creditAlbum: null,
        publishDate: null
    };
    if (!html || typeof html !== 'string') return out;

    const playerResp = extractAssignedJsonObject(html, 'ytInitialPlayerResponse');
    if (playerResp && typeof playerResp === 'object') {
        const details = playerResp.videoDetails || {};
        const micro = playerResp.microformat?.playerMicroformatRenderer || {};
        const playability = playerResp.playabilityStatus || {};

        if (details.title || micro.title?.simpleText) {
            out.rawTitle = String(details.title || micro.title.simpleText).trim();
        }
        if (details.author || micro.ownerChannelName) {
            out.rawAuthor = String(details.author || micro.ownerChannelName).trim();
        }
        if (details.shortDescription || micro.description?.simpleText) {
            out.description = String(details.shortDescription || micro.description.simpleText);
        }
        const dateStr = String(micro.publishDate || micro.uploadDate || '');
        const fullDateMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
        if (fullDateMatch) out.publishDate = fullDateMatch[1];
        const dateYear = dateStr.match(/^(\d{4})/);
        if (dateYear) {
            const yr = Number(dateYear[1]);
            if (yr >= 1900 && yr <= 2100) out.publishYear = yr;
        }
        if (typeof playability.playableInEmbed === 'boolean') {
            out.embeddable = playability.playableInEmbed;
        } else if (micro.embed && typeof micro.embed.iframeUrl === 'string') {
            out.embeddable = true;
        }
    } else {
        // Fallback lightweight meta/regex scan when full object wasn't balanced cleanly.
        const embedMatch = html.match(/"playableInEmbed"\s*:\s*(true|false)/);
        if (embedMatch) out.embeddable = embedMatch[1] === 'true';

        const ogTitle = html.match(/<meta\s+(?:property="og:title"|name="title")\s+content="([^"]+)"/i);
        if (ogTitle) out.rawTitle = decodeHtmlEntities(ogTitle[1]).trim();
    }

    // Look for "Music in this video" Song / Artist / Album lockup rows inside ytInitialData.
    const initialData = extractAssignedJsonObject(html, 'ytInitialData');
    if (initialData && typeof initialData === 'object') {
        const acc = { song: null, artist: null, album: null };
        collectMusicCreditRows(initialData, acc);
        out.creditSong = acc.song || null;
        out.creditArtist = acc.artist || null;
        out.creditAlbum = acc.album || null;
    } else {
        // Compact JSON pattern fallback for Album infoRowRenderer
        const albumCreditRegex = /"title"\s*:\s*\{"simpleText"\s*:\s*"(?:Album|Álbum|앨범)"\s*\}\s*,\s*"defaultMetadata"\s*:\s*\{[^}]*?"(?:simpleText|text)"\s*:\s*"([^"\\]{1,150})"/i;
        const mAlbum = html.match(albumCreditRegex);
        if (mAlbum) out.creditAlbum = decodeHtmlEntities(mAlbum[1]).trim();
    }

    return out;
}

/**
 * Combine oEmbed, optional YouTube Data API v3 item, watch HTML metadata, and user's MySQL catalog
 * into a unified, clean suggestion payload for Auto-fill.
 * @param {object} params
 * @param {string|null} [params.videoId]
 * @param {object|null} [params.oembed]
 * @param {object|null} [params.apiVideo] YouTube Data API v3 `videos` item (`snippet`, `status`)
 * @param {object|null} [params.watchMeta] Result from `extractYouTubeWatchPageMetadata`
 * @param {Array<object>} [params.catalogSongs] User's existing songs
 * @param {Array<object>} [params.catalogAlbums] User's existing albums
 * @returns {{ suggestedTitle: string|null, suggestedArtist: string|null, suggestedCollaborators: string, suggestedAlbumTitle: string|null, suggestedAlbumType: string, suggestedAlbumYear: number|null, embeddable: boolean|null }}
 */
function mergeResolvedTrackMetadata({
    videoId = null,
    oembed = null,
    apiVideo = null,
    watchMeta = null,
    catalogSongs = [],
    catalogAlbums = []
}) {
    const rawTitle =
        (apiVideo && apiVideo.snippet && apiVideo.snippet.title) ||
        (watchMeta && watchMeta.rawTitle) ||
        (oembed && oembed.title) ||
        '';

    const rawChannel =
        (apiVideo && apiVideo.snippet && apiVideo.snippet.channelTitle) ||
        (watchMeta && watchMeta.rawAuthor) ||
        (oembed && oembed.author_name) ||
        '';

    const description =
        (apiVideo && apiVideo.snippet && apiVideo.snippet.description) ||
        (watchMeta && watchMeta.description) ||
        '';

    const cleanFromTitle = parseCleanTrackAndArtist(rawTitle, rawChannel);
    const providedTrack = parseProvidedToYouTubeDescription(description);
    const descHints = parseGeneralDescriptionAlbumHints(description);

    let title = cleanFromTitle.title || rawTitle || null;
    let mainArtist = cleanFromTitle.mainArtist || null;
    const collabs = [...cleanFromTitle.collaborators];

    if (providedTrack) {
        if (providedTrack.title) title = providedTrack.title;
        if (providedTrack.mainArtist) mainArtist = providedTrack.mainArtist;
        providedTrack.collaborators.forEach(c => {
            if (!collabs.some(existing => normalizeLookupText(existing) === normalizeLookupText(c))) {
                collabs.push(c);
            }
        });
    }

    if (watchMeta && watchMeta.creditSong && (!title || title === rawTitle)) {
        title = watchMeta.creditSong.slice(0, 180);
    }
    if (watchMeta && watchMeta.creditArtist && !mainArtist) {
        const creditArtist = splitArtistCredits(watchMeta.creditArtist);
        mainArtist = creditArtist.mainArtist || mainArtist;
        creditArtist.collaborators.forEach(c => {
            if (!collabs.some(existing => normalizeLookupText(existing) === normalizeLookupText(c))) {
                collabs.push(c);
            }
        });
    }

    let albumTitle =
        (providedTrack && providedTrack.albumTitle) ||
        (watchMeta && watchMeta.creditAlbum) ||
        descHints.albumTitle ||
        null;

    let albumType =
        (providedTrack && providedTrack.albumType) ||
        descHints.albumType ||
        'album';

    let apiPublishYear = null;
    if (apiVideo && apiVideo.snippet && apiVideo.snippet.publishedAt) {
        const yrMatch = String(apiVideo.snippet.publishedAt).match(/^(\d{4})/);
        if (yrMatch) apiPublishYear = Number(yrMatch[1]);
    }

    let albumYear =
        (providedTrack && providedTrack.albumYear) ||
        descHints.albumYear ||
        apiPublishYear ||
        (watchMeta && watchMeta.publishYear) ||
        null;

    let embeddable = null;
    if (apiVideo && apiVideo.status && typeof apiVideo.status.embeddable === 'boolean') {
        embeddable = apiVideo.status.embeddable;
    } else if (watchMeta && typeof watchMeta.embeddable === 'boolean') {
        embeddable = watchMeta.embeddable;
    }

    // Cross-reference the user's catalog:
    // 1. If the videoId is already saved for this user, reuse its curated album metadata.
    const existingSong = videoId
        ? (catalogSongs || []).find(s => String(s.yt_video_id || '') === String(videoId))
        : null;
    if (existingSong && existingSong.album_titulo && !albumTitle) {
        albumTitle = existingSong.album_titulo;
        if (existingSong.album_tipo && VALID_RELEASE_TYPES.has(existingSong.album_tipo)) {
            albumType = existingSong.album_tipo;
        }
        if (existingSong.album_anio) {
            albumYear = Number(existingSong.album_anio);
        }
    }

    // 2. Match detected albumTitle (or title-track matching same artist's album, e.g. DRIP -> Drip)
    const artistNorm = normalizeLookupText(mainArtist);
    const albumNorm = normalizeLookupText(albumTitle);
    const titleNorm = normalizeLookupText(title);

    if (Array.isArray(catalogAlbums) && catalogAlbums.length) {
        let matchedAlbum = null;
        if (albumNorm) {
            matchedAlbum = catalogAlbums.find(al => {
                const alNorm = normalizeLookupText(al.titulo);
                const alArtistNorm = normalizeLookupText(al.artista_principal_nombre || al.artista_nombre || '');
                return alNorm === albumNorm && (!artistNorm || !alArtistNorm || alArtistNorm === artistNorm);
            }) || catalogAlbums.find(al => normalizeLookupText(al.titulo) === albumNorm);
        } else if (titleNorm) {
            // Only match an unnamed album if its normalized title equals the song title for the same artist (title track).
            matchedAlbum = catalogAlbums.find(al => {
                const alNorm = normalizeLookupText(al.titulo);
                const alArtistNorm = normalizeLookupText(al.artista_principal_nombre || al.artista_nombre || '');
                return alNorm === titleNorm && (!artistNorm || !alArtistNorm || alArtistNorm === artistNorm);
            });
        }

        if (matchedAlbum) {
            albumTitle = matchedAlbum.titulo;
            if (matchedAlbum.tipo_lanzamiento && VALID_RELEASE_TYPES.has(matchedAlbum.tipo_lanzamiento)) {
                albumType = matchedAlbum.tipo_lanzamiento;
            }
            const resolvedYear = matchedAlbum.anio || matchedAlbum.anio_lanzamiento;
            if (resolvedYear) {
                albumYear = Number(resolvedYear);
            }
        }
    }

    if (collabs.length > 0 && albumType === 'single') {
        albumType = 'collab_single';
    }

    const apiPublishDate = (apiVideo?.snippet?.publishedAt && String(apiVideo.snippet.publishedAt).slice(0, 10)) || null;
    const suggestedReleaseDate =
        (providedTrack && providedTrack.releaseDate) ||
        (watchMeta && watchMeta.publishDate) ||
        apiPublishDate ||
        null;

    return {
        suggestedTitle: title ? String(title).slice(0, 180) : null,
        suggestedArtist: mainArtist ? String(mainArtist).slice(0, 140) : null,
        suggestedCollaborators: collabs.join(', ').slice(0, 300),
        suggestedAlbumTitle: albumTitle ? String(albumTitle).slice(0, 180) : null,
        suggestedAlbumType: VALID_RELEASE_TYPES.has(albumType) ? albumType : 'album',
        suggestedAlbumYear: Number.isInteger(albumYear) && albumYear >= 1900 && albumYear <= 2100 ? albumYear : null,
        suggestedReleaseDate,
        embeddable
    };
}

/**
 * Convert `.srt`, `.vtt`, `.lrc`, or timestamped caption text into clean readable lyric lines
 * while stripping timestamps, cue indices, VTT headers, inline `<c>` tags, and rolling duplicates.
 * @param {string} rawText
 * @returns {string}
 */
function cleanCaptionTextToLyrics(rawText) {
    const normalized = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!normalized.trim()) return '';

    const rawLines = normalized.split('\n');
    const resultLines = [];
    let skippingVttBlock = false;

    for (const rawLine of rawLines) {
        let line = rawLine.trim();

        if (!line) {
            skippingVttBlock = false;
            continue;
        }
        if (/^(?:WEBVTT(?:\s|$)|Kind:|Language:)/i.test(line)) {
            continue;
        }
        if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(line)) {
            skippingVttBlock = true;
            continue;
        }
        if (skippingVttBlock) continue;

        // SRT sequence index or VTT timestamp lines
        if (/^\d+$/.test(line)) continue;
        if (/^(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{2,3}\s*-->\s*(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{2,3}/.test(line)) {
            continue;
        }

        // LRC metadata tags like [ar:...], [ti:...], [al:...], [by:...]
        if (/^\[(?:ar|ti|al|au|by|offset|re|ve|length)\s*:[^\]]*\]$/i.test(line)) {
            continue;
        }

        // Strip LRC inline timestamps `[01:23.45]` and YouTube `<00:01:23.456>` / `<c>` / `<i>` tags
        line = line
            .replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '')
            .replace(/<\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,3})?>/g, '')
            .replace(/<\/?[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        line = decodeHtmlEntities(line);
        if (!line) continue;

        // Avoid repeating identical consecutive lines caused by YouTube rolling auto-captions
        if (resultLines.length > 0 && resultLines[resultLines.length - 1] === line) {
            continue;
        }
        resultLines.push(line);
    }

    return resultLines.join('\n').trim();
}

module.exports = {
    parseCleanTrackAndArtist,
    parseProvidedToYouTubeDescription,
    parseGeneralDescriptionAlbumHints,
    extractYouTubeWatchPageMetadata,
    mergeResolvedTrackMetadata,
    cleanCaptionTextToLyrics,
    inferReleaseType
};
