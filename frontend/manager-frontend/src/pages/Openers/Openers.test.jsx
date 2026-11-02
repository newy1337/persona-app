// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const api = vi.hoisted(() => ({ data: null, puts: [] }));
vi.mock('../../api/openers', () => ({
  getRegionOpeners: vi.fn(async () => api.data),
  putRegionOpener: vi.fn(async (region, slug, text) => { api.puts.push([region, slug, text]); return { region, slug, text }; }),
}));
vi.mock('../../components/AppLayout/me', () => ({ useMe: () => ({ role: 'head', region_code: '737' }) }));
const { default: Openers } = await import('./Openers');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); api.puts = [];
  api.data = {
    region: '737', regions: [], can_manage: true,
    items: [
      { slug: 'nastya', name: 'Настя', default_text: 'Привет, это {name} с {site}\n---\nПриветик от {name}', text: '', updated_at: null },
      { slug: 'denis', name: 'Денис', default_text: 'Привет, это {name}', text: 'Здорово, это {name} с {site}', updated_at: 1 },
    ],
  };
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const type = (el, text) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const within = (slug) => host.querySelector(`[data-testid="openers-${slug}"]`);
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

test('хед видит свой регион, общий пул личности и свой пул; сохраняет вариант для региона', async () => {
  await act(async () => root.render(<Openers />));
  expect(host.textContent).toContain('регион 737');
  const nastya = within('nastya');
  expect(nastya.textContent).toContain('уходит общий пул личности (2 варианта)');
  expect(nastya.textContent).not.toContain('свой пул региона');
  await act(async () => button(nastya, 'показать').click());
  expect(nastya.textContent).toContain('Приветик от {name}');

  const denis = within('denis');
  expect(denis.textContent).toContain('свой пул региона');
  expect(button(denis, 'Вернуться к общему пулу')).toBeTruthy();

  expect(button(nastya, 'Сохранить').disabled).toBe(true);
  await act(async () => type(nastya.querySelector('textarea'), 'Хей, это {name} из 737'));
  expect(button(nastya, 'Сохранить').disabled).toBe(false);
  await act(async () => button(nastya, 'Сохранить').click());
  expect(api.puts).toEqual([['737', 'nastya', 'Хей, это {name} из 737']]);

  await act(async () => button(denis, 'Вернуться к общему пулу').click());
  expect(api.puts.at(-1)).toEqual(['737', 'denis', '']);
});
