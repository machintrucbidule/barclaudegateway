# syntax=docker/dockerfile:1
#
# BarclaudeGateway production image. Built ONLY by CI on GitHub's Linux runners (never on the
# Windows dev box). One process: Fastify serves the built SPA + the /api and /v1 routes.
# The SQLite file (on the /data volume) and BCG_MASTER_KEY (injected at run time) are the only
# state — neither is ever baked into this image.

############ Builder ############
# Node 24 base: the backend uses the built-in `node:sqlite`, which needs Node 24+.
FROM node:24-slim AS builder
WORKDIR /app

# Copy manifests first so the npm ci layer is cached until a dependency actually changes.
# .npmrc carries engine-strict (Node/npm version gate) + save-exact.
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json   packages/shared/
COPY packages/backend/package.json  packages/backend/
COPY packages/frontend/package.json packages/frontend/
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

# Sources + the shared root tsconfig, then build shared → backend → frontend.
COPY tsconfig.base.json ./
COPY packages/ packages/
RUN npm run build

# Prune to production dependencies only, then materialize the workspace package
# @barclaudegateway/shared as a REAL directory (a cross-stage COPY of the npm workspace symlink is
# fragile). The runtime stage then carries a self-contained node_modules.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts \
 && rm -rf node_modules/@barclaudegateway/shared \
 && mkdir -p node_modules/@barclaudegateway/shared \
 && cp packages/shared/package.json node_modules/@barclaudegateway/shared/ \
 && cp -r packages/shared/dist      node_modules/@barclaudegateway/shared/dist

############ Runtime ############
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    BCG_PORT=8090 \
    BCG_HOST=0.0.0.0 \
    BCG_DB_PATH=/data/barclaudegateway.sqlite \
    BCG_UI_DIR=/app/packages/frontend/dist
WORKDIR /app

# Keep packages/backend/dist and packages/frontend/dist as siblings (main.ts resolves the SPA
# relative to the backend dist by default; BCG_UI_DIR above pins it regardless).
COPY --from=builder --chown=node:node /app/node_modules           ./node_modules
COPY --from=builder --chown=node:node /app/packages/backend/dist  ./packages/backend/dist
COPY --from=builder --chown=node:node /app/packages/frontend/dist ./packages/frontend/dist

# The SQLite directory must exist and be writable by the non-root runtime user. A fresh named volume
# inherits this ownership; a bind-mounted host dir must be chown'd to uid/gid 1000 by the operator.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

EXPOSE 8090
USER node

# Liveness only: hits /livez (always 200 while the server is up), NOT /health (which probes
# Chronodrive and would report 503 — and could trigger restarts — when the upstream is merely down).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BCG_PORT||8090)+'/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/backend/dist/main.js"]
