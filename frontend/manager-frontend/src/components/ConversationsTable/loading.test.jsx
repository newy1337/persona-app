// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import ConversationsTable from './ConversationsTable';

let host;
let root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const draw = async (props) =>
  act(async () => root.render(<ConversationsTable {...props} />));

describe('состояние загрузки списка диалогов', () => {
  it('пока данные не пришли — заглушка, а не «диалогов нет»', async () => {
    await draw({ ready: false, rows: [] });
    expect(host.textContent).toContain('Загружаем диалоги…');
    expect(host.textContent).not.toContain('Диалогов нет');
  });

  it('заглушка держит высоту: рисуется несколько строк', async () => {
    await draw({ ready: false, rows: [] });
    expect(host.querySelectorAll('[role="status"] > div').length).toBeGreaterThanOrEqual(6);
  });

  it('когда загрузка кончилась и пусто — честное пустое состояние', async () => {
    await draw({ ready: true, rows: [] });
    expect(host.textContent).toContain('Диалогов нет');
    expect(host.textContent).not.toContain('Загружаем диалоги…');
  });

  it('обновление поверх уже показанных строк не прячет их', async () => {
    const rows = [{ chat_id: 1, id: 1, name: 'Клиент', last_message_ts: 100, stage: null }];
    await draw({ ready: false, rows });
    expect(host.textContent).toContain('Клиент');
    expect(host.textContent).not.toContain('Загружаем диалоги…');
  });
});
