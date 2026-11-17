# `sincronitation/` — Cliente local de sincronización (PC Windows)

Scripts que corren **solo en tu PC con Windows**. Nunca se empaquetan en la imagen Docker ni se
ejecutan en el servidor (AWS EC2 / VPS):

- `.dockerignore` excluye `sincronitation/`, `guides/` y `tests/` del contexto de build.
- `Dockerfile` copia únicamente `server.js`, `public/`, `lib/` y los manifiestos `package*.json`.
- `.github/workflows/deploy.yml` borra `sincronitation/` de la copia de trabajo del servidor
  después de cada `git reset --hard`.
- CI (`ci.yml`) solo valida la **sintaxis** con `ast.parse`; nunca ejecuta el sincronizador.

| Archivo | Rol |
|---|---|
| `sincronizador.py` | Worker de fondo. Descarga las colas E2EE (`/api/send-to-pc` → Diario, `/api/send-english` → Cuaderno de Idiomas), las descifra en RAM y escribe en Word (OOXML directo, con Word COM como respaldo). También atiende el puente firmado HMAC-SHA256 para extraer letras y respalda el Cuaderno en Google Drive a través del servidor. |
| `yt_lyrics_helper.py` | Extrae subtítulos/letras (CC / auto-subs) y metadatos de YouTube / YT Music con el `yt-dlp` local (sin bloqueos anti-bot de la IP de EC2). Lo usa el sincronizador y también funciona como CLI. |
| `requirements.txt` | Dependencias de Python. |
| `sincronizador.env.example` | Plantilla **sin secretos** con las variables que necesita el sincronizador. |

## 1. Requisitos

- Windows 10/11 con **Python 3.10+** (casilla *"Add python.exe to PATH"* marcada al instalar).
- Microsoft Word (solo si el `.docx` todavía no existe; los `.docx` existentes se editan vía OOXML sin abrir Word).
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) en el `PATH` o en `YT_DLP_PATH` (opcional, para extraer letras).
- Node.js (solo para cifrar/descifrar la bóveda `.env.enc` con `scripts/local-vault.js`).

```powershell
python -m pip install -r sincronitation/requirements.txt
```

## 2. Variables de entorno (sin secretos en Git)

El sincronizador lee las variables desde la **raíz del proyecto**: `./.env` (texto plano) o, de
preferencia, `./.env.enc` (bóveda cifrada `Salted__` + PBKDF2-SHA256 + AES-256). Usa
[`sincronizador.env.example`](./sincronizador.env.example) como guía.

| Variable | Obligatoria | Descripción |
|---|---|---|
| `JOURNAL_SECRET_KEY` | ✅ | Llave E2EE de **32 bytes**; idéntica a la del servidor. |
| `WORD_FILE_PATH` | ✅* | Ruta del Diario `.docx` (*o se resuelve desde GitHub Variables). |
| `WORD_PASSWORD` | ✅ | Contraseña de protección del Diario. |
| `ENGLISH_WORD_FILE_PATH` | ➖ | Cuaderno de Idiomas. Por defecto `english-notes/English_Learning_Notebook.docx`. |
| `EC2_HOST` / `AWS_HOST` / `URL_AWS` / `SERVER_HOST` | ✅* | Host del servidor (*o se resuelve con `GITHUB_REPO` + `GITHUB_TOKEN`). |
| `GITHUB_REPO`, `GITHUB_TOKEN` | ➖ | Descubrimiento automático del host vía GitHub Actions Variables (PAT de solo lectura). |
| `YT_DLP_PATH`, `YT_DLP_COOKIES_PATH` | ➖ | Ruta a `yt-dlp.exe` y a cookies (si YouTube exige sesión). |
| `MOOD_DPAPI_VAULT_PATH` | ➖ | Ruta alternativa para la clave DPAPI del autoinicio. |
| `MOOD_ENV_PASS` | ➖ | Contraseña de `.env.enc` **solo como variable temporal de sesión**; nunca la guardes en disco. |

```powershell
# Cifrar tu .env (genera .env.enc y puedes borrar el .env en texto plano)
node scripts/local-vault.js encrypt
```

## 3. Ejecución en Windows

```powershell
# Desde la raíz del repositorio

# a) Con consola (ves los logs en vivo; útil para depurar)
python sincronitation/sincronizador.py

# b) En segundo plano, sin ventana (uso diario)
pythonw sincronitation/sincronizador.py

# Autoinicio sin pedir contraseña: guarda la clave de .env.enc protegida con Windows DPAPI
python sincronitation/sincronizador.py --configurar-autoinicio
python sincronitation/sincronizador.py --probar-autoinicio
python sincronitation/sincronizador.py --quitar-autoinicio

# Extraer letra de un video y copiarla al portapapeles
python sincronitation/yt_lyrics_helper.py "https://www.youtube.com/watch?v=VIDEO_ID" --clip
```

> Con `pythonw` no hay `stdout`: revisa `sincronitation/historial.log` (rotativo, 1 MB × 3).
> Para arrancar con Windows, crea un acceso directo a
> `pythonw.exe "<repo>\sincronitation\sincronizador.py"` en `shell:startup` **después** de
> ejecutar `--configurar-autoinicio`.

## 4. Archivos locales que NUNCA se suben a Git

`.gitignore` solo versiona `*.py`, `*.md`, `requirements.txt` y `*.example` dentro de esta carpeta.
Todo lo demás permanece local:

- `historial.log`, `__pycache__/`, `*.pyc`, `.venv/`
- `.last_ec2_host.json`, `.last_word_paths.json`, `.last_yt_dlp_path.json`, `.english_word_drive_state.json`
- `.pending_e2ee_queue.json` (cola pendiente cifrada), `*.queue`, `*.enc`, `*.db`, `*.sqlite`
- `.env`, `.env.enc`, `*.key`, `*.pem` y cualquier documento personal `*.docx` / `*.doc` / `~$*.docx`
