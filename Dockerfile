FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY client/package*.json ./client/
RUN npm --prefix client ci
COPY tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts
COPY client ./client
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 SQLITE_DB_PATH=/app/storage/shiftweave.db
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/client/dist ./client/dist
COPY --chown=node:node package.json ./
COPY --chown=node:node data/incoming/sample_template.json ./data/incoming/sample_template.json
COPY --chown=node:node data/hospital ./data/hospital
COPY --chown=node:node data/simulations ./data/simulations
RUN mkdir -p /app/storage /app/backups && chown -R node:node /app/storage /app/backups
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
