FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependency layer
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY migrations ./migrations

EXPOSE 3000
CMD ["bun", "run", "src/main.ts"]
