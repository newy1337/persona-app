// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

const { navigateMock, getBeatsMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  getBeatsMock: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const React = await import('react');
  return {
    useParams: () => ({ id: '111' }),
    useNavigate: () => navigateMock,
    Link: (props) => React.createElement('a', { to: props.to, className: props.className }, props.children),
    NavLink: (props) =>
      React.createElement('a', { to: props.to, className: typeof props.className === 'function' ? props.className({ isActive: false }) : props.className }, props.children),
  };
});

vi.mock('../../api/conversations', () => ({
  sendAttachment: vi.fn(async () => ({ ok: true })),
  sendReaction: vi.fn(async () => ({ ok: true })),
  uploadFile: vi.fn(async (_id, file) => ({ path: `/tmp/${file?.name ?? 'x'}`, kind: file?.name?.endsWith('.pdf') ? 'document' : 'photo', bytes: 1 })),
  sendAlbum: vi.fn(async () => ({ ok: true })),
  getMediaGallery: vi.fn(async () => []),
  setConversationHidden: vi.fn(async () => ({ ok: true })),
  setDealStage: vi.fn(async () => ({ ok: true })),
  downloadChatHtml: vi.fn(async () => 'x.html'),
  getConversationRevision: vi.fn(async () => ({ revision: '1.0.0', last_message_ts: 1000, is_paused: false })),
  getConversationById: vi.fn(async () => ({
    chat_id: 111,
    is_paused: false,
    funnel_stage: 'rapport',
    pinned_facts: {},
    first_seen: 1000,
    messages: [],
    funnel_events: [],
  })),
  getBeats: (...args) => getBeatsMock(...args),
  getConversations: vi.fn(async () => [
    { chat_id: 111, name: 'А', last_message_ts: Math.floor(Date.now() / 1000) - 60 },
    { chat_id: 222, name: 'Б', last_message_ts: Math.floor(Date.now() / 1000) - 3600 },
    { chat_id: 333, name: 'В', last_message_ts: Math.floor(Date.now() / 1000) - 48 * 3600 },
  ]),
  setAiMode: vi.fn(async () => ({})),
  sendMessage: vi.fn(async () => ({})),
  getInboundMedia: vi.fn(async () => []),
  getPauseStatus: vi.fn(async () => ({
    status: 'active',
    reason: 'bot_active',
    actor: 'bot',
    until: null,
    ts: 1000,
  })),
}));

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(async () => ({ username: 't', role: 'admin' })),
    post: vi.fn(async () => ({})),
  },
  getToken: () => '',
  authHeaders: () => ({}),
}));

import ConversationPage, { TOGGLE_COOLDOWN_MS } from './ConversationPage';
import { PanelUX } from '../../ui/PanelUX';
import { getConversationById, getConversations, getInboundMedia, getPauseStatus, sendAlbum, sendAttachment, getMediaGallery, setConversationHidden, setDealStage } from '../../api/conversations';

let container = null;
let root = null;

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<ConversationPage />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
}

function unmount() {
  act(() => root.unmount());
  container.remove();
  container = null;
  root = null;
}

const navButton = (name) => container.querySelector(`button[aria-label="${name}"]`);

beforeEach(() => {
  // Остальные проверки — с включённым блоком «Сценарий».
  vi.stubEnv('VITE_SHOW_SCENARIO', '1');
  vi.useFakeTimers();
  navigateMock.mockClear();
  window.localStorage.clear();
  getBeatsMock.mockReset();
  getBeatsMock.mockResolvedValue({ beats: [], delivered: 0, total: 0 });
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
});

