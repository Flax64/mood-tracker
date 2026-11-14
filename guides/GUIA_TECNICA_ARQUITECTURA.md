# Guía Técnica de Arquitectura e Implementación — Personal Daily Hub

> Documento técnico de arquitectura e implementación (versionado en `guides/` y excluido de Docker en `.dockerignore`). Resume exactamente cómo está construido, asegurado, optimizado y automatizado el sistema completo (**Personal Daily Hub** / repo `mood-tracker`).

---

## 1. Mapa de componentes y flujo general

El sistema se divide en cinco capas desacopladas:

1. **Frontend SPA (`public/index.html`, `public/theme-init.js`, `public/style.css`, `public/frontend.js`, `public/dashboard.html`)**
   - Interfaz web completamente traducida al inglés (`lang="en"`), servida por Express con pantalla inicial de verificación de sesión (`#appBootScreen`) + `theme-init.js` síncrono (sin flash de login ni de tema), spinners circulares para carga lenta, barra lateral colapsable y vistas por sección (`view-inicio`, `view-mood`, `view-sueno`, `view-journal`, `view-english`, `view-agenda`, `view-resumen`, `view-medico`).
   - Conserva intactas las claves internas en MySQL (`Madrugada`, `Morning`, `Noon`, `Afternoon`, `Night`, `Good`/`Regular`/`Bad`, `manana`/`cole`/`tarde`/`noche`, `admin`/`psiquiatra`) para mantener compatibilidad histórica total sin migración destructiva.
   - Tema claro / oscuro controlado con el atributo `data-theme="dark"` sobre el documento y variables CSS en `public/style.css`.
   - `public/dashboard.html` actúa como redirección limpia hacia `index.html#resumen`.
2. **Backend API (`server.js`)**
   - Node.js + Express 5 (`express`, `mysql2`, `bcryptjs`, `nodemailer`, `cors`, `dotenv`).
   - Autenticación con cookies `HttpOnly`, control de roles (`admin` vs `psiquiatra`), cabeceras de seguridad HTTP, validación estricta de entradas y dos colas RAM acotadas (`createEncryptedPcQueue`, tope `100` c/u): una para **Journal Notes** (`/api/send-to-pc` → `/api/pull-text`) y otra para **English Notebook** (`/api/send-english` → `/api/pull-english`), ambas cifradas E2EE sin tocar MySQL.
3. **Base de datos (`MySQL 8.0`, `init.sql`)**
   - Contenedor `mood_db` con volumen persistente `db_data` y esquema inicializado automáticamente por `init.sql` + verificación al arranque en `inicializarTablasSeguridad()`.
4. **Sincronizador PC Windows (`sincronitation/sincronizador.py` + `scripts/local-vault.js`)**
   - Cliente Python local en Windows que consulta periódicamente `/api/pull-text` y `/api/pull-english` (descubriendo `EC2_HOST` y `PORT` desde GitHub Variables API), descifra ambas colas con AES-256-CBC en local e inserta entradas vía COM (`win32com.client`) en:
     - El Word diario protegido con contraseña (`WORD_FILE_PATH`).
     - El cuaderno de aprendizaje de inglés **sin contraseña** en ruta relativa automática `english-notes/English_Learning_Notebook.docx` (carpeta ignorada por `.gitignore` y `.dockerignore`).
   - Compatible con `.env` plano, bóveda local cifrada `.env.enc` y autoinicio Windows DPAPI.
5. **Infraestructura, Respaldos y CI/CD (`Dockerfile`, `docker-compose.yml`, `scripts/*.sh`, `.github/workflows/*.yml`, `tests/`)**
   - Despliegue cero-`.env` en AWS EC2 (`t3.micro`), respaldo diario a las **3:30 AM** hacia Google Drive (`rclone`), auto-restauración en instancias vacías y suite de pruebas automatizadas en GitHub Actions para rama protegida `main`.

