FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# Instalar solo dependencias de producción y limpiar caché para reducir imagen/almacenamiento
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copiar únicamente el código necesario de la app (excluido el resto vía .dockerignore)
COPY server.js ./
COPY public ./public

EXPOSE 3000

# Limitar el heap de V8 a 128 MB para cuidar la RAM en instancias t3.micro (1 GB)
CMD ["node", "--max-old-space-size=128", "server.js"]