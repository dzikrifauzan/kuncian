# Tahap 1: build frontend (React + esbuild)
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Tahap 2: dependensi server (web-push dan nodemailer, tanpa modul native)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Tahap 3: image akhir
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/scripts ./scripts
COPY --from=web /web/dist ./public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
