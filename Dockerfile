FROM node:20-alpine

ENV NODE_ENV=production \
    YTM_INNERTUBE=1 \
    TZ=America/Monterrey \
    XDG_CACHE_HOME=/tmp/.cache

WORKDIR /app

# Instalar solo dependencias de producción y limpiar caché para reducir imagen/almacenamiento
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Instalar tzdata, rclone (respaldo y Drive Estudio opcional), Python 3, msoffcrypto-tool (cifrado local Diario.docx), ffmpeg, unzip, CA y yt-dlp autónomo
RUN apk add --no-cache tzdata python3 py3-cryptography py3-olefile py3-pip ca-certificates curl rclone unzip ffmpeg \
    && pip3 install --no-cache-dir --break-system-packages --no-deps msoffcrypto-tool \
    && python3 -c "import msoffcrypto; from msoffcrypto.format.ooxml import OOXMLFile; print('msoffcrypto OOXML OK')" \
    && node -v \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && /usr/local/bin/yt-dlp --version \
    && ffmpeg -version | head -n 1

# Copiar únicamente el código necesario de la app (excluido el resto vía .dockerignore)
COPY server.js version-history.json CHANGELOG.md ./
COPY public ./public
COPY lib ./lib

# Asegurar permisos legibles y directorios de volúmenes con UID/GID 1000 (usuario estándar Ubuntu)
RUN test -f /app/lib/docx_writer.py \
    && chmod -R a+rX /app/server.js /app/version-history.json /app/CHANGELOG.md /app/public /app/lib \
    && mkdir -p /app/journal-data /app/english-notes /app/ytdlp-config /app/logs /tmp/.cache \
    && chown -R 1000:1000 /app/journal-data /app/english-notes /app/ytdlp-config /app/logs /tmp/.cache

EXPOSE 3000

# Heap de V8 en 768 MB (optimizado para servidor Ubuntu con 8 GB RAM y container mem_limit 1024m)
CMD ["node", "--max-old-space-size=768", "server.js"]