import os
import sys
import json
import ctypes

try:
    from ctypes import wintypes
except (ImportError, ValueError):
    wintypes = None
import hashlib
import hmac
import getpass
import re
import stat
import subprocess
import queue
import threading
import urllib.parse
import zipfile
import xml.etree.ElementTree as ET
import requests

try:
    import win32com.client
except ImportError:
    win32com = None
import time
import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime, timedelta

try:
    import pythoncom
except ImportError:
    pythoncom = None

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

# Librerías de Encriptación
from Crypto.Cipher import AES
import base64
import binascii

_word_com_lock = threading.Lock()
_english_docx_lock = threading.Lock()
_pending_queue_lock = threading.Lock()
_sync_wake_event = threading.Event()
_SYNC_POLL_INTERVAL_SECONDS = 8
_SYNC_LONG_POLL_MS = 20000
_WORD_COM_TIMEOUT_SECONDS = 35
_HTTP_SESSION = requests.Session()
_http_thread_local = threading.local()
_pc_job_semaphore = threading.Semaphore(2)
_pc_word_write_queue = queue.Queue()
_pc_word_writer_lock = threading.Lock()
_pc_word_writer_started = False
_recent_lyrics_lock = threading.Lock()
_RECENT_EXTRACTED_CACHE = {}


def _get_http_session():
    """Devuelve una sesión HTTP dedicada por hilo para evitar bloqueos/carreras al hacer long-polling concurrente."""
    sess = getattr(_http_thread_local, "session", None)
    if sess is None:
        sess = requests.Session()
        _http_thread_local.session = sess
    return sess


# Configuración del archivo de registros (Logs)
LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "historial.log")
LAST_HOST_CACHE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".last_ec2_host.json"
)
LAST_WORD_PATHS_CACHE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".last_word_paths.json"
)
PENDING_QUEUE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".pending_e2ee_queue.json"
)


def _instalar_excepthook():
    def _log_uncaught(exc_type, exc_value, exc_tb):
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_tb)
            return
        logging.critical(
            "Error fatal no capturado en sincronizador.py",
            exc_info=(exc_type, exc_value, exc_tb),
        )
        try:
            sys.__excepthook__(exc_type, exc_value, exc_tb)
        except Exception:
            pass

    sys.excepthook = _log_uncaught


def inicializar_logging():
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for existing in list(root.handlers):
        root.removeHandler(existing)
        try:
            existing.close()
        except Exception:
            pass

    formatter = logging.Formatter(
        "%(asctime)s - %(levelname)s - %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )
    file_handler = RotatingFileHandler(
        LOG_PATH, maxBytes=1024 * 1024, backupCount=3, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    # En pythonw.exe sys.stdout puede ser None
    if sys.stdout is not None:
        stream_handler = logging.StreamHandler(sys.stdout)
        stream_handler.setFormatter(formatter)
        root.addHandler(stream_handler)

    _instalar_excepthook()


_DPAPI_ENTROPY = b"mood-tracker-local-vault-v1"
_CRYPTPROTECT_UI_FORBIDDEN = 0x1


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


def _bytes_to_blob(data_bytes):
    if not data_bytes:
        return _DATA_BLOB(0, None), None
    arr = (ctypes.c_ubyte * len(data_bytes)).from_buffer_copy(data_bytes)
    return (
        _DATA_BLOB(len(data_bytes), ctypes.cast(arr, ctypes.POINTER(ctypes.c_ubyte))),
        arr,
    )


def _dpapi_protect(plain_text):
    raw_bytes = plain_text.encode("utf-8")
    in_blob, _in_ref = _bytes_to_blob(raw_bytes)
    ent_blob, _ent_ref = _bytes_to_blob(_DPAPI_ENTROPY)
    out_blob = _DATA_BLOB()

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    crypt32.CryptProtectData.argtypes = [
        ctypes.POINTER(_DATA_BLOB),
        ctypes.c_wchar_p,
        ctypes.POINTER(_DATA_BLOB),
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(_DATA_BLOB),
    ]
    crypt32.CryptProtectData.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
    kernel32.LocalFree.restype = wintypes.HLOCAL

    ok = crypt32.CryptProtectData(
        ctypes.byref(in_blob),
        "MoodTrackerVault",
        ctypes.byref(ent_blob),
        None,
        None,
        _CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(out_blob),
    )
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        if out_blob.pbData:
            kernel32.LocalFree(out_blob.pbData)


def _dpapi_unprotect(cipher_bytes):
    in_blob, _in_ref = _bytes_to_blob(cipher_bytes)
    ent_blob, _ent_ref = _bytes_to_blob(_DPAPI_ENTROPY)
    out_blob = _DATA_BLOB()

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    crypt32.CryptUnprotectData.argtypes = [
        ctypes.POINTER(_DATA_BLOB),
        ctypes.POINTER(ctypes.c_wchar_p),
        ctypes.POINTER(_DATA_BLOB),
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(_DATA_BLOB),
    ]
    crypt32.CryptUnprotectData.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
    kernel32.LocalFree.restype = wintypes.HLOCAL

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
        raise ctypes.WinError()
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData).decode("utf-8")
    finally:
        if out_blob.pbData:
            kernel32.LocalFree(out_blob.pbData)


def _ruta_dpapi_vault():
    custom = os.environ.get("MOOD_DPAPI_VAULT_PATH", "").strip()
    if custom:
        return custom
    local_app = os.environ.get("LOCALAPPDATA", "").strip()
    if local_app:
        return os.path.join(local_app, "mood-tracker", "vault.dpapi")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), ".vault.dpapi")


def _guardar_dpapi_password(password):
    ruta = _ruta_dpapi_vault()
    os.makedirs(os.path.dirname(os.path.abspath(ruta)), exist_ok=True)
    protegido = _dpapi_protect(password)
    tmp = f"{ruta}.tmp.{os.getpid()}"
    with open(tmp, "wb") as fh:
        fh.write(protegido)
    os.replace(tmp, ruta)
    return ruta


def _leer_dpapi_password():
    ruta = _ruta_dpapi_vault()
    if not os.path.exists(ruta):
        return None
    with open(ruta, "rb") as fh:
        datos = fh.read()
    if not datos:
        return None
    return _dpapi_unprotect(datos)


def _eliminar_dpapi_password():
    ruta = _ruta_dpapi_vault()
    if os.path.exists(ruta):
        size = os.path.getsize(ruta)
        if size > 0:
            with open(ruta, "r+b") as fh:
                fh.write(b"\x00" * size)
                fh.flush()
        os.remove(ruta)
        return True, ruta
    return False, ruta


def _descifrar_vault_bytes(raw_bytes, password):
    if len(raw_bytes) < 32 or raw_bytes[:8] != b"Salted__":
        raise RuntimeError("Formato de .env.enc inválido o corrupto.")
    salt = raw_bytes[8:16]
    payload = raw_bytes[16:]
    if len(payload) == 0 or len(payload) % 16 != 0:
        raise RuntimeError("Archivo .env.enc truncado o corrupto.")
    key_iv = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, 600000, dklen=48
    )
    cipher = AES.new(key_iv[:32], AES.MODE_CBC, key_iv[32:48])
    decrypted = cipher.decrypt(payload)
    pad_len = decrypted[-1]
    if (
        pad_len < 1
        or pad_len > 16
        or decrypted[-pad_len:] != bytes([pad_len]) * pad_len
    ):
        raise RuntimeError("Contraseña incorrecta o archivo .env.enc corrupto.")
    try:
        return decrypted[:-pad_len].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError(
            "Contraseña incorrecta o archivo .env.enc corrupto."
        ) from exc


def _parsear_y_cargar_env(contenido):
    env_vars = {}
    for raw_line in contenido.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        env_vars[key] = value
        os.environ.setdefault(key, value)
    return env_vars


def _pedir_password_consola(prompt, permitir_stdin_plano=False):
    if sys.stdin is not None and getattr(sys.stdin, "isatty", lambda: False)():
        return getpass.getpass(prompt)
    if permitir_stdin_plano and sys.stdin is not None:
        if sys.stdout is not None:
            sys.stdout.write(f"{prompt}(sin TTY detectado; o usa winpty): ")
            sys.stdout.flush()
        linea = sys.stdin.readline()
        return linea.rstrip("\r\n") if linea else ""
    return None


