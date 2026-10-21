FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /app/logs && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.js"]
