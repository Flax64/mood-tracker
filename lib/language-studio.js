'use strict';

const LANGUAGE_REGISTRY = [
    {
        id: 'en',
        code: 'en',
        label: 'English',
        nativeLabel: 'English',
        badge: 'EN',
        flag: '🇺🇸',
        supportsRomanization: false,
        defaultWordHint: 'e.g. Serendipity / Break down / Used to',
        studyFocus: [
            'Vocabulary & Collocations',
            'Phrasal Verbs & Idioms',
            'Connected Speech & Song Slang',
            'Grammar & Word Proofing'
        ]
    },
    {
        id: 'ko',
        code: 'ko',
        label: 'Korean',
        nativeLabel: '한국어',
        badge: 'KR',
        flag: '🇰🇷',
        supportsRomanization: true,
        defaultWordHint: 'e.g. 마음 (maeum) / -고 싶어요 / 사랑해',
        studyFocus: [
            'Hangul + Revised Romanization',
            'Particles (은/는 · 이/가 · 을/를 · 에서)',
            'Politeness Levels (-요 · -습니다 · 반말)',
            'Verb Stems & K-Drama Expressions'
        ]
    },
    {
        id: 'en_ko',
        code: 'en_ko',
        label: 'English + Korean (K-Pop)',
        nativeLabel: 'EN + 한국어 (K-Pop)',
        badge: 'K-POP EN+KR',
        flag: '🎵',
        supportsRomanization: true,
        defaultWordHint: 'e.g. 영원히 (yeongwonhi) · Golden Hour',
        studyFocus: [
            'Code-Switching (English + Hangul lines)',
            'Poetic & Metaphorical Lyrics Meaning',
            'Hangul Breakdown + Romanization',
            'Natural Idioms & Catchphrases'
        ]
    }
];

const RECOMMENDED_GEMINI_MODELS = [
    {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash (Recommended · Fast & Efficient)',
        notes: 'Best speed/quality balance for lyrics breakdown & grammar checks with 0 MB server RAM.'
    },
    {
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash-Lite (Ultra Fast · High Free Quota)',
        notes: 'Lightweight fast responses ideal for instant quick translations.'
    },
    {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro (Deep Reasoning & Poetry Nuance)',
        notes: 'Best for nuanced song metaphors, honorifics, and detailed grammar comparisons.'
    },
    {
        id: 'gemini-flash-latest',
        label: 'Gemini Flash Latest (Auto-Updated Flash Alias)',
        notes: 'Always points to Google AI Studio current default Flash model.'
    }
];

const GEMINI_FALLBACK_ORDER = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-flash-latest',
    'gemini-2.5-pro'
];

const POISONED_MEMORY_REGEX = /(?:Activa Google Gemini API en Settings|Sin traducción exacta en diccionario local|Sin conexión a Gemini|Requiere Google Gemini API|Configura tu GEMINI_API_KEY|Palabra no está en el diccionario local|Add personal translation\/meaning here|Gemini HTTP \d+)/i;

function isPoisonedMemoryMeaning(value) {
    const clean = String(value || '').trim();
    return Boolean(clean && POISONED_MEMORY_REGEX.test(clean));
}

const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MEDIALS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINALS = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
// Smooth liaison sound when final coda links into a vowel-initial next syllable (초성 ㅇ)
const FINALS_LIAISON = {
    1: { coda: '', onset: 'g' },     // ㄱ -> g
    2: { coda: '', onset: 'kk' },    // ㄲ -> kk
    3: { coda: 'k', onset: 's' },    // ㄳ -> k-s
    4: { coda: '', onset: 'n' },     // ㄴ -> n
    5: { coda: 'n', onset: 'j' },    // ㄵ -> n-j
    6: { coda: 'n', onset: '' },     // ㄶ -> n (ㅎ silent)
    7: { coda: '', onset: 'd' },     // ㄷ -> d
    8: { coda: '', onset: 'r' },     // ㄹ -> r
    9: { coda: 'l', onset: 'g' },    // ㄺ -> l-g
    10: { coda: 'l', onset: 'm' },   // ㄻ -> l-m
    11: { coda: 'l', onset: 'b' },   // ㄼ -> l-b
    14: { coda: 'l', onset: 'p' },   // ㄿ -> l-p
    15: { coda: 'l', onset: '' },    // ㅀ -> l (ㅎ silent)
    16: { coda: '', onset: 'm' },    // ㅁ -> m
    17: { coda: '', onset: 'b' },    // ㅂ -> b
    18: { coda: 'p', onset: 's' },   // ㅄ -> p-s (없어 -> eopseo)
    19: { coda: '', onset: 's' },    // ㅅ -> s
    20: { coda: '', onset: 'ss' },   // ㅆ -> ss
    21: { coda: 'ng', onset: '' },   // ㅇ stays ng
    22: { coda: '', onset: 'j' },    // ㅈ -> j
    23: { coda: '', onset: 'ch' },   // ㅊ -> ch
    24: { coda: '', onset: 'k' },    // ㅋ -> k
    25: { coda: '', onset: 't' },    // ㅌ -> t
    26: { coda: '', onset: 'p' },    // ㅍ -> p
    27: { coda: '', onset: '' }      // ㅎ drops softly before vowel
};

const COMPAT_JAMO = {
    'ㄱ': 'g', 'ㄲ': 'kk', 'ㄴ': 'n', 'ㄷ': 'd', 'ㄸ': 'tt', 'ㄹ': 'r', 'ㅁ': 'm',
    'ㅂ': 'b', 'ㅃ': 'pp', 'ㅅ': 's', 'ㅆ': 'ss', 'ㅇ': 'ng', 'ㅈ': 'j', 'ㅉ': 'jj',
    'ㅊ': 'ch', 'ㅋ': 'k', 'ㅌ': 't', 'ㅍ': 'p', 'ㅎ': 'h',
    'ㅏ': 'a', 'ㅐ': 'ae', 'ㅑ': 'ya', 'ㅒ': 'yae', 'ㅓ': 'eo', 'ㅔ': 'e', 'ㅕ': 'yeo',
    'ㅖ': 'ye', 'ㅗ': 'o', 'ㅘ': 'wa', 'ㅙ': 'wae', 'ㅚ': 'oe', 'ㅛ': 'yo', 'ㅜ': 'u',
    'ㅝ': 'wo', 'ㅞ': 'we', 'ㅟ': 'wi', 'ㅠ': 'yu', 'ㅡ': 'eu', 'ㅢ': 'ui', 'ㅣ': 'i'
};

const KOREAN_LEXICON = [
    { ko: '사랑해', rom: 'saranghae', en: 'I love you (casual/intimate)', cat: 'vocabulary' },
    { ko: '사랑', rom: 'sarang', en: 'Love', cat: 'vocabulary' },
    { ko: '마음', rom: 'maeum', en: 'Heart / Mind / Feelings', cat: 'vocabulary' },
    { ko: '보고 싶어', rom: 'bogo sipeo', en: 'I miss you / want to see you', cat: 'vocabulary' },
    { ko: '영원히', rom: 'yeongwonhi', en: 'Forever / Eternally', cat: 'vocabulary' },
    { ko: '시간', rom: 'sigan', en: 'Time', cat: 'vocabulary' },
    { ko: '기억', rom: 'gieok', en: 'Memory', cat: 'vocabulary' },
    { ko: '눈물', rom: 'nunmul', en: 'Tears', cat: 'vocabulary' },
    { ko: '미소', rom: 'miso', en: 'Smile', cat: 'vocabulary' },
    { ko: '약속', rom: 'yaksok', en: 'Promise', cat: 'vocabulary' },
    { ko: '우리', rom: 'uri', en: 'We / Us / Our', cat: 'vocabulary' },
    { ko: '너', rom: 'neo', en: 'You (informal)', cat: 'vocabulary' },
    { ko: '나', rom: 'na', en: 'I / Me (informal)', cat: 'vocabulary' },
    { ko: '오늘', rom: 'oneul', en: 'Today', cat: 'vocabulary' },
    { ko: '내일', rom: 'naeil', en: 'Tomorrow', cat: 'vocabulary' },
    { ko: '지금', rom: 'jigeum', en: 'Now', cat: 'vocabulary' },
    { ko: '항상', rom: 'hangsang', en: 'Always', cat: 'vocabulary' },
    { ko: '함께', rom: 'hamkke', en: 'Together', cat: 'vocabulary' },
    { ko: '혼자', rom: 'honja', en: 'Alone', cat: 'vocabulary' },
    { ko: '다시', rom: 'dasi', en: 'Again', cat: 'vocabulary' },
    { ko: '세상', rom: 'sesang', en: 'World', cat: 'vocabulary' },
    { ko: '밤', rom: 'bam', en: 'Night', cat: 'vocabulary' },
    { ko: '별', rom: 'byeol', en: 'Star', cat: 'vocabulary' },
    { ko: '빛', rom: 'bit', en: 'Light', cat: 'vocabulary' },
    { ko: '꿈', rom: 'kkum', en: 'Dream', cat: 'vocabulary' },
    { ko: '행복', rom: 'haengbok', en: 'Happiness', cat: 'vocabulary' },
    { ko: '괜찮아', rom: 'gwaenchana', en: "It's okay / I'm alright", cat: 'vocabulary' },
    { ko: '고마워', rom: 'gomawo', en: 'Thank you (informal)', cat: 'vocabulary' },
    { ko: '미안해', rom: 'mianhae', en: 'I am sorry (informal)', cat: 'vocabulary' },
    { ko: '안녕', rom: 'annyeong', en: 'Hi / Bye (informal)', cat: 'vocabulary' },
    { ko: '진짜', rom: 'jinjja', en: 'Really / Truly', cat: 'vocabulary' },
    { ko: '정말', rom: 'jeongmal', en: 'Really / Honestly', cat: 'vocabulary' },
    { ko: '너무', rom: 'neomu', en: 'So / Too much / Very', cat: 'vocabulary' },
    { ko: '심장', rom: 'simjang', en: 'Heart (physical/beating)', cat: 'vocabulary' },
    { ko: '운명', rom: 'unmyeong', en: 'Destiny / Fate', cat: 'vocabulary' },
    { ko: '고 싶어', rom: 'go sipeo', en: 'Want to [verb] (-고 싶다)', cat: 'grammar' },
    { ko: '지 마', rom: 'ji ma', en: "Don't [verb] (-지 말다)", cat: 'grammar' },
    { ko: '처럼', rom: 'cheoreom', en: 'Like / As (~처럼)', cat: 'grammar' },
    { ko: '까지', rom: 'kkaji', en: 'Until / Even (~까지)', cat: 'grammar' },
    { ko: '에서', rom: 'eseo', en: 'At / From [action location]', cat: 'grammar' },
    { ko: '지만', rom: 'jiman', en: 'But / Even though (~지만)', cat: 'grammar' },
    { ko: '니까', rom: 'nikka', en: 'Because / Since (~니까)', cat: 'grammar' }
];

