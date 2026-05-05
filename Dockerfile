# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
# Install both prod + dev dependencies; native modules (better-sqlite3) are built
# here so the builder stage can reuse the cache.
FROM node:22-alpine AS deps

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ─── Stage 2: Builder ─────────────────────────────────────────────────────────
FROM deps AS builder

WORKDIR /app

COPY . .

# Generate Prisma client (output → src/generated/prisma) before Next.js build
RUN npx prisma generate

# Build the Next.js application (standalone output for minimal image)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Stage 3: Runner ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3333
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser

# Create directories the app expects at runtime
RUN mkdir -p /app/data/geoip /app/prisma /app/logs && \
    chown -R appuser:appgroup /app

# Copy built Next.js standalone output
COPY --from=builder /app/.next/standalone ./

# Copy static assets (public + .next/static)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static

# Copy server entry point (custom Socket.IO server)
COPY --from=builder /app/server.mjs ./server.mjs

# Copy Prisma schema and migrations so prisma migrate can run at startup
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Copy Prisma client generated code
COPY --from=builder /app/src/generated ./src/generated

# Copy instrumentation for background health checks / broadcaster
COPY --from=builder /app/instrumentation.ts ./instrumentation.ts

USER appuser

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3333/ || exit 1

CMD ["node", "server.mjs"]
