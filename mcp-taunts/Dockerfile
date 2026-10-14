FROM node:22-bookworm-slim
WORKDIR /srv
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
USER node
EXPOSE 8790
CMD ["node", "server.js"]
