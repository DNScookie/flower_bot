FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY data.json ./
RUN npm run build

ENV BOT_TOKEN=""
ENV DATA_FILE="/app/data.json"

CMD ["node", "dist/index.js"]
