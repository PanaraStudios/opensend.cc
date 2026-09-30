FROM node:22.18.0-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b AS migrate-deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY docker/smtp/package.json ./docker/smtp/package.json
COPY docker/migrate/package.json ./docker/migrate/package.json
# Optional peers include frontend/test tooling. The CLI only needs esbuild's
# native executable; install that one optional dependency at its locked version.
RUN pnpm --filter @opensend/migrate deploy --prod --no-optional --ignore-scripts --config.inject-workspace-packages=true /out
RUN node --input-type=module <<'JS'
import { createRequire } from "node:module"
import { mkdirSync, realpathSync, writeFileSync } from "node:fs"
const cli = createRequire(realpathSync("/out/node_modules/convex/package.json"))
const esbuild = cli("esbuild/package.json")
mkdirSync("/esbuild")
writeFileSync("/esbuild/package.json", JSON.stringify({
  dependencies: { [`@esbuild/linux-${process.arch}`]: esbuild.version },
}))
JS
RUN pnpm --dir /esbuild install --prod --ignore-scripts \
    && cp /esbuild/node_modules/@esbuild/linux-*/bin/esbuild /out/esbuild

FROM node:22.18.0-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b AS migrate
WORKDIR /app
ENV NODE_ENV=production ESBUILD_BINARY_PATH=/usr/local/bin/esbuild
COPY --from=migrate-deps /out/esbuild /usr/local/bin/esbuild
COPY --from=migrate-deps --chown=node:node /out/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node convex ./convex
COPY --chown=node:node lib ./lib
COPY --chown=node:node scripts/convex-env.mjs ./scripts/convex-env.mjs
COPY --chown=node:node docker/migrate/run.mjs ./docker/migrate/run.mjs
USER node
ENTRYPOINT ["node", "docker/migrate/run.mjs"]

FROM node:22.18.0-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY docker/smtp/package.json ./docker/smtp/package.json
COPY docker/migrate/package.json ./docker/migrate/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22.18.0-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
