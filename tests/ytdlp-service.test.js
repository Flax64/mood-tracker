const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    extractValidYouTubeVideoId,
    buildCanonicalWatchUrl,
    isAllowedMediaCdnUrl,
    isAllowedCaptionUrl,
    resolveYtDlpBinary,
    cleanSubtitleText,
    parseWatchPageCaptionTracks,
    runYtDlp,
    extractSongLyrics,
    resolvePlayableMediaStream,
    getYtDlpStatus,
    clearMediaStreamCacheForTest
} = require('../lib/ytdlp-service');

describe('lib/ytdlp-service (yt-dlp multiplataforma, letras y streaming seguro)', () => {
    afterEach(() => {
        clearMediaStreamCacheForTest();
    });

    it('valida video IDs de YouTube/YTMusic y bloquea inyecciones', () => {
        assert.equal(extractValidYouTubeVideoId('Zp-Jhuhq0bQ'), 'Zp-Jhuhq0bQ');
        assert.equal(
            extractValidYouTubeVideoId('https://music.youtube.com/watch?v=Zp-Jhuhq0bQ&list=RDAMVMZp-Jhuhq0bQ'),
            'Zp-Jhuhq0bQ'
        );
        assert.equal(extractValidYouTubeVideoId('https://youtu.be/wgu98765432?t=12'), 'wgu98765432');
        assert.equal(extractValidYouTubeVideoId('https://www.youtube.com/shorts/abcDEF12345'), 'abcDEF12345');

        assert.equal(extractValidYouTubeVideoId('--exec "whoami"'), null);
        assert.equal(extractValidYouTubeVideoId('https://evil.example.com/watch?v=Zp-Jhuhq0bQ'), null);
        assert.equal(extractValidYouTubeVideoId('short'), null);
        assert.equal(buildCanonicalWatchUrl('Zp-Jhuhq0bQ'), 'https://www.youtube.com/watch?v=Zp-Jhuhq0bQ');
    });

    it('restringe URLs CDN y captions contra SSRF', () => {
        assert.equal(isAllowedMediaCdnUrl('https://rr1---sn-4g5e6nsz.googlevideo.com/videoplayback?id=1'), true);
        assert.equal(isAllowedMediaCdnUrl('https://www.youtube.com/watch?v=Zp-Jhuhq0bQ'), true);
        assert.equal(isAllowedMediaCdnUrl('http://rr1---sn-4g5e6nsz.googlevideo.com/videoplayback'), false);
        assert.equal(isAllowedMediaCdnUrl('https://169.254.169.254/latest/meta-data/'), false);
        assert.equal(isAllowedMediaCdnUrl('http://127.0.0.1:3000/api/auth'), false);

        assert.equal(isAllowedCaptionUrl('https://www.youtube.com/api/timedtext?v=Zp-Jhuhq0bQ'), true);
        assert.equal(isAllowedCaptionUrl('https://googlevideo.com/fake'), false);
    });

    it('resuelve YT_DLP_PATH en Windows y lo ignora en Linux Docker en favor de /usr/local/bin/yt-dlp', () => {
        const winPath = 'C:\\Users\\flavi\\Desktop\\Download Videos\\yt-dlp.exe';
        const winFs = {
            existsSync: (p) => p === winPath,
            statSync: () => ({ isDirectory: () => false })
        };
        const resWin = resolveYtDlpBinary({
            platform: 'win32',
            env: { YT_DLP_PATH: `"${winPath}"` },
            fsImpl: winFs
        });
        assert.equal(resWin.available, true);
        assert.equal(resWin.binPath, winPath);
        assert.equal(resWin.source, 'env:YT_DLP_PATH');

        // Directorio en lugar de archivo .exe
        const dirPath = 'C:\\Users\\flavi\\Desktop\\Download Videos';
        const dirFs = {
            existsSync: (p) => p === dirPath || p === winPath,
            statSync: (p) => ({ isDirectory: () => p === dirPath })
        };
        const resDir = resolveYtDlpBinary({
            platform: 'win32',
            env: { YT_DLP_PATH: dirPath },
            fsImpl: dirFs
        });
        assert.equal(resDir.available, true);
        assert.equal(resDir.binPath, winPath);

        // En contenedor Linux Docker con variable Windows heredada de GitHub
        const linuxFs = {
            existsSync: (p) => p === '/usr/local/bin/yt-dlp',
            statSync: () => ({ isDirectory: () => false })
        };
        const resLinux = resolveYtDlpBinary({
            platform: 'linux',
            env: { YT_DLP_PATH: winPath },
            fsImpl: linuxFs
        });
        assert.equal(resLinux.available, true);
        assert.equal(resLinux.binPath, '/usr/local/bin/yt-dlp');
        assert.equal(resLinux.skippedCrossOs, true);

        const statusLinux = getYtDlpStatus({
            platform: 'linux',
            env: { YT_DLP_PATH: winPath },
            fsImpl: linuxFs
        });
        assert.deepEqual(statusLinux, {
            available: true,
            source: 'os-default:linux',
            binaryName: 'yt-dlp',
            jsRuntime: 'node',
            skippedWindowsVarOnLinux: true
        });
    });

    it('limpia VTT/SRT/XML timedtext y parsea captionTracks del HTML watch page', () => {
        const cleaned = cleanSubtitleText(
            'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<c>Let them</c> talk!\n00:00:03.100 --> 00:00:04.500\nLet them talk!\n00:00:05.000 --> 00:00:07.000\nWe go up &amp; shine'
        );
        assert.equal(cleaned, 'Let them talk!\nWe go up & shine');

        const xmlCleaned = cleanSubtitleText(
            '<transcript><text start="0" dur="2">Line one</text><text start="2" dur="2">Line two</text></transcript>'
        );
        assert.equal(xmlCleaned, 'Line one\nLine two');

        const html = `<script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=Zp-Jhuhq0bQ\\u0026lang=en","name":{"simpleText":"English"},"languageCode":"en"},{"baseUrl":"https://evil.com/x","languageCode":"bad"}]}}};</script>`;
        const tracks = parseWatchPageCaptionTracks(html);
        assert.equal(tracks.length, 1);
        assert.equal(tracks[0].languageCode, 'en');
        assert.equal(tracks[0].isAutoGenerated, false);
        assert.equal(tracks[0].baseUrl, 'https://www.youtube.com/api/timedtext?v=Zp-Jhuhq0bQ&lang=en');
    });

    it('inyecta --js-runtimes node y reintenta automáticamente en versiones legacy sin ese flag', async () => {
        const calls = [];
        const mockExec = async (bin, args) => {
            calls.push(args);
            if (args.includes('--js-runtimes')) {
                const err = new Error('legacy failure');
                err.stderr = 'yt-dlp: error: unrecognized arguments: --js-runtimes';
                throw err;
            }
            return { stdout: 'ok', stderr: '' };
        };

        const out = await runYtDlp('/usr/local/bin/yt-dlp', ['--version'], { execFileImpl: mockExec });
        assert.equal(out.stdout, 'ok');
        assert.equal(calls.length, 2);
        assert.deepEqual(calls[0].slice(0, 2), ['--js-runtimes', 'node']);
        assert.equal(calls[1].includes('--js-runtimes'), false);
    });

    it('extrae letras limpias vía yt-dlp (archivo temporal limpiado en finally) y usa fallback watch-page cuando falta binario', async () => {
        // 1. Vía yt-dlp simulado escribiendo archivo VTT en carpeta temporal
        const mockExecSubs = async (_bin, args) => {
            const outIdx = args.indexOf('--output');
            const outTemplate = args[outIdx + 1];
            const vttFile = outTemplate.replace('%(id)s.%(ext)s', 'Zp-Jhuhq0bQ.en.vtt');
            await fs.promises.writeFile(
                vttFile,
                'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nBaby got that drip drip\n00:00:04.200 --> 00:00:07.000\nForever never fades\n',
                'utf8'
            );
            return { stdout: '', stderr: '' };
        };

        const extracted = await extractSongLyrics({
            videoId: 'Zp-Jhuhq0bQ',
            idioma: 'English + Korean',
            ytdlpPath: '/usr/local/bin/yt-dlp',
            execFileImpl: mockExecSubs
        });
        assert.equal(extracted.ok, true);
        assert.equal(extracted.source, 'yt-dlp:en');
        assert.equal(extracted.lyrics, 'Baby got that drip drip\nForever never fades');

        // 2. Fallback sin binario usando watch page captionTracks
        const emptyFs = {
            ...fs,
            existsSync: () => false
        };
        const mockFetch = async (targetUrl) => {
            if (targetUrl.includes('/watch?')) {
                return {
                    ok: true,
                    text: async () =>
                        '<script>{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=Zp-Jhuhq0bQ&lang=ko","languageCode":"ko","name":{"simpleText":"Korean"}}]}</script>'
                };
            }
            if (targetUrl.includes('/api/timedtext')) {
                return {
                    ok: true,
                    text: async () => 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n영원할 것처럼\n빛나는 지금'
                };
            }
            return { ok: false };
        };

        const fallbackRes = await extractSongLyrics({
            videoId: 'Zp-Jhuhq0bQ',
            idioma: 'English + Korean',
            env: {},
            platform: 'linux',
            fsImpl: emptyFs,
            fetchImpl: mockFetch
        });
        assert.equal(fallbackRes.ok, true);
        assert.equal(fallbackRes.source, 'youtube-captions');
        assert.equal(fallbackRes.lyrics, '영원할 것처럼\n빛나는 지금');
    });

    it('resuelve streams MP4 CDN directos con cache acotada y rechaza URLs no autorizadas', async () => {
        let execCount = 0;
        const mockExecStream = async () => {
            execCount += 1;
            return {
                stdout: JSON.stringify({
                    url: `https://rr2---sn-4g5ednsl.googlevideo.com/videoplayback?v=${execCount}`,
                    ext: 'mp4',
                    vcodec: 'avc1.42001E',
                    acodec: 'mp4a.40.2',
                    title: 'FOREVER',
                    duration: 213,
                    http_headers: { 'User-Agent': 'CustomUA/1.0' }
                }),
                stderr: ''
            };
        };

        const first = await resolvePlayableMediaStream({
            videoId: 'Zp-Jhuhq0bQ',
            ytdlpPath: '/usr/local/bin/yt-dlp',
            execFileImpl: mockExecStream
        });
        assert.equal(first.ok, true);
        assert.equal(first.contentType, 'video/mp4');
        assert.equal(execCount, 1);

        const second = await resolvePlayableMediaStream({
            videoId: 'Zp-Jhuhq0bQ',
            ytdlpPath: '/usr/local/bin/yt-dlp',
            execFileImpl: mockExecStream
        });
        assert.equal(second.ok, true);
        assert.equal(second.cached, true);
        assert.equal(execCount, 1);

        // forceRefresh vuelve a invocar yt-dlp
        const third = await resolvePlayableMediaStream({
            videoId: 'Zp-Jhuhq0bQ',
            ytdlpPath: '/usr/local/bin/yt-dlp',
            forceRefresh: true,
            execFileImpl: mockExecStream
        });
        assert.equal(third.ok, true);
        assert.equal(execCount, 2);

        // URL maliciosa fuera de *.googlevideo.com debe rechazarse
        const badExec = async () => ({
            stdout: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' }),
            stderr: ''
        });
        const blocked = await resolvePlayableMediaStream({
            videoId: 'wgu98765432',
            ytdlpPath: '/usr/local/bin/yt-dlp',
            execFileImpl: badExec
        });
        assert.equal(blocked.ok, false);
        assert.equal(blocked.reason, 'no_direct_stream');
    });
});
