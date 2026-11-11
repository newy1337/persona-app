import { TelegramBotError, VoicerBotService } from './voicer-bot.service';

interface Task {
  id: number;
  voicerId: number;
  status: string;
  kind: string;
  priority: number;
  notifyVersion: number;
  notifiedVersion: number;
  notifyAfter: number;
  notifyError: string | null;
}

const FIELD = { name: 'notifyVersion' };

/** Ровно те условия, что задаёт notifyPending. */
function matches(t: Task, where: any): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries<any>(where)) {
    if (key === 'AND') {
      if (!cond.every((w: any) => matches(t, w))) return false;
    } else if (key === 'OR') {
      if (!cond.some((w: any) => matches(t, w))) return false;
    } else if (key === 'voicer') {
      continue;
    } else if (cond && typeof cond === 'object') {
      const value = (t as any)[key];
      if ('lt' in cond) {
        const limit = cond.lt === FIELD ? t.notifyVersion : cond.lt;
        if (!(value < limit)) return false;
      }
      if ('lte' in cond && !(value <= cond.lte)) return false;
      if ('in' in cond && !cond.in.includes(value)) return false;
    } else if ((t as any)[key] !== cond) return false;
  }
  return true;
}

function fakePrisma(tasks: Task[]) {
  return {
    voiceTask: {
      fields: { notifyVersion: FIELD },
      findMany: async ({ where, take }: any) =>
        tasks
          .filter((t) => matches(t, where))
          .sort((a, b) => b.priority - a.priority || a.id - b.id)
          .slice(0, take)
          .map((t) => ({
            ...t,
            voicer: { voiceProfile: { telegramId: BigInt(t.voicerId) } },
          })),
      updateMany: async ({ where, data }: any) => {
        const hit = tasks.filter((t) => matches(t, where));
        hit.forEach((t) => Object.assign(t, data));
        return { count: hit.length };
      },
      update: async ({ where, data }: any) =>
        Object.assign(
          tasks.find((t) => t.id === where.id)!,
          data,
        ),
    },
  };
}

const task = (
  id: number,
  voicerId: number,
  extra: Partial<Task> = {},
): Task => ({
  id,
  voicerId,
  status: 'queued',
  kind: 'voice',
  priority: 0,
  notifyVersion: 1,
  notifiedVersion: 0,
  notifyAfter: 0,
  notifyError: null,
  ...extra,
});

describe('уведомления войсерам', () => {
  const now = 1_000_000;

  function service(tasks: Task[], blocked: number[]) {
    const svc = new VoicerBotService(
      fakePrisma(tasks) as any,
      { ts: () => now } as any,
      {} as any,
      {} as any,
    );
    const sent: number[] = [];
    svc.deliver = (async (t: Task, chatId: bigint) => {
      if (blocked.includes(Number(chatId))) throw new TelegramBotError(403);
      sent.push(t.id);
    }) as any;
    return { svc, sent };
  }

  it('войсер, заблокировавший бота, не держит очередь остальных', async () => {
    // У заблокировавшего — 20 старых заданий впереди очереди.
    const tasks = [
      ...Array.from({ length: 20 }, (_, i) => task(i + 1, 7)),
      task(100, 8),
    ];
    const { svc, sent } = service(tasks, [7]);
    await svc.notifyPending();
    await svc.notifyPending();
    expect(sent).toEqual([100]);
    const his = tasks.filter((t) => t.voicerId === 7);
    expect(his.every((t) => t.notifyAfter === now + 3600)).toBe(true);
    expect(his[19].notifyError).toContain('заблокирован');
  });

  it('отмену задания, о котором войсер не знал, не шлём', async () => {
    const tasks = [
      task(1, 8, { status: 'cancelled', notifyVersion: 2 }),
      task(2, 8, { status: 'cancelled', notifyVersion: 2, notifiedVersion: 1 }),
      task(3, 8),
    ];
    const { svc, sent } = service(tasks, []);
    await svc.notifyPending();
    expect(sent).toEqual([2, 3]);
    expect(tasks[0].notifiedVersion).toBe(2);
  });
});
