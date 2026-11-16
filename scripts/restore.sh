#!/bin/bash
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
if [ -z "${HOME:-}" ]; then
    HOME="$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f6 || echo /tmp)"
    export HOME
fi

MODE="${1:---if-empty}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ENV_FILE_OVERRIDE:-$PROJECT_DIR/.env}"
INIT_SQL="$PROJECT_DIR/init.sql"

if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$PROJECT_DIR/.env.enc" ]; then
        echo "Error: El archivo .env está cifrado en $PROJECT_DIR/.env.enc. Ejecuta: ./scripts/env-vault.sh restore $MODE" >&2
    else
        echo "Error: No se encontró el archivo .env en $ENV_FILE" >&2
    fi
    exit 1
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
        case "$key" in
            PATH|HOME|IFS|PWD|OLDPWD|SHELLOPTS) continue ;;
        esac
        if [[ "$val" == \"*\" && "$val" == *\" ]] || [[ "$val" == \'*\' && "$val" == *\' ]]; then
            val="${val:1:${#val}-2}"
        fi
        printf -v "$key" '%s' "$val"
    done < "$env_file"
}

load_env_file "$ENV_FILE"

CONTENEDOR="${DB_CONTAINER:-mood_db}"
RUTA_LOCAL="${BACKUP_LOCAL_DIR:-$HOME/projects/respaldos}"
RESTORE_TMP="$RUTA_LOCAL/restore_mood_tracker.sql.gz"
REMOTE_NAME="${RCLONE_REMOTE:-gdrive}"
REMOTE_DIR="${RCLONE_BACKUP_DIR:-RespaldosApp}"
REMOTE_FILE="${REMOTE_NAME}:${REMOTE_DIR}/respaldo_mood_tracker.sql.gz"
RCLONE_CONF_PATH="${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}"
unset RCLONE_BACKUP_DIR RCLONE_REMOTE RCLONE_CONF_B64

mkdir -p "$RUTA_LOCAL"
chmod 700 "$RUTA_LOCAL" 2>/dev/null || true
chmod 700 "$(dirname "$RCLONE_CONF_PATH")" 2>/dev/null || true
chmod 600 "$RCLONE_CONF_PATH" 2>/dev/null || true

DOCKER_CMD="docker"
if ! docker info >/dev/null 2>&1; then
    DOCKER_CMD="sudo docker"
fi

mysql_exec() {
    if [ -n "${DB_PASS:-}" ]; then
        $DOCKER_CMD exec -i -e MYSQL_PWD="$DB_PASS" "$CONTENEDOR" mysql -u "$DB_USER" "$@"
    else
        $DOCKER_CMD exec -i "$CONTENEDOR" mysql -u "$DB_USER" "$@"
    fi
}

# 1. Esperar a que MySQL acepte conexiones (hasta 90s)
echo "Esperando a que el contenedor $CONTENEDOR esté listo..."
DB_READY=0
LAST_ERR=""
for _ in $(seq 1 45); do
    if LAST_ERR="$(mysql_exec -e "SELECT 1;" </dev/null 2>&1)"; then
        DB_READY=1
        break
    fi
    sleep 2
done

if [ "$DB_READY" -ne 1 ]; then
    echo "Error: MySQL en $CONTENEDOR no respondió a tiempo." >&2
    echo "Último error de MySQL (usuario=$DB_USER, db=$DB_NAME): $LAST_ERR" >&2
    $DOCKER_CMD logs --tail 25 "$CONTENEDOR" >&2 || true
    exit 1
fi

# 2. Asegurar que la base de datos y las tablas base existan
mysql_exec -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\`;" </dev/null
if [ -f "$INIT_SQL" ]; then
    mysql_exec "$DB_NAME" < "$INIT_SQL"
fi

# 3. Verificar si la base de datos ya contiene datos (en modo --if-empty)
if [ "$MODE" = "--if-empty" ]; then
    TOTAL_ROWS="$(mysql_exec -N -s "$DB_NAME" -e \
        "SELECT (SELECT COUNT(*) FROM RegistrosMood) + (SELECT COUNT(*) FROM RegistrosSleep) + (SELECT COUNT(*) FROM RegistrosCrisis) + (SELECT COUNT(*) FROM RegistrosAgenda) + (SELECT COUNT(*) FROM MusicaCanciones);" </dev/null)"

    if [ "${TOTAL_ROWS:-0}" -gt 0 ]; then
        echo "La base de datos '$DB_NAME' ya tiene $TOTAL_ROWS registros. Se omite la restauración automática."
        exit 0
    fi
fi

# 4. Verificar rclone y existencia del respaldo en Google Drive
RCLONE_BIN="$(command -v rclone || true)"
if [ -z "$RCLONE_BIN" ] || [ ! -x "$RCLONE_BIN" ]; then
    echo "Aviso: rclone no está instalado; no se puede restaurar desde Google Drive."
    exit 0
fi

if ! "$RCLONE_BIN" --config "$RCLONE_CONF_PATH" listremotes | grep -q "^${REMOTE_NAME}:"; then
    echo "Aviso: El remoto '${REMOTE_NAME}:' no está configurado en rclone. Se omite la restauración."
    exit 0
fi

if ! "$RCLONE_BIN" --config "$RCLONE_CONF_PATH" lsf "${REMOTE_NAME}:${REMOTE_DIR}" --include "respaldo_mood_tracker.sql.gz" 2>/dev/null | grep -q "^respaldo_mood_tracker\.sql\.gz$"; then
    echo "Aviso: No se encontró $REMOTE_FILE en Google Drive. Iniciando con base de datos vacía."
    exit 0
fi

# 5. Descargar y restaurar respaldo
echo "Descargando respaldo desde $REMOTE_FILE..."
rm -f "$RESTORE_TMP"
"$RCLONE_BIN" --config "$RCLONE_CONF_PATH" copyto "$REMOTE_FILE" "$RESTORE_TMP"

if [ ! -s "$RESTORE_TMP" ]; then
    echo "Error: El archivo de respaldo descargado está vacío." >&2
    rm -f "$RESTORE_TMP"
    exit 1
fi

echo "Restaurando respaldo en la base de datos '$DB_NAME'..."
gunzip -c "$RESTORE_TMP" | mysql_exec "$DB_NAME"
rm -f "$RESTORE_TMP"

# 6. Asegurar que tablas nuevas (ej. RegistrosAgenda) existan si el backup era anterior
if [ -f "$INIT_SQL" ]; then
    mysql_exec "$DB_NAME" < "$INIT_SQL"
fi

echo "Restauración completada exitosamente."