const ENGLISH_PATTERNS = [
    { re: /\bbreak\s+down\b/i, term: 'break down', cat: 'phrasal_verb', meaning: 'Lose emotional control or stop working; also analyze step by step.' },
    { re: /\bhold\s+on\b/i, term: 'hold on', cat: 'phrasal_verb', meaning: 'Wait a moment, or keep persevering through hard times.' },
    { re: /\blet\s+(?:it\s+)?go\b/i, term: 'let go', cat: 'phrasal_verb', meaning: 'Release emotionally, forgive, or stop holding tightly.' },
    { re: /\bfall\s+apart\b/i, term: 'fall apart', cat: 'phrasal_verb', meaning: 'Break emotionally or disintegrate under pressure.' },
    { re: /\bfade\s+away\b/i, term: 'fade away', cat: 'phrasal_verb', meaning: 'Gradually disappear or lose intensity (memories, sound, light).' },
    { re: /\blight\s+(?:me\s+|it\s+)?up\b/i, term: 'light up', cat: 'phrasal_verb', meaning: 'Illuminate or suddenly become happy/excited.' },
    { re: /\brun\s+away\b/i, term: 'run away', cat: 'phrasal_verb', meaning: 'Escape from a place, situation, or feeling.' },
    { re: /\bgive\s+up\b/i, term: 'give up', cat: 'phrasal_verb', meaning: 'Stop trying or surrender.' },
    { re: /\bwake\s+up\b/i, term: 'wake up', cat: 'phrasal_verb', meaning: 'Stop sleeping or realize a truth.' },
    { re: /\bcome\s+back\b/i, term: 'come back', cat: 'phrasal_verb', meaning: 'Return to a person, place, or state.' },
    { re: /\bturn\s+around\b/i, term: 'turn around', cat: 'phrasal_verb', meaning: 'Change direction physically or reverse a situation.' },
    { re: /\bfigure\s+(?:it\s+)?out\b/i, term: 'figure out', cat: 'phrasal_verb', meaning: 'Understand or solve something after thinking.' },
    { re: /\bmove\s+on\b/i, term: 'move on', cat: 'phrasal_verb', meaning: 'Accept a change and continue forward in life.' },
    { re: /\bget\s+over\b/i, term: 'get over', cat: 'phrasal_verb', meaning: 'Recover emotionally from disappointment or hardship.' },
    { re: /\bgonna\b/i, term: 'gonna', cat: 'grammar', meaning: 'Spoken/lyric contraction of "going to" (future plan or prediction).' },
    { re: /\bwanna\b/i, term: 'wanna', cat: 'grammar', meaning: 'Spoken/lyric contraction of "want to".' },
    { re: /\bgotta\b/i, term: 'gotta', cat: 'grammar', meaning: 'Informal contraction of "(have) got to" = must / have to.' },
    { re: /\bain't\b/i, term: "ain't", cat: 'grammar', meaning: 'Colloquial negative used in lyrics for am not / is not / are not / have not.' }
];

function isHangulSyllableCode(code) {
    return code >= 0xAC00 && code <= 0xD7A3;
}

function hangulToRomanization(text) {
    const src = String(text || '');
    if (!src) return '';

    const chars = Array.from(src);
    const nextOnsets = Object.create(null);
    let out = '';

    for (let i = 0; i < chars.length; i += 1) {
        const ch = chars[i];
        const code = ch.charCodeAt(0);
        if (isHangulSyllableCode(code)) {
            const offset = code - 0xAC00;
            const initialIdx = Math.floor(offset / (21 * 28));
            const medialIdx = Math.floor((offset % (21 * 28)) / 28);
            const finalIdx = offset % 28;

            let onset = INITIALS[initialIdx];
            const vowel = MEDIALS[medialIdx];
            let coda = FINALS[finalIdx];

            // Look ahead for smooth liaison when current syllable ends with consonant and next begins with ㅇ
            let nextForceOnset = null;
            if (i + 1 < chars.length) {
                const nextCode = chars[i + 1].charCodeAt(0);
                if (isHangulSyllableCode(nextCode)) {
                    const nextOffset = nextCode - 0xAC00;
                    const nextInitialIdx = Math.floor(nextOffset / (21 * 28));
                    if (nextInitialIdx === 11 && finalIdx !== 0 && FINALS_LIAISON[finalIdx]) {
                        coda = FINALS_LIAISON[finalIdx].coda;
                        nextForceOnset = FINALS_LIAISON[finalIdx].onset;
                    } else if (finalIdx === 1 && (nextInitialIdx === 2 || nextInitialIdx === 6)) {
                        // ㄱ nasalization before ㄴ/ㅁ
                        coda = 'ng';
                    } else if ((finalIdx === 17 || finalIdx === 26) && (nextInitialIdx === 2 || nextInitialIdx === 6)) {
                        // ㅂ/ㅍ nasalization before ㄴ/ㅁ
                        coda = 'm';
                    }
                }
            }

            // Apply previous syllable liaison onset if vowel-initial ㅇ
            if (nextOnsets[i] !== undefined) {
                onset = nextOnsets[i];
            }
            if (nextForceOnset !== null) {
                nextOnsets[i + 1] = nextForceOnset;
            }

            out += onset + vowel + coda;
        } else if (COMPAT_JAMO[ch]) {
            out += COMPAT_JAMO[ch];
        } else {
            out += ch;
        }
    }

    return out.replace(/\s+/g, ' ').trim();
}

function detectScriptKind(line) {
    const hasHangul = /[\uAC00-\uD7A3\u3131-\u318E]/.test(line);
    const hasLatin = /[A-Za-z]/.test(line);
    if (hasHangul && hasLatin) return 'mixed-kpop';
    if (hasHangul) return 'korean';
    if (hasLatin) return 'english';
    return 'neutral';
}

function getLanguageRegistry() {
    return LANGUAGE_REGISTRY.map((lang) => ({ ...lang, studyFocus: [...lang.studyFocus] }));
}

function normalizeStudyLanguage(raw) {
    const val = String(raw || '').trim().toLowerCase();
    if (!val || val === 'english' || val === 'en' || val === 'inglés' || val === 'ingles') return 'en';
    if (val === 'ko' || val === 'kr' || val === 'korean' || val === 'coreano' || val === '한국어') return 'ko';
    if (
        val === 'en_ko'
        || val === 'en-kr'
        || val === 'en+kr'
        || val === 'kpop'
        || val === 'k-pop'
        || val.includes('korean')
        || val.includes('coreano')
        || val.includes('kr')
    ) {
        return 'en_ko';
    }
    return 'en';
}

function sanitizeLanguageMemory(raw = {}) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const rawTerms = Array.isArray(src.terms) ? src.terms : [];
    const seen = new Map();

    for (const item of rawTerms) {
        if (!item || typeof item !== 'object') continue;
        const term = String(item.term || item.word || '').trim().slice(0, 120);
        if (!term) continue;
        const key = term.toLowerCase();
        const romanization = String(item.romanization || '').trim().slice(0, 140)
            || (/[\uAC00-\uD7A3]/.test(term) ? hangulToRomanization(term) : '');
        const meaning = String(item.meaning || '').trim().slice(0, 260);
        if (isPoisonedMemoryMeaning(meaning)) continue;
        const category = ['vocabulary', 'grammar', 'phrasal_verb'].includes(item.category)
            ? item.category
            : 'vocabulary';
        const language = normalizeStudyLanguage(item.language || (/[\uAC00-\uD7A3]/.test(term) ? 'ko' : 'en'));
        const count = Math.max(1, Math.min(999, Number(item.count) || 1));
        const updatedAt = String(item.updatedAt || '').slice(0, 30) || new Date().toISOString();

        if (!seen.has(key)) {
            seen.set(key, { term, romanization, meaning, category, language, count, updatedAt });
        } else {
            const prev = seen.get(key);
            if (!prev.meaning && meaning) prev.meaning = meaning;
            if (!prev.romanization && romanization) prev.romanization = romanization;
        }
        if (seen.size >= 100) break;
    }

    const grammarNotes = Array.isArray(src.grammarNotes)
        ? Array.from(new Set(src.grammarNotes.map((g) => String(g || '').trim().slice(0, 240)).filter((g) => g && !isPoisonedMemoryMeaning(g)))).slice(0, 40)
        : [];

    const songs = Array.isArray(src.songs)
        ? Array.from(new Set(src.songs.map((s) => String(s || '').trim().slice(0, 180)).filter(Boolean))).slice(0, 40)
        : [];

    const customContext = String(src.customContext || '').trim().slice(0, 500);

    return {
        terms: Array.from(seen.values()),
        grammarNotes,
        songs,
        customContext,
        updatedAt: String(src.updatedAt || '').slice(0, 30) || null
    };
}

