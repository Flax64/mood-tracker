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
        id: 'gemini-3-flash-preview',
        label: 'Gemini 3 Flash Preview (Latest Fast Model · Active on New Keys)',
        notes: 'High-speed current Flash model enabled on newer Google AI Studio keys.'
    },
    {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash (Recommended · Fast & Efficient)',
        notes: 'Best speed/quality balance for lyrics breakdown & grammar checks with 0 MB server RAM.'
    },
    {
        id: 'gemini-flash-latest',
        label: 'Gemini Flash Latest (Auto-Updated Flash Alias)',
        notes: 'Always points to Google AI Studio current default Flash model.'
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
        id: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro Preview (Next-Gen Deep Reasoning)',
        notes: 'Latest high-precision Pro preview for deep grammar and lyric nuances.'
    }
];

const GEMINI_FALLBACK_ORDER = [
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-3.1-pro-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash-lite'
];

const POISONED_MEMORY_REGEX = /(?:Activa Google Gemini API en Settings|Enable Google Gemini API in Settings|Sin traducción exacta en diccionario local|No exact match in local dictionary|Word not in built-in compact dictionary|Sin conexión a Gemini|Requiere Google Gemini API|Requires Google Gemini API|Configura tu GEMINI_API_KEY|Configure your GEMINI_API_KEY|Palabra no está en el diccionario local|Local mode without Gemini key|Add personal translation\/meaning here|Gemini HTTP \d+)/i;

function normalizeUiLang(raw) {
    return String(raw || '').trim().toLowerCase().startsWith('en') ? 'en' : 'es';
}

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
    fallbackReason = null,
    uiLang = 'es'
}) {
    const isEn = normalizeUiLang(uiLang) === 'en';
    const tr = (en, es) => (isEn ? en : es);
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
                meaning: memItem.meaning || tr('Previously studied term in your AI Learning Memory', 'Término estudiado previamente en tu Memoria de Aprendizaje IA'),
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
                ? `${tr('K-Pop EN+KR code-switching line. Key elements ->', 'Línea mixta K-Pop EN+KR. Elementos clave ->')} ${matchedTerms.slice(0, 3).join(' | ')}`
                : tr(
                    'K-Pop bilingual line mixing English hook phrasing with Korean Hangul (see Revised Romanization above to sing along).',
                    'Línea bilingüe K-Pop que mezcla fraseo en inglés con Hangul coreano (mira la romanización revisada arriba para cantarla).'
                );
        } else if (script === 'korean') {
            explanation = matchedTerms.length
                ? `${tr('Korean line key breakdown ->', 'Desglose clave de la línea en coreano ->')} ${matchedTerms.slice(0, 3).join(' | ')}`
                : tr(
                    'Pure Korean Hangul line. Practice reading syllable blocks (C+V+C) alongside the Revised Romanization above.',
                    'Línea en Hangul coreano puro. Practica leyendo bloques silábicos (C+V+C) junto con la romanización revisada arriba.'
                );
        } else if (script === 'english') {
            explanation = matchedTerms.length
                ? `${tr('English expression/phrasal cue ->', 'Expresión / phrasal verb en inglés ->')} ${matchedTerms.slice(0, 3).join(' | ')}`
                : tr(
                    'English phrase. Focus on natural rhythm, linking sounds, and emotional nuance.',
                    'Frase en inglés. Enfócate en el ritmo natural, enlaces entre palabras y matiz emocional.'
                );
        } else {
            explanation = tr('Punctuation or vocal ad-lib line.', 'Línea de puntuación o ad-lib vocal.');
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
        grammarNotes.push(tr(
            'Korean uses Subject-Object-Verb (SOV) word order; verbs and emotional endings appear at the end of the phrase.',
            'El coreano usa orden Sujeto-Objeto-Verbo (SOV); los verbos y terminaciones emocionales van al final de la frase.'
        ));
        if (/요(\s|$|[.!?])/.test(sourceText)) {
            grammarNotes.push(tr(
                'Detected polite "-요 (-yo)" ending: polite conversational Korean commonly heard in interviews & soft ballad choruses.',
                'Se detectó la terminación cortés "-요 (-yo)": coreano conversacional amable frecuente en entrevistas y coros suaves.'
            ));
        }
        if (/습니다|ㅂ니다/.test(sourceText)) {
            grammarNotes.push(tr(
                'Detected formal "-습니다/-ㅂ니다" ending: respectful, declarative tone.',
                'Se detectó la terminación formal "-습니다/-ㅂ니다": tono respetuoso y declarativo.'
            ));
        }
        if (/은 |는 |이 |가 /.test(sourceText)) {
            grammarNotes.push(tr(
                'Topic/Subject particles (은/는 for topic contrast, 이/가 for subject focus) mark who performs or feels the lyric.',
                'Las partículas de tema/sujeto (은/는 para contraste de tema, 이/가 para foco en sujeto) indican quién realiza o siente la letra.'
            ));
        }
    }
    if (englishLines > 0 || mixedLines > 0) {
        if (vocabulary.some((v) => v.cat === 'phrasal_verb' || v.category === 'phrasal_verb')) {
            grammarNotes.push(tr(
                'Spotted English phrasal verbs: the preposition changes the core verb meaning idiomatically—save them as full chunks!',
                'Se detectaron phrasal verbs en inglés: la preposición cambia el sentido idiomático del verbo base—guárdalos completos.'
            ));
        }
        if (/\b(gonna|wanna|gotta|ain't|'cause|bout)\b/i.test(sourceText)) {
            grammarNotes.push(tr(
                'Informal lyric contractions detected (gonna/wanna/gotta): natural in pop vocals, avoid in formal academic writing.',
                'Contracciones informales de letra (gonna/wanna/gotta): naturales al cantar pop, evítalas en escritura académica formal.'
            ));
        }
    }

    if (matchedRepertoireSongs.length > 0) {
        const repLabels = matchedRepertoireSongs.slice(0, 3).map((s) =>
            `"${s.titulo}"${s.artistas.length ? ` (${s.artistas.join(', ')})` : ''}${s.album ? ` · ${s.album}` : ''}${s.enfoque ? ` [${tr('Focus', 'Enfoque')}: ${s.enfoque}]` : ''}`
        );
        grammarNotes.unshift(`🎵 ${tr('Repertoire Match: Found in your registered Music Catalog ->', 'Coincidencia de Repertorio en tu Catálogo Musical ->')} ${repLabels.join(' · ')}.`);
    }

    if (recognizedFromMemory.length > 0) {
        grammarNotes.unshift(
            `🧠 ${tr('Memory Recall: You already studied', 'Memoria Persistente: Ya estudiaste')} ${recognizedFromMemory.map((m) => `"${m.term}"`).join(', ')} — ${tr('definitions kept 100% consistent with your saved study history.', 'definiciones mantenidas 100% consistentes con tu historial guardado.')}`
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
            notes: [headerContext ? `${tr('Song', 'Canción')}: ${headerContext}` : '', ...grammarNotes.slice(0, 2)].filter(Boolean).join(' | ')
        }
        : {
            word: rawLines[0] ? rawLines[0].slice(0, 80) : (songTitle || tr('Study Expression', 'Expresión de Estudio')),
            meaning: lines[0]?.romanization ? `${tr('Romanization', 'Romanización')}: ${lines[0].romanization}` : (question || tr('Add personal translation/meaning here', 'Agrega tu traducción/significado aquí')),
            example: rawLines[0] || '',
            notes: [headerContext ? `${tr('Context', 'Contexto')}: ${headerContext}` : '', tr('Generated via built-in Local Linguistic Engine (0 MB RAM)', 'Generado con Motor Lingüístico Local (0 MB RAM)')].filter(Boolean).join(' | ')
        };

    const effectiveLang = (koreanLines > 0 && englishLines > 0) || mixedLines > 0
        ? 'en_ko'
        : (koreanLines > 0 ? 'ko' : normLang);

    const summary = [
        `${tr('Instant Local Analysis', 'Análisis Local Instantáneo')} (${effectiveLang.toUpperCase()})`,
        lines.length ? `${lines.length} ${tr('line(s) scanned', 'línea(s) analizada(s)')}` : tr('Ready', 'Listo'),
        koreanLines + mixedLines > 0 ? `${koreanLines + mixedLines} ${tr('Hangul/mixed line(s) romanized automatically', 'línea(s) Hangul/mixtas romanizadas automáticamente')}` : null,
        vocabulary.length ? `${vocabulary.length} ${tr('key term(s)/pattern(s) extracted', 'término(s)/patrón(es) clave extraídos')}` : null,
        matchedRepertoireSongs.length ? `${matchedRepertoireSongs.length} ${tr('catalog song(s) matched', 'canción(es) del catálogo detectada(s)')}` : null,
        recognizedFromMemory.length ? `${recognizedFromMemory.length} ${tr('previously learned term(s) recalled from memory', 'término(s) previos recordados')}` : null,
        fallbackReason
            ? `${tr('Note: Gemini fallback', 'Nota: Respaldo local tras fallo Gemini')} (${fallbackReason})`
            : tr('Tip: Add a GEMINI_API_KEY in Settings or EC2 .env for deep poetic & bilingual translations.', 'Tip: Agrega tu GEMINI_API_KEY en Settings para análisis poético y traducciones bilingües profundas.')
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

function isTextChatGeminiModel(modelId) {
    const clean = validateGeminiModelId(modelId);
    return !/(?:-tts\b|-image\b|imagen|veo|embedding|aqa\b|native-audio|robotics|computer-use|lyria|bison|gecko)/i.test(clean);
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
            ? `Gemini API key rejected (${status}): ${apiMsg.slice(0, 140)}`
            : `Gemini API key rejected or unauthorized (HTTP ${status})`;
    }
    if (status === 404) {
        return apiMsg
            ? `Model "${model}" returned HTTP 404 (${apiMsg.slice(0, 140)})`
            : `Model "${model}" returned HTTP 404 (not found on Google Gemini API). Prueba "Test AI Connection" en Settings`;
    }
    if (status === 429) {
        return 'Gemini rate limit / quota exceeded (429). Intenta gemini-flash-latest o gemini-2.5-flash-lite en 1 minuto';
    }
    return apiMsg ? `Gemini HTTP ${status}: ${apiMsg.slice(0, 140)}` : `Gemini HTTP ${status}`;
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
        const textFirst = [
            ...usable.filter(isTextChatGeminiModel),
            ...usable.filter((id) => !isTextChatGeminiModel(id))
        ];
        return { ok: true, status: resp.status, models: textFirst, errorMessage: '' };
    } catch (err) {
        return {
            ok: false,
            status: 0,
            models: [],
            errorMessage: err?.name === 'TimeoutError' ? 'Timeout listing Gemini models' : 'Network error listing Gemini models'
        };
    }
}

