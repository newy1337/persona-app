// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import StagesTable from './StagesTable';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('таблица этапов по дням', () => {
  it('показывает дни, итог и «сейчас»', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StagesTable
          data={{
            stages: [{ id: 'soglas', label: 'Соглас' }, { id: 'lead', label: 'Лид' }],
            days: [{ day: '2026-10-05', counts: { soglas: 4, lead: 1 } }],
            totals: { soglas: 4, lead: 1 },
            reached: { soglas: 3, lead: 1 },
          }}
        />,
      );
    });
    const text = container.textContent;
    expect(text).toContain('05.10');
    expect(text).toContain('Соглас');
    expect(text).toContain('За период');
    expect(text).toContain('Всего');
    expect(container.querySelectorAll('tbody tr').length).toBe(1);
    root.unmount();
    container.remove();
  });
});
