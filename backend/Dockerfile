# Сборка отдельно от запуска: в готовый образ не попадают ни исходники TypeScript,
# ни инструменты сборки — только собранный код и то, что нужно во время работы.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Схема едет раньше зависимостей: postinstall этого проекта сразу зовёт prisma generate.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg — голосовые и кружки; openssl нужен Prisma; ca-certificates — для HTTPS
# к Telegram и моделям. Списки пакетов не оставляем, чтобы образ не рос впустую.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Только то, что нужно в работе: инструменты сборки и тестов в образе не нужны.
# prisma CLI остаётся — он применяет миграции при старте, поэтому это прод-зависимость.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

# Данные живут в томе: база, медиа, загрузки и личности переживают пересборку образа.
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]
USER node

EXPOSE 8011
# Миграции применяются при старте: образ и схема всегда едут вместе.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
