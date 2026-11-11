// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import SeriesPanel, { seriesHint } from './SeriesPanel';
import PhotoCard from './PhotoCard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const render = async (el) => act(async () => root.render(el));
const type = async (input, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

const trip = { id: 3, title: 'Путешествие', description: '', place: null, taken_on: null, auto_send: true, photos: 4 };

test('подсказка говорит, уйдёт ли серия альбомом', () => {
  expect(seriesHint(trip)).toBe('бот может отправить альбомом');
  expect(seriesHint({ ...trip, photos: 1 })).toBe('добавьте ещё 1 фото');
  expect(seriesHint({ ...trip, photos: 14 })).toBe('бот отправит первые 10');
  expect(seriesHint({ ...trip, auto_send: false })).toBe('только вручную');
  expect(seriesHint({ ...trip, photos: 5, ready: 1 })).toBe('боту можно отправлять только 1 из 5 фото — нужно хотя бы 2');
});

test('серию создают по названию, клик по серии фильтрует снимки', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ ...trip, id: 4, title: 'Новый год', photos: 0 });
  const onChange = vi.fn();
  const onChanged = vi.fn();
  await render(<SeriesPanel setId={1} series={[trip]} canEdit value={null} onChange={onChange} onChanged={onChanged} />);

  const chip = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Путешествие · 4');
  await act(async () => chip.click());
  expect(onChange).toHaveBeenCalledWith(3);

  await type(host.querySelector('[aria-label="Название новой серии"]'), 'Новый год');
  await act(async () => host.querySelector('[aria-label="Серии образа"] form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(post).toHaveBeenCalledWith('/api/photo-sets/1/series', { title: 'Новый год' });
  expect(onChanged).toHaveBeenCalled();
  // Сразу открывается карточка новой серии — описать, о чём она.
  expect(host.querySelector('[aria-label="Серия"]')).not.toBeNull();
});

test('без прав и без серий блока нет; на снимке — метка серии', async () => {
  await render(<SeriesPanel setId={1} series={[]} canEdit={false} value={null} onChange={() => {}} onChanged={() => {}} />);
  expect(host.querySelector('[data-testid="photo-series"]')).toBeNull();
  await render(<PhotoCard photo={{ id: 9, description: 'горы', tags: [], reviewed: true, auto_send: true, series_title: 'Путешествие' }} />);
  expect(host.querySelector('[data-testid="series-badge"]').textContent).toBe('Серия: Путешествие');
});
