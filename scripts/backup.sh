#!/bin/bash
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
if [ -z "${HOME:-}" ]; then
    HOME="$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f6 || echo /tmp)"
    export HOME
fi

# 1. Cargar credenciales desde .env o activar modo sellado si .env fue encriptado (.env.enc)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ENV_FILE_OVERRIDE:-$PROJECT_DIR/.env}"
META_FILE="${BACKUP_META_FILE:-$HOME/projects/respaldos/.backup.meta}"

if [ -z "${ENV_FILE_OVERRIDE:-}" ]; then
    if [ ! -f "$ENV_FILE" ] && [ -f "$HOME/projects/mood-tracker/.env" ]; then
        ENV_FILE="$HOME/projects/mood-tracker/.env"
    elif [ ! -f "$ENV_FILE" ] && [ -f "$HOME/projects/mood_tracker/.env" ]; then
        ENV_FILE="$HOME/projects/mood_tracker/.env"
    fi
fi

load_env_file() {
    local env_file="$1"
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
        local key="${line%%=*}"
        local val="${line#*=}"
        key="${key//[[:space:]]/}"
        [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
        if [[ "$val" == \"*\" && "$val" == *\" ]] || [[ "$val" == \'*\' && "$val" == *\' ]]; then
            val="${val:1:${#val}-2}"
        fi
        export "$key=$val"
    done < "$env_file"
}

SEALED_MODE=0
if [ -f "$ENV_FILE" ]; then
    load_env_file "$ENV_FILE"
elif [ -f "$PROJECT_DIR/.env.enc" ] || [ -f "$META_FILE" ]; then
    SEALED_MODE=1
    if [ -f "$META_FILE" ]; then
        load_env_file "$META_FILE"
    fi
else
    echo "Error: No se encontró $ENV_FILE ni configuración sellada (.env.enc / .backup.meta)." >&2
    exit 1
fi

# 2. Variables de configuración (personalizables desde .env o .backup.meta sin secretos)
CONTENEDOR="${DB_CONTAINER:-mood_db}"
RUTA_LOCAL="${BACKUP_LOCAL_DIR:-$HOME/projects/respaldos}"
ARCHIVO="$RUTA_LOCAL/respaldo_mood_tracker.sql.gz"
ARCHIVO_TMP="$ARCHIVO.tmp.$$"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive}"
RCLONE_BACKUP_DIR="${RCLONE_BACKUP_DIR:-RespaldosApp}"
RCLONE_CONF_PATH="${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}"

trap 'rm -f "$ARCHIVO_TMP"' EXIT
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

if [ ! -f "$RCLONE_CONF_PATH" ]; then
    echo "Error: No se encontró configuración de rclone en $RCLONE_CONF_PATH." >&2
    exit 1
fi

# 3. Extraer TODAS las tablas de la base de datos
if [ "$SEALED_MODE" -eq 1 ]; then
    if [ "$($DOCKER_CMD inspect -f '{{.State.Running}}' "$CONTENEDOR" 2>/dev/null || echo false)" != "true" ]; then
        echo "Error: El .env está sellado y el contenedor $CONTENEDOR no está activo. Levanta la app con ./scripts/env-vault.sh up" >&2
        exit 1
    fi
    $DOCKER_CMD exec "$CONTENEDOR" sh -c \
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --single-transaction --routines --triggers --no-tablespaces -u root "$MYSQL_DATABASE"' \
        | gzip > "$ARCHIVO_TMP"
elif [ -n "${DB_PASS:-}" ]; then
    $DOCKER_CMD exec -e MYSQL_PWD="$DB_PASS" "$CONTENEDOR" mysqldump \
        --single-transaction --routines --triggers --no-tablespaces \
        -u "${DB_USER:-root}" "${DB_NAME:-MoodTrackerLocal}" | gzip > "$ARCHIVO_TMP"
else
    $DOCKER_CMD exec "$CONTENEDOR" mysqldump \
        --single-transaction --routines --triggers --no-tablespaces \
        -u "${DB_USER:-root}" "${DB_NAME:-MoodTrackerLocal}" | gzip > "$ARCHIVO_TMP"
fi

if [ ! -s "$ARCHIVO_TMP" ] || ! gzip -t "$ARCHIVO_TMP" >/dev/null 2>&1; then
    echo "Error: El respaldo generado está vacío o corrupto." >&2
    exit 1
fi

mv "$ARCHIVO_TMP" "$ARCHIVO"

# 4. Subir a Google Drive con rclone
"$RCLONE_BIN" --config "$RCLONE_CONF_PATH" copy "$ARCHIVO" "${RCLONE_REMOTE}:${RCLONE_BACKUP_DIR}"
MODO_TXT=$([ "$SEALED_MODE" -eq 1 ] && echo "sellado" || echo "env")
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Respaldo completado (modo=$MODO_TXT) y subido a ${RCLONE_REMOTE}:${RCLONE_BACKUP_DIR}/respaldo_mood_tracker.sql.gz"
