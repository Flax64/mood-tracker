# Personal Mood Tracker & Agenda Personal

Aplicación web full-stack responsiva (adaptada para PC y dispositivos móviles como OPPO A79) para el seguimiento diario del estado de ánimo, control de sueño, notas privadas cifradas E2EE y planificación semanal personal.

---

## ✨ Funcionalidades Principales

La aplicación cuenta con una **interfaz principal (`Inicio`)** al abrirla y una **barra lateral fija en el lado izquierdo**, desplegable tanto en PC (plegable a barra compacta de iconos) como en celular (menú tipo *drawer*), con cada función separada en su propia vista:

1. **🏠 Inicio (Interfaz Principal):** Resumen rápido del día actual (estados de ánimo registrados hoy, horas de sueño y actividades pendientes/completadas en la agenda) más accesos directos a todos los módulos.
2. **😊 Estado de Ánimo (`Mood Tracker`):** Registro diario por momento del día (**`Madrugada` `00:00–05:59`**, **`Morning` `06:00–11:59`**, **`Noon` `12:00–13:59`**, **`Afternoon` `14:00–19:59`**, **`Night` `20:00–23:59`**) con 16 estados y colores, validando la ventana de tiempo modificable desde el servidor.
3. **😴 Control de Sueño:** Cálculo automático de horas dormidas entre hora de dormir y despertar, con registro de calidad (`Good`, `Regular`, `Bad`).
4. **📝 Journal Notes:** Diario en inglés con corrector ortográfico nativo y cifrado de extremo a extremo (AES via CryptoJS) en el navegador antes de encolarse hacia el script local de Python (`sincronitation/sincronizador.py`) para escribir en Word.
5. **📅 Agenda Semanal (`Organiza tu Semana`):** Calendario/agenda visual por semana con diseño en tonos pastel por día y dividido en los 4 bloques del día:
   - ☕ **Por la mañana** (`manana`)
   - 📖 **En el cole** (`cole`)
   - ☀️ **Por la tarde** (`tarde`)
   - 🌙 **Por la noche** (`noche`)
   Permite registrar actividad y hora, marcar actividades completadas, editar/eliminar, alternar vista `Lun - Vie` / `Lun - Dom` y cambiar entre **Vista Día** (optimizada para celular) y **Vista Cuadrícula** (estilo plantilla semanal).
