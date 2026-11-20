#!/bin/bash
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    printf '[PASS] %s\n' "$1"
}

warn() {
    WARN_COUNT=$((WARN_COUNT + 1))
    printf '[WARN] %s\n' "$1"
}

fail() {
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf '[FAIL] %s\n' "$1" >&2
}

PORT="${PORT:-3000}"
PROXY_HTTP_PORT="${PROXY_HTTP_PORT:-8080}"
EXPECTED_TZ="${TZ:-America/Monterrey}"
if [ -f "$PROJECT_DIR/.env" ]; then
    ENV_PORT="$(grep -E '^PORT=' "$PROJECT_DIR/.env" | tail -n 1 | cut -d= -f2- | tr -d '"\r ' || true)"
    ENV_PROXY_PORT="$(grep -E '^PROXY_HTTP_PORT=' "$PROJECT_DIR/.env" | tail -n 1 | cut -d= -f2- | tr -d '"\r ' || true)"
    ENV_TZ="$(grep -E '^TZ=' "$PROJECT_DIR/.env" | tail -n 1 | cut -d= -f2- | tr -d '"\r ' || true)"
    [ -n "$ENV_PORT" ] && PORT="$ENV_PORT"
    [ -n "$ENV_PROXY_PORT" ] && PROXY_HTTP_PORT="$ENV_PROXY_PORT"
    [ -n "$ENV_TZ" ] && EXPECTED_TZ="$ENV_TZ"
fi

echo "======================================================================"
echo " Verificación Local Ubuntu Server + Tailscale (8 GB RAM / i7 / ~500 GB HDD)"
echo "======================================================================"

# 1. Hardware y sistema operativo
echo ""
echo "--- [1/10] Hardware, Memoria, Disco HDD y Swap ---"
CPU_MODEL="$(awk -F: '/model name/{print $2; exit}' /proc/cpuinfo 2>/dev/null | sed 's/^[ \t]*//' || true)"
CPU_CORES="$(nproc 2>/dev/null || echo '?')"
echo "CPU: ${CPU_MODEL:-desconocido} (${CPU_CORES} hilos)"

RAM_TOTAL_MB="$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)"
RAM_AVAIL_MB="$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)"
echo "RAM: ${RAM_TOTAL_MB} MB total / ${RAM_AVAIL_MB} MB disponibles"
if [ "$RAM_TOTAL_MB" -ge 6000 ]; then
    pass "Memoria RAM adecuada (${RAM_TOTAL_MB} MB >= 6 GB para MySQL + Node + Python + yt-dlp)."
elif [ "$RAM_TOTAL_MB" -gt 0 ]; then
    warn "RAM total detectada (${RAM_TOTAL_MB} MB) menor a 6 GB; vigila swap y uso concurrente."
else
    warn "No se pudo determinar la RAM total desde /proc/meminfo."
fi

df -h "$PROJECT_DIR" 2>/dev/null | sed 's/^/  /' || true
DISK_STATS_GB="$(df -BG --output=size,avail "$PROJECT_DIR" 2>/dev/null | awk 'NR==2{gsub(/G/,""); print $1 "|" $2}' || true)"
if [ -n "$DISK_STATS_GB" ]; then
    DISK_TOTAL_GB="${DISK_STATS_GB%%|*}"
    DISK_AVAIL_GB="${DISK_STATS_GB##*|}"
    if [[ "$DISK_TOTAL_GB" =~ ^[0-9]+$ ]] && [ "$DISK_TOTAL_GB" -ge 250 ] && [ "${DISK_AVAIL_GB:-0}" -ge 100 ]; then
        pass "Capacidad de disco adecuada para retención local ilimitada (${DISK_AVAIL_GB} GB libres de ${DISK_TOTAL_GB} GB totales)."
    elif [[ "$DISK_AVAIL_GB" =~ ^[0-9]+$ ]]; then
        warn "Espacio en disco reducido para backups históricos extendidos (${DISK_AVAIL_GB} GB libres de ${DISK_TOTAL_GB} GB; recomendado >= 300 GB / >= 100 GB libres)."
    fi
fi
if command -v lsblk >/dev/null 2>&1; then
    echo "Discos físicos:"
    lsblk -d -o NAME,ROTA,SIZE,MODEL 2>/dev/null | sed 's/^/  /' || true
fi

