FROM node:22.18.0-bookworm-slim@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY docker/smtp/package.json ./docker/smtp/package.json
COPY docker/smtp/*.mjs ./docker/smtp/
RUN pnpm --filter @opensend/smtp-gateway deploy --prod --legacy --ignore-scripts /out

FROM node:22.18.0-bookworm-slim@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e
WORKDIR /app
COPY --from=build --chown=node:node /out ./
ENV NODE_ENV=production
USER node
EXPOSE 2465 2587
CMD ["node", "main.mjs"]
