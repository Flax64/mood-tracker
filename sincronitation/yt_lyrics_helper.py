#!/usr/bin/env python3
"""
PC Helper para extraer subtitulos (CC / Auto-subs) y metadatos de canciones desde
YouTube o YouTube Music usando el `yt-dlp` instalado localmente en tu PC.

Uso rapido (PowerShell en Windows):
    python sincronitation/yt_lyrics_helper.py "https://www.youtube.com/watch?v=Zp-Jhuhq0bQ" --clip
    python sincronitation/yt_lyrics_helper.py "https://music.youtube.com/watch?v=Zp-Jhuhq0bQ" --langs ko,en,es --out drip_lyrics.txt
    python sincronitation/yt_lyrics_helper.py --clean-file subtitulos.vtt --clip

Privacidad:
    Todo corre en tu PC; las letras limpias se pegan en el formulario de estudio
    y el navegador las cifra con E2EE (AES-256) antes de enviarlas a tu Word local.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import html
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

try:
    from Crypto.Cipher import AES
except ImportError:
    AES = None


BASE_PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAST_YTDLP_CACHE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".last_yt_dlp_path.json"
)
LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "historial.log")
GITHUB_VAR_CACHE_TTL_SECONDS = 300
DEFAULT_SUB_LANGS = "ko,en,es,ja"
_DPAPI_ENTROPY = b"mood-tracker-local-vault-v1"
_CRYPTPROTECT_UI_FORBIDDEN = 0x1
LOGGER = logging.getLogger("yt_lyrics_helper")


def _ensure_historial_logging() -> None:
    """Attach a RotatingFileHandler to historial.log when run standalone via CLI."""
    root = logging.getLogger()
    has_file_handler = any(
        isinstance(h, logging.FileHandler)
        for h in list(root.handlers) + list(LOGGER.handlers)
    )
    if has_file_handler:
        return
    try:
        os.makedirs(os.path.dirname(os.path.abspath(LOG_PATH)), exist_ok=True)
        handler = RotatingFileHandler(
            LOG_PATH, maxBytes=1024 * 1024, backupCount=3, encoding="utf-8"
        )
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s - %(levelname)s - %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
            )
        )
        LOGGER.setLevel(logging.INFO)
        LOGGER.addHandler(handler)
        LOGGER.propagate = False
    except Exception:
        pass


VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
SRT_OR_VTT_TIME_RE = re.compile(
    r"^(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{2,3}\s*-->\s*(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{2,3}"
)
LRC_META_TAG_RE = re.compile(
    r"^\[(?:ar|ti|al|au|by|offset|re|ve|length)\s*:[^\]]*\]$", re.IGNORECASE
)
LRC_TIME_RE = re.compile(r"\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]")
VTT_INLINE_TIME_RE = re.compile(r"<\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,3})?>")
HTML_TAG_RE = re.compile(r"</?[^>]+>")
RELEASE_YEAR_RE = re.compile(r"Released on:\s*(\d{4})-\d{2}-\d{2}", re.IGNORECASE)


def extract_video_id(raw_url: str) -> Optional[str]:
    """Normalize YouTube, YouTube Music, Shorts, or bare video ID into an 11-char ID."""
    value = str(raw_url or "").strip()
    if not value:
        return None
    if VIDEO_ID_RE.match(value):
        return value

    if not re.match(r"^https?://", value, re.IGNORECASE):
        value = "https://" + value

    try:
        parsed = urlparse(value)
    except Exception:
        return None

    host = (parsed.hostname or "").lower().lstrip("www.")
    if host == "youtu.be":
        seg = parsed.path.strip("/").split("/")[0]
        return seg if VIDEO_ID_RE.match(seg) else None

    if "youtube.com" in host:
        qs = parse_qs(parsed.query)
        cand = (qs.get("v") or [None])[0]
        if cand and VIDEO_ID_RE.match(cand):
            return cand
        parts = [p for p in parsed.path.split("/") if p]
        if (
            len(parts) >= 2
            and parts[0] in {"shorts", "embed", "live"}
            and VIDEO_ID_RE.match(parts[1])
        ):
            return parts[1]
    return None


def clean_caption_text(raw_text: str) -> str:
    """Strip .srt, .vtt, .ttml, and .lrc timestamps/markup into clean deduplicated lyrics."""
    normalized = (
        str(raw_text or "").lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    )
    if not normalized.strip():
        return ""

    out: List[str] = []
    skipping_block = False

    for raw_line in normalized.split("\n"):
        line = raw_line.strip()
        if not line:
            skipping_block = False
            continue
        if re.match(r"^(?:WEBVTT(?:\s|$)|Kind:|Language:)", line, re.IGNORECASE):
            continue
        if re.match(r"^(?:NOTE|STYLE|REGION)(?:\s|$)", line):
            skipping_block = True
            continue
        if skipping_block:
            continue
        if line.isdigit():
            continue
        if SRT_OR_VTT_TIME_RE.match(line):
            continue
        if LRC_META_TAG_RE.match(line):
            continue

        line = LRC_TIME_RE.sub("", line)
        line = VTT_INLINE_TIME_RE.sub("", line)
        line = HTML_TAG_RE.sub("", line)
        line = html.unescape(line)
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue
        if out and out[-1] == line:
            continue
        out.append(line)

    return "\n".join(out).strip()


def extract_metadata_from_info_json(info: Dict[str, Any]) -> Dict[str, Any]:
    """Extract clean title, artist, album, year, release_date, track_number, and embeddable status from yt-dlp JSON."""
    if not isinstance(info, dict):
        return {}

    description = str(info.get("description") or "")
    raw_artist = (
        info.get("artist")
        or info.get("creator")
        or info.get("uploader")
        or info.get("channel")
        or ""
    )
    artist = re.sub(r"\s*-\s*Topic$", "", str(raw_artist), flags=re.IGNORECASE).strip()

    album = str(info.get("album") or "").strip() or None
    track = str(info.get("track") or info.get("title") or "").strip() or None
    track_number: Optional[int] = None
    if info.get("track_number") and str(info["track_number"]).isdigit():
        track_number = int(info["track_number"])

    year: Optional[int] = None
    release_date_iso: Optional[str] = None
    raw_rel = str(info.get("release_date") or info.get("upload_date") or "").strip()
    if len(raw_rel) >= 8 and raw_rel[:8].isdigit():
        release_date_iso = f"{raw_rel[:4]}-{raw_rel[4:6]}-{raw_rel[6:8]}"

    if info.get("release_year") and str(info["release_year"]).isdigit():
        year = int(info["release_year"])
    elif len(raw_rel) >= 4 and raw_rel[:4].isdigit():
        year = int(raw_rel[:4])

    if "Provided to YouTube by" in description:
        lines = [ln.strip() for ln in description.splitlines() if ln.strip()]
        idx = next(
            (
                i
                for i, ln in enumerate(lines)
                if ln.lower().startswith("provided to youtube by")
            ),
            -1,
        )
        if idx >= 0:
            after = lines[idx + 1 :]
            if after and "·" in after[0] and not track:
                parts = [p.strip() for p in after[0].split("·") if p.strip()]
                if parts:
                    track = parts[0]
                    if len(parts) > 1 and not artist:
                        artist = parts[1]
            if len(after) > 1 and not album:
                cand_album = after[1]
                if not cand_album.startswith(
                    ("℗", "©", "Released on:", "Auto-generated")
                ):
                    album = cand_album
        m_rel = re.search(
            r"Released on:\s*((\d{4})-\d{2}-\d{2})", description, re.IGNORECASE
        )
        if m_rel:
            if not release_date_iso:
                release_date_iso = m_rel.group(1)
            if not year:
                year = int(m_rel.group(2))

    manual_subs = sorted((info.get("subtitles") or {}).keys())
    auto_subs = sorted((info.get("automatic_captions") or {}).keys())

    return {
        "video_id": info.get("id"),
        "title": track,
        "artist": artist or None,
        "album": album,
        "track_number": track_number,
        "release_year": year,
        "release_date": release_date_iso,
        "playable_in_embed": info.get("playable_in_embed"),
        "manual_subtitle_langs": manual_subs,
        "auto_caption_langs": auto_subs,
    }


_LANG_ALIASES = {"kr": "ko", "jp": "ja"}
_HANGUL_RE = re.compile(r"[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]")
_JAPANESE_RE = re.compile(r"[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]")


def base_language_code(lang_tag: str) -> str:
    clean = re.sub(
        r"-orig$", "", str(lang_tag or "").strip().lower(), flags=re.IGNORECASE
    )
    if not clean:
        return ""
    base = re.split(r"[-_]", clean, maxsplit=1)[0]
    return _LANG_ALIASES.get(base, base)


def isolate_korean_only_lyrics(text: str) -> str:
    """Extrae únicamente las líneas que contienen Hangul (Coreano puro), filtrando líneas puramente en inglés/latín."""
    kept: List[str] = []
    for raw in str(text or "").replace("\r", "").split("\n"):
        line = raw.strip()
        if not line:
            continue
        if re.fullmatch(
            r"\[(?:음악|music|applause|laughter|cheering|instrumental)\]",
            line,
            re.IGNORECASE,
        ):
            continue
        if _HANGUL_RE.search(line):
            if not kept or kept[-1] != line:
                kept.append(line)
    return "\n".join(kept).strip()


def isolate_japanese_lyrics(text: str) -> str:
    """Extrae líneas con escritura japonesa (Hiragana/Katakana/Kanji) sin Hangul."""
    kept: List[str] = []
    for raw in str(text or "").replace("\r", "").split("\n"):
        line = raw.strip()
        if not line:
            continue
        if re.fullmatch(
            r"\[(?:音楽|歌|music|applause|laughter|cheering|instrumental)\]",
            line,
            re.IGNORECASE,
        ):
            continue
        if _JAPANESE_RE.search(line) and not _HANGUL_RE.search(line):
            if not kept or kept[-1] != line:
                kept.append(line)
    return "\n".join(kept).strip()


def normalize_sub_langs_request(langs: str) -> str:
    """Collapse redundant regional/-orig requests into concise unique base languages to avoid YouTube 429 bursts."""
    seen: List[str] = []
    for part in str(langs or DEFAULT_SUB_LANGS).split(","):
        base = base_language_code(part)
        if base and base not in seen:
            seen.append(base)
    return ",".join(seen) if seen else DEFAULT_SUB_LANGS


def tracks_are_redundant(text_a: str, text_b: str) -> bool:
    """Detect exact or near-duplicate lyric bodies even across different subtitle tags (e.g. en vs en-kn or ko vs ko-orig)."""

    def norm_lines(txt: str) -> List[str]:
        out: List[str] = []
        for raw in (txt or "").splitlines():
            cleaned = re.sub(r"[^\w]+", " ", raw.lower(), flags=re.UNICODE).strip()
            if len(cleaned) >= 2:
                out.append(cleaned)
        return out

    lines_a = norm_lines(text_a)
    lines_b = norm_lines(text_b)
    if not lines_a or not lines_b:
        return False
    if "\n".join(lines_a) == "\n".join(lines_b):
        return True

    set_a = set(lines_a)
    set_b = set(lines_b)
    inter = len(set_a & set_b)
    union = len(set_a | set_b)
    jaccard = inter / union if union else 0.0
    min_overlap = (
        inter / min(len(set_a), len(set_b)) if min(len(set_a), len(set_b)) else 0.0
    )
    return jaccard >= 0.72 or min_overlap >= 0.85


def _track_priority_score(
    track: Dict[str, Any], preferred_bases: List[str]
) -> Tuple[int, int, int, int]:
    raw_lang = str(track.get("raw_lang") or track.get("lang") or "").strip().lower()
    base = base_language_code(raw_lang)
    try:
        pref_rank = len(preferred_bases) - preferred_bases.index(base)
    except ValueError:
        pref_rank = 0
    is_manual = 1 if track.get("is_manual") else 0
    if raw_lang == base:
        variant_score = 4
    elif raw_lang in ("es-419", "en-us", "ko-kr", "ja-jp"):
        variant_score = 3
    elif raw_lang in ("es-mx", "en-gb"):
        variant_score = 2
    elif raw_lang.endswith("-orig"):
        variant_score = 0
    else:
        variant_score = 1
    text_len = min(len(str(track.get("lyrics") or "")), 10000)
    return (is_manual, variant_score, pref_rank, text_len)


def deduplicate_tracks(
    tracks: List[Dict[str, Any]],
    preferred_langs: Optional[List[str]] = None,
    max_tracks: int = 5,
) -> List[Dict[str, Any]]:
    """Keep at most one clean non-redundant track per distinct base language (e.g. ko, en, es, ja)."""
    if not tracks:
        return []
    pref_bases: List[str] = []
    for p in preferred_langs or DEFAULT_SUB_LANGS.split(","):
        b = base_language_code(p)
        if b and b not in pref_bases:
            pref_bases.append(b)

    ranked = sorted(
        tracks, key=lambda tr: _track_priority_score(tr, pref_bases), reverse=True
    )
    chosen: List[Dict[str, Any]] = []
    seen_bases = set()

    for tr in ranked:
        lyr = str(tr.get("lyrics") or "").strip()
        if not lyr:
            continue
        raw_lang = str(tr.get("raw_lang") or tr.get("lang") or "").strip()
        base = base_language_code(raw_lang)
        if base and base in seen_bases:
            continue
        adds_distinct_script = (
            (base == "ko" and bool(_HANGUL_RE.search(lyr)))
            or (base == "ja" and bool(_JAPANESE_RE.search(lyr)))
            or (
                base == "en"
                and any(
                    _HANGUL_RE.search(e["lyrics"]) or _JAPANESE_RE.search(e["lyrics"])
                    for e in chosen
                )
            )
        )
        if not adds_distinct_script and any(
            tracks_are_redundant(existing["lyrics"], lyr) for existing in chosen
        ):
            continue
        if base:
            seen_bases.add(base)
        entry = {
            "lang": base or raw_lang.lower() or "sub",
            "raw_lang": raw_lang or base or "sub",
            "lyrics": lyr,
        }
        if tr.get("file"):
            entry["file"] = str(tr["file"])
        if "is_manual" in tr:
            entry["is_manual"] = bool(tr["is_manual"])
        chosen.append(entry)
        if len(chosen) >= max_tracks:
            break

    # Preserve preferred language display order (e.g. ko -> en -> es -> ja)
    def display_order(item: Dict[str, Any]) -> Tuple[int, str]:
        b = item.get("lang", "")
        return (pref_bases.index(b) if b in pref_bases else len(pref_bases), b)

    chosen.sort(key=display_order)
    return chosen


def build_structured_tracks(
    tracks_list: Optional[List[Dict[str, Any]]],
    preferred_langs: Optional[List[str]] = None,
    raw_original: str = "",
) -> Dict[str, str]:
    """Clasifica las pistas en los 5 apartados independientes: original, ko, en, ja, es."""
    by_lang: Dict[str, str] = {}
    orig_txt = str(raw_original or "").strip()

    for item in tracks_list or []:
        if not isinstance(item, dict):
            continue
        txt = str(item.get("lyrics") or "").strip()
        if not txt:
            continue
        b = base_language_code(item.get("raw_lang") or item.get("lang") or "")
        if b in ("multi", "original", "orig"):
            if not orig_txt:
                orig_txt = txt
            continue
        if b and b not in by_lang:
            by_lang[b] = txt

    ko_raw = by_lang.get("ko", "")
    en_raw = by_lang.get("en", "")
    ja_raw = by_lang.get("ja", "")
    es_raw = by_lang.get("es", "")

    if not orig_txt:
        ko_mixed = bool(ko_raw and _HANGUL_RE.search(ko_raw) and re.search(r"[A-Za-z]{2,}", ko_raw))
        ja_mixed = bool(ja_raw and _JAPANESE_RE.search(ja_raw) and re.search(r"[A-Za-z]{2,}", ja_raw))
        if ko_mixed:
            orig_txt = ko_raw
        elif ja_mixed:
            orig_txt = ja_raw
        else:
            for pref in preferred_langs or ["ko", "en", "ja", "es"]:
                pb = base_language_code(pref)
                if pb and by_lang.get(pb):
                    orig_txt = by_lang[pb]
                    break
            if not orig_txt:
                orig_txt = ko_raw or en_raw or ja_raw or es_raw or ""

    ko_only = isolate_korean_only_lyrics(
        ko_raw or (orig_txt if _HANGUL_RE.search(orig_txt) else "")
    )
    ja_clean = ja_raw or (
        isolate_japanese_lyrics(orig_txt) if _JAPANESE_RE.search(orig_txt) else ""
    )
    en_clean = en_raw or (
        orig_txt
        if (
            orig_txt
            and not _HANGUL_RE.search(orig_txt)
            and not _JAPANESE_RE.search(orig_txt)
            and orig_txt != es_raw
        )
        else ""
    )
    return {
        "original": orig_txt,
        "ko": ko_only,
        "en": en_clean,
        "ja": ja_clean,
        "es": es_raw,
    }


def format_structured_tracks_text(
    structured: Dict[str, str],
    fallback_list: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """Formatea los apartados disponibles en bloques etiquetados o texto simple si solo hay uno."""
    if not isinstance(structured, dict):
        return ""
    orig = str(structured.get("original") or "").strip()
    ko = str(structured.get("ko") or "").strip()
    en = str(structured.get("en") or "").strip()
    ja = str(structured.get("ja") or "").strip()
    es = str(structured.get("es") or "").strip()

    sections: List[Tuple[str, str]] = []
    if orig and orig not in (ko, en, ja):
        sections.append(("ORIGINAL", orig))
    if ko:
        sections.append(("KO", ko))
    if en:
        sections.append(("EN", en))
    if ja:
        sections.append(("JA", ja))
    if es:
        sections.append(("ES", es))

    if len(sections) == 1:
        return sections[0][1]
    if sections:
        return "\n\n".join(f"[{tag}]\n{body}" for tag, body in sections)
    if fallback_list:
        return str(fallback_list[0].get("lyrics") or "").strip()
    return orig


def pick_best_subtitle_files(
    sub_dir: str, preferred_langs: List[str]
) -> List[Tuple[str, str]]:
    """Find subtitle files downloaded by yt-dlp ordered by preferred language prefix without duplicate -orig variants."""
    candidates = []
    for ext in ("srt", "vtt", "ttml", "lrc"):
        candidates.extend(glob.glob(os.path.join(sub_dir, f"*.{ext}")))

    if not candidates:
        return []

    pref_bases = []
    for p in preferred_langs:
        b = base_language_code(p)
        if b and b not in pref_bases:
            pref_bases.append(b)

    def sort_key(filepath: str) -> Tuple[int, int, str]:
        base = os.path.basename(filepath).lower()
        parts = base.rsplit(".", 2)
        tag = parts[1] if len(parts) == 3 else ""
        b_lang = base_language_code(tag)
        idx = pref_bases.index(b_lang) if b_lang in pref_bases else len(pref_bases)
        variant_rank = 0 if tag == b_lang else (2 if tag.endswith("-orig") else 1)
        return (idx, variant_rank, base)

    candidates.sort(key=sort_key)
    results: List[Tuple[str, str]] = []
    for path in candidates:
        base = os.path.basename(path)
        parts = base.rsplit(".", 2)
        lang_tag = (
            parts[1] if len(parts) == 3 else os.path.splitext(base)[1].lstrip(".")
        )
        results.append((lang_tag, path))
    return results


def copy_text_to_clipboard(text: str) -> Tuple[bool, str]:
    """Copy UTF-8 text (including Hangul/accents) safely to clipboard."""
    if sys.platform.startswith("win"):
        try:
            proc = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); "
                    "$txt = [Console]::In.ReadToEnd(); Set-Clipboard -Value $txt",
                ],
                input=text.encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=10,
                check=False,
            )
            if proc.returncode == 0:
                return True, "Set-Clipboard (UTF-8)"
        except Exception as exc:
            return False, str(exc)

    for cmd in (
        ["pbcopy"],
        ["xclip", "-selection", "clipboard"],
        ["xsel", "--clipboard", "--input"],
    ):
        exe = shutil.which(cmd[0])
        if exe:
            try:
                proc = subprocess.run(
                    [exe] + cmd[1:], input=text.encode("utf-8"), check=False, timeout=5
                )
                if proc.returncode == 0:
                    return True, cmd[0]
            except Exception:
                pass
    return False, "No clipboard utility available"


def _read_dpapi_password_silent() -> Optional[str]:
    """Read Windows DPAPI-protected local vault password if configured (never raises)."""
    if not sys.platform.startswith("win"):
        return None
    try:
        import ctypes
        from ctypes import wintypes

        custom = os.environ.get("MOOD_DPAPI_VAULT_PATH", "").strip()
        if custom:
            vault_path = custom
        else:
            local_app = os.environ.get("LOCALAPPDATA", "").strip()
            vault_path = (
                os.path.join(local_app, "mood-tracker", "vault.dpapi")
                if local_app
                else os.path.join(
                    os.path.dirname(os.path.abspath(__file__)), ".vault.dpapi"
                )
            )
        if not os.path.exists(vault_path):
            return None
        with open(vault_path, "rb") as fh:
            cipher_bytes = fh.read()
        if not cipher_bytes:
            return None

        class _DATA_BLOB(ctypes.Structure):
            _fields_ = [
                ("cbData", wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
            ]

        def _make_blob(raw: bytes):
            if not raw:
                return _DATA_BLOB(0, None), None
            arr = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
            return (
                _DATA_BLOB(len(raw), ctypes.cast(arr, ctypes.POINTER(ctypes.c_ubyte))),
                arr,
            )

        in_blob, _in_ref = _make_blob(cipher_bytes)
        ent_blob, _ent_ref = _make_blob(_DPAPI_ENTROPY)
        out_blob = _DATA_BLOB()
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        ok = crypt32.CryptUnprotectData(
            ctypes.byref(in_blob),
            None,
            ctypes.byref(ent_blob),
            None,
            None,
            _CRYPTPROTECT_UI_FORBIDDEN,
            ctypes.byref(out_blob),
        )
        if not ok:
            return None
        try:
            return ctypes.string_at(out_blob.pbData, out_blob.cbData).decode("utf-8")
        finally:
            if out_blob.pbData:
                kernel32.LocalFree(out_blob.pbData)
    except Exception:
        return None


def _decrypt_vault_bytes_silent(raw_bytes: bytes, password: str) -> Optional[str]:
    """Decrypt OpenSSL Salted__ AES-256-CBC .env.enc in RAM cleanly."""
    if (
        not raw_bytes
        or len(raw_bytes) < 32
        or raw_bytes[:8] != b"Salted__"
        or not password
    ):
        return None
    salt = raw_bytes[8:16]
    payload = raw_bytes[16:]
    if len(payload) == 0 or len(payload) % 16 != 0:
        return None
    if AES is not None:
        try:
            key_iv = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), salt, 600000, dklen=48
            )
            cipher = AES.new(key_iv[:32], AES.MODE_CBC, key_iv[32:48])
            dec = cipher.decrypt(payload)
            pad_len = dec[-1]
            if 1 <= pad_len <= 16 and dec[-pad_len:] == bytes([pad_len]) * pad_len:
                return dec[:-pad_len].decode("utf-8")
        except Exception:
            return None
    openssl_bin = shutil.which("openssl")
    if openssl_bin:
        try:
            proc = subprocess.run(
                [
                    openssl_bin,
                    "enc",
                    "-d",
                    "-aes-256-cbc",
                    "-pbkdf2",
                    "-iter",
                    "600000",
                    "-md",
                    "sha256",
                    "-pass",
                    "stdin",
                ],
                input=(password + "\n").encode("utf-8") + raw_bytes,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=10,
                check=False,
            )
            if proc.returncode == 0:
                return proc.stdout.decode("utf-8", errors="replace")
        except Exception:
            pass
    return None


def _parse_env_text(content: str) -> Dict[str, str]:
    parsed: Dict[str, str] = {}
    for raw_line in (content or "").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and (
            (val[0] == '"' and val[-1] == '"') or (val[0] == "'" and val[-1] == "'")
        ):
            val = val[1:-1]
        if key:
            parsed[key] = val
    return parsed


def _load_local_env_silently(base_dir: Optional[str] = None) -> Dict[str, str]:
    """Load .env or unlocked .env.enc in RAM without interactive prompts."""
    root = base_dir or BASE_PROJECT_DIR
    env_path = os.path.join(root, ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8", errors="replace") as fh:
                return _parse_env_text(fh.read())
        except Exception:
            return {}

    enc_path = os.path.join(root, ".env.enc")
    if os.path.exists(enc_path):
        password = os.environ.get("MOOD_ENV_PASS") or _read_dpapi_password_silent()
        if not password:
            return {}
        try:
            with open(enc_path, "rb") as fh:
                raw_enc = fh.read()
            text = _decrypt_vault_bytes_silent(raw_enc, password)
            return _parse_env_text(text or "")
        except Exception:
            return {}
    return {}


def _detect_github_repo(base_dir: str, env_map: Dict[str, str]) -> str:
    repo = (os.environ.get("GITHUB_REPO") or env_map.get("GITHUB_REPO") or "").strip()
    if repo:
        return repo
    git_cfg = os.path.join(base_dir, ".git", "config")
    if os.path.exists(git_cfg):
        try:
            with open(git_cfg, "r", encoding="utf-8", errors="replace") as fh:
                cfg_text = fh.read()
            m = re.search(
                r"github\.com[:/]([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?(?:\s|$)",
                cfg_text,
            )
            if m:
                return m.group(1)
        except Exception:
            pass
    return "Flax64/personal-daily-hub"


def _fetch_github_variable(
    repo: str, token: str, var_name: str, timeout: int = 5
) -> Optional[str]:
    """Read a GitHub Repository Actions Variable via REST API (returns None on 404/error)."""
    if not repo or not token or not var_name:
        return None
    url = f"https://api.github.com/repos/{repo}/actions/variables/{var_name}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "personal-daily-hub-yt-lyrics-helper",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if getattr(resp, "status", 200) != 200:
                return None
            payload = json.loads(resp.read().decode("utf-8", errors="replace"))
            val = str(payload.get("value") or "").strip()
            return val or None
    except Exception:
        return None


def _resolve_candidate_binary(raw_value: Optional[str]) -> Optional[str]:
    """Accept either a folder containing yt-dlp.exe/yt-dlp or a direct binary path."""
    cleaned = str(raw_value or "").strip().strip('"').strip("'")
    if not cleaned:
        return None
    expanded = os.path.expanduser(os.path.expandvars(cleaned))
    if os.path.isfile(expanded):
        return os.path.abspath(expanded)
    if os.path.isdir(expanded):
        names = (
            ("yt-dlp.exe", "yt-dlp")
            if sys.platform.startswith("win")
            else ("yt-dlp", "yt-dlp.exe")
        )
        for name in names:
            cand = os.path.join(expanded, name)
            if os.path.isfile(cand):
                return os.path.abspath(cand)
        return None
    return shutil.which(expanded)


def _read_ytdlp_cache(repo: str) -> Optional[Tuple[str, float]]:
    try:
        if not os.path.exists(LAST_YTDLP_CACHE_PATH):
            return None
        with open(LAST_YTDLP_CACHE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if data.get("repo") != repo:
            return None
        raw_val = str(data.get("raw_value") or "").strip()
        ts = float(data.get("updated_at") or 0)
        return (raw_val, ts) if raw_val else None
    except Exception:
        return None


def _write_ytdlp_cache(repo: str, raw_value: str) -> None:
    try:
        tmp = f"{LAST_YTDLP_CACHE_PATH}.tmp.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(
                {"repo": repo, "raw_value": raw_value, "updated_at": time.time()}, fh
            )
        os.replace(tmp, LAST_YTDLP_CACHE_PATH)
    except Exception:
        pass


def resolve_yt_dlp_executable(
    explicit_bin: Optional[str] = None,
    refresh_cache: bool = False,
    base_dir: Optional[str] = None,
) -> Tuple[Optional[str], str]:
    """Resolve yt-dlp binary from CLI flag -> env/.env/.env.enc -> GitHub Variable YT_DLP_PATH -> system PATH."""
    if explicit_bin:
        resolved = _resolve_candidate_binary(explicit_bin)
        return (
            (resolved, "cli:--yt-dlp-bin")
            if resolved
            else (None, f"cli:--yt-dlp-bin ({explicit_bin})")
        )

    root = base_dir or BASE_PROJECT_DIR
    env_map = _load_local_env_silently(root)

    for var_name in ("YT_DLP_PATH", "YT_DLP_BIN"):
        local_val = os.environ.get(var_name) or env_map.get(var_name)
        resolved = _resolve_candidate_binary(local_val)
        if resolved:
            source = "env" if os.environ.get(var_name) else "local-vault/.env"
            return resolved, f"{source}:{var_name}"

    github_token = (
        os.environ.get("GITHUB_TOKEN") or env_map.get("GITHUB_TOKEN") or ""
    ).strip()
    github_repo = _detect_github_repo(root, env_map)
    if github_token and github_repo:
        cached = _read_ytdlp_cache(github_repo)
        now_ts = time.time()
        if (
            cached
            and not refresh_cache
            and (now_ts - cached[1]) < GITHUB_VAR_CACHE_TTL_SECONDS
        ):
            resolved_cached = _resolve_candidate_binary(cached[0])
            if resolved_cached:
                return resolved_cached, f"github-var-cache:{github_repo}"

        for var_name in ("YT_DLP_PATH", "YT_DLP_BIN"):
            gh_val = _fetch_github_variable(github_repo, github_token, var_name)
            if gh_val:
                _write_ytdlp_cache(github_repo, gh_val)
                resolved_gh = _resolve_candidate_binary(gh_val)
                if resolved_gh:
                    return resolved_gh, f"github-var:{github_repo}/{var_name}"

        if cached:
            resolved_offline = _resolve_candidate_binary(cached[0])
            if resolved_offline:
                return resolved_offline, f"github-var-offline-cache:{github_repo}"

    which_bin = shutil.which("yt-dlp")
    if which_bin:
        return which_bin, "system:PATH"

    fallback_paths = (
        [
            (
                os.path.join(
                    os.environ.get("USERPROFILE", ""),
                    "Desktop",
                    "Download Videos",
                    "yt-dlp.exe",
                )
                if os.environ.get("USERPROFILE")
                else ""
            ),
            (
                os.path.join(
                    os.environ.get("LOCALAPPDATA", ""),
                    "Microsoft",
                    "WinGet",
                    "Links",
                    "yt-dlp.exe",
                )
                if os.environ.get("LOCALAPPDATA")
                else ""
            ),
        ]
        if sys.platform.startswith("win")
        else [
            "/usr/local/bin/yt-dlp",
            "/usr/bin/yt-dlp",
            os.path.expanduser("~/.local/bin/yt-dlp"),
        ]
    )
    for cand in fallback_paths:
        resolved_fb = _resolve_candidate_binary(cand)
        if resolved_fb:
            return resolved_fb, "os-default"

    return None, "not_found"


def _is_allowed_caption_url(raw_url: str) -> bool:
    try:
        parsed = urlparse(str(raw_url or "").strip())
    except Exception:
        return False
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").lower()
    return (
        host == "youtube.com"
        or host.endswith(".youtube.com")
        or host.endswith(".googlevideo.com")
        or host.endswith(".ytimg.com")
    )


def _fetch_single_caption_from_info(
    info: Dict[str, Any], target_base: str
) -> Optional[Dict[str, Any]]:
    """Fallback fetch for one missing base language (e.g. auto-es) from --dump-single-json cleanly handling HTTP 429."""
    if not isinstance(info, dict) or not target_base:
        return None
    variant_order = {
        "es": ["es", "es-419", "es-MX", "es-ES"],
        "en": ["en", "en-US", "en-GB"],
        "ko": ["ko", "ko-KR"],
        "ja": ["ja"],
    }.get(target_base, [target_base])

    sources = [
        (
            True,
            info.get("subtitles") if isinstance(info.get("subtitles"), dict) else {},
        ),
        (
            False,
            (
                info.get("automatic_captions")
                if isinstance(info.get("automatic_captions"), dict)
                else {}
            ),
        ),
    ]
    preferred_exts = ("vtt", "srv1", "ttml", "srv3", "srv2")

    for is_manual, pool in sources:
        if not pool:
            continue
        ordered_keys = [k for k in variant_order if k in pool]
        if not ordered_keys:
            for k in pool.keys():
                if base_language_code(k) == target_base and not str(k).lower().endswith(
                    "-orig"
                ):
                    ordered_keys.append(k)
        for key in ordered_keys:
            entries = pool.get(key)
            if not isinstance(entries, list):
                continue
            by_ext = {}
            for item in entries:
                if isinstance(item, dict) and item.get("url"):
                    ext = str(item.get("ext") or "").lower()
                    if ext not in by_ext:
                        by_ext[ext] = str(item["url"])
            cand_url = None
            for ext in preferred_exts:
                if ext in by_ext and _is_allowed_caption_url(by_ext[ext]):
                    cand_url = by_ext[ext]
                    break
            if not cand_url:
                continue
            req = urllib.request.Request(
                cand_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                },
                method="GET",
            )
            try:
                with urllib.request.urlopen(req, timeout=8) as resp:
                    if getattr(resp, "status", 200) != 200:
                        continue
                    raw_text = resp.read().decode("utf-8", errors="replace")
                cleaned = clean_caption_text(raw_text)
                if cleaned:
                    return {
                        "lang": target_base,
                        "raw_lang": key,
                        "lyrics": cleaned,
                        "file": f"{'manual' if is_manual else 'auto'}-{key}",
                        "is_manual": is_manual,
                    }
            except urllib.error.HTTPError as http_err:
                if http_err.code == 429:
                    LOGGER.info(
                        "yt_lyrics_helper: YouTube devolvió HTTP 429 temporalmente para subtítulo '%s'.",
                        key,
                    )
                    return None
            except Exception:
                continue
    return None


def _has_meaningful_lyrics(text: str) -> bool:
    """Validate that extracted subtitle text contains actual lyric lines and not only sound/music tags."""
    clean = str(text or "").strip()
    if len(clean) < 8:
        return False
    lines = [ln.strip() for ln in clean.splitlines() if ln.strip()]
    substantive = [
        ln
        for ln in lines
        if not re.fullmatch(
            r"[\[(](?:music|música|음악|applause|aplausos|instrumental|intro|outro)[\])]",
            ln,
            re.IGNORECASE,
        )
    ]
    return len(substantive) >= 1 and sum(len(ln) for ln in substantive) >= 8


_INNERTUBE_BASE = "https://music.youtube.com/youtubei/v1/"
_INNERTUBE_SONGS_PARAMS = "EgWKAQIIAWoKEAkQBRAKEAMQBA=="


def _is_allowed_innertube_url(raw_url: str) -> bool:
    """Anti-SSRF: only https://music.youtube.com/youtubei/v1/* is allowed."""
    try:
        p = urlparse(str(raw_url or ""))
        return (
            p.scheme == "https"
            and (p.hostname or "").lower() == "music.youtube.com"
            and p.username is None
            and p.password is None
            and p.port in (None, 443)
            and p.path.startswith("/youtubei/v1/")
            and ".." not in p.path
        )
    except Exception:
        return False


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # type: ignore[override]
        return None


