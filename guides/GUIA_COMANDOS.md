# Guía de Comandos Operativos y Mantenimiento

## Índice

- [⚡ Inicio Rápido (Primera Página): Servicio Local Python (`sincronizador.py`) y Migración de PC](#-inicio-rápido-primera-página-servicio-local-python-sincronizadorpy-y-migración-de-pc)
- [1. Ciclo de Vida de Contenedores y HTTPS (Docker Compose + Caddy)](#1-ciclo-de-vida-de-contenedores-y-https-docker-compose--caddy)
- [2. Base de Datos y Respaldos Dual Drive (MySQL + rclone)](#2-base-de-datos-y-respaldos-dual-drive-mysql--rclone)
- [3. Cliente Local de Sincronización en Windows (Python + Word)](#3-cliente-local-de-sincronización-en-windows-python--word)
- [4. Pruebas Automatizadas y Diagnóstico](#4-pruebas-automatizadas-y-diagnóstico)

---

## ⚡ Inicio Rápido (Primera Página): Servicio Local Python (`sincronizador.py`) y Migración de PC

### Iniciar el servicio local de Python (segundo plano sin ventana o modo consola)

**Resumen:** Inicia el acompañante local en Windows para sincronizar notas E2EE hacia Word (`Journal` + `English_Learning_Notebook.docx`), extraer letras con `yt-dlp` y mantener el espejo bidireccional con Google Drive.

```powershell
# En segundo plano silencioso (recomendado para uso diario):
Start-Process pythonw -ArgumentList ".\sincronitation\sincronizador.py" -WorkingDirectory (Get-Location).Path -WindowStyle Hidden

# O en consola visible para ver registros en tiempo real:
python .\sincronitation\sincronizador.py
```

| Parámetro / Comando | Significado |
| --- | --- |
| `pythonw` | Ejecuta el servicio sin ventana negra de consola; los eventos se guardan en `sincronitation/historial.log`. |
| `.\sincronitation\sincronizador.py` | Script cliente E2EE + OOXML/COM + puente HTTP firmado con HMAC. |
| `--consolidar-word` | Opcional: reorganiza, elimina duplicados y normaliza saltos de página en títulos principales de `English_Learning_Notebook.docx`. |

### Reiniciar el servicio local de Python (una sola línea en PowerShell)

**Resumen:** Detiene limpiamente cualquier proceso previo de `sincronizador.py` (`python.exe` o `pythonw.exe`) y vuelve a iniciarlo en segundo plano con los cambios más recientes.

```powershell
Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%sincronizador.py%'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Start-Sleep -Milliseconds 500; Start-Process pythonw -ArgumentList ".\sincronitation\sincronizador.py" -WorkingDirectory (Get-Location).Path -WindowStyle Hidden
```

| Parámetro / Paso | Significado |
| --- | --- |
| `Get-CimInstance Win32_Process` | Localiza procesos activos cuyo comando incluya `sincronizador.py` (cierra instancias previas y libera el mutex). |
| `Stop-Process -Force` | Termina el worker anterior de forma segura antes de relanzar. |
| `Start-Process pythonw` | Levanta el nuevo servicio en segundo plano inmediatamente. |

---

### 📋 Instrucciones Paso a Paso si Necesitas Migrar a Otra PC (Windows)

Sigue este orden exacto al cambiar de computadora (por seguridad, la bóveda DPAPI está ligada al usuario y hardware de cada PC):

1. **Preparar entorno y código:** Instala Python 3.10+, Git y `yt-dlp` en la nueva PC, clona este repositorio e instala las dependencias de sincronización (`pip install pycryptodome pywin32 requests` o equivalente).
2. **Transferir archivos privados locales:** Copia desde tu PC anterior (vía USB cifrado o respaldo seguro) tu archivo `.env.enc`, tus documentos Word locales (`WORD_FILE_PATH` / `ENGLISH_WORD_FILE_PATH` o la carpeta `english-notes/` si aún no están respaldados en Drive 2) y, si aplica, la ruta de `yt-dlp.exe` (`YT_DLP_PATH`). *Nunca subas `.env.enc` ni tu Word personal a GitHub.*
3. **Configurar la nueva bóveda DPAPI local (obligatorio en cada PC):** No copies `vault.dpapi` entre computadoras (no descifrará fuera de la PC original). En la nueva PC ejecuta:
   ```powershell
   python .\sincronitation\sincronizador.py --configurar-autoinicio
   ```
   Ingresa la clave maestra de `.env.enc` cuando se te solicite y verifica con:
   ```powershell
   python .\sincronitation\sincronizador.py --probar-autoinicio
   ```
4. **Habilitar autoinicio en Windows y auditar Word:** Ejecuta el script de registro de arranque automático y valida la jerarquía del cuaderno:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\sincronitation\registrar_inicio_windows.ps1
   python .\sincronitation\sincronizador.py --consolidar-word .\english-notes\English_Learning_Notebook.docx
   ```
5. **Arrancar y confirmar:** Ejecuta el comando de **Reiniciar el servicio local de Python** de arriba y revisa `sincronitation\historial.log` para confirmar conexión con EC2/servidor y estado verde del puente PC en la aplicación web.

### Reiniciar el servicio local de Python en Git Bash

**Resumen:** Desde **Git Bash** en la raíz del proyecto, detiene únicamente `sincronizador.py` y lo reinicia en vivo, en segundo plano silencioso (`pythonw`) o usando la bóveda `.env.enc`.

```bash
# 1. Viendo logs en vivo (recomendado para pruebas):
powershell.exe -NoProfile -Command 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "sincronizador\.py" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }' && python sincronitation/sincronizador.py

# 2. En segundo plano silencioso (sin ocupar Git Bash):
powershell.exe -NoProfile -Command 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "sincronizador\.py" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }' && nohup pythonw sincronitation/sincronizador.py >/dev/null 2>&1 &

# 3. Con bóveda cifrada (.env.enc):
powershell.exe -NoProfile -Command 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "sincronizador\.py" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }' && npm run vault:sync

# 4. Atajo corto (si no tienes otros scripts Python abiertos):
taskkill //F //IM python.exe //IM pythonw.exe 2>/dev/null; python sincronitation/sincronizador.py
```

---

## 1. Ciclo de Vida de Contenedores y HTTPS (Docker Compose + Caddy)

### Levantar o actualizar toda la infraestructura en segundo plano

**Resumen:** Construye las imágenes locales necesarias e inicia MySQL, la aplicación Node.js y el proxy inverso HTTPS Caddy leyendo variables desde el entorno.

```bash
docker compose --env-file .env up -d --build
```

| Parámetro / Bandera | Significado |
| --- | --- |
| `docker compose` | Invoca el orquestador multi-contenedor oficial de Docker. |
| `--env-file .env` | Indica explícitamente de qué archivo cargar las variables de entorno (puede apuntar a `/dev/shm/...` en despliegues en RAM). |
| `up` | Crea redes, volúmenes e inicia todos los servicios definidos en `docker-compose.yml`. |
| `-d` | Modo *detached*: ejecuta los contenedores en segundo plano liberando la terminal. |
| `--build` | Reconstruye la imagen del servicio `app` antes de iniciar para aplicar cambios recientes en código o `Dockerfile`. |

### Ver registros en vivo de la aplicación o del proxy HTTPS

**Resumen:** Muestra las últimas líneas de salida estándar y continúa siguiendo nuevos eventos en tiempo real.

```bash
docker compose logs -f --tail=100 app proxy
```

| Parámetro / Bandera | Significado |
| --- | --- |
| `logs` | Consulta los logs almacenados por el driver `json-file` de Docker. |
| `-f` | Sigue el flujo de mensajes nuevos en tiempo real (*follow*). |
| `--tail=100` | Limita el historial inicial a las últimas 100 líneas para no saturar la terminal. |
| `app proxy` | Filtra exclusivamente los contenedores de la app web (`mood_app`) y del servidor HTTPS (`mood_proxy`). |

### Limpiar imágenes y caché de compilación huérfana (Zero-Bloat)

**Resumen:** Elimina capas de construcción e imágenes sin uso para evitar llenar discos pequeños de servidor.

```bash
docker system prune -f --filter "until=24h"
```

| Parámetro / Bandera | Significado |
| --- | --- |
| `system prune` | Libera espacio eliminando contenedores detenidos, redes sin uso e imágenes colgantes. |
| `-f` | Confirma automáticamente sin pedir interacción manual (`--force`). |
| `--filter "until=24h"` | Conserva artefactos recientes de las últimas 24 horas y purga los más antiguos. |

---

## 2. Base de Datos y Respaldos Dual Drive (MySQL + rclone)

### Ejecutar respaldo cifrado + historial Drive 1 + purga local de 30 días

**Resumen:** Exporta MySQL comprimido en `.sql.gz`, fusiona el histórico en RAM (`/dev/shm`), lo sube a Drive 1 y purga datos locales mayores a 30 días.

```bash
./scripts/backup.sh
```

| Parámetro / Variable | Significado |
| --- | --- |
| `RCLONE_REMOTE` | Nombre del remoto Drive 1 configurado para respaldos clínicos (ej. `gdrive`). |
| `RCLONE_BACKUP_DIR` | Carpeta destino dentro de Drive 1 (ej. `RespaldosApp`). |
| `DB_RETENTION_DAYS` | Días máximos de retención local en MySQL (`30` por defecto). |

### Restaurar base de datos desde Drive 1 en un servidor nuevo

**Resumen:** Verifica si MySQL está vacío y descarga e importa automáticamente el último respaldo comprimido desde Google Drive.

```bash
./scripts/restore.sh --if-empty
```

| Parámetro / Bandera | Significado |
| --- | --- |
| `./scripts/restore.sh` | Ejecuta el script idempotente de restauración de esquema y datos. |
| `--if-empty` | Solo importa el respaldo cuando las tablas principales están vacías; usa `--force` para sobreescribir manualmente. |

### Convertir `rclone.conf` a Base64 de una sola línea (Drive 1 o Drive 2)

**Resumen:** Codifica de forma segura tu archivo de credenciales `rclone.conf` para almacenarlo en `RCLONE_CONF_B64` o `STUDY_RCLONE_CONF_B64`.

```bash
base64 -w 0 ~/.config/rclone/rclone.conf
```

| Parámetro / Bandera | Significado |
| --- | --- |
| `base64` | Convierte texto binario/plano a representación Base64 portátil. |
| `-w 0` | Desactiva saltos de línea (`--wrap=0`) para obtener una cadena continua apta para GitHub Secrets o `.env`. |
| `~/.config/rclone/rclone.conf` | Ruta estándar del perfil `rclone` protegido con permisos `chmod 600`. |

### Probar subida aislada al Drive 2 de Estudio (sin tocar el Diario personal)

**Resumen:** Lista los archivos presentes en la carpeta de estudio configurada para confirmar aislamiento total en Drive 2.

```bash
rclone lsf "${STUDY_RCLONE_REMOTE:-gdrive_study}:${STUDY_RCLONE_DIR:-NotasIdiomas}" --max-depth 2
```

| Parámetro / Bandera | Significado |
| --- | --- |
| `lsf` | Lista nombres de archivos/directorios en formato limpio legible por scripts. |
| `${STUDY_RCLONE_REMOTE}:${STUDY_RCLONE_DIR}` | Remoto independiente de Drive 2 (ej. `gdrive_study:NotasIdiomas`). |
| `--max-depth 2` | Limita la profundidad de exploración evitando descargas innecesarias. |

### Endurecer permisos de secretos y respaldos en Ubuntu Server

**Resumen:** Restringe lectura y escritura únicamente al propietario del servidor Linux (`600` archivos, `700` directorios).

```bash
chmod 700 ~/.config/rclone ~/projects/respaldos && chmod 600 ~/.config/rclone/rclone.conf ~/projects/respaldos/*.sql.gz
```

| Parámetro / Bandera | Significado |
| --- | --- |
| `chmod 700` | Solo el usuario dueño puede entrar, leer y crear en el directorio (`rwx------`). |
| `chmod 600` | Solo el usuario dueño puede leer o modificar archivos sensibles (`rw-------`). |

---

## 3. Cliente Local de Sincronización en Windows (Python + Word)

### Iniciar el acompañante local en Windows con detección automática del servidor

**Resumen:** Inicia el puente seguro que recibe notas cifradas de extremo a extremo, actualiza tus documentos Word y extrae letras bajo demanda.

```powershell
python .\sincronitation\sincronizador.py
```

| Parámetro / Variable de Entorno | Significado |
| --- | --- |
| `EC2_HOST` / `SERVER_HOST` | IP pública o dominio del servidor actual (se lee de entorno o GitHub Variables sin hardcodear). |
| `WORD_FILE_PATH` | Ruta local protegida de tu documento de Diario personal (jamás se sube a Google Drive). |
| `ENGLISH_WORD_FILE_PATH` | Ruta de `English_Learning_Notebook.docx` (sincronizado automáticamente en Bloques A/B y respaldado a Drive 2). |
| `YT_DLP_PATH` | Ruta opcional personalizada al binario `yt-dlp.exe` si no está en `PATH`. |

### Extraer subtítulos limpios manualmente con `yt_lyrics_helper.py`

**Resumen:** Prueba localmente la extracción multi-cliente de letras/subtítulos y muestra metadatos exactos de lanzamiento en JSON.

```powershell
python .\sincronitation\yt_lyrics_helper.py "https://www.youtube.com/watch?v=VIDEO_ID" --langs en ko es --json
```

| Parámetro / Bandera | Significado |
| --- | --- |
| `<URL>` | Enlace individual o ID oficial del video en YouTube / YouTube Music. |
| `--langs en ko es` | Orden de prioridad de pistas de subtítulos a intentar extraer. |
| `--json` | Devuelve estructura JSON completa con letra normalizada, idioma detectado, año, `release_date` y pista. |

---

## 4. Pruebas Automatizadas y Diagnóstico

### Ejecutar la suite completa de pruebas unitarias e integración (Node Test Runner)

**Resumen:** Valida sintaxis, configuraciones de despliegue, reglas de privacidad, rutas API y mocks de base de datos sin efectos secundarios.

```powershell
node --test --test-reporter=spec tests/*.test.js
```

| Parámetro / Bandera | Significado |
| --- | --- |
| `node --test` | Usa el corredor nativo integrado de Node.js 20 sin dependencias externas de testing. |
| `--test-reporter=spec` | Muestra cada caso de prueba agrupado con palomita (`✔`) o error detallado. |
| `tests/*.test.js` | Incluye pruebas de configuración, sintaxis, servicio `yt-dlp`, metadatos de YouTube e integración HTTP. |
