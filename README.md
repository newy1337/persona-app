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

Порт привязан к `127.0.0.1`: снаружи панель не видна, пока перед ней не встанет
nginx с сертификатом. Это намеренно — в контейнере она слушает обычный HTTP, а
опубликованный наружу порт Docker открывает в обход ufw. Посмотреть до настройки
домена можно через туннель: `ssh -L 8080:127.0.0.1:8080 пользователь@сервер`.

Аккаунты Telegram добавляются уже из панели: телефон, код, при необходимости пароль.
Сессии хранятся в базе в зашифрованном виде — ключом `SESSION_ENC_KEY`.

## Где лежат данные

Состояние лежит в обычных каталогах хоста, а **не** в томах Docker — чтобы его
нельзя было снести вместе с контейнерами командой `docker compose down -v` или
`docker system prune --volumes`. Корень задаётся в `.env` переменной `DATA_ROOT`,
по умолчанию `/srv/persona-data`:

| Каталог | Что внутри | Владелец |
|---|---|---|
| `$DATA_ROOT/pgdata` | база PostgreSQL | `70:70` — postgres в alpine-образе |
| `$DATA_ROOT/app` | `media` из переписок, `uploads`, `personas` | `1000:1000` — node в образе бэкенда |

Каталоги создаются до первого запуска, иначе Docker заведёт их от root и ни одна
из служб не сможет туда писать:

```bash
sudo mkdir -p /srv/persona-data/{pgdata,app}
sudo chown 70:70     /srv/persona-data/pgdata
sudo chown 1000:1000 /srv/persona-data/app
```

Снимок базы делается штатно, без остановки службы:

```bash
docker compose exec db pg_dump -U nastya nastya | gzip > nastya-$(date +%F).sql.gz
```

Файлы переписок просто копируются из `$DATA_ROOT/app`.

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

## Автодеплой

Пайплайн в `.github/workflows/ci.yml` запускается на каждый push и pull request:

| Шаг | Где | Что делает |
|---|---|---|
| `checks` | GitHub | Бэкенд: eslint, unit, сборка, e2e на PostgreSQL. Панель: oxlint, vitest, сборка. Плюс `docker compose build`. |
| `deploy` | runner на сервере | Push в `main` едет на прод (runner с меткой `persona`), push в `dev` — на дев-сервер (метка `persona-dev`). Переключает репозиторий на коммит и запускает `deploy/deploy.sh`. |
| `notify` | GitHub | Пишет итог в Telegram. Без токена шаг молча пропускается. |

`deploy/deploy.sh` делает снимок базы в `backups/`, собирает образы, перезапускает
стек и ждёт `healthcheck` бэкенда. Если бэкенд не поднялся, скрипт откатывает код
и образы на прежний коммит (база остаётся как есть, миграции идут только вперёд).
Запускать его можно и руками с сервера.

### Сервер, один раз

```bash
git clone https://github.com/newy1337/persona-app /srv/persona-app
cd /srv/persona-app && cp .env.example .env   # и заполнить
```

### Runner на сервере

Деплой выполняет self-hosted runner GitHub Actions, который стоит на том же
сервере. В репозитории: Settings → Actions → Runners → New self-hosted runner,
Linux. GitHub покажет команды скачивания и регистрации; при регистрации добавьте
метку `persona` для прода или `persona-dev` для дев-сервера — по ней workflow
выбирает runner:

```bash
./config.sh --url https://github.com/newy1337/persona-app --token <из страницы> --labels persona --unattended
sudo ./svc.sh install && sudo ./svc.sh start
```

Пользователь, от которого работает служба runner'а, должен уметь запускать
docker и писать в каталог установки:

```bash
sudo usermod -aG docker $(whoami)
```

Runner'у ssh не нужен: job просто делает `git checkout` в каталоге установки и
запускает скрипт.

### Настройки репозитория

Settings → Secrets and variables → Actions:

| Тип | Имя | Значение |
|---|---|---|
| Variable | `DEPLOY_PATH` | каталог установки; пусто — `/srv/persona-app` |
| Variable | `PANEL_URL` | ссылка на панель, показывается в карточке окружения `production`; необязательно |
| Secret | `TG_NOTIFY_BOT_TOKEN` | токен бота для уведомлений; необязательно |
| Secret | `TG_NOTIFY_CHAT_ID` | куда писать; необязательно |

Деплой идёт через окружение `production`: в его настройках можно включить ручное
подтверждение перед выкаткой. Runner запускает только `deploy` и только из
`main`, проверки pull request'ов на нём не выполняются.
