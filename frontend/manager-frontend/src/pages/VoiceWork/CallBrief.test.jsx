// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import { CallBrief } from './CallBrief';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root, data;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  data = { persona: { name: 'Настя', sections: [{ title: 'Главное', items: ['Живёт на Пхукете'] }] },
    interlocutor: { label: 'Дима', linked: true, fields: [{ label: 'Имя', value: 'Дима' }], preferences: [{ text: 'Любит горы' }], facts: [], context: [], agreements: [] }, recent: [] };
  vi.spyOn(api, 'get').mockImplementation(async () => data);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
test('keeps personality and caller facts separate and refreshes during the call', async () => {
  vi.useFakeTimers();
  await act(async () => root.render(<CallBrief task={{ id: 42, chatId: '444' }} />));
  expect(host.textContent).toContain('Личность · Настя'); expect(host.textContent).toContain('Собеседник · Дима');
  expect(host.textContent).toContain('Любит горы');
  data = { ...data, interlocutor: { ...data.interlocutor, preferences: [{ text: 'Предпочитает море' }] } };
  await act(async () => vi.advanceTimersByTime(15000));
  expect(host.textContent).toContain('Предпочитает море'); expect(host.textContent).not.toContain('Любит горы');
  api.get.mockRejectedValue(Object.assign(Error('Доступ закрыт'), { status: 404 }));
  await act(async () => vi.advanceTimersByTime(15000));
  expect(host.textContent).not.toContain('Предпочитает море'); expect(host.querySelector('[role=alert]')).not.toBeNull();
});