function mergeLanguageMemory(existing = {}, addition = {}) {
    const mem = sanitizeLanguageMemory(existing);
    const nowIso = new Date().toISOString();
    const byKey = new Map();
    for (const item of mem.terms) {
        byKey.set(item.term.toLowerCase(), { ...item });
    }

    const incomingTerms = Array.isArray(addition.terms) ? addition.terms : [];
    for (const rawItem of incomingTerms) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        const term = String(rawItem.term || rawItem.word || '').trim().slice(0, 120);
        if (!term) continue;
        const key = term.toLowerCase();
        const romanization = String(rawItem.romanization || '').trim().slice(0, 140)
            || (/[\uAC00-\uD7A3]/.test(term) ? hangulToRomanization(term) : '');
        const meaning = String(rawItem.meaning || '').trim().slice(0, 260);
        if (isPoisonedMemoryMeaning(meaning)) continue;
        const category = ['vocabulary', 'grammar', 'phrasal_verb'].includes(rawItem.category)
            ? rawItem.category
            : 'vocabulary';
        const language = normalizeStudyLanguage(rawItem.language || addition.language || (/[\uAC00-\uD7A3]/.test(term) ? 'ko' : 'en'));

        if (byKey.has(key)) {
            const prev = byKey.get(key);
            byKey.delete(key);
            byKey.set(key, {
                ...prev,
                romanization: prev.romanization || romanization,
                meaning: prev.meaning || meaning,
                category: prev.category || category,
                count: Math.min(999, (prev.count || 1) + 1),
                updatedAt: nowIso
            });
        } else {
            byKey.set(key, {
                term,
                romanization,
                meaning,
                category,
                language,
                count: 1,
                updatedAt: nowIso
            });
        }
    }

    // Most recently added/reviewed first, capped at 100 items
    const mergedTerms = Array.from(byKey.values()).reverse().slice(0, 100);

    const incomingGrammar = Array.isArray(addition.grammarNotes) ? addition.grammarNotes : [];
    const mergedGrammar = Array.from(new Set([
        ...incomingGrammar.map((g) => String(g || '').trim().slice(0, 240)).filter(Boolean),
        ...mem.grammarNotes
    ])).slice(0, 40);

    const songLabel = [addition.songTitle, addition.artistName].map((s) => String(s || '').trim()).filter(Boolean).join(' - ');
    const incomingSongs = [
        ...(songLabel ? [songLabel] : []),
        ...(Array.isArray(addition.songs) ? addition.songs : [])
    ].map((s) => String(s || '').trim().slice(0, 180)).filter(Boolean);

    const mergedSongs = Array.from(new Set([...incomingSongs, ...mem.songs])).slice(0, 40);
    const customContext = addition.customContext !== undefined
        ? String(addition.customContext || '').trim().slice(0, 500)
        : mem.customContext;

    return {
        terms: mergedTerms,
        grammarNotes: mergedGrammar,
        songs: mergedSongs,
        customContext,
        updatedAt: nowIso
    };
}

function findRecognizedMemoryTerms(sourceText = '', learningMemory = {}) {
    const cleanSource = String(sourceText || '').toLowerCase();
    if (!cleanSource) return [];
    const mem = sanitizeLanguageMemory(learningMemory);
    const recognized = [];
    for (const item of mem.terms) {
        const needle = item.term.toLowerCase();
        if (needle.length >= 2 && cleanSource.includes(needle)) {
            recognized.push(item);
        }
    }
    return recognized.slice(0, 12);
}

function matchRepertoireSongs({ sourceText = '', songTitle = '', artistName = '', repertoire = [] } = {}) {
    if (!Array.isArray(repertoire) || !repertoire.length) return [];
    const haystack = [sourceText, songTitle, artistName].filter(Boolean).join(' ').toLowerCase();
    const matches = [];
    for (const song of repertoire) {
        if (!song || !song.titulo) continue;
        const cleanTitle = String(song.titulo || '').trim();
        const artistsList = Array.isArray(song.artistas) ? song.artistas : [];
        const cleanAlbum = String(song.album || '').trim();
        const titleHit = songTitle && cleanTitle.toLowerCase() === String(songTitle).trim().toLowerCase();
        const textTitleHit = cleanTitle.length >= 2 && haystack.includes(cleanTitle.toLowerCase());
        const artistHit = artistsList.some((a) => String(a || '').trim().length >= 2 && haystack.includes(String(a).toLowerCase()));
        if (titleHit || textTitleHit || artistHit) {
            matches.push({
                id: song.id || null,
                titulo: cleanTitle,
                artistas: artistsList,
                album: cleanAlbum,
                idioma: song.idioma || '',
                estado: song.estado || 'to_study',
                enfoque: song.enfoque || '',
                exactTitleMatch: Boolean(titleHit || textTitleHit)
            });
        }
    }
    matches.sort((a, b) => Number(b.exactTitleMatch) - Number(a.exactTitleMatch));
    return matches.slice(0, 8);
}

function analyzeTextOffline({
    text = '',
    question = '',
    language = 'en',
    songTitle = '',
    artistName = '',
    learningMemory = null,
    repertoire = [],
    fallbackReason = null
}) {
    const sourceText = String(text || question || '').trim().slice(0, 10000);
    const normLang = normalizeStudyLanguage(language);
    const rawLines = sourceText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 60);
    const mem = sanitizeLanguageMemory(learningMemory);
    const recognizedFromMemory = findRecognizedMemoryTerms(sourceText, mem);
    const repertoireList = Array.isArray(repertoire) ? repertoire.slice(0, 60) : [];
    const matchedRepertoireSongs = matchRepertoireSongs({ sourceText, songTitle, artistName, repertoire: repertoireList });

    let englishLines = 0;
    let koreanLines = 0;
    let mixedLines = 0;

    const vocabulary = [];
    const seenTerms = new Set();
    const grammarNotes = [];

    // 0. Prioritize user's previously learned terms so explanations stay 100% consistent!
    for (const memItem of recognizedFromMemory) {
        const key = memItem.term.toLowerCase();
        if (!seenTerms.has(key)) {
            seenTerms.add(key);
            vocabulary.push({
                term: memItem.term,
                romanization: memItem.romanization || (/[\uAC00-\uD7A3]/.test(memItem.term) ? hangulToRomanization(memItem.term) : ''),
                meaning: memItem.meaning || 'Previously studied term in your AI Learning Memory',
                category: memItem.category || 'vocabulary',
                example: rawLines.find((l) => l.toLowerCase().includes(key)) || memItem.term,
                learnedPreviously: true,
                reviewCount: memItem.count || 1
            });
        }
    }

    for (const item of KOREAN_LEXICON) {
        const key = item.ko.toLowerCase();
        if (sourceText.includes(item.ko) && !seenTerms.has(key)) {
            seenTerms.add(key);
            vocabulary.push({
                term: item.ko,
                romanization: item.rom,
                meaning: item.en,
                category: item.cat,
                example: rawLines.find((l) => l.includes(item.ko)) || item.ko,
                learnedPreviously: false
            });
        }
    }

    for (const pat of ENGLISH_PATTERNS) {
        const key = pat.term.toLowerCase();
        if (pat.re.test(sourceText) && !seenTerms.has(key)) {
            seenTerms.add(key);
            vocabulary.push({
                term: pat.term,
                romanization: '',
                meaning: pat.meaning,
                category: pat.cat,
                example: rawLines.find((l) => pat.re.test(l)) || pat.term,
                learnedPreviously: false
            });
        }
    }

    const lines = rawLines.map((line) => {
        const script = detectScriptKind(line);
        if (script === 'english') englishLines += 1;
        else if (script === 'korean') koreanLines += 1;
        else if (script === 'mixed-kpop') mixedLines += 1;

        const romanization = (script === 'korean' || script === 'mixed-kpop')
            ? hangulToRomanization(line)
            : '';

        const matchedTerms = vocabulary
            .filter((v) => line.toLowerCase().includes(v.term.toLowerCase()))
            .map((v) => `${v.term}${v.romanization ? ` (${v.romanization})` : ''}: ${v.meaning}`);

        let explanation = '';
        if (script === 'mixed-kpop') {
            explanation = matchedTerms.length
                ? `K-Pop EN+KR code-switching line. Key elements -> ${matchedTerms.slice(0, 3).join(' | ')}`
                : 'K-Pop bilingual line mixing English hook phrasing with Korean Hangul (see Revised Romanization above to sing along).';
        } else if (script === 'korean') {
            explanation = matchedTerms.length
                ? `Korean line key breakdown -> ${matchedTerms.slice(0, 3).join(' | ')}`
                : 'Pure Korean Hangul line. Practice reading syllable blocks (C+V+C) alongside the Revised Romanization above.';
        } else if (script === 'english') {
            explanation = matchedTerms.length
                ? `English expression/phrasal cue -> ${matchedTerms.slice(0, 3).join(' | ')}`
                : 'English phrase. Focus on natural rhythm, linking sounds, and emotional nuance.';
        } else {
            explanation = 'Punctuation or vocal ad-lib line.';
        }

        return {
            original: line,
            script,
            romanization,
            meaning: matchedTerms[0] || '',
            explanation
        };
    });

    if (koreanLines > 0 || mixedLines > 0) {
        grammarNotes.push('Korean uses Subject-Object-Verb (SOV) word order; verbs and emotional endings appear at the end of the phrase.');
        if (/요(\s|$|[.!?])/.test(sourceText)) {
            grammarNotes.push('Detected polite "-요 (-yo)" ending: polite conversational Korean commonly heard in interviews & soft ballad choruses.');
        }
        if (/습니다|ㅂ니다/.test(sourceText)) {
            grammarNotes.push('Detected formal "-습니다/-ㅂ니다" ending: respectful, declarative tone.');
        }
        if (/은 |는 |이 |가 /.test(sourceText)) {
            grammarNotes.push('Topic/Subject particles (은/는 for topic contrast, 이/가 for subject focus) mark who performs or feels the lyric.');
        }
    }
    if (englishLines > 0 || mixedLines > 0) {
        if (vocabulary.some((v) => v.cat === 'phrasal_verb')) {
            grammarNotes.push('Spotted English phrasal verbs: the preposition changes the core verb meaning idiomatically—save them as full chunks!');
        }
        if (/\b(gonna|wanna|gotta|ain't|'cause|bout)\b/i.test(sourceText)) {
            grammarNotes.push('Informal lyric contractions detected (gonna/wanna/gotta): natural in pop vocals, avoid in formal academic writing.');
        }
    }

    if (matchedRepertoireSongs.length > 0) {
        const repLabels = matchedRepertoireSongs.slice(0, 3).map((s) =>
            `"${s.titulo}"${s.artistas.length ? ` by ${s.artistas.join(', ')}` : ''}${s.album ? ` (${s.album})` : ''}${s.enfoque ? ` [Focus: ${s.enfoque}]` : ''}`
        );
        grammarNotes.unshift(`🎵 Repertoire Match: Found in your registered Music Catalog -> ${repLabels.join(' · ')}.`);
    }

    if (recognizedFromMemory.length > 0) {
        grammarNotes.unshift(
            `🧠 Memory Recall: You already studied ${recognizedFromMemory.map((m) => `"${m.term}"`).join(', ')} — definitions kept 100% consistent with your saved study history.`
        );
    }

    const firstVocab = vocabulary.find((v) => !v.learnedPreviously) || vocabulary[0];
    const resolvedSongTitle = songTitle || matchedRepertoireSongs[0]?.titulo || '';
    const resolvedArtistName = artistName || (matchedRepertoireSongs[0]?.artistas || []).join(', ');
    const headerContext = [resolvedSongTitle, resolvedArtistName].filter(Boolean).join(' - ');
    const wordDraft = firstVocab
        ? {
            word: firstVocab.romanization ? `${firstVocab.term} (${firstVocab.romanization})` : firstVocab.term,
            meaning: firstVocab.meaning,
            example: firstVocab.example,
            notes: [headerContext ? `Song: ${headerContext}` : '', ...grammarNotes.slice(0, 2)].filter(Boolean).join(' | ')
        }
        : {
            word: rawLines[0] ? rawLines[0].slice(0, 80) : (songTitle || 'Study Expression'),
            meaning: lines[0]?.romanization ? `Romanization: ${lines[0].romanization}` : (question || 'Add personal translation/meaning here'),
            example: rawLines[0] || '',
            notes: [headerContext ? `Context: ${headerContext}` : '', 'Generated via built-in Local Linguistic Engine (0 MB RAM)'].filter(Boolean).join(' | ')
        };

    const effectiveLang = (koreanLines > 0 && englishLines > 0) || mixedLines > 0
        ? 'en_ko'
        : (koreanLines > 0 ? 'ko' : normLang);

    const summary = [
        `Instant Local Analysis (${effectiveLang.toUpperCase()})`,
        lines.length ? `${lines.length} line(s) scanned` : 'Ready',
        koreanLines + mixedLines > 0 ? `${koreanLines + mixedLines} Hangul/mixed line(s) romanized automatically` : null,
        vocabulary.length ? `${vocabulary.length} key term(s)/pattern(s) extracted` : null,
        matchedRepertoireSongs.length ? `${matchedRepertoireSongs.length} catalog song(s) matched` : null,
        recognizedFromMemory.length ? `${recognizedFromMemory.length} previously learned term(s) recalled from memory` : null,
        fallbackReason ? `Note: Gemini fallback (${fallbackReason})` : 'Tip: Add a GEMINI_API_KEY in Settings or EC2 .env for deep poetic & bilingual translations.'
    ].filter(Boolean).join(' · ');

    return {
        engine: 'local-linguistic',
        model: 'built-in-hangul-en-v1',
        language: effectiveLang,
        summary,
        detectedMix: { englishLines, koreanLines, mixedLines },
        lines,
        vocabulary,
        culturalAndGrammarNotes: grammarNotes,
        wordNoteDraft: wordDraft,
        recognizedFromMemory,
        matchedRepertoireSongs,
        repertoireCount: repertoireList.length,
        memoryTotalTerms: mem.terms.length,
        rememberable: !fallbackReason || vocabulary.length > 0,
        fallbackReason: fallbackReason || null
    };
}

