// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import VoiceWork from './VoiceWork';
vi.mock('../../components/Header/Header', () => ({ default: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host, options, result, currentRoute;
function LocationProbe() { const location = useLocation(); currentRoute = location.pathname + location.search; return null; }
const click = async text => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === text).click());
async function input(label, value) {
  const element = [...host.querySelectorAll('label')].find(l => l.textContent.startsWith(label)).querySelector('input,textarea');
  await act(async () => {
    Object.getOwnPropertyDescriptor(element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const render = async (route = '/voice') => act(async () => root.render(<MemoryRouter initialEntries={[route]}><LocationProbe /><VoiceWork /></MemoryRouter>));
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  options = { role: 'manager', user_id: 2, linked: false, bot: { configured: true, username: 'test_bot' },
    managers: [{ id: 2, username: 'manager', voicer_id: 3, voicer_name: 'Оля', bot_linked: true }], personas: [{ slug: 'nastya', name: 'Настя' }] };
  result = { items: [], total: 0 };
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/api/voicer/options' ? options : result);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

test('manager submits exact text, emotion and name while keeping the assignment server controlled', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({});
  await render('/voice?compose=1&chat=123&contact=Дима&persona=nastya');
  expect(host.textContent).toContain('Оля');
  await input('Название записи', 'Для Димы · Утро'); await input('Текст голосового', 'Доброе утро'); await input('Эмоциональность', 'С улыбкой');
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(post).toHaveBeenCalledWith('/api/voicer/tasks', expect.objectContaining({ title: 'Для Димы · Утро', script: 'Доброе утро', emotion: 'С улыбкой', chat_id: '123', voice_mode: 'once', manager_id: 2 }));
  expect(post.mock.calls[0][1]).not.toHaveProperty('voicer_id');
  expect(host.querySelector('form')).toBeNull();
  expect(currentRoute).not.toContain('compose=');
  const reload = currentRoute; await act(async () => root.render(null)); await render(reload);
  expect(host.querySelector('form')).toBeNull();
});

test('consumes a chat compose link once and does not reopen the form after close and reload', async () => {
  await render('/voice?compose=1&chat=123&persona=nastya');
  expect(host.querySelector('form')).not.toBeNull();
  expect(currentRoute).toBe('/voice?chat=123&persona=nastya');
  await click('Отмена');
  const reload = currentRoute; await act(async () => root.render(null)); await render(reload);
  expect(host.querySelector('form')).toBeNull();
  await click('Новое задание'); expect(host.querySelector('form')).not.toBeNull();
});

test('does not allow new tasks until a voicer is assigned', async () => {
  options.managers[0].voicer_id = null; options.managers[0].voicer_name = null;
  await render('/voice?compose=1');
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Поставить в очередь').disabled).toBe(true);
  expect(host.textContent).toContain('Администратор назначает');
});

test('failed creation keeps the instructions and readable error for retry', async () => {
  vi.spyOn(api, 'post').mockRejectedValue(new Error('Проверьте назначение войсера'));
  await render('/voice?compose=1'); await input('Текст голосового', 'Не терять этот текст');
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(host.querySelector('textarea').value).toBe('Не терять этот текст');
  expect(host.querySelector('[role=alert]').textContent).toContain('Проверьте назначение');
});

test('voicer sees linking and assigned work but not manager creation', async () => {
  options.role = 'voice'; options.user_id = 3; options.managers = []; options.personas = [];
  await render('/voice?compose=1');
  expect(host.textContent).toContain('Подключить Telegram');
  expect(host.textContent).not.toContain('Новое задание'); expect(host.querySelector('form')).toBeNull();
});

test.each(['completed', 'ready'])('a %s recording is completed without approval and can be sent for revision', async status => {
  const task = { id: 42, revision: 1, title: 'Утро', kind: 'voice', voiceMode: 'library', status, script: 'Доброе утро', emotion: 'С улыбкой' };
  api.get.mockImplementation(async path => path === '/api/voicer/options' ? options : path === '/api/voicer/tasks/42' ? task : result);
  await render('/voice?task=42');
  expect(host.textContent).toContain('Выполнено');
  expect(host.textContent).not.toContain('На проверке');
  expect(host.textContent).not.toContain('Принять запись');
  expect([...host.querySelectorAll('button')].some(b => b.textContent === 'На перезапись')).toBe(true);
  expect([...host.querySelectorAll('option')].filter(o => o.textContent === 'Выполнено')).toHaveLength(1);
});

test('call form requires contact, topic and tempo, with biography disclosure', async () => {
  await render('/voice?compose=1');
  const select = [...host.querySelectorAll('label')].find(l => l.textContent.startsWith('Тип задания')).querySelector('select');
  await act(async () => { select.value = 'call'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  for (const title of ['Контакт для звонка', 'Темп разговора', 'Тема звонка']) {
    expect([...host.querySelectorAll('label')].find(l => l.textContent.startsWith(title)).querySelector('input,textarea').required).toBe(true);
  }
  expect(host.textContent).toContain('Войсер звонит с сайта');
});

test('library allows choosing a recipient and queues the file without claiming delivery or uploading again', async () => {
  result = { total: 1, items: [{ id: 1, title: 'Утро', current: true, revision: 1, duration: 5, createdAt: 1,
    task: { id: 1, personaSlug: 'nastya', personaName: 'Настя', contactLabel: 'Дима', managerName: 'manager', voicerName: 'Оля' } }] };
  const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 7, chat_id: '123', status: 'pending' });
  const fetch = vi.spyOn(globalThis, 'fetch');
  await render('/voice?tab=library&chat=123'); await click('Отправить в диалог');
  expect(host.textContent).toContain('Получатель');
  await click('Отправить выбранному собеседнику');
  expect(post).toHaveBeenCalledWith('/api/voicer/recordings/1/send', { chat_id: '123', request_id: expect.any(String) });
  expect(host.textContent).toContain('В очереди на отправку');
  expect(host.textContent).not.toContain('Голосовое отправлено'); expect(fetch).not.toHaveBeenCalled();
});

test('one-time mode clearly requires a recipient and submits automatic delivery intent', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({});
  await render('/voice?compose=1');
  const select = [...host.querySelectorAll('label')].find(l => l.textContent.startsWith('Режим голосового')).querySelector('select');
  await act(async () => { select.value = 'once'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).toContain('автоматически отправится');
  const recipient = [...host.querySelectorAll('label')].find(l => l.textContent.startsWith('Диалог для автоматической')).querySelector('select');
  expect(recipient.required).toBe(true);
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(post).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]').textContent).toContain('Выберите диалог');
});

test('opens the assigned chat from the bot deep link and preserves the call note across tabs', async () => {
  options.role = 'voice'; options.user_id = 3; options.managers = []; options.personas = [];
  const task = { id: 42, title: 'Тест звонка', kind: 'call', status: 'in_progress', chatId: '444', contactLabel: 'Дима', personaName: 'Настя', biography: 'Биография для звонка' };
  api.get.mockImplementation(async path => path === '/api/voicer/options' ? options : path === '/api/voicer/tasks/42' ? task : path === '/api/voicer/tasks/42/conversation' ?
    { items: [{ id: 1, ts: 100, role: 'user', text: 'Сообщение из чата' }] } : result);
  await render('/voice?task=42&view=chat');
  expect(host.textContent).toContain('Сообщение из чата');
  await input('Если звонка не было', 'Нужно перезвонить');
  await click('Задание и биография'); expect(host.textContent).toContain('Биография для звонка');
  await click('Переписка');
  expect(host.querySelector('textarea').value).toBe('Нужно перезвонить');
  expect(host.textContent).toContain('Сохранить итог звонка');
  expect(host.querySelector('a[href="/conversation/444"]')).toBeNull();
});

 test('a voicer cannot open history for a recording even through an old bot link', async () => {
  options.role = 'voice'; options.user_id = 3; options.managers = [];
  const task = { id: 42, title: 'Утро', kind: 'voice', status: 'queued', chatId: '444', script: 'Доброе утро', emotion: 'С улыбкой', biography: '{}' };
  api.get.mockImplementation(async path => path === '/api/voicer/options' ? options : path === '/api/voicer/tasks/42' ? task : result);
  await render('/voice?task=42&view=chat');
  expect(host.textContent).toContain('Доброе утро');
  expect(host.textContent).not.toContain('Переписка');
  expect(api.get.mock.calls.some(([path]) => path.includes('/conversation'))).toBe(false);
});