function rankGeminiFallbackCandidates(primaryModel, liveModels = []) {
    const primaryLower = String(primaryModel || '').toLowerCase();
    const seen = new Set(primaryLower ? [primaryLower] : []);
    const out = [];
    const pushUnique = (id) => {
        const clean = String(id || '').trim();
        const key = clean.toLowerCase();
        if (!clean || seen.has(key) || !isTextChatGeminiModel(clean)) return;
        seen.add(key);
        out.push(clean);
    };

    const textLive = Array.isArray(liveModels) ? liveModels.filter(isTextChatGeminiModel) : [];
    for (const pref of GEMINI_FALLBACK_ORDER) {
        const match = textLive.find((m) => m.toLowerCase() === pref.toLowerCase());
        if (match) pushUnique(match);
    }
    textLive
        .filter((m) => /gemini-(?:3|2\.5|latest).*flash/i.test(m) || /flash-latest/i.test(m))
        .forEach(pushUnique);
    textLive
        .filter((m) => /gemini-(?:3|2\.5|latest).*pro/i.test(m) || /pro-latest/i.test(m))
        .forEach(pushUnique);
    textLive
        .filter((m) => !/2\.0-flash/i.test(m))
        .forEach(pushUnique);
    textLive.forEach(pushUnique);

    if (!out.length) {
        GEMINI_FALLBACK_ORDER.forEach(pushUnique);
    }
    return out;
}

