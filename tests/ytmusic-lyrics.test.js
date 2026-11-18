'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedInnerTubeUrl, extractSongLyrics } = require('../lib/ytdlp-service');
const { parseLyricsFromBrowse } = require('../lib/ytmusic-lyrics');

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
});
