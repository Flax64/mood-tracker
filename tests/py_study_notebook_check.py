# -*- coding: utf-8 -*-
"""Prueba E2E (sin Word ni red): dedup OOXML, sección Notas manuales y visor de solo lectura."""
import io
import json
import os
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "sincronitation"))
import sincronizador as s  # noqa: E402

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
STYLES = (
    f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="{W}">'
    + "".join(
        f'<w:style w:type="paragraph" w:styleId="Heading{i}"><w:name w:val="heading {i}"/></w:style>'
        for i in (1, 2, 3)
    )
    + "</w:styles>"
)
DOC = (
    f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{W}"><w:body>'
    f'<w:sectPr/></w:body></w:document>'
)


def make_docx(path):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("word/document.xml", DOC)
        z.writestr("word/styles.xml", STYLES)


def main():
    tmp = tempfile.mkdtemp()
    docx = os.path.join(tmp, "English_Learning_Notebook.docx")
    make_docx(docx)
    s.sincronizar_word_estudio_a_drive = lambda *a, **k: True  # sin red

    vocab = {"category": "vocabulary", "language": "English", "word": "drip", "part_of_speech": "noun", "spanish": "goteo"}
    note = s.parsear_entrada_ingles(json.dumps({"category": "notes", "title": "Regla", "notes": "Present perfect = have + participio"}))
    note2 = s.parsear_entrada_ingles(json.dumps({"category": "notes", "title": "Regla", "notes": "Otra regla distinta"}))
    song = {"category": "music", "language": "English + Korean", "song_title": "Drip", "artists_display": "BABYMONSTER",
            "album_title": "Drip", "album_type": "Album", "release_year": "2024", "track_number": 1,
            "lyrics_study": "[EN]\nBaby got that drip\n\n[KO]\n안녕하세요"}
    song_es = dict(song, lyrics_study="=== [ES — Traducción IA] ===\nBebé tiene ese estilo")
    song_en_only = dict(song, lyrics_study="[EN]\nBaby got that drip")

    for e in (vocab, vocab, note, note, note2, song, song_es, song_en_only, song_es):
        assert s._guardar_entrada_ingles_en_docx_xml(docx, e) is True

    res = s.leer_cuaderno_estudio_word({}, ruta_docx=docx)
    assert res["ok"], res
    assert res["counts"]["vocabulary"] == 1, res["counts"]   # sin duplicar vocab
    assert res["counts"]["notes"] == 2, res["counts"]        # misma nota omitida; distinta contenido sí
    assert res["counts"]["music"] == 1, res["counts"]        # una sola pista
    track = next(e for e in res["entries"] if e["section"] == "music")
    lyr = track["fields"]["lyrics_study"]
    assert lyr.count("[EN]") == 1 and "안녕하세요" in lyr and "Bebé tiene ese estilo" in lyr, lyr
    assert lyr.count("Traducción IA") == 1, lyr

    filt = s.leer_cuaderno_estudio_word({"section": "music", "artist": "babymonster"}, ruta_docx=docx)
    assert filt["total"] == 1 and "BABYMONSTER" in " ".join(filt["facets"]["artists"]), filt
    none = s.leer_cuaderno_estudio_word({"q": "inexistente"}, ruta_docx=docx)
    assert none["total"] == 0
    check_drive_pull(tmp, docx)
    print("OK")