function pickPreferredGeminiModel(liveModels = [], excludeModels = []) {
    const excluded = new Set(excludeModels.map((m) => String(m).toLowerCase()));
    const cleanLive = Array.isArray(liveModels)
        ? liveModels.filter((m) => !excluded.has(String(m).toLowerCase()) && isTextChatGeminiModel(m))
        : [];
    for (const pref of GEMINI_FALLBACK_ORDER) {
        const match = cleanLive.find((m) => m.toLowerCase() === pref.toLowerCase());
        if (match) return match;
    }
    const flashCand = cleanLive.find((m) => /gemini-(?:3|2\.5|latest).*flash/i.test(m))
        || cleanLive.find((m) => /flash/i.test(m) && !/2\.0-flash/i.test(m));
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
    timeoutMs = 15000,
    totalBudgetMs = 24000,
    disableThinking = false,
    fetchImpl = global.fetch
}) {
    const cleanKey = String(apiKey || '').trim();
    const primaryModel = validateGeminiModelId(model);
    const deadline = Date.now() + Math.max(4000, Number(totalBudgetMs) || 24000);

    const postOnce = async (candidateModel, apiVersion = 'v1beta', reqTimeoutMs = timeoutMs, allowThinkingCfg = disableThinking) => {
        const endpoint = `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(candidateModel)}:generateContent`;
        const canDisableThinking = Boolean(
            allowThinkingCfg
            && apiVersion === 'v1beta'
            && /gemini-2\.5-flash/i.test(candidateModel)
            && !/pro|image|tts/i.test(candidateModel)
        );
        const genConfig = {
            temperature,
            maxOutputTokens,
            ...(apiVersion === 'v1beta' && responseMimeType ? { responseMimeType } : {}),
            ...(canDisableThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {})
        };
        try {
            const resp = await fetchImpl(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': cleanKey
                },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: genConfig
                }),
                signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(reqTimeoutMs) : undefined
            });
            if (!resp.ok) {
                const errTxt = await resp.text().catch(() => '');
                if (resp.status === 400 && canDisableThinking && /thinking/i.test(errTxt)) {
                    return postOnce(candidateModel, apiVersion, reqTimeoutMs, false);
                }
                return { ok: false, status: resp.status, errType: 'http', errTxt, model: candidateModel, apiVersion };
            }
            const data = await resp.json();
            return { ok: true, status: resp.status, data, model: candidateModel, apiVersion };
        } catch (err) {
            const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|aborted/i.test(String(err?.message || ''));
            return {
                ok: false,
                status: isTimeout ? 408 : 0,
                errType: isTimeout ? 'timeout' : 'network',
                errTxt: String(err?.message || (isTimeout ? 'Timed out' : 'Network error')),
                model: candidateModel,
                apiVersion
            };
        }
    };

    const firstTimeout = Math.min(timeoutMs, Math.max(3000, deadline - Date.now()));
    const firstAttempt = await postOnce(primaryModel, 'v1beta', firstTimeout);
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

    // Auto-recover transparently on 404 or timeout by discovering & cycling through live text models within budget
    if (firstAttempt.status === 404 || firstAttempt.errType === 'timeout') {
        const listed = (deadline - Date.now()) > 2500
            ? await listAvailableGeminiModels({ apiKey: cleanKey, fetchImpl })
            : { ok: false, status: 0, models: [] };
        const candidates = rankGeminiFallbackCandidates(primaryModel, listed.models).slice(0, 6);
        const firstNote = firstAttempt.errType === 'timeout' ? 'timeout' : firstAttempt.status;
        const triedNotes = [`${primaryModel}:${firstNote}`];
        let lastFailure = firstAttempt;

        for (const cand of candidates) {
            const remMs = deadline - Date.now();
            if (remMs < 2500) break;
            const attempt = await postOnce(cand, 'v1beta', Math.min(timeoutMs, remMs));
            if (attempt.ok) {
                return {
                    ok: true,
                    status: attempt.status,
                    data: attempt.data,
                    usedModel: cand,
                    switchedFromModel: primaryModel,
                    availableModels: listed.models
                };
            }
            triedNotes.push(`${cand}:${attempt.errType === 'timeout' ? 'timeout' : attempt.status}`);
            lastFailure = attempt;
            if (attempt.status === 401 || attempt.status === 403) {
                return {
                    ok: false,
                    status: attempt.status,
                    hint: formatGeminiFailureHint(attempt.status, cand, attempt.errTxt),
                    availableModels: listed.models
                };
            }
        }

        // If /v1beta/models succeeded with models yet v1beta generateContent returned 404, try stable /v1/ endpoint
        if (listed.ok && listed.models.length > 0 && lastFailure.status === 404) {
            const v1Targets = [primaryModel, ...candidates.slice(0, 2)];
            for (const cand of v1Targets) {
                const remMs = deadline - Date.now();
                if (remMs < 2500) break;
                const v1Attempt = await postOnce(cand, 'v1', Math.min(timeoutMs, remMs));
                if (v1Attempt.ok) {
                    return {
                        ok: true,
                        status: v1Attempt.status,
                        data: v1Attempt.data,
                        usedModel: cand,
                        switchedFromModel: cand !== primaryModel ? primaryModel : null,
                        availableModels: listed.models
                    };
                }
                triedNotes.push(`${cand}@v1:${v1Attempt.errType === 'timeout' ? 'timeout' : v1Attempt.status}`);
                lastFailure = v1Attempt;
            }
        }

        let baseHint;
        if (lastFailure.errType === 'timeout') {
            baseHint = `Timed out contacting Google Gemini API (${lastFailure.model}@${lastFailure.apiVersion}). Verifica conexión HTTPS saliente hacia generativelanguage.googleapis.com`;
        } else if (lastFailure.errType === 'network') {
            baseHint = `Network error contacting Google Gemini API (${lastFailure.errTxt.slice(0, 120)})`;
        } else {
            baseHint = formatGeminiFailureHint(lastFailure.status, lastFailure.model || primaryModel, lastFailure.errTxt);
        }
        const hintWithTrace = triedNotes.length > 1
            ? `${baseHint} [Tried: ${triedNotes.join(', ')}]`
            : baseHint;
        return {
            ok: false,
            status: lastFailure.status,
            hint: hintWithTrace,
            availableModels: listed.models
        };
    }

    const baseErr = firstAttempt.errType === 'network'
        ? `Network error contacting Google Gemini API (${firstAttempt.errTxt.slice(0, 120)})`
        : formatGeminiFailureHint(firstAttempt.status, primaryModel, firstAttempt.errTxt);
    return {
        ok: false,
        status: firstAttempt.status,
        hint: baseErr,
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
            maxOutputTokens: 256,
            responseMimeType: '',
            timeoutMs: 9000,
            totalBudgetMs: 22000,
            disableThinking: true,
            fetchImpl
        });
        if (gen.ok) {
            const listed = gen.availableModels && gen.availableModels.length
                ? gen.availableModels
                : (await listAvailableGeminiModels({ apiKey: cleanKey, fetchImpl })).models;
            const textModels = listed.filter(isTextChatGeminiModel);
            return {
                ok: true,
                status: 200,
                testedModel: safeModel,
                usedModel: gen.usedModel,
                suggestedModel: gen.usedModel,
                switchedFromModel: gen.switchedFromModel || null,
                availableModels: (textModels.length ? textModels : listed).slice(0, 12),
                message: gen.switchedFromModel
                    ? `Connected! "${safeModel}" gave 404 so the app auto-detected working model "${gen.usedModel}".`
                    : `Connected! Gemini responded properly with model "${gen.usedModel}".`
            };
        }
        const suggested = pickPreferredGeminiModel(gen.availableModels, [safeModel]) || 'gemini-2.5-flash';
        const errTextModels = (gen.availableModels || []).filter(isTextChatGeminiModel);
        return {
            ok: false,
            status: gen.status || 502,
            testedModel: safeModel,
            usedModel: null,
            suggestedModel: suggested,
            availableModels: (errTextModels.length ? errTextModels : (gen.availableModels || [])).slice(0, 12),
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
    uiLang = 'es',
    fetchImpl = global.fetch
}) {
    const safeUiLang = normalizeUiLang(uiLang);
    const isEn = safeUiLang === 'en';
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
            fallbackReason: isEn ? 'No Gemini API key configured' : 'Sin clave Gemini API configurada',
            uiLang: safeUiLang
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
            fallbackReason: isEn ? 'Fetch API unavailable' : 'Fetch API no disponible',
            uiLang: safeUiLang
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

    const translationRule = normLang === 'ko'
        ? 'TRANSLATION PRIORITY RULE: For Korean study, ALWAYS translate Korean -> English (KO -> EN) as the primary meaning, and include phonetic pronunciation + Hangul.'
        : (normLang === 'en'
            ? 'TRANSLATION PRIORITY RULE: For English study, ALWAYS translate English -> Spanish (EN -> ES) and include easy phonetic pronunciation for a native Spanish speaker.'
            : 'TRANSLATION PRIORITY RULE: For mixed K-Pop (EN+KR), translate English lines -> Spanish (EN -> ES) and Korean lines -> English (KO -> EN) with Spanish support note + phonetic pronunciation.');

    const prompt = [
        'You are a practical bilingual language coach helping a native Spanish speaker who learns best through constant hands-on practice, phonetic association, and short actionable cards.',
        translationRule,
        isEn
            ? 'Explain grammar/cultural notes in concise English.'
            : 'Explica las notas gramaticales, fonéticas y de uso en español claro y directo.',
        `Target study language profile: ${langMeta.label} (${langMeta.id}).`,
        songTitle || artistName ? `Song context: "${songTitle || 'Untitled'}" by "${artistName || 'Unknown artist'}".` : '',
        ...memoryContextLines,
        boundedQuestion ? `Student question / goal: ${boundedQuestion}` : 'Task: Break down the lyrics by musical stanzas (Intro, Pre-Chorus, Main Chorus, Rap/Interlude, 2nd Pre-Chorus, Final Chorus) and extract practical cards.',
        'Input text / lyrics:',
        '"""',
        boundedText || boundedQuestion,
        '"""',
        '',
        'Return ONLY valid JSON with this exact shape:',
        '{',
        '  "summary": "2-3 sentence practical takeaway",',
        '  "stanzas": [',
        '    {',
        '      "section": "Intro | Pre-Coro | Coro Principal | Intermedio / Rap | Segundo Pre-Coro | Coro Final",',
        '      "meaningSummary": "contextual meaning of this stanza",',
        '      "phoneticGuide": "phonetic pronunciation guide for singing/speaking this stanza",',
        '      "lines": [',
        '        {',
        '          "original": "exact line",',
        '          "phonetic": "easy phonetic reading",',
        '          "meaning": "translation following the priority rule (EN->ES or KO->EN)"',
        '        }',
        '      ]',
        '    }',
        '  ],',
        '  "lines": [',
        '    {',
        '      "original": "exact line",',
        '      "script": "english | korean | mixed-kpop | neutral",',
        '      "romanization": "Revised Romanization / phonetic sound",',
        '      "meaning": "natural translation following priority rule",',
        '      "explanation": "short practical usage, modal verb, idiom, or particle note"',
        '    }',
        '  ],',
        '  "vocabulary": [',
        '    {',
        '      "term": "word, Hangul phrase, modal verb, or idiom",',
        '      "romanization": "phonetic sound / romanization",',
        '      "meaning": "concise definition (EN->ES or KO->EN)",',
        '      "category": "vocabulary | grammar | phrasal_verb",',
        '      "example": "personalized practical example sentence"',
        '    }',
        '  ],',
        '  "culturalAndGrammarNotes": ["short practical pattern cards"],',
        '  "wordNoteDraft": {',
        '    "word": "best expression to save to Word",',
        '    "meaning": "concise definition",',
        '    "example": "practical example",',
        '    "notes": "phonetic & usage tip"',
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
                fallbackReason: gen.hint,
                uiLang: safeUiLang
            });
        }

        const data = gen.data;
        const rawText = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        const parsed = robustParseJsonPayload(rawText, null);
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Unreadable Gemini analysis JSON');
        }

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
                ? (isEn
                    ? `Model "${gen.switchedFromModel}" returned 404; auto-switched to "${gen.usedModel}".`
                    : `Modelo "${gen.switchedFromModel}" devolvió 404; se usó "${gen.usedModel}".`)
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
            fallbackReason: null,
            stanzas: Array.isArray(parsed.stanzas) ? parsed.stanzas.slice(0, 12) : [],
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
            fallbackReason: err?.name === 'TimeoutError'
                ? (isEn ? 'Gemini request timed out' : 'Tiempo de espera agotado con Gemini')
                : (isEn ? 'Gemini JSON/network fallback' : 'Respaldo por error de red/JSON en Gemini'),
            uiLang: safeUiLang
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
    fallbackReason = null,
    uiLang = 'es'
}) {
    const isEn = normalizeUiLang(uiLang) === 'en';
    const tr = (en, es) => (isEn ? en : es);
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
        autoDirAdjustedNote = tr(
            'Hangul text detected: automatically translated from Korean.',
            'Texto en Hangul detectado: traducido automáticamente desde Coreano.'
        );
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
            explanationEs = tr(
                `Recognized Korean expression: "${cleanText}" [${romanization}] -> English "${koExact.en}", Spanish "${koExact.es}".`,
                `Expresión reconocida en coreano: "${cleanText}" [${romanization}] -> en inglés "${koExact.en}", en español "${koExact.es}".`
            );
            rememberable = true;
        } else if (matchedKo.length) {
            englishBridge = matchedKo.map((m) => `${m.term} (${m.romanization}) = ${m.en}`).join(' · ');
            spanishMeaning = matchedKo.map((m) => `${m.term}: ${m.es}`).join(' · ');
            primaryTranslation = effectiveDir === 'ko_en'
                ? matchedKo.map((m) => m.en).join(' / ')
                : matchedKo.map((m) => m.es).join(' / ');
            partOfSpeech = matchedKo[0].pos;
            explanationEs = tr(
                `Detected ${matchedKo.length} known element(s) in the Korean phrase. Romanization: ${romanization}.`,
                `Se detectaron ${matchedKo.length} elementos conocidos dentro de la frase en coreano. Romanización: ${romanization}.`
            );
            rememberable = true;
        } else if (memMatch) {
            primaryTranslation = memMatch.meaning || cleanText;
            spanishMeaning = memMatch.meaning || '';
            englishBridge = memMatch.meaning || '';
            explanationEs = tr(
                'Recalled from your Persistent AI Study Memory.',
                'Recuperado de tu Memoria Persistente de estudio en la plataforma.'
            );
            rememberable = true;
        } else {
            primaryTranslation = `[${tr('Romanization', 'Romanización')}: ${romanization || cleanText}]`;
            spanishMeaning = fallbackReason
                ? tr(
                    `Could not use Gemini (${fallbackReason}). Phonetic reading: ${romanization || cleanText}.`,
                    `No se pudo usar Gemini (${fallbackReason}). Lectura fonética: ${romanization || cleanText}.`
                )
                : tr(
                    `Local mode without Gemini key: phonetic reading ${romanization || cleanText}. Configure your GEMINI_API_KEY in Settings to translate full Korean phrases into English & Spanish.`,
                    `Modo local sin clave Gemini: lectura fonética ${romanization || cleanText}. Configura tu GEMINI_API_KEY en Settings para traducir cualquier frase completa de Coreano a Inglés y Español.`
                );
            englishBridge = romanization || cleanText;
            partOfSpeech = hasHangul ? 'Hangul' : tr('Text', 'Texto');
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
                explanationEs = tr(
                    `"${cleanText}" in Korean is "${koHit[0]}" (${hangulToRomanization(koHit[0])}).`,
                    `"${cleanText}" en coreano es "${koHit[0]}" (${hangulToRomanization(koHit[0])}).`
                );
                rememberable = true;
            }
        } else if (reversedEs) {
            const [term, info] = reversedEs;
            primaryTranslation = info.en || term;
            englishBridge = info.en || term;
            spanishMeaning = info.es || cleanText;
            partOfSpeech = info.pos || tr('Vocabulary', 'Vocabulario');
            explanationEs = tr(
                'Equivalent found in the local dictionary.',
                'Equivalente encontrado en diccionario local.'
            );
            rememberable = true;
        }
        if (!primaryTranslation) {
            primaryTranslation = tr(
                'Requires Google Gemini API for open ES -> EN/KR translation',
                'Requiere Google Gemini API para traducción abierta ES -> EN/KR'
            );
            spanishMeaning = cleanText;
            explanationEs = tr(
                'Local mode covers high-frequency idioms and K-Pop vocabulary. Configure Gemini API Key in Settings to translate any Spanish sentence.',
                'En modo local se incluyen expresiones frecuentes y vocabulario K-Pop. Configura Gemini API Key en Settings para traducir cualquier frase desde español.'
            );
            rememberable = false;
        }
    } else {
        // en_es (or auto with English/Latin script)
        if (exactEn) {
            primaryTranslation = exactEn.es;
            spanishMeaning = exactEn.es;
            englishBridge = cleanText;
            partOfSpeech = exactEn.pos;
            explanationEs = tr(
                `Spanish meaning for "${cleanText}" (${exactEn.pos}).`,
                `Significado en español para "${cleanText}" (${exactEn.pos}).`
            );
            rememberable = true;
        } else if (matchedEn.length) {
            primaryTranslation = matchedEn.map((m) => `${m.term}: ${m.es}`).join(' · ');
            spanishMeaning = primaryTranslation;
            englishBridge = cleanText;
            partOfSpeech = matchedEn[0].pos;
            explanationEs = tr(
                'Expression or phrasal verb matched in the local dictionary.',
                'Coincidencia de expresión o phrasal verb detectada en el diccionario local.'
            );
            rememberable = true;
        } else if (memMatch) {
            primaryTranslation = memMatch.meaning || cleanText;
            spanishMeaning = primaryTranslation;
            englishBridge = cleanText;
            explanationEs = tr(
                'Recalled from your Persistent Study Memory.',
                'Recuperado de tu Memoria Persistente de estudio.'
            );
            rememberable = true;
        } else {
            primaryTranslation = fallbackReason
                ? tr(
                    `No exact match in local dictionary (${fallbackReason})`,
                    `Sin traducción exacta en diccionario local (${fallbackReason})`
                )
                : tr(
                    'Word not in built-in compact dictionary',
                    'Palabra no está en el diccionario local reducido'
                );
            spanishMeaning = tr(
                'Enable Google Gemini API in Settings (0 MB RAM) for unlimited contextual translations, idioms & examples.',
                'Activa Google Gemini API en Settings (0 MB RAM) para traducciones ilimitadas con contexto, modismos y ejemplos en español.'
            );
            englishBridge = cleanText;
            partOfSpeech = tr('Vocabulary', 'Vocabulario');
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
    uiLang = 'es',
    fetchImpl = global.fetch
}) {
    const safeUiLang = normalizeUiLang(uiLang);
    const isEn = safeUiLang === 'en';
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
            fallbackReason: isEn ? 'No GEMINI_API_KEY configured' : 'Sin GEMINI_API_KEY configurada',
            uiLang: safeUiLang
        });
    }
    if (typeof fetchImpl !== 'function') {
        return translateOffline({
            text: cleanText,
            direction: dir,
            songTitle,
            artistName,
            learningMemory: mem,
            fallbackReason: isEn ? 'Fetch API unavailable' : 'Fetch API no disponible',
            uiLang: safeUiLang
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
        isEn
            ? '- Keep "explanationEs" clear, concise, and written in English for an English UI (explaining nuance, formality, or lyric usage).'
            : '- Keep "explanationEs" clear, concise, and ALWAYS written in Spanish.',
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
        isEn
            ? '  "explanationEs": "clear explanation in English of nuance, formality, or lyric usage",'
            : '  "explanationEs": "clear explanation in Spanish of nuance, formality, or lyric usage",',
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
            timeoutMs: 14000,
            totalBudgetMs: 22000,
            disableThinking: true,
            fetchImpl
        });

        if (!gen.ok) {
            return translateOffline({
                text: cleanText,
                direction: dir,
                songTitle,
                artistName,
                learningMemory: mem,
                fallbackReason: gen.hint,
                uiLang: safeUiLang
            });
        }

        const data = gen.data;
        const rawText = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        const parsed = robustParseJsonPayload(rawText, null);
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Unreadable Gemini analysis JSON');
        }

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
                ? (isEn
                    ? `Model "${gen.switchedFromModel}" returned 404; used "${gen.usedModel}". Update it in Settings.`
                    : `Modelo "${gen.switchedFromModel}" devolvió 404; se usó "${gen.usedModel}". Actualízalo en Settings.`)
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
            fallbackReason: err?.name === 'TimeoutError'
                ? (isEn ? 'Gemini timeout' : 'Tiempo de espera de Gemini agotado')
                : (isEn ? 'Gemini network/parse fallback' : 'Respaldo de red/formato Gemini'),
            uiLang: safeUiLang
        });
    }
}

