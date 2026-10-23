# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Build the React client and compile the TypeScript server.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
COPY scripts ./scripts
COPY db ./db
COPY data ./data
COPY prompts ./prompts

RUN npm run build

# ---------------------------------------------------------------------------
# Runtime: no dev dependencies, no source maps served, Python for the harness.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/build ./build
COPY --from=builder /app/dist ./dist
COPY db ./db
COPY data ./data
COPY prompts ./prompts
COPY evals ./evals
COPY scripts ./scripts

RUN mkdir -p /app/.runtime/evals && chown -R node:node /app/.runtime /app/evals /app/build

USER node
EXPOSE 3000 9464

HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "build/src/server.js"]