def _innertube_post(endpoint: str, body: Dict[str, Any], timeout: int = 15) -> Dict[str, Any]:
    url = f"{_INNERTUBE_BASE}{endpoint}?prettyPrint=false"
    if not _is_allowed_innertube_url(url):
        raise ValueError("URL InnerTube bloqueada por el validador anti-SSRF")
    payload = {
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20250310.01.00",
                "hl": "en",
                "gl": "US",
            }
        },
        **body,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Origin": "https://music.youtube.com",
            "Referer": "https://music.youtube.com/",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
        },
        method="POST",
    )
    opener = urllib.request.build_opener(_NoRedirect)
    with opener.open(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def _walk_json(node: Any, visitor, depth: int = 0) -> Any:
    if depth > 40:
        return None
    if isinstance(node, dict):
        hit = visitor(node)
        if hit:
            return hit
        children = node.values()
    elif isinstance(node, list):
        children = node
    else:
        return None
    for child in children:
        res = _walk_json(child, visitor, depth + 1)
        if res:
            return res
    return None


def _runs_text(runs: Any) -> str:
    if not isinstance(runs, list):
        return ""
    return "".join(str(r.get("text", "")) for r in runs if isinstance(r, dict))


def _find_lyrics_browse_id(next_json: Dict[str, Any]) -> str:
    return (
        _walk_json(
            next_json,
            lambda n: n.get("browseId")
            if isinstance(n.get("browseId"), str) and n["browseId"].startswith("MPLYt_")
            else None,
        )
        or ""
    )


def _parse_lyrics_from_browse(browse_json: Dict[str, Any]) -> str:
    """Prefers timedLyricsModel; falls back to musicDescriptionShelfRenderer. Keeps EN/KR/JP intact."""
    timed = _walk_json(
        browse_json,
        lambda n: n.get("timedLyricsData") if isinstance(n.get("timedLyricsData"), list) else None,
    )
    if timed:
        lines = [str(l.get("lyricLine", "")).rstrip() for l in timed if isinstance(l, dict)]
        text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
        if text:
            return text
    shelf = _walk_json(browse_json, lambda n: n.get("musicDescriptionShelfRenderer"))
    if isinstance(shelf, dict):
        text = _runs_text((shelf.get("description") or {}).get("runs"))
        text = re.sub(r"\r\n?", "\n", text).strip()
        if text:
            return text
    return ""


def _innertube_track_info(next_json: Dict[str, Any], video_id: str) -> Tuple[str, str]:
    item = _walk_json(
        next_json,
        lambda n: n.get("playlistPanelVideoRenderer")
        if isinstance(n.get("playlistPanelVideoRenderer"), dict)
        and n["playlistPanelVideoRenderer"].get("videoId") == video_id
        else None,
    )
    if not item:
        return "", ""
    title = _runs_text((item.get("title") or {}).get("runs"))
    byline = (item.get("longBylineText") or item.get("shortBylineText") or {}).get("runs") or []
    artist = byline[0].get("text", "") if byline and isinstance(byline[0], dict) else ""
    return title, artist


def _innertube_find_song_id(search_json: Dict[str, Any], exclude_id: str) -> str:
    def visit(n: Dict[str, Any]) -> Optional[str]:
        r = n.get("musicResponsiveListItemRenderer")
        if not isinstance(r, dict):
            return None
        vid = (r.get("playlistItemData") or {}).get("videoId") or _walk_json(
            r.get("overlay") or {}, lambda m: (m.get("watchEndpoint") or {}).get("videoId")
        )
        return vid if isinstance(vid, str) and len(vid) == 11 and vid != exclude_id else None

    return _walk_json(search_json, visit) or ""


def fetch_ytmusic_lyrics(video_id: str) -> Dict[str, Any]:
    """YouTube Music InnerTube (WEB_REMIX): next -> MPLYt_ -> browse; Song fallback via search.

    Never raises: returns {"ok": False, "reason": ...} on 429 / network errors / no lyrics.
    """
    try:
        nxt = _innertube_post("next", {"videoId": video_id})
        title, artist = _innertube_track_info(nxt, video_id)
        browse_id = _find_lyrics_browse_id(nxt)
        if browse_id:
            text = _parse_lyrics_from_browse(_innertube_post("browse", {"browseId": browse_id}))
            if text:
                return {"ok": True, "lyrics": text, "title": title, "artist": artist,
                        "source": "ytmusic:innertube", "video_id": video_id}

        query = f"{title} {artist}".strip()
        if query:
            search = _innertube_post(
                "search", {"query": query, "params": _INNERTUBE_SONGS_PARAMS}
            )
            song_id = _innertube_find_song_id(search, video_id)
            if song_id:
                nxt2 = _innertube_post("next", {"videoId": song_id})
                bid2 = _find_lyrics_browse_id(nxt2)
                if bid2:
                    text = _parse_lyrics_from_browse(_innertube_post("browse", {"browseId": bid2}))
                    if text:
                        return {"ok": True, "lyrics": text, "title": title, "artist": artist,
                                "source": "ytmusic:innertube:song", "video_id": video_id,
                                "song_video_id": song_id}
        return {"ok": False, "reason": "lyrics_not_available", "error": "Lyrics not available"}
    except urllib.error.HTTPError as exc:
        reason = "rate_limited" if exc.code == 429 else "innertube_error"
        LOGGER.warning("yt_lyrics_helper: InnerTube HTTP %s para %s", exc.code, video_id)
        return {"ok": False, "reason": reason, "error": f"HTTP {exc.code}"}
    except Exception as exc:  # network blocks, JSON errors, timeouts
        LOGGER.warning("yt_lyrics_helper: InnerTube falló para %s: %s", video_id, exc)
        return {"ok": False, "reason": "innertube_error", "error": str(exc)[:200]}


def run_yt_dlp_extract(
    url_or_id: Optional[str] = None,
    langs: str = DEFAULT_SUB_LANGS,
    yt_dlp_bin: Optional[str] = None,
    refresh_github_cache: bool = False,
    target: Optional[str] = None,
    use_innertube: bool = False,
) -> Dict[str, Any]:
    """Run yt-dlp on local PC with multi-client validation & caption retries without downloading media."""
    effective_target = url_or_id if url_or_id is not None else (target or "")
    video_id = extract_video_id(effective_target)
    if not video_id:
        LOGGER.warning(
            "yt_lyrics_helper: ID/URL de YouTube inválido: %r", effective_target
        )
        raise ValueError(
            "No se pudo extraer un ID valido de YouTube / YouTube Music (11 caracteres)."
        )

    canonical_url = f"https://www.youtube.com/watch?v={video_id}"

    # Cascada opt-in: YouTube Music InnerTube (MPLYt_) previo solo si use_innertube=True o YTM_INNERTUBE=1.
    innertube_env = os.environ.get("YTM_INNERTUBE", "").strip()
    innertube_pre = bool(use_innertube) or innertube_env == "1"
    if innertube_pre:
        yt = fetch_ytmusic_lyrics(video_id)
        if yt.get("ok") and _has_meaningful_lyrics(yt.get("lyrics", "")):
            LOGGER.info("yt_lyrics_helper: letra de YT Music obtenida para %s (%s)", video_id, yt["source"])
            yt_list = [{"lang": "original", "raw_lang": "multi", "lyrics": yt["lyrics"], "is_manual": True}]
            yt_structured = build_structured_tracks(yt_list, raw_original=yt["lyrics"])
            return {
                "url": canonical_url,
                "yt_dlp_bin": None,
                "yt_dlp_source": yt["source"],
                "metadata": {"video_id": video_id, "title": yt.get("title") or None,
                             "artist": yt.get("artist") or None},
                "tracks": yt_structured,
                "track_list": yt_list,
                "lyrics": yt["lyrics"],
            }

    exe, exe_source = resolve_yt_dlp_executable(
        yt_dlp_bin, refresh_cache=refresh_github_cache
    )
    if not exe:
        LOGGER.error(
            "yt_lyrics_helper: no se encontró ejecutable yt-dlp (origen=%s)", exe_source
        )
        raise FileNotFoundError(
            "No se encontro `yt-dlp`. Agrégalo al PATH o define `YT_DLP_PATH` en .env / Variables."
        )

    concise_langs = normalize_sub_langs_request(langs)
    preferred_list = [part.strip() for part in concise_langs.split(",") if part.strip()]
    expanded_langs = ",".join(
        dict.fromkeys([*preferred_list, "ko", "ko-KR", "en", "en-US", "en-GB", "ja", "ja-JP", "es", "es-419", "es-MX", "es-ES"])
    )
    cookies_path = os.environ.get("YT_DLP_COOKIES_PATH", "").strip()
    cookie_args = ["--cookies", cookies_path] if cookies_path and os.path.exists(cookies_path) else []
    node_bin = shutil.which("node")

    LOGGER.info(
        "yt_lyrics_helper: extrayendo subtítulos de %s (langs=%s, origen=%s)",
        video_id,
        concise_langs,
        exe_source,
    )

    with tempfile.TemporaryDirectory(prefix="pdh_yt_lyrics_") as tmp_dir:
        def _invoke_ytdlp(extra_args: Optional[List[str]] = None, timeout_sec: int = 85):
            base_cmd = [
                exe,
                "--ignore-errors",
                "--skip-download",
                "--no-simulate",
                "--no-playlist",
                "--write-subs",
                "--write-auto-subs",
                "--sleep-subtitles",
                "1",
                "--sub-langs",
                expanded_langs,
                "--sub-format",
                "srt/vtt/ttml/best",
                *cookie_args,
                *(extra_args or []),
                "--dump-single-json",
                "-o",
                os.path.join(tmp_dir, "%(id)s.%(ext)s"),
                canonical_url,
            ]
            primary_cmd = [exe, "--js-runtimes", "node", *base_cmd[1:]] if node_bin else base_cmd
            run_kwargs: Dict[str, Any] = {
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "timeout": timeout_sec,
                "check": False,
            }
            if sys.platform.startswith("win"):
                run_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)

            p = subprocess.run(primary_cmd, **run_kwargs)
            out_s = p.stdout.decode("utf-8", errors="replace").strip()
            err_s = p.stderr.decode("utf-8", errors="replace").strip()

            if node_bin and p.returncode != 0 and re.search(
                r"(?:unrecognized arguments?|no such option):\s*--js-runtimes", err_s, re.IGNORECASE
            ):
                p = subprocess.run(base_cmd, **run_kwargs)
                out_s = p.stdout.decode("utf-8", errors="replace").strip()
                err_s = p.stderr.decode("utf-8", errors="replace").strip()

            if p.returncode != 0 and not glob.glob(os.path.join(tmp_dir, "*.*")) and re.search(
                r"(?:unrecognized arguments?|no such option):\s*--sleep-subtitles", err_s, re.IGNORECASE
            ):
                no_sleep_cmd = [
                    c for idx, c in enumerate(base_cmd)
                    if c != "--sleep-subtitles" and (idx == 0 or base_cmd[idx - 1] != "--sleep-subtitles")
                ]
                p = subprocess.run(no_sleep_cmd, **run_kwargs)
                out_s = p.stdout.decode("utf-8", errors="replace").strip()
                err_s = p.stderr.decode("utf-8", errors="replace").strip()
            return p, out_s, err_s

        def _collect_from_tmp_and_info(info_obj: Dict[str, Any]) -> List[Dict[str, Any]]:
            sub_files = pick_best_subtitle_files(tmp_dir, preferred_list)
            m_obj = extract_metadata_from_info_json(info_obj)
            manual_bases_loc = {
                base_language_code(k)
                for k in (m_obj.get("manual_subtitle_langs") or [])
                if base_language_code(k)
            }
            tracks_acc: List[Dict[str, Any]] = []
            for lang_tag, fpath in sub_files:
                with open(fpath, "r", encoding="utf-8", errors="replace") as fh:
                    raw_sub = fh.read()
                cleaned = clean_caption_text(raw_sub)
                if cleaned and _has_meaningful_lyrics(cleaned):
                    base = base_language_code(lang_tag)
                    looks_asr = bool(
                        re.search(r"<\d{2}:\d{2}:\d{2}\.\d{3}><c>", raw_sub)
                    )
                    if manual_bases_loc:
                        is_man = bool(base and base in manual_bases_loc) and not looks_asr
                    else:
                        is_man = not looks_asr and not str(lang_tag).lower().endswith("-orig")
                    tracks_acc.append(
                        {
                            "lang": lang_tag,
                            "raw_lang": lang_tag,
                            "lyrics": cleaned,
                            "file": os.path.basename(fpath),
                            "is_manual": is_man,
                        }
                    )

            dl_bases = {base_language_code(t["lang"]) for t in tracks_acc if base_language_code(t["lang"])}
            if info_obj:
                for req_lang in preferred_list:
                    b_req = base_language_code(req_lang)
                    if not b_req or b_req in dl_bases:
                        continue
                    if tracks_acc:
                        time.sleep(0.6)
                    extra_tr = _fetch_single_caption_from_info(info_obj, b_req)
                    if extra_tr and _has_meaningful_lyrics(extra_tr.get("lyrics", "")):
                        tracks_acc.append(extra_tr)
                        dl_bases.add(b_req)
            return tracks_acc

        proc, stdout_text, stderr_text = _invoke_ytdlp(extra_args=None, timeout_sec=80)
        info: Dict[str, Any] = {}
        if stdout_text:
            try:
                info = json.loads(stdout_text.splitlines()[-1])
            except json.JSONDecodeError:
                info = {}

        raw_tracks = _collect_from_tmp_and_info(info)

        # Validation retry: if Attempt 1 returned 0 valid tracks or failed on default web client, retry tv/web_embedded/android_vr
        if not raw_tracks:
            LOGGER.info("yt_lyrics_helper: reintentando extracción de subtítulos con clientes alternativos para %s", video_id)
            proc2, out2, err2 = _invoke_ytdlp(
                extra_args=["--extractor-args", "youtube:player_client=tv,web_embedded,android_vr"],
                timeout_sec=90,
            )
            if out2:
                try:
                    info2 = json.loads(out2.splitlines()[-1])
                    if info2:
                        info = info2
                except json.JSONDecodeError:
                    pass
            if err2:
                stderr_text = err2 or stderr_text
            if proc2.returncode == 0 or not proc.returncode == 0:
                proc = proc2
            raw_tracks = _collect_from_tmp_and_info(info)

        if proc.returncode != 0 and not info and not raw_tracks:
            err_msg = f"yt-dlp fallo (code {proc.returncode}): {stderr_text[:400]}"
            LOGGER.error("yt_lyrics_helper: %s", err_msg)
            raise RuntimeError(err_msg)

        meta = extract_metadata_from_info_json(info)
        track_list = deduplicate_tracks(raw_tracks, preferred_list, max_tracks=5)
        structured_tracks = build_structured_tracks(track_list, preferred_list)
        combined_lyrics = format_structured_tracks_text(structured_tracks, track_list)
        yt_dlp_src_out = exe_source

        if not track_list and innertube_env != "0" and not innertube_pre:
            yt_fb = fetch_ytmusic_lyrics(video_id)
            if yt_fb.get("ok") and _has_meaningful_lyrics(yt_fb.get("lyrics", "")):
                track_list = [{"lang": "original", "raw_lang": "multi", "lyrics": yt_fb["lyrics"], "is_manual": True}]
                structured_tracks = build_structured_tracks(track_list, preferred_list, raw_original=yt_fb["lyrics"])
                combined_lyrics = format_structured_tracks_text(structured_tracks, track_list)
                yt_dlp_src_out = f"{exe_source}+{yt_fb['source']}"

        if track_list:
            LOGGER.info(
                "yt_lyrics_helper: %d pista(s) únicas extraídas para %s (%s)",
                len(track_list),
                video_id,
                ", ".join(t["lang"] for t in track_list),
            )
        else:
            LOGGER.warning(
                "yt_lyrics_helper: sin subtítulos descargados para %s (rc=%s, manual=%s, stderr=%s)",
                video_id,
                proc.returncode,
                meta.get("manual_subtitle_langs") or [],
                stderr_text[:200],
            )

        return {
            "url": canonical_url,
            "yt_dlp_bin": exe,
            "yt_dlp_source": yt_dlp_src_out,
            "metadata": meta,
            "tracks": structured_tracks,
            "track_list": track_list,
            "lyrics": combined_lyrics,
        }


