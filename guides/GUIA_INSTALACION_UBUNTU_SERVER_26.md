# Guía Paso a Paso: Instalación Mínima de Ubuntu Server 26.04 LTS y Despliegue 100 % Automático con GitHub Actions — Personal Daily Hub

> Guía optimizada para convertir una PC local (Intel Core i7, ~8 GB RAM, ~500 GB HDD) en un **servidor Ubuntu Server 26.04 LTS 100 % autónomo y local**. Tú solo instalas lo mínimo indispensable (**Ubuntu Server + llave SSH/`sudo` + Docker + Tailscale**), ajustas las **GitHub Variables** y, con solo hacer **merge a la rama `main`**, [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) instala dependencias, configura el sistema, endurece la seguridad, levanta los **4 contenedores Docker** (`mood_db`, `mood_app`, `mood_app2`, `mood_proxy`), restaura la base de datos desde Google Drive, activa **Tailscale HTTPS Serve** y ejecuta la verificación completa `[1/10]`–`[10/10]`.

---

## Índice

| Paso | Sección |
| :--- | :--- |
| 1 | [1. Respaldo previo: AWS a Google Drive y archivos locales](#1-respaldo-previo-aws-a-google-drive-y-archivos-locales) |
| 2 | [2. Descargar Ubuntu Server 26.04 LTS y crear USB booteable (Rufus)](#2-descargar-ubuntu-server-2604-lts-y-crear-usb-booteable-rufus) |
| 3 | [3. Configurar BIOS / UEFI para servidor 24/7](#3-configurar-bios--uefi-para-servidor-247) |
| 4 | [4. Arrancar el instalador, desinstalar Windows y particionar el disco de ~500 GB](#4-arrancar-el-instalador-desinstalar-windows-y-particionar-el-disco-de-500-gb) |
| 5 | [5. Configuración del sistema dentro del instalador (Red, Usuario, OpenSSH)](#5-configuración-del-sistema-dentro-del-instalador-red-usuario-openssh) |
| 6 | [6. Preparación MÍNIMA en Ubuntu Server (SSH + `sudo`, Docker, Tailscale y Word)](#6-preparación-mínima-en-ubuntu-server-ssh--sudo-docker-tailscale-y-word) |
| 7 | [7. Configurar Variables y Secrets en GitHub (sin perder tus Secrets actuales)](#7-configurar-variables-y-secrets-en-github-sin-perder-tus-secrets-actuales) |
| 8 | [8. Merge a `main` = Despliegue y Configuración Total Automática](#8-merge-a-main--despliegue-y-configuración-total-automática) |
| 9 | [9. Verificación automática (`[1/10]`–`[10/10]`), Balanceador `pdh_lb` y App Web](#9-verificación-automática-1101010-balanceador-pdh_lb-y-app-web) |
| 10 | [10. Seguridad aplicada automáticamente y ACLs opcionales en Tailscale](#10-seguridad-aplicada-automáticamente-y-acls-opcionales-en-tailscale) |
| 11 | [11. Operación diaria, cambio seguro de `DB_PASS`, Drive y solución de problemas](#11-operación-diaria-cambio-seguro-de-db_pass-drive-y-solución-de-problemas) |

---

## 1. Respaldo previo: AWS a Google Drive y archivos locales

> [!WARNING]
> Al instalar Ubuntu Server usando todo el disco, **Windows y todos los archivos en esa PC se eliminarán de forma irreversible**. Completa el respaldo de tu instancia AWS (si aún está activa) y copia tus archivos personales a una USB externa antes de formatear.

### 1.1 Respaldo final desde tu instancia AWS EC2 hacia Google Drive

Si actualmente tienes datos corriendo en AWS, entra por SSH a esa instancia y sube un respaldo actualizado antes de apagarla:

```bash
# Opción A: Usar el script oficial del proyecto en la instancia AWS
cd ~/projects/mood-tracker && ./scripts/backup.sh --require-drive
```

*(Si prefieres hacer una extracción **100 % de solo lectura** sin podar registros viejos en AWS, ajusta la carpeta destino según tu variable `RCLONE_BACKUP_DIR` —por ejemplo `"gdrive:Personal Daily Hub/RespaldosApp"` o `gdrive:RespaldosApp`—)*:

```bash
docker exec mood_db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --single-transaction --routines --triggers --no-tablespaces -u root "$MYSQL_DATABASE"' \
  | gzip > ~/respaldo_mood_tracker.sql.gz \
  && gzip -t ~/respaldo_mood_tracker.sql.gz \
  && rclone copyto ~/respaldo_mood_tracker.sql.gz "gdrive:Personal Daily Hub/RespaldosApp/respaldo_mood_tracker.sql.gz" \
  && rclone lsl "gdrive:Personal Daily Hub/RespaldosApp" --include "respaldo_mood_tracker.sql.gz" --include "historico_completo.json.gz"
```

*(Si tu usuario en AWS necesita `sudo` para Docker, antepón `sudo` a `docker exec`).*

Cuando veas `respaldo_mood_tracker.sql.gz` con la fecha de hoy y tamaño mayor a 0 bytes, tu base de datos se restaurará sola en Ubuntu Server durante el primer despliegue automático.

### 1.2 Respaldo de tus archivos locales en Windows (en USB externa)

Copia a una memoria USB externa:

1. **Tu Diario personal cifrado (`Proyecto D.docx` -> `Diario.docx`):**
   * El archivo `.docx` protegido con tu contraseña `WORD_PASSWORD`. En Ubuntu Server vivirá en `~/projects/mood-tracker/data/journal/Diario.docx` (y **nunca** se subirá a Google Drive ni Git).
2. **Tu Cuaderno de Idiomas (`English_Learning_Notebook.docx`):**
   * Si lo tienes en local, respáldalo también en tu USB para copiarlo a `~/projects/mood-tracker/english-notes/English_Learning_Notebook.docx`.
3. **Tus 9 Secrets existentes en GitHub NO se pierden:**
   * `ADMIN_EMAIL`, `ADMIN_SECRET`, `DB_PASS`, `GEMINI_API_KEY`, `JOURNAL_SECRET_KEY`, `RCLONE_CONF_B64`, `SMTP_PASS`, `SMTP_USER` y `WORD_PASSWORD` **ya están guardados en GitHub Secrets**. No necesitas volver a escribirlos ni recuperarlos para el despliegue automático: `deploy.yml` los leerá en RAM al hacer merge a `main` y configurará `rclone` en Ubuntu por ti.
4. **Cualquier otro documento personal** de *Documentos*, *Descargas*, *Escritorio* o navegadores.

---

## 2. Descargar Ubuntu Server 26.04 LTS y crear USB booteable (Rufus)

Necesitas una memoria USB de al menos **4 GB** (se formateará durante el proceso):

1. **Descarga la ISO oficial de Ubuntu Server 26.04 LTS (64-bit AMD64 / x86_64):**
   * Sitio oficial: `https://ubuntu.com/download/server`
   * Verifica que sea edición **Server** (sin entorno gráfico), por ejemplo `ubuntu-26.04-live-server-amd64.iso`.
2. **Graba la ISO en tu memoria USB con Rufus (Windows):**
   * Descarga **Rufus** desde `https://rufus.ie` (o **balenaEtcher**).
   * Configura exactamente estos valores:
     * **Dispositivo:** tu memoria USB.
     * **Elección de arranque:** `ubuntu-26.04-live-server-amd64.iso`.
     * **Esquema de partición:** **`GPT`** *(si es una PC muy antigua sin UEFI, usa `MBR`)*.
     * **Sistema de destino:** **`UEFI (no CSM)`**.
     * Haz clic en **EMPEZAR** y, en **`ISOHybrid image detected`**, elige **`Write in ISO Image mode (Recommended)`**.
3. Al ver **LISTO**, expulsa la USB de forma segura.

---

## 3. Configurar BIOS / UEFI para servidor 24/7

Conecta la PC por **cable Ethernet** al router (más estable y rápido que Wi-Fi para SSH y Docker) e inserta el USB booteable:

1. Enciende la PC y entra al BIOS o Boot Menu (`F2`, `F12`, `Del/Supr`, `F10` o `Esc`).
2. Ajusta estas opciones:
   * **Desactiva `Fast Boot`**.
   * **Modo de arranque:** **`UEFI`** y modo SATA **`AHCI`** (evita Intel RST/RAID propietario para detectar sin problemas el disco de ~500 GB).
   * **`Restore on AC Power Loss` / `AC Power Recovery`:** **`Power On`** (para encender automáticamente tras cualquier corte eléctrico).
3. Guarda cambios (`F10`) y arranca desde la **memoria USB**.

---

## 4. Arrancar el instalador, desinstalar Windows y particionar el disco de ~500 GB

Elige **`Try or Install Ubuntu Server`** en el menú GRUB:

1. **Idioma (`Language`):** `English` (recomendado en servidores) o `Español`.
2. **Actualización del instalador (`Installer update`):** `Continue without updating` (o actualiza si conectaste Ethernet).
3. **Teclado (`Keyboard configuration`):** elige tu distribución (`Latin American`, `Spanish` o `English (US)`) -> **`Done`**.
4. **Tipo de instalación (`Choose type of install`):** **`Ubuntu Server`** -> **`Done`**.
5. **Red (`Network connections`):** confirma tu tarjeta Ethernet (`enp...` / `eth0`) con IP por DHCP -> **`Done`**.
   * *(Opcional)*: asigna una reserva DHCP por MAC en tu router para mantener fija tu IP LAN.
6. **Proxy y Mirror:** deja Proxy vacío -> **`Done`**; deja el mirror sugerido -> **`Done`**.
7. **ELIMINAR WINDOWS Y USAR TODO EL DISCO (`Guided storage configuration`):**
   * Selecciona **`Use an entire disk`** sobre el disco interno de **~500 GB** (NO la USB).
   * Deja marcado **`Set up this disk as an LVM group`**.
   * **Cifrado LUKS:** déjalo **sin marcar** para que tras un corte eléctrico el servidor arranque 100 % autónomo sin pedir contraseña física en teclado (`Diario.docx` ya va cifrado con `WORD_PASSWORD`).
   * Pulsa **`Done`**.
8. **Resumen de particiones (`Storage configuration`):**
   * Verifica `/boot/efi`, `/boot` y `ubuntu-vg / ubuntu-lv` (y las viejas particiones NTFS de Windows marcadas para borrado).
   * **Aprovechar todo el disco de 500 GB:** selecciona `ubuntu-lv` -> **`Edit`** -> pon el tamaño al máximo (`max`) -> **`Save`**.
   * Pulsa **`Done`** -> **`Continue`** en **`Confirm destructive action`**.

---

## 5. Configuración del sistema dentro del instalador (Red, Usuario, OpenSSH)

1. **Perfil (`Profile setup`):**
   * **Your name:** tu nombre.
   * **Your server's name:** por ejemplo `dailyhub-srv`.
   * **Pick a username:** puedes poner **tu propio nombre en minúsculas** (ej. `flavio`, `ubuntu`, etc.; **no** es obligatorio que se llame `ubuntu`). Todo en [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), Docker (`APP_UID`/`APP_GID`), SSH (`AllowUsers`), `auditd` y los crons usa `$USER` y `$HOME` de forma dinámica; solo deberás colocar exactamente ese mismo usuario (`whoami`) en la GitHub Variable `EC2_USER` (o `SERVER_USER`). *(En los comandos de abajo usamos `TU_USUARIO`).*
   * **Choose a password:** contraseña fuerte para iniciar sesión y `sudo`.
2. **Ubuntu Pro:** elige **`Skip for now`** -> **`Continue`**.
3. **Configuración SSH (`SSH Setup`):**
   * **Marca `[X] Install OpenSSH server`** (obligatorio).
   * Deja `Import SSH identity` en `No` -> **`Done`**.
4. **Featured Server Snaps:**
   * **NO marques `docker` aquí** (el paquete Snap restringe volúmenes locales; instalaremos Docker Engine oficial en el Paso 6.2). Baja a **`Done`**.
5. **Finalizar:**
   * Al ver **`Install complete!`**, selecciona **`Reboot Now`**, retira la memoria USB cuando lo pida y pulsa **Enter**.

---

## 6. Preparación MÍNIMA en Ubuntu Server (SSH + `sudo`, Docker, Tailscale y Word)

### 6.1 Conectarte por SSH desde Windows, autorizar tus 2 llaves y habilitar `sudo` sin contraseña (`NOPASSWD:ALL`)

1. **En la consola física de Ubuntu, confirma tu usuario exacto, tu IP LAN y que SSH esté activo:**
   ```bash
   whoami
   hostname -I
   sudo systemctl enable --now ssh
   ```
   *(Anota el resultado de `whoami` como `TU_USUARIO` y la primera IP `192.168.x.x` como `IP_LOCAL`. Si olvidaste marcar OpenSSH durante la instalación, ejecuta antes: `sudo apt update && sudo apt install -y openssh-server`.)*

2. **Conéctate por SSH desde Windows PowerShell (o Git Bash) para hacer el resto cómodamente desde tu PC:**
   ```powershell
   ssh TU_USUARIO@IP_LOCAL
   ```
   *(La primera vez escribe `yes` y tu contraseña de Ubuntu).*

3. **OBLIGATORIO antes del primer despliegue — Agregar tu llave SSH personal de Windows (`id_ed25519.pub`):**

   > [!WARNING]
   > Al hacer el primer merge a `main`, `deploy.yml` activa automáticamente `PasswordAuthentication no` y `AllowUsers TU_USUARIO` en OpenSSH. **Copia tu llave pública personal ahora**; de lo contrario perderás el acceso SSH por contraseña tras el primer despliegue.

   Desde **PowerShell en tu PC Windows**:
   ```powershell
   # Solo crea una llave si todavía no existe en tu Windows:
   if (-not (Test-Path "$env:USERPROFILE\.ssh\id_ed25519.pub")) { ssh-keygen -t ed25519 -C "admin-dailyhub" }

   # Copiar tu llave pública personal a Ubuntu:
   Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" | ssh TU_USUARIO@IP_LOCAL "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
   ```

4. **Autorizar la llave SSH de GitHub Actions (`EC2_SSH_KEY` o `SERVER_SSH_KEY`):**
   Elige según quieras reutilizar la llave que ya usa tu repositorio o generar una nueva:
   * **Opción A (Recomendada) — Reutilizar `.ssh/github_deploy_key.pub` del proyecto sin tocar `EC2_SSH_KEY` en GitHub:**
     Si ya tienes la llave Ed25519 del proyecto (`.ssh/github_deploy_key` guardada en el Secret `EC2_SSH_KEY`), copia su `.pub` desde PowerShell dentro de la carpeta raíz del repositorio:
     ```powershell
     Get-Content ".\.ssh\github_deploy_key.pub" | ssh TU_USUARIO@IP_LOCAL "cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
     ```
     *(Si solo conservas un archivo `.pem` de AWS y no `.ssh/github_deploy_key.pub`, extrae su llave pública con `ssh-keygen -y -f "C:\ruta\a\tu\clave.pem" | ssh TU_USUARIO@IP_LOCAL "cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"`, teniendo en cuenta que OpenSSH moderno puede rechazar claves RSA antiguas con firma `ssh-rsa`).*
   * **Opción B — Generar llave nueva Ed25519 en RAM y actualizar el Secret `EC2_SSH_KEY` (o `SERVER_SSH_KEY`) en GitHub:**
     En tu sesión SSH de Ubuntu:
     ```bash
     ssh-keygen -t ed25519 -N "" -C "github-actions-deploy" -f /dev/shm/github_actions_dailyhub
     cat /dev/shm/github_actions_dailyhub.pub >> ~/.ssh/authorized_keys
     chmod 600 ~/.ssh/authorized_keys
     echo "--- COPIA ESTA LLAVE PRIVADA COMPLETA EN GITHUB SECRET EC2_SSH_KEY (o SERVER_SSH_KEY) ---"
     cat /dev/shm/github_actions_dailyhub
     ```
     En cuanto pegues el bloque completo (`-----BEGIN OPENSSH PRIVATE KEY-----` ... `-----END OPENSSH PRIVATE KEY-----`) en GitHub Secrets, bórrala de RAM:
     ```bash
     shred -u -z -n 1 /dev/shm/github_actions_dailyhub /dev/shm/github_actions_dailyhub.pub
     ```
   * **Verificar que ambas llaves entran sin pedir contraseña** (desde PowerShell en la raíz del proyecto):
     ```powershell
     ssh TU_USUARIO@IP_LOCAL "whoami && echo ADMIN_SSH_OK"
     ssh -i ".\.ssh\github_deploy_key" TU_USUARIO@IP_LOCAL "whoami && echo GITHUB_DEPLOY_SSH_OK"
     ```
     *(Si elegiste la Opción B, verifica tu llave personal con el primer comando y continúa al paso siguiente).*

5. **Autorización `sudo` para GitHub Actions (elige una opción):**
   * **Opción A (Recomendada — Mantener contraseña en `sudo` usando el Secret `SERVER_SUDO_PASS` en GitHub):**
     **No** necesitas modificar `/etc/sudoers.d` ni quitarle la contraseña a `sudo` en Ubuntu; tu consola local seguirá pidiendo contraseña. Basta con guardar tu contraseña de usuario de Ubuntu en el **GitHub Secret `SERVER_SUDO_PASS`** (Paso 7.2): `deploy.yml` la usa temporalmente solo en RAM (`/dev/shm` mediante `SUDO_ASKPASS`), la destruye con `shred`, revoca la sesión con `sudo -k` y deja el mantenimiento semanal del sistema en `/etc/cron.d/dailyhub-sys-update` como `root`.
   * **Opción B (Alternativa estilo AWS EC2 — `NOPASSWD:ALL` sin guardar tu contraseña de Linux en GitHub):**
     Si prefieres que tu contraseña de usuario de Ubuntu nunca se guarde en GitHub Secrets, habilita `sudo` sin contraseña dentro de tu sesión SSH en Ubuntu:
     ```bash
     echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee "/etc/sudoers.d/90-${USER}-nopasswd"
     sudo chmod 440 "/etc/sudoers.d/90-${USER}-nopasswd"
     sudo visudo -cf "/etc/sudoers.d/90-${USER}-nopasswd"
     ```

### 6.2 Instalar Docker Engine y Docker Compose v2 oficiales

En tu sesión SSH de Ubuntu:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
```

Cierra sesión (`exit`), vuelve a entrar por SSH (`ssh TU_USUARIO@IP_LOCAL`) para aplicar el grupo `docker` y verifica:

```bash
docker --version
docker compose version
```

### 6.3 Instalar Tailscale y habilitar OAuth CI (túnel privado sin abrir puertos en el router)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Abre el enlace de autenticación que muestra en pantalla, inicia sesión y anota tu **MagicDNS** (`dailyhub-srv.tailXXXX.ts.net`):

```bash
tailscale ip -4
tailscale status
```

Con Tailscale activo ya puedes conectarte por SSH desde cualquier red con:

```powershell
ssh TU_USUARIO@dailyhub-srv.tailXXXX.ts.net
```

En la consola web de Tailscale (`https://login.tailscale.com/admin`):
1. En **Machines** -> tu servidor -> `...` -> **`Disable key expiry`** (para que no caduque).
2. En **DNS** -> confirma activados **MagicDNS** y **HTTPS Certificates**.
3. En **Access controls** (ACLs), declara `tag:ci` bajo `tagOwners` *(no hace falta agregar todavía un bloque `"acls"`: la política por defecto ya permite acceso de tu cuenta y de `tag:ci`; si después aplicas las ACL estrictas de la sección 10.3, primero etiqueta el servidor con `tag:server`)*:
   ```json
   "tagOwners": {
     "tag:ci": ["autogroup:admin"]
   }
   ```
4. En **Settings -> OAuth clients -> Generate OAuth client**:
   * **Description:** `GitHub Actions Deploy`
   * **Scopes:** **`Auth Keys`** -> **`Write`** con tag **`tag:ci`**.
   * Guarda el **Client ID** en la **GitHub Variable `TS_OAUTH_CLIENT_ID`** y el **Client Secret** en el **GitHub Secret `TS_OAUTH_SECRET`**.

*(Nota: Si prefieres no crear el cliente OAuth de Tailscale y desplegar por SSH directo usando tu IP pública/DDNS y redirección del puerto 22 en el router, basta con omitir `TS_OAUTH_CLIENT_ID`/`TS_OAUTH_SECRET` y poner tu IP/DDNS pública en `EC2_HOST`; `deploy.yml` igualmente configurará `tailscale serve` en Ubuntu si Tailscale está conectado).*

### 6.4 Copiar tus archivos Word locales (`Proyecto D.docx` -> `Diario.docx`)

> [!IMPORTANT]
> **Nombre obligatorio en Ubuntu:** aunque en Windows tu diario se llame **`Proyecto D.docx`**, en el servidor **debe quedar en `~/projects/mood-tracker/data/journal/Diario.docx`** (`D` mayúscula) y nunca subirse a Drive ni a Git.

Primero crea las carpetas mínimas **en Ubuntu** *(puedes hacerlo antes del primer merge a `main`, porque `deploy.yml` inicializa Git sin borrar `data/` ni `english-notes/` y ajusta permisos `600`/`700` automáticamente)*:

```bash
mkdir -p ~/projects/mood-tracker/data/journal ~/projects/mood-tracker/english-notes
```

* **Opción 1 — Desde Windows PowerShell por `scp`** *(reemplaza `IP_O_DOMINIO_TS` por `IP_LOCAL` o `dailyhub-srv.tailXXXX.ts.net`)*:
  ```powershell
  scp "C:\respaldo\Proyecto D.docx" TU_USUARIO@IP_O_DOMINIO_TS:~/projects/mood-tracker/data/journal/Diario.docx
  # Desde la raíz del repo (o desde C:\respaldo\English_Learning_Notebook.docx):
  scp ".\english-notes\English_Learning_Notebook.docx" TU_USUARIO@IP_O_DOMINIO_TS:~/projects/mood-tracker/english-notes/English_Learning_Notebook.docx
  ```
* **Opción 2 — Desde tu memoria USB conectada en Ubuntu Server:**
  ```bash
  lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT
  sudo mkdir -p /mnt/usb && sudo mount /dev/sdX1 /mnt/usb
  cp "/mnt/usb/Proyecto D.docx" ~/projects/mood-tracker/data/journal/Diario.docx
  cp "/mnt/usb/English_Learning_Notebook.docx" ~/projects/mood-tracker/english-notes/English_Learning_Notebook.docx 2>/dev/null || true
  sudo umount /mnt/usb
  ```

*(Si prefieres subir tus `.docx` después del primer despliegue, también puedes hacerlo por `scp` y ejecutar en Ubuntu `chmod 600 ~/projects/mood-tracker/data/journal/Diario.docx`.)*

> [!TIP]
> **¡Listo! Ya terminaste todo lo manual en Ubuntu.**
> **NO** tienes que configurar a mano Swap, anti-suspensión, cierre de tapa, `rclone`, `ffmpeg`, `yt-dlp`, UFW, `tailscale serve`, endurecimiento SSH, `fail2ban`, `unattended-upgrades`, `sysctl` anti-DoS, `hidepid=2`, `auditd`, crons ni archivo `.env`. **Todo eso lo hace `.github/workflows/deploy.yml` automáticamente al hacer merge a `main`.**

---

## 7. Configurar Variables y Secrets en GitHub (sin perder tus Secrets actuales)

Ve en tu repositorio de GitHub a **Settings -> Secrets and variables -> Actions**.

### 7.1 Repository Variables (pestaña **Variables**)

El flujo de despliegue lee primero `SERVER_*` y, si no existe, usa `EC2_*`. Puedes **actualizar tus variables actuales (`EC2_HOST`, `EC2_USER`)** o crear `SERVER_HOST` / `SERVER_USER` *(si existen ambas, `SERVER_*` tiene prioridad)*.

#### A) Variables existentes que mantienes igual
| Variable | Tu valor actual | Acción |
| :--- | :--- | :--- |
| `DB_HOST` | `db` | **Mantener** |
| `DB_NAME` | `MoodTrackerLocal` | **Mantener** |
| `DB_USER` | `root` | **Mantener** |
| `PORT` | `3000` | **Mantener** |
| `TZ` | `America/Monterrey` | **Mantener** |
| `RCLONE_REMOTE` | `gdrive` | **Mantener** |
| `RCLONE_BACKUP_DIR` | `Personal Daily Hub/RespaldosApp` | **Mantener** (carpeta en Drive) |
| `SEAL_ENV_AFTER_DEPLOY` | `true` | **Mantener** (cero `.env` en disco) |
| `BACKUP_CRON_SCHEDULE` | `30 3 * * *` | **Mantener** |

#### B) Variables existentes que debes actualizar (justo antes de hacer merge a `main`)
| Variable actual (o nuevo nombre) | Nuevo valor para Ubuntu | Notas |
| :--- | :--- | :--- |
| `EC2_HOST` *(o `SERVER_HOST`)* | `dailyhub-srv.tailXXXX.ts.net` | Reemplaza la antigua IP de AWS por tu dominio MagicDNS (o IP Tailscale `100.x.y.z`). Actualizar `EC2_HOST` mantiene compatibilidad si usas `sincronizador.py` desde Windows. |
| `EC2_USER` *(o `SERVER_USER`)* | `TU_USUARIO` *(resultado exacto de `whoami`)* | Pon tu usuario real de Ubuntu, aunque sea tu nombre en lugar de `ubuntu`; se autentica con el Secret `SERVER_SUDO_PASS` (o `NOPASSWD:ALL`). |

#### C) Variables nuevas a crear para automatización completa del servidor
| Variable | Valor recomendado | Qué automatiza en `deploy.yml` |
| :--- | :--- | :--- |
| `AUTO_CONFIGURE_SERVER` | `true` | Activa ajuste automático completo de Ubuntu (anti-sleep, tapa laptop, UFW, SSH hardening, `fail2ban`, `unattended-upgrades`, kernel DoS, `hidepid=2`, `auditd`, Tailscale Serve y verificación). |
| `APP_BASE_URL` | `https://dailyhub-srv.tailXXXX.ts.net` | URL pública HTTPS de Tailscale Serve; activa automáticamente `REQUIRE_HTTPS=true`. |
| `TRUST_PROXY` | `2` | Confía en la cadena de 2 proxies (`Tailscale Serve` -> `Caddy mood_proxy` -> `Node.js`). |
| `SITE_ADDRESS` | `:80` | Escucha interna del balanceador Caddy (`mood_proxy`). |
| `PROXY_HTTP_PORT` | `8080` | Puerto loopback del balanceador Caddy (`127.0.0.1:8080`). |
| `DB_RETENTION_DAYS` | `0` | Conserva todo el histórico local sin podar registros en MySQL (`>= 300 GB`). |
| `LOCAL_SQL_DAILY_BACKUP_DAYS` | `180` | Retención de instantáneas SQL diarias en `~/projects/respaldos/diario_sql/`. |
| `LOCAL_WORD_BACKUP_DAYS` | `365` | Retención de copias rotativas locales de `Diario.docx` y cuaderno de idiomas. |
| `REQUIRE_DRIVE_BACKUP` | `true` | Valida conectividad y subida real a Google Drive en cada despliegue/respaldo. |
| `ENABLE_TAILSCALE_SERVE` | `true` | Configura automáticamente `tailscale serve --bg http://127.0.0.1:8080`. |
| `UFW_CLOSE_LAN_SSH` | `false` *(recomendado al inicio; luego `true` opcional)* | Valor por defecto seguro de `deploy.yml` para mantener SSH también en la LAN hasta confirmar que entras bien por Tailscale (`ssh TU_USUARIO@dailyhub-srv.tailXXXX.ts.net`); pásalo a `true` después si quieres SSH exclusivo por `tailscale0`. |
| `TS_OAUTH_CLIENT_ID` | *(tu Client ID de Tailscale)* | Conecta el runner de GitHub Actions al túnel privado Tailscale para hacer SSH sin abrir puertos en el router. |
| `TS_TAGS` | `tag:ci` | Etiqueta ACL asignada al runner temporal de GitHub Actions. |

> [!NOTE]
> **Mínimo indispensable vs valores por defecto:** Para conectar por Tailscale OAuth basta con actualizar `EC2_HOST`/`SERVER_HOST`, `EC2_USER`/`SERVER_USER` y agregar `TS_OAUTH_CLIENT_ID` + Secret `TS_OAUTH_SECRET`. En `deploy.yml`, `AUTO_CONFIGURE_SERVER` ya vale `true`, `TS_TAGS` ya usa `tag:ci` y, si Tailscale está activo y omites `APP_BASE_URL`, el propio script calcula `https://${TS_DNS}`, `TRUST_PROXY=2` y `REQUIRE_HTTPS=true`; aun así, declarar toda la tabla explícitamente evita ambigüedades.

#### D) Variables opcionales de control fino (solo si quieres desactivar/ajustar algo puntual)
| Variable | Default | Descripción |
| :--- | :--- | :--- |
| `RUN_POST_DEPLOY_VERIFY` | `true` | Ejecuta `./scripts/verify-ubuntu-local.sh` (`[1/10]`–`[10/10]`) al final de cada despliegue. |
| `DISABLE_SYSTEM_SLEEP` | `true` *(hereda `AUTO_CONFIGURE_SERVER`)* | Enmascara `sleep`/`suspend`/`hibernate` para operación 24/7. |
| `IGNORE_LID_SWITCH` | `auto` | Si detecta laptop (`/proc/acpi/button/lid`), configura `HandleLidSwitch=ignore` automáticamente. Usa `true` o `false` para forzar. |
| `ENABLE_UFW` / `ENABLE_SSH_HARDENING` / `ENABLE_FAIL2BAN` / `ENABLE_UNATTENDED_UPGRADES` / `ENABLE_KERNEL_DOS_HARDENING` / `ENABLE_PROC_HIDEPID` / `ENABLE_AUDITD` | *(heredan `AUTO_CONFIGURE_SERVER`)* | Permiten encender o apagar individualmente cada capa de endurecimiento (`true`/`false`). |
| `SERVER_SSH_PORT` | `22` | Puerto SSH si usas un puerto distinto al `22`. |
| `ENABLE_LOGIN_MFA` | `false` | Activa código MFA por correo en cada inicio de sesión. |
| `CORS_ALLOWED_ORIGINS` | *(vacío)* | Orígenes extra separados por coma además de `*.ts.net` y `APP_BASE_URL`. |

### 7.2 Repository Secrets (pestaña **Secrets**)

* **Tus 9 Secrets de aplicación ya existentes NO se tocan (déjalos exactamente como están):**
  `ADMIN_EMAIL`, `ADMIN_SECRET`, `DB_PASS`, `GEMINI_API_KEY`, `JOURNAL_SECRET_KEY`, `RCLONE_CONF_B64`, `SMTP_PASS`, `SMTP_USER`, `WORD_PASSWORD`.
* **Secret SSH de despliegue (`EC2_SSH_KEY` o `SERVER_SSH_KEY`, ambos funcionan en `deploy.yml`):**
  * Si usaste la **Opción A** del Paso 6.1 (`.ssh/github_deploy_key.pub`), **déjalo intacto**.
  * Si generaste una llave Ed25519 nueva (**Opción B**), pega ahí la llave privada completa.
* **2 Secrets nuevos necesarios:**
  * **`TS_OAUTH_SECRET`** -> Client Secret del cliente OAuth de Tailscale (para que GitHub Actions entre por el túnel Tailscale).
  * **`SERVER_SUDO_PASS`** -> Contraseña de tu usuario en Ubuntu para que `deploy.yml` ejecute `sudo` de forma efímera solo en RAM (`/dev/shm` vía `SUDO_ASKPASS`, borrado con `shred` y revocado con `sudo -k` al finalizar) sin quitar la contraseña de `sudo` en tu servidor. *(Opcional únicamente si elegiste configurar `NOPASSWD:ALL` en la Opción B del Paso 6.1).*
* *(Opcionales, solo si los habilitas: `STUDY_RCLONE_CONF_B64`, `YOUTUBE_API_KEY`.)*

---

## 8. Merge a `main` = Despliegue y Configuración Total Automática

> [!IMPORTANT]
> **Regla de transición segura (AWS -> Ubuntu):**
> Mientras sigas preparando Ubuntu en otra rama, **no hagas merge a `main`** hasta que:
> 1. Hayas completado el **Paso 6** en Ubuntu (SSH + tus 2 llaves en `authorized_keys`, Docker y Tailscale).
> 2. Hayas actualizado `EC2_HOST` (o `SERVER_HOST`) y `EC2_USER` (o `SERVER_USER`) en GitHub Variables apuntando al nuevo servidor Ubuntu y agregado las Variables y Secrets (`TS_OAUTH_SECRET` y `SERVER_SUDO_PASS`) del **Paso 7**.
>
> En ese momento, al hacer **Merge a `main`** (ya sea aprobando el Pull Request en GitHub o ejecutando `git checkout main && git merge <tu-rama> && git push origin main`), todo se fusiona, despliega y configura solo.

Al detectar el merge/push en `main`, [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) ejecuta automáticamente en orden:

1. **Auto-Versionado SemVer 2.0.0:** calcula versión (`scripts/release-version.js`), actualiza `package.json`/`CHANGELOG.md`/`version-history.json`, crea tag `vX.Y.Z` y Release en GitHub.
2. **Conexión privada:** levanta Tailscale temporal con `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` (o conecta directo por SSH si no se configuró OAuth) y entra a `SERVER_HOST || EC2_HOST`.
3. **Swap 2 GB + Cero Suspensión 24/7:** activa `/swapfile` 2 GB persistente, aplica `vm.swappiness=15`, enmascara `sleep/suspend/hibernate` y configura `HandleLidSwitch=ignore` si es laptop.
4. **Paquetes y utilidades:** instala/actualiza `git`, `curl`, `rclone`, `cron`, `openssl`, `python3`, `ffmpeg`, `ufw`, `fail2ban`, `unattended-upgrades`, `auditd` y `/usr/local/bin/yt-dlp -U`.
5. **Sincronización limpia del código:** inicializa o resetea `~/projects/mood-tracker` a `origin/main` preservando `data/` (`Diario.docx`), `english-notes/` y `logs/`, y retira `sincronitation/`.
6. **Entorno 100 % en RAM (`/dev/shm`) + Google Drive:** genera el entorno temporal desde tus GitHub Variables/Secrets, escribe `~/.config/rclone/rclone.conf` desde `RCLONE_CONF_B64` (`chmod 600`) y valida la carpeta en Drive.
7. **Build y arranque de los 4 contenedores:** levanta `mood_db` (MySQL 8.0 tuned para HDD), `mood_app`, `mood_app2` y el balanceador Caddy `mood_proxy`, y espera a que los 4 reporten `healthy`.
8. **Auto-restauración de BD desde Google Drive:** si MySQL está vacío, `./scripts/restore.sh --if-empty` descarga `respaldo_mood_tracker.sql.gz` desde Drive y restaura todos tus datos.
9. **Crons automáticos y zona horaria:** ajusta `TZ`, guarda `~/projects/respaldos/.backup.meta`, registra el respaldo diario (`BACKUP_CRON_SCHEDULE`), configura `/etc/cron.d/dailyhub-sys-update` como `root` (domingos `04:00` para `apt-get upgrade -y` y `/usr/local/bin/yt-dlp -U` sin requerir `NOPASSWD:ALL`) y registra en tu `crontab` el `yt-dlp -U` semanal de los domingos (`04:15`) para `mood_app` y `mood_app2`.
10. **Tailscale Serve + Endurecimiento del SO:** activa `tailscale serve --bg http://127.0.0.1:8080`, aplica firewall UFW (cerrando `22/tcp` en LAN si `UFW_CLOSE_LAN_SSH=true`), bloquea logins SSH por contraseña (`PasswordAuthentication no`), configura `fail2ban`, `unattended-upgrades`, kernel anti-DoS (`tcp_syncookies = 1`), aislamiento `/proc` (`hidepid=2`) y reglas `auditd`.
11. **Sellado y verificación `[1/10]`–`[10/10]`:** destruye el entorno temporal con `shred` (cero `.env` en disco) y corre `./scripts/verify-ubuntu-local.sh` imprimiendo el resumen completo en los logs de GitHub Actions.

*(También puedes relanzar cualquier ajuste manualmente desde GitHub -> **Actions -> Deploy to Ubuntu Server (Tailscale / SSH) -> Run workflow**).*

---

## 9. Verificación automática (`[1/10]`–`[10/10]`), Balanceador `pdh_lb` y App Web

### 9.1 Verificación automatizada completa (`[1/10]`–`[10/10]`)

Al terminar el workflow en GitHub Actions, abre el paso **"Desplegar en Ubuntu Server vía SSH"** para revisar el resultado de `./scripts/verify-ubuntu-local.sh` (o ejecútalo cuando quieras por SSH):

```bash
cd ~/projects/mood-tracker
./scripts/verify-ubuntu-local.sh
```

Audita las 10 secciones:
* **`[1/10]`–`[2/10]`:** RAM/Swap/HDD (`vm.swappiness`) y estado `running (healthy)` de los **4 contenedores** (`mood_db`, `mood_app`, `mood_app2`, `mood_proxy`) + tuning InnoDB.
* **`[3/10]`–`[6/10]`:** Puertos solo en `127.0.0.1`, UFW, `tailscale serve`, `node` + `tzdata`, `python3` + `msoffcrypto OOXMLFile`, `yt-dlp --js-runtimes node` + `ffmpeg`.
* **`[7/10]`–`[8/10]`:** Salud en `127.0.0.1:3000/healthz` **y** balanceador Caddy en `127.0.0.1:8080/healthz` con sticky cookie `pdh_lb` + `X-Replica-Id`, `/vendor/crypto-js.min.js` local sin CDN, HSTS/426/CORS y permisos en `./data/journal`, `./english-notes`, `./logs`.
* **`[9/10]`–`[10/10]`:** Conectividad con Google Drive (`rclone`), `respaldo_mood_tracker.sql.gz` y `historico_completo.json.gz`, cron `yt-dlp -U`, contenedores endurecidos, cero `.env` plano, `tcp_syncookies`, `PasswordAuthentication no`, `fail2ban`, `unattended-upgrades` y `/proc` con `hidepid=2`.

### 9.2 Probar manualmente el Balanceador de Cargas y Failover (Opcional)

```bash
# 1) Primera petición al balanceador Caddy: observa Set-Cookie: pdh_lb=... y X-Replica-Id: app (o app2)
curl -i http://127.0.0.1:8080/healthz

# 2) Prueba de Failover sin caída: detener mood_app2 y verificar que Caddy sigue sirviendo vía mood_app
docker stop mood_app2
curl -i http://127.0.0.1:8080/healthz
docker start mood_app2 && docker compose ps
```

### 9.3 Respaldos Google Drive vs almacenamiento estrictamente local

* **En Google Drive (`${RCLONE_REMOTE}:${RCLONE_BACKUP_DIR}`):** `respaldo_mood_tracker.sql.gz`, `historico_sql/respaldo_YYYY-MM.sql.gz`, `historico_completo.json.gz` y `NotasIdiomas/English_Learning_Notebook.docx`.
* **100 % solo en disco local Ubuntu (NUNCA se sube `Diario.docx` a Google Drive):**
  * Base de datos MySQL con retención ilimitada (`DB_RETENTION_DAYS=0`).
  * Copias diarias SQL en `~/projects/respaldos/diario_sql/` (`LOCAL_SQL_DAILY_BACKUP_DAYS=180`).
  * Copias rotativas de Word en `~/projects/respaldos/journal_local_backups/` y `english_local_backups/` (`LOCAL_WORD_BACKUP_DAYS=365`).

```bash
# Respaldo manual exigiendo verificación real en Drive
~/projects/mood-tracker/scripts/backup.sh --require-drive
```

### 9.4 Checklist rápido en la app web

1. Entra desde tu celular o PC (con Tailscale activo) a `https://<tu-servidor>.<tu-tailnet>.ts.net`.
2. Inicia sesión con tus credenciales restauradas desde AWS y verifica tus registros históricos en Dashboard, Agenda y Música.
3. En **Música**, abre **`➕ Registrar Nueva Canción`**, prueba `Auto-fill`, extracción de letras y el reproductor dentro de Tailscale HTTPS.
4. Guarda una nota en **Journal Notes** (confirma `./data/journal/Diario.docx`) y una en **Language Studio**.

---

## 10. Seguridad aplicada automáticamente y ACLs opcionales en Tailscale

### 10.1 Cifrado extremo a extremo en tránsito (4 capas simultáneas)

1. **Túnel WireGuard (Tailscale):** red privada cifrada con **0 puertos abiertos** en tu router.
2. **HTTPS TLS 1.3 (`tailscale serve` -> Caddy `127.0.0.1:8080` + `REQUIRE_HTTPS=true`):** HSTS, CSP estricto, cookies `HttpOnly; Secure; SameSite=Lax`, rechazo HTTP plano (`426` en `/api/*`) y CORS restringido a `*.ts.net`.
3. **Túnel de Transporte (`TransportCrypto`):** X25519 + HKDF-SHA256 + AES-256-CTR + HMAC-SHA256 sobre `/api/*` con sesiones sticky (`pdh_lb`).
4. **Cifrado E2EE (`JOURNAL_SECRET_KEY`):** sobres AES-256-CBC cifrados en navegador antes de viajar.

### 10.2 Endurecimiento ya automatizado en `deploy.yml`

Cuando `AUTO_CONFIGURE_SERVER=true`, cada despliegue asegura de forma idempotente:
* Cero archivo `.env` plano en disco (`SEAL_ENV_AFTER_DEPLOY=true`) y logs sanitizados en `./logs/`.
* Firewall UFW con `default deny incoming`, permitiendo `tailscale0` (y cerrando `22/tcp` en LAN si `UFW_CLOSE_LAN_SSH=true`).
* OpenSSH endurecido (`PasswordAuthentication no`, `PermitRootLogin no`, `MaxAuthTries 3`, `AllowUsers`).
* `fail2ban` protegiendo SSH (`maxretry = 3`, `bantime = 1h`), `unattended-upgrades` para parches CVE automáticos, `sysctl` anti-DoS (`net.ipv4.tcp_syncookies = 1`, `rp_filter = 1`), aislamiento `/proc` (`hidepid=2`) y reglas `auditd` sobre `authorized_keys`, `sudoers.d`, `rclone.conf` y `Diario.docx`.
* Contenedores Docker sin privilegios (`no-new-privileges:true`, `cap_drop: ALL`, `mem_limit`, `pids_limit`, puertos solo en `127.0.0.1`).

### 10.3 Reglas ACL estrictas en Tailscale Admin Console (Opcional recomendado)

> [!WARNING]
> **Etiqueta primero el servidor antes de guardar estas ACLs:** en **Machines -> tu servidor -> `...` -> Edit ACL tags** asigna `tag:server` (o ejecuta `sudo tailscale set --advertise-tags=tag:server` en Ubuntu). Si aplicas el bloque `"acls"` siguiente sin haber etiquetado el servidor con `tag:server`, bloquearás tu propio acceso SSH y HTTPS.

En **Tailscale Admin Console -> Access controls** puedes restringir qué dispositivos alcanzan los puertos `443` y `22` de tu servidor:

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

---

## 11. Operación diaria, cambio seguro de `DB_PASS`, Drive y solución de problemas

### 11.1 Monitoreo rápido de los 4 contenedores

```bash
cd ~/projects/mood-tracker
docker compose ps
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' mood_db mood_app mood_app2 mood_proxy
docker compose logs --tail=60 -f proxy app app2
```

### 11.2 Reinicio o despliegue sin tiempo de caída

* **Vía GitHub (recomendado):** cualquier cambio fusionado a `main` se despliega solo vía `.github/workflows/deploy.yml`.
* **Reinicio manual por SSH (Rolling Restart):**
  ```bash
  cd ~/projects/mood-tracker
  docker compose restart app2 && sleep 5 && docker compose restart app
  ```

### 11.3 Cambiar `DB_PASS` en caliente sin perder datos

```bash
cd ~/projects/mood-tracker

# 1) Respaldo obligatorio antes de rotar contraseña
./scripts/backup.sh --require-drive

# 2) Actualizar contraseña dentro del contenedor MySQL activo
docker exec -e OLD_PW="TU_CONTRASENA_ACTUAL" mood_db sh -c \
  'MYSQL_PWD="$OLD_PW" mysql -u root -e "ALTER USER '\''root'\''@'\''%'\'' IDENTIFIED BY '\''TU_NUEVA_CONTRASENA_SEGURA'\''; ALTER USER '\''root'\''@'\''localhost'\'' IDENTIFIED BY '\''TU_NUEVA_CONTRASENA_SEGURA'\''; FLUSH PRIVILEGES;"'
```

Luego actualiza el Secret **`DB_PASS`** en GitHub y lanza obligatoriamente **`Run workflow`** (en **Actions -> Deploy to Ubuntu Server**): esto recrea `mood_db` con la nueva variable de entorno `MYSQL_ROOT_PASSWORD` (necesaria para que `scripts/backup.sh` en modo sellado siga funcionando) y recrea `mood_app` / `mood_app2` con la nueva contraseña.

### 11.4 Mantenimiento frecuente (Drive, permisos, `yt-dlp` y restauración)

* **Si caduca o cambias tu cuenta de Google Drive (`rclone`):**
  ```bash
  rclone config reconnect gdrive:
  # Ajusta la ruta si usas otro valor en RCLONE_BACKUP_DIR:
  rclone lsl "gdrive:Personal Daily Hub/RespaldosApp"
  # Genera la cadena Base64 de una sola línea y actualiza el Secret RCLONE_CONF_B64 en GitHub:
  base64 -w 0 ~/.config/rclone/rclone.conf && echo ""
  ```
* **Restaurar una base de datos vacía o corrupta desde Google Drive:**
  > **Importante:** `Run workflow` ejecuta `./scripts/restore.sh --if-empty`, por lo que solo restaura automáticamente si la base de datos está **vacía** (NO sobrescribe una BD corrupta que aún tenga registros). Si necesitas forzar una restauración encima de datos dañados sin crear `.env` en disco:
  ```bash
  cd ~/projects/mood-tracker
  # Si gestionas todo con GitHub Secrets (sin .env en disco; ajusta la ruta de Drive según RCLONE_BACKUP_DIR):
  rclone copyto "gdrive:Personal Daily Hub/RespaldosApp/respaldo_mood_tracker.sql.gz" /dev/shm/restore_manual.sql.gz \
    && gunzip -c /dev/shm/restore_manual.sql.gz | docker exec -i mood_db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root "$MYSQL_DATABASE"' \
    && rm -f /dev/shm/restore_manual.sql.gz

  # Si existe .env plano en disco: ./scripts/restore.sh --force
  # Si usas cifrado local .env.enc: ./scripts/env-vault.sh restore --force
  ```
* **Actualizar `yt-dlp` manualmente en host y ambas réplicas:**
  ```bash
  sudo /usr/local/bin/yt-dlp -U || true
  docker exec -u 0 mood_app yt-dlp -U
  docker exec -u 0 mood_app2 yt-dlp -U
  ```
