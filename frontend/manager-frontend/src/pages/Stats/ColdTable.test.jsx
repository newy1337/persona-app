// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import ColdTable from './ColdTable';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mount(data) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<ColdTable data={data} />));
  return { container, done: () => { root.unmount(); container.remove(); } };
}

describe('вкладка «Холодка»', () => {
  it('сначала итог с долями, потом строки менеджеров и «Всего»', async () => {
    const { container, done } = await mount({
      active_after: 5,
      totals: { received: 10, written: 8, replied: 4, active: 1 },
      by_manager: [
        { user_id: 1, username: 'anna', role: 'manager', region_code: '001', received: 6, written: 5, replied: 3, active: 1 },
        { user_id: 2, username: 'boris', role: 'head', region_code: null, received: 4, written: 3, replied: 1, active: 0 },
      ],
    });
    const kpis = container.querySelector('[data-testid="cold-kpis"]').textContent;
    expect(kpis).toContain('Получено лидов10');
    expect(kpis).toContain('80% от полученных');
    expect(kpis).toContain('50% от написанных');
    expect(kpis).toContain('25% от ответивших');
    const rows = [...container.querySelectorAll('tbody tr')].map((r) => r.textContent);
    expect(rows[0]).toContain('anna · менеджер · регион 001');
    expect(rows[1]).toContain('boris · хед');
    expect(container.querySelector('tfoot').textContent).toContain('Всего');
    expect(container.textContent).toContain('больше 5 его сообщений');
    done();
  });

  it('пустой период — нули без деления на ноль и строка «не было»', async () => {
    const { container, done } = await mount({
      active_after: 5,
      totals: { received: 0, written: 0, replied: 0, active: 0 },
      by_manager: [],
    });
    expect(container.textContent).toContain('За период холодных лидов не было');
    expect(container.textContent).not.toContain('NaN');
    expect(container.querySelector('tfoot')).toBeNull();
    done();
  });
});
