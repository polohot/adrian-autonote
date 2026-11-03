FROM docker.io/library/node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# Optional company root certificate for TLS-inspecting networks (see .env.example).
RUN --mount=type=secret,id=corp_ca \
    if [ -s /run/secrets/corp_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/corp_ca; fi; \
    npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM docker.io/library/node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    AUTONOTE_DATA_DIR=/data

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY container/entrypoint.sh ./container/entrypoint.sh
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
VOLUME /data
ENTRYPOINT ["sh", "/app/container/entrypoint.sh"]
