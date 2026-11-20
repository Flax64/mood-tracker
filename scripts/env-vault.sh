#!/bin/bash
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
if [ -z "${HOME:-}" ]; then
    HOME="$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f6 || echo /tmp)"
    export HOME
fi

# Bóveda de cifrado AES-256-CBC (PBKDF2 600,000 iteraciones) para el archivo .env en el servidor.
# Permite cifrar .env -> .env.enc con una contraseña maestra personal y operar Docker/backups desde RAM (/dev/shm).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
ENC_FILE="$PROJECT_DIR/.env.enc"
BACKUP_META_FILE="${BACKUP_META_FILE:-$HOME/projects/respaldos/.backup.meta}"

write_backup_meta() {
    [ -f "$ENV_FILE" ] || return 0
    local db_container="mood_db"
    local rclone_remote="gdrive"
    local rclone_dir="RespaldosApp"
    local backup_dir="$HOME/projects/respaldos"
    local db_retention_days=""
    local local_sql_daily_days=""
    local local_word_days=""
    local require_drive_backup=""

    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
        local k="${line%%=*}"
        local v="${line#*=}"
        k="${k//[[:space:]]/}"
        if [[ "$v" == \"*\" && "$v" == *\" ]] || [[ "$v" == \'*\' && "$v" == *\' ]]; then
            v="${v:1:${#v}-2}"
        fi
        case "$k" in
            DB_CONTAINER) [ -n "$v" ] && db_container="$v" ;;
            RCLONE_REMOTE) [ -n "$v" ] && rclone_remote="$v" ;;
            RCLONE_BACKUP_DIR) [ -n "$v" ] && rclone_dir="$v" ;;
            BACKUP_LOCAL_DIR) [ -n "$v" ] && backup_dir="$v" ;;
            DB_RETENTION_DAYS) [ -n "$v" ] && db_retention_days="$v" ;;
            LOCAL_SQL_DAILY_BACKUP_DAYS) [ -n "$v" ] && local_sql_daily_days="$v" ;;
            LOCAL_WORD_BACKUP_DAYS) [ -n "$v" ] && local_word_days="$v" ;;
            REQUIRE_DRIVE_BACKUP) [ -n "$v" ] && require_drive_backup="$v" ;;
        esac
    done < "$ENV_FILE"

    mkdir -p "$(dirname "$BACKUP_META_FILE")"
    {
        printf 'DB_CONTAINER=%s\n' "$db_container"
        printf 'RCLONE_REMOTE=%s\n' "$rclone_remote"
        printf 'RCLONE_BACKUP_DIR=%s\n' "$rclone_dir"
        printf 'BACKUP_LOCAL_DIR=%s\n' "$backup_dir"
        if [ -n "$db_retention_days" ]; then
            printf 'DB_RETENTION_DAYS=%s\n' "$db_retention_days"
        fi
        if [ -n "$local_sql_daily_days" ]; then
            printf 'LOCAL_SQL_DAILY_BACKUP_DAYS=%s\n' "$local_sql_daily_days"
        fi
        if [ -n "$local_word_days" ]; then
            printf 'LOCAL_WORD_BACKUP_DAYS=%s\n' "$local_word_days"
        fi
        if [ -n "$require_drive_backup" ]; then
            printf 'REQUIRE_DRIVE_BACKUP=%s\n' "$require_drive_backup"
        fi
    } > "$BACKUP_META_FILE"
    chmod 600 "$BACKUP_META_FILE"
}

if ! command -v openssl >/dev/null 2>&1; then
    echo "Error: openssl no está instalado. Instálalo con: sudo apt-get install -y openssl" >&2
    exit 1
fi

_VAULT_RAM_TMP=""
_VAULT_TMP_ENC=""

secure_wipe() {
    local target="$1"
    if [ -n "$target" ] && [ -f "$target" ]; then
        if command -v shred >/dev/null 2>&1; then
            shred -u -z -n 1 "$target" 2>/dev/null || rm -f "$target"
        else
            rm -f "$target"
        fi
    fi
}

