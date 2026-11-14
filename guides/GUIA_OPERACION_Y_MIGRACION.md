# Guía Completa de Operación, Bóveda Local y Migración EC2 — Personal Daily Hub

> Guía operativa de referencia diaria (versionada en `guides/` y excluida de Docker en `.dockerignore`). Reúne en un solo lugar **cómo consultar, ver, editar y re-cifrar tu `.env` local**, cómo trabajar con **Git Bash y la rama protegida `main`**, cómo revisar **logs, respaldos y secretos** en GitHub/EC2, y cómo **migrar a otra instancia AWS EC2** reutilizando tus llaves en `.ssh/`.

---

## Índice rápido — "¿Qué necesito hacer?"

| Tarea | Sección |
| :--- | :--- |
| Ver estado de `.env` / `.env.enc` en mi PC | [1.1 Ver estado actual](#11-ver-estado-actual-de-la-bóveda) |
| Consultar una variable local sin crear `.env` en disco | [1.2 Consultar variables solo en RAM](#12-consultar-variables-sin-escribir-env-en-disco) |
| Ver completo o editar `.env` y volver a cifrarlo | [1.3 Ver completo, editar y re-sellar](#13-ver-completo-editar-y-re-sellar) |
| Cambiar la contraseña maestra de `.env.enc` | [1.4 Cambiar contraseña maestra](#14-cambiar-la-contraseña-maestra) |
| Ejecutar el sincronizador de Word y revisar sus variables | [2. Sincronizador Word local](#2-sincronizador-word-local-sincronizadorpy) |
| Correr pruebas, subir rama y hacer PR a `main` | [3. Git Bash, pruebas y rama protegida](#3-git-bash-pruebas-y-rama-protegida-main) |
| Revisar variables/secrets en GitHub y logs/cron en EC2 | [4. Qué consultar en GitHub y en EC2](#4-qué-consultar-en-github-y-en-ec2) |
| Sacar respaldo manual o restaurar desde Google Drive | [5. Respaldos y restauración manual](#5-respaldos-manuales-y-restauración-desde-drive) |
| Cambiar de instancia AWS EC2 usando `.ssh/` | [6. Migración a nueva instancia EC2](#6-migración-a-otra-instancia-aws-ec2-usando-ssh) |
| Resolver errores típicos (`winpty`, permisos SSH, `main`) | [7. Solución rápida de problemas](#7-solución-rápida-de-problemas) |
| Activar notificaciones en celular (`ntfy`), Jira y recordatorios | [8. Notificaciones Móviles, Agenda Jira y Settings](#8-notificaciones-móviles-agenda-jira-y-settings) |

---

## 1. Bóveda local (`.env` ↔ `.env.enc`) en Windows

Tu archivo `.env` local se cifra en `.env.enc` usando [`scripts/local-vault.js`](../scripts/local-vault.js) con el estándar OpenSSL (**PBKDF2-HMAC-SHA256** de `600,000` iteraciones + **AES-256-CBC**). Ambos archivos están en [`.gitignore`](../.gitignore) para que nunca suban a GitHub.

> [!CAUTION]
> Tu contraseña maestra **no se guarda en ningún lado**. Si la olvidas, `.env.enc` no puede descifrarse y tendrías que reconstruir `.env` desde tus Secrets/Variables de GitHub y tus datos locales de Word.

Primero entra al proyecto en **Git Bash**:
```bash
cd "<RUTA_DEL_REPOSITORIO>"
```

> [!TIP]
> **Nota para Git Bash clásico (`mintty`):** si usas la ventana independiente de Git Bash (fuera de VS Code) y el prompt de contraseña no responde bien como terminal interactiva, antepón `winpty` a cualquier comando que pida contraseña (por ejemplo: `winpty node scripts/local-vault.js decrypt` o `winpty python sincronitation/sincronizador.py`).

### 1.1 Ver estado actual de la bóveda
```bash
node scripts/local-vault.js status
```
* `[OK] .env en texto plano NO existe en disco` + `[SELLADO] .env.enc cifrado presente en disco` → Todo protegido.
* `[EXPUESTO] .env en texto plano presente en disco` → Recuerda sellar con `encrypt` o `lock` al terminar de editar.

### 1.2 Consultar variables sin escribir `.env` en disco
Si solo quieres ver uno o varios valores rápidamente en **RAM** sin recrear `.env` en el disco:
```bash
node scripts/local-vault.js run node -e "console.log({ WORD_FILE_PATH: process.env.WORD_FILE_PATH, GITHUB_REPO: process.env.GITHUB_REPO, PORT: process.env.PORT })"
```
También puedes imprimir cualquier otra variable cambiando el nombre dentro de `process.env.NOMBRE_VARIABLE`. No queda ningún archivo plano en disco al terminar.

### 1.3 Ver completo, editar y re-sellar
```bash
# 1. Descifra .env.enc -> .env temporalmente (pide tu contraseña maestra)
node scripts/local-vault.js decrypt

# 2. Míralo o edítalo con la herramienta que prefieras
cat .env
# code .env
# nano .env
```

Al terminar, **siempre vuelve a sellarlo**:
* **Si modificaste algo** (actualiza `.env.enc` con tus cambios y destruye `.env` plano sobrescribiéndolo con ceros):
  ```bash
  node scripts/local-vault.js encrypt
  ```
* **Si solo lo miraste y no cambiaste nada** (destruye `.env` plano sobrescribiéndolo con ceros y conserva el `.env.enc` actual, sin pedirte contraseña):
  ```bash
  node scripts/local-vault.js lock
  ```
* Verifica que volvió a quedar limpio:
  ```bash
  node scripts/local-vault.js status
  ```

### 1.4 Cambiar la contraseña maestra
```bash
node scripts/local-vault.js decrypt   # Ingresa tu contraseña actual
node scripts/local-vault.js encrypt   # Escribe y confirma tu NUEVA contraseña (mín. 8 caracteres)
python sincronitation/sincronizador.py --configurar-autoinicio   # Actualiza también el autoinicio Windows DPAPI
```

---

## 2. Sincronizador Word local (`sincronizador.py`)

El script `sincronitation/sincronizador.py` detecta automáticamente `.env` o `.env.enc` (descifrándolo solo en RAM) y sincroniza **dos documentos Word** en tu PC:
1. **Journal diario (cifrado con contraseña):** usa `WORD_FILE_PATH` + `WORD_PASSWORD` desde `/api/pull-text`.
2. **English Learning Notebook (`english-notes/English_Learning_Notebook.docx`, sin contraseña):** carpeta ignorada por Git; ordena tus registros en **3 apartados** (*Glossary & New Words*, *Grammar & Usage Notes* y *Phrasal Verbs*) y regenera automáticamente la **Tabla de Contenidos** al inicio del archivo en cada registro desde `/api/pull-english`. Su ruta es **relativa al proyecto**, por lo que **no requiere modificar `.env`, `.env.enc` ni rutas al migrar de instancia EC2**.

### Variables que utiliza tu `.env` / `.env.enc` local
| Variable | Obligatoria | Para qué sirve |
| :--- | :---: | :--- |
| `WORD_FILE_PATH` | Sí | Ruta local completa hacia tu `.docx` de Journal diario (ej. OneDrive / Documentos) |
| `WORD_PASSWORD` | Sí | Contraseña para abrir y guardar únicamente tu `.docx` de Journal diario |
| `ENGLISH_WORD_FILE_PATH` | Opcional | Solo si quisieras mover el notebook de inglés fuera de `english-notes/English_Learning_Notebook.docx` |
| `JOURNAL_SECRET_KEY` | Sí | Clave E2EE de exactamente **32 bytes UTF-8** (usada tanto por Journal Notes como por English Notebook en el navegador) |
| `GITHUB_TOKEN` | Recomendada | Token personal de GitHub (solo lectura de Actions Variables) para autodetectar cambios de `EC2_HOST` y `PORT` |
| `GITHUB_REPO` | Si usas token | Repositorio en formato `Flax64/mood-tracker` (valor por defecto si se omite) |
| `PORT` | Opcional | Puerto respaldo si no está en GitHub Variables (por defecto `3000`) |
| `URL_AWS` / `AWS_HOST` | Solo sin token | Respaldo manual (`http://IP:3000/api/pull-text` o solo la IP; para inglés sustituye `/api/pull-english` solo) si no configuras `GITHUB_TOKEN` |

### Arranque 100% automático al encender la PC (Windows DPAPI)
Para que `sincronizador.py` siga arrancando solo y en segundo plano al encender Windows **sin dejar `.env` plano ni contraseñas legibles en disco**, guarda tu contraseña maestra cifrada con **Windows DPAPI** (vinculada únicamente a tu sesión de usuario en esta PC, en `%LOCALAPPDATA%\mood-tracker\vault.dpapi`):

```bash
# 1. Configurar una sola vez (te pedirá tu contraseña de .env.enc y validará que funcione)
python sincronitation/sincronizador.py --configurar-autoinicio

# 2. Probar que descifra en RAM sin pedir contraseña
python sincronitation/sincronizador.py --probar-autoinicio

# (Si algún día quieres revocar el autoinicio silencioso y volver a pedir contraseña:)
python sincronitation/sincronizador.py --quitar-autoinicio
```

### Cómo reiniciar, ejecutar o revisar el log del sincronizador
```bash
# 1. Ver y detener cualquier proceso antiguo de sincronizador.py en segundo plano
powershell.exe -NoProfile -Command 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*sincronizador.py*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "Detenido PID: $($_.ProcessId)" }'

# 2. Volver a iniciarlo en segundo plano (sin ventana) usando el autoinicio DPAPI
powershell.exe -NoProfile -Command 'Start-Process -FilePath pythonw -WorkingDirectory "<RUTA_DEL_REPOSITORIO>" -ArgumentList "sincronitation\sincronizador.py" -WindowStyle Hidden'

# (O ejecutarlo visible en terminal:)
python sincronitation/sincronizador.py

# 3. Consultar los últimos eventos del sincronizador
tail -n 30 sincronitation/historial.log
```

---

## 3. Git Bash, pruebas y rama protegida `main`

La rama `main` está protegida: los cambios siempre se suben desde una rama de trabajo (por ejemplo `mejoras`) y se integran mediante **Pull Request** en GitHub.

```bash
# 1. Ver en qué rama estás y qué archivos detecta Git
# (english-notes/, .env, .env.enc, .ssh/ y sincronitation/ NUNCA deben aparecer aquí)
git branch
git status

# 2. Correr todas las pruebas automatizadas localmente
npm test
# (En PowerShell usa: npm.cmd test)

# 3. Guardar y subir tus cambios a tu rama de trabajo
git add <archivos>
git commit -m "descripcion clara del cambio"
git push -u origin mejoras
```

### Cómo revisar el reporte de pruebas en GitHub Actions
1. Al hacer `git push` a `mejoras` o abrir un **Pull Request → `main`**, se ejecuta automáticamente el workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
2. Entra en GitHub a **Actions → CI — Pruebas y Validación** (o haz clic en el check dentro del Pull Request).
3. En la pantalla principal del run verás la tabla de resumen generada por [`tests/ci-summary.js`](../tests/ci-summary.js) (`Validación y Pruebas Aprobadas` / `Fallidas`, conteo de pruebas y detalle por caso).
4. Cuando las pruebas pasen y hagas **Merge Pull Request → `main`**, [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) desplegará automáticamente en EC2.

---

## 4. Qué consultar en GitHub y en EC2

El servidor EC2 **no conserva `.env` en disco** (`SEAL_ENV_AFTER_DEPLOY=true`): las credenciales solo existen en RAM durante el arranque del contenedor y en tu configuración de GitHub.

### 4.1 Consultar configuración en GitHub
Ve en GitHub a **Settings → Secrets and variables → Actions**:
* **Variables (visibles en claro):** `EC2_HOST`, `EC2_USER`, `PORT`, `TZ`, `DB_HOST`, `DB_USER`, `DB_NAME`, `RCLONE_REMOTE`, `RCLONE_BACKUP_DIR`, `BACKUP_CRON_SCHEDULE` (`30 3 * * *`), `SEAL_ENV_AFTER_DEPLOY` (`true`).
* **Secrets (por seguridad GitHub nunca muestra su valor, solo permite reemplazarlos):** `EC2_SSH_KEY`, `DB_PASS`, `ADMIN_EMAIL`, `ADMIN_SECRET`, `WORD_PASSWORD`, `JOURNAL_SECRET_KEY`, `SMTP_USER`, `SMTP_PASS`, `RCLONE_CONF_B64`.
* Si no creas `APP_BASE_URL`, `deploy.yml` calcula automáticamente `http://${EC2_HOST}:${PORT}` en cada despliegue (solo créala si conectas un dominio propio HTTPS).

### 4.2 Consultar estado en el servidor EC2 (vía SSH)
Conéctate desde Git Bash:
```bash
ssh -i .ssh/clave-pmt.pem ubuntu@IP_DE_TU_EC2
```

Comandos útiles dentro de EC2:
```bash
# Estado de contenedores y uso actual de RAM (límites 512m MySQL + 220m Node)
docker ps
docker stats --no-stream

# Últimos logs de la aplicación web y de MySQL
docker logs --tail 50 mood_app
docker logs --tail 50 mood_db

# Confirmar que NO hay archivo .env expuesto en disco
ls -la ~/projects/mood-tracker

# Estado de la bóveda en servidor, metadatos no sensibles y logs del cron
~/projects/mood-tracker/scripts/env-vault.sh status
cat ~/projects/respaldos/.backup.meta
tail -n 30 ~/projects/respaldos/backup.log

# Hora del servidor y tarea cron diaria (3:30 AM hora TZ)
timedatectl
crontab -l

# Ver qué hay actualmente guardado en Google Drive
rclone ls gdrive:RespaldosApp

# Obtener de nuevo RCLONE_CONF_B64 (por si necesitas re-pegarlo en GitHub Secrets)
base64 -w 0 ~/.config/rclone/rclone.conf
```

---

## 5. Respaldos manuales y restauración desde Drive

* **Respaldo automático nocturno:** corre todos los días a las **03:30 AM** (`30 3 * * *`) en modo sellado (`SEALED_MODE=1`) sin necesitar `.env`, leyendo las variables activas dentro del contenedor `mood_db`.
* **Generar un respaldo manual inmediato en EC2:**
  ```bash
  ~/projects/mood-tracker/scripts/backup.sh
  ```
  Debes ver al final: `Respaldo completado (modo=sellado) y subido a gdrive:RespaldosApp/respaldo_mood_tracker.sql.gz`.
* **Restauración automática en instancia nueva o BD vacía:** durante el despliegue con `deploy.yml`, se ejecuta `ENV_FILE_OVERRIDE="$DEPLOY_ENV_FILE" ./scripts/restore.sh --if-empty`.
* **Restauración manual de emergencia** (en un servidor ya sellado que **no** tiene `.env` ni `.env.enc` en disco, ya que [`scripts/restore.sh`](../scripts/restore.sh) exige un archivo de entorno si se invoca directo):
  ```bash
  # Descarga desde Drive e importa directo usando las variables vivas de mood_db (sin crear .env)
  rclone copyto gdrive:RespaldosApp/respaldo_mood_tracker.sql.gz /tmp/restore_manual.sql.gz
  gunzip -c /tmp/restore_manual.sql.gz | docker exec -i mood_db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root "$MYSQL_DATABASE"'
  rm -f /tmp/restore_manual.sql.gz
  ```

---

## 6. Migración a otra instancia AWS EC2 (usando `.ssh/`)

### 6.1 Inventario de tus llaves SSH actuales (`.ssh/`)
En la carpeta `.ssh/` del proyecto (ignorada por `.gitignore`) tienes:

| Archivo | Para qué sirve | Dónde se usa al migrar |
| :--- | :--- | :--- |
| `.ssh/clave-pmt.pem` | Llave principal de AWS EC2 (Key pair creada en AWS) | La usas desde tu PC para entrar manualmente por primera vez a la nueva EC2 |
| `.ssh/github_deploy_key` | Llave privada dedicada para GitHub Actions (`secrets.EC2_SSH_KEY`) | Ya está guardada en **GitHub Secrets (`EC2_SSH_KEY`)** |
| `.ssh/github_deploy_key.pub` | Llave pública correspondiente a `github_deploy_key` | **Debes copiar su contenido** a `~/.ssh/authorized_keys` en la nueva instancia |

> **Regla clave:** Mientras conserves `.ssh/github_deploy_key` en `EC2_SSH_KEY` y agregues `.ssh/github_deploy_key.pub` a la nueva instancia, **no necesitas regenerar `EC2_SSH_KEY` en GitHub**.

### 6.2 Paso 1 — Respaldo previo antes de apagar la instancia vieja
1. Si la instancia actual sigue encendida, entra por SSH y ejecuta:
   ```bash
   ~/projects/mood-tracker/scripts/backup.sh
   ```
2. Confirma en GitHub (**Settings → Secrets and variables → Actions**) que tienes tus 9 Secrets y 11 Variables configurados, y que `APP_BASE_URL` **no** apunta a la IP antigua.

### 6.3 Paso 2 — Lanzar la nueva instancia en AWS
1. **AMI:** Ubuntu Server 22.04 / 24.04 LTS (`EC2_USER=ubuntu`) o Amazon Linux 2023 (`EC2_USER=ec2-user`).
2. **Tipo:** `t3.micro`.
3. **Disco (Storage):** `15 GB` o `20 GB` `gp3`.
4. **Par de llaves (Key pair):** elige `clave-pmt` (la misma que `.ssh/clave-pmt.pem`). *(Si eliges otro `.pem` nuevo, guárdalo en `.ssh/` y úsalo en los comandos de abajo en vez de `clave-pmt.pem`.)*
5. **Security Group:** abre TCP `22` (SSH) y TCP `3000` (o el puerto configurado en tu variable `PORT`).

### 6.4 Paso 3 — Autorizar llave de GitHub Actions y crear Swap (1 GB)

Reemplaza `NUEVA_IP` (y `ubuntu` por `ec2-user` si usas Amazon Linux):

#### Opción A: Comandos en **Git Bash** (recomendado)
```bash
cd "<RUTA_DEL_REPOSITORIO>"

# 1. Asegurar permisos de lectura exclusiva en las llaves privadas
chmod 600 .ssh/clave-pmt.pem .ssh/github_deploy_key

# 2. Autorizar .ssh/github_deploy_key.pub en el nuevo servidor sin duplicar líneas
PUB_KEY="$(tr -d '\r\n' < .ssh/github_deploy_key.pub)"
ssh -i .ssh/clave-pmt.pem ubuntu@NUEVA_IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '$PUB_KEY' ~/.ssh/authorized_keys || printf '%s\n' '$PUB_KEY' >> ~/.ssh/authorized_keys"

# 3. Probar desde ya que GitHub Actions podrá conectarse con github_deploy_key
ssh -i .ssh/github_deploy_key ubuntu@NUEVA_IP "whoami && echo SSH_DEPLOY_OK"

# 4. Conectarte manualmente para crear la memoria Swap
ssh -i .ssh/clave-pmt.pem ubuntu@NUEVA_IP
```

#### Opción B: Equivalente rápido en **PowerShell** (si `ssh` de Windows pide ACL estrictas)
```powershell
icacls ".\.ssh\clave-pmt.pem" /inheritance:r /grant:r "$($env:USERNAME):(R)"
icacls ".\.ssh\github_deploy_key" /inheritance:r /grant:r "$($env:USERNAME):(R)"

$pub = (Get-Content ".\.ssh\github_deploy_key.pub" -Raw).Trim()
ssh -i ".\.ssh\clave-pmt.pem" ubuntu@NUEVA_IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '$pub' ~/.ssh/authorized_keys || printf '%s\n' '$pub' >> ~/.ssh/authorized_keys"
ssh -i ".\.ssh\github_deploy_key" ubuntu@NUEVA_IP "whoami && echo SSH_DEPLOY_OK"
ssh -i ".\.ssh\clave-pmt.pem" ubuntu@NUEVA_IP
```

Una vez dentro de la nueva instancia por SSH, crea la **Swap de 1 GB**:
```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
exit
```

### 6.5 Paso 4 — Actualizar `EC2_HOST` y desplegar desde GitHub
1. En GitHub → **Settings → Secrets and variables → Actions → Variables**:
   * Actualiza **`EC2_HOST`** con `NUEVA_IP`.
   * Si cambiaste de sistema (ej. de Ubuntu a Amazon Linux), actualiza también **`EC2_USER`**.
2. Ve a **Actions → Deploy to AWS EC2 → Run workflow** (rama `main`).
3. El workflow instalará paquetes (`git`, `curl`, `rclone`, `cron`, `openssl`, `docker`), clonará el repo, levantará Docker leyendo secretos solo desde RAM (`/dev/shm`), restaurará tu base de datos desde Drive, ajustará hora y cron `30 3 * * *`, y no dejará `.env` en disco.

### 6.6 Paso 5 — Verificación final y rotación opcional de llave
* Abre `http://NUEVA_IP:3000` e inicia sesión para validar que ánimo, sueño, agenda y cuentas están restaurados.
* En tu PC Windows, si tu `.env.enc` tiene `GITHUB_TOKEN` + `GITHUB_REPO`, `sincronizador.py` tomará `NUEVA_IP` automáticamente tanto para **Journal Notes** (`/api/pull-text`) como para **English Notebook** (`/api/pull-english`) en <= 5 minutos (o al reiniciar el script), manteniendo la ruta relativa local `english-notes/English_Learning_Notebook.docx` sin tocar `.env` ni rutas.
* **Solo si algún día quieres rotar `.ssh/github_deploy_key`** en Git Bash:
  ```bash
  ssh-keygen -t ed25519 -C "mood-tracker-deploy" -f .ssh/github_deploy_key_nueva -N ""
  ```
  Actualiza el Secret **`EC2_SSH_KEY`** con el contenido de `.ssh/github_deploy_key_nueva`, agrega `.ssh/github_deploy_key_nueva.pub` a `~/.ssh/authorized_keys` en el servidor y retira la línea antigua.

---

## 7. Solución rápida de problemas

| Síntoma | Causa probable | Solución inmediata |
| :--- | :--- | :--- |
| El prompt oculto de `local-vault.js` o `sincronizador.py` se traba en Git Bash | Estás en ventana `mintty` fuera de VS Code sin ConPTY | Antepón `winpty`: `winpty node scripts/local-vault.js decrypt` |
| `WARNING: UNPROTECTED PRIVATE KEY FILE!` en SSH | Permisos demasiado abiertos en `.ssh/*.pem` o `github_deploy_key` | En Git Bash: `chmod 600 .ssh/clave-pmt.pem .ssh/github_deploy_key`. En PowerShell: `icacls ...` (Sección 6.4 Opción B) |
| `git push origin main` rechazado | Regla de protección en `main` | Cambia o sube desde tu rama de trabajo (`git push -u origin mejoras`) y haz Pull Request |
| `sincronizador.py` falla tras cambiar de IP EC2 | Falta `GITHUB_TOKEN` en `.env.enc` o sigue en caché <= 5 min | Verifica `GITHUB_TOKEN` y `GITHUB_REPO` con `local-vault.js run` o reinicia el sincronizador |
| Olvidaste correr `lock` / `encrypt` tras ver `.env` | `.env` plano quedó temporalmente en disco | Ejecuta `node scripts/local-vault.js lock` (si no editaste) o `encrypt` (si editaste) |

---

## 8. Notificaciones Móviles, Agenda Jira y Settings

No necesitas agregar nuevos *Secrets* ni *Variables* en GitHub para usar los recordatorios en tu teléfono ni las categorías de Agenda: todo se administra desde el menú **⚙️ Settings** dentro de la propia aplicación web y se guarda por usuario en MySQL (`ConfiguracionUsuario`).

### 8.1 Cómo recibir los recordatorios en la barra de notificaciones de tu celular (OPPO A79 / Android / iOS)

1. Instala la aplicación gratuita **ntfy** (desde Google Play Store en Android o App Store en iOS).
2. Entra a **Personal Daily Hub** en tu navegador → abre **⚙️ Settings** en la barra lateral.
3. En la tarjeta **📱 Phone Notification Bar (ntfy)**:
   * Marca **Enable notifications on my phone's notification bar**.
   * Haz clic en **Generate** para crear un tópico privado único (mínimo 8 caracteres, p. ej. `hub_personal_...`) o escribe uno propio difícil de adivinar.
   * Abre la app **ntfy** en tu celular, presiona **`+`** (*Subscribe to topic*), pega exactamente ese mismo nombre de tópico y deja el servidor por defecto (`https://ntfy.sh`). En OPPO ColorOS / Android conviene desactivar el ahorro agresivo de batería para **ntfy** para que lleguen al instante con la pantalla apagada.
   * Mantén desmarcada la casilla *Also show desktop browser notifications* si no necesitas alertas en tu computadora.
4. En **Personal Daily Hub → Settings**, haz clic en **Save All Settings** y después en **🔔 Send Test to Phone** para verificar que aparezca de inmediato en la barra de notificaciones de tu teléfono.

### 8.2 Reglas predeterminadas y configurables

| Módulo | Comportamiento por defecto | Qué puedes configurar en Settings |
| :--- | :--- | :--- |
| **Estado de Ánimo (`Mood Tracker`)** | Activo; recuerda a mitad de cada horario (**`09:00` Morning**, **`13:00` Noon**, **`17:00` Afternoon**, **`22:00` Night**) solo si aún no registraste ese bloque | Activar/desactivar; activar opcionalmente **`Madrugada` (`03:00 AM`)** |
| **Sueño (`Sleep Tracker`)** | Activo a las **`08:30 AM`** si no hay registro de sueño hoy | Hora personalizada + botones **Snooze 15m / 30m / 1h** |
| **Agenda (`University` & `Personal`)** | Activo **10 min antes** para Eventos y Tareas que no estén en estado `Done` | Activar/desactivar Eventos y/o Tareas, antelación global (`0–60 min`) o aviso individual por actividad; cambiar estado Jira (**To Do** / **In Progress** / **Done**) o posponer |
| **Revisión nocturna Word** | Activo a las **`21:30`** para revisar notas de Journal y English `.docx` | Cambiar hora o desactivar |
| **Estudio de Inglés** | **Desactivado por defecto** (100% bajo tu control) | Activar, escoger días de la semana (`Mon–Sun`), hora y nota de repaso |

### 8.3 Migrar contenedores existentes en AWS EC2

Cuando hagas merge de tu rama hacia `main`, GitHub Actions reconstruye automáticamente Docker en tu EC2 y al arrancar `server.js`:
* Se crean automáticamente `ConfiguracionUsuario` y `RecordatoriosEstado` (si no existían).
* Se añaden las columnas `tipo`, `categoria`, `estado` y `recordatorio_min` a `RegistrosAgenda` sin borrar ni afectar ningún dato anterior.
