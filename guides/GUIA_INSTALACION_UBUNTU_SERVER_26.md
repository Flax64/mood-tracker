# Guía Paso a Paso: Desinstalar Windows, Instalar Ubuntu Server 26.04 LTS y Desplegar con Tailscale — Personal Daily Hub

> Guía completa y detallada para convertir una PC local (Intel Core i7, ~8 GB RAM, ~500 GB HDD) en un **servidor Ubuntu Server 26.04 LTS 100 % autónomo y local**, ejecutando **4 contenedores Docker** (`mood_db` MySQL 8.0 + 2 réplicas `mood_app` y `mood_app2` + balanceador Caddy `mood_proxy` con sticky sessions `pdh_lb` y locks distribuidos `GET_LOCK`), exponiendo la app de forma privada mediante **Tailscale HTTPS** (`tailscale serve`) y operando **Notas de Idiomas locales (con Google Drive opcional)**, **Journal local cifrado con contraseña (`Diario.docx`)** y **`yt-dlp` autónomo**.

---

## Índice

| Paso | Sección |
| :--- | :--- |
| 1 | [1. Respaldo previo: AWS a Google Drive y archivos de Windows](#1-respaldo-previo-aws-a-google-drive-y-archivos-de-windows) |
| 2 | [2. Descargar Ubuntu Server 26.04 LTS y crear USB booteable (Rufus)](#2-descargar-ubuntu-server-2604-lts-y-crear-usb-booteable-rufus) |
| 3 | [3. Configurar BIOS / UEFI para servidor 24/7](#3-configurar-bios--uefi-para-servidor-247) |
| 4 | [4. Arrancar el instalador, desinstalar Windows y particionar el disco de ~500 GB](#4-arrancar-el-instalador-desinstalar-windows-y-particionar-el-disco-de-500-gb) |
| 5 | [5. Configuración del sistema dentro del instalador (Red, Usuario, OpenSSH)](#5-configuración-del-sistema-dentro-del-instalador-red-usuario-openssh) |
| 6 | [6. Post-instalación: sistema, Docker, `rclone`, SSH seguro y `sudo` para CI](#6-post-instalación-sistema-docker-rclone-ssh-seguro-y-sudo-para-ci) |
| 7 | [7. Instalar Tailscale (OAuth CI + HTTPS Serve al Balanceador) y Firewall UFW](#7-instalar-tailscale-oauth-ci--https-serve-al-balanceador-y-firewall-ufw) |
| 8 | [8. Migrar archivos, desplegar vía GitHub Actions o manual y restaurar BD](#8-migrar-archivos-desplegar-vía-github-actions-o-manual-y-restaurar-bd) |
| 9 | [9. Verificación del Balanceador, 4 Contenedores, Google Drive, `yt-dlp` y App Web](#9-verificación-del-balanceador-4-contenedores-google-drive-yt-dlp-y-app-web) |
| 10 | [10. Seguridad avanzada: HTTPS total, secretos blindados, anti-hackers y anti-DoS/DDoS](#10-seguridad-avanzada-https-total-secretos-blindados-anti-hackers-y-anti-dosddos) |
| 11 | [11. Operación diaria, cambio seguro de `DB_PASS` y solución de problemas](#11-operación-diaria-cambio-seguro-de-db_pass-y-solución-de-problemas) |

---

## 1. Respaldo previo: AWS a Google Drive y archivos de Windows

> [!WARNING]
> Al instalar Ubuntu Server usando todo el disco, **Windows y todos los archivos en esa PC se eliminarán de forma irreversible**. Completa tanto el respaldo de tu instancia AWS (si aún está activa) como la copia de tus archivos locales en una USB o disco externo antes de continuar.

### 1.1 Respaldo final desde tu instancia AWS EC2 hacia Google Drive

Si actualmente tienes datos corriendo en tu servidor AWS, entra por SSH a esa instancia y sube un respaldo actualizado antes de apagarla:

```bash
# Opción A: Usar el script oficial del proyecto en la instancia AWS
cd ~/projects/mood-tracker && ./scripts/backup.sh --require-drive
```

*(Si tu instancia AWS tiene una versión anterior del script sin `--require-drive`, o prefieres hacer una extracción **100 % de solo lectura** sin podar registros viejos en AWS, ejecuta este comando en una línea)*:

```bash
docker exec mood_db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --single-transaction --routines --triggers --no-tablespaces -u root "$MYSQL_DATABASE"' \
  | gzip > ~/respaldo_mood_tracker.sql.gz \
  && gzip -t ~/respaldo_mood_tracker.sql.gz \
  && rclone copyto ~/respaldo_mood_tracker.sql.gz gdrive:RespaldosApp/respaldo_mood_tracker.sql.gz \
  && rclone lsl gdrive:RespaldosApp --include "respaldo_mood_tracker.sql.gz" --include "historico_completo.json.gz"
```

*(Si tu usuario en AWS necesita `sudo` para Docker, antepón `sudo` a `docker exec`).*

Cuando veas `respaldo_mood_tracker.sql.gz` con la fecha de hoy y tamaño mayor a 0 bytes, tu base de datos estará lista para restaurarse automáticamente en Ubuntu Server mediante `./scripts/restore.sh`.

### 1.2 Respaldo de tus archivos locales en Windows (en USB externa)

Copia a una USB externa (y verifica que abran correctamente):

1. **Tu Diario personal cifrado (`Diario.docx`):**
   * El archivo `.docx` que usabas localmente protegido con `WORD_PASSWORD`. En Ubuntu Server vivirá dentro de `./data/journal/Diario.docx` (cifrado con `msoffcrypto-tool` usando la misma contraseña `WORD_PASSWORD`, y **nunca** se subirá a Google Drive ni Git).
2. **Tu Cuaderno de Idiomas (`English_Learning_Notebook.docx`):**
   * Ubicado en `english-notes/English_Learning_Notebook.docx` (y/o en Google Drive `gdrive:RespaldosApp/NotasIdiomas`).
3. **Tus secretos y llaves actuales:**
   * Si usas bóveda local `.env.enc`, descífrala temporalmente en PowerShell con `node scripts/local-vault.js decrypt` (o revisa tu `.env`) y respalda de forma segura: `DB_PASS`, `ADMIN_EMAIL`, `ADMIN_SECRET`, `WORD_PASSWORD`, `JOURNAL_SECRET_KEY`, `SMTP_USER`, `SMTP_PASS` y `GEMINI_API_KEY`.
   * **Notas clave sobre variables al migrar:**
     * **`JOURNAL_SECRET_KEY` (32 caracteres):** **sigue siendo obligatoria** en Ubuntu Server para el cifrado E2EE entre el navegador y Node.js.
     * **`WORD_FILE_PATH`, `AWS_HOST` y `YT_DLP_PATH`:** ya son **obsoletas** en Ubuntu Server (el servidor usa `/app/journal-data/Diario.docx`, `/usr/local/bin/yt-dlp` y tu dominio `*.ts.net`).
     * **Cambiar `DB_PASS` antes de instalar:** el respaldo SQL de Google Drive **no guarda la contraseña del usuario `root` de MySQL**. Si quieres usar una nueva `DB_PASS` más segura en Ubuntu Server, simplemente colócala en tu `.env` / GitHub Secret antes del primer levantamiento con Docker (o consulta la [Sección 11.3](#113-cambiar-db_pass-en-caliente-sin-perder-datos) si ya la desplegaste).
   * Tu archivo `rclone.conf` (en Windows suele estar en `%APPDATA%\rclone\rclone.conf`) o su cadena Base64 (`RCLONE_CONF_B64`).
   * Tus llaves SSH de `~/.ssh/` si las necesitas.
4. **Cualquier otro documento personal** de *Documentos*, *Descargas*, *Escritorio* o navegadores.

---

## 2. Descargar Ubuntu Server 26.04 LTS y crear USB booteable (Rufus)

Necesitas una memoria USB de al menos **4 GB** (se formateará durante el proceso):

1. **Descarga la ISO oficial de Ubuntu Server 26.04 LTS (64-bit AMD64 / x86_64):**
   * Sitio oficial: `https://ubuntu.com/download/server`
   * Verifica que el archivo sea edición **Server** (sin entorno gráfico), por ejemplo `ubuntu-26.04-live-server-amd64.iso`.
2. **Graba la ISO en tu memoria USB con Rufus (Windows):**
   * Descarga **Rufus** desde `https://rufus.ie` (o **balenaEtcher**).
   * Configura exactamente estos valores en **Rufus**:
     * **Dispositivo:** tu memoria USB.
     * **Elección de arranque:** selecciona `ubuntu-26.04-live-server-amd64.iso`.
     * **Esquema de partición:** **`GPT`** *(si es una PC muy antigua sin UEFI, usa `MBR`)*.
     * **Sistema de destino:** **`UEFI (no CSM)`**.
     * Haz clic en **EMPEZAR**.
   * En la ventana emergente **`ISOHybrid image detected`**: selecciona **`Write in ISO Image mode (Recommended)`** y presiona **OK** *(solo usa DD mode si la BIOS de tu placa fallara al arrancar con modo ISO)*.
3. Cuando termine la barra en **LISTO**, expulsa la USB de forma segura.

---

## 3. Configurar BIOS / UEFI para servidor 24/7

Conecta el servidor por **cable Ethernet** al router (más estable y rápido que Wi-Fi para SSH y Docker) e inserta el USB booteable:

1. Enciende la PC y presiona repetidamente la tecla de BIOS o Boot Menu (`F2`, `F12`, `Del/Supr`, `F10` o `Esc` según el fabricante).
2. Ajusta estas opciones en el **BIOS/UEFI**:
   * **Desactiva `Fast Boot`** (facilita entrar al BIOS/arranque ante mantenimiento).
   * **Modo de arranque:** **`UEFI`** (recomendado) y modo SATA **`AHCI`** (evita Intel RST/RAID propietario para que Linux detecte el disco de 500 GB sin problemas).
   * **`Restore on AC Power Loss` / `AC Power Recovery`:** cámbialo a **`Power On`** (o *Last State*). Así, tras cualquier corte eléctrico, la PC vuelve a encender automáticamente sin pulsar el botón físico.
   * Si usas una laptop con la tapa cerrada, colócala en un sitio ventilado.
3. Guarda cambios (`F10`) y arranca desde la **memoria USB**.

---

## 4. Arrancar el instalador, desinstalar Windows y particionar el disco de ~500 GB

Elige **`Try or Install Ubuntu Server`** en el menú GRUB y avanza por cada pantalla del instalador de texto:

1. **Idioma (`Language`):** `English` (recomendado en servidores para logs estándar) o `Español`.
2. **Actualización del instalador (`Installer update`):** elige `Continue without updating` (o actualiza si conectaste Ethernet).
3. **Teclado (`Keyboard configuration`):** elige tu distribución (`Latin American`, `Spanish` o `English (US)`) y confirma con **`Done`**.
4. **Tipo de instalación (`Choose type of install`):** deja **`Ubuntu Server`** (instalación estándar) -> **`Done`**.
5. **Red (`Network connections`):** verás tu tarjeta Ethernet (`enp...` / `eth0`) con IP por DHCP.
   * *Recomendación:* asigna una reserva DHCP por dirección MAC en tu router para mantener fija tu IP LAN (y además usarás **Tailscale** con IP `100.x.y.z` y dominio `*.ts.net`).
6. **Proxy y Mirror:** deja Proxy vacío -> **`Done`**; deja el mirror de Ubuntu sugerido -> **`Done`**.
7. **ELIMINAR WINDOWS Y USAR TODO EL DISCO (`Guided storage configuration`):**
   * Selecciona **`Use an entire disk`** y confirma que sea tu disco duro interno de **~500 GB HDD** (NO tu USB de arranque).
   * Deja marcado **`Set up this disk as an LVM group`**.
   * **Sobre cifrado completo de disco (`Encrypt the LVM group with LUKS`):**
     * *Sin LUKS (recomendado para operación remota 24/7):* tras un apagón el servidor arranca **100 % solo** hasta levantar Docker, MySQL, Caddy y Tailscale. Tu diario privado ya viaja cifrado con `WORD_PASSWORD`.
     * *Con LUKS:* protege todo el disco si roban el hardware, pero **exige escribir contraseña con teclado físico** tras cada reinicio o corte de luz.
   * Selecciona **`Done`**.
8. **Resumen de particiones (`Storage configuration`):**
   * Verifica que aparezcan las nuevas particiones Linux (`/boot/efi`, `/boot`, `ubuntu-vg / ubuntu-lv`) y que abajo figuren las viejas particiones NTFS de Windows marcadas para eliminación.
   * **Aprovechar todo el disco de 500 GB:** el instalador a veces asigna solo 100 GB a `ubuntu-lv`; selecciónalo -> **`Edit`** -> sube el tamaño al máximo disponible (`max`) -> **`Save`**.
   * Selecciona **`Done`** y en **`Confirm destructive action`** elige **`Continue`** (esto borra Windows y formatea limpio para Ubuntu Server).

---

## 5. Configuración del sistema dentro del instalador (Red, Usuario, OpenSSH)

1. **Perfil (`Profile setup`):**
   * **Your name:** tu nombre.
   * **Your server's name:** por ejemplo `dailyhub-srv`.
   * **Pick a username:** por ejemplo `ubuntu` o `flavio` *(en minúsculas y sin espacios; en esta guía usaremos `TU_USUARIO`)*.
   * **Choose a password:** contraseña fuerte para iniciar sesión y `sudo`.
2. **Ubuntu Pro:** elige **`Skip for now`** -> **`Continue`**.
3. **Configuración SSH (`SSH Setup`):**
   * **Marca `[X] Install OpenSSH server`** (obligatorio para operar sin monitor ni teclado).
   * Deja `Import SSH identity` en `No` -> **`Done`**.
4. **Featured Server Snaps:**
   * **NO selecciones `docker` aquí.** Instalaremos **Docker Engine oficial** por `apt` en el paso 6 (el paquete Snap suele restringir rutas y volúmenes locales). Baja hasta **`Done`**.
5. **Finalizar instalación:**
   * Al ver **`Install complete!`**, selecciona **`Reboot Now`**.
   * Cuando aparezca **`Please remove the installation medium, then press ENTER`**, desconecta la memoria USB y pulsa **Enter**.

---

## 6. Post-instalación: sistema, Docker, `rclone`, SSH seguro y `sudo` para CI

Inicia sesión directamente en la PC o desde otra computadora en tu red local por SSH (`ssh TU_USUARIO@IP_LOCAL_DEL_SERVIDOR`):

### 6.1 Actualizar Ubuntu e instalar paquetes esenciales
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates openssl rclone unzip cron ufw openssh-server
```

Verifica versiones instaladas:
```bash
git --version && rclone version | head -n 2
```

### 6.2 Zona horaria, tuning para 8 GB RAM + ~500 GB HDD y cero suspensión 24/7
```bash
# 1) Ajustar zona horaria para logs, Node.js, MySQL, Python y crons
sudo timedatectl set-timezone America/Monterrey
timedatectl

# 2) Deshabilitar por completo reposo, suspensión e hibernación automática
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

# 3) Configurar Swap 2 GB (si aún no existe) y minimizar swap thrashing en HDD mecánico
sudo swapon --show
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-hdd-tuning.conf
sudo sysctl --system
```

*(Si tu servidor es una laptop y cerrarás la tapa, ejecuta también)*:
```bash
sudo sed -i 's/^#\?HandleLidSwitch=.*/HandleLidSwitch=ignore/' /etc/systemd/logind.conf
sudo sed -i 's/^#\?HandleLidSwitchExternalPower=.*/HandleLidSwitchExternalPower=ignore/' /etc/systemd/logind.conf
grep -q '^HandleLidSwitch=' /etc/systemd/logind.conf || echo 'HandleLidSwitch=ignore' | sudo tee -a /etc/systemd/logind.conf
grep -q '^HandleLidSwitchExternalPower=' /etc/systemd/logind.conf || echo 'HandleLidSwitchExternalPower=ignore' | sudo tee -a /etc/systemd/logind.conf
sudo systemctl restart systemd-logind
```

### 6.3 Instalar Docker Engine y Docker Compose v2 oficiales
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
```

Cierra la sesión SSH (`exit`), vuelve a conectar por SSH para aplicar el grupo `docker` y verifica:
```bash
docker --version
docker compose version
```

### 6.4 Configurar `rclone` (Google Drive opcional) en Ubuntu

Puedes configurar `rclone` de cualquiera de estas dos maneras:

* **Opción A (si ya tienes tu `rclone.conf` de Windows o AWS en Base64):**
  ```bash
  mkdir -p ~/.config/rclone && chmod 700 ~/.config/rclone
  echo "PEGA_AQUI_TU_CADENA_RCLONE_CONF_B64" | tr -d ' \n\r' | base64 -d > ~/.config/rclone/rclone.conf
  chmod 600 ~/.config/rclone/rclone.conf
  rclone listremotes
  ```
* **Opción B (configurar cuenta Google Drive desde cero vía SSH):**
  ```bash
  rclone config
  ```
  *(Elige `n` -> nombre `gdrive` -> `drive` -> deja client_id/secret vacíos -> scope `1` (Full access) -> `n` auto config -> pega el token obtenido desde tu PC con `rclone authorize "drive"` -> confirma). Luego valida:*
  ```bash
  rclone listremotes
  rclone ls gdrive:RespaldosApp
  # Generar la cadena Base64 de una sola línea para GitHub Secret RCLONE_CONF_B64:
  base64 -w 0 ~/.config/rclone/rclone.conf && echo ""
  ```

### 6.5 Configurar OpenSSH, llaves Ed25519 (Admin + GitHub Actions) y `sudo` sin contraseña

1. **Asegurar servicio SSH y carpeta `~/.ssh`:**
   ```bash
   sudo systemctl enable --now ssh
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
   ```
2. **Llave SSH de administrador desde tu laptop Windows (PowerShell):**
   ```powershell
   # Solo si aún no tienes ~/.ssh/id_ed25519.pub:
   ssh-keygen -t ed25519 -C "admin-dailyhub"
   # Enviar llave pública al servidor Ubuntu:
   type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh TU_USUARIO@IP_LOCAL "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
   ```
3. **Llave SSH exclusiva para GitHub Actions (`SERVER_SSH_KEY` / `EC2_SSH_KEY`):**
   Genera el par Ed25519 directamente en RAM (`/dev/shm`) dentro de Ubuntu (sin passphrase para CI):
   ```bash
   ssh-keygen -t ed25519 -N "" -C "github-actions-deploy" -f /dev/shm/github_actions_dailyhub
   cat /dev/shm/github_actions_dailyhub.pub >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   echo "--- COPIA ESTA LLAVE PRIVADA COMPLETA AL SECRET SERVER_SSH_KEY EN GITHUB ---"
   cat /dev/shm/github_actions_dailyhub
   ```
   En cuanto pegues el bloque completo (`-----BEGIN OPENSSH PRIVATE KEY-----` ... `-----END OPENSSH PRIVATE KEY-----`) en GitHub Secrets, bórrala de RAM:
   ```bash
   shred -u -z -n 1 /dev/shm/github_actions_dailyhub /dev/shm/github_actions_dailyhub.pub
   ```
4. **Habilitar `sudo` sin contraseña para despliegues automáticos por SSH:**
   ```bash
   echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee "/etc/sudoers.d/90-${USER}-nopasswd"
   sudo chmod 440 "/etc/sudoers.d/90-${USER}-nopasswd"
   sudo visudo -cf "/etc/sudoers.d/90-${USER}-nopasswd"
   ```
5. **Desactivar login por contraseña en OpenSSH** *(ejecútalo SOLO después de verificar en otra terminal que ya entras con tu llave SSH)*:
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
   > No cierres la sesión SSH actual tras `reload ssh`: abre **otra terminal** y prueba entrar con `ssh TU_USUARIO@IP_LOCAL` antes de cerrar la primera.

---

## 7. Instalar Tailscale (OAuth CI + HTTPS Serve al Balanceador) y Firewall UFW

### 7.1 Instalar y vincular Tailscale en Ubuntu Server
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Verifica tu IP y dominio MagicDNS asignados:
```bash
tailscale ip -4
tailscale status
```

En la consola web de Tailscale (`https://login.tailscale.com/admin/machines`):
* En tu servidor (`dailyhub-srv`) abre `...` -> **`Disable key expiry`** para que no caduque la autenticación.
* En la pestaña **DNS**, confirma que **MagicDNS** y **HTTPS Certificates** estén activados.

### 7.2 Configurar Tailscale OAuth para que GitHub Actions despliegue por SSH privado

1. En **Tailscale Admin Console** -> **Access controls** (ACLs), declara `tag:ci` bajo `tagOwners`:
   ```json
   "tagOwners": {
     "tag:ci": ["autogroup:admin"]
   }
   ```
2. En **Settings** -> **OAuth clients** -> **Generate OAuth client**:
   * **Description:** `GitHub Actions Deploy`
   * **Scopes:** **`Auth Keys`** -> **`Write`** con tag **`tag:ci`**.
3. Guarda **Client ID** en el GitHub Secret **`TS_OAUTH_CLIENT_ID`** y **Client Secret** en **`TS_OAUTH_SECRET`**.

### 7.3 Firewall UFW (acceso privado exclusivo vía `tailscale0`)
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
# Permitir tráfico HTTPS Serve y SSH únicamente dentro del túnel cifrado Tailscale
sudo ufw allow in on tailscale0
# Temporal mientras validas Tailscale SSH (luego bórralo con: sudo ufw delete allow 22/tcp)
sudo ufw allow 22/tcp
sudo ufw enable
sudo ufw status verbose
```

Cuando compruebes desde tu laptop conectada a Tailscale que `ssh TU_USUARIO@<tu-servidor>.<tu-tailnet>.ts.net` entra bien, cierra el puerto `22/tcp` en tu red LAN local:
```bash
sudo ufw delete allow 22/tcp
sudo ufw status verbose
```

### 7.4 Activar Tailscale Serve apuntando al Balanceador Caddy (`127.0.0.1:8080`)

La arquitectura local encadena el túnel cifrado de Tailscale directo hacia el **balanceador Caddy (`mood_proxy`)**, que reparte las peticiones con *sticky sessions* (`pdh_lb`) entre ambas réplicas de Node.js:

```text
Celular / PC (HTTPS :443 en *.ts.net)
   └──► Tailscale Serve (TLS 1.3)
           └──► Caddy mood_proxy (127.0.0.1:8080 · sticky cookie pdh_lb · health_uri /healthz)
                   ├──► mood_app  (:3000 · schedulers activos)
                   └──► mood_app2 (:3000 · réplica failover sin schedulers duplicados)
                           └──► mood_db (MySQL 8.0 + advisory locks GET_LOCK para .docx)
```

Una vez levantados los contenedores Docker (Paso 8), ejecuta:
```bash
# Si alguna vez apuntaste Tailscale a :3000, limpia primero con: sudo tailscale serve reset
sudo tailscale serve --bg http://127.0.0.1:8080
tailscale serve status
```

* Tu app quedará disponible de forma privada con certificado TLS válido en `https://<tu-servidor>.<tu-tailnet>.ts.net`.
* **Sobre el Minireproductor de YouTube en *Learn with Music*:** funciona sin problema bajo Tailscale HTTPS porque el navegador de tu celular o PC carga el `<iframe>` oficial de YouTube directamente (sin pasar audio por tu servidor ni consumir tu CPU). Accede siempre por la URL `https://*.ts.net` (no por HTTP plano) para que no falle el header `Referer` de YouTube.

---

## 8. Migrar archivos, desplegar vía GitHub Actions o manual y restaurar BD

### 8.1 Crear carpetas de datos y migrar archivos Word locales

En Ubuntu Server, crea las carpetas con permisos estrictos (`700`):
```bash
mkdir -p ~/projects/mood-tracker/data/journal \
         ~/projects/mood-tracker/data/ytdlp \
         ~/projects/mood-tracker/english-notes \
         ~/projects/mood-tracker/logs \
         ~/projects/respaldos
chmod 700 ~/projects/mood-tracker/data \
          ~/projects/mood-tracker/data/journal \
          ~/projects/mood-tracker/data/ytdlp \
          ~/projects/mood-tracker/english-notes \
          ~/projects/mood-tracker/logs \
          ~/projects/respaldos
```

Copia desde Windows PowerShell hacia Ubuntu Server (usando tu USB o `scp` con la ruta donde guardaste tu respaldo):
```powershell
scp "C:\respaldo\Diario.docx" TU_USUARIO@IP_O_DOMINIO_TS:~/projects/mood-tracker/data/journal/Diario.docx
scp "C:\respaldo\English_Learning_Notebook.docx" TU_USUARIO@IP_O_DOMINIO_TS:~/projects/mood-tracker/english-notes/English_Learning_Notebook.docx
```

Asegura propiedad y permisos `600` dentro de Ubuntu Server:
```bash
sudo chown -R "$(id -u):$(id -g)" ~/projects/mood-tracker/data ~/projects/mood-tracker/english-notes ~/projects/mood-tracker/logs
chmod 600 ~/projects/mood-tracker/data/journal/Diario.docx 2>/dev/null || true
chmod 600 ~/projects/mood-tracker/english-notes/English_Learning_Notebook.docx 2>/dev/null || true
```

*(Opcional si YouTube llega a pedir cookies de sesión para subtítulos difíciles)*: coloca tu archivo Netscape `cookies.txt` en `~/projects/mood-tracker/data/ytdlp/cookies.txt` (`chmod 600`) y declara `YTDLP_COOKIES_PATH=/app/ytdlp-config/cookies.txt`.

### 8.2 Despliegue Opción A (Recomendado): GitHub Actions automático (100 % en RAM)

`.github/workflows/deploy.yml` construye la configuración en `/dev/shm` (RAM), levanta los 4 contenedores (`mood_db`, `mood_app`, `mood_app2`, `mood_proxy`), restaura la BD desde Google Drive si está vacía (`./scripts/restore.sh --if-empty`), registra los crons y elimina cualquier `.env` en disco cuando `SEAL_ENV_AFTER_DEPLOY=true`.

#### **Repository Secrets** (`Settings -> Secrets and variables -> Actions -> Secrets`)
| Secret | Estado | Descripción |
| :--- | :--- | :--- |
| **`SERVER_SSH_KEY`** *(o `EC2_SSH_KEY`)* | **Obligatorio** | Llave privada Ed25519 agregada a `~/.ssh/authorized_keys` (Paso 6.5). |
| **`TS_OAUTH_CLIENT_ID`** | **Recomendado** | Client ID OAuth de Tailscale (`Auth Keys: Write`, `tag:ci`). |
| **`TS_OAUTH_SECRET`** | **Recomendado** | Client Secret OAuth de Tailscale para SSH privado desde GitHub Actions. |
| `DB_PASS` | **Obligatorio** | Contraseña de MySQL (`mood_db`). Puedes definir aquí tu contraseña nueva más fuerte antes del primer arranque. |
| `ADMIN_EMAIL` | **Obligatorio** | Correo administrador para login y códigos de seguridad. |
| `ADMIN_SECRET` | **Obligatorio** | Clave secreta personal de registro de administrador. |
| `WORD_PASSWORD` | **Obligatorio** | Contraseña real del archivo cifrado `Diario.docx`. |
| `JOURNAL_SECRET_KEY` | **Obligatorio** | Llave E2EE exacta de 32 caracteres. |
| `SMTP_USER` | **Obligatorio** | Cuenta Gmail emisora de códigos. |
| `SMTP_PASS` | **Obligatorio** | Contraseña de aplicación Gmail (16 caracteres). |
| `RCLONE_CONF_B64` | **Obligatorio p/ Drive** | Salida en una línea de `base64 -w 0 ~/.config/rclone/rclone.conf`. |
| `GEMINI_API_KEY` | **Recomendado** | Clave de Google AI Studio para *Language Studio*. |
| `STUDY_RCLONE_CONF_B64` | Opcional | Segunda cuenta Google Drive separada exclusiva para notas de estudio. |
| `YOUTUBE_API_KEY` | Opcional | Clave YouTube Data v3 (búsquedas extendidas). |

#### **Repository Variables** (`Settings -> Secrets and variables -> Actions -> Variables`)
| Variable | Valor sugerido | Estado | Notas |
| :--- | :--- | :--- | :--- |
| `SERVER_HOST` *(o `EC2_HOST`)* | `dailyhub-srv.tailXXXX.ts.net` | **Actualizar** | Reemplaza la antigua IP de AWS EC2. |
| `SERVER_USER` *(o `EC2_USER`)* | Tu usuario Ubuntu *(ej. `ubuntu`)* | **Verificar** | Usuario con `NOPASSWD:ALL` en Ubuntu Server. |
| `APP_BASE_URL` | `https://dailyhub-srv.tailXXXX.ts.net` | **Recomendado** | URL HTTPS de Tailscale Serve. |
| `DB_HOST` | `db` | Mantener | Nombre del servicio MySQL en Docker Compose. |
| `DB_NAME` | `MoodTrackerLocal` | Mantener | Nombre de la base de datos. |
| `DB_USER` | `root` | Mantener | Usuario MySQL. |
| `PORT` | `3000` | Mantener | Puerto interno de `app` y `app2`. |
| `SITE_ADDRESS` | `:80` | **Nuevo/Mantener** | Dirección interna de escucha de Caddy (`mood_proxy`). |
| `PROXY_HTTP_PORT` | `8080` | **Nuevo/Mantener** | Puerto loopback del balanceador Caddy (`127.0.0.1:8080`). |
| `TZ` | `America/Monterrey` | Mantener | Zona horaria unificada para contenedores y crons. |
| `RCLONE_REMOTE` | `gdrive` | Mantener | Nombre exacto del remoto en `RCLONE_CONF_B64`. |
| `RCLONE_BACKUP_DIR` | `RespaldosApp` | Mantener | Carpeta destino de respaldos en Google Drive. |
| `DB_RETENTION_DAYS` | `0` | **Añadir (`0`)** | Conserva todo el histórico local sin podar registros en MySQL. |
| `REQUIRE_DRIVE_BACKUP` | `true` | **Recomendado** | Valida subida real a Drive en cada respaldo/deploy. |
| `SEAL_ENV_AFTER_DEPLOY` | `true` | Mantener | Destruye el `.env` temporal tras levantar contenedores y guarda `.backup.meta`. |
| `BACKUP_CRON_SCHEDULE` | `30 3 * * *` | Mantener | Horario diario de `scripts/backup.sh`. |
| `AWS_HOST` / `WORD_FILE_PATH` / `YT_DLP_PATH` | *(Eliminar)* | **Obsoletas** | Ya no se usan en el servidor Ubuntu local. |

Para lanzar el despliegue ve a GitHub -> **Actions -> Deploy to Ubuntu Server (Tailscale / SSH) -> Run workflow** (o haz `git push origin main`). Después conecta Tailscale Serve al balanceador:
```bash
sudo tailscale serve --bg http://127.0.0.1:8080
tailscale serve status
```

### 8.3 Despliegue Opción B: Manual paso a paso en el servidor local

Si prefieres levantar o probar todo manualmente por SSH sin esperar a GitHub Actions:

```bash
# 1) Clonar el repositorio (si aún no está clonado)
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/TU_USUARIO_GH/TU_REPO.git mood-tracker
cd ~/projects/mood-tracker

# 2) Preparar .env con permisos estrictos 600
cp .env.example .env
chmod 600 .env
```

Edita `.env` con `nano .env` y asegúrate de configurar al menos estos valores clave:
```dotenv
DB_HOST=db
DB_USER=root
DB_PASS=TU_CONTRASENA_MYSQL_SEGURA
DB_NAME=MoodTrackerLocal
PORT=3000
TZ=America/Monterrey
APP_UID=1000   # Confirma el tuyo con: id -u
APP_GID=1000   # Confirma el tuyo con: id -g

ADMIN_EMAIL=tu_correo@ejemplo.com
ADMIN_SECRET=tu_clave_secreta_admin
SMTP_USER=tu_correo_envio@gmail.com
SMTP_PASS=tu_app_password_16_letras
WORD_PASSWORD=tu_contrasena_real_de_word
JOURNAL_SECRET_KEY=tu_llave_e2ee_exacta_de_32_caracteres
GEMINI_API_KEY=tu_api_key_gemini

APP_BASE_URL=https://tu-servidor.tu-tailnet.ts.net
TRUST_PROXY=2
REQUIRE_HTTPS=true
REQUIRE_PC_BRIDGE_AUTH=true
SITE_ADDRESS=:80
PROXY_HTTP_PORT=8080
PROXY_HTTPS_PORT=8443

SERVER_AUTONOMOUS_NOTES=true
RCLONE_REMOTE=gdrive
RCLONE_BACKUP_DIR=RespaldosApp
DB_RETENTION_DAYS=0
```

*(Tip rápido para inyectar automáticamente tus IDs reales de usuario Ubuntu en `.env`)*:
```bash
sed -i "s/^APP_UID=.*/APP_UID=$(id -u)/; s/^APP_GID=.*/APP_GID=$(id -g)/" .env
```

Levanta la base de datos y ambas réplicas + balanceador Caddy:
```bash
# 3) Construir y arrancar los 4 contenedores (mood_db, mood_app, mood_app2, mood_proxy)
docker compose up -d --build

# 4) Esperar a que todos reporten (healthy)
docker compose ps

# 5) Restaurar tu base de datos desde Google Drive (si ya respaldaste desde AWS en el Paso 1.1)
chmod +x scripts/backup.sh scripts/restore.sh scripts/env-vault.sh scripts/verify-ubuntu-local.sh
./scripts/restore.sh --if-empty
# *(Si deseas sobreescribir una BD recién inicializada con el respaldo de Drive usa: ./scripts/restore.sh --force)*

# 6) Conectar Tailscale Serve HTTPS hacia el balanceador Caddy
sudo tailscale serve --bg http://127.0.0.1:8080
tailscale serve status

# 7) Opcional recomendado: sellar .env en texto plano dentro de .env.enc (AES-256-CBC + PBKDF2)
./scripts/env-vault.sh encrypt
./scripts/env-vault.sh status
```

*(Si despliegas manualmente sin `deploy.yml`, registra también los crons nocturnos de respaldo y actualización semanal de `yt-dlp`)*:
```bash
mkdir -p "$HOME/projects/respaldos" && chmod 700 "$HOME/projects/respaldos"
CRON_BAK="30 3 * * * $HOME/projects/mood-tracker/scripts/backup.sh --require-drive >> $HOME/projects/respaldos/backup.log 2>&1"
CRON_YTDLP="0 4 * * 0 (docker exec -u 0 mood_app yt-dlp -U || true) && (docker exec -u 0 mood_app2 yt-dlp -U || true) >> $HOME/projects/respaldos/ytdlp-update.log 2>&1"
(crontab -l 2>/dev/null | grep -v "scripts/backup.sh" | grep -v "yt-dlp -U" || true; printf '%s\n%s\n' "$CRON_BAK" "$CRON_YTDLP") | crontab -
crontab -l
```

---

## 9. Verificación del Balanceador, 4 Contenedores, Google Drive, `yt-dlp` y App Web

### 9.1 Verificación automatizada completa (`[1/10]`–`[10/10]`)
```bash
cd ~/projects/mood-tracker
./scripts/verify-ubuntu-local.sh
```

Este script audita automáticamente las 10 secciones:
* **`[1/10]`–`[2/10]`:** Hardware/RAM/HDD (`vm.swappiness`) y estado `running (healthy)` de los **4 contenedores** (`mood_db`, `mood_app`, `mood_app2`, `mood_proxy`) + tuning InnoDB.
* **`[3/10]`–`[6/10]`:** Red loopback (`127.0.0.1`), UFW, `tailscale serve`, `node` + `tzdata`, `python3` + `msoffcrypto OOXMLFile`, `yt-dlp --js-runtimes node` + `ffmpeg`.
* **`[7/10]`–`[8/10]`:** Salud en `127.0.0.1:3000/healthz` **y** balanceador Caddy en `127.0.0.1:8080/healthz` con sticky cookie `pdh_lb` + `X-Replica-Id`, carga local de `/vendor/crypto-js.min.js` sin CDNs, HTTPS/HSTS/426/CORS y permisos en `./data/journal`, `./english-notes`, `./logs`.
* **`[9/10]`–`[10/10]`:** Conectividad con Google Drive (`rclone`), existencia de `respaldo_mood_tracker.sql.gz` y `historico_completo.json.gz`, cron de `yt-dlp -U`, hardening de contenedores, cero `.env` plano, `tcp_syncookies`, `PasswordAuthentication no`, `fail2ban`, `unattended-upgrades` y `/proc` con `hidepid=2`.

### 9.2 Probar manualmente el Balanceador de Cargas y Failover (Zero-Downtime)

```bash
# 1) Primera petición al balanceador Caddy: observa Set-Cookie: pdh_lb=... y X-Replica-Id: app (o app2)
curl -i http://127.0.0.1:8080/healthz

# 2) Guardar cookie y verificar Sticky Session (misma réplica en múltiples peticiones)
COOKIE_LB=$(curl -sD - -o /dev/null http://127.0.0.1:8080/healthz | grep -i '^Set-Cookie:' | sed -n 's/.*\(pdh_lb=[^;]*\).*/\1/p' | head -n 1)
curl -i -H "Cookie: $COOKIE_LB" http://127.0.0.1:8080/healthz
curl -i -H "Cookie: $COOKIE_LB" http://127.0.0.1:8080/healthz

# 3) Prueba real de Failover: detener una réplica y comprobar que el balanceador sigue sirviendo sin caída
docker stop mood_app2
curl -i http://127.0.0.1:8080/healthz   # Debe seguir devolviendo HTTP 200 con X-Replica-Id: app

# 4) Volver a levantar mood_app2 y esperar que regrese a healthy
docker start mood_app2
docker compose ps
```

### 9.3 Respaldos Google Drive vs almacenamiento estrictamente local

* **En Google Drive (`${RCLONE_REMOTE}:${RCLONE_BACKUP_DIR}`, ej. `gdrive:RespaldosApp`):**
  * `respaldo_mood_tracker.sql.gz` (volcado diario completo de MySQL).
  * `historico_sql/respaldo_YYYY-MM.sql.gz` (instantánea SQL mensual).
  * `historico_completo.json.gz` (archivo histórico JSON acumulativo).
  * `NotasIdiomas/English_Learning_Notebook.docx` (sincronizado con lock distribuido `pdh_docx_english`).
* **100 % solo en disco local Ubuntu (NUNCA se sube a Google Drive):**
  * `./data/journal/Diario.docx` y sus copias rotativas diarias (30 días) en `~/projects/respaldos/journal_local_backups/` (cifradas con `WORD_PASSWORD`, coordinadas con lock `pdh_docx_journal`).

Comandos de respaldo y logs:
```bash
# Respaldo manual exigiendo verificación en Drive
~/projects/mood-tracker/scripts/backup.sh --require-drive
rclone lsl gdrive:RespaldosApp

# Logs de backups y de ambas réplicas (app y app2)
tail -n 30 ~/projects/respaldos/backup.log
tail -n 40 ~/projects/mood-tracker/logs/server.log
tail -n 40 ~/projects/mood-tracker/logs/app2/server.log
tail -n 30 ~/projects/mood-tracker/logs/error.log
```

*(Nota: el cron semanal `deploy.yml` actualiza `yt-dlp` automáticamente cada domingo a las 4:00 AM en **ambas** réplicas: `mood_app` y `mood_app2`).*

### 9.4 Checklist rápido en la app web
1. **Acceso HTTPS privado:** entra desde celular/PC (con Tailscale activo) a `https://<tu-servidor>.<tu-tailnet>.ts.net`.
2. **Módulo de Música (Catálogo y Modal):** verifica que el catálogo use el ancho completo, abre **`➕ Registrar Nueva Canción`** para probar la ventana emergente (`Auto-fill` con URL de YT Music o YouTube normal, con año independiente sin álbum obligatorio), y prueba el botón **`Reproductor`** dentro de Tailscale HTTPS.
3. **Extracción multi-fuente de letras y estudio:** usa **`📄 Extraer letra`**, navega por las pestañas (`Original`, `Coreano`, `Inglés`, `Japonés`, `Español`) y pulsa **`✨ Analizar Estrofas`** directo sobre la letra cargada.
4. **Word local y Cuaderno Drive:** guarda una nota en *Journal Notes* (confirma `./data/journal/Diario.docx` cifrado) y una en *Language Studio* (confirma `rclone ls gdrive:RespaldosApp/NotasIdiomas`).

---

## 10. Seguridad avanzada: HTTPS total, secretos blindados, anti-hackers y anti-DoS/DDoS

### 10.1 Cifrado extremo a extremo en tránsito (4 capas simultáneas)
Todo el tráfico hacia tu servidor viaja cifrado en **4 capas**:
1. **Capa 1 — Túnel WireGuard (Tailscale):** red privada cifrada (`100.x.y.z` / `*.ts.net`) con **0 puertos abiertos** en tu router.
2. **Capa 2 — HTTPS TLS 1.3 (`tailscale serve` -> Caddy `mood_proxy` `127.0.0.1:8080` + `REQUIRE_HTTPS=true`):**
   * Caddy recibe el `X-Forwarded-Proto: https` confiable desde Tailscale (`trusted_proxies static private_ranges`) y lo reenvía a `mood_app` / `mood_app2`.
   * Node responde **HSTS** (`Strict-Transport-Security: max-age=31536000; includeSubDomains`), activa CSP `upgrade-insecure-requests`, marca cookies de sesión como **`HttpOnly; Secure; SameSite=Lax`** y rechaza tráfico sin TLS (`HTTP 426` en `/api/*` o redirección `308` a `https://`, salvo `/healthz`).
   * **CORS estricto:** solo permite `APP_BASE_URL`, el propio `Host`, loopback y orígenes `*.ts.net`.
3. **Capa 3 — Túnel de Transporte (`TransportCrypto`):** cifrado adicional dentro de `/api/*` (**X25519 + HKDF-SHA256 + AES-256-CTR + HMAC-SHA256**; las sesiones ECDH en RAM funcionan sin fallos entre réplicas gracias al sticky routing `pdh_lb`).
4. **Capa 4 — Cifrado E2EE de notas (`JOURNAL_SECRET_KEY`):** sobres **AES-256-CBC** cifrados en el navegador antes de viajar por la red.

**Comandos para comprobar HTTPS estricto y CORS a través del balanceador (`127.0.0.1:8080`):**
```bash
# 1) Debe devolver HTTP 426 porque /api/* exige HTTPS cuando REQUIRE_HTTPS=true
curl -i http://127.0.0.1:8080/api/auth/me

# 2) Simulando Tailscale Serve HTTPS: debe incluir Strict-Transport-Security y Set-Cookie: pdh_lb=
curl -I -H "X-Forwarded-Proto: https" http://127.0.0.1:8080/

# 3) Origen externo hostil: NO debe devolver Access-Control-Allow-Origin: https://evil.example
curl -i -H "X-Forwarded-Proto: https" -H "Origin: https://evil.example" http://127.0.0.1:8080/api/auth/me
```

### 10.2 Protección de `.env`, contraseñas y secretos en disco

> [!IMPORTANT]
> **Realidad de seguridad en Linux:** ningún sistema operativo impide que un atacante con privilegios reales de **`root`** inspeccione la memoria de procesos activos. Por eso protegemos dos frentes: evitar que alguien llegue a tu usuario/`root`, e impedir que se lean secretos en disco o desde otra cuenta local.

1. **Cero `.env` plano en disco y logs sanitizados:**
   * En GitHub Actions usa `SEAL_ENV_AFTER_DEPLOY=true` (crea el entorno temporal en `/dev/shm` y aplica `shred`).
   * En despliegue manual usa `./scripts/env-vault.sh encrypt` (**AES-256-CBC + PBKDF2 600,000 iteraciones**).
   * `./logs/server.log`, `./logs/app2/server.log` y `./logs/error.log` redactan automáticamente `DB_PASS`, `WORD_PASSWORD`, `JOURNAL_SECRET_KEY`, API keys `AIza...`, `tskey-...`, `ghp_...`, cookies `mt_session=` y llaves privadas.
2. **Aislar `/proc` entre usuarios locales (`hidepid=2`):**
   ```bash
   sudo cp /etc/fstab /etc/fstab.bak
   if ! grep -qE '^\s*proc\s+/proc\s' /etc/fstab; then
     echo 'proc /proc proc defaults,hidepid=2 0 0' | sudo tee -a /etc/fstab
   else
     sudo sed -i 's|^\(\s*proc\s\+/proc\s\+proc\s\+[^ ]*\)|\1,hidepid=2|' /etc/fstab
   fi
   sudo mount -o remount /proc
   grep -E '\s/proc\s' /proc/mounts
   ```
3. **Bloquear permisos de directorios personales, `rclone`, SSH y datos:**
   ```bash
   chmod 700 "$HOME" "$HOME/.ssh" "$HOME/.config" "$HOME/.config/rclone" "$HOME/projects" "$HOME/projects/respaldos"
   chmod 600 "$HOME/.ssh/authorized_keys" "$HOME/.config/rclone/rclone.conf"
   chmod 600 "$HOME/projects/respaldos/.backup.meta" 2>/dev/null || true
   chmod 700 "$HOME/projects/mood-tracker/data" "$HOME/projects/mood-tracker/data/journal" \
             "$HOME/projects/mood-tracker/english-notes" "$HOME/projects/mood-tracker/logs"
   getent group sudo docker adm
   ```

### 10.3 Blindaje anti-hackers (red invisible, Tailscale ACL, Fail2ban, parches y `auditd`)

1. **Red 100 % invisible hacia Internet y LAN:** no abras puertos en tu router (`Port Forwarding = 0`). Todos los puertos Docker escuchan solo en `127.0.0.1` (`3000`, `3306`, `8080`, `8443`):
   ```bash
   ss -lntup
   ```
2. **Reglas ACL estrictas en Tailscale Admin Console (`Access Controls`):**
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
   *(Etiqueta tu servidor con `tag:server` en Tailscale Admin Console -> Machines -> `...` -> Edit ACL tags).*
3. **Instalar `Fail2ban` contra fuerza bruta SSH:**
   ```bash
   sudo apt update && sudo apt install -y fail2ban
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
4. **Parches de seguridad automáticos (`unattended-upgrades`):**
   ```bash
   sudo apt install -y unattended-upgrades apt-listchanges
   sudo dpkg-reconfigure -f noninteractive unattended-upgrades
   systemctl status apt-daily.timer apt-daily-upgrade.timer --no-pager
   ```
5. **Endurecimiento extra de OpenSSH:**
   ```bash
   sudo tee /etc/ssh/sshd_config.d/99-hardening.conf >/dev/null <<EOF
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
   AllowUsers $USER
   EOF
   sudo sshd -t && sudo systemctl reload ssh
   ```
6. **AppArmor + Auditoría de archivos sensibles (`auditd` / `rkhunter`):**
   ```bash
   sudo apt install -y auditd rkhunter
   sudo tee /etc/audit/rules.d/99-dailyhub-watch.rules >/dev/null <<EOF
   -w /home/$USER/.ssh/authorized_keys -p wa -k ssh_keys_watch
   -w /etc/sudoers.d -p wa -k sudoers_watch
   -w /home/$USER/.config/rclone/rclone.conf -p wa -k secrets_watch
   -w /home/$USER/projects/mood-tracker/data/journal/Diario.docx -p wa -k journal_watch
   EOF
   sudo augenrules --load && sudo systemctl enable --now auditd
   sudo aa-status | head -n 15
   sudo ausearch -k ssh_keys_watch --start recent || true
   ```

### 10.4 Defensa contra ataques de Denegación de Servicio (DoS / DDoS) y aislamiento

1. **Nivel Red:** detrás de Tailscale y UFW no existe puerto público que inundar.
2. **Nivel Kernel Linux (`sysctl` contra SYN flood, ICMP flood e IP spoofing):**
   ```bash
   sudo tee /etc/sysctl.d/99-security-dos.conf >/dev/null <<'EOF'
   net.ipv4.tcp_syncookies = 1
   net.ipv4.tcp_max_syn_backlog = 2048
   net.ipv4.tcp_synack_retries = 2

   net.ipv4.conf.all.rp_filter = 1
   net.ipv4.conf.default.rp_filter = 1
   net.ipv4.conf.all.accept_redirects = 0
   net.ipv4.conf.default.accept_redirects = 0
   net.ipv4.conf.all.send_redirects = 0
   net.ipv4.conf.all.accept_source_route = 0

   net.ipv4.icmp_echo_ignore_broadcasts = 1
   net.ipv4.icmp_ignore_bogus_error_responses = 1
   net.ipv4.conf.all.log_martians = 1
   EOF
   sudo sysctl --system
   ```
3. **Nivel Caddy + Node.js:** `max_size 16MB`, `keepAliveTimeout=15000`, `headersTimeout=20000`, `requestTimeout=90000`, `maxHeadersCount=64` (anti-Slowloris), rate limiters con mapa acotado en RAM, `runWithHeavyTaskLock` FIFO en cada réplica y locks distribuidos MySQL `GET_LOCK` (`pdh_docx_journal` / `pdh_docx_english`) entre `mood_app` y `mood_app2`.
4. **Nivel Docker y Disco (~500 GB HDD):** los 4 contenedores tienen cuotas estrictas en `docker-compose.yml` para proteger los **8 GB de RAM**:
   * `mood_db`: `1024m` RAM / `2.0` CPUs / `256` PIDs
   * `mood_app`: `1024m` RAM / `2.0` CPUs / `128` PIDs
   * `mood_app2`: `1024m` RAM / `2.0` CPUs / `128` PIDs
   * `mood_proxy`: `64m` RAM / `0.5` CPUs / `64` PIDs
   * Todos corren sin privilegios (`no-new-privileges:true`, `cap_drop: ALL`), con rotación de logs Docker (`10m x 3`) y `/tmp` + `/dev/shm` montados con `noexec,nosuid,nodev`.
   * Restauración rápida ante corrupción desde Drive:
     ```bash
     # Si existe .env plano en disco:
     ./scripts/restore.sh --force
     # Si .env está cifrado en bóveda .env.enc:
     ./scripts/env-vault.sh restore --force
     ```

---

## 11. Operación diaria, cambio seguro de `DB_PASS` y solución de problemas

### 11.1 Monitoreo rápido de los 4 contenedores
```bash
cd ~/projects/mood-tracker
docker compose ps
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' mood_db mood_app mood_app2 mood_proxy
docker compose logs --tail=60 -f proxy app app2
```

### 11.2 Reinicio o actualización manual sin tiempo de caída (Rolling Restart)
```bash
# Reiniciar una réplica a la vez sin cortar peticiones en el balanceador Caddy
cd ~/projects/mood-tracker
docker compose restart app2 && sleep 5 && docker compose restart app
```

Para actualizar código manualmente sin GitHub Actions *(cambia `up -d --build` por `./scripts/env-vault.sh up` si sellaste `.env` en `.env.enc`)*:
```bash
cd ~/projects/mood-tracker
git pull origin main
docker compose up -d --build --no-deps app2 && sleep 8 && docker compose up -d --build --no-deps app && docker compose up -d proxy
```

### 11.3 Cambiar `DB_PASS` en caliente sin perder datos

Si ya tienes la base de datos con registros en MySQL y deseas rotar `DB_PASS`:

```bash
cd ~/projects/mood-tracker

# 1) Respaldo de seguridad obligatorio ANTES de tocar contraseñas
./scripts/backup.sh --require-drive

# 2) Entrar al contenedor MySQL y actualizar la contraseña para localhost y contenedores internos (%)
#    (Si sellaste .env en .env.enc, reemplaza ${DB_PASS} escribiendo tu contraseña actual manualmente)
source .env 2>/dev/null || true
docker exec -e MYSQL_PWD="$DB_PASS" mood_db mysql -u root -e \
  "ALTER USER 'root'@'%' IDENTIFIED BY 'TU_NUEVA_CONTRASENA_SEGURA';
   ALTER USER 'root'@'localhost' IDENTIFIED BY 'TU_NUEVA_CONTRASENA_SEGURA';
   FLUSH PRIVILEGES;"

# 3) Actualiza el Secret DB_PASS en GitHub (si usas deploy.yml) o edita .env / .env.enc y recrea contenedores:
sed -i "s/^DB_PASS=.*/DB_PASS=TU_NUEVA_CONTRASENA_SEGURA/" .env
docker compose up -d --force-recreate db app app2 proxy
docker compose ps
```

### 11.4 Mantenimiento frecuente (Drive, permisos, `yt-dlp`)

* **Si caduca o falla el token de Google Drive (`rclone`):**
  ```bash
  rclone config reconnect gdrive:
  rclone lsl gdrive:RespaldosApp
  # Si usas GitHub Actions, actualiza el Secret RCLONE_CONF_B64 con la nueva salida de:
  base64 -w 0 ~/.config/rclone/rclone.conf && echo ""
  ```
* **Si algún archivo en `data/`, `english-notes/` o `logs/` queda con permisos erróneos:**
  ```bash
  sudo chown -R "$(id -u):$(id -g)" ~/projects/mood-tracker/data ~/projects/mood-tracker/english-notes ~/projects/mood-tracker/logs
  ```
* **Actualizar `yt-dlp` manualmente en el host y ambas réplicas:**
  ```bash
  sudo /usr/local/bin/yt-dlp -U || true
  docker exec -u 0 mood_app yt-dlp -U
  docker exec -u 0 mood_app2 yt-dlp -U
  ```
