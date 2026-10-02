#!/bin/bash

# 1. Cargar las credenciales directamente desde tu archivo .env
# (Sustituye esta ruta por la ruta real donde está tu proyecto y tu .env)
set -a
source /home/ubuntu/projects/mood_tracker/.env
set +a

# 2. Variables de configuración
CONTENEDOR="mood_db" # Asegúrate de poner el nombre exacto de tu contenedor de MySQL
RUTA_LOCAL="/home/ubuntu/projects/respaldos"
# Al usar un nombre estático, el sistema simplemente aplastará el archivo del día anterior
ARCHIVO="$RUTA_LOCAL/respaldo_mood_tracker.sql.gz"

# Crear la carpeta local si no existe
mkdir -p $RUTA_LOCAL

# 3. Extraer la base de datos usando las variables del .env
docker exec $CONTENEDOR /usr/bin/mysqldump -u $DB_USER -p"$DB_PASS" $DB_NAME | gzip > $ARCHIVO

# 4. Subir a Google Drive
# Rclone detectará que el archivo ya existe y lo sobreescribirá
/usr/bin/rclone copy $ARCHIVO gdrive:RespaldosApp