```
[Usuario / Psiquiatra]
        │  HTTPS/HTTP + Cookie HttpOnly (mt_session)
        ▼
[mood_app (Node 20 Alpine, --max-old-space-size=128, mem_limit 220m)]
        ├──► [mood_db (MySQL 8.0 optimizado, mem_limit 512m)]
        ├──► Cola RAM Journal (/api/send-to-pc -> /api/pull-text)
        └──► Cola RAM English (/api/send-english -> /api/pull-english)
                     ▲
                     │ Polling cada 60s (IP vía GitHub Variables API)
             [Windows PC: sincronizador.py]
                     ├──► [Word .docx diario cifrado]
                     └──► [english-notes/English_Learning_Notebook.docx (sin clave + TOC)]

[Cron 03:30 AM hora TZ] ──► [scripts/backup.sh (modo sellado)] ──► [rclone ──► Google Drive]
```

---

## 2. Base de datos (`init.sql`)

| Tabla | Propósito | Restricciones / Índices clave |
| :--- | :--- | :--- |
| `RegistrosMood` | Estados de ánimo por franja horaria | `UNIQUE(fecha, momento_dia)` (`Madrugada`, `Morning`, `Noon`, `Afternoon`, `Night`) |
| `RegistrosSleep` | Horas y calidad de sueño diario | `horas DECIMAL(4,2)`, `calidad` (`Good`, `Regular`, `Bad`) |
| `RegistrosAgenda` | Agenda personal semanal por bloques | `bloque` (`manana`, `cole`, `tarde`, `noche`), índice `idx_agenda_fecha` |
| `Usuarios` | Cuentas registradas y su rol | `email UNIQUE`, `password_hash` (`bcrypt`), `rol ENUM('admin','psiquiatra')` |
| `SesionesAuth` | Sesiones activas del sistema | `token_hash CHAR(64) UNIQUE` (SHA-256), `expira_en`, índice `idx_sesion_expira`, `ON DELETE CASCADE` |
| `CodigosSeguridad` | Códigos OTP de registro y tokens de reset | `tipo ENUM('registro','reset')`, `token_hash`, `expira_en`, `usado`, índice `idx_codigo_email_tipo` |

---

## 3. Seguridad, Autenticación, RBAC y Lógica Temporal (`server.js`)

### 3.1 Contraseñas, Sesiones y Expiración
- **Hash de contraseñas:** `bcryptjs` con factor `BCRYPT_ROUNDS = 12`.
- **Tokens opacos + hash en BD:** al iniciar sesión se genera un token aleatorio con `crypto.randomBytes`, al navegador se envía el token crudo en una cookie:
  `mt_session=...; HttpOnly; Path=/; Max-Age=...; Expires=...; SameSite=Lax`
  mientras que MySQL almacena únicamente `sha256Hex(rawToken)` en `SesionesAuth`.
- **Caducidad semanal automática:** `getNextSundayMidnight()` calcula el próximo **domingo a las `00:00:00`**. Así la sesión sobrevive aunque cierres la pestaña y solo caduca cuando presionas cerrar sesión (`/api/auth/logout`) o llega el domingo a medianoche.
- **Limpieza automática:** `limpiarRegistrosExpirados()` elimina sesiones vencidas y códigos usados/expirados en cada login y cada 6 horas (`setInterval(...).unref()`).

### 3.2 Control de Acceso por Roles (RBAC) y Registro Seguro
- Solo el correo configurado en `ADMIN_EMAIL` puede registrarse con rol `admin`; cualquier otro correo recibe estrictamente `psiquiatra`.
- Para evitar registros no autorizados del propietario, el primer registro exige verificar identidad mediante:
  - Código OTP enviado al `ADMIN_EMAIL` por Gmail SMTP (`nodemailer`), **o**
  - Clave secreta personal (`ADMIN_SECRET`, `WORD_PASSWORD` o `JOURNAL_SECRET_KEY`), comparada en tiempo constante mediante `safeCompareStrings()` (`crypto.timingSafeEqual` sobre SHA-256).
- **Middleware `requireAuth`:** valida cookie `mt_session` y vigencia en `SesionesAuth`.
- **Middleware `requireAdmin`:** exige `req.user.rol === 'admin'`; si un `psiquiatra` intenta escribir ánimo, dormir, leer/editar agenda o enviar notas a Word, responde HTTP `403`.
- El psiquiatra solo puede consultar en solo lectura `/api/get-moods` y `/api/get-sleep`.

