FROM node:22.17.0-bookworm-slim@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0 AS dependencies
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/call-gateway/package.json services/call-gateway/package.json
# Deploy from the shared lock into an isolated package; install no root app dependencies.
RUN --mount=type=cache,id=opensend-calling-test-pnpm,target=/root/.local/share/pnpm/store \
    printf '\nfetchTimeout: 300000\n' >> pnpm-workspace.yaml \
    && CI=true pnpm --config.inject-workspace-packages=true --filter @opensendcc/call-gateway deploy /gateway
FROM dependencies AS production-deps
WORKDIR /gateway
# Keep the repository's existing build approvals for the standalone prune.
COPY pnpm-workspace.yaml /gateway/pnpm-workspace.yaml
RUN --mount=type=cache,id=opensend-calling-test-pnpm,target=/root/.local/share/pnpm/store \
    CI=true pnpm prune --prod

FROM dependencies AS build
COPY services/call-gateway/ /gateway/
WORKDIR /gateway
RUN node node_modules/typescript/bin/tsc -p tsconfig.build.json

# Docker-only Meta peer and real headless SIP.js browser on the compose network.
FROM node:22.17.0-bookworm-slim@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0 AS harness-browser
# Keep Chromium independent of source changes so harness iterations reuse this layer.
RUN apt-get update && apt-get install -y --no-install-recommends chromium \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@11.7.0 --activate
FROM harness-browser AS harness
WORKDIR /app
COPY --from=build --chown=node:node /gateway /app
RUN node_modules/.bin/esbuild scripts/browser-agent.ts \
    --bundle --platform=browser --outfile=/app/agent.js
USER node
CMD ["node", "node_modules/tsx/dist/cli.mjs", "scripts/meta-peer.ts"]

FROM node:22.17.0-bookworm-slim@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0 AS runtime
ENV NODE_ENV=production PORT=8090
WORKDIR /app
# Include the pinned drachtio-srf production dependency and its closure.
COPY --from=production-deps --chown=node:node /gateway/node_modules /app/node_modules
COPY --from=build --chown=node:node /gateway/dist /app/dist
COPY --from=build --chown=node:node /gateway/package.json /app/package.json
USER node
EXPOSE 8090
CMD ["node", "dist/main.js"]