def cargar_env():
    """Carga variables desde .env o descifra .env.enc solo en RAM sin escribir en disco."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_path = os.path.join(base_dir, ".env")
    enc_path = os.path.join(base_dir, ".env.enc")

    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            return _parsear_y_cargar_env(f.read())

    if os.path.exists(enc_path):
        # Si ya fueron inyectadas en memoria por local-vault.js run, no vuelve a pedir contraseña
        if os.environ.get("JOURNAL_SECRET_KEY") and (
            os.environ.get("WORD_FILE_PATH")
            or (os.environ.get("GITHUB_TOKEN") and os.environ.get("GITHUB_REPO"))
        ):
            return {}

        with open(enc_path, "rb") as f:
            raw_enc = f.read()

        password = os.environ.get("MOOD_ENV_PASS")
        if password is not None:
            if not password:
                raise RuntimeError("MOOD_ENV_PASS está vacía.")
            return _parsear_y_cargar_env(_descifrar_vault_bytes(raw_enc, password))

        try:
            dpapi_pass = _leer_dpapi_password()
        except Exception as exc:
            logging.error(f"No se pudo leer la clave protegida DPAPI: {exc}")
            dpapi_pass = None

        if dpapi_pass:
            try:
                return _parsear_y_cargar_env(
                    _descifrar_vault_bytes(raw_enc, dpapi_pass)
                )
            except RuntimeError as exc:
                logging.error(
                    f"La clave de autoinicio DPAPI no coincide con .env.enc actual: {exc}"
                )

        password = _pedir_password_consola("Contraseña maestra para .env.enc: ")
        if password is None:
            msg = (
                "No hay consola interactiva ni autoinicio DPAPI válido para descifrar .env.enc. "
                "Ejecuta una vez: python sincronitation/sincronizador.py --configurar-autoinicio"
            )
            logging.error(msg)
            raise RuntimeError(msg)
        if not password:
            raise RuntimeError("La contraseña de .env.enc no puede estar vacía.")
        return _parsear_y_cargar_env(_descifrar_vault_bytes(raw_enc, password))

    return {}


BASE_PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ENGLISH_WORD_PATH = os.path.join(
    BASE_PROJECT_DIR, "english-notes", "English_Learning_Notebook.docx"
)

ENV_CONFIG = {}
RUTA_WORD = ""
RUTA_WORD_ENGLISH = DEFAULT_ENGLISH_WORD_PATH
PASSWORD = ""
LLAVE_SECRETA = b""


def inicializar_entorno():
    global ENV_CONFIG, RUTA_WORD, RUTA_WORD_ENGLISH, PASSWORD, LLAVE_SECRETA
    ENV_CONFIG = cargar_env()
    PASSWORD = os.environ.get("WORD_PASSWORD", "")
    llave_raw = os.environ.get("JOURNAL_SECRET_KEY", "").strip()

    ruta_word_resuelta, ruta_eng_resuelta = resolver_rutas_word(refresh_cache=False)
    if (
        not ruta_word_resuelta
        and os.environ.get("GITHUB_TOKEN", "").strip()
        and os.environ.get("GITHUB_REPO", "").strip()
    ):
        ruta_word_resuelta, ruta_eng_resuelta = resolver_rutas_word(refresh_cache=True)

    RUTA_WORD = ruta_word_resuelta
    RUTA_WORD_ENGLISH = ruta_eng_resuelta or DEFAULT_ENGLISH_WORD_PATH

    if not RUTA_WORD or not PASSWORD or len(llave_raw.encode("utf-8")) != 32:
        msg = "Verifica WORD_FILE_PATH (.env / GitHub Variable), WORD_PASSWORD y JOURNAL_SECRET_KEY (32 bytes)"
        logging.error(msg)
        raise RuntimeError(msg)

    LLAVE_SECRETA = llave_raw.encode("utf-8")


def configurar_autoinicio():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    enc_path = os.path.join(base_dir, ".env.enc")
    if not os.path.exists(enc_path):
        raise RuntimeError(
            "No se encontró .env.enc en la raíz del proyecto. "
            "Cifra primero tu .env con: node scripts/local-vault.js encrypt"
        )

    password = os.environ.get("MOOD_ENV_PASS")
    if password is None:
        password = _pedir_password_consola(
            "Contraseña maestra actual de .env.enc: ",
            permitir_stdin_plano=True,
        )
    if not password:
        raise RuntimeError("La contraseña no puede estar vacía.")

    with open(enc_path, "rb") as fh:
        raw_enc = fh.read()
    contenido = _descifrar_vault_bytes(raw_enc, password)
    vars_env = _parsear_y_cargar_env(contenido)
    if not vars_env.get("JOURNAL_SECRET_KEY") or (
        not vars_env.get("WORD_FILE_PATH")
        and not (vars_env.get("GITHUB_TOKEN") and vars_env.get("GITHUB_REPO"))
    ):
        raise RuntimeError(
            ".env.enc se descifró pero falta JOURNAL_SECRET_KEY o la fuente de WORD_FILE_PATH (.env / GITHUB_TOKEN+GITHUB_REPO)."
        )

    ruta = _guardar_dpapi_password(password)
    verificada = _leer_dpapi_password()
    if verificada != password:
        raise RuntimeError("Falló la verificación interna DPAPI tras guardar la clave.")

    print(f"[OK] Autoinicio Windows DPAPI configurado en: {ruta}")
    print("Tu contraseña quedó protegida únicamente para tu usuario actual de Windows.")


_github_cache = {
    "host": None,
    "port": None,
    "fetched_at": 0.0,
    "last_error": None,
    "last_ec2_error": None,
    "disk_loaded": False,
}
GITHUB_CACHE_TTL_SECONDS = 300


def _cargar_host_cache_disco():
    if _github_cache["disk_loaded"]:
        return
    _github_cache["disk_loaded"] = True
    try:
        if os.path.exists(LAST_HOST_CACHE_PATH):
            with open(LAST_HOST_CACHE_PATH, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            host = str(data.get("host") or "").strip()
            port = str(data.get("port") or "").strip()
            if host and not _github_cache["host"]:
                _github_cache["host"] = host
                _github_cache["port"] = port or "3000"
    except Exception:
        pass


def _guardar_host_cache_disco(host, port):
    try:
        tmp = f"{LAST_HOST_CACHE_PATH}.tmp.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "host": host,
                    "port": str(port or "3000"),
                    "updated_at": datetime.now().isoformat(),
                },
                fh,
            )
        os.replace(tmp, LAST_HOST_CACHE_PATH)
    except Exception:
        pass


def _leer_variable_github(repo, token, nombre_var):
    resp = requests.get(
        f"https://api.github.com/repos/{repo}/actions/variables/{nombre_var}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout=5,
    )
    if resp.status_code == 200:
        return resp.json().get("value", "").strip(), None
    if resp.status_code == 404:
        return None, f"Variable '{nombre_var}' no encontrada en GitHub ({repo})"
    return None, f"GitHub API HTTP {resp.status_code} al consultar '{nombre_var}'"


def invalidar_cache_github():
    _github_cache["fetched_at"] = 0.0
    _word_paths_cache["fetched_at"] = 0.0


_word_paths_cache = {
    "journal": None,
    "english": None,
    "fetched_at": 0.0,
    "last_error": None,
    "disk_loaded": False,
}


def _es_github_var_no_encontrada(err):
    texto = str(err or "").lower()
    return "no encontrada" in texto or "404" in texto


def _normalizar_ruta_word_candidata(raw_path, default_filename):
    cleaned = str(raw_path or "").strip().strip('"').strip("'").strip()
    if not cleaned:
        return ""
    ends_with_sep = cleaned.endswith("/") or cleaned.endswith("\\")
    expanded = os.path.expanduser(os.path.expandvars(cleaned))
    if ends_with_sep or os.path.isdir(expanded) or not os.path.splitext(expanded)[1]:
        return os.path.abspath(os.path.join(expanded, default_filename))
    return os.path.abspath(expanded)


def _cargar_word_paths_cache_disco():
    if _word_paths_cache["disk_loaded"]:
        return
    _word_paths_cache["disk_loaded"] = True
    try:
        if os.path.exists(LAST_WORD_PATHS_CACHE_PATH):
            with open(LAST_WORD_PATHS_CACHE_PATH, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            journal = str(data.get("journal") or "").strip()
            english = str(data.get("english") or "").strip()
            if journal and not _word_paths_cache["journal"]:
                _word_paths_cache["journal"] = journal
            if english and not _word_paths_cache["english"]:
                _word_paths_cache["english"] = english
    except Exception:
        pass


def _guardar_word_paths_cache_disco(journal_path, english_path):
    try:
        tmp = f"{LAST_WORD_PATHS_CACHE_PATH}.tmp.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "journal": journal_path or "",
                    "english": english_path or "",
                    "updated_at": datetime.now().isoformat(),
                },
                fh,
            )
        os.replace(tmp, LAST_WORD_PATHS_CACHE_PATH)
    except Exception:
        pass


def resolver_rutas_word(refresh_cache=False):
    """Resuelve rutas de Journal y English Notebook desde GitHub Variables o .env."""
    global RUTA_WORD, RUTA_WORD_ENGLISH

    raw_env_j = os.environ.get("WORD_FILE_PATH", "").strip()
    raw_env_e = os.environ.get("ENGLISH_WORD_FILE_PATH", "").strip()
    default_j_name = (
        os.path.basename(raw_env_j)
        if raw_env_j and os.path.splitext(raw_env_j)[1]
        else (os.path.basename(RUTA_WORD) if RUTA_WORD else "Journal.docx")
    )
    default_e_name = (
        os.path.basename(raw_env_e)
        if raw_env_e and os.path.splitext(raw_env_e)[1]
        else "English_Learning_Notebook.docx"
    )
    env_j = (
        _normalizar_ruta_word_candidata(raw_env_j, default_j_name) if raw_env_j else ""
    )
    env_e = (
        _normalizar_ruta_word_candidata(raw_env_e, default_e_name) if raw_env_e else ""
    )

    github_repo = os.environ.get("GITHUB_REPO", "Flax64/mood-tracker").strip()
    github_token = os.environ.get("GITHUB_TOKEN", "").strip()

    if github_repo and github_token:
        _cargar_word_paths_cache_disco()
        ahora_ts = time.time()
        if (
            refresh_cache
            or (ahora_ts - _word_paths_cache["fetched_at"]) >= GITHUB_CACHE_TTL_SECONDS
        ):
            try:
                val_j, err_j = _leer_variable_github(
                    github_repo, github_token, "WORD_FILE_PATH"
                )
                val_e, err_e = _leer_variable_github(
                    github_repo, github_token, "ENGLISH_WORD_FILE_PATH"
                )

                if val_j:
                    norm_j = _normalizar_ruta_word_candidata(val_j, default_j_name)
                    if norm_j != _word_paths_cache["journal"]:
                        logging.info(
                            f"Ruta Journal Word actualizada desde GitHub Variable WORD_FILE_PATH: {norm_j}"
                        )
                    _word_paths_cache["journal"] = norm_j
                elif _es_github_var_no_encontrada(err_j):
                    _word_paths_cache["journal"] = None

                if val_e:
                    norm_e = _normalizar_ruta_word_candidata(val_e, default_e_name)
                    if norm_e != _word_paths_cache["english"]:
                        logging.info(
                            f"Ruta English Notebook actualizada desde GitHub Variable ENGLISH_WORD_FILE_PATH: {norm_e}"
                        )
                    _word_paths_cache["english"] = norm_e
                elif _es_github_var_no_encontrada(err_e):
                    _word_paths_cache["english"] = None

                ok_j = bool(val_j) or _es_github_var_no_encontrada(err_j)
                ok_e = bool(val_e) or _es_github_var_no_encontrada(err_e)
                if ok_j or ok_e:
                    _word_paths_cache["last_error"] = None
                    _guardar_word_paths_cache_disco(
                        _word_paths_cache["journal"], _word_paths_cache["english"]
                    )
                else:
                    first_err = err_j or err_e
                    if first_err and first_err != _word_paths_cache["last_error"]:
                        logging.warning(
                            f"No se pudo leer WORD_FILE_PATH / ENGLISH_WORD_FILE_PATH desde GitHub: {first_err}. Usando respaldo."
                        )
                        _word_paths_cache["last_error"] = first_err

                _word_paths_cache["fetched_at"] = ahora_ts
            except requests.exceptions.RequestException as e:
                _word_paths_cache["fetched_at"] = ahora_ts - max(
                    0, GITHUB_CACHE_TTL_SECONDS - 60
                )
                if str(e) != _word_paths_cache["last_error"]:
                    logging.warning(
                        f"Error de red consultando rutas Word en GitHub Variables (usando respaldo): {e}"
                    )
                    _word_paths_cache["last_error"] = str(e)

        resolved_j = _word_paths_cache["journal"] or env_j or RUTA_WORD
        resolved_e = (
            _word_paths_cache["english"]
            or env_e
            or RUTA_WORD_ENGLISH
            or DEFAULT_ENGLISH_WORD_PATH
        )
    else:
        resolved_j = env_j or RUTA_WORD
        resolved_e = env_e or RUTA_WORD_ENGLISH or DEFAULT_ENGLISH_WORD_PATH

    RUTA_WORD = resolved_j
    RUTA_WORD_ENGLISH = resolved_e
    return resolved_j, resolved_e


def obtener_url_aws(endpoint="/api/pull-text"):
    """Construye la URL del servidor para el endpoint indicado desde GitHub Variables o desde .env."""
    ruta = endpoint if endpoint.startswith("/") else f"/{endpoint}"
    puerto_local = os.environ.get("PORT", "3000").strip() or "3000"
    github_repo = os.environ.get("GITHUB_REPO", "Flax64/mood-tracker").strip()
    github_token = os.environ.get("GITHUB_TOKEN", "").strip()
    network_err = None

    if github_repo and github_token:
        _cargar_host_cache_disco()
        ahora_ts = time.time()
        if (ahora_ts - _github_cache["fetched_at"]) >= GITHUB_CACHE_TTL_SECONDS:
            try:
                host_gh, err = _leer_variable_github(
                    github_repo, github_token, "EC2_HOST"
                )
                if host_gh:
                    if host_gh != _github_cache["host"]:
                        logging.info(
                            f"Host AWS obtenido/actualizado desde GitHub: {host_gh}"
                        )
                    elif _github_cache["last_error"] is not None:
                        logging.info(
                            f"Conexión con GitHub Variables restablecida (host: {host_gh})."
                        )
                    port_gh, _ = _leer_variable_github(
                        github_repo, github_token, "PORT"
                    )
                    _github_cache["host"] = host_gh
                    _github_cache["port"] = port_gh or puerto_local
                    _github_cache["last_error"] = None
                    _guardar_host_cache_disco(
                        _github_cache["host"], _github_cache["port"]
                    )
                elif err and err != _github_cache["last_error"]:
                    logging.warning(
                        f"No se pudo leer EC2_HOST desde GitHub: {err}. Usando respaldo disponible."
                    )
                    _github_cache["last_error"] = err
                _github_cache["fetched_at"] = ahora_ts
            except requests.exceptions.RequestException as e:
                network_err = e
                _github_cache["fetched_at"] = ahora_ts - max(
                    0, GITHUB_CACHE_TTL_SECONDS - 60
                )
                if str(e) != _github_cache["last_error"]:
                    logging.warning(
                        f"Error de red consultando GitHub Variables (se usará respaldo si existe): {e}"
                    )
                    _github_cache["last_error"] = str(e)

        if _github_cache["host"]:
            puerto_activo = _github_cache["port"] or puerto_local
            return f"http://{_github_cache['host']}:{puerto_activo}{ruta}"

    url_directa = os.environ.get("URL_AWS", "").strip()
    if url_directa:
        if ruta == "/api/pull-text":
            return url_directa
        if "/api/" in url_directa:
            return url_directa.split("/api/", 1)[0].rstrip("/") + ruta
        return url_directa.rstrip("/") + ruta

    aws_host = (
        os.environ.get("SERVER_HOST", "").strip()
        or os.environ.get("EC2_HOST", "").strip()
        or os.environ.get("AWS_HOST", "").strip()
    )
    if aws_host:
        return f"http://{aws_host}:{puerto_local}{ruta}"

    _cargar_host_cache_disco()
    if _github_cache.get("host"):
        puerto_activo = _github_cache["port"] or puerto_local
        return f"http://{_github_cache['host']}:{puerto_activo}{ruta}"

    if network_err is not None:
        raise requests.exceptions.ConnectionError(
            f"Sin conexión de red/DNS con GitHub y sin host EC2 guardado en respaldo local: {network_err}"
        )

    raise RuntimeError(
        "Falta GITHUB_TOKEN (para leer EC2_HOST) o AWS_HOST en el archivo .env"
    )


def _normalizar_llave_aes(llave_secreta=None):
    raw = llave_secreta if llave_secreta is not None else LLAVE_SECRETA
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    if not isinstance(raw, (bytes, bytearray)) or len(raw) != 32:
        raise ValueError(
            "JOURNAL_SECRET_KEY / llave E2EE debe tener exactamente 32 bytes para AES-256-CBC."
        )
    return bytes(raw)


def encriptar_texto(texto_plano, llave_secreta=None):
    llave = _normalizar_llave_aes(llave_secreta)
    datos = str(texto_plano if texto_plano is not None else "").encode("utf-8")
    pad_len = 16 - (len(datos) % 16)
    datos_padded = datos + bytes([pad_len]) * pad_len
    iv = os.urandom(16)
    cipher = AES.new(llave, AES.MODE_CBC, iv)
    cifrado = cipher.encrypt(datos_padded)
    return f"{binascii.hexlify(iv).decode('ascii')}:{base64.b64encode(cifrado).decode('ascii')}"


_E2EE_CIPHERTEXT_RE = re.compile(r"^[0-9a-fA-F]{32}:[A-Za-z0-9+/=]+$")


def desencriptar_texto(texto_cifrado, llave_secreta=None, raise_on_error=False):
    es_sobre_e2ee = isinstance(texto_cifrado, str) and bool(
        _E2EE_CIPHERTEXT_RE.fullmatch(texto_cifrado.strip())
    )
    try:
        if not isinstance(texto_cifrado, str) or ":" not in texto_cifrado:
            return str(texto_cifrado or "")
        iv_hex, mensaje_b64 = texto_cifrado.split(":", 1)
        iv = binascii.unhexlify(iv_hex.strip())
        if len(iv) != 16:
            if raise_on_error and es_sobre_e2ee:
                raise ValueError("Vector IV E2EE inválido")
            return texto_cifrado
        mensaje_bytes = base64.b64decode(mensaje_b64.strip())
        if not mensaje_bytes or len(mensaje_bytes) % 16 != 0:
            if raise_on_error and es_sobre_e2ee:
                raise ValueError("Longitud de mensaje cifrado E2EE inválida")
            return texto_cifrado
        llave = _normalizar_llave_aes(llave_secreta)
        cipher = AES.new(llave, AES.MODE_CBC, iv)
        desencriptado = cipher.decrypt(mensaje_bytes)
        padding_len = desencriptado[-1]
        if (
            padding_len < 1
            or padding_len > 16
            or desencriptado[-padding_len:] != bytes([padding_len]) * padding_len
        ):
            raise ValueError("Padding PKCS#7 inválido o llave E2EE no coincidente")
        return desencriptado[:-padding_len].decode("utf-8")
    except Exception:
        if raise_on_error and es_sobre_e2ee:
            raise
        # Si el texto no viene cifrado o está en modo tolerante, lo pasa tal cual
        return texto_cifrado


def _obtener_pc_bridge_secret():
    env_key = os.environ.get("JOURNAL_SECRET_KEY", "").strip()
    if env_key:
        return env_key.encode("utf-8")
    if isinstance(LLAVE_SECRETA, (bytes, bytearray)) and len(LLAVE_SECRETA) > 0:
        return bytes(LLAVE_SECRETA)
    admin_sec = os.environ.get("ADMIN_SECRET", "").strip()
    return admin_sec.encode("utf-8") if admin_sec else b""


def _firmar_pc_request(
    method, endpoint_path, encrypted_blob="", secret=None, timestamp=None
):
    """Firma HMAC-SHA256 site-to-site compatible con verifyPcBridgeAuth en server.js."""
    sec_bytes = (
        secret.encode("utf-8")
        if isinstance(secret, str)
        else (
            secret
            if isinstance(secret, (bytes, bytearray))
            else _obtener_pc_bridge_secret()
        )
    )
    if not sec_bytes:
        raise RuntimeError(
            "Falta JOURNAL_SECRET_KEY / ADMIN_SECRET para firmar el puente PC-EC2."
        )
    clean_path = urllib.parse.urlsplit(str(endpoint_path or "/")).path or "/"
    ts = str(int(timestamp if timestamp is not None else time.time()))
    payload_hash = hashlib.sha256(str(encrypted_blob or "").encode("utf-8")).hexdigest()
    canonical = f"{str(method or 'GET').upper()}:{clean_path}:{ts}:{payload_hash}"
    sig = hmac.new(sec_bytes, canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    return {
        "X-PC-Timestamp": ts,
        "X-PC-Signature": sig,
    }


def calcular_encabezado(fecha_objetivo=None):
    if fecha_objetivo is None:
        fecha_objetivo = datetime.now()

    fecha_inicio = datetime(2026, 8, 30)
    dias_pasados = (fecha_objetivo.date() - fecha_inicio.date()).days
    d_actual = 500 - dias_pasados

    meses_ingles = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ]
    mes = meses_ingles[fecha_objetivo.month - 1]
    dia = fecha_objetivo.day

    if 11 <= dia <= 13:
        sufijo = "th"
    else:
        sufijo = {1: "st", 2: "nd", 3: "rd"}.get(dia % 10, "th")

    return f"{mes} {dia:02d}{sufijo} D-{d_actual}"


def _listar_pids_winword():
    """Lista los PIDs activos de WINWORD.EXE sin bloquear."""
    if not sys.platform.startswith("win"):
        return set()
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        proc = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq WINWORD.EXE", "/FO", "CSV", "/NH"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5,
            check=False,
            creationflags=flags,
        )
        pids = set()
        for raw_line in proc.stdout.decode("utf-8", errors="replace").splitlines():
            parts = [p.strip().strip('"') for p in raw_line.split(",")]
            if (
                len(parts) >= 2
                and parts[0].lower() == "winword.exe"
                and parts[1].isdigit()
            ):
                pids.add(int(parts[1]))
        return pids
    except Exception:
        return set()


def _terminar_pids_word_colgados(pids, timed_out_flag):
    """Watchdog: mata únicamente instancias nuevas de Word COM creadas por el sync si se congelan."""
    timed_out_flag["triggered"] = True
    if not pids or not sys.platform.startswith("win"):
        return
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    for pid in pids:
        try:
            logging.warning(
                f"Watchdog Word COM: terminando instancia WINWORD.EXE PID {pid} bloqueada (>{_WORD_COM_TIMEOUT_SECONDS}s)."
            )
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=6,
                check=False,
                creationflags=flags,
            )
        except Exception:
            pass


def _iniciar_word_com_oculto():
    """Inicializa COM en el hilo actual y crea una instancia oculta de Word."""
    com_init = False
    if pythoncom is not None:
        pythoncom.CoInitialize()
        com_init = True
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    try:
        word.AutomationSecurity = 3  # msoAutomationSecurityForceDisable
    except Exception:
        pass
    try:
        word.ScreenUpdating = False
    except Exception:
        pass
    try:
        word.Options.ConfirmConversions = False
    except Exception:
        pass
    return com_init, word


def agregar_texto_a_word(texto, fecha_objetivo=None):
    ruta_journal, _ = resolver_rutas_word()
    if (not ruta_journal or not os.path.exists(ruta_journal)) and os.environ.get(
        "GITHUB_TOKEN", ""
    ).strip():
        ruta_journal, _ = resolver_rutas_word(refresh_cache=True)
    if not ruta_journal or not os.path.exists(ruta_journal):
        logging.error(
            f"Archivo Journal Word no encontrado en la ruta configurada: {ruta_journal}"
        )
        return False

    if win32com is None:
        logging.error("win32com no disponible para escribir Journal Word.")
        return False

    with _word_com_lock:
        com_init = False
        word = None
        doc = None
        watchdog = None
        timed_out_flag = {"triggered": False}
        new_word_pids = set()
        try:
            pids_before = _listar_pids_winword()
            com_init, word = _iniciar_word_com_oculto()
            pids_after = _listar_pids_winword()
            new_word_pids = pids_after - pids_before

            watchdog = threading.Timer(
                _WORD_COM_TIMEOUT_SECONDS,
                _terminar_pids_word_colgados,
                args=(sorted(new_word_pids), timed_out_flag),
            )
            watchdog.daemon = True
            watchdog.start()

            doc = word.Documents.Open(
                FileName=os.path.abspath(ruta_journal),
                ConfirmConversions=False,
                ReadOnly=False,
                AddToRecentFiles=False,
                PasswordDocument=PASSWORD,
                WritePasswordDocument=PASSWORD,
                OpenAndRepair=False,
                NoEncodingDialog=True,
            )

            if getattr(doc, "ReadOnly", False):
                logging.warning(
                    "Journal Word se abrió en modo solo lectura (posiblemente abierto en Word/OneDrive). Se reintentará más tarde."
                )
                return False

            selection = word.Selection
            selection.EndKey(Unit=6)

            encabezado = calcular_encabezado(fecha_objetivo)
            texto_limpio = str(texto or "").strip()
            texto_completo = doc.Content.Text

            if encabezado in texto_completo:
                if texto_limpio == "Nothing to report.":
                    return True

                selection.TypeParagraph()
                selection.TypeParagraph()
                selection.Style = doc.Styles(-1)

                selection.Font.Name = "Arial"
                selection.Font.Size = 11
                selection.Font.Bold = False
                selection.TypeText(texto_limpio)
            else:
                selection.TypeParagraph()
                selection.TypeParagraph()

                selection.Style = doc.Styles(-2)
                selection.Font.Name = "Arial"
                selection.Font.Size = 16
                selection.Font.Bold = True
                selection.Font.ColorIndex = 1
                selection.TypeText(encabezado)

                selection.TypeParagraph()
                selection.Style = doc.Styles(-1)
                selection.Font.Name = "Arial"
                selection.Font.Size = 11
                selection.Font.Bold = False
                selection.TypeText(texto_limpio)

            try:
                if doc.TablesOfContents.Count > 0:
                    doc.TablesOfContents(1).Update()
            except Exception as toc_err:
                logging.warning(
                    f"No se pudo actualizar TOC en Journal Word (se guarda el texto igualmente): {toc_err}"
                )

            doc.Save()
            logging.info(f"Registro exitoso bajo el dia: {encabezado}")
            return True

        except Exception as e:
            if timed_out_flag["triggered"]:
                logging.warning(
                    "Word COM superó el tiempo límite (35s) y fue liberado; la nota sigue segura en cola cifrada local."
                )
            else:
                logging.warning(
                    f"Word ocupado o bloqueado. Se reintentara mas tarde. Detalles: {e}"
                )
            return False

        finally:
            if watchdog is not None:
                try:
                    watchdog.cancel()
                except Exception:
                    pass
            if doc and not timed_out_flag["triggered"]:
                try:
                    doc.Close(SaveChanges=0)
                except Exception:
                    pass
            if word and not timed_out_flag["triggered"]:
                try:
                    word.Quit()
                except Exception:
                    pass
            if com_init and pythoncom is not None:
                try:
                    pythoncom.CoUninitialize()
                except Exception:
                    pass


SECCIONES_INGLES = {
    "vocabulary": "1. Glossary & New Words",
    "grammar": "2. Grammar & Usage Notes",
    "phrasal_verb": "3. Phrasal Verbs",
    "music": "4. Songs & Music Study",
}

_PREFIJOS_SECCION_INGLES = {
    "vocabulary": "1.",
    "grammar": "2.",
    "phrasal_verb": "3.",
    "music": "4.",
}


def _limpiar_linea(texto):
    if texto is None:
        return ""
    return str(texto).replace("\r", " ").replace("\n", " ").strip()


def _dividir_lineas_limpias(texto):
    if texto is None:
        return []
    lineas = [
        line.strip()
        for line in str(texto).replace("\r", "").split("\n")
        if line.strip()
    ]
    return lineas


def parsear_entrada_ingles(raw_text):
    """Convierte el texto descifrado de /api/pull-english en una entrada estructurada."""
    texto = (raw_text or "").strip()
    if not texto:
        raise ValueError("La entrada de inglés está vacía.")

    try:
        parsed = json.loads(texto)
    except (ValueError, TypeError):
        titulo_fallback = _limpiar_linea(texto)[:60] or "General English Note"
        return {
            "category": "grammar",
            "title": titulo_fallback,
            "notes": texto,
            "example": "",
        }

    if not isinstance(parsed, dict):
        return {
            "category": "grammar",
            "title": _limpiar_linea(parsed)[:60] or "General English Note",
            "notes": str(parsed),
            "example": "",
        }

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

    if category == "music":
        raw_track = (
            parsed.get("track_number")
            if parsed.get("track_number") is not None
            else parsed.get("numero_pista")
        )
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


def _normalizar_clave_texto(texto):
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


def _quitar_prefijo_pista(heading_text):
    texto = _limpiar_linea(heading_text)
    return re.sub(
        r"^(?:#|track\s+)?\d{1,3}\s*[.\-:)\]]\s*", "", texto, flags=re.IGNORECASE
    ).strip()


def _encabezado_grupo_album(entry):
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


def _clave_grupo_album(heading_o_nombre):
    texto = _limpiar_linea(heading_o_nombre)
    sin_meta = re.sub(
        r"\s*\((?:Album|EP|Single|Collab Single|Mini Album|Mixtape|OST(?:\s*/\s*Soundtrack)?|Soundtrack|Compilation|Playlist)[^)]*\)\s*$",
        "",
        texto,
        flags=re.IGNORECASE,
    ).strip()
    return _normalizar_clave_texto(sin_meta or texto)


def _encabezado_pista_cancion(entry):
    song_title = _limpiar_linea(entry.get("song_title")) or "Untitled Song"
    artists_display = _limpiar_linea(entry.get("artists_display")) or "Unknown Artist"
    track_num = _extraer_numero_pista(entry.get("track_number"))
    base = f"{song_title} — {artists_display}"
    return f"{track_num:02d}. {base}" if track_num else base


def _clave_pista_cancion(song_title, artists_display=""):
    titulo = _quitar_prefijo_pista(song_title)
    if " — " in titulo and not artists_display:
        titulo = titulo.split(" — ", 1)[0].strip()
    if " [" in titulo:
        titulo = re.sub(r"\s*\[[^\]]+\]\s*$", "", titulo).strip()
    title_key = _normalizar_clave_texto(titulo)
    artist_key = _normalizar_clave_texto(artists_display)
    return (title_key, artist_key)


def _clave_orden_pista(track_number, song_title=""):
    num = _extraer_numero_pista(track_number)
    return (
        0 if num is not None else 1,
        num if num is not None else 999999,
        _normalizar_clave_texto(song_title),
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
    ("Lyrics & Meaning Breakdown:", "lyrics_study"),
    ("Vocabulary & Expressions:", "vocabulary_list"),
    ("Pronunciation & Connected Speech:", "pronunciation_notes"),
    ("Practice & Quiz:", "practice_quiz"),
    ("Extra Study Notes:", "notes"),
    ("Added:", "added_at"),
)


def _parsear_album_release_linea(texto):
    limpio = _limpiar_linea(texto)
    if not limpio:
        return "", "", ""
    m = re.match(r"^(.*?)\s*\(([^)]+)\)\s*$", limpio)
    if not m:
        return limpio, "", ""
    nombre = m.group(1).strip()
    partes = [p.strip() for p in m.group(2).split(",") if p.strip()]
    album_type = ""
    release_year = ""
    for parte in partes:
        if re.fullmatch(r"\d{4}", parte):
            release_year = parte
        elif not album_type:
            album_type = parte
    return nombre, album_type, release_year


def _extraer_campos_bloque_word(lineas_texto, heading_text=""):
    """Reconstruye campos estructurados desde los párrafos de una canción guardada en Word."""
    fields = {
        "song_title": (
            _quitar_prefijo_pista(heading_text).split(" — ", 1)[0].strip()
            if heading_text
            else ""
        ),
        "track_number": _extraer_numero_pista(heading_text),
        "language": "",
        "artists_display": "",
        "album_title": "",
        "album_type": "",
        "release_year": "",
        "release_date": "",
        "playlist_name": "",
        "yt_music_url": "",
        "focus_summary": "",
        "stanzas_breakdown": "",
        "lyrics_study": "",
        "vocabulary_list": "",
        "pronunciation_notes": "",
        "practice_quiz": "",
        "notes": "",
    }
    multiline_keys = {
        "stanzas_breakdown",
        "lyrics_study",
        "vocabulary_list",
        "pronunciation_notes",
        "practice_quiz",
        "notes",
    }
    current_key = None

    for raw in lineas_texto or []:
        line = str(raw or "").replace("\r", "").strip()
        if not line:
            continue
        matched_label = False
        for label, key in _WORD_SONG_LABEL_MAP:
            if line.startswith(label):
                val = line[len(label) :].strip()
                if key == "album_release":
                    alb_title, alb_type, rel_year = _parsear_album_release_linea(val)
                    fields["album_title"] = alb_title
                    fields["album_type"] = alb_type
                    fields["release_year"] = rel_year
                elif key == "track_number":
                    fields["track_number"] = _extraer_numero_pista(val)
                elif key == "added_at":
                    pass
                else:
                    fields[key] = val
                current_key = key if key in multiline_keys else None
                matched_label = True
                break
        if not matched_label and current_key:
            prev = fields.get(current_key, "")
            fields[current_key] = f"{prev}\n{line}" if prev else line

    return fields


def _combinar_campo_multilinea(prev_val, new_val, append=False):
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


def _combinar_metadata_cancion_word(existing_fields, new_entry):
    """Combina metadatos/letras guardados previamente en Word con una actualización sin perder secciones."""
    old = existing_fields or {}
    append_study = bool(new_entry.get("append_study_fields"))
    merged = {
        "category": "music",
        "language": _limpiar_linea(new_entry.get("language"))
        or _limpiar_linea(old.get("language")),
        "song_title": _limpiar_linea(new_entry.get("song_title"))
        or _limpiar_linea(old.get("song_title"))
        or "Untitled Song",
        "artists_display": _limpiar_linea(new_entry.get("artists_display"))
        or _limpiar_linea(old.get("artists_display"))
        or "Unknown Artist",
        "album_title": _limpiar_linea(new_entry.get("album_title"))
        or _limpiar_linea(old.get("album_title")),
        "album_type": _limpiar_linea(new_entry.get("album_type"))
        or _limpiar_linea(old.get("album_type")),
        "release_year": _limpiar_linea(new_entry.get("release_year"))
        or _limpiar_linea(old.get("release_year")),
        "release_date": _limpiar_linea(new_entry.get("release_date"))
        or _limpiar_linea(old.get("release_date")),
        "track_number": _extraer_numero_pista(new_entry.get("track_number"))
        or _extraer_numero_pista(old.get("track_number")),
        "playlist_name": _limpiar_linea(new_entry.get("playlist_name"))
        or _limpiar_linea(old.get("playlist_name")),
        "yt_music_url": _limpiar_linea(new_entry.get("yt_music_url"))
        or _limpiar_linea(old.get("yt_music_url")),
        "focus_summary": _limpiar_linea(new_entry.get("focus_summary"))
        or _limpiar_linea(old.get("focus_summary")),
        "stanzas_breakdown": _combinar_campo_multilinea(
            old.get("stanzas_breakdown"),
            new_entry.get("stanzas_breakdown"),
            append=append_study,
        ),
        "lyrics_study": _combinar_campo_multilinea(
            old.get("lyrics_study"), new_entry.get("lyrics_study"), append=append_study
        ),
        "vocabulary_list": _combinar_campo_multilinea(
            old.get("vocabulary_list"),
            new_entry.get("vocabulary_list"),
            append=append_study,
        ),
        "pronunciation_notes": _combinar_campo_multilinea(
            old.get("pronunciation_notes"),
            new_entry.get("pronunciation_notes"),
            append=append_study,
        ),
        "practice_quiz": _combinar_campo_multilinea(
            old.get("practice_quiz"),
            new_entry.get("practice_quiz"),
            append=append_study,
        ),
        "notes": _combinar_campo_multilinea(
            old.get("notes"), new_entry.get("notes"), append=append_study
        ),
    }
    return merged


def _agregar_lineas_texto(lineas_spec, label, raw_text):
    partes = _dividir_lineas_limpias(raw_text)
    for idx, line in enumerate(partes):
        lineas_spec.append(
            {
                "label": label if idx == 0 else "",
                "text": line,
                "size": 11,
                "italic": False,
                "muted": False,
            }
        )


def formatear_entrada_ingles(entry, fecha_dt=None):
    """Genera encabezado TOC + párrafos ordenados (sin saltos \\r/\\n internos) para Word."""
    category = (
        entry.get("category")
        if entry.get("category") in SECCIONES_INGLES
        else "grammar"
    )
    section_title = SECCIONES_INGLES[category]
    timestamp_str = (fecha_dt or datetime.now()).strftime("%Y-%m-%d %H:%M")
    lines = []

    if category == "vocabulary":
        language = _limpiar_linea(entry.get("language"))
        word = _limpiar_linea(entry.get("word")) or "New Word"
        romanization = _limpiar_linea(entry.get("romanization"))
        pos = _limpiar_linea(entry.get("part_of_speech"))
        spanish = _limpiar_linea(entry.get("spanish")) or "(No translation)"
        word_disp = f"{word} [{romanization}]" if romanization else word
        heading = (
            f"{word_disp} ({pos}) — {spanish}" if pos else f"{word_disp} — {spanish}"
        )

        if language:
            lines.append(
                {
                    "label": "Language: ",
                    "text": language,
                    "size": 10,
                    "italic": True,
                    "muted": True,
                }
            )
        lines.append(
            {
                "label": "Expression: " if language else "English: ",
                "text": word,
                "size": 11,
                "italic": False,
                "muted": False,
            }
        )
        if romanization:
            lines.append(
                {
                    "label": "Romanization: ",
                    "text": romanization,
                    "size": 11,
                    "italic": False,
                    "muted": False,
                }
            )
        if pos:
            lines.append(
                {
                    "label": "Part of speech: ",
                    "text": pos,
                    "size": 11,
                    "italic": False,
                    "muted": False,
                }
            )
        lines.append(
            {
                "label": "Meaning: " if language else "Spanish: ",
                "text": spanish,
                "size": 11,
                "italic": False,
                "muted": False,
            }
        )
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
            lines.append(
                {
                    "label": "Language: ",
                    "text": language,
                    "size": 10,
                    "italic": True,
                    "muted": True,
                }
            )
        lines.append(
            {
                "label": "Phrasal Verb: ",
                "text": verb,
                "size": 11,
                "italic": False,
                "muted": False,
            }
        )
        if grammar_type:
            lines.append(
                {
                    "label": "Pattern: ",
                    "text": grammar_type,
                    "size": 11,
                    "italic": False,
                    "muted": False,
                }
            )
        lines.append(
            {
                "label": "Spanish Meaning: ",
                "text": meaning_es,
                "size": 11,
                "italic": False,
                "muted": False,
            }
        )
        if meaning_en:
            lines.append(
                {
                    "label": "English Definition: ",
                    "text": meaning_en,
                    "size": 11,
                    "italic": False,
                    "muted": False,
                }
            )
        _agregar_lineas_texto(lines, "Example: ", entry.get("example"))
        _agregar_lineas_texto(lines, "Notes: ", entry.get("notes"))

    elif category == "music":
        language = _limpiar_linea(entry.get("language"))
        song_title = _limpiar_linea(entry.get("song_title")) or "Untitled Song"
        artists_display = (
            _limpiar_linea(entry.get("artists_display")) or "Unknown Artist"
        )
        album_title = _limpiar_linea(entry.get("album_title"))
        album_type = _limpiar_linea(entry.get("album_type"))
        release_year = _limpiar_linea(entry.get("release_year"))
        release_date = _limpiar_linea(entry.get("release_date"))
        track_num = _extraer_numero_pista(entry.get("track_number"))
        playlist_name = _limpiar_linea(entry.get("playlist_name"))
        yt_music_url = _limpiar_linea(entry.get("yt_music_url"))
        focus_summary = _limpiar_linea(entry.get("focus_summary"))

        meta_parts = [p for p in (album_type, release_year) if p]
        if album_title and meta_parts:
            album_label = f"{album_title} ({', '.join(meta_parts)})"
        elif meta_parts and not album_title:
            album_label = ", ".join(meta_parts)
        else:
            album_label = album_title

        group_heading = _encabezado_grupo_album(entry)
        track_heading = _encabezado_pista_cancion(entry)
        heading = track_heading

        lines.append(
            {
                "label": "Song: ",
                "text": song_title,
                "size": 11,
                "italic": False,
                "muted": False,
            }
        )
        if track_num:
            lines.append(
                {
                    "label": "Track #: ",
                    "text": f"{track_num:02d}",
                    "size": 10,
                    "italic": False,
                    "muted": True,
                }
            )
        if language:
            lines.append(
                {
                    "label": "Language: ",
                    "text": language,
                    "size": 11,
                    "italic": False,
                    "muted": False,
                }
            )
        lines.append(
            {
                "label": "Artists / Collabs: ",
                "text": artists_display,
                "size": 11,
                "italic": False,
                "muted": False,
            }
        )
        if album_label:
            lines.append(
                {
                    "label": "Album / Release: ",
                    "text": album_label,
                    "size": 11,
                    "italic": False,
                    "muted": False,
                }
            )
        if release_date:
            lines.append(
                {
                    "label": "Release Date: ",
                    "text": release_date,
                    "size": 10,
                    "italic": False,
                    "muted": True,
                }
            )
        if playlist_name:
            lines.append(
                {
                    "label": "Playlist / List: ",
                    "text": playlist_name,
                    "size": 11,
                    "italic": False,
                    "muted": False,
                }
            )
        if yt_music_url:
            lines.append(
                {
                    "label": "YouTube Music: ",
                    "text": yt_music_url,
                    "size": 10,
                    "italic": False,
                    "muted": True,
                }
            )
        if focus_summary:
            lines.append(
                {
                    "label": "Study Focus: ",
                    "text": focus_summary,
                    "size": 11,
                    "italic": False,
                    "muted": False,
                }
            )
        _agregar_lineas_texto(
            lines,
            "Stanzas Breakdown (Intro / Chorus / Rap): ",
            entry.get("stanzas_breakdown"),
        )
        _agregar_lineas_texto(
            lines, "Lyrics & Meaning Breakdown: ", entry.get("lyrics_study")
        )
        _agregar_lineas_texto(
            lines, "Vocabulary & Expressions: ", entry.get("vocabulary_list")
        )
        _agregar_lineas_texto(
            lines,
            "Pronunciation & Connected Speech: ",
            entry.get("pronunciation_notes"),
        )
        _agregar_lineas_texto(lines, "Practice & Quiz: ", entry.get("practice_quiz"))
        _agregar_lineas_texto(lines, "Extra Study Notes: ", entry.get("notes"))

    else:
        language = _limpiar_linea(entry.get("language"))
        title = _limpiar_linea(entry.get("title")) or "Grammar Note"
        heading = title
        if language:
            lines.append(
                {
                    "label": "Language: ",
                    "text": language,
                    "size": 10,
                    "italic": True,
                    "muted": True,
                }
            )
        _agregar_lineas_texto(lines, "Notes: ", entry.get("notes"))
        _agregar_lineas_texto(lines, "Examples: ", entry.get("example"))
        _agregar_lineas_texto(lines, "Practice & Quiz: ", entry.get("practice_quiz"))

    lines.append(
        {
            "label": "Added: ",
            "text": timestamp_str,
            "size": 9,
            "italic": True,
            "muted": True,
        }
    )

    out = {
        "category": category,
        "section_title": section_title,
        "heading": heading,
        "lines": lines,
    }
    if category == "music":
        out["group_heading"] = group_heading
        out["track_heading"] = track_heading
        out["track_number"] = track_num
    return out


def _en_rango_toc(doc, para):
    p_start = para.Range.Start
    p_end = para.Range.End
    for i in range(1, doc.TablesOfContents.Count + 1):
        toc_rng = doc.TablesOfContents(i).Range
        if p_start >= toc_rng.Start and p_end <= toc_rng.End:
            return True
    return False


def _texto_parrafo_limpio(para):
    return para.Range.Text.replace("\r", "").replace("\x07", "").strip()


def _aplicar_estilo_parrafo(
    doc,
    para_idx,
    style_const,
    label_prefix,
    text,
    font_size=11,
    bold_all=False,
    italic=False,
    muted=False,
):
    para = doc.Paragraphs(para_idx)
    para.Style = doc.Styles(style_const)
    rng = para.Range.Duplicate
    rng.MoveEnd(1, -1)  # wdCharacter = 1 (no sobrescribir el marcador final de párrafo)
    rng.Text = f"{label_prefix}{text}"

    fmt_rng = doc.Paragraphs(para_idx).Range.Duplicate
    fmt_rng.MoveEnd(1, -1)
    fmt_rng.Font.Name = "Arial"
    fmt_rng.Font.Size = font_size
    fmt_rng.Font.Bold = bool(bold_all)
    fmt_rng.Font.Italic = bool(italic)
    fmt_rng.Font.Color = (
        0x666666 if muted else -16777216
    )  # gris sutil o wdColorAutomatic

    if (
        label_prefix
        and not bold_all
        and fmt_rng.Start + len(label_prefix) <= fmt_rng.End
    ):
        lbl_rng = doc.Range(fmt_rng.Start, fmt_rng.Start + len(label_prefix))
        lbl_rng.Font.Bold = True


_ACL_OPENED_DIRS = set()


def _asegurar_permisos_abiertos_word(ruta_docx):
    """Asegura que el documento Word generado y su carpeta puedan ser vistos y editados por todos."""
    if not ruta_docx:
        return
    ruta_abs = os.path.abspath(ruta_docx)
    carpeta = os.path.dirname(ruta_abs)
    try:
        if os.path.exists(ruta_abs):
            os.chmod(ruta_abs, stat.S_IWRITE | stat.S_IREAD)
    except Exception:
        pass
    if os.name != "nt":
        return
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        if carpeta and os.path.isdir(carpeta) and carpeta not in _ACL_OPENED_DIRS:
            res_dir = subprocess.run(
                ["icacls", carpeta, "/grant", "*S-1-1-0:(OI)(CI)F"],
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=flags,
            )
            if res_dir.returncode == 0:
                _ACL_OPENED_DIRS.add(carpeta)
    except Exception as err:
        logging.debug(f"No se pudo ajustar ACL de carpeta '{carpeta}': {err}")
    try:
        if os.path.exists(ruta_abs):
            subprocess.run(
                ["icacls", ruta_abs, "/grant", "*S-1-1-0:F"],
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=flags,
            )
    except Exception as err:
        logging.debug(f"No se pudo ajustar ACL de archivo '{ruta_abs}': {err}")


def _asegurar_edicion_abierta_word_doc(doc):
    """Quita marcas internas de solo lectura o protección del documento generado."""
    try:
        if getattr(doc, "ProtectionType", -1) != -1:
            doc.Unprotect()
    except Exception:
        pass
    try:
        doc.ReadOnlyRecommended = False
    except Exception:
        pass
    try:
        if getattr(doc, "Final", False):
            doc.Final = False
    except Exception:
        pass


def _configurar_toc_hipervinculos(doc, toc, lower_level=3):
    """Asegura que el índice (TOC) tenga enlaces clicables (\\h \\z \\u) hacia los títulos."""
    try:
        toc.LowerHeadingLevel = lower_level
    except Exception:
        pass
    for attr, val in (
        ("UseHeadingStyles", True),
        ("IncludePageNumbers", True),
        ("RightAlignPageNumbers", True),
        ("UseHyperlinks", True),
        ("HidePageNumbersInWeb", True),
    ):
        try:
            setattr(toc, attr, val)
        except Exception:
            pass
    try:
        fields = toc.Range.Fields
        if fields.Count >= 1:
            fld = fields(1)
            code = str(fld.Code.Text or "")
            low = code.lower()
            expected_range = f"1-{lower_level}"
            if (
                "toc" not in low
                or "\\h" not in low
                or "\\u" not in low
                or expected_range not in low
            ):
                fld.Code.Text = f' TOC \\o "{expected_range}" \\h \\z \\u '
    except Exception:
        pass


def _insertar_toc_con_hipervinculos(doc, toc_rng, lower_level=3):
    toc = doc.TablesOfContents.Add(
        Range=toc_rng,
        RightAlignPageNumbers=True,
        UseHeadingStyles=True,
        UpperHeadingLevel=1,
        LowerHeadingLevel=lower_level,
        IncludePageNumbers=True,
        UseHyperlinks=True,
        HidePageNumbersInWeb=True,
    )
    _configurar_toc_hipervinculos(doc, toc, lower_level=lower_level)
    try:
        toc.Update()
    except Exception:
        pass
    return toc


def _asegurar_documento_ingles(word, ruta_docx):
    ruta_docx = os.path.abspath(ruta_docx)
    os.makedirs(os.path.dirname(ruta_docx), exist_ok=True)
    _asegurar_permisos_abiertos_word(ruta_docx)
    es_nuevo = not os.path.exists(ruta_docx)

    if es_nuevo:
        doc = word.Documents.Add()

        # Párrafo 1: Título del cuaderno
        _aplicar_estilo_parrafo(
            doc, 1, -1, "", "English Learning Notebook", font_size=18, bold_all=True
        )

        # Párrafo 2: Subtítulo
        doc.Paragraphs.Add()
        sub_idx = doc.Paragraphs.Count
        _aplicar_estilo_parrafo(
            doc,
            sub_idx,
            -1,
            "",
            "Structured Vocabulary, Grammar & Phrasal Verbs Log",
            font_size=10,
            italic=True,
            muted=True,
        )

        # Párrafo 3: Encabezado Table of Contents (Normal bold para no duplicarse dentro de la TOC)
        doc.Paragraphs.Add()
        toc_title_idx = doc.Paragraphs.Count
        _aplicar_estilo_parrafo(
            doc, toc_title_idx, -1, "", "Table of Contents", font_size=13, bold_all=True
        )

        # Párrafo 4: Ancla donde se insertará la TOC (después de crear las secciones Heading 1)
        doc.Paragraphs.Add()
        toc_anchor_idx = doc.Paragraphs.Count
        doc.Paragraphs(toc_anchor_idx).Style = doc.Styles(-1)

        # Separador visual tras TOC
        doc.Paragraphs.Add()
        doc.Paragraphs(doc.Paragraphs.Count).Style = doc.Styles(-1)

        # Crear las 4 secciones principales ordenadas
        for cat in ("vocabulary", "grammar", "phrasal_verb", "music"):
            doc.Paragraphs.Add()
            sec_idx = doc.Paragraphs.Count
            _aplicar_estilo_parrafo(
                doc, sec_idx, -2, "", SECCIONES_INGLES[cat], font_size=15, bold_all=True
            )
            doc.Paragraphs.Add()  # Párrafo Normal vacío debajo de cada sección
            doc.Paragraphs(doc.Paragraphs.Count).Style = doc.Styles(-1)

        # Insertar Tabla de Contenidos en el ancla inicial (Upper=1, Lower=3 para Secciones -> Álbumes -> Pistas)
        toc_rng = doc.Paragraphs(toc_anchor_idx).Range.Duplicate
        toc_rng.MoveEnd(1, -1)
        _insertar_toc_con_hipervinculos(doc, toc_rng, lower_level=3)
        _asegurar_edicion_abierta_word_doc(doc)
        doc.SaveAs2(ruta_docx)
        return doc

    doc = word.Documents.Open(
        FileName=ruta_docx,
        ConfirmConversions=False,
        ReadOnly=False,
        AddToRecentFiles=False,
    )
    if getattr(doc, "ReadOnly", False):
        raise RuntimeError(
            "English_Learning_Notebook.docx está abierto en modo solo lectura."
        )

    # Asegurar que el último párrafo esté vacío y en Normal para inserciones seguras al final
    _asegurar_ultimo_parrafo_vacio(doc)

    # Verificar que existan las 4 secciones Heading 1 fuera de la TOC
    encabezados_actuales = []
    for i in range(1, doc.Paragraphs.Count + 1):
        p = doc.Paragraphs(i)
        if not _en_rango_toc(doc, p) and p.OutlineLevel == 1:
            encabezados_actuales.append(_texto_parrafo_limpio(p).lower())

    for cat in ("vocabulary", "grammar", "phrasal_verb", "music"):
        titulo = SECCIONES_INGLES[cat]
        pref = _PREFIJOS_SECCION_INGLES[cat]
        existe = any(
            h == titulo.lower() or h.startswith(pref) for h in encabezados_actuales
        )
        if not existe:
            target_idx = doc.Paragraphs.Count
            doc.Paragraphs(target_idx).Range.InsertParagraphBefore()
            _aplicar_estilo_parrafo(
                doc, target_idx, -2, "", titulo, font_size=15, bold_all=True
            )
            doc.Paragraphs(target_idx + 1).Range.InsertParagraphBefore()
            _aplicar_estilo_parrafo(doc, target_idx + 1, -1, "", "")

    # Asegurar que exista al menos una TOC al inicio con nivel 3 (Álbum -> Pistas)
    if doc.TablesOfContents.Count == 0:
        doc.Paragraphs(1).Range.InsertParagraphBefore()
        _aplicar_estilo_parrafo(
            doc, 1, -1, "", "Table of Contents", font_size=13, bold_all=True
        )
        doc.Paragraphs(2).Range.InsertParagraphBefore()
        doc.Paragraphs(2).Style = doc.Styles(-1)
        toc_rng = doc.Paragraphs(2).Range.Duplicate
        toc_rng.MoveEnd(1, -1)
        _insertar_toc_con_hipervinculos(doc, toc_rng, lower_level=3)

    _asegurar_edicion_abierta_word_doc(doc)
    return doc


def _buscar_indice_insercion_seccion(doc, category):
    titulo_esperado = SECCIONES_INGLES[category].lower()
    prefijo = _PREFIJOS_SECCION_INGLES[category]
    section_idx = None

    for i in range(1, doc.Paragraphs.Count + 1):
        p = doc.Paragraphs(i)
        if _en_rango_toc(doc, p):
            continue
        if p.OutlineLevel == 1:
            txt = _texto_parrafo_limpio(p).lower()
            if txt == titulo_esperado or txt.startswith(prefijo):
                section_idx = i
                break

    if section_idx is None:
        return doc.Paragraphs.Count

    for j in range(section_idx + 1, doc.Paragraphs.Count + 1):
        p = doc.Paragraphs(j)
        if _en_rango_toc(doc, p):
            continue
        if p.OutlineLevel == 1:
            return j

    return doc.Paragraphs.Count


def _insertar_parrafo_antes(
    doc,
    target_idx,
    style_const,
    label_prefix="",
    text="",
    font_size=11,
    bold_all=False,
    italic=False,
    muted=False,
):
    doc.Paragraphs(target_idx).Range.InsertParagraphBefore()
    _aplicar_estilo_parrafo(
        doc,
        target_idx,
        style_const,
        label_prefix,
        text,
        font_size=font_size,
        bold_all=bold_all,
        italic=italic,
        muted=muted,
    )
    return target_idx + 1


def _asegurar_ultimo_parrafo_vacio(doc):
    if doc.Paragraphs.Count > 0 and _texto_parrafo_limpio(
        doc.Paragraphs(doc.Paragraphs.Count)
    ):
        doc.Paragraphs.Add()
        doc.Paragraphs(doc.Paragraphs.Count).Style = doc.Styles(-1)


def _buscar_rango_seccion(doc, category, include_eof_nonempty=False):
    titulo_esperado = SECCIONES_INGLES[category].lower()
    prefijo = _PREFIJOS_SECCION_INGLES[category]
    section_idx = None

    for i in range(1, doc.Paragraphs.Count + 1):
        p = doc.Paragraphs(i)
        if _en_rango_toc(doc, p):
            continue
        if p.OutlineLevel == 1:
            txt = _texto_parrafo_limpio(p).lower()
            if txt == titulo_esperado or txt.startswith(prefijo):
                section_idx = i
                break

    eof_end = doc.Paragraphs.Count
    if (
        include_eof_nonempty
        and eof_end > 0
        and _texto_parrafo_limpio(doc.Paragraphs(eof_end))
    ):
        eof_end += 1

    if section_idx is None:
        return None, eof_end

    for j in range(section_idx + 1, doc.Paragraphs.Count + 1):
        p = doc.Paragraphs(j)
        if _en_rango_toc(doc, p):
            continue
        if p.OutlineLevel == 1:
            return section_idx, j

    return section_idx, eof_end


def _recolectar_grupos_y_pistas_musica(doc, sec_start_idx, sec_end_idx):
    """Escanea los bloques Heading 2 (Álbum/Lista) y Heading 3 (Pista) dentro de Sección 4."""
    groups = []
    current_group = None
    for idx in range(sec_start_idx + 1, sec_end_idx):
        p = doc.Paragraphs(idx)
        if _en_rango_toc(doc, p):
            continue
        level = p.OutlineLevel
        text = _texto_parrafo_limpio(p)
        if level == 2:
            if current_group is not None:
                current_group["end_idx"] = idx
                if current_group["tracks"]:
                    current_group["tracks"][-1]["end_idx"] = idx
            current_group = {
                "h2_idx": idx,
                "end_idx": sec_end_idx,
                "heading": text,
                "group_key": _clave_grupo_album(text),
                "tracks": [],
            }
            groups.append(current_group)
        elif level == 3 and current_group is not None:
            if current_group["tracks"]:
                current_group["tracks"][-1]["end_idx"] = idx
            current_group["tracks"].append(
                {
                    "h3_idx": idx,
                    "end_idx": sec_end_idx,
                    "heading": text,
                    "track_num": _extraer_numero_pista(text),
                    "song_key": _normalizar_clave_texto(
                        _quitar_prefijo_pista(text).split(" — ", 1)[0]
                    ),
                }
            )
    if current_group is not None:
        current_group["end_idx"] = sec_end_idx
        if current_group["tracks"]:
            current_group["tracks"][-1]["end_idx"] = sec_end_idx
    return groups


def _insertar_bloque_lineas(
    doc, target_idx, style_const, heading_text, heading_size, spec_lines
):
    target_idx = _insertar_parrafo_antes(
        doc,
        target_idx,
        style_const,
        label_prefix="",
        text=heading_text,
        font_size=heading_size,
        bold_all=True,
    )
    for item in spec_lines:
        target_idx = _insertar_parrafo_antes(
            doc,
            target_idx,
            -1,
            label_prefix=item["label"],
            text=item["text"],
            font_size=item.get("size", 11),
            bold_all=False,
            italic=item.get("italic", False),
            muted=item.get("muted", False),
        )
    _insertar_parrafo_antes(doc, target_idx, -1, label_prefix="", text="")
    return target_idx


def _actualizar_toc_ingles(doc):
    try:
        doc.Repaginate()
        for i in range(1, doc.TablesOfContents.Count + 1):
            toc = doc.TablesOfContents(i)
            _configurar_toc_hipervinculos(doc, toc, lower_level=3)
            toc.Update()
    except Exception as toc_err:
        logging.warning(
            f"No se pudo actualizar TOC en English Notebook (se guarda la entrada igualmente): {toc_err}"
        )


def _coincide_cancion_en_bloque(
    fields, heading_text, target_song_title, target_artist=""
):
    target_key = _normalizar_clave_texto(target_song_title)
    if not target_key:
        return False
    block_song = _normalizar_clave_texto(fields.get("song_title"))
    heading_song = _normalizar_clave_texto(
        _quitar_prefijo_pista(heading_text).split(" — ", 1)[0]
    )
    if block_song != target_key and heading_song != target_key:
        return False
    if target_artist and fields.get("artists_display"):
        target_art_key = _normalizar_clave_texto(target_artist)
        block_art_key = _normalizar_clave_texto(fields.get("artists_display"))
        if (
            target_art_key
            and block_art_key
            and target_art_key not in block_art_key
            and block_art_key not in target_art_key
        ):
            return False
    return True


def _guardar_cancion_ordenada_en_word(doc, entry):
    """Organiza Sección 4 en Heading 2 (Álbum/Playlist) -> Heading 3 (01. Pista) y fusiona notas."""
    _asegurar_ultimo_parrafo_vacio(doc)
    sec_start, sec_end = _buscar_rango_seccion(doc, "music")
    if sec_start is None:
        sec_start = 1

    target_group_heading = _encabezado_grupo_album(entry)
    target_group_key = _clave_grupo_album(target_group_heading)
    groups = _recolectar_grupos_y_pistas_musica(doc, sec_start, sec_end)

    matched_group = next(
        (g for g in groups if g["group_key"] == target_group_key), None
    )
    if matched_group is None:
        insert_pos = sec_end
        insert_pos = _insertar_parrafo_antes(
            doc,
            insert_pos,
            -3,
            label_prefix="",
            text=target_group_heading,
            font_size=13,
            bold_all=True,
        )
        _insertar_parrafo_antes(doc, insert_pos, -1, label_prefix="", text="")
        sec_start, sec_end = _buscar_rango_seccion(doc, "music")
        groups = _recolectar_grupos_y_pistas_musica(doc, sec_start or 1, sec_end)
        matched_group = next(
            (g for g in groups if g["group_key"] == target_group_key), None
        )
    elif len(target_group_heading) > len(matched_group["heading"]):
        _aplicar_estilo_parrafo(
            doc,
            matched_group["h2_idx"],
            -3,
            "",
            target_group_heading,
            font_size=13,
            bold_all=True,
        )

    if matched_group is None:
        spec = formatear_entrada_ingles(entry)
        _insertar_bloque_lineas(doc, sec_end, -4, spec["heading"], 11.5, spec["lines"])
        return spec

    merged_entry = dict(entry)
    target_title = _limpiar_linea(entry.get("song_title"))
    target_artist = _limpiar_linea(entry.get("artists_display"))

    for tr in matched_group["tracks"]:
        body_lines = [
            _texto_parrafo_limpio(doc.Paragraphs(p_i))
            for p_i in range(tr["h3_idx"] + 1, tr["end_idx"])
        ]
        existing_fields = _extraer_campos_bloque_word(body_lines, tr["heading"])
        if _coincide_cancion_en_bloque(
            existing_fields, tr["heading"], target_title, target_artist
        ):
            merged_entry = _combinar_metadata_cancion_word(existing_fields, entry)
            del_start = doc.Paragraphs(tr["h3_idx"]).Range.Start
            del_end = doc.Paragraphs(tr["end_idx"]).Range.Start
            if del_end > del_start:
                doc.Range(del_start, del_end).Delete()
            break

    spec = formatear_entrada_ingles(merged_entry)
    sec_start, sec_end = _buscar_rango_seccion(doc, "music")
    groups = _recolectar_grupos_y_pistas_musica(doc, sec_start or 1, sec_end)
    matched_group = next(
        (g for g in groups if g["group_key"] == target_group_key), None
    )
    if matched_group is None:
        _insertar_bloque_lineas(doc, sec_end, -4, spec["heading"], 11.5, spec["lines"])
        return spec

    new_sort_key = _clave_orden_pista(
        spec.get("track_number"), merged_entry.get("song_title")
    )
    insert_at = matched_group["end_idx"]
    for tr in matched_group["tracks"]:
        existing_key = _clave_orden_pista(tr.get("track_num"), tr.get("song_key"))
        if existing_key > new_sort_key:
            insert_at = tr["h3_idx"]
            break

    _insertar_bloque_lineas(doc, insert_at, -4, spec["heading"], 11.5, spec["lines"])
    return spec


_OOXML_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_OOXML_XML_NS = "{http://www.w3.org/XML/1998/namespace}"
_CTRL_XML_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _sanitizar_xml_texto(texto):
    return _CTRL_XML_RE.sub("", str(texto or ""))


def _ooxml_w_tag(name):
    return f"{_OOXML_W_NS}{name}"


def _ooxml_w_el(tag_name, **attrs):
    attrib = {_ooxml_w_tag(k): str(v) for k, v in attrs.items() if v is not None}
    return ET.Element(_ooxml_w_tag(tag_name), attrib)


def _ooxml_cargar_estilos_mapa(zf):
    """Lee word/styles.xml una vez y devuelve niveles (0..3) e IDs clave (heading/toc/hyperlink)."""
    levels = {}
    ids = {
        "heading_1": "Heading1",
        "heading_2": "Heading2",
        "heading_3": "Heading3",
        "toc_1": "TOC1",
        "toc_2": "TOC2",
        "toc_3": "TOC3",
        "hyperlink": "Hyperlink",
    }
    if "word/styles.xml" not in zf.namelist():
        return {"levels": levels, "ids": ids}

    root = ET.fromstring(zf.read("word/styles.xml"))
    val_attr = _ooxml_w_tag("val")
    id_attr = _ooxml_w_tag("styleId")
    for style in root.findall(f".//{_ooxml_w_tag('style')}"):
        sid = style.attrib.get(id_attr, "")
        if not sid:
            continue
        name_el = style.find(_ooxml_w_tag("name"))
        name_val = (
            (name_el.attrib.get(val_attr, "") if name_el is not None else "")
            .strip()
            .lower()
        )
        if name_val in ("heading 1", "heading 2", "heading 3"):
            lvl = int(name_val.rsplit(" ", 1)[1])
            levels[sid] = lvl
            ids[f"heading_{lvl}"] = sid
            continue
        if name_val in ("toc 1", "toc 2", "toc 3"):
            lvl = int(name_val.rsplit(" ", 1)[1])
            levels[sid] = 0
            ids[f"toc_{lvl}"] = sid
            continue
        if name_val.startswith("toc"):
            levels[sid] = 0
            continue
        if name_val == "hyperlink":
            ids["hyperlink"] = sid
            continue
        lvl_el = style.find(f"{_ooxml_w_tag('pPr')}/{_ooxml_w_tag('outlineLvl')}")
        if lvl_el is not None:
            raw_lvl = lvl_el.attrib.get(val_attr, "")
            if raw_lvl in ("0", "1", "2"):
                levels[sid] = int(raw_lvl) + 1
    return {"levels": levels, "ids": ids}


def _ooxml_crear_rpr(
    font_size=None,
    bold=False,
    italic=False,
    color=None,
    rstyle=None,
    no_proof=False,
    web_hidden=False,
    use_arial=True,
):
    rpr = _ooxml_w_el("rPr")
    if rstyle:
        rpr.append(_ooxml_w_el("rStyle", val=rstyle))
    if use_arial:
        rpr.append(_ooxml_w_el("rFonts", ascii="Arial", hAnsi="Arial", cs="Arial"))
    if bold:
        rpr.append(_ooxml_w_el("b"))
    if italic:
        rpr.append(_ooxml_w_el("i"))
    if no_proof:
        rpr.append(_ooxml_w_el("noProof"))
    if color:
        rpr.append(_ooxml_w_el("color", val=color))
    if font_size is not None:
        rpr.append(_ooxml_w_el("sz", val=int(round(float(font_size) * 2))))
    if web_hidden:
        rpr.append(_ooxml_w_el("webHidden"))
    return rpr


def _ooxml_crear_run_texto(
    text,
    font_size=11,
    bold=False,
    italic=False,
    color=None,
    rstyle=None,
    no_proof=False,
):
    run = _ooxml_w_el("r")
    run.append(
        _ooxml_crear_rpr(
            font_size=font_size,
            bold=bold,
            italic=italic,
            color=color,
            rstyle=rstyle,
            no_proof=no_proof,
        )
    )
    t_el = _ooxml_w_el("t")
    clean = _sanitizar_xml_texto(text)
    if clean and (clean[0].isspace() or clean[-1].isspace()):
        t_el.attrib[f"{_OOXML_XML_NS}space"] = "preserve"
    t_el.text = clean
    run.append(t_el)
    return run


def _ooxml_crear_parrafo_texto(
    style_id="",
    label_prefix="",
    text="",
    font_size=11,
    bold_all=False,
    italic=False,
    muted=False,
):
    p = _ooxml_w_el("p")
    if style_id:
        ppr = _ooxml_w_el("pPr")
        ppr.append(_ooxml_w_el("pStyle", val=style_id))
        p.append(ppr)
    color = "666666" if muted else None
    if label_prefix:
        p.append(
            _ooxml_crear_run_texto(
                label_prefix,
                font_size=font_size,
                bold=True,
                italic=italic,
                color=color,
            )
        )
    if text:
        p.append(
            _ooxml_crear_run_texto(
                text,
                font_size=font_size,
                bold=bool(bold_all),
                italic=italic,
                color=color,
            )
        )
    return p


def _ooxml_construir_bloque_elementos(
    heading_text, heading_style_id, heading_size, spec_lines
):
    elems = [
        _ooxml_crear_parrafo_texto(
            style_id=heading_style_id,
            text=heading_text,
            font_size=heading_size,
            bold_all=True,
        )
    ]
    for item in spec_lines or []:
        elems.append(
            _ooxml_crear_parrafo_texto(
                label_prefix=item.get("label", ""),
                text=item.get("text", ""),
                font_size=item.get("size", 11),
                italic=bool(item.get("italic", False)),
                muted=bool(item.get("muted", False)),
            )
        )
    elems.append(_ooxml_w_el("p"))
    return elems


def _ooxml_establecer_texto_heading(p_elem, heading_text, font_size):
    """Actualiza el texto de un encabezado existente conservando su pPr y marcadores _Toc."""
    ppr_tag = _ooxml_w_tag("pPr")
    bm_start_tag = _ooxml_w_tag("bookmarkStart")
    bm_end_tag = _ooxml_w_tag("bookmarkEnd")
    name_attr = _ooxml_w_tag("name")

    ppr_el = None
    bm_starts = []
    bm_ends = []
    for child in list(p_elem):
        if child.tag == ppr_tag and ppr_el is None:
            ppr_el = child
        elif child.tag == bm_start_tag and str(
            child.attrib.get(name_attr, "")
        ).startswith("_Toc"):
            bm_starts.append(child)
        elif child.tag == bm_end_tag:
            bm_ends.append(child)
        p_elem.remove(child)

    if ppr_el is not None:
        p_elem.append(ppr_el)
    for bms in bm_starts:
        p_elem.append(bms)
    p_elem.append(_ooxml_crear_run_texto(heading_text, font_size=font_size, bold=True))
    if bm_starts:
        for bme in bm_ends:
            p_elem.append(bme)


def _ooxml_encontrar_rango_toc(body_children):
    """Encuentra el rango [start, end) de párrafos pertenecientes al campo TOC principal."""
    p_tag = _ooxml_w_tag("p")
    fld_tag = _ooxml_w_tag("fldChar")
    instr_tag = _ooxml_w_tag("instrText")
    ftype_attr = _ooxml_w_tag("fldCharType")

    depth = 0
    in_toc = False
    pending_start = None
    toc_start = None

    for idx, child in enumerate(body_children):
        if child.tag != p_tag:
            continue
        for elem in child.iter():
            if elem.tag == fld_tag:
                ftype = elem.attrib.get(ftype_attr, "")
                if ftype == "begin":
                    depth += 1
                    if not in_toc and depth == 1:
                        pending_start = idx
                elif ftype == "end":
                    if depth > 0:
                        depth -= 1
                    if in_toc and depth == 0:
                        return toc_start, idx + 1
                    if not in_toc and depth == 0:
                        pending_start = None
            elif elem.tag == instr_tag and pending_start is not None:
                if "TOC" in (elem.text or "").upper():
                    in_toc = True
                    toc_start = pending_start
    return (
        (toc_start, len(body_children))
        if in_toc and toc_start is not None
        else (None, None)
    )


def _ooxml_crear_run_oculto_campo(
    fld_type=None, instr_text=None, text=None, is_tab=False
):
    run = _ooxml_w_el("r")
    run.append(_ooxml_crear_rpr(no_proof=True, web_hidden=True, use_arial=False))
    if is_tab:
        run.append(_ooxml_w_el("tab"))
    elif fld_type:
        run.append(_ooxml_w_el("fldChar", fldCharType=fld_type))
    elif instr_text is not None:
        el = _ooxml_w_el("instrText")
        el.attrib[f"{_OOXML_XML_NS}space"] = "preserve"
        el.text = instr_text
        run.append(el)
    elif text is not None:
        el = _ooxml_w_el("t")
        el.text = text
        run.append(el)
    return run


def _ooxml_crear_parrafo_toc(lvl, title, bm_name, estilo_ids, is_first=False):
    p = _ooxml_w_el("p")
    ppr = _ooxml_w_el("pPr")
    ppr.append(_ooxml_w_el("pStyle", val=estilo_ids[f"toc_{lvl}"]))
    tabs = _ooxml_w_el("tabs")
    tabs.append(_ooxml_w_el("tab", val="right", leader="dot", pos="8828"))
    ppr.append(tabs)
    p.append(ppr)

    if is_first:
        r_begin = _ooxml_w_el("r")
        r_begin.append(_ooxml_w_el("fldChar", fldCharType="begin"))
        p.append(r_begin)

        r_instr = _ooxml_w_el("r")
        instr = _ooxml_w_el("instrText")
        instr.attrib[f"{_OOXML_XML_NS}space"] = "preserve"
        instr.text = ' TOC \\o "1-3" \\h \\z \\u '
        r_instr.append(instr)
        p.append(r_instr)

        r_sep = _ooxml_w_el("r")
        r_sep.append(_ooxml_w_el("fldChar", fldCharType="separate"))
        p.append(r_sep)

    hyperlink = _ooxml_w_el("hyperlink", anchor=bm_name, history="1")
    hyperlink.append(
        _ooxml_crear_run_texto(
            title,
            font_size=None,
            bold=True,
            rstyle=estilo_ids["hyperlink"],
            no_proof=True,
        )
    )
    hyperlink.append(_ooxml_crear_run_oculto_campo(is_tab=True))
    hyperlink.append(_ooxml_crear_run_oculto_campo(fld_type="begin"))
    hyperlink.append(
        _ooxml_crear_run_oculto_campo(instr_text=f" PAGEREF {bm_name} \\h ")
    )
    hyperlink.append(_ooxml_crear_run_oculto_campo(fld_type="separate"))
    hyperlink.append(_ooxml_crear_run_oculto_campo(text="1"))
    hyperlink.append(_ooxml_crear_run_oculto_campo(fld_type="end"))
    p.append(hyperlink)
    return p


def _ooxml_asegurar_bookmark_en_parrafo(p_elem, alloc_bm_fn):
    bm_start_tag = _ooxml_w_tag("bookmarkStart")
    name_attr = _ooxml_w_tag("name")
    for elem in p_elem.iter():
        if elem.tag == bm_start_tag:
            bname = elem.attrib.get(name_attr, "")
            if bname.startswith("_Toc"):
                return bname

    bm_id, bm_name = alloc_bm_fn()
    bms = _ooxml_w_el("bookmarkStart", id=bm_id, name=bm_name)
    bme = _ooxml_w_el("bookmarkEnd", id=bm_id)
    insert_pos = 1 if len(p_elem) > 0 and p_elem[0].tag == _ooxml_w_tag("pPr") else 0
    p_elem.insert(insert_pos, bms)
    p_elem.append(bme)
    return bm_name


def _ooxml_reconstruir_toc_con_enlaces(body, style_levels, estilo_ids):
    """Asegura marcadores _Toc en Heading 1..3 y reconstruye la TOC con hipervínculos."""
    p_tag = _ooxml_w_tag("p")
    bm_start_tag = _ooxml_w_tag("bookmarkStart")
    id_attr = _ooxml_w_tag("id")
    name_attr = _ooxml_w_tag("name")

    max_id = 0
    max_toc_num = 245632084
    for elem in body.iter():
        if elem.tag == bm_start_tag:
            raw_id = elem.attrib.get(id_attr, "")
            if raw_id.isdigit():
                max_id = max(max_id, int(raw_id))
            bname = elem.attrib.get(name_attr, "")
            if bname.startswith("_Toc") and bname[4:].isdigit():
                max_toc_num = max(max_toc_num, int(bname[4:]))

    bm_state = [max_id, max_toc_num]

    def _alloc_bm():
        bm_state[0] += 1
        bm_state[1] += 1
        return bm_state[0], f"_Toc{bm_state[1]}"

    children = list(body)
    toc_start, toc_end = _ooxml_encontrar_rango_toc(children)

    toc_entries = []
    first_h1_idx = None
    for idx, child in enumerate(children):
        if toc_start is not None and toc_start <= idx < toc_end:
            continue
        if child.tag != p_tag:
            continue
        lvl = _nivel_parrafo_ooxml(child, style_levels)
        if lvl == 1 and first_h1_idx is None:
            first_h1_idx = idx
        if lvl in (1, 2, 3):
            txt = _texto_parrafo_ooxml(child)
            if txt:
                bm_name = _ooxml_asegurar_bookmark_en_parrafo(child, _alloc_bm)
                toc_entries.append((lvl, txt, bm_name))

    new_toc_ps = [
        _ooxml_crear_parrafo_toc(lvl, txt, bm_name, estilo_ids, is_first=(i == 0))
        for i, (lvl, txt, bm_name) in enumerate(toc_entries)
    ]
    end_p = _ooxml_w_el("p")
    if not new_toc_ps:
        r_b = _ooxml_w_el("r")
        r_b.append(_ooxml_w_el("fldChar", fldCharType="begin"))
        end_p.append(r_b)
        r_i = _ooxml_w_el("r")
        it = _ooxml_w_el("instrText")
        it.attrib[f"{_OOXML_XML_NS}space"] = "preserve"
        it.text = ' TOC \\o "1-3" \\h \\z \\u '
        r_i.append(it)
        end_p.append(r_i)
        r_s = _ooxml_w_el("r")
        r_s.append(_ooxml_w_el("fldChar", fldCharType="separate"))
        end_p.append(r_s)
    r_end = _ooxml_w_el("r")
    r_end.append(_ooxml_w_el("fldChar", fldCharType="end"))
    end_p.append(r_end)
    new_toc_ps.append(end_p)

    if toc_start is not None:
        for old_el in children[toc_start:toc_end]:
            body.remove(old_el)
        for offset, new_el in enumerate(new_toc_ps):
            body.insert(toc_start + offset, new_el)
    else:
        insert_pos = first_h1_idx if first_h1_idx is not None else min(2, len(children))
        toc_title_p = _ooxml_crear_parrafo_texto(
            text="Table of Contents", font_size=13, bold_all=True
        )
        block = [toc_title_p, *new_toc_ps, _ooxml_w_el("p")]
        for offset, new_el in enumerate(block):
            body.insert(insert_pos + offset, new_el)


def _ooxml_indice_sectpr(body):
    sect_tag = _ooxml_w_tag("sectPr")
    for idx, child in enumerate(list(body)):
        if child.tag == sect_tag:
            return idx
    return len(body)


def _ooxml_items_cuerpo(body, style_levels):
    p_tag = _ooxml_w_tag("p")
    items = []
    for child in body:
        if child.tag == p_tag:
            items.append(
                (_nivel_parrafo_ooxml(child, style_levels), _texto_parrafo_ooxml(child))
            )
        else:
            items.append((None, ""))
    return items


def _ooxml_buscar_rango_seccion(body, style_levels, category, toc_range=None):
    items = _ooxml_items_cuerpo(body, style_levels)
    sect_idx = _ooxml_indice_sectpr(body)
    titulo_esperado = SECCIONES_INGLES[category].lower()
    prefijo = _PREFIJOS_SECCION_INGLES[category]
    t_start, t_end = toc_range if toc_range and toc_range[0] is not None else (-1, -1)

    sec_start = None
    for idx in range(sect_idx):
        if t_start <= idx < t_end:
            continue
        lvl, txt = items[idx]
        if lvl == 1:
            low = txt.lower()
            if low == titulo_esperado or low.startswith(prefijo):
                sec_start = idx
                break

    eof_end = sect_idx
    if (
        sect_idx > 0
        and body[sect_idx - 1].tag == _ooxml_w_tag("p")
        and items[sect_idx - 1] == (None, "")
    ):
        eof_end = sect_idx - 1

    if sec_start is None:
        return None, eof_end, items

    for j in range(sec_start + 1, sect_idx):
        if t_start <= j < t_end:
            continue
        if items[j][0] == 1:
            return sec_start, j, items

    return sec_start, eof_end, items


def _agrupar_musica_desde_items(items, sec_start, sec_end):
    """Construye estructura de álbumes/playlists (Heading 2) y pistas (Heading 3)."""
    groups = []
    current_group = None
    for idx in range(sec_start + 1, sec_end):
        level, text = items[idx]
        if level == 2:
            if current_group is not None:
                current_group["end_idx"] = idx
                if current_group["tracks"]:
                    current_group["tracks"][-1]["end_idx"] = idx
            current_group = {
                "h2_idx": idx,
                "end_idx": sec_end,
                "heading": text,
                "group_key": _clave_grupo_album(text),
                "tracks": [],
            }
            groups.append(current_group)
        elif level == 3 and current_group is not None:
            if current_group["tracks"]:
                current_group["tracks"][-1]["end_idx"] = idx
            current_group["tracks"].append(
                {
                    "h3_idx": idx,
                    "end_idx": sec_end,
                    "heading": text,
                    "track_num": _extraer_numero_pista(text),
                    "song_key": _normalizar_clave_texto(
                        _quitar_prefijo_pista(text).split(" — ", 1)[0]
                    ),
                }
            )
    if current_group is not None:
        current_group["end_idx"] = sec_end
        if current_group["tracks"]:
            current_group["tracks"][-1]["end_idx"] = sec_end
    return groups


def _ooxml_asegurar_secciones_y_final(body, style_levels, estilo_ids):
    """Asegura párrafo vacío final antes de sectPr y las 4 secciones Heading 1."""
    p_tag = _ooxml_w_tag("p")
    sect_idx = _ooxml_indice_sectpr(body)
    if (
        sect_idx == 0
        or body[sect_idx - 1].tag != p_tag
        or _texto_parrafo_ooxml(body[sect_idx - 1])
    ):
        body.insert(sect_idx, _ooxml_w_el("p"))

    toc_range = _ooxml_encontrar_rango_toc(list(body))
    t_start, t_end = toc_range if toc_range[0] is not None else (-1, -1)
    present = []
    sect_idx = _ooxml_indice_sectpr(body)
    for idx in range(sect_idx):
        if t_start <= idx < t_end:
            continue
        if (
            body[idx].tag == p_tag
            and _nivel_parrafo_ooxml(body[idx], style_levels) == 1
        ):
            present.append(_texto_parrafo_ooxml(body[idx]).lower())

    for cat in ("vocabulary", "grammar", "phrasal_verb", "music"):
        titulo = SECCIONES_INGLES[cat]
        pref = _PREFIJOS_SECCION_INGLES[cat]
        if any(h == titulo.lower() or h.startswith(pref) for h in present):
            continue
        insert_pos = max(0, _ooxml_indice_sectpr(body) - 1)
        body.insert(
            insert_pos,
            _ooxml_crear_parrafo_texto(
                style_id=estilo_ids["heading_1"],
                text=titulo,
                font_size=15,
                bold_all=True,
            ),
        )
        body.insert(insert_pos + 1, _ooxml_w_el("p"))


def _ooxml_serializar_documento(doc_root, orig_xml_bytes):
    orig_str = orig_xml_bytes.decode("utf-8")
    ns_pairs = []
    m_open = re.search(r"<w:document\b([^>]*)>", orig_str)
    if m_open:
        ns_pairs = re.findall(r'\bxmlns:([A-Za-z0-9_]+)="([^"]+)"', m_open.group(1))
        for prefix, uri in ns_pairs:
            if prefix != "xml":
                ET.register_namespace(prefix, uri)

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
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml_out
    ).encode("utf-8")


def _guardar_entrada_ingles_en_docx_xml(archivo, entry):
    """Inserta o actualiza una entrada directamente vía OOXML ZIP/XML en milisegundos sin abrir WINWORD.EXE."""
    with zipfile.ZipFile(archivo, "r") as zf:
        estilos = _ooxml_cargar_estilos_mapa(zf)
        orig_doc_bytes = zf.read("word/document.xml")

    style_levels = estilos["levels"]
    estilo_ids = estilos["ids"]
    doc_root = ET.fromstring(orig_doc_bytes)
    body = doc_root.find(_ooxml_w_tag("body"))
    if body is None:
        raise ET.ParseError("word/document.xml sin elemento w:body")

    _ooxml_asegurar_secciones_y_final(body, style_levels, estilo_ids)

    if (entry.get("category") or "").strip().lower() == "music":
        toc_range = _ooxml_encontrar_rango_toc(list(body))
        sec_start, sec_end, items = _ooxml_buscar_rango_seccion(
            body, style_levels, "music", toc_range
        )
        if sec_start is None:
            sec_start = 0

        target_group_heading = _encabezado_grupo_album(entry)
        target_group_key = _clave_grupo_album(target_group_heading)
        groups = _agrupar_musica_desde_items(items, sec_start, sec_end)
        matched_group = next(
            (g for g in groups if g["group_key"] == target_group_key), None
        )

        if matched_group is None:
            body.insert(
                sec_end,
                _ooxml_crear_parrafo_texto(
                    style_id=estilo_ids["heading_2"],
                    text=target_group_heading,
                    font_size=13,
                    bold_all=True,
                ),
            )
            body.insert(sec_end + 1, _ooxml_w_el("p"))
            toc_range = _ooxml_encontrar_rango_toc(list(body))
            sec_start, sec_end, items = _ooxml_buscar_rango_seccion(
                body, style_levels, "music", toc_range
            )
            groups = _agrupar_musica_desde_items(items, sec_start or 0, sec_end)
            matched_group = next(
                (g for g in groups if g["group_key"] == target_group_key), None
            )
        elif len(target_group_heading) > len(matched_group["heading"]):
            _ooxml_establecer_texto_heading(
                body[matched_group["h2_idx"]], target_group_heading, 13
            )

        if matched_group is None:
            spec = formatear_entrada_ingles(entry)
            bloque = _ooxml_construir_bloque_elementos(
                spec["heading"], estilo_ids["heading_3"], 11.5, spec["lines"]
            )
            for offset, el in enumerate(bloque):
                body.insert(sec_end + offset, el)
        else:
            merged_entry = dict(entry)
            target_title = _limpiar_linea(entry.get("song_title"))
            target_artist = _limpiar_linea(entry.get("artists_display"))

            for tr in matched_group["tracks"]:
                body_lines = [
                    _texto_parrafo_ooxml(body[p_i])
                    for p_i in range(tr["h3_idx"] + 1, tr["end_idx"])
                ]
                existing_fields = _extraer_campos_bloque_word(body_lines, tr["heading"])
                if _coincide_cancion_en_bloque(
                    existing_fields, tr["heading"], target_title, target_artist
                ):
                    merged_entry = _combinar_metadata_cancion_word(
                        existing_fields, entry
                    )
                    for rm_el in list(body)[tr["h3_idx"] : tr["end_idx"]]:
                        body.remove(rm_el)
                    break

            spec = formatear_entrada_ingles(merged_entry)
            toc_range = _ooxml_encontrar_rango_toc(list(body))
            sec_start, sec_end, items = _ooxml_buscar_rango_seccion(
                body, style_levels, "music", toc_range
            )
            groups = _agrupar_musica_desde_items(items, sec_start or 0, sec_end)
            matched_group = next(
                (g for g in groups if g["group_key"] == target_group_key), None
            )

            if matched_group is None:
                insert_at = sec_end
            else:
                new_sort_key = _clave_orden_pista(
                    spec.get("track_number"), merged_entry.get("song_title")
                )
                insert_at = matched_group["end_idx"]
                for tr in matched_group["tracks"]:
                    existing_key = _clave_orden_pista(
                        tr.get("track_num"), tr.get("song_key")
                    )
                    if existing_key > new_sort_key:
                        insert_at = tr["h3_idx"]
                        break

            bloque = _ooxml_construir_bloque_elementos(
                spec["heading"], estilo_ids["heading_3"], 11.5, spec["lines"]
            )
            for offset, el in enumerate(bloque):
                body.insert(insert_at + offset, el)
    else:
        spec = formatear_entrada_ingles(entry)
        toc_range = _ooxml_encontrar_rango_toc(list(body))
        _, sec_end, _ = _ooxml_buscar_rango_seccion(
            body, style_levels, spec["category"], toc_range
        )
        bloque = _ooxml_construir_bloque_elementos(
            spec["heading"], estilo_ids["heading_2"], 12, spec["lines"]
        )
        for offset, el in enumerate(bloque):
            body.insert(sec_end + offset, el)

    _ooxml_reconstruir_toc_con_enlaces(body, style_levels, estilo_ids)
    new_doc_bytes = _ooxml_serializar_documento(doc_root, orig_doc_bytes)

    tmp_zip = f"{archivo}.tmp.{os.getpid()}.{threading.get_ident()}"
    try:
        with zipfile.ZipFile(archivo, "r") as zin, zipfile.ZipFile(
            tmp_zip, "w"
        ) as zout:
            for info in zin.infolist():
                payload = (
                    new_doc_bytes
                    if info.filename == "word/document.xml"
                    else zin.read(info.filename)
                )
                zout.writestr(info, payload)
        os.replace(tmp_zip, archivo)
    finally:
        if os.path.exists(tmp_zip):
            try:
                os.remove(tmp_zip)
            except Exception:
                pass

    _asegurar_permisos_abiertos_word(archivo)
    logging.info(
        f"English Notebook actualizado [{spec['category']}] (OOXML): {spec['heading']}"
    )
    return True


_ENGLISH_WORD_DRIVE_STATE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".english_word_drive_state.json"
)
_word_drive_sync_lock = threading.Lock()
_word_watch_cache = {"mtime_ns": None, "size": None, "sha256": None, "last_attempt": 0.0}


def _leer_ultimo_hash_word_drive():
    try:
        if os.path.exists(_ENGLISH_WORD_DRIVE_STATE_PATH):
            with open(_ENGLISH_WORD_DRIVE_STATE_PATH, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                return str(data.get("sha256") or "")
    except Exception:
        pass
    return ""


def _guardar_ultimo_hash_word_drive(sha256_hex, remote_target="", remote_size=0, verified=False):
    try:
        tmp = f"{_ENGLISH_WORD_DRIVE_STATE_PATH}.tmp.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "sha256": sha256_hex,
                    "remoteTarget": remote_target,
                    "remoteSize": remote_size,
                    "verified": bool(verified),
                    "updatedAt": int(time.time()),
                },
                fh,
            )
        os.replace(tmp, _ENGLISH_WORD_DRIVE_STATE_PATH)
    except Exception:
        pass


def sincronizar_word_estudio_a_drive(ruta_docx_estudio=None, blocking=False, expected_sha256=None):
    """
    Envía ÚNICAMENTE English_Learning_Notebook.docx al servidor EC2 por el puente HMAC
    para subirlo automáticamente al Google Drive configurado sin requerir rclone en la PC.
    Jamás sube el documento de bitácora personal (Journal / RUTA_WORD).
    """
    _, ruta_eng = resolver_rutas_word()
    target = os.path.abspath(ruta_docx_estudio or ruta_eng or DEFAULT_ENGLISH_WORD_PATH)
    if RUTA_WORD and os.path.abspath(RUTA_WORD) == target:
        logging.error("SEGURIDAD: Se bloqueó intento de subir Journal.docx a Google Drive.")
        return False
    if not os.path.exists(target):
        return False

    def _subir_via_ec2_drive():
        with _word_drive_sync_lock:
            try:
                with open(target, "rb") as fh:
                    raw_docx = fh.read()
                if not raw_docx or len(raw_docx) > (12 * 1024 * 1024):
                    return False
                current_sha = expected_sha256 or hashlib.sha256(raw_docx).hexdigest()
                raw_b64 = base64.b64encode(raw_docx).decode("ascii")
                envelope_obj = {
                    "filename": "English_Learning_Notebook.docx",
                    "docxB64": raw_b64,
                }
                payload_b64 = base64.b64encode(
                    json.dumps(envelope_obj, ensure_ascii=False).encode("utf-8")
                ).decode("ascii")
                if len(payload_b64) > 14500000:
                    payload_b64 = raw_b64
                endpoint = "/api/english/music/pc-word-drive-sync"
                url_sync = obtener_url_aws(endpoint)
                headers = _firmar_pc_request("POST", endpoint, payload_b64)
                resp = _get_http_session().post(
                    url_sync,
                    json={"encryptedResult": payload_b64},
                    headers=headers,
                    timeout=40,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("uploaded"):
                        _guardar_ultimo_hash_word_drive(
                            current_sha,
                            remote_target=str(data.get("remoteTarget") or ""),
                            remote_size=int(data.get("remoteSize") or len(raw_docx)),
                            verified=bool(data.get("verified", True)),
                        )
                        logging.info(
                            f"Word de Idiomas respaldado y verificado en Google Drive: "
                            f"{data.get('remoteTarget')} ({data.get('remoteSize') or len(raw_docx)} bytes)"
                        )
                        return True
                    logging.warning(
                        f"Servidor no pudo subir Word a Drive (uploaded=false): {data.get('message') or data}"
                    )
                    return False
                logging.warning(
                    f"No se pudo sincronizar Word a Drive (HTTP {resp.status_code}): {resp.text[:180]}. Se reintentará."
                )
                return False
            except Exception as exc:
                logging.warning(f"Error temporal sincronizando Word de Idiomas a Drive (reintentará): {exc}")
                return False

    if blocking:
        return _subir_via_ec2_drive()
    threading.Thread(target=_subir_via_ec2_drive, name="drive-study-sync", daemon=True).start()
    return True


def _sincronizar_word_si_cambio():
    """Detecta cambios manuales o automáticos en English_Learning_Notebook.docx y lo sube a Drive."""
    try:
        _, ruta_eng = resolver_rutas_word()
        target = os.path.abspath(ruta_eng or DEFAULT_ENGLISH_WORD_PATH)
        if not os.path.exists(target):
            return False
        if RUTA_WORD and os.path.abspath(RUTA_WORD) == target:
            return False
        st = os.stat(target)
        now = time.time()
        mtime_ns = getattr(st, "st_mtime_ns", int(st.st_mtime * 1e9))
        if (
            _word_watch_cache["mtime_ns"] == mtime_ns
            and _word_watch_cache["size"] == st.st_size
            and (now - _word_watch_cache["last_attempt"]) < 30.0
        ):
            return False
        with open(target, "rb") as fh:
            raw_bytes = fh.read()
        if not raw_bytes or len(raw_bytes) < 64 or not raw_bytes.startswith(b"PK"):
            return False
        current_sha = hashlib.sha256(raw_bytes).hexdigest()
        _word_watch_cache["mtime_ns"] = mtime_ns
        _word_watch_cache["size"] = st.st_size
        last_uploaded = _word_watch_cache["sha256"] or _leer_ultimo_hash_word_drive()
        if current_sha == last_uploaded:
            _word_watch_cache["sha256"] = current_sha
            return False
        _word_watch_cache["last_attempt"] = now
        if sincronizar_word_estudio_a_drive(target, blocking=True, expected_sha256=current_sha):
            _word_watch_cache["sha256"] = current_sha
            return True
    except (PermissionError, OSError):
        pass
    except Exception as exc:
        logging.debug(f"Vigilancia automática Word -> Drive: {exc}")
    return False


def _word_file_watch_loop():
    """Vigila periódicamente cambios en el Word de Estudio para subirlo automáticamente a Drive."""
    while True:
        _sincronizar_word_si_cambio()
        time.sleep(5.0)


def agregar_entrada_ingles_a_word(entry, ruta_docx=None):
    """Inserta u organiza una entrada en English_Learning_Notebook.docx y actualiza su TOC."""
    if ruta_docx:
        archivo = os.path.abspath(ruta_docx)
    else:
        _, ruta_english = resolver_rutas_word()
        if (not ruta_english or not os.path.exists(ruta_english)) and os.environ.get(
            "GITHUB_TOKEN", ""
        ).strip():
            _, ruta_english = resolver_rutas_word(refresh_cache=True)
        archivo = os.path.abspath(ruta_english or DEFAULT_ENGLISH_WORD_PATH)

    if os.path.exists(archivo):
        with _english_docx_lock:
            try:
                ok_xml = _guardar_entrada_ingles_en_docx_xml(archivo, entry)
                if ok_xml:
                    sincronizar_word_estudio_a_drive(archivo)
                return ok_xml
            except PermissionError:
                logging.warning(
                    "English Notebook abierto o bloqueado temporalmente en Word/OneDrive; se reintentará."
                )
                return False
            except (zipfile.BadZipFile, KeyError, ET.ParseError) as xml_err:
                logging.warning(
                    f"Escritura OOXML omitida ({xml_err}); se usará Word COM como respaldo."
                )

    with _word_com_lock:
        if win32com is None:
            logging.warning(
                "win32com no disponible para crear English Notebook por primera vez."
            )
            return False

        com_init = False
        word = None
        doc = None
        saved_ok = False
        try:
            com_init, word = _iniciar_word_com_oculto()

            doc = _asegurar_documento_ingles(word, archivo)
            if (entry.get("category") or "").strip().lower() == "music":
                spec = _guardar_cancion_ordenada_en_word(doc, entry)
            else:
                spec = formatear_entrada_ingles(entry)
                target_idx = _buscar_indice_insercion_seccion(doc, spec["category"])
                _insertar_bloque_lineas(
                    doc, target_idx, -3, spec["heading"], 12, spec["lines"]
                )

            _actualizar_toc_ingles(doc)
            _asegurar_edicion_abierta_word_doc(doc)
            doc.Save()
            saved_ok = True
            logging.info(
                f"English Notebook actualizado [{spec['category']}]: {spec['heading']}"
            )
            return True

        except Exception as e:
            logging.warning(
                f"No se pudo actualizar English Notebook Word. Se reintentara mas tarde. Detalles: {e}"
            )
            return False

        finally:
            if doc:
                try:
                    doc.Close(SaveChanges=0)
                except Exception:
                    pass
            if word:
                try:
                    word.Quit()
                except Exception:
                    pass
            if com_init and pythoncom is not None:
                try:
                    pythoncom.CoUninitialize()
                except Exception:
                    pass
            if saved_ok:
                _asegurar_permisos_abiertos_word(archivo)
                sincronizar_word_estudio_a_drive(archivo)


def _buscar_cancion_en_grupos(
    groups, get_lines_fn, target_title, target_artist, target_album_key
):
    """Recorre grupos Heading 2 -> pistas Heading 3 (y fallback Heading 2) buscando letra guardada."""
    ordered_groups = sorted(
        groups,
        key=lambda g: (
            0 if target_album_key and g["group_key"] == target_album_key else 1
        ),
    )
    for grp in ordered_groups:
        for tr in grp["tracks"]:
            lines = get_lines_fn(tr["h3_idx"] + 1, tr["end_idx"])
            fields = _extraer_campos_bloque_word(lines, tr["heading"])
            if _coincide_cancion_en_bloque(
                fields, tr["heading"], target_title, target_artist
            ):
                lyrics_val = str(fields.get("lyrics_study") or "").strip()
                if lyrics_val:
                    return {
                        "found": True,
                        "lyrics": lyrics_val,
                        "language": fields.get("language") or "",
                        "album_group": grp["heading"],
                        "track_heading": tr["heading"],
                        "fields": fields,
                    }

    for grp in groups:
        if not grp["tracks"]:
            lines = get_lines_fn(grp["h2_idx"] + 1, grp["end_idx"])
            fields = _extraer_campos_bloque_word(lines, grp["heading"])
            if _coincide_cancion_en_bloque(
                fields, grp["heading"], target_title, target_artist
            ):
                lyrics_val = str(fields.get("lyrics_study") or "").strip()
                if lyrics_val:
                    return {
                        "found": True,
                        "lyrics": lyrics_val,
                        "language": fields.get("language") or "",
                        "album_group": grp["heading"],
                        "track_heading": grp["heading"],
                        "fields": fields,
                    }
    return None


def _leer_estilos_heading_docx(zf):
    """Mapea styleId -> nivel (1..3, o 0 para TOC) leyendo word/styles.xml."""
    return _ooxml_cargar_estilos_mapa(zf)["levels"]


def _texto_parrafo_ooxml(p_elem):
    """Extrae texto limpio de un elemento <w:p> preservando saltos y tabulaciones."""
    t_tag = f"{_OOXML_W_NS}t"
    br_tag = f"{_OOXML_W_NS}br"
    cr_tag = f"{_OOXML_W_NS}cr"
    tab_tag = f"{_OOXML_W_NS}tab"
    parts = []
    for elem in p_elem.iter():
        if elem.tag == t_tag and elem.text:
            parts.append(elem.text)
        elif elem.tag in (br_tag, cr_tag):
            parts.append("\n")
        elif elem.tag == tab_tag:
            parts.append("\t")
    return "".join(parts).replace("\r", "").replace("\x07", "").strip()


def _nivel_parrafo_ooxml(p_elem, style_levels):
    """Determina nivel jerárquico (1..3, 0 si TOC, None si normal) de un <w:p>."""
    val_attr = f"{_OOXML_W_NS}val"
    ppr = p_elem.find(f"{_OOXML_W_NS}pPr")
    if ppr is None:
        return None
    pstyle_el = ppr.find(f"{_OOXML_W_NS}pStyle")
    style_id = pstyle_el.attrib.get(val_attr, "") if pstyle_el is not None else ""
    if style_id in style_levels:
        mapped = style_levels[style_id]
        if mapped == 0:
            return 0
        return mapped
    lvl_el = ppr.find(f"{_OOXML_W_NS}outlineLvl")
    if lvl_el is not None:
        raw_lvl = lvl_el.attrib.get(val_attr, "")
        if raw_lvl in ("0", "1", "2"):
            return int(raw_lvl) + 1
    norm_sid = re.sub(r"[^a-z0-9]", "", style_id.lower())
    if norm_sid in ("heading1", "titulo1", "ttulo1"):
        return 1
    if norm_sid in ("heading2", "titulo2", "ttulo2"):
        return 2
    if norm_sid in ("heading3", "titulo3", "ttulo3"):
        return 3
    if norm_sid.startswith("toc") or norm_sid.startswith("tdc"):
        return 0
    return None


def _buscar_letra_en_docx_xml(archivo, target_title, target_artist, target_album_key):
    """Lee un .docx directamente vía ZIP/XML en milisegundos sin lanzar WINWORD.EXE."""
    with zipfile.ZipFile(archivo, "r") as zf:
        style_levels = _leer_estilos_heading_docx(zf)
        doc_root = ET.fromstring(zf.read("word/document.xml"))

    body = doc_root.find(f"{_OOXML_W_NS}body")
    if body is None:
        return None

    sec_start, sec_end, paragraphs = _ooxml_buscar_rango_seccion(
        body, style_levels, "music"
    )
    if sec_start is None:
        return None

    groups = _agrupar_musica_desde_items(paragraphs, sec_start, sec_end)

    return _buscar_cancion_en_grupos(
        groups,
        lambda start, end: [paragraphs[i][1] for i in range(start, end)],
        target_title,
        target_artist,
        target_album_key,
    )


def _cache_key_cancion(song_title, artists_display=""):
    return f"{_normalizar_clave_texto(song_title)}::{_normalizar_clave_texto(artists_display)}"


def _registrar_letra_reciente_ram(
    song_title,
    artists_display,
    lyrics_text,
    language="",
    album_group="",
    track_heading="",
    pending_write=True,
):
    key = _cache_key_cancion(song_title, artists_display)
    if not key or not lyrics_text:
        return
    now = time.time()
    with _recent_lyrics_lock:
        if len(_RECENT_EXTRACTED_CACHE) >= 100:
            oldest_key = min(
                _RECENT_EXTRACTED_CACHE,
                key=lambda k: _RECENT_EXTRACTED_CACHE[k].get("ts", 0),
            )
            _RECENT_EXTRACTED_CACHE.pop(oldest_key, None)
        _RECENT_EXTRACTED_CACHE[key] = {
            "found": True,
            "lyrics": lyrics_text,
            "language": language or "",
            "album_group": album_group or "",
            "track_heading": track_heading or "",
            "fields": {"lyrics_study": lyrics_text, "language": language or ""},
            "pending": bool(pending_write),
            "ts": now,
        }


def _consultar_letra_reciente_ram(target_title, target_artist="", only_pending=False):
    key_exact = _cache_key_cancion(target_title, target_artist)
    key_title_only = _cache_key_cancion(target_title, "")
    now = time.time()
    with _recent_lyrics_lock:
        for k in (key_exact, key_title_only):
            item = _RECENT_EXTRACTED_CACHE.get(k)
            if not item:
                continue
            if (now - item.get("ts", 0)) > 1800:
                _RECENT_EXTRACTED_CACHE.pop(k, None)
                continue
            if only_pending and not item.get("pending"):
                continue
            return {k2: v2 for k2, v2 in item.items() if k2 not in ("pending", "ts")}
        if target_artist:
            title_prefix = f"{_normalizar_clave_texto(target_title)}::"
            for k, item in list(_RECENT_EXTRACTED_CACHE.items()):
                if not k.startswith(title_prefix):
                    continue
                if (now - item.get("ts", 0)) > 1800:
                    _RECENT_EXTRACTED_CACHE.pop(k, None)
                    continue
                if only_pending and not item.get("pending"):
                    continue
                return {
                    k2: v2 for k2, v2 in item.items() if k2 not in ("pending", "ts")
                }
    return None


def _marcar_letra_reciente_guardada(entry):
    if not isinstance(entry, dict):
        return
    key = _cache_key_cancion(
        entry.get("song_title") or "", entry.get("artists_display") or ""
    )
    with _recent_lyrics_lock:
        if key in _RECENT_EXTRACTED_CACHE:
            _RECENT_EXTRACTED_CACHE[key]["pending"] = False


def _pc_word_write_worker_loop():
    """Guarda entradas en Word en segundo plano para no bloquear al navegador ni los heartbeats."""
    deferred = []
    while True:
        try:
            timeout = 8.0 if deferred else 60.0
            try:
                item = _pc_word_write_queue.get(timeout=timeout)
            except queue.Empty:
                item = None

            if item is not None:
                entry = item.get("entry") if isinstance(item, dict) else item
                attempts = item.get("attempts", 0) if isinstance(item, dict) else 0
                ok = agregar_entrada_ingles_a_word(entry)
                if ok:
                    _marcar_letra_reciente_guardada(entry)
                elif attempts < 20:
                    deferred.append(
                        {
                            "entry": entry,
                            "attempts": attempts + 1,
                            "next_at": time.time() + 8.0,
                        }
                    )
                else:
                    logging.warning(
                        "Descartada escritura diferida tras 20 reintentos en Word."
                    )
                continue

            if deferred:
                now = time.time()
                still_deferred = []
                for def_item in deferred:
                    if now < def_item.get("next_at", 0):
                        still_deferred.append(def_item)
                        continue
                    ok = agregar_entrada_ingles_a_word(def_item["entry"])
                    if ok:
                        _marcar_letra_reciente_guardada(def_item["entry"])
                    elif def_item.get("attempts", 0) < 20:
                        still_deferred.append(
                            {
                                "entry": def_item["entry"],
                                "attempts": def_item.get("attempts", 0) + 1,
                                "next_at": time.time() + 8.0,
                            }
                        )
                deferred = still_deferred
        except Exception as err:
            logging.warning(f"Error en hilo escritor de Word PC: {err}")
            time.sleep(5)


def _encolar_escritura_english_word_async(entry):
    global _pc_word_writer_started
    with _pc_word_writer_lock:
        if not _pc_word_writer_started:
            t = threading.Thread(
                target=_pc_word_write_worker_loop, name="pc-word-writer", daemon=True
            )
            t.start()
            _pc_word_writer_started = True
    _pc_word_write_queue.put({"entry": entry, "attempts": 0})


def buscar_letra_cancion_en_word(song_meta, ruta_docx=None, use_ram_fallback=True):
    """Busca si la canción ya tiene letra guardada dentro del Word PC bajo Sección 4."""
    target_title = _limpiar_linea(
        song_meta.get("songTitle") or song_meta.get("song_title")
    )
    if not target_title:
        return None
    target_artist = _limpiar_linea(
        song_meta.get("artistsDisplay") or song_meta.get("artists_display")
    )
    target_album = _limpiar_linea(
        song_meta.get("albumTitle") or song_meta.get("album_title")
    )
    target_album_key = _clave_grupo_album(target_album) if target_album else ""

    if not ruta_docx and use_ram_fallback:
        pending_hit = _consultar_letra_reciente_ram(
            target_title, target_artist, only_pending=True
        )
        if pending_hit:
            return pending_hit

    if ruta_docx:
        archivo = os.path.abspath(ruta_docx)
    else:
        _, ruta_english = resolver_rutas_word()
        if (not ruta_english or not os.path.exists(ruta_english)) and os.environ.get(
            "GITHUB_TOKEN", ""
        ).strip():
            _, ruta_english = resolver_rutas_word(refresh_cache=True)
        archivo = os.path.abspath(ruta_english or DEFAULT_ENGLISH_WORD_PATH)
    if not os.path.exists(archivo):
        return (
            _consultar_letra_reciente_ram(target_title, target_artist)
            if (not ruta_docx and use_ram_fallback)
            else None
        )

    # Lectura ZIP/XML directa SIN esperar _word_com_lock (evita congelar 60-180s si Word COM está guardando)
    last_xml_err = None
    for attempt in range(3):
        try:
            xml_hit = _buscar_letra_en_docx_xml(
                archivo, target_title, target_artist, target_album_key
            )
            if xml_hit:
                return xml_hit
            return (
                _consultar_letra_reciente_ram(target_title, target_artist)
                if (not ruta_docx and use_ram_fallback)
                else None
            )
        except (PermissionError, zipfile.BadZipFile) as transient_err:
            last_xml_err = transient_err
            if attempt < 2:
                time.sleep(0.15)
        except (KeyError, ET.ParseError, OSError) as xml_err:
            last_xml_err = xml_err
            break

    logging.debug(
        f"Lectura XML rápida de Word no aplicable, usando COM: {last_xml_err}"
    )
    if win32com is None:
        return (
            _consultar_letra_reciente_ram(target_title, target_artist)
            if (not ruta_docx and use_ram_fallback)
            else None
        )

    with _word_com_lock:
        com_init = False
        word = None
        doc = None
        try:
            com_init, word = _iniciar_word_com_oculto()
            doc = word.Documents.Open(
                FileName=archivo,
                ConfirmConversions=False,
                ReadOnly=True,
                AddToRecentFiles=False,
            )

            sec_start, sec_end = _buscar_rango_seccion(
                doc, "music", include_eof_nonempty=True
            )
            if sec_start is None:
                return None

            groups = _recolectar_grupos_y_pistas_musica(doc, sec_start, sec_end)
            return _buscar_cancion_en_grupos(
                groups,
                lambda start, end: [
                    _texto_parrafo_limpio(doc.Paragraphs(i)) for i in range(start, end)
                ],
                target_title,
                target_artist,
                target_album_key,
            )
        except Exception as err:
            logging.warning(f"No se pudo consultar letra previa en Word PC: {err}")
            return None
        finally:
            if doc:
                try:
                    doc.Close(SaveChanges=0)
                except Exception:
                    pass
            if word:
                try:
                    word.Quit()
                except Exception:
                    pass
            if com_init and pythoncom is not None:
                try:
                    pythoncom.CoUninitialize()
                except Exception:
                    pass


def _idiomas_preferidos_para_ytdlp(idioma_texto):
    low = str(idioma_texto or "").lower()
    if "korean" in low or "k-pop" in low or "kpop" in low:
        return "ko,en,es,ja"
    if "japanese" in low or "j-pop" in low:
        return "ja,en,es,ko"
    if "spanish" in low or "español" in low:
        return "es,en,ko,ja"
    return "en,ko,es,ja"


def _base_lang_tag(lang_tag):
    clean = re.sub(
        r"-orig$", "", str(lang_tag or "").strip().lower(), flags=re.IGNORECASE
    )
    if not clean:
        return ""
    return re.split(r"[-_]", clean, maxsplit=1)[0]


def _son_pistas_redundantes(texto_a, texto_b):
    def _norm(txt):
        res = []
        for raw in str(txt or "").splitlines():
            clean = re.sub(r"[^\w]+", " ", raw.lower(), flags=re.UNICODE).strip()
            if len(clean) >= 2:
                res.append(clean)
        return res

    la = _norm(texto_a)
    lb = _norm(texto_b)
    if not la or not lb:
        return False
    if "\n".join(la) == "\n".join(lb):
        return True
    sa, sb = set(la), set(lb)
    inter = len(sa & sb)
    union = len(sa | sb)
    jaccard = inter / union if union else 0.0
    overlap = inter / min(len(sa), len(sb)) if min(len(sa), len(sb)) else 0.0
    return jaccard >= 0.72 or overlap >= 0.85


def _formatear_pistas_ytdlp(tracks):
    if not tracks:
        return "", ""
    try:
        import yt_lyrics_helper as ylh

        deduped = ylh.deduplicate_tracks(tracks, max_tracks=4)
    except Exception:
        deduped = None

    if deduped is None:
        chosen = []
        seen_bases = set()
        for tr in tracks:
            lyr = str(tr.get("lyrics") or "").strip()
            if not lyr:
                continue
            raw_lang = str(tr.get("lang") or "").strip()
            base = _base_lang_tag(raw_lang)
            if base and base in seen_bases:
                continue
            if any(_son_pistas_redundantes(prev["lyrics"], lyr) for prev in chosen):
                continue
            if base:
                seen_bases.add(base)
            chosen.append({"lang": base or raw_lang.lower() or "sub", "lyrics": lyr})
            if len(chosen) >= 4:
                break
    else:
        chosen = deduped

    if not chosen:
        return "", ""
    if len(chosen) == 1:
        return chosen[0]["lyrics"], chosen[0]["lang"]

    joined = "\n\n".join(
        f"[{t['lang'].upper() or 'SUB'}]\n{t['lyrics']}" for t in chosen
    )
    langs_summary = ", ".join(t["lang"] for t in chosen if t["lang"])
    return joined, langs_summary


def _enviar_resultado_trabajo_pc(job_id, result_payload):
    encrypted_result = encriptar_texto(json.dumps(result_payload, ensure_ascii=False))
    endpoint = f"/api/english/music/pc-jobs/{job_id}/result"
    url_res = obtener_url_aws(endpoint)
    headers = _firmar_pc_request("POST", endpoint, encrypted_result)
    try:
        resp = _get_http_session().post(
            url_res,
            json={"encryptedResult": encrypted_result},
            headers=headers,
            timeout=15,
        )
        if resp.status_code not in (200, 201):
            logging.warning(
                f"No se pudo reportar resultado del trabajo PC [{job_id[:8]}]: HTTP {resp.status_code}"
            )
    except requests.exceptions.RequestException as req_err:
        logging.warning(
            f"Error de red reportando resultado del trabajo PC [{job_id[:8]}]: {req_err}"
        )
        raise


def _procesar_trabajo_pc(job_obj):
    job_id = str((job_obj or {}).get("jobId") or "").strip()
    enc_req = str((job_obj or {}).get("encryptedRequest") or "").strip()
    if not job_id or not enc_req:
        return

    try:
        raw_req = desencriptar_texto(enc_req, raise_on_error=True)
        req_data = json.loads(raw_req)
        if not isinstance(req_data, dict):
            raise ValueError("Payload descifrado no es un objeto JSON válido.")
    except Exception as dec_err:
        logging.warning(
            f"Trabajo PC {job_id} ignorado: no se pudo descifrar con E2EE ({dec_err})."
        )
        return

    action = str(req_data.get("action") or "load_or_extract_lyrics").strip()
    force_extract = bool(req_data.get("forceExtract")) or action == "extract_lyrics"
    song_title = _limpiar_linea(req_data.get("songTitle")) or "Untitled Song"
    artists_display = _limpiar_linea(req_data.get("artistsDisplay")) or "Unknown Artist"
    yt_target = _limpiar_linea(req_data.get("ytMusicUrl") or req_data.get("videoId"))
    idioma = _limpiar_linea(req_data.get("idioma")) or "English"

    logging.info(
        f"Procesando trabajo E2EE desde navegador [{job_id[:8]}]: {artists_display} — {song_title} (force={force_extract})"
    )

    if not force_extract:
        cached_word = buscar_letra_cancion_en_word(req_data)
        if cached_word and cached_word.get("lyrics"):
            logging.info(
                f"Letra cargada directamente desde Word PC para '{song_title}' ({cached_word.get('track_heading')})."
            )
            _enviar_resultado_trabajo_pc(
                job_id,
                {
                    "ok": True,
                    "source": "word-pc",
                    "language": cached_word.get("language") or idioma,
                    "lyrics": cached_word["lyrics"],
                    "wordSaved": True,
                    "albumGroup": cached_word.get("album_group") or "",
                    "trackHeading": cached_word.get("track_heading") or "",
                },
            )
            return

    if not yt_target:
        logging.warning(
            f"Trabajo PC [{job_id[:8]}] omitido: '{song_title}' no tiene URL/ID de YouTube."
        )
        _enviar_resultado_trabajo_pc(
            job_id,
            {
                "ok": False,
                "reason": "NO_URL",
                "error": "La canción no tiene URL/ID de YouTube registrado.",
            },
        )
        return

    try:
        import yt_lyrics_helper as ylh

        langs_pref = _idiomas_preferidos_para_ytdlp(idioma)
        logging.info(
            f"Invocando yt_lyrics_helper [{job_id[:8]}] para '{song_title}' ({yt_target}) con langs={langs_pref}"
        )
        yt_res = ylh.run_yt_dlp_extract(url_or_id=yt_target, langs=langs_pref)
        lyrics_text, chosen_lang = _formatear_pistas_ytdlp(yt_res.get("tracks") or [])
        meta = yt_res.get("metadata") or {}

        if not lyrics_text:
            logging.warning(
                f"Trabajo PC [{job_id[:8]}] sin subtítulos/CC utilizables para '{song_title}' "
                f"(yt-dlp={yt_res.get('yt_dlp_source') or 'local'})."
            )
            _enviar_resultado_trabajo_pc(
                job_id,
                {
                    "ok": False,
                    "reason": "NO_CAPTIONS",
                    "error": "yt-dlp en tu PC ejecutó correctamente, pero este video de YouTube no tiene subtítulos/CC disponibles para extraer.",
                    "ytDlpSource": yt_res.get("yt_dlp_source") or "",
                    "suggestedCommand": f'python sincronitation/yt_lyrics_helper.py "{yt_target}" --clip',
                },
            )
            return

        resolved_title = (
            _limpiar_linea(req_data.get("songTitle"))
            or _limpiar_linea(meta.get("title"))
            or song_title
        )
        resolved_artist = (
            _limpiar_linea(req_data.get("artistsDisplay"))
            or _limpiar_linea(meta.get("artist"))
            or artists_display
        )
        word_entry = {
            "category": "music",
            "language": idioma,
            "song_title": resolved_title,
            "artists_display": resolved_artist,
            "album_title": _limpiar_linea(
                req_data.get("albumTitle") or meta.get("album")
            ),
            "album_type": _limpiar_linea(req_data.get("albumType")),
            "release_year": _limpiar_linea(
                req_data.get("releaseYear") or meta.get("release_year")
            ),
            "release_date": _limpiar_linea(
                req_data.get("releaseDate") or meta.get("release_date")
            ),
            "track_number": req_data.get("trackNumber") or meta.get("track_number"),
            "playlist_name": _limpiar_linea(req_data.get("playlistName")),
            "yt_music_url": yt_res.get("url") or yt_target,
            "focus_summary": _limpiar_linea(req_data.get("focusSummary")),
            "lyrics_study": lyrics_text,
            "notes": f"Extracted automatically on PC via yt-dlp ({chosen_lang or 'CC'}).",
        }
        _registrar_letra_reciente_ram(
            resolved_title,
            resolved_artist,
            lyrics_text,
            language=chosen_lang or idioma,
            track_heading=f"{resolved_title} — {resolved_artist}",
            pending_write=True,
        )

        # 1. Guardar PRIMERO de forma síncrona en el documento Word (y subir Word a Drive)
        saved_ok = False
        for save_attempt in range(3):
            if agregar_entrada_ingles_a_word(word_entry):
                saved_ok = True
                _marcar_letra_reciente_guardada(word_entry)
                break
            if save_attempt < 2:
                time.sleep(0.8)

        if not saved_ok:
            _encolar_escritura_english_word_async(word_entry)
            logging.warning(
                f"Trabajo PC [{job_id[:8]}] encolado para guardar en Word al desbloquearse ('{resolved_title}')."
            )
            _enviar_resultado_trabajo_pc(
                job_id,
                {
                    "ok": False,
                    "reason": "WORD_LOCKED",
                    "error": "No se pudo guardar aún en el documento Word (archivo temporalmente bloqueado). Cierra o guarda Word e intenta en unos segundos.",
                    "wordSaved": False,
                },
            )
            return

        # 2. Leer/extraer la letra DIRECTAMENTE desde el Word guardado antes de subirla a la instancia
        search_meta = {
            "songTitle": resolved_title,
            "artistsDisplay": resolved_artist,
            "albumTitle": word_entry.get("album_title") or req_data.get("albumTitle") or "",
        }
        verified_word = None
        for read_attempt in range(2):
            verified_word = buscar_letra_cancion_en_word(search_meta, use_ram_fallback=False)
            if not (verified_word and verified_word.get("lyrics")):
                verified_word = buscar_letra_cancion_en_word(req_data, use_ram_fallback=False)
            if verified_word and verified_word.get("lyrics"):
                break
            if read_attempt == 0:
                time.sleep(0.25)

        if not (verified_word and verified_word.get("lyrics")):
            logging.warning(
                f"Trabajo PC [{job_id[:8]}] guardó '{resolved_title}' pero falló verificación de lectura en Word."
            )
            _enviar_resultado_trabajo_pc(
                job_id,
                {
                    "ok": False,
                    "reason": "WORD_READBACK_FAILED",
                    "error": "Se extrajo la letra pero aún no pudo verificarse dentro del documento Word. Intenta nuevamente.",
                    "wordSaved": False,
                },
            )
            return

        word_lyrics = verified_word["lyrics"]
        _registrar_letra_reciente_ram(
            resolved_title,
            resolved_artist,
            word_lyrics,
            language=verified_word.get("language") or chosen_lang or idioma,
            album_group=verified_word.get("album_group") or "",
            track_heading=verified_word.get("track_heading") or f"{resolved_title} — {resolved_artist}",
            pending_write=False,
        )

        logging.info(
            f"Trabajo PC [{job_id[:8]}] completado vía Word-first (chars={len(word_lyrics)}, "
            f"heading='{verified_word.get('track_heading') or resolved_title}')."
        )
        _enviar_resultado_trabajo_pc(
            job_id,
            {
                "ok": True,
                "source": "word-pc",
                "extractedVia": f"pc-yt-dlp:{yt_res.get('yt_dlp_source', 'local')}->word",
                "language": verified_word.get("language") or chosen_lang or idioma,
                "lyrics": word_lyrics,
                "metadata": meta,
                "wordSaved": True,
                "albumGroup": verified_word.get("album_group") or "",
                "trackHeading": verified_word.get("track_heading") or "",
                "ytDlpBin": os.path.basename(yt_res.get("yt_dlp_bin") or "yt-dlp"),
            },
        )
    except FileNotFoundError as fnf_err:
        logging.error(
            f"Trabajo PC [{job_id[:8]}] falló porque no se encontró yt-dlp: {fnf_err}"
        )
        _enviar_resultado_trabajo_pc(
            job_id,
            {
                "ok": False,
                "reason": "YTDLP_NOT_FOUND",
                "error": str(fnf_err),
                "suggestedCommand": f'python sincronitation/yt_lyrics_helper.py "{yt_target}" --clip',
            },
        )
    except Exception as run_err:
        logging.exception(
            f"Trabajo PC [{job_id[:8]}] error ejecutando yt_lyrics_helper/yt-dlp: {run_err}"
        )
        _enviar_resultado_trabajo_pc(
            job_id,
            {
                "ok": False,
                "reason": "YTDLP_ERROR",
                "error": f"Error ejecutando yt-dlp en tu PC: {run_err}",
                "suggestedCommand": f'python sincronitation/yt_lyrics_helper.py "{yt_target}" --clip',
            },
        )


def _ejecutar_trabajo_pc_con_limite(job_obj):
    with _pc_job_semaphore:
        try:
            _procesar_trabajo_pc(job_obj)
        except Exception as job_err:
            logging.warning(
                f"Error procesando trabajo PC en hilo trabajador: {job_err}"
            )


def _pc_bridge_worker_loop():
    """Hilo en segundo plano con firma HMAC site-to-site que atiende peticiones de letras al instante."""
    logging.info(
        "Puente cifrado PC <-> EC2 RAM iniciado (listo para extraer letras y actualizar Word al instante)."
    )
    backoff_sec = 5
    while True:
        try:
            endpoint = "/api/english/music/pc-jobs/poll"
            url_poll = obtener_url_aws(f"{endpoint}?waitMs=20000")
            headers = _firmar_pc_request("GET", endpoint, "")
            resp = _get_http_session().get(url_poll, headers=headers, timeout=28)
            if resp.status_code == 200:
                backoff_sec = 5
                data = resp.json()
                jobs = []
                if isinstance(data, dict):
                    if isinstance(data.get("jobs"), list):
                        jobs = data["jobs"]
                    elif data.get("job"):
                        jobs = [data["job"]]
                for job_obj in jobs:
                    threading.Thread(
                        target=_ejecutar_trabajo_pc_con_limite,
                        args=(job_obj,),
                        name="pc-music-job",
                        daemon=True,
                    ).start()
                continue
            if resp.status_code in (401, 403):
                logging.warning(
                    f"Autenticación PC Bridge rechazada (HTTP {resp.status_code}). Verifica JOURNAL_SECRET_KEY / ADMIN_SECRET."
                )
                time.sleep(20)
                continue
            time.sleep(backoff_sec)
        except requests.exceptions.RequestException:
            invalidar_cache_github()
            time.sleep(backoff_sec)
            backoff_sec = min(15, backoff_sec + 2)
        except Exception as err:
            logging.warning(f"Error en hilo PC Bridge (reintentará): {err}")
            time.sleep(backoff_sec)


def _leer_cola_pendiente_sin_lock():
    try:
        if not os.path.exists(PENDING_QUEUE_PATH):
            return {"journal": [], "english": []}
        with open(PENDING_QUEUE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            return {"journal": [], "english": []}
        return {
            "journal": [str(x) for x in data.get("journal", []) if isinstance(x, str)],
            "english": [str(x) for x in data.get("english", []) if isinstance(x, str)],
        }
    except Exception:
        return {"journal": [], "english": []}


def _escribir_cola_pendiente_sin_lock(journal_raw_list, english_raw_list):
    try:
        j_list = list(journal_raw_list or [])[:200]
        e_list = list(english_raw_list or [])[:200]
        if not j_list and not e_list:
            if os.path.exists(PENDING_QUEUE_PATH):
                os.remove(PENDING_QUEUE_PATH)
            return
        tmp = f"{PENDING_QUEUE_PATH}.tmp.{os.getpid()}.{threading.get_ident()}"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"journal": j_list, "english": e_list}, fh)
        os.replace(tmp, PENDING_QUEUE_PATH)
    except Exception as exc:
        logging.warning(f"No se pudo respaldar cola pendiente cifrada: {exc}")


def _cargar_cola_pendiente_cifrada():
    with _pending_queue_lock:
        return _leer_cola_pendiente_sin_lock()


def _guardar_cola_pendiente_cifrada(journal_raw_list, english_raw_list):
    with _pending_queue_lock:
        _escribir_cola_pendiente_sin_lock(journal_raw_list, english_raw_list)


def _actualizar_canal_cola_pendiente(canal, items_list):
    """Actualiza solo 'journal' o 'english' en .pending_e2ee_queue.json sin pisar el otro hilo."""
    if canal not in ("journal", "english"):
        return
    with _pending_queue_lock:
        actual = _leer_cola_pendiente_sin_lock()
        actual[canal] = list(items_list or [])[:200]
        _escribir_cola_pendiente_sin_lock(actual["journal"], actual["english"])


def _descargar_cola_cruda_remota(endpoint, wait_ms=0):
    target_endpoint = endpoint
    try:
        clean_wait = max(0, min(25000, int(wait_ms or 0)))
    except (TypeError, ValueError):
        clean_wait = 0
    if clean_wait > 0:
        sep = "&" if "?" in endpoint else "?"
        target_endpoint = f"{endpoint}{sep}waitMs={clean_wait}"

    url = obtener_url_aws(target_endpoint)
    req_timeout = max(12, int(clean_wait / 1000) + 10)
    t_start = time.monotonic()
    respuesta = _get_http_session().get(url, timeout=req_timeout)
    if respuesta.status_code != 200:
        msg = f"Respuesta HTTP {respuesta.status_code} al consultar {endpoint} en EC2"
        if msg != _github_cache.get("last_ec2_error"):
            logging.warning(msg)
            _github_cache["last_ec2_error"] = msg
        time.sleep(10 if respuesta.status_code == 429 else 5)
        return []
    if _github_cache.get("last_ec2_error") is not None:
        logging.info(f"Comunicación con servidor EC2 restablecida ({endpoint}).")
        _github_cache["last_ec2_error"] = None
    elementos = respuesta.json()
    if not isinstance(elementos, list):
        return []
    if not elementos and clean_wait >= 5000 and (time.monotonic() - t_start) < 2.5:
        # El servidor remoto aún no retiene long-poll (p.ej. antes de desplegar server.js): pausa segura anti-429
        time.sleep(_SYNC_POLL_INTERVAL_SECONDS)
    return [str(item) for item in elementos if item is not None]


def _descargar_cola_remota(endpoint):
    return [desencriptar_texto(item) for item in _descargar_cola_cruda_remota(endpoint)]


_SINGLE_INSTANCE_MUTEX = None


def _adquirir_mutex_instancia():
    """Evita instancias duplicadas de sincronizador.py en Windows usando un mutex con nombre."""
    global _SINGLE_INSTANCE_MUTEX
    if not sys.platform.startswith("win"):
        return True
    try:
        kernel32 = ctypes.windll.kernel32
        kernel32.CreateMutexW.argtypes = [
            ctypes.c_void_p,
            ctypes.c_bool,
            ctypes.c_wchar_p,
        ]
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        handle = kernel32.CreateMutexW(
            None, False, "Local\\PersonalDailyHubSincronizadorMutex"
        )
        last_err = kernel32.GetLastError()
        if handle:
            _SINGLE_INSTANCE_MUTEX = handle
            if last_err == 183:  # ERROR_ALREADY_EXISTS
                return False
        return True
    except Exception:
        return True


def _procesar_lote_english(entradas_en_espera):
    """Descifra y escribe notas/letras de English Notebook vía Fast OOXML (~130ms) preservando lo pendiente ante bloqueo."""
    if not entradas_en_espera:
        return []
    restantes = []
    for i, raw_eng_cipher in enumerate(entradas_en_espera):
        try:
            entry_obj = parsear_entrada_ingles(
                desencriptar_texto(raw_eng_cipher, raise_on_error=True)
            )
        except Exception as parse_err:
            logging.warning(
                f"Entrada de inglés descartada por formato/cifrado inválido: {parse_err}"
            )
            continue
        exito = agregar_entrada_ingles_a_word(entry_obj)
        if not exito:
            restantes = entradas_en_espera[i:]
            break
    return restantes


def _english_sync_worker_loop(entradas_iniciales):
    """Hilo dedicado de entrega instantánea (/api/pull-english?waitMs=20000) aislado de Word COM del Journal."""
    entradas_en_espera = list(entradas_iniciales or [])
    backoff_sec = 3
    while True:
        try:
            try:
                wait_ms = 0 if entradas_en_espera else _SYNC_LONG_POLL_MS
                nuevos_eng_raw = _descargar_cola_cruda_remota(
                    "/api/pull-english", wait_ms=wait_ms
                )
                backoff_sec = 3
                if nuevos_eng_raw:
                    entradas_en_espera.extend(nuevos_eng_raw)
                    _actualizar_canal_cola_pendiente("english", entradas_en_espera)
            except requests.exceptions.RequestException as req_err:
                invalidar_cache_github()
                err_txt = f"Sin conexión a EC2 (/api/pull-english): {req_err}"
                if err_txt != _github_cache.get("last_ec2_error"):
                    logging.warning(err_txt)
                    _github_cache["last_ec2_error"] = err_txt
                time.sleep(backoff_sec)
                backoff_sec = min(15, backoff_sec + 2)

            if entradas_en_espera:
                ingles_restantes = _procesar_lote_english(entradas_en_espera)
                if len(ingles_restantes) != len(entradas_en_espera):
                    entradas_en_espera = ingles_restantes
                    _actualizar_canal_cola_pendiente("english", entradas_en_espera)
                if entradas_en_espera:
                    _sync_wake_event.wait(_SYNC_POLL_INTERVAL_SECONDS)
                    _sync_wake_event.clear()
        except Exception as eng_err:
            logging.exception(
                f"Error inesperado en hilo English OOXML (continuará reintentando): {eng_err}"
            )
            time.sleep(5)


if __name__ == "__main__":
    inicializar_logging()
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg in ("-h", "--help"):
        print("Uso: python sincronitation/sincronizador.py [opcion]")
        print("  (sin argumentos)          Inicia el sincronizador con Word")
        print(
            "  --configurar-autoinicio   Guarda la clave de .env.enc protegida con Windows DPAPI"
        )
        print(
            "  --probar-autoinicio       Verifica que el autoinicio DPAPI descifra .env.enc en RAM"
        )
        print("  --quitar-autoinicio       Elimina la clave DPAPI guardada")
        sys.exit(0)
    if arg == "--configurar-autoinicio":
        configurar_autoinicio()
        sys.exit(0)
    if arg == "--probar-autoinicio":
        inicializar_entorno()
        print(
            "[OK] Autoinicio DPAPI verificado: .env.enc descifrado en RAM correctamente."
        )
        sys.exit(0)
    if arg == "--quitar-autoinicio":
        eliminado, ruta = _eliminar_dpapi_password()
        print(
            f"Clave DPAPI eliminada: {ruta}"
            if eliminado
            else f"No existía clave DPAPI en {ruta}"
        )
        sys.exit(0)

    if not _adquirir_mutex_instancia():
        logging.info(
            "Ya existe otra instancia activa de sincronizador.py; se omite arranque duplicado."
        )
        sys.exit(0)

    inicializar_entorno()
    logging.info(
        f"Iniciando cliente... Entrega instantánea vía long-poll ({_SYNC_LONG_POLL_MS}ms) "
        f"para Journal (Word COM + watchdog {_WORD_COM_TIMEOUT_SECONDS}s) y English Notebook (OOXML paralelo)."
    )

    ultimo_dia_verificado = None
    cola_pendiente = _cargar_cola_pendiente_cifrada()
    textos_en_espera_local = cola_pendiente["journal"]
    entradas_ingles_en_espera = cola_pendiente["english"]
    if textos_en_espera_local or entradas_ingles_en_espera:
        logging.info(
            f"Recuperadas de respaldo cifrado local: {len(textos_en_espera_local)} notas Journal y "
            f"{len(entradas_ingles_en_espera)} entradas de English."
        )

    pc_bridge_thread = threading.Thread(
        target=_pc_bridge_worker_loop,
        name="pc-music-bridge",
        daemon=True,
    )
    pc_bridge_thread.start()

    english_sync_thread = threading.Thread(
        target=_english_sync_worker_loop,
        args=(entradas_ingles_en_espera,),
        name="pc-english-sync",
        daemon=True,
    )
    english_sync_thread.start()

    word_watch_thread = threading.Thread(
        target=_word_file_watch_loop,
        name="pc-word-drive-watcher",
        daemon=True,
    )
    word_watch_thread.start()

    journal_backoff_sec = 3

    # Bucle resiliente para Journal Word COM con long-poll instantáneo desde EC2
    while True:
        try:
            ahora = datetime.now()

            # 1. VERIFICACIÓN DE MADRUGADA (Journal diario)
            if ahora.hour == 0 and ultimo_dia_verificado != ahora.date():
                ayer = ahora - timedelta(days=1)
                exito = agregar_texto_a_word("Nothing to report.", fecha_objetivo=ayer)
                if exito:
                    ultimo_dia_verificado = ahora.date()

            # 2. DESCARGAR JOURNAL NOTES DE AWS (long-poll push instantáneo; respaldo local E2EE antes de Word)
            try:
                wait_ms = 0 if textos_en_espera_local else _SYNC_LONG_POLL_MS
                nuevos_raw = _descargar_cola_cruda_remota(
                    "/api/pull-text", wait_ms=wait_ms
                )
                journal_backoff_sec = 3
                if nuevos_raw:
                    textos_en_espera_local.extend(nuevos_raw)
                    _actualizar_canal_cola_pendiente("journal", textos_en_espera_local)
            except requests.exceptions.RequestException as req_err:
                invalidar_cache_github()
                err_txt = f"Sin conexión a EC2 (/api/pull-text): {req_err}"
                if err_txt != _github_cache.get("last_ec2_error"):
                    logging.warning(err_txt)
                    _github_cache["last_ec2_error"] = err_txt
                time.sleep(journal_backoff_sec)
                journal_backoff_sec = min(15, journal_backoff_sec + 2)

            # 3. ESCRIBIR JOURNAL NOTES EN WORD (CON CONTRASEÑA Y WATCHDOG ANTI-BLOQUEO)
            if textos_en_espera_local:
                textos_restantes = []
                for i, raw_cipher in enumerate(textos_en_espera_local):
                    try:
                        texto_legible = desencriptar_texto(
                            raw_cipher, raise_on_error=True
                        )
                    except Exception as dec_err:
                        logging.warning(
                            f"Entrada de Journal descartada por cifrado/llave E2EE incompatible: {dec_err}"
                        )
                        continue
                    exito = agregar_texto_a_word(texto_legible)
                    if not exito:
                        textos_restantes = textos_en_espera_local[i:]
                        break
                if len(textos_restantes) != len(textos_en_espera_local):
                    textos_en_espera_local = textos_restantes
                    _actualizar_canal_cola_pendiente("journal", textos_en_espera_local)

        except Exception as loop_err:
            logging.exception(
                f"Error inesperado en ciclo Journal del sincronizador (continuará reintentando): {loop_err}"
            )

        if textos_en_espera_local:
            _sync_wake_event.wait(_SYNC_POLL_INTERVAL_SECONDS)
            _sync_wake_event.clear()
        else:
            time.sleep(0.05)
