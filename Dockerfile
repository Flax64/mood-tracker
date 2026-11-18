FROM node:20-alpine

ENV NODE_ENV=production \
    YTM_INNERTUBE=1

WORKDIR /app

# Instalar solo dependencias de producción y limpiar caché para reducir imagen/almacenamiento
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Instalar rclone (respaldo y Drive Estudio), Python 3, msoffcrypto-tool (cifrado local Diario.docx), ffmpeg, unzip, certificados CA y yt-dlp autónomo
RUN apk add --no-cache python3 py3-cryptography py3-olefile py3-pip ca-certificates curl rclone unzip ffmpeg \
    && pip3 install --no-cache-dir --break-system-packages --no-deps msoffcrypto-tool \
    && python3 -c "import msoffcrypto; print('msoffcrypto OK')" \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && /usr/local/bin/yt-dlp --version

# Copiar únicamente el código necesario de la app (excluido el resto vía .dockerignore)
COPY server.js version-history.json CHANGELOG.md ./
COPY public ./public
COPY lib ./lib

EXPOSE 3000

# Heap de V8 en 768 MB (optimizado para servidor Ubuntu con 8 GB RAM y container mem_limit 1024m)
CMD ["node", "--max-old-space-size=768", "server.js"]