function validateGeminiModelId(model) {
    const clean = String(model || 'gemini-2.5-flash')
        .trim()
        .replace(/^models\//i, '');
    if (!/^[a-zA-Z0-9._-]{3,80}$/.test(clean)) {
        return 'gemini-2.5-flash';
    }
    return clean;
}

function formatGeminiFailureHint(status, model, rawErrorText = '') {
    let apiMsg = '';
    if (rawErrorText) {
        try {
            const parsed = JSON.parse(rawErrorText);
            apiMsg = String(parsed?.error?.message || '').trim();
        } catch (_) {
            apiMsg = '';
        }
    }
    if (status === 401 || status === 403) {
        return apiMsg
            ? `Gemini API key rejected (${status}): ${apiMsg.slice(0, 120)}`
            : `Gemini API key rejected or unauthorized (HTTP ${status})`;
    }
    if (status === 404) {
        return `Model "${model}" returned HTTP 404 (not found on Google Gemini API). Prueba "Test AI Connection" en Settings`;
    }
    if (status === 429) {
        return 'Gemini rate limit / quota exceeded (429). Intenta gemini-2.5-flash-lite o espera 1 minuto';
    }
    return apiMsg ? `Gemini HTTP ${status}: ${apiMsg.slice(0, 120)}` : `Gemini HTTP ${status}`;
}

async function listAvailableGeminiModels({ apiKey, fetchImpl = global.fetch } = {}) {
    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey || typeof fetchImpl !== 'function') {
        return { ok: false, status: 0, models: [], errorMessage: 'Missing API key or fetch' };
    }
    try {
        const resp = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models', {
            method: 'GET',
            headers: { 'x-goog-api-key': cleanKey },
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
        });
        if (!resp.ok) {
            const errTxt = await resp.text().catch(() => '');
            return { ok: false, status: resp.status, models: [], errorMessage: formatGeminiFailureHint(resp.status, 'models', errTxt) };
        }
        const data = await resp.json().catch(() => ({}));
        const rawModels = Array.isArray(data?.models) ? data.models : [];
        const usable = rawModels
            .filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
            .map((m) => String(m?.name || '').replace(/^models\//i, '').trim())
            .filter((id) => id && /gemini/i.test(id));
        return { ok: true, status: resp.status, models: usable, errorMessage: '' };
    } catch (err) {
        return {
            ok: false,
            status: 0,
            models: [],
            errorMessage: err?.name === 'TimeoutError' ? 'Timeout listing Gemini models' : 'Network error listing Gemini models'
        };
    }
}

function pickPreferredGeminiModel(liveModels = [], excludeModels = []) {
    const excluded = new Set(excludeModels.map((m) => String(m).toLowerCase()));
    const cleanLive = Array.isArray(liveModels) ? liveModels.filter((m) => !excluded.has(String(m).toLowerCase())) : [];
    for (const pref of GEMINI_FALLBACK_ORDER) {
        const match = cleanLive.find((m) => m.toLowerCase() === pref.toLowerCase());
        if (match) return match;
    }
    const flashCand = cleanLive.find((m) => /gemini-(?:2\.5|3|latest).*flash/i.test(m) && !/image|tts|audio/i.test(m))
        || cleanLive.find((m) => /flash/i.test(m) && !/2\.0-flash|image|tts|audio|embedding/i.test(m));
    if (flashCand) return flashCand;
    if (cleanLive.length > 0) return cleanLive[0];
    return GEMINI_FALLBACK_ORDER.find((m) => !excluded.has(m.toLowerCase())) || null;
}

