// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
const { page } = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock('../../api/conversations', () => ({ getConversationPage: page, downloadChats: vi.fn() }));

import ConversationsTable from './ConversationsTable';
import { fakeConversationPage } from '../../test/fakeConversationPage';

let host;
let root;

beforeEach(() => {
  sessionStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

const draw = async (props = {}) =>
  act(async () => root.render(<ConversationsTable {...props} />));

describe('состояние загрузки списка диалогов', () => {
  it('пока данные не пришли — заглушка, а не «диалогов нет»', async () => {
    page.mockReturnValue(new Promise(() => {}));
    await draw();
    expect(host.textContent).toContain('Загружаем диалоги…');
    expect(host.textContent).not.toContain('Диалогов нет');
  });

  it('заглушка держит высоту: рисуется несколько строк', async () => {
    page.mockReturnValue(new Promise(() => {}));
    await draw();
    expect(host.querySelectorAll('[role="status"] > div').length).toBeGreaterThanOrEqual(6);
  });

  it('когда загрузка кончилась и пусто — честное пустое состояние', async () => {
    page.mockImplementation(fakeConversationPage([]));
    await draw();
    expect(host.textContent).toContain('Диалогов нет');
    expect(host.textContent).not.toContain('Загружаем диалоги…');
  });

  it('обновление поверх уже показанных строк не прячет их', async () => {
    page.mockImplementation(fakeConversationPage([{ chat_id: 1, id: 1, name: 'Клиент', last_message_ts: 100, stage: null }]));
    await draw({ reloadKey: 1 });
    expect(host.textContent).toContain('Клиент');
    page.mockReturnValue(new Promise(() => {}));
    await draw({ reloadKey: 2 });
    expect(host.textContent).toContain('Клиент');
    expect(host.textContent).not.toContain('Загружаем диалоги…');
  });

  it('ошибка сервера видна, а не выглядит пустым списком', async () => {
    page.mockRejectedValue(new Error('сервер недоступен'));
    await draw();
    expect(host.querySelector('[role="alert"]').textContent).toContain('сервер недоступен');
  });
});
