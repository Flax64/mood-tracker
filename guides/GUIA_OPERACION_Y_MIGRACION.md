# Guía Completa de Operación, Bóveda Local y Migración EC2 — Personal Daily Hub

> Guía operativa de referencia diaria (versionada en `guides/` y excluida de Docker en `.dockerignore`). Reúne en un solo lugar **cómo consultar, ver, editar y re-cifrar tu `.env` local**, cómo trabajar con **Git Bash y la rama protegida `main`**, cómo revisar **logs, respaldos y secretos** en GitHub/EC2, y cómo **migrar a otra instancia AWS EC2** reutilizando tus llaves en `.ssh/`.

---

## Índice rápido — "¿Qué necesito hacer?"

| Tarea | Sección |
| :--- | :--- |
| Usar paso a paso cada pantalla (Mood, Sueño, Diario, Traductor `Alt+T`, Música PC/Celular, idioma EN/ES, Guía Visual) | [Manual de Usuario](./MANUAL_DE_USUARIO.md) |
| Ver estado de `.env` / `.env.enc` en mi PC | [1.1 Ver estado actual](#11-ver-estado-actual-de-la-bóveda) |
| Consultar una variable local sin crear `.env` en disco | [1.2 Consultar variables solo en RAM](#12-consultar-variables-sin-escribir-env-en-disco) |
| Ver completo o editar `.env` y volver a cifrarlo | [1.3 Ver completo, editar y re-sellar](#13-ver-completo-editar-y-re-sellar) |
| Cambiar la contraseña maestra de `.env.enc` | [1.4 Cambiar contraseña maestra](#14-cambiar-la-contraseña-maestra) |
| Ejecutar el sincronizador de Word, extraer subtítulos `yt-dlp` y abrir Traductor tipo extensión | [2. Sincronizador Word local y herramientas PC](#2-sincronizador-word-local-sincronizadorpy) |
| Correr pruebas, subir rama y hacer PR a `main` | [3. Git Bash, pruebas y rama protegida](#3-git-bash-pruebas-y-rama-protegida-main) |
| Revisar variables/secrets en GitHub y logs/cron en EC2 | [4. Qué consultar en GitHub y en EC2](#4-qué-consultar-en-github-y-en-ec2) |
| Sacar respaldo manual o restaurar desde Google Drive | [5. Respaldos y restauración manual](#5-respaldos-manuales-y-restauración-desde-drive) |
| Cambiar de instancia AWS EC2 usando `.ssh/` | [6. Migración a nueva instancia EC2](#6-migración-a-otra-instancia-aws-ec2-usando-ssh) |
| Resolver errores típicos (`winpty`, permisos SSH, `main`) | [7. Solución rápida de problemas](#7-solución-rápida-de-problemas) |
| Activar notificaciones en celular (`ntfy`), Jira y recordatorios | [8. Notificaciones Móviles, Agenda Jira y Settings](#8-notificaciones-móviles-agenda-jira-y-settings) |
| Confirmar seguridad de cuenta YouTube Music (cero contraseñas/tokens) | [9. Seguridad en YouTube Music (Cero Credenciales)](#9-seguridad-en-youtube-music-cero-credenciales) |
| Cambiar nombre del repo en GitHub/PC, comportamiento al reiniciar Windows y reiniciar Python local | [10. Renombrar Repositorio, Autoinicio y Reiniciar Python Local](#10-renombrar-repositorio-autoinicio-y-reiniciar-python-local) |
| Verificar cifrado HTTP en EC2 (`tcpdump`, integridad HMAC y `GEMINI_API_KEY`) | [11. Verificación del Túnel Cifrado e IA Gemini en EC2](#11-verificación-del-túnel-cifrado-e-ia-gemini-en-ec2) |
| Ver historial SemVer 2.0.0 y auto-versionado por despliegue | [12. Historial de Versiones SemVer 2.0.0](#12-historial-de-versiones-y-auto-versionado-por-despliegue-semver-200) |
| **Catálogo Maestro de Comandos Rápidos (Dividir para IA, Diagnóstico, Servicios, DPAPI, Drive, `yt-dlp`, Git)** | [13. Catálogo Maestro de Comandos Rápidos](#13-catálogo-maestro-de-comandos-rápidos-git-bash-pc-docker-y-aws-ec2) · ([Guía Independiente](./GUIA_COMANDOS_RAPIDOS.md)) |
| ↳ Dividir código en `codigo_dividido/` (118 KB) y `for-gemini/` con líneas exactas | [13.1 Dividir Archivos para la IA](#131-comandos-para-dividir-archivos-y-cargar-a-la-ia-git-bash) |
| ↳ Consultar estado, logs, RAM, Swap, procesos Word y `yt-dlp` | [13.2 Consulta y Diagnóstico](#132-comandos-de-consulta-de-información-y-diagnóstico) |
| ↳ Iniciar, detener y reiniciar Python PC / `WINWORD.EXE` / Docker EC2 | [13.3 Reiniciar, Iniciar y Detener Servicios](#133-comandos-para-reiniciar-iniciar-y-detener-servicios) |
| ↳ Cifrar, descifrar y configurar autoinicio Windows DPAPI | [13.4 Bóveda `.env.enc` y DPAPI](#134-comandos-de-la-bóveda-de-seguridad-envenc-y-windows-dpapi) |
| ↳ Backup `historico_completo.json.gz`, purga 30 días y consultas MySQL / Drive | [13.5 MySQL y Respaldos Drive (`rclone`)](#135-comandos-de-base-de-datos-mysql-y-respaldos-en-google-drive-rclone) |
| ↳ Extraer y limpiar subtítulos localmente con `yt-dlp` | [13.6 Worker PC y `yt-dlp`](#136-comandos-del-worker-local-de-pc-sincronizadorpy-y-yt-dlp) |
| ↳ Correr `npm test`, verificar sintaxis y hacer commits desglosados | [13.7 Pruebas, Git y Despliegue](#137-comandos-de-pruebas-git-commits-desglosados-y-despliegue) |

---

## 1. Bóveda local (`.env` ↔ `.env.enc`) en Windows

Tu archivo `.env` local se cifra en `.env.enc` usando [`scripts/local-vault.js`](../scripts/local-vault.js) con el estándar OpenSSL (**PBKDF2-HMAC-SHA256** de `600,000` iteraciones + **AES-256-CBC**). Ambos archivos están en [`.gitignore`](../.gitignore) para que nunca suban a GitHub.

> [!CAUTION]
> Tu contraseña maestra **no se guarda en ningún lado**. Si la olvidas, `.env.enc` no puede descifrarse y tendrías que reconstruir `.env` desde tus Secrets/Variables de GitHub y tus datos locales de Word.

Primero entra al proyecto en **Git Bash**:
```bash
cd "<RUTA_DEL_REPOSITORIO>"
```

> [!TIP]
> **Nota para Git Bash clásico (`mintty`):** si usas la ventana independiente de Git Bash (fuera de VS Code) y el prompt de contraseña no responde bien como terminal interactiva, antepón `winpty` a cualquier comando que pida contraseña (por ejemplo: `winpty node scripts/local-vault.js decrypt` o `winpty python sincronitation/sincronizador.py`).

### 1.1 Ver estado actual de la bóveda
```bash
node scripts/local-vault.js status
```
* `[OK] .env en texto plano NO existe en disco` + `[SELLADO] .env.enc cifrado presente en disco` → Todo protegido.
* `[EXPUESTO] .env en texto plano presente en disco` → Recuerda sellar con `encrypt` o `lock` al terminar de editar.

### 1.2 Consultar variables sin escribir `.env` en disco
Si solo quieres ver uno o varios valores rápidamente en **RAM** sin recrear `.env` en el disco:
```bash
node scripts/local-vault.js run node -e "console.log({ WORD_FILE_PATH: process.env.WORD_FILE_PATH, GITHUB_REPO: process.env.GITHUB_REPO, PORT: process.env.PORT })"
```
También puedes imprimir cualquier otra variable cambiando el nombre dentro de `process.env.NOMBRE_VARIABLE`. No queda ningún archivo plano en disco al terminar.

### 1.3 Ver completo, editar y re-sellar
```bash
# 1. Descifra .env.enc -> .env temporalmente (pide tu contraseña maestra)
node scripts/local-vault.js decrypt

# 2. Míralo o edítalo con la herramienta que prefieras
cat .env
# code .env
# nano .env
```

Al terminar, **siempre vuelve a sellarlo**:
* **Si modificaste algo** (actualiza `.env.enc` con tus cambios y destruye `.env` plano sobrescribiéndolo con ceros):
  ```bash
  node scripts/local-vault.js encrypt
  ```
* **Si solo lo miraste y no cambiaste nada** (destruye `.env` plano sobrescribiéndolo con ceros y conserva el `.env.enc` actual, sin pedirte contraseña):
  ```bash
  node scripts/local-vault.js lock
  ```
* Verifica que volvió a quedar limpio:
  ```bash
  node scripts/local-vault.js status
  ```

### 1.4 Cambiar la contraseña maestra
```bash
node scripts/local-vault.js decrypt   # Ingresa tu contraseña actual
node scripts/local-vault.js encrypt   # Escribe y confirma tu NUEVA contraseña (mín. 8 caracteres)
python sincronitation/sincronizador.py --configurar-autoinicio   # Actualiza también el autoinicio Windows DPAPI
```

---

## 2. Sincronizador Word local (`sincronizador.py`)

El script `sincronitation/sincronizador.py` detecta automáticamente `.env` o `.env.enc` (descifrándolo solo en RAM) y sincroniza **dos documentos Word** en tu PC:
1. **Journal diario (cifrado con contraseña):** usa `WORD_FILE_PATH` + `WORD_PASSWORD` desde `/api/pull-text`.
2. **English Learning Notebook (`english-notes/English_Learning_Notebook.docx`, sin contraseña):** carpeta ignorada por Git; ordena tus registros en **4 apartados** (*Glossary & New Words*, *Grammar & Usage Notes*, *Phrasal Verbs* y *Songs & Music Study* para **Learn with Music**) y regenera automáticamente la **Tabla de Contenidos** al inicio del archivo en cada registro desde `/api/pull-english`. Su ruta es **relativa al proyecto**, por lo que **no requiere modificar `.env`, `.env.enc` ni rutas al migrar de instancia EC2**.
   *(En **Learn with Music**, el botón **Find in YouTube Music** abre la búsqueda en tu propia sesión iniciada de YouTube Music y al pegar la URL de la canción se autocompletan título y artista. Si algún día quieres resultados embebidos dentro de la app, puedes añadir opcionalmente la variable `YOUTUBE_API_KEY` en tu entorno del servidor, sin ser obligatoria).*

### Variables que utiliza tu `.env` / `.env.enc` local y sobrescritura automática desde GitHub Variables
> **Automatización sin re-editar `.env.enc`:** si cambias de carpeta tu archivo de **Journal (`WORD_FILE_PATH`)** o tu **Notebook de Inglés (`ENGLISH_WORD_FILE_PATH`)** (o `YT_DLP_PATH` / `EC2_HOST`), solo actualiza la variable en **GitHub → Settings → Secrets and variables → Actions → Variables**. `sincronizador.py` lee automáticamente ambas rutas cada 5 minutos desde GitHub API (o al instante si el archivo ya no está en la ruta previa) con respaldo local en `.last_word_paths.json`, aceptando tanto ruta completa `.docx` como ruta de carpeta.

| Variable | Obligatoria | Para qué sirve |
| :--- | :---: | :--- |
| `WORD_FILE_PATH` | Sí *(o en GitHub Vars)* | Ruta local Windows (`.docx` o carpeta) hacia tu **Journal diario** (la GitHub Variable sobrescribe `.env.enc` si está definida) |
| `WORD_PASSWORD` | Sí | Contraseña para abrir y guardar únicamente tu `.docx` de Journal diario |
| `ENGLISH_WORD_FILE_PATH` | Opcional | Ruta `.docx` o carpeta para tu notebook de inglés si lo mueves fuera de `english-notes/English_Learning_Notebook.docx` (actualizable desde GitHub Variables) |
| `JOURNAL_SECRET_KEY` | Sí | Clave E2EE de exactamente **32 bytes UTF-8** (usada tanto por Journal Notes como por English Notebook en el navegador) |
| `GITHUB_TOKEN` | Recomendada | Token personal de GitHub (solo lectura de Actions Variables) para autodetectar cambios de `EC2_HOST`, `PORT`, `WORD_FILE_PATH`, `ENGLISH_WORD_FILE_PATH` y `YT_DLP_PATH` |
| `GITHUB_REPO` | Si usas token | Repositorio en formato `Flax64/mood-tracker` (valor por defecto si se omite) |
| `PORT` | Opcional | Puerto respaldo si no está en GitHub Variables (por defecto `3000`) |
| `URL_AWS` / `AWS_HOST` | Solo sin token | Respaldo manual (`http://IP:3000/api/pull-text` o solo la IP; para inglés sustituye `/api/pull-english` solo) si no configuras `GITHUB_TOKEN` |
| `STUDY_RCLONE_REMOTE` / `STUDY_RCLONE_DIR` | Opcional | Remoto/carpeta `rclone` dedicada exclusivamente para respaldar `English_Learning_Notebook.docx` (jamás sube `Journal.docx`, validado explícitamente en `sincronizar_word_estudio_a_drive`) |

### Arranque 100% automático al encender la PC (Windows DPAPI)
Para que `sincronizador.py` siga arrancando solo y en segundo plano al encender Windows **sin dejar `.env` plano ni contraseñas legibles en disco**, guarda tu contraseña maestra cifrada con **Windows DPAPI** (vinculada únicamente a tu sesión de usuario en esta PC, en `%LOCALAPPDATA%\mood-tracker\vault.dpapi`):

```bash
# 1. Configurar una sola vez (te pedirá tu contraseña de .env.enc y validará que funcione)
python sincronitation/sincronizador.py --configurar-autoinicio

# 2. Probar que descifra en RAM sin pedir contraseña
python sincronitation/sincronizador.py --probar-autoinicio

# (Si algún día quieres revocar el autoinicio silencioso y volver a pedir contraseña:)
python sincronitation/sincronizador.py --quitar-autoinicio
```

### Cómo reiniciar, ejecutar o revisar el log del sincronizador (y qué pasa con los archivos Word)

> **¿Se crea automáticamente el Word de notas de idiomas si no existe?**
> - **`English_Learning_Notebook.docx`** (`ENGLISH_WORD_FILE_PATH` o `english-notes/English_Learning_Notebook.docx`): **Sí.** Si la carpeta o el `.docx` no existen, la función `_asegurar_documento_ingles()` en `sincronizador.py` los crea automáticamente con portada, **Tabla de Contenidos** y las 4 secciones `Heading 1` (`1. Glossary & New Words`, `2. Grammar & Usage Notes`, `3. Phrasal Verbs` y `4. Songs & Music Study`).
> - **Word de Diario protegido con contraseña (`WORD_FILE_PATH`)**: **No.** Por seguridad de contraseña (`WORD_PASSWORD`), `agregar_texto_a_word()` exige que el archivo `.docx` ya exista (si falta, registra el error en `sincronitation/historial.log` sin sobrescribir ni crear archivos sin clave).

```bash
# 1. Detener cualquier instancia previa de sincronizador.py / pythonw.exe en Windows (Git Bash)
powershell.exe -NoProfile -Command 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*sincronizador.py*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "Detenido PID: $($_.ProcessId)" }'

# 2. Volver a iniciarlo en segundo plano (sin ventana) desde la carpeta actual usando DPAPI
powershell.exe -NoProfile -Command 'Start-Process -FilePath pythonw.exe -WorkingDirectory (Get-Location).Path -ArgumentList "sincronitation\sincronizador.py" -WindowStyle Hidden'

# (Alternativa en PowerShell directo:)
# Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*sincronizador.py*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
# Start-Process -FilePath pythonw.exe -WorkingDirectory "C:\Users\flavi\Desktop\9no Semestre\Proyectos\personal-daily-hub" -ArgumentList "sincronitation\sincronizador.py" -WindowStyle Hidden

# 3. Verificar que quedó corriendo y leer los últimos eventos del log
powershell.exe -NoProfile -Command 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*sincronizador.py*" } | Select-Object ProcessId, CommandLine'
tail -n 30 sincronitation/historial.log
```

### 2.1 Extractor local de subtítulos / letras con `yt-dlp` (`sincronitation/yt_lyrics_helper.py`)
Para videos de YouTube o YouTube Music que incluyan subtítulos (`CC` manuales o auto-generados) puedes extraerlos en tu PC sin cargar librerías Python pesadas ni `yt-dlp` dentro de AWS EC2:
```bash
# Verificar desde dónde detecta yt-dlp (PATH o GitHub Variable YT_DLP_PATH)
python sincronitation/yt_lyrics_helper.py --check-yt-dlp --refresh-github-var

# Extrae subtítulos (en, ko, es), limpia timestamps y los copia al portapapeles
python sincronitation/yt_lyrics_helper.py "https://www.youtube.com/watch?v=VIDEO_ID" --clip

# Guardar en archivo .txt UTF-8 combinando todos los idiomas encontrados
python sincronitation/yt_lyrics_helper.py "https://music.youtube.com/watch?v=VIDEO_ID" --all-langs --langs ko,en,es --out letra.txt

# Limpiar un archivo .srt / .vtt / .lrc ya descargado sin usar red
python sincronitation/yt_lyrics_helper.py --clean-file subtitulos.vtt --clip
```
* **Configurar la ruta de `yt-dlp` mediante GitHub Repository Variables (`YT_DLP_PATH`):**
  1. En GitHub abre tu repositorio → **Settings → Secrets and variables → Actions → Variables → New repository variable**.
  2. Crea la variable **`YT_DLP_PATH`** con el valor de tu carpeta o ejecutable en Windows, por ejemplo `C:\Users\flavi\Desktop\Download Videos\yt-dlp.exe` (o solo `C:\Users\flavi\Desktop\Download Videos`; el script detecta ambos automáticamente).
  3. Como ya tienes `GITHUB_TOKEN` + `GITHUB_REPO` en tu `.env.enc` (con autoinicio DPAPI activo para `sincronizador.py`), `yt_lyrics_helper.py` descifra el token en RAM silenciosamente, consulta `YT_DLP_PATH` vía GitHub API y lo cachea por 5 minutos en `.last_yt_dlp_path.json`.
  4. Prueba que la lee al instante con: `python sincronitation/yt_lyrics_helper.py --check-yt-dlp --refresh-github-var`.
* Banderas disponibles: `--langs`, `--all-langs`, `--out`, `--clip`, `--json`, `--yt-dlp-bin`, `--check-yt-dlp`, `--refresh-github-var` y `--clean-file`.
* En la app web (**Learn with Music -> Song Study Notes**), también puedes importar archivos `.srt`, `.vtt`, `.lrc` o `.txt` directamente en el navegador con **`📥 Import .srt/.vtt/.lrc`** o limpiar timestamps pegados con **`🧹 Clean Timestamps`**.
* *(Nota técnica: muchos "Art Tracks" automáticos de `music.youtube.com` no contienen pista CC; en ese caso el comando indica qué subtítulos faltan y puedes apuntar al M/V oficial o Lyric Video en YouTube).*

### 2.2 Movilidad del Cajón Flotante y Extensión de Escritorio o Celular
1. Abre **`🌐 Quick Translator`** (botón flotante inferior derecho, menú lateral, botón **`🌐 Traducir`** al seleccionar letras o atajo **`Alt + T`**).
2. Para no tapar tu vista mientras lees o repasas canciones, **arrastra la cabecera (`⋮⋮`)** hacia cualquier parte de la pantalla (la posición se guarda automáticamente y se restablece con **`↺`**).
3. Para usar la mini ventana externa, presiona **`🪟 Window`** (o accede directo a `http://TU_IP:3000/translator-popup.html`):
   - En **Chrome / Edge (Windows)**: clic en **`⋮` → Guardar y compartir → Crear acceso directo** y marca **Abrir como ventana**.
   - En **Chrome (Android / OPPO A79)**: menú **`⋮` → Agregar a pantalla principal** para usarlo como mini app independiente junto a YouTube o PDFs.

---

## 3. Git Bash, pruebas y rama protegida `main`

La rama `main` está protegida: los cambios siempre se suben desde una rama de trabajo (por ejemplo `mejoras`) y se integran mediante **Pull Request** en GitHub.

```bash
# 1. Ver en qué rama estás y qué archivos detecta Git
# (english-notes/, .env, .env.enc, .ssh/ y sincronitation/ NUNCA deben aparecer aquí)
git branch
git status

# 2. Correr todas las pruebas automatizadas localmente
npm test
# (En PowerShell usa: npm.cmd test)

# 3. Guardar y subir tus cambios a tu rama de trabajo
git add <archivos>
git commit -m "descripcion clara del cambio"
git push -u origin mejoras
```

### Cómo revisar el reporte de pruebas en GitHub Actions
1. Al hacer `git push` a `mejoras` o abrir un **Pull Request → `main`**, se ejecuta automáticamente el workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
2. Entra en GitHub a **Actions → CI — Pruebas y Validación** (o haz clic en el check dentro del Pull Request).
3. En la pantalla principal del run verás la tabla de resumen generada por [`tests/ci-summary.js`](../tests/ci-summary.js) (`Validación y Pruebas Aprobadas` / `Fallidas`, conteo de pruebas y detalle por caso).
4. Cuando las pruebas pasen y hagas **Merge Pull Request → `main`**, [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) desplegará automáticamente en EC2.

---

## 4. Qué consultar en GitHub y en EC2

El servidor EC2 **no conserva `.env` en disco** (`SEAL_ENV_AFTER_DEPLOY=true`): las credenciales solo existen en RAM durante el arranque del contenedor y en tu configuración de GitHub.

### 4.1 Consultar configuración en GitHub
Ve en GitHub a **Settings → Secrets and variables → Actions**:
* **Variables (visibles en claro):** `EC2_HOST`, `EC2_USER`, `PORT`, `TZ`, `DB_HOST`, `DB_USER`, `DB_NAME`, `RCLONE_REMOTE`, `RCLONE_BACKUP_DIR`, `BACKUP_CRON_SCHEDULE` (`30 3 * * *`), `SEAL_ENV_AFTER_DEPLOY` (`true`), además de las variables opcionales del sincronizador Windows: `WORD_FILE_PATH`, `ENGLISH_WORD_FILE_PATH` y `YT_DLP_PATH`.
* **Secrets (por seguridad GitHub nunca muestra su valor, solo permite reemplazarlos):** `EC2_SSH_KEY`, `DB_PASS`, `ADMIN_EMAIL`, `ADMIN_SECRET`, `WORD_PASSWORD`, `JOURNAL_SECRET_KEY`, `SMTP_USER`, `SMTP_PASS`, `RCLONE_CONF_B64`.
* Si no creas `APP_BASE_URL`, `deploy.yml` calcula automáticamente `http://${EC2_HOST}:${PORT}` en cada despliegue (solo créala si conectas un dominio propio HTTPS).

### 4.2 Consultar estado en el servidor EC2 (vía SSH)
Conéctate desde Git Bash:
```bash
ssh -i .ssh/clave-pmt.pem ubuntu@IP_DE_TU_EC2
```

Comandos útiles dentro de EC2:
```bash
# Estado de contenedores y uso actual de RAM (límites 512m MySQL + 220m Node)
docker ps
docker stats --no-stream

# Últimos logs de la aplicación web y de MySQL
docker logs --tail 50 mood_app
docker logs --tail 50 mood_db

# Confirmar que NO hay archivo .env expuesto en disco
ls -la ~/projects/mood-tracker

# Estado de la bóveda en servidor, metadatos no sensibles y logs del cron
~/projects/mood-tracker/scripts/env-vault.sh status
cat ~/projects/respaldos/.backup.meta
tail -n 30 ~/projects/respaldos/backup.log

# Hora del servidor y tarea cron diaria (3:30 AM hora TZ)
timedatectl
crontab -l

# Ver qué hay actualmente guardado en Google Drive
rclone ls gdrive:RespaldosApp

# Obtener de nuevo RCLONE_CONF_B64 (por si necesitas re-pegarlo en GitHub Secrets)
base64 -w 0 ~/.config/rclone/rclone.conf
```

---

## 5. Respaldos manuales y restauración desde Drive

* **Respaldo automático nocturno + retención inteligente de 1 mes en MySQL:** corre todos los días a las **03:30 AM** (`30 3 * * *`) en modo sellado (`SEALED_MODE=1`) sin necesitar `.env`, leyendo las variables activas dentro del contenedor `mood_db`. Además de subir `respaldo_mood_tracker.sql.gz`, `scripts/backup.sh` fusiona acumulativamente los registros de `RegistrosMood`, `RegistrosSleep`, `RegistrosCrisis` y `RegistrosAgenda` dentro de `historico_completo.json.gz` en Google Drive y después purga en MySQL local los registros mayores a `DB_RETENTION_DAYS` (por defecto **30 días**) para que la instancia `t3.micro` nunca se sature. Los últimos 3, 6 o 12 meses pueden consultarse bajo demanda en RAM desde `#resumen` vía `GET /api/archive/drive-range`.
* **Generar un respaldo manual inmediato en EC2:**
  ```bash
  ~/projects/mood-tracker/scripts/backup.sh
  ```
  Debes ver al final: `Respaldo completado (modo=sellado) y subido a gdrive:RespaldosApp/respaldo_mood_tracker.sql.gz`.
* **Restauración automática en instancia nueva o BD vacía:** durante el despliegue con `deploy.yml`, se ejecuta `ENV_FILE_OVERRIDE="$DEPLOY_ENV_FILE" ./scripts/restore.sh --if-empty`.
* **Restauración manual de emergencia** (en un servidor ya sellado que **no** tiene `.env` ni `.env.enc` en disco, ya que [`scripts/restore.sh`](../scripts/restore.sh) exige un archivo de entorno si se invoca directo):
  ```bash
  # Descarga desde Drive e importa directo usando las variables vivas de mood_db (sin crear .env)
  rclone copyto gdrive:RespaldosApp/respaldo_mood_tracker.sql.gz /tmp/restore_manual.sql.gz
  gunzip -c /tmp/restore_manual.sql.gz | docker exec -i mood_db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root "$MYSQL_DATABASE"'
  rm -f /tmp/restore_manual.sql.gz
  ```

---

## 6. Migración a otra instancia AWS EC2 (usando `.ssh/`)

### 6.1 Inventario de tus llaves SSH actuales (`.ssh/`)
En la carpeta `.ssh/` del proyecto (ignorada por `.gitignore`) tienes:

| Archivo | Para qué sirve | Dónde se usa al migrar |
| :--- | :--- | :--- |
| `.ssh/clave-pmt.pem` | Llave principal de AWS EC2 (Key pair creada en AWS) | La usas desde tu PC para entrar manualmente por primera vez a la nueva EC2 |
| `.ssh/github_deploy_key` | Llave privada dedicada para GitHub Actions (`secrets.EC2_SSH_KEY`) | Ya está guardada en **GitHub Secrets (`EC2_SSH_KEY`)** |
| `.ssh/github_deploy_key.pub` | Llave pública correspondiente a `github_deploy_key` | **Debes copiar su contenido** a `~/.ssh/authorized_keys` en la nueva instancia |

> **Regla clave:** Mientras conserves `.ssh/github_deploy_key` en `EC2_SSH_KEY` y agregues `.ssh/github_deploy_key.pub` a la nueva instancia, **no necesitas regenerar `EC2_SSH_KEY` en GitHub**.

### 6.2 Paso 1 — Respaldo previo antes de apagar la instancia vieja
1. Si la instancia actual sigue encendida, entra por SSH y ejecuta:
   ```bash
   ~/projects/mood-tracker/scripts/backup.sh
   ```
2. Confirma en GitHub (**Settings → Secrets and variables → Actions**) que tienes tus Secrets y Variables configurados, y que **`APP_BASE_URL` está vacío o eliminado** (para que `.github/workflows/deploy.yml` calcule automáticamente `http://${EC2_HOST}:${PORT}` usando tu nueva IP sin apuntar nunca a la instancia vieja).

### 6.3 Paso 2 — Lanzar la nueva instancia en AWS
1. **AMI:** Ubuntu Server 22.04 / 24.04 LTS (`EC2_USER=ubuntu`) o Amazon Linux 2023 (`EC2_USER=ec2-user`).
2. **Tipo:** `t3.micro`.
3. **Disco (Storage):** `15 GB` o `20 GB` `gp3`.
4. **Par de llaves (Key pair):** elige `clave-pmt` (la misma que `.ssh/clave-pmt.pem`). *(Si eliges otro `.pem` nuevo, guárdalo en `.ssh/` y úsalo en los comandos de abajo en vez de `clave-pmt.pem`.)*
5. **Security Group:** abre TCP `22` (SSH) y TCP `3000` (o el puerto configurado en tu variable `PORT`).

### 6.4 Paso 3 — Autorizar llave SSH de GitHub Actions (Swap 1 GB ya es automático)

Reemplaza `NUEVA_IP` (y `ubuntu` por `ec2-user` si usas Amazon Linux):

#### Opción A: Comandos en **Git Bash** (recomendado)
```bash
cd "<RUTA_DEL_REPOSITORIO>"

# 1. Asegurar permisos de lectura exclusiva en las llaves privadas
chmod 600 .ssh/clave-pmt.pem .ssh/github_deploy_key

# 2. Autorizar .ssh/github_deploy_key.pub en el nuevo servidor sin duplicar líneas
PUB_KEY="$(tr -d '\r\n' < .ssh/github_deploy_key.pub)"
ssh -i .ssh/clave-pmt.pem ubuntu@NUEVA_IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '$PUB_KEY' ~/.ssh/authorized_keys || printf '%s\n' '$PUB_KEY' >> ~/.ssh/authorized_keys"

# 3. Probar desde ya que GitHub Actions podrá conectarse con github_deploy_key
ssh -i .ssh/github_deploy_key ubuntu@NUEVA_IP "whoami && echo SSH_DEPLOY_OK"
```

#### Opción B: Equivalente rápido en **PowerShell** (si `ssh` de Windows pide ACL estrictas)
```powershell
icacls ".\.ssh\clave-pmt.pem" /inheritance:r /grant:r "$($env:USERNAME):(R)"
icacls ".\.ssh\github_deploy_key" /inheritance:r /grant:r "$($env:USERNAME):(R)"

$pub = (Get-Content ".\.ssh\github_deploy_key.pub" -Raw).Trim()
ssh -i ".\.ssh\clave-pmt.pem" ubuntu@NUEVA_IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '$pub' ~/.ssh/authorized_keys || printf '%s\n' '$pub' >> ~/.ssh/authorized_keys"
ssh -i ".\.ssh\github_deploy_key" ubuntu@NUEVA_IP "whoami && echo SSH_DEPLOY_OK"
```

> **Swap automática desde el primer segundo:** Ya no necesitas entrar manualmente a crear Swap antes del primer despliegue. En cuanto ejecutes el workflow de deploy, `.github/workflows/deploy.yml` ejecuta como **Paso `# 0` (lo primero al entrar por SSH antes de instalar paquetes o compilar)** la creación y activación idempotente de **`/swapfile` (1 GB)** en `/etc/fstab`.

### 6.5 Paso 4 — Actualizar `EC2_HOST` y desplegar desde GitHub
1. En GitHub → **Settings → Secrets and variables → Actions → Variables**:
   * Actualiza **`EC2_HOST`** con `NUEVA_IP`.
   * Si cambiaste de sistema (ej. de Ubuntu a Amazon Linux), actualiza también **`EC2_USER`**.
   * Asegúrate de que `RCLONE_CONF_B64` siga vigente en Secrets para restaurar tu base de datos desde Google Drive si la nueva instancia arranca vacía.
2. Ve a **Actions → Deploy to AWS EC2 → Run workflow** (rama `main`).
3. El workflow activará **1 GB de Swap como primer paso (`# 0`)**, instalará dependencias (`git`, `curl`, `rclone`, `cron`, `openssl`, `docker` + `docker-compose-plugin` / Compose v2), clonará el repo, construirá `APP_BASE_URL` automáticamente con `NUEVA_IP`, levantará Docker leyendo secretos solo desde RAM (`/dev/shm`), restaurará todas tus tablas (`Mood`, `Sleep`, `Crisis`, `Agenda`, `MusicaCanciones`, etc.) con `scripts/restore.sh --if-empty`, ajustará hora y cron `30 3 * * *`, y destruirá el env en RAM sin dejar `.env` en disco.

### 6.6 Paso 5 — Verificación final y rotación opcional de llave
* Abre `http://NUEVA_IP:3000` e inicia sesión para validar que ánimo, sueño, agenda y cuentas están restaurados.
* En tu PC Windows, si tu `.env.enc` tiene `GITHUB_TOKEN` + `GITHUB_REPO`, `sincronizador.py` tomará `NUEVA_IP` automáticamente tanto para **Journal Notes** (`/api/pull-text`) como para **English Notebook** (`/api/pull-english`) en <= 5 minutos (o al reiniciar el script), manteniendo la ruta relativa local `english-notes/English_Learning_Notebook.docx` sin tocar `.env` ni rutas.
* **Solo si algún día quieres rotar `.ssh/github_deploy_key`** en Git Bash:
  ```bash
  ssh-keygen -t ed25519 -C "mood-tracker-deploy" -f .ssh/github_deploy_key_nueva -N ""
  ```
  Actualiza el Secret **`EC2_SSH_KEY`** con el contenido de `.ssh/github_deploy_key_nueva`, agrega `.ssh/github_deploy_key_nueva.pub` a `~/.ssh/authorized_keys` en el servidor y retira la línea antigua.

---

## 7. Solución rápida de problemas

| Síntoma | Causa probable | Solución inmediata |
| :--- | :--- | :--- |
| El prompt oculto de `local-vault.js` o `sincronizador.py` se traba en Git Bash | Estás en ventana `mintty` fuera de VS Code sin ConPTY | Antepón `winpty`: `winpty node scripts/local-vault.js decrypt` |
| `WARNING: UNPROTECTED PRIVATE KEY FILE!` en SSH | Permisos demasiado abiertos en `.ssh/*.pem` o `github_deploy_key` | En Git Bash: `chmod 600 .ssh/clave-pmt.pem .ssh/github_deploy_key`. En PowerShell: `icacls ...` (Sección 6.4 Opción B) |
| `git push origin main` rechazado | Regla de protección en `main` | Cambia o sube desde tu rama de trabajo (`git push -u origin mejoras`) y haz Pull Request |
| `sincronizador.py` falla tras cambiar de IP EC2 | Falta `GITHUB_TOKEN` en `.env.enc` o sigue en caché <= 5 min | Verifica `GITHUB_TOKEN` y `GITHUB_REPO` con `local-vault.js run` o reinicia el sincronizador |
| Olvidaste correr `lock` / `encrypt` tras ver `.env` | `.env` plano quedó temporalmente en disco | Ejecuta `node scripts/local-vault.js lock` (si no editaste) o `encrypt` (si editaste) |

---

## 8. Notificaciones Móviles, Agenda Jira y Settings

No necesitas agregar nuevos *Secrets* ni *Variables* en GitHub para usar los recordatorios en tu teléfono ni las categorías de Agenda: todo se administra desde el menú **⚙️ Settings** dentro de la propia aplicación web y se guarda por usuario en MySQL (`ConfiguracionUsuario`).

### 8.1 Cómo recibir los recordatorios en la barra de notificaciones de tu celular (OPPO A79 / Android / iOS)

*(Nota técnica de sesiones y pestañas: el backend limita a `MAX_ACTIVE_SESSIONS_PER_USER = 3` sesiones activas en `SesionesAuth` conservando las más recientes, y el frontend aplica guardia de pestaña única vía `BroadcastChannel('pdh_active_tab_channel_v1')` para que tocar **`Open App`** con `fromNtfy=1` reutilice y enfoque la pestaña ya abierta sin acumular duplicados).*

1. Instala la aplicación gratuita **ntfy** (desde Google Play Store en Android o App Store en iOS).
2. Entra a **Personal Daily Hub** en tu navegador → abre **⚙️ Settings** en la barra lateral.
3. En la tarjeta **📱 Phone Notification Bar (ntfy)**:
   * Marca **Enable notifications on my phone's notification bar**.
   * Haz clic en **Generate** para crear un tópico privado único (mínimo 8 caracteres, p. ej. `hub_personal_...`) o escribe uno propio difícil de adivinar.
   * Abre la app **ntfy** en tu celular, presiona **`+`** (*Subscribe to topic*), pega exactamente ese mismo nombre de tópico y deja el servidor por defecto (`https://ntfy.sh`). En OPPO ColorOS / Android conviene desactivar el ahorro agresivo de batería para **ntfy** para que lleguen al instante con la pantalla apagada.
   * Mantén desmarcada la casilla *Also show desktop browser notifications* si no necesitas alertas en tu computadora.
4. En **Personal Daily Hub → Settings**, haz clic en **Save All Settings** y después en **🔔 Send Test to Phone** para verificar que aparezca de inmediato en la barra de notificaciones de tu teléfono.

### 8.2 Reglas predeterminadas y configurables

| Módulo | Comportamiento por defecto | Qué puedes configurar en Settings |
| :--- | :--- | :--- |
| **Estado de Ánimo (`Mood Tracker`)** | Activo; recuerda a mitad de cada horario (**`09:00` Morning**, **`13:00` Noon**, **`17:00` Afternoon**, **`22:00` Night**) solo si aún no registraste ese bloque | Activar/desactivar; activar opcionalmente **`Madrugada` (`03:00 AM`)** |
| **Sueño (`Sleep Tracker`)** | Activo a las **`08:30 AM`** si no hay registro de sueño hoy | Hora personalizada + botones **Snooze 15m / 30m / 1h** |
| **Agenda (`University` & `Personal`)** | Activo **10 min antes** para Eventos y Tareas que no estén en estado `Done` | Activar/desactivar Eventos y/o Tareas, antelación global (`0–60 min`) o aviso individual por actividad; cambiar estado Jira (**To Do** / **In Progress** / **Done**) o posponer |
| **Revisión nocturna Word** | Activo a las **`21:30`** para revisar notas de Journal y English `.docx` | Cambiar hora o desactivar |
| **Estudio de Inglés** | **Desactivado por defecto** (100% bajo tu control) | Activar, escoger días de la semana (`Mon–Sun`), hora y nota de repaso |

### 8.3 Migrar contenedores existentes en AWS EC2

Cuando hagas merge de tu rama hacia `main`, GitHub Actions reconstruye automáticamente Docker en tu EC2 y al arrancar `server.js`:
* Se crean automáticamente `ConfiguracionUsuario` y `RecordatoriosEstado` (si no existían).
* Se añaden las columnas `tipo`, `categoria`, `estado` y `recordatorio_min` a `RegistrosAgenda` sin borrar ni afectar ningún dato anterior.

---

## 9. Seguridad en YouTube Music (Cero Credenciales)

El módulo **🎵 Learn with Music** fue diseñado bajo arquitectura **Zero-Credential**:

1. **Ni GitHub ni la instancia EC2 ven tu contraseña o sesión de Google:**
   * Nunca guardes tu contraseña de Google, cookies de navegador (`SAPISID`, `__Secure-*`) ni tokens OAuth privados en `.env`, Secrets de GitHub o MySQL.
   * Cuando presionas **Find in YouTube Music** o **My YouTube Music Library**, la búsqueda se abre directamente en **tu propio navegador** contra `https://music.youtube.com` usando la sesión que ya tienes iniciada directamente con Google (protegida con tu 2FA / Passkey).
   * Incluso si un atacante comprometiera por completo el servidor EC2 o los archivos del repositorio en GitHub, **no existe ninguna contraseña, cookie ni token personal de tu cuenta de Google/YouTube Music que pueda robar**.
2. **Saneamiento estricto de enlaces antes de guardar metadatos:**
   * `parseYouTubeMusicInput()` en `server.js` rechaza cualquier URL fuera de `music.youtube.com`, `youtube.com` o `youtu.be` (bloqueo SSRF), bloquea URLs con credenciales embebidas (`usuario:clave@`), elimina parámetros de sesión/rastreo (`si`, `authuser`, tokens) y normaliza las pistas a `https://music.youtube.com/watch?v=<ID>`.
3. **¿Y `YOUTUBE_API_KEY`?** Es completamente **opcional** y está desactivada por defecto. De configurarse algún día en tu entorno, solo sirve para consultar títulos públicos en YouTube Data API v3 y **no** otorga acceso a cuentas personales ni listas privadas.

---

## 10. Renombrar Repositorio, Autoinicio y Reiniciar Python Local

El pipeline [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) obtiene el nombre del repositorio dinámicamente desde `${{ github.repository }}` y actualiza automáticamente el `origin` remoto dentro de EC2 (`git remote set-url origin ...`), manteniendo intacto el directorio interno `~/projects/mood-tracker` en el servidor para **no perder ni duplicar** tu volumen de base de datos MySQL en Docker ni romper el `cron` de respaldos.

### ¿Qué pasa al apagar o reiniciar tu PC con Windows?
1. Al iniciar sesión en Windows, la carpeta de inicio (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\iniciar_diario.vbs`) lanza automáticamente `pythonw.exe` en segundo plano **sin pedir contraseña**, porque la clave maestra se descifra en memoria mediante **Windows DPAPI** (`%LOCALAPPDATA%\mood-tracker\vault.dpapi`).
2. **Importante sobre la ruta de `iniciar_diario.vbs`:** si renombraste o moviste la carpeta local de `mood-tracker` a `personal-daily-hub`, asegúrate de actualizar ese script `.vbs` (el siguiente comando lo corrige de inmediato y puedes verificar su contenido):
   ```powershell
   # Ver qué ruta tiene actualmente tu script de Inicio de Windows:
   Get-Content "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\iniciar_diario.vbs"

   # Actualizar la ruta de mood-tracker -> personal-daily-hub (ejecutar 1 sola vez en PowerShell):
   @'
   Set WshShell = CreateObject("WScript.Shell")
   WshShell.CurrentDirectory = "C:\Users\flavi\Desktop\9no Semestre\Proyectos\personal-daily-hub"
   WshShell.Run "pythonw.exe ""C:\Users\flavi\Desktop\9no Semestre\Proyectos\personal-daily-hub\sincronitation\sincronizador.py""", 0, False
   '@ | Set-Content -Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\iniciar_diario.vbs" -Encoding ASCII
   ```
3. **¿Se actualiza solo al apagar o reiniciar la PC?**
   - **Lo que SÍ ocurre automáticamente tras apagar/reiniciar la PC:** Windows vuelve a iniciar `sincronizador.py` de forma silenciosa mediante `iniciar_diario.vbs` + **DPAPI** (`%LOCALAPPDATA%\mood-tracker\vault.dpapi`, sin dejar contraseñas planas en disco ni pedir clave manual), y `sincronizador.py` **actualiza automáticamente en caliente** las variables remotas desde **GitHub Actions Variables API** al arrancar y cada 5 minutos (`EC2_HOST`, `PORT`, `WORD_FILE_PATH`, `ENGLISH_WORD_FILE_PATH` y `YT_DLP_PATH`), retomando de inmediato el vaciado E2EE de tus notas pendientes.
   - **Lo que NO se actualiza solo sin tu acción:** `sincronitation/sincronizador.py` está en `.gitignore` para proteger tu bitácora y configuración local en Windows, así que al reiniciar la PC se vuelve a ejecutar la versión que ya tienes en disco. Si descargaste código nuevo del repositorio (`git pull`) o editaste `sincronitation/sincronizador.py`, detén y vuelve a lanzar `pythonw.exe` (Paso 1 y Paso 5) o usa este bloque opcional en `iniciar_diario.vbs` si quieres que cada reinicio de Windows haga `git pull --ff-only` seguro de los archivos rastreados antes de levantar Python:
   ```vbscript
   Set WshShell = CreateObject("WScript.Shell")
   WshShell.CurrentDirectory = "C:\Users\flavi\Desktop\9no Semestre\Proyectos\personal-daily-hub"
   WshShell.Run "cmd.exe /c git pull --ff-only origin main >NUL 2>&1 & pythonw.exe ""C:\Users\flavi\Desktop\9no Semestre\Proyectos\personal-daily-hub\sincronitation\sincronizador.py""", 0, False
   ```

Sigue este orden exacto en **Git Bash** para renombrar tanto en GitHub como en tu PC sin interrumpir el pipeline ni dejar ejecutándose una versión vieja de Python:

1. **Detener el proceso Python local activo** (evita que Windows bloquee la carpeta al renombrarla):
   ```bash
   powershell.exe -NoProfile -Command 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*sincronizador.py*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "Detenido PID: $($_.ProcessId)" }'
   ```
2. **Renombrar el repositorio en GitHub:**
   * En GitHub → **Settings → General → Repository name**, escribe el nuevo nombre (por ejemplo `personal-daily-hub`) y haz clic en **Rename**. *(Todos los Secrets, Variables y reglas de `main` se conservan automáticamente).*
3. **Actualizar tu carpeta local, remoto Git y bóveda `.env.enc` en Windows (Git Bash):**
   ```bash
   # Suponiendo nuevo nombre: personal-daily-hub y usuario GitHub: Flax64
   cd ".."
   mv mood-tracker personal-daily-hub
   cd personal-daily-hub

   # Apuntar el remoto local al nuevo nombre en GitHub
   git remote set-url origin https://github.com/Flax64/personal-daily-hub.git
   git remote -v

   # Descifrar brevemente .env.enc para actualizar GITHUB_REPO=Flax64/personal-daily-hub
   node scripts/local-vault.js decrypt
   grep -q '^GITHUB_REPO=' .env && sed -i 's|^GITHUB_REPO=.*|GITHUB_REPO=Flax64/personal-daily-hub|' .env || printf '\nGITHUB_REPO=Flax64/personal-daily-hub\n' >> .env
   node scripts/local-vault.js encrypt
   node scripts/local-vault.js status
   ```
4. **Actualizar el autoinicio en Windows (si tenías tarea o acceso directo apuntando a la ruta anterior):**
   * Si usabas un acceso directo en `shell:startup` o el **Programador de tareas** de Windows apuntando a `...\mood-tracker\sincronitation\sincronizador.py`, actualiza la ruta y carpeta de inicio (*Start in*) hacia `...\personal-daily-hub`.
   * Verifica que el descifrado DPAPI sigue funcionando en la carpeta renombrada:
     ```bash
     python sincronitation/sincronizador.py --probar-autoinicio
     ```
5. **Reiniciar el sincronizador Python local en segundo plano** (para cargar el nuevo código, la sección `4. Songs & Music Study` y el nuevo `GITHUB_REPO`):
   ```bash
   powershell.exe -NoProfile -Command 'Start-Process -FilePath pythonw -WorkingDirectory (Get-Location).Path -ArgumentList "sincronitation\sincronizador.py" -WindowStyle Hidden'
   tail -n 15 sincronitation/historial.log
   ```

> **Tip:** Cada vez que hagas `git pull` con mejoras nuevas en `sincronitation/sincronizador.py`, repite el **Paso 1** (detener `pythonw` anterior) y el **Paso 5** (volver a iniciar `pythonw` oculto) para asegurarte de que tu Word en PC esté usando la versión más reciente.

---

## 11. Verificación del Túnel Cifrado e IA Gemini en EC2

### 11.1 Configurar `GEMINI_API_KEY` opcional con migración automática
1. Puedes dejar que el sistema use el **motor local 0-RAM** de Hangul/Inglés sin costo, O activar **Google Gemini** de dos maneras:
   - **Vía UI:** en **Settings → 🤖 Language AI & Multilingual Study** pega tu API Key (viajará cifrada dentro del túnel `X25519 + AES-256-CTR` y quedará guardada en `ConfiguracionUsuario` sin volver a exponerse al cliente).
   - **Vía GitHub Secrets (migración 100% automatizada a cualquier EC2 nueva):** agrega el Secret `GEMINI_API_KEY` en GitHub; [`deploy.yml`](../.github/workflows/deploy.yml) y [`docker-compose.yml`](../docker-compose.yml) lo inyectan en RAM al contenedor durante el despliegue sin dejar `.env` plano en disco.

### 11.2 Cómo auditar y probar en vivo que el tráfico por Internet viaja encriptado
Además de usar los botones **🔍 Inspect Live Wire Packet** y **⚡ Benchmark Large Payloads** dentro de **Settings**:
1. **Inspección de red real con `tcpdump` desde SSH en AWS EC2:**
   ```bash
   sudo tcpdump -A -i any port 3000 -s 0
   ```
   Mientras inicias sesión, guardas en el Journal o envías letras largas para análisis de IA, observarás que tanto las peticiones como las respuestas JSON solo contienen el sobre `{ "__enc": "x25519-aes256ctr-hmac-v1", "iv": "...", "ct": "...", "mac": "..." }` sin ninguna palabra legible del payload original.
2. **Prueba automatizada de manipulación (HMAC), replay y carga pesada (`192 KB`):**
   ```bash
   node --test --test-reporter=spec tests/server.integration.test.js
   ```
   Verifica automáticamente:
   - Intercambio efímero **X25519**, cifra/descifra de **>190 KB** ida y vuelta sin texto plano en el cable.
   - Rechazo inmediato (`400 TRANSPORT_MAC_INVALID`) si un atacante altera un solo carácter de `ct`.
   - Bloqueo (`409 TRANSPORT_REPLAY`) si se reenvía un paquete capturado anteriormente.

### 11.3 Repertorio Musical en IA, Traductor Global, `yt_lyrics_helper.py` y Bitácora de Crisis
- **`RegistrosCrisis`, `RegistrosSleep` y migración:** se crean y actualizan automáticamente al iniciar `server.js` mediante `inicializarTablasSeguridad()` e igualmente están declaradas en `init.sql` (13 tablas totales), garantizando migración sin pérdida de datos en nuevas instancias EC2.
- **Memoria Persistente (`languageMemory`) + Repertorio (`MusicaCanciones` / `MusicaAlbumes`) + Traductor:** los endpoints `POST /api/language/analyze` y `POST /api/language/translate` consultan en tiempo real tu catálogo de canciones registradas y tu memoria léxica almacenada en `ConfiguracionUsuario`, de modo que tanto el Tutor IA como el Traductor Flotante (`Alt+T` / `/translator-popup.html`) mantienen consistencia terminológica tras migrar de servidor o restaurar respaldos.
- **Resolución YouTube / YT Music, Puente Cifrado PC ↔ Word y Media Proxy (`yt-dlp` multiplataforma):** `POST /api/english/music/resolve` mantiene detección de álbum/año con `0 MB RAM` extra. Las letras nunca se almacenan en MySQL ni disco EC2: **`POST/GET /api/english/music/pc-jobs`** enlaza cifrado (**E2EE AES-256-CBC + HMAC-SHA256**) con el hilo `pc-music-bridge` de `sincronizador.py` para leer/organizar `English_Learning_Notebook.docx` (Álbum `Heading 2` → Pistas ordenadas `Heading 3` + auto-registro IA) y ejecutar `yt-dlp` en Windows usando `YT_DLP_PATH` (dejando cualquier nota pendiente en RAM EC2 cuando la PC está apagada). Además, `Dockerfile` instala `python3` + `/usr/local/bin/yt-dlp` y `lib/ytdlp-service.js` alimenta el extractor de respaldo en RAM (`storedInDb: false`) y el stream progresivo **`GET /api/english/music/songs/:id/media`** (`stream.pipeline`, sin buffering en disco).

---

## 12. Historial de Versiones y Auto-Versionado por Despliegue (`SemVer 2.0.0`)

Cada despliegue a producción desde `main` (o mediante **Actions → Run workflow**) genera automáticamente una nueva versión siguiendo el estándar **Semantic Versioning 2.0.0 (`MAJOR.MINOR.PATCH`) + Conventional Commits**:

| Prefijo del commit (o selección manual) | Incremento | Ejemplo | Cuándo usarlo |
| --- | --- | --- | --- |
| `fix:`, `perf:`, `security:`, `docs:`, `chore:` | **PATCH (`+0.0.1`)** | `1.0.0` → `1.0.1` | Corrección de errores/bugs, parches de seguridad, documentación o ajustes internos |
| `feat:` / `feat(alcance):` | **MINOR (`+0.1.0`)** | `1.0.1` → `1.1.0` | Nuevas funcionalidades o pantallas retrocompatibles |
| `BREAKING CHANGE:` o `<tipo>!:` | **MAJOR (`+1.0.0`)** | `1.1.0` → `2.0.0` | Cambios estructurales incompatibles |

### ¿Qué automatiza [`deploy.yml`](../.github/workflows/deploy.yml)?
1. **Job `release`:** Ejecuta [`scripts/release-version.js`](../scripts/release-version.js) `--apply --github-output`, analiza los commits incluidos desde el tag/despliegue anterior y calcula la siguiente versión exacta.
2. **Registro persistente:** Actualiza [`package.json`](../package.json), `package-lock.json`, [`version-history.json`](../version-history.json) y [`CHANGELOG.md`](../CHANGELOG.md), crea el commit `chore(release): vX.Y.Z ... [skip ci]` (si la rama permite push directo), etiqueta el repo con `vX.Y.Z` y publica el **GitHub Release**.
3. **Despliegue sincronizado a EC2:** Pasa `APP_VERSION` y `RELEASE_HISTORY_B64` por el paso SSH antes de reconstruir el contenedor (`docker compose up -d --build`), garantizando que **`GET /api/version`** y el modal **🏷️ Version History** dentro de la app reflejen al instante la versión recién desplegada.

---

## 13. Catálogo Maestro de Comandos Rápidos (Git Bash, PC, Docker y AWS EC2)

> Referencia rápida completa de comandos (también disponible en documento independiente: [Guía Rápida de Comandos](./GUIA_COMANDOS_RAPIDOS.md)). Todos los comandos están separados estrictamente por categoría para evitar confusiones.

### 13.1 Comandos para Dividir Archivos y Cargar a la IA (Git Bash)

#### Script Completo por Tamaño (`118 KB` en `codigo_dividido/`)
Divide automáticamente todo el código fuente del proyecto en partes de `118 KB` listas para subir a la IA, excluyendo `.git`, `node_modules`, `for-gemini` y `codigo_dividido`:

```bash
# Eliminar extracción anterior
rm -rf codigo_dividido

# Crear carpeta
mkdir -p codigo_dividido

# Buscar archivos del proyecto y dividirlos en bloques de 118 KB
find . -type f \( \
    -name "*.java" -o -name "*.js" -o -name "*.html" -o -name "*.css" -o -name "*.sql" -o \
    -name "*.cs" -o -name "*.py" -o -name "*.cpp" -o -name "*.h" -o -name "*.xml" -o \
    -name "*.json" -o -name "*.yml" -o -name "*.yaml" -o -name "Dockerfile" -o \
    -name "Dockerfile.*" -o -name "docker-compose*" -o -name "compose.yml" -o \
    -name "compose.yaml" -o -name ".dockerignore" -o -name ".gitignore" -o \
    -name ".env.example" -o -name "Makefile" \
\) \
-not -path "./.git/*" \
-not -path "./node_modules/*" \
-not -path "./codigo_dividido/*" \
-not -path "./for-gemini/*" \
| while IFS= read -r archivo; do

    nombre=$(basename "$archivo")
    nombre_limpio="${nombre%.*}"
    extension="${nombre##*.}"

    split -b 118K -d -a 3 \
    --additional-suffix=".$extension.txt" \
    "$archivo" "codigo_dividido/${nombre_limpio}_parte_"

done
```

#### División con Número de Línea Exacto (`for-gemini/`)
```bash
# Preparar carpeta for-gemini limpia
mkdir -p for-gemini && rm -f for-gemini/*.txt

# Dividir archivos Python con números de línea exactos
nl -ba sincronitation/yt_lyrics_helper.py | split -l 550 -d -a 2 - for-gemini/PY_HELPER_ && \
for f in for-gemini/PY_HELPER_*; do mv "$f" "${f}.txt"; done

nl -ba sincronitation/sincronizador.py | split -l 1200 -d -a 2 - for-gemini/PY_SINCRO_ && \
for f in for-gemini/PY_SINCRO_*; do mv "$f" "${f}.txt"; done

# Dividir frontend.js, server.js o style.css con números de línea
nl -ba public/frontend.js | split -l 2500 -d -a 2 - for-gemini/FRONT_ && \
for f in for-gemini/FRONT_*; do mv "$f" "${f}.txt"; done

nl -ba server.js | split -l 2000 -d -a 2 - for-gemini/SERVER_ && \
for f in for-gemini/SERVER_*; do mv "$f" "${f}.txt"; done

# Guardar resultado de pruebas en archivo de texto para enviar a la IA
npm test > for-gemini/error_actual.txt 2>&1 || true
```

### 13.2 Comandos de Consulta de Información y Diagnóstico

#### En tu PC Local (Git Bash)
```bash
# Consultar estado de la bóveda local (.env vs .env.enc)
node scripts/local-vault.js status

# Consultar desde dónde se resuelve yt-dlp en tu PC (PATH o GitHub Variable YT_DLP_PATH)
python sincronitation/yt_lyrics_helper.py --check-yt-dlp

# Ver las últimas 40 líneas del log del sincronizador en tu PC
tail -n 40 sincronitation/historial.log

# Ver en vivo lo que está haciendo sincronizador.py en tu PC
tail -f sincronitation/historial.log

# Consultar si hay procesos de Word (WINWORD.EXE) ocultos o colgados en Windows
tasklist //FI "IMAGENAME eq WINWORD.EXE"
```

#### En el Servidor AWS EC2 (vía SSH)
```bash
# Ver estado y consumo de contenedores Docker (App y MySQL)
docker compose ps
docker stats --no-stream

# Ver memoria RAM y Swap disponible en la instancia t3.micro
free -h

# Ver espacio en disco disponible en la instancia
df -h

# Consultar logs en tiempo real del servidor Node.js (últimas 100 líneas)
docker logs --tail 100 -f mood_app

# Consultar logs del contenedor MySQL
docker logs --tail 50 mood_db

# Consultar registro del respaldo automático nocturno hacia Google Drive
tail -n 50 ~/projects/respaldos/backup.log

# Ver tareas programadas en Cron (respaldo diario 3:30 AM)
crontab -l
```

### 13.3 Comandos para Reiniciar, Iniciar y Detener Servicios

#### En tu PC Local (Sincronizador y Entorno Local)
```bash
# Iniciar la app localmente leyendo .env.enc solo en memoria RAM (sin dejar .env en disco)
node scripts/local-vault.js run -- npm start

# Iniciar el sincronizador de Word + Puente de Letras en PC
python sincronitation/sincronizador.py

# Reiniciar el sincronizador en PC si ya estaba corriendo en segundo plano
taskkill //F //IM python.exe //FI "WINDOWTITLE eq *sincronizador*" 2>/dev/null || true
python sincronitation/sincronizador.py

# Liberar procesos WINWORD.EXE colgados en segundo plano (si Word se bloqueó)
taskkill //F //IM WINWORD.EXE
```

#### En el Servidor AWS EC2 (Docker)
```bash
# Reiniciar únicamente el servidor Node.js (rápido, sin tocar MySQL)
docker restart mood_app

# Reiniciar la base de datos MySQL y la aplicación
docker restart mood_db mood_app

# Levantar o reconstruir contenedores usando la bóveda sellada (.env.enc)
./scripts/env-vault.sh up

# Detener todos los contenedores sin perder datos del volumen MySQL
docker compose down
```

### 13.4 Comandos de la Bóveda de Seguridad (`.env.enc` y Windows DPAPI)
```bash
# Cifrar tu archivo .env local a .env.enc (AES-256-CBC + PBKDF2 600,000 iteraciones) y borrar .env plano
node scripts/local-vault.js encrypt

# Descifrar temporalmente .env.enc a .env para editar variables
node scripts/local-vault.js decrypt

# Volver a bloquear/borrar el .env plano asegurando que exista .env.enc
node scripts/local-vault.js lock

# Configurar el autoinicio en Windows (guarda la clave en Windows DPAPI de tu usuario)
python sincronitation/sincronizador.py --configurar-autoinicio

# Probar que el autoinicio Windows DPAPI descifra .env.enc en RAM correctamente
python sincronitation/sincronizador.py --probar-autoinicio

# Eliminar la clave guardada en Windows DPAPI
python sincronitation/sincronizador.py --quitar-autoinicio
```

### 13.5 Comandos de Base de Datos MySQL y Respaldos en Google Drive (`rclone`)
```bash
# Ejecutar respaldo manual inmediato a Google Drive + actualizar historico_completo.json.gz + purga >30 días
./scripts/backup.sh

# Restaurar respaldo desde Google Drive solo si la base de datos está vacía
./scripts/restore.sh --if-empty

# Forzar restauración completa desde Google Drive (sobrescribe datos locales con el último backup)
./scripts/restore.sh --force

# Consultar conteo de registros actuales en MySQL local (ventana de 30 días)
docker exec -i mood_db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root "$MYSQL_DATABASE" -e "
SELECT \"Mood\" AS Tabla, COUNT(*) AS Registros FROM RegistrosMood
UNION ALL SELECT \"Sleep\", COUNT(*) FROM RegistrosSleep
UNION ALL SELECT \"Crisis\", COUNT(*) FROM RegistrosCrisis
UNION ALL SELECT \"Agenda\", COUNT(*) FROM RegistrosAgenda
UNION ALL SELECT \"Canciones\", COUNT(*) FROM MusicaCanciones;"'

# Listar archivos de respaldo almacenados en Google Drive vía rclone
rclone lsl gdrive:RespaldosApp
```

### 13.6 Comandos del Worker Local de PC (`sincronizador.py` y `yt-dlp`)
```bash
# Extraer letra limpia y metadatos de una canción de YouTube / YT Music y copiarla al portapapeles
python sincronitation/yt_lyrics_helper.py "https://www.youtube.com/watch?v=VIDEO_ID" --clip

# Extraer subtítulos en Coreano, Inglés y Español y guardarlos en archivo .txt UTF-8
python sincronitation/yt_lyrics_helper.py "https://music.youtube.com/watch?v=VIDEO_ID" --langs ko,en,es --out letra.txt

# Limpiar un archivo de subtítulos local (.vtt, .srt o .lrc) sin usar internet
python sincronitation/yt_lyrics_helper.py --clean-file subtitulos.vtt --clip
```

### 13.7 Comandos de Pruebas, Git, Commits Desglosados y Despliegue
```bash
# Ejecutar la suite completa de 67 pruebas automatizadas (Sintaxis, Bóveda, API, Cripto, i18n, yt-dlp)
npm test

# Validar únicamente sintaxis rápida de Node.js y Bash
node --check server.js && node --check public/frontend.js && bash -n scripts/*.sh

# Ver estado de archivos modificados y rama actual
git status -sb

# Crear commit desglosado con título corto (<50 chars para que GitHub no lo corte) y viñetas detalladas
git add -A && git commit \
  -m "feat(scope): short summary under 50 chars" \
  -m "- Detalle 1 del cambio realizado." \
  -m "- Detalle 2 del cambio realizado."

# Subir cambios a la rama actual en GitHub
git push -u origin HEAD

# Simular cálculo de siguiente versión SemVer 2.0.0 sin modificar archivos
node scripts/release-version.js
```
