FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY docker/smtp/package.json ./docker/smtp/package.json
RUN pnpm --filter @opensend/smtp-gateway deploy --prod --ignore-scripts --config.inject-workspace-packages=true /out
COPY docker/smtp/main.mjs docker/smtp/server.mjs /out/

FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /app
COPY --from=build --chown=node:node /out ./
ENV NODE_ENV=production
USER node
EXPOSE 2465 2587
CMD ["node", "main.mjs"]
