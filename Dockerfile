FROM node:20-alpine

ENV NODE_ENV=production \
    YTM_INNERTUBE=1

WORKDIR /app

# Instalar solo dependencias de producción y limpiar caché para reducir imagen/almacenamiento
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Instalar rclone (respaldo y lectura Drive), Python 3, ffmpeg, unzip, certificados CA y yt-dlp autónomo
RUN apk add --no-cache python3 ca-certificates curl rclone unzip ffmpeg \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && /usr/local/bin/yt-dlp --version

# Copiar únicamente el código necesario de la app (excluido el resto vía .dockerignore)
COPY server.js version-history.json CHANGELOG.md ./
COPY public ./public
COPY lib ./lib

EXPOSE 3000

# Heap de V8 en 384 MB (compatible con container mem_limit 420m y 2 GB Swap en t3.micro)
CMD ["node", "--max-old-space-size=384", "server.js"]