// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { api } from '../../api/client';
import QuickReplies from './QuickReplies';
import Audit, { actionLabel } from '../Audit/Audit';
import { QuickReplyPicker } from '../../components/QuickReplyPicker/QuickReplyPicker';
import { fillTemplate } from '../../api/quickReplies';

let host, root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
const type = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

describe('шаблоны ответов', () => {
  it('страница: добавить, заполнить и сохранить; пустые поля не сохраняются', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ items: [] });
    const put = vi.spyOn(api, 'put').mockImplementation(async (_, body) => body);
    await act(async () => root.render(<MemoryRouter><QuickReplies /></MemoryRouter>));
    await flush();
    expect(host.textContent).toContain('Шаблонов пока нет');
    await act(async () => button('Добавить шаблон').click());
    expect(button('Сохранить шаблоны').disabled).toBe(true);
    await act(async () => type(host.querySelector('input[aria-label="Название шаблона 1"]'), 'Привет'));
    await act(async () => type(host.querySelector('textarea[aria-label="Текст шаблона 1"]'), 'Привет, {name}!'));
    await act(async () => button('Сохранить шаблоны').click());
    await flush();
    expect(put).toHaveBeenCalledWith('/api/quick-replies', { items: [{ title: 'Привет', text: 'Привет, {name}!' }] });
  });

  it('в поле ответа: выбор шаблона подставляет имя собеседника', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ items: [{ title: 'Привет', text: 'Привет, {name}!' }] });
    const onPick = vi.fn();
    await act(async () => root.render(<QuickReplyPicker name="Ира" onPick={onPick} />));
    await act(async () => host.querySelector('button[aria-label="Шаблоны ответов"]').click());
    await flush();
    const list = document.querySelector('[data-testid="quick-replies"]');
    expect(list.textContent).toContain('Привет, Ира!');
    await act(async () => [...list.querySelectorAll('button')].find((b) => b.textContent.startsWith('Привет')).click());
    expect(onPick).toHaveBeenCalledWith('Привет, Ира!');
    expect(fillTemplate('Привет, {name}!', {})).toBe('Привет, !');
  });
});

describe('журнал действий', () => {
  it('строки по-русски, ошибка подсвечена, строка раскрывается подробностями', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      items: [
        { id: 2, ts: 1790000000, user_id: 1, username: 'admin', action: 'conversation.deal_stage', resource: 'chat:42', payload: '{"stage":"lead"}', result: 'success', error: null },
        { id: 1, ts: 1789990000, user_id: 1, username: 'admin', action: 'lead.delete', resource: 'lead:7', payload: null, result: 'failure', error: 'нет такого лида' },
      ],
      more: false,
      users: [{ id: 1, username: 'admin', role: 'admin' }],
    });
    await act(async () => root.render(<MemoryRouter><Audit /></MemoryRouter>));
    await flush();
    const rows = [...host.querySelectorAll('tr[data-audit-id]')];
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Сменил этап сделки'), expect.stringContaining('Удалил лида')]);
    expect(rows[1].textContent).toContain('ошибка');
    await act(async () => rows[0].click());
    expect(host.querySelector('[data-testid="audit-details"]').textContent).toContain('"stage": "lead"');
    expect(actionLabel('something.new')).toBe('something.new');
  });
});
