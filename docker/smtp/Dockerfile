FROM node:22.18.0-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY docker/smtp/package.json ./docker/smtp/package.json
RUN pnpm --filter @opensend/smtp-gateway deploy --prod --ignore-scripts --config.inject-workspace-packages=true /out
COPY docker/smtp/main.mjs docker/smtp/server.mjs /out/

FROM node:22.18.0-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b
WORKDIR /app
COPY --from=build --chown=node:node /out ./
ENV NODE_ENV=production
USER node
EXPOSE 2465 2587
CMD ["node", "main.mjs"]
