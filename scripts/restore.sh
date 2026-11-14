#!/bin/bash
set -euo pipefail

MODE="${1:---if-empty}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
INIT_SQL="$PROJECT_DIR/init.sql"

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: No se encontró el archivo .env en $ENV_FILE" >&2
    exit 1
fi

set -a
source "$ENV_FILE"
set +a

CONTENEDOR="${DB_CONTAINER:-mood_db}"
RUTA_LOCAL="${BACKUP_LOCAL_DIR:-$HOME/projects/respaldos}"
RESTORE_TMP="$RUTA_LOCAL/restore_mood_tracker.sql.gz"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive}"
RCLONE_BACKUP_DIR="${RCLONE_BACKUP_DIR:-RespaldosApp}"
REMOTE_FILE="${RCLONE_REMOTE}:${RCLONE_BACKUP_DIR}/respaldo_mood_tracker.sql.gz"

mkdir -p "$RUTA_LOCAL"

DOCKER_CMD="docker"
if ! docker info >/dev/null 2>&1; then
    DOCKER_CMD="sudo docker"
fi

# 1. Esperar a que MySQL acepte conexiones
echo "Esperando a que el contenedor $CONTENEDOR esté listo..."
DB_READY=0
for _ in $(seq 1 30); do
    if $DOCKER_CMD exec "$CONTENEDOR" /usr/bin/mysql -u "$DB_USER" -p"$DB_PASS" -e "SELECT 1;" "$DB_NAME" >/dev/null 2>&1; then
        DB_READY=1
        break
    fi
    sleep 2
done

if [ "$DB_READY" -ne 1 ]; then
    echo "Error: MySQL en $CONTENEDOR no respondió a tiempo." >&2
    exit 1
fi

# 2. Asegurar que las tablas base existan antes de consultar conteos
if [ -f "$INIT_SQL" ]; then
    $DOCKER_CMD exec -i "$CONTENEDOR" /usr/bin/mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$INIT_SQL"
fi

# 3. Verificar si la base de datos ya contiene datos (en modo --if-empty)
if [ "$MODE" = "--if-empty" ]; then
    TOTAL_ROWS="$($DOCKER_CMD exec "$CONTENEDOR" /usr/bin/mysql -N -s -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e \
        "SELECT (SELECT COUNT(*) FROM RegistrosMood) + (SELECT COUNT(*) FROM RegistrosSleep) + (SELECT COUNT(*) FROM RegistrosAgenda);")"

    if [ "${TOTAL_ROWS:-0}" -gt 0 ]; then
        echo "La base de datos ya tiene $TOTAL_ROWS registros. Se omite la restauración automática."
        exit 0
    fi
fi

# 4. Verificar rclone y existencia del respaldo en Google Drive
RCLONE_BIN="$(command -v rclone || true)"
if [ -z "$RCLONE_BIN" ] || [ ! -x "$RCLONE_BIN" ]; then
    echo "Aviso: rclone no está instalado; no se puede restaurar desde Google Drive."
    exit 0
fi

if ! "$RCLONE_BIN" listremotes | grep -q "^${RCLONE_REMOTE}:"; then
    echo "Aviso: El remoto '${RCLONE_REMOTE}:' no está configurado en rclone. Se omite la restauración."
    exit 0
fi

if ! "$RCLONE_BIN" lsf "${RCLONE_REMOTE}:${RCLONE_BACKUP_DIR}" --include "respaldo_mood_tracker.sql.gz" 2>/dev/null | grep -q "^respaldo_mood_tracker\.sql\.gz$"; then
    echo "Aviso: No se encontró $REMOTE_FILE en Google Drive. Iniciando con base de datos vacía."
    exit 0
fi

# 5. Descargar y restaurar respaldo
echo "Descargando respaldo desde $REMOTE_FILE..."
rm -f "$RESTORE_TMP"
"$RCLONE_BIN" copyto "$REMOTE_FILE" "$RESTORE_TMP"

if [ ! -s "$RESTORE_TMP" ]; then
    echo "Error: El archivo de respaldo descargado está vacío." >&2
    rm -f "$RESTORE_TMP"
    exit 1
fi

echo "Restaurando respaldo en la base de datos '$DB_NAME'..."
gunzip -c "$RESTORE_TMP" | $DOCKER_CMD exec -i "$CONTENEDOR" /usr/bin/mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME"
rm -f "$RESTORE_TMP"

# 6. Asegurar que tablas nuevas (ej. RegistrosAgenda) existan si el backup era anterior
if [ -f "$INIT_SQL" ]; then
    $DOCKER_CMD exec -i "$CONTENEDOR" /usr/bin/mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$INIT_SQL"
fi

echo "Restauración completada exitosamente."
