# Персоны в Telegram

Система ведёт переписку в Telegram от лица заданных личностей и панель, из которой
менеджеры за этим следят и вмешиваются. Внутри: бэкенд на NestJS (Telegram через
MTProto, ответы через OpenRouter или Anthropic), панель на React и PostgreSQL.

## Что нужно

Docker с плагином compose. Больше ничего: Node, ffmpeg и Prisma живут внутри образов.
Ресурсы — от 2 ГБ памяти и 10 ГБ диска, плюс место под медиа переписок (у рабочей
установки это основной расход, счёт идёт на гигабайты).

## Установка

```bash
cp .env.example .env
```

Заполните `.env` — что именно значит каждая строка, написано там же рядом с ней.
Обязательный минимум: `POSTGRES_PASSWORD`, `JWT_SECRET`, `ADMIN_PASSWORD`,
`TG_API_ID`, `TG_API_HASH`, `SESSION_ENC_KEY` и ключ хотя бы одного поставщика
моделей.

```bash
docker compose up -d --build
```

Первый запуск сам применяет все миграции и заводит администратора из
`ADMIN_USERNAME` / `ADMIN_PASSWORD`. Панель открывается на `PANEL_PORT` (по
умолчанию 8080); API отвечает на том же адресе, поэтому CORS настраивать не нужно.

Аккаунты Telegram добавляются уже из панели: телефон, код, при необходимости пароль.
Сессии хранятся в базе в зашифрованном виде — ключом `SESSION_ENC_KEY`.

## Где лежат данные

Состояние разнесено по двум отдельным томам, чтобы одно нельзя было потерять
вместе с другим:

| Том | Что внутри | Точка монтирования |
|---|---|---|
| `pgdata` | база PostgreSQL | `/var/lib/postgresql/data` у службы `db` |
| `data` | `media` из переписок, `uploads`, `personas` | `/app/data` у службы `backend` |

Пересборка образов их не трогает, `docker compose down` — тоже. Удалить тома может
только явный `docker compose down -v`.

Для бэкапов и переноса удобнее указать каталоги хоста:

```yaml
  db:
    volumes:
      - /srv/nastya/pgdata:/var/lib/postgresql/data
  backend:
    volumes:
      - /srv/nastya/data:/app/data
```

Если каталог с медиа уже существует и принадлежит другому пользователю, добавьте
службе `backend` его uid: `user: "1000:1000"` — иначе запись в него не пойдёт.

Снимок базы делается штатно, без остановки службы:

```bash
docker compose exec db pg_dump -U nastya nastya | gzip > nastya-$(date +%F).sql.gz
```

## Обновление

```bash
git pull && docker compose up -d --build
```

Миграции применяются при старте контейнера, поэтому отдельного шага для базы нет.
Бэкап перед обновлением — командой `pg_dump` выше.
Бэкенд поднимает все аккаунты Telegram на старте — это занимает до двух минут,
`healthcheck` это учитывает.

## За обратным прокси

Панель в контейнере слушает HTTP. Сертификаты и домен оставьте на внешнем nginx и
проксируйте всё на `PANEL_PORT`. Одному маршруту нужен `Upgrade` — по нему идут
звонки:

```nginx
location = /api/voicer/call/ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 75s;
}
```

И укажите внешний адрес в `VOICER_PANEL_URL`: по нему бот собирает ссылки на задания.

## Разработка

```bash
cd backend && npm install && npm run start:dev
cd frontend/manager-frontend && npm install && npm run dev
```

Проверки: `npm run lint`, `npm test` и `npx vitest run` в
`frontend/manager-frontend` работают без базы. Для `npm run test:e2e` нужна
тестовая база — она поднимается отдельным файлом и живёт в памяти контейнера:

```bash
docker compose -f docker-compose.test.yml up -d
cd backend && npm run test:e2e
```

Каждый набор работает в своей схеме и пересоздаёт её на входе, поэтому наборы не
мешают друг другу. Другой адрес базы можно задать переменной `TEST_DATABASE_URL`.
