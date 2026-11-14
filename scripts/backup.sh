#!/bin/bash
set -euo pipefail

# 1. Cargar las credenciales desde el archivo .env del proyecto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"

if [ ! -f "$ENV_FILE" ] && [ -f "$HOME/projects/mood-tracker/.env" ]; then
    ENV_FILE="$HOME/projects/mood-tracker/.env"
elif [ ! -f "$ENV_FILE" ] && [ -f "$HOME/projects/mood_tracker/.env" ]; then
    ENV_FILE="$HOME/projects/mood_tracker/.env"
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: No se encontró el archivo .env en $ENV_FILE" >&2
    exit 1
fi

set -a
source "$ENV_FILE"
set +a

# 2. Variables de configuración (personalizables desde .env)
CONTENEDOR="${DB_CONTAINER:-mood_db}"
RUTA_LOCAL="${BACKUP_LOCAL_DIR:-$HOME/projects/respaldos}"
ARCHIVO="$RUTA_LOCAL/respaldo_mood_tracker.sql.gz"
ARCHIVO_TMP="$ARCHIVO.tmp"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive}"
RCLONE_BACKUP_DIR="${RCLONE_BACKUP_DIR:-RespaldosApp}"

mkdir -p "$RUTA_LOCAL"

DOCKER_CMD="docker"
if ! docker info >/dev/null 2>&1; then
    DOCKER_CMD="sudo docker"
fi

RCLONE_BIN="$(command -v rclone || true)"
if [ -z "$RCLONE_BIN" ] || [ ! -x "$RCLONE_BIN" ]; then
    echo "Error: rclone no está instalado en el sistema." >&2
    exit 1
fi

# 3. Extraer TODAS las tablas de la base de datos
$DOCKER_CMD exec "$CONTENEDOR" /usr/bin/mysqldump \
    --single-transaction --routines --triggers --no-tablespaces \
    -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" | gzip > "$ARCHIVO_TMP"

if [ ! -s "$ARCHIVO_TMP" ]; then
    echo "Error: El respaldo generado está vacío." >&2
    rm -f "$ARCHIVO_TMP"
    exit 1
fi

mv "$ARCHIVO_TMP" "$ARCHIVO"

# 4. Subir a Google Drive con rclone
"$RCLONE_BIN" copy "$ARCHIVO" "${RCLONE_REMOTE}:${RCLONE_BACKUP_DIR}"
echo "Respaldo completado y subido a ${RCLONE_REMOTE}:${RCLONE_BACKUP_DIR}/respaldo_mood_tracker.sql.gz"
