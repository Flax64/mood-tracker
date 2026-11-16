# Guía de Comandos Operativos y Mantenimiento

## Índice

- [1. Ciclo de Vida de Contenedores y HTTPS (Docker Compose + Caddy)](#1-ciclo-de-vida-de-contenedores-y-https-docker-compose--caddy)
- [2. Base de Datos y Respaldos Dual Drive (MySQL + rclone)](#2-base-de-datos-y-respaldos-dual-drive-mysql--rclone)
- [3. Cliente Local de Sincronización en Windows (Python + Word)](#3-cliente-local-de-sincronización-en-windows-python--word)
- [4. Pruebas Automatizadas y Diagnóstico](#4-pruebas-automatizadas-y-diagnóstico)

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
