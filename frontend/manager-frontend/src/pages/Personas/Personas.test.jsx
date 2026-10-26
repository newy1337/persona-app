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
  sections: { prompts: { opener: 'привет' }, rhythm: {}, persona: { name: 'Настя', _name: 'как зовут в переписке' }, variables: {} },
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
const byLabel = (label) => host.querySelector(`[aria-label="${label}"]`);

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

describe('страница личностей без описаний полей', () => {
  const openTab = async (name) => {
    const tab = [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name);
    await act(async () => {
      tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });
    await flush();
  };
  const tooltip = () => document.querySelector('[role="tooltip"]');

  it('под заголовком страницы и под полями нет строк с описанием', () => {
    expect(host.querySelector('h1').parentElement.querySelector('p')).toBeNull();
    expect(host.querySelector('[data-slot="field-message"]')).toBeNull();
    expect(host.textContent).not.toContain('с чего начинает');
    expect(host.textContent).not.toContain('Правка действует');
  });

  it('пояснение к промпту открывается значком «?» рядом с названием', async () => {
    const help = byLabel('Пояснение: Первое сообщение');
    expect(help).not.toBeNull();
    expect(byLabel('Пояснение: Промпты')).not.toBeNull();
    expect(tooltip()).toBeNull();

    await act(async () => help.focus());
    expect(tooltip().textContent).toContain('с чего начинает');
  });

  it('ритм: карточки с выключателями, поля внутри предложений, «от» больше «до» подсвечено', async () => {
    await openTab('Ритм');
    const cards = [...host.querySelectorAll('[data-rhythm-card]')].map((c) => c.dataset.rhythmCard);
    expect(cards).toEqual(['Скорость ответа', 'После молчания', '«Печатает…»', 'Утро и прощание', 'Старые сообщения', 'Сама пишет первой']);
    expect(host.querySelector('[data-testid="rhythm-phases"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="rhythm-day"]')).not.toBeNull();
    for (const name of ['Ритм', 'Скорость ответа', 'После молчания', 'Утро и прощание']) {
      expect(byLabel(`Пояснение: ${name}`)).not.toBeNull();
    }
    // Поле — с понятным именем, подпись — частью предложения.
    const warm = byLabel('Разогрев, мин');
    expect(warm.tagName).toBe('INPUT');
    expect(warm.closest('p').textContent).toContain('мин от его первого сообщения');

    // «от» больше «до» — оба поля помечены, рядом пояснение.
    const type = (el, value) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const lo = byLabel('Дальше: от');
    await type(byLabel('Дальше: до'), '20');
    expect(lo.getAttribute('aria-invalid')).toBeNull();
    await type(lo, '30');
    expect(lo.getAttribute('aria-invalid')).toBe('true');
    expect(byLabel('Дальше: до').getAttribute('aria-invalid')).toBe('true');
    expect(lo.closest('p').textContent).toContain('«от» больше «до»');

    // Выключатель карточки приглушает её и выключает поля.
    const card = host.querySelector('[data-rhythm-card="После молчания"]');
    await act(async () => card.querySelector('button[role="switch"]').click());
    expect(card.querySelector('fieldset').disabled).toBe(true);
    expect(card.textContent).toContain('выключено');
  });

  it('карточка: заметка автора к полю — за значком, ключ документа — в title подписи', async () => {
    await openTab('Карточка');
    const name = host.querySelector('span[title="name"]');
    expect(name.textContent).toBe('Имя');
    expect(name.parentElement.textContent).toBe('Имя');

    await act(async () => byLabel('Пояснение: Имя').focus());
    expect(tooltip().textContent).toContain('как зовут в переписке');
  });
});
