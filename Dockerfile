FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS migrate-deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The backend package and the workspace packages its functions import.
COPY packages/backend ./packages/backend
COPY packages/core ./packages/core
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/sdk/src ./packages/sdk/src
COPY services/call-gateway/package.json ./services/call-gateway/package.json
COPY services/call-gateway/src ./services/call-gateway/src
# /out becomes the backend package with its production node_modules. The
# workspace packages are copied in whole (deployAllFiles): Convex bundles the
# SDK's source contracts, which its npm "files" list leaves out.
# Optional peers include frontend/test tooling. The CLI only needs esbuild's
# native executable; install that one optional dependency at its locked version.
RUN pnpm --filter @opensend/backend deploy --prod --no-optional --ignore-scripts --config.inject-workspace-packages=true --config.deployAllFiles=true /out
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

FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS migrate
ARG RELEASE_TAG
ENV OPENSEND_RELEASE_VERSION=${RELEASE_TAG}
WORKDIR /app
ENV NODE_ENV=production ESBUILD_BINARY_PATH=/usr/local/bin/esbuild
COPY --from=migrate-deps /out/esbuild /usr/local/bin/esbuild
# The backend package: convex/, its convex.json (which pins the Node version
# Convex Cloud runs "use node" actions on) and node_modules.
COPY --from=migrate-deps --chown=node:node /out/package.json /out/convex.json ./
COPY --from=migrate-deps --chown=node:node /out/convex ./convex
COPY --from=migrate-deps --chown=node:node /out/node_modules ./node_modules
COPY --chown=node:node scripts/convex-env.mjs ./scripts/convex-env.mjs
COPY --chown=node:node packages/core/src/telemetry.ts ./packages/core/src/telemetry.ts
COPY --chown=node:node docker/migrate/run.mjs ./docker/migrate/run.mjs
USER node
ENTRYPOINT ["node", "docker/migrate/run.mjs"]

FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY docker/smtp/package.json ./docker/smtp/package.json
# The workspace packages the app imports. Their manifests must be here before
# the install; their source comes with COPY . . below.
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY services/call-gateway/package.json ./services/call-gateway/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# COPY brings in services/*, whose dependencies the app never loads (each
# service has its own image and typecheck). pnpm's pre-run check would
# reinstall them from the registry on every build.
RUN pnpm --config.verify-deps-before-run=false build

FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
