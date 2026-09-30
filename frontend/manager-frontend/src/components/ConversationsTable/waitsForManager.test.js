import { describe, expect, it } from 'vitest';
import { newLabel, waitsForManager } from './ConversationsTable';

describe('новые на ручном режиме', () => {
  it('отмечается только ручной режим с новыми от клиента', () => {
    expect(waitsForManager({ is_paused: true, unread_count: 2 })).toBe(true);
    expect(waitsForManager({ is_paused: true, unread_count: 0 })).toBe(false);
    expect(waitsForManager({ is_paused: false, unread_count: 3 })).toBe(false);
  });

  it('подпись по-русски', () => {
    expect(newLabel(1)).toBe('1 новое');
    expect(newLabel(3)).toBe('3 новых');
    expect(newLabel(11)).toBe('11 новых');
    expect(newLabel(21)).toBe('21 новое');
  });
});
