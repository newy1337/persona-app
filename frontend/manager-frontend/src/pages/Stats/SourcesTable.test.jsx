// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SourcesByRegion } from './SourcesTable';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const data = {
  statuses: ['pending', 'queued', 'assigned', 'contacted', 'replied', 'dead'],
  stages: [{ id: 'vbros', label: 'Вброс' }],
  total: { leads: 5, by_source: { base: 3, hot_leadgen: 2 }, statuses: { contacted: 3, replied: 2 }, stages: { vbros: 1 } },
  regions: [
    { region: '0737', leads: 3, by_source: { base: 3 }, statuses: { contacted: 2, replied: 1 }, stages: { vbros: 1 } },
    { region: '—', leads: 2, by_source: { hot_leadgen: 2 }, statuses: { contacted: 1, replied: 1 }, stages: {} },
  ],
};

test('админ: регионы с итогом, разбивка по источникам и фильтр', async () => {
  const onSource = vi.fn();
  await act(async () => root.render(<SourcesByRegion data={data} source="" onSource={onSource} />));
  const head = [...host.querySelectorAll('thead th')].map((th) => th.textContent);
  expect(head).toEqual(['Регион', 'Лидов', 'Базовик', 'Горячий лидген', 'Холодный лидген', 'Не отмечен', 'Написали', 'Ответил', 'Недоступен', 'Вброс']);
  const rows = [...host.querySelectorAll('tbody tr')].map((r) => r.firstChild.textContent);
  expect(rows).toEqual(['Регион 0737', 'Без региона', 'Итого']);
  const select = host.querySelector('select[aria-label="Источник трафика"]');
  await act(async () => { select.value = 'base'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(onSource).toHaveBeenCalledWith('base');
  await act(async () => root.render(<SourcesByRegion data={data} source="base" onSource={onSource} />));
  expect([...host.querySelectorAll('thead th')].map((th) => th.textContent)).not.toContain('Базовик');
});
