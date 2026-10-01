FROM node:22.17.0-bookworm-slim@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0 AS build
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/call-gateway/package.json services/call-gateway/package.json
RUN pnpm install --filter @opensendcc/call-gateway --frozen-lockfile
COPY services/call-gateway/ services/call-gateway/
RUN pnpm --filter @opensendcc/call-gateway build

# The lead can build this target to run a pure-JS Meta peer on the compose network.
FROM build AS harness
USER node
CMD ["pnpm", "--filter", "@opensendcc/call-gateway", "harness"]

FROM node:22.17.0-bookworm-slim@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0 AS runtime
ENV NODE_ENV=production PORT=8090
WORKDIR /app
# The HTTP/Janus/ESL controller has no production dependencies.
COPY --from=build --chown=node:node /app/services/call-gateway/dist /app/dist
COPY --from=build --chown=node:node /app/services/call-gateway/package.json /app/package.json
USER node
EXPOSE 8090
CMD ["node", "dist/main.js"]
