// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import OpenerPool, { joinOpeners, splitOpeners } from './OpenerPool';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root, current;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

function Harness({ initial }) {
  const [value, setValue] = useState(initial);
  current = value;
  return <OpenerPool value={value} onChange={setValue} />;
}
const type = (el, text) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(label) || b.getAttribute('aria-label') === label);

test('пул хранится одним текстом через строку «---» и обратно', () => {
  expect(splitOpeners('Привет\n---\nДобрый вечер')).toEqual(['Привет', 'Добрый вечер']);
  expect(splitOpeners('Привет, это {name} с {site}')).toEqual(['Привет, это {name} с {site}']);
  expect(joinOpeners(['a', 'b'])).toBe('a\n---\nb');
  // пустой вариант не пропадает, пока его заполняют
  expect(splitOpeners(joinOpeners(['a', '']))).toEqual(['a', '']);
});

test('добавить, заполнить и удалить вариант', async () => {
  await act(async () => root.render(<Harness initial="Привет, это {name} с {site}" />));
  expect(host.querySelectorAll('textarea')).toHaveLength(1);
  expect(host.textContent).toContain('Один вариант — уходит всем лидам');
  expect(button('Удалить вариант 1')).toBeUndefined();

  await act(async () => button('Добавить вариант').click());
  const fields = host.querySelectorAll('textarea');
  expect(fields).toHaveLength(2);
  await act(async () => type(fields[1], 'Добрый вечер, {name} тут'));
  expect(current).toBe('Привет, это {name} с {site}\n---\nДобрый вечер, {name} тут');
  expect(host.textContent).toContain('2 варианта в пуле — каждому лиду уходит случайный');

  await act(async () => button('Удалить вариант 1').click());
  expect(current).toBe('Добрый вечер, {name} тут');
  expect(host.querySelectorAll('textarea')).toHaveLength(1);
});
