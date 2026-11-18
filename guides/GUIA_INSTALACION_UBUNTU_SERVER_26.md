# Guía Paso a Paso: Desinstalar Windows, Instalar Ubuntu Server 26.04 LTS y Desplegar con Tailscale — Personal Daily Hub

> Guía completa para convertir una PC local (ej. Intel Core i7, 8 GB RAM, ~1 TB de almacenamiento) en un **servidor Ubuntu Server 26.04 LTS autónomo**, eliminando Windows por completo, exponiendo la app de forma privada con **Tailscale HTTPS** (`tailscale serve`) y operando **Notas de Idiomas en Google Drive**, **Journal local cifrado con contraseña (`Diario.docx`)** y **`yt-dlp`** sin depender de otra computadora.

---

## Índice

| Paso | Sección |
| :--- | :--- |
| 1 | [1. Respaldo obligatorio antes de borrar Windows](#1-respaldo-obligatorio-antes-de-borrar-windows) |
| 2 | [2. Descargar Ubuntu Server 26.04 LTS y crear USB booteable](#2-descargar-ubuntu-server-2604-lts-y-crear-usb-booteable) |
| 3 | [3. Configurar BIOS / UEFI para servidor 24/7](#3-configurar-bios--uefi-para-servidor-247) |
| 4 | [4. Arrancar el instalador, desinstalar Windows y particionar el disco de 1 TB](#4-arrancar-el-instalador-desinstalar-windows-y-particionar-el-disco-de-1-tb) |
| 5 | [5. Configuración del sistema dentro del instalador (Red, Usuario, OpenSSH)](#5-configuración-del-sistema-dentro-del-instalador-red-usuario-openssh) |
| 6 | [6. Post-instalación: actualizaciones, anti-suspensión y Docker](#6-post-instalación-actualizaciones-anti-suspensión-y-docker) |
| 7 | [7. Instalar Tailscale (acceso privado solo para ti) y Firewall UFW](#7-instalar-tailscale-acceso-privado-solo-para-ti-y-firewall-ufw) |
| 8 | [8. Desplegar Personal Daily Hub en Ubuntu Server](#8-desplegar-personal-daily-hub-en-ubuntu-server) |
| 9 | [9. Backups automáticos, actualización de `yt-dlp` y verificación final](#9-backups-automáticos-actualización-de-yt-dlp-y-verificación-final) |

---

## 1. Respaldo obligatorio antes de borrar Windows

> [!WARNING]
> Al instalar Ubuntu Server usando todo el disco, **Windows y todos los archivos en esa PC se eliminarán de forma irreversible**. Realiza este respaldo en una memoria USB externa o disco externo antes de continuar.

Copia desde tu PC actual (y verifica que abran correctamente):

1. **Tu Diario personal cifrado (`Diario.docx`):**
   * El archivo `.docx` que usabas en `WORD_FILE_PATH` protegido con `WORD_PASSWORD`.
2. **Tu Cuaderno de Idiomas (`English_Learning_Notebook.docx`):**
   * Ubicado en `english-notes/English_Learning_Notebook.docx` (aunque también esté respaldado en Google Drive, guarda una copia de seguridad).
3. **Tus secretos y configuración:**
   * Tu `.env` (o descifra `.env.enc` temporalmente con `node scripts/local-vault.js decrypt` para anotar `DB_PASS`, `ADMIN_EMAIL`, `ADMIN_SECRET`, `WORD_PASSWORD`, `JOURNAL_SECRET_KEY`, `SMTP_USER`, `SMTP_PASS`, `GEMINI_API_KEY`).
   * Tu archivo de configuración de Google Drive (`rclone.conf`, normalmente en `%APPDATA%\rclone\rclone.conf` o generado vía `RCLONE_CONF_B64`).
   * Tus llaves SSH de `.ssh/` si las necesitas.
4. **Cualquier otro documento personal** en *Documentos*, *Descargas*, *Escritorio*, navegadores, etc.

---

## 2. Descargar Ubuntu Server 26.04 LTS y crear USB booteable

Necesitas una memoria USB de al menos **4 GB** (se formateará durante el proceso) y otra computadora (o esta misma PC antes de borrar Windows):

1. **Descarga la ISO oficial de Ubuntu Server 26.04 LTS (64-bit AMD64 / x86_64):**
   * Sitio oficial: `https://ubuntu.com/download/server`
   * Verifica que el archivo sea la edición **Server** (sin entorno gráfico), por ejemplo `ubuntu-26.04-live-server-amd64.iso`.
2. **Graba la ISO en tu memoria USB:**
   * En Windows, descarga **Rufus** (`https://rufus.ie`) o **balenaEtcher**.
   * En **Rufus**:
     * **Dispositivo:** selecciona tu USB.
     * **Elección de arranque:** selecciona la ISO `ubuntu-26.04-live-server-amd64.iso`.
     * **Esquema de partición:** `GPT` (para PCs modernas con UEFI; si es una PC muy antigua sin UEFI usa `MBR`).
     * **Sistema de destino:** `UEFI (no CSM)`.
     * Haz clic en **EMPEZAR** (si pregunta entre *Modo Imagen ISO* o *Modo DD*, cualquiera funciona, *Imagen ISO* suele ser el predeterminado).
3. Cuando termine, expulsa el USB de forma segura.

---

## 3. Configurar BIOS / UEFI para servidor 24/7

Conecta el servidor por **cable Ethernet** al router (muy recomendable frente a Wi-Fi para estabilidad 24/7) e inserta el USB booteable:

1. Enciende o reinicia la PC y presiona repetidamente la tecla de BIOS/Boot Menu (`F2`, `F12`, `Del/Supr`, `F10` o `Esc` según la marca).
2. Dentro del **BIOS/UEFI**:
   * **Desactiva Fast Boot** (si existe) para facilitar arranques/diagnósticos futuros.
   * **Asegura modo UEFI** (recomendado) y modo de disco **AHCI** (evita Intel RST/RAID propietario si el instalador no detecta el disco NVMe/SATA).
   * **Muy importante para servidor en casa — `Restore on AC Power Loss` (o `After Power Loss`):** cámbialo a **`Power On`** (o *Last State*). Así, si se va la luz en tu casa y regresa, la PC encenderá sola automáticamente sin que tengas que apretar el botón.
   * Si es una laptop y la usarás con la tapa cerrada, verifica que tenga buena ventilación.
3. Guarda cambios (`F10`) y arranca desde el **USB** en el Boot Menu.

---

## 4. Arrancar el instalador, desinstalar Windows y particionar el disco de 1 TB

Al elegir **`Try or Install Ubuntu Server`** en el menú GRUB, sigue estos pasos en el instalador de texto:

1. **Idioma (`Language`):** elige `English` (recomendado en servidores para mensajes de error estándar) o `Español`.
2. **Actualización del instalador (`Installer update`):** si pregunta si quieres actualizar el instalador, puedes elegir `Continue without updating` (o actualizar si tienes Ethernet conectado).
3. **Teclado (`Keyboard configuration`):** selecciona tu distribución (`Spanish` o `English (US)` / `Latin American`) y confirma con **Done**.
4. **Tipo de instalación (`Choose type of install`):** deja **`Ubuntu Server`** (instalación estándar, NO minimal si prefieres utilidades base listas, aunque ambas funcionan; `Ubuntu Server` es lo más cómodo).
5. **Configuración de red (`Network connections`):**
   * Verás tu tarjeta Ethernet (`enp...` o `eth0`) con IP por DHCP.
   * **Recomendación:** configura una IP local estática o reserva esa MAC en tu router para que tu PC siempre tenga la misma IP en casa (aunque con **Tailscale** siempre la alcanzarás por su IP `100.x.y.z` y nombre `*.ts.net`).
6. **Proxy y Mirror (`Configure proxy` / `Ubuntu archive mirror`):**
   * Proxy: déjalo vacío y presiona **Done**.
   * Mirror: deja el mirror sugerido por defecto y presiona **Done**.
7. **ELIMINAR WINDOWS Y PARTICIONAR EL DISCO (`Guided storage configuration`):**
   * Aquí es donde se desinstala Windows completamente y se usa todo el disco de ~1 TB:
   * Selecciona **`Use an entire disk`** (Usar un disco completo).
   * Verifica que el disco seleccionado sea tu unidad de **~1 TB** (NO el USB de instalación).
   * Marca **`Set up this disk as an LVM group`** (recomendado para gestionar volúmenes con flexibilidad).
   * **Sobre cifrado de disco completo (`Encrypt the LVM group with LUKS`):**
     * *Si NO marcas LUKS:* tras un corte de luz la PC arranca **100 % sola** hasta levantar Docker y Tailscale (ideal para acceso remoto 24/7), mientras tu `Diario.docx` ya queda cifrado individualmente con `WORD_PASSWORD`.
     * *Si SÍ marcas LUKS:* máxima protección física si roban el disco, pero **requerirá escribir la clave físicamente con teclado tras cada apagón** antes de que arranque Linux/SSH/Tailscale.
   * Presiona **Done**.
8. **Resumen de almacenamiento (`Storage configuration`):**
   * En la pantalla verás las particiones nuevas (`/boot/efi`, `/boot`, LVM `ubuntu-vg / ubuntu-lv`) y abajo las particiones antiguas de Windows marcadas para destruirse.
   * **Opcional recomendado para aprovechar los 1 TB:** si el instalador asignó solo 100–200 GB a `ubuntu-lv` dejando espacio libre en el grupo LVM, selecciona `ubuntu-lv` -> `Edit` y aumenta el tamaño al máximo disponible (dejando libre si quieres para snapshots, o usando el ~95–100 %).
   * Selecciona **Done** y en el cuadro rojo **`Confirm destructive action`** elige **`Continue`** (esto borra Windows y formatea el disco limpio para Ubuntu Server).

---

## 5. Configuración del sistema dentro del instalador (Red, Usuario, OpenSSH)

1. **Perfil (`Profile setup`):**
   * **Your name:** tu nombre.
   * **Your server's name:** por ejemplo `dailyhub-srv` (será tu hostname).
   * **Pick a username:** por ejemplo `ubuntu` o tu usuario personal (sin espacios ni mayúsculas).
   * **Choose a password:** contraseña fuerte para `sudo` y consola.
2. **Ubuntu Pro:** elige **`Skip for now`** -> **Continue**.
3. **Configuración SSH (`SSH Setup`):**
   * **MARCA `[X] Install OpenSSH server`** (obligatorio para administrar sin monitor ni teclado).
   * Puedes dejar `Import SSH identity` en `No` (o importar desde GitHub si ya usas llaves ahí).
4. **Featured Server Snaps:**
   * **NO marques Docker aquí** (es mejor instalar **Docker Engine oficial** por `apt` en el paso 6, ya que el snap de Docker suele dar problemas con volúmenes fuera de `/home` y permisos de `docker compose`).
   * Baja hasta **Done** y presiona Enter.
5. **Instalación y reinicio:**
   * Espera a que termine de descargar paquetes e instalar el kernel (verás `Install complete!` arriba).
   * Selecciona **`Reboot Now`**.
   * Cuando te pida **`Please remove the installation medium, then press ENTER`**, retira la memoria USB y presiona **Enter**.

---

## 6. Post-instalación: actualizaciones, anti-suspensión y Docker

Inicia sesión en la consola (o por SSH desde tu laptop en la red local: `ssh tu_usuario@IP_LOCAL_DEL_SERVIDOR`) y ejecuta:

### 6.1 Actualizar el sistema y utilidades base
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates openssl rclone unzip cron ufw
```

### 6.2 Ajustar zona horaria y evitar que la PC se duerma
```bash
# Ajusta tu zona horaria (ej. America/Monterrey)
sudo timedatectl set-timezone America/Monterrey

# Evita suspensión o hibernación automática en servidor 24/7
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```
*(Si usas una laptop y cerrarás la tapa, edita `/etc/systemd/logind.conf`, descomenta y deja `HandleLidSwitch=ignore` y `HandleLidSwitchExternalPower=ignore`, luego ejecuta `sudo systemctl restart systemd-logind`).*

### 6.3 Instalar Docker Engine y Docker Compose oficial
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```
Cierra sesión SSH (`exit`) y vuelve a entrar para que el grupo `docker` aplique sin usar `sudo`. Verifica:
```bash
docker --version
docker compose version
```

---

## 7. Instalar Tailscale (acceso privado solo para ti) y Firewall UFW

### 7.1 Instalar y vincular Tailscale
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```
1. Abre en tu navegador el enlace de autenticación que aparece en pantalla e inicia sesión con tu cuenta personal de Tailscale.
2. En el panel web de Tailscale (`https://login.tailscale.com/admin/machines`):
   * Busca tu servidor (`dailyhub-srv`), abre el menú `...` -> **`Disable key expiry`** (para que el servidor nunca caduque su sesión automáticamente).
   * Verifica que **MagicDNS** y **HTTPS Certificates** estén habilitados en `DNS` dentro de la consola de Tailscale.

### 7.2 Configurar Firewall UFW (acceso privado solo por Tailscale)
Si quieres que el servidor sea accesible **únicamente a través de tu Tailnet** (bloqueando entradas directas por la red Wi-Fi/LAN de casa, salvo si temporalmente necesitas LAN):
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
# Permitir todo el tráfico que entre por la interfaz cifrada de Tailscale
sudo ufw allow in on tailscale0
# Opcional: mantener SSH en tu red local solo como respaldo inicial (puedes quitarlo después)
# sudo ufw allow 22/tcp
sudo ufw enable
sudo ufw status verbose
```

### 7.3 Activar Tailscale Serve (HTTPS automático en `*.ts.net`)
Una vez que el contenedor de la app esté corriendo en el puerto `3000`, ejecuta:
```bash
sudo tailscale serve --bg http://127.0.0.1:3000
```
Verifica tu URL HTTPS privada con:
```bash
tailscale serve status
```
Tendrás una URL HTTPS privada con certificado válido (por ejemplo `https://dailyhub-srv.tailXXXX.ts.net`) accesible únicamente desde tus dispositivos conectados a Tailscale (celular/laptop).

---

## 8. Desplegar Personal Daily Hub en Ubuntu Server

### 8.1 Clonar el repositorio en la rama de servidor autónomo
```bash
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/Flax64/personal-daily-hub.git mood-tracker
cd ~/projects/mood-tracker
git checkout feat/ubuntu-server-autonomous
```

### 8.2 Preparar carpetas locales de datos (Diario cifrado, logs y caché de idiomas)
```bash
mkdir -p data/journal data/ytdlp english-notes logs
chmod 700 data data/journal data/ytdlp english-notes logs
```
* **Si ya tienes tu `Diario.docx` protegido con contraseña desde Windows:**
  Cópialo desde tu USB o vía `scp` a `~/projects/mood-tracker/data/journal/Diario.docx` y protege permisos:
  ```bash
  chmod 600 ~/projects/mood-tracker/data/journal/Diario.docx
  ```
* **Si ya tienes `English_Learning_Notebook.docx`:**
  Puedes copiarlo a `~/projects/mood-tracker/english-notes/English_Learning_Notebook.docx` (o dejar que el servidor lo descargue automáticamente desde Google Drive).

### 8.3 Configurar `rclone` para Google Drive (Backups BD + Cuaderno de Idiomas)
Configura tus remotos de Google Drive (Drive 1 clínico y Drive 2 estudio opcional) ejecutando:
```bash
rclone config
```
*(Si estás configurando por SSH sin navegador en el servidor, en el paso `Use auto config?` responde **`n`** y sigue las instrucciones de `rclone authorize "drive"` desde tu laptop con navegador, o copia directamente tu `rclone.conf` respaldado a `~/.config/rclone/rclone.conf` con `chmod 600 ~/.config/rclone/rclone.conf`).*

Luego prepara los variables Base64 para el contenedor (o usa `rclone.conf` montado):
```bash
# Verifica tus remotos configurados
rclone listremotes
```

### 8.4 Crear `.env` (y sellarlo en `.env.enc` si deseas)
```bash
cp .env.example .env
chmod 600 .env
nano .env
```
Asegúrate de configurar correctamente estos valores clave en `.env`:
```env
DB_HOST=db
DB_USER=root
DB_PASS=tu_contrasena_fuerte_mysql
DB_NAME=MoodTrackerLocal
PORT=3000
TZ=America/Monterrey

# HTTPS vía Tailscale Serve
TRUST_PROXY=1
APP_BASE_URL=https://tu-servidor.tu-tailnet.ts.net
PROXY_HTTP_PORT=8080
PROXY_HTTPS_PORT=8443

# Notas autónomas en el servidor (sin depender de Windows PC)
SERVER_AUTONOMOUS_NOTES=true
DB_RETENTION_DAYS=0
JOURNAL_LOCAL_PATH=/app/journal-data/Diario.docx
ENGLISH_WORD_FILE_PATH=/app/english-notes/English_Learning_Notebook.docx

# Claves E2EE y cifrado local del Diario
WORD_PASSWORD=tu_contrasena_exacta_de_word
JOURNAL_SECRET_KEY=tu_clave_e2ee_exacta_de_32_bytes

# Rclone en contenedor (codifica tu rclone.conf en una sola línea Base64)
RCLONE_REMOTE=gdrive
RCLONE_BACKUP_DIR=RespaldosApp
STUDY_RCLONE_REMOTE=gdrive_study
STUDY_RCLONE_DIR=NotasIdiomas
RCLONE_CONF_B64=PEGA_AQUI_EL_BASE64_DE_RCLONE_CONF
```
Puedes generar `RCLONE_CONF_B64` fácilmente con:
```bash
base64 -w 0 ~/.config/rclone/rclone.conf
```

### 8.5 Construir y levantar los contenedores
```bash
cd ~/projects/mood-tracker
docker compose up -d --build
```
Si es una instalación nueva y ya tienes un respaldo SQL previo en Google Drive, restaura automáticamente:
```bash
./scripts/restore.sh --if-empty
```
Verifica que los 3 contenedores estén saludables:
```bash
docker compose ps
```
Y activa Tailscale Serve si aún no lo hiciste:
```bash
sudo tailscale serve --bg http://127.0.0.1:3000
```

> [!TIP]
> **¿Usar bóveda `.env.enc` o `.env` con `chmod 600`?**
> Si sellas `.env` con `./scripts/env-vault.sh encrypt`, ningún secreto queda en texto plano en disco, pero tras un apagón tendrás que entrar por SSH y ejecutar `./scripts/env-vault.sh up` introduciendo tu contraseña maestra. Si prefieres **reinicio 100 % automático tras apagones**, conserva `.env` con `chmod 600 .env` (los contenedores tienen `restart: always` y volverán a arrancar solos).

---

## 9. Backups automáticos, actualización de `yt-dlp` y verificación final

### 9.1 Programar crons en Ubuntu Server
Ejecuta `crontab -e` y añade estas dos tareas:
```cron
# 1) Respaldo diario a las 3:30 AM (MySQL -> Google Drive + copia local de Diario.docx cifrado)
30 3 * * * /home/TU_USUARIO/projects/mood-tracker/scripts/backup.sh >> /home/TU_USUARIO/projects/respaldos/backup.log 2>&1

# 2) Actualización semanal de yt-dlp dentro del contenedor los domingos a las 4:00 AM
0 4 * * 0 docker exec mood_app yt-dlp -U >> /home/TU_USUARIO/projects/respaldos/ytdlp-update.log 2>&1
```
*(Asegúrate de crear primero la carpeta de logs y permisos de ejecución)*:
```bash
mkdir -p ~/projects/respaldos
chmod +x ~/projects/mood-tracker/scripts/*.sh
```

### 9.2 Checklist de verificación final
1. **Acceso privado por Tailscale HTTPS:** abre `https://<tu-servidor>.<tu-tailnet>.ts.net` desde tu celular o laptop con Tailscale activo (prueba iniciar sesión y capturar ubicación GPS nativa).
2. **Notas de Idiomas en la Nube (Drive):** guarda una palabra de prueba en *Language Studio* y verifica que aparece en el visor de notas y en Google Drive (`rclone ls gdrive_study:NotasIdiomas` o `gdrive:RespaldosApp/NotasIdiomas`).
3. **Word Journal local y cifrado con contraseña:** guarda una nota en *Journal Notes* y verifica en el servidor:
   ```bash
   ls -la ~/projects/mood-tracker/data/journal/Diario.docx
   # Debe existir y estar cifrado con OLE2 MS-OFFCRYPTO (también puedes consultar GET /api/journal/local-status)
   ```
   Si quieres abrirlo en otro equipo, puedes descargarlo con tu sesión de admin en `/api/journal/download` y abrirlo en Word/LibreOffice usando tu `WORD_PASSWORD`.
4. **Extracción de letras con `yt-dlp`:** en *Learn with Music*, verifica que el badge superior muestre **`🟢 Servidor autónomo · Listo`** y extrae la letra de una canción usando tu IP residencial sin bloqueos de datacenter.
5. **Prueba de respaldo manual y logs del sistema:**
   ```bash
   ~/projects/mood-tracker/scripts/backup.sh
   tail -n 50 ~/projects/mood-tracker/logs/server.log
   tail -n 50 ~/projects/mood-tracker/logs/error.log
   ```
   Verifica que generó el dump en `~/projects/respaldos/`, mantuvo una instantánea local cifrada de `Diario.docx` en `~/projects/respaldos/journal_local_backups/` (sin subir el diario a Drive), subió la BD + histórico a Google Drive y los logs rotativos en `logs/` quedan ignorados por Git (también consultables para Admin vía `GET /api/system/logs`).
