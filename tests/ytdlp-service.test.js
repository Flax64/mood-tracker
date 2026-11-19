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
    stripStandaloneLatinFromCjkLine,
    normalizePreferredLangs,
    getBaseLanguageCode,
    mapSectionTagToKey,
    isolateKoreanOnlyLyrics,
    isolateJapaneseLyrics,
    parseWatchPageCaptionTracks,
    runYtDlp,
    extractSongLyrics,
    resolvePlayableMediaStream,
    runWithHeavyTaskLock,
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

    it('extrae letras limpias vía yt-dlp (archivo temporal limpiado en finally) y evita fetch directo cuando falta binario o hay bot check', async () => {
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

        // 2. Sin binario yt-dlp: nunca debe hacer fetch directo a YouTube y debe sugerir el helper local de PC
        const emptyFs = {
            ...fs,
            existsSync: () => false
        };
        let fetchCalls = 0;
        const forbiddenFetch = async () => {
            fetchCalls += 1;
            throw new Error('Server must never fetch YouTube pages directly');
        };

        const missingRes = await extractSongLyrics({
            videoId: 'Zp-Jhuhq0bQ',
            idioma: 'English + Korean',
            env: {},
            platform: 'linux',
            fsImpl: emptyFs,
            fetchImpl: forbiddenFetch
        });
        assert.equal(fetchCalls, 0);
        assert.equal(missingRes.ok, false);
        assert.equal(missingRes.reason, 'ytdlp_missing');
        assert.equal(missingRes.ytdlpAvailable, false);
        assert.match(missingRes.suggestedCommand, /yt_lyrics_helper\.py/);
        assert.match(missingRes.error, /sincronizador\.py|yt_lyrics_helper\.py/);

        // 3. Si yt-dlp reporta bloqueo anti-bot/429, tampoco hace fetch directo y retorna bot_check
        const botBlockedExec = async () => {
            const err = new Error('ERROR: Sign in to confirm you are not a bot');
            err.stderr = "ERROR: [youtube] Zp-Jhuhq0bQ: Sign in to confirm you're not a bot.";
            throw err;
        };
        const botRes = await extractSongLyrics({
            videoId: 'Zp-Jhuhq0bQ',
            idioma: 'English + Korean',
            ytdlpPath: '/usr/local/bin/yt-dlp',
            execFileImpl: botBlockedExec,
            fetchImpl: forbiddenFetch
        });
        assert.equal(fetchCalls, 0);
        assert.equal(botRes.ok, false);
        assert.equal(botRes.reason, 'bot_check');
        assert.equal(botRes.ytdlpAvailable, true);
        assert.match(botRes.error, /anti-bot|sincronizador\.py/i);
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

    it('elimina pistas redundantes (en vs en-kn, ko vs ko-orig) y separa los 5 apartados (Original, KO, EN, JA, ES)', async () => {
        const mockExecMulti = async (_bin, args) => {
            const outIdx = args.indexOf('--output');
            const outTemplate = args[outIdx + 1];
            // Simular pista K-Pop con mezcla real EN + KR, variantes redundantes y JA/ES
            await fs.promises.writeFile(
                outTemplate.replace('%(id)s.%(ext)s', '2wA_b6YHjqQ.ko.vtt'),
                'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nBaby got no chill\n눈을 감고 느껴봐\n숨이 멎을 것만 같아\n',
                'utf8'
            );
            await fs.promises.writeFile(
                outTemplate.replace('%(id)s.%(ext)s', '2wA_b6YHjqQ.ko-orig.vtt'),
                'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nBaby got no chill\n눈을 감고 느껴봐\n숨이 멎을 것만 같아\n',
                'utf8'
            );
            await fs.promises.writeFile(
                outTemplate.replace('%(id)s.%(ext)s', '2wA_b6YHjqQ.en.vtt'),
                'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nClose your eyes and feel the rush\nWatch them stare when we pull up\n',
                'utf8'
            );
            await fs.promises.writeFile(
                outTemplate.replace('%(id)s.%(ext)s', '2wA_b6YHjqQ.en-kn.vtt'),
                'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nClose your eyes and feel the rush\nWatch them stare when we pull up\n',
                'utf8'
            );
            await fs.promises.writeFile(
                outTemplate.replace('%(id)s.%(ext)s', '2wA_b6YHjqQ.ja.vtt'),
                'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n目を閉じて感じて\n息が止まりそう\n',
                'utf8'
            );
            await fs.promises.writeFile(
                outTemplate.replace('%(id)s.%(ext)s', '2wA_b6YHjqQ.es-419.vtt'),
                'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nCierra los ojos y siente la vibra (Latam)\nMira cómo miran\n',
                'utf8'
            );
            await fs.promises.writeFile(
                outTemplate.replace('%(id)s.%(ext)s', '2wA_b6YHjqQ.es.vtt'),
                'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nCierra los ojos y siente la vibra\nMira cómo miran al llegar\n',
                'utf8'
            );
            return { stdout: '', stderr: '' };
        };

        const extracted = await extractSongLyrics({
            videoId: '2wA_b6YHjqQ',
            idioma: 'Korean + English',
            ytdlpPath: '/usr/local/bin/yt-dlp',
            execFileImpl: mockExecMulti
        });
        assert.equal(extracted.ok, true);
        assert.equal(typeof extracted.tracks, 'object');
        assert.deepEqual(Object.keys(extracted.tracks), ['original', 'ko', 'en', 'ja', 'es']);
        assert.equal(extracted.tracks.original, 'Baby got no chill\n눈을 감고 느껴봐\n숨이 멎을 것만 같아');
        assert.equal(extracted.tracks.ko, '눈을 감고 느껴봐\n숨이 멎을 것만 같아');
        assert.doesNotMatch(extracted.tracks.ko, /Baby got no chill/);
        assert.equal(extracted.tracks.en, 'Close your eyes and feel the rush\nWatch them stare when we pull up');
        assert.equal(extracted.tracks.ja, '目を閉じて感じて\n息が止まりそう');
        assert.equal(extracted.tracks.es, 'Cierra los ojos y siente la vibra\nMira cómo miran al llegar');
        assert.match(extracted.lyrics, /\[ORIGINAL\]\nBaby got no chill\n눈을 감고 느껴봐/);
        assert.match(extracted.lyrics, /\[KO\]\n눈을 감고 느껴봐/);
        assert.match(extracted.lyrics, /\[EN\]\nClose your eyes and feel the rush/);
        assert.match(extracted.lyrics, /\[JA\]\n目を閉じて感じて/);
        assert.match(extracted.lyrics, /\[ES\]\nCierra los ojos y siente la vibra/);
        assert.doesNotMatch(extracted.lyrics, /\[KO-ORIG\]|\[EN-KN\]|\[ES-419\]/i);
    });

    it('segmenta estrofas por pausas musicales (>=2.5s), bloques CJK continuos y aisla JP vs JP-EN', () => {
        const { segmentLyricsIntoStanzas } = require('../lib/youtube-metadata');
        const { classifyLyricsIntoFiveTracks } = require('../lib/ytdlp-service');
        const vttPaused = [
            'WEBVTT',
            '',
            '00:00:01.000 --> 00:00:03.000',
            '夜空に光る星',
            '',
            '00:00:03.200 --> 00:00:05.000',
            'Shining right now',
            '',
            '00:00:09.000 --> 00:00:11.000',
            'ずっと忘れない'
        ].join('\n');
        const cleanedPaused = cleanSubtitleText(vttPaused);
        assert.equal(cleanedPaused, '夜空に光る星\nShining right now\n\nずっと忘れない');

        const longTenLines = Array.from({ length: 10 }, (_, i) => `ライン${i + 1}`).join('\n');
        const segmented = segmentLyricsIntoStanzas(longTenLines);
        assert.equal(segmented.split('\n\n').length, 3);

        const jpHybrid = classifyLyricsIntoFiveTracks([
            { rawLanguage: 'ja', lyrics: 'Shining right now\n夜空に光る星\nずっと忘れない\nHold my hand' }
        ]);
        assert.ok(jpHybrid.original.includes('Shining right now') && jpHybrid.original.includes('夜空に光る星'));
        assert.equal(jpHybrid.ja, '夜空に光る星\nずっと忘れない');
    });

    it('serializa procesos pesados en FIFO (maxConcurrency = 1) con runWithHeavyTaskLock', async () => {
        let active = 0;
        let maxActive = 0;
        const order = [];

        const makeTask = (id, delayMs, shouldFail = false) =>
            runWithHeavyTaskLock(async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise((r) => setTimeout(r, delayMs));
                order.push(id);
                active -= 1;
                if (shouldFail) throw new Error(`boom-${id}`);
                return id;
            });

        const settled = await Promise.allSettled([
            makeTask(1, 25, false),
            makeTask(2, 15, true),
            makeTask(3, 10, false)
        ]);

        assert.equal(maxActive, 1, 'Nunca debe haber más de 1 tarea pesada concurrente');
        assert.deepEqual(order, [1, 2, 3]);
        assert.equal(settled[0].status, 'fulfilled');
        assert.equal(settled[0].value, 1);
        assert.equal(settled[1].status, 'rejected');
        assert.equal(settled[2].status, 'fulfilled');
        assert.equal(settled[2].value, 3);
    });

    it('separa [ORIGINAL]/[KO]/[EN]/[JA]/[ES] sin filtrar etiquetas, aisla coreano/japonés puros, extrae inglés mixto y enriquece ES desde YT sin IA', async () => {
        const { classifyLyricsIntoFiveTracks, cleanSubtitleText: cleanSub } = require('../lib/ytdlp-service');
        const { segmentLyricsIntoStanzas } = require('../lib/youtube-metadata');

        // 1. Etiquetas [ORIGINAL]/[KO]/[EN]/[ES] de Word no deben filtrarse como versos visibles ni perder [EN]/[ES]
        const fromWordTagged = classifyLyricsIntoFiveTracks([
            {
                rawLanguage: 'multi',
                lyrics: [
                    '[ORIGINAL]',
                    '끝없는 가치',
                    '[kkeut-eop-neun ga-chi]',
                    "When I dress I don't think so much",
                    '',
                    '[KO]',
                    '끝없는 가치',
                    '난 보란 듯이 forever',
                    '',
                    '[EN]',
                    "When I dress I don't think so much",
                    'I could be the GOAT',
                    '',
                    '[ES]',
                    'Cuando me visto no lo pienso tanto',
                    'Podría ser la mejor'
                ].join('\n')
            }
        ]);
        assert.doesNotMatch(fromWordTagged.original, /\[ORIGINAL\]|\[KO\]|\[EN\]|\[ES\]/);
        assert.equal(fromWordTagged.ko, '끝없는 가치\n난 보란 듯이');
        assert.equal(fromWordTagged.en, "When I dress I don't think so much\nI could be the GOAT");
        assert.doesNotMatch(fromWordTagged.en, /kkeut-eop-neun|끝없는/);
        assert.equal(fromWordTagged.es, 'Cuando me visto no lo pienso tanto\nPodría ser la mejor');

        // 2. K-Pop mixto sin pista EN separada debe poblar original (mixto), ko (coreano puro) y en (inglés)
        const kpopMixedSingle = classifyLyricsIntoFiveTracks([
            {
                rawLanguage: 'ko',
                lyrics: "When I dress I don't think so much\n끝없는 가치\n[kkeut-eop-neun ga-chi]\n난 보란 듯이 forever"
            }
        ]);
        assert.ok(kpopMixedSingle.original.includes('끝없는 가치') && kpopMixedSingle.original.includes("When I dress"));
        assert.equal(kpopMixedSingle.ko, '끝없는 가치\n난 보란 듯이');
        assert.equal(kpopMixedSingle.en, "When I dress I don't think so much");

        // 3. Monolingües puros (Coreano puro, Japonés puro) van directo a su idioma sin duplicar original
        const pureKo = classifyLyricsIntoFiveTracks([{ rawLanguage: 'ko', lyrics: '사랑해\n영원히 함께해' }]);
        assert.equal(pureKo.original, '');
        assert.equal(pureKo.ko, '사랑해\n영원히 함께해');
        assert.equal(pureKo.en, '');

        const pureJa = classifyLyricsIntoFiveTracks([{ rawLanguage: 'ja', lyrics: '夜空に光る星\nずっと忘れない' }]);
        assert.equal(pureJa.original, '');
        assert.equal(pureJa.ja, '夜空に光る星\nずっと忘れない');

        // 4. Saltos de línea (<br/>, \N) y estrofas en bloques largos aunque haya encabezado previo
        assert.equal(
            cleanSub('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nLine one<br/>Line two\n00:00:03.200 --> 00:00:05.000\nLine three\\NLine four'),
            'Line one\nLine two\nLine three\nLine four'
        );
        const longVerseWithHeader = `[Verse 1]\n\n${Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join('\n')}`;
        const segHeader = segmentLyricsIntoStanzas(longVerseWithHeader);
        assert.ok(segHeader.split('\n\n').length >= 3, 'Bloques largos de >=10 líneas deben dividirse en estrofas aun tras encabezado');

        // 5. InnerTube con enrichCaptions=true combina letra original con subtítulos oficiales en español sin gastar IA
        const fakeFetch = async (url) => {
            if (url.includes('/v1/next')) {
                return { ok: true, status: 200, json: async () => ({ tabs: [{ tabRenderer: { endpoint: { browseEndpoint: { browseId: 'MPLYt_kpop' } } } }] }) };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    contents: {
                        musicDescriptionShelfRenderer: {
                            description: { runs: [{ text: "Baby got no chill\n눈을 감고 느껴봐" }] }
                        }
                    }
                })
            };
        };
        const mockExecEs = async (_bin, args) => {
            const outIdx = args.indexOf('--output');
            const tpl = args[outIdx + 1];
            await fs.promises.writeFile(
                tpl.replace('%(id)s.%(ext)s', 'Zp-Jhuhq0bQ.es-419.vtt'),
                'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nLa nena no se calma\nCierra los ojos y siente\n',
                'utf8'
            );
            return { stdout: '', stderr: '' };
        };
        const enriched = await extractSongLyrics({
            videoId: 'Zp-Jhuhq0bQ',
            useInnerTube: true,
            enrichCaptions: true,
            ytdlpPath: '/usr/local/bin/yt-dlp',
            execFileImpl: mockExecEs,
            fetchImpl: fakeFetch
        });
        assert.equal(enriched.ok, true);
        assert.equal(enriched.tracks.ko, '눈을 감고 느껴봐');
        assert.equal(enriched.tracks.en, 'Baby got no chill');
        assert.equal(enriched.tracks.es, 'La nena no se calma\nCierra los ojos y siente');
    });

    it('normaliza idiomas predefinidos, limpia ad-libs con puntuación en CJK, separa pistas compuestas y reenvía cookies en streaming', async () => {
        // 1. Ad-libs / puntuación pegada en coreano y japonés sin corromper puntuación CJK genuina
        assert.equal(stripStandaloneLatinFromCjkLine('Baby, 사랑해 (forever)!'), '사랑해');
        assert.equal(stripStandaloneLatinFromCjkLine('사랑해, baby!'), '사랑해');
        assert.equal(stripStandaloneLatinFromCjkLine('사랑해, baby, 영원히'), '사랑해, 영원히');
        assert.equal(stripStandaloneLatinFromCjkLine("Don't stop 나를 믿어 (yeah, yeah)"), '나를 믿어');
        assert.equal(stripStandaloneLatinFromCjkLine('사랑해!'), '사랑해!');
        assert.equal(stripStandaloneLatinFromCjkLine('사랑해, 나도'), '사랑해, 나도');
        assert.equal(stripStandaloneLatinFromCjkLine('사랑해 (영원히)'), '사랑해 (영원히)');
        assert.equal(stripStandaloneLatinFromCjkLine('愛してる, my love!'), '愛してる');

        const kpopIso = isolateKoreanOnlyLyrics('Baby, 사랑해 (forever)!\n사랑해, 나도\nOnly English here');
        assert.equal(kpopIso, '사랑해\n사랑해, 나도');
        const jpopIso = isolateJapaneseLyrics('愛してる, my love!\n夢を見る (tonight)\nEnglish chorus line');
        assert.equal(jpopIso, '愛してる\n夢を見る');

        // 2. Prioridades en normalizePreferredLangs para todos los códigos y alias predefinidos
        assert.deepEqual(normalizePreferredLangs({ idioma: 'en' }), ['en', 'ko', 'es', 'ja']);
        assert.deepEqual(normalizePreferredLangs({ idioma: 'ko' }), ['ko', 'en', 'es', 'ja']);
        assert.deepEqual(normalizePreferredLangs({ idioma: 'en_ko' }), ['ko', 'en', 'es', 'ja']);
        assert.deepEqual(normalizePreferredLangs({ idioma: 'kpop' }), ['ko', 'en', 'es', 'ja']);
        assert.deepEqual(normalizePreferredLangs({ idioma: 'Coreano' }), ['ko', 'en', 'es', 'ja']);
        assert.deepEqual(normalizePreferredLangs({ idioma: 'ja' }), ['ja', 'en', 'ko', 'es']);
        assert.deepEqual(normalizePreferredLangs({ idioma: 'en_ja' }), ['ja', 'en', 'ko', 'es']);
        assert.deepEqual(normalizePreferredLangs({ idioma: 'jp-en' }), ['ja', 'en', 'ko', 'es']);
        assert.deepEqual(normalizePreferredLangs({ idioma: 'Japonés' }), ['ja', 'en', 'ko', 'es']);
        assert.deepEqual(normalizePreferredLangs({ idioma: 'es' }), ['es', 'en', 'ko', 'ja']);
        assert.deepEqual(normalizePreferredLangs({ idioma: 'Español' }), ['es', 'en', 'ko', 'ja']);

        // 3. Etiquetas y códigos compuestos (en_ko / en_ja / und)
        assert.equal(getBaseLanguageCode('en_ko'), 'original');
        assert.equal(getBaseLanguageCode('en_ja'), 'original');
        assert.equal(mapSectionTagToKey('EN_KO'), 'original');
        assert.equal(mapSectionTagToKey('EN-JA'), 'original');

        const { deduplicateAndFormatLyricTracks } = require('../lib/ytdlp-service');
        const genericMixed = deduplicateAndFormatLyricTracks([
            {
                rawLanguage: 'und',
                language: 'und',
                lyrics: 'Baby, 사랑해 (forever)!\nShining night together',
                source: 'mock-sub',
                score: 50
            },
            {
                rawLanguage: 'es',
                language: 'es',
                lyrics: 'Te amo por siempre\nNoche brillante juntos',
                source: 'mock-sub',
                score: 40
            }
        ], 5, { preferredLangs: ['ko', 'en', 'es', 'ja'] });
        assert.equal(genericMixed.tracks.ko, '사랑해');
        assert.equal(genericMixed.tracks.en, 'Shining night together');
        assert.equal(genericMixed.tracks.es, 'Te amo por siempre\nNoche brillante juntos');
        assert.ok(genericMixed.tracks.original.includes('사랑해') && genericMixed.tracks.original.includes('Shining night together'));

        // 4. resolvePlayableMediaStream pasa --cookies cuando YTDLP_COOKIES_PATH existe
        let capturedArgs = null;
        const mockFs = {
            ...fs,
            existsSync: (p) => String(p) === '/app/ytdlp-config/cookies.txt' || fs.existsSync(p)
        };
        const mockStreamExec = async (_bin, args) => {
            capturedArgs = args;
            return {
                stdout: JSON.stringify({
                    url: 'https://rr1---sn-example.googlevideo.com/videoplayback?id=123',
                    ext: 'mp4',
                    vcodec: 'avc1',
                    acodec: 'mp4a'
                }),
                stderr: ''
            };
        };
        const streamRes = await resolvePlayableMediaStream({
            videoId: 'Zp-Jhuhq0bQ',
            ytdlpPath: '/usr/local/bin/yt-dlp',
            env: { YTDLP_COOKIES_PATH: '/app/ytdlp-config/cookies.txt' },
            fsImpl: mockFs,
            execFileImpl: mockStreamExec
        });
        assert.equal(streamRes.ok, true);
        assert.ok(Array.isArray(capturedArgs));
        const ckIdx = capturedArgs.indexOf('--cookies');
        assert.ok(ckIdx >= 0 && capturedArgs[ckIdx + 1] === '/app/ytdlp-config/cookies.txt');
    });
});
