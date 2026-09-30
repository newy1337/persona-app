import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

// Наборы e2e идут параллельно, поэтому каждый работает в своей схеме одной и той
// же тестовой базы. Схема пересоздаётся на входе — так прогон не зависит от того,
// что осталось после предыдущего.
const BASE =
  process.env.TEST_DATABASE_URL ??
  'postgresql://nastya:nastya@127.0.0.1:5436/nastya_test';

const backend = resolve(__dirname, '..');

/**
 * Готовит чистую схему и направляет в неё DATABASE_URL. Вызывать до импорта
 * модулей приложения: они читают адрес базы при загрузке.
 */
export function useTestDatabase(name: string): void {
  const schema = `test_${name.replace(/[^a-z0-9_]/gi, '_')}`;
  const sql = `DROP SCHEMA IF EXISTS "${schema}" CASCADE; CREATE SCHEMA "${schema}";`;

  process.env.DATABASE_URL = BASE;
  execSync(`npx prisma db execute --url "${BASE}" --stdin`, {
    cwd: backend,
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  process.env.DATABASE_URL = `${BASE}${BASE.includes('?') ? '&' : '?'}schema=${schema}`;
  execSync('npx prisma migrate deploy', {
    cwd: backend,
    stdio: 'pipe',
    env: process.env,
  });
}
