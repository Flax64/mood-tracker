# 🛠️ Guía Rápida de Comandos del Proyecto (Git Bash, PC, Docker y AWS EC2)

## Índice de Comandos
1. [1. Comandos para Dividir Archivos y Cargar a la IA (Git Bash)](#1-comandos-para-dividir-archivos-y-cargar-a-la-ia-git-bash)
   - [1.1 Script Completo por Tamaño (118 KB en `codigo_dividido/`)](#11-script-completo-por-tamaño-118-kb-en-codigo_dividido)
   - [1.2 División con Número de Línea Exacto (`for-gemini/`)](#12-división-con-número-de-línea-exacto-for-gemini)
2. [2. Comandos de Consulta de Información y Diagnóstico](#2-comandos-de-consulta-de-información-y-diagnóstico)
3. [3. Comandos para Reiniciar, Iniciar y Detener Servicios](#3-comandos-para-reiniciar-iniciar-y-detener-servicios)
4. [4. Comandos de la Bóveda de Seguridad (`.env.enc` y Windows DPAPI)](#4-comandos-de-la-bóveda-de-seguridad-envenc-y-windows-dpapi)
5. [5. Comandos de Base de Datos MySQL y Respaldos en Google Drive (`rclone`)](#5-comandos-de-base-de-datos-mysql-y-respaldos-en-google-drive-rclone)
6. [6. Comandos del Worker Local de PC (`sincronizador.py` y `yt-dlp`)](#6-comandos-del-worker-local-de-pc-sincronizadorpy-y-yt-dlp)
7. [7. Comandos de Pruebas, Git, Commits Desglosados y Despliegue](#7-comandos-de-pruebas-git-commits-desglosados-y-despliegue)

---

## 1. Comandos para Dividir Archivos y Cargar a la IA (Git Bash)

### 1.1 Script Completo por Tamaño (118 KB en `codigo_dividido/`)
Divide automáticamente todo el código fuente del proyecto en partes de `118 KB` listas para subir a la IA, excluyendo `.git`, `node_modules`, `for-gemini` y `codigo_dividido`:

```bash
# Eliminar extracción anterior
rm -rf codigo_dividido

# Crear carpeta
mkdir -p codigo_dividido

# Buscar archivos del proyecto y dividirlos en bloques de 118 KB
find . -type f \( \
    -name "*.java" -o -name "*.js" -o -name "*.html" -o -name "*.css" -o -name "*.sql" -o \
    -name "*.cs" -o -name "*.py" -o -name "*.cpp" -o -name "*.h" -o -name "*.xml" -o \
    -name "*.json" -o -name "*.yml" -o -name "*.yaml" -o -name "Dockerfile" -o \
    -name "Dockerfile.*" -o -name "docker-compose*" -o -name "compose.yml" -o \
    -name "compose.yaml" -o -name ".dockerignore" -o -name ".gitignore" -o \
    -name ".env.example" -o -name "Makefile" \
\) \
-not -path "./.git/*" \
-not -path "./node_modules/*" \
-not -path "./codigo_dividido/*" \
-not -path "./for-gemini/*" \
| while IFS= read -r archivo; do

    nombre=$(basename "$archivo")
    nombre_limpio="${nombre%.*}"
    extension="${nombre##*.}"

    split -b 118K -d -a 3 \
    --additional-suffix=".$extension.txt" \
    "$archivo" "codigo_dividido/${nombre_limpio}_parte_"

done
```

### 1.2 División con Número de Línea Exacto (`for-gemini/`)
Útil cuando necesitas pasar un archivo específico o un rango de líneas numeradas a la IA:

```bash
# Preparar carpeta for-gemini limpia
mkdir -p for-gemini && rm -f for-gemini/*.txt

# Dividir archivos Python con números de línea exactos
nl -ba sincronitation/yt_lyrics_helper.py | split -l 550 -d -a 2 - for-gemini/PY_HELPER_ && \
for f in for-gemini/PY_HELPER_*; do mv "$f" "${f}.txt"; done

nl -ba sincronitation/sincronizador.py | split -l 1200 -d -a 2 - for-gemini/PY_SINCRO_ && \
for f in for-gemini/PY_SINCRO_*; do mv "$f" "${f}.txt"; done

# Dividir frontend.js, server.js o style.css con números de línea
nl -ba public/frontend.js | split -l 2500 -d -a 2 - for-gemini/FRONT_ && \
for f in for-gemini/FRONT_*; do mv "$f" "${f}.txt"; done

nl -ba server.js | split -l 2000 -d -a 2 - for-gemini/SERVER_ && \
for f in for-gemini/SERVER_*; do mv "$f" "${f}.txt"; done

# Guardar resultado de pruebas en archivo de texto para enviar a la IA
npm test > for-gemini/error_actual.txt 2>&1 || true
```

---

## 2. Comandos de Consulta de Información y Diagnóstico

### En tu PC Local (Git Bash)
```bash
# Consultar estado de la bóveda local (.env vs .env.enc)
node scripts/local-vault.js status

# Consultar desde dónde se resuelve yt-dlp en tu PC (PATH o GitHub Variable YT_DLP_PATH)
python sincronitation/yt_lyrics_helper.py --check-yt-dlp

# Ver las últimas 40 líneas del log del sincronizador en tu PC
tail -n 40 sincronitation/historial.log

# Ver en vivo lo que está haciendo sincronizador.py en tu PC
tail -f sincronitation/historial.log

# Consultar si hay procesos de Word (WINWORD.EXE) ocultos o colgados en Windows
tasklist //FI "IMAGENAME eq WINWORD.EXE"
```

### En el Servidor AWS EC2 (vía SSH)
```bash
# Ver estado y consumo de contenedores Docker (App y MySQL)
docker compose ps
docker stats --no-stream

# Ver memoria RAM y Swap disponible en la instancia t3.micro
free -h

# Ver espacio en disco disponible en la instancia
df -h

# Consultar logs en tiempo real del servidor Node.js (últimas 100 líneas)
docker logs --tail 100 -f mood_app

# Consultar logs del contenedor MySQL
docker logs --tail 50 mood_db

# Consultar registro del respaldo automático nocturno hacia Google Drive
tail -n 50 ~/projects/respaldos/backup.log

# Ver tareas programadas en Cron (respaldo diario 3:30 AM)
crontab -l
```

---

## 3. Comandos para Reiniciar, Iniciar y Detener Servicios

### En tu PC Local (Sincronizador y Entorno Local)
```bash
# Iniciar la app localmente leyendo .env.enc solo en memoria RAM (sin dejar .env en disco)
node scripts/local-vault.js run -- npm start

# Iniciar el sincronizador de Word + Puente de Letras en PC
python sincronitation/sincronizador.py

# Reiniciar el sincronizador en PC si ya estaba corriendo en segundo plano
taskkill //F //IM python.exe //FI "WINDOWTITLE eq *sincronizador*" 2>/dev/null || true
python sincronitation/sincronizador.py

# Liberar procesos WINWORD.EXE colgados en segundo plano (si Word se bloqueó)
taskkill //F //IM WINWORD.EXE
```

### En el Servidor AWS EC2 (Docker)
```bash
# Reiniciar únicamente el servidor Node.js (rápido, sin tocar MySQL)
docker restart mood_app

# Reiniciar la base de datos MySQL y la aplicación
docker restart mood_db mood_app

# Levantar o reconstruir contenedores usando la bóveda sellada (.env.enc)
./scripts/env-vault.sh up

# Detener todos los contenedores sin perder datos del volumen MySQL
docker compose down
```

---

## 4. Comandos de la Bóveda de Seguridad (`.env.enc` y Windows DPAPI)

```bash
# Cifrar tu archivo .env local a .env.enc (AES-256-CBC + PBKDF2 600,000 iteraciones) y borrar .env plano
node scripts/local-vault.js encrypt

# Descifrar temporalmente .env.enc a .env para editar variables
node scripts/local-vault.js decrypt

# Volver a bloquear/borrar el .env plano asegurando que exista .env.enc
node scripts/local-vault.js lock

# Configurar el autoinicio en Windows (guarda la clave en Windows DPAPI de tu usuario)
python sincronitation/sincronizador.py --configurar-autoinicio

# Probar que el autoinicio Windows DPAPI descifra .env.enc en RAM correctamente
python sincronitation/sincronizador.py --probar-autoinicio

# Eliminar la clave guardada en Windows DPAPI
python sincronitation/sincronizador.py --quitar-autoinicio
```

---

## 5. Comandos de Base de Datos MySQL y Respaldos en Google Drive (`rclone`)

```bash
# Ejecutar respaldo manual inmediato a Google Drive + actualizar historico_completo.json.gz + purga >30 días
./scripts/backup.sh

# Restaurar respaldo desde Google Drive solo si la base de datos está vacía
./scripts/restore.sh --if-empty

# Forzar restauración completa desde Google Drive (sobrescribe datos locales con el último backup)
./scripts/restore.sh --force

# Consultar conteo de registros actuales en MySQL local (ventana de 30 días)
docker exec -i mood_db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root "$MYSQL_DATABASE" -e "
SELECT \"Mood\" AS Tabla, COUNT(*) AS Registros FROM RegistrosMood
UNION ALL SELECT \"Sleep\", COUNT(*) FROM RegistrosSleep
UNION ALL SELECT \"Crisis\", COUNT(*) FROM RegistrosCrisis
UNION ALL SELECT \"Agenda\", COUNT(*) FROM RegistrosAgenda
UNION ALL SELECT \"Canciones\", COUNT(*) FROM MusicaCanciones;"'

# Listar archivos de respaldo almacenados en Google Drive vía rclone
rclone lsl gdrive:RespaldosApp
```

---

## 6. Comandos del Worker Local de PC (`sincronizador.py` y `yt-dlp`)

```bash
# Extraer letra limpia y metadatos de una canción de YouTube / YT Music y copiarla al portapapeles
python sincronitation/yt_lyrics_helper.py "https://www.youtube.com/watch?v=VIDEO_ID" --clip

# Extraer subtítulos en Coreano, Inglés y Español y guardarlos en archivo .txt UTF-8
python sincronitation/yt_lyrics_helper.py "https://music.youtube.com/watch?v=VIDEO_ID" --langs ko,en,es --out letra.txt

# Limpiar un archivo de subtítulos local (.vtt, .srt o .lrc) sin usar internet
python sincronitation/yt_lyrics_helper.py --clean-file subtitulos.vtt --clip
```

---

## 7. Comandos de Pruebas, Git, Commits Desglosados y Despliegue

```bash
# Ejecutar la suite completa de 67 pruebas automatizadas (Sintaxis, Bóveda, API, Cripto, i18n, yt-dlp)
npm test

# Validar únicamente sintaxis rápida de Node.js y Bash
node --check server.js && node --check public/frontend.js && bash -n scripts/*.sh

# Ver estado de archivos modificados y rama actual
git status -sb

# Crear commit desglosado con título corto (<50 chars para que GitHub no lo corte) y viñetas detalladas
git add -A && git commit \
  -m "feat(scope): short summary under 50 chars" \
  -m "- Detalle 1 del cambio realizado." \
  -m "- Detalle 2 del cambio realizado."

# Subir cambios a la rama actual en GitHub
git push -u origin HEAD

# Simular cálculo de siguiente versión SemVer 2.0.0 sin modificar archivos
node scripts/release-version.js
```
