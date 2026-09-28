FROM node:22.18.0-bookworm-slim@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY docker/smtp/*.mjs ./docker/smtp/
ENV NODE_ENV=production
USER node
EXPOSE 2465 2587
CMD ["node", "docker/smtp/main.mjs"]
