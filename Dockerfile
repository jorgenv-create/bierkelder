FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json LICENSE ./
RUN npm ci --no-audit --no-fund
COPY app ./app
COPY public ./public
COPY selfhost ./selfhost
RUN npm run build && npm test

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /src/dist-selfhost/ ./
RUN install -d -o node -g node -m 0770 /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--max-old-space-size=192", "server.mjs"]
