import { oldestPerChat } from './relay.worker';

const row = (id: number, chatId: number) => ({ id, chatId: BigInt(chatId) });

describe('повторная пауза по застрявшим ручным сообщениям', () => {
  it('на диалог берётся одна строка — самая старая', () => {
    const picked = oldestPerChat([row(4298, 10), row(4242, 10), row(77, 20)]);
    expect(picked.map((r) => r.id).sort((a, b) => a - b)).toEqual([77, 4242]);
  });

  it('порядок на входе не влияет на выбор', () => {
    const forward = oldestPerChat([row(1, 5), row(2, 5), row(3, 5)]);
    const backward = oldestPerChat([row(3, 5), row(2, 5), row(1, 5)]);
    expect(forward.map((r) => r.id)).toEqual([1]);
    expect(backward.map((r) => r.id)).toEqual([1]);
  });

  it('разные диалоги не схлопываются', () => {
    expect(oldestPerChat([row(1, 10), row(2, 20), row(3, 30)])).toHaveLength(3);
  });

  it('пустой список остаётся пустым', () => {
    expect(oldestPerChat([])).toEqual([]);
  });

  it('текст причины перестаёт скакать между тиками', () => {
    // Тик берёт одни и те же строки, пока менеджер их не разобрал.
    const rows = [row(4298, 10), row(4242, 10)];
    const first = oldestPerChat(rows)[0].id;
    const second = oldestPerChat([...rows].reverse())[0].id;
    expect(first).toBe(second);
  });
});
