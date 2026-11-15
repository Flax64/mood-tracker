FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# Instalar solo dependencias de producción y limpiar caché para reducir imagen/almacenamiento
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Instalar Python 3 + yt-dlp oficial (zipimport) para letras/subtítulos y streams reproducibles en t3.micro
RUN apk add --no-cache python3 ca-certificates curl \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Copiar únicamente el código necesario de la app (excluido el resto vía .dockerignore)
COPY server.js version-history.json CHANGELOG.md ./
COPY public ./public
COPY lib ./lib

EXPOSE 3000

# Limitar el heap de V8 a 128 MB para cuidar la RAM en instancias t3.micro (1 GB)
CMD ["node", "--max-old-space-size=128", "server.js"]