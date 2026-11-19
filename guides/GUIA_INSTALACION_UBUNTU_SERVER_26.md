# Guía Paso a Paso: Desinstalar Windows, Instalar Ubuntu Server 26.04 LTS y Desplegar con Tailscale — Personal Daily Hub

> Guía completa para convertir una PC local (Intel Core i7, ~8 GB RAM, ~500 GB HDD) en un **servidor Ubuntu Server 26.04 LTS 100 % autónomo y local**, eliminando Windows por completo, exponiendo la app de forma privada con **Tailscale HTTPS** (`tailscale serve`) y operando **Notas de Idiomas locales (con Google Drive opcional)**, **Journal local cifrado con contraseña (`Diario.docx`)** y **`yt-dlp`** sin depender de otra computadora ni de servicios externos obligatorios.

---

## Índice

| Paso | Sección |
| :--- | :--- |
| 1 | [1. Respaldo obligatorio antes de borrar Windows](#1-respaldo-obligatorio-antes-de-borrar-windows) |
| 2 | [2. Descargar Ubuntu Server 26.04 LTS y crear USB booteable](#2-descargar-ubuntu-server-2604-lts-y-crear-usb-booteable) |
| 3 | [3. Configurar BIOS / UEFI para servidor 24/7](#3-configurar-bios--uefi-para-servidor-247) |
| 4 | [4. Arrancar el instalador, desinstalar Windows y particionar el disco de ~500 GB](#4-arrancar-el-instalador-desinstalar-windows-y-particionar-el-disco-de-500-gb) |
| 5 | [5. Configuración del sistema dentro del instalador (Red, Usuario, OpenSSH)](#5-configuración-del-sistema-dentro-del-instalador-red-usuario-openssh) |
| 6 | [6. Post-instalación: actualizaciones, Docker, SSH seguro y sudo para CI](#6-post-instalación-actualizaciones-docker-ssh-seguro-y-sudo-para-ci) |
| 7 | [7. Instalar Tailscale (OAuth CI + HTTPS Serve) y Firewall UFW](#7-instalar-tailscale-oauth-ci--https-serve-y-firewall-ufw) |
| 8 | [8. Desplegar 100 % con GitHub Secrets/Variables (o despliegue manual)](#8-desplegar-100--con-github-secretsvariables-o-despliegue-manual) |
| 9 | [9. Verificación de Google Drive, backups automáticos, `yt-dlp` y diagnóstico](#9-verificación-de-google-drive-backups-automáticos-yt-dlp-y-diagnóstico) |
| 10 | [10. Seguridad avanzada: HTTPS total, secretos blindados, anti-hackers y anti-DoS/DDoS](#10-seguridad-avanzada-https-total-secretos-blindados-anti-hackers-y-anti-dosddos) |

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

## 4. Arrancar el instalador, desinstalar Windows y particionar el disco de ~500 GB

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
   * Aquí es donde se desinstala Windows completamente y se usa todo el disco HDD de ~500 GB:
   * Selecciona **`Use an entire disk`** (Usar un disco completo).
   * Verifica que el disco seleccionado sea tu unidad de **~500 GB HDD** (NO el USB de instalación).
   * Marca **`Set up this disk as an LVM group`** (recomendado para gestionar volúmenes con flexibilidad).
   * **Sobre cifrado de disco completo (`Encrypt the LVM group with LUKS`):**
     * *Si NO marcas LUKS:* tras un corte de luz la PC arranca **100 % sola** hasta levantar Docker y Tailscale (ideal para acceso remoto 24/7), mientras tu `Diario.docx` ya queda cifrado individualmente con `WORD_PASSWORD`.
     * *Si SÍ marcas LUKS:* máxima protección física si roban el disco, pero **requerirá escribir la clave físicamente con teclado tras cada apagón** antes de que arranque Linux/SSH/Tailscale.
   * Presiona **Done**.
8. **Resumen de almacenamiento (`Storage configuration`):**
   * En la pantalla verás las particiones nuevas (`/boot/efi`, `/boot`, LVM `ubuntu-vg / ubuntu-lv`) y abajo las particiones antiguas de Windows marcadas para destruirse.
   * **Opcional recomendado para aprovechar los ~500 GB HDD:** si el instalador asignó solo 100–200 GB a `ubuntu-lv` dejando espacio libre en el grupo LVM, selecciona `ubuntu-lv` -> `Edit` y aumenta el tamaño al máximo disponible (dejando libre si quieres para snapshots, o usando el ~95–100 %).
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

## 6. Post-instalación: actualizaciones, Docker, SSH seguro y sudo para CI

Inicia sesión en la consola (o por SSH desde tu laptop en la red local: `ssh tu_usuario@IP_LOCAL_DEL_SERVIDOR`) y ejecuta:

### 6.1 Actualizar el sistema y utilidades base
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates openssl rclone unzip cron ufw openssh-server
```

### 6.2 Ajustar zona horaria, tuning HDD/8 GB RAM y evitar que la PC se duerma
```bash
# Ajusta tu zona horaria (ej. America/Monterrey)
sudo timedatectl set-timezone America/Monterrey

# Evita suspensión o hibernación automática en servidor 24/7
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

# Reduce escrituras swap innecesarias sobre disco mecánico HDD con 8 GB de RAM
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-hdd-tuning.conf
sudo sysctl --system
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

### 6.4 Configurar OpenSSH, llaves SSH (Admin + GitHub Actions), `sudo` sin contraseña y hardening
Para administrar el servidor sin monitor ni teclado y permitir que **GitHub Actions despliegue automáticamente por SSH**, prepara lo siguiente:

1. **Verificar que el servicio SSH arranque siempre con el sistema:**
   ```bash
   sudo systemctl enable --now ssh
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
   ```
2. **Llave SSH personal de administrador (desde tu laptop/PC Windows):**
   En PowerShell de tu laptop (si aún no tienes llave Ed25519):
   ```powershell
   ssh-keygen -t ed25519 -C "admin-dailyhub"
   # Copia tu llave pública al servidor:
   type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh TU_USUARIO@IP_LOCAL "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
   ```
3. **Llave SSH dedicada para GitHub Actions (`SERVER_SSH_KEY` / `EC2_SSH_KEY`):**
   Genera en RAM (`/dev/shm`) dentro de Ubuntu una llave exclusiva para CI/CD (sin passphrase para que GitHub Actions pueda usarla):
   ```bash
   ssh-keygen -t ed25519 -N "" -C "github-actions-deploy" -f /dev/shm/github_actions_dailyhub
   cat /dev/shm/github_actions_dailyhub.pub >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   echo "--- COPIA ESTA LLAVE PRIVADA COMPLETA AL SECRET SERVER_SSH_KEY (o EC2_SSH_KEY) EN GITHUB ---"
   cat /dev/shm/github_actions_dailyhub
   ```
   Una vez pegada la llave privada (incluyendo `BEGIN/END OPENSSH PRIVATE KEY`) en GitHub Secrets, bórrala de RAM:
   ```bash
   shred -u -z -n 1 /dev/shm/github_actions_dailyhub /dev/shm/github_actions_dailyhub.pub
   ```
4. **Habilitar `sudo` sin contraseña para despliegues SSH no interactivos:**
   A diferencia de AWS EC2, Ubuntu Server local pide contraseña en `sudo` por defecto y colgaría GitHub Actions al instalar paquetes o ajustar `timedatectl`/`cron`:
   ```bash
   echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee "/etc/sudoers.d/90-${USER}-nopasswd"
   sudo chmod 440 "/etc/sudoers.d/90-${USER}-nopasswd"
   sudo visudo -cf "/etc/sudoers.d/90-${USER}-nopasswd"
   ```
5. **Endurecer OpenSSH (desactivar login por contraseña y root):**
   *(Haz esto solo DESPUÉS de confirmar que puedes entrar usando tu llave Ed25519).*
   ```bash
   sudo tee /etc/ssh/sshd_config.d/99-hardening.conf >/dev/null <<'EOF'
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   ChallengeResponseAuthentication no
   PermitRootLogin no
   PubkeyAuthentication yes
   EOF
   sudo sshd -t && sudo systemctl reload ssh
   ```
   > [!IMPORTANT]
   > No cierres tu sesión SSH actual tras `reload ssh`. Abre una **segunda ventana de terminal** y comprueba `ssh TU_USUARIO@IP_LOCAL` antes de cerrar la primera.

---

## 7. Instalar Tailscale (OAuth CI + HTTPS Serve) y Firewall UFW

### 7.1 Instalar y vincular Tailscale en Ubuntu Server
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```
1. Abre en tu navegador el enlace de autenticación que aparece en pantalla e inicia sesión con tu cuenta personal de Tailscale.
2. Anota el nombre MagicDNS e IP Tailscale de tu equipo (`tailscale ip -4` y `tailscale status`).
3. En el panel web de Tailscale (`https://login.tailscale.com/admin/machines`):
   * Busca tu servidor (`dailyhub-srv`), abre el menú `...` -> **`Disable key expiry`** (para que el servidor nunca caduque su sesión automáticamente).
   * Verifica que **MagicDNS** y **HTTPS Certificates** estén habilitados en `DNS`.

### 7.2 Configurar Tailscale OAuth para que GitHub Actions conecte por SSH privado
El workflow `.github/workflows/deploy.yml` incluye `tailscale/github-action@v3` para que el runner de GitHub se conecte de forma **efímera** a tu Tailnet, ejecute el despliegue vía SSH contra tu servidor privado y se desconecte al terminar:

1. En **Tailscale Admin Console** -> **Access controls** (ACLs), declara el tag `tag:ci` bajo `tagOwners`:
   ```json
   "tagOwners": {
     "tag:ci": ["autogroup:admin"]
   }
   ```
   *(Si usas reglas ACL estrictas en vez del permiso por defecto, asegúrate de permitir `tag:ci` hacia puerto `22` de tu servidor).*
2. Ve a **Settings** -> **OAuth clients** -> **Generate OAuth client**:
   * Descripción: `GitHub Actions Deploy`.
   * Scope requerido: **`Auth Keys`** -> **`Write`** (asigna la etiqueta `tag:ci`).
3. Guarda el **Client ID** en el GitHub Secret `TS_OAUTH_CLIENT_ID` y el **Client Secret** en `TS_OAUTH_SECRET`.
   *(Alternativa rápida: también soporta un **Auth Key** en `TS_AUTHKEY`, pero OAuth no caduca cada 90 días).*

### 7.3 Configurar Firewall UFW (acceso privado solo por Tailscale)
Si quieres que el servidor sea accesible **únicamente a través de tu Tailnet** (bloqueando entradas directas por la red Wi-Fi/LAN de casa):
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
# Permitir todo el tráfico (HTTPS Serve y SSH) que entre por la interfaz cifrada de Tailscale
sudo ufw allow in on tailscale0
# Opcional temporal: mantener SSH en LAN mientras validas Tailscale SSH (luego bórralo con: sudo ufw delete allow 22/tcp)
sudo ufw allow 22/tcp
sudo ufw enable
sudo ufw status verbose
```
Una vez verificado que `ssh TU_USUARIO@<tu-servidor>.<tu-tailnet>.ts.net` funciona desde tu laptop conectada a Tailscale, elimina `22/tcp` en LAN (`sudo ufw delete allow 22/tcp`) para cerrar el puerto hacia toda tu red local.

### 7.4 Activar Tailscale Serve (HTTPS automático en `*.ts.net`)
Una vez que el contenedor `mood_app` esté corriendo en `127.0.0.1:3000`, ejecuta:
```bash
sudo tailscale serve --bg http://127.0.0.1:3000
tailscale serve status
```
Tendrás una URL HTTPS privada con certificado válido (por ejemplo `https://dailyhub-srv.tailXXXX.ts.net`) accesible únicamente desde tus dispositivos conectados a Tailscale (celular/laptop).

---

## 8. Desplegar 100 % con GitHub Secrets/Variables (o despliegue manual)

### 8.1 Migrar tus archivos Word locales antes del primer despliegue
```bash
mkdir -p ~/projects/mood-tracker/data/journal ~/projects/mood-tracker/data/ytdlp ~/projects/mood-tracker/english-notes ~/projects/mood-tracker/logs ~/projects/respaldos
chmod 700 ~/projects/mood-tracker/data ~/projects/mood-tracker/data/journal ~/projects/mood-tracker/data/ytdlp ~/projects/mood-tracker/english-notes ~/projects/mood-tracker/logs ~/projects/respaldos
```
* **Si ya tienes tu `Diario.docx` protegido con contraseña desde Windows:**
  Cópialo vía `scp` o USB a `~/projects/mood-tracker/data/journal/Diario.docx` (`chmod 600`).
* **Si ya tienes `English_Learning_Notebook.docx`:**
  Cópialo a `~/projects/mood-tracker/english-notes/English_Learning_Notebook.docx` (`chmod 600`), o deja que se descargue de Drive.
* *(Si ya existía la BD en tu respaldo previo de Google Drive, el primer deploy ejecuta `./scripts/restore.sh --if-empty` automáticamente al ver la BD vacía).*

### 8.2 Configurar GitHub Repository Secrets y Variables (Despliegue 100 % automatizado en RAM)
El workflow `.github/workflows/deploy.yml` toma todas las credenciales desde GitHub Actions, arma la configuración en `/dev/shm` (RAM) durante el despliegue y no deja `.env` en texto plano en disco cuando `SEAL_ENV_AFTER_DEPLOY=true`.

#### **Repository Secrets** (`Settings -> Secrets and variables -> Actions -> Secrets`)
| Secret | Estado | Descripción |
| :--- | :--- | :--- |
| `SERVER_SSH_KEY` *(o `EC2_SSH_KEY`)* | **Obligatorio** | Llave privada Ed25519 creada en el paso 6.4 (`~/.ssh/authorized_keys`). |
| `TS_OAUTH_CLIENT_ID` | **Recomendado** | Client ID OAuth de Tailscale (con scope `Auth Keys: Write` y `tag:ci`). |
| `TS_OAUTH_SECRET` | **Recomendado** | Client Secret OAuth de Tailscale (permite a GitHub Actions entrar por Tailscale SSH). |
| `DB_PASS` | **Obligatorio** | Contraseña de MySQL (`mood_db`). |
| `ADMIN_EMAIL` | **Obligatorio** | Correo administrador para autenticación/códigos. |
| `ADMIN_SECRET` | **Obligatorio** | Clave secreta personal para registro de administrador. |
| `WORD_PASSWORD` | **Obligatorio** | Contraseña real del archivo cifrado local `Diario.docx`. |
| `JOURNAL_SECRET_KEY` | **Obligatorio** | Llave E2EE exacta de 32 caracteres. |
| `SMTP_USER` | **Obligatorio** | Cuenta Gmail emisora de códigos de seguridad. |
| `SMTP_PASS` | **Obligatorio** | Contraseña de aplicación Gmail (16 caracteres). |
| `RCLONE_CONF_B64` | **Obligatorio p/ Drive** | `rclone.conf` codificado en una línea Base64 (`base64 -w 0 ~/.config/rclone/rclone.conf`). |
| `GEMINI_API_KEY` | **Recomendado** | Clave de Google AI Studio para Language Studio. |
| `STUDY_RCLONE_CONF_B64` | Opcional | Solo si usas una segunda cuenta Google Drive separada para notas de estudio. |
| `YOUTUBE_API_KEY` | Opcional | Clave API YouTube Data v3 (búsquedas extendidas). |

#### **Repository Variables** (`Settings -> Secrets and variables -> Actions -> Variables`)
| Variable | Valor sugerido | Estado | Notas |
| :--- | :--- | :--- | :--- |
| `SERVER_HOST` *(o `EC2_HOST`)* | `dailyhub-srv.tailXXXX.ts.net` *(o IP Tailscale `100.x.y.z`)* | **Actualizar** | Reemplaza la antigua IP pública de AWS EC2. |
| `SERVER_USER` *(o `EC2_USER`)* | Tu usuario Ubuntu *(ej. `ubuntu` o `flavio`)* | **Verificar** | Usuario con el que entras por SSH en Ubuntu Server. |
| `APP_BASE_URL` | `https://dailyhub-srv.tailXXXX.ts.net` | **Recomendado** | URL Tailscale Serve (si se omite, `deploy.yml` intenta autodetectarla). |
| `DB_HOST` | `db` | Mantener | Nombre del servicio MySQL en Docker Compose. |
| `DB_NAME` | `MoodTrackerLocal` | Mantener | Nombre de la base de datos. |
| `DB_USER` | `root` | Mantener | Usuario MySQL. |
| `PORT` | `3000` | Mantener | Puerto interno enlazado solo a `127.0.0.1:3000`. |
| `TZ` | `America/Monterrey` | Mantener | Zona horaria para Node, MySQL, Python y cron. |
| `RCLONE_REMOTE` | `gdrive` | Mantener | Nombre exacto del remoto dentro de `RCLONE_CONF_B64`. |
| `RCLONE_BACKUP_DIR` | `RespaldosApp` | Mantener | Carpeta destino de respaldos en Google Drive. |
| `DB_RETENTION_DAYS` | `0` | **Añadir (`0`)** | Conserva todo el histórico local sin podar en MySQL. |
| `REQUIRE_DRIVE_BACKUP` | `true` | **Recomendado** | Falla el cron/deploy si Google Drive no está operativo o token expiró. |
| `SEAL_ENV_AFTER_DEPLOY` | `true` | Mantener | Borra `.env` en disco tras desplegar; `.backup.meta` + `rclone.conf` mantienen los crons funcionando. |
| `BACKUP_CRON_SCHEDULE` | `30 3 * * *` | Mantener | Horario diario de `scripts/backup.sh`. |
| `YT_DLP_PATH` | *(Eliminar)* | **Ya NO necesaria** | Era exclusiva de Windows; en Docker Linux se usa `/usr/local/bin/yt-dlp` automático. |

> [!NOTE]
> Cuando `SEAL_ENV_AFTER_DEPLOY=true`, `deploy.yml` inyecta las variables directamente en los contenedores creados (`restart: always`, por lo que siguen arrancando tras cortes de luz sin `.env` en disco) y guarda los parámetros no secretos (`DB_RETENTION_DAYS`, `RCLONE_REMOTE`, `RCLONE_BACKUP_DIR`, `REQUIRE_DRIVE_BACKUP`) en `~/projects/respaldos/.backup.meta` junto con `~/.config/rclone/rclone.conf` para que `scripts/backup.sh` siga subiendo a Google Drive automáticamente cada noche.

### 8.3 Lanzar el despliegue desde GitHub (o manual local)
* **Vía GitHub Actions (recomendado):** cada `push` a `main` o ejecución manual desde **Actions -> Deploy to Ubuntu Server (Tailscale / SSH) -> Run workflow** despliega todo en tu servidor vía Tailscale SSH.
* **Despliegue manual opcional en el servidor:** si en algún momento despliegas sin GitHub Actions, copia `.env.example` a `.env` (`chmod 600`), configura tus valores (`APP_UID=$(id -u)`, `APP_GID=$(id -g)`), ejecuta `docker compose up -d --build` (o usa `./scripts/env-vault.sh encrypt` + `./scripts/env-vault.sh up`).

---

## 9. Verificación de Google Drive, backups automáticos, `yt-dlp` y diagnóstico

### 9.1 ¿Qué se respalda en Google Drive y qué queda solo local?
* **En Google Drive (`${RCLONE_REMOTE}:${RCLONE_BACKUP_DIR}`, ej. `gdrive:RespaldosApp`):**
  * `respaldo_mood_tracker.sql.gz` (volcado diario completo de MySQL).
  * `historico_sql/respaldo_YYYY-MM.sql.gz` (instantánea SQL mensual acumulada).
  * `historico_completo.json.gz` (archivo JSON acumulativo histórico).
  * `NotasIdiomas/English_Learning_Notebook.docx` (sincronizado en automático desde `mood_app` usando `RCLONE_CONF_B64`).
* **100 % solo en disco local Ubuntu (NUNCA se sube a Google Drive):**
  * `./data/journal/Diario.docx` y sus copias rotativas diarias (30 días) en `~/projects/respaldos/journal_local_backups/` (cifradas con `WORD_PASSWORD`).

### 9.2 Probar y verificar los respaldos reales en Google Drive
```bash
# 1) Ejecutar respaldo manual exigiendo confirmación remota en Drive
~/projects/mood-tracker/scripts/backup.sh --require-drive

# 2) Confirmar los archivos subidos directamente en Google Drive
rclone ls gdrive:RespaldosApp

# 3) Ver los logs de cron y servicios
tail -n 30 ~/projects/respaldos/backup.log
tail -n 50 ~/projects/mood-tracker/logs/server.log
```
El workflow `deploy.yml` registra automáticamente ambos crons en Ubuntu: respaldo diario (`30 3 * * *`) y actualización semanal de `yt-dlp` (`0 4 * * 0` usando `docker exec -u 0 mood_app yt-dlp -U`).

### 9.3 Verificación integral automatizada (`yt-dlp`, `node`, `docker`, `python`, Tailscale y Drive)
```bash
cd ~/projects/mood-tracker
chmod +x scripts/verify-ubuntu-local.sh
./scripts/verify-ubuntu-local.sh
```
Este diagnóstico (`[1/9]`–`[9/9]`) valida CPU/RAM/HDD, salud de los 3 contenedores, tuning InnoDB, puertos solo en `127.0.0.1`, UFW + Tailscale Serve, `node` + `tzdata`, `python3` + `msoffcrypto OOXMLFile`, `yt-dlp --js-runtimes node` + `ffmpeg`, carga local de `/vendor/crypto-js.min.js` sin CDNs, permisos de volúmenes, conectividad real contra Google Drive y registro de crons.

### 9.4 Checklist rápido en la app web
1. **Acceso privado por Tailscale HTTPS:** abre `https://<tu-servidor>.<tu-tailnet>.ts.net` desde tu celular/laptop con Tailscale activo.
2. **Notas de Idiomas:** guarda una entrada en *Language Studio* y verifica su respaldo en `./english-notes/English_Learning_Notebook.docx` y `rclone ls gdrive:RespaldosApp/NotasIdiomas`.
3. **Word Journal local cifrado:** guarda una nota en *Journal Notes* y confirma `Diario.docx` cifrado (`OLE2 MS-OFFCRYPTO`) en `./data/journal/Diario.docx`.
4. **Letras con `yt-dlp` y división por idiomas:** en *Learn with Music*, confirma el estado **`🟢 Servidor autónomo · Listo`** y prueba las pestañas `Original`, `Coreano`, `Inglés`, `Japonés`, `Español`.

---

## 10. Seguridad avanzada: HTTPS total, secretos blindados, anti-hackers y anti-DoS/DDoS

### 10.1 Cifrado extremo a extremo en tránsito (4 capas simultáneas)
Todo el tráfico hacia tu servidor viaja cifrado con **4 capas superpuestas**:
1. **Capa 1 — Túnel WireGuard (Tailscale):** todo paquete entre tu celular/laptop y Ubuntu Server va cifrado en red privada (`100.x.y.z` / `*.ts.net`) sin abrir puertos en tu router hacia Internet.
2. **Capa 2 — HTTPS TLS 1.3 (`tailscale serve` + `REQUIRE_HTTPS=true`):**
   * Tailscale Serve termina TLS válido (`https://<tu-servidor>.<tu-tailnet>.ts.net`) y envía `X-Forwarded-Proto: https` hacia `127.0.0.1:3000`.
   * Cuando `REQUIRE_HTTPS=true` está activo en `.env` / GitHub Deploy, Node responde **HSTS** (`Strict-Transport-Security: max-age=31536000; includeSubDomains`), activa CSP `upgrade-insecure-requests`, marca cookies de sesión como **`HttpOnly; Secure; SameSite=Lax`** y rechaza peticiones HTTP planas sin TLS (`HTTP 426` en `/api/*` o redirección `308` a `https://` en navegador, excluyendo `/healthz`).
   * **CORS estricto:** `server.js` solo acepta peticiones cross-origin desde `APP_BASE_URL`, tu propio `Host`, loopback o dominios `*.ts.net`.
3. **Capa 3 — Túnel de Transporte (`TransportCrypto`):** cifrado adicional a nivel de aplicación dentro de `/api/*` con intercambio efímero **X25519 + HKDF-SHA256 + AES-256-CTR + HMAC-SHA256**.
4. **Capa 4 — Cifrado E2EE de notas (`JOURNAL_SECRET_KEY`):** tus notas de *Journal* y *Language Studio* salen cifradas en **AES-256-CBC** desde el navegador con tu llave de 32 caracteres antes de tocar la red.

**Comandos para comprobar HTTPS estricto y CORS desde Ubuntu:**
```bash
# 1) Debe responder HTTP 426 porque exige HTTPS en /api/* (cuando REQUIRE_HTTPS=true)
curl -i http://127.0.0.1:3000/api/auth/me

# 2) Simulando el proxy HTTPS de Tailscale Serve: debe devolver Strict-Transport-Security y upgrade-insecure-requests
curl -I -H "X-Forwarded-Proto: https" http://127.0.0.1:3000/

# 3) Origen externo hostil: NO debe aparecer Access-Control-Allow-Origin: https://evil.example
curl -i -H "X-Forwarded-Proto: https" -H "Origin: https://evil.example" http://127.0.0.1:3000/api/auth/me

# 4) Verificar URL pública privada HTTPS en Tailscale desde tu laptop o celular con Tailscale activo
tailscale serve status
```

---

### 10.2 Protección de `.env`, contraseñas y secretos en el servidor (aislamiento local y físico)

> [!IMPORTANT]
> **Realidad de seguridad en Linux:** ningún sistema operativo puede impedir que un atacante que ya obtuvo privilegios **`root` reales en un servidor encendido** inspeccione la memoria RAM de procesos activos. Por eso la defensa se basa en **dos frentes**:
> 1. **Que el atacante NUNCA llegue a tu usuario ni a `root`** (cero puertos expuestos, Tailscale ACLs, SSH con llave, Fail2ban, contenedores sin privilegios).
> 2. **Que si alguien roba el disco duro apagado o entra como usuario local no privilegiado, tampoco pueda leer secretos ni archivos personales.**

Aplica estos pasos en Ubuntu Server:

1. **Cero `.env` en texto plano sobre disco y cero secretos en logs:**
   * En despliegue automatizado con GitHub Actions mantén **`SEAL_ENV_AFTER_DEPLOY=true`** (`deploy.yml` crea el entorno temporal en `/dev/shm` RAM, arranca Docker y destruye el archivo con `shred`).
   * Si despliegas manualmente en local, cifra `.env` en `.env.enc` (**AES-256-CBC + PBKDF2 600,000 iteraciones**):
     ```bash
     cd ~/projects/mood-tracker
     ./scripts/env-vault.sh encrypt
     ./scripts/env-vault.sh status   # Debe indicar [OK] .env en texto plano NO existe en disco y [SELLADO] .env.enc
     ```
   * Los logs en `./logs/server.log` y `./logs/error.log` redactan automáticamente `DB_PASS`, `WORD_PASSWORD`, `JOURNAL_SECRET_KEY`, tokens `AIza...`, `tskey-...`, `ghp_...`, cookies `mt_session=` y bloques de llaves privadas.
   * Las rutas puente legadas `/api/pull-text` y `/api/pull-english` quedan bloqueadas con firma HMAC (`REQUIRE_PC_BRIDGE_AUTH=true`).

2. **Ocultar procesos y variables de entorno a otros usuarios locales (`/proc` con `hidepid=2`):**
   Evita que cuentas de servicio o usuarios sin privilegios vean qué procesos corres ni lean `/proc/<pid>/environ`:
   ```bash
   # Respalda fstab antes de editar
   sudo cp /etc/fstab /etc/fstab.bak

   # Añade o actualiza /proc con hidepid=2 si no existe aún
   if ! grep -qE '^\s*proc\s+/proc\s' /etc/fstab; then
     echo 'proc /proc proc defaults,hidepid=2 0 0' | sudo tee -a /etc/fstab
   else
     sudo sed -i 's|^\(\s*proc\s\+/proc\s\+proc\s\+[^ ]*\)|\1,hidepid=2|' /etc/fstab
   fi

   # Aplica de inmediato sin reiniciar y verifica
   sudo mount -o remount /proc
   grep -E '\s/proc\s' /proc/mounts
   ```
   *(En Docker moderno sobre Ubuntu 26.04, `hidepid=2` es compatible con `root` / systemd; si notas algún servicio de monitoreo que necesite leer `/proc`, verifica `docker ps` justo después del `remount`).*

3. **Bloquear permisos de directorios personales, llaves, `rclone` y respaldos:**
   ```bash
   # Tu directorio personal accesible SOLO para tu usuario
   chmod 700 "$HOME"
   chmod 700 "$HOME/.ssh" "$HOME/.config" "$HOME/.config/rclone" "$HOME/projects" "$HOME/projects/respaldos"
   chmod 600 "$HOME/.ssh/authorized_keys" "$HOME/.config/rclone/rclone.conf"
   chmod 600 "$HOME/projects/respaldos/.backup.meta" 2>/dev/null || true

   # Carpetas sensibles de datos de la app
   chmod 700 "$HOME/projects/mood-tracker/data" "$HOME/projects/mood-tracker/data/journal" "$HOME/projects/mood-tracker/english-notes" "$HOME/projects/mood-tracker/logs"

   # Auditar qué usuarios pertenecen a grupos privilegiados (solo debe aparecer tu usuario)
   getent group sudo docker adm
   ```

4. **Opcional — Restringir `sudo` o activar cifrado completo de disco (`LUKS2`):**
   * **Endurecer `sudoers` tras despliegue manual (opcional):** si en algún momento dejas de usar GitHub Actions y prefieres que incluso tu usuario pida contraseña para `sudo`, elimina la regla sin contraseña: `sudo rm -f /etc/sudoers.d/90-*-nopasswd` *(nota: mientras `deploy.yml` despliegue por SSH automáticamente, esa regla es necesaria para `apt-get`, `timedatectl` y `cron`)*.
   * **Robo físico del disco HDD:** tu `Diario.docx` ya está cifrado por archivo con `WORD_PASSWORD`. Si además quieres que ni MySQL ni el sistema operativo sean legibles si alguien saca el disco SATA del gabinete, debes usar **LUKS2** al particionar (Paso 4), sabiendo que tras cada corte de luz requerirá introducir la contraseña físicamente frente al teclado al arrancar.

---

### 10.3 Blindaje anti-hackers (evitar robo de datos o destrucción del servidor)

1. **Red 100 % invisible hacia Internet y LAN:**
   * En tu router de casa: **NO abras ningún puerto (Port Forwarding = 0)**.
   * Docker enlaza todos los puertos únicamente a `127.0.0.1` (`127.0.0.1:3000`, `127.0.0.1:3306`, `127.0.0.1:8080`).
   * Verifica desde la consola del servidor que nada escuche en `0.0.0.0`:
     ```bash
     ss -lntup
     ```

2. **Reglas ACL estrictas en Tailscale Admin Console (`Access Controls`):**
   Aunque alguien lograra entrar a otro dispositivo antiguo, limita explícitamente en Tailscale qué dispositivos pueden tocar los puertos `443` (Web HTTPS) y `22` (SSH):
   ```json
   {
     "tagOwners": {
       "tag:ci": ["autogroup:admin"],
       "tag:server": ["autogroup:admin"]
     },
     "acls": [
       { "action": "accept", "src": ["autogroup:owner"], "dst": ["tag:server:443", "tag:server:22"] },
       { "action": "accept", "src": ["tag:ci"], "dst": ["tag:server:22"] }
     ]
   }
   ```
   *(Aplica la etiqueta `tag:server` a tu servidor Ubuntu en Tailscale Admin Console -> Machines -> `...` -> Edit ACL tags; reemplaza `"autogroup:owner"` si tu correo personal usa rol miembro/admin).*

3. **Instalar y configurar `Fail2ban` (bloqueo automático ante fuerza bruta SSH):**
   ```bash
   sudo apt update
   sudo apt install -y fail2ban

   sudo tee /etc/fail2ban/jail.local >/dev/null <<'EOF'
   [DEFAULT]
   bantime = 1h
   findtime = 10m
   maxretry = 3
   backend = systemd

   [sshd]
   enabled = true
   port = ssh
   mode = aggressive
   EOF

   sudo systemctl enable --now fail2ban
   sudo fail2ban-client status sshd
   ```
   Cualquier IP que falle 3 intentos SSH en 10 minutos queda bloqueada automáticamente durante 1 hora.

4. **Actualizaciones automáticas de parches de seguridad (`unattended-upgrades`):**
   Cierra vulnerabilidades críticas de kernel, OpenSSL, SSH y Docker automáticamente:
   ```bash
   sudo apt install -y unattended-upgrades apt-listchanges
   sudo dpkg-reconfigure -f noninteractive unattended-upgrades

   # Verificar que los timers diarios de actualización estén activos
   systemctl status apt-daily.timer apt-daily-upgrade.timer --no-pager
   ```

5. **Endurecimiento extra de OpenSSH y restricción de usuario:**
   Reemplaza `TU_USUARIO` por tu usuario Ubuntu real antes de ejecutar:
   ```bash
   sudo tee /etc/ssh/sshd_config.d/99-hardening.conf >/dev/null <<'EOF'
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   ChallengeResponseAuthentication no
   PermitRootLogin no
   PubkeyAuthentication yes
   MaxAuthTries 3
   LoginGraceTime 30
   X11Forwarding no
   AllowAgentForwarding no
   AllowTcpForwarding no
   ClientAliveInterval 300
   ClientAliveCountMax 2
   AllowUsers TU_USUARIO
   EOF

   # Cambia TU_USUARIO por tu usuario real y valida antes de recargar
   sudo sed -i "s/TU_USUARIO/$USER/g" /etc/ssh/sshd_config.d/99-hardening.conf
   sudo sshd -t && sudo systemctl reload ssh
   ```

6. **Aislamiento de contenedores (`docker-compose.yml`) + AppArmor + Auditoría (`auditd` / `rkhunter`):**
   * Los contenedores ya corren con `no-new-privileges:true`, `cap_drop: ALL`, `user: "${APP_UID:-1000}:${APP_GID:-1000}"`, límites de PIDs (`pids_limit`) para evitar *fork bombs*, y `/tmp` + `/dev/shm` montados con **`noexec,nosuid,nodev`** para bloquear binarios maliciosos temporales.
   * Activa auditoría de archivos críticos en Linux:
     ```bash
     sudo apt install -y auditd rkhunter

     sudo tee /etc/audit/rules.d/99-dailyhub-watch.rules >/dev/null <<EOF
     -w /home/$USER/.ssh/authorized_keys -p wa -k ssh_keys_watch
     -w /etc/sudoers.d -p wa -k sudoers_watch
     -w /home/$USER/.config/rclone/rclone.conf -p wa -k secrets_watch
     -w /home/$USER/projects/mood-tracker/data/journal/Diario.docx -p wa -k journal_watch
     EOF

     sudo augenrules --load
     sudo systemctl enable --now auditd

     # Verificar AppArmor activo en el kernel y consultar alertas auditd cuando quieras:
     sudo aa-status | head -n 15
     sudo ausearch -k ssh_keys_watch --start recent || true
     ```

---

### 10.4 Defensa contra ataques de Denegación de Servicio (DoS / DDoS)

Tu protección anti-DoS actúa en **4 niveles**:

1. **Nivel de Red (Eliminación de superficie pública):** al operar detrás de Tailscale sin IP pública expuesta ni puertos abiertos en el router, un atacante en Internet **no tiene dirección IP ni puerto que inundar** con tráfico volumétrico UDP/TCP directo.
2. **Nivel Kernel Linux (`sysctl` contra SYN flood, ICMP flood y spoofing IP):**
   ```bash
   sudo tee /etc/sysctl.d/99-security-dos.conf >/dev/null <<'EOF'
   # Protección contra SYN Flood (cola saturada de conexiones TCP a medio abrir)
   net.ipv4.tcp_syncookies = 1
   net.ipv4.tcp_max_syn_backlog = 2048
   net.ipv4.tcp_synack_retries = 2

   # Anti-spoofing y bloqueo de redirecciones ICMP maliciosas
   net.ipv4.conf.all.rp_filter = 1
   net.ipv4.conf.default.rp_filter = 1
   net.ipv4.conf.all.accept_redirects = 0
   net.ipv4.conf.default.accept_redirects = 0
   net.ipv4.conf.all.send_redirects = 0
   net.ipv4.conf.all.accept_source_route = 0

   # Mitigar amplificación / ping flood por broadcast
   net.ipv4.icmp_echo_ignore_broadcasts = 1
   net.ipv4.icmp_ignore_bogus_error_responses = 1
   net.ipv4.conf.all.log_martians = 1
   EOF

   sudo sysctl --system
   ```
3. **Nivel Proxy Caddy y Aplicación Node.js (Anti-Slowloris y Anti-Flood HTTP):**
   * **`Caddyfile`:** limita cuerpos de petición (`max_size 16MB`) y oculta la cabecera `Server`.
   * **`server.js`:**
     * `httpServer.keepAliveTimeout = 15000`, `headersTimeout = 20000`, `requestTimeout = 90000`, `maxHeadersCount = 64` (cierra rápido conexiones lentas tipo **Slowloris** que intentan dejar sockets colgados).
     * Límite estricto de tamaño JSON (`512kb` general / `15mb` solo en sync Word autorizado con HMAC).
     * **Rate limiters con tope acotado en RAM** (máx. 1,000 llaves en mapa para que un flood no llene la memoria): `/api/*` global (`500/min`), estáticos (`600/min`), login IP (`30/15min`), login cuenta (`10/15min`), handshake (`120/min`) y lecturas/escrituras.
     * Semáforo FIFO `runWithHeavyTaskLock` (`maxConcurrency = 1`) para evitar que múltiples llamadas concurrentes a `yt-dlp`, Python o `rclone` saturen la CPU o los 8 GB de RAM.
4. **Nivel Contenedores Docker y Disco (~500 GB HDD):**
   * **`mem_limit` + `cpus` + `pids_limit`:** `mood_db` (`1024m` / `2.0` CPUs / `256` PIDs), `mood_app` (`1024m` / `2.0` CPUs / `128` PIDs), `mood_proxy` (`64m` / `0.5` CPUs / `64` PIDs). Ningún fallo o ataque en la app puede colgar el sistema operativo anfitrión ni provocar *fork bombs*.
   * **Anti-llenado de disco (Disk-DoS):** rotación automática en los 3 contenedores (`max-size: 10m`, `max-file: 3`), logs rotativos internos (`5 MB x 5`), tmpfs limitado en RAM (`/tmp` `128m`, `/dev/shm` `64m`) y depuración de temporales > 7 días en backups.
   * **Recuperación rápida ante ransomware o corrupción:** tu respaldo verificado en Google Drive permite reconstruir la base de datos limpia en minutos ejecutando:
     ```bash
     ./scripts/restore.sh --force
     ```

**Verificación final de seguridad integral:**
```bash
./scripts/verify-ubuntu-local.sh
```
Confirmará automáticamente la sección `[10/10]` (hardening del contenedor, cero `.env` plano, `tcp_syncookies`, SSH `PasswordAuthentication no`, `fail2ban`, `unattended-upgrades` y `/proc` `hidepid=2`), además de las pruebas de HTTPS/HSTS y CORS en `[7/10]`.
