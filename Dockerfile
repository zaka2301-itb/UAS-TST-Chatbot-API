FROM node:alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 2301

CMD ["/bin/sh", "-c", "npx prisma generate && node dist/index.js"]