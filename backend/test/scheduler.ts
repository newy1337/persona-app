import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

/**
 * Фоновые задания по расписанию (ответы бота, бот войсера, доставка, очередь
 * ручных сообщений — каждые 5 секунд) в тестах не нужны: тесты вызывают их
 * сами, когда надо. Оставленные включёнными, они в случайный момент меняют
 * данные посреди теста — набор падал то тут, то там с 404 и чужим состоянием.
 */
export function stopSchedules(app: INestApplication): void {
  const registry = app.get(SchedulerRegistry);
  for (const job of registry.getCronJobs().values()) void job.stop();
  for (const name of registry.getIntervals()) registry.deleteInterval(name);
  for (const name of registry.getTimeouts()) registry.deleteTimeout(name);
}
