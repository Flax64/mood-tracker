'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedInnerTubeUrl, extractSongLyrics } = require('../lib/ytdlp-service');
const {
    parseLyricsFromBrowse,
    extractTrackInfo,
    findSongCandidatesInSearch,
    fetchYouTubeMusicTrackMetadata,
    searchYouTubeMusicVideos
} = require('../lib/ytmusic-lyrics');

const LYRICS = 'Hello world\n안녕하세요\n\nこんにちは';
const nextWithTab = { tabs: [{ tabRenderer: { endpoint: { browseEndpoint: { browseId: 'MPLYt_abc' } } } }] };
const browse = { contents: { musicDescriptionShelfRenderer: { description: { runs: [{ text: LYRICS }] } } } };
const mkFetch = (routes) => async (url) => {
    const key = Object.keys(routes).find((k) => url.includes(`/v1/${k}`));
    const r = routes[key];
    if (typeof r === 'function') return r();
    return { ok: true, status: 200, json: async () => r };
};

test('ytmusic InnerTube', async (t) => {
    await t.test('anti-SSRF allowlist', () => {
        assert.equal(isAllowedInnerTubeUrl('https://music.youtube.com/youtubei/v1/next?prettyPrint=false'), true);
        for (const u of ['http://music.youtube.com/youtubei/v1/next', 'https://evil.com/youtubei/v1/next',
            'https://music.youtube.com.evil.com/youtubei/v1/next', 'https://music.youtube.com/other',
            'https://user@music.youtube.com/youtubei/v1/next', 'https://127.0.0.1/youtubei/v1/next']) {
            assert.equal(isAllowedInnerTubeUrl(u), false, u);
        }
    });
    await t.test('parses description shelf and timed lyrics', () => {
        assert.equal(parseLyricsFromBrowse(browse), LYRICS);
        const timed = { x: { timedLyricsData: [{ lyricLine: 'A' }, { lyricLine: '한국어' }] } };
        assert.equal(parseLyricsFromBrowse(timed), 'A\n한국어');
    });
    await t.test('extracts lyrics via InnerTube (opt-in) without yt-dlp', async () => {
        const res = await extractSongLyrics({
            videoId: 'PDs_wgMaG48', useInnerTube: true, env: {}, platform: 'linux',
            fetchImpl: mkFetch({ next: nextWithTab, browse })
        });
        assert.equal(res.ok, true);
        assert.equal(res.lyrics, LYRICS);
        assert.equal(res.source, 'ytmusic:innertube');
    });
    await t.test('429 / no lyrics falls through to yt-dlp path without throwing', async () => {
        for (const routes of [
            { next: () => ({ ok: false, status: 429, json: async () => ({}) }) },
            { next: {}, search: {} }
        ]) {
            const res = await extractSongLyrics({
                videoId: 'PDs_wgMaG48', useInnerTube: true, env: {}, platform: 'linux',
                fsImpl: { ...require('node:fs'), existsSync: () => false },
                fetchImpl: mkFetch(routes)
            });
            assert.equal(res.ok, false);
            assert.equal(res.reason, 'ytdlp_missing');
        }
    });

    await t.test('extractTrackInfo parses collaborators, album, year and ignores views; search ranks studio candidates over instrumental/karaoke', async () => {
        const nextPayload = {
            contents: {
                playlistPanelVideoRenderer: {
                    videoId: 'vid12345678',
                    title: { runs: [{ text: 'APT.' }] },
                    longBylineText: {
                        runs: [
                            { text: 'ROSÉ' },
                            { text: ' & ' },
                            { text: 'Bruno Mars' },
                            { text: ' • ' },
                            { text: 'rosie' },
                            { text: ' • ' },
                            { text: '2024' }
                        ]
                    }
                }
            }
        };
        const info = extractTrackInfo(nextPayload, 'vid12345678');
        assert.equal(info.title, 'APT.');
        assert.equal(info.artist, 'ROSÉ');
        assert.deepEqual(info.collaborators, ['Bruno Mars']);
        assert.equal(info.album, 'rosie');
        assert.equal(info.year, 2024);

        const nextWithViews = {
            contents: {
                playlistPanelVideoRenderer: {
                    videoId: 'vid87654321',
                    title: { runs: [{ text: 'Supernova' }] },
                    longBylineText: {
                        runs: [
                            { text: 'aespa' },
                            { text: ' • ' },
                            { text: '12M views' },
                            { text: ' • ' },
                            { text: '2:59' }
                        ]
                    }
                }
            }
        };
        const infoViews = extractTrackInfo(nextWithViews, 'vid87654321');
        assert.equal(infoViews.artist, 'aespa');
        assert.equal(infoViews.album, '');
        assert.equal(infoViews.year, null);

        const searchJson = {
            items: [
                {
                    musicResponsiveListItemRenderer: {
                        playlistItemData: { videoId: 'karaoke0001' },
                        flexColumns: [
                            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'DRIP (Instrumental Karaoke)' }] } } },
                            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Karaoke Star' }] } } }
                        ]
                    }
                },
                {
                    musicResponsiveListItemRenderer: {
                        playlistItemData: { videoId: 'remix000002' },
                        flexColumns: [
                            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'DRIP (Sped Up Remix)' }] } } },
                            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Nightcore DJ' }] } } }
                        ]
                    }
                },
                {
                    musicResponsiveListItemRenderer: {
                        playlistItemData: { videoId: 'official003' },
                        flexColumns: [
                            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'DRIP' }] } } },
                            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'BABYMONSTER • DRIP • 2024' }] } } }
                        ]
                    }
                }
            ]
        };
        const ranked = findSongCandidatesInSearch(searchJson, 'orig0000000', { title: 'DRIP', artist: 'BABYMONSTER' });
        assert.deepEqual(ranked, ['official003']);

        const metaRes = await fetchYouTubeMusicTrackMetadata({
            videoId: 'vid12345678',
            isAllowedUrl: isAllowedInnerTubeUrl,
            fetchImpl: mkFetch({ next: nextPayload })
        });
        assert.equal(metaRes.ok, true);
        assert.equal(metaRes.year, 2024);
        assert.deepEqual(metaRes.collaborators, ['Bruno Mars']);

        const altVidSearch = {
            items: [
                {
                    musicResponsiveListItemRenderer: {
                        playlistItemData: { videoId: 'mvOfficial1' },
                        flexColumns: [
                            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "DRIP (Official Lyric Video)" }] } } },
                            { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'BABYMONSTER' }] } } }
                        ]
                    }
                }
            ]
        };
        const vidSearchRes = await searchYouTubeMusicVideos({
            title: 'DRIP',
            artist: 'BABYMONSTER',
            excludeVideoId: 'artTrack001',
            isAllowedUrl: isAllowedInnerTubeUrl,
            fetchImpl: mkFetch({ search: altVidSearch })
        });
        assert.equal(vidSearchRes.ok, true);
        assert.deepEqual(vidSearchRes.videoIds, ['mvOfficial1']);
    });
});