if [ -r /proc/sys/vm/swappiness ]; then
    SWAPPINESS="$(cat /proc/sys/vm/swappiness 2>/dev/null || echo '')"
    if [ -n "$SWAPPINESS" ] && [ "$SWAPPINESS" -le 20 ] 2>/dev/null; then
        pass "vm.swappiness=${SWAPPINESS} (óptimo para evitar thrashing en HDD)."
    else
        warn "vm.swappiness=${SWAPPINESS:-desconocido}. Recomendado <= 10 para 8 GB RAM + HDD (sysctl vm.swappiness=10)."
    fi
fi

# 2. Docker & Compose
echo ""
echo "--- [2/10] Docker, Contenedores y Tuning MySQL HDD ---"
DOCKER_CMD="docker"
if ! docker info >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
        DOCKER_CMD="sudo docker"
    else
        fail "Docker daemon no accesible para el usuario actual (añádelo al grupo docker o usa sudo)."
    fi
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    pass "Docker Compose v2 disponible."
else
    fail "Docker Compose v2 ('docker compose') no está disponible."
fi

for cname in mood_db mood_app mood_app2 mood_proxy; do
    STATE="$($DOCKER_CMD inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cname" 2>/dev/null || echo 'missing|none')"
    if [ "$STATE" = "running|healthy" ]; then
        pass "Contenedor $cname en estado running (healthy)."
    elif [[ "$STATE" == running\|* ]]; then
        warn "Contenedor $cname corriendo con healthcheck='$STATE'."
    else
        fail "Contenedor $cname no está corriendo/saludable ($STATE)."
    fi
done

$DOCKER_CMD stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' mood_db mood_app mood_app2 mood_proxy 2>/dev/null || true

APP_UID_OUT="$($DOCKER_CMD exec mood_app id -u 2>/dev/null || echo '')"
if [ -n "$APP_UID_OUT" ] && [ "$APP_UID_OUT" != "0" ]; then
    pass "mood_app ejecuta como usuario no-root (UID=$APP_UID_OUT)."
else
    warn "mood_app no ejecuta como no-root (UID=${APP_UID_OUT:-desconocido}); los archivos creados podrían quedar como root."
fi

