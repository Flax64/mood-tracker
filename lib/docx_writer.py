#!/usr/bin/env python3
"""
Cross-platform OOXML (.docx) writer for Personal Daily Hub on Linux/Docker servers.

- Mode `english`: Creates or updates `English_Learning_Notebook.docx` directly in pure
  Python OOXML (no MS Word / win32com required), matching `lib/language-studio.js`.
- Mode `journal`: Creates or appends entries to local `Diario.docx` encrypted with
  `WORD_PASSWORD` via `msoffcrypto-tool` (MS-OFFCRYPTO Agile Encryption) strictly in RAM,
  with mandatory round-trip decryption verification before atomic disk replacement.
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape as _xml_escape
from datetime import datetime, date, timedelta

W_NS_URI = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS_URI = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
XML_NS_URI = "http://www.w3.org/XML/1998/namespace"
W_NS = f"{{{W_NS_URI}}}"
XML_NS = f"{{{XML_NS_URI}}}"

SECCIONES_INGLES = {
    "vocabulary": "1. Glossary & New Words",
    "grammar": "2. Grammar & Usage Notes",
    "phrasal_verb": "3. Phrasal Verbs",
    "music": "4. Songs & Music Study",
    "notes": "5. My Notes & Learnings",
}

_PREFIJOS_SECCION_INGLES = {
    "vocabulary": "1.",
    "grammar": "2.",
    "phrasal_verb": "3.",
    "music": "4.",
    "notes": "5.",
}

_LANG_CODE_ALIASES = {
    "kr": "ko",
    "jp": "ja",
    "orig": "original",
    "jp-en": "original",
    "en-jp": "original",
    "ja-en": "original",
    "en-ja": "original",
}

_RE_ENCABEZADO_IDIOMA_LETRA = re.compile(
    r"^(?:===\s*)?\[(?:Letra\s*[—\-]\s*)?(original|orig|en|ko|kr|es|ja|jp|jp-en|en-jp|ja-en|en-ja|zh|fr|pt|de|it|ru|sub|und)(?:-[A-Za-z0-9]+)?(?:\s*(?:[—/\-])[^\]]*)?\](?:\s*===)?\s*$",
    re.IGNORECASE,
)
_RE_HANGUL_CHAR = re.compile(r"[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]")
_RE_STRUCTURAL_TAG_LINE = re.compile(
    r"^\[(?:intro|verse(?:\s*\d+)?|pre-?chorus|post-?chorus|chorus|refrain|bridge|rap(?:\s*part)?|interlude|outro|hook|solo|breakdown|coro|verso(?:\s*\d+)?|puente|estribillo)[^\]]*\]$",
    re.IGNORECASE,
)
_RE_RUIDO_SUBTITULO_LINEA = re.compile(
    r"^(?:\[(?:음악|音楽|歌|music|applause|laughter|cheering|instrumental)\]|\s*[\[\]]\s*)$",
    re.IGNORECASE,
)
_RE_TRADUCCION_ES_EN_NOTAS = re.compile(
    r"(?:^|\n)\[Traducción\s+ES\s*[—-][^\]]+\]\s*\n([\s\S]*?)(?=\n---\n|\Z)",
    re.IGNORECASE,
)

_WORD_SONG_LABEL_MAP = (
    ("Song:", "song_title"),
    ("Track #:", "track_number"),
    ("Language:", "language"),
    ("Artists / Collabs:", "artists_display"),
    ("Album / Release:", "album_release"),
    ("Release Date:", "release_date"),
    ("Playlist / List:", "playlist_name"),
    ("YouTube Music:", "yt_music_url"),
    ("Study Focus:", "focus_summary"),
    ("Stanzas Breakdown (Intro / Chorus / Rap):", "stanzas_breakdown"),
    ("Stanza Breakdown (Intro / Pre-Coro / Coro / Rap / Cierre):", "stanzas_breakdown"),
    ("Stanza Breakdown:", "stanzas_breakdown"),
    ("Lyrics & Meaning Breakdown:", "lyrics_study"),
    ("Heading 2: Letra", "lyrics_study"),
    ("Letra:", "lyrics_study"),
    ("Vocabulary & Expressions:", "vocabulary_list"),
    ("Pronunciation & Connected Speech:", "pronunciation_notes"),
    ("Practice & Quiz:", "practice_quiz"),
    ("Extra Study Notes:", "notes"),
    ("Added:", "added_at"),
)


def _w_tag(name: str) -> str:
    return f"{W_NS}{name}"


def _w_el(name: str, **attrs) -> ET.Element:
    attrib = {_w_tag(k): str(v) for k, v in attrs.items() if v is not None}
    return ET.Element(_w_tag(name), attrib)


def _limpiar_linea(texto) -> str:
    if texto is None:
        return ""
    return str(texto).replace("\r", " ").replace("\n", " ").strip()


def _dividir_lineas_limpias(texto) -> list[str]:
    if texto is None:
        return []
    return [line.strip() for line in str(texto).replace("\r", "").split("\n") if line.strip()]


def _normalizar_clave_texto(texto) -> str:
    return " ".join(str(texto or "").split()).strip().lower()


def _extraer_numero_pista(valor_o_heading):
    if isinstance(valor_o_heading, bool):
        return None
    if isinstance(valor_o_heading, (int, float)):
        num = int(valor_o_heading)
        return num if num > 0 else None
    texto = str(valor_o_heading or "").strip()
    if not texto:
        return None
    if texto.isdigit():
        num = int(texto)
        return num if num > 0 else None
    m = re.match(r"^(?:#|track\s+)?(\d{1,3})\s*[.\-:)\]]\s*", texto, re.IGNORECASE)
    if m:
        num = int(m.group(1))
        return num if num > 0 else None
    return None


def _quitar_prefijo_pista(heading_text) -> str:
    texto = _limpiar_linea(heading_text)
    return re.sub(r"^(?:#|track\s+)?\d{1,3}\s*[.\-:)\]]\s*", "", texto, flags=re.IGNORECASE).strip()


def calcular_encabezado(fecha_objetivo=None) -> str:
    if fecha_objetivo is None:
        fecha_dt = datetime.now().date()
    elif isinstance(fecha_objetivo, datetime):
        fecha_dt = fecha_objetivo.date()
    elif isinstance(fecha_objetivo, date):
        fecha_dt = fecha_objetivo
    else:
        fecha_dt = datetime.strptime(str(fecha_objetivo)[:10], "%Y-%m-%d").date()

    fecha_inicio = date(2026, 8, 30)
    dias_pasados = (fecha_dt - fecha_inicio).days
    d_actual = 500 - dias_pasados

    meses_ingles = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]
    mes = meses_ingles[fecha_dt.month - 1]
    dia = fecha_dt.day
    sufijo = "th" if 11 <= dia <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(dia % 10, "th")
    return f"{mes} {dia:02d}{sufijo} D-{d_actual}"


def _build_minimal_docx_bytes(mode: str = "english") -> bytes:
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
        "</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="{R_NS_URI}/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )
    doc_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="{R_NS_URI}/styles" Target="styles.xml"/>'
        f'<Relationship Id="rId2" Type="{R_NS_URI}/settings" Target="settings.xml"/>'
        "</Relationships>"
    )
    settings_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
        f'<w:settings xmlns:w="{W_NS_URI}">'
        '<w:updateFields w:val="true"/>'
        "</w:settings>"
    )
    styles_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
        f'<w:styles xmlns:w="{W_NS_URI}">'
        '<w:docDefaults><w:rPrDefault><w:rPr>'
        '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>'
        '<w:sz w:val="22"/><w:szCs w:val="22"/>'
        "</w:rPr></w:rPrDefault></w:docDefaults>"
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
        '<w:name w:val="Normal"/><w:qFormat/>'
        '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/></w:rPr>'
        "</w:style>"
        '<w:style w:type="paragraph" w:styleId="Title">'
        '<w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
        '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:sz w:val="36"/></w:rPr>'
        "</w:style>"
        '<w:style w:type="paragraph" w:styleId="Subtitle">'
        '<w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
        '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:i/><w:color w:val="666666"/><w:sz w:val="20"/></w:rPr>'
        "</w:style>"
        '<w:style w:type="paragraph" w:styleId="Heading1">'
        '<w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
        '<w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr>'
        '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:sz w:val="30"/></w:rPr>'
        "</w:style>"
        '<w:style w:type="paragraph" w:styleId="Heading2">'
        '<w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
        '<w:pPr><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr>'
        '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:sz w:val="26"/></w:rPr>'
        "</w:style>"
        '<w:style w:type="paragraph" w:styleId="Heading3">'
        '<w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
        '<w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr>'
        '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:sz w:val="23"/></w:rPr>'
        "</w:style>"
        '<w:style w:type="character" w:styleId="Hyperlink">'
        '<w:name w:val="Hyperlink"/>'
        '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>'
        "</w:style>"
        "</w:styles>"
    )

    if mode == "english":
        sections_xml = "".join(
            f'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>{_xml_escape(title)}</w:t></w:r></w:p><w:p/>'
            for title in SECCIONES_INGLES.values()
        )
        body_inner = (
            '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>English Learning Notebook</w:t></w:r></w:p>'
            '<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr><w:r><w:t>Structured Vocabulary, Grammar &amp; Phrasal Verbs Log</w:t></w:r></w:p>'
            '<w:p><w:r><w:rPr><w:b/><w:sz w:val="26"/></w:rPr><w:t>Table of Contents</w:t></w:r></w:p>'
            '<w:p/><w:p/>'
            f"{sections_xml}"
        )
    else:
        body_inner = (
            '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Personal Daily Journal</w:t></w:r></w:p>'
            '<w:p/>'
        )

    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
        f'<w:document xmlns:w="{W_NS_URI}" xmlns:r="{R_NS_URI}">'
        f"<w:body>{body_inner}"
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
        "</w:body></w:document>"
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        zout.writestr("[Content_Types].xml", content_types.encode("utf-8"))
        zout.writestr("_rels/.rels", root_rels.encode("utf-8"))
        zout.writestr("word/_rels/document.xml.rels", doc_rels.encode("utf-8"))
        zout.writestr("word/settings.xml", settings_xml.encode("utf-8"))
        zout.writestr("word/styles.xml", styles_xml.encode("utf-8"))
        zout.writestr("word/document.xml", document_xml.encode("utf-8"))
    return buf.getvalue()


def _ooxml_cargar_estilos_mapa(zf: zipfile.ZipFile) -> dict:
    levels = {}
    ids = {
        "normal": "Normal",
        "heading_1": "Heading1",
        "heading_2": "Heading2",
        "heading_3": "Heading3",
        "hyperlink": "Hyperlink",
    }
    if "word/styles.xml" not in zf.namelist():
        return {"levels": levels, "ids": ids}
    try:
        root = ET.fromstring(zf.read("word/styles.xml"))
    except ET.ParseError:
        return {"levels": levels, "ids": ids}

    val_attr = _w_tag("val")
    id_attr = _w_tag("styleId")
    for style in root.findall(f".//{_w_tag('style')}"):
        sid = style.attrib.get(id_attr, "")
        if not sid:
            continue
        name_el = style.find(_w_tag("name"))
        sname = name_el.attrib.get(val_attr, "") if name_el is not None else ""
        low = f"{sid} {sname}".lower()
        if "hyperlink" in low:
            ids["hyperlink"] = sid
        elif re.search(r"\bnormal\b", low):
            ids["normal"] = sid
        elif re.search(r"\b(?:heading\s*1|t[ií]tulo\s*1)\b", low):
            levels[sid] = 1
            ids["heading_1"] = sid
        elif re.search(r"\b(?:heading\s*2|t[ií]tulo\s*2)\b", low):
            levels[sid] = 2
            ids["heading_2"] = sid
        elif re.search(r"\b(?:heading\s*3|t[ií]tulo\s*3)\b", low):
            levels[sid] = 3
            ids["heading_3"] = sid

        lvl_el = style.find(f"{_w_tag('pPr')}/{_w_tag('outlineLvl')}")
        if lvl_el is not None and sid not in levels:
            try:
                lvl_num = int(lvl_el.attrib.get(val_attr, "-1")) + 1
                if 1 <= lvl_num <= 3:
                    levels[sid] = lvl_num
            except ValueError:
                pass
    return {"levels": levels, "ids": ids}


def _texto_parrafo_ooxml(p_elem: ET.Element) -> str:
    t_tag = _w_tag("t")
    br_tag = _w_tag("br")
    cr_tag = _w_tag("cr")
    tab_tag = _w_tag("tab")
    chunks = []
    for node in p_elem.iter():
        if node.tag == t_tag and node.text:
            chunks.append(node.text)
        elif node.tag in (br_tag, cr_tag):
            chunks.append("\n")
        elif node.tag == tab_tag:
            chunks.append(" ")
    return "".join(chunks).replace("\r", "").strip()


def _nivel_parrafo_ooxml(p_elem: ET.Element, style_levels: dict) -> int:
    val_attr = _w_tag("val")
    ppr = p_elem.find(_w_tag("pPr"))
    if ppr is None:
        return 0
    pstyle_el = ppr.find(_w_tag("pStyle"))
    if pstyle_el is not None:
        sid = pstyle_el.attrib.get(val_attr, "")
        if sid in style_levels:
            return style_levels[sid]
        low = sid.lower()
        if re.search(r"heading\s*1|t[ií]tulo\s*1", low):
            return 1
        if re.search(r"heading\s*2|t[ií]tulo\s*2", low):
            return 2
        if re.search(r"heading\s*3|t[ií]tulo\s*3", low):
            return 3
    lvl_el = ppr.find(_w_tag("outlineLvl"))
    if lvl_el is not None:
        try:
            lvl = int(lvl_el.attrib.get(val_attr, "-1")) + 1
            if 1 <= lvl <= 3:
                return lvl
        except ValueError:
            pass
    return 0


def _crear_rpr(
    font_size=11,
    bold=False,
    italic=False,
    color=None,
    rstyle=None,
    no_proof=False,
    web_hidden=False,
    use_arial=True,
) -> ET.Element:
    rpr = _w_el("rPr")
    if rstyle:
        rpr.append(_w_el("rStyle", val=rstyle))
    if use_arial:
        rpr.append(_w_el("rFonts", ascii="Arial", hAnsi="Arial", cs="Arial"))
    if bold:
        rpr.append(_w_el("b"))
    if italic:
        rpr.append(_w_el("i"))
    if no_proof:
        rpr.append(_w_el("noProof"))
    if color:
        rpr.append(_w_el("color", val=color))
    if font_size:
        rpr.append(_w_el("sz", val=int(round(float(font_size) * 2))))
    if web_hidden:
        rpr.append(_w_el("webHidden"))
    return rpr


def _crear_run_texto(
    texto,
    font_size=11,
    bold=False,
    italic=False,
    color=None,
    rstyle=None,
    use_arial=True,
) -> ET.Element:
    run = _w_el("r")
    run.append(
        _crear_rpr(
            font_size=font_size,
            bold=bold,
            italic=italic,
            color=color,
            rstyle=rstyle,
            use_arial=use_arial,
        )
    )
    t_el = _w_el("t")
    txt = "" if texto is None else str(texto)
    if txt.startswith(" ") or txt.endswith(" ") or "\t" in txt:
        t_el.attrib[f"{XML_NS}space"] = "preserve"
    t_el.text = txt
    run.append(t_el)
    return run


def _crear_parrafo_texto(
    style_id=None,
    label="",
    text="",
    font_size=11,
    bold_all=False,
    italic=False,
    muted=False,
    color=None,
    page_break_before=None,
) -> ET.Element:
    p = _w_el("p")
    if style_id or page_break_before is not None:
        ppr = _w_el("pPr")
        if style_id:
            ppr.append(_w_el("pStyle", val=style_id))
        if page_break_before is True:
            ppr.append(_w_el("pageBreakBefore"))
        elif page_break_before is False:
            ppr.append(_w_el("pageBreakBefore", val="0"))
        p.append(ppr)
    color_hex = color if color is not None else ("666666" if muted else None)
    if label:
        p.append(_crear_run_texto(label, font_size=font_size, bold=True, italic=italic, color=color_hex))
    if text:
        lines = str(text).replace("\r", "").split("\n")
        for idx, line in enumerate(lines):
            if idx > 0:
                br_run = _w_el("r")
                br_run.append(_w_el("br"))
                p.append(br_run)
            p.append(_crear_run_texto(line, font_size=font_size, bold=bold_all, italic=italic, color=color_hex))
    return p


def _configurar_page_break_before(p_elem: ET.Element, enabled: bool = False) -> None:
    ppr_tag = _w_tag("pPr")
    pstyle_tag = _w_tag("pStyle")
    pb_tag = _w_tag("pageBreakBefore")
    r_tag = _w_tag("r")
    br_tag = _w_tag("br")
    type_attr = _w_tag("type")
    val_attr = _w_tag("val")

    for r in list(p_elem.findall(r_tag)):
        for br in list(r.findall(br_tag)):
            if br.attrib.get(type_attr) == "page":
                r.remove(br)
        if len(r) == 0:
            p_elem.remove(r)

    ppr = p_elem.find(ppr_tag)
    if ppr is None:
        if not enabled:
            return
        ppr = _w_el("pPr")
        p_elem.insert(0, ppr)

    for pb in list(ppr.findall(pb_tag)):
        ppr.remove(pb)

    pb_el = _w_el("pageBreakBefore") if enabled else _w_el("pageBreakBefore", val="0")
    pstyle = ppr.find(pstyle_tag)
    if pstyle is not None:
        idx = list(ppr).index(pstyle) + 1
        ppr.insert(idx, pb_el)
    else:
        ppr.insert(0, pb_el)


def _indice_sectpr(body: ET.Element) -> int:
    children = list(body)
    for idx in range(len(children) - 1, -1, -1):
        if children[idx].tag == _w_tag("sectPr"):
            return idx
    return len(children)


def _encontrar_rango_toc(body_children: list[ET.Element]):
    p_tag = _w_tag("p")
    fld_tag = _w_tag("fldChar")
    instr_tag = _w_tag("instrText")
    ftype_attr = _w_tag("fldCharType")

    for idx, child in enumerate(body_children):
        if child.tag == _w_tag("sdt"):
            full_txt = " ".join(t.text or "" for t in child.iter(instr_tag))
            if "TOC" in full_txt.upper():
                return (idx, idx + 1)

    toc_start = None
    in_toc = False
    for idx, child in enumerate(body_children):
        if child.tag != p_tag:
            continue
        has_toc_instr = any("TOC" in (it.text or "").upper() for it in child.iter(instr_tag))
        fld_types = [fc.attrib.get(ftype_attr, "") for fc in child.iter(fld_tag)]
        if has_toc_instr and not in_toc:
            toc_start = idx
            in_toc = True
        if in_toc and "end" in fld_types:
            return (toc_start, idx + 1)
    return None


def _items_cuerpo(body: ET.Element, style_levels: dict):
    p_tag = _w_tag("p")
    items = []
    for child in list(body):
        if child.tag == p_tag:
            items.append((_nivel_parrafo_ooxml(child, style_levels), _texto_parrafo_ooxml(child)))
        else:
            items.append((0, ""))
    return items


def _buscar_rango_seccion(body: ET.Element, style_levels: dict, category: str, toc_range=None):
    items = _items_cuerpo(body, style_levels)
    prefijo = _PREFIJOS_SECCION_INGLES.get(category, "2.")
    sec_start = None
    sec_end = None
    for idx, (level, text) in enumerate(items):
        if toc_range and toc_range[0] <= idx < toc_range[1]:
            continue
        if level == 1 and text.startswith(prefijo):
            sec_start = idx
            continue
        if sec_start is not None and level == 1:
            sec_end = idx
            break
    if sec_start is None:
        return None, _indice_sectpr(body), items
    if sec_end is None:
        sec_end = _indice_sectpr(body)
    return sec_start, sec_end, items


def _asegurar_secciones_y_final(body: ET.Element, style_levels: dict, estilo_ids: dict) -> None:
    p_tag = _w_tag("p")
    toc_range = _encontrar_rango_toc(list(body))
    present = []
    for idx, child in enumerate(list(body)):
        if toc_range and toc_range[0] <= idx < toc_range[1]:
            continue
        if child.tag == p_tag and _nivel_parrafo_ooxml(child, style_levels) == 1:
            present.append(_texto_parrafo_ooxml(child).lower())

    for cat, titulo in SECCIONES_INGLES.items():
        pref = _PREFIJOS_SECCION_INGLES[cat]
        if any(p.startswith(pref) for p in present):
            continue
        insert_pos = _indice_sectpr(body)
        body.insert(
            insert_pos,
            _crear_parrafo_texto(
                style_id=estilo_ids["heading_1"],
                text=titulo,
                font_size=15,
                bold_all=True,
            ),
        )
        body.insert(insert_pos + 1, _w_el("p"))


def _normalizar_saltos_pagina(body: ET.Element, style_levels: dict) -> None:
    children = list(body)
    p_tag = _w_tag("p")
    toc_range = _encontrar_rango_toc(children)
    sect_idx = _indice_sectpr(body)

    in_music = False
    music_albums_seen = 0
    music_tracks_in_album = 0

    for idx in range(sect_idx):
        if toc_range and toc_range[0] <= idx < toc_range[1]:
            continue
        child = children[idx]
        if child.tag != p_tag:
            continue
        lvl = _nivel_parrafo_ooxml(child, style_levels)
        txt = _texto_parrafo_ooxml(child).lower()
        if lvl == 1:
            in_music = txt.startswith("4.")
            music_albums_seen = 0
            music_tracks_in_album = 0
            _configurar_page_break_before(child, enabled=True)
        elif lvl == 2 and in_music:
            is_first_album = music_albums_seen == 0
            music_albums_seen += 1
            music_tracks_in_album = 0
            _configurar_page_break_before(child, enabled=(not is_first_album))
        elif lvl == 3 and in_music:
            is_first_track = music_tracks_in_album == 0
            music_tracks_in_album += 1
            _configurar_page_break_before(child, enabled=(not is_first_track))
        elif lvl in (2, 3):
            _configurar_page_break_before(child, enabled=False)


def _serializar_documento(doc_root: ET.Element, orig_xml_bytes: bytes) -> bytes:
    orig_str = orig_xml_bytes.decode("utf-8", errors="replace")
    ns_pairs = []
    m_open = re.search(r"<w:document\b([^>]*)>", orig_str)
    if m_open:
        ns_pairs = re.findall(r'\bxmlns:([A-Za-z0-9_]+)="([^"]+)"', m_open.group(1))
        for prefix, uri in ns_pairs:
            if prefix != "xml":
                ET.register_namespace(prefix, uri)
    else:
        ET.register_namespace("w", W_NS_URI)
        ET.register_namespace("r", R_NS_URI)

    xml_out = ET.tostring(doc_root, encoding="unicode")
    m_out_open = re.search(r"<[^:>]+:document\b[^>]*>", xml_out)
    if m_out_open and ns_pairs:
        open_tag = m_out_open.group(0)
        missing_attrs = "".join(
            f' xmlns:{prefix}="{uri}"'
            for prefix, uri in ns_pairs
            if prefix != "xml" and f"xmlns:{prefix}=" not in open_tag
        )
        if missing_attrs:
            xml_out = xml_out.replace(open_tag, open_tag[:-1] + missing_attrs + ">", 1)
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml_out).encode("utf-8")


# ---------------------------------------------------------------------------
# English Notebook formatting, deduplication, and music merging
# ---------------------------------------------------------------------------

def _limpiar_ruido_letra(texto) -> str:
    raw = str(texto or "").replace("\r", "").strip()
    if not raw:
        return ""
    limpias = []
    for line in raw.split("\n"):
        s = line.strip()
        if s and _RE_RUIDO_SUBTITULO_LINEA.match(s):
            continue
        limpias.append(line.rstrip())
    res = re.sub(r"\n{3,}", "\n\n", "\n".join(limpias))
    return res.strip()


def _limpiar_notas_redundantes_cancion(notes_val, lyrics_val="") -> str:
    notes_clean = str(notes_val or "").replace("\r", "").strip()
    if not notes_clean:
        return ""
    has_es = bool(
        re.search(
            r"(?:^|\n)(?:===\s*)?\[es(?:\s*[—/\-][^\]]*)?\](?:\s*===)?\s*(?:\n|$)",
            str(lyrics_val or ""),
            re.IGNORECASE,
        )
    )
    if has_es:
        notes_clean = _RE_TRADUCCION_ES_EN_NOTAS.sub("\n", notes_clean)
        notes_clean = re.sub(r"(?:\n---\n|\A---\n|\n---\Z)", "\n", notes_clean)
        notes_clean = re.sub(r"\n{3,}", "\n\n", notes_clean).strip()
    return notes_clean


def _dividir_letra_por_idiomas(texto):
    bloques = []
    clave, encabezado, cuerpo = "", "", []
    for raw in str(texto or "").replace("\r", "").split("\n"):
        m = _RE_ENCABEZADO_IDIOMA_LETRA.match(raw.strip())
        if m:
            if encabezado or any(ln.strip() for ln in cuerpo):
                bloques.append((clave, encabezado, "\n".join(cuerpo).strip()))
            raw_code = m.group(1).lower()
            clave = _LANG_CODE_ALIASES.get(raw_code, raw_code)
            encabezado, cuerpo = raw.strip(), []
        else:
            cuerpo.append(raw)
    if encabezado or any(ln.strip() for ln in cuerpo):
        bloques.append((clave, encabezado, "\n".join(cuerpo).strip()))
    return bloques


def _combinar_campo_multilinea(prev_val, new_val, append=False) -> str:
    prev_clean = str(prev_val or "").strip()
    new_clean = str(new_val or "").strip()
    if not new_clean:
        return prev_clean
    if not prev_clean:
        return new_clean
    if not append:
        return new_clean
    if new_clean == prev_clean or new_clean in prev_clean:
        return prev_clean
    if prev_clean in new_clean:
        return new_clean
    return f"{prev_clean}\n---\n{new_clean}"


def _combinar_letra_por_idiomas(prev_val, new_val, append=False) -> str:
    prev_clean = _limpiar_ruido_letra(prev_val)
    new_clean = _limpiar_ruido_letra(new_val)
    if not new_clean:
        return prev_clean
    if not prev_clean:
        return new_clean

    def norm(s):
        return " ".join(str(s or "").split()).lower()

    if norm(new_clean) == norm(prev_clean) or norm(new_clean) in norm(prev_clean):
        return prev_clean
    if norm(prev_clean) in norm(new_clean):
        return new_clean

    prev_blocks = _dividir_letra_por_idiomas(prev_clean)
    new_blocks = _dividir_letra_por_idiomas(new_clean)
    if not any(b[1] for b in prev_blocks) and not any(b[1] for b in new_blocks):
        return _combinar_campo_multilinea(prev_clean, new_clean, append=append)

    ordered_keys = []
    block_map = {}
    for clave, enc, cuerpo in prev_blocks:
        slot = clave if enc else "__base__"
        if slot not in block_map:
            ordered_keys.append(slot)
            block_map[slot] = (clave, enc, cuerpo)
        elif cuerpo and norm(cuerpo) not in norm(block_map[slot][2]):
            prev_c = block_map[slot][2]
            block_map[slot] = (clave, block_map[slot][1] or enc, f"{prev_c}\n\n{cuerpo}".strip() if prev_c else cuerpo)

    for clave, enc, cuerpo in new_blocks:
        slot = clave if enc else "__base__"
        if slot in block_map:
            old_clave, old_enc, old_cuerpo = block_map[slot]
            if slot == "__base__" and append and old_cuerpo and norm(cuerpo) != norm(old_cuerpo):
                updated_body = _combinar_campo_multilinea(old_cuerpo, cuerpo, append=True)
            else:
                updated_body = cuerpo or old_cuerpo
            block_map[slot] = (clave or old_clave, enc or old_enc, updated_body)
        else:
            ordered_keys.append(slot)
            block_map[slot] = (clave, enc, cuerpo)

    canon_order = {"__base__": 0, "original": 1, "ko": 2, "en": 3, "ja": 4, "es": 5}
    ordered_keys = sorted(ordered_keys, key=lambda k: (canon_order.get(k, 6), ordered_keys.index(k)))

    merged, seen_bodies = [], set()
    for slot in ordered_keys:
        clave, enc, cuerpo = block_map[slot]
        h = norm(cuerpo)
        if not enc and not h:
            continue
        if h and h in seen_bodies:
            continue
        if h:
            seen_bodies.add(h)
        merged.append((enc, cuerpo))

    return "\n\n".join(f"{enc}\n{cuerpo}".strip() if enc else cuerpo for enc, cuerpo in merged).strip()


def _parsear_album_release_linea(texto):
    limpio = _limpiar_linea(texto)
    if not limpio:
        return "", "", ""
    m = re.match(r"^(.*?)\s*\(([^)]+)\)\s*$", limpio)
    if not m:
        return limpio, "", ""
    nombre = m.group(1).strip()
    partes = [p.strip() for p in m.group(2).split(",") if p.strip()]
    album_type, release_year = "", ""
    for parte in partes:
        if re.fullmatch(r"\d{4}", parte):
            release_year = parte
        elif not album_type:
            album_type = parte
    return nombre, album_type, release_year


def _extraer_campos_bloque_word(lineas_texto, heading_text="") -> dict:
    fields = {
        "song_title": _quitar_prefijo_pista(heading_text).split(" — ", 1)[0].strip() if heading_text else "",
        "track_number": _extraer_numero_pista(heading_text),
        "language": "", "artists_display": "", "album_title": "", "album_type": "",
        "release_year": "", "release_date": "", "playlist_name": "", "yt_music_url": "",
        "focus_summary": "", "stanzas_breakdown": "", "lyrics_study": "",
        "vocabulary_list": "", "pronunciation_notes": "", "practice_quiz": "",
        "notes": "", "added_at": "",
    }
    multiline_keys = {"stanzas_breakdown", "lyrics_study", "vocabulary_list", "pronunciation_notes", "practice_quiz", "notes"}
    current_key = None

    for raw in lineas_texto or []:
        line = str(raw or "").replace("\r", "").strip()
        if not line:
            continue
        matched_label = False
        for label, key in _WORD_SONG_LABEL_MAP:
            if line.startswith(label):
                val = line[len(label):].strip()
                if key == "album_release":
                    alb_t, alb_ty, rel_y = _parsear_album_release_linea(val)
                    fields["album_title"], fields["album_type"], fields["release_year"] = alb_t, alb_ty, rel_y
                elif key == "track_number":
                    fields["track_number"] = _extraer_numero_pista(val)
                else:
                    fields[key] = val
                current_key = key if key in multiline_keys else None
                matched_label = True
                break
        if not matched_label and current_key:
            prev = fields.get(current_key, "")
            fields[current_key] = f"{prev}\n{line}" if prev else line
    return fields


def _combinar_metadata_cancion_word(existing_fields, new_entry) -> dict:
    old = existing_fields or {}
    append_study = bool(new_entry.get("append_study_fields"))
    combined_lyrics = _combinar_letra_por_idiomas(old.get("lyrics_study"), new_entry.get("lyrics_study"), append=append_study)
    old_notes_clean = _limpiar_notas_redundantes_cancion(old.get("notes"), combined_lyrics)
    new_notes_clean = _limpiar_notas_redundantes_cancion(new_entry.get("notes"), combined_lyrics)
    merged_notes = _limpiar_notas_redundantes_cancion(
        _combinar_campo_multilinea(old_notes_clean, new_notes_clean, append=append_study),
        combined_lyrics,
    )
    return {
        "category": "music",
        "language": _limpiar_linea(new_entry.get("language")) or _limpiar_linea(old.get("language")),
        "song_title": _limpiar_linea(new_entry.get("song_title")) or _limpiar_linea(old.get("song_title")) or "Untitled Song",
        "artists_display": _limpiar_linea(new_entry.get("artists_display")) or _limpiar_linea(old.get("artists_display")) or "Unknown Artist",
        "album_title": _limpiar_linea(new_entry.get("album_title")) or _limpiar_linea(old.get("album_title")),
        "album_type": _limpiar_linea(new_entry.get("album_type")) or _limpiar_linea(old.get("album_type")),
        "release_year": _limpiar_linea(new_entry.get("release_year")) or _limpiar_linea(old.get("release_year")),
        "release_date": _limpiar_linea(new_entry.get("release_date")) or _limpiar_linea(old.get("release_date")),
        "track_number": _extraer_numero_pista(new_entry.get("track_number")) or _extraer_numero_pista(old.get("track_number")),
        "playlist_name": _limpiar_linea(new_entry.get("playlist_name")) or _limpiar_linea(old.get("playlist_name")),
        "yt_music_url": _limpiar_linea(new_entry.get("yt_music_url")) or _limpiar_linea(old.get("yt_music_url")),
        "focus_summary": _limpiar_linea(new_entry.get("focus_summary")) or _limpiar_linea(old.get("focus_summary")),
        "stanzas_breakdown": _combinar_campo_multilinea(old.get("stanzas_breakdown"), new_entry.get("stanzas_breakdown"), append=append_study),
        "lyrics_study": combined_lyrics,
        "vocabulary_list": _combinar_campo_multilinea(old.get("vocabulary_list"), new_entry.get("vocabulary_list"), append=append_study),
        "pronunciation_notes": _combinar_campo_multilinea(old.get("pronunciation_notes"), new_entry.get("pronunciation_notes"), append=append_study),
        "practice_quiz": _combinar_campo_multilinea(old.get("practice_quiz"), new_entry.get("practice_quiz"), append=append_study),
        "notes": merged_notes,
        "added_at": _limpiar_linea(new_entry.get("added_at")) or _limpiar_linea(old.get("added_at")),
    }


def parsear_entrada_ingles(entry_or_text) -> dict:
    if isinstance(entry_or_text, dict):
        parsed = entry_or_text
    else:
        texto = (entry_or_text or "").strip()
        if not texto:
            raise ValueError("La entrada de inglés está vacía.")
        try:
            parsed = json.loads(texto)
        except (ValueError, TypeError):
            return {"category": "grammar", "title": _limpiar_linea(texto)[:60] or "General English Note", "notes": texto, "example": ""}
        if not isinstance(parsed, dict):
            return {"category": "grammar", "title": _limpiar_linea(parsed)[:60] or "General English Note", "notes": str(parsed), "example": ""}

    category = str(parsed.get("category", "")).strip().lower()
    if category not in SECCIONES_INGLES:
        category = "grammar"

    if category == "vocabulary":
        return {
            "category": "vocabulary",
            "language": _limpiar_linea(parsed.get("language")),
            "word": _limpiar_linea(parsed.get("word")),
            "romanization": _limpiar_linea(parsed.get("romanization")),
            "part_of_speech": _limpiar_linea(parsed.get("part_of_speech")),
            "spanish": _limpiar_linea(parsed.get("spanish")),
            "example": str(parsed.get("example") or "").strip(),
            "notes": str(parsed.get("notes") or "").strip(),
        }
    if category == "phrasal_verb":
        return {
            "category": "phrasal_verb",
            "language": _limpiar_linea(parsed.get("language")),
            "verb": _limpiar_linea(parsed.get("verb")),
            "grammar_type": _limpiar_linea(parsed.get("grammar_type")),
            "meaning_es": _limpiar_linea(parsed.get("meaning_es")),
            "meaning_en": _limpiar_linea(parsed.get("meaning_en")),
            "example": str(parsed.get("example") or "").strip(),
            "notes": str(parsed.get("notes") or "").strip(),
        }
    if category == "notes":
        notes_body = str(parsed.get("notes") or parsed.get("text") or "").strip()
        return {
            "category": "notes",
            "language": _limpiar_linea(parsed.get("language")),
            "title": _limpiar_linea(parsed.get("title")) or _limpiar_linea(notes_body)[:60] or "Personal Note",
            "notes": notes_body,
            "example": str(parsed.get("example") or "").strip(),
        }
    if category == "music":
        raw_track = parsed.get("track_number") if parsed.get("track_number") is not None else parsed.get("numero_pista")
        try:
            track_num = int(raw_track) if raw_track not in (None, "", False) else None
            if track_num is not None and track_num <= 0:
                track_num = None
        except (ValueError, TypeError):
            track_num = _extraer_numero_pista(raw_track)
        return {
            "category": "music",
            "language": _limpiar_linea(parsed.get("language")),
            "song_title": _limpiar_linea(parsed.get("song_title")),
            "artists_display": _limpiar_linea(parsed.get("artists_display")),
            "album_title": _limpiar_linea(parsed.get("album_title")),
            "album_type": _limpiar_linea(parsed.get("album_type")),
            "release_year": _limpiar_linea(parsed.get("release_year")),
            "release_date": _limpiar_linea(parsed.get("release_date")),
            "track_number": track_num,
            "playlist_name": _limpiar_linea(parsed.get("playlist_name")),
            "yt_music_url": _limpiar_linea(parsed.get("yt_music_url")),
            "focus_summary": _limpiar_linea(parsed.get("focus_summary")),
            "stanzas_breakdown": str(parsed.get("stanzas_breakdown") or "").strip(),
            "lyrics_study": str(parsed.get("lyrics_study") or "").strip(),
            "vocabulary_list": str(parsed.get("vocabulary_list") or "").strip(),
            "pronunciation_notes": str(parsed.get("pronunciation_notes") or "").strip(),
            "practice_quiz": str(parsed.get("practice_quiz") or "").strip(),
            "notes": str(parsed.get("notes") or "").strip(),
            "append_study_fields": bool(parsed.get("append_study_fields")),
        }
    return {
        "category": "grammar",
        "language": _limpiar_linea(parsed.get("language")),
        "title": _limpiar_linea(parsed.get("title")) or "Grammar Note",
        "notes": str(parsed.get("notes") or "").strip(),
        "example": str(parsed.get("example") or "").strip(),
        "practice_quiz": str(parsed.get("practice_quiz") or "").strip(),
    }


def _encabezado_grupo_album(entry: dict) -> str:
    album_title = _limpiar_linea(entry.get("album_title"))
    album_type = _limpiar_linea(entry.get("album_type"))
    release_year = _limpiar_linea(entry.get("release_year"))
    playlist_name = _limpiar_linea(entry.get("playlist_name"))
    artists_display = _limpiar_linea(entry.get("artists_display")) or "Unknown Artist"
    if album_title:
        meta_parts = [p for p in (album_type, release_year) if p]
        return f"{album_title} ({', '.join(meta_parts)})" if meta_parts else album_title
    if playlist_name:
        return f"Playlist: {playlist_name}"
    return f"Singles & Standalone — {artists_display}"


def _clave_grupo_album(heading: str) -> str:
    texto = _limpiar_linea(heading)
    sin_meta = re.sub(
        r"\s*\((?:Album|EP|Single|Collab Single|Mini Album|Mixtape|OST(?:\s*/\s*Soundtrack)?|Soundtrack|Compilation|Playlist)[^)]*\)\s*$",
        "", texto, flags=re.IGNORECASE,
    ).strip()
    return _normalizar_clave_texto(sin_meta or texto)


def _encabezado_pista_cancion(entry: dict) -> str:
    song_title = _limpiar_linea(entry.get("song_title")) or "Untitled Song"
    artists_display = _limpiar_linea(entry.get("artists_display")) or "Unknown Artist"
    track_num = _extraer_numero_pista(entry.get("track_number"))
    base = f"{song_title} — {artists_display}"
    return f"{track_num:02d}. {base}" if track_num else base


def _clave_pista_cancion(song_title: str, artists_display: str = ""):
    titulo = _quitar_prefijo_pista(song_title)
    if " — " in titulo and not artists_display:
        titulo = titulo.split(" — ", 1)[0].strip()
    if " [" in titulo:
        titulo = re.sub(r"\s*\[[^\]]+\]\s*$", "", titulo).strip()
    return (_normalizar_clave_texto(titulo), _normalizar_clave_texto(artists_display))


def _clave_orden_pista(track_number, song_title=""):
    num = _extraer_numero_pista(track_number)
    return (0 if num is not None else 1, num if num is not None else 999999, _normalizar_clave_texto(song_title))


def _agregar_lineas_texto(lineas_spec: list, label: str, raw_text, preserve_stanzas=False):
    if preserve_stanzas:
        cleaned = []
        pending_blank = False
        for raw_ln in str(raw_text or "").replace("\r", "").split("\n"):
            s = raw_ln.strip()
            if not s:
                if cleaned:
                    pending_blank = True
                continue
            if pending_blank and cleaned and cleaned[-1] != "":
                cleaned.append("")
            pending_blank = False
            cleaned.append(s)
        while cleaned and cleaned[-1] == "":
            cleaned.pop()
        for idx, line in enumerate(cleaned):
            is_lang_hdr = idx > 0 and bool(_RE_ENCABEZADO_IDIOMA_LETRA.match(line))
            lineas_spec.append({"label": label if idx == 0 else "", "text": line, "size": 11, "bold_all": is_lang_hdr, "italic": False, "muted": False})
        return
    for idx, line in enumerate(_dividir_lineas_limpias(raw_text)):
        lineas_spec.append({"label": label if idx == 0 else "", "text": line, "size": 11, "bold_all": False, "italic": False, "muted": False})


def formatear_entrada_ingles(entry: dict, fecha_dt=None) -> dict:
    category = entry.get("category") if entry.get("category") in SECCIONES_INGLES else "grammar"
    section_title = SECCIONES_INGLES[category]
    timestamp_str = _limpiar_linea(entry.get("added_at")) or (fecha_dt or datetime.now()).strftime("%Y-%m-%d %H:%M")
    lines = []

    if category == "vocabulary":
        language = _limpiar_linea(entry.get("language"))
        word = _limpiar_linea(entry.get("word")) or "New Word"
        romanization = _limpiar_linea(entry.get("romanization"))
        pos = _limpiar_linea(entry.get("part_of_speech"))
        spanish = _limpiar_linea(entry.get("spanish")) or "(No translation)"
        word_disp = f"{word} [{romanization}]" if romanization else word
        heading = f"{word_disp} ({pos}) — {spanish}" if pos else f"{word_disp} — {spanish}"
        if language:
            lines.append({"label": "Language: ", "text": language, "size": 10, "italic": True, "muted": True})
        lines.append({"label": "Expression: " if language else "English: ", "text": word, "size": 11, "italic": False, "muted": False})
        if romanization:
            lines.append({"label": "Romanization: ", "text": romanization, "size": 11, "italic": False, "muted": False})
        if pos:
            lines.append({"label": "Part of speech: ", "text": pos, "size": 11, "italic": False, "muted": False})
        lines.append({"label": "Meaning: " if language else "Spanish: ", "text": spanish, "size": 11, "italic": False, "muted": False})
        _agregar_lineas_texto(lines, "Example: ", entry.get("example"))
        _agregar_lineas_texto(lines, "Notes: ", entry.get("notes"))

    elif category == "phrasal_verb":
        language = _limpiar_linea(entry.get("language"))
        verb = _limpiar_linea(entry.get("verb")) or "Phrasal Verb"
        grammar_type = _limpiar_linea(entry.get("grammar_type"))
        meaning_es = _limpiar_linea(entry.get("meaning_es")) or "(No meaning)"
        meaning_en = _limpiar_linea(entry.get("meaning_en"))
        heading = f"{verb} — {meaning_es}"
        if language:
            lines.append({"label": "Language: ", "text": language, "size": 10, "italic": True, "muted": True})
        lines.append({"label": "Phrasal Verb: ", "text": verb, "size": 11, "italic": False, "muted": False})
        if grammar_type:
            lines.append({"label": "Pattern: ", "text": grammar_type, "size": 11, "italic": False, "muted": False})
        lines.append({"label": "Spanish Meaning: ", "text": meaning_es, "size": 11, "italic": False, "muted": False})
        if meaning_en:
            lines.append({"label": "English Definition: ", "text": meaning_en, "size": 11, "italic": False, "muted": False})
        _agregar_lineas_texto(lines, "Example: ", entry.get("example"))
        _agregar_lineas_texto(lines, "Notes: ", entry.get("notes"))

    elif category == "music":
        language = _limpiar_linea(entry.get("language"))
        song_title = _limpiar_linea(entry.get("song_title")) or "Untitled Song"
        artists_display = _limpiar_linea(entry.get("artists_display")) or "Unknown Artist"
        album_title = _limpiar_linea(entry.get("album_title"))
        album_type = _limpiar_linea(entry.get("album_type"))
        release_year = _limpiar_linea(entry.get("release_year"))
        release_date = _limpiar_linea(entry.get("release_date"))
        track_num = _extraer_numero_pista(entry.get("track_number"))
        playlist_name = _limpiar_linea(entry.get("playlist_name"))
        yt_music_url = _limpiar_linea(entry.get("yt_music_url"))
        focus_summary = _limpiar_linea(entry.get("focus_summary"))

        meta_parts = [p for p in (album_type, release_year) if p]
        album_label = f"{album_title} ({', '.join(meta_parts)})" if (album_title and meta_parts) else (", ".join(meta_parts) if meta_parts else album_title)
        group_heading = _encabezado_grupo_album(entry)
        track_heading = _encabezado_pista_cancion(entry)
        heading = track_heading

        lines.append({"label": "Song: ", "text": song_title, "size": 11, "italic": False, "muted": False})
        if track_num:
            lines.append({"label": "Track #: ", "text": f"{track_num:02d}", "size": 10, "italic": False, "muted": True})
        if language:
            lines.append({"label": "Language: ", "text": language, "size": 11, "italic": False, "muted": False})
        lines.append({"label": "Artists / Collabs: ", "text": artists_display, "size": 11, "italic": False, "muted": False})
        if album_label:
            lines.append({"label": "Album / Release: ", "text": album_label, "size": 11, "italic": False, "muted": False})
        if release_date:
            lines.append({"label": "Release Date: ", "text": release_date, "size": 10, "italic": False, "muted": True})
        if playlist_name:
            lines.append({"label": "Playlist / List: ", "text": playlist_name, "size": 11, "italic": False, "muted": False})
        if yt_music_url:
            lines.append({"label": "YouTube Music: ", "text": yt_music_url, "size": 10, "italic": False, "muted": True})
        if focus_summary:
            lines.append({"label": "Study Focus: ", "text": focus_summary, "size": 11, "italic": False, "muted": False})

        clean_lyrics = _limpiar_ruido_letra(entry.get("lyrics_study"))
        clean_notes = _limpiar_notas_redundantes_cancion(entry.get("notes"), clean_lyrics)
        _agregar_lineas_texto(lines, "Stanzas Breakdown (Intro / Chorus / Rap): ", entry.get("stanzas_breakdown"), preserve_stanzas=True)
        _agregar_lineas_texto(lines, "Lyrics & Meaning Breakdown: ", clean_lyrics, preserve_stanzas=True)
        _agregar_lineas_texto(lines, "Vocabulary & Expressions: ", entry.get("vocabulary_list"))
        _agregar_lineas_texto(lines, "Pronunciation & Connected Speech: ", entry.get("pronunciation_notes"))
        _agregar_lineas_texto(lines, "Practice & Quiz: ", entry.get("practice_quiz"))
        _agregar_lineas_texto(lines, "Extra Study Notes: ", clean_notes)

    else:
        language = _limpiar_linea(entry.get("language"))
        heading = _limpiar_linea(entry.get("title")) or "Grammar Note"
        if language:
            lines.append({"label": "Language: ", "text": language, "size": 10, "italic": True, "muted": True})
        _agregar_lineas_texto(lines, "Notes: ", entry.get("notes"))
        _agregar_lineas_texto(lines, "Examples: ", entry.get("example"))
        _agregar_lineas_texto(lines, "Practice & Quiz: ", entry.get("practice_quiz"))

    lines.append({"label": "Added: ", "text": timestamp_str, "size": 9, "italic": True, "muted": True})
    out = {"category": category, "section_title": section_title, "heading": heading, "lines": lines}
    if category == "music":
        out["group_heading"] = group_heading
        out["track_heading"] = track_heading
        out["track_number"] = track_num
    return out


def _construir_bloque_elementos(heading_text: str, heading_style_id: str, heading_size: float, lines_spec: list) -> list[ET.Element]:
    elems = [_crear_parrafo_texto(style_id=heading_style_id, text=heading_text, font_size=heading_size, bold_all=True)]
    for spec in lines_spec:
        elems.append(
            _crear_parrafo_texto(
                label=spec.get("label", ""),
                text=spec.get("text", ""),
                font_size=spec.get("size", 11),
                bold_all=bool(spec.get("bold_all")),
                italic=bool(spec.get("italic")),
                muted=bool(spec.get("muted")),
            )
        )
    elems.append(_w_el("p"))
    return elems


def _establecer_texto_heading(p_elem: ET.Element, heading_text: str, font_size: float) -> None:
    ppr_tag = _w_tag("pPr")
    bm_start_tag = _w_tag("bookmarkStart")
    bm_end_tag = _w_tag("bookmarkEnd")
    keep_elems = [child for child in list(p_elem) if child.tag in (ppr_tag, bm_start_tag, bm_end_tag)]
    for child in list(p_elem):
        p_elem.remove(child)
    for child in keep_elems:
        p_elem.append(child)
    p_elem.append(_crear_run_texto(heading_text, font_size=font_size, bold=True))


def _cuerpo_normalizado(textos) -> str:
    limpio = [t for t in textos if t and not t.startswith("Added:")]
    return _normalizar_clave_texto(" ".join(limpio))


def _bloque_duplicado(items, sec_start, sec_end, spec: dict) -> bool:
    if sec_start is None:
        return False
    target_heading = _normalizar_clave_texto(spec["heading"])
    strict_heading = spec.get("category") in ("vocabulary", "phrasal_verb")
    new_body = _cuerpo_normalizado([f"{ln.get('label', '')}{ln.get('text', '')}" for ln in spec["lines"]])
    idx = sec_start + 1
    while idx < sec_end:
        level, text = items[idx]
        if level == 2 and _normalizar_clave_texto(text) == target_heading:
            if strict_heading:
                return True
            j = idx + 1
            while j < sec_end and items[j][0] not in (1, 2):
                j += 1
            existing = _cuerpo_normalizado([items[k][1] for k in range(idx + 1, j)])
            if existing == new_body:
                return True
            idx = j
            continue
        idx += 1
    return False


def _agrupar_musica_desde_items(items, sec_start: int, sec_end: int):
    groups = []
    cur_group = None
    idx = sec_start + 1
    while idx < sec_end:
        level, text = items[idx]
        if level == 2:
            if cur_group:
                cur_group["end_idx"] = idx
                groups.append(cur_group)
            cur_group = {"h2_idx": idx, "heading": text, "group_key": _clave_grupo_album(text), "tracks": [], "end_idx": sec_end}
            idx += 1
            continue
        if level == 3 and cur_group is not None:
            j = idx + 1
            while j < sec_end and items[j][0] not in (1, 2, 3):
                j += 1
            song_key, _ = _clave_pista_cancion(text)
            cur_group["tracks"].append({
                "h3_idx": idx, "end_idx": j, "heading": text,
                "track_num": _extraer_numero_pista(text), "song_key": song_key,
            })
            idx = j
            continue
        idx += 1
    if cur_group:
        cur_group["end_idx"] = sec_end
        groups.append(cur_group)
    return groups


def _coincide_cancion_en_bloque(fields: dict, heading_text: str, target_title: str, target_artist: str = "") -> bool:
    cand_title = fields.get("song_title") or _quitar_prefijo_pista(heading_text).split(" — ", 1)[0].strip()
    cand_artist = fields.get("artists_display") or ""
    t_key, a_key = _clave_pista_cancion(target_title, target_artist)
    c_t_key, c_a_key = _clave_pista_cancion(cand_title, cand_artist)
    if not t_key or t_key != c_t_key:
        return False
    if a_key and c_a_key and a_key != c_a_key:
        return a_key in c_a_key or c_a_key in a_key
    return True


def update_english_docx_bytes(orig_bytes: bytes | None, raw_entry) -> tuple[bytes, dict]:
    if not orig_bytes:
        orig_bytes = _build_minimal_docx_bytes(mode="english")

    entry = parsear_entrada_ingles(raw_entry)
    with zipfile.ZipFile(io.BytesIO(orig_bytes), "r") as zin:
        estilos = _ooxml_cargar_estilos_mapa(zin)
        orig_doc_bytes = zin.read("word/document.xml")

    style_levels = estilos["levels"]
    estilo_ids = estilos["ids"]
    doc_root = ET.fromstring(orig_doc_bytes)
    body = doc_root.find(_w_tag("body"))
    if body is None:
        raise ValueError("word/document.xml sin elemento w:body")

    _asegurar_secciones_y_final(body, style_levels, estilo_ids)

    deduplicated = False
    if entry.get("category") == "music":
        toc_range = _encontrar_rango_toc(list(body))
        sec_start, sec_end, items = _buscar_rango_seccion(body, style_levels, "music", toc_range)
        if sec_start is None:
            sec_start = 0
        groups = _agrupar_musica_desde_items(items, sec_start, sec_end)
        target_title = _limpiar_linea(entry.get("song_title"))
        target_artist = _limpiar_linea(entry.get("artists_display"))

        combined_existing = None
        elems_to_remove = []
        body_children = list(body)
        for grp in groups:
            matched_in_grp = 0
            for tr in grp["tracks"]:
                body_lines = [_texto_parrafo_ooxml(body_children[p_i]) for p_i in range(tr["h3_idx"] + 1, tr["end_idx"])]
                existing_fields = _extraer_campos_bloque_word(body_lines, tr["heading"])
                if _coincide_cancion_en_bloque(existing_fields, tr["heading"], target_title, target_artist):
                    matched_in_grp += 1
                    combined_existing = (
                        existing_fields
                        if combined_existing is None
                        else _combinar_metadata_cancion_word(combined_existing, dict(existing_fields, category="music", append_study_fields=True))
                    )
                    elems_to_remove.extend(body_children[tr["h3_idx"]:tr["end_idx"]])
            if matched_in_grp and matched_in_grp == len(grp["tracks"]):
                first_tr_idx = grp["tracks"][0]["h3_idx"]
                has_other = any(_texto_parrafo_ooxml(body_children[p_i]) for p_i in range(grp["h2_idx"] + 1, first_tr_idx))
                if not has_other:
                    elems_to_remove.extend(body_children[grp["h2_idx"]:first_tr_idx])

        for rm_el in elems_to_remove:
            if rm_el in body:
                body.remove(rm_el)

        merged_entry = _combinar_metadata_cancion_word(combined_existing, entry) if combined_existing is not None else dict(entry)
        toc_range = _encontrar_rango_toc(list(body))
        sec_start, sec_end, items = _buscar_rango_seccion(body, style_levels, "music", toc_range)
        if sec_start is None:
            sec_start = 0

        target_group_heading = _encabezado_grupo_album(merged_entry)
        target_group_key = _clave_grupo_album(target_group_heading)
        groups = _agrupar_musica_desde_items(items, sec_start, sec_end)
        matched_group = next((g for g in groups if g["group_key"] == target_group_key), None)

        if matched_group is None:
            body.insert(sec_end, _crear_parrafo_texto(style_id=estilo_ids["heading_2"], text=target_group_heading, font_size=13, bold_all=True))
            body.insert(sec_end + 1, _w_el("p"))
            toc_range = _encontrar_rango_toc(list(body))
            sec_start, sec_end, items = _buscar_rango_seccion(body, style_levels, "music", toc_range)
            groups = _agrupar_musica_desde_items(items, sec_start or 0, sec_end)
            matched_group = next((g for g in groups if g["group_key"] == target_group_key), None)
        elif len(target_group_heading) > len(matched_group["heading"]):
            _establecer_texto_heading(body[matched_group["h2_idx"]], target_group_heading, 13)

        spec = formatear_entrada_ingles(merged_entry)
        bloque = _construir_bloque_elementos(spec["heading"], estilo_ids["heading_3"], 11.5, spec["lines"])
        if matched_group is None:
            for offset, el in enumerate(bloque):
                body.insert(sec_end + offset, el)
        else:
            new_sort_key = _clave_orden_pista(spec.get("track_number"), merged_entry.get("song_title"))
            insert_at = matched_group["end_idx"]
            for tr in matched_group["tracks"]:
                if _clave_orden_pista(tr.get("track_num"), tr.get("song_key")) > new_sort_key:
                    insert_at = tr["h3_idx"]
                    break
            for offset, el in enumerate(bloque):
                body.insert(insert_at + offset, el)
    else:
        spec = formatear_entrada_ingles(entry)
        toc_range = _encontrar_rango_toc(list(body))
        sec_start, sec_end, items = _buscar_rango_seccion(body, style_levels, spec["category"], toc_range)
        if _bloque_duplicado(items, sec_start, sec_end, spec):
            deduplicated = True
        else:
            bloque = _construir_bloque_elementos(spec["heading"], estilo_ids["heading_2"], 12, spec["lines"])
            for offset, el in enumerate(bloque):
                body.insert(sec_end + offset, el)

    if deduplicated:
        return orig_bytes, {"category": spec["category"], "heading": spec["heading"], "deduplicated": True}

    _normalizar_saltos_pagina(body, style_levels)
    new_doc_bytes = _serializar_documento(doc_root, orig_doc_bytes)

    out_buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(orig_bytes), "r") as zin, zipfile.ZipFile(out_buf, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            payload = new_doc_bytes if info.filename == "word/document.xml" else zin.read(info.filename)
            zout.writestr(info, payload)
    return out_buf.getvalue(), {"category": spec["category"], "heading": spec["heading"], "deduplicated": False}


# ---------------------------------------------------------------------------
# Journal password-protected (.docx) writer & daily verifier via msoffcrypto-tool
# ---------------------------------------------------------------------------

NOTHING_TO_REPORT_TEXT = "Nothing to report."
_JOURNAL_EPOCH_DATE = date(2026, 8, 30)
_JOURNAL_EPOCH_D = 500
_MONTH_NAME_TO_NUM = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sept": 9, "sep": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}
_RE_JOURNAL_DAY_HEADING = re.compile(
    r"^(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|"
    r"September|Sept|Sep|October|Oct|November|Nov|December|Dec)"
    r"\s+(\d{1,2})(?:st|nd|rd|th)?\s+D\s*-\s*(-?\d+)$",
    re.IGNORECASE,
)


def _parse_iso_date(val=None) -> date:
    if val is None:
        return datetime.now().date()
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    return datetime.strptime(str(val)[:10], "%Y-%m-%d").date()


def _es_parrafo_toc_journal(p_elem: ET.Element) -> bool:
    if p_elem.tag != _w_tag("p"):
        return False
    ppr = p_elem.find(_w_tag("pPr"))
    if ppr is not None:
        pstyle = ppr.find(_w_tag("pStyle"))
        if pstyle is not None:
            sid = pstyle.attrib.get(_w_tag("val"), "").strip()
            if re.match(r"^(?:toc\d*|tocheading|tabladecontenido.*)$", sid, re.IGNORECASE):
                return True
    instr_tag = _w_tag("instrText")
    for it in p_elem.iter(instr_tag):
        upper = (it.text or "").upper()
        if "TOC" in upper or "PAGEREF" in upper:
            return True
    return False


def parsear_fecha_encabezado_journal(text: str):
    cleaned = " ".join(str(text or "").split()).strip()
    if not cleaned:
        return None
    m = _RE_JOURNAL_DAY_HEADING.match(cleaned)
    if not m:
        return None
    month_num = _MONTH_NAME_TO_NUM.get(m.group(1).lower())
    if not month_num:
        return None
    try:
        day_num = int(m.group(2))
        d_num = int(m.group(3))
    except ValueError:
        return None
    expected = _JOURNAL_EPOCH_DATE + timedelta(days=_JOURNAL_EPOCH_D - d_num)
    if expected.month == month_num and expected.day == day_num:
        return expected
    try:
        candidate = date(expected.year, month_num, day_num)
        if abs((candidate - expected).days) <= 2:
            return candidate
    except ValueError:
        pass
    return None


def _elemento_tiene_contenido_no_textual(el: ET.Element) -> bool:
    if el.tag == _w_tag("tbl"):
        return True
    for node in el.iter():
        local_name = node.tag.split("}")[-1].lower()
        if local_name in {"drawing", "pict", "object", "imagedata"}:
            return True
    return False


def _es_parrafo_vacio_journal(el: ET.Element) -> bool:
    return (
        el.tag == _w_tag("p")
        and not _texto_parrafo_ooxml(el)
        and not _elemento_tiene_contenido_no_textual(el)
    )


def _extraer_secciones_journal(body: ET.Element) -> list[dict]:
    children = list(body)
    sect_idx = _indice_sectpr(body)
    toc_range = _encontrar_rango_toc(children)
    p_tag = _w_tag("p")

    headings = []
    for idx in range(sect_idx):
        if toc_range and toc_range[0] <= idx < toc_range[1]:
            continue
        el = children[idx]
        if el.tag != p_tag or _es_parrafo_toc_journal(el):
            continue
        txt = _texto_parrafo_ooxml(el)
        dt = parsear_fecha_encabezado_journal(txt)
        if dt is not None:
            headings.append((idx, dt, txt))

    sections = []
    for pos, (start_idx, dt, heading_txt) in enumerate(headings):
        end_idx = headings[pos + 1][0] if pos + 1 < len(headings) else sect_idx
        content_indices = []
        content_texts = []
        has_non_text = False
        for idx in range(start_idx + 1, end_idx):
            if toc_range and toc_range[0] <= idx < toc_range[1]:
                continue
            el = children[idx]
            if el.tag == p_tag and _es_parrafo_toc_journal(el):
                continue
            if _elemento_tiene_contenido_no_textual(el):
                has_non_text = True
            if el.tag == p_tag:
                ptxt = _texto_parrafo_ooxml(el)
                if ptxt:
                    content_indices.append(idx)
                    content_texts.append(ptxt)

        if not content_texts and not has_non_text:
            status = "empty"
        elif (
            not has_non_text
            and all(t.strip().lower() == NOTHING_TO_REPORT_TEXT.lower() for t in content_texts)
        ):
            status = "nothing_to_report"
        else:
            status = "filled"

        sections.append(
            {
                "date": dt,
                "date_iso": dt.isoformat(),
                "heading": heading_txt,
                "start_idx": start_idx,
                "end_idx": end_idx,
                "content_indices": content_indices,
                "content_texts": content_texts,
                "has_non_text": has_non_text,
                "status": status,
            }
        )
    return sections


def _agrupar_estado_por_fecha(sections: list[dict]) -> dict[date, str]:
    priority = {"empty": 0, "nothing_to_report": 1, "filled": 2}
    by_date: dict[date, str] = {}
    for sec in sections:
        dt = sec["date"]
        cur = by_date.get(dt)
        if cur is None or priority[sec["status"]] > priority[cur]:
            by_date[dt] = sec["status"]
    return by_date


def _calcular_dias_faltantes_journal(
    sections: list[dict],
    through_date: date,
    fill_if_empty_doc: bool = False,
    max_days: int = 550,
) -> list[date]:
    if not sections:
        return [through_date] if fill_if_empty_doc else []

    by_date = _agrupar_estado_por_fecha(sections)
    first_date = min(by_date.keys())
    if first_date > through_date:
        return []

    window_start = through_date - timedelta(days=max(1, int(max_days)) - 1)
    scan_start = max(first_date, window_start)
    missing: list[date] = []
    cur = scan_start
    while cur <= through_date:
        status = by_date.get(cur)
        if status is None or status == "empty":
            missing.append(cur)
        cur += timedelta(days=1)
    return missing


def _construir_parrafos_texto_journal(estilo_ids: dict, texto_limpio: str) -> list[ET.Element]:
    out: list[ET.Element] = []
    for line in texto_limpio.split("\n"):
        clean_line = line.rstrip()
        if not clean_line.strip():
            out.append(_w_el("p"))
        else:
            out.append(
                _crear_parrafo_texto(
                    style_id=estilo_ids["normal"],
                    text=clean_line,
                    font_size=11,
                    bold_all=False,
                )
            )
    return out


def _insertar_o_actualizar_dia_en_body(
    body: ET.Element,
    estilo_ids: dict,
    target_date: date,
    text: str,
) -> dict:
    texto_limpio = str(text or "").replace("\r", "").strip()
    if not texto_limpio:
        raise ValueError("Journal text cannot be empty.")

    is_ntr = texto_limpio.lower() == NOTHING_TO_REPORT_TEXT.lower()
    if is_ntr:
        texto_limpio = NOTHING_TO_REPORT_TEXT

    encabezado = calcular_encabezado(target_date)
    sections = _extraer_secciones_journal(body)
    matching = [sec for sec in sections if sec["date"] == target_date]
    entry_elems = _construir_parrafos_texto_journal(estilo_ids, texto_limpio)

    if matching:
        sec = matching[-1]
        if is_ntr:
            if sec["status"] in ("filled", "nothing_to_report"):
                return {
                    "heading": sec["heading"] or encabezado,
                    "skipped": True,
                    "replacedPlaceholder": False,
                }
            insert_at = sec["start_idx"] + 1
            for offset, el in enumerate(entry_elems):
                body.insert(insert_at + offset, el)
            return {
                "heading": sec["heading"] or encabezado,
                "skipped": False,
                "replacedPlaceholder": False,
            }

        if sec["status"] == "nothing_to_report" and sec["content_indices"]:
            first_idx = sec["content_indices"][0]
            children = list(body)
            for idx_rem in reversed(sec["content_indices"]):
                body.remove(children[idx_rem])
            for offset, el in enumerate(entry_elems):
                body.insert(first_idx + offset, el)
            return {
                "heading": sec["heading"] or encabezado,
                "skipped": False,
                "replacedPlaceholder": True,
            }

        if sec["status"] == "empty":
            insert_at = sec["start_idx"] + 1
            for offset, el in enumerate(entry_elems):
                body.insert(insert_at + offset, el)
            return {
                "heading": sec["heading"] or encabezado,
                "skipped": False,
                "replacedPlaceholder": False,
            }

        children = list(body)
        insert_at = sec["end_idx"]
        while insert_at > sec["start_idx"] + 1 and _es_parrafo_vacio_journal(children[insert_at - 1]):
            insert_at -= 1
        to_insert: list[ET.Element] = []
        if insert_at > sec["start_idx"] + 1 and not _es_parrafo_vacio_journal(children[insert_at - 1]):
            to_insert.append(_w_el("p"))
        to_insert.extend(entry_elems)
        for offset, el in enumerate(to_insert):
            body.insert(insert_at + offset, el)
        return {
            "heading": sec["heading"] or encabezado,
            "skipped": False,
            "replacedPlaceholder": False,
        }

    later_sec = next((sec for sec in sections if sec["date"] > target_date), None)
    children = list(body)
    heading_el = _crear_parrafo_texto(
        style_id=estilo_ids["heading_1"],
        text=encabezado,
        font_size=16,
        bold_all=True,
        color="000000",
    )

    if later_sec is not None:
        insert_at = later_sec["start_idx"]
        while insert_at > 0 and _es_parrafo_vacio_journal(children[insert_at - 1]):
            insert_at -= 1
        has_content_before = any(
            not _es_parrafo_vacio_journal(children[i]) for i in range(insert_at)
        )
        new_elems: list[ET.Element] = []
        if has_content_before:
            new_elems.append(_w_el("p"))
        new_elems.append(heading_el)
        new_elems.extend(entry_elems)
        if insert_at == later_sec["start_idx"]:
            new_elems.append(_w_el("p"))
    else:
        insert_at = _indice_sectpr(body)
        has_content_before = any(
            not _es_parrafo_vacio_journal(children[i]) for i in range(insert_at)
        )
        prev_is_blank = insert_at > 0 and _es_parrafo_vacio_journal(children[insert_at - 1])
        new_elems = []
        if has_content_before and not prev_is_blank:
            new_elems.append(_w_el("p"))
        new_elems.append(heading_el)
        new_elems.extend(entry_elems)

    for offset, el in enumerate(new_elems):
        body.insert(insert_at + offset, el)
    return {
        "heading": encabezado,
        "skipped": False,
        "replacedPlaceholder": False,
    }


def _construir_resumen_cobertura(
    sections: list[dict],
    today_dt: date,
    recent_window: int = 14,
) -> dict:
    by_date = _agrupar_estado_por_fecha(sections)
    yesterday_dt = today_dt - timedelta(days=1)
    missing_past = _calcular_dias_faltantes_journal(
        sections, yesterday_dt, fill_if_empty_doc=False
    )

    first_date = min(by_date.keys()) if by_date else None
    last_date = max(by_date.keys()) if by_date else None
    filled_count = sum(1 for st in by_date.values() if st == "filled")
    ntr_count = sum(1 for st in by_date.values() if st == "nothing_to_report")
    empty_count = sum(1 for st in by_date.values() if st == "empty")

    win = max(1, min(30, int(recent_window)))
    if first_date is not None:
        strip_start = max(first_date, today_dt - timedelta(days=win - 1))
        if strip_start > today_dt:
            strip_start = today_dt
    else:
        strip_start = today_dt

    recent_days = []
    cur = strip_start
    while cur <= today_dt:
        st = by_date.get(cur, "missing")
        recent_days.append(
            {
                "dateIso": cur.isoformat(),
                "heading": calcular_encabezado(cur),
                "status": st,
                "isToday": cur == today_dt,
            }
        )
        cur += timedelta(days=1)

    return {
        "todayIso": today_dt.isoformat(),
        "todayHeading": calcular_encabezado(today_dt),
        "todayStatus": by_date.get(today_dt, "missing"),
        "yesterdayIso": yesterday_dt.isoformat(),
        "yesterdayHeading": calcular_encabezado(yesterday_dt),
        "yesterdayStatus": by_date.get(yesterday_dt, "missing"),
        "firstDateIso": first_date.isoformat() if first_date else None,
        "lastDateIso": last_date.isoformat() if last_date else None,
        "totalDaysRecorded": len(by_date),
        "filledCount": filled_count,
        "nothingToReportCount": ntr_count,
        "emptyHeadingCount": empty_count,
        "missingPastDates": [d.isoformat() for d in missing_past],
        "missingPastHeadings": [calcular_encabezado(d) for d in missing_past],
        "allPastDaysFilled": len(missing_past) == 0,
        "recentDays": recent_days,
    }


def inspect_journal_docx_bytes(
    plain_bytes: bytes,
    today_date=None,
    recent_window: int = 14,
) -> dict:
    today_dt = _parse_iso_date(today_date)
    with zipfile.ZipFile(io.BytesIO(plain_bytes), "r") as zin:
        orig_doc_bytes = zin.read("word/document.xml")
    doc_root = ET.fromstring(orig_doc_bytes)
    body = doc_root.find(_w_tag("body"))
    if body is None:
        raise ValueError("word/document.xml sin elemento w:body")
    sections = _extraer_secciones_journal(body)
    return _construir_resumen_cobertura(sections, today_dt, recent_window=recent_window)


def verify_and_backfill_journal_docx_bytes(
    plain_bytes: bytes,
    today_date=None,
    through_date=None,
    fill_if_empty_doc: bool = False,
    max_days: int = 550,
) -> tuple[bytes, dict]:
    today_dt = _parse_iso_date(today_date)
    through_dt = _parse_iso_date(through_date) if through_date is not None else (today_dt - timedelta(days=1))

    with zipfile.ZipFile(io.BytesIO(plain_bytes), "r") as zin:
        estilos = _ooxml_cargar_estilos_mapa(zin)
        orig_doc_bytes = zin.read("word/document.xml")

    estilo_ids = estilos["ids"]
    doc_root = ET.fromstring(orig_doc_bytes)
    body = doc_root.find(_w_tag("body"))
    if body is None:
        raise ValueError("word/document.xml sin elemento w:body")

    sections = _extraer_secciones_journal(body)
    missing_dates = _calcular_dias_faltantes_journal(
        sections,
        through_dt,
        fill_if_empty_doc=fill_if_empty_doc,
        max_days=max_days,
    )

    filled_dates: list[str] = []
    filled_headings: list[str] = []
    for dt in missing_dates:
        res = _insertar_o_actualizar_dia_en_body(body, estilo_ids, dt, NOTHING_TO_REPORT_TEXT)
        if not res["skipped"]:
            filled_dates.append(dt.isoformat())
            filled_headings.append(res["heading"])

    if not filled_dates:
        coverage = _construir_resumen_cobertura(sections, today_dt)
        return plain_bytes, {
            "modified": False,
            "filledDates": [],
            "filledHeadings": [],
            "coverage": coverage,
        }

    new_doc_bytes = _serializar_documento(doc_root, orig_doc_bytes)
    out_buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(plain_bytes), "r") as zin, zipfile.ZipFile(
        out_buf, "w", compression=zipfile.ZIP_DEFLATED
    ) as zout:
        for info in zin.infolist():
            payload = new_doc_bytes if info.filename == "word/document.xml" else zin.read(info.filename)
            zout.writestr(info, payload)

    updated_sections = _extraer_secciones_journal(body)
    coverage = _construir_resumen_cobertura(updated_sections, today_dt)
    return out_buf.getvalue(), {
        "modified": True,
        "filledDates": filled_dates,
        "filledHeadings": filled_headings,
        "coverage": coverage,
    }


def _append_journal_entry_to_docx_bytes(
    plain_bytes: bytes,
    text: str,
    target_date=None,
    backfill_missing_before: bool = True,
) -> tuple[bytes, dict]:
    texto_limpio = str(text or "").replace("\r", "").strip()
    if not texto_limpio:
        raise ValueError("Journal text cannot be empty.")

    target_dt = _parse_iso_date(target_date)
    with zipfile.ZipFile(io.BytesIO(plain_bytes), "r") as zin:
        estilos = _ooxml_cargar_estilos_mapa(zin)
        orig_doc_bytes = zin.read("word/document.xml")

    estilo_ids = estilos["ids"]
    doc_root = ET.fromstring(orig_doc_bytes)
    body = doc_root.find(_w_tag("body"))
    if body is None:
        raise ValueError("word/document.xml sin elemento w:body")

    backfilled_dates: list[str] = []
    backfilled_headings: list[str] = []
    if backfill_missing_before:
        sections_before = _extraer_secciones_journal(body)
        prev_day = target_dt - timedelta(days=1)
        missing_prior = _calcular_dias_faltantes_journal(
            sections_before,
            prev_day,
            fill_if_empty_doc=False,
        )
        for dt in missing_prior:
            bf_res = _insertar_o_actualizar_dia_en_body(
                body, estilo_ids, dt, NOTHING_TO_REPORT_TEXT
            )
            if not bf_res["skipped"]:
                backfilled_dates.append(dt.isoformat())
                backfilled_headings.append(bf_res["heading"])

    main_res = _insertar_o_actualizar_dia_en_body(body, estilo_ids, target_dt, texto_limpio)
    if main_res["skipped"] and not backfilled_dates:
        return plain_bytes, {
            "heading": main_res["heading"],
            "skipped": True,
            "replacedPlaceholder": False,
            "backfilledDates": [],
            "backfilledHeadings": [],
        }

    new_doc_bytes = _serializar_documento(doc_root, orig_doc_bytes)
    out_buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(plain_bytes), "r") as zin, zipfile.ZipFile(
        out_buf, "w", compression=zipfile.ZIP_DEFLATED
    ) as zout:
        for info in zin.infolist():
            payload = new_doc_bytes if info.filename == "word/document.xml" else zin.read(info.filename)
            zout.writestr(info, payload)
    return out_buf.getvalue(), {
        "heading": main_res["heading"],
        "skipped": bool(main_res["skipped"]),
        "replacedPlaceholder": bool(main_res["replacedPlaceholder"]),
        "backfilledDates": backfilled_dates,
        "backfilledHeadings": backfilled_headings,
    }


def _read_encrypted_journal_bytes(target: str, password: str) -> dict:
    try:
        import msoffcrypto
    except ImportError as imp_err:
        return {
            "ok": False,
            "reason": "MSOFFCRYPTO_MISSING",
            "error": f"msoffcrypto-tool not installed: {imp_err}",
        }

    existed = os.path.exists(target) and os.path.getsize(target) > 0
    if not existed:
        return {
            "ok": True,
            "existed": False,
            "was_encrypted": False,
            "raw_bytes": None,
            "plain_bytes": None,
        }

    with open(target, "rb") as fh:
        raw_bytes = fh.read()
    office = msoffcrypto.OfficeFile(io.BytesIO(raw_bytes))
    if office.is_encrypted():
        try:
            office.load_key(password=password, verify_password=True)
        except Exception as pwd_err:
            return {
                "ok": False,
                "reason": "WRONG_PASSWORD",
                "error": f"WORD_PASSWORD rejected by existing Diario.docx: {pwd_err}",
            }
        plain_io = io.BytesIO()
        office.decrypt(plain_io)
        return {
            "ok": True,
            "existed": True,
            "was_encrypted": True,
            "raw_bytes": raw_bytes,
            "plain_bytes": plain_io.getvalue(),
        }

    return {
        "ok": True,
        "existed": True,
        "was_encrypted": False,
        "raw_bytes": raw_bytes,
        "plain_bytes": raw_bytes,
    }


def _encrypt_and_atomic_write_journal(
    target: str,
    password: str,
    updated_plain_bytes: bytes,
    raw_bytes: bytes | None,
    existed: bool,
) -> dict:
    try:
        import msoffcrypto
        from msoffcrypto.format.ooxml import OOXMLFile
    except ImportError as imp_err:
        return {
            "ok": False,
            "reason": "MSOFFCRYPTO_MISSING",
            "error": f"msoffcrypto-tool not installed: {imp_err}",
        }

    parent = os.path.dirname(target)
    if parent:
        os.makedirs(parent, exist_ok=True)
        try:
            os.chmod(parent, 0o700)
        except OSError:
            pass

    enc_io = io.BytesIO()
    OOXMLFile(io.BytesIO(updated_plain_bytes)).encrypt(password, enc_io)
    encrypted_bytes = enc_io.getvalue()

    # Mandatory round-trip decrypt + ZIP XML verification before overwriting disk
    enc_io.seek(0)
    verify_office = msoffcrypto.OfficeFile(enc_io)
    if not verify_office.is_encrypted():
        return {
            "ok": False,
            "reason": "ENCRYPT_VERIFY_FAILED",
            "error": "Output Diario.docx did not report as encrypted.",
        }
    verify_office.load_key(password=password, verify_password=True)
    verify_plain = io.BytesIO()
    verify_office.decrypt(verify_plain)
    verify_plain.seek(0)
    with zipfile.ZipFile(verify_plain, "r") as zchk:
        doc_xml = zchk.read("word/document.xml")
        ET.fromstring(doc_xml)

    if existed and raw_bytes is not None:
        bak_path = f"{target}.bak"
        tmp_bak = f"{bak_path}.tmp.{os.getpid()}"
        fd_bak = os.open(tmp_bak, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            with os.fdopen(fd_bak, "wb") as fb:
                fb.write(raw_bytes)
                fb.flush()
                os.fsync(fb.fileno())
            os.replace(tmp_bak, bak_path)
            os.chmod(bak_path, 0o600)
        except Exception:
            if os.path.exists(tmp_bak):
                os.remove(tmp_bak)

    tmp_target = f"{target}.tmp.{os.getpid()}"
    fd = os.open(tmp_target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "wb") as fout:
            fout.write(encrypted_bytes)
            fout.flush()
            os.fsync(fout.fileno())
        os.replace(tmp_target, target)
        os.chmod(target, 0o600)
    finally:
        if os.path.exists(tmp_target):
            try:
                os.remove(tmp_target)
            except OSError:
                pass

    return {"ok": True, "bytes": len(encrypted_bytes)}


def write_encrypted_journal_docx(
    docx_path: str,
    password: str,
    text: str,
    target_date=None,
    backfill_missing_before: bool = True,
) -> dict:
    if not password:
        return {
            "ok": False,
            "reason": "PASSWORD_MISSING",
            "error": "WORD_PASSWORD is required for local encrypted Journal.",
        }

    target = os.path.abspath(docx_path)
    read_res = _read_encrypted_journal_bytes(target, password)
    if not read_res.get("ok"):
        return read_res

    existed = read_res["existed"]
    was_encrypted = read_res["was_encrypted"]
    raw_bytes = read_res["raw_bytes"]
    plain_bytes = read_res["plain_bytes"] or _build_minimal_docx_bytes(mode="journal")

    target_dt = _parse_iso_date(target_date)
    updated_plain_bytes, meta = _append_journal_entry_to_docx_bytes(
        plain_bytes,
        text,
        target_date=target_dt,
        backfill_missing_before=backfill_missing_before,
    )
    coverage = inspect_journal_docx_bytes(updated_plain_bytes, today_date=target_dt)

    if meta.get("skipped") and not meta.get("backfilledDates") and existed and was_encrypted:
        return {
            "ok": True,
            "skipped": True,
            "replacedPlaceholder": False,
            "backfilledDates": [],
            "backfilledHeadings": [],
            "encrypted": True,
            "heading": meta["heading"],
            "coverage": coverage,
            "path": target,
        }

    write_res = _encrypt_and_atomic_write_journal(
        target, password, updated_plain_bytes, raw_bytes, existed
    )
    if not write_res.get("ok"):
        return write_res

    return {
        "ok": True,
        "skipped": bool(meta.get("skipped")),
        "replacedPlaceholder": bool(meta.get("replacedPlaceholder")),
        "backfilledDates": meta.get("backfilledDates") or [],
        "backfilledHeadings": meta.get("backfilledHeadings") or [],
        "encrypted": True,
        "heading": meta["heading"],
        "bytes": write_res["bytes"],
        "coverage": coverage,
        "path": target,
    }


def inspect_encrypted_journal_docx(
    docx_path: str,
    password: str,
    today_date=None,
) -> dict:
    if not password:
        return {
            "ok": False,
            "reason": "PASSWORD_MISSING",
            "error": "WORD_PASSWORD is required to inspect local encrypted Journal.",
        }

    target = os.path.abspath(docx_path)
    read_res = _read_encrypted_journal_bytes(target, password)
    if not read_res.get("ok"):
        return read_res

    today_dt = _parse_iso_date(today_date)
    if not read_res["existed"]:
        return {
            "ok": True,
            "exists": False,
            "encrypted": False,
            "path": target,
            "coverage": _construir_resumen_cobertura([], today_dt),
        }

    coverage = inspect_journal_docx_bytes(read_res["plain_bytes"], today_date=today_dt)
    return {
        "ok": True,
        "exists": True,
        "encrypted": bool(read_res["was_encrypted"]),
        "path": target,
        "coverage": coverage,
    }


def verify_encrypted_journal_docx(
    docx_path: str,
    password: str,
    today_date=None,
    through_date=None,
    create_if_missing: bool = False,
    fill_if_empty_doc: bool = False,
) -> dict:
    if not password:
        return {
            "ok": False,
            "reason": "PASSWORD_MISSING",
            "error": "WORD_PASSWORD is required to verify local encrypted Journal.",
        }

    target = os.path.abspath(docx_path)
    read_res = _read_encrypted_journal_bytes(target, password)
    if not read_res.get("ok"):
        return read_res

    today_dt = _parse_iso_date(today_date)
    existed = read_res["existed"]
    if not existed and not create_if_missing:
        return {
            "ok": True,
            "exists": False,
            "encrypted": False,
            "modified": False,
            "filledDates": [],
            "filledHeadings": [],
            "path": target,
            "coverage": _construir_resumen_cobertura([], today_dt),
        }

    plain_bytes = read_res["plain_bytes"] or _build_minimal_docx_bytes(mode="journal")
    updated_plain_bytes, meta = verify_and_backfill_journal_docx_bytes(
        plain_bytes,
        today_date=today_dt,
        through_date=through_date,
        fill_if_empty_doc=fill_if_empty_doc,
    )

    if not meta["modified"] and existed and read_res["was_encrypted"]:
        return {
            "ok": True,
            "exists": True,
            "encrypted": True,
            "modified": False,
            "filledDates": [],
            "filledHeadings": [],
            "path": target,
            "coverage": meta["coverage"],
        }

    if not meta["modified"] and not existed:
        return {
            "ok": True,
            "exists": False,
            "encrypted": False,
            "modified": False,
            "filledDates": [],
            "filledHeadings": [],
            "path": target,
            "coverage": meta["coverage"],
        }

    write_res = _encrypt_and_atomic_write_journal(
        target, password, updated_plain_bytes, read_res["raw_bytes"], existed
    )
    if not write_res.get("ok"):
        return write_res

    return {
        "ok": True,
        "exists": True,
        "encrypted": True,
        "modified": bool(meta["modified"]),
        "filledDates": meta["filledDates"],
        "filledHeadings": meta["filledHeadings"],
        "bytes": write_res["bytes"],
        "path": target,
        "coverage": meta["coverage"],
    }


def main() -> int:
    if hasattr(sys.stdin, "reconfigure"):
        try:
            sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    mode = ""
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == "--mode" and i + 1 < len(args):
            mode = args[i + 1].strip().lower()
    if mode not in ("english", "journal", "journal-inspect", "journal-verify"):
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": "INVALID_MODE",
                    "error": "Use --mode english|journal|journal-inspect|journal-verify",
                }
            )
        )
        return 2

    try:
        raw_stdin = sys.stdin.buffer.read().decode("utf-8") if hasattr(sys.stdin, "buffer") else sys.stdin.read()
        payload = json.loads(raw_stdin or "{}")
    except Exception as exc:
        print(json.dumps({"ok": False, "reason": "INVALID_JSON", "error": str(exc)}))
        return 1

    try:
        if mode == "english":
            docx_path = os.path.abspath(str(payload.get("docxPath") or ""))
            if not docx_path:
                raise ValueError("Missing docxPath")
            orig = None
            if os.path.exists(docx_path) and os.path.getsize(docx_path) > 0:
                with open(docx_path, "rb") as fh:
                    orig = fh.read()
            new_bytes, meta = update_english_docx_bytes(orig, payload.get("entry"))
            os.makedirs(os.path.dirname(docx_path), exist_ok=True)
            tmp_out = f"{docx_path}.tmp.{os.getpid()}"
            with open(tmp_out, "wb") as fout:
                fout.write(new_bytes)
                fout.flush()
            os.replace(tmp_out, docx_path)
            print(json.dumps({"ok": True, "bytes": len(new_bytes), **meta}, ensure_ascii=True))
            return 0

        if mode == "journal-inspect":
            res = inspect_encrypted_journal_docx(
                docx_path=str(payload.get("docxPath") or ""),
                password=str(payload.get("password") or ""),
                today_date=payload.get("todayIso") or None,
            )
            print(json.dumps(res, ensure_ascii=True))
            return 0 if res.get("ok") else 1

        if mode == "journal-verify":
            res = verify_encrypted_journal_docx(
                docx_path=str(payload.get("docxPath") or ""),
                password=str(payload.get("password") or ""),
                today_date=payload.get("todayIso") or None,
                through_date=payload.get("throughDateIso") or None,
                create_if_missing=bool(payload.get("createIfMissing", False)),
                fill_if_empty_doc=bool(payload.get("fillIfEmptyDoc", False)),
            )
            print(json.dumps(res, ensure_ascii=True))
            return 0 if res.get("ok") else 1

        res = write_encrypted_journal_docx(
            docx_path=str(payload.get("docxPath") or ""),
            password=str(payload.get("password") or ""),
            text=str(payload.get("text") or ""),
            target_date=payload.get("targetDateIso") or None,
            backfill_missing_before=bool(payload.get("backfillMissingBefore", True)),
        )
        print(json.dumps(res, ensure_ascii=True))
        return 0 if res.get("ok") else 1
    except Exception as exc:
        print(json.dumps({"ok": False, "reason": "RUNTIME_ERROR", "error": str(exc)}, ensure_ascii=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