### 3.3 Cabeceras HTTP, Validación, Rate Limiting y Protección Anti-Duplicados
- `app.disable('x-powered-by')` para no exponer el framework.
- Cabeceras fijas en cada respuesta:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: geolocation=(), microphone=(), camera=()`
  - `Content-Security-Policy` restringida a `'self'` (y `cdnjs.cloudflare.com` para CryptoJS).
  - `Cache-Control: public, max-age=0, must-revalidate` en archivos `.js` y `.css` para aplicar actualizaciones inmediatamente tras cada deploy.
- `express.json({ limit: '64kb' })` para limitar payloads grandes.
- Rate limiter en memoria (`checkRateLimit`) con poda automática y tope `MAX_RATE_LIMIT_ENTRIES = 300`.
- **Protección contra doble clic, red lenta y envíos redundantes:**
  - En `server.js`, el middleware `preventDuplicateSubmit` aplica bloqueo de concurrencia en vuelo (`409`), caché acotada (`MAX_IDEMPOTENCY_ENTRIES = 300`) de respuestas `2xx` por `X-Idempotency-Key` (`X-Idempotent-Replay: true`) y ventana corta anti-duplicados (`dedupeWindowMs`), además de impedir duplicados pendientes en `createEncryptedPcQueue`.
  - En `public/frontend.js`, `runWithButtonLock` (`WeakSet` + `disabled` + `aria-busy` + `.is-busy`) y `submitMutationRequest` bloquean clics múltiples y reutilizan la misma `X-Idempotency-Key` si falla la red sin respuesta; `createRequestTracker` (`AbortController`) descarta lecturas atrasadas y cada formulario bloquea reenvíos idénticos o inválidos (`0` horas de sueño, ediciones de agenda sin cambios o actividades ya agendadas).
- Validación explícita con regex (`FECHA_ISO_REGEX`, `HEX_COLOR_REGEX`, `EMAIL_REGEX`) y conjuntos cerrados (`MOMENTOS_VALIDOS` incluyendo `Madrugada`, `CALIDADES_SUENO_VALIDAS`, `BLOQUES_VALIDOS`).

### 3.4 Recuperación de Contraseña por Correo
- `POST /api/auth/forgot-password` genera token temporal guardado con hash en `CodigosSeguridad` (`tipo='reset'`) y envía enlace con `getResetBaseUrl(req)` usando `APP_BASE_URL` (o `EC2_HOST:PORT` en despliegue).
- Soporta separar la cuenta receptora (`ADMIN_EMAIL`) de la cuenta emisora SMTP (`SMTP_USER`, cuenta Gmail dedicada para envío) + Contraseña de Aplicación de Google (`SMTP_PASS`).

---

## 4. Sincronización Cifrada hacia Word (`sincronitation/sincronizador.py`)

1. En el navegador (`public/frontend.js`), tanto **Journal Notes** como **English Notebook** reutilizan el cifrado cliente AES-CBC (`obtenerLlaveE2EE` / `encriptarTextoE2EE` con `JOURNAL_SECRET_KEY`, formato `iv_hex:mensaje_b64`) antes de enviar al servidor (`POST /api/send-to-pc` y `POST /api/send-english`, ambos exclusivos para `admin`).
2. `server.js` utiliza la fábrica compartida `createEncryptedPcQueue` con dos colas en RAM independientes (tope `MAX_COLA_TEXTOS = 100` c/u, responde `429` si se llenan) sin almacenar notas en MySQL; `GET /api/pull-text` y `GET /api/pull-english` entregan y vacían sus arreglos JSON respectivos.
3. En Windows, `sincronizador.py`:
   - Lee sus variables desde `.env` o descifrando `.env.enc` en memoria RAM (`_descifrar_vault_bytes`, compatible con autoinicio DPAPI).
   - Con `GITHUB_TOKEN` + `GITHUB_REPO`, `obtener_url_aws(endpoint)` consulta `https://api.github.com/repos/<repo>/actions/variables/EC2_HOST` (y `PORT`) cada 5 minutos o inmediatamente si falla la conexión, construyendo dinámicamente tanto `/api/pull-text` como `/api/pull-english` al migrar de IP EC2.
   - Descifra cada texto con `AES.new(LLAVE_SECRETA, AES.MODE_CBC, iv)` (exige 32 bytes UTF-8 en `JOURNAL_SECRET_KEY`).
   - **Journal Notes:** escribe bajo el encabezado diario (`Month DDth D-XXX`) en el `.docx` protegido con `WORD_PASSWORD`.
   - **English Learning Notebook (`english-notes/English_Learning_Notebook.docx`):** usa `DEFAULT_ENGLISH_WORD_PATH` relativo al proyecto (sin requerir cambios al migrar instancia ni entradas nuevas en `.env.enc`, opcionalmente anulable con `ENGLISH_WORD_FILE_PATH`). Mantiene **sin contraseña** 3 secciones ordenadas con `Heading 1` (`1. Glossary & New Words`, `2. Grammar & Usage Notes`, `3. Phrasal Verbs`), inserta cada entrada como `Heading 2` + párrafos descriptivos (`parsear_entrada_ingles` / `formatear_entrada_ingles`), repagina (`doc.Repaginate()`) y actualiza automáticamente la **Tabla de Contenidos (`TablesOfContents`)** al inicio del documento.