MYSQL_TUNING="$($DOCKER_CMD exec mood_db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -N -s -u root -e "SHOW VARIABLES WHERE Variable_name IN (\"innodb_buffer_pool_size\",\"innodb_flush_log_at_trx_commit\",\"innodb_flush_method\");"' 2>/dev/null || true)"
if [ -n "$MYSQL_TUNING" ]; then
    echo "MySQL InnoDB tuning activo:"
    printf '%s\n' "$MYSQL_TUNING" | sed 's/^/  /'
    pass "Variables InnoDB consultadas correctamente en mood_db."
else
    warn "No se pudieron consultar variables InnoDB en mood_db."
fi

# 3. Red, Loopback, UFW y Tailscale
echo ""
echo "--- [3/10] Seguridad de Red, Loopback, UFW y Tailscale ---"
if command -v ss >/dev/null 2>&1; then
    LISTEN_OUT="$(ss -lntp 2>/dev/null || ss -lnt 2>/dev/null || true)"
    if printf '%s\n' "$LISTEN_OUT" | grep -qE "(0\.0\.0\.0|\*|\[::\]):${PORT}\b"; then
        fail "El puerto ${PORT} está expuesto en 0.0.0.0/* (bypassea UFW); debe quedar solo en 127.0.0.1:${PORT}."
    elif printf '%s\n' "$LISTEN_OUT" | grep -qE "127\.0\.0\.1:${PORT}\b"; then
        pass "Puerto ${PORT} enlazado exclusivamente a 127.0.0.1:${PORT}."
    else
        warn "No se detectó socket escuchando en 127.0.0.1:${PORT}."
    fi

    if printf '%s\n' "$LISTEN_OUT" | grep -qE "(0\.0\.0\.0|\*|\[::\]):3306\b"; then
        fail "El puerto MySQL 3306 está expuesto fuera de loopback."
    elif printf '%s\n' "$LISTEN_OUT" | grep -qE "127\.0\.0\.1:3306\b"; then
        pass "Puerto MySQL 3306 enlazado exclusivamente a 127.0.0.1:3306."
    fi
else
    warn "Herramienta 'ss' no disponible para auditar puertos."
fi

if command -v ufw >/dev/null 2>&1; then
    UFW_STATUS="$(ufw status 2>/dev/null || sudo -n ufw status 2>/dev/null || true)"
    if printf '%s\n' "$UFW_STATUS" | grep -qi 'Status: active'; then
        pass "Firewall UFW activo."
    else
        warn "UFW inactivo o requiere sudo para inspeccionarse (verifica 'sudo ufw status')."
    fi
fi

if command -v tailscale >/dev/null 2>&1; then
    if tailscale status >/dev/null 2>&1; then
        pass "Tailscale conectado en este host."
        TS_SERVE="$(tailscale serve status 2>/dev/null || true)"
        if [ -n "$TS_SERVE" ] && printf '%s\n' "$TS_SERVE" | grep -qE "(127\.0\.0\.1|localhost|):(${PORT}|${PROXY_HTTP_PORT})"; then
            pass "Tailscale Serve apuntando hacia endpoint local (${PROXY_HTTP_PORT} / ${PORT})."
        else
            warn "Tailscale Serve no muestra ruta activa hacia localhost:${PROXY_HTTP_PORT} ni ${PORT} (para balanceador usa: sudo tailscale serve --bg http://127.0.0.1:${PROXY_HTTP_PORT})."
        fi
    else
        warn "Tailscale instalado pero sin sesión activa o sin permisos."
    fi
else
    warn "CLI 'tailscale' no encontrado en PATH."
fi

# 4. Node.js y zona horaria (tzdata) dentro de mood_app
echo ""
echo "--- [4/10] Node.js y Zona Horaria (tzdata) en mood_app ---"
NODE_TZ_OUT="$($DOCKER_CMD exec mood_app sh -c 'node -e "console.log(process.version + \"|\" + Intl.DateTimeFormat().resolvedOptions().timeZone)"' 2>/dev/null || true)"
SYS_TZ_OUT="$($DOCKER_CMD exec mood_app date +%Z 2>/dev/null || true)"
if [ -n "$NODE_TZ_OUT" ]; then
    echo "Node en contenedor: ${NODE_TZ_OUT} (date +%Z = ${SYS_TZ_OUT:-?})"
    if [[ "$NODE_TZ_OUT" == *"|${EXPECTED_TZ}" ]] && [ "${SYS_TZ_OUT:-UTC}" != "UTC" -o "$EXPECTED_TZ" = "UTC" ]; then
        pass "Node.js + tzdata usan la zona horaria local esperada (${EXPECTED_TZ})."
    else
        fail "Desfase horario en mood_app: obtenido '${NODE_TZ_OUT}' (date +%Z=${SYS_TZ_OUT:-?}), esperado '${EXPECTED_TZ}'."
    fi
else
    fail "No se pudo consultar Node.js / zona horaria en mood_app."
fi

# 5. Python 3 + msoffcrypto + docx_writer.py dentro de mood_app
echo ""
echo "--- [5/10] Python 3 + msoffcrypto-tool + docx_writer.py en mood_app ---"
PY_CHECK="$($DOCKER_CMD exec mood_app python3 -c "import ast, io, msoffcrypto, platform, time, zipfile; from msoffcrypto.format.ooxml import OOXMLFile; ast.parse(open('/app/lib/docx_writer.py', encoding='utf-8').read()); buf = io.BytesIO(); z = zipfile.ZipFile(buf, 'w'); z.writestr('[Content_Types].xml', '<Types/>'); z.close(); buf.seek(0); enc = io.BytesIO(); f = OOXMLFile(buf); f.encrypt('TestPass123!', enc); enc.seek(0); dec = io.BytesIO(); f2 = OOXMLFile(enc); f2.load_key(password='TestPass123!'); f2.decrypt(dec); print(platform.python_version(), '|', time.tzname)" 2>/dev/null || true)"
if [ -n "$PY_CHECK" ]; then
    pass "Python + AST(docx_writer.py) + OOXMLFile cifrado/descifrado en RAM OK ($PY_CHECK)."
else
    fail "Falló la verificación Python / msoffcrypto OOXMLFile / docx_writer.py dentro de mood_app."
fi

# 6. yt-dlp + ffmpeg + runtime JS dentro de mood_app
echo ""
echo "--- [6/10] yt-dlp + ffmpeg + Runtime JS (Node) en mood_app ---"
YTDLP_VER="$($DOCKER_CMD exec mood_app /usr/local/bin/yt-dlp --version 2>/dev/null || true)"
FFMPEG_VER="$($DOCKER_CMD exec mood_app sh -c 'ffmpeg -version 2>/dev/null | head -n 1' || true)"
NODE_BIN="$($DOCKER_CMD exec mood_app which node 2>/dev/null || true)"
if [ -n "$YTDLP_VER" ] && [ -n "$FFMPEG_VER" ] && [ -n "$NODE_BIN" ]; then
    if $DOCKER_CMD exec mood_app /usr/local/bin/yt-dlp --js-runtimes node --version >/dev/null 2>&1; then
        pass "yt-dlp ($YTDLP_VER) + --js-runtimes node ($NODE_BIN) + ffmpeg operativos en local."
    else
        warn "yt-dlp ($YTDLP_VER) presente pero no aceptó --js-runtimes node; actualiza yt-dlp."
    fi
else
    fail "Falta alguno de yt-dlp ('$YTDLP_VER'), ffmpeg ('$FFMPEG_VER') o node ('$NODE_BIN') en mood_app."
fi

if $DOCKER_CMD exec mood_app test -s /app/ytdlp-config/cookies.txt 2>/dev/null; then
    pass "Archivo opcional de cookies yt-dlp detectado (/app/ytdlp-config/cookies.txt)."
else
    echo "Info: Sin cookies.txt montado en ./data/ytdlp (opcional salvo videos con restricción)."
fi

# 7. Assets 100% locales sin CDN, HTTPS/HSTS y CORS estricto
echo ""
echo "--- [7/10] Assets 100% Locales (sin CDN), HTTPS/HSTS y CORS Estricto ---"
if command -v curl >/dev/null 2>&1; then
    HEALTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}/healthz" 2>/dev/null || echo '000')"
    if [ "$HEALTH_CODE" = "200" ]; then
        pass "http://127.0.0.1:${PORT}/healthz responde HTTP 200."
    else
        fail "http://127.0.0.1:${PORT}/healthz respondió HTTP ${HEALTH_CODE}."
    fi

    PROXY_HEALTH_HDRS="$(curl -s -D - -o /dev/null -w '\n%{http_code}' --max-time 5 "http://127.0.0.1:${PROXY_HTTP_PORT}/healthz" 2>/dev/null || true)"
    PROXY_HEALTH_CODE="$(printf '%s\n' "$PROXY_HEALTH_HDRS" | tail -n 1)"
    if [ "$PROXY_HEALTH_CODE" = "200" ]; then
        PROXY_REPLICA="$(printf '%s\n' "$PROXY_HEALTH_HDRS" | grep -i '^X-Replica-Id:' | head -n 1 | tr -d '\r' || true)"
        if printf '%s\n' "$PROXY_HEALTH_HDRS" | grep -qi '^Set-Cookie:.*pdh_lb='; then
            pass "Balanceador Caddy (127.0.0.1:${PROXY_HTTP_PORT}/healthz) responde 200 con sticky cookie pdh_lb (${PROXY_REPLICA:-X-Replica-Id})."
        else
            warn "Balanceador Caddy (127.0.0.1:${PROXY_HTTP_PORT}/healthz) responde 200 pero sin cookie pdh_lb (${PROXY_REPLICA:-sin X-Replica-Id})."
        fi
    else
        fail "Balanceador Caddy http://127.0.0.1:${PROXY_HTTP_PORT}/healthz respondió HTTP ${PROXY_HEALTH_CODE:-000}."
    fi

    HTML_BODY="$(curl -fsS --max-time 8 -H "X-Forwarded-Proto: https" "http://127.0.0.1:${PORT}/" 2>/dev/null || true)"
    if [ -n "$HTML_BODY" ]; then
        if printf '%s' "$HTML_BODY" | grep -q 'cdnjs.cloudflare.com'; then
            fail "La página principal sigue referenciando cdnjs.cloudflare.com."
        elif printf '%s' "$HTML_BODY" | grep -q 'vendor/crypto-js.min.js'; then
            pass "HTML sirve crypto-js localmente (vendor/crypto-js.min.js) sin CDN externo."
        else
            warn "No se detectó referencia a vendor/crypto-js.min.js en /."
        fi
    else
        fail "No responde http://127.0.0.1:${PORT}/ con X-Forwarded-Proto: https."
    fi

    HTTPS_HDRS="$(curl -fsS -D - -o /dev/null --max-time 8 -H "X-Forwarded-Proto: https" "http://127.0.0.1:${PORT}/" 2>/dev/null || true)"
    if printf '%s' "$HTTPS_HDRS" | grep -qi '^Strict-Transport-Security:'; then
        pass "Cabecera Strict-Transport-Security (HSTS) activa bajo HTTPS (Tailscale Serve)."
    else
        fail "Falta Strict-Transport-Security bajo X-Forwarded-Proto: https."
    fi

    VENDOR_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H "X-Forwarded-Proto: https" "http://127.0.0.1:${PORT}/vendor/crypto-js.min.js" 2>/dev/null || echo '000')"
    if [ "$VENDOR_CODE" = "200" ]; then
        pass "http://127.0.0.1:${PORT}/vendor/crypto-js.min.js responde HTTP 200."
    else
        fail "vendor/crypto-js.min.js respondió HTTP ${VENDOR_CODE}."
    fi

    REQ_HTTPS_VAL="$($DOCKER_CMD exec mood_app sh -c 'printf "%s" "${REQUIRE_HTTPS:-false}"' 2>/dev/null || echo '')"
    if [ "$REQ_HTTPS_VAL" = "true" ]; then
        PLAIN_API_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}/api/auth/me" 2>/dev/null || echo '000')"
        if [ "$PLAIN_API_CODE" = "426" ]; then
            pass "REQUIRE_HTTPS=true bloquea API HTTP plano sin TLS (HTTP 426)."
        else
            fail "REQUIRE_HTTPS=true activo pero /api/auth/me HTTP plano devolvió ${PLAIN_API_CODE} (esperado 426)."
        fi
    else
        warn "REQUIRE_HTTPS=${REQ_HTTPS_VAL:-false}; en producción con Tailscale Serve usa REQUIRE_HTTPS=true."
    fi

    CORS_EVIL_HDRS="$(curl -s -D - -o /dev/null --max-time 5 -H "X-Forwarded-Proto: https" -H "Origin: https://evil.example" "http://127.0.0.1:${PORT}/api/auth/me" 2>/dev/null || true)"
    if printf '%s' "$CORS_EVIL_HDRS" | grep -qi 'evil\.example'; then
        fail "CORS reflejó un origen hostil (https://evil.example)."
    else
        pass "CORS estricto rechaza orígenes externos no confiables (evil.example)."
    fi
else
    warn "curl no está instalado en el host."
fi

# 8. Permisos en volúmenes locales para el usuario anfitrión
echo ""
echo "--- [8/10] Permisos de Volúmenes Locales ---"
for d in "$PROJECT_DIR/data/journal" "$PROJECT_DIR/english-notes" "$PROJECT_DIR/logs"; do
    if [ -d "$d" ]; then
        if [ -r "$d" ] && [ -w "$d" ]; then
            UNREADABLE="$(find "$d" -maxdepth 2 -type f ! -readable 2>/dev/null | head -n 1 || true)"
            if [ -n "$UNREADABLE" ]; then
                fail "Archivo no legible por $(id -un): $UNREADABLE (corrige con: sudo chown -R $(id -u):$(id -g) \"$d\")."
            else
                pass "Permisos correctos en $d."
            fi
        else
            fail "Directorio sin permisos de lectura/escritura para $(id -un): $d."
        fi
    else
        warn "Directorio aún no creado: $d."
    fi
done

# 9. Respaldos Google Drive (rclone) y Cron
echo ""
echo "--- [9/10] Respaldos Google Drive (rclone) y Cron ---"
VERIFY_REMOTE="${RCLONE_REMOTE:-gdrive}"
VERIFY_REMOTE_DIR="${RCLONE_BACKUP_DIR:-RespaldosApp}"
VERIFY_RETENTION="${DB_RETENTION_DAYS:-}"
VERIFY_SQL_DAILY_DAYS="${LOCAL_SQL_DAILY_BACKUP_DAYS:-}"
VERIFY_WORD_DAYS="${LOCAL_WORD_BACKUP_DAYS:-}"
for cfg_src in "$HOME/projects/respaldos/.backup.meta" "$PROJECT_DIR/.env"; do
    if [ -r "$cfg_src" ]; then
        V_REM="$(grep -E '^RCLONE_REMOTE=' "$cfg_src" | tail -n 1 | cut -d= -f2- | tr -d '"\r ' || true)"
        V_DIR="$(grep -E '^RCLONE_BACKUP_DIR=' "$cfg_src" | tail -n 1 | cut -d= -f2- | tr -d "\"'\r" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' || true)"
        V_RET="$(grep -E '^DB_RETENTION_DAYS=' "$cfg_src" | tail -n 1 | cut -d= -f2- | tr -d '"\r ' || true)"
        V_SQL_D="$(grep -E '^LOCAL_SQL_DAILY_BACKUP_DAYS=' "$cfg_src" | tail -n 1 | cut -d= -f2- | tr -d '"\r ' || true)"
        V_WRD_D="$(grep -E '^LOCAL_WORD_BACKUP_DAYS=' "$cfg_src" | tail -n 1 | cut -d= -f2- | tr -d '"\r ' || true)"
        [ -n "$V_REM" ] && VERIFY_REMOTE="$V_REM"
        [ -n "$V_DIR" ] && VERIFY_REMOTE_DIR="$V_DIR"
        [ -n "$V_RET" ] && VERIFY_RETENTION="$V_RET"
        [ -n "$V_SQL_D" ] && VERIFY_SQL_DAILY_DAYS="$V_SQL_D"
        [ -n "$V_WRD_D" ] && VERIFY_WORD_DAYS="$V_WRD_D"
    fi