const AI_SPANISH_LYRICS_HEADER_RE = /(?:^|\n)===\s*\[ES\s*[—-]\s*Traducción[^\]]*\]\s*===\s*\n[\s\S]*?(?=\n===\s*\[|$)/gi;

function stripAiSpanishLyricsSection(rawLyrics) {
    return String(rawLyrics || '')
        .replace(/\r\n/g, '\n')
        .replace(AI_SPANISH_LYRICS_HEADER_RE, '\n')
        .trim();
}

function splitLyricsIntoChunks(text, maxChars = 3400) {
    const clean = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!clean) return [];
    if (clean.length <= maxChars) return [clean];

    const paragraphs = clean.split(/\n{2,}/);
    const chunks = [];
    let current = '';

    for (const para of paragraphs) {
        if (para.length > maxChars) {
            if (current) {
                chunks.push(current.trim());
                current = '';
            }
            const lines = para.split('\n');
            let lineBuf = '';
            for (const line of lines) {
                const candidate = lineBuf ? `${lineBuf}\n${line}` : line;
                if (candidate.length > maxChars && lineBuf) {
                    chunks.push(lineBuf.trim());
                    lineBuf = line;
                } else {
                    lineBuf = candidate;
                }
            }
            if (lineBuf.trim()) chunks.push(lineBuf.trim());
            continue;
        }
        const candidate = current ? `${current}\n\n${para}` : para;
        if (candidate.length > maxChars && current) {
            chunks.push(current.trim());
            current = para;
        } else {
            current = candidate;
        }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.slice(0, 5);
}

function translateLyricsToSpanishOffline({
    lyrics = '',
    songTitle = '',
    artistName = '',
    learningMemory = null,
    fallbackReason = null,
    uiLang = 'es'
} = {}) {
    const isEn = normalizeUiLang(uiLang) === 'en';
    const cleanLyrics = stripAiSpanishLyricsSection(lyrics).slice(0, 12000);
    const mem = sanitizeLanguageMemory(learningMemory);
    const script = detectScriptKind(cleanLyrics);
    const lines = cleanLyrics.split('\n');
    const outLines = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            outLines.push('');
            continue;
        }
        if (/^(?:===\s*)?\[[^\]]+\](?:\s*===)?$/.test(line)) {
            outLines.push(line);
            continue;
        }
        const lineScript = detectScriptKind(line);
        const hasHangul = lineScript === 'korean' || lineScript === 'mixed-kpop';
        const res = translateOffline({
            text: line,
            direction: hasHangul ? 'ko_es' : 'en_es',
            songTitle,
            artistName,
            learningMemory: mem,
            uiLang
        });
        if (res.rememberable && res.translatedText && res.translatedText !== line) {
            outLines.push(`${line} → ${res.translatedText}`);
        } else if (hasHangul) {
            const rom = hangulToRomanization(line);
            outLines.push(rom && rom !== line ? `${line} [${rom}]` : line);
        } else {
            outLines.push(line);
        }
    }

    const headerNote = fallbackReason
        ? (isEn
            ? `[Offline mode (${fallbackReason}) — Romanization & known vocabulary applied]`
            : `[Modo local (${fallbackReason}) — Se aplicó romanización y vocabulario conocido]`)
        : (isEn
            ? '[Offline mode — Configure GEMINI_API_KEY in Settings for full poetic Spanish translation]'
            : '[Modo local — Configura GEMINI_API_KEY en Ajustes para traducción completa al español con IA]');

    const spanishLyrics = `${headerNote}\n\n${outLines.join('\n').trim()}`;
    return {
        ok: true,
        source: 'offline-fallback',
        model: 'built-in-lyric-translator-v1',
        switchedFromModel: null,
        usedGemini: false,
        detectedScript: script,
        detectedLanguages: [script],
        spanishLyrics,
        translatedText: spanishLyrics,
        formattedSection: `=== [ES — Traducción Local] ===\n${spanishLyrics}`,
        fallbackReason: fallbackReason || null,
        chunkCount: 1
    };
}

