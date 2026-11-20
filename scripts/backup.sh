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
        case "$key" in
            PATH|HOME|IFS|PWD|OLDPWD|SHELLOPTS) continue ;;
        esac
        if [[ "$val" == \"*\" && "$val" == *\" ]] || [[ "$val" == \'*\' && "$val" == *\' ]]; then
            val="${val:1:${#val}-2}"
        fi
        printf -v "$key" '%s' "$val"
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

# 2. Variables de configuración (evitando exportar RCLONE_* porque rclone los interpreta como flags CLI)
CONTENEDOR="${DB_CONTAINER:-mood_db}"
RUTA_LOCAL="${BACKUP_LOCAL_DIR:-$HOME/projects/respaldos}"
ARCHIVO="$RUTA_LOCAL/respaldo_mood_tracker.sql.gz"
ARCHIVO_TMP="$ARCHIVO.tmp.$$"
REMOTE_NAME="${RCLONE_REMOTE:-gdrive}"
REMOTE_DIR="${RCLONE_BACKUP_DIR:-RespaldosApp}"
RCLONE_CONF_PATH="${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}"
unset RCLONE_BACKUP_DIR RCLONE_REMOTE RCLONE_CONF_B64

trap 'rm -f "$ARCHIVO_TMP"' EXIT
mkdir -p "$RUTA_LOCAL" "$RUTA_LOCAL/historico_sql"
chmod 700 "$RUTA_LOCAL" "$RUTA_LOCAL/historico_sql" 2>/dev/null || true
if [ -f "$RCLONE_CONF_PATH" ]; then
    chmod 700 "$(dirname "$RCLONE_CONF_PATH")" 2>/dev/null || true
    chmod 600 "$RCLONE_CONF_PATH" 2>/dev/null || true
fi

DOCKER_CMD="docker"
if ! docker info >/dev/null 2>&1; then
    DOCKER_CMD="sudo docker"
fi

REQUIRE_DRIVE="${REQUIRE_DRIVE_BACKUP:-false}"
for arg in "$@"; do
    if [ "$arg" = "--require-drive" ]; then
        REQUIRE_DRIVE="true"
    fi
done

RCLONE_BIN="$(command -v rclone || true)"
DRIVE_ENABLED=0
if [ -n "$RCLONE_BIN" ] && [ -x "$RCLONE_BIN" ] && [ -f "$RCLONE_CONF_PATH" ] \
    && "$RCLONE_BIN" --config "$RCLONE_CONF_PATH" listremotes 2>/dev/null | grep -qx "${REMOTE_NAME}:"; then
    DRIVE_ENABLED=1
else
    if [ -n "$RCLONE_BIN" ] && [ -s "$RCLONE_CONF_PATH" ]; then
        FOUND_REMOTES="$("$RCLONE_BIN" --config "$RCLONE_CONF_PATH" listremotes 2>/dev/null | tr '\n' ' ' || true)"
        echo "Aviso: $RCLONE_CONF_PATH existe pero no contiene '${REMOTE_NAME}:' (encontrados: ${FOUND_REMOTES:-ninguno})." >&2
    fi
    if [ "$REQUIRE_DRIVE" = "true" ]; then
        echo "Error: Se exigió respaldo en Google Drive (--require-drive / REQUIRE_DRIVE_BACKUP=true), pero rclone o el remoto '${REMOTE_NAME}:' no están listos en $RCLONE_CONF_PATH." >&2
        exit 1
    fi
    echo "Info: Modo respaldo 100% local activado (sin remoto Google Drive '${REMOTE_NAME}' configurado)."
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
chmod 600 "$ARCHIVO" 2>/dev/null || true

# 4. Actualizar archivo histórico acumulativo en RAM (/dev/shm) y subir respaldos completos a Google Drive
RAM_TMP_DIR="/dev/shm"
if [ ! -d "$RAM_TMP_DIR" ] || [ ! -w "$RAM_TMP_DIR" ]; then
    RAM_TMP_DIR="${TMPDIR:-/tmp}"
fi
HIST_PREV_GZ="$RAM_TMP_DIR/.hist_prev_$$.json.gz"
HIST_NEW_GZ="$RAM_TMP_DIR/.hist_new_$$.json.gz"
CURRENT_TSV="$RAM_TMP_DIR/.curr_rows_$$.tsv"
trap 'rm -f "$ARCHIVO_TMP" "$HIST_PREV_GZ" "$HIST_NEW_GZ" "$CURRENT_TSV"' EXIT INT TERM

run_mysql_query() {
    local sql_query="$1"
    if [ "$SEALED_MODE" -eq 1 ]; then
        $DOCKER_CMD exec "$CONTENEDOR" sh -c \
            "MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" mysql --batch --raw --skip-column-names -u root \"\$MYSQL_DATABASE\" -e \"$sql_query\""
    elif [ -n "${DB_PASS:-}" ]; then
        $DOCKER_CMD exec -e MYSQL_PWD="$DB_PASS" "$CONTENEDOR" mysql --batch --raw --skip-column-names \
            -u "${DB_USER:-root}" "${DB_NAME:-MoodTrackerLocal}" -e "$sql_query"
    else
        $DOCKER_CMD exec "$CONTENEDOR" mysql --batch --raw --skip-column-names \
            -u "${DB_USER:-root}" "${DB_NAME:-MoodTrackerLocal}" -e "$sql_query"
    fi
}

EXPORT_SQL="
SELECT 'mood', id, DATE_FORMAT(fecha, '%Y-%m-%d'), JSON_OBJECT('id', id, 'fecha', DATE_FORMAT(fecha, '%Y-%m-%d'), 'momento_dia', momento_dia, 'estado_animo', estado_animo, 'color_hex', color_hex) FROM RegistrosMood
UNION ALL
SELECT 'sleep', id, DATE_FORMAT(fecha, '%Y-%m-%d'), JSON_OBJECT('id', id, 'fecha', DATE_FORMAT(fecha, '%Y-%m-%d'), 'horas', horas, 'calidad', calidad, 'hora_dormir', hora_dormir, 'hora_despertar', hora_despertar, 'es_desvelo', es_desvelo, 'tipo_registro', tipo_registro, 'motivo_desvelo', motivo_desvelo) FROM RegistrosSleep
UNION ALL
SELECT 'crisis', id, DATE_FORMAT(fecha, '%Y-%m-%d'), JSON_OBJECT('id', id, 'fecha', DATE_FORMAT(fecha, '%Y-%m-%d'), 'hora', hora, 'tipo_crisis', tipo_crisis, 'intensidad', intensidad, 'motivo', motivo) FROM RegistrosCrisis
UNION ALL
SELECT 'agenda', id, DATE_FORMAT(fecha, '%Y-%m-%d'), JSON_OBJECT('id', id, 'fecha', DATE_FORMAT(fecha, '%Y-%m-%d'), 'bloque', bloque, 'hora', TIME_FORMAT(hora, '%H:%i'), 'actividad', actividad, 'tipo', tipo, 'categoria', categoria, 'materia_id', materia_id, 'materia_nombre', materia_nombre, 'estado', estado, 'completada', completada, 'recordatorio_min', recordatorio_min) FROM RegistrosAgenda
UNION ALL
SELECT 'music_artists', id, '', JSON_OBJECT('id', id, 'usuario_id', usuario_id, 'nombre', nombre, 'tipo_artista', tipo_artista, 'notas_cortas', notas_cortas) FROM MusicaArtistas
UNION ALL
SELECT 'music_albums', id, '', JSON_OBJECT('id', id, 'usuario_id', usuario_id, 'artista_principal_id', artista_principal_id, 'titulo', titulo, 'tipo_lanzamiento', tipo_lanzamiento, 'anio', anio, 'notas_cortas', notas_cortas) FROM MusicaAlbumes
UNION ALL
SELECT 'music_songs', id, '', JSON_OBJECT('id', id, 'usuario_id', usuario_id, 'album_id', album_id, 'titulo', titulo, 'numero_pista', numero_pista, 'idioma', idioma, 'yt_music_url', yt_music_url, 'yt_video_id', yt_video_id, 'thumbnail_url', thumbnail_url, 'estado_estudio', estado_estudio, 'enfoque_corto', enfoque_corto, 'word_sincronizado', word_sincronizado) FROM MusicaCanciones
UNION ALL
SELECT 'music_song_artists', CONCAT(cancion_id, '_', artista_id), '', JSON_OBJECT('cancion_id', cancion_id, 'artista_id', artista_id, 'rol', rol, 'orden', orden) FROM MusicaCancionArtistas;
"

ARCHIVE_READY=0
MONTH_TAG="$(date '+%Y-%m')"
LOCAL_HIST_ARCHIVE="$RUTA_LOCAL/historico_completo.json.gz"
LOCAL_MONTH_SQL="$RUTA_LOCAL/historico_sql/respaldo_${MONTH_TAG}.sql.gz"
cp -f "$ARCHIVO" "$LOCAL_MONTH_SQL"
chmod 600 "$LOCAL_MONTH_SQL" 2>/dev/null || true

if run_mysql_query "$EXPORT_SQL" > "$CURRENT_TSV"; then
    if [ "$DRIVE_ENABLED" -eq 1 ]; then
        "$RCLONE_BIN" --config "$RCLONE_CONF_PATH" copyto "${REMOTE_NAME}:${REMOTE_DIR}/historico_completo.json.gz" "$HIST_PREV_GZ" 2>/dev/null || true
    fi
    if [ ! -s "$HIST_PREV_GZ" ] && [ -s "$LOCAL_HIST_ARCHIVE" ]; then
        cp -f "$LOCAL_HIST_ARCHIVE" "$HIST_PREV_GZ" 2>/dev/null || true
    fi

    if command -v python3 >/dev/null 2>&1; then
        python3 - "$HIST_PREV_GZ" "$CURRENT_TSV" "$HIST_NEW_GZ" <<'PYEOF'
import gzip, json, os, sys

prev_gz, curr_tsv, out_gz = sys.argv[1:4]
store = {"mood": {}, "sleep": {}, "crisis": {}, "agenda": {}, "music_artists": {}, "music_albums": {}, "music_songs": {}, "music_song_artists": {}}

if os.path.exists(prev_gz) and os.path.getsize(prev_gz) > 0:
    try:
        with gzip.open(prev_gz, "rt", encoding="utf-8") as fh:
            loaded = json.load(fh)
            if isinstance(loaded, dict):
                for k in store.keys():
                    if isinstance(loaded.get(k), dict):
                        store[k].update(loaded[k])
    except Exception:
        pass

if os.path.exists(curr_tsv):
    with open(curr_tsv, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            parts = line.rstrip("\r\n").split("\t", 3)
            if len(parts) != 4:
                continue
            kind, row_id, fecha_str, raw_json = parts
            if kind in store and row_id:
                try:
                    obj = json.loads(raw_json)
                    key = f"{fecha_str}_{obj.get('momento_dia', row_id)}" if kind == "mood" else str(row_id)
                    store[kind][key] = obj
                except Exception:
                    pass

with gzip.open(out_gz, "wt", encoding="utf-8") as out_fh:
    json.dump(store, out_fh, ensure_ascii=False)
PYEOF
    fi
fi

if [ -s "$HIST_NEW_GZ" ] && gzip -t "$HIST_NEW_GZ" >/dev/null 2>&1; then
    cp -f "$HIST_NEW_GZ" "${LOCAL_HIST_ARCHIVE}.tmp.$$"
    mv -f "${LOCAL_HIST_ARCHIVE}.tmp.$$" "$LOCAL_HIST_ARCHIVE"
    chmod 600 "$LOCAL_HIST_ARCHIVE" 2>/dev/null || true
fi

if [ "$DRIVE_ENABLED" -eq 1 ]; then
    "$RCLONE_BIN" --config "$RCLONE_CONF_PATH" copy "$ARCHIVO" "${REMOTE_NAME}:${REMOTE_DIR}"
    "$RCLONE_BIN" --config "$RCLONE_CONF_PATH" copyto "$ARCHIVO" "${REMOTE_NAME}:${REMOTE_DIR}/historico_sql/respaldo_${MONTH_TAG}.sql.gz"
    if [ -s "$HIST_NEW_GZ" ] && gzip -t "$HIST_NEW_GZ" >/dev/null 2>&1; then
        "$RCLONE_BIN" --config "$RCLONE_CONF_PATH" copyto "$HIST_NEW_GZ" "${REMOTE_NAME}:${REMOTE_DIR}/historico_completo.json.gz"
        ARCHIVE_READY=1
    fi
    if ! "$RCLONE_BIN" --config "$RCLONE_CONF_PATH" lsf "${REMOTE_NAME}:${REMOTE_DIR}" --include "respaldo_mood_tracker.sql.gz" 2>/dev/null | grep -qx "respaldo_mood_tracker.sql.gz"; then
        echo "Error: No se pudo verificar respaldo_mood_tracker.sql.gz en ${REMOTE_NAME}:${REMOTE_DIR} tras la subida." >&2
        exit 1
    fi
elif [ -s "$LOCAL_HIST_ARCHIVE" ] && gzip -t "$LOCAL_HIST_ARCHIVE" >/dev/null 2>&1; then
    ARCHIVE_READY=1
fi

# Purgar archivos temporales antiguos en disco local (> 7 días) para mantener cero saturación en servidor
find "$RUTA_LOCAL" -maxdepth 1 -type f -name '*.sql.gz.*' -mtime +7 -delete 2>/dev/null || true

# Instantáneas diarias locales (SQL 180 días por defecto; Word 365 días por defecto para discos >= 300 GB)
TODAY_TAG="$(date '+%Y-%m-%d')"
LOCAL_SQL_DAILY_BACKUP_DAYS="${LOCAL_SQL_DAILY_BACKUP_DAYS:-180}"
LOCAL_WORD_BACKUP_DAYS="${LOCAL_WORD_BACKUP_DAYS:-365}"

LOCAL_SQL_DAILY_DIR="$RUTA_LOCAL/diario_sql"
mkdir -p "$LOCAL_SQL_DAILY_DIR"
chmod 700 "$LOCAL_SQL_DAILY_DIR" 2>/dev/null || true
cp -f "$ARCHIVO" "$LOCAL_SQL_DAILY_DIR/respaldo_${TODAY_TAG}.sql.gz"
chmod 600 "$LOCAL_SQL_DAILY_DIR/respaldo_${TODAY_TAG}.sql.gz" 2>/dev/null || true
if [[ "$LOCAL_SQL_DAILY_BACKUP_DAYS" =~ ^[0-9]+$ ]] && [ "$LOCAL_SQL_DAILY_BACKUP_DAYS" -ge 7 ]; then
    find "$LOCAL_SQL_DAILY_DIR" -maxdepth 1 -type f -name 'respaldo_*.sql.gz' -mtime +"$LOCAL_SQL_DAILY_BACKUP_DAYS" -delete 2>/dev/null || true
fi

# Instantánea rotativa SOLO LOCAL del Diario cifrado con contraseña (nunca se sube a Google Drive)
LOCAL_JOURNAL_FILE="$PROJECT_DIR/data/journal/Diario.docx"
if [ -f "$LOCAL_JOURNAL_FILE" ]; then
    if [ -r "$LOCAL_JOURNAL_FILE" ]; then
        LOCAL_JOURNAL_BAK_DIR="$RUTA_LOCAL/journal_local_backups"
        mkdir -p "$LOCAL_JOURNAL_BAK_DIR"
        chmod 700 "$LOCAL_JOURNAL_BAK_DIR" 2>/dev/null || true
        cp -f "$LOCAL_JOURNAL_FILE" "$LOCAL_JOURNAL_BAK_DIR/Diario_${TODAY_TAG}.docx"
        chmod 600 "$LOCAL_JOURNAL_BAK_DIR/Diario_${TODAY_TAG}.docx" 2>/dev/null || true
        if [[ "$LOCAL_WORD_BACKUP_DAYS" =~ ^[0-9]+$ ]] && [ "$LOCAL_WORD_BACKUP_DAYS" -ge 7 ]; then
            find "$LOCAL_JOURNAL_BAK_DIR" -maxdepth 1 -type f -name 'Diario_*.docx' -mtime +"$LOCAL_WORD_BACKUP_DAYS" -delete 2>/dev/null || true
        fi
    else
        echo "Aviso: $LOCAL_JOURNAL_FILE no es legible por $(id -un); corrige permisos con: sudo chown -R \$(id -u):\$(id -g) \"$PROJECT_DIR/data/journal\"" >&2
    fi
fi

# Instantánea rotativa local del Cuaderno de Idiomas
LOCAL_ENGLISH_FILE="$PROJECT_DIR/english-notes/English_Learning_Notebook.docx"
if [ -f "$LOCAL_ENGLISH_FILE" ]; then
    if [ -r "$LOCAL_ENGLISH_FILE" ]; then
        LOCAL_ENGLISH_BAK_DIR="$RUTA_LOCAL/english_local_backups"
        mkdir -p "$LOCAL_ENGLISH_BAK_DIR"
        chmod 700 "$LOCAL_ENGLISH_BAK_DIR" 2>/dev/null || true
        cp -f "$LOCAL_ENGLISH_FILE" "$LOCAL_ENGLISH_BAK_DIR/English_Learning_Notebook_${TODAY_TAG}.docx"
        chmod 600 "$LOCAL_ENGLISH_BAK_DIR/English_Learning_Notebook_${TODAY_TAG}.docx" 2>/dev/null || true
        if [[ "$LOCAL_WORD_BACKUP_DAYS" =~ ^[0-9]+$ ]] && [ "$LOCAL_WORD_BACKUP_DAYS" -ge 7 ]; then
            find "$LOCAL_ENGLISH_BAK_DIR" -maxdepth 1 -type f -name 'English_Learning_Notebook_*.docx' -mtime +"$LOCAL_WORD_BACKUP_DAYS" -delete 2>/dev/null || true
        fi
    else
        echo "Aviso: $LOCAL_ENGLISH_FILE no es legible por $(id -un); corrige permisos con: sudo chown -R \$(id -u):\$(id -g) \"$PROJECT_DIR/english-notes\"" >&2
    fi
fi

# 5. Purgar de MySQL local registros mayores a DB_RETENTION_DAYS (0 por defecto para conservar todo en disco >= 300 GB)
RETENTION_DAYS="${DB_RETENTION_DAYS:-0}"
if [ "$RETENTION_DAYS" = "0" ]; then
    PURGE_SESSIONS_SQL="
        DELETE FROM SesionesAuth WHERE expira_en < NOW();
        DELETE FROM CodigosSeguridad WHERE expira_en < NOW() OR usado = 1;
    "
    run_mysql_query "$PURGE_SESSIONS_SQL" >/dev/null 2>&1 || true
    echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Retención local ilimitada (DB_RETENTION_DAYS=0): se conservan todos los registros en MySQL."
elif [ "$ARCHIVE_READY" -eq 1 ] && [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && [ "$RETENTION_DAYS" -ge 7 ]; then
    PURGE_SQL="
        DELETE FROM RegistrosMood WHERE fecha < DATE_SUB(CURDATE(), INTERVAL ${RETENTION_DAYS} DAY);
        DELETE FROM RegistrosSleep WHERE fecha < DATE_SUB(CURDATE(), INTERVAL ${RETENTION_DAYS} DAY);
        DELETE FROM RegistrosCrisis WHERE fecha < DATE_SUB(CURDATE(), INTERVAL ${RETENTION_DAYS} DAY);
        DELETE FROM RegistrosAgenda WHERE fecha < DATE_SUB(CURDATE(), INTERVAL ${RETENTION_DAYS} DAY) AND (completada = 1 OR estado = 'done');
        DELETE FROM SesionesAuth WHERE expira_en < NOW();
        DELETE FROM CodigosSeguridad WHERE expira_en < NOW() OR usado = 1;
    "
    run_mysql_query "$PURGE_SQL" >/dev/null 2>&1 || true
else
    echo "Aviso: Se omitió la poda automática en MySQL porque el respaldo histórico acumulativo no se verificó aún (ARCHIVE_READY=$ARCHIVE_READY)." >&2
fi

DISK_FREE_TXT="$(df -BG "$RUTA_LOCAL" 2>/dev/null | awk 'NR==2{print $4 " libres de " $2}' || df -h "$RUTA_LOCAL" 2>/dev/null | awk 'NR==2{print $4 " libres de " $2}' || echo 'desconocido')"
RET_LABEL=$([ "$RETENTION_DAYS" = "0" ] && echo "ilimitada (DB_RETENTION_DAYS=0)" || echo "${RETENTION_DAYS} días")
MODO_TXT=$([ "$SEALED_MODE" -eq 1 ] && echo "sellado" || echo "env")
DESTINO_TXT=$([ "$DRIVE_ENABLED" -eq 1 ] && echo "local + ${REMOTE_NAME}:${REMOTE_DIR}" || echo "100% local ($RUTA_LOCAL)")
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Respaldo completo + archivo histórico completados (${DESTINO_TXT}; disco=${DISK_FREE_TXT}; diario_sql=${LOCAL_SQL_DAILY_BACKUP_DAYS}d; word_bak=${LOCAL_WORD_BACKUP_DAYS}d) y retención local ${RET_LABEL} aplicada (modo=$MODO_TXT)"