done
[ -z "$VERIFY_RETENTION" ] && VERIFY_RETENTION="0"
[ -z "$VERIFY_SQL_DAILY_DAYS" ] && VERIFY_SQL_DAILY_DAYS="180"
[ -z "$VERIFY_WORD_DAYS" ] && VERIFY_WORD_DAYS="365"
RET_MODE_DESC=$([ "$VERIFY_RETENTION" = "0" ] && echo "0 (ilimitado)" || echo "${VERIFY_RETENTION}d")
echo "Config backups: remoto=${VERIFY_REMOTE}:${VERIFY_REMOTE_DIR} | DB_RETENTION_DAYS=${RET_MODE_DESC} | diario_sql=${VERIFY_SQL_DAILY_DAYS}d | word_bak=${VERIFY_WORD_DAYS}d"

VERIFY_RCLONE_CONF="${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}"
RCLONE_BIN_HOST="$(command -v rclone || true)"
if [ -n "$RCLONE_BIN_HOST" ] && [ -s "$VERIFY_RCLONE_CONF" ]; then
    if "$RCLONE_BIN_HOST" --config "$VERIFY_RCLONE_CONF" listremotes 2>/dev/null | grep -qx "${VERIFY_REMOTE}:"; then
        pass "Remoto rclone '${VERIFY_REMOTE}:' presente en $VERIFY_RCLONE_CONF."
        if DRIVE_LIST="$("$RCLONE_BIN_HOST" --config "$VERIFY_RCLONE_CONF" lsf "${VERIFY_REMOTE}:${VERIFY_REMOTE_DIR}" --max-depth 1 2>/dev/null)"; then
            pass "Conectividad en vivo con Google Drive (${VERIFY_REMOTE}:${VERIFY_REMOTE_DIR}) OK."
            if printf '%s\n' "$DRIVE_LIST" | grep -qx "respaldo_mood_tracker.sql.gz"; then
                pass "Respaldo SQL detectado en Google Drive (respaldo_mood_tracker.sql.gz)."
            else
                warn "Aún no existe respaldo_mood_tracker.sql.gz en ${VERIFY_REMOTE}:${VERIFY_REMOTE_DIR} (ejecuta ./scripts/backup.sh --require-drive)."
            fi
            if printf '%s\n' "$DRIVE_LIST" | grep -qx "historico_completo.json.gz"; then
                pass "Archivo histórico acumulativo detectado en Google Drive (historico_completo.json.gz)."
            else
                warn "Aún no existe historico_completo.json.gz en ${VERIFY_REMOTE}:${VERIFY_REMOTE_DIR}."
            fi
        else
            fail "No se pudo listar ${VERIFY_REMOTE}:${VERIFY_REMOTE_DIR} en Google Drive (token expirado o sin red)."
        fi
    else
        warn "rclone.conf existe pero falta el remoto '${VERIFY_REMOTE}:'."
    fi