describe('ConversationPage: «К дашборду» и каркас страницы', () => {
  const PAUSED = { chat_id: 111, is_paused: true, funnel_stage: 'rapport', pinned_facts: {}, first_seen: 1000, messages: [], funnel_events: [] };

  it('в строке действий стрелки по чатам дашборда, позиция 1 из 3 и номер чата', async () => {
    vi.mocked(getConversations).mockClear();
    await renderPage();
    expect(getConversations).toHaveBeenCalledTimes(1);
    expect(navButton('Предыдущий чат')).toBeTruthy();
    expect(navButton('Следующий чат')).toBeTruthy();
    const nav = container.querySelector('[data-testid="chat-nav"]');
    expect(nav.textContent).toContain('1 / 3');
    expect(navButton('Предыдущий чат').disabled).toBe(true);
    expect(navButton('Следующий чат').disabled).toBe(false);
    expect(container.querySelector('[class*="chatToolbar"]').textContent).toContain('чат 111');
  });

  it('стрелка «вправо» ведёт на следующий чат списка', async () => {
    await renderPage();
    await act(async () => navButton('Следующий чат').click());
    expect(navigateMock).toHaveBeenCalledWith('/conversation/222');
  });

  it('«К дашборду»: на широком экране — первая строка колонки клиента, на узком — первая кнопка строки действий; видна всегда одна', async () => {
    await renderPage();
    const backs = [...container.querySelectorAll('button[class*="backBtn"]')];
    expect(backs).toHaveLength(2);
    const [inSidebar, inToolbar] = backs;
    expect(inSidebar.textContent).toContain('К дашборду');
    expect(inToolbar.textContent).toContain('К дашборду');

    const sidebar = container.querySelector('aside[class*="sidebar"]');
    const top = inSidebar.parentElement;
    expect(sidebar.firstElementChild).toBe(top);
    expect(top.className).toContain('h-11');
    // Одна прячется ниже lg, другая — от lg: одновременно доступна только одна.
    expect(top.className.split(' ')).toEqual(expect.arrayContaining(['hidden', 'lg:flex']));
    expect(inToolbar.className.split(' ')).toContain('lg:hidden');

    const toolbarRow = container.querySelector('[class*="chatToolbar"]').firstElementChild;
    expect(toolbarRow.className).toContain('h-11');
    expect(toolbarRow.firstElementChild).toBe(inToolbar);

    await act(async () => {
      inSidebar.click();
    });
    expect(navigateMock).toHaveBeenLastCalledWith('/');
    navigateMock.mockClear();
    await act(async () => {
      inToolbar.click();
    });
    expect(navigateMock).toHaveBeenLastCalledWith('/');
  });

  it('страница умещается в экран: сжимается каждый уровень, прокручивается только лента, блок ввода не сжимается', async () => {
    getConversationById.mockResolvedValueOnce(PAUSED);
    await renderPage();
    const classes = (el) => el.className.split(' ');
    const page = container.firstElementChild;
    expect(classes(page)).toEqual(expect.arrayContaining(['flex', 'min-h-0', 'flex-1', 'flex-col']));

    const feed = container.querySelector('[class*="messages"]');
    expect(classes(feed)).toEqual(expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-y-auto']));

    // От ленты вверх до корня страницы: каждый уровень — flex с min-h-0.
    for (let el = feed.parentElement; el !== page; el = el.parentElement) {
      expect(classes(el)).toEqual(expect.arrayContaining(['flex', 'min-h-0']));
    }

    const chat = container.querySelector('[class*="chatColumn"]');
    expect([...chat.querySelectorAll('[class*="overflow-y-auto"]')]).toEqual([feed]);

    // Строка действий, лента и блок ввода — соседи в одной колонке.
    const frame = feed.parentElement;
    expect(classes(frame)).toContain('flex-col');
    const toolbar = container.querySelector('[class*="chatToolbar"]');
    const input = container.querySelector('[class*="inputArea"]');
    expect(toolbar.parentElement).toBe(frame);
    expect(input.parentElement).toBe(frame);
    expect(classes(toolbar)).toContain('shrink-0');
    expect(classes(input)).toContain('shrink-0');
    expect(input.querySelector('textarea')).toBeTruthy();

    // Колонка клиента прокручивается сама и страницу не растягивает.
    const sidebar = container.querySelector('aside[class*="sidebar"]');
    expect(classes(sidebar)).toEqual(expect.arrayContaining(['min-h-0', 'shrink-0']));
    expect(sidebar.className).toContain('w-[clamp(300px,24vw,380px)]');
    const body = container.querySelector('[class*="sidebarBody"]');
    expect(classes(body)).toEqual(expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-y-auto']));
  });

  it('блок ввода — подвал колонки чата: линия сверху, отступы px-4 py-3, колонка той же ширины, что у ленты', async () => {
    getConversationById.mockResolvedValueOnce({
      ...PAUSED,
      messages: [{ id: 1, tg_msg_id: 10, ts: 1000, role: 'user', author: 'llm', content: 'привет' }],
    });
    await renderPage();
    const classes = (el) => el.className.split(' ');
    const input = container.querySelector('[class*="inputArea"]');
    expect(classes(input)).toEqual(expect.arrayContaining(['shrink-0', 'border-t', 'bg-background', 'px-4', 'py-3']));
    // Лента и подвал выровнены: одинаковые боковые отступы и одна центральная колонка.
    const feed = container.querySelector('[class*="messages"]');
    for (const pad of ['px-4', 'md:px-6']) {
      expect(classes(feed)).toContain(pad);
      expect(classes(input)).toContain(pad);
    }
    const column = input.firstElementChild;
    expect(input.children.length).toBe(1);
    expect(classes(column)).toEqual(expect.arrayContaining(['mx-auto', 'w-full', 'max-w-3xl']));
    expect(classes(container.querySelector('[class*="msgRow"]'))).toEqual(
      expect.arrayContaining(['mx-auto', 'w-full', 'max-w-3xl']),
    );
    // В колонке — полоса режима и под ней блок с полем; оба внутри подвала.
    const strip = column.querySelector('[class*="modeStrip"]');
    const composer = column.querySelector('[class*="composer"]');
    expect(strip.parentElement).toBe(column);
    expect(composer.parentElement).toBe(column);
    expect(strip.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('режим бота: в подвале полоса режима и плашка «Диалог ведёт бот» с кнопкой «Забрать чат»; поля нет', async () => {
    getConversationById.mockResolvedValueOnce({ ...PAUSED, is_paused: false });
    await renderPage();
    const input = container.querySelector('[class*="inputArea"]');
    const column = input.firstElementChild;
    expect(column.children.length).toBe(2);
    const strip = column.firstElementChild;
    expect(strip.className).toContain('modeStrip');
    expect(strip.querySelector('[class*="aiToggle"]')).toBeTruthy();
    expect(strip.querySelector('[data-testid="mode-status"]')).toBeTruthy();
    const plate = column.querySelector('[data-testid="bot-leads"]');
    expect(plate.textContent).toContain('Диалог ведёт бот');
    expect([...plate.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Забрать чат']);
    expect(input.querySelector('textarea')).toBeNull();
  });

  it('поле сообщения: с трёх строк, растёт до max-h и дальше прокручивается; кнопки — строкой под текстом', async () => {
    getConversationById.mockResolvedValueOnce(PAUSED);
    await renderPage();
    const composer = container.querySelector('[class*="composer"]');
    expect(composer.className.split(' ')).toEqual(expect.arrayContaining(['rounded-lg', 'border']));
    const field = composer.querySelector('textarea');
    expect(field.getAttribute('rows')).toBe('3');
    expect(field.className.split(' ')).toEqual(expect.arrayContaining(['min-h-[76px]', 'max-h-60', 'resize-none']));
    // Под полем — одна строка: вложения слева, «Отправить» справа.
    const tools = composer.querySelector('[class*="composerTools"]');
    expect(field.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tools.className.split(' ')).toContain('justify-between');
    expect(tools.querySelector('button[aria-label="Прикрепить файлы"]')).toBeTruthy();
    expect(tools.querySelector('button[aria-label="Эмодзи"]')).toBeTruthy();
    expect(tools.querySelector('button[aria-label="Голосовое"]')).toBeTruthy();
    const send = tools.lastElementChild;
    expect(send.textContent).toContain('Отправить');
    expect(send.className.split(' ')).toContain('bg-primary');
  });

  it('полоса ответа открывается внутри блока с полем, над текстом', async () => {
    getConversationById.mockResolvedValueOnce({
      ...PAUSED,
      messages: [{ id: 1, tg_msg_id: 10, ts: 1000, role: 'user', author: 'llm', content: 'привет' }],
    });
    await renderPage();
    const replyButton = [...container.querySelectorAll('[class*="msgRow"] button')].find((b) => b.textContent === 'Ответить');
    await act(async () => {
      replyButton.click();
    });
    const composer = container.querySelector('[class*="composer"]');
    const bar = container.querySelector('button[aria-label="Не отвечать"]').parentElement;
    expect(composer.contains(bar)).toBe(true);
    expect(bar.textContent).toContain('привет');
    expect(bar.compareDocumentPosition(composer.querySelector('textarea')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('полоса режима — от 32px: подсказка и «что дальше» в двух строках без обрезки посреди слова, полный текст в title', async () => {
    getConversationById.mockResolvedValueOnce({ ...PAUSED, next_bot_action: { kind: 'none' } });
    await renderPage();
    const strip = container.querySelector('[class*="modeStrip"]');
    expect(strip.className.split(' ')).toContain('min-h-8');
    const line = strip.querySelector('[data-testid="mode-status"]');
    expect(line.className.split(' ')).toContain('line-clamp-2');
    const next = line.querySelector('[data-testid="next-bot-action"]').textContent;
    expect(next).toBeTruthy();
    expect(line.textContent).toContain('Чат за тобой');
    expect(line.getAttribute('title')).toBe(`Чат за тобой. Включи, чтобы вернуть боту · ${next}`);
  });

  it('лента: колонка сообщений по центру (max-w-3xl), строка под пузырём не переносится', async () => {
    getConversationById.mockResolvedValueOnce({
      ...PAUSED,
      messages: [{ id: 1, tg_msg_id: 10, ts: 1000, role: 'user', author: 'llm', content: 'привет' }],
    });
    await renderPage();
    const row = container.querySelector('[class*="msgRow"]');
    expect(row.className.split(' ')).toEqual(expect.arrayContaining(['mx-auto', 'w-full', 'max-w-3xl']));
    const meta = row.querySelector('[class*="msgMeta"]');
    expect(meta.className.split(' ')).toEqual(expect.arrayContaining(['h-4', 'whitespace-nowrap']));
    expect(meta.className).not.toContain('flex-wrap');
  });

  it('под пузырём время видно всегда, а действия проявляются при наведении или фокусе и остаются в DOM', async () => {
    getConversationById.mockResolvedValueOnce({
      ...PAUSED,
      messages: [
        { id: 1, tg_msg_id: 10, ts: 1000, role: 'user', author: 'llm', content: 'привет', tg_read: true },
        { id: 2, tg_msg_id: 11, ts: 1005, role: 'assistant', author: 'operator:7', content: 'здравствуйте', tg_read: true },
      ],
    });
    await renderPage();
    const rows = [...container.querySelectorAll('[class*="msgRow"]')];
    const texts = [['Ответить', 'Реакция'], ['Ответить', 'Изменить']];
    rows.forEach((row, i) => {
      expect(row.className.split(' ')).toContain('group');
      const meta = row.querySelector('[class*="msgMeta"]');
      const actions = meta.querySelector('[class*="msgActions"]');
      expect(actions.className.split(' ')).toEqual(
        expect.arrayContaining([
          'opacity-0',
          'group-hover:opacity-100',
          'group-focus-within:opacity-100',
          '[@media(hover:none)]:opacity-100',
        ]),
      );
      // Действия — настоящие кнопки: из обхода клавиатурой не выпадают.
      const buttons = [...actions.querySelectorAll('button')];
      expect(buttons.map((b) => b.textContent)).toEqual(texts[i]);
      for (const b of buttons) expect(b.getAttribute('tabindex')).toBeNull();
      // Время и галочки лежат вне скрываемого блока.
      const mark = meta.querySelector('[data-testid="tg-read"]');
      expect(mark.textContent).toBe('✓✓');
      expect(actions.contains(mark)).toBe(false);
      const time = [...meta.children].find((el) => /^\d{2}:\d{2}$/.test(el.textContent));
      expect(time).toBeTruthy();
      expect(actions.contains(time)).toBe(false);
    });
  });

  it('дата над лентой — тихая подпись без рамки и «пилюли»', async () => {
    getConversationById.mockResolvedValueOnce({
      ...PAUSED,
      messages: [{ id: 1, tg_msg_id: 10, ts: 1000, role: 'user', author: 'llm', content: 'привет' }],
    });
    await renderPage();
    const label = container.querySelector('[class*="dateSticky"]').firstElementChild;
    const cls = label.className.split(' ');
    expect(cls).toContain('text-muted-foreground');
    expect(cls).not.toContain('border');
    expect(cls).not.toContain('rounded-full');
  });
});

describe('ConversationPage: блок «Сценарий» скрыт по умолчанию', () => {
  it('без VITE_SHOW_SCENARIO блока нет и биты не запрашиваются', async () => {
    vi.unstubAllEnvs();
    await renderPage();
    expect(container.textContent).not.toContain('Сценарий');
    expect(getBeatsMock).not.toHaveBeenCalled();
    vi.stubEnv('VITE_SHOW_SCENARIO', '1');
  });
});

describe('ConversationPage: «Сценарий» — один список, бар по дням, текст судьи', () => {
  const PAYLOAD = {
    total: 5,
    delivered: 3,
    beats: [
      { id: 'B1', title: 'Первый контакт в мессенджере', status: 'pending', day: 1 },
      {
        id: 'B2',
        title: 'Сайт знакомств: зачем зарегистрировалась, попадались неадекватные, рада нормальному собеседнику',
        status: 'delivered',
        by: 'judge',
        day: 1,
        ts: 1500,
        evidence: 'Я боялась неадекватных',
      },
      { id: 'B10', title: 'Поездки: Шанхай, Байкал — рассказала о поездке сама', status: 'pending', day: 1 },
      {
        id: 'B3',
        title: 'Три отношения, брака не было, последний партнёр изменил, ушла; был психолог; открыта новому',
        status: 'delivered',
        by: 'judge',
        day: 1,
        ts: 2000,
      },
      { id: 'B5', title: 'Измерению не подлежит', status: 'out_of_scope', day: 1 },
      { id: 'B12', title: 'День 2: зонд дохода', status: 'pending', day: 2 },
      { id: 'B20', title: 'День 3: обещание встречи', status: 'delivered', day: 3, ts: 3000 },
    ],
  };

  // Сценарий по умолчанию свёрнут; тесты списка открывают его сохранённым выбором.
  beforeEach(() => {
    window.localStorage.setItem('panel_chat_scenario_open', '1');
  });

  async function renderWithBeats({ open = true } = {}) {
    if (!open) window.localStorage.removeItem('panel_chat_scenario_open');
    getBeatsMock.mockResolvedValue(PAYLOAD);
    await renderPage();
  }

  const scenarioToggle = () => container.querySelector('button[class*="scenarioToggle"]');

  it('по умолчанию свёрнут: видна только шапка со счётчиком; клик раскрывает и запоминает выбор', async () => {
    await renderWithBeats({ open: false });
    const toggle = scenarioToggle();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Сценарий');
    expect(toggle.textContent).toContain('3 / 5');
    expect(container.querySelectorAll('[class*="beatRow"]')).toHaveLength(0);
    expect(container.querySelectorAll('[class*="telemetryRow"]')).toHaveLength(0);
    expect(container.querySelectorAll('[class*="dayProgressLabel"]')).toHaveLength(0);

    await act(async () => {
      toggle.click();
    });
    expect(scenarioToggle().getAttribute('aria-expanded')).toBe('true');
    expect(window.localStorage.getItem('panel_chat_scenario_open')).toBe('1');
    expect(rowIds()).toEqual(['B2', 'B3', 'B10', 'B12', 'B20']);

    await act(async () => {
      scenarioToggle().click();
    });
    expect(scenarioToggle().getAttribute('aria-expanded')).toBe('false');
    expect(window.localStorage.getItem('panel_chat_scenario_open')).toBe('0');
    expect(container.querySelectorAll('[class*="beatRow"]')).toHaveLength(0);
  });

  it('сохранённый выбор «открыт» раскрывает сценарий сразу', async () => {
    await renderWithBeats();
    expect(scenarioToggle().getAttribute('aria-expanded')).toBe('true');
    expect(rowIds().length).toBeGreaterThan(0);
  });

  const beatRows = () =>
    [...container.querySelectorAll('[class*="beatRow"]')].filter(
      (el) => !(el.getAttribute('class') || '').includes('beatRows'),
    );
  const rowIds = () =>
    beatRows()
      .map((r) => r.querySelector('[class*="beatId"]'))
      .map((e) => e.textContent);

  it('измеряемые биты одним списком в порядке день → номер B (численно: B2, B3, B10)', async () => {
    await renderWithBeats();
    expect(rowIds()).toEqual(['B2', 'B3', 'B10', 'B12', 'B20']);
  });

  it('скрытый B1 и out_of_scope в список не попадают', async () => {
    await renderWithBeats();
    expect(rowIds()).not.toContain('B1');
    expect(rowIds()).not.toContain('B5');
  });

  const telemetryRows = () => [...container.querySelectorAll('[class*="telemetryRow"]')];

  it('вне счёта: B5 — «не измеряется», B1 — «закрыт вручную»', async () => {
    await renderWithBeats();
    const rows = telemetryRows().map((r) => r.textContent);
    expect(rows.length).toBe(2);
    expect(rows[0]).toContain('B1');
    expect(rows[0]).toContain('закрыт вручную');
    expect(rows[1]).toContain('B5');
    expect(rows[1]).toContain('не измеряется');
  });

  it('группа вне счёта не едет в дробь дня: день 1 остаётся 2 / 3', async () => {
    await renderWithBeats();
    const fractions = [...container.querySelectorAll('[class*="dayFraction"]')].map((e) => e.textContent);
    expect(fractions).toEqual(['2 / 3', '0 / 1', '1 / 1']);
  });

  it('строка = название бита (до двоеточия); подпись — часть после двоеточия — убрана', async () => {
    await renderWithBeats();
    expect(container.textContent).toContain('Сайт знакомств');
    expect(container.textContent).toContain('Три отношения, брака не было,…');
    expect(container.textContent).not.toContain('зачем зарегистрировалась');
    expect(container.textContent).not.toContain('последний партнёр');
    expect(container.textContent).not.toContain('рассказала о поездке сама');
    expect(container.querySelector('[class*="beatMeta"]')).toBeNull();
  });

  it('комментарий судьи — под зачтённым битом; у неотмеченного его нет', async () => {
    await renderWithBeats();
    const comments = [...container.querySelectorAll('[class*="beatEvidence"]')].map((e) => e.textContent);
    expect(comments).toEqual(['судья: «Я боялась неадекватных»']);
    const wrap = container.querySelector('[class*="beatEvidence"]').parentElement;
    expect(wrap.querySelector('[class*="beatId"]').textContent).toBe('B2');
  });

  it('улика-пара показывается структурно; цитата судьи — как была', async () => {
    const payload = JSON.parse(JSON.stringify(PAYLOAD));
    payload.beats.unshift({
      id: 'B30',
      title: 'Парный бит',
      status: 'delivered',
      by: 'llm',
      src: 'judge',
      day: 1,
      ts: 2500,
      evidence: 'Клиент: «Чему ещё научишь?» → Ира: «Поймал) как вернусь - сыграем»',
    });
    getBeatsMock.mockResolvedValue(payload);
    await renderPage();
    const commentOf = (beatId) => {
      const el = [...container.querySelectorAll('[class*="beatEvidence"]')].find(
        (e) => e.parentElement.querySelector('[class*="beatId"]')?.textContent === beatId,
      );
      return el ? el.textContent : null;
    };
    const pair = commentOf('B30');
    expect(pair).toContain('судья: зачтено по обмену');
    expect(pair).toContain('клиент:');
    expect(pair).toContain('«Чему ещё научишь?»');
    expect(pair).toContain('Ира:');
    expect(pair).toContain('«Поймал) как вернусь - сыграем»');
    expect(pair).not.toContain('Клиент: «');
    expect(commentOf('B2')).toBe('судья: «Я боялась неадекватных»');
  });

  it('пин-улика без служебного шума леджера', async () => {
    const payload = JSON.parse(JSON.stringify(PAYLOAD));
    payload.beats.unshift({
      id: 'B31',
      title: 'Пин-бит',
      status: 'delivered',
      by: 'llm',
      src: 'pin',
      day: 1,
      ts: 2600,
      evidence: 'pinned_facts:_director_agenda.disclosed_bio_keys:design_path',
    });
    getBeatsMock.mockResolvedValue(payload);
    await renderPage();
    const el = [...container.querySelectorAll('[class*="beatEvidence"]')].find(
      (e) => e.parentElement.querySelector('[class*="beatId"]')?.textContent === 'B31',
    );
    const text = el.textContent;
    expect(text).toContain('по пину: в анкете раскрыто био');
    expect(text).toContain('disclosed_bio_keys: design_path');
    expect(text).not.toContain('pinned_facts:');
    expect(text).not.toContain('_director_agenda');
  });

  it('пин, разобранный бэком, печатается ОДИН раз и без пустой строки ключа', async () => {
    const payload = JSON.parse(JSON.stringify(PAYLOAD));
    payload.beats.unshift({
      id: 'B33',
      title: 'Пин, разобранный бэком',
      status: 'delivered',
      by: 'llm',
      src: 'pin',
      day: 1,
      ts: 2600,
      evidence: 'по пину: путь в дизайн: рисование с детства переросло в профессию',
    });
    getBeatsMock.mockResolvedValue(payload);
    await renderPage();
    const el = [...container.querySelectorAll('[class*="beatEvidence"]')].find(
      (e) => e.parentElement.querySelector('[class*="beatId"]')?.textContent === 'B33',
    );
    const text = el.textContent;
    expect(text).toBe('по пину: путь в дизайн: рисование с детства переросло в профессию');
    expect(text.match(/по пину/g)).toHaveLength(1);
    expect(el.querySelectorAll('[class*="beatEvidenceMeta"]')).toHaveLength(0);
  });

  it('заключение судьи (фаза 2) — главным текстом, улика — приглушённой строкой', async () => {
    const payload = JSON.parse(JSON.stringify(PAYLOAD));
    payload.beats.unshift({
      id: 'B32',
      title: 'Бит с заключением',
      status: 'delivered',
      by: 'llm',
      src: 'judge',
      day: 1,
      ts: 2700,
      evidence: 'Поймал) как вернусь - сыграем',
      reason: 'Ира пообещала сыграть, как вернётся, — приглашение прозвучало',
    });
    getBeatsMock.mockResolvedValue(payload);
    await renderPage();
    const el = [...container.querySelectorAll('[class*="beatEvidence"]')].find(
      (e) => e.parentElement.querySelector('[class*="beatId"]')?.textContent === 'B32',
    );
    const text = el.textContent;
    expect(text).toContain('судья: Ира пообещала сыграть, как вернётся, — приглашение прозвучало');
    expect(text).toContain('улика: «Поймал) как вернусь - сыграем»');
    expect(text).not.toContain('Клиент: «');
  });

  it('произнесённое — с галкой и зелёным id, неотмеченное — без них', async () => {
    await renderWithBeats();
    const rows = beatRows();
    const checks = rows
      .map((r) => r.querySelector('[class*="beatCheck"]'))
      .map((e) => (e ? e.textContent : null));
    expect(checks).toEqual(['✓', '✓', '', '', '✓']);
    const ids = rows.map((r) => r.querySelector('[class*="beatId"]'));
    expect(ids[0].className).toContain('beatIdDone');
    expect(ids[2].className).not.toContain('beatIdDone');
    expect(ids[4].className).toContain('beatIdDone');
  });

  it('прогресс-бар — в заголовке каждой группы дня, с дробью дня', async () => {
    await renderWithBeats();
    expect(container.textContent).toContain('Сценарий');
    expect(container.textContent).toContain('3 / 5');
    const labels = [...container.querySelectorAll('[class*="dayProgressLabel"]')].map((e) => e.textContent);
    expect(labels).toEqual(['день 1', 'день 2', 'день 3']);
    const fractions = [...container.querySelectorAll('[class*="dayFraction"]')].map((e) => e.textContent);
    expect(fractions).toEqual(['2 / 3', '0 / 1', '1 / 1']);
    const fills = [...container.querySelectorAll('[class*="progressFill"]')].map((e) => e.style.width);
    expect(fills).toEqual(['66.66666666666666%', '0%', '100%']);
  });

  it('клик по биту перематывает чат к месту; бит без улики в ленте — некликабелен', async () => {
    getConversationById.mockResolvedValueOnce({
      chat_id: 111,
      is_paused: false,
      funnel_stage: 'rapport',
      pinned_facts: {},
      first_seen: 1000,
      funnel_events: [],
      messages: [
        { ts: 1000, role: 'assistant', author: 'llm', content: 'Приветик' },
        { ts: 1400, role: 'user', author: 'llm', content: 'Я боялась неадекватных на сайте' },
        { ts: 1600, role: 'assistant', author: 'llm', content: 'Понимаю)' },
      ],
    });
    const scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;
    try {
      await renderWithBeats();
      const rows = beatRows();
      expect(rows[0].getAttribute('title')).toBe('Показать в переписке');
      await act(async () => {
        rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy.mock.contexts[0].textContent).toContain('Я боялась неадекватных');
      expect(rows[2].getAttribute('title')).toBeNull();
    } finally {
      delete window.HTMLElement.prototype.scrollIntoView;
    }
  });
});

describe('ConversationPage: чат — разбивка ходов и галочки прочитанности', () => {
  const CHAT_PAYLOAD = {
    chat_id: 111,
    is_paused: false,
    funnel_stage: 'rapport',
    pinned_facts: {},
    first_seen: 1000,
    messages: [
      { role: 'user', author: 'llm', ts: 1000, content: 'привет', tg_msg_id: 1, tg_read: true },
      { role: 'user', author: 'llm', ts: 1005, content: 'как дела', tg_msg_id: 2, tg_read: false },
      { role: 'assistant', author: 'llm', ts: 1010, content: 'хорошо, спасибо', tg_msg_id: 3, tg_read: true },
      { role: 'assistant', author: 'operator:7', ts: 1015, content: 'реплика оператора', tg_msg_id: 4, tg_read: false },
    ],
    funnel_events: [],
  };

  async function renderChat() {
    vi.mocked(getConversationById).mockResolvedValueOnce(CHAT_PAYLOAD);
    await renderPage();
  }

  const rows = () => [...container.querySelectorAll('[class*="msgRow"]')];
  const marks = () =>
    rows()
      .map((r) => r.querySelector('[data-testid="tg-read"]'))
      .map((m) => (m ? m.textContent : null));

  it('подряд идущие одного автора — группа: аватар у последнего клиентского, у бота и менеджера — своя подпись', async () => {
    await renderChat();
    const r = rows();
    expect(r.length).toBe(4);
    // Два клиентских подряд — одна группа: аватар один, у её последнего сообщения.
    expect(r[0].querySelector('[class*="clientAvatar"]')).toBeNull();
    expect(r[1].querySelector('[class*="clientAvatar"]')).toBeTruthy();
    // Бот и менеджер — разные авторы, у каждого своя группа со своей подписью.
    expect(r[2].querySelector('[class*="tagAI"]')).toBeTruthy();
    expect(r[3].querySelector('[class*="tagManaged"]')).toBeTruthy();
    // Внутри группы 2px, между группами 12px.
    const gap = (el) => el.className.split(' ').filter((c) => c === 'mt-3' || c === 'mt-0.5');
    expect(r.map(gap)).toEqual([['mt-3'], ['mt-0.5'], ['mt-3'], ['mt-3']]);
  });

  it('два сообщения бота подряд: одна подпись «Бот» над первым, не рамкой-бейджем; у группы клиента один аватар', async () => {
    vi.mocked(getConversationById).mockResolvedValueOnce({
      ...CHAT_PAYLOAD,
      messages: [
        { role: 'assistant', author: 'llm', ts: 1000, content: 'привет', tg_msg_id: 1 },
        { role: 'assistant', author: 'llm', ts: 1005, content: 'как ты?', tg_msg_id: 2 },
        { role: 'user', author: 'llm', ts: 1010, content: 'норм', tg_msg_id: 3 },
        { role: 'user', author: 'llm', ts: 1015, content: 'а ты', tg_msg_id: 4 },
        { role: 'user', author: 'llm', ts: 1020, content: '?', tg_msg_id: 5 },
        { role: 'assistant', author: 'llm', ts: 1025, content: 'тоже', tg_msg_id: 6 },
      ],
    });
    await renderPage();
    const r = rows();
    expect(r.length).toBe(6);
    const tags = container.querySelectorAll('[class*="tagAI"]');
    expect(tags.length).toBe(2);
    expect(r[0].contains(tags[0])).toBe(true);
    expect(r[1].querySelector('[class*="tagAI"]')).toBeNull();
    expect(r[5].contains(tags[1])).toBe(true);
    expect(tags[0].textContent).toContain('Бот');
    expect(tags[0].getAttribute('data-slot')).not.toBe('badge');
    expect(tags[0].className.split(' ')).not.toContain('border');
    expect(tags[0].className.split(' ')).toContain('text-muted-foreground');
    const avatars = container.querySelectorAll('[class*="clientAvatar"]');
    expect(avatars.length).toBe(1);
    expect(r[4].contains(avatars[0])).toBe(true);
    const gap = (el) => el.className.split(' ').filter((c) => c === 'mt-3' || c === 'mt-0.5');
    expect(r.map(gap)).toEqual([['mt-3'], ['mt-0.5'], ['mt-3'], ['mt-0.5'], ['mt-0.5'], ['mt-3']]);
    // Сами сообщения никуда не делись: у каждого свой пузырь с текстом.
    expect(r.map((x) => x.textContent.includes('Ответить'))).toEqual(Array(6).fill(true));
  });

  it('улика-путь рисуется миниатюрой с подписью «кадр отправлен», а не сырым путём', async () => {
    window.localStorage.setItem('panel_chat_scenario_open', '1');
    getBeatsMock.mockResolvedValue({
      total: 1,
      delivered: 1,
      beats: [
        {
          id: 'B6',
          title: 'Селфи',
          status: 'delivered',
          by: 'judge',
          day: 1,
          ts: 1500,
          evidence: 'data/personas/irina/photos/phuket_pool_selfie.jpg',
        },
      ],
    });
    await renderChat();

    const thumb = container.querySelector('img[class*="beatEvidenceThumb"]');
    expect(thumb).toBeTruthy();
    expect(thumb.getAttribute('src')).toBe('/api/conversations/111/media/1500');
    expect(container.textContent).toContain('кадр отправлен');
    expect(container.textContent).not.toContain('phuket_pool_selfie.jpg');
  });

  it('дребезг тумблера: второй клик внутри cooldown не шлёт второй POST, после окна — шлёт', async () => {
    const { setAiMode } = await import('../../api/conversations');
    await renderChat();
    vi.mocked(setAiMode).mockClear();
    const toggle = container.querySelector('button[class*="aiToggle"]');
    expect(toggle).toBeTruthy();
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(10_000);
    await act(async () => toggle.click());
    now.mockReturnValue(10_000 + TOGGLE_COOLDOWN_MS - 1);
    await act(async () => toggle.click());
    expect(vi.mocked(setAiMode)).toHaveBeenCalledTimes(1);

    now.mockReturnValue(10_000 + TOGGLE_COOLDOWN_MS + 1);
    await act(async () => toggle.click());
    expect(vi.mocked(setAiMode)).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('галочки Telegram: его — ✓✓ прочитано аккаунтом / ● нет; наши — ✓✓ прочитал / ✓ доставлено', async () => {
    await renderChat();
    expect(marks()).toEqual(['✓✓', '●', '✓✓', '✓']);
  });

  it('собеседник записывает голосовое — пузырь внизу ленты; перестал — пузыря нет', async () => {
    vi.mocked(getConversationById).mockResolvedValueOnce({ ...CHAT_PAYLOAD, client_typing: 'voice' });
    await renderPage();
    expect(container.querySelector('[data-testid="client-typing"]')?.textContent).toContain('записывает голосовое');
  });

  it('«печатает» продолжает группу собеседника: аватар один и стоит у этой строки', async () => {
    vi.mocked(getConversationById).mockResolvedValueOnce({
      ...CHAT_PAYLOAD,
      messages: CHAT_PAYLOAD.messages.slice(0, 2),
      client_typing: 'typing',
    });
    await renderPage();
    const typing = container.querySelector('[data-testid="client-typing"]');
    const avatars = container.querySelectorAll('[class*="clientAvatar"]');
    expect(avatars.length).toBe(1);
    expect(typing.contains(avatars[0])).toBe(true);
    expect(typing.className.split(' ')).toContain('mt-0.5');
  });

  it('лента стала ниже (вырос блок ввода): если стояла у последних сообщений — остаётся у них, иначе не трогаем', async () => {
    const observers = [];
    const Original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); }
      observe(el) { this.targets.push(el); }
      unobserve() {}
      disconnect() { this.targets = []; }
    };
    try {
      await renderChat();
      const feed = container.querySelector('[class*="messages"]');
      const watcher = observers.find((o) => o.targets.includes(feed));
      expect(watcher).toBeTruthy();
      Object.defineProperty(feed, 'scrollHeight', { configurable: true, value: 900 });
      Object.defineProperty(feed, 'clientHeight', { configurable: true, value: 300 });
      // Стоим внизу: после сжатия ленты последние сообщения остаются на виду.
      feed.scrollTop = 0;
      act(() => watcher.cb([]));
      expect(feed.scrollTop).toBe(900);
      // Человек ушёл вверх читать историю — прокрутку не трогаем.
      feed.scrollTop = 100;
      act(() => feed.dispatchEvent(new Event('scroll', { bubbles: true })));
      act(() => watcher.cb([]));
      expect(feed.scrollTop).toBe(100);
    } finally {
      globalThis.ResizeObserver = Original;
    }
  });

  it('аватарка из Telegram вместо инициалов; не загрузилась — снова инициалы', async () => {
    vi.mocked(getConversationById).mockResolvedValueOnce({ ...CHAT_PAYLOAD, client_avatar: '/api/conversations/111/avatar?v=1' });
    await renderPage();
    const imgs = [...container.querySelectorAll('img[src*="/avatar?v=1"]')];
    expect(imgs.length).toBeGreaterThan(1);
    await act(async () => imgs.forEach((img) => img.dispatchEvent(new Event('error'))));
    expect(container.querySelector('img[src*="/avatar?v=1"]')).toBeNull();
  });

  it('локальный курсор менеджера галочки не меняет', async () => {
    window.localStorage.setItem('chutter_mgr_read_v1:111', '3');
    await renderChat();
    expect(marks()).toEqual(['✓✓', '●', '✓✓', '✓']);
  });
});

describe('ConversationPage: лента — дата, разбивка, галочки, ввод', () => {
  const T1 = Math.floor(new Date(2026, 7, 20, 12).getTime() / 1000);
  const T2 = T1 + 24 * 3600;
  const msgs = [
    { role: 'user', author: 'llm', content: 'привет', ts: T1 },
    { role: 'user', author: 'llm', content: 'ещё', ts: T1 + 5 },
    { role: 'assistant', author: 'llm', content: 'здравствуйте', ts: T1 + 10 },
    { role: 'user', author: 'llm', content: 'добрый день', ts: T2 },
  ];

  function withMessages(list, { paused = false } = {}) {
    vi.mocked(getConversationById).mockResolvedValueOnce({
      chat_id: 111,
      is_paused: paused,
      funnel_stage: 'rapport',
      pinned_facts: {},
      first_seen: T1,
      messages: list,
      funnel_events: [],
    });
  }

  it('висящая дата: есть метка с днём первого сообщения', async () => {
    withMessages(msgs);
    await renderPage();
    const sticky = container.querySelector('[class*="dateSticky"]');
    expect(sticky).toBeTruthy();
    expect(sticky.textContent).toContain('августа');
    expect(sticky.textContent).toContain('2026');
  });

  it('аватар один на группу клиентских сообщений; без tg id галочек нет (21.08)', async () => {
    window.localStorage.clear();
    withMessages(msgs);
    await renderPage();
    // Три клиентских сообщения — две группы (два подряд и одно после бота).
    expect(container.querySelectorAll('[class*="msgClient"]').length).toBe(3);
    expect(container.querySelectorAll('[class*="clientAvatar"]').length).toBe(2);
    expect(container.querySelectorAll('[data-testid="tg-read"]').length).toBe(0);
  });

  it('режим бота: поле ввода спрятано, тумблер на месте', async () => {
    withMessages(msgs, { paused: false });
    await renderPage();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('[class*="aiToggle"]')).toBeTruthy();
    expect(container.textContent).toContain('БОТ ОТВЕЧАЕТ');
  });

  it('кнопка «Голосовое» открывает выбор аудио, а не отправку текста войсеру', async () => {
    withMessages(msgs, { paused: true });
    await renderPage();
    const voice = navButton('Голосовое');
    expect(voice).toBeTruthy();
    expect(container.textContent).not.toContain('Войсеру');
    const input = container.querySelector('input[type="file"][accept*="audio"]');
    expect(input).toBeTruthy();
  });

  it('ручной режим: поле ввода на месте', async () => {
    withMessages(msgs, { paused: true });
    await renderPage();
    expect(container.querySelector('textarea')).toBeTruthy();
    expect(container.textContent).toContain('РУЧНОЙ РЕЖИМ');
  });

  const reason = () => container.querySelector('[data-testid="pause-reason"]');

  function withPause(rawReason) {
    withMessages(msgs, { paused: true });
    vi.mocked(getPauseStatus).mockResolvedValueOnce({
      status: 'paused',
      reason: rawReason,
      actor: 'critic:empty_after_critic',
      until: null,
      ts: T1,
    });
  }

  it('вердикт критика доезжает до карточки, а не остаётся константой в БД', async () => {
    withPause('human_takeover:empty_after_critic/p0_persisted');
    await renderPage();
    const text = reason().textContent;
    expect(text).toContain('на ручном');
    expect(text).not.toContain('human_takeover');
    expect(text).toContain('empty_after_critic');
    expect(text).toContain('p0_persisted');
    expect(reason().getAttribute('title')).toBe('human_takeover:empty_after_critic/p0_persisted');
  });

  it('причина С ХВОСТОМ распознаётся: подпись та же, что у бесхвостой', async () => {
    withPause('human_takeover:empty_after_critic/p0_persisted');
    await renderPage();
    const tailed = reason().textContent;
    unmount();
    withPause('human_takeover');
    await renderPage();
    expect(tailed).toContain('на ручном');
    expect(reason().textContent).toContain('на ручном');
  });

  it('БЕЗ хвоста (флаг off) — только состояние, вердикта нет', async () => {
    withPause('operator_hold');
    await renderPage();
    expect(reason().textContent).toBe('Почему молчит: придержан менеджером');
    expect(reason().textContent).not.toContain('—');
  });

  it('боевая проза с двоеточием внутри разбирается, а не режется пополам', async () => {
    withPause('harness-import 20.08 (s3, финансы+pain): синтетический чат, не писать');
    await renderPage();
    expect(reason().textContent).toContain('harness-import 20.08 (s3, финансы+pain)');
    expect(reason().textContent).toContain('синтетический чат, не писать');
  });

  it('пока бот ведёт — строки нет и за причиной вообще не ходим', async () => {
    vi.mocked(getPauseStatus).mockClear();
    withMessages(msgs, { paused: false });
    await renderPage();
    expect(reason()).toBeNull();
    expect(vi.mocked(getPauseStatus)).not.toHaveBeenCalled();
  });

  it('в карточке видно, с какого аккаунта Telegram личность пишет клиенту', async () => {
    vi.mocked(getConversationById).mockResolvedValueOnce({
      chat_id: 111,
      persona_id: 'nastya',
      persona_name: 'Настя',
      account: { id: 7, username: 'nastya_tg', display_name: 'Настя К.', phone: '+79990000000', persona_id: 'nastya' },
      is_paused: false,
      funnel_stage: 'rapport',
      pinned_facts: {},
      first_seen: T1,
      messages: msgs,
      funnel_events: [],
    });
    await renderPage();
    const row = container.querySelector('[data-testid="writing-account"]');
    expect(row.textContent).toContain('Настя К.');
    expect(row.textContent).toContain('@nastya_tg');
    expect(row.querySelector('a').getAttribute('href')).toBe('https://t.me/nastya_tg');
  });

  it('без привязанного аккаунта строка «Аккаунт» показывает прочерк', async () => {
    withMessages(msgs);
    await renderPage();
    expect(container.querySelector('[data-testid="writing-account"]').textContent).toContain('—');
  });

  it('роут молчит — карточка живёт дальше, просто без «почему»', async () => {
    withMessages(msgs, { paused: true });
    vi.mocked(getPauseStatus).mockRejectedValueOnce(new Error('503'));
    await renderPage();
    expect(reason()).toBeNull();
    expect(container.textContent).toContain('РУЧНОЙ РЕЖИМ');
    expect(container.querySelector('textarea')).toBeTruthy();
  });

  it('роут ОТКАЗАЛ после удачного ответа — причина ГАСНЕТ, а не висит протухшей', async () => {
    vi.mocked(getConversationById).mockResolvedValue({
      chat_id: 111,
      persona_id: 'irina',
      is_paused: true,
      funnel_stage: 'rapport',
      pinned_facts: {},
      first_seen: T1,
      messages: msgs,
      funnel_events: [],
    });
    vi.mocked(getPauseStatus).mockResolvedValueOnce({
      status: 'paused',
      reason: 'human_takeover:empty_after_critic/p0_persisted',
      actor: 'critic:empty_after_critic',
      until: null,
      ts: T1,
    });
    await renderPage();
    expect(reason().textContent).toContain('на ручном');

    vi.mocked(getPauseStatus).mockRejectedValue(new Error('503'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(reason()).toBeNull();
    vi.mocked(getConversationById).mockReset();
  });

  it('деталь говорит «на паузе», а роут — «бот ведёт»: молчание НЕ объясняется', async () => {
    withMessages(msgs, { paused: true });
    vi.mocked(getPauseStatus).mockResolvedValueOnce({
      status: 'active',
      reason: 'bot_active',
      actor: 'bot',
      until: null,
      ts: T1,
    });
    await renderPage();
    expect(reason()).toBeNull();
  });
});

describe('left block: lead card folded into the top card', () => {
  const T1 = Math.floor(new Date(2026, 7, 20, 12).getTime() / 1000);

  function withPins(pins, extra = {}) {
    vi.mocked(getConversationById).mockResolvedValueOnce({
      chat_id: 111,
      is_paused: false,
      funnel_stage: 'rapport',
      pinned_facts: pins,
      first_seen: T1,
      messages: [],
      funnel_events: [],
      ...extra,
    });
  }

  it('нет секции «Карта лида» и сетки sidebarRow; «Цели знакомства» — прямой потомок сайдбара', async () => {
    withPins({});
    await renderPage();
    expect(container.querySelector('[class*="sidebarRow"]')).toBeNull();
    expect(container.textContent).not.toContain('Карта лида');
    const goals = [...container.querySelectorAll('[class*="summarySection"]')]
      .find((el) => el.textContent.includes('Цели знакомства'));
    expect(goals).toBeTruthy();
    expect(goals.parentElement.className).toContain('sidebar');
  });

  it('семья: человекочитаемо в верхней карточке (divorced → «в разводе»)', async () => {
    withPins({ name: 'Андрей', age: 46, city: 'Воронеж', family: 'divorced' });
    await renderPage();
    const card = container.querySelector('[class*="agentCard"]');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Семья');
    expect(card.textContent).toContain('в разводе');
  });

  it('семья: «добавить», когда данных нет — значение правится, прочерк остаётся у нередактируемых', async () => {
    withPins({});
    await renderPage();
    const card = container.querySelector('[class*="agentCard"]');
    expect(card.textContent).toMatch(/Семья\s*добавить/);
    expect(card.textContent).toMatch(/Контакт\s*—/);
  });

  it('видно, что правится: у возраста, города, сайта и семьи — карандаш; у стадии, контакта и аккаунта — обычный текст; «Этап» — поле с рамкой', async () => {
    withPins({ age: 46, city: 'Воронеж' });
    await renderPage();
    const card = container.querySelector('[class*="agentCard"]');
    const rowOf = (label) =>
      [...card.querySelectorAll('span')].find((el) => el.textContent === label && el.children.length === 0).parentElement;
    for (const label of ['Возраст', 'Город', 'Сайт', 'Семья']) {
      const button = rowOf(label).querySelector('button');
      expect(button, label).toBeTruthy();
      expect(button.querySelector('svg'), label).toBeTruthy();
    }
    expect(rowOf('Сайт').querySelector('button').getAttribute('aria-label')).toBe('Сайт: добавить');
    for (const label of ['Стадия', 'Контакт', 'Аккаунт']) {
      expect(rowOf(label).querySelector('button'), label).toBeNull();
      expect(rowOf(label).querySelector('svg'), label).toBeNull();
    }
    const stage = card.querySelector('[data-testid="deal-stage"] select');
    expect(stage.className.split(' ')).toEqual(expect.arrayContaining(['h-8', 'border-input']));
    expect(stage.className).not.toContain('border-transparent');
  });

  it('сигналы: в верхней карточке, не в отдельной секции', async () => {
    withPins({
      pain_confirmed: true, pain_confirmed_turns: 2,
      stuck_stage: 'qualification', turns_in_current_stage: 228,
    });
    await renderPage();
    const card = container.querySelector('[class*="agentCard"]');
    const box = card.querySelector('[class*="signals"]');
    const chips = box ? [...box.children] : [];
    expect(chips).toHaveLength(2);
    expect(card.textContent).toContain('Боль подтверждена (2)');
    expect(card.textContent).toContain('Застрял в стадии: 228 ходов');
  });

  it('возраст и город не дублируются между карточкой и сеткой', async () => {
    vi.setSystemTime(new Date(2026, 7, 20, 12, 0, 0));
    withPins({ name: 'Андрей', age: 46, city: 'Воронеж' });
    await renderPage();
    expect(container.textContent.match(/Воронеж/g)).toHaveLength(1);
    expect(container.textContent.match(/46/g)).toHaveLength(1);
  });

  it('телефон: номер из БД (phone_numbers), когда в пинах его нет (D-123)', async () => {
    withPins({ name: 'Андрей' }, { client_phone: '+79240232350' });
    await renderPage();
    expect(container.textContent).toContain('+79240232350');
  });

  it('телефон: номера нет нигде — прочерк в карточке', async () => {
    withPins({ name: 'Андрей' });
    await renderPage();
    const card = container.querySelector('[class*="agentCard"]');
    expect(card.textContent).toMatch(/Контакт\s*—/);
  });

  it('пол: из карточки лида', async () => {
    withPins({ name: 'Андрей' }, { client_gender: 'm' });
    await renderPage();
    expect(container.querySelector('[data-testid="client-gender"]').textContent).toBe('Пол' + 'Мужской');
  });

  it('пол не указан — прочерк', async () => {
    withPins({ name: 'Андрей' }, { client_gender: 'unknown' });
    await renderPage();
    expect(container.querySelector('[data-testid="client-gender"]').textContent).toBe('Пол' + '—');
  });

  it('вероятный ЧС: метка у имени и баннер над лентой', async () => {
    withPins({ name: 'Андрей' }, { likely_blocked_at: 1000 });
    await renderPage();
    expect(container.querySelector('[data-testid="client-likely-blocked"]').textContent).toContain('вероятно, ЧС');
    expect(container.querySelector('[data-testid="likely-blocked-banner"]')).not.toBeNull();
  });

  it('VK: контакт и аккаунт ссылками на vk.com, у аккаунта бейдж канала', async () => {
    withPins({ name: 'Андрей' }, {
      channel: 'vk',
      contact: { display: 'id777', url: 'https://vk.com/id777' },
      account: { display_name: 'Настя', channel: 'vk', contact: { display: 'nastya_vk', url: 'https://vk.com/nastya_vk' } },
    });
    await renderPage();
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://vk.com/id777');
    expect(hrefs).toContain('https://vk.com/nastya_vk');
    expect(container.querySelector('[data-testid="writing-account"] [data-channel="vk"]').textContent).toBe('VK');
  });

  it('город: из БД (phone_numbers), когда в пинах его нет (D-125)', async () => {
    withPins({ name: 'Андрей' }, { client_city: 'Ростов-на-Дону' });
    await renderPage();
    const card = container.querySelector('[class*="agentCard"]');
    expect(card.textContent).toContain('Ростов-на-Дону');
  });
});

describe('ConversationPage: медиа-ходы ленты', () => {
  const MEDIA_MESSAGES = [
    { ts: 1000, role: 'assistant', author: 'llm', content: 'Лови закат)' },
    { ts: 1010, role: 'assistant', author: 'llm', content: '[media:photo]' },
    { ts: 1020, role: 'assistant', author: 'llm', content: '[media:video]' },
    { ts: 1030, role: 'assistant', author: 'llm', content: '[media:voice]' },
    { ts: 1040, role: 'user', author: 'llm', content: '[фото: описание с картинки]' },
  ];

  async function renderWithMedia() {
    getConversationById.mockResolvedValueOnce({
      chat_id: 111,
      is_paused: false,
      funnel_stage: 'rapport',
      pinned_facts: {},
      first_seen: 1000,
      funnel_events: [],
      messages: MEDIA_MESSAGES,
    });
    await renderPage();
  }

  it('photo → <img>, video → <video controls>, voice → плеер голосового со стрим-URL', async () => {
    await renderWithMedia();
    const img = container.querySelector('img[class*="mediaItem"]');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/api/conversations/111/media/1010');
    const video = container.querySelector('video[class*="mediaItem"]');
    expect(video).toBeTruthy();
    expect(video.getAttribute('controls')).not.toBeNull();
    expect(video.getAttribute('src')).toBe('/api/conversations/111/media/1020');
    expect(container.querySelector('[data-testid="voice-player"]')).toBeTruthy();
    const audio = container.querySelector('[data-testid="voice-player"] audio');
    expect(audio).toBeTruthy();
    expect(audio.getAttribute('src')).toBe('/api/conversations/111/media/1030');
  });

  it('текст и входящее [фото: описание] остаются текстом; тег [media:*] не протекает', async () => {
    await renderWithMedia();
    expect(container.textContent).toContain('Лови закат)');
    expect(container.textContent).toContain('[фото: описание с картинки]');
    expect(container.textContent).not.toContain('[media:photo]');
    expect(container.textContent).not.toContain('[media:video]');
  });
});

describe('ConversationPage: входящие медиа клиента', () => {
  it('user-ход с сохранённым файлом рисуется медиа; плейсхолдер без файла остаётся текстом', async () => {
    getConversationById.mockResolvedValueOnce({
      chat_id: 111,
      is_paused: false,
      funnel_stage: 'rapport',
      pinned_facts: {},
      first_seen: 1000,
      funnel_events: [],
      messages: [
        { ts: 1000, role: 'assistant', author: 'llm', content: 'ну давай фото' },
        { ts: 1010, role: 'user', author: 'llm', content: '[фото пропущен]' },
        { ts: 1020, role: 'user', author: 'llm', content: '[голосовое пропущен]' },
      ],
    });
    getInboundMedia.mockResolvedValueOnce([{ ts: 1010, kind: 'photo' }]);
    await renderPage();
    const img = container.querySelector('img[class*="mediaItem"]');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/api/conversations/111/media/1010');
    expect(container.textContent).not.toContain('[фото пропущен]');
    expect(container.textContent).toContain('[голосовое пропущен]');
  });

  it('кружок — круглое видео, видео — с подписью; текст в ту же секунду остаётся текстом', async () => {
    getConversationById.mockResolvedValueOnce({
      chat_id: 111,
      is_paused: false,
      funnel_stage: 'rapport',
      pinned_facts: {},
      first_seen: 1000,
      funnel_events: [],
      messages: [
        { ts: 2000, role: 'user', author: 'client', content: '[Кружок]' },
        { ts: 2001, role: 'user', author: 'client', content: 'посмотри)' },
        { ts: 3000, role: 'user', author: 'client', content: '[Видео]\nнаш кот' },
      ],
    });
    getInboundMedia.mockResolvedValueOnce([
      { ts: 2000, kind: 'video_note' },
      { ts: 3000, kind: 'video' },
    ]);
    await renderPage();
    const videos = [...container.querySelectorAll('video')];
    expect(videos.map((v) => v.getAttribute('src'))).toEqual(['/api/conversations/111/media/2000', '/api/conversations/111/media/3000']);
    expect(videos[0].className).toContain('videoNote');
    expect(container.textContent).toContain('посмотри)');
    expect(container.textContent).toContain('наш кот');
    expect(container.textContent).not.toContain('[Кружок]');
  });
});

describe('цели знакомства на экране', () => {
  function withGoals(goals) {
    vi.mocked(getConversationById).mockResolvedValueOnce({
      chat_id: 111,
      is_paused: false,
      funnel_stage: 'rapport',
      pinned_facts: { name: 'Сергей' },
      first_seen: 1000,
      messages: [],
      funnel_events: [],
      goals,
    });
  }

  const goalsBox = () =>
    [...container.querySelectorAll('[class*="summarySection"]')].find((el) =>
      el.textContent.includes('Цели знакомства'),
    );

  it('строки, счётчик и этап — из ответа сервера', async () => {
    withGoals({
      stage: { id: 'knock', title: 'первое касание', index: 1, total: 5, turns: 4, days: 1 },
      known: 1,
      total: 3,
      next: { id: 'work', title: 'а работаешь где?' },
      slots: [
        { id: 'work', title: 'а работаешь где?', state: 'open', value: null, asks: 0, priority: 5, required_by_day: 1 },
        { id: 'age', title: 'сколько тебе лет?', state: 'asked', value: null, asks: 1, priority: 3, required_by_day: 1 },
        { id: 'name', title: 'как тебя зовут?', state: 'known', value: 'Сергей', asks: 1, priority: 2, required_by_day: 1 },
      ],
    });
    await renderPage();
    const box = goalsBox();
    expect(box).toBeTruthy();
    expect(box.textContent).toContain('первое касание');
    expect(box.textContent).toContain('1 / 3');
    const rows = [...box.querySelectorAll('[class*="checkRow"]')];
    expect(rows).toHaveLength(3);
    const text = rows.map((r) => r.textContent).join('|');
    expect(text).toContain('work');
    expect(text).toContain('не спрошена');
    expect(text).toContain('Сергей');
    expect(box.querySelector('[class*="nextText"]').textContent).toContain('работаешь');
  });

  it('целей ещё не считали — блок на месте, но задания не выдумывает', async () => {
    withGoals(undefined);
    await renderPage();
    const box = goalsBox();
    expect(box).toBeTruthy();
    expect(box.querySelectorAll('[class*="checkRow"]')).toHaveLength(0);
    expect(box.querySelector('[class*="nextText"]').textContent).toContain('не считались');
  });
});

describe('несколько фото, «Медиа», архив и «вниз»', () => {
  beforeEach(() => {
    getConversationById.mockReset();
    getConversationById.mockResolvedValue({ chat_id: 111, is_paused: false, archived: false, funnel_stage: 'rapport', pinned_facts: {}, first_seen: 1000, messages: [], funnel_events: [] });
  });

  async function pick(files) {
    const input = container.querySelector('input[type="file"][multiple]');
    expect(input).toBeTruthy();
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(10);
    });
  }

  it('два фото — альбом одним запросом, подпись у альбома', async () => {
    getConversationById.mockResolvedValue({ chat_id: 111, is_paused: true, archived: false, funnel_stage: 'rapport', pinned_facts: {}, first_seen: 1000, messages: [], funnel_events: [] });
    globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || (() => 'blob:x');
    await renderPage();
    await pick([new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })]);
    expect(container.querySelector('[data-testid="album-bar"]').textContent).toContain('альбом · 2 шт.');
    const textarea = container.querySelector('textarea');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, 'мы на море');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sendBtn = [...container.querySelectorAll('button')].find((b) => /Отправить/.test(b.textContent));
    await act(async () => {
      sendBtn.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(sendAlbum).toHaveBeenCalledWith('111', { sources: ['/tmp/a.jpg', '/tmp/b.jpg'], caption: 'мы на море', replyTo: null });
  });

  it('фото и документ вместе — по одному, подпись у первого', async () => {
    getConversationById.mockResolvedValue({ chat_id: 111, is_paused: true, archived: false, funnel_stage: 'rapport', pinned_facts: {}, first_seen: 1000, messages: [], funnel_events: [] });
    globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || (() => 'blob:x');
    sendAttachment.mockClear();
    await renderPage();
    await pick([new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['d'], 'd.pdf', { type: 'application/pdf' })]);
    const sendBtn = [...container.querySelectorAll('button')].find((b) => /Отправить/.test(b.textContent));
    await act(async () => {
      sendBtn.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(sendAttachment.mock.calls.map((c) => c[1].source)).toEqual(['/tmp/a.jpg', '/tmp/d.pdf']);
  });

  it('«Медиа» открывает сетку фото переписки', async () => {
    getMediaGallery.mockResolvedValueOnce([
      { id: 5, ts: 1789000000, role: 'user', kind: 'photo', url: '/api/files/5', caption: null },
      { id: 6, ts: 1789000100, role: 'assistant', kind: 'video_note', url: '/api/files/6', caption: null },
    ]);
    await renderPage();
    await act(async () => {
      container.querySelector('[data-testid="open-media"]').click();
      await vi.advanceTimersByTimeAsync(10);
    });
    const dialog = document.querySelector('[aria-label="Медиа переписки"]');
    expect(dialog).toBeTruthy();
    expect(dialog.querySelectorAll('img[src="/api/files/5"]')).toHaveLength(1);
    expect(dialog.textContent).toContain('Кружки');
  });

  it('«Кружком»: видео уходит видеосообщением', async () => {
    getConversationById.mockResolvedValue({ chat_id: 111, is_paused: true, archived: false, funnel_stage: 'rapport', pinned_facts: {}, first_seen: 1000, messages: [], funnel_events: [] });
    sendAttachment.mockClear();
    await renderPage();
    const input = container.querySelector('input[accept*="video/"]');
    expect(input).toBeTruthy();
    Object.defineProperty(input, 'files', { value: [new File(['v'], 'clip.mp4', { type: 'video/mp4' })], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(sendAttachment).toHaveBeenCalledWith('111', expect.objectContaining({ kind: 'video_note', source: '/tmp/clip.mp4' }));
  });

  it('«В архив» из чата спрашивает причину и ставит этап «Архив»', async () => {
    await renderPage();
    // Причину спрашивает окно панели, не window.prompt.
    const prompt = vi.spyOn(PanelUX, 'prompt').mockResolvedValue('не отвечает');
    await act(async () => {
      container.querySelector('[data-testid="archive-toggle"]').click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(prompt).toHaveBeenCalled();
    expect(setDealStage).toHaveBeenCalledWith('111', 'archive', 'не отвечает');
    expect(setConversationHidden).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it('«В архив» без причины отменяется', async () => {
    vi.mocked(setDealStage).mockClear();
    vi.mocked(setConversationHidden).mockClear();
    await renderPage();
    const prompt = vi.spyOn(PanelUX, 'prompt').mockResolvedValue(null);
    await act(async () => {
      container.querySelector('[data-testid="archive-toggle"]').click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(setDealStage).not.toHaveBeenCalled();
    expect(setConversationHidden).not.toHaveBeenCalled();
    prompt.mockRestore();
  });
});

describe('состояния, которые раньше не было видно', () => {
  const PAUSED = { chat_id: 111, is_paused: true, archived: false, funnel_stage: 'rapport', pinned_facts: {}, first_seen: 1000, messages: [], funnel_events: [] };

  beforeEach(() => {
    getConversationById.mockReset();
    getConversationById.mockResolvedValue(PAUSED);
  });

  const scenarioBox = () =>
    [...container.querySelectorAll('[class*="summarySection"]')].find((el) => el.textContent.includes('Сценарий'));

  it('сценарий не загрузился: вместо вечного скелетона — «Не удалось загрузить» и повтор', async () => {
    getBeatsMock.mockReset();
    getBeatsMock.mockRejectedValue(new Error('boom'));
    await renderPage();
    expect(scenarioBox().getAttribute('aria-busy')).toBeNull();
    expect(scenarioBox().textContent).toContain('Не удалось загрузить');
    const retry = container.querySelector('[data-testid="scenario-retry"]');
    expect(retry).toBeTruthy();

    getBeatsMock.mockResolvedValue({ beats: [{ id: 'B2', title: 'Бит', status: 'delivered', day: 1 }], delivered: 1, total: 1 });
    const before = getBeatsMock.mock.calls.length;
    await act(async () => {
      retry.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(getBeatsMock.mock.calls.length).toBe(before + 1);
    expect(container.querySelector('[data-testid="scenario-failed"]')).toBeNull();
    expect(scenarioBox().textContent).toContain('1 / 1');
  });

  it('сценарий ещё грузится: скелетон, а не сообщение о сбое', async () => {
    getBeatsMock.mockReset();
    getBeatsMock.mockReturnValue(new Promise(() => {}));
    await renderPage();
    expect(scenarioBox().getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[data-testid="scenario-failed"]')).toBeNull();
  });

  it('ошибка отправки показана в полосе режима и скрывается кнопкой «Скрыть ошибку»', async () => {
    const { sendMessage } = await import('../../api/conversations');
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error('телеграм не ответил'));
    await renderPage();
    const textarea = container.querySelector('textarea');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, 'привет');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sendBtn = [...container.querySelectorAll('button')].find((b) => /Отправить/.test(b.textContent));
    await act(async () => {
      sendBtn.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    const box = container.querySelector('[data-testid="input-error"]');
    expect(box.querySelector('[role="alert"]').textContent).toBe('телеграм не ответил');
    expect(container.textContent).toContain('РУЧНОЙ РЕЖИМ');
    await act(async () => {
      navButton('Скрыть ошибку').click();
    });
    expect(container.querySelector('[data-testid="input-error"]')).toBeNull();
    expect(container.textContent).toContain('Чат за тобой');
  });

  it('кнопка карточки клиента названа; на узком экране карточка открывается и закрывается', async () => {
    await renderPage();
    const sidebar = container.querySelector('aside[class*="sidebar"]');
    expect(sidebar.className).toContain('max-lg:z-50');
    expect(sidebar.className).toContain('max-lg:-translate-x-full');
    await act(async () => {
      navButton('Карточка клиента').click();
    });
    expect(sidebar.className).toContain('max-lg:translate-x-0');
    const overlay = sidebar.previousElementSibling;
    expect(overlay.className).toContain('z-40');
    await act(async () => {
      navButton('Закрыть карточку').click();
    });
    expect(sidebar.className).toContain('max-lg:-translate-x-full');

    await act(async () => {
      navButton('Карточка клиента').click();
    });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(sidebar.className).toContain('max-lg:-translate-x-full');
  });

  it('у поля сообщения рамка фокуса на всём блоке ввода', async () => {
    await renderPage();
    const frame = container.querySelector('textarea').closest('[class*="focus-within:ring"]');
    expect(frame).toBeTruthy();
  });
});

describe('ConversationPage: разделители дней', () => {
  const PAUSED = { chat_id: 111, is_paused: true, funnel_stage: 'rapport', pinned_facts: {}, first_seen: 1000, messages: [], funnel_events: [] };
  it('между сообщениями разных дней — разделитель с датой, в пределах дня — нет', async () => {
    const DAY = 24 * 3600;
    const base = Math.floor(new Date(2026, 9, 20, 12).getTime() / 1000);
    getConversationById.mockResolvedValueOnce({
      ...PAUSED,
      messages: [
        { id: 1, tg_msg_id: 10, ts: base, role: 'user', author: 'llm', content: 'раз' },
        { id: 2, tg_msg_id: 11, ts: base + 60, role: 'assistant', author: 'llm', content: 'два' },
        { id: 3, tg_msg_id: 12, ts: base + DAY, role: 'user', author: 'llm', content: 'три' },
      ],
    });
    await renderPage();
    const dividers = [...container.querySelectorAll('[role="separator"].dayDivider')];
    expect(dividers).toHaveLength(1);
    expect(dividers[0].getAttribute('aria-label')).toContain('21 октября');
  });
});