def _configure_stdio_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


_configure_stdio_utf8()


def main(argv: Optional[List[str]] = None) -> int:
    _configure_stdio_utf8()
    _ensure_historial_logging()
    parser = argparse.ArgumentParser(
        description="Extrae subtitulos/CC y metadatos de YouTube con yt-dlp local y los limpia para estudiar."
    )
    parser.add_argument(
        "target",
        nargs="?",
        help="URL de YouTube, YouTube Music o Video ID de 11 caracteres.",
    )
    parser.add_argument(
        "--langs",
        default=DEFAULT_SUB_LANGS,
        help=f"Idiomas a buscar (default: {DEFAULT_SUB_LANGS})",
    )
    parser.add_argument(
        "--out", help="Ruta opcional para guardar las letras limpias en .txt UTF-8"
    )
    parser.add_argument(
        "--clip",
        action="store_true",
        help="Copia las letras limpias al portapapeles de Windows/PC",
    )
    parser.add_argument(
        "--all-langs",
        action="store_true",
        help="Combina todos los subtitulos descargados en la salida",
    )
    parser.add_argument(
        "--json", action="store_true", help="Imprime salida completa en formato JSON"
    )
    parser.add_argument(
        "--yt-dlp-bin",
        help="Ruta explicita a yt-dlp.exe (tiene prioridad sobre GitHub Variables y PATH)",
    )
    parser.add_argument(
        "--refresh-github-var",
        action="store_true",
        help="Fuerza relectura de YT_DLP_PATH desde GitHub Variables",
    )
    parser.add_argument(
        "--check-yt-dlp",
        action="store_true",
        help="Verifica desde donde se resuelve yt-dlp (PATH o GitHub Variable YT_DLP_PATH)",
    )
    parser.add_argument(
        "--clean-file",
        help="Limpia un archivo local .srt/.vtt/.lrc existente sin usar red",
    )
    args = parser.parse_args(argv)

    if args.check_yt_dlp:
        exe, exe_source = resolve_yt_dlp_executable(
            args.yt_dlp_bin, refresh_cache=args.refresh_github_var
        )
        if exe:
            print(f"[OK] yt-dlp resuelto en: {exe} (origen: {exe_source})")
            return 0
        print(
            f"[NO ENCONTRADO] No se pudo localizar yt-dlp (detalle: {exe_source})",
            file=sys.stderr,
        )
        return 1

    if args.clean_file:
        with open(args.clean_file, "r", encoding="utf-8", errors="replace") as fh:
            cleaned = clean_caption_text(fh.read())
        if args.out:
            with open(args.out, "w", encoding="utf-8") as out_fh:
                out_fh.write(cleaned + "\n")
        if args.clip and cleaned:
            ok, msg = copy_text_to_clipboard(cleaned)
            print(
                f"[Clipboard] {'Copiado' if ok else 'No copiado'}: {msg}",
                file=sys.stderr,
            )
        print(cleaned)
        return 0

    if not args.target:
        parser.print_help()
        return 2

    result = run_yt_dlp_extract(
        args.target,
        langs=args.langs,
        yt_dlp_bin=args.yt_dlp_bin,
        refresh_github_cache=args.refresh_github_var,
    )
    tracks = result["tracks"]
    if args.all_langs:
        if isinstance(tracks, dict):
            final_text = format_structured_tracks_text(tracks, result.get("track_list"))
        elif len(tracks) > 1:
            final_text = "\n\n".join(f"[{t['lang']}]\n{t['lyrics']}" for t in tracks)
        else:
            final_text = result["lyrics"]
    else:
        final_text = (
            (tracks.get("original") or result["lyrics"])
            if isinstance(tracks, dict)
            else result["lyrics"]
        )

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    meta = result["metadata"]
    print("=== METADATOS DETECTADOS ===")
    print(f"yt-dlp  : {result.get('yt_dlp_bin')} ({result.get('yt_dlp_source')})")
    print(f"Cancion : {meta.get('title') or '-'}")
    print(f"Artista : {meta.get('artist') or '-'}")
    print(
        f"Album   : {meta.get('album') or '-'} ({meta.get('release_year') or 'sin anio'})"
    )
    print(f"Embed   : {meta.get('playable_in_embed')}")
    print(
        f"Subs CC : {', '.join(meta.get('manual_subtitle_langs') or []) or 'ninguno'}"
    )
    print(f"Auto CC : {', '.join(meta.get('auto_caption_langs') or []) or 'ninguno'}")
    print()

    if not final_text:
        print(
            "Este video no tiene subtitulos ni auto-captions en YouTube en los idiomas pedidos.",
            file=sys.stderr,
        )
        print(
            "Nota: muchos Art Tracks de YouTube Music no incluyen pista CC; prueba con el M/V oficial o Lyric Video.",
            file=sys.stderr,
        )
        return 1

    if args.out:
        with open(args.out, "w", encoding="utf-8") as out_fh:
            out_fh.write(final_text + "\n")
        print(f"Guardado en: {args.out}")

    if args.clip:
        ok, msg = copy_text_to_clipboard(final_text)
        print(f"Portapapeles: {'OK (' + msg + ')' if ok else 'Error (' + msg + ')'}")

    print("=== LETRA LIMPIA (LISTA PARA PEGAR EN STUDY NOTES) ===")
    print(final_text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
