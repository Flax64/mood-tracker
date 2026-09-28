FROM node:18-alpine

WORKDIR /app

# Copiar dependencias e instalar
COPY package*.json ./
RUN npm install

# Copiar el resto del código (incluyendo la carpeta /public)
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]