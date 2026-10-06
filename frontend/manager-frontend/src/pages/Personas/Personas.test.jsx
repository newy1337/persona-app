// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import Personas from './Personas';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const list = {
  items: [
    { id: 1, name: 'Настя', slug: 'nastya', is_default: true, enabled: true, accounts: 2 },
    { id: 2, name: 'Вика', slug: 'vika', is_default: false, enabled: false, accounts: 0 },
  ],
};
const persona = (id) => ({
  ...list.items[id - 1],
  card_lines: 10, examples: 3, storylines: 2, edited_prompts: 1,
  generator_model: null, judge_model: null,
  sections: { prompts: { opener: 'привет' }, rhythm: {}, persona: { name: 'Настя' }, variables: {} },
});
const defaults = {
  keys: ['opener'],
  labels: { opener: { title: 'Первое сообщение', hint: 'с чего начинает' } },
  defaults: { opener: 'привет' },
};
const versions = { items: [{ id: 71, created_at: 1790000000, saved_by: 'admin', note: 'до правки', bytes: 2048 }] };

let host;
let root;
let get;

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const byLabel = (label) => host.querySelector(`button[aria-label="${label}"]`);

beforeEach(async () => {
  window.localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  get = vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (path === '/api/personas') return list;
    if (path === '/api/personas/prompts/defaults') return defaults;
    if (path === '/api/personas/models/options') return null;
    if (path.includes('/versions')) return versions;
    return persona(Number(path.split('/')[3]));
  });
  await act(async () => root.render(<Personas />));
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('страница личностей', () => {
  it('список слева — простые строки, текущая отмечена aria-current', async () => {
    expect(host.querySelector('h1').textContent).toBe('Личности');
    const rows = [...host.querySelectorAll('nav[aria-label="Личности"] button')];
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual(['true', null]);
    expect(rows[1].textContent).toContain('выключена');

    await act(async () => rows[1].click());
    await flush();
    expect(get).toHaveBeenCalledWith('/api/personas/2');
    expect(rows[1].getAttribute('aria-current')).toBe('true');
    expect(host.querySelector('h2').textContent).toContain('Вика');
  });

  it('действия личности — иконки с подписями, редкие спрятаны в «Ещё»', () => {
    for (const label of ['Переименовать', 'Дублировать', 'Ещё']) expect(byLabel(label)).not.toBeNull();
    const texts = [...host.querySelectorAll('button')].map((b) => b.textContent.trim());
    for (const hidden of ['Выгрузить всё', 'Загрузить всё', 'Удалить']) expect(texts).not.toContain(hidden);
  });

  it('вкладки секций — список вкладок, выбранная одна', () => {
    const tabs = [...host.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Промпты', 'Ритм', 'Карточка', 'Цели', 'Сюжеты', 'День', 'Биты', 'Переменные']);
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent)).toEqual(['Промпты']);
  });

  it('история версий раскрывается и сворачивается одной кнопкой, «Вернуть» восстанавливает версию', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({});
    vi.spyOn(PanelUX, 'confirm').mockResolvedValue(true);
    expect(host.querySelector('ul[aria-label="История версий"]')).toBeNull();

    await act(async () => byLabel('История версий').click());
    await flush();
    const rows = host.querySelector('ul[aria-label="История версий"]');
    expect(rows.textContent).toContain('admin');
    expect(rows.textContent).toContain('до правки');
    expect(rows.textContent).toContain('2.0 КБ');
    expect(byLabel('Скрыть историю').getAttribute('aria-pressed')).toBe('true');

    await act(async () => rows.querySelector('button[aria-label="Вернуть"]').click());
    await flush();
    expect(post.mock.calls.some(([path]) => path.includes('/versions/71'))).toBe(true);
    expect(host.querySelector('ul[aria-label="История версий"]')).toBeNull();
    expect(byLabel('История версий').getAttribute('aria-pressed')).toBe('false');
  });

  it('«Отменить правки» и сохранение включаются только когда есть правка', async () => {
    const save = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Сохранить промпты');
    expect(save.disabled).toBe(true);
    expect(byLabel('Отменить правки').disabled).toBe(true);
    expect(byLabel('Текст из кода').disabled).toBe(true);

    const area = host.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, 'здравствуй');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(save.disabled).toBe(false);
    expect(byLabel('Текст из кода').disabled).toBe(false);

    await act(async () => byLabel('Отменить правки').click());
    expect(host.querySelector('textarea').value).toBe('привет');
    expect(save.disabled).toBe(true);
  });

  it('«Новая личность» открывает окно с формой', async () => {
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Новая личность').click());
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('Новая личность');
    expect([...dialog.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Отмена', 'Создать']);
  });
});