---

## 5. Optimizaciones de RAM y Almacenamiento para `t3.micro` (1 GB RAM + 1 GB Swap)

| Componente | Ajuste aplicado | Objetivo en `t3.micro` |
| :--- | :--- | :--- |
| `Dockerfile` | `FROM node:20-alpine`, `NODE_ENV=production`, `npm ci --omit=dev && npm cache clean --force`, copia selectiva (`server.js` y `public/`), `CMD ["node", "--max-old-space-size=128", "server.js"]` | Imagen ligera, sin caché `npm`, tope de heap V8 en 128 MB |
| `.dockerignore` | Excluye `.git`, `.github`, `.env`, `.env.enc`, `.env.*.tmp`, `.env.example`, `node_modules`, `base_datos`, `respaldos`, `sincronitation`, `scripts`, `test`, `tests`, `guides`, `english-notes`, `*.sql.gz`, `*.log` | Contexto de build mínimo |
| `docker-compose.yml` (`db`) | `mem_limit: 512m`, `--performance-schema=OFF`, `--mysqlx=0`, `--skip-log-bin`, `--innodb-buffer-pool-size=32M`, `--innodb-log-buffer-size=4M`, `--max-connections=25`, `--table-open-cache=128`, `--table-definition-cache=256`, `--key-buffer-size=4M`, `--tmp-table-size=8M`, `--max-heap-table-size=8M`, `--thread-cache-size=4` | Recorta consumo base de MySQL 8 y evita acumulación de binlogs en disco |
| `docker-compose.yml` (`app` + logs) | `mem_limit: 220m` en `app`; `logging` con `max-size: "5m"`, `max-file: "2"` en ambos servicios | Techo conjunto de 732 MB para contenedores + logs acotados |
| `server.js` | Pool MySQL (`connectionLimit: 4`, `maxIdle: 2`, `idleTimeout: 60000`, `enableKeepAlive: false`), estáticos con `etag: true, maxAge: '10m'`, poda de `rateLimitStore` (`300`), cola PC acotada (`100`), limpieza de sesiones/códigos vencidos cada 6h | Evita fugas de memoria y crecimiento ilimitado en MySQL |
| `.github/workflows/deploy.yml` | `$DOCKER_CMD image prune -f` y `$DOCKER_CMD builder prune -f --filter "until=24h"` tras cada deploy | Evita que builds repetidos llenen el disco EBS |

---

## 6. Despliegue Automatizado Cero-`.env` y Respaldos Nocturnos

