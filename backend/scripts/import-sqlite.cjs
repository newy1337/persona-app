/**
 * Перенос данных из SQLite прежней установки в PostgreSQL этой.
 *
 *   node --experimental-sqlite scripts/import-sqlite.cjs /app/data/import/app.sqlite3
 *
 * Список таблиц и типы берутся из схемы Prisma, а не прописаны руками: схема
 * меняется — скрипт идёт за ней. Таблицы, которых в новой схеме нет, молча
 * пропускаются; целевая база должна быть пустой.
 */
const { DatabaseSync } = require('node:sqlite');
const { PrismaClient, Prisma } = require('@prisma/client');

const source = process.argv[2];
if (!source) {
  console.error('укажите путь к файлу SQLite');
  process.exit(1);
}

// Пути к файлам хранятся абсолютными: прежде корень данных лежал в каталоге
// установки, теперь это том контейнера.
const OLD_DATA_ROOT = process.env.OLD_DATA_ROOT ?? '/opt/nastya/backend/data';
const NEW_DATA_ROOT = process.env.DATA_DIR ?? '/app/data';

// Оболочки вроде Git Bash подменяют пути в переменных окружения: один такой
// прогон молча записал бы «C:/Program Files/Git/app/data» во все записи.
for (const [name, value] of [['OLD_DATA_ROOT', OLD_DATA_ROOT], ['DATA_DIR', NEW_DATA_ROOT]]) {
  if (!/^\/[^\:]*$/.test(value)) {
    console.error(`${name} должен быть обычным абсолютным путём, а получен «${value}»`);
    process.exit(1);
  }
}

// Postgres принимает не больше 65535 параметров на запрос; пачку подбираем так,
// чтобы в неё уложиться при любой ширине таблицы.
const MAX_PARAMS = 50000;

const models = Prisma.dmmf.datamodel.models;
const byName = new Map(models.map((m) => [m.name, m]));

/** Родители раньше детей: внешние ключи в Postgres проверяются сразу. */
function ordered() {
  const done = new Set();
  const out = [];
  const visit = (model, trail) => {
    if (done.has(model.name)) return;
    if (trail.has(model.name)) return; // цикл между моделями — порядок внутри него не важен
    trail.add(model.name);
    for (const field of model.fields) {
      if (!field.relationName || !field.relationFromFields?.length) continue;
      const parent = byName.get(field.type);
      if (parent) visit(parent, trail);
    }
    trail.delete(model.name);
    done.add(model.name);
    out.push(model);
  };
  for (const model of models) visit(model, new Set());
  return out;
}

const scalars = (model) =>
  model.fields.filter((f) => !f.relationName && f.kind !== 'object');

function convert(field, value) {
  if (value === null || value === undefined) return null;
  switch (field.type) {
    case 'BigInt':
      return typeof value === 'bigint' ? value : BigInt(value);
    case 'Boolean':
      // В SQLite это 0 и 1.
      return value === 1 || value === true || value === '1';
    case 'Int':
      return typeof value === 'bigint' ? Number(value) : value;
    case 'Float':
      return Number(value);
    case 'String': {
      const text = String(value);
      return text.startsWith(OLD_DATA_ROOT)
        ? NEW_DATA_ROOT + text.slice(OLD_DATA_ROOT.length)
        : text;
    }
    default:
      return value;
  }
}

(async () => {
  const db = new DatabaseSync(source, { readOnly: true });
  const prisma = new PrismaClient();
  const started = Date.now();

  const existing = new Set(
    db
      .prepare("select name from sqlite_master where type='table'")
      .all()
      .map((r) => r.name),
  );

  const report = [];
  let paths = 0;

  for (const model of ordered()) {
    const table = model.dbName ?? model.name;
    if (!existing.has(table)) {
      report.push([table, 0, 0, 'нет в источнике']);
      continue;
    }
    const fields = scalars(model);
    const columns = fields.map((f) => f.dbName ?? f.name);
    const rows = db.prepare(`select * from "${table}"`).all();
    if (!rows.length) {
      report.push([table, 0, 0, 'пусто']);
      continue;
    }

    const data = rows.map((row) => {
      const out = {};
      fields.forEach((field, i) => {
        const raw = row[columns[i]];
        if (raw === undefined) return;
        const value = convert(field, raw);
        if (
          field.type === 'String' &&
          typeof raw === 'string' &&
          raw.startsWith(OLD_DATA_ROOT)
        )
          paths += 1;
        out[field.name] = value;
      });
      return out;
    });

    const size = Math.max(1, Math.floor(MAX_PARAMS / Math.max(1, fields.length)));
    let written = 0;
    for (let at = 0; at < data.length; at += size) {
      const chunk = data.slice(at, at + size);
      const { count } = await prisma[lower(model.name)].createMany({
        data: chunk,
        skipDuplicates: true,
      });
      written += count;
    }
    report.push([table, rows.length, written, written === rows.length ? 'ок' : 'РАСХОЖДЕНИЕ']);
    process.stdout.write(`${table}: ${written}/${rows.length}\n`);
  }

  // Счётчики автоинкремента остаются на нуле после явной вставки id: без этого
  // первая же новая строка упадёт на нарушении уникальности.
  let sequences = 0;
  for (const model of models) {
    const table = model.dbName ?? model.name;
    const id = model.fields.find(
      (f) => f.isId && f.type === 'Int' && f.default?.name === 'autoincrement',
    );
    if (!id) continue;
    const column = id.dbName ?? id.name;
    await prisma.$executeRawUnsafe(
      `select setval(pg_get_serial_sequence('"${table}"', '${column}'),
         coalesce((select max("${column}") from "${table}"), 1), true)`,
    );
    sequences += 1;
  }

  console.log('\nтаблица | прочитано | записано | итог');
  for (const [t, read, written, note] of report) {
    if (read || note === 'РАСХОЖДЕНИЕ') console.log(`${t} | ${read} | ${written} | ${note}`);
  }
  const bad = report.filter((r) => r[3] === 'РАСХОЖДЕНИЕ');
  console.log(`\nпутей к файлам переписано: ${paths}`);
  console.log(`счётчиков выставлено: ${sequences}`);
  console.log(`время: ${Math.round((Date.now() - started) / 1000)} с`);
  console.log(bad.length ? `РАСХОЖДЕНИЙ: ${bad.length}` : 'все таблицы перенесены полностью');

  db.close();
  await prisma.$disconnect();
  process.exit(bad.length ? 1 : 0);
})();

function lower(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}
