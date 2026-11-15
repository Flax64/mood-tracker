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
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro (Deep Reasoning & Poetry Nuance)',
        notes: 'Best for nuanced song metaphors, honorifics, and detailed grammar comparisons.'
    },
    {
        id: 'gemini-2.0-flash',
        label: 'Gemini 2.0 Flash (Lightweight Fast Fallback)',
        notes: 'Low-latency conversational explanations.'
    }
];

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
        ? Array.from(new Set(src.grammarNotes.map((g) => String(g || '').trim().slice(0, 240)).filter(Boolean))).slice(0, 40)
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

function analyzeTextOffline({
    text = '',
    question = '',
    language = 'en',
    songTitle = '',
    artistName = '',
    learningMemory = null,
    fallbackReason = null
}) {
    const sourceText = String(text || question || '').trim().slice(0, 10000);
    const normLang = normalizeStudyLanguage(language);
    const rawLines = sourceText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 60);
    const mem = sanitizeLanguageMemory(learningMemory);
    const recognizedFromMemory = findRecognizedMemoryTerms(sourceText, mem);

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

    if (recognizedFromMemory.length > 0) {
        grammarNotes.unshift(
            `🧠 Memory Recall: You already studied ${recognizedFromMemory.map((m) => `"${m.term}"`).join(', ')} — definitions kept 100% consistent with your saved study history.`
        );
    }

    const firstVocab = vocabulary.find((v) => !v.learnedPreviously) || vocabulary[0];
    const headerContext = [songTitle, artistName].filter(Boolean).join(' - ');
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
        memoryTotalTerms: mem.terms.length,
        fallbackReason: fallbackReason || null
    };
}

function validateGeminiModelId(model) {
    const clean = String(model || 'gemini-2.5-flash').trim();
    if (!/^[a-zA-Z0-9._-]{3,80}$/.test(clean)) {
        return 'gemini-2.5-flash';
    }
    return clean;
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
    fetchImpl = global.fetch
}) {
    const cleanKey = String(apiKey || '').trim();
    const safeModel = validateGeminiModelId(model);
    const mem = sanitizeLanguageMemory(learningMemory);
    if (!cleanKey) {
        return analyzeTextOffline({
            text,
            question,
            language,
            songTitle,
            artistName,
            learningMemory: mem,
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

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(safeModel)}:generateContent`;

    try {
        const resp = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': cleanKey
            },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.35,
                    maxOutputTokens: 2048,
                    responseMimeType: 'application/json'
                }
            }),
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined
        });

        if (!resp.ok) {
            const errTxt = await resp.text().catch(() => '');
            const hint = resp.status === 401 || resp.status === 403
                ? 'Gemini API key rejected or unauthorized'
                : resp.status === 404
                    ? `Model "${safeModel}" not found on this API key`
                    : resp.status === 429
                        ? 'Gemini rate limit/quota reached'
                        : `Gemini HTTP ${resp.status}`;
            return analyzeTextOffline({
                text,
                question,
                language,
                songTitle,
                artistName,
                learningMemory: mem,
                fallbackReason: errTxt ? `${hint}` : hint
            });
        }

        const data = await resp.json();
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
            model: safeModel,
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
            memoryTotalTerms: mem.terms.length,
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
            fallbackReason: err?.name === 'TimeoutError' ? 'Gemini request timed out' : 'Gemini JSON/network fallback'
        });
    }
}

module.exports = {
    LANGUAGE_REGISTRY,
    RECOMMENDED_GEMINI_MODELS,
    getLanguageRegistry,
    normalizeStudyLanguage,
    validateGeminiModelId,
    hangulToRomanization,
    detectScriptKind,
    sanitizeLanguageMemory,
    mergeLanguageMemory,
    analyzeTextOffline,
    analyzeWithGemini
};
