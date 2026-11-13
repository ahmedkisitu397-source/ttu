FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV APP_ENV=production PORT=8787 DATABASE_PATH=/data/ttu.db
VOLUME /data
EXPOSE 8787
CMD ["node", "--env-file-if-exists=.env", "server.js"]
