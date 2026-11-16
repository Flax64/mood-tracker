# Guía de Migración Plug-and-Play (Cloud Agnostic)

## Índice

- [1. Principio de Cero Dependencia de Proveedor](#1-principio-de-cero-dependencia-de-proveedor)
- [2. Preparación de una Nueva Instancia Ubuntu (AWS EC2, GCP o VPS)](#2-preparación-de-una-nueva-instancia-ubuntu-aws-ec2-gcp-o-vps)
- [3. Matriz Completa de Variables de Entorno y GitHub Secrets](#3-matriz-completa-de-variables-de-entorno-y-github-secrets)
- [4. Configuración Automática de HTTPS (Dominio o IP)](#4-configuración-automática-de-https-dominio-o-ip)
- [5. Reconexión del Cliente Local en Windows](#5-reconexión-del-cliente-local-en-windows)

---

## 1. Principio de Cero Dependencia de Proveedor

Todo el repositorio está desacoplado de direcciones IP fijas, correos personales o rutas absolutas. Migrar entre **AWS EC2**, **Google Cloud Platform (`e2-micro`)**, **DigitalOcean**, **Hetzner** u otro VPS Ubuntu requiere únicamente:

1. Levantar una instancia Ubuntu 22.04/24.04 LTS con puertos abiertos `22` (SSH), `80` (HTTP), `443` (HTTPS) y `3000` (opcional si accedes sin proxy).
2. Actualizar la variable `EC2_HOST` (o `SERVER_HOST`) en GitHub Repository Variables o en tu `.env` local.
3. Ejecutar el workflow de **GitHub Actions** (`Deploy to AWS EC2 / VPS`) o correr `docker compose up -d --build`.

---

## 2. Preparación de una Nueva Instancia Ubuntu (AWS EC2, GCP o VPS)

El workflow `.github/workflows/deploy.yml` instala y configura automáticamente desde cero:
1. **Swap de 1 GB (`/swapfile`)**: Protege servidores de 1 GB RAM antes de compilar contenedores.
2. **Dependencias del sistema**: `git`, `curl`, `cron`, `openssl`, `rclone`, Docker y Docker Compose Plugin.
3. **Configuración aislada de `rclone`**: Decodifica en permisos `700`/`600` tanto `RCLONE_CONF_B64` (Drive 1 Clínico) como `STUDY_RCLONE_CONF_B64` (Drive 2 Estudio).
4. **Restauración Automática de MySQL (`scripts/restore.sh --if-empty`)**: Al detectar que el contenedor MySQL nuevo está vacío, descarga `respaldo_mood_tracker.sql.gz` desde Drive 1, importa tus registros recientes y aplica `init.sql` automáticamente.

---

## 3. Matriz Completa de Variables de Entorno y GitHub Secrets

| Variable / Secret | Donde Guardarla | Propósito |
| --- | --- | --- |
| `EC2_HOST` / `SERVER_HOST` | GitHub **Variables** (`vars`) | IP pública o dominio de la nueva instancia (ej. `34.125.10.50` o `miapp.duckdns.org`). |
| `EC2_USER` / `EC2_SSH_KEY` | GitHub **Variables / Secrets** | Usuario SSH (ej. `ubuntu` en AWS o tu usuario Linux en GCP) y llave privada PEM/ED25519. |
| `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME` | Variables + **Secrets** | Credenciales de MySQL (`DB_HOST=db`, `DB_NAME=MoodTrackerLocal`). |
| `ADMIN_EMAIL`, `ADMIN_SECRET` | Variables + **Secrets** | Cuenta administrativa y clave de verificación del propietario (sin valores fijos en código). |
| `SMTP_USER`, `SMTP_PASS` | Variables + **Secrets** | Cuenta Gmail remitente y contraseña de aplicación de 16 caracteres. |
| `WORD_PASSWORD`, `JOURNAL_SECRET_KEY` | **Secrets** | Contraseña de tu documento Word y llave de 32 caracteres para notas cifradas. |
| `RCLONE_REMOTE`, `RCLONE_BACKUP_DIR`, `RCLONE_CONF_B64` | Variables + **Secrets** | **Drive 1 (Clínico)**: remoto, carpeta `RespaldosApp` y `rclone.conf` en Base64. |
| `STUDY_RCLONE_REMOTE`, `STUDY_RCLONE_DIR`, `STUDY_RCLONE_CONF_B64` | Variables + **Secrets** | **Drive 2 (Estudio)**: remoto independiente (`gdrive_study`), carpeta `NotasIdiomas` y su propio `rclone.conf` en Base64. |
| `SITE_ADDRESS`, `APP_BASE_URL` | GitHub **Variables** | `SITE_ADDRESS=:80` (IP directa) o tu dominio HTTPS (ej. `tudominio.duckdns.org`) + `APP_BASE_URL`. |
| `GEMINI_API_KEY` | GitHub **Secrets** | Clave de Google Gemini API (también editable y verificable desde Configuración Web). |

---

## 4. Configuración Automática de HTTPS (Dominio o IP)

El servicio `proxy` (`Caddyfile`) soporta dos modos sin tocar código:

1. **Con Dominio Propio o DuckDNS (Recomendado para OPPO A79)**:
   - Apunta el registro `A` de tu subdominio (ej. `mihub.duckdns.org`) a la nueva IP pública (`EC2_HOST`).
   - Define `SITE_ADDRESS=mihub.duckdns.org` y `APP_BASE_URL=https://mihub.duckdns.org`.
   - Caddy emitirá y renovará certificados Let's Encrypt válidos automáticamente en el puerto `443`, habilitando micrófono (`Web Speech API`) y GPS en celular sin avisos.
2. **Solo por IP sin Dominio**:
   - Deja `SITE_ADDRESS=:80`. El sitio responderá por HTTP en puerto `80` (y `3000` si está abierto), y también en puerto `443` con TLS interno.

---

## 5. Reconexión del Cliente Local en Windows

En tu computadora Windows no necesitas editar ningún script Python:
- Si usas `GITHUB_TOKEN` + `GITHUB_REPO` en tus variables de entorno locales, `sincronizador.py` lee automáticamente la nueva `EC2_HOST` desde GitHub Repository Variables cada vez que arranca o detecta caída de conexión.
- Si conectas manualmente sin GitHub CLI/PAT, solo actualiza la variable de entorno local `EC2_HOST` (o `SERVER_HOST`) con la nueva IP y reinicia el sincronizador.