6. **📊 Resumen Semanal:** Matriz semanal de colores de estado de ánimo (Domingo a Sábado, incluyendo `Madrugada`) con leyenda y tarjetas semanales de sueño con detección automática de sueño intermitente.
7. **🔐 Autenticación, Seguridad y Permisos por Rol (`admin` vs `psiquiatra`):**
   - **Propietario (`admin` — `flavio.flax1234@gmail.com`):** Acceso completo a todos los módulos y gestión de la cuenta del psiquiatra (`#view-medico`).
   - **Psiquiatra (`psiquiatra`):** Acceso estrictamente de **solo lectura** limitado al dashboard semanal de **Estado de Ánimo y Horas de Sueño** (`#view-resumen`); sin acceso a notas del Journal, Agenda ni formularios de edición.
   - **Sesión persistente:** Permanece activa aunque cierres la pestaña o el navegador (`HttpOnly` cookie + tabla `SesionesAuth`) y solo se cierra cuando presionas **Cerrar Sesión** en el menú lateral o automáticamente **cada domingo a las `00:00`**.
   - **Seguridad:** Contraseñas encriptadas con `bcrypt` (`bcryptjs`, 12 rondas), tokens de sesión hasheados con SHA-256, cabeceras HTTP de seguridad (`CSP`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`), *rate-limiting* contra fuerza bruta y recuperación de contraseña por correo (`nodemailer` con Gmail SMTP).

---

## 🛠️ Tecnologías Utilizadas

* **Frontend:** HTML5, CSS3 responsivo (barra lateral fija colapsable, diseño móvil *touch-friendly* y cuadrícula pastel semanal) y JavaScript (Vanilla + CryptoJS para cifrado AES).
* **Backend:** Node.js, Express 5 (`server.js`), `mysql2` (Pool de conexiones), `cors`, `dotenv`.
* **Base de Datos:** MySQL 8.0 (`RegistrosMood`, `RegistrosSleep`, `RegistrosAgenda`).
* **Sincronización PC (Journal):** Python (`sincronitation/sincronizador.py`) con `pycryptodome` y `pywin32`.
* **DevOps y Respaldos:** Docker, Docker Compose, GitHub Actions (`.github/workflows/deploy.yml`) en AWS EC2 y respaldo automático a Google Drive con `rclone` (`scripts/backup.sh`).

---

## 📁 Estructura del Proyecto

```text
mood-tracker/
├── .github/
│   └── workflows/
│       └── deploy.yml              # CI/CD automático hacia AWS EC2
├── base_datos/
│   └── Diseño Base Datos.xml       # Modelo visual de base de datos
├── public/                         # Archivos estáticos servidos por Express
│   ├── index.html                  # Shell principal, barra lateral y todas las vistas
│   ├── dashboard.html              # Redirección compatible hacia index.html#resumen
│   ├── style.css                   # Estilos responsivos (PC, OPPO A79 y agenda pastel)
│   └── frontend.js                 # Navegación, formularios, resumen semanal y agenda
├── scripts/
│   ├── backup.sh                   # Script de respaldo MySQL -> Google Drive (rclone)
│   └── restore.sh                  # Script de restauración automática desde Google Drive
├── sincronitation/
│   ├── sincronizador.py            # Cliente local en Windows (lee configuración desde .env)
│   └── historial.log               # Bitácora del sincronizador
├── .env                            # Variables de entorno y contraseñas (no versionado)
├── .env.example                    # Plantilla de variables de entorno requeridas
├── .gitignore
├── docker-compose.yml              # Orquestación de MySQL 8.0 + Node.js
├── Dockerfile
├── init.sql                        # Esquema inicial de tablas MySQL
├── package.json
├── README.md
└── server.js                       # Backend Express y API REST
```

---

## 🗄️ Base de Datos (`init.sql` y Migración en AWS)

El archivo `init.sql` define tres tablas principales:

* **`RegistrosMood`**: `id`, `fecha`, `momento_dia` (`Madrugada`, `Morning`, `Noon`, `Afternoon`, `Night`), `estado_animo`, `color_hex`, `fecha_registro` (`UNIQUE(fecha, momento_dia)`).
* **`RegistrosSleep`**: `id`, `fecha`, `horas`, `calidad`, `fecha_registro`.
* **`RegistrosAgenda`**: `id`, `fecha`, `bloque` (`manana`, `cole`, `tarde`, `noche`), `hora`, `actividad`, `completada`, `fecha_registro`.
* **`Usuarios`**: `id`, `nombre`, `email`, `password_hash` (bcrypt), `rol` (`admin` o `psiquiatra`), `fecha_registro`.
* **`SesionesAuth`**: `id`, `usuario_id`, `token_hash` (SHA-256), `expira_en` (próximo domingo `00:00`), `creado_en`.
* **`CodigosSeguridad`**: `id`, `email`, `tipo` (`registro` o `reset`), `token_hash` (SHA-256), `expira_en`, `usado`, `creado_en`.

### Crear la tabla `RegistrosAgenda` en una instancia AWS EC2 ya existente

> Docker solo ejecuta `init.sql` cuando el volumen `db_data` se crea por primera vez. Si tu instancia AWS ya está corriendo, ejecuta este comando por SSH dentro de tu EC2 para crear la tabla nueva sin perder datos existentes:

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
    completada TINYINT(1) NOT NULL DEFAULT 0,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agenda_fecha (fecha)
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

### Control de Sueño
* `POST /api/insert-sleep`: Inserta un registro de sueño.
  * Body: `{ "fecha": "2026-11-13", "horas": 7.5, "calidad": "Good" }`
* `GET /api/get-sleep?begin=YYYY-MM-DD&end=YYYY-MM-DD`: Devuelve `{ fecha, horas, calidad }` en el rango.

### Journal Notes (PC Word Sync)
* `POST /api/send-to-pc`: Encola un texto cifrado (`{ "texto": "<iv>:<ciphertext>" }`).
* `GET /api/pull-text`: Entrega y vacía la cola de textos pendientes.

### Agenda Personal Semanal
* `GET /api/get-agenda?begin=YYYY-MM-DD&end=YYYY-MM-DD`: Lista las actividades ordenadas por `fecha` y `hora`.
* `POST /api/insert-agenda`: Crea una nueva actividad (`{ "fecha", "bloque", "hora", "actividad" }`).
* `PUT /api/update-agenda/:id`: Actualiza fecha, bloque, hora y descripción de una actividad.
* `PATCH /api/toggle-agenda/:id`: Cambia el estado `completada` (`0` o `1`).
* `DELETE /api/delete-agenda/:id`: Elimina una actividad por `id`.

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

**En la pestaña `Secrets`:**
* `EC2_SSH_KEY`: llave privada SSH (`.pem`) para conectarse a tu instancia EC2.
* `DB_PASS`: contraseña de MySQL.
* `ADMIN_SECRET`: clave secreta personal que solo tú conoces para validar tu registro por primera vez.
* `SMTP_PASS`: Contraseña de aplicación de Gmail (16 caracteres, generada en tu cuenta de Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones) para enviar correos de verificación y enlaces de recuperación de contraseña desde `flavio.flax1234@gmail.com`.
* `DB_USER` *(opcional)*: usuario de MySQL (por defecto `root`).
* `DB_NAME` *(opcional)*: nombre de la base de datos (por defecto `MoodTrackerLocal`).
* `DB_HOST` *(opcional)*: host de MySQL en Docker (por defecto `db`).
* `RCLONE_CONF_B64` *(recomendado para restaurar backups en instancias nuevas)*: contenido de `~/.config/rclone/rclone.conf` codificado en Base64:
  ```bash
  base64 -w 0 ~/.config/rclone/rclone.conf
  ```

### 2. ¿Qué ocurre automáticamente al hacer `push` a `main` (o ejecutar `Run workflow`)?
1. Se conecta a la IP indicada en `EC2_HOST`.
2. Si la instancia es nueva, instala automáticamente `git`, `curl`, `rclone`, `docker` y `docker compose`.
3. Clona o actualiza el repositorio en `~/projects/mood-tracker`.
4. Genera automáticamente el archivo `.env` desde tus *GitHub Secrets* y restaura `~/.config/rclone/rclone.conf` desde `RCLONE_CONF_B64`.
5. Levanta los contenedores (`docker compose up -d --build`).
6. Ejecuta [`scripts/restore.sh --if-empty`](scripts/restore.sh): si es una instancia nueva (base de datos vacía), descarga automáticamente `respaldo_mood_tracker.sql.gz` desde Google Drive y restaura todos tus datos previos; si ya tenía datos, los conserva intactos.
7. Registra el `cron` diario de respaldos hacia Google Drive.