cleanup_vault_temps() {
    if [ -n "${_VAULT_RAM_TMP:-}" ]; then
        secure_wipe "$_VAULT_RAM_TMP"
        _VAULT_RAM_TMP=""
    fi
    if [ -n "${_VAULT_TMP_ENC:-}" ]; then
        rm -f "$_VAULT_TMP_ENC"
        _VAULT_TMP_ENC=""
    fi
}
trap cleanup_vault_temps EXIT INT TERM

read_secret() {
    local prompt="$1"
    local var_name="$2"
    local input=""
    if [ -r /dev/tty ]; then
        printf '%s' "$prompt" >/dev/tty
        IFS= read -r -s input </dev/tty
        printf '\n' >/dev/tty
    else
        IFS= read -r -s input
    fi
    printf -v "$var_name" '%s' "$input"
}

create_ram_tmp() {
    local tmp_dir="/dev/shm"
    if [ ! -d "$tmp_dir" ] || [ ! -w "$tmp_dir" ]; then
        tmp_dir="${TMPDIR:-/tmp}"
    fi
    umask 077
    mktemp "$tmp_dir/.mood_env.XXXXXX"
}

decrypt_to_file() {
    local dest="$1"
    local pass=""
    if [ ! -f "$ENC_FILE" ]; then
        echo "Error: No existe la bóveda cifrada ($ENC_FILE)." >&2
        exit 1
    fi
    read_secret "Contraseña maestra de la bóveda .env.enc: " pass
    if [ -z "$pass" ]; then
        echo "Error: La contraseña no puede estar vacía." >&2
        exit 1
    fi
    if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 \
        -in "$ENC_FILE" -out "$dest" -pass fd:3 3< <(printf '%s\n' "$pass") 2>/dev/null; then
        secure_wipe "$dest"
        echo "Error: Contraseña incorrecta o archivo .env.enc corrupto." >&2
        exit 1
    fi
    chmod 600 "$dest"
}

cmd_encrypt() {
    if [ ! -f "$ENV_FILE" ]; then
        if [ -f "$ENC_FILE" ]; then
            echo "La bóveda ya está sellada (.env.enc existe y .env plano ya fue eliminado)."
            exit 0
        fi
        echo "Error: No existe $ENV_FILE para cifrar." >&2
        exit 1
    fi

    local pass1=""
    local pass2=""
    read_secret "Crea una contraseña maestra para cifrar .env (mín. 8 caracteres): " pass1
    if [ "${#pass1}" -lt 8 ]; then
        echo "Error: La contraseña maestra debe tener al menos 8 caracteres." >&2
        exit 1
    fi
    read_secret "Confirma la contraseña maestra: " pass2
    if [ "$pass1" != "$pass2" ]; then
        echo "Error: Las contraseñas no coinciden." >&2
        exit 1
    fi

    _VAULT_TMP_ENC="$ENC_FILE.tmp.$$"
    umask 077
    openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt \
        -in "$ENV_FILE" -out "$_VAULT_TMP_ENC" -pass fd:3 3< <(printf '%s\n' "$pass1")

    if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 \
        -in "$_VAULT_TMP_ENC" -out /dev/null -pass fd:3 3< <(printf '%s\n' "$pass1") 2>/dev/null; then
        rm -f "$_VAULT_TMP_ENC"
        _VAULT_TMP_ENC=""
        echo "Error: Falló la verificación del archivo cifrado; se conserva .env intacto." >&2
        exit 1
    fi

    write_backup_meta
    chmod 600 "$_VAULT_TMP_ENC"
    mv "$_VAULT_TMP_ENC" "$ENC_FILE"
    _VAULT_TMP_ENC=""
    secure_wipe "$ENV_FILE"
    echo "Listo: .env cifrado en $ENC_FILE y archivo plano destruido de forma segura."
}

cmd_decrypt() {
    local tmp_plain="$ENV_FILE.tmp.$$"
    decrypt_to_file "$tmp_plain"
    mv "$tmp_plain" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "Archivo .env descifrado temporalmente. Recuerda ejecutar './scripts/env-vault.sh encrypt' al terminar."
}