### 6.1 Flujo en `.github/workflows/deploy.yml`
1. Instala paquetes faltantes en instancia nueva (`git`, `curl`, `rclone`, `unzip`, `cron`/`cronie`, `openssl`, `docker`), habilita `cron`/`crond`.
2. Clona/actualiza `main` en `~/projects/mood-tracker`.
3. Crea un archivo temporal **exclusivamente en RAM** (`/dev/shm/.mood_deploy_env.XXXXXX`, `0600`) con variables desde **GitHub Secrets/Variables** y un `trap cleanup_deploy_env EXIT INT TERM`.
4. Decodifica `RCLONE_CONF_B64` a `~/.config/rclone/rclone.conf` (`0600`) y limpia la variable `RCLONE_CONF_B64`.
5. Ejecuta `docker compose --env-file "$DEPLOY_ENV_FILE" up -d --build` y `ENV_FILE_OVERRIDE="$DEPLOY_ENV_FILE" ./scripts/restore.sh --if-empty`.
6. Ajusta zona horaria del host (`sudo timedatectl set-timezone "$FINAL_TZ"`, reiniciando `cron`/`crond` si cambió), escribe `~/projects/respaldos/.backup.meta` (**solo nombres no sensibles**: `DB_CONTAINER`, `RCLONE_REMOTE`, `RCLONE_BACKUP_DIR`, `BACKUP_LOCAL_DIR`) y registra el cron `30 3 * * *` (personalizable con `BACKUP_CRON_SCHEDULE`).
7. Destruye el temporal de `/dev/shm` y cualquier `.env` residual (`SEAL_ENV_AFTER_DEPLOY` asume `true` por defecto).

### 6.2 Respaldo en modo sellado (`scripts/backup.sh` y `scripts/restore.sh`)
- `load_env_file` usa asignación local (`printf -v`) sin `export` y limpia `unset RCLONE_BACKUP_DIR RCLONE_REMOTE RCLONE_CONF_B64` antes de llamar a `rclone`, evitando que `rclone` interprete `RCLONE_BACKUP_DIR` como su flag `--backup-dir`.
- Cuando no existe `.env` en el servidor, `backup.sh` entra en **modo sellado (`SEALED_MODE=1`)**: carga `.backup.meta` y ejecuta `mysqldump` dentro de `mood_db` usando `$MYSQL_ROOT_PASSWORD` y `$MYSQL_DATABASE` del entorno vivo del contenedor, valida el archivo con `gzip -t` y lo sube con `rclone`.

---

## 7. Rama `main` Protegida, Pruebas Automatizadas y Bóveda Local

* **CI en GitHub Actions (`.github/workflows/ci.yml`):** se ejecuta en `push` a ramas distintas de `main`, en `pull_request` hacia `main` y manualmente. Valida sintaxis nativa (`node --check`, `bash -n`, Python `ast.parse` cuando existe el archivo, `ruby -ryaml`), ejecuta `tests/*.test.js` y genera un resumen Markdown en `$GITHUB_STEP_SUMMARY` mediante `tests/ci-summary.js`.
* **Pruebas (`tests/`):** verifican sintaxis, idioma inglés y vista `view-english` en HTML, balance CSS, `init.sql`, `.gitignore`/`.dockerignore` (`english-notes`), `Dockerfile`/`docker-compose.yml`, consistencia de `deploy.yml`/`ci.yml`, pool MySQL, cabeceras HTTP, `bcrypt`, RBAC, `Madrugada`, colas `/api/send-to-pc` y `/api/send-english` + drenado en `/api/pull-english`, cifrado/descifrado de la bóveda local y formateo/enrutado de `sincronizador.py` (`tests/local-vault.test.js`).
* **Bóveda local en Windows (`scripts/local-vault.js`):** cifra `.env` → `.env.enc` con el formato estándar OpenSSL (`Salted__`, PBKDF2-HMAC-SHA256 de 600,000 iteraciones, AES-256-CBC + PKCS#7) usando solo módulos nativos de Node.js, destruye `.env` sobrescribiéndolo con ceros, y permite ejecutar cualquier comando (`run`) o correr `sincronizador.py` descifrando `.env.enc` únicamente en memoria RAM.