else
    warn "rclone o $VERIFY_RCLONE_CONF no configurados; respaldos operan solo en local."
fi

if $DOCKER_CMD exec mood_app sh -c 'test -n "${RCLONE_CONF_B64:-}"' >/dev/null 2>&1; then
    pass "RCLONE_CONF_B64 presente en mood_app para sincronizar Cuaderno de Idiomas en Drive."
else
    warn "RCLONE_CONF_B64 vacío en mood_app (Cuaderno de Idiomas solo en volumen local ./english-notes)."
fi

if command -v crontab >/dev/null 2>&1; then
    CRON_DUMP="$(crontab -l 2>/dev/null || true)"
    if printf '%s\n' "$CRON_DUMP" | grep -q 'scripts/backup\.sh'; then
        pass "Cron automático de respaldo (scripts/backup.sh) registrado."
    else
        warn "Falta cron de scripts/backup.sh en crontab."
    fi
    if printf '%s\n' "$CRON_DUMP" | grep -qE 'docker exec -u 0 mood_app (/usr/local/bin/)?yt-dlp -U'; then
        pass "Cron semanal de yt-dlp (-u 0) registrado."
    else
        warn "Falta o usa root implícito el cron de actualización yt-dlp (usa: docker exec -u 0 mood_app yt-dlp -U)."
    fi