function extractGeminiJsonCandidates(rawText) {
    const raw = String(rawText || '').trim();
    if (!raw) return [];

    const candidates = [];
    const seen = new Set();
    const pushCandidate = (val) => {
        const trimmed = String(val || '').trim();
        if (trimmed && !seen.has(trimmed)) {
            seen.add(trimmed);
            candidates.push(trimmed);
        }
    };

    const fenceRe = /```(?:json|javascript|js)?\s*\n?([\s\S]*?)(?:```|$)/gi;
    let fenceMatch;
    while ((fenceMatch = fenceRe.exec(raw)) !== null) {
        if (fenceMatch[1]) pushCandidate(fenceMatch[1]);
        if (!fenceMatch[0]) break;
    }

    const stripped = raw
        .replace(/^```[a-zA-Z]*\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
    pushCandidate(stripped);
    pushCandidate(raw);

    const baseList = [...candidates];
    for (const item of baseList) {
        const firstObj = item.indexOf('{');
        const lastObj = item.lastIndexOf('}');
        if (firstObj !== -1 && lastObj > firstObj) {
            pushCandidate(item.slice(firstObj, lastObj + 1));
        }
        const firstArr = item.indexOf('[');
        const lastArr = item.lastIndexOf(']');
        if (firstArr !== -1 && lastArr > firstArr && (firstObj === -1 || firstArr < firstObj)) {
            pushCandidate(item.slice(firstArr, lastArr + 1));
        }
    }

    return candidates;
}

function skipWs(str, idx) {
    let i = idx;
    while (i < str.length && /\s/.test(str[i])) i++;
    return i;
}

function isNextTokenJsonKeyOrEnd(str, commaIdx) {
    const i = skipWs(str, commaIdx + 1);
    if (i >= str.length || str[i] === '}' || str[i] === ']') return true;
    if (str[i] !== '"') return false;
    let j = i + 1;
    while (j < str.length) {
        if (str[j] === '\\') {
            j += 2;
            continue;
        }
        if (str[j] === '"') {
            const afterKey = skipWs(str, j + 1);
            return afterKey < str.length && str[afterKey] === ':';
        }
        if (str[j] === '\n' || str[j] === '\r') break;
        j++;
    }
    return false;
}

function isNextTokenArrayValueOrEnd(str, commaIdx) {
    const i = skipWs(str, commaIdx + 1);
    if (i >= str.length || str[i] === ']' || str[i] === '}') return true;
    const ch = str[i];
    if (ch === '"' || ch === '{' || ch === '[' || ch === '-' || (ch >= '0' && ch <= '9')) return true;
    const rest = str.slice(i);
    if (/^(?:true|false|null)(?=$|[\s,\]}])/.test(rest)) return true;
    return false;
}

function isClosingStructurePlausible(str, closeCharIdx, containerStack) {
    const nextIdx = skipWs(str, closeCharIdx + 1);
    if (nextIdx >= str.length) return true;
    const nextChar = str[nextIdx];
    const parentType = containerStack.length >= 2 ? containerStack[containerStack.length - 2].type : null;
    if (!parentType) return nextIdx >= str.length;
    if (parentType === '{') {
        if (nextChar === '}') return true;
        if (nextChar === ',') return isNextTokenJsonKeyOrEnd(str, nextIdx);
        return false;
    }
    if (parentType === '[') {
        if (nextChar === ']') return true;
        if (nextChar === ',') return isNextTokenArrayValueOrEnd(str, nextIdx);
        return false;
    }
    return true;
}

function sanitizeJsonText(str, repairInternalQuotes = false) {
    let out = '';
    let inString = false;
    let isKey = false;
    const stack = [];

    const top = () => stack[stack.length - 1] || null;
    const setAfterValue = () => {
        const cur = top();
        if (cur) cur.expect = 'COMMA_OR_END';
    };

    for (let i = 0; i < str.length; i++) {
        const ch = str[i];

        if (inString) {
            if (ch === '\\') {
                const next = str[i + 1];
                if (next === undefined) {
                    out += '\\\\';
                    continue;
                }
                if ('"\\/bfnrtu'.includes(next)) {
                    out += ch + next;
                    i++;
                    continue;
                }
                if (next === "'") {
                    out += "'";
                    i++;
                    continue;
                }
                out += '\\\\';
                continue;
            }
            if (ch === '\r') {
                if (str[i + 1] === '\n') i++;
                out += '\\n';
                continue;
            }
            if (ch === '\n') {
                out += '\\n';
                continue;
            }
            if (ch === '\t') {
                out += '\\t';
                continue;
            }
            if (ch.charCodeAt(0) < 0x20) {
                continue;
            }
            if (ch === '"') {
                if (!repairInternalQuotes) {
                    inString = false;
                    out += '"';
                    if (isKey) {
                        const cur = top();
                        if (cur) cur.expect = 'COLON';
                    } else {
                        setAfterValue();
                    }
                    isKey = false;
                    continue;
                }

                const nextIdx = skipWs(str, i + 1);
                const nextCh = nextIdx < str.length ? str[nextIdx] : '';
                const cur = top();
                let shouldClose = false;

                if (isKey) {
                    shouldClose = nextCh === ':';
                } else if (!cur) {
                    shouldClose = nextIdx >= str.length;
                } else if (cur.type === '{') {
                    if (nextIdx >= str.length) {
                        shouldClose = true;
                    } else if (nextCh === ',') {
                        shouldClose = isNextTokenJsonKeyOrEnd(str, nextIdx);
                    } else if (nextCh === '}') {
                        shouldClose = isClosingStructurePlausible(str, nextIdx, stack);
                    }
                } else if (cur.type === '[') {
                    if (nextIdx >= str.length) {
                        shouldClose = true;
                    } else if (nextCh === ',') {
                        shouldClose = isNextTokenArrayValueOrEnd(str, nextIdx);
                    } else if (nextCh === ']') {
                        shouldClose = isClosingStructurePlausible(str, nextIdx, stack);
                    }
                }

                if (shouldClose) {
                    inString = false;
                    out += '"';
                    if (isKey) {
                        if (cur) cur.expect = 'COLON';
                    } else {
                        setAfterValue();
                    }
                    isKey = false;
                } else {
                    out += '\\"';
                }
                continue;
            }
            out += ch;
            continue;
        }

        if (ch === '"') {
            inString = true;
            const cur = top();
            isKey = Boolean(cur && cur.type === '{' && cur.expect === 'KEY_OR_END');
            out += '"';
            continue;
        }
        if (ch === '{') {
            stack.push({ type: '{', expect: 'KEY_OR_END' });
            out += '{';
            continue;
        }
        if (ch === '[') {
            stack.push({ type: '[', expect: 'VALUE_OR_END' });
            out += '[';
            continue;
        }
        if (ch === '}' || ch === ']') {
            out = out.replace(/,\s*$/, '');
            if (stack.length > 0) stack.pop();
            out += ch;
            setAfterValue();
            continue;
        }
        if (ch === ':') {
            const cur = top();
            if (cur && cur.type === '{') cur.expect = 'VALUE';
            out += ':';
            continue;
        }
        if (ch === ',') {
            const cur = top();
            if (cur) cur.expect = cur.type === '{' ? 'KEY_OR_END' : 'VALUE_OR_END';
            out += ',';
            continue;
        }
        out += ch;
    }

    if (inString) {
        out += '"';
    }
    out = out.replace(/,\s*$/, '');
    while (stack.length > 0) {
        const unclosed = stack.pop();
        out += unclosed.type === '{' ? '}' : ']';
    }
    return out;
}

function robustParseJsonPayload(rawText, fallbackObj = {}) {
    const candidates = extractGeminiJsonCandidates(rawText);
    for (const cand of candidates) {
        try {
            const direct = JSON.parse(cand);
            if (direct !== undefined && direct !== null) return direct;
        } catch (_) {}

        try {
            const cleaned = sanitizeJsonText(cand, false);
            const parsedClean = JSON.parse(cleaned);
            if (parsedClean !== undefined && parsedClean !== null) return parsedClean;
        } catch (_) {}

        try {
            const repaired = sanitizeJsonText(cand, true);
            const parsedRepaired = JSON.parse(repaired);
            if (parsedRepaired !== undefined && parsedRepaired !== null) return parsedRepaired;
        } catch (_) {}
    }
    return fallbackObj;
}

function parseGeminiLyricsTranslationPayload(rawText) {
    const raw = String(rawText || '').trim();
    if (!raw) return { ok: false, spanishLyrics: '', detectedLanguages: [] };

    const parsed = robustParseJsonPayload(raw, null);
    if (parsed && typeof parsed === 'object') {
        const rawLyrics = parsed.spanishLyrics ?? parsed.translatedText ?? parsed.translation ?? parsed.lyrics ?? '';
        const text = (Array.isArray(rawLyrics) ? rawLyrics.join('\n') : String(rawLyrics || '')).trim();
        const langs = Array.isArray(parsed.detectedLanguages)
            ? parsed.detectedLanguages.map((x) => String(x || '').trim()).filter(Boolean)
            : [];
        if (text) return { ok: true, spanishLyrics: text, detectedLanguages: langs };
    }

    const stripped = raw
        .replace(/^```[a-zA-Z]*\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();

    const extractUnescapedField = (str) => str
        .replace(/\\r\\n|\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .trim();

    const keyMatch = stripped.match(
        /"(?:spanishLyrics|translatedText|translation)"\s*:\s*"([\s\S]+?)(?:"\s*,\s*"[a-zA-Z0-9_]+"\s*:|"\s*\}\s*$)/
    ) || stripped.match(
        /"(?:spanishLyrics|translatedText|translation)"\s*:\s*"([\s\S]+)$/
    );
    if (keyMatch && keyMatch[1]) {
        const recovered = extractUnescapedField(keyMatch[1].replace(/"\s*\}?\s*$/, ''));
        if (recovered) {
            const langsMatch = stripped.match(/"detectedLanguages"\s*:\s*\[([^\]]*)\]/);
            const langs = langsMatch && langsMatch[1]
                ? langsMatch[1].split(',').map((x) => x.replace(/["'\s]/g, '').trim()).filter(Boolean)
                : [];
            return { ok: true, spanishLyrics: recovered, detectedLanguages: langs };
        }
    }

    if (stripped && !stripped.startsWith('{') && !stripped.startsWith('[')) {
        return { ok: true, spanishLyrics: stripped, detectedLanguages: [] };
    }
    return { ok: false, spanishLyrics: '', detectedLanguages: [] };
}

async function translateLyricsToSpanishWithGemini({
    apiKey,
    model = 'gemini-2.5-flash',
    lyrics = '',
    songTitle = '',
    artistName = '',
    language = '',
    learningMemory = null,
    uiLang = 'es',
    fetchImpl = global.fetch
} = {}) {
    const safeUiLang = normalizeUiLang(uiLang);
    const isEn = safeUiLang === 'en';
    const sourceLyrics = stripAiSpanishLyricsSection(lyrics).slice(0, 12000);
    if (!sourceLyrics) {
        return { ok: false, error: isEn ? 'No lyrics provided to translate.' : 'No se proporcionó letra para traducir.' };
    }

    const mem = sanitizeLanguageMemory(learningMemory);
    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey) {
        return translateLyricsToSpanishOffline({
            lyrics: sourceLyrics,
            songTitle,
            artistName,
            learningMemory: mem,
            fallbackReason: isEn ? 'No GEMINI_API_KEY configured' : 'Sin GEMINI_API_KEY configurada',
            uiLang: safeUiLang
        });
    }
    if (typeof fetchImpl !== 'function') {
        return translateLyricsToSpanishOffline({
            lyrics: sourceLyrics,
            songTitle,
            artistName,
            learningMemory: mem,
            fallbackReason: isEn ? 'Fetch API unavailable' : 'Fetch API no disponible',
            uiLang: safeUiLang
        });
    }

    const chunks = splitLyricsIntoChunks(sourceLyrics, 3400);
    let activeModel = validateGeminiModelId(model);
    let switchedFromModel = null;
    const translatedChunks = [];
    const detectedLangs = new Set();
    let anyGeminiSucceeded = false;
    let lastHint = null;

    for (let idx = 0; idx < chunks.length; idx += 1) {
        const chunk = chunks[idx];
        const prompt = [
            'You are an expert music lyric translator helping a native Spanish speaker study songs in English, Korean (Hangul / K-Pop), and Japanese.',
            songTitle || artistName ? `Song: "${String(songTitle || '').slice(0, 140)}" by "${String(artistName || '').slice(0, 140)}" (${String(language || 'auto').slice(0, 60)}).` : '',
            chunks.length > 1 ? `Chunk ${idx + 1} of ${chunks.length}.` : '',
            'Translate ALL non-Spanish lyrics below naturally, faithfully, and poetically into Mexican/neutral Spanish.',
            'Rules:',
            '- Preserve blank lines and stanza spacing cleanly.',
            '- Keep structural tags like [Verse 1], [Chorus], [Bridge], [Intro], [Outro] clear in Spanish or clean bracket form (e.g. [Coro], [Verso 1]).',
            '- If the input has Korean Hangul mixed with English, translate both smoothly into natural Spanish while keeping ad-libs/proper names intact.',
            '- If the input contains multiple distinct language blocks like [KO] and [EN] for the same song, translate clearly without inventing extra verses; if a section is already natural Spanish, polish and keep it.',
            '- Do NOT add explanations outside the lyrics or repeat chunks.',
            'Return ONLY valid JSON: {"spanishLyrics":"<translated multiline lyrics>","detectedLanguages":["English","Korean"]}',
            '',
            'Lyrics chunk:',
            '"""',
            chunk,
            '"""'
        ].filter(Boolean).join('\n');

        const gen = await callGeminiGenerateContent({
            apiKey: cleanKey,
            model: activeModel,
            prompt,
            temperature: 0.2,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
            timeoutMs: 18000,
            totalBudgetMs: 28000,
            disableThinking: true,
            fetchImpl
        });

        if (!gen.ok) {
            lastHint = gen.hint || 'Gemini error';
            const off = translateLyricsToSpanishOffline({
                lyrics: chunk,
                songTitle,
                artistName,
                learningMemory: mem,
                fallbackReason: lastHint,
                uiLang: safeUiLang
            });
            translatedChunks.push(off.spanishLyrics);
            continue;
        }

        if (gen.usedModel) {
            if (gen.switchedFromModel && !switchedFromModel) switchedFromModel = gen.switchedFromModel;
            activeModel = gen.usedModel;
        }

        const rawText = gen.data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        const parsed = parseGeminiLyricsTranslationPayload(rawText);
        if (!parsed.ok || !parsed.spanishLyrics) {
            lastHint = isEn ? 'Unreadable Gemini response format' : 'Formato de respuesta Gemini ilegible';
            const off = translateLyricsToSpanishOffline({
                lyrics: chunk,
                songTitle,
                artistName,
                learningMemory: mem,
                fallbackReason: lastHint,
                uiLang: safeUiLang
            });
            translatedChunks.push(off.spanishLyrics);
            continue;
        }

        anyGeminiSucceeded = true;
        translatedChunks.push(parsed.spanishLyrics);
        parsed.detectedLanguages.forEach((l) => detectedLangs.add(l));
    }

    if (!anyGeminiSucceeded) {
        return translateLyricsToSpanishOffline({
            lyrics: sourceLyrics,
            songTitle,
            artistName,
            learningMemory: mem,
            fallbackReason: lastHint,
            uiLang: safeUiLang
        });
    }

    const combinedEs = translatedChunks.join('\n\n').trim();
    return {
        ok: true,
        source: 'gemini',
        model: activeModel,
        switchedFromModel,
        usedGemini: true,
        detectedScript: detectScriptKind(sourceLyrics),
        detectedLanguages: Array.from(detectedLangs),
        spanishLyrics: combinedEs,
        translatedText: combinedEs,
        formattedSection: `=== [ES — Traducción IA] ===\n${combinedEs}`,
        fallbackReason: lastHint,
        chunkCount: chunks.length
    };
}
const _liveModelsCache = new Map();
const LIVE_MODELS_TTL_MS = 5 * 60 * 1000;

async function getAvailableGeminiModelsForUser({ apiKey, fetchImpl = global.fetch, forceRefresh = false } = {}) {
    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey) {
        return {
            configured: false,
            verified: false,
            models: [],
            fastModel: '',
            reasoningModel: ''
        };
    }

    const cacheKey = cleanKey.slice(0, 12);
    const cached = !forceRefresh ? _liveModelsCache.get(cacheKey) : null;
    if (cached && cached.expiresAt > Date.now()) {
        return cached.payload;
    }

    const listed = await listAvailableGeminiModels({ apiKey: cleanKey, fetchImpl });
    const liveIds = listed.ok && Array.isArray(listed.models) ? listed.models.filter(isTextChatGeminiModel) : [];
    const knownMap = new Map(RECOMMENDED_GEMINI_MODELS.map((m) => [m.id.toLowerCase(), m]));

    // Muestra ÚNICAMENTE modelos activos y verificados para la API key actual
    const models = liveIds.map((id) => {
        const meta = knownMap.get(id.toLowerCase());
        const isReasoning = /pro|thinking/i.test(id);
        return {
            id,
            label: meta ? meta.label : `${id} (${isReasoning ? 'Razonamiento detallado' : 'Consulta rápida'})`,
            notes: meta ? meta.notes : (isReasoning ? 'Ideal para desglose profundo de canciones y lecciones.' : 'Ideal para traducciones rápidas y fonética.'),
            mode: isReasoning ? 'reasoning' : 'fast',
            freeTier: /flash|pro/i.test(id),
            available: true
        };
    });

    const fastCandidate = models.find((m) => m.mode === 'fast') || models[0] || null;
    const reasoningCandidate = models.find((m) => m.mode === 'reasoning') || fastCandidate;
    const payload = {
        configured: true,
        verified: listed.ok && models.length > 0,
        models,
        fastModel: fastCandidate ? fastCandidate.id : '',
        reasoningModel: reasoningCandidate ? reasoningCandidate.id : ''
    };
    if (payload.verified) {
        _liveModelsCache.set(cacheKey, { payload, expiresAt: Date.now() + LIVE_MODELS_TTL_MS });
    }
    return payload;
}

const DEFAULT_CURRICULUM_LESSONS = [
    { codigo: 'EN-L01', idioma: 'en', orden: 1, nombre: '1. Alfabeto Inglés, Sonidos Fonéticos y Conectores Diarios (EN -> ES)' },
    { codigo: 'EN-L02', idioma: 'en', orden: 2, nombre: '2. Modal Verbs en Acción (Can, Could, Should, Must, Would) en Canciones' },
    { codigo: 'EN-L03', idioma: 'en', orden: 3, nombre: '3. Phrasal Verbs e Idioms Esenciales de Pop/Rock (EN -> ES)' },
    { codigo: 'EN-L04', idioma: 'en', orden: 4, nombre: '4. Contracciones Vocales (Gonna, Wanna, Gotta) y Ritmo Conversacional' },
    { codigo: 'KO-L01', idioma: 'ko', orden: 5, nombre: '5. Alfabeto Hangul: Vocales, Consonantes y Bloques Silábicos (KO -> EN)' },
    { codigo: 'KO-L02', idioma: 'ko', orden: 6, nombre: '6. Reglas de Batchim (Liaison Fonético) y Saludos Esenciales (KO -> EN)' },
    { codigo: 'KO-L03', idioma: 'ko', orden: 7, nombre: '7. Partículas Coreanas (은/는, 이/가, 을/를) con Vocabulario K-Pop (KO -> EN)' },
    { codigo: 'KO-L04', idioma: 'ko', orden: 8, nombre: '8. Estrofas Mixtas K-Pop (Intro, Pre-Coro, Coro y Rap) en Práctica Activa' }
];

async function generatePracticalLessonForWord({
    apiKey,
    model = 'gemini-2.5-flash',
    lessonCode = 'EN-L01',
    lessonName = '',
    language = 'en',
    learningMemory = null,
    fetchImpl = global.fetch
} = {}) {
    const normLang = language === 'ko' ? 'ko' : 'en';
    const mem = sanitizeLanguageMemory(learningMemory);
    const knownWords = mem.terms.slice(0, 15).map((t) => `${t.term} (${t.meaning})`).join(', ');
    const translationDirection = normLang === 'ko' ? 'Korean -> English (KO -> EN)' : 'English -> Spanish (EN -> ES)';

    const fallbackLesson = {
        lessonCode,
        lessonName: lessonName || 'Práctica Activa (15 min)',
        language: normLang,
        durationMinutes: 15,
        phoneticCards: normLang === 'ko'
            ? [
                { symbol: 'ㅏ / ㅓ / ㅗ / ㅜ', sound: '[a] / [eo] / [o] / [u]', example: '사랑 (sa-rang) -> Love' },
                { symbol: 'ㄱ / ㄴ / ㅁ / ㅅ', sound: '[g/k] / [n] / [m] / [s]', example: '마음 (ma-eum) -> Heart / Mind' }
            ]
            : [
                { symbol: 'TH /ʃ/ /tʃ/', sound: '[d/z suave] / [sh] / [ch]', example: 'Through [zru] -> A través de' },
                { symbol: 'Linking Vowel', sound: 'Hold_on -> [joldon]', example: 'Hold on to your dream -> Aférrate a tu sueño' }
            ],
        practicalDrills: [
            { prompt: normLang === 'ko' ? 'Traduce al inglés: 마음 (ma-eum)' : 'Completa con Modal Verb: I ___ (debería) practice 15 minutes today.', answer: normLang === 'ko' ? 'Heart / Mind / Feelings' : 'should' },
            { prompt: normLang === 'ko' ? '¿Cómo suena 영원히?' : '¿Qué significa el phrasal verb "break through"?', answer: normLang === 'ko' ? '[yeong-won-hi] -> Forever' : 'Abrirse paso / superar un obstáculo' }
        ],
        quizQuestions: [
            {
                question: normLang === 'ko' ? '¿Cuál es el significado en inglés de "사랑해 (saranghae)"?' : '¿Qué significa "hold on" en una canción o conversación?',
                options: normLang === 'ko'
                    ? ['I love you', 'See you tomorrow', 'Thank you']
                    : ['Rendirse rápido', 'Esperar / resistir / aferrarse', 'Olvidar el pasado'],
                correctIndex: 0,
                explanation: normLang === 'ko' ? '사랑해 (saranghae) = I love you.' : '"Hold on" significa esperar un momento o resistir ante algo difícil.'
            }
        ]
    };

    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey || typeof fetchImpl !== 'function') {
        return { ...fallbackLesson, wordPayload: buildLessonWordPayload(fallbackLesson) };
    }

    const prompt = [
        'You are a practical language coach designing a 15-minute active recall micro-lesson for a student who forgets dense theory and learns best by constant practice.',
        `Lesson: "${lessonName}" (${lessonCode}).`,
        `Mandatory translation direction: ${translationDirection}.`,
        knownWords ? `Reinforce these previously learned words from the student's notebook: ${knownWords}` : '',
        'Return ONLY valid JSON matching:',
        '{',
        '  "phoneticCards": [{ "symbol": "item/pattern", "sound": "phonetic reading", "example": "practical example with translation" }],',
        '  "practicalDrills": [{ "prompt": "short active exercise", "answer": "correct answer + 1-line why" }],',
        '  "quizQuestions": [{ "question": "question text", "options": ["A", "B", "C"], "correctIndex": 0, "explanation": "short feedback" }]',
        '}'
    ].filter(Boolean).join('\n');

    try {
        const gen = await callGeminiGenerateContent({
            apiKey: cleanKey,
            model,
            prompt,
            temperature: 0.3,
            maxOutputTokens: 1200,
            responseMimeType: 'application/json',
            timeoutMs: 16000,
            disableThinking: true,
            fetchImpl
        });
        if (gen.ok) {
            const rawText = gen.data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
            const parsed = robustParseJsonPayload(rawText, null);
            if (!parsed || typeof parsed !== 'object') {
                throw new Error('Unreadable Gemini micro-lesson JSON');
            }
            const full = {
                lessonCode,
                lessonName,
                language: normLang,
                durationMinutes: 15,
                phoneticCards: Array.isArray(parsed.phoneticCards) ? parsed.phoneticCards.slice(0, 6) : fallbackLesson.phoneticCards,
                practicalDrills: Array.isArray(parsed.practicalDrills) ? parsed.practicalDrills.slice(0, 5) : fallbackLesson.practicalDrills,
                quizQuestions: Array.isArray(parsed.quizQuestions) ? parsed.quizQuestions.slice(0, 4) : fallbackLesson.quizQuestions
            };
            return { ...full, wordPayload: buildLessonWordPayload(full) };
        }
    } catch (_) {}

    return { ...fallbackLesson, wordPayload: buildLessonWordPayload(fallbackLesson) };
}

function buildLessonWordPayload(lesson) {
    const cardsTxt = (lesson.phoneticCards || [])
        .map((c) => `• ${c.symbol} [${c.sound}] -> ${c.example}`)
        .join('\n');
    const drillsTxt = (lesson.practicalDrills || [])
        .map((d, i) => `${i + 1}) Práctica: ${d.prompt}\n   Respuesta: ${d.answer}`)
        .join('\n');
    const quizTxt = (lesson.quizQuestions || [])
        .map((q, i) => `Q${i + 1}: ${q.question} -> Respuesta correcta: ${(q.options || [])[q.correctIndex] || ''} (${q.explanation || ''})`)
        .join('\n');

    return {
        category: 'grammar',
        language: lesson.language === 'ko' ? 'Korean (KO -> EN)' : 'English (EN -> ES)',
        title: `[LECCIÓN ${lesson.lessonCode}] ${lesson.lessonName}`,
        notes: `=== FICHAS FONÉTICAS Y PATRONES ===\n${cardsTxt}\n\n=== EJERCICIOS PRÁCTICOS (15 MIN) ===\n${drillsTxt}`,
        example: `=== CUESTIONARIO DE REPASO ===\n${quizTxt}`
    };
}

async function evaluatePronunciation({
    apiKey,
    model = 'gemini-2.5-flash',
    targetText = '',
    spokenText = '',
    language = 'en',
    fetchImpl = global.fetch
} = {}) {
    const cleanTarget = String(targetText || '').trim().slice(0, 500);
    const cleanSpoken = String(spokenText || '').trim().slice(0, 500);
    const normLang = normalizeStudyLanguage(language);
    const autoRom = /[\uAC00-\uD7A3]/.test(cleanTarget) ? hangulToRomanization(cleanTarget) : '';

    const normalizeTokens = (str) => String(str || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
    const targetTokens = normalizeTokens(cleanTarget);
    const spokenTokens = normalizeTokens(cleanSpoken);
    const matched = targetTokens.filter((t) => spokenTokens.includes(t)).length;
    const baseScore = targetTokens.length > 0 ? Math.round((matched / targetTokens.length) * 100) : 0;

    const fallbackEval = {
        ok: true,
        targetText: cleanTarget,
        spokenText: cleanSpoken,
        phoneticTarget: autoRom || cleanTarget,
        score: baseScore,
        feedback: baseScore >= 80
            ? '¡Excelente pronunciación! El ritmo y los sonidos principales se captaron con claridad.'
            : 'Buen intento. Repite marcando las consonantes finales y el enlace entre sílabas.',
        mouthTip: normLang === 'ko'
            ? `Guía fonética Hangul: [${autoRom || cleanTarget}]`
            : 'Conecta las vocales al final de una palabra con la consonante siguiente (Connected Speech).'
    };

    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey || typeof fetchImpl !== 'function') {
        return fallbackEval;
    }

    const prompt = [
        'You are a phonetic pronunciation coach for a native Spanish speaker learning English and Korean.',
        `Target phrase: "${cleanTarget}" ${autoRom ? `(Romanization: ${autoRom})` : ''}`,
        `Microphone speech-to-text captured: "${cleanSpoken}"`,
        'Return ONLY valid JSON: {"score": 0-100, "phoneticTarget": "easy phonetic reading", "feedback": "2-sentence encouraging feedback in Spanish", "mouthTip": "specific tongue/lip/syllable tip in Spanish"}'
    ].join('\n');

    try {
        const gen = await callGeminiGenerateContent({
            apiKey: cleanKey,
            model,
            prompt,
            temperature: 0.2,
            maxOutputTokens: 400,
            responseMimeType: 'application/json',
            timeoutMs: 12000,
            disableThinking: true,
            fetchImpl
        });
        if (gen.ok) {
            const rawText = gen.data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
            const parsed = robustParseJsonPayload(rawText, null);
            if (!parsed || typeof parsed !== 'object') {
                throw new Error('Unreadable Gemini micro-lesson JSON');
            }
            return {
                ok: true,
                targetText: cleanTarget,
                spokenText: cleanSpoken,
                phoneticTarget: String(parsed.phoneticTarget || autoRom || cleanTarget).trim(),
                score: Number.isFinite(Number(parsed.score)) ? Math.max(0, Math.min(100, Number(parsed.score))) : baseScore,
                feedback: String(parsed.feedback || fallbackEval.feedback).trim(),
                mouthTip: String(parsed.mouthTip || fallbackEval.mouthTip).trim()
            };
        }
    } catch (_) {}

    return fallbackEval;
}

module.exports = {
    LANGUAGE_REGISTRY,
    RECOMMENDED_GEMINI_MODELS,
    TRANSLATION_DIRECTIONS,
    getLanguageRegistry,
    normalizeStudyLanguage,
    normalizeTranslationDirection,
    normalizeUiLang,
    validateGeminiModelId,
    hangulToRomanization,
    detectScriptKind,
    isPoisonedMemoryMeaning,
    sanitizeLanguageMemory,
    mergeLanguageMemory,
    matchRepertoireSongs,
    analyzeTextOffline,
    analyzeWithGemini,
    robustParseJsonPayload,
    parseGeminiLyricsTranslationPayload,
    translateOffline,
    translateWithGemini,
    translateLyricsToSpanishOffline,
    translateLyricsToSpanishWithGemini,
    DEFAULT_CURRICULUM_LESSONS,
    getAvailableGeminiModelsForUser,
    generatePracticalLessonForWord,
    evaluatePronunciation,
    listAvailableGeminiModels,
    testGeminiConnection
};