cmd_lock() {
    if [ ! -f "$ENC_FILE" ]; then
        echo "Error: No existe .env.enc. Ejecuta primero './scripts/env-vault.sh encrypt' para no perder tu configuración." >&2
        exit 1
    fi
    if [ -f "$ENV_FILE" ]; then
        write_backup_meta
        secure_wipe "$ENV_FILE"
        echo "Archivo plano .env destruido; solo permanece .env.enc."
    else
        echo "La bóveda ya está sellada (.env plano no existe en disco)."
    fi
}

cmd_up() {
    _VAULT_RAM_TMP="$(create_ram_tmp)"
    decrypt_to_file "$_VAULT_RAM_TMP"

    local docker_cmd="docker"
    if ! docker info >/dev/null 2>&1; then
        docker_cmd="sudo docker"
    fi

    echo "Iniciando contenedores desde memoria RAM (sin escribir .env en disco)..."
    cd "$PROJECT_DIR"
    $docker_cmd compose --env-file "$_VAULT_RAM_TMP" up -d --build
    cleanup_vault_temps
    echo "Contenedores activos. Archivo temporal en RAM destruido."
}

cmd_run_script() {
    local target_script="$1"
    shift
    _VAULT_RAM_TMP="$(create_ram_tmp)"
    decrypt_to_file "$_VAULT_RAM_TMP"

    if [ "$#" -gt 0 ]; then
        ENV_FILE_OVERRIDE="$_VAULT_RAM_TMP" "$target_script" "$@"
    else
        ENV_FILE_OVERRIDE="$_VAULT_RAM_TMP" "$target_script"
    fi
    cleanup_vault_temps
}

cmd_status() {
    echo "Estado de la bóveda en $PROJECT_DIR:"
    if [ -f "$ENV_FILE" ]; then
        echo "  [EXPUESTO] .env en texto plano presente en disco."
    else
        echo "  [OK]       .env en texto plano NO existe en disco."
    fi
    if [ -f "$ENC_FILE" ]; then
        echo "  [SELLADO]  .env.enc cifrado presente en disco."
    else
        echo "  [PENDIENTE] .env.enc aún no ha sido creado."
    fi
    if [ -f "$BACKUP_META_FILE" ]; then
        echo "  [META OK]  Metadatos sin secretos para cron en $BACKUP_META_FILE."
    fi
    if command -v crontab >/dev/null 2>&1; then
        local cron_line=""
        cron_line="$(crontab -l 2>/dev/null | grep "scripts/backup.sh" || true)"
        if [ -n "$cron_line" ]; then
            echo "  [CRON OK]  $cron_line"
        else
            echo "  [SIN CRON] No se encontró tarea automática de backup.sh en crontab."
        fi
    fi
}

ACTION="${1:-help}"
case "$ACTION" in
    encrypt)
        cmd_encrypt
        ;;
    decrypt)
        cmd_decrypt
        ;;
    lock)
        cmd_lock
        ;;
    up)
        cmd_up
        ;;
    backup)
        shift || true
        cmd_run_script "$PROJECT_DIR/scripts/backup.sh" "$@"
        ;;
    restore)
        shift || true
        cmd_run_script "$PROJECT_DIR/scripts/restore.sh" "$@"
        ;;
    status)
        cmd_status
        ;;
    *)
        cat <<'EOF'
Uso: ./scripts/env-vault.sh <comando>

Comandos disponibles:
  encrypt  Cifra .env -> .env.enc con tu contraseña maestra y destruye .env plano
  up       Descifra .env.enc solo en RAM (/dev/shm), levanta Docker y limpia RAM
  backup   Descifra .env.enc solo en RAM, ejecuta scripts/backup.sh y limpia RAM
  restore  Descifra .env.enc solo en RAM, ejecuta scripts/restore.sh y limpia RAM
  decrypt  Restaura temporalmente .env en disco para editarlo
  lock     Elimina .env plano si ya existe .env.enc
  status   Muestra si .env está sellado o en texto plano
EOF
        ;;
esac