def check_drive_pull(tmp, docx):
    """Drive -> PC: pulled / noop / conflict / deferred, sin red ni rclone."""
    import base64
    import hashlib

    s._ENGLISH_WORD_DRIVE_STATE_PATH = os.path.join(tmp, "state.json")
    s.resolver_rutas_word = lambda *a, **k: (None, docx)
    s.obtener_url_aws = lambda ep="": "http://x" + ep
    s._firmar_pc_request = lambda *a, **k: {}
    remote = {"bytes": b"", "mod": "t1"}

    class Resp:
        def __init__(self, payload):
            self.status_code, self._p = 200, payload

        def json(self):
            return self._p

    class Sess:
        def get(self, url, **kw):
            meta = {"ok": True, "exists": True, "remoteTarget": "r:x", "remoteSize": len(remote["bytes"]),
                    "remoteModTime": remote["mod"]}
            if "download=1" in url:
                meta["docxB64"] = base64.b64encode(remote["bytes"]).decode()
            return Resp(meta)

    s._get_http_session = lambda: Sess()
    sha = lambda b: hashlib.sha256(b).hexdigest()
    local = open(docx, "rb").read()

    # 1) Local sin cambios desde la última sync + Drive nuevo => pulled
    s._guardar_ultimo_hash_word_drive(sha(local), "r:x", len(local), True, "t0")
    remote["bytes"] = local + b"\x00" * 10  # contenido distinto (ZIP con relleno)
    assert s._sincronizar_word_desde_drive(force=True) == "pulled"
    assert open(docx, "rb").read() == remote["bytes"]
    # 2) Segunda consulta con mismo remoto => noop
    assert s._sincronizar_word_desde_drive(force=True) == "noop"
    # 3) Ambos cambiaron => conflict, el local se conserva
    mine = open(docx, "rb").read() + b"\x01" * 5
    open(docx, "wb").write(mine)
    remote["bytes"], remote["mod"] = mine + b"\x02" * 7, "t2"
    assert s._sincronizar_word_desde_drive(force=True) == "conflict"
    assert open(docx, "rb").read() == mine
    assert any("drive-conflict" in f for f in os.listdir(tmp))
    # 4) Word abierto (~$) => deferred sin tocar el local
    s._guardar_ultimo_hash_word_drive(sha(mine), "r:x", 1, True, "t2")
    remote["bytes"], remote["mod"] = b"PK" + b"\x03" * 80, "t3"
    lock = os.path.join(tmp, "~$glish_Learning_Notebook.docx")
    open(lock, "w").close()
    assert s._sincronizar_word_desde_drive(force=True) == "deferred"
    assert open(docx, "rb").read() == mine
    os.remove(lock)
    print("DRIVE OK")

    # 5) Limpieza de ruido, etiquetas no-idioma ([Intro]/[Rap]), deduplicación ES y consolidación
    limpia = s._limpiar_ruido_letra("[음악]\n[Intro]\n[Rap]\nHello world\n[\n[歌]\n[音楽]")
    assert "[음악]" not in limpia and "[音楽]" not in limpia and "[歌]" not in limpia, limpia
    assert "[Intro]" in limpia and "[Rap]" in limpia and "Hello world" in limpia, limpia

    comb = s._combinar_letra_por_idiomas(
        "[Intro]\nLine A\n[Rap]\nLine B",
        "=== [ES — Traducción IA] ===\nLínea A\nLínea B",
    )
    assert "[Intro]" in comb and "Line A" in comb and "=== [ES — Traducción IA] ===" in comb, comb

    clean_notes = s._limpiar_notas_redundantes_cancion(
        "Vocab note line\n\n[Traducción ES — Gemini IA]\nLínea A\nLínea B",
        comb,
    )
    assert clean_notes == "Vocab note line", clean_notes

    open(docx, "wb").write(local)
    res_consolidar = s.consolidar_y_deduplicar_cuaderno_word(docx)
    assert res_consolidar.get("ok") is True, res_consolidar
    res_read = s.leer_cuaderno_estudio_word({"section": "music", "limit": 50}, ruta_docx=docx)
    assert res_read.get("ok") is True and "songs" in res_read.get("facets", {}), res_read

    five = s._extraer_cinco_apartados_desde_letra(
        "[ORIGINAL]\nBaby got no chill\n눈을 감고 느껴봐\n\n[KO]\nBaby got no chill\n눈을 감고 느껴봐\n\n[EN]\nClose your eyes\n\n[JA]\n目を閉じて感じて\n\n[ES]\nCierra los ojos"
    )
    assert "Baby got no chill" in five["original"] and "눈을 감고 느껴봐" in five["original"], five
    assert five["ko"] == "눈을 감고 느껴봐", five
    assert five["en"] == "Close your eyes" and five["ja"] == "目を閉じて感じて" and five["es"] == "Cierra los ojos", five


if __name__ == "__main__":
    main()