async function callGeminiGenerateContent({
    apiKey,
    model = 'gemini-2.5-flash',
    prompt,
    temperature = 0.25,
    maxOutputTokens = 1024,
    responseMimeType = 'application/json',
    timeoutMs = 22000,
    fetchImpl = global.fetch
}) {
    const cleanKey = String(apiKey || '').trim();
    const primaryModel = validateGeminiModelId(model);

    const postOnce = async (candidateModel) => {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent`;
        const resp = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': cleanKey
            },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature,
                    maxOutputTokens,
                    ...(responseMimeType ? { responseMimeType } : {})
                }
            }),
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined
        });
        if (!resp.ok) {
            const errTxt = await resp.text().catch(() => '');
            return { ok: false, status: resp.status, errTxt, model: candidateModel };
        }
        const data = await resp.json();
        return { ok: true, status: resp.status, data, model: candidateModel };
    };

    const firstAttempt = await postOnce(primaryModel);
    if (firstAttempt.ok) {
        return {
            ok: true,
            status: firstAttempt.status,
            data: firstAttempt.data,
            usedModel: primaryModel,
            switchedFromModel: null,
            availableModels: []
        };
    }

    // Auto-recover transparently when a configured/legacy model returns 404
    if (firstAttempt.status === 404) {
        const listed = await listAvailableGeminiModels({ apiKey: cleanKey, fetchImpl });
        const tried = [primaryModel];
        const fallbackCand = pickPreferredGeminiModel(listed.models, tried);
        if (fallbackCand) {
            const secondAttempt = await postOnce(fallbackCand);
            if (secondAttempt.ok) {
                return {
                    ok: true,
                    status: secondAttempt.status,
                    data: secondAttempt.data,
                    usedModel: fallbackCand,
                    switchedFromModel: primaryModel,
                    availableModels: listed.models
                };
            }
            return {
                ok: false,
                status: secondAttempt.status,
                hint: formatGeminiFailureHint(secondAttempt.status, fallbackCand, secondAttempt.errTxt),
                availableModels: listed.models
            };
        }
        return {
            ok: false,
            status: firstAttempt.status,
            hint: formatGeminiFailureHint(firstAttempt.status, primaryModel, firstAttempt.errTxt),
            availableModels: listed.models
        };
    }

    return {
        ok: false,
        status: firstAttempt.status,
        hint: formatGeminiFailureHint(firstAttempt.status, primaryModel, firstAttempt.errTxt),
        availableModels: []
    };
}

async function testGeminiConnection({
    apiKey,
    model = 'gemini-2.5-flash',
    fetchImpl = global.fetch
} = {}) {
    const cleanKey = String(apiKey || '').trim();
    const safeModel = validateGeminiModelId(model);
    if (!cleanKey) {
        return {
            ok: false,
            status: 400,
            testedModel: safeModel,
            usedModel: null,
            suggestedModel: safeModel,
            availableModels: [],
            message: 'No Gemini API Key configured yet. Paste your AIzaSy... key first.'
        };
    }
    try {
        const gen = await callGeminiGenerateContent({
            apiKey: cleanKey,
            model: safeModel,
            prompt: 'Reply with OK',
            temperature: 0,
            maxOutputTokens: 16,
            responseMimeType: '',
            timeoutMs: 12000,
            fetchImpl
        });
        if (gen.ok) {
            const listed = gen.availableModels && gen.availableModels.length
                ? gen.availableModels
                : (await listAvailableGeminiModels({ apiKey: cleanKey, fetchImpl })).models;
            return {
                ok: true,
                status: 200,
                testedModel: safeModel,
                usedModel: gen.usedModel,
                suggestedModel: gen.usedModel,
                switchedFromModel: gen.switchedFromModel || null,
                availableModels: listed.slice(0, 12),
                message: gen.switchedFromModel
                    ? `Connected! "${safeModel}" gave 404 so the app auto-detected working model "${gen.usedModel}".`
                    : `Connected! Gemini responded properly with model "${gen.usedModel}".`
            };
        }
        const suggested = pickPreferredGeminiModel(gen.availableModels, [safeModel]) || 'gemini-2.5-flash';
        return {
            ok: false,
            status: gen.status || 502,
            testedModel: safeModel,
            usedModel: null,
            suggestedModel: suggested,
            availableModels: (gen.availableModels || []).slice(0, 12),
            message: gen.hint || `Gemini check failed (HTTP ${gen.status || 0}).`
        };
    } catch (err) {
        return {
            ok: false,
            status: 0,
            testedModel: safeModel,
            usedModel: null,
            suggestedModel: safeModel,
            availableModels: [],
            message: err?.name === 'TimeoutError' ? 'Timed out contacting Google Gemini API.' : 'Network error contacting Google Gemini API.'
        };
    }
}

async function analyzeWithGemini({
    apiKey,
    model = 'gemini-2.5-flash',
    text = '',
    question = '',
    language = 'en_ko',
    songTitle = '',
    artistName = '',
    learningMemory = null,
    repertoire = [],
    fetchImpl = global.fetch
}) {
    const cleanKey = String(apiKey || '').trim();
    const safeModel = validateGeminiModelId(model);
    const mem = sanitizeLanguageMemory(learningMemory);
    const repertoireList = Array.isArray(repertoire) ? repertoire.slice(0, 60) : [];
    const matchedRepertoireSongs = matchRepertoireSongs({ sourceText: `${text} ${question}`, songTitle, artistName, repertoire: repertoireList });
    if (!cleanKey) {
        return analyzeTextOffline({
            text,
            question,
            language,
            songTitle,
            artistName,
            learningMemory: mem,
            repertoire: repertoireList,
            fallbackReason: 'No Gemini API key configured'
        });
    }
    if (typeof fetchImpl !== 'function') {
        return analyzeTextOffline({
            text,
            question,
            language,
            songTitle,
            artistName,
            learningMemory: mem,
            repertoire: repertoireList,
            fallbackReason: 'Fetch API unavailable'
        });
    }

    const boundedText = String(text || '').trim().slice(0, 10000);
    const boundedQuestion = String(question || '').trim().slice(0, 1000);
    const normLang = normalizeStudyLanguage(language);
    const langMeta = LANGUAGE_REGISTRY.find((l) => l.id === normLang) || LANGUAGE_REGISTRY[0];
    const recognizedFromMemory = findRecognizedMemoryTerms(boundedText || boundedQuestion, mem);

    const recentTermsSummary = mem.terms.slice(0, 30).map((t) =>
        `${t.term}${t.romanization ? ` (${t.romanization})` : ''}: ${t.meaning}`
    ).join('; ');
    const recentGrammarSummary = mem.grammarNotes.slice(0, 8).join(' | ');
    const recentSongsSummary = mem.songs.slice(0, 8).join(', ');

    const memoryContextLines = [];
    if (recentTermsSummary || recentGrammarSummary || recentSongsSummary || mem.customContext) {
        memoryContextLines.push('STUDENT PERSISTENT LEARNING MEMORY (Keep explanations 100% consistent with what the student already learned, reinforce prior vocabulary when it reappears, and build progressively on their knowledge):');
        if (recentTermsSummary) memoryContextLines.push(`- Previously studied vocabulary/expressions: ${recentTermsSummary}`);
        if (recentGrammarSummary) memoryContextLines.push(`- Previously covered grammar notes: ${recentGrammarSummary}`);
        if (recentSongsSummary) memoryContextLines.push(`- Previously studied songs: ${recentSongsSummary}`);
        if (mem.customContext) memoryContextLines.push(`- Student custom study notes/preferences: ${mem.customContext}`);
    }
    if (repertoireList.length > 0) {
        const repSummary = repertoireList.slice(0, 28).map((s) =>
            `"${s.titulo}" by ${(s.artistas || []).join(', ') || 'Unknown'}${s.album ? ` [${s.album}]` : ''}${s.idioma ? ` (${s.idioma})` : ''}`
        ).join('; ');
        memoryContextLines.push(`STUDENT REGISTERED MUSIC REPERTOIRE (${repertoireList.length} songs in catalog — recognize these songs/artists immediately if asked): ${repSummary}`);
    }
    if (matchedRepertoireSongs.length > 0) {
        memoryContextLines.push(`MATCHED REPERTOIRE SONG(S) FOR THIS QUERY: ${matchedRepertoireSongs.map((s) => `"${s.titulo}" (${s.artistas.join(', ')})`).join(', ')}`);
    }

    const prompt = [
        'You are a friendly, precise bilingual language coach helping a university student learn English and Korean (including K-Pop English+Korean code-switching lyrics).',
        'Explain meanings clearly in English (and natural Spanish clarifications when helpful for idioms or nuance).',
        `Target study language profile: ${langMeta.label} (${langMeta.id}).`,
        songTitle || artistName ? `Song context: "${songTitle || 'Untitled'}" by "${artistName || 'Unknown artist'}".` : '',
        ...memoryContextLines,
        boundedQuestion ? `Student question / goal: ${boundedQuestion}` : 'Task: Break down the text/lyrics clearly for language study.',
        'Input text / lyrics:',
        '"""',
        boundedText || boundedQuestion,
        '"""',
        '',
        'Return ONLY valid JSON with this exact shape:',
        '{',
        '  "summary": "2-3 sentence overall meaning, vibe, and main language takeaway",',
        '  "lines": [',
        '    {',
        '      "original": "exact line",',
        '      "script": "english | korean | mixed-kpop | neutral",',
        '      "romanization": "Revised Romanization if Korean appears, else empty string",',
        '      "meaning": "natural translation/meaning of the line",',
        '      "explanation": "grammar, particle, idiom, or pronunciation note for this line"',
        '    }',
        '  ],',
        '  "vocabulary": [',
        '    {',
        '      "term": "word, Hangul phrase, or phrasal verb",',
        '      "romanization": "romanization if Korean else empty string",',
        '      "meaning": "clear concise definition + ES nuance if useful",',
        '      "category": "vocabulary | grammar | phrasal_verb",',
        '      "example": "short example sentence or lyric snippet"',
        '    }',
        '  ],',
        '  "culturalAndGrammarNotes": ["concise bullet insights on tone, honorifics, slang, or structure"],',
        '  "wordNoteDraft": {',
        '    "word": "best single word/expression to save",',
        '    "meaning": "concise study definition",',
        '    "example": "best example line",',
        '    "notes": "helpful study tip (particles/pronunciation/usage)"',
        '  }',
        '}'
    ].filter(Boolean).join('\n');

    try {
        const gen = await callGeminiGenerateContent({
            apiKey: cleanKey,
            model: safeModel,
            prompt,
            temperature: 0.35,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
            timeoutMs: 25000,
            fetchImpl
        });

        if (!gen.ok) {
            return analyzeTextOffline({
                text,
                question,
                language,
                songTitle,
                artistName,
                learningMemory: mem,
                repertoire: repertoireList,
                fallbackReason: gen.hint
            });
        }

        const data = gen.data;
        const rawText = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        const cleanedJson = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleanedJson);

        const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
        let englishLines = 0;
        let koreanLines = 0;
        let mixedLines = 0;

        const normalizedLines = rawLines.map((item) => {
            const orig = String(item?.original || '').trim();
            const script = detectScriptKind(orig || String(item?.script || ''));
            if (script === 'english') englishLines += 1;
            else if (script === 'korean') koreanLines += 1;
            else if (script === 'mixed-kpop') mixedLines += 1;
            const autoRom = (script === 'korean' || script === 'mixed-kpop') ? hangulToRomanization(orig) : '';
            return {
                original: orig,
                script,
                romanization: String(item?.romanization || autoRom || '').trim(),
                meaning: String(item?.meaning || '').trim(),
                explanation: String(item?.explanation || '').trim()
            };
        });

        const memMap = new Map(mem.terms.map((t) => [t.term.toLowerCase(), t]));
        const normalizedVocab = Array.isArray(parsed.vocabulary)
            ? parsed.vocabulary.slice(0, 18).map((v) => {
                const term = String(v?.term || '').trim();
                const known = memMap.get(term.toLowerCase());
                return {
                    term,
                    romanization: String(v?.romanization || known?.romanization || '').trim()
                        || (/[\uAC00-\uD7A3]/.test(term) ? hangulToRomanization(term) : ''),
                    meaning: String(v?.meaning || known?.meaning || '').trim(),
                    category: ['vocabulary', 'grammar', 'phrasal_verb'].includes(v?.category) ? v.category : (known?.category || 'vocabulary'),
                    example: String(v?.example || '').trim(),
                    learnedPreviously: Boolean(known),
                    reviewCount: known?.count || 1
                };
            }).filter((v) => v.term)
            : [];

        return {
            engine: 'gemini',
            model: gen.usedModel || safeModel,
            autoSwitchedNote: gen.switchedFromModel
                ? `Modelo "${gen.switchedFromModel}" devolvió 404; se usó "${gen.usedModel}".`
                : null,
            language: normLang,
            summary: String(parsed.summary || '').trim(),
            detectedMix: { englishLines, koreanLines, mixedLines },
            lines: normalizedLines,
            vocabulary: normalizedVocab,
            culturalAndGrammarNotes: Array.isArray(parsed.culturalAndGrammarNotes)
                ? parsed.culturalAndGrammarNotes.map((n) => String(n || '').trim()).filter(Boolean).slice(0, 10)
                : [],
            wordNoteDraft: parsed.wordNoteDraft && typeof parsed.wordNoteDraft === 'object'
                ? {
                    word: String(parsed.wordNoteDraft.word || '').trim(),
                    meaning: String(parsed.wordNoteDraft.meaning || '').trim(),
                    example: String(parsed.wordNoteDraft.example || '').trim(),
                    notes: String(parsed.wordNoteDraft.notes || '').trim()
                }
                : null,
            recognizedFromMemory,
            matchedRepertoireSongs,
            repertoireCount: repertoireList.length,
            memoryTotalTerms: mem.terms.length,
            rememberable: true,
            fallbackReason: null
        };
    } catch (err) {
        return analyzeTextOffline({
            text,
            question,
            language,
            songTitle,
            artistName,
            learningMemory: mem,
            repertoire: repertoireList,
            fallbackReason: err?.name === 'TimeoutError' ? 'Gemini request timed out' : 'Gemini JSON/network fallback'
        });
    }
}

const TRANSLATION_DIRECTIONS = {
    auto: {
        id: 'auto',
        label: 'Auto (EN/KR -> Español + English)',
        sourceLabel: 'Auto-detect',
        targetLabel: 'Español (y puente EN si aplica)'
    },
    en_es: {
        id: 'en_es',
        label: 'English -> Español',
        sourceLabel: 'English',
        targetLabel: 'Español'
    },
    ko_en: {
        id: 'ko_en',
        label: 'Coreano (한국어) -> English',
        sourceLabel: 'Korean (한국어)',
        targetLabel: 'English (con aclaración en Español)'
    },
    ko_es: {
        id: 'ko_es',
        label: 'Coreano (한국어) -> Español',
        sourceLabel: 'Korean (한국어)',
        targetLabel: 'Español'
    },
    es_en: {
        id: 'es_en',
        label: 'Español -> English',
        sourceLabel: 'Español',
        targetLabel: 'English'
    },
    es_ko: {
        id: 'es_ko',
        label: 'Español -> Coreano (한국어)',
        sourceLabel: 'Español',
        targetLabel: 'Korean (한국어)'
    }
};

// Offline compact bilingual dictionary (0 MB idle RAM) so quick words/K-Pop terms translate immediately even without Gemini key
const KO_ES_MEANINGS = {
    '한국어': { es: 'Idioma coreano / Coreano', en: 'Korean language', pos: 'Sustantivo' },
    '영어': { es: 'Idioma inglés / Inglés', en: 'English language', pos: 'Sustantivo' },
    '스페인어': { es: 'Idioma español / Español', en: 'Spanish language', pos: 'Sustantivo' },
    '노래': { es: 'Canción', en: 'Song', pos: 'Sustantivo' },
    '가사': { es: 'Letra (de canción)', en: 'Lyrics', pos: 'Sustantivo' },
    '번역': { es: 'Traducción', en: 'Translation', pos: 'Sustantivo' },
    '공부': { es: 'Estudio / Estudiar', en: 'Study', pos: 'Sustantivo' },
    '사랑해요': { es: 'Te amo / Te quiero (forma educada -요)', en: 'I love you (polite)', pos: 'Expresión / Verbo' },
    '사랑해': { es: 'Te amo / Te quiero (informal)', en: 'I love you (casual/intimate)', pos: 'Expresión / Verbo' },
    '사랑': { es: 'Amor', en: 'Love', pos: 'Sustantivo' },
    '마음': { es: 'Corazón / Mente / Sentimientos', en: 'Heart / Mind / Feelings', pos: 'Sustantivo' },
    '보고 싶어': { es: 'Te extraño / Quiero verte', en: 'I miss you / want to see you', pos: 'Expresión' },
    '영원히': { es: 'Por siempre / Eternamente', en: 'Forever / Eternally', pos: 'Adverbio' },
    '시간': { es: 'Tiempo', en: 'Time', pos: 'Sustantivo' },
    '기억': { es: 'Recuerdo / Memoria', en: 'Memory', pos: 'Sustantivo' },
    '눈물': { es: 'Lágrimas', en: 'Tears', pos: 'Sustantivo' },
    '미소': { es: 'Sonrisa', en: 'Smile', pos: 'Sustantivo' },
    '약속': { es: 'Promesa', en: 'Promise', pos: 'Sustantivo' },
    '우리': { es: 'Nosotros / Nuestro(a)', en: 'We / Us / Our', pos: 'Pronombre' },
    '너': { es: 'Tú (informal)', en: 'You (informal)', pos: 'Pronombre' },
    '나': { es: 'Yo (informal)', en: 'I / Me (informal)', pos: 'Pronombre' },
    '오늘': { es: 'Hoy', en: 'Today', pos: 'Sustantivo / Adverbio' },
    '내일': { es: 'Mañana', en: 'Tomorrow', pos: 'Sustantivo / Adverbio' },
    '지금': { es: 'Ahora', en: 'Now', pos: 'Adverbio' },
    '항상': { es: 'Siempre', en: 'Always', pos: 'Adverbio' },
    '함께': { es: 'Juntos', en: 'Together', pos: 'Adverbio' },
    '혼자': { es: 'Solo / A solas', en: 'Alone', pos: 'Adverbio' },
    '다시': { es: 'Otra vez / De nuevo', en: 'Again', pos: 'Adverbio' },
    '세상': { es: 'Mundo', en: 'World', pos: 'Sustantivo' },
    '밤': { es: 'Noche', en: 'Night', pos: 'Sustantivo' },
    '별': { es: 'Estrella', en: 'Star', pos: 'Sustantivo' },
    '빛': { es: 'Luz', en: 'Light', pos: 'Sustantivo' },
    '꿈': { es: 'Sueño', en: 'Dream', pos: 'Sustantivo' },
    '행복': { es: 'Felicidad', en: 'Happiness', pos: 'Sustantivo' },
    '괜찮아': { es: 'Está bien / Estoy bien', en: "It's okay / I'm alright", pos: 'Expresión' },
    '고마워': { es: 'Gracias (informal)', en: 'Thank you (informal)', pos: 'Expresión' },
    '감사합니다': { es: 'Muchas gracias (formal)', en: 'Thank you very much (formal)', pos: 'Expresión' },
    '미안해': { es: 'Lo siento / Perdón (informal)', en: 'I am sorry (informal)', pos: 'Expresión' },
    '안녕': { es: 'Hola / Adiós (informal)', en: 'Hi / Bye (informal)', pos: 'Saludo' },
    '안녕하세요': { es: 'Hola (educado/estándar)', en: 'Hello (polite)', pos: 'Saludo' },
    '진짜': { es: 'De verdad / En serio', en: 'Really / Truly', pos: 'Adverbio' },
    '정말': { es: 'Realmente / Honestamente', en: 'Really / Honestly', pos: 'Adverbio' },
    '너무': { es: 'Demasiado / Muy / Tanto', en: 'So / Too much / Very', pos: 'Adverbio' },
    '심장': { es: 'Corazón (órgano / latido)', en: 'Heart (beating)', pos: 'Sustantivo' },
    '운명': { es: 'Destino', en: 'Destiny / Fate', pos: 'Sustantivo' },
    '화이팅': { es: '¡Ánimo! / ¡Tú puedes!', en: 'Fighting! / You got this!', pos: 'Expresión K-Pop' },
    '파이팅': { es: '¡Ánimo! / ¡Tú puedes!', en: 'Fighting! / You got this!', pos: 'Expresión K-Pop' },
    '대박': { es: '¡Increíble! / ¡Genial!', en: 'Awesome! / Huge hit!', pos: 'Slang K-Pop' },
    '고 싶어': { es: 'Quiero [verbo] (-고 싶다)', en: 'Want to [verb]', pos: 'Gramática' },
    '지 마': { es: 'No [verbo] / No lo hagas', en: "Don't [verb]", pos: 'Gramática' },
    '처럼': { es: 'Como / Igual que', en: 'Like / As', pos: 'Partícula' },
    '까지': { es: 'Hasta / Incluso', en: 'Until / Even', pos: 'Partícula' },
    '에서': { es: 'En / Desde (lugar de acción)', en: 'At / From', pos: 'Partícula' },
    '지만': { es: 'Pero / Aunque', en: 'But / Even though', pos: 'Conector' },
    '니까': { es: 'Porque / Ya que', en: 'Because / Since', pos: 'Conector' }
};

const EN_ES_DICTIONARY = {
    'break through': { es: 'abrirse paso / superar una barrera o obstáculo', pos: 'Phrasal Verb' },
    'break down': { es: 'derrumbarse emocionalmente / descomponer / analizar paso a paso', pos: 'Phrasal Verb' },
    'hold on': { es: 'esperar un momento / resistir / aferrarse', pos: 'Phrasal Verb' },
    'let go': { es: 'soltar / dejar ir emocionalmente', pos: 'Phrasal Verb' },
    'fall apart': { es: 'desmoronarse / hacerse pedazos', pos: 'Phrasal Verb' },
    'fade away': { es: 'desvanecerse poco a poco', pos: 'Phrasal Verb' },
    'light up': { es: 'iluminar / alegrar de repente', pos: 'Phrasal Verb' },
    'run away': { es: 'huir / escapar', pos: 'Phrasal Verb' },
    'give up': { es: 'rendirse / darse por vencido', pos: 'Phrasal Verb' },
    'wake up': { es: 'despertar / darse cuenta', pos: 'Phrasal Verb' },
    'come back': { es: 'regresar / volver', pos: 'Phrasal Verb' },
    'turn around': { es: 'darse la vuelta / cambiar el rumbo', pos: 'Phrasal Verb' },
    'figure out': { es: 'descifrar / entender / resolver', pos: 'Phrasal Verb' },
    'move on': { es: 'seguir adelante / pasar página', pos: 'Phrasal Verb' },
    'get over': { es: 'superar algo difícil o una ruptura', pos: 'Phrasal Verb' },
    'work out': { es: 'hacer ejercicio / salir bien / resolver', pos: 'Phrasal Verb' },
    'drip': { es: 'estilo / presencia llamativa / goteo (slang en canciones)', pos: 'Sustantivo / Slang' },
    'resilience': { es: 'resiliencia (capacidad de recuperarse ante la adversidad)', pos: 'Sustantivo' },
    'serendipity': { es: 'serendipia (hallazgo afortunado e inesperado)', pos: 'Sustantivo' },
    'forever': { es: 'por siempre / para siempre', pos: 'Adverbio' },
    'heart': { es: 'corazón', pos: 'Sustantivo' },
    'soul': { es: 'alma', pos: 'Sustantivo' },
    'dream': { es: 'sueño / soñar', pos: 'Sustantivo / Verbo' },
    'promise': { es: 'promesa / prometer', pos: 'Sustantivo / Verbo' },
    'vibe': { es: 'vibra / ambiente / energía', pos: 'Sustantivo / Slang' },
    'craving': { es: 'deseo intenso / antojo', pos: 'Sustantivo / Gerundio' },
    'overwhelmed': { es: 'abrumado / sobrepasado', pos: 'Adjetivo' },
    'eager': { es: 'ansioso / entusiasmado', pos: 'Adjetivo' },
    'flawless': { es: 'impecable / sin defectos', pos: 'Adjetivo' },
    'gonna': { es: 'voy a / vas a (contracción coloquial de "going to")', pos: 'Contracción' },
    'wanna': { es: 'quiero / quieres (contracción coloquial de "want to")', pos: 'Contracción' },
    'gotta': { es: 'tengo que / hay que (contracción de "got to")', pos: 'Contracción' },
    "ain't": { es: 'no es / no soy / no está (negación coloquial en letras)', pos: 'Contracción' }
};

function normalizeTranslationDirection(raw) {
    const clean = String(raw || 'auto').trim().toLowerCase().replace(/[-\s]+/g, '_');
    return TRANSLATION_DIRECTIONS[clean] ? clean : 'auto';
}

function translateOffline({
    text = '',
    direction = 'auto',
    songTitle = '',
    artistName = '',
    learningMemory = null,
    fallbackReason = null
}) {
    const cleanText = String(text || '').trim().slice(0, 2000);
    const dir = normalizeTranslationDirection(direction);
    const mem = sanitizeLanguageMemory(learningMemory);
    const script = detectScriptKind(cleanText);
    const hasHangul = script === 'korean' || script === 'mixed-kpop';
    const romanization = hasHangul ? hangulToRomanization(cleanText) : '';

    // Resolve effective direction in Auto mode (or when Hangul is pasted while EN -> ES was left active)
    let effectiveDir = dir;
    let autoDirAdjustedNote = '';
    if (dir === 'auto') {
        effectiveDir = hasHangul ? 'ko_es' : 'en_es';
    } else if (hasHangul && dir === 'en_es') {
        effectiveDir = 'ko_es';
        autoDirAdjustedNote = 'Texto en Hangul detectado: traducido automáticamente desde Coreano.';
    }

    // 1. Check user's persistent AI memory first (only clean non-poisoned entries)
    const memMatch = mem.terms.find((t) =>
        t.term.toLowerCase() === cleanText.toLowerCase() && !isPoisonedMemoryMeaning(t.meaning)
    ) || mem.terms.find((t) =>
        cleanText.toLowerCase().includes(t.term.toLowerCase()) && !isPoisonedMemoryMeaning(t.meaning)
    );

    const lowerClean = cleanText.toLowerCase();
    const matchedKo = [];
    for (const [kTerm, info] of Object.entries(KO_ES_MEANINGS)) {
        if (cleanText.includes(kTerm)) {
            matchedKo.push({ term: kTerm, ...info, romanization: hangulToRomanization(kTerm) });
        }
    }

    const exactEn = EN_ES_DICTIONARY[lowerClean] || null;
    const matchedEn = exactEn
        ? [{ term: cleanText, ...exactEn }]
        : Object.entries(EN_ES_DICTIONARY)
            .filter(([k]) => lowerClean.includes(k))
            .map(([k, info]) => ({ term: k, ...info }));

    let primaryTranslation = '';
    let spanishMeaning = '';
    let englishBridge = '';
    let partOfSpeech = '';
    let explanationEs = '';
    let rememberable = false;

    if (effectiveDir === 'ko_en' || effectiveDir === 'ko_es' || (dir === 'auto' && hasHangul)) {
        const koExact = KO_ES_MEANINGS[cleanText];
        if (koExact) {
            englishBridge = koExact.en;
            spanishMeaning = koExact.es;
            primaryTranslation = effectiveDir === 'ko_en' ? koExact.en : koExact.es;
            partOfSpeech = koExact.pos;
            explanationEs = `Expresión reconocida en coreano: "${cleanText}" [${romanization}] -> en inglés "${koExact.en}", en español "${koExact.es}".`;
            rememberable = true;
        } else if (matchedKo.length) {
            englishBridge = matchedKo.map((m) => `${m.term} (${m.romanization}) = ${m.en}`).join(' · ');
            spanishMeaning = matchedKo.map((m) => `${m.term}: ${m.es}`).join(' · ');
            primaryTranslation = effectiveDir === 'ko_en'
                ? matchedKo.map((m) => m.en).join(' / ')
                : matchedKo.map((m) => m.es).join(' / ');
            partOfSpeech = matchedKo[0].pos;
            explanationEs = `Se detectaron ${matchedKo.length} elementos conocidos dentro de la frase en coreano. Romanización: ${romanization}.`;
            rememberable = true;
        } else if (memMatch) {
            primaryTranslation = memMatch.meaning || cleanText;
            spanishMeaning = memMatch.meaning || '';
            englishBridge = memMatch.meaning || '';
            explanationEs = 'Recuperado de tu Memoria Persistente de estudio en la plataforma.';
            rememberable = true;
        } else {
            primaryTranslation = `[Romanización: ${romanization || cleanText}]`;
            spanishMeaning = fallbackReason
                ? `No se pudo usar Gemini (${fallbackReason}). Lectura fonética: ${romanization || cleanText}.`
                : `Modo local sin clave Gemini: lectura fonética ${romanization || cleanText}. Configura tu GEMINI_API_KEY en Settings para traducir cualquier frase completa de Coreano a Inglés y Español.`;
            englishBridge = romanization || cleanText;
            partOfSpeech = hasHangul ? 'Hangul' : 'Texto';
            explanationEs = spanishMeaning;
            rememberable = false;
        }
    } else if (effectiveDir === 'es_en' || effectiveDir === 'es_ko') {
        const reversedEs = Object.entries(KO_ES_MEANINGS).find(([, v]) =>
            v.es.toLowerCase().includes(lowerClean)
        ) || Object.entries(EN_ES_DICTIONARY).find(([, v]) =>
            v.es.toLowerCase().includes(lowerClean)
        );
        if (effectiveDir === 'es_ko') {
            const koHit = Object.entries(KO_ES_MEANINGS).find(([, v]) =>
                v.es.toLowerCase().includes(lowerClean)
            );
            if (koHit) {
                primaryTranslation = koHit[0];
                englishBridge = koHit[1].en;
                spanishMeaning = koHit[1].es;
                partOfSpeech = koHit[1].pos;
                explanationEs = `"${cleanText}" en coreano es "${koHit[0]}" (${hangulToRomanization(koHit[0])}).`;
                rememberable = true;
            }
        } else if (reversedEs) {
            const [term, info] = reversedEs;
            primaryTranslation = info.en || term;
            englishBridge = info.en || term;
            spanishMeaning = info.es || cleanText;
            partOfSpeech = info.pos || 'Vocabulario';
            explanationEs = 'Equivalente encontrado en diccionario local.';
            rememberable = true;
        }
        if (!primaryTranslation) {
            primaryTranslation = 'Requiere Google Gemini API para traducción abierta ES -> EN/KR';
            spanishMeaning = cleanText;
            explanationEs = 'En modo local se incluyen expresiones frecuentes y vocabulario K-Pop. Configura Gemini API Key en Settings para traducir cualquier frase desde español.';
            rememberable = false;
        }
    } else {
        // en_es (or auto with English/Latin script)
        if (exactEn) {
            primaryTranslation = exactEn.es;
            spanishMeaning = exactEn.es;
            englishBridge = cleanText;
            partOfSpeech = exactEn.pos;
            explanationEs = `Significado en español para "${cleanText}" (${exactEn.pos}).`;
            rememberable = true;
        } else if (matchedEn.length) {
            primaryTranslation = matchedEn.map((m) => `${m.term}: ${m.es}`).join(' · ');
            spanishMeaning = primaryTranslation;
            englishBridge = cleanText;
            partOfSpeech = matchedEn[0].pos;
            explanationEs = 'Coincidencia de expresión o phrasal verb detectada en el diccionario local.';
            rememberable = true;
        } else if (memMatch) {
            primaryTranslation = memMatch.meaning || cleanText;
            spanishMeaning = primaryTranslation;
            englishBridge = cleanText;
            explanationEs = 'Recuperado de tu Memoria Persistente de estudio.';
            rememberable = true;
        } else {
            primaryTranslation = fallbackReason
                ? `Sin traducción exacta en diccionario local (${fallbackReason})`
                : 'Palabra no está en el diccionario local reducido';
            spanishMeaning = 'Activa Google Gemini API en Settings (0 MB RAM) para traducciones ilimitadas con contexto, modismos y ejemplos en español.';
            englishBridge = cleanText;
            partOfSpeech = 'Vocabulario';
            explanationEs = spanishMeaning;
            rememberable = false;
        }
    }

    if (autoDirAdjustedNote && explanationEs && !explanationEs.includes(autoDirAdjustedNote)) {
        explanationEs = `${autoDirAdjustedNote} ${explanationEs}`;
    }

    return {
        engine: 'local-linguistic',
        model: 'built-in-translator-v1',
        direction: effectiveDir,
        directionLabel: (TRANSLATION_DIRECTIONS[effectiveDir] || TRANSLATION_DIRECTIONS.auto).label,
        detectedScript: script,
        sourceText: cleanText,
        translatedText: primaryTranslation,
        spanishMeaning: spanishMeaning || primaryTranslation,
        englishBridge: englishBridge || '',
        romanization,
        partOfSpeech: partOfSpeech || 'Vocabulario',
        explanationEs,
        literalMeaning: '',
        alternatives: [],
        examples: [],
        wordNoteDraft: {
            word: cleanText,
            romanization,
            meaning: spanishMeaning || primaryTranslation,
            example: cleanText,
            notes: [songTitle || artistName ? `Song: ${[songTitle, artistName].filter(Boolean).join(' - ')}` : '', explanationEs].filter(Boolean).join(' | ')
        },
        rememberable,
        fallbackReason: fallbackReason || null
    };
}

async function translateWithGemini({
    apiKey,
    model = 'gemini-2.5-flash',
    text = '',
    direction = 'auto',
    songTitle = '',
    artistName = '',
    context = '',
    learningMemory = null,
    fetchImpl = global.fetch
}) {
    const cleanText = String(text || '').trim().slice(0, 2000);
    const dir = normalizeTranslationDirection(direction);
    const cleanKey = String(apiKey || '').trim();
    const safeModel = validateGeminiModelId(model);
    const mem = sanitizeLanguageMemory(learningMemory);

    if (!cleanKey) {
        return translateOffline({
            text: cleanText,
            direction: dir,
            songTitle,
            artistName,
            learningMemory: mem,
            fallbackReason: 'Sin GEMINI_API_KEY configurada'
        });
    }
    if (typeof fetchImpl !== 'function') {
        return translateOffline({
            text: cleanText,
            direction: dir,
            songTitle,
            artistName,
            learningMemory: mem,
            fallbackReason: 'Fetch API no disponible'
        });
    }

    const dirSpec = TRANSLATION_DIRECTIONS[dir] || TRANSLATION_DIRECTIONS.auto;
    const recentTermsSummary = mem.terms.slice(0, 20).map((t) =>
        `${t.term}: ${t.meaning}`
    ).join('; ');

    const prompt = [
        'You are a bilingual translator & language tutor helping a native Spanish speaker learn English and Korean (including song/K-Pop vocabulary and slang).',
        `Requested translation mode: ${dirSpec.label} (${dir}).`,
        songTitle || artistName ? `Song context: "${songTitle}" by "${artistName}".` : '',
        context ? `Additional usage context: ${String(context).trim().slice(0, 350)}` : '',
        recentTermsSummary ? `Student known vocabulary (stay consistent): ${recentTermsSummary}` : '',
        'Text to translate:',
        '"""',
        cleanText,
        '"""',
        '',
        'Rules:',
        '- For "en_es": translate naturally from English to Mexican/neutral Spanish. If input is clearly Korean Hangul despite mode "en_es", still translate it accurately into Spanish/English instead of failing.',
        '- For "ko_en": translate naturally from Korean to English, AND ALWAYS also fill "spanishMeaning" in Spanish so the native Spanish student fully understands every nuance.',
        '- For "ko_es": translate naturally from Korean to Spanish, AND optionally fill "englishBridge" with the English equivalent.',
        '- For "auto": if input has Korean Hangul, provide Spanish translation ("translatedText" and "spanishMeaning") + English equivalent ("englishBridge") + Revised Romanization; if input is English, translate to Spanish.',
        '- Keep "explanationEs" clear, concise, and ALWAYS written in Spanish.',
        '',
        'Return ONLY valid JSON matching:',
        '{',
        '  "detectedSourceLang": "en | ko | es | mixed",',
        '  "translatedText": "main translation in requested target language",',
        '  "spanishMeaning": "natural Spanish meaning",',
        '  "englishBridge": "natural English meaning (especially useful when source is Korean)",',
        '  "romanization": "Revised Romanization if Korean is in source or target, else empty string",',
        '  "partOfSpeech": "Noun / Verb / Phrasal Verb / Idiom / Expression / Particle...",',
        '  "literalMeaning": "short literal word-for-word gloss if helpful, else empty string",',
        '  "explanationEs": "clear explanation in Spanish of nuance, formality, or lyric usage",',
        '  "alternatives": ["up to 3 short synonyms or context variants"],',
        '  "examples": [',
        '    { "source": "short natural sentence", "translation": "Spanish or target translation" }',
        '  ]',
        '}'
    ].filter(Boolean).join('\n');

    try {
        const gen = await callGeminiGenerateContent({
            apiKey: cleanKey,
            model: safeModel,
            prompt,
            temperature: 0.2,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            timeoutMs: 20000,
            fetchImpl
        });

        if (!gen.ok) {
            return translateOffline({
                text: cleanText,
                direction: dir,
                songTitle,
                artistName,
                learningMemory: mem,
                fallbackReason: gen.hint
            });
        }

        const data = gen.data;
        const rawText = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        const cleanedJson = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleanedJson);

        const translatedText = String(parsed.translatedText || '').trim();
        const spanishMeaning = String(parsed.spanishMeaning || '').trim() || translatedText;
        const englishBridge = String(parsed.englishBridge || '').trim();
        const combinedForRom = /[\uAC00-\uD7A3]/.test(cleanText)
            ? cleanText
            : (/[\uAC00-\uD7A3]/.test(translatedText) ? translatedText : '');
        const autoRom = combinedForRom ? hangulToRomanization(combinedForRom) : '';
        const romanization = String(parsed.romanization || autoRom || '').trim();
        const explanationEs = String(parsed.explanationEs || '').trim();
        const examples = Array.isArray(parsed.examples)
            ? parsed.examples.slice(0, 3).map((ex) => ({
                source: String(ex?.source || '').trim(),
                translation: String(ex?.translation || '').trim()
            })).filter((ex) => ex.source)
            : [];

        return {
            engine: 'gemini',
            model: gen.usedModel || safeModel,
            autoSwitchedNote: gen.switchedFromModel
                ? `Modelo "${gen.switchedFromModel}" devolvió 404; se usó "${gen.usedModel}". Actualízalo en Settings.`
                : null,
            direction: dir,
            directionLabel: dirSpec.label,
            detectedScript: detectScriptKind(cleanText),
            detectedSourceLang: String(parsed.detectedSourceLang || '').trim(),
            sourceText: cleanText,
            translatedText: translatedText || spanishMeaning,
            spanishMeaning,
            englishBridge,
            romanization,
            partOfSpeech: String(parsed.partOfSpeech || 'Vocabulario').trim(),
            literalMeaning: String(parsed.literalMeaning || '').trim(),
            explanationEs,
            alternatives: Array.isArray(parsed.alternatives)
                ? parsed.alternatives.map((a) => String(a || '').trim()).filter(Boolean).slice(0, 4)
                : [],
            examples,
            wordNoteDraft: {
                word: cleanText,
                romanization,
                meaning: dir === 'ko_en' && englishBridge && spanishMeaning
                    ? `${englishBridge} — ${spanishMeaning}`
                    : (spanishMeaning || translatedText),
                example: examples[0]?.source || cleanText,
                notes: [explanationEs, songTitle || artistName ? `Song: ${[songTitle, artistName].filter(Boolean).join(' - ')}` : ''].filter(Boolean).join(' | ')
            },
            rememberable: Boolean(translatedText || spanishMeaning),
            fallbackReason: null
        };
    } catch (err) {
        return translateOffline({
            text: cleanText,
            direction: dir,
            songTitle,
            artistName,
            learningMemory: mem,
            fallbackReason: err?.name === 'TimeoutError' ? 'Gemini timeout' : 'Gemini network/parse fallback'
        });
    }
}

module.exports = {
    LANGUAGE_REGISTRY,
    RECOMMENDED_GEMINI_MODELS,
    TRANSLATION_DIRECTIONS,
    getLanguageRegistry,
    normalizeStudyLanguage,
    normalizeTranslationDirection,
    validateGeminiModelId,
    hangulToRomanization,
    detectScriptKind,
    isPoisonedMemoryMeaning,
    sanitizeLanguageMemory,
    mergeLanguageMemory,
    matchRepertoireSongs,
    analyzeTextOffline,
    analyzeWithGemini,
    translateOffline,
    translateWithGemini,
    listAvailableGeminiModels,
    testGeminiConnection
};
