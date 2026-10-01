#!/usr/bin/env bash
# Обновление рабочей установки. Запускается из CI по ssh, но подходит и руками:
#   bash deploy/deploy.sh
# Ожидает, что репозиторий уже стоит на нужном коммите, а рядом лежит .env.
#
# Порядок: снимок базы → пересборка образов → перезапуск → ожидание healthcheck.
# Если бэкенд не поднялся, скрипт откатывает код и образы на прежний коммит.
set -euo pipefail

cd "$(dirname "$0")/.."

TARGET_SHA="${1:-$(git rev-parse HEAD)}"
PREV_SHA="$(cat .deployed-sha 2>/dev/null || true)"
BACKUP_DIR="${BACKUP_DIR:-backups}"
KEEP_BACKUPS="${KEEP_BACKUPS:-14}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-240}"

log() { printf '[deploy] %s\n' "$*"; }

[ -f .env ] || { log "нет .env рядом с docker-compose.yml"; exit 1; }

# Из .env нужны только имя базы и пользователь; целиком файл не source'им,
# чтобы значения с пробелами и спецсимволами не ломали shell.
env_value() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '"' ; }
PG_USER="$(env_value POSTGRES_USER)"; PG_USER="${PG_USER:-nastya}"
PG_DB="$(env_value POSTGRES_DB)";     PG_DB="${PG_DB:-nastya}"

wait_healthy() {
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    local cid state
    cid="$(docker compose ps -q backend 2>/dev/null || true)"
    state=""
    [ -n "$cid" ] && state="$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || true)"
    case "$state" in
      healthy) return 0 ;;
      unhealthy) return 1 ;;
    esac
    sleep 5
  done
  return 1
}

# 1. Снимок базы, пока прежняя версия ещё работает. Без базы (первый запуск)
#    пропускаем.
if docker compose ps --status running --services 2>/dev/null | grep -qx db; then
  mkdir -p "$BACKUP_DIR"
  snapshot="$BACKUP_DIR/$PG_DB-$(date +%F-%H%M%S)-${PREV_SHA:0:7}.sql.gz"
  log "снимок базы: $snapshot"
  docker compose exec -T db pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$snapshot"
  # Старые снимки чистим, оставляем KEEP_BACKUPS последних.
  ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
else
  log "база не запущена, снимок пропущен"
fi

# 2. Сборка образов отдельно от перезапуска: если сборка упала, старые
#    контейнеры продолжают работать.
log "сборка образов для ${TARGET_SHA:0:7}"
docker compose build --quiet

# 3. Перезапуск. Миграции применяет сам контейнер бэкенда при старте.
log "перезапуск"
docker compose up -d --remove-orphans

# 4. Ждём healthcheck бэкенда (он поднимает все Telegram-аккаунты, до двух минут).
if wait_healthy; then
  echo "$TARGET_SHA" > .deployed-sha
  docker image prune -f > /dev/null
  log "готово: ${TARGET_SHA:0:7}"
  exit 0
fi

log "бэкенд не поднялся, последние строки лога:"
docker compose logs --tail=50 backend || true

# 5. Откат кода и образов. Базу не трогаем: миграции идут только вперёд,
#    снимок лежит в $BACKUP_DIR на случай ручного восстановления.
if [ -n "$PREV_SHA" ] && [ "$PREV_SHA" != "$TARGET_SHA" ]; then
  log "откат на ${PREV_SHA:0:7}"
  git checkout --quiet --force "$PREV_SHA"
  docker compose build --quiet
  docker compose up -d --remove-orphans
  if wait_healthy; then
    log "откат прошёл, работает ${PREV_SHA:0:7}"
  else
    log "откат тоже не поднялся, нужны руки"
  fi
fi
exit 1
