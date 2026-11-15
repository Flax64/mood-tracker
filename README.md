# Personal Daily Hub

Aplicación web full-stack responsiva (adaptada para PC y dispositivos móviles como OPPO A79) para el control personal diario: seguimiento de estado de ánimo (`Mood Tracker`), control de sueño, diario privado cifrado E2EE, cuaderno de aprendizaje de inglés, agenda semanal dividida en **Universidad / Personal** con flujo tipo Jira (**To Do / In Progress / Done**), y sistema de recordatorios automáticos con entrega directa a la barra de notificaciones del celular (`ntfy`) y panel dedicado de **Configuración (`Settings`)**.

---

## 📑 Índice de Contenidos

* [✨ Funcionalidades Principales](#-funcionalidades-principales)
* [🛠️ Tecnologías Utilizadas](#️-tecnologías-utilizadas)
* [📁 Estructura del Proyecto](#-estructura-del-proyecto)
* [📚 Guías del Proyecto](#-guías-del-proyecto)
* [🗄️ Base de Datos (`init.sql` y Migración Automática)](#️-base-de-datos-initsql-y-migración-automática)
* [🚀 Instalación y Ejecución (Entorno Local / Docker)](#-instalación-y-ejecución-entorno-local--docker)
* [📡 Endpoints de la API](#-endpoints-de-la-api)
* [☁️ Respaldos Automáticos en Google Drive desde AWS EC2](#️-respaldos-automáticos-en-google-drive-desde-aws-ec2)
* [🔄 Migración Automática a una Nueva Instancia AWS EC2 (Sin tocar código)](#-migración-automática-a-una-nueva-instancia-aws-ec2-sin-tocar-código)
* [🔒 Encriptar `.env` en el servidor con contraseña maestra (`scripts/env-vault.sh`)](#-encriptar-env-en-el-servidor-con-contraseña-maestra-scriptsenv-vaultsh)

---

## ✨ Funcionalidades Principales

La aplicación cuenta con una **interfaz principal (`Inicio`)**, una **bandeja interactiva de recordatorios activos (`#reminderTray`)** y una **barra lateral fija en el lado izquierdo**, desplegable tanto en PC (plegable a barra compacta) como en celular (menú tipo *drawer*), organizando cada módulo en su vista:

1. **🧭 Inicio (Interfaz Principal):** Resumen rápido del día actual (estados de ánimo registrados hoy, horas de sueño y desglose de actividades **University / Personal** y su avance **To Do / In Progress / Done**), bandeja de recordatorios activos con botones para posponer (*Snooze*) o completar al instante, y accesos directos a todos los módulos (incluyendo **Settings**).
2. **🧠 Estado de Ánimo (`Mood Tracker`):** Registro diario por momento del día (**`Madrugada` `00:00–05:59`**, **`Morning` `06:00–11:59`**, **`Noon` `12:00–13:59`**, **`Afternoon` `14:00–19:59`**, **`Night` `20:00–23:59`**) con 16 estados y colores, validando la ventana de tiempo desde el servidor y recordatorios automáticos a mitad de cada horario (`09:00`, `13:00`, `17:00`, `22:00`; **`Madrugada 03:00` es opcional** y viene desactivado por defecto). Al tocar una notificación pendiente, el sistema autoselecciona la fecha y bloque exactos a registrar.
3. **⚠️ Bitácora Clínica de Crisis (`Crisis Log`):** Registro rápido de episodios agudos (estrés, ira/rabia, ansiedad, pánico, sobrecarga) con **fecha**, **hora exacta (`HH:MM`)**, **intensidad 1–5** y **motivo en español**, visible también en modo **solo lectura** para el psiquiatra/psicóloga dentro del Resumen Semanal (`Ctrl + Enter` guarda al instante).
4. **🌙 Control de Sueño:** Cálculo automático de horas dormidas en **formato normal de horas y minutos (`7h 30m` / `7 hrs 30 min`)**, calidad (`Good`, `Fair`, `Bad`), soporte de sueño intermitente/siestas y recordatorio matutino configurable con opción de posponer (*Snooze 15m / 30m / 1h*).
5. **🖋️ Journal Notes:** Diario en inglés con corrector ortográfico nativo y cifrado de extremo a extremo (AES via CryptoJS) en el navegador antes de encolarse hacia [`sincronitation/sincronizador.py`](sincronitation/sincronizador.py) para escribir en Word.
6. **📖 Language Learning Studio (`English` · `한국어 Korean` · `🎵 K-Pop EN+KR` + `Gemini AI` + Traductor Global):** Cuaderno multilingüe (extensible a futuros idiomas) con vocabulario, gramática, *phrasal verbs/expressions*, transliteración automática **Hangul → Revised Romanization**, **Memoria Persistente (`Memory Bank`)**, **conocimiento automático de tu repertorio musical registrado**, atajos `Enter` / `Ctrl+Enter` y asistente de IA optimizado para AWS `t3.micro` (**Google Gemini API** a 0 MB RAM locales + **motor lingüístico local instantáneo sin conexión** para analizar letras mixtas inglés+coreano de K-Pop). Todo se sincroniza cifrado E2EE hacia tu Word local (`english-notes/English_Learning_Notebook.docx`) con tabla de contenido autogenerada:
   - **🌐 Traductor Bilingüe Global (Cajón Flotante Movible + Ventana tipo Extensión `/translator-popup.html` + `Alt+T`):** Traduce al instante Inglés ↔ Español y Coreano ↔ Inglés/Español (con romanización Hangul y explicación en español) desde cualquier pantalla mediante el botón flotante `🌐`, el menú lateral, `Alt+T` o en su **ventana emergente independiente** junto a YouTube, PDFs o Word; el cajón flotante puede **arrastrarse por la barra superior (`⋮⋮`)** para no tapar el contenido (con botón `↺` para restablecer posición y caja amplia multilínea unificada con el resto de la app).
   - **🎵 Learn with Music + Álbumes CRUD + Letras en Word PC (0 KB BD):** Crea Álbumes / Mini Álbumes vacíos (`+ New Album`), navega por listas/pistas ordenadas, usa **Auto-fill** inteligente (canción, artista, colaboradores, álbum, año y `embeddable`), reproduce dentro de la app mediante **Mini Player `yt-dlp`**, y conecta de forma cifrada (**E2EE + HMAC site-to-site**) con [`sincronitation/sincronizador.py`](sincronitation/sincronizador.py) para cargar/extraer letras automáticamente en tu PC y organizarlas en `4. Songs & Music Study → Álbum/Lista → Pista ordenada` junto con los aprendizajes automáticos de la IA (quedando cifrados en RAM EC2 cuando tu PC está offline).
7. **🗓️ Agenda Semanal (`Organize Your Week`):** Planificador semanal pastel dividido en:
   - **Tipos de actividad:** **Evento** (`evento`: clases, citas, reuniones) y **Tarea** (`tarea`).
   - **Dos categorías principales:** **🎓 Universidad** (`universidad`) y **👤 Personal** (`personal`), con filtros rápidos por categoría y tipo, y divisores visuales por categoría dentro de cada bloque del día (**Morning**, **At School / Classes**, **Afternoon**, **Night**).
   - **Flujo tipo Jira:** selector directo e icono de estado **`To Do`** (`todo`), **`In Progress`** (`in_progress`) y **`Done`** (`done`) sincronizados con `completada` y recordatorios anticipados configurables por actividad.
8. **🎓 Horario ITS, Residencias, Trabajo y GPS de Casa:** Control semestral del Instituto Tecnológico de Saltillo (croquis de salones, días inhábiles/vacaciones, auto-sincronización con Agenda), residencias profesionales (500 h), horario laboral, configuración de Casa y actualización GPS desde el celular incluso en HTTP (incluyendo webhook HMAC firmado).
9. **📈 Resumen Semanal:** Matriz semanal de colores de estado de ánimo (Domingo a Sábado, incluyendo `Madrugada`), tarjetas de sueño/desvelos (`3:00 AM`, noches sin dormir y motivo) y bitácora clínica de crisis.
10. **⚙️ Configuración (`Settings`):** Vista dedicada para gestionar notificaciones en la barra del celular (**`ntfy`** sin requerir HTTPS ni notificaciones en la computadora), horarios y reglas de recordatorios (Estado de ánimo, `Madrugada` opcional, Sueño, Agenda, revisión nocturna de notas Word, estudio de inglés opcional), **Google Gemini API Key / Modelo**, valores predeterminados de agenda, zona horaria IANA, **idioma completo de la interfaz (`English` ↔ `Español`)** y administración de la clave local E2EE de 32 caracteres.
11. **🩺 Autenticación, Seguridad y Permisos por Rol (`admin` vs `psiquiatra`):**
   - **Propietario (`admin` — `ADMIN_EMAIL`):** Acceso completo a todos los módulos, recordatorios, configuración y gestión de cuentas psiquiátricas con activación/desactivación (`#view-medico`).
   - **Psiquiatra (`psiquiatra`):** Acceso estrictamente de **solo lectura** limitado a **Resumen Semanal** de ánimo, sueño/desvelos y crisis (`#view-resumen`); bloqueado por RBAC (`403`) en agenda, notas, traductor, configuración y recordatorios.
   - **Sesión persistente:** Permanece activa mediante cookie `HttpOnly; SameSite=Lax` y tabla `SesionesAuth` hasta cerrar sesión (**Sign Out**) o hasta el **domingo `00:00`**.
   - **Transporte de Red Cifrado sobre HTTP ("HTTPS Simulado"):** Túnel híbrido **`X25519 (Curve25519 ECDH) + HKDF-SHA256 + AES-256-CTR + HMAC-SHA256 (Encrypt-then-MAC)`** (`public/transport-crypto.js` ↔ `lib/transport-crypto.js`) que cifra en el navegador las peticiones y respuestas `/api/*` incluso en orígenes HTTP (`http://IP:3000`) con *Forward Secrecy*, detección de manipulación y alto rendimiento para payloads grandes.
   - **Seguridad Checklist U2:** Contraseñas con `bcryptjs` (12 rondas), tokens SHA-256, cabeceras HTTP de seguridad (`CSP`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Cache-Control: no-store`), *rate limiting* multicapa en API/Auth/acciones de recordatorio, protección SSRF en URLs de notificación/YouTube, idempotencia (`X-Idempotency-Key` + locks en botones), MFA opcional y recuperación por correo (`nodemailer`).
12. **🌙 Modo Oscuro Permanente, Bilingüe Integral (`EN` ↔ `ES`) y Guía Visual Interactiva (`📖 Visual Guide`):**
   - **Modo Oscuro Permanente (`data-theme="dark"`):** Se eliminó el modo claro para mantener uniformidad visual en todas las pantallas (SPA principal, Auth, Traductor flotante, Popup y Guía Visual) mediante [`public/theme-init.js`](public/theme-init.js) sin parpadeo al cargar.
   - **Cambio de Idioma Completo (`public/i18n.js`):** Selector instantáneo **`ES / EN`** en barra lateral, cabecera móvil, login, *Settings* y popup del traductor (`pdh_ui_lang_v1`, sincronizado entre pestañas y propagado al backend vía cabecera `X-UI-Lang` para explicaciones IA/locales) sin alterar claves internas de MySQL ni traducir texto capturado por el usuario (`data-no-i18n="true"`).
   - **Guía Visual Interactiva (`#view-guia` y `/guia-visual.html`):** Manual visual ligero, sin saturación de texto, accesible dentro de la propia aplicación desde **`📖 Visual Guide`** (`[data-view="guia"]` en la barra lateral o tarjeta rápida en *Home*).
13. **🏷️ Historial Automático de Versiones (`SemVer 2.0.0` + `Conventional Commits`):**
   - Cada despliegue a `main` en [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) ejecuta automáticamente [`scripts/release-version.js`](scripts/release-version.js) y calcula la siguiente versión siguiendo el estándar **`MAJOR.MINOR.PATCH`**:
     - `fix:` / `chore:` / `docs:` / `refactor:` -> **PATCH** (`+0.0.1`, ej. `1.0.0` → `1.0.1`).
     - `feat:` -> **MINOR** (`+0.1.0`, ej. `1.0.1` → `1.1.0`).
     - `BREAKING CHANGE` o `<tipo>!:` -> **MAJOR** (`+1.0.0`, ej. `1.1.0` → `2.0.0`).
   - Actualiza automáticamente `package.json`, `package-lock.json`, `version-history.json`, [`CHANGELOG.md`](CHANGELOG.md), crea tag Git `vX.Y.Z` + GitHub Release y expone el endpoint **`GET /api/version`** junto al modal interactivo **🏷️ Historial de Versiones** en la barra lateral y en *Settings*.

---

## 🛠️ Tecnologías Utilizadas

* **Frontend:** HTML5, CSS3 responsivo (barra lateral fija colapsable, bandejas de recordatorios, filtros por categoría/tipo, selectores tipo Jira, **Tema Oscuro** y cuadrícula pastel semanal) y JavaScript (Vanilla + CryptoJS para cifrado AES).
* **Backend:** Node.js 20, Express 5 (`server.js`), `mysql2` (Pool de conexiones), `bcryptjs`, `nodemailer`, `cors`, `dotenv`, `fetch` nativo para puente HTTPS de notificaciones móviles (`ntfy`).
* **Base de Datos:** MySQL 8.0 (13 tablas: `RegistrosMood`, `RegistrosSleep`, `RegistrosCrisis`, `RegistrosAgenda`, `Usuarios`, `SesionesAuth`, `CodigosSeguridad`, `ConfiguracionUsuario`, `RecordatoriosEstado`, `MusicaArtistas`, `MusicaAlbumes`, `MusicaCanciones`, `MusicaCancionArtistas`).
* **Sincronización PC (Journal & English):** Python (`sincronitation/sincronizador.py`) con `pycryptodome`, `pywin32` y `python-docx`.
* **Calidad y DevOps:** Node Test Runner (`tests/*.test.js`), GitHub Actions (`.github/workflows/ci.yml` y `deploy.yml`), Docker / Docker Compose en AWS EC2, bóveda `.env.enc` (`scripts/env-vault.sh` / `scripts/local-vault.js`) y respaldo automático a Google Drive con `rclone` (`scripts/backup.sh`).

---

## 📁 Estructura del Proyecto

```text
mood-tracker/  # o personal-daily-hub/ en Windows
├── .github/
│   └── workflows/
│       ├── ci.yml                  # Pruebas automatizadas y sintaxis en ramas/PR hacia main
│       └── deploy.yml              # CI/CD automático hacia AWS EC2
├── base_datos/
│   └── Diseño Base Datos.xml       # Modelo visual de base de datos
├── english-notes/                  # Cuaderno Word de inglés autogenerado si no existe (ignorado en Git/Docker)
│   └── English_Learning_Notebook.docx
├── guides/                         # Documentación funcional, técnica y operativa (con índice rápido)
│   ├── MANUAL_DE_USUARIO.md
│   ├── GUIA_OPERACION_Y_MIGRACION.md
│   └── GUIA_TECNICA_ARQUITECTURA.md
├── public/                         # Archivos estáticos servidos por Express
│   ├── index.html                  # Shell principal, guía visual (#view-guia), traductor, Agenda Jira y Settings
│   ├── guia-visual.html            # Pantalla visual interactiva independiente (/guia-visual.html)
│   ├── guia-visual.js              # Controlador visual sin texto pesado (CSP-safe, montado inline y standalone)
│   ├── i18n.js                     # Motor bilingüe integral EN <-> ES (pdh_ui_lang_v1 + MutationObserver)
│   ├── translator-popup.html       # Ventana emergente independiente del Traductor Bilingüe (tipo extensión)
│   ├── translator-widget.js        # Controlador compartido del traductor (cajón flotante movible y popup)
│   ├── translator-popup.js         # Inicialización, selector EN/ES y handoff al Word desde la ventana emergente
│   ├── dashboard.html              # Redirección compatible hacia index.html#resumen
│   ├── theme-init.js               # Enfuerza Modo Oscuro permanente + pre-carga idioma EN/ES (CSP-safe)
│   ├── transport-crypto.js         # Cliente X25519 + HKDF-SHA256 + AES-256-CTR + HMAC-SHA256 en navegador HTTP
│   ├── style.css                   # Estilos en modo oscuro permanente, pill EN/ES, guía visual y Agenda Jira
│   └── frontend.js                 # Navegación, túnel cifrado, E2EE, AI Studio, agenda/horario y settings
├── lib/                            # Módulos backend desacoplados (0 dependencias extra)
│   ├── transport-crypto.js         # Gestor OpenSSL X25519 + AES-256-CTR-HMAC en Node.js
│   ├── language-studio.js          # Registro multilingüe, Romanización Hangul, traductor y Gemini API
│   ├── youtube-metadata.js         # Parser de álbum/artista/año/embeddable YT/YT Music y limpiador .srt/.vtt/.lrc
│   └── ytdlp-service.js            # Streaming multimedia 206 seguro y extractor de subtítulos yt-dlp sin BD
├── scripts/
│   ├── backup.sh                   # Script de respaldo MySQL -> Google Drive (rclone)
│   ├── env-vault.sh                # Cifrado AES-256-CBC (PBKDF2) de .env en el servidor EC2
│   ├── local-vault.js              # Bóveda local en Windows (.env <-> .env.enc y autoinicio DPAPI)
│   ├── release-version.js          # Versionador automático SemVer 2.0.0 + Conventional Commits en deploy
│   └── restore.sh                  # Script de restauración automática desde Google Drive
├── sincronitation/                 # Scripts locales en Windows (ignorados en Git/Docker)
│   ├── sincronizador.py            # Cliente local Windows para Journal (.docx protegido) y English (.docx)
│   ├── yt_lyrics_helper.py         # Extractor PC de subtítulos/CC de YouTube con yt-dlp local y portapapeles UTF-8
│   └── historial.log               # Bitácora del sincronizador
├── tests/                          # Suite automatizada con node:test (sin BD real requerida)
│   ├── ci-summary.js               # Resumen Markdown de pruebas para GitHub Actions
│   ├── local-vault.test.js         # Pruebas de cifrado local e interoperabilidad Python
│   ├── server.integration.test.js  # Pruebas API, RBAC, Rate Limit, Agenda Jira, Música, IA y GPS
│   ├── syntax-and-config.test.js   # Verificación de sintaxis, CSS, SQL, HTML, docs y CI/CD
│   └── youtube-metadata.test.js    # Pruebas unitarias de metadatos YouTube / YT Music y limpieza .vtt/.lrc
├── .dockerignore                   # Exclusiones del contexto Docker (incluye tests/, guides/, .env*)
├── .env                            # Variables de entorno temporales (no versionado; usar .env.enc)
├── .env.enc                        # Bóveda cifrada local de variables de entorno
├── .env.example                    # Plantilla de variables de entorno requeridas
├── .gitignore
├── docker-compose.yml              # Orquestación de MySQL 8.0 (512m) + Node.js (220m)
├── Dockerfile                      # Imagen node:20-alpine optimizada para EC2 t3.micro
├── init.sql                        # Esquema inicial completo de las 13 tablas MySQL
├── package.json                    # Dependencias Node y script "npm test"
├── package-lock.json
├── README.md                       # Documentación principal del proyecto (este archivo)
└── server.js                       # Backend Express, API REST, RBAC, Rate Limiting y Scheduler ntfy
```

---

## 📚 Guías del Proyecto

* [Manual de Usuario (Paso a Paso)](guides/MANUAL_DE_USUARIO.md) y **Guía Visual dentro de la app (`📖 Visual Guide` / `/guia-visual.html`)**: explicación visual interactiva de cada pantalla (`Home`, `Mood`, `Sleep` y registro de desvelo, `Journal E2EE`, `English Notebook` + **Traductor Bilingüe Global** con acceso flotante/`Alt+T`/`/translator-popup.html`, `Learn with Music` con Mini Player `yt-dlp` + letras en Word PC, `Weekly Agenda`, selector `EN ↔ ES` y notificaciones `ntfy`).
* [Guía Técnica de Arquitectura e Implementación](guides/GUIA_TECNICA_ARQUITECTURA.md): diseño por capas, esquema MySQL (13 tablas), seguridad E2EE/RBAC, optimizaciones para `t3.micro` y flujo CI/CD.
* [Guía de Operación, Bóveda Local y Migración EC2](guides/GUIA_OPERACION_Y_MIGRACION.md): gestión de `.env.enc`, sincronizador de Word en Windows (`sincronizador.py`), reinicio/autoinicio tras apagar o reiniciar Windows, autogeneración de `English_Learning_Notebook.docx`, extractor `yt-dlp` (`yt_lyrics_helper.py`), respaldos con `rclone` y migración EC2.

---

## 🗄️ Base de Datos (`init.sql` y Migración Automática)

El archivo `init.sql` define **13 tablas principales** (y `server.js` crea/migra automáticamente al arrancar las columnas o tablas faltantes sin perder datos):

* **`RegistrosMood`**: `id`, `fecha`, `momento_dia` (`Madrugada`, `Morning`, `Noon`, `Afternoon`, `Night`), `estado_animo`, `color_hex`, `fecha_registro` (`UNIQUE(fecha, momento_dia)`).
* **`RegistrosSleep`**: `id`, `fecha`, `horas`, `calidad`, `hora_dormir`, `hora_despertar`, `es_desvelo`, `tipo_registro`, `motivo_desvelo`, `fecha_registro`.
* **`RegistrosCrisis`**: `id`, `fecha`, `hora`, `tipo_crisis`, `intensidad` (`1..5`), `motivo` (texto en español), `fecha_registro`.
* **`RegistrosAgenda`**: `id`, `fecha`, `bloque` (`manana`, `cole`, `tarde`, `noche`), `hora`, `actividad`, `tipo` (`evento`, `tarea`), `categoria` (`universidad`, `personal`), `materia_id`, `materia_nombre`, `estado` (`todo`, `in_progress`, `done`), `completada`, `recordatorio_min`, `fecha_registro`.
* **`Usuarios`**: `id`, `nombre`, `email`, `password_hash` (bcrypt), `rol` (`admin` o `psiquiatra`), `estado` (`activo`, `inactivo`, `suspendido`), `fecha_registro`.
* **`SesionesAuth`**: `id`, `usuario_id`, `token_hash` (SHA-256), `expira_en` (próximo domingo `00:00`), `creado_en`.
* **`CodigosSeguridad`**: `id`, `email`, `tipo` (`registro`, `reset`, `mfa`), `token_hash` (SHA-256), `expira_en`, `usado`, `creado_en`.
* **`ConfiguracionUsuario`**: `usuario_id` (PK / FK), `config_json` (`LONGTEXT` con configuración de `ntfy`, casa/ubicación manual + modo móvil GPS/Wi-Fi y reglas de recordatorios), `actualizado_en`.
* **`RecordatoriosEstado`**: `id`, `usuario_id`, `clave_unica`, `tipo`, `ref_id`, `titulo`, `mensaje`, `estado` (`active`, `snoozed`, `sent`, `dismissed`), `snooze_hasta`, `enviado_push_en`, `actualizado_en`.
* **`MusicaArtistas`**: `id`, `usuario_id`, `nombre`, `nombre_normalizado`, `tipo_artista` (`solo`, `group`, `duo`, `collab_project`), `notas_cortas`, `creado_en`.
* **`MusicaAlbumes`**: `id`, `usuario_id`, `artista_principal_id`, `titulo`, `titulo_normalizado`, `tipo_lanzamiento` (`album`, `mini_album`, `ep`, `single`, `ost`, `collab_single`), `anio`, `notas_cortas`, `creado_en`.
* **`MusicaCanciones`**: `id`, `usuario_id`, `album_id`, `titulo`, `numero_pista`, `idioma`, `yt_music_url`, `yt_video_id`, `thumbnail_url`, `estado_estudio` (`to_study`, `in_progress`, `mastered`), `enfoque_corto`, `word_sincronizado`, `ultimo_estudio_en`, `creado_en`, `actualizado_en`.
* **`MusicaCancionArtistas`**: `cancion_id`, `artista_id`, `rol` (`main`, `feat`, `collab`, `producer`), `orden` (`PRIMARY KEY (cancion_id, artista_id)`).

### Esquema / migración manual de `RegistrosAgenda` en AWS EC2

> `server.js` aplica automáticamente `SHOW COLUMNS FROM RegistrosAgenda` + `ALTER TABLE` al iniciar (`inicializarTablasSeguridad()`). Si deseas inspeccionar o aplicar manualmente en MySQL dentro de EC2:

```bash
cd /home/ubuntu/projects/mood-tracker
set -a && source .env && set +a

docker exec -i mood_db mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" <<'EOF'
CREATE TABLE IF NOT EXISTS RegistrosAgenda (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fecha DATE NOT NULL,
    bloque VARCHAR(30) NOT NULL,
    hora TIME NOT NULL,
    actividad VARCHAR(255) NOT NULL,
    tipo ENUM('evento', 'tarea') NOT NULL DEFAULT 'evento',
    categoria ENUM('universidad', 'personal') NOT NULL DEFAULT 'personal',
    materia_id VARCHAR(60) NULL DEFAULT NULL,
    materia_nombre VARCHAR(120) NULL DEFAULT NULL,
    estado ENUM('todo', 'in_progress', 'done') NOT NULL DEFAULT 'todo',
    completada TINYINT(1) NOT NULL DEFAULT 0,
    recordatorio_min SMALLINT NULL DEFAULT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agenda_fecha (fecha),
    INDEX idx_agenda_categoria_estado (categoria, estado),
    INDEX idx_agenda_materia (materia_id)
);
EOF
```

---

## 🚀 Instalación y Ejecución (Entorno Local / Docker)

1. **Clonar el repositorio:**
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd mood-tracker
   ```

2. **Configurar Variables de Entorno (`.env`):**
   ```env
   DB_HOST=db
   DB_USER=root
   DB_PASS=tu_password
   DB_NAME=MoodTrackerLocal
   PORT=3000
   ```

3. **Construir y levantar los contenedores:**
   ```bash
   docker compose up -d --build
   ```

4. **Acceder a la aplicación:**
   Abre `http://localhost:3000` (o la IP/dominio de tu instancia en el puerto `3000`).

---

## 📡 Endpoints de la API

### Estado de Ánimo
* `POST /api/insert-mood`: Registra o actualiza (si está dentro de su rango horario del mismo día) un estado de ánimo.
  * Body: `{ "fecha": "2026-11-13", "momento_dia": "Morning", "estado_animo": "Happy", "color_hex": "#FDE047" }`
* `GET /api/get-moods?begin=YYYY-MM-DD&end=YYYY-MM-DD`: Devuelve `{ fecha, momento_dia, color_hex }` en el rango.

### Control de Sueño, Desvelos y Bitácora de Crisis
* `POST /api/insert-sleep`, `PUT /api/update-sleep/:id` y `DELETE /api/delete-sleep/:id`: Registra o ajusta sueño normal, desvelos (`3:00 AM`, `goingToSleepNow` + `Complete Wake-Up`) o noches sin dormir (`0 hrs`) con motivo clínico opcional (`admin`).
* `GET /api/get-sleep?begin=YYYY-MM-DD&end=YYYY-MM-DD`: Devuelve sueño, horarios y detalles de desvelo (`admin` y `psiquiatra` solo lectura).
* `POST /api/insert-crisis`, `GET /api/get-crisis[?begin=YYYY-MM-DD&end=YYYY-MM-DD]` y `DELETE /api/delete-crisis/:id`: Bitácora de crisis (`Estrés`, `Ira / Rabia`, `Ansiedad`, `Pánico`, etc.) con fecha, hora (`HH:MM`), intensidad `1..5` y motivo en español (lectura permitida al psiquiatra).

### Journal Notes, Language Learning Studio, Traductor Global & Music
* `POST /api/send-to-pc` y `GET /api/pull-text`: Cola E2EE para el diario privado protegido con contraseña.
* `POST /api/send-english` y `GET /api/pull-english`: Cola E2EE para el cuaderno Word local multilingüe (`1. Glossary & New Words`, `2. Grammar & Usage Notes`, `3. Phrasal Verbs` y `4. Songs & Music Study`).
* `GET /api/language/registry` y `GET /api/language/memory`: Registro de idiomas (`en`, `ko`, `en_ko`), modelos Gemini y memoria léxica persistente.
* `POST /api/language/romanize`, `POST /api/language/analyze` y `POST /api/language/translate`: Transliteración Hangul instantánea, análisis bilingüe EN/KR con reconocimiento de repertorio musical, y **traductor rápido EN↔ES y KO↔EN/ES** usado tanto en el estudio como en el panel flotante (`Alt+T`) y `/translator-popup.html`.
* `GET /api/english/music/catalog`, `GET /api/english/music/search?q=...` y `POST /api/english/music/resolve`: Catálogo, búsqueda segura y auto-completado inteligente desde YouTube / YouTube Music (título limpio, artista, colaboradores, álbum, año, tipo de lanzamiento y bandera `embeddable`).
* `POST /api/english/music/albums`, `PATCH /api/english/music/artists/:id`, `PATCH /api/english/music/albums/:id`, `DELETE /api/english/music/albums/:id`, `POST/PATCH/DELETE /api/english/music/songs...`, `GET /api/english/music/songs/:id/media` y puente E2EE `/api/english/music/pc-jobs*`: CRUD completo, stream directo `yt-dlp` y puente cifrado HMAC/AES hacia Word PC (0 KB de letras en MySQL).

### Horario ITS, Casa y GPS del Teléfono en HTTP
* `GET /api/planner/state`, `PUT /api/planner/state` y `POST /api/planner/sync-agenda`: Semestres ITS, croquis de salones, vacaciones, residencias profesionales, trabajo y sincronización automática con Agenda.
* `POST /api/planner/resolve-location`, `POST /api/planner/request-phone-gps`, `GET /api/planner/phone-gps-token`, `POST /api/planner/phone-gps-token/rotate` y `GET/POST /api/planner/phone-location?token=...`: Resolución anti-Null-Island (`(0,0)`), geocodificación Saltillo y captura GPS por webhook HTTP HMAC.

### Transporte Híbrido Cifrado ("HTTPS Simulado" sobre HTTP)
* `POST /api/transport/handshake`: Intercambio efímero **X25519 (Curve25519 ECDH) + HKDF-SHA256** que establece `encKey` y `macKey` simétricas en RAM (TTL 12h).
* `GET /api/transport/status`: Estado del túnel, conteo de mensajes cifrados y rechazo HMAC/replay.
* `POST /api/transport/benchmark`: Prueba en vivo de rendimiento y verificación SHA-256 sobre payloads grandes (`1 KB` – `192+ KB`) cifrados con **AES-256-CTR + HMAC-SHA256**.

### Agenda Personal Semanal (Eventos, Tareas y Estados Jira)
* `GET /api/get-agenda?begin=YYYY-MM-DD&end=YYYY-MM-DD`: Lista actividades con `tipo` (`evento`/`tarea`), `categoria` (`universidad`/`personal`), `materia_id`/`materia_nombre` (vinculación con materias actuales cuando es universitaria), `estado` (`todo`/`in_progress`/`done`), `completada` y `recordatorio_min`.
* `POST /api/insert-agenda`: Crea un evento o tarea (`{ "fecha", "bloque", "hora", "actividad", "tipo", "categoria", "materia_id", "estado", "recordatorio_min" }`). Si `categoria === 'personal'`, `materia_id`/`materia_nombre` se descartan automáticamente.
* `PUT /api/update-agenda/:id`: Actualiza todos los campos de un evento o tarea.
* `PATCH /api/toggle-agenda/:id`: Cambia directamente el estado Jira (`{ "estado": "todo" | "in_progress" | "done" }`) o alterna `completada`, descartando recordatorios si pasa a `done`.
* `DELETE /api/delete-agenda/:id`: Elimina una actividad por `id`.

### Configuración Personal y Recordatorios (`Settings` & Móvil `ntfy`)
* `GET /api/settings`: Obtiene la configuración del usuario `admin` (reglas de recordatorios, horario de sueño/Word/inglés, `Madrugada` opcional, `ntfy`).
* `GET /api/version`: Devuelve la versión activa y el historial automático de despliegues (`SemVer 2.0.0`) desde `version-history.json` / `package.json` para el modal **🏷️ Version History**.
* `PUT /api/settings`: Valida y guarda preferencias personales en `ConfiguracionUsuario` (protegido contra SSRF en URLs de push).
* `POST /api/settings/test-notification`: Envía una notificación de prueba inmediata al tópico `ntfy` configurado en el celular.
* `GET /api/reminders/active`: Evalúa y retorna recordatorios activos y pospuestos (`active` / `snoozed`) según los registros del día y la configuración vigente.
* `POST /api/reminders/snooze`: Pospone (`snooze`, minutos `1..240`) o descarta (`dismiss`) un recordatorio desde la app web.
* `POST /api/reminders/action?token=...`: Endpoint firmado con token HMAC temporal para ejecutar **Snooze 15m / 30m** o **Mark Done** directamente desde los botones de la barra de notificaciones de Android.

### Autenticación, RBAC y Cuentas Médicas
* `POST /api/auth/request-register-code`, `/api/auth/register`, `/api/auth/login`, `/api/auth/verify-mfa`, `/api/auth/logout`, `/api/auth/me`
* `POST /api/auth/forgot-password` y `/api/auth/reset-password`
* `GET /api/auth/medicos` y `PATCH /api/auth/medicos/:id/estado` (`activo` | `inactivo` | `suspendido`)

---

## ☁️ Respaldos Automáticos en Google Drive desde AWS EC2

La instancia AWS EC2 puede subir respaldos de MySQL directamente a tu Google Drive mediante **`rclone`** y el script [`scripts/backup.sh`](scripts/backup.sh), que ejecuta `mysqldump` sobre el contenedor `mood_db` (respaldando automáticamente todas las tablas, incluida `RegistrosAgenda`) y copia el `.sql.gz` hacia `gdrive:RespaldosApp`.

### Pasos de configuración en AWS EC2
1. Instalar `rclone` en Ubuntu (EC2):
   ```bash
   sudo apt update && sudo apt install -y rclone
   ```
2. Configurar el remoto llamado `gdrive`:
   ```bash
   rclone config
   # n (New remote) -> name: gdrive -> Storage: drive (Google Drive)
   # En "Use web browser to automatically authenticate" elige "n" (EC2 no tiene navegador)
   ```
3. En tu **PC local (Windows)** donde sí tienes navegador (instalando `rclone` en Windows):
   ```powershell
   rclone authorize "drive"
   ```
   Inicia sesión con tu cuenta de Google, acepta los permisos y pega el token JSON generado en la terminal de tu EC2.
4. Dar permisos de ejecución y probar [`scripts/backup.sh`](scripts/backup.sh):
   ```bash
   chmod +x /home/ubuntu/projects/mood-tracker/scripts/backup.sh
   /home/ubuntu/projects/mood-tracker/scripts/backup.sh
   ```
5. Automatizar con `cron` (ej. todos los días a las 3:00 AM):
   ```bash
   crontab -e
   # Agrega la línea:
   0 3 * * * /home/ubuntu/projects/mood-tracker/scripts/backup.sh >> /home/ubuntu/projects/respaldos/backup.log 2>&1
   ```
   *(Nota: al desplegar mediante GitHub Actions, este `cron` se registra automáticamente).*

---

## 🔄 Migración Automática a una Nueva Instancia AWS EC2 (Sin tocar código)

El pipeline [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) está preparado para desplegar en **cualquier instancia EC2 nueva o con cambio de IP pública** sin editar el código fuente.

### 1. Configurar en GitHub (`Settings → Secrets and variables → Actions`)

**En la pestaña `Variables`:**
* `EC2_HOST`: IP pública actual de tu instancia AWS EC2 (es el único dato que cambias cuando cambie tu IP).
* `EC2_USER` *(opcional)*: usuario SSH (por defecto `ubuntu`).
* `PORT` *(opcional)*: puerto HTTP (por defecto `3000`).
* `WORD_FILE_PATH` *(opcional · sincronizador PC)*: ruta `.docx` o carpeta de tu **Journal diario** en Windows (anula `.env`/`.env.enc` en caliente si mueves el archivo de carpeta).
* `ENGLISH_WORD_FILE_PATH` *(opcional · sincronizador PC)*: ruta `.docx` o carpeta de **`English_Learning_Notebook.docx`** en Windows (por defecto `english-notes/English_Learning_Notebook.docx`).
* `YT_DLP_PATH` *(opcional · sincronizador PC)*: ruta hacia `yt-dlp.exe` (o su carpeta) en Windows.

**En la pestaña `Secrets`:**
* `EC2_SSH_KEY`: llave privada SSH (`.pem`) para conectarse a tu instancia EC2.
* `DB_PASS`: contraseña de MySQL.
* `ADMIN_EMAIL` *(opcional, por defecto `flavio.flax1234@gmail.com`)*: correo que recibe permisos de Administrador (`admin`) y los códigos de verificación.
* `ADMIN_SECRET`: clave secreta personal que solo tú conoces para validar tu registro por primera vez.
* `SMTP_USER`: cuenta de Gmail que enviará los correos (ej. `farmacia4850@gmail.com`). Si se omite, usa `ADMIN_EMAIL`.
* `SMTP_PASS`: Contraseña de aplicación de Gmail (16 caracteres, generada en la cuenta configurada en `SMTP_USER` → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones).
* `DB_USER` *(opcional)*: usuario de MySQL (por defecto `root`).
* `DB_NAME` *(opcional)*: nombre de la base de datos (por defecto `MoodTrackerLocal`).
* `DB_HOST` *(opcional)*: host de MySQL en Docker (por defecto `db`).
* `RCLONE_CONF_B64` *(recomendado para restaurar backups en instancias nuevas)*: contenido de `~/.config/rclone/rclone.conf` codificado en Base64:
  ```bash
  base64 -w 0 ~/.config/rclone/rclone.conf
  ```

### 2. ¿Qué ocurre automáticamente al hacer `push` a `main` (o ejecutar `Run workflow`)?
1. Se conecta a la IP indicada en `EC2_HOST` mediante SSH.
2. **Paso `# 0` (primera acción al entrar):** verifica si existe memoria **Swap**; si no hay ninguna activa en la nueva instancia, crea y activa automáticamente **`/swapfile` (1 GB)** en `/etc/fstab` antes de instalar dependencias o compilar contenedores (evitando bloqueos por falta de RAM en `t3.micro`).
3. Si la instancia es nueva, instala automáticamente `git`, `curl`, `rclone`, `docker` y `docker compose`.
3. Clona o actualiza el repositorio en `~/projects/mood-tracker`.
4. Genera automáticamente el archivo `.env` desde tus *GitHub Secrets* y restaura `~/.config/rclone/rclone.conf` desde `RCLONE_CONF_B64`.
5. Levanta los contenedores (`docker compose up -d --build`).
6. Ejecuta [`scripts/restore.sh --if-empty`](scripts/restore.sh): si es una instancia nueva (base de datos vacía), descarga automáticamente `respaldo_mood_tracker.sql.gz` desde Google Drive y restaura todos tus datos previos; si ya tenía datos, los conserva intactos.
7. Registra el `cron` diario de respaldos hacia Google Drive.
8. *(Opcional)* Si defines `SEAL_ENV_AFTER_DEPLOY=true` en GitHub Variables, elimina `.env` en texto plano al finalizar el despliegue.
9. **Auto-versionado SemVer 2.0.0:** Antes de conectar por SSH, el job `release` calcula automáticamente la nueva versión (`MAJOR.MINOR.PATCH`) con [`scripts/release-version.js`](scripts/release-version.js), genera [`CHANGELOG.md`](CHANGELOG.md) + `version-history.json`, etiqueta `vX.Y.Z` con GitHub Release y envía la versión exacta a EC2 para que quede visible dentro de la app.

---

## 🔒 Encriptar `.env` en el servidor con contraseña maestra (`scripts/env-vault.sh`)

Para no dejar credenciales en texto plano dentro del archivo `.env` en tu instancia AWS EC2, utiliza [`scripts/env-vault.sh`](scripts/env-vault.sh), que cifra `.env` → `.env.enc` con **AES-256-CBC + PBKDF2 (600,000 iteraciones, SHA-256)** usando una contraseña que solo tú sabes:

```bash
cd ~/projects/mood-tracker
chmod +x scripts/env-vault.sh

# 1. Cifrar .env en .env.enc y destruir de forma segura el .env en texto plano:
./scripts/env-vault.sh encrypt

# 2. Cuando necesites reiniciar/reconstruir contenedores sin dejar .env en disco
#    (descifra temporalmente solo en memoria RAM /dev/shm y limpia al terminar):
./scripts/env-vault.sh up

# 3. Ejecutar un respaldo a Google Drive manteniendo .env sellado:
./scripts/env-vault.sh backup

# 4. Ver estado actual (.env vs .env.enc):
./scripts/env-vault.sh status
```