fi

# 10. Blindaje anti-intrusión, anti-DoS y aislamiento de secretos
echo ""
echo "--- [10/10] Blindaje anti-intrusión, anti-DoS y aislamiento de secretos ---"
APP_SEC_INFO="$($DOCKER_CMD inspect -f '{{.HostConfig.SecurityOpt}}|{{.HostConfig.CapDrop}}|{{.HostConfig.PidsLimit}}' mood_app 2>/dev/null || echo '')"
if printf '%s' "$APP_SEC_INFO" | grep -q 'no-new-privileges:true' && printf '%s' "$APP_SEC_INFO" | grep -qi 'ALL'; then
    pass "Contenedor mood_app endurecido ($APP_SEC_INFO)."
else
    warn "mood_app sin hardening completo de capacidades/pids ($APP_SEC_INFO); reconstruye con docker compose up -d --build."
fi

if [ -f "$PROJECT_DIR/.env" ]; then
    ENV_PERM="$(stat -c '%a' "$PROJECT_DIR/.env" 2>/dev/null || echo '???')"
    warn "Existe $PROJECT_DIR/.env en disco (permisos=$ENV_PERM); para cero secretos planos en disco usa SEAL_ENV_AFTER_DEPLOY=true o ./scripts/env-vault.sh encrypt."
else
    pass "Sin archivo .env en texto plano sobre disco ($PROJECT_DIR/.env ausente)."
fi

if [ -r /proc/sys/net/ipv4/tcp_syncookies ]; then
    SYNCOOKIES="$(cat /proc/sys/net/ipv4/tcp_syncookies 2>/dev/null || echo '0')"
    if [ "$SYNCOOKIES" = "1" ]; then
        pass "Protección kernel anti-SYN flood activa (net.ipv4.tcp_syncookies=1)."
    else
        warn "net.ipv4.tcp_syncookies=${SYNCOOKIES}; activa protecciones DoS del kernel (ver sección 10.2 de la guía)."
    fi
fi

if grep -RqsE '^\s*PasswordAuthentication\s+no\b' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/ 2>/dev/null; then
    pass "OpenSSH bloquea autenticación por contraseña (PasswordAuthentication no)."
else
    warn "No se confirmó PasswordAuthentication no en /etc/ssh/sshd_config*."
fi

if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet fail2ban 2>/dev/null; then
        pass "Fail2ban activo protegiendo SSH contra fuerza bruta."
    else
        warn "Fail2ban no está activo (instálalo para banear IPs tras intentos fallidos SSH)."
    fi
    if systemctl is-enabled --quiet unattended-upgrades 2>/dev/null || dpkg -s unattended-upgrades >/dev/null 2>&1; then
        pass "Actualizaciones automáticas de seguridad (unattended-upgrades) presentes."
    else
        warn "unattended-upgrades no detectado (recomendado para parches CVE automáticos)."
    fi
fi

PROC_MOUNT="$(grep -E '\s/proc\s+proc\s' /proc/mounts 2>/dev/null || true)"
if printf '%s' "$PROC_MOUNT" | grep -q 'hidepid='; then
    pass "/proc montado con aislamiento de procesos ($PROC_MOUNT)."
else
    warn "/proc sin hidepid=2 (usuarios locales no privilegiados podrían inspeccionar procesos; ver sección 10.2 de la guía)."
fi

echo ""
echo "======================================================================"
echo " Resumen: PASS=${PASS_COUNT} | WARN=${WARN_COUNT} | FAIL=${FAIL_COUNT}"
echo "======================================================================"

if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
fi
exit